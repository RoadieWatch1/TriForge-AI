export type ReviewActorRole = 'author' | 'reviewer_a' | 'reviewer_b';

export type ReviewRuntimePhase =
  | 'idle'
  | 'investigating'
  | 'planning'
  | 'plan_review'
  | 'implementing'
  | 'code_review'
  | 'reconciling'
  | 'verifying'
  | 'repairing'
  | 'ready_for_submission'
  | 'submitted'
  | 'blocked';

export type ReviewSessionStatus = 'active' | 'completed' | 'blocked' | 'cancelled';

export type ReviewVerdict =
  | 'approve'
  | 'approve_with_notes'
  | 'revise_required'
  | 'reject';

export type FindingSeverity = 'info' | 'low' | 'medium' | 'high' | 'critical';

export type ReviewFindingCategory =
  | 'scope'
  | 'architecture'
  | 'correctness'
  | 'type_safety'
  | 'regression_risk'
  | 'tests'
  | 'maintainability'
  | 'simplicity'
  | 'verification';

export type VerificationIntent =
  | 'lint'
  | 'typecheck'
  | 'test'
  | 'build'
  | 'reproduce_bug'
  | 'smoke_check';

export type VerificationStatus =
  | 'not_started'
  | 'running'
  | 'passed'
  | 'failed'
  | 'partial'
  | 'blocked';

export type SubmissionStatus =
  | 'draft'
  | 'awaiting_review'
  | 'awaiting_verification'
  | 'ready'
  | 'submitted'
  | 'blocked';

export type WinningAlignment =
  | 'author_reviewer_a'
  | 'author_reviewer_b'
  | 'reviewer_a_reviewer_b';

export type ReviewDecisionScope = 'plan' | 'code';

export type AuthorResponseDisposition = 'accept' | 'partially_accept' | 'reject';

export type CodingAgentRole =
  | 'author_planner'
  | 'author_writer'
  | 'author_repairer'
  | 'architecture_reviewer'
  | 'correctness_reviewer'
  | 'regression_reviewer'
  | 'test_gap_reviewer'
  | 'type_safety_reviewer'
  | 'simplicity_reviewer';

export type CodingAgentStatus =
  | 'candidate'
  | 'trial'
  | 'active'
  | 'watchlist'
  | 'bench'
  | 'retired'
  | 'replaced';

export interface RelevantFile {
  path: string;
  reason: string;
  confidence: number;
  language?: string;
  symbolHints?: string[];
}

export interface DiagnosticSnapshot {
  filePath: string;
  severity: 'error' | 'warning' | 'information' | 'hint';
  message: string;
  source?: string;
  code?: string;
  line?: number;
  endLine?: number;
  column?: number;
  endColumn?: number;
}

export interface RepoContextSnapshot {
  workspaceRoot: string;
  taskLabel: string;
  userRequest: string;
  relevantFiles: RelevantFile[];
  diagnostics: DiagnosticSnapshot[];
  verificationIntents: VerificationIntent[];
  changedFilesBeforeTask: string[];
  notes: string[];
  capturedAtIso: string;
}

export interface TaskDraft {
  id: string;
  createdAtIso: string;
  userRequest: string;
  objective: string;
  acceptanceCriteria: string[];
  constraints: string[];
  repoContext: RepoContextSnapshot;
}

export interface AuthorPlan {
  summary: string;
  goals: string[];
  nonGoals: string[];
  filesLikelyToChange: string[];
  risks: string[];
  verificationPlan: string[];
  implementationNotes: string[];
}

export interface ProposedFileChange {
  filePath: string;
  changeType: 'create' | 'modify' | 'delete' | 'rename';
  summary: string;
  symbolsAffected?: string[];
}

export interface AuthorImplementationDraft {
  summary: string;
  rationale: string;
  fileChanges: ProposedFileChange[];
  notes: string[];
  knownRisks: string[];
  patchIds: string[];
}

export interface ReviewFinding {
  id: string;
  reviewer: Exclude<ReviewActorRole, 'author'>;
  scope: ReviewDecisionScope;
  category: ReviewFindingCategory;
  severity: FindingSeverity;
  title: string;
  detail: string;
  filePath?: string;
  lineStart?: number;
  lineEnd?: number;
  proposedChange?: string;
  confidence: number;
}

export interface ReviewDecision {
  reviewer: 'reviewer_a' | 'reviewer_b';
  scope: ReviewDecisionScope;
  verdict: ReviewVerdict;
  summary: string;
  findings: ReviewFinding[];
  mustFixIds: string[];
  approvedPlan: boolean;
  approvedCode: boolean;
  reviewedAtIso: string;
}

export interface AuthorResponseItem {
  findingId: string;
  disposition: AuthorResponseDisposition;
  rationale: string;
  changeSummary?: string;
}

export interface AuthorRebuttal {
  summary: string;
  responses: AuthorResponseItem[];
  revisedPlanSummary?: string;
  revisedImplementationSummary?: string;
  respondedAtIso: string;
}

export interface ReconciliationOutcome {
  winningAlignment: WinningAlignment;
  alignedActors: ReviewActorRole[];
  summary: string;
  mustDoBeforeSubmit: string[];
  unresolvedRisks: string[];
  reviewerFindingsAccepted: string[];
  reviewerFindingsRejected: string[];
  decidedAtIso: string;
}

export interface VerificationCheckResult {
  intent: VerificationIntent;
  status: VerificationStatus;
  summary: string;
  command?: string;
  details?: string;
  startedAtIso?: string;
  finishedAtIso?: string;
}

export interface VerificationRun {
  id: string;
  status: VerificationStatus;
  checks: VerificationCheckResult[];
  startedAtIso: string;
  finishedAtIso?: string;
  retryCount: number;
}

export interface CodingAgentPerformanceSnapshot {
  agentId: string;
  role: CodingAgentRole;
  status: CodingAgentStatus;
  trustScore: number;
  tasksParticipated: number;
  approvalsEarned: number;
  rejectionsReceived: number;
  findingsAccepted: number;
  findingsRejected: number;
  verificationSurvivalRate: number;
  regressionRate: number;
  updatedAtIso: string;
}

export interface SubmissionArtifact {
  taskId: string;
  status: SubmissionStatus;
  finalSummary: string;
  finalApproach: string;
  authorPlan: AuthorPlan;
  implementationDraft?: AuthorImplementationDraft;
  planReviewDecisions: ReviewDecision[];
  codeReviewDecisions: ReviewDecision[];
  rebuttal?: AuthorRebuttal;
  reconciliation?: ReconciliationOutcome;
  verification?: VerificationRun;
  filesTouched: string[];
  remainingRisks: string[];
  commitMessageDraft?: string;
  preparedAtIso: string;
}

export interface ReviewSession {
  id: string;
  status: ReviewSessionStatus;
  phase: ReviewRuntimePhase;
  task: TaskDraft;
  authorPlan?: AuthorPlan;
  implementationDraft?: AuthorImplementationDraft;
  planReviewDecisions: ReviewDecision[];
  codeReviewDecisions: ReviewDecision[];
  rebuttal?: AuthorRebuttal;
  reconciliation?: ReconciliationOutcome;
  verification?: VerificationRun;
  submission?: SubmissionArtifact;
  activeAgentIds: string[];
  createdAtIso: string;
  updatedAtIso: string;
  blockedReason?: string;
}