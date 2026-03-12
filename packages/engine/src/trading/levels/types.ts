// ── engine/src/trading/levels/types.ts ─────────────────────────────────────────
//
// Shared type definitions for the TriForge Shadow Simulator level-to-level
// trading engine. These types are consumed by:
//   - Level detection engines (supply/demand, swing, FVG, liquidity, volume, session)
//   - Level scoring and ranking
//   - Path prediction and route scoring
//   - Watch-and-confirm engine
//   - Trade decision engine
//   - Shadow execution engine
//   - Council review agents
//   - Learning and journal systems
//   - UI panels
//
// SIMULATION ONLY. No real brokerage orders.

import type {
  SessionLabel, VolatilityRegime, BarTrend, VwapRelation,
  SetupGrade, CouncilVote,
} from '../types';

// ── Level Types ─────────────────────────────────────────────────────────────

export const LEVEL_TYPES = [
  'supply', 'demand',
  'swing_high', 'swing_low',
  'fvg', 'imbalance',
  'liquidity_pool',
  'volume_poc', 'volume_vah', 'volume_val',
  'session_high', 'session_low',
  'prev_day_high', 'prev_day_low',
  'overnight_high', 'overnight_low',
  'opening_range_high', 'opening_range_low',
  'displacement_origin',
] as const;
export type LevelType = typeof LEVEL_TYPES[number];

export type LevelStrength = 'strong' | 'moderate' | 'weak';

export type LevelGrade = 'A' | 'B' | 'C' | 'informational';

// ── Level Quality Factors ───────────────────────────────────────────────────
// 10-factor weighted model. Each factor is normalized 0–100.
// Total weights = 100.

export interface LevelQualityFactors {
  /** How far price displaced away from this level after forming it. Weight: 15 */
  displacementAway: number;
  /** Speed/size of rejection at this level. Weight: 15 */
  reactionStrength: number;
  /** Does the 15m trend agree with this level's directional bias? Weight: 15 */
  htfAlignment: number;
  /** Has this level been tested? Untested = fresh = higher quality. Weight: 10 */
  freshness: number;
  /** Is there a fair value gap / imbalance at this level? Weight: 10 */
  imbalancePresent: number;
  /** Was there volume confirmation when this level formed? Weight: 10 */
  volumeSurge: number;
  /** Is this level near a liquidity pool? Weight: 10 */
  liquidityRelevance: number;
  /** 1 touch = pristine; 2-3 = ok; 4+ = degraded. Weight: 5 */
  touchCountQuality: number;
  /** How recently was this level created? Weight: 5 */
  recency: number;
  /** Did this level cause a break of market structure? Weight: 5 */
  structuralBreak: number;
}

/** Canonical weights for level quality scoring. */
export const LEVEL_QUALITY_WEIGHTS: Record<keyof LevelQualityFactors, number> = {
  displacementAway:   15,
  reactionStrength:   15,
  htfAlignment:       15,
  freshness:          10,
  imbalancePresent:   10,
  volumeSurge:        10,
  liquidityRelevance: 10,
  touchCountQuality:   5,
  recency:             5,
  structuralBreak:     5,
};

// ── Price Level ─────────────────────────────────────────────────────────────

export interface PriceLevel {
  id: string;
  type: LevelType;
  /** Primary price for this level (midpoint for zones). */
  price: number;
  /** Upper bound for zone-type levels (supply/demand). Same as price for line levels. */
  priceHigh?: number;
  strength: LevelStrength;
  /** Number of times price has touched/respected this level. */
  touchCount: number;
  /** When this level was first identified (ms epoch). */
  createdAt: number;
  /** Last time price interacted with this level (ms epoch). */
  lastTestedAt?: number;
  /** True when price has cleanly broken through this level. */
  broken: boolean;
  /** Human-readable label for UI display. */
  label: string;
  /** Quality score 0–100 from weighted factor model. */
  qualityScore: number;
  /** Grade band derived from qualityScore. */
  grade: LevelGrade;
  /** Individual factor scores. */
  qualityFactors: LevelQualityFactors;
  /** The timeframe this level was detected on. */
  sourceTimeframe?: '1m' | '5m' | '15m';
  /** Directional bias: does this level favor longs or shorts? */
  directionalBias?: 'long' | 'short' | 'neutral';
}

// ── Route Types ─────────────────────────────────────────────────────────────

