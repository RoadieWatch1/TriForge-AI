// ── MissionTypes.ts — Shared types for the autonomy mission queue ─────────────
//
// Distinct from MissionManager's MissionDefinition (which is for scheduled,
// persistent AI tasks). These types represent one-shot user-intent missions
// that flow from voice/UI → MissionQueue → PolicyGate → PlanExecutor.

export type MissionPriority = 'low' | 'normal' | 'high' | 'urgent';

export type MissionSource = 'voice' | 'ui' | 'scheduler' | 'workspace';

export type MissionStatus =
  | 'queued'
  | 'planning'
  | 'awaiting_approval'
  | 'approved'
  | 'executing'
  | 'complete'
  | 'failed'
  | 'cancelled';

export interface QueuedMission {
  id:               string;
  createdAt:        number;
  source:           MissionSource;
  /** Human-readable intent label (e.g. "dev.fix_build"). */
  intent:           string;
  /** Raw user utterance or UI trigger text. */
  raw:              string;
  priority:         MissionPriority;
  requiresApproval: boolean;
  status:           MissionStatus;
  /** Optional structured payload from intent router. */
  payload?:         Record<string, unknown>;
}

/** Priority weight for queue ordering (higher = runs first). */
export const PRIORITY_WEIGHT: Record<MissionPriority, number> = {
  urgent: 4,
  high:   3,
  normal: 2,
  low:    1,
};
