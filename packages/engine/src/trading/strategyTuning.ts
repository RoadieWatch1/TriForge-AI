// ── engine/src/trading/strategyTuning.ts ──────────────────────────────────────
//
// Phase 4: Pure insight functions for evidence-driven strategy refinement.
// No I/O — operates on arrays of ShadowDecisionEvent.
// All recommendations are advisory — not auto-applied.

import type {
  ShadowDecisionEvent, ShadowStrategyConfig,
  StrategyInsight, StrategyRefinementSummary,
  InsightRecommendation,
} from './types';

// ── Internal helpers ─────────────────────────────────────────────────────────

type InsightCategory = StrategyInsight['category'];

interface Baseline { winRate: number; avgPnlR: number; }

interface BucketStats {
  bucket: string;
  trades: number;
  winRate: number;
  avgPnlR: number;
  totalPnlDollars: number;
}

function mean(vals: number[]): number {
  return vals.length === 0 ? 0 : vals.reduce((a, b) => a + b, 0) / vals.length;
}

function closedTrades(events: ShadowDecisionEvent[]): ShadowDecisionEvent[] {
  return events.filter(e => e.stage === 'trade_closed' && e.pnlR !== undefined);
}

function sampleTier(count: number): 'watch' | 'limited' | 'full' {
  if (count < 10) return 'watch';
  if (count < 25) return 'limited';
  return 'full';
}

/** Caps recommendations based on total closed-trade sample size. */
function overallSampleGate(
  totalClosedTrades: number,
  insights: StrategyInsight[],
): StrategyInsight[] {
  if (totalClosedTrades >= 25) return insights;

  const cap: InsightRecommendation = totalClosedTrades < 15 ? 'watch' : 'keep';

  return insights.map(i => {
    if (cap === 'watch' && i.recommendation !== 'watch') {
      return { ...i, recommendation: 'watch' as InsightRecommendation,
        rationale: `${i.rationale} [capped: <15 total trades]` };
    }
    if (cap === 'keep' && (i.recommendation === 'promote' || i.recommendation === 'block')) {
      const capped: InsightRecommendation = i.recommendation === 'promote' ? 'keep' : 'demote';
      return { ...i, recommendation: capped,
        rationale: `${i.rationale} [capped: <25 total trades]` };
    }
    return i;
  });
}

/**
 * Classify a bucket relative to baseline.
 * Handles near-zero and negative baselines with absolute thresholds.
 */
function classify(
  stats: BucketStats,
  baseline: Baseline,
): InsightRecommendation {
  const tier = sampleTier(stats.trades);
  if (tier === 'watch') return 'watch';

  const { avgPnlR, winRate } = stats;
  const bAvg = baseline.avgPnlR;
  const bWin = baseline.winRate;

  // ── Near-zero baseline (between -0.05 and +0.05) ──
  if (bAvg > -0.05 && bAvg < 0.05) {
    if (tier === 'full') {
      if (avgPnlR >= 0.15 && winRate >= bWin + 0.05) return 'promote';
      if (avgPnlR >= 0) return 'keep';
      if (avgPnlR < -0.15 && winRate < bWin - 0.10) return 'block';
      return 'watch';
    }
    // limited
    if (avgPnlR >= 0.10) return 'keep';
    if (avgPnlR < -0.15 && winRate < bWin - 0.10) return 'demote';
    return 'watch';
  }

  // ── Negative baseline (< -0.05) ──
  if (bAvg < -0.05) {
    if (tier === 'full') {
      if (avgPnlR > 0 && winRate >= bWin) return 'promote';
      if (avgPnlR > bAvg) return 'keep';
      if (avgPnlR <= bAvg && winRate < bWin - 0.10) return 'block';
      return 'watch';
    }
    // limited
    if (avgPnlR > 0) return 'keep';
    if (avgPnlR <= bAvg && winRate < bWin - 0.10) return 'demote';
    return 'watch';
  }

  // ── Normal baseline (>= 0.05) — multiplicative comparisons safe ──
  if (tier === 'limited') {
    if (avgPnlR >= bAvg * 1.3) return 'keep';
    if (avgPnlR <= bAvg * 0.5 && winRate < bWin - 0.15) return 'demote';
    return 'watch';
  }

  // full
  if (avgPnlR >= bAvg * 1.5 && winRate >= bWin) return 'promote';
  if (avgPnlR >= bAvg * 0.8) return 'keep';
  if (avgPnlR >= bAvg * 0.5) return 'watch';
  if (winRate < bWin - 0.15 && avgPnlR < 0) return 'block';
  return 'demote';
}

function rationale(bucket: string, stats: BucketStats, baseline: Baseline, rec: InsightRecommendation): string {
  const wr = (stats.winRate * 100).toFixed(0);
  const bwr = (baseline.winRate * 100).toFixed(0);
  const avgR = stats.avgPnlR >= 0 ? `+${stats.avgPnlR.toFixed(2)}R` : `${stats.avgPnlR.toFixed(2)}R`;
  return `${bucket}: ${stats.trades} trades, ${wr}% win (vs ${bwr}%), ${avgR} — ${rec}`;
}

