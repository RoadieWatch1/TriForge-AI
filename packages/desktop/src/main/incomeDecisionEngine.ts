// ── incomeDecisionEngine.ts ─────────────────────────────────────────────────
//
// Pure decision layer for the Income Operator.
// No side effects — reads state, returns recommendations.
// Designed to be testable independent of IPC or UI.
//
// Design rules:
//   - One primary recommendation per experiment (no conflicting kill + scale)
//   - Critical > high > normal priority ordering
//   - Idempotency: skips actions that already have a pending approval
//   - Blockers are surfaced explicitly (missing tool, wrong state, etc.)

import type { IncomeExperiment, BudgetState } from './store';

// ── Types ────────────────────────────────────────────────────────────────────

export type IncomeActionType =
  | 'launch_experiment'
  | 'kill_experiment'
  | 'scale_experiment'
  | 'spend_budget'
  | 'publish_content'
  | 'connect_platform'
  | 'install_tool';

export interface IncomeRecommendation {
  experimentId:     string;
  experimentName:   string;
  recommendedAction: IncomeActionType;
  reason:           string;
  riskLevel:        'low' | 'medium' | 'high';
  approvalRequired: boolean;
  blockedBy:        string[];
  priority:         'critical' | 'high' | 'normal';
}

export interface DecisionInput {
  experiments:            IncomeExperiment[];
  /** Map of experimentId → AutoKillEval result */
  evaluations:            Record<string, { shouldKill: boolean; shouldScale: boolean; reason: string; roi: number }>;
  budget:                 BudgetState | null;
  /**
   * Set of "<experimentId>:<action>" strings representing approvals that are
   * already pending — used for idempotency to prevent duplicate approval creation.
   */
  pendingApprovalKeys:    Set<string>;
  /** IDs of installed ForgeHub skills (optional — used to detect missing tools) */
  installedSkillIds?:     string[];
}

// ── Lane platform map ─────────────────────────────────────────────────────────

/**
 * Expected platforms for each income lane.
 * Used to compute "connected vs missing" platform readiness in Phase 4E.
 * Keys match experiment.platformLinks keys; values are human-readable display names.
 */
export const LANE_PLATFORMS: Record<string, Array<{ id: string; name: string }>> = {
  digital_products:  [
    { id: 'gumroad',   name: 'Gumroad'   },
    { id: 'etsy',      name: 'Etsy'      },
    { id: 'stripe',    name: 'Stripe'    },
    { id: 'payhip',    name: 'Payhip'    },
  ],
  client_services:   [
    { id: 'upwork',    name: 'Upwork'    },
    { id: 'contra',    name: 'Contra'    },
    { id: 'calendly',  name: 'Calendly'  },
  ],
  affiliate_content: [
    { id: 'amazon_associates', name: 'Amazon Associates' },
    { id: 'impact',    name: 'Impact'    },
    { id: 'shareasale', name: 'ShareASale' },
  ],
  faceless_youtube:  [
    { id: 'youtube',   name: 'YouTube'   },
    { id: 'vidiq',     name: 'VidIQ'     },
  ],
  short_form_brand:  [
    { id: 'tiktok',    name: 'TikTok'    },
    { id: 'instagram', name: 'Instagram' },
    { id: 'youtube_shorts', name: 'YouTube Shorts' },
  ],
  ai_music:          [
    { id: 'suno',      name: 'Suno'      },
    { id: 'distrokid', name: 'DistroKid' },
    { id: 'spotify_for_artists', name: 'Spotify for Artists' },
  ],
  mini_games:        [
    { id: 'itch_io',   name: 'Itch.io'   },
    { id: 'game_jolt', name: 'Game Jolt' },
  ],
  asset_packs:       [
    { id: 'gumroad',        name: 'Gumroad'        },
    { id: 'creative_market', name: 'Creative Market' },
    { id: 'design_bundles',  name: 'Design Bundles'  },
  ],
};

// ── Priority ordering ─────────────────────────────────────────────────────────

const PRIORITY_ORDER: Record<IncomeRecommendation['priority'], number> = {
  critical: 0,
  high:     1,
  normal:   2,
};

// ── Valid transitions (mirrors ExperimentManager state machine) ───────────────

type ExpStatus = 'proposed' | 'approved' | 'building' | 'launched' | 'measuring' | 'scaling' | 'killed' | 'completed';

function isTerminal(status: string): boolean {
  return status === 'killed' || status === 'completed';
}

// ── Decision engine ───────────────────────────────────────────────────────────

