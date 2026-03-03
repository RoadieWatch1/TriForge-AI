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
  | 'it_services' | 'it_processes' | 'it_script_runner' | 'it_patch_advisor';

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
  | 'IT_ACTION_PROPOSED' | 'IT_ACTION_APPROVED' | 'IT_ACTION_EXECUTED' | 'IT_ACTION_FAILED';

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
  | { type: 'AUTONOMY_HEALTH';            activeWorkflows: number; sensorsRunning: number; pendingApprovals: number };
