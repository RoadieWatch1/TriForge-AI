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

// Tool Execution Bus
export { ToolExecutionBus, getToolExecutionBus } from './execution/ToolExecutionBus';
export type { BusTask, BusResult }               from './execution/ToolExecutionBus';

// Agent Safety Guard
export { AgentSafetyGuard, getAgentSafetyGuard } from './safety/AgentSafetyGuard';

// Event Intelligence (AI observability layer)
export { EventIntelligence, getEventIntelligence } from './mind/EventIntelligence';
export type { IntelligenceInsight }                 from './mind/EventIntelligence';

// Council Executor (planning pipeline — unchanged)
export { CouncilExecutor }       from './council/CouncilExecutor';
export type { CouncilRequest, CouncilResult } from './council/CouncilExecutor';

// Specialized event buses (per-subsystem signal channels)
export { createBus }                            from './events/createBus';
export type { SubBus }                          from './events/createBus';
export { councilBus, voiceBus, plannerBus, systemBus } from './events/buses';

// Council Conversation Engine (fast conversational layer above the planner)
export { CouncilConversationEngine, isPlanningTask } from './council/CouncilConversationEngine';
export type { CouncilConversationCallbacks, CouncilConversationResult } from './council/CouncilConversationEngine';
export { synthesizeCouncil, synthesizeCouncilStream } from './council/synthesizeCouncil';
export { registerAbortController, interrupt, clearAbortControllers } from './council/interruptController';

// Task Context (session-scoped active task tracking)
export {
  updateTaskContext, getTaskContext, setTaskContext,
  clearTaskContext, buildTaskContextAddendum,
} from './context/taskContext';

// Council Router (intent-based dynamic provider selection)
export { detectIntentType, selectCouncil, routeCouncil } from './council/CouncilRouter';
export type { IntentType } from './council/CouncilRouter';

// Mission Context Manager (council project awareness — distinct from MissionManager)
export type { MissionContext } from './context/missionStore';
export { MissionContextManager } from './context/missionContextManager';

// Council Memory Graph (project knowledge — distinct from KnowledgeGraph)
export { CouncilMemoryGraph } from './memory/councilMemoryGraph';
export type { MemoryNode as CouncilMemoryNode } from './memory/councilMemoryGraph';

// Council Runtime (hot council mode + wake event relay)
export { CouncilRuntime } from './runtime/councilRuntime';

// Debate Stream Coordinator (progressive debate — partial reasoning broadcasts)
export { DebateStreamCoordinator } from './council/DebateStreamCoordinator';
export type { PartialReasoningCallback } from './council/DebateStreamCoordinator';

// Local AI Provider (Ollama / LM Studio / local inference)
export { OllamaProvider } from './core/providers/ollamaProvider';
export type { LocalProviderConfig } from './core/providers/ollamaProvider';

// Council Demo (startup demonstration sequence)
export { startCouncilDemo } from './demo/councilDemo';
export type { DemoHandle } from './demo/councilDemo';

// Insight Engine (ambient council mode)
export { InsightEngine } from './insights/InsightEngine';
export type { CouncilInsight, InsightSignal, SignalType } from './insights/InsightEngine';

// AI Mind (Persistent Background Reasoning)
export { AIMind, getAIMind }     from './mind/AIMind';
export type { MindSuggestion }   from './mind/AIMind';

// Provider Selector (Dynamic AI Routing)
export { ProviderSelector }      from './providers/providerSelector';
export type { ProviderTaskType } from './providers/providerSelector';

// Image Generation
export { ImageService }          from './image/imageService';
export { ImageHistoryStore, getImageHistoryStore } from './image/imageHistoryStore';
export { createGeneratorRouter } from './image/generatorRouter';
export { refinePrompt }          from './image/promptRefiner';
export { critiqueImages }        from './image/imageCritique';
export { STYLE_PRESETS, getStyleSuffix } from './image/styles';
export type { ImageGenerationRequest, ImageGenerationResult } from './image/imageService';
export type { ImageHistoryEntry }  from './image/imageHistoryStore';
export type { GenerateImageOptions, GeneratedImage } from './image/generatorRouter';
export type { CritiqueResult, ImageCritiqueScore } from './image/imageCritique';
export type { StylePresetKey }     from './image/styles';

// Council Awareness Layer (capability registry + live state + addendum builder)
export { CAPABILITY_REGISTRY, getCapabilityById, getCapabilitiesByCategory, searchCapabilities } from './awareness/CapabilityRegistry';
export { systemStateService }        from './awareness/SystemStateService';
export { buildCouncilAwarenessAddendum } from './awareness/CouncilAwarenessService';
export type { CapabilityDescriptor, CapabilityCategory, CapabilityRisk, SystemStateSnapshot, CouncilAwarenessPack } from './awareness/types';

