// ── Task Engine Types ──────────────────────────────────────────────────────────

export type TaskCategory = 'email' | 'social' | 'research' | 'files' | 'trading' | 'general';

export type TaskStatus =
  | 'queued'             // created, not yet started
  | 'planning'           // plan being generated
  | 'pending'            // legacy alias for queued (backward compat)
  | 'running'            // executing steps
  | 'awaiting_approval'  // paused waiting for human approval
  | 'paused'             // explicitly paused by user
  | 'completed'
  | 'failed'
  | 'cancelled';

export type StepStatus =
  | 'pending'
  | 'running'
  | 'awaiting_approval'
  | 'completed'
  | 'failed'
  | 'skipped';

export type TrustLevel = 'off' | 'suggest' | 'approve' | 'full';
export type TaskToolName =
  | 'draft_email' | 'schedule_post' | 'doc_search' | 'file_organize' | 'broker_sim'
  | 'send_email' | 'post_twitter' | 'run_outreach' | 'analyze_results' | 'web_research'
  // IT Tool Pack
  | 'it_diagnostics' | 'it_network_doctor' | 'it_event_logs'
  | 'it_services' | 'it_processes' | 'it_script_runner' | 'it_patch_advisor'
  // Autonomous Tool Execution Layer
  | 'read_file' | 'write_file' | 'append_file' | 'run_command' | 'fetch_url' | 'search_workspace';

export type AuditEventType =
  | 'TASK_CREATED' | 'TASK_STARTED' | 'TASK_COMPLETED' | 'TASK_FAILED'
  | 'TASK_CANCELLED' | 'TASK_PAUSED' | 'TASK_RESUMED'
  | 'STEP_STARTED' | 'STEP_COMPLETED' | 'STEP_FAILED'
  | 'STEP_BLOCKED'
  | 'STEP_RETRY_SCHEDULED'
  | 'STEP_APPROVAL_REQUESTED'
  | 'STEP_APPROVED' | 'STEP_DENIED'
  | 'APPROVAL_CREATED' | 'APPROVAL_EXPIRED'
  | 'TOOL_CALLED' | 'TOOL_RESULT'
  | 'PLAN_CREATED'
  | 'TRUST_DENIED'
  | 'BUDGET_RESERVED' | 'BUDGET_COMMITTED' | 'BUDGET_RELEASED'
  | 'SCHEDULER_FIRED'
  // Phase 4 — Real Execution
  | 'EMAIL_SENT' | 'TWEET_POSTED' | 'OUTREACH_COMPLETED' | 'RESULT_LOGGED'
  // IT Tool Pack
  | 'IT_ACTION_PROPOSED' | 'IT_ACTION_APPROVED' | 'IT_ACTION_EXECUTED' | 'IT_ACTION_FAILED'
  // Autonomy governance
  | 'ACTION_BLOCKED' | 'ACTION_APPROVAL_REQUIRED' | 'ACTION_EXECUTED'
  | 'WORKFLOW_FIRED' | 'WORKFLOW_FAILED'
  // Profession + sensor lifecycle
  | 'PROFESSION_ACTIVATED' | 'PROFESSION_DEACTIVATED'
  | 'SENSOR_STARTED' | 'SENSOR_STOPPED'
  // Persistent Mission System
  | 'MISSION_REGISTERED' | 'MISSION_FIRED' | 'MISSION_COMPLETED' | 'MISSION_FAILED'
  // Tool Execution Layer
  | 'TOOL_EXECUTE_REQUESTED' | 'TOOL_EXECUTE_APPROVED' | 'TOOL_EXECUTE_COMPLETED' | 'TOOL_EXECUTE_FAILED'
  // Pro Image Generator
  | 'IMAGE_REQUESTED' | 'IMAGE_GENERATED' | 'IMAGE_CRITIQUE' | 'IMAGE_FAILED'
  // Council Executor
  | 'COUNCIL_STARTED' | 'COUNCIL_ANALYSIS' | 'COUNCIL_RESULT' | 'COUNCIL_CRITIQUE'
  // Council Conversation Engine
  | 'COUNCIL_CONV_DRAFT' | 'COUNCIL_CONV_STREAM' | 'COUNCIL_CONV_UPDATE'
  | 'COUNCIL_CONV_PLAN' | 'COUNCIL_CONV_SUGGESTION' | 'COUNCIL_CONV_INTERRUPT'
  // AI Mind
  | 'MIND_SUGGESTION'
  // Tool Execution Bus
  | 'TOOL_BUS_START' | 'TOOL_BUS_COMPLETE' | 'TOOL_BUS_ERROR'
  // Agent Safety Guard
  | 'AGENT_BLOCKED'
  // Event Intelligence
  | 'INTELLIGENCE_INSIGHT'
  // Council Workflow Pipeline
  | 'WORKFLOW_STARTED' | 'PHASE_CHANGED' | 'USER_INPUT_REQUIRED'
  | 'WORKFLOW_COMPLETE' | 'WORKFLOW_BLOCKED'
  | 'PLAN_DRAFT_STARTED' | 'PLAN_REVIEW_SUBMITTED' | 'PLAN_REVISION'
  | 'PLAN_APPROVED' | 'PLAN_BLOCKED'
  | 'CODE_DRAFT_STARTED' | 'CODE_REVIEW_SUBMITTED' | 'CODE_REVISION'
  | 'CODE_APPROVED' | 'CODE_BLOCKED' | 'SCOPE_DRIFT_DETECTED'
  | 'VERIFICATION_STARTED' | 'CHECK_PASSED' | 'CHECK_FAILED' | 'VERIFICATION_COMPLETE'
  | 'GIT_GATE_EVALUATED' | 'COMMIT_PREPARED' | 'COMMIT_EXECUTED'
  | 'PUSH_REQUESTED' | 'PUSH_EXECUTED';

