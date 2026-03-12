/**
 * Council Workflow Types — governed plan → code → commit pipeline.
 *
 * Defines the full lifecycle: intake → plan debate → plan lock →
 * code generation → code review → verification → commit → push,
 * with fixed council identities (Claude=architect, OpenAI=precision, Grok=adversarial).
 */

import type { ProviderName } from '../protocol';

// ── Workflow Phases ──────────────────────────────────────────────────────────

export type CouncilWorkflowPhase =
  | 'intake'
  | 'plan_draft'
  | 'plan_review'
  | 'plan_approved'
  | 'code_draft'
  | 'code_review'
  | 'verifying'
  | 'verify_failed'
  | 'ready_to_commit'
  | 'committed'
  | 'ready_to_push'
  | 'pushed'
  | 'blocked';

// ── Execution Modes ──────────────────────────────────────────────────────────

/** quick=1 round, lint-only. safe=3 rounds, full checks. trusted=safe + auto-commit. */
export type ExecutionMode = 'quick' | 'safe' | 'trusted';

/** What the workflow should do. */
export type CouncilWorkflowAction = 'plan_only' | 'plan_then_code' | 'review_existing' | 'prepare_commit';

// ── Council Roles ────────────────────────────────────────────────────────────

export type CouncilRoleType = 'architect' | 'precision' | 'adversarial';

export interface CouncilRole {
  provider: ProviderName;
  role: CouncilRoleType;
}

// ── Mode Configuration ───────────────────────────────────────────────────────

export interface WorkflowModeConfig {
  maxPlanRounds: number;
  maxCodeRounds: number;
  verificationChecks: VerificationCheckType[];
  autoCommit: boolean;
  autoPush: boolean;
}

export const MODE_CONFIGS: Record<ExecutionMode, WorkflowModeConfig> = {
  quick: {
    maxPlanRounds: 1,
    maxCodeRounds: 1,
    verificationChecks: ['lint'],
    autoCommit: false,
    autoPush: false,
  },
  safe: {
    maxPlanRounds: 3,
    maxCodeRounds: 3,
    verificationChecks: ['lint', 'typecheck', 'test', 'build'],
    autoCommit: false,
    autoPush: false,
  },
  trusted: {
    maxPlanRounds: 3,
    maxCodeRounds: 3,
    verificationChecks: ['lint', 'typecheck', 'test', 'build'],
    autoCommit: true,
    autoPush: false,
  },
};

// ── Council Plan ─────────────────────────────────────────────────────────────

export interface CouncilPlan {
  goal: string;
  summary: string;
  filesToRead: string[];
  filesToModify: string[];
  nonGoals: string[];
  risks: string[];
  acceptanceCriteria: string[];
  checksToRun: VerificationCheckType[];
  rollbackPlan: string;
  commitScope: string;
  pushAllowed: boolean;
  planHash: string;
}

// ── Plan Amendments ──────────────────────────────────────────────────────────

export interface PlanAmendment {
  round: number;
  proposedBy: ProviderName;
  description: string;
  accepted: boolean;
  reason: string;
}

// ── Plan Review ──────────────────────────────────────────────────────────────

export interface PlanObjection {
  provider: ProviderName;
  severity: 'blocker' | 'major' | 'minor';
  description: string;
  resolution?: string;
}

export interface PlanReview {
  provider: ProviderName;
  role: CouncilRoleType;
  approved: boolean;
  objections: PlanObjection[];
  suggestedAmendments: PlanAmendment[];
  confidence: number; // 0..1
}

// ── Approved Plan Snapshot ───────────────────────────────────────────────────

export interface ApprovedPlanSnapshot {
  plan: CouncilPlan;
  reviews: PlanReview[];
  amendments: PlanAmendment[];
  planHash: string;
  approvedBy: ProviderName[];
  round: number;
}

// ── Code Implementation ──────────────────────────────────────────────────────

