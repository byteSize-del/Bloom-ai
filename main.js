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
  const isDev = !app.isPackaged;
  const backendPath = isDev
    ? path.join(__dirname, 'backend')
    : path.join(process.resourcesPath, 'app.asar.unpacked', 'backend');
  // Use bundled Python in production, local .venv in development
  const pythonExecutable = isDev
    ? path.join(__dirname, '.venv', 'Scripts', 'python.exe')
    : path.join(process.resourcesPath, 'venv', 'Scripts', 'python.exe');

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
  const appIconPath = app.isPackaged
    ? path.join(process.resourcesPath, 'icon.png')
    : path.join(__dirname, 'frontend', 'assets', 'icon.png');

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
    show: true,
    icon: appIconPath
  });

  // Load the frontend
  mainWindow.loadFile('frontend/index.html');

  // Focus the window when ready
  mainWindow.on('ready-to-show', () => {
    console.log('Window ready-to-show event fired');
    mainWindow.focus();
  });

  // Ensure window is focused on creation
  mainWindow.focus();

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

  mainWindow.on('maximize', () => {
    mainWindow.webContents.send('window/maximized', true);
  });

  mainWindow.on('unmaximize', () => {
    mainWindow.webContents.send('window/maximized', false);
  });

  mainWindow.on('enter-full-screen', () => {
    mainWindow.webContents.send('window/fullscreen', true);
  });

  mainWindow.on('leave-full-screen', () => {
    mainWindow.webContents.send('window/fullscreen', false);
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

// Request single instance lock before app readiness handlers
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  // Handle second instance (when user clicks app icon again)
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
      mainWindow.setAlwaysOnTop(true);
      setTimeout(() => mainWindow.setAlwaysOnTop(false), 100);
    } else {
      createWindow();
    }
  });

  app.whenReady().then(startBackendAndCreateWindow);
}

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
  } else {
    // Bring window to front when dock icon is clicked
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.focus();
    mainWindow.setAlwaysOnTop(true);
    setTimeout(() => mainWindow.setAlwaysOnTop(false), 100);
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

ipcMain.handle('window/minimize', async (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (window) {
    window.minimize();
  }
});

ipcMain.handle('window/toggle-maximize', async (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) return false;

  if (window.isMaximized()) {
    window.unmaximize();
  } else {
    window.maximize();
  }

  return window.isMaximized();
});

ipcMain.handle('window/close', async (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (window) {
    window.close();
  }
});

ipcMain.handle('window/is-maximized', async (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  return window ? window.isMaximized() : false;
});

ipcMain.handle('window/toggle-fullscreen', async (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) return false;
  window.setFullScreen(!window.isFullScreen());
  return window.isFullScreen();
});

ipcMain.handle('window/is-fullscreen', async (event) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  return window ? window.isFullScreen() : false;
});

ipcMain.handle('app/command', async (event, command) => {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window) return false;
  const webContents = window.webContents;

  switch (command) {
    case 'undo':
      webContents.undo();
      return true;
    case 'redo':
      webContents.redo();
      return true;
    case 'cut':
      webContents.cut();
      return true;
    case 'copy':
      webContents.copy();
      return true;
    case 'paste':
      webContents.paste();
      return true;
    case 'selectAll':
      webContents.selectAll();
      return true;
    case 'reload':
      webContents.reload();
      return true;
    case 'toggleDevTools':
      webContents.toggleDevTools();
      return true;
    default:
      return false;
  }
});

ipcMain.handle('system/open-app', async (event, appId) => {
  if (process.platform !== 'win32') {
    return { success: false, error: 'System app launch is currently supported on Windows only.' };
  }

  const normalized = String(appId || '').toLowerCase().trim();
  const appMap = {
    notepad: { command: 'notepad.exe', label: 'Notepad' },
    calculator: { command: 'calc.exe', label: 'Calculator' },
    explorer: { command: 'explorer.exe', label: 'File Explorer' },
    cmd: { command: 'cmd.exe', label: 'Command Prompt' },
    powershell: { command: 'powershell.exe', label: 'PowerShell' },
    vscode: { command: 'code', label: 'VS Code' }
  };

  const target = appMap[normalized];
  if (!target) {
    return { success: false, error: `Unsupported app command: ${normalized}` };
  }

  try {
    const child = spawn(target.command, [], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false
    });
    child.unref();
    return { success: true, app: normalized, label: target.label };
  } catch (error) {
    return { success: false, error: error.message || String(error) };
  }
});
