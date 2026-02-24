/**
 * Shared message protocol between the extension host and webview.
 *
 * Backwards compatible with existing UI:
 * - keep sendMessage, decomposeGoal, patchPreview, debateLog, etc.
 * - add structured Think Tank OS primitives (CouncilResult, ActionStep, DecisionLog, HealthSnapshot)
 */

export type ProviderName = 'openai' | 'gemini' | 'claude';
export type OperatingMode = 'none' | 'single' | 'pair' | 'consensus';

export type RiskLevel = 'low' | 'medium' | 'high';
export type AutonomyLevel = 0 | 1 | 2 | 3; // 0 advisory, 1 generate-only, 2 stage/commit, 3 PR draft (no merge)

export interface ProviderStatus {
  name: ProviderName;
  connected: boolean;
  model: string;
}

export interface ModeInfo {
  mode: OperatingMode;
  available: ProviderName[];
  recommended: string;
}

export interface FileStatusInfo {
  filePath: string;
  status: string;
  approvals: number;
  total: number;
  round: number;
  maxRounds: number;
}

export interface SessionRecord {
  id: string;
  title: string;
  date: number;
  messages: Array<{ role: 'user' | 'assistant' | 'system'; content: string; provider?: ProviderName }>;
}

/* -----------------------------------------------------------
 * Think Tank OS v2 (Structured Results + Actions)
 * --------------------------------------------------------- */

/**
 * A single vote from a provider in a council round.
 */
export interface CouncilVote {
  provider: ProviderName;
  verdict: 'approve' | 'request_changes';
  reasons: string[];
  riskNotes?: string[];
}

/**
 * Options are useful even when TriForge auto-selects one,
 * because they make “think tank” decisions auditable.
 */
export interface CouncilOption {
  id: string;
  title: string;
  summary: string;
  pros: string[];
  cons: string[];
  estimatedEffort?: string;
  risk: RiskLevel;
}

/**
 * A structured step TriForge can execute via tools (commands, patching, drafting, etc.).
 * The extension host (not the webview) is always the final gatekeeper.
 */
export type ActionStepType =
  | 'think' // internal reasoning step (logged)
  | 'draft' // draft text artifact (email, message, plan)
  | 'write' // write / document
  | 'code' // implement / refactor
  | 'research' // repo search, file discovery, reading context
  | 'open_file' // open editor at file/line
  | 'run_command' // terminal command (preview + run)
  | 'create_patch' // generate patch (queued for patch flow)
  | 'patch_preview' // generate patch
  | 'apply_patch' // apply patch (may require approval policy)
  | 'stage_changes' // stage git changes
  | 'commit' // commit staged changes
  | 'pr_draft' // create PR description text (no network posting unless enabled later)
  | 'health_scan' // run health snapshot
  | 'remind' // create local reminders
  | 'reminder'; // create local reminders (alias)

export interface ActionStep {
  id: string;
  type: ActionStepType;
  title?: string;
  description: string;
  riskLevel: RiskLevel;
  requiresApproval: boolean;
  status?: ActionLogStatus;

  // Typed inputs for the runner (validated per type in extension host)
  inputs?: Record<string, any>;

  // Generic payload for the controller to interpret
  payload?: Record<string, any>;

  // Expected outcome (for user trust + debugging)
  expectedOutcome?: string;
}

/**
 * Policy / permission configuration for action execution.
 */
export interface PolicyConfig {
  riskTolerance: RiskLevel;
  autoApprove: boolean;
  maxCommandsPerSession: number;
  allowedCommandPrefixes: string[];
  allowNetworkAutomation: boolean;
  allowDirectPush: boolean;
}

/**
 * A persistent project convention (naming rules, preferred libs, style decisions).
 */
export interface ProjectConvention {
  key: string;
  value: string;
  source: 'manual' | 'inferred';
  timestamp: number;
}

/**
 * CouncilResult is the universal output format for BOTH:
 * - code consensus runs
 * - think tank decisions (life/business/product decisions)
 */
export interface CouncilResult {
  id: string; // unique id per run
  createdAt: number;

  mode: OperatingMode;
  providersUsed: ProviderName[];

  // The user's request (normalized) + optional goal framing
  request: string;
  goalStatement?: string;

  // Decision framing (Think Tank)
  obstacles?: string[];
  options?: CouncilOption[];

  // Final decision + why
  finalDecision: string;
  rationale: string[]; // bullet reasons (merged)
  risks: Array<{ severity: RiskLevel; description: string; area?: 'code' | 'security' | 'product' | 'money' | 'ops' | 'personal' }>;

  // Actionability
  actionSteps: ActionStep[];
  successMetrics?: string[];

  // Debate visibility
  confidence: number; // 0..1
  votes: CouncilVote[];

  // Optional raw logs reference (stored locally; not necessarily sent in full each time)
  debateLogRef?: { sessionId?: string; exportable?: boolean };
}

