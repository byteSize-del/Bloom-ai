const { app, BrowserWindow, shell, dialog, ipcMain, clipboard } = require('electron');
const { spawn, spawnSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const os = require('os');
const http = require('http');

let mainWindow;
let backendProcess;
let ollamaProcessPid = null;
let ollamaStartedByBloom = false;
let ollamaShutdownAttempted = false;
const BACKEND_PORT = 8000;
const BACKEND_URL = `http://127.0.0.1:${BACKEND_PORT}`;
const OLLAMA_PORT = 11434;
const OLLAMA_URL = `http://127.0.0.1:${OLLAMA_PORT}`;
const OLLAMA_DOWNLOAD_URL = 'https://ollama.com/download';
const ALLOWED_EXTERNAL_HOSTS = new Set([
  'ollama.com',
  'www.ollama.com',
  'github.com',
  'www.github.com'
]);
const SYSTEM_BLOCKED_PATHS = [
  'C:\\Windows\\System32',
  'C:\\Windows\\SysWOW64',
  'C:\\Program Files',
  'C:\\Program Files (x86)',
  'C:\\ProgramData'
];
const SYSTEM_BLOCKED_COMMANDS = [
  'format',
  'del /f /s /q c:\\',
  'rm -rf',
  'shutdown',
  'taskkill /f /im',
  'reg delete',
  'bcdedit',
  'diskpart'
];
const MAX_AGENT_FILE_BYTES = 10 * 1024 * 1024;
const MAX_AGENT_COMMAND_TIMEOUT_MS = 30_000;

// Ensure data directory exists
const dataDir = path.join(app.getPath('appData'), 'OfflineAIChat', 'sessions');
if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
}

function resolvePythonExecutable(isDev) {
  const baseDir = isDev
    ? path.join(__dirname, '.venv')
    : path.join(process.resourcesPath, 'venv');

  const candidates = process.platform === 'win32'
    ? [
      path.join(baseDir, 'Scripts', 'python.exe'),
      path.join(baseDir, 'python.exe')
    ]
    : [
      path.join(baseDir, 'bin', 'python3'),
      path.join(baseDir, 'bin', 'python')
    ];

  const bundled = candidates.find((candidate) => fs.existsSync(candidate));
  if (bundled) {
    return bundled;
  }

  return process.platform === 'win32' ? 'python' : 'python3';
}

function parsePyVenvConfig(venvRoot) {
  try {
    const cfgPath = path.join(venvRoot, 'pyvenv.cfg');
    if (!fs.existsSync(cfgPath)) {
      return {};
    }

    const raw = fs.readFileSync(cfgPath, 'utf8');
    return raw.split(/\r?\n/).reduce((acc, line) => {
      const index = line.indexOf('=');
      if (index === -1) return acc;
      const key = line.slice(0, index).trim();
      const value = line.slice(index + 1).trim();
      if (key) {
        acc[key] = value;
      }
      return acc;
    }, {});
  } catch (error) {
    console.warn('Failed to parse pyvenv.cfg:', error.message);
    return {};
  }
}

function buildPythonLaunchCandidates(isDev, backendPath) {
  const venvRoot = isDev
    ? path.join(__dirname, '.venv')
    : path.join(process.resourcesPath, 'venv');
  const sitePackagesPath = process.platform === 'win32'
    ? path.join(venvRoot, 'Lib', 'site-packages')
    : path.join(venvRoot, 'lib', 'python3.12', 'site-packages');
  const bundledPython = resolvePythonExecutable(isDev);
  const pyvenv = parsePyVenvConfig(venvRoot);
  const existingPythonPath = process.env.PYTHONPATH
    ? `${backendPath}${path.delimiter}${sitePackagesPath}${path.delimiter}${process.env.PYTHONPATH}`
    : `${backendPath}${path.delimiter}${sitePackagesPath}`;
  const candidates = [];
  const seen = new Set();

  function pushCandidate(command, prefixArgs = [], label = command) {
    const key = `${command}::${prefixArgs.join(' ')}`;
    if (!command || seen.has(key)) {
      return;
    }
    seen.add(key);
    candidates.push({
      command,
      prefixArgs,
      label,
      env: {
        ...process.env,
        PYTHONPATH: existingPythonPath,
        DATA_DIR: dataDir
      }
    });
  }

  if (path.isAbsolute(bundledPython) && fs.existsSync(bundledPython)) {
    pushCandidate(bundledPython, [], 'bundled venv python');
  }

  const pyvenvExecutable = pyvenv.executable && fs.existsSync(pyvenv.executable)
    ? pyvenv.executable
    : null;
  const pyvenvHomePython = pyvenv.home
    ? path.join(pyvenv.home, process.platform === 'win32' ? 'python.exe' : 'python3')
    : null;

  if (pyvenvExecutable) {
    pushCandidate(pyvenvExecutable, [], 'system python from pyvenv executable');
  }
  if (pyvenvHomePython && fs.existsSync(pyvenvHomePython)) {
    pushCandidate(pyvenvHomePython, [], 'system python from pyvenv home');
  }

  if (process.platform === 'win32') {
    pushCandidate('py', ['-3.12'], 'py launcher 3.12');
    pushCandidate('py', ['-3'], 'py launcher 3.x');
    pushCandidate('python', [], 'python on PATH');
  } else {
    pushCandidate('python3', [], 'python3 on PATH');
    pushCandidate('python', [], 'python on PATH');
  }

  return candidates;
}

