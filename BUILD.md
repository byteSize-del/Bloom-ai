# Building Bloom AI Chat - Installation Guide

This guide explains how to create an installable package for Bloom AI Chat.

## Quick Start (For Users)

If you just want to use Bloom, download the pre-built installer from the Releases page:
- **Windows**: `Bloom-Setup-1.0.0.exe`
- **macOS**: `Bloom-Setup-1.0.0.dmg`
- **Linux**: `Bloom-Setup-1.0.0.AppImage`

### After Installing

1. Install Ollama from https://ollama.ai
2. Run in terminal: `ollama pull llama3`
3. Launch Bloom AI Chat from Start Menu/Applications
4. Start chatting!

---

## Building from Source (For Developers)

### Prerequisites

1. **Python 3.10+** installed
2. **Node.js 18+** installed
3. **Ollama** installed (optional for building, required for running)

### Step 1: Clone and Install Dependencies

```bash
git clone https://github.com/yourusername/bloom.git
cd bloom
```

### Step 2: Run the Automated Installer

```bash
# Windows
install.bat

# macOS/Linux
chmod +x install.sh
./install.sh
```

### Step 3: Build the Installer

```bash
# Build for current platform
npm run build

# Build for Windows (from any platform)
npm run build:win

# Build for macOS
npm run build:mac

# Build for Linux
npm run build:linux
```

### Step 4: Find Your Installer

After building, find the installer in the `dist/` folder:

| Platform | Output File |
|----------|-------------|
| Windows | `dist/Bloom-Setup-1.0.0.exe` |
| macOS | `dist/Bloom-Setup-1.0.0.dmg` |
| Linux | `dist/Bloom-Setup-1.0.0.AppImage` |

---

## Manual Build Steps (If Automated Build Fails)

### 1. Set Up Python Environment

```bash
# Create virtual environment
python -m venv .venv

# Activate it
# Windows:
.venv\Scripts\activate
# macOS/Linux:
source .venv/bin/activate

# Install dependencies
pip install -r backend/requirements.txt
```

### 2. Install Node Dependencies

```bash
npm install
```

### 3. Build with Electron Builder

```bash
npm run build
```

---

## Troubleshooting

### Build Fails with "Python not found"

Make sure Python is in your PATH:
```bash
python --version
```

### Build Fails with "Node not found"

Make sure Node.js is installed:
```bash
node --version
npm --version
```

### Build Takes Too Long

The build includes the Python virtual environment, which can be large (500MB+). This is normal.

### App Crashes on Start

Make sure Ollama is installed and running:
```bash
ollama serve
```

---

## Distribution

### Upload to GitHub Releases

1. Go to your GitHub repository
2. Click "Releases" → "Create a new release"
3. Tag version: `v1.0.0`
4. Upload the built installer from `dist/`
5. Publish the release

### Share with Users

Share the GitHub releases link:
```
https://github.com/yourusername/bloom/releases
```

---

## File Size Optimization

The installer includes the Python virtual environment, which makes it large (~300-500MB). To reduce size:

1. **Use system Python** (requires users to have Python installed)
2. **Compress the venv** before building
3. **Use PyInstaller** instead of bundling venv

---

## License

MIT License - See LICENSE for details.
