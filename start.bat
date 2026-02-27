@echo off
title Map Tracker

echo ================================
echo   Map Tracker - Starting...
echo ================================
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

:: Start the WhatsApp service in the background
echo Starting WhatsApp service...
start "WhatsApp Service" cmd /k "cd scripts\whatsapp-service && node server.js"

:: Give the backend a moment to start
timeout /t 2 /nobreak >nul

:: Start the Vite dev server
echo Starting Vite dev server...
call npm run dev
