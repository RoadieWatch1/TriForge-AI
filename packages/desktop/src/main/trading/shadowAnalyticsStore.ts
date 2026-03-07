// ── main/trading/shadowAnalyticsStore.ts ──────────────────────────────────────
//
// Phase 3: JSONL persistence for shadow trading decision events.
// Follows the same pattern as resultStore.ts — append-only, capped, atomic trim.

import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import type { ShadowDecisionEvent, ShadowAnalyticsSummary } from '@triforge/engine';
import { computeFullSummary, computeDecisionFunnel } from '@triforge/engine';

const MAX_EVENTS = 2000;

export class ShadowAnalyticsStore {
  private filePath: string;

  constructor() {
    this.filePath = path.join(app.getPath('userData'), 'triforge-shadow-analytics.jsonl');
  }

  /** Append a single decision event. Enforces MAX_EVENTS cap. */
  append(event: ShadowDecisionEvent): void {
    try {
      const line = JSON.stringify(event) + '\n';
      fs.appendFileSync(this.filePath, line, 'utf8');
      this._enforceCapIfNeeded();
    } catch (e) {
      console.error('[shadowAnalytics] append failed:', e);
    }
  }

  /** Load all events from disk. */
  loadAll(): ShadowDecisionEvent[] {
    if (!fs.existsSync(this.filePath)) return [];
    try {
      const lines = fs.readFileSync(this.filePath, 'utf8')
        .split('\n')
        .filter(Boolean);
      return lines.map(l => JSON.parse(l) as ShadowDecisionEvent);
    } catch (e) {
      console.error('[shadowAnalytics] loadAll failed:', e);
      return [];
    }
  }

  /** Query recent events, optionally filtered. */
  query(opts?: {
    stage?: string;
    symbol?: string;
    limit?: number;
    since?: number;
  }): ShadowDecisionEvent[] {
    let all = this.loadAll();
    if (opts?.since) all = all.filter(e => e.timestamp >= opts.since!);
    if (opts?.stage) all = all.filter(e => e.stage === opts.stage);
    if (opts?.symbol) all = all.filter(e => e.symbol === opts.symbol);
    const limit = opts?.limit ?? 500;
    return all.slice(-limit);
  }

  /** Compute the full analytics summary. */
  getSummary(): ShadowAnalyticsSummary {
    return computeFullSummary(this.loadAll());
  }

  /** Decision funnel for the last N hours. */
  getDecisionFunnel(hoursBack?: number): Record<string, number> {
    const since = hoursBack ? Date.now() - hoursBack * 3600_000 : 0;
    const events = this.loadAll().filter(e => e.timestamp >= since);
    return computeDecisionFunnel(events);
  }

  /** Explicitly clear all analytics data. */
  clear(): void {
    try {
      if (fs.existsSync(this.filePath)) fs.unlinkSync(this.filePath);
    } catch { /* best-effort */ }
  }

  /** Truncate to last MAX_EVENTS by rewriting the file. */
  private _enforceCapIfNeeded(): void {
    try {
      const stat = fs.statSync(this.filePath);
      // Only check when file is likely over cap (rough heuristic: >1MB)
      if (stat.size < 1_000_000) return;

      const lines = fs.readFileSync(this.filePath, 'utf8')
        .split('\n')
        .filter(Boolean);
      if (lines.length > MAX_EVENTS) {
        const trimmed = lines.slice(lines.length - MAX_EVENTS);
        const tmpPath = this.filePath + '.tmp';
        fs.writeFileSync(tmpPath, trimmed.join('\n') + '\n', 'utf8');
        fs.renameSync(tmpPath, this.filePath);
      }
    } catch { /* best-effort */ }
  }
}

export const shadowAnalyticsStore = new ShadowAnalyticsStore();
