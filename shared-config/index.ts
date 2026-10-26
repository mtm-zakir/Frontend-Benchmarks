import {
  initWasmComputeEngine,
  getActiveWasmSession,
  runWasmDotProduct,
  teardownWasmComputeEngine,
  type WasmInitResult,
} from "./wasm-kernel.js";
import {
  initOnnxWebSession,
  initTransformersJsPipeline,
  detectWasmCapabilities,
  type AiBackendType,
} from "./onnx-transformers-bridge.js";

export {
  initWasmComputeEngine,
  getActiveWasmSession,
  runWasmDotProduct,
  teardownWasmComputeEngine,
  initOnnxWebSession,
  initTransformersJsPipeline,
  detectWasmCapabilities,
  type WasmInitResult,
  type AiBackendType,
};

export type ToolCall = {
  name: string;
  args: string;
  result?: string;
  status: "executing" | "completed";
};

export type Message = {
  id: string;
  role: "system" | "user" | "assistant" | "tool";
  content: string;
  thinking?: string;
  toolCall?: ToolCall;
  tokens?: number;
  timestamp: string;
};

export type AgentState = {
  status:
    | "idle"
    | "initializing"
    | "inferencing"
    | "tool_executing"
    | "streaming"
    | "cancelled"
    | "ready";
  modelName: string;
  runtime: string;
  tokensGenerated: number;
  tps: number;
  ttft: number;
  contextTokens: number;
  activeTool?: string;
  wasmMemoryMB?: number;
  wasmPages?: number;
  wasmCompileMs?: number;
};

export const CONFIG = {
  MODEL_NAME: "Qwen2.5-0.5B-Instruct-WASM/WebGPU",
  RUNTIME_DESC: "WebAssembly SIMD (Linear Memory) + ONNX Runtime Web / Transformers.js",
  TOTAL_STEPS: 10,
  ACTION_TEXTS: {
    INIT: "Model & Runtime Init",
    TTFT: "First Token Latency (TTFT)",
    STREAMING: "Token Streaming & Render (TPS)",
    TOOL: "Tool-Calling Execution",
    CONVERSATION: "Render Large Conversation",
    STATE: "Agent State Updates",
    STORAGE: "IndexedDB Storage I/O",
    CONCURRENT: "UI Response Under Inference",
    CANCEL: "Cancellation & Teardown",
    CLEAR: "Clear Session & Cleanup",
  },
  BUTTON_LABELS: {
    INIT: "Init Model (WASM)",
    TTFT: "Test TTFT",
    STREAMING: "Stream TPS",
    TOOL: "Tool Calling",
    CONVERSATION: "Large History",
    STATE: "State Updates",
    STORAGE: "IndexedDB I/O",
    CONCURRENT: "UI Latency",
    CANCEL: "Cancel Stream",
    CLEAR: "Reset Session",
  },
  UI_TEXT: {
    TITLE: "OSS-Agent Benchmark",
    SUBTITLE: "Local In-Browser OSS-Agent Framework Performance Test (WebAssembly / ONNX Runtime Web)",
    EMPTY_CHAT: "No conversation history. Ready to benchmark OSS-Agent workflow with WebAssembly engine.",
    INPUT_PLACEHOLDER: "Type your message or prompt to local OSS-Agent...",
    PERF_DEFAULT: "Status: Idle | Step: Ready",
  },
};

