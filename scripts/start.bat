@echo off
setlocal EnableDelayedExpansion

REM =============================================
REM Bloom AI Chat - Efficient Startup Script
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
)

REM Start the application
echo [INFO] Starting Bloom AI Chat...
echo.

REM Use electron to start the app
node_modules\.bin\electron .

REM Capture exit code
set "EXIT_CODE=%errorlevel%"

popd
endlocal
exit /b %EXIT_CODE%
setlocal EnableDelayedExpansion

REM =============================================
REM Bloom AI Chat - Efficient Startup Script
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
)

REM Start the application
echo [INFO] Starting Bloom AI Chat...
echo.

REM Use electron to start the app
node_modules\.bin\electron .

REM Capture exit code
set "EXIT_CODE=%errorlevel%"

popd
endlocal
exit /b %EXIT_CODE%
setlocal

echo ========================================
echo  Bloom AI Chat - Quick Start
echo ========================================
echo.

REM Get the directory where this batch file is located
set "SCRIPT_DIR=%~dp0"

echo Step 1: Checking Python installation...
"%SCRIPT_DIR%.venv\Scripts\python.exe" --version
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Python is not installed or not in PATH
    pause
    exit /b 1
)

echo.
echo Step 2: Installing Python dependencies...
"%SCRIPT_DIR%.venv\Scripts\pip.exe" install -r "%SCRIPT_DIR%backend\requirements.txt"
if %ERRORLEVEL% NEQ 0 (
    echo WARNING: Some Python packages may have failed to install
)

echo.
echo Step 3: Starting the application...
cd /d "%SCRIPT_DIR%"
npm start

pause
