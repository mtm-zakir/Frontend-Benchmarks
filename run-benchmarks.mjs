import { spawn, spawnSync } from "node:child_process";
import { chromium } from "playwright";
import fs from "node:fs/promises";
import fsSync from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import os from "node:os";
import { detectLaptopSpecs } from "./detect-specs.mjs";
import { startResultsServer } from "./serve-results.mjs";

function ensureDependencies() {
  const rootNodeModules = path.join(process.cwd(), "node_modules");
  if (!fsSync.existsSync(rootNodeModules)) {
    console.log("📦 First-time run / new clone detected: installing dependencies with Bun...");
    const res = spawnSync("bun", ["install"], { stdio: "inherit", shell: process.platform === "win32" });
    if (res.status !== 0) {
      console.warn("⚠️ bun install had warnings, continuing with benchmark execution...");
    }
  }
}
ensureDependencies();

let frameworks = [
  "react",
  "vue",
  "angular",
  "solid",
  "svelte",
  "preact",
  "qwik",
  "vanilla",
  "inferno",
  "mithril",
  "lit",
];

let RUNS = 1;
let MODE = "build"; // 'build' or 'dev'
let ROWS = 50;
let AUTO_SERVE = true;
let AUTO_OPEN = true;
let PORT = 3333;

process.argv.slice(2).forEach((arg) => {
  if (arg.startsWith("--runs=")) RUNS = parseInt(arg.split("=")[1], 10);
  if (arg.startsWith("--mode=")) MODE = arg.split("=")[1];
  if (arg.startsWith("--rows=")) ROWS = parseInt(arg.split("=")[1], 10);
  if (arg.startsWith("--port=")) PORT = parseInt(arg.split("=")[1], 10);
  if (arg === "--no-open") AUTO_OPEN = false;
  if (arg === "--no-serve") { AUTO_SERVE = false; AUTO_OPEN = false; }
  if (arg.startsWith("--frameworks=")) {
    frameworks = arg
      .split("=")[1]
      .split(",")
      .map((s) => s.trim().toLowerCase());
  }
});

console.log(
  `\n⚙️  Configuration: Mode=${MODE}, Runs=${RUNS}, Rows=${ROWS}, Frameworks=[${frameworks.join(", ")}]\n`,
);

function getDistDir(fw) {
  const dirs = [
    path.join(fw, "dist", fw, "browser"),
    path.join(fw, "dist", fw),
    path.join(fw, "dist"),
    path.join(fw, ".svelte-kit", "output", "client"),
  ];
  for (const d of dirs) {
    if (fsSync.existsSync(d)) return d;
  }
  return null;
}

function scanBundle(fw) {
  const dir = getDistDir(fw);
  let jsBytes = 0;
  let jsGzipBytes = 0;
  let cssBytes = 0;
  let wasmBytes = 0;
  if (!dir || !fsSync.existsSync(dir)) {
    return { jsKb: 0, gzipKb: 0, cssKb: 0, wasmKb: 0 };
  }

  function walk(curr) {
    try {
      const files = fsSync.readdirSync(curr);
      for (const f of files) {
        const full = path.join(curr, f);
        const stat = fsSync.statSync(full);
        if (stat.isDirectory()) {
          walk(full);
        } else if (f.endsWith(".js") || f.endsWith(".mjs")) {
          const content = fsSync.readFileSync(full);
          jsBytes += content.length;
          jsGzipBytes += zlib.gzipSync(content).length;
        } else if (f.endsWith(".css")) {
          const content = fsSync.readFileSync(full);
          cssBytes += content.length;
        } else if (f.endsWith(".wasm")) {
          const content = fsSync.readFileSync(full);
          wasmBytes += content.length;
        }
      }
    } catch {}
  }
  walk(dir);
  return {
    jsKb: +(jsBytes / 1024).toFixed(2),
    gzipKb: +(jsGzipBytes / 1024).toFixed(2),
    cssKb: +(cssBytes / 1024).toFixed(2),
    wasmKb: +(wasmBytes / 1024).toFixed(2),
  };
}

