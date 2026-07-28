const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  getAppVersion: () => ipcRenderer.invoke('app:getVersion'),
  chooseAndParseExcel: () => ipcRenderer.invoke('excel:chooseAndParse'),
  updates: {
    check: () => ipcRenderer.invoke('updates:check'),
    install: () => ipcRenderer.send('updates:install'),
    onStatus: (callback) => ipcRenderer.on('updates:status', (e, status) => callback(status)),
  },
  windowControls: {
    minimize: () => ipcRenderer.send('window:minimize'),
    toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
    close: () => ipcRenderer.send('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
    onMaximizeState: (callback) => ipcRenderer.on('window:maximize-state', (e, isMax) => callback(isMax)),
  },
});
