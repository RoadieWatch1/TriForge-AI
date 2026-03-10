// ── placementLearningBridge.ts — Connects Placement ↔ Learning ↔ Evolution ───
//
// Quad-directional integration:
//
// Placement → Learning:
//   Records placement outcomes so learning tracks which patterns improve quality.
//
// Learning → Placement:
//   Provides historically successful lanes and traffic spike predictions.
//
// Placement → Performance Hunter:
//   Feeds placement metrics to evolution component tracker so the hunter can
//   distinguish weak experts from overloaded experts.
//
// Performance Hunter → Placement:
//   When an expert is flagged as underperforming, the bridge checks if the
//   root cause is lane congestion rather than expert quality.

import type { LearningOrchestrator } from '../learning/learningOrchestrator';
import type { EvolutionOrchestrator } from '../evolution/evolutionOrchestrator';
import type { ExpertLoadTracker } from './expertLoadTracker';
import type { ChipCapacityMonitor } from './chipCapacityMonitor';
import type { PlacementDecision, PlacementReport } from './expertPlacementTypes';

// ── PlacementLearningBridge ──────────────────────────────────────────────────

export class PlacementLearningBridge {
  private learning: LearningOrchestrator;
  private evolution: EvolutionOrchestrator;
  private loadTracker: ExpertLoadTracker;
  private capacityMonitor: ChipCapacityMonitor;

  /** Placement outcome history for learning (recent N decisions + results). */
  private outcomeHistory: PlacementOutcomeEntry[] = [];

  constructor(
    learning: LearningOrchestrator,
    evolution: EvolutionOrchestrator,
    loadTracker: ExpertLoadTracker,
    capacityMonitor: ChipCapacityMonitor,
  ) {
    this.learning = learning;
    this.evolution = evolution;
    this.loadTracker = loadTracker;
    this.capacityMonitor = capacityMonitor;
  }

  // ── Initialization ───────────────────────────────────────────────────────

  initialize(): void {
    // Register placement-related components in evolution tracker so the
    // Performance Hunter can observe them.
    for (const lane of this.capacityMonitor.getAllLanes()) {
      this.evolution.tracker.registerComponent(
        `lane:${lane.id}`,
        `Lane ${lane.id}`,
        'placement',
      );
    }
  }

  // ── Placement → Learning ─────────────────────────────────────────────────

  /**
   * Record whether a placement decision improved or degraded performance.
   */
  recordPlacementOutcome(
    decision: PlacementDecision,
    resultLatencyMs: number,
    resultQuality: number, // 0-100
  ): void {
    const entry: PlacementOutcomeEntry = {
      decision,
      resultLatencyMs,
      resultQuality,
      timestamp: Date.now(),
    };

    this.outcomeHistory.push(entry);
    if (this.outcomeHistory.length > 100) {
      this.outcomeHistory.shift();
    }

    // Feed into learning as expert contribution signal
    this.learning.onExpertContribution(
      decision.expertId,
      '', // no specific ventureId
      'placement_migration',
      resultQuality,
      resultQuality >= 50, // survived = decent quality
    );
  }

  /**
   * Formatted placement insights for council prompts.
   */
  getPlacementInsights(): string {
    const parts: string[] = [];

    // Hot experts
    const hotExperts = this.loadTracker.getHotExperts();
    if (hotExperts.length > 0) {
      parts.push(
        `Hot experts (high invocation rate): ${hotExperts.map(e => e.expertId).join(', ')}`,
      );
    }

    // Saturated lanes
    const saturated = this.capacityMonitor.getSaturatedLanes();
    if (saturated.length > 0) {
      parts.push(
        `Saturated lanes: ${saturated.map(l => l.id).join(', ')}`,
      );
    }

    // Recent placement outcomes
    const recentOutcomes = this.outcomeHistory.slice(-10);
    const avgQuality = recentOutcomes.length > 0
      ? recentOutcomes.reduce((sum, o) => sum + o.resultQuality, 0) / recentOutcomes.length
      : -1;

    if (avgQuality >= 0) {
      parts.push(
        `Recent placement quality: ${avgQuality.toFixed(0)}/100 (${recentOutcomes.length} samples)`,
      );
    }

    return parts.length > 0
      ? `PLACEMENT STATUS:\n${parts.join('\n')}`
      : '';
  }

  // ── Learning → Placement ─────────────────────────────────────────────────

