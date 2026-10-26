# OSS-Agent Frontend Framework Benchmark &middot; Research Suite

A high-performance research benchmark evaluating **11 frontend frameworks** executing client-side OSS-Agent workloads powered by **WebAssembly (WASM)** linear memory kernels, **ONNX Runtime Web (`onnxruntime-web`)**, and **Hugging Face Transformers.js (`@huggingface/transformers`)**, measuring real-time token streaming, reactive UI state churn, autonomous tool-calling loops, and memory efficiency under heavy inference pressure.

> 📖 **Comprehensive Architecture & Logic Guide:** See [`SYSTEM_ARCHITECTURE_AND_LOGIC.md`](./SYSTEM_ARCHITECTURE_AND_LOGIC.md) for full engineering specifications, WASM memory models, runtime operations, and measurement methodology.

---

## Supported Frameworks

- **Vanilla JS** (imperative DOM baseline)
- **React 19**
- **Vue 3**
- **SolidJS**
- **Svelte 5**
- **Preact**
- **Inferno**
- **Lit**
- **Mithril**
- **Qwik**
- **Angular 19**

---

## ⚡ WebAssembly (WASM) & AI Runtime Architecture

The benchmark features real browser WebAssembly and AI runtime integrations:
- **WebAssembly Linear Memory**: Allocates growable 64KB memory pages (`WebAssembly.Memory`, 2 MB to 16 MB) isolated from the JavaScript heap.
- **Compiled WASM Kernels**: Direct in-browser JIT compilation of WebAssembly bytecode executing vector dot-product and tensor warmups.
- **ONNX Runtime Web Integration**: Hardware-accelerated execution providers (WASM SIMD, WebGPU, and Multi-threaded workers via SharedArrayBuffer).
- **Hugging Face Transformers.js**: In-browser transformer pipelines with local ONNX model caching and tokenization.

---

## 10 Benchmarked OSS-Agent Operations

1. **Model & Runtime Init (WASM)**: Real WebAssembly compilation, linear memory page allocation (2 MB+), vector dot-product kernel warmup, and baseline memory reservation.
2. **First Token Latency (TTFT)**: WebAssembly tensor projection, context ingestion, prompt evaluation, and time to first token emitted.
3. **Token Streaming & Render (TPS)**: High-frequency markdown token stream (150 tokens) and continuous DOM re-rendering.
4. **Tool-Calling Execution**: Autonomous reasoning turn, tool parameter emission, DOM tool badge creation, and execution result injection.
5. **Render Large Conversation**: Heavy multi-turn context rendering (50-turn conversation with code blocks and thinking traces).
6. **Agent State Updates**: Continuous reactive state churn (context tokens, TPS counters, runtime status changes).
7. **IndexedDB Storage I/O**: Session persistence, prompt caching, and serialized chat history disk commit.
8. **UI Response Under Inference**: Keydown/input latency and UI event handling while background inference is active.
9. **Cancellation & Teardown**: User abort signal handling, stream interruption, worker reset, and immediate UI freeze.
10. **Clear Session & Cleanup**: WebAssembly memory teardown, complete DOM thread purge, chat memory garbage collection, and state reset.

---

## Memory Usage Metrics (All 11 Frameworks)

Every benchmark run continuously monitors JavaScript heap memory allocations using `performance.memory` at 150ms polling intervals:

- **Initial Heap (MB)**: Baseline memory footprint upon worker spawn and initial model prompt ingestion.
- **Peak Heap (MB)**: Maximum memory allocated during heavy token streaming, 50-turn conversational history rendering, and tool execution.
- **Retained Memory (MB)**: Memory still retained in the JS heap after session teardown and DOM cleanup (measures memory leak resistance).

---

## Understanding the "Slowdown vs Fastest" Scale

In the results table and viewer, performance is normalized against the fastest framework for each operation:

