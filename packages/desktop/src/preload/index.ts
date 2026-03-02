import { contextBridge, ipcRenderer } from 'electron';

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
    consensus: (message: string, history: Array<{ role: string; content: string }>, intensity?: string) =>
      ipcRenderer.invoke('chat:consensus', message, history, intensity) as Promise<{
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
      ipcRenderer.invoke('voice:speak', text) as Promise<{ audio?: string; error?: string }>,
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

  // Forge Engine (Business Engine Mode — Phase 1)
  forgeEngine: {
    run: (profileType: string, answers: Record<string, string>) =>
      ipcRenderer.invoke('forgeEngine:run', { profileType, answers }) as Promise<{
        blueprint?: Record<string, string>;
        assets?: Array<{ type: string; body: string }>;
        buildOutput?: Record<string, string[]>;
        error?: string;
      }>,
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
      ipcRenderer.invoke('approvals:approve', approvalId) as Promise<{ ok?: boolean; error?: string }>,
    deny: (approvalId: string, reason?: string) =>
      ipcRenderer.invoke('approvals:deny', approvalId, reason) as Promise<{ ok?: boolean; error?: string }>,
  },

  // Task pause / resume (Phase 3.5)
  agentTask: {
    pause: (taskId: string) =>
      ipcRenderer.invoke('task:pause', taskId) as Promise<{ ok?: boolean; error?: string }>,
    resume: (taskId: string) =>
      ipcRenderer.invoke('task:resume', taskId) as Promise<{ ok?: boolean; error?: string }>,
  },

  // System
  system: {
    openExternal: (url: string) => ipcRenderer.invoke('system:openExternal', url),
    platform: process.platform,
  },

  // License & subscription
  license: {
    load:        () => ipcRenderer.invoke('license:load') as Promise<{ tier: string; valid: boolean; key: string | null; email: string | null; expiresAt: string | null; error: string | null }>,
    activate:    (key: string) => ipcRenderer.invoke('license:activate', key) as Promise<{ tier: string; valid: boolean; key: string | null; email: string | null; error: string | null }>,
    deactivate:  () => ipcRenderer.invoke('license:deactivate') as Promise<void>,
    tiers:       () => ipcRenderer.invoke('license:tiers') as Promise<unknown>,
    checkoutUrls:() => ipcRenderer.invoke('license:checkoutUrls') as Promise<{ pro: string; business: string; portal: string }>,
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

  // Forge Chamber — real-time consensus telemetry
  forge: {
    onUpdate: (cb: (data: { phase: string; provider?: string; completedCount?: number; total?: number; from?: string; to?: string; reason?: string }) => void): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, data: { phase: string; provider?: string; completedCount?: number; total?: number; from?: string; to?: string; reason?: string }) => cb(data);
      ipcRenderer.on('forge:update', handler);
      return () => ipcRenderer.removeListener('forge:update', handler);
    },
  },

  // Auto-updater
  updater: {
    check:   () => ipcRenderer.invoke('updater:check') as Promise<void>,
    install: () => ipcRenderer.invoke('updater:install') as Promise<void>,
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
};

contextBridge.exposeInMainWorld('triforge', api);

// Type declaration for renderer TypeScript
export type TriforgeAPI = typeof api;
