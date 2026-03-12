// ── signalCollector.ts — Ring buffer signal collector ────────────────────────
//
// Collects and normalizes learning signals from multiple sources.
// Ring buffer of configurable max size, oldest evicted first.
// Deduplicates by signal id.

import type { VentureProposal } from '../ventures/ventureTypes';
import type { LearningSignal, LearningSignalType, LearningConfig } from './learningTypes';
import { DEFAULT_LEARNING_CONFIG } from './learningTypes';

export interface PulseMetrics {
  performanceScore?: number;
  revenueReached?: boolean;
  subscriberCount?: number;
  trafficSessions?: number;
  conversionRate?: number;
}

export class SignalCollector {
  private _signals: LearningSignal[] = [];
  private _idSet = new Set<string>();
  private _maxSignals: number;

  constructor(config?: Partial<LearningConfig>) {
    this._maxSignals = config?.maxSignals ?? DEFAULT_LEARNING_CONFIG.maxSignals;
  }

  // ── Core ingestion ────────────────────────────────────────────────────────

  ingest(signal: LearningSignal): void {
    if (this._idSet.has(signal.id)) return; // dedup

    this._signals.push(signal);
    this._idSet.add(signal.id);

    // Evict oldest if over limit
    while (this._signals.length > this._maxSignals) {
      const evicted = this._signals.shift();
      if (evicted) this._idSet.delete(evicted.id);
    }
  }

  // ── Typed ingestion helpers ───────────────────────────────────────────────

  ingestUserDecision(
    ventureId: string,
    decision: string,
    proposal: VentureProposal,
  ): void {
    this.ingest({
      id: `decision:${ventureId}:${Date.now()}`,
      type: 'user_decision',
      source: 'venture_respond',
      timestamp: Date.now(),
      ventureId,
      weight: 1.0,
      data: {
        decision,
        winnerCategory: proposal.winner.candidate.category,
        winnerConcept: proposal.winner.candidate.concept,
        saferCategory: proposal.safer.candidate.category,
        aggressiveCategory: proposal.aggressive.candidate.category,
      },
    });
  }

  ingestVentureOutcome(ventureId: string, metrics: PulseMetrics): void {
    this.ingest({
      id: `outcome:${ventureId}:${Date.now()}`,
      type: 'venture_outcome',
      source: 'daily_pulse',
      timestamp: Date.now(),
      ventureId,
      weight: 0.8,
      data: { ...metrics },
    });
  }

  ingestMarketSignals(signals: { source: string; title: string; url: string }[]): void {
    for (const s of signals) {
      this.ingest({
        id: `market:${s.url}:${Date.now()}`,
        type: 'market_shift',
        source: s.source,
        timestamp: Date.now(),
        weight: 0.5,
        data: { title: s.title, url: s.url },
      });
    }
  }

  ingestExpertContribution(
    expertId: string,
    ventureId: string,
    taskType: string,
    score: number,
  ): void {
    this.ingest({
      id: `expert:${expertId}:${ventureId}:${Date.now()}`,
      type: 'expert_contribution',
      source: 'expert_router',
      timestamp: Date.now(),
      ventureId,
      expertId,
      weight: 0.7,
      data: { taskType, score },
    });
  }

  // ── Queries ───────────────────────────────────────────────────────────────

  getRecentSignals(type?: LearningSignalType, limit?: number): LearningSignal[] {
    let result = this._signals;
    if (type) result = result.filter(s => s.type === type);
    if (limit && limit > 0) result = result.slice(-limit);
    return result;
  }

  getSignalsByVenture(ventureId: string): LearningSignal[] {
    return this._signals.filter(s => s.ventureId === ventureId);
  }

  getSignalsByExpert(expertId: string): LearningSignal[] {
    return this._signals.filter(s => s.expertId === expertId);
  }

  get count(): number {
    return this._signals.length;
  }
}
