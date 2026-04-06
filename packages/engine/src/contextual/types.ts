// ── contextual/types.ts — Section 5: Contextual Intelligence Contracts ────────
//
// Shared type definitions for the TriForge contextual intelligence layer.
// This file is schema-only. No execution logic, no side effects, no imports.
//
// These contracts support future phases responsible for:
//   - intent classification
//   - machine context normalization
//   - context fusion
//   - blocker detection
//   - plan generation
//   - explanation generation

// ── A. WorkIntentCategory ─────────────────────────────────────────────────────

/**
 * The interpreted category of what the user is trying to accomplish.
 * Used across all reasoning phases to route and contextualize understanding.
 */
export type WorkIntentCategory =
  | 'app_submission'
  | 'creative_editing'
  | 'coding_build_debug'
  | 'file_project_organization'
  | 'browser_admin_workflow'
  | 'desktop_assistance'
  | 'research_planning'
  | 'unknown';

// ── B. EnvironmentReadiness ───────────────────────────────────────────────────

/**
 * Summary readiness signal for the current environment relative to the user's goal.
 */
export type EnvironmentReadiness =
  | 'ready'
  | 'partially_ready'
  | 'blocked'
  | 'unknown';

// ── C. ContextEvidenceLevel ───────────────────────────────────────────────────

/**
 * Confidence level for a given piece of context evidence.
 *
 * - direct:   TriForge has confirmed this from the machine or session.
 * - inferred: TriForge is making a reasonable inference from available signals.
 * - missing:  This signal was expected but no evidence was found.
 * - unknown:  The evidence state has not been evaluated.
 */
export type ContextEvidenceLevel =
  | 'direct'
  | 'inferred'
  | 'missing'
  | 'unknown';

// ── D. MachineContextSignal ───────────────────────────────────────────────────

/**
 * A single machine or environment signal relevant to the user's request.
 * Represents one piece of gathered context, tagged with how certain we are.
 */
export interface MachineContextSignal {
  /** Stable machine-readable identifier for this signal (e.g. "xcode.installed") */
  key: string;
  /** Human-readable label shown in explanations */
  label: string;
  /** Current observed or inferred value */
  value: string;
  /** How this value was obtained or how confident we are */
  level: ContextEvidenceLevel;
  /** Whether this signal is material to the current user goal */
  relevant: boolean;
  /** Where this signal came from (e.g. "system_state", "file_scan", "user_message") */
  source?: string;
  /** Additional context or notes about this signal */
  details?: string;
}

// ── E. ReasoningBlocker ───────────────────────────────────────────────────────

/**
 * A single identified obstacle that may prevent or complicate task completion.
 */
export interface ReasoningBlocker {
  /** Unique identifier for this blocker within a result */
  id: string;
  /** Categorical type of the blocker */
  type:
    | 'missing_permission'
    | 'missing_app'
    | 'missing_project'
    | 'missing_provider'
    | 'ambiguous_target'
    | 'no_active_environment'
    | 'readiness_gap'
    | 'tier_limitation'
    | 'approval_dependency'
    | 'unknown';
  /** Short title for display */
  title: string;
  /** Full description of the blocker */
  description: string;
  /** How significantly this blocker affects task completion */
  severity: 'low' | 'medium' | 'high';
  /** Whether this blocker must be resolved before the task can proceed */
  blocking: boolean;
  /** A suggested action the user or system could take to resolve this */
  suggestedResolution?: string;
  /** Signal keys or requirement IDs related to this blocker */
  relatedKeys?: string[];
}

// ── F. ApprovalPoint ──────────────────────────────────────────────────────────

/**
 * A point in the reasoning plan where explicit user approval would be required
 * before proceeding. Used to surface transparency and gate sensitive steps.
 */
export interface ApprovalPoint {
  /** Unique identifier for this approval point */
  id: string;
  /** Short title for display */
  title: string;
  /** Explanation of what would be approved and why approval is needed */
  description: string;
  /** The phase or gate category this approval falls within */
  stage:
    | 'access'
    | 'destructive_change'
    | 'export'
    | 'submission'
    | 'external_action'
    | 'unknown';
  /** Whether approval is mandatory for the task to proceed */
  required: boolean;
  /** The tool or integration that would perform the gated action */
  relatedTool?: string;
}

// ── G. ContextFusionResult ────────────────────────────────────────────────────

/**
 * The merged understanding of a user's request combined with observed environment state.
 * Produced by the context fusion phase and used as the input to plan generation.
 */
