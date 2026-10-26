# OSS-Agent Frontend Benchmark: Architecture, Logic & Engineering Specification

## 1. Executive Overview & Research Thesis

### 1.1 The Problem Statement
Local, in-browser AI agents are transitioning from simple chat interfaces to autonomous clients executing multi-turn tool calling, real-time token streaming, vector embedding calculations, and continuous state updates. In this architecture, the web browser is not merely a rendering target—it serves as the runtime environment hosting both the AI compute engine (via WebAssembly or WebGPU) and the reactive user interface.

Most AI benchmarks evaluate model throughput (tokens per second, TTFT, perplexity) on isolated server hardware. However, in a browser-based agent, the primary user experience bottleneck is frequently the **main thread contention and DOM rendering overhead** introduced by the frontend framework. When an inference engine emits 30 to 60 tokens per second, rapid reactive state re-renders can monopolize the UI event loop, leading to dropped frames, severe input lag, and runaway JavaScript heap memory allocations.

### 1.2 Core Research Question
> *When hosting an autonomous AI agent workload inside a browser engine, what is the exact computational, memory, and rendering overhead introduced by different JavaScript frontend frameworks compared to zero-abstraction Vanilla DOM manipulation?*

### 1.3 Scope of the Benchmark Suite
This project evaluates **11 distinct frontend frameworks** across **10 standardized agent operations** under strictly identical conditions:
* Identical model metadata and system prompts
* Identical WebAssembly linear memory allocations and compute kernels
* Identical streaming token sequences and markdown formatting
* Identical IndexedDB database transactions and state churn frequency
* Identical browser viewport, Chromium version, and host hardware specs

---

## 2. System Architecture & Project Organization

The repository is structured as a Bun/npm monorepo containing 12 workspace packages and automated benchmarking infrastructure:

```
Frontend-Benchmarks/
├── package.json              # Monorepo configuration, workspace scripts, dependencies
├── run-benchmarks.mjs        # Automated Playwright test harness & metrics aggregator
├── benchmark-results.json    # Canonical JSON benchmark data store
├── benchmark-results.md      # Auto-generated Markdown comparative report
├── results.html              # Interactive client-side results dashboard & visualizer
├── finalize.html             # Research finalization and summary view
├── shared-config/            # Centralized engine, styles, types, and logic
│   ├── index.ts              # Agent workflow steps, state machines, monitor
│   ├── wasm-kernel.ts        # Pure WebAssembly bytecode generator & linear memory engine
│   ├── onnx-transformers-bridge.ts # ONNX Runtime Web & Transformers.js bridge
│   ├── agent-style.css       # Unified design system & layout styling
│   ├── tsconfig.json         # TypeScript configuration
│   └── package.json          # Package definition for @shared/config
├── vanilla/                  # Imperative DOM baseline implementation (Vite)
├── react/                    # React 19 implementation (Vite + Rolldown)
├── vue/                      # Vue 3 Composition API implementation (Vite)
├── solid/                    # SolidJS fine-grained reactive implementation (Vite)
├── svelte/                   # Svelte 5 Runes implementation (SvelteKit)
├── preact/                   # Preact lightweight VDOM implementation (Vite)
├── inferno/                  # Inferno hyper-optimized VDOM implementation (Vite)
├── lit/                      # Lit Web Components implementation (Vite)
├── mithril/                  # Mithril hyperscript implementation (Vite)
├── qwik/                     # Qwik resumable architecture implementation (Vite)
└── angular/                  # Angular 19 standalone component implementation (esbuild)
```

---

## 3. The 11 Evaluated Frontend Frameworks

Each framework implements the exact same single-page application structure: a header with model/system telemetry, a dual-pane view containing an interactive agent chat session with reasoning traces and tool-call cards, and a live metrics ledger recording operation durations.

