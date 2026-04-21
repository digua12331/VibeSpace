@echo off
chcp 65001 >nul
setlocal
cd /d "%~dp0"

echo ========================================
echo   VibeSpace - AI monitor dashboard launcher
echo ========================================
echo.

if not exist node_modules (
  echo [VibeSpace] node_modules not found - running first-time setup ...
  call pnpm install
  if errorlevel 1 (
    echo [VibeSpace] pnpm install failed. Press any key to exit.
    pause >nul
    exit /b 1
  )
  echo [VibeSpace] rebuilding native modules for Windows ...
  call pnpm --filter @aimon/server rebuild @homebridge/node-pty-prebuilt-multiarch better-sqlite3
)

echo [VibeSpace] cleaning any stale listeners on 8787 / 8788 ...
for %%P in (8787 8788) do (
  for /f "tokens=5" %%A in ('netstat -ano ^| findstr "LISTENING" ^| findstr ":%%P "') do (
    echo [VibeSpace]   killing PID %%A on port %%P
    taskkill /F /PID %%A >nul 2>&1
  )
)

echo [VibeSpace] scheduling browser open on http://127.0.0.1:8788 (in 6s) ...
start "" /b powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep 6; Start-Process 'http://127.0.0.1:8788'"

echo [VibeSpace] starting server (8787) + web (8788) in this window ...
echo [VibeSpace] press Ctrl+C once to stop everything.
echo ----------------------------------------
echo.

call pnpm dev:all

echo.
echo ----------------------------------------
echo [VibeSpace] services stopped. press any key to close.
pause >nul
endlocal
