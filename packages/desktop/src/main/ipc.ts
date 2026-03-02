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
import { getEngineConfig, EngineProfileType } from './engines';
import { scanForPhotos, listDirectory, organizeDirectory, organizeDirectoryDeep, searchPhotos, findSimilarPhotos, moveFiles, getCommonDirs } from './filesystem';
import { scanForDocuments, ocrFile, detectDocTypes, searchIndex, type DocEntry } from './docIndex';
import { GrokVoiceAgent } from './grokVoice';
import { listPrinters, printFile, printText } from './printer';
import { CredentialManager } from './credentials';
import { createNotifyAdapter } from './notifications';
import { createMailAdapter } from './mailService';
import { ResultStore } from './resultStore';
import { ValueEngine, CampaignStore, MetricsStore, CompoundEngine } from '@triforge/engine';
import { GrowthService } from './growthService';
import {
  ProviderManager,
  IntentEngine,
  type ProviderName,
  AgentLoop,
  AuditLedger,
  TaskStore,
  WalletEngine,
  Scheduler,
  ThinkTankPlanner,
  ApprovalStore,
  createDefaultRegistry,
  eventBus,
  serviceLocator,
  DEFAULT_TRUST_SNAPSHOT,
  validateTrustMode,
  PAPER_TRADING_ONLY,
  type TrustModeSnapshot,
  type TaskCategory,
  type TaskStatus,
  type EventRecord,
} from '@triforge/engine';

let providerManager: ProviderManager | null = null;
let intentEngine: IntentEngine | null = null;

// ── Task Engine singletons (lazy-init inside handlers) ─────────────────────────
let _taskStore: TaskStore | null = null;
let _auditLedger: AuditLedger | null = null;
let _walletEngine: WalletEngine | null = null;
let _scheduler: Scheduler | null = null;
let _approvalStore: ApprovalStore | null = null;
let _agentLoop: AgentLoop | null = null;
let _credentialManager: CredentialManager | null = null;
let _resultStore: ResultStore | null = null;
let _campaignStore: CampaignStore | null = null;
let _metricsStore: MetricsStore | null = null;
let _valueEngine: ValueEngine | null = null;
let _growthService: GrowthService | null = null;
let _compoundEngine: CompoundEngine | null = null;

function _getDataDir(): string {
  return app.getPath('userData');
}

function _getCredentialManager(store: Store): CredentialManager {
  if (!_credentialManager) _credentialManager = new CredentialManager(store);
  return _credentialManager;
}

function _getResultStore(): ResultStore {
  if (!_resultStore) _resultStore = new ResultStore();
  return _resultStore;
}

function _getCampaignStore(): CampaignStore {
  if (!_campaignStore) _campaignStore = new CampaignStore(_getDataDir());
  return _campaignStore;
}

function _getMetricsStore(): MetricsStore {
  if (!_metricsStore) _metricsStore = new MetricsStore(_getDataDir());
  return _metricsStore;
}

function _getValueEngine(): ValueEngine {
  if (!_valueEngine) {
    _valueEngine = new ValueEngine(_getMetricsStore(), _getCampaignStore());
    _valueEngine.start();
  }
  return _valueEngine;
}

function _getCompoundEngine(): CompoundEngine {
  if (!_compoundEngine) _compoundEngine = new CompoundEngine(_getDataDir(), () => providerManager);
  return _compoundEngine;
}

function _getGrowthService(): GrowthService {
  if (!_growthService) {
    _growthService = new GrowthService(_getDataDir(), () => providerManager, _getCompoundEngine());
  }
  return _growthService;
}

function _getTaskStore(): TaskStore {
  if (!_taskStore) {
    _taskStore = new TaskStore(_getDataDir());
    _taskStore.loadAll();
  }
  return _taskStore;
}

function _getAuditLedger(): AuditLedger {
  if (!_auditLedger) _auditLedger = new AuditLedger(_getDataDir());
  return _auditLedger;
}

function _getWalletEngine(store: Store): WalletEngine {
  if (!_walletEngine) _walletEngine = new WalletEngine(store);
  return _walletEngine;
}

function _getScheduler(): Scheduler {
  if (!_scheduler) {
    _scheduler = new Scheduler(_getDataDir());
  }
  return _scheduler;
}

function _getApprovalStore(): ApprovalStore {
  if (!_approvalStore) _approvalStore = new ApprovalStore(_getDataDir());
  return _approvalStore;
}

function _getAgentLoop(store: Store): AgentLoop {
  if (!_agentLoop) {
    if (!providerManager) throw new Error('ProviderManager not ready');
    const planner = new ThinkTankPlanner(providerManager);
    const registry = createDefaultRegistry();
    _agentLoop = new AgentLoop(
      _getTaskStore(),
      planner,
      registry,
      _getWalletEngine(store),
      _getAuditLedger(),
      _getApprovalStore(),
    );
  }
  return _agentLoop;
}

// Trust config stored in KV store
const TRUST_KEY = 'triforge.trustConfig';

// ── Input validation ──────────────────────────────────────────────────────────

const MAX_MESSAGE_CHARS  = 32_000;   // ~8k tokens — generous but bounded
const MAX_HISTORY_TURNS  = 200;      // max conversation turns passed from renderer
const MAX_HISTORY_CHARS  = 200_000;  // total chars across all history messages
const MAX_MEMORY_CHARS   = 2_000;    // per memory entry

