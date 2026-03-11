// ── main/trading/council/CounterCaseAgentPrompt.ts ────────────────────────────
//
// Grok seat — Counter-Case / Trap Agent.
// Question: "What is the strongest reason this trade fails?"
//
// Focus: alternate path, liquidity traps, fake breakouts/breakdowns,
// weakness in route thesis, reasons price may reject the destination.
// Grok retains VETO power via REJECT vote.

import type { CouncilTradeReviewContext } from './CouncilTradeReviewContext';
import {
  formatTradeSetup, formatLevelContext, formatNearbyLevels,
  formatConfirmation, formatScoreBreakdown, formatSessionContext,
  formatReasons, formatNewsContext, formatRegimeContext,
} from './CouncilTradeReviewContext';

export const COUNTER_CASE_AGENT_ROLE = 'Counter-Case & Trap Analyst';

export const COUNTER_CASE_AGENT_SYSTEM =
  `You are the Counter-Case & Trap Analyst on the TriForge Trading Council.\n` +
  `Your job: find the strongest reason this trade FAILS. You are the adversary.\n` +
  `You have VETO power — a REJECT vote kills the trade. Use it wisely.\n\n` +
  `FAKE BREAKOUT / BREAKDOWN PATTERNS:\n` +
  `- Price sweeps a level, triggers stops, then reverses. If entry is just beyond a heavily-tested level, this could be a stop hunt.\n` +
  `- If entry is near a liquidity pool (clustered equal highs/lows), smart money may be baiting retail.\n` +
  `- A "confirmed" break that immediately stalls or shows absorption (equal candles, doji) is likely fake.\n\n` +
  `EXHAUSTION SIGNALS:\n` +
  `- Price near HOD with a long trade, or near LOD with a short trade, in the second half of the session → potential exhaustion.\n` +
  `- Extended directional move (price already traveled 70%+ of the day's range in the proposed direction) → momentum may be spent.\n` +
  `- Drift regime + directional trade = chasing a grind that is likely to stall.\n\n` +
  `LIQUIDITY TRAP MECHANICS:\n` +
  `- A liquidity pool ABOVE price is a magnet for longs (and a trap if shorts are building). Vice versa below.\n` +
  `- If the entry level sits at a cluster of stops (many nearby levels at similar prices), the move may be a sweep, not a genuine level reaction.\n` +
  `- Check nearby levels: are there equal highs/lows that could draw price past the proposed stop?\n\n` +
  `ALTERNATE PATH:\n` +
  `- Always identify the most likely alternate destination. If it is stronger or closer than the proposed target, the trade thesis is weak.\n` +
  `- If timeframes disagree (5m vs 15m), the alternate path from the higher timeframe carries more weight.\n\n` +
  `WHEN NOT TO VETO:\n` +
  `- Do NOT REJECT based on generic pessimism or vague "anything could happen" reasoning — that is a WAIT.\n` +
  `- Do NOT REJECT if the setup is elite-grade, strongly confirmed, and your counter-case is speculative.\n` +
  `- Do NOT REJECT if the only concern is distance to target — that is the Structure seat's call.\n` +
  `- REJECT only when you can point to a specific, evidence-based trap or failure pattern in the current data.\n\n` +
  `Respond only in the exact format requested.`;

