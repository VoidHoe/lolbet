// lolbet desktop client — a normal taskbar window (like a browser) that loads
// the shared lolbet server. The server URL is configurable (Serveur… menu) and
// persisted via electron-store; defaults to a local dev server.

const { app, BrowserWindow, Menu, ipcMain } = require('electron');
const path = require('path');
const Store = require('electron-store');

const store = new Store();
// Shared backend baked in so a fresh install just works (zero config). The
// "Serveur…" menu can override it for local dev or a different server.
const DEFAULT_URL = 'https://lolbet-production.up.railway.app';

let win;
let settingsWin;

// Accept a bare domain ("host.app") and turn it into a loadable URL. loadURL
// rejects anything without a scheme with ERR_INVALID_URL, so we always add one.
function normalizeUrl(u) {
  u = String(u || '').trim();
  if (!u) return DEFAULT_URL;
  return /^https?:\/\//i.test(u) ? u : `https://${u}`;
}

function loadServer() {
  const url = normalizeUrl(store.get('serverUrl', DEFAULT_URL));
  // NOTE: do NOT .catch() loadURL — it rejects with ERR_ABORTED (-3) on benign
  // redirects/superseded loads even when the page loads fine. Real failures are
  // handled by the did-fail-load listener below.
  win.loadURL(url);
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

  // Only fall back to settings on a REAL main-frame load failure. ERR_ABORTED
  // (-3) fires spuriously on redirects/superseded loads — ignore it.
  win.webContents.on('did-fail-load', (_e, errorCode, errorDesc, validatedURL, isMainFrame) => {
    if (isMainFrame && errorCode !== -3) {
      console.error('[load] échec', errorCode, errorDesc, validatedURL);
      win.loadFile(path.join(__dirname, 'settings.html'));
    }
  });

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
  store.set('serverUrl', normalizeUrl(url));
  if (settingsWin) settingsWin.close();
  loadServer();
});

app.whenReady().then(createWindow);
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
