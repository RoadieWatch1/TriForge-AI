// ── learningEvolutionBridge.ts — Tri-directional integration bridge ──────────
//
// Connects Learning Brain, Expert Workforce, and Performance Hunter:
//
// Learning → Experts:  learning signals inform expert selection and routing
// Experts → Learning:  expert task results feed back into learning signals
// Learning → Evolution: venture outcomes feed component health
// Evolution → Learning: quarantined components inform learning avoidance
// Evolution → Experts:  flag dormant/redundant/expensive experts
// Experts → Evolution:  expert activity tracks as component health
//
// This bridge wires the three subsystems together without creating
// circular dependencies — each system talks to the bridge, not directly
// to each other.

import type { LearningOrchestrator } from '../learning/learningOrchestrator';
import type { ExpertWorkforceEngine } from '../experts/expertWorkforceEngine';
import type { EvolutionOrchestrator } from './evolutionOrchestrator';
import type { ExpertTaskResult } from '../experts/expertTypes';
import type { PlacementLearningBridge, PlacementReportSection } from '../placement/placementLearningBridge';

export interface UnifiedReport {
  timestamp: number;
  learning: {
    signalCount: number;
    biasCount: number;
    hotCategories: string[];
  };
  experts: {
    total: number;
    active: number;
    trial: number;
    watchlist: number;
    bench: number;
  };
  evolution: {
    totalComponents: number;
    healthy: number;
    degraded: number;
    dormant: number;
    quarantined: number;
  };
  placement?: PlacementReportSection;
}

export class LearningEvolutionBridge {
  private _learning: LearningOrchestrator;
  private _experts: ExpertWorkforceEngine;
  private _evolution: EvolutionOrchestrator;
  private _placementBridge: PlacementLearningBridge | null;

  constructor(
    learning: LearningOrchestrator,
    experts: ExpertWorkforceEngine,
    evolution: EvolutionOrchestrator,
    placementBridge?: PlacementLearningBridge,
  ) {
    this._learning = learning;
    this._experts = experts;
    this._evolution = evolution;
    this._placementBridge = placementBridge ?? null;
  }

  /** Set placement bridge after construction (avoids circular init). */
  setPlacementBridge(bridge: PlacementLearningBridge): void {
    this._placementBridge = bridge;
  }

  // ── Initialization — wire bidirectional signals ──────────────────────────────

  initialize(): void {
    // Register expert components in evolution tracker for health monitoring
    const allExperts = this._experts.getAllExperts();
    for (const expert of allExperts) {
      this._evolution.registerComponent(
        `expert:${expert.id}`,
        expert.name,
        'expert_workforce',
        {
          linkedExpertId: expert.id,
          isProtected: expert.protectionLevel === 'protected',
        },
      );
    }
  }

  // ── Learning → Experts bridge ───────────────────────────────────────────────

  /** Get expert recommendations from learning brain for a task type. */
  getExpertRecommendations(taskType: string): string[] {
    return this._learning.getExpertRecommendations(taskType);
  }

  /** Get learning context to inject into council/expert prompts. */
  getLearningContextForExperts(): string {
    return this._learning.getContextForCouncil();
  }

  // ── Experts → Learning bridge ───────────────────────────────────────────────

  /** Record an expert's task result in the learning brain. */
  recordExpertResultInLearning(result: ExpertTaskResult): void {
    this._learning.onExpertContribution(
      result.expertId,
      result.ventureId ?? '',
      result.taskType,
      result.outputSurvivedToFinal ? 80 : 20,
      result.outputSurvivedToFinal,
    );
  }

  // ── Evolution → Experts bridge ──────────────────────────────────────────────

  /** Flag dormant experts detected by Performance Hunter. */
  flagDormantExperts(thresholdDays: number): string[] {
    const dormant = this._evolution.tracker.getDormantComponents(thresholdDays);
    const dormantExpertIds: string[] = [];

    for (const comp of dormant) {
      if (comp.linkedExpertId) {
        dormantExpertIds.push(comp.linkedExpertId);
      }
    }

    return dormantExpertIds;
  }

