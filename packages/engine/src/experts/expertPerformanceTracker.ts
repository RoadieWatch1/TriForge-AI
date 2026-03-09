// ── expertPerformanceTracker.ts — Expert contribution tracking ───────────────
//
// Tracks how each expert performs: selection frequency, output survival,
// approval influence, revenue correlation, latency, errors, redundancy.
// Persists via StorageAdapter.

import type { StorageAdapter } from '../platform';
import type {
  ExpertTaskResult, ExpertPerformanceRecord, PerformancePeriod,
} from './expertTypes';

interface PerformanceData {
  taskResults: ExpertTaskResult[];
  survivalRecords: SurvivalRecord[];
}

interface SurvivalRecord {
  expertId: string;
  ventureId: string;
  survived: boolean;
  timestamp: number;
}

const STORAGE_KEY = 'triforge.expertPerformance';
const MAX_TASK_RESULTS = 2000;
const MAX_SURVIVAL_RECORDS = 1000;

export class ExpertPerformanceTracker {
  constructor(private _storage: StorageAdapter) {}

  // ── Recording ─────────────────────────────────────────────────────────────

  recordTaskResult(result: ExpertTaskResult): void {
    const data = this._load();
    data.taskResults.push(result);
    if (data.taskResults.length > MAX_TASK_RESULTS) {
      data.taskResults = data.taskResults.slice(-MAX_TASK_RESULTS);
    }
    this._save(data);
  }

  recordOutputSurvival(expertId: string, ventureId: string, survived: boolean): void {
    const data = this._load();
    data.survivalRecords.push({ expertId, ventureId, survived, timestamp: Date.now() });
    if (data.survivalRecords.length > MAX_SURVIVAL_RECORDS) {
      data.survivalRecords = data.survivalRecords.slice(-MAX_SURVIVAL_RECORDS);
    }
    this._save(data);
  }

  // ── Queries ───────────────────────────────────────────────────────────────

  getPerformanceRecord(expertId: string, period?: PerformancePeriod): ExpertPerformanceRecord {
    const data = this._load();
    const cutoff = periodCutoff(period ?? 'monthly');
    const results = data.taskResults.filter(
      r => r.expertId === expertId && r.timestamp >= cutoff
    );
    const survivals = data.survivalRecords.filter(
      r => r.expertId === expertId && r.timestamp >= cutoff
    );

    const selectionCount = results.length;
    const outputSurvivedRate = survivals.length > 0
      ? survivals.filter(s => s.survived).length / survivals.length
      : 0;
    const errors = results.filter(r => r.errorOccurred).length;
    const errorRate = selectionCount > 0 ? errors / selectionCount : 0;
    const avgLatencyMs = selectionCount > 0
      ? results.reduce((s, r) => s + r.latencyMs, 0) / selectionCount
      : 0;
    const avgTokenCost = selectionCount > 0
      ? results.reduce((s, r) => s + r.tokenCount, 0) / selectionCount
      : 0;

    return {
      expertId,
      period: period ?? 'monthly',
      selectionCount,
      outputSurvivedRate,
      approvalInfluence: 0, // computed via learning bridge
      revenueInfluence: 0,  // computed via learning bridge
      errorRate,
      avgLatencyMs,
      avgTokenCost,
      redundancyScore: this.computeRedundancyScore(expertId),
      timestamp: Date.now(),
    };
  }

  getTopExperts(limit: number, metric?: string): string[] {
    const data = this._load();
    const expertIds = [...new Set(data.taskResults.map(r => r.expertId))];
    const scored: Array<{ id: string; score: number }> = [];

    for (const id of expertIds) {
      const perf = this.getPerformanceRecord(id);
      let score: number;
      switch (metric) {
        case 'survival': score = perf.outputSurvivedRate; break;
        case 'selection': score = perf.selectionCount; break;
        case 'errorRate': score = 1 - perf.errorRate; break; // lower error = higher score
        default: score = perf.outputSurvivedRate * 0.6 + (1 - perf.errorRate) * 0.4;
      }
      scored.push({ id, score });
    }

    return scored
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(s => s.id);
  }

  getUnderperformers(survivalThreshold: number): string[] {
    const data = this._load();
    const expertIds = [...new Set(data.taskResults.map(r => r.expertId))];
    const result: string[] = [];

    for (const id of expertIds) {
      const perf = this.getPerformanceRecord(id);
      if (perf.selectionCount >= 5 && perf.outputSurvivedRate < survivalThreshold) {
        result.push(id);
      }
    }
    return result;
  }

  getDormantExperts(daysSinceLastSelection: number): string[] {
    const data = this._load();
    const cutoff = Date.now() - daysSinceLastSelection * 24 * 60 * 60 * 1000;
    const expertIds = [...new Set(data.taskResults.map(r => r.expertId))];
    const result: string[] = [];

    for (const id of expertIds) {
      const latest = data.taskResults
        .filter(r => r.expertId === id)
        .sort((a, b) => b.timestamp - a.timestamp)[0];
      if (latest && latest.timestamp < cutoff) {
        result.push(id);
      }
    }
    return result;
  }

  getRedundantExperts(): string[] {
    const data = this._load();
    const expertIds = [...new Set(data.taskResults.map(r => r.expertId))];
    return expertIds.filter(id => this.computeRedundancyScore(id) > 70);
  }

  // ── Score computation ─────────────────────────────────────────────────────

  computeRedundancyScore(expertId: string): number {
    const data = this._load();
    const survivals = data.survivalRecords.filter(r => r.expertId === expertId);
    if (survivals.length < 5) return 0; // not enough data

    const survivalRate = survivals.filter(s => s.survived).length / survivals.length;

    // High redundancy = low survival (output rarely makes it to final)
    return Math.round((1 - survivalRate) * 100);
  }

  computeContributionScore(expertId: string): number {
    const perf = this.getPerformanceRecord(expertId);
    if (perf.selectionCount === 0) return 50; // neutral for new experts

    // Weighted: 60% survival, 25% low error, 15% selection frequency
    const survivalScore = perf.outputSurvivedRate * 100;
    const errorScore = (1 - perf.errorRate) * 100;
    const selectionScore = Math.min(100, perf.selectionCount * 5); // cap at 20 selections

    return Math.round(survivalScore * 0.6 + errorScore * 0.25 + selectionScore * 0.15);
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private _load(): PerformanceData {
    return this._storage.get<PerformanceData>(STORAGE_KEY, {
      taskResults: [],
      survivalRecords: [],
    });
  }

  private _save(data: PerformanceData): void {
    this._storage.update(STORAGE_KEY, data);
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function periodCutoff(period: PerformancePeriod): number {
  const now = Date.now();
  switch (period) {
    case 'daily': return now - 24 * 60 * 60 * 1000;
    case 'weekly': return now - 7 * 24 * 60 * 60 * 1000;
    case 'monthly': return now - 30 * 24 * 60 * 60 * 1000;
  }
}