| Framework | Architecture Type | Rendering Mechanism | Reactivity Paradigm |
| :--- | :--- | :--- | :--- |
| **Vanilla JS** | Zero-Abstraction Baseline | Direct imperative `document.createElement` / `innerHTML` | Manual DOM manipulation |
| **SolidJS** | Fine-Grained Reactive | Compiled DOM nodes with direct Signal bindings | Proxies / Signals (no VDOM) |
| **Inferno** | Optimized Virtual DOM | Monomorphic VDOM diffing, optimized bitwise flags | Synthetic VDOM reconciliation |
| **Preact** | Minimalist Virtual DOM | Thin 3kB Virtual DOM layer | Component State hooks |
| **Mithril** | Hyperscript VDOM | Centralized redraw scheduler (`m.redraw()`) | Function-based views (`m(...)`) |
| **Lit** | Web Components | Standard Custom Elements with HTML tagged templates (`html\`...\``) | Shadow DOM property observers |
| **Vue 3** | Reactive Proxy VDOM | Compiler-informed VDOM with patch flags | `ref()` / `reactive()` Proxies |
| **Svelte 5** | Runes Compiler | Fine-grained direct DOM surgery | Signals (`$state`, `$derived`) |
| **React 19** | Full Virtual DOM | Fiber engine reconciliation with Concurrent Mode | `useState` / `useEffect` hooks |
| **Angular 19** | Component / ZoneJS/Signals | Template compiler with change detection tree | Angular Signals & Standalone Components |
| **Qwik** | Resumable Architecture | Serialized HTML hydration with fine-grained event resumption | Reactive Proxies (`useSignal`, `useStore`) |

---

## 4. WebAssembly (WASM) & AI Runtime Engine

A critical requirement of this project is avoiding superficial JavaScript simulations. Real browser agents run heavy compute in WebAssembly and WebGPU.

### 4.1 Native WebAssembly Linear Memory Kernel (`wasm-kernel.ts`)
Rather than relying on simulated JS `Float32Array` objects located inside V8's garbage-collected heap, the engine generates and compiles authentic WebAssembly binary bytecode on the fly:

```
+-------------------------------------------------------------+
|                 Browser Execution Boundary                  |
|                                                             |
|  +---------------------------+   +-----------------------+  |
|  |     JavaScript Engine     |   |   WebAssembly Engine  |  |
|  |       (V8 / Spider)       |   |       (WASM VM)       |  |
|  |                           |   |                       |  |
|  |  Agent UI & State Loops   |   |   Linear Address      |  |
|  |  Message Serialization    |   |   Space (64KB Pages)  |  |
|  +-------------+-------------+   +-----------+-----------+  |
|                |                             |              |
|                |  Float32Array Zero-Copy View|              |
|                +---------------------------->|              |
|                                              |              |
|                           Compiled WASM Kernels:            |
|                           - dot_product(ptrA, ptrB, len)    |
|                           - tensor_warmup(len)              |
|                           - get_pages() / grow_memory()     |
+-------------------------------------------------------------+
```

1. **Bytecode Synthesis**:
   The generator produces valid WASM binary format (`0x00 0x61 0x73 0x6d`, Version 1) directly using LEB128 integer encoding for section sizes and type signatures.
2. **Memory Isolation**:
   Instantiates `WebAssembly.Memory` with an initial size of **32 pages (2.0 MB)**, growable up to **256 pages (16.0 MB)**. This linear memory space is completely decoupled from the garbage collector, accurately mirroring real AI runtimes (like llama.cpp or ONNX Runtime).
3. **Compiled Compute Kernels**:
   * `dot_product(ptrA, ptrB, len) -> f32`: Implements an inner loop over two vector pointers in WASM memory, multiplying 32-bit floating point scalars (`f32.load`, `f32.mul`, `f32.add`) and returning the accumulated sum.
   * `tensor_warmup(len) -> f32`: Writes initialized weight tensors into linear addresses and computes warmup dot products.
   * `get_pages() -> i32`: Queries current linear memory allocation (`memory.size`).
