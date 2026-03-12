// ── main/trading/reliability/ReliabilityScorer.ts ────────────────────────────
//
// Composite 8-component reliability score + band.
//
// Produces a trust-grade assessment for each live signal. Components are
// weighted and combined into a single composite, then mapped to a band.
//
// Historical edge hard caps (correction #4):
//   - Blocked trust (adequate+ sample) caps final band at watchlist.
//   - Probation trust (adequate+ sample) caps final band at qualified.
//   Strong live context cannot fully override proven weak history.

// ── Types ──────────────────────────────────────────────────────────────────────

export type ReliabilityBand = 'elite' | 'qualified' | 'watchlist' | 'blocked';

export type HistoricalTrustLevel = 'elite' | 'trusted' | 'probation' | 'blocked';
export type HistoricalSampleTier = 'insufficient' | 'minimal' | 'adequate' | 'robust';

export interface ReliabilityComponents {
  /** Setup quality score 0-100 (from SetupQualityEngine). */
  setupQuality: number;
  /** Regime alignment score 0-100 (from RegimeFilterGovernor). */
  regimeAlignment: number;
  /** Signal freshness score 0-100 (from SignalFreshness). */
  signalFreshness: number;
  /** Confirmation depth score 0-100 (from watch confirmation). */
  confirmationDepth: number;
  /** Route clarity score 0-100 (from route quality). */
  routeClarity: number;
  /** Council consensus score 0-100 (from council review). */
  councilConsensus: number;
  /** Feed stability score 0-100 (from feed health). */
  feedStability: number;
  /** Historical edge score 0-100 (from SetupReliabilityStore, default 50). */
  historicalEdge: number;
}

export interface SignalReliabilityScore {
  /** Composite weighted score 0-100. */
  composite: number;
  /** Final reliability band. */
  band: ReliabilityBand;
  /** Individual component scores. */
  components: ReliabilityComponents;
  /** Primary degradation reason (most impactful below-average component). */
  primaryDegradation: string | null;
  /** Whether the signal has expired (forces blocked band). */
  expired: boolean;
  /** Human-readable explanation. */
  explanation: string;
}

// ── Component Weights ─────────────────────────────────────────────────────────

const WEIGHTS: Record<keyof ReliabilityComponents, number> = {
  setupQuality:      0.20,
  signalFreshness:   0.20,
  confirmationDepth: 0.15,
  routeClarity:      0.10,
  regimeAlignment:   0.10,
  councilConsensus:  0.10,
  feedStability:     0.10,
  historicalEdge:    0.05,
};

// ── Band Thresholds ──────────────────────────────────────────────────────────

function _scoreToBand(score: number): ReliabilityBand {
  if (score >= 80) return 'elite';
  if (score >= 60) return 'qualified';
  if (score >= 40) return 'watchlist';
  return 'blocked';
}

// ── Component Labels (for degradation reporting) ─────────────────────────────

const COMPONENT_LABELS: Record<keyof ReliabilityComponents, string> = {
  setupQuality:      'Setup quality',
  signalFreshness:   'Signal freshness',
  confirmationDepth: 'Confirmation depth',
  routeClarity:      'Route clarity',
  regimeAlignment:   'Regime alignment',
  councilConsensus:  'Council consensus',
  feedStability:     'Feed stability',
  historicalEdge:    'Historical edge',
};

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Compute the composite reliability score and band.
 *
 * @param components          - Individual component scores (each 0-100).
 * @param freshnessExpired    - Whether the signal has expired (forces blocked).
 * @param historicalTrustLevel - Trust level from SetupReliabilityStore (optional).
 * @param historicalSampleTier - Sample tier from SetupReliabilityStore (optional).
 */
export function computeReliability(
  components: ReliabilityComponents,
  freshnessExpired: boolean,
  historicalTrustLevel?: HistoricalTrustLevel,
  historicalSampleTier?: HistoricalSampleTier,
): SignalReliabilityScore {
  // ── Compute weighted composite ──────────────────────────────────────
  let composite = 0;
  for (const key of Object.keys(WEIGHTS) as Array<keyof ReliabilityComponents>) {
    const val = Math.max(0, Math.min(100, components[key] ?? 50));
    composite += val * WEIGHTS[key];
  }
  composite = Math.round(composite * 100) / 100;

  // ── Determine band ──────────────────────────────────────────────────
  let band = _scoreToBand(composite);

  // ── Expired signal → force blocked ──────────────────────────────────
  if (freshnessExpired) {
    band = 'blocked';
  }

  // ── Historical edge hard caps ───────────────────────────────────────
  // Adequate+ sample required for hard caps to take effect.
  const hasAdequateSample = historicalSampleTier === 'adequate' || historicalSampleTier === 'robust';
  if (hasAdequateSample && historicalTrustLevel) {
    if (historicalTrustLevel === 'blocked') {
      // Proven weak → cap at watchlist regardless of live context
      if (band === 'elite' || band === 'qualified') {
        band = 'watchlist';
      }
    } else if (historicalTrustLevel === 'probation') {
      // Shaky history → cap at qualified
      if (band === 'elite') {
        band = 'qualified';
      }
    }
  }

  // ── Find primary degradation ────────────────────────────────────────
  let primaryDegradation: string | null = null;
  if (composite < 80) {
    let worstKey: keyof ReliabilityComponents | null = null;
    let worstImpact = 0;

    for (const key of Object.keys(WEIGHTS) as Array<keyof ReliabilityComponents>) {
      const val = components[key] ?? 50;
      // Impact = how much this component drags down the composite
      // (difference from 100, weighted)
      const impact = (100 - val) * WEIGHTS[key];
      if (impact > worstImpact) {
        worstImpact = impact;
        worstKey = key;
      }
    }

    if (worstKey) {
      const val = Math.round(components[worstKey] ?? 50);
      primaryDegradation = `${COMPONENT_LABELS[worstKey]} is low (${val})`;
    }
  }

  // ── Build explanation ───────────────────────────────────────────────
  let explanation: string;
  if (freshnessExpired) {
    explanation = 'Signal expired — reliability blocked';
  } else if (band === 'blocked') {
    explanation = `Reliability too low (${composite.toFixed(0)}) — signal not trustworthy`;
  } else if (hasAdequateSample && historicalTrustLevel === 'blocked') {
    explanation = `Historical edge is negative — capped at watchlist despite ${composite.toFixed(0)} live score`;
  } else if (hasAdequateSample && historicalTrustLevel === 'probation' && band === 'qualified') {
    explanation = `Historical edge on probation — capped at qualified despite ${composite.toFixed(0)} live score`;
  } else if (band === 'elite') {
    explanation = `High reliability (${composite.toFixed(0)}) — signal is trustworthy`;
  } else if (band === 'qualified') {
    explanation = `Adequate reliability (${composite.toFixed(0)})${primaryDegradation ? ` — ${primaryDegradation}` : ''}`;
  } else {
    explanation = `Low reliability (${composite.toFixed(0)})${primaryDegradation ? ` — ${primaryDegradation}` : ''}`;
  }

  return {
    composite,
    band,
    components,
    primaryDegradation,
    expired: freshnessExpired,
    explanation,
  };
}
