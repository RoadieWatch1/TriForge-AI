/**
 * leadStore.ts — Lead pipeline persistence (Phase 6)
 *
 * Atomic JSON store at <dataDir>/triforge-leads.json.
 */

import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { Lead, LeadSource, LeadStatus } from './growthTypes';

interface LeadFile { leads: Lead[] }

export class LeadStore {
  private _filePath: string;
  private _leads: Lead[] = [];

  constructor(dataDir: string) {
    this._filePath = path.join(dataDir, 'triforge-leads.json');
    this._load();
  }

  private _load(): void {
    if (!fs.existsSync(this._filePath)) return;
    try {
      const parsed: LeadFile = JSON.parse(fs.readFileSync(this._filePath, 'utf8'));
      this._leads = parsed.leads ?? [];
    } catch (e) {
      console.error('[leadStore] load failed:', e);
    }
  }

  private _save(): void {
    const tmp = this._filePath + '.tmp';
    try {
      fs.writeFileSync(tmp, JSON.stringify({ leads: this._leads }, null, 2), 'utf8');
      fs.renameSync(tmp, this._filePath);
    } catch (e) {
      console.error('[leadStore] save failed:', e);
    }
  }

  create(params: Omit<Lead, 'id' | 'createdAt' | 'updatedAt'>): Lead {
    const now = Date.now();
    const lead: Lead = { id: randomUUID(), createdAt: now, updatedAt: now, ...params };
    this._leads.push(lead);
    this._save();
    return lead;
  }

  get(id: string): Lead | null {
    return this._leads.find(l => l.id === id) ?? null;
  }

  /** Returns all leads, optionally filtered by loopId or status */
  list(loopId?: string, statusFilter?: LeadStatus): Lead[] {
    let result = [...this._leads];
    if (loopId) result = result.filter(l => l.loopId === loopId);
    if (statusFilter) result = result.filter(l => l.status === statusFilter);
    return result.sort((a, b) => b.createdAt - a.createdAt);
  }

  /** Check if a contact (email/handle) is already in the pipeline for a given loop */
  findByContact(contact: string, loopId?: string): Lead | null {
    return this._leads.find(l =>
      l.contact === contact && (!loopId || l.loopId === loopId)
    ) ?? null;
  }

  update(id: string, patch: Partial<Lead>): Lead | null {
    const idx = this._leads.findIndex(l => l.id === id);
    if (idx === -1) return null;
    this._leads[idx] = { ...this._leads[idx], ...patch, updatedAt: Date.now() };
    this._save();
    return this._leads[idx];
  }

  delete(id: string): boolean {
    const before = this._leads.length;
    this._leads = this._leads.filter(l => l.id !== id);
    if (this._leads.length !== before) { this._save(); return true; }
    return false;
  }

  /** Count leads by status for a given loop */
  countByStatus(loopId?: string): Record<LeadStatus, number> {
    const leads = loopId ? this._leads.filter(l => l.loopId === loopId) : this._leads;
    const counts: Record<LeadStatus, number> = { new: 0, contacted: 0, replied: 0, converted: 0 };
    for (const l of leads) counts[l.status]++;
    return counts;
  }
}
