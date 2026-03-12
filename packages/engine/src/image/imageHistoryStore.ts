/**
 * imageHistoryStore.ts — Persistent log of image generation sessions.
 *
 * Persists to: <dataDir>/triforge-image-history.json
 * Rolling cap: MAX_ENTRIES (newest kept when full).
 * Images stored as base64 strings inline (< ~5MB per entry typical).
 */

import fs   from 'fs';
import path from 'path';
import type { CritiqueResult } from './imageCritique';

export interface ImageHistoryEntry {
  id:             string;
  userPrompt:     string;
  refinedPrompt:  string;
  style?:         string;
  negativePrompt?: string;
  seed?:          number;
  width:          number;
  height:         number;
  quality:        string;
  generator:      'openai' | 'grok';
  images:         string[];         // base64 strings
  critique?:      CritiqueResult;
  bestIndex:      number;
  generatedAt:    number;           // epoch ms
  durationMs:     number;
}

interface StoreData {
  entries: ImageHistoryEntry[];
}

const MAX_ENTRIES = 500;

export class ImageHistoryStore {
  private _filePath: string;
  private _entries: ImageHistoryEntry[] = [];
  private _writeQueue: Promise<void> = Promise.resolve();

  constructor(dataDir: string) {
    this._filePath = path.join(dataDir, 'triforge-image-history.json');
    this._load();
  }

  private _load(): void {
    try {
      const raw  = fs.readFileSync(this._filePath, 'utf8');
      const data = JSON.parse(raw) as StoreData;
      this._entries = data.entries ?? [];
    } catch {
      this._entries = [];
    }
  }

  save(entry: ImageHistoryEntry): void {
    this._entries.push(entry);
    if (this._entries.length > MAX_ENTRIES) {
      this._entries.splice(0, this._entries.length - MAX_ENTRIES);
    }
    this._persist();
  }

  getRecent(n: number = 50): ImageHistoryEntry[] {
    return this._entries.slice(-n);
  }

  getAll(): ImageHistoryEntry[] {
    return [...this._entries];
  }

  getById(id: string): ImageHistoryEntry | undefined {
    return this._entries.find(e => e.id === id);
  }

  delete(id: string): void {
    const idx = this._entries.findIndex(e => e.id === id);
    if (idx !== -1) {
      this._entries.splice(idx, 1);
      this._persist();
    }
  }

  private _persist(): void {
    const snapshot = [...this._entries];
    const tmp = this._filePath + '.tmp';
    this._writeQueue = this._writeQueue.then(() => {
      try {
        fs.writeFileSync(tmp, JSON.stringify({ entries: snapshot }, null, 2), 'utf8');
        fs.renameSync(tmp, this._filePath);
      } catch (e) {
        console.error('[ImageHistoryStore] persist failed', e);
      }
    });
  }
}

// Singleton
let _instance: ImageHistoryStore | null = null;

export function getImageHistoryStore(dataDir: string): ImageHistoryStore {
  if (!_instance) {
    _instance = new ImageHistoryStore(dataDir);
  }
  return _instance;
}
