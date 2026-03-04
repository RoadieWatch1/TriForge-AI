import { app, BrowserWindow, nativeTheme, globalShortcut, Menu } from 'electron';
import path from 'path';
import { Store } from './store';
import { setupIpc } from './ipc';
import { setupTray } from './tray';
import { setupAutoUpdater } from './updater';
import { TaskStore, Scheduler, AuditLedger } from '@triforge/engine';
import { bootLog, bootError } from './bootLogger';
import { supervisor } from '../core/supervisor';
import { healthMonitor } from '../core/health/healthMonitor';
import { MemoryStore } from '../core/memory/memoryStore';
import { getMemoryManager } from '../core/memory/memoryManager';

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
  bootLog('App ready');
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
  bootLog('Splash created');

  // 2. Create main window immediately (hidden) — must happen before any async init
  //    so the splash → main transition is always wired regardless of init errors.
  createWindow();
  bootLog('Main window created');

  // ── Two-condition gate: main window shows when BOTH renderer AND voice are done ─
  // Condition A: renderer ready-to-show
  // Condition B: splash voice finished (or splash closed for any reason)
  // Fallback: 12 s hard timer sets both conditions
  let _rendererReady  = false;
  let _splashVoiceDone = false;

  function showMain() {
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.close();
      splashWindow = null;
    }
    if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.isVisible()) {
      bootLog('Main window shown');
      mainWindow.show();
      mainWindow.focus();
    }
  }

  function _checkReady() {
    if (_rendererReady && _splashVoiceDone) showMain();
  }

  // Splash closes itself when voice ends (u.onend → window.close in splash.html).
  // We listen here so we know when it's safe to display.
  splashWindow?.on('closed', () => {
    bootLog('Splash closed (voice ended or window dismissed)');
    _splashVoiceDone = true;
    _checkReady();
  });

  // Hard fallback: if EITHER condition never fires, force show at 12 s.
  const splashFallback = setTimeout(() => {
    bootLog('Fallback timer fired — forcing main window visible');
    _rendererReady   = true;
    _splashVoiceDone = true;
    showMain();
  }, 12_000);

  // ── Renderer safety listeners ────────────────────────────────────────────────

  // Normal path: renderer is ready — gate clears condition A
  mainWindow?.once('ready-to-show', () => {
    bootLog('Renderer ready-to-show');
    clearTimeout(splashFallback);
    _rendererReady = true;
    if (mainWindow) setupAutoUpdater(mainWindow);
    _checkReady();
  });

  // Renderer HTML / JS bundle failed to load — bypass gate, show immediately
  mainWindow?.webContents.on('did-fail-load', (_e, errorCode, errorDescription) => {
    bootError('Renderer did-fail-load', `${errorCode} ${errorDescription}`);
    clearTimeout(splashFallback);
    _rendererReady = _splashVoiceDone = true;
    showMain();
  });

  // Renderer process crashed or was killed — bypass gate, show immediately
  mainWindow?.webContents.on('render-process-gone', (_e, details) => {
    bootError('Renderer process gone', details.reason);
    clearTimeout(splashFallback);
    _rendererReady = _splashVoiceDone = true;
    showMain();
  });

  // Renderer became unresponsive (hung JS, infinite loop, etc.) — bypass gate
  mainWindow?.webContents.on('unresponsive', () => {
    bootError('Renderer unresponsive', 'renderer JS is hung');
    clearTimeout(splashFallback);
    _rendererReady = _splashVoiceDone = true;
    showMain();
  });

  // ── 3. Init store + IPC — these must run once before supervised services ─────
  try {
    store = new Store();
    await store.init();
    bootLog('Store initialized');

    setupIpc(store);
    bootLog('IPC initialized');
  } catch (e) {
    bootError('Store/IPC init failed — app will run with limited functionality', e);
  }

  // ── 4. Register supervised services and start them ───────────────────────────
  // Each service is monitored and auto-restarted on crash (up to 10 times).
  const dataDir = app.getPath('userData');

  supervisor.register({
    name: 'TaskStore',
    restartDelay: 2000,
    start: () => {
      new TaskStore(dataDir).loadAll(); // warms cache, marks stale tasks as paused
      new AuditLedger(dataDir);
      bootLog('TaskStore ready');
    },
  });

  supervisor.register({
    name: 'TaskScheduler',
    restartDelay: 3000,
    start: () => {
      const scheduler = new Scheduler(dataDir);
      scheduler.onFire = (job) => {
        const win = BrowserWindow.getAllWindows()[0];
        if (win && !win.isDestroyed()) {
          win.webContents.send('scheduler:jobFired', {
            jobId: job.id, goal: job.taskGoal, category: job.category,
          });
        }
      };
      scheduler.start();
      bootLog('TaskScheduler running');
    },
  });

  await supervisor.startAll();
  bootLog('Engine services initialized');

  // ── 5. Long-term memory — connect EventBus hooks ─────────────────────────────
  try {
    const memoryStore = new MemoryStore(dataDir);
    const memoryMgr   = getMemoryManager(memoryStore);
    memoryMgr.connectEventBus();
    bootLog('Memory manager connected');
  } catch (e) {
    bootError('Memory manager init failed', e);
  }

  // ── 6. Health monitor — register supervisor-level checks + start ─────────────
  healthMonitor.register({
    name:  'Supervisor',
    check: () => {
      const statuses = supervisor.getStatus();
      return Object.values(statuses).every(s => s !== 'disabled');
    },
  });

  // Self-healing: trigger supervisor restart when a component fails 2+ times
  healthMonitor.onUnhealthy = (name, _count) => {
    bootError(`Health check failed for "${name}" — supervisor will attempt restart`, name);
    // Supervisor auto-restarts crashed services; just log here
  };

  healthMonitor.start(15_000); // check every 15 seconds
  bootLog('Health monitor started');

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