function waitForUrl(childProcess) {
  return new Promise((resolve) => {
    let buffer = "";
    const onData = (data) => {
      const output = data.toString();
      process.stdout.write(output);
      buffer += output.replace(/\u001b\[[0-9;]*[a-zA-Z]/g, "");
      const match = buffer.match(/http:\/\/(localhost|127\.0\.0\.1):\d+/);
      if (match) resolve(match[0]);
    };
    childProcess.stdout?.on("data", onData);
    childProcess.stderr?.on("data", onData);
  });
}

function killProcess(child) {
  if (!child || !child.pid) return;
  if (process.platform === "win32") {
    try {
      spawn("taskkill", ["/pid", child.pid.toString(), "/f", "/t"]);
    } catch {
      child.kill();
    }
  } else {
    try {
      process.kill(-child.pid);
    } catch {
      child.kill();
    }
  }
}

async function runBenchmarkIteration(url, browser) {
  const context = await browser.newContext();
  const page = await context.newPage();

  page.on("pageerror", (err) => {
    console.error(`   ❌ [Browser Error]: ${err.message}`);
  });

  let peakMemoryMB = 0;
  let initialMemoryMB = 0;
  let retainedMemoryMB = 0;
  let startupMs = 0;

  const memPoller = setInterval(async () => {
    try {
      const m = await page.evaluate(
        () => window.performance?.memory?.usedJSHeapSize,
      );
      if (m) {
        const mb = m / (1024 * 1024);
        if (mb > peakMemoryMB) peakMemoryMB = mb;
      }
    } catch {}
  }, 150);

  const navStart = Date.now();
  await page.goto(`${url}?rows=${ROWS}`);

  try {
    const initMem = await page.evaluate(
      () => window.performance?.memory?.usedJSHeapSize,
    );
    if (initMem) initialMemoryMB = initMem / (1024 * 1024);
  } catch {}

  // Wait for 'Benchmark Results' h2 — timeout after 25s then fall back to partial results
  const BENCH_TIMEOUT = 25_000;
  try {
    await page.waitForSelector('h2:has-text("Benchmark Results")', {
      timeout: BENCH_TIMEOUT,
    });
  } catch {
    console.warn(`   ⚠️ Benchmark did not fully complete within ${BENCH_TIMEOUT / 1000}s — collecting partial results.`);
  }

  clearInterval(memPoller);

  try {
    const retMem = await page.evaluate(
      () => window.performance?.memory?.usedJSHeapSize,
    );
    if (retMem) retainedMemoryMB = retMem / (1024 * 1024);
  } catch {}

  try {
    const nav = await page.evaluate(() => {
      const entry = performance.getEntriesByType("navigation")[0];
      return entry ? entry.domContentLoadedEventEnd - entry.startTime : null;
    });
    startupMs = nav || Date.now() - navStart;
  } catch {
    startupMs = Date.now() - navStart;
  }

  const opsData = await page.evaluate(() => {
    const rows = Array.from(document.querySelectorAll("table tbody tr"));
    return rows
      .map((row) => {
        const cells = row.querySelectorAll("td");
        return {
          action: cells[0]?.innerText.trim(),
          duration: parseFloat(cells[1]?.innerText.trim()) || 0,
        };
      })
      .filter((res) => res.action && res.action !== "Total Time");
  });

  await context.close();
  return {
    ops: opsData,
    metrics: {
      initialMemoryMB: +initialMemoryMB.toFixed(2),
      peakMemoryMB: +Math.max(peakMemoryMB, initialMemoryMB).toFixed(2),
      retainedMemoryMB: +retainedMemoryMB.toFixed(2),
      startupMs: +startupMs.toFixed(2),
    },
  };
}

async function processFramework(framework, browser) {
  console.log(`\n▶️ Starting ${framework}...`);
  const scriptName = MODE === "dev" ? `dev:${framework}` : `start:${framework}`;
  const pm = "bun";

  const child =
    process.platform === "win32"
      ? spawn("cmd.exe", ["/c", `${pm} run ${scriptName}`], {
          cwd: process.cwd(),
        })
      : spawn(pm, ["run", scriptName], {
          cwd: process.cwd(),
          shell: true,
          detached: true,
        });

  try {
    const url = await Promise.race([
      waitForUrl(child),
      new Promise((_, rej) =>
        setTimeout(() => rej(new Error("Server start timeout")), 90000),
      ),
    ]);

    console.log(`   Server running at ${url}. Running ${RUNS} iteration(s)...`);
    // Heartbeat: print a dot every 10 s while the benchmark page loads
    const heartbeat = setInterval(() => process.stdout.write("."), 10_000);
    const allRunsData = [];

    for (let i = 0; i < RUNS; i++) {
      console.log(`   - Run ${i + 1}/${RUNS}...`);
      const data = await runBenchmarkIteration(url, browser);
      allRunsData.push(data);
    }

    clearInterval(heartbeat);
    process.stdout.write("\n");
    console.log(`✅ ${framework} finished.`);
    const opsAvg = calculateAverages(allRunsData.map((r) => r.ops));

    const avgMetrics = {
      startupMs: +(
        allRunsData.reduce((s, r) => s + r.metrics.startupMs, 0) / RUNS
      ).toFixed(2),
      initialMemoryMB: +(
        allRunsData.reduce((s, r) => s + r.metrics.initialMemoryMB, 0) / RUNS
      ).toFixed(2),
      peakMemoryMB: +(
        allRunsData.reduce((s, r) => s + r.metrics.peakMemoryMB, 0) / RUNS
      ).toFixed(2),
      retainedMemoryMB: +(
        allRunsData.reduce((s, r) => s + r.metrics.retainedMemoryMB, 0) / RUNS
      ).toFixed(2),
      bundle: scanBundle(framework),
    };

    return { ops: opsAvg, metrics: avgMetrics };
  } catch (error) {
    console.error(`❌ Error benchmarking ${framework}:`, error.message);
    return null;
  } finally {
    killProcess(child);
  }
}

function calculateAverages(allRunsOps) {
  const aggregated = {};

  allRunsOps.forEach((run) => {
    run.forEach((item) => {
      if (!aggregated[item.action]) aggregated[item.action] = 0;
      aggregated[item.action] += item.duration;
    });
  });

  return Object.keys(aggregated).map((action) => ({
    action,
    duration: +(aggregated[action] / RUNS).toFixed(2),
  }));
}

async function main() {
  let browser;
  try {
    browser = await chromium.launch({ channel: "chrome", headless: true });
  } catch {
    try {
      browser = await chromium.launch({ headless: true });
    } catch {
      console.log("⬇️ Chromium not found. Auto-installing Playwright Chromium...");
      spawnSync("bunx", ["playwright", "install", "chromium"], { stdio: "inherit", shell: process.platform === "win32" });
      browser = await chromium.launch({ headless: true });
    }
  }
  const allResults = {};
  const allMetrics = {};

  for (const fw of frameworks) {
    const result = await processFramework(fw, browser);
    if (result) {
      allResults[fw] = result.ops;
      allMetrics[fw] = result.metrics;
    }
  }

  await browser.close();

  // Load existing data to merge when running subsets
  let mergedResults = {};
  let mergedMetrics = {};
  try {
    const raw = await fs.readFile("benchmark-results.json", "utf-8");
    const parsed = JSON.parse(raw);
    mergedResults = parsed.results || {};
    mergedMetrics = parsed.metrics || {};
  } catch {}

  for (const [fw, ops] of Object.entries(allResults)) {
    mergedResults[fw] = {};
    ops.forEach((r) => {
      mergedResults[fw][r.action] = r.duration;
    });
  }

  for (const [fw, m] of Object.entries(allMetrics)) {
    mergedMetrics[fw] = m;
  }

  // Generate rich Markdown report from merged data
  let markdown = `# OSS-Agent Frontend Framework Benchmark Results\n**Research Study:** Comparative quickness, minimal resource usage, and lean architectural efficiency of JavaScript frameworks for in-browser AI agents.\n**Configuration:** Mode: \`${MODE}\`, Runs per framework: \`${RUNS}\`\n\n`;

  markdown += `## 🤖 AI Agent & Frontend Runtime Operations (Avg ms, lower is better)\n\n`;
  for (const [fw, opsMap] of Object.entries(mergedResults)) {
    markdown += `### ${fw.charAt(0).toUpperCase() + fw.slice(1)}\n\n`;
    markdown += `| Action | Avg Duration (ms) |\n| :--- | :--- |\n`;
    let total = 0;
    for (const [action, duration] of Object.entries(opsMap)) {
      markdown += `| ${action} | ${duration.toFixed(2)} |\n`;
      total += duration;
    }
    markdown += `| **Total Operations Time** | **${total.toFixed(2)}** |\n\n`;
  }

  markdown += `## 💾 System, Memory & Bundle Metrics\n\n`;
  markdown += `| Framework | Startup (ms) | Initial Heap (MB) | Peak Heap (MB) | Retained (MB) | JS Bundle (kB) | Gzip (kB) | WASM (kB) |\n`;
  markdown += `| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |\n`;
  for (const [fw, m] of Object.entries(mergedMetrics)) {
    markdown += `| **${fw}** | ${m.startupMs} | ${m.initialMemoryMB} | ${m.peakMemoryMB} | ${m.retainedMemoryMB} | ${m.bundle?.jsKb || 0} | ${m.bundle?.gzipKb || 0} | ${m.bundle?.wasmKb || 0} |\n`;
  }
  markdown += `\n`;

  await fs.writeFile("benchmark-results.md", markdown);

  const systemSpecs = detectLaptopSpecs();

  const jsonOutput = JSON.stringify(
    {
      config: {
        mode: MODE,
        runs: RUNS,
        suite: "OSS-Agent Frontend Framework Benchmark",
      },
      system: systemSpecs,
      results: mergedResults,
      metrics: mergedMetrics,
    },
    null,
    2,
  );
  await fs.writeFile("benchmark-results.json", jsonOutput);

  console.log(
    "\n🎉 All benchmarks complete! Results saved to benchmark-results.md & benchmark-results.json",
  );

  if (AUTO_SERVE) {
    console.log("🚀 Starting local server and opening interactive results dashboard...");
    await startResultsServer({ port: PORT, open: AUTO_OPEN });
  } else {
    console.log(
      "📊 Open results.html in your browser via: bun run serve (or http://localhost:3333/results.html)",
    );
  }
}

main();
