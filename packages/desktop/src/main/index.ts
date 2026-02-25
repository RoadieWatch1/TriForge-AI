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
let splashWindow: BrowserWindow | null = null;
let store: Store | null = null;

// ── Splash screen ──────────────────────────────────────────────────────────────
function createSplash(): BrowserWindow {
  const splash = new BrowserWindow({
    width: 620,
    height: 420,
    frame: false,
    resizable: false,
    center: true,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#0d0d0f',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });
  splash.loadFile(path.join(__dirname, '../renderer/splash.html'));
  return splash;
}

// ── Main window ───────────────────────────────────────────────────────────────
function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 720,
    minWidth: 680,
    minHeight: 520,
    show: false,              // hidden until we manually show it after splash
    backgroundColor: '#0d0d0f',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'hidden',
    frame: process.platform !== 'win32',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

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

// ── App lifecycle ─────────────────────────────────────────────────────────────
app.whenReady().then(async () => {
  nativeTheme.themeSource = 'dark';

  // 1. Show splash immediately — record when it appeared
  splashWindow = createSplash();
  const splashStart = Date.now();

  // 2. Init store and IPC (runs while splash is visible)
  store = new Store();
  await store.init();
  setupIpc(store);

  // 3. Create main window (hidden) and start loading the renderer
  createWindow();

  // 4. When renderer is ready, enforce a minimum splash duration then swap windows
  mainWindow?.once('ready-to-show', () => {
    const minSplashMs = 5500;
    const elapsed = Date.now() - splashStart;
    const delay = Math.max(0, minSplashMs - elapsed);
    setTimeout(() => {
      splashWindow?.close();
      splashWindow = null;
      mainWindow?.show();
      mainWindow?.focus();
    }, delay);
  });

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
