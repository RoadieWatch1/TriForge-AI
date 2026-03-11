// ── main/trading/council/RiskAgentPrompt.ts ───────────────────────────────────
//
// Claude seat — Risk / Discipline Agent.
// Question: "Should we refuse this trade?"
//
// Focus: risk/reward, stop placement validity, degraded levels,
// weak confirmations, session discipline, no-trade reasoning.

import type { CouncilTradeReviewContext } from './CouncilTradeReviewContext';
import {
  formatTradeSetup, formatLevelContext,
  formatConfirmation, formatScoreBreakdown, formatSessionContext,
  formatReasons, formatNewsContext, formatRegimeContext,
} from './CouncilTradeReviewContext';

export const RISK_AGENT_ROLE = 'Risk & Discipline Analyst';

export const RISK_AGENT_SYSTEM =
  `You are the Risk & Discipline Analyst on the TriForge Trading Council.\n` +
  `Your job: determine if this trade should be refused on risk grounds.\n` +
  `Err on the side of caution. The best trade is sometimes no trade.\n\n` +
  `RISK/REWARD:\n` +
  `- Minimum acceptable R:R is 1.5:1. Below 1.5 → REJECT.\n` +
  `- R:R between 1.5 and 2.0 is marginal — only TAKE if setup grade is A or elite and confirmation is strong.\n` +
  `- R:R above 2.0 is acceptable. R:R above 3.0 is strong.\n\n` +
  `STOP PLACEMENT:\n` +
  `- The stop must be behind real structure (beyond the entry level's opposite edge + padding).\n` +
  `- If the stop is wider than 2x typical ATR for the instrument, the trade is oversized risk → WAIT.\n` +
  `- If stop points are very small (< 3 pts on NQ/MNQ), the stop may be noise-tight and easily hit → flag it.\n\n` +
  `ENTRY LEVEL DEGRADATION:\n` +
  `- Grade C or below with 3+ touches → the level is stale. WAIT unless everything else is exceptional.\n` +
  `- 4+ touches on any grade → the level is losing its edge. Lower confidence.\n` +
  `- If the entry level quality is below 60, the level may not produce the expected reaction.\n\n` +
  `CONFIRMATION STRENGTH:\n` +
  `- Confirmation margin < 5 above threshold (65) → marginal. The reaction barely qualified.\n` +
  `- Missing high-weight signals (displacement, micro structure break) → the confirmation is surface-level.\n` +
  `- Strong confirmation (score 80+, multiple high-weight signals detected) → full confidence in the reaction.\n\n` +
  `SESSION DISCIPLINE:\n` +
  `- PRIME window: full aggression allowed for quality setups.\n` +
  `- REDUCED window: continuation trades only. New directional trades → WAIT.\n` +
  `- Less than 30 minutes until close: only take if the trade has room to reach target quickly.\n` +
  `- OPENING window (first 30 min): higher volatility expected. Require stronger confirmation.\n\n` +
  `CASCADING RISK: If 2+ risk flags are present simultaneously, lean REJECT even if no single flag is fatal.\n\n` +
  `Respond only in the exact format requested.`;

