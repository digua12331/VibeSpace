@echo off
setlocal EnableDelayedExpansion

REM ============================================================
REM init-stable.bat [stable_dir]
REM Clone the current dev repo to a stable dir and bring it to
REM a runnable state (install + rebuild + build). Resolves the
REM stable dir via: CLI arg > env AIMON_STABLE_DIR > sibling
REM auto-detect (e.g. AIkanban-main -> ../AIkanban-stable).
REM Checks out the latest stable-* tag (if any); falls back to
REM the cloned HEAD otherwise.
REM Idempotent: refuses to overwrite an existing stable dir.
REM ============================================================

set DEV_DIR=%~dp0
if "%DEV_DIR:~-1%"=="\" set DEV_DIR=%DEV_DIR:~0,-1%

REM --- resolve STABLE_DIR: CLI arg > env AIMON_STABLE_DIR > sibling auto-detect ---
REM   sibling rule: <parent>\<basename(DEV) with -main/-dev replaced by -stable, else +-stable>
set "STABLE_DIR="
set "STABLE_SOURCE="
if not "%~1"=="" (
  set "STABLE_DIR=%~1"
  set "STABLE_SOURCE=CLI arg"
)
if not defined STABLE_DIR if defined AIMON_STABLE_DIR (
  set "STABLE_DIR=%AIMON_STABLE_DIR%"
  set "STABLE_SOURCE=env AIMON_STABLE_DIR"
)
if not defined STABLE_DIR (
  for %%I in ("%DEV_DIR%") do (
    set "DEV_NAME=%%~nxI"
    set "DEV_PARENT=%%~dpI"
  )
  if "!DEV_PARENT:~-1!"=="\" set "DEV_PARENT=!DEV_PARENT:~0,-1!"
  set "DERIVED="
  if "!DEV_NAME:~-5!"=="-main"  set "DERIVED=!DEV_NAME:~0,-5!-stable"
  if not defined DERIVED if "!DEV_NAME:~-4!"=="-dev" set "DERIVED=!DEV_NAME:~0,-4!-stable"
  if not defined DERIVED set "DERIVED=!DEV_NAME!-stable"
  set "STABLE_DIR=!DEV_PARENT!\!DERIVED!"
  set "STABLE_SOURCE=sibling auto-detect"
)
REM normalize to absolute path
for %%I in ("!STABLE_DIR!") do set "STABLE_DIR=%%~fI"

echo [init] DEV    = %DEV_DIR%
echo [init] STABLE = %STABLE_DIR%  ^(via %STABLE_SOURCE%^)
echo.

REM --- preflight: required tools on PATH ---
where git >nul 2>nul
if errorlevel 1 (
  echo [init] ERROR: 'git' not found on PATH.
  exit /b 1
)
where pnpm >nul 2>nul
if errorlevel 1 (
  echo [init] ERROR: 'pnpm' not found on PATH.
  exit /b 1
)

REM --- Step 1: stable must not exist ---
if exist "%STABLE_DIR%" (
  echo [init] ERROR: STABLE_DIR already exists: %STABLE_DIR%
  echo [init] Remove it manually for a fresh init, or pick a different path:
  echo [init]   init-stable.bat ^<stable_dir^>
  echo [init]   set AIMON_STABLE_DIR=^<stable_dir^> ^&^& init-stable.bat
  exit /b 1
)

REM --- Step 2: dev must be a git repo ---
if not exist "%DEV_DIR%\.git" (
  echo [init] ERROR: dev is not a git repo: %DEV_DIR%
  exit /b 1
)

REM --- Step 3: git clone (tags come along by default) ---
echo [init] cloning dev to stable...
git clone "%DEV_DIR%" "%STABLE_DIR%"
if errorlevel 1 goto :fail

pushd "%STABLE_DIR%" >nul
if errorlevel 1 goto :fail

REM --- Step 4: checkout latest stable-* tag (fallback: stay on HEAD) ---
set TARGET_REF=
for /f "tokens=*" %%t in ('git tag -l "stable-*" --sort^=-creatordate') do (
  if not defined TARGET_REF set TARGET_REF=%%t
)
if defined TARGET_REF (
  echo [init] checking out latest stable tag: !TARGET_REF!
  git checkout !TARGET_REF!
  if errorlevel 1 goto :fail
) else (
  echo [init] no stable-* tag found in dev; staying on cloned HEAD.
)

REM --- Step 5: pnpm install ---
echo [init] pnpm install...
call pnpm install
if errorlevel 1 goto :fail

REM --- Step 6: rebuild native modules ---
echo [init] rebuilding native modules (better-sqlite3, node-pty)...
call pnpm --filter @aimon/server rebuild @homebridge/node-pty-prebuilt-multiarch better-sqlite3
if errorlevel 1 goto :fail

REM --- Step 7: build:stable ---
echo [init] running build:stable...
call pnpm build:stable
if errorlevel 1 goto :fail

popd >nul

echo.
echo [init] DONE. Stable ready at %STABLE_DIR%.
if defined TARGET_REF (
  echo [init] Current ref: !TARGET_REF! ^(detached HEAD^)
) else (
  echo [init] Current ref: cloned HEAD ^(no stable-* tag yet^)
)
echo [init] Start it with:
echo [init]   cd /d %STABLE_DIR%
echo [init]   pnpm start:stable
echo.
echo [init] Thereafter, sync dev -^> stable via sync-to-stable.bat.
exit /b 0

:fail
popd >nul 2>nul
echo [init] FAILED. See messages above.
exit /b 1
