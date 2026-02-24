@echo off
REM fix-claude-vscode.bat - detect and (optionally) reinstall Claude extension using VS Code CLI
SETLOCAL ENABLEDELAYEDEXPANSION

echo.
echo --- fix-claude-vscode.bat ---
echo This script checks for a VS Code 'code' CLI, lists extensions matching 'claude',
echo and offers to reinstall the first match or install a user-specified extension id.
echo.

:: Check for 'code' CLI
where code >nul 2>&1
IF ERRORLEVEL 1 (
  echo VS Code 'code' CLI not found in PATH.
  echo Open VS Code -> Command Palette -> "Shell Command: Install 'code' command in PATH" (or add code to PATH).
  pause
  exit /b 1
)

echo Listing installed extensions that potentially match 'claude'...
code --list-extensions --show-versions | findstr /I "claude anthropic claude-vscode" || set NO_MATCH=1

if defined NO_MATCH (
  echo No installed extension matching 'claude' found.
  set /p extid=Enter extension id to install (publisher.extension), or leave empty to exit: 
  if "%extid%"=="" (
    echo Exiting.
    pause
    exit /b 0
  )
  echo Installing %extid% ...
  code --install-extension %extid%
  goto open
)

:: Grab first matching extension id
for /f "delims=" %%e in ('code --list-extensions ^| findstr /I "claude anthropic claude-vscode"') do (
  set ext=%%e
  goto found
)

:found
echo Found extension: %ext%
set /p ans=Reinstall %ext%? (Y/N): 
if /I "%ans%"=="Y" (
  echo Uninstalling %ext%...
  code --uninstall-extension %ext%
  echo Reinstalling %ext%...
  code --install-extension %ext%
) else (
  echo Skipping reinstall.
)

:open
echo Opening current folder in VS Code...
code .

echo
echo Next steps:
echo - In VS Code open Output -> "Log (Extension Host)" to see activation errors.
echo - In VS Code open Help -> "Toggle Developer Tools" and check the Console for errors.
echo
pause
@echo off
REM fix-claude-vscode.bat - detect and (optionally) reinstall Claude extension using VS Code CLI
SETLOCAL ENABLEDELAYEDEXPANSION

echo.
echo --- fix-claude-vscode.bat ---
echo This script checks for a VS Code 'code' CLI, lists extensions matching 'claude',
echo and offers to reinstall the first match or install a user-specified extension id.
echo.

:: Check for 'code' CLI
where code >nul 2>&1
IF ERRORLEVEL 1 (
  echo VS Code 'code' CLI not found in PATH.
  echo Open VS Code -> Command Palette -> "Shell Command: Install 'code' command in PATH" (or add code to PATH).
  pause
  exit /b 1
)

echo Listing installed extensions that potentially match 'claude'...
code --list-extensions --show-versions | findstr /I "claude anthropic claude-vscode" || set NO_MATCH=1

if defined NO_MATCH (
  echo No installed extension matching 'claude' found.
  set /p extid=Enter extension id to install (publisher.extension), or leave empty to exit: 
  if "%extid%"=="" (
    echo Exiting.
    pause
    exit /b 0
  )
  echo Installing %extid% ...
  code --install-extension %extid%
  goto open
)

:: Grab first matching extension id
for /f "delims=" %%e in ('code --list-extensions ^| findstr /I "claude anthropic claude-vscode"') do (
  set ext=%%e
  goto found
)

:found
echo Found extension: %ext%
set /p ans=Reinstall %ext%? (Y/N): 
if /I "%ans%"=="Y" (
  echo Uninstalling %ext%...
  code --uninstall-extension %ext%
  echo Reinstalling %ext%...
  code --install-extension %ext%
) else (
  echo Skipping reinstall.
)

:open
echo Opening current folder in VS Code...
code .

echo
echo Next steps:
echo - In VS Code open Output -> "Log (Extension Host)" to see activation errors.
echo - In VS Code open Help -> "Toggle Developer Tools" and check the Console for errors.
echo
pause