export type RouteDirection = 'long' | 'short';

export interface RouteQualityFactors {
  /** How clear and identifiable is the destination level? Weight: 20 */
  destinationClarity: number;
  /** Is the travel space between entry and target clean? Weight: 20 */
  cleanTravelSpace: number;
  /** Penalty for opposing congestion / intermediate obstacles. Weight: 15 */
  congestionPenalty: number;
  /** How strong is the liquidity pocket at the destination? Weight: 15 */
  destinationLiquidity: number;
  /** Does the route align with the current session window? Weight: 15 */
  sessionAlignment: number;
  /** Does the route align with higher-timeframe structure? Weight: 15 */
  htfAlignment: number;
}

/** Canonical weights for route quality scoring. */
export const ROUTE_QUALITY_WEIGHTS: Record<keyof RouteQualityFactors, number> = {
  destinationClarity:   20,
  cleanTravelSpace:     20,
  congestionPenalty:    15,
  destinationLiquidity: 15,
  sessionAlignment:     15,
  htfAlignment:         15,
};

export interface Route {
  id: string;
  fromLevel: PriceLevel;
  toLevel: PriceLevel;
  direction: RouteDirection;
  /** Distance in points from entry to target. */
  distancePoints: number;
  /** Levels between entry and target that could impede the move. */
  intermediateObstacles: PriceLevel[];
  /** Route quality score 0–100. */
  qualityScore: number;
  /** Individual factor scores. */
  qualityFactors: RouteQualityFactors;
  /** Is this the currently predicted primary route? */
  active: boolean;
  createdAt: number;
}

export interface PathPrediction {
  /** Level price is currently at or nearest to. */
  currentLevel: PriceLevel | null;
  /** Most likely next destination level. */
  nextTargetLevel: PriceLevel;
  direction: RouteDirection;
  /** Primary route. */
  route: Route;
  /** Up to 2 alternate routes. */
  alternateRoutes: Route[];
  /** Overall confidence in this path prediction. */
  confidence: number;
}

// ── Confirmation Types ──────────────────────────────────────────────────────

export const CONFIRMATION_TYPES = [
  'rejection_wick',
  'displacement_candle',
  'micro_structure_break',
  'reclaim_failure',
  'volume_expansion',
  'retest_hold',
  'response_speed',
  'inability_to_continue',
] as const;
export type ConfirmationType = typeof CONFIRMATION_TYPES[number];

export interface ConfirmationSignal {
  type: ConfirmationType;
  /** Signal strength 0–100. */
  strength: number;
  /** When the signal was detected (ms epoch). */
  detectedAt: number;
  /** Price at time of detection. */
  price: number;
  /** Human-readable description of what was detected. */
  description: string;
}

export interface ConfirmationFactors {
  /** Strong candle away from level. Weight: 20 */
  displacement: number;
  /** Short-term high/low sequence shift. Weight: 20 */
  microStructure: number;
  /** Break then immediate reclaim of level. Weight: 15 */
  reclaimFailure: number;
  /** Long wick through level with close back. Weight: 15 */
  rejectionQuality: number;
  /** Price retests level and holds. Weight: 10 */
  retestHold: number;
  /** Bar volume > 1.5x recent average. Weight: 10 */
  volumeConfirmation: number;
  /** Confirmation within 2 bars = fast. Weight: 10 */
  responseSpeed: number;
}

/** Canonical weights for confirmation scoring. */
export const CONFIRMATION_WEIGHTS: Record<keyof ConfirmationFactors, number> = {
  displacement:       20,
  microStructure:     20,
  reclaimFailure:     15,
  rejectionQuality:   15,
  retestHold:         10,
  volumeConfirmation: 10,
  responseSpeed:      10,
};

export interface ConfirmationScore {
  /** Weighted total 0–100. */
  total: number;
  /** Individual factor scores. */
  factors: ConfirmationFactors;
  /** All detected signals contributing to this score. */
  signals: ConfirmationSignal[];
}

// ── Watch Alert ─────────────────────────────────────────────────────────────

export type WatchState = 'idle' | 'watching' | 'confirming' | 'confirmed' | 'rejected';

