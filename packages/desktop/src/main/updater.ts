import { autoUpdater } from 'electron-updater';
import { BrowserWindow, ipcMain, app } from 'electron';

export type UpdateStatus =
  | { state: 'idle' }
  | { state: 'checking' }
  | { state: 'available'; version: string }
  | { state: 'downloading'; percent: number }
  | { state: 'downloaded'; version: string }
  | { state: 'error'; message: string }
  | { state: 'up-to-date' };

export function setupAutoUpdater(win: BrowserWindow): void {
  // Only run in packaged app — dev builds skip entirely
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  const send = (status: UpdateStatus) => {
    if (!win.isDestroyed()) win.webContents.send('updater:status', status);
  };

  autoUpdater.on('checking-for-update',  ()     => send({ state: 'checking' }));
  autoUpdater.on('update-not-available', ()     => send({ state: 'up-to-date' }));
  autoUpdater.on('update-available',     info   => send({ state: 'available', version: info.version }));
  autoUpdater.on('download-progress',    prog   => send({ state: 'downloading', percent: Math.round(prog.percent) }));
  autoUpdater.on('update-downloaded',    info   => send({ state: 'downloaded', version: info.version }));
  autoUpdater.on('error',                err    => send({ state: 'error', message: err.message }));

  ipcMain.handle('updater:check',   () => autoUpdater.checkForUpdates().catch(() => null));
  ipcMain.handle('updater:install', () => { autoUpdater.quitAndInstall(); });

  // First check 12s after launch — enough time for the app to be fully shown
  setTimeout(() => autoUpdater.checkForUpdates().catch(() => {}), 12_000);
}
