import * as vscode from 'vscode';
import { AIProvider, AIProviderConfig } from './providers/provider';
import { OpenAIProvider } from './providers/openai';
import { QwenProvider } from './providers/qwen';
import { ClaudeProvider } from './providers/claude';
import { ProviderName, OperatingMode, ProviderStatus, ModeInfo } from '../webview/protocol';

const SECRET_KEYS: Record<ProviderName, string> = {
  openai: 'triforge.openai.apiKey',
  qwen: 'triforge.qwen.apiKey',
  claude: 'triforge.claude.apiKey',
};

const PROVIDER_LABELS: Record<ProviderName, string> = {
  openai: 'OpenAI',
  qwen: 'Qwen',
  claude: 'Claude',
};

/**
 * ProviderManager: key storage, provider lifecycle, and mode detection.
 * Bridges SecretStorage + VS Code settings to produce ready-to-use AIProvider instances.
 */
export class ProviderManager {
  private _secrets: vscode.SecretStorage;
  private _globalState: vscode.Memento;
  private _providers: Map<ProviderName, AIProvider> = new Map();
  private _onDidChangeStatus = new vscode.EventEmitter<ModeInfo>();

  readonly onDidChangeStatus: vscode.Event<ModeInfo> = this._onDidChangeStatus.event;

  constructor(secrets: vscode.SecretStorage, globalState: vscode.Memento) {
    this._secrets = secrets;
    this._globalState = globalState;
  }

  // --- Key Management ---

  async setKey(name: ProviderName, apiKey: string): Promise<void> {
    await this._secrets.store(SECRET_KEYS[name], apiKey);
    // Invalidate cached provider so it gets re-created with the new key
    this._providers.delete(name);
    this._fireStatusChange();
  }

  async removeKey(name: ProviderName): Promise<void> {
    await this._secrets.delete(SECRET_KEYS[name]);
    this._providers.delete(name);
    this._fireStatusChange();
  }

  async hasKey(name: ProviderName): Promise<boolean> {
    const key = await this._secrets.get(SECRET_KEYS[name]);
    return !!key;
  }

  // --- Provider Lifecycle ---

  async getProvider(name: ProviderName): Promise<AIProvider | null> {
    if (this._providers.has(name)) {
      return this._providers.get(name)!;
    }

    const apiKey = await this._secrets.get(SECRET_KEYS[name]);
    if (!apiKey) {
      return null;
    }

    const config = this._buildConfig(name, apiKey);
    const provider = this._instantiate(name, config);
    this._providers.set(name, provider);
    return provider;
  }

  async getActiveProviders(): Promise<AIProvider[]> {
    const names: ProviderName[] = ['openai', 'qwen', 'claude'];
    const providers: AIProvider[] = [];

    for (const name of names) {
      const provider = await this.getProvider(name);
      if (provider) {
        providers.push(provider);
      }
    }

    return providers;
  }

  private _buildConfig(name: ProviderName, apiKey: string): AIProviderConfig {
    const settings = vscode.workspace.getConfiguration('triforgeAi');
    const model = settings.get<string>(`${name}.model`) || undefined;
    return { apiKey, model };
  }

  private _instantiate(name: ProviderName, config: AIProviderConfig): AIProvider {
    switch (name) {
      case 'openai': return new OpenAIProvider(config);
      case 'qwen': return new QwenProvider(config);
      case 'claude': return new ClaudeProvider(config);
    }
  }

  // --- Mode Detection ---

  async detectMode(): Promise<ModeInfo> {
    const available: ProviderName[] = [];
    const names: ProviderName[] = ['openai', 'qwen', 'claude'];

    for (const name of names) {
      if (await this.hasKey(name)) {
        available.push(name);
      }
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
    const names: ProviderName[] = ['openai', 'qwen', 'claude'];
    const statuses: ProviderStatus[] = [];
    const settings = vscode.workspace.getConfiguration('triforgeAi');

    for (const name of names) {
      statuses.push({
        name,
        connected: await this.hasKey(name),
        model: settings.get<string>(`${name}.model`) || '(default)',
      });
    }

    return statuses;
  }

  // --- Events ---

  private async _fireStatusChange(): Promise<void> {
    const mode = await this.detectMode();
    this._onDidChangeStatus.fire(mode);
  }

  dispose(): void {
    this._providers.clear();
    this._onDidChangeStatus.dispose();
  }
}
