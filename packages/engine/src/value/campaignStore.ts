/**
 * campaignStore.ts — Campaign persistence (Phase 5)
 *
 * Atomic JSON store at <dataDir>/triforge-campaigns.json.
 * Same tmp+rename pattern as TaskStore for crash-safe writes.
 */

import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { Campaign, CampaignType, CampaignStatus } from './valueTypes';

interface CampaignFile {
  campaigns: Campaign[];
}

export class CampaignStore {
  private _filePath: string;
  private _campaigns: Campaign[] = [];

  constructor(dataDir: string) {
    this._filePath = path.join(dataDir, 'triforge-campaigns.json');
    this._load();
  }

  private _load(): void {
    if (!fs.existsSync(this._filePath)) return;
    try {
      const raw = fs.readFileSync(this._filePath, 'utf8');
      const parsed: CampaignFile = JSON.parse(raw);
      this._campaigns = parsed.campaigns ?? [];
    } catch (e) {
      console.error('[campaignStore] load failed:', e);
    }
  }

  private _save(): void {
    const tmp = this._filePath + '.tmp';
    try {
      fs.writeFileSync(tmp, JSON.stringify({ campaigns: this._campaigns }, null, 2), 'utf8');
      fs.renameSync(tmp, this._filePath);
    } catch (e) {
      console.error('[campaignStore] save failed:', e);
    }
  }

  create(name: string, type: CampaignType, description?: string): Campaign {
    const now = Date.now();
    const campaign: Campaign = {
      id: randomUUID(),
      name,
      type,
      status: 'active',
      createdAt: now,
      updatedAt: now,
      taskIds: [],
      description,
    };
    this._campaigns.push(campaign);
    this._save();
    return campaign;
  }

  get(id: string): Campaign | null {
    return this._campaigns.find(c => c.id === id) ?? null;
  }

  list(statusFilter?: CampaignStatus): Campaign[] {
    if (!statusFilter) return [...this._campaigns];
    return this._campaigns.filter(c => c.status === statusFilter);
  }

  update(id: string, patch: Partial<Campaign>): Campaign | null {
    const idx = this._campaigns.findIndex(c => c.id === id);
    if (idx === -1) return null;
    this._campaigns[idx] = { ...this._campaigns[idx], ...patch, updatedAt: Date.now() };
    this._save();
    return this._campaigns[idx];
  }

  /** Add a taskId to a campaign's taskIds array (idempotent) */
  linkTask(campaignId: string, taskId: string): boolean {
    const c = this._campaigns.find(c => c.id === campaignId);
    if (!c) return false;
    if (!c.taskIds.includes(taskId)) {
      c.taskIds.push(taskId);
      c.updatedAt = Date.now();
      this._save();
    }
    return true;
  }

  /** Remove a taskId from a campaign */
  unlinkTask(campaignId: string, taskId: string): boolean {
    const c = this._campaigns.find(c => c.id === campaignId);
    if (!c) return false;
    const before = c.taskIds.length;
    c.taskIds = c.taskIds.filter(id => id !== taskId);
    if (c.taskIds.length !== before) {
      c.updatedAt = Date.now();
      this._save();
    }
    return true;
  }

  delete(id: string): boolean {
    const before = this._campaigns.length;
    this._campaigns = this._campaigns.filter(c => c.id !== id);
    if (this._campaigns.length !== before) {
      this._save();
      return true;
    }
    return false;
  }

  /** Return the campaign that contains a given taskId */
  findByTask(taskId: string): Campaign | null {
    return this._campaigns.find(c => c.taskIds.includes(taskId)) ?? null;
  }
}
