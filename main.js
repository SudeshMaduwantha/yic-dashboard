const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');
const { parseWorkbookFile } = require('./src/data-sync');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: '#0f1115',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile('renderer/index.html');
}

// Checks the update feed (see package.json "build.publish") and, if a newer
// version is found, downloads it and asks to restart. No-op when running
// unpackaged (`npm start`) — there's no update metadata to check against then.
function setupAutoUpdater() {
  if (!app.isPackaged) return;

  autoUpdater.on('update-downloaded', () => {
    dialog.showMessageBox(mainWindow, {
      type: 'info',
      title: 'Update ready',
      message: 'A new version of YIC Sport School has been downloaded. Restart now to apply it?',
      buttons: ['Restart now', 'Later'],
      defaultId: 0,
    }).then((result) => {
      if (result.response === 0) autoUpdater.quitAndInstall();
    });
  });

  autoUpdater.on('error', (err) => {
    console.error('Auto-update check failed:', err);
  });

  autoUpdater.checkForUpdates();
}

app.whenReady().then(() => {
  createWindow();
  setupAutoUpdater();
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) createWindow();
});

// One-time historical import: pick an Excel file, parse it, hand the data to the
// renderer, which writes it into Firestore.
ipcMain.handle('excel:chooseAndParse', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Select the Excel file to import',
    filters: [{ name: 'Excel Workbook', extensions: ['xlsx'] }],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths[0]) return null;
  return parseWorkbookFile(result.filePaths[0]);
});
