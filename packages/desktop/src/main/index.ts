import { app, BrowserWindow, nativeTheme, globalShortcut, Menu, protocol } from 'electron';
import path from 'path';
import fs from 'fs';
import { Store } from './store';
import { setupIpc, disposeIpcSingletons, restoreBackgroundServices, supervisorHealthTick } from './ipc';
import { OperatorService } from './services/operatorService';
import { loadCustomPacks, loadRunHistory } from './services/workflowPackService';
import { runMigrations } from './migrationEngine';
import { setupTray } from './tray';
import { setupAutoUpdater } from './updater';
import { TaskStore, Scheduler, AuditLedger } from '@triforge/engine';
import { bootLog, bootError } from './bootLogger';
import { supervisor } from '../core/supervisor';
import { healthMonitor } from '../core/health/healthMonitor';
import { MemoryStore } from '../core/memory/memoryStore';
import { getMemoryManager } from '../core/memory/memoryManager';

// ── Chromium speech recognition flags (must be set before app.whenReady) ────────
// enable-speech-dispatcher: activates the speech service on Linux
// enable-features=SpeechRecognition: ensures the Web Speech API is active
app.commandLine.appendSwitch('enable-speech-dispatcher');
app.commandLine.appendSwitch('enable-features', 'SpeechRecognition');

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

  // ── Microphone permission — required for Web Speech API (wake word + voice) ──
  // In Electron 22+, BOTH handlers must be set:
  //   setPermissionCheckHandler  — pre-checks before the API even tries to request
  //   setPermissionRequestHandler — handles the live prompt when the API requests
  mainWindow.webContents.session.setPermissionCheckHandler(
    (_webContents, permission) => permission === 'media',
  );
  mainWindow.webContents.session.setPermissionRequestHandler(
    (_webContents, permission, callback) => {
      callback(permission === 'media');
    },
  );

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

  // Forward renderer console output to terminal — helps debug without DevTools
  mainWindow.webContents.on('console-message', (_e, level, message, line, sourceId) => {
    const src = sourceId ? sourceId.split('/').pop() : '?';
    const prefix = level === 3 ? '[RENDERER:ERR]' : level === 2 ? '[RENDERER:WARN]' : '[RENDERER]';
    console.log(`${prefix} ${message}  (${src}:${line})`);
  });

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
// ── vosk-model:// custom protocol ────────────────────────────────────────────
// Serves the cached Vosk zip directly from userData/vosk-models/ so the
// renderer can call createModel('vosk-model://model.zip') without transferring
// 40 MB over IPC as an ArrayBuffer on every boot.
// Must be registered before app.whenReady resolves.
protocol.registerSchemesAsPrivileged([
  { scheme: 'vosk-model', privileges: { standard: true, supportFetchAPI: true, bypassCSP: true } },
]);

app.whenReady().then(async () => {
  bootLog('App ready');
  nativeTheme.themeSource = 'dark';

  // Register vosk-model:// handler — serves cached zip from disk
  protocol.registerBufferProtocol('vosk-model', (_request, callback) => {
    const zipPath = path.join(
      app.getPath('userData'), 'vosk-models', 'vosk-model-small-en-us-0.15.zip',
    );
    try {
      const data = fs.readFileSync(zipPath);
      callback({ data, mimeType: 'application/zip' });
    } catch {
      callback({ error: -6 }); // FILE_NOT_FOUND
    }
  });

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
  void Date.now(); // splashStart timing (unused — splash closes on ready-to-show)
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

    // Phase 40 — run pending migrations before IPC is live
    try {
      const migResult = await runMigrations(store);
      if (migResult.ran > 0) bootLog(`Migrations: ${migResult.ran} applied`);
      if (migResult.errors.length > 0) bootError('Migration errors', migResult.errors.join('; '));
    } catch (e) { bootError('Migration runner failed', e); }

    setupIpc(store);
    bootLog('IPC initialized');

    // Load user-built custom workflow packs from disk
    try { loadCustomPacks(app.getPath('userData')); } catch { /* non-fatal */ }
    // Restore workflow run history from previous sessions
    try { loadRunHistory(app.getPath('userData')); } catch { /* non-fatal */ }

    // ── Phase 1.5: Auto-restore background agent + webhook on launch ──────────
    restoreBackgroundServices(store).catch((e) =>
      bootError('Background services restore failed', e),
    );

    // ── Phase 1.5: 30s supervisor health check for background agent ───────────
    setInterval(() => {
      if (!store) return;
      supervisorHealthTick(store).catch(console.error);
    }, 30_000);

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

  // Auto-start relay client if credentials are saved from a previous session
  import('./services/relayClient.js').then(({ loadSavedCredentials, startRelayClient }) => {
    if (loadSavedCredentials()) {
      startRelayClient();
      bootLog('Relay client started (saved credentials found)');
    }
  }).catch(() => {});

  // Start device event watcher (detects keyboard/mouse connect/disconnect)
  import('./services/deviceEventWatcher.js').then(({ startDeviceWatcher }) => {
    startDeviceWatcher();
  }).catch(() => {});

  // Start app foreground watcher (detects known apps coming into focus)
  import('./services/appForegroundWatcher.js').then(({ startAppForegroundWatcher }) => {
    startAppForegroundWatcher();
    bootLog('App foreground watcher started');
  }).catch(() => {});

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
  disposeIpcSingletons();
  store?.close();
  OperatorService.terminateTesseract().catch(() => {});

  // Stop relay client, screen watcher, device watcher, and app foreground watcher on quit
  import('./services/relayClient.js').then(({ stopRelayClient }) => stopRelayClient()).catch(() => {});
  import('./services/screenWatcher.js').then(({ stopScreenWatcher }) => stopScreenWatcher()).catch(() => {});
  import('./services/deviceEventWatcher.js').then(({ stopDeviceWatcher }) => stopDeviceWatcher()).catch(() => {});
  import('./services/appForegroundWatcher.js').then(({ stopAppForegroundWatcher }) => stopAppForegroundWatcher()).catch(() => {});

  // Remove 'close' intercept so app actually quits
  mainWindow?.removeAllListeners('close');
});
