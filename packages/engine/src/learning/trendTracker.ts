// ── trendTracker.ts — Market trend tracking over time ────────────────────────
//
// Tracks market trend snapshots over time to detect category momentum.
// Persists via StorageAdapter. Keeps 30 days of snapshots.
// Provides formatted context for council prompt injection.

import type { StorageAdapter } from '../platform';
import type { TrendSnapshot, TrendMomentum, TrendData } from './learningTypes';

export type SearchFn = (query: string) => Promise<{ title: string; snippet: string; url: string }[]>;

const STORAGE_KEY = 'triforge.trendSnapshots';
const MAX_AGE_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

const TREND_QUERIES = [
  'trending online business ideas 2026',
  'fastest growing digital product categories',
  'emerging micro-SaaS opportunities',
  'viral content niche trends',
  'profitable newsletter topics growing',
];

export class TrendTracker {
  constructor(private _storage: StorageAdapter) {}

  // ── Snapshot management ───────────────────────────────────────────────────

  addSnapshot(snapshot: TrendSnapshot): void {
    const data = this._load();
    data.snapshots.push(snapshot);
    this._prune(data);
    this._save(data);
  }

  getSnapshots(): TrendSnapshot[] {
    return this._load().snapshots;
  }

  // ── Momentum analysis ─────────────────────────────────────────────────────

  getMomentum(category: string): TrendMomentum {
    const snapshots = this._load().snapshots
      .filter(s => s.category === category)
      .sort((a, b) => a.timestamp - b.timestamp);

    if (snapshots.length < 2) return 'stable';

    const recent = snapshots.slice(-3);
    const older = snapshots.slice(0, Math.max(1, snapshots.length - 3));

    const recentAvg = avg(recent.map(s => s.confidence));
    const olderAvg = avg(older.map(s => s.confidence));

    if (recentAvg > olderAvg + 10) return 'rising';
    if (recentAvg < olderAvg - 10) return 'declining';
    return 'stable';
  }

  getHotCategories(limit: number): string[] {
    const snapshots = this._load().snapshots;
    const now = Date.now();
    const recentWindow = 7 * 24 * 60 * 60 * 1000; // 7 days

    const recent = snapshots.filter(s => now - s.timestamp < recentWindow);
    const scores: Record<string, number> = {};

    for (const s of recent) {
      scores[s.category] = (scores[s.category] ?? 0) + s.confidence;
    }

    return Object.entries(scores)
      .sort(([, a], [, b]) => b - a)
      .slice(0, limit)
      .map(([cat]) => cat);
  }

  getCoolingCategories(): string[] {
    const snapshots = this._load().snapshots;
    const categories = new Set(snapshots.map(s => s.category));
    const cooling: string[] = [];

    for (const cat of categories) {
      if (this.getMomentum(cat) === 'declining') cooling.push(cat);
    }
    return cooling;
  }

  // ── Web refresh ───────────────────────────────────────────────────────────

  async refreshFromWeb(searchFn: SearchFn): Promise<TrendSnapshot[]> {
    const newSnapshots: TrendSnapshot[] = [];
    const now = Date.now();

    const results = await Promise.allSettled(
      TREND_QUERIES.map(q => searchFn(q))
    );

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status !== 'fulfilled' || !result.value.length) continue;

      const signals = result.value.slice(0, 5).map(r => ({
        source: 'web_search',
        title: r.title,
        snippet: r.snippet,
        url: r.url,
        relevance: 0.7,
      }));

      const category = inferCategoryFromQuery(TREND_QUERIES[i]);
      const snapshot: TrendSnapshot = {
        id: `trend:${category}:${now}:${i}`,
        timestamp: now,
        category,
        signals,
        momentum: 'stable', // will be classified on retrieval
        confidence: Math.min(100, signals.length * 20),
      };

      newSnapshots.push(snapshot);
      this.addSnapshot(snapshot);
    }

    return newSnapshots;
  }

  // ── Council context ───────────────────────────────────────────────────────

  getContextForCouncil(): string {
    const hot = this.getHotCategories(5);
    const cooling = this.getCoolingCategories();

    if (hot.length === 0 && cooling.length === 0) {
      return '';
    }

    const lines: string[] = ['TREND CONTEXT:'];

    if (hot.length > 0) {
      lines.push(`Hot categories: ${hot.join(', ')}`);
    }
    if (cooling.length > 0) {
      lines.push(`Cooling categories: ${cooling.join(', ')}`);
    }

    // Add recent signal highlights
    const snapshots = this._load().snapshots;
    const recentSignals = snapshots
      .slice(-5)
      .flatMap(s => s.signals.slice(0, 1))
      .map(s => `- ${s.title}`);

    if (recentSignals.length > 0) {
      lines.push('Recent signals:');
      lines.push(...recentSignals);
    }

    return lines.join('\n');
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private _load(): TrendData {
    return this._storage.get<TrendData>(STORAGE_KEY, { snapshots: [] });
  }

  private _save(data: TrendData): void {
    this._storage.update(STORAGE_KEY, data);
  }

  private _prune(data: TrendData): void {
    const cutoff = Date.now() - MAX_AGE_MS;
    data.snapshots = data.snapshots.filter(s => s.timestamp > cutoff);
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function avg(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

function inferCategoryFromQuery(query: string): string {
  const q = query.toLowerCase();
  if (q.includes('saas')) return 'saas_micro';
  if (q.includes('newsletter')) return 'newsletter';
  if (q.includes('content') || q.includes('viral')) return 'content_brand';
  if (q.includes('digital product')) return 'digital_product';
  return 'general';
}
