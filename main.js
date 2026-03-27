const { app, BrowserWindow, shell, dialog, ipcMain } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');

let mainWindow;
let backendProcess;
const BACKEND_PORT = 8000;
const BACKEND_URL = `http://127.0.0.1:${BACKEND_PORT}`;

// Ensure data directory exists
const dataDir = path.join(app.getPath('appData'), 'OfflineAIChat', 'sessions');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

function createBackend() {
  const backendPath = path.join(__dirname, 'backend');
  // Use the Python from .venv first, fallback to system Python
  const pythonExecutable = path.join(__dirname, '.venv', 'Scripts', 'python.exe');

  console.log(`Starting backend server from: ${backendPath}`);
  console.log(`Using Python: ${pythonExecutable}`);

  // Check if Python executable exists
  if (!fs.existsSync(pythonExecutable)) {
    console.error(`Python executable not found at: ${pythonExecutable}`);
    // Fallback to system Python
    const systemPython = spawn('python', ['--version'], { stdio: 'pipe' });
    systemPython.on('error', () => {
      console.error('System Python not found either!');
    });
  }

  backendProcess = spawn(pythonExecutable, ['-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', String(BACKEND_PORT)], {
    cwd: backendPath,
    env: {
      ...process.env,
      PYTHONPATH: backendPath,
      DATA_DIR: dataDir
    },
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true
  });

  console.log(`Backend process PID: ${backendProcess.pid}`);

  backendProcess.on('spawn', () => {
    console.log(`Backend process spawned successfully: PID ${backendProcess.pid}`);
  });

  backendProcess.stdout.on('data', (data) => {
    console.log(`Backend: ${data.toString()}`);
  });

  backendProcess.stderr.on('data', (data) => {
    console.error(`Backend Error: ${data.toString()}`);
  });

  backendProcess.on('close', (code) => {
    console.log(`Backend process exited with code ${code}`);
  });

  backendProcess.on('error', (error) => {
    console.error('Failed to start backend:', error);
  });

  return new Promise((resolve, reject) => {
    // Wait for backend to be ready
    const checkInterval = setInterval(() => {
      const http = require('http');
      http.get(`${BACKEND_URL}/health`, (res) => {
        clearInterval(checkInterval);
        console.log('Backend is ready!');
        resolve();
      }).on('error', () => {
        // Backend not ready yet
      });
    }, 500);

    // Timeout after 60 seconds
    setTimeout(() => {
      clearInterval(checkInterval);
      reject(new Error('Backend failed to start within 60 seconds'));
    }, 60000);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 800,
    minHeight: 600,
    backgroundColor: '#0d0d0d',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
      webSecurity: true
    },
    titleBarStyle: 'hidden',
    title: 'Offline AI Chat',
    show: false,
    icon: path.join(__dirname, 'frontend', 'assets', 'icon.png')
  });

  // Load the frontend
  mainWindow.loadFile('frontend/index.html');

  // Show window when ready
  mainWindow.on('ready-to-show', () => {
    console.log('Window ready-to-show event fired');
    mainWindow.show();
  });

  // Fallback: show window after 5 seconds even if ready-to-show didn't fire
  setTimeout(() => {
    if (mainWindow && !mainWindow.isVisible()) {
      console.log('Fallback: showing window after timeout');
      mainWindow.show();
    }
  }, 5000);

  // Handle external links in default browser
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });

  // Context menu
  mainWindow.webContents.on('context-menu', (event, params) => {
    const menuTemplate = [];

    if (params.isEditable) {
      menuTemplate.push({ label: 'Cut', role: 'cut' });
      menuTemplate.push({ label: 'Copy', role: 'copy' });
      menuTemplate.push({ label: 'Paste', role: 'paste' });
      menuTemplate.push({ type: 'separator' });
    }

    menuTemplate.push(
      { label: 'Select All', role: 'selectAll' },
      { type: 'separator' },
      { label: 'Reload Page', role: 'reload' }
    );

    const { Menu } = require('electron');
    const menu = Menu.buildFromTemplate(menuTemplate);
    menu.popup({ window: mainWindow, x: params.x, y: params.y });
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

async function startBackendAndCreateWindow() {
  try {
    // Create window first so user sees something
    createWindow();

    // Start backend in background with timeout
    const backendPromise = createBackend();
    const timeoutPromise = new Promise((resolve) => {
      setTimeout(() => resolve({ error: 'timeout' }), 15000);
    });

    const result = await Promise.race([backendPromise, timeoutPromise]);

    if (result?.error === 'timeout') {
      console.warn('Backend startup timed out, showing window anyway');
      dialog.showErrorBox('Backend Warning', 'The backend server took too long to start. The app will continue but some features may not work.\n\nPlease ensure Ollama is running and Python backend dependencies are installed.');
    }
  } catch (error) {
    console.error('Startup failed:', error);
    // Show error but keep window open
    dialog.showErrorBox('Startup Error', `Failed to start backend: ${error.message}\n\nThe app will continue but AI features may not work. Check console for details.`);
  }
}

app.whenReady().then(startBackendAndCreateWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    if (backendProcess && !backendProcess.killed) {
      backendProcess.kill('SIGTERM');
    }
    app.quit();
  }
});

