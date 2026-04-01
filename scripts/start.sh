#!/bin/bash

# Bloom AI Chat - Launcher for macOS/Linux

echo "Starting Bloom AI Chat..."

# Get script directory
SCRIPT_DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$SCRIPT_DIR"

# Check if virtual environment exists
if [ ! -d ".venv" ]; then
    echo "ERROR: Virtual environment not found."
    echo "Please run install.sh first to set up the application."
    exit 1
fi

# Activate virtual environment
source .venv/bin/activate

# Start Electron
npm start
