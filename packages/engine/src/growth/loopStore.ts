/**
 * loopStore.ts — GrowthLoop persistence (Phase 6)
 *
 * Atomic JSON store at <dataDir>/triforge-loops.json.
 */

import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { GrowthLoop, GrowthLoopType, GrowthLoopStatus } from './growthTypes';

interface LoopFile { loops: GrowthLoop[] }

export class LoopStore {
  private _filePath: string;
  private _loops: GrowthLoop[] = [];

  constructor(dataDir: string) {
    this._filePath = path.join(dataDir, 'triforge-loops.json');
    this._load();
  }

  private _load(): void {
    if (!fs.existsSync(this._filePath)) return;
    try {
      const parsed: LoopFile = JSON.parse(fs.readFileSync(this._filePath, 'utf8'));
      this._loops = parsed.loops ?? [];
    } catch (e) {
      console.error('[loopStore] load failed:', e);
    }
  }

  private _save(): void {
    const tmp = this._filePath + '.tmp';
    try {
      fs.writeFileSync(tmp, JSON.stringify({ loops: this._loops }, null, 2), 'utf8');
      fs.renameSync(tmp, this._filePath);
    } catch (e) {
      console.error('[loopStore] save failed:', e);
    }
  }

  create(params: Omit<GrowthLoop, 'id' | 'createdAt' | 'updatedAt' | 'runCount'>): GrowthLoop {
    const now = Date.now();
    const loop: GrowthLoop = {
      id: randomUUID(),
      runCount: 0,
      createdAt: now,
      updatedAt: now,
      ...params,
    };
    this._loops.push(loop);
    this._save();
    return loop;
  }

  get(id: string): GrowthLoop | null {
    return this._loops.find(l => l.id === id) ?? null;
  }

  list(statusFilter?: GrowthLoopStatus): GrowthLoop[] {
    if (!statusFilter) return [...this._loops];
    return this._loops.filter(l => l.status === statusFilter);
  }

  listActive(): GrowthLoop[] {
    return this._loops.filter(l => l.status === 'active');
  }

  update(id: string, patch: Partial<GrowthLoop>): GrowthLoop | null {
    const idx = this._loops.findIndex(l => l.id === id);
    if (idx === -1) return null;
    this._loops[idx] = { ...this._loops[idx], ...patch, updatedAt: Date.now() };
    this._save();
    return this._loops[idx];
  }

  delete(id: string): boolean {
    const before = this._loops.length;
    this._loops = this._loops.filter(l => l.id !== id);
    if (this._loops.length !== before) { this._save(); return true; }
    return false;
  }
}
