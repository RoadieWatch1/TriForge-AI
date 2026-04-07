// ── operator/workflowPackTypes.ts ─────────────────────────────────────────────
//
// Section 9 — Workflow Packs: Type System
//
// Defines the contracts for all workflow pack definitions, readiness evaluation,
// and run-time state tracking.
//
// Design principles:
//   - Readiness is explicitly modeled — every pack knows what it needs
//   - Every blocker has a remediation hint
//   - Approval points are first-class, not optional
//   - Runs are serializable for audit and session visibility
//   - No invented capabilities — only what Section 8 truly built

import type { OperatorPlatform, OperatorActionType } from './operatorTypes';

// ── Workflow categories ───────────────────────────────────────────────────────

export type WorkflowCategory =
  | 'perception'    // read-only observation: screenshot, context capture
  | 'input'         // supervised keyboard/shortcut delivery
  | 'diagnostic'    // readiness and environment checks
  | 'handoff';      // prepare context and hand off to human or next step

// ── Requirements ─────────────────────────────────────────────────────────────

export interface WorkflowPermissions {
  /** macOS Accessibility (System Settings → Privacy & Security) */
  accessibility?: boolean;
  /** macOS Screen Recording (System Settings → Privacy & Security) */
  screenRecording?: boolean;
}

/**
 * What a workflow pack requires to run.
 * Evaluated at runtime via workflowReadiness.ts.
 */
export interface WorkflowRequirements {
  /** Which platforms support this pack. Empty = no platform support. */
  platforms: OperatorPlatform[];
  /** Which operator capabilities are needed (from Section 8) */
  capabilities: OperatorActionType[];
  /** OS-level permissions required */
  permissions: WorkflowPermissions;
  /**
   * Named app that must be running for this workflow to make sense.
   * null = any app / not app-specific.
   */
  targetApp: string | null;
  /** Whether an AI provider must be connected */
  providerRequired: boolean;
}

// ── Phases ────────────────────────────────────────────────────────────────────

export type PhaseActionKind =
  | 'list_apps'         // get running app list
  | 'get_frontmost'     // read current active app
  | 'focus_app'         // bring target to foreground
  | 'screenshot'        // capture screen to file
  | 'queue_input'       // queue type_text or send_key (triggers approval gate)
  | 'execute_approved'  // execute a previously approved input action
  | 'readiness_check'   // evaluate capability/permission/platform readiness
  | 'report';           // assemble and return the workflow artifact

export interface WorkflowPhase {
  id: string;
  name: string;
  description: string;
  /** The kind of action this phase performs */
  kind: PhaseActionKind;
  /**
   * If true, execution suspends here waiting for human approval.
   * The approval is surfaced via the operator approval queue.
   */
  requiresApproval: boolean;
  /** Plain-English description shown in the approval request */
  approvalDescription?: string;
  /**
   * What happens if this phase fails or is blocked.
   * stop           = abort the run immediately
   * warn_continue  = record a warning, keep going
   * ask_user       = surface a blocker and wait
   */
  onFailure: 'stop' | 'warn_continue' | 'ask_user';
  /** Whether this phase can be skipped if prerequisites are missing */
  optional?: boolean;
}

// ── Workflow Pack ─────────────────────────────────────────────────────────────

/**
 * A named, structured workflow that uses the Section 8 operator substrate.
 */
export interface WorkflowPack {
  /** Unique identifier, e.g. "pack.focus-capture" */
  id: string;
  name: string;
  description: string;
  /** One-line summary shown in the Operate UI */
  tagline: string;
  category: WorkflowCategory;
  version: string;
  requirements: WorkflowRequirements;
  phases: WorkflowPhase[];
  tags: string[];
  /** Estimated wall-clock duration in seconds (best-effort) */
  estimatedDurationSec?: number;
  /** Plain-English statement of what "success" means for this workflow */
  successCriteria: string;
}

// ── Readiness ─────────────────────────────────────────────────────────────────

export type WorkflowBlockerType =
  | 'platform_unsupported'
  | 'permission_missing'
  | 'capability_unavailable'
  | 'app_not_running'
  | 'provider_missing';

export interface WorkflowBlocker {
  type: WorkflowBlockerType;
  message: string;
  /** What the user should do to resolve this blocker */
  remediation: string;
}

/**
 * Result of evaluating whether a workflow pack can run right now.
 */
export interface WorkflowReadinessResult {
  packId: string;
  /** True only if there are zero blockers */
  ready: boolean;
  blockers: WorkflowBlocker[];
  /** Non-blocking notes (e.g. "optional screenshot step will be skipped") */
  warnings: string[];
  platformSupported: boolean;
  permissionsOk: boolean;
  capabilitiesOk: boolean;
  targetAppAvailable: boolean | null;  // null = not required
}

// ── Run state ─────────────────────────────────────────────────────────────────

export type WorkflowRunStatus =
  | 'running'
  | 'awaiting_approval'  // paused at an approval phase
  | 'completed'
  | 'failed'
  | 'stopped';

export interface WorkflowPhaseResult {
  phaseId: string;
  phaseName: string;
  status: 'completed' | 'skipped' | 'failed' | 'awaiting_approval';
  startedAt: number;
  completedAt?: number;
  /** Key outputs from this phase (e.g. screenshotPath, appName) */
  outputs: Record<string, unknown>;
  error?: string;
  warning?: string;
}

/**
 * A workflow artifact captures the key output of a completed workflow run.
 * It is stored on the run record and available for review in Sessions.
 */
export interface WorkflowArtifact {
  type: 'perception_snapshot' | 'context_report' | 'input_delivery' | 'readiness_report';
  capturedAt: number;
  data: Record<string, unknown>;
}

/**
 * Runtime state for a single workflow execution.
 */
export interface WorkflowRun {
  id: string;
  packId: string;
  packName: string;
  /** The operator session backing this run */
  sessionId: string;
  /** Target app passed by the caller (may be null for non-app-specific packs) */
  targetApp: string | null;
  startedAt: number;
  endedAt?: number;
  status: WorkflowRunStatus;
  currentPhaseIndex: number;
  phaseResults: WorkflowPhaseResult[];
  /**
   * If status is 'awaiting_approval', this is the operator approval ID
   * the run is blocked on.
   */
  pendingApprovalId?: string;
  artifact?: WorkflowArtifact;
  error?: string;
}

// ── Execution options ─────────────────────────────────────────────────────────

export interface WorkflowRunOptions {
  /** Target app name for app-specific workflows */
  targetApp?: string;
  /** For supervised-input: the text to type */
  inputText?: string;
  /** For supervised-input: a keyboard shortcut key name */
  inputKey?: string;
  /** For supervised-input: modifier keys */
  inputModifiers?: Array<'cmd' | 'shift' | 'alt' | 'ctrl'>;
  /** Custom output path for screenshots */
  screenshotOutputPath?: string;
}