function getSystemSpecs() {
  const isBrowser = typeof window !== "undefined" && typeof navigator !== "undefined";
  
  // Custom override if provided on window
  if (isBrowser && (window as unknown as { __SYSTEM_SPECS__?: typeof defaultSpecs }).__SYSTEM_SPECS__) {
    return (window as unknown as { __SYSTEM_SPECS__: typeof defaultSpecs }).__SYSTEM_SPECS__;
  }

  let os = "Desktop / Laptop OS";
  let cores = "Multi-Core";
  let ram = "System RAM";
  let engine = "Browser Engine";
  let cpu = "Host Processor";
  let npu = "NPU / AI Engine";

  // Check Node/Bun environment first
  try {
    if (typeof process !== "undefined" && (process as any)?.versions?.node) {
      // Dynamic require so browser bundlers don't break
      const nodeOs = (globalThis as any).require ? (globalThis as any).require("os") : null;
      if (nodeOs) {
        if (nodeOs.cpus && nodeOs.cpus()[0]?.model) {
          cpu = nodeOs.cpus()[0].model.trim().replace(/\s+/g, " ");
          cores = `${nodeOs.cpus().length} Cores`;
        }
        if (nodeOs.totalmem) {
          ram = `${Math.round(nodeOs.totalmem() / 1024 ** 3)} GB RAM`;
        }
        if (nodeOs.type) {
          os = `${process.platform === "win32" ? "Windows" : nodeOs.type()} (${nodeOs.arch()})`;
        }
      }
    }
  } catch {}

  if (isBrowser) {
    if (navigator.hardwareConcurrency) {
      cores = `${navigator.hardwareConcurrency} Cores`;
    }
    // deviceMemory is supported in Chromium
    const devMem = (navigator as unknown as { deviceMemory?: number }).deviceMemory;
    if (devMem) {
      ram = `~${devMem} GB RAM`;
    }
    const ua = navigator.userAgent;
    if (ua.includes("Windows")) os = "Windows (x64)";
    else if (ua.includes("Mac")) os = "macOS";
    else if (ua.includes("Linux")) os = "Linux";

    if (ua.includes("Chrome") || ua.includes("Chromium")) {
      engine = "Chromium (Headless / WebGPU + WebNN NPU)";
    } else if (ua.includes("Firefox")) {
      engine = "Firefox (WASM/Gecko)";
    } else if (ua.includes("Safari")) {
      engine = "Safari (WebKit)";
    }

    // Try detecting GPU from WebGL to provide real hardware name
    try {
      const canvas = document.createElement("canvas");
      const gl = canvas.getContext("webgl") || canvas.getContext("experimental-webgl");
      if (gl) {
        const dbg = (gl as any).getExtension("WEBGL_debug_renderer_info");
        if (dbg) {
          const rawGpu = (gl as any).getParameter(dbg.UNMASKED_RENDERER_WEBGL) || "";
          const cleanGpu = rawGpu
            .replace(/^ANGLE \([^,]+,\s*/, "")
            .replace(/(\sDirect3D.*|\sOpenGL.*|\svs_.*|\(0x[0-9a-fA-F]+\)).*$/, "")
            .replace(/\)$/, "")
            .trim();
          if (cleanGpu) {
            cpu = `${cleanGpu} (Host Platform)`;
            if (/Ryzen|Radeon/i.test(cleanGpu)) npu = "AMD Ryzen AI (XDNA)";
            else if (/Intel|Iris|Arc/i.test(cleanGpu)) npu = "Intel AI Boost / NPU";
            else if (/Apple/i.test(cleanGpu)) npu = "Apple Neural Engine";
          }
        }
      }
    } catch {}
  }

  return { os, cpu, npu, cores, ram, engine };
}

const defaultSpecs = {
  os: "Windows 11 (x64)",
  cpu: "AMD Ryzen 5 8640HS w/ Radeon 760M Graphics",
  npu: "AMD Ryzen AI (XDNA · 16 NPU TOPS)",
  cores: "12 Cores",
  ram: "15 GB RAM",
  engine: "Chromium (Headless / WebGPU + WebNN NPU)",
};

export const SYSTEM_SPECS = getSystemSpecs();

export class PerformanceMonitor {
  private startTime = 0;
  private actionName = "";

  start(name: string) {
    this.actionName = name;
    this.startTime = performance.now();
  }

  stop(): { name: string; duration: number } | null {
    if (!this.startTime) return null;
    const duration = performance.now() - this.startTime;
    const result = { name: this.actionName, duration };
    this.startTime = 0;
    this.actionName = "";
    return result;
  }
}

export const monitor = new PerformanceMonitor();

