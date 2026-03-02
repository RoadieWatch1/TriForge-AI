/**
 * scaler.ts — Auto-scaling decisions (Phase 7)
 *
 * Pure functions — no I/O, no side effects.
 */

import type { StrategyProfile } from './compoundTypes';
import type { GrowthLoop } from '../growth/growthTypes';

export const MAX_EMAIL_LIMIT  = 50;   // mirrors GrowthService.MAX_DAILY_EMAILS
export const MAX_POST_LIMIT   = 5;    // mirrors GrowthService.MAX_DAILY_POSTS
export const MAX_SCALE_FACTOR = 1.5;  // max 50% increase per cycle
export const MIN_SAMPLE_SIZE  = 5;    // minimum emails sent before scaling

export interface ScalingDecision {
  action: 'scale_up' | 'hold' | 'scale_down' | 'replace';
  emailLimitMultiplier: number;
  postLimitMultiplier: number;
  reason: string;
}

function hold(reason: string): ScalingDecision {
  return { action: 'hold', emailLimitMultiplier: 1, postLimitMultiplier: 1, reason };
}

/**
 * Decide how to scale a loop based on its best strategy.
 *
 * - Needs ≥ MIN_SAMPLE_SIZE emails before any action.
 * - 'active' strategy (score > 0.7) → scale_up 1.2–1.5×
 * - 'deprecated' strategy (score < 0.3) → scale_down to 0.6×
 * - 'testing' or no strategy → hold
 */
export function getScalingDecision(
  topStrategy: StrategyProfile | null,
  emailsSent: number,
): ScalingDecision {
  if (!topStrategy || emailsSent < MIN_SAMPLE_SIZE) {
    return hold(emailsSent < MIN_SAMPLE_SIZE ? `Need ${MIN_SAMPLE_SIZE} emails (have ${emailsSent})` : 'No strategy yet');
  }

  switch (topStrategy.status) {
    case 'active': {
      // Scale proportionally to score: score 0.7 → 1.2×, score 1.0 → 1.5×
      const mult = Math.min(MAX_SCALE_FACTOR, 1 + topStrategy.score * 0.5);
      const pct  = Math.round((mult - 1) * 100);
      return {
        action: 'scale_up',
        emailLimitMultiplier: mult,
        postLimitMultiplier:  mult,
        reason: `Reply rate ${Math.round((topStrategy.performance.replyRate ?? 0) * 100)}% → scaling up +${pct}%`,
      };
    }
    case 'deprecated': {
      return {
        action: 'scale_down',
        emailLimitMultiplier: 0.6,
        postLimitMultiplier:  0.6,
        reason: 'Low performance — reducing volume and triggering optimization',
      };
    }
    default:
      return hold('Collecting data — continue at baseline');
  }
}

/**
 * Apply a scaling decision to a loop, returning the patch to save.
 * Clamps to [1, MAX_*] and increments version when action is not 'hold'.
 */
export function applyScaling(loop: GrowthLoop, decision: ScalingDecision): Partial<GrowthLoop> {
  if (decision.action === 'hold') return { scalingAction: 'hold' };

  const currentEmail = loop.config.dailyEmailLimit ?? 10;
  const currentPost  = loop.config.dailyPostLimit  ?? 1;

  const newEmail = Math.max(1, Math.min(MAX_EMAIL_LIMIT, Math.round(currentEmail * decision.emailLimitMultiplier)));
  const newPost  = Math.max(1, Math.min(MAX_POST_LIMIT,  Math.round(currentPost  * decision.postLimitMultiplier)));

  return {
    config: {
      ...loop.config,
      dailyEmailLimit: newEmail,
      dailyPostLimit:  newPost,
    },
    version:       (loop.version ?? 1) + 1,
    scalingAction: decision.action,
  };
}
