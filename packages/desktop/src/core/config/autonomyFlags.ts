// ── autonomyFlags.ts — Feature flags for the autonomous AI council system ──────
//
// All flags default OFF for safe shipping. Enable per-feature as the system matures.
// To enable a flag in development: edit this file directly (or add config override).

export const AUTONOMY_FLAGS = {
  /** native vosk unavailable on Node.js v25 (ffi-napi build fails) — use vosk-browser */
  enableOfflineWake:        false,
  /** Enable CommandDispatcher + matchCommand routing */
  enableCommandSystem:      true,
  /** Enable MissionController + ThinkTankPlanner pipeline */
  enableMissionController:  true,
  /** Enable WorkspaceObserver / AutonomyController file-change scanning */
  enableAutonomyLoop:       false,
  /** Allow AutonomyController to emit proposals (requires enableAutonomyLoop) */
  enableAutoProposals:      true,
  /** Gate every mission step behind ApprovalStore — never skip */
  requireApprovalForApply:  true,
  /** Gate git commit proposal behind a second explicit ApprovalStore request */
  requireApprovalForCommit: true,
  /** Max simultaneous missions (prevents runaway parallelism) */
  maxConcurrentMissions:    1,
} as const;

export type AutonomyFlags = typeof AUTONOMY_FLAGS;
