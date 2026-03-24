/**
 * runbooks.ts — Phase 34
 *
 * Workspace Runbooks + Incident Mode type definitions.
 *
 * Phase 33 adds:
 *   - Conditional branching via onSuccess/onFailure/onRejection/onTimeout routing fields
 *   - New step types: condition, deadline_wait, escalate, goto_step, retry_step
 *   - Deadline / SLA timers on paused steps (timeoutSecs, escalateAfterSecs)
 *   - BranchDecision tracking on RunbookExecution
 *   - Overdue / escalation state on HandoffQueueItem
 */

import * as crypto from 'crypto';

// ── Step types ────────────────────────────────────────────────────────────────

export type RunbookStepType =
  | 'run_recipe'      // execute a builtin recipe
  | 'run_mission'     // fire a persistent mission
  | 'send_slack'      // post a Slack message to a channel
  | 'create_jira'     // create a Jira issue
  | 'create_linear'   // create a Linear issue
  | 'notify_push'     // fire a push notification
  | 'wait_approval'   // human approval checkpoint — pauses execution
  | 'wait_confirm'    // desktop confirmation checkpoint — pauses execution
  | 'create_task'     // create a Dispatch task via the AI engine
  // Phase 33 — conditional branching + control flow
  | 'condition'       // evaluate a condition expression and branch
  | 'deadline_wait'   // wait checkpoint with explicit SLA timer
  | 'escalate'        // fire escalation signals (Slack + push) and continue
  | 'goto_step'       // unconditional jump to a named step
  | 'retry_step';     // retry a previously completed/failed step

export interface RunbookStep {
  id:       string;
  type:     RunbookStepType;
  label:    string;
  params:   Record<string, string>;   // may contain {{varName}} placeholders
  optional: boolean;  // if true, step failure does not abort the runbook

  // Phase 33 — branch routing (all are step IDs, not indices)
  onSuccess?:         string;
  onFailure?:         string;
  onRejection?:       string;
  onTimeout?:         string;
  timeoutSecs?:       number;
  escalateAfterSecs?: number;

  // Phase 34 — output capture
  outputKey?:         string;   // if set, write step's primary result to exec.vars[outputKey]
}

// ── Variable model (Phase 34) ─────────────────────────────────────────────────

/** A declared variable on a runbook definition. */
export interface RunbookVar {
  name:          string;         // variable name used in {{name}} placeholders
  description?:  string;
  defaultValue?: string;         // used when no launch-time value provided
  required:      boolean;        // if true, runbook cannot run without a value
  source?:       'input'         // must be provided at launch time
               | 'context'       // prefilled from workspace shared context if available
               | 'fixed';        // always uses defaultValue (not prompted)
}

// ── Trigger types ─────────────────────────────────────────────────────────────

export type RunbookTrigger =
  | 'manual'          // launched by desktop or Dispatch operator
  | 'incident'        // triggered when incident mode is activated
  | 'health_alert';   // triggered by an unhealthy service detection

// ── Runbook definition ────────────────────────────────────────────────────────

export interface RunbookDef {
  id:                    string;
  title:                 string;
  description:           string;
  scope:                 'workspace';
  ownerDeviceId?:        string;
  trigger:               RunbookTrigger;
  steps:                 RunbookStep[];
  allowedRunnerRoles:    string[];           // WorkspaceRole values
  allowedRunnerDeviceIds:string[];
  escalationChannel?:    string;             // Slack channel for escalation/alerts
  linkedIntegrations:    string[];           // 'slack'|'jira'|'linear'|'github'|'push'
  incidentMode:          boolean;            // treat this as an incident runbook
  enabled:               boolean;
  createdAt:             number;
  updatedAt:             number;
  // Phase 34 — declared variables (template parameters)
  variables?:            RunbookVar[];
  // Phase 35 — versioning + pack provenance
  version?:              string;    // semver string, e.g. '1.0.0'
  packId?:               string;    // originating pack id (pack_*)
  packVersion?:          string;    // pack version at install/update time
  changelog?:            string;    // brief human-readable notes for this version
}

// ── Execution tracking ────────────────────────────────────────────────────────

export type RunbookStepStatus =
  | 'pending'
  | 'running'
  | 'completed'
  | 'failed'
  | 'skipped'
  | 'attention'   // human-gated checkpoint — paused or completed with human action
  | 'branched';   // step was bypassed by a branch decision

// Phase 33 — per-step branch decision record
export interface BranchDecision {
  fromStepId:   string;
  toStepId:     string;
  branchType:   'success' | 'failure' | 'rejection' | 'timeout' | 'condition_true' | 'condition_false' | 'goto';
  reason:       string;
  decidedAt:    number;
}

export interface RunbookStepExecution {
  stepId:       string;
  type:         RunbookStepType;
  label:        string;
  status:       RunbookStepStatus;
  startedAt?:   number;
  completedAt?: number;
  result?:      string;
  error?:       string;
  branchedTo?:  string;   // step ID this step branched to (if status === 'branched')
}

