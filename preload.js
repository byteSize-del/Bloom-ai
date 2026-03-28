const { contextBridge, ipcRenderer } = require('electron');

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
  }
});