4. **Lifecycle & Teardown**:
   On benchmark initialization, the bytecode is compiled synchronously via `new WebAssembly.Module()` and instantiated via `new WebAssembly.Instance()`. When the session is cleared, all references to the memory buffer and instance are torn down, allowing true memory release.

### 4.2 ONNX Runtime Web & Transformers.js Integration (`onnx-transformers-bridge.ts`)
To accommodate full-scale machine learning workflows, the architecture incorporates bridges for industry-standard browser AI runtimes:
* **`onnxruntime-web` (v1.30.0)**: Supports WASM SIMD (128-bit vector registers) and multi-threaded worker backends. Bundlers across the repository automatically emit and serve the required `.wasm` runtime assets (`ort-wasm-simd-threaded.wasm`, `ort-wasm-simd-threaded.jsep.wasm`).
* **`@huggingface/transformers` (v4.3.1)**: Exposes Hugging Face's browser pipeline abstraction for tokenizers and model graph execution.
* **Hardware Capability Probing**:
  `detectWasmCapabilities()` dynamically probes the client engine for:
  - **WASM SIMD Support**: Validates a minimal SIMD bytecode probe to confirm hardware vector instruction availability.
  - **Multi-Threading / SharedArrayBuffer**: Inspects `window.SharedArrayBuffer` to check if Cross-Origin Isolation headers (`COOP`/`COEP`) are enabled.

---

## 5. The 10 Benchmarked Agent Operations

Every framework executes a sequential 10-step benchmark cycle. Each step isolates a specific phase of an autonomous AI agent's operational lifecycle:

```
[ Step 1: Model & Runtime Init ]
              │
              ▼
[ Step 2: First Token Latency (TTFT) ]
              │
              ▼
[ Step 3: Token Streaming & Render (TPS) ]
              │
              ▼
[ Step 4: Tool-Calling Execution ]
              │
              ▼
[ Step 5: Render Large Conversation History ]
              │
              ▼
[ Step 6: Agent State Updates Churn ]
              │
              ▼
[ Step 7: IndexedDB Storage I/O ]
              │
              ▼
[ Step 8: UI Response Under Inference ]
              │
              ▼
[ Step 9: Cancellation & Teardown ]
              │
              ▼
[ Step 10: Clear Session & Cleanup ]
```

### Operation 1: Model & Runtime Init
* **What it does**: Compiles the WebAssembly binary module, allocates 32 pages (2.0 MB) of WASM linear memory, populates weight tensors, and runs the vector dot-product warmup kernel.
* **What it measures**: The overhead of initializing binary modules, reserving native memory buffers, and setting up initial agent telemetry without UI thread stalls.

### Operation 2: First Token Latency (TTFT)
* **What it does**: Ingests user input, tokenizes prompt context, executes a WebAssembly projection kernel, and emits the opening token alongside an internal reasoning/thinking trace.
* **What it measures**: Time to First Token. Evaluates how quickly the framework can mount new conversation nodes, display reasoning badges, and initiate generation pipelines.

### Operation 3: Token Streaming & Render (TPS)
* **What it does**: Streams 150 tokens across the UI thread in rapid succession. The stream includes raw text, numbered lists, and syntax-highlighted code blocks.
* **What it measures**: Tokens Per Second rendering throughput. Frameworks with virtual DOM reconciliation or unoptimized diffing suffer high cumulative execution times as they repeatedly re-parse and re-diff expanding markdown strings.

### Operation 4: Tool-Calling Execution
* **What it does**: Simulates an autonomous agent reasoning step where the assistant decides to invoke an external tool (`calc_vram_requirement`), serializes JSON arguments, renders an active execution status badge, injects the JSON output, and synthesizes a final analytical response.
* **What it measures**: Complex DOM subtree insertion, nested component updates, and multi-state card transitions.