function isAllowedExternalUrl(url) {
  try {
    const parsed = new URL(url);
    if (!['https:', 'http:'].includes(parsed.protocol)) return false;
    return ALLOWED_EXTERNAL_HOSTS.has(parsed.hostname.toLowerCase());
  } catch {
    return false;
  }
}

function normalizeUserPath(rawPath) {
  const value = String(rawPath || '').trim().replace(/^["']|["']$/g, '');
  if (!value) {
    throw new Error('Path is required.');
  }
  return path.resolve(value);
}

function isBlockedSystemPath(targetPath) {
  const candidate = String(targetPath || '').toLowerCase().replace(/[\\\/]+$/, '');
  return SYSTEM_BLOCKED_PATHS.some((blockedPath) => {
    const blocked = blockedPath.toLowerCase().replace(/[\\\/]+$/, '');
    return candidate === blocked || candidate.startsWith(`${blocked}\\`);
  });
}

function isBlockedSystemCommand(command) {
  const normalized = String(command || '').trim().toLowerCase();
  return SYSTEM_BLOCKED_COMMANDS.some((blocked) => normalized.includes(blocked));
}

function isReadOnlyCommand(command) {
  const normalized = String(command || '').trim().toLowerCase();
  const readOnlyPrefixes = ['dir', 'ls', 'ipconfig', 'whoami', 'echo', 'type', 'cat', 'tasklist', 'systeminfo'];
  return readOnlyPrefixes.some((prefix) => normalized.startsWith(prefix))
    && !['>', 'del ', 'erase ', 'move ', 'copy ', 'ren ', 'mkdir ', 'rmdir ', 'remove-item', 'set-content', 'out-file'].some((token) => normalized.includes(token));
}

async function getSystemInfoPayload() {
  const runtime = await getRuntimeStatus();
  const totalMem = os.totalmem();
  const freeMem = os.freemem();

  return {
    ...runtime,
    cpuModel: os.cpus()?.[0]?.model || 'Unknown CPU',
    cpuCount: os.cpus()?.length || os.availableParallelism?.() || 0,
    totalMemoryBytes: totalMem,
    freeMemoryBytes: freeMem,
    usedMemoryBytes: Math.max(0, totalMem - freeMem),
    hostname: os.hostname(),
    username: os.userInfo().username
  };
}

function readFileSegment(targetPath, startLine = 1, endLine = 200) {
  const resolved = normalizeUserPath(targetPath);
  if (isBlockedSystemPath(resolved)) {
    throw new Error('This action was blocked because it targets a protected Windows path.');
  }
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isFile()) {
    throw new Error(`File not found: ${resolved}`);
  }

  const rawLines = fs.readFileSync(resolved, 'utf8').split(/\r?\n/);
  const safeStart = Math.max(1, Number(startLine) || 1);
  const safeEnd = Math.max(safeStart, Number(endLine) || (safeStart + 199));
  const excerpt = rawLines.slice(safeStart - 1, safeEnd);

  return {
    path: resolved,
    startLine: safeStart,
    endLine: Math.min(safeEnd, rawLines.length),
    content: excerpt.join('\n')
  };
}

function isOllamaResponsive() {
  return new Promise((resolve) => {
    const req = http.get(`${OLLAMA_URL}/api/tags`, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 500);
    });
    req.setTimeout(1500, () => {
      req.destroy();
      resolve(false);
    });
    req.on('error', () => resolve(false));
  });
}

