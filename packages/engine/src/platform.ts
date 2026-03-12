/**
 * StorageAdapter — platform-agnostic storage interface.
 *
 * VS Code implementation: wraps context.globalState + context.secrets
 * Desktop implementation: wraps electron-store + OS keychain (or plain JSON file)
 */
export interface StorageAdapter {
  /** Read a value from persistent key-value store. */
  get<T>(key: string, defaultValue: T): T;
  /** Write a value to persistent key-value store. */
  update(key: string, value: unknown): void | Promise<void>;

  /** Store a secret (encrypted at rest). */
  storeSecret(key: string, value: string): Promise<void>;
  /** Retrieve a secret, or undefined if not set. */
  getSecret(key: string): Promise<string | undefined>;
  /** Delete a secret. */
  deleteSecret(key: string): Promise<void>;
}
