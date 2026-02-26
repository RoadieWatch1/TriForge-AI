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

  // ── Consensus Chat (all active providers in parallel + synthesis) ─────────────
  ipcMain.handle('chat:consensus', async (_e, message: string, history: Array<{ role: string; content: string }>) => {
    const { providerManager: pm } = await getEngine();
    const providers = await pm.getActiveProviders();
    if (providers.length === 0) {
      return { error: 'No API keys configured. Add at least one in Settings.' };
    }

    const license = await store.getLicense();
    const tierVal = (license.tier ?? 'free') as 'free' | 'pro' | 'business';
    const used = store.getMonthlyMessageCount();
    if (isAtMessageLimit(used, tierVal)) {
      return { error: 'MESSAGE_LIMIT_REACHED', tier: tierVal };
    }

    const systemPrompt = await buildSystemPrompt(store);
    const msgs = [
      { role: 'system', content: systemPrompt },
      ...history,
      { role: 'user', content: message },
    ];

    // Run all providers in parallel
    const settled = await Promise.allSettled(
      providers.map(p =>
        (p.generateResponse as (m: typeof msgs) => Promise<string>)(msgs)
          .then(text => ({ provider: p.name as string, text }))
      )
    );

    const responses = settled
      .filter((r): r is PromiseFulfilledResult<{ provider: string; text: string }> => r.status === 'fulfilled')
      .map(r => r.value)
      .filter(r => r.text);

    if (responses.length === 0) {
      return { error: 'All providers failed. Check your API keys in Settings.' };
    }

    // Synthesize when multiple providers responded
    let synthesis = responses[0].text;
    if (responses.length > 1) {
      try {
        const synthMsgs = [
          { role: 'system', content: 'You are a synthesis engine. Combine the perspectives below into one clear, definitive answer. Lead with the key insight. Note any meaningful disagreements between models.' },
          { role: 'user', content: `User asked: "${message}"\n\n${responses.map(r => `${r.provider}:\n${r.text}`).join('\n\n---\n\n')}\n\nSynthesize into one final, comprehensive answer.` },
        ];
        synthesis = await (providers[0].generateResponse as (m: typeof synthMsgs) => Promise<string>)(synthMsgs);
      } catch { /* use primary response as fallback */ }
    }

    store.incrementMessageCount();
    return { responses, synthesis };
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
  ipcMain.handle('memory:delete', (_e, id: number) => {
    store.deleteMemory(id);
    return store.getMemory();
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
  ipcMain.handle('appbuilder:generate', async (_e, spec: { appType: string; audience: string; features: string; dataSave: string; style: string; extras: string }) => {
    const { providerManager: pm } = await getEngine();
    const providers = await pm.getActiveProviders();
    if (providers.length === 0) {
      return { error: 'No API keys configured. Add at least one in Settings.' };
    }

    const wantsAccounts = /account|login|sign.?in|user|auth/i.test(spec.dataSave);
    const wantsSave    = !/no|none|fresh|don.?t|do not/i.test(spec.dataSave);
    let dataNotes = '';
    if (wantsAccounts) {
      dataNotes = `- Use localStorage to persist all data locally (no real backend)
- Show a clear notice in the app UI: "Data is saved on this device only. For multi-device sync or real accounts, a backend service would be needed."`;
    } else if (wantsSave) {
      dataNotes = `- Use localStorage to persist all user data so it survives page refreshes and browser restarts
- Auto-save on every change — no manual save button needed`;
    } else {
      dataNotes = `- No data persistence needed — app resets on refresh`;
    }

    const prompt = `Build a complete, self-contained web application:

App Type: ${spec.appType}
Target Users: ${spec.audience}
Core Features: ${spec.features}
Data / Persistence: ${spec.dataSave}
Visual Style: ${spec.style}${spec.extras ? `\nExtra Requirements: ${spec.extras}` : ''}

Technical requirements:
- Single HTML file with ALL CSS and JavaScript inline (no external dependencies, no CDN)
- Professional, polished, mobile-responsive design
- All features functional and interactive with realistic sample data
${dataNotes}
- Smooth UX: hover effects, transitions, clear empty states, helpful placeholder text

Reply with ONLY the complete HTML. Start immediately with <!DOCTYPE html> and end with </html>. No markdown, no explanations.`;

    try {
      const primary = providers[0];
      const response = await primary.generateResponse([
        { role: 'system', content: 'You are an expert full-stack web developer. When asked to build an app, output ONLY the complete single-file HTML — no explanations, no markdown fences, just raw HTML starting with <!DOCTYPE html>.' },
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

  // Write HTML to a temp file and open it in the user's default browser
  ipcMain.handle('appbuilder:openPreview', async (_e, html: string) => {
    try {
      const tmpFile = path.join(os.tmpdir(), `triforge-preview-${Date.now()}.html`);
      await fs.promises.writeFile(tmpFile, html, 'utf8');
      await shell.openPath(tmpFile);
      return { ok: true };
    } catch (err: unknown) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // Analyze the generated app and return a plain-English guide for every 3rd-party service it needs
  ipcMain.handle('appbuilder:analyze', async (_e,
    spec: { appType: string; audience: string; features: string; dataSave: string; style: string; extras: string },
    html: string,
  ) => {
    const { providerManager: pm } = await getEngine();
    const providers = await pm.getActiveProviders();
    if (providers.length === 0) return { services: [] };

    const specSummary = [
      `App type: ${spec.appType}`,
      `Users: ${spec.audience}`,
      `Features: ${spec.features}`,
      `Data saving: ${spec.dataSave}`,
      spec.extras ? `Extra: ${spec.extras}` : '',
    ].filter(Boolean).join(' | ');

    // Send only the first 4000 chars of HTML to keep tokens low
    const htmlSnippet = html.slice(0, 4000);

    const prompt = `You are a friendly tech advisor helping a non-technical person understand what third-party services their new web app would need to be fully production-ready.

App description: ${specSummary}

Generated app (first part of HTML):
${htmlSnippet}

Identify ONLY services the app genuinely needs to work as described beyond what localStorage can provide.
Examples: user authentication, a real database, payment processing, email sending, SMS, maps, real-time sync, file storage.
Do NOT list: localStorage, CSS frameworks, icon libraries, or anything already self-contained in the HTML.

For each service, respond in this EXACT JSON format (array):
[
  {
    "name": "Service Name",
    "emoji": "fitting emoji",
    "tagline": "5 words or less — what it does",
    "what": "One plain-English sentence. No jargon. Imagine explaining to a grandparent.",
    "where": "https://official-website.com",
    "why": "One sentence: why does THIS specific app need it?",
    "how": [
      "Step 1 — plain action (e.g., Go to supabase.com and click Start for Free)",
      "Step 2 — plain action",
      "Step 3 — plain action",
      "Step 4 — plain action (optional)"
    ],
    "free": true,
    "freeNote": "e.g., Free up to 500MB, no credit card needed"
  }
]

If the app works fine with browser localStorage and needs no external services, return exactly: []

Respond with ONLY the JSON array. No markdown. No explanation before or after.`;

    try {
      const primary = providers[0];
      const response = await primary.generateResponse([
        {
          role: 'system',
          content: 'You are a helpful technical advisor. You output ONLY valid JSON arrays — no markdown fences, no explanation text, just the raw JSON array starting with [ and ending with ].',
        },
        { role: 'user', content: prompt },
      ]);

      const text = (response as string).trim()
        .replace(/^```(?:json)?\r?\n?/, '')
        .replace(/\r?\n?```$/, '');

      const parsed = JSON.parse(text);
      return { services: Array.isArray(parsed) ? parsed : [] };
    } catch {
      return { services: [] };
    }
  });
}