export interface ImplementationFile {
  filePath: string;
  originalContent: string;
  proposedContent: string;
  explanation: string;
}

export interface ImplementationSnapshot {
  files: ImplementationFile[];
  diffSummary: string;
  codeHash: string;
  approvedBy: ProviderName[];
}

// ── Code Review ──────────────────────────────────────────────────────────────

export interface CodeFinding {
  severity: 'blocker' | 'major' | 'minor';
  filePath: string;
  description: string;
  suggestedFix?: string;
}

export interface CodeObjection {
  provider: ProviderName;
  severity: 'blocker' | 'major' | 'minor';
  description: string;
  resolution?: string;
}

export interface CodeReview {
  provider: ProviderName;
  role: CouncilRoleType;
  approved: boolean;
  findings: CodeFinding[];
  requiredRevisions: string[];
  resolvedObjections: CodeObjection[];
}

export interface ApprovedImplementation {
  snapshot: ImplementationSnapshot;
  reviews: CodeReview[];
  round: number;
}

// ── Verification ─────────────────────────────────────────────────────────────

export type VerificationCheckType = 'lint' | 'typecheck' | 'test' | 'build';

export interface CheckConfig {
  type: VerificationCheckType;
  command: string;
  args: string[];
  cwd?: string;
  timeoutMs?: number;
}

export interface VerificationCheck {
  type: VerificationCheckType;
  passed: boolean;
  output: string;
  duration: number; // ms
}

export interface VerificationResult {
  checks: VerificationCheck[];
  allPassed: boolean;
  timestamp: number;
}

// ── Git Gate ─────────────────────────────────────────────────────────────────

export interface GitGateState {
  planApproved: boolean;
  codeApproved: boolean;
  checksGreen: boolean;
  blockingRisks: string[];
  commitReady: boolean;
  pushReady: boolean;
  commitMessage?: string;
  autoCommit: boolean;
  autoPush: boolean;
}

export interface CommitResult {
  success: boolean;
  commitHash?: string;
  message: string;
}

export interface PushResult {
  success: boolean;
  remote?: string;
  branch?: string;
  message: string;
}

export interface GitStatusInfo {
  branch: string;
  dirty: boolean;
  staged: string[];
  unstaged: string[];
  untracked: string[];
}

// ── Workflow Session ─────────────────────────────────────────────────────────

export interface WorkflowIntake {
  request: string;
  context: string;
  selectedFiles: string[];
  workspacePath: string;
}

export interface WorkflowHistoryEntry {
  phase: CouncilWorkflowPhase;
  timestamp: number;
  message: string;
  provider?: ProviderName;
}

export interface CouncilWorkflowSession {
  id: string;
  phase: CouncilWorkflowPhase;
  mode: ExecutionMode;
  action: CouncilWorkflowAction;
  roles: CouncilRole[];

  intake: WorkflowIntake;

  planSnapshots: ApprovedPlanSnapshot[];
  codeSnapshots: ApprovedImplementation[];
  verification?: VerificationResult;
  gitGate?: GitGateState;

  history: WorkflowHistoryEntry[];
  createdAt: number;
  updatedAt: number;

  /** Set when phase='blocked'. */
  blockReason?: string;
  /** Number of verify→revise retry cycles consumed. */
  verifyRetries: number;
}

// ── Workflow Engine Events ───────────────────────────────────────────────────
// These extend the EngineEvent union in taskTypes.ts.

