@echo off
setlocal EnableDelayedExpansion

REM ============================================================
REM sync-to-stable.bat
REM Sync current dev repo HEAD to the stable clone and rebuild.
REM Does NOT restart stable; you pick the moment manually.
REM ============================================================

set DEV_DIR=%~dp0
if "%DEV_DIR:~-1%"=="\" set DEV_DIR=%DEV_DIR:~0,-1%
set STABLE_DIR=f:\KB\AIkanban-stable

echo [sync] DEV    = %DEV_DIR%
echo [sync] STABLE = %STABLE_DIR%
echo.

REM --- Step 1: dev working tree must be clean ---
pushd "%DEV_DIR%" >nul
if errorlevel 1 (
  echo [sync] ERROR: cannot enter dev dir.
  exit /b 1
)

git diff --quiet
if errorlevel 1 (
  echo [sync] ERROR: dev working tree has unstaged changes. Please commit or stash first.
  popd >nul
  exit /b 1
)
git diff --cached --quiet
if errorlevel 1 (
  echo [sync] ERROR: dev has staged but uncommitted changes. Please commit first.
  popd >nul
  exit /b 1
)
popd >nul

REM --- Step 2: stable dir must exist ---
if not exist "%STABLE_DIR%\.git" (
  echo [sync] ERROR: stable dir not found or not a git repo: %STABLE_DIR%
  echo [sync] Run once: git clone "%DEV_DIR%" "%STABLE_DIR%"
  exit /b 1
)

pushd "%STABLE_DIR%" >nul
if errorlevel 1 (
  echo [sync] ERROR: cannot enter stable dir.
  exit /b 1
)

REM --- Step 3: fetch from dev ---
echo [sync] fetching origin...
git fetch origin
if errorlevel 1 goto :fail

REM --- Step 4: detect pnpm-lock.yaml change ---
git diff --quiet HEAD origin/main -- pnpm-lock.yaml
set LOCK_CHANGED=%errorlevel%

REM --- Step 5: hard-reset stable to origin/main ---
echo [sync] resetting stable to origin/main...
git reset --hard origin/main
if errorlevel 1 goto :fail

REM --- Step 6: conditional install + rebuild native ---
if "%LOCK_CHANGED%"=="1" (
  echo [sync] pnpm-lock.yaml changed, running pnpm install...
  call pnpm install
  if errorlevel 1 goto :fail
  echo [sync] rebuilding native modules...
  call pnpm --filter @aimon/server rebuild @homebridge/node-pty-prebuilt-multiarch better-sqlite3
  if errorlevel 1 goto :fail
) else (
  echo [sync] pnpm-lock.yaml unchanged, skipping install/rebuild.
)

REM --- Step 7: build stable ---
echo [sync] building stable...
call pnpm build:stable
if errorlevel 1 goto :fail

popd >nul

echo.
echo [sync] DONE. Stable HEAD updated and rebuilt.
echo [sync] Restart stable manually when convenient:
echo [sync]   cd /d %STABLE_DIR%
echo [sync]   (Ctrl+C the old start:stable window, then) pnpm start:stable
exit /b 0

:fail
popd >nul
echo [sync] FAILED. See messages above.
exit /b 1