function validateChat(message: unknown, history: unknown): string | null {
  if (typeof message !== 'string')        return 'Invalid message type.';
  if (message.trim().length === 0)        return 'Message is empty.';
  if (message.length > MAX_MESSAGE_CHARS) return `Message too long (max ${MAX_MESSAGE_CHARS} chars).`;
  if (!Array.isArray(history))            return 'Invalid history.';
  if (history.length > MAX_HISTORY_TURNS) return `History too long (max ${MAX_HISTORY_TURNS} turns).`;
  const totalChars = history.reduce((n, m) => n + (typeof m?.content === 'string' ? m.content.length : 0), 0);
  if (totalChars > MAX_HISTORY_CHARS)     return `History too large (max ${MAX_HISTORY_CHARS} chars total).`;
  return null;
}

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

  // ── Phase 4: Register service locator adapters ────────────────────────────
  // These are registered once at startup; engine tools use them for real execution
  const credMgr = _getCredentialManager(store);
  const resultSt = _getResultStore();

  serviceLocator.registerMailSender(createMailAdapter(credMgr));
  serviceLocator.registerNotifier(createNotifyAdapter());
  serviceLocator.registerResultLogger(resultSt.createLoggerAdapter());
  serviceLocator.registerResultQuerier(resultSt.createQuerierAdapter());
  serviceLocator.registerCredentialGetter((name: string) => credMgr.getByName(name));

  // ── Persistent event forwarder — set once, forwards to all open windows ────
  eventBus.onAny((ev) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('taskEngine:event', ev);
    }
  });

  // ── Startup resume — resume interrupted tasks after 3s ───────────────────
  setTimeout(async () => {
    try {
      _getApprovalStore().expireStale();
      const loop = _getAgentLoop(store);
      loop.startRetryLoop();
      const tasks = _getTaskStore().list();
      for (const t of tasks) {
        if (['queued', 'planning', 'running'].includes(t.status)) {
          loop.runTask(t.id).catch((err: unknown) => console.error('[startup-resume]', err));
        }
      }
      // Phase 5 — start Value Engine
      _getValueEngine();
      // Phase 6 — start Growth Engine daily runner
      _getGrowthService().startDailyRunner();
    } catch (e) {
      console.error('[startup-resume]', e);
    }
  }, 3000);

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
  ipcMain.handle('chat:send', async (event, message: string, history: Array<{ role: string; content: string }>) => {
    const validErr = validateChat(message, history);
    if (validErr) return { error: validErr };

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
      const allMsgs = [
        { role: 'system', content: systemPrompt },
        ...history,
        { role: 'user', content: message },
      ];
      // Stream tokens to renderer as they arrive
      const text = await primary.chatStream(allMsgs, (chunk: string) => {
        event.sender.send('chat:chunk', chunk);
      });
      store.incrementMessageCount();
      return { text, provider: primary.name };
    } catch (err: unknown) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ── Debate Intensity — Council role prompts & synthesis directives ────────────
  const ROLES = ['strategist', 'critic', 'executor'] as const;
  type Role = typeof ROLES[number];
  type Intensity = 'cooperative' | 'analytical' | 'critical' | 'combative' | 'ruthless';
  const VALID_INTENSITIES: Intensity[] = ['cooperative', 'analytical', 'critical', 'combative', 'ruthless'];

  const ROLE_PROMPTS: Record<Role, Record<Intensity, string>> = {
    strategist: {
      cooperative: 'You are the Strategist. Find what works. Be constructive and propose a clear direction.',
      analytical:  'You are the Strategist. Evaluate architectural tradeoffs and long-term impact. Propose the strongest design.',
      critical:    'You are the Strategist. Architect for scale and maintainability. Do not accept shortcuts.',
      combative:   'You are the Strategist. Challenge the premise if a better approach exists. Propose superior alternatives without mercy.',
      ruthless:    'You are the Strategist. Reject weak architecture entirely. Demand the best possible design. If the premise is flawed, say so directly.',
    },
    critic: {
      cooperative: 'You are the Critic. Note concerns gently. Look for synergies and flag edge cases.',
      analytical:  'You are the Critic. Identify assumptions, gaps, and edge cases. Ask what could break.',
      critical:    'You are the Critic. Aggressively probe failure modes, risks, and security issues. Assume the plan has flaws — find them.',
      combative:   'You are the Critic. Assume the proposal is flawed until proven otherwise. Find the breaking point. What would make this fail in production?',
      ruthless:    'You are the Critic. Maximum adversarial analysis. Security paranoia. Find every vulnerability, performance regression, and architectural debt. Be uncompromising.',
    },
    executor: {
      cooperative: 'You are the Executor. Provide a practical implementation path with clear steps.',
      analytical:  'You are the Executor. Propose concrete steps with dependencies. Flag what is hard to implement.',
      critical:    'You are the Executor. Detail every implementation risk and how to mitigate it. Be specific about what will be hard.',
      combative:   'You are the Executor. Identify every point where implementation could fail. Assume nothing works out of the box.',
      ruthless:    'You are the Executor. Refuse vague plans. Require specific, testable implementation steps. Block anything that cannot be verified.',
    },
  };

  const SYNTHESIS_DIRECTIVES: Record<Intensity, string> = {
    cooperative: 'Combine the Strategist, Critic, and Executor perspectives into a clear, unified recommendation. Smooth disagreements into a practical synthesis.',
    analytical:  'Weight each perspective by its reasoning strength. Highlight key decision points where the models diverged. Summarize what they agreed on and where trade-offs exist.',
    critical:    "Prioritize the Critic's risk flags. Do not smooth over disagreements — call out the strongest objection and explain how the Strategist responded to it. The final answer must acknowledge risk directly.",
    combative:   "Do not merge perspectives artificially. State each model's position explicitly. Where they conflict, explain WHY each side is correct in its own frame. Give a final recommendation that takes the strongest critique seriously.",
    ruthless:    "Show the full conflict. If the Critic's attack was valid, the synthesis must reflect that. If models disagree significantly, say so clearly and explain both sides without diplomatic smoothing. Confidence should drop if real disagreement exists.",
  };

  const ESCALATION_RE = /security.risk|vulnerabilit|breaking.change|data.loss|memory.leak|race.condition|injection/i;

  // ── Consensus Chat (all active providers in parallel + synthesis) ─────────────
  ipcMain.handle('chat:consensus', async (event, message: string, history: Array<{ role: string; content: string }>, intensity: string = 'analytical') => {
    const validErr = validateChat(message, history);
    if (validErr) return { error: validErr };

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

    // Validate + normalise intensity
    const activeIntensity: Intensity = VALID_INTENSITIES.includes(intensity as Intensity)
      ? (intensity as Intensity)
      : 'analytical';

    const systemPrompt = await buildSystemPrompt(store);

    // Notify renderer: forge starting
    event.sender.send('forge:update', { phase: 'querying', total: providers.length });

    // Run all providers in parallel with distinct council roles
    let completedCount = 0;
    const settled = await Promise.allSettled(
      providers.map(async (p, i) => {
        const role: Role = ROLES[Math.min(i, ROLES.length - 1)];
        const roleInstruction = ROLE_PROMPTS[role][activeIntensity];
        const roleMsgs = [
          {
            role: 'system',
            content: `${systemPrompt}\n\n--- COUNCIL ROLE ---\n${roleInstruction}\nAt the end of your response, append exactly: [[CONFIDENCE: X%]] where X is your self-assessed confidence (0-100 integer).`,
          },
          ...history,
          { role: 'user', content: message },
        ];
        event.sender.send('forge:update', { phase: 'provider:responding', provider: p.name });
        const text = await p.chat(roleMsgs);
        completedCount++;
        event.sender.send('forge:update', { phase: 'provider:complete', provider: p.name, completedCount, total: providers.length });
        return { provider: p.name as string, text, role };
      })
    );

    // Separate successes from failures; strip [[CONFIDENCE:]] tags and collect values
    const confidenceValues: number[] = [];
    const responses = settled
      .filter((r): r is PromiseFulfilledResult<{ provider: string; text: string; role: Role }> => r.status === 'fulfilled')
      .map(r => {
        const entry = { ...r.value };
        const m = entry.text.match(/\[\[CONFIDENCE:\s*(\d+)%?\]\]/i);
        if (m) {
          confidenceValues.push(parseInt(m[1]));
          entry.text = entry.text.replace(m[0], '').trim();
        }
        return entry;
      })
      .filter(r => r.text);

    const initialConfidence = confidenceValues.length > 0
      ? Math.round(confidenceValues.reduce((a, b) => a + b, 0) / confidenceValues.length)
      : undefined;

    const failedProviders = settled
      .map((r, i) => ({ result: r, name: providers[i].name }))
      .filter(({ result }) => result.status === 'rejected')
      .map(({ result, name }) => ({
        provider: name as string,
        error: (result as PromiseRejectedResult).reason instanceof Error
          ? (result as PromiseRejectedResult).reason.message
          : String((result as PromiseRejectedResult).reason),
      }));

    if (responses.length === 0) {
      const details = failedProviders.map(f => `${f.provider}: ${f.error}`).join('; ');
      return { error: `All providers failed. ${details}` };
    }

    // Auto-escalation: if risk signals detected in responses and intensity is low, raise to critical
    let effectiveIntensity = activeIntensity;
    let escalatedFrom: string | undefined;
    const allResponseText = responses.map(r => r.text).join(' ');
    if (ESCALATION_RE.test(allResponseText) && (activeIntensity === 'cooperative' || activeIntensity === 'analytical')) {
      escalatedFrom = activeIntensity;
      effectiveIntensity = 'critical';
      event.sender.send('forge:update', { phase: 'escalating', from: activeIntensity, to: 'critical', reason: 'Risk signals detected in responses' });
    }

    // Notify renderer: synthesis phase beginning
    event.sender.send('forge:update', { phase: 'synthesis:start' });

    // Synthesize when multiple providers responded
    let synthesis = responses[0].text;
    if (responses.length > 1) {
      try {
        const synthDirective = SYNTHESIS_DIRECTIVES[effectiveIntensity];
        const synthMsgs = [
          {
            role: 'system',
            content: `You are a synthesis engine. ${synthDirective}

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
            content: `User asked: "${message}"\n\n${responses.map(r => `${r.role.toUpperCase()} (${r.provider}):\n${r.text}`).join('\n\n---\n\n')}\n\nSynthesize into one final, comprehensive answer, then add the FORGE_SCORE block.`,
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
        initialConfidence,
        intensity: effectiveIntensity,
        escalatedFrom,
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
    return { responses, synthesis, forgeScore, failedProviders: failedProviders.length > 0 ? failedProviders : undefined };
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
    if (typeof content !== 'string' || content.trim().length === 0) return;
    if (content.length > MAX_MEMORY_CHARS) return;
    store.addMemory(type as 'fact' | 'goal' | 'preference' | 'business', content.trim());
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

  // ── Forge Engine (Engine Mode — Phase 1) ─────────────────────────────────────
  ipcMain.handle('forgeEngine:run', async (event, { profileType, answers }: { profileType: EngineProfileType; answers: Record<string, string> }) => {
    const lic = await store.getLicense();
    const tier = (lic.tier ?? 'free') as 'free' | 'pro' | 'business';
    if (!hasCapability('FORGE_PROFILES', tier)) {
      return { error: lockedError('FORGE_PROFILES') };
    }

    const engine = getEngineConfig(profileType);
    if (!engine) return { error: `Unknown engine type: ${profileType}` };

    const { providerManager: pm } = await getEngine();
    const providers = await pm.getActiveProviders();
    if (providers.length === 0) return { error: 'No API keys configured. Add at least one in Settings.' };

    const prompt = engine.promptTemplate(answers);
    const msgs = [
      { role: 'system', content: engine.systemPrompt },
      { role: 'user', content: prompt },
    ];

    // Tri-model parallel — same pattern as forgeProfiles:generateBlueprint
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

    // Synthesize from multiple responses when available.
    // Prefer GPT (openai) for synthesis — most reliable JSON compliance.
    const synthProvider =
      providers.find(p => p.name === 'openai') ??
      providers.find(p => p.name === 'claude') ??
      providers[0];

    let rawOutput = responses[0].text;
    if (responses.length > 1) {
      try {
        const synthMsgs = [
          {
            role: 'system',
            content: 'You are a JSON synthesis engine. You will receive multiple JSON business engine outputs. Merge them into one superior JSON object keeping the best content from each. Return ONLY valid JSON — no prose, no markdown fences.',
          },
          {
            role: 'user',
            content: `Engine type: ${engine.name}\n\nInputs: ${JSON.stringify(answers)}\n\nDraft outputs:\n\n${responses.map(r => `// ${r.provider}:\n${r.text}`).join('\n\n')}\n\nReturn one merged JSON object with keys: blueprint, assets, buildOutput.`,
          },
        ];
        rawOutput = await synthProvider.chat(synthMsgs);
      } catch { /* fall back to primary response */ }
    }

    // Robust JSON extraction: strip fences, then find the outermost { ... } block.
    function extractJson(raw: string): string {
      // Remove markdown code fences (```json ... ``` or ``` ... ```)
      const defenced = raw.replace(/^```(?:json)?\s*/im, '').replace(/\s*```\s*$/m, '').trim();
      // Find the first '{' and last '}' to extract the JSON object even if
      // the model prepended/appended prose.
      const start = defenced.indexOf('{');
      const end   = defenced.lastIndexOf('}');
      if (start === -1 || end === -1 || end <= start) return defenced;
      return defenced.slice(start, end + 1);
    }

    let parsed: { blueprint: unknown; assets: string[]; buildOutput: unknown };
    try {
      parsed = JSON.parse(extractJson(rawOutput));
    } catch {
      // Last resort: try each individual provider response in order
      let fallbackParsed: typeof parsed | null = null;
      for (const r of responses) {
        try { fallbackParsed = JSON.parse(extractJson(r.text)); break; } catch { /* continue */ }
      }
      if (!fallbackParsed) {
        return { error: 'Engine output could not be parsed. Please try again.' };
      }
      parsed = fallbackParsed;
    }

    event.sender.send('forge:update', { phase: 'complete' });

    return {
      blueprint: parsed.blueprint ?? {},
      assets: Array.isArray(parsed.assets) ? parsed.assets : [],
      buildOutput: parsed.buildOutput ?? {},
    };
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

  // ── Document Indexer ──────────────────────────────────────────────────────────

  ipcMain.handle('docs:getIndex', (_e) => {
    const perms = store.getPermissions();
    const filesGranted = perms.find(p => p.key === 'files')?.granted;
    if (!filesGranted) return { docs: [], error: 'PERMISSION_DENIED:files' };
    return { docs: store.get<DocEntry[]>('docIndex', []) };
  });

  ipcMain.handle('docs:index', async (event, startPath?: string) => {
    const perms = store.getPermissions();
    const filesGranted = perms.find(p => p.key === 'files')?.granted;
    if (!filesGranted) return { docs: [], error: 'PERMISSION_DENIED:files' };

    const files = scanForDocuments(startPath);
    const existing = store.get<DocEntry[]>('docIndex', []);

    // Only OCR files that are new or have changed since last index
    const toProcess = files.filter(f =>
      !existing.some(e => e.path === f.path && e.modified === f.modified)
    );

    event.sender.send('docs:progress', { phase: 'start', total: toProcess.length, existing: existing.length });

    // Keep already-valid entries for files still present on disk
    const retained = existing.filter(e => files.some(f => f.path === e.path));
    const results: DocEntry[] = [...retained];

    const langPath = path.join(app.getPath('userData'), 'tesseract-lang');
    if (!fs.existsSync(langPath)) { try { fs.mkdirSync(langPath, { recursive: true }); } catch { /* ignore */ } }

    // Process in batches of 3 concurrent workers
    for (let i = 0; i < toProcess.length; i += 3) {
      const batch = toProcess.slice(i, i + 3);
      const settled = await Promise.allSettled(
        batch.map(f =>
          ocrFile(f.path, langPath).then(text => ({
            path: f.path,
            name: f.name,
            size: f.size,
            modified: f.modified,
            extension: f.extension,
            ocrText: text,
            docTypes: detectDocTypes(text),
            indexedAt: new Date().toISOString(),
          } as DocEntry))
        )
      );
      settled.forEach((r, j) => {
        if (r.status === 'fulfilled') results.push(r.value);
        event.sender.send('docs:progress', {
          phase: 'indexed',
          current: i + j + 1,
          total: toProcess.length,
          name: batch[j].name,
        });
      });
    }

    store.update('docIndex', results);
    event.sender.send('docs:progress', { phase: 'complete', total: results.length });
    return { docs: results };
  });

  ipcMain.handle('docs:search', (_e, query: string) => {
    const perms = store.getPermissions();
    const filesGranted = perms.find(p => p.key === 'files')?.granted;
    if (!filesGranted) return { results: [], error: 'PERMISSION_DENIED:files' };
    const index = store.get<DocEntry[]>('docIndex', []);
    if (index.length === 0) return { results: [], needsIndex: true };
    return { results: searchIndex(index, query) };
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

  // Shared helper — builds an ExecutionPlan from a free-text synthesis/goal using
  // the first active provider. Extracted so both plan:generate and task:run reuse
  // the same prompt without duplication.
  async function generateExecutionPlan(synthesis: string, provider: { chat: (msgs: { role: string; content: string }[]) => Promise<string> }) {
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

    const msgs = [
      { role: 'system', content: 'You are a JSON execution plan generator. Output ONLY valid JSON — no markdown fences, no explanation. Start immediately with { and end with }.' },
      { role: 'user', content: prompt },
    ];
    const response = await provider.chat(msgs);
    const cleaned = response.trim()
      .replace(/^```(?:json)?\r?\n?/, '')
      .replace(/\r?\n?```$/, '');
    return JSON.parse(cleaned);
  }

  ipcMain.handle('plan:generate', async (_e, synthesis: string) => {
    const { providerManager: pm } = await getEngine();
    const providers = await pm.getActiveProviders();
    if (providers.length === 0) return { error: 'No API keys configured.' };
    const licPlan = await store.getLicense();
    const tierPlan = (licPlan.tier ?? 'free') as 'free' | 'pro' | 'business';
    if (!hasCapability('EXECUTION_PLANS', tierPlan)) return { error: lockedError('EXECUTION_PLANS') };
    try {
      const plan = await generateExecutionPlan(synthesis, providers[0]);
      return { plan };
    } catch (err: unknown) {
      return { error: err instanceof Error ? err.message : 'Failed to generate plan.' };
    }
  });

  // Task runtime — decomposes goal with IntentEngine, generates an ExecutionPlan,
  // emits task:update events for live progress, and logs the plan to the Ledger.
  ipcMain.handle('task:run', async (event, goal: string) => {
    if (typeof goal !== 'string' || goal.trim().length === 0) return { error: 'Goal is required.' };
    if (goal.length > MAX_MESSAGE_CHARS) return { error: `Goal too long (max ${MAX_MESSAGE_CHARS} chars).` };

    const licTask = await store.getLicense();
    const tierTask = (licTask.tier ?? 'free') as 'free' | 'pro' | 'business';
    if (!hasCapability('EXECUTION_PLANS', tierTask)) return { error: lockedError('EXECUTION_PLANS') };

    const { providerManager: pm, intentEngine: ie } = await getEngine();
    const providers = await pm.getActiveProviders();
    if (providers.length === 0) return { error: 'No API keys configured.' };

    // Phase 1 — Decompose with IntentEngine for a richer goal statement
    event.sender.send('task:update', { phase: 'decomposing' });
    let enrichedGoal = goal.trim();
    try {
      const intent = await ie.decompose(goal);
      if (intent?.goalStatement) enrichedGoal = intent.goalStatement;
    } catch { /* fall through with raw goal */ }

    // Phase 2 — Generate the structured execution plan
    event.sender.send('task:update', { phase: 'planning' });
    try {
      const plan = await generateExecutionPlan(enrichedGoal, providers[0]);

      // Log to Ledger with task workflow tag
      const taskId = crypto.randomUUID();
      store.addLedger({
        id: taskId,
        timestamp: Date.now(),
        request: goal,
        synthesis: plan.summary ?? enrichedGoal,
        workflow: 'TASK_EVENT:PLAN',
        starred: false,
      });

      event.sender.send('task:update', { phase: 'ready' });
      return { plan, summary: enrichedGoal, taskId };
    } catch (err: unknown) {
      return { error: err instanceof Error ? err.message : 'Failed to generate task plan.' };
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

  // ── Window controls ─────────────────────────────────────────────────────────

  ipcMain.handle('window:minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });

  ipcMain.handle('window:toggleFullscreen', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return false;
    win.setFullScreen(!win.isFullScreen());
    return win.isFullScreen();
  });

  ipcMain.handle('window:isFullscreen', (event) => {
    return BrowserWindow.fromWebContents(event.sender)?.isFullScreen() ?? false;
  });

  // ── Grok Voice Agent ─────────────────────────────────────────────────────────

  let grokVoiceAgent: GrokVoiceAgent | null = null;

  ipcMain.handle('voice:agent:connect', async (event, opts: { voice?: string }) => {
    const apiKey = await store.getSecret('grok');
    if (!apiKey) return { error: 'No Grok API key configured.' };
    grokVoiceAgent?.disconnect();
    grokVoiceAgent = new GrokVoiceAgent(apiKey, opts?.voice ?? 'Ara', (e) => {
      if (!event.sender.isDestroyed()) event.sender.send('voice:agent:event', e);
    });
    grokVoiceAgent.connect();
    return { ok: true };
  });

  ipcMain.handle('voice:agent:send', (_event, pcm16b64: string) => {
    grokVoiceAgent?.sendAudio(Buffer.from(pcm16b64, 'base64'));
  });

  ipcMain.handle('voice:agent:commit', () => {
    grokVoiceAgent?.commitAudio();
  });

  ipcMain.handle('voice:agent:disconnect', () => {
    grokVoiceAgent?.disconnect();
    grokVoiceAgent = null;
  });

  // ── Task Engine ───────────────────────────────────────────────────────────────

  async function _agentTier(): Promise<'free' | 'pro' | 'business'> {
    return ((await store.getLicense()).tier ?? 'free') as 'free' | 'pro' | 'business';
  }

  ipcMain.handle('taskEngine:createTask', async (_event, goal: string, category: TaskCategory) => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    try {
      const loop = _getAgentLoop(store);
      const task = loop.createTask(goal, category);
      return { task };
    } catch (err) {
      return { error: String(err) };
    }
  });

  ipcMain.handle('taskEngine:runTask', async (_event, taskId: string, trustOverride?: TrustModeSnapshot) => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    try {
      const loop = _getAgentLoop(store);
      // Fire in background — events delivered by persistent forwarder
      loop.runTask(taskId, trustOverride).catch((err: unknown) => console.error('[taskEngine:runTask]', err));
      return { ok: true, started: true };
    } catch (err) {
      return { error: String(err) };
    }
  });

  ipcMain.handle('taskEngine:approveStep', async (_event, taskId: string, stepId: string) => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    try {
      await _getAgentLoop(store).approveStep(taskId, stepId);
      return { ok: true };
    } catch (err) {
      return { error: String(err) };
    }
  });

  ipcMain.handle('taskEngine:denyStep', async (_event, taskId: string, stepId: string, reason?: string) => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    try {
      await _getAgentLoop(store).denyStep(taskId, stepId, reason);
      return { ok: true };
    } catch (err) {
      return { error: String(err) };
    }
  });

  ipcMain.handle('taskEngine:cancelTask', async (_event, taskId: string) => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    try {
      await _getAgentLoop(store).cancelTask(taskId);
      return { ok: true };
    } catch (err) {
      return { error: String(err) };
    }
  });

  ipcMain.handle('taskEngine:getTask', async (_event, taskId: string) => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    const task = _getTaskStore().read(taskId);
    return { task };
  });

  ipcMain.handle('taskEngine:listTasks', async (_event, filter?: { category?: TaskCategory; status?: TaskStatus }) => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    const tasks = _getTaskStore().list(filter);
    return { tasks };
  });

  // ── Trust config ──────────────────────────────────────────────────────────────

  ipcMain.handle('trust:getConfig', async () => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    const config = store.get<TrustModeSnapshot>(TRUST_KEY, DEFAULT_TRUST_SNAPSHOT);
    return { config };
  });

  ipcMain.handle('trust:setConfig', async (_event, config: TrustModeSnapshot) => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    const errors = validateTrustMode(config);
    if (errors.length > 0) return { error: errors.join('; ') };
    store.update(TRUST_KEY, config);
    return { ok: true };
  });

  // ── Wallet ────────────────────────────────────────────────────────────────────

  ipcMain.handle('wallet:getBalance', async () => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    const snapshot = _getWalletEngine(store).getSnapshot();
    return { snapshot };
  });

  // ── Scheduler ─────────────────────────────────────────────────────────────────

  ipcMain.handle('scheduler:addJob', async (_event, taskGoal: string, category: TaskCategory, cronExpr: string, label?: string) => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    const job = _getScheduler().scheduleRecurring(taskGoal, category, cronExpr, label);
    if (!job) return { error: 'Invalid cron expression. Use: daily@HH:MM or every@Nh' };
    return { job };
  });

  ipcMain.handle('scheduler:addOnceJob', async (_event, taskGoal: string, category: TaskCategory, runAt: number) => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    const job = _getScheduler().scheduleOnce(taskGoal, category, runAt);
    return { job };
  });

  ipcMain.handle('scheduler:cancelJob', async (_event, jobId: string) => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    const ok = _getScheduler().cancelJob(jobId);
    return { ok };
  });

  ipcMain.handle('scheduler:listJobs', async () => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    const jobs = _getScheduler().listJobs();
    return { jobs };
  });

  // ── Audit Ledger ──────────────────────────────────────────────────────────────

  ipcMain.handle('audit:getRecent', async (_event, n: number = 50) => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    const entries = await _getAuditLedger().getRecent(n);
    return { entries };
  });

  ipcMain.handle('audit:tailSince', async (_event, ts: number) => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    const entries = await _getAuditLedger().tailSince(ts);
    return { entries };
  });

  // ── Engine event ring buffer ──────────────────────────────────────────────────

  ipcMain.handle('engine:subscribeEvents', async (_event, sinceId?: string) => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    const events: EventRecord[] = eventBus.since(sinceId);
    const lastId = eventBus.getLastId();
    return { events, lastId };
  });

  // ── Engine health ─────────────────────────────────────────────────────────────

  ipcMain.handle('engine:getHealth', async () => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    const tasks = _getTaskStore().list();
    const runningTasks  = tasks.filter(t => t.status === 'running').length;
    const queuedTasks   = tasks.filter(t => ['queued', 'pending', 'planning'].includes(t.status)).length;
    const pendingApprovals = _getApprovalStore().listPending().length;
    const lastEventId   = eventBus.getLastId();
    return { runningTasks, queuedTasks, pendingApprovals, lastEventId, paperTradingOnly: PAPER_TRADING_ONLY };
  });

  // ── Approvals ─────────────────────────────────────────────────────────────────

  ipcMain.handle('approvals:list', async () => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    const requests = _getApprovalStore().listPending();
    return { requests };
  });

  ipcMain.handle('approvals:approve', async (_event, approvalId: string) => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    try {
      const loop = _getAgentLoop(store);
      await loop.approveApprovalRequest(approvalId);
      // Resume task in background
      const req = _getApprovalStore().get(approvalId);
      if (req?.taskId) {
        loop.runTask(req.taskId).catch((err: unknown) => console.error('[approvals:approve]', err));
      }
      return { ok: true };
    } catch (err) {
      return { error: String(err) };
    }
  });

  ipcMain.handle('approvals:deny', async (_event, approvalId: string, reason?: string) => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    try {
      const loop = _getAgentLoop(store);
      const req = _getApprovalStore().get(approvalId);
      await loop.denyApprovalRequest(approvalId, reason);
      // Continue remaining steps in background
      if (req?.taskId) {
        loop.runTask(req.taskId).catch((err: unknown) => console.error('[approvals:deny]', err));
      }
      return { ok: true };
    } catch (err) {
      return { error: String(err) };
    }
  });

  // ── Task pause / resume ───────────────────────────────────────────────────────

  ipcMain.handle('task:pause', async (_event, taskId: string) => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    try {
      await _getAgentLoop(store).pauseTask(taskId);
      return { ok: true };
    } catch (err) {
      return { error: String(err) };
    }
  });

  ipcMain.handle('task:resume', async (_event, taskId: string) => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    try {
      const loop = _getAgentLoop(store);
      await loop.resumeTask(taskId);
      loop.runTask(taskId).catch((err: unknown) => console.error('[task:resume]', err));
      return { ok: true };
    } catch (err) {
      return { error: String(err) };
    }
  });

  // ── Phase 4: Credentials ──────────────────────────────────────────────────

  ipcMain.handle('credentials:set', async (_e, key: string, value: string) => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    if (typeof key !== 'string' || !key.trim()) return { error: 'Invalid key' };
    if (typeof value !== 'string') return { error: 'Invalid value' };
    try {
      await _getCredentialManager(store).set(key as never, value);
      // Re-register mail adapter so new SMTP config is picked up immediately
      serviceLocator.registerMailSender(createMailAdapter(_getCredentialManager(store)));
      return { ok: true };
    } catch (err) {
      return { error: String(err) };
    }
  });

  ipcMain.handle('credentials:get', async (_e, key: string) => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    try {
      const value = await _getCredentialManager(store).get(key as never);
      // Return masked value for display (never expose plaintext secrets to renderer)
      return { set: value !== undefined && value !== '', masked: value ? '••••••••' : '' };
    } catch (err) {
      return { error: String(err) };
    }
  });

  ipcMain.handle('credentials:delete', async (_e, key: string) => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    try {
      await _getCredentialManager(store).delete(key as never);
      return { ok: true };
    } catch (err) {
      return { error: String(err) };
    }
  });

  ipcMain.handle('credentials:list', async () => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    try {
      const keys = await _getCredentialManager(store).list();
      return { keys };
    } catch (err) {
      return { error: String(err) };
    }
  });

  // ── Phase 4: Execution Results ────────────────────────────────────────────

  ipcMain.handle('results:list', async (_e, taskId?: string) => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    try {
      const results = _getResultStore().query(taskId);
      return { results };
    } catch (err) {
      return { error: String(err) };
    }
  });

  ipcMain.handle('results:getMetrics', async (_e, taskId?: string) => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    try {
      const metrics = _getResultStore().getMetrics(taskId);
      return { metrics };
    } catch (err) {
      return { error: String(err) };
    }
  });

  // ── Phase 4: Service status ────────────────────────────────────────────────

  ipcMain.handle('hustle:getServiceStatus', async () => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    return serviceLocator.getStatus();
  });

  // ── Phase 5: Value Engine — Campaigns ────────────────────────────────────

  ipcMain.handle('value:listCampaigns', async () => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    try {
      const campaigns = _getValueEngine().listCampaigns();
      return { campaigns };
    } catch (err) {
      return { error: String(err) };
    }
  });

  ipcMain.handle('value:createCampaign', async (_e, name: string, type: string, description?: string) => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    try {
      if (!name?.trim()) return { error: 'Campaign name is required' };
      const campaign = _getValueEngine().createCampaign(
        name.trim(),
        type as import('@triforge/engine').CampaignType,
        description,
      );
      return { campaign };
    } catch (err) {
      return { error: String(err) };
    }
  });

  ipcMain.handle('value:linkTask', async (_e, campaignId: string, taskId: string) => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    try {
      const ok = _getValueEngine().linkTask(campaignId, taskId);
      return { ok };
    } catch (err) {
      return { error: String(err) };
    }
  });

  ipcMain.handle('value:getCampaignMetrics', async (_e, campaignId: string) => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    try {
      const metrics = _getValueEngine().getCampaignMetrics(campaignId);
      return { metrics };
    } catch (err) {
      return { error: String(err) };
    }
  });

  ipcMain.handle('value:getGlobalMetrics', async () => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    try {
      const metrics = _getValueEngine().getGlobalMetrics();
      return { metrics };
    } catch (err) {
      return { error: String(err) };
    }
  });

  ipcMain.handle('value:getOptimization', async (_e, campaignId: string) => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    try {
      const result = _getValueEngine().getOptimization(campaignId);
      return { result };
    } catch (err) {
      return { error: String(err) };
    }
  });

  ipcMain.handle('value:recordValue', async (_e, taskId: string, amountCents: number, note?: string, campaignId?: string) => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    try {
      if (typeof amountCents !== 'number' || amountCents < 0) return { error: 'Invalid amount' };
      _getValueEngine().recordValue(taskId, amountCents, note, campaignId);
      return { ok: true };
    } catch (err) {
      return { error: String(err) };
    }
  });

  ipcMain.handle('value:recordReply', async (_e, taskId: string, from: string, sentiment: string, campaignId?: string) => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    try {
      _getValueEngine().recordReply(
        taskId,
        from,
        (sentiment ?? 'neutral') as 'positive' | 'neutral' | 'negative',
        campaignId,
      );
      return { ok: true };
    } catch (err) {
      return { error: String(err) };
    }
  });

  // ── Phase 6: Growth Engine — Loops ────────────────────────────────────────

  ipcMain.handle('growth:listLoops', async () => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    try {
      return { loops: _getGrowthService().listLoops() };
    } catch (err) { return { error: String(err) }; }
  });

  ipcMain.handle('growth:createLoop', async (_e,
    goal: string, type: string, config: Record<string, unknown>, campaignId?: string,
  ) => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    try {
      if (!goal?.trim()) return { error: 'Goal is required' };
      const validTypes = ['outreach', 'content', 'hybrid'];
      if (!validTypes.includes(type)) return { error: 'Invalid loop type' };
      const loop = _getGrowthService().createLoop({
        goal: goal.trim(),
        type: type as import('@triforge/engine').GrowthLoopType,
        status: 'active',
        campaignId,
        config: config ?? {},
      });
      return { loop };
    } catch (err) { return { error: String(err) }; }
  });

  ipcMain.handle('growth:pauseLoop', async (_e, loopId: string) => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    try {
      const loop = _getGrowthService().pauseLoop(loopId);
      return loop ? { ok: true, loop } : { error: 'Loop not found' };
    } catch (err) { return { error: String(err) }; }
  });

  ipcMain.handle('growth:resumeLoop', async (_e, loopId: string) => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    try {
      const loop = _getGrowthService().resumeLoop(loopId);
      return loop ? { ok: true, loop } : { error: 'Loop not found' };
    } catch (err) { return { error: String(err) }; }
  });

  ipcMain.handle('growth:deleteLoop', async (_e, loopId: string) => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    try {
      const ok = _getGrowthService().deleteLoop(loopId);
      return { ok };
    } catch (err) { return { error: String(err) }; }
  });

  ipcMain.handle('growth:runNow', async (_e, loopId: string) => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    try {
      // Run in background — return immediately
      _getGrowthService().runLoop(loopId).catch(console.error);
      return { ok: true, started: true };
    } catch (err) { return { error: String(err) }; }
  });

  ipcMain.handle('growth:getLoopMetrics', async (_e, loopId: string) => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    try {
      return { metrics: _getGrowthService().getLoopMetrics(loopId) };
    } catch (err) { return { error: String(err) }; }
  });

  ipcMain.handle('growth:getGlobalMetrics', async () => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    try {
      return { metrics: _getGrowthService().getGlobalGrowthMetrics() };
    } catch (err) { return { error: String(err) }; }
  });

  // ── Phase 6: Growth Engine — Leads ────────────────────────────────────────

  ipcMain.handle('growth:listLeads', async (_e, loopId?: string) => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    try {
      return { leads: _getGrowthService().listLeads(loopId) };
    } catch (err) { return { error: String(err) }; }
  });

  ipcMain.handle('growth:addLead', async (_e, contact: string, name?: string, loopId?: string, campaignId?: string) => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    try {
      if (!contact?.trim()) return { error: 'Contact is required' };
      const lead = _getGrowthService().addLead({
        source: 'manual',
        contact: contact.trim(),
        name,
        status: 'new',
        loopId,
        campaignId,
      });
      return { lead };
    } catch (err) { return { error: String(err) }; }
  });

  ipcMain.handle('growth:updateLead', async (_e, leadId: string, patch: Record<string, unknown>) => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    try {
      const lead = _getGrowthService().updateLead(leadId, patch);
      return lead ? { ok: true, lead } : { error: 'Lead not found' };
    } catch (err) { return { error: String(err) }; }
  });

  // ── Phase 7: Compound Engine ──────────────────────────────────────────────────

  ipcMain.handle('compound:listStrategies', async (_e, type?: string) => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    try {
      const validType = (type === 'outreach' || type === 'content') ? type : undefined;
      return { strategies: _getCompoundEngine().getTopStrategies(50, validType) };
    } catch (err) { return { error: String(err) }; }
  });

  ipcMain.handle('compound:getTopStrategies', async (_e, limit?: number) => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    try {
      return { strategies: _getCompoundEngine().getTopStrategies(limit ?? 5) };
    } catch (err) { return { error: String(err) }; }
  });

  ipcMain.handle('compound:getStats', async () => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    try {
      return { stats: _getCompoundEngine().getCompoundStats() };
    } catch (err) { return { error: String(err) }; }
  });

  ipcMain.handle('compound:runOptimization', async () => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    try {
      const result = _getGrowthService().runOptimization();
      return { result };
    } catch (err) { return { error: String(err) }; }
  });
}
