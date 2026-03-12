// ── engine/src/trading/analytics.ts ───────────────────────────────────────────
//
// Phase 3: Pure summary functions for shadow trading analytics.
// No I/O — operates on arrays of ShadowDecisionEvent.

import type {
  ShadowDecisionEvent, ShadowDecisionStage, ShadowBlockReason,
  ShadowPerformanceSummary, BucketPerformanceSummary,
  CouncilEffectivenessSummary, ShadowAnalyticsSummary,
} from './types';

// ── Helpers ──────────────────────────────────────────────────────────────────

function mean(vals: number[]): number {
  return vals.length === 0 ? 0 : vals.reduce((a, b) => a + b, 0) / vals.length;
}

function closedTrades(events: ShadowDecisionEvent[]): ShadowDecisionEvent[] {
  return events.filter(e => e.stage === 'trade_closed' && e.pnlR !== undefined);
}

// ── Performance summary ──────────────────────────────────────────────────────

export function computePerformanceSummary(events: ShadowDecisionEvent[]): ShadowPerformanceSummary {
  const trades = closedTrades(events);
  const totalTrades = trades.length;
  if (totalTrades === 0) {
    return {
      totalTrades: 0, wins: 0, losses: 0, winRate: 0,
      avgPnlR: 0, avgWinR: 0, avgLossR: 0,
      profitFactor: 0, expectancyR: 0, totalPnlDollars: 0,
      maxConsecutiveWins: 0, maxConsecutiveLosses: 0,
      avgTimeInTradeMs: 0, avgMfeR: 0, avgMaeR: 0, edgeCaptureRatio: 0,
    };
  }

  const wins = trades.filter(t => (t.pnlR ?? 0) > 0);
  const losses = trades.filter(t => (t.pnlR ?? 0) <= 0);
  const winRate = wins.length / totalTrades;

  const allR = trades.map(t => t.pnlR ?? 0);
  const winR = wins.map(t => t.pnlR ?? 0);
  const lossR = losses.map(t => t.pnlR ?? 0);

  const sumWinR = winR.reduce((a, b) => a + b, 0);
  const sumLossR = lossR.reduce((a, b) => a + b, 0);
  const profitFactor = sumLossR === 0
    ? (sumWinR > 0 ? Infinity : 0)
    : sumWinR / Math.abs(sumLossR);

  const avgWinR = mean(winR);
  const avgLossR = mean(lossR);
  const expectancyR = (winRate * avgWinR) + ((1 - winRate) * avgLossR);

  // Consecutive streaks
  let maxConsecutiveWins = 0, maxConsecutiveLosses = 0;
  let curWins = 0, curLosses = 0;
  for (const t of trades) {
    if ((t.pnlR ?? 0) > 0) {
      curWins++; curLosses = 0;
      maxConsecutiveWins = Math.max(maxConsecutiveWins, curWins);
    } else {
      curLosses++; curWins = 0;
      maxConsecutiveLosses = Math.max(maxConsecutiveLosses, curLosses);
    }
  }

  const avgMfeR = mean(trades.map(t => t.mfeR ?? 0));
  const avgMaeR = mean(trades.map(t => t.maeR ?? 0));
  const avgPnlR = mean(allR);

  return {
    totalTrades,
    wins: wins.length,
    losses: losses.length,
    winRate,
    avgPnlR,
    avgWinR,
    avgLossR,
    profitFactor,
    expectancyR,
    totalPnlDollars: trades.reduce((s, t) => s + (t.pnl ?? 0), 0),
    maxConsecutiveWins,
    maxConsecutiveLosses,
    avgTimeInTradeMs: mean(trades.map(t => t.timeInTradeMs ?? 0)),
    avgMfeR,
    avgMaeR,
    edgeCaptureRatio: avgMfeR > 0 ? avgPnlR / avgMfeR : 0,
  };
}

// ── Bucket summary ───────────────────────────────────────────────────────────

export function computeBucketSummary(
  events: ShadowDecisionEvent[],
  bucketFn: (e: ShadowDecisionEvent) => string | undefined,
): BucketPerformanceSummary[] {
  const trades = closedTrades(events);
  const groups = new Map<string, ShadowDecisionEvent[]>();
  for (const t of trades) {
    const key = bucketFn(t) ?? 'unknown';
    let arr = groups.get(key);
    if (!arr) { arr = []; groups.set(key, arr); }
    arr.push(t);
  }
  return [...groups.entries()].map(([bucket, group]) => {
    const wins = group.filter(t => (t.pnlR ?? 0) > 0);
    return {
      bucket,
      trades: group.length,
      winRate: group.length > 0 ? wins.length / group.length : 0,
      avgPnlR: mean(group.map(t => t.pnlR ?? 0)),
      totalPnlDollars: group.reduce((s, t) => s + (t.pnl ?? 0), 0),
    };
  }).sort((a, b) => b.trades - a.trades);
}

// ── Council effectiveness ────────────────────────────────────────────────────

