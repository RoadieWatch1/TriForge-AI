import { ipcMain, shell, dialog, app } from 'electron';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { Store } from './store';
import { transcribeAudio, textToSpeech } from './voice';
import { validateLicense, loadLicense, deactivateLicense, LEMONSQUEEZY } from './license';
import { isAtMessageLimit, canUse, TIERS } from './subscription';
import { hashPin, verifyPin, isValidPin } from './auth';
import { buildSystemPrompt } from './systemPrompt';
import { scanForPhotos, listDirectory, organizeDirectory, getCommonDirs } from './filesystem';
import { listPrinters, printFile, printText } from './printer';
import {
  ProviderManager,
  IntentEngine,
  type ProviderName,
} from '@triforge/engine';

let providerManager: ProviderManager | null = null;
let intentEngine: IntentEngine | null = null;

export function setupIpc(store: Store): void {

  // ── Bootstrap engine on first call ─────────────────────────────────────────
  async function getEngine() {
    if (!providerManager) {
      providerManager = new ProviderManager(store);
    }
    if (!intentEngine) {
      const providers = await providerManager.getActiveProviders();
      intentEngine = new IntentEngine(providers);
    }
    return { providerManager, intentEngine };
  }

  // ── Permissions ─────────────────────────────────────────────────────────────
  ipcMain.handle('permissions:get', () => store.getPermissions());

  ipcMain.handle('permissions:set', (_e, key: string, granted: boolean, budgetLimit?: number) => {
    store.setPermission(key, granted, budgetLimit);
    return store.getPermissions();
  });

  ipcMain.handle('permissions:firstRun', () => store.isFirstRun());
  ipcMain.handle('permissions:markDone', () => store.markFirstRunDone());

  // ── API Keys ─────────────────────────────────────────────────────────────────
  ipcMain.handle('keys:set', async (_e, provider: string, key: string) => {
    if (!providerManager) providerManager = new ProviderManager(store);
    await providerManager.setKey(provider as ProviderName, key);
    // Reset both so next call picks up the new provider list
    providerManager = null;
    intentEngine = null;
  });

  ipcMain.handle('keys:delete', async (_e, provider: string) => {
    if (!providerManager) providerManager = new ProviderManager(store);
    await providerManager.removeKey(provider as ProviderName);
    // Reset both so next call picks up the updated provider list
    providerManager = null;
    intentEngine = null;
  });

  ipcMain.handle('keys:status', async () => {
    if (!providerManager) providerManager = new ProviderManager(store);
    const statuses = await providerManager.getStatus();
    const status: Record<string, boolean> = {};
    for (const s of statuses) status[s.name] = s.connected;
    return status;
  });

  // ── Provider mode ─────────────────────────────────────────────────────────────
  ipcMain.handle('engine:mode', async () => {
    const { providerManager: pm } = await getEngine();
    const result = pm.detectMode();
    return result?.mode ?? 'none';
  });

  // ── License ───────────────────────────────────────────────────────────────────
  ipcMain.handle('license:load', async () => {
    return loadLicense(store);
  });

  ipcMain.handle('license:activate', async (_e, key: string) => {
    const result = await validateLicense(key);
    await store.setLicense({ ...result, lastChecked: new Date().toISOString() });
    return result;
  });

  ipcMain.handle('license:deactivate', async () => {
    const cached = await store.getLicense();
    if (cached.key) {
      await deactivateLicense(cached.key, 'triforge-desktop');
    }
    await store.clearLicense();
    return { tier: 'free' };
  });

  ipcMain.handle('license:tiers', () => TIERS);
  ipcMain.handle('license:checkoutUrls', () => ({
    pro: LEMONSQUEEZY.PRO_CHECKOUT,
    business: LEMONSQUEEZY.BIZ_CHECKOUT,
    portal: LEMONSQUEEZY.CUSTOMER_PORTAL,
  }));

  // ── Usage ─────────────────────────────────────────────────────────────────────
  ipcMain.handle('usage:get', () => ({
    messagesThisMonth: store.getMonthlyMessageCount(),
  }));

  // ── Chat (single message, non-streaming) ─────────────────────────────────────
  ipcMain.handle('chat:send', async (_e, message: string, history: Array<{ role: string; content: string }>) => {
    const { providerManager: pm } = await getEngine();
    const providers = await pm.getActiveProviders();
    if (providers.length === 0) {
      return { error: 'No API keys configured. Add at least one in Settings.' };
    }

    // Enforce message limit
    const license = await store.getLicense();
    const tier = (license.tier ?? 'free') as 'free' | 'pro' | 'business';
    const used = store.getMonthlyMessageCount();
    if (isAtMessageLimit(used, tier)) {
      return { error: 'MESSAGE_LIMIT_REACHED', tier };
    }

    // Build system prompt with user identity, memories, and tier capabilities
    const systemPrompt = await buildSystemPrompt(store);

    try {
      const primary = providers[0];
      const response = await primary.generateResponse([
        { role: 'system', content: systemPrompt },
        ...history,
        { role: 'user', content: message },
      ]);
      store.incrementMessageCount();
      return { text: response, provider: primary.name };
    } catch (err: unknown) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ── Think Tank (full consensus for complex goals) ─────────────────────────────
  ipcMain.handle('thinktank:run', async (_e, goal: string) => {
    const { intentEngine: ie } = await getEngine();
    try {
      const plan = await ie.decompose(goal);
      return { plan };
    } catch (err: unknown) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ── Voice: Speech-to-Text ─────────────────────────────────────────────────────
  ipcMain.handle('voice:transcribe', async (_e, audioBuffer: Buffer) => {
    const license = await store.getLicense();
    const tier = (license.tier ?? 'free') as 'free' | 'pro' | 'business';
    if (!canUse('voice', tier)) {
      return { error: 'FEATURE_LOCKED:voice' };
    }
    try {
      const result = await transcribeAudio(audioBuffer, store);
      return { text: result.text };
    } catch (err: unknown) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ── Voice: Text-to-Speech ─────────────────────────────────────────────────────
  ipcMain.handle('voice:speak', async (_e, text: string) => {
    try {
      const audioBuffer = await textToSpeech(text, store);
      // Return as base64 for the renderer to play
      return { audio: audioBuffer.toString('base64') };
    } catch (err: unknown) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ── Memory ───────────────────────────────────────────────────────────────────
  ipcMain.handle('memory:get', () => store.getMemory());
  ipcMain.handle('memory:add', (_e, type: string, content: string) => {
    store.addMemory(type as 'fact' | 'goal' | 'preference' | 'business', content);
  });

  // ── User profile ──────────────────────────────────────────────────────────────
  ipcMain.handle('profile:get', () => store.getUserProfile());
  ipcMain.handle('profile:set', (_e, profile: Record<string, string>) => {
    store.setUserProfile(profile);
  });

  // ── Session Auth (PIN lock) ───────────────────────────────────────────────────
  ipcMain.handle('auth:status', () => {
    const auth = store.getAuth();
    return { hasPin: store.hasAuth(), username: auth.username };
  });

  ipcMain.handle('auth:setup', (_e, username: string, pin: string) => {
    if (!username.trim()) return { ok: false, error: 'Username is required.' };
    if (!isValidPin(pin)) return { ok: false, error: 'PIN must be exactly 7 digits.' };
    const { hash, salt } = hashPin(pin);
    store.setAuth(username.trim(), hash, salt);
    return { ok: true };
  });

  ipcMain.handle('auth:verify', (_e, username: string, pin: string) => {
    const stored = store.getAuth();
    if (!stored.pinHash || !stored.salt || !stored.username) return { valid: false };
    if (stored.username.toLowerCase() !== username.trim().toLowerCase()) return { valid: false };
    return { valid: verifyPin(pin, stored.pinHash, stored.salt) };
  });

  ipcMain.handle('auth:clear', () => {
    store.clearAuth();
    return { ok: true };
  });

  // ── File System ──────────────────────────────────────────────────────────────
  ipcMain.handle('files:commonDirs', () => getCommonDirs());

  ipcMain.handle('files:listDir', (_e, dirPath: string) => {
    const perms = store.getPermissions();
    const filesGranted = perms.find(p => p.key === 'files')?.granted;
    if (!filesGranted) return { files: [], subdirs: [], error: 'PERMISSION_DENIED:files' };
    return listDirectory(dirPath);
  });

  ipcMain.handle('files:scanPhotos', (_e, startPath?: string) => {
    const perms = store.getPermissions();
    const filesGranted = perms.find(p => p.key === 'files')?.granted;
    if (!filesGranted) return { photos: [], error: 'PERMISSION_DENIED:files' };
    const photos = scanForPhotos(startPath);
    return { photos };
  });

  ipcMain.handle('files:organize', (_e, dirPath: string) => {
    const perms = store.getPermissions();
    const filesGranted = perms.find(p => p.key === 'files')?.granted;
    if (!filesGranted) return { moved: 0, folders: [], errors: ['PERMISSION_DENIED:files'] };
    return organizeDirectory(dirPath);
  });

  ipcMain.handle('files:openFile', (_e, filePath: string) => {
    shell.openPath(filePath);
  });

  ipcMain.handle('files:showInFolder', (_e, filePath: string) => {
    shell.showItemInFolder(filePath);
  });

  ipcMain.handle('files:pickFile', async (_e, filters?: Electron.FileFilter[]) => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: filters ?? [{ name: 'All Files', extensions: ['*'] }],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('files:pickDir', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    return result.canceled ? null : result.filePaths[0];
  });

  // ── Printer ───────────────────────────────────────────────────────────────────
  ipcMain.handle('print:list', async () => {
    const perms = store.getPermissions();
    const printerGranted = perms.find(p => p.key === 'printer')?.granted;
    if (!printerGranted) return { printers: [], error: 'PERMISSION_DENIED:printer' };
    const printers = await listPrinters();
    return { printers };
  });

  ipcMain.handle('print:file', async (_e, filePath: string, printerName?: string) => {
    const perms = store.getPermissions();
    const printerGranted = perms.find(p => p.key === 'printer')?.granted;
    if (!printerGranted) return { ok: false, error: 'PERMISSION_DENIED:printer' };
    return printFile(filePath, printerName);
  });

  ipcMain.handle('print:text', async (_e, content: string, printerName?: string) => {
    const perms = store.getPermissions();
    const printerGranted = perms.find(p => p.key === 'printer')?.granted;
    if (!printerGranted) return { ok: false, error: 'PERMISSION_DENIED:printer' };
    return printText(content, printerName);
  });

  // ── System ───────────────────────────────────────────────────────────────────
  ipcMain.handle('system:openExternal', (_e, url: string) => {
    shell.openExternal(url);
  });

  // ── App Builder ───────────────────────────────────────────────────────────────
  ipcMain.handle('appbuilder:generate', async (_e, spec: { appType: string; audience: string; features: string; style: string; extras: string }) => {
    const { providerManager: pm } = await getEngine();
    const providers = await pm.getActiveProviders();
    if (providers.length === 0) {
      return { error: 'No API keys configured. Add at least one in Settings.' };
    }
    const prompt = `Build a complete, self-contained web application with these specifications:

App Type: ${spec.appType}
Target Users: ${spec.audience}
Core Features: ${spec.features}
Visual Style: ${spec.style}${spec.extras ? `\nAdditional Requirements: ${spec.extras}` : ''}

Technical requirements:
- Single HTML file with ALL CSS and JavaScript inline (no external dependencies)
- Professional, modern, mobile-responsive design
- All features must be functional and interactive
- Include realistic sample/demo data so the app looks populated
- No external CDN links — everything self-contained

Reply with ONLY the complete HTML file content. Start immediately with <!DOCTYPE html> and end with </html>. No explanations, no markdown code blocks.`;

    try {
      const primary = providers[0];
      const response = await primary.generateResponse([
        { role: 'system', content: 'You are an expert web developer. When asked to build an app, you reply with ONLY the complete HTML file — no explanations, no markdown, just raw HTML starting with <!DOCTYPE html>.' },
        { role: 'user', content: prompt },
      ]);
      return { html: response };
    } catch (err: unknown) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('appbuilder:save', async (_e, appName: string, html: string) => {
    try {
      const desktop = app.getPath('desktop');
      const buildDir = path.join(desktop, 'TriForge Builds', appName);
      await fs.promises.mkdir(buildDir, { recursive: true });
      await fs.promises.writeFile(path.join(buildDir, 'index.html'), html, 'utf8');
      return { path: buildDir };
    } catch (err: unknown) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });
}
