@echo off
title Map Tracker

echo ================================
echo   Map Tracker - Starting...
echo ================================
echo.
echo   WhatsApp bot runs on Oracle Cloud (129.159.177.50:3001)
echo   Starting GlobalWorx local service for alert automation...
echo.

:: Install dependencies if node_modules is missing
if not exist "node_modules\" (
    echo Installing dependencies...
    call npm install
    echo.
)

:: Install WhatsApp service dependencies if needed
if exist "scripts\whatsapp-service\package.json" (
    if not exist "scripts\whatsapp-service\node_modules\" (
        echo Installing WhatsApp service dependencies...
        pushd scripts\whatsapp-service
        call npm install
        popd
        echo.
    )
)

:: Check if Oracle Cloud server is reachable
echo Checking Oracle Cloud server (129.159.177.50:3001)...
curl -s --max-time 5 http://129.159.177.50:3001/api/whatsapp/status >nul 2>&1
if %ERRORLEVEL% == 0 (
    echo   [OK] Oracle server is UP.
) else (
    echo   [WARNING] Oracle server unreachable - WhatsApp/admin features will not work.
)
echo.

:: Start the GlobalWorx local service in a separate window (WhatsApp disabled — runs on Oracle)
set GLOBALWORX_ONLY=true
start "GlobalWorx Local Service" cmd /k "cd scripts\whatsapp-service && node server.js"
set GLOBALWORX_ONLY=

:: Give it a moment to start
timeout /t 2 /nobreak >nul

:: Start the Vite dev server
echo Starting Vite dev server...
call npm run dev
