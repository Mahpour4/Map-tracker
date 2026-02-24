@echo off
echo ============================================================
echo  GlobalWorx Auto-Accept — Service Alert Processor
echo ============================================================
echo.

REM Check if Python is installed
where python >nul 2>nul
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Python not found. Please install Python 3.8+
    pause
    exit /b 1
)

REM Install dependencies if needed
echo Checking dependencies...
pip install selenium google-auth google-auth-oauthlib google-api-python-client >nul 2>&1

REM Run the script
echo.
python "%~dp0globalworx-accept.py"

echo.
pause
