// ── main/trading/learning/PerformanceAnalytics.ts ───────────────────────────────
//
// Compute expectancy and performance metrics by bucket from journal data.
//
// Supported bucket dimensions:
//   - levelType:        entry level type (supply, demand, swing_high, ...)
//   - confirmationType: which confirmation signals triggered entry
//   - sessionRegime:    open_drive, trend, range, reversal, ...
//   - symbol:           NQ, ES, etc.
//   - scoreBand:        elite, A, B, no_trade
//   - sessionWindow:    opening, prime, reduced, ...
//
// All calculations are pure functions — no side effects, no state.
//
// SIMULATION ONLY.

import type { ExtendedJournalEntry } from './TradeJournalStore';

// ── Result Types ────────────────────────────────────────────────────────────

export interface BucketStats {
  /** Bucket identifier (e.g. "supply", "NQ", "A"). */
  bucket: string;
  /** Dimension this bucket belongs to. */
  dimension: BucketDimension;
  /** Total number of trades in this bucket. */
  trades: number;
  /** Number of winning trades. */
  wins: number;
  /** Number of losing trades. */
  losses: number;
  /** Number of breakeven trades. */
  breakevens: number;
  /** Win rate as a fraction 0–1. */
  winRate: number;
  /** Average P&L in R-multiples. */
  avgPnlR: number;
  /** Average P&L in points. */
  avgPnlPoints: number;
  /** Expectancy in R-multiples: (winRate * avgWinR) - (lossRate * avgLossR). */
  expectancy: number;
  /** Profit factor: gross profit / gross loss (Infinity if no losses). */
  profitFactor: number;
  /** Average winning trade in R. */
  avgWinR: number;
  /** Average losing trade in R. */
  avgLossR: number;
  /** Max drawdown in R (worst single trade). */
  maxDrawdownR: number;
  /** Best single trade in R. */
  bestTradeR: number;
  /** Average hold duration in minutes. */
  avgHoldMinutes: number;
}

export type BucketDimension =
  | 'levelType'
  | 'confirmationType'
  | 'sessionRegime'
  | 'symbol'
  | 'scoreBand'
  | 'sessionWindow'
  | 'councilConsensus';

export interface PerformanceSummary {
  /** Overall stats across all entries. */
  overall: BucketStats;
  /** Stats broken down by the requested dimension. */
  buckets: BucketStats[];
}

// ── Analytics Functions ─────────────────────────────────────────────────────

/**
 * Compute performance metrics for a set of journal entries, bucketed by
 * the given dimension.
 *
 * @param entries   - Journal entries to analyze.
 * @param dimension - The dimension to bucket by.
 * @returns Performance summary with overall and per-bucket stats.
 */
export function computeExpectancy(
  entries: ExtendedJournalEntry[],
  dimension: BucketDimension,
): PerformanceSummary {
  if (entries.length === 0) {
    return {
      overall: _emptyBucket('ALL', dimension),
      buckets: [],
    };
  }

  // Group entries by bucket key
  const groups = new Map<string, ExtendedJournalEntry[]>();

  for (const entry of entries) {
    const keys = _extractBucketKeys(entry, dimension);
    for (const key of keys) {
      const group = groups.get(key);
      if (group) {
        group.push(entry);
      } else {
        groups.set(key, [entry]);
      }
    }
  }

  // Compute stats per bucket
  const buckets: BucketStats[] = [];
  for (const [key, group] of groups) {
    buckets.push(_computeBucket(key, dimension, group));
  }

  // Sort by trade count descending
  buckets.sort((a, b) => b.trades - a.trades);

  // Compute overall
  const overall = _computeBucket('ALL', dimension, entries);

  return { overall, buckets };
}

/**
 * Compute performance for all dimensions at once.
 * Useful for a single-call dashboard snapshot.
 */
export function computeAllDimensions(
  entries: ExtendedJournalEntry[],
): Record<BucketDimension, PerformanceSummary> {
  const dimensions: BucketDimension[] = [
    'levelType', 'confirmationType', 'sessionRegime',
    'symbol', 'scoreBand', 'sessionWindow',
  ];

  const result: Record<string, PerformanceSummary> = {};
  for (const dim of dimensions) {
    result[dim] = computeExpectancy(entries, dim);
  }

  return result as Record<BucketDimension, PerformanceSummary>;
}

// ── Internal ────────────────────────────────────────────────────────────────

/**
 * Extract bucket key(s) for an entry based on the dimension.
 * Most dimensions return a single key. confirmationType can return
 * multiple (one per confirmation type that triggered the entry).
 */
function _extractBucketKeys(
  entry: ExtendedJournalEntry,
  dimension: BucketDimension,
): string[] {
  switch (dimension) {
    case 'levelType':
      return [entry.levelType];
    case 'confirmationType':
      return entry.confirmationTypes.length > 0
        ? entry.confirmationTypes
        : ['none'];
    case 'sessionRegime':
      return [entry.sessionRegime ?? 'unknown'];
    case 'symbol':
      return [entry.symbol];
    case 'scoreBand':
      return [entry.tradeScoreBand];
    case 'sessionWindow':
      return [entry.sessionLabel];
    case 'councilConsensus':
      return [(entry as any).councilConsensusPattern ?? 'unknown'];
    default:
      return ['unknown'];
  }
}

