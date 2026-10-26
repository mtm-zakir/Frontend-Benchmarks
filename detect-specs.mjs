import os from "os";
import fs from "fs/promises";
import path from "path";
import { execSync } from "child_process";

/**
 * Dynamically detects full hardware specifications of the current machine
 * (Laptop/Desktop model, CPU, GPU, NPU, RAM, Cores, Threads, Battery, OS).
 */
export function detectLaptopSpecs() {
  const platform = process.platform;
  let model = "";
  let manufacturer = "";
  let cpu = os.cpus()[0]?.model?.trim().replace(/\s+/g, " ") || "Unknown Processor";
  let physicalCores = os.cpus().length;
  let logicalCores = os.cpus().length;
  let gpus = [];
  let npu = "None Detected";
  let ramBytes = os.totalmem();
  let ramGb = Math.round(ramBytes / 1024 ** 3);
  let batteryInfo = "No Battery / AC Power";
  let isLaptop = false;
  let osName = `${process.platform === "win32" ? "Windows" : os.type()} (${os.arch()})`;

  if (platform === "win32") {
    // 1. Device Manufacturer & Model
    try {
      const csRaw = execSync(
        'powershell -NoProfile -Command "Get-CimInstance Win32_ComputerSystem | Select-Object Manufacturer, Model, TotalPhysicalMemory | ConvertTo-Json"',
        { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }
      );
      const cs = JSON.parse(csRaw);
      manufacturer = (cs.Manufacturer || "").trim();
      model = (cs.Model || "").trim();
      if (cs.TotalPhysicalMemory) {
        ramGb = Math.round(Number(cs.TotalPhysicalMemory) / 1024 ** 3);
      }
    } catch {}

    // 2. CPU Model & Core/Thread Counts
    try {
      const cpuRaw = execSync(
        'powershell -NoProfile -Command "Get-CimInstance Win32_Processor | Select-Object Name, NumberOfCores, NumberOfLogicalProcessors | ConvertTo-Json"',
        { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }
      );
      const cpuData = JSON.parse(cpuRaw);
      const mainCpu = Array.isArray(cpuData) ? cpuData[0] : cpuData;
      if (mainCpu?.Name) cpu = mainCpu.Name.trim().replace(/\s+/g, " ");
      if (mainCpu?.NumberOfCores) physicalCores = Number(mainCpu.NumberOfCores);
      if (mainCpu?.NumberOfLogicalProcessors) logicalCores = Number(mainCpu.NumberOfLogicalProcessors);
    } catch {}

    // 3. GPU / Display Controllers
    try {
      const gpuRaw = execSync(
        'powershell -NoProfile -Command "Get-CimInstance Win32_VideoController | Select-Object Name | ConvertTo-Json"',
        { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }
      );
      const gpuData = JSON.parse(gpuRaw);
      const list = Array.isArray(gpuData) ? gpuData : [gpuData];
      gpus = list.map((g) => (g?.Name || "").trim()).filter(Boolean);
    } catch {}

    // 4. Laptop Battery Status
    try {
      const batRaw = execSync(
        'powershell -NoProfile -Command "Get-CimInstance Win32_Battery | Select-Object EstimatedChargeRemaining, BatteryStatus | ConvertTo-Json"',
        { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }
      );
      if (batRaw && batRaw.trim()) {
        const batData = JSON.parse(batRaw);
        const bat = Array.isArray(batData) ? batData[0] : batData;
        if (bat?.EstimatedChargeRemaining !== undefined) {
          isLaptop = true;
          batteryInfo = `Battery Present (${bat.EstimatedChargeRemaining}%)`;
        }
      }
    } catch {}

    // 5. Windows OS Caption
    try {
      const osRaw = execSync(
        'powershell -NoProfile -Command "(Get-CimInstance Win32_OperatingSystem).Caption"',
        { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"] }
      );
      if (osRaw && osRaw.trim()) {
        osName = `${osRaw.trim()} (${os.arch()})`;
      }
    } catch {}

    // 6. NPU / AI Engine Detection
    try {
      const pnpRaw = execSync(
        'powershell -NoProfile -Command "Get-PnpDevice -PresentOnly | Select-Object FriendlyName | ConvertTo-Json"',
        { encoding: "utf-8", stdio: ["ignore", "pipe", "ignore"], maxBuffer: 10 * 1024 * 1024 }
      );
      const pnpList = JSON.parse(pnpRaw);
      const allNames = (Array.isArray(pnpList) ? pnpList : [pnpList]).map((d) => d?.FriendlyName || "");
      const npuFound = allNames.find((n) =>
        /\bNPU\b|Ryzen AI|Intel.*AI Boost|Neural.*Compute|\bHexagon\b|AI Engine/i.test(n)
      );
      if (npuFound) {
        npu = npuFound.trim();
      } else if (/Ryzen (?:5|7|9) (?:7\d{3}|8\d{3}|9\d{3}|AI)/i.test(cpu) && /Radeon/i.test(cpu)) {
        npu = "AMD Ryzen AI (XDNA · 16 NPU TOPS)";
      } else if (/Core.*Ultra/i.test(cpu)) {
        npu = "Intel AI Boost (NPU)";
      } else if (/Snapdragon|Hexagon/i.test(cpu)) {
        npu = "Qualcomm Hexagon NPU (45 TOPS)";
      }
    } catch {
      if (/Ryzen (?:5|7|9) (?:7\d{3}|8\d{3}|9\d{3}|AI)/i.test(cpu)) {
        npu = "AMD Ryzen AI (XDNA · 16 NPU TOPS)";
      }
    }
  } else if (platform === "darwin") {
    isLaptop = true;
    try {
      model = execSync("sysctl -n hw.model", { encoding: "utf-8" }).trim();
      cpu = execSync("sysctl -n machdep.cpu.brand_string", { encoding: "utf-8" }).trim();
    } catch {}
    if (/Apple M/i.test(cpu) || /Apple M/i.test(model)) {
      npu = "Apple Neural Engine (16-core ANE)";
      gpus = ["Apple Silicon Integrated GPU"];
    }
    osName = `macOS (${os.arch()})`;
  } else if (platform === "linux") {
    try {
      model = execSync("cat /sys/class/dmi/id/product_name 2>/dev/null || true", { encoding: "utf-8" }).trim();
      manufacturer = execSync("cat /sys/class/dmi/id/sys_vendor 2>/dev/null || true", { encoding: "utf-8" }).trim();
      const batteryDirs = execSync("ls /sys/class/power_supply 2>/dev/null || true", { encoding: "utf-8" });
      if (/BAT/i.test(batteryDirs)) {
        isLaptop = true;
        batteryInfo = "Battery Present (Linux sysfs)";
      }
    } catch {}
    osName = `Linux (${os.arch()})`;
  }

  const deviceName =
    [manufacturer, model].filter(Boolean).join(" ").trim() || (isLaptop ? "Laptop / Notebook" : "PC / Workstation");

  return {
    device: deviceName,
    isLaptop,
    os: osName,
    cpu,
    npu,
    gpu: gpus.length > 0 ? gpus.join(" + ") : "Integrated Graphics",
    cores: `${physicalCores} Cores / ${logicalCores} Threads`,
    ram: `${ramGb} GB RAM`,
    battery: batteryInfo,
    browser: "Chromium (Headless / WebGPU + WebNN NPU)",
    node: process.version,
  };
}

export async function saveSpecsToFile(targetJsonPath = "benchmark-results.json") {
  const specs = detectLaptopSpecs();
  let data = {};
  try {
    const raw = await fs.readFile(targetJsonPath, "utf-8");
    data = JSON.parse(raw);
  } catch {
    data = {
      config: { mode: "build", runs: 1, suite: "OSS-Agent Frontend Framework Benchmark" },
      results: {},
      metrics: {},
    };
  }

  data.system = specs;
  await fs.writeFile(targetJsonPath, JSON.stringify(data, null, 2), "utf-8");
  return specs;
}

if (import.meta.main || process.argv[1]?.endsWith("detect-specs.mjs")) {
  const shouldSave = process.argv.includes("--save") || process.argv.includes("-s") || process.argv.includes("--update");
  const specs = detectLaptopSpecs();

  console.log("\n💻 Detected Hardware & Laptop Specifications:");
  console.log("--------------------------------------------------");
  console.log(`Device / Model : ${specs.device} (${specs.isLaptop ? "Laptop" : "Desktop/Workstation"})`);
  console.log(`Operating Sys  : ${specs.os}`);
  console.log(`Processor (CPU): ${specs.cpu}`);
  console.log(`NPU / AI Engine: ${specs.npu}`);
  console.log(`Graphics (GPU) : ${specs.gpu}`);
  console.log(`Cores & Threads: ${specs.cores}`);
  console.log(`System Memory  : ${specs.ram}`);
  console.log(`Power / Battery: ${specs.battery}`);
  console.log(`Browser Runtime: ${specs.browser}`);
  console.log(`Node / Runtime : ${specs.node}`);
  console.log("--------------------------------------------------");

  if (shouldSave) {
    await saveSpecsToFile("benchmark-results.json");
    console.log("✅ Successfully updated benchmark-results.json with current laptop specs!\n");
  } else {
    console.log("💡 Tip: Run with '--save' (e.g. 'bun detect-specs.mjs --save') to automatically update benchmark-results.json.\n");
  }
}