// ── Execution Result (Phase 4) ─────────────────────────────────────────────────

export interface ExecutionMetrics {
  emailsSent?: number;
  emailsFailed?: number;
  targets?: number;
  tweetId?: string;
  successRate?: number;
  charCount?: number;
}

export interface ExecutionResult {
  id: string;
  taskId: string;
  stepId: string;
  tool: TaskToolName;
  timestamp: number;
  success: boolean;
  paperMode: boolean;
  data: unknown;
  metrics?: ExecutionMetrics;
}

export type ScheduleType = 'once' | 'recurring';

export interface Step {
  id: string;
  title: string;
  description: string;
  tool: TaskToolName;
  args: Record<string, unknown>;
  riskLevel: 'low' | 'medium' | 'high';
  requiresApproval: boolean;
  estimatedCostCents: number;
  status: StepStatus;
  // Retry + idempotency (Phase 3.5)
  attempts: number;        // current attempt count
  maxAttempts: number;     // default 3
  nextRetryAt?: number;    // epoch ms — set after failure, cleared on success
  runToken?: string;       // UUID set before tool exec, cleared after (crash guard)
  blockedReason?: string;  // set when trust blocks or crash recovery resets
  // Results
  result?: unknown;
  error?: string;
  startedAt?: number;
  completedAt?: number;
}

export interface Plan {
  id: string;
  goalStatement: string;
  strategyNotes: string;
  steps: Step[];
  createdAt: number;
  agreementScore: number;
}

export interface Task {
  id: string;
  goal: string;
  category: TaskCategory;
  status: TaskStatus;
  plan?: Plan;
  currentStepIndex: number;
  createdAt: number;
  updatedAt: number;
  error?: string;
  trustSnapshot?: TrustModeSnapshot;
  campaignId?: string;    // Phase 5 — links task to a Value Engine campaign
}

export interface TrustPolicy {
  level: TrustLevel;
  dailyBudgetCents: number;
  perActionLimitCents: number;
  allowedTools: TaskToolName[];
  requireStopLoss?: boolean;
}

