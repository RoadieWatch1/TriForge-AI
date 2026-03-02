/**
 * contentStore.ts — Published content history (Phase 6)
 *
 * Atomic JSON store at <dataDir>/triforge-content.json.
 * Tracks what the growth engine has published so we don't repeat content.
 */

import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { ContentItem, ContentType, ContentStatus } from './growthTypes';

interface ContentFile { items: ContentItem[] }

export class ContentStore {
  private _filePath: string;
  private _items: ContentItem[] = [];

  constructor(dataDir: string) {
    this._filePath = path.join(dataDir, 'triforge-content.json');
    this._load();
  }

  private _load(): void {
    if (!fs.existsSync(this._filePath)) return;
    try {
      const parsed: ContentFile = JSON.parse(fs.readFileSync(this._filePath, 'utf8'));
      this._items = parsed.items ?? [];
    } catch (e) {
      console.error('[contentStore] load failed:', e);
    }
  }

  private _save(): void {
    const tmp = this._filePath + '.tmp';
    try {
      fs.writeFileSync(tmp, JSON.stringify({ items: this._items }, null, 2), 'utf8');
      fs.renameSync(tmp, this._filePath);
    } catch (e) {
      console.error('[contentStore] save failed:', e);
    }
  }

  create(params: Omit<ContentItem, 'id' | 'createdAt'>): ContentItem {
    const item: ContentItem = { id: randomUUID(), createdAt: Date.now(), ...params };
    this._items.push(item);
    this._save();
    return item;
  }

  get(id: string): ContentItem | null {
    return this._items.find(i => i.id === id) ?? null;
  }

  list(loopId?: string): ContentItem[] {
    const items = loopId ? this._items.filter(i => i.loopId === loopId) : [...this._items];
    return items.sort((a, b) => b.createdAt - a.createdAt);
  }

  /** Return recently published content strings (for dedup) */
  recentContent(loopId: string, limit = 20): string[] {
    return this.list(loopId)
      .filter(i => i.status === 'published')
      .slice(0, limit)
      .map(i => i.content);
  }

  update(id: string, patch: Partial<ContentItem>): ContentItem | null {
    const idx = this._items.findIndex(i => i.id === id);
    if (idx === -1) return null;
    this._items[idx] = { ...this._items[idx], ...patch };
    this._save();
    return this._items[idx];
  }
}
