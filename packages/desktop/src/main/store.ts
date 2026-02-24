import fs from 'fs';
import path from 'path';
import { app } from 'electron';
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

interface StoreData {
  kv: Record<string, string>;
  secrets: Record<string, string>;
  permissions: Record<string, { granted: boolean; budgetLimit?: number; requireConfirm: boolean }>;
  memory: Array<{ id: number; type: string; content: string; created_at: number }>;
  firstRunDone: boolean;
  userProfile: Record<string, string>;
  nextMemoryId: number;
}

function emptyData(): StoreData {
  const perms: StoreData['permissions'] = {};
  for (const p of DEFAULT_PERMISSIONS) {
    perms[p.key] = { granted: false, budgetLimit: p.budgetLimit, requireConfirm: p.requireConfirm };
  }
  return { kv: {}, secrets: {}, permissions: perms, memory: [], firstRunDone: false, userProfile: {}, nextMemoryId: 1 };
}

export class Store implements StorageAdapter {
  private filePath: string;
  private data: StoreData;

  constructor() {
    this.filePath = path.join(app.getPath('userData'), 'triforge-store.json');
    this.data = emptyData();
  }

  async init(): Promise<void> {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf8');
        const loaded = JSON.parse(raw) as Partial<StoreData>;
        this.data = { ...emptyData(), ...loaded };
        // Merge any new default permissions added in updates
        for (const p of DEFAULT_PERMISSIONS) {
          if (!this.data.permissions[p.key]) {
            this.data.permissions[p.key] = { granted: false, budgetLimit: p.budgetLimit, requireConfirm: p.requireConfirm };
          }
        }
      }
    } catch {
      this.data = emptyData();
    }
  }

  private save(): void {
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.data, null, 2), 'utf8');
    } catch (e) {
      console.error('Store save error:', e);
    }
  }

  // StorageAdapter interface
  async getSecret(key: string): Promise<string | undefined> { return this.data.secrets[key]; }
  async setSecret(key: string, value: string): Promise<void> { this.data.secrets[key] = value; this.save(); }
  async deleteSecret(key: string): Promise<void> { delete this.data.secrets[key]; this.save(); }
  async get(key: string): Promise<string | undefined> { return this.data.kv[key]; }
  async set(key: string, value: string): Promise<void> { this.data.kv[key] = value; this.save(); }
  async delete(key: string): Promise<void> { delete this.data.kv[key]; this.save(); }

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

  addMemory(type: 'fact' | 'goal' | 'preference' | 'business', content: string): void {
    this.data.memory.unshift({ id: this.data.nextMemoryId++, type, content, created_at: Date.now() });
    if (this.data.memory.length > 200) this.data.memory = this.data.memory.slice(0, 200);
    this.save();
  }

  getMemory(limit = 50): Array<{ id: number; type: string; content: string; created_at: number }> {
    return this.data.memory.slice(0, limit);
  }

  close(): void { /* no-op for file store */ }
}
