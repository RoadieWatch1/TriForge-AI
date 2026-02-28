import { ipcMain, shell, dialog, app, BrowserWindow } from 'electron';
import fs from 'fs';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { Store, LedgerEntry, ForgeScore } from './store';
import { transcribeAudio, textToSpeech } from './voice';
import { validateLicense, loadLicense, deactivateLicense, LEMONSQUEEZY } from './license';
import { isAtMessageLimit, hasCapability, lockedError, getMemoryLimit, TIERS } from './subscription';
import { hashPin, verifyPin, isValidPin } from './auth';
import { buildSystemPrompt } from './systemPrompt';
import { getProfile, listProfiles } from './profiles';
import { scanForPhotos, listDirectory, organizeDirectory, organizeDirectoryDeep, searchPhotos, findSimilarPhotos, moveFiles, getCommonDirs } from './filesystem';
import { listPrinters, printFile, printText } from './printer';
import {
  ProviderManager,
  IntentEngine,
  type ProviderName,
} from '@triforge/engine';

let providerManager: ProviderManager | null = null;
let intentEngine: IntentEngine | null = null;

// ── Ledger export helpers ──────────────────────────────────────────────────
function formatLedgerMarkdown(entries: LedgerEntry[]): string {
  return entries.map(e => {
    const date = new Date(e.timestamp).toLocaleString();
    const meta = e.forgeScore ? ` · Risk: ${e.forgeScore.risk} · Confidence: ${e.forgeScore.confidence}%` : '';
    const parts: string[] = [
      `# ${e.workflow ? `[${e.workflow}] ` : ''}${e.request.slice(0, 80)}`,
      `*${date}${meta}*`,
      '', '## Synthesis', e.synthesis,
    ];
    if (e.forgeScore) {
      const sc = e.forgeScore;
      parts.push('', '## Forge Score',
        `- **Confidence:** ${sc.confidence}%`, `- **Risk:** ${sc.risk}`,
        `- **Agreement:** ${sc.agreement}`, `- **Disagreement:** ${sc.disagreement}`,
        `- **Assumptions:** ${sc.assumptions}`, `- **Verify:** ${sc.verify}`);
    }
    if (e.responses?.length) {
      parts.push('', '## Individual AI Responses',
        ...e.responses.map(r => `### ${r.provider}\n${r.text}`));
    }
    return parts.join('\n');
  }).join('\n\n---\n\n');
}