// Folder Audit Engine
export { buildFolderAudit, formatAuditAsText } from './execution/buildFolderAudit';
export type { FolderAuditResult, AuditFinding } from './execution/buildFolderAudit';

// Trading types (centralized)
export type {
  LiveTradeSnapshot, ShadowTrade, ShadowAccountState, ShadowAccountSettings, CouncilVote,
  VwapRelation, BarTrend, SessionLabel, VolatilityRegime, IndicatorState,
  ShadowDecisionStage, ShadowBlockReason, ShadowDecisionEvent,
  ShadowPerformanceSummary, BucketPerformanceSummary,
  CouncilEffectivenessSummary, ShadowAnalyticsSummary,
} from './trading/types';

// Live Trade Advisor
export { buildLiveTradeAdvice, SUPPORTED_SYMBOLS, INSTRUMENT_META } from './trading/buildLiveTradeAdvice';
export type {
  TradeAdviceInput, TradeAdviceResult,
  TradeAdviceVerdict, TradeAdviceConfidence, InstrumentMeta,
} from './trading/buildLiveTradeAdvice';

// Trade level proposals
export { buildTradeLevels } from './trading/buildTradeLevels';
export type { ProposedTradeSetup, SetupType } from './trading/buildTradeLevels';

// Shadow Trading Analytics (Phase 3) — pure computation
export {
  computePerformanceSummary, computeBucketSummary, computeCouncilEffectiveness,
  computeDecisionFunnel, computeTopBlockReasons, computeFullSummary,
} from './trading/analytics';

// Trade scoring helpers (Phase 3)
export { updateExcursions, computeExcursionR } from './trading/tradeScoring';

// Strategy Refinement (Phase 4) — pure insight functions
export {
  computeSessionInsights, computeVolatilityInsights, computeVwapInsights,
  computeInstrumentInsights, computeCouncilConfidenceInsights, computeWarningInsights,
  computeRefinementSummary,
} from './trading/strategyTuning';
export type {
  InsightRecommendation, StrategyInsight, StrategyRefinementSummary,
  ShadowStrategyConfig, ShadowSymbol, StrategyConfigValidation,
} from './trading/types';
export {
  SHADOW_SUPPORTED_SYMBOLS, SESSION_LABELS, VOLATILITY_REGIMES, VWAP_RELATIONS,
  validateStrategyConfig,
} from './trading/types';

// Strategy Readiness (Phase 5) — pure evaluation, advisory only
export { evaluateReadiness } from './trading/readiness';
export type {
  StrategyReadinessState, ReadinessThresholds,
  ThresholdCheck, StabilityCheck, StrategyReadinessReport,
} from './trading/types';
export { DEFAULT_READINESS_THRESHOLDS, READINESS_STATES } from './trading/types';

// Strategy Promotion (Phase 6) — pure evaluation, manual-only
export { evaluatePromotionEligibility } from './trading/promotion';
export type {
  TradingOperationMode, ModeGuardrails, PromotionGuardrails,
  PromotionDecision, PromotionWorkflowStatus,
} from './trading/types';
export { DEFAULT_PROMOTION_GUARDRAILS, validatePromotionGuardrails } from './trading/types';

// Phase 7: Trade Explainability — pure deterministic functions
export {
  computeSetupGrade, computeAgreementLabel,
  buildTradeDecisionExplanation, buildBlockedTradeExplanation,
  computeGradeSummary, computeCouncilValueAdded,
} from './trading/tradeExplainability';
export type {
  SetupGradeInput, ExplanationInput,
} from './trading/tradeExplainability';
export type {
  SetupGrade, CouncilAgreementLabel, ConfidenceLabel,
  TradeDecisionExplanation, CouncilSummary, RuleSummary,
  BlockedTradeExplanation, GradeBucketSummary, CouncilValueAdded,
} from './trading/types';

// ── Council Workflow Pipeline ────────────────────────────────────────────────
export { CouncilWorkflowEngine } from './workflow/CouncilWorkflowEngine';
export { PlanCouncilService } from './workflow/PlanCouncilService';
export { CodeCouncilService } from './workflow/CodeCouncilService';
export { VerificationGateService } from './workflow/VerificationGateService';
export { GitWorkflowService } from './workflow/GitWorkflowService';
export { CouncilWorkflowSessionStore } from './workflow/CouncilWorkflowSessionStore';
export { MODE_CONFIGS } from './workflow/councilWorkflowTypes';
export type {
  CouncilWorkflowPhase, ExecutionMode, CouncilWorkflowAction,
  CouncilRoleType, CouncilRole, WorkflowModeConfig,
  CouncilPlan, PlanAmendment, PlanObjection, PlanReview, ApprovedPlanSnapshot,
  ImplementationFile, ImplementationSnapshot,
  CodeFinding, CodeObjection, CodeReview, ApprovedImplementation,
  VerificationCheckType, CheckConfig, VerificationCheck, VerificationResult,
  GitGateState, CommitResult, PushResult, GitStatusInfo,
  WorkflowIntake, WorkflowHistoryEntry, CouncilWorkflowSession,
  CouncilWorkflowEventType, CouncilWorkflowEvent, UserInputAction,
} from './workflow/councilWorkflowTypes';

