const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('api', {
  chooseAndParseExcel: () => ipcRenderer.invoke('excel:chooseAndParse'),
});