function isBackendResponsive() {
  return new Promise((resolve) => {
    const req = http.get(`${BACKEND_URL}/health`, (res) => {
      res.resume();
      resolve(res.statusCode >= 200 && res.statusCode < 500);
    });
    req.setTimeout(1500, () => {
      req.destroy();
      resolve(false);
    });
    req.on('error', () => resolve(false));
  });
}

function getWindowsGpuInfo() {
  if (process.platform !== 'win32') {
    return null;
  }

  try {
    const probe = spawnSync(
      'powershell',
      [
        '-NoProfile',
        '-Command',
        "(Get-CimInstance Win32_VideoController | Select-Object -First 1 Name,AdapterRAM | ConvertTo-Json -Compress)"
      ],
      {
        windowsHide: true,
        encoding: 'utf8'
      }
    );

    if (probe.status !== 0 || !probe.stdout) {
      return null;
    }

    const parsed = JSON.parse(probe.stdout.trim());
    const name = String(parsed?.Name || '').trim();
    const adapterRam = Number(parsed?.AdapterRAM || 0);

    return {
      name: name || 'Unknown GPU',
      vramBytes: adapterRam,
      vramGb: adapterRam > 0 ? Number((adapterRam / (1024 ** 3)).toFixed(1)) : null
    };
  } catch (error) {
    console.warn('Failed to detect GPU info:', error.message);
    return null;
  }
}

async function getRuntimeStatus() {
  const [ollamaReady, backendReady] = await Promise.all([
    isOllamaResponsive(),
    isBackendResponsive()
  ]);

  const gpu = getWindowsGpuInfo();
  const modelsPath = path.join(os.homedir(), '.ollama', 'models');

  return {
    ollamaReady,
    backendReady,
    computeDevice: gpu ? 'GPU' : 'CPU',
    gpuName: gpu?.name || null,
    gpuVramGb: gpu?.vramGb ?? null,
    modelsPath,
    platform: process.platform,
    appVersion: app.getVersion()
  };
}

function resolveOllamaExecutable() {
  if (process.platform !== 'win32') {
    return null;
  }

  const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
  const candidates = [
    path.join(localAppData, 'Programs', 'Ollama', 'ollama.exe'),
    path.join(localAppData, 'Programs', 'Ollama', 'Ollama.exe')
  ];

  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }

  try {
    const whereResult = spawnSync('where', ['ollama'], {
      windowsHide: true,
      encoding: 'utf8'
    });

    if (whereResult.status === 0 && typeof whereResult.stdout === 'string') {
      const first = whereResult.stdout
        .split(/\r?\n/)
        .map((line) => line.trim())
        .find(Boolean);
      if (first && fs.existsSync(first)) {
        return first;
      }
    }
  } catch (error) {
    console.warn('Failed to resolve Ollama from PATH:', error.message);
  }

  return null;
}

function startOllamaInBackground(ollamaExecutable) {
  try {
    const child = spawn(ollamaExecutable, ['serve'], {
      detached: true,
      stdio: 'ignore',
      windowsHide: true
    });
    ollamaProcessPid = Number(child.pid) || null;
    ollamaStartedByBloom = true;
    child.unref();
    return true;
  } catch (error) {
    console.error('Failed to start Ollama in background:', error);
    ollamaProcessPid = null;
    ollamaStartedByBloom = false;
    return false;
  }
}

function stopOllamaStartedByBloom() {
  if (!ollamaStartedByBloom || ollamaShutdownAttempted) {
    return;
  }
  ollamaShutdownAttempted = true;

  const pid = Number(ollamaProcessPid || 0);
  if (!pid) {
    console.warn('Bloom started Ollama, but no PID was captured for shutdown.');
    return;
  }

  try {
    if (process.platform === 'win32') {
      const stopResult = spawnSync('taskkill', ['/PID', String(pid), '/T', '/F'], {
        windowsHide: true,
        encoding: 'utf8'
      });
      if (stopResult.status !== 0) {
        const errorText = (stopResult.stderr || stopResult.stdout || '').trim();
        console.warn(`Failed to stop Ollama PID ${pid}: ${errorText || 'unknown taskkill error'}`);
      } else {
        console.log(`Stopped Ollama process started by Bloom (PID ${pid}).`);
      }
    } else {
      process.kill(pid, 'SIGTERM');
      console.log(`Stopped Ollama process started by Bloom (PID ${pid}).`);
    }
  } catch (error) {
    console.warn(`Error while stopping Ollama PID ${pid}:`, error.message);
  } finally {
    ollamaProcessPid = null;
    ollamaStartedByBloom = false;
  }
}

