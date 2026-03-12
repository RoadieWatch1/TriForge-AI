// ── main/trading/reliability/SetupReliabilityStore.ts ────────────────────────
//
// Per-setup-family + per-regime outcome tracking.
//
// Recomputes stats from journal entries. Produces trust levels and
// historical edge scores that feed into the ReliabilityScorer's
// historicalEdge component and RegimeFilterGovernor's empirical overrides.
//
// Sample tiers: insufficient < 5, minimal 5-14, adequate 15-29, robust 30+
//
// Trust levels:
//   elite:     robust + expectancy > 0.3R + winRate > 0.5
//   trusted:   adequate + expectancy > 0.1R
//   probation: minimal, or adequate with flat expectancy
//   blocked:   adequate+ with expectancy < -0.2R

import type { ExtendedJournalEntry } from '../learning/TradeJournalStore';
import type { TrustLevel } from './RegimeFilterGovernor';

// ── Types ──────────────────────────────────────────────────────────────────────

export type SampleTier = 'insufficient' | 'minimal' | 'adequate' | 'robust';

export interface SetupReliabilityRecord {
  /** Setup family identifier. */
  setupFamily: string;
  /** Regime identifier. */
  regime: string;
  /** Total trade count. */
  trades: number;
  /** Win count. */
  wins: number;
  /** Loss count. */
  losses: number;
  /** Win rate 0-1. */
  winRate: number;
  /** Expectancy in R-multiples. */
  expectancy: number;
  /** Average R-multiple per trade. */
  avgR: number;
  /** Max drawdown in R (worst single trade). */
  maxDrawdownR: number;
  /** Average MFE in R. */
  avgMfeR: number;
  /** Average MAE in R. */
  avgMaeR: number;
  /** Sample tier based on trade count. */
  sampleTier: SampleTier;
  /** Trust level derived from sample tier + performance. */
  trustLevel: TrustLevel;
}

// ── Constants ─────────────────────────────────────────────────────────────────

function _sampleTier(n: number): SampleTier {
  if (n >= 30) return 'robust';
  if (n >= 15) return 'adequate';
  if (n >= 5) return 'minimal';
  return 'insufficient';
}

function _deriveTrustLevel(
  sampleTier: SampleTier,
  winRate: number,
  expectancy: number,
): TrustLevel {
  if (sampleTier === 'insufficient') return 'probation'; // not enough data

  // Adequate+ with negative expectancy → blocked
  if ((sampleTier === 'adequate' || sampleTier === 'robust') && expectancy < -0.2) {
    return 'blocked';
  }

  // Robust + strong performance → elite
  if (sampleTier === 'robust' && expectancy > 0.3 && winRate > 0.5) {
    return 'elite';
  }

  // Adequate + positive expectancy → trusted
  if ((sampleTier === 'adequate' || sampleTier === 'robust') && expectancy > 0.1) {
    return 'trusted';
  }

  // Everything else → probation
  return 'probation';
}

// ── Historical Edge Score Mapping ────────────────────────────────────────────

const TRUST_TO_EDGE: Record<TrustLevel, number> = {
  elite: 90,
  trusted: 65,
  probation: 40,
  blocked: 10,
};

// ── Store ──────────────────────────────────────────────────────────────────────

export class SetupReliabilityStore {
  private _records: Map<string, SetupReliabilityRecord> = new Map();

  /**
   * Recompute all stats from journal entries.
   * Groups by setupFamily + regime and computes per-group metrics.
   */
  recompute(entries: ExtendedJournalEntry[]): void {
    this._records.clear();

    // Group entries by "setupFamily:regime"
    const groups = new Map<string, ExtendedJournalEntry[]>();

    for (const entry of entries) {
      const family = (entry as any).setupFamily ?? 'unclassified';
      const regime = entry.sessionRegime ?? 'unknown';
      const key = `${family}:${regime}`;

      const group = groups.get(key);
      if (group) group.push(entry);
      else groups.set(key, [entry]);
    }

    // Compute stats per group
    for (const [key, group] of groups) {
      const [setupFamily, regime] = key.split(':');
      const trades = group.length;
      const wins = group.filter(e => e.outcome === 'win').length;
      const losses = group.filter(e => e.outcome === 'loss').length;
      const winRate = trades > 0 ? wins / trades : 0;

      const pnlRValues = group.map(e => e.pnlR);
      const avgR = pnlRValues.length > 0
        ? pnlRValues.reduce((s, r) => s + r, 0) / pnlRValues.length
        : 0;

      // Expectancy: (winRate * avgWinR) - (lossRate * avgLossR)
      const winEntries = group.filter(e => e.outcome === 'win');
      const lossEntries = group.filter(e => e.outcome === 'loss');
      const avgWinR = winEntries.length > 0
        ? winEntries.reduce((s, e) => s + e.pnlR, 0) / winEntries.length
        : 0;
      const avgLossR = lossEntries.length > 0
        ? Math.abs(lossEntries.reduce((s, e) => s + e.pnlR, 0) / lossEntries.length)
        : 0;
      const lossRate = trades > 0 ? losses / trades : 0;
      const expectancy = (winRate * avgWinR) - (lossRate * avgLossR);

      const maxDrawdownR = pnlRValues.length > 0 ? Math.min(...pnlRValues) : 0;
      const avgMfeR = group.length > 0
        ? group.reduce((s, e) => s + (e.mfeR ?? 0), 0) / group.length
        : 0;
      const avgMaeR = group.length > 0
        ? group.reduce((s, e) => s + (e.maeR ?? 0), 0) / group.length
        : 0;

      const sampleTier = _sampleTier(trades);
      const trustLevel = _deriveTrustLevel(sampleTier, winRate, expectancy);

      this._records.set(key, {
        setupFamily,
        regime,
        trades,
        wins,
        losses,
        winRate,
        expectancy,
        avgR,
        maxDrawdownR,
        avgMfeR,
        avgMaeR,
        sampleTier,
        trustLevel,
      });
    }
  }

  /**
   * Get trust level for a specific setup family + regime combo.
   * Returns 'probation' if no data exists (unknown = cautious default).
   */
  getTrustLevel(setupFamily: string, regime: string): TrustLevel {
    const key = `${setupFamily}:${regime}`;
    return this._records.get(key)?.trustLevel ?? 'probation';
  }

  /**
   * Get historical edge score 0-100 for a specific setup family + regime.
   * Maps trust level to a numeric score for the ReliabilityScorer.
   * Returns 50 (neutral) if no data exists.
   */
  getHistoricalEdge(setupFamily: string, regime: string): number {
    const key = `${setupFamily}:${regime}`;
    const record = this._records.get(key);
    if (!record) return 50; // unknown = neutral
    return TRUST_TO_EDGE[record.trustLevel];
  }

  /**
   * Get all computed records for UI display.
   */
  getAll(): SetupReliabilityRecord[] {
    return Array.from(this._records.values());
  }

  /**
   * Build an empirical overrides map for RegimeFilterGovernor.
   * Keys are "setupFamily:regime" strings, values are TrustLevel.
   */
  buildEmpiricalOverrides(): Map<string, TrustLevel> {
    const overrides = new Map<string, TrustLevel>();
    for (const [key, record] of this._records) {
      // Only include overrides with adequate+ sample (meaningful data)
      if (record.sampleTier === 'adequate' || record.sampleTier === 'robust') {
        overrides.set(key, record.trustLevel);
      }
    }
    return overrides;
  }
}
