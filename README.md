# Bloom AI Chat

Bloom is an Electron + FastAPI desktop chat app for local Ollama models (with optional cloud-capable model usage).

## Current Version

- App version: `1.0.1`
- Windows installer artifact: `dist/Bloom-Setup-1.0.1.exe`

## Highlights

- Desktop chat UI with session history
- Local model picker (Ollama)
- Streaming responses
- Message actions (copy/regenerate/delete)
- Custom window chrome and custom app icon
- Developer Assistant and Agentic Cloud mode toggles
- Offline frontend assets (no CDN dependency)

## Requirements

- Windows 10/11 x64
- Ollama installed and running
- Python virtual environment at `.venv` (for source/dev)

## Run From Source

```powershell
cd "C:\Users\sayye\OneDrive\Desktop\Bloom"
.\.venv\Scripts\python.exe -m pip install -r backend\requirements.txt
npm install
npm start
```

## Build Installer

```powershell
npm run build:win
```

Output:

- `dist\Bloom-Setup-1.0.1.exe`

## Quick Backend Checks

```powershell
ollama serve
curl http://localhost:11434/api/tags
curl http://127.0.0.1:8000/health
```

## Tests

Install test dependency once:

```powershell
.\.venv\Scripts\python.exe -m pip install -r backend\requirements-dev.txt
```

Run tests:

```powershell
npm test
```

## Project Layout

- `main.js` Electron main process
- `preload.js` secure preload bridge
- `frontend/index.html` UI + styles
- `frontend/renderer.js` chat/session logic
- `backend/main.py` FastAPI API
- `backend/model_handler.py` Ollama integration
- `backend/chat_history.py` persistence manager
- `backend/tests/` backend test suite

## Notes

- Packaged app uses bundled Python from `resources/venv`.
- Session files are stored in app data folder via `DATA_DIR`.
- Settings are stored next to the session folder (for packaged app: `%APPDATA%\\OfflineAIChat\\settings.json`).

## License

MIT (see `LICENSE`)
