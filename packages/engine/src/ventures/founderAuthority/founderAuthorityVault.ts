// ── founderAuthorityVault.ts — Persistent founder profile storage ────────────
//
// Stores reusable founder data (legal name, address, entity preferences, etc.)
// so the Council never re-asks for data it already has.
// Persists via StorageAdapter (same pattern as other engines).

import type { FounderProfile } from '../ventureTypes';
import type { StorageAdapter } from '../../platform';

const VAULT_KEY = 'venture_founder_profile';

export class FounderAuthorityVault {
  private profile: FounderProfile = {};
  private storage: StorageAdapter;
  private loaded = false;

  constructor(storage: StorageAdapter) {
    this.storage = storage;
  }

  /** Load profile from persistent storage. Idempotent. */
  async load(): Promise<void> {
    if (this.loaded) return;
    try {
      const raw = this.storage.get<FounderProfile>(VAULT_KEY, {} as FounderProfile);
      if (raw && typeof raw === 'object') {
        this.profile = raw;
      }
    } catch {
      // Start with empty profile
    }
    this.loaded = true;
  }

  /** Get the current founder profile. */
  getProfile(): FounderProfile {
    return { ...this.profile };
  }

  /** Update specific fields on the founder profile. Never overwrites existing fields unless explicitly set. */
  async updateProfile(updates: Partial<FounderProfile>): Promise<void> {
    // Merge — only overwrite fields that are explicitly provided
    for (const [key, value] of Object.entries(updates)) {
      if (value !== undefined && value !== null) {
        (this.profile as Record<string, unknown>)[key] = value;
      }
    }
    await this.persist();
  }

  /** Check if a specific field is already stored. */
  hasField(field: keyof FounderProfile): boolean {
    const val = this.profile[field];
    return val !== undefined && val !== null && val !== '';
  }

  /** Get the list of fields that are still missing. */
  getMissingFields(): (keyof FounderProfile)[] {
    const required: (keyof FounderProfile)[] = [
      'legalName', 'address', 'state', 'phone', 'email',
    ];
    return required.filter(f => !this.hasField(f));
  }

  /** Check if the profile has enough data for filing preparation. */
  isFilingReady(): boolean {
    return this.getMissingFields().length === 0;
  }

  /** Clear all stored data. */
  async clear(): Promise<void> {
    this.profile = {};
    await this.persist();
  }

  private async persist(): Promise<void> {
    try {
      await this.storage.update(VAULT_KEY, this.profile);
    } catch {
      // Silent fail — vault is best-effort persistence
    }
  }
}