export function buildCounterCaseAgentPrompt(ctx: CouncilTradeReviewContext): string {
  // Build trap indicators the agent should consider
  const trapIndicators: string[] = [];

  // Check if entry is near HOD/LOD (potential exhaustion zone)
  const hodDist = Math.abs(ctx.lastPrice - ctx.highOfDay);
  const lodDist = Math.abs(ctx.lastPrice - ctx.lowOfDay);
  const range = ctx.highOfDay - ctx.lowOfDay;
  if (range > 0) {
    if (ctx.side === 'up' && hodDist / range < 0.1) trapIndicators.push('[EXHAUSTION] Price is within 10% of HOD — long may be buying the top');
    if (ctx.side === 'down' && lodDist / range < 0.1) trapIndicators.push('[EXHAUSTION] Price is within 10% of LOD — short may be selling the bottom');
    // Extended move detection
    const priceProgress = ctx.side === 'up'
      ? (ctx.lastPrice - ctx.lowOfDay) / range
      : (ctx.highOfDay - ctx.lastPrice) / range;
    if (priceProgress > 0.7) trapIndicators.push(`[EXHAUSTION] Price has already traveled ${Math.round(priceProgress * 100)}% of day range in the proposed direction — momentum may be spent`);
  }

  // Check for trend disagreement
  if (ctx.trend5m !== ctx.trend15m) {
    trapIndicators.push(`[DIVERGENCE] Timeframe conflict: 5m=${ctx.trend5m}, 15m=${ctx.trend15m} — higher TF carries more weight`);
  }
  // Both timeframes opposing
  if ((ctx.side === 'up' && ctx.trend5m === 'down' && ctx.trend15m === 'down') ||
      (ctx.side === 'down' && ctx.trend5m === 'up' && ctx.trend15m === 'up')) {
    trapIndicators.push('[COUNTER-TREND] Both timeframes oppose the proposed direction — counter-trend trade');
  }

  // Check for obstacles in path
  if (ctx.route && ctx.route.obstacles.length > 0) {
    const highQualityObstacles = ctx.route.obstacles.filter(o => {
      const qMatch = o.match(/Q(\d+)/);
      return qMatch && parseInt(qMatch[1]) >= 65;
    });
    if (highQualityObstacles.length > 0) {
      trapIndicators.push(`[OBSTACLE] ${highQualityObstacles.length} high-quality obstacle(s) in path: ${highQualityObstacles.join('; ')}`);
    } else {
      trapIndicators.push(`[OBSTACLE] Path has ${ctx.route.obstacles.length} obstacle(s): ${ctx.route.obstacles.join('; ')}`);
    }
  }

  // Check for liquidity pools nearby (potential stop-hunt targets)
  const liqAbove = ctx.nearbyLevelsAbove.filter(l => l.type === 'liquidity_pool');
  const liqBelow = ctx.nearbyLevelsBelow.filter(l => l.type === 'liquidity_pool');
  if (liqAbove.length > 0 && ctx.side === 'down') {
    trapIndicators.push(`[TRAP] Liquidity pool ABOVE at ${liqAbove.map(l => l.price.toFixed(2)).join(', ')} — may sweep stops before reversing down`);
  }
  if (liqBelow.length > 0 && ctx.side === 'up') {
    trapIndicators.push(`[TRAP] Liquidity pool BELOW at ${liqBelow.map(l => l.price.toFixed(2)).join(', ')} — may sweep stops before reversing up`);
  }
  if ((liqAbove.length > 0 && ctx.side === 'up') || (liqBelow.length > 0 && ctx.side === 'down')) {
    trapIndicators.push('[TRAP] Liquidity pool in the direction of the trade — could be a stop-hunt magnet that reverses after the sweep');
  }

  // Check for nearby equal highs/lows (clustered levels = liquidity zone)
  const entryNearbyLevels = ctx.side === 'up' ? ctx.nearbyLevelsBelow : ctx.nearbyLevelsAbove;
  const clustered = entryNearbyLevels.filter(l => Math.abs(l.price - ctx.entry) / (range || 1) < 0.05);
  if (clustered.length >= 2) {
    trapIndicators.push(`[TRAP] ${clustered.length} levels clustered near entry (${clustered.map(l => l.type.replace(/_/g, ' ')).join(', ')}) — stop cluster zone`);
  }

  // Entry level degradation as trap signal
  if (ctx.entryLevelTouchCount >= 4) {
    trapIndicators.push(`[DEGRADED] Entry level tested ${ctx.entryLevelTouchCount} times — diminishing reaction probability`);
  }

  // Check for nearby news events
  if (ctx.nearbyNewsEvents.some(e => e.tier === 'top' && e.minutesUntil > 0 && e.minutesUntil <= 30)) {
    trapIndicators.push('[NEWS] Top-tier economic event approaching — price may reverse violently on release');
  }

  // Check for regime-based traps
  if (ctx.currentRegime === 'range') {
    trapIndicators.push('[REGIME] Range-bound session — breakout attempts typically fail and revert to range');
  }
  if (ctx.currentRegime === 'reversal') {
    trapIndicators.push('[REGIME] Reversal session — initial directional move already failed; this may be chasing the reversal');
  }
  if (ctx.currentRegime === 'drift') {
    trapIndicators.push('[REGIME] Drift session — low volatility grind, directional trades likely to stall');
  }

  const trapBlock = trapIndicators.length > 0
    ? `\n── TRAP INDICATORS ──\n${trapIndicators.map(t => `- ${t}`).join('\n')}\n`
    : '';

  return (
    `You are reviewing a proposed shadow trade (simulation only — no real money at risk).\n\n` +
    `${formatTradeSetup(ctx)}\n\n` +
    `── LEVEL & ROUTE CONTEXT ──\n` +
    `${formatLevelContext(ctx)}\n\n` +
    `── NEARBY LEVELS (potential alternate destinations) ──\n` +
    `${formatNearbyLevels(ctx)}\n\n` +
    `── CONFIRMATION ──\n` +
    `${formatConfirmation(ctx)}\n\n` +
    `── SCORING ──\n` +
    `${formatScoreBreakdown(ctx)}\n` +
    `${formatSessionContext(ctx)}\n` +
    `${trapBlock}` +
    `${formatNewsContext(ctx) ? '\n' + formatNewsContext(ctx) + '\n' : ''}` +
    `${formatRegimeContext(ctx) ? '\n' + formatRegimeContext(ctx) + '\n' : ''}\n` +
    `${formatReasons(ctx)}\n\n` +
    `YOUR TASK (Counter-Case & Trap Analyst — you have VETO power):\n` +
    `Find the strongest reason this trade fails.\n\n` +
    `Review the TRAP INDICATORS above and assess:\n` +
    `1. ALTERNATE PATH: Where is price most likely to go INSTEAD of the proposed target? Is the alternate stronger?\n` +
    `2. TRAP RISK: Do the indicators suggest a liquidity trap, fake break, or stop hunt in progress?\n` +
    `3. EXHAUSTION: Has the move already been made? Is this chasing a move that is nearly done?\n` +
    `4. ENTRY INVALIDATION: What specific event would prove the entry level no longer holds?\n\n` +
    `VETO RULES:\n` +
    `- REJECT only if you identify a specific, evidence-based trap or failure pattern from the data provided.\n` +
    `- Do NOT REJECT based on speculation or generic pessimism. That is a WAIT.\n` +
    `- Do NOT REJECT just because you can imagine a scenario where price reverses. Every trade has risk.\n` +
    `- If the setup is elite-grade with strong confirmation and your counter-case is speculative → TAKE or WAIT, not REJECT.\n\n` +
    `Respond in this EXACT format — no other text:\n` +
    `VOTE: TAKE\n` +
    `CONFIDENCE: 75\n` +
    `REASON: One sentence naming the specific trap, exhaustion signal, or alternate path that influenced your vote.\n\n` +
    `VOTE must be exactly TAKE, WAIT, or REJECT.\n` +
    `CONFIDENCE must be a number 0-100.`
  );
}
