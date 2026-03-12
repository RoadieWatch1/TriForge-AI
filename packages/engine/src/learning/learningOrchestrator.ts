// ── learningOrchestrator.ts — Top-level Learning Brain coordinator ───────────
//
// Wires all learning components together. Provides single-point API for
// venture pipeline integration: biases for scoring, context for council,
// expert recommendations, and maintenance.

import type { StorageAdapter } from '../platform';
import type { VentureProposal, MarketSignal } from '../ventures/ventureTypes';
import type { LearningConfig, VentureOutcomeRecord } from './learningTypes';
import { DEFAULT_LEARNING_CONFIG } from './learningTypes';
import { LearningProfileStore } from './learningProfileStore';
import { SignalCollector } from './signalCollector';
import type { PulseMetrics } from './signalCollector';
import { TrendTracker } from './trendTracker';
import type { SearchFn } from './trendTracker';
import {
  applyUserDecisionBias, applyOutcomeBias, applyTrendBias,
  applyExpertBias, computeBiases,
} from './biasEngine';
import { VentureMemoryGraph } from './ventureMemoryGraph';

export class LearningOrchestrator {
  private _profileStore: LearningProfileStore;
  private _collector: SignalCollector;
  private _trendTracker: TrendTracker;
  private _memoryGraph: VentureMemoryGraph;
  private _config: LearningConfig;

  constructor(
    storage: StorageAdapter,
    config?: Partial<LearningConfig>,
  ) {
    this._config = { ...DEFAULT_LEARNING_CONFIG, ...config };
    this._profileStore = new LearningProfileStore(storage, config);
    this._collector = new SignalCollector(config);
    this._trendTracker = new TrendTracker(storage);
    this._memoryGraph = new VentureMemoryGraph(storage);
  }

  // ── Initialization ────────────────────────────────────────────────────────

  initialize(): void {
    // Profile and stores auto-load on first access via StorageAdapter
    // Nothing extra needed here
  }

  // ── Event handlers ────────────────────────────────────────────────────────

  onVentureDecision(
    ventureId: string,
    decision: string,
    proposal: VentureProposal,
    contributingExperts?: string[],
  ): void {
    // Collect signal
    this._collector.ingestUserDecision(ventureId, decision, proposal);

    // Record in memory graph
    this._memoryGraph.recordVenture(proposal, decision, contributingExperts);

    // Build outcome record
    const record: VentureOutcomeRecord = {
      ventureId,
      category: proposal.winner.candidate.category,
      concept: proposal.winner.candidate.concept,
      decision: decision as VentureOutcomeRecord['decision'],
      timestamp: Date.now(),
      contributingExperts,
    };

    // Record in profile
    this._profileStore.recordDecision(record);

    // Apply bias
    const profile = this._profileStore.getProfile();
    applyUserDecisionBias(profile, record, this._config);
  }

  onVentureOutcome(ventureId: string, metrics: PulseMetrics): void {
    // Collect signal
    this._collector.ingestVentureOutcome(ventureId, metrics);

    // Update memory graph
    this._memoryGraph.recordOutcome(ventureId, metrics);

    // Update profile outcome
    this._profileStore.recordOutcome(ventureId, {
      performanceScore: metrics.performanceScore,
      revenueReached: metrics.revenueReached,
      subscriberCount: metrics.subscriberCount,
    });

    // Apply outcome bias
    const profile = this._profileStore.getProfile();
    const venture = profile.ventureHistory.find(v => v.ventureId === ventureId);
    if (venture) {
      applyOutcomeBias(profile, { ...venture, ...metrics }, this._config);
    }
  }

  onMarketResearch(signals: MarketSignal[]): void {
    this._collector.ingestMarketSignals(
      signals.map(s => ({ source: s.source, title: s.title, url: s.url }))
    );
  }

  onExpertContribution(
    expertId: string,
    ventureId: string,
    taskType: string,
    score: number,
    survived: boolean,
  ): void {
    this._collector.ingestExpertContribution(expertId, ventureId, taskType, score);
    this._profileStore.recordExpertContribution({
      expertId,
      ventureId,
      taskType,
      contributionScore: score,
      outputSurvived: survived,
      timestamp: Date.now(),
    });

    // Apply expert bias
    const profile = this._profileStore.getProfile();
    const recentContributions = profile.expertPerformanceHistory.slice(-50);
    applyExpertBias(profile, recentContributions, this._config);
  }

  // ── Trend refresh ─────────────────────────────────────────────────────────

  async refreshTrends(searchFn: SearchFn): Promise<void> {
    const snapshots = await this._trendTracker.refreshFromWeb(searchFn);

    // Apply trend biases
    if (snapshots.length > 0) {
      const profile = this._profileStore.getProfile();
      applyTrendBias(profile, snapshots, this._config);
    }
  }

  // ── Output for venture pipeline ───────────────────────────────────────────

  getBiasesForScoring(): Record<string, number> {
    const profile = this._profileStore.getProfile();
    return computeBiases(profile);
  }

  getContextForCouncil(): string {
    const parts: string[] = [];

    // Trend context
    const trendContext = this._trendTracker.getContextForCouncil();
    if (trendContext) parts.push(trendContext);

    // Memory graph insights
    const insightContext = this._memoryGraph.generateInsightContext();
    if (insightContext) parts.push(insightContext);

    // Category preferences summary
    const preferred = this._profileStore.getPreferredCategories(3);
    if (preferred.length > 0) {
      parts.push(`USER PREFERENCES: Preferred categories: ${preferred.join(', ')}`);
    }

    const profile = this._profileStore.getProfile();
    if (profile.avoidPatterns.length > 0) {
      parts.push(`Avoid patterns: ${profile.avoidPatterns.join(', ')}`);
    }

    return parts.join('\n\n');
  }

  getExpertRecommendations(taskType: string): string[] {
    // Use learning profile to recommend experts for a given task type
    const profile = this._profileStore.getProfile();
    const relevant = profile.expertPerformanceHistory
      .filter(r => r.taskType === taskType && r.outputSurvived)
      .sort((a, b) => b.contributionScore - a.contributionScore);

    // Deduplicate and return top expert IDs
    const seen = new Set<string>();
    const result: string[] = [];
    for (const r of relevant) {
      if (!seen.has(r.expertId)) {
        seen.add(r.expertId);
        result.push(r.expertId);
        if (result.length >= 5) break;
      }
    }
    return result;
  }

  // ── Accessors ─────────────────────────────────────────────────────────────

  getProfile() { return this._profileStore.getProfile(); }
  getMemoryGraph() { return this._memoryGraph; }
  getTrendTracker() { return this._trendTracker; }
  getCollector() { return this._collector; }

  // ── Maintenance ───────────────────────────────────────────────────────────

  runDecay(): void {
    this._profileStore.decay();
  }
}
