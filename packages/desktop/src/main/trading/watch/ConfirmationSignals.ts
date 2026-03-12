// ── main/trading/watch/ConfirmationSignals.ts ─────────────────────────────────
//
// Weighted scoring of confirmation signals into a single ConfirmationScore.
//
// 7-factor model (total weights = 100):
//   displacement:       20  — Strong candle away from level
//   microStructure:     20  — Short-term high/low sequence shift
//   reclaimFailure:     15  — Break then immediate reclaim of level
//   rejectionQuality:   15  — Long wick through level with close back
//   retestHold:         10  — Price retests level and holds
//   volumeConfirmation: 10  — Bar volume > 1.5x recent average
//   responseSpeed:      10  — Confirmation within 1-2 bars = fast
//
// Threshold:
//   >= 65 = confirmed (pass)
//   < 65  = rejected (fail)
//
// The "inability_to_continue" signal type contributes indirectly: its
// strength is folded into the rejectionQuality factor (since stalling
// near a level is a form of rejection evidence).

import type {
  ConfirmationSignal, ConfirmationScore, ConfirmationFactors,
} from '@triforge/engine';
import { CONFIRMATION_WEIGHTS } from '@triforge/engine';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Score threshold for confirmed status. */
export const SCORE_THRESHOLD = 65;

// ── Signal → Factor Mapping ───────────────────────────────────────────────────
//
// Each ConfirmationType maps to one (or more) ConfirmationFactors.
// When multiple signals contribute to the same factor, we take the
// strongest signal's strength for that factor (no double-counting).

function _mapSignalToFactor(
  signal: ConfirmationSignal,
): { factor: keyof ConfirmationFactors; strength: number }[] {
  switch (signal.type) {
    case 'displacement_candle':
      return [{ factor: 'displacement', strength: signal.strength }];

    case 'micro_structure_break':
      return [{ factor: 'microStructure', strength: signal.strength }];

    case 'reclaim_failure':
      return [{ factor: 'reclaimFailure', strength: signal.strength }];

    case 'rejection_wick':
      return [{ factor: 'rejectionQuality', strength: signal.strength }];

    case 'retest_hold':
      return [{ factor: 'retestHold', strength: signal.strength }];

    case 'volume_expansion':
      return [{ factor: 'volumeConfirmation', strength: signal.strength }];

    case 'response_speed':
      return [{ factor: 'responseSpeed', strength: signal.strength }];

    case 'inability_to_continue':
      // Folds into rejectionQuality as supplementary evidence
      return [{ factor: 'rejectionQuality', strength: signal.strength }];

    default:
      return [];
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Score an array of confirmation signals into a weighted ConfirmationScore.
 *
 * @param signals - Confirmation signals detected by ConfirmationEngine
 * @returns A ConfirmationScore with total (0–100), per-factor breakdown,
 *          and all contributing signals.
 */
export function scoreConfirmation(signals: ConfirmationSignal[]): ConfirmationScore {
  // Initialize all factors to 0
  const factors: ConfirmationFactors = {
    displacement: 0,
    microStructure: 0,
    reclaimFailure: 0,
    rejectionQuality: 0,
    retestHold: 0,
    volumeConfirmation: 0,
    responseSpeed: 0,
  };

  // Map each signal to its factor(s), keeping the strongest per factor
  for (const signal of signals) {
    const mappings = _mapSignalToFactor(signal);
    for (const { factor, strength } of mappings) {
      factors[factor] = Math.max(factors[factor], strength);
    }
  }

  // Compute weighted total (weights sum to 100, factors are 0–100)
  let total = 0;
  for (const key of Object.keys(CONFIRMATION_WEIGHTS) as (keyof ConfirmationFactors)[]) {
    total += (factors[key] / 100) * CONFIRMATION_WEIGHTS[key];
  }
  total = Math.round(total * 100) / 100;

  return {
    total,
    factors,
    signals,
  };
}

/**
 * Whether the score meets the confirmation threshold.
 */
export function isConfirmed(score: ConfirmationScore): boolean {
  return score.total >= SCORE_THRESHOLD;
}

/**
 * Whether the score fails confirmation (below threshold).
 * Only meaningful after the confirmation window has closed.
 */
export function isRejected(score: ConfirmationScore): boolean {
  return score.total < SCORE_THRESHOLD;
}