export type CouncilWorkflowEventType =
  | 'WORKFLOW_STARTED'
  | 'PHASE_CHANGED'
  | 'USER_INPUT_REQUIRED'
  | 'WORKFLOW_COMPLETE'
  | 'WORKFLOW_BLOCKED'
  | 'PLAN_DRAFT_STARTED'
  | 'PLAN_REVIEW_SUBMITTED'
  | 'PLAN_REVISION'
  | 'PLAN_APPROVED'
  | 'PLAN_BLOCKED'
  | 'CODE_DRAFT_STARTED'
  | 'CODE_REVIEW_SUBMITTED'
  | 'CODE_REVISION'
  | 'CODE_APPROVED'
  | 'CODE_BLOCKED'
  | 'SCOPE_DRIFT_DETECTED'
  | 'VERIFICATION_STARTED'
  | 'CHECK_PASSED'
  | 'CHECK_FAILED'
  | 'VERIFICATION_COMPLETE'
  | 'GIT_GATE_EVALUATED'
  | 'COMMIT_PREPARED'
  | 'COMMIT_EXECUTED'
  | 'PUSH_REQUESTED'
  | 'PUSH_EXECUTED';

export type CouncilWorkflowEvent =
  // Lifecycle
  | { type: 'WORKFLOW_STARTED';       sessionId: string; mode: ExecutionMode; action: CouncilWorkflowAction }
  | { type: 'PHASE_CHANGED';         sessionId: string; from: CouncilWorkflowPhase; to: CouncilWorkflowPhase }
  | { type: 'USER_INPUT_REQUIRED';   sessionId: string; prompt: string; options?: string[] }
  | { type: 'WORKFLOW_COMPLETE';     sessionId: string; summary: string }
  | { type: 'WORKFLOW_BLOCKED';      sessionId: string; reason: string }
  // Plan council
  | { type: 'PLAN_DRAFT_STARTED';    sessionId: string; round: number }
  | { type: 'PLAN_REVIEW_SUBMITTED'; sessionId: string; provider: ProviderName; role: CouncilRoleType; approved: boolean }
  | { type: 'PLAN_REVISION';         sessionId: string; round: number; amendmentCount: number }
  | { type: 'PLAN_APPROVED';         sessionId: string; planHash: string; approvedBy: ProviderName[] }
  | { type: 'PLAN_BLOCKED';          sessionId: string; reason: string }
  // Code council
  | { type: 'CODE_DRAFT_STARTED';    sessionId: string; round: number; fileCount: number }
  | { type: 'CODE_REVIEW_SUBMITTED'; sessionId: string; provider: ProviderName; role: CouncilRoleType; approved: boolean }
  | { type: 'CODE_REVISION';         sessionId: string; round: number; revisionCount: number }
  | { type: 'CODE_APPROVED';         sessionId: string; codeHash: string; approvedBy: ProviderName[] }
  | { type: 'CODE_BLOCKED';          sessionId: string; reason: string }
  | { type: 'SCOPE_DRIFT_DETECTED';  sessionId: string; extraFiles: string[] }
  // Verification
  | { type: 'VERIFICATION_STARTED';  sessionId: string; checkCount: number }
  | { type: 'CHECK_PASSED';          sessionId: string; checkType: VerificationCheckType; duration: number }
  | { type: 'CHECK_FAILED';          sessionId: string; checkType: VerificationCheckType; output: string }
  | { type: 'VERIFICATION_COMPLETE'; sessionId: string; allPassed: boolean }
  // Git
  | { type: 'GIT_GATE_EVALUATED';    sessionId: string; gate: GitGateState }
  | { type: 'COMMIT_PREPARED';       sessionId: string; message: string; fileCount: number }
  | { type: 'COMMIT_EXECUTED';       sessionId: string; commitHash: string }
  | { type: 'PUSH_REQUESTED';        sessionId: string; remote: string; branch: string }
  | { type: 'PUSH_EXECUTED';         sessionId: string; remote: string; branch: string };

// ── User Input Types ─────────────────────────────────────────────────────────

export type UserInputAction =
  | { type: 'approve_plan' }
  | { type: 'reject_plan'; reason: string }
  | { type: 'narrow_plan'; instructions: string }
  | { type: 'approve_code' }
  | { type: 'reject_code'; reason: string }
  | { type: 'approve_commit' }
  | { type: 'reject_commit' }
  | { type: 'approve_push' }
  | { type: 'reject_push' }
  | { type: 'abort' };