// ── Web Search ──────────────────────────────────────────────────────────────
export { searchWeb }       from './tools/webSearch';
export type { WebSearchResult } from './tools/webSearch';
export { needsWebSearch }  from './tools/webSearchDetector';

// ── Venture Discovery + Build + Growth ──────────────────────────────────────

// Types
export type {
  VentureCategory, TrendClass, VentureMode, VentureFormationMode,
  ProposalStatus, ActionGateLevel,
  MarketSignal, VentureScores, VentureCandidate,
  SiteType, WebsitePlan, SitePage, SiteSection, SiteBuild,
  CaptureType, CaptureComponent,
  LeadCapturePlan, FollowerGrowthPlan,
  LaunchPack, VentureOption,
  TreasuryAllocation, VentureProposal,
  GrowthFunnel, First30DaysPlan, DailyPulse,
  ConversionPlan,
  FilingPacket, FilingSummary, FormationDecision,
  FounderProfile, OperatorPolicy,
  AudienceGoal, LeadCaptureAsset, SubscriberSegment, OwnedAudienceMetrics,
  VentureCategoryConfig, BrandAssets, SignupFlow, VentureProposalView,
} from './ventures/ventureTypes';

// Catalog
export { VENTURE_CATALOG, getCategoryConfig, getCategoriesForBudget } from './ventures/ventureCatalog';

// Scoring
export { scoreCandidate, classifyTrend, rankCandidates } from './ventures/ventureScoringEngine';

// Research
export { researchMarket, extractCandidates } from './ventures/ventureResearchEngine';

// Formation classifier
export { classifyFormationNeeds } from './ventures/ventureFormationClassifier';

// Council flow
export { runVentureCouncil } from './ventures/ventureCouncilFlow';

// Treasury
export { allocateBudget } from './ventures/ventureTreasury';

// Proposal formatter
export { formatForPhone, formatForDesktop } from './ventures/ventureProposalFormatter';

// Brand builder
export { buildBrand } from './ventures/ventureBrandBuilder';

// LaunchPack builder
export { buildLaunchPack } from './ventures/ventureLaunchPackBuilder';

// Conversion planner
export { planConversion } from './ventures/ventureConversionPlanner';

// Site generation
export type { SitePlan, PagePlan, CapturePointPlan, GeneratedPage } from './ventures/site/ventureSiteTypes';
export { planSite } from './ventures/site/ventureSitePlanner';
export { generateSite, renderPageToHTML } from './ventures/site/ventureSiteGenerator';
export { generatePageContent } from './ventures/site/ventureSiteContentBuilder';
export { buildCaptureComponent, getRecommendedFields } from './ventures/site/ventureLeadCaptureBuilder';

// Audience growth
export type {
  ContentCalendarEntry, AudienceSegmentTarget, LeadMagnetAsset,
  NurtureStep, NurtureSequence, GrowthSnapshot,
} from './ventures/audience/audienceTypes';
export { planAudienceGrowth } from './ventures/audience/audienceGrowthPlan';
export type { ExtendedGrowthPlan } from './ventures/audience/audienceGrowthPlan';
export { buildLeadMagnet } from './ventures/audience/leadMagnetBuilder';
export { buildSignupFlow } from './ventures/audience/signupFlowBuilder';

// Growth funnel
export { planGrowthFunnel } from './ventures/ventureGrowthFunnel';

// First 30 days
export { generateFirst30Days } from './ventures/ventureFirst30Days';

// Founder authority
export type {
  VentureActionCategory, VentureAction, GateDecision,
} from './ventures/founderAuthority/founderAuthorityTypes';
export { DEFAULT_OPERATOR_POLICY } from './ventures/founderAuthority/founderAuthorityTypes';
export { FounderAuthorityVault } from './ventures/founderAuthority/founderAuthorityVault';
export { classifyAction, canAutoExecute, getGateDecision } from './ventures/founderAuthority/operatorPolicyEngine';
export {
  getRegisteredAction, getActionsForCategory, getLegalAuthActions,
  getAutonomousActions, listActionIds,
} from './ventures/founderAuthority/actionGateClassifier';

// Filing prep
export { prepareFilingPacket, summarizeFilingNeed } from './ventures/ventureFilingPrep';

// Daily pulse
export { generateDailyPulse, formatPulseForPhone } from './ventures/ventureDailyPulse';
