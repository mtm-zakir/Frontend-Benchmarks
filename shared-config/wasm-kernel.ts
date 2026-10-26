/**
 * WebAssembly (WASM) Real Compute Engine & Linear Memory Allocator
 *
 * Compiles and instantiates genuine WebAssembly binary bytecode directly in browser engines.
 * Manages raw WebAssembly.Memory linear address space (outside JS Heap),
 * executes compiled vector dot-product kernels and tensor warmups.
 */

// LEB128 unsigned integer encoder
function encodeU32(val: number): number[] {
  const bytes: number[] = [];
  do {
    let b = val & 0x7f;
    val >>>= 7;
    if (val !== 0) b |= 0x80;
    bytes.push(b);
  } while (val !== 0);
  return bytes;
}

function makeSection(id: number, payload: number[]): number[] {
  return [id, ...encodeU32(payload.length), ...payload];
}

function encodeString(str: string): number[] {
  const chars: number[] = [];
  for (let i = 0; i < str.length; i++) {
    chars.push(str.charCodeAt(i));
  }
  return [...encodeU32(chars.length), ...chars];
}

function makeFuncBody(body: number[]): number[] {
  return [...encodeU32(body.length), ...body];
}

// Generate valid WebAssembly binary bytecode
export function generateWasmTensorBytecode(): Uint8Array {
  // Magic header: \0asm, version: 1
  const magic = [0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00];

  // Type section (1)
  // 0: (i32, i32, i32) -> f32 (dot_product)
  // 1: () -> i32 (get_pages)
  // 2: (i32) -> f32 (tensor_warmup)
  const typeSec = makeSection(1, [
    0x03, // 3 types
    0x60, 0x03, 0x7f, 0x7f, 0x7f, 0x01, 0x7d,
    0x60, 0x00, 0x01, 0x7f,
    0x60, 0x01, 0x7f, 0x01, 0x7d,
  ]);

  // Function section (3)
  const funcSec = makeSection(3, [0x03, 0x00, 0x01, 0x02]);

  // Memory section (5): 1 memory, min 32 pages (2MB), max 256 pages (16MB)
  const memSec = makeSection(5, [0x01, 0x01, ...encodeU32(32), ...encodeU32(256)]);

  // Export section (7)
  const exportPayload = [
    0x04,
    ...encodeString("memory"), 0x02, 0x00,
    ...encodeString("dot_product"), 0x00, 0x00,
    ...encodeString("get_pages"), 0x00, 0x01,
    ...encodeString("tensor_warmup"), 0x00, 0x02,
  ];
  const exportSec = makeSection(7, exportPayload);

  // Code section (10)
  // Func 0: dot_product(ptrA, ptrB, len) -> f32
  const code0 = [
    0x02, 0x01, 0x7f, 0x01, 0x7d, // local 3 (i32 i), local 4 (f32 sum)
    0x02, 0x40, // block
    0x03, 0x40, // loop
    0x20, 0x03, // local.get 3
    0x20, 0x02, // local.get 2
    0x4e,       // i32.ge_s
    0x0d, 0x01, // br_if 1 (break to end of block)
    0x20, 0x04, // local.get 4
    // load A: ptrA + i * 4
    0x20, 0x00, 0x20, 0x03, 0x41, 0x02, 0x74, 0x6a, 0x2a, 0x02, 0x00,
    // load B: ptrB + i * 4
    0x20, 0x01, 0x20, 0x03, 0x41, 0x02, 0x74, 0x6a, 0x2a, 0x02, 0x00,
    0x94, // f32.mul
    0x92, // f32.add
    0x21, 0x04, // local.set 4
    0x20, 0x03, 0x41, 0x01, 0x6a, 0x21, 0x03, // i++
    0x0c, 0x00, // br 0
    0x0b, // end loop
    0x0b, // end block
    0x20, 0x04, // local.get 4
    0x0b, // end func
  ];

  // Func 1: get_pages() -> i32
  const code1 = [0x00, 0x3f, 0x00, 0x0b];

  // Func 2: tensor_warmup(len: i32) -> f32
  const code2 = [
    0x02, 0x01, 0x7f, 0x01, 0x7d, // local 1 (i32), local 2 (f32 sum)
    0x02, 0x40,
    0x03, 0x40,
    0x20, 0x01,
    0x20, 0x00,
    0x4e,
    0x0d, 0x01,
    0x20, 0x01, 0x41, 0x02, 0x74, // addr = i * 4
    0x43, 0x00, 0x00, 0x80, 0x3f, // f32.const 1.0
    0x38, 0x02, 0x00,             // f32.store
    0x20, 0x02,
    0x43, 0x00, 0x00, 0x80, 0x3f,
    0x92, // f32.add
    0x21, 0x02,
    0x20, 0x01, 0x41, 0x01, 0x6a, 0x21, 0x01,
    0x0c, 0x00,
    0x0b,
    0x0b,
    0x20, 0x02,
    0x0b,
  ];

  const codeSec = makeSection(10, [
    0x03,
    ...makeFuncBody(code0),
    ...makeFuncBody(code1),
    ...makeFuncBody(code2),
  ]);

  return new Uint8Array([
    ...magic,
    ...typeSec,
    ...funcSec,
    ...memSec,
    ...exportSec,
    ...codeSec,
  ]);
}