| Scale Value | Meaning | Color | Status |
| :--- | :--- | :--- | :--- |
| **`1.0x` (or `×1.00`)** | **Fastest Framework** | Dark Green | **Reference Baseline** (0% slowdown) |
| **`×1.20`** | 20% slower than fastest | Green | Excellent |
| **`×1.45`** | 45% slower than fastest | Light Green | Very Good |
| **`×1.80`** | 80% slower than fastest | Lime | Good |
| **`×2.30`** | 2.3× slower than fastest | Yellow | Moderate |
| **`×3.00`** | 3.0× slower than fastest | Orange | Noticeable Overhead |
| **`×4.00`** | 4.0× slower than fastest | Red | Heavy Overhead |
| **`×6.00`** | 6.0× slower than fastest | Dark Red | Severe Overhead |
| **`>6.0x`** | **Slowest Framework** | Deep Crimson | **Maximum Overhead** (6×+ slower) |

- **Fastest**: The lowest number (`1.0x` / `1.00x`) represents the top-performing framework.
- **Slowest**: The highest number (`>6.0x`) represents the framework with the greatest execution delay or overhead.

---

## Prerequisites

- **Bun**: `v1.2+` or `v1.4+` (Installed and set as default runtime)
- **Chromium / Playwright**: For automated headless browser execution

---

---

## ⚡ Quick Start: 1-Command Benchmark & Auto-Open

When cloning this repository on any new PC or laptop, you can execute the entire benchmark suite and view results in **one single command**:

```bash
# Clone the repository
git clone <repository-url>
cd Frontend-Benchmarks

# Run all benchmarks & immediately open the interactive dashboard in your browser
bun start
```

> **What happens automatically in one command:**
> 1. **Auto-Dependency Check:** If dependencies or Playwright Chromium are not yet installed on this PC, it installs them automatically.
> 2. **Laptop Spec Auto-Detection:** Automatically queries and records the current machine's exact laptop model, CPU, GPU, NPU, Cores/Threads, RAM, OS, and battery status.
> 3. **Autonomous Benchmark Execution:** Builds and benchmarks all 11 frameworks with live memory and TTFT metrics.
> 4. **Instant Dashboard Launch:** Automatically spins up the local server and **immediately opens `http://localhost:3333/results.html` in your default browser**!

---

### One-Click Launchers (No Typing Required)