### Operation 5: Render Large Conversation History
* **What it does**: Instantly injects a heavy 50-turn conversation history into the chat view, comprising multiple markdown tables, code snippets, thinking blocks, and message metadata.
* **What it measures**: Bulk rendering capability and layout thrashing resistance when presenting extensive context windows.

### Operation 6: Agent State Updates Churn
* **What it does**: Triggers 25 consecutive reactive state modifications in rapid succession, modifying metrics such as `tokensGenerated`, `contextTokens`, `tps`, `status`, and `activeTool`.
* **What it measures**: Fine-grained state propagation overhead. Frameworks that batch updates or use direct Signals (e.g., SolidJS) excel here, while frameworks that re-execute broad component render functions suffer degradation.

### Operation 7: IndexedDB Storage I/O
* **What it does**: Opens an IndexedDB object store (`agent_cache`), writes a serialized 64KB model chunk and session checkpoint to disk, reads it back, verifies integrity, and cleans up the transaction.
* **What it measures**: Non-blocking asynchronous I/O coordination while maintaining UI stability.

### Operation 8: UI Response Under Inference
* **What it does**: Dispatches high-frequency simulated keyboard inputs into the prompt input field while heavy background state transitions are ongoing.
* **What it measures**: Main-thread responsiveness and event loop queuing delay under inference pressure.

### Operation 9: Cancellation & Teardown
* **What it does**: Emits an abort signal during active token generation, interrupts stream processing, transitions agent state to `"cancelled"`, and freezes the UI state immediately.
* **What it measures**: Abort controller handling, event cleanup, and immediate UI interruption latency.

### Operation 10: Clear Session & Cleanup
* **What it does**: Clears the conversation array, destroys all chat DOM nodes, resets telemetry indicators, and executes `teardownWasmComputeEngine()` to release WebAssembly linear memory allocations.
* **What it measures**: Garbage collection readiness, node dismount performance, and resistance to retained memory leaks.

---

## 6. Performance Telemetry & Measurement Infrastructure

