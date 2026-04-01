@echo off
setlocal EnableDelayedExpansion

REM =============================================
REM Bloom AI Chat - Efficient Installation Script
REM =============================================

REM Get the directory where this batch file is located
set "SCRIPT_DIR=%~dp0"
pushd "%SCRIPT_DIR%"

REM Check for Node.js
where node >nul 2>&1
if errorlevel 1 (
    echo [ERROR] Node.js is not installed or not in PATH.
    echo Please install Node.js from https://nodejs.org/
    echo.
    pause
    exit /b 1
)

REM Check for npm
where npm >nul 2>&1
if errorlevel 1 (
    echo [ERROR] npm is not installed or not in PATH.
    echo Please reinstall Node.js which includes npm.
    echo.
    pause
    exit /b 1
)

REM Display Node and npm versions for verification
echo [INFO] Node version: !node_version!
for /f "usebackq tokens=*" %%v in (`node --version`) do set "node_version=%%v"
echo [INFO] npm version: !npm_version!
for /f "usebackq tokens=*" %%v in (`npm --version`) do set "npm_version=%%v"

REM Check if package.json exists
if not exist "package.json" (
    echo [ERROR] package.json not found in %SCRIPT_DIR%
    echo.
    pause
    exit /b 1
)

REM Check if we need to install dependencies
REM We'll check if node_modules exists and if package.json is newer than node_modules
set "DEPS_NEEDED=0"
if not exist "node_modules" (
    set "DEPS_NEEDED=1"
) else (
    REM Compare timestamps: if package.json is newer than node_modules, reinstall
    forfiles /p . /m package.json /c "cmd /c if @ftime > ..\node_modules\@ftime set DEPS_NEEDED=1"
)

if !DEPS_NEEDED! equ 1 (
    echo [INFO] Installing or updating dependencies...
    npm install
    if errorlevel 1 (
        echo [ERROR] Failed to install dependencies.
        echo.
        pause
        exit /b 1
    )
) else (
    echo [INFO] Dependencies are up to date.
)

REM Check for Electron
if not exist "node_modules\.bin\electron" (
    echo [INFO] Installing Electron as dev dependency...
    npm install --save-dev electron
    if errorlevel 1 (
        echo [ERROR] Failed to install Electron.
        echo.
        pause
        exit /b 1
    )
) else (
    echo [INFO] Electron is already installed.
)

echo.
echo [INFO] Installation complete!
echo [INFO] You can now run the application using: start.bat
echo.

popd
endlocal
pause
exit /b 0
setlocal EnableDelayedExpansion

echo ========================================
echo  Bloom AI Chat - Installer
echo ========================================
echo.

cd /d "%~dp0"

echo [1/3] Creating Python virtual environment...
if exist ".venv" (
    echo Using existing virtual environment
) else (
    python -m venv .venv
)
echo Done.
echo.

echo [2/3] Installing Python dependencies...
call .venv\Scripts\activate.bat
call pip install -r backend\requirements.txt
echo Done.
echo.

echo [3/3] Installing Node.js dependencies...
call npm install
echo Done.
echo.

echo ========================================
echo  Installation Complete!
echo ========================================
echo.
echo To run Bloom AI Chat:
echo   1. Install Ollama from https://ollama.ai (if not installed)
echo   2. Run: ollama pull llama3
echo   3. Double-click start.bat
echo.
pause