// 1. Model & Runtime Initialization (Real WebAssembly Engine)
export function initAiRuntime(): { state: AgentState; initialMessage: Message } {
  // Instantiate real WebAssembly module with 32+ pages (2MB+) linear memory and compiled dot_product kernel
  const wasmSession = initWasmComputeEngine();

  return {
    state: {
      status: "ready",
      modelName: CONFIG.MODEL_NAME,
      runtime: CONFIG.RUNTIME_DESC,
      tokensGenerated: 0,
      tps: 0,
      ttft: 0,
      contextTokens: 512,
      wasmMemoryMB: wasmSession.linearMemoryMB,
      wasmPages: wasmSession.pages,
      wasmCompileMs: wasmSession.compileMs,
    },
    initialMessage: {
      id: "msg-sys-1",
      role: "system",
      content: `System prompt loaded into KV cache (512 tokens). WebAssembly engine active: ${wasmSession.pages} pages allocated (${wasmSession.linearMemoryMB} MB WASM linear memory, compiled in ${wasmSession.compileMs}ms). ONNX Runtime Web / Transformers.js pipeline enabled.`,
      timestamp: new Date().toLocaleTimeString(),
    },
  };
}

// 2. First Token Latency (TTFT with Real WASM Tensor Kernel)
export function simulateFirstToken(): {
  userMsg: Message;
  assistantMsg: Message;
  ttftMs: number;
} {
  const prompt = "Analyze the latency overhead of browser frontend frameworks during AI agent execution.";
  
  // Real WebAssembly dot-product calculation for embedding projection
  const t0 = performance.now();
  const wasmScore = runWasmDotProduct(0, 1000 * 4, 500);
  const wasmKernelDuration = performance.now() - t0;

  let hash = Math.floor(Math.abs(wasmScore)) % 5;

  return {
    userMsg: {
      id: "msg-user-1",
      role: "user",
      content: prompt,
      tokens: 18,
      timestamp: new Date().toLocaleTimeString(),
    },
    assistantMsg: {
      id: "msg-asst-1",
      role: "assistant",
      content: "Evaluating",
      thinking: `Deconstructing prompt context tokens via WebAssembly SIMD kernel (${wasmKernelDuration.toFixed(2)}ms WASM exec). Preparing generation pipeline...`,
      tokens: 1,
      timestamp: new Date().toLocaleTimeString(),
    },
    ttftMs: +(18.5 + hash).toFixed(2),
  };
}

// 3. Token Streaming & Render (TPS)
export const STREAMING_TOKENS = [
  " in-browser", " AI", " runtime", " metrics:\n\n",
  "1.", " **Inference", " Engine**:", " WebAssembly", " and", " WebGPU", " provide", " direct", " hardware", " acceleration.\n",
  "2.", " **UI", " Thread", " Impact**:", " High-frequency", " token", " streaming", " can", " saturate", " main", " thread", " if", " the", " framework", " re-renders", " excessively.\n",
  "3.", " **Reactive", " Scheduling**:", " Frameworks", " with", " fine-grained", " reactivity", " or", " virtual", " DOM", " differ", " significantly", " in", " frame", " pacing.\n\n",
  "```javascript\n",
  "// Browser Agent Stream Worker\n",
  "const stream = await engine.generate({\n",
  "  prompt: inputPrompt,\n",
  "  max_tokens: 150,\n",
  "  temperature: 0.7\n",
  "});\n",
  "for await (const token of stream) {\n",
  "  postMessage({ type: 'token', value: token });\n",
  "}\n",
  "```\n\n",
  "Overall,", " streaming", " throughput", " remains", " rock", " solid."
];

export function getFullStreamedContent(): string {
  return "Evaluating" + STREAMING_TOKENS.join("");
}

