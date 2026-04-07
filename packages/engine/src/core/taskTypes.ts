// ── Task Engine Types ──────────────────────────────────────────────────────────

export type TaskCategory = 'email' | 'social' | 'research' | 'files' | 'trading' | 'general';

// ── Inbound Task Trust Gate (Phase 2) ─────────────────────────────────────────

/** Where a task originated. Used by the inbound trust gate and audit trail. */
export type InboundTaskSource =
  | 'local_ui'        // created directly from the renderer UI
  | 'localhost_api'   // created via the Control Plane HTTP API
  | 'webhook_local'   // triggered via the local webhook server
  | 'github'          // future: GitHub webhook adapter
  | 'telegram';       // future: Telegram bot adapter

/** Pre-flight risk classification for inbound tasks before AgentLoop executes. */
export type InboundRiskClass =
  | 'informational'    // read-only research, safe to pass through directly
  | 'skill_execution'  // invokes a skill — requires approval gate
  | 'write_action'     // sends, posts, creates, deletes — goes through AgentLoop trust gate
  | 'high_risk';       // obvious destructive intent — blocked at pre-flight

/** Result of the pre-flight inbound task trust gate. */
export interface InboundTaskDecision {
  source: InboundTaskSource;
  riskClass: InboundRiskClass;
  blocked: boolean;
  blockReason?: string;
  requiresApproval: boolean;
  auditId: string;
}

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
  | 'read_file' | 'write_file' | 'append_file' | 'run_command' | 'fetch_url' | 'search_workspace'
  // Income Operator actions (Phase 4B)
  | 'launch_experiment' | 'spend_budget' | 'publish_content' | 'kill_experiment'
  | 'scale_experiment' | 'connect_platform' | 'install_tool'
  // Section 8 — Desktop Operator Engine
  | 'operator_focus_app'    // bring a named app to the foreground
  | 'operator_screenshot'   // capture the current screen state
  | 'operator_type_text'    // type text into the focused window (approval required)
  | 'operator_send_key'     // send a keyboard shortcut (approval required)
  | 'operator_get_target'   // read current frontmost app (read-only)
  | 'operator_list_apps';   // list visible running apps (read-only)

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
  | 'PUSH_REQUESTED' | 'PUSH_EXECUTED'
  // Phase 2 — Inbound Trust Gate + Control Plane + Skill Trust
  | 'INBOUND_TASK_RECEIVED'  | 'INBOUND_TASK_BLOCKED'  | 'INBOUND_TASK_APPROVED'
  | 'SKILL_ANALYZED'         | 'SKILL_BLOCKED'
  | 'CONTROL_PLANE_STARTED'  | 'CONTROL_PLANE_STOPPED' | 'CONTROL_PLANE_TASK_CREATED'
  // Phase 3 — GitHub Integration
  | 'GITHUB_PR_REVIEW_REQUESTED' | 'GITHUB_PR_REVIEW_COMPLETED'
  | 'GITHUB_COMMENT_POSTED'      | 'GITHUB_COMMENT_BLOCKED'
  | 'GITHUB_ISSUE_TRIAGE_REQUESTED' | 'GITHUB_ISSUE_TRIAGE_COMPLETED'
  | 'GITHUB_WEBHOOK_RECEIVED'    | 'GITHUB_WEBHOOK_DISPATCHED'
  | 'GITHUB_REVIEW_APPROVED'     | 'GITHUB_REVIEW_DISMISSED'
  // Phase 4 — Local Model Pipeline
  | 'LOCAL_MODEL_SELECTED'       | 'LOCAL_MODEL_FALLBACK'
  | 'LOCAL_SKILL_ANALYZED'
  // Phase 5 — Skill Store
  | 'SKILL_INSTALLED'            | 'SKILL_UNINSTALLED'
  | 'SKILL_EXECUTED'             | 'SKILL_INSTALL_BLOCKED'
  // Phase 6 — Telegram Messaging
  | 'TELEGRAM_BOT_STARTED'       | 'TELEGRAM_BOT_STOPPED'
  | 'TELEGRAM_MESSAGE_RECEIVED'  | 'TELEGRAM_MESSAGE_BLOCKED'
  | 'TELEGRAM_TASK_CREATED'      | 'TELEGRAM_REPLY_SENT'
  | 'TELEGRAM_REPLY_BLOCKED'     | 'TELEGRAM_APPROVAL_PENDING'
  // Phase 7 — Approval Policy Engine
  | 'POLICY_RULE_MATCHED'        | 'POLICY_RULE_FALLBACK'
  | 'POLICY_RULE_CREATED'        | 'POLICY_RULE_UPDATED'
  | 'POLICY_RULE_DELETED'        | 'POLICY_DEFAULTS_RESET'
  // Phase 8 — Slack Messaging
  | 'SLACK_BOT_STARTED'          | 'SLACK_BOT_STOPPED'
  | 'SLACK_MESSAGE_RECEIVED'     | 'SLACK_MESSAGE_BLOCKED'
  | 'SLACK_TASK_CREATED'         | 'SLACK_REPLY_SENT'
  | 'SLACK_REPLY_BLOCKED'        | 'SLACK_APPROVAL_PENDING'
  | 'SLACK_SUMMARY_SENT'
  // Phase 9 — Jira Integration
  | 'JIRA_CONNECTED'             | 'JIRA_ISSUE_READ'
  | 'JIRA_ACTION_QUEUED'         | 'JIRA_ACTION_APPROVED'
  | 'JIRA_ACTION_DISMISSED'      | 'JIRA_COMMENT_POSTED'
  | 'JIRA_ISSUE_CREATED'         | 'JIRA_STATUS_TRANSITIONED'
  | 'JIRA_TRIAGE_STARTED'        | 'JIRA_SUMMARY_SENT'
  // Phase 10 — Push Notifications
  | 'PUSH_SENT'                  | 'PUSH_FAILED'
  // Phase 12 — Discord Integration
  | 'DISCORD_BOT_STARTED'        | 'DISCORD_BOT_STOPPED'
  | 'DISCORD_MESSAGE_RECEIVED'   | 'DISCORD_MESSAGE_BLOCKED'
  | 'DISCORD_TASK_CREATED'       | 'DISCORD_REPLY_SENT'
  | 'DISCORD_REPLY_BLOCKED'      | 'DISCORD_APPROVAL_PENDING'
  // Phase 11 — Linear Integration
  | 'LINEAR_CONNECTED'           | 'LINEAR_ISSUE_READ'
  | 'LINEAR_ISSUE_SEARCHED'      | 'LINEAR_ACTION_QUEUED'
  | 'LINEAR_ACTION_APPROVED'     | 'LINEAR_ACTION_DISMISSED'
  | 'LINEAR_COMMENT_POSTED'      | 'LINEAR_ISSUE_CREATED'
  | 'LINEAR_STATUS_UPDATED'      | 'LINEAR_TRIAGE_STARTED'
  | 'LINEAR_SUMMARY_SENT'
  // Phase 13 — Automation Recipes
  | 'RECIPE_STARTED'             | 'RECIPE_COMPLETED'
  | 'RECIPE_FAILED'
  // Phase 26 — Dispatch thread collaboration
  | 'THREAD_INVITE_CREATED'      | 'THREAD_INVITE_CLAIMED'
  | 'THREAD_COLLAB_REMOVED'      | 'THREAD_COMMENT_ADDED'
  | 'THREAD_COMMENT_DELETED'     | 'THREAD_ATTRIBUTION_RECORDED'
  // Phase 27 — Workspace / org management
  | 'WORKSPACE_CREATED'          | 'WORKSPACE_INVITE_CREATED'
  | 'WORKSPACE_INVITE_CLAIMED'   | 'WORKSPACE_MEMBER_REMOVED'
  | 'WORKSPACE_ROLE_CHANGED'     | 'WORKSPACE_POLICY_UPDATED'
  // Phase 28 — Workspace-owned integrations + scoped secrets
  | 'WS_INTEGRATION_CONFIGURED'  | 'WS_INTEGRATION_REVOKED'
  | 'WS_INTEGRATION_TESTED'      | 'WS_INTEGRATION_USED'
  | 'WS_RECIPE_RUN'              | 'WS_CRED_RESOLUTION'
  // Phase 29 — Workspace policy enforcement
  | 'WS_POLICY_RULE_MATCHED'     | 'WS_APPROVAL_DENIED'
  | 'WS_APPROVAL_GRANTED'        | 'WS_APPROVAL_MATRIX_UPDATED'
  | 'DISPATCH_PAIRED'            | 'DISPATCH_REVOKED'
  // Phase 30 — Workspace automation governance
  | 'WS_RECIPE_CREATED'          | 'WS_RECIPE_EDITED'
  | 'WS_RECIPE_DELETED'          | 'WS_RECIPE_BLOCKED'
  | 'WS_RECIPE_RUNNER_BLOCKED'   | 'WS_RECIPE_REMOTE_DENIED'
  | 'WS_DELEGATED_OP_ASSIGNED'   | 'WS_DELEGATED_OP_REVOKED'
  | 'WS_AUTOMATION_POLICY_SET'   | 'WS_RECIPE_POLICY_SET'
  // Phase 31 — Workspace runbooks + incident mode
  | 'RUNBOOK_CREATED'            | 'RUNBOOK_UPDATED'
  | 'RUNBOOK_DELETED'            | 'RUNBOOK_STARTED'
  | 'RUNBOOK_COMPLETED'          | 'RUNBOOK_FAILED'
  | 'RUNBOOK_STEP_STARTED'       | 'RUNBOOK_STEP_COMPLETED'
  | 'RUNBOOK_STEP_FAILED'        | 'RUNBOOK_STEP_ATTENTION'
  | 'RUNBOOK_ESCALATED'          | 'INCIDENT_MODE_CHANGED'
  // Phase 32 — Pause/resume + handoff queue
  | 'RUNBOOK_PAUSED'             | 'RUNBOOK_RESUMED'
  | 'RUNBOOK_ABORTED'            | 'HANDOFF_CREATED'
  | 'HANDOFF_RESOLVED'           | 'HANDOFF_EXPIRED'
  // Phase 33 — Conditions, branching, deadlines
  | 'RUNBOOK_BRANCH_TAKEN'       | 'RUNBOOK_CONDITION_EVALUATED'
  | 'RUNBOOK_DEADLINE_MISSED'    | 'RUNBOOK_DEADLINE_ESCALATED'
  | 'RUNBOOK_STEP_RETRIED'       | 'RUNBOOK_STEP_SKIPPED'
  // Phase 34 — Variables, templates, reusable playbooks
  | 'RUNBOOK_VAR_MISSING'        | 'RUNBOOK_VARS_RESOLVED'
  | 'RUNBOOK_OUTPUT_CAPTURED'    | 'RUNBOOK_TEMPLATE_RUN'
  // Phase 35 — Runbook packs + import/export + versioning
  | 'PACK_IMPORTED'              | 'PACK_INSTALLED'
  | 'PACK_UPDATED'               | 'PACK_UNINSTALLED'
  | 'PACK_ROLLBACK'              | 'RUNBOOK_UPGRADED'
  | 'RUNBOOK_DOWNGRADED'         | 'PACK_EXPORTED'
  // Phase 36 — Pack trust, signing, and update safety
  | 'PACK_SIGNATURE_VERIFIED'    | 'PACK_SIGNATURE_FAILED'
  | 'PACK_UNSIGNED_ALLOWED'      | 'PACK_UNSIGNED_BLOCKED'
  | 'PACK_UPDATE_RISK_INCREASED' | 'PACK_POLICY_BLOCKED'
  | 'TRUSTED_SIGNER_ADDED'       | 'TRUSTED_SIGNER_REMOVED'
  | 'TRUSTED_SIGNER_REVOKED'     | 'PACK_SIGNED'
  // Income Operator (Phase 4B)
  | 'INCOME_APPROVAL_CREATED'    | 'INCOME_APPROVAL_APPROVED'   | 'INCOME_APPROVAL_DENIED'
  | 'INCOME_EXPERIMENT_LAUNCHED' | 'INCOME_EXPERIMENT_KILLED'   | 'INCOME_EXPERIMENT_SCALED'
  | 'INCOME_PLATFORM_CONNECTED'  | 'INCOME_CONTENT_PUBLISHED'   | 'INCOME_TOOL_INSTALLED'
  // Phase 38 — Enterprise admin + policy inheritance
  | 'ORG_CREATED'                | 'ORG_UPDATED'
  | 'ORG_POLICY_UPDATED'         | 'ORG_SIGNER_ADDED'
  | 'ORG_SIGNER_REVOKED'         | 'ORG_SIGNER_REMOVED'
  | 'ORG_INTEGRATION_BLOCKED'    | 'ORG_INTEGRATION_ALLOWED'
  | 'AUDIT_EXPORTED'             | 'POLICY_HISTORY_EXPORTED'
  // Section 8 — Desktop Operator Engine
  | 'OPERATOR_SESSION_STARTED'   | 'OPERATOR_SESSION_ENDED'
  | 'OPERATOR_ACTION_QUEUED'     | 'OPERATOR_ACTION_APPROVED'
  | 'OPERATOR_ACTION_DENIED'     | 'OPERATOR_ACTION_EXECUTED'
  | 'OPERATOR_ACTION_FAILED'     | 'OPERATOR_PERMISSION_DENIED'
  | 'OPERATOR_TARGET_CONFIRMED'  | 'OPERATOR_TARGET_LOST'
  | 'OPERATOR_SCREENSHOT_TAKEN'  | 'OPERATOR_RECOVERY_TRIGGERED'
  // Section 10 — Trust, Security, Safety Hardening
  | 'TRUST_OVERRIDE_APPLIED'     // trust escalation applied from renderer — always logged
  | 'AUTOPASS_EXECUTED'          // SAFE_AUTOPASS_TOOLS bypassed approval gate — always logged
  | 'OPERATOR_ENABLED'           // operator capability kill switch turned on
  | 'OPERATOR_DISABLED';         // operator capability kill switch turned off

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
  /** True when SAFE_AUTOPASS_TOOLS bypassed the approval gate — must be audit-logged. */
  autopassApplied?: boolean;
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
  | { type: 'PUSH_EXECUTED';         sessionId: string; remote: string; branch: string }
  // Phase 2 — Inbound Trust Gate
  | { type: 'INBOUND_TASK_RECEIVED'; source: InboundTaskSource; riskClass: InboundRiskClass; goal: string }
  | { type: 'INBOUND_TASK_BLOCKED';  source: InboundTaskSource; blockReason: string; goal: string }
  | { type: 'INBOUND_TASK_APPROVED'; source: InboundTaskSource; taskId: string }
  // Phase 2 — Skill Trust
  | { type: 'SKILL_ANALYZED';  name: string; riskLevel: string; blocked: boolean }
  | { type: 'SKILL_BLOCKED';   name: string; blockReason: string }
  // Phase 2 — Control Plane
  | { type: 'CONTROL_PLANE_STARTED'; port: number }
  | { type: 'CONTROL_PLANE_STOPPED' }
  | { type: 'CONTROL_PLANE_TASK_CREATED'; taskId: string; goal: string; source: InboundTaskSource }
  // Phase 3 — GitHub
  | { type: 'GITHUB_PR_REVIEW_REQUESTED';    owner: string; repo: string; prNumber: number }
  | { type: 'GITHUB_PR_REVIEW_COMPLETED';    owner: string; repo: string; prNumber: number; reviewId: string }
  | { type: 'GITHUB_COMMENT_POSTED';         owner: string; repo: string; number: number; commentUrl: string }
  | { type: 'GITHUB_COMMENT_BLOCKED';        owner: string; repo: string; number: number; reason: string }
  | { type: 'GITHUB_ISSUE_TRIAGE_COMPLETED'; owner: string; repo: string; issueNumber: number; reviewId: string }
  | { type: 'GITHUB_WEBHOOK_RECEIVED';       event: string; owner: string; repo: string; number: number }
  | { type: 'GITHUB_REVIEW_APPROVED';        reviewId: string; commentUrl: string }
  | { type: 'GITHUB_REVIEW_DISMISSED';       reviewId: string }
  // Section 8 — Desktop Operator Engine
  | { type: 'OPERATOR_SESSION_STARTED';    sessionId: string; intendedTarget: string | null }
  | { type: 'OPERATOR_SESSION_ENDED';      sessionId: string; status: string; actionCount: number }
  | { type: 'OPERATOR_ACTION_QUEUED';      sessionId: string; actionId: string; actionType: string; approvalId: string }
  | { type: 'OPERATOR_ACTION_APPROVED';    sessionId: string; actionId: string; approvalId: string }
  | { type: 'OPERATOR_ACTION_DENIED';      sessionId: string; actionId: string; approvalId: string; reason?: string }
  | { type: 'OPERATOR_ACTION_EXECUTED';    sessionId: string; actionId: string; actionType: string; outcome: string; durationMs: number }
  | { type: 'OPERATOR_ACTION_FAILED';      sessionId: string; actionId: string; actionType: string; error: string }
  | { type: 'OPERATOR_PERMISSION_DENIED';  sessionId: string; permission: 'accessibility' | 'screen_recording' }
  | { type: 'OPERATOR_TARGET_CONFIRMED';   sessionId: string; appName: string }
  | { type: 'OPERATOR_TARGET_LOST';        sessionId: string; expected: string; actual: string }
  | { type: 'OPERATOR_SCREENSHOT_TAKEN';   sessionId: string; path: string }
  | { type: 'OPERATOR_RECOVERY_TRIGGERED'; sessionId: string; reason: string; behavior: string }
  // Section 10 — Trust, Security, Safety Hardening
  | { type: 'TRUST_OVERRIDE_APPLIED'; taskId: string; categories: string[] }
  | { type: 'AUTOPASS_EXECUTED';      taskId: string; tool: string; category: TaskCategory }
  | { type: 'OPERATOR_ENABLED' }
  | { type: 'OPERATOR_DISABLED' };