export interface WatchAlert {
  id: string;
  level: PriceLevel;
  route: Route;
  direction: RouteDirection;
  state: WatchState;
  createdAt: number;
  /** When price first arrived within range of the level. */
  arrivedAt?: number;
  /** When confirmation was achieved. */
  confirmedAt?: number;
  /** When the watch was rejected. */
  rejectedAt?: number;
  /** Why the watch was rejected. */
  rejectionReason?: string;
  /** Detected confirmation signals. */
  confirmations: ConfirmationSignal[];
  /** Computed confirmation score (set during confirming state). */
  confirmationScore?: ConfirmationScore;
}

// ── News / Session Context ──────────────────────────────────────────────────

export type NewsTier = 'top' | 'medium' | 'low';

export interface NewsEvent {
  /** Scheduled time (ms epoch). */
  time: number;
  /** Event title (e.g. "FOMC Rate Decision"). */
  title: string;
  /** Impact classification. */
  tier: NewsTier;
  /** Minutes to block new entries before the event. */
  bufferMinutesBefore: number;
  /** Minutes to wait after the event before re-entering. */
  bufferMinutesAfter: number;
}

export interface SessionContext {
  /** True during 8:30 AM – 12:00 PM CT active trading window. */
  isActive: boolean;
  /** True during 9:00 – 10:30 AM CT prime decision window. */
  isPrime: boolean;
  /** True during 10:30 – 12:00 PM CT reduced aggression window. */
  isReduced: boolean;
  /** True during 8:00 – 8:30 AM CT pre-session map build window. */
  isPreMap: boolean;
  /** Minutes until session close (12:00 PM CT). Negative if past close. */
  minutesUntilClose: number;
  /** Session quality score 0–100 (prime > opening > reduced). */
  sessionScore: number;
  /** True if currently within a news event buffer zone. */
  newsBuffer: boolean;
  /** Active or upcoming news events in the current window. */
  activeEvents: NewsEvent[];
  /** Current session window label. */
  windowLabel: 'pre_map' | 'opening' | 'prime' | 'reduced' | 'closed' | 'outside';
}

// ── Trade Score ──────────────────────────────────────────────────────────────

export type TradeScoreBand = 'elite' | 'A' | 'B' | 'no_trade';

export interface TradeScore {
  /** Final weighted score 0–100. */
  final: number;
  /** Band classification. */
  band: TradeScoreBand;
  /** Component scores. */
  levelScore: number;
  routeScore: number;
  confirmationScore: number;
  sessionScore: number;
  rrScore: number;
  /** Canonical weights applied. */
  weights: {
    level: 30;
    route: 25;
    confirmation: 20;
    session: 10;
    rr: 15;
  };
}

/** Derive score band from final score. */
export function deriveScoreBand(score: number): TradeScoreBand {
  if (score >= 85) return 'elite';
  if (score >= 75) return 'A';
  if (score >= 65) return 'B';
  return 'no_trade';
}

// ── Trade Intent ────────────────────────────────────────────────────────────

export interface TradeIntent {
  id: string;
  symbol: string;
  side: RouteDirection;
  /** Entry price derived from level structure. */
  entry: number;
  /** Stop price beyond level opposite side + ATR padding. */
  stop: number;
  /** Primary target at route destination level. */
  target: number;
  /** Additional targets if multiple destination levels exist. */
  additionalTargets?: number[];
  /** Stop distance in points. */
  stopPoints: number;
  /** Risk-reward ratio. */
  riskRewardRatio: number;
  /** Expected path description. */
  expectedPath: string;
  /** Setup grade derived from trade score. */
  setupGrade: SetupGrade;
  /** Confidence label. */
  confidence: 'high' | 'medium' | 'low';
  /** Why this trade is being proposed. */
  reasons: string[];
  /** Known risks. */
  risks: string[];
  /** Full trade score breakdown. */
  score: TradeScore;
  /** The level where entry originates. */
  entryLevel: PriceLevel;
  /** The route this trade follows. */
  route: Route;
  /** The watch alert that confirmed this trade. */
  watchId: string;
  /** When this intent was generated (ms epoch). */
  createdAt: number;
  /** Setup family classification (from reliability engine). */
  setupFamily?: string;
  /** Setup quality score 0-100 (from reliability engine). */
  setupQualityScore?: number;
  /** Setup quality band (from reliability engine). */
  setupQualityBand?: string;
}

// ── Level Map ───────────────────────────────────────────────────────────────

