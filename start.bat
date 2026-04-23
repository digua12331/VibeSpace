@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
cd /d "%~dp0"

echo ========================================
echo   VibeSpace - AI monitor dashboard launcher
echo ========================================
echo.

REM --- identity: path containing "stable" -> stable副本, else dev副本 ---
echo %~dp0 | findstr /I "stable" >nul
if errorlevel 1 (
  set VIBE_ID=dev
  set VIBE_BACKEND=9787
  set VIBE_WEB=9788
  set VIBE_SCRIPT=dev:alt
) else (
  set VIBE_ID=stable
  set VIBE_BACKEND=8787
  set VIBE_WEB=8788
  set VIBE_SCRIPT=dev:all
  set VITE_AIMON_INSTANCE_LABEL=稳定
)
echo [VibeSpace] identity=!VIBE_ID!  backend=!VIBE_BACKEND!  web=!VIBE_WEB!  script=!VIBE_SCRIPT!
echo [VibeSpace] project root: %~dp0
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

echo [VibeSpace] cleaning residual node processes under this project ...
powershell -NoProfile -ExecutionPolicy Bypass -Command ^
  "$root = '%~dp0'.TrimEnd('\');" ^
  "$pattern = [regex]::Escape($root);" ^
  "$toKill = @{};" ^
  "$victims = Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match $pattern };" ^
  "foreach ($v in $victims) {" ^
  "  $cur = $v;" ^
  "  while ($true) {" ^
  "    $toKill[[int]$cur.ProcessId] = $true;" ^
  "    if (-not $cur.ParentProcessId) { break };" ^
  "    $parent = Get-CimInstance Win32_Process -Filter \"ProcessId=$($cur.ParentProcessId)\" -ErrorAction SilentlyContinue;" ^
  "    if (-not $parent -or $parent.Name -ne 'node.exe') { break };" ^
  "    $cur = $parent" ^
  "  }" ^
  "};" ^
  "if ($toKill.Count -gt 0) { Write-Host ('[VibeSpace]   killing node PIDs: ' + ($toKill.Keys -join ', ')) };" ^
  "foreach ($procId in $toKill.Keys) { Stop-Process -Id $procId -Force -ErrorAction SilentlyContinue }"

echo [VibeSpace] cleaning any stale listeners on !VIBE_BACKEND! / !VIBE_WEB! ...
for %%P in (!VIBE_BACKEND! !VIBE_WEB!) do (
  for /f "tokens=5" %%A in ('netstat -ano ^| findstr "LISTENING" ^| findstr ":%%P "') do (
    echo [VibeSpace]   killing PID %%A on port %%P
    taskkill /F /PID %%A >nul 2>&1
  )
)

REM small delay so Windows releases file locks / sockets
powershell -NoProfile -Command "Start-Sleep -Milliseconds 800" >nul 2>&1

echo [VibeSpace] scheduling browser open on http://127.0.0.1:!VIBE_WEB! (in 6s) ...
start "" /b powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep 6; Start-Process 'http://127.0.0.1:!VIBE_WEB!'"

echo [VibeSpace] starting server (!VIBE_BACKEND!) + web (!VIBE_WEB!) via pnpm !VIBE_SCRIPT! ...
echo [VibeSpace] press Ctrl+C once to stop everything.
echo ----------------------------------------
echo.

call pnpm !VIBE_SCRIPT!

echo.
echo ----------------------------------------
echo [VibeSpace] services stopped. press any key to close.
pause >nul
endlocal
