// ── main/trading/decision/SetupClassifier.ts ──────────────────────────────────
//
// Tags each trade intent with deterministic classification labels for
// journal, analytics, and learning systems.
//
// All tags are derived from currently available data on the intent, its
// route, its entry level, and its confirmation signals. No historical
// lookback or invented context.

import type {
  TradeIntent, WatchAlert, SessionContext, ConfirmationType,
  LevelType, TradeScoreBand,
} from '@triforge/engine';

// ── Setup Tags ────────────────────────────────────────────────────────────────

export interface SetupTags {
  /** Symbol traded. */
  symbol: string;
  /** Trade direction. */
  direction: 'long' | 'short';
  /** Primary entry level type. */
  entryLevelType: LevelType;
  /** Destination level type. */
  destinationLevelType: LevelType;
  /** Confirmation signal types that contributed to the entry. */
  confirmationTypes: ConfirmationType[];
  /** Final score band. */
  scoreBand: TradeScoreBand;
  /** Session window label at time of trade (or 'unknown'). */
  sessionWindow: string;
  /** Route character: clean (0-1 obstacles) or congested (2+). */
  routeCharacter: 'clean' | 'congested';
  /** Whether a liquidity pool level is involved (entry or destination). */
  liquidityInvolved: boolean;
  /** Whether an FVG/imbalance is involved (entry or destination). */
  imbalanceInvolved: boolean;
  /** Entry level quality grade. */
  entryLevelGrade: string;
  /** Destination level quality grade. */
  destinationLevelGrade: string;
  /** All tags as a flat string array for journal storage. */
  flat: string[];
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Classify a trade intent into deterministic tags.
 *
 * @param intent  - The trade intent to classify
 * @param watch   - The watch alert that confirmed this trade (for confirmation types)
 * @param session - Session context at time of trade (optional)
 * @returns SetupTags with all classification labels.
 */
export function classifySetup(
  intent: TradeIntent,
  watch: WatchAlert | null,
  session: SessionContext | null,
): SetupTags {
  const entryLevel = intent.entryLevel;
  const destLevel = intent.route.toLevel;

  // Confirmation types from the watch's detected signals
  const confirmationTypes: ConfirmationType[] = watch
    ? [...new Set(watch.confirmations.map(s => s.type))]
    : [];

  // Route character
  const obstacleCount = intent.route.intermediateObstacles.length;
  const routeCharacter: 'clean' | 'congested' = obstacleCount <= 1 ? 'clean' : 'congested';

  // Liquidity involvement
  const liquidityTypes = new Set<LevelType>(['liquidity_pool']);
  const liquidityInvolved =
    liquidityTypes.has(entryLevel.type) ||
    liquidityTypes.has(destLevel.type);

  // Imbalance involvement
  const imbalanceTypes = new Set<LevelType>(['fvg', 'imbalance']);
  const imbalanceInvolved =
    imbalanceTypes.has(entryLevel.type) ||
    imbalanceTypes.has(destLevel.type);

  // Session window
  const sessionWindow = session?.windowLabel ?? 'unknown';

  // Build flat tag array for journal storage
  const flat: string[] = [
    intent.symbol,
    intent.side,
    `entry:${entryLevel.type}`,
    `dest:${destLevel.type}`,
    `band:${intent.score.band}`,
    `session:${sessionWindow}`,
    `route:${routeCharacter}`,
    `entry_grade:${entryLevel.grade}`,
    `dest_grade:${destLevel.grade}`,
  ];

  if (liquidityInvolved) flat.push('liquidity');
  if (imbalanceInvolved) flat.push('imbalance');
  for (const ct of confirmationTypes) {
    flat.push(`confirm:${ct}`);
  }

  return {
    symbol: intent.symbol,
    direction: intent.side,
    entryLevelType: entryLevel.type,
    destinationLevelType: destLevel.type,
    confirmationTypes,
    scoreBand: intent.score.band,
    sessionWindow,
    routeCharacter,
    liquidityInvolved,
    imbalanceInvolved,
    entryLevelGrade: entryLevel.grade,
    destinationLevelGrade: destLevel.grade,
    flat,
  };
}