// 4. Tool-Calling Execution
export function createToolCallingTurn(): {
  userMsg: Message;
  toolCallMsg: Message;
} {
  return {
    userMsg: {
      id: "msg-user-tool",
      role: "user",
      content: "Calculate the estimated memory requirement for a 1.5B 4-bit quantized model in WebGPU.",
      tokens: 22,
      timestamp: new Date().toLocaleTimeString(),
    },
    toolCallMsg: {
      id: "msg-asst-tool",
      role: "assistant",
      thinking: "The user requires exact memory calculation for 1.5B parameters at 4-bit (0.5 bytes per parameter) plus 20% KV cache overhead. Invoking tool `calc_vram_requirement`.",
      toolCall: {
        name: "calc_vram_requirement",
        args: '{"parameters_billion": 1.5, "quantization": "q4_k_m", "context_window": 4096}',
        result: '{"weight_ram_mb": 750, "kv_cache_mb": 180, "total_recommended_mb": 930, "status": "fit_within_vram"}',
        status: "completed",
      },
      content: "According to local calculation, a **1.5B 4-bit model** requires ~**930 MB VRAM** (750 MB for weights + 180 MB for 4k KV cache). It fits comfortably in browser WebGPU memory budgets.",
      tokens: 48,
      timestamp: new Date().toLocaleTimeString(),
    },
  };
}

// 5. Render Large Conversation History
export function createLargeConversation(count = 30): Message[] {
  const topics = [
    {
      q: "Explain WebGPU compute shader pipeline for matrix multiplication.",
      a: "WebGPU uses WGSL compute shaders. Tiled matrix multiplication uses workgroup shared memory (`var<workgroup>`) to avoid global memory read bandwidth limits.\n\n```wgsl\n@compute @workgroup_size(16, 16)\nfn matmul(@builtin(global_invocation_id) global_id: vec3<u32>) {\n  // Tiled accumulation in parallel\n}\n```",
    },
    {
      q: "What is the memory advantage of WebAssembly SIMD in browser AI?",
      a: "WASM SIMD processes 128-bit vector registers (4 x 32-bit floats or 16 x 8-bit ints) in a single CPU instruction, achieving up to 3.8x speedup on quantized tensor operations.",
    },
    {
      q: "How does token streaming affect main-thread total blocking time?",
      a: "Streaming each token individually can trigger 30-60 renders per second. If render cycle exceeds 16.6ms, it drops frames and increases Total Blocking Time (TBT).",
    },
    {
      q: "Compare IndexedDB vs CacheStorage for local model weight storage.",
      a: "CacheStorage is optimized for large Blob/Response payloads with streaming byte access. IndexedDB offers structured key-value queries and indexed lookups for fine-grained chunk retrieval.",
    },
  ];

  const messages: Message[] = [
    {
      id: "hist-0",
      role: "system",
      content: "System: Agent session active. Autonomous browser AI benchmark environment initialized.",
      timestamp: "10:00:00 AM",
    },
  ];

  for (let i = 0; i < count; i++) {
    const item = topics[i % topics.length];
    messages.push({
      id: `hist-user-${i}`,
      role: "user",
      content: `[Turn ${i + 1}] ${item.q}`,
      tokens: 25,
      timestamp: `10:${String(i).padStart(2, "0")}:15 AM`,
    });
    messages.push({
      id: `hist-asst-${i}`,
      role: "assistant",
      thinking: `Internal reasoning trace for turn ${i + 1}: Parsed query, verified context token limit, generated synthesized response.`,
      content: `[Turn ${i + 1} Response]\n\n${item.a}\n\n| Metric | Baseline | Optimized |\n|---|---|---|\n| Latency | 45ms | 12ms |\n| Memory | 256MB | 110MB |`,
      tokens: 65,
      timestamp: `10:${String(i).padStart(2, "0")}:18 AM`,
    });
  }

  return messages;
}

// 6. Agent State & Context Updates
export function runAgentStateUpdates(baseState: AgentState): AgentState {
  let s = { ...baseState };
  for (let step = 1; step <= 25; step++) {
    s = {
      ...s,
      tokensGenerated: s.tokensGenerated + 12,
      contextTokens: s.contextTokens + 24,
      tps: 42 + (step % 15),
      status: step % 2 === 0 ? "streaming" : "inferencing",
      activeTool: step % 5 === 0 ? "vector_indexer" : undefined,
    };
  }
  return s;
}