/**
 * Generates a sorted list of action recommendations from live experiment state.
 * Returns at most one primary recommendation per experiment.
 * Applies idempotency via `pendingApprovalKeys` so the UI never shows a
 * recommendation for an action that already has a pending approval.
 */
export function generateRecommendations(input: DecisionInput): IncomeRecommendation[] {
  const { experiments, evaluations, budget, pendingApprovalKeys } = input;
  const recs: IncomeRecommendation[] = [];

  for (const exp of experiments) {
    // Skip terminal experiments — nothing to recommend
    if (isTerminal(exp.status)) continue;

    const ev = evaluations[exp.id];
    let rec: IncomeRecommendation | null = null;

    // ── CRITICAL: kill signal ───────────────────────────────────────────────
    // Kill takes absolute priority over all other signals for this experiment.
    if (ev?.shouldKill) {
      const key = `${exp.id}:kill_experiment`;
      if (!pendingApprovalKeys.has(key)) {
        rec = {
          experimentId:      exp.id,
          experimentName:    exp.name,
          recommendedAction: 'kill_experiment',
          reason:            ev.reason,
          riskLevel:         'high',
          approvalRequired:  true,
          blockedBy:         [],
          priority:          'critical',
        };
      }
    }

    // ── HIGH: scale signal ──────────────────────────────────────────────────
    // Only fires when kill is NOT signalled.
    else if (ev?.shouldScale) {
      const key = `${exp.id}:scale_experiment`;
      if (!pendingApprovalKeys.has(key)) {
        rec = {
          experimentId:      exp.id,
          experimentName:    exp.name,
          recommendedAction: 'scale_experiment',
          reason:            ev.reason,
          riskLevel:         'medium',
          approvalRequired:  true,
          blockedBy:         [],
          priority:          'high',
        };
      }
    }

    // ── HIGH: ready to launch (building → launched) ─────────────────────────
    else if (exp.status === 'building') {
      const key = `${exp.id}:launch_experiment`;
      const blockers: string[] = [];
      if (!budget) blockers.push('No budget configured');
      if (!pendingApprovalKeys.has(key)) {
        rec = {
          experimentId:      exp.id,
          experimentName:    exp.name,
          recommendedAction: 'launch_experiment',
          reason:            `"${exp.name}" is built and ready to go live. Launch requires approval.`,
          riskLevel:         'medium',
          approvalRequired:  true,
          blockedBy:         blockers,
          priority:          'high',
        };
      }
    }

    // ── HIGH: has spend, no revenue → publish content ───────────────────────
    else if (
      (exp.status === 'measuring' || exp.status === 'scaling') &&
      exp.revenueEarned === 0 &&
      exp.budgetSpent > 0
    ) {
      const key = `${exp.id}:publish_content`;
      if (!pendingApprovalKeys.has(key)) {
        rec = {
          experimentId:      exp.id,
          experimentName:    exp.name,
          recommendedAction: 'publish_content',
          reason:            `"${exp.name}" has $${exp.budgetSpent.toFixed(2)} spent but $0 revenue. Publish your next content piece to start converting.`,
          riskLevel:         'low',
          approvalRequired:  false,
          blockedBy:         [],
          priority:          'high',
        };
      }
    }

    // ── NORMAL: state advancement (safe, no approval) ───────────────────────
    else if (exp.status === 'proposed') {
      rec = {
        experimentId:      exp.id,
        experimentName:    exp.name,
        recommendedAction: 'launch_experiment',
        reason:            `"${exp.name}" is waiting for approval to start.`,
        riskLevel:         'low',
        approvalRequired:  false,
        blockedBy:         [],
        priority:          'normal',
      };
    }

    else if (exp.status === 'approved') {
      rec = {
        experimentId:      exp.id,
        experimentName:    exp.name,
        recommendedAction: 'launch_experiment',
        reason:            `"${exp.name}" is approved — mark as building when you start work.`,
        riskLevel:         'low',
        approvalRequired:  false,
        blockedBy:         [],
        priority:          'normal',
      };
    }

    else if (exp.status === 'launched') {
      rec = {
        experimentId:      exp.id,
        experimentName:    exp.name,
        recommendedAction: 'launch_experiment',
        reason:            `"${exp.name}" is live — move to measuring once you have initial data.`,
        riskLevel:         'low',
        approvalRequired:  false,
        blockedBy:         [],
        priority:          'normal',
      };
    }

    if (rec) recs.push(rec);
  }

  // Sort: critical → high → normal, then by experimentId for stable ordering
  recs.sort((a, b) => {
    const pd = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
    return pd !== 0 ? pd : a.experimentId.localeCompare(b.experimentId);
  });

  return recs;
}
