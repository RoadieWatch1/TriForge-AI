import { ipcMain, shell } from 'electron';
import { Store } from './store';
import { transcribeAudio, textToSpeech } from './voice';
import { validateLicense, loadLicense, deactivateLicense, LEMONSQUEEZY } from './license';
import { isAtMessageLimit, canUse, TIERS } from './subscription';
import { hashPin, verifyPin, isValidPin } from './auth';
import { buildSystemPrompt } from './systemPrompt';
import {
  ProviderManager,
  Orchestrator,
  IntentEngine,
} from '@triforge/engine';

let providerManager: ProviderManager | null = null;
let orchestrator: Orchestrator | null = null;
let intentEngine: IntentEngine | null = null;

export function setupIpc(store: Store): void {

  // ── Bootstrap engine on first call ─────────────────────────────────────────
  async function getEngine() {
    if (!providerManager) {
      providerManager = new ProviderManager(store);
      await providerManager.init();
    }
    if (!orchestrator) {
      orchestrator = new Orchestrator(providerManager, store);
    }
    if (!intentEngine) {
      intentEngine = new IntentEngine(providerManager);
    }
    return { providerManager, orchestrator, intentEngine };
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
    await store.setSecret(provider, key);
    providerManager = null; // force re-init with new keys
    orchestrator = null;
    intentEngine = null;
  });

  ipcMain.handle('keys:delete', async (_e, provider: string) => {
    await store.deleteSecret(provider);
    providerManager = null;
    orchestrator = null;
    intentEngine = null;
  });

  ipcMain.handle('keys:status', async () => {
    const providers = ['openai', 'claude', 'gemini'];
    const status: Record<string, boolean> = {};
    for (const p of providers) {
      status[p] = !!(await store.getSecret(p));
    }
    return status;
  });

  // ── Provider mode ─────────────────────────────────────────────────────────────
  ipcMain.handle('engine:mode', async () => {
    const { providerManager: pm } = await getEngine();
    return pm.getMode();
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
    const providers = pm.getActiveProviders();
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

  // ── System ───────────────────────────────────────────────────────────────────
  ipcMain.handle('system:openExternal', (_e, url: string) => {
    shell.openExternal(url);
  });
}
