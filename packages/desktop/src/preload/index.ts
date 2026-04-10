import { contextBridge, ipcRenderer } from 'electron';
import type { ContextualIntelligenceResult } from '@triforge/engine';

// Typed API exposed to the renderer via window.triforge
const api = {
  // Permissions
  permissions: {
    get: () => ipcRenderer.invoke('permissions:get'),
    set: (key: string, granted: boolean, budgetLimit?: number) =>
      ipcRenderer.invoke('permissions:set', key, granted, budgetLimit),
    isFirstRun: () => ipcRenderer.invoke('permissions:firstRun'),
    markDone: () => ipcRenderer.invoke('permissions:markDone'),
  },

  // API Keys
  keys: {
    set: (provider: string, key: string) => ipcRenderer.invoke('keys:set', provider, key),
    delete: (provider: string) => ipcRenderer.invoke('keys:delete', provider),
    status: () => ipcRenderer.invoke('keys:status') as Promise<Record<string, boolean>>,
  },

  // Engine
  engine: {
    mode: () => ipcRenderer.invoke('engine:mode') as Promise<string>,
  },

  // Chat
  chat: {
    send: (message: string, history: Array<{ role: string; content: string }>) =>
      ipcRenderer.invoke('chat:send', message, history) as Promise<{ text?: string; provider?: string; error?: string; tier?: string }>,
    onChunk: (cb: (chunk: string) => void): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, chunk: string) => cb(chunk);
      ipcRenderer.on('chat:chunk', handler);
      return () => ipcRenderer.removeListener('chat:chunk', handler);
    },
    consensus: (message: string, history: Array<{ role: string; content: string }>, intensity?: string, deliberate?: boolean) =>
      ipcRenderer.invoke('chat:consensus', message, history, intensity, deliberate) as Promise<{
        responses?: Array<{ provider: string; text: string; role?: string }>;
        synthesis?: string;
        forgeScore?: {
          confidence: number; agreement: string; disagreement: string;
          risk: 'Low'|'Medium'|'High'; assumptions: string; verify: string;
          initialConfidence?: number; intensity?: string; escalatedFrom?: string;
        };
        failedProviders?: Array<{ provider: string; error: string }>;
        error?: string;
        tier?: string;
      }>,
    conversation: (message: string, history: Array<{ role: string; content: string }>) =>
      ipcRenderer.invoke('chat:conversation', message, history) as Promise<{
        responses?: Array<{ provider: string; text: string }>;
        synthesis?: string;
        durationMs?: number;
        error?: string;
        tier?: string;
        contextualIntelligence?: ContextualIntelligenceResult | null;
        /** Populated when the user's message is an operator-action intent */
        operatorSuggestion?: { goal: string; appName?: string };
      }>,
  },

  // Think Tank
  thinktank: {
    run: (goal: string) =>
      ipcRenderer.invoke('thinktank:run', goal) as Promise<{ plan?: unknown; error?: string }>,
  },

  // App Builder
  appBuilder: {
    generate: (spec: { appType: string; audience: string; features: string; dataSave: string; style: string; extras: string }) =>
      ipcRenderer.invoke('appbuilder:generate', spec) as Promise<{ html?: string; error?: string }>,
    save: (appName: string, html: string) =>
      ipcRenderer.invoke('appbuilder:save', appName, html) as Promise<{ path?: string; error?: string }>,
    openPreview: (html: string) =>
      ipcRenderer.invoke('appbuilder:openPreview', html) as Promise<{ ok: boolean; error?: string }>,
    analyze: (
      spec: { appType: string; audience: string; features: string; dataSave: string; style: string; extras: string },
      html: string,
    ) => ipcRenderer.invoke('appbuilder:analyze', spec, html) as Promise<{
      services: Array<{
        name: string; emoji: string; tagline: string;
        what: string; where: string; why: string;
        how: string[]; free: boolean; freeNote?: string;
      }>;
    }>,
  },

  // Voice
  voice: {
    transcribe: (audioBuffer: Uint8Array | Buffer) =>
      ipcRenderer.invoke('voice:transcribe', Buffer.from(audioBuffer)) as Promise<{ text?: string; error?: string }>,
    speak: (text: string) =>
      ipcRenderer.invoke('voice:speak', text) as Promise<{ ok?: boolean; error?: string }>,
    onSpeakChunk: (cb: (b64: string) => void): (() => void) => {
      const h = (_: Electron.IpcRendererEvent, b: string) => cb(b);
      ipcRenderer.on('voice:speak:chunk', h);
      return () => ipcRenderer.removeListener('voice:speak:chunk', h);
    },
    onSpeakDone: (cb: () => void): (() => void) => {
      const h = () => cb();
      ipcRenderer.on('voice:speak:done', h);
      return () => ipcRenderer.removeListener('voice:speak:done', h);
    },
    interrupt: () => ipcRenderer.invoke('voice:interrupt') as Promise<{ ok?: boolean }>,
    agent: {
      connect:    (opts: { voice?: string }) => ipcRenderer.invoke('voice:agent:connect', opts) as Promise<{ ok?: boolean; error?: string }>,
      send:       (pcm16b64: string)         => ipcRenderer.invoke('voice:agent:send', pcm16b64),
      commit:     ()                         => ipcRenderer.invoke('voice:agent:commit'),
      disconnect: ()                         => ipcRenderer.invoke('voice:agent:disconnect'),
      onEvent:    (cb: (e: { type: string; role?: string; text?: string; data?: string; message?: string }) => void): (() => void) => {
        const handler = (_: Electron.IpcRendererEvent, e: { type: string; role?: string; text?: string; data?: string; message?: string }) => cb(e);
        ipcRenderer.on('voice:agent:event', handler);
        return () => ipcRenderer.removeListener('voice:agent:event', handler);
      },
    },
    /** Notify main process that the wake word was detected (relays to voiceBus + councilBus). */
    notifyWake: (): void => ipcRenderer.send('voice:wake-detected'),
    /** Report a raw detected phrase to main for validation. Main sends back 'voice-command'. */
    reportWakePhrase: (phrase: string): void => ipcRenderer.send('voice:wake:phrase', phrase),
    /** Subscribe to sanitized voice commands from main (trust boundary). */
    onVoiceCommand: (cb: (cmd: string) => void): (() => void) => {
      const h = (_: Electron.IpcRendererEvent, cmd: string) => cb(cmd);
      ipcRenderer.on('voice-command', h);
      return () => ipcRenderer.removeListener('voice-command', h);
    },
    /** Ensure Vosk model is cached in userData (downloads on first run). Renderer
     *  then fetches the zip directly via vosk-model://model.zip custom protocol —
     *  no 40 MB ArrayBuffer over IPC. */
    ensureWakeModel: (): Promise<void> =>
      ipcRenderer.invoke('voice:wake:ensure-model') as Promise<void>,
    /** @deprecated Use ensureWakeModel() + vosk-model://model.zip instead. */
    getWakeModelData: (): Promise<ArrayBuffer> =>
      ipcRenderer.invoke('voice:wake:model-data') as Promise<ArrayBuffer>,
  },

  // Window controls
  appWindow: {
    minimize:         () => ipcRenderer.invoke('window:minimize'),
    toggleFullscreen: () => ipcRenderer.invoke('window:toggleFullscreen') as Promise<boolean>,
    isFullscreen:     () => ipcRenderer.invoke('window:isFullscreen') as Promise<boolean>,
  },

  // Memory
  memory: {
    get: () => ipcRenderer.invoke('memory:get') as Promise<Array<{ id: number; type: string; content: string; created_at: number }>>,
    add: (type: string, content: string) => ipcRenderer.invoke('memory:add', type, content),
    delete: (id: number) => ipcRenderer.invoke('memory:delete', id) as Promise<Array<{ id: number; type: string; content: string; created_at: number }>>,
  },

  // Decision Ledger
  ledger: {
    get:    (search?: string, limit?: number) =>
      ipcRenderer.invoke('ledger:get', search, limit) as Promise<Array<{
        id: string; timestamp: number; request: string; synthesis: string;
        forgeScore?: { confidence: number; agreement: string; disagreement: string; risk: 'Low'|'Medium'|'High'; assumptions: string; verify: string };
        responses?: Array<{ provider: string; text: string }>;
        workflow?: string; starred: boolean;
      }>>,
    star:   (id: string, starred: boolean) =>
      ipcRenderer.invoke('ledger:star', id, starred) as Promise<Array<{
        id: string; timestamp: number; request: string; synthesis: string;
        forgeScore?: { confidence: number; agreement: string; disagreement: string; risk: 'Low'|'Medium'|'High'; assumptions: string; verify: string };
        responses?: Array<{ provider: string; text: string }>;
        workflow?: string; starred: boolean;
      }>>,
    delete: (id: string) =>
      ipcRenderer.invoke('ledger:delete', id) as Promise<Array<{
        id: string; timestamp: number; request: string; synthesis: string;
        forgeScore?: { confidence: number; agreement: string; disagreement: string; risk: 'Low'|'Medium'|'High'; assumptions: string; verify: string };
        responses?: Array<{ provider: string; text: string }>;
        workflow?: string; starred: boolean;
      }>>,
    export: (id: string | null, format: 'md' | 'pdf') =>
      ipcRenderer.invoke('ledger:export', id, format) as Promise<{ ok: boolean; path?: string }>,
  },

  // Execution Plans
  plan: {
    generate: (synthesis: string) =>
      ipcRenderer.invoke('plan:generate', synthesis) as Promise<{
        plan?: {
          planTitle: string; riskLevel: 'Low'|'Medium'|'High'; summary: string;
          steps: Array<{
            id: string; title: string;
            type: 'review'|'browser'|'file'|'research'|'decision'|'command'|'print';
            description: string; details?: string; requiresApproval: boolean;
            risk: 'Low'|'Medium'|'High';
          }>;
        };
        error?: string;
      }>,
    runCommand: (cmd: string) =>
      ipcRenderer.invoke('plan:runCommand', cmd) as Promise<{ output?: string; error?: string }>,
  },

  // Task Runtime — IntentEngine decompose + auto-execution loop
  task: {
    run: (goal: string) =>
      ipcRenderer.invoke('task:run', goal) as Promise<{
        plan?: {
          planTitle: string; riskLevel: 'Low'|'Medium'|'High'; summary: string;
          steps: Array<{
            id: string; title: string;
            type: 'review'|'browser'|'file'|'research'|'decision'|'command'|'print';
            description: string; details?: string; requiresApproval: boolean;
            risk: 'Low'|'Medium'|'High';
          }>;
        };
        summary?: string; taskId?: string; error?: string;
      }>,
    onUpdate: (cb: (data: { phase: string }) => void): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, data: { phase: string }) => cb(data);
      ipcRenderer.on('task:update', handler);
      return () => ipcRenderer.removeListener('task:update', handler);
    },
  },

  // User profile
  profile: {
    get: () => ipcRenderer.invoke('profile:get') as Promise<Record<string, string>>,
    set: (profile: Record<string, string>) => ipcRenderer.invoke('profile:set', profile),
  },

  // Forge Profiles (industry operational profiles)
  forgeProfiles: {
    list: () => ipcRenderer.invoke('forgeProfiles:list') as Promise<{
      profiles?: Array<{
        id: string; name: string; icon: string; description: string;
        systemContext: string;
        memoryPreset: Array<{ type: string; content: string }>;
        executionTemplates: Array<{ id: string; title: string; description: string; steps: string[] }>;
        appScaffold: { description: string; modules: string[] };
        kpiModel: string[];
        blueprintSections: string[];
        blueprintPrompt: string;
      }>;
      error?: string;
    }>,
    getActive: () => ipcRenderer.invoke('forgeProfiles:getActive') as Promise<{
      id: string | null;
      profile: {
        id: string; name: string; icon: string; description: string;
        systemContext: string;
        memoryPreset: Array<{ type: string; content: string }>;
        executionTemplates: Array<{ id: string; title: string; description: string; steps: string[] }>;
        appScaffold: { description: string; modules: string[] };
        kpiModel: string[];
        blueprintSections: string[];
        blueprintPrompt: string;
      } | null;
    }>,
    activate: (id: string) => ipcRenderer.invoke('forgeProfiles:activate', id) as Promise<{
      ok?: boolean;
      profile?: {
        id: string; name: string; icon: string; description: string;
        systemContext: string;
        memoryPreset: Array<{ type: string; content: string }>;
        executionTemplates: Array<{ id: string; title: string; description: string; steps: string[] }>;
        appScaffold: { description: string; modules: string[] };
        kpiModel: string[];
        blueprintSections: string[];
        blueprintPrompt: string;
      };
      error?: string;
    }>,
    deactivate: () => ipcRenderer.invoke('forgeProfiles:deactivate') as Promise<{ ok?: boolean; error?: string }>,
    generateBlueprint: (id: string) => ipcRenderer.invoke('forgeProfiles:generateBlueprint', id) as Promise<{
      markdown?: string;
      providers?: Record<string, string>;
      ledgerEntryId?: string;
      error?: string;
    }>,
  },

  // Forge Engine (Business Engine Mode — Phase 1 + 2)
  forgeEngine: {
    listEngines: () =>
      ipcRenderer.invoke('forgeEngine:listEngines') as Promise<Array<{
        id: string;
        name: string;
        category: string;
        description: string;
        icon: string;
        detail: string;
        questions: Array<{ key: string; label: string; type: 'text' | 'select'; options?: string[] }>;
      }>>,
    run: (engineId: string, answers: Record<string, string>) =>
      ipcRenderer.invoke('forgeEngine:run', { engineId, answers }) as Promise<{
        blueprint?: Record<string, string>;
        assets?: Array<{ type: string; body: string }>;
        buildOutput?: Record<string, string[]>;
        error?: string;
      }>,
    executeFirstStep: (
      engineId: string,
      blueprint: Record<string, string>,
      buildOutput: Record<string, string[]>,
    ) =>
      ipcRenderer.invoke('forgeEngine:executeFirstStep', { engineId, blueprint, buildOutput }) as Promise<{
        executionPlan?: { immediate: string[]; thisWeek: string[]; nextPhase: string[] };
        firstTask?: { title: string; objective: string; steps: string[]; resources?: string[]; deliverable: string };
        marketing?: {
          poster?: { prompt: string; description: string };
          website?: { prompt: string; description: string };
          app?: { prompt: string; description: string };
        };
        error?: string;
      }>,
    generateImage: (prompt: string) =>
      ipcRenderer.invoke('forgeEngine:generateImage', { prompt }) as Promise<{
        url?: string;
        error?: string;
      }>,
  },

  // Pro Image Generator
  image: {
    generate: (req: {
      userPrompt: string;
      style?: string;
      negativePrompt?: string;
      seed?: number;
      count?: number;
      width?: number;
      height?: number;
      quality?: 'standard' | 'hd';
      imageStyle?: 'vivid' | 'natural';
      enableCritique?: boolean;
      enableRefine?: boolean;
    }) => ipcRenderer.invoke('image:generate', req) as Promise<{
      id?: string;
      userPrompt?: string;
      refinedPrompt?: string;
      images?: Array<{ base64: string; mimeType: string; seed?: number; generator: string }>;
      bestIndex?: number;
      critique?: unknown;
      durationMs?: number;
      generator?: string;
      error?: string;
    }>,
    history: (n?: number) =>
      ipcRenderer.invoke('image:history', n) as Promise<unknown[]>,
    delete: (id: string) =>
      ipcRenderer.invoke('image:delete', id) as Promise<{ ok: boolean }>,
    styles: () =>
      ipcRenderer.invoke('image:styles') as Promise<string[]>,
  },

  // Council Executor + Provider Selector
  council: {
    execute: (request: string, category?: string) =>
      ipcRenderer.invoke('council:execute', request, category) as Promise<{
        expanded?: string;
        plan?: unknown;
        critique?: string;
        durationMs?: number;
        error?: string;
      }>,
    providers: () =>
      ipcRenderer.invoke('council:providers') as Promise<string[]>,
    onConsensus: (cb: (e: { missionId: string; winnerId: string; score: number; candidateCount: number; ts: number }) => void): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, e: unknown) => cb(e as Parameters<typeof cb>[0]);
      ipcRenderer.on('council:consensus', handler);
      return () => ipcRenderer.removeListener('council:consensus', handler);
    },
    onConsensusMeta: (cb: (e: { missionId: string; winnerApproach: string; score: number; risks?: string[]; reason?: string; ts: number }) => void): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, e: unknown) => cb(e as Parameters<typeof cb>[0]);
      ipcRenderer.on('council:consensus_meta', handler);
      return () => ipcRenderer.removeListener('council:consensus_meta', handler);
    },
  },

  // Task Engine (Phase 3 + 3.5 — autonomous execution)
  taskEngine: {
    createTask: (goal: string, category: string) =>
      ipcRenderer.invoke('taskEngine:createTask', goal, category) as Promise<{ task?: unknown; error?: string }>,
    runTask: (taskId: string, trustOverride?: unknown) =>
      ipcRenderer.invoke('taskEngine:runTask', taskId, trustOverride) as Promise<{ ok?: boolean; started?: boolean; error?: string }>,
    approveStep: (taskId: string, stepId: string) =>
      ipcRenderer.invoke('taskEngine:approveStep', taskId, stepId) as Promise<{ ok?: boolean; error?: string }>,
    denyStep: (taskId: string, stepId: string, reason?: string) =>
      ipcRenderer.invoke('taskEngine:denyStep', taskId, stepId, reason) as Promise<{ ok?: boolean; error?: string }>,
    cancelTask: (taskId: string) =>
      ipcRenderer.invoke('taskEngine:cancelTask', taskId) as Promise<{ ok?: boolean; error?: string }>,
    getTask: (taskId: string) =>
      ipcRenderer.invoke('taskEngine:getTask', taskId) as Promise<{ task?: unknown; error?: string }>,
    listTasks: (filter?: { category?: string; status?: string }) =>
      ipcRenderer.invoke('taskEngine:listTasks', filter) as Promise<{ tasks?: unknown[]; error?: string }>,
    subscribeEvents: (sinceId?: string) =>
      ipcRenderer.invoke('engine:subscribeEvents', sinceId) as Promise<{ events?: unknown[]; lastId?: string | null; error?: string }>,
    onEvent: (cb: (ev: { type: string; [key: string]: unknown }) => void): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, ev: { type: string; [key: string]: unknown }) => cb(ev);
      ipcRenderer.on('taskEngine:event', handler);
      return () => ipcRenderer.removeListener('taskEngine:event', handler);
    },
    onSchedulerFired: (cb: (data: { jobId: string; goal: string; category: string }) => void): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, data: { jobId: string; goal: string; category: string }) => cb(data);
      ipcRenderer.on('scheduler:jobFired', handler);
      return () => ipcRenderer.removeListener('scheduler:jobFired', handler);
    },
  },

  // Trust config
  trust: {
    getConfig: () =>
      ipcRenderer.invoke('trust:getConfig') as Promise<{ config?: unknown; error?: string }>,
    setConfig: (config: unknown) =>
      ipcRenderer.invoke('trust:setConfig', config) as Promise<{ ok?: boolean; error?: string }>,
  },

  // Wallet (budget tracking)
  wallet: {
    getBalance: () =>
      ipcRenderer.invoke('wallet:getBalance') as Promise<{ snapshot?: unknown; error?: string }>,
    getPaperBalance: () =>
      ipcRenderer.invoke('wallet:paperBalance:get') as Promise<{ balance?: number; error?: string }>,
    setPaperBalance: (amount: number) =>
      ipcRenderer.invoke('wallet:paperBalance:set', amount) as Promise<{ ok?: boolean; balance?: number; error?: string }>,
    paperTrade: (trade: {
      ticker: string;
      side: 'long' | 'short';
      thesis: string;
      entry: number;
      stop: number;
      target: number;
      size: number;
      riskPercent: number;
      balance: number;
    }) =>
      ipcRenderer.invoke('wallet:paperTrade', trade) as Promise<{ ok?: boolean; tradeId?: string; position?: unknown; error?: string }>,
    paperState: (lastPriceByTicker?: Record<string, number>) =>
      ipcRenderer.invoke('wallet:paperState', lastPriceByTicker) as Promise<{ state?: unknown; error?: string }>,
    paperClose: (params: { id: string; exitPrice: number; reason?: 'manual' | 'stop' | 'target' }) =>
      ipcRenderer.invoke('wallet:paperClose', params) as Promise<{ ok?: boolean; trade?: unknown; error?: string }>,
    paperReset: (newBalance?: number) =>
      ipcRenderer.invoke('wallet:paperReset', newBalance) as Promise<{ ok?: boolean; balance?: number; error?: string }>,
  },

  // Live Trade Advisor (Tradovate bridge + advice engine)
  trading: {
    tradovateConnect: (creds: {
      username: string;
      password: string;
      accountMode: 'simulation' | 'live';
      cid?: number;
      sec?: string;
    }) =>
      ipcRenderer.invoke('trading:tradovateConnect', creds) as Promise<{ ok?: boolean; error?: string }>,
    trialStatus: () =>
      ipcRenderer.invoke('trading:trialStatus') as Promise<{
        active: boolean;
        daysRemaining: number;
        endsAt: string;
      }>,
    tradovateStatus: () =>
      ipcRenderer.invoke('trading:tradovateStatus') as Promise<{
        connected: boolean;
        accountMode: 'simulation' | 'live' | 'unknown';
        symbol?: string;
        error?: string;
      }>,
    tradovateSnapshot: (symbol: string) =>
      ipcRenderer.invoke('trading:tradovateSnapshot', symbol) as Promise<{ snapshot?: unknown }>,
    marketState: () =>
      ipcRenderer.invoke('trading:marketState') as Promise<{ marketState?: unknown }>,
    tradovateDisconnect: () =>
      ipcRenderer.invoke('trading:tradovateDisconnect') as Promise<{ ok?: boolean }>,
    tastytradeConnect: (creds: { username: string; password: string }) =>
      ipcRenderer.invoke('trading:tastytradeConnect', creds) as Promise<{ ok?: boolean; deviceChallenge?: boolean; challengeType?: string; error?: string }>,
    tastytradeVerifyDevice: (otp: string) =>
      ipcRenderer.invoke('trading:tastytradeVerifyDevice', otp) as Promise<{ ok?: boolean; error?: string }>,
    tastytradeResendChallenge: () =>
      ipcRenderer.invoke('trading:tastytradeResendChallenge') as Promise<{ ok?: boolean; sent?: boolean; error?: string }>,
    tastytradeDisconnect: () =>
      ipcRenderer.invoke('trading:tastytradeDisconnect') as Promise<{ ok?: boolean }>,
    tastytradeStatus: () =>
      ipcRenderer.invoke('trading:tastytradeStatus') as Promise<{ connected: boolean; authState?: string; symbol?: string | null }>,
    tradovateAccountState: () =>
      ipcRenderer.invoke('trading:tradovateAccountState') as Promise<{ state?: unknown }>,
    buildTradeLevels: (symbol: string) =>
      ipcRenderer.invoke('trading:buildTradeLevels', symbol) as Promise<{ setup?: unknown; snapshot?: unknown }>,
    buildAdvice: (input: {
      snapshot: unknown;
      balance: number;
      riskPercent: number;
      symbol: string;
      side: 'long' | 'short';
      thesis?: string;
      entry?: number;
      stop?: number;
      target?: number;
    }) =>
      ipcRenderer.invoke('trading:buildAdvice', input) as Promise<{ result?: unknown }>,
    // Shadow Trading
    shadowState: () =>
      ipcRenderer.invoke('trading:shadowState') as Promise<unknown>,
    shadowEnable: () =>
      ipcRenderer.invoke('trading:shadowEnable') as Promise<{ ok?: boolean }>,
    shadowDisable: () =>
      ipcRenderer.invoke('trading:shadowDisable') as Promise<{ ok?: boolean }>,
    shadowPause: () =>
      ipcRenderer.invoke('trading:shadowPause') as Promise<{ ok?: boolean }>,
    shadowResume: () =>
      ipcRenderer.invoke('trading:shadowResume') as Promise<{ ok?: boolean }>,
    shadowReset: (newBalance?: number) =>
      ipcRenderer.invoke('trading:shadowReset', newBalance) as Promise<{ ok?: boolean }>,
    shadowFlatten: () =>
      ipcRenderer.invoke('trading:shadowFlatten') as Promise<{ ok?: boolean }>,
    shadowUpdateSettings: (settings: unknown) =>
      ipcRenderer.invoke('trading:shadowUpdateSettings', settings) as Promise<{ ok?: boolean }>,
    shadowSetSymbol: (symbol: string) =>
      ipcRenderer.invoke('trading:shadowSetSymbol', symbol) as Promise<{ ok?: boolean }>,
    // Phase 3: Shadow Analytics
    shadowAnalyticsSummary: () =>
      ipcRenderer.invoke('trading:shadowAnalyticsSummary') as Promise<{ summary?: unknown; error?: string }>,
    shadowAnalyticsEvents: (opts?: { stage?: string; symbol?: string; limit?: number; since?: number }) =>
      ipcRenderer.invoke('trading:shadowAnalyticsEvents', opts) as Promise<{ events?: unknown[]; error?: string }>,
    shadowAnalyticsFunnel: (hoursBack?: number) =>
      ipcRenderer.invoke('trading:shadowAnalyticsFunnel', hoursBack) as Promise<{ funnel?: unknown; error?: string }>,
    shadowAnalyticsCouncil: () =>
      ipcRenderer.invoke('trading:shadowAnalyticsCouncil') as Promise<{ council?: unknown; error?: string }>,
    shadowAnalyticsClear: () =>
      ipcRenderer.invoke('trading:shadowAnalyticsClear') as Promise<{ ok?: boolean; error?: string }>,
    // Phase 4: Strategy Refinement
    shadowRefinementSummary: () =>
      ipcRenderer.invoke('trading:shadowRefinementSummary') as Promise<{ summary?: unknown; error?: string }>,
    shadowStrategyConfigGet: () =>
      ipcRenderer.invoke('trading:shadowStrategyConfig:get') as Promise<{ config?: unknown; error?: string }>,
    shadowStrategyConfigSet: (cfg: unknown) =>
      ipcRenderer.invoke('trading:shadowStrategyConfig:set', cfg) as Promise<{ ok?: boolean; error?: string }>,
    // Phase 5: Strategy Readiness
    shadowReadinessReport: () =>
      ipcRenderer.invoke('trading:shadowReadinessReport') as Promise<{ report?: unknown; error?: string }>,
    // Phase 6: Promotion Workflow
    promotionStatus: () =>
      ipcRenderer.invoke('trading:promotionStatus') as Promise<{ status?: unknown; error?: string }>,
    promotionModeSet: (mode: string) =>
      ipcRenderer.invoke('trading:promotionMode:set', mode) as Promise<{ ok?: boolean; mode?: string; error?: string }>,
    promotionGuardrailsGet: () =>
      ipcRenderer.invoke('trading:promotionGuardrails:get') as Promise<{ guardrails?: unknown; error?: string }>,
    promotionGuardrailsSet: (guardrails: unknown) =>
      ipcRenderer.invoke('trading:promotionGuardrails:set', guardrails) as Promise<{ ok?: boolean; error?: string }>,
    confirmPendingTrade: () =>
      ipcRenderer.invoke('trading:confirmPendingTrade') as Promise<{ ok?: boolean; error?: string }>,
    rejectPendingTrade: () =>
      ipcRenderer.invoke('trading:rejectPendingTrade') as Promise<{ ok?: boolean; error?: string }>,

    // Phase 7: Trust Layer
    recentBlockedExplanations: (opts?: { limit?: number; since?: number }) =>
      ipcRenderer.invoke('trading:recentBlockedExplanations', opts) as Promise<{ explanations?: unknown[]; error?: string }>,
    gradeSummary: () =>
      ipcRenderer.invoke('trading:gradeSummary') as Promise<{ summary?: unknown[]; error?: string }>,
    councilValueAdded: () =>
      ipcRenderer.invoke('trading:councilValueAdded') as Promise<{ analysis?: unknown; error?: string }>,

    // Level-to-Level Simulator State
    levelMapGet: () =>
      ipcRenderer.invoke('trading:levelMap:get') as Promise<{ levelMap?: unknown; error?: string }>,
    watchesGet: () =>
      ipcRenderer.invoke('trading:watches:get') as Promise<{ watches?: unknown[]; error?: string }>,
    pathPredictionGet: () =>
      ipcRenderer.invoke('trading:pathPrediction:get') as Promise<{ prediction?: unknown; error?: string }>,
    pendingIntentsGet: () =>
      ipcRenderer.invoke('trading:pendingIntents:get') as Promise<{ intents?: unknown[]; error?: string }>,
    blockedEvaluationsGet: () =>
      ipcRenderer.invoke('trading:blockedEvaluations:get') as Promise<{ blocked?: unknown[]; error?: string }>,
    reviewedIntentsGet: () =>
      ipcRenderer.invoke('trading:reviewedIntents:get') as Promise<{ reviewed?: unknown[]; error?: string }>,
    sessionContextGet: () =>
      ipcRenderer.invoke('trading:sessionContext:get') as Promise<{ session?: unknown; error?: string }>,
    positionBookGet: () =>
      ipcRenderer.invoke('trading:positionBook:get') as Promise<{ open?: unknown[]; closed?: unknown[]; orders?: unknown[]; error?: string }>,
    simulatorStateGet: () =>
      ipcRenderer.invoke('trading:simulatorState:get') as Promise<{ state?: unknown; error?: string }>,
    journalEntriesGet: (opts?: { symbol?: string; since?: number; limit?: number; outcome?: string }) =>
      ipcRenderer.invoke('trading:journal:entries', opts) as Promise<{ entries?: unknown[]; error?: string }>,
    journalExpectancyGet: (dimension?: string) =>
      ipcRenderer.invoke('trading:journal:expectancy', dimension) as Promise<{ summary?: unknown; error?: string }>,
    journalWeightsGet: () =>
      ipcRenderer.invoke('trading:journal:weights') as Promise<{ suggestions?: unknown[]; error?: string }>,
    journalAdvisoryTargetsGet: (dimension?: string) =>
      ipcRenderer.invoke('trading:journal:advisoryTargets', dimension) as Promise<{ summary?: unknown; error?: string }>,
    reliabilitySetupTrust: () =>
      ipcRenderer.invoke('trading:reliability:setupTrust') as Promise<{ records?: unknown[]; error?: string }>,

    // Real-time copy-trade signal listener
    onShadowTradeAlert: (cb: (alert: unknown) => void): (() => void) => {
      const handler = (_: unknown, alert: unknown) => cb(alert);
      ipcRenderer.on('shadow:tradeAlert', handler);
      return () => { ipcRenderer.removeListener('shadow:tradeAlert', handler); };
    },
  },

  // Scheduler (recurring + once jobs)
  scheduler: {
    addJob: (taskGoal: string, category: string, cronExpr: string, label?: string) =>
      ipcRenderer.invoke('scheduler:addJob', taskGoal, category, cronExpr, label) as Promise<{ job?: unknown; error?: string }>,
    addOnceJob: (taskGoal: string, category: string, runAt: number) =>
      ipcRenderer.invoke('scheduler:addOnceJob', taskGoal, category, runAt) as Promise<{ job?: unknown; error?: string }>,
    cancelJob: (jobId: string) =>
      ipcRenderer.invoke('scheduler:cancelJob', jobId) as Promise<{ ok?: boolean; error?: string }>,
    listJobs: () =>
      ipcRenderer.invoke('scheduler:listJobs') as Promise<{ jobs?: unknown[]; error?: string }>,
  },

  // Audit ledger (JSONL append-only log)
  audit: {
    getRecent: (n?: number) =>
      ipcRenderer.invoke('audit:getRecent', n) as Promise<{ entries?: unknown[]; error?: string }>,
    tailSince: (ts: number) =>
      ipcRenderer.invoke('audit:tailSince', ts) as Promise<{ entries?: unknown[]; error?: string }>,
    export: (fromTs: number, toTs: number, format: 'json' | 'csv' | 'text', filter?: string) =>
      ipcRenderer.invoke('audit:export', fromTs, toTs, format, filter) as Promise<{ ok: boolean; text?: string; entryCount?: number; error?: string }>,
    exportPolicyHistory: (fromTs: number, toTs: number) =>
      ipcRenderer.invoke('audit:exportPolicyHistory', fromTs, toTs) as Promise<{ ok: boolean; text?: string; error?: string }>,
  },

  // Agent engine — health + event ring buffer (Phase 3.5)
  agentEngine: {
    getHealth: () =>
      ipcRenderer.invoke('engine:getHealth') as Promise<{
        runningTasks?: number;
        queuedTasks?: number;
        pendingApprovals?: number;
        lastEventId?: string | null;
        paperTradingOnly?: boolean;
        error?: string;
      }>,
    subscribeEvents: (sinceId?: string) =>
      ipcRenderer.invoke('engine:subscribeEvents', sinceId) as Promise<{ events?: unknown[]; lastId?: string | null; error?: string }>,
  },

  // Approval management (Phase 3.5)
  approvals: {
    list: () =>
      ipcRenderer.invoke('approvals:list') as Promise<{ requests?: unknown[]; error?: string }>,
    approve: (approvalId: string) =>
      ipcRenderer.invoke('approvals:approve', approvalId) as Promise<{
        success: boolean; error?: string; retryable?: boolean;
      }>,
    deny: (approvalId: string, reason?: string) =>
      ipcRenderer.invoke('approvals:deny', approvalId, reason) as Promise<{
        success: boolean; error?: string; retryable?: boolean;
      }>,
  },

  // Income Operator approval creation (Phase 4B)
  // list/approve/deny reuse window.triforge.approvals — income tools filter client-side
  incomeApprovals: {
    create: (
      experimentId: string,
      action: string,
      args: Record<string, unknown>,
      riskLevel: 'low' | 'medium' | 'high',
    ) =>
      ipcRenderer.invoke('approval:income:create', experimentId, action, args, riskLevel) as Promise<{
        success: boolean; data?: { approvalId: string }; error?: string; retryable?: boolean;
      }>,
  },

  // Task pause / resume (Phase 3.5)
  agentTask: {
    pause: (taskId: string) =>
      ipcRenderer.invoke('task:pause', taskId) as Promise<{ ok?: boolean; error?: string }>,
    resume: (taskId: string) =>
      ipcRenderer.invoke('task:resume', taskId) as Promise<{ ok?: boolean; error?: string }>,
  },

  // Desktop OS controls (screen capture, clipboard, process list)
  desktop: {
    listWindows:    () =>
      ipcRenderer.invoke('desktop:listWindows') as Promise<{ windows?: Array<{ id: string; name: string; appName: string }>; error?: string }>,
    captureScreen:  (sourceId?: string) =>
      ipcRenderer.invoke('desktop:captureScreen', sourceId) as Promise<{ base64?: string; name?: string; error?: string }>,
    clipboardRead:  () =>
      ipcRenderer.invoke('desktop:clipboardRead') as Promise<string>,
    clipboardWrite: (text: string) =>
      ipcRenderer.invoke('desktop:clipboardWrite', text) as Promise<void>,
    listProcesses:  () =>
      ipcRenderer.invoke('desktop:listProcesses') as Promise<{ processes?: Array<{ name: string; pid: string }>; error?: string }>,
  },

  // OS Sensors (reactive background monitors)
  sensors: {
    list:  () =>
      ipcRenderer.invoke('sensors:list') as Promise<Array<{ name: string; running: boolean; permissionKey: string }>>,
    start: (name: string, config?: Record<string, unknown>) =>
      ipcRenderer.invoke('sensors:start', name, config) as Promise<{ ok?: boolean; error?: string }>,
    stop:  (name: string) =>
      ipcRenderer.invoke('sensors:stop', name) as Promise<{ ok?: boolean; error?: string }>,
  },

  // Autonomy Engine — workflow registry + trigger pipeline
  autonomy: {
    status: () =>
      ipcRenderer.invoke('autonomy:status') as Promise<{ running: boolean; workflowCount: number }>,
    listWorkflows: () =>
      ipcRenderer.invoke('autonomy:listWorkflows') as Promise<Array<{
        id: string; name: string; description: string; enabled: boolean;
        triggers: Array<{ eventType: string; filter?: Record<string, unknown> }>;
        actions: Array<{ type: string; params: Record<string, unknown>; requiresApproval?: boolean }>;
        cooldownMs?: number; lastFiredAt?: number; createdAt: number;
      }>>,
    registerWorkflow: (wf: {
      id: string; name: string; description: string; enabled: boolean;
      triggers: Array<{ eventType: string; filter?: Record<string, unknown> }>;
      actions: Array<{ type: string; params: Record<string, unknown>; requiresApproval?: boolean }>;
      cooldownMs?: number; createdAt: number;
    }) => ipcRenderer.invoke('autonomy:registerWorkflow', wf) as Promise<{ ok?: boolean; workflow?: unknown; error?: string }>,
    updateWorkflow: (id: string, patch: Record<string, unknown>) =>
      ipcRenderer.invoke('autonomy:updateWorkflow', id, patch) as Promise<{ ok?: boolean; workflow?: unknown; error?: string }>,
    deleteWorkflow: (id: string) =>
      ipcRenderer.invoke('autonomy:deleteWorkflow', id) as Promise<{ ok?: boolean; error?: string }>,
  },

  // System
  system: {
    openExternal: (url: string) => ipcRenderer.invoke('system:openExternal', url),
    platform: process.platform,
    health: () => ipcRenderer.invoke('system:health') as Promise<{
      wakeMode: string;
      autonomyLoop: boolean;
      commandSystem: boolean;
      missionController: boolean;
      ts: number;
    }>,
  },

  // License & subscription
  license: {
    load:        () => ipcRenderer.invoke('license:load') as Promise<{ tier: string; valid: boolean; key: string | null; email: string | null; expiresAt: string | null; error: string | null }>,
    activate:    (key: string) => ipcRenderer.invoke('license:activate', key) as Promise<{ tier: string; valid: boolean; key: string | null; email: string | null; error: string | null }>,
    deactivate:  () => ipcRenderer.invoke('license:deactivate') as Promise<void>,
    tiers:       () => ipcRenderer.invoke('license:tiers') as Promise<unknown>,
    checkoutUrls:() => ipcRenderer.invoke('license:checkoutUrls') as Promise<{ pro: string; annual: string; portal: string }>,
    /** Fires when the app is reopened via triforge://activate deep link after checkout */
    onActivateDeepLink: (cb: () => void): (() => void) => {
      const handler = () => cb();
      ipcRenderer.on('deep-link:activate', handler);
      return () => ipcRenderer.removeListener('deep-link:activate', handler);
    },
  },

  // Usage stats
  usage: {
    get: () => ipcRenderer.invoke('usage:get') as Promise<{ messagesThisMonth: number }>,
  },

  // Session auth (PIN lock)
  auth: {
    status:  () => ipcRenderer.invoke('auth:status') as Promise<{ hasPin: boolean; username: string | null }>,
    setup:   (username: string, pin: string) => ipcRenderer.invoke('auth:setup', username, pin) as Promise<{ ok: boolean; error?: string }>,
    verify:  (username: string, pin: string) => ipcRenderer.invoke('auth:verify', username, pin) as Promise<{ valid: boolean }>,
    clear:   () => ipcRenderer.invoke('auth:clear') as Promise<{ ok: boolean }>,
  },

  // File system
  files: {
    commonDirs:    () => ipcRenderer.invoke('files:commonDirs') as Promise<Record<string, string>>,
    listDir:       (dirPath: string) => ipcRenderer.invoke('files:listDir', dirPath) as Promise<{ files: Array<{ name: string; path: string; size: number; modified: string; extension: string }>; subdirs: string[]; error?: string }>,
    scanPhotos:    (startPath?: string) => ipcRenderer.invoke('files:scanPhotos', startPath) as Promise<{ photos: Array<{ name: string; path: string; size: number; modified: string; extension: string }>; error?: string }>,
    searchPhotos:  (query: string, startPath?: string) => ipcRenderer.invoke('files:searchPhotos', query, startPath) as Promise<{ photos: Array<{ name: string; path: string; size: number; modified: string; extension: string }>; error?: string }>,
    findSimilar:   (refPath: string, startPath?: string) => ipcRenderer.invoke('files:findSimilar', refPath, startPath) as Promise<{ photos: Array<{ name: string; path: string; size: number; modified: string; extension: string }>; error?: string }>,
    organize:      (dirPath: string) => ipcRenderer.invoke('files:organize', dirPath) as Promise<{ moved: number; folders: string[]; errors: string[] }>,
    organizeDeep:  (dirPath: string) => ipcRenderer.invoke('files:organizeDeep', dirPath) as Promise<{ moved: number; folders: string[]; errors: string[]; directoriesScanned: number }>,
    moveFiles:     (srcPaths: string[], destDir: string) => ipcRenderer.invoke('files:moveFiles', srcPaths, destDir) as Promise<{ moved: number; errors: string[] }>,
    openFile:      (filePath: string) => ipcRenderer.invoke('files:openFile', filePath),
    showInFolder:  (filePath: string) => ipcRenderer.invoke('files:showInFolder', filePath),
    pickFile:      (filters?: Array<{ name: string; extensions: string[] }>) => ipcRenderer.invoke('files:pickFile', filters) as Promise<string | null>,
    pickDir:       () => ipcRenderer.invoke('files:pickDir') as Promise<string | null>,
    readFile:      (filePath: string) => ipcRenderer.invoke('files:readFile', filePath) as Promise<{ content?: string; truncated?: boolean; size?: number; error?: string }>,
    writeFile:     (filePath: string, content: string) => ipcRenderer.invoke('files:writeFile', filePath, content) as Promise<{ ok?: boolean; error?: string }>,
  },

  // Document Indexer — local OCR-powered document finder
  docs: {
    getIndex: () => ipcRenderer.invoke('docs:getIndex') as Promise<{
      docs: Array<{ path: string; name: string; size: number; modified: string; extension: string; ocrText: string; docTypes: Array<{ type: string; confidence: number }>; indexedAt: string }>;
      error?: string;
    }>,
    index: (startPath?: string) => ipcRenderer.invoke('docs:index', startPath) as Promise<{
      docs: Array<{ path: string; name: string; size: number; modified: string; extension: string; ocrText: string; docTypes: Array<{ type: string; confidence: number }>; indexedAt: string }>;
      error?: string;
    }>,
    search: (query: string) => ipcRenderer.invoke('docs:search', query) as Promise<{
      results: Array<{ path: string; name: string; size: number; modified: string; extension: string; ocrText: string; docTypes: Array<{ type: string; confidence: number }>; indexedAt: string; matchScore: number }>;
      needsIndex?: boolean;
      error?: string;
    }>,
    onProgress: (cb: (data: { phase: string; current?: number; total?: number; name?: string; existing?: number }) => void): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, data: { phase: string; current?: number; total?: number; name?: string; existing?: number }) => cb(data);
      ipcRenderer.on('docs:progress', handler);
      return () => ipcRenderer.removeListener('docs:progress', handler);
    },
  },

  // Phone Link — remote Council access from any device on the local network (port 4587)
  phoneLink: {
    start:  () => ipcRenderer.invoke('phoneLink:start')  as Promise<{ ok?: boolean; url?: string; pairUrl?: string; pairToken?: string; qrData?: string; error?: string }>,
    stop:   () => ipcRenderer.invoke('phoneLink:stop')   as Promise<{ ok?: boolean; error?: string }>,
    status: () => ipcRenderer.invoke('phoneLink:status') as Promise<{ running: boolean; port: number; url: string; pairedDevices?: number }>,
    pair:   () => ipcRenderer.invoke('phoneLink:pair')   as Promise<{ pairUrl?: string; pairToken?: string; qrData?: string; error?: string }>,
  },

  // Forge Chamber — real-time consensus telemetry
  forge: {
    onUpdate: (cb: (data: { phase: string; provider?: string; token?: string; thinkingText?: string; completedCount?: number; total?: number; from?: string; to?: string; reason?: string }) => void): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, data: { phase: string; provider?: string; token?: string; thinkingText?: string; completedCount?: number; total?: number; from?: string; to?: string; reason?: string }) => cb(data);
      ipcRenderer.on('forge:update', handler);
      return () => ipcRenderer.removeListener('forge:update', handler);
    },
    onDraft: (cb: (data: { provider: string; text: string }) => void): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, data: { provider: string; text: string }) => cb(data);
      ipcRenderer.on('council:draft', handler);
      return () => ipcRenderer.removeListener('council:draft', handler);
    },
    onCouncilUpdate: (cb: (data: { text: string }) => void): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, data: { text: string }) => cb(data);
      ipcRenderer.on('council:update', handler);
      return () => ipcRenderer.removeListener('council:update', handler);
    },
    onSuggestion: (cb: (data: { text: string }) => void): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, data: { text: string }) => cb(data);
      ipcRenderer.on('council:suggestion', handler);
      return () => ipcRenderer.removeListener('council:suggestion', handler);
    },
    onPlan: (cb: (data: { plan: unknown }) => void): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, data: { plan: unknown }) => cb(data);
      ipcRenderer.on('council:plan', handler);
      return () => ipcRenderer.removeListener('council:plan', handler);
    },
    /** Operator task suggestion — emitted when the user's message is a task to execute in an app */
    onOperatorSuggestion: (cb: (data: { goal: string; targetApp: string | null; suggestedPackId: string | null; confidence: string }) => void): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, data: { goal: string; targetApp: string | null; suggestedPackId: string | null; confidence: string }) => cb(data);
      ipcRenderer.on('forge:operator-suggestion', handler);
      return () => ipcRenderer.removeListener('forge:operator-suggestion', handler);
    },
    /** Ambient insight from InsightEngine (type, message, confidence). */
    onInsight: (cb: (data: { type: string; message: string; confidence: number }) => void): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, data: { type: string; message: string; confidence: number }) => cb(data);
      ipcRenderer.on('council:insight', handler);
      return () => ipcRenderer.removeListener('council:insight', handler);
    },
    /** Streamed insight fields from InsightRouter (type, message, confidence, seq). */
    onInsightStream: (cb: (data: { type: string; message: string; confidence: number; seq: number }) => void): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, data: { type: string; message: string; confidence: number; seq: number }) => cb(data);
      ipcRenderer.on('insight:stream', handler);
      return () => ipcRenderer.removeListener('insight:stream', handler);
    },
    /** Council demo sequence events (phase: demo:thinking | demo:challenge | demo:synthesis | demo:consensus | demo:end). */
    onDemo: (cb: (data: { phase: string }) => void): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, data: { phase: string }) => cb(data);
      ipcRenderer.on('council:demo', handler);
      return () => ipcRenderer.removeListener('council:demo', handler);
    },
    /** Partial reasoning broadcast from DebateStreamCoordinator. */
    onPartialReasoning: (cb: (data: { provider: string; reasoning: string }) => void): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, data: { provider: string; reasoning: string }) => cb(data);
      ipcRenderer.on('council:partial-reasoning', handler);
      return () => ipcRenderer.removeListener('council:partial-reasoning', handler);
    },
  },

  // Auto-updater
  updater: {
    check:   () => ipcRenderer.invoke('updater:check') as Promise<void>,
    install: () => ipcRenderer.send('updater:install'),
    onStatus: (cb: (s: { state: string; version?: string; percent?: number; message?: string }) => void): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, s: { state: string; version?: string; percent?: number; message?: string }) => cb(s);
      ipcRenderer.on('updater:status', handler);
      return () => ipcRenderer.removeListener('updater:status', handler);
    },
  },

  // Printer
  print: {
    list:  () => ipcRenderer.invoke('print:list') as Promise<{ printers: Array<{ name: string; isDefault: boolean; status: string }>; error?: string }>,
    file:  (filePath: string, printerName?: string) => ipcRenderer.invoke('print:file', filePath, printerName) as Promise<{ ok: boolean; error?: string }>,
    text:  (content: string, printerName?: string) => ipcRenderer.invoke('print:text', content, printerName) as Promise<{ ok: boolean; error?: string }>,
  },

  // Phase 4: Credentials (SMTP, Twitter, etc.) — only masked status returned, never plaintext
  credentials: {
    set:    (key: string, value: string) =>
      ipcRenderer.invoke('credentials:set', key, value) as Promise<{ ok?: boolean; error?: string }>,
    get:    (key: string) =>
      ipcRenderer.invoke('credentials:get', key) as Promise<{ set?: boolean; masked?: string; error?: string }>,
    delete: (key: string) =>
      ipcRenderer.invoke('credentials:delete', key) as Promise<{ ok?: boolean; error?: string }>,
    list:   () =>
      ipcRenderer.invoke('credentials:list') as Promise<{ keys?: string[]; error?: string }>,
  },

  // Phase 4: Execution results (read-only analytics)
  results: {
    list: (taskId?: string) =>
      ipcRenderer.invoke('results:list', taskId) as Promise<{
        results?: Array<{
          id: string; taskId: string; stepId: string; tool: string;
          timestamp: number; success: boolean; paperMode: boolean;
          data: unknown; metrics?: { emailsSent?: number; tweetId?: string; successRate?: number; charCount?: number };
        }>;
        error?: string;
      }>,
    getMetrics: (taskId?: string) =>
      ipcRenderer.invoke('results:getMetrics', taskId) as Promise<{
        metrics?: {
          total: number; successful: number; failed: number; paperMode: number;
          byTool: Record<string, { total: number; success: number }>;
        };
        error?: string;
      }>,
  },

  // Phase 4: Service integration status (mail, twitter, etc.)
  hustle: {
    getServiceStatus: () =>
      ipcRenderer.invoke('hustle:getServiceStatus') as Promise<{
        mail?: boolean; twitter?: boolean; notify?: boolean; storage?: boolean; error?: string;
      }>,
  },

  // Phase 5: Value Engine — campaigns, metrics, optimization
  value: {
    listCampaigns: () =>
      ipcRenderer.invoke('value:listCampaigns') as Promise<{
        campaigns?: Array<{
          id: string; name: string; type: string; status: string;
          createdAt: number; updatedAt: number; taskIds: string[];
          description?: string;
          goalMetrics?: { targetEmailsSent?: number; targetReplies?: number; targetLeads?: number; targetValueCents?: number };
        }>;
        error?: string;
      }>,
    createCampaign: (name: string, type: string, description?: string) =>
      ipcRenderer.invoke('value:createCampaign', name, type, description) as Promise<{
        campaign?: {
          id: string; name: string; type: string; status: string;
          createdAt: number; updatedAt: number; taskIds: string[];
        };
        error?: string;
      }>,
    linkTask: (campaignId: string, taskId: string) =>
      ipcRenderer.invoke('value:linkTask', campaignId, taskId) as Promise<{ ok?: boolean; error?: string }>,
    getCampaignMetrics: (campaignId: string) =>
      ipcRenderer.invoke('value:getCampaignMetrics', campaignId) as Promise<{
        metrics?: {
          campaignId: string; emailsSent: number; emailsFailed: number;
          repliesReceived: number; postsPublished: number; leadsGenerated: number;
          spendCents: number; valueRecordedCents: number;
          roi: number | null; replyRate: number | null; successRate: number | null;
          lastUpdatedAt: number;
        };
        error?: string;
      }>,
    getGlobalMetrics: () =>
      ipcRenderer.invoke('value:getGlobalMetrics') as Promise<{
        metrics?: {
          campaignId: string; emailsSent: number; emailsFailed: number;
          repliesReceived: number; postsPublished: number; leadsGenerated: number;
          spendCents: number; valueRecordedCents: number;
          roi: number | null; replyRate: number | null; successRate: number | null;
          lastUpdatedAt: number;
        };
        error?: string;
      }>,
    getOptimization: (campaignId: string) =>
      ipcRenderer.invoke('value:getOptimization', campaignId) as Promise<{
        result?: {
          campaignId: string; suggestedActions: string[]; priority: string;
          reasoning: string; generatedAt: number;
        };
        error?: string;
      }>,
    recordValue: (taskId: string, amountCents: number, note?: string, campaignId?: string) =>
      ipcRenderer.invoke('value:recordValue', taskId, amountCents, note, campaignId) as Promise<{ ok?: boolean; error?: string }>,
    recordReply: (taskId: string, from: string, sentiment: string, campaignId?: string) =>
      ipcRenderer.invoke('value:recordReply', taskId, from, sentiment, campaignId) as Promise<{ ok?: boolean; error?: string }>,
  },

  // Phase 6: Growth Engine — loops + leads
  growth: {
    listLoops: () =>
      ipcRenderer.invoke('growth:listLoops') as Promise<{
        loops?: Array<{
          id: string; type: string; goal: string; status: string;
          campaignId?: string; createdAt: number; updatedAt: number;
          lastRunAt?: number; nextRunAt?: number; runCount: number;
          improvementNotes?: string;
          config: {
            dailyEmailLimit?: number; dailyPostLimit?: number;
            targetAudience?: string; keywords?: string[];
            emailList?: Array<{ email: string; name?: string; interest?: string }>;
          };
        }>;
        error?: string;
      }>,
    createLoop: (
      goal: string, type: string,
      config: { dailyEmailLimit?: number; dailyPostLimit?: number; targetAudience?: string; keywords?: string[]; emailList?: Array<{ email: string; name?: string; interest?: string }> },
      campaignId?: string,
    ) => ipcRenderer.invoke('growth:createLoop', goal, type, config, campaignId) as Promise<{
      loop?: { id: string; type: string; goal: string; status: string; createdAt: number };
      error?: string;
    }>,
    pauseLoop:  (loopId: string) => ipcRenderer.invoke('growth:pauseLoop',  loopId) as Promise<{ ok?: boolean; error?: string }>,
    resumeLoop: (loopId: string) => ipcRenderer.invoke('growth:resumeLoop', loopId) as Promise<{ ok?: boolean; error?: string }>,
    deleteLoop: (loopId: string) => ipcRenderer.invoke('growth:deleteLoop', loopId) as Promise<{ ok?: boolean; error?: string }>,
    runNow:     (loopId: string) => ipcRenderer.invoke('growth:runNow',     loopId) as Promise<{ ok?: boolean; started?: boolean; error?: string }>,
    getLoopMetrics: (loopId: string) =>
      ipcRenderer.invoke('growth:getLoopMetrics', loopId) as Promise<{
        metrics?: { loopId: string; emailsSent: number; postsPublished: number; leadsTotal: number; leadsReplied: number; leadsConverted: number; conversionRate: number | null; replyRate: number | null; lastRunAt: number | null; nextRunAt: number | null };
        error?: string;
      }>,
    getGlobalMetrics: () =>
      ipcRenderer.invoke('growth:getGlobalMetrics') as Promise<{
        metrics?: { totalLeads: number; totalEmailsSent: number; totalPostsPublished: number; totalConverted: number; activeLoops: number };
        error?: string;
      }>,
    listLeads: (loopId?: string) =>
      ipcRenderer.invoke('growth:listLeads', loopId) as Promise<{
        leads?: Array<{ id: string; source: string; contact: string; name?: string; status: string; notes?: string; loopId?: string; createdAt: number; updatedAt: number }>;
        error?: string;
      }>,
    addLead: (contact: string, name?: string, loopId?: string, campaignId?: string) =>
      ipcRenderer.invoke('growth:addLead', contact, name, loopId, campaignId) as Promise<{
        lead?: { id: string; contact: string; status: string; createdAt: number };
        error?: string;
      }>,
    updateLead: (leadId: string, patch: { status?: string; notes?: string }) =>
      ipcRenderer.invoke('growth:updateLead', leadId, patch) as Promise<{ ok?: boolean; error?: string }>,
  },

  // IT Tool Pack (diagnostics, network doctor, event logs, services, processes, scripts, patches)
  it: {
    getDiagnostics: () =>
      ipcRenderer.invoke('it:getDiagnostics') as Promise<{
        hostname?: string; platform?: string; osRelease?: string; arch?: string; uptimeHours?: number;
        cpu?: { model: string; cores: number; loadAvg1m: number; usagePercent: number };
        memory?: { totalGB: number; freeGB: number; usedPercent: number };
        disks?: Array<{ mount: string; totalGB: number; freeGB: number; usedPercent: number }>;
        networkAdapters?: Array<{ name: string; address: string; mac: string }>;
        capturedAt?: number; error?: string;
      }>,
    networkDoctor: (testHosts?: string) =>
      ipcRenderer.invoke('it:networkDoctor', testHosts) as Promise<{
        online?: boolean; gateway?: string; dnsServers?: string[];
        adapters?: Array<{ name: string; address: string; mac: string }>;
        tests?: Array<{ host: string; resolved?: string; latencyMs?: number; reachable: boolean; error?: string }>;
        routeHints?: string[]; capturedAt?: number; error?: string;
      }>,
    getEventLogs: (opts?: { logName?: string; maxItems?: number; minutesBack?: number; levelFilter?: string }) =>
      ipcRenderer.invoke('it:getEventLogs', opts) as Promise<{
        entries?: Array<{ eventId: number; level: string; source: string; message: string; ts: number; logName: string }>;
        logName?: string; platform?: string; minutesBack?: number; capturedAt?: number; error?: string;
      }>,
    listServices: (filter?: string) =>
      ipcRenderer.invoke('it:listServices', filter) as Promise<{
        action?: string;
        services?: Array<{ name: string; displayName: string; status: string; startType?: string }>;
        ok?: boolean; error?: string; capturedAt?: number;
      }>,
    restartService: (serviceName: string) =>
      ipcRenderer.invoke('it:restartService', serviceName) as Promise<{ ok?: boolean; status?: string; error?: string; capturedAt?: number }>,
    listProcesses: (topN?: number, sortBy?: string) =>
      ipcRenderer.invoke('it:listProcesses', topN, sortBy) as Promise<{
        processes?: Array<{ pid: number; name: string; cpu?: number; memMB?: number }>;
        ok?: boolean; error?: string; capturedAt?: number;
      }>,
    killProcess: (target: string) =>
      ipcRenderer.invoke('it:killProcess', target) as Promise<{ ok?: boolean; killed?: string; error?: string; capturedAt?: number }>,
    listScripts: () =>
      ipcRenderer.invoke('it:listScripts') as Promise<{
        scripts?: Array<{ id: string; name: string; description: string; riskNote: string }>;
        ok?: boolean; error?: string;
      }>,
    runScript: (scriptId: string) =>
      ipcRenderer.invoke('it:runScript', scriptId) as Promise<{ ok?: boolean; output?: string; error?: string; capturedAt?: number }>,
    checkPatches: (scope?: string) =>
      ipcRenderer.invoke('it:checkPatches', scope) as Promise<{
        pending?: Array<{ name: string; severity: string; category: string; description?: string }>;
        totalCount?: number; critical?: number; important?: number;
        recommendation?: string; platform?: string; capturedAt?: number; error?: string;
      }>,
  },


  // Browser Automation (Playwright headless)
  browser: {
    navigate:   (url: string) =>
      ipcRenderer.invoke('browser:navigate', url) as Promise<{ text?: string; title?: string; url?: string; error?: string }>,
    screenshot: (url: string) =>
      ipcRenderer.invoke('browser:screenshot', url) as Promise<{ base64?: string; width?: number; height?: number; error?: string }>,
    fillForm:   (url: string, fields: Record<string, string>, submitSelector?: string) =>
      ipcRenderer.invoke('browser:fillForm', url, fields, submitSelector) as Promise<{ ok?: boolean; message?: string; error?: string }>,
    scrape:     (url: string, selector: string, attrs?: string[]) =>
      ipcRenderer.invoke('browser:scrape', url, selector, attrs) as Promise<{ items?: Array<Record<string, string>>; error?: string }>,
    close:      () =>
      ipcRenderer.invoke('browser:close') as Promise<{ ok?: boolean; error?: string }>,
  },

  // Ad Campaign Generation (Council multi-model → drafts → phone approval → post)
  campaigns: {
    generateAds: (params: {
      goal: string;
      platform: string;
      count: number;
      targetAudience?: string;
      tone?: string;
      campaignId?: string;
      loopId?: string;
    }) => ipcRenderer.invoke('campaigns:generateAds', params) as Promise<{
      ok?: boolean;
      campaignId?: string;
      variants?: Array<{ contentId: string; actionId: string; text: string; platform: string; provider: string }>;
      pendingApprovalCount?: number;
      error?: string;
    }>,
  },

  // Social Media Posting (Twitter, LinkedIn, Reddit, Facebook)
  social: {
    post:  (platform: string, content: string, mediaBase64?: string) =>
      ipcRenderer.invoke('social:post', platform, content, mediaBase64) as Promise<{
        ok?: boolean; platform?: string; postId?: string; url?: string; error?: string;
      }>,
    draft: (platform: string, content: string) =>
      ipcRenderer.invoke('social:draft', platform, content) as Promise<{
        ok?: boolean; platform?: string; draft?: string; characterCount?: number; characterLimit?: number; error?: string;
      }>,

    /**
     * Return one row per OAuth-capable platform with whether the user has
     * tokens stored. Used by the Settings → Social Accounts panel.
     */
    getAccounts: () =>
      ipcRenderer.invoke('social:auth:status') as Promise<{
        ok: boolean;
        status?: Record<string, boolean>;
        error?: string;
      }>,

    /**
     * Start the OAuth flow for one platform. Caller must supply the
     * platform-specific app credentials (clientId/clientSecret or appId/appSecret).
     * Opens the system browser; resolves when the user finishes the redirect.
     */
    connect: (platform: string, credentials: Record<string, string>) =>
      ipcRenderer.invoke('social:auth:connect', platform, credentials) as Promise<{
        ok: boolean;
        error?: string;
      }>,

    /** Clear stored OAuth tokens for a platform. */
    disconnect: (platform: string) =>
      ipcRenderer.invoke('social:auth:disconnect', platform) as Promise<{
        ok: boolean;
        error?: string;
      }>,
  },

  // Phase 7: Compound Engine
  compound: {
    listStrategies: (type?: string) =>
      ipcRenderer.invoke('compound:listStrategies', type) as Promise<{
        strategies?: Array<{
          id: string; type: string; description: string;
          inputs: { subjectLine?: string; tone?: string; contentType?: string; keywords?: string[] };
          performance: { sent?: number; replies?: number; leads?: number; conversions?: number; replyRate?: number; conversionRate?: number };
          score: number; status: string;
          loopId?: string; createdAt: number; updatedAt: number;
        }>;
        error?: string;
      }>,
    getTopStrategies: (limit?: number) =>
      ipcRenderer.invoke('compound:getTopStrategies', limit) as Promise<{
        strategies?: Array<{
          id: string; type: string; description: string;
          inputs: { subjectLine?: string; tone?: string; contentType?: string; keywords?: string[] };
          performance: { sent?: number; replies?: number; leads?: number; conversions?: number; replyRate?: number; conversionRate?: number };
          score: number; status: string;
          loopId?: string; createdAt: number; updatedAt: number;
        }>;
        error?: string;
      }>,
    getStats: () =>
      ipcRenderer.invoke('compound:getStats') as Promise<{
        stats?: {
          totalStrategies: number; highPerformers: number; lowPerformers: number;
          testingStrategies: number; avgScore: number; lastOptimizedAt: number | null;
        };
        error?: string;
      }>,
    runOptimization: () =>
      ipcRenderer.invoke('compound:runOptimization') as Promise<{
        result?: { scaled: number; optimized: number };
        error?: string;
      }>,
  },

  // ── Profession Engine ──────────────────────────────────────────────────────
  profession: {
    list: () =>
      ipcRenderer.invoke('profession:list') as Promise<Array<{
        id: string; name: string; activeSensors: string[];
        approvalStrictness: string; behaviorModifiers: Record<string, unknown>;
      }>>,
    getActive: () =>
      ipcRenderer.invoke('profession:getActive') as Promise<{ id: string; name: string; approvalStrictness: string } | null>,
    activate: (profileId: string) =>
      ipcRenderer.invoke('profession:activate', profileId) as Promise<{ ok?: boolean; name?: string; error?: string }>,
    deactivate: () =>
      ipcRenderer.invoke('profession:deactivate') as Promise<{ ok?: boolean; error?: string }>,
    getStatus: () =>
      ipcRenderer.invoke('profession:getStatus') as Promise<{
        professionName: string | null;
        approvalStrictness: string | null;
        engineRunning: boolean;
        runningSensors: number;
        enabledWorkflows: number;
        pendingActionCount: number;
        lastFiredWorkflowName: string | null;
        lastFiredAt: number | null;
      }>,
  },

  // ── Pending Action Approvals (TASK 6) ──────────────────────────────────────
  pendingActions: {
    list: () =>
      ipcRenderer.invoke('autonomy:listPendingActions') as Promise<Array<{
        id: string; actionType: string; workflowId: string; workflowName: string; queuedAt: number;
      }>>,
    approve: (actionId: string) =>
      ipcRenderer.invoke('autonomy:executeApprovedAction', actionId) as Promise<{ ok: boolean; error?: string }>,
    discard: (actionId: string) =>
      ipcRenderer.invoke('autonomy:discardPendingAction', actionId) as Promise<{ ok: boolean }>,
    pendingCount: () =>
      ipcRenderer.invoke('autonomy:pendingCount') as Promise<{ count: number }>,
  },

  // ── Approval Server (remote/phone approvals on port 7337) ─────────────────────
  approvalServer: {
    start:  () => ipcRenderer.invoke('approvalServer:start')  as Promise<{ ok: boolean; url?: string; error?: string }>,
    stop:   () => ipcRenderer.invoke('approvalServer:stop')   as Promise<{ ok: boolean }>,
    status: () => ipcRenderer.invoke('approvalServer:status') as Promise<{ running: boolean; port: number; url: string }>,
  },

  // ── Council Mission Context + Mission Controller ──────────────────────────────
  mission: {
    // Council mission context (existing)
    getContext:    () =>
      ipcRenderer.invoke('mission:ctx:get') as Promise<{
        mission: string; objectives: string[]; decisions: string[];
        openQuestions: string[]; project?: string; updatedAt: number;
      } | null>,
    setContext:    (ctx: { mission: string; objectives: string[]; decisions: string[]; openQuestions: string[]; project?: string }) =>
      ipcRenderer.invoke('mission:ctx:set', ctx) as Promise<{ ok: boolean }>,
    updateContext: (patch: Partial<{ mission: string; objectives: string[]; decisions: string[]; openQuestions: string[]; project: string }>) =>
      ipcRenderer.invoke('mission:ctx:update', patch) as Promise<{ mission: string; updatedAt: number } | null>,
    clearContext:  () =>
      ipcRenderer.invoke('mission:ctx:clear') as Promise<{ ok: boolean }>,
    // MissionController (autonomous engineering loop)
    start:        (raw: string, intent: string, source: string) =>
      ipcRenderer.invoke('mission:start', raw, intent, source) as Promise<{ missionId?: string; error?: string }>,
    approvePlan:  (missionId: string, plan: unknown) =>
      ipcRenderer.invoke('mission:approve_plan', missionId, plan) as Promise<{ ok?: boolean; error?: string }>,
    approveStep:  (missionId: string, stepId: string, plan: unknown) =>
      ipcRenderer.invoke('mission:approve_step', missionId, stepId, plan) as Promise<{ ok?: boolean; error?: string }>,
    rollback:     (missionId: string) =>
      ipcRenderer.invoke('mission:rollback', missionId) as Promise<{ ok?: boolean; error?: string }>,
    onPlanReady:  (cb: (data: unknown) => void): (() => void) => {
      const h = (_: Electron.IpcRendererEvent, d: unknown) => cb(d);
      ipcRenderer.on('mission:plan_ready', h);
      return () => ipcRenderer.removeListener('mission:plan_ready', h);
    },
    onStepPreview: (cb: (data: unknown) => void): (() => void) => {
      const h = (_: Electron.IpcRendererEvent, d: unknown) => cb(d);
      ipcRenderer.on('mission:step_preview_ready', h);
      return () => ipcRenderer.removeListener('mission:step_preview_ready', h);
    },
    onComplete: (cb: (data: unknown) => void): (() => void) => {
      const h = (_: Electron.IpcRendererEvent, d: unknown) => cb(d);
      ipcRenderer.on('mission:complete', h);
      return () => ipcRenderer.removeListener('mission:complete', h);
    },
    onFailed: (cb: (data: unknown) => void): (() => void) => {
      const h = (_: Electron.IpcRendererEvent, d: unknown) => cb(d);
      ipcRenderer.on('mission:failed', h);
      return () => ipcRenderer.removeListener('mission:failed', h);
    },
  },

  // ── Council Memory Graph ───────────────────────────────────────────────────────
  memoryGraph: {
    add: (node: { id: string; type: 'decision'|'strategy'|'idea'|'insight'|'fact'; project: string; content: string; related: string[] }) =>
      ipcRenderer.invoke('memory:graph:add', node) as Promise<{ ok: boolean }>,
    search: (project: string) =>
      ipcRenderer.invoke('memory:graph:search', project) as Promise<Array<{ id: string; type: string; project: string; content: string; related: string[]; createdAt: number }>>,
    related: (nodeId: string) =>
      ipcRenderer.invoke('memory:graph:related', nodeId) as Promise<Array<{ id: string; type: string; project: string; content: string; related: string[]; createdAt: number }>>,
    all: () =>
      ipcRenderer.invoke('memory:graph:all') as Promise<Array<{ id: string; type: string; project: string; content: string; related: string[]; createdAt: number }>>,
  },

  // ── Local AI Providers (Ollama / LM Studio) ───────────────────────────────────
  localProvider: {
    test:    (baseUrl: string, model: string) =>
      ipcRenderer.invoke('local:provider:test', baseUrl, model) as Promise<{ ok: boolean; latencyMs?: number; error?: string }>,
    chat:    (baseUrl: string, model: string, messages: Array<{ role: string; content: string }>) =>
      ipcRenderer.invoke('local:provider:chat', baseUrl, model, messages) as Promise<{ text?: string; error?: string }>,
    models:  (baseUrl: string) =>
      ipcRenderer.invoke('local:provider:models', baseUrl) as Promise<{ models?: string[]; error?: string }>,
    // Phase 4 — persistent config + routing policy
    getConfig: () =>
      ipcRenderer.invoke('local:config:get') as Promise<{ enabled: boolean; baseUrl: string; model: string; fallback: boolean }>,
    setConfig: (baseUrl: string, model: string) =>
      ipcRenderer.invoke('local:config:set', baseUrl, model) as Promise<{ ok: boolean }>,
    enableRouting: () =>
      ipcRenderer.invoke('local:routing:enable') as Promise<{ ok: boolean }>,
    disableRouting: () =>
      ipcRenderer.invoke('local:routing:disable') as Promise<{ ok: boolean }>,
    setFallback: (v: boolean) =>
      ipcRenderer.invoke('local:routing:setFallback', v) as Promise<{ ok: boolean }>,
    skillAnalyze: (markdown: string) =>
      ipcRenderer.invoke('local:skillAnalyze', markdown) as Promise<{ ok: boolean; riskLevel?: string; findings?: string[]; summary?: string; error?: string }>,
  },

  // Command dispatch audit logging
  command: {
    /** Fire-and-forget command audit — logs source, matched command name, and raw text. */
    audit: (source: string, cmd: string, raw: string): void =>
      ipcRenderer.send('command:audit', source, cmd, raw),
  },

  // Blueprint System — profession/use-case configuration layer
  blueprint: {
    /** List all available blueprints (id, name, description, version). */
    list: () =>
      ipcRenderer.invoke('blueprint:list') as Promise<Array<{
        id: string; name: string; description: string; version: string;
      }>>,
    /** Returns the currently active blueprint summary, or null. */
    getActive: () =>
      ipcRenderer.invoke('blueprint:getActive') as Promise<{
        id: string; name: string; description: string; version: string;
      } | null>,
    /** Activates a blueprint by ID. Wires sensors, workflows, and mission templates. */
    setActive: (id: string) =>
      ipcRenderer.invoke('blueprint:setActive', id) as Promise<{ ok?: boolean; id?: string; name?: string; error?: string }>,
    /** Deactivates the current blueprint and resets to no active configuration. */
    deactivate: () =>
      ipcRenderer.invoke('blueprint:deactivate') as Promise<{ ok?: boolean; error?: string }>,
  },

  // Venture Discovery + Build — autonomous market research, opportunity scoring, and venture creation
  venture: {
    discover: (budget: number) =>
      ipcRenderer.invoke('venture:discover', budget) as Promise<{ proposal?: unknown; error?: string; tier?: string }>,
    respond: (id: string, action: string) =>
      ipcRenderer.invoke('venture:respond', id, action) as Promise<{ ok?: boolean; error?: string }>,
    build: (id: string) =>
      ipcRenderer.invoke('venture:build', id) as Promise<{ ok?: boolean; error?: string }>,
    launch: (id: string) =>
      ipcRenderer.invoke('venture:launch', id) as Promise<{ ok?: boolean; error?: string }>,
    filingRespond: (id: string, action: string) =>
      ipcRenderer.invoke('venture:filingRespond', id, action) as Promise<{ ok?: boolean; error?: string }>,
    list: () =>
      ipcRenderer.invoke('venture:list') as Promise<Array<Record<string, unknown>>>,
    get: (id: string) =>
      ipcRenderer.invoke('venture:get', id) as Promise<Record<string, unknown> | null>,
    dailyPulse: (id: string) =>
      ipcRenderer.invoke('venture:dailyPulse', id) as Promise<{ pulse?: unknown; error?: string }>,
    onProgress: (cb: (data: { phase: string; detail?: string }) => void): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, data: { phase: string; detail?: string }) => cb(data);
      ipcRenderer.on('venture:progress', handler);
      return () => ipcRenderer.removeListener('venture:progress', handler);
    },
    learningProfile: () =>
      ipcRenderer.invoke('venture:learningProfile') as Promise<Record<string, unknown> | null>,
    refreshTrends: () =>
      ipcRenderer.invoke('venture:refreshTrends') as Promise<{ ok?: boolean; error?: string }>,
  },

  // Expert Workforce — dynamic specialist roster under the Council
  experts: {
    roster: () =>
      ipcRenderer.invoke('experts:roster') as Promise<{ roster?: unknown[]; summary?: unknown; error?: string }>,
    health: () =>
      ipcRenderer.invoke('experts:health') as Promise<{ health?: unknown; error?: string }>,
    history: (since?: number) =>
      ipcRenderer.invoke('experts:history', since) as Promise<{ entries?: unknown[]; error?: string }>,
    bench: (expertId: string) =>
      ipcRenderer.invoke('experts:bench', expertId) as Promise<{ ok?: boolean; error?: string }>,
    restore: (expertId: string) =>
      ipcRenderer.invoke('experts:restore', expertId) as Promise<{ ok?: boolean; error?: string }>,
    maintenance: () =>
      ipcRenderer.invoke('experts:maintenance') as Promise<{ ok?: boolean; report?: unknown; promoted?: string[]; replaced?: string[]; hiringNeeds?: unknown[]; error?: string }>,
  },

  // Council Agents — 15 specialized agents (5 per AI pool), fire/hire, performance
  councilAgents: {
    roster: () =>
      ipcRenderer.invoke('council-agents:roster') as Promise<{ roster?: unknown[]; error?: string }>,
    performance: () =>
      ipcRenderer.invoke('council-agents:performance') as Promise<{ performance?: unknown[]; error?: string }>,
    fire: (agentId: string, reason: string) =>
      ipcRenderer.invoke('council-agents:fire', agentId, reason) as Promise<{ ok?: boolean; error?: string }>,
    restore: (agentId: string) =>
      ipcRenderer.invoke('council-agents:restore', agentId) as Promise<{ ok?: boolean; error?: string }>,
    retire: (agentId: string, reason: string) =>
      ipcRenderer.invoke('council-agents:retire', agentId, reason) as Promise<{ ok?: boolean; error?: string }>,
    evaluate: () =>
      ipcRenderer.invoke('council-agents:evaluate') as Promise<{ ok?: boolean; actions?: unknown[]; error?: string }>,
  },

  // Adaptive Expert Placement — lane utilization, hot experts, rebalance
  placement: {
    status: () =>
      ipcRenderer.invoke('placement:status') as Promise<{ report?: unknown; error?: string }>,
    rebalance: () =>
      ipcRenderer.invoke('placement:rebalance') as Promise<{ decisions?: unknown[]; error?: string }>,
    report: () =>
      ipcRenderer.invoke('placement:report') as Promise<{ report?: string; error?: string }>,
  },

  // Performance Hunter — component health monitoring and quarantine
  evolution: {
    scan: () =>
      ipcRenderer.invoke('evolution:scan') as Promise<{ report?: unknown; error?: string }>,
    quarantined: () =>
      ipcRenderer.invoke('evolution:quarantined') as Promise<{ components?: string[]; error?: string }>,
    restore: (componentId: string) =>
      ipcRenderer.invoke('evolution:restore', componentId) as Promise<{ ok?: boolean; error?: string }>,
    auditLog: (since?: number) =>
      ipcRenderer.invoke('evolution:auditLog', since) as Promise<{ entries?: unknown[]; error?: string }>,
    healthReport: () =>
      ipcRenderer.invoke('evolution:healthReport') as Promise<{ report?: string; error?: string }>,
  },

  // Vibe Coding — council-guided aesthetic-to-implementation translation
  vibe: {
    createProfile: (name: string, ventureId?: string) =>
      ipcRenderer.invoke('vibe:createProfile', name, ventureId) as Promise<{ ok?: boolean; profile?: unknown; error?: string }>,
    getProfile: (id: string) =>
      ipcRenderer.invoke('vibe:getProfile', id) as Promise<{ ok?: boolean; profile?: unknown; error?: string }>,
    listProfiles: () =>
      ipcRenderer.invoke('vibe:listProfiles') as Promise<{ ok?: boolean; profiles?: unknown[]; error?: string }>,
    deleteProfile: (id: string) =>
      ipcRenderer.invoke('vibe:deleteProfile', id) as Promise<{ ok?: boolean; error?: string }>,
    updateProfile: (id: string, updates: Record<string, unknown>) =>
      ipcRenderer.invoke('vibe:updateProfile', id, updates) as Promise<{ ok?: boolean; profile?: unknown; error?: string }>,
    parse: (input: string) =>
      ipcRenderer.invoke('vibe:parse', input) as Promise<{ ok?: boolean; signals?: unknown[]; mode?: string | null; error?: string }>,
    runCouncil: (profileId: string, input: string, mode?: string) =>
      ipcRenderer.invoke('vibe:runCouncil', profileId, input, mode) as Promise<{ ok?: boolean; result?: unknown; error?: string }>,
    audit: (profileId: string, currentState?: string) =>
      ipcRenderer.invoke('vibe:audit', profileId, currentState) as Promise<{ ok?: boolean; plan?: unknown; error?: string }>,
    rescue: (profileId: string, currentState?: string) =>
      ipcRenderer.invoke('vibe:rescue', profileId, currentState) as Promise<{ ok?: boolean; plan?: unknown; error?: string }>,
    onProgress: (cb: (data: { phase: string; detail?: string }) => void): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, data: { phase: string; detail?: string }) => cb(data);
      ipcRenderer.on('vibe:progress', handler);
      return () => ipcRenderer.removeListener('vibe:progress', handler);
    },
  },

  // ── Phase 1.5: Background Agent ──────────────────────────────────────────
  backgroundLoop: {
    status: () =>
      ipcRenderer.invoke('backgroundLoop:status') as Promise<{
        enabled: boolean;
        running: boolean;
        lastTickAt: number | null;
        lastFiredMission: { id: string; name: string; firedAt: number } | null;
      }>,
    enable: () =>
      ipcRenderer.invoke('backgroundLoop:enable') as Promise<{
        enabled: boolean;
        running: boolean;
        lastTickAt: number | null;
        lastFiredMission: { id: string; name: string; firedAt: number } | null;
      }>,
    disable: () =>
      ipcRenderer.invoke('backgroundLoop:disable') as Promise<{
        enabled: boolean;
        running: boolean;
        lastTickAt: number | null;
        lastFiredMission: { id: string; name: string; firedAt: number } | null;
      }>,
    onStatus: (cb: (v: {
      enabled: boolean;
      running: boolean;
      lastTickAt: number | null;
      lastFiredMission: { id: string; name: string; firedAt: number } | null;
      healthy?: boolean;
      restarted?: boolean;
    }) => void): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, v: unknown) => cb(v as never);
      ipcRenderer.on('backgroundLoop:status', handler);
      return () => ipcRenderer.removeListener('backgroundLoop:status', handler);
    },
  },

  // ── Phase 1.5: Webhook ───────────────────────────────────────────────────
  webhook: {
    status: () =>
      ipcRenderer.invoke('webhook:status') as Promise<{
        enabled: boolean;
        port: number;
        token: string;
        running: boolean;
      }>,
    start: () =>
      ipcRenderer.invoke('webhook:start') as Promise<{ ok: boolean; port?: number; token?: string; error?: string }>,
    stop: () =>
      ipcRenderer.invoke('webhook:stop') as Promise<{ ok: boolean; error?: string }>,
  },

  // ── Phase 2: Control Plane ───────────────────────────────────────────────
  controlPlane: {
    status: () =>
      ipcRenderer.invoke('controlPlane:status') as Promise<{
        enabled: boolean;
        running: boolean;
        port: number;
        token: string;
        lastStartedAt: number | null;
      }>,
    start: () =>
      ipcRenderer.invoke('controlPlane:start') as Promise<{
        ok: boolean;
        enabled: boolean;
        running: boolean;
        port: number;
        token: string;
        error?: string;
      }>,
    stop: () =>
      ipcRenderer.invoke('controlPlane:stop') as Promise<{ ok: boolean; error?: string }>,
    generateToken: () =>
      ipcRenderer.invoke('controlPlane:generateToken') as Promise<{ token: string }>,
  },

  // ── Phase 3: GitHub Integration ─────────────────────────────────────────
  github: {
    setCredential: (key: 'pat' | 'webhook_secret', value: string) =>
      ipcRenderer.invoke('github:setCredential', key, value) as Promise<{ ok: boolean }>,
    testConnection: () =>
      ipcRenderer.invoke('github:testConnection') as Promise<{
        ok: boolean; login?: string; name?: string | null; publicRepos?: number; error?: string;
      }>,
    listRepos: (page?: number) =>
      ipcRenderer.invoke('github:listRepos', page) as Promise<{
        repos: Array<{ id: number; full_name: string; name: string; owner: string; private: boolean; description: string | null; open_issues_count: number }>;
        error?: string;
      }>,
    listPRs: (owner: string, repo: string) =>
      ipcRenderer.invoke('github:listPRs', owner, repo) as Promise<{
        prs: Array<{ number: number; title: string; user: string; html_url: string; draft: boolean; additions: number; deletions: number; changed_files: number; created_at: string }>;
        error?: string;
      }>,
    listIssues: (owner: string, repo: string) =>
      ipcRenderer.invoke('github:listIssues', owner, repo) as Promise<{
        issues: Array<{ number: number; title: string; user: string; html_url: string; labels: string[]; comments: number; created_at: string }>;
        error?: string;
      }>,
    reviewPR: (owner: string, repo: string, prNumber: number) =>
      ipcRenderer.invoke('github:reviewPR', owner, repo, prNumber) as Promise<{
        ok: boolean;
        reviewId?: string;
        review?: {
          id: string; type: string; owner: string; repo: string; number: number; title: string;
          htmlUrl: string; synthesis: string; responses: Array<{ provider: string; text: string }>;
          status: string; createdAt: number;
        };
        error?: string;
      }>,
    triageIssue: (owner: string, repo: string, issueNumber: number) =>
      ipcRenderer.invoke('github:triageIssue', owner, repo, issueNumber) as Promise<{
        ok: boolean; reviewId?: string;
        review?: {
          id: string; type: string; synthesis: string; responses: Array<{ provider: string; text: string }>;
          status: string; createdAt: number;
        };
        error?: string;
      }>,
    pendingReviews: () =>
      ipcRenderer.invoke('github:pendingReviews') as Promise<{
        reviews: Array<{
          id: string; type: string; owner: string; repo: string; number: number; title: string;
          htmlUrl: string; synthesis: string; responses: Array<{ provider: string; text: string }>;
          status: string; commentUrl?: string; createdAt: number; source: string;
        }>;
      }>,
    approveReview: (reviewId: string) =>
      ipcRenderer.invoke('github:approveReview', reviewId) as Promise<{ ok: boolean; commentUrl?: string; error?: string }>,
    dismissReview: (reviewId: string) =>
      ipcRenderer.invoke('github:dismissReview', reviewId) as Promise<{ ok: boolean; error?: string }>,
    webhookStatus: () =>
      ipcRenderer.invoke('github:webhookStatus') as Promise<{ enabled: boolean; hasSecret: boolean; port: number }>,
    webhookEnable: () =>
      ipcRenderer.invoke('github:webhookEnable') as Promise<{ ok: boolean }>,
    webhookDisable: () =>
      ipcRenderer.invoke('github:webhookDisable') as Promise<{ ok: boolean }>,
  },

  // ── Phase 2: Skill Trust Layer ───────────────────────────────────────────
  skillTrust: {
    analyze: (rawMarkdown: string) =>
      ipcRenderer.invoke('skillTrust:analyze', rawMarkdown) as Promise<{
        result?: {
          riskLevel: 'low' | 'medium' | 'high' | 'critical';
          blocked: boolean;
          blockReason?: string;
          requiresApproval: boolean;
          councilReviewRequired: boolean;
          declaredCapabilities: string[];
          detectedCapabilities: string[];
          detectedPatterns: Array<{ pattern: string; severity: string; description: string }>;
          reviewSummary: string;
          frontmatter: Record<string, unknown>;
        };
        decision?: {
          allowed: boolean;
          requiresApproval: boolean;
          requiresCouncilReview: boolean;
          blockReason?: string;
        };
        error?: string;
      }>,
  },

  // ── Phase 5: Skill Store ─────────────────────────────────────────────────
  skillStore: {
    list: () =>
      ipcRenderer.invoke('skill:list') as Promise<{ skills: Array<{
        id: string; name: string; version?: string; description?: string; author?: string;
        source: string; sourceUrl?: string; riskLevel: string; blocked: boolean;
        requiresApproval: boolean; councilReviewRequired: boolean;
        declaredCapabilities: string[]; detectedCapabilities: string[];
        reviewSummary: string; enabled: boolean; installedAt: number;
        lastRunAt?: number; runCount: number;
      }> }>,
    install: (rawMarkdown: string, source: string, sourceUrl?: string) =>
      ipcRenderer.invoke('skill:install', rawMarkdown, source, sourceUrl) as Promise<{
        success: boolean;
        data?: {
          skill: Record<string, unknown>;
          decision: { allowed: boolean; requiresApproval: boolean; requiresCouncilReview: boolean; blockReason?: string };
          result: { riskLevel: string; blocked: boolean; reviewSummary: string; detectedPatterns: Array<{ pattern: string; severity: string; description: string }> };
        };
        error?: string;
        retryable?: boolean;
      }>,
    enable:    (id: string) => ipcRenderer.invoke('skill:enable',    id) as Promise<{ ok: boolean }>,
    disable:   (id: string) => ipcRenderer.invoke('skill:disable',   id) as Promise<{ ok: boolean }>,
    uninstall: (id: string) => ipcRenderer.invoke('skill:uninstall', id) as Promise<{ ok: boolean }>,
    run:       (id: string, goal?: string) => ipcRenderer.invoke('skill:run', id, goal) as Promise<{ ok: boolean; taskId?: string; error?: string }>,
    fetchUrl:  (url: string) => ipcRenderer.invoke('skill:fetchUrl', url) as Promise<{ ok: boolean; markdown?: string; error?: string }>,
    examples:  () => ipcRenderer.invoke('skill:examples') as Promise<{ examples: Array<{ name: string; description: string; markdown: string }> }>,
  },
  // ── Phase 7: Approval Policy Engine ──────────────────────────────────────
  policy: {
    list: () =>
      ipcRenderer.invoke('policy:list') as Promise<{ rules: Array<{
        id: string; enabled: boolean; priority: number; name: string; description?: string;
        matchSource: string; matchRiskClass: string; matchCategory?: string;
        action: string; preferLocal?: boolean; isDefault: boolean; createdAt: number;
      }> }>,
    create: (fields: { name: string; description?: string; priority: number; enabled: boolean; matchSource: string; matchRiskClass: string; matchCategory?: string; action: string; preferLocal?: boolean }) =>
      ipcRenderer.invoke('policy:create', fields) as Promise<{ ok: boolean; rule?: Record<string, unknown> }>,
    update: (id: string, patch: Record<string, unknown>) =>
      ipcRenderer.invoke('policy:update', id, patch) as Promise<{ ok: boolean; rule?: Record<string, unknown>; error?: string }>,
    delete: (id: string) =>
      ipcRenderer.invoke('policy:delete', id) as Promise<{ ok: boolean }>,
    enable:      (id: string) => ipcRenderer.invoke('policy:enable',      id) as Promise<{ ok: boolean }>,
    disable:     (id: string) => ipcRenderer.invoke('policy:disable',     id) as Promise<{ ok: boolean }>,
    setPriority: (id: string, priority: number) => ipcRenderer.invoke('policy:setPriority', id, priority) as Promise<{ ok: boolean }>,
    reset:       () => ipcRenderer.invoke('policy:reset') as Promise<{ ok: boolean }>,
    simulate:    (source: string, riskClass: string, category?: string) =>
      ipcRenderer.invoke('policy:simulate', source, riskClass, category) as Promise<{ resolution: { action: string; ruleId: string | null; ruleName: string | null; preferLocal: boolean; usedFallback: boolean } }>,
  },

  // ── Phase 6: Telegram Messaging ──────────────────────────────────────────
  jira: {
    setCredentials:       (workspaceUrl: string, email: string, apiToken: string) =>
      ipcRenderer.invoke('jira:setCredentials', workspaceUrl, email, apiToken) as Promise<{ ok: boolean }>,
    testConnection:       () =>
      ipcRenderer.invoke('jira:testConnection') as Promise<{ ok: boolean; displayName?: string; emailAddress?: string; accountId?: string; error?: string }>,
    status:               () =>
      ipcRenderer.invoke('jira:status') as Promise<{ enabled: boolean; workspaceUrl: string; email: string; displayName: string; allowedProjects: string[]; summarySlackChannel: string }>,
    listProjects:         () =>
      ipcRenderer.invoke('jira:listProjects') as Promise<{ ok: boolean; projects: Array<{ id: string; key: string; name: string; issueTypes: Array<{ id: string; name: string; subtask: boolean }> }>; error?: string }>,
    searchIssues:         (jql: string, maxResults?: number) =>
      ipcRenderer.invoke('jira:searchIssues', jql, maxResults) as Promise<{ ok: boolean; issues: Array<{ id: string; key: string; summary: string; status: string; statusCategory: string; priority: string; issueType: string; projectKey: string; projectName: string; assigneeName?: string; description: string; updated: string }>; error?: string }>,
    getIssue:             (issueKey: string) =>
      ipcRenderer.invoke('jira:getIssue', issueKey) as Promise<{ ok: boolean; issue?: { id: string; key: string; summary: string; status: string; statusCategory: string; priority: string; issueType: string; projectKey: string; projectName: string; assigneeName?: string; reporterName?: string; description: string; created: string; updated: string }; comments?: Array<{ id: string; authorName: string; body: string; created: string }>; transitions?: Array<{ id: string; name: string; toStatus: string }>; error?: string }>,
    queueComment:         (issueKey: string, body: string) =>
      ipcRenderer.invoke('jira:queueComment', issueKey, body) as Promise<{ ok: boolean; actionId?: string; requiresApproval?: boolean; error?: string }>,
    queueCreate:          (projectKey: string, issueTypeId: string, summary: string, description?: string) =>
      ipcRenderer.invoke('jira:queueCreate', projectKey, issueTypeId, summary, description) as Promise<{ ok: boolean; actionId?: string; error?: string }>,
    queueTransition:      (issueKey: string, transitionId: string, toStatus: string) =>
      ipcRenderer.invoke('jira:queueTransition', issueKey, transitionId, toStatus) as Promise<{ ok: boolean; actionId?: string; error?: string }>,
    approveAction:        (actionId: string) =>
      ipcRenderer.invoke('jira:approveAction', actionId) as Promise<{ ok: boolean; error?: string }>,
    dismissAction:        (actionId: string) =>
      ipcRenderer.invoke('jira:dismissAction', actionId) as Promise<{ ok: boolean }>,
    listQueue:            (includeProcessed?: boolean) =>
      ipcRenderer.invoke('jira:listQueue', includeProcessed) as Promise<{ actions: Array<{ id: string; type: string; issueKey?: string; projectKey?: string; summary: string; body: string; toStatus?: string; status: string; createdAt: number; processedAt?: number }> }>,
    triageIssue:          (issueKey: string) =>
      ipcRenderer.invoke('jira:triageIssue', issueKey) as Promise<{ ok: boolean; taskId?: string; error?: string }>,
    setSummarySlackChannel:(channelId: string) =>
      ipcRenderer.invoke('jira:setSummarySlackChannel', channelId) as Promise<{ ok: boolean }>,
    sendSummaryNow:       (jql?: string) =>
      ipcRenderer.invoke('jira:sendSummaryNow', jql) as Promise<{ ok: boolean; error?: string }>,
    setAllowedProjects:   (projectKeys: string[]) =>
      ipcRenderer.invoke('jira:setAllowedProjects', projectKeys) as Promise<{ ok: boolean }>,
  },
  slack: {
    setToken:           (token: string) =>
      ipcRenderer.invoke('slack:setToken', token) as Promise<{ ok: boolean }>,
    testConnection:     () =>
      ipcRenderer.invoke('slack:testConnection') as Promise<{ ok: boolean; botUserId?: string; botUserName?: string; workspaceName?: string; workspaceId?: string; error?: string }>,
    start:              () =>
      ipcRenderer.invoke('slack:start') as Promise<{ ok: boolean; workspaceName?: string; botUserName?: string; already?: boolean; error?: string }>,
    stop:               () =>
      ipcRenderer.invoke('slack:stop') as Promise<{ ok: boolean }>,
    status:             () =>
      ipcRenderer.invoke('slack:status') as Promise<{ enabled: boolean; running: boolean; workspaceName: string; botUserName: string; allowedChannels: string[]; allowedUsers: string[]; summaryChannel: string; summarySchedule: string; lastMessageAt: number | null }>,
    listChannels:       () =>
      ipcRenderer.invoke('slack:listChannels') as Promise<{ ok: boolean; channels: Array<{ id: string; name: string; isMember: boolean; numMembers: number }>; error?: string }>,
    addAllowedChannel:  (channelId: string) =>
      ipcRenderer.invoke('slack:addAllowedChannel', channelId) as Promise<{ ok: boolean; allowedChannels: string[] }>,
    removeAllowedChannel:(channelId: string) =>
      ipcRenderer.invoke('slack:removeAllowedChannel', channelId) as Promise<{ ok: boolean; allowedChannels: string[] }>,
    addAllowedUser:     (userId: string) =>
      ipcRenderer.invoke('slack:addAllowedUser', userId) as Promise<{ ok: boolean; allowedUsers: string[] }>,
    removeAllowedUser:  (userId: string) =>
      ipcRenderer.invoke('slack:removeAllowedUser', userId) as Promise<{ ok: boolean; allowedUsers: string[] }>,
    sendMessage:        (channelId: string, text: string) =>
      ipcRenderer.invoke('slack:sendMessage', channelId, text) as Promise<{ ok: boolean; error?: string }>,
    listMessages:       (limit?: number) =>
      ipcRenderer.invoke('slack:listMessages', limit) as Promise<{ messages: Array<{
        id: string; direction: string; channel: string; chatId: number; channelId?: string;
        chatName?: string; text: string; riskClass?: string; taskId?: string;
        status: string; blockedReason?: string; timestamp: number;
      }> }>,
    setSummaryChannel:  (channelId: string) =>
      ipcRenderer.invoke('slack:setSummaryChannel', channelId) as Promise<{ ok: boolean }>,
    setSummarySchedule: (schedule: 'disabled' | 'daily' | 'weekly') =>
      ipcRenderer.invoke('slack:setSummarySchedule', schedule) as Promise<{ ok: boolean }>,
    sendSummaryNow:     () =>
      ipcRenderer.invoke('slack:sendSummaryNow') as Promise<{ ok: boolean }>,
  },
  discord: {
    setToken:           (token: string) =>
      ipcRenderer.invoke('discord:setToken', token) as Promise<{ ok: boolean }>,
    testConnection:     () =>
      ipcRenderer.invoke('discord:testConnection') as Promise<{ ok: boolean; id?: string; username?: string; discriminator?: string; error?: string }>,
    start:              () =>
      ipcRenderer.invoke('discord:start') as Promise<{ ok: boolean; username?: string; already?: boolean; error?: string }>,
    stop:               () =>
      ipcRenderer.invoke('discord:stop') as Promise<{ ok: boolean }>,
    status:             () =>
      ipcRenderer.invoke('discord:status') as Promise<{ enabled: boolean; running: boolean; botUserName: string; botUserId: string; allowedChannels: string[]; allowedUsers: string[]; lastMessageAt: number | null }>,
    listGuilds:         () =>
      ipcRenderer.invoke('discord:listGuilds') as Promise<{ ok: boolean; guilds: Array<{ id: string; name: string }>; error?: string }>,
    listChannels:       (guildId: string) =>
      ipcRenderer.invoke('discord:listChannels', guildId) as Promise<{ ok: boolean; channels: Array<{ id: string; name: string; type: number }>; error?: string }>,
    addAllowedChannel:  (channelId: string) =>
      ipcRenderer.invoke('discord:addAllowedChannel', channelId) as Promise<{ ok: boolean; allowedChannels: string[] }>,
    removeAllowedChannel: (channelId: string) =>
      ipcRenderer.invoke('discord:removeAllowedChannel', channelId) as Promise<{ ok: boolean; allowedChannels: string[] }>,
    addAllowedUser:     (userId: string) =>
      ipcRenderer.invoke('discord:addAllowedUser', userId) as Promise<{ ok: boolean; allowedUsers: string[] }>,
    removeAllowedUser:  (userId: string) =>
      ipcRenderer.invoke('discord:removeAllowedUser', userId) as Promise<{ ok: boolean; allowedUsers: string[] }>,
    sendMessage:        (channelId: string, text: string) =>
      ipcRenderer.invoke('discord:sendMessage', channelId, text) as Promise<{ ok: boolean; error?: string }>,
    listMessages:       (limit?: number) =>
      ipcRenderer.invoke('discord:listMessages', limit) as Promise<{ messages: Array<{
        id: string; direction: string; channel: string; chatId: number; channelId?: string;
        chatName?: string; text: string; riskClass?: string; taskId?: string;
        status: string; blockedReason?: string; timestamp: number;
      }> }>,
  },
  linear: {
    setApiKey:          (apiKey: string) =>
      ipcRenderer.invoke('linear:setApiKey', apiKey) as Promise<{ ok: boolean }>,
    testConnection:     () =>
      ipcRenderer.invoke('linear:testConnection') as Promise<{ ok: boolean; name?: string; email?: string; id?: string; error?: string }>,
    status:             () =>
      ipcRenderer.invoke('linear:status') as Promise<{ enabled: boolean; userName: string; workspaceName: string; allowedTeams: string[]; summarySlackChannel: string }>,
    listTeams:          () =>
      ipcRenderer.invoke('linear:listTeams') as Promise<{ ok: boolean; teams: Array<{ id: string; name: string; key: string }>; error?: string }>,
    searchIssues:       (query: string, teamId?: string, limit?: number) =>
      ipcRenderer.invoke('linear:searchIssues', query, teamId, limit) as Promise<{ ok: boolean; issues: Array<{
        id: string; identifier: string; title: string;
        stateId: string; stateName: string; stateType: string;
        priority: number; priorityLabel: string;
        assigneeId?: string; assigneeName?: string;
        teamId: string; teamName: string; teamKey: string;
        description: string; updatedAt: string; createdAt: string; url: string;
      }>; error?: string }>,
    getIssue:           (id: string) =>
      ipcRenderer.invoke('linear:getIssue', id) as Promise<{ ok: boolean; issue?: {
        id: string; identifier: string; title: string;
        stateId: string; stateName: string; stateType: string;
        priority: number; priorityLabel: string;
        assigneeId?: string; assigneeName?: string;
        teamId: string; teamName: string; teamKey: string;
        description: string; updatedAt: string; createdAt: string; url: string;
      }; comments?: Array<{ id: string; body: string; authorName: string; createdAt: string }>;
         states?: Array<{ id: string; name: string; type: string; color: string }>; error?: string }>,
    listWorkflowStates: (teamId: string) =>
      ipcRenderer.invoke('linear:listWorkflowStates', teamId) as Promise<{ ok: boolean; states: Array<{ id: string; name: string; type: string; color: string }>; error?: string }>,
    queueComment:       (issueId: string, identifier: string, body: string) =>
      ipcRenderer.invoke('linear:queueComment', issueId, identifier, body) as Promise<{ ok: boolean; actionId?: string; requiresApproval?: boolean; error?: string }>,
    queueCreate:        (teamId: string, teamKey: string, title: string, description?: string, stateId?: string, assigneeId?: string, priority?: number) =>
      ipcRenderer.invoke('linear:queueCreate', teamId, teamKey, title, description, stateId, assigneeId, priority) as Promise<{ ok: boolean; actionId?: string; error?: string }>,
    queueUpdate:        (issueId: string, identifier: string, patch: { stateId?: string; stateName?: string; assigneeId?: string; priority?: number; title?: string }) =>
      ipcRenderer.invoke('linear:queueUpdate', issueId, identifier, patch) as Promise<{ ok: boolean; actionId?: string; error?: string }>,
    approveAction:      (actionId: string) =>
      ipcRenderer.invoke('linear:approveAction', actionId) as Promise<{ ok: boolean; error?: string }>,
    dismissAction:      (actionId: string) =>
      ipcRenderer.invoke('linear:dismissAction', actionId) as Promise<{ ok: boolean }>,
    listQueue:          (includeProcessed?: boolean) =>
      ipcRenderer.invoke('linear:listQueue', includeProcessed) as Promise<{ actions: Array<{
        id: string; type: string; issueId?: string; teamId?: string;
        summary: string; body: string; stateId?: string; assigneeId?: string;
        priority?: number; status: string; createdAt: number; processedAt?: number;
      }> }>,
    triageIssue:        (issueId: string) =>
      ipcRenderer.invoke('linear:triageIssue', issueId) as Promise<{ ok: boolean; taskId?: string; error?: string }>,
    setAllowedTeams:    (teamIds: string[]) =>
      ipcRenderer.invoke('linear:setAllowedTeams', teamIds) as Promise<{ ok: boolean }>,
    setSummarySlackChannel: (channelId: string) =>
      ipcRenderer.invoke('linear:setSummarySlackChannel', channelId) as Promise<{ ok: boolean }>,
    sendSummaryNow:     (query?: string, teamId?: string) =>
      ipcRenderer.invoke('linear:sendSummaryNow', query, teamId) as Promise<{ ok: boolean; error?: string }>,
  },
  push: {
    configure:       (config: {
      provider: 'ntfy' | 'pushover' | 'disabled';
      ntfyTopic?: string; ntfyServer?: string; ntfyToken?: string;
      pushoverApp?: string; pushoverUser?: string;
    }) =>
      ipcRenderer.invoke('push:configure', config) as Promise<{ ok: boolean; error?: string }>,
    status:          () =>
      ipcRenderer.invoke('push:status') as Promise<{
        provider: string; ntfyTopic?: string; ntfyServer?: string; pushoverUser?: string;
        eventSettings: Record<string, { enabled: boolean; priority: string }>;
      }>,
    setEventSetting: (event: string, enabled: boolean, priority: string) =>
      ipcRenderer.invoke('push:setEventSetting', event, enabled, priority) as Promise<{ ok: boolean }>,
    getEventSettings: () =>
      ipcRenderer.invoke('push:getEventSettings') as Promise<{ events: Array<{
        key: string; label: string; description: string; enabled: boolean; priority: string;
      }> }>,
    sendTest:        () =>
      ipcRenderer.invoke('push:sendTest') as Promise<{ ok: boolean; error?: string }>,
    getLog:          (limit?: number) =>
      ipcRenderer.invoke('push:getLog', limit) as Promise<{ entries: Array<{
        id: string; event: string; title: string; provider: string;
        success: boolean; error?: string; timestamp: number;
      }> }>,
  },
  recipe: {
    list:      () =>
      ipcRenderer.invoke('recipe:list') as Promise<Array<{
        id: string; name: string; description: string; trigger: string; triggerLabel: string;
        paramSchema: Array<{ key: string; label: string; placeholder: string; required: boolean }>;
        enabled: boolean; params: Record<string, string>;
        lastRunAt?: number; lastRunStatus?: 'success' | 'failed' | 'skipped'; lastRunResult?: string;
      }>>,
    toggle:    (id: string, enabled: boolean) =>
      ipcRenderer.invoke('recipe:toggle', id, enabled) as Promise<{ ok: boolean }>,
    setParams: (id: string, params: Record<string, string>) =>
      ipcRenderer.invoke('recipe:setParams', id, params) as Promise<{ ok: boolean }>,
    run:       (id: string) =>
      ipcRenderer.invoke('recipe:run', id) as Promise<{ ok: boolean; result?: string; error?: string }>,
  },
  ops: {
    overview:     (window?: '24h' | '7d' | '30d') =>
      ipcRenderer.invoke('ops:overview', window ?? '24h') as Promise<{
        window: string; tasksCreated: number; tasksCompleted: number; tasksFailed: number;
        approvalsPending: number; highRiskBlocked: number; skillBlocked: number;
        recipesCompleted: number; recipesFailed: number;
        pushSent: number; pushFailed: number;
        localModelUses: number; cloudFallbacks: number;
        githubReviewsDone: number; policyMatches: number;
      }>,
    channels:     (window?: '24h' | '7d' | '30d') =>
      ipcRenderer.invoke('ops:channels', window ?? '24h') as Promise<{
        window: string;
        telegram: { received: number; blocked: number; replied: number; approvals: number; replyRate: number };
        slack:    { received: number; blocked: number; replied: number; approvals: number; replyRate: number };
        discord:  { received: number; blocked: number; replied: number; approvals: number; replyRate: number };
        recentMessages: Array<{ channel: string; direction: string; status: string; riskClass?: string; text: string; timestamp: number }>;
      }>,
    governance:   (window?: '24h' | '7d' | '30d') =>
      ipcRenderer.invoke('ops:governance', window ?? '24h') as Promise<{
        window: string; totalMatches: number; totalBlocked: number; totalApprovals: number;
        topRules:       Array<{ label: string; count: number }>;
        topSources:     Array<{ label: string; count: number }>;
        topRiskClasses: Array<{ label: string; count: number }>;
        recentBlocked:  Array<{ eventType: string; reason: string; source: string; timestamp: number }>;
      }>,
    integrations: (window?: '24h' | '7d' | '30d') =>
      ipcRenderer.invoke('ops:integrations', window ?? '24h') as Promise<{
        window: string;
        github:  { reviewsCompleted: number; commentsPosted: number; commentsBlocked: number; webhooksReceived: number; issuesTriaged: number };
        jira:    { actionsQueued: number; actionsApproved: number; actionsDismissed: number; commentsPosted: number; issuesCreated: number; transitions: number };
        linear:  { actionsQueued: number; actionsApproved: number; actionsDismissed: number; commentsPosted: number; issuesCreated: number; statusUpdates: number };
        skills:  { installed: number; executed: number; blocked: number };
        controlPlane: { tasksCreated: number };
      }>,
    recipes:      (window?: '24h' | '7d' | '30d') =>
      ipcRenderer.invoke('ops:recipes', window ?? '24h') as Promise<{
        window: string;
        recipes: Array<{ id: string; name: string; trigger: string; enabled: boolean; lastRunAt?: number; lastRunStatus?: string; lastRunResult?: string; ranInWindow: boolean }>;
      }>,
    health:       () =>
      ipcRenderer.invoke('ops:health') as Promise<{
        services: Array<{ name: string; connected: boolean; running: boolean; detail: string }>;
      }>,
  },
  action: {
    list:    (view?: string) =>
      ipcRenderer.invoke('action:list', view ?? 'all') as Promise<{ items: Array<{
        id: string; source: string; service: string; severity: 'critical' | 'warning' | 'info';
        title: string; body: string;
        canApprove: boolean; canDismiss: boolean; canRetry: boolean;
        createdAt: number; metadata: Record<string, unknown>;
      }> }>,
    count:   () =>
      ipcRenderer.invoke('action:count') as Promise<{
        total: number; approvals: number; blocked: number; failures: number; alerts: number;
      }>,
    approve: (itemId: string) =>
      ipcRenderer.invoke('action:approve', itemId) as Promise<{ ok: boolean; error?: string }>,
    dismiss: (itemId: string) =>
      ipcRenderer.invoke('action:dismiss', itemId) as Promise<{ ok: boolean }>,
    retry:   (itemId: string) =>
      ipcRenderer.invoke('action:retry', itemId) as Promise<{ ok: boolean; result?: string; error?: string }>,
  },
  context: {
    getAll:         () =>
      ipcRenderer.invoke('context:getAll') as Promise<{
        repoMappings:    Array<{ id: string; repo: string; jiraProjectKey?: string; linearTeamId?: string; linearTeamName?: string; reviewInstructions?: string; defaultLabels?: string[]; createdAt: number; updatedAt: number }>;
        channelMappings: Array<{ id: string; channel: string; channelId: string; channelName?: string; workstream?: string; projectKey?: string; createdAt: number; updatedAt: number }>;
        projectNotes:    Array<{ id: string; projectKey: string; projectName?: string; summary?: string; defaultPriority?: string; defaultLabels?: string[]; automationContext?: string; escalationChannelId?: string; createdAt: number; updatedAt: number }>;
        enabled:         Record<string, boolean>;
      }>,
    setEnabled:     (category: string, enabled: boolean) =>
      ipcRenderer.invoke('context:setEnabled', category, enabled) as Promise<{ ok: boolean }>,
    upsertRepo:     (input: { repo: string; jiraProjectKey?: string; linearTeamId?: string; linearTeamName?: string; reviewInstructions?: string; defaultLabels?: string[] }) =>
      ipcRenderer.invoke('context:upsertRepo', input) as Promise<{ ok: boolean; repoMappings: unknown[] }>,
    deleteRepo:     (id: string) =>
      ipcRenderer.invoke('context:deleteRepo', id) as Promise<{ ok: boolean }>,
    upsertChannel:  (input: { channel: 'telegram' | 'slack' | 'discord'; channelId: string; channelName?: string; workstream?: string; projectKey?: string }) =>
      ipcRenderer.invoke('context:upsertChannel', input) as Promise<{ ok: boolean; channelMappings: unknown[] }>,
    deleteChannel:  (id: string) =>
      ipcRenderer.invoke('context:deleteChannel', id) as Promise<{ ok: boolean }>,
    upsertProject:  (input: { projectKey: string; projectName?: string; summary?: string; defaultPriority?: string; defaultLabels?: string[]; automationContext?: string; escalationChannelId?: string }) =>
      ipcRenderer.invoke('context:upsertProject', input) as Promise<{ ok: boolean; projectNotes: unknown[] }>,
    deleteProject:  (id: string) =>
      ipcRenderer.invoke('context:deleteProject', id) as Promise<{ ok: boolean }>,
    resolveRepo:    (repo: string) =>
      ipcRenderer.invoke('context:resolveRepo', repo) as Promise<{ mapping?: unknown; projectNote?: unknown }>,
    resolveChannel: (channel: string, channelId: string) =>
      ipcRenderer.invoke('context:resolveChannel', channel, channelId) as Promise<{ mapping?: unknown; projectNote?: unknown }>,
  },

  // Phase 17 + 18 — TriForge Dispatch
  dispatch: {
    status: () =>
      ipcRenderer.invoke('dispatch:status') as Promise<{
        enabled: boolean; running: boolean; port: number; hasToken: boolean;
        networkMode: string; deviceCount: number;
        policy: { enabled: boolean; maxRisk: string; requireDesktopConfirm: boolean };
        startedAt: number | null; allowRemoteApprove: boolean;
      }>,
    enable:        (port?: number) =>
      ipcRenderer.invoke('dispatch:enable', port) as Promise<{ ok: boolean; port?: number; error?: string }>,
    disable:       () =>
      ipcRenderer.invoke('dispatch:disable') as Promise<{ ok: boolean }>,
    generateToken: () =>
      ipcRenderer.invoke('dispatch:generateToken') as Promise<{ ok: boolean; token?: string }>,
    revokeToken:   () =>
      ipcRenderer.invoke('dispatch:revokeToken') as Promise<{ ok: boolean }>,
    getToken:      () =>
      ipcRenderer.invoke('dispatch:getToken') as Promise<string | null>,

    // Phase 18 — network mode + approve policy
    setNetworkMode: (mode: 'local' | 'lan' | 'remote') =>
      ipcRenderer.invoke('dispatch:setNetworkMode', mode) as Promise<{ ok: boolean }>,
    setApprovePolicy: (policy: { enabled?: boolean; maxRisk?: string; requireDesktopConfirm?: boolean }) =>
      ipcRenderer.invoke('dispatch:setApprovePolicy', policy) as Promise<{ ok: boolean }>,
    setAllowRemoteApprove: (allow: boolean) =>
      ipcRenderer.invoke('dispatch:setAllowRemoteApprove', allow) as Promise<{ ok: boolean }>,
    setSessionTtl: (minutes: number) =>
      ipcRenderer.invoke('dispatch:setSessionTtl', minutes) as Promise<{ ok: boolean }>,

    // Phase 18 — pairing
    generatePairingCode: () =>
      ipcRenderer.invoke('dispatch:generatePairingCode') as Promise<{
        ok: boolean; code?: string; expiresAt?: number;
        pairUrl?: string; qrDataUrl?: string | null; error?: string;
      }>,
    getPairingCode: () =>
      ipcRenderer.invoke('dispatch:getPairingCode') as Promise<{ code: string; expiresAt: number } | null>,

    // Phase 18 — device management
    listDevices: () =>
      ipcRenderer.invoke('dispatch:listDevices') as Promise<Array<{
        id: string; label: string; pairedAt: number;
        lastSeenAt: number | null; lastSeenIp: string | null; expired: boolean;
      }>>,
    revokeDevice: (deviceId: string) =>
      ipcRenderer.invoke('dispatch:revokeDevice', deviceId) as Promise<{ ok: boolean }>,

    // Phase 18 — desktop confirmation
    listPendingConfirmations: () =>
      ipcRenderer.invoke('dispatch:listPendingConfirmations') as Promise<Array<{
        id: string; action: string; itemId: string; verb: string;
        deviceLabel: string; clientIp: string; createdAt: number;
      }>>,
    desktopConfirm: (confirmId: string, approved: boolean) =>
      ipcRenderer.invoke('dispatch:desktopConfirm', confirmId, approved) as Promise<{ ok: boolean; error?: string }>,

    // Phase 18 — IPC renderer event listeners
    onDevicePaired: (cb: (device: { id: string; label: string; pairedAt: number }) => void) => {
      const handler = (_: Electron.IpcRendererEvent, d: unknown) => cb(d as any);
      ipcRenderer.on('dispatch:devicePaired', handler);
      return () => ipcRenderer.removeListener('dispatch:devicePaired', handler);
    },
    onConfirmationRequired: (cb: (conf: { id: string; action: string; deviceLabel: string; itemId: string }) => void) => {
      const handler = (_: Electron.IpcRendererEvent, c: unknown) => cb(c as any);
      ipcRenderer.on('dispatch:confirmationRequired', handler);
      return () => ipcRenderer.removeListener('dispatch:confirmationRequired', handler);
    },

    // Phase 19 — public URL / deep-link wiring
    setPublicUrl: (url: string) =>
      ipcRenderer.invoke('dispatch:setPublicUrl', url) as Promise<{ ok: boolean }>,
    getPublicUrl: () =>
      ipcRenderer.invoke('dispatch:getPublicUrl') as Promise<{ url: string }>,
  },

  // Phase 28 — Workspace integration management
  workspaceIntegration: {
    getStatus:      (integration: string) =>
      ipcRenderer.invoke('workspaceIntegration:getStatus', integration) as Promise<{ config: Record<string, unknown> | null; hasPersonalCred: boolean }>,
    setConfig:      (integration: string, payload: Record<string, unknown>) =>
      ipcRenderer.invoke('workspaceIntegration:setConfig', integration, payload) as Promise<{ ok: boolean; error?: string }>,
    test:           (integration: string) =>
      ipcRenderer.invoke('workspaceIntegration:test', integration) as Promise<{ ok: boolean; scope: string; explanation: string }>,
    revoke:         (integration: string) =>
      ipcRenderer.invoke('workspaceIntegration:revoke', integration) as Promise<{ ok: boolean; error?: string }>,
    setDefaults:    (integration: string, defaults: { useWorkspaceByDefault: boolean; allowPersonalFallback: boolean }) =>
      ipcRenderer.invoke('workspaceIntegration:setDefaults', integration, defaults) as Promise<{ ok: boolean }>,
    getRecipeScope: (recipeId: string) =>
      ipcRenderer.invoke('workspaceIntegration:getRecipeScope', recipeId) as Promise<{ scope: 'personal' | 'workspace' }>,
    setRecipeScope: (recipeId: string, scope: 'personal' | 'workspace') =>
      ipcRenderer.invoke('workspaceIntegration:setRecipeScope', recipeId, scope) as Promise<{ ok: boolean }>,
  },

  // Phase 29 — Workspace policy matrix
  workspacePolicy: {
    getMatrix:     () =>
      ipcRenderer.invoke('workspacePolicy:getMatrix') as Promise<{ matrix: Array<Record<string, unknown>> }>,
    setRule:       (category: string, patch: Record<string, unknown>) =>
      ipcRenderer.invoke('workspacePolicy:setRule', category, patch) as Promise<{ ok: boolean; error?: string }>,
    resetDefaults: () =>
      ipcRenderer.invoke('workspacePolicy:resetDefaults') as Promise<{ ok: boolean; matrix: Array<Record<string, unknown>> }>,
    simulate:      (roleOrDeviceId: string, category: string) =>
      ipcRenderer.invoke('workspacePolicy:simulate', roleOrDeviceId, category) as Promise<{
        allowed: boolean; requiresDesktopConfirm: boolean; reason: string; actorRole: string | null;
      }>,
  },

  // Phase 30 — Workspace automation governance
  workspaceAutomation: {
    getPolicy:               () =>
      ipcRenderer.invoke('workspaceAutomation:getPolicy') as Promise<Record<string, unknown>>,
    setPolicy:               (patch: Record<string, unknown>) =>
      ipcRenderer.invoke('workspaceAutomation:setPolicy', patch) as Promise<{ ok: boolean; policy: Record<string, unknown> }>,
    getRecipePolicy:         (recipeId: string) =>
      ipcRenderer.invoke('workspaceAutomation:getRecipePolicy', recipeId) as Promise<{ policy: Record<string, unknown> | null }>,
    setRecipePolicy:         (recipeId: string, patch: Record<string, unknown>) =>
      ipcRenderer.invoke('workspaceAutomation:setRecipePolicy', recipeId, patch) as Promise<{ ok: boolean; policy?: Record<string, unknown>; error?: string }>,
    deleteRecipePolicy:      (recipeId: string) =>
      ipcRenderer.invoke('workspaceAutomation:deleteRecipePolicy', recipeId) as Promise<{ ok: boolean }>,
    getDelegatedOperators:   () =>
      ipcRenderer.invoke('workspaceAutomation:getDelegatedOperators') as Promise<{ operators: Array<Record<string, unknown>> }>,
    assignDelegatedOperator: (op: Record<string, unknown>) =>
      ipcRenderer.invoke('workspaceAutomation:assignDelegatedOperator', op) as Promise<{ ok: boolean; error?: string }>,
    revokeDelegatedOperator: (deviceId: string) =>
      ipcRenderer.invoke('workspaceAutomation:revokeDelegatedOperator', deviceId) as Promise<{ ok: boolean }>,
    simulateRun:             (deviceIdOrRole: string, recipeId: string, isRemote: boolean) =>
      ipcRenderer.invoke('workspaceAutomation:simulateRun', deviceIdOrRole, recipeId, isRemote) as Promise<{
        allowed: boolean; requiresDesktopConfirm: boolean; reason: string;
        blockedBy?: string; actorRole?: string | null; delegationType?: string | null; effectivePolicy: string;
      }>,
  },

  // Phase 31 — Runbooks + Incident Mode
  runbook: {
    list:           () =>
      ipcRenderer.invoke('runbook:list') as Promise<{ runbooks: Array<Record<string, unknown>> }>,
    get:            (id: string) =>
      ipcRenderer.invoke('runbook:get', id) as Promise<{ runbook: Record<string, unknown> | null }>,
    create:         (payload: Record<string, unknown>) =>
      ipcRenderer.invoke('runbook:create', payload) as Promise<{ ok: boolean; runbook?: Record<string, unknown>; error?: string }>,
    update:         (id: string, patch: Record<string, unknown>) =>
      ipcRenderer.invoke('runbook:update', id, patch) as Promise<{ ok: boolean; runbook?: Record<string, unknown>; error?: string }>,
    delete:         (id: string) =>
      ipcRenderer.invoke('runbook:delete', id) as Promise<{ ok: boolean }>,
    run:            (id: string, vars?: Record<string, string>) =>
      ipcRenderer.invoke('runbook:run', id, vars ?? {}) as Promise<{ ok: boolean; executionId?: string; status?: string; error?: string; missingVars?: string }>,
    listExecutions: (runbookId?: string) =>
      ipcRenderer.invoke('runbook:listExecutions', runbookId) as Promise<{ executions: Array<Record<string, unknown>> }>,
    getExecution:   (executionId: string) =>
      ipcRenderer.invoke('runbook:getExecution', executionId) as Promise<{ execution: Record<string, unknown> | null }>,
    addStep:        (runbookId: string, step: Record<string, unknown>) =>
      ipcRenderer.invoke('runbook:addStep', runbookId, step) as Promise<{ ok: boolean; step?: Record<string, unknown> }>,
    removeStep:     (runbookId: string, stepId: string) =>
      ipcRenderer.invoke('runbook:removeStep', runbookId, stepId) as Promise<{ ok: boolean }>,
    reorderSteps:   (runbookId: string, stepIds: string[]) =>
      ipcRenderer.invoke('runbook:reorderSteps', runbookId, stepIds) as Promise<{ ok: boolean }>,
    incidentMode: {
      get: () =>
        ipcRenderer.invoke('runbook:incidentMode:get') as Promise<{ active: boolean; activatedAt?: number; reason?: string }>,
      set: (active: boolean, reason?: string) =>
        ipcRenderer.invoke('runbook:incidentMode:set', active, reason) as Promise<{ ok: boolean; state: Record<string, unknown> }>,
    },
    onIncidentModeChange: (cb: (state: { active: boolean; activatedAt?: number; reason?: string }) => void): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, state: { active: boolean }) => cb(state);
      ipcRenderer.on('runbook:incidentMode', handler);
      return () => ipcRenderer.removeListener('runbook:incidentMode', handler);
    },
    // Phase 32 — pause/resume
    getHandoffQueue: () =>
      ipcRenderer.invoke('runbook:getHandoffQueue') as Promise<{ items: Record<string, unknown>[] }>,
    resume: (executionId: string, resolution: string) =>
      ipcRenderer.invoke('runbook:resume', executionId, resolution) as Promise<{ ok: boolean; execution?: Record<string, unknown>; error?: string }>,
    abort: (executionId: string) =>
      ipcRenderer.invoke('runbook:abort', executionId) as Promise<{ ok: boolean; execution?: Record<string, unknown>; error?: string }>,
  },

  // Phase 35 — Runbook Packs
  pack: {
    list: () =>
      ipcRenderer.invoke('pack:list') as Promise<{ packs: Record<string, unknown>[] }>,
    export: (runbookIds: string[], meta: Record<string, string>) =>
      ipcRenderer.invoke('pack:export', runbookIds, meta) as Promise<{ ok: boolean; json?: string; pack?: Record<string, unknown>; error?: string }>,
    previewImport: (json: string) =>
      ipcRenderer.invoke('pack:previewImport', json) as Promise<{ ok: boolean; preview?: Record<string, unknown>; error?: string }>,
    import: (json: string) =>
      ipcRenderer.invoke('pack:import', json) as Promise<{ ok: boolean; installedIds?: string[]; updatedIds?: string[]; pack?: Record<string, unknown>; error?: string }>,
    uninstall: (packId: string) =>
      ipcRenderer.invoke('pack:uninstall', packId) as Promise<{ ok: boolean; removedIds?: string[]; preservedIds?: string[]; error?: string }>,
    rollback: (packId: string) =>
      ipcRenderer.invoke('pack:rollback', packId) as Promise<{ ok: boolean; restoredIds?: string[]; version?: string; pack?: Record<string, unknown>; error?: string }>,
    // Phase 36 — Trust, signing, and update safety
    trust: {
      getLocalKey: () =>
        ipcRenderer.invoke('pack:trust:getLocalKey') as Promise<{ ok: boolean; keyId?: string; publicKeyPem?: string; error?: string }>,
      signPack: (json: string, signerName: string, signerEmail?: string) =>
        ipcRenderer.invoke('pack:trust:signPack', json, signerName, signerEmail) as Promise<{ ok: boolean; json?: string; error?: string }>,
      listSigners: () =>
        ipcRenderer.invoke('pack:trust:listSigners') as Promise<{ signers: Record<string, unknown>[] }>,
      addSigner: (signer: Record<string, unknown>) =>
        ipcRenderer.invoke('pack:trust:addSigner', signer) as Promise<{ ok: boolean; keyId?: string; error?: string }>,
      removeSigner: (keyId: string) =>
        ipcRenderer.invoke('pack:trust:removeSigner', keyId) as Promise<{ ok: boolean }>,
      revokeSigner: (keyId: string) =>
        ipcRenderer.invoke('pack:trust:revokeSigner', keyId) as Promise<{ ok: boolean }>,
      getPolicy: () =>
        ipcRenderer.invoke('pack:trust:getPolicy') as Promise<{ policy: Record<string, boolean> }>,
      setPolicy: (policy: Record<string, boolean>) =>
        ipcRenderer.invoke('pack:trust:setPolicy', policy) as Promise<{ ok: boolean }>,
    },
  },

  // Phase 37 — Workspace analytics
  analytics: {
    report: (window: '24h' | '7d' | '30d') =>
      ipcRenderer.invoke('analytics:report', window) as Promise<{ ok: boolean; report?: Record<string, unknown>; error?: string }>,
    exportText: (window: '24h' | '7d' | '30d') =>
      ipcRenderer.invoke('analytics:exportText', window) as Promise<{ ok: boolean; text?: string; error?: string }>,
  },

  // Phase 38 — Enterprise admin + policy inheritance
  org: {
    get: () =>
      ipcRenderer.invoke('org:get') as Promise<{ org: Record<string, unknown> | null; policy: Record<string, unknown> }>,
    create: (name: string, plan: string, adminEmail?: string) =>
      ipcRenderer.invoke('org:create', name, plan, adminEmail) as Promise<{ ok: boolean; org?: Record<string, unknown>; error?: string }>,
    update: (patch: Record<string, unknown>) =>
      ipcRenderer.invoke('org:update', patch) as Promise<{ ok: boolean; org?: Record<string, unknown>; error?: string }>,
    policy: {
      get: () =>
        ipcRenderer.invoke('org:policy:get') as Promise<{ policy: Record<string, unknown> }>,
      set: (domain: string, patch: Record<string, unknown>) =>
        ipcRenderer.invoke('org:policy:set', domain, patch) as Promise<{ ok: boolean; policy?: Record<string, unknown>; error?: string }>,
      effective: () =>
        ipcRenderer.invoke('org:policy:effective') as Promise<{ effective: Record<string, unknown> }>,
    },
    signers: {
      list: () =>
        ipcRenderer.invoke('org:signers:list') as Promise<{ signers: Record<string, unknown>[] }>,
      add: (signer: Record<string, unknown>) =>
        ipcRenderer.invoke('org:signers:add', signer) as Promise<{ ok: boolean; keyId?: string; error?: string }>,
      revoke: (keyId: string) =>
        ipcRenderer.invoke('org:signers:revoke', keyId) as Promise<{ ok: boolean; error?: string }>,
      remove: (keyId: string) =>
        ipcRenderer.invoke('org:signers:remove', keyId) as Promise<{ ok: boolean; error?: string }>,
    },
    analytics: (window: '24h' | '7d' | '30d') =>
      ipcRenderer.invoke('org:analytics', window) as Promise<{ ok: boolean; report?: Record<string, unknown>; workspaceCount?: number; error?: string }>,
  },


  // Phase 27 — Workspace admin
  workspace: {
    get:    () =>
      ipcRenderer.invoke('workspace:get') as Promise<Record<string, unknown> | null>,
    create: (name: string) =>
      ipcRenderer.invoke('workspace:create', name) as Promise<{ ok: boolean; workspace?: Record<string, unknown>; error?: string }>,
    rename: (name: string) =>
      ipcRenderer.invoke('workspace:rename', name) as Promise<{ ok: boolean }>,
    invite: (role: string) =>
      ipcRenderer.invoke('workspace:invite', role) as Promise<{ ok: boolean; invite?: Record<string, unknown>; error?: string }>,
    setMemberRole: (deviceId: string, role: string) =>
      ipcRenderer.invoke('workspace:member:setRole', deviceId, role) as Promise<{ ok: boolean; error?: string }>,
    removeMember: (deviceId: string) =>
      ipcRenderer.invoke('workspace:member:remove', deviceId) as Promise<{ ok: boolean; error?: string }>,
    updatePolicy: (patch: Record<string, unknown>) =>
      ipcRenderer.invoke('workspace:policy:update', patch) as Promise<{ ok: boolean; error?: string }>,
  },

  telegram: {
    setToken:         (token: string) =>
      ipcRenderer.invoke('telegram:setToken', token) as Promise<{ ok: boolean }>,
    testConnection:   () =>
      ipcRenderer.invoke('telegram:testConnection') as Promise<{ ok: boolean; username?: string; firstName?: string; id?: number; error?: string }>,
    start:            () =>
      ipcRenderer.invoke('telegram:start') as Promise<{ ok: boolean; username?: string; already?: boolean; error?: string }>,
    stop:             () =>
      ipcRenderer.invoke('telegram:stop') as Promise<{ ok: boolean }>,
    status:           () =>
      ipcRenderer.invoke('telegram:status') as Promise<{ enabled: boolean; running: boolean; botUsername: string; allowedChats: number[]; lastMessageAt: number | null }>,
    addAllowedChat:   (chatId: number) =>
      ipcRenderer.invoke('telegram:addAllowedChat', chatId) as Promise<{ ok: boolean; allowedChats: number[] }>,
    removeAllowedChat:(chatId: number) =>
      ipcRenderer.invoke('telegram:removeAllowedChat', chatId) as Promise<{ ok: boolean; allowedChats: number[] }>,
    sendMessage:      (chatId: number, text: string) =>
      ipcRenderer.invoke('telegram:sendMessage', chatId, text) as Promise<{ ok: boolean; error?: string }>,
    listMessages:     (limit?: number) =>
      ipcRenderer.invoke('telegram:listMessages', limit) as Promise<{ messages: Array<{
        id: string; direction: string; channel: string; chatId: number; chatName?: string;
        text: string; riskClass?: string; taskId?: string; status: string;
        blockedReason?: string; timestamp: number;
      }> }>,
  },

  // ── App metadata ─────────────────────────────────────────────────────────────
  app: {
    version: () => ipcRenderer.invoke('app:version') as Promise<string>,
    name:    () => ipcRenderer.invoke('app:name')    as Promise<string>,
  },

  // ── Setup wizard ─────────────────────────────────────────────────────────────
  setup: {
    getRole: () => ipcRenderer.invoke('setup:getRole') as Promise<string>,
    setRole: (role: string) => ipcRenderer.invoke('setup:setRole', role) as Promise<{ ok: boolean }>,
  },

  // ── Phase 40 — Recovery & Maintenance ────────────────────────────────────────
  recovery: {
    // Backup / Restore
    createBackup:    ()                         => ipcRenderer.invoke('recovery:createBackup')    as Promise<{ ok: boolean; path?: string; error?: string }>,
    restoreBackup:   ()                         => ipcRenderer.invoke('recovery:restoreBackup')   as Promise<{ ok: boolean; label?: string; createdAt?: number; error?: string }>,
    getLastBackupAt: ()                         => ipcRenderer.invoke('recovery:getLastBackupAt') as Promise<number | null>,

    // Snapshots
    listSnapshots:    ()                          => ipcRenderer.invoke('recovery:listSnapshots')            as Promise<Array<{ id: string; label: string; createdAt: number; trigger: string }>>,
    createSnapshot:   (trigger: string, label: string) => ipcRenderer.invoke('recovery:createSnapshot', trigger, label) as Promise<{ id: string; label: string; createdAt: number; trigger: string }>,
    rollbackSnapshot: (id: string)               => ipcRenderer.invoke('recovery:rollbackSnapshot', id)     as Promise<{ ok: boolean; error?: string }>,
    deleteSnapshot:   (id: string)               => ipcRenderer.invoke('recovery:deleteSnapshot', id)       as Promise<boolean>,

    // Store validation
    validateStore: () => ipcRenderer.invoke('recovery:validateStore') as Promise<{
      valid: boolean;
      issues: Array<{ severity: string; field: string; message: string; repairable: boolean }>;
      checkedAt: number;
      repairedCount: number;
    }>,
    repairStore: () => ipcRenderer.invoke('recovery:repairStore') as Promise<{
      valid: boolean;
      issues: Array<{ severity: string; field: string; message: string; repairable: boolean }>;
      checkedAt: number;
      repairedCount: number;
    }>,

    // Migrations
    runMigrations:       () => ipcRenderer.invoke('recovery:runMigrations')       as Promise<{ ran: number; errors: string[] }>,
    getMigrationHistory: () => ipcRenderer.invoke('recovery:getMigrationHistory') as Promise<Array<{ version: number; name: string; appliedAt: number; success: boolean; error?: string }>>,
    getSchemaVersion:    () => ipcRenderer.invoke('recovery:getSchemaVersion')    as Promise<number>,

    // Crash guard
    getIncidents:  () =>                      ipcRenderer.invoke('recovery:getIncidents')          as Promise<Array<{ serviceId: string; label: string; crashCount: number; lastCrashAt: number; disabled: boolean; suggestion: string }>>,
    resetIncident: (serviceId: string) =>     ipcRenderer.invoke('recovery:resetIncident', serviceId) as Promise<{ ok: boolean }>,
  },

  // ── Income Operator Phase 1 — Capability Scanner ─────────────────────────
  incomeScanner: {
    run: () =>
      ipcRenderer.invoke('scanner:run') as Promise<{
        result?: {
          scannedAt: number;
          installedApps: Array<{ name: string; version?: string; path: string; exportFormats: string[]; incomeRelevant: string[] }>;
          gpuName?: string;
          gpuVramMB?: number;
          storageGB: number;
          connectedPlatforms: string[];
          browserProfiles: string[];
        };
        error?: string;
        tier?: string;
      }>,
    getResult: () =>
      ipcRenderer.invoke('scanner:result:get') as Promise<{
        scan: {
          scannedAt: number;
          installedApps: Array<{ name: string; path: string; exportFormats: string[]; incomeRelevant: string[] }>;
          gpuName?: string;
          gpuVramMB?: number;
          storageGB: number;
          connectedPlatforms: string[];
          browserProfiles: string[];
        } | null;
      }>,
    platforms: () =>
      ipcRenderer.invoke('scanner:platforms:detected') as Promise<{ platforms: string[] }>,
  },

  // ── Income Operator Phase 1 — Tool Gap Analyzer ──────────────────────────
  toolGap: {
    analyze: (laneId: string) =>
      ipcRenderer.invoke('toolGap:analyze', laneId) as Promise<{
        gaps?: Array<{
          toolName: string;
          laneId: string;
          priority: 'required' | 'recommended';
          reason: string;
          rationale: string;
          installMode: 'suggest' | 'guided' | 'full';
          wingetId?: string;
          installUrl?: string;
          verifyPath?: string;
          approvalRequired: true;
          requiresUac: boolean;
        }>;
        error?: string;
      }>,
    install: (gap: {
      toolName: string;
      laneId: string;
      installMode: 'suggest' | 'guided' | 'full';
      wingetId?: string;
      installUrl?: string;
      approvalRequired: true;
      requiresUac: boolean;
    }) =>
      ipcRenderer.invoke('toolGap:install', gap) as Promise<{ ok?: boolean; opened?: boolean; error?: string }>,
    verify: (toolName: string) =>
      ipcRenderer.invoke('toolGap:verify', toolName) as Promise<{ found: boolean; toolName: string }>,
  },

  // ── Phase 3 — Income Experiment Manager ──────────────────────────────────
  experiments: {
    setBudget: (params: { totalBudget: number; maxPerExperiment: number; dailyLimit: number; reservePct?: number }) =>
      ipcRenderer.invoke('experiment:setBudget', params) as Promise<{ ok?: boolean; budget?: Record<string, unknown>; error?: string; tier?: string }>,
    getBudget: () =>
      ipcRenderer.invoke('experiment:getBudget') as Promise<{ budget: {
        totalBudget: number; maxPerExperiment: number; dailyLimit: number; reservePct: number;
        allocated: Record<string, number>; spent: Record<string, number>;
        dailySpentToday: number; dailySpentDate: string; setAt: number;
      } | null }>,
    create: (params: { laneId: string; name: string; rationale: string; budgetAsk: number; autoKillRule?: { budgetPctSpent: number; afterDays: number } }) =>
      ipcRenderer.invoke('experiment:create', params) as Promise<{ experiment?: Record<string, unknown>; error?: string; tier?: string }>,
    transition: (id: string, to: string, reason?: string) =>
      ipcRenderer.invoke('experiment:transition', id, to, reason) as Promise<{ experiment?: Record<string, unknown>; error?: string }>,
    recordSpend: (id: string, amount: number, reason: string) =>
      ipcRenderer.invoke('experiment:recordSpend', id, amount, reason) as Promise<{ ok?: boolean; experiment?: Record<string, unknown>; dailyLimitHit?: boolean; budgetExceeded?: boolean; error?: string }>,
    recordRevenue: (id: string, amount: number, source: string) =>
      ipcRenderer.invoke('experiment:recordRevenue', id, amount, source) as Promise<{ ok?: boolean; experiment?: Record<string, unknown>; error?: string; tier?: string }>,
    updateMetrics: (id: string, patch: Record<string, number>) =>
      ipcRenderer.invoke('experiment:updateMetrics', id, patch) as Promise<{ ok?: boolean; error?: string }>,
    evaluateAutoKill: (id: string) =>
      ipcRenderer.invoke('experiment:evaluateAutoKill', id) as Promise<{ shouldKill: boolean; shouldScale: boolean; reason: string; roi: number }>,
    recordDecision: (id: string, decision: 'continue' | 'kill' | 'scale', reason: string) =>
      ipcRenderer.invoke('experiment:recordDecision', id, decision, reason) as Promise<{ ok?: boolean; error?: string; tier?: string }>,
    get: (id: string) =>
      ipcRenderer.invoke('experiment:get', id) as Promise<{
        experiment?: Record<string, unknown>; roi?: number; roiLabel?: string;
        recommendation?: 'continue' | 'kill' | 'scale'; recommendationReason?: string; error?: string;
      }>,
    list: () =>
      ipcRenderer.invoke('experiment:list') as Promise<{ experiments: Array<Record<string, unknown>> }>,
    listActive: () =>
      ipcRenderer.invoke('experiment:listActive') as Promise<{ experiments: Array<Record<string, unknown>> }>,
    // Phase 4C execution handlers — called after approval is granted or for safe direct actions
    kill: (id: string, reason: string) =>
      ipcRenderer.invoke('experiment:kill', id, reason) as Promise<{ ok?: boolean; experiment?: Record<string, unknown>; error?: string }>,
    scale: (id: string, reason: string) =>
      ipcRenderer.invoke('experiment:scale', id, reason) as Promise<{ ok?: boolean; experiment?: Record<string, unknown>; error?: string }>,
    launch: (id: string, reason: string) =>
      ipcRenderer.invoke('experiment:launch', id, reason) as Promise<{ ok?: boolean; experiment?: Record<string, unknown>; error?: string }>,
    publishContent: (id: string, platform: string, contentNote: string) =>
      ipcRenderer.invoke('content:publish', id, platform, contentNote) as Promise<{ ok?: boolean; error?: string }>,
    connectPlatform: (id: string, platform: string, url: string) =>
      ipcRenderer.invoke('platform:connect', id, platform, url) as Promise<{ ok?: boolean; error?: string }>,
    getEvents: (id: string, limit?: number) =>
      ipcRenderer.invoke('experiment:getEvents', id, limit) as Promise<{
        events?: Array<Record<string, unknown>>;
        error?: string;
      }>,
  },

  // Phase 4C — Income decision engine
  // Phase 4D — Activity feed + per-experiment events
  income: {
    // Phase 1 — Lane ranking
    lanesRank: () =>
      ipcRenderer.invoke('income:lanes:rank') as Promise<{
        lanes?: Array<{
          laneId: string; laneName: string; readinessScore: number;
          gaps: Array<{ toolName: string; priority: 'required' | 'recommended'; reason: string; installMode: string }>;
          timeToFirstDollar: string; rationale: string;
        }>;
        error?: string; tier?: string;
      }>,
    // Phase 4C — Decision engine
    getRecommendations: (pendingApprovalKeys: string[]) =>
      ipcRenderer.invoke('income:getRecommendations', pendingApprovalKeys) as Promise<{
        recommendations?: Array<{
          experimentId: string; experimentName: string; recommendedAction: string;
          reason: string; riskLevel: 'low' | 'medium' | 'high';
          approvalRequired: boolean; blockedBy: string[]; priority: 'critical' | 'high' | 'normal';
        }>;
        error?: string;
      }>,
    // Phase 4D — Activity feed
    getActivity: (limit?: number) =>
      ipcRenderer.invoke('income:getActivity', limit) as Promise<{
        events?: Array<{ ts: number; label: string; detail: string; eventType: string }>;
        error?: string;
      }>,
    // Phase 4E — Skill + platform readiness per lane
    getReadiness: (laneIds: string[]) =>
      ipcRenderer.invoke('income:getReadiness', laneIds) as Promise<{
        lanes?: Array<{
          laneId: string; laneName: string; readiness: 'live' | 'building' | 'pending';
          skills: Array<{ id: string; name: string; installed: boolean }>;
          platforms: Array<{ id: string; name: string; connected: boolean }>;
        }>;
        error?: string;
      }>,
  },

  // ── Income Operator Phase 5 — Autopilot ──────────────────────────────────
  autopilot: {
    enable:  () =>
      ipcRenderer.invoke('autopilot:enable') as Promise<{
        success: boolean;
        data?: { status: { enabled: boolean; running: boolean; lastRunAt: number | null; intervalMs: number; newRecoCount: number; lastCycleResult: string | null } };
        error?: string; retryable?: boolean;
      }>,
    disable: () =>
      ipcRenderer.invoke('autopilot:disable') as Promise<{
        success: boolean;
        data?: { status: { enabled: boolean; running: boolean; lastRunAt: number | null; intervalMs: number; newRecoCount: number; lastCycleResult: string | null } };
        error?: string; retryable?: boolean;
      }>,
    status: () =>
      ipcRenderer.invoke('autopilot:status') as Promise<{
        status?: {
          enabled: boolean; running: boolean; lastRunAt: number | null;
          intervalMs: number; newRecoCount: number; lastCycleResult: string | null;
        };
        error?: string;
      }>,
    runNow: () =>
      ipcRenderer.invoke('autopilot:runNow') as Promise<{
        success: boolean;
        data?: { status: { enabled: boolean; running: boolean; lastRunAt: number | null; intervalMs: number; newRecoCount: number; lastCycleResult: string | null } };
        error?: string; retryable?: boolean;
      }>,
    /** Called whenever the autopilot status changes (each cycle end). */
    onStatus: (cb: () => void): (() => void) => {
      const h = () => cb();
      ipcRenderer.on('income:autopilot:status', h);
      return () => ipcRenderer.removeListener('income:autopilot:status', h);
    },
    /** Called when recommendations changed — renderer should refresh. */
    onChanged: (cb: () => void): (() => void) => {
      const h = () => cb();
      ipcRenderer.on('income:autopilot:changed', h);
      return () => ipcRenderer.removeListener('income:autopilot:changed', h);
    },
  },

  // ── Phase 2B — ForgeHub skill catalog ────────────────────────────────────
  forgeHub: {
    list: () =>
      ipcRenderer.invoke('forgeHub:list') as Promise<{
        skills: Array<{
          id: string; name: string; version: string; description: string;
          author: string; tags: string[]; incomeLanes: string[];
        }>;
      }>,
    get: (id: string) =>
      ipcRenderer.invoke('forgeHub:get', id) as Promise<{
        skill?: {
          id: string; name: string; version: string; description: string;
          author: string; tags: string[]; incomeLanes: string[]; markdown: string;
        };
        error?: string;
      }>,
    forLane: (laneId: string) =>
      ipcRenderer.invoke('forgeHub:forLane', laneId) as Promise<{
        skills: Array<{
          id: string; name: string; version: string; description: string;
          author: string; tags: string[]; incomeLanes: string[];
        }>;
      }>,
    getMarkdown: (id: string) =>
      ipcRenderer.invoke('forgeHub:getMarkdown', id) as Promise<{ markdown?: string; error?: string }>,
  },

  // ── Phase 2C — MCP Client ─────────────────────────────────────────────────
  mcp: {
    list: () =>
      ipcRenderer.invoke('mcp:list') as Promise<{
        servers: Array<{ id: string; serverInfo: { name: string; version: string } | null; toolCount: number }>;
      }>,
    connect: (config: { id: string; label: string; command: string; args?: string[]; cwd?: string; env?: Record<string, string> }) =>
      ipcRenderer.invoke('mcp:connect', config) as Promise<{ ok?: boolean; serverInfo?: { name: string; version: string }; error?: string; tier?: string }>,
    disconnect: (id: string) =>
      ipcRenderer.invoke('mcp:disconnect', id) as Promise<{ ok?: boolean; error?: string }>,
    listTools: (serverId: string) =>
      ipcRenderer.invoke('mcp:listTools', serverId) as Promise<{
        tools?: Array<{ name: string; description: string; inputSchema: Record<string, unknown> }>;
        error?: string;
      }>,
    evaluateTool: (serverId: string, toolName: string) =>
      ipcRenderer.invoke('mcp:evaluateTool', serverId, toolName) as Promise<{
        risk?: 'low' | 'medium' | 'high' | 'blocked';
        reason?: string;
        requiresApproval?: boolean;
        error?: string;
      }>,
    callTool: (serverId: string, toolName: string, args: Record<string, unknown>, approved: boolean) =>
      ipcRenderer.invoke('mcp:callTool', serverId, toolName, args, approved) as Promise<{
        ok?: boolean;
        result?: {
          content: Array<{ type: string; text?: string; data?: string; mimeType?: string }>;
          isError?: boolean;
        };
        error?: string;
        tier?: string;
      }>,
  },

  // ── Section 4 — Goal 1: Machine Awareness ─────────────────────────────
  machine: {
    getContext: () =>
      ipcRenderer.invoke('machine:getContext') as Promise<{
        system: { os: string; platform: string };
        apps: Array<{ name: string; path: string; present: boolean }>;
        files: { desktop: string[]; documents: string[] };
        error?: string;
      }>,
  },

  // ── Section 8 — Desktop Operator Engine ───────────────────────────────
  operator: {
    /** Get honest capability map for the current platform. */
    getCapability: () =>
      ipcRenderer.invoke('operator:capability') as Promise<{
        ok: boolean;
        capability?: {
          platform: string;
          canListRunningApps: boolean;
          canGetFrontmostApp: boolean;
          canFocusApp: boolean;
          canCaptureScreen: boolean;
          canReadWindowTitle: boolean;
          canOCRScreen: boolean;
          canTypeText: boolean;
          canSendKeystroke: boolean;
          canClickAtCoords: boolean;
          accessibilityGranted: boolean;
          screenRecordingGranted: boolean;
          notes: string[];
        };
        error?: string;
      }>,

    /** List all visible running app names. */
    listApps: () =>
      ipcRenderer.invoke('operator:target:list') as Promise<{
        ok: boolean; apps?: string[]; error?: string;
      }>,

    /** Get the currently focused app and window title. */
    getFrontmost: () =>
      ipcRenderer.invoke('operator:target:frontmost') as Promise<{
        ok: boolean;
        target?: {
          appName: string;
          windowTitle?: string;
          pid?: number;
          confirmed: boolean;
          capturedAt: number;
        } | null;
        error?: string;
      }>,

    /** Bring a named app to the foreground. */
    focusApp: (appName: string) =>
      ipcRenderer.invoke('operator:target:focus', appName) as Promise<{
        ok: boolean;
        result?: { outcome: string; durationMs: number; executedTarget?: { appName: string } };
        error?: string;
      }>,

    /** Capture a screenshot of the primary display. */
    screenshot: (outputPath?: string) =>
      ipcRenderer.invoke('operator:perception:screenshot', outputPath) as Promise<{
        ok: boolean; path?: string; error?: string; recoveryHint?: string;
      }>,

    /** Capture and return a screenshot as a base64 data URL (for live view rendering). */
    screenshotBase64: () =>
      ipcRenderer.invoke('operator:screenshot:base64') as Promise<{
        ok: boolean; dataUrl?: string; error?: string;
      }>,

    /** Get a perception snapshot (frontmost app + summary). */
    perceive: () =>
      ipcRenderer.invoke('operator:perception:perceive') as Promise<{
        ok: boolean;
        perception?: {
          timestamp: number;
          target: { appName: string; windowTitle?: string; confirmed: boolean; capturedAt: number } | null;
          screenshotPath?: string;
          summary?: string;
        };
        error?: string;
      }>,

    /** Start an operator session targeting a named app. */
    startSession: (intendedTarget?: string) =>
      ipcRenderer.invoke('operator:session:start', intendedTarget) as Promise<{
        ok: boolean;
        session?: { id: string; startedAt: number; intendedTarget: string | null; status: string };
        error?: string;
      }>,

    /** Stop an active operator session. */
    stopSession: (sessionId: string, reason?: string) =>
      ipcRenderer.invoke('operator:session:stop', sessionId, reason) as Promise<{
        ok: boolean; error?: string;
      }>,

    /** List all operator sessions. */
    listSessions: () =>
      ipcRenderer.invoke('operator:session:list') as Promise<{
        ok: boolean;
        sessions?: Array<{
          id: string; startedAt: number; intendedTarget: string | null;
          status: string; actionCount?: number; endedAt?: number;
          trustLevel?: 'supervised' | 'trusted';
        }>;
        error?: string;
      }>,

    /**
     * Set the trust level for an active session.
     * 'supervised' — every input action requires approval (default).
     * 'trusted'    — input actions auto-execute; all logged to audit trail.
     */
    setTrust: (sessionId: string, level: 'supervised' | 'trusted') =>
      ipcRenderer.invoke('operator:session:trust', sessionId, level) as Promise<{
        ok: boolean; error?: string;
      }>,

    /**
     * Queue a type_text or send_key action for approval.
     * Returns { outcome: 'approval_pending', approvalId } immediately.
     * Call approveAction(approvalId) to execute after user confirms.
     */
    queueInputAction: (
      sessionId: string,
      actionType: 'type_text' | 'send_key',
      opts: { text?: string; key?: string; modifiers?: string[] },
    ) =>
      ipcRenderer.invoke('operator:action:queue', sessionId, actionType, opts) as Promise<{
        ok: boolean;
        result?: {
          actionId: string;
          actionType: string;
          outcome: string;
          approvalId?: string;
          recoveryHint?: string;
        };
        error?: string;
      }>,

    /** List pending operator approval requests. */
    listApprovals: () =>
      ipcRenderer.invoke('operator:approval:list') as Promise<{
        ok: boolean;
        approvals?: Array<{
          id: string;
          sessionId: string;
          risk: string;
          description: string;
          contextScreenshotPath?: string;
          createdAt: number;
          expiresAt: number;
          status: string;
        }>;
        error?: string;
      }>,

    /** Approve a queued input action and execute it immediately. */
    approveAction: (approvalId: string) =>
      ipcRenderer.invoke('operator:approval:approve', approvalId) as Promise<{
        ok: boolean;
        result?: {
          actionId: string;
          actionType: string;
          outcome: string;
          durationMs: number;
          error?: string;
          recoveryHint?: string;
        };
        error?: string;
      }>,

    /** Deny a pending operator approval. */
    denyAction: (approvalId: string, reason?: string) =>
      ipcRenderer.invoke('operator:approval:deny', approvalId, reason) as Promise<{
        ok: boolean; error?: string;
      }>,

    /**
     * Run a natural-language goal against the live desktop.
     * The task runner takes a screenshot, asks Claude what to do next, executes
     * it, verifies, and repeats — just like a remote-access human operator.
     * Progress events are emitted on 'operator:task:progress'.
     */
    runTask: (sessionId: string, goal: string, maxSteps?: number, priorApprovedAction?: string) =>
      ipcRenderer.invoke('operator:task:run', { sessionId, goal, maxSteps, priorApprovedAction }) as Promise<{
        ok:                 boolean;
        stepsExecuted:      number;
        outcome:            'completed' | 'max_steps_reached' | 'blocked' | 'error' | 'approval_pending';
        summary:            string;
        error?:             string;
        pendingApprovalId?: string;
        steps:              Array<{
          step:          number;
          executed:      boolean;
          outcome?:      string;
          verifyPassed?: boolean;
          approvalId?:   string;
          error?:        string;
        }>;
      }>,

    /** Listen for step-by-step progress events emitted during a task run. */
    onTaskProgress: (cb: (ev: {
      step:            number;
      phase:           string;
      description:     string;
      screenshotPath?: string;
    }) => void): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, ev: unknown) => cb(ev as any);
      ipcRenderer.on('operator:task:progress', handler);
      return () => ipcRenderer.removeListener('operator:task:progress', handler);
    },

    /**
     * Subscribe to live operator narration messages for display in Chat.
     * Each event is a human-readable sentence describing the current step.
     * Returns an unsubscribe function.
     */
    onNarration: (cb: (msg: {
      step:      number;
      phase:     string;
      message:   string;
      timestamp: number;
    }) => void): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, data: unknown) => cb(data as any);
      ipcRenderer.on('chat:operator-narration', handler);
      return () => ipcRenderer.removeListener('chat:operator-narration', handler);
    },

    /**
     * Listen for known apps coming to the foreground.
     * Fired by appForegroundWatcher when a registered app (e.g. Unreal Engine,
     * Photoshop, Blender) is detected as the frontmost window.
     * Returns an unsubscribe function.
     */
    onAppDetected: (cb: (ev: {
      appId:       string;
      appName:     string;
      category:    string;
      icon?:       string;
      packIds:     string[];
      suggestions: string[];
      detectedAt:  number;
    }) => void): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, ev: unknown) => cb(ev as any);
      ipcRenderer.on('operator:app:detected', handler);
      return () => ipcRenderer.removeListener('operator:app:detected', handler);
    },
  },

  // ── Section 9 — Workflow Packs ─────────────────────────────────────────────
  workflows: {
    /** List all available workflow packs. */
    list: () =>
      ipcRenderer.invoke('workflow:list') as Promise<{
        ok: boolean;
        packs?: Array<{
          id: string;
          name: string;
          tagline: string;
          description: string;
          category: string;
          version: string;
          requirements: {
            platforms: string[];
            capabilities: string[];
            permissions: { accessibility?: boolean; screenRecording?: boolean };
            targetApp: string | null;
            providerRequired: boolean;
          };
          phases: Array<{
            id: string; name: string; description: string;
            kind: string; requiresApproval: boolean; optional?: boolean;
          }>;
          tags: string[];
          estimatedDurationSec?: number;
          successCriteria: string;
        }>;
        error?: string;
      }>,

    /** Get a single workflow pack by ID. */
    get: (packId: string) =>
      ipcRenderer.invoke('workflow:get', packId) as Promise<{
        ok: boolean; pack?: Record<string, unknown>; error?: string;
      }>,

    /**
     * Evaluate readiness for a workflow pack.
     * Returns blockers with remediations if the pack cannot run.
     */
    readiness: (packId: string, targetApp?: string) =>
      ipcRenderer.invoke('workflow:readiness', packId, targetApp) as Promise<{
        ok: boolean;
        readiness?: {
          packId: string;
          ready: boolean;
          blockers: Array<{ type: string; message: string; remediation: string }>;
          warnings: string[];
          platformSupported: boolean;
          permissionsOk: boolean;
          capabilitiesOk: boolean;
          targetAppAvailable: boolean | null;
        };
        error?: string;
      }>,

    /** Evaluate readiness for all workflow packs at once. */
    readinessAll: () =>
      ipcRenderer.invoke('workflow:readiness:all') as Promise<{
        ok: boolean;
        results?: Record<string, {
          packId: string; ready: boolean;
          blockers: Array<{ type: string; message: string; remediation: string }>;
          warnings: string[]; platformSupported: boolean;
        }>;
        error?: string;
      }>,

    /**
     * Start a workflow run.
     * Runs that require approval pause with status 'awaiting_approval'.
     * Call advanceRun(runId) after approving to continue.
     */
    startRun: (
      packId: string,
      opts?: {
        targetApp?: string;
        inputText?: string;
        inputKey?: string;
        inputModifiers?: string[];
        screenshotOutputPath?: string;
        /**
         * Free-form goal text the workflow pack can use as steering input.
         * Consumed by packs like the Unreal scaffold/M1–M5 chain that adapt
         * their generated artifacts to the user's prototype description.
         */
        goal?: string;
      },
    ) =>
      ipcRenderer.invoke('workflow:run:start', packId, opts ?? {}) as Promise<{
        ok: boolean;
        run?: {
          id: string; packId: string; packName: string; sessionId: string;
          targetApp: string | null; startedAt: number; endedAt?: number;
          status: string; currentPhaseIndex: number;
          phaseResults: Array<{
            phaseId: string; phaseName: string; status: string;
            outputs: Record<string, unknown>; error?: string; warning?: string;
          }>;
          pendingApprovalId?: string;
          artifact?: { type: string; capturedAt: number; data: Record<string, unknown> };
          error?: string;
        };
        readinessBlockers?: Array<{ type: string; message: string; remediation: string }>;
        error?: string;
      }>,

    /**
     * Advance a workflow run paused at an approval gate.
     * Call after approving the pending operator approval.
     */
    advanceRun: (runId: string, opts?: Record<string, unknown>) =>
      ipcRenderer.invoke('workflow:run:advance', runId, opts ?? {}) as Promise<{
        ok: boolean;
        run?: Record<string, unknown>;
        error?: string;
      }>,

    /** List all workflow runs. */
    listRuns: () =>
      ipcRenderer.invoke('workflow:run:list') as Promise<{
        ok: boolean;
        runs?: Array<{
          id: string; packId: string; packName: string;
          targetApp: string | null; startedAt: number; endedAt?: number;
          status: string; currentPhaseIndex: number;
          pendingApprovalId?: string;
          artifact?: { type: string; capturedAt: number };
          error?: string;
        }>;
        error?: string;
      }>,

    /** Get a specific workflow run by ID. */
    getRun: (runId: string) =>
      ipcRenderer.invoke('workflow:run:get', runId) as Promise<{
        ok: boolean; run?: Record<string, unknown>; error?: string;
      }>,

    /** Stop an active workflow run. */
    stopRun: (runId: string) =>
      ipcRenderer.invoke('workflow:run:stop', runId) as Promise<{
        ok: boolean; error?: string;
      }>,
  },

  // ── Section 10 — Operator Safety Controls ─────────────────────────────────
  operatorSafety: {
    /** Disable all operator execution immediately (kill switch). */
    disable: () =>
      ipcRenderer.invoke('operator:safety:disable') as Promise<{
        ok: boolean; enabled: boolean; error?: string;
      }>,

    /** Re-enable operator execution. */
    enable: () =>
      ipcRenderer.invoke('operator:safety:enable') as Promise<{
        ok: boolean; enabled: boolean; error?: string;
      }>,

    /** Get the current operator enabled/disabled state. */
    getStatus: () =>
      ipcRenderer.invoke('operator:safety:status') as Promise<{
        ok: boolean; enabled: boolean; error?: string;
      }>,
  },

  // ── Unreal Hero Flow — proof-run pipeline from detection to success ────────
  unrealHeroFlow: {
    /** Run the full hero flow: detect → probe RC → focus → configure → verify. */
    run: (opts?: { projectTemplate?: string; projectName?: string; detectOnly?: boolean }) =>
      ipcRenderer.invoke('unreal:hero-flow:run', opts) as Promise<{
        ok: boolean; result?: unknown; error?: string;
      }>,

    /** Check if the hero flow is currently running. */
    getStatus: () =>
      ipcRenderer.invoke('unreal:hero-flow:status') as Promise<{
        ok: boolean; running: boolean; error?: string;
      }>,

    /** Get hybrid executor state (RC availability, control stats). */
    getHybridStatus: () =>
      ipcRenderer.invoke('unreal:hybrid:status') as Promise<{
        ok: boolean; rcAvailable?: boolean; rcSuccessCount?: number;
        visualFallbackCount?: number; error?: string;
      }>,

    /** Listen for progress events during the hero flow. */
    onProgress: (cb: (step: unknown) => void): (() => void) => {
      const handler = (_e: unknown, step: unknown) => cb(step);
      ipcRenderer.on('unreal:hero-flow:progress', handler);
      return () => ipcRenderer.removeListener('unreal:hero-flow:progress', handler);
    },
  },

  // ── Self-Improvement — TriForge analyses and patches its own code ─────────
  selfImprove: {
    /** Trigger a manual improvement run with a specific goal. */
    run: (goal: string) =>
      ipcRenderer.invoke('self-improve:run', { goal }) as Promise<{
        ok: boolean; result?: unknown; error?: string;
      }>,

    /** Run a proactive code health scan. */
    scan: () =>
      ipcRenderer.invoke('self-improve:scan') as Promise<{
        ok: boolean; result?: unknown; error?: string;
      }>,

    /** Get the improvement history log. */
    getHistory: () =>
      ipcRenderer.invoke('self-improve:history') as Promise<{
        ok: boolean; history?: unknown[]; error?: string;
      }>,

    /** Get self-improvement status (running, auto-enabled, stats). */
    getStatus: () =>
      ipcRenderer.invoke('self-improve:status') as Promise<{
        running: boolean; currentGoal?: string; autoEnabled: boolean;
        lastRunAt?: string; totalRuns: number; totalEdits: number;
      }>,

    /** Enable or disable auto-improvement after operator failures. */
    toggleAuto: (enabled: boolean) =>
      ipcRenderer.invoke('self-improve:auto-toggle', enabled) as Promise<{
        ok: boolean; autoEnabled: boolean;
      }>,
  },

  // ── Worker Runtime — durable run persistence (Phase 1) ────────────────────
  workerRuntime: {
    /**
     * List persisted WorkerRuns, most recent first.
     * Optional filter narrows by run status.
     */
    list: (filter?: { status?: string }) =>
      ipcRenderer.invoke('workerRun:list', filter) as Promise<{
        ok: boolean;
        runs?: Array<{
          id: string;
          goal: string;
          packId?: string;
          workflowId?: string;
          operatorSessionId?: string;
          source: 'chat' | 'operate' | 'session_resume' | 'webhook';
          status: string;
          machineId: string;
          createdAt: number;
          updatedAt: number;
          currentStepIndex: number;
          lastHeartbeatAt?: number;
          blocker?: { kind: string; message: string; recoverable: boolean };
          artifacts: string[];
          approvals: string[];
        }>;
        error?: string;
      }>,

    /**
     * Get a single WorkerRun by ID, including its steps and artifact refs.
     */
    get: (runId: string) =>
      ipcRenderer.invoke('workerRun:get', runId) as Promise<{
        ok: boolean;
        run?: {
          id: string;
          goal: string;
          packId?: string;
          workflowId?: string;
          source: string;
          status: string;
          machineId: string;
          createdAt: number;
          updatedAt: number;
          blocker?: { kind: string; message: string; recoverable: boolean };
          artifacts: string[];
        };
        steps?: Array<{
          id: string;
          runId: string;
          index: number;
          title: string;
          type: string;
          status: string;
          startedAt?: number;
          endedAt?: number;
          error?: string;
          artifactIds?: string[];
        }>;
        artifacts?: Array<{
          id: string;
          runId: string;
          stepId?: string;
          kind: string;
          path: string;
          createdAt: number;
          meta?: Record<string, unknown>;
        }>;
        error?: string;
      }>,

    /**
     * Return all runs that were in a non-terminal state at app startup.
     * Interrupted 'running' runs appear here as 'blocked'.
     */
    resumeCandidates: () =>
      ipcRenderer.invoke('workerRun:resumeCandidates') as Promise<{
        ok: boolean;
        runs?: Array<{
          id: string;
          goal: string;
          packId?: string;
          source: string;
          status: string;
          createdAt: number;
          updatedAt: number;
          blocker?: { kind: string; message: string; recoverable: boolean };
          artifacts: string[];
        }>;
        error?: string;
      }>,

    /**
     * Cancel a WorkerRun if it is in a non-terminal state.
     */
    cancel: (runId: string) =>
      ipcRenderer.invoke('workerRun:cancel', runId) as Promise<{
        ok: boolean;
        run?: { id: string; status: string };
        error?: string;
      }>,

    /**
     * Resume or recover a WorkerRun.
     *
     * Blocked/interrupted runs are restarted from saved workflow pack metadata.
     * If the run is waiting_approval and still live, failReason is
     * 'approval_live_use_panel' — direct the user to the approval panel.
     *
     * NOTE: Recovery is a restart from the beginning of the workflow pack,
     * not a seamless resume from the exact interruption point.
     */
    resume: (runId: string) =>
      ipcRenderer.invoke('workerRun:resume', runId) as Promise<{
        ok: boolean;
        kind?: 'restarted_from_metadata';
        failReason?: string;
        message: string;
      }>,
  },
  // ── Relay Client (Phase 7) ─────────────────────────────────────────────────
  relay: {
    register: (relayUrl: string, label?: string) =>
      ipcRenderer.invoke('relay:register', relayUrl, label) as Promise<{
        ok: boolean; deviceId?: string; deviceSecret?: string; error?: string;
      }>,
    connect: (creds: { deviceId: string; deviceSecret: string; relayUrl: string }) =>
      ipcRenderer.invoke('relay:connect', creds) as Promise<{ ok: boolean; error?: string }>,
    disconnect: () => ipcRenderer.invoke('relay:disconnect') as Promise<{ ok: boolean }>,
    status: () =>
      ipcRenderer.invoke('relay:status') as Promise<{
        connected: boolean; relayUrl: string | null; deviceId: string | null;
        lastPollAt?: number; lastJobAt?: number;
        jobsExecuted: number; jobsFailed: number; error?: string;
      }>,
    submitJob: (packId: string, opts?: Record<string, unknown>, label?: string) =>
      ipcRenderer.invoke('relay:submit-job', packId, opts, label) as Promise<{
        ok: boolean; jobId?: string; error?: string;
      }>,
    jobStatus: (jobId: string) =>
      ipcRenderer.invoke('relay:job-status', jobId) as Promise<{
        ok: boolean; job?: unknown; error?: string;
      }>,
    clear: () => ipcRenderer.invoke('relay:clear') as Promise<{ ok: boolean }>,
  },

  // ── On-Screen Keyboard (Phase 6) ──────────────────────────────────────────
  osk: {
    status: () =>
      ipcRenderer.invoke('osk:status') as Promise<{
        visible: boolean; type?: string; platform: string;
        recommendation: string;
      }>,
    open: () =>
      ipcRenderer.invoke('osk:open') as Promise<{ ok: boolean; method?: string; error?: string }>,
    close: () =>
      ipcRenderer.invoke('osk:close') as Promise<{ ok: boolean; error?: string }>,
  },

  // ── Vision Analyzer (Phase 6) ─────────────────────────────────────────────
  vision: {
    describe: (imagePath?: string) =>
      ipcRenderer.invoke('vision:describe', imagePath) as Promise<{
        ok: boolean; result?: unknown; error?: string;
      }>,
    locate: (elementDescription: string, imagePath?: string) =>
      ipcRenderer.invoke('vision:locate', elementDescription, imagePath) as Promise<{
        ok: boolean; found?: boolean; x?: number; y?: number;
        width?: number; height?: number; confidence?: number; error?: string;
      }>,
    ask: (question: string, imagePath?: string) =>
      ipcRenderer.invoke('vision:ask', question, imagePath) as Promise<{
        ok: boolean; answer?: string; error?: string;
      }>,
  },

  // ── Device Watcher (Phase 6) ──────────────────────────────────────────────
  devices: {
    list: () =>
      ipcRenderer.invoke('devices:list') as Promise<{
        ok: boolean;
        devices?: Array<{ id: string; name: string; type: string; connected: boolean }>;
        error?: string;
      }>,
    hasKeyboard: () =>
      ipcRenderer.invoke('devices:has-keyboard') as Promise<{ ok: boolean; has: boolean }>,
  },

  // ── Screen Watcher (Phase 6) ──────────────────────────────────────────────
  screenWatch: {
    start: (intervalMs?: number, threshold?: number) =>
      ipcRenderer.invoke('screen-watch:start', intervalMs, threshold) as Promise<{
        ok: boolean; error?: string;
      }>,
    stop: () =>
      ipcRenderer.invoke('screen-watch:stop') as Promise<{ ok: boolean }>,
    status: () =>
      ipcRenderer.invoke('screen-watch:status') as Promise<{
        ok: boolean; running?: boolean; lastChangedAt?: number; changeCount?: number; error?: string;
      }>,
    check: () =>
      ipcRenderer.invoke('screen-watch:check') as Promise<{
        ok: boolean; changed?: boolean; score?: number; description?: unknown; error?: string;
      }>,
    onChanged: (cb: (data: { score: number; imagePath?: string }) => void): (() => void) => {
      const h = (_: Electron.IpcRendererEvent, d: { score: number; imagePath?: string }) => cb(d);
      ipcRenderer.on('screen-watch:changed', h);
      return () => ipcRenderer.removeListener('screen-watch:changed', h);
    },
  },

  // ── Pack Builder (Phase 13) ────────────────────────────────────────────────
  packBuilder: {
    list: () =>
      ipcRenderer.invoke('pack-builder:list') as Promise<{ ok: boolean; packs?: unknown[]; error?: string }>,
    save: (pack: unknown) =>
      ipcRenderer.invoke('pack-builder:save', pack) as Promise<{ ok: boolean; error?: string }>,
    delete: (id: string) =>
      ipcRenderer.invoke('pack-builder:delete', id) as Promise<{ ok: boolean; error?: string }>,
    export: (id: string) =>
      ipcRenderer.invoke('pack-builder:export', id) as Promise<{ ok: boolean; path?: string; error?: string }>,
    import: () =>
      ipcRenderer.invoke('pack-builder:import') as Promise<{ ok: boolean; packId?: string; packName?: string; error?: string }>,
  },

  // ── Workflow Chains (Phase C1 — multi-app composition) ────────────────────
  workflowChain: {
    list: () =>
      ipcRenderer.invoke('workflow-chain:list') as Promise<{
        ok: boolean;
        chains?: Array<{
          id: string;
          name: string;
          tagline: string;
          description: string;
          links: Array<{
            packId: string;
            label: string;
            description: string;
          }>;
          estimatedDurationSec?: number;
          tags?: string[];
        }>;
        error?: string;
      }>,
    get: (chainId: string) =>
      ipcRenderer.invoke('workflow-chain:get', chainId) as Promise<{
        ok: boolean; chain?: unknown; error?: string;
      }>,
    start: (chainId: string, initialState?: Record<string, unknown>) =>
      ipcRenderer.invoke('workflow-chain:start', chainId, initialState ?? {}) as Promise<{
        ok: boolean;
        run?: {
          id: string;
          chainId: string;
          chainName: string;
          startedAt: number;
          status: string;
          currentLinkIndex: number;
          linkResults: Array<{
            linkIndex: number;
            packId: string;
            workflowRunId?: string;
            status: string;
            startedAt: number;
            endedAt?: number;
            error?: string;
          }>;
          state: Record<string, unknown>;
          error?: string;
        };
        error?: string;
      }>,
    advance: (chainRunId: string) =>
      ipcRenderer.invoke('workflow-chain:advance', chainRunId) as Promise<{
        ok: boolean; run?: unknown; error?: string;
      }>,
    listRuns: () =>
      ipcRenderer.invoke('workflow-chain:run:list') as Promise<{
        ok: boolean; runs?: unknown[]; error?: string;
      }>,
    getRun: (runId: string) =>
      ipcRenderer.invoke('workflow-chain:run:get', runId) as Promise<{
        ok: boolean; run?: unknown; error?: string;
      }>,
    cancelRun: (runId: string) =>
      ipcRenderer.invoke('workflow-chain:run:cancel', runId) as Promise<{
        ok: boolean; error?: string;
      }>,
  },

  // ── Project Memory ─────────────────────────────────────────────────────────
  projectMemory: {
    last: () =>
      ipcRenderer.invoke('project-memory:last') as Promise<{
        project: { projectPath: string; projectName: string; lastMilestone?: string; lastPackId?: string; prototypeGoal?: string; lastRunAt: string } | null;
        suggestion: string | null;
      }>,
    all: () =>
      ipcRenderer.invoke('project-memory:all') as Promise<Array<{
        projectPath: string; projectName: string; lastMilestone?: string; lastPackId?: string; prototypeGoal?: string; lastRunAt: string;
      }>>,
    forget: (projectPath: string) =>
      ipcRenderer.invoke('project-memory:forget', projectPath) as Promise<{ ok: boolean; error?: string }>,
  },

  // ── Pattern Memory (cross-session learning) ────────────────────────────────
  patternMemory: {
    list: () =>
      ipcRenderer.invoke('pattern-memory:list') as Promise<Array<{
        id: number; content: string; created_at: number;
      }>>,
    reset: () =>
      ipcRenderer.invoke('pattern-memory:reset') as Promise<{ ok: boolean }>,
  },
};

contextBridge.exposeInMainWorld('triforge', api);

// Type declaration for renderer TypeScript
export type TriforgeAPI = typeof api;
