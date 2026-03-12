// ── engine/src/trading/readiness.ts ───────────────────────────────────────────
//
// Phase 5: Pure readiness evaluation for shadow trading strategy.
// No I/O — operates on arrays of ShadowDecisionEvent.
// Advisory only — does not enable live trading.

import type {
  ShadowDecisionEvent, ShadowPerformanceSummary,
  StrategyReadinessState, ReadinessThresholds,
  ThresholdCheck, StabilityCheck, StrategyReadinessReport,
} from './types';
import { DEFAULT_READINESS_THRESHOLDS } from './types';
import { computePerformanceSummary } from './analytics';

// ── Internal helpers ─────────────────────────────────────────────────────────

function mean(vals: number[]): number {
  return vals.length === 0 ? 0 : vals.reduce((a, b) => a + b, 0) / vals.length;
}

function closedTrades(events: ShadowDecisionEvent[]): ShadowDecisionEvent[] {
  return events.filter(e => e.stage === 'trade_closed' && e.pnlR !== undefined);
}

// ── Max drawdown in R-multiples ──────────────────────────────────────────────

function computeMaxDrawdownR(events: ShadowDecisionEvent[]): number {
  const trades = closedTrades(events).sort((a, b) => a.timestamp - b.timestamp);
  let peakR = 0;
  let runningR = 0;
  let maxDD = 0;
  for (const t of trades) {
    runningR += t.pnlR ?? 0;
    if (runningR > peakR) peakR = runningR;
    const dd = peakR - runningR;
    if (dd > maxDD) maxDD = dd;
  }
  return maxDD;
}

// ── Threshold evaluation ─────────────────────────────────────────────────────

function evaluateThresholds(
  perf: ShadowPerformanceSummary,
  thresholds: ReadinessThresholds,
  targetState: string,
  maxDrawdownR: number,
): ThresholdCheck[] {
  const checks: ThresholdCheck[] = [];

  // minTrades
  checks.push({
    key: 'minTrades',
    currentValue: perf.totalTrades,
    requiredValue: thresholds.minTrades,
    passed: perf.totalTrades >= thresholds.minTrades,
    rationale: `${perf.totalTrades} trades ${perf.totalTrades >= thresholds.minTrades ? 'meets' : 'below'} ${targetState} minimum of ${thresholds.minTrades}.`,
  });

  // minWinRate
  checks.push({
    key: 'minWinRate',
    currentValue: perf.winRate,
    requiredValue: thresholds.minWinRate,
    passed: perf.winRate >= thresholds.minWinRate,
    rationale: `Win rate ${(perf.winRate * 100).toFixed(1)}% ${perf.winRate >= thresholds.minWinRate ? 'meets' : 'below'} ${targetState} floor of ${(thresholds.minWinRate * 100).toFixed(0)}%.`,
  });

  // minAvgPnlR
  if (thresholds.minAvgPnlR !== undefined) {
    checks.push({
      key: 'minAvgPnlR',
      currentValue: perf.avgPnlR,
      requiredValue: thresholds.minAvgPnlR,
      passed: perf.avgPnlR >= thresholds.minAvgPnlR,
      rationale: `Avg P/L ${perf.avgPnlR.toFixed(2)}R ${perf.avgPnlR >= thresholds.minAvgPnlR ? 'meets' : 'below'} ${targetState} floor of ${thresholds.minAvgPnlR.toFixed(2)}R.`,
    });
  }

  // minProfitFactor
  if (thresholds.minProfitFactor !== undefined) {
    const pfDisplay = perf.profitFactor === Infinity ? '\u221e' : perf.profitFactor.toFixed(2);
    checks.push({
      key: 'minProfitFactor',
      currentValue: perf.profitFactor,
      requiredValue: thresholds.minProfitFactor,
      passed: perf.profitFactor >= thresholds.minProfitFactor,
      rationale: `Profit factor ${pfDisplay} ${perf.profitFactor >= thresholds.minProfitFactor ? 'meets' : 'below'} ${targetState} floor of ${thresholds.minProfitFactor.toFixed(1)}.`,
    });
  }

  // maxConsecutiveLosses
  if (thresholds.maxConsecutiveLosses !== undefined) {
    checks.push({
      key: 'maxConsecutiveLosses',
      currentValue: perf.maxConsecutiveLosses,
      requiredValue: thresholds.maxConsecutiveLosses,
      passed: perf.maxConsecutiveLosses <= thresholds.maxConsecutiveLosses,
      rationale: `Max consecutive losses ${perf.maxConsecutiveLosses} ${perf.maxConsecutiveLosses <= thresholds.maxConsecutiveLosses ? 'within' : 'exceeds'} ${targetState} limit of ${thresholds.maxConsecutiveLosses}.`,
    });
  }

  // minEdgeCaptureRatio
  if (thresholds.minEdgeCaptureRatio !== undefined) {
    checks.push({
      key: 'minEdgeCaptureRatio',
      currentValue: perf.edgeCaptureRatio,
      requiredValue: thresholds.minEdgeCaptureRatio,
      passed: perf.edgeCaptureRatio >= thresholds.minEdgeCaptureRatio,
      rationale: `Edge capture ${(perf.edgeCaptureRatio * 100).toFixed(0)}% ${perf.edgeCaptureRatio >= thresholds.minEdgeCaptureRatio ? 'meets' : 'below'} ${targetState} floor of ${(thresholds.minEdgeCaptureRatio * 100).toFixed(0)}%.`,
    });
  }

  // maxDrawdownR
  if (thresholds.maxDrawdownR !== undefined) {
    checks.push({
      key: 'maxDrawdownR',
      currentValue: maxDrawdownR,
      requiredValue: thresholds.maxDrawdownR,
      passed: maxDrawdownR <= thresholds.maxDrawdownR,
      rationale: `Max drawdown ${maxDrawdownR.toFixed(2)}R ${maxDrawdownR <= thresholds.maxDrawdownR ? 'within' : 'exceeds'} ${targetState} limit of ${thresholds.maxDrawdownR}R.`,
    });
  }

  return checks;
}

