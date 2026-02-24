import { ipcMain, shell } from 'electron';
import { Store } from './store';
import { transcribeAudio, textToSpeech } from './voice';
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

  // ── Chat (single message, non-streaming) ─────────────────────────────────────
  ipcMain.handle('chat:send', async (_e, message: string, history: Array<{ role: string; content: string }>) => {
    const { providerManager: pm } = await getEngine();
    const providers = pm.getActiveProviders();
    if (providers.length === 0) {
      return { error: 'No API keys configured. Add at least one in Settings.' };
    }

    try {
      // Use the primary provider for simple chat
      const primary = providers[0];
      const response = await primary.generateResponse([
        ...history,
        { role: 'user', content: message },
      ]);
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

  // ── System ───────────────────────────────────────────────────────────────────
  ipcMain.handle('system:openExternal', (_e, url: string) => {
    shell.openExternal(url);
  });
}
