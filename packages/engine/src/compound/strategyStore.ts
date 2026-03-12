/**
 * strategyStore.ts — StrategyProfile persistence (Phase 7)
 *
 * Atomic JSON store at <dataDir>/triforge-strategies.json.
 */

import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { StrategyProfile } from './compoundTypes';

interface StrategyFile { strategies: StrategyProfile[] }

export class StrategyStore {
  private _filePath: string;
  private _strategies: StrategyProfile[] = [];

  constructor(dataDir: string) {
    this._filePath = path.join(dataDir, 'triforge-strategies.json');
    this._load();
  }

  private _load(): void {
    if (!fs.existsSync(this._filePath)) return;
    try {
      const parsed: StrategyFile = JSON.parse(fs.readFileSync(this._filePath, 'utf8'));
      this._strategies = parsed.strategies ?? [];
    } catch (e) {
      console.error('[strategyStore] load failed:', e);
    }
  }

  private _save(): void {
    const tmp = this._filePath + '.tmp';
    try {
      fs.writeFileSync(tmp, JSON.stringify({ strategies: this._strategies }, null, 2), 'utf8');
      fs.renameSync(tmp, this._filePath);
    } catch (e) {
      console.error('[strategyStore] save failed:', e);
    }
  }

  create(params: Omit<StrategyProfile, 'id' | 'createdAt' | 'updatedAt'>): StrategyProfile {
    const now = Date.now();
    const s: StrategyProfile = { id: randomUUID(), createdAt: now, updatedAt: now, ...params };
    this._strategies.push(s);
    this._save();
    return s;
  }

  get(id: string): StrategyProfile | null {
    return this._strategies.find(s => s.id === id) ?? null;
  }

  /** Returns all strategies, sorted by score descending, optionally filtered by type */
  list(type?: StrategyProfile['type']): StrategyProfile[] {
    const items = type ? this._strategies.filter(s => s.type === type) : [...this._strategies];
    return items.sort((a, b) => b.score - a.score);
  }

  /** Returns top-scoring active strategies of a given type */
  findBest(type: StrategyProfile['type'], limit = 3): StrategyProfile[] {
    return this._strategies
      .filter(s => s.type === type && s.status === 'active')
      .sort((a, b) => b.score - a.score)
      .slice(0, limit);
  }

  /** Find by description + type (for dedup / upsert) */
  findByDescription(desc: string, type: StrategyProfile['type']): StrategyProfile | null {
    return this._strategies.find(s => s.type === type && s.description === desc) ?? null;
  }

  update(id: string, patch: Partial<StrategyProfile>): StrategyProfile | null {
    const idx = this._strategies.findIndex(s => s.id === id);
    if (idx === -1) return null;
    this._strategies[idx] = { ...this._strategies[idx], ...patch, updatedAt: Date.now() };
    this._save();
    return this._strategies[idx];
  }
}