  /**
   * Get historically successful lanes for an expert.
   * Based on past placement outcomes where quality was high.
   */
  getPreferredPlacements(expertId: string): string[] {
    const relevant = this.outcomeHistory.filter(
      o => o.decision.expertId === expertId && o.resultQuality >= 70,
    );

    // Count lane successes
    const laneScores = new Map<string, number>();
    for (const o of relevant) {
      const lane = o.decision.toLane;
      laneScores.set(lane, (laneScores.get(lane) ?? 0) + o.resultQuality);
    }

    // Sort by cumulative quality
    return Array.from(laneScores.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([lane]) => lane);
  }

  /**
   * Predict which experts will be hot based on past patterns for a task type.
   * Uses learning history to identify experts that tend to get heavy load.
   */
  getTrafficSpikePredictions(taskType: string): string[] {
    const recommendations = this.learning.getExpertRecommendations(taskType);
    // Recommended experts for this task type are likely to be invoked heavily
    return recommendations;
  }

  // ── Placement → Performance Hunter ───────────────────────────────────────

  /**
   * Feed placement metrics to evolution component tracker.
   */
  reportPlacementHealth(expertId: string): void {
    const placement = this.loadTracker.getPlacement(expertId);
    if (!placement) return;

    const componentId = `expert:${expertId}`;
    const tracker = this.evolution.tracker;

    // Track usage — placement activity counts as component usage
    tracker.trackUsage(componentId, `Expert ${expertId}`, 'expert');

    // Track latency
    if (placement.avgRuntimeMs > 0) {
      tracker.trackLatency(componentId, placement.avgRuntimeMs);
    }

    // Track errors
    if (placement.failureRate > 0.2) {
      tracker.trackError(componentId,
        `Expert ${expertId} failure rate: ${(placement.failureRate * 100).toFixed(0)}%`,
      );
    }
  }

  /**
   * Check if an expert's poor performance is due to congested placement,
   * not expert quality.
   */
  isPlacementDegraded(expertId: string): boolean {
    const placement = this.loadTracker.getPlacement(expertId);
    if (!placement) return false;

    const lane = this.capacityMonitor.getLane(placement.currentLane);
    if (!lane) return false;

    // Lane is saturated or busy — expert may be starved
    return lane.utilization >= lane.saturationThreshold * 0.9;
  }

  // ── Performance Hunter → Placement ───────────────────────────────────────

  /**
   * Before benching/watchlisting an expert, check if the real issue is
   * placement congestion. Returns true if placement is the likely cause.
   *
   * Usage: the LearningEvolutionBridge should call this before penalizing
   * an expert. If true, recommend rebalance instead of bench/watchlist.
   */
  checkPlacementBeforePenalty(expertId: string): boolean {
    return this.isPlacementDegraded(expertId);
  }

  // ── Context for council ──────────────────────────────────────────────────

  /**
   * Get current placement status formatted for prompt injection.
   */
  getPlacementContextForCouncil(): string {
    return this.getPlacementInsights();
  }

  // ── Reporting ────────────────────────────────────────────────────────────

  /**
   * Get placement section for the unified report.
   */
  getPlacementReportSection(): PlacementReportSection {
    const allPlacements = this.loadTracker.getAllPlacements();
    const allLanes = this.capacityMonitor.getAllLanes();
    const hotExperts = this.loadTracker.getHotExperts();
    const saturatedLanes = this.capacityMonitor.getSaturatedLanes();

    return {
      totalExperts: allPlacements.length,
      hotExperts: hotExperts.length,
      totalLanes: allLanes.length,
      saturatedLanes: saturatedLanes.length,
      idleLanes: this.capacityMonitor.getIdleLanes().length,
      avgLaneUtilization: allLanes.length > 0
        ? allLanes.reduce((sum, l) => sum + l.utilization, 0) / allLanes.length
        : 0,
      recentOutcomeAvgQuality: this._recentAvgQuality(),
    };
  }

  // ── Internals ────────────────────────────────────────────────────────────

  private _recentAvgQuality(): number {
    const recent = this.outcomeHistory.slice(-20);
    if (recent.length === 0) return -1;
    return recent.reduce((sum, o) => sum + o.resultQuality, 0) / recent.length;
  }
}

// ── Supporting types ─────────────────────────────────────────────────────────

interface PlacementOutcomeEntry {
  decision: PlacementDecision;
  resultLatencyMs: number;
  resultQuality: number;
  timestamp: number;
}

export interface PlacementReportSection {
  totalExperts: number;
  hotExperts: number;
  totalLanes: number;
  saturatedLanes: number;
  idleLanes: number;
  avgLaneUtilization: number;
  recentOutcomeAvgQuality: number;
}