async function waitForOllamaReady(timeoutMs = 15000) {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (await isOllamaResponsive()) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return false;
}

async function promptInstallOllama() {
  await dialog.showMessageBox({
    type: 'warning',
    buttons: ['Install Ollama'],
    defaultId: 0,
    cancelId: 0,
    noLink: true,
    title: 'Ollama Required',
    message: 'Ollama was not found on this PC.',
    detail: 'Bloom needs Ollama for local model chat. Click Install Ollama to open the official installer page.'
  });
  await shell.openExternal(OLLAMA_DOWNLOAD_URL);
}

async function ensureOllamaRunningInBackground() {
  if (await isOllamaResponsive()) {
    ollamaStartedByBloom = false;
    ollamaProcessPid = null;
    return true;
  }

  const ollamaExecutable = resolveOllamaExecutable();
  if (!ollamaExecutable) {
    await promptInstallOllama();
    return false;
  }

  const started = startOllamaInBackground(ollamaExecutable);
  if (!started) {
    await promptInstallOllama();
    return false;
  }

  const ready = await waitForOllamaReady();
  if (!ready) {
    console.warn('Ollama launch command issued, but service did not respond in time.');
  }
  return ready;
}

function waitForBackendHealth(childProcess, timeoutMs = 15000) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let stderrBuffer = '';
    let stdoutBuffer = '';
    let checkInterval = null;
    let timeoutHandle = null;

    const cleanup = () => {
      if (checkInterval) clearInterval(checkInterval);
      if (timeoutHandle) clearTimeout(timeoutHandle);
      childProcess.stdout?.off('data', onStdout);
      childProcess.stderr?.off('data', onStderr);
      childProcess.off('close', onClose);
      childProcess.off('error', onError);
    };

    const finish = (fn, value) => {
      if (settled) return;
      settled = true;
      cleanup();
      fn(value);
    };

    const onStdout = (data) => {
      stdoutBuffer += data.toString();
      stdoutBuffer = stdoutBuffer.slice(-4000);
      console.log(`Backend: ${data.toString()}`);
    };

    const onStderr = (data) => {
      stderrBuffer += data.toString();
      stderrBuffer = stderrBuffer.slice(-4000);
      console.error(`Backend Error: ${data.toString()}`);
    };

    const onClose = (code) => {
      finish(reject, new Error(`Backend process exited with code ${code}. ${stderrBuffer || stdoutBuffer || 'No diagnostic output.'}`));
    };

    const onError = (error) => {
      finish(reject, error);
    };

    childProcess.stdout?.on('data', onStdout);
    childProcess.stderr?.on('data', onStderr);
    childProcess.on('close', onClose);
    childProcess.on('error', onError);

    checkInterval = setInterval(() => {
      http.get(`${BACKEND_URL}/health`, (res) => {
        res.resume();
        if (res.statusCode >= 200 && res.statusCode < 500) {
          finish(resolve);
        }
      }).on('error', () => {
        // Backend not ready yet
      });
    }, 500);

    timeoutHandle = setTimeout(() => {
      finish(reject, new Error(`Backend failed to start within ${Math.round(timeoutMs / 1000)} seconds. ${stderrBuffer || stdoutBuffer || 'No diagnostic output.'}`));
    }, timeoutMs);
  });
}

