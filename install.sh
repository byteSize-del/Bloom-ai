#!/bin/bash

echo "========================================"
echo " Bloom AI Chat - Installer"
echo "========================================"
echo ""

# Get script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

echo "Step 1: Checking system requirements..."
echo ""

# Check Python
echo "[1/5] Checking Python installation..."
if command -v python3 &> /dev/null; then
    PYTHON_VERSION=$(python3 --version)
    echo "$PYTHON_VERSION found!"
elif command -v python &> /dev/null; then
    PYTHON_VERSION=$(python --version)
    echo "$PYTHON_VERSION found!"
else
    echo "ERROR: Python is not installed or not in PATH"
    echo "Please install Python 3.10+ from https://www.python.org/downloads/"
    exit 1
fi
echo ""

# Check Node.js
echo "[2/5] Checking Node.js installation..."
if command -v node &> /dev/null; then
    NODE_VERSION=$(node --version)
    echo "$NODE_VERSION found!"
else
    echo "ERROR: Node.js is not installed or not in PATH"
    echo "Please install Node.js 18+ from https://nodejs.org/"
    exit 1
fi
echo ""

# Check npm
echo "[3/5] Checking npm installation..."
if command -v npm &> /dev/null; then
    NPM_VERSION=$(npm --version)
    echo "npm $NPM_VERSION found!"
else
    echo "ERROR: npm is not installed or not in PATH"
    echo "Please install Node.js from https://nodejs.org/"
    exit 1
fi
echo ""

# Check Ollama
echo "[4/5] Checking Ollama installation..."
if command -v ollama &> /dev/null; then
    OLLAMA_VERSION=$(ollama --version)
    echo "$OLLAMA_VERSION found!"
else
    echo "WARNING: Ollama is not installed or not in PATH"
    echo "Bloom requires Ollama to run AI models"
    echo ""
    read -p "Do you want to open Ollama download page? (y/n): " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
        open "https://ollama.ai/download" 2>/dev/null || xdg-open "https://ollama.ai/download" 2>/dev/null
    fi
    echo "You can install Ollama later, but the app won't work without it"
fi
echo ""

# Check Ollama models
echo "[5/5] Checking for Ollama models..."
if command -v ollama &> /dev/null; then
    MODEL_COUNT=$(ollama list 2>/dev/null | wc -l)
    if [ "$MODEL_COUNT" -gt 1 ]; then
        ollama list
        echo "Ollama models found!"
    else
        echo "WARNING: No Ollama models found"
        echo ""
        echo "Bloom requires at least one model to work"
        echo "Run this command after installation:"
        echo "  ollama pull llama3"
        echo ""
    fi
fi
echo ""

echo "========================================"
echo " Installing Dependencies"
echo "========================================"
echo ""

# Create virtual environment
echo "[1/3] Creating Python virtual environment..."
if [ -d ".venv" ]; then
    echo "Virtual environment already exists, skipping..."
else
    python3 -m venv .venv || python -m venv .venv
    if [ $? -ne 0 ]; then
        echo "ERROR: Failed to create virtual environment"
        exit 1
    fi
    echo "Virtual environment created!"
fi
echo ""

# Activate virtual environment
source .venv/bin/activate

# Install Python dependencies
echo "[2/3] Installing Python dependencies..."
pip install -r backend/requirements.txt
if [ $? -ne 0 ]; then
    echo "ERROR: Failed to install Python dependencies"
    exit 1
fi
echo "Python dependencies installed!"
echo ""

# Install Node dependencies
echo "[3/3] Installing Node.js dependencies..."
npm install
if [ $? -ne 0 ]; then
    echo "ERROR: Failed to install Node.js dependencies"
    exit 1
fi
echo "Node.js dependencies installed!"
echo ""

echo "========================================"
echo " Installation Complete!"
echo "========================================"
echo ""
echo "Bloom AI Chat has been successfully installed."
echo ""
echo "To run the application:"
echo "  1. Make sure Ollama is running: ollama serve"
echo "  2. Run: ./start.sh"
echo "  Or simply run: npm start"
echo ""
echo "If you don't have any Ollama models yet, run:"
echo "  ollama pull llama3"
echo ""
read -p "Do you want to run the app now? (y/n): " -n 1 -r
echo ""
if [[ $REPLY =~ ^[Yy]$ ]]; then
    npm start
fi
