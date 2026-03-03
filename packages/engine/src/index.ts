/**
 * @triforge/engine — public API
 *
 * Everything VS Code extension and Desktop app need from the shared engine.
 * VS Code-specific files (commands, patch, search, debugSession, actionRunner)
 * live in the vscode-ext package and are NOT exported here.
 */

// Platform adapter interface
export type { StorageAdapter } from './platform';

// Protocol — all message types and shared interfaces
export * from './protocol';

// Providers
export type { AIProvider, AIProviderConfig } from './core/providers/provider';
export { ProviderError } from './core/providers/provider';
export { OpenAIProvider } from './core/providers/openai';
export { GrokProvider } from './core/providers/grok';
export { ClaudeProvider } from './core/providers/claude';

// Core engine
export { ProviderManager } from './core/providerManager';
export { TriForgeOrchestrator } from './core/orchestrator';
export { IntentEngine } from './core/intentEngine';
export { ActionPlanner } from './core/actionPlanner';
export { DecisionLog } from './core/decisionLog';
export { Memory } from './core/memory';
export { judgeVotes, selectTiebreaker, sessionConfidence } from './core/rubric';
export { sha256 } from './core/hash';

// Workspace utilities (platform-agnostic: fs + child_process only)
export { buildContextPreview, scanWorkspace, readSafeFile } from './core/context';
export {
  buildGitContext, getGitDiff, getGitStatus,
  getGitBranch, getRecentCommits
} from './core/git';

// Types
export type { TaskResult, DebateProgress, FileChange, ReviewResult } from './core/types';

// Tools / policy
export { DEFAULT_POLICY } from './tools/index';

// ── Task Engine (Phase 3 + 3.5) ───────────────────────────────────────────────

// Types
export type {
  TaskCategory, TaskStatus, StepStatus, TrustLevel, TaskToolName, AuditEventType,
  ScheduleType, Step, Plan, Task, TrustPolicy, TrustModeSnapshot, TrustDecision,
  WalletSnapshot, SchedulerJob, AuditLedgerEntry, ToolDefinition, ToolContext,
  EngineEvent, ApprovalRequest,
} from './core/taskTypes';

// Event bus singleton + ring buffer types
export { eventBus } from './core/eventBus';
export type { EventRecord } from './core/eventBus';

// Subsystems
export { AuditLedger } from './core/auditLedger';
export { TaskStore } from './core/taskStore';
export {
  evaluateStepTrust, needsApproval, DEFAULT_TRUST_SNAPSHOT,
  validateTrustMode, buildDefaultPolicyFor,
  SAFE_AUTOPASS_TOOLS, PAPER_TRADING_ONLY,
} from './core/trustEngine';
export { WalletEngine } from './core/walletEngine';
export { Scheduler } from './core/scheduler';
export { agreementScore, mergePlans, fallbackPlan } from './core/decisionEngine';
export { ThinkTankPlanner } from './core/thinkTankPlanner';
export { AgentLoop } from './core/agentLoop';
export { ApprovalStore } from './core/approvalStore';
export { AutonomyEngine } from './core/autonomyEngine';
export type { WorkflowDefinition, WorkflowAction, TriggerCondition, ExternalActionHandler, RiskPolicy, AutonomyStatus } from './core/autonomyEngine';
export { DEFAULT_RISK_POLICY } from './core/autonomyEngine';

// Profession Engine
export { ProfessionEngine, BUILT_IN_PROFILES } from './core/professionEngine';
export type { ProfessionProfile, ISensorManager, IAutonomyEngine } from './core/professionEngine';

// Tools
export { TaskToolRegistry, createDefaultRegistry } from './tools/taskRegistry';

// Phase 4 — Real Execution
export { serviceLocator } from './core/serviceLocator';
export type { MailOptions, MailResult, TweetOptions, TweetResult } from './core/serviceLocator';
export type { ExecutionResult, ExecutionMetrics } from './core/taskTypes';

// Phase 5 — Value Engine
export { CampaignStore } from './value/campaignStore';

export { MetricsStore } from './value/metricsStore';
export { ValueEngine } from './value/valueEngine';
export { computeCampaignMetrics, aggregateMetrics } from './value/roi';
export { generateOptimization } from './value/optimization';
export type {
  CampaignType, CampaignStatus, Campaign,
  MetricsEventType, MetricsEvent,
  CampaignMetrics,
  OptimizationPriority, OptimizationResult,
} from './value/valueTypes';

// Phase 6 — Growth Engine
export { LoopStore } from './growth/loopStore';
export { LeadStore } from './growth/leadStore';
export { ContentStore } from './growth/contentStore';
export type {
  GrowthLoopType, GrowthLoopStatus, GrowthLoop, EmailTarget,
  LeadSource, LeadStatus, Lead,
  ContentType, ContentStatus, ContentItem,
  GrowthLoopMetrics,
} from './growth/growthTypes';

// Phase 7 — Compound Engine
export { StrategyStore } from './compound/strategyStore';
export { CompoundEngine } from './compound/compoundEngine';
export { computeScore, categorize, evaluate } from './compound/evaluator';
export { getScalingDecision, applyScaling } from './compound/scaler';
export type { StrategyProfile, CompoundStats } from './compound/compoundTypes';