async function createBackend() {
  const isDev = !app.isPackaged;
  const backendPath = isDev
    ? path.join(__dirname, 'backend')
    : path.join(process.resourcesPath, 'app.asar.unpacked', 'backend');
  console.log(`Starting backend server from: ${backendPath}`);
  const candidates = buildPythonLaunchCandidates(isDev, backendPath);
  let lastError = null;

  for (const candidate of candidates) {
    console.log(`Trying backend launch with ${candidate.label}: ${candidate.command} ${candidate.prefixArgs.join(' ')}`.trim());
    const child = spawn(
      candidate.command,
      [...candidate.prefixArgs, '-m', 'uvicorn', 'main:app', '--host', '127.0.0.1', '--port', String(BACKEND_PORT)],
      {
        cwd: backendPath,
        env: candidate.env,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true
      }
    );

    console.log(`Backend process PID: ${child.pid}`);
    backendProcess = child;

    try {
      await waitForBackendHealth(child, 15000);
      console.log(`Backend is ready via ${candidate.label}!`);
      return;
    } catch (error) {
      lastError = error;
      console.error(`Backend launch failed via ${candidate.label}:`, error.message || error);
      try {
        if (!child.killed) {
          child.kill('SIGTERM');
        }
      } catch {
        // Ignore cleanup errors.
      }
      backendProcess = null;
    }
  }

  throw lastError || new Error('No usable Python runtime was found for the backend.');
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
      webSecurity: true,
      sandbox: true
    },
    titleBarStyle: 'hidden',
    title: 'Bloom AI Chat',
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
    if (isAllowedExternalUrl(url)) {
      shell.openExternal(url);
    } else {
      console.warn(`Blocked external URL: ${url}`);
    }
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

    // Ensure Ollama is available and running in background.
    const ollamaReady = await ensureOllamaRunningInBackground();
    if (!ollamaReady) {
      dialog.showErrorBox(
        'Ollama Not Ready',
        'Bloom could not start Ollama automatically. Install or open Ollama, then relaunch Bloom.'
      );
    }

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
    stopOllamaStartedByBloom();
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
  stopOllamaStartedByBloom();
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

