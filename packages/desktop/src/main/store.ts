import fs from 'fs';
import path from 'path';
import { app, safeStorage } from 'electron';
import type { StorageAdapter } from '@triforge/engine';

export interface Permission {
  key: string;
  label: string;
  description: string;
  category: 'system' | 'communication' | 'finance' | 'business';
  granted: boolean;
  budgetLimit?: number;
  requireConfirm: boolean;
}

export const DEFAULT_PERMISSIONS: Permission[] = [
  { key: 'files',     label: 'Files & Folders',      description: 'Read and write files on your computer',       category: 'system',        granted: false, requireConfirm: false },
  { key: 'terminal',  label: 'Terminal / Commands',   description: 'Run commands and scripts on your behalf',      category: 'system',        granted: false, requireConfirm: true  },
  { key: 'browser',   label: 'Browser Automation',    description: 'Open and control web browsers for you',        category: 'system',        granted: false, requireConfirm: true  },
  { key: 'printer',   label: 'Printer',               description: 'Print documents on your behalf',               category: 'system',        granted: false, requireConfirm: true  },
  { key: 'email_r',   label: 'Email — Read',          description: 'Read your emails to provide context',          category: 'communication', granted: false, requireConfirm: false },
  { key: 'email_s',   label: 'Email — Send',          description: 'Draft and send emails on your behalf',         category: 'communication', granted: false, requireConfirm: true  },
  { key: 'calendar',  label: 'Calendar',              description: 'Read and create calendar events',              category: 'communication', granted: false, requireConfirm: true  },
  { key: 'contacts',  label: 'Contacts',              description: 'Access and update your contacts',              category: 'communication', granted: false, requireConfirm: false },
  { key: 'crm',       label: 'CRM / Lead Management', description: 'Create leads, contacts, and business records', category: 'business',      granted: false, requireConfirm: false },
  { key: 'finance_r', label: 'Finance — View',        description: 'Read your portfolio and account balances',     category: 'finance',       granted: false, requireConfirm: false },
  { key: 'finance_t', label: 'Finance — Trade',       description: 'Propose and execute investment trades',        category: 'finance',       granted: false, requireConfirm: true, budgetLimit: 0 },
];

export interface StoredLicense {
  key: string | null;
  tier: string;
  valid: boolean;
  email: string | null;
  expiresAt: string | null;
  activatedAt: string | null;
  lastChecked: string | null;
}

export interface StoredAuth {
  username: string | null;
  pinHash: string | null;
  salt: string | null;
}

interface StoreData {
  kv: Record<string, string>;
  secrets: Record<string, string>;
  permissions: Record<string, { granted: boolean; budgetLimit?: number; requireConfirm: boolean }>;
  memory: Array<{ id: number; type: string; content: string; created_at: number; source?: string }>;
  firstRunDone: boolean;
  activeProfileId: string | null;
  userProfile: Record<string, string>;
  nextMemoryId: number;
  license: StoredLicense;
  // message usage: key = "YYYY-MM" → count
  messageUsage: Record<string, number>;
  auth: StoredAuth;
  ledger: LedgerEntry[];
}

function emptyData(): StoreData {
  const perms: StoreData['permissions'] = {};
  for (const p of DEFAULT_PERMISSIONS) {
    perms[p.key] = { granted: false, budgetLimit: p.budgetLimit, requireConfirm: p.requireConfirm };
  }
  return {
    kv: {}, secrets: {}, permissions: perms, memory: [],
    firstRunDone: false, userProfile: {}, nextMemoryId: 1,
    license: { key: null, tier: 'free', valid: false, email: null, expiresAt: null, activatedAt: null, lastChecked: null },
    messageUsage: {},
    auth: { username: null, pinHash: null, salt: null },
    ledger: [],
    activeProfileId: null,
  };
}

export interface ForgeScore {
  confidence: number;
  agreement: string;
  disagreement: string;
  risk: 'Low' | 'Medium' | 'High';
  assumptions: string;
  verify: string;
}

export interface LedgerEntry {
  id: string;
  timestamp: number;
  request: string;
  synthesis: string;
  forgeScore?: ForgeScore;
  responses?: Array<{ provider: string; text: string }>;
  workflow?: string;
  starred: boolean;
}

// ── Basic schema validation ───────────────────────────────────────────────────
// Guards against corrupted JSON loading invalid types into critical fields.
function isValidStoreData(d: unknown): d is Partial<StoreData> {
  if (!d || typeof d !== 'object') return false;
  const o = d as Record<string, unknown>;
  if (o.kv !== undefined && typeof o.kv !== 'object') return false;
  if (o.secrets !== undefined && typeof o.secrets !== 'object') return false;
  if (o.memory !== undefined && !Array.isArray(o.memory)) return false;
  if (o.ledger !== undefined && !Array.isArray(o.ledger)) return false;
  if (o.license !== undefined && typeof o.license !== 'object') return false;
  if (o.auth !== undefined && typeof o.auth !== 'object') return false;
  if (o.firstRunDone !== undefined && typeof o.firstRunDone !== 'boolean') return false;
  return true;
}

