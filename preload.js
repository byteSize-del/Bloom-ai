// Preload scripts for Bloom AI Chat
// Expose protected IPC renderer methods to the web page

const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer to use IPC
// without exposing the entire ipcRenderer to the window
contextBridge.exposeInMainWorld('electronAPI', {
  // Example: copy to clipboard
  copyToClipboard: (text) => ipcRenderer.invoke('copy-to-clipboard'),
  // Example: get app version
  getAppVersion: () => ipcRenderer.invoke('get-app-version'),
  // Example: check if dev
  isDev: () => ipcRenderer.invoke('is-dev'),
  // Example: open external link
  openExternal: (url) => shell.openExternal(url),
  // Example: show open dialog
  showOpenDialog: () => ipcRenderer.invoke('show-open-dialog'),
  // Example: show save dialog
  showSaveDialog: () => ipcRenderer.invoke('show-save-dialog'),
  // Example: send a message to main process and get response
  invoke: (channel, ...args) => ipcRenderer.invoke(channel, ...args),
  // Example: listen to an event from main process
  on: (channel, listener) => {
    const subscription = (_event, ...args) => listener(...args);
    ipcRenderer.on(channel, subscription);
    return () => {
      ipcRenderer.removeListener(channel, subscription);
    };
  },
  // Example: remove listener
  removeListener: (channel, listener) => {
    ipcRenderer.removeListener(channel, listener);
  }
});

// Also expose the shell and clipboard if needed (but be cautious)
// We can expose specific safe methods
contextBridge.exposeInMainWorld('shell', {
  openExternal: (url) => require('electron').shell.openExternal(url)
});

contextBridge.exposeInMainWorld('clipboard', {
  writeText: (text) => require('electron').clipboard.writeText(text),
  readText: () => require('electron').clipboard.readText()
});

// Expose protected methods that allow the renderer process to use
// the IPC renderer without exposing the entire Node.js API

// Chat API
contextBridge.exposeInMainWorld('chatAPI', {
  sendMessage: async (message, model, history) => {
    return await ipcRenderer.invoke('chat/send-message', message, model, history);
  },
  getModels: async () => {
    return await ipcRenderer.invoke('chat/get-models');
  },
  saveHistory: async (sessionId, sessionData) => {
    return await ipcRenderer.invoke('chat/save-history', sessionId, sessionData);
  },
  loadHistory: async () => {
    return await ipcRenderer.invoke('chat/load-history');
  },
  loadSession: async (sessionId) => {
    return await ipcRenderer.invoke('chat/load-session', sessionId);
  },
  deleteSession: async (sessionId) => {
    return await ipcRenderer.invoke('chat/delete-session', sessionId);
  },
  generateTitle: async (messages) => {
    return await ipcRenderer.invoke('chat/generate-title', messages);
  }
});

// Settings
contextBridge.exposeInMainWorld('settingsAPI', {
  getSettings: async () => {
    return await ipcRenderer.invoke('settings/get');
  },
  saveSettings: async (settings) => {
    return await ipcRenderer.invoke('settings/save', settings);
  }
});

// File operations
contextBridge.exposeInMainWorld('fileAPI', {
  chooseDirectory: async () => {
    return await ipcRenderer.invoke('file/choose-directory');
  },
  chooseSkillFile: async () => {
    return await ipcRenderer.invoke('file/choose-skill');
  }
});

// Environment info
contextBridge.exposeInMainWorld('envInfo', {
  isPackaged: () => process.env.ELECTRON_IS_PACKAGED === 'true',
  platform: process.platform,
  arch: process.arch
});

// Window controls
contextBridge.exposeInMainWorld('windowControls', {
  minimize: async () => {
    return await ipcRenderer.invoke('window/minimize');
  },
  toggleMaximize: async () => {
    return await ipcRenderer.invoke('window/toggle-maximize');
  },
  close: async () => {
    return await ipcRenderer.invoke('window/close');
  },
  isMaximized: async () => {
    return await ipcRenderer.invoke('window/is-maximized');
  },
  toggleFullscreen: async () => {
    return await ipcRenderer.invoke('window/toggle-fullscreen');
  },
  isFullscreen: async () => {
    return await ipcRenderer.invoke('window/is-fullscreen');
  },
  onMaximizedChange: (callback) => {
    ipcRenderer.on('window/maximized', (_event, isMaximized) => callback(Boolean(isMaximized)));
  },
  onFullscreenChange: (callback) => {
    ipcRenderer.on('window/fullscreen', (_event, isFullscreen) => callback(Boolean(isFullscreen)));
  }
});

contextBridge.exposeInMainWorld('appCommands', {
  run: async (command) => {
    return await ipcRenderer.invoke('app/command', command);
  }
});

contextBridge.exposeInMainWorld('systemAPI', {
  openApp: async (appId) => {
    return await ipcRenderer.invoke('system/open-app', appId);
  },
  getRuntimeStatus: async () => {
    return await ipcRenderer.invoke('system/get-runtime-status');
  },
  getInfo: async () => {
    return await ipcRenderer.invoke('system/get-info');
  },
  listDir: async (targetPath) => {
    return await ipcRenderer.invoke('system/list-dir', targetPath);
  },
  readFile: async (targetPath, startLine, endLine) => {
    return await ipcRenderer.invoke('system/read-file', targetPath, startLine, endLine);
  },
  writeFile: async (targetPath, content) => {
    return await ipcRenderer.invoke('system/write-file', targetPath, content);
  },
  runCommand: async (command) => {
    return await ipcRenderer.invoke('system/run-command', command);
  },
  readClipboard: async () => {
    return await ipcRenderer.invoke('system/read-clipboard');
  },
  writeClipboard: async (text) => {
    return await ipcRenderer.invoke('system/write-clipboard', text);
  },
  getProcesses: async () => {
    return await ipcRenderer.invoke('system/get-processes');
  },
  openAuditLog: async () => {
    return await ipcRenderer.invoke('system/open-audit-log');
  }
});

contextBridge.exposeInMainWorld('shellAPI', {
  openPath: async (targetPath) => {
    return await ipcRenderer.invoke('shell/open-path', targetPath);
  },
  openExternal: async (targetUrl) => {
    return await ipcRenderer.invoke('shell/open-external', targetUrl);
  }
});
