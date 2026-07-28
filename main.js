const { app, BrowserWindow, ipcMain, dialog, Menu } = require('electron');
const path = require('path');
const { autoUpdater } = require('electron-updater');
const { parseWorkbookFile } = require('./src/data-sync');

// No default File/Edit/View/Window menu — the custom in-page titlebar replaces it.
Menu.setApplicationMenu(null);

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    backgroundColor: '#0f1115',
    frame: false,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadFile('renderer/index.html');

  mainWindow.once('ready-to-show', () => {
    mainWindow.maximize();
    mainWindow.show();
  });

  mainWindow.on('maximize', () => mainWindow.webContents.send('window:maximize-state', true));
  mainWindow.on('unmaximize', () => mainWindow.webContents.send('window:maximize-state', false));

}

ipcMain.on('window:minimize', () => mainWindow.minimize());
ipcMain.on('window:toggle-maximize', () => {
  if (mainWindow.isMaximized()) mainWindow.unmaximize();
  else mainWindow.maximize();
});
ipcMain.on('window:close', () => mainWindow.close());
ipcMain.handle('window:is-maximized', () => mainWindow.isMaximized());
ipcMain.handle('app:getVersion', () => app.getVersion());

// Checks the update feed (see package.json "build.publish" — GitHub Releases on
// SudeshMaduwantha/yic-dashboard) and, if a newer version is found, downloads it.
// Status is forwarded to the renderer's Updates tab instead of a native dialog,
// so installing never interrupts whatever the user is doing until they choose to.
// No-op when running unpackaged (`npm start`) — there's no update metadata then.
function sendUpdateStatus(status) {
  if (mainWindow) mainWindow.webContents.send('updates:status', status);
}

function setupAutoUpdater() {
  if (!app.isPackaged) return;

  autoUpdater.on('checking-for-update', () => sendUpdateStatus({ state: 'checking' }));
  autoUpdater.on('update-available', (info) => sendUpdateStatus({ state: 'available', version: info.version }));
  autoUpdater.on('update-not-available', () => sendUpdateStatus({ state: 'not-available' }));
  autoUpdater.on('download-progress', (progress) => sendUpdateStatus({ state: 'downloading', percent: Math.round(progress.percent) }));
  autoUpdater.on('update-downloaded', (info) => sendUpdateStatus({ state: 'downloaded', version: info.version }));
  autoUpdater.on('error', (err) => {
    console.error('Auto-update check failed:', err);
    sendUpdateStatus({ state: 'error', message: err.message });
  });

  autoUpdater.checkForUpdates();
}

ipcMain.handle('updates:check', () => {
  if (!app.isPackaged) return { state: 'dev' };
  autoUpdater.checkForUpdates();
  return { state: 'checking' };
});
ipcMain.on('updates:install', () => autoUpdater.quitAndInstall());

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
