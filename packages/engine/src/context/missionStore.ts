// ── missionStore.ts ───────────────────────────────────────────────────────────
//
// MissionContext — the user's active council project.
//
// This is DISTINCT from packages/desktop/src/core/missions/missionStore.ts,
// which handles scheduled autonomous agent tasks. MissionContext tracks the
// high-level goal, objectives, and decisions for the user's current project so
// the council can reason within that context across multiple conversations.

export interface MissionContext {
  /** High-level mission statement, e.g. "Build and launch a SaaS product". */
  mission: string;
  /** Concrete objectives the user wants to achieve. */
  objectives: string[];
  /** Decisions that have already been made (council adds these over time). */
  decisions: string[];
  /** Open questions that still need answers. */
  openQuestions: string[];
  /** Optional project name / tag for grouping memory graph nodes. */
  project?: string;
  /** Unix timestamp (ms) of last update. */
  updatedAt: number;
}