The benchmark runner ([`run-benchmarks.mjs`](file:///c:/Users/Zakir/Desktop/benchmarks%20of%20frontend/Frontend-Benchmarks/run-benchmarks.mjs)) is an automated Node/Bun harness utilizing Playwright to orchestrate headless Chromium instances.

### 6.1 Accurate Execution Timing (`PerformanceMonitor`)
Rather than relying on rough wall-clock heuristics, all operation durations are recorded via the High Resolution Time API (`performance.now()`):
```typescript
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
```
Timings are logged directly in the client application and extracted from the DOM results table by Playwright once the benchmark sequence signals completion (`h2:has-text("Benchmark Results")`).

### 6.2 Three-Tiered Memory Footprint Profiling
A recurring failure mode in client-side AI applications is unbounded memory growth. The test runner continuously polls the Chromium JavaScript heap using `window.performance.memory` at **150-millisecond intervals**:

1. **Initial Heap (MB)**: Measured immediately after page load and initial model runtime boot. Represents the baseline runtime memory overhead of the framework and core engine.
2. **Peak Heap (MB)**: The maximum memory allocated during the benchmark run (typically reached during Operation 5 when 50 conversation turns and tool calls coexist in DOM and memory).
3. **Retained Memory (MB)**: Measured following Operation 10 (session teardown and DOM purge). Indicates residual references, event listener leaks, and garbage collection resistance.

### 6.3 Bundle Size & Asset Footprint Analysis
The runner scans the production build output directory (`dist/` or `.svelte-kit/output/client`) for each framework, calculating:
* **JavaScript Bundle Size (`jsKb`)**: Raw uncompressed script payload.
* **Gzip Compressed JavaScript (`gzipKb`)**: Actual network transfer size.
* **CSS Payload (`cssKb`)**: Extracted stylesheet size.
* **WebAssembly Asset Size (`wasmKb`)**: Total compiled `.wasm` binary size emitted in the distribution directory.

---

## 7. Results Interpretation & Relative Slowdown Scale

### 7.1 Normalization Methodology
Because raw millisecond timings vary across host CPUs, all framework results are normalized against the **fastest performing framework** for each operation. The fastest framework serves as the baseline:

$$\text{Slowdown Factor} = \frac{\text{Framework Duration (ms)}}{\text{Fastest Framework Duration (ms)}}$$

* A score of **`1.00x`** represents the optimal baseline (0% slowdown).
* A score of **`2.50x`** indicates that the framework required 2.5 times the duration of the fastest framework to complete the identical task.

### 7.2 The Visual Slowdown Spectrum
In [`results.html`](file:///c:/Users/Zakir/Desktop/benchmarks%20of%20frontend/Frontend-Benchmarks/results.html) and [`finalize.html`](file:///c:/Users/Zakir/Desktop/benchmarks%20of%20frontend/Frontend-Benchmarks/finalize.html), results are categorized across a standard performance scale:

| Multiplier Range | Classification | Indicator Color | Interpretation |
| :--- | :--- | :--- | :--- |
| **`1.00x`** | **Fastest Baseline** | Deep Green (`#065f46`) | Optimal speed, zero unnecessary abstraction overhead |
| **`1.01x - 1.25x`** | **Excellent** | Vibrant Green (`#16a34a`) | Negligible framework overhead |
| **`1.26x - 1.50x`** | **Very Good** | Light Green (`#4ade80`) | High efficiency with minor scheduling cost |
| **`1.51x - 2.00x`** | **Good** | Lime (`#84cc16`) | Acceptable responsiveness for interactive chat |
| **`2.01x - 3.00x`** | **Moderate** | Amber / Yellow (`#eab308`) | Noticeable latency during rapid token streaming |
| **`3.01x - 4.50x`** | **Heavy Overhead** | Orange (`#f97316`) | Significant main-thread contention |
| **`> 4.50x`** | **Severe Overhead** | Crimson (`#dc2626`) | High risk of dropped frames and UI lockups |

---

## 8. CLI Usage & Execution Guide

### 8.1 Installation
Install workspace dependencies and ensure the Playwright Chromium browser binary is present:
```bash
# Install root and workspace dependencies using Bun
bun install
```

### 8.2 1-Command Benchmark & Auto-Open Flow
To execute the automated benchmark across all 11 frameworks, detect the host laptop/PC specifications, and immediately open the dashboard in your browser:
```bash
bun start
# or:
bun run bench
```
The test runner autonomously:
1. Detects host hardware via `detect-specs.mjs` (Laptop model, CPU, GPU, NPU, Cores, RAM, Battery, OS).
2. Spawns each framework's build server, measures operations and memory with Playwright Chromium.
3. Generates `benchmark-results.json` and `benchmark-results.md`.
4. Automatically spins up the embedded results server and opens `http://localhost:3333/results.html` in your default browser.

### 8.3 Targeted & Custom Benchmark Runs
The runner supports configurable CLI flags:
```bash
# Benchmark specific frameworks (comma-separated)
bun run bench --frameworks=vanilla,solid,react

# Run multiple iterations per framework for statistical averaging
bun run bench --runs=3

# Run against local development servers instead of production builds
bun run bench --mode=dev

# Customize conversation history density
bun run bench --rows=100

# Custom port or headless (CI) mode without opening browser
bun run bench --port=4000 --no-open
```

### 8.4 Instant Dashboard Viewer (Without Re-running Tests)
To launch the interactive dashboard immediately:
```bash
bun run serve
# or:
bun run viewer
```
Access points:
* **Interactive Dashboard:** `http://localhost:3333/results.html` (or `http://localhost:3333/results`)
* **Research Summary View:** `http://localhost:3333/finalize.html`
* **Raw Artifacts:** Inspect `benchmark-results.json` or `benchmark-results.md`.
