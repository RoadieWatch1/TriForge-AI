import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { ApprovalRequest, TaskToolName } from './taskTypes';

// ── ApprovalStore ─────────────────────────────────────────────────────────────
// Persistent JSON store for ApprovalRequest objects.
// File: <dataDir>/triforge-approvals.json

interface StoreData {
  approvals: Record<string, ApprovalRequest>;
}

type CreateInput = Omit<ApprovalRequest, 'id' | 'createdAt' | 'status'>;

export class ApprovalStore {
  private _filePath: string;
  private _tmpPath: string;
  private _cache: Record<string, ApprovalRequest> = {};
  private _initialized = false;

  constructor(dataDir: string) {
    this._filePath = path.join(dataDir, 'triforge-approvals.json');
    this._tmpPath = path.join(dataDir, 'triforge-approvals.json.tmp');
  }

  create(req: CreateInput): ApprovalRequest {
    this._ensureLoaded();
    const approval: ApprovalRequest = {
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      status: 'pending',
      ...req,
    };
    this._cache[approval.id] = approval;
    this._save();
    return approval;
  }

  get(id: string): ApprovalRequest | null {
    this._ensureLoaded();
    return this._cache[id] ?? null;
  }

  update(id: string, patch: Partial<ApprovalRequest>): ApprovalRequest | null {
    this._ensureLoaded();
    const existing = this._cache[id];
    if (!existing) return null;
    this._cache[id] = { ...existing, ...patch };
    this._save();
    return this._cache[id];
  }

  // Returns only pending, non-expired approvals. Lazily marks expired ones.
  listPending(): ApprovalRequest[] {
    this._ensureLoaded();
    const now = Date.now();
    let changed = false;

    for (const a of Object.values(this._cache)) {
      if (a.status === 'pending' && a.expiresAt <= now) {
        this._cache[a.id] = { ...a, status: 'expired' };
        changed = true;
      }
    }
    if (changed) this._save();

    return Object.values(this._cache)
      .filter(a => a.status === 'pending')
      .sort((a, b) => b.createdAt - a.createdAt);
  }

  // Find the latest pending approval for a task+step combo
  getByStep(taskId: string, stepId: string): ApprovalRequest | null {
    this._ensureLoaded();
    const now = Date.now();
    return Object.values(this._cache)
      .filter(a => a.taskId === taskId && a.stepId === stepId && a.status === 'pending' && a.expiresAt > now)
      .sort((a, b) => b.createdAt - a.createdAt)[0] ?? null;
  }

  // Expire all stale pending approvals — call on startup
  expireStale(): void {
    this._ensureLoaded();
    const now = Date.now();
    let changed = false;
    for (const a of Object.values(this._cache)) {
      if (a.status === 'pending' && a.expiresAt <= now) {
        this._cache[a.id] = { ...a, status: 'expired' };
        changed = true;
      }
    }
    if (changed) this._save();
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  private _ensureLoaded(): void {
    if (this._initialized) return;
    try {
      const raw = fs.readFileSync(this._filePath, 'utf8');
      const data: StoreData = JSON.parse(raw);
      this._cache = data.approvals ?? {};
    } catch {
      this._cache = {};
    }
    this._initialized = true;
  }

  private _save(): void {
    const data: StoreData = { approvals: { ...this._cache } };
    const json = JSON.stringify(data, null, 2);
    try {
      fs.writeFileSync(this._tmpPath, json, 'utf8');
      fs.renameSync(this._tmpPath, this._filePath);
    } catch (err) {
      console.error('[ApprovalStore] save error:', err);
    }
  }
}