// ── Stability evaluation ─────────────────────────────────────────────────────

function evaluateStability(events: ShadowDecisionEvent[]): {
  checks: StabilityCheck[];
  passed: boolean;
} {
  const trades = closedTrades(events);
  const totalClosed = trades.length;

  // ── Overall sample gate: < 15 trades → insufficient evidence, not instability
  if (totalClosed < 15) {
    return {
      checks: [{
        category: 'session',
        bucket: 'all',
        trades: totalClosed,
        metric: 0,
        metricName: 'winRate',
        passed: true,
        rationale: `Insufficient distribution evidence (${totalClosed} < 15 trades).`,
      }, {
        category: 'volatility_regime',
        bucket: 'all',
        trades: totalClosed,
        metric: 0,
        metricName: 'avgPnlR',
        passed: true,
        rationale: `Insufficient distribution evidence (${totalClosed} < 15 trades).`,
      }],
      passed: true,
    };
  }

  const checks: StabilityCheck[] = [];

  // ── Per-session stability: at least 2 sessions with 5+ trades and winRate >= 0.40
  const sessionGroups = new Map<string, ShadowDecisionEvent[]>();
  for (const t of trades) {
    const key = t.sessionLabel ?? 'unknown';
    let arr = sessionGroups.get(key);
    if (!arr) { arr = []; sessionGroups.set(key, arr); }
    arr.push(t);
  }

  let qualifiedSessions = 0;
  for (const [bucket, group] of sessionGroups) {
    const wins = group.filter(t => (t.pnlR ?? 0) > 0);
    const wr = group.length > 0 ? wins.length / group.length : 0;
    const qualified = group.length >= 5 && wr >= 0.40;
    if (qualified) qualifiedSessions++;
    checks.push({
      category: 'session',
      bucket,
      trades: group.length,
      metric: wr,
      metricName: 'winRate',
      passed: qualified,
      rationale: group.length < 5
        ? `${bucket}: only ${group.length} trades (need 5+).`
        : wr < 0.40
          ? `${bucket}: ${(wr * 100).toFixed(0)}% win rate below 40% floor.`
          : `${bucket}: ${group.length} trades, ${(wr * 100).toFixed(0)}% win rate — qualified.`,
    });
  }

  // ── Per-volatility-regime stability: at least 2 regimes with 5+ trades and avgPnlR >= 0
  const volGroups = new Map<string, ShadowDecisionEvent[]>();
  for (const t of trades) {
    const key = t.volatilityRegime ?? 'unknown';
    let arr = volGroups.get(key);
    if (!arr) { arr = []; volGroups.set(key, arr); }
    arr.push(t);
  }

  let qualifiedRegimes = 0;
  for (const [bucket, group] of volGroups) {
    const avgPnlR = mean(group.map(t => t.pnlR ?? 0));
    const qualified = group.length >= 5 && avgPnlR >= 0;
    if (qualified) qualifiedRegimes++;
    checks.push({
      category: 'volatility_regime',
      bucket,
      trades: group.length,
      metric: avgPnlR,
      metricName: 'avgPnlR',
      passed: qualified,
      rationale: group.length < 5
        ? `${bucket}: only ${group.length} trades (need 5+).`
        : avgPnlR < 0
          ? `${bucket}: ${avgPnlR.toFixed(2)}R avg below breakeven.`
          : `${bucket}: ${group.length} trades, ${avgPnlR.toFixed(2)}R avg — qualified.`,
    });
  }

  const sessionStable = qualifiedSessions >= 2;
  const regimeStable = qualifiedRegimes >= 2;

  return { checks, passed: sessionStable && regimeStable };
}

