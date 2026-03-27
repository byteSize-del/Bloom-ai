@echo off
setlocal EnableDelayedExpansion

echo ========================================
echo  Bloom AI Chat - Installer
echo ========================================
echo.

REM Get the directory where this installer is located
set "SCRIPT_DIR=%~dp0"
cd /d "%SCRIPT_DIR%"

echo Step 1: Checking system requirements...
echo.

REM Check Python
echo [1/5] Checking Python installation...
python --version
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Python is not installed or not in PATH
    echo Please install Python 3.10+ from https://www.python.org/downloads/
    echo Make sure to check "Add Python to PATH" during installation
    pause
    exit /b 1
)
echo Python found!
echo.

REM Check Node.js
echo [2/5] Checking Node.js installation...
node --version
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Node.js is not installed or not in PATH
    echo Please install Node.js 18+ from https://nodejs.org/
    pause
    exit /b 1
)
echo Node.js found!
echo.

REM Check npm
echo [3/5] Checking npm installation...
npm --version
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: npm is not installed or not in PATH
    echo Please install Node.js from https://nodejs.org/
    pause
    exit /b 1
)
echo npm found!
echo.

REM Check Ollama
echo [4/5] Checking Ollama installation...
ollama --version
if %ERRORLEVEL% NEQ 0 (
    echo WARNING: Ollama is not installed or not in PATH
    echo Bloom requires Ollama to run AI models
    echo.
    set /p INSTALL_OLLAMA="Do you want to open Ollama download page? (Y/N): "
    if /i "%INSTALL_OLLAMA%"=="Y" (
        start https://ollama.ai/download
    )
    echo You can install Ollama later, but the app won't work without it
    echo.
) else (
    echo Ollama found!
    echo.
)

REM Check if Ollama has models
echo [5/5] Checking for Ollama models...
ollama list
if %ERRORLEVEL% NEQ 0 (
    echo.
    echo WARNING: No Ollama models found
    echo.
    echo Bloom requires at least one model to work
    echo Run this command after installation:
    echo   ollama pull llama3
    echo.
) else (
    echo Ollama models found!
    echo.
)

echo ========================================
echo  Installing Dependencies
echo ========================================
echo.

REM Create virtual environment
echo [1/3] Creating Python virtual environment...
if exist ".venv" (
    echo Virtual environment already exists, skipping...
) else (
    echo Creating virtual environment...
    python -m venv .venv
    if %ERRORLEVEL% NEQ 0 (
        echo ERROR: Failed to create virtual environment
        pause
        exit /b 1
    )
    echo Virtual environment created!
)
echo.

REM Install Python dependencies
echo [2/3] Installing Python dependencies...
call .venv\Scripts\activate.bat
pip install -r backend\requirements.txt
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Failed to install Python dependencies
    pause
    exit /b 1
)
echo Python dependencies installed!
echo.

REM Install Node dependencies
echo [3/3] Installing Node.js dependencies...
echo This may take a few minutes...
npm install
if %ERRORLEVEL% NEQ 0 (
    echo ERROR: Failed to install Node.js dependencies
    pause
    exit /b 1
)
echo Node.js dependencies installed!
echo.

echo ========================================
echo  Installation Complete!
echo ========================================
echo.
echo Bloom AI Chat has been successfully installed.
echo.
echo To run the application:
echo   1. Make sure Ollama is running: ollama serve
echo   2. Run: start.bat
echo   Or simply double-click start.bat
echo.
echo If you don't have any Ollama models yet, run:
echo   ollama pull llama3
echo.
set /p OPEN_APP="Do you want to open the app now? (Y/N): "
if /i "%OPEN_APP%"=="Y" (
    start.bat
)

pause
