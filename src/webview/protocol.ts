/**
 * Shared message protocol between the extension host and webview.
 */

export type ProviderName = 'openai' | 'qwen' | 'claude';
export type OperatingMode = 'none' | 'single' | 'pair' | 'consensus';

export interface ProviderStatus {
  name: ProviderName;
  connected: boolean;
  model: string;
}

export interface ModeInfo {
  mode: OperatingMode;
  available: ProviderName[];
  recommended: string;
}

export interface FileStatusInfo {
  filePath: string;
  status: string;
  approvals: number;
  total: number;
  round: number;
  maxRounds: number;
}

// --- Messages: Webview -> Extension Host ---

export type WebviewMessage =
  | { command: 'log'; text: string }
  | { command: 'action'; action: string }
  | { command: 'sendMessage'; text: string }
  | { command: 'requestContext' }
  | { command: 'getProviderStatus' }
  | { command: 'setApiKey'; provider: ProviderName; key: string }
  | { command: 'removeApiKey'; provider: ProviderName }
  | { command: 'setMode'; mode: 'guided' | 'professional' }
  | { command: 'cancelRequest' }
  | { command: 'approvePatches'; token: string }
  | { command: 'rejectPatches'; token: string }
  // Command preview/execution
  | { command: 'suggestCommand'; cmd: string; cwd?: string; explanation?: string; risk?: 'low' | 'medium' | 'high' }
  | { command: 'runCommand'; token: string }
  | { command: 'cancelCommandPreview'; token: string }
  // Search & open
  | { command: 'searchRepo'; query: string }
  | { command: 'openFile'; path: string; line?: number }
  // Debug workflow
  | { command: 'startDebugSession'; errorLog?: string }
  | { command: 'debugAction'; sessionId: string; action: string; payload?: any }
  // Precision edits
  | { command: 'createLineEdit'; file: string; startLine: number; endLine: number; newContent: string; reason?: string }
  | { command: 'continueDebate' }
  | { command: 'acceptMajority' }
  | { command: 'exportDebate' }
  | { command: 'openExternal'; url: string }
  ;

// --- Messages: Extension Host -> Webview ---

export type ExtensionMessage =
  | { command: 'addMessage'; text: string; provider?: ProviderName }
  | { command: 'contextPreview'; preview: string }
  | { command: 'insertPrompt'; prompt: string }
  | { command: 'providerStatus'; providers: ProviderStatus[]; mode: ModeInfo }
  | { command: 'requestStarted'; mode: OperatingMode }
  | { command: 'requestError'; error: string; provider?: ProviderName }
  | { command: 'modeChanged'; mode: 'guided' | 'professional' }
  | { command: 'debateProgress'; message: string; fileStatuses: FileStatusInfo[] }
  | { command: 'debateLog'; provider: ProviderName; role: string; filePath: string; round: number; text: string }
  | { command: 'patchPreview'; patches: { relativePath: string; type: string; diff: string }[]; summary: string; token: string; hasDisagreements: boolean; disagreementReport?: string }
  | { command: 'patchResult'; applied: string[]; rejected: boolean }
  // Command preview/result
  | { command: 'commandPreview'; token: string; cmd: string; cwd: string; explanation?: string; risk: 'low' | 'medium' | 'high' }
  | { command: 'commandResult'; token: string; cmd: string; cwd: string; success: boolean; message?: string }
  // Search results
  | { command: 'searchResults'; results: { file: string; relativePath: string; snippet: string }[] }
  // Debug session updates
  | { command: 'debugUpdate'; sessionId: string; update: any }
  // Line edit preview
  | { command: 'lineEditPreview'; preview: { relativePath: string; diff: string; startLine?: number; endLine?: number }; token: string }
  | { command: 'requestComplete' }
  ;
