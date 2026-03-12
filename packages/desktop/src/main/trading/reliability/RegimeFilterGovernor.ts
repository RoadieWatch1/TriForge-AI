// ── main/trading/reliability/RegimeFilterGovernor.ts ─────────────────────────────
//
// Setup-to-regime compatibility hard gate.
//
// The hardcoded compatibility matrix is an initial prior. An optional
// empiricalOverrides map (from SetupReliabilityStore) can promote or demote
// compatibility based on observed historical results. Both configured and
// observed compatibility are returned for UI transparency.

import type { SetupFamily } from './SetupQualityEngine';
import type { RegimeContext } from '../learning/SessionRegimeMemory';
import type { SessionRegime } from '../learning/SessionRegimeMemory';

// ── Types ──────────────────────────────────────────────────────────────────────

export type RegimeCompatibility = 'ideal' | 'acceptable' | 'caution' | 'blocked';

export type TrustLevel = 'elite' | 'trusted' | 'probation' | 'blocked';

export interface RegimeFilterResult {
  allowed: boolean;
  compatibility: RegimeCompatibility;
  /** Configured compatibility from the prior matrix. */
  configuredCompatibility: RegimeCompatibility;
  /** Alignment score 0-100 for the reliability scorer. */
  alignmentScore: number;
  reason: string;
}

// ── Compatibility Matrix (Initial Prior) ───────────────────────────────────────

const REGIME_COMPAT: Record<SetupFamily, Record<SessionRegime, RegimeCompatibility>> = {
  level_bounce:        { open_drive: 'acceptable', trend: 'ideal',      range: 'acceptable', reversal: 'caution',    expansion: 'caution',    drift: 'blocked' },
  fvg_fill:            { open_drive: 'ideal',      trend: 'ideal',      range: 'blocked',    reversal: 'acceptable', expansion: 'ideal',      drift: 'blocked' },
  liquidity_sweep:     { open_drive: 'ideal',      trend: 'acceptable', range: 'blocked',    reversal: 'ideal',      expansion: 'acceptable', drift: 'blocked' },
  swing_retest:        { open_drive: 'caution',    trend: 'ideal',      range: 'acceptable', reversal: 'acceptable', expansion: 'acceptable', drift: 'blocked' },
  session_reference:   { open_drive: 'acceptable', trend: 'acceptable', range: 'ideal',      reversal: 'acceptable', expansion: 'caution',    drift: 'caution'  },
  displacement_return: { open_drive: 'ideal',      trend: 'ideal',      range: 'caution',    reversal: 'blocked',    expansion: 'ideal',      drift: 'blocked' },
  unclassified:        { open_drive: 'blocked',    trend: 'blocked',    range: 'blocked',    reversal: 'blocked',    expansion: 'blocked',    drift: 'blocked' },
};

// ── Alignment Score Mapping ────────────────────────────────────────────────────

const COMPAT_SCORES: Record<RegimeCompatibility, number> = {
  ideal: 95,
  acceptable: 65,
  caution: 30,
  blocked: 0,
};

// ── Empirical Override Logic ───────────────────────────────────────────────────

function _applyEmpirical(
  configured: RegimeCompatibility,
  empiricalTrust: TrustLevel | undefined,
): RegimeCompatibility {
  if (!empiricalTrust) return configured;

  // Empirical elite upgrades caution → acceptable (but never unblocks)
  if (empiricalTrust === 'elite' && configured === 'caution') return 'acceptable';

  // Empirical blocked downgrades ideal/acceptable → caution (never hard-blocks on its own)
  if (empiricalTrust === 'blocked' && (configured === 'ideal' || configured === 'acceptable')) return 'caution';

  // Empirical probation downgrades ideal → acceptable
  if (empiricalTrust === 'probation' && configured === 'ideal') return 'acceptable';

  return configured;
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Check whether a setup family is compatible with the current market regime.
 *
 * @param setupFamily        - Classified setup family.
 * @param regimeCtx          - Current regime context (null = unknown → neutral).
 * @param empiricalOverrides - Optional map of "family:regime" → TrustLevel from
 *                            SetupReliabilityStore for empirical override.
 */
export function checkRegimeCompatibility(
  setupFamily: SetupFamily,
  regimeCtx: RegimeContext | null,
  empiricalOverrides?: Map<string, TrustLevel>,
): RegimeFilterResult {
  const regime = regimeCtx?.current?.regime;

  // No regime detected → neutral pass
  if (!regime) {
    return {
      allowed: true,
      compatibility: 'acceptable',
      configuredCompatibility: 'acceptable',
      alignmentScore: 65,
      reason: 'No regime detected — neutral pass',
    };
  }

  // Look up configured compatibility
  const familyRow = REGIME_COMPAT[setupFamily];
  const configuredCompat: RegimeCompatibility = familyRow?.[regime] ?? 'blocked';

  // Apply empirical override if available
  const key = `${setupFamily}:${regime}`;
  const empiricalTrust = empiricalOverrides?.get(key);
  const finalCompat = _applyEmpirical(configuredCompat, empiricalTrust);

  const alignmentScore = COMPAT_SCORES[finalCompat];

  if (finalCompat === 'blocked') {
    const empiricalNote = empiricalTrust ? ` (empirical: ${empiricalTrust})` : '';
    return {
      allowed: false,
      compatibility: 'blocked',
      configuredCompatibility: configuredCompat,
      alignmentScore: 0,
      reason: `${setupFamily} is incompatible with ${regime} regime${empiricalNote}`,
    };
  }

  const empiricalNote = (empiricalTrust && finalCompat !== configuredCompat)
    ? ` (adjusted from ${configuredCompat} by empirical ${empiricalTrust})`
    : '';

  return {
    allowed: true,
    compatibility: finalCompat,
    configuredCompatibility: configuredCompat,
    alignmentScore,
    reason: `${setupFamily} is ${finalCompat} in ${regime} regime${empiricalNote}`,
  };
}
