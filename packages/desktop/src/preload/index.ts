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
    consensus: (message: string, history: Array<{ role: string; content: string }>) =>
      ipcRenderer.invoke('chat:consensus', message, history) as Promise<{
        responses?: Array<{ provider: string; text: string }>;
        synthesis?: string;
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
    transcribe: (audioBuffer: Buffer) =>
      ipcRenderer.invoke('voice:transcribe', audioBuffer) as Promise<{ text?: string; error?: string }>,
    speak: (text: string) =>
      ipcRenderer.invoke('voice:speak', text) as Promise<{ audio?: string; error?: string }>,
  },

  // Memory
  memory: {
    get: () => ipcRenderer.invoke('memory:get') as Promise<Array<{ id: number; type: string; content: string; created_at: number }>>,
    add: (type: string, content: string) => ipcRenderer.invoke('memory:add', type, content),
    delete: (id: number) => ipcRenderer.invoke('memory:delete', id) as Promise<Array<{ id: number; type: string; content: string; created_at: number }>>,
  },

  // User profile
  profile: {
    get: () => ipcRenderer.invoke('profile:get') as Promise<Record<string, string>>,
    set: (profile: Record<string, string>) => ipcRenderer.invoke('profile:set', profile),
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
    commonDirs:   () => ipcRenderer.invoke('files:commonDirs') as Promise<Record<string, string>>,
    listDir:      (dirPath: string) => ipcRenderer.invoke('files:listDir', dirPath) as Promise<{ files: Array<{ name: string; path: string; size: number; modified: string; extension: string }>; subdirs: string[]; error?: string }>,
    scanPhotos:   (startPath?: string) => ipcRenderer.invoke('files:scanPhotos', startPath) as Promise<{ photos: Array<{ name: string; path: string; size: number; modified: string; extension: string }>; error?: string }>,
    organize:     (dirPath: string) => ipcRenderer.invoke('files:organize', dirPath) as Promise<{ moved: number; folders: string[]; errors: string[] }>,
    openFile:     (filePath: string) => ipcRenderer.invoke('files:openFile', filePath),
    showInFolder: (filePath: string) => ipcRenderer.invoke('files:showInFolder', filePath),
    pickFile:     (filters?: Array<{ name: string; extensions: string[] }>) => ipcRenderer.invoke('files:pickFile', filters) as Promise<string | null>,
    pickDir:      () => ipcRenderer.invoke('files:pickDir') as Promise<string | null>,
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
