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
    consensus: (message: string, history: Array<{ role: string; content: string }>) =>
      ipcRenderer.invoke('chat:consensus', message, history) as Promise<{
        responses?: Array<{ provider: string; text: string }>;
        synthesis?: string;
        forgeScore?: { confidence: number; agreement: string; disagreement: string; risk: 'Low'|'Medium'|'High'; assumptions: string; verify: string };
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

  // Forge Chamber — real-time consensus telemetry
  forge: {
    onUpdate: (cb: (data: { phase: string; provider?: string; completedCount?: number; total?: number }) => void): (() => void) => {
      const handler = (_: Electron.IpcRendererEvent, data: { phase: string; provider?: string; completedCount?: number; total?: number }) => cb(data);
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
};

contextBridge.exposeInMainWorld('triforge', api);

// Type declaration for renderer TypeScript
export type TriforgeAPI = typeof api;
