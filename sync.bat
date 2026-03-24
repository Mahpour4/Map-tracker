@echo off
:: ─────────────────────────────────────────────
::  Map Tracker — Full Sync
::  Run this on EITHER computer to push or pull
::  all files and keep both machines identical.
::
::  Usage:  Double-click sync.bat
::    OR    sync.bat push     (stage all + commit + push)
::    OR    sync.bat pull     (pull only)
:: ─────────────────────────────────────────────

setlocal
set MODE=%1
if "%MODE%"=="" set MODE=push

echo.
echo ══════════════════════════════════════════
echo    Map Tracker Sync  [%MODE%]
echo ══════════════════════════════════════════
echo.

:: Check git is available
where git >nul 2>&1
if errorlevel 1 (
    echo [ERROR] git not found. Install Git for Windows.
    pause & exit /b 1
)

:: Show current state
echo [INFO] Branch:
git rev-parse --abbrev-ref HEAD
echo [INFO] Last commit:
git log --oneline -1
echo.

if /i "%MODE%"=="pull" goto :do_pull

:: ── PUSH MODE ─────────────────────────────
:do_push

echo [STEP 1] Pulling latest from remote first...
git pull --rebase
if errorlevel 1 (
    echo [ERROR] Pull failed. Resolve conflicts then re-run.
    pause & exit /b 1
)

echo.
echo [STEP 2] Staging all files...
:: Add everything except what's in .gitignore (auth tokens, node_modules, dist)
git add -A

:: Show what's being committed
echo.
echo [INFO] Changes to commit:
git status --short

:: Check if there's anything to commit
git diff --cached --quiet
if not errorlevel 1 (
    echo.
    echo [INFO] Nothing new to commit - already up to date.
    goto :done
)

echo.
echo [STEP 3] Committing...
:: Auto-generate commit message with timestamp
for /f "tokens=1-3 delims=/ " %%a in ("%DATE%") do set D=%%c-%%a-%%b
for /f "tokens=1-2 delims=: " %%a in ("%TIME%") do set T=%%a:%%b
git commit -m "Sync %D% %T% — mirror update"

echo.
echo [STEP 4] Pushing to GitHub...
git push
if errorlevel 1 (
    echo [ERROR] Push failed.
    pause & exit /b 1
)

goto :done

:: ── PULL MODE ─────────────────────────────
:do_pull

echo [STEP 1] Pulling latest from remote...
git pull --rebase
if errorlevel 1 (
    echo [ERROR] Pull failed. Resolve conflicts then re-run.
    pause & exit /b 1
)

echo.
echo [STEP 2] Installing any new dependencies...
where npm >nul 2>&1
if not errorlevel 1 (
    npm install --silent
    echo [OK] npm install complete.
)

:: ── DONE ──────────────────────────────────
:done

echo.
echo ══════════════════════════════════════════
echo    Done. Current commit:
git log --oneline -1
echo ══════════════════════════════════════════
echo.
echo NOTE: Two folders are NOT synced via git (auth tokens):
echo   .wwebjs_auth\   — WhatsApp session
echo   token\          — OAuth tokens
echo   Copy these manually between machines if needed.
echo.
pause
