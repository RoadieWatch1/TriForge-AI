/**
 * missionStore.ts — JSON persistence for mission definitions.
 *
 * Persists to <dataDir>/triforge-missions.json using atomic rename writes.
 * Only the serializable definition (no functions) is stored.
 */

import fs from 'fs';
import path from 'path';
import type { TaskCategory } from '@triforge/engine';

// ── Serializable mission definition ───────────────────────────────────────────

export interface MissionDefinition {
  id:          string;
  name:        string;
  description?: string;
  goal:        string;
  category:    TaskCategory;
  /** Schedule string in Scheduler format: 'daily@HH:MM' | 'every@Nh' | 'every@Nm' */
  schedule?:   string;
  enabled:     boolean;
  createdAt:   number;
  lastRunAt?:  number;
}

interface StoreData {
  missions: Record<string, MissionDefinition>;
}

// ── MissionStore ───────────────────────────────────────────────────────────────

export class MissionStore {
  private _filePath: string;
  private _cache: Record<string, MissionDefinition> = {};
  private _writeQueue: Promise<void> = Promise.resolve();

  constructor(dataDir: string) {
    this._filePath = path.join(dataDir, 'triforge-missions.json');
    this._load();
  }

  private _load(): void {
    try {
      const raw = fs.readFileSync(this._filePath, 'utf8');
      const data = JSON.parse(raw) as StoreData;
      this._cache = data.missions ?? {};
    } catch {
      this._cache = {};
    }
  }

  save(mission: MissionDefinition): void {
    this._cache[mission.id] = mission;
    this._persist();
  }

  load(): MissionDefinition[] {
    return Object.values(this._cache);
  }

  get(id: string): MissionDefinition | null {
    return this._cache[id] ?? null;
  }

  update(id: string, patch: Partial<MissionDefinition>): MissionDefinition | null {
    const existing = this._cache[id];
    if (!existing) return null;
    const updated = { ...existing, ...patch };
    this._cache[id] = updated;
    this._persist();
    return updated;
  }

  delete(id: string): boolean {
    if (!this._cache[id]) return false;
    delete this._cache[id];
    this._persist();
    return true;
  }

  private _persist(): void {
    const data: StoreData = { missions: this._cache };
    const tmp = this._filePath + '.tmp';
    this._writeQueue = this._writeQueue.then(() => {
      try {
        fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8');
        fs.renameSync(tmp, this._filePath);
      } catch (e) {
        console.error('[MissionStore] persist failed', e);
      }
    });
  }
}
