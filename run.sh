#!/usr/bin/env bash
# OSS-Agent Frontend Framework Benchmark - One-Click Launcher for macOS & Linux
set -e

echo ""
echo "======================================================"
echo " OSS-Agent Frontend Framework Benchmark Suite"
echo "======================================================"
echo ""

if ! command -v bun &> /dev/null; then
  echo "[ERROR] Bun is not detected in your PATH."
  echo "Please install Bun: curl -fsSL https://bun.sh/install | bash"
  exit 1
fi

bun run-benchmarks.mjs "$@"
