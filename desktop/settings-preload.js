// Bridges the settings window to the main process (contextIsolation safe).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('lolbet', {
  getServerUrl: () => ipcRenderer.invoke('getServerUrl'),
  setServerUrl: (url) => ipcRenderer.invoke('setServerUrl', url),
});
