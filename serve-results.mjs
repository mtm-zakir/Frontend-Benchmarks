import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".htm": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".wasm": "application/wasm",
  ".md": "text/markdown; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

/**
 * Cross-platform helper to launch the default system browser.
 */
export function openBrowser(url) {
  try {
    const platform = process.platform;
    if (platform === "win32") {
      spawn("cmd.exe", ["/c", "start", "", url], { detached: true, stdio: "ignore" }).unref();
    } else if (platform === "darwin") {
      spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
    } else {
      spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
    }
  } catch (err) {
    console.warn(`Could not automatically open browser: ${err.message}`);
  }
}

/**
 * Starts a lightweight zero-dependency static server serving the repository root.
 */
export function startResultsServer(options = {}) {
  const desiredPort = options.port || 3333;
  const rootDir = options.rootDir || process.cwd();
  const shouldOpen = options.open !== false;
  const pagePath = options.page || "/results.html";

  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      // Normalize requested URL path
      let parsedUrl = new URL(req.url, `http://${req.headers.host || "localhost"}`);
      let pathname = decodeURIComponent(parsedUrl.pathname);

      // Clean URL aliases
      if (pathname === "/" || pathname === "/results") {
        pathname = "/results.html";
      } else if (pathname === "/viewer" || pathname === "/benchmark-viewer") {
        pathname = "/benchmark-viewer.html";
      } else if (pathname === "/finalize") {
        pathname = "/finalize.html";
      }

      const filePath = path.join(rootDir, pathname);

      // Security check: ensure path is within rootDir
      if (!filePath.startsWith(rootDir)) {
        res.writeHead(403, { "Content-Type": "text/plain" });
        res.end("403 Forbidden");
        return;
      }

      fs.stat(filePath, (err, stats) => {
        if (err || !stats.isFile()) {
          res.writeHead(404, { "Content-Type": "text/plain" });
          res.end("404 Not Found");
          return;
        }

        const ext = path.extname(filePath).toLowerCase();
        const contentType = MIME_TYPES[ext] || "application/octet-stream";

        res.writeHead(200, {
          "Content-Type": contentType,
          "Access-Control-Allow-Origin": "*",
          "Cache-Control": "no-cache, no-store, must-revalidate",
        });

        const stream = fs.createReadStream(filePath);
        stream.pipe(res);
      });
    });

    server.on("error", (err) => {
      if (err.code === "EADDRINUSE") {
        console.warn(`⚠️ Port ${desiredPort} is in use, trying ${desiredPort + 1}...`);
        startResultsServer({ ...options, port: desiredPort + 1 }).then(resolve, reject);
      } else {
        reject(err);
      }
    });

    server.listen(desiredPort, () => {
      const activePort = server.address().port;
      const targetUrl = `http://localhost:${activePort}${pagePath.startsWith("/") ? pagePath : "/" + pagePath}`;

      console.log(`\n======================================================`);
      console.log(`🌐 Interactive Benchmark Dashboard Live`);
      console.log(`👉 URL: ${targetUrl}`);
      console.log(`   (Also available at: http://localhost:${activePort}/results)`);
      console.log(`======================================================\n`);

      if (shouldOpen) {
        console.log(`🚀 Opening ${targetUrl} in your default browser...\n`);
        openBrowser(targetUrl);
      }

      console.log(`   Press Ctrl+C to stop the server.\n`);

      // Graceful shutdown on SIGINT / SIGTERM
      const shutdown = () => {
        console.log("\n🛑 Benchmark dashboard server stopped.");
        server.close(() => process.exit(0));
      };
      process.once("SIGINT", shutdown);
      process.once("SIGTERM", shutdown);

      resolve({ server, port: activePort, url: targetUrl });
    });
  });
}

// CLI direct execution
if (import.meta.main || process.argv[1]?.endsWith("serve-results.mjs")) {
  let port = 3333;
  let open = true;
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--port=")) port = parseInt(arg.split("=")[1], 10);
    if (arg === "--no-open") open = false;
  }
  startResultsServer({ port, open }).catch((err) => {
    console.error("Failed to start server:", err);
    process.exit(1);
  });
}
