import * as vscode from 'vscode';
import { StorageAdapter } from '@triforge/engine';

/**
 * VSCodeStorageAdapter — wraps VS Code's globalState (Memento) and SecretStorage
 * to implement the platform-agnostic StorageAdapter interface.
 */
export class VSCodeStorageAdapter implements StorageAdapter {
  constructor(
    private _secrets: vscode.SecretStorage,
    private _state: vscode.Memento
  ) {}

  get<T>(key: string, defaultValue: T): T {
    return this._state.get<T>(key, defaultValue);
  }

  async update(key: string, value: unknown): Promise<void> {
    await this._state.update(key, value);
  }

  async storeSecret(key: string, value: string): Promise<void> {
    await this._secrets.store(key, value);
  }

  async getSecret(key: string): Promise<string | undefined> {
    return this._secrets.get(key);
  }

  async deleteSecret(key: string): Promise<void> {
    await this._secrets.delete(key);
  }
}