function buildInsightsFromBuckets(
  events: ShadowDecisionEvent[],
  category: InsightCategory,
  bucketFn: (e: ShadowDecisionEvent) => string,
  baseline: Baseline,
): StrategyInsight[] {
  const trades = closedTrades(events);
  const groups = new Map<string, ShadowDecisionEvent[]>();

  for (const t of trades) {
    const key = bucketFn(t);
    let arr = groups.get(key);
    if (!arr) { arr = []; groups.set(key, arr); }
    arr.push(t);
  }

  return [...groups.entries()].map(([bucket, group]) => {
    const wins = group.filter(t => (t.pnlR ?? 0) > 0);
    const stats: BucketStats = {
      bucket,
      trades: group.length,
      winRate: group.length > 0 ? wins.length / group.length : 0,
      avgPnlR: mean(group.map(t => t.pnlR ?? 0)),
      totalPnlDollars: group.reduce((s, t) => s + (t.pnl ?? 0), 0),
    };

    const rec = classify(stats, baseline);

    return {
      category,
      bucket,
      trades: stats.trades,
      winRate: stats.winRate,
      avgPnlR: stats.avgPnlR,
      totalPnlDollars: stats.totalPnlDollars,
      baselineWinRate: baseline.winRate,
      baselineAvgPnlR: baseline.avgPnlR,
      sampleTier: sampleTier(stats.trades),
      recommendation: rec,
      rationale: rationale(bucket, stats, baseline, rec),
    };
  }).sort((a, b) => b.trades - a.trades);
}

// ── Exported insight functions ───────────────────────────────────────────────

export function computeSessionInsights(events: ShadowDecisionEvent[], baseline: Baseline): StrategyInsight[] {
  return buildInsightsFromBuckets(events, 'session', e => e.sessionLabel ?? 'unknown', baseline);
}

export function computeVolatilityInsights(events: ShadowDecisionEvent[], baseline: Baseline): StrategyInsight[] {
  return buildInsightsFromBuckets(events, 'volatility', e => e.volatilityRegime ?? 'unknown', baseline);
}

export function computeVwapInsights(events: ShadowDecisionEvent[], baseline: Baseline): StrategyInsight[] {
  return buildInsightsFromBuckets(events, 'vwap', e => e.vwapRelation ?? 'unknown', baseline);
}

export function computeInstrumentInsights(events: ShadowDecisionEvent[], baseline: Baseline): StrategyInsight[] {
  return buildInsightsFromBuckets(events, 'instrument', e => e.symbol ?? 'unknown', baseline);
}

export function computeCouncilConfidenceInsights(events: ShadowDecisionEvent[], baseline: Baseline): StrategyInsight[] {
  return buildInsightsFromBuckets(events, 'council_confidence', e => {
    const votes = e.councilVotes;
    if (!votes || votes.length === 0) return 'unknown';
    const avg = votes.reduce((s, v) => s + (v.confidence ?? 0), 0) / votes.length;
    if (avg < 50) return '<50';
    if (avg < 65) return '50-64';
    if (avg < 80) return '65-79';
    return '80+';
  }, baseline);
}

export function computeWarningInsights(events: ShadowDecisionEvent[], baseline: Baseline): StrategyInsight[] {
  return buildInsightsFromBuckets(events, 'warnings', e => {
    const wc = e.warningCount ?? 0;
    if (wc === 0) return '0';
    if (wc === 1) return '1';
    if (wc === 2) return '2';
    return '3+';
  }, baseline);
}

// ── Aggregate ────────────────────────────────────────────────────────────────

export function computeRefinementSummary(
  events: ShadowDecisionEvent[],
  config: ShadowStrategyConfig,
): StrategyRefinementSummary {
  const trades = closedTrades(events);
  const totalClosedTrades = trades.length;

  const wins = trades.filter(t => (t.pnlR ?? 0) > 0);
  const baselineWinRate = totalClosedTrades > 0 ? wins.length / totalClosedTrades : 0;
  const baselineAvgPnlR = mean(trades.map(t => t.pnlR ?? 0));
  const baseline: Baseline = { winRate: baselineWinRate, avgPnlR: baselineAvgPnlR };

  const rawInsights = [
    ...computeSessionInsights(events, baseline),
    ...computeVolatilityInsights(events, baseline),
    ...computeVwapInsights(events, baseline),
    ...computeInstrumentInsights(events, baseline),
    ...computeCouncilConfidenceInsights(events, baseline),
    ...computeWarningInsights(events, baseline),
  ];

  const insights = overallSampleGate(totalClosedTrades, rawInsights);

  return {
    generatedAt: Date.now(),
    totalClosedTrades,
    baselineWinRate,
    baselineAvgPnlR,
    insights,
    config,
  };
}
