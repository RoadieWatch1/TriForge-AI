/**
 * memoryStore.ts — System-level event memory persistence.
 *
 * Stores a rolling log of significant system events (mission completions,
 * tool executions, task outcomes) to a JSON file. Distinct from the
 * user-facing Store memory (which holds AI context memories).
 *
 * Persists to: <dataDir>/triforge-event-memory.json
 */

import fs from 'fs';
import path from 'path';

export interface MemoryItem {
  id:        string;
  type:      string;  // 'mission' | 'tool' | 'task' | 'sensor' | 'workflow'
  content:   string;
  metadata?: Record<string, unknown>;
  timestamp: number;
}

interface StoreData {
  memories: MemoryItem[];
}

const MAX_ITEMS = 2_000; // rolling cap — oldest evicted when full

export class MemoryStore {
  private _filePath: string;
  private _memories: MemoryItem[] = [];
  private _writeQueue: Promise<void> = Promise.resolve();

  constructor(dataDir: string) {
    this._filePath = path.join(dataDir, 'triforge-event-memory.json');
    this._load();
  }

  private _load(): void {
    try {
      const raw  = fs.readFileSync(this._filePath, 'utf8');
      const data = JSON.parse(raw) as StoreData;
      this._memories = data.memories ?? [];
    } catch {
      this._memories = [];
    }
  }

  save(item: MemoryItem): void {
    this._memories.push(item);
    // Evict oldest when at capacity
    if (this._memories.length > MAX_ITEMS) {
      this._memories.splice(0, this._memories.length - MAX_ITEMS);
    }
    this._persist();
  }

  loadAll(): MemoryItem[] {
    return [...this._memories];
  }

  search(query: string): MemoryItem[] {
    const lower = query.toLowerCase();
    return this._memories.filter(m => m.content.toLowerCase().includes(lower));
  }

  getRecent(n: number): MemoryItem[] {
    return this._memories.slice(-n);
  }

  private _persist(): void {
    const snapshot = [...this._memories];
    const tmp = this._filePath + '.tmp';
    this._writeQueue = this._writeQueue.then(() => {
      try {
        fs.writeFileSync(tmp, JSON.stringify({ memories: snapshot }, null, 2), 'utf8');
        fs.renameSync(tmp, this._filePath);
      } catch (e) {
        console.error('[MemoryStore] persist failed', e);
      }
    });
  }
}
