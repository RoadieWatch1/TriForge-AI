// ── main/trading/council/CouncilTradeReviewContext.ts ──────────────────────────
//
// Builds a structured context object from the level-to-level simulator state.
// This context is shared across all 3 specialized council agents and serialized
// into concise prompt text.
//
// No AI calls. Pure data extraction and formatting.

import type {
  LevelMap, PriceLevel, Route, PathPrediction,
  WatchAlert, TradeIntent, SessionContext, TradeScore,
  ConfirmationSignal, NewsEvent,
} from '@triforge/engine';
import type { TriForgeShadowSimulator } from '../shadow/TriForgeShadowSimulator';
import type { NewsRiskContext } from '../news/NewsRiskGate';
import type { RegimeContext, SessionRegime } from '../learning/SessionRegimeMemory';

// ── Context Types ───────────────────────────────────────────────────────────

export interface LevelSummary {
  price: number;
  type: string;
  quality: number;
  label: string;
  touchCount: number;
  isNearest: boolean;
}

export interface RouteSummary {
  fromPrice: number;
  fromType: string;
  fromQuality: number;
  toPrice: number;
  toType: string;
  toQuality: number;
  direction: string;
  distancePoints: number;
  routeQuality: number;
  obstacleCount: number;
  obstacles: string[];
}

export interface ConfirmationSummary {
  totalScore: number;
  threshold: number;
  detected: Array<{ type: string; weight: number }>;
  missing: Array<{ type: string; weight: number }>;
}

export interface CouncilTradeReviewContext {
  // Trade details
  symbol: string;
  side: string;
  entry: number;
  stop: number;
  target: number;
  stopPoints: number;
  riskRewardRatio: number;

  // Level info
  entryLevelType: string;
  entryLevelQuality: number;
  entryLevelLabel: string;
  entryLevelTouchCount: number;
  entryLevelGrade: string;
  destinationLevelType: string;
  destinationLevelQuality: number;
  destinationLevelLabel: string;
  destinationLevelTouchCount: number;
  destinationLevelGrade: string;

  // Route
  route: RouteSummary | null;

  // Confirmation
  confirmation: ConfirmationSummary | null;

  // Trade scoring
  score: TradeScore | null;
  setupGrade: string;
  confidence: string;
  reasons: string[];
  risks: string[];

  // Level map context (nearby levels only — not the full map)
  nearbyLevelsAbove: LevelSummary[];
  nearbyLevelsBelow: LevelSummary[];

  // Session
  sessionWindow: string;
  sessionScore: number;
  minutesUntilClose: number;
  isPrime: boolean;
  isReduced: boolean;

  // Market
  lastPrice: number;
  trend5m: string;
  trend15m: string;
  highOfDay: number;
  lowOfDay: number;

  // Engine state
  tickCount: number;
  blockedReason: string | null;

  // News context
  newsRiskFlags: string[];
  newsScoreAdjustment: number;
  nearbyNewsEvents: Array<{ title: string; tier: string; minutesUntil: number }>;

  // Session regime
  currentRegime: SessionRegime | null;
  regimeConfidence: number;
  regimeDescription: string;
}

// ── Builder ─────────────────────────────────────────────────────────────────

/**
 * Build a CouncilTradeReviewContext from the simulator and current intent.
 * Returns null if critical data is missing.
 */
