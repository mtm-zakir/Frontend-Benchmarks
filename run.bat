@echo off
REM OSS-Agent Frontend Framework Benchmark - One-Click Launcher for Windows
echo.
echo ======================================================
echo  OSS-Agent Frontend Framework Benchmark Suite
echo ======================================================
echo.

WHERE bun >nul 2>nul
IF %ERRORLEVEL% NEQ 0 (
  echo [ERROR] Bun is not detected in your PATH.
  echo Please install Bun first: powershell -c "irm bun.sh/install.ps1 | iex"
  pause
  exit /b 1
)

bun run-benchmarks.mjs %*
