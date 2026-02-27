@echo off
title Map Tracker - First Time Setup
color 0A

:: Keep window open if double-clicked directly
if not defined SETUP_RUNNING (
    set SETUP_RUNNING=1
    cmd /k "%~f0"
    exit
)

echo ============================================
echo   Map Tracker - First Time Setup
echo ============================================
echo.

:: Make sure we're in the right folder
cd /d "%~dp0"

:: ── Step 1: Check for Node.js ──────────────────────────────────────────────
echo [1/4] Checking for Node.js...
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo Node.js not found. Attempting to install via winget...
    echo.

    winget install OpenJS.NodeJS.LTS --silent --accept-source-agreements --accept-package-agreements
    if %ERRORLEVEL% NEQ 0 (
        echo.
        echo winget install failed. Trying PowerShell download...
        powershell -NoProfile -ExecutionPolicy Bypass -Command ^
            "$out = Join-Path $env:TEMP 'node-lts.msi';" ^
            "Write-Host 'Downloading Node.js LTS...';" ^
            "$url = 'https://nodejs.org/dist/v22.14.0/node-v22.14.0-x64.msi';" ^
            "Invoke-WebRequest -Uri $url -OutFile $out;" ^
            "Write-Host 'Installing...';" ^
            "Start-Process msiexec.exe -Wait -ArgumentList '/I', $out, '/quiet', '/norestart';" ^
            "Remove-Item $out -Force"
    )

    :: Refresh PATH
    for /f "usebackq tokens=*" %%i in (`powershell -NoProfile -Command "[System.Environment]::GetEnvironmentVariable('PATH','Machine')"`) do set "PATH=%%i;%PATH%"

    where node >nul 2>&1
    if %ERRORLEVEL% NEQ 0 (
        echo.
        echo ============================================
        echo   Node.js installed but needs a restart.
        echo   Please restart your computer, then
        echo   run setup.bat again.
        echo ============================================
        echo.
        pause
        exit /b 1
    )
    echo Node.js installed successfully.
) else (
    for /f "tokens=*" %%v in ('node --version') do echo Node.js found: %%v
)
echo.

:: ── Step 2: Install main app dependencies ──────────────────────────────────
echo [2/4] Installing main app dependencies...
call npm install
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo ERROR: npm install failed.
    echo Check your internet connection and try again.
    echo.
    pause
    exit /b 1
)
echo Done.
echo.

:: ── Step 3: Install WhatsApp service dependencies ──────────────────────────
echo [3/4] Installing WhatsApp service dependencies...
if exist "scripts\whatsapp-service\package.json" (
    pushd scripts\whatsapp-service
    call npm install
    if %ERRORLEVEL% NEQ 0 (
        echo WARNING: WhatsApp service install failed. Main app will still work.
    ) else (
        echo Done.
    )
    popd
) else (
    echo WhatsApp service not found, skipping.
)
echo.

:: ── Step 4: Done ───────────────────────────────────────────────────────────
echo [4/4] Setup complete!
echo.
echo ============================================
echo   All done! Run start.bat to launch the app
echo ============================================
echo.
pause
