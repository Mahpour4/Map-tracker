@echo off
title GlobalWorx Local Service

echo ================================
echo   GlobalWorx Local Service
echo ================================
echo.
echo   Starts local server on port 3001 for Puppeteer/Chrome automation.
echo   /api/globalworx/* routes are proxied here from Vite.
echo   All other API routes go to Oracle Cloud (129.159.177.50:3001).
echo.

:: Check if Oracle Cloud server is reachable
echo Checking Oracle Cloud server (129.159.177.50:3001)...
curl -s --max-time 5 http://129.159.177.50:3001/api/whatsapp/status >nul 2>&1
if %ERRORLEVEL% == 0 (
    echo   [OK] Oracle server is UP - WhatsApp/admin routes will work.
) else (
    echo   [WARNING] Oracle server is unreachable on port 3001.
    echo   WhatsApp sending, admin queries, and settings will NOT work.
    echo   Only GlobalWorx automation (accept/complete) will be available.
    echo   To fix: open port 3001 in Oracle Cloud firewall and Ubuntu iptables.
    echo.
    pause
)
echo.

:: Install WhatsApp service dependencies if needed
if exist "scripts\whatsapp-service\package.json" (
    if not exist "scripts\whatsapp-service\node_modules\" (
        echo Installing service dependencies...
        pushd scripts\whatsapp-service
        call npm install
        popd
        echo.
    )
)

set GLOBALWORX_ONLY=true
cd scripts\whatsapp-service && node server.js