// --- Think Tank OS v1 compatibility (keep your current plan shape) ---

export interface IntentPlan {
  goalStatement: string;
  obstacles: string[];
  strategies: Array<{ provider: ProviderName; focus: string; steps: string[] }>;
  actionPlan: string[];
  metrics: string[];
}

export type ActionLogType =
  | 'think'
  | 'chat'
  | 'consensus'
  | 'insert'
  | 'patch'
  | 'action_step'
  | 'health'
  | 'decision';

export type ActionLogStatus = 'planned' | 'running' | 'done' | 'completed' | 'skipped' | 'cancelled' | 'error';

export interface ActionLogEntry {
  id: string;
  timestamp: number;
  type: ActionLogType;
  description: string;
  status: ActionLogStatus;
  providers?: ProviderName[];
  risk?: RiskLevel;

  // Optional linkage
  councilResultId?: string;
  actionStepId?: string;
  token?: string; // patch/command/lineEdit token if relevant
}

/**
 * Decision log record (institutional memory).
 * Stored locally (sqlite/json). Webview can query/search.
 */
export interface DecisionLogRecord {
  id: string;
  createdAt: number;
  title: string;
  tags?: string[];
  result: CouncilResult;
}

/**
 * Lightweight project health snapshot for the “guardian” feel.
 * Keep v1 small; expand later.
 */
export interface HealthSnapshot {
  id: string;
  createdAt: number;

  // High-level scores (0..100)
  securityScore: number;
  maintainabilityScore: number;
  testScore: number;
  dependencyScore: number;

  warnings: Array<{
    severity: RiskLevel;
    title: string;
    details?: string;
    file?: string;
    line?: number;
  }>;

  // Useful context for UI
  repo?: {
    branch?: string;
    dirty?: boolean;
    changedFiles?: number;
  };
}

/**
 * Permissions/policy state: “guardian rules”
 */
export interface PermissionState {
  riskTolerance: RiskLevel; // overall conservativeness
  autoApprove: boolean; // allow low-risk patch auto-apply
  autonomyLevel: AutonomyLevel; // how far TriForge can go without extra clicks
}

/* -----------------------------------------------------------
 * Messages: Webview -> Extension Host
 * --------------------------------------------------------- */

export type WebviewMessage =
  | { command: 'log'; text: string }
  | { command: 'action'; action: string }
  | { command: 'sendMessage'; text: string } // existing chat entrypoint
  | { command: 'requestContext' }
  | { command: 'getProviderStatus' }
  | { command: 'setApiKey'; provider: ProviderName; key: string }
  | { command: 'removeApiKey'; provider: ProviderName }
  | { command: 'setMode'; mode: 'guided' | 'professional' }
  | { command: 'cancelRequest' }
  | { command: 'approvePatches'; token: string }
  | { command: 'rejectPatches'; token: string }

  // Command preview/execution
  | { command: 'suggestCommand'; cmd: string; cwd?: string; explanation?: string; risk?: RiskLevel }
  | { command: 'runCommand'; token: string }
  | { command: 'cancelCommandPreview'; token: string }

  // Search & open
  | { command: 'searchRepo'; query: string }
  | { command: 'openFile'; path: string; line?: number }

  // Debug workflow
  | { command: 'startDebugSession'; errorLog?: string }
  | { command: 'debugAction'; sessionId: string; action: string; payload?: any }

  // Precision edits
  | { command: 'createLineEdit'; file: string; startLine: number; endLine: number; newContent: string; reason?: string }

  // Consensus disagreement actions
  | { command: 'continueDebate' }
  | { command: 'acceptMajority' }
  | { command: 'exportDebate' }

  // External navigation
  | { command: 'openExternal'; url: string }

  // New Chat & session history
  | { command: 'newChat' }
  | { command: 'getSessionList' }
  | { command: 'loadSession'; id: string }
  | { command: 'deleteSession'; id: string }

  // Inline code insertion
  | { command: 'insertToEditor'; code: string }

  // Think Tank OS (v1)
  | { command: 'decomposeGoal'; goal: string }
  | { command: 'getActionLog' }
  | { command: 'setPermissions'; riskTolerance: RiskLevel; autoApprove: boolean }

  // Think Tank OS (v2)
  | { command: 'runThinkTank'; input: string; constraints?: { budget?: number; timeframe?: string; notes?: string } }
  | { command: 'executeActionStep'; stepId: string; councilResultId?: string }
  | { command: 'skipActionStep'; stepId: string }
  | { command: 'cancelActionStep'; stepId: string }

  // Decision Log / Memory
  | { command: 'getDecisionLog'; limit?: number; offset?: number }
  | { command: 'searchDecisionLog'; query: string; limit?: number; offset?: number }
  | { command: 'openDecision'; id: string }
  | { command: 'deleteDecision'; id: string }

  // Conventions (project memory)
  | { command: 'getConventions' }
  | { command: 'addConvention'; key: string; value: string }
  | { command: 'removeConvention'; key: string }

  // Health / Guardian
  | { command: 'getHealthSnapshot' }
  | { command: 'runHealthScan'; scope?: 'quick' | 'full' }

  // Autonomy controls
  | { command: 'setAutonomy'; autonomyLevel: AutonomyLevel }
  ;

