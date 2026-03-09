// ── ventureMemoryGraph.ts — Knowledge graph of venture outcomes ──────────────
//
// Connects venture proposals, decisions, and outcomes into a graph that
// informs future venture recommendations and expert routing.
// Persists via StorageAdapter.

import type { StorageAdapter } from '../platform';
import type { VentureProposal } from '../ventures/ventureTypes';
import type { VentureOutcomeRecord } from './learningTypes';
import type { PulseMetrics } from './signalCollector';

interface GraphData {
  ventures: VentureOutcomeRecord[];
  expertCombinations: ExpertComboRecord[];
}

interface ExpertComboRecord {
  ventureId: string;
  category: string;
  experts: string[];
  succeeded: boolean;
  timestamp: number;
}

const STORAGE_KEY = 'triforge.ventureMemoryGraph';
const MAX_VENTURES = 200;
const MAX_COMBOS = 500;

export class VentureMemoryGraph {
  constructor(private _storage: StorageAdapter) {}

  // ── Record events ─────────────────────────────────────────────────────────

  recordVenture(
    proposal: VentureProposal,
    decision: string,
    contributingExperts?: string[],
  ): void {
    const data = this._load();

    const record: VentureOutcomeRecord = {
      ventureId: proposal.id,
      category: proposal.winner.candidate.category,
      concept: proposal.winner.candidate.concept,
      decision: decision as VentureOutcomeRecord['decision'],
      timestamp: Date.now(),
      contributingExperts,
    };

    data.ventures.push(record);
    if (data.ventures.length > MAX_VENTURES) {
      data.ventures = data.ventures.slice(-MAX_VENTURES);
    }

    // Record expert combination if provided
    if (contributingExperts && contributingExperts.length > 0) {
      data.expertCombinations.push({
        ventureId: proposal.id,
        category: proposal.winner.candidate.category,
        experts: contributingExperts,
        succeeded: false, // will be updated on outcome
        timestamp: Date.now(),
      });
      if (data.expertCombinations.length > MAX_COMBOS) {
        data.expertCombinations = data.expertCombinations.slice(-MAX_COMBOS);
      }
    }

    this._save(data);
  }

  recordOutcome(ventureId: string, metrics: PulseMetrics): void {
    const data = this._load();
    const venture = data.ventures.find(v => v.ventureId === ventureId);
    if (venture) {
      if (metrics.performanceScore !== undefined) venture.performanceScore = metrics.performanceScore;
      if (metrics.revenueReached !== undefined) venture.revenueReached = metrics.revenueReached;
      if (metrics.subscriberCount !== undefined) venture.subscriberCount = metrics.subscriberCount;

      // Mark expert combo as succeeded if high performance
      if ((metrics.performanceScore ?? 0) >= 70) {
        const combo = data.expertCombinations.find(c => c.ventureId === ventureId);
        if (combo) combo.succeeded = true;
      }
    }
    this._save(data);
  }

  // ── Queries ───────────────────────────────────────────────────────────────

  getSimilarPastVentures(category: string, concept: string): VentureOutcomeRecord[] {
    const data = this._load();
    return data.ventures.filter(v => {
      if (v.category === category) return true;
      // Fuzzy concept match
      const words = concept.toLowerCase().split(/\s+/);
      const ventureWords = v.concept.toLowerCase().split(/\s+/);
      const overlap = words.filter(w => ventureWords.includes(w)).length;
      return overlap >= 2;
    });
  }

  getSuccessRate(category: string): number {
    const data = this._load();
    const categoryVentures = data.ventures.filter(v => v.category === category);
    if (categoryVentures.length === 0) return 0;

    const approved = categoryVentures.filter(v => v.decision === 'approved');
    const highPerf = approved.filter(v => (v.performanceScore ?? 0) >= 50);
    return Math.round((highPerf.length / categoryVentures.length) * 100);
  }

  getBestPerformingCategories(limit: number): string[] {
    const data = this._load();
    const scores: Record<string, { total: number; count: number }> = {};

    for (const v of data.ventures) {
      if (v.performanceScore === undefined) continue;
      if (!scores[v.category]) scores[v.category] = { total: 0, count: 0 };
      scores[v.category].total += v.performanceScore;
      scores[v.category].count++;
    }

    return Object.entries(scores)
      .map(([cat, { total, count }]) => ({ cat, avg: total / count }))
      .sort((a, b) => b.avg - a.avg)
      .slice(0, limit)
      .map(r => r.cat);
  }

  getWorstPerformingCategories(limit: number): string[] {
    const data = this._load();
    const scores: Record<string, { total: number; count: number }> = {};

    for (const v of data.ventures) {
      if (v.performanceScore === undefined) continue;
      if (!scores[v.category]) scores[v.category] = { total: 0, count: 0 };
      scores[v.category].total += v.performanceScore;
      scores[v.category].count++;
    }

    return Object.entries(scores)
      .map(([cat, { total, count }]) => ({ cat, avg: total / count }))
      .sort((a, b) => a.avg - b.avg)
      .slice(0, limit)
      .map(r => r.cat);
  }

  getBestExpertCombinations(category: string): string[][] {
    const data = this._load();
    return data.expertCombinations
      .filter(c => c.category === category && c.succeeded)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 5)
      .map(c => c.experts);
  }

  // ── Council context ───────────────────────────────────────────────────────

  generateInsightContext(): string {
    const data = this._load();
    if (data.ventures.length === 0) return '';

    const lines: string[] = ['VENTURE HISTORY INSIGHTS:'];

    // Total ventures
    lines.push(`Total ventures evaluated: ${data.ventures.length}`);

    // Approval rate
    const approved = data.ventures.filter(v => v.decision === 'approved').length;
    lines.push(`User approval rate: ${Math.round((approved / data.ventures.length) * 100)}%`);

    // Best categories
    const best = this.getBestPerformingCategories(3);
    if (best.length > 0) {
      lines.push(`Best performing: ${best.join(', ')}`);
    }

    // Worst categories
    const worst = this.getWorstPerformingCategories(2);
    if (worst.length > 0) {
      lines.push(`Underperforming: ${worst.join(', ')}`);
    }

    // Revenue successes
    const revenueHits = data.ventures.filter(v => v.revenueReached).length;
    if (revenueHits > 0) {
      lines.push(`Ventures reaching revenue: ${revenueHits}`);
    }

    return lines.join('\n');
  }

  // ── Private helpers ───────────────────────────────────────────────────────

  private _load(): GraphData {
    return this._storage.get<GraphData>(STORAGE_KEY, {
      ventures: [],
      expertCombinations: [],
    });
  }

  private _save(data: GraphData): void {
    this._storage.update(STORAGE_KEY, data);
  }
}