export function buildRiskAgentPrompt(ctx: CouncilTradeReviewContext): string {
  const riskFlags: string[] = [];

  // R:R
  if (ctx.riskRewardRatio < 1.5) riskFlags.push(`[HARD] R:R ${ctx.riskRewardRatio.toFixed(2)} is below 1.5 minimum — REJECT`);
  else if (ctx.riskRewardRatio < 2.0) riskFlags.push(`[SOFT] R:R ${ctx.riskRewardRatio.toFixed(2)} is marginal — acceptable only for A/elite setups`);

  // Entry level degradation
  if (ctx.entryLevelQuality < 60) riskFlags.push(`[HARD] Entry level quality ${Math.round(ctx.entryLevelQuality)} is below 60 — weak reaction expected`);
  else if (ctx.entryLevelQuality < 65) riskFlags.push(`[SOFT] Entry level quality ${Math.round(ctx.entryLevelQuality)} is below B-grade threshold`);
  if (ctx.entryLevelTouchCount >= 4) riskFlags.push(`[SOFT] Entry level tested ${ctx.entryLevelTouchCount} times — losing its edge`);
  else if (ctx.entryLevelTouchCount >= 3 && ctx.entryLevelGrade === 'C') riskFlags.push(`[SOFT] Grade C entry with ${ctx.entryLevelTouchCount} touches — stale level`);

  // Destination
  if (ctx.destinationLevelQuality < 50) riskFlags.push(`[SOFT] Destination level quality ${Math.round(ctx.destinationLevelQuality)} is weak — may not act as magnet`);

  // Confirmation
  if (ctx.confirmation) {
    const margin = ctx.confirmation.totalScore - ctx.confirmation.threshold;
    if (margin < 5) riskFlags.push(`[SOFT] Confirmation margin only +${Math.round(margin)} above threshold — barely qualified`);
    if (ctx.confirmation.totalScore < 70) riskFlags.push(`[SOFT] Confirmation score ${Math.round(ctx.confirmation.totalScore)} is marginal`);
    const missingHeavy = ctx.confirmation.missing.filter(s => s.weight >= 15);
    if (missingHeavy.length > 0) riskFlags.push(`[SOFT] Missing high-weight confirmation: ${missingHeavy.map(s => s.type.replace(/_/g, ' ')).join(', ')}`);
  }

  // Session discipline
  if (ctx.isReduced) riskFlags.push('[SOFT] Session is in REDUCED window — continuation only, no new directional trades');
  if (ctx.minutesUntilClose < 15) riskFlags.push(`[HARD] Only ${ctx.minutesUntilClose}m until session close — insufficient time`);
  else if (ctx.minutesUntilClose < 30) riskFlags.push(`[SOFT] Only ${ctx.minutesUntilClose}m until session close — trade must reach target quickly`);
  if (ctx.sessionWindow === 'OPENING') riskFlags.push('[SOFT] Opening window — higher volatility, require stronger confirmation');

  // Route
  if (ctx.route && ctx.route.obstacleCount >= 3) riskFlags.push(`[HARD] ${ctx.route.obstacleCount} obstacles in path — crowded route`);
  else if (ctx.route && ctx.route.obstacleCount >= 2) riskFlags.push(`[SOFT] ${ctx.route.obstacleCount} obstacles in path — may stall before target`);

  // News
  if (ctx.newsScoreAdjustment < 0) riskFlags.push(`[SOFT] News proximity score penalty: ${ctx.newsScoreAdjustment}`);
  if (ctx.newsRiskFlags.length > 0) riskFlags.push(...ctx.newsRiskFlags.map(f => `[NEWS] ${f}`));

  // Cascading risk check
  const hardCount = riskFlags.filter(f => f.startsWith('[HARD]')).length;
  const softCount = riskFlags.filter(f => f.startsWith('[SOFT]')).length;
  if (hardCount >= 1) riskFlags.push(`⚠ ${hardCount} HARD risk flag(s) — lean REJECT`);
  else if (softCount >= 3) riskFlags.push(`⚠ ${softCount} soft risk flags — cascading risk, lean REJECT`);

  const flagsBlock = riskFlags.length > 0
    ? `\n── RISK FLAGS ──\n${riskFlags.map(f => `- ${f}`).join('\n')}\n`
    : '';

  return (
    `You are reviewing a proposed shadow trade (simulation only — no real money at risk).\n\n` +
    `${formatTradeSetup(ctx)}\n\n` +
    `── LEVEL & ROUTE CONTEXT ──\n` +
    `${formatLevelContext(ctx)}\n\n` +
    `── CONFIRMATION ──\n` +
    `${formatConfirmation(ctx)}\n\n` +
    `── SCORING ──\n` +
    `${formatScoreBreakdown(ctx)}\n` +
    `${formatSessionContext(ctx)}\n` +
    `${flagsBlock}` +
    `${formatNewsContext(ctx) ? '\n' + formatNewsContext(ctx) + '\n' : ''}` +
    `${formatRegimeContext(ctx) ? '\n' + formatRegimeContext(ctx) + '\n' : ''}\n` +
    `${formatReasons(ctx)}\n\n` +
    `YOUR TASK (Risk & Discipline Analyst):\n` +
    `Determine if this trade should be REJECTED on risk grounds.\n\n` +
    `Evaluate the RISK FLAGS above. Apply these rules:\n` +
    `- Any [HARD] flag → REJECT with high confidence, citing the specific flag.\n` +
    `- 3+ [SOFT] flags → cascading risk, lean REJECT unless the setup is elite-grade.\n` +
    `- 1-2 [SOFT] flags → WAIT if marginal, TAKE if setup quality compensates.\n` +
    `- No flags → TAKE.\n\n` +
    `Also verify:\n` +
    `- Is the stop behind real structure (the entry level's edge + padding), or is it arbitrary?\n` +
    `- Is the confirmation reaction genuine, or did it barely cross the threshold?\n` +
    `- In REDUCED or late session, is this a continuation of the existing trend, or a new directional bet?\n\n` +
    `Respond in this EXACT format — no other text:\n` +
    `VOTE: TAKE\n` +
    `CONFIDENCE: 75\n` +
    `REASON: One sentence citing the specific risk factor that most influenced your vote.\n\n` +
    `VOTE must be exactly TAKE, WAIT, or REJECT.\n` +
    `CONFIDENCE must be a number 0-100.`
  );
}