/* -----------------------------------------------------------
 * Messages: Extension Host -> Webview
 * --------------------------------------------------------- */

export type ExtensionMessage =
  | { command: 'addMessage'; text: string; provider?: ProviderName }

  // Streaming
  | { command: 'messageStreamStart'; provider: ProviderName }
  | { command: 'messageChunk'; provider: ProviderName; chunk: string }
  | { command: 'messageStreamEnd'; provider: ProviderName; fullText: string }

  // Context
  | { command: 'contextPreview'; preview: string }

  // UI helpers
  | { command: 'insertPrompt'; prompt: string }
  | { command: 'providerStatus'; providers: ProviderStatus[]; mode: ModeInfo }
  | { command: 'requestStarted'; mode: OperatingMode }
  | { command: 'requestError'; error: string; provider?: ProviderName }
  | { command: 'modeChanged'; mode: 'guided' | 'professional' }

  // Consensus progress/logging
  | { command: 'debateProgress'; message: string; fileStatuses: FileStatusInfo[] }
  | { command: 'debateLog'; provider: ProviderName; role: string; filePath: string; round: number; text: string }
  | {
      command: 'patchPreview';
      patches: { relativePath: string; type: string; diff: string }[];
      summary: string;
      token: string;
      hasDisagreements: boolean;
      disagreementReport?: string;
    }
  | { command: 'patchResult'; applied: string[]; rejected: boolean }

  // Command preview/result
  | { command: 'commandPreview'; token: string; cmd: string; cwd: string; explanation?: string; risk: RiskLevel }
  | { command: 'commandResult'; token: string; cmd: string; cwd: string; success: boolean; message?: string }

  // Search results
  | { command: 'searchResults'; results: { file: string; relativePath: string; snippet: string }[] }

  // Debug session updates
  | { command: 'debugUpdate'; sessionId: string; update: any }

  // Line edit preview
  | { command: 'lineEditPreview'; preview: { relativePath: string; diff: string; startLine?: number; endLine?: number }; token: string }

  | { command: 'requestComplete' }

  // New chat / session history
  | { command: 'clearMessages' }
  | { command: 'sessionList'; sessions: Array<{ id: string; title: string; date: number }> }
  | { command: 'sessionLoaded'; session: SessionRecord }

  // Debate summary (visible in both guided and professional mode)
  | {
      command: 'debateSummary';
      filesDebated: number;
      roundsMax: number;
      providers: ProviderName[];
      results: Array<{ file: string; status: 'approved' | 'disagreement'; rounds: number }>;
    }

  // Think Tank OS v1
  | { command: 'intentPlanStart' }
  | { command: 'intentPlanResult'; plan: IntentPlan; goal: string }
  | { command: 'intentPlanError'; error: string }
  | { command: 'actionLog'; entries: ActionLogEntry[] }
  | { command: 'permissionsUpdated'; riskTolerance: RiskLevel; autoApprove: boolean }

  // Think Tank OS v2 (structured)
  | { command: 'councilResultStart'; id: string }
  | { command: 'councilResult'; result: CouncilResult }
  | { command: 'councilResultError'; id?: string; error: string }

  // Action plan (structured steps from Think Tank)
  | { command: 'actionPlan'; steps: ActionStep[]; goal: string }

  // Action step execution updates
  | {
      command: 'actionStepUpdate';
      stepId: string;
      status: ActionLogStatus;
      output?: string;
      message?: string;
      risk?: RiskLevel;
      artifacts?: Array<{ type: 'file' | 'command_preview' | 'text'; label: string; content: string }>;
    }
  | { command: 'actionStepResult'; stepId: string; success: boolean; output?: any; message?: string }

  // Decision log / memory
  | { command: 'decisionLog'; entries: CouncilResult[] }
  | { command: 'decisionLogResults'; total: number; records: Array<{ id: string; createdAt: number; title: string; tags?: string[] }> }
  | { command: 'decisionOpened'; record: DecisionLogRecord }
  | { command: 'decisionDeleted'; id: string }

  // Conventions (project memory)
  | { command: 'conventions'; conventions: ProjectConvention[] }

  // Health / Guardian
  | { command: 'healthSnapshot'; snapshot: HealthSnapshot }
  | { command: 'healthScanStarted'; id: string; scope: 'quick' | 'full' }
  | { command: 'healthScanComplete'; snapshot: HealthSnapshot }
  | { command: 'healthScanError'; error: string }

  // Autonomy
  | { command: 'autonomyUpdated'; autonomyLevel: AutonomyLevel }
  ;