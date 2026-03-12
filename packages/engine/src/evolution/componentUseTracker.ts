// ── componentUseTracker.ts — Component usage tracking via EventBus ──────────
//
// Subscribes to EventBus via onAny() to track component usage, errors, and
// latency. Persists records via StorageAdapter.

import type { StorageAdapter } from '../platform';
import { eventBus } from '../core/eventBus';
import type { ComponentRecord, ComponentHealthStatus } from './evolutionTypes';
import { PROTECTED_CATEGORIES } from './evolutionTypes';

const STORAGE_KEY = 'triforge.componentUseTracker';
const MAX_RECORDS = 500;
const THIRTY_DAYS_MS = 30 * 24 * 60 * 60 * 1000;

export class ComponentUseTracker {
  private _storage: StorageAdapter;
  private _records: Map<string, ComponentRecord> = new Map();
  private _unsubscribe: (() => void) | null = null;
  private _initialized = false;

  constructor(storage: StorageAdapter) {
    this._storage = storage;
  }

  // ── Initialization ──────────────────────────────────────────────────────────

  async initialize(): Promise<void> {
    if (this._initialized) return;
    await this._load();
    this._subscribe();
    this._initialized = true;
  }

  private _subscribe(): void {
    this._unsubscribe = eventBus.onAny((ev) => {
      // Track usage from event types that indicate component activity
      if ('taskId' in ev && 'type' in ev) {
        const componentId = this._eventToComponentId(ev.type);
        if (componentId) {
          this.trackUsage(componentId, ev.type, this._eventToCategory(ev.type));
        }
      }

      // Track errors
      if (ev.type === 'TASK_FAILED' || ev.type === 'STEP_FAILED') {
        const componentId = this._eventToComponentId(ev.type);
        if (componentId) {
          this.trackError(componentId, ev.type === 'TASK_FAILED' ? ev.error : ev.error);
        }
      }
    });
  }

  dispose(): void {
    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = null;
    }
  }

  // ── Tracking ────────────────────────────────────────────────────────────────

  trackUsage(componentId: string, name: string, category: string): void {
    const record = this._getOrCreate(componentId, name, category);
    record.useCount++;
    record.useCountLast30Days++;  // Fix 6: also increment 30-day counter
    record.lastUsed = Date.now();
    this._records.set(componentId, record);
    this._save();
  }

  trackError(componentId: string, _error: string): void {
    const record = this._records.get(componentId);
    if (!record) return;
    record.errorCount++;
    record.errorCountLast30Days++;  // Fix 6: also increment 30-day counter
    this._records.set(componentId, record);
    this._save();
  }

  trackLatency(componentId: string, latencyMs: number): void {
    const record = this._records.get(componentId);
    if (!record) return;

    // Running average
    if (record.averageLatencyMs === 0) {
      record.averageLatencyMs = latencyMs;
    } else {
      record.averageLatencyMs = record.averageLatencyMs * 0.9 + latencyMs * 0.1;
    }

    this._records.set(componentId, record);
    this._save();
  }

  // ── Queries ─────────────────────────────────────────────────────────────────

  getRecord(componentId: string): ComponentRecord | undefined {
    return this._records.get(componentId);
  }

  getAllRecords(): ComponentRecord[] {
    return [...this._records.values()];
  }

  getDormantComponents(thresholdDays: number): ComponentRecord[] {
    const cutoff = Date.now() - thresholdDays * 24 * 60 * 60 * 1000;
    return [...this._records.values()].filter(
      r => r.lastUsed < cutoff && r.useCount > 0 && !r.isProtected
    );
  }

  getHighErrorComponents(errorThreshold: number): ComponentRecord[] {
    return [...this._records.values()].filter(r => {
      if (r.useCount === 0) return false;
      const errorRate = r.errorCount / r.useCount;
      return errorRate > errorThreshold;
    });
  }

  // ── 30-day recalculation ────────────────────────────────────────────────────

  recalculate30DayMetrics(): void {
    const cutoff = Date.now() - THIRTY_DAYS_MS;
    for (const record of this._records.values()) {
      if (record.lastUsed < cutoff) {
        // Component hasn't been used in 30+ days — zero out rolling counts
        record.useCountLast30Days = 0;
        record.errorCountLast30Days = 0;
      }
      // Active components keep their 30-day counts (accumulated by trackUsage/trackError)
    }
    this._save();
  }

  // ── Register component directly ─────────────────────────────────────────────

  registerComponent(
    id: string,
    name: string,
    category: string,
    opts?: { linkedExpertId?: string; isProtected?: boolean },
  ): ComponentRecord {
    const record = this._getOrCreate(id, name, category);
    if (opts?.linkedExpertId) record.linkedExpertId = opts.linkedExpertId;
    if (opts?.isProtected !== undefined) record.isProtected = opts.isProtected;
    this._records.set(id, record);
    this._save();
    return record;
  }

  // ── Internals ───────────────────────────────────────────────────────────────

  private _getOrCreate(componentId: string, name: string, category: string): ComponentRecord {
    const existing = this._records.get(componentId);
    if (existing) return existing;

    const record: ComponentRecord = {
      id: componentId,
      name,
      category,
      lastUsed: 0,
      useCount: 0,
      useCountLast30Days: 0,
      errorCount: 0,
      errorCountLast30Days: 0,
      averageLatencyMs: 0,
      healthStatus: 'healthy',
      isProtected: PROTECTED_CATEGORIES.includes(category),
    };

    // Enforce max records
    if (this._records.size >= MAX_RECORDS) {
      // Evict least recently used
      let oldestKey: string | null = null;
      let oldestTime = Infinity;
      for (const [key, rec] of this._records) {
        if (!rec.isProtected && rec.lastUsed < oldestTime) {
          oldestTime = rec.lastUsed;
          oldestKey = key;
        }
      }
      if (oldestKey) this._records.delete(oldestKey);
    }

    return record;
  }

  private _eventToComponentId(eventType: string): string {
    // Map event types to component IDs
    return `component:${eventType.toLowerCase()}`;
  }

  private _eventToCategory(eventType: string): string {
    if (eventType.startsWith('SENSOR_')) return 'sensor';
    if (eventType.startsWith('TASK_')) return 'task_engine';
    if (eventType.startsWith('STEP_')) return 'task_engine';
    if (eventType.startsWith('TOOL_')) return 'tool_execution';
    if (eventType.startsWith('EMAIL_')) return 'email';
    if (eventType.startsWith('TWEET_')) return 'social';
    if (eventType === 'WALLET_UPDATED') return 'wallet';
    return 'general';
  }

  // ── Persistence ─────────────────────────────────────────────────────────────

  private async _load(): Promise<void> {
    const data = await this._storage.get<ComponentRecord[]>(STORAGE_KEY, []);
    this._records.clear();
    for (const record of data) {
      this._records.set(record.id, record);
    }
  }

  private _save(): void {
    const records = [...this._records.values()];
    this._storage.update(STORAGE_KEY, records);
  }
}