/**
 * Compute statistics for a group of journal entries.
 */
function _computeBucket(
  bucket: string,
  dimension: BucketDimension,
  entries: ExtendedJournalEntry[],
): BucketStats {
  const trades = entries.length;
  if (trades === 0) return _emptyBucket(bucket, dimension);

  const wins = entries.filter(e => e.outcome === 'win');
  const losses = entries.filter(e => e.outcome === 'loss');
  const breakevens = entries.filter(e => e.outcome === 'breakeven');

  const winCount = wins.length;
  const lossCount = losses.length;
  const winRate = trades > 0 ? winCount / trades : 0;

  // R-multiple calculations
  const allPnlR = entries.map(e => e.pnlR);
  const avgPnlR = _avg(allPnlR);

  const winPnlR = wins.map(e => e.pnlR);
  const lossPnlR = losses.map(e => e.pnlR);
  const avgWinR = winPnlR.length > 0 ? _avg(winPnlR) : 0;
  const avgLossR = lossPnlR.length > 0 ? Math.abs(_avg(lossPnlR)) : 0;

  // Points calculations
  const allPnlPoints = entries.map(e => {
    if (e.exitPrice === undefined || e.entryPrice === undefined) return 0;
    const raw = e.direction === 'up'
      ? e.exitPrice - e.entryPrice
      : e.entryPrice - e.exitPrice;
    return raw;
  });
  const avgPnlPoints = _avg(allPnlPoints);

  // Expectancy: E[R] = (winRate * avgWinR) - (lossRate * avgLossR)
  const lossRate = trades > 0 ? lossCount / trades : 0;
  const expectancy = (winRate * avgWinR) - (lossRate * avgLossR);

  // Profit factor: gross profit / gross loss
  const grossProfit = winPnlR.reduce((s, r) => s + r, 0);
  const grossLoss = Math.abs(lossPnlR.reduce((s, r) => s + r, 0));
  const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : (grossProfit > 0 ? Infinity : 0);

  // Extremes
  const maxDrawdownR = allPnlR.length > 0 ? Math.min(...allPnlR) : 0;
  const bestTradeR = allPnlR.length > 0 ? Math.max(...allPnlR) : 0;

  // Hold duration
  const holdDurations = entries.map(e => e.holdDurationMs / 60_000);
  const avgHoldMinutes = _avg(holdDurations);

  return {
    bucket,
    dimension,
    trades,
    wins: winCount,
    losses: lossCount,
    breakevens: breakevens.length,
    winRate,
    avgPnlR,
    avgPnlPoints,
    expectancy,
    profitFactor,
    avgWinR,
    avgLossR,
    maxDrawdownR,
    bestTradeR,
    avgHoldMinutes,
  };
}

function _emptyBucket(bucket: string, dimension: BucketDimension): BucketStats {
  return {
    bucket,
    dimension,
    trades: 0,
    wins: 0,
    losses: 0,
    breakevens: 0,
    winRate: 0,
    avgPnlR: 0,
    avgPnlPoints: 0,
    expectancy: 0,
    profitFactor: 0,
    avgWinR: 0,
    avgLossR: 0,
    maxDrawdownR: 0,
    bestTradeR: 0,
    avgHoldMinutes: 0,
  };
}

function _avg(nums: number[]): number {
  if (nums.length === 0) return 0;
  return nums.reduce((sum, n) => sum + n, 0) / nums.length;
}

// ── Advisory Target Analytics ─────────────────────────────────────────────────
//
// Measures how often advisory T2/T3 targets would have been reached, using
// the trade's MFE (maximum favorable excursion) as the proxy. Produces
// overall and per-bucket reach rates, leftover R beyond T1, and loser-side
// rescue metrics.
//
// This is observational only — it does NOT change execution behavior.

export interface AdvisoryTargetStats {
  totalTrades: number;
  tradesWithTargets: number;
  /** T2 reachability: MFE >= T2 distance from entry. */
  t2ReachCount: number;
  t2ReachRate: number;
  /** T3 reachability: MFE >= T3 distance from entry. */
  t3ReachCount: number;
  t3ReachRate: number;
  /** Losers with advisory targets. */
  loserCount: number;
  losersWithTargets: number;
  /** Among losers: T2 reach count and rate. */
  loserT2ReachCount: number;
  loserT2ReachRate: number;
  /** Among losers: T3 reach count and rate. */
  loserT3ReachCount: number;
  loserT3ReachRate: number;
  /** Average MFE in R across trades with targets. */
  avgMfeR: number;
  /** Average leftover R beyond T1: avg(mfeR - t1DistR). Positive = MFE exceeded T1. */
  avgLeftoverRBeyondT1: number;
  /** Among losers where MFE >= T2: average T2 distance in R (hypothetical rescue). */
  avgT2RescueR: number;
}

export interface AdvisoryTargetBucket extends AdvisoryTargetStats {
  bucket: string;
  dimension: string;
}

