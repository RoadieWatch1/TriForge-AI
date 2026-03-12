// ── shadowTestRunner.ts — Observational-only component testing ──────────────
//
// Captures baseline performance, simulates "without component" scenario,
// compares results, and always restores original state.
// NEVER modifies production state — observational only.

import type { ComponentUseTracker } from './componentUseTracker';
import type { EvolutionAuditLedger } from './evolutionAuditLedger';
import type {
  ShadowTestResult,
  PerformanceSnapshot,
  ShadowTestImpact,
  ShadowTestRecommendation,
} from './evolutionTypes';

export class ShadowTestRunner {
  private _tracker: ComponentUseTracker;
  private _ledger: EvolutionAuditLedger;
  private _testCounter = 0;

  constructor(tracker: ComponentUseTracker, ledger: EvolutionAuditLedger) {
    this._tracker = tracker;
    this._ledger = ledger;
  }

  // ── Run shadow test ─────────────────────────────────────────────────────────

  async runShadowTest(componentId: string): Promise<ShadowTestResult> {
    const testId = `shadow-test-${++this._testCounter}-${Date.now()}`;

    this._ledger.record('shadow_test_run', componentId, { testId });

    // Step 1: Capture baseline from existing metrics
    const baseline = this._captureBaseline(componentId);

    // Step 2: Simulate "without" — estimate impact by analyzing the component's
    // contribution relative to overall system. This is observational; we do NOT
    // actually disable the component.
    const withoutComponent = this._simulateWithout(componentId, baseline);

    // Step 3: Assess impact
    const impact = this.assessImpact(baseline, withoutComponent);
    const recommendation = this.makeRecommendation(impact);

    const result: ShadowTestResult = {
      testId,
      timestamp: Date.now(),
      componentId,
      baseline,
      withoutComponent,
      impact,
      recommendation,
    };

    this._ledger.record('shadow_test_completed', componentId, {
      testId,
      impact,
      recommendation,
    });

    return result;
  }

  // ── Impact assessment ───────────────────────────────────────────────────────

  assessImpact(
    baseline: PerformanceSnapshot,
    without: PerformanceSnapshot,
  ): ShadowTestImpact {
    // Compare key metrics — how much worse does the system get without this component?
    const responseTimeDelta = baseline.responseTimeMs > 0
      ? Math.abs(without.responseTimeMs - baseline.responseTimeMs) / baseline.responseTimeMs
      : 0;

    const errorRateDelta = Math.abs(without.errorRate - baseline.errorRate);

    const throughputDelta = baseline.throughput > 0
      ? Math.abs(without.throughput - baseline.throughput) / baseline.throughput
      : 0;

    // Use the worst degradation metric
    const maxDelta = Math.max(responseTimeDelta, errorRateDelta, throughputDelta);

    if (maxDelta > 0.2) return 'critical';     // >20% degradation
    if (maxDelta > 0.05) return 'significant';  // 5-20% degradation
    if (maxDelta > 0.01) return 'minor';         // 1-5% degradation
    return 'none';                               // <1% — negligible
  }

  makeRecommendation(impact: ShadowTestImpact): ShadowTestRecommendation {
    switch (impact) {
      case 'none':
      case 'minor':
        return 'quarantine';     // Safe to remove
      case 'significant':
        return 'investigate';    // Needs human review
      case 'critical':
        return 'keep';           // Essential component
    }
  }

  // ── Internals ───────────────────────────────────────────────────────────────

  private _captureBaseline(componentId: string): PerformanceSnapshot {
    const record = this._tracker.getRecord(componentId);

    if (!record) {
      return { responseTimeMs: 0, errorRate: 0, throughput: 0, memoryUsageMb: 0 };
    }

    const errorRate = record.useCount > 0
      ? record.errorCount / record.useCount
      : 0;

    return {
      responseTimeMs: record.averageLatencyMs,
      errorRate,
      throughput: record.useCountLast30Days,
      memoryUsageMb: 0, // Not tracked at component level; leave at 0
    };
  }

  private _simulateWithout(
    componentId: string,
    baseline: PerformanceSnapshot,
  ): PerformanceSnapshot {
    const record = this._tracker.getRecord(componentId);

    if (!record) {
      return { ...baseline }; // No change if component not found
    }

    // Simulation logic: estimate what happens if this component is removed.
    // Dormant components with zero recent activity → removal has near-zero impact.
    // Active components → removal proportional to their share of total throughput.

    const allRecords = this._tracker.getAllRecords();
    const totalThroughput = allRecords.reduce((sum, r) => sum + r.useCountLast30Days, 0);
    const componentShare = totalThroughput > 0
      ? record.useCountLast30Days / totalThroughput
      : 0;

    // If component is dormant (no recent use), simulated impact is near zero
    if (record.useCountLast30Days === 0) {
      return {
        responseTimeMs: baseline.responseTimeMs * 1.001,  // Negligible change
        errorRate: baseline.errorRate,
        throughput: baseline.throughput,
        memoryUsageMb: baseline.memoryUsageMb,
      };
    }

    // Active component: estimate proportional impact
    return {
      responseTimeMs: baseline.responseTimeMs * (1 + componentShare * 0.5),
      errorRate: baseline.errorRate + componentShare * 0.1,
      throughput: baseline.throughput * (1 - componentShare),
      memoryUsageMb: baseline.memoryUsageMb,
    };
  }
}
