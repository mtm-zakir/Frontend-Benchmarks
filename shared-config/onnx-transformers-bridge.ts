/**
 * ONNX Runtime Web & Transformers.js WASM Integration Bridge
 *
 * Provides browser runtime integration for ONNX Runtime Web (onnxruntime-web)
 * and Hugging Face Transformers.js (@huggingface/transformers), with fallback to
 * Native WebAssembly linear memory kernels.
 */

export type AiBackendType = "wasm-native" | "onnx-web" | "transformers-js";

export interface AiBackendInfo {
  type: AiBackendType;
  name: string;
  status: "ready" | "loading" | "fallback" | "unsupported";
  wasmSimd: boolean;
  wasmThreads: boolean;
  wasmMemoryMB: number;
  details: string;
}

/**
 * Detect browser WebAssembly hardware acceleration features (SIMD, Threads)
 */
export function detectWasmCapabilities(): { simd: boolean; threads: boolean } {
  let simd = false;
  let threads = false;

  if (typeof WebAssembly !== "undefined") {
    // Check WebAssembly SIMD
    try {
      simd = WebAssembly.validate(
        new Uint8Array([
          0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00,
          0x01, 0x05, 0x01, 0x60, 0x00, 0x01, 0x7b,
          0x03, 0x02, 0x01, 0x00,
          0x0a, 0x0a, 0x01, 0x08, 0x00, 0xfd, 0x0c, 0x00, 0x00, 0x00, 0x00, 0x0b,
        ])
      );
    } catch {
      simd = false;
    }

    // Check Threads / SharedArrayBuffer
    try {
      threads = typeof SharedArrayBuffer !== "undefined";
    } catch {
      threads = false;
    }
  }

  return { simd, threads };
}

/**
 * Configure and initialize ONNX Runtime Web with WebAssembly provider
 */
export async function initOnnxWebSession(): Promise<{
  success: boolean;
  runtimeDesc: string;
  backend: string;
}> {
  try {
    const ort = await import("onnxruntime-web");
    const caps = detectWasmCapabilities();

    // Configure WASM execution provider
    if (ort.env && ort.env.wasm) {
      ort.env.wasm.simd = caps.simd;
      ort.env.wasm.numThreads = caps.threads ? 2 : 1;
    }

    return {
      success: true,
      runtimeDesc: `ONNX Runtime Web v${ort.env?.versions?.web || "1.30.0"} (WASM ${caps.simd ? "SIMD" : "Scalar"}${caps.threads ? " + Threads" : ""})`,
      backend: "onnxruntime-web/wasm",
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      runtimeDesc: `ONNX Runtime Web (Fallback to WASM Kernel: ${msg})`,
      backend: "wasm-native",
    };
  }
}

/**
 * Configure and initialize Hugging Face Transformers.js
 */
export async function initTransformersJsPipeline(): Promise<{
  success: boolean;
  runtimeDesc: string;
  backend: string;
}> {
  try {
    const transformers = await import("@huggingface/transformers");
    const caps = detectWasmCapabilities();

    // Set environment backend options
    if (transformers.env?.backends?.onnx?.wasm) {
      transformers.env.backends.onnx.wasm.simd = caps.simd;
      transformers.env.backends.onnx.wasm.numThreads = caps.threads ? 2 : 1;
    }

    return {
      success: true,
      runtimeDesc: `Transformers.js v4 (ONNX WebAssembly ${caps.simd ? "SIMD" : "Scalar"})`,
      backend: "@huggingface/transformers/wasm",
    };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return {
      success: false,
      runtimeDesc: `Transformers.js (Fallback to WASM Kernel: ${msg})`,
      backend: "wasm-native",
    };
  }
}