export type TrustModeSnapshot = Record<TaskCategory, TrustPolicy>;

export interface TrustDecision {
  allowed: boolean;
  requiresApproval: boolean;
  reason: string;
  reservedCents: number;
  isPaperTrade?: boolean;
}

export interface WalletSnapshot {
  dailySpentCents: number;
  categorySpent: Record<TaskCategory, number>;
  categoryReserved: Record<TaskCategory, number>;
  date: string; // ISO date YYYY-MM-DD
}

export interface SchedulerJob {
  id: string;
  taskGoal: string;
  category: TaskCategory;
  type: ScheduleType;
  runAt?: number;
  cronExpr?: string;
  label?: string;
  lastFiredAt?: number;
  nextRunAt?: number;
  createdAt: number;
  active: boolean;
}

export interface AuditLedgerEntry {
  id: string;
  timestamp: number;
  eventType: AuditEventType;
  taskId?: string;
  stepId?: string;
  tool?: string;
  category?: TaskCategory;
  metadata?: Record<string, unknown>;
}

export interface ToolDefinition {
  name: TaskToolName;
  description: string;
  category: TaskCategory;
  riskLevel: 'low' | 'medium' | 'high';
  estimatedCostCents: number;
  inputSchema: Record<string, unknown>;
}

export interface ToolContext {
  taskId: string;
  stepId: string;
  category: TaskCategory;
}

// ── Approval Request (Phase 3.5) ──────────────────────────────────────────────

export interface ApprovalRequest {
  id: string;
  taskId: string;
  stepId: string;
  tool: TaskToolName;
  args: Record<string, unknown>;
  riskLevel: 'low' | 'medium' | 'high';
  estimatedCostCents: number;
  createdAt: number;
  expiresAt: number;   // createdAt + 24h
  status: 'pending' | 'approved' | 'denied' | 'expired';
  respondedAt?: number;
  reason?: string;
}

// ── Engine Event discriminated union ──────────────────────────────────────────

