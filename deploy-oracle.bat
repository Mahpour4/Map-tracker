@echo off
:: ─────────────────────────────────────────────
::  Map Tracker — Deploy to Oracle Cloud
::  SSHes into Oracle and pulls latest code + restarts bot
::  Run this after sync.bat to push bot updates live.
:: ─────────────────────────────────────────────

echo.
echo ══════════════════════════════════════════
echo    Deploy to Oracle Cloud
echo ══════════════════════════════════════════
echo.

echo [STEP 1] SSHing into Oracle and deploying...
ssh ubuntu@129.159.177.50 "cd /home/ubuntu/Map-tracker && git stash && git pull origin claude/map-stores-zones-zcvTK && pm2 restart whatsapp-bot && echo DEPLOY_OK"

if errorlevel 1 (
    echo.
    echo [ERROR] Deploy failed. Check SSH connection.
    echo   Make sure your SSH key is set up and Oracle is reachable.
) else (
    echo.
    echo [OK] Oracle bot updated and restarted.
)

echo.
pause