export function buildCouncilContext(
  simulator: TriForgeShadowSimulator,
  intent: TradeIntent,
  lastPrice: number,
  trend5m: string,
  trend15m: string,
  highOfDay: number,
  lowOfDay: number,
): CouncilTradeReviewContext | null {
  const state = simulator.getState();
  const levelMap = simulator.getLevelMap();
  const prediction = simulator.getPathPrediction();
  const session = simulator.getSessionContext();
  const newsCtx = simulator.getNewsRiskContext();
  const regimeCtx = simulator.getRegimeContext();

  // Resolve session window label
  let sessionWindow = 'UNKNOWN';
  if (session) {
    if (!session.isActive) sessionWindow = 'CLOSED';
    else if (session.isPreMap) sessionWindow = 'PRE-MAP';
    else if (session.isPrime) sessionWindow = 'PRIME';
    else if (session.isReduced) sessionWindow = 'REDUCED';
    else sessionWindow = 'OPENING';
  }

  // Build route summary
  let routeSummary: RouteSummary | null = null;
  if (intent.route) {
    const r = intent.route;
    routeSummary = {
      fromPrice: r.fromLevel.price,
      fromType: r.fromLevel.type,
      fromQuality: r.fromLevel.qualityScore,
      toPrice: r.toLevel.price,
      toType: r.toLevel.type,
      toQuality: r.toLevel.qualityScore,
      direction: r.direction,
      distancePoints: r.distancePoints,
      routeQuality: r.qualityScore,
      obstacleCount: r.intermediateObstacles.length,
      obstacles: r.intermediateObstacles.map(o => `${o.type} @ ${o.price.toFixed(2)} (Q${Math.round(o.qualityScore)})`),
    };
  }

  // Build confirmation summary from the watch that triggered this intent
  let confirmationSummary: ConfirmationSummary | null = null;
  const watches = simulator.getWatches();
  const triggeringWatch = watches.find(w => w.id === intent.watchId);
  if (triggeringWatch && triggeringWatch.confirmations.length > 0) {
    const detected = triggeringWatch.confirmations.filter(c => c.detected);
    const missing = triggeringWatch.confirmations.filter(c => !c.detected);
    confirmationSummary = {
      totalScore: triggeringWatch.confirmationScore?.total ?? 0,
      threshold: 65,
      detected: detected.map(c => ({ type: c.type, weight: c.weight })),
      missing: missing.map(c => ({ type: c.type, weight: c.weight })),
    };
  }

  // Build nearby levels (max 4 above + 4 below)
  const nearbyAbove: LevelSummary[] = [];
  const nearbyBelow: LevelSummary[] = [];
  if (levelMap) {
    const sorted = [...levelMap.levels]
      .filter(l => !l.broken)
      .sort((a, b) => a.price - b.price);
    for (const l of sorted) {
      const summary: LevelSummary = {
        price: l.price,
        type: l.type,
        quality: l.qualityScore,
        label: l.label,
        touchCount: l.touchCount,
        isNearest: l.id === levelMap.nearestAbove?.id || l.id === levelMap.nearestBelow?.id,
      };
      if (l.price > lastPrice && nearbyAbove.length < 4) nearbyAbove.push(summary);
      else if (l.price <= lastPrice && nearbyBelow.length < 4) nearbyBelow.unshift(summary);
    }
    // Sort: above ascending, below descending
    nearbyAbove.sort((a, b) => a.price - b.price);
    nearbyBelow.sort((a, b) => b.price - a.price);
  }

  return {
    symbol: intent.symbol,
    side: intent.side,
    entry: intent.entry,
    stop: intent.stop,
    target: intent.target,
    stopPoints: intent.stopPoints,
    riskRewardRatio: intent.riskRewardRatio,

    entryLevelType: intent.entryLevel.type,
    entryLevelQuality: intent.entryLevel.qualityScore,
    entryLevelLabel: intent.entryLevel.label,
    entryLevelTouchCount: intent.entryLevel.touchCount,
    entryLevelGrade: intent.entryLevel.grade ?? 'C',
    destinationLevelType: intent.route.toLevel.type,
    destinationLevelQuality: intent.route.toLevel.qualityScore,
    destinationLevelLabel: intent.route.toLevel.label,
    destinationLevelTouchCount: intent.route.toLevel.touchCount,
    destinationLevelGrade: intent.route.toLevel.grade ?? 'C',

    route: routeSummary,
    confirmation: confirmationSummary,

    score: intent.score,
    setupGrade: intent.setupGrade,
    confidence: intent.confidence,
    reasons: intent.reasons,
    risks: intent.risks,

    nearbyLevelsAbove: nearbyAbove,
    nearbyLevelsBelow: nearbyBelow,

    sessionWindow,
    sessionScore: session?.sessionScore ?? 0,
    minutesUntilClose: session?.minutesUntilClose ?? 0,
    isPrime: session?.isPrime ?? false,
    isReduced: session?.isReduced ?? false,

    lastPrice,
    trend5m,
    trend15m,
    highOfDay,
    lowOfDay,

    tickCount: state.tickCount,
    blockedReason: state.blockedReason ?? null,

    // News context
    newsRiskFlags: newsCtx?.riskFlags ?? [],
    newsScoreAdjustment: newsCtx?.scoreAdjustment ?? 0,
    nearbyNewsEvents: (newsCtx?.nearbyEvents ?? []).map(e => ({
      title: e.title,
      tier: e.tier,
      minutesUntil: Math.round((e.time - Date.now()) / 60_000),
    })),

    // Session regime
    currentRegime: regimeCtx?.current?.regime ?? null,
    regimeConfidence: regimeCtx?.current?.confidence ?? 0,
    regimeDescription: regimeCtx?.current?.description ?? '',
  };
}