export class Store implements StorageAdapter {
  private filePath: string;
  private data: StoreData;
  // Serialise all writes through a promise chain to prevent concurrent clobber
  private writeQueue: Promise<void> = Promise.resolve();

  constructor() {
    this.filePath = path.join(app.getPath('userData'), 'triforge-store.json');
    this.data = emptyData();
  }

  async init(): Promise<void> {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        const parsed = JSON.parse(raw);
        if (!isValidStoreData(parsed)) {
          throw new Error('Store schema validation failed');
        }
        const loaded = parsed as Partial<StoreData>;
        this.data = { ...emptyData(), ...loaded };
        // Merge any new default permissions added in updates
        for (const p of DEFAULT_PERMISSIONS) {
          if (!this.data.permissions[p.key]) {
            this.data.permissions[p.key] = { granted: false, budgetLimit: p.budgetLimit, requireConfirm: p.requireConfirm };
          }
        }
        // Migrate any plaintext secrets to safeStorage encryption
        if (safeStorage.isEncryptionAvailable()) {
          let migrated = false;
          for (const [k, v] of Object.entries(this.data.secrets)) {
            if (!v.startsWith('enc:')) {
              this.data.secrets[k] = this.encryptSecret(v);
              migrated = true;
            }
          }
          if (migrated) this.save();
        }
      }
    } catch (e) {
      console.error('[Store] init failed, resetting to defaults:', e);
      // Back up the corrupted file before resetting
      try {
        if (fs.existsSync(this.filePath)) {
          const stamp = Date.now();
          fs.copyFileSync(this.filePath, this.filePath + `.bak.${stamp}`);
        }
      } catch { /* best effort */ }
      this.data = emptyData();
    }
  }

  private save(): void {
    // Enqueue the write so concurrent callers never interleave
    this.writeQueue = this.writeQueue.then(() => {
      try {
        const dir = path.dirname(this.filePath);
        fs.mkdirSync(dir, { recursive: true });
        // Atomic write: write to .tmp then rename so a crash mid-save never corrupts the store
        const tmp = this.filePath + '.tmp';
        fs.writeFileSync(tmp, JSON.stringify(this.data, null, 2), 'utf8');
        fs.renameSync(tmp, this.filePath);
      } catch (e) {
        console.error('[Store] save error:', e);
      }
    });
  }

  // Encrypt a value with the OS keychain (safeStorage). Falls back to plaintext
  // on platforms where encryption is unavailable. Encrypted values are prefixed
  // with 'enc:' so we can detect them on read and handle migration gracefully.
  private encryptSecret(value: string): string {
    if (safeStorage.isEncryptionAvailable()) {
      try { return 'enc:' + safeStorage.encryptString(value).toString('base64'); } catch { /* fall through */ }
    }
    return value;
  }

  private decryptSecret(raw: string): string {
    if (raw.startsWith('enc:')) {
      try { return safeStorage.decryptString(Buffer.from(raw.slice(4), 'base64')); } catch { return ''; }
    }
    return raw; // plaintext (pre-encryption or safeStorage unavailable)
  }

  // StorageAdapter interface
  async getSecret(key: string): Promise<string | undefined> {
    const raw = this.data.secrets[key];
    if (raw === undefined) return undefined;
    return this.decryptSecret(raw);
  }
  async setSecret(key: string, value: string): Promise<void> { this.data.secrets[key] = this.encryptSecret(value); this.save(); }
  async storeSecret(key: string, value: string): Promise<void> { return this.setSecret(key, value); }
  async deleteSecret(key: string): Promise<void> { delete this.data.secrets[key]; this.save(); }
  // Sync generic get with default — used by ProviderManager for session history
  get<T>(key: string, defaultValue: T): T {
    const raw = this.data.kv[key];
    if (raw === undefined) return defaultValue;
    try { return JSON.parse(raw) as T; } catch { return defaultValue; }
  }
  // Sync update — used by ProviderManager.saveSessions()
  update(key: string, value: unknown): void { this.data.kv[key] = JSON.stringify(value); this.save(); }

  getPermissions(): Permission[] {
    return DEFAULT_PERMISSIONS.map(p => ({ ...p, ...this.data.permissions[p.key] }));
  }

  setPermission(key: string, granted: boolean, budgetLimit?: number): void {
    if (!this.data.permissions[key]) return;
    this.data.permissions[key].granted = granted;
    if (budgetLimit !== undefined) this.data.permissions[key].budgetLimit = budgetLimit;
    this.save();
  }

  isFirstRun(): boolean { return !this.data.firstRunDone; }
  markFirstRunDone(): void { this.data.firstRunDone = true; this.save(); }

  getUserProfile(): Record<string, string> { return this.data.userProfile; }
  setUserProfile(profile: Record<string, string>): void { this.data.userProfile = profile; this.save(); }

  // License
  async getLicense(): Promise<StoredLicense> {
    return this.data.license ?? { key: null, tier: 'free', valid: false, email: null, expiresAt: null, activatedAt: null, lastChecked: null };
  }

  async setLicense(license: StoredLicense): Promise<void> {
    this.data.license = license;
    this.save();
  }

  async clearLicense(): Promise<void> {
    this.data.license = { key: null, tier: 'free', valid: false, email: null, expiresAt: null, activatedAt: null, lastChecked: null };
    this.save();
  }

  // Session auth (PIN lock)
  getAuth(): StoredAuth {
    return this.data.auth ?? { username: null, pinHash: null, salt: null };
  }

  hasAuth(): boolean {
    const a = this.getAuth();
    return !!(a.pinHash && a.salt && a.username);
  }

  setAuth(username: string, pinHash: string, salt: string): void {
    this.data.auth = { username, pinHash, salt };
    this.save();
  }

  clearAuth(): void {
    this.data.auth = { username: null, pinHash: null, salt: null };
    this.save();
  }

  // Message usage (resets each calendar month)
  private monthKey(): string {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
  }

  getMonthlyMessageCount(): number {
    return this.data.messageUsage[this.monthKey()] ?? 0;
  }

  incrementMessageCount(): number {
    const k = this.monthKey();
    this.data.messageUsage[k] = (this.data.messageUsage[k] ?? 0) + 1;
    // Prune old months (keep last 3)
    const keys = Object.keys(this.data.messageUsage).sort();
    while (keys.length > 3) { delete this.data.messageUsage[keys.shift()!]; }
    this.save();
    return this.data.messageUsage[k];
  }

  addMemory(type: 'fact' | 'goal' | 'preference' | 'business', content: string, source?: string): void {
    this.data.memory.unshift({ id: this.data.nextMemoryId++, type, content, created_at: Date.now(), source });
    if (this.data.memory.length > 200) this.data.memory = this.data.memory.slice(0, 200);
    this.save();
  }

  getMemory(limit = 50): Array<{ id: number; type: string; content: string; created_at: number; source?: string }> {
    return this.data.memory.slice(0, limit);
  }

  deleteMemory(id: number): void {
    this.data.memory = this.data.memory.filter(m => m.id !== id);
    this.save();
  }

  // ── Forge Profile persistence ─────────────────────────────────────────────

  getActiveProfileId(): string | null {
    return this.data.activeProfileId ?? null;
  }

  setActiveProfileId(id: string | null): void {
    this.data.activeProfileId = id;
    this.save();
  }

  /**
   * Remove all memory entries injected by a specific profile.
   * Guardrail: only removes entries where source === `profile:${profileId}`.
   * Entries without a source tag (user-authored memories) are never touched.
   */
  removeProfileMemories(profileId: string): void {
    const tag = `profile:${profileId}`;
    this.data.memory = this.data.memory.filter(m => m.source !== tag);
    this.save();
  }

  /** Returns true if memory entries for this profile are already present (idempotency check). */
  hasProfileMemories(profileId: string): boolean {
    const tag = `profile:${profileId}`;
    return this.data.memory.some(m => m.source === tag);
  }

  // Decision Ledger
  addLedger(entry: LedgerEntry): void {
    if (!this.data.ledger) this.data.ledger = [];
    this.data.ledger.unshift(entry);
    if (this.data.ledger.length > 500) this.data.ledger = this.data.ledger.slice(0, 500);
    this.save();
  }

  getLedger(limit = 100, search = ''): LedgerEntry[] {
    const all = this.data.ledger ?? [];
    const filtered = search
      ? all.filter(e =>
          e.request.toLowerCase().includes(search.toLowerCase()) ||
          e.synthesis.toLowerCase().includes(search.toLowerCase()) ||
          (e.workflow ?? '').toLowerCase().includes(search.toLowerCase()))
      : all;
    return filtered.slice(0, limit);
  }

  getLedgerEntry(id: string): LedgerEntry | undefined {
    return (this.data.ledger ?? []).find(e => e.id === id);
  }

  starLedger(id: string, starred: boolean): void {
    const e = (this.data.ledger ?? []).find(e => e.id === id);
    if (e) { e.starred = starred; this.save(); }
  }

  deleteLedger(id: string): void {
    this.data.ledger = (this.data.ledger ?? []).filter(e => e.id !== id);
    this.save();
  }

  close(): void { /* no-op for file store */ }
}