app.on('activate', () => {
  if (mainWindow === null) {
    createWindow();
  }
});

// Clean up on quit
app.on('before-quit', () => {
  if (backendProcess && !backendProcess.killed) {
    console.log('Stopping backend server...');
    backendProcess.kill('SIGTERM');
  }
});

// IPC Handlers for communication between main and renderer
ipcMain.handle('chat/send-message', async (event, message, model, history) => {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify({
      message,
      model,
      history,
      temperature: 0.7,
      system_prompt: ''
    });

    const options = {
      hostname: '127.0.0.1',
      port: BACKEND_PORT,
      path: '/chat',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => { resolve(JSON.parse(data)); });
    });

    req.on('error', (e) => { reject(e); });
    req.write(postData);
  });
});

ipcMain.handle('chat/get-models', async () => {
  return new Promise((resolve, reject) => {
    http.get(`${BACKEND_URL}/models`, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => { resolve(JSON.parse(data)); });
    }).on('error', (e) => { reject(e); });
  });
});

ipcMain.handle('chat/save-history', async (event, sessionId, sessionData) => {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(sessionData);
    const options = {
      hostname: '127.0.0.1',
      port: BACKEND_PORT,
      path: '/history/save',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => { resolve(JSON.parse(data)); });
    });

    req.on('error', (e) => { reject(e); });
    req.write(postData);
  });
});

ipcMain.handle('chat/load-history', async () => {
  return new Promise((resolve, reject) => {
    http.get(`${BACKEND_URL}/history/load`, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => { resolve(JSON.parse(data)); });
    }).on('error', (e) => { reject(e); });
  });
});

ipcMain.handle('chat/load-session', async (event, sessionId) => {
  return new Promise((resolve, reject) => {
    http.get(`${BACKEND_URL}/history/${sessionId}`, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => { resolve(JSON.parse(data)); });
    }).on('error', (e) => { reject(e); });
  });
});

ipcMain.handle('chat/delete-session', async (event, sessionId) => {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: '127.0.0.1',
      port: BACKEND_PORT,
      path: `/history/${sessionId}`,
      method: 'DELETE'
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => { resolve(JSON.parse(data)); });
    });

    req.on('error', (e) => { reject(e); });
    req.end();
  });
});

ipcMain.handle('chat/generate-title', async (event, messages) => {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(messages);
    const options = {
      hostname: '127.0.0.1',
      port: BACKEND_PORT,
      path: '/history/generate-title',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => { resolve(JSON.parse(data)); });
    });

    req.on('error', (e) => { reject(e); });
    req.write(postData);
  });
});

ipcMain.handle('settings/get', async () => {
  return new Promise((resolve, reject) => {
    http.get(`${BACKEND_URL}/settings`, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => { resolve(JSON.parse(data)); });
    }).on('error', (e) => { reject(e); });
  });
});

ipcMain.handle('settings/save', async (event, settings) => {
  return new Promise((resolve, reject) => {
    const postData = JSON.stringify(settings);
    const options = {
      hostname: '127.0.0.1',
      port: BACKEND_PORT,
      path: '/settings',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData)
      }
    };

    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => { resolve(JSON.parse(data)); });
    });

    req.on('error', (e) => { reject(e); });
    req.write(postData);
  });
});

ipcMain.handle('file/choose-directory', async () => {
  const result = dialog.showOpenDialogSync(mainWindow, {
    properties: ['openDirectory']
  });
  return result || [];
});
