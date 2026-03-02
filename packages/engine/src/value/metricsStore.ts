/**
 * metricsStore.ts — Truth-only metrics event persistence (Phase 5)
 *
 * Stores MetricsEvents as JSONL at <dataDir>/triforge-metrics.jsonl.
 * Events are ONLY appended when real actions happen — never fabricated.
 * Query methods support filtering by campaignId or taskId.
 */

import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';
import type { MetricsEvent, MetricsEventType } from './valueTypes';

export class MetricsStore {
  private _filePath: string;

  constructor(dataDir: string) {
    this._filePath = path.join(dataDir, 'triforge-metrics.jsonl');
  }

  /** Append a single MetricsEvent to the JSONL file */
  append(event: MetricsEvent): void {
    try {
      const line = JSON.stringify(event) + '\n';
      fs.appendFileSync(this._filePath, line, 'utf8');
    } catch (e) {
      console.error('[metricsStore] append failed:', e);
    }
  }

  /** Create and append a new event, returning it */
  record(
    type: MetricsEventType,
    taskId: string,
    payload: Record<string, unknown>,
  ): MetricsEvent {
    const event = {
      type,
      id: randomUUID(),
      taskId,
      timestamp: Date.now(),
      ...payload,
    } as MetricsEvent;
    this.append(event);
    return event;
  }

  /** Load all events from JSONL file */
  loadAll(): MetricsEvent[] {
    if (!fs.existsSync(this._filePath)) return [];
    try {
      const lines = fs.readFileSync(this._filePath, 'utf8')
        .split('\n')
        .filter(Boolean);
      return lines.map(l => JSON.parse(l) as MetricsEvent);
    } catch (e) {
      console.error('[metricsStore] loadAll failed:', e);
      return [];
    }
  }

  /** Query events, optionally filtered by campaignId and/or taskId */
  query(opts: { campaignId?: string; taskId?: string; since?: number; limit?: number } = {}): MetricsEvent[] {
    const all = this.loadAll();
    let filtered = all;

    if (opts.campaignId) {
      filtered = filtered.filter(e => e.campaignId === opts.campaignId);
    }
    if (opts.taskId) {
      filtered = filtered.filter(e => e.taskId === opts.taskId);
    }
    if (opts.since != null) {
      filtered = filtered.filter(e => e.timestamp >= opts.since!);
    }

    const limit = opts.limit ?? 5000;
    return filtered.slice(-limit);
  }

  /** Query events for a set of taskIds (used for campaign aggregation) */
  queryByTaskIds(taskIds: string[], opts: { since?: number } = {}): MetricsEvent[] {
    if (taskIds.length === 0) return [];
    const taskSet = new Set(taskIds);
    const all = this.loadAll();
    let filtered = all.filter(e => e.campaignId != null
      ? e.campaignId === taskIds[0]  // if campaignId tagged, match it
      : taskSet.has(e.taskId));
    if (opts.since != null) {
      filtered = filtered.filter(e => e.timestamp >= opts.since!);
    }
    return filtered;
  }

  /** Global summary counts across all events */
  globalSummary(): { total: number; byType: Record<string, number> } {
    const all = this.loadAll();
    const byType: Record<string, number> = {};
    for (const e of all) {
      byType[e.type] = (byType[e.type] ?? 0) + 1;
    }
    return { total: all.length, byType };
  }
}