// ── Serialization Helpers ───────────────────────────────────────────────────

/** Format the shared trade setup block used in all agent prompts. */
export function formatTradeSetup(ctx: CouncilTradeReviewContext): string {
  return (
    `INSTRUMENT: ${ctx.symbol}\n` +
    `SIDE: ${ctx.side.toUpperCase()}\n` +
    `ENTRY: ${ctx.entry.toFixed(2)}  |  STOP: ${ctx.stop.toFixed(2)} (${ctx.stopPoints.toFixed(1)} pts risk)  |  TARGET: ${ctx.target.toFixed(2)}\n` +
    `R:R: ${ctx.riskRewardRatio.toFixed(2)}:1\n` +
    `LAST PRICE: ${ctx.lastPrice.toFixed(2)}  |  HOD: ${ctx.highOfDay.toFixed(2)}  |  LOD: ${ctx.lowOfDay.toFixed(2)}\n` +
    `TREND (5m): ${ctx.trend5m}  |  TREND (15m): ${ctx.trend15m}`
  );
}

/** Format the level and route context block. */
export function formatLevelContext(ctx: CouncilTradeReviewContext): string {
  const lines: string[] = [];
  lines.push(`ENTRY LEVEL: ${ctx.entryLevelType.replace(/_/g, ' ')} @ ${ctx.entry.toFixed(2)} — Quality ${Math.round(ctx.entryLevelQuality)} [${ctx.entryLevelGrade.toUpperCase()}] | ${ctx.entryLevelTouchCount} touch(es) (${ctx.entryLevelLabel})`);
  lines.push(`DESTINATION: ${ctx.destinationLevelType.replace(/_/g, ' ')} @ ${ctx.target.toFixed(2)} — Quality ${Math.round(ctx.destinationLevelQuality)} [${ctx.destinationLevelGrade.toUpperCase()}] | ${ctx.destinationLevelTouchCount} touch(es) (${ctx.destinationLevelLabel})`);
  lines.push(`STOP: ${ctx.stop.toFixed(2)} (${ctx.stopPoints.toFixed(1)} pts behind entry level)`);

  if (ctx.route) {
    lines.push(`ROUTE QUALITY: ${Math.round(ctx.route.routeQuality)} | Distance: ${ctx.route.distancePoints.toFixed(1)} pts | Obstacles: ${ctx.route.obstacleCount}`);
    if (ctx.route.obstacles.length > 0) {
      lines.push(`  Obstacles: ${ctx.route.obstacles.join(', ')}`);
    }
  }

  return lines.join('\n');
}

/** Format nearby levels for map awareness. */
export function formatNearbyLevels(ctx: CouncilTradeReviewContext): string {
  const lines: string[] = [];
  if (ctx.nearbyLevelsAbove.length > 0) {
    lines.push('LEVELS ABOVE:');
    for (const l of ctx.nearbyLevelsAbove) {
      const marker = l.isNearest ? ' [NEAREST]' : '';
      lines.push(`  ${l.price.toFixed(2)}  ${l.type.replace(/_/g, ' ')}  Q${Math.round(l.quality)}  ${l.touchCount}t${marker}`);
    }
  }
  if (ctx.nearbyLevelsBelow.length > 0) {
    lines.push('LEVELS BELOW:');
    for (const l of ctx.nearbyLevelsBelow) {
      const marker = l.isNearest ? ' [NEAREST]' : '';
      lines.push(`  ${l.price.toFixed(2)}  ${l.type.replace(/_/g, ' ')}  Q${Math.round(l.quality)}  ${l.touchCount}t${marker}`);
    }
  }
  return lines.join('\n') || 'No nearby levels mapped.';
}

