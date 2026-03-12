// ── main/trading/reliability/SignalFreshness.ts ──────────────────────────────
//
// Signal freshness decay + expiration logic.
//
// Freshness score decays linearly from 100 (just generated) to 0 (expired).
// Price drift, stop breach, and regime change each independently trigger
// expiration with an explicit reason for UI transparency.
//
// Freshness thresholds are configurable per setup family, not hardcoded.

import type { TradeIntent } from '@triforge/engine';
import type { SetupFamily } from './SetupQualityEngine';
import type { RegimeCompatibility } from './RegimeFilterGovernor';

// ── Configuration ──────────────────────────────────────────────────────────

export interface FreshnessConfig {
  /** Maximum age in ms before signal expires. Default 300_000 (5 min). */
  maxAgeMs: number;
  /** Maximum price drift % before signal expires. Default 0.003 (0.3%). */
  maxPriceDriftPct: number;
  /** Maximum time in ms since council approval before stale. Default 180_000 (3 min). */
  approvalStaleMs: number;
}

export const DEFAULT_FRESHNESS: FreshnessConfig = {
  maxAgeMs: 300_000,
  maxPriceDriftPct: 0.003,
  approvalStaleMs: 180_000,
};

/**
 * Per-family overrides. Faster setups expire sooner.
 */
const FAMILY_OVERRIDES: Partial<Record<SetupFamily, Partial<FreshnessConfig>>> = {
  liquidity_sweep:     { maxAgeMs: 180_000 },
  fvg_fill:            { maxAgeMs: 240_000 },
  displacement_return: { maxAgeMs: 240_000 },
};

// ── Expiry Reasons ────────────────────────────────────────────────────────

export type ExpiryReason =
  | 'age_expired'
  | 'price_drift'
  | 'stop_breached'
  | 'regime_changed'
  | 'approval_stale';

// ── Result ────────────────────────────────────────────────────────────────

export interface FreshnessResult {
  /** Freshness score 0-100. */
  freshnessScore: number;
  /** Whether the signal has expired. */
  expired: boolean;
  /** Reason for expiration (null if not expired). */
  expiryReason: ExpiryReason | null;
  /** Active degradation descriptions (even if not expired). */
  degradations: string[];
}

// ── Public API ─────────────────────────────────────────────────────────────

/**
 * Compute the freshness of an approved trade intent.
 *
 * @param intent             - The trade intent to check.
 * @param currentPrice       - Current market price.
 * @param currentRegime      - Current detected regime (null = unknown).
 * @param intentRegime       - Regime at time of intent creation (null = unknown).
 * @param regimeCompatibility - Current regime compatibility for the intent's
 *                             setup family (if regime changed to caution/blocked, expires).
 * @param configOverrides    - Optional per-call config overrides.
 * @param now                - Current timestamp (default Date.now()).
 */
export function computeFreshness(
  intent: TradeIntent,
  currentPrice: number,
  currentRegime: string | null,
  intentRegime: string | null,
  regimeCompatibility: RegimeCompatibility | undefined,
  configOverrides?: Partial<FreshnessConfig>,
  now?: number,
): FreshnessResult {
  const ts = now ?? Date.now();
  const family = (intent.setupFamily ?? 'unclassified') as SetupFamily;

  // Merge config: defaults < family overrides < call overrides
  const familyOverride = FAMILY_OVERRIDES[family] ?? {};
  const cfg: FreshnessConfig = {
    ...DEFAULT_FRESHNESS,
    ...familyOverride,
    ...configOverrides,
  };

  const degradations: string[] = [];
  let score = 100;

  // ── Age decay (linear) ──────────────────────────────────────────────
  const ageMs = ts - (intent.createdAt ?? ts);
  if (ageMs > 0) {
    const ageFraction = Math.min(ageMs / cfg.maxAgeMs, 1);
    const agePenalty = ageFraction * 100;
    score -= agePenalty;
    if (ageFraction > 0.5) {
      degradations.push(`Age: ${Math.round(ageMs / 1000)}s (${Math.round(ageFraction * 100)}% of max)`);
    }
  }

  // Check age expiry
  if (ageMs > cfg.maxAgeMs) {
    return {
      freshnessScore: 0,
      expired: true,
      expiryReason: 'age_expired',
      degradations: [`Signal age ${Math.round(ageMs / 1000)}s exceeds ${Math.round(cfg.maxAgeMs / 1000)}s limit`],
    };
  }

  // ── Price drift ─────────────────────────────────────────────────────
  const entryPrice = intent.entry;
  if (entryPrice && currentPrice > 0) {
    const driftPct = Math.abs(currentPrice - entryPrice) / entryPrice;
    if (driftPct > cfg.maxPriceDriftPct) {
      return {
        freshnessScore: 0,
        expired: true,
        expiryReason: 'price_drift',
        degradations: [`Price drifted ${(driftPct * 100).toFixed(2)}% from entry (limit ${(cfg.maxPriceDriftPct * 100).toFixed(1)}%)`],
      };
    }
    // Partial penalty: -30 per 0.1% drift
    const driftPenalty = (driftPct / 0.001) * 30;
    score -= driftPenalty;
    if (driftPct > cfg.maxPriceDriftPct * 0.5) {
      degradations.push(`Price drift: ${(driftPct * 100).toFixed(2)}%`);
    }
  }

  // ── Stop breach ─────────────────────────────────────────────────────
  if (intent.stop && currentPrice > 0) {
    const stopBreached = intent.side === 'long'
      ? currentPrice <= intent.stop
      : currentPrice >= intent.stop;
    if (stopBreached) {
      return {
        freshnessScore: 0,
        expired: true,
        expiryReason: 'stop_breached',
        degradations: ['Stop price breached before entry'],
      };
    }
  }

  // ── Regime change ───────────────────────────────────────────────────
  if (currentRegime && intentRegime && currentRegime !== intentRegime) {
    // Only expire if the NEW regime is caution or blocked for this setup
    if (regimeCompatibility === 'caution' || regimeCompatibility === 'blocked') {
      return {
        freshnessScore: 0,
        expired: true,
        expiryReason: 'regime_changed',
        degradations: [`Regime changed from ${intentRegime} to ${currentRegime} (${regimeCompatibility})`],
      };
    }
    // Regime changed but still compatible — penalize but don't expire
    score -= 15;
    degradations.push(`Regime shifted from ${intentRegime} to ${currentRegime}`);
  }

  // ── Clamp score ─────────────────────────────────────────────────────
  const finalScore = Math.max(0, Math.min(100, Math.round(score)));

  return {
    freshnessScore: finalScore,
    expired: false,
    expiryReason: null,
    degradations,
  };
}
