import { app, BrowserWindow, nativeTheme } from 'electron';
import path from 'path';
import { Store } from './store';
import { setupIpc } from './ipc';
import { setupTray } from './tray';

// Single instance lock
if (!app.requestSingleInstanceLock()) {
  app.quit();
  process.exit(0);
}

let mainWindow: BrowserWindow | null = null;
let store: Store | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 720,
    minWidth: 680,
    minHeight: 520,
    backgroundColor: '#0d0d0f',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    frame: process.platform !== 'win32',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // needed for preload to use require
    },
  });

  const rendererHtml = path.join(__dirname, '../renderer/index.html');
  mainWindow.loadFile(rendererHtml);

  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  // Minimize to tray on close
  mainWindow.on('close', (e) => {
    e.preventDefault();
    mainWindow?.hide();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(async () => {
  nativeTheme.themeSource = 'dark';

  store = new Store();
  await store.init();

  setupIpc(store);
  createWindow();

  setupTray(
    () => { mainWindow?.show(); mainWindow?.focus(); },
    () => { store?.close(); }
  );

  app.on('second-instance', () => {
    mainWindow?.show();
    mainWindow?.focus();
  });
});

app.on('window-all-closed', () => {
  // Stay alive in tray — don't quit
});

app.on('activate', () => {
  // macOS: re-open on dock click
  if (!mainWindow) createWindow();
  else mainWindow.show();
});

app.on('before-quit', () => {
  store?.close();
  // Remove 'close' intercept so app actually quits
  mainWindow?.removeAllListeners('close');
});