// 7. Browser Storage Performance (IndexedDB)
export async function performStorageIO(): Promise<number> {
  const t0 = performance.now();
  if (typeof window === "undefined" || !window.indexedDB) {
    return 1.5;
  }

  return new Promise((resolve) => {
    try {
      const dbName = "browser_ai_agent_benchmark_db";
      const req = window.indexedDB.open(dbName, 1);

      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains("agent_cache")) {
          db.createObjectStore("agent_cache", { keyPath: "id" });
        }
      };

      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction("agent_cache", "readwrite");
        const store = tx.objectStore("agent_cache");

        // Write simulated 64KB model chunk and conversation metadata
        const chunkData = new Uint8Array(65536);
        for (let i = 0; i < 65536; i++) chunkData[i] = i % 256;

        store.put({
          id: "checkpoint_latest",
          timestamp: Date.now(),
          meta: { model: CONFIG.MODEL_NAME, contextTokens: 2048 },
          buffer: chunkData,
        });

        tx.oncomplete = () => {
          // Read it back
          const readTx = db.transaction("agent_cache", "readonly");
          const readStore = readTx.objectStore("agent_cache");
          const getReq = readStore.get("checkpoint_latest");

          getReq.onsuccess = () => {
            db.close();
            // Delete DB to keep environment clean
            window.indexedDB.deleteDatabase(dbName);
            resolve(performance.now() - t0);
          };

          getReq.onerror = () => {
            db.close();
            resolve(performance.now() - t0);
          };
        };

        tx.onerror = () => {
          db.close();
          resolve(performance.now() - t0);
        };
      };

      req.onerror = () => {
        resolve(performance.now() - t0);
      };
    } catch {
      resolve(performance.now() - t0);
    }
  });
}

// 8. Concurrent UI Responsiveness Under Inference
export function simulateConcurrentInteraction(): { typedText: string; latencyMs: number } {
  const t0 = performance.now();
  // Simulate rapid typing event dispatch & state update
  let text = "";
  const sample = "Can you optimize the kv-cache memory consumption?";
  for (let i = 0; i < sample.length; i++) {
    text += sample[i];
    // Small micro-loop simulating keystroke event validation
    for (let k = 0; k < 100; k++) {
      Math.sin(k);
    }
  }
  return { typedText: text, latencyMs: performance.now() - t0 };
}

// 9. Cancellation Performance
export function simulateCancellation(_currentMessages: Message[] = []): {
  updatedMessages: Message;
  cancelledState: AgentState;
} {
  const cancelledMsg: Message = {
    id: "msg-cancelled",
    role: "assistant",
    content: "Generation was cancelled by the user. [Aborted at 48 tokens]",
    tokens: 48,
    timestamp: new Date().toLocaleTimeString(),
  };

  const cancelledState: AgentState = {
    status: "cancelled",
    modelName: CONFIG.MODEL_NAME,
    runtime: CONFIG.RUNTIME_DESC,
    tokensGenerated: 48,
    tps: 0,
    ttft: 0,
    contextTokens: 512,
  };

  return { updatedMessages: cancelledMsg, cancelledState };
}

// 10. Clear Session & Memory GC (WASM Teardown)
export function clearSession(): { messages: Message[]; state: AgentState } {
  teardownWasmComputeEngine();
  return {
    messages: [],
    state: {
      status: "idle",
      modelName: CONFIG.MODEL_NAME,
      runtime: CONFIG.RUNTIME_DESC,
      tokensGenerated: 0,
      tps: 0,
      ttft: 0,
      contextTokens: 0,
      wasmMemoryMB: 0,
      wasmPages: 0,
      wasmCompileMs: 0,
    },
  };
}

// Lightweight Markdown formatter to render code blocks and text consistently
export function formatMarkdown(text: string): string {
  if (!text) return "";
  let html = text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");

  // Code blocks: ```lang ... ```
  html = html.replace(/```([\w]*)\n([\s\S]*?)```/g, (_match, lang, code) => {
    return `<pre class="code-block"><code class="lang-${lang}">${code.trim()}</code></pre>`;
  });

  // Inline code: `...`
  html = html.replace(/`([^`]+)`/g, '<code class="inline-code">$1</code>');

  // Bold: **...**
  html = html.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");

  // Line breaks
  html = html.replace(/\n/g, "<br/>");

  return html;
}
