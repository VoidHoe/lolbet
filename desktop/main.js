// lolbet desktop client — a normal taskbar window (like a browser) that loads
// the shared lolbet server. The server URL is configurable (Serveur… menu) and
// persisted via electron-store; defaults to a local dev server.

const { app, BrowserWindow, Menu, ipcMain } = require('electron');
const path = require('path');
const Store = require('electron-store');

const store = new Store();
const DEFAULT_URL = 'http://localhost:3000';

let win;
let settingsWin;

function loadServer() {
  const url = store.get('serverUrl', DEFAULT_URL);
  win.loadURL(url).catch(() => win.loadFile(path.join(__dirname, 'settings.html')));
}

function buildMenu() {
  return Menu.buildFromTemplate([
    {
      label: 'lolbet',
      submenu: [
        { label: 'Serveur…', accelerator: 'CmdOrCtrl+,', click: openSettings },
        { label: 'Recharger', accelerator: 'CmdOrCtrl+R', click: () => loadServer() },
        { type: 'separator' },
        { role: 'quit', label: 'Quitter' },
      ],
    },
    { label: 'Édition', submenu: [{ role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }] },
    { label: 'Affichage', submenu: [{ role: 'togglefullscreen' }, { role: 'toggleDevTools' }] },
  ]);
}

function createWindow() {
  win = new BrowserWindow({
    width: 1100,
    height: 780,
    minWidth: 820,
    minHeight: 600,
    title: 'lolbet',
    backgroundColor: '#0e1015',
    autoHideMenuBar: false,
    webPreferences: { contextIsolation: true },
  });
  Menu.setApplicationMenu(buildMenu());
  loadServer();
}

function openSettings() {
  settingsWin = new BrowserWindow({
    width: 460,
    height: 240,
    parent: win,
    modal: true,
    title: 'Serveur lolbet',
    backgroundColor: '#0e1015',
    resizable: false,
    webPreferences: { preload: path.join(__dirname, 'settings-preload.js'), contextIsolation: true },
  });
  settingsWin.setMenu(null);
  settingsWin.loadFile(path.join(__dirname, 'settings.html'));
}

ipcMain.handle('getServerUrl', () => store.get('serverUrl', DEFAULT_URL));
ipcMain.handle('setServerUrl', (_e, url) => {
  if (url) store.set('serverUrl', url);
  if (settingsWin) settingsWin.close();
  loadServer();
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