export interface ContextFusionResult {
  /** The original user message or request as provided */
  rawUserRequest: string;
  /** TriForge's interpreted summary of what the user wants to accomplish */
  interpretedGoal: string;
  /** The classified category of the interpreted task */
  interpretedTaskType: WorkIntentCategory;
  /** Overall readiness of the current environment to support this task */
  readiness: EnvironmentReadiness;
  /** Confidence score from 0.0 to 1.0 in the interpretation and readiness assessment */
  confidence: number;
  /** Machine and environment signals gathered and evaluated for this request */
  relevantMachineContext: MachineContextSignal[];
  /** Tool or integration names that would be needed to fulfill this task */
  requiredTools: string[];
  /** Things that are needed but not currently available or configured */
  missingRequirements: string[];
  /** Blockers identified that may prevent or complicate task completion */
  blockers: ReasoningBlocker[];
  /** Points where user approval would be required before proceeding */
  approvalPoints: ApprovalPoint[];
  /** Assumptions TriForge made when evidence was incomplete */
  assumptions?: string[];
  /** Internal notes from the fusion process */
  notes?: string[];
}

// ── H. ReasoningPlanStep ──────────────────────────────────────────────────────

/**
 * A single step in a reasoning-layer plan.
 * These are advisory steps describing what would be done — not runtime instructions.
 */
export interface ReasoningPlanStep {
  /** Unique identifier for this step within the plan */
  id: string;
  /** Short title describing the step */
  title: string;
  /** Full description of what this step represents */
  description: string;
  /** Position in the ordered sequence (1-based) */
  order: number;
  /** IDs of steps that must be understood or completed before this step */
  dependsOnStepIds?: string[];
  /** Whether this step would require user approval before it could be acted upon */
  requiresApproval?: boolean;
}

// ── I. ReasoningPlan ──────────────────────────────────────────────────────────

/**
 * A structured reasoning artifact representing how TriForge would approach a task.
 * This is a plan for understanding — not a schedule for execution.
 */
export interface ReasoningPlan {
  /** What the user is trying to accomplish */
  goal: string;
  /** The classified task category */
  interpretedTaskType: WorkIntentCategory;
  /** A concise narrative summary of what TriForge believes the user wants */
  userIntentSummary: string;
  /** Overall readiness of the environment to support this plan */
  readiness: EnvironmentReadiness;
  /** Confidence score from 0.0 to 1.0 in this plan */
  confidence: number;
  /** Machine context signals that informed this plan */
  relevantMachineContext: MachineContextSignal[];
  /** Tools that would be involved in carrying out this plan */
  requiredTools: string[];
  /** Ordered reasoning steps describing the approach */
  orderedSteps: ReasoningPlanStep[];
  /** Points where user approval would be required */
  approvalPoints: ApprovalPoint[];
  /** Blockers that would need resolution for this plan to succeed */
  blockers: ReasoningBlocker[];
  /** Requirements that are absent and would need to be fulfilled */
  missingRequirements?: string[];
  /** Assumptions made when building this plan */
  assumptions?: string[];
}

// ── J. ReasoningExplanation ───────────────────────────────────────────────────

/**
 * A plain-language explanation of TriForge's understanding and approach.
 * Intended to be surfaced directly to the user for transparency.
 */
export interface ReasoningExplanation {
  /** A concise statement of what TriForge believes the user is trying to do */
  whatIThinkYouWant: string;
  /** A list of things TriForge found or confirmed from the machine and context */
  whatIFound: string[];
  /** A list of the steps TriForge would take to help accomplish the goal */
  whatIWouldDo: string[];
  /** Things TriForge still needs before it can proceed or is confident */
  whatIStillNeed: string[];
  /** Points where the user's explicit approval would be required */
  whereApprovalIsNeeded: string[];
  /** An honest note if TriForge has low confidence or significant uncertainty */
  honestyNote?: string;
}

// ── K. ContextualIntelligenceResult ──────────────────────────────────────────

/**
 * Top-level result returned by the contextual intelligence orchestrator.
 * Contains the full fusion, reasoning plan, and explanation for a single request.
 */
export interface ContextualIntelligenceResult {
  /** The fused understanding of user intent and machine state */
  fusion: ContextFusionResult;
  /** The structured reasoning plan for how the task would be approached */
  plan: ReasoningPlan;
  /** The plain-language explanation to surface to the user */
  explanation: ReasoningExplanation;
  /** Schema version for forward-compatibility tracking */
  version?: string;
}
