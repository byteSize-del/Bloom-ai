@echo off
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
