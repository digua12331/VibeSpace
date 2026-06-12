@echo off
chcp 65001 >nul
setlocal EnableDelayedExpansion
cd /d "%~dp0"

echo ========================================
echo   VibeSpace - AI monitor dashboard launcher
echo ========================================
echo.

REM --- identity: path containing "stable" -> stable instance, else dev instance ---
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

REM project root without the trailing backslash (a trailing \" breaks
REM powershell argument parsing) + pid file recording the owner console.
REM NOTE: keep this file ASCII -- cmd mis-parses non-ASCII chars in .bat.
set "VIBE_ROOT=%~dp0"
if "!VIBE_ROOT:~-1!"=="\" set "VIBE_ROOT=!VIBE_ROOT:~0,-1!"
set "VIBE_PIDFILE=!VIBE_ROOT!\.vibespace\start-bat.pid"

echo [VibeSpace] cleaning processes left over from the previous run ...
REM WMI-free cleanup (Get-CimInstance Win32_Process times out on this
REM machine, so the old command-line-matching kill silently did nothing).
REM start-cleanup.ps1 kills the previous run's whole process tree via the
REM pid file + a Toolhelp snapshot, then records THIS console as the new
REM owner. Runs BEFORE pnpm install: stale processes hold file locks
REM (esbuild.exe, conpty.node) that make install/rebuild fail.
powershell -NoProfile -ExecutionPolicy Bypass -File "!VIBE_ROOT!\scripts\start-cleanup.ps1" -Root "!VIBE_ROOT!" -PidFile "!VIBE_PIDFILE!"

echo [VibeSpace] cleaning any stale listeners on !VIBE_BACKEND! / !VIBE_WEB! ...
for %%P in (!VIBE_BACKEND! !VIBE_WEB!) do (
  for /f "tokens=5" %%A in ('netstat -ano ^| findstr "LISTENING" ^| findstr ":%%P "') do (
    echo [VibeSpace]   killing PID %%A on port %%P
    taskkill /F /T /PID %%A >nul 2>&1
  )
)

REM small delay so Windows releases file locks / sockets
powershell -NoProfile -Command "Start-Sleep -Milliseconds 800" >nul 2>&1

echo [VibeSpace] running pnpm install (refresh workspace symlinks) ...
call pnpm install
if errorlevel 1 (
  echo [VibeSpace] pnpm install failed. Press any key to exit.
  pause >nul
  exit /b 1
)

REM Rebuild native modules when the better-sqlite3 .node binding is missing
REM (covers fresh install, Node ABI upgrade, pnpm cache wipe, cross-machine sync).
REM MUST run AFTER killing old instances + the delay above: a still-running
REM VibeSpace holds node-pty's conpty.node open, and rebuilding it then fails
REM with EBUSY (resource busy / locked).
set "BSQLITE_BIN_FOUND="
for /f "delims=" %%F in ('dir /s /b "node_modules\.pnpm\better-sqlite3@*\node_modules\better-sqlite3\build\Release\better_sqlite3.node" 2^>nul') do set "BSQLITE_BIN_FOUND=1"
if not defined BSQLITE_BIN_FOUND (
  echo [VibeSpace] rebuilding native modules for Windows ^(better-sqlite3 binding missing^) ...
  call pnpm --filter @aimon/server rebuild @homebridge/node-pty-prebuilt-multiarch better-sqlite3
)

echo [VibeSpace] scheduling browser open on http://127.0.0.1:!VIBE_WEB! (in 6s) ...
start "" /b powershell -NoProfile -WindowStyle Hidden -Command "Start-Sleep 6; Start-Process 'http://127.0.0.1:!VIBE_WEB!'"

echo [VibeSpace] starting server (!VIBE_BACKEND!) + web (!VIBE_WEB!) via pnpm !VIBE_SCRIPT! ...
echo [VibeSpace] press Ctrl+C once to stop everything.
echo ----------------------------------------
echo.

call pnpm !VIBE_SCRIPT!

REM if a newer start.bat run has taken over the pid file, this window is a
REM leftover whose services were just killed -- close it silently instead
REM of leaving a stale "press any key" window behind. exit /b only ends the
REM script, so an interactive terminal the user typed start.bat into stays open.
powershell -NoProfile -ExecutionPolicy Bypass -File "!VIBE_ROOT!\scripts\start-cleanup.ps1" -Root "!VIBE_ROOT!" -PidFile "!VIBE_PIDFILE!" -CheckOwner
if errorlevel 1 exit /b 0

echo.
echo ----------------------------------------
echo [VibeSpace] services stopped. press any key to close.
pause >nul
endlocal