For convenience on new machines:
* **Windows:** Double-click [`run.bat`](file:///c:/Users/Zakir/Desktop/benchmarks%20of%20frontend/Frontend-Benchmarks/run.bat) or run `.\run.bat` in Command Prompt / PowerShell.
* **macOS / Linux:** Run `./run.sh` in your terminal.

---

## 🚀 Running Benchmarks

You can run benchmarks using any of the following equivalent commands:

```bash
# Standard 1-command runs (runs all 11 frameworks & opens browser when complete)
bun start
# or:
bun run bench
# or:
bun run benchmark
```

### Custom & Targeted Runs

Pass command-line flags to customize your test session:

```bash
# Run on specific frameworks only
bun run bench --frameworks=react,solid,vanilla

# Run multiple iterations for statistical averaging
bun run bench --runs=3

# Run against local development servers instead of production preview bundles
bun run bench --mode=dev --frameworks=vue,svelte

# Custom port or headless (CI) mode without opening browser
bun run bench --port=4000 --no-open

# Combine flags
bun run bench --frameworks=solid,svelte,vanilla --runs=3 --mode=build
```

### Available CLI Flags

| Flag | Default | Description |
| :--- | :--- | :--- |
| `--frameworks=<list>` | `all 11` | Comma-separated list (`react,vue,angular,solid,svelte,preact,qwik,vanilla,inferno,mithril,lit`) |
| `--runs=<number>` | `1` | Number of test runs per framework to average |
| `--mode=<build\|dev>` | `build` | Test mode: `build` (production bundle preview) or `dev` (dev server) |
| `--port=<number>` | `3333` | Port for the interactive results viewer |
| `--no-open` | `false` | Start server but do not automatically open default browser |
| `--no-serve` | `false` | Run benchmarks and save results without starting the web server (ideal for CI) |

---

## 💻 Hardware & Laptop Specification Engine

The benchmark suite includes an auto-detection engine that reads all laptop specifications (Laptop brand & model, CPU, GPU, NPU, physical/logical cores, RAM, battery/power status, OS):

```bash
# Preview all detected hardware specs for your current laptop / PC:
bun run detect-specs

# Update benchmark-results.json with your current laptop specs (without re-running all tests):
bun run update-specs
```

Whenever you run `bun start` or `bun run bench`, all hardware specs are also automatically detected and saved into `benchmark-results.json` and `benchmark-results.md`.

---

## 🌐 Instant Results Dashboard Viewer

If you already have benchmark results and just want to inspect the interactive dashboard **without re-running benchmarks**:

```bash
bun run serve
# or:
bun run viewer
```

This immediately starts the local server and opens:
* **Interactive Dashboard:** `http://localhost:3333/results.html` (or `http://localhost:3333/results`)
* **Alternative Viewer:** `http://localhost:3333/benchmark-viewer.html`
* **Research Finalize Summary:** `http://localhost:3333/finalize.html`

---

## Running Individual Framework Apps (Interactive Mode)

You can launch and interact with any individual framework implementation directly in your browser using **Bun**:

### Development Servers

| Framework | Command | Local URL |
| :--- | :--- | :--- |
| **Vanilla JS** | `bun run dev:vanilla` | `http://localhost:5173` |
| **React** | `bun run dev:react` | `http://localhost:5173` |
| **Vue** | `bun run dev:vue` | `http://localhost:5173` |
| **SolidJS** | `bun run dev:solid` | `http://localhost:5173` |
| **Svelte** | `bun run dev:svelte` | `http://localhost:5173` |
| **Preact** | `bun run dev:preact` | `http://localhost:5173` |
| **Inferno** | `bun run dev:inferno` | `http://localhost:5173` |
| **Lit** | `bun run dev:lit` | `http://localhost:5173` |
| **Mithril** | `bun run dev:mithril` | `http://localhost:5173` |
| **Qwik** | `bun run dev:qwik` | `http://localhost:5173` |
| **Angular** | `bun run dev:angular` | `http://localhost:4200` |

### Production Preview Builds

To build and preview a production-minified bundle locally:

```bash
bun run start:react
bun run start:vue
bun run start:solid
bun run start:svelte
bun run start:vanilla
# (or start:preact, start:inferno, start:mithril, start:lit, start:qwik, start:angular)
```

---

## Project Structure

```text
├── shared-config/           # Shared OSS-Agent simulation, types, timings & compact CSS
│   ├── index.ts             # 10 benchmark operations, mock engines & dynamic SYSTEM_SPECS
│   └── agent-style.css      # Compact UI styles and Inter typography
├── run-benchmarks.mjs       # Playwright automation harness & metric collector (Bun-powered)
├── results.html             # Interactive HTML results visualizer & research findings
├── finalize.html            # Finalize: Cross-Device Benchmark Comparison & fleet showcase
├── benchmark-viewer.html    # Alias for results.html
├── benchmark-results.json   # Machine-readable output metrics & memory heaps
├── benchmark-results.md     # Markdown table output
├── vanilla/                 # Vanilla JS implementation
├── react/                   # React 19 implementation
├── vue/                     # Vue 3 implementation
├── solid/                   # SolidJS implementation
├── svelte/                  # Svelte 5 implementation
├── preact/                  # Preact implementation
├── inferno/                 # Inferno implementation
├── mithril/                 # Mithril implementation
├── lit/                     # Lit implementation
├── qwik/                    # Qwik implementation
└── angular/                 # Angular 19 implementation
```