  /** Flag experts whose components are quarantined. */
  getQuarantinedExpertIds(): string[] {
    const quarantined = this._evolution.getQuarantinedComponents();
    const expertIds: string[] = [];

    for (const componentId of quarantined) {
      const record = this._evolution.tracker.getRecord(componentId);
      if (record?.linkedExpertId) {
        expertIds.push(record.linkedExpertId);
      }
    }

    return expertIds;
  }

  // ── Experts → Evolution bridge ──────────────────────────────────────────────

  /** Track expert selection as component usage. */
  trackExpertSelection(expertId: string): void {
    this._evolution.tracker.trackUsage(
      `expert:${expertId}`,
      expertId,
      'expert_workforce',
    );
  }

  /** Track expert task result as component performance. */
  trackExpertTaskResult(result: ExpertTaskResult): void {
    const componentId = `expert:${result.expertId}`;
    this._evolution.tracker.trackUsage(componentId, result.expertId, 'expert_workforce');
    this._evolution.tracker.trackLatency(componentId, result.latencyMs);
    if (result.errorOccurred) {
      this._evolution.tracker.trackError(componentId, 'task_error');
    }
  }

  // ── Evolution → Learning bridge ─────────────────────────────────────────────

  /** Get health report as learning context. */
  getEvolutionContextForLearning(): string {
    return this._evolution.getHealthReport();
  }

  // ── Unified report ──────────────────────────────────────────────────────────

  async getUnifiedReport(): Promise<UnifiedReport> {
    // Learning
    const biases = this._learning.getBiasesForScoring();
    const recommendations = this._learning.getExpertRecommendations('venture_discovery');

    // Experts
    const health = this._experts.getRosterHealth();

    // Evolution
    const evolutionReport = await this._evolution.runFullScan();

    const report: UnifiedReport = {
      timestamp: Date.now(),
      learning: {
        signalCount: 0, // internal to orchestrator
        biasCount: Object.keys(biases).length,
        hotCategories: recommendations.slice(0, 5),
      },
      experts: {
        total: health.summary.total,
        active: health.summary.active,
        trial: health.summary.trial,
        watchlist: health.summary.watchlist,
        bench: health.summary.bench,
      },
      evolution: {
        totalComponents: evolutionReport.totalComponents,
        healthy: evolutionReport.healthy,
        degraded: evolutionReport.degraded,
        dormant: evolutionReport.dormant,
        quarantined: evolutionReport.quarantined,
      },
    };

    // Placement section (if bridge is wired)
    if (this._placementBridge) {
      report.placement = this._placementBridge.getPlacementReportSection();
    }

    return report;
  }

  // ── Unified maintenance cycle ───────────────────────────────────────────────

  async runUnifiedMaintenance(): Promise<{
    learningDecay: boolean;
    expertMaintenance: { watchlisted: string[]; benched: string[] };
    evolutionMaintenance: { autoRestored: string[] };
  }> {
    // 1. Learning decay
    this._learning.runDecay();

    // 2. Expert workforce maintenance
    const maintenanceReport = this._experts.runMaintenanceCycle();

    // Collect lifecycle actions from recommendations
    const watchlisted: string[] = [];
    const benched: string[] = [];
    for (const rec of maintenanceReport.recommendations) {
      if (rec.action === 'watchlist') watchlisted.push(rec.expertId);
      if (rec.action === 'bench') benched.push(rec.expertId);
    }

    // 3. Evolution auto-maintenance
    const evolutionResult = this._evolution.autoMaintenance();

    // 4. Cross-system: flag dormant experts from evolution
    //    But first check if poor performance is due to placement congestion
    const dormantExpertIds = this.flagDormantExperts(30);
    for (const expertId of dormantExpertIds) {
      // Placement-before-penalty check: if the expert is on a congested lane,
      // recommend rebalance instead of watchlist/bench
      if (this._placementBridge?.checkPlacementBeforePenalty(expertId)) {
        continue; // skip — issue is placement, not expert quality
      }

      // Add to watchlist if not already
      const expert = this._experts.getExpert(expertId);
      if (expert && expert.status === 'active') {
        this._experts.moveToWatchlist(expertId, 'Flagged dormant by Performance Hunter');
        watchlisted.push(expertId);
      }
    }

    return {
      learningDecay: true,
      expertMaintenance: { watchlisted, benched },
      evolutionMaintenance: evolutionResult,
    };
  }
}
