import { app, BrowserWindow, nativeTheme, globalShortcut, Menu } from 'electron';
import path from 'path';
import { Store } from './store';
import { setupIpc } from './ipc';
import { setupTray } from './tray';
import { setupAutoUpdater } from './updater';
import { TaskStore, Scheduler, AuditLedger } from '@triforge/engine';

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
      spellcheck: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));

  // Right-click context menu — spell suggestions + standard edit actions
  mainWindow.webContents.on('context-menu', (_e, params) => {
    const items: Electron.MenuItemConstructorOptions[] = [];

    // Spell-correction block — only shown when the cursor is on a misspelled word
    if (params.misspelledWord) {
      const suggestions = params.dictionarySuggestions.slice(0, 5);
      if (suggestions.length > 0) {
        suggestions.forEach(s => items.push({
          label: s,
          click: () => mainWindow!.webContents.replaceMisspelling(s),
        }));
      } else {
        items.push({ label: 'No suggestions', enabled: false });
      }
      items.push(
        { type: 'separator' },
        { label: 'Add to Dictionary', click: () => mainWindow!.webContents.session.addWordToSpellCheckerDictionary(params.misspelledWord) },
        { type: 'separator' },
      );
    }

    items.push(
      { role: 'cut',       enabled: params.editFlags.canCut },
      { role: 'copy',      enabled: params.editFlags.canCopy },
      { role: 'paste',     enabled: params.editFlags.canPaste },
      { type: 'separator' },
      { role: 'selectAll', enabled: params.editFlags.canSelectAll },
    );

    Menu.buildFromTemplate(items).popup({ window: mainWindow! });
  });

  if (process.env.NODE_ENV === 'development') {
    mainWindow.webContents.openDevTools({ mode: 'detach' });
  }

  // Cmd+Option+I (Mac) / F12 (all) opens DevTools for debugging
  globalShortcut.register('CommandOrControl+Alt+I', () => {
    mainWindow?.webContents.toggleDevTools();
  });
  globalShortcut.register('F12', () => {
    mainWindow?.webContents.toggleDevTools();
  });

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

  // Build application menu.
  // - macOS: needs a full menu bar (App + Edit + Window) per HIG; the App menu
  //   provides native About/Services/Quit which macOS users expect.
  // - Windows/Linux: only the Edit menu is needed to register Ctrl+C/V/X/A/Z
  //   shortcuts (the menu bar itself is not visible on our frameless window).
  const isMac = process.platform === 'darwin';
  const menuTemplate: Electron.MenuItemConstructorOptions[] = [
    ...(isMac ? [{
      label: app.name,
      submenu: [
        { role: 'about' as const },
        { type: 'separator' as const },
        { role: 'services' as const },
        { type: 'separator' as const },
        { role: 'hide' as const },
        { role: 'hideOthers' as const },
        { role: 'unhide' as const },
        { type: 'separator' as const },
        { role: 'quit' as const },
      ],
    }] : []),
    {
      label: 'Edit',
      submenu: [
        { role: 'undo' as const },
        { role: 'redo' as const },
        { type: 'separator' as const },
        { role: 'cut' as const },
        { role: 'copy' as const },
        { role: 'paste' as const },
        { role: 'pasteAndMatchStyle' as const },
        { role: 'delete' as const },
        { role: 'selectAll' as const },
      ],
    },
    ...(isMac ? [{
      label: 'Window',
      submenu: [
        { role: 'minimize' as const },
        { role: 'zoom' as const },
        { type: 'separator' as const },
        { role: 'front' as const },
      ],
    }] : []),
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(menuTemplate));

  // 1. Show splash immediately — record when it appeared
  splashWindow = createSplash();
  const splashStart = Date.now();

  // 2. Init store and IPC (runs while splash is visible)
  store = new Store();
  await store.init();
  setupIpc(store);

  // 3a. Pre-load task engine data stores + start scheduler
  const dataDir = app.getPath('userData');
  new TaskStore(dataDir).loadAll(); // warms cache, marks stale 'running' tasks as 'paused'
  const scheduler = new Scheduler(dataDir);
  scheduler.onFire = (job) => {
    // When a scheduled job fires, create + run a task via the main window
    // (agentLoop is initialized lazily inside ipc.ts on first use)
    const win = BrowserWindow.getAllWindows()[0];
    if (win && !win.isDestroyed()) {
      win.webContents.send('scheduler:jobFired', {
        jobId: job.id, goal: job.taskGoal, category: job.category,
      });
    }
  };
  scheduler.start();

  // Ensure audit ledger directory is writable (creates file on first append)
  new AuditLedger(dataDir); // constructor only stores path, no file I/O yet

  // 3. Create main window (hidden) and start loading the renderer
  createWindow();

  // 4. When renderer is ready, enforce a minimum splash duration then swap windows
  mainWindow?.once('ready-to-show', () => {
    const minSplashMs = 10500; // voice starts at 1800ms + ~6.5s speech + 1700ms deliberate pauses
    const elapsed = Date.now() - splashStart;
    const delay = Math.max(0, minSplashMs - elapsed);
    setTimeout(() => {
      splashWindow?.close();
      splashWindow = null;
      mainWindow?.show();
      mainWindow?.focus();
    }, delay);
    // Wire auto-updater now that we have a live window reference
    if (mainWindow) setupAutoUpdater(mainWindow);
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