export interface WasmInstanceExports {
  memory: WebAssembly.Memory;
  dot_product: (ptrA: number, ptrB: number, len: number) => number;
  get_pages: () => number;
  tensor_warmup: (len: number) => number;
}

export interface WasmInitResult {
  module: WebAssembly.Module;
  instance: WebAssembly.Instance;
  exports: WasmInstanceExports;
  compileMs: number;
  pages: number;
  linearMemoryBytes: number;
  linearMemoryMB: number;
  warmupResult: number;
}

let activeWasmSession: WasmInitResult | null = null;

/**
 * Initializes the WebAssembly compute engine synchronously or asynchronously
 */
export function initWasmComputeEngine(): WasmInitResult {
  const t0 = performance.now();
  const bytecode = generateWasmTensorBytecode();
  const module = new WebAssembly.Module(bytecode.buffer as ArrayBuffer);
  const instance = new WebAssembly.Instance(module);
  const exports = instance.exports as unknown as WasmInstanceExports;
  const compileMs = performance.now() - t0;

  const pages = exports.get_pages();
  const linearMemoryBytes = exports.memory.buffer.byteLength;
  const linearMemoryMB = +(linearMemoryBytes / (1024 * 1024)).toFixed(2);

  // Initialize weights into WASM linear memory
  const f32View = new Float32Array(exports.memory.buffer);
  const warmupCount = Math.min(25000, f32View.length / 2);
  for (let i = 0; i < warmupCount; i++) {
    f32View[i] = (i % 100) * 0.01;
    f32View[warmupCount + i] = (i % 50) * 0.02;
  }

  // Execute WASM compiled dot_product function
  const warmupResult = exports.dot_product(0, warmupCount * 4, warmupCount);

  activeWasmSession = {
    module,
    instance,
    exports,
    compileMs: +compileMs.toFixed(2),
    pages,
    linearMemoryBytes,
    linearMemoryMB,
    warmupResult: +warmupResult.toFixed(2),
  };

  return activeWasmSession;
}

export function getActiveWasmSession(): WasmInitResult | null {
  return activeWasmSession;
}

export function runWasmDotProduct(ptrA: number, ptrB: number, len: number): number {
  if (!activeWasmSession) {
    initWasmComputeEngine();
  }
  return activeWasmSession!.exports.dot_product(ptrA, ptrB, len);
}

export function teardownWasmComputeEngine(): void {
  activeWasmSession = null;
}