export type RunbookExecutionStatus =
  | 'running'
  | 'paused_approval'  // blocked at wait_approval — awaiting remote approval
  | 'paused_confirm'   // blocked at wait_confirm  — awaiting desktop confirmation
  | 'paused_manual'    // blocked at deadline_wait/manual — awaiting operator intervention
  | 'completed'
  | 'failed'
  | 'cancelled';

export interface RunbookExecution {
  id:               string;
  runbookId:        string;
  runbookTitle:     string;
  status:           RunbookExecutionStatus;
  startedAt:        number;
  completedAt?:     number;
  actorId?:         string;
  actorLabel?:      string;
  isIncident:       boolean;
  currentStepIdx:   number;
  currentStepId?:   string;
  steps:            RunbookStepExecution[];
  error?:           string;
  // Pause state
  pausedAtStepIdx?: number;
  pausedReason?:    string;
  pauseTokenId?:    string;
  pausedAt?:        number;
  // Branch state
  branchDecisions?: BranchDecision[];
  escalationCount?: number;
  deadlineAt?:      number;
  escalatedAt?:     number;
  // Phase 34 — Variables
  vars?:            Record<string, string>;   // runtime variable values (resolved at launch)
  stepOutputs?:     Record<string, string>;   // stepId → captured output value
  // Phase 35 — Pack provenance recorded at run time
  packId?:          string;
  packVersion?:     string;
}

// ── Human Handoff Queue ───────────────────────────────────────────────────────

export type HandoffType = 'approval' | 'confirm' | 'manual' | 'escalation';
export type HandoffStatus = 'pending' | 'resolved' | 'expired' | 'aborted';

export interface HandoffQueueItem {
  id:              string;
  executionId:     string;
  runbookId:       string;
  runbookTitle:    string;
  stepId:          string;
  stepLabel:       string;
  type:            HandoffType;
  status:          HandoffStatus;
  blockedReason:   string;
  actorNeeded?:    string;          // who should act (role or device label)
  isIncident:      boolean;
  createdAt:       number;
  expiresAt?:      number;          // hard deadline (step fails/branches on expiry)
  escalateAt?:     number;          // when to fire soft escalation (before expiresAt)
  escalatedAt?:    number;          // when soft escalation was fired
  escalationCount?:number;
  resolvedAt?:     number;
  resolvedBy?:     string;
  resolution?:     string;          // 'approved' | 'confirmed' | 'rejected' | 'manual' | 'timeout'
  // Phase 33 branch routing (copied from step for scheduler use)
  onRejection?:    string;          // step ID to branch to on rejection
  onTimeout?:      string;          // step ID to branch to on timeout
}

export interface RunbookPauseToken {
  id:          string;
  executionId: string;
  stepIdx:     number;
  type:        HandoffType;
  createdAt:   number;
}

// ── Condition expression types ────────────────────────────────────────────────

/**
 * Condition strings understood by the executor.
 * Evaluated against live execution state + workspace state.
 *
 * Phase 34 adds parameterised forms (parsed at runtime, not TypeScript literal types):
 *   var_set:<name>             — exec.vars[name] is non-empty
 *   var_equals:<name>:<value>  — exec.vars[name] === value
 *   var_contains:<name>:<sub>  — exec.vars[name] includes sub (case-insensitive)
 *   step_output_set:<stepId>   — exec.stepOutputs[stepId] is non-empty
 */
export type ConditionExpr =
  | 'incident_mode'        // workspace incident mode is active
  | 'prev_step_failed'     // the immediately preceding step failed
  | 'prev_step_completed'  // the immediately preceding step completed
  | 'prev_step_attention'  // the immediately preceding step is 'attention'
  | 'any_step_failed'      // any previous step has failed
  | 'always_true'          // unconditional → always takes on_true branch
  | 'always_false'         // unconditional → always takes on_false branch
  | string;                // Phase 34: parameterised forms (var_set:, var_equals:, etc.)

// ── Helpers ───────────────────────────────────────────────────────────────────

export function makeHandoffId(): string {
  return 'hf_' + crypto.randomBytes(8).toString('hex');
}

export function makePauseTokenId(): string {
  return 'pt_' + crypto.randomBytes(6).toString('hex');
}

export function makeRunbookId(): string {
  return 'rb_' + crypto.randomBytes(8).toString('hex');
}

export function makeStepId(): string {
  return 'step_' + crypto.randomBytes(4).toString('hex');
}

export function makeExecutionId(): string {
  return 'exec_' + crypto.randomBytes(8).toString('hex');
}

/** Build a default step from a type and label. */
export function makeStep(type: RunbookStepType, label: string, params: Record<string, string> = {}): RunbookStep {
  return { id: makeStepId(), type, label, params, optional: false };
}

/** Incident mode state stored separately from workspace (no circular coupling). */
export interface IncidentModeState {
  active:       boolean;
  activatedAt?: number;
  activatedBy?: string;
  reason?:      string;
}
