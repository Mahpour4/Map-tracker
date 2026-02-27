@echo off
title Map Tracker - First Time Setup
color 0A

echo ============================================
echo   Map Tracker - First Time Setup
echo ============================================
echo.

:: ── Step 1: Check for Node.js ──────────────────────────────────────────────
echo [1/4] Checking for Node.js...
where node >nul 2>&1
if %ERRORLEVEL% NEQ 0 (
    echo Node.js not found. Downloading installer...
    echo.

    :: Download Node.js LTS installer using PowerShell
    powershell -Command "& { $url = 'https://nodejs.org/dist/lts/node-lts-latest-x64.msi'; $out = '$env:TEMP\node-lts.msi'; Write-Host 'Downloading from nodejs.org...'; Invoke-WebRequest -Uri $url -OutFile $out; Start-Process msiexec.exe -Wait -ArgumentList '/I', $out, '/quiet', '/norestart'; Remove-Item $out }"

    :: Refresh PATH so node is available in this session
    for /f "tokens=*" %%i in ('powershell -Command "[System.Environment]::GetEnvironmentVariable(\"PATH\", \"Machine\")"') do set PATH=%%i;%PATH%

    where node >nul 2>&1
    if %ERRORLEVEL% NEQ 0 (
        echo.
        echo ERROR: Node.js install may require a restart.
        echo Please restart your computer and run setup.bat again.
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
    echo ERROR: npm install failed. Check your internet connection and try again.
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
        echo WARNING: WhatsApp service dependencies failed to install.
        echo The main app will still work without it.
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