ipcMain.handle('file/choose-skill', async () => {
  const result = dialog.showOpenDialogSync(mainWindow, {
    title: 'Import Skill File',
    properties: ['openFile'],
    filters: [
      { name: 'Skill Files', extensions: ['md', 'txt', 'json'] },
      { name: 'All Files', extensions: ['*'] }
    ]
  });

  if (!result || !result.length) {
    return null;
  }

  const skillPath = result[0];
  try {
    const raw = fs.readFileSync(skillPath, 'utf8');
    return {
      path: skillPath,
      name: path.basename(skillPath, path.extname(skillPath)),
      content: raw
    };
  } catch (error) {
    return {
      error: error.message || String(error)
    };
  }
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

ipcMain.handle('shell/open-path', async (_event, targetPath) => {
  const rawPath = String(targetPath || '').trim();
  if (!rawPath) {
    return { success: false, error: 'Path is empty' };
  }

  try {
    const result = await shell.openPath(rawPath);
    if (result) {
      return { success: false, error: result };
    }
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message || String(error) };
  }
});

ipcMain.handle('shell/open-external', async (_event, targetUrl) => {
  const url = String(targetUrl || '').trim();
  if (!isAllowedExternalUrl(url)) {
    return { success: false, error: 'Blocked external URL' };
  }

  try {
    await shell.openExternal(url);
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message || String(error) };
  }
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
    browser: { command: 'cmd.exe', args: ['/c', 'start', ''], label: 'Browser' },
    chrome: { command: 'cmd.exe', args: ['/c', 'start', 'chrome'], label: 'Chrome' },
    explorer: { command: 'explorer.exe', label: 'File Explorer' },
    cmd: { command: 'cmd.exe', label: 'Command Prompt' },
    powershell: { command: 'powershell.exe', label: 'PowerShell' },
    vscode: { command: 'code', label: 'VS Code' },
    paint: { command: 'mspaint.exe', label: 'Paint' },
    taskmgr: { command: 'taskmgr.exe', label: 'Task Manager' },
    settings: { command: 'cmd.exe', args: ['/c', 'start', 'ms-settings:'], label: 'Windows Settings' },
    spotify: { command: 'spotify', label: 'Spotify' },
    discord: { command: 'discord', label: 'Discord' },
    word: { command: 'winword', label: 'Microsoft Word' },
    excel: { command: 'excel', label: 'Microsoft Excel' }
  };

  const target = appMap[normalized];
  if (!target) {
    return { success: false, error: `Unsupported app command: ${normalized}` };
  }

  try {
    const child = spawn(target.command, target.args || [], {
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

ipcMain.handle('system/get-runtime-status', async () => {
  return await getRuntimeStatus();
});

ipcMain.handle('system/get-info', async () => {
  try {
    return { success: true, data: await getSystemInfoPayload() };
  } catch (error) {
    return { success: false, error: error.message || String(error) };
  }
});

ipcMain.handle('system/list-dir', async (_event, targetPath) => {
  try {
    const resolved = normalizeUserPath(targetPath);
    if (isBlockedSystemPath(resolved)) {
      throw new Error('This action was blocked because it targets a protected Windows path.');
    }
    if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
      throw new Error(`Directory not found: ${resolved}`);
    }

    const entries = fs.readdirSync(resolved, { withFileTypes: true })
      .slice(0, 150)
      .map((entry) => {
        const fullPath = path.join(resolved, entry.name);
        const stat = fs.statSync(fullPath);
        return {
          name: entry.name,
          type: entry.isDirectory() ? 'directory' : 'file',
          size: entry.isDirectory() ? null : stat.size
        };
      });

    return { success: true, path: resolved, entries };
  } catch (error) {
    return { success: false, error: error.message || String(error) };
  }
});

ipcMain.handle('system/read-file', async (_event, targetPath, startLine = 1, endLine = 200) => {
  try {
    return { success: true, ...readFileSegment(targetPath, startLine, endLine) };
  } catch (error) {
    return { success: false, error: error.message || String(error) };
  }
});

ipcMain.handle('system/write-file', async (_event, targetPath, content) => {
  try {
    const resolved = normalizeUserPath(targetPath);
    if (isBlockedSystemPath(resolved)) {
      throw new Error('This action was blocked because it targets a protected Windows path.');
    }
    const payload = String(content || '');
    if (Buffer.byteLength(payload, 'utf8') > MAX_AGENT_FILE_BYTES) {
      throw new Error("This action was blocked because the file is larger than Bloom's safe write limit.");
    }
    fs.mkdirSync(path.dirname(resolved), { recursive: true });
    fs.writeFileSync(resolved, payload, 'utf8');
    return { success: true, path: resolved, bytesWritten: Buffer.byteLength(payload, 'utf8') };
  } catch (error) {
    return { success: false, error: error.message || String(error) };
  }
});

ipcMain.handle('system/run-command', async (_event, command) => {
  try {
    const normalized = String(command || '').trim();
    if (!normalized) {
      throw new Error('Command is required.');
    }
    if (isBlockedSystemCommand(normalized)) {
      throw new Error('This action was blocked because the command could damage the system.');
    }
    const completed = spawnSync('cmd.exe', ['/c', normalized], {
      windowsHide: true,
      encoding: 'utf8',
      timeout: MAX_AGENT_COMMAND_TIMEOUT_MS
    });
    return {
      success: true,
      command: normalized,
      readOnly: isReadOnlyCommand(normalized),
      exitCode: completed.status ?? completed.statusCode ?? 0,
      stdout: completed.stdout || '',
      stderr: completed.stderr || ''
    };
  } catch (error) {
    return { success: false, error: error.message || String(error) };
  }
});

ipcMain.handle('system/read-clipboard', async () => {
  try {
    return { success: true, content: clipboard.readText() };
  } catch (error) {
    return { success: false, error: error.message || String(error) };
  }
});

ipcMain.handle('system/write-clipboard', async (_event, text) => {
  try {
    clipboard.writeText(String(text || ''));
    return { success: true };
  } catch (error) {
    return { success: false, error: error.message || String(error) };
  }
});

ipcMain.handle('system/get-processes', async () => {
  try {
    const completed = spawnSync('tasklist', [], {
      windowsHide: true,
      encoding: 'utf8',
      timeout: MAX_AGENT_COMMAND_TIMEOUT_MS
    });
    return { success: true, output: completed.stdout || completed.stderr || '' };
  } catch (error) {
    return { success: false, error: error.message || String(error) };
  }
});

ipcMain.handle('system/open-audit-log', async () => {
  const auditLogPath = path.join(app.getPath('appData'), 'OfflineAIChat', 'agent_audit.jsonl');
  try {
    fs.mkdirSync(path.dirname(auditLogPath), { recursive: true });
    if (!fs.existsSync(auditLogPath)) {
      fs.writeFileSync(auditLogPath, '', 'utf8');
    }
    const child = spawn('notepad.exe', [auditLogPath], {
      detached: true,
      stdio: 'ignore',
      windowsHide: false
    });
    child.unref();
    return { success: true, path: auditLogPath };
  } catch (error) {
    return { success: false, error: error.message || String(error) };
  }
});
