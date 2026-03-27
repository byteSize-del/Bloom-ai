@echo off
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
