@echo off
:: ─────────────────────────────────────────────
::  Map Tracker — Update Oracle
::  Commits everything, pushes to GitHub, deploys to Oracle in one step.
:: ─────────────────────────────────────────────

setlocal
set KEY=%~dp0private-key\ssh-key-2026-03-25.key

echo.
echo ══════════════════════════════════════════
echo    Update Oracle
echo ══════════════════════════════════════════
echo.

:: ── STEP 1: Pull latest ───────────────────────
echo [1/4] Pulling latest from GitHub...
git pull --rebase
if errorlevel 1 (
    echo [ERROR] Pull failed. Resolve conflicts and re-run.
    pause & exit /b 1
)

:: ── STEP 2: Stage + commit ────────────────────
git add -A
git diff --cached --quiet
if not errorlevel 1 (
    echo [INFO] Nothing to commit.
    goto :deploy
)

echo [2/4] Committing...
for /f "tokens=1-3 delims=/ " %%a in ("%DATE%") do set D=%%c-%%a-%%b
for /f "tokens=1-2 delims=: " %%a in ("%TIME%") do set T=%%a:%%b
git commit -m "Update %D% %T%"

:: ── STEP 3: Push ──────────────────────────────
echo [3/4] Pushing to GitHub...
git push
if errorlevel 1 (
    echo [ERROR] Push failed.
    pause & exit /b 1
)

:: ── STEP 4: Deploy to Oracle ──────────────────
:deploy
echo [4/4] Deploying to Oracle...
ssh -i "%KEY%" ubuntu@129.159.177.50 "cd /home/ubuntu/Map-tracker && git stash && git pull origin claude/map-stores-zones-zcvTK && pm2 restart whatsapp-bot && echo DEPLOY_OK"
if errorlevel 1 (
    echo [ERROR] Deploy to Oracle failed.
    pause & exit /b 1
)

echo.
echo ══════════════════════════════════════════
echo    Done — Oracle is live.
echo ══════════════════════════════════════════
echo.
pause