export interface AdvisoryTargetSummary {
  overall: AdvisoryTargetStats;
  buckets: AdvisoryTargetBucket[];
}

/**
 * Compute advisory target analytics from journal entries.
 *
 * For each trade with advisory targets, compares MFE to the T2/T3 distances
 * from entry. Produces overall and per-bucket reach rates. Separates losers
 * for rescue-potential analysis.
 */
export function computeAdvisoryTargetAnalytics(
  entries: ExtendedJournalEntry[],
  dimension: BucketDimension = 'scoreBand',
): AdvisoryTargetSummary {
  if (entries.length === 0) {
    return {
      overall: _emptyTargetStats(),
      buckets: [],
    };
  }

  // Group entries by bucket key
  const groups = new Map<string, ExtendedJournalEntry[]>();
  for (const entry of entries) {
    const keys = _extractBucketKeys(entry, dimension);
    for (const key of keys) {
      const group = groups.get(key);
      if (group) group.push(entry);
      else groups.set(key, [entry]);
    }
  }

  // Per-bucket stats
  const buckets: AdvisoryTargetBucket[] = [];
  for (const [key, group] of groups) {
    const stats = _computeTargetStats(group);
    if (stats.tradesWithTargets > 0) {
      buckets.push({ ...stats, bucket: key, dimension });
    }
  }

  // Sort by trades with targets descending
  buckets.sort((a, b) => b.tradesWithTargets - a.tradesWithTargets);

  return {
    overall: _computeTargetStats(entries),
    buckets,
  };
}

function _computeTargetStats(entries: ExtendedJournalEntry[]): AdvisoryTargetStats {
  let totalTrades = entries.length;
  let tradesWithTargets = 0;
  let t2ReachCount = 0;
  let t3ReachCount = 0;
  let loserCount = 0;
  let losersWithTargets = 0;
  let loserT2ReachCount = 0;
  let loserT3ReachCount = 0;

  const mfeRValues: number[] = [];
  const leftoverRValues: number[] = [];
  const t2RescueRValues: number[] = [];

  for (const e of entries) {
    const targets = (e as any).additionalTargets as number[] | undefined;
    if (!targets || targets.length === 0) continue;

    const stopDist = Math.abs(e.entryPrice - e.stopPrice);
    if (stopDist <= 0) continue;

    const t1DistR = Math.abs(e.targetPrice - e.entryPrice) / stopDist;
    const t2 = targets[0];
    const t3 = targets.length >= 2 ? targets[1] : undefined;
    const t2DistR = t2 != null ? Math.abs(t2 - e.entryPrice) / stopDist : undefined;
    const t3DistR = t3 != null ? Math.abs(t3 - e.entryPrice) / stopDist : undefined;

    tradesWithTargets++;
    mfeRValues.push(e.mfeR);
    leftoverRValues.push(e.mfeR - t1DistR);

    const isLoser = e.outcome === 'loss';
    if (isLoser) {
      loserCount++;
      losersWithTargets++;
    }

    // T2 reachability
    if (t2DistR != null && e.mfeR >= t2DistR) {
      t2ReachCount++;
      if (isLoser) {
        loserT2ReachCount++;
        t2RescueRValues.push(t2DistR);
      }
    }

    // T3 reachability
    if (t3DistR != null && e.mfeR >= t3DistR) {
      t3ReachCount++;
      if (isLoser) loserT3ReachCount++;
    }
  }

  // Count total losers (including those without targets, for context)
  for (const e of entries) {
    if (e.outcome === 'loss' && !((e as any).additionalTargets?.length > 0)) {
      loserCount++;
    }
  }

  return {
    totalTrades,
    tradesWithTargets,
    t2ReachCount,
    t2ReachRate: tradesWithTargets > 0 ? t2ReachCount / tradesWithTargets : 0,
    t3ReachCount,
    t3ReachRate: tradesWithTargets > 0 ? t3ReachCount / tradesWithTargets : 0,
    loserCount,
    losersWithTargets,
    loserT2ReachCount,
    loserT2ReachRate: losersWithTargets > 0 ? loserT2ReachCount / losersWithTargets : 0,
    loserT3ReachCount,
    loserT3ReachRate: losersWithTargets > 0 ? loserT3ReachCount / losersWithTargets : 0,
    avgMfeR: _avg(mfeRValues),
    avgLeftoverRBeyondT1: _avg(leftoverRValues),
    avgT2RescueR: _avg(t2RescueRValues),
  };
}

function _emptyTargetStats(): AdvisoryTargetStats {
  return {
    totalTrades: 0,
    tradesWithTargets: 0,
    t2ReachCount: 0,
    t2ReachRate: 0,
    t3ReachCount: 0,
    t3ReachRate: 0,
    loserCount: 0,
    losersWithTargets: 0,
    loserT2ReachCount: 0,
    loserT2ReachRate: 0,
    loserT3ReachCount: 0,
    loserT3ReachRate: 0,
    avgMfeR: 0,
    avgLeftoverRBeyondT1: 0,
    avgT2RescueR: 0,
  };
}