/** Format the confirmation evidence block. */
export function formatConfirmation(ctx: CouncilTradeReviewContext): string {
  if (!ctx.confirmation) return 'CONFIRMATION: No confirmation data available.';
  const lines: string[] = [];
  const margin = ctx.confirmation.totalScore - ctx.confirmation.threshold;
  const marginLabel = margin >= 20 ? 'strong' : margin >= 10 ? 'adequate' : margin >= 0 ? 'marginal' : 'BELOW THRESHOLD';
  lines.push(`CONFIRMATION SCORE: ${Math.round(ctx.confirmation.totalScore)} / 100 (threshold: ${ctx.confirmation.threshold}, margin: ${margin >= 0 ? '+' : ''}${Math.round(margin)} — ${marginLabel})`);
  if (ctx.confirmation.detected.length > 0) {
    lines.push(`  Detected: ${ctx.confirmation.detected.map(s => `${s.type.replace(/_/g, ' ')} (wt ${s.weight})`).join(', ')}`);
  }
  if (ctx.confirmation.missing.length > 0) {
    const missingWeight = ctx.confirmation.missing.reduce((s, m) => s + m.weight, 0);
    lines.push(`  Missing: ${ctx.confirmation.missing.map(s => `${s.type.replace(/_/g, ' ')} (wt ${s.weight})`).join(', ')} — total missing weight: ${missingWeight}`);
  }
  return lines.join('\n');
}

/** Format the trade score breakdown. */
export function formatScoreBreakdown(ctx: CouncilTradeReviewContext): string {
  if (!ctx.score) return 'SCORE: Not available.';
  return (
    `TRADE SCORE: ${Math.round(ctx.score.final)} / 100  |  Band: ${ctx.score.band.toUpperCase()}  |  Grade: ${ctx.setupGrade}\n` +
    `  Level: ${Math.round(ctx.score.levelScore)} (30%)  |  Route: ${Math.round(ctx.score.routeScore)} (25%)  |  Confirm: ${Math.round(ctx.score.confirmationScore)} (20%)\n` +
    `  Session: ${Math.round(ctx.score.sessionScore)} (10%)  |  R:R: ${Math.round(ctx.score.rrScore)} (15%)`
  );
}

/** Format the session context line. */
export function formatSessionContext(ctx: CouncilTradeReviewContext): string {
  return `SESSION: ${ctx.sessionWindow} | Score: ${Math.round(ctx.sessionScore)} | ${ctx.minutesUntilClose}m until close`;
}

/** Format the engine reasoning block. */
export function formatReasons(ctx: CouncilTradeReviewContext): string {
  const lines: string[] = [];
  if (ctx.reasons.length > 0) lines.push(`REASONS: ${ctx.reasons.join('; ')}`);
  if (ctx.risks.length > 0)   lines.push(`RISKS: ${ctx.risks.join('; ')}`);
  return lines.join('\n') || '';
}

/** Format news risk context for injection into council prompts. */
export function formatNewsContext(ctx: CouncilTradeReviewContext): string {
  if (ctx.newsRiskFlags.length === 0 && ctx.nearbyNewsEvents.length === 0) return '';

  const lines: string[] = ['── NEWS / ECONOMIC EVENTS ──'];

  if (ctx.newsRiskFlags.length > 0) {
    for (const flag of ctx.newsRiskFlags) {
      lines.push(`- ${flag}`);
    }
  }

  if (ctx.newsScoreAdjustment !== 0) {
    lines.push(`Score adjustment: ${ctx.newsScoreAdjustment > 0 ? '+' : ''}${ctx.newsScoreAdjustment}`);
  }

  if (ctx.nearbyNewsEvents.length > 0 && ctx.newsRiskFlags.length === 0) {
    for (const e of ctx.nearbyNewsEvents) {
      const timing = e.minutesUntil > 0 ? `in ${e.minutesUntil}m` : `${Math.abs(e.minutesUntil)}m ago`;
      lines.push(`- ${e.tier.toUpperCase()}: "${e.title}" (${timing})`);
    }
  }

  return lines.join('\n');
}

/** Format session regime context for injection into council prompts. */
export function formatRegimeContext(ctx: CouncilTradeReviewContext): string {
  if (!ctx.currentRegime) return '';

  return (
    `── SESSION REGIME ──\n` +
    `Regime: ${ctx.currentRegime.replace(/_/g, ' ').toUpperCase()} (${ctx.regimeConfidence}% confidence)\n` +
    `${ctx.regimeDescription}`
  );
}