export function computeCouncilEffectiveness(events: ShadowDecisionEvent[]): CouncilEffectivenessSummary {
  // Council reviews = events at council_review stage or trade_opened with councilVotes
  const councilEvents = events.filter(e =>
    e.stage === 'council_review' || (e.stage === 'trade_opened' && e.councilVotes),
  );

  const approvals = councilEvents.filter(e => e.councilApproved === true);
  const rejections = councilEvents.filter(e => e.councilApproved === false);

  // Outcome-based metrics — only on opened/closed trades with real results
  const trades = closedTrades(events);
  const tradeOutcomes = new Map<string, ShadowDecisionEvent>();
  for (const t of trades) {
    if (t.tradeId) tradeOutcomes.set(t.tradeId, t);
  }

  const openedWithVotes = events.filter(e =>
    e.stage === 'trade_opened' && e.councilVotes && e.tradeId,
  );

  const approvedWithOutcome: Array<{ opened: ShadowDecisionEvent; closed: ShadowDecisionEvent }> = [];
  for (const o of openedWithVotes) {
    const c = tradeOutcomes.get(o.tradeId!);
    if (c) approvedWithOutcome.push({ opened: o, closed: c });
  }

  const approvedWins = approvedWithOutcome.filter(p => (p.closed.pnlR ?? 0) > 0);
  const approvedWinRate = approvedWithOutcome.length > 0
    ? approvedWins.length / approvedWithOutcome.length : 0;

  // Provider accuracy — only on trades with real outcomes
  const providerAccuracy: Record<string, { votes: number; correctCalls: number; accuracy: number }> = {};
  for (const pair of approvedWithOutcome) {
    const isWin = (pair.closed.pnlR ?? 0) > 0;
    for (const v of pair.opened.councilVotes ?? []) {
      if (!providerAccuracy[v.provider]) {
        providerAccuracy[v.provider] = { votes: 0, correctCalls: 0, accuracy: 0 };
      }
      const pa = providerAccuracy[v.provider];
      pa.votes++;
      // TAKE on win or REJECT/WAIT on loss = agrees with outcome
      if ((v.vote === 'TAKE' && isWin) || (v.vote !== 'TAKE' && !isWin)) {
        pa.correctCalls++;
      }
      pa.accuracy = pa.votes > 0 ? pa.correctCalls / pa.votes : 0;
    }
  }

  // Average confidence on wins vs losses
  const confidenceWins: number[] = [];
  const confidenceLosses: number[] = [];
  for (const pair of approvedWithOutcome) {
    const avgConf = mean((pair.opened.councilVotes ?? []).map(v => v.confidence));
    if ((pair.closed.pnlR ?? 0) > 0) confidenceWins.push(avgConf);
    else confidenceLosses.push(avgConf);
  }

  return {
    totalReviews: councilEvents.length,
    approvals: approvals.length,
    rejections: rejections.length,
    approvalRate: councilEvents.length > 0 ? approvals.length / councilEvents.length : 0,
    approvedWinRate,
    avgConfidenceWins: mean(confidenceWins),
    avgConfidenceLosses: mean(confidenceLosses),
    providerAccuracy,
  };
}

// ── Decision funnel ──────────────────────────────────────────────────────────

export function computeDecisionFunnel(
  events: ShadowDecisionEvent[],
): Record<ShadowDecisionStage, number> {
  const funnel: Record<string, number> = {
    limits_check: 0, feed_check: 0, setup_detection: 0,
    rule_engine: 0, council_review: 0, trade_opened: 0, trade_closed: 0,
  };
  for (const e of events) {
    funnel[e.stage] = (funnel[e.stage] ?? 0) + 1;
  }
  return funnel as Record<ShadowDecisionStage, number>;
}

// ── Top block reasons ────────────────────────────────────────────────────────

export function computeTopBlockReasons(
  events: ShadowDecisionEvent[],
  topN = 5,
): Array<{ reason: ShadowBlockReason; count: number; pct: number }> {
  const blocked = events.filter(e => e.blockReason);
  if (blocked.length === 0) return [];

  const counts = new Map<string, number>();
  for (const e of blocked) {
    counts.set(e.blockReason!, (counts.get(e.blockReason!) ?? 0) + 1);
  }

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, topN)
    .map(([reason, count]) => ({
      reason: reason as ShadowBlockReason,
      count,
      pct: (count / blocked.length) * 100,
    }));
}

// ── Full summary ─────────────────────────────────────────────────────────────

export function computeFullSummary(events: ShadowDecisionEvent[]): ShadowAnalyticsSummary {
  const timestamps = events.map(e => e.timestamp).filter(t => t > 0);

  return {
    overall: computePerformanceSummary(events),
    bySession: computeBucketSummary(events, e => e.sessionLabel),
    bySetupType: computeBucketSummary(events, e => e.setupType),
    bySymbol: computeBucketSummary(events, e => e.symbol),
    council: computeCouncilEffectiveness(events),
    decisionFunnel: computeDecisionFunnel(events),
    topBlockReasons: computeTopBlockReasons(events),
    eventCount: events.length,
    oldestEventTs: timestamps.length > 0 ? Math.min(...timestamps) : 0,
    newestEventTs: timestamps.length > 0 ? Math.max(...timestamps) : 0,
  };
}
