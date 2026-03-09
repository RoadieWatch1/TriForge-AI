// ── Vibe Coding — public API ─────────────────────────────────────────────────

// Types
export type {
  VibeMode, VibeDimension, VibeSignal, VibeProfile, VibeAnchor,
  VibeSystemDecision, VibeBuildPlan, VibeComponentTarget, VibeStyleChange, VibeCopyChange,
  VibeConsistencyResult, VibeConsistencyViolation,
  VibeOutcomeScore, OutcomeDimension, VibeDecisionRecord,
  VibePatchPlan, VibePatchIssue, VibePatchFix,
  VibeCouncilRole, VibeCouncilPosition, VibeProgressPhase,
  VibeConfig,
} from './vibeTypes';
export { DEFAULT_VIBE_CONFIG, DEFAULT_VIBE_AXES, VIBE_DIMENSIONS } from './vibeTypes';

// Parser
export { parseVibeIntent, detectVibeMode, isVibeRequest } from './vibeIntentParser';

// Profile store
export { VibeProfileStore } from './vibeProfileStore';

// Translator
export { translateVibeToDecisions, translateWithContext, applyGuardrails } from './vibeToSystemTranslator';

// Build planner
export { VibeBuildPlanner } from './vibeBuildPlanner';

// Consistency checker
export { VibeConsistencyChecker } from './vibeConsistencyChecker';

// Outcome scorer
export { VibeOutcomeScorer } from './vibeOutcomeScorer';

// Council flow
export { runVibeCouncil } from './vibeCouncilFlow';
export type { VibeCouncilProvider, OnVibeProgress, VibeCouncilResult } from './vibeCouncilFlow';

// Patch planner
export { VibePatchPlanner } from './vibePatchPlanner';
