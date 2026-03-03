import { StorageAdapter } from '../platform';
import { AIProvider, AIProviderConfig } from './providers/provider';
import { OpenAIProvider } from './providers/openai';
import { GrokProvider } from './providers/grok';
import { ClaudeProvider } from './providers/claude';
import { ProviderName, OperatingMode, ProviderStatus, ModeInfo, SessionRecord } from '../protocol';
import { DecisionLog } from './decisionLog';
import { Memory } from './memory';

const SECRET_KEYS: Record<ProviderName, string> = {
  openai: 'triforge.openai.apiKey',
  grok:   'triforge.grok.apiKey',
  claude: 'triforge.claude.apiKey',
};

const PROVIDER_LABELS: Record<ProviderName, string> = {
  openai: 'OpenAI',
  grok:   'Grok',
  claude: 'Claude',
};

/**
 * ProviderManager: key storage, provider lifecycle, mode detection,
 * session history, decision log, and project memory.
 *
 * Platform-agnostic: all persistence goes through StorageAdapter.
 * Model config is passed in via getModelConfig() — callers supply it from
 * their platform's settings system (VS Code workspace config, JSON file, etc.).
 */
export class ProviderManager {
  private _storage: StorageAdapter;
  private _providers: Map<ProviderName, AIProvider> = new Map();
  private _statusListeners: Array<(modeInfo: ModeInfo) => void> = [];
  private _decisionLog: DecisionLog;
  private _memory: Memory;
  /** Optional: returns per-provider model override. Injected by the platform. */
  private _getModelConfig: (name: ProviderName) => string | undefined;
  /** Preferred provider order set by active profession profile. Empty = default order. */
  private _preferredProviders: ProviderName[] = [];

  constructor(
    storage: StorageAdapter,
    getModelConfig: (name: ProviderName) => string | undefined = () => undefined
  ) {
    this._storage = storage;
    this._getModelConfig = getModelConfig;
    this._decisionLog = new DecisionLog(storage);
    this._memory = new Memory(storage);
  }

  // --- Status change listeners ---

  onDidChangeStatus(listener: (modeInfo: ModeInfo) => void): void {
    this._statusListeners.push(listener);
  }

  private async _fireStatusChange(): Promise<void> {
    const mode = await this.detectMode();
    for (const fn of this._statusListeners) { fn(mode); }
  }

  // --- Key Management ---

  async setKey(name: ProviderName, apiKey: string): Promise<void> {
    await this._storage.storeSecret(SECRET_KEYS[name], apiKey);
    this._providers.delete(name);
    this._fireStatusChange();
  }

  async removeKey(name: ProviderName): Promise<void> {
    await this._storage.deleteSecret(SECRET_KEYS[name]);
    this._providers.delete(name);
    this._fireStatusChange();
  }

  async hasKey(name: ProviderName): Promise<boolean> {
    const key = await this._storage.getSecret(SECRET_KEYS[name]);
    return !!key;
  }

  // --- Provider Lifecycle ---

  async getProvider(name: ProviderName): Promise<AIProvider | null> {
    if (this._providers.has(name)) {
      return this._providers.get(name)!;
    }
    const apiKey = await this._storage.getSecret(SECRET_KEYS[name]);
    if (!apiKey) { return null; }
    const config = this._buildConfig(name, apiKey);
    const provider = this._instantiate(name, config);
    this._providers.set(name, provider);
    return provider;
  }

  // Set preferred provider order for the current session (driven by active profession).
  // Preferred providers are listed first; others follow in default order.
  setPreferredProviders(names: ProviderName[]): void {
    this._preferredProviders = names.filter(n => ['openai', 'grok', 'claude'].includes(n));
    this._fireStatusChange();
  }

  getPreferredProviders(): ProviderName[] {
    return [...this._preferredProviders];
  }

  async getActiveProviders(): Promise<AIProvider[]> {
    const defaultOrder: ProviderName[] = ['openai', 'grok', 'claude'];
    // Build sorted order: preferred first, then remaining defaults
    const ordered: ProviderName[] = [
      ...this._preferredProviders.filter(n => defaultOrder.includes(n)),
      ...defaultOrder.filter(n => !this._preferredProviders.includes(n)),
    ];
    const providers: AIProvider[] = [];
    for (const name of ordered) {
      const provider = await this.getProvider(name);
      if (provider) { providers.push(provider); }
    }
    return providers;
  }

  private _buildConfig(name: ProviderName, apiKey: string): AIProviderConfig {
    return { apiKey, model: this._getModelConfig(name) };
  }

  private _instantiate(name: ProviderName, config: AIProviderConfig): AIProvider {
    switch (name) {
      case 'openai': return new OpenAIProvider(config);
      case 'grok': return new GrokProvider(config);
      case 'claude': return new ClaudeProvider(config);
    }
  }

  // --- Mode Detection ---

  async detectMode(): Promise<ModeInfo> {
    const available: ProviderName[] = [];
    const names: ProviderName[] = ['openai', 'grok', 'claude'];
    for (const name of names) {
      if (await this.hasKey(name)) { available.push(name); }
    }

    let mode: OperatingMode;
    let recommended: string;

    switch (available.length) {
      case 0:
        mode = 'none';
        recommended = 'Add at least one API key to get started.';
        break;
      case 1:
        mode = 'single';
        recommended = `Single Model Chat with ${PROVIDER_LABELS[available[0]]}.`;
        break;
      case 2:
        mode = 'pair';
        recommended = `Pair Review with ${PROVIDER_LABELS[available[0]]} + ${PROVIDER_LABELS[available[1]]}.`;
        break;
      default:
        mode = 'consensus';
        recommended = 'Full TriForge Consensus — all three AIs collaborate.';
        break;
    }

    return { mode, available, recommended };
  }

  async getStatus(): Promise<ProviderStatus[]> {
    const names: ProviderName[] = ['openai', 'grok', 'claude'];
    const statuses: ProviderStatus[] = [];
    for (const name of names) {
      statuses.push({
        name,
        connected: await this.hasKey(name),
        model: this._getModelConfig(name) || '(default)',
      });
    }
    return statuses;
  }

  // --- Session History ---

  private static readonly SESSION_KEY = 'triforge.sessions';

  saveSessions(sessions: SessionRecord[]): void {
    this._storage.update(ProviderManager.SESSION_KEY, sessions);
  }

  loadSessions(): SessionRecord[] {
    return this._storage.get<SessionRecord[]>(ProviderManager.SESSION_KEY, []);
  }

  // --- Decision Log ---

  getDecisionLog(): DecisionLog {
    return this._decisionLog;
  }

  // --- Memory ---

  getMemory(): Memory {
    return this._memory;
  }

  dispose(): void {
    this._providers.clear();
    this._statusListeners = [];
  }
}