export type EngineEvent =
  | { type: 'TASK_CREATED';          taskId: string; goal: string; category: TaskCategory }
  | { type: 'TASK_STARTED';          taskId: string }
  | { type: 'TASK_PLAN_READY';       taskId: string; plan: Plan }
  | { type: 'TASK_COMPLETED';        taskId: string }
  | { type: 'TASK_FAILED';           taskId: string; error: string }
  | { type: 'TASK_CANCELLED';        taskId: string }
  | { type: 'TASK_PAUSED';           taskId: string }
  | { type: 'TASK_RESUMED';          taskId: string }
  | { type: 'STEP_STARTED';          taskId: string; stepId: string; title: string }
  | { type: 'STEP_COMPLETED';        taskId: string; stepId: string; result: unknown }
  | { type: 'STEP_FAILED';           taskId: string; stepId: string; error: string }
  | { type: 'STEP_BLOCKED';          taskId: string; stepId: string; reason: string }
  | { type: 'STEP_RETRY_SCHEDULED';  taskId: string; stepId: string; attempt: number; nextRetryAt: number }
  | { type: 'APPROVAL_REQUIRED';     taskId: string; stepId: string; step: Step; approvalId: string }
  | { type: 'APPROVAL_CREATED';      taskId: string; stepId: string; approvalId: string; expiresAt: number }
  | { type: 'STEP_APPROVED';         taskId: string; stepId: string }
  | { type: 'STEP_DENIED';           taskId: string; stepId: string; reason?: string }
  | { type: 'TOOL_CALLED';           taskId: string; stepId: string; tool: TaskToolName; args: Record<string, unknown> }
  | { type: 'TOOL_RESULT';           taskId: string; stepId: string; result: unknown }
  | { type: 'TRUST_DENIED';          taskId: string; stepId: string; reason: string }
  | { type: 'SCHEDULER_JOB_FIRED';   jobId: string; goal: string; category: TaskCategory }
  | { type: 'WALLET_UPDATED';        snapshot: WalletSnapshot }
  // Phase 4 — Real Execution events
  | { type: 'EMAIL_SENT';            taskId: string; stepId: string; to: string[]; subject: string; paperMode: boolean }
  | { type: 'TWEET_POSTED';          taskId: string; stepId: string; tweetId: string; url: string; paperMode: boolean }
  | { type: 'OUTREACH_COMPLETED';    taskId: string; stepId: string; sent: number; failed: number; total: number }
  | { type: 'RESULT_LOGGED';         taskId: string; stepId: string; tool: TaskToolName; success: boolean }
  // Phase Autonomy — OS Sensor Layer events
  | { type: 'SENSOR_FILE_NEW';          path: string; name: string; dir: string }
  | { type: 'SENSOR_EMAIL_NEW';         from: string; subject: string; body: string; uid: string }
  | { type: 'SENSOR_CLIPBOARD_CHANGED'; content: string }
  | { type: 'SENSOR_WEBSITE_CHANGED';   url: string; diff: string }
  | { type: 'SENSOR_DISK_LOW';          path: string; freeGB: number; totalGB: number }
  | { type: 'SENSOR_NETWORK_DOWN';      adapter: string }
  | { type: 'SENSOR_NETWORK_UP';        adapter: string }
  | { type: 'SENSOR_PROCESS_ALERT';     name: string; status: 'started' | 'stopped' }
  | { type: 'SENSOR_EVENTLOG_ALERT';    source: string; level: string; message: string; eventId: number; ts: number }
  | { type: 'SENSOR_SERVICE_ALERT';    name: string; status: 'stopped' | 'running' | 'restarting' }
  | { type: 'SENSOR_CPU_HIGH';         usagePercent: number }
  | { type: 'SENSOR_RAM_HIGH';         usedPercent: number; usedGB: number; totalGB: number }
  | { type: 'WORKFLOW_FIRED';             workflowId: string; workflowName: string }
  | { type: 'WORKFLOW_FAILED';            workflowId: string; error: string }
  | { type: 'WORKFLOW_APPROVAL_PENDING';  actionId: string; workflowId: string; workflowName: string; actionType: string }
  | { type: 'AUTONOMY_HEALTH';            activeWorkflows: number; sensorsRunning: number; pendingApprovals: number }
  // Profession lifecycle
  | { type: 'PROFESSION_ACTIVATED';   profileId: string; profileName: string }
  | { type: 'PROFESSION_DEACTIVATED'; profileId: string; profileName: string }
  // Sensor lifecycle
  | { type: 'SENSOR_STARTED'; name: string }
  | { type: 'SENSOR_STOPPED'; name: string }
  // Persistent Mission System
  | { type: 'MISSION_REGISTERED';    missionId: string; name: string; schedule?: string }
  | { type: 'MISSION_FIRED';         missionId: string; name: string }
  | { type: 'MISSION_COMPLETED';     missionId: string; name: string }
  | { type: 'MISSION_FAILED';        missionId: string; name: string; error: string }
  // Tool Execution Layer
  | { type: 'TOOL_EXECUTE_REQUESTED'; requestId: string; tool: string; riskLevel: string }
  | { type: 'TOOL_EXECUTE_APPROVED';  requestId: string; tool: string }
  | { type: 'TOOL_EXECUTE_COMPLETED'; requestId: string; tool: string; result: unknown }
  | { type: 'TOOL_EXECUTE_FAILED';    requestId: string; tool: string; error: string }
  // Pro Image Generator
  | { type: 'IMAGE_REQUESTED';  requestId: string; userPrompt: string }
  | { type: 'IMAGE_GENERATED';  requestId: string; count: number; generator: string }
  | { type: 'IMAGE_CRITIQUE';   requestId: string; bestIndex: number; summary: string }
  | { type: 'IMAGE_FAILED';     requestId: string; error: string }
  // Council Executor
  | { type: 'COUNCIL_STARTED';  request: string; category: string }
  | { type: 'COUNCIL_ANALYSIS'; expanded: string; category: string }
  | { type: 'COUNCIL_RESULT';   planId: string; stepCount: number; category: string }
  | { type: 'COUNCIL_CRITIQUE'; planId: string; critique: string }
  // Council Conversation Engine
  | { type: 'COUNCIL_CONV_DRAFT';       provider: string; text: string }
  | { type: 'COUNCIL_CONV_STREAM';      provider: string; token: string }
  | { type: 'COUNCIL_CONV_UPDATE';      text: string }
  | { type: 'COUNCIL_CONV_PLAN';        plan: Plan }
  | { type: 'COUNCIL_CONV_SUGGESTION';  text: string }
  | { type: 'COUNCIL_CONV_INTERRUPT' }
  // AI Mind
  | { type: 'MIND_SUGGESTION';  eventType: string; analysis: string; critique: string; suggestion: string }
  // Tool Execution Bus
  | { type: 'TOOL_BUS_START';    tool: string; input: Record<string, unknown> }
  | { type: 'TOOL_BUS_COMPLETE'; tool: string; durationMs: number }
  | { type: 'TOOL_BUS_ERROR';    tool: string; error: string }
  // Agent Safety Guard
  | { type: 'AGENT_BLOCKED'; taskId: string; reason: string; count: number }
  // Event Intelligence
  | { type: 'INTELLIGENCE_INSIGHT'; eventType: string; analysis: string; critique: string }
  // Council Workflow Pipeline
  | { type: 'WORKFLOW_STARTED';       sessionId: string; mode: string; action: string }
  | { type: 'PHASE_CHANGED';         sessionId: string; from: string; to: string }
  | { type: 'USER_INPUT_REQUIRED';   sessionId: string; prompt: string; options?: string[] }
  | { type: 'WORKFLOW_COMPLETE';     sessionId: string; summary: string }
  | { type: 'WORKFLOW_BLOCKED';      sessionId: string; reason: string }
  | { type: 'PLAN_DRAFT_STARTED';    sessionId: string; round: number }
  | { type: 'PLAN_REVIEW_SUBMITTED'; sessionId: string; provider: string; role: string; approved: boolean }
  | { type: 'PLAN_REVISION';         sessionId: string; round: number; amendmentCount: number }
  | { type: 'PLAN_APPROVED';         sessionId: string; planHash: string; approvedBy: string[] }
  | { type: 'PLAN_BLOCKED';          sessionId: string; reason: string }
  | { type: 'CODE_DRAFT_STARTED';    sessionId: string; round: number; fileCount: number }
  | { type: 'CODE_REVIEW_SUBMITTED'; sessionId: string; provider: string; role: string; approved: boolean }
  | { type: 'CODE_REVISION';         sessionId: string; round: number; revisionCount: number }
  | { type: 'CODE_APPROVED';         sessionId: string; codeHash: string; approvedBy: string[] }
  | { type: 'CODE_BLOCKED';          sessionId: string; reason: string }
  | { type: 'SCOPE_DRIFT_DETECTED';  sessionId: string; extraFiles: string[] }
  | { type: 'VERIFICATION_STARTED';  sessionId: string; checkCount: number }
  | { type: 'CHECK_PASSED';          sessionId: string; checkType: string; duration: number }
  | { type: 'CHECK_FAILED';          sessionId: string; checkType: string; output: string }
  | { type: 'VERIFICATION_COMPLETE'; sessionId: string; allPassed: boolean }
  | { type: 'GIT_GATE_EVALUATED';    sessionId: string; gate: Record<string, unknown> }
  | { type: 'COMMIT_PREPARED';       sessionId: string; message: string; fileCount: number }
  | { type: 'COMMIT_EXECUTED';       sessionId: string; commitHash: string }
  | { type: 'PUSH_REQUESTED';        sessionId: string; remote: string; branch: string }
  | { type: 'PUSH_EXECUTED';         sessionId: string; remote: string; branch: string };