// ── Main evaluator ───────────────────────────────────────────────────────────

const STATE_LABELS: Record<StrategyReadinessState, string> = {
  not_ready: 'Insufficient data to evaluate strategy readiness.',
  developing: 'Strategy is showing early promise but has not met promotion thresholds.',
  paper_ready: 'Strategy is performing consistently in shadow mode.',
  guarded_live_candidate: 'Strategy has demonstrated shadow-proven performance and is eligible for manual review.',
};

const NEXT_STATE: Record<StrategyReadinessState, Exclude<StrategyReadinessState, 'not_ready'> | null> = {
  not_ready: 'developing',
  developing: 'paper_ready',
  paper_ready: 'guarded_live_candidate',
  guarded_live_candidate: null,
};

export function evaluateReadiness(
  events: ShadowDecisionEvent[],
  thresholds?: Record<Exclude<StrategyReadinessState, 'not_ready'>, ReadinessThresholds>,
): StrategyReadinessReport {
  const t = thresholds ?? DEFAULT_READINESS_THRESHOLDS;
  const perf = computePerformanceSummary(events);
  const maxDD = computeMaxDrawdownR(events);
  const stability = evaluateStability(events);

  // Step through states from highest to lowest
  const candidates: Exclude<StrategyReadinessState, 'not_ready'>[] = [
    'guarded_live_candidate', 'paper_ready', 'developing',
  ];

  let resolvedState: StrategyReadinessState = 'not_ready';
  for (const candidate of candidates) {
    const checks = evaluateThresholds(perf, t[candidate], candidate, maxDD);
    if (checks.every(c => c.passed)) {
      resolvedState = candidate;
      break;
    }
  }

  // Stability cap: if stability fails, cap at 'developing' max
  if (!stability.passed && (resolvedState === 'paper_ready' || resolvedState === 'guarded_live_candidate')) {
    resolvedState = 'developing';
  }

  // Report checks: show threshold checks for the NEXT state up (explainability)
  const nextState = NEXT_STATE[resolvedState];
  const reportChecks = nextState
    ? evaluateThresholds(perf, t[nextState], nextState, maxDD)
    : evaluateThresholds(perf, t.guarded_live_candidate, 'guarded_live_candidate', maxDD);

  // Blockers: human-readable reasons preventing next state
  const blockers: string[] = [];
  for (const fc of reportChecks.filter(c => !c.passed)) {
    blockers.push(fc.rationale);
  }
  if (!stability.passed) {
    const failedStab = stability.checks.filter(c => !c.passed);
    if (failedStab.length > 0) {
      blockers.push(`Stability: ${failedStab.length} bucket(s) do not meet minimum requirements.`);
    }
  }

  const advisory = `${STATE_LABELS[resolvedState]} This status is advisory. It does not enable live trading.`;

  return {
    state: resolvedState,
    generatedAt: Date.now(),
    performance: perf,
    maxDrawdownR: maxDD,
    thresholdChecks: reportChecks,
    stabilityChecks: stability.checks,
    stabilityPassed: stability.passed,
    blockers,
    advisory,
  };
}
