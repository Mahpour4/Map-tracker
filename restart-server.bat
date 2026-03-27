@echo off
:: ─────────────────────────────────────────────
::  Map Tracker — WhatsApp Server Restart
::  Kills any existing process on port 3001,
::  then starts the WhatsApp service fresh.
::
::  Usage: Double-click restart-server.bat
:: ─────────────────────────────────────────────

echo.
echo ══════════════════════════════════════════
echo    WhatsApp Server Restart
echo ══════════════════════════════════════════
echo.

:: Find and kill any process on port 3001
echo [STEP 1] Checking port 3001...
for /f "tokens=5" %%a in ('netstat -ano 2^>nul ^| findstr ":3001" ^| findstr "LISTENING"') do (
    echo [INFO] Killing PID %%a on port 3001...
    taskkill /F /PID %%a >nul 2>&1
)

:: Short wait for port to free up
timeout /t 2 /nobreak >nul

:: Start server in a new window
echo [STEP 2] Starting WhatsApp service...
cd /d "%~dp0scripts\whatsapp-service"
start "WhatsApp Service" cmd /k "node server.js"

echo.
echo [OK] Server started in new window.
echo      Status: http://localhost:3001/api/whatsapp/status
echo.
pause