function ledgerMarkdownToHtml(md: string): string {
  const body = md
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/^---$/gm, '<hr>')
    .replace(/\n/g, '<br>');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body{font-family:Georgia,serif;max-width:800px;margin:40px auto;color:#111;font-size:15px;line-height:1.7}
    h1{color:#f97316;font-size:20px;margin-top:40px}h2{border-bottom:1px solid #ddd;padding-bottom:4px;color:#333}
    h3{color:#555}li{margin:4px 0}hr{border:none;border-top:1px solid #ddd;margin:32px 0}
    em{color:#666;font-size:13px}strong{color:#111}
  </style></head><body>${body}</body></html>`;
}

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
    const result = await pm.detectMode();
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
      const response = await primary.chat([
        { role: 'system', content: systemPrompt },
        ...history,
        { role: 'user', content: message },
      ]);
      // Only count toward quota on success — failed calls don't cost the user
      store.incrementMessageCount();
      return { text: response, provider: primary.name };
    } catch (err: unknown) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ── Consensus Chat (all active providers in parallel + synthesis) ─────────────
  ipcMain.handle('chat:consensus', async (event, message: string, history: Array<{ role: string; content: string }>) => {
    const { providerManager: pm } = await getEngine();
    const providers = await pm.getActiveProviders();
    if (providers.length === 0) {
      return { error: 'No API keys configured. Add at least one in Settings.' };
    }

    const license = await store.getLicense();
    const tierVal = (license.tier ?? 'free') as 'free' | 'pro' | 'business';
    if (!hasCapability('THINK_TANK', tierVal)) {
      return { error: lockedError('THINK_TANK') };
    }
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

    // Notify renderer: forge starting
    event.sender.send('forge:update', { phase: 'querying', total: providers.length });

    // Run all providers in parallel — emit per-provider events as each completes
    let completedCount = 0;
    const settled = await Promise.allSettled(
      providers.map(async p => {
        event.sender.send('forge:update', { phase: 'provider:responding', provider: p.name });
        const text = await p.chat(msgs);
        completedCount++;
        event.sender.send('forge:update', { phase: 'provider:complete', provider: p.name, completedCount, total: providers.length });
        return { provider: p.name as string, text };
      })
    );

    const responses = settled
      .filter((r): r is PromiseFulfilledResult<{ provider: string; text: string }> => r.status === 'fulfilled')
      .map(r => r.value)
      .filter(r => r.text);

    if (responses.length === 0) {
      return { error: 'All providers failed. Check your API keys in Settings.' };
    }

    // Notify renderer: synthesis phase beginning
    event.sender.send('forge:update', { phase: 'synthesis:start' });

    // Synthesize when multiple providers responded
    let synthesis = responses[0].text;
    if (responses.length > 1) {
      try {
        const synthMsgs = [
          {
            role: 'system',
            content: `You are a synthesis engine. Combine the perspectives below into one clear, definitive answer. Lead with the key insight. Note any meaningful disagreements.

After your synthesis, output a trust assessment in this EXACT format (no variations):
---FORGE_SCORE---
CONFIDENCE: [0-100 integer]%
AGREEMENT: [one sentence: what the models agreed on]
DISAGREEMENT: [one sentence: key differences, or "None — models aligned"]
RISK: [Low|Medium|High]
ASSUMPTIONS: [one or two key assumptions that could be wrong]
VERIFY: [1-3 specific things the user should double-check]
---END_FORGE_SCORE---`,
          },
          {
            role: 'user',
            content: `User asked: "${message}"\n\n${responses.map(r => `${r.provider}:\n${r.text}`).join('\n\n---\n\n')}\n\nSynthesize into one final, comprehensive answer, then add the FORGE_SCORE block.`,
          },
        ];
        synthesis = await providers[0].chat(synthMsgs);
      } catch { /* use primary response as fallback */ }
    }

    // Parse ForgeScore out of synthesis text
    let forgeScore: ForgeScore | undefined;
    const scoreMatch = synthesis.match(/---FORGE_SCORE---([\s\S]*?)---END_FORGE_SCORE---/);
    if (scoreMatch) {
      synthesis = synthesis.replace(/---FORGE_SCORE---[\s\S]*?---END_FORGE_SCORE---/, '').trim();
      const s = scoreMatch[1];
      forgeScore = {
        confidence: parseInt(s.match(/CONFIDENCE:\s*(\d+)/)?.[1] ?? '0'),
        risk: (s.match(/RISK:\s*(Low|Medium|High)/)?.[1] ?? 'Medium') as 'Low' | 'Medium' | 'High',
        agreement:    s.match(/AGREEMENT:\s*(.+)/)?.[1]?.trim() ?? '',
        disagreement: s.match(/DISAGREEMENT:\s*(.+)/)?.[1]?.trim() ?? '',
        assumptions:  s.match(/ASSUMPTIONS:\s*(.+)/)?.[1]?.trim() ?? '',
        verify:       s.match(/VERIFY:\s*([\s\S]*?)(?=\n[A-Z]|$)/)?.[1]?.trim() ?? '',
      };
    }

    // Auto-save to Decision Ledger
    store.addLedger({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2),
      timestamp: Date.now(),
      request: message,
      synthesis,
      forgeScore,
      responses,
      starred: false,
    });

    store.incrementMessageCount();
    event.sender.send('forge:update', { phase: 'complete' });
    return { responses, synthesis, forgeScore };
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
    if (!hasCapability('VOICE', tier)) {
      return { error: lockedError('VOICE') };
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
    const licSpeak = await store.getLicense();
    const tierSpeak = (licSpeak.tier ?? 'free') as 'free' | 'pro' | 'business';
    if (!hasCapability('VOICE', tierSpeak)) {
      return { error: lockedError('VOICE') };
    }
    try {
      const audioBuffer = await textToSpeech(text, store);
      // Return as base64 for the renderer to play
      return { audio: audioBuffer.toString('base64') };
    } catch (err: unknown) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ── Memory ───────────────────────────────────────────────────────────────────
  ipcMain.handle('memory:get', async () => {
    const licMem = await store.getLicense();
    const tierMem = (licMem.tier ?? 'free') as 'free' | 'pro' | 'business';
    return store.getMemory(getMemoryLimit(tierMem));
  });
  ipcMain.handle('memory:add', (_e, type: string, content: string) => {
    store.addMemory(type as 'fact' | 'goal' | 'preference' | 'business', content);
  });
  ipcMain.handle('memory:delete', (_e, id: number) => {
    store.deleteMemory(id);
    return store.getMemory();
  });

  // ── Forge Profiles ───────────────────────────────────────────────────────────

  /** List all profiles. Requires FORGE_PROFILES capability (Pro+). */
  ipcMain.handle('forgeProfiles:list', async () => {
    const lic = await store.getLicense();
    const tier = (lic.tier ?? 'free') as 'free' | 'pro' | 'business';
    if (!hasCapability('FORGE_PROFILES', tier)) {
      return { error: lockedError('FORGE_PROFILES') };
    }
    return { profiles: listProfiles() };
  });

  /** Return the currently active profile id and full profile object (no capability check — safe read). */
  ipcMain.handle('forgeProfiles:getActive', () => {
    const id = store.getActiveProfileId();
    const profile = id ? getProfile(id) ?? null : null;
    return { id, profile };
  });

  /**
   * Activate a profile: injects memory preset (idempotent), persists activeProfileId,
   * logs PROFILE_EVENT:ACTIVATE to Decision Ledger.
   */
  ipcMain.handle('forgeProfiles:activate', async (_e, id: string) => {
    const lic = await store.getLicense();
    const tier = (lic.tier ?? 'free') as 'free' | 'pro' | 'business';
    if (!hasCapability('FORGE_PROFILES', tier)) {
      return { error: lockedError('FORGE_PROFILES') };
    }
    const profile = getProfile(id);
    if (!profile) return { error: `Unknown profile id: ${id}` };

    // Remove previous profile's memories before switching (guardrail: only profile-tagged entries)
    const previousId = store.getActiveProfileId();
    if (previousId && previousId !== id) {
      store.removeProfileMemories(previousId);
    }

    // Inject memory preset only if not already present (idempotent)
    if (!store.hasProfileMemories(id)) {
      // Reverse so the first entry ends up at the top of the memory list
      for (const entry of [...profile.memoryPreset].reverse()) {
        store.addMemory(entry.type, entry.content, `profile:${id}`);
      }
    }

    store.setActiveProfileId(id);

    // Log activation to Decision Ledger
    store.addLedger({
      id: `profile-${Date.now().toString(36)}`,
      timestamp: Date.now(),
      request: `Profile Activation: ${profile.name}`,
      synthesis: `Forge Profile "${profile.name}" activated. ${profile.memoryPreset.length} domain memory entries injected.`,
      responses: [],
      workflow: 'PROFILE_EVENT:ACTIVATE',
      starred: false,
    });

    return { ok: true, profile };
  });

  /**
   * Deactivate the active profile: removes profile-tagged memories, clears activeProfileId,
   * logs PROFILE_EVENT:DEACTIVATE. No capability check — deactivating is always allowed.
   */
  ipcMain.handle('forgeProfiles:deactivate', async () => {
    const id = store.getActiveProfileId();
    if (!id) return { ok: true };
    const profile = getProfile(id);
    store.removeProfileMemories(id);
    store.setActiveProfileId(null);
    store.addLedger({
      id: `profile-${Date.now().toString(36)}`,
      timestamp: Date.now(),
      request: `Profile Deactivation: ${profile?.name ?? id}`,
      synthesis: `Forge Profile "${profile?.name ?? id}" deactivated. Profile memory entries removed.`,
      responses: [],
      workflow: 'PROFILE_EVENT:DEACTIVATE',
      starred: false,
    });
    return { ok: true };
  });

  /**
   * Generate an Operational Blueprint for the given profile using the full tri-model council
   * (same Promise.allSettled pattern as chat:consensus). Saves result to Decision Ledger.
   */
  ipcMain.handle('forgeProfiles:generateBlueprint', async (event, id: string) => {
    const lic = await store.getLicense();
    const tier = (lic.tier ?? 'free') as 'free' | 'pro' | 'business';
    if (!hasCapability('FORGE_PROFILES', tier)) {
      return { error: lockedError('FORGE_PROFILES') };
    }
    const profile = getProfile(id);
    if (!profile) return { error: `Unknown profile id: ${id}` };

    const { providerManager: pm } = await getEngine();
    const providers = await pm.getActiveProviders();
    if (providers.length === 0) return { error: 'No API keys configured. Add at least one in Settings.' };

    // Include a bounded slice of user memories (max 20) for personalization
    const memories = store.getMemory(20);
    const memoryContext = memories.length > 0
      ? memories.map(m => `- [${m.type}] ${m.content}`).join('\n')
      : '(no custom memories stored)';

    const fullPrompt = `${profile.blueprintPrompt}\n\nUser context from memory:\n${memoryContext}`;

    const msgs = [
      { role: 'system', content: 'You are an operational business intelligence engine. Generate structured, actionable business blueprints in clean markdown format. No preamble — begin immediately with the first section heading.' },
      { role: 'user', content: fullPrompt },
    ];

    // Tri-model: all available providers in parallel (same pattern as chat:consensus)
    event.sender.send('forge:update', { phase: 'querying', total: providers.length });

    let completedCount = 0;
    const settled = await Promise.allSettled(
      providers.map(async p => {
        event.sender.send('forge:update', { phase: 'provider:responding', provider: p.name });
        const text = await p.chat(msgs);
        completedCount++;
        event.sender.send('forge:update', { phase: 'provider:complete', provider: p.name, completedCount, total: providers.length });
        return { provider: p.name as string, text };
      })
    );

    const responses = settled
      .filter((r): r is PromiseFulfilledResult<{ provider: string; text: string }> => r.status === 'fulfilled')
      .map(r => r.value)
      .filter(r => r.text);

    if (responses.length === 0) {
      return { error: 'All providers failed. Check your API keys in Settings.' };
    }

    event.sender.send('forge:update', { phase: 'synthesis:start' });

    // Synthesize when multiple providers responded
    let markdown = responses[0].text;
    if (responses.length > 1) {
      try {
        const synthMsgs = [
          {
            role: 'system',
            content: 'You are a synthesis engine for business blueprints. Combine the following drafts into one definitive, well-structured operational blueprint in clean markdown. Preserve concrete numbers and specific recommendations. Begin immediately with the first section heading.',
          },
          {
            role: 'user',
            content: `Profile: ${profile.name}\n\nDraft blueprints:\n\n${responses.map(r => `### ${r.provider}\n${r.text}`).join('\n\n---\n\n')}\n\nSynthesize into one final, comprehensive blueprint.`,
          },
        ];
        markdown = await providers[0].chat(synthMsgs);
      } catch { /* use primary response as fallback */ }
    }

    // Save to Decision Ledger
    const ledgerEntryId = `blueprint-${Date.now().toString(36)}`;
    store.addLedger({
      id: ledgerEntryId,
      timestamp: Date.now(),
      request: `Blueprint: ${profile.name}`,
      synthesis: markdown.slice(0, 500) + (markdown.length > 500 ? '…' : ''),
      responses: responses.map(r => ({ provider: r.provider, text: r.text.slice(0, 400) })),
      workflow: 'PROFILE_EVENT:BLUEPRINT',
      starred: false,
    });

    event.sender.send('forge:update', { phase: 'complete' });

    const providerOutputs: Record<string, string> = {};
    for (const r of responses) providerOutputs[r.provider] = r.text;

    return { markdown, providers: providerOutputs, ledgerEntryId };
  });

  // ── Decision Ledger ─────────────────────────────────────────────────────────
  async function getLedgerTier(): Promise<'free' | 'pro' | 'business'> {
    const lic = await store.getLicense();
    return (lic.tier ?? 'free') as 'free' | 'pro' | 'business';
  }

  ipcMain.handle('ledger:get', async (_e, search?: string, limit?: number) => {
    if (!hasCapability('DECISION_LEDGER', await getLedgerTier())) return { error: lockedError('DECISION_LEDGER') };
    return store.getLedger(limit ?? 100, search ?? '');
  });

  ipcMain.handle('ledger:star', async (_e, id: string, starred: boolean) => {
    if (!hasCapability('DECISION_LEDGER', await getLedgerTier())) return { error: lockedError('DECISION_LEDGER') };
    store.starLedger(id, starred);
    return store.getLedger();
  });

  ipcMain.handle('ledger:delete', async (_e, id: string) => {
    if (!hasCapability('DECISION_LEDGER', await getLedgerTier())) return { error: lockedError('DECISION_LEDGER') };
    store.deleteLedger(id);
    return store.getLedger();
  });

  ipcMain.handle('ledger:export', async (_e, id: string | null, format: 'md' | 'pdf') => {
    if (!hasCapability('EXPORT_TOOLS', await getLedgerTier())) return { ok: false, error: lockedError('EXPORT_TOOLS') };
    const raw = id
      ? [store.getLedgerEntry(id)].filter((e): e is LedgerEntry => !!e)
      : store.getLedger();
    const markdown = formatLedgerMarkdown(raw);
    const ext = format;
    const savePath = await dialog.showSaveDialog({
      defaultPath: path.join(os.homedir(), 'Downloads', `triforge-ledger-${Date.now()}.${ext}`),
      filters: [{ name: format === 'pdf' ? 'PDF' : 'Markdown', extensions: [ext] }],
    });
    if (!savePath.filePath) return { ok: false };
    if (format === 'md') {
      await fs.promises.writeFile(savePath.filePath, markdown, 'utf8');
      shell.showItemInFolder(savePath.filePath);
      return { ok: true, path: savePath.filePath };
    }
    // PDF via hidden BrowserWindow — native Electron, no npm packages
    const html = ledgerMarkdownToHtml(markdown);
    let win: BrowserWindow | null = null;
    try {
      win = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false } });
      await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
      const pdfBuf = await win.webContents.printToPDF({ printBackground: false });
      await fs.promises.writeFile(savePath.filePath, pdfBuf);
      shell.showItemInFolder(savePath.filePath);
      return { ok: true, path: savePath.filePath };
    } finally {
      win?.destroy();
    }
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

  ipcMain.handle('files:organizeDeep', (_e, dirPath: string) => {
    const perms = store.getPermissions();
    const filesGranted = perms.find(p => p.key === 'files')?.granted;
    if (!filesGranted) return { moved: 0, folders: [], errors: ['PERMISSION_DENIED:files'], directoriesScanned: 0 };
    return organizeDirectoryDeep(dirPath);
  });

  ipcMain.handle('files:searchPhotos', (_e, query: string, startPath?: string) => {
    const perms = store.getPermissions();
    const filesGranted = perms.find(p => p.key === 'files')?.granted;
    if (!filesGranted) return { photos: [], error: 'PERMISSION_DENIED:files' };
    return { photos: searchPhotos(query, startPath) };
  });

  ipcMain.handle('files:findSimilar', (_e, refPath: string, startPath?: string) => {
    const perms = store.getPermissions();
    const filesGranted = perms.find(p => p.key === 'files')?.granted;
    if (!filesGranted) return { photos: [], error: 'PERMISSION_DENIED:files' };
    return { photos: findSimilarPhotos(refPath, startPath) };
  });

  ipcMain.handle('files:moveFiles', (_e, srcPaths: string[], destDir: string) => {
    const perms = store.getPermissions();
    const filesGranted = perms.find(p => p.key === 'files')?.granted;
    if (!filesGranted) return { moved: 0, errors: ['PERMISSION_DENIED:files'] };
    return moveFiles(srcPaths, destDir);
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
    // Only allow http/https URLs — block javascript:, file:, and other schemes
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return;
    } catch {
      return; // invalid URL
    }
    shell.openExternal(url);
  });

  // ── Execution Plans ───────────────────────────────────────────────────────────
  ipcMain.handle('plan:generate', async (_e, synthesis: string) => {
    const { providerManager: pm } = await getEngine();
    const providers = await pm.getActiveProviders();
    if (providers.length === 0) return { error: 'No API keys configured.' };
    const licPlan = await store.getLicense();
    const tierPlan = (licPlan.tier ?? 'free') as 'free' | 'pro' | 'business';
    if (!hasCapability('EXECUTION_PLANS', tierPlan)) return { error: lockedError('EXECUTION_PLANS') };

    const prompt = `You are an execution planning engine. Convert the provided synthesis into a structured, step-by-step action plan for a non-technical user.

Output ONLY valid JSON matching this EXACT schema (no markdown fences, no explanation text):
{
  "planTitle": "Short title, max 6 words",
  "riskLevel": "Low|Medium|High",
  "summary": "One sentence describing what this plan accomplishes",
  "steps": [
    {
      "id": "step-1",
      "title": "Short action title, max 8 words",
      "type": "review|browser|file|research|decision|command|print",
      "description": "Clear, actionable instruction the user should follow",
      "details": "URL, file path, specific resource, or command — omit if not applicable",
      "requiresApproval": true,
      "risk": "Low|Medium|High"
    }
  ]
}

Step type guide:
- review: User reads/reviews provided information (no system action needed)
- browser: Open a specific URL in the browser — MUST include a real URL in details
- file: Open or interact with a file on the computer
- research: TriForge AI researches a sub-topic for more detail
- decision: User must make a choice before proceeding
- command: Run a terminal command (read-only safe commands only: ls, dir, type, echo, whoami)
- print: Print a document or content

Rules:
- 3 to 7 steps maximum
- Every step must have requiresApproval: true
- Steps that modify files or run commands get risk: "High"
- "browser" steps MUST have a real URL in "details"
- "command" steps must only use safe read-only commands
- Make steps practical for a non-technical user

Synthesis to convert:
${synthesis.slice(0, 3000)}`;

    try {
      const msgs = [
        { role: 'system', content: 'You are a JSON execution plan generator. Output ONLY valid JSON — no markdown fences, no explanation. Start immediately with { and end with }.' },
        { role: 'user', content: prompt },
      ];
      const response = await providers[0].chat(msgs);
      const cleaned = response.trim()
        .replace(/^```(?:json)?\r?\n?/, '')
        .replace(/\r?\n?```$/, '');
      const plan = JSON.parse(cleaned);
      return { plan };
    } catch (err: unknown) {
      return { error: err instanceof Error ? err.message : 'Failed to generate plan.' };
    }
  });

  // Only safe read-only commands are permitted
  const SAFE_COMMAND_BASES = new Set(['ls', 'dir', 'pwd', 'echo', 'type', 'cat', 'whoami', 'hostname', 'date', 'ver']);

  ipcMain.handle('plan:runCommand', async (_e, cmd: string) => {
    const perms = store.getPermissions();
    const terminalGranted = perms.find(p => p.key === 'terminal')?.granted;
    if (!terminalGranted) return { error: 'PERMISSION_DENIED:terminal — enable Terminal permission in Settings first.' };

    const base = cmd.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
    if (!SAFE_COMMAND_BASES.has(base)) {
      return { error: `"${base}" is not on the safe-command allowlist. Run it manually in your terminal.` };
    }

    try {
      const output = execSync(cmd, { timeout: 10000, encoding: 'utf8', maxBuffer: 100 * 1024 });
      return { output };
    } catch (err: unknown) {
      return { error: err instanceof Error ? err.message : 'Command failed.' };
    }
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

    // Inject active Forge Profile scaffold hint if one is set
    const activeForgeProfile = getProfile(store.getActiveProfileId() ?? '');
    const scaffoldNote = activeForgeProfile
      ? `\nForge Profile — ${activeForgeProfile.name}: ${activeForgeProfile.appScaffold.description} Prioritize these modules: ${activeForgeProfile.appScaffold.modules.join(', ')}.`
      : '';

    const prompt = `Build a complete, self-contained web application:

App Type: ${spec.appType}
Target Users: ${spec.audience}
Core Features: ${spec.features}
Data / Persistence: ${spec.dataSave}
Visual Style: ${spec.style}${spec.extras ? `\nExtra Requirements: ${spec.extras}` : ''}${scaffoldNote}

Technical requirements:
- Single HTML file with ALL CSS and JavaScript inline (no external dependencies, no CDN)
- Professional, polished, mobile-responsive design
- All features functional and interactive with realistic sample data
${dataNotes}
- Smooth UX: hover effects, transitions, clear empty states, helpful placeholder text

Reply with ONLY the complete HTML. Start immediately with <!DOCTYPE html> and end with </html>. No markdown, no explanations.`;

    try {
      const primary = providers[0];
      const response = await primary.chat([
        { role: 'system', content: 'You are an expert full-stack web developer. When asked to build an app, output ONLY the complete single-file HTML — no explanations, no markdown fences, just raw HTML starting with <!DOCTYPE html>.' },
        { role: 'user', content: prompt },
      ]);
      // Log Profile scaffold event to Decision Ledger when a profile influenced the build
      if (activeForgeProfile) {
        store.addLedger({
          id: `scaffold-${Date.now().toString(36)}`,
          timestamp: Date.now(),
          request: `App Scaffold: ${spec.appType}`,
          synthesis: `App Builder generated with Forge Profile "${activeForgeProfile.name}" scaffold context. Modules: ${activeForgeProfile.appScaffold.modules.join(', ')}.`,
          responses: [],
          workflow: 'PROFILE_EVENT:APP_SCAFFOLD',
          starred: false,
        });
      }
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
    const licAb = await store.getLicense();
    const tierAb = (licAb.tier ?? 'free') as 'free' | 'pro' | 'business';
    if (!hasCapability('APP_ANALYSIS', tierAb)) return { services: [], error: lockedError('APP_ANALYSIS') };
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
      const response = await primary.chat([
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
