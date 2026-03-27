const { contextBridge, ipcRenderer } = require('electron');

// Expose protected methods that allow the renderer process to use
// the IPC renderer without exposing the entire Node.js API

// Backend control
contextBridge.exposeInMainWorld('backendAPI', {
  startBackend: async () => {
    return await ipcRenderer.invoke('start-backend');
  },
  stopBackend: async () => {
    return await ipcRenderer.invoke('stop-backend');
  },
  isBackendReady: async () => {
    return await ipcRenderer.invoke('is-backend-ready');
  }
});

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
