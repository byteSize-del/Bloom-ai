# Bloom - Premium Offline AI Chat

A premium dark-themed desktop AI chat application that works offline with local Ollama models.

![Bloom AI Chat](https://img.shields.io/badge/version-1.0.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)

## Features

- **Premium Dark UI** - Modern glassmorphism design with smooth animations
- **Offline AI Chat** - Works entirely offline with local Ollama models
- **Model Selection** - Choose from your installed Ollama models
- **Chat Controls** - Stop generation mid-response, regenerate responses
- **Message Actions** - Copy, delete, and regenerate individual messages
- **Session Management** - Save and load chat history locally
- **Customizable Settings** - Adjust temperature, system prompts, and themes
- **Code Highlighting** - Syntax highlighting with copy button for code blocks
- **Pro UI Elements** - Premium feature placeholders with hover tooltips

## Prerequisites

Before installing Bloom, ensure you have:

1. **Python 3.10+** - [Download Python](https://www.python.org/downloads/)
2. **Node.js 18+** - [Download Node.js](https://nodejs.org/)
3. **Ollama** - [Download Ollama](https://ollama.ai/)
   - Install at least one model: `ollama pull llama3`

## Installation

### 1. Clone the Repository

```bash
git clone https://github.com/yourusername/bloom.git
cd bloom
```

### 2. Install Python Dependencies

```bash
python -m venv .venv
.venv\Scripts\pip.exe install -r backend\requirements.txt
```

### 3. Install Node Dependencies

```bash
npm install
```

### 4. Run the Application

**Windows:**
```bash
start.bat
```

**macOS/Linux:**
```bash
npm start
```

## Project Structure

```
bloom/
├── backend/
│   ├── main.py              # FastAPI backend server
│   ├── model_handler.py     # Ollama API integration
│   ├── chat_history.py      # Session management
│   └── requirements.txt     # Python dependencies
├── frontend/
│   ├── index.html           # Main UI with premium styling
│   └── renderer.js          # Frontend logic & API calls
├── main.js                  # Electron main process
├── preload.js               # Electron preload script
├── package.json             # Node dependencies
├── start.bat                # Windows launcher
└── README.md                # This file
```

## Usage

### Starting a Chat
1. Launch the application
2. Select a model from the sidebar dropdown
3. Type your message and press Enter or click Send
4. Use Shift+Enter for new lines

### Chat Controls
- **Stop** - Click the Stop button during generation to halt the response
- **Regenerate** - Click the Regenerate button on any AI message
- **Copy** - Click Copy to copy message content to clipboard
- **Delete** - Click the trash icon to remove a message

### Settings
- **Theme** - Toggle between Dark and Light mode
- **Temperature** - Adjust response creativity (0.0 to 2.0)
- **System Prompt** - Customize the AI's behavior
- **Default Model** - Set your preferred model

## Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `Enter` | Send message |
| `Shift + Enter` | New line |
| `Ctrl + A` | Select all |
| `Ctrl + C` | Copy selected text |
| `Ctrl + V` | Paste |

## Configuration

### Ollama Models

Bloom automatically detects models from:
- Ollama API (running on port 11434)
- Local models folder: `~/.ollama/models`

To install new models:
```bash
ollama pull llama3
ollama pull mistral
ollama pull codellama
```

### Custom Settings

Settings are stored locally and persist between sessions.

## Troubleshooting

### Backend Won't Start
1. Ensure Ollama is running: `ollama serve`
2. Check if port 8000 is available
3. Verify Python dependencies: `pip install -r backend/requirements.txt`

### No Models Found
1. Install Ollama: https://ollama.ai
2. Pull a model: `ollama pull llama3`
3. Restart the application

### UI Not Loading
1. Clear browser cache (if running in browser)
2. Reinstall Node modules: `npm install`

## Development

### Running in Development Mode

```bash
# Terminal 1 - Backend
.venv\Scripts\python.exe -m uvicorn backend.main:app --reload --host 127.0.0.1 --port 8000

# Terminal 2 - Frontend
npm start
```

### Building for Production

```bash
npm run build
```

## Technologies Used

- **Frontend:** HTML5, CSS3, JavaScript
- **Backend:** Python, FastAPI, Uvicorn
- **Desktop:** Electron
- **AI:** Ollama API
- **Styling:** Custom CSS with glassmorphism effects
- **Icons:** Font Awesome

## License

MIT License - See [LICENSE](LICENSE) for details.

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## Support

If you have any questions or issues, please open an issue on GitHub.

---

Made with ❤️ by byteSize-del