export interface LevelMap {
  /** Symbol this map was built for. */
  symbol: string;
  /** When the map was last built/refreshed (ms epoch). */
  buildTime: number;
  /** All active levels sorted by distance from current price. */
  levels: PriceLevel[];
  /** Current market price at time of build. */
  currentPrice: number;
  /** Nearest level above current price. */
  nearestAbove: PriceLevel | null;
  /** Nearest level below current price. */
  nearestBelow: PriceLevel | null;
  /** Active primary route if a path prediction exists. */
  activeRoute: Route | null;
  /** Count of levels by type. */
  levelCounts: Partial<Record<LevelType, number>>;
}

// ── Normalized Bar (broker-agnostic) ────────────────────────────────────────

export interface NormalizedBar {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  timeframe: '1m' | '5m' | '15m';
}

// ── Normalized Market Data ──────────────────────────────────────────────────
// Broker-agnostic snapshot used by all level detection and scoring engines.

export interface NormalizedMarketData {
  symbol: string;
  currentPrice: number;
  bidPrice?: number;
  askPrice?: number;
  highOfDay: number;
  lowOfDay: number;
  openPrice?: number;
  prevDayHigh?: number;
  prevDayLow?: number;
  prevDayClose?: number;
  overnightHigh?: number;
  overnightLow?: number;
  vwap?: number;
  atr5m?: number;
  trend5m: BarTrend;
  trend15m: BarTrend;
  vwapRelation?: VwapRelation;
  sessionLabel: SessionLabel;
  volatilityRegime?: VolatilityRegime;
  bars1m: NormalizedBar[];
  bars5m: NormalizedBar[];
  bars15m: NormalizedBar[];
  /** Feed freshness — ms since last tick. */
  feedFreshnessMs?: number;
  /** Indicator readiness state. */
  indicatorReady: boolean;
  /** Timestamp of this snapshot. */
  snapshotTime: number;
}

// ── Journal Entry ───────────────────────────────────────────────────────────

export interface JournalEntry {
  tradeId: string;
  symbol: string;
  direction: RouteDirection;
  /** Type of level that originated the trade. */
  levelType: LevelType;
  /** Quality score of the entry level. */
  levelQualityScore: number;
  /** Quality score of the route. */
  routeQualityScore: number;
  /** Confirmation score at entry. */
  confirmationScore: number;
  /** Final trade score. */
  tradeScore: number;
  /** Trade score band. */
  tradeScoreBand: TradeScoreBand;
  /** Session label at time of trade. */
  sessionLabel: SessionLabel;
  /** Confirmation types that triggered this entry. */
  confirmationTypes: ConfirmationType[];
  /** Trade outcome. */
  outcome: 'win' | 'loss' | 'breakeven';
  /** P&L in R-multiples. */
  pnlR: number;
  /** Maximum favorable excursion in R-multiples. */
  mfeR: number;
  /** Maximum adverse excursion in R-multiples. */
  maeR: number;
  /** How long the trade was held (ms). */
  holdDurationMs: number;
  /** Why the trade was closed. */
  exitReason: string;
  /** Searchable tags (e.g. "supply", "morning", "NQ"). */
  tags: string[];
  /** Optional notes. */
  notes?: string;
  /** When this entry was created (ms epoch). */
  createdAt: number;
}

// ── Weight Adjustment (Learning) ────────────────────────────────────────────

export interface WeightAdjustment {
  factor: string;
  currentWeight: number;
  suggestedWeight: number;
  evidence: string;
  confidence: 'low' | 'medium' | 'high';
}

// ── Session Regime ──────────────────────────────────────────────────────────

export type SessionRegime =
  | 'open_drive'
  | 'range_day'
  | 'trend_day'
  | 'reversal'
  | 'expansion'
  | 'drift'
  | 'unknown';

// ── Trade Block Reasons (Level Engine) ──────────────────────────────────────

export const LEVEL_BLOCK_REASONS = [
  'no_levels_detected',
  'no_valid_route',
  'path_unclear',
  'destination_too_close',
  'insufficient_rr',
  'level_degraded',
  'session_closed',
  'news_buffer_active',
  'feed_stale',
  'confirmation_rejected',
  'mid_range_no_level',
  'stop_too_wide',
  'score_below_threshold',
] as const;
export type LevelBlockReason = typeof LEVEL_BLOCK_REASONS[number];
