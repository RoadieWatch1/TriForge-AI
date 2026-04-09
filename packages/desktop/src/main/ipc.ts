import { ipcMain, shell, dialog, app, BrowserWindow, clipboard, desktopCapturer, Notification } from 'electron';
import crypto from 'crypto';
import fs from 'fs';
import https from 'https';
import http from 'http';
import path from 'path';
import os from 'os';
import { execSync } from 'child_process';
import { Store, LedgerEntry, ForgeScore } from './store';
import { transcribeAudio, textToSpeechStream } from './voice';
import { validateLicense, loadLicense, deactivateLicense, LEMONSQUEEZY } from './license';
import type { Tier } from './license';
import { isAtMessageLimit, isAtDailyOperatorLimit, hasCapability, lockedError, getMemoryLimit, TIERS, tradingTrialStatus, FREE_DAILY_OPERATOR_RUNS } from './subscription';
import { hashPin, verifyPin, isValidPin } from './auth';
import { buildSystemPrompt } from './systemPrompt';
import { getProfile, listProfiles } from './profiles';
import { getEngineConfig, ENGINE_CONFIGS } from './engines';
import { scanForPhotos, listDirectory, organizeDirectory, organizeDirectoryDeep, searchPhotos, findSimilarPhotos, moveFiles, getCommonDirs } from './filesystem';
import { scanForDocuments, ocrFile, detectDocTypes, searchIndex, type DocEntry } from './docIndex';
import { GrokVoiceAgent } from './grokVoice';
import { listPrinters, printFile, printText } from './printer';
import { CredentialManager } from './credentials';
import type { CredentialKey } from './credentials';
import { createNotifyAdapter } from './notifications';
import { createMailAdapter } from './mailService';
import { NativeIntentRouter } from './nativeIntentRouter';
import { tradovateService } from './trading/tradovateService';
import { tastytradeProvider } from './trading/market/TastytradeMarketDataProvider';
import { TastytradeDeviceChallengeError } from './trading/tastytradeClient';
import { shadowTradingController } from './trading/shadowTradingController';
import type { CouncilReviewResult } from './trading/shadowTradingController';
import { buildCouncilContext } from './trading/council/CouncilTradeReviewContext';
import { STRUCTURE_AGENT_ROLE, STRUCTURE_AGENT_SYSTEM, buildStructureAgentPrompt } from './trading/council/StructureAgentPrompt';
import { RISK_AGENT_ROLE, RISK_AGENT_SYSTEM, buildRiskAgentPrompt } from './trading/council/RiskAgentPrompt';
import { COUNTER_CASE_AGENT_ROLE, COUNTER_CASE_AGENT_SYSTEM, buildCounterCaseAgentPrompt } from './trading/council/CounterCaseAgentPrompt';
import { computeExpectancy, computeAdvisoryTargetAnalytics, type BucketDimension } from './trading/learning/PerformanceAnalytics';
import { calibrateWeights } from './trading/learning/SetupWeightCalibrator';
import { SetupReliabilityStore } from './trading/reliability/SetupReliabilityStore';
import { shadowAnalyticsStore } from './trading/shadowAnalyticsStore';
import { PaperEngine } from './trading/paperEngine';
import { SensorManager } from './sensors/index';
import { navigate as browserNavigate, screenshot as browserScreenshot, fillForm as browserFillForm, scrape as browserScrape, closeBrowser } from './browser/index';
import { SocialPoster } from './social/index';
import { ApprovalServer } from './approvalServer';
import { PhoneLinkServer } from './phoneLink';
import { initCouncilNotify, sendRemoteUpdate } from './councilNotify';
import { evaluateProactiveOpportunity, resetProactiveCooldown } from './proactiveCouncil';
import { MissionManager } from '../core/missions/missionManager';
import { MissionStore } from '../core/missions/missionStore';
import { startWebhookServer, stopWebhookServer, isWebhookServerRunning, registerGitHubWebhookHandler, unregisterGitHubWebhookHandler } from './webhookServer';
import { ControlPlaneServer } from './controlPlane';
import { analyzeSkill, evaluateSkillPolicy } from '@triforge/engine';
import type { InboundTaskSource, InboundRiskClass, InboundTaskDecision } from '@triforge/engine';
import * as githubAdapter from './integrations/githubAdapter';
import { GitHubReviewStore } from './integrations/githubReviewStore';
import { handleGitHubWebhook } from './integrations/githubWebhook';
import { SkillStoreManager } from './skillStore';
import type { InstalledSkill } from './skillStore';
import { GovernanceStore } from './governanceStore';
import { resolveGovernance } from '@triforge/engine';
import type { GovSource, GovRiskClass } from '@triforge/engine';
import { TelegramAdapter } from './messaging/telegramAdapter';
import type { TgMessage } from './messaging/telegramAdapter';
import { SlackAdapter } from './messaging/slackAdapter';
import type { SlackMessage } from './messaging/slackAdapter';
import { DiscordAdapter } from './messaging/discordAdapter';
import type { DiscordMessage } from './messaging/discordAdapter';
import { JiraAdapter } from './jiraAdapter';
import type { JiraIssue, JiraProject, JiraTransition, JiraComment } from './jiraAdapter';
import { LinearAdapter } from './linearAdapter';
import type { LinearIssue, LinearTeam, LinearWorkflowState, LinearComment } from './linearAdapter';
import { PushNotifier, DEFAULT_EVENT_SETTINGS, ALL_NOTIFY_EVENTS, EVENT_LABELS } from './pushNotifier';
import type { NotifyEvent, NotifyPriority, NotifyProvider } from './pushNotifier';
import { BUILTIN_RECIPES } from './automationRecipes';
import { getLastProject, getContinuationSuggestion, getAllProjects, forgetProject } from './services/projectMemory';
import { PatternMemoryService } from './services/patternMemoryService';
import type { RecipeDef, RecipeState, RecipeView } from './automationRecipes';
import { WorkspaceCredentialResolver } from './workspaceCredentialResolver';
import type { IntegrationName } from './workspaceCredentialResolver';
import type { WorkspaceIntegrationConfig } from './store';
import { WorkspacePolicyEngine, DEFAULT_APPROVAL_MATRIX, categoryForSource } from './workspacePolicyEngine';
import type { ActionCategory, WorkspaceApprovalRule } from './workspacePolicyEngine';
import { WorkspaceAutomationGate } from './workspaceAutomationGate';
import { DEFAULT_AUTOMATION_POLICY } from './store';
import type { WorkspaceRecipePolicy, DelegatedOperator, WorkspaceAutomationPolicy } from './store';
import { RunbookExecutor } from './runbookExecutor';
import { RunbookScheduler } from './runbookScheduler';
import type { RunbookDef, RunbookStep, HandoffQueueItem } from './runbooks';
import { makeRunbookId, makeStepId } from './runbooks';
import type { DispatchRunbookItem, DispatchRunbookExecution, DispatchHandoffItem } from './dispatchServer';
// Phase 35 — Runbook Packs
import { buildPack, serializePack, deserializePack } from './runbookPackSerializer';
import { previewPack, installPack, uninstallPack, rollbackPack } from './runbookPackInstaller';
// Phase 36 — Pack trust, signing, and update safety
import { getOrCreateLocalKey, signPack, computeKeyId } from './packSigner';
import type { TrustedSigner } from './runbookPack';
// Phase 37 — Workspace analytics
import { generateReport, formatReportText, windowFromTs } from './analyticsEngine';
import type { AnalyticsWindow } from './analyticsEngine';
// Phase 38 — Enterprise admin + policy inheritance
import { makeOrgId, DEFAULT_ORG_POLICY } from './orgConfig';
import type { OrgConfig, OrgPolicy, OrgSignerEntry } from './orgConfig';
import { resolveOrgEffective } from './inheritanceResolver';
import { exportAuditLog, exportPolicyHistory } from './auditExporter';
import type { AuditExportFormat } from './auditExporter';
// Phase 40 — Reliability, Backup, Recovery, Migrations
import {
  createBackupFile, restoreBackupFile, getLastBackupAt,
  createSnapshot, listSnapshots, rollbackSnapshot, deleteSnapshot,
  getIncidents, recordCrash, resetIncident,
} from './backupEngine';
import { validateStore, validateAndRepairStore } from './storeValidator';
import { runMigrations, getMigrationHistory, getCurrentSchemaVersion } from './migrationEngine';
import {
  resolveRepo, resolveChannel, resolveProject,
  upsertRepo, deleteRepo, upsertChannel, deleteChannel, upsertProject, deleteProject,
} from './sharedContext';
import type { RepoMapping, ChannelMapping, ProjectNote, ContextCategory } from './sharedContext';
import { MessageLog } from './messaging/messageLog';
import { autonomyController } from '../core/autonomy/AutonomyController';
import { DispatchServer, generateDispatchToken, generateQrDataUrl } from './dispatchServer';
import type { DispatchHandlers, DispatchActionItem, DispatchHistoryEntry, DispatchRecipeItem, DispatchMissionItem, DispatchOpsOverview, RemoteActionContext, ActionResult, DispatchTask, DispatchTaskParams, DispatchTaskStep, DispatchTaskEvent, DispatchArtifact, ArtifactType, DispatchArtifactBundle, BundleDestination, BundleStatus, DispatchThread, DispatchMessage, ThreadStatus, MessageRole, CollaboratorRole, ThreadVisibility, ThreadCollaborator, ThreadInvite, ThreadComment, ApprovalAttribution, WorkspaceRole, WorkspaceMember, WorkspaceInvite, WorkspacePolicy, Workspace } from './dispatchServer';
import { DEFAULT_WORKSPACE_POLICY, WORKSPACE_ROLE_RANK } from './dispatchServer';
import {
  generatePairingCode,
  toDeviceView,
  isRiskAllowed,
} from './dispatchSession';
import type { PairedDevice, RiskLevel, PendingConfirmation, DeviceView } from './dispatchSession';
import { BlueprintLoader } from '../core/blueprints/BlueprintLoader';
import { BLUEPRINT_IDS, isValidBlueprintId } from '../core/blueprints/BlueprintRegistry';
import { applyBlueprint, deactivateBlueprint, getActiveBlueprint } from '../core/blueprints/applyBlueprint';
import { DEFAULT_BLUEPRINT } from '../core/blueprints/defaultBlueprint';
import type { BlueprintApplyContext } from '../core/blueprints/BlueprintTypes';
import { missionController } from '../core/engineering/MissionController';
import { onConsensus, onConsensusMeta } from '../core/orchestrator/CouncilDecisionBus';
import { InsightRouter } from '../core/routing/InsightRouter';
import { AUTONOMY_FLAGS } from '../core/config/autonomyFlags';
import { getToolExecutor, newRequestId } from '../core/tools/toolExecutor';
import { healthMonitor } from '../core/health/healthMonitor';
import { MemoryStore } from '../core/memory/memoryStore';
import { getMemoryManager } from '../core/memory/memoryManager';
import { ImageService, getImageHistoryStore, systemStateService, buildCouncilAwarenessAddendum, buildLiveTradeAdvice, buildTradeLevels, searchWeb, needsWebSearch, buildContextualIntelligence, buildContextualReasoningAddendum, detectOperatorIntent } from '@triforge/engine';
import type { CouncilVote } from '@triforge/engine';

import { ResultStore } from './resultStore';
import { ValueEngine, CampaignStore, MetricsStore, CompoundEngine } from '@triforge/engine';
import { GrowthService } from './growthService';
import { runCapabilityScan, inferConnectedPlatforms } from './capabilityScanner';
import { analyzeGaps, rankLanes } from './toolGapAnalyzer';
import type { ToolGap } from './toolGapAnalyzer';
import type { IncomeLaneId } from './store';
import { listForgeHubSkills, getForgeHubSkill, getSkillsForLane, getSkillMarkdown, syncBuiltinSkills } from '@triforge/engine';
import { mcpRegistry } from '@triforge/engine';
import { ExperimentManager } from './experimentManager';
import { generateRecommendations, LANE_PLATFORMS } from './incomeDecisionEngine';
import type { DecisionInput } from './incomeDecisionEngine';
import { IncomeAutopilot } from './incomeAutopilot';
import { getMachineContext } from './services/machineContext';
import { OperatorService } from './services/operatorService';
import { getLiveRunState } from './services/operatorTaskRunner';
import { setVisionApiKey } from './services/visionAnalyzer';
import { setScriptGenKey } from './services/workflowPackService';
import { buildUnrealAwarenessSnapshot } from './services/unrealAwareness';
import { buildAppAwarenessSnapshot, formatAppAwarenessSummary } from './services/appAwareness';
import { buildIOSAwarenessSnapshot, bootSimulator, captureSimulatorScreen, formatIOSSummary } from './services/iosAwareness';
import { WorkflowPackService } from './services/workflowPackService';
import { WorkflowChainService } from './services/workflowChainService';
import { WorkerRunQueue } from './workerRuntime/workerRunQueue';
import type { CreateRunOptions } from './workerRuntime/workerRunQueue';
import { initWorkflowBridge } from './workerRuntime/workflowWorkerRunBridge';
import { resumeRun as _resumeWorkerRun } from './workerRuntime/workerRunRecoveryService';
import { ok as incomeOk, fail as incomeFail } from './utils/actionResult';
import { withRetry } from './utils/retry';
import { setExperimentManager } from './systemPrompt';
import {
  ProviderManager,
  IntentEngine,
  type ProviderName,
  AgentLoop,
  AuditLedger,
  TaskStore,
  WalletEngine,
  Scheduler,
  ThinkTankPlanner,
  ApprovalStore,
  AutonomyEngine,
  ProfessionEngine,
  BUILT_IN_PROFILES,
  createDefaultRegistry,
  eventBus,
  serviceLocator,
  DEFAULT_TRUST_SNAPSHOT,
  validateTrustMode,
  PAPER_TRADING_ONLY,
  CouncilExecutor,
  ProviderSelector,
  CouncilConversationEngine,
  buildTaskContextAddendum,
  getTaskContext,
  routeCouncil,
  MissionContextManager,
  CouncilMemoryGraph,
  CouncilRuntime,
  DebateStreamCoordinator,
  OllamaProvider,
  startCouncilDemo,
  InsightEngine,
  detectIntentType,
  type CouncilMemoryNode,
  type MissionContext,
  type InsightSignal,
  type WorkflowDefinition,
  type TrustModeSnapshot,
  type TaskCategory,
  type TaskStatus,
  type EventRecord,
} from '@triforge/engine';

let providerManager: ProviderManager | null = null;
let intentEngine: IntentEngine | null = null;

// Module-level store ref — set on setupIpc, used by exported helpers
let _ipcStore: Store | null = null;

// ── Task Engine singletons (lazy-init inside handlers) ─────────────────────────
let _taskStore: TaskStore | null = null;
let _auditLedger: AuditLedger | null = null;
let _walletEngine: WalletEngine | null = null;
let _scheduler: Scheduler | null = null;
let _approvalStore: ApprovalStore | null = null;
let _agentLoop: AgentLoop | null = null;
let _credentialManager: CredentialManager | null = null;
let _resultStore: ResultStore | null = null;
let _campaignStore: CampaignStore | null = null;
let _metricsStore: MetricsStore | null = null;
let _valueEngine: ValueEngine | null = null;
let _growthService: GrowthService | null = null;
let _compoundEngine: CompoundEngine | null = null;
let _sensorManager: SensorManager | null = null;
let _autonomyEngine: AutonomyEngine | null = null;
let _professionEngine: ProfessionEngine | null = null;
let _itRegistry: import('@triforge/engine').TaskToolRegistry | null = null;
let _approvalServer: ApprovalServer | null = null;
let _registry: import('@triforge/engine').TaskToolRegistry | null = null;
let _missionStore: MissionStore | null = null;
let _missionManager: MissionManager | null = null;
let _memoryStore: MemoryStore | null = null;
let _imageService: ImageService | null = null;
let _councilExecutor: InstanceType<typeof CouncilExecutor> | null = null;
let _providerSelector: InstanceType<typeof ProviderSelector> | null = null;
let _missionCtxMgr: MissionContextManager | null = null;
let _memGraph: CouncilMemoryGraph | null = null;
let _councilRuntime: CouncilRuntime | null = null;
let _insightEngine: InsightEngine | null = null;
let _insightRouter: InsightRouter | null = null;

// ── Worker Runtime singleton (Phase 1 — durable run foundation) ──────────────
let _workerRunQueue: WorkerRunQueue | null = null;

// ── Phase 2: Control Plane singleton ────────────────────────────────────────
let _controlPlane: ControlPlaneServer | null = null;

// ── Phase 3: GitHub singletons ───────────────────────────────────────────────
let _githubReviewStore: GitHubReviewStore | null = null;
let _githubWebhookEnabled = false;

// ── Phase 5: Skill Store singleton ──────────────────────────────────────────
let _skillStoreManager: SkillStoreManager | null = null;
function _getSkillStore(): SkillStoreManager {
  if (!_skillStoreManager) _skillStoreManager = new SkillStoreManager(_getDataDir());
  return _skillStoreManager;
}

// ── Income Operator: ExperimentManager singleton ──────────────────────────────
let _experimentManager: ExperimentManager | null = null;
function _getExperimentManager(store: Store): ExperimentManager {
  if (!_experimentManager) {
    _experimentManager = new ExperimentManager(store, _getDataDir());
    setExperimentManager(_experimentManager);
  }
  return _experimentManager;
}

// ── Income Operator: Autopilot singleton (Phase 5) ────────────────────────────
let _incomeAutopilot: IncomeAutopilot | null = null;
function _getAutopilot(store: Store): IncomeAutopilot {
  if (!_incomeAutopilot) {
    // Entitlement callback — checked each cycle before creating approvals.
    // Uses sync store.get() so the autopilot loop never needs to await tier resolution.
    const canCreateApproval = () => {
      const license = store.get<{ tier?: string }>('license', {});
      const t = (license?.tier ?? 'free') as 'free' | 'pro';
      return hasCapability('INCOME_OPERATOR', t) || hasCapability('INCOME_LANES', t);
    };
    _incomeAutopilot = new IncomeAutopilot(
      store,
      _getExperimentManager(store),
      _getApprovalStore(),
      _getDataDir(),
      undefined, // use default interval
      canCreateApproval,
    );
  }
  return _incomeAutopilot;
}

// ── Phase 6: Telegram singletons ─────────────────────────────────────────────
let _telegramBot: TelegramAdapter | null = null;
const _messageLog = new MessageLog();

// ── Phase 8: Slack singletons ─────────────────────────────────────────────────
let _slackAdapter: SlackAdapter | null = null;
let _slackSummaryTimer: ReturnType<typeof setInterval> | null = null;

// ── Phase 12: Discord singleton ───────────────────────────────────────────────
let _discordAdapter: DiscordAdapter | null = null;

// ── Phase 13: Automation Recipe timers ────────────────────────────────────────
const _recipeTimers: Map<string, ReturnType<typeof setInterval>> = new Map();

// ── Phase 17: TriForge Dispatch singleton ──────────────────────────────────────
let _dispatchServer: DispatchServer | null = null;

// ── Phase 33: Runbook Scheduler singleton ─────────────────────────────────────
let _runbookScheduler: RunbookScheduler | null = null;

// ── Phase 15: Action Center — acknowledged in-memory set ──────────────────────
// Items from immutable sources (blocked audit events, failed push, message log)
// are acknowledged by adding their prefixed ID here. Cleared on restart.
const _acknowledgedActionIds: Set<string> = new Set();

// ── Phase 9: Jira singletons ──────────────────────────────────────────────────

interface JiraQueuedAction {
  id:           string;
  type:         'comment' | 'create' | 'transition' | 'update';
  issueKey?:    string;
  projectKey?:  string;
  issueTypeId?: string;
  summary:      string;      // human-readable label for the queue
  body:         string;      // draft text / description / comment body
  transitionId?: string;
  toStatus?:     string;
  status:       'pending' | 'approved' | 'dismissed';
  createdAt:    number;
  processedAt?: number;
}

class JiraActionQueue {
  private _items: JiraQueuedAction[] = [];
  private _seq = 0;

  enqueue(action: Omit<JiraQueuedAction, 'id' | 'status' | 'createdAt'>): JiraQueuedAction {
    const item: JiraQueuedAction = { ...action, id: `jq_${++this._seq}`, status: 'pending', createdAt: Date.now() };
    this._items.push(item);
    if (this._items.length > 200) this._items.shift();
    return item;
  }

  approve(id: string): JiraQueuedAction | null {
    const item = this._items.find(i => i.id === id);
    if (!item || item.status !== 'pending') return null;
    item.status = 'approved';
    item.processedAt = Date.now();
    return item;
  }

  dismiss(id: string): boolean {
    const item = this._items.find(i => i.id === id);
    if (!item || item.status !== 'pending') return false;
    item.status = 'dismissed';
    item.processedAt = Date.now();
    return true;
  }

  list(includeProcessed = false): JiraQueuedAction[] {
    return includeProcessed
      ? [...this._items].reverse()
      : this._items.filter(i => i.status === 'pending').reverse();
  }
}

let _jiraActionQueue: JiraActionQueue | null = null;
function _getJiraQueue(): JiraActionQueue {
  if (!_jiraActionQueue) _jiraActionQueue = new JiraActionQueue();
  return _jiraActionQueue;
}

function _getJiraAdapter(): JiraAdapter | null {
  return null;
}

// ── Phase 11: Linear action queue ─────────────────────────────────────────────

interface LinearQueuedAction {
  id:          string;
  type:        'comment' | 'create' | 'update';
  issueId?:    string;
  teamId?:     string;
  summary:     string;
  body:        string;
  // update-specific
  stateId?:    string;
  assigneeId?: string;
  priority?:   number;
  status:      'pending' | 'approved' | 'dismissed';
  createdAt:   number;
  processedAt?: number;
}

class LinearActionQueue {
  private _items: LinearQueuedAction[] = [];
  private _seq = 0;

  enqueue(action: Omit<LinearQueuedAction, 'id' | 'status' | 'createdAt'>): LinearQueuedAction {
    const item: LinearQueuedAction = { ...action, id: `lq_${++this._seq}`, status: 'pending', createdAt: Date.now() };
    this._items.push(item);
    if (this._items.length > 200) this._items.shift();
    return item;
  }

  approve(id: string): LinearQueuedAction | null {
    const item = this._items.find(i => i.id === id);
    if (!item || item.status !== 'pending') return null;
    item.status = 'approved';
    item.processedAt = Date.now();
    return item;
  }

  dismiss(id: string): boolean {
    const item = this._items.find(i => i.id === id);
    if (!item || item.status !== 'pending') return false;
    item.status = 'dismissed';
    item.processedAt = Date.now();
    return true;
  }

  list(includeProcessed = false): LinearQueuedAction[] {
    return includeProcessed
      ? [...this._items].reverse()
      : this._items.filter(i => i.status === 'pending').reverse();
  }
}

let _linearActionQueue: LinearActionQueue | null = null;
function _getLinearQueue(): LinearActionQueue {
  if (!_linearActionQueue) _linearActionQueue = new LinearActionQueue();
  return _linearActionQueue;
}

// ── Phase 10: Push Notification singleton ─────────────────────────────────────
const _pushNotifier = new PushNotifier();

async function _refreshPushConfig(): Promise<void> {
  // Phase 28: prefer workspace push credentials if configured
  const wsResult = await _getWsCredResolver().resolve('push');
  let pushProvider: string;
  let ntfyTopic: string | undefined;
  let ntfyServer: string | undefined;
  let ntfyToken:  string | undefined;
  let pushoverApp: string | undefined;
  let pushoverUser: string | undefined;

  if (wsResult.scopeUsed === 'workspace') {
    pushProvider = wsResult.pushProvider ?? 'disabled';
    ntfyTopic    = wsResult.pushTopic;
    ntfyServer   = wsResult.pushServer;
    ntfyToken    = wsResult.token;
    pushoverApp  = wsResult.pushoverApp;
    pushoverUser = wsResult.pushoverUser;
    _getAuditLedger().log('WS_INTEGRATION_USED', {
      metadata: { integration: 'push', scope: 'workspace', fallbackUsed: wsResult.fallbackUsed, workspaceId: _ipcStore!.getWorkspace()?.id },
    });
  } else {
    const creds = new CredentialManager(_ipcStore!);
    pushProvider  = _ipcStore!.getPushProvider();
    ntfyTopic     = _ipcStore!.getPushNtfyTopic();
    ntfyServer    = _ipcStore!.getPushNtfyServer();
    ntfyToken     = await creds.get('ntfy_token');
    pushoverApp   = await creds.get('pushover_app_token');
    pushoverUser  = _ipcStore!.getPushoverUserKey();
  }

  _pushNotifier.configure({
    provider:    pushProvider as 'ntfy' | 'pushover' | 'disabled',
    ntfyTopic:   ntfyTopic   ?? '',
    ntfyServer:  ntfyServer  || 'https://ntfy.sh',
    ntfyToken,
    pushoverApp,
    pushoverUser: pushoverUser ?? '',
  });
  const saved = _ipcStore!.getPushEventSettings();
  if (Object.keys(saved).length > 0) {
    _pushNotifier.setAllEventSettings(saved as Record<NotifyEvent, { enabled: boolean; priority: NotifyPriority }>);
  }
}

// ── Phase 7: Governance singleton ────────────────────────────────────────────
let _governanceStore: GovernanceStore | null = null;
function _getGovernanceStore(): GovernanceStore {
  if (!_governanceStore) _governanceStore = new GovernanceStore(_getDataDir());
  return _governanceStore;
}

// ── Learning / Expert / Evolution / Placement singletons ────────────────────
let _learningOrchestrator: InstanceType<typeof import('@triforge/engine').LearningOrchestrator> | null = null;
let _expertRegistry: InstanceType<typeof import('@triforge/engine').ExpertRegistry> | null = null;
let _expertPerformanceTracker: InstanceType<typeof import('@triforge/engine').ExpertPerformanceTracker> | null = null;
let _expertRouter: InstanceType<typeof import('@triforge/engine').ExpertRouter> | null = null;
let _expertRosterLedger: InstanceType<typeof import('@triforge/engine').ExpertRosterLedger> | null = null;
let _expertWorkforceEngine: InstanceType<typeof import('@triforge/engine').ExpertWorkforceEngine> | null = null;
let _expertHiringEngine: InstanceType<typeof import('@triforge/engine').ExpertHiringEngine> | null = null;
let _expertPromotionEngine: InstanceType<typeof import('@triforge/engine').ExpertPromotionEngine> | null = null;
let _expertReplacementEngine: InstanceType<typeof import('@triforge/engine').ExpertReplacementEngine> | null = null;
let _evolutionOrchestrator: InstanceType<typeof import('@triforge/engine').EvolutionOrchestrator> | null = null;
let _expertTrafficController: InstanceType<typeof import('@triforge/engine').ExpertTrafficController> | null = null;
let _expertLoadTracker: InstanceType<typeof import('@triforge/engine').ExpertLoadTracker> | null = null;
let _placementLearningBridge: InstanceType<typeof import('@triforge/engine').PlacementLearningBridge> | null = null;
// LearningEvolutionBridge — deferred (Fix 14): bridge has internal issues
// (accesses private _registry, wrong field paths on RosterHealthSummary).
// Wiring it now would cause runtime errors. Defer until bridge internals are fixed.

// ── Vibe Coding singletons ──────────────────────────────────────────────────
let _vibeProfileStore: InstanceType<typeof import('@triforge/engine').VibeProfileStore> | null = null;
let _vibeBuildPlanner: InstanceType<typeof import('@triforge/engine').VibeBuildPlanner> | null = null;
let _vibeConsistencyChecker: InstanceType<typeof import('@triforge/engine').VibeConsistencyChecker> | null = null;
let _vibeOutcomeScorer: InstanceType<typeof import('@triforge/engine').VibeOutcomeScorer> | null = null;
let _vibePatchPlanner: InstanceType<typeof import('@triforge/engine').VibePatchPlanner> | null = null;

// ── Council Awareness — module-level state for registered getters ─────────────
let _cachedTier: Tier = 'free';
let _phoneLinkRef: PhoneLinkServer | null = null;
let _cachedMailConfigured = false;
let _cachedTwitterConfigured = false;

function _getMissionCtxMgr(store: Store): MissionContextManager {
  if (!_missionCtxMgr) _missionCtxMgr = new MissionContextManager(store);
  return _missionCtxMgr;
}

function _getMemGraph(store: Store): CouncilMemoryGraph {
  if (!_memGraph) _memGraph = new CouncilMemoryGraph(store);
  return _memGraph;
}

async function _getImageService(store: Store): Promise<ImageService> {
  if (_imageService) return _imageService;
  const openAiKey  = (await store.getSecret('triforge.openai.apiKey'))  ?? undefined;
  const grokKey    = (await store.getSecret('triforge.grok.apiKey'))    ?? undefined;
  const claudeKey  = (await store.getSecret('triforge.claude.apiKey'))  ?? undefined;
  const histStore  = getImageHistoryStore(_getDataDir());

  // Build refine / critique providers (text-only, no image generation)
  let refineProvider:   import('@triforge/engine').AIProvider | null = null;
  let critiqueProvider: import('@triforge/engine').AIProvider | null = null;
  if (claudeKey) {
    const { ClaudeProvider } = await import('@triforge/engine');
    refineProvider   = new ClaudeProvider({ apiKey: claudeKey });
    critiqueProvider = refineProvider;
  } else if (openAiKey) {
    const { OpenAIProvider } = await import('@triforge/engine');
    refineProvider   = new OpenAIProvider({ apiKey: openAiKey });
    critiqueProvider = refineProvider;
  }

  _imageService = new ImageService(refineProvider, critiqueProvider, openAiKey, grokKey, histStore);
  return _imageService;
}

function _getDataDir(): string {
  return app.getPath('userData');
}

function _getProviderSelector(): InstanceType<typeof ProviderSelector> {
  if (!_providerSelector) {
    if (!providerManager) throw new Error('ProviderManager not initialized');
    _providerSelector = new ProviderSelector(providerManager);
  }
  return _providerSelector;
}

async function _getCouncilExecutor(): Promise<InstanceType<typeof CouncilExecutor>> {
  if (_councilExecutor) return _councilExecutor;
  if (!providerManager) throw new Error('ProviderManager not ready');
  const sel    = _getProviderSelector();
  const { analyzer, critic } = await sel.selectCouncil();
  const planner = new ThinkTankPlanner(providerManager);
  _councilExecutor = new CouncilExecutor(analyzer, critic, planner);
  return _councilExecutor;
}

function _getCredentialManager(store: Store): CredentialManager {
  if (!_credentialManager) _credentialManager = new CredentialManager(store);
  return _credentialManager;
}

let _wsCredResolver: WorkspaceCredentialResolver | null = null;
function _getWsCredResolver(): WorkspaceCredentialResolver {
  if (!_wsCredResolver) _wsCredResolver = new WorkspaceCredentialResolver(_ipcStore!);
  return _wsCredResolver;
}

let _wsPolicyEngine: WorkspacePolicyEngine | null = null;
function _getPolicyEngine(): WorkspacePolicyEngine {
  if (!_wsPolicyEngine) _wsPolicyEngine = new WorkspacePolicyEngine(_ipcStore!);
  return _wsPolicyEngine;
}

let _wsAutomationGate: WorkspaceAutomationGate | null = null;
function _getAutomationGate(): WorkspaceAutomationGate {
  if (!_wsAutomationGate) _wsAutomationGate = new WorkspaceAutomationGate(_ipcStore!);
  return _wsAutomationGate;
}


function _getResultStore(): ResultStore {
  if (!_resultStore) _resultStore = new ResultStore();
  return _resultStore;
}

function _getCampaignStore(): CampaignStore {
  if (!_campaignStore) _campaignStore = new CampaignStore(_getDataDir());
  return _campaignStore;
}

function _getMetricsStore(): MetricsStore {
  if (!_metricsStore) _metricsStore = new MetricsStore(_getDataDir());
  return _metricsStore;
}

function _getValueEngine(): ValueEngine {
  if (!_valueEngine) {
    _valueEngine = new ValueEngine(_getMetricsStore(), _getCampaignStore());
    _valueEngine.start();
  }
  return _valueEngine;
}

function _getCompoundEngine(): CompoundEngine {
  if (!_compoundEngine) _compoundEngine = new CompoundEngine(_getDataDir(), () => providerManager);
  return _compoundEngine;
}

function _getGrowthService(): GrowthService {
  if (!_growthService) {
    _growthService = new GrowthService(_getDataDir(), () => providerManager, _getCompoundEngine());
  }
  return _growthService;
}

function _getTaskStore(): TaskStore {
  if (!_taskStore) {
    _taskStore = new TaskStore(_getDataDir());
    _taskStore.loadAll();
  }
  return _taskStore;
}

function _getAuditLedger(): AuditLedger {
  if (!_auditLedger) _auditLedger = new AuditLedger(_getDataDir());
  return _auditLedger;
}

function _getWalletEngine(store: Store): WalletEngine {
  if (!_walletEngine) _walletEngine = new WalletEngine(store);
  return _walletEngine;
}

function _getScheduler(): Scheduler {
  if (!_scheduler) {
    _scheduler = new Scheduler(_getDataDir());
  }
  return _scheduler;
}

function _getApprovalStore(): ApprovalStore {
  if (!_approvalStore) _approvalStore = new ApprovalStore(_getDataDir());
  return _approvalStore;
}

function _getRegistry(): import('@triforge/engine').TaskToolRegistry {
  if (!_registry) _registry = createDefaultRegistry();
  return _registry;
}

function _getAgentLoop(store: Store): AgentLoop {
  if (!_agentLoop) {
    if (!providerManager) throw new Error('ProviderManager not ready');
    const planner = new ThinkTankPlanner(providerManager);
    _agentLoop = new AgentLoop(
      _getTaskStore(),
      planner,
      _getRegistry(),
      _getWalletEngine(store),
      _getAuditLedger(),
      _getApprovalStore(),
    );
  }
  return _agentLoop;
}

function _getMissionStore(): MissionStore {
  if (!_missionStore) _missionStore = new MissionStore(_getDataDir());
  return _missionStore;
}

function _getWorkerRunQueue(): WorkerRunQueue {
  if (!_workerRunQueue) {
    _workerRunQueue = new WorkerRunQueue(_getDataDir());
    _workerRunQueue.init(); // load from disk + hydrate unfinished runs
  }
  return _workerRunQueue;
}

function _getMissionManager(store: Store): MissionManager {
  if (!_missionManager) {
    _missionManager = new MissionManager(_getMissionStore(), _getAgentLoop(store));
  }
  return _missionManager;
}

function _getMemoryStore(): MemoryStore {
  if (!_memoryStore) _memoryStore = new MemoryStore(_getDataDir());
  return _memoryStore;
}

function _getMemoryManagerInstance(): ReturnType<typeof getMemoryManager> {
  return getMemoryManager(_getMemoryStore());
}

// ── Learning / Expert / Evolution / Placement lazy-init getters ──────────────

function _getLearningOrchestrator(store: Store): InstanceType<typeof import('@triforge/engine').LearningOrchestrator> {
  if (_learningOrchestrator) return _learningOrchestrator;
  const { LearningOrchestrator } = require('@triforge/engine');
  _learningOrchestrator = new LearningOrchestrator(store);
  _learningOrchestrator!.initialize(); // sync
  return _learningOrchestrator!;
}

function _getExpertRosterLedger(): InstanceType<typeof import('@triforge/engine').ExpertRosterLedger> {
  if (_expertRosterLedger) return _expertRosterLedger;
  const { ExpertRosterLedger } = require('@triforge/engine');
  _expertRosterLedger = new ExpertRosterLedger(_getDataDir());
  return _expertRosterLedger!;
}

function _getExpertWorkforceEngine(store: Store): InstanceType<typeof import('@triforge/engine').ExpertWorkforceEngine> {
  if (_expertWorkforceEngine) return _expertWorkforceEngine;
  const { ExpertRegistry, ExpertRouter, ExpertPerformanceTracker, ExpertWorkforceEngine,
          ExpertHiringEngine, ExpertPromotionEngine, ExpertReplacementEngine } = require('@triforge/engine');
  _expertRegistry = new ExpertRegistry(store);
  _expertRegistry!.initialize(); // sync
  _expertPerformanceTracker = new ExpertPerformanceTracker(store); // no initialize()
  _expertRouter = new ExpertRouter(_expertRegistry!, _expertPerformanceTracker!);
  _expertWorkforceEngine = new ExpertWorkforceEngine(
    _expertRegistry!, _expertRouter!, _expertPerformanceTracker!, store,
  );

  // Fix 7: Wire lifecycle engines (hiring, promotion, replacement)
  const ledger = _getExpertRosterLedger();
  _expertHiringEngine = new ExpertHiringEngine(_expertRegistry!, _expertPerformanceTracker!, ledger, store);
  _expertPromotionEngine = new ExpertPromotionEngine(_expertRegistry!, _expertPerformanceTracker!, ledger);
  _expertReplacementEngine = new ExpertReplacementEngine(_expertRegistry!, _expertPerformanceTracker!, ledger);

  return _expertWorkforceEngine!;
}

async function _getEvolutionOrchestrator(store: Store): Promise<InstanceType<typeof import('@triforge/engine').EvolutionOrchestrator>> {
  if (_evolutionOrchestrator) return _evolutionOrchestrator;
  const { EvolutionOrchestrator } = require('@triforge/engine');
  _evolutionOrchestrator = new EvolutionOrchestrator(store, _getDataDir());
  await _evolutionOrchestrator!.initialize(); // async
  return _evolutionOrchestrator!;
}

async function _getExpertTrafficController(store: Store): Promise<InstanceType<typeof import('@triforge/engine').ExpertTrafficController>> {
  if (_expertTrafficController) return _expertTrafficController;
  const {
    ExpertLoadTracker, ChipCapacityMonitor,
    ExpertPlacementEngine, ExpertMigrationManager,
    ExpertTrafficController, EvolutionAuditLedger,
    PlacementLearningBridge,
  } = require('@triforge/engine');

  const loadTracker = new ExpertLoadTracker(store);
  _expertLoadTracker = loadTracker;
  const capacityMonitor = new ChipCapacityMonitor(store);
  const placementEngine = new ExpertPlacementEngine(loadTracker, capacityMonitor);
  const auditLedger = new EvolutionAuditLedger(_getDataDir());
  const migrationManager = new ExpertMigrationManager(loadTracker, capacityMonitor, auditLedger);

  _expertTrafficController = new ExpertTrafficController(
    placementEngine, loadTracker, capacityMonitor, migrationManager, auditLedger,
  );
  _expertTrafficController!.initialize(); // starts rebalance interval

  // Wire PlacementLearningBridge (connects Placement ↔ Learning ↔ Evolution)
  const learning = _getLearningOrchestrator(store);
  const evolution = await _getEvolutionOrchestrator(store);
  _placementLearningBridge = new PlacementLearningBridge(
    learning, evolution, loadTracker, capacityMonitor,
  );
  _placementLearningBridge!.initialize(); // Fix 8: was missing — registers placement lanes in evolution tracker

  return _expertTrafficController!;
}

function _getVibeProfileStore(store: Store): InstanceType<typeof import('@triforge/engine').VibeProfileStore> {
  if (_vibeProfileStore) return _vibeProfileStore;
  const { VibeProfileStore } = require('@triforge/engine');
  _vibeProfileStore = new VibeProfileStore(store);
  return _vibeProfileStore!;
}

function _getVibeBuildPlanner(): InstanceType<typeof import('@triforge/engine').VibeBuildPlanner> {
  if (_vibeBuildPlanner) return _vibeBuildPlanner;
  const { VibeBuildPlanner } = require('@triforge/engine');
  _vibeBuildPlanner = new VibeBuildPlanner();
  return _vibeBuildPlanner!;
}

function _getVibePatchPlanner(store: Store): InstanceType<typeof import('@triforge/engine').VibePatchPlanner> {
  if (_vibePatchPlanner) return _vibePatchPlanner;
  const { VibePatchPlanner, VibeConsistencyChecker, VibeOutcomeScorer } = require('@triforge/engine');
  if (!_vibeConsistencyChecker) _vibeConsistencyChecker = new VibeConsistencyChecker();
  if (!_vibeOutcomeScorer) _vibeOutcomeScorer = new VibeOutcomeScorer();
  _vibePatchPlanner = new VibePatchPlanner(_vibeConsistencyChecker!, _getVibeBuildPlanner());
  return _vibePatchPlanner!;
}

// Trust config stored in KV store
const TRUST_KEY = 'triforge.trustConfig';

// ── Input validation ──────────────────────────────────────────────────────────

const MAX_MESSAGE_CHARS  = 32_000;   // ~8k tokens — generous but bounded
const MAX_HISTORY_TURNS  = 200;      // max conversation turns passed from renderer
const MAX_HISTORY_CHARS  = 200_000;  // total chars across all history messages
const MAX_MEMORY_CHARS   = 2_000;    // per memory entry

function validateChat(message: unknown, history: unknown): string | null {
  if (typeof message !== 'string')        return 'Invalid message type.';
  if (message.trim().length === 0)        return 'Message is empty.';
  if (message.length > MAX_MESSAGE_CHARS) return `Message too long (max ${MAX_MESSAGE_CHARS} chars).`;
  if (!Array.isArray(history))            return 'Invalid history.';
  if (history.length > MAX_HISTORY_TURNS) return `History too long (max ${MAX_HISTORY_TURNS} turns).`;
  const totalChars = history.reduce((n, m) => n + (typeof m?.content === 'string' ? m.content.length : 0), 0);
  if (totalChars > MAX_HISTORY_CHARS)     return `History too large (max ${MAX_HISTORY_CHARS} chars total).`;
  return null;
}

// ── Ledger export helpers ──────────────────────────────────────────────────
function formatLedgerMarkdown(entries: LedgerEntry[]): string {
  return entries.map(e => {
    const date = new Date(e.timestamp).toLocaleString();
    const meta = e.forgeScore ? ` · Risk: ${e.forgeScore.risk} · Confidence: ${e.forgeScore.confidence}%` : '';
    const parts: string[] = [
      `# ${e.workflow ? `[${e.workflow}] ` : ''}${e.request.slice(0, 80)}`,
      `*${date}${meta}*`,
      '', '## Synthesis', e.synthesis,
    ];
    if (e.forgeScore) {
      const sc = e.forgeScore;
      parts.push('', '## Forge Score',
        `- **Confidence:** ${sc.confidence}%`, `- **Risk:** ${sc.risk}`,
        `- **Agreement:** ${sc.agreement}`, `- **Disagreement:** ${sc.disagreement}`,
        `- **Assumptions:** ${sc.assumptions}`, `- **Verify:** ${sc.verify}`);
    }
    if (e.responses?.length) {
      parts.push('', '## Individual AI Responses',
        ...e.responses.map(r => `### ${r.provider}\n${r.text}`));
    }
    return parts.join('\n');
  }).join('\n\n---\n\n');
}

function ledgerMarkdownToHtml(md: string): string {
  const body = md
    .replace(/^# (.+)$/gm, '<h1>$1</h1>')
    .replace(/^## (.+)$/gm, '<h2>$1</h2>')
    .replace(/^### (.+)$/gm, '<h3>$1</h3>')
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/^- (.+)$/gm, '<li>$1</li>')
    .replace(/^---$/gm, '<hr>')
    .replace(/\n/g, '<br>');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>
    body{font-family:Georgia,serif;max-width:800px;margin:40px auto;color:#111;font-size:15px;line-height:1.7}
    h1{color:#f97316;font-size:20px;margin-top:40px}h2{border-bottom:1px solid #ddd;padding-bottom:4px;color:#333}
    h3{color:#555}li{margin:4px 0}hr{border:none;border-top:1px solid #ddd;margin:32px 0}
    em{color:#666;font-size:13px}strong{color:#111}
  </style></head><body>${body}</body></html>`;
}

export function setupIpc(store: Store): void {
  _ipcStore = store;

  // ── Runbook executor factory (needs inner-scope helpers _executeRecipe etc.) ─
  function _buildRunbookExecutor(): RunbookExecutor {
    return new RunbookExecutor(_ipcStore!, {
      async runRecipe(id, via) {
        return _executeRecipe(id, { source: via }, { isAdmin: true });
      },
      async runMission(id) {
        try {
          await _getMissionManager(_ipcStore!).runMission(id);
          return { ok: true };
        } catch (e: unknown) {
          return { ok: false, error: e instanceof Error ? e.message : String(e) };
        }
      },
      async sendSlack(channel, text) {
        try {
          if (!_slackAdapter) return { ok: false, error: 'Slack not configured' };
          const ok = await _slackAdapter.postMessage(channel, text);
          return { ok };
        } catch (e: unknown) {
          return { ok: false, error: e instanceof Error ? e.message : String(e) };
        }
      },
      async createJira(projectKey, issueType, summary, body) {
        try {
          const adapter = await _buildJiraAdapter();
          if (!adapter) return { ok: false, error: 'Jira not configured' };
          await adapter.createIssue(projectKey, issueType, summary, body);
          return { ok: true };
        } catch (e: unknown) {
          return { ok: false, error: e instanceof Error ? e.message : String(e) };
        }
      },
      async createLinear(teamId, title, description) {
        try {
          const adapter = await _buildLinearAdapter();
          if (!adapter) return { ok: false, error: 'Linear not configured' };
          await adapter.createIssue({ teamId, title, description });
          return { ok: true };
        } catch (e: unknown) {
          return { ok: false, error: e instanceof Error ? e.message : String(e) };
        }
      },
      async notifyPush(title, body) {
        try {
          const ok = await _pushNotifier.fire('runbook', title, body);
          return { ok };
        } catch (e: unknown) {
          return { ok: false, error: e instanceof Error ? e.message : String(e) };
        }
      },
      addHandoffItem(item: HandoffQueueItem) {
        _ipcStore!.addHandoffItem(item);
      },
      resolveHandoffItem(id: string, resolution: string, resolvedBy?: string) {
        return _ipcStore!.resolveHandoffItem(id, resolution, resolvedBy);
      },
      auditLog(type, meta) {
        _getAuditLedger().log(type as any, { metadata: meta });
      },
    });
  }

  // ── Skill registry: sync ForgeHub built-ins on startup ─────────────────────
  try { syncBuiltinSkills(_getSkillStore() as never); } catch { /* non-fatal */ }

  // ── Phase 10: init push notifier from persisted config ─────────────────────
  void _refreshPushConfig();

  // ── Phase 10: eventBus → push notification hooks ───────────────────────────
  eventBus.onAny((event) => {
    const e = event as Record<string, unknown>;
    if (e.type === 'TASK_COMPLETED') {
      void _pushNotifier.fire('task_completed', 'Task Completed', String(e.goal ?? e.taskId ?? 'A task finished').slice(0, 100));
    }
  });

  // ── Bootstrap engine on first call ─────────────────────────────────────────
  async function getEngine() {
    if (!providerManager) {
      providerManager = new ProviderManager(store);
    }
    if (!intentEngine) {
      const providers = await providerManager.getActiveProviders();
      intentEngine = new IntentEngine(providers);
    }
    return { providerManager, intentEngine };
  }

  // ── Phase 4: Register service locator adapters ────────────────────────────
  // These are registered once at startup; engine tools use them for real execution
  const credMgr = _getCredentialManager(store);
  const resultSt = _getResultStore();

  serviceLocator.registerMailSender(createMailAdapter(credMgr));
  serviceLocator.registerNotifier(createNotifyAdapter());
  serviceLocator.registerResultLogger(resultSt.createLoggerAdapter());
  serviceLocator.registerResultQuerier(resultSt.createQuerierAdapter());
  serviceLocator.registerCredentialGetter((name: string) => credMgr.getByName(name));

  // ── Council Awareness — register live state getters (called once at startup) ─
  systemStateService.registerTierGetter(() => _cachedTier);
  systemStateService.registerProfileGetter(() => store.getActiveProfileId());
  systemStateService.registerMissionGetter(() => _missionCtxMgr ? _getMissionCtxMgr(store).get()?.mission ?? null : null);
  systemStateService.registerAutonomyGetter(() => {
    if (!_autonomyEngine) return { running: false, workflowCount: 0 };
    const s = _autonomyEngine.getStatus();
    return { running: s.running, workflowCount: s.workflowCount };
  });
  systemStateService.registerProvidersGetter(async () => {
    const openai = !!(await store.getSecret('triforge.openai.apiKey'));
    const claude = await store.getSecret('triforge.claude.apiKey');
    const grok   = !!(await store.getSecret('triforge.grok.apiKey'));
    const ollama = !!(await store.getSecret('triforge.ollama.url'));
    // Eagerly wire Claude key into vision analyzer and script generator so they
    // work whenever a key is present, not just when task:run is called.
    if (claude) { setVisionApiKey(claude); setScriptGenKey(claude); }
    // Refresh mail/twitter as side-effect — this getter is already async per turn
    const cm = _getCredentialManager(store);
    const [smtp, twit] = await Promise.all([cm.getSmtp(), cm.getTwitter()]);
    _cachedMailConfigured    = smtp !== null;
    _cachedTwitterConfigured = twit !== null;
    return { openai, claude: !!claude, grok, ollama };
  });
  systemStateService.registerImageGetter(() => {
    // imageReady: at least one image-capable key present (check via cached image service or providers)
    return !!_imageService;
  });
  systemStateService.registerPhoneGetter(() => (_phoneLinkRef?.status().pairedDevices ?? 0) > 0);
  systemStateService.registerApprovalsGetter(() => (_approvalStore ? _getApprovalStore().listPending().length : 0));
  systemStateService.registerTasksGetter(() => (_taskStore ? _getTaskStore().list().filter(t => t.status === 'queued').length : 0));
  systemStateService.registerPermissionsGetter(() => {
    const perms = store.getPermissions();
    const granted = (key: string) => perms.find(p => p.key === key)?.granted ?? false;
    return { files: granted('files'), browser: granted('browser'), printer: granted('printer'), email: granted('email_s') };
  });
  systemStateService.registerMailGetter(() => _cachedMailConfigured);
  systemStateService.registerTwitterGetter(() => _cachedTwitterConfigured);
  systemStateService.registerVoiceAuthGetter(() => false); // voice passphrase auth removed
  systemStateService.registerTradingGetter(() => {
    const connected = tradovateService.status().connected;
    const state = shadowTradingController.getState();
    const mode = state.enabled ? shadowTradingController.getOperationMode() : 'off';
    return { connected, mode: mode as 'off' | 'shadow' | 'paper' | 'guarded_live_candidate' };
  });

  // Desktop operator state — injected into every Council awareness pack
  systemStateService.registerOperatorStateGetter(async () => {
    try {
      const capMap  = await OperatorService.getCapabilityMap();
      const enabled = OperatorService.isOperatorEnabled();

      const available:    string[] = [];
      const missing:      string[] = [];
      const permGranted:  string[] = [];
      const permMissing:  string[] = [];

      if (capMap.platform === 'macOS' || capMap.platform === 'Windows') {
        if (capMap.canListRunningApps) available.push('list_apps');
        if (capMap.canGetFrontmostApp) available.push('get_frontmost');
        if (capMap.canFocusApp)        available.push('focus_app');

        if (capMap.canCaptureScreen)   available.push('screenshot');
        else                           missing.push('screenshot');

        if (capMap.canTypeText)        available.push('type_text');
        else                           missing.push('type_text');
        if (capMap.canSendKeystroke)   available.push('send_key');
        else                           missing.push('send_key');

        if (capMap.platform === 'macOS') {
          if (capMap.accessibilityGranted)    permGranted.push('accessibility');
          else                                permMissing.push('accessibility');
          if (capMap.screenRecordingGranted)  permGranted.push('screen_recording');
          else                                permMissing.push('screen_recording');
        }
        // Windows: no separate permission grants needed — PowerShell has native access
      }

      // ── Phase 2 Step 3: richer runtime signals ───────────────────────────
      // Derive preflight readiness from the last known capability snapshot.
      // getLastKnownCapabilities() returns null until the first action probe.
      const lastCap   = OperatorService.getLastKnownCapabilities();
      const drift     = OperatorService.getPermissionDriftState();
      const hasDrift  = drift.accessibilityRevoked || drift.screenRecordingRevoked;

      // Preflight readiness:
      //   blocked  — any permission drift detected (was granted, now revoked)
      //   blocked  — input actions required but accessibility is missing
      //   degraded — some non-input capability missing (screen recording only)
      //   ready    — all needed permissions satisfied
      //   undefined — never probed yet (lastCap is null)
      let preflightReadiness: 'ready' | 'degraded' | 'blocked' | undefined;
      if (capMap.platform === 'Windows') {
        // Windows uses PowerShell — no separate OS permission grants required.
        // Readiness is driven by whether capabilities are available (PowerShell probe).
        preflightReadiness = capMap.canCaptureScreen ? 'ready' : 'degraded';
      } else if (lastCap !== null) {
        if (hasDrift) {
          preflightReadiness = 'blocked';
        } else if (!lastCap.accessibilityGranted) {
          preflightReadiness = 'blocked';
        } else if (!lastCap.screenRecordingGranted) {
          preflightReadiness = 'degraded';
        } else {
          preflightReadiness = 'ready';
        }
      }

      // ── B3: Live operator-run telemetry ─────────────────────────────────
      // Read the most recent step state from the operator task runner. Returns
      // null when no run is in flight or the last emit is > 2 minutes old.
      const liveRunRaw = getLiveRunState();
      const liveRun = liveRunRaw ? {
        sessionId:                 liveRunRaw.sessionId,
        goal:                      liveRunRaw.goal,
        currentStep:               liveRunRaw.currentStep,
        maxSteps:                  liveRunRaw.maxSteps,
        phase:                     liveRunRaw.phase,
        lastDescription:           liveRunRaw.lastDescription,
        lastActionType:            liveRunRaw.lastActionType,
        lastVerifyPassed:          liveRunRaw.lastVerifyPassed,
        lastVerifyError:           liveRunRaw.lastVerifyError,
        consecutiveVerifyFailures: liveRunRaw.consecutiveVerifyFailures,
        consecutiveWaits:          liveRunRaw.consecutiveWaits,
        lastEmitAt:                liveRunRaw.lastEmitAt,
      } : undefined;

      return {
        operatorEnabled:    enabled,
        platformSupported:  capMap.platform === 'macOS' || capMap.platform === 'Windows',
        platformName:       capMap.platform,
        availableCapabilities: available,
        missingCapabilities:   missing,
        permissionsGranted:    permGranted,
        permissionsMissing:    permMissing,
        workflowsAvailable: [
          'pack.readiness-check',
          'pack.app-context',
          'pack.focus-capture',
          'pack.supervised-input',
          'pack.unreal-bootstrap',
          'pack.unreal-build',
          'pack.unreal-triage',
        ],
        approvalRequiredFor: ['type_text', 'send_key'],
        // Phase 2 Step 3 additions
        preflightReadiness,
        permissionDrift: lastCap !== null ? {
          accessibilityRevoked:   drift.accessibilityRevoked,
          screenRecordingRevoked: drift.screenRecordingRevoked,
        } : undefined,
        // sessionValid is not assessed at snapshot time — set only when a
        // specific session ID is being evaluated, not globally
        sessionValid: undefined,
        // B3: Live mid-workflow telemetry
        liveRun,
      };
    } catch {
      return null;
    }
  });

  // Unreal Engine domain awareness — injected alongside desktop operator state
  systemStateService.registerUnrealStateGetter(async () => {
    try {
      // Use the operator service's app-listing and frontmost-app helpers.
      // Both are read-only osascript calls that don't require Accessibility.
      const [runningApps, frontmostTarget] = await Promise.all([
        OperatorService.listRunningApps(),
        OperatorService.getFrontmostApp(),
      ]);

      return buildUnrealAwarenessSnapshot(
        runningApps,
        frontmostTarget?.appName ?? null,
        frontmostTarget?.windowTitle,
      );
    } catch {
      return null;
    }
  });

  // ── Operator substrate v2 startup hardening (Phase 2 Step 1) ────────────
  // Invalidate any capability cache from a previous process run so the first
  // operator action re-probes OS permissions from scratch.
  // Clean up any sessions that survived from a previous context (defensive —
  // sessions are in-memory only so this is always a no-op on first launch,
  // but guards against any future in-process recycling scenarios).
  OperatorService.invalidateCapabilityCache();
  OperatorService.cleanupStaleSessions();
  OperatorService.prewarmClickHelper(); // compile Swift click helper in background

  // ── Worker Runtime: wire WorkflowPackService → durable WorkerRun records ───
  // Must run after IPC handlers are registered but before any workflow packs
  // can be started (i.e. before user interaction). The bridge is a no-op until
  // a workflow pack run actually starts, so early registration is safe.
  initWorkflowBridge(_getWorkerRunQueue(), store);

  // ── Native Intent Router — shared across all three chat handlers ──────────
  const nativeRouter = new NativeIntentRouter({
    getImageService: () => _getImageService(store),
    getTaskStore:    () => _getTaskStore(),
    getPhoneLinkRef: () => _phoneLinkRef,
    pickFolder:      async () => {
      const result = await dialog.showOpenDialog({ properties: ['openDirectory'], title: 'Select Folder to Audit' });
      return result.canceled ? null : (result.filePaths[0] ?? null);
    },
  });

  // ── Persistent event forwarder — set once, forwards to all open windows ────
  eventBus.onAny((ev) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('taskEngine:event', ev);
    }
  });

  // ── Startup resume — resume interrupted tasks after 3s ───────────────────
  setTimeout(async () => {
    try {
      _getApprovalStore().expireStale();
      const loop = _getAgentLoop(store);
      loop.startRetryLoop();
      const tasks = _getTaskStore().list();
      for (const t of tasks) {
        if (['queued', 'planning', 'running'].includes(t.status)) {
          loop.runTask(t.id).catch((err: unknown) => console.error('[startup-resume]', err));
        }
      }
      // Phase 5 — start Value Engine
      _getValueEngine();
      // Phase 6 — start Growth Engine daily runner
      _getGrowthService().startDailyRunner();
      // Income Operator Phase 5 — resume autopilot if previously enabled
      _getAutopilot(store).resume();
    } catch (e) {
      console.error('[startup-resume]', e);
    }
  }, 3000);

  // ── Sensor Manager init ───────────────────────────────────────────────────────
  if (!_sensorManager) _sensorManager = new SensorManager(store);
  _sensorManager.startGranted();

  // ── MissionController init ────────────────────────────────────────────────────
  // ProviderManager must exist before _getAgentLoop() is called — it throws otherwise.
  if (!providerManager) providerManager = new ProviderManager(store);
  missionController.init({
    providerManager,
    agentLoop: _getAgentLoop(store),
    approvalStore: _getApprovalStore(),
    workspaceRoot: _getDataDir(),
  });

  // ── Autonomy Engine init ──────────────────────────────────────────────────────
  // ProviderManager already initialized above.
  if (!_autonomyEngine) {
    const notifier = createNotifyAdapter();
    _autonomyEngine = new AutonomyEngine(
      _getAgentLoop(store),
      createDefaultRegistry(),
      _getAuditLedger(),
      notifier,
      _getDataDir(),
    );
    _autonomyEngine.start();

    // Register post_social handler — executed when an approved action fires
    _autonomyEngine.registerActionHandler('post_social', async (params) => {
      const platform   = String(params['platform']  ?? 'twitter');
      const content    = String(params['content']   ?? '');
      const contentId  = String(params['contentId'] ?? '');
      const mediaBase64 = params['mediaBase64'] as string | undefined;

      if (!content) throw new Error('post_social: content is empty');

      const poster = new SocialPoster(_getCredentialManager(store));
      const result = await poster.post(platform, content, mediaBase64);

      if (!result.ok) throw new Error(`post_social failed: ${result.error}`);

      // Update ContentStore draft → published
      if (contentId) {
        const { ContentStore } = await import('@triforge/engine');
        const contentStore = new ContentStore(_getDataDir());
        contentStore.update(contentId, { status: 'published', publishedAt: Date.now() });
      }

      // Emit event for value engine tracking
      eventBus.emit({
        type: 'TWEET_POSTED',
        taskId: contentId || 'campaign-ad',
        stepId: `campaign-post-${Date.now()}`,
        tweetId: result.postId ?? '',
        url: result.url ?? '',
        paperMode: false,
      });

      // Notify phone that ad was posted
      sendRemoteUpdate(`Ad posted to ${platform}: "${content.slice(0, 100)}..."`, contentId || 'campaign');
    });

    // Bridge: when post_social actions are queued for approval, push preview to phone
    eventBus.onAny((ev: import('@triforge/engine').EngineEvent) => {
      if (ev.type !== 'WORKFLOW_APPROVAL_PENDING') return;
      const e = ev as { actionId?: string; actionType?: string };
      if (e.actionType !== 'post_social' || !e.actionId) return;

      const pending = _autonomyEngine?.listPendingActions().find(p => p.id === e.actionId);
      if (!pending) return;

      const content  = String(pending.params?.['content'] ?? '');
      const platform = String(pending.params?.['platform'] ?? 'social');
      sendRemoteUpdate(
        `[APPROVAL NEEDED] ${platform} ad:\n"${content.slice(0, 200)}"\n\nAction ID: ${e.actionId}`,
        e.actionId,
      );
    });
  }

  // ── Profession Engine init ────────────────────────────────────────────────────
  if (!_professionEngine && _sensorManager && _autonomyEngine) {
    _professionEngine = new ProfessionEngine(_sensorManager, _autonomyEngine);
  }

  // ── AI Mind — background reasoning agent ─────────────────────────────────────
  // Start after ProviderManager is guaranteed initialized (line above sets it).
  // Defer slightly so all EventBus subscribers are wired before Mind listens.
  setTimeout(async () => {
    try {
      if (!providerManager) return;
      const { getAIMind } = await import('@triforge/engine');
      const sel    = new ProviderSelector(providerManager);
      const { analyzer, critic } = await sel.selectCouncil();
      const mind   = getAIMind(analyzer, critic);
      mind.start();
    } catch (e) {
      console.warn('[AIMind] Could not start background reasoning:', e instanceof Error ? e.message : String(e));
    }
  }, 2000);

  // ── Permissions ─────────────────────────────────────────────────────────────
  ipcMain.handle('permissions:get', () => store.getPermissions());

  ipcMain.handle('permissions:set', (_e, key: string, granted: boolean, budgetLimit?: number) => {
    store.setPermission(key, granted, budgetLimit);
    _sensorManager?.onPermissionChange(key, granted);
    return store.getPermissions();
  });

  ipcMain.handle('permissions:firstRun', () => store.isFirstRun());
  ipcMain.handle('permissions:markDone', () => store.markFirstRunDone());

  // ── API Keys ─────────────────────────────────────────────────────────────────
  ipcMain.handle('keys:set', async (_e, provider: string, key: string) => {
    if (!providerManager) providerManager = new ProviderManager(store);
    await providerManager.setKey(provider as ProviderName, key);
    // Reset both so next call picks up the new provider list
    providerManager = null;
    intentEngine = null;
  });

  ipcMain.handle('keys:delete', async (_e, provider: string) => {
    if (!providerManager) providerManager = new ProviderManager(store);
    await providerManager.removeKey(provider as ProviderName);
    // Reset both so next call picks up the updated provider list
    providerManager = null;
    intentEngine = null;
  });

  ipcMain.handle('keys:status', async () => {
    if (!providerManager) providerManager = new ProviderManager(store);
    const statuses = await providerManager.getStatus();
    const status: Record<string, boolean> = {};
    for (const s of statuses) status[s.name] = s.connected;
    return status;
  });

  // ── Provider mode ─────────────────────────────────────────────────────────────
  ipcMain.handle('engine:mode', async () => {
    const { providerManager: pm } = await getEngine();
    const result = await pm.detectMode();
    return result?.mode ?? 'none';
  });

  // ── License ───────────────────────────────────────────────────────────────────
  ipcMain.handle('license:load', async () => {
    return loadLicense(store);
  });

  ipcMain.handle('license:activate', async (_e, key: string) => {
    const result = await validateLicense(key);
    await store.setLicense({ ...result, lastChecked: new Date().toISOString() });
    return result;
  });

  ipcMain.handle('license:deactivate', async () => {
    const cached = await store.getLicense();
    if (cached.key) {
      await deactivateLicense(cached.key, 'triforge-desktop');
    }
    await store.clearLicense();
    return { tier: 'free' };
  });

  ipcMain.handle('license:tiers', () => TIERS);
  ipcMain.handle('license:checkoutUrls', () => {
    // Append success_url so LemonSqueezy redirects the user back to the app
    // after checkout completes — triggers the triforge://activate deep link
    const successParam = '?checkout[success_url]=' + encodeURIComponent('triforge://activate');
    return {
      pro:    LEMONSQUEEZY.PRO_CHECKOUT + successParam,
      annual: LEMONSQUEEZY.PRO_ANNUAL_CHECKOUT + successParam,
      portal: LEMONSQUEEZY.CUSTOMER_PORTAL,
    };
  });

  // ── Usage ─────────────────────────────────────────────────────────────────────
  ipcMain.handle('usage:get', () => ({
    messagesThisMonth: store.getMonthlyMessageCount(),
  }));

  // ── Chat (single message, non-streaming) ─────────────────────────────────────
  ipcMain.handle('chat:send', async (event, message: string, history: Array<{ role: string; content: string }>) => {
    const validErr = validateChat(message, history);
    if (validErr) return { error: validErr };

    const { providerManager: pm } = await getEngine();
    const providers = await pm.getActiveProviders();
    if (providers.length === 0) {
      return { error: 'No API keys configured. Add at least one in Settings.' };
    }

    // Enforce message limit
    const license = await store.getLicense();
    const tier = (license.tier ?? 'free') as 'free' | 'pro';
    _cachedTier = tier; // keep awareness service in sync
    const used = store.getMonthlyMessageCount();
    if (isAtMessageLimit(used, tier)) {
      return { error: 'MESSAGE_LIMIT_REACHED', tier };
    }

    // Track task context from this message
    updateTaskContext(message);

    // Native intent routing — image, mission, task, phone, desktop before LLM
    const snapshot = await systemStateService.snapshot();
    const nativeResult = await nativeRouter.route(message, snapshot);
    if (nativeResult) {
      if (nativeResult.ok || nativeResult.status === 'requires_approval' || nativeResult.status === 'already_active') {
        store.incrementMessageCount();
      }
      return { text: nativeResult.message, provider: nativeResult.type, nativeResult };
    }

    // Build system prompt with user identity, memories, tier capabilities, and live awareness
    const basePrompt = await buildSystemPrompt(store, _professionEngine?.getSystemPromptAdditions());
    const awarenessAddendum = buildCouncilAwarenessAddendum(snapshot);
    const systemPrompt = basePrompt + '\n\n' + awarenessAddendum;

    try {
      const primary = providers[0];
      const allMsgs = [
        { role: 'system', content: systemPrompt },
        ...history,
        { role: 'user', content: message },
      ];
      // Stream tokens to renderer as they arrive
      const text = await primary.chatStream(allMsgs, (chunk: string) => {
        event.sender.send('chat:chunk', chunk);
      });
      store.incrementMessageCount();
      return { text, provider: primary.name };
    } catch (err: unknown) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ── Task Continuity — active task context persists across messages ───────────
  let activeTaskContext: string | null = null;
  const TASK_KEYWORDS = ['build', 'design', 'create', 'develop', 'plan', 'write', 'research', 'make', 'launch', 'improve', 'fix', 'implement', 'generate', 'help me'];
  const TASK_RESET_COMMANDS = ['new task', 'clear task', 'start over', 'reset task'];

  // ── Expert task-type inference from natural language message ─────────────
  function _detectCouncilTaskType(message: string): string {
    const m = message.toLowerCase();
    if (/brand|logo|identity|name.*company|company.*name/.test(m))  return 'brand_creation';
    if (/website|landing page|homepage|seo|conversion/.test(m))     return 'website_building';
    if (/traffic|ads|paid|social.*grow|newsletter/.test(m))         return 'traffic_planning';
    if (/audience|lead|subscriber|capture/.test(m))                 return 'audience_capture';
    if (/niche|market|idea|opportunit|validate/.test(m))            return 'venture_discovery';
    if (/revenue|monetiz|income|earn|pricing/.test(m))              return 'income_lane_scoring';
    if (/content|post|video|script|copy/.test(m))                   return 'content_production';
    if (/experiment|ab test|result|metric|kpi/.test(m))             return 'experiment_review';
    if (/grow|scale|expand|traction/.test(m))                       return 'income_growth';
    if (/legal|compliance|filing|tax|llc/.test(m))                  return 'filing_prep';
    if (/risk|safe|danger|concern/.test(m))                         return 'scoring';
    if (/vibe|aesthetic|design|feel|look/.test(m))                  return 'vibe_analysis';
    return 'council_debate'; // default: general council discussion
  }

  function updateTaskContext(message: string): void {
    const lower = message.toLowerCase();
    if (TASK_RESET_COMMANDS.some(cmd => lower.includes(cmd))) {
      activeTaskContext = null;
      resetProactiveCooldown();
      return;
    }
    // Store messages >40 chars containing task-oriented keywords
    if (message.length > 40 && TASK_KEYWORDS.some(k => lower.includes(k))) {
      activeTaskContext = message.slice(0, 200);
      resetProactiveCooldown();
    }
  }

  // ── Council Awareness — role-specific thinking messages shown before streaming
  const ROLE_THINKING_MESSAGES: Record<string, string> = {
    strategist: 'Analyzing strategic direction…',
    critic:     'Probing for weaknesses…',
    executor:   'Planning implementation steps…',
  };

  // ── Debate Intensity — Council role prompts & synthesis directives ────────────
  const ROLES = ['strategist', 'critic', 'executor'] as const;
  type Role = typeof ROLES[number];
  type Intensity = 'cooperative' | 'analytical' | 'critical' | 'combative' | 'ruthless';
  const VALID_INTENSITIES: Intensity[] = ['cooperative', 'analytical', 'critical', 'combative', 'ruthless'];

  const ROLE_PROMPTS: Record<Role, Record<Intensity, string>> = {
    strategist: {
      cooperative: 'You are the Strategist. Find what works. Be constructive and propose a clear direction.',
      analytical:  'You are the Strategist. Evaluate architectural tradeoffs and long-term impact. Propose the strongest design.',
      critical:    'You are the Strategist. Architect for scale and maintainability. Do not accept shortcuts.',
      combative:   'You are the Strategist. Challenge the premise if a better approach exists. Propose superior alternatives without mercy.',
      ruthless:    'You are the Strategist. Reject weak architecture entirely. Demand the best possible design. If the premise is flawed, say so directly.',
    },
    critic: {
      cooperative: 'You are the Critic. Note concerns gently. Look for synergies and flag edge cases.',
      analytical:  'You are the Critic. Identify assumptions, gaps, and edge cases. Ask what could break.',
      critical:    'You are the Critic. Aggressively probe failure modes, risks, and security issues. Assume the plan has flaws — find them.',
      combative:   'You are the Critic. Assume the proposal is flawed until proven otherwise. Find the breaking point. What would make this fail in production?',
      ruthless:    'You are the Critic. Maximum adversarial analysis. Security paranoia. Find every vulnerability, performance regression, and architectural debt. Be uncompromising.',
    },
    executor: {
      cooperative: 'You are the Executor. Provide a practical implementation path with clear steps.',
      analytical:  'You are the Executor. Propose concrete steps with dependencies. Flag what is hard to implement.',
      critical:    'You are the Executor. Detail every implementation risk and how to mitigate it. Be specific about what will be hard.',
      combative:   'You are the Executor. Identify every point where implementation could fail. Assume nothing works out of the box.',
      ruthless:    'You are the Executor. Refuse vague plans. Require specific, testable implementation steps. Block anything that cannot be verified.',
    },
  };

  const SYNTHESIS_DIRECTIVES: Record<Intensity, string> = {
    cooperative: 'Combine the Strategist, Critic, and Executor perspectives into a clear, unified recommendation. Smooth disagreements into a practical synthesis.',
    analytical:  'Weight each perspective by its reasoning strength. Highlight key decision points where the models diverged. Summarize what they agreed on and where trade-offs exist.',
    critical:    "Prioritize the Critic's risk flags. Do not smooth over disagreements — call out the strongest objection and explain how the Strategist responded to it. The final answer must acknowledge risk directly.",
    combative:   "Do not merge perspectives artificially. State each model's position explicitly. Where they conflict, explain WHY each side is correct in its own frame. Give a final recommendation that takes the strongest critique seriously.",
    ruthless:    "Show the full conflict. If the Critic's attack was valid, the synthesis must reflect that. If models disagree significantly, say so clearly and explain both sides without diplomatic smoothing. Confidence should drop if real disagreement exists.",
  };

  const ESCALATION_RE = /security.risk|vulnerabilit|breaking.change|data.loss|memory.leak|race.condition|injection/i;

  // ── Consensus Chat (all active providers in parallel + synthesis) ─────────────
  ipcMain.handle('chat:consensus', async (event, message: string, history: Array<{ role: string; content: string }>, intensity: string = 'analytical', deliberate = false) => {
    const validErr = validateChat(message, history);
    if (validErr) return { error: validErr };

    const { providerManager: pm } = await getEngine();
    const providers = await pm.getActiveProviders();
    if (providers.length === 0) {
      return { error: 'No API keys configured. Add at least one in Settings.' };
    }

    const license = await store.getLicense();
    const tierVal = (license.tier ?? 'free') as 'free' | 'pro';
    _cachedTier = tierVal; // keep awareness service in sync
    if (!hasCapability('THINK_TANK', tierVal)) {
      return { error: lockedError('THINK_TANK') };
    }
    const used = store.getMonthlyMessageCount();
    if (isAtMessageLimit(used, tierVal)) {
      return { error: 'MESSAGE_LIMIT_REACHED', tier: tierVal };
    }

    // Skip native intent routing in consensus path — Think Tank should always
    // deliberate across all providers. Native routing stays in chat:conversation.
    const snapshotC = await systemStateService.snapshot();

    // ── Operator intent detection (Think Tank path) ───────────────────────────
    const _thinktankOriginalMessage = message;
    const _thinktankOperatorIntent = detectOperatorIntent(_thinktankOriginalMessage);
    if (_thinktankOperatorIntent.isOperatorTask && !event.sender.isDestroyed()) {
      event.sender.send('forge:operator-suggestion', {
        goal:            _thinktankOperatorIntent.goal,
        targetApp:       _thinktankOperatorIntent.targetApp,
        suggestedPackId: _thinktankOperatorIntent.suggestedPackId,
        confidence:      _thinktankOperatorIntent.confidence,
      });
    }

    // ── Pre-flight web search ─────────────────────────────────────────────────
    let webSearchPerformed = false;
    if (needsWebSearch(message)) {
      if (!event.sender.isDestroyed())
        event.sender.send('forge:update', { phase: 'web:search', query: message });
      const webResults = await searchWeb(message, 5);
      if (webResults.length > 0) {
        webSearchPerformed = true;
        const webContext = webResults
          .map((r, i) => `[${i + 1}] ${r.title}\n${r.snippet}\nSource: ${r.url}`)
          .join('\n\n');
        message =
          `[REFERENCE MATERIAL — third-party web search results from a live query. ` +
          `These describe the open web, NOT TriForge itself. ` +
          `When the user asks about TriForge's own capabilities, trust the system prompt's "Capability scope" section over these results — ` +
          `web pages may be outdated, biased, or from competitors. ` +
          `These are useful for general facts, tutorials, current events, and external context.]\n` +
          `${webContext}\n` +
          `[END REFERENCE MATERIAL]\n\n` +
          `User question: ${message}`;
        if (!event.sender.isDestroyed())
          event.sender.send('forge:update', { phase: 'web:search:done', resultCount: webResults.length });
      }
    }

    // Validate + normalise intensity
    const activeIntensity: Intensity = VALID_INTENSITIES.includes(intensity as Intensity)
      ? (intensity as Intensity)
      : 'analytical';

    // Task Continuity: detect and update active task from this message
    updateTaskContext(message);

    const baseSystemPrompt = await buildSystemPrompt(store, _professionEngine?.getSystemPromptAdditions());
    // Inject live Council Awareness addendum + active task context
    const awarenessAddendum = buildCouncilAwarenessAddendum(snapshotC);
    const systemPrompt = baseSystemPrompt + '\n\n' + awarenessAddendum + (activeTaskContext
      ? `\n\n--- ACTIVE TASK CONTEXT ---\nThe user is currently working on: "${activeTaskContext}"\nAll responses should help advance this task.`
      : '');

    // Notify renderer: forge starting
    event.sender.send('forge:update', { phase: 'querying', total: providers.length });

    // ── Optional deliberation pre-pass (2 rounds before full response) ──────────
    // Phase 1: quick 1-2 sentence initial position from each provider (parallel)
    // Phase 2: cross-reaction — each provider reads others' Phase 1 and reacts (parallel)
    // Phase 3: full response informed by deliberation context (existing flow below)
    let deliberationContext: { phase1: Record<string, string>; phase2: Record<string, string> } | null = null;

    if (deliberate && providers.length > 1) {
      event.sender.send('forge:update', { phase: 'deliberation:phase1:start', total: providers.length });

      const phase1: Record<string, string> = {};
      await Promise.allSettled(providers.map(async (p, i) => {
        const role = ROLES[Math.min(i, ROLES.length - 1)];
        const msgs = [
          { role: 'system', content: `You are the ${role.charAt(0).toUpperCase() + role.slice(1)} on the Council. Give your initial 1-2 sentence position on this topic. Be direct and specific.` },
          ...history,
          { role: 'user', content: message },
        ];
        let txt = '';
        await p.chatStream(msgs, (chunk: string) => {
          txt += chunk;
          if (!event.sender.isDestroyed())
            event.sender.send('forge:update', { phase: 'deliberation:phase1:token', provider: p.name, token: chunk });
        });
        phase1[p.name] = txt;
        if (!event.sender.isDestroyed())
          event.sender.send('forge:update', { phase: 'deliberation:phase1:done', provider: p.name });
      }));

      event.sender.send('forge:update', { phase: 'deliberation:phase2:start', total: providers.length });

      const phase2: Record<string, string> = {};
      await Promise.allSettled(providers.map(async (p, i) => {
        const role = ROLES[Math.min(i, ROLES.length - 1)];
        const othersStr = providers
          .filter((_, j) => j !== i)
          .map((op, j) => {
            const otherRole = ROLES[Math.min(j >= i ? j + 1 : j, ROLES.length - 1)];
            return `${otherRole.charAt(0).toUpperCase() + otherRole.slice(1)} (${op.name}): ${(phase1[op.name] ?? '').slice(0, 300)}`;
          })
          .join('\n\n');
        const msgs = [
          { role: 'system', content: `You are the ${role.charAt(0).toUpperCase() + role.slice(1)} on the Council. Other council members gave these initial positions:\n\n${othersStr}\n\nIn 1-2 sentences: do you agree, partially agree, or disagree? What is the key point of difference?` },
          { role: 'user', content: message },
        ];
        let txt = '';
        await p.chatStream(msgs, (chunk: string) => {
          txt += chunk;
          if (!event.sender.isDestroyed())
            event.sender.send('forge:update', { phase: 'deliberation:phase2:token', provider: p.name, token: chunk });
        });
        phase2[p.name] = txt;
        if (!event.sender.isDestroyed())
          event.sender.send('forge:update', { phase: 'deliberation:phase2:done', provider: p.name });
      }));

      deliberationContext = { phase1, phase2 };
      event.sender.send('forge:update', { phase: 'deliberation:complete' });
    }

    // Run all providers in parallel with distinct council roles
    let completedCount = 0;
    // Fast-First: accumulate completions to emit draft/update before full synthesis
    const fastFirstResults: Array<{ provider: string; text: string; role: Role }> = [];

    const settled = await Promise.allSettled(
      providers.map(async (p, i) => {
        const role: Role = ROLES[Math.min(i, ROLES.length - 1)];
        const roleInstruction = ROLE_PROMPTS[role][activeIntensity];
        const deliberationAddendum = deliberationContext
          ? `\n\n--- DELIBERATION CONTEXT ---\nYour initial position: ${(deliberationContext.phase1[p.name] ?? '').slice(0, 400)}\nYour cross-reaction: ${(deliberationContext.phase2[p.name] ?? '').slice(0, 400)}\nNow provide your full, comprehensive response informed by this deliberation.`
          : '';
        const roleMsgs = [
          {
            role: 'system',
            content: `${systemPrompt}\n\n--- COUNCIL ROLE ---\n${roleInstruction}${deliberationAddendum}\nAt the end of your response, append exactly: [[CONFIDENCE: X%]] where X is your self-assessed confidence (0-100 integer).`,
          },
          ...history,
          { role: 'user', content: message },
        ];
        // Council Awareness: emit role-specific thinking message before streaming begins
        if (!event.sender.isDestroyed()) {
          event.sender.send('forge:update', { phase: 'provider:responding', provider: p.name });
          event.sender.send('forge:update', {
            phase: 'provider:thinking', provider: p.name,
            thinkingText: ROLE_THINKING_MESSAGES[role] ?? 'Thinking…',
          });
        }
        let text = '';
        try {
          await p.chatStream(roleMsgs, (chunk: string) => {
            text += chunk;
            if (!event.sender.isDestroyed())
              event.sender.send('forge:update', { phase: 'provider:token', provider: p.name, token: chunk });
          });
        } catch (streamErr) {
          // If tokens were already streamed, preserve the partial response instead of rejecting
          if (text.length > 0) {
            console.warn(`[TriForge] ${p.name} stream interrupted after ${text.length} chars — preserving partial response.`, streamErr);
          } else {
            throw streamErr; // No content received — propagate the error
          }
        }
        completedCount++;
        if (!event.sender.isDestroyed())
          event.sender.send('forge:update', { phase: 'provider:complete', provider: p.name, completedCount, total: providers.length });

        // Fast-First: strip confidence tag for clean draft display
        const displayText = text.replace(/\[\[CONFIDENCE:\s*\d+%?\]\]/i, '').trim();
        fastFirstResults.push({ provider: p.name as string, text: displayText, role });

        if (fastFirstResults.length === 1) {
          // First responder — emit draft immediately so renderer can show something
          if (!event.sender.isDestroyed())
            event.sender.send('council:draft', { provider: p.name as string, text: displayText });
        } else if (fastFirstResults.length === 2) {
          // Two results available — run a quick async interim refinement (non-blocking)
          const snap = fastFirstResults.slice();
          ;(async () => {
            try {
              const oKey = await store.getSecret('triforge.openai.apiKey');
              if (!oKey || event.sender.isDestroyed()) return;
              const snippets = snap.map(r => `${r.role.toUpperCase()}: ${r.text.slice(0, 500)}`).join('\n\n---\n\n');
              const rRes = await fetch('https://api.openai.com/v1/chat/completions', {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${oKey}`, 'Content-Type': 'application/json' },
                body: JSON.stringify({
                  model: 'gpt-4o-mini',
                  messages: [
                    { role: 'system', content: 'You are synthesizing AI council responses. Merge the strongest ideas into one clear, concise answer. 3 sentences max.' },
                    { role: 'user', content: `Question: ${message.slice(0, 300)}\n\n${snippets}\n\nRefined answer:` },
                  ],
                  max_tokens: 250,
                  temperature: 0.3,
                }),
              });
              if (!rRes.ok) return;
              const rData = await rRes.json() as { choices: Array<{ message: { content: string } }> };
              const refined = rData.choices?.[0]?.message?.content?.trim() ?? '';
              if (refined && !event.sender.isDestroyed())
                event.sender.send('council:update', { text: refined });
            } catch { /* ignore — full synthesis will follow */ }
          })();
        }

        return { provider: p.name as string, text, role };
      })
    );

    // Separate successes from failures; strip [[CONFIDENCE:]] tags and collect values
    const confidenceValues: number[] = [];
    const responses = settled
      .filter((r): r is PromiseFulfilledResult<{ provider: string; text: string; role: Role }> => r.status === 'fulfilled')
      .map(r => {
        const entry = { ...r.value };
        const m = entry.text.match(/\[\[CONFIDENCE:\s*(\d+)%?\]\]/i);
        if (m) {
          confidenceValues.push(parseInt(m[1]));
          entry.text = entry.text.replace(m[0], '').trim();
        }
        return entry;
      })
      .filter(r => r.text);

    const initialConfidence = confidenceValues.length > 0
      ? Math.round(confidenceValues.reduce((a, b) => a + b, 0) / confidenceValues.length)
      : undefined;

    const failedProviders = settled
      .map((r, i) => ({ result: r, name: providers[i].name }))
      .filter(({ result }) => result.status === 'rejected')
      .map(({ result, name }) => ({
        provider: name as string,
        error: (result as PromiseRejectedResult).reason instanceof Error
          ? (result as PromiseRejectedResult).reason.message
          : String((result as PromiseRejectedResult).reason),
      }));

    // Notify renderer about failed providers so UI can show error instead of "idle"
    for (const fp of failedProviders) {
      console.error(`[TriForge] Council provider "${fp.provider}" failed:`, fp.error);
      if (!event.sender.isDestroyed())
        event.sender.send('forge:update', { phase: 'provider:error', provider: fp.provider, error: fp.error });
    }

    if (responses.length === 0) {
      const details = failedProviders.map(f => `${f.provider}: ${f.error}`).join('; ');
      return { error: `All providers failed. ${details}` };
    }

    // Auto-escalation: if risk signals detected in responses and intensity is low, raise to critical
    let effectiveIntensity = activeIntensity;
    let escalatedFrom: string | undefined;
    const allResponseText = responses.map(r => r.text).join(' ');
    if (ESCALATION_RE.test(allResponseText) && (activeIntensity === 'cooperative' || activeIntensity === 'analytical')) {
      escalatedFrom = activeIntensity;
      effectiveIntensity = 'critical';
      event.sender.send('forge:update', { phase: 'escalating', from: activeIntensity, to: 'critical', reason: 'Risk signals detected in responses' });
    }

    // Notify renderer: synthesis phase beginning
    event.sender.send('forge:update', { phase: 'synthesis:start' });

    // Synthesize when multiple providers responded
    let synthesis = responses[0].text;
    if (responses.length > 1) {
      try {
        const synthDirective = SYNTHESIS_DIRECTIVES[effectiveIntensity];
        // Truncate each provider response to 1500 chars to reduce token overhead
        const truncatedInputs = responses.map(r => `${r.role.toUpperCase()} (${r.provider}):\n${r.text.slice(0, 1500)}`).join('\n\n---\n\n');
        const synthMsgs = [
          {
            role: 'system',
            content: `You are a synthesis engine. ${synthDirective}

After your synthesis, output a trust assessment in this EXACT format (no variations):
---FORGE_SCORE---
CONFIDENCE: [0-100 integer]%
AGREEMENT: [one sentence: what the models agreed on]
DISAGREEMENT: [one sentence: key differences, or "None — models aligned"]
RISK: [Low|Medium|High]
ASSUMPTIONS: [one or two key assumptions that could be wrong]
VERIFY: [1-3 specific things the user should double-check]
---END_FORGE_SCORE---`,
          },
          {
            role: 'user',
            content: `User asked: "${message}"\n\n${truncatedInputs}\n\nSynthesize into one final, comprehensive answer, then add the FORGE_SCORE block.`,
          },
        ];

        // Try fast synthesis: gpt-4o-mini via OpenAI key (cheaper + faster than primary model)
        // Falls back to primary provider if no OpenAI key is available
        const openaiKey = await store.getSecret('triforge.openai.apiKey');
        let synthesisAccum = '';

        if (openaiKey) {
          // Stream synthesis tokens directly via gpt-4o-mini
          const synthRes = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: { 'Authorization': `Bearer ${openaiKey}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'gpt-4o-mini', messages: synthMsgs, stream: true, temperature: 0.3 }),
          });
          if (synthRes.ok && synthRes.body) {
            const reader = synthRes.body.getReader();
            const dec = new TextDecoder();
            let buf = '';
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              buf += dec.decode(value, { stream: true });
              const lines = buf.split('\n');
              buf = lines.pop() ?? '';
              for (const line of lines) {
                const trimmed = line.replace(/^data: /, '').trim();
                if (!trimmed || trimmed === '[DONE]') continue;
                try {
                  const parsed = JSON.parse(trimmed) as { choices?: Array<{ delta?: { content?: string } }> };
                  const token = parsed.choices?.[0]?.delta?.content ?? '';
                  if (token) {
                    synthesisAccum += token;
                    if (!event.sender.isDestroyed())
                      event.sender.send('forge:update', { phase: 'synthesis:token', token });
                  }
                } catch { /* skip malformed SSE line */ }
              }
            }
            synthesis = synthesisAccum;
          }
        } else {
          // Fallback: stream synthesis via primary provider
          await providers[0].chatStream(synthMsgs, (chunk: string) => {
            synthesisAccum += chunk;
            if (!event.sender.isDestroyed())
              event.sender.send('forge:update', { phase: 'synthesis:token', token: chunk });
          });
          synthesis = synthesisAccum;
        }
      } catch { /* use primary response as fallback */ }
    }

    // Parse ForgeScore out of synthesis text
    let forgeScore: ForgeScore | undefined;
    const scoreMatch = synthesis.match(/---FORGE_SCORE---([\s\S]*?)---END_FORGE_SCORE---/);
    if (scoreMatch) {
      synthesis = synthesis.replace(/---FORGE_SCORE---[\s\S]*?---END_FORGE_SCORE---/, '').trim();
      const s = scoreMatch[1];
      forgeScore = {
        confidence: parseInt(s.match(/CONFIDENCE:\s*(\d+)/)?.[1] ?? '0'),
        risk: (s.match(/RISK:\s*(Low|Medium|High)/)?.[1] ?? 'Medium') as 'Low' | 'Medium' | 'High',
        agreement:    s.match(/AGREEMENT:\s*(.+)/)?.[1]?.trim() ?? '',
        disagreement: s.match(/DISAGREEMENT:\s*(.+)/)?.[1]?.trim() ?? '',
        assumptions:  s.match(/ASSUMPTIONS:\s*(.+)/)?.[1]?.trim() ?? '',
        verify:       s.match(/VERIFY:\s*([\s\S]*?)(?=\n[A-Z]|$)/)?.[1]?.trim() ?? '',
        initialConfidence,
        intensity: effectiveIntensity,
        escalatedFrom,
      };
    }

    // Auto-save to Decision Ledger
    store.addLedger({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2),
      timestamp: Date.now(),
      request: message,
      synthesis,
      forgeScore,
      responses,
      starred: false,
    });

    store.incrementMessageCount();
    event.sender.send('forge:update', { phase: 'complete' });

    // Record expert contributions from council providers into learning brain (GAP #3/#6 fix)
    try {
      const lo = _getLearningOrchestrator(store);
      for (const r of responses) {
        const confMatch = r.text?.match?.(/\[\[CONFIDENCE:\s*(\d+)%?\]\]/i);
        const score = confMatch ? parseInt(confMatch[1]) : 50;
        lo.onExpertContribution(
          `council:${r.provider}`,     // expertId — namespace as council provider
          'council_debate',            // ventureId context
          'council_debate',            // taskType
          score,                       // contribution score
          true,                        // survived (contributed to synthesis)
        );
      }
    } catch { /* learning integration optional */ }

    // Proactive Council: fire-and-forget suggestion evaluation after each response
    ;(async () => {
      try {
        const oKey = await store.getSecret('triforge.openai.apiKey');
        if (!oKey || !activeTaskContext) return;
        const recentMsgs = history.slice(-4).concat([
          { role: 'assistant', content: synthesis.slice(0, 300) },
        ]);
        await evaluateProactiveOpportunity(activeTaskContext, recentMsgs, oKey, (suggestion) => {
          if (!event.sender.isDestroyed())
            event.sender.send('council:suggestion', { text: suggestion });
          sendRemoteUpdate(`Council: ${suggestion}`, 'suggestion');
        });
      } catch { /* ignore */ }
    })();

    return { responses, synthesis, forgeScore, failedProviders: failedProviders.length > 0 ? failedProviders : undefined };
  });

  // ── Council Conversation (fast-first parallel streaming above ThinkTank) ────────
  ipcMain.handle('chat:conversation', async (event, message: string, history: Array<{ role: string; content: string }>) => {
    const validErr = validateChat(message, history);
    if (validErr) return { error: validErr };

    const { providerManager: pm } = await getEngine();
    const providers = await pm.getActiveProviders();
    if (providers.length === 0) return { error: 'No API keys configured.' };

    const license = await store.getLicense();
    const tier = (license.tier ?? 'free') as 'free' | 'pro';
    _cachedTier = tier; // keep awareness service in sync
    const used = store.getMonthlyMessageCount();
    if (isAtMessageLimit(used, tier)) return { error: 'MESSAGE_LIMIT_REACHED', tier };

    // Capture the original user message before any web-search mutation.
    // Used by the operator suggestion detector below (must reflect what the
    // user actually typed, not the blob of web results we inject).
    const originalMessage = message;

    // Native intent routing — image, mission, task, phone, desktop before LLM
    const snapshotV = await systemStateService.snapshot();
    const nativeResultV = await nativeRouter.route(message, snapshotV);
    if (nativeResultV) {
      if (nativeResultV.ok || nativeResultV.status === 'requires_approval' || nativeResultV.status === 'already_active') {
        store.incrementMessageCount();
      }
      return { synthesis: nativeResultV.message, responses: [], nativeResult: nativeResultV };
    }

    // ── Operator intent detection ─────────────────────────────────────────────
    // Detect if user is asking TriForge to DO something in an app.
    // If yes, emit forge:operator-suggestion alongside the Council response
    // so Chat.tsx can show an "Execute" action card.
    const _originalMessage = message; // capture before web-context mutation
    const operatorIntent = detectOperatorIntent(_originalMessage);
    if (operatorIntent.isOperatorTask && !event.sender.isDestroyed()) {
      event.sender.send('forge:operator-suggestion', {
        goal:            operatorIntent.goal,
        targetApp:       operatorIntent.targetApp,
        suggestedPackId: operatorIntent.suggestedPackId,
        confidence:      operatorIntent.confidence,
      });
    }

    // ── Pre-flight web search ─────────────────────────────────────────────────
    if (needsWebSearch(message)) {
      if (!event.sender.isDestroyed())
        event.sender.send('forge:update', { phase: 'web:search', query: message });
      const webResults = await searchWeb(message, 5);
      if (webResults.length > 0) {
        const webContext = webResults
          .map((r, i) => `[${i + 1}] ${r.title}\n${r.snippet}\nSource: ${r.url}`)
          .join('\n\n');
        message =
          `[REFERENCE MATERIAL — third-party web search results from a live query. ` +
          `These describe the open web, NOT TriForge itself. ` +
          `When the user asks about TriForge's own capabilities, trust the system prompt's "Capability scope" section over these results — ` +
          `web pages may be outdated, biased, or from competitors. ` +
          `These are useful for general facts, tutorials, current events, and external context.]\n` +
          `${webContext}\n` +
          `[END REFERENCE MATERIAL]\n\n` +
          `User question: ${message}`;
        if (!event.sender.isDestroyed())
          event.sender.send('forge:update', { phase: 'web:search:done', resultCount: webResults.length });
      }
    }

    updateTaskContext(message);
    routeCouncil(message, pm);  // intent-based provider order (CouncilRouter)

    // ── Section 5: Contextual Intelligence ───────────────────────────────────
    // Build a reasoning-only contextual understanding of the user's request and
    // current machine state, then compress it into a compact prompt addendum.
    // Fails soft — if reasoning throws, chat continues without the addendum.
    let contextualIntelligence: ReturnType<typeof buildContextualIntelligence> | null = null;
    let contextualAddendum = '';
    try {
      const activeMissionTitle = _getMissionCtxMgr(store).get()?.mission ?? null;
      contextualIntelligence = buildContextualIntelligence({
        rawUserRequest: message,
        snapshot:       snapshotV,
        activeMissionTitle,
      });
      contextualAddendum = '\n\n' + buildContextualReasoningAddendum(contextualIntelligence);
    } catch {
      // Non-fatal — reasoning layer is advisory only
    }
    // ─────────────────────────────────────────────────────────────────────────

    const basePrompt = await buildSystemPrompt(store, _professionEngine?.getSystemPromptAdditions());
    const awarenessAddendum = buildCouncilAwarenessAddendum(snapshotV);

    // ── Expert Routing (MoE) — select relevant specialists for this message ───
    let expertContextAddendum = '';
    let _councilSelectedExpertIds: string[] = [];
    try {
      _getExpertWorkforceEngine(store); // ensure _expertRouter is initialized
      if (_expertRouter) {
        const taskType = _detectCouncilTaskType(message);
        const decision = _expertRouter.selectExperts(taskType);
        _councilSelectedExpertIds = decision.selectedExperts ?? [];
        if (_councilSelectedExpertIds.length > 0) {
          expertContextAddendum = '\n\n' + _expertRouter.buildExpertContext(_councilSelectedExpertIds);
        }
      }
    } catch { /* expert routing is optional */ }
    // ─────────────────────────────────────────────────────────────────────────

    const systemPrompt = basePrompt
      + '\n\n' + awarenessAddendum
      + buildTaskContextAddendum()
      + _getMissionCtxMgr(store).buildAddendum()
      + _getMemGraph(store).buildContextAddendum(message)
      + contextualAddendum
      + expertContextAddendum;

    const planner = new ThinkTankPlanner(pm);
    const _councilClaudeKey = (await store.getSecret('triforge.claude.apiKey')) ?? undefined;
    const engine = new CouncilConversationEngine(pm, planner, _councilClaudeKey);

    // Progressive debate coordinator — broadcasts partial reasoning every 200 tokens
    const coordinator = new DebateStreamCoordinator((provider, reasoning) => {
      if (!event.sender.isDestroyed())
        event.sender.send('council:partial-reasoning', { provider, reasoning });
    });

    try {
      const result = await engine.handleMessage(message, systemPrompt, history, {
        onThinking: (provider, thinkingText) => {
          if (!event.sender.isDestroyed())
            event.sender.send('forge:update', { phase: 'provider:thinking', provider, thinkingText });
        },
        onStream: (provider, token) => {
          coordinator.handleToken(provider, token);
          if (!event.sender.isDestroyed())
            event.sender.send('forge:update', { phase: 'provider:token', provider, token });
        },
        onDraft: (provider, text) => {
          if (!event.sender.isDestroyed())
            event.sender.send('council:draft', { provider, text });
        },
        onSynthesisToken: (token) => {
          if (!event.sender.isDestroyed())
            event.sender.send('forge:update', { phase: 'synthesis:token', token });
        },
        onUpdate: (text) => {
          if (!event.sender.isDestroyed())
            event.sender.send('council:update', { text });
        },
        onPlan: (plan) => {
          if (!event.sender.isDestroyed())
            event.sender.send('council:plan', { plan });
        },
        onSuggestion: (text) => {
          if (!event.sender.isDestroyed())
            event.sender.send('council:suggestion', { text });
        },
      });

      store.incrementMessageCount();

      // Record expert contributions from council conversation into learning brain
      try {
        const lo = _getLearningOrchestrator(store);
        for (const r of (result.responses ?? [])) {
          lo.onExpertContribution(
            `council:${r.provider}`,
            'council_debate',
            'council_debate',
            (r as { provider: string; text: string; confidence?: number }).confidence ?? 50,
            true,
          );
        }
      } catch { /* learning integration optional */ }

      // Record expert performance for the routed specialists
      try {
        if (_expertPerformanceTracker && _councilSelectedExpertIds.length > 0) {
          const survived = !!(result.synthesis && result.synthesis.length > 20);
          const now = Date.now();
          for (const expertId of _councilSelectedExpertIds) {
            _expertPerformanceTracker.recordTaskResult({
              expertId,
              taskType: 'council_debate',
              output: result.synthesis?.slice(0, 100) ?? '',
              outputSurvivedToFinal: survived,
              latencyMs: result.durationMs ?? 0,
              tokenCount: 0,
              errorOccurred: false,
              timestamp: now,
            });
          }
        }
      } catch { /* performance tracking optional */ }

      // Auto-save synthesis as a knowledge graph insight for future context injection
      if (result.synthesis && result.synthesis.length > 80) {
        _getMemGraph(store).addNode({
          id:      `conv_${Date.now()}`,
          type:    'insight',
          project: getTaskContext() ?? 'general',
          content: result.synthesis.slice(0, 300),
          related: [],
        });
      }

      // ── Operator Suggestion — attach if message is an operator-action intent ──
      // The council answered as normal, but we surface a "Run in Operator" CTA
      // so the user can execute the described action right from the chat bubble.
      let operatorSuggestion: { goal: string; appName?: string } | undefined;
      try {
        const intent = detectIntentType(originalMessage);
        if (intent === 'operator_action') {
          // Try to attach the frontmost app name for context
          let appName: string | undefined;
          try {
            const target = await OperatorService.getFrontmostApp();
            if (target?.appName) appName = target.appName;
          } catch { /* best effort */ }
          operatorSuggestion = { goal: originalMessage.slice(0, 200), appName };
        }
      } catch { /* operator suggestion is advisory only */ }

      return { responses: result.responses, synthesis: result.synthesis, durationMs: result.durationMs, contextualIntelligence, operatorSuggestion };
    } catch (err: unknown) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ── Mission Context (council project awareness) ───────────────────────────────
  ipcMain.handle('mission:ctx:get', (_e) => {
    return _getMissionCtxMgr(store).get();
  });

  ipcMain.handle('mission:ctx:set', (_e, ctx: Omit<MissionContext, 'updatedAt'>) => {
    _getMissionCtxMgr(store).set(ctx);
    return { ok: true };
  });

  ipcMain.handle('mission:ctx:update', (_e, patch: Partial<Omit<MissionContext, 'updatedAt'>>) => {
    return _getMissionCtxMgr(store).update(patch);
  });

  ipcMain.handle('mission:ctx:clear', (_e) => {
    _getMissionCtxMgr(store).clear();
    return { ok: true };
  });

  // ── Council Memory Graph ──────────────────────────────────────────────────────
  ipcMain.handle('memory:graph:add', (_e, node: Omit<CouncilMemoryNode, 'createdAt'>) => {
    _getMemGraph(store).addNode(node);
    return { ok: true };
  });

  ipcMain.handle('memory:graph:search', (_e, project: string) => {
    return _getMemGraph(store).searchProject(project);
  });

  ipcMain.handle('memory:graph:related', (_e, nodeId: string) => {
    return _getMemGraph(store).findRelated(nodeId);
  });

  ipcMain.handle('memory:graph:all', (_e) => {
    return _getMemGraph(store).getAll();
  });

  // ── Local AI Providers (Ollama / LM Studio) ───────────────────────────────────
  ipcMain.handle('local:provider:test', async (_e, baseUrl: string, model: string) => {
    const p = new OllamaProvider({ baseUrl, model });
    return p.testConnection();
  });

  ipcMain.handle('local:provider:chat', async (_e, baseUrl: string, model: string, messages: Array<{ role: string; content: string }>) => {
    try {
      const p = new OllamaProvider({ baseUrl, model });
      const text = await p.chat(messages);
      return { text };
    } catch (err: unknown) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('local:provider:models', async (_e, baseUrl: string) => {
    try {
      const p = new OllamaProvider({ baseUrl, model: '' });
      const models = await p.listModels();
      return { models };
    } catch (err: unknown) {
      return { models: [], error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ── Local Model: persistent config + routing ─────────────────────────────────

  ipcMain.handle('local:config:get', () => {
    return {
      enabled:  store.getLocalModelEnabled(),
      baseUrl:  store.getLocalModelBaseUrl(),
      model:    store.getLocalModelName(),
      fallback: store.getLocalModelFallback(),
    };
  });

  ipcMain.handle('local:config:set', async (_e, baseUrl: string, model: string) => {
    store.setLocalModelBaseUrl(baseUrl.trim());
    store.setLocalModelName(model.trim());
    return { ok: true };
  });

  ipcMain.handle('local:routing:enable', () => {
    store.setLocalModelEnabled(true);
    _getAuditLedger().log('LOCAL_MODEL_SELECTED', { metadata: { model: store.getLocalModelName(), event: 'routing_enabled' } });
    return { ok: true };
  });

  ipcMain.handle('local:routing:disable', () => {
    store.setLocalModelEnabled(false);
    return { ok: true };
  });

  ipcMain.handle('local:routing:setFallback', (_e, v: boolean) => {
    store.setLocalModelFallback(v);
    return { ok: true };
  });

  // ── Local Skill Analysis ─────────────────────────────────────────────────────
  // Runs SKILL.md content through the local model for a privacy-preserving
  // pre-analysis pass before (or instead of) the cloud-based evaluator.

  ipcMain.handle('local:skillAnalyze', async (_e, markdown: string) => {
    const enabled  = store.getLocalModelEnabled();
    const baseUrl  = store.getLocalModelBaseUrl();
    const model    = store.getLocalModelName();
    if (!enabled || !model) {
      return { ok: false, error: 'Local routing not configured' };
    }
    try {
      const p = new OllamaProvider({ baseUrl, model });
      const prompt = [
        { role: 'system', content: 'You are a security auditor reviewing AI skill definitions. Analyze the SKILL.md content below for dangerous patterns: shell execution, network exfiltration, credential scraping, policy bypass, self-modification. Respond with JSON: { riskLevel: "low"|"medium"|"high"|"critical", findings: string[], summary: string }' },
        { role: 'user',   content: markdown.slice(0, 8000) },
      ];
      const raw  = await p.chat(prompt);
      // Extract JSON from model response (may be wrapped in markdown)
      const jsonMatch = raw.match(/\{[\s\S]*\}/);
      let parsed: { riskLevel?: string; findings?: string[]; summary?: string } = {};
      if (jsonMatch) {
        try { parsed = JSON.parse(jsonMatch[0]); } catch { /* keep empty */ }
      }
      _getAuditLedger().log('LOCAL_SKILL_ANALYZED', { metadata: { model, riskLevel: parsed.riskLevel ?? 'unknown' } });
      return { ok: true, riskLevel: parsed.riskLevel, findings: parsed.findings ?? [], summary: parsed.summary ?? raw.slice(0, 300) };
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      _getAuditLedger().log('LOCAL_MODEL_FALLBACK', { metadata: { model, reason: msg } });
      return { ok: false, error: msg };
    }
  });

  // ── Insight Engine — ambient council insights ─────────────────────────────────
  ipcMain.handle('insight:analyze', async (_e, signal: InsightSignal) => {
    if (!_insightEngine) return { insight: null };
    const insight = await _insightEngine.analyze(signal);
    return { insight };
  });

  ipcMain.on('insight:reset-cooldown', () => {
    _insightEngine?.resetCooldown();
  });

  // insight:stream is a push-only channel — the router sends events automatically.
  // Expose a manual inject endpoint for renderer-triggered test/replay.
  ipcMain.on('insight:inject', (_e, insight: { type: string; message: string; confidence: number }) => {
    _insightRouter?.inject(insight as { type: 'strategy' | 'warning' | 'opportunity' | 'observation'; message: string; confidence: number });
  });

  // ── Think Tank (full consensus for complex goals) ─────────────────────────────
  ipcMain.handle('thinktank:run', async (_e, goal: string) => {
    const { intentEngine: ie } = await getEngine();
    try {
      const plan = await ie.decompose(goal);
      return { plan };
    } catch (err: unknown) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ── Voice: Speech-to-Text ─────────────────────────────────────────────────────
  ipcMain.handle('voice:transcribe', async (_e, audioBuffer: Buffer) => {
    const license = await store.getLicense();
    const tier = (license.tier ?? 'free') as 'free' | 'pro';
    if (!hasCapability('VOICE', tier)) {
      return { error: lockedError('VOICE') };
    }
    try {
      const result = await transcribeAudio(audioBuffer, store);
      return { text: result.text };
    } catch (err: unknown) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ── Voice: Text-to-Speech (streaming — first audio chunk ~300ms) ──────────────
  ipcMain.handle('voice:speak', async (event, text: string) => {
    const licSpeak = await store.getLicense();
    const tierSpeak = (licSpeak.tier ?? 'free') as 'free' | 'pro';
    if (!hasCapability('VOICE', tierSpeak)) {
      return { error: lockedError('VOICE') };
    }
    const abortCtrl = new AbortController();
    ttsAbortControllers.set(event.sender, abortCtrl);
    try {
      await textToSpeechStream(text, store, (chunk) => {
        if (!event.sender.isDestroyed())
          event.sender.send('voice:speak:chunk', chunk.toString('base64'));
      }, { signal: abortCtrl.signal });
      if (!abortCtrl.signal.aborted && !event.sender.isDestroyed())
        event.sender.send('voice:speak:done');
      return { ok: true };
    } catch (err: unknown) {
      if ((err as Error)?.name === 'AbortError') return { ok: true };
      return { error: err instanceof Error ? err.message : String(err) };
    } finally {
      ttsAbortControllers.delete(event.sender);
    }
  });

  // ── Voice: Interrupt — abort current TTS stream immediately ──────────────────
  ipcMain.handle('voice:interrupt', (event) => {
    ttsAbortControllers.get(event.sender)?.abort();
    return { ok: true };
  });

  // ── Memory ───────────────────────────────────────────────────────────────────
  ipcMain.handle('memory:get', async () => {
    const licMem = await store.getLicense();
    const tierMem = (licMem.tier ?? 'free') as 'free' | 'pro';
    return store.getMemory(getMemoryLimit(tierMem));
  });
  ipcMain.handle('memory:add', (_e, type: string, content: string) => {
    if (typeof content !== 'string' || content.trim().length === 0) return;
    if (content.length > MAX_MEMORY_CHARS) return;
    store.addMemory(type as 'fact' | 'goal' | 'preference' | 'business', content.trim());
  });
  ipcMain.handle('memory:delete', (_e, id: number) => {
    store.deleteMemory(id);
    return store.getMemory();
  });

  // ── Pattern Memory (cross-session learning) ──────────────────────────────────
  ipcMain.handle('pattern-memory:list', () => {
    return PatternMemoryService.listPatterns(store);
  });
  ipcMain.handle('pattern-memory:reset', () => {
    PatternMemoryService.resetPatterns(store);
    return { ok: true };
  });

  // ── Forge Profiles ───────────────────────────────────────────────────────────

  /** List all profiles. Requires FORGE_PROFILES capability (Pro+). */
  ipcMain.handle('forgeProfiles:list', async () => {
    const lic = await store.getLicense();
    const tier = (lic.tier ?? 'free') as 'free' | 'pro';
    if (!hasCapability('FORGE_PROFILES', tier)) {
      return { error: lockedError('FORGE_PROFILES') };
    }
    return { profiles: listProfiles() };
  });

  /** Return the currently active profile id and full profile object (no capability check — safe read). */
  ipcMain.handle('forgeProfiles:getActive', () => {
    const id = store.getActiveProfileId();
    const profile = id ? getProfile(id) ?? null : null;
    return { id, profile };
  });

  /**
   * Activate a profile: injects memory preset (idempotent), persists activeProfileId,
   * logs PROFILE_EVENT:ACTIVATE to Decision Ledger.
   */
  ipcMain.handle('forgeProfiles:activate', async (_e, id: string) => {
    const lic = await store.getLicense();
    const tier = (lic.tier ?? 'free') as 'free' | 'pro';
    if (!hasCapability('FORGE_PROFILES', tier)) {
      return { error: lockedError('FORGE_PROFILES') };
    }
    const profile = getProfile(id);
    if (!profile) return { error: `Unknown profile id: ${id}` };

    // Remove previous profile's memories before switching (guardrail: only profile-tagged entries)
    const previousId = store.getActiveProfileId();
    if (previousId && previousId !== id) {
      store.removeProfileMemories(previousId);
    }

    // Inject memory preset only if not already present (idempotent)
    if (!store.hasProfileMemories(id)) {
      // Reverse so the first entry ends up at the top of the memory list
      for (const entry of [...profile.memoryPreset].reverse()) {
        store.addMemory(entry.type, entry.content, `profile:${id}`);
      }
    }

    store.setActiveProfileId(id);

    // Log activation to Decision Ledger
    store.addLedger({
      id: `profile-${Date.now().toString(36)}`,
      timestamp: Date.now(),
      request: `Profile Activation: ${profile.name}`,
      synthesis: `Forge Profile "${profile.name}" activated. ${profile.memoryPreset.length} domain memory entries injected.`,
      responses: [],
      workflow: 'PROFILE_EVENT:ACTIVATE',
      starred: false,
    });

    return { ok: true, profile };
  });

  /**
   * Deactivate the active profile: removes profile-tagged memories, clears activeProfileId,
   * logs PROFILE_EVENT:DEACTIVATE. No capability check — deactivating is always allowed.
   */
  ipcMain.handle('forgeProfiles:deactivate', async () => {
    const id = store.getActiveProfileId();
    if (!id) return { ok: true };
    const profile = getProfile(id);
    store.removeProfileMemories(id);
    store.setActiveProfileId(null);
    store.addLedger({
      id: `profile-${Date.now().toString(36)}`,
      timestamp: Date.now(),
      request: `Profile Deactivation: ${profile?.name ?? id}`,
      synthesis: `Forge Profile "${profile?.name ?? id}" deactivated. Profile memory entries removed.`,
      responses: [],
      workflow: 'PROFILE_EVENT:DEACTIVATE',
      starred: false,
    });
    return { ok: true };
  });

  /**
   * Generate an Operational Blueprint for the given profile using the full tri-model council
   * (same Promise.allSettled pattern as chat:consensus). Saves result to Decision Ledger.
   */
  ipcMain.handle('forgeProfiles:generateBlueprint', async (event, id: string) => {
    const lic = await store.getLicense();
    const tier = (lic.tier ?? 'free') as 'free' | 'pro';
    if (!hasCapability('FORGE_PROFILES', tier)) {
      return { error: lockedError('FORGE_PROFILES') };
    }
    const profile = getProfile(id);
    if (!profile) return { error: `Unknown profile id: ${id}` };

    const { providerManager: pm } = await getEngine();
    const providers = await pm.getActiveProviders();
    if (providers.length === 0) return { error: 'No API keys configured. Add at least one in Settings.' };

    // Include a bounded slice of user memories (max 20) for personalization
    const memories = store.getMemory(20);
    const memoryContext = memories.length > 0
      ? memories.map(m => `- [${m.type}] ${m.content}`).join('\n')
      : '(no custom memories stored)';

    const fullPrompt = `${profile.blueprintPrompt}\n\nUser context from memory:\n${memoryContext}`;

    const msgs = [
      { role: 'system', content: 'You are an operational business intelligence engine. Generate structured, actionable business blueprints in clean markdown format. No preamble — begin immediately with the first section heading.' },
      { role: 'user', content: fullPrompt },
    ];

    // Tri-model: all available providers in parallel (same pattern as chat:consensus)
    event.sender.send('forge:update', { phase: 'querying', total: providers.length });

    let completedCount = 0;
    const settled = await Promise.allSettled(
      providers.map(async p => {
        event.sender.send('forge:update', { phase: 'provider:responding', provider: p.name });
        const text = await p.chat(msgs);
        completedCount++;
        event.sender.send('forge:update', { phase: 'provider:complete', provider: p.name, completedCount, total: providers.length });
        return { provider: p.name as string, text };
      })
    );

    const responses = settled
      .filter((r): r is PromiseFulfilledResult<{ provider: string; text: string }> => r.status === 'fulfilled')
      .map(r => r.value)
      .filter(r => r.text);

    if (responses.length === 0) {
      return { error: 'All providers failed. Check your API keys in Settings.' };
    }

    event.sender.send('forge:update', { phase: 'synthesis:start' });

    // Synthesize when multiple providers responded
    let markdown = responses[0].text;
    if (responses.length > 1) {
      try {
        const synthMsgs = [
          {
            role: 'system',
            content: 'You are a synthesis engine for business blueprints. Combine the following drafts into one definitive, well-structured operational blueprint in clean markdown. Preserve concrete numbers and specific recommendations. Begin immediately with the first section heading.',
          },
          {
            role: 'user',
            content: `Profile: ${profile.name}\n\nDraft blueprints:\n\n${responses.map(r => `### ${r.provider}\n${r.text}`).join('\n\n---\n\n')}\n\nSynthesize into one final, comprehensive blueprint.`,
          },
        ];
        markdown = await providers[0].chat(synthMsgs);
      } catch { /* use primary response as fallback */ }
    }

    // Save to Decision Ledger
    const ledgerEntryId = `blueprint-${Date.now().toString(36)}`;
    store.addLedger({
      id: ledgerEntryId,
      timestamp: Date.now(),
      request: `Blueprint: ${profile.name}`,
      synthesis: markdown.slice(0, 500) + (markdown.length > 500 ? '…' : ''),
      responses: responses.map(r => ({ provider: r.provider, text: r.text.slice(0, 400) })),
      workflow: 'PROFILE_EVENT:BLUEPRINT',
      starred: false,
    });

    event.sender.send('forge:update', { phase: 'complete' });

    const providerOutputs: Record<string, string> = {};
    for (const r of responses) providerOutputs[r.provider] = r.text;

    return { markdown, providers: providerOutputs, ledgerEntryId };
  });

  // ── Forge Engine — List All Engines ──────────────────────────────────────────
  ipcMain.handle('forgeEngine:listEngines', async () => {
    return ENGINE_CONFIGS.map(e => ({
      id: e.id,
      name: e.name,
      category: e.category,
      description: e.description,
      icon: e.icon,
      detail: e.detail,
      questions: e.questions,
    }));
  });

  // ── Forge Engine (Engine Mode — Phase 1) ─────────────────────────────────────
  ipcMain.handle('forgeEngine:run', async (event, { engineId, answers }: { engineId: string; answers: Record<string, string> }) => {
    const lic = await store.getLicense();
    const tier = (lic.tier ?? 'free') as 'free' | 'pro';
    if (!hasCapability('FORGE_PROFILES', tier)) {
      return { error: lockedError('FORGE_PROFILES') };
    }

    const engine = getEngineConfig(engineId);
    if (!engine) return { error: `Unknown engine type: ${engineId}` };

    const { providerManager: pm } = await getEngine();
    const providers = await pm.getActiveProviders();
    if (providers.length === 0) return { error: 'No API keys configured. Add at least one in Settings.' };

    const prompt = engine.promptTemplate(answers);
    const msgs = [
      { role: 'system', content: engine.systemPrompt },
      { role: 'user', content: prompt },
    ];

    // Tri-model parallel — same pattern as forgeProfiles:generateBlueprint
    event.sender.send('forge:update', { phase: 'querying', total: providers.length });

    let completedCount = 0;
    const settled = await Promise.allSettled(
      providers.map(async p => {
        event.sender.send('forge:update', { phase: 'provider:responding', provider: p.name });
        const text = await p.chat(msgs);
        completedCount++;
        event.sender.send('forge:update', { phase: 'provider:complete', provider: p.name, completedCount, total: providers.length });
        return { provider: p.name as string, text };
      })
    );

    const responses = settled
      .filter((r): r is PromiseFulfilledResult<{ provider: string; text: string }> => r.status === 'fulfilled')
      .map(r => r.value)
      .filter(r => r.text);

    if (responses.length === 0) {
      return { error: 'All providers failed. Check your API keys in Settings.' };
    }

    event.sender.send('forge:update', { phase: 'synthesis:start' });

    // Synthesize from multiple responses when available.
    // Prefer GPT (openai) for synthesis — most reliable JSON compliance.
    const synthProvider =
      providers.find(p => p.name === 'openai') ??
      providers.find(p => p.name === 'claude') ??
      providers[0];

    let rawOutput = responses[0].text;
    if (responses.length > 1) {
      try {
        const synthMsgs = [
          {
            role: 'system',
            content: 'You are a JSON synthesis engine. You will receive multiple JSON business engine outputs. Merge them into one superior JSON object keeping the best content from each. Return ONLY valid JSON — no prose, no markdown fences.',
          },
          {
            role: 'user',
            content: `Engine type: ${engine.name}\n\nInputs: ${JSON.stringify(answers)}\n\nDraft outputs:\n\n${responses.map(r => `// ${r.provider}:\n${r.text}`).join('\n\n')}\n\nReturn one merged JSON object with keys: blueprint, assets, buildOutput.`,
          },
        ];
        rawOutput = await synthProvider.chat(synthMsgs);
      } catch { /* fall back to primary response */ }
    }

    // Robust JSON extraction: strip fences, then find the outermost { ... } block.
    function extractJson(raw: string): string {
      const defenced = raw.replace(/^```(?:json)?\s*/im, '').replace(/\s*```\s*$/m, '').trim();
      const start = defenced.indexOf('{');
      const end   = defenced.lastIndexOf('}');
      if (start === -1 || end === -1 || end <= start) return defenced;
      return defenced.slice(start, end + 1);
    }

    let parsed: { blueprint: unknown; assets: string[]; buildOutput: unknown };
    try {
      parsed = JSON.parse(extractJson(rawOutput));
    } catch {
      // Last resort: try each individual provider response in order
      let fallbackParsed: typeof parsed | null = null;
      for (const r of responses) {
        try { fallbackParsed = JSON.parse(extractJson(r.text)); break; } catch { /* continue */ }
      }
      if (!fallbackParsed) {
        return { error: 'Engine output could not be parsed. Please try again.' };
      }
      parsed = fallbackParsed;
    }

    event.sender.send('forge:update', { phase: 'complete' });

    return {
      blueprint: parsed.blueprint ?? {},
      assets: Array.isArray(parsed.assets) ? parsed.assets : [],
      buildOutput: parsed.buildOutput ?? {},
    };
  });

  // ── Forge Engine — Execute First Step (Phase 2) ───────────────────────────
  ipcMain.handle('forgeEngine:executeFirstStep', async (_event, {
    engineId,
    blueprint,
    buildOutput,
  }: {
    engineId: string;
    blueprint: Record<string, string>;
    buildOutput: Record<string, string[]>;
  }) => {
    const lic = await store.getLicense();
    const tier = (lic.tier ?? 'free') as 'free' | 'pro';
    if (!hasCapability('FORGE_PROFILES', tier)) {
      return { error: lockedError('FORGE_PROFILES') };
    }

    const engine = getEngineConfig(engineId);
    if (!engine) return { error: `Unknown engine type: ${engineId}` };

    const { providerManager: pm } = await getEngine();
    const providers = await pm.getActiveProviders();
    if (providers.length === 0) return { error: 'No API keys configured.' };

    const prompt = engine.executionPromptTemplate(blueprint, buildOutput);
    // Single provider call — prefer GPT for instruction-following, fall back to Claude, then first available
    const provider =
      providers.find(p => p.name === 'openai') ??
      providers.find(p => p.name === 'claude') ??
      providers[0];

    const msgs = [
      {
        role: 'system',
        content: 'You are a business execution strategist. Return ONLY a valid JSON object — no prose, no markdown fences, no preamble. Zero hedging language. Every instruction is a direct action.',
      },
      { role: 'user', content: prompt },
    ];

    let raw: string;
    try {
      raw = await provider.chat(msgs);
    } catch {
      return { error: 'Execution plan generation failed. Please try again.' };
    }

    // Re-use same extraction logic
    function extractExecJson(r: string): string {
      const d = r.replace(/^```(?:json)?\s*/im, '').replace(/\s*```\s*$/m, '').trim();
      const s = d.indexOf('{');
      const e = d.lastIndexOf('}');
      if (s === -1 || e === -1 || e <= s) return d;
      return d.slice(s, e + 1);
    }

    let parsed: {
      executionPlan: { immediate: string[]; thisWeek: string[]; nextPhase: string[] };
      firstTask: { title: string; objective: string; steps: string[]; resources?: string[]; deliverable: string };
      marketing?: {
        poster?: { prompt: string; description: string };
        website?: { prompt: string; description: string };
        app?: { prompt: string; description: string };
      };
    };
    try {
      parsed = JSON.parse(extractExecJson(raw));
    } catch {
      return { error: 'Could not parse execution plan. Please try again.' };
    }

    return {
      executionPlan: parsed.executionPlan ?? { immediate: [], thisWeek: [], nextPhase: [] },
      firstTask: parsed.firstTask ?? null,
      marketing: parsed.marketing ?? null,
    };
  });

  // ── Forge Engine — Generate Image (DALL-E 3 → Grok fallback) ───────────────
  ipcMain.handle('forgeEngine:generateImage', async (_event, { prompt }: { prompt: string }) => {
    const openAiKey = await store.getSecret('triforge.openai.apiKey');
    const grokKey   = await store.getSecret('triforge.grok.apiKey');
    if (!openAiKey && !grokKey) return { error: 'No image API key configured. Add an OpenAI or Grok key in Settings → API Keys.' };

    // Try OpenAI first, then fall back to Grok
    const attempts: Array<{ name: string; url: string; key: string; body: Record<string, unknown> }> = [];
    if (openAiKey) {
      attempts.push({
        name: 'OpenAI', url: 'https://api.openai.com/v1/images/generations', key: openAiKey,
        body: { model: 'dall-e-3', prompt, n: 1, size: '1024x1024', response_format: 'b64_json' },
      });
    }
    if (grokKey) {
      attempts.push({
        name: 'Grok', url: 'https://api.x.ai/v1/images/generations', key: grokKey,
        body: { model: 'grok-2-image', prompt, n: 1, response_format: 'b64_json' },
      });
    }

    let lastError = '';
    for (const attempt of attempts) {
      try {
        const resp = await fetch(attempt.url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${attempt.key}` },
          body: JSON.stringify(attempt.body),
          signal: AbortSignal.timeout(120_000),
        });

        if (!resp.ok) {
          const err = await resp.json().catch(() => ({})) as Record<string, unknown>;
          lastError = (err as any)?.error?.message ?? `${attempt.name} image generation failed (${resp.status})`;
          continue; // try next provider
        }

        const data = await resp.json() as { data: Array<{ b64_json: string }> };
        const b64 = data.data?.[0]?.b64_json;
        if (!b64) { lastError = `${attempt.name} returned no image data.`; continue; }
        return { url: `data:image/png;base64,${b64}` };
      } catch (e) {
        lastError = e instanceof Error ? e.message : `${attempt.name} image generation failed.`;
      }
    }
    return { error: lastError || 'Image generation failed. Check your API keys and try again.' };
  });

  // ── Pro Image Generator ──────────────────────────────────────────────────────
  ipcMain.handle('image:generate', async (_event, req: import('@triforge/engine').ImageGenerationRequest) => {
    try {
      const svc    = await _getImageService(store);
      if (!svc.canGenerate()) {
        return { error: 'No image generation API key configured. Add an OpenAI or Grok API key in Settings → API Keys.' };
      }
      const result = await svc.generate(req);
      return result;
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle('image:history', async (_event, n?: number) => {
    const lic  = await store.getLicense();
    const tier = (lic.tier ?? 'free') as 'free' | 'pro';
    if (!hasCapability('FORGE_PROFILES', tier)) return { error: lockedError('FORGE_PROFILES') };
    const histStore = getImageHistoryStore(_getDataDir());
    return histStore.getRecent(n ?? 50);
  });

  ipcMain.handle('image:delete', async (_event, id: string) => {
    const lic  = await store.getLicense();
    const tier = (lic.tier ?? 'free') as 'free' | 'pro';
    if (!hasCapability('FORGE_PROFILES', tier)) return { error: lockedError('FORGE_PROFILES') };
    const histStore = getImageHistoryStore(_getDataDir());
    histStore.delete(id);
    return { ok: true };
  });

  ipcMain.handle('image:styles', async () => {
    const lic  = await store.getLicense();
    const tier = (lic.tier ?? 'free') as 'free' | 'pro';
    if (!hasCapability('FORGE_PROFILES', tier)) return { error: lockedError('FORGE_PROFILES') };
    const { STYLE_PRESETS } = require('@triforge/engine');
    return Object.keys(STYLE_PRESETS as Record<string, string>);
  });

  // ── Council Executor ─────────────────────────────────────────────────────────
  ipcMain.handle('council:execute', async (_event, request: string, category?: string) => {
    const lic  = await store.getLicense();
    const tier = (lic.tier ?? 'free') as 'free' | 'pro';
    if (!hasCapability('THINK_TANK', tier)) {
      return { error: lockedError('THINK_TANK') };
    }
    try {
      const executor = await _getCouncilExecutor();
      const result   = await executor.execute({
        request,
        category: (category ?? 'general') as import('@triforge/engine').TaskCategory,
      });
      return {
        expanded:   result.expanded,
        plan:       result.plan,
        critique:   result.critique,
        durationMs: result.durationMs,
      };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle('council:providers', async () => {
    try {
      const sel = _getProviderSelector();
      return await sel.availableProviders();
    } catch {
      return [];
    }
  });

  // ── Decision Ledger ─────────────────────────────────────────────────────────
  async function getLedgerTier(): Promise<'free' | 'pro'> {
    const lic = await store.getLicense();
    return (lic.tier ?? 'free') as 'free' | 'pro';
  }

  ipcMain.handle('ledger:get', async (_e, search?: string, limit?: number) => {
    if (!hasCapability('DECISION_LEDGER', await getLedgerTier())) return { error: lockedError('DECISION_LEDGER') };
    return store.getLedger(limit ?? 100, search ?? '');
  });

  ipcMain.handle('ledger:star', async (_e, id: string, starred: boolean) => {
    if (!hasCapability('DECISION_LEDGER', await getLedgerTier())) return { error: lockedError('DECISION_LEDGER') };
    store.starLedger(id, starred);
    return store.getLedger();
  });

  ipcMain.handle('ledger:delete', async (_e, id: string) => {
    if (!hasCapability('DECISION_LEDGER', await getLedgerTier())) return { error: lockedError('DECISION_LEDGER') };
    store.deleteLedger(id);
    return store.getLedger();
  });

  ipcMain.handle('ledger:export', async (_e, id: string | null, format: 'md' | 'pdf') => {
    if (!hasCapability('EXPORT_TOOLS', await getLedgerTier())) return { ok: false, error: lockedError('EXPORT_TOOLS') };
    const raw = id
      ? [store.getLedgerEntry(id)].filter((e): e is LedgerEntry => !!e)
      : store.getLedger();
    const markdown = formatLedgerMarkdown(raw);
    const ext = format;
    const savePath = await dialog.showSaveDialog({
      defaultPath: path.join(os.homedir(), 'Downloads', `triforge-ledger-${Date.now()}.${ext}`),
      filters: [{ name: format === 'pdf' ? 'PDF' : 'Markdown', extensions: [ext] }],
    });
    if (!savePath.filePath) return { ok: false };
    if (format === 'md') {
      await fs.promises.writeFile(savePath.filePath, markdown, 'utf8');
      shell.showItemInFolder(savePath.filePath);
      return { ok: true, path: savePath.filePath };
    }
    // PDF via hidden BrowserWindow — native Electron, no npm packages
    const html = ledgerMarkdownToHtml(markdown);
    let win: BrowserWindow | null = null;
    try {
      win = new BrowserWindow({ show: false, webPreferences: { nodeIntegration: false } });
      await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(html));
      const pdfBuf = await win.webContents.printToPDF({ printBackground: false });
      await fs.promises.writeFile(savePath.filePath, pdfBuf);
      shell.showItemInFolder(savePath.filePath);
      return { ok: true, path: savePath.filePath };
    } finally {
      win?.destroy();
    }
  });

  // ── User profile ──────────────────────────────────────────────────────────────
  ipcMain.handle('profile:get', () => store.getUserProfile());
  ipcMain.handle('profile:set', (_e, profile: Record<string, string>) => {
    store.setUserProfile(profile);
  });

  // ── Session Auth (PIN lock) ───────────────────────────────────────────────────
  ipcMain.handle('auth:status', () => {
    const auth = store.getAuth();
    return { hasPin: store.hasAuth(), username: auth.username };
  });

  ipcMain.handle('auth:setup', (_e, username: string, pin: string) => {
    if (!username.trim()) return { ok: false, error: 'Username is required.' };
    if (!isValidPin(pin)) return { ok: false, error: 'PIN must be exactly 7 digits.' };
    const { hash, salt } = hashPin(pin);
    store.setAuth(username.trim(), hash, salt);
    return { ok: true };
  });

  ipcMain.handle('auth:verify', (_e, username: string, pin: string) => {
    const stored = store.getAuth();
    if (!stored.pinHash || !stored.salt || !stored.username) return { valid: false };
    if (stored.username.toLowerCase() !== username.trim().toLowerCase()) return { valid: false };
    return { valid: verifyPin(pin, stored.pinHash, stored.salt) };
  });

  ipcMain.handle('auth:clear', () => {
    store.clearAuth();
    return { ok: true };
  });

  // ── File System ──────────────────────────────────────────────────────────────
  ipcMain.handle('files:commonDirs', () => getCommonDirs());

  ipcMain.handle('files:listDir', (_e, dirPath: string) => {
    const perms = store.getPermissions();
    const filesGranted = perms.find(p => p.key === 'files')?.granted;
    if (!filesGranted) return { files: [], subdirs: [], error: 'PERMISSION_DENIED:files' };
    return listDirectory(dirPath);
  });

  ipcMain.handle('files:scanPhotos', (_e, startPath?: string) => {
    const perms = store.getPermissions();
    const filesGranted = perms.find(p => p.key === 'files')?.granted;
    if (!filesGranted) return { photos: [], error: 'PERMISSION_DENIED:files' };
    const photos = scanForPhotos(startPath);
    return { photos };
  });

  ipcMain.handle('files:organize', (_e, dirPath: string) => {
    const perms = store.getPermissions();
    const filesGranted = perms.find(p => p.key === 'files')?.granted;
    if (!filesGranted) return { moved: 0, folders: [], errors: ['PERMISSION_DENIED:files'] };
    return organizeDirectory(dirPath);
  });

  ipcMain.handle('files:organizeDeep', (_e, dirPath: string) => {
    const perms = store.getPermissions();
    const filesGranted = perms.find(p => p.key === 'files')?.granted;
    if (!filesGranted) return { moved: 0, folders: [], errors: ['PERMISSION_DENIED:files'], directoriesScanned: 0 };
    return organizeDirectoryDeep(dirPath);
  });

  ipcMain.handle('files:searchPhotos', (_e, query: string, startPath?: string) => {
    const perms = store.getPermissions();
    const filesGranted = perms.find(p => p.key === 'files')?.granted;
    if (!filesGranted) return { photos: [], error: 'PERMISSION_DENIED:files' };
    return { photos: searchPhotos(query, startPath) };
  });

  ipcMain.handle('files:findSimilar', (_e, refPath: string, startPath?: string) => {
    const perms = store.getPermissions();
    const filesGranted = perms.find(p => p.key === 'files')?.granted;
    if (!filesGranted) return { photos: [], error: 'PERMISSION_DENIED:files' };
    return { photos: findSimilarPhotos(refPath, startPath) };
  });

  ipcMain.handle('files:moveFiles', (_e, srcPaths: string[], destDir: string) => {
    const perms = store.getPermissions();
    const filesGranted = perms.find(p => p.key === 'files')?.granted;
    if (!filesGranted) return { moved: 0, errors: ['PERMISSION_DENIED:files'] };
    return moveFiles(srcPaths, destDir);
  });

  ipcMain.handle('files:readFile', async (_e, filePath: string) => {
    const perms = store.getPermissions();
    if (!perms.find(p => p.key === 'files')?.granted) return { error: 'PERMISSION_DENIED:files' };
    try {
      const stats = fs.statSync(filePath);
      const MAX_BYTES = 200_000;
      const sampleLen = Math.min(512, stats.size);
      if (sampleLen > 0) {
        const sample = Buffer.alloc(sampleLen);
        const fd = fs.openSync(filePath, 'r');
        fs.readSync(fd, sample, 0, sampleLen, 0);
        fs.closeSync(fd);
        if (sample.includes(0)) return { error: 'BINARY_FILE', size: stats.size };
      }
      const raw = fs.readFileSync(filePath, { encoding: 'utf8', flag: 'r' });
      const truncated = stats.size > MAX_BYTES;
      return { content: truncated ? raw.slice(0, MAX_BYTES) : raw, truncated, size: stats.size };
    } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
  });

  ipcMain.handle('files:writeFile', async (_e, filePath: string, content: string) => {
    if (!store.getPermissions().find(p => p.key === 'files')?.granted)
      return { error: 'PERMISSION_DENIED:files' };
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(filePath, content, 'utf8');
      return { ok: true };
    } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
  });

  ipcMain.handle('files:openFile', (_e, filePath: string) => {
    shell.openPath(filePath);
  });

  ipcMain.handle('files:showInFolder', (_e, filePath: string) => {
    shell.showItemInFolder(filePath);
  });

  ipcMain.handle('files:pickFile', async (_e, filters?: Electron.FileFilter[]) => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile'],
      filters: filters ?? [{ name: 'All Files', extensions: ['*'] }],
    });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('files:pickDir', async () => {
    const result = await dialog.showOpenDialog({ properties: ['openDirectory'] });
    return result.canceled ? null : result.filePaths[0];
  });

  // ── Document Indexer ──────────────────────────────────────────────────────────

  ipcMain.handle('docs:getIndex', (_e) => {
    const perms = store.getPermissions();
    const filesGranted = perms.find(p => p.key === 'files')?.granted;
    if (!filesGranted) return { docs: [], error: 'PERMISSION_DENIED:files' };
    return { docs: store.get<DocEntry[]>('docIndex', []) };
  });

  ipcMain.handle('docs:index', async (event, startPath?: string) => {
    const perms = store.getPermissions();
    const filesGranted = perms.find(p => p.key === 'files')?.granted;
    if (!filesGranted) return { docs: [], error: 'PERMISSION_DENIED:files' };

    const files = scanForDocuments(startPath);
    const existing = store.get<DocEntry[]>('docIndex', []);

    // Only OCR files that are new or have changed since last index
    const toProcess = files.filter(f =>
      !existing.some(e => e.path === f.path && e.modified === f.modified)
    );

    event.sender.send('docs:progress', { phase: 'start', total: toProcess.length, existing: existing.length });

    // Keep already-valid entries for files still present on disk
    const retained = existing.filter(e => files.some(f => f.path === e.path));
    const results: DocEntry[] = [...retained];

    const langPath = path.join(app.getPath('userData'), 'tesseract-lang');
    if (!fs.existsSync(langPath)) { try { fs.mkdirSync(langPath, { recursive: true }); } catch { /* ignore */ } }

    // Process in batches of 3 concurrent workers
    for (let i = 0; i < toProcess.length; i += 3) {
      const batch = toProcess.slice(i, i + 3);
      const settled = await Promise.allSettled(
        batch.map(f =>
          ocrFile(f.path, langPath).then(text => ({
            path: f.path,
            name: f.name,
            size: f.size,
            modified: f.modified,
            extension: f.extension,
            ocrText: text,
            docTypes: detectDocTypes(text),
            indexedAt: new Date().toISOString(),
          } as DocEntry))
        )
      );
      settled.forEach((r, j) => {
        if (r.status === 'fulfilled') results.push(r.value);
        event.sender.send('docs:progress', {
          phase: 'indexed',
          current: i + j + 1,
          total: toProcess.length,
          name: batch[j].name,
        });
      });
    }

    store.update('docIndex', results);
    event.sender.send('docs:progress', { phase: 'complete', total: results.length });
    return { docs: results };
  });

  ipcMain.handle('docs:search', (_e, query: string) => {
    const perms = store.getPermissions();
    const filesGranted = perms.find(p => p.key === 'files')?.granted;
    if (!filesGranted) return { results: [], error: 'PERMISSION_DENIED:files' };
    const index = store.get<DocEntry[]>('docIndex', []);
    if (index.length === 0) return { results: [], needsIndex: true };
    return { results: searchIndex(index, query) };
  });

  // ── Printer ───────────────────────────────────────────────────────────────────
  ipcMain.handle('print:list', async () => {
    const perms = store.getPermissions();
    const printerGranted = perms.find(p => p.key === 'printer')?.granted;
    if (!printerGranted) return { printers: [], error: 'PERMISSION_DENIED:printer' };
    const printers = await listPrinters();
    return { printers };
  });

  ipcMain.handle('print:file', async (_e, filePath: string, printerName?: string) => {
    const perms = store.getPermissions();
    const printerGranted = perms.find(p => p.key === 'printer')?.granted;
    if (!printerGranted) return { ok: false, error: 'PERMISSION_DENIED:printer' };
    return printFile(filePath, printerName);
  });

  ipcMain.handle('print:text', async (_e, content: string, printerName?: string) => {
    const perms = store.getPermissions();
    const printerGranted = perms.find(p => p.key === 'printer')?.granted;
    if (!printerGranted) return { ok: false, error: 'PERMISSION_DENIED:printer' };
    return printText(content, printerName);
  });

  // ── System ───────────────────────────────────────────────────────────────────
  ipcMain.handle('system:openExternal', (_e, url: string) => {
    // Only allow http/https URLs — block javascript:, file:, and other schemes
    try {
      const parsed = new URL(url);
      if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return;
    } catch {
      return; // invalid URL
    }
    shell.openExternal(url);
  });

  // ── Execution Plans ───────────────────────────────────────────────────────────

  // Shared helper — builds an ExecutionPlan from a free-text synthesis/goal using
  // the first active provider. Extracted so both plan:generate and task:run reuse
  // the same prompt without duplication.
  async function generateExecutionPlan(synthesis: string, provider: { chat: (msgs: { role: string; content: string }[]) => Promise<string> }) {
    const prompt = `You are an execution planning engine. Convert the provided synthesis into a structured, step-by-step action plan for a non-technical user.

Output ONLY valid JSON matching this EXACT schema (no markdown fences, no explanation text):
{
  "planTitle": "Short title, max 6 words",
  "riskLevel": "Low|Medium|High",
  "summary": "One sentence describing what this plan accomplishes",
  "steps": [
    {
      "id": "step-1",
      "title": "Short action title, max 8 words",
      "type": "review|browser|file|research|decision|command|print",
      "description": "Clear, actionable instruction the user should follow",
      "details": "URL, file path, specific resource, or command — omit if not applicable",
      "requiresApproval": true,
      "risk": "Low|Medium|High"
    }
  ]
}

Step type guide:
- review: User reads/reviews provided information (no system action needed)
- browser: Open a specific URL in the browser — MUST include a real URL in details
- file: Open or interact with a file on the computer
- research: TriForge AI researches a sub-topic for more detail
- decision: User must make a choice before proceeding
- command: Run a terminal command (read-only safe commands only: ls, dir, type, echo, whoami)
- print: Print a document or content

Rules:
- 3 to 7 steps maximum
- Every step must have requiresApproval: true
- Steps that modify files or run commands get risk: "High"
- "browser" steps MUST have a real URL in "details"
- "command" steps must only use safe read-only commands
- Make steps practical for a non-technical user

Synthesis to convert:
${synthesis.slice(0, 3000)}`;

    const msgs = [
      { role: 'system', content: 'You are a JSON execution plan generator. Output ONLY valid JSON — no markdown fences, no explanation. Start immediately with { and end with }.' },
      { role: 'user', content: prompt },
    ];
    const response = await provider.chat(msgs);
    const cleaned = response.trim()
      .replace(/^```(?:json)?\r?\n?/, '')
      .replace(/\r?\n?```$/, '');
    return JSON.parse(cleaned);
  }

  ipcMain.handle('plan:generate', async (_e, synthesis: string) => {
    const { providerManager: pm } = await getEngine();
    const providers = await pm.getActiveProviders();
    if (providers.length === 0) return { error: 'No API keys configured.' };
    const licPlan = await store.getLicense();
    const tierPlan = (licPlan.tier ?? 'free') as 'free' | 'pro';
    if (!hasCapability('EXECUTION_PLANS', tierPlan)) return { error: lockedError('EXECUTION_PLANS') };
    try {
      const plan = await generateExecutionPlan(synthesis, providers[0]);
      return { plan };
    } catch (err: unknown) {
      return { error: err instanceof Error ? err.message : 'Failed to generate plan.' };
    }
  });

  // Task runtime — decomposes goal with IntentEngine, generates an ExecutionPlan,
  // emits task:update events for live progress, and logs the plan to the Ledger.
  ipcMain.handle('task:run', async (event, goal: string) => {
    if (typeof goal !== 'string' || goal.trim().length === 0) return { error: 'Goal is required.' };
    if (goal.length > MAX_MESSAGE_CHARS) return { error: `Goal too long (max ${MAX_MESSAGE_CHARS} chars).` };

    const licTask = await store.getLicense();
    const tierTask = (licTask.tier ?? 'free') as 'free' | 'pro';
    if (!hasCapability('EXECUTION_PLANS', tierTask)) return { error: lockedError('EXECUTION_PLANS') };

    const { providerManager: pm, intentEngine: ie } = await getEngine();
    const providers = await pm.getActiveProviders();
    if (providers.length === 0) return { error: 'No API keys configured.' };

    // Phase 1 — Decompose with IntentEngine for a richer goal statement
    event.sender.send('task:update', { phase: 'decomposing' });
    let enrichedGoal = goal.trim();
    try {
      const intent = await ie.decompose(goal);
      if (intent?.goalStatement) enrichedGoal = intent.goalStatement;
    } catch { /* fall through with raw goal */ }

    // Phase 2 — Generate the structured execution plan
    event.sender.send('task:update', { phase: 'planning' });
    try {
      const plan = await generateExecutionPlan(enrichedGoal, providers[0]);

      // Log to Ledger with task workflow tag
      const taskId = crypto.randomUUID();
      store.addLedger({
        id: taskId,
        timestamp: Date.now(),
        request: goal,
        synthesis: plan.summary ?? enrichedGoal,
        workflow: 'TASK_EVENT:PLAN',
        starred: false,
      });

      event.sender.send('task:update', { phase: 'ready' });
      return { plan, summary: enrichedGoal, taskId };
    } catch (err: unknown) {
      return { error: err instanceof Error ? err.message : 'Failed to generate task plan.' };
    }
  });

  // Only safe read-only commands are permitted
  const SAFE_COMMAND_BASES = new Set(['ls', 'dir', 'pwd', 'echo', 'type', 'cat', 'whoami', 'hostname', 'date', 'ver']);

  ipcMain.handle('plan:runCommand', async (_e, cmd: string) => {
    const perms = store.getPermissions();
    const terminalGranted = perms.find(p => p.key === 'terminal')?.granted;
    if (!terminalGranted) return { error: 'PERMISSION_DENIED:terminal — enable Terminal permission in Settings first.' };

    const base = cmd.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
    if (!SAFE_COMMAND_BASES.has(base)) {
      return { error: `"${base}" is not on the safe-command allowlist. Run it manually in your terminal.` };
    }

    try {
      const output = execSync(cmd, { timeout: 10000, encoding: 'utf8', maxBuffer: 100 * 1024 });
      return { output };
    } catch (err: unknown) {
      return { error: err instanceof Error ? err.message : 'Command failed.' };
    }
  });

  // ── App Builder ───────────────────────────────────────────────────────────────
  ipcMain.handle('appbuilder:generate', async (_e, spec: { appType: string; audience: string; features: string; dataSave: string; style: string; extras: string }) => {
    const { providerManager: pm } = await getEngine();
    const providers = await pm.getActiveProviders();
    if (providers.length === 0) {
      return { error: 'No API keys configured. Add at least one in Settings.' };
    }

    const wantsAccounts = /account|login|sign.?in|user|auth/i.test(spec.dataSave);
    const wantsSave    = !/no|none|fresh|don.?t|do not/i.test(spec.dataSave);
    let dataNotes = '';
    if (wantsAccounts) {
      dataNotes = `- Use localStorage to persist all data locally (no real backend)
- Show a clear notice in the app UI: "Data is saved on this device only. For multi-device sync or real accounts, a backend service would be needed."`;
    } else if (wantsSave) {
      dataNotes = `- Use localStorage to persist all user data so it survives page refreshes and browser restarts
- Auto-save on every change — no manual save button needed`;
    } else {
      dataNotes = `- No data persistence needed — app resets on refresh`;
    }

    // Inject active Forge Profile scaffold hint if one is set
    const activeForgeProfile = getProfile(store.getActiveProfileId() ?? '');
    const scaffoldNote = activeForgeProfile
      ? `\nForge Profile — ${activeForgeProfile.name}: ${activeForgeProfile.appScaffold.description} Prioritize these modules: ${activeForgeProfile.appScaffold.modules.join(', ')}.`
      : '';

    const prompt = `Build a complete, self-contained web application:

App Type: ${spec.appType}
Target Users: ${spec.audience}
Core Features: ${spec.features}
Data / Persistence: ${spec.dataSave}
Visual Style: ${spec.style}${spec.extras ? `\nExtra Requirements: ${spec.extras}` : ''}${scaffoldNote}

Technical requirements:
- Single HTML file with ALL CSS and JavaScript inline (no external dependencies, no CDN)
- Professional, polished, mobile-responsive design
- All features functional and interactive with realistic sample data
${dataNotes}
- Smooth UX: hover effects, transitions, clear empty states, helpful placeholder text

Reply with ONLY the complete HTML. Start immediately with <!DOCTYPE html> and end with </html>. No markdown, no explanations.`;

    try {
      const primary = providers[0];
      const response = await primary.chat([
        { role: 'system', content: 'You are an expert full-stack web developer. When asked to build an app, output ONLY the complete single-file HTML — no explanations, no markdown fences, just raw HTML starting with <!DOCTYPE html>.' },
        { role: 'user', content: prompt },
      ]);
      // Log Profile scaffold event to Decision Ledger when a profile influenced the build
      if (activeForgeProfile) {
        store.addLedger({
          id: `scaffold-${Date.now().toString(36)}`,
          timestamp: Date.now(),
          request: `App Scaffold: ${spec.appType}`,
          synthesis: `App Builder generated with Forge Profile "${activeForgeProfile.name}" scaffold context. Modules: ${activeForgeProfile.appScaffold.modules.join(', ')}.`,
          responses: [],
          workflow: 'PROFILE_EVENT:APP_SCAFFOLD',
          starred: false,
        });
      }
      return { html: response };
    } catch (err: unknown) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('appbuilder:save', async (_e, appName: string, html: string) => {
    try {
      const desktop = app.getPath('desktop');
      const buildDir = path.join(desktop, 'TriForge Builds', appName);
      await fs.promises.mkdir(buildDir, { recursive: true });
      await fs.promises.writeFile(path.join(buildDir, 'index.html'), html, 'utf8');
      return { path: buildDir };
    } catch (err: unknown) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // Write HTML to a temp file and open it in the user's default browser
  ipcMain.handle('appbuilder:openPreview', async (_e, html: string) => {
    try {
      const tmpFile = path.join(os.tmpdir(), `triforge-preview-${Date.now()}.html`);
      await fs.promises.writeFile(tmpFile, html, 'utf8');
      await shell.openPath(tmpFile);
      return { ok: true };
    } catch (err: unknown) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // Analyze the generated app and return a plain-English guide for every 3rd-party service it needs
  ipcMain.handle('appbuilder:analyze', async (_e,
    spec: { appType: string; audience: string; features: string; dataSave: string; style: string; extras: string },
    html: string,
  ) => {
    const licAb = await store.getLicense();
    const tierAb = (licAb.tier ?? 'free') as 'free' | 'pro';
    if (!hasCapability('APP_ANALYSIS', tierAb)) return { services: [], error: lockedError('APP_ANALYSIS') };
    const { providerManager: pm } = await getEngine();
    const providers = await pm.getActiveProviders();
    if (providers.length === 0) return { services: [] };

    const specSummary = [
      `App type: ${spec.appType}`,
      `Users: ${spec.audience}`,
      `Features: ${spec.features}`,
      `Data saving: ${spec.dataSave}`,
      spec.extras ? `Extra: ${spec.extras}` : '',
    ].filter(Boolean).join(' | ');

    // Send only the first 4000 chars of HTML to keep tokens low
    const htmlSnippet = html.slice(0, 4000);

    const prompt = `You are a friendly tech advisor helping a non-technical person understand what third-party services their new web app would need to be fully production-ready.

App description: ${specSummary}

Generated app (first part of HTML):
${htmlSnippet}

Identify ONLY services the app genuinely needs to work as described beyond what localStorage can provide.
Examples: user authentication, a real database, payment processing, email sending, SMS, maps, real-time sync, file storage.
Do NOT list: localStorage, CSS frameworks, icon libraries, or anything already self-contained in the HTML.

For each service, respond in this EXACT JSON format (array):
[
  {
    "name": "Service Name",
    "emoji": "fitting emoji",
    "tagline": "5 words or less — what it does",
    "what": "One plain-English sentence. No jargon. Imagine explaining to a grandparent.",
    "where": "https://official-website.com",
    "why": "One sentence: why does THIS specific app need it?",
    "how": [
      "Step 1 — plain action (e.g., Go to supabase.com and click Start for Free)",
      "Step 2 — plain action",
      "Step 3 — plain action",
      "Step 4 — plain action (optional)"
    ],
    "free": true,
    "freeNote": "e.g., Free up to 500MB, no credit card needed"
  }
]

If the app works fine with browser localStorage and needs no external services, return exactly: []

Respond with ONLY the JSON array. No markdown. No explanation before or after.`;

    try {
      const primary = providers[0];
      const response = await primary.chat([
        {
          role: 'system',
          content: 'You are a helpful technical advisor. You output ONLY valid JSON arrays — no markdown fences, no explanation text, just the raw JSON array starting with [ and ending with ].',
        },
        { role: 'user', content: prompt },
      ]);

      const text = (response as string).trim()
        .replace(/^```(?:json)?\r?\n?/, '')
        .replace(/\r?\n?```$/, '');

      const parsed = JSON.parse(text);
      return { services: Array.isArray(parsed) ? parsed : [] };
    } catch {
      return { services: [] };
    }
  });

  // ── Window controls ─────────────────────────────────────────────────────────

  ipcMain.handle('window:minimize', (event) => {
    BrowserWindow.fromWebContents(event.sender)?.minimize();
  });

  ipcMain.handle('window:toggleFullscreen', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender);
    if (!win) return false;
    win.setFullScreen(!win.isFullScreen());
    return win.isFullScreen();
  });

  ipcMain.handle('window:isFullscreen', (event) => {
    return BrowserWindow.fromWebContents(event.sender)?.isFullScreen() ?? false;
  });

  // ── Per-window TTS abort controllers (for voice:interrupt support) ────────────

  const ttsAbortControllers = new Map<Electron.WebContents, AbortController>();

  // ── Grok Voice Agent (per-window — each WebContents gets its own agent) ────────

  const grokAgents = new Map<Electron.WebContents, GrokVoiceAgent>();

  ipcMain.handle('voice:agent:connect', async (event, opts: { voice?: string }) => {
    const apiKey = await store.getSecret('triforge.grok.apiKey');
    if (!apiKey) return { error: 'No Grok API key configured.' };
    // Disconnect any existing agent for this window
    grokAgents.get(event.sender)?.disconnect();
    const agent = new GrokVoiceAgent(apiKey, opts?.voice ?? 'Ara', (e) => {
      if (!event.sender.isDestroyed()) event.sender.send('voice:agent:event', e);
      // Persist assistant transcripts to memory so voice interactions stay in context
      if (e.type === 'transcript' && e.role === 'assistant' && e.text)
        store.addMemory('fact', `[Voice] ${e.text}`);
    });
    grokAgents.set(event.sender, agent);
    agent.connect();
    // Clean up entry when window is destroyed
    event.sender.once('destroyed', () => {
      grokAgents.get(event.sender)?.disconnect();
      grokAgents.delete(event.sender);
    });
    return { ok: true };
  });

  ipcMain.handle('voice:agent:send', (event, pcm16b64: string) => {
    grokAgents.get(event.sender)?.sendAudio(Buffer.from(pcm16b64, 'base64'));
  });

  ipcMain.handle('voice:agent:commit', (event) => {
    grokAgents.get(event.sender)?.commitAudio();
  });

  ipcMain.handle('voice:agent:disconnect', (event) => {
    grokAgents.get(event.sender)?.disconnect();
    grokAgents.delete(event.sender);
  });

  // ── Task Engine ───────────────────────────────────────────────────────────────

  async function _agentTier(): Promise<'free' | 'pro'> {
    const tier = (await store.getLicense()).tier ?? 'free';
    return (tier === 'business' ? 'pro' : tier) as 'free' | 'pro';
  }

  ipcMain.handle('taskEngine:createTask', async (_event, goal: string, category: TaskCategory) => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    try {
      const loop = _getAgentLoop(store);
      const task = loop.createTask(goal, category);
      return { task };
    } catch (err) {
      return { error: String(err) };
    }
  });

  ipcMain.handle('taskEngine:runTask', async (_event, taskId: string, trustOverride?: TrustModeSnapshot) => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    try {
      const loop = _getAgentLoop(store);

      // Section 10: Audit trust override before it reaches the agent loop.
      // Any renderer-supplied trust escalation is logged unconditionally.
      if (trustOverride) {
        const overriddenCategories = Object.keys(trustOverride);
        eventBus.emit({
          type:       'TRUST_OVERRIDE_APPLIED',
          taskId,
          categories: overriddenCategories,
        });
        console.warn(
          `[security] TRUST_OVERRIDE_APPLIED for task ${taskId} — categories: ${overriddenCategories.join(', ')}`,
        );
      }

      // Fire in background — events delivered by persistent forwarder
      loop.runTask(taskId, trustOverride).catch((err: unknown) => console.error('[taskEngine:runTask]', err));
      return { ok: true, started: true };
    } catch (err) {
      return { error: String(err) };
    }
  });

  ipcMain.handle('taskEngine:approveStep', async (_event, taskId: string, stepId: string) => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    try {
      await _getAgentLoop(store).approveStep(taskId, stepId);
      return { ok: true };
    } catch (err) {
      return { error: String(err) };
    }
  });

  ipcMain.handle('taskEngine:denyStep', async (_event, taskId: string, stepId: string, reason?: string) => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    try {
      await _getAgentLoop(store).denyStep(taskId, stepId, reason);
      return { ok: true };
    } catch (err) {
      return { error: String(err) };
    }
  });

  ipcMain.handle('taskEngine:cancelTask', async (_event, taskId: string) => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    try {
      await _getAgentLoop(store).cancelTask(taskId);
      return { ok: true };
    } catch (err) {
      return { error: String(err) };
    }
  });

  ipcMain.handle('taskEngine:getTask', async (_event, taskId: string) => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    const task = _getTaskStore().read(taskId);
    return { task };
  });

  ipcMain.handle('taskEngine:listTasks', async (_event, filter?: { category?: TaskCategory; status?: TaskStatus }) => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    const tasks = _getTaskStore().list(filter);
    return { tasks };
  });

  // ── Trust config ──────────────────────────────────────────────────────────────

  ipcMain.handle('trust:getConfig', async () => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    const config = store.get<TrustModeSnapshot>(TRUST_KEY, DEFAULT_TRUST_SNAPSHOT);
    return { config };
  });

  ipcMain.handle('trust:setConfig', async (_event, config: TrustModeSnapshot) => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    const errors = validateTrustMode(config);
    if (errors.length > 0) return { error: errors.join('; ') };
    store.update(TRUST_KEY, config);
    return { ok: true };
  });

  // ── Wallet ────────────────────────────────────────────────────────────────────

  ipcMain.handle('wallet:getBalance', async () => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    const snapshot = _getWalletEngine(store).getSnapshot();
    return { snapshot };
  });

  // ── Paper Trading Engine ──────────────────────────────────────────────────────

  const paperEngine = new PaperEngine(store);
  paperEngine.init();

  async function _tradeTier(): Promise<'free' | 'pro' | 'business'> {
    return ((await store.getLicense()).tier ?? 'free') as 'free' | 'pro';
  }

  ipcMain.handle('wallet:paperBalance:get', async () => {
    if (!hasCapability('FINANCE_DASHBOARD', await _tradeTier())) return { error: lockedError('FINANCE_DASHBOARD') };
    return { balance: paperEngine.getBalance() };
  });

  ipcMain.handle('wallet:paperBalance:set', async (_e, amount: number) => {
    if (!hasCapability('FINANCE_DASHBOARD', await _tradeTier())) return { error: lockedError('FINANCE_DASHBOARD') };
    if (typeof amount !== 'number' || amount < 0 || !isFinite(amount)) {
      return { error: 'Invalid balance amount.' };
    }
    paperEngine.setBalance(amount);
    return { ok: true, balance: amount };
  });

  ipcMain.handle('wallet:paperTrade', async (_e, trade: {
    ticker: string;
    side: 'long' | 'short';
    thesis: string;
    entry: number;
    stop: number;
    target: number;
    size: number;
    riskPercent: number;
    balance: number;
  }) => {
    if (!hasCapability('FINANCE_DASHBOARD', await _tradeTier())) return { error: lockedError('FINANCE_DASHBOARD') };
    if (!trade.ticker || !trade.entry || !trade.stop) {
      return { error: 'Missing required fields: ticker, entry, stop.' };
    }
    if (trade.entry === trade.stop) {
      return { error: 'Entry and stop cannot be the same price.' };
    }
    const position = paperEngine.openPosition({
      ticker:      trade.ticker,
      side:        trade.side,
      entryPrice:  trade.entry,
      stopPrice:   trade.stop,
      targetPrice: trade.target,
      size:        trade.size,
      riskPercent: trade.riskPercent,
      thesis:      trade.thesis,
    });
    // Also log to ledger for audit trail
    store.addLedger({
      id:        position.id,
      timestamp: Date.now(),
      workflow:  'PAPER_TRADE',
      summary:   `Paper ${trade.side.toUpperCase()} ${trade.ticker} — Entry: ${trade.entry}, Stop: ${trade.stop}, Target: ${trade.target}, Size: ${trade.size} shares, Risk: ${trade.riskPercent.toFixed(1)}%`,
      data:      trade,
    } as any);
    return { ok: true, tradeId: position.id, position };
  });

  ipcMain.handle('wallet:paperState', async (_e, lastPriceByTicker?: Record<string, number>) => {
    if (!hasCapability('FINANCE_DASHBOARD', await _tradeTier())) return { error: lockedError('FINANCE_DASHBOARD') };
    return { state: paperEngine.getState(lastPriceByTicker) };
  });

  ipcMain.handle('wallet:paperClose', async (_e, params: { id: string; exitPrice: number; reason: 'manual' | 'stop' | 'target' }) => {
    if (!hasCapability('FINANCE_DASHBOARD', await _tradeTier())) return { error: lockedError('FINANCE_DASHBOARD') };
    if (!params.id || !params.exitPrice) {
      return { error: 'Missing required fields: id, exitPrice.' };
    }
    const closed = paperEngine.closePosition(params.id, params.exitPrice, params.reason ?? 'manual');
    if (!closed) return { error: 'Position not found.' };
    return { ok: true, trade: closed };
  });

  ipcMain.handle('wallet:paperReset', async (_e, newBalance?: number) => {
    if (!hasCapability('FINANCE_DASHBOARD', await _tradeTier())) return { error: lockedError('FINANCE_DASHBOARD') };
    paperEngine.reset(newBalance);
    return { ok: true, balance: paperEngine.getBalance() };
  });

  // ── Live Trade Advisor / Tradovate ────────────────────────────────────────────

  tradovateService.init(store);
  // Attempt to restore a previous Tradovate session using persisted credentials.
  // Runs in the background; UI polls status independently so no await needed.
  void tradovateService.autoConnect();

  ipcMain.handle('trading:tradovateConnect', async (_e, creds: {
    username: string;
    password: string;
    accountMode: 'simulation' | 'live';
    cid?: number;
    sec?: string;
  }) => {
    if (!hasCapability('FINANCE_TRADING', await _tradeTier())) return { error: lockedError('FINANCE_TRADING') };
    return tradovateService.connect(creds);
  });

  // Trading trial status — always available so UI can show banner.
  ipcMain.handle('trading:trialStatus', () => {
    return tradingTrialStatus();
  });

  // Always available — user must be able to see and clear connection status.
  ipcMain.handle('trading:tradovateStatus', () => {
    return tradovateService.status();
  });

  ipcMain.handle('trading:tradovateSnapshot', async (_e, symbol: string) => {
    if (!hasCapability('FINANCE_DASHBOARD', await _tradeTier())) return { snapshot: null };
    const snapshot = tradovateService.getSnapshot(symbol);
    return { snapshot };
  });

  // Unified market state: snapshot + bars + source in one payload.
  ipcMain.handle('trading:marketState', async () => {
    return { marketState: shadowTradingController.getMarketState() };
  });

  // Always available — user must be able to disconnect regardless of tier.
  ipcMain.handle('trading:tradovateDisconnect', async () => {
    await tradovateService.forget();
    return { ok: true };
  });

  // ── Tastytrade (free paper-account live data) ───────────────────────────────

  ipcMain.handle('trading:tastytradeConnect', async (_e, creds: { username: string; password: string }) => {
    try {
      await tastytradeProvider.connect(creds.username, creds.password);
      // Re-push the active symbol so the deferred subscription fires when the
      // dxLink feed channel opens (fixes race: symbol selected before connect).
      shadowTradingController.setActiveSymbol(shadowTradingController.getActiveSymbol());
      return { ok: true };
    } catch (err) {
      if (err instanceof TastytradeDeviceChallengeError) {
        return { deviceChallenge: true, challengeType: err.challengeType };
      }
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('trading:tastytradeVerifyDevice', async (_e, otp: string) => {
    try {
      await tastytradeProvider.verifyDevice(otp);
      // Re-push the active symbol so the deferred subscription fires when the
      // dxLink feed channel opens (fixes race: symbol selected before connect).
      shadowTradingController.setActiveSymbol(shadowTradingController.getActiveSymbol());
      return { ok: true };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('trading:tastytradeResendChallenge', async () => {
    try {
      const sent = await tastytradeProvider.resendDeviceChallenge();
      return { ok: true, sent };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('trading:tastytradeDisconnect', () => {
    tastytradeProvider.disconnect();
    return { ok: true };
  });

  ipcMain.handle('trading:tastytradeStatus', () => {
    return {
      connected:  tastytradeProvider.isConnected(),
      authState:  tastytradeProvider.authState(),
      symbol:     tastytradeProvider.activeSymbol(),
    };
  });

  ipcMain.handle('trading:tradovateAccountState', async () => {
    if (!hasCapability('FINANCE_TRADING', await _tradeTier())) return { state: null };
    const state = await tradovateService.getAccountState();
    return { state };
  });

  ipcMain.handle('trading:buildAdvice', async (_e, input: {
    snapshot: unknown;
    balance: number;
    riskPercent: number;
    symbol: string;
    side: 'long' | 'short';
    thesis?: string;
    entry?: number;
    stop?: number;
    target?: number;
  }) => {
    if (!hasCapability('FINANCE_DASHBOARD', await _tradeTier())) return { error: lockedError('FINANCE_DASHBOARD') };
    const result = buildLiveTradeAdvice(input as Parameters<typeof buildLiveTradeAdvice>[0]);
    return { result };
  });

  ipcMain.handle('trading:buildTradeLevels', async (_e, symbol: string) => {
    if (!hasCapability('FINANCE_DASHBOARD', await _tradeTier())) return { setup: null, snapshot: null };
    const snapshot = tradovateService.getSnapshot(symbol);
    const setup    = buildTradeLevels(snapshot, symbol);
    return { setup, snapshot };
  });

  // ── Shadow Trading ────────────────────────────────────────────────────────────

  ipcMain.handle('trading:shadowState', async () => {
    const state = shadowTradingController.getState();
    // Attach isSimulated flag so the UI knows which data source is active
    const isSimulated = !tradovateService.status().connected && state.enabled;
    return { ...state, isSimulated };
  });

  ipcMain.handle('trading:shadowEnable', async () => {
    if (!hasCapability('FINANCE_TRADING', await _tradeTier())) return { error: lockedError('FINANCE_TRADING') };
    shadowTradingController.enable();
    return { ok: true };
  });

  ipcMain.handle('trading:shadowDisable', async () => {
    if (!hasCapability('FINANCE_TRADING', await _tradeTier())) return { error: lockedError('FINANCE_TRADING') };
    shadowTradingController.disable();
    return { ok: true };
  });

  ipcMain.handle('trading:shadowPause', async () => {
    if (!hasCapability('FINANCE_TRADING', await _tradeTier())) return { error: lockedError('FINANCE_TRADING') };
    shadowTradingController.pause();
    return { ok: true };
  });

  ipcMain.handle('trading:shadowResume', async () => {
    if (!hasCapability('FINANCE_TRADING', await _tradeTier())) return { error: lockedError('FINANCE_TRADING') };
    shadowTradingController.resume();
    return { ok: true };
  });

  ipcMain.handle('trading:shadowReset', async (_e, newBalance?: number) => {
    if (!hasCapability('FINANCE_TRADING', await _tradeTier())) return { error: lockedError('FINANCE_TRADING') };
    shadowTradingController.reset(newBalance);
    return { ok: true };
  });

  ipcMain.handle('trading:shadowFlatten', async () => {
    if (!hasCapability('FINANCE_TRADING', await _tradeTier())) return { error: lockedError('FINANCE_TRADING') };
    shadowTradingController.flattenAll();
    return { ok: true };
  });

  ipcMain.handle('trading:shadowSetSymbol', async (_e, symbol: string) => {
    if (!hasCapability('FINANCE_TRADING', await _tradeTier())) return { error: lockedError('FINANCE_TRADING') };
    shadowTradingController.setActiveSymbol(symbol);
    return { ok: true };
  });

  ipcMain.handle('trading:shadowUpdateSettings', async (_e, settings: Record<string, unknown>) => {
    if (!hasCapability('FINANCE_TRADING', await _tradeTier())) return { error: lockedError('FINANCE_TRADING') };
    shadowTradingController.updateSettings(settings as Parameters<typeof shadowTradingController.updateSettings>[0]);
    return { ok: true };
  });

  // ── Shadow Analytics (Phase 3) — read-only endpoints ──────────────────────────

  ipcMain.handle('trading:shadowAnalyticsSummary', async () => {
    if (!hasCapability('FINANCE_TRADING', await _tradeTier())) return { error: lockedError('FINANCE_TRADING') };
    return { summary: shadowAnalyticsStore.getSummary() };
  });

  ipcMain.handle('trading:shadowAnalyticsEvents', async (_e, opts?: { stage?: string; symbol?: string; limit?: number; since?: number }) => {
    if (!hasCapability('FINANCE_TRADING', await _tradeTier())) return { error: lockedError('FINANCE_TRADING') };
    return { events: shadowAnalyticsStore.query(opts) };
  });

  ipcMain.handle('trading:shadowAnalyticsFunnel', async (_e, hoursBack?: number) => {
    if (!hasCapability('FINANCE_TRADING', await _tradeTier())) return { error: lockedError('FINANCE_TRADING') };
    return { funnel: shadowAnalyticsStore.getDecisionFunnel(hoursBack) };
  });

  ipcMain.handle('trading:shadowAnalyticsCouncil', async () => {
    if (!hasCapability('FINANCE_TRADING', await _tradeTier())) return { error: lockedError('FINANCE_TRADING') };
    const events = shadowAnalyticsStore.loadAll();
    const { computeCouncilEffectiveness } = await import('@triforge/engine');
    return { council: computeCouncilEffectiveness(events) };
  });

  ipcMain.handle('trading:shadowAnalyticsClear', async () => {
    if (!hasCapability('FINANCE_TRADING', await _tradeTier())) return { error: lockedError('FINANCE_TRADING') };
    shadowAnalyticsStore.clear();
    return { ok: true };
  });

  // ── Phase 7: Trade Explainability ────────────────────────────────────────────

  ipcMain.handle('trading:recentBlockedExplanations', async (_e, opts?: { limit?: number; since?: number }) => {
    if (!hasCapability('FINANCE_TRADING', await _tradeTier())) return { error: lockedError('FINANCE_TRADING') };
    const { buildBlockedTradeExplanation } = await import('@triforge/engine');
    const limit = opts?.limit ?? 10;
    const since = opts?.since ?? (Date.now() - 2 * 3600_000);
    const all = shadowAnalyticsStore.loadAll();
    const blocked = all.filter(e =>
      e.timestamp >= since && e.blockReason &&
      (e.stage === 'setup_detection' || e.stage === 'rule_engine' || e.stage === 'council_review')
    );
    return { explanations: blocked.slice(-limit).map(e => buildBlockedTradeExplanation(e)) };
  });

  ipcMain.handle('trading:gradeSummary', async () => {
    if (!hasCapability('FINANCE_TRADING', await _tradeTier())) return { error: lockedError('FINANCE_TRADING') };
    const { computeGradeSummary } = await import('@triforge/engine');
    return { summary: computeGradeSummary(shadowAnalyticsStore.loadAll()) };
  });

  ipcMain.handle('trading:councilValueAdded', async () => {
    if (!hasCapability('FINANCE_TRADING', await _tradeTier())) return { error: lockedError('FINANCE_TRADING') };
    const { computeCouncilValueAdded } = await import('@triforge/engine');
    return { analysis: computeCouncilValueAdded(shadowAnalyticsStore.loadAll()) };
  });

  // ── Strategy Refinement (Phase 4) ─────────────────────────────────────────────

  ipcMain.handle('trading:shadowRefinementSummary', async () => {
    if (!hasCapability('FINANCE_TRADING', await _tradeTier())) return { error: lockedError('FINANCE_TRADING') };
    const events = shadowAnalyticsStore.loadAll();
    const { computeRefinementSummary } = await import('@triforge/engine');
    const config = shadowTradingController.getStrategyConfig();
    return { summary: computeRefinementSummary(events, config) };
  });

  ipcMain.handle('trading:shadowStrategyConfig:get', async () => {
    if (!hasCapability('FINANCE_TRADING', await _tradeTier())) return { error: lockedError('FINANCE_TRADING') };
    return { config: shadowTradingController.getStrategyConfig() };
  });

  ipcMain.handle('trading:shadowStrategyConfig:set', async (_e, cfg: unknown) => {
    if (!hasCapability('FINANCE_TRADING', await _tradeTier())) return { error: lockedError('FINANCE_TRADING') };
    const { validateStrategyConfig } = await import('@triforge/engine');
    const { config, warnings } = validateStrategyConfig(cfg);
    shadowTradingController.setStrategyConfig(config);
    store.setShadowStrategyConfig(config);
    return { ok: true, warnings: warnings.length > 0 ? warnings : undefined };
  });

  // ── Strategy Readiness (Phase 5) ──────────────────────────────────────────────

  ipcMain.handle('trading:shadowReadinessReport', async () => {
    if (!hasCapability('FINANCE_TRADING', await _tradeTier())) return { error: lockedError('FINANCE_TRADING') };
    const events = shadowAnalyticsStore.loadAll();
    const { evaluateReadiness } = await import('@triforge/engine');
    return { report: evaluateReadiness(events) };
  });

  // ── Strategy Promotion (Phase 6) — manual-only promotion workflow ───────────

  ipcMain.handle('trading:promotionStatus', async () => {
    if (!hasCapability('FINANCE_TRADING', await _tradeTier())) return { error: lockedError('FINANCE_TRADING') };
    return { status: shadowTradingController.getPromotionWorkflowStatus() };
  });

  ipcMain.handle('trading:promotionMode:set', async (_e, targetMode: string) => {
    if (!hasCapability('FINANCE_TRADING', await _tradeTier())) return { error: lockedError('FINANCE_TRADING') };

    const VALID_MODES = ['shadow', 'paper', 'guarded_live_candidate'] as const;
    if (!VALID_MODES.includes(targetMode as any)) {
      return { error: `Invalid mode: ${targetMode}` };
    }

    const currentMode = shadowTradingController.getOperationMode();

    // Demotion to shadow is always allowed
    if (targetMode === 'shadow') {
      shadowTradingController.demoteToShadow('user_manual_demotion');
      store.setTradingOperationMode('shadow');
      return { ok: true, mode: 'shadow' };
    }

    // No skip-levels: shadow→paper, paper→guarded_live_candidate
    const LADDER: Record<string, string> = { shadow: 'paper', paper: 'guarded_live_candidate' };
    if (LADDER[currentMode] !== targetMode) {
      return { error: `Cannot promote from "${currentMode}" to "${targetMode}". Next valid mode: "${LADDER[currentMode] ?? 'none'}".` };
    }

    // Check eligibility via readiness
    const events = shadowAnalyticsStore.loadAll();
    const { evaluateReadiness, evaluatePromotionEligibility } = await import('@triforge/engine');
    const report = evaluateReadiness(events);
    const guardrails = shadowTradingController.getPromotionGuardrails();
    const decision = evaluatePromotionEligibility(report, currentMode as any, guardrails);

    if (!decision.eligible) {
      return { error: `Not eligible for promotion: ${decision.blockers.join(' ')}` };
    }

    shadowTradingController.setOperationMode(targetMode as any);
    shadowTradingController.setLastReadinessState(report.state);
    store.setTradingOperationMode(targetMode as any);
    return { ok: true, mode: targetMode };
  });

  ipcMain.handle('trading:promotionGuardrails:get', async () => {
    if (!hasCapability('FINANCE_TRADING', await _tradeTier())) return { error: lockedError('FINANCE_TRADING') };
    return { guardrails: shadowTradingController.getPromotionGuardrails() };
  });

  ipcMain.handle('trading:promotionGuardrails:set', async (_e, raw: unknown) => {
    if (!hasCapability('FINANCE_TRADING', await _tradeTier())) return { error: lockedError('FINANCE_TRADING') };
    const { validatePromotionGuardrails } = await import('@triforge/engine');
    const { guardrails, warnings } = validatePromotionGuardrails(raw);
    shadowTradingController.setPromotionGuardrails(guardrails);
    store.setPromotionGuardrails(guardrails as any);
    return { ok: true, warnings: warnings.length > 0 ? warnings : undefined };
  });

  ipcMain.handle('trading:confirmPendingTrade', async () => {
    if (!hasCapability('FINANCE_TRADING', await _tradeTier())) return { error: lockedError('FINANCE_TRADING') };
    const ok = shadowTradingController.confirmPendingTrade();
    if (!ok) return { error: 'No pending trade to confirm.' };
    return { ok: true };
  });

  ipcMain.handle('trading:rejectPendingTrade', async () => {
    if (!hasCapability('FINANCE_TRADING', await _tradeTier())) return { error: lockedError('FINANCE_TRADING') };
    const ok = shadowTradingController.rejectPendingTrade();
    if (!ok) return { error: 'No pending trade to reject.' };
    return { ok: true };
  });

  // ── Level-to-Level Simulator State Accessors ───────────────────────────────
  // Safe to call regardless of useLevelEngine — returns null/empty when inactive.

  ipcMain.handle('trading:levelMap:get', async () => {
    if (!hasCapability('FINANCE_TRADING', await _tradeTier())) return { levelMap: null, error: lockedError('FINANCE_TRADING') };
    try {
      const sim = shadowTradingController.getSimulator();
      return { levelMap: sim.getLevelMap() ?? null };
    } catch { return { levelMap: null }; }
  });

  ipcMain.handle('trading:watches:get', async () => {
    if (!hasCapability('FINANCE_TRADING', await _tradeTier())) return { watches: [], error: lockedError('FINANCE_TRADING') };
    try {
      const sim = shadowTradingController.getSimulator();
      return { watches: sim.getWatches() };
    } catch { return { watches: [] }; }
  });

  ipcMain.handle('trading:pathPrediction:get', async () => {
    if (!hasCapability('FINANCE_TRADING', await _tradeTier())) return { prediction: null, error: lockedError('FINANCE_TRADING') };
    try {
      const sim = shadowTradingController.getSimulator();
      return { prediction: sim.getPathPrediction() ?? null };
    } catch { return { prediction: null }; }
  });

  ipcMain.handle('trading:pendingIntents:get', async () => {
    if (!hasCapability('FINANCE_TRADING', await _tradeTier())) return { intents: [], error: lockedError('FINANCE_TRADING') };
    try {
      const sim = shadowTradingController.getSimulator();
      return { intents: sim.getPendingIntents() };
    } catch { return { intents: [] }; }
  });

  ipcMain.handle('trading:blockedEvaluations:get', async () => {
    if (!hasCapability('FINANCE_TRADING', await _tradeTier())) return { blocked: [], error: lockedError('FINANCE_TRADING') };
    try {
      const sim = shadowTradingController.getSimulator();
      return { blocked: sim.getBlockedEvaluations() };
    } catch { return { blocked: [] }; }
  });

  ipcMain.handle('trading:reviewedIntents:get', async () => {
    if (!hasCapability('FINANCE_TRADING', await _tradeTier())) return { reviewed: [], error: lockedError('FINANCE_TRADING') };
    try {
      const sim = shadowTradingController.getSimulator();
      // Strip non-serializable fields (OrderResult contains class instances).
      // Return plain objects only.
      const reviewed = sim.getReviewedIntents().map(r => ({
        intent: r.intent,
        outcome: r.outcome,
        reviewedAt: r.reviewedAt,
        reason: r.reason,
        councilApproved: r.councilResult?.approved ?? null,
        councilVotes: r.councilResult?.votes ?? null,
        councilBlockedReason: r.councilResult?.blockedReason ?? null,
        executionSuccess: r.orderResult?.success ?? null,
        executionRejectReason: r.orderResult?.rejectReason ?? null,
      }));
      return { reviewed };
    } catch { return { reviewed: [] }; }
  });

  ipcMain.handle('trading:sessionContext:get', async () => {
    if (!hasCapability('FINANCE_TRADING', await _tradeTier())) return { session: null, error: lockedError('FINANCE_TRADING') };
    try {
      const sim = shadowTradingController.getSimulator();
      return { session: sim.getSessionContext() ?? null };
    } catch { return { session: null }; }
  });

  ipcMain.handle('trading:positionBook:get', async () => {
    if (!hasCapability('FINANCE_TRADING', await _tradeTier())) return { open: [], closed: [], orders: [], error: lockedError('FINANCE_TRADING') };
    try {
      const sim = shadowTradingController.getSimulator();
      const book = sim.getPositionBook();
      return {
        open: book.getOpenPositions(),
        closed: book.getClosedPositions(),
        orders: book.getPendingOrders(),
      };
    } catch { return { open: [], closed: [], orders: [] }; }
  });

  ipcMain.handle('trading:simulatorState:get', async () => {
    if (!hasCapability('FINANCE_TRADING', await _tradeTier())) return { state: null, error: lockedError('FINANCE_TRADING') };
    try {
      const sim = shadowTradingController.getSimulator();
      return { state: sim.getState() };
    } catch { return { state: null }; }
  });

  // ── Journal / Analytics IPC Handlers ────────────────────────────────────

  ipcMain.handle('trading:journal:entries', async (_e, opts?: {
    symbol?: string; since?: number; limit?: number; outcome?: 'win' | 'loss' | 'breakeven';
  }) => {
    if (!hasCapability('FINANCE_TRADING', await _tradeTier())) return { entries: [], error: lockedError('FINANCE_TRADING') };
    try {
      const sim = shadowTradingController.getSimulator();
      const entries = sim.getJournalStore().query(opts);
      return { entries };
    } catch { return { entries: [] }; }
  });

  ipcMain.handle('trading:journal:expectancy', async (_e, dimension?: string) => {
    if (!hasCapability('FINANCE_TRADING', await _tradeTier())) return { summary: null, error: lockedError('FINANCE_TRADING') };
    try {
      const sim = shadowTradingController.getSimulator();
      const entries = sim.getJournalStore().loadAll();
      const dim = (dimension ?? 'levelType') as BucketDimension;
      const summary = computeExpectancy(entries, dim);
      return { summary };
    } catch { return { summary: null }; }
  });

  ipcMain.handle('trading:journal:advisoryTargets', async (_e, dimension?: string) => {
    if (!hasCapability('FINANCE_TRADING', await _tradeTier())) return { summary: null, error: lockedError('FINANCE_TRADING') };
    try {
      const sim = shadowTradingController.getSimulator();
      const entries = sim.getJournalStore().loadAll();
      const dim = (dimension ?? 'scoreBand') as BucketDimension;
      const summary = computeAdvisoryTargetAnalytics(entries, dim);
      return { summary };
    } catch { return { summary: null }; }
  });

  ipcMain.handle('trading:journal:weights', async () => {
    if (!hasCapability('FINANCE_TRADING', await _tradeTier())) return { suggestions: [], error: lockedError('FINANCE_TRADING') };
    try {
      const sim = shadowTradingController.getSimulator();
      const entries = sim.getJournalStore().loadAll();
      const suggestions = calibrateWeights(entries);
      return { suggestions };
    } catch { return { suggestions: [] }; }
  });

  ipcMain.handle('trading:reliability:setupTrust', async () => {
    if (!hasCapability('FINANCE_TRADING', await _tradeTier())) return { records: [], error: lockedError('FINANCE_TRADING') };
    try {
      const sim = shadowTradingController.getSimulator();
      const entries = sim.getJournalStore().loadAll();
      const store = new SetupReliabilityStore();
      store.recompute(entries);
      return { records: store.getAll() };
    } catch { return { records: [] }; }
  });

  // Load persisted strategy config on startup
  {
    const savedConfig = store.getShadowStrategyConfig();
    if (savedConfig && Object.keys(savedConfig).length > 0) {
      shadowTradingController.setStrategyConfig(savedConfig);
    }
  }

  // Load persisted promotion mode + guardrails on startup (Phase 6)
  {
    // Restore guardrails first (always safe)
    const savedGuardrails = store.getPromotionGuardrails();
    if (savedGuardrails && typeof savedGuardrails === 'object') {
      import('@triforge/engine').then(({ validatePromotionGuardrails }) => {
        const { guardrails } = validatePromotionGuardrails(savedGuardrails);
        shadowTradingController.setPromotionGuardrails(guardrails);
      }).catch(() => { /* keep defaults */ });
    }

    // Restore mode — with readiness re-check for promoted modes
    const savedMode = store.getTradingOperationMode();
    if (savedMode === 'paper' || savedMode === 'guarded_live_candidate') {
      // Critical safety gate: verify readiness still supports this mode
      import('@triforge/engine').then(({ evaluateReadiness, evaluatePromotionEligibility }) => {
        const events = shadowAnalyticsStore.loadAll();
        const report = evaluateReadiness(events);
        const guardrails = shadowTradingController.getPromotionGuardrails();
        // Pretend starting from shadow — check if stored mode is still justified
        const decision = evaluatePromotionEligibility(report, 'shadow', guardrails);

        if (savedMode === 'paper' && decision.eligible) {
          // paper_ready or higher — restore paper
          shadowTradingController.setOperationMode('paper');
          shadowTradingController.setLastReadinessState(report.state);
        } else if (savedMode === 'guarded_live_candidate') {
          // Must be eligible for paper AND guarded_live_candidate
          const paperDecision = evaluatePromotionEligibility(report, 'paper', guardrails);
          if (decision.eligible && paperDecision.eligible) {
            shadowTradingController.setOperationMode('guarded_live_candidate');
            shadowTradingController.setLastReadinessState(report.state);
          } else {
            // Readiness degraded — force shadow
            shadowTradingController.demoteToShadow('startup_readiness_mismatch');
            store.setTradingOperationMode('shadow');
          }
        } else {
          // Readiness degraded — force shadow
          shadowTradingController.demoteToShadow('startup_readiness_mismatch');
          store.setTradingOperationMode('shadow');
        }
      }).catch(() => {
        // On error, stay in shadow (safe default)
        shadowTradingController.demoteToShadow('startup_readiness_check_error');
        store.setTradingOperationMode('shadow');
      });
    }
    // If savedMode is 'shadow' (or undefined), controller defaults to shadow — nothing to do
  }

  // ── Wire council review into shadow trading controller ────────────────────────
  // Each eval tick that passes rules will call this fn. All 3 active providers
  // vote in parallel. Gate: ≥2 TAKE, Grok does not REJECT, avg confidence ≥ 60.

  const COUNCIL_ROLES: Record<string, { role: string; instruction: string }> = {
    claude: {
      role: 'Structure Analyst',
      instruction: 'Evaluate technical setup quality, trend alignment, and structural context.',
    },
    openai: {
      role: 'Execution Planner',
      instruction: 'Evaluate entry timing, execution risk, and market microstructure.',
    },
    grok: {
      role: 'Adversarial Critic',
      instruction: 'Challenge this setup aggressively. Find weaknesses, edge cases, and reasons NOT to take the trade.',
    },
  };

  function _parseCouncilVote(provider: string, text: string): CouncilVote {
    // Normalize: strip markdown bold/italic markers, collapse whitespace,
    // handle ** and __ wrappers around labels that LLMs sometimes add.
    const cleaned = text
      .replace(/\*\*/g, '')      // **bold**
      .replace(/__/g, '')        // __underline__
      .replace(/\*/g, '')        // *italic*
      .replace(/^#+\s*/gm, '')   // markdown headers
      .replace(/`/g, '');        // inline code ticks

    // VOTE — accept TAKE/WAIT/REJECT, tolerant of extra whitespace and colon variants
    const voteLine = cleaned.match(/VOTE\s*[:=\-]\s*(TAKE|WAIT|REJECT)/i);
    const vote: 'TAKE' | 'WAIT' | 'REJECT' =
      (voteLine?.[1]?.toUpperCase() as 'TAKE' | 'WAIT' | 'REJECT') ?? 'WAIT';

    // CONFIDENCE — accept "75", "75%", "75/100", tolerant of extra whitespace
    const confLine = cleaned.match(/CONFIDENCE\s*[:=\-]\s*(\d+)\s*(?:%|\/\s*100)?/i);
    const confidence = confLine
      ? Math.min(100, Math.max(0, parseInt(confLine[1], 10)))
      : 50;

    // REASON — everything after REASON label to end of line
    const reasonLine = cleaned.match(/REASON\s*[:=\-]\s*(.+)/i);
    const reason = reasonLine?.[1]?.trim() ?? 'No reason given.';

    return { provider, vote, confidence, reason };
  }

  function _buildTradeVotePrompt(setup: any, snap: any, symbol: string): string {
    return (
      `You are reviewing a proposed shadow trade (simulation only — no real money at risk).\n\n` +
      `INSTRUMENT: ${symbol}\n` +
      `SETUP TYPE: ${setup.setupType}\n` +
      `SIDE: ${setup.side}\n` +
      `ENTRY: ${setup.entry}\n` +
      `STOP: ${setup.stop} (${setup.stopPoints} pts risk)\n` +
      `TARGET: ${setup.target}\n` +
      `THESIS: ${setup.thesis}\n` +
      `SESSION TREND: ${snap.trend ?? 'unknown'}\n` +
      `LAST PRICE: ${snap.lastPrice ?? 'unknown'}\n\n` +
      `Respond in this EXACT format — no other text:\n` +
      `VOTE: TAKE\n` +
      `CONFIDENCE: 75\n` +
      `REASON: One sentence explanation.\n\n` +
      `VOTE must be exactly TAKE, WAIT, or REJECT.\n` +
      `CONFIDENCE must be a number 0-100.`
    );
  }

  shadowTradingController.setCouncilFn(async (setup, snap, symbol): Promise<CouncilReviewResult> => {
    const { providerManager: pm } = await getEngine();

    // Fetch providers by name — bypasses getActiveProviders() ordering entirely
    const SEAT_NAMES: Array<'claude' | 'openai' | 'grok'> = ['claude', 'openai', 'grok'];
    const seatEntries: Array<{ name: 'claude' | 'openai' | 'grok'; provider: any }> = [];
    for (const name of SEAT_NAMES) {
      const provider = await pm.getProvider(name);
      if (provider) seatEntries.push({ name, provider });
    }

    const seatCount = seatEntries.length;
    const hasGrok   = seatEntries.some(s => s.name === 'grok');

    if (seatCount < 2) {
      return {
        approved: false,
        votes: [],
        blockedReason: `Shadow trading council requires at least 2 configured council providers (claude, openai, grok) — only ${seatCount} present.`,
        blockedCode: 'insufficient_seats',
      };
    }

    // ── Build prompts: specialized (level engine) or generic (legacy) ──
    const simulator = shadowTradingController.getSimulator();
    const currentIntent = simulator.getCurrentReviewIntent();
    let levelCtx: ReturnType<typeof buildCouncilContext> | null = null;
    if (currentIntent) {
      levelCtx = buildCouncilContext(
        simulator, currentIntent,
        snap.lastPrice ?? 0,
        snap.trend5m ?? snap.trend ?? 'unknown',
        snap.trend15m ?? 'unknown',
        snap.highOfDay ?? 0,
        snap.lowOfDay ?? 0,
      );
    }

    // Per-seat specialized roles and prompts (level-to-level mode)
    const LEVEL_ROLES: Record<string, { role: string; system: string; prompt: (ctx: NonNullable<typeof levelCtx>) => string }> = {
      openai: { role: STRUCTURE_AGENT_ROLE, system: STRUCTURE_AGENT_SYSTEM, prompt: buildStructureAgentPrompt },
      claude: { role: RISK_AGENT_ROLE, system: RISK_AGENT_SYSTEM, prompt: buildRiskAgentPrompt },
      grok:   { role: COUNTER_CASE_AGENT_ROLE, system: COUNTER_CASE_AGENT_SYSTEM, prompt: buildCounterCaseAgentPrompt },
    };

    const settled = await Promise.allSettled(
      seatEntries.map(async (seat) => {
        let systemContent: string;
        let userContent: string;

        if (levelCtx && LEVEL_ROLES[seat.name]) {
          // Level-to-level specialized prompts
          const levelRole = LEVEL_ROLES[seat.name];
          systemContent = levelRole.system;
          userContent = levelRole.prompt(levelCtx);
        } else {
          // Legacy generic prompts
          const councilRole = COUNCIL_ROLES[seat.name];
          systemContent = `You are the ${councilRole.role} on the TriForge Trading Council. ${councilRole.instruction} Respond only in the exact format requested.`;
          userContent = _buildTradeVotePrompt(setup, snap, symbol);
        }

        const msgs = [
          { role: 'system', content: systemContent },
          { role: 'user', content: userContent },
        ];
        const text = await seat.provider.chat(msgs as { role: string; content: string }[]);
        return { provider: seat.name, text };
      }),
    );

    const votes: CouncilVote[] = settled.map((r, i) => {
      if (r.status === 'rejected') {
        return { provider: seatEntries[i].name, vote: 'WAIT' as const, confidence: 0, reason: 'Provider failed to respond.' };
      }
      return _parseCouncilVote(r.value.provider, r.value.text);
    });

    const takeCount = votes.filter(v => v.vote === 'TAKE').length;
    const avgConf   = votes.reduce((a, v) => a + v.confidence, 0) / votes.length;

    // ── Tiered approval — three explicit branches for auditability ──

    // Branch 1: 3 seats (all providers present, Grok is the critic)
    if (seatCount >= 3 && hasGrok) {
      const grokVote   = votes.find(v => v.provider === 'grok')!;
      const grokVetoed = grokVote.vote === 'REJECT';
      const approved   = takeCount >= 2 && !grokVetoed && avgConf >= 60;

      if (approved) return { approved: true, votes };

      if (grokVetoed)   return { approved: false, votes, blockedReason: `Critic vetoed: ${grokVote.reason}`, blockedCode: 'grok_veto' };
      if (takeCount < 2) return { approved: false, votes, blockedReason: `Only ${takeCount}/${seatCount} voted TAKE — need at least 2.`, blockedCode: 'insufficient_take_votes' };
      return { approved: false, votes, blockedReason: `Avg confidence ${avgConf.toFixed(0)}/100 below threshold (60).`, blockedCode: 'low_confidence' };
    }

    // Branch 2: 2 seats including Grok — unanimous + veto + higher threshold
    if (seatCount === 2 && hasGrok) {
      const grokVote   = votes.find(v => v.provider === 'grok')!;
      const grokVetoed = grokVote.vote === 'REJECT';
      const approved   = takeCount === 2 && !grokVetoed && avgConf >= 65;

      if (approved) return { approved: true, votes };

      if (grokVetoed)   return { approved: false, votes, blockedReason: `Critic vetoed: ${grokVote.reason}`, blockedCode: 'grok_veto' };
      if (takeCount < 2) return { approved: false, votes, blockedReason: `Only ${takeCount}/2 voted TAKE — unanimous required.`, blockedCode: 'insufficient_take_votes' };
      return { approved: false, votes, blockedReason: `Avg confidence ${avgConf.toFixed(0)}/100 below threshold (65).`, blockedCode: 'low_confidence' };
    }

    // Branch 3: 2 seats without Grok — unanimous + strictest threshold
    const approved = takeCount === seatCount && avgConf >= 70;

    if (approved) return { approved: true, votes };

    if (takeCount < seatCount) return { approved: false, votes, blockedReason: `Only ${takeCount}/${seatCount} voted TAKE — unanimous required without critic.`, blockedCode: 'insufficient_take_votes' };
    return { approved: false, votes, blockedReason: `Avg confidence ${avgConf.toFixed(0)}/100 below threshold (70).`, blockedCode: 'low_confidence' };
  });

  // ── Scheduler ─────────────────────────────────────────────────────────────────

  ipcMain.handle('scheduler:addJob', async (_event, taskGoal: string, category: TaskCategory, cronExpr: string, label?: string) => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    const job = _getScheduler().scheduleRecurring(taskGoal, category, cronExpr, label);
    if (!job) return { error: 'Invalid cron expression. Use: daily@HH:MM or every@Nh' };
    return { job };
  });

  ipcMain.handle('scheduler:addOnceJob', async (_event, taskGoal: string, category: TaskCategory, runAt: number) => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    const job = _getScheduler().scheduleOnce(taskGoal, category, runAt);
    return { job };
  });

  ipcMain.handle('scheduler:cancelJob', async (_event, jobId: string) => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    const ok = _getScheduler().cancelJob(jobId);
    return { ok };
  });

  ipcMain.handle('scheduler:listJobs', async () => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    const jobs = _getScheduler().listJobs();
    return { jobs };
  });

  // ── Audit Ledger ──────────────────────────────────────────────────────────────

  ipcMain.handle('audit:getRecent', async (_event, n: number = 50) => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    const entries = await _getAuditLedger().getRecent(n);
    return { entries };
  });

  ipcMain.handle('audit:tailSince', async (_event, ts: number) => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    const entries = await _getAuditLedger().tailSince(ts);
    return { entries };
  });

  // ── Engine event ring buffer ──────────────────────────────────────────────────

  ipcMain.handle('engine:subscribeEvents', async (_event, sinceId?: string) => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    const events: EventRecord[] = eventBus.since(sinceId);
    const lastId = eventBus.getLastId();
    return { events, lastId };
  });

  // ── Engine health ─────────────────────────────────────────────────────────────

  ipcMain.handle('engine:getHealth', async () => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    const tasks = _getTaskStore().list();
    const runningTasks  = tasks.filter(t => t.status === 'running').length;
    const queuedTasks   = tasks.filter(t => ['queued', 'pending', 'planning'].includes(t.status)).length;
    const pendingApprovals = _getApprovalStore().listPending().length;
    const lastEventId   = eventBus.getLastId();
    return { runningTasks, queuedTasks, pendingApprovals, lastEventId, paperTradingOnly: PAPER_TRADING_ONLY };
  });

  // ── Approvals ─────────────────────────────────────────────────────────────────

  ipcMain.handle('approvals:list', async () => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    const requests = _getApprovalStore().listPending();
    return { requests };
  });

  // Income tool set — used to decide whether to write approve/deny events to income JSONL
  const _INCOME_APPROVAL_TOOLS = new Set([
    'launch_experiment', 'spend_budget', 'publish_content',
    'kill_experiment', 'scale_experiment', 'connect_platform', 'install_tool',
  ]);

  // Write a compact entry to income-ledger.jsonl for income-tool approval decisions.
  // Non-fatal — approval events should not block on JSONL write errors.
  const _logIncomeApprovalEvent = (req: import('@triforge/engine').ApprovalRequest, action: 'approved' | 'denied') => {
    if (!_INCOME_APPROVAL_TOOLS.has(req.tool)) return;
    try {
      const ledgerPath = path.join(_getDataDir(), 'income-ledger.jsonl');
      const entry = JSON.stringify({
        ts:           Date.now(),
        type:         action === 'approved' ? 'approval_approved' : 'approval_denied',
        label:        action === 'approved' ? 'Approval approved' : 'Approval denied',
        detail:       `${req.stepId}`,
        experimentId: req.taskId,
      });
      fs.appendFileSync(ledgerPath, entry + '\n', 'utf8');
    } catch { /* non-fatal */ }
  };

  ipcMain.handle('approvals:approve', async (_event, approvalId: string) => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return incomeFail(lockedError('AGENT_TASKS'));
    try {
      // Server-side guard: verify still pending before executing
      const req = _getApprovalStore().get(approvalId);
      if (!req) return incomeFail('Approval not found.');
      if (req.status !== 'pending') return incomeFail(`Approval is already ${req.status} — no action taken.`);

      const loop = _getAgentLoop(store);
      await loop.approveApprovalRequest(approvalId);
      // Resume task in background
      if (req.taskId) {
        loop.runTask(req.taskId).catch((err: unknown) => console.error('[approvals:approve]', err));
      }
      _logIncomeApprovalEvent(req, 'approved');
      return incomeOk();
    } catch (err) {
      return incomeFail(err instanceof Error ? err.message : String(err));
    }
  });

  ipcMain.handle('approvals:deny', async (_event, approvalId: string, reason?: string) => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return incomeFail(lockedError('AGENT_TASKS'));
    try {
      // Server-side guard: verify still pending before executing
      const req = _getApprovalStore().get(approvalId);
      if (!req) return incomeFail('Approval not found.');
      if (req.status !== 'pending') return incomeFail(`Approval is already ${req.status} — no action taken.`);

      const loop = _getAgentLoop(store);
      await loop.denyApprovalRequest(approvalId, reason);
      // Continue remaining steps in background
      if (req.taskId) {
        loop.runTask(req.taskId).catch((err: unknown) => console.error('[approvals:deny]', err));
      }
      _logIncomeApprovalEvent(req, 'denied');
      return incomeOk();
    } catch (err) {
      return incomeFail(err instanceof Error ? err.message : String(err));
    }
  });

  // ── Income Operator approval creation (Phase 4B) ─────────────────────────────
  // Income actions (launch, scale, kill, etc.) are gated through the same ApprovalStore
  // as agent task approvals, using experimentId as taskId and action as stepId.

  ipcMain.handle(
    'approval:income:create',
    async (
      _event,
      experimentId: string,
      action: string,
      args: Record<string, unknown>,
      riskLevel: 'low' | 'medium' | 'high',
    ) => {
      if (!hasCapability('INCOME_OPERATOR', await _agentTier()) && !hasCapability('INCOME_LANES', await _agentTier())) {
        return incomeFail(lockedError('INCOME_OPERATOR'));
      }
      try {
        // Dedup: return the existing pending approval if one already exists for this experiment+action.
        const existing = _getApprovalStore().getByStep(experimentId, action);
        if (existing) return incomeOk({ approvalId: existing.id });

        const TOOL_MAP: Record<string, string> = {
          launch_experiment: 'launch_experiment',
          spend_budget:      'spend_budget',
          publish_content:   'publish_content',
          kill_experiment:   'kill_experiment',
          scale_experiment:  'scale_experiment',
          connect_platform:  'connect_platform',
          install_tool:      'install_tool',
        };
        const tool = (TOOL_MAP[action] ?? 'spend_budget') as import('@triforge/engine').TaskToolName;
        const approval = _getApprovalStore().create({
          taskId:              experimentId,
          stepId:              action,
          tool,
          args,
          riskLevel,
          estimatedCostCents:  0,
          expiresAt:           Date.now() + 24 * 60 * 60 * 1000, // 24h
        });
        return incomeOk({ approvalId: approval.id });
      } catch (err) {
        return incomeFail(err instanceof Error ? err.message : String(err));
      }
    },
  );

  // ── Task pause / resume ───────────────────────────────────────────────────────

  ipcMain.handle('task:pause', async (_event, taskId: string) => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    try {
      await _getAgentLoop(store).pauseTask(taskId);
      return { ok: true };
    } catch (err) {
      return { error: String(err) };
    }
  });

  ipcMain.handle('task:resume', async (_event, taskId: string) => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    try {
      const loop = _getAgentLoop(store);
      await loop.resumeTask(taskId);
      loop.runTask(taskId).catch((err: unknown) => console.error('[task:resume]', err));
      return { ok: true };
    } catch (err) {
      return { error: String(err) };
    }
  });

  // ── Phase 4: Credentials ──────────────────────────────────────────────────

  ipcMain.handle('credentials:set', async (_e, key: string, value: string) => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    if (typeof key !== 'string' || !key.trim()) return { error: 'Invalid key' };
    if (typeof value !== 'string') return { error: 'Invalid value' };
    try {
      await _getCredentialManager(store).set(key as never, value);
      // Re-register mail adapter so new SMTP config is picked up immediately
      serviceLocator.registerMailSender(createMailAdapter(_getCredentialManager(store)));
      return { ok: true };
    } catch (err) {
      return { error: String(err) };
    }
  });

  ipcMain.handle('credentials:get', async (_e, key: string) => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    try {
      const value = await _getCredentialManager(store).get(key as never);
      // Return masked value for display (never expose plaintext secrets to renderer)
      return { set: value !== undefined && value !== '', masked: value ? '••••••••' : '' };
    } catch (err) {
      return { error: String(err) };
    }
  });

  ipcMain.handle('credentials:delete', async (_e, key: string) => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    try {
      await _getCredentialManager(store).delete(key as never);
      return { ok: true };
    } catch (err) {
      return { error: String(err) };
    }
  });

  ipcMain.handle('credentials:list', async () => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    try {
      const keys = await _getCredentialManager(store).list();
      return { keys };
    } catch (err) {
      return { error: String(err) };
    }
  });

  // ── Phase 4: Execution Results ────────────────────────────────────────────

  ipcMain.handle('results:list', async (_e, taskId?: string) => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    try {
      const results = _getResultStore().query(taskId);
      return { results };
    } catch (err) {
      return { error: String(err) };
    }
  });

  ipcMain.handle('results:getMetrics', async (_e, taskId?: string) => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    try {
      const metrics = _getResultStore().getMetrics(taskId);
      return { metrics };
    } catch (err) {
      return { error: String(err) };
    }
  });

  // ── Phase 4: Service status ────────────────────────────────────────────────

  ipcMain.handle('hustle:getServiceStatus', async () => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    return serviceLocator.getStatus();
  });

  // ── Phase 5: Value Engine — Campaigns ────────────────────────────────────

  ipcMain.handle('value:listCampaigns', async () => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    try {
      const campaigns = _getValueEngine().listCampaigns();
      return { campaigns };
    } catch (err) {
      return { error: String(err) };
    }
  });

  ipcMain.handle('value:createCampaign', async (_e, name: string, type: string, description?: string) => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    try {
      if (!name?.trim()) return { error: 'Campaign name is required' };
      const campaign = _getValueEngine().createCampaign(
        name.trim(),
        type as import('@triforge/engine').CampaignType,
        description,
      );
      return { campaign };
    } catch (err) {
      return { error: String(err) };
    }
  });

  ipcMain.handle('value:linkTask', async (_e, campaignId: string, taskId: string) => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    try {
      const ok = _getValueEngine().linkTask(campaignId, taskId);
      return { ok };
    } catch (err) {
      return { error: String(err) };
    }
  });

  ipcMain.handle('value:getCampaignMetrics', async (_e, campaignId: string) => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    try {
      const metrics = _getValueEngine().getCampaignMetrics(campaignId);
      return { metrics };
    } catch (err) {
      return { error: String(err) };
    }
  });

  ipcMain.handle('value:getGlobalMetrics', async () => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    try {
      const metrics = _getValueEngine().getGlobalMetrics();
      return { metrics };
    } catch (err) {
      return { error: String(err) };
    }
  });

  ipcMain.handle('value:getOptimization', async (_e, campaignId: string) => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    try {
      const result = _getValueEngine().getOptimization(campaignId);
      return { result };
    } catch (err) {
      return { error: String(err) };
    }
  });

  ipcMain.handle('value:recordValue', async (_e, taskId: string, amountCents: number, note?: string, campaignId?: string) => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    try {
      if (typeof amountCents !== 'number' || amountCents < 0) return { error: 'Invalid amount' };
      _getValueEngine().recordValue(taskId, amountCents, note, campaignId);
      return { ok: true };
    } catch (err) {
      return { error: String(err) };
    }
  });

  ipcMain.handle('value:recordReply', async (_e, taskId: string, from: string, sentiment: string, campaignId?: string) => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    try {
      _getValueEngine().recordReply(
        taskId,
        from,
        (sentiment ?? 'neutral') as 'positive' | 'neutral' | 'negative',
        campaignId,
      );
      return { ok: true };
    } catch (err) {
      return { error: String(err) };
    }
  });

  // ── Phase 6: Growth Engine — Loops ────────────────────────────────────────

  ipcMain.handle('growth:listLoops', async () => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    try {
      return { loops: _getGrowthService().listLoops() };
    } catch (err) { return { error: String(err) }; }
  });

  ipcMain.handle('growth:createLoop', async (_e,
    goal: string, type: string, config: Record<string, unknown>, campaignId?: string,
  ) => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    try {
      if (!goal?.trim()) return { error: 'Goal is required' };
      const validTypes = ['outreach', 'content', 'hybrid'];
      if (!validTypes.includes(type)) return { error: 'Invalid loop type' };
      const loop = _getGrowthService().createLoop({
        goal: goal.trim(),
        type: type as import('@triforge/engine').GrowthLoopType,
        status: 'active',
        campaignId,
        config: config ?? {},
      });
      return { loop };
    } catch (err) { return { error: String(err) }; }
  });

  ipcMain.handle('growth:pauseLoop', async (_e, loopId: string) => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    try {
      const loop = _getGrowthService().pauseLoop(loopId);
      return loop ? { ok: true, loop } : { error: 'Loop not found' };
    } catch (err) { return { error: String(err) }; }
  });

  ipcMain.handle('growth:resumeLoop', async (_e, loopId: string) => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    try {
      const loop = _getGrowthService().resumeLoop(loopId);
      return loop ? { ok: true, loop } : { error: 'Loop not found' };
    } catch (err) { return { error: String(err) }; }
  });

  ipcMain.handle('growth:deleteLoop', async (_e, loopId: string) => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    try {
      const ok = _getGrowthService().deleteLoop(loopId);
      return { ok };
    } catch (err) { return { error: String(err) }; }
  });

  ipcMain.handle('growth:runNow', async (_e, loopId: string) => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    try {
      // Run in background — return immediately
      _getGrowthService().runLoop(loopId).catch(console.error);
      return { ok: true, started: true };
    } catch (err) { return { error: String(err) }; }
  });

  ipcMain.handle('growth:getLoopMetrics', async (_e, loopId: string) => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    try {
      return { metrics: _getGrowthService().getLoopMetrics(loopId) };
    } catch (err) { return { error: String(err) }; }
  });

  ipcMain.handle('growth:getGlobalMetrics', async () => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    try {
      return { metrics: _getGrowthService().getGlobalGrowthMetrics() };
    } catch (err) { return { error: String(err) }; }
  });

  // ── Ad Campaign Generation (with phone approval) ──────────────────────────

  ipcMain.handle('campaigns:generateAds', async (event, params: {
    goal: string;
    platform: string;
    count: number;
    targetAudience?: string;
    tone?: string;
    campaignId?: string;
    loopId?: string;
  }) => {
    const tierVal = await _agentTier();
    if (!hasCapability('THINK_TANK', tierVal)) return { error: lockedError('THINK_TANK') };

    const { goal, platform, count: rawCount, targetAudience, tone, campaignId, loopId } = params;
    if (!goal?.trim()) return { error: 'goal is required' };
    const count = Math.max(1, Math.min(rawCount || 3, 5));
    const validPlatform = ['twitter', 'linkedin', 'reddit', 'facebook'].includes(platform) ? platform : 'twitter';
    const toneLabel = tone || 'professional';

    const { providerManager: pm } = await getEngine();
    const providers = await pm.getActiveProviders();
    if (providers.length === 0) return { error: 'No API keys configured.' };

    const genCampaignId = campaignId || `campaign_${Date.now()}`;

    // Build ad-generation prompt
    const adPrompt = [
      `Generate exactly ${count} unique advertising post variants for the platform "${validPlatform}".`,
      `Goal: ${goal.trim()}`,
      targetAudience ? `Target audience: ${targetAudience}` : '',
      `Tone: ${toneLabel}`,
      `Platform constraints: ${validPlatform === 'twitter' ? 'Max 280 characters per post.' : validPlatform === 'linkedin' ? 'Max 3000 characters. Professional tone.' : validPlatform === 'reddit' ? 'Authentic community-friendly voice. Max 500 characters.' : 'Engaging social copy. Max 500 characters.'}`,
      '',
      'Return a JSON array of objects, each with: { "text": "...", "hashtags": "..." }',
      'Return ONLY the JSON array, no markdown fences or other text.',
    ].filter(Boolean).join('\n');

    // Parallel generation across all providers
    const settled = await Promise.allSettled(
      providers.map(async (p) => {
        const msgs = [
          { role: 'system', content: `You are an expert digital marketer. Generate ad copy variants as requested. Return ONLY a valid JSON array.` },
          { role: 'user', content: adPrompt },
        ];
        const resp = await p.chat(msgs);
        return { provider: p.name, raw: resp };
      })
    );

    // Collect and deduplicate ad variants from all providers
    const allVariants: Array<{ text: string; hashtags?: string; provider: string }> = [];
    const seenTexts = new Set<string>();

    for (const result of settled) {
      if (result.status !== 'fulfilled') continue;
      const { provider, raw } = result.value;
      try {
        // Extract JSON array from response (strip markdown fences if present)
        let jsonStr = raw.trim();
        const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
        if (fenceMatch) jsonStr = fenceMatch[1].trim();
        // Try to find array brackets
        const arrStart = jsonStr.indexOf('[');
        const arrEnd = jsonStr.lastIndexOf(']');
        if (arrStart !== -1 && arrEnd !== -1) jsonStr = jsonStr.slice(arrStart, arrEnd + 1);

        const parsed = JSON.parse(jsonStr) as Array<{ text?: string; hashtags?: string }>;
        if (!Array.isArray(parsed)) continue;

        for (const item of parsed) {
          const txt = String(item.text ?? '').trim();
          if (!txt || seenTexts.has(txt.toLowerCase())) continue;
          seenTexts.add(txt.toLowerCase());
          allVariants.push({ text: txt, hashtags: item.hashtags, provider });
        }
      } catch { /* skip unparseable responses */ }
    }

    // Take up to `count` variants
    const finalVariants = allVariants.slice(0, count);

    if (finalVariants.length === 0) {
      return { error: 'All providers failed to generate valid ad variants.' };
    }

    // Save each as draft in ContentStore and queue for phone approval
    const { ContentStore } = await import('@triforge/engine');
    const contentStore = new ContentStore(_getDataDir());
    const variantResults: Array<{ contentId: string; actionId: string; text: string; platform: string; provider: string }> = [];

    for (const variant of finalVariants) {
      const fullText = variant.hashtags
        ? `${variant.text}\n${variant.hashtags}`
        : variant.text;

      // Save draft
      const draft = contentStore.create({
        loopId: loopId || genCampaignId,
        campaignId: genCampaignId,
        type: validPlatform === 'twitter' ? 'tweet' : 'post',
        content: fullText,
        status: 'draft',
        platform: validPlatform,
      });

      // Queue for approval via AutonomyEngine
      const actionId = await _autonomyEngine!.queueForApproval(
        {
          type: 'post_social',
          params: {
            platform: validPlatform,
            content: fullText,
            contentId: draft.id,
          },
        },
        'campaign-ad-generation' as unknown as import('@triforge/engine').EngineEvent,
        `Ad Campaign: ${goal.slice(0, 60)}` as unknown as import('@triforge/engine').WorkflowDefinition,
      );

      variantResults.push({
        contentId: draft.id,
        actionId,
        text: fullText,
        platform: validPlatform,
        provider: variant.provider,
      });
    }

    return {
      ok: true,
      campaignId: genCampaignId,
      variants: variantResults,
      pendingApprovalCount: variantResults.length,
    };
  });

  // ── Phase 6: Growth Engine — Leads ────────────────────────────────────────

  ipcMain.handle('growth:listLeads', async (_e, loopId?: string) => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    try {
      return { leads: _getGrowthService().listLeads(loopId) };
    } catch (err) { return { error: String(err) }; }
  });

  ipcMain.handle('growth:addLead', async (_e, contact: string, name?: string, loopId?: string, campaignId?: string) => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    try {
      if (!contact?.trim()) return { error: 'Contact is required' };
      const lead = _getGrowthService().addLead({
        source: 'manual',
        contact: contact.trim(),
        name,
        status: 'new',
        loopId,
        campaignId,
      });
      return { lead };
    } catch (err) { return { error: String(err) }; }
  });

  ipcMain.handle('growth:updateLead', async (_e, leadId: string, patch: Record<string, unknown>) => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    try {
      const lead = _getGrowthService().updateLead(leadId, patch);
      return lead ? { ok: true, lead } : { error: 'Lead not found' };
    } catch (err) { return { error: String(err) }; }
  });

  // ── Phase 7: Compound Engine ──────────────────────────────────────────────────

  ipcMain.handle('compound:listStrategies', async (_e, type?: string) => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    try {
      const validType = (type === 'outreach' || type === 'content') ? type : undefined;
      return { strategies: _getCompoundEngine().getTopStrategies(50, validType) };
    } catch (err) { return { error: String(err) }; }
  });

  ipcMain.handle('compound:getTopStrategies', async (_e, limit?: number) => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    try {
      return { strategies: _getCompoundEngine().getTopStrategies(limit ?? 5) };
    } catch (err) { return { error: String(err) }; }
  });

  ipcMain.handle('compound:getStats', async () => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    try {
      return { stats: _getCompoundEngine().getCompoundStats() };
    } catch (err) { return { error: String(err) }; }
  });

  ipcMain.handle('compound:runOptimization', async () => {
    if (!hasCapability('AGENT_TASKS', await _agentTier())) return { error: lockedError('AGENT_TASKS') };
    try {
      const result = _getGrowthService().runOptimization();
      return { result };
    } catch (err) { return { error: String(err) }; }
  });

  // ── Desktop OS Controls ────────────────────────────────────────────────────

  ipcMain.handle('desktop:listWindows', async () => {
    const perms = store.getPermissions();
    if (!perms.find(p => p.key === 'browser')?.granted) return { error: 'PERMISSION_DENIED:browser' };
    try {
      const sources = await desktopCapturer.getSources({
        types: ['window', 'screen'],
        thumbnailSize: { width: 160, height: 100 },
      });
      return { windows: sources.map(s => ({ id: s.id, name: s.name, appName: (s as { appName?: string }).appName ?? '' })) };
    } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
  });

  ipcMain.handle('desktop:captureScreen', async (_e, sourceId?: string) => {
    const perms = store.getPermissions();
    if (!perms.find(p => p.key === 'browser')?.granted) return { error: 'PERMISSION_DENIED:browser' };
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 1920, height: 1080 },
      });
      const target = sourceId ? sources.find(s => s.id === sourceId) : sources[0];
      if (!target) return { error: 'No screen source found' };
      return { base64: target.thumbnail.toDataURL(), name: target.name };
    } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
  });

  ipcMain.handle('desktop:clipboardRead', () => {
    return clipboard.readText();
  });

  ipcMain.handle('desktop:clipboardWrite', (_e, text: string) => {
    clipboard.writeText(text);
  });

  ipcMain.handle('desktop:listProcesses', async () => {
    const perms = store.getPermissions();
    if (!perms.find(p => p.key === 'terminal')?.granted) return { error: 'PERMISSION_DENIED:terminal' };
    try {
      const isWin = process.platform === 'win32';
      const cmd = isWin ? 'tasklist /fo csv /nh' : 'ps -eo pid,comm';
      const out = execSync(cmd, { timeout: 5000 }).toString();
      const processes: Array<{ name: string; pid: string }> = [];
      if (isWin) {
        for (const line of out.split('\n').filter(Boolean)) {
          const parts = line.split('","').map((s: string) => s.replace(/"/g, ''));
          if (parts[0]) processes.push({ name: parts[0], pid: parts[1] ?? '' });
        }
      } else {
        for (const line of out.split('\n').slice(1).filter(Boolean)) {
          const cols = line.trim().split(/\s+/);
          if (cols[1]) processes.push({ pid: cols[0] ?? '', name: cols[1] });
        }
      }
      return { processes };
    } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
  });

  // ── Sensors ────────────────────────────────────────────────────────────────

  ipcMain.handle('sensors:list', () => {
    return _sensorManager?.listSensors() ?? [];
  });

  ipcMain.handle('sensors:start', (_e, name: string, config?: Record<string, unknown>) => {
    return _sensorManager?.startSensor(name, config) ?? { error: 'SensorManager not ready' };
  });

  ipcMain.handle('sensors:stop', (_e, name: string) => {
    return _sensorManager?.stopSensor(name) ?? { error: 'SensorManager not ready' };
  });

  // ── Autonomy Engine — Workflow Registry ────────────────────────────────────

  ipcMain.handle('autonomy:listWorkflows', () => {
    return _autonomyEngine?.listWorkflows() ?? [];
  });

  ipcMain.handle('autonomy:registerWorkflow', (_e, wf: WorkflowDefinition) => {
    if (!_autonomyEngine) return { error: 'AutonomyEngine not ready' };
    const result = _autonomyEngine.registerWorkflow(wf);
    return { ok: true, workflow: result };
  });

  ipcMain.handle('autonomy:updateWorkflow', (_e, id: string, patch: Partial<WorkflowDefinition>) => {
    if (!_autonomyEngine) return { error: 'AutonomyEngine not ready' };
    const result = _autonomyEngine.updateWorkflow(id, patch);
    return result ? { ok: true, workflow: result } : { error: 'Workflow not found' };
  });

  ipcMain.handle('autonomy:deleteWorkflow', (_e, id: string) => {
    if (!_autonomyEngine) return { error: 'AutonomyEngine not ready' };
    const deleted = _autonomyEngine.deleteWorkflow(id);
    return deleted ? { ok: true } : { error: 'Workflow not found' };
  });

  ipcMain.handle('autonomy:status', () => {
    return {
      running: _autonomyEngine?.isRunning() ?? false,
      workflowCount: _autonomyEngine?.listWorkflows().length ?? 0,
    };
  });

  // ── Browser Automation ──────────────────────────────────────────────────────

  ipcMain.handle('browser:navigate', async (_e, url: string) => {
    const perms = store.getPermissions();
    if (!perms.find(p => p.key === 'browser')?.granted) return { error: 'PERMISSION_DENIED:browser' };
    try {
      return await browserNavigate(url);
    } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
  });

  ipcMain.handle('browser:screenshot', async (_e, url: string) => {
    const perms = store.getPermissions();
    if (!perms.find(p => p.key === 'browser')?.granted) return { error: 'PERMISSION_DENIED:browser' };
    try {
      return await browserScreenshot(url);
    } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
  });

  ipcMain.handle('browser:fillForm', async (_e, url: string, fields: Record<string, string>, submitSelector?: string) => {
    const perms = store.getPermissions();
    if (!perms.find(p => p.key === 'browser')?.granted) return { error: 'PERMISSION_DENIED:browser' };
    try {
      return await browserFillForm(url, fields, submitSelector);
    } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
  });

  ipcMain.handle('browser:scrape', async (_e, url: string, selector: string, attrs?: string[]) => {
    const perms = store.getPermissions();
    if (!perms.find(p => p.key === 'browser')?.granted) return { error: 'PERMISSION_DENIED:browser' };
    try {
      return await browserScrape(url, selector, attrs);
    } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
  });

  ipcMain.handle('browser:close', async () => {
    try { await closeBrowser(); return { ok: true }; }
    catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
  });

  // ── Social Media ────────────────────────────────────────────────────────────

  ipcMain.handle('social:post', async (_e, platform: string, content: string, mediaBase64?: string) => {
    const perms = store.getPermissions();
    if (!perms.find(p => p.key === 'social')?.granted) return { error: 'PERMISSION_DENIED:social' };
    try {
      const poster = new SocialPoster(_getCredentialManager(store));
      return await poster.post(platform, content, mediaBase64);
    } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
  });

  ipcMain.handle('social:draft', async (_e, platform: string, content: string) => {
    try {
      const poster = new SocialPoster(_getCredentialManager(store));
      return poster.draft(platform, content);
    } catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
  });

  // ── IT Tool Pack ─────────────────────────────────────────────────────────────

  function _getItRegistry() {
    if (!_itRegistry) _itRegistry = createDefaultRegistry();
    return _itRegistry;
  }

  const _itCtx = () => ({ taskId: 'ipc-direct', stepId: 'ipc-direct', category: 'general' as const });
  const _requireTerminal = () => {
    const p = store.getPermissions();
    return p.find((x: { key: string; granted: boolean }) => x.key === 'terminal')?.granted
      ? null : { error: 'PERMISSION_DENIED:terminal' };
  };

  ipcMain.handle('it:getDiagnostics', async () => {
    const denied = _requireTerminal(); if (denied) return denied;
    try { return await _getItRegistry().run('it_diagnostics', {}, _itCtx()); }
    catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
  });

  ipcMain.handle('it:networkDoctor', async (_e, testHosts?: string) => {
    const denied = _requireTerminal(); if (denied) return denied;
    try { return await _getItRegistry().run('it_network_doctor', { testHosts }, _itCtx()); }
    catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
  });

  ipcMain.handle('it:getEventLogs', async (_e, opts?: { logName?: string; maxItems?: number; minutesBack?: number; levelFilter?: string }) => {
    const denied = _requireTerminal(); if (denied) return denied;
    try { return await _getItRegistry().run('it_event_logs', opts ?? {}, _itCtx()); }
    catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
  });

  ipcMain.handle('it:listServices', async (_e, filter?: string) => {
    const denied = _requireTerminal(); if (denied) return denied;
    try { return await _getItRegistry().run('it_services', { action: 'list', filter: filter ?? 'all' }, _itCtx()); }
    catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
  });

  ipcMain.handle('it:restartService', async (_e, serviceName: string) => {
    const denied = _requireTerminal(); if (denied) return denied;
    try { return await _getItRegistry().run('it_services', { action: 'restart', serviceName }, _itCtx()); }
    catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
  });

  ipcMain.handle('it:listProcesses', async (_e, topN?: number, sortBy?: string) => {
    const denied = _requireTerminal(); if (denied) return denied;
    try { return await _getItRegistry().run('it_processes', { action: 'list', topN: topN ?? 30, sortBy: sortBy ?? 'cpu' }, _itCtx()); }
    catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
  });

  ipcMain.handle('it:killProcess', async (_e, target: string) => {
    const denied = _requireTerminal(); if (denied) return denied;
    try { return await _getItRegistry().run('it_processes', { action: 'kill', target }, _itCtx()); }
    catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
  });

  ipcMain.handle('it:listScripts', async () => {
    try { return await _getItRegistry().run('it_script_runner', { action: 'list' }, _itCtx()); }
    catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
  });

  ipcMain.handle('it:runScript', async (_e, scriptId: string) => {
    const denied = _requireTerminal(); if (denied) return denied;
    try { return await _getItRegistry().run('it_script_runner', { action: 'run', scriptId }, _itCtx()); }
    catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
  });

  ipcMain.handle('it:checkPatches', async (_e, scope?: string) => {
    const denied = _requireTerminal(); if (denied) return denied;
    try { return await _getItRegistry().run('it_patch_advisor', { scope: scope ?? 'all' }, _itCtx()); }
    catch (e) { return { error: e instanceof Error ? e.message : String(e) }; }
  });

  // ── Profession Engine ─────────────────────────────────────────────────────────

  ipcMain.handle('profession:list', () => {
    return BUILT_IN_PROFILES.map(p => ({
      id: p.id,
      name: p.name,
      activeSensors: p.activeSensors,
      approvalStrictness: p.approvalStrictness,
      behaviorModifiers: p.behaviorModifiers,
    }));
  });

  ipcMain.handle('profession:getActive', () => {
    const active = _professionEngine?.getActive();
    if (!active) return null;
    return { id: active.id, name: active.name, approvalStrictness: active.approvalStrictness };
  });

  ipcMain.handle('profession:activate', (_e, profileId: string) => {
    if (!_professionEngine) return { error: 'ProfessionEngine not ready' };
    const profile = BUILT_IN_PROFILES.find(p => p.id === profileId);
    if (!profile) return { error: `Unknown profile: ${profileId}` };
    _professionEngine.activate(profile);
    // Wire preferred providers into ProviderManager (Commit 17)
    if (providerManager && profile.behaviorModifiers?.preferredProviders?.length) {
      providerManager.setPreferredProviders(profile.behaviorModifiers.preferredProviders as import('@triforge/engine').ProviderName[]);
    }
    // Apply approval strictness as a hint on the risk policy
    const strictness = profile.approvalStrictness;
    if (strictness === 'relaxed' && _autonomyEngine) {
      _autonomyEngine.setRiskPolicy({
        allowAutoRunSafeFixes: true,
        allowScriptRunner: false,
        allowKillProcess: false,
        allowRestartService: false,
        allowWriteFile: true,
        allowBrowserFillForm: false,
        allowSocialPost: false,
      });
    } else if (strictness === 'balanced' && _autonomyEngine) {
      _autonomyEngine.setRiskPolicy({
        allowAutoRunSafeFixes: true,
        allowScriptRunner: false,
        allowKillProcess: false,
        allowRestartService: false,
        allowWriteFile: true,
        allowBrowserFillForm: false,
        allowSocialPost: false,
      });
    } else if (_autonomyEngine) {
      // strict — everything requires approval
      _autonomyEngine.setRiskPolicy({
        allowAutoRunSafeFixes: false,
        allowScriptRunner: false,
        allowKillProcess: false,
        allowRestartService: false,
        allowWriteFile: false,
        allowBrowserFillForm: false,
        allowSocialPost: false,
      });
    }
    return { ok: true, name: profile.name };
  });

  ipcMain.handle('profession:deactivate', () => {
    if (!_professionEngine) return { error: 'ProfessionEngine not ready' };
    _professionEngine.deactivate();
    // Reset risk policy to default on deactivate
    _autonomyEngine?.setRiskPolicy({});
    // Clear preferred provider bias
    providerManager?.setPreferredProviders([]);
    return { ok: true };
  });

  // Combined status for the Autonomy Status panel in MissionControl
  ipcMain.handle('profession:getStatus', () => {
    const active = _professionEngine?.getActive();
    const autonomy = _autonomyEngine?.getStatus();
    const sensors = _sensorManager?.listSensors() ?? [];
    return {
      professionName:      active?.name ?? null,
      approvalStrictness:  active?.approvalStrictness ?? null,
      engineRunning:       autonomy?.running ?? false,
      runningSensors:      sensors.filter(s => s.running).length,
      enabledWorkflows:    autonomy?.enabledWorkflowCount ?? 0,
      pendingActionCount:  autonomy?.pendingActionCount ?? 0,
      lastFiredWorkflowName: autonomy?.lastFiredWorkflowName ?? null,
      lastFiredAt:         autonomy?.lastFiredAt ?? null,
    };
  });

  // Pending action management (TASK 6)
  ipcMain.handle('autonomy:listPendingActions', () => {
    return _autonomyEngine?.listPendingActions() ?? [];
  });

  ipcMain.handle('autonomy:executeApprovedAction', async (_e, actionId: string) => {
    if (!_autonomyEngine) return { ok: false, error: 'AutonomyEngine not ready' };
    return _autonomyEngine.executeApprovedAction(actionId);
  });

  ipcMain.handle('autonomy:discardPendingAction', (_e, actionId: string) => {
    return { ok: _autonomyEngine?.discardPendingAction(actionId) ?? false };
  });

  ipcMain.handle('autonomy:pendingCount', () => {
    return { count: _autonomyEngine?.listPendingActions().length ?? 0 };
  });

  // ── Approval Server (remote/phone approvals on port 7337) ─────────────────────
  ipcMain.handle('approvalServer:start', async () => {
    if (!_autonomyEngine) return { ok: false, error: 'AutonomyEngine not ready' };
    if (!_approvalServer) _approvalServer = new ApprovalServer(_autonomyEngine);
    return _approvalServer.start();
  });

  ipcMain.handle('approvalServer:stop', () => {
    _approvalServer?.stop();
    return { ok: true };
  });

  ipcMain.handle('approvalServer:status', () => {
    return _approvalServer?.status() ?? { running: false, port: 7337, url: 'http://localhost:7337' };
  });

  // ── Phone Link — remote Council access on port 4587 ───────────────────────────

  const phoneLinkServer = new PhoneLinkServer();
  _phoneLinkRef = phoneLinkServer; // wire Council Awareness phone getter

  // Persist paired devices to userData so they survive app restarts
  phoneLinkServer.setStorageDir(app.getPath('userData'));

  // Wire councilBus → paired device notifications
  initCouncilNotify(phoneLinkServer);

  // Wire phone approval/discard handlers to AutonomyEngine
  phoneLinkServer.setApprovalHandler(
    async (actionId: string) => {
      if (!_autonomyEngine) return { ok: false, error: 'AutonomyEngine not ready' };
      return _autonomyEngine.executeApprovedAction(actionId);
    },
    async (actionId: string) => {
      if (!_autonomyEngine) return { ok: false };
      return { ok: _autonomyEngine.discardPendingAction(actionId) };
    },
  );
  phoneLinkServer.setPendingListHandler(() => {
    return _autonomyEngine?.listPendingActions() ?? [];
  });

  // ── Hot Council Mode — pre-warm providers at startup ─────────────────────────
  if (providerManager) {
    _councilRuntime = new CouncilRuntime(providerManager);
    _councilRuntime.initialize().catch(() => {});
  }

  // Relay wake-word detection from renderer into the bus system
  ipcMain.on('voice:wake-detected', () => {
    _councilRuntime?.onWakeDetected();
  });

  // ── Voice command trust boundary ───────────────────────────────────────────────
  // Renderer detects raw phrase via vosk-browser WASM → reports here.
  // Main validates against allowed list → broadcasts sanitized 'voice-command' string.
  // Renderer only acts on commands received from main — never on its own detections.
  const ALLOWED_VOICE_COMMANDS: Record<string, string> = {
    'council': 'council_assemble', 'hey council': 'council_assemble',
    'okay council': 'council_assemble', 'council listen': 'council_assemble',
    'council help': 'council_assemble', 'council assemble': 'council_assemble',
    'assemble council': 'council_assemble', 'wake council': 'council_assemble',
    'council deliberate': 'council_deliberate', 'council debate': 'council_deliberate',
    'claude advise': 'claude_advise', 'claude opinion': 'claude_advise',
    'grok challenge': 'grok_challenge', 'grok counter': 'grok_challenge',
    'apply solution': 'apply_solution', 'apply decision': 'apply_solution',
    'triforge build': 'mission_build', 'triforge fix': 'mission_fix',
    'triforge audit': 'mission_audit', 'triforge refactor': 'mission_refactor',
  };

  ipcMain.on('voice:wake:phrase', (_e, raw: unknown) => {
    if (typeof raw !== 'string') return;
    const t = raw.toLowerCase().trim();
    // Find longest matching command phrase
    let matched: string | null = null;
    let longestMatch = 0;
    for (const [phrase, cmd] of Object.entries(ALLOWED_VOICE_COMMANDS)) {
      if (t.includes(phrase) && phrase.length > longestMatch) {
        matched = cmd;
        longestMatch = phrase.length;
      }
    }
    if (!matched) return;
    // Relay wake-detected for council_assemble commands
    if (matched === 'council_assemble') _councilRuntime?.onWakeDetected();
    // Broadcast sanitized command to all renderer windows
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('voice-command', matched);
    }
  });

  // ── Vosk wake-word model download ─────────────────────────────────────────────
  const VOSK_MODEL_URL  = 'https://alphacephei.com/vosk/models/vosk-model-small-en-us-0.15.zip';
  const VOSK_MODEL_FILE = 'vosk-model-small-en-us-0.15.zip';

  /** Download `url` to `dest`, following HTTP 301/302 redirects. */
  function downloadFollowingRedirects(url: string, dest: string, redirectsLeft = 5): Promise<void> {
    return new Promise((resolve, reject) => {
      if (redirectsLeft === 0) { reject(new Error('Too many redirects downloading Vosk model')); return; }
      const mod = url.startsWith('https') ? https : http;
      const file = fs.createWriteStream(dest);
      (mod as typeof https).get(url, (res) => {
        if (res.statusCode && res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          file.close();
          fs.unlink(dest, () => {});
          const location = res.headers.location.startsWith('http')
            ? res.headers.location
            : new URL(res.headers.location, url).toString();
          console.log(`[VoskDownload] Redirect ${res.statusCode} → ${location}`);
          downloadFollowingRedirects(location, dest, redirectsLeft - 1).then(resolve, reject);
          return;
        }
        if (res.statusCode && res.statusCode !== 200) {
          file.close();
          fs.unlink(dest, () => {});
          reject(new Error(`Vosk model download failed: HTTP ${res.statusCode}`));
          return;
        }
        res.pipe(file);
        file.on('finish', () => { file.close(); resolve(); });
        file.on('error', (err) => { fs.unlink(dest, () => {}); reject(err); });
      }).on('error', (err) => { fs.unlink(dest, () => {}); reject(err); });
    });
  }

  /** Return true if file exists AND starts with the PK zip magic bytes. */
  function isValidZip(filePath: string): boolean {
    if (!fs.existsSync(filePath)) return false;
    try {
      const buf = Buffer.alloc(4);
      const fd  = fs.openSync(filePath, 'r');
      fs.readSync(fd, buf, 0, 4, 0);
      fs.closeSync(fd);
      return buf[0] === 0x50 && buf[1] === 0x4b; // PK magic
    } catch { return false; }
  }

  /** Shared: ensure the model zip is on disk, return its path. */
  async function ensureWakeModel(): Promise<void> {
    const modelsDir = path.join(app.getPath('userData'), 'vosk-models');
    const zipPath   = path.join(modelsDir, VOSK_MODEL_FILE);
    if (!fs.existsSync(modelsDir)) fs.mkdirSync(modelsDir, { recursive: true });

    if (fs.existsSync(zipPath) && !isValidZip(zipPath)) {
      console.warn('[VoskDownload] Cached file is not a valid zip — deleting and re-downloading');
      fs.unlinkSync(zipPath);
    }

    if (!fs.existsSync(zipPath)) {
      console.log('[VoskDownload] Downloading Vosk model...');
      await downloadFollowingRedirects(VOSK_MODEL_URL, zipPath);
      if (!isValidZip(zipPath)) {
        fs.unlinkSync(zipPath);
        throw new Error('Downloaded Vosk model is not a valid zip file. Check network/URL.');
      }
      console.log('[VoskDownload] Model downloaded and validated.');
    }
  }

  // New: ensure model is cached, renderer fetches it via vosk-model:// protocol
  ipcMain.handle('voice:wake:ensure-model', async () => {
    await ensureWakeModel();
    // Returns nothing — renderer uses vosk-model://model.zip custom protocol
  });

  // Legacy: kept for backward compat, returns raw bytes (40 MB IPC transfer)
  ipcMain.handle('voice:wake:model-data', async () => {
    await ensureWakeModel();
    const zipPath = path.join(app.getPath('userData'), 'vosk-models', VOSK_MODEL_FILE);
    const b = fs.readFileSync(zipPath);
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  });

  // ── Command audit logging ──────────────────────────────────────────────────────
  // Fire-and-forget from renderer CommandDispatcher — logs every dispatched command
  ipcMain.on('command:audit', (_e, source: unknown, cmd: unknown, raw: unknown) => {
    // Log command dispatch — using console since AuditLedger EventType is task-scoped
    console.info('[CommandDispatch]', { source, cmd, raw: String(raw).slice(0, 120), ts: Date.now() });
  });

  // ── Voice wake audio stub (reserved for native Vosk when enableOfflineWake = true) ──
  ipcMain.on('voice:wake:audio', () => {
    // no-op — vosk-browser WASM handles detection in renderer
    // this channel is reserved for future native Vosk integration
  });

  // ── Autonomy Controller — workspace observer + proposal detection ────────────
  autonomyController.init({ approvalStore: _getApprovalStore() });
  autonomyController.start(app.getPath('home'));
  autonomyController.on('autonomy:proposals_ready', (proposals: unknown) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('autonomy:proposals_ready', proposals);
    }
  });

  // ── Mission Controller — forward plan events to renderer ──────────────────────
  missionController.on('mission:plan_ready', (data: unknown) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('mission:plan_ready', data);
    }
  });
  missionController.on('mission:step_preview_ready', (data: unknown) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('mission:step_preview', data);
    }
  });
  missionController.on('mission:complete', (data: unknown) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('mission:complete', data);
    }
  });
  missionController.on('mission:failed', (data: unknown) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('mission:failed', data);
    }
  });

  // ── Council consensus signal — forward to renderer ────────────────────────────
  onConsensus((e) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('council:consensus', e);
    }
  });
  onConsensusMeta((e) => {
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('council:consensus_meta', e);
    }
  });

  // ── Mission Controller IPC handlers ──────────────────────────────────────────
  ipcMain.handle('mission:start', async (_e, raw: unknown, intent: unknown, source: unknown) => {
    try {
      const req = {
        id: crypto.randomUUID(),
        raw: String(raw),
        intent: String(intent) as import('../core/engineering/types').MissionIntent,
        source: (source === 'voice' ? 'voice' : 'typed') as 'typed' | 'voice',
        goal: String(raw),
        constraints: { noUiChanges: true, requireApproval: true, safePreviewOnly: true },
        createdAt: Date.now(),
      };
      const missionId = await missionController.startMission(req);
      return { missionId };
    } catch (err) {
      return { error: String(err) };
    }
  });

  ipcMain.handle('mission:approve_plan', async (_e, missionId: unknown, plan: unknown) => {
    try {
      await missionController.executeMission(String(missionId), plan as import('../core/engineering/types').MissionPlan);
      return { ok: true };
    } catch (err) {
      return { error: String(err) };
    }
  });

  ipcMain.handle('mission:approve_step', async (_e, missionId: unknown, stepId: unknown, plan: unknown) => {
    try {
      missionController.stepApplied(String(missionId), String(stepId), plan as import('../core/engineering/types').MissionPlan);
      return { ok: true };
    } catch (err) {
      return { error: String(err) };
    }
  });

  ipcMain.handle('mission:rollback', async (_e, missionId: unknown) => {
    try {
      missionController.rollbackMission(String(missionId));
      return { ok: true };
    } catch (err) {
      return { error: String(err) };
    }
  });

  // ── System health ─────────────────────────────────────────────────────────────
  ipcMain.handle('system:health', async () => ({
    wakeMode: AUTONOMY_FLAGS.enableOfflineWake ? 'offline' : 'vosk-browser',
    autonomyLoop: AUTONOMY_FLAGS.enableAutonomyLoop,
    commandSystem: AUTONOMY_FLAGS.enableCommandSystem,
    missionController: AUTONOMY_FLAGS.enableMissionController,
    ts: Date.now(),
  }));

  // ── App metadata ──────────────────────────────────────────────────────────────
  ipcMain.handle('app:version', () => app.getVersion());
  ipcMain.handle('app:name',    () => app.getName());

  // ── Setup wizard — role persistence ──────────────────────────────────────────
  ipcMain.handle('setup:getRole', () => store.get<string>('wizard:role', 'solo'));
  ipcMain.handle('setup:setRole', (_e, role: string) => {
    store.update('wizard:role', role);
    return { ok: true };
  });

  // ── Phase 40 — Backup / Restore ───────────────────────────────────────────────
  ipcMain.handle('recovery:createBackup', async () => createBackupFile(store));
  ipcMain.handle('recovery:restoreBackup', async () => restoreBackupFile(store));
  ipcMain.handle('recovery:getLastBackupAt', () => getLastBackupAt(store));

  // ── Phase 40 — Snapshots ──────────────────────────────────────────────────────
  ipcMain.handle('recovery:listSnapshots', () => listSnapshots(store));
  ipcMain.handle('recovery:createSnapshot', async (_e, trigger: string, label: string) => {
    try { return await createSnapshot(store, trigger ?? 'manual', label ?? 'Manual snapshot'); }
    catch (e) { return { ok: false, error: String(e) }; }
  });
  ipcMain.handle('recovery:rollbackSnapshot', async (_e, id: string) => {
    if (!id) return { ok: false, error: 'No snapshot id provided' };
    try { return await rollbackSnapshot(store, id); }
    catch (e) { return { ok: false, error: String(e) }; }
  });
  ipcMain.handle('recovery:deleteSnapshot', (_e, id: string) => {
    if (!id) return false;
    try { return deleteSnapshot(store, id); }
    catch { return false; }
  });

  // ── Phase 40 — Store validation ───────────────────────────────────────────────
  ipcMain.handle('recovery:validateStore', async () => {
    try { return await validateStore(store); }
    catch (e) { return { valid: false, issues: [{ severity: 'error', field: 'validator', message: String(e), repairable: false }], checkedAt: Date.now(), repairedCount: 0 }; }
  });
  ipcMain.handle('recovery:repairStore',   async () => {
    try { return await validateAndRepairStore(store); }
    catch (e) { return { valid: false, issues: [{ severity: 'error', field: 'validator', message: String(e), repairable: false }], checkedAt: Date.now(), repairedCount: 0 }; }
  });

  // ── Phase 40 — Migration engine ───────────────────────────────────────────────
  ipcMain.handle('recovery:runMigrations', async () => {
    try { return await runMigrations(store); }
    catch (e) { return { ran: 0, errors: [String(e)] }; }
  });
  ipcMain.handle('recovery:getMigrationHistory',() => {
    try { return getMigrationHistory(store); } catch { return []; }
  });
  ipcMain.handle('recovery:getSchemaVersion', () => {
    try { return getCurrentSchemaVersion(store); } catch { return 0; }
  });

  // ── Phase 40 — Crash guard ────────────────────────────────────────────────────
  ipcMain.handle('recovery:getIncidents',   () => getIncidents(store));
  ipcMain.handle('recovery:resetIncident',  (_e, serviceId: string) => {
    resetIncident(store, serviceId);
    return { ok: true };
  });

  // ── Council Demo — startup demonstration for new users ───────────────────────
  // Only runs when no API keys are configured yet (first-run / onboarding scenario)
  setTimeout(async () => {
    try {
      const { providerManager: pm } = await getEngine();
      const providers = await pm.getActiveProviders();
      const isFirstRun = providers.length === 0;
      const demoHandle = startCouncilDemo(isFirstRun);

      // Forward demo events from bus to all open renderer windows
      const { councilBus: cBus } = await import('@triforge/engine');
      cBus.on('COUNCIL_DEMO', (data: unknown) => {
        const d = data as { phase: string; label: string };
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) win.webContents.send('council:demo', { phase: d.phase });
        }
      });

      // Auto-cancel demo if user sends a real message
      ipcMain.once('chat:conversation', () => demoHandle.stop());
      ipcMain.once('chat:consensus',    () => demoHandle.stop());
    } catch { /* demo failures are silent */ }
  }, 1500);

  // ── Insight Engine — ambient council mode ─────────────────────────────────────
  setTimeout(async () => {
    try {
      const { providerManager: pm } = await getEngine();
      const providers = await pm.getActiveProviders();
      if (providers.length === 0) return;

      // Use fastest available provider for low-cost insight evaluation
      const insightProvider = providers[0];
      _insightEngine = new InsightEngine(insightProvider);

      // Route COUNCIL_INSIGHT events via InsightRouter (windows + TTS + insight:stream)
      _insightRouter = new InsightRouter({
        getWindows:         () => BrowserWindow.getAllWindows(),
        getActiveBlueprint: getActiveBlueprint,
        textToSpeech:       (text, onChunk, opts) =>
          textToSpeechStream(text, store, onChunk, opts ?? {}),
      });
      await _insightRouter.start();

      // Wire eventBus + missionController into the router
      const { eventBus: eBus } = await import('@triforge/engine');
      _insightRouter.subscribeToEventBus(eBus);
      _insightRouter.subscribeToMissionController(missionController);
    } catch { /* non-fatal — insight engine starts when providers are ready */ }
  }, 4000);

  // ── Forward COUNCIL_PARTIAL_REASONING bus events to all renderers ─────────────
  // This allows any window (not just the one that triggered the conversation)
  // to receive partial reasoning updates from the DebateStreamCoordinator.
  setTimeout(async () => {
    const { councilBus: cBus } = await import('@triforge/engine');
    cBus.on('COUNCIL_PARTIAL_REASONING', (data: unknown) => {
      const d = data as { provider: string; reasoning: string };
      for (const win of BrowserWindow.getAllWindows()) {
        if (!win.isDestroyed()) win.webContents.send('council:partial-reasoning', d);
      }
    });
  }, 500);

  // Wire task handler: uses first available provider (no IPC round-trip needed)
  phoneLinkServer.setTaskHandler(async (message) => {
    try {
      const { providerManager: pm } = await getEngine();
      const providers = await pm.getActiveProviders();
      if (providers.length === 0) return 'No AI providers configured in TriForge.';
      const systemPromptText = await buildSystemPrompt(store, _professionEngine?.getSystemPromptAdditions());
      return await providers[0].chat([
        { role: 'system', content: systemPromptText },
        { role: 'user', content: message },
      ]);
    } catch (err) {
      return `Error: ${err instanceof Error ? err.message : String(err)}`;
    }
  });

  ipcMain.handle('phoneLink:start', async () => {
    return phoneLinkServer.start();
  });

  ipcMain.handle('phoneLink:stop', () => {
    phoneLinkServer.stop();
    return { ok: true };
  });

  ipcMain.handle('phoneLink:status', () => {
    return phoneLinkServer.status();
  });

  ipcMain.handle('phoneLink:pair', () => {
    if (!phoneLinkServer.status().running) {
      return { error: 'Start the Phone Link server first.' };
    }
    return phoneLinkServer.generateNewPairToken();
  });

  // ── Persistent Mission System ───────────────────────────────────────────────

  ipcMain.handle('missions:list', () => {
    return _getMissionStore().load();
  });

  ipcMain.handle('missions:register', async (_e, def: {
    id: string; name: string; goal: string; category: string;
    schedule?: string; description?: string;
  }) => {
    try {
      const mgr = _getMissionManager(store);
      const { id, name, goal, category, schedule, description } = def;
      const agentLoop = _getAgentLoop(store);
      mgr.register({
        id, name, goal,
        category: category as import('@triforge/engine').TaskCategory,
        schedule,
        description,
        enabled: true,
        createdAt: Date.now(),
        task: async () => {
          const task = agentLoop.createTask(goal, category as import('@triforge/engine').TaskCategory);
          await agentLoop.runTask(task.id);
        },
      });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle('missions:run', async (_e, id: string) => {
    try {
      await _getMissionManager(store).runMission(id);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle('missions:delete', (_e, id: string) => {
    return { ok: _getMissionStore().delete(id) };
  });

  ipcMain.handle('missions:restore', () => {
    try {
      _getMissionManager(store).restoreFromStore();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ── Autonomous Tool Execution Layer ────────────────────────────────────────

  ipcMain.handle('tools:list', () => {
    return _getRegistry().listAll();
  });

  ipcMain.handle('tools:execute', async (_e, req: { tool: string; params: Record<string, unknown>; category?: string }) => {
    try {
      const executor = getToolExecutor(_getRegistry(), _getAuditLedger(), _getApprovalStore());
      const result = await executor.execute({
        id:       newRequestId(),
        tool:     req.tool,
        params:   req.params,
        category: req.category as import('@triforge/engine').TaskCategory | undefined,
      });
      return result;
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle('tools:resolveApproval', (_e, approvalId: string, approved: boolean) => {
    const executor = getToolExecutor(_getRegistry(), _getAuditLedger(), _getApprovalStore());
    executor.resolveApproval(approvalId, approved);
    return { ok: true };
  });

  ipcMain.handle('tools:pendingApprovals', () => {
    const executor = getToolExecutor(_getRegistry(), _getAuditLedger(), _getApprovalStore());
    return executor.listPendingApprovals();
  });

  // ── System Health Monitor ──────────────────────────────────────────────────

  // Register IPC-accessible health checks for subsystems managed in ipc.ts
  healthMonitor.register({
    name:  'EventBus',
    check: () => {
      const { eventBus: bus } = require('@triforge/engine');
      return bus.listenerCount() > 0 || bus.pendingQueueSize() < 5000;
    },
  });

  healthMonitor.register({
    name:  'ToolRegistry',
    check: () => _getRegistry().listAll().length > 0,
  });

  ipcMain.handle('health:status', async () => {
    return healthMonitor.getStatus();
  });

  ipcMain.handle('health:run', async () => {
    return healthMonitor.runChecks();
  });

  // ── Long-Term Memory ───────────────────────────────────────────────────────

  ipcMain.handle('memory:search', (_e, query: string) => {
    return _getMemoryManagerInstance().search(query);
  });

  ipcMain.handle('memory:recent', (_e, n: number = 20) => {
    return _getMemoryManagerInstance().getRecent(n);
  });

  ipcMain.handle('memory:graph', () => {
    return _getMemoryManagerInstance().getGraph().toJSON();
  });

  // ── Venture Discovery + Build ─────────────────────────────────────────────

  ipcMain.handle('venture:discover', async (event, budget: number) => {
    try {
      const license = await store.getLicense();
      const tierVal = (license.tier ?? 'free') as 'free' | 'pro';
      if (!hasCapability('VENTURE_DISCOVERY', tierVal)) {
        return { error: lockedError('VENTURE_DISCOVERY'), tier: tierVal };
      }

      // Pro 30-day trial check
      if (tierVal === 'pro') {
        let trialStart = store.getVentureTrialStart();
        if (!trialStart) {
          trialStart = Date.now();
          store.setVentureTrialStart(trialStart);
        }
        if (Date.now() - trialStart > 30 * 86_400_000) {
          return { error: 'Venture Discovery trial expired. Upgrade to Business for unlimited access.', tier: tierVal };
        }
      }

      const { providerManager: pm } = await getEngine();
      const providers = await pm.getActiveProviders();
      if (providers.length === 0) {
        return { error: 'No API keys configured. Add at least one in Settings.' };
      }

      const emit = (phase: string, detail?: string) => {
        if (!event.sender.isDestroyed()) event.sender.send('venture:progress', { phase, detail });
      };

      // 1. Research
      emit('researching', 'Scanning live market signals...');
      const { researchMarket, extractCandidates, scoreCandidate, rankCandidates,
              runVentureCouncil, allocateBudget, buildBrand, buildLaunchPack,
              planConversion, planAudienceGrowth, planGrowthFunnel,
              classifyFormationNeeds, formatForPhone, formatForDesktop } = await import('@triforge/engine');

      const signals = await researchMarket(budget);
      emit('extracting', `Found ${signals.length} market signals`);

      const provider = providers[0];
      const candidates = await extractCandidates(signals, budget, provider);
      emit('scoring', `${candidates.length} candidates identified`);

      // 2. Retrieve learning biases + context for scoring and council
      let learningBiases: Record<string, number> | undefined;
      let learningContext: string | undefined;
      try {
        const lo = _getLearningOrchestrator(store);
        learningBiases = lo.getBiasesForScoring();
        learningContext = lo.getContextForCouncil() || undefined;
      } catch { /* learning integration non-fatal */ }

      // 3. Score + rank (with learning biases)
      for (const c of candidates) {
        const scores = scoreCandidate(c, budget, signals, learningBiases);
        c.scores = scores;
      }
      const ranked = rankCandidates(candidates).slice(0, 8);
      emit('council', 'Council debating top candidates...');

      // 4. Council decision (with learning context)
      const proposal = await runVentureCouncil(ranked, budget, providers, (phase: string) => emit('council', phase), learningContext);

      // 5. Formation classification for each option
      for (const opt of [proposal.winner, proposal.safer, proposal.aggressive]) {
        if (!opt) continue;
        const fd = classifyFormationNeeds(
          opt.candidate.category,
          opt.launchPack?.monetizationPath ?? '',
          opt.launchPack,
        );
        opt.formationMode = fd.canOperateBefore ? 'test_mode_unfiled' : 'file_on_approval';
        opt.canOperateBeforeFiling = fd.canOperateBefore;
        opt.filingRecommendation = fd.recommendation;
        opt.filingUrgency = fd.urgency;
        opt.filingReason = fd.reason;
        opt.requiresEntityBeforeRevenue = fd.requiresEntityBeforeRevenue;
      }

      // 6. Budget allocation
      emit('budget', 'Allocating treasury...');
      proposal.treasuryAllocation = allocateBudget(budget, proposal.winner.candidate.category);

      // 7. Build brands (parallel)
      emit('branding', 'Building brand assets...');
      const brandResults = await Promise.allSettled(
        [proposal.winner, proposal.safer, proposal.aggressive]
          .filter(Boolean)
          .map(opt => buildBrand(opt!, provider)),
      );

      // 8. Build launch packs (parallel)
      emit('packs', 'Building launch packs...');
      const options = [proposal.winner, proposal.safer, proposal.aggressive].filter(Boolean);
      const launchResults = await Promise.allSettled(
        options.map((opt, i) => {
          const brand = brandResults[i]?.status === 'fulfilled' ? brandResults[i].value : undefined;
          return buildLaunchPack(opt!, brand ?? {
            brandName: opt!.candidate.concept,
            tagline: '', logoConceptDescription: '', colorDirection: '', brandVoice: '',
            positioning: '', homepageHeroCopy: '',
          }, provider);
        }),
      );
      for (let i = 0; i < options.length; i++) {
        if (launchResults[i]?.status === 'fulfilled') {
          options[i]!.launchPack = (launchResults[i] as PromiseFulfilledResult<unknown>).value as typeof options[0]['launchPack'];
        }
      }

      // 9. Conversion plan (winner) — persist on proposal (Fix 5)
      emit('conversion', 'Planning conversion strategy...');
      if (proposal.winner.launchPack) {
        (proposal as any).conversionPlan = planConversion(proposal.winner, proposal.winner.launchPack);
      }

      // 10. Audience growth plans (parallel) — persist on proposal (Fix 5)
      emit('audience', 'Planning audience growth...');
      const growthResults = await Promise.allSettled(
        options.map(opt => {
          if (opt?.launchPack) return Promise.resolve(planAudienceGrowth(opt, opt.launchPack));
          return Promise.resolve(undefined);
        }),
      );
      const audienceGrowthPlans: Record<string, unknown> = {};
      for (let i = 0; i < options.length; i++) {
        if (growthResults[i]?.status === 'fulfilled' && (growthResults[i] as PromiseFulfilledResult<unknown>).value) {
          audienceGrowthPlans[options[i]!.candidate.id] = (growthResults[i] as PromiseFulfilledResult<unknown>).value;
        }
      }
      (proposal as any).audienceGrowthPlans = audienceGrowthPlans;

      // 11. Growth funnel (winner) — persist on proposal (Fix 5)
      emit('funnel', 'Mapping growth funnel...');
      if (proposal.winner.launchPack) {
        (proposal as any).growthFunnel = planGrowthFunnel(proposal.winner, proposal.winner.launchPack);
      }

      // 12. Filing summary
      const { summarizeFilingNeed } = await import('@triforge/engine');
      if (proposal.winner) {
        const fd = classifyFormationNeeds(
          proposal.winner.candidate.category,
          proposal.winner.launchPack?.monetizationPath ?? '',
        );
        proposal.filingSummary = summarizeFilingNeed(proposal.winner, fd);
      }

      // 13. Save + push
      proposal.status = 'awaiting_user_approval';
      store.addVentureProposal(proposal as unknown as Record<string, unknown>);

      store.addLedger({
        id: `venture-${proposal.id}`,
        timestamp: Date.now(),
        request: `Venture Discovery: $${budget} budget`,
        synthesis: `Proposed: ${proposal.winner.candidate.concept} (${proposal.winner.candidate.category}). Confidence: ${proposal.winner.confidenceScore}%. Formation: ${proposal.winner.formationMode}.`,
        responses: [],
        workflow: 'VENTURE_PROPOSAL',
        starred: false,
      });

      // Push to phone
      try {
        const { sendVentureProposal } = await import('./councilNotify.js');
        sendVentureProposal(formatForPhone(proposal));
      } catch { /* phone not paired — non-fatal */ }

      emit('done', 'Proposal ready');
      return { proposal: formatForDesktop(proposal) };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('venture:respond', async (_event, id: string, action: string) => {
    try {
      const proposal = store.getVentureProposal(id);
      if (!proposal) return { error: 'Proposal not found.' };

      switch (action) {
        case 'approve':
          store.updateVentureStatus(id, 'approved_for_build');
          break;
        case 'approve_plan_only':
          store.updateVentureStatus(id, 'approved_plan_only');
          break;
        case 'escalate_to_build':
          // Transition from approved_plan_only → approved_for_build
          if (String(proposal.status) !== 'approved_plan_only') {
            return { error: 'Only plan-only ventures can be escalated to build.' };
          }
          store.updateVentureStatus(id, 'approved_for_build');
          break;
        case 'alternative':
          store.updateVentureStatus(id, 'rerun_requested');
          break;
        case 'hold':
          // No status change
          break;
        case 'reject':
          store.updateVentureStatus(id, 'rejected');
          break;
        default:
          return { error: `Unknown action: ${action}` };
      }

      store.addLedger({
        id: `venture-respond-${Date.now().toString(36)}`,
        timestamp: Date.now(),
        request: `Venture Response: ${action}`,
        synthesis: `User responded "${action}" to venture proposal ${id.slice(0, 8)}.`,
        responses: [],
        workflow: 'VENTURE_RESPONSE',
        starred: false,
      });

      // Record decision in learning brain
      try {
        const lo = _getLearningOrchestrator(store);
        lo.onVentureDecision(id, action, proposal as any);
      } catch { /* learning integration non-fatal */ }

      return { ok: true };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('venture:build', async (event, id: string) => {
    try {
      const proposal = store.getVentureProposal(id) as Record<string, unknown> | undefined;
      if (!proposal) return { error: 'Proposal not found.' };
      if (proposal.status !== 'approved_for_build') return { error: 'Proposal must be approved before building.' };

      const { providerManager: pm } = await getEngine();
      const providers = await pm.getActiveProviders();
      if (providers.length === 0) return { error: 'No API keys configured.' };

      const provider = providers[0];
      const winner = proposal.winner as Record<string, unknown>;
      const launchPack = winner.launchPack as Record<string, unknown> | undefined;

      const emit = (phase: string, detail?: string) => {
        if (!event.sender.isDestroyed()) event.sender.send('venture:progress', { phase, detail });
      };

      store.updateVentureStatus(id, 'building_site');
      emit('building_site', 'Planning website...');

      const { planSite, generateSite, buildCaptureComponent, buildLeadMagnet,
              buildSignupFlow, generateFirst30Days, planGrowthFunnel,
              planConversion } = await import('@triforge/engine');

      // Plan site
      const brand = {
        brandName: String(launchPack?.brandName ?? (winner.candidate && (winner.candidate as Record<string,unknown>).concept) ?? 'Venture'),
        tagline: String(launchPack?.tagline ?? ''),
        colorDirection: String(launchPack?.colorDirection ?? ''),
        brandVoice: String(launchPack?.brandVoice ?? ''),
      };

      const conversionPlan = planConversion(winner as never, launchPack as never);
      const sitePlan = planSite(winner as never, launchPack as never, conversionPlan, brand as never);

      emit('generating_site', 'Generating website pages...');
      const siteBuild = await generateSite(sitePlan, provider, (phase: string) => emit('site_gen', phase));

      // Build lead capture — persist result (Fix 5)
      emit('lead_capture', 'Building lead capture...');
      const captureType = String((launchPack?.leadCapturePlan && (launchPack.leadCapturePlan as Record<string,unknown>).captureType) ?? 'email_signup');
      const captureComponent = buildCaptureComponent(captureType as import('@triforge/engine').CaptureType, brand.brandName);

      // Lead magnet — persist result (Fix 5)
      emit('lead_magnet', 'Creating lead magnet...');
      const leadMagnet = await buildLeadMagnet(winner as never, brand as never, provider);

      // Signup flow — persist result (Fix 5)
      const signupFlow = buildSignupFlow(captureType as import('@triforge/engine').CaptureType, brand as never);

      // First 30 days
      emit('planning_30days', 'Generating 30-day plan...');
      const funnel = planGrowthFunnel(winner as never, launchPack as never);
      const first30 = await generateFirst30Days(winner as never, launchPack as never, funnel, provider);

      // Update proposal with ALL build artifacts (Fix 5)
      const canOperateBefore = Boolean(winner.canOperateBeforeFiling);
      const postBuildStatus = canOperateBefore ? 'operating_unfiled' : 'awaiting_filing_decision';

      store.updateVentureProposal(id, {
        status: postBuildStatus,
        siteBuild,
        first30DaysPlan: first30,
        captureComponent,
        leadMagnet,
        signupFlow,
        growthFunnel: funnel,
        conversionPlan: conversionPlan,
      });

      // Notify with state-accurate messaging
      try {
        const { sendVentureBuildUpdate } = await import('./councilNotify.js');
        if (canOperateBefore) {
          sendVentureBuildUpdate(id, 'Site built — venture is operating (unfiled). Filing can be done later.');
        } else {
          sendVentureBuildUpdate(id, 'Site built — filing decision required before operation.');
        }
      } catch { /* non-fatal */ }

      emit('build_done', canOperateBefore
        ? 'Build complete — venture is now operating (unfiled)'
        : 'Build complete — filing decision required before operation');
      return { ok: true };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // Only these states allow launching into daily growth.
  // Ventures must either be operating_unfiled (pre-filing allowed) or filed_and_operating.
  const LAUNCHABLE_STATES = ['operating_unfiled', 'growth_ready', 'filed_and_operating'];

  ipcMain.handle('venture:launch', async (_event, id: string) => {
    try {
      const proposal = store.getVentureProposal(id);
      if (!proposal) return { error: 'Proposal not found.' };

      const status = String(proposal.status);
      if (!LAUNCHABLE_STATES.includes(status)) {
        if (status === 'awaiting_filing_decision') {
          return { error: 'A filing decision is required before launching this venture. Choose File Now, Wait, or Ask Again Later.' };
        }
        return { error: `Venture cannot launch from "${status}". Must be operating_unfiled, growth_ready, or filed_and_operating.` };
      }

      store.updateVentureStatus(id, 'daily_growth_active');

      store.addLedger({
        id: `venture-launch-${Date.now().toString(36)}`,
        timestamp: Date.now(),
        request: 'Venture Launch',
        synthesis: `Venture ${id.slice(0, 8)} launched into daily growth mode from ${status}.`,
        responses: [],
        workflow: 'VENTURE_LAUNCH',
        starred: false,
      });

      return { ok: true };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('venture:filingRespond', async (_event, id: string, action: string) => {
    try {
      const proposal = store.getVentureProposal(id);
      if (!proposal) return { error: 'Proposal not found.' };

      switch (action) {
        case 'file_now': {
          store.updateVentureStatus(id, 'filing_prepared');
          // Prepare filing packet
          const { providerManager: pm } = await getEngine();
          const providers = await pm.getActiveProviders();
          const provider = providers.length > 0 ? providers[0] : undefined;
          const { prepareFilingPacket } = await import('@triforge/engine');
          const founderProfile = store.getFounderProfile() ?? {};
          const filingPacket = await prepareFilingPacket(
            proposal.winner as never,
            founderProfile as never,
            provider,
          );
          store.updateVentureProposal(id, { filingPacket });

          store.addLedger({
            id: `venture-filing-${Date.now().toString(36)}`,
            timestamp: Date.now(),
            request: 'Venture Filing Prepared',
            synthesis: `Filing packet prepared for venture ${id.slice(0, 8)}. Entity: ${filingPacket.entityType}. EIN ready: ${filingPacket.einReady}. State filing ready: ${filingPacket.stateFilingReady}.`,
            responses: [],
            workflow: 'VENTURE_FILING',
            starred: false,
          });

          try {
            const { sendVentureFilingPrompt } = await import('./councilNotify.js');
            sendVentureFilingPrompt(id, `Entity: ${filingPacket.entityType}, EIN Ready: ${filingPacket.einReady}`);
          } catch { /* non-fatal */ }

          break;
        }
        case 'wait':
          store.updateVentureStatus(id, 'filing_deferred');
          break;
        case 'ask_again_later':
          store.updateVentureStatus(id, 'filing_deferred');
          break;
        case 'confirm_filing':
          // Transition from filing_prepared → filed_and_operating
          if (String(proposal.status) !== 'filing_prepared') {
            return { error: 'Filing can only be confirmed from "filing_prepared" state.' };
          }
          store.updateVentureStatus(id, 'filed_and_operating');
          store.addLedger({
            id: `venture-filed-${Date.now().toString(36)}`,
            timestamp: Date.now(),
            request: 'Venture Filing Confirmed',
            synthesis: `Venture ${id.slice(0, 8)} filing confirmed. Now operating as filed entity.`,
            responses: [],
            workflow: 'VENTURE_FILING',
            starred: false,
          });
          break;
        case 'revisit_filing':
          // Transition from filing_deferred → awaiting_filing_decision
          if (String(proposal.status) !== 'filing_deferred') {
            return { error: 'Filing can only be revisited from "filing_deferred" state.' };
          }
          store.updateVentureStatus(id, 'awaiting_filing_decision');
          break;
        default:
          return { error: `Unknown filing action: ${action}` };
      }

      return { ok: true };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('venture:list', () => {
    return store.getVentureProposals();
  });

  ipcMain.handle('venture:get', (_event, id: string) => {
    return store.getVentureProposal(id) ?? null;
  });

  // ── Income Operator: Capability Scanner ─────────────────────────────────

  ipcMain.handle('scanner:run', async () => {
    try {
      if (!hasCapability('INCOME_SCANNER', _cachedTier)) return { error: lockedError('INCOME_SCANNER') };

      // Infer connected platforms from saved credential keys
      const credMgr = _credentialManager ?? new CredentialManager(store);
      const knownKeys = [
        'youtube_client_id', 'tiktok_access_token', 'gumroad_access_token',
        'itch_api_key', 'twitter_api_key', 'slack_token', 'github_token',
        'smtp_host', 'telegram_bot_token',
      ];
      const setKeys: string[] = [];
      for (const k of knownKeys) {
        const val = await credMgr.get(k as never).catch(() => null);
        if (val) setKeys.push(k);
      }

      const result = await runCapabilityScan(setKeys);
      store.setKv('lastCapabilityScan', JSON.stringify(result));
      store.setKv('lastCapabilityScanAt', String(result.scannedAt));

      return { result };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('scanner:result:get', () => {
    try {
      const raw = store.getKv('lastCapabilityScan');
      if (!raw) return { result: null };
      return { result: JSON.parse(raw) };
    } catch {
      return { result: null };
    }
  });

  ipcMain.handle('scanner:platforms:detected', () => {
    try {
      const raw = store.getKv('lastCapabilityScan');
      if (!raw) return { platforms: [] };
      const scan = JSON.parse(raw);
      return { platforms: scan.connectedPlatforms ?? [] };
    } catch {
      return { platforms: [] };
    }
  });

  // ── Section 4 — Goal 1: Machine Awareness ───────────────────────────────

  ipcMain.handle('machine:getContext', async () => {
    try {
      return getMachineContext();
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ── Income Operator: Tool Gap Analyzer ──────────────────────────────────

  ipcMain.handle('toolGap:analyze', (_event, laneId: IncomeLaneId) => {
    try {
      if (!hasCapability('INCOME_SCANNER', _cachedTier)) return { error: lockedError('INCOME_SCANNER') };
      const raw = store.getKv('lastCapabilityScan');
      if (!raw) return { error: 'Run scanner:run first to detect installed tools.' };
      const scan = JSON.parse(raw);
      const gaps = analyzeGaps(scan, laneId);
      return { gaps };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('toolGap:install', async (_event, gap: ToolGap) => {
    try {
      if (!hasCapability('INCOME_SCANNER', _cachedTier)) return { error: lockedError('INCOME_SCANNER') };

      // Safety: only 'full' mode (winget) runs a command — guided opens URL
      if (gap.installMode === 'guided') {
        if (gap.installUrl) {
          shell.openExternal(gap.installUrl);
          return { ok: true, mode: 'guided', message: `Opened ${gap.installUrl} in browser. Install ${gap.toolName} then click Verify.` };
        }
        return { ok: false, error: 'No install URL available for this tool.' };
      }

      if (gap.installMode === 'full' && gap.wingetId) {
        // NOTE: winget installs to Program Files require UAC elevation.
        // The user will see a Windows UAC prompt after approving here.
        // We spawn winget via shell:true so Windows can elevate as needed.
        try {
          execSync(`winget install --id ${gap.wingetId} --silent --accept-package-agreements --accept-source-agreements`, {
            timeout: 120_000,
            windowsHide: false, // UAC prompt must be visible
            shell: true,
          } as unknown as import('child_process').ExecSyncOptions);
          return { ok: true, mode: 'full', message: `${gap.toolName} installed successfully.` };
        } catch (installErr) {
          return { ok: false, error: `Install failed: ${installErr instanceof Error ? installErr.message : String(installErr)}` };
        }
      }

      return { ok: false, error: 'No install method available for this tool.' };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('toolGap:verify', async (_event, toolName: string) => {
    try {
      // Re-run a fresh scan and check if the tool now appears
      const raw = store.getKv('lastCapabilityScan');
      const prevScan = raw ? JSON.parse(raw) : null;
      const prevSetKeys = prevScan ? (prevScan.connectedPlatforms ?? []) : [];

      const freshScan = await runCapabilityScan(prevSetKeys);
      store.setKv('lastCapabilityScan', JSON.stringify(freshScan));
      store.setKv('lastCapabilityScanAt', String(freshScan.scannedAt));

      const found = freshScan.installedApps.some(a => a.name === toolName);
      return { found, scan: freshScan };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ── Income Operator: Lane Ranking ────────────────────────────────────────

  ipcMain.handle('income:lanes:rank', () => {
    try {
      if (!hasCapability('INCOME_LANES', _cachedTier)) return { error: lockedError('INCOME_LANES') };
      const raw = store.getKv('lastCapabilityScan');
      if (!raw) return { error: 'Run scanner:run first.' };
      const scan = JSON.parse(raw);
      const ranked = rankLanes(scan);
      return { lanes: ranked };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ── Income Operator: Experiment Manager ─────────────────────────────────

  ipcMain.handle('experiment:setBudget', (_event, params: {
    totalBudget: number; maxPerExperiment: number; dailyLimit: number; reservePct?: number;
  }) => {
    try {
      if (!hasCapability('INCOME_OPERATOR', _cachedTier)) return incomeFail(lockedError('INCOME_OPERATOR'));
      const budget = _getExperimentManager(store).setBudget(params);
      return incomeOk({ budget });
    } catch (err) {
      return incomeFail(err instanceof Error ? err.message : String(err));
    }
  });

  ipcMain.handle('experiment:getBudget', () => {
    try {
      return { budget: _getExperimentManager(store).getBudget() };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('experiment:create', (_event, params: {
    laneId: string; name: string; rationale: string; budgetAsk: number;
    autoKillRule?: { budgetPctSpent: number; afterDays: number };
  }) => {
    try {
      if (!hasCapability('INCOME_OPERATOR', _cachedTier)) return incomeFail(lockedError('INCOME_OPERATOR'));
      const result = _getExperimentManager(store).createExperiment(params as never) as Record<string, unknown>;
      if (result.error) return incomeFail(result.error as string);
      return incomeOk(result);
    } catch (err) {
      return incomeFail(err instanceof Error ? err.message : String(err));
    }
  });

  ipcMain.handle('experiment:transition', (_event, id: string, to: string, reason?: string) => {
    try {
      if (!hasCapability('INCOME_OPERATOR', _cachedTier)) return incomeFail(lockedError('INCOME_OPERATOR'));
      const result = _getExperimentManager(store).transition(id, to as never, reason) as Record<string, unknown>;
      if (result.error) return incomeFail(result.error as string);
      return incomeOk(result);
    } catch (err) {
      return incomeFail(err instanceof Error ? err.message : String(err));
    }
  });

  ipcMain.handle('experiment:recordSpend', (_event, id: string, amount: number, reason: string) => {
    try {
      if (!hasCapability('INCOME_OPERATOR', _cachedTier)) return incomeFail(lockedError('INCOME_OPERATOR'));
      const result = _getExperimentManager(store).recordSpend(id, amount, reason) as Record<string, unknown>;
      if (result.error) return incomeFail(result.error as string);
      return incomeOk(result);
    } catch (err) {
      return incomeFail(err instanceof Error ? err.message : String(err));
    }
  });

  ipcMain.handle('experiment:recordRevenue', (_event, id: string, amount: number, source: string) => {
    try {
      if (!hasCapability('REVENUE_TRACKER', _cachedTier)) return incomeFail(lockedError('REVENUE_TRACKER'));
      const result = _getExperimentManager(store).recordRevenue(id, amount, source) as Record<string, unknown>;
      if (result.error) return incomeFail(result.error as string);
      return incomeOk(result);
    } catch (err) {
      return incomeFail(err instanceof Error ? err.message : String(err));
    }
  });

  ipcMain.handle('experiment:updateMetrics', (_event, id: string, patch: Record<string, number>) => {
    try {
      return _getExperimentManager(store).updateMetrics(id, patch as never);
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('experiment:evaluateAutoKill', (_event, id: string) => {
    try {
      return _getExperimentManager(store).evaluateAutoKill(id);
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('experiment:recordDecision', (_event, id: string, decision: string, reason: string) => {
    try {
      if (!hasCapability('INCOME_OPERATOR', _cachedTier)) return { error: lockedError('INCOME_OPERATOR') };
      return _getExperimentManager(store).recordDecision(id, decision as never, reason);
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('experiment:get', (_event, id: string) => {
    try {
      return _getExperimentManager(store).getExperimentSummary(id);
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('experiment:list', () => {
    try {
      return { experiments: _getExperimentManager(store).getAllExperiments() };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('experiment:listActive', () => {
    try {
      return { experiments: _getExperimentManager(store).getActiveExperiments() };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ── Income Operator: Phase 4C execution handlers ─────────────────────────
  // These are the execution bridges called after an income approval is granted,
  // or directly for low-risk actions that don't require approval.

  ipcMain.handle('experiment:kill', (_event, id: string, reason: string) => {
    try {
      if (!hasCapability('INCOME_OPERATOR', _cachedTier)) return incomeFail(lockedError('INCOME_OPERATOR'));
      const mgr = _getExperimentManager(store);
      const exp = mgr.getExperiment(id);
      if (!exp) return incomeFail(`Experiment "${id}" not found.`);
      if (exp.status === 'killed' || exp.status === 'completed') {
        return incomeFail(`Experiment is already "${exp.status}" — no action needed.`);
      }
      const result = mgr.recordDecision(id, 'kill', reason || 'Killed via Income Operator');
      if (result.error) return incomeFail(result.error);
      store.addLedger({
        id: `income-kill-${Date.now().toString(36)}`,
        timestamp: Date.now(),
        request: `Kill experiment: "${exp.name}"`,
        synthesis: reason || 'Killed via Income Operator',
        responses: [],
        workflow: 'INCOME_EXPERIMENT_KILLED',
        starred: false,
      });
      return incomeOk({ experiment: mgr.getExperiment(id) });
    } catch (err) {
      return incomeFail(err instanceof Error ? err.message : String(err));
    }
  });

  ipcMain.handle('experiment:scale', (_event, id: string, reason: string) => {
    try {
      if (!hasCapability('INCOME_OPERATOR', _cachedTier)) return incomeFail(lockedError('INCOME_OPERATOR'));
      const mgr = _getExperimentManager(store);
      const exp = mgr.getExperiment(id);
      if (!exp) return incomeFail(`Experiment "${id}" not found.`);
      if (exp.status === 'killed' || exp.status === 'completed') {
        return incomeFail(`Experiment is already "${exp.status}" — cannot scale.`);
      }
      if (exp.status !== 'measuring') {
        return incomeFail(`Cannot scale experiment in "${exp.status}" state. Experiment must be in "measuring" status.`);
      }
      const result = mgr.recordDecision(id, 'scale', reason || 'Scaled via Income Operator');
      if (result.error) return incomeFail(result.error);
      store.addLedger({
        id: `income-scale-${Date.now().toString(36)}`,
        timestamp: Date.now(),
        request: `Scale experiment: "${exp.name}"`,
        synthesis: reason || 'Scaled via Income Operator',
        responses: [],
        workflow: 'INCOME_EXPERIMENT_SCALED',
        starred: false,
      });
      return incomeOk({ experiment: mgr.getExperiment(id) });
    } catch (err) {
      return incomeFail(err instanceof Error ? err.message : String(err));
    }
  });

  ipcMain.handle('experiment:launch', (_event, id: string, reason: string) => {
    try {
      if (!hasCapability('INCOME_OPERATOR', _cachedTier)) return incomeFail(lockedError('INCOME_OPERATOR'));
      const mgr = _getExperimentManager(store);
      const exp = mgr.getExperiment(id);
      if (!exp) return incomeFail(`Experiment "${id}" not found.`);
      if (exp.status === 'killed' || exp.status === 'completed') {
        return incomeFail(`Experiment is already "${exp.status}" — cannot advance.`);
      }
      let targetStatus: string;
      if (exp.status === 'proposed')      targetStatus = 'approved';
      else if (exp.status === 'approved') targetStatus = 'building';
      else if (exp.status === 'building') targetStatus = 'launched';
      else if (exp.status === 'launched') targetStatus = 'measuring';
      else return incomeFail(`Cannot advance experiment in "${exp.status}" state.`);
      const result = mgr.transition(id, targetStatus as never, reason || 'Advanced via Income Operator');
      if (result.error) return incomeFail(result.error);
      if (targetStatus === 'launched') {
        store.addLedger({
          id: `income-launch-${Date.now().toString(36)}`,
          timestamp: Date.now(),
          request: `Launch experiment: "${exp.name}"`,
          synthesis: reason || 'Launched via Income Operator',
          responses: [],
          workflow: 'INCOME_EXPERIMENT_LAUNCHED',
          starred: false,
        });
      }
      return incomeOk({ experiment: mgr.getExperiment(id), targetStatus });
    } catch (err) {
      return incomeFail(err instanceof Error ? err.message : String(err));
    }
  });

  ipcMain.handle('content:publish', (_event, id: string, platform: string, contentNote: string) => {
    try {
      if (!hasCapability('INCOME_OPERATOR', _cachedTier)) return incomeFail(lockedError('INCOME_OPERATOR'));
      const mgr = _getExperimentManager(store);
      const exp = mgr.getExperiment(id);
      if (!exp) return incomeFail(`Experiment "${id}" not found.`);
      if (exp.status === 'killed' || exp.status === 'completed') {
        return incomeFail('Cannot publish content for a finished experiment.');
      }
      if (!platform || platform === 'unknown') return incomeFail('Platform is required to publish content.');
      store.addLedger({
        id: `income-publish-${Date.now().toString(36)}`,
        timestamp: Date.now(),
        request: `Publish content for "${exp.name}" on ${platform}`,
        synthesis: contentNote || `Published on ${platform}`,
        responses: [],
        workflow: 'INCOME_CONTENT_PUBLISHED',
        starred: false,
      });
      return incomeOk();
    } catch (err) {
      return incomeFail(err instanceof Error ? err.message : String(err));
    }
  });

  ipcMain.handle('platform:connect', (_event, id: string, platform: string, url: string) => {
    try {
      if (!hasCapability('INCOME_OPERATOR', _cachedTier)) return incomeFail(lockedError('INCOME_OPERATOR'));
      if (!platform) return incomeFail('Platform name is required.');
      const mgr = _getExperimentManager(store);
      // platform:connect accepts laneId OR experimentId as first param
      // If no experiment found by id, treat id as laneId (for lane-level connections)
      const exp = mgr.getExperiment(id);
      store.addLedger({
        id: `income-platform-${Date.now().toString(36)}`,
        timestamp: Date.now(),
        request: `Connect platform${exp ? ` for "${exp.name}"` : ` (lane: ${id})`}: ${platform}`,
        synthesis: url || `Connected ${platform}`,
        responses: [],
        workflow: 'INCOME_PLATFORM_CONNECTED',
        starred: false,
      });
      return incomeOk({ platform, connected: true });
    } catch (err) {
      return incomeFail(err instanceof Error ? err.message : String(err));
    }
  });

  // ── Income: Decision engine — returns sorted recommendations ─────────────
  ipcMain.handle('income:getRecommendations', (_event, pendingApprovalKeyList: string[]) => {
    try {
      if (!hasCapability('INCOME_OPERATOR', _cachedTier) && !hasCapability('INCOME_LANES', _cachedTier)) {
        return { recommendations: [] };
      }
      const mgr         = _getExperimentManager(store);
      const experiments = mgr.getActiveExperiments();
      const budget      = mgr.getBudget();

      // Build evaluations map
      const evaluations: DecisionInput['evaluations'] = {};
      for (const exp of experiments) {
        evaluations[exp.id] = mgr.evaluateAutoKill(exp.id);
      }

      const input: DecisionInput = {
        experiments,
        evaluations,
        budget,
        pendingApprovalKeys: new Set(pendingApprovalKeyList),
      };

      return { recommendations: generateRecommendations(input) };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ── Income: per-experiment event history (reads income JSONL ledger) ─────
  ipcMain.handle('experiment:getEvents', async (_event, id: string, limit = 30) => {
    try {
      const ledgerPath = path.join(_getDataDir(), 'income-ledger.jsonl');
      if (!fs.existsSync(ledgerPath)) return { events: [] };
      const raw  = await withRetry(() => Promise.resolve(fs.readFileSync(ledgerPath, 'utf8')));
      const events = raw.trim().split('\n').filter(Boolean)
        .map(line => { try { return JSON.parse(line) as Record<string, unknown>; } catch { return null; } })
        .filter((e): e is Record<string, unknown> => e !== null && e['experimentId'] === id)
        .reverse()
        .slice(0, limit);
      return { events };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ── Income: merged activity feed (JSONL + main Ledger INCOME_*) ──────────
  ipcMain.handle('income:getActivity', async (_event, limit = 20) => {
    try {
      interface ActivityEvent { ts: number; label: string; detail: string; eventType: string; }
      const events: ActivityEvent[] = [];
      const mgr = _getExperimentManager(store);

      // 1. Read income JSONL ledger — all experiment events (with retry for I/O)
      const ledgerPath = path.join(_getDataDir(), 'income-ledger.jsonl');
      if (fs.existsSync(ledgerPath)) {
        const raw      = await withRetry(() => Promise.resolve(fs.readFileSync(ledgerPath, 'utf8')));
        const expNames = Object.fromEntries(mgr.getAllExperiments().map(e => [e.id, e.name]));
        raw.trim().split('\n').filter(Boolean).forEach(line => {
          try {
            const e = JSON.parse(line) as Record<string, unknown>;
            const name = (expNames[e['experimentId'] as string] ?? e['experimentId']) as string;
            const ts   = (e['ts'] as number) ?? 0;
            if (e['type'] === 'spend') {
              events.push({ ts, label: `Spend: $${(e['amount'] as number).toFixed(2)}`, detail: `${name} — ${(e['reason'] as string) ?? ''}`, eventType: 'spend' });
            } else if (e['type'] === 'revenue') {
              events.push({ ts, label: `Revenue: $${(e['amount'] as number).toFixed(2)}`, detail: `${name} — ${(e['source'] as string) ?? ''}`, eventType: 'revenue' });
            } else if (e['type'] === 'status_change') {
              events.push({ ts, label: `Status: ${e['from']} → ${e['to']}`, detail: name, eventType: 'status' });
            } else if (e['type'] === 'decision') {
              events.push({ ts, label: `Decision: ${e['decision']}`, detail: `${name}${e['decisionReason'] ? ` — ${e['decisionReason']}` : ''}`, eventType: 'decision' });
            } else if (typeof e['type'] === 'string' && (e['type'] as string).startsWith('AUTOPILOT_')) {
              // Phase 5 autopilot events — already have label + detail
              events.push({ ts, label: e['label'] as string ?? e['type'], detail: e['detail'] as string ?? '', eventType: e['type'] as string });
            }
          } catch { /* skip malformed line */ }
        });
      }

      // 2. Main Ledger INCOME_* workflow entries (from Phase 4C IPC handlers)
      const incomeWorkflows = new Set([
        'INCOME_EXPERIMENT_KILLED', 'INCOME_EXPERIMENT_SCALED', 'INCOME_EXPERIMENT_LAUNCHED',
        'INCOME_CONTENT_PUBLISHED', 'INCOME_PLATFORM_CONNECTED',
      ]);
      const ledgerEntries = store.getLedger(500, 'INCOME_');
      for (const entry of ledgerEntries) {
        if (entry.workflow && incomeWorkflows.has(entry.workflow)) {
          events.push({ ts: entry.timestamp, label: entry.request, detail: entry.synthesis ?? '', eventType: 'action' });
        }
      }

      events.sort((a, b) => b.ts - a.ts);
      return { events: events.slice(0, limit) };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ── Income: Lane readiness (Phase 4E) ────────────────────────────────────
  // Returns skill + platform readiness per lane, comparing ForgeHub catalog
  // to installed SkillStore skills and experiment.platformLinks.

  ipcMain.handle('income:getReadiness', (_event, laneIds: string[]) => {
    try {
      const mgr           = _getExperimentManager(store);
      const allExps       = mgr.getAllExperiments();
      const installedList = _getSkillStore().list();
      const installedIds  = new Set(installedList.map((s: InstalledSkill) => s.id));

      const LANE_NAMES: Record<string, string> = {
        digital_products:  'Digital Products',
        client_services:   'Client Services',
        affiliate_content: 'Affiliate Content',
        faceless_youtube:  'Faceless YouTube',
        short_form_brand:  'Short-Form Brand',
        ai_music:          'AI Music',
        mini_games:        'Mini Games',
        asset_packs:       'Asset Packs',
      };

      const lanes = laneIds.map(laneId => {
        // Active experiments for this lane (not killed/completed)
        const laneExps = allExps.filter(
          e => e.laneId === laneId && e.status !== 'killed' && e.status !== 'completed',
        );

        // Readiness from experiment statuses
        let readiness: 'live' | 'building' | 'pending' = 'pending';
        if (laneExps.some(e => ['launched', 'measuring', 'scaling'].includes(e.status))) {
          readiness = 'live';
        } else if (laneExps.some(e => ['building', 'approved'].includes(e.status))) {
          readiness = 'building';
        }

        // Skills: ForgeHub catalog for this lane vs installed SkillStore
        const hubSkills = getSkillsForLane(laneId);
        const skills = hubSkills.map((s: { id: string; name: string }) => ({
          id:        s.id,
          name:      s.name,
          installed: installedIds.has(s.id),
        }));

        // Platforms: LANE_PLATFORMS expectation vs experiment.platformLinks
        const connectedSet = new Set(
          laneExps.flatMap(e => Object.keys(e.platformLinks ?? {})),
        );
        const expectedPlatforms = LANE_PLATFORMS[laneId] ?? [];
        const platforms = expectedPlatforms.map(p => ({
          id:        p.id,
          name:      p.name,
          connected: connectedSet.has(p.id),
        }));

        return {
          laneId,
          laneName:  LANE_NAMES[laneId] ?? laneId,
          readiness,
          skills,
          platforms,
        };
      });

      return { lanes };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ── Income Operator: Autopilot (Phase 5) ─────────────────────────────────

  ipcMain.handle('autopilot:enable', async () => {
    try {
      if (!hasCapability('INCOME_OPERATOR', await _agentTier()) && !hasCapability('INCOME_LANES', await _agentTier())) {
        return incomeFail(lockedError('INCOME_OPERATOR'));
      }
      _getAutopilot(store).enable();
      return incomeOk({ status: _getAutopilot(store).getStatus() });
    } catch (err) {
      return incomeFail(err instanceof Error ? err.message : String(err));
    }
  });

  ipcMain.handle('autopilot:disable', () => {
    try {
      _getAutopilot(store).disable();
      return incomeOk({ status: _getAutopilot(store).getStatus() });
    } catch (err) {
      return incomeFail(err instanceof Error ? err.message : String(err));
    }
  });

  ipcMain.handle('autopilot:status', () => {
    try {
      return { status: _getAutopilot(store).getStatus() };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('autopilot:runNow', async () => {
    try {
      if (!hasCapability('INCOME_OPERATOR', await _agentTier()) && !hasCapability('INCOME_LANES', await _agentTier())) {
        return incomeFail(lockedError('INCOME_OPERATOR'));
      }
      await _getAutopilot(store).runNow();
      return incomeOk({ status: _getAutopilot(store).getStatus() });
    } catch (err) {
      return incomeFail(err instanceof Error ? err.message : String(err));
    }
  });

  // ── ForgeHub: Curated skill catalog ─────────────────────────────────────

  ipcMain.handle('forgeHub:list', () => {
    return { skills: listForgeHubSkills() };
  });

  ipcMain.handle('forgeHub:get', (_event, id: string) => {
    const skill = getForgeHubSkill(id);
    return skill ? { skill } : { error: `Skill "${id}" not found in ForgeHub.` };
  });

  ipcMain.handle('forgeHub:forLane', (_event, laneId: string) => {
    return { skills: getSkillsForLane(laneId) };
  });

  ipcMain.handle('forgeHub:getMarkdown', (_event, id: string) => {
    const markdown = getSkillMarkdown(id);
    return markdown ? { markdown } : { error: `No markdown found for skill "${id}".` };
  });

  // ── MCP Client: Model Context Protocol ──────────────────────────────────

  ipcMain.handle('mcp:list', () => {
    return { servers: mcpRegistry.listConnected() };
  });

  ipcMain.handle('mcp:connect', async (_event, config: {
    id: string; label: string; command: string;
    args?: string[]; cwd?: string; env?: Record<string, string>;
  }) => {
    try {
      if (!hasCapability('AGENT_TASKS', _cachedTier)) return { error: lockedError('AGENT_TASKS') };
      const info = await mcpRegistry.connect(config);
      return { ok: true, serverInfo: info };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('mcp:disconnect', async (_event, id: string) => {
    try {
      await mcpRegistry.disconnect(id);
      return { ok: true };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('mcp:listTools', (_event, serverId: string) => {
    try {
      const client = mcpRegistry.getClient(serverId);
      if (!client) return { error: `MCP server "${serverId}" is not connected.` };
      return { tools: client.tools };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('mcp:evaluateTool', (_event, serverId: string, toolName: string) => {
    try {
      const client = mcpRegistry.getClient(serverId);
      if (!client) return { error: `MCP server "${serverId}" is not connected.` };
      return client.evaluateToolCall(toolName, {});
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('mcp:callTool', async (_event, serverId: string, toolName: string, args: Record<string, unknown>, approved: boolean) => {
    try {
      if (!hasCapability('AGENT_TASKS', _cachedTier)) return { error: lockedError('AGENT_TASKS') };
      const result = await mcpRegistry.callTool(serverId, toolName, args, approved);
      return { ok: true, result };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('venture:dailyPulse', async (_event, id: string) => {
    try {
      const proposal = store.getVentureProposal(id);
      if (!proposal) return { error: 'Proposal not found.' };

      const { providerManager: pm } = await getEngine();
      const providers = await pm.getActiveProviders();
      const provider = providers.length > 0 ? providers[0] : undefined;

      const { generateDailyPulse, formatPulseForPhone } = await import('@triforge/engine');
      const pulse = await generateDailyPulse(proposal as never, {}, provider);

      const concept = String(
        ((proposal.winner as Record<string, unknown>)?.candidate &&
        ((proposal.winner as Record<string, unknown>).candidate as Record<string, unknown>).concept) ?? 'Venture'
      );

      try {
        const { sendVentureDailyPulse } = await import('./councilNotify.js');
        sendVentureDailyPulse(formatPulseForPhone(pulse, concept));
      } catch { /* non-fatal */ }

      // Record outcome in learning brain (metrics sparse until analytics wired)
      try {
        const lo = _getLearningOrchestrator(store);
        lo.onVentureOutcome(id, {});
      } catch { /* learning integration non-fatal */ }

      return { pulse };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ── Wire venture phone link handlers ──────────────────────────────────────

  phoneLinkServer.setVentureHandlers(
    async (proposalId: string, action: string) => {
      const proposal = store.getVentureProposal(proposalId);
      if (!proposal) return { ok: false, error: 'Proposal not found.' };
      switch (action.toLowerCase()) {
        case 'approve':
          store.updateVentureStatus(proposalId, 'approved_for_build');
          return { ok: true };
        case 'reject':
          store.updateVentureStatus(proposalId, 'rejected');
          return { ok: true };
        case 'hold':
          return { ok: true };
        case 'plan_only':
          store.updateVentureStatus(proposalId, 'approved_plan_only');
          return { ok: true };
        case 'escalate_to_build':
          if (String(proposal.status) !== 'approved_plan_only') {
            return { ok: false, error: 'Only plan-only ventures can be escalated.' };
          }
          store.updateVentureStatus(proposalId, 'approved_for_build');
          return { ok: true };
        default:
          return { ok: false, error: `Unknown action: ${action}` };
      }
    },
    async (proposalId: string, action: string) => {
      const proposal = store.getVentureProposal(proposalId);
      if (!proposal) return { ok: false, error: 'Proposal not found.' };
      switch (action.toLowerCase()) {
        case 'file_now':
          store.updateVentureStatus(proposalId, 'filing_prepared');
          return { ok: true };
        case 'wait':
          store.updateVentureStatus(proposalId, 'filing_deferred');
          return { ok: true };
        case 'ask_again_later':
          store.updateVentureStatus(proposalId, 'filing_deferred');
          return { ok: true };
        case 'confirm_filing':
          if (String(proposal.status) !== 'filing_prepared') {
            return { ok: false, error: 'Filing can only be confirmed from filing_prepared.' };
          }
          store.updateVentureStatus(proposalId, 'filed_and_operating');
          return { ok: true };
        case 'revisit_filing':
          if (String(proposal.status) !== 'filing_deferred') {
            return { ok: false, error: 'Filing can only be revisited from filing_deferred.' };
          }
          store.updateVentureStatus(proposalId, 'awaiting_filing_decision');
          return { ok: true };
        default:
          return { ok: false, error: `Unknown filing action: ${action}` };
      }
    },
  );

  // ── Learning Brain IPC ────────────────────────────────────────────────────

  ipcMain.handle('venture:learningProfile', async () => {
    try {
      const orchestrator = _getLearningOrchestrator(store);
      const biases = orchestrator.getBiasesForScoring();
      return biases;
    } catch (err) {
      return null;
    }
  });

  ipcMain.handle('venture:refreshTrends', async () => {
    try {
      const orchestrator = _getLearningOrchestrator(store);
      await orchestrator.refreshTrends(async (query: string) => {
        const results = await searchWeb(query);
        return results.map((r: { title: string; url: string; snippet: string }) => ({
          id: `signal-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          source: r.url,
          title: r.title,
          snippet: r.snippet,
          url: r.url,
          publishedAt: Date.now(),
          relevanceScore: 70,
          trendVelocity: 'stable' as const,
        }));
      });
      return { ok: true };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ── Expert Workforce IPC ────────────────────────────────────────────────────

  ipcMain.handle('experts:roster', async () => {
    try {
      _getExpertWorkforceEngine(store); // ensure registry is initialized
      const allExperts = _expertRegistry!.getAllExperts();
      const summary = _expertRegistry!.getRosterSummary();
      return { roster: allExperts, summary };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('experts:health', async () => {
    try {
      const engine = _getExpertWorkforceEngine(store);
      const health = engine.getRosterHealth();
      return { health };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('experts:history', async (_event, since?: number) => {
    try {
      const ledger = _getExpertRosterLedger();
      const entries = await ledger.getEntries(since);
      return { entries };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('experts:bench', async (_event, expertId: string) => {
    try {
      const engine = _getExpertWorkforceEngine(store);
      const ok = engine.moveToBench(expertId, 'User-requested bench');
      return { ok };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('experts:restore', async (_event, expertId: string) => {
    try {
      const engine = _getExpertWorkforceEngine(store);
      const ok = engine.restoreFromBench(expertId);
      return { ok };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ── Expert Maintenance IPC (Fix 7: wires hiring, promotion, replacement) ──

  ipcMain.handle('experts:maintenance', async () => {
    try {
      const engine = _getExpertWorkforceEngine(store);

      // Step 1: Run base workforce evaluation + auto-apply safe actions
      const report = engine.runMaintenanceCycle();

      // Step 2: Promote eligible trial experts
      const promoted: string[] = [];
      if (_expertPromotionEngine) {
        try {
          promoted.push(..._expertPromotionEngine.promoteEligible());
        } catch { /* promotion non-fatal */ }
      }

      // Step 3: Evaluate and execute replacements
      const replaced: string[] = [];
      if (_expertReplacementEngine) {
        try {
          const decisions = _expertReplacementEngine.evaluateAllForReplacement();
          for (const d of decisions) {
            if (d.confidence >= 75 && _expertReplacementEngine.executeReplacement(d)) {
              replaced.push(d.outgoingExpertId);
            }
          }
        } catch { /* replacement non-fatal */ }
      }

      // Step 4: Evaluate hiring needs (advisory — creates candidates but does not auto-promote)
      const hiringNeeds: unknown[] = [];
      if (_expertHiringEngine) {
        try {
          const needs = _expertHiringEngine.evaluateHiringNeeds();
          for (const need of needs) {
            if (need.confidence >= 80) {
              _expertHiringEngine.createCandidate(need);
              hiringNeeds.push(need);
            }
          }
        } catch { /* hiring non-fatal */ }
      }

      return {
        ok: true,
        report,
        promoted,
        replaced,
        hiringNeeds,
      };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ── Council Agent IPC (15 agents, fire/hire, performance) ────────────────────

  ipcMain.handle('council-agents:roster', async () => {
    try {
      const { getCouncilAgentOrchestrator } = await import('@triforge/engine');
      const orch = getCouncilAgentOrchestrator();
      return { roster: orch.getRoster() };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('council-agents:performance', async () => {
    try {
      const { getCouncilAgentOrchestrator } = await import('@triforge/engine');
      const orch = getCouncilAgentOrchestrator();
      return { performance: orch.getPerformanceSummaries() };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('council-agents:fire', async (_event, agentId: string, reason: string) => {
    try {
      const { getCouncilAgentOrchestrator } = await import('@triforge/engine');
      const orch = getCouncilAgentOrchestrator();
      return orch.fireAgent(agentId, reason ?? 'User fired');
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('council-agents:restore', async (_event, agentId: string) => {
    try {
      const { getCouncilAgentOrchestrator } = await import('@triforge/engine');
      const orch = getCouncilAgentOrchestrator();
      return orch.restoreAgent(agentId);
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('council-agents:retire', async (_event, agentId: string, reason: string) => {
    try {
      const { getCouncilAgentOrchestrator } = await import('@triforge/engine');
      const orch = getCouncilAgentOrchestrator();
      return orch.retireAgent(agentId, reason ?? 'User retired');
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('council-agents:evaluate', async () => {
    try {
      const { getCouncilAgentOrchestrator } = await import('@triforge/engine');
      const orch = getCouncilAgentOrchestrator();
      const actions = orch.evaluateAndAct();
      return { ok: true, actions };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ── Evolution / Performance Hunter IPC ────────────────────────────────────

  ipcMain.handle('evolution:scan', async () => {
    try {
      const license = await store.getLicense();
      const tierVal = (license.tier ?? 'free') as Tier;
      if (tierVal !== 'business') {
        return { error: 'Performance Hunter requires Business tier.' };
      }

      const orchestrator = await _getEvolutionOrchestrator(store);
      const report = await orchestrator.runFullScan();
      return { report };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('evolution:quarantined', async () => {
    try {
      const orchestrator = await _getEvolutionOrchestrator(store);
      const components = orchestrator.getQuarantinedComponents();
      return { components };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('evolution:restore', async (_event, componentId: string) => {
    try {
      const orchestrator = await _getEvolutionOrchestrator(store);
      const ok = orchestrator.restoreComponent(componentId);
      return { ok };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('evolution:auditLog', async (_event, since?: number) => {
    try {
      const orchestrator = await _getEvolutionOrchestrator(store);
      const entries = await orchestrator.getAuditLog(since);
      return { entries };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('evolution:healthReport', async () => {
    try {
      const orchestrator = await _getEvolutionOrchestrator(store);
      const report = orchestrator.getHealthReport();
      return { report };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ── Adaptive Expert Placement IPC ────────────────────────────────────────

  ipcMain.handle('placement:status', async () => {
    try {
      const license = await store.getLicense();
      const tierVal = (license.tier ?? 'free') as Tier;
      if (tierVal !== 'business') {
        return { error: 'Adaptive Placement requires Business tier.' };
      }

      const controller = await _getExpertTrafficController(store);
      return { report: controller.getPlacementStatus() };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('placement:rebalance', async () => {
    try {
      const license = await store.getLicense();
      const tierVal = (license.tier ?? 'free') as Tier;
      if (tierVal !== 'business') {
        return { error: 'Adaptive Placement requires Business tier.' };
      }

      const controller = await _getExpertTrafficController(store);
      const decisions = controller.runRebalanceCycle();
      return { decisions };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('placement:report', async () => {
    try {
      const license = await store.getLicense();
      const tierVal = (license.tier ?? 'free') as Tier;
      if (tierVal !== 'business') {
        return { error: 'Adaptive Placement requires Business tier.' };
      }

      const controller = await _getExpertTrafficController(store);
      return { report: controller.getPlacementReport() };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ── Blueprint System ───────────────────────────────────────────────────────

  /** Returns all registered blueprint IDs with their names and descriptions. */
  ipcMain.handle('blueprint:list', () => {
    return BLUEPRINT_IDS.map(id => {
      const bp = BlueprintLoader.load(id);
      return {
        id:          bp.id,
        name:        bp.name,
        description: bp.description,
        version:     bp.version,
      };
    });
  });

  /** Returns the currently active blueprint, or null. */
  ipcMain.handle('blueprint:getActive', () => {
    const active = getActiveBlueprint();
    if (!active) return null;
    return {
      id:          active.id,
      name:        active.name,
      description: active.description,
      version:     active.version,
    };
  });

  /**
   * Activates a blueprint by ID.
   * Wires into SensorManager, AutonomyEngine, and MissionController.
   * Falls back to DEFAULT_BLUEPRINT for unknown IDs.
   */
  ipcMain.handle('blueprint:setActive', (_e, blueprintId: unknown) => {
    try {
      const id = String(blueprintId ?? '');
      const blueprint = isValidBlueprintId(id)
        ? BlueprintLoader.load(id)
        : DEFAULT_BLUEPRINT;

      if (!_sensorManager || !_autonomyEngine) {
        return { error: 'SensorManager or AutonomyEngine not initialized' };
      }

      const ctx: BlueprintApplyContext = {
        sensorManager:    _sensorManager,
        autonomyEngine:   _autonomyEngine,
        missionController: {
          registerMissionTemplates: (templates) => {
            missionController.registerMissionTemplates(templates);
          },
        },
      };

      applyBlueprint(blueprint, ctx);
      store.update('triforge.activeBlueprint', blueprint.id);

      return { ok: true, id: blueprint.id, name: blueprint.name };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  /** Deactivates the current blueprint and resets to no active blueprint. */
  ipcMain.handle('blueprint:deactivate', () => {
    try {
      if (!_sensorManager || !_autonomyEngine) {
        return { error: 'SensorManager or AutonomyEngine not initialized' };
      }

      const ctx: BlueprintApplyContext = {
        sensorManager:    _sensorManager,
        autonomyEngine:   _autonomyEngine,
        missionController: {
          registerMissionTemplates: () => { /* no-op on deactivate */ },
        },
      };

      deactivateBlueprint(ctx);
      store.update('triforge.activeBlueprint', null);
      return { ok: true };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ── Restore previously active blueprint on startup ─────────────────────────
  setTimeout(() => {
    try {
      const savedId = store.get<string | null>('triforge.activeBlueprint', null);
      if (!savedId || !isValidBlueprintId(savedId)) return;
      if (!_sensorManager || !_autonomyEngine) return;

      const blueprint = BlueprintLoader.load(savedId);
      const ctx: BlueprintApplyContext = {
        sensorManager:    _sensorManager,
        autonomyEngine:   _autonomyEngine,
        missionController: {
          registerMissionTemplates: (templates) => {
            missionController.registerMissionTemplates(templates);
          },
        },
      };
      applyBlueprint(blueprint, ctx);
    } catch { /* non-fatal — startup blueprint restore failure is silent */ }
  }, 1000);

  // ── Vibe Coding ─────────────────────────────────────────────────────────────

  ipcMain.handle('vibe:createProfile', async (_event, name: string, ventureId?: string) => {
    const lic = await store.getLicense();
    const tier = (lic.tier ?? 'free') as 'free' | 'pro';
    if (!hasCapability('VIBE_CODING', tier)) return { error: lockedError('VIBE_CODING') };
    try {
      const ps = _getVibeProfileStore(store);
      const profile = ps.createProfile(name, ventureId as import('@triforge/engine').VibeMode);
      return { ok: true, profile };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('vibe:getProfile', async (_event, id: string) => {
    const lic = await store.getLicense();
    const tier = (lic.tier ?? 'free') as 'free' | 'pro';
    if (!hasCapability('VIBE_CODING', tier)) return { error: lockedError('VIBE_CODING') };
    try {
      const ps = _getVibeProfileStore(store);
      const profile = ps.getProfile(id);
      return profile ? { ok: true, profile } : { error: 'Profile not found.' };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('vibe:listProfiles', async () => {
    const lic = await store.getLicense();
    const tier = (lic.tier ?? 'free') as 'free' | 'pro';
    if (!hasCapability('VIBE_CODING', tier)) return { error: lockedError('VIBE_CODING') };
    try {
      const ps = _getVibeProfileStore(store);
      return { ok: true, profiles: ps.getAllProfiles() };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('vibe:deleteProfile', async (_event, id: string) => {
    const lic = await store.getLicense();
    const tier = (lic.tier ?? 'free') as 'free' | 'pro';
    if (!hasCapability('VIBE_CODING', tier)) return { error: lockedError('VIBE_CODING') };
    try {
      const ps = _getVibeProfileStore(store);
      ps.deleteProfile(id);
      return { ok: true };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('vibe:updateProfile', async (_event, id: string, updates: Record<string, unknown>) => {
    const lic = await store.getLicense();
    const tier = (lic.tier ?? 'free') as 'free' | 'pro';
    if (!hasCapability('VIBE_CODING', tier)) return { error: lockedError('VIBE_CODING') };
    try {
      const ps = _getVibeProfileStore(store);
      ps.updateProfile(id, updates as any);
      const profile = ps.getProfile(id);
      return profile ? { ok: true, profile } : { error: 'Profile not found after update.' };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('vibe:parse', async (_event, input: string) => {
    const lic = await store.getLicense();
    const tier = (lic.tier ?? 'free') as 'free' | 'pro';
    if (!hasCapability('VIBE_CODING', tier)) return { error: lockedError('VIBE_CODING') };
    try {
      const { parseVibeIntent, detectVibeMode } = require('@triforge/engine');
      const signals = parseVibeIntent(input);
      const mode = detectVibeMode(input);
      return { ok: true, signals, mode };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('vibe:runCouncil', async (event, profileId: string, input: string, mode?: string) => {
    const lic = await store.getLicense();
    const tier = (lic.tier ?? 'free') as 'free' | 'pro';
    if (!hasCapability('VIBE_CODING', tier)) return { error: lockedError('VIBE_CODING') };
    try {
      const { providerManager: pm } = await getEngine();
      const providers = await pm.getActiveProviders();
      if (providers.length === 0) {
        return { error: 'No API keys configured. Add at least one in Settings.' };
      }

      const ps = _getVibeProfileStore(store);
      const profile = ps.getProfile(profileId);
      if (!profile) return { error: 'Vibe profile not found.' };

      // Build expert context from workforce engine (Fix 3 + Fix 9)
      let expertContext = '';
      let _selectedExpertIds: string[] = [];
      try {
        const wfe = _getExpertWorkforceEngine(store);

        // Fix 9: Build routing context with learning + placement hints
        const routingContext: Record<string, unknown> = {};
        try {
          const lo = _getLearningOrchestrator(store);
          const recs = lo.getExpertRecommendations('vibe_analysis');
          routingContext.learningRecommendations = recs.length > 0 ? recs : [];
        } catch { /* learning hints optional */ }
        // Placement saturation awareness
        try {
          if (_expertTrafficController) {
            const ps = _expertTrafficController.getPlacementStatus();
            const saturatedIds = (ps.lanes ?? [])
              .filter((l: any) => l.utilization >= (l.saturationThreshold ?? 80))
              .map((l: any) => l.id);
            if (saturatedIds.length > 0) {
              routingContext.placementContext = { saturatedLanes: saturatedIds };
            }
          }
        } catch { /* placement hints optional */ }

        // Fix 3: Use correct method (getExpertForTask) instead of non-existent selectExperts
        const decision = wfe.getExpertForTask('vibe_analysis', routingContext as any);
        // decision.selectedExperts is string[] of expert IDs — resolve via router
        _selectedExpertIds = decision.selectedExperts ?? [];
        if (_expertRouter && _selectedExpertIds.length > 0) {
          expertContext = _expertRouter.buildExpertContext(_selectedExpertIds);
        }
        // Routing transparency: log the decision + context for diagnostics
        console.log('[TriForge:MoE] Expert routing decision:', {
          taskType: 'vibe_analysis',
          selected: decision.selectedExperts ?? [],
          skipped: decision.skippedExperts?.length ?? 0,
          learningRecs: routingContext.learningRecommendations ?? [],
          saturatedLanes: (routingContext.placementContext as any)?.saturatedLanes ?? [],
          reason: decision.reason ?? '',
        });
      } catch { /* expert context is optional */ }

      const { runVibeCouncil } = require('@triforge/engine');
      const vibeMode = (mode ?? profile.mode ?? 'explore') as any;

      const onProgress = (phase: string, detail?: string) => {
        if (!event.sender.isDestroyed()) {
          event.sender.send('vibe:progress', { phase, detail });
        }
      };

      // Map providers to VibeCouncilProvider interface
      const councilProviders = providers.map((p: any) => ({
        name: p.name ?? 'unknown',
        chat: (msgs: { role: string; content: string }[]) => p.chat(msgs),
      }));

      const _vibeStartMs = Date.now();
      const result = await runVibeCouncil(
        input, profile, councilProviders, expertContext, vibeMode, onProgress,
      );
      const _vibeRuntimeMs = Date.now() - _vibeStartMs;

      // Record expert invocations into placement load tracker (GAP #2 fix)
      try {
        if (_expertLoadTracker && _selectedExpertIds.length > 0) {
          const perExpertMs = Math.round(_vibeRuntimeMs / _selectedExpertIds.length);
          const perExpertTokens = Math.round(200 / _selectedExpertIds.length); // estimated
          for (const eid of _selectedExpertIds) {
            const placement = _expertLoadTracker.getPlacement(eid);
            const lane = placement?.currentLane ?? 'shared:primary';
            _expertLoadTracker.recordInvocation(eid, lane, perExpertMs, perExpertTokens, 0);
          }
        }
      } catch { /* placement tracking optional */ }

      // Apply synthesized axis changes back to the stored profile
      if (result.synthesizedDecisions?.length > 0) {
        const { parseVibeIntent } = require('@triforge/engine');
        const signals = parseVibeIntent(input);
        if (signals.length > 0) {
          ps.applySignals(profileId, signals);
        }
      }

      // Record in learning brain (optional — 5 positional args)
      try {
        const lo = _getLearningOrchestrator(store);
        for (const pos of result.positions ?? []) {
          lo.onExpertContribution(
            pos.provider ?? 'expert:vibe_translator',  // expertId
            profileId,                                 // ventureId (using profile as context)
            'vibe_analysis',                           // taskType
            pos.confidence ?? 50,                      // score
            true,                                      // survived
          );
        }
      } catch { /* learning integration is optional */ }

      return { ok: true, result };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('vibe:audit', async (_event, profileId: string, currentState?: string) => {
    const lic = await store.getLicense();
    const tier = (lic.tier ?? 'free') as 'free' | 'pro';
    if (!hasCapability('VIBE_CODING', tier)) return { error: lockedError('VIBE_CODING') };
    try {
      const ps = _getVibeProfileStore(store);
      const profile = ps.getProfile(profileId);
      if (!profile) return { error: 'Vibe profile not found.' };

      const patchPlanner = _getVibePatchPlanner(store);
      const plan = patchPlanner.audit(profile, currentState ?? '');
      return { ok: true, plan };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  ipcMain.handle('vibe:rescue', async (_event, profileId: string, currentState?: string) => {
    const lic = await store.getLicense();
    const tier = (lic.tier ?? 'free') as 'free' | 'pro';
    if (!hasCapability('VIBE_CODING', tier)) return { error: lockedError('VIBE_CODING') };
    try {
      const ps = _getVibeProfileStore(store);
      const profile = ps.getProfile(profileId);
      if (!profile) return { error: 'Vibe profile not found.' };

      const patchPlanner = _getVibePatchPlanner(store);
      const plan = patchPlanner.rescue(profile, currentState ?? '');
      return { ok: true, plan };
    } catch (err) {
      return { error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ── Phase 1.5 — Always-On Background Agent ─────────────────────────────────

  function _bgLoopStatus() {
    const mgr = _getMissionManager(store);
    return {
      enabled:         store.getBackgroundLoopEnabled(),
      running:         mgr.isRunning(),
      lastTickAt:      mgr.getLastTickAt(),
      lastFiredMission: store.getLastFiredMission(),
    };
  }

  function broadcastBackgroundLoopStatus(): void {
    const payload = _bgLoopStatus();
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('backgroundLoop:status', payload);
    }
  }

  // Register the deterministic heartbeat verification mission (idempotent)
  (() => {
    const mgr = _getMissionManager(store);
    const HEARTBEAT_ID = 'phase1_heartbeat_test';
    const existing = mgr.list().find(m => m.id === HEARTBEAT_ID);
    if (!existing) {
      mgr.register({
        id:          HEARTBEAT_ID,
        name:        'Background Agent Heartbeat',
        description: 'Deterministic verification mission — fires every 5 minutes when background agent is enabled.',
        goal:        '__internal_heartbeat__',
        category:    'research',
        schedule:    'every@5m',
        enabled:     true,
        createdAt:   Date.now(),
        task: async () => {
          const firedAt = Date.now();
          console.log('[Heartbeat] phase1_heartbeat_test fired at', new Date(firedAt).toISOString());

          // Audit log evidence
          const ledger = _getAuditLedger();
          ledger.log('HEARTBEAT' as never, {
            metadata: { missionId: HEARTBEAT_ID, firedAt, source: 'background_scheduler' },
          });

          // Persist last fired mission
          store.setLastFiredMission({ id: HEARTBEAT_ID, name: 'Background Agent Heartbeat', firedAt });

          // Push live status to all open renderers
          broadcastBackgroundLoopStatus();

          // Desktop notification (no renderer required)
          if (Notification.isSupported()) {
            new Notification({
              title: 'TriForge Background Agent',
              body:  'Heartbeat mission fired — agent is running.',
              silent: true,
            }).show();
          }
        },
      });
    }
  })();

  ipcMain.handle('backgroundLoop:status', () => _bgLoopStatus());

  ipcMain.handle('backgroundLoop:enable', () => {
    store.setBackgroundLoopEnabled(true);
    _getMissionManager(store).start();
    broadcastBackgroundLoopStatus();
    return _bgLoopStatus();
  });

  ipcMain.handle('backgroundLoop:disable', () => {
    store.setBackgroundLoopEnabled(false);
    _getMissionManager(store).stop();
    broadcastBackgroundLoopStatus();
    return _bgLoopStatus();
  });

  ipcMain.handle('webhook:status', () => {
    return {
      enabled: store.getWebhookEnabled(),
      port:    store.getWebhookPort(),
      token:   store.getWebhookToken() ? '***' : '',
      running: isWebhookServerRunning(),
    };
  });

  ipcMain.handle('webhook:start', async () => {
    try {
      // Auto-generate token if not set
      let token = store.getWebhookToken();
      if (!token) {
        token = crypto.randomBytes(24).toString('hex');
        store.setWebhookToken(token);
      }
      const port = store.getWebhookPort();
      const result = await startWebhookServer(port, token, (missionId) =>
        _getMissionManager(store).runMission(missionId),
      );
      if (result.ok) {
        store.setWebhookEnabled(true);
        return { ok: true, port, token };
      }
      return { ok: false, error: result.error };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle('webhook:stop', async () => {
    try {
      await stopWebhookServer();
      store.setWebhookEnabled(false);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ── Phase 2: Inbound Task Trust Gate ────────────────────────────────────────
  // Classifies any externally-originated task before it reaches AgentLoop.
  // All non-UI task creation paths (control plane, webhook, future adapters)
  // call this function first.

  function _classifyInboundRisk(goal: string): InboundRiskClass {
    const g = goal.toLowerCase();

    // Hard-block patterns: destructive or obviously dangerous
    if (
      /\b(delete|remove|erase|wipe|format|destroy)\b.*\b(file|disk|drive|database|table|all)\b/.test(g) ||
      /\brm\s+-rf\b/.test(g) ||
      /\b(execute|run|launch)\b.*\b(script|binary|executable|malware)\b/.test(g) ||
      /\b(install|uninstall)\b.*\b(package|software|driver)\b/.test(g) ||
      /\b(modify|change|edit)\b.*\b(system|registry|host|kernel)\b/.test(g)
    ) {
      return 'high_risk';
    }

    // Skill execution patterns
    if (/\b(run skill|execute skill|skill:)\b/.test(g)) {
      return 'skill_execution';
    }

    // Write/action patterns: sends, posts, publishes, creates
    if (
      /\b(send|email|post|tweet|publish|upload|commit|deploy|create|write|overwrite)\b/.test(g) &&
      !/\b(research|find|summarize|analyze|list|show|get|read|check)\b/.test(g)
    ) {
      return 'write_action';
    }

    return 'informational';
  }

  function _classifyInboundTask(
    goal: string,
    source: InboundTaskSource,
    category?: string,
  ): InboundTaskDecision {
    const auditId   = crypto.randomUUID();
    const riskClass = _classifyInboundRisk(goal);

    // local_ui always bypasses governance — trusted source
    if (source === 'local_ui') {
      return { source, riskClass, blocked: false, requiresApproval: false, auditId };
    }

    // Evaluate against the governance rule set
    const resolution = resolveGovernance(
      _getGovernanceStore().listEnabled(),
      source as GovSource,
      riskClass as GovRiskClass,
      category,
    );

    // Audit which rule fired
    _getAuditLedger().log(
      resolution.usedFallback ? 'POLICY_RULE_FALLBACK' : 'POLICY_RULE_MATCHED',
      {
        metadata: {
          source, riskClass, category,
          ruleId:   resolution.ruleId,
          ruleName: resolution.ruleName,
          action:   resolution.action,
          auditId,
        },
      },
    );

    const blocked         = resolution.action === 'block';
    const requiresApproval = resolution.action === 'approval' || resolution.action === 'council';

    return {
      source,
      riskClass,
      blocked,
      blockReason: blocked
        ? `Blocked by policy rule: ${resolution.ruleName ?? 'fallback'}.`
        : undefined,
      requiresApproval,
      auditId,
    };
  }

  async function _createExternalTask(
    goal: string,
    category: string,
    source: InboundTaskSource,
  ): Promise<{ ok: boolean; taskId?: string; blocked?: boolean; blockReason?: string; requiresApproval?: boolean; riskClass?: string; error?: string }> {
    const decision = _classifyInboundTask(goal, source);
    const ledger = _getAuditLedger();

    ledger.log('INBOUND_TASK_RECEIVED', {
      metadata: { source, riskClass: decision.riskClass, goal: goal.slice(0, 200), auditId: decision.auditId },
    });

    eventBus.emit({ type: 'INBOUND_TASK_RECEIVED', source, riskClass: decision.riskClass, goal });

    if (decision.blocked) {
      ledger.log('INBOUND_TASK_BLOCKED', {
        metadata: { source, blockReason: decision.blockReason, auditId: decision.auditId },
      });
      eventBus.emit({ type: 'INBOUND_TASK_BLOCKED', source, blockReason: decision.blockReason!, goal });
      return { ok: false, blocked: true, blockReason: decision.blockReason, riskClass: decision.riskClass };
    }

    const validCategories: string[] = ['email', 'social', 'research', 'files', 'trading', 'general'];
    const safeCategory = validCategories.includes(category) ? category as import('@triforge/engine').TaskCategory : 'general';

    try {
      const task = _getAgentLoop(store).createTask(goal, safeCategory);
      ledger.log('CONTROL_PLANE_TASK_CREATED', {
        taskId: task.id,
        metadata: { source, riskClass: decision.riskClass, auditId: decision.auditId, category: safeCategory },
      });
      ledger.log('INBOUND_TASK_APPROVED', {
        taskId: task.id,
        metadata: { source, auditId: decision.auditId },
      });
      eventBus.emit({ type: 'INBOUND_TASK_APPROVED', source, taskId: task.id });
      eventBus.emit({ type: 'CONTROL_PLANE_TASK_CREATED', taskId: task.id, goal, source });
      return {
        ok: true,
        taskId: task.id,
        requiresApproval: decision.requiresApproval,
        riskClass: decision.riskClass,
      };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  // ── Phase 2: Control Plane IPC handlers ─────────────────────────────────────

  function _cpStatus() {
    return {
      enabled:       store.getControlPlaneEnabled(),
      running:       _controlPlane?.isRunning() ?? false,
      port:          store.getControlPlanePort(),
      token:         store.getControlPlaneToken(),
      lastStartedAt: store.getControlPlaneLastStartedAt(),
    };
  }

  function _getControlPlane(): ControlPlaneServer {
    if (!_controlPlane) {
      const mgr = _getMissionManager(store);
      _controlPlane = new ControlPlaneServer({
        getStatus: () => ({
          backgroundLoop: {
            enabled:     store.getBackgroundLoopEnabled(),
            running:     mgr.isRunning(),
            lastTickAt:  mgr.getLastTickAt(),
          },
          webhook: {
            enabled: store.getWebhookEnabled(),
            port:    store.getWebhookPort(),
            running: isWebhookServerRunning(),
          },
          controlPlane: {
            running:   _controlPlane?.isRunning() ?? false,
            port:      store.getControlPlanePort(),
            startedAt: _controlPlane?.getStartedAt() ?? null,
          },
          uptime: process.uptime() * 1000,
        }),
        getMissions: () => mgr.list().map(m => ({
          id:          m.id,
          name:        m.name,
          description: m.description,
          goal:        m.goal,
          category:    m.category,
          schedule:    m.schedule,
          enabled:     m.enabled,
        })),
        createTask: (goal, category, source) =>
          _createExternalTask(goal, category, source),
        runMission: (missionId) => mgr.runMission(missionId),
        getRecentEvents: () => {
          // Return last 50 events from the eventBus ring buffer
          return eventBus.since().slice(-50) as unknown as Array<Record<string, unknown>>;
        },
      });
    }
    return _controlPlane;
  }

  ipcMain.handle('controlPlane:status', () => _cpStatus());

  ipcMain.handle('controlPlane:start', async () => {
    try {
      let token = store.getControlPlaneToken();
      if (!token) {
        token = crypto.randomBytes(24).toString('hex');
        store.setControlPlaneToken(token);
      }
      const port = store.getControlPlanePort();
      const cp = _getControlPlane();
      const result = await cp.start(port, token);
      if (result.ok) {
        store.setControlPlaneEnabled(true);
        store.setControlPlaneLastStartedAt(Date.now());
        _getAuditLedger().log('CONTROL_PLANE_STARTED', { metadata: { port } });
        eventBus.emit({ type: 'CONTROL_PLANE_STARTED', port });
      }
      return { ..._cpStatus(), ok: result.ok, error: result.error };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle('controlPlane:stop', async () => {
    try {
      await (_controlPlane?.stop() ?? Promise.resolve());
      store.setControlPlaneEnabled(false);
      _getAuditLedger().log('CONTROL_PLANE_STOPPED', {});
      eventBus.emit({ type: 'CONTROL_PLANE_STOPPED' });
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle('controlPlane:generateToken', () => {
    const token = crypto.randomBytes(24).toString('hex');
    store.setControlPlaneToken(token);
    // Restart server with new token if running
    if (_controlPlane?.isRunning()) {
      const port = store.getControlPlanePort();
      _controlPlane.stop().then(() => {
        _controlPlane = null; // force rebuild with new token
        _getControlPlane().start(port, token).catch(console.error);
      }).catch(console.error);
    }
    return { token };
  });

  // ── Phase 3: GitHub helpers ───────────────────────────────────────────────────

  function _getGitHubReviewStore(): GitHubReviewStore {
    if (!_githubReviewStore) _githubReviewStore = new GitHubReviewStore(_getDataDir());
    return _githubReviewStore;
  }

  async function _getGitHubPat(): Promise<string> {
    const result = await _getWsCredResolver().resolve('github');
    if (result.scopeUsed === 'none' || !result.token) {
      throw new Error('GitHub PAT not configured. Add it in Settings → GitHub.');
    }
    if (result.scopeUsed === 'workspace') {
      _getAuditLedger().log('WS_INTEGRATION_USED', {
        metadata: { integration: 'github', scope: 'workspace', fallbackUsed: result.fallbackUsed, workspaceId: store.getWorkspace()?.id },
      });
    }
    return result.token;
  }

  /** Runs a PR diff or issue body through the active council providers and returns per-provider text + synthesis. */
  async function _runCouncilReview(
    prompt: string,
    systemContext: string,
  ): Promise<{ responses: Array<{ provider: string; text: string }>; synthesis: string }> {
    const { providerManager: pm } = await getEngine();
    const providers = await pm.getActiveProviders();
    if (providers.length === 0) throw new Error('No API keys configured.');

    const responses: Array<{ provider: string; text: string }> = [];

    const COUNCIL_ROLES = ['architect', 'critic', 'pragmatist'];

    await Promise.allSettled(providers.map(async (p, i) => {
      const role = COUNCIL_ROLES[Math.min(i, COUNCIL_ROLES.length - 1)];
      const messages = [
        {
          role: 'system',
          content: `You are the ${role.charAt(0).toUpperCase() + role.slice(1)} on the TriForge AI Council. ${systemContext} Be specific, structured, and direct.`,
        },
        { role: 'user', content: prompt },
      ];
      let text = '';
      try {
        await p.chatStream(messages as Array<{ role: string; content: string }>, (chunk: string) => { text += chunk; });
      } catch (e) {
        text = `[${p.name} failed: ${e instanceof Error ? e.message : String(e)}]`;
      }
      responses.push({ provider: p.name, text: text.trim() });
    }));

    // Synthesize: use first working provider
    let synthesis = '';
    const synthesisProvider = providers[0];
    if (synthesisProvider && responses.some(r => !r.text.startsWith('['))) {
      const responseSummary = responses
        .filter(r => !r.text.startsWith('['))
        .map(r => `**${r.provider}**: ${r.text.slice(0, 1200)}`)
        .join('\n\n---\n\n');

      const synthMessages = [
        {
          role: 'system',
          content: 'You are synthesizing a council review. Merge the perspectives below into a single cohesive, well-structured GitHub comment. Keep all important points. Use markdown formatting.',
        },
        { role: 'user', content: responseSummary },
      ];
      try {
        await synthesisProvider.chatStream(synthMessages as Array<{ role: string; content: string }>, (chunk: string) => { synthesis += chunk; });
      } catch {
        synthesis = responses.filter(r => !r.text.startsWith('[')).map(r => r.text).join('\n\n---\n\n');
      }
    } else {
      synthesis = responses.map(r => r.text).join('\n\n---\n\n');
    }

    return { responses, synthesis: synthesis.trim() };
  }

  // ── GitHub IPC handlers ───────────────────────────────────────────────────────

  ipcMain.handle('github:setCredential', async (_event, key: 'pat' | 'webhook_secret', value: string) => {
    const credKey = key === 'pat' ? 'github_pat' : 'github_webhook_secret';
    if (value.trim()) {
      await _getCredentialManager(store).set(credKey, value.trim());
    } else {
      await _getCredentialManager(store).delete(credKey);
    }
    return { ok: true };
  });

  ipcMain.handle('github:testConnection', async () => {
    try {
      const pat = await _getGitHubPat();
      const user = await githubAdapter.testConnection(pat);
      return { ok: true, login: user.login, name: user.name, publicRepos: user.public_repos };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle('github:listRepos', async (_event, page = 1) => {
    try {
      const pat = await _getGitHubPat();
      const repos = await githubAdapter.listRepos(pat, page);
      return { repos };
    } catch (e) {
      return { repos: [], error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle('github:listPRs', async (_event, owner: string, repo: string) => {
    try {
      const pat = await _getGitHubPat();
      const prs = await githubAdapter.listPullRequests(pat, owner, repo);
      return { prs };
    } catch (e) {
      return { prs: [], error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle('github:listIssues', async (_event, owner: string, repo: string) => {
    try {
      const pat = await _getGitHubPat();
      const issues = await githubAdapter.listIssues(pat, owner, repo);
      return { issues };
    } catch (e) {
      return { issues: [], error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle('github:reviewPR', async (_event, owner: string, repo: string, prNumber: number) => {
    try {
      const pat = await _getGitHubPat();

      _getAuditLedger().log('GITHUB_PR_REVIEW_REQUESTED', {
        metadata: { owner, repo, prNumber },
      });
      eventBus.emit({ type: 'GITHUB_PR_REVIEW_REQUESTED', owner, repo, prNumber });

      // Fetch PR metadata + diff
      const [prs, diff] = await Promise.all([
        githubAdapter.listPullRequests(pat, owner, repo),
        githubAdapter.getPRDiff(pat, owner, repo, prNumber),
      ]);
      const pr = prs.find(p => p.number === prNumber);
      const title = pr?.title ?? `PR #${prNumber}`;

      // Phase 16: inject repo-specific review instructions from shared context
      const _repoCtx = resolveRepo(store.getSharedContext(), `${owner}/${repo}`);
      const _reviewInstructions = _repoCtx.mapping?.reviewInstructions;
      const _projectCtxNote = _repoCtx.projectNote?.automationContext;

      const prompt =
        `## Pull Request: ${title} (${owner}/${repo} #${prNumber})\n\n` +
        `**Author:** ${pr?.user ?? 'unknown'} | **Branch:** ${pr?.head_ref ?? '?'} → ${pr?.base_ref ?? '?'}\n` +
        `**Changes:** +${pr?.additions ?? '?'} -${pr?.deletions ?? '?'} in ${pr?.changed_files ?? '?'} file(s)\n\n` +
        (pr?.body ? `**Description:**\n${pr.body.slice(0, 500)}\n\n` : '') +
        (_reviewInstructions ? `## Repository Review Instructions\n${_reviewInstructions.slice(0, 1000)}\n\n` : '') +
        (_projectCtxNote ? `## Project Context\n${_projectCtxNote.slice(0, 500)}\n\n` : '') +
        `## Diff\n\`\`\`diff\n${diff.slice(0, 35_000)}\n\`\`\`\n\n` +
        `Provide a structured code review with: 1) Summary of changes, 2) Potential issues or bugs, 3) Security considerations, 4) Suggestions for improvement. Be specific and cite line numbers where possible.`;

      const systemContext = 'You are reviewing a GitHub Pull Request as part of a three-head AI council.';
      const { responses, synthesis } = await _runCouncilReview(prompt, systemContext);

      const reviewStore = _getGitHubReviewStore();
      const review = reviewStore.create({
        type: 'pr_review',
        owner, repo,
        number: prNumber,
        title,
        htmlUrl: pr?.html_url ?? `https://github.com/${owner}/${repo}/pull/${prNumber}`,
        responses,
        synthesis,
        source: 'manual',
      });

      _getAuditLedger().log('GITHUB_PR_REVIEW_COMPLETED', {
        metadata: { owner, repo, prNumber, reviewId: review.id },
      });
      eventBus.emit({ type: 'GITHUB_PR_REVIEW_COMPLETED', owner, repo, prNumber, reviewId: review.id });

      return { ok: true, reviewId: review.id, review };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle('github:triageIssue', async (_event, owner: string, repo: string, issueNumber: number) => {
    try {
      const pat = await _getGitHubPat();

      const issues = await githubAdapter.listIssues(pat, owner, repo, 'open');
      const issue = issues.find(i => i.number === issueNumber);
      const title = issue?.title ?? `Issue #${issueNumber}`;

      const prompt =
        `## GitHub Issue: ${title} (${owner}/${repo} #${issueNumber})\n\n` +
        `**Author:** ${issue?.user ?? 'unknown'} | **Labels:** ${issue?.labels?.join(', ') || 'none'}\n\n` +
        `**Body:**\n${(issue?.body ?? '(no description)').slice(0, 2000)}\n\n` +
        `Analyze this issue and provide:\n` +
        `1. **Priority** (critical/high/medium/low) with reasoning\n` +
        `2. **Suggested labels** (max 3)\n` +
        `3. **Summary** (2-3 sentences for a comment)\n` +
        `4. **Suggested next steps** for the maintainer\n`;

      const systemContext = 'You are triaging a GitHub issue as part of a three-head AI council.';
      const { responses, synthesis } = await _runCouncilReview(prompt, systemContext);

      const reviewStore = _getGitHubReviewStore();
      const review = reviewStore.create({
        type: 'issue_triage',
        owner, repo,
        number: issueNumber,
        title,
        htmlUrl: issue?.html_url ?? `https://github.com/${owner}/${repo}/issues/${issueNumber}`,
        responses,
        synthesis,
        source: 'manual',
      });

      _getAuditLedger().log('GITHUB_ISSUE_TRIAGE_COMPLETED', {
        metadata: { owner, repo, issueNumber, reviewId: review.id },
      });
      eventBus.emit({ type: 'GITHUB_ISSUE_TRIAGE_COMPLETED', owner, repo, issueNumber, reviewId: review.id });

      return { ok: true, reviewId: review.id, review };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle('github:pendingReviews', () => {
    return { reviews: _getGitHubReviewStore().listPending() };
  });

  ipcMain.handle('github:approveReview', async (_event, reviewId: string) => {
    try {
      const pat = await _getGitHubPat();
      const reviewStore = _getGitHubReviewStore();
      const review = reviewStore.get(reviewId);
      if (!review) return { ok: false, error: 'Review not found' };
      if (review.status !== 'pending') return { ok: false, error: `Review is already ${review.status}` };

      const comment = await githubAdapter.postComment(
        pat, review.owner, review.repo, review.number, review.synthesis,
      );

      reviewStore.update(reviewId, {
        status: 'posted',
        commentUrl: comment.html_url,
        approvedAt: Date.now(),
      });

      _getAuditLedger().log('GITHUB_COMMENT_POSTED', {
        metadata: { owner: review.owner, repo: review.repo, number: review.number, commentUrl: comment.html_url },
      });
      eventBus.emit({ type: 'GITHUB_COMMENT_POSTED', owner: review.owner, repo: review.repo, number: review.number, commentUrl: comment.html_url });
      eventBus.emit({ type: 'GITHUB_REVIEW_APPROVED', reviewId, commentUrl: comment.html_url });

      return { ok: true, commentUrl: comment.html_url };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle('github:dismissReview', (_event, reviewId: string) => {
    const store_ = _getGitHubReviewStore();
    const review = store_.get(reviewId);
    if (!review) return { ok: false, error: 'Review not found' };
    store_.update(reviewId, { status: 'dismissed' });
    eventBus.emit({ type: 'GITHUB_REVIEW_DISMISSED', reviewId });
    return { ok: true };
  });

  ipcMain.handle('github:webhookStatus', async () => {
    const hasSecret = !!(await _getCredentialManager(store).get('github_webhook_secret'));
    return { enabled: _githubWebhookEnabled, hasSecret, port: store.getWebhookPort() };
  });

  function _registerGitHubWebhookRoute(): void {
    registerGitHubWebhookHandler(async (req, res, body) => {
      const secret = await _getCredentialManager(store).get('github_webhook_secret') ?? '';
      await handleGitHubWebhook(req, res, body, secret, async (eventType, payload) => {
        _getAuditLedger().log('GITHUB_WEBHOOK_RECEIVED', {
          metadata: { event: eventType, ...payload },
        });
        eventBus.emit({ type: 'GITHUB_WEBHOOK_RECEIVED', event: eventType, owner: payload.owner, repo: payload.repo, number: payload.number });

        // Dispatch through the inbound trust gate
        const goal = eventType === 'pr_opened'
          ? `Review PR #${payload.number} "${payload.title}" in ${payload.owner}/${payload.repo}`
          : `Triage issue #${payload.number} "${payload.title}" in ${payload.owner}/${payload.repo}`;

        const decision = _classifyInboundTask(goal, 'webhook_local');
        if (!decision.blocked) {
          const task = _getAgentLoop(store).createTask(goal, 'research');
          _getAuditLedger().log('INBOUND_TASK_APPROVED', {
            taskId: task.id,
            metadata: { source: 'webhook_local', event: eventType, auditId: decision.auditId },
          });
          eventBus.emit({ type: 'INBOUND_TASK_APPROVED', source: 'webhook_local', taskId: task.id });
        }
      });
    });
  }

  ipcMain.handle('github:webhookEnable', async () => {
    _githubWebhookEnabled = true;
    _registerGitHubWebhookRoute();
    return { ok: true };
  });

  ipcMain.handle('github:webhookDisable', () => {
    _githubWebhookEnabled = false;
    unregisterGitHubWebhookHandler();
    return { ok: true };
  });

  // ── Phase 2: Skill Trust IPC handler ────────────────────────────────────────

  ipcMain.handle('skillTrust:analyze', (_event, rawMarkdown: string) => {
    if (typeof rawMarkdown !== 'string' || rawMarkdown.length > 512_000) {
      return { error: 'Invalid input' };
    }
    try {
      const result = analyzeSkill(rawMarkdown);
      const decision = evaluateSkillPolicy(result);

      const skillName = result.frontmatter.name ?? 'unknown';
      _getAuditLedger().log('SKILL_ANALYZED', {
        metadata: { name: skillName, riskLevel: result.riskLevel, blocked: result.blocked },
      });
      eventBus.emit({ type: 'SKILL_ANALYZED', name: skillName, riskLevel: result.riskLevel, blocked: result.blocked });

      if (result.blocked) {
        _getAuditLedger().log('SKILL_BLOCKED', {
          metadata: { name: skillName, blockReason: result.blockReason },
        });
        eventBus.emit({ type: 'SKILL_BLOCKED', name: skillName, blockReason: result.blockReason! });
      }

      return { result, decision };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ── Phase 5: Skill Store IPC handlers ────────────────────────────────────────

  // skill:list — all installed skills
  ipcMain.handle('skill:list', () => {
    return { skills: _getSkillStore().list() };
  });

  // skill:install — analyze, gate, then persist if allowed/approved
  ipcMain.handle('skill:install', (_e, rawMarkdown: string, source: string, sourceUrl?: string) => {
    if (typeof rawMarkdown !== 'string' || rawMarkdown.length > 512_000) {
      return incomeFail('Invalid input');
    }
    try {
      const result   = analyzeSkill(rawMarkdown);
      const decision = evaluateSkillPolicy(result);
      const name     = result.frontmatter.name ?? 'unnamed-skill';

      if (!decision.allowed) {
        _getAuditLedger().log('SKILL_INSTALL_BLOCKED', {
          metadata: { name, riskLevel: result.riskLevel, blockReason: decision.blockReason },
        });
        return incomeFail(decision.blockReason ?? `Skill "${name}" is blocked by policy.`);
      }

      const skill = _getSkillStore().install({
        name:                   name,
        version:                result.frontmatter.version,
        description:            result.frontmatter.description,
        author:                 result.frontmatter.author,
        source:                 (source as InstalledSkill['source']) || 'paste',
        sourceUrl,
        rawMarkdown,
        riskLevel:              result.riskLevel,
        blocked:                result.blocked,
        requiresApproval:       result.requiresApproval,
        councilReviewRequired:  result.councilReviewRequired,
        declaredCapabilities:   result.declaredCapabilities,
        detectedCapabilities:   result.detectedCapabilities,
        reviewSummary:          result.reviewSummary,
        enabled:                true,
      });

      _getAuditLedger().log('SKILL_INSTALLED', {
        metadata: { id: skill.id, name: skill.name, riskLevel: skill.riskLevel, source: skill.source },
      });

      return incomeOk({ skill, decision, result });
    } catch (e) {
      return incomeFail(e instanceof Error ? e.message : String(e));
    }
  });

  // skill:enable / skill:disable
  ipcMain.handle('skill:enable',  (_e, id: string) => ({ ok: _getSkillStore().setEnabled(id, true)  }));
  ipcMain.handle('skill:disable', (_e, id: string) => ({ ok: _getSkillStore().setEnabled(id, false) }));

  // skill:uninstall
  ipcMain.handle('skill:uninstall', (_e, id: string) => {
    const skill = _getSkillStore().get(id);
    const ok    = _getSkillStore().uninstall(id);
    if (ok && skill) {
      _getAuditLedger().log('SKILL_UNINSTALLED', { metadata: { id, name: skill.name } });
    }
    return { ok };
  });

  // skill:run — execute via normal task path (respects all trust/approval rules)
  ipcMain.handle('skill:run', async (_e, id: string, goal?: string) => {
    const skill = _getSkillStore().get(id);
    if (!skill) return { ok: false, error: 'Skill not found' };
    if (!skill.enabled) return { ok: false, error: 'Skill is disabled' };

    // Compose task goal from skill name + optional user goal
    const taskGoal = goal?.trim()
      ? `${goal.trim()} (using skill: ${skill.name})`
      : `Run skill: ${skill.name} — ${skill.description ?? ''}`.trim();

    try {
      const { taskEngine } = await getEngine() as unknown as { taskEngine: { createTask: (opts: { goal: string; category: string; metadata?: Record<string, unknown> }) => Promise<{ id: string }> } };
      const task = await taskEngine.createTask({
        goal:     taskGoal,
        category: 'ops',
        metadata: { skillId: id, skillName: skill.name, source: 'skill_store' },
      });
      _getSkillStore().recordRun(id);
      _getAuditLedger().log('SKILL_EXECUTED', { taskId: task.id, metadata: { skillId: id, name: skill.name } });
      return { ok: true, taskId: task.id };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // skill:fetchUrl — download raw SKILL.md content from a URL
  ipcMain.handle('skill:fetchUrl', async (_e, url: string) => {
    if (!url.startsWith('https://') && !url.startsWith('http://')) {
      return { ok: false, error: 'Only http/https URLs are supported' };
    }
    return new Promise<{ ok: boolean; markdown?: string; error?: string }>((resolve) => {
      const mod = url.startsWith('https://') ? https : http;
      let raw = '';
      const req = mod.get(url, { timeout: 10_000 }, (res) => {
        if ((res.statusCode ?? 0) >= 400) {
          resolve({ ok: false, error: `HTTP ${res.statusCode}` });
          return;
        }
        res.setEncoding('utf8');
        res.on('data', (c: string) => { raw += c; if (raw.length > 256_000) { req.destroy(); resolve({ ok: false, error: 'Response too large (>256KB)' }); } });
        res.on('end', () => resolve({ ok: true, markdown: raw }));
      });
      req.on('error', (e) => resolve({ ok: false, error: e.message }));
      req.on('timeout', () => { req.destroy(); resolve({ ok: false, error: 'Request timed out' }); });
    });
  });

  // skill:examples — built-in safe example skills
  ipcMain.handle('skill:examples', () => {
    return { examples: BUNDLED_SKILL_EXAMPLES };
  });

  // ── Phase 6: Telegram IPC handlers ───────────────────────────────────────────

  // Internal: handle one inbound Telegram message through the trust gate
  async function _handleTelegramMessage(msg: TgMessage): Promise<void> {
    const text   = msg.text ?? '';
    const chatId = msg.chat.id;
    const chatName = msg.chat.username ?? msg.chat.title ?? msg.chat.first_name ?? String(chatId);
    const ledger = _getAuditLedger();

    // Record inbound
    const logEntry = _messageLog.push({
      direction: 'inbound',
      channel:   'telegram',
      chatId,
      chatName,
      text: text.slice(0, 500),
      status: 'received',
    });

    store.setTelegramLastMessageAt(Date.now());

    ledger.log('TELEGRAM_MESSAGE_RECEIVED', {
      metadata: { chatId, chatName, textLen: text.length },
    });

    // ── 1. Allowlist check ────────────────────────────────────────────────────
    const allowed = store.getTelegramAllowedChats();
    if (allowed.length > 0 && !allowed.includes(chatId)) {
      _messageLog.update(logEntry.id, { status: 'blocked', blockedReason: 'Chat ID not in allowlist' });
      ledger.log('TELEGRAM_MESSAGE_BLOCKED', {
        metadata: { chatId, reason: 'not_in_allowlist' },
      });
      // Silently ignore — do not respond to unknown chats
      return;
    }

    // ── 2. Prompt injection detection ─────────────────────────────────────────
    if (_detectPromptInjection(text)) {
      _messageLog.update(logEntry.id, { status: 'blocked', blockedReason: 'Prompt injection detected' });
      ledger.log('TELEGRAM_MESSAGE_BLOCKED', {
        metadata: { chatId, reason: 'prompt_injection' },
      });
      if (_telegramBot) {
        await _telegramBot.sendMessage(chatId, 'This request cannot be processed.');
      }
      return;
    }

    // ── 3. Risk classification ────────────────────────────────────────────────
    const riskClass = _classifyInboundRisk(text);
    _messageLog.update(logEntry.id, { status: 'classified', riskClass } as never);

    ledger.log('TELEGRAM_MESSAGE_RECEIVED', {
      metadata: { chatId, riskClass },
    });

    // Hard-block high_risk via external channel
    if (riskClass === 'high_risk') {
      _messageLog.update(logEntry.id, { status: 'blocked', blockedReason: 'High-risk request blocked' });
      ledger.log('TELEGRAM_MESSAGE_BLOCKED', {
        metadata: { chatId, reason: 'high_risk', riskClass },
      });
      void _pushNotifier.fire('high_risk_blocked', 'High-Risk Request Blocked', `Blocked Telegram message from chat ${chatId}: ${text.slice(0, 80)}`);
      if (_telegramBot) {
        await _telegramBot.sendMessage(chatId, 'This request cannot be processed via this channel.');
      }
      return;
    }

    // write_action requires approval before reply
    if (riskClass === 'write_action' || riskClass === 'skill_execution') {
      _messageLog.update(logEntry.id, { status: 'approval_pending' });
      ledger.log('TELEGRAM_APPROVAL_PENDING', {
        metadata: { chatId, riskClass, text: text.slice(0, 200) },
      });
      _fireEventRecipes('event:approval_required', { label: 'Approval Required — Telegram', body: `${riskClass} task from chat ${chatId}: ${text.slice(0, 80)}` });
      void _pushNotifier.fire('approval_required', 'Approval Required — Telegram', `${riskClass} task from chat ${chatId}: ${text.slice(0, 80)}`).then(ok => {
        if (ok) _getAuditLedger().log('PUSH_SENT', { metadata: { event: 'approval_required', channel: 'telegram' } });
      });
      if (_telegramBot) {
        await _telegramBot.sendMessage(
          chatId,
          `Your request requires approval before I can proceed.\nRisk class: ${riskClass}\n\nA human will review and approve this action in TriForge.`,
        );
      }
      // Still create the task so it appears in the approval queue
    }

    // ── 4. Create task ────────────────────────────────────────────────────────
    try {
      const task = _getAgentLoop(store).createTask(text, 'research');
      _messageLog.update(logEntry.id, { status: 'task_created', taskId: task.id });

      ledger.log('TELEGRAM_TASK_CREATED', {
        taskId:   task.id,
        metadata: { chatId, riskClass },
      });

      // For informational tasks: set up a one-shot reply when the task completes
      if (riskClass === 'informational') {
        const unsub = eventBus.onAny((event) => {
          if (event.type === 'TASK_COMPLETED' && (event as Record<string, unknown>).taskId === task.id) {
            unsub();
            const result = (event as Record<string, unknown>).result as string | undefined;
            const reply  = result ? result.slice(0, 3000) : 'Task completed.';
            if (_telegramBot) {
              _telegramBot.sendMessage(chatId, reply).then(ok => {
                if (ok) {
                  _messageLog.push({ direction: 'outbound', channel: 'telegram', chatId, chatName, text: reply, status: 'replied', taskId: task.id });
                  ledger.log('TELEGRAM_REPLY_SENT', { taskId: task.id, metadata: { chatId } });
                }
              }).catch(() => {/* no-op */});
            }
          }
        });
      }
    } catch (err) {
      console.error('[Telegram] Failed to create task:', err);
    }
  }

  // telegram:setToken — save bot token
  ipcMain.handle('telegram:setToken', async (_e, token: string) => {
    const creds = new CredentialManager(store);
    await creds.set('telegram_bot_token', token.trim());
    return { ok: true };
  });

  // telegram:testConnection — validate token, return bot info
  ipcMain.handle('telegram:testConnection', async () => {
    const creds = new CredentialManager(store);
    const token = await creds.get('telegram_bot_token');
    if (!token) return { ok: false, error: 'No bot token saved' };
    try {
      const bot  = new TelegramAdapter(token);
      const info = await bot.getMe();
      store.setTelegramBotUsername(info.username);
      return { ok: true, username: info.username, firstName: info.first_name, id: info.id };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // telegram:start — begin polling
  ipcMain.handle('telegram:start', async () => {
    if (_telegramBot?.isRunning()) return { ok: true, already: true };
    const creds = new CredentialManager(store);
    const token = await creds.get('telegram_bot_token');
    if (!token) return { ok: false, error: 'No bot token configured' };
    try {
      // Validate token first
      const adapter = new TelegramAdapter(token);
      const info    = await adapter.getMe();
      store.setTelegramBotUsername(info.username);
      store.setTelegramEnabled(true);
      _telegramBot = adapter;
      _telegramBot.start((msg) => { void _handleTelegramMessage(msg); });
      _getAuditLedger().log('TELEGRAM_BOT_STARTED', { metadata: { username: info.username } });
      return { ok: true, username: info.username };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // telegram:stop
  ipcMain.handle('telegram:stop', () => {
    _telegramBot?.stop();
    _telegramBot = null;
    store.setTelegramEnabled(false);
    _getAuditLedger().log('TELEGRAM_BOT_STOPPED', {});
    return { ok: true };
  });

  // telegram:status
  ipcMain.handle('telegram:status', () => {
    return {
      enabled:       store.getTelegramEnabled(),
      running:       _telegramBot?.isRunning() ?? false,
      botUsername:   store.getTelegramBotUsername(),
      allowedChats:  store.getTelegramAllowedChats(),
      lastMessageAt: store.getTelegramLastMessageAt(),
    };
  });

  // telegram:addAllowedChat
  ipcMain.handle('telegram:addAllowedChat', (_e, chatId: number) => {
    const current = store.getTelegramAllowedChats();
    if (!current.includes(chatId)) {
      store.setTelegramAllowedChats([...current, chatId]);
    }
    return { ok: true, allowedChats: store.getTelegramAllowedChats() };
  });

  // telegram:removeAllowedChat
  ipcMain.handle('telegram:removeAllowedChat', (_e, chatId: number) => {
    store.setTelegramAllowedChats(store.getTelegramAllowedChats().filter(id => id !== chatId));
    return { ok: true, allowedChats: store.getTelegramAllowedChats() };
  });

  // telegram:sendMessage — manual test send
  ipcMain.handle('telegram:sendMessage', async (_e, chatId: number, text: string) => {
    if (!_telegramBot?.isRunning()) return { ok: false, error: 'Bot not running' };
    const ok = await _telegramBot.sendMessage(chatId, text.slice(0, 4096));
    if (ok) {
      _messageLog.push({ direction: 'outbound', channel: 'telegram', chatId, text: text.slice(0, 500), status: 'replied' });
      _getAuditLedger().log('TELEGRAM_REPLY_SENT', { metadata: { chatId, manual: true } });
    }
    return { ok };
  });

  // telegram:listMessages — recent message log
  ipcMain.handle('telegram:listMessages', (_e, limit = 50) => {
    return { messages: _messageLog.list(limit) };
  });

  // ── Phase 7: Governance / Policy IPC handlers ─────────────────────────────────

  // policy:list — all rules ordered by priority
  ipcMain.handle('policy:list', () => {
    return { rules: _getGovernanceStore().list() };
  });

  // policy:create — add a new custom rule
  ipcMain.handle('policy:create', (_e, fields: {
    name: string; description?: string; priority: number; enabled: boolean;
    matchSource: string; matchRiskClass: string; matchCategory?: string;
    action: string; preferLocal?: boolean;
  }) => {
    const rule = _getGovernanceStore().create({
      name:          fields.name,
      description:   fields.description,
      priority:      Number(fields.priority),
      enabled:       Boolean(fields.enabled),
      matchSource:   fields.matchSource as GovSource,
      matchRiskClass: fields.matchRiskClass as GovRiskClass,
      matchCategory: fields.matchCategory,
      action:        fields.action as import('@triforge/engine').GovAction,
      preferLocal:   fields.preferLocal ?? false,
    });
    _getAuditLedger().log('POLICY_RULE_CREATED', { metadata: { ruleId: rule.id, name: rule.name } });
    return { ok: true, rule };
  });

  // policy:update — patch an existing rule
  ipcMain.handle('policy:update', (_e, id: string, patch: Partial<{
    name: string; description: string; priority: number; enabled: boolean;
    matchSource: string; matchRiskClass: string; matchCategory: string;
    action: string; preferLocal: boolean;
  }>) => {
    const rule = _getGovernanceStore().update(id, patch as Record<string, unknown> as Parameters<ReturnType<typeof _getGovernanceStore>['update']>[1]);
    if (!rule) return { ok: false, error: 'Rule not found' };
    _getAuditLedger().log('POLICY_RULE_UPDATED', { metadata: { ruleId: id, patch } });
    return { ok: true, rule };
  });

  // policy:delete — remove a custom (non-default) rule
  ipcMain.handle('policy:delete', (_e, id: string) => {
    const ok = _getGovernanceStore().delete(id);
    if (ok) _getAuditLedger().log('POLICY_RULE_DELETED', { metadata: { ruleId: id } });
    return { ok };
  });

  // policy:enable / policy:disable
  ipcMain.handle('policy:enable',  (_e, id: string) => ({ ok: _getGovernanceStore().setEnabled(id, true)  }));
  ipcMain.handle('policy:disable', (_e, id: string) => ({ ok: _getGovernanceStore().setEnabled(id, false) }));

  // policy:setPriority
  ipcMain.handle('policy:setPriority', (_e, id: string, priority: number) => ({
    ok: _getGovernanceStore().setPriority(id, Number(priority)),
  }));

  // policy:reset — restore all default rules
  ipcMain.handle('policy:reset', () => {
    _getGovernanceStore().resetDefaults();
    _getAuditLedger().log('POLICY_DEFAULTS_RESET', {});
    return { ok: true };
  });

  // policy:simulate — evaluate source+riskClass+category against current rules
  ipcMain.handle('policy:simulate', (_e, source: string, riskClass: string, category?: string) => {
    const resolution = resolveGovernance(
      _getGovernanceStore().listEnabled(),
      source as GovSource,
      riskClass as GovRiskClass,
      category,
    );
    return { resolution };
  });

  // ── Phase 8: Slack IPC handlers ───────────────────────────────────────────────

  // Internal: handle one inbound Slack message through the trust gate
  async function _handleSlackMessage(msg: SlackMessage): Promise<void> {
    const text      = msg.text ?? '';
    const channelId = msg.channelId;
    const ledger    = _getAuditLedger();

    // Record inbound
    const logEntry = _messageLog.push({
      direction: 'inbound',
      channel:   'slack',
      chatId:    0,
      channelId,
      chatName:  `#${channelId}`,
      text:      text.slice(0, 500),
      status:    'received',
    });

    store.setSlackLastMessageAt(Date.now());
    ledger.log('SLACK_MESSAGE_RECEIVED', { metadata: { channelId, userId: msg.userId, textLen: text.length } });

    // ── 1. Allowlist checks ───────────────────────────────────────────────────
    const allowedChannels = store.getSlackAllowedChannels();
    if (allowedChannels.length > 0 && !allowedChannels.includes(channelId)) {
      _messageLog.update(logEntry.id, { status: 'blocked', blockedReason: 'Channel not in allowlist' });
      ledger.log('SLACK_MESSAGE_BLOCKED', { metadata: { channelId, reason: 'not_in_allowlist' } });
      return;
    }

    const allowedUsers = store.getSlackAllowedUsers();
    if (allowedUsers.length > 0 && !allowedUsers.includes(msg.userId)) {
      _messageLog.update(logEntry.id, { status: 'blocked', blockedReason: 'User not in allowlist' });
      ledger.log('SLACK_MESSAGE_BLOCKED', { metadata: { channelId, userId: msg.userId, reason: 'user_not_in_allowlist' } });
      return;
    }

    // ── 2. Prompt injection detection ─────────────────────────────────────────
    if (_detectPromptInjection(text)) {
      _messageLog.update(logEntry.id, { status: 'blocked', blockedReason: 'Prompt injection detected' });
      ledger.log('SLACK_MESSAGE_BLOCKED', { metadata: { channelId, reason: 'prompt_injection' } });
      if (_slackAdapter) {
        await _slackAdapter.postMessage(channelId, 'This request cannot be processed.');
      }
      return;
    }

    // ── 3. Risk classification via governance ─────────────────────────────────
    const { blocked, requiresApproval, riskClass } = _classifyInboundTask(text, 'slack' as InboundTaskSource);
    _messageLog.update(logEntry.id, { status: 'classified', riskClass } as never);

    if (blocked) {
      _messageLog.update(logEntry.id, { status: 'blocked', blockedReason: 'Blocked by policy' });
      ledger.log('SLACK_MESSAGE_BLOCKED', { metadata: { channelId, riskClass, reason: 'policy_block' } });
      if (riskClass === 'high_risk') void _pushNotifier.fire('high_risk_blocked', 'High-Risk Request Blocked', `Blocked Slack message in ${channelId}: ${text.slice(0, 80)}`);
      if (_slackAdapter) {
        await _slackAdapter.postMessage(channelId, 'This request cannot be processed via this channel.');
      }
      return;
    }

    if (requiresApproval) {
      _messageLog.update(logEntry.id, { status: 'approval_pending' });
      ledger.log('SLACK_APPROVAL_PENDING', { metadata: { channelId, riskClass, text: text.slice(0, 200) } });
      _fireEventRecipes('event:approval_required', { label: 'Approval Required — Slack', body: `${riskClass} task in ${channelId}: ${text.slice(0, 80)}` });
      void _pushNotifier.fire('approval_required', 'Approval Required — Slack', `${riskClass} task in ${channelId}: ${text.slice(0, 80)}`);
      if (_slackAdapter) {
        await _slackAdapter.postMessage(
          channelId,
          `Your request requires approval before I can proceed.\nRisk class: *${riskClass}*\n\nA human will review this action in TriForge.`,
        );
      }
      // Still create the task so it appears in the approval queue
    }

    // ── 4. Create task ────────────────────────────────────────────────────────
    try {
      const task = _getAgentLoop(store).createTask(text, 'research');
      _messageLog.update(logEntry.id, { status: 'task_created', taskId: task.id });
      ledger.log('SLACK_TASK_CREATED', { taskId: task.id, metadata: { channelId, riskClass } });

      // For informational tasks: auto-reply when the task completes
      if (riskClass === 'informational') {
        const unsub = eventBus.onAny((event) => {
          if (event.type === 'TASK_COMPLETED' && (event as Record<string, unknown>).taskId === task.id) {
            unsub();
            const result = (event as Record<string, unknown>).result as string | undefined;
            const reply  = result ? result.slice(0, 3000) : 'Task completed.';
            if (_slackAdapter) {
              _slackAdapter.postMessage(channelId, reply).then(ok => {
                if (ok) {
                  _messageLog.push({ direction: 'outbound', channel: 'slack', chatId: 0, channelId, chatName: `#${channelId}`, text: reply, status: 'replied', taskId: task.id });
                  ledger.log('SLACK_REPLY_SENT', { taskId: task.id, metadata: { channelId } });
                }
              }).catch(() => {/* no-op */});
            }
          }
        });
      }
    } catch (err) {
      console.error('[Slack] Failed to create task:', err);
    }
  }

  // Internal: build and send a scheduled summary to the configured channel
  async function _sendSlackSummary(): Promise<void> {
    if (!_slackAdapter?.isRunning()) return;
    const channelId = store.getSlackSummaryChannel();
    if (!channelId) return;
    const ledger = _getAuditLedger();
    try {
      const missions = (missionController as unknown as { list?: () => unknown[] }).list ? (missionController as unknown as { list: () => unknown[] }).list() : [];
      const active   = (missions as Array<{ status?: string }>).filter(m => m.status === 'active').length;
      const pending  = (missions as Array<{ status?: string }>).filter(m => m.status === 'pending').length;
      const summary  = [
        `*TriForge Daily Summary — ${new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'short', day: 'numeric' })}*`,
        `• Active missions: *${active}*`,
        `• Pending missions: *${pending}*`,
        `• Message log entries today: *${_messageLog.list(200).filter(m => Date.now() - m.timestamp < 86_400_000).length}*`,
      ].join('\n');
      const ok = await _slackAdapter.postMessage(channelId, summary);
      if (ok) {
        ledger.log('SLACK_SUMMARY_SENT', { metadata: { channelId } });
        _messageLog.push({ direction: 'outbound', channel: 'slack', chatId: 0, channelId, chatName: `#${channelId}`, text: summary, status: 'replied' });
      }
    } catch (err) {
      console.error('[Slack] Failed to send summary:', err);
    }
  }

  // Internal: restart summary scheduler based on current store config
  function _resetSlackSummarySchedule(): void {
    if (_slackSummaryTimer) { clearInterval(_slackSummaryTimer); _slackSummaryTimer = null; }
    const schedule = store.getSlackSummarySchedule();
    if (schedule === 'disabled') return;
    const ms = schedule === 'daily' ? 86_400_000 : 7 * 86_400_000;
    _slackSummaryTimer = setInterval(() => { void _sendSlackSummary(); }, ms);
  }

  // Phase 28 — resolve Slack token via workspace credential resolver
  async function _getSlackToken(): Promise<{ token: string; scopeUsed: 'workspace' | 'personal' } | null> {
    const result = await _getWsCredResolver().resolve('slack');
    if (result.scopeUsed === 'none' || !result.token) return null;
    if (result.scopeUsed === 'workspace') {
      _getAuditLedger().log('WS_INTEGRATION_USED', {
        metadata: { integration: 'slack', scope: 'workspace', fallbackUsed: result.fallbackUsed, workspaceId: store.getWorkspace()?.id },
      });
    }
    return { token: result.token, scopeUsed: result.scopeUsed };
  }

  // slack:setToken — save bot token
  ipcMain.handle('slack:setToken', async (_e, token: string) => {
    const creds = new CredentialManager(store);
    await creds.set('slack_bot_token', token.trim());
    return { ok: true };
  });

  // slack:testConnection — validate token, return workspace info
  ipcMain.handle('slack:testConnection', async () => {
    const creds = new CredentialManager(store);
    const token = await creds.get('slack_bot_token');
    if (!token) return { ok: false, error: 'No bot token saved' };
    try {
      const adapter = new SlackAdapter(token);
      const info    = await adapter.authTest();
      store.setSlackWorkspaceName(info.workspaceName);
      store.setSlackBotUserId(info.botUserId);
      store.setSlackBotUserName(info.botUserName);
      return { ok: true, botUserId: info.botUserId, botUserName: info.botUserName, workspaceName: info.workspaceName, workspaceId: info.workspaceId };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // slack:start — begin polling
  ipcMain.handle('slack:start', async () => {
    if (_slackAdapter?.isRunning()) return { ok: true, already: true };
    const slackCred = await _getSlackToken();
    if (!slackCred) return { ok: false, error: 'No bot token configured' };
    const token = slackCred.token;
    try {
      const adapter  = new SlackAdapter(token);
      const info     = await adapter.authTest();
      store.setSlackWorkspaceName(info.workspaceName);
      store.setSlackBotUserId(info.botUserId);
      store.setSlackBotUserName(info.botUserName);
      store.setSlackEnabled(true);
      _slackAdapter  = adapter;
      const channels = store.getSlackAllowedChannels();
      _slackAdapter.start(channels, (msg) => { void _handleSlackMessage(msg); });
      _resetSlackSummarySchedule();
      _getAuditLedger().log('SLACK_BOT_STARTED', { metadata: { workspace: info.workspaceName, botUser: info.botUserName } });
      return { ok: true, workspaceName: info.workspaceName, botUserName: info.botUserName };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // slack:stop
  ipcMain.handle('slack:stop', () => {
    _slackAdapter?.stop();
    _slackAdapter = null;
    if (_slackSummaryTimer) { clearInterval(_slackSummaryTimer); _slackSummaryTimer = null; }
    store.setSlackEnabled(false);
    _getAuditLedger().log('SLACK_BOT_STOPPED', {});
    return { ok: true };
  });

  // slack:status
  ipcMain.handle('slack:status', () => {
    return {
      enabled:          store.getSlackEnabled(),
      running:          _slackAdapter?.isRunning() ?? false,
      workspaceName:    store.getSlackWorkspaceName(),
      botUserName:      store.getSlackBotUserName(),
      allowedChannels:  store.getSlackAllowedChannels(),
      allowedUsers:     store.getSlackAllowedUsers(),
      summaryChannel:   store.getSlackSummaryChannel(),
      summarySchedule:  store.getSlackSummarySchedule(),
      lastMessageAt:    store.getSlackLastMessageAt(),
    };
  });

  // slack:listChannels — enumerate channels the bot can see
  ipcMain.handle('slack:listChannels', async () => {
    const creds = new CredentialManager(store);
    const token = await creds.get('slack_bot_token');
    if (!token) return { ok: false, channels: [], error: 'No token' };
    try {
      const adapter  = _slackAdapter ?? new SlackAdapter(token);
      const channels = await adapter.listChannels();
      return { ok: true, channels };
    } catch (err) {
      return { ok: false, channels: [], error: err instanceof Error ? err.message : String(err) };
    }
  });

  // slack:addAllowedChannel
  ipcMain.handle('slack:addAllowedChannel', (_e, channelId: string) => {
    const current = store.getSlackAllowedChannels();
    if (!current.includes(channelId)) {
      const updated = [...current, channelId];
      store.setSlackAllowedChannels(updated);
      _slackAdapter?.setChannels(updated);
    }
    return { ok: true, allowedChannels: store.getSlackAllowedChannels() };
  });

  // slack:removeAllowedChannel
  ipcMain.handle('slack:removeAllowedChannel', (_e, channelId: string) => {
    const updated = store.getSlackAllowedChannels().filter(id => id !== channelId);
    store.setSlackAllowedChannels(updated);
    _slackAdapter?.setChannels(updated);
    return { ok: true, allowedChannels: store.getSlackAllowedChannels() };
  });

  // slack:addAllowedUser
  ipcMain.handle('slack:addAllowedUser', (_e, userId: string) => {
    const current = store.getSlackAllowedUsers();
    if (!current.includes(userId)) store.setSlackAllowedUsers([...current, userId]);
    return { ok: true, allowedUsers: store.getSlackAllowedUsers() };
  });

  // slack:removeAllowedUser
  ipcMain.handle('slack:removeAllowedUser', (_e, userId: string) => {
    store.setSlackAllowedUsers(store.getSlackAllowedUsers().filter(id => id !== userId));
    return { ok: true, allowedUsers: store.getSlackAllowedUsers() };
  });

  // slack:sendMessage — manual test send
  ipcMain.handle('slack:sendMessage', async (_e, channelId: string, text: string) => {
    if (!_slackAdapter?.isRunning()) return { ok: false, error: 'Slack bot not running' };
    const ok = await _slackAdapter.postMessage(channelId, text.slice(0, 3000));
    if (ok) {
      _messageLog.push({ direction: 'outbound', channel: 'slack', chatId: 0, channelId, text: text.slice(0, 500), status: 'replied' });
      _getAuditLedger().log('SLACK_REPLY_SENT', { metadata: { channelId, manual: true } });
    }
    return { ok };
  });

  // slack:listMessages — recent message log (Slack-only)
  ipcMain.handle('slack:listMessages', (_e, limit = 50) => {
    return { messages: _messageLog.list(limit).filter(m => m.channel === 'slack') };
  });

  // slack:setSummaryChannel
  ipcMain.handle('slack:setSummaryChannel', (_e, channelId: string) => {
    store.setSlackSummaryChannel(channelId);
    _resetSlackSummarySchedule();
    return { ok: true };
  });

  // slack:setSummarySchedule
  ipcMain.handle('slack:setSummarySchedule', (_e, schedule: 'disabled' | 'daily' | 'weekly') => {
    store.setSlackSummarySchedule(schedule);
    _resetSlackSummarySchedule();
    return { ok: true };
  });

  // slack:sendSummaryNow — trigger an immediate summary
  ipcMain.handle('slack:sendSummaryNow', async () => {
    await _sendSlackSummary();
    return { ok: true };
  });

  // ── Phase 9: Jira IPC handlers ────────────────────────────────────────────────

  // Internal: build a JiraAdapter from stored credentials
  async function _buildJiraAdapter(): Promise<JiraAdapter | null> {
    const result = await _getWsCredResolver().resolve('jira');
    if (result.scopeUsed === 'none' || !result.token || !result.url || !result.email) return null;
    if (result.scopeUsed === 'workspace') {
      _getAuditLedger().log('WS_INTEGRATION_USED', {
        metadata: { integration: 'jira', scope: 'workspace', fallbackUsed: result.fallbackUsed, workspaceId: store.getWorkspace()?.id },
      });
    }
    return new JiraAdapter(result.url, result.email, result.token);
  }

  // jira:setCredentials — persist workspace URL, email, and API token
  ipcMain.handle('jira:setCredentials', async (_e, workspaceUrl: string, email: string, apiToken: string) => {
    store.setJiraWorkspaceUrl(workspaceUrl.trim());
    store.setJiraEmail(email.trim());
    const creds = new CredentialManager(store);
    await creds.set('jira_api_token', apiToken.trim());
    return { ok: true };
  });

  // jira:testConnection — validate credentials and return user info
  ipcMain.handle('jira:testConnection', async () => {
    const adapter = await _buildJiraAdapter();
    if (!adapter) return { ok: false, error: 'Credentials not configured' };
    try {
      const user = await adapter.getMyself();
      store.setJiraUserDisplayName(user.displayName);
      store.setJiraEnabled(true);
      _getAuditLedger().log('JIRA_CONNECTED', { metadata: { displayName: user.displayName, email: user.emailAddress } });
      return { ok: true, displayName: user.displayName, emailAddress: user.emailAddress, accountId: user.accountId };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // jira:status — current connection state
  ipcMain.handle('jira:status', () => {
    return {
      enabled:        store.getJiraEnabled(),
      workspaceUrl:   store.getJiraWorkspaceUrl(),
      email:          store.getJiraEmail(),
      displayName:    store.getJiraUserDisplayName(),
      allowedProjects:store.getJiraAllowedProjects(),
      summarySlackChannel: store.getJiraSummarySlackChannel(),
    };
  });

  // jira:listProjects — fetch projects visible to the bot
  ipcMain.handle('jira:listProjects', async () => {
    const adapter = await _buildJiraAdapter();
    if (!adapter) return { ok: false, projects: [], error: 'Not configured' };
    try {
      const projects = await adapter.listProjects(100);
      _getAuditLedger().log('JIRA_ISSUE_READ', { metadata: { action: 'listProjects', count: projects.length } });
      return { ok: true, projects };
    } catch (err) {
      return { ok: false, projects: [], error: err instanceof Error ? err.message : String(err) };
    }
  });

  // jira:searchIssues — JQL search
  ipcMain.handle('jira:searchIssues', async (_e, jql: string, maxResults = 30) => {
    const adapter = await _buildJiraAdapter();
    if (!adapter) return { ok: false, issues: [], error: 'Not configured' };
    const safe = jql.slice(0, 1000);
    try {
      const issues = await adapter.searchIssues(safe, maxResults);
      _getAuditLedger().log('JIRA_ISSUE_READ', { metadata: { action: 'searchIssues', jql: safe, count: issues.length } });
      return { ok: true, issues };
    } catch (err) {
      return { ok: false, issues: [], error: err instanceof Error ? err.message : String(err) };
    }
  });

  // jira:getIssue — full issue details + comments + transitions
  ipcMain.handle('jira:getIssue', async (_e, issueKey: string) => {
    const adapter = await _buildJiraAdapter();
    if (!adapter) return { ok: false, error: 'Not configured' };
    try {
      const [issue, comments, transitions] = await Promise.all([
        adapter.getIssue(issueKey),
        adapter.getComments(issueKey, 5),
        adapter.listTransitions(issueKey),
      ]);
      _getAuditLedger().log('JIRA_ISSUE_READ', { metadata: { action: 'getIssue', issueKey } });
      return { ok: true, issue, comments, transitions };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // jira:queueComment — enqueue a comment for approval
  ipcMain.handle('jira:queueComment', (_e, issueKey: string, body: string) => {
    const { blocked, requiresApproval } = _classifyInboundTask(
      `Comment on ${issueKey}: ${body.slice(0, 100)}`,
      'jira' as InboundTaskSource,
    );
    if (blocked) return { ok: false, error: 'Blocked by policy' };
    const action = _getJiraQueue().enqueue({
      type: 'comment', issueKey,
      summary: `Comment on ${issueKey}`,
      body: body.slice(0, 4000),
    });
    _getAuditLedger().log('JIRA_ACTION_QUEUED', { metadata: { type: 'comment', issueKey, actionId: action.id, requiresApproval } });
    void _pushNotifier.fire('jira_action_queued', 'Jira Action Queued', `Comment on ${issueKey} needs approval`);
    return { ok: true, actionId: action.id, requiresApproval };
  });

  // jira:queueCreate — enqueue issue creation for approval
  ipcMain.handle('jira:queueCreate', (_e, projectKey: string, issueTypeId: string, summary: string, description?: string) => {
    const { blocked } = _classifyInboundTask(`Create issue in ${projectKey}: ${summary}`, 'jira' as InboundTaskSource);
    if (blocked) return { ok: false, error: 'Blocked by policy' };
    const action = _getJiraQueue().enqueue({
      type: 'create', projectKey, issueTypeId,
      summary: `Create [${projectKey}] ${summary.slice(0, 80)}`,
      body: description ?? '',
    });
    _getAuditLedger().log('JIRA_ACTION_QUEUED', { metadata: { type: 'create', projectKey, summary: summary.slice(0, 80), actionId: action.id } });
    void _pushNotifier.fire('jira_action_queued', 'Jira Action Queued', `Create issue in ${projectKey}: ${summary.slice(0, 60)} needs approval`);
    return { ok: true, actionId: action.id };
  });

  // jira:queueTransition — enqueue a status transition for approval
  ipcMain.handle('jira:queueTransition', (_e, issueKey: string, transitionId: string, toStatus: string) => {
    const { blocked } = _classifyInboundTask(`Transition ${issueKey} → ${toStatus}`, 'jira' as InboundTaskSource);
    if (blocked) return { ok: false, error: 'Blocked by policy' };
    const action = _getJiraQueue().enqueue({
      type: 'transition', issueKey, transitionId, toStatus,
      summary: `Transition ${issueKey} → ${toStatus}`,
      body: '',
    });
    _getAuditLedger().log('JIRA_ACTION_QUEUED', { metadata: { type: 'transition', issueKey, toStatus, actionId: action.id } });
    void _pushNotifier.fire('jira_action_queued', 'Jira Action Queued', `Transition ${issueKey} → ${toStatus} needs approval`);
    return { ok: true, actionId: action.id };
  });

  // jira:approveAction — execute an approved action against the Jira API
  ipcMain.handle('jira:approveAction', async (_e, actionId: string) => {
    const queue   = _getJiraQueue();
    const action  = queue.approve(actionId);
    if (!action) return { ok: false, error: 'Action not found or already processed' };
    const adapter = await _buildJiraAdapter();
    if (!adapter) return { ok: false, error: 'Jira not configured' };
    const ledger  = _getAuditLedger();
    try {
      if (action.type === 'comment' && action.issueKey) {
        await adapter.addComment(action.issueKey, action.body);
        ledger.log('JIRA_COMMENT_POSTED', { metadata: { issueKey: action.issueKey, actionId } });
      } else if (action.type === 'create' && action.projectKey && action.issueTypeId) {
        const r = await adapter.createIssue(action.projectKey, action.issueTypeId, action.summary, action.body || undefined);
        ledger.log('JIRA_ISSUE_CREATED', { metadata: { key: r.key, projectKey: action.projectKey, actionId } });
      } else if (action.type === 'transition' && action.issueKey && action.transitionId) {
        await adapter.doTransition(action.issueKey, action.transitionId);
        ledger.log('JIRA_STATUS_TRANSITIONED', { metadata: { issueKey: action.issueKey, toStatus: action.toStatus, actionId } });
      }
      ledger.log('JIRA_ACTION_APPROVED', { metadata: { type: action.type, actionId } });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // jira:dismissAction
  ipcMain.handle('jira:dismissAction', (_e, actionId: string) => {
    const ok = _getJiraQueue().dismiss(actionId);
    if (ok) _getAuditLedger().log('JIRA_ACTION_DISMISSED', { metadata: { actionId } });
    return { ok };
  });

  // jira:listQueue — list queued actions
  ipcMain.handle('jira:listQueue', (_e, includeProcessed = false) => {
    return { actions: _getJiraQueue().list(includeProcessed) };
  });

  // jira:triageIssue — create a task to let TriForge analyse the issue
  ipcMain.handle('jira:triageIssue', async (_e, issueKey: string) => {
    const adapter = await _buildJiraAdapter();
    if (!adapter) return { ok: false, error: 'Not configured' };
    try {
      const issue = await adapter.getIssue(issueKey);
      // Phase 16: inject project context from shared memory
      const _jiraCtx = resolveProject(store.getSharedContext(), issue.projectKey ?? '');
      const prompt = [
        `Triage Jira issue ${issue.key} from project ${issue.projectName}.`,
        `Type: ${issue.issueType} | Priority: ${issue.priority} | Status: ${issue.status}`,
        `Summary: ${issue.summary}`,
        issue.description ? `Description: ${issue.description.slice(0, 600)}` : '',
        issue.assigneeName ? `Assignee: ${issue.assigneeName}` : 'Unassigned.',
        _jiraCtx?.automationContext ? `\nProject Context: ${_jiraCtx.automationContext.slice(0, 400)}` : '',
        `\nProvide: (1) Risk/impact assessment, (2) Recommended next action, (3) Suggested comment draft if appropriate.`,
      ].filter(Boolean).join('\n');
      const task = _getAgentLoop(store).createTask(prompt, 'research');
      _getAuditLedger().log('JIRA_TRIAGE_STARTED', { taskId: task.id, metadata: { issueKey } });
      return { ok: true, taskId: task.id };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // jira:setSummarySlackChannel
  ipcMain.handle('jira:setSummarySlackChannel', (_e, channelId: string) => {
    store.setJiraSummarySlackChannel(channelId);
    return { ok: true };
  });

  // jira:sendSummaryNow — post issue summary to the configured Slack channel
  ipcMain.handle('jira:sendSummaryNow', async (_e, jql?: string) => {
    const channelId = store.getJiraSummarySlackChannel();
    if (!channelId) return { ok: false, error: 'No Slack summary channel configured' };
    if (!_slackAdapter?.isRunning()) return { ok: false, error: 'Slack bot not running' };
    const adapter = await _buildJiraAdapter();
    if (!adapter) return { ok: false, error: 'Jira not configured' };
    try {
      const searchJql = jql ?? 'assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC';
      const issues    = await adapter.searchIssues(searchJql, 10);
      const lines     = issues.map(i => `• *${i.key}* — ${i.summary.slice(0, 80)} _(${i.status})_`);
      const text      = [
        `*Jira Issue Summary — ${new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}*`,
        lines.length ? lines.join('\n') : '_No open issues found._',
      ].join('\n');
      const ok = await _slackAdapter.postMessage(channelId, text);
      if (ok) _getAuditLedger().log('JIRA_SUMMARY_SENT', { metadata: { channelId, issueCount: issues.length } });
      return { ok };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // jira:setAllowedProjects
  ipcMain.handle('jira:setAllowedProjects', (_e, projectKeys: string[]) => {
    store.setJiraAllowedProjects(projectKeys);
    return { ok: true };
  });

  // ── Phase 10: Push Notification IPC handlers ──────────────────────────────────

  // push:configure — save provider config and refresh the notifier
  ipcMain.handle('push:configure', async (_e, config: {
    provider:      'ntfy' | 'pushover' | 'disabled';
    ntfyTopic?:    string;
    ntfyServer?:   string;
    ntfyToken?:    string;
    pushoverApp?:  string;
    pushoverUser?: string;
  }) => {
    store.setPushProvider(config.provider);
    if (config.ntfyTopic    !== undefined) store.setPushNtfyTopic(config.ntfyTopic);
    if (config.ntfyServer   !== undefined) store.setPushNtfyServer(config.ntfyServer);
    if (config.pushoverUser !== undefined) store.setPushoverUserKey(config.pushoverUser);
    const creds = new CredentialManager(store);
    if (config.ntfyToken   !== undefined) await creds.set('ntfy_token',          config.ntfyToken);
    if (config.pushoverApp !== undefined) await creds.set('pushover_app_token',   config.pushoverApp);
    await _refreshPushConfig();
    return { ok: true };
  });

  // push:status — return non-secret config + provider state
  ipcMain.handle('push:status', () => {
    return {
      ...(_pushNotifier.getConfig()),
      eventSettings: _pushNotifier.getEventSettings(),
    };
  });

  // push:setEventSetting — toggle or reprioritise a single event
  ipcMain.handle('push:setEventSetting', (_e, event: string, enabled: boolean, priority: string) => {
    const setting = { enabled, priority: priority as NotifyPriority };
    _pushNotifier.setEventSetting(event as NotifyEvent, setting);
    // Persist
    const all = _pushNotifier.getEventSettings() as Record<string, { enabled: boolean; priority: string }>;
    store.setPushEventSettings(all);
    return { ok: true };
  });

  // push:getEventSettings — all event definitions + current settings
  ipcMain.handle('push:getEventSettings', () => {
    const settings = _pushNotifier.getEventSettings();
    return {
      events: ALL_NOTIFY_EVENTS.map(key => ({
        key,
        label:       EVENT_LABELS[key].label,
        description: EVENT_LABELS[key].description,
        enabled:     settings[key]?.enabled ?? DEFAULT_EVENT_SETTINGS[key].enabled,
        priority:    settings[key]?.priority ?? DEFAULT_EVENT_SETTINGS[key].priority,
      })),
    };
  });

  // push:sendTest — fire a test notification
  ipcMain.handle('push:sendTest', async () => {
    // Temporarily enable to ensure test always goes through
    const prev = _pushNotifier.getEventSettings()['agent_unhealthy'];
    _pushNotifier.setEventSetting('agent_unhealthy', { enabled: true, priority: prev?.priority ?? 'normal' });
    const ok = await _pushNotifier.fire('agent_unhealthy', 'TriForge Test Notification', 'Push notifications are working.');
    // Restore
    if (prev) _pushNotifier.setEventSetting('agent_unhealthy', prev);
    const ledger = _getAuditLedger();
    if (ok) ledger.log('PUSH_SENT', { metadata: { event: 'test' } });
    else    ledger.log('PUSH_FAILED', { metadata: { event: 'test' } });
    return { ok, error: ok ? undefined : 'Notification failed — check provider config' };
  });

  // push:getLog — recent push notification log
  ipcMain.handle('push:getLog', (_e, limit = 50) => {
    return { entries: _pushNotifier.getLog(limit) };
  });

  // ── Phase 11: Linear IPC handlers ──────────────────────────────────────────

  async function _buildLinearAdapter(): Promise<LinearAdapter | null> {
    const result = await _getWsCredResolver().resolve('linear');
    if (result.scopeUsed === 'none' || !result.token) return null;
    if (result.scopeUsed === 'workspace') {
      _getAuditLedger().log('WS_INTEGRATION_USED', {
        metadata: { integration: 'linear', scope: 'workspace', fallbackUsed: result.fallbackUsed, workspaceId: store.getWorkspace()?.id },
      });
    }
    return new LinearAdapter(result.token);
  }

  // linear:setApiKey — persist the Personal API key
  ipcMain.handle('linear:setApiKey', async (_e, apiKey: string) => {
    const creds = new CredentialManager(store);
    await creds.set('linear_api_key', apiKey.trim());
    return { ok: true };
  });

  // linear:testConnection — validate the key and return viewer info
  ipcMain.handle('linear:testConnection', async () => {
    const adapter = await _buildLinearAdapter();
    if (!adapter) return { ok: false, error: 'API key not configured' };
    try {
      const user = await adapter.getViewer();
      store.setLinearUserName(user.name);
      store.setLinearEnabled(true);
      _getAuditLedger().log('LINEAR_CONNECTED', { metadata: { name: user.name, email: user.email } });
      return { ok: true, name: user.name, email: user.email, id: user.id };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // linear:status — return current connection state
  ipcMain.handle('linear:status', () => ({
    enabled:             store.getLinearEnabled(),
    userName:            store.getLinearUserName(),
    workspaceName:       store.getLinearWorkspaceName(),
    allowedTeams:        store.getLinearAllowedTeams(),
    summarySlackChannel: store.getLinearSummarySlackChannel(),
  }));

  // linear:listTeams — fetch teams visible to the API key holder
  ipcMain.handle('linear:listTeams', async () => {
    const adapter = await _buildLinearAdapter();
    if (!adapter) return { ok: false, teams: [], error: 'Not configured' };
    try {
      const teams = await adapter.listTeams();
      return { ok: true, teams };
    } catch (err) {
      return { ok: false, teams: [], error: err instanceof Error ? err.message : String(err) };
    }
  });

  // linear:searchIssues — full-text search, optional team filter
  ipcMain.handle('linear:searchIssues', async (_e, query: string, teamId?: string, limit = 25) => {
    const adapter = await _buildLinearAdapter();
    if (!adapter) return { ok: false, issues: [], error: 'Not configured' };
    const safeQ = query.slice(0, 500);
    try {
      const issues = await adapter.searchIssues(safeQ, teamId, limit);
      _getAuditLedger().log('LINEAR_ISSUE_SEARCHED', { metadata: { query: safeQ, teamId, count: issues.length } });
      return { ok: true, issues };
    } catch (err) {
      return { ok: false, issues: [], error: err instanceof Error ? err.message : String(err) };
    }
  });

  // linear:getIssue — full issue detail + comments + workflow states
  ipcMain.handle('linear:getIssue', async (_e, id: string) => {
    const adapter = await _buildLinearAdapter();
    if (!adapter) return { ok: false, error: 'Not configured' };
    try {
      const [issue, comments] = await Promise.all([
        adapter.getIssue(id),
        adapter.getComments(id, 5),
      ]);
      const states = await adapter.listWorkflowStates(issue.teamId);
      _getAuditLedger().log('LINEAR_ISSUE_READ', { metadata: { identifier: issue.identifier } });
      return { ok: true, issue, comments, states };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // linear:listWorkflowStates — states for a given team
  ipcMain.handle('linear:listWorkflowStates', async (_e, teamId: string) => {
    const adapter = await _buildLinearAdapter();
    if (!adapter) return { ok: false, states: [], error: 'Not configured' };
    try {
      const states = await adapter.listWorkflowStates(teamId);
      return { ok: true, states };
    } catch (err) {
      return { ok: false, states: [], error: err instanceof Error ? err.message : String(err) };
    }
  });

  // linear:queueComment — enqueue a comment for approval
  ipcMain.handle('linear:queueComment', (_e, issueId: string, identifier: string, body: string) => {
    const { blocked, requiresApproval } = _classifyInboundTask(
      `Comment on ${identifier}: ${body.slice(0, 100)}`,
      'linear' as InboundTaskSource,
    );
    if (blocked) return { ok: false, error: 'Blocked by policy' };
    const action = _getLinearQueue().enqueue({
      type: 'comment', issueId,
      summary: `Comment on ${identifier}`,
      body: body.slice(0, 4000),
    });
    _getAuditLedger().log('LINEAR_ACTION_QUEUED', { metadata: { type: 'comment', identifier, actionId: action.id, requiresApproval } });
    void _pushNotifier.fire('jira_action_queued', 'Linear Action Queued', `Comment on ${identifier} needs approval`);
    return { ok: true, actionId: action.id, requiresApproval };
  });

  // linear:queueCreate — enqueue issue creation for approval
  ipcMain.handle('linear:queueCreate', (_e, teamId: string, teamKey: string, title: string, description?: string, stateId?: string, assigneeId?: string, priority?: number) => {
    const { blocked } = _classifyInboundTask(`Create issue in [${teamKey}]: ${title}`, 'linear' as InboundTaskSource);
    if (blocked) return { ok: false, error: 'Blocked by policy' };
    const action = _getLinearQueue().enqueue({
      type: 'create', teamId,
      summary: `Create [${teamKey}] ${title.slice(0, 80)}`,
      body: description ?? '',
      stateId, assigneeId, priority,
    });
    _getAuditLedger().log('LINEAR_ACTION_QUEUED', { metadata: { type: 'create', teamKey, title: title.slice(0, 80), actionId: action.id } });
    void _pushNotifier.fire('jira_action_queued', 'Linear Action Queued', `Create issue [${teamKey}]: ${title.slice(0, 60)} needs approval`);
    return { ok: true, actionId: action.id };
  });

  // linear:queueUpdate — enqueue a status/assignee/priority update for approval
  ipcMain.handle('linear:queueUpdate', (_e, issueId: string, identifier: string, patch: { stateId?: string; stateName?: string; assigneeId?: string; priority?: number; title?: string }) => {
    const desc = patch.stateName ? `→ ${patch.stateName}` : patch.title ? `rename: ${patch.title.slice(0, 40)}` : 'update fields';
    const { blocked } = _classifyInboundTask(`Update ${identifier}: ${desc}`, 'linear' as InboundTaskSource);
    if (blocked) return { ok: false, error: 'Blocked by policy' };
    const action = _getLinearQueue().enqueue({
      type: 'update', issueId,
      summary: `Update ${identifier}: ${desc}`,
      body: JSON.stringify(patch),
      stateId:    patch.stateId,
      assigneeId: patch.assigneeId,
      priority:   patch.priority,
    });
    _getAuditLedger().log('LINEAR_ACTION_QUEUED', { metadata: { type: 'update', identifier, desc, actionId: action.id } });
    void _pushNotifier.fire('jira_action_queued', 'Linear Action Queued', `Update ${identifier}: ${desc} needs approval`);
    return { ok: true, actionId: action.id };
  });

  // linear:approveAction — execute the staged action against the Linear API
  ipcMain.handle('linear:approveAction', async (_e, actionId: string) => {
    const queue   = _getLinearQueue();
    const action  = queue.approve(actionId);
    if (!action) return { ok: false, error: 'Action not found or already processed' };
    const adapter = await _buildLinearAdapter();
    if (!adapter) return { ok: false, error: 'Linear not configured' };
    const ledger  = _getAuditLedger();
    try {
      if (action.type === 'comment' && action.issueId) {
        await adapter.createComment(action.issueId, action.body);
        ledger.log('LINEAR_COMMENT_POSTED', { metadata: { issueId: action.issueId, actionId } });
      } else if (action.type === 'create' && action.teamId) {
        const r = await adapter.createIssue({
          teamId:      action.teamId,
          title:       action.summary.replace(/^Create \[.*?\] /, ''),
          description: action.body || undefined,
          stateId:     action.stateId,
          assigneeId:  action.assigneeId,
          priority:    action.priority,
        });
        ledger.log('LINEAR_ISSUE_CREATED', { metadata: { identifier: r.identifier, teamId: action.teamId, actionId } });
      } else if (action.type === 'update' && action.issueId) {
        const patch = JSON.parse(action.body) as { stateId?: string; assigneeId?: string; priority?: number; title?: string };
        const r     = await adapter.updateIssue(action.issueId, patch);
        ledger.log('LINEAR_STATUS_UPDATED', { metadata: { identifier: r.identifier, stateName: r.stateName, actionId } });
      }
      ledger.log('LINEAR_ACTION_APPROVED', { metadata: { type: action.type, actionId } });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // linear:dismissAction
  ipcMain.handle('linear:dismissAction', (_e, actionId: string) => {
    const ok = _getLinearQueue().dismiss(actionId);
    if (ok) _getAuditLedger().log('LINEAR_ACTION_DISMISSED', { metadata: { actionId } });
    return { ok };
  });

  // linear:listQueue
  ipcMain.handle('linear:listQueue', (_e, includeProcessed = false) => {
    return { actions: _getLinearQueue().list(includeProcessed) };
  });

  // linear:triageIssue — create a TriForge research task for this issue
  ipcMain.handle('linear:triageIssue', async (_e, issueId: string) => {
    const adapter = await _buildLinearAdapter();
    if (!adapter) return { ok: false, error: 'Not configured' };
    try {
      const issue  = await adapter.getIssue(issueId);
      // Phase 16: inject project context from shared memory (by Linear team ID)
      const _linearCtx = resolveProject(store.getSharedContext(), issue.teamId ?? '');
      const prompt = [
        `Triage Linear issue ${issue.identifier} from team ${issue.teamName}.`,
        `Priority: ${issue.priorityLabel} | Status: ${issue.stateName}`,
        `Title: ${issue.title}`,
        issue.description ? `Description: ${issue.description.slice(0, 600)}` : '',
        issue.assigneeName ? `Assignee: ${issue.assigneeName}` : 'Unassigned.',
        _linearCtx?.automationContext ? `\nProject Context: ${_linearCtx.automationContext.slice(0, 400)}` : '',
        `\nProvide: (1) Risk/impact assessment, (2) Recommended next action, (3) Suggested comment draft if appropriate.`,
      ].filter(Boolean).join('\n');
      const task = _getAgentLoop(store).createTask(prompt, 'research');
      _getAuditLedger().log('LINEAR_TRIAGE_STARTED', { taskId: task.id, metadata: { identifier: issue.identifier } });
      return { ok: true, taskId: task.id };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // linear:setAllowedTeams — restrict which teams are browsable
  ipcMain.handle('linear:setAllowedTeams', (_e, teamIds: string[]) => {
    store.setLinearAllowedTeams(teamIds);
    return { ok: true };
  });

  // linear:setSummarySlackChannel
  ipcMain.handle('linear:setSummarySlackChannel', (_e, channelId: string) => {
    store.setLinearSummarySlackChannel(channelId);
    return { ok: true };
  });

  // linear:sendSummaryNow — post a Linear issue digest to Slack
  ipcMain.handle('linear:sendSummaryNow', async (_e, query?: string, teamId?: string) => {
    const channelId = store.getLinearSummarySlackChannel();
    if (!channelId) return { ok: false, error: 'No Slack summary channel configured' };
    if (!_slackAdapter?.isRunning()) return { ok: false, error: 'Slack bot not running' };
    const adapter = await _buildLinearAdapter();
    if (!adapter) return { ok: false, error: 'Linear not configured' };
    try {
      const issues = await adapter.searchIssues(query ?? '', teamId, 10);
      const lines  = issues.map(i => `• *${i.identifier}* — ${i.title.slice(0, 80)} _(${i.stateName})_`);
      const text   = [
        `*Linear Issue Summary — ${new Date().toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' })}*`,
        lines.length ? lines.join('\n') : '_No issues found._',
      ].join('\n');
      const ok = await _slackAdapter.postMessage(channelId, text);
      if (ok) _getAuditLedger().log('LINEAR_SUMMARY_SENT', { metadata: { channelId, issueCount: issues.length } });
      return { ok };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // ── Phase 12: Discord IPC handlers ─────────────────────────────────────────

  /** Inbound Discord message handler — mirrors _handleSlackMessage exactly. */
  async function _handleDiscordMessage(msg: DiscordMessage): Promise<void> {
    const text      = msg.content ?? '';
    const channelId = msg.channelId;
    const ledger    = _getAuditLedger();

    const logEntry = _messageLog.push({
      direction: 'inbound',
      channel:   'discord',
      chatId:    0,
      channelId,
      chatName:  `#${channelId}`,
      text:      text.slice(0, 500),
      status:    'received',
    });

    store.setDiscordLastMessageAt(Date.now());
    ledger.log('DISCORD_MESSAGE_RECEIVED', { metadata: { channelId, userId: msg.authorId, textLen: text.length } });

    // ── 1. Allowlist checks ───────────────────────────────────────────────────
    const allowedChannels = store.getDiscordAllowedChannels();
    if (allowedChannels.length > 0 && !allowedChannels.includes(channelId)) {
      _messageLog.update(logEntry.id, { status: 'blocked', blockedReason: 'Channel not in allowlist' });
      ledger.log('DISCORD_MESSAGE_BLOCKED', { metadata: { channelId, reason: 'not_in_allowlist' } });
      return;
    }

    const allowedUsers = store.getDiscordAllowedUsers();
    if (allowedUsers.length > 0 && !allowedUsers.includes(msg.authorId)) {
      _messageLog.update(logEntry.id, { status: 'blocked', blockedReason: 'User not in allowlist' });
      ledger.log('DISCORD_MESSAGE_BLOCKED', { metadata: { channelId, userId: msg.authorId, reason: 'user_not_in_allowlist' } });
      return;
    }

    // ── 2. Prompt injection detection ─────────────────────────────────────────
    if (_detectPromptInjection(text)) {
      _messageLog.update(logEntry.id, { status: 'blocked', blockedReason: 'Prompt injection detected' });
      ledger.log('DISCORD_MESSAGE_BLOCKED', { metadata: { channelId, reason: 'prompt_injection' } });
      if (_discordAdapter) {
        await _discordAdapter.sendMessage(channelId, 'This request cannot be processed.');
      }
      return;
    }

    // ── 3. Risk classification via governance ─────────────────────────────────
    const { blocked, requiresApproval, riskClass } = _classifyInboundTask(text, 'discord' as InboundTaskSource);
    _messageLog.update(logEntry.id, { status: 'classified', riskClass } as never);

    if (blocked) {
      _messageLog.update(logEntry.id, { status: 'blocked', blockedReason: 'Blocked by policy' });
      ledger.log('DISCORD_MESSAGE_BLOCKED', { metadata: { channelId, riskClass, reason: 'policy_block' } });
      if (riskClass === 'high_risk') void _pushNotifier.fire('high_risk_blocked', 'High-Risk Request Blocked', `Blocked Discord message in ${channelId}: ${text.slice(0, 80)}`);
      if (_discordAdapter) {
        await _discordAdapter.sendMessage(channelId, 'This request cannot be processed via this channel.');
      }
      return;
    }

    if (requiresApproval) {
      _messageLog.update(logEntry.id, { status: 'approval_pending' });
      ledger.log('DISCORD_APPROVAL_PENDING', { metadata: { channelId, riskClass, text: text.slice(0, 200) } });
      _fireEventRecipes('event:approval_required', { label: 'Approval Required — Discord', body: `${riskClass} task in Discord ${channelId}: ${text.slice(0, 80)}` });
      void _pushNotifier.fire('approval_required', 'Approval Required — Discord', `${riskClass} task in Discord ${channelId}: ${text.slice(0, 80)}`);
      if (_discordAdapter) {
        await _discordAdapter.sendMessage(
          channelId,
          `Your request requires approval before I can proceed. Risk class: **${riskClass}**\nA human will review this in TriForge.`,
        );
      }
    }

    // ── 4. Create task ────────────────────────────────────────────────────────
    try {
      const task = _getAgentLoop(store).createTask(text, 'research');
      _messageLog.update(logEntry.id, { status: 'task_created', taskId: task.id });
      ledger.log('DISCORD_TASK_CREATED', { taskId: task.id, metadata: { channelId, riskClass } });

      if (riskClass === 'informational') {
        const unsub = eventBus.onAny((event) => {
          if (event.type === 'TASK_COMPLETED' && (event as Record<string, unknown>).taskId === task.id) {
            unsub();
            const result = (event as Record<string, unknown>).result as string | undefined;
            const reply  = result ? result.slice(0, 2000) : 'Task completed.';
            if (_discordAdapter) {
              _discordAdapter.sendMessage(channelId, reply).then(() => {
                _messageLog.push({ direction: 'outbound', channel: 'discord', chatId: 0, channelId, chatName: `#${channelId}`, text: reply, status: 'replied', taskId: task.id });
                ledger.log('DISCORD_REPLY_SENT', { taskId: task.id, metadata: { channelId } });
              }).catch(() => {/* no-op */});
            }
          }
        });
      }
    } catch (err) {
      console.error('[Discord] Failed to create task:', err);
    }
  }

  // discord:setToken
  ipcMain.handle('discord:setToken', async (_e, token: string) => {
    const creds = new CredentialManager(store);
    await creds.set('discord_bot_token', token.trim());
    return { ok: true };
  });

  // discord:testConnection — validate token and return bot user info
  ipcMain.handle('discord:testConnection', async () => {
    const creds = new CredentialManager(store);
    const token = await creds.get('discord_bot_token');
    if (!token) return { ok: false, error: 'No bot token saved' };
    try {
      const adapter = new DiscordAdapter(token);
      const me      = await adapter.getMe();
      store.setDiscordBotUserId(me.id);
      store.setDiscordBotUserName(me.username);
      return { ok: true, id: me.id, username: me.username, discriminator: me.discriminator };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // discord:start — begin polling
  ipcMain.handle('discord:start', async () => {
    if (_discordAdapter?.isRunning()) return { ok: true, already: true };
    const creds = new CredentialManager(store);
    const token = await creds.get('discord_bot_token');
    if (!token) return { ok: false, error: 'No bot token configured' };
    try {
      const adapter = new DiscordAdapter(token);
      const me      = await adapter.getMe();
      store.setDiscordBotUserId(me.id);
      store.setDiscordBotUserName(me.username);
      store.setDiscordEnabled(true);
      adapter.setBotId(me.id);
      _discordAdapter = adapter;
      const channels  = store.getDiscordAllowedChannels();
      _discordAdapter.start(channels, (msg) => { void _handleDiscordMessage(msg); });
      _getAuditLedger().log('DISCORD_BOT_STARTED', { metadata: { botUser: me.username } });
      return { ok: true, username: me.username };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // discord:stop
  ipcMain.handle('discord:stop', () => {
    _discordAdapter?.stop();
    _discordAdapter = null;
    store.setDiscordEnabled(false);
    _getAuditLedger().log('DISCORD_BOT_STOPPED', {});
    return { ok: true };
  });

  // discord:status
  ipcMain.handle('discord:status', () => ({
    enabled:         store.getDiscordEnabled(),
    running:         _discordAdapter?.isRunning() ?? false,
    botUserName:     store.getDiscordBotUserName(),
    botUserId:       store.getDiscordBotUserId(),
    allowedChannels: store.getDiscordAllowedChannels(),
    allowedUsers:    store.getDiscordAllowedUsers(),
    lastMessageAt:   store.getDiscordLastMessageAt(),
  }));

  // discord:listGuilds — list servers the bot is in
  ipcMain.handle('discord:listGuilds', async () => {
    const creds = new CredentialManager(store);
    const token = await creds.get('discord_bot_token');
    if (!token) return { ok: false, guilds: [], error: 'No token' };
    try {
      const adapter = _discordAdapter ?? new DiscordAdapter(token);
      const guilds  = await adapter.listGuilds();
      return { ok: true, guilds };
    } catch (err) {
      return { ok: false, guilds: [], error: err instanceof Error ? err.message : String(err) };
    }
  });

  // discord:listChannels — text channels in a guild
  ipcMain.handle('discord:listChannels', async (_e, guildId: string) => {
    const creds = new CredentialManager(store);
    const token = await creds.get('discord_bot_token');
    if (!token) return { ok: false, channels: [], error: 'No token' };
    try {
      const adapter  = _discordAdapter ?? new DiscordAdapter(token);
      const channels = await adapter.listChannels(guildId);
      return { ok: true, channels };
    } catch (err) {
      return { ok: false, channels: [], error: err instanceof Error ? err.message : String(err) };
    }
  });

  // discord:addAllowedChannel
  ipcMain.handle('discord:addAllowedChannel', (_e, channelId: string) => {
    const current = store.getDiscordAllowedChannels();
    if (!current.includes(channelId)) {
      const updated = [...current, channelId];
      store.setDiscordAllowedChannels(updated);
      _discordAdapter?.setChannels(updated);
    }
    return { ok: true, allowedChannels: store.getDiscordAllowedChannels() };
  });

  // discord:removeAllowedChannel
  ipcMain.handle('discord:removeAllowedChannel', (_e, channelId: string) => {
    const updated = store.getDiscordAllowedChannels().filter(id => id !== channelId);
    store.setDiscordAllowedChannels(updated);
    _discordAdapter?.setChannels(updated);
    return { ok: true, allowedChannels: store.getDiscordAllowedChannels() };
  });

  // discord:addAllowedUser
  ipcMain.handle('discord:addAllowedUser', (_e, userId: string) => {
    const current = store.getDiscordAllowedUsers();
    if (!current.includes(userId)) store.setDiscordAllowedUsers([...current, userId]);
    return { ok: true, allowedUsers: store.getDiscordAllowedUsers() };
  });

  // discord:removeAllowedUser
  ipcMain.handle('discord:removeAllowedUser', (_e, userId: string) => {
    store.setDiscordAllowedUsers(store.getDiscordAllowedUsers().filter(id => id !== userId));
    return { ok: true, allowedUsers: store.getDiscordAllowedUsers() };
  });

  // discord:sendMessage — manual test send
  ipcMain.handle('discord:sendMessage', async (_e, channelId: string, text: string) => {
    if (!_discordAdapter?.isRunning()) return { ok: false, error: 'Discord bot not running' };
    try {
      await _discordAdapter.sendMessage(channelId, text.slice(0, 2000));
      _messageLog.push({ direction: 'outbound', channel: 'discord', chatId: 0, channelId, chatName: `#${channelId}`, text: text.slice(0, 500), status: 'replied' });
      return { ok: true };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // discord:listMessages
  ipcMain.handle('discord:listMessages', (_e, limit = 50) => {
    return { messages: _messageLog.list(limit).filter(m => m.channel === 'discord') };
  });

  // ── Phase 13: Automation Recipes ──────────────────────────────────────────────

  function _getRecipeState(id: string): RecipeState {
    const all = store.getRecipeStates();
    return (all[id] ? { id, ...all[id] } : { id, enabled: false, params: {} as Record<string, string> }) as RecipeState;
  }

  function _saveRecipeState(state: RecipeState): void {
    const all = store.getRecipeStates();
    all[state.id] = state;
    store.setRecipeStates(all);
  }

  async function _executeRecipe(
    id: string,
    ctx?: Record<string, string>,
    runCtx?: { deviceId?: string; isAdmin?: boolean; isRemote?: boolean },
  ): Promise<{ ok: boolean; result?: string; error?: string }> {
    const def   = BUILTIN_RECIPES.find(r => r.id === id);
    const state = _getRecipeState(id);
    if (!def) return { ok: false, error: 'Unknown recipe' };

    // ── Phase 30: workspace automation gate ───────────────────────────────────
    const recipeScope = store.getWorkspaceRecipeScopes()[id] ?? 'personal';
    if (recipeScope === 'workspace' && store.getWorkspace()) {
      const gateResult = _getAutomationGate().canRunRecipe(
        runCtx?.deviceId ?? null,
        id,
        runCtx?.isAdmin ?? true,     // local IPC callers are always admin
        runCtx?.isRemote ?? false,
      );
      const wsId = store.getWorkspace()?.id;
      if (!gateResult.allowed) {
        _getAuditLedger().log('WS_RECIPE_BLOCKED', {
          metadata: { recipeId: id, blockedBy: gateResult.blockedBy, reason: gateResult.reason, actorId: runCtx?.deviceId, workspaceId: wsId },
        });
        return { ok: false, error: `Workspace automation policy blocked: ${gateResult.reason}` };
      }
    }
    // ── End gate ──────────────────────────────────────────────────────────────

    const params = { ...state.params, ...(ctx ?? {}) };
    const ledger = _getAuditLedger();
    const workspaceId  = store.getWorkspace()?.id;
    ledger.log('RECIPE_STARTED', { metadata: { id, trigger: def.trigger, scope: recipeScope } });
    if (recipeScope === 'workspace') {
      ledger.log('WS_RECIPE_RUN', { metadata: { recipeId: id, trigger: def.trigger, workspaceId, action: 'run' } });
    }
    eventBus.emit({ type: 'RECIPE_STARTED' as never, recipeId: id } as never);

    try {
      let result = '';

      if (id === 'builtin-pr-review-to-slack') {
        const channel   = params['slack_channel'] ?? '#general';
        const synthesis = ctx?.['synthesis'] ?? '(no synthesis available)';
        const repo      = ctx?.['repo'] ?? 'unknown repo';
        const prNumber  = ctx?.['prNumber'] ?? '?';
        const msg = `*PR #${prNumber} Review — ${repo}*\n${synthesis.slice(0, 2000)}`;
        if (!_slackAdapter) throw new Error('Slack not connected');
        const ok = await _slackAdapter.postMessage(channel, msg);
        if (!ok) throw new Error('Slack postMessage failed');
        result = `Posted PR #${prNumber} review to ${channel}`;

      } else if (id === 'builtin-jira-digest-daily') {
        const channel = params['slack_channel'] ?? '#standup';
        const jql     = params['jql'] ?? 'assignee = currentUser() AND status != Done ORDER BY updated DESC';
        const adapter = await _buildJiraAdapter();
        if (!adapter) throw new Error('Jira not configured');
        const issues = await adapter.searchIssues(jql.slice(0, 500), 10);
        if (!_slackAdapter) throw new Error('Slack not connected');
        if (issues.length === 0) {
          await _slackAdapter.postMessage(channel, '*Jira Daily Digest* — no open issues found.');
        } else {
          const lines = issues.map(i => `• <${(i as unknown as { url?: string }).url ?? ''}|${i.key}> ${i.summary} [${i.status ?? 'unknown'}]`);
          await _slackAdapter.postMessage(channel, `*Jira Daily Digest* (${issues.length} issues)\n${lines.join('\n')}`);
        }
        result = `Posted Jira digest (${issues.length} issues) to ${channel}`;

      } else if (id === 'builtin-linear-digest-daily') {
        const channel = params['slack_channel'] ?? '#standup';
        const query   = params['query'] ?? '';
        const teamId  = params['team_id'] || undefined;
        const adapter = await _buildLinearAdapter();
        if (!adapter) throw new Error('Linear not configured');
        const issues = await adapter.searchIssues(query, teamId, 10);
        if (!_slackAdapter) throw new Error('Slack not connected');
        if (issues.length === 0) {
          await _slackAdapter.postMessage(channel, '*Linear Daily Digest* — no issues found.');
        } else {
          const lines = issues.map(i => `• <${i.url}|${i.identifier}> ${i.title} [${i.stateId ?? 'unknown'}]`);
          await _slackAdapter.postMessage(channel, `*Linear Daily Digest* (${issues.length} issues)\n${lines.join('\n')}`);
        }
        result = `Posted Linear digest (${issues.length} issues) to ${channel}`;

      } else if (id === 'builtin-morning-brief') {
        const channel = params['slack_channel'] ?? '#morning-brief';
        if (!_slackAdapter) throw new Error('Slack not connected');
        const parts: string[] = [`*Morning Brief — ${new Date().toLocaleDateString()}*`];

        // GitHub pending reviews
        try {
          const pending = _getGitHubReviewStore().listPending();
          if (pending.length > 0) {
            parts.push(`*GitHub Reviews* (${pending.length} pending):\n` + pending.slice(0, 5).map(r => `• ${r.owner}/${r.repo} #${r.number}`).join('\n'));
          }
        } catch { /* skip if not configured */ }

        // Jira
        try {
          const jiraAdapter = await _buildJiraAdapter();
          if (jiraAdapter) {
            const jiraIssues = await jiraAdapter.searchIssues('assignee = currentUser() AND status != Done ORDER BY updated DESC', 5);
            if (jiraIssues.length > 0) {
              parts.push(`*Jira* (${jiraIssues.length} open):\n` + jiraIssues.map(i => `• ${i.key} ${i.summary}`).join('\n'));
            }
          }
        } catch { /* skip */ }

        // Linear
        try {
          const linearAdapter = await _buildLinearAdapter();
          if (linearAdapter) {
            const linearIssues = await linearAdapter.searchIssues('', undefined, 5);
            if (linearIssues.length > 0) {
              parts.push(`*Linear* (${linearIssues.length} open):\n` + linearIssues.map(i => `• ${i.identifier} ${i.title}`).join('\n'));
            }
          }
        } catch { /* skip */ }

        await _slackAdapter.postMessage(channel, parts.join('\n\n'));
        result = `Posted morning brief to ${channel}`;

      } else if (id === 'builtin-approval-alert') {
        const label = ctx?.['label'] ?? 'Action Pending';
        const body  = ctx?.['body']  ?? 'An action is waiting for your approval in TriForge.';
        await _pushNotifier.fire('approval_required', label, body);
        result = 'Push notification sent';
      }

      const updated: RecipeState = { ...state, lastRunAt: Date.now(), lastRunStatus: 'success', lastRunResult: result };
      _saveRecipeState(updated);
      ledger.log('RECIPE_COMPLETED', { metadata: { id, result: result.slice(0, 200) } });
      eventBus.emit({ type: 'RECIPE_COMPLETED' as never, recipeId: id, result } as never);
      return { ok: true, result };

    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      const updated: RecipeState = { ...state, lastRunAt: Date.now(), lastRunStatus: 'failed', lastRunResult: error };
      _saveRecipeState(updated);
      ledger.log('RECIPE_FAILED', { metadata: { id, error } });
      eventBus.emit({ type: 'RECIPE_FAILED' as never, recipeId: id, error } as never);
      return { ok: false, error };
    }
  }

  function _fireEventRecipes(trigger: string, ctx?: Record<string, string>): void {
    const matching = BUILTIN_RECIPES.filter(r => r.trigger === trigger);
    for (const def of matching) {
      const state = _getRecipeState(def.id);
      if (!state.enabled) continue;
      void _executeRecipe(def.id, ctx);
    }
  }

  function _scheduleRecipe(id: string): void {
    if (_recipeTimers.has(id)) return;
    // Run once per day — 24h interval
    const timer = setInterval(() => { void _executeRecipe(id); }, 24 * 60 * 60 * 1000);
    _recipeTimers.set(id, timer);
  }

  function _unscheduleRecipe(id: string): void {
    const timer = _recipeTimers.get(id);
    if (timer) { clearInterval(timer); _recipeTimers.delete(id); }
  }

  function _initRecipeSchedules(): void {
    for (const def of BUILTIN_RECIPES) {
      if (def.trigger !== 'schedule:daily') continue;
      const state = _getRecipeState(def.id);
      if (state.enabled) _scheduleRecipe(def.id);
    }
  }
  _initRecipeSchedules();

  // recipe:list — return all builtin recipes merged with persisted state
  ipcMain.handle('recipe:list', (): RecipeView[] => {
    return BUILTIN_RECIPES.map(def => {
      const state = _getRecipeState(def.id);
      return { ...def, ...state };
    });
  });

  // recipe:toggle — enable or disable a recipe
  ipcMain.handle('recipe:toggle', (_e, id: string, enabled: boolean) => {
    const state   = _getRecipeState(id);
    const updated = { ...state, enabled };
    _saveRecipeState(updated);
    const def = BUILTIN_RECIPES.find(r => r.id === id);
    if (def?.trigger === 'schedule:daily') {
      if (enabled) _scheduleRecipe(id);
      else         _unscheduleRecipe(id);
    }
    return { ok: true };
  });

  // recipe:setParams — persist user-supplied param values
  ipcMain.handle('recipe:setParams', (_e, id: string, params: Record<string, string>) => {
    const state   = _getRecipeState(id);
    const updated = { ...state, params: { ...state.params, ...params } };
    _saveRecipeState(updated);
    return { ok: true };
  });

  // recipe:run — manually trigger a recipe regardless of trigger type
  ipcMain.handle('recipe:run', async (_e, id: string) => {
    return _executeRecipe(id);
  });

  // Hook _fireEventRecipes into GitHub PR review completed
  eventBus.onAny((event) => {
    const e = event as Record<string, unknown>;
    if (e.type === 'GITHUB_PR_REVIEW_COMPLETED') {
      _fireEventRecipes('event:github_review_completed', {
        repo:      String(e.repo ?? ''),
        owner:     String(e.owner ?? ''),
        prNumber:  String(e.prNumber ?? ''),
        synthesis: String((e as Record<string, unknown>)['synthesis'] ?? ''),
      });
    }
  });

  // ── Phase 14: Ops / Analytics Dashboard ───────────────────────────────────────

  /** Returns ms timestamp for the start of the requested window */
  function _windowStart(window: '24h' | '7d' | '30d'): number {
    const now = Date.now();
    if (window === '7d')  return now - 7  * 24 * 60 * 60 * 1000;
    if (window === '30d') return now - 30 * 24 * 60 * 60 * 1000;
    return now - 24 * 60 * 60 * 1000; // default 24h
  }

  function _countBy(entries: Array<{ eventType: string }>, ...types: string[]): number {
    return entries.filter(e => types.includes(e.eventType)).length;
  }

  function _topN(entries: Array<{ eventType: string; metadata?: Record<string, unknown> }>, metaKey: string, n = 5): Array<{ label: string; count: number }> {
    const counts: Record<string, number> = {};
    for (const e of entries) {
      const val = String(e.metadata?.[metaKey] ?? '(unknown)');
      counts[val] = (counts[val] ?? 0) + 1;
    }
    return Object.entries(counts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, n)
      .map(([label, count]) => ({ label, count }));
  }

  // ops:overview
  ipcMain.handle('ops:overview', async (_e, window: '24h' | '7d' | '30d' = '24h') => {
    const since   = _windowStart(window);
    const entries = await _getAuditLedger().tailSince(since);
    const pending = _approvalStore ? _getApprovalStore().listPending() : [];
    return {
      window,
      tasksCreated:        _countBy(entries, 'TASK_CREATED'),
      tasksCompleted:      _countBy(entries, 'TASK_COMPLETED'),
      tasksFailed:         _countBy(entries, 'TASK_FAILED'),
      approvalsPending:    pending.length,
      highRiskBlocked:     _countBy(entries, 'INBOUND_TASK_BLOCKED', 'ACTION_BLOCKED', 'AGENT_BLOCKED'),
      skillBlocked:        _countBy(entries, 'SKILL_BLOCKED', 'SKILL_INSTALL_BLOCKED'),
      recipesCompleted:    _countBy(entries, 'RECIPE_COMPLETED'),
      recipesFailed:       _countBy(entries, 'RECIPE_FAILED'),
      pushSent:            _countBy(entries, 'PUSH_SENT'),
      pushFailed:          _countBy(entries, 'PUSH_FAILED'),
      localModelUses:      _countBy(entries, 'LOCAL_MODEL_SELECTED'),
      cloudFallbacks:      _countBy(entries, 'LOCAL_MODEL_FALLBACK'),
      githubReviewsDone:   _countBy(entries, 'GITHUB_PR_REVIEW_COMPLETED'),
      policyMatches:       _countBy(entries, 'POLICY_RULE_MATCHED'),
    };
  });

  // ops:channels
  ipcMain.handle('ops:channels', async (_e, window: '24h' | '7d' | '30d' = '24h') => {
    const since   = _windowStart(window);
    const entries = await _getAuditLedger().tailSince(since);
    const msgLog  = _messageLog.list(200);
    const sinceMs = since;

    function chanStats(prefix: string) {
      const received  = _countBy(entries, `${prefix}_MESSAGE_RECEIVED`, `${prefix}_TASK_CREATED`);
      const blocked   = _countBy(entries, `${prefix}_MESSAGE_BLOCKED`);
      const replied   = _countBy(entries, `${prefix}_REPLY_SENT`);
      const approvals = _countBy(entries, `${prefix}_APPROVAL_PENDING`);
      const replyRate = received > 0 ? Math.round((replied / received) * 100) : 0;
      return { received, blocked, replied, approvals, replyRate };
    }

    // in-memory breakdown since window (only available for current session)
    const recent = msgLog.filter(m => m.timestamp >= sinceMs);
    const byChannel: Record<string, { inbound: number; blocked: number; replyOk: number }> = {};
    for (const m of recent) {
      if (!byChannel[m.channel]) byChannel[m.channel] = { inbound: 0, blocked: 0, replyOk: 0 };
      if (m.direction === 'inbound') byChannel[m.channel].inbound++;
      if (m.status === 'blocked')   byChannel[m.channel].blocked++;
      if (m.status === 'replied')   byChannel[m.channel].replyOk++;
    }

    return {
      window,
      telegram: chanStats('TELEGRAM'),
      slack:    chanStats('SLACK'),
      discord:  chanStats('DISCORD'),
      recentMessages: recent.slice(0, 20).map(m => ({
        channel:   m.channel,
        direction: m.direction,
        status:    m.status,
        riskClass: m.riskClass,
        text:      m.text.slice(0, 80),
        timestamp: m.timestamp,
      })),
    };
  });

  // ops:governance
  ipcMain.handle('ops:governance', async (_e, window: '24h' | '7d' | '30d' = '24h') => {
    const since   = _windowStart(window);
    const entries = await _getAuditLedger().tailSince(since);

    const ruleMatches = entries.filter(e => e.eventType === 'POLICY_RULE_MATCHED');
    const blocked     = entries.filter(e =>
      ['INBOUND_TASK_BLOCKED', 'ACTION_BLOCKED', 'AGENT_BLOCKED',
       'TELEGRAM_MESSAGE_BLOCKED', 'SLACK_MESSAGE_BLOCKED', 'DISCORD_MESSAGE_BLOCKED',
       'GITHUB_COMMENT_BLOCKED', 'SKILL_BLOCKED'].includes(e.eventType)
    );
    const approvalEvents = entries.filter(e =>
      ['TELEGRAM_APPROVAL_PENDING', 'SLACK_APPROVAL_PENDING', 'DISCORD_APPROVAL_PENDING',
       'STEP_APPROVAL_REQUESTED', 'ACTION_APPROVAL_REQUIRED'].includes(e.eventType)
    );

    return {
      window,
      totalMatches:   ruleMatches.length,
      totalBlocked:   blocked.length,
      totalApprovals: approvalEvents.length,
      topRules:       _topN(ruleMatches, 'ruleId'),
      topSources:     _topN(blocked, 'source'),
      topRiskClasses: _topN(
        entries.filter(e => e.metadata?.['riskClass']),
        'riskClass'
      ),
      recentBlocked: blocked.slice(-10).reverse().map(e => ({
        eventType: e.eventType,
        reason:    String(e.metadata?.['reason'] ?? e.metadata?.['riskClass'] ?? ''),
        source:    String(e.metadata?.['source'] ?? ''),
        timestamp: e.timestamp,
      })),
    };
  });

  // ops:integrations
  ipcMain.handle('ops:integrations', async (_e, window: '24h' | '7d' | '30d' = '24h') => {
    const since   = _windowStart(window);
    const entries = await _getAuditLedger().tailSince(since);
    return {
      window,
      github: {
        reviewsCompleted: _countBy(entries, 'GITHUB_PR_REVIEW_COMPLETED'),
        commentsPosted:   _countBy(entries, 'GITHUB_COMMENT_POSTED'),
        commentsBlocked:  _countBy(entries, 'GITHUB_COMMENT_BLOCKED'),
        webhooksReceived: _countBy(entries, 'GITHUB_WEBHOOK_RECEIVED'),
        issuesTriaged:    _countBy(entries, 'GITHUB_ISSUE_TRIAGE_COMPLETED'),
      },
      jira: {
        actionsQueued:   _countBy(entries, 'JIRA_ACTION_QUEUED'),
        actionsApproved: _countBy(entries, 'JIRA_ACTION_APPROVED'),
        actionsDismissed:_countBy(entries, 'JIRA_ACTION_DISMISSED'),
        commentsPosted:  _countBy(entries, 'JIRA_COMMENT_POSTED'),
        issuesCreated:   _countBy(entries, 'JIRA_ISSUE_CREATED'),
        transitions:     _countBy(entries, 'JIRA_STATUS_TRANSITIONED'),
      },
      linear: {
        actionsQueued:   _countBy(entries, 'LINEAR_ACTION_QUEUED'),
        actionsApproved: _countBy(entries, 'LINEAR_ACTION_APPROVED'),
        actionsDismissed:_countBy(entries, 'LINEAR_ACTION_DISMISSED'),
        commentsPosted:  _countBy(entries, 'LINEAR_COMMENT_POSTED'),
        issuesCreated:   _countBy(entries, 'LINEAR_ISSUE_CREATED'),
        statusUpdates:   _countBy(entries, 'LINEAR_STATUS_UPDATED'),
      },
      skills: {
        installed: _countBy(entries, 'SKILL_INSTALLED'),
        executed:  _countBy(entries, 'SKILL_EXECUTED'),
        blocked:   _countBy(entries, 'SKILL_BLOCKED'),
      },
      controlPlane: {
        tasksCreated: _countBy(entries, 'CONTROL_PLANE_TASK_CREATED'),
      },
    };
  });

  // ops:recipes
  ipcMain.handle('ops:recipes', (_e, window: '24h' | '7d' | '30d' = '24h') => {
    const since  = _windowStart(window);
    const states = store.getRecipeStates();
    return {
      window,
      recipes: BUILTIN_RECIPES.map(def => {
        const s = states[def.id];
        return {
          id:            def.id,
          name:          def.name,
          trigger:       def.triggerLabel,
          enabled:       s?.enabled ?? false,
          lastRunAt:     s?.lastRunAt,
          lastRunStatus: s?.lastRunStatus,
          lastRunResult: s?.lastRunResult?.slice(0, 120),
          ranInWindow:   s?.lastRunAt != null && s.lastRunAt >= since,
        };
      }),
    };
  });

  // ops:health
  ipcMain.handle('ops:health', async () => {
    const creds = new CredentialManager(store);
    const ghPat = await creds.get('github_pat').catch(() => undefined);
    return {
      services: [
        {
          name: 'Telegram',
          connected: store.getTelegramEnabled(),
          running:   !!_telegramBot,
          detail:    store.getTelegramEnabled() ? 'configured' : 'not configured',
        },
        {
          name: 'Slack',
          connected: store.getSlackEnabled(),
          running:   !!_slackAdapter,
          detail:    store.getSlackEnabled() ? 'configured' : 'not configured',
        },
        {
          name: 'Discord',
          connected: store.getDiscordEnabled(),
          running:   _discordAdapter?.isRunning() ?? false,
          detail:    store.getDiscordEnabled() ? 'configured' : 'not configured',
        },
        {
          name: 'GitHub',
          connected: !!ghPat,
          running:   !!ghPat,
          detail:    ghPat ? 'PAT configured' : 'no PAT',
        },
        {
          name: 'Jira',
          connected: store.getJiraEnabled(),
          running:   store.getJiraEnabled(),
          detail:    store.getJiraWorkspaceUrl() || 'not configured',
        },
        {
          name: 'Linear',
          connected: store.getLinearEnabled(),
          running:   store.getLinearEnabled(),
          detail:    store.getLinearWorkspaceName() || 'not configured',
        },
        {
          name: 'Push',
          connected: store.getPushProvider() !== 'disabled',
          running:   store.getPushProvider() !== 'disabled',
          detail:    store.getPushProvider(),
        },
        {
          name: 'Control Plane',
          connected: store.getControlPlaneEnabled(),
          running:   store.getControlPlaneEnabled(),
          detail:    store.getControlPlaneEnabled() ? `port ${store.getControlPlanePort()}` : 'disabled',
        },
      ],
    };
  });

  // ── Phase 15: Action Center ────────────────────────────────────────────────────

  // ActionItem — unified view model for the action center queue
  interface ActionItem {
    id:         string;   // prefixed: 'approval:uuid', 'jira:jq_...', 'linear:lq_...', 'message:msg_...', 'recipe:...', 'push:...', 'service:...', 'blocked:...'
    source:     'approval' | 'jira' | 'linear' | 'message' | 'recipe' | 'push' | 'service' | 'blocked';
    service:    string;   // 'agent' | 'jira' | 'linear' | 'telegram' | 'slack' | 'discord' | 'recipe' | 'push' | 'system'
    severity:   'critical' | 'warning' | 'info';
    title:      string;
    body:       string;
    canApprove: boolean;
    canDismiss: boolean;
    canRetry:   boolean;
    createdAt:  number;
    metadata:   Record<string, unknown>;
  }

  async function _buildActionQueue(): Promise<ActionItem[]> {
    const items: ActionItem[] = [];
    const creds = new CredentialManager(store);

    // 0. Paused runbook handoff items (Phase 32) — incident items surface as critical
    for (const handoff of store.getHandoffQueue()) {
      if (handoff.status !== 'pending') continue;
      if (_acknowledgedActionIds.has(`handoff:${handoff.id}`)) continue;
      const isIncidentHandoff = handoff.isIncident;
      const now               = Date.now();
      const isOverdue         = !!(handoff.expiresAt && now >= handoff.expiresAt);
      const isSoftOverdue     = !!(handoff.escalateAt && now >= handoff.escalateAt && !handoff.escalatedAt);
      const severity: 'critical' | 'warning' | 'info' =
        isIncidentHandoff || isOverdue ? 'critical' :
        isSoftOverdue                  ? 'warning'  :
        'warning';
      const minutesRemaining = handoff.expiresAt
        ? Math.round((handoff.expiresAt - now) / 60000)
        : undefined;
      const deadlineSuffix = isOverdue
        ? ` [OVERDUE ${Math.abs(minutesRemaining ?? 0)}m]`
        : minutesRemaining !== undefined && minutesRemaining <= 30
        ? ` [${minutesRemaining}m left]`
        : '';
      items.push({
        id:         `handoff:${handoff.id}`,
        source:     'handoff' as any,
        service:    'runbook',
        severity,
        title:      `${handoff.type === 'approval' ? 'Approval Required' : handoff.type === 'confirm' ? 'Confirm Required' : 'Manual Action Required'} — ${handoff.runbookTitle}${deadlineSuffix}`,
        body:       `Step: ${handoff.stepLabel}${handoff.blockedReason !== handoff.stepLabel ? ` — ${handoff.blockedReason}` : ''}${isIncidentHandoff ? ' [INCIDENT]' : ''}`,
        canApprove: handoff.type === 'approval',
        canDismiss: handoff.type === 'confirm' || handoff.type === 'manual',
        canRetry:   false,
        createdAt:  handoff.createdAt,
        metadata:   {
          handoffId:        handoff.id,
          executionId:      handoff.executionId,
          runbookId:        handoff.runbookId,
          stepId:           handoff.stepId,
          type:             handoff.type,
          isIncident:       handoff.isIncident,
          overdue:          isOverdue,
          minutesRemaining,
          escalationCount:  handoff.escalationCount,
        },
      });
    }

    // 1. Agent-level pending approvals (step approvals from AgentLoop)
    if (_approvalStore) {
      for (const req of _getApprovalStore().listPending()) {
        if (_acknowledgedActionIds.has(`approval:${req.id}`)) continue;
        items.push({
          id:         `approval:${req.id}`,
          source:     'approval',
          service:    'agent',
          severity:   req.riskLevel === 'high' ? 'critical' : req.riskLevel === 'medium' ? 'warning' : 'info',
          title:      `Approval Required — ${req.tool}`,
          body:       `Task ${req.taskId.slice(0, 8)} · Step ${req.stepId.slice(0, 8)} · est. $${(req.estimatedCostCents / 100).toFixed(2)}`,
          canApprove: true,
          canDismiss: true,
          canRetry:   false,
          createdAt:  req.createdAt,
          metadata:   { taskId: req.taskId, stepId: req.stepId, tool: req.tool, riskLevel: req.riskLevel },
        });
      }
    }

    // 2. Jira queued writes
    for (const action of _getJiraQueue().list(false)) {
      if (_acknowledgedActionIds.has(`jira:${action.id}`)) continue;
      items.push({
        id:         `jira:${action.id}`,
        source:     'jira',
        service:    'jira',
        severity:   'warning',
        title:      `Jira ${action.type.charAt(0).toUpperCase() + action.type.slice(1)} — ${action.summary.slice(0, 60)}`,
        body:       action.body.slice(0, 120),
        canApprove: true,
        canDismiss: true,
        canRetry:   false,
        createdAt:  action.createdAt,
        metadata:   { type: action.type, issueKey: action.issueKey, projectKey: action.projectKey },
      });
    }

    // 3. Linear queued writes
    for (const action of _getLinearQueue().list(false)) {
      if (_acknowledgedActionIds.has(`linear:${action.id}`)) continue;
      items.push({
        id:         `linear:${action.id}`,
        source:     'linear',
        service:    'linear',
        severity:   'warning',
        title:      `Linear ${action.type.charAt(0).toUpperCase() + action.type.slice(1)} — ${action.summary.slice(0, 60)}`,
        body:       action.body.slice(0, 120),
        canApprove: true,
        canDismiss: true,
        canRetry:   false,
        createdAt:  action.createdAt,
        metadata:   { type: action.type, issueId: action.issueId, teamId: action.teamId },
      });
    }

    // 4. Messaging approval-pending items (Telegram/Slack/Discord)
    for (const msg of _messageLog.list(200)) {
      if (msg.status !== 'approval_pending') continue;
      if (_acknowledgedActionIds.has(`message:${msg.id}`)) continue;
      items.push({
        id:         `message:${msg.id}`,
        source:     'message',
        service:    msg.channel,
        severity:   msg.riskClass === 'high_risk' ? 'critical' : 'warning',
        title:      `${msg.channel.charAt(0).toUpperCase() + msg.channel.slice(1)} Message — Approval Pending`,
        body:       msg.text.slice(0, 120),
        canApprove: false,
        canDismiss: true,
        canRetry:   false,
        createdAt:  msg.timestamp,
        metadata:   { channel: msg.channel, riskClass: msg.riskClass, chatId: msg.chatId, channelId: msg.channelId },
      });
    }

    // 5. Failed recipes
    const recipeStates = store.getRecipeStates();
    for (const def of BUILTIN_RECIPES) {
      const s = recipeStates[def.id];
      if (!s || s.lastRunStatus !== 'failed') continue;
      if (_acknowledgedActionIds.has(`recipe:${def.id}`)) continue;
      items.push({
        id:         `recipe:${def.id}`,
        source:     'recipe',
        service:    'recipe',
        severity:   'warning',
        title:      `Recipe Failed — ${def.name}`,
        body:       s.lastRunResult?.slice(0, 120) ?? 'Unknown error',
        canApprove: false,
        canDismiss: true,
        canRetry:   true,
        createdAt:  s.lastRunAt ?? Date.now(),
        metadata:   { recipeId: def.id },
      });
    }

    // 6. Failed push notifications
    for (const entry of _pushNotifier.getLog(50)) {
      if (entry.success) continue;
      if (_acknowledgedActionIds.has(`push:${entry.id}`)) continue;
      items.push({
        id:         `push:${entry.id}`,
        source:     'push',
        service:    'push',
        severity:   'info',
        title:      `Push Failed — ${entry.title}`,
        body:       entry.error ?? 'Delivery failed',
        canApprove: false,
        canDismiss: true,
        canRetry:   true,
        createdAt:  entry.timestamp,
        metadata:   { event: entry.event, provider: entry.provider },
      });
    }

    // 7. Unhealthy services
    const ghPat = await creds.get('github_pat').catch(() => undefined);
    const serviceChecks = [
      { name: 'Telegram',      ok: !store.getTelegramEnabled() || !!_telegramBot },
      { name: 'Slack',         ok: !store.getSlackEnabled() || !!_slackAdapter },
      { name: 'Discord',       ok: !store.getDiscordEnabled() || (_discordAdapter?.isRunning() ?? false) },
      { name: 'GitHub',        ok: !store.getControlPlaneEnabled() || !!ghPat },
    ];
    for (const svc of serviceChecks) {
      if (svc.ok) continue;
      const svcId = `service:${svc.name}`;
      if (_acknowledgedActionIds.has(svcId)) continue;
      items.push({
        id:         svcId,
        source:     'service',
        service:    svc.name.toLowerCase(),
        severity:   'critical',
        title:      `Service Offline — ${svc.name}`,
        body:       `${svc.name} is configured but not running. Check connection settings.`,
        canApprove: false,
        canDismiss: true,
        canRetry:   false,
        createdAt:  Date.now(),
        metadata:   { service: svc.name },
      });
    }

    // 8. Recent blocked events (last 2h from audit ledger)
    const twoHoursAgo = Date.now() - 2 * 60 * 60 * 1000;
    const recentEntries = await _getAuditLedger().tailSince(twoHoursAgo);
    const blockTypes = new Set([
      'INBOUND_TASK_BLOCKED', 'ACTION_BLOCKED', 'AGENT_BLOCKED',
      'TELEGRAM_MESSAGE_BLOCKED', 'SLACK_MESSAGE_BLOCKED', 'DISCORD_MESSAGE_BLOCKED',
      'GITHUB_COMMENT_BLOCKED', 'SKILL_BLOCKED',
    ]);
    for (const entry of recentEntries) {
      if (!blockTypes.has(entry.eventType)) continue;
      const itemId = `blocked:${entry.id}`;
      if (_acknowledgedActionIds.has(itemId)) continue;
      items.push({
        id:         itemId,
        source:     'blocked',
        service:    String(entry.metadata?.['channel'] ?? entry.metadata?.['source'] ?? 'system'),
        severity:   'critical',
        title:      `Blocked — ${entry.eventType.replace(/_/g, ' ')}`,
        body:       String(entry.metadata?.['reason'] ?? entry.metadata?.['riskClass'] ?? 'High-risk action was blocked'),
        canApprove: false,
        canDismiss: true,
        canRetry:   false,
        createdAt:  entry.timestamp,
        metadata:   { eventType: entry.eventType, ...(entry.metadata ?? {}) },
      });
    }

    // Sort: critical first, then by age (newest first)
    const severityOrder = { critical: 0, warning: 1, info: 2 };
    return items.sort((a, b) => {
      const sd = severityOrder[a.severity] - severityOrder[b.severity];
      return sd !== 0 ? sd : b.createdAt - a.createdAt;
    });
  }

  // action:list — unified action queue with optional view filter
  ipcMain.handle('action:list', async (_e, view: string = 'all') => {
    const all = await _buildActionQueue();
    let filtered = all;
    if (view === 'needs-approval') filtered = all.filter(i => i.canApprove);
    else if (view === 'blocked')   filtered = all.filter(i => i.source === 'blocked');
    else if (view === 'failures')  filtered = all.filter(i => i.source === 'recipe' || i.source === 'push');
    else if (view === 'alerts')    filtered = all.filter(i => i.source === 'service' || i.source === 'message');
    return { items: filtered };
  });

  // action:count — total items needing attention (for badge)
  ipcMain.handle('action:count', async () => {
    const all = await _buildActionQueue();
    return {
      total:        all.length,
      approvals:    all.filter(i => i.canApprove).length,
      blocked:      all.filter(i => i.source === 'blocked').length,
      failures:     all.filter(i => i.source === 'recipe' || i.source === 'push').length,
      alerts:       all.filter(i => i.source === 'service' || i.source === 'message').length,
    };
  });

  // action:approve — route to the appropriate approve handler
  ipcMain.handle('action:approve', async (_e, itemId: string) => {
    const [source, ...rest] = itemId.split(':');
    const id = rest.join(':');
    try {
      if (source === 'approval') {
        _getApprovalStore().update(id, { status: 'approved', respondedAt: Date.now() });
        _getAuditLedger().log('STEP_APPROVED', { metadata: { approvalId: id, via: 'action_center' } });
        return { ok: true };
      }
      if (source === 'jira') {
        const queue  = _getJiraQueue();
        const action = queue.approve(id);
        if (!action) return { ok: false, error: 'Not found or already processed' };
        const adapter = await _buildJiraAdapter();
        if (!adapter) return { ok: false, error: 'Jira not configured' };
        if (action.type === 'comment' && action.issueKey) {
          await adapter.addComment(action.issueKey, action.body);
          _getAuditLedger().log('JIRA_COMMENT_POSTED', { metadata: { issueKey: action.issueKey, via: 'action_center' } });
        } else if (action.type === 'transition' && action.issueKey && action.transitionId) {
          await adapter.doTransition(action.issueKey, action.transitionId);
          _getAuditLedger().log('JIRA_STATUS_TRANSITIONED', { metadata: { issueKey: action.issueKey, via: 'action_center' } });
        } else if (action.type === 'create' && action.projectKey) {
          await adapter.createIssue(action.projectKey, action.issueTypeId ?? '10001', action.summary, action.body);
          _getAuditLedger().log('JIRA_ISSUE_CREATED', { metadata: { projectKey: action.projectKey, via: 'action_center' } });
        }
        return { ok: true };
      }
      if (source === 'linear') {
        const queue  = _getLinearQueue();
        const action = queue.approve(id);
        if (!action) return { ok: false, error: 'Not found or already processed' };
        const adapter = await _buildLinearAdapter();
        if (!adapter) return { ok: false, error: 'Linear not configured' };
        if (action.type === 'comment' && action.issueId) {
          await adapter.createComment(action.issueId, action.body);
          _getAuditLedger().log('LINEAR_COMMENT_POSTED', { metadata: { issueId: action.issueId, via: 'action_center' } });
        } else if (action.type === 'create' && action.teamId) {
          await adapter.createIssue({ teamId: action.teamId, title: action.summary, description: action.body, priority: action.priority });
          _getAuditLedger().log('LINEAR_ISSUE_CREATED', { metadata: { teamId: action.teamId, via: 'action_center' } });
        } else if (action.type === 'update' && action.issueId) {
          await adapter.updateIssue(action.issueId, { stateId: action.stateId, assigneeId: action.assigneeId, priority: action.priority });
          _getAuditLedger().log('LINEAR_STATUS_UPDATED', { metadata: { issueId: action.issueId, via: 'action_center' } });
        }
        return { ok: true };
      }
      return { ok: false, error: `Source '${source}' does not support approve` };
    } catch (err) {
      return { ok: false, error: err instanceof Error ? err.message : String(err) };
    }
  });

  // action:dismiss — acknowledge or remove from queue
  ipcMain.handle('action:dismiss', (_e, itemId: string) => {
    const [source, ...rest] = itemId.split(':');
    const id = rest.join(':');
    if (source === 'approval') {
      _getApprovalStore().update(id, { status: 'denied', respondedAt: Date.now() });
      _getAuditLedger().log('STEP_DENIED', { metadata: { approvalId: id, via: 'action_center' } });
    } else if (source === 'jira') {
      _getJiraQueue().dismiss(id);
      _getAuditLedger().log('JIRA_ACTION_DISMISSED', { metadata: { actionId: id, via: 'action_center' } });
    } else if (source === 'linear') {
      _getLinearQueue().dismiss(id);
      _getAuditLedger().log('LINEAR_ACTION_DISMISSED', { metadata: { actionId: id, via: 'action_center' } });
    } else {
      // message, recipe, push, service, blocked — in-memory acknowledgement
      _acknowledgedActionIds.add(itemId);
    }
    return { ok: true };
  });

  // action:retry — re-run a failed recipe or resend a failed push
  ipcMain.handle('action:retry', async (_e, itemId: string) => {
    const [source, ...rest] = itemId.split(':');
    const id = rest.join(':');
    _acknowledgedActionIds.delete(itemId); // ensure it shows again after retry
    if (source === 'recipe') {
      const result = await _executeRecipe(id);
      return result;
    }
    if (source === 'push') {
      // Re-fire the push event associated with this log entry
      const entry = _pushNotifier.getLog(200).find(e => e.id === id);
      if (!entry) return { ok: false, error: 'Log entry not found' };
      const ok = await _pushNotifier.fire(entry.event, entry.title, 'Retry: ' + entry.title);
      return { ok };
    }
    return { ok: false, error: `Retry not supported for source '${source}'` };
  });

  // ── Phase 16: Shared Context / Team Memory IPC ────────────────────────────────

  function _ctx() { return store.getSharedContext(); }
  function _saveCtx(data: ReturnType<typeof _ctx>) { store.setSharedContext(data); }

  // context:getAll — return entire shared context blob
  ipcMain.handle('context:getAll', () => _ctx());

  // context:setEnabled — toggle per-category context usage
  ipcMain.handle('context:setEnabled', (_e, category: ContextCategory, enabled: boolean) => {
    const data = _ctx();
    data.enabled = { ...data.enabled, [category]: enabled };
    _saveCtx(data);
    _getAuditLedger().log('WORKFLOW_FIRED', { metadata: { event: 'context:setEnabled', category, enabled } });
    return { ok: true };
  });

  // context:upsertRepo — create or update a repo mapping
  ipcMain.handle('context:upsertRepo', (_e, input: Partial<RepoMapping> & { repo: string }) => {
    const next = upsertRepo(_ctx(), input);
    _saveCtx(next);
    _getAuditLedger().log('WORKFLOW_FIRED', { metadata: { event: 'context:upsertRepo', repo: input.repo } });
    return { ok: true, repoMappings: next.repoMappings };
  });

  // context:deleteRepo
  ipcMain.handle('context:deleteRepo', (_e, id: string) => {
    const next = deleteRepo(_ctx(), id);
    _saveCtx(next);
    _getAuditLedger().log('WORKFLOW_FIRED', { metadata: { event: 'context:deleteRepo', id } });
    return { ok: true };
  });

  // context:upsertChannel — create or update a channel mapping
  ipcMain.handle('context:upsertChannel', (_e, input: Partial<ChannelMapping> & { channel: ChannelMapping['channel']; channelId: string }) => {
    const next = upsertChannel(_ctx(), input);
    _saveCtx(next);
    _getAuditLedger().log('WORKFLOW_FIRED', { metadata: { event: 'context:upsertChannel', channel: input.channel, channelId: input.channelId } });
    return { ok: true, channelMappings: next.channelMappings };
  });

  // context:deleteChannel
  ipcMain.handle('context:deleteChannel', (_e, id: string) => {
    const next = deleteChannel(_ctx(), id);
    _saveCtx(next);
    _getAuditLedger().log('WORKFLOW_FIRED', { metadata: { event: 'context:deleteChannel', id } });
    return { ok: true };
  });

  // context:upsertProject — create or update a project note
  ipcMain.handle('context:upsertProject', (_e, input: Partial<ProjectNote> & { projectKey: string }) => {
    const next = upsertProject(_ctx(), input);
    _saveCtx(next);
    _getAuditLedger().log('WORKFLOW_FIRED', { metadata: { event: 'context:upsertProject', projectKey: input.projectKey } });
    return { ok: true, projectNotes: next.projectNotes };
  });

  // context:deleteProject
  ipcMain.handle('context:deleteProject', (_e, id: string) => {
    const next = deleteProject(_ctx(), id);
    _saveCtx(next);
    _getAuditLedger().log('WORKFLOW_FIRED', { metadata: { event: 'context:deleteProject', id } });
    return { ok: true };
  });

  // context:resolveRepo — resolve a "owner/repo" string to its mapping + project note
  ipcMain.handle('context:resolveRepo', (_e, repo: string) => {
    return resolveRepo(_ctx(), repo);
  });

  // context:resolveChannel — resolve a channel + channelId to its mapping + project note
  ipcMain.handle('context:resolveChannel', (_e, channel: string, channelId: string) => {
    return resolveChannel(_ctx(), channel, channelId);
  });

  // ── Phase 17: TriForge Dispatch ───────────────────────────────────────────────

  // ── In-memory pending confirmations (desktop confirm flow) ────────────────────
  const _pendingConfirmations = new Map<string, PendingConfirmation>();

  // ── Phase 20: Context enrichment for dispatch action items ────────────────────

  function _toolToSystem(tool: string): string {
    if (tool.startsWith('jira'))               return 'Jira';
    if (tool.startsWith('linear'))             return 'Linear';
    if (tool.startsWith('github') || tool.startsWith('gh_')) return 'GitHub';
    if (tool.startsWith('slack'))              return 'Slack';
    if (tool.startsWith('telegram'))           return 'Telegram';
    if (tool.startsWith('discord'))            return 'Discord';
    if (tool === 'bash' || tool === 'shell')   return 'Terminal';
    if (tool === 'browser')                    return 'Browser';
    if (tool.startsWith('file') || tool.startsWith('fs')) return 'File system';
    return tool.charAt(0).toUpperCase() + tool.slice(1);
  }

  function _enrichDispatchItem(
    item:   ActionItem,
    ctx:    ReturnType<typeof store.getSharedContext>,
    policy: ReturnType<typeof store.getRemoteApprovePolicy>,
  ): Partial<DispatchActionItem> {
    const meta   = item.metadata ?? {};
    const source = item.id.split(':')[0];
    const result: Partial<DispatchActionItem> = {
      needsDesktopConfirm: policy.requireDesktopConfirm && item.canApprove,
      policyRule: policy.enabled
        ? `Remote approve enabled · max risk: ${policy.maxRisk}${policy.requireDesktopConfirm ? ' · desktop confirm required' : ''}`
        : 'Remote actions disabled — view only',
    };

    switch (source) {
      case 'approval': {
        const riskLevel = String(meta['riskLevel'] ?? 'low');
        const tool      = String(meta['tool'] ?? 'unknown');
        result.rationale    = `Risk level **${riskLevel}** — agent step requires human approval before executing tool: **${tool}**`;
        result.triggeredBy  = `Risk classifier — ${riskLevel}`;
        result.willTouch    = [_toolToSystem(tool)];
        result.affectedTarget = `Task ${String(meta['taskId'] ?? '').slice(0, 8)}`;
        result.isDestructive  = riskLevel === 'high';
        break;
      }
      case 'jira': {
        const type       = String(meta['type'] ?? 'write');
        const issueKey   = String(meta['issueKey'] ?? '');
        const projectKey = String(meta['projectKey'] ?? '');
        const key        = projectKey || (issueKey ? issueKey.replace(/-\d+$/, '') : '');
        const note       = key ? resolveProject(ctx, key) : undefined;
        result.rationale    = type === 'comment'
          ? `Jira comment pending approval — will post to **${issueKey || projectKey}**`
          : type === 'create'
            ? `New Jira issue pending approval — will create in project **${projectKey}**`
            : `Jira ${type} pending approval for **${issueKey}**`;
        result.triggeredBy  = 'Jira write gate — requires human approval';
        result.willTouch    = ['Jira'];
        result.affectedTarget = issueKey || projectKey;
        result.relatedProject = note?.projectName ?? key;
        result.contextNotes   = note?.automationContext;
        break;
      }
      case 'linear': {
        const type    = String(meta['type'] ?? 'write');
        const issueId = String(meta['issueId'] ?? '');
        const teamId  = String(meta['teamId'] ?? '');
        const note    = teamId ? resolveProject(ctx, teamId) : undefined;
        result.rationale    = type === 'comment'
          ? `Linear comment pending approval — will post to issue **${issueId}**`
          : type === 'create'
            ? `New Linear issue pending approval in team **${teamId}**`
            : `Linear issue update pending approval for **${issueId}**`;
        result.triggeredBy  = 'Linear write gate — requires human approval';
        result.willTouch    = ['Linear'];
        result.affectedTarget = issueId || teamId;
        result.relatedProject = note?.projectName ?? teamId;
        result.contextNotes   = note?.automationContext;
        break;
      }
      case 'message': {
        const channel   = String(meta['channel'] ?? 'unknown');
        const chatId    = String(meta['chatId'] ?? meta['channelId'] ?? '');
        const riskClass = String(meta['riskClass'] ?? '');
        const resolved  = chatId ? resolveChannel(ctx, channel, chatId) : {};
        result.rationale    = `Inbound **${channel}** message classified **${riskClass}** — pending approval before agent responds`;
        result.triggeredBy  = `${channel.charAt(0).toUpperCase() + channel.slice(1)} risk gate — ${riskClass}`;
        result.willTouch    = [channel.charAt(0).toUpperCase() + channel.slice(1)];
        result.affectedTarget = (resolved as any).mapping?.channelName ?? chatId;
        result.relatedProject = (resolved as any).projectNote?.projectName ?? (resolved as any).mapping?.workstream;
        result.contextNotes   = (resolved as any).projectNote?.automationContext;
        break;
      }
      case 'recipe': {
        result.rationale   = 'Recipe last run failed — retry will re-execute all automation steps';
        result.triggeredBy = 'Recipe failure monitor';
        result.willTouch   = ['Recipe engine'];
        result.affectedTarget = String(meta['recipeId'] ?? '');
        break;
      }
      case 'push': {
        const event    = String(meta['event'] ?? '');
        const provider = String(meta['provider'] ?? '');
        result.rationale   = `Push notification delivery failed for event **${event}** via ${provider}`;
        result.triggeredBy = 'Push delivery monitor';
        result.willTouch   = ['Push notifications'];
        break;
      }
      case 'service': {
        const svc = String(meta['service'] ?? 'Unknown');
        result.rationale   = `**${svc}** is configured but the connection is offline — check integration settings`;
        result.triggeredBy = 'Service health monitor';
        result.willTouch   = [svc];
        result.affectedTarget = svc;
        break;
      }
      case 'blocked': {
        const riskClass = String(meta['riskClass'] ?? meta['reason'] ?? '');
        result.rationale   = `Action was blocked by the **${riskClass}** risk policy — no further action required. Dismiss to acknowledge.`;
        result.triggeredBy = `Risk policy — ${riskClass}`;
        result.willTouch   = [];
        const channel = String(meta['channel'] ?? meta['source'] ?? '');
        if (channel) result.affectedTarget = channel;
        break;
      }
    }
    return result;
  }

  // ── Phase 20: History builder — recent dispatch events from audit ledger ──────

  async function _buildDispatchHistory(): Promise<DispatchHistoryEntry[]> {
    const since   = Date.now() - 48 * 60 * 60 * 1000;
    const entries = await _getAuditLedger().tailSince(since);

    const dispatchEventTypes = new Set([
      'STEP_APPROVED', 'STEP_DENIED',
      'JIRA_ACTION_APPROVED', 'JIRA_ACTION_DISMISSED',
      'LINEAR_ACTION_APPROVED', 'LINEAR_ACTION_DISMISSED',
      'MISSION_FIRED',
    ]);

    const results: DispatchHistoryEntry[] = [];
    for (const e of entries) {
      const meta = (e.metadata ?? {}) as Record<string, unknown>;
      const isDispatch = dispatchEventTypes.has(e.eventType) ||
                         meta['source'] === 'dispatch_remote';
      if (!isDispatch) continue;

      const et   = e.eventType ?? '';
      const verb = (et.includes('APPROV') || String(meta['action'] ?? '').includes('approve')) ? 'approve'
                 : (et.includes('DISMISS') || String(meta['action'] ?? '').includes('dismiss')) ? 'dismiss'
                 : (et.includes('RETRY')   || String(meta['action'] ?? '').includes('retry'))   ? 'retry'
                 : (et.includes('MISSION') || et.includes('RECIPE') ||
                    String(meta['action'] ?? '').includes('run'))                                 ? 'run'
                 : (et.includes('BLOCK'))                                                         ? 'blocked'
                 : String(meta['action'] ?? 'action');

      const rawLabel = String(meta['detail'] ?? meta['actionId'] ?? meta['action'] ?? et);
      const deviceLabel = String(meta['deviceLabel'] ?? meta['via'] ?? '');

      results.push({
        id:          e.id,
        timestamp:   e.timestamp,
        verb,
        label:       rawLabel,
        source:      String(meta['source'] ?? et.toLowerCase()),
        deviceLabel: deviceLabel || null,
        isAdmin:     !!(meta['isAdmin']) || deviceLabel.startsWith('dispatch_admin'),
        clientIp:    String(meta['ip'] ?? meta['clientIp'] ?? ''),
        outcome:     'ok',
      });
    }

    // Return newest first, capped at 50
    return results.reverse().slice(0, 50);
  }

  function _buildDispatchHandlers(): DispatchHandlers {
    return {
      // ── Auth data ─────────────────────────────────────────────────────────────
      async getMasterToken() {
        return (await _getCredentialManager(store).get('dispatch_token')) ?? '';
      },
      getPairedDevices() { return store.getPairedDevices(); },
      setPairedDevices(v) { store.setPairedDevices(v); },
      getPairingCode()   { return store.getActivePairingCode(); },
      setPairingCode(v)  { store.setActivePairingCode(v); },
      getNetworkMode()   { return store.getDispatchNetworkMode(); },
      getApprovePolicy() { return store.getRemoteApprovePolicy(); },
      getSessionTtlMinutes() { return store.getDispatchSessionTtlMinutes(); },

      // ── Action data ───────────────────────────────────────────────────────────
      async getActions(): Promise<DispatchActionItem[]> {
        const items  = await _buildActionQueue();
        const ctx    = store.getSharedContext();
        const policy = store.getRemoteApprovePolicy();
        return items.map(item => ({
          id:         item.id,
          source:     item.id.split(':')[0],
          label:      item.title,     // FIX: ActionItem uses .title not .label
          detail:     item.body,      // FIX: ActionItem uses .body not .detail
          severity:   item.severity as RiskLevel,
          age:        Date.now() - item.createdAt,
          canApprove: item.canApprove,
          canDismiss: item.canDismiss,
          canRetry:   item.canRetry,
          ..._enrichDispatchItem(item, ctx, policy),
        }));
      },

      // ── History ───────────────────────────────────────────────────────────────
      async getHistory(): Promise<DispatchHistoryEntry[]> {
        return _buildDispatchHistory();
      },
      async approveAction(itemId: string, ctx: RemoteActionContext): Promise<ActionResult> {
        const [source, ...rest] = itemId.split(':');
        const id = rest.join(':');
        const via = ctx.isAdmin ? 'dispatch_admin' : `dispatch_remote:${ctx.deviceId ?? 'unknown'}`;
        // ── Phase 29: workspace policy check ──────────────────────────────────
        const category = categoryForSource(source);
        const policyCheck = _getPolicyEngine().canApprove(ctx.deviceId ?? null, category, ctx.isAdmin);
        const wsId = store.getWorkspace()?.id;
        if (!policyCheck.allowed) {
          _getAuditLedger().log('WS_APPROVAL_DENIED', {
            metadata: { itemId, source, category, actorId: ctx.deviceId, actorRole: policyCheck.actorRole, reason: policyCheck.reason, workspaceId: wsId },
          });
          return { ok: false, error: `Workspace policy denied: ${policyCheck.reason}` };
        }
        _getAuditLedger().log('WS_POLICY_RULE_MATCHED', {
          metadata: { itemId, source, category, actorId: ctx.deviceId, actorRole: policyCheck.actorRole, allowed: true, workspaceId: wsId },
        });
        // ── End policy check ──────────────────────────────────────────────────
        try {
          if (source === 'approval') {
            _getApprovalStore().update(id, { status: 'approved', respondedAt: Date.now() });
            _getAuditLedger().log('STEP_APPROVED', { metadata: { approvalId: id, via, ip: ctx.clientIp } });
            return { ok: true };
          }
          if (source === 'jira') {
            const queue  = _getJiraQueue();
            const action = queue.approve(id);
            if (!action) return { ok: false, error: 'Not found or already processed' };
            const adapter = await _buildJiraAdapter();
            if (!adapter) return { ok: false, error: 'Jira not configured' };
            if (action.type === 'comment' && action.issueKey) {
              await adapter.addComment(action.issueKey, action.body);
            } else if (action.type === 'transition' && action.issueKey && action.transitionId) {
              await adapter.doTransition(action.issueKey, action.transitionId);
            } else if (action.type === 'create' && action.projectKey) {
              await adapter.createIssue(action.projectKey, action.issueTypeId ?? '10001', action.summary, action.body);
            }
            _getAuditLedger().log('JIRA_ACTION_APPROVED', { metadata: { actionId: id, via, ip: ctx.clientIp } });
            return { ok: true };
          }
          if (source === 'linear') {
            const queue  = _getLinearQueue();
            const action = queue.approve(id);
            if (!action) return { ok: false, error: 'Not found or already processed' };
            const adapter = await _buildLinearAdapter();
            if (!adapter) return { ok: false, error: 'Linear not configured' };
            if (action.type === 'comment' && action.issueId) {
              await adapter.createComment(action.issueId, action.body);
            } else if (action.type === 'create' && action.teamId) {
              await adapter.createIssue({ teamId: action.teamId, title: action.summary, description: action.body, priority: action.priority });
            } else if (action.type === 'update' && action.issueId) {
              await adapter.updateIssue(action.issueId, { stateId: action.stateId, assigneeId: action.assigneeId, priority: action.priority });
            }
            _getAuditLedger().log('LINEAR_ACTION_APPROVED', { metadata: { actionId: id, via, ip: ctx.clientIp } });
            return { ok: true };
          }
          return { ok: false, error: `Source '${source}' does not support approve` };
        } catch (e: unknown) {
          return { ok: false, error: e instanceof Error ? e.message : String(e) };
        }
      },
      async dismissAction(itemId: string, ctx: RemoteActionContext): Promise<ActionResult> {
        const [source, ...rest] = itemId.split(':');
        const id = rest.join(':');
        const via = ctx.isAdmin ? 'dispatch_admin' : `dispatch_remote:${ctx.deviceId ?? 'unknown'}`;
        // ── Phase 29: workspace policy check ──────────────────────────────────
        const _dismissCategory = categoryForSource(source);
        const _dismissCheck = _getPolicyEngine().canApprove(ctx.deviceId ?? null, _dismissCategory, ctx.isAdmin);
        const _dismissWsId = store.getWorkspace()?.id;
        if (!_dismissCheck.allowed) {
          _getAuditLedger().log('WS_APPROVAL_DENIED', {
            metadata: { itemId, source, category: _dismissCategory, actorId: ctx.deviceId, actorRole: _dismissCheck.actorRole, reason: _dismissCheck.reason, workspaceId: _dismissWsId },
          });
          return { ok: false, error: `Workspace policy denied: ${_dismissCheck.reason}` };
        }
        // ── End policy check ──────────────────────────────────────────────────
        if (source === 'approval') {
          _getApprovalStore().update(id, { status: 'denied', respondedAt: Date.now() });
          _getAuditLedger().log('STEP_DENIED', { metadata: { approvalId: id, via, ip: ctx.clientIp } });
        } else if (source === 'jira') {
          _getJiraQueue().dismiss(id);
          _getAuditLedger().log('JIRA_ACTION_DISMISSED', { metadata: { actionId: id, via, ip: ctx.clientIp } });
        } else if (source === 'linear') {
          _getLinearQueue().dismiss(id);
          _getAuditLedger().log('LINEAR_ACTION_DISMISSED', { metadata: { actionId: id, via, ip: ctx.clientIp } });
        } else {
          _acknowledgedActionIds.add(itemId);
        }
        return { ok: true };
      },
      async retryAction(itemId: string, ctx: RemoteActionContext): Promise<ActionResult> {
        const [source, ...rest] = itemId.split(':');
        const id = rest.join(':');
        const via = ctx.isAdmin ? 'dispatch_admin' : `dispatch_remote:${ctx.deviceId ?? 'unknown'}`;
        // ── Phase 29: workspace policy check ──────────────────────────────────
        const _retryCategory = categoryForSource(source);
        const _retryCheck = _getPolicyEngine().canApprove(ctx.deviceId ?? null, _retryCategory, ctx.isAdmin);
        if (!_retryCheck.allowed) {
          _getAuditLedger().log('WS_APPROVAL_DENIED', {
            metadata: { itemId, source, category: _retryCategory, actorId: ctx.deviceId, actorRole: _retryCheck.actorRole, reason: _retryCheck.reason, workspaceId: store.getWorkspace()?.id },
          });
          return { ok: false, error: `Workspace policy denied: ${_retryCheck.reason}` };
        }
        // ── End policy check ──────────────────────────────────────────────────
        _acknowledgedActionIds.delete(itemId);
        if (source === 'recipe') {
          const r = await _executeRecipe(id, { source: via });
          return r;
        }
        if (source === 'push') {
          const entry = _pushNotifier.getLog(200).find(e => e.id === id);
          if (!entry) return { ok: false, error: 'Log entry not found' };
          const ok = await _pushNotifier.fire(entry.event, entry.title, 'Retry: ' + entry.title);
          return { ok };
        }
        return { ok: false, error: `Retry not supported for source '${source}'` };
      },
      async getOpsOverview(): Promise<DispatchOpsOverview> {
        const actions = await _buildActionQueue();
        const ledger  = _getAuditLedger();
        const since24 = Date.now() - 24 * 60 * 60 * 1000;
        const entries = await ledger.tailSince(since24);
        const approvedToday  = entries.filter(e => (e.eventType as string) === 'TASK_APPROVED').length;
        const blockedToday   = entries.filter(e => (e.eventType as string) === 'TASK_BLOCKED').length;
        const failedRecipes  = entries.filter(e => (e.eventType as string) === 'RECIPE_FAILED').length;
        const unhealthyCount = actions.filter(a => a.id.startsWith('health:')).length;
        return {
          actionsTotal:      actions.length,
          approvedToday,
          blockedToday,
          failedRecipes,
          unhealthyServices: unhealthyCount,
        };
      },
      async getRecipes(): Promise<DispatchRecipeItem[]> {
        const states = store.getRecipeStates();
        return BUILTIN_RECIPES.map(r => {
          const s = states[r.id] ?? { enabled: false, params: {} };
          return {
            id:            r.id,
            name:          r.name,
            trigger:       r.trigger,
            enabled:       s.enabled,
            lastRunAt:     s.lastRunAt,
            lastRunStatus: s.lastRunStatus,
          };
        });
      },
      async runRecipe(id: string, ctx: RemoteActionContext): Promise<ActionResult> {
        const via = ctx.isAdmin ? 'dispatch_admin' : `dispatch_remote:${ctx.deviceId ?? 'unknown'}`;
        // ── Phase 29: workspace policy check ──────────────────────────────────
        const _recipeCheck = _getPolicyEngine().canApprove(ctx.deviceId ?? null, 'recipe:run', ctx.isAdmin);
        if (!_recipeCheck.allowed) {
          _getAuditLedger().log('WS_APPROVAL_DENIED', {
            metadata: { recipeId: id, category: 'recipe:run', actorId: ctx.deviceId, actorRole: _recipeCheck.actorRole, reason: _recipeCheck.reason, workspaceId: store.getWorkspace()?.id },
          });
          return { ok: false, error: `Workspace policy denied: ${_recipeCheck.reason}` };
        }
        // ── End policy check ──────────────────────────────────────────────────
        try {
          const r = await _executeRecipe(
            id,
            { source: via },
            { deviceId: ctx.deviceId ?? undefined, isAdmin: ctx.isAdmin, isRemote: true },
          );
          return r;
        } catch (e: unknown) {
          return { ok: false, error: e instanceof Error ? e.message : String(e) };
        }
      },
      async getMissions(): Promise<DispatchMissionItem[]> {
        const defs = _getMissionStore().load();
        return defs.map(m => ({
          id:          m.id,
          name:        m.name,
          description: m.description,
          category:    m.category,
          enabled:     m.enabled,
          schedule:    m.schedule,
          lastRunAt:   m.lastRunAt,
        }));
      },
      async runMission(id: string, ctx: RemoteActionContext): Promise<ActionResult> {
        // ── Phase 29: workspace policy check ──────────────────────────────────
        const _missionCheck = _getPolicyEngine().canApprove(ctx.deviceId ?? null, 'recipe:run', ctx.isAdmin);
        if (!_missionCheck.allowed) {
          _getAuditLedger().log('WS_APPROVAL_DENIED', {
            metadata: { missionId: id, category: 'recipe:run', actorId: ctx.deviceId, actorRole: _missionCheck.actorRole, reason: _missionCheck.reason, workspaceId: store.getWorkspace()?.id },
          });
          return { ok: false, error: `Workspace policy denied: ${_missionCheck.reason}` };
        }
        // ── End policy check ──────────────────────────────────────────────────
        try {
          const mm = _getMissionManager(store);
          await mm.runMission(id);
          _getAuditLedger().log('MISSION_FIRED' as any, { metadata: { missionId: id, via: ctx.deviceId ?? 'admin', ip: ctx.clientIp } });
          return { ok: true };
        } catch (e: unknown) {
          return { ok: false, error: e instanceof Error ? e.message : String(e) };
        }
      },
      // Desktop confirmation queue
      queueConfirmation(conf: PendingConfirmation) {
        _pendingConfirmations.set(conf.id, conf);
      },
      resolveConfirmation(id: string): PendingConfirmation | undefined {
        return _pendingConfirmations.get(id);
      },
      auditLog(action: string, detail: string, ctx: RemoteActionContext) {
        _getAuditLedger().log('SYSTEM_EVENT' as any, {
          metadata: {
            action,
            detail,
            source:      'dispatch_remote',
            deviceId:    ctx.deviceId,
            deviceLabel: ctx.deviceLabel,
            clientIp:    ctx.clientIp,
            isAdmin:     ctx.isAdmin,
          },
        });
      },
      emitToRenderer(channel: string, payload: unknown) {
        for (const win of BrowserWindow.getAllWindows()) {
          if (!win.isDestroyed()) win.webContents.send(channel, payload);
        }
      },

      // ── Phase 21 — remote task workbench ───────────────────────────────────
      async listTasks(): Promise<DispatchTask[]> {
        return store.getDispatchTasks().slice().reverse(); // newest first
      },
      async getTask(id: string): Promise<DispatchTask | null> {
        return store.getDispatchTasks().find(t => t.id === id) ?? null;
      },
      // Phase 23 — artifact handlers
      async listTaskArtifacts(taskId: string): Promise<DispatchArtifact[]> {
        return store.getDispatchArtifacts().filter(a => a.taskId === taskId);
      },
      async getArtifact(id: string): Promise<DispatchArtifact | null> {
        return store.getDispatchArtifacts().find(a => a.id === id) ?? null;
      },
      async approveArtifactSend(id: string, ctx: RemoteActionContext): Promise<ActionResult> {
        const artifact = store.getDispatchArtifacts().find(a => a.id === id);
        if (!artifact) return { ok: false, error: 'Artifact not found' };
        if (artifact.meta?.status === 'sent') return { ok: false, error: 'Already sent' };
        return _sendArtifact(artifact, ctx);
      },
      // Phase 24 — bundle handlers
      async listTaskBundles(taskId: string): Promise<DispatchArtifactBundle[]> {
        return store.getDispatchBundles().filter(b => b.taskId === taskId);
      },
      async getBundle(id: string): Promise<DispatchArtifactBundle | null> {
        return store.getDispatchBundles().find(b => b.id === id) ?? null;
      },
      async sendBundle(
        id: string,
        mode: 'all' | 'safe' | 'selected',
        selectedIds: string[],
        ctx: RemoteActionContext,
      ): Promise<ActionResult & { sent: string[]; held: string[] }> {
        const bundle = store.getDispatchBundles().find(b => b.id === id);
        if (!bundle) return { ok: false, error: 'Bundle not found', sent: [], held: [] };

        const DRAFT_TYPES: ArtifactType[] = ['draft_slack', 'draft_jira', 'draft_linear', 'draft_github'];
        const allArts = store.getDispatchArtifacts().filter(a => bundle.artifactIds.includes(a.id));
        const candidates = allArts.filter(a => DRAFT_TYPES.includes(a.type) && a.meta?.status !== 'sent');

        let targets: DispatchArtifact[];
        if (mode === 'selected') {
          targets = candidates.filter(a => selectedIds.includes(a.id));
        } else if (mode === 'safe') {
          // "safe" = non-destructive draft types (exclude github for now unless PAT configured)
          targets = candidates.filter(a => a.type !== 'draft_github');
        } else {
          targets = candidates;
        }

        const sent: string[] = [];
        const held: string[] = [];
        const errors: string[] = [];

        for (const art of targets) {
          const r = await _sendArtifact(art, ctx);
          if (r.ok) { sent.push(art.id); }
          else { held.push(art.id); errors.push(`${art.title}: ${r.error}`); }
        }

        // Recalculate bundle status
        const updatedArts = store.getDispatchArtifacts().filter(a => bundle.artifactIds.includes(a.id));
        const newSentCount = updatedArts.filter(a => a.meta?.status === 'sent').length;
        const DRAFT: ArtifactType[] = ['draft_slack', 'draft_jira', 'draft_linear', 'draft_github'];
        const remaining = updatedArts.filter(a => DRAFT.includes(a.type) && a.meta?.status !== 'sent').length;
        const newStatus: BundleStatus = remaining === 0 ? 'sent' : newSentCount > 0 ? 'partial' : 'pending';
        const allBundles = store.getDispatchBundles();
        const bidx = allBundles.findIndex(b => b.id === id);
        if (bidx >= 0) {
          allBundles[bidx] = { ...allBundles[bidx], status: newStatus, sentCount: newSentCount };
          store.setDispatchBundles(allBundles);
        }

        // Update task's bundle reference
        const tasks = store.getDispatchTasks();
        const tidx  = tasks.findIndex(t => t.id === bundle.taskId);
        if (tidx >= 0) { _updateDispatchTask(tasks[tidx]); }

        _getAuditLedger().log('SYSTEM_EVENT' as any, {
          metadata: { action: 'bundle_send', bundleId: id, mode, sent: sent.length, held: held.length, via: ctx.deviceId ?? 'admin' },
        });

        const ok = errors.length === 0;
        return { ok, error: ok ? undefined : errors.join('; '), sent, held };
      },
      // Phase 25 — thread / inbox handlers
      async listThreads(): Promise<DispatchThread[]> {
        return store.getDispatchThreads().slice().reverse(); // newest first
      },
      async getThread(id: string): Promise<DispatchThread | null> {
        return store.getDispatchThreads().find(t => t.id === id) ?? null;
      },
      async postThreadMessage(
        threadId: string,
        text: string,
        category: import('./dispatchServer').TaskCategory,
        ctx: RemoteActionContext,
      ): Promise<{ message: DispatchMessage; task: DispatchTask }> {
        const threads = store.getDispatchThreads();
        const thread  = threads.find(t => t.id === threadId);
        if (!thread) throw new Error('Thread not found');

        // Add user message to thread
        const userMsg = _appendThreadMessage(thread, { role: 'user', text });

        // Create follow-up task carrying thread context forward
        const id  = `task:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`;
        const now = Date.now();
        const followUpTask: DispatchTask = {
          id,
          createdAt:   now,
          updatedAt:   now,
          goal:        text,
          category: category as import('./dispatchServer').TaskCategory,
          status:      'queued',
          ctx:         { ...thread.ctx },   // carry-forward context
          deviceLabel: ctx.deviceLabel,
          threadId:    thread.id,
        };
        _updateDispatchTask(followUpTask);

        // Back-link task to thread
        thread.taskIds.push(followUpTask.id);
        thread.status  = 'active';
        thread.updatedAt = Date.now();
        // Update user message with taskId
        const lastMsg = thread.messages[thread.messages.length - 1];
        if (lastMsg.id === userMsg.id) lastMsg.taskId = followUpTask.id;
        _updateThread(thread);

        // Execute asynchronously
        _executeDispatchTask(followUpTask, { goal: text, category: category as import('./dispatchServer').TaskCategory, ctx: thread.ctx }).catch(() => {});
        return { message: userMsg, task: followUpTask };
      },

      // Phase 27 — workspace management
      async getWorkspace(): Promise<Workspace | null> {
        return store.getWorkspace();
      },

      async createWorkspaceInvite(role: WorkspaceRole, ctx: RemoteActionContext): Promise<{ invite: WorkspaceInvite }> {
        const ws = _ensureWorkspace('My Workspace', ctx.deviceId ?? 'desktop');
        if (!ctx.isAdmin && !_hasWorkspaceRole(ctx.deviceId, 'admin')) {
          throw new Error('Only admins and owners can create workspace invites');
        }
        if (!ws.invites) ws.invites = [];
        const invite: WorkspaceInvite = {
          code:      _generateInviteCode(),
          createdAt: Date.now(),
          expiresAt: Date.now() + 48 * 60 * 60 * 1000,
          createdBy: ctx.deviceId ?? 'admin',
          role,
          revoked:   false,
        };
        ws.invites.push(invite);
        ws.updatedAt = Date.now();
        store.setWorkspace(ws);
        _getAuditLedger().log('WORKSPACE_INVITE_CREATED', {
          metadata: { workspaceId: ws.id, workspaceName: ws.name, actor: ctx.deviceId ?? 'admin', actorRole: _getWorkspaceRole(ctx.deviceId) ?? 'owner', targetRole: role, source: 'remote' },
        });
        return { invite };
      },

      async claimWorkspaceInvite(code: string, ctx: RemoteActionContext): Promise<{ workspace: Workspace }> {
        const ws = store.getWorkspace();
        if (!ws) throw new Error('No workspace exists yet');
        const invite = (ws.invites ?? []).find(
          i => i.code === code && !i.revoked && !i.claimedBy && i.expiresAt > Date.now()
        );
        if (!invite) throw new Error('Invite code not found, expired, already claimed, or revoked');
        invite.claimedBy = ctx.deviceId ?? 'unknown';
        invite.claimedAt = Date.now();
        if (!ws.members) ws.members = [];
        const existing = ws.members.find(m => m.deviceId === ctx.deviceId);
        if (existing) {
          existing.role = invite.role;
        } else {
          ws.members.push({
            deviceId:    ctx.deviceId ?? 'unknown',
            deviceLabel: ctx.deviceLabel,
            role:        invite.role,
            joinedAt:    Date.now(),
            addedBy:     invite.createdBy,
          });
        }
        ws.updatedAt = Date.now();
        store.setWorkspace(ws);
        _getAuditLedger().log('WORKSPACE_INVITE_CLAIMED', {
          metadata: { workspaceId: ws.id, workspaceName: ws.name, actor: ctx.deviceId ?? 'unknown', actorLabel: ctx.deviceLabel, role: invite.role, source: 'remote' },
        });
        _dispatchServer?.broadcastTaskEvent({ type: 'workspace:update', timestamp: Date.now() });
        return { workspace: ws };
      },

      async removeWorkspaceMember(targetDeviceId: string, ctx: RemoteActionContext): Promise<ActionResult> {
        const ws = store.getWorkspace();
        if (!ws) return { ok: false, error: 'No workspace' };
        if (!ctx.isAdmin && !_hasWorkspaceRole(ctx.deviceId, 'admin')) {
          return { ok: false, error: 'Only admins can remove members' };
        }
        if (targetDeviceId === ws.ownerId) return { ok: false, error: 'Cannot remove the workspace owner' };
        ws.members = (ws.members ?? []).filter(m => m.deviceId !== targetDeviceId);
        ws.updatedAt = Date.now();
        store.setWorkspace(ws);
        _getAuditLedger().log('WORKSPACE_MEMBER_REMOVED', {
          metadata: { workspaceId: ws.id, workspaceName: ws.name, actor: ctx.deviceId ?? 'desktop', actorRole: _getWorkspaceRole(ctx.deviceId) ?? 'owner', target: targetDeviceId, source: ctx.isAdmin ? 'desktop' : 'remote' },
        });
        _dispatchServer?.broadcastTaskEvent({ type: 'workspace:update', timestamp: Date.now() });
        return { ok: true };
      },

      async setWorkspaceMemberRole(targetDeviceId: string, role: WorkspaceRole, ctx: RemoteActionContext): Promise<ActionResult> {
        const ws = store.getWorkspace();
        if (!ws) return { ok: false, error: 'No workspace' };
        if (!ctx.isAdmin && !_hasWorkspaceRole(ctx.deviceId, 'admin')) {
          return { ok: false, error: 'Only admins can change roles' };
        }
        const member = ws.members.find(m => m.deviceId === targetDeviceId);
        if (!member) return { ok: false, error: 'Member not found' };
        const prevRole = member.role;
        member.role = role;
        ws.updatedAt = Date.now();
        store.setWorkspace(ws);
        _getAuditLedger().log('WORKSPACE_ROLE_CHANGED', {
          metadata: { workspaceId: ws.id, workspaceName: ws.name, actor: ctx.deviceId ?? 'desktop', actorRole: _getWorkspaceRole(ctx.deviceId) ?? 'owner', target: targetDeviceId, prevRole, newRole: role, source: ctx.isAdmin ? 'desktop' : 'remote' },
        });
        _dispatchServer?.broadcastTaskEvent({ type: 'workspace:update', timestamp: Date.now() });
        return { ok: true };
      },

      async updateWorkspacePolicy(patch: Partial<WorkspacePolicy>, ctx: RemoteActionContext): Promise<ActionResult> {
        const ws = store.getWorkspace();
        if (!ws) return { ok: false, error: 'No workspace' };
        if (!ctx.isAdmin && !_hasWorkspaceRole(ctx.deviceId, 'admin')) {
          return { ok: false, error: 'Only admins can update workspace policy' };
        }
        ws.policy = { ...ws.policy, ...patch };
        ws.updatedAt = Date.now();
        store.setWorkspace(ws);
        _getAuditLedger().log('WORKSPACE_POLICY_UPDATED', {
          metadata: { workspaceId: ws.id, workspaceName: ws.name, actor: ctx.deviceId ?? 'desktop', actorRole: _getWorkspaceRole(ctx.deviceId) ?? 'owner', patch, source: ctx.isAdmin ? 'desktop' : 'remote' },
        });
        _dispatchServer?.broadcastTaskEvent({ type: 'workspace:update', timestamp: Date.now() });
        return { ok: true };
      },

      // Phase 26 — thread sharing + collaboration
      async createThreadInvite(threadId: string, role: CollaboratorRole, ctx: RemoteActionContext): Promise<{ invite: ThreadInvite }> {
        const threads = store.getDispatchThreads();
        const thread  = threads.find(t => t.id === threadId);
        if (!thread) throw new Error('Thread not found');
        const callerRole = _getThreadRole(thread, ctx.deviceId);
        if (callerRole !== 'owner' && callerRole !== 'operator' && !ctx.isAdmin) {
          throw new Error('Only the thread owner or an operator can create invites');
        }
        if (!thread.invites) thread.invites = [];
        const invite: ThreadInvite = {
          code:      _generateInviteCode(),
          createdAt: Date.now(),
          expiresAt: Date.now() + 48 * 60 * 60 * 1000,
          createdBy: ctx.deviceId ?? 'admin',
          role,
          revoked:   false,
        };
        thread.invites.push(invite);
        _updateThread(thread);
        _getAuditLedger().log('THREAD_INVITE_CREATED', {
          metadata: { threadId, actor: ctx.deviceId ?? 'admin', actorRole: _getThreadRole(thread, ctx.deviceId) ?? 'owner', targetRole: role, workspaceId: store.getWorkspace()?.id, source: ctx.isAdmin ? 'desktop' : 'remote' },
        });
        return { invite };
      },

      async claimThreadInvite(code: string, ctx: RemoteActionContext): Promise<{ thread: DispatchThread }> {
        const threads = store.getDispatchThreads();
        for (const thread of threads) {
          const invite = (thread.invites ?? []).find(
            i => i.code === code && !i.revoked && !i.claimedBy && i.expiresAt > Date.now()
          );
          if (!invite) continue;
          invite.claimedBy = ctx.deviceId ?? 'unknown';
          invite.claimedAt = Date.now();
          if (!thread.collaborators) thread.collaborators = [];
          const existing = thread.collaborators.find(c => c.deviceId === ctx.deviceId);
          if (existing) {
            existing.role = invite.role;
          } else {
            thread.collaborators.push({
              deviceId:    ctx.deviceId ?? 'unknown',
              deviceLabel: ctx.deviceLabel,
              role:        invite.role,
              joinedAt:    Date.now(),
            });
          }
          if (!thread.visibility || thread.visibility === 'private') {
            thread.visibility = invite.role === 'operator' ? 'shared_approve' : 'shared_read';
          }
          _updateThread(thread);
          _getAuditLedger().log('THREAD_INVITE_CLAIMED', {
            metadata: { threadId: thread.id, actor: ctx.deviceId ?? 'unknown', actorLabel: ctx.deviceLabel, role: invite.role, workspaceId: store.getWorkspace()?.id, source: 'remote' },
          });
          _dispatchServer?.broadcastTaskEvent({
            type:          'thread:update',
            threadId:      thread.id,
            collaborators: thread.collaborators,
            timestamp:     Date.now(),
          });
          return { thread };
        }
        throw new Error('Invite code not found, expired, already claimed, or revoked');
      },

      async revokeCollaborator(threadId: string, targetDeviceId: string, ctx: RemoteActionContext): Promise<ActionResult> {
        const threads = store.getDispatchThreads();
        const thread  = threads.find(t => t.id === threadId);
        if (!thread) return { ok: false, error: 'Thread not found' };
        const callerRole = _getThreadRole(thread, ctx.deviceId);
        if (callerRole !== 'owner' && !ctx.isAdmin) return { ok: false, error: 'Only the thread owner can revoke collaborators' };
        thread.collaborators = (thread.collaborators ?? []).filter(c => c.deviceId !== targetDeviceId);
        for (const inv of thread.invites ?? []) {
          if (inv.claimedBy === targetDeviceId) inv.revoked = true;
        }
        _updateThread(thread);
        _getAuditLedger().log('THREAD_COLLAB_REMOVED', {
          metadata: { threadId, actor: ctx.deviceId ?? 'desktop', actorRole: _getThreadRole(thread, ctx.deviceId) ?? 'owner', target: targetDeviceId, workspaceId: store.getWorkspace()?.id, source: ctx.isAdmin ? 'desktop' : 'remote' },
        });
        _dispatchServer?.broadcastTaskEvent({
          type:          'thread:update',
          threadId:      thread.id,
          collaborators: thread.collaborators,
          timestamp:     Date.now(),
        });
        return { ok: true };
      },

      async listThreadComments(threadId: string, ctx: RemoteActionContext): Promise<ThreadComment[]> {
        const thread = store.getDispatchThreads().find(t => t.id === threadId);
        if (!thread) throw new Error('Thread not found');
        const role = _getThreadRole(thread, ctx.deviceId);
        if (!role && !ctx.isAdmin) throw new Error('No access to this thread');
        return thread.comments ?? [];
      },

      async addThreadComment(
        threadId: string,
        text: string,
        targetType: ThreadComment['targetType'],
        targetId: string,
        ctx: RemoteActionContext,
      ): Promise<ThreadComment> {
        const threads = store.getDispatchThreads();
        const thread  = threads.find(t => t.id === threadId);
        if (!thread) throw new Error('Thread not found');
        const role = _getThreadRole(thread, ctx.deviceId);
        if (!role && !ctx.isAdmin) throw new Error('No access to this thread');
        if (role === 'viewer') throw new Error('Viewers cannot add comments');
        if (!thread.comments) thread.comments = [];
        const comment: ThreadComment = {
          id:          `cmt:${Date.now()}:${Math.random().toString(36).slice(2, 6)}`,
          threadId,
          createdAt:   Date.now(),
          authorId:    ctx.deviceId ?? 'admin',
          authorLabel: ctx.deviceLabel,
          text,
          targetType,
          targetId,
        };
        thread.comments.push(comment);
        if (thread.comments.length > 100) thread.comments = thread.comments.slice(-100);
        _updateThread(thread);
        _getAuditLedger().log('THREAD_COMMENT_ADDED', {
          metadata: { threadId, commentId: comment.id, actor: ctx.deviceId ?? 'admin', actorRole: _getThreadRole(thread, ctx.deviceId) ?? 'owner', targetType, targetId, workspaceId: store.getWorkspace()?.id, source: ctx.isAdmin ? 'desktop' : 'remote' },
        });
        _dispatchServer?.broadcastTaskEvent({
          type:      'thread:update',
          threadId:  thread.id,
          comments:  thread.comments,
          timestamp: Date.now(),
        });
        return comment;
      },

      async deleteThreadComment(threadId: string, commentId: string, ctx: RemoteActionContext): Promise<ActionResult> {
        const threads = store.getDispatchThreads();
        const thread  = threads.find(t => t.id === threadId);
        if (!thread) return { ok: false, error: 'Thread not found' };
        const comment = (thread.comments ?? []).find(c => c.id === commentId);
        if (!comment) return { ok: false, error: 'Comment not found' };
        const isAuthor = comment.authorId === ctx.deviceId;
        const isOwner  = _getThreadRole(thread, ctx.deviceId) === 'owner';
        if (!isAuthor && !isOwner && !ctx.isAdmin) return { ok: false, error: 'Insufficient permissions' };
        thread.comments = (thread.comments ?? []).filter(c => c.id !== commentId);
        _updateThread(thread);
        _getAuditLedger().log('THREAD_COMMENT_DELETED', {
          metadata: { threadId, commentId, actor: ctx.deviceId ?? 'admin', actorRole: _getThreadRole(thread, ctx.deviceId) ?? 'owner', workspaceId: store.getWorkspace()?.id, source: ctx.isAdmin ? 'desktop' : 'remote' },
        });
        _dispatchServer?.broadcastTaskEvent({
          type:      'thread:update',
          threadId:  thread.id,
          comments:  thread.comments,
          timestamp: Date.now(),
        });
        return { ok: true };
      },

      async getThreadAttributions(threadId: string, ctx: RemoteActionContext): Promise<ApprovalAttribution[]> {
        const thread = store.getDispatchThreads().find(t => t.id === threadId);
        if (!thread) throw new Error('Thread not found');
        const role = _getThreadRole(thread, ctx.deviceId);
        if (!role && !ctx.isAdmin) throw new Error('No access to this thread');
        return thread.attributions ?? [];
      },

      recordThreadAttribution(threadId: string, partial: Omit<ApprovalAttribution, 'id' | 'threadId'>): void {
        const thread = store.getDispatchThreads().find(t => t.id === threadId);
        if (!thread) return;
        _recordAttribution(thread, partial);
      },

      // ── Phase 31 — Runbook handlers ───────────────────────────────────────────

      async listRunbooks(): Promise<DispatchRunbookItem[]> {
        const executions = store.getRunbookExecutions(200);
        return store.getRunbooks().map(rb => {
          const lastExec = executions.filter(e => e.runbookId === rb.id).sort((a, b) => b.startedAt - a.startedAt)[0];
          return {
            id:                  rb.id,
            title:               rb.title,
            description:         rb.description,
            trigger:             rb.trigger,
            enabled:             rb.enabled,
            incidentMode:        rb.incidentMode,
            linkedIntegrations:  rb.linkedIntegrations,
            allowedRunnerRoles:  rb.allowedRunnerRoles,
            lastExecutionStatus: lastExec?.status,
            lastExecutionAt:     lastExec?.startedAt,
            stepCount:           rb.steps.length,
            // Phase 35 — pack provenance
            version:             rb.version,
            packId:              rb.packId,
            packVersion:         rb.packVersion,
          };
        });
      },

      async runRunbook(id: string, ctx: RemoteActionContext, vars: Record<string, string> = {}): Promise<ActionResult & { executionId?: string }> {
        const def = store.getRunbook(id);
        if (!def) return { ok: false, error: 'Runbook not found' };
        if (!def.enabled) return { ok: false, error: 'Runbook is disabled' };
        // Automation gate check — runbook treated as recipe:run category
        const policyCheck = _getPolicyEngine().canApprove(ctx.deviceId ?? null, 'recipe:run', ctx.isAdmin);
        if (!policyCheck.allowed) {
          _getAuditLedger().log('WS_APPROVAL_DENIED', {
            metadata: { runbookId: id, category: 'recipe:run', actorId: ctx.deviceId, reason: policyCheck.reason, workspaceId: store.getWorkspace()?.id },
          });
          return { ok: false, error: `Workspace policy denied: ${policyCheck.reason}` };
        }
        try {
          const exec = await _buildRunbookExecutor().run(def, ctx.deviceId, ctx.deviceLabel ?? null, true, vars);
          return { ok: exec.status !== 'failed', executionId: exec.id, error: exec.error };
        } catch (e: unknown) {
          return { ok: false, error: e instanceof Error ? e.message : String(e) };
        }
      },

      async getRunbookExecution(executionId: string): Promise<DispatchRunbookExecution | null> {
        const all  = store.getRunbookExecutions(200);
        const exec = all.find(e => e.id === executionId);
        if (!exec) return null;
        return {
          id:               exec.id,
          runbookId:        exec.runbookId,
          runbookTitle:     exec.runbookTitle,
          status:           exec.status,
          startedAt:        exec.startedAt,
          completedAt:      exec.completedAt,
          actorId:          exec.actorId,
          isIncident:       exec.isIncident,
          currentStepIdx:   exec.currentStepIdx,
          currentStepId:    exec.currentStepId,
          steps:            exec.steps,
          error:            exec.error,
          pausedAtStepIdx:  exec.pausedAtStepIdx,
          pausedReason:     exec.pausedReason,
          pauseTokenId:     exec.pauseTokenId,
          pausedAt:         exec.pausedAt,
          deadlineAt:       exec.deadlineAt,
          escalatedAt:      exec.escalatedAt,
          escalationCount:  exec.escalationCount,
          branchDecisions:  exec.branchDecisions,
          // Phase 35 — pack provenance
          packId:           exec.packId,
          packVersion:      exec.packVersion,
        };
      },

      getIncidentMode() {
        const s = store.getIncidentMode();
        return { active: s.active, activatedAt: s.activatedAt, reason: s.reason };
      },

      // Phase 32/33 — Handoff queue (Dispatch surface)
      async listHandoffItems(): Promise<DispatchHandoffItem[]> {
        const now = Date.now();
        return store.getHandoffQueue()
          .filter(h => h.status === 'pending')
          .map(h => {
            const overdue          = !!(h.expiresAt && now >= h.expiresAt);
            const msRemaining      = h.expiresAt ? h.expiresAt - now : undefined;
            const minutesRemaining = msRemaining !== undefined ? Math.round(msRemaining / 60000) : undefined;
            return {
              id:               h.id,
              executionId:      h.executionId,
              runbookId:        h.runbookId,
              runbookTitle:     h.runbookTitle,
              stepId:           h.stepId,
              stepLabel:        h.stepLabel,
              type:             h.type,
              status:           h.status,
              blockedReason:    h.blockedReason,
              actorNeeded:      h.actorNeeded,
              isIncident:       h.isIncident,
              createdAt:        h.createdAt,
              expiresAt:        h.expiresAt,
              escalateAt:       h.escalateAt,
              escalatedAt:      h.escalatedAt,
              escalationCount:  h.escalationCount,
              overdue,
              minutesRemaining,
              hasTimeout:       !!h.expiresAt,
              hasEscalation:    !!h.escalateAt,
              onRejection:      h.onRejection,
              onTimeout:        h.onTimeout,
            };
          });
      },

      async resolveHandoffItem(id: string, resolution: string, ctx: RemoteActionContext): Promise<{ ok: boolean; error?: string }> {
        const queue = store.getHandoffQueue();
        const handoff = queue.find(h => h.id === id);
        if (!handoff) return { ok: false, error: 'Handoff item not found' };
        if (handoff.status !== 'pending') return { ok: false, error: 'Handoff item already resolved' };
        // Resolve in store
        store.resolveHandoffItem(id, resolution, ctx.deviceId ?? undefined);
        // Resume or reject the execution
        const exec = await _buildRunbookExecutor().resumeExecution(
          handoff.executionId,
          ctx.deviceId,
          ctx.deviceLabel,
          resolution,
        );
        if (!exec) return { ok: false, error: 'Execution not found' };
        _getAuditLedger().log('HANDOFF_RESOLVED', {
          metadata: { handoffId: id, executionId: handoff.executionId, resolution, actorId: ctx.deviceId, isIncident: handoff.isIncident },
        });
        return { ok: true };
      },

      async createTask(params: DispatchTaskParams, ctx: RemoteActionContext): Promise<DispatchTask> {
        const id   = `task:${Date.now()}:${Math.random().toString(36).slice(2, 7)}`;
        const now  = Date.now();
        const task: DispatchTask = {
          id,
          createdAt:   now,
          updatedAt:   now,
          goal:        params.goal,
          category:    params.category,
          status:      'queued',
          ctx:         params.ctx ?? {},
          deviceLabel: ctx.deviceLabel,
        };
        _updateDispatchTask(task);
        // Phase 25 — create a thread for this task
        const thread = _createThreadForTask(task, params, ctx);
        task.threadId = thread.id;
        _updateDispatchTask(task);
        // Execute asynchronously — don't await so HTTP responds immediately
        _executeDispatchTask(task, params).catch(() => { /* errors stored on task */ });
        return task;
      },
    };
  }

  /** Persist a task (upsert by id). */
  function _updateDispatchTask(task: DispatchTask): void {
    const tasks = store.getDispatchTasks();
    const idx   = tasks.findIndex(t => t.id === task.id);
    if (idx >= 0) tasks[idx] = task;
    else tasks.push(task);
    store.setDispatchTasks(tasks);
  }

  // ── Phase 25 — Thread helpers ───────────────────────────────────────────────

  function _updateThread(thread: DispatchThread): void {
    const threads = store.getDispatchThreads();
    const idx = threads.findIndex(t => t.id === thread.id);
    if (idx >= 0) threads[idx] = thread;
    else threads.push(thread);
    store.setDispatchThreads(threads);
  }

  function _appendThreadMessage(
    thread: DispatchThread,
    partial: Omit<DispatchMessage, 'id' | 'threadId' | 'createdAt'>,
  ): DispatchMessage {
    const message: DispatchMessage = {
      id:        `msg:${Date.now()}:${Math.random().toString(36).slice(2, 6)}`,
      threadId:  thread.id,
      createdAt: Date.now(),
      ...partial,
    };
    thread.messages.push(message);
    thread.updatedAt = Date.now();
    _updateThread(thread);
    _dispatchServer?.broadcastTaskEvent({
      type:      'thread:message',
      threadId:  thread.id,
      message,
      timestamp: Date.now(),
    });
    return message;
  }

  function _getTaskThread(task: DispatchTask): DispatchThread | null {
    if (!task.threadId) return null;
    return store.getDispatchThreads().find(t => t.id === task.threadId) ?? null;
  }

  function _appendTaskResultToThread(task: DispatchTask): void {
    if (!task.threadId || !task.result) return;
    const thread = _getTaskThread(task);
    if (!thread) return;
    _appendThreadMessage(thread, { role: 'assistant', text: task.result, taskId: task.id });
    thread.status = 'active'; // stays open for follow-ups
    _updateThread(thread);
  }

  function _appendTaskErrorToThread(task: DispatchTask, errorText: string): void {
    if (!task.threadId) return;
    const thread = _getTaskThread(task);
    if (!thread) return;
    _appendThreadMessage(thread, { role: 'system', text: `Task failed: ${errorText}`, taskId: task.id });
    thread.status = 'active'; // allow retry follow-ups
    _updateThread(thread);
  }

  function _createThreadForTask(task: DispatchTask, params: DispatchTaskParams, ctx: RemoteActionContext): DispatchThread {
    const thread: DispatchThread = {
      id:           `thr:${Date.now()}:${Math.random().toString(36).slice(2, 6)}`,
      createdAt:    Date.now(),
      updatedAt:    Date.now(),
      title:        params.goal.slice(0, 80),
      status:       'active',
      taskIds:      [task.id],
      artifactIds:  [],
      bundleIds:    [],
      messages:     [],
      ctx:          params.ctx ?? {},
      deviceLabel:  ctx.deviceLabel,
      // Phase 26 — collaboration
      owner:        ctx.deviceId ?? undefined,
      visibility:   'private',
      collaborators: [],
      invites:      [],
      comments:     [],
      attributions: [],
    };
    // First message = user's request
    thread.messages.push({
      id:        `msg:${Date.now()}:${Math.random().toString(36).slice(2, 6)}`,
      threadId:  thread.id,
      createdAt: Date.now(),
      role:      'user',
      text:      params.goal,
      taskId:    task.id,
    });
    _updateThread(thread);
    return thread;
  }

  // ── Phase 27 — Workspace permission helpers ───────────────────────────────────

  function _getWorkspaceRole(deviceId: string | null): WorkspaceRole | null {
    if (!deviceId) return null;
    const ws = store.getWorkspace();
    if (!ws) return null;
    if (ws.ownerId === deviceId) return 'owner';
    return ws.members.find(m => m.deviceId === deviceId)?.role ?? null;
  }

  function _hasWorkspaceRole(deviceId: string | null, minRole: WorkspaceRole): boolean {
    const role = _getWorkspaceRole(deviceId);
    if (!role) return false;
    return WORKSPACE_ROLE_RANK[role] >= WORKSPACE_ROLE_RANK[minRole];
  }

  function _ensureWorkspace(name = 'My Workspace', ownerId = 'desktop'): Workspace {
    const existing = store.getWorkspace();
    if (existing) return existing;
    const ws: Workspace = {
      id:        `ws:${Date.now()}`,
      name,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ownerId,
      members:   [],
      invites:   [],
      policy:    { ...DEFAULT_WORKSPACE_POLICY },
    };
    store.setWorkspace(ws);
    _getAuditLedger().log('WORKSPACE_CREATED', {
      metadata: { workspaceId: ws.id, workspaceName: ws.name, ownerId, source: 'desktop' },
    });
    return ws;
  }

  // ── Phase 26 — Collaboration helpers ─────────────────────────────────────────

  function _getThreadRole(
    thread: DispatchThread,
    deviceId: string | null,
  ): CollaboratorRole | 'owner' | null {
    if (!deviceId) return null;
    if (thread.owner === deviceId) return 'owner';
    const collab = (thread.collaborators ?? []).find(c => c.deviceId === deviceId);
    return collab?.role ?? null;
  }

  function _generateInviteCode(): string {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no O/0, I/1 ambiguity
    return Array.from({ length: 8 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
  }

  function _recordAttribution(
    thread: DispatchThread,
    partial: Omit<ApprovalAttribution, 'id' | 'threadId'>,
  ): void {
    if (!thread.attributions) thread.attributions = [];
    const attr: ApprovalAttribution = {
      id:       `attr:${Date.now()}:${Math.random().toString(36).slice(2, 6)}`,
      threadId: thread.id,
      ...partial,
    };
    thread.attributions.push(attr);
    if (thread.attributions.length > 100) thread.attributions = thread.attributions.slice(-100);
    _updateThread(thread);
    _getAuditLedger().log('THREAD_ATTRIBUTION_RECORDED', {
      metadata: { threadId: thread.id, attributionId: attr.id, action: partial.action, actor: partial.actorId, actorRole: (partial as unknown as { actorRole?: string }).actorRole, workspaceId: store.getWorkspace()?.id },
    });
    _dispatchServer?.broadcastTaskEvent({
      type:         'thread:update',
      threadId:     thread.id,
      attributions: thread.attributions,
      timestamp:    Date.now(),
    });
  }

  /** Phase 22 — append a step to task.timeline, persist, and broadcast SSE event. */
  function _emitTaskStep(task: DispatchTask, label: string, opts?: { done?: boolean; partial?: string }): void {
    if (!task.timeline) task.timeline = [];
    // Mark previous in-progress step as done
    const prev = task.timeline[task.timeline.length - 1];
    if (prev && prev.done === undefined) prev.done = true;
    task.timeline.push({ ts: Date.now(), label, done: opts?.done });
    task.currentStep  = label;
    task.lastActivity = Date.now();
    if (opts?.partial !== undefined) task.partialOutput = opts.partial;
    _updateDispatchTask(task);
    const event: DispatchTaskEvent = {
      type:      opts?.done === false ? 'task:error' : (opts?.done === true ? 'task:done' : 'task:step'),
      taskId:    task.id,
      step:      label,
      partial:   opts?.partial,
      status:    task.status,
      timeline:  task.timeline,
      timestamp: Date.now(),
    };
    _dispatchServer?.broadcastTaskEvent(event);
  }

  /** Execute a dispatch task based on its category.
   *  - informational → AI chat answer (no side effects)
   *  - recipe        → run matching recipe by name-substring
   *  - mission       → run matching mission by name-substring
   *  - write         → queue as waiting_approval; desktop must confirm
   */
  async function _executeDispatchTask(task: DispatchTask, params: DispatchTaskParams): Promise<void> {
    const update = (patch: Partial<DispatchTask>) => {
      Object.assign(task, patch, { updatedAt: Date.now() });
      _updateDispatchTask(task);
    };

    const step = (label: string, done?: boolean, partial?: string) =>
      _emitTaskStep(task, label, { done, partial });

    update({ status: 'running', timeline: [] });
    step('Initializing');

    try {
      if (params.category === 'informational') {
        step('Resolving context');
        if (!providerManager) providerManager = new ProviderManager(store);
        const providers = await providerManager.getActiveProviders();
        if (providers.length === 0) {
          step('No AI provider configured', false);
          update({ status: 'error', error: 'No AI provider configured' });
          return;
        }
        const sysPrompt = await buildSystemPrompt(store);
        const contextParts: string[] = [];
        if (task.ctx.repo)    contextParts.push(`Repo: ${task.ctx.repo}`);
        if (task.ctx.project) contextParts.push(`Project: ${task.ctx.project}`);
        if (task.ctx.channel) contextParts.push(`Channel: ${task.ctx.channel}`);
        if (task.ctx.target)  contextParts.push(`Target: ${task.ctx.target}`);
        const userMsg = contextParts.length > 0
          ? `Context: ${contextParts.join(', ')}\n\nTask: ${params.goal}`
          : params.goal;
        step(`Querying ${providers[0].name ?? 'AI'}…`);
        const result = await providers[0].chat([
          { role: 'system', content: sysPrompt },
          { role: 'user',   content: userMsg   },
        ]);
        step('Done', true);
        update({ status: 'done', result });
        _dispatchServer?.broadcastTaskEvent({ type: 'task:done', taskId: task.id, status: 'done', timeline: task.timeline, timestamp: Date.now() });
        _appendTaskResultToThread(task);
        _createTaskArtifacts(task);
        return;
      }

      if (params.category === 'recipe') {
        step('Matching recipe');
        const recipes = BUILTIN_RECIPES.filter(r =>
          r.name.toLowerCase().includes(params.goal.toLowerCase()) ||
          r.id.toLowerCase().includes(params.goal.toLowerCase()),
        );
        if (recipes.length === 0) {
          step(`No recipe matches "${params.goal}"`, false);
          update({ status: 'error', error: `No recipe matches "${params.goal}"` });
          return;
        }
        step(`Running "${recipes[0].name}"`);
        const r = await _executeRecipe(recipes[0].id, { source: `dispatch_task:${task.id}` });
        if (r.ok) {
          step('Done', true);
          update({ status: 'done', result: `Recipe "${recipes[0].name}" executed successfully` });
          _dispatchServer?.broadcastTaskEvent({ type: 'task:done', taskId: task.id, status: 'done', timeline: task.timeline, timestamp: Date.now() });
        _appendTaskResultToThread(task);
        _createTaskArtifacts(task);
        } else {
          step(r.error ?? 'Recipe failed', false);
          update({ status: 'error', error: r.error ?? 'Recipe failed' });
        }
        return;
      }

      if (params.category === 'mission') {
        step('Matching mission');
        const defs = _getMissionStore().load();
        const match = defs.find(m =>
          m.name.toLowerCase().includes(params.goal.toLowerCase()) ||
          m.id.toLowerCase().includes(params.goal.toLowerCase()),
        );
        if (!match) {
          step(`No mission matches "${params.goal}"`, false);
          update({ status: 'error', error: `No mission matches "${params.goal}"` });
          return;
        }
        step(`Starting mission "${match.name}"`);
        await _getMissionManager(store).runMission(match.id);
        step('Mission started', true);
        update({ status: 'done', result: `Mission "${match.name}" started` });
        _dispatchServer?.broadcastTaskEvent({ type: 'task:done', taskId: task.id, status: 'done', timeline: task.timeline, timestamp: Date.now() });
        _appendTaskResultToThread(task);
        _createTaskArtifacts(task);
        return;
      }

      if (params.category === 'write') {
        const policy = store.getRemoteApprovePolicy();
        if (policy.requireDesktopConfirm) {
          step('Awaiting desktop approval');
          const { generateConfirmationId } = await import('./dispatchSession.js');
          const confId = generateConfirmationId();
          _pendingConfirmations.set(confId, {
            id:          confId,
            itemId:      task.id,
            action:      task.goal,
            verb:        'approve',
            deviceId:    'remote',
            deviceLabel: 'Remote Task',
            clientIp:    '',
            createdAt:   Date.now(),
            status:      'pending',
          });
          for (const win of BrowserWindow.getAllWindows()) {
            if (!win.isDestroyed()) win.webContents.send('dispatch:confirm-request', {
              confirmId: confId, label: task.goal, source: 'remote-task',
            });
          }
          update({ status: 'waiting_approval', confirmId: confId });
          const deadline = Date.now() + 5 * 60 * 1000;
          while (Date.now() < deadline) {
            await new Promise(r => setTimeout(r, 3000));
            const conf = _pendingConfirmations.get(confId);
            if (conf?.status === 'approved') { update({ status: 'running' }); step('Approved — executing'); break; }
            if (conf?.status === 'denied')   { step('Denied by desktop', false); update({ status: 'error', error: 'Denied by desktop' }); return; }
          }
          if (task.status !== 'running') {
            step('Approval timed out', false);
            update({ status: 'error', error: 'Desktop confirmation timed out' });
            return;
          }
        }
        step('Resolving context');
        if (!providerManager) providerManager = new ProviderManager(store);
        const providers = await providerManager.getActiveProviders();
        if (providers.length === 0) {
          step('No AI provider configured', false);
          update({ status: 'error', error: 'No AI provider configured' });
          return;
        }
        step(`Executing via ${providers[0].name ?? 'AI'}…`);
        const sysPrompt = buildSystemPrompt(store);
        const result = await providers[0].chat([
          { role: 'system', content: `${sysPrompt}\n\nYou are executing a write-category remote task. Be concise and confirm what was done.` },
          { role: 'user',   content: params.goal },
        ]);
        step('Done', true);
        update({ status: 'done', result });
        _dispatchServer?.broadcastTaskEvent({ type: 'task:done', taskId: task.id, status: 'done', timeline: task.timeline, timestamp: Date.now() });
        _appendTaskResultToThread(task);
        _createTaskArtifacts(task);
        return;
      }

      step(`Unknown category: ${params.category}`, false);
      update({ status: 'error', error: `Unknown category: ${params.category}` });
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      step(msg, false);
      update({ status: 'error', error: msg });
      _dispatchServer?.broadcastTaskEvent({ type: 'task:error', taskId: task.id, status: 'error', timeline: task.timeline, timestamp: Date.now() });
      _appendTaskErrorToThread(task, msg);
    }
  }

  /** Phase 23 — build and persist artifacts from a completed task. */
  function _createTaskArtifacts(task: DispatchTask): void {
    if (!task.result) return;
    const now  = Date.now();
    const arts: DispatchArtifact[] = [];
    const uid  = () => `art:${Date.now()}:${Math.random().toString(36).slice(2, 6)}`;
    const mk = (type: ArtifactType, title: string, content: string, meta?: DispatchArtifact['meta']): DispatchArtifact => ({
      id:        uid(),
      taskId:    task.id,
      threadId:  task.threadId,
      createdAt: now,
      type,
      title:     title.slice(0, 100),
      preview:   content.slice(0, 200),
      content,
      meta,
    });

    if (task.category === 'informational') {
      arts.push(mk('report', `Report: ${task.goal.slice(0, 60)}`, task.result));
      if (task.ctx.channel) {
        const digest = `*${task.goal}*\n\n${task.result.slice(0, 800)}`;
        arts.push(mk('draft_slack', `Slack: ${task.ctx.channel}`, digest, { channel: task.ctx.channel, status: 'draft' }));
      }
      if (task.ctx.project) {
        arts.push(mk('draft_jira', `Jira note: ${task.ctx.project}`, `h3. ${task.goal}\n\n${task.result}`, { projectKey: task.ctx.project, status: 'draft' }));
      }
    } else if (task.category === 'recipe') {
      arts.push(mk('result_summary', `Recipe result: ${task.goal.slice(0, 60)}`, task.result));
    } else if (task.category === 'mission') {
      arts.push(mk('launch_summary', `Mission: ${task.goal.slice(0, 60)}`, task.result));
    } else if (task.category === 'write') {
      arts.push(mk('result_summary', `Write result: ${task.goal.slice(0, 60)}`, task.result, { status: 'sent' }));
    }

    if (arts.length === 0) return;
    const all = store.getDispatchArtifacts();
    all.push(...arts);
    store.setDispatchArtifacts(all);

    task.artifactIds = [...(task.artifactIds ?? []), ...arts.map(a => a.id)];
    _updateDispatchTask(task);

    // Broadcast artifact-available step
    _emitTaskStep(task, `${arts.length} artifact${arts.length > 1 ? 's' : ''} created`, { done: true });

    // Phase 25 — add artifacts to thread
    if (task.threadId) {
      const thread = _getTaskThread(task);
      if (thread) {
        for (const art of arts) {
          thread.artifactIds.push(art.id);
          _appendThreadMessage(thread, { role: 'system', text: `Artifact ready: ${art.title}`, artifactId: art.id, taskId: task.id });
        }
      }
    }

    // Phase 24 — group artifacts into a bundle
    _createTaskBundle(task, arts);
  }

  /** Phase 24 — group artifacts from a completed task into a single governed bundle. */
  function _createTaskBundle(task: DispatchTask, arts: DispatchArtifact[]): void {
    if (arts.length === 0) return;
    const policy = store.getRemoteApprovePolicy();
    const DRAFT_TYPES: ArtifactType[] = ['draft_slack', 'draft_jira', 'draft_linear', 'draft_github'];
    const sendable = arts.filter(a => DRAFT_TYPES.includes(a.type));
    const safe     = sendable.filter(a => a.meta?.status !== 'sent');

    // Build destination list
    const dests: BundleDestination[] = [];
    for (const a of arts) {
      if (a.type === 'draft_slack'  && a.meta?.channel)    dests.push({ system: 'slack',  label: a.meta.channel });
      if (a.type === 'draft_jira'   && a.meta?.projectKey) dests.push({ system: 'jira',   label: a.meta.projectKey });
      if (a.type === 'draft_linear' && a.meta?.teamId)     dests.push({ system: 'linear', label: a.meta.teamId });
      if (a.type === 'draft_github' && a.meta?.repoOwner)  dests.push({ system: 'github', label: `${a.meta.repoOwner}/${a.meta.repoName ?? ''}` });
    }

    const needsApproval       = sendable.length > 0;
    const needsDesktopConfirm = policy.requireDesktopConfirm && sendable.length > 0;
    const safeCount = safe.length;
    const policySummary = sendable.length === 0
      ? `${arts.length} read-only artifact${arts.length > 1 ? 's' : ''}`
      : needsDesktopConfirm
        ? `${safeCount} safe · desktop confirm required`
        : `${safeCount} ready to send · ${arts.length - safeCount} read-only`;

    const bundle: DispatchArtifactBundle = {
      id:          `bnd:${Date.now()}:${Math.random().toString(36).slice(2, 6)}`,
      taskId:      task.id,
      threadId:    task.threadId,
      createdAt:   Date.now(),
      title:       `Bundle: ${task.goal.slice(0, 70)}`,
      artifactIds: arts.map(a => a.id),
      destinations: dests,
      status:      sendable.length === 0 ? 'sent' : 'pending',
      needsApproval,
      needsDesktopConfirm,
      policySummary,
      sentCount:   arts.filter(a => a.meta?.status === 'sent').length,
      totalCount:  arts.length,
    };

    const all = store.getDispatchBundles();
    all.push(bundle);
    store.setDispatchBundles(all);

    task.bundleIds = [...(task.bundleIds ?? []), bundle.id];
    _updateDispatchTask(task);

    // Phase 25 — add bundle to thread
    if (task.threadId) {
      const thread = _getTaskThread(task);
      if (thread) {
        thread.bundleIds.push(bundle.id);
        _appendThreadMessage(thread, { role: 'system', text: `Bundle ready: ${bundle.title} · ${bundle.policySummary}`, bundleId: bundle.id, taskId: task.id });
      }
    }
  }

  /** Phase 23 — send a draft artifact to its target system. */
  async function _sendArtifact(artifact: DispatchArtifact, ctx: RemoteActionContext): Promise<ActionResult> {
    try {
      if (artifact.type === 'draft_slack') {
        const channel = artifact.meta?.channel;
        if (!channel) return { ok: false, error: 'No Slack channel in artifact metadata' };
        if (!_slackAdapter?.isRunning()) return { ok: false, error: 'Slack not connected' };
        const ok = await _slackAdapter.postMessage(channel, artifact.content);
        if (!ok) return { ok: false, error: 'Slack postMessage failed' };
        // Mark sent
        const all = store.getDispatchArtifacts();
        const idx = all.findIndex(a => a.id === artifact.id);
        if (idx >= 0) { all[idx] = { ...all[idx], meta: { ...all[idx].meta, status: 'sent' } }; store.setDispatchArtifacts(all); }
        _getAuditLedger().log('SYSTEM_EVENT' as any, { metadata: { action: 'artifact_sent', artifactId: artifact.id, type: artifact.type, channel, via: ctx.deviceId ?? 'admin' } });
        return { ok: true };
      }

      if (artifact.type === 'draft_jira') {
        const adapter = await _buildJiraAdapter();
        if (!adapter) return { ok: false, error: 'Jira not configured' };
        const issueKey = artifact.meta?.issueKey;
        if (issueKey) {
          await adapter.addComment(issueKey, artifact.content);
        } else {
          const projectKey = artifact.meta?.projectKey;
          if (!projectKey) return { ok: false, error: 'No Jira issue key or project key in artifact metadata' };
          await adapter.createIssue(projectKey, '10001', artifact.title, artifact.content);
        }
        const all = store.getDispatchArtifacts();
        const idx = all.findIndex(a => a.id === artifact.id);
        if (idx >= 0) { all[idx] = { ...all[idx], meta: { ...all[idx].meta, status: 'sent' } }; store.setDispatchArtifacts(all); }
        _getAuditLedger().log('SYSTEM_EVENT' as any, { metadata: { action: 'artifact_sent', artifactId: artifact.id, type: artifact.type, via: ctx.deviceId ?? 'admin' } });
        return { ok: true };
      }

      if (artifact.type === 'draft_linear') {
        const adapter = await _buildLinearAdapter();
        if (!adapter) return { ok: false, error: 'Linear not configured' };
        const issueId = artifact.meta?.issueId;
        const teamId  = artifact.meta?.teamId;
        if (issueId) {
          await adapter.createComment(issueId, artifact.content);
        } else if (teamId) {
          await adapter.createIssue({ teamId, title: artifact.title, description: artifact.content });
        } else {
          return { ok: false, error: 'No Linear issue ID or team ID in artifact metadata' };
        }
        const all = store.getDispatchArtifacts();
        const idx = all.findIndex(a => a.id === artifact.id);
        if (idx >= 0) { all[idx] = { ...all[idx], meta: { ...all[idx].meta, status: 'sent' } }; store.setDispatchArtifacts(all); }
        _getAuditLedger().log('SYSTEM_EVENT' as any, { metadata: { action: 'artifact_sent', artifactId: artifact.id, type: artifact.type, via: ctx.deviceId ?? 'admin' } });
        return { ok: true };
      }

      if (artifact.type === 'draft_github') {
        const owner = artifact.meta?.repoOwner;
        const repo  = artifact.meta?.repoName;
        const prNum = artifact.meta?.prNumber;
        if (!owner || !repo) return { ok: false, error: 'No GitHub repo in artifact metadata' };
        const pat = await _getGitHubPat().catch(() => null);
        if (!pat) return { ok: false, error: 'GitHub PAT not configured' };
        if (prNum) {
          await githubAdapter.postComment(pat, owner, repo, prNum, artifact.content);
        } else {
          return { ok: false, error: 'No PR number in artifact metadata — open from desktop to select a PR' };
        }
        const all = store.getDispatchArtifacts();
        const idx = all.findIndex(a => a.id === artifact.id);
        if (idx >= 0) { all[idx] = { ...all[idx], meta: { ...all[idx].meta, status: 'sent' } }; store.setDispatchArtifacts(all); }
        _getAuditLedger().log('SYSTEM_EVENT' as any, { metadata: { action: 'artifact_sent', artifactId: artifact.id, type: artifact.type, repo: `${owner}/${repo}`, pr: prNum, via: ctx.deviceId ?? 'admin' } });
        return { ok: true };
      }

      return { ok: false, error: `Artifact type '${artifact.type}' does not support remote send` };
    } catch (e: unknown) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  }

  function _getDispatchServer(): DispatchServer {
    if (!_dispatchServer) {
      _dispatchServer = new DispatchServer(store.getDispatchPort(), _buildDispatchHandlers());
    }
    return _dispatchServer;
  }

  // ── Phase 17+18: Dispatch IPC handlers ───────────────────────────────────────

  // dispatch:status — current server state + device count + policy
  ipcMain.handle('dispatch:status', async () => {
    const token   = await _getCredentialManager(store).get('dispatch_token');
    const devices = store.getPairedDevices();
    const policy  = store.getRemoteApprovePolicy();
    return {
      enabled:         store.getDispatchEnabled(),
      running:         _dispatchServer?.isRunning ?? false,
      port:            store.getDispatchPort(),
      hasToken:        !!(token && token.length > 0),
      networkMode:     store.getDispatchNetworkMode(),
      deviceCount:     devices.length,
      policy,
      startedAt:       _dispatchServer?.startedAt ?? null,
      publicUrl:       store.getDispatchPublicUrl(),
      // backward compat
      allowRemoteApprove: policy.enabled,
    };
  });

  // dispatch:enable — start server (requires master token to exist)
  ipcMain.handle('dispatch:enable', async (_e, port?: number) => {
    if (port) store.setDispatchPort(port);
    const token = await _getCredentialManager(store).get('dispatch_token');
    if (!token) return { ok: false, error: 'Generate a master token first' };
    store.setDispatchEnabled(true);
    if (_dispatchServer) { await _dispatchServer.stop(); _dispatchServer = null; }
    _dispatchServer = new DispatchServer(store.getDispatchPort(), _buildDispatchHandlers());
    await _dispatchServer.start();
    return { ok: true, port: _dispatchServer.port };
  });

  // dispatch:disable — stop server
  ipcMain.handle('dispatch:disable', async () => {
    store.setDispatchEnabled(false);
    if (_dispatchServer) { await _dispatchServer.stop(); _dispatchServer = null; }
    return { ok: true };
  });

  // dispatch:generateToken — generate master token (stored encrypted, not shown after)
  ipcMain.handle('dispatch:generateToken', async () => {
    const token = generateDispatchToken();
    await _getCredentialManager(store).set('dispatch_token', token);
    if (_dispatchServer?.isRunning) {
      // Restart server so new token takes effect immediately
      await _dispatchServer.stop();
      _dispatchServer = new DispatchServer(store.getDispatchPort(), _buildDispatchHandlers());
      await _dispatchServer.start();
    }
    // Return token once for the user to note — not stored in renderer
    return { ok: true, token };
  });

  // dispatch:revokeToken — revoke master token and stop server (all devices also lose access)
  ipcMain.handle('dispatch:revokeToken', async () => {
    await _getCredentialManager(store).delete('dispatch_token');
    store.setPairedDevices([]);         // all sessions invalidated
    store.setActivePairingCode(null);
    if (_dispatchServer) { await _dispatchServer.stop(); _dispatchServer = null; }
    store.setDispatchEnabled(false);
    return { ok: true };
  });

  // dispatch:getToken — retrieve master token for admin use (shown once or via this call)
  ipcMain.handle('dispatch:getToken', async () => {
    const token = await _getCredentialManager(store).get('dispatch_token');
    return token ?? null;
  });

  // dispatch:setNetworkMode — restrict which IPs can reach the server
  ipcMain.handle('dispatch:setNetworkMode', (_e, mode: string) => {
    if (!['local', 'lan', 'remote'].includes(mode)) return { ok: false, error: 'Invalid mode' };
    store.setDispatchNetworkMode(mode as any);
    return { ok: true };
  });

  // dispatch:setApprovePolicy — granular remote-approve controls
  ipcMain.handle('dispatch:setApprovePolicy', (_e, policy: { enabled?: boolean; maxRisk?: string; requireDesktopConfirm?: boolean }) => {
    const current = store.getRemoteApprovePolicy();
    store.setRemoteApprovePolicy({
      enabled:              policy.enabled              ?? current.enabled,
      maxRisk:              (policy.maxRisk as any)    ?? current.maxRisk,
      requireDesktopConfirm: policy.requireDesktopConfirm ?? current.requireDesktopConfirm,
    });
    return { ok: true };
  });

  // dispatch:setAllowRemoteApprove — backward-compat shim
  ipcMain.handle('dispatch:setAllowRemoteApprove', (_e, allow: boolean) => {
    store.setDispatchAllowRemoteApprove(allow);
    return { ok: true };
  });

  // dispatch:setSessionTtl — session lifetime in minutes
  ipcMain.handle('dispatch:setSessionTtl', (_e, minutes: number) => {
    if (minutes < 1 || minutes > 525600) return { ok: false, error: 'Invalid TTL' };
    store.setDispatchSessionTtlMinutes(minutes);
    return { ok: true };
  });

  // ── Phase 18: Pairing ──────────────────────────────────────────────────────

  // dispatch:generatePairingCode — create a 6-digit code + QR
  ipcMain.handle('dispatch:generatePairingCode', async () => {
    if (!_dispatchServer?.isRunning) return { ok: false, error: 'Dispatch server not running' };
    const code = generatePairingCode();
    store.setActivePairingCode(code);
    const port = store.getDispatchPort();
    // Resolve LAN IP so phones on the same Wi-Fi can reach the server
    let lanIp = 'localhost';
    try {
      const ifaces = os.networkInterfaces();
      for (const name of Object.keys(ifaces)) {
        for (const iface of (ifaces[name] ?? [])) {
          if (iface.family === 'IPv4' && !iface.internal) { lanIp = iface.address; break; }
        }
        if (lanIp !== 'localhost') break;
      }
    } catch { /* fall back to localhost */ }
    const pairUrl = `http://${lanIp}:${port}/dispatch/pair-page`;
    let qrDataUrl: string | null = null;
    try { qrDataUrl = await generateQrDataUrl(pairUrl); } catch { /* skip QR if error */ }
    return { ok: true, code: code.code, expiresAt: code.expiresAt, pairUrl, qrDataUrl };
  });

  // dispatch:getPairingCode — get current pairing code (for UI refresh)
  ipcMain.handle('dispatch:getPairingCode', () => {
    const pc = store.getActivePairingCode();
    if (!pc || pc.used || Date.now() > pc.expiresAt) return null;
    return { code: pc.code, expiresAt: pc.expiresAt };
  });

  // ── Phase 18: Device management ───────────────────────────────────────────

  // dispatch:listDevices — safe view of paired devices (no session tokens)
  ipcMain.handle('dispatch:listDevices', () => {
    return store.getPairedDevices().map(toDeviceView);
  });

  // dispatch:revokeDevice — revoke a single device session
  ipcMain.handle('dispatch:revokeDevice', (_e, deviceId: string) => {
    const devices = store.getPairedDevices().filter(d => d.id !== deviceId);
    store.setPairedDevices(devices);
    return { ok: true };
  });

  // ── Phase 18: Desktop confirmation ────────────────────────────────────────

  // dispatch:listPendingConfirmations — get all pending desktop confirms
  ipcMain.handle('dispatch:listPendingConfirmations', () => {
    return Array.from(_pendingConfirmations.values())
      .filter(c => c.status === 'pending')
      .map(c => ({
        id:          c.id,
        action:      c.action,
        itemId:      c.itemId,
        verb:        c.verb,
        deviceLabel: c.deviceLabel,
        clientIp:    c.clientIp,
        createdAt:   c.createdAt,
      }));
  });

  // dispatch:desktopConfirm — desktop approves or denies a pending remote action
  ipcMain.handle('dispatch:desktopConfirm', async (_e, confirmId: string, approved: boolean) => {
    const ok = _dispatchServer?.resolveConf(confirmId, approved) ?? false;
    if (!ok) {
      // Try in-memory map directly (server may have been restarted)
      const conf = _pendingConfirmations.get(confirmId);
      if (!conf) return { ok: false, error: 'Confirmation not found' };
      conf.status    = approved ? 'approved' : 'denied';
      conf.resolvedAt = Date.now();
    }
    const conf = _pendingConfirmations.get(confirmId);
    if (conf && approved) {
      // Execute the deferred action now
      const ctx: RemoteActionContext = {
        isAdmin:    false,
        deviceId:   conf.deviceId,
        deviceLabel: conf.deviceLabel,
        clientIp:   conf.clientIp,
      };
      const handlers = _buildDispatchHandlers();
      if (conf.verb === 'approve') {
        await handlers.approveAction(conf.itemId, ctx).catch(console.error);
      }
    }
    _getAuditLedger().log('SYSTEM_EVENT' as any, {
      metadata: {
        action:    approved ? 'desktop_confirm_approved' : 'desktop_confirm_denied',
        confirmId,
        source:    'desktop',
      },
    });
    return { ok: true };
  });

  // ── Phase 19: Public URL + ntfy deep-link wiring ─────────────────────────────

  // dispatch:setPublicUrl — set (or clear) the public reachability URL for Dispatch.
  // When set, ntfy push notifications for actionable events include an X-Click header
  // so tapping the notification on mobile opens the Dispatch UI directly.
  ipcMain.handle('dispatch:setPublicUrl', (_e, url: string) => {
    const cleaned = url.trim().replace(/\/$/, '');
    store.setDispatchPublicUrl(cleaned);
    _pushNotifier.setDispatchBaseUrl(cleaned || null);
    return { ok: true };
  });

  ipcMain.handle('dispatch:getPublicUrl', () => {
    return { url: store.getDispatchPublicUrl() };
  });

  // ── Phase 27: Workspace IPC ───────────────────────────────────────────────

  ipcMain.handle('workspace:get', () => store.getWorkspace());

  ipcMain.handle('workspace:create', (_e, name: string) => {
    const existing = store.getWorkspace();
    if (existing) return { ok: false, error: 'Workspace already exists', workspace: existing };
    const ws: Workspace = {
      id:        `ws:${Date.now()}`,
      name:      name.trim() || 'My Workspace',
      createdAt: Date.now(),
      updatedAt: Date.now(),
      ownerId:   'desktop',
      members:   [],
      invites:   [],
      policy:    { ...DEFAULT_WORKSPACE_POLICY },
    };
    store.setWorkspace(ws);
    _getAuditLedger().log('WORKSPACE_CREATED', {
      metadata: { workspaceId: ws.id, workspaceName: ws.name, ownerId: 'desktop', source: 'desktop' },
    });
    _dispatchServer?.broadcastTaskEvent({ type: 'workspace:update', timestamp: Date.now() });
    return { ok: true, workspace: ws };
  });

  ipcMain.handle('workspace:rename', (_e, name: string) => {
    const ws = store.getWorkspace();
    if (!ws) return { ok: false, error: 'No workspace' };
    ws.name = name.trim() || ws.name;
    ws.updatedAt = Date.now();
    store.setWorkspace(ws);
    return { ok: true };
  });

  ipcMain.handle('workspace:invite', async (_e, role: WorkspaceRole) => {
    const handlers = _buildDispatchHandlers();
    const ctx: RemoteActionContext = { isAdmin: true, deviceId: 'desktop', deviceLabel: 'Desktop', clientIp: '127.0.0.1' };
    try {
      const result = await handlers.createWorkspaceInvite(role, ctx);
      return { ok: true, ...result };
    } catch (e) { return { ok: false, error: e instanceof Error ? e.message : String(e) }; }
  });

  ipcMain.handle('workspace:member:setRole', async (_e, targetDeviceId: string, role: WorkspaceRole) => {
    const handlers = _buildDispatchHandlers();
    const ctx: RemoteActionContext = { isAdmin: true, deviceId: 'desktop', deviceLabel: 'Desktop', clientIp: '127.0.0.1' };
    return handlers.setWorkspaceMemberRole(targetDeviceId, role, ctx);
  });

  ipcMain.handle('workspace:member:remove', async (_e, targetDeviceId: string) => {
    const handlers = _buildDispatchHandlers();
    const ctx: RemoteActionContext = { isAdmin: true, deviceId: 'desktop', deviceLabel: 'Desktop', clientIp: '127.0.0.1' };
    return handlers.removeWorkspaceMember(targetDeviceId, ctx);
  });

  ipcMain.handle('workspace:policy:update', async (_e, patch: Partial<WorkspacePolicy>) => {
    const handlers = _buildDispatchHandlers();
    const ctx: RemoteActionContext = { isAdmin: true, deviceId: 'desktop', deviceLabel: 'Desktop', clientIp: '127.0.0.1' };
    return handlers.updateWorkspacePolicy(patch, ctx);
  });

  // ── Phase 28: Workspace Integration IPC ──────────────────────────────────────

  /** Maps integration name to the workspace CredentialKey (for single-token integrations). */
  function _wsCredKeyFor(integration: string): CredentialKey | null {
    const map: Record<string, CredentialKey> = {
      github: 'ws_github_pat',
      slack:  'ws_slack_bot_token',
      jira:   'ws_jira_api_token',
      linear: 'ws_linear_api_key',
      push:   'ws_ntfy_token',
    };
    return (map[integration] as CredentialKey | undefined) ?? null;
  }

  /** Check whether a personal credential exists for a given integration (for status display). */
  async function _hasPersonalCred(integration: string): Promise<boolean> {
    const creds = _getCredentialManager(store);
    const map: Record<string, CredentialKey> = {
      github: 'github_pat',
      slack:  'slack_bot_token',
      jira:   'jira_api_token',
      linear: 'linear_api_key',
      push:   'ntfy_token',
    };
    const key = map[integration] as CredentialKey | undefined;
    if (!key) return false;
    const val = await creds.get(key);
    return !!val;
  }

  ipcMain.handle('workspaceIntegration:getStatus', async (_e, integration: string) => {
    const wsConfig       = store.getWorkspaceIntegration(integration);
    const hasPersonalCred = await _hasPersonalCred(integration);
    return { config: wsConfig, hasPersonalCred };
  });

  ipcMain.handle('workspaceIntegration:setConfig', async (_e, integration: string, payload: Record<string, unknown>) => {
    const ws = store.getWorkspace();
    if (!ws) return { ok: false, error: 'No workspace configured. Create a workspace first.' };
    const existing: WorkspaceIntegrationConfig = store.getWorkspaceIntegration(integration) ?? {
      configured: false, useWorkspaceByDefault: true, allowPersonalFallback: true,
    };
    const creds = _getCredentialManager(store);
    // Store token-type credential (GitHub PAT, Slack token, Linear key, Jira token, ntfy token)
    if (typeof payload.token === 'string' && payload.token.trim()) {
      let credKey: CredentialKey | null = null;
      if (integration === 'push' && payload.pushProvider === 'pushover') {
        credKey = 'ws_pushover_app_token';
      } else {
        credKey = _wsCredKeyFor(integration);
      }
      if (credKey) await creds.set(credKey, payload.token.trim());
      existing.configured = true;
    }
    if (typeof payload.url    === 'string') existing.url    = payload.url.trim();
    if (typeof payload.email  === 'string') existing.email  = payload.email.trim();
    if (typeof payload.pushProvider  === 'string') existing.pushProvider  = payload.pushProvider as 'ntfy' | 'pushover' | 'disabled';
    if (typeof payload.pushTopic     === 'string') existing.pushTopic     = payload.pushTopic.trim();
    if (typeof payload.pushServer    === 'string') existing.pushServer    = payload.pushServer.trim();
    if (typeof payload.pushoverUser  === 'string') existing.pushoverUser  = payload.pushoverUser.trim();
    if (typeof payload.connectedLabel === 'string') existing.connectedLabel = payload.connectedLabel;
    // Mark configured if essential non-token fields are present
    if (integration === 'jira' && existing.url && existing.email) existing.configured = true;
    if (integration === 'push' && existing.pushProvider && existing.pushProvider !== 'disabled') existing.configured = true;
    store.setWorkspaceIntegration(integration, existing);
    _getAuditLedger().log('WS_INTEGRATION_CONFIGURED', {
      metadata: { workspaceId: ws.id, integration, actor: 'desktop', source: 'desktop' },
    });
    return { ok: true };
  });

  ipcMain.handle('workspaceIntegration:test', async (_e, integration: string) => {
    const result = await _getWsCredResolver().resolve(integration as IntegrationName);
    const ok     = result.scopeUsed !== 'none';
    const existing = store.getWorkspaceIntegration(integration);
    if (existing) {
      existing.lastTestAt = Date.now();
      existing.lastTestOk = ok;
      store.setWorkspaceIntegration(integration, existing);
    }
    _getAuditLedger().log('WS_INTEGRATION_TESTED', {
      metadata: { integration, ok, scope: result.scopeUsed, explanation: result.explanation, workspaceId: store.getWorkspace()?.id },
    });
    return { ok, scope: result.scopeUsed, explanation: result.explanation };
  });

  ipcMain.handle('workspaceIntegration:revoke', async (_e, integration: string) => {
    const ws = store.getWorkspace();
    if (!ws) return { ok: false, error: 'No workspace' };
    const creds = _getCredentialManager(store);
    const wsKey = _wsCredKeyFor(integration);
    if (wsKey) await creds.delete(wsKey);
    // Also revoke pushover app token for push
    if (integration === 'push') await creds.delete('ws_pushover_app_token');
    const existing = store.getWorkspaceIntegration(integration);
    if (existing) {
      existing.configured     = false;
      existing.lastTestAt     = undefined;
      existing.lastTestOk     = undefined;
      existing.connectedLabel = undefined;
      store.setWorkspaceIntegration(integration, existing);
    }
    _getAuditLedger().log('WS_INTEGRATION_REVOKED', {
      metadata: { workspaceId: ws.id, integration, actor: 'desktop', source: 'desktop' },
    });
    return { ok: true };
  });

  ipcMain.handle('workspaceIntegration:setDefaults', async (_e, integration: string, defaults: { useWorkspaceByDefault: boolean; allowPersonalFallback: boolean }) => {
    const existing: WorkspaceIntegrationConfig = store.getWorkspaceIntegration(integration) ?? {
      configured: false, useWorkspaceByDefault: true, allowPersonalFallback: true,
    };
    existing.useWorkspaceByDefault = defaults.useWorkspaceByDefault;
    existing.allowPersonalFallback = defaults.allowPersonalFallback;
    store.setWorkspaceIntegration(integration, existing);
    return { ok: true };
  });

  // ── Phase 28: Workspace recipe scope IPC ─────────────────────────────────────

  ipcMain.handle('workspaceIntegration:getRecipeScope', (_e, recipeId: string) => {
    const scopes = store.getWorkspaceRecipeScopes();
    return { scope: scopes[recipeId] ?? 'personal' };
  });

  ipcMain.handle('workspaceIntegration:setRecipeScope', (_e, recipeId: string, scope: 'personal' | 'workspace') => {
    const ws = store.getWorkspace();
    store.setWorkspaceRecipeScope(recipeId, scope);
    if (scope === 'workspace') {
      _getAuditLedger().log('WS_RECIPE_RUN', {
        metadata: { recipeId, action: 'scope_set', scope, workspaceId: ws?.id },
      });
    }
    return { ok: true };
  });

  // ── Phase 29: Workspace Policy Matrix IPC ────────────────────────────────────

  ipcMain.handle('workspacePolicy:getMatrix', () => {
    const engine = _getPolicyEngine();
    return { matrix: engine.getMatrix() };
  });

  ipcMain.handle('workspacePolicy:setRule', (_e, category: ActionCategory, patch: Partial<WorkspaceApprovalRule>) => {
    const ws = store.getWorkspace();
    const engine = _getPolicyEngine();
    const current = engine.getMatrix();
    const idx = current.findIndex(r => r.category === category);
    if (idx < 0) return { ok: false, error: `Unknown category: ${category}` };
    current[idx] = { ...current[idx], ...patch, category };
    store.setApprovalMatrix(current);
    _getAuditLedger().log('WS_APPROVAL_MATRIX_UPDATED', {
      metadata: { category, patch, workspaceId: ws?.id, actor: 'desktop' },
    });
    return { ok: true };
  });

  ipcMain.handle('workspacePolicy:resetDefaults', () => {
    store.resetApprovalMatrix();
    _getAuditLedger().log('WS_APPROVAL_MATRIX_UPDATED', {
      metadata: { action: 'reset_to_defaults', workspaceId: store.getWorkspace()?.id, actor: 'desktop' },
    });
    return { ok: true, matrix: DEFAULT_APPROVAL_MATRIX };
  });

  ipcMain.handle('workspacePolicy:simulate', (_e, roleOrDeviceId: string, category: ActionCategory) => {
    const engine = _getPolicyEngine();
    // If it looks like a deviceId (not a known role name), resolve via workspace membership
    const knownRoles = ['owner', 'admin', 'operator', 'reviewer', 'viewer'];
    if (knownRoles.includes(roleOrDeviceId)) {
      const result = engine.simulate(roleOrDeviceId as any, category);
      return result;
    }
    // Treat as deviceId
    const result = engine.canApprove(roleOrDeviceId, category, false);
    return result;
  });

  // ── Phase 30: Workspace Automation Governance IPC ────────────────────────────

  ipcMain.handle('workspaceAutomation:getPolicy', () => {
    return store.getWorkspaceAutomationPolicy();
  });

  ipcMain.handle('workspaceAutomation:setPolicy', (_e, patch: Partial<WorkspaceAutomationPolicy>) => {
    const current = store.getWorkspaceAutomationPolicy();
    const updated: WorkspaceAutomationPolicy = { ...current, ...patch };
    store.setWorkspaceAutomationPolicy(updated);
    _getAuditLedger().log('WS_AUTOMATION_POLICY_SET', {
      metadata: { patch, workspaceId: store.getWorkspace()?.id, actor: 'desktop' },
    });
    return { ok: true, policy: updated };
  });

  ipcMain.handle('workspaceAutomation:getRecipePolicy', (_e, recipeId: string) => {
    return { policy: store.getRecipePolicy(recipeId) };
  });

  ipcMain.handle('workspaceAutomation:setRecipePolicy', (_e, recipeId: string, patch: Partial<WorkspaceRecipePolicy>) => {
    const ws = store.getWorkspace();
    if (!ws) return { ok: false, error: 'No workspace configured' };
    const existing: WorkspaceRecipePolicy = store.getRecipePolicy(recipeId) ?? {
      recipeId,
      maxRisk:               'medium',
      allowRemoteRun:        false,
      requireDesktopConfirm: false,
      allowedDestinations:   ['any'],
      allowedRunnerRoles:    ['operator'],
      allowedRunnerDeviceIds:[],
      editorDeviceIds:       [],
      enabled:               true,
    };
    const updated: WorkspaceRecipePolicy = { ...existing, ...patch, recipeId };
    store.setRecipePolicy(recipeId, updated);
    _getAuditLedger().log('WS_RECIPE_POLICY_SET', {
      metadata: { recipeId, patch, workspaceId: ws.id, actor: 'desktop' },
    });
    return { ok: true, policy: updated };
  });

  ipcMain.handle('workspaceAutomation:deleteRecipePolicy', (_e, recipeId: string) => {
    store.deleteRecipePolicy(recipeId);
    return { ok: true };
  });

  ipcMain.handle('workspaceAutomation:getDelegatedOperators', () => {
    return { operators: store.getDelegatedOperators() };
  });

  ipcMain.handle('workspaceAutomation:assignDelegatedOperator', (_e, op: Omit<DelegatedOperator, 'assignedAt'>) => {
    const ws = store.getWorkspace();
    if (!ws) return { ok: false, error: 'No workspace configured' };
    const full: DelegatedOperator = { ...op, assignedAt: Date.now() };
    store.setDelegatedOperator(full);
    _getAuditLedger().log('WS_DELEGATED_OP_ASSIGNED', {
      metadata: { deviceId: op.deviceId, delegationType: op.delegationType, label: op.label, workspaceId: ws.id, actor: 'desktop' },
    });
    return { ok: true };
  });

  ipcMain.handle('workspaceAutomation:revokeDelegatedOperator', (_e, deviceId: string) => {
    const ws = store.getWorkspace();
    const removed = store.revokeDelegatedOperator(deviceId);
    if (removed && ws) {
      _getAuditLedger().log('WS_DELEGATED_OP_REVOKED', {
        metadata: { deviceId, workspaceId: ws.id, actor: 'desktop' },
      });
    }
    return { ok: removed };
  });

  ipcMain.handle('workspaceAutomation:simulateRun', (_e, deviceIdOrRole: string, recipeId: string, isRemote: boolean) => {
    const gate = _getAutomationGate();
    const knownRoles = ['owner', 'admin', 'operator', 'reviewer', 'viewer'];
    if (knownRoles.includes(deviceIdOrRole)) {
      // Synthetic check: create a temporary actor by simulating role membership
      const ws = store.getWorkspace();
      const syntheticDeviceId = ws?.members.find((m: { role: string }) => m.role === deviceIdOrRole)?.deviceId ?? null;
      return gate.canRunRecipe(syntheticDeviceId, recipeId, false, isRemote);
    }
    return gate.canRunRecipe(deviceIdOrRole, recipeId, false, isRemote);
  });

  // ── Phase 31: Runbook IPC handlers ────────────────────────────────────────────

  ipcMain.handle('runbook:list', () => {
    return { runbooks: store.getRunbooks() };
  });

  ipcMain.handle('runbook:get', (_e, id: string) => {
    return { runbook: store.getRunbook(id) };
  });

  ipcMain.handle('runbook:create', (_e, payload: Partial<RunbookDef>) => {
    const ws = store.getWorkspace();
    if (!ws) return { ok: false, error: 'No workspace configured' };
    const now: number = Date.now();
    const def: RunbookDef = {
      id:                    makeRunbookId(),
      title:                 payload.title ?? 'Untitled Runbook',
      description:           payload.description ?? '',
      scope:                 'workspace',
      ownerDeviceId:         payload.ownerDeviceId,
      trigger:               payload.trigger ?? 'manual',
      steps:                 payload.steps ?? [],
      allowedRunnerRoles:    payload.allowedRunnerRoles ?? ['operator'],
      allowedRunnerDeviceIds:payload.allowedRunnerDeviceIds ?? [],
      escalationChannel:     payload.escalationChannel,
      linkedIntegrations:    payload.linkedIntegrations ?? [],
      incidentMode:          payload.incidentMode ?? false,
      enabled:               payload.enabled ?? true,
      createdAt:             now,
      updatedAt:             now,
      // Phase 34 — declared variables
      variables:             payload.variables ?? [],
    };
    store.saveRunbook(def);
    _getAuditLedger().log('RUNBOOK_CREATED', { metadata: { runbookId: def.id, title: def.title, workspaceId: ws.id } });
    return { ok: true, runbook: def };
  });

  ipcMain.handle('runbook:update', (_e, id: string, patch: Partial<RunbookDef>) => {
    const existing = store.getRunbook(id);
    if (!existing) return { ok: false, error: 'Runbook not found' };
    const updated: RunbookDef = { ...existing, ...patch, id, scope: 'workspace', updatedAt: Date.now() };
    store.saveRunbook(updated);
    _getAuditLedger().log('RUNBOOK_UPDATED', { metadata: { runbookId: id, workspaceId: store.getWorkspace()?.id } });
    return { ok: true, runbook: updated };
  });

  ipcMain.handle('runbook:delete', (_e, id: string) => {
    const removed = store.deleteRunbook(id);
    if (removed) _getAuditLedger().log('RUNBOOK_DELETED', { metadata: { runbookId: id, workspaceId: store.getWorkspace()?.id } });
    return { ok: removed };
  });

  ipcMain.handle('runbook:run', async (_e, id: string, vars: Record<string, string> = {}) => {
    const def = store.getRunbook(id);
    if (!def) return { ok: false, error: 'Runbook not found' };
    if (!def.enabled) return { ok: false, error: 'Runbook is disabled' };
    try {
      const exec = await _buildRunbookExecutor().run(def, null, 'desktop', false, vars);
      return { ok: exec.status !== 'failed', executionId: exec.id, status: exec.status, missingVars: exec.error?.startsWith('Missing required') ? exec.error : undefined };
    } catch (e: unknown) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle('runbook:listExecutions', (_e, runbookId?: string) => {
    const all = store.getRunbookExecutions(100);
    return { executions: runbookId ? all.filter(e => e.runbookId === runbookId) : all };
  });

  ipcMain.handle('runbook:getExecution', (_e, executionId: string) => {
    const all = store.getRunbookExecutions(200);
    return { execution: all.find(e => e.id === executionId) ?? null };
  });

  ipcMain.handle('runbook:incidentMode:get', () => {
    return store.getIncidentMode();
  });

  ipcMain.handle('runbook:incidentMode:set', (_e, active: boolean, reason?: string) => {
    const state = { active, activatedAt: active ? Date.now() : undefined, reason };
    store.setIncidentMode(state);
    _getAuditLedger().log('INCIDENT_MODE_CHANGED', {
      metadata: { active, reason, workspaceId: store.getWorkspace()?.id, actor: 'desktop' },
    });
    // Broadcast to renderer
    for (const win of (require('electron') as typeof import('electron')).BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('runbook:incidentMode', state);
    }
    return { ok: true, state };
  });

  ipcMain.handle('runbook:addStep', (_e, runbookId: string, step: Omit<RunbookStep, 'id'>) => {
    const def = store.getRunbook(runbookId);
    if (!def) return { ok: false, error: 'Runbook not found' };
    const newStep: RunbookStep = { ...step, id: makeStepId() };
    def.steps.push(newStep);
    def.updatedAt = Date.now();
    store.saveRunbook(def);
    return { ok: true, step: newStep };
  });

  ipcMain.handle('runbook:removeStep', (_e, runbookId: string, stepId: string) => {
    const def = store.getRunbook(runbookId);
    if (!def) return { ok: false, error: 'Runbook not found' };
    def.steps = def.steps.filter(s => s.id !== stepId);
    def.updatedAt = Date.now();
    store.saveRunbook(def);
    return { ok: true };
  });

  ipcMain.handle('runbook:reorderSteps', (_e, runbookId: string, stepIds: string[]) => {
    const def = store.getRunbook(runbookId);
    if (!def) return { ok: false, error: 'Runbook not found' };
    const reordered = stepIds.map(sid => def.steps.find(s => s.id === sid)).filter(Boolean) as RunbookStep[];
    def.steps = reordered;
    def.updatedAt = Date.now();
    store.saveRunbook(def);
    return { ok: true };
  });

  // ── Phase 32 — Pause/Resume + Handoff Queue ────────────────────────────────

  ipcMain.handle('runbook:getHandoffQueue', () => {
    return { items: store.getHandoffQueue() };
  });

  ipcMain.handle('runbook:resume', async (_e, executionId: string, resolution: string) => {
    const exec = await _buildRunbookExecutor().resumeExecution(executionId, null, 'desktop', resolution);
    if (!exec) return { ok: false, error: 'Execution not found or not paused' };
    return { ok: true, execution: exec };
  });

  ipcMain.handle('runbook:abort', async (_e, executionId: string) => {
    const exec = await _buildRunbookExecutor().abortExecution(executionId, null);
    if (!exec) return { ok: false, error: 'Execution not found' };
    return { ok: true, execution: exec };
  });

  // ── Phase 35 — Runbook Packs ───────────────────────────────────────────────

  ipcMain.handle('pack:list', () => {
    return { packs: store.getPacks() };
  });

  ipcMain.handle('pack:export', (_e, runbookIds: string[], meta: Record<string, string>) => {
    const ws = store.getWorkspace();
    if (!ws) return { ok: false, error: 'No workspace configured' };
    const runbooks = runbookIds
      .map(id => store.getRunbook(id))
      .filter((r): r is RunbookDef => r !== null);
    if (runbooks.length === 0) return { ok: false, error: 'No runbooks found for the given ids' };
    const pack = buildPack(runbooks, {
      name:        meta.name        || runbooks[0].title,
      version:     meta.version     || '1.0.0',
      description: meta.description || '',
      author:      meta.author,
      changelog:   meta.changelog,
    });
    const json = serializePack(pack);
    _getAuditLedger().log('PACK_EXPORTED', {
      metadata: {
        packId: pack.id, name: pack.name, version: pack.version,
        runbookCount: runbooks.length, workspaceId: ws.id,
      },
    });
    return { ok: true, json, pack };
  });

  ipcMain.handle('pack:previewImport', (_e, json: string) => {
    const result = deserializePack(json);
    if (result.error) return { ok: false, error: result.error };
    if (!result.pack) return { ok: false, error: 'Invalid pack data' };
    const preview = previewPack(result.pack, store);
    // Phase 36 audit: log trust result on preview
    if (preview.trust.status === 'trusted') {
      _getAuditLedger().log('PACK_SIGNATURE_VERIFIED', {
        metadata: { packId: result.pack.id, keyId: preview.trust.keyId, signerName: preview.trust.signerName },
      });
    } else if (result.pack.signature && preview.trust.status === 'invalid') {
      _getAuditLedger().log('PACK_SIGNATURE_FAILED', {
        metadata: { packId: result.pack.id, keyId: preview.trust.keyId, error: preview.trust.error },
      });
    } else if (preview.trust.status === 'unsigned') {
      _getAuditLedger().log('PACK_UNSIGNED_ALLOWED', {
        metadata: { packId: result.pack.id },
      });
    }
    if (preview.policyBlocked) {
      _getAuditLedger().log('PACK_POLICY_BLOCKED', {
        metadata: { packId: result.pack.id, reason: preview.policyBlockReason },
      });
    }
    return { ok: true, preview };
  });

  ipcMain.handle('pack:import', (_e, json: string) => {
    const ws = store.getWorkspace();
    if (!ws) return { ok: false, error: 'No workspace configured' };
    const result = deserializePack(json);
    if (result.error) return { ok: false, error: result.error };
    if (!result.pack) return { ok: false, error: 'Invalid pack data' };
    const isUpdate = !!store.getPack(result.pack.id);
    const { installedIds, updatedIds } = installPack(result.pack, store);
    const auditType = isUpdate ? 'PACK_UPDATED' : 'PACK_INSTALLED';
    _getAuditLedger().log(auditType, {
      metadata: {
        packId: result.pack.id, name: result.pack.name, version: result.pack.version,
        installedIds, updatedIds, workspaceId: ws.id,
      },
    });
    if (isUpdate && updatedIds.length > 0) {
      _getAuditLedger().log('RUNBOOK_UPGRADED', {
        metadata: { packId: result.pack.id, runbookIds: updatedIds, workspaceId: ws.id },
      });
    }
    // Phase 36 — log risk increase
    const preview = previewPack(result.pack, store);
    if (preview.diff?.riskIncreased) {
      _getAuditLedger().log('PACK_UPDATE_RISK_INCREASED', {
        metadata: {
          packId: result.pack.id, destinationsAdded: preview.diff.destinationsAdded,
          integrationsAdded: preview.diff.integrationsAdded,
        },
      });
    }
    return {
      ok: true,
      installedIds,
      updatedIds,
      pack: store.getPack(result.pack.id),
    };
  });

  ipcMain.handle('pack:uninstall', (_e, packId: string) => {
    const ws = store.getWorkspace();
    const { removedIds, preservedIds, error } = uninstallPack(packId, store);
    if (error) return { ok: false, error };
    _getAuditLedger().log('PACK_UNINSTALLED', {
      metadata: { packId, removedIds, preservedIds, workspaceId: ws?.id },
    });
    return { ok: true, removedIds, preservedIds };
  });

  ipcMain.handle('pack:rollback', (_e, packId: string) => {
    const ws = store.getWorkspace();
    const { restoredIds, version, error } = rollbackPack(packId, store);
    if (error) return { ok: false, error };
    _getAuditLedger().log('PACK_ROLLBACK', {
      metadata: { packId, restoredIds, toVersion: version, workspaceId: ws?.id },
    });
    return { ok: true, restoredIds, version, pack: store.getPack(packId) };
  });

  // ── Phase 36 — Pack Trust, Signing, and Update Safety ─────────────────────

  ipcMain.handle('pack:trust:getLocalKey', () => {
    try {
      const key = getOrCreateLocalKey(_getDataDir());
      return { ok: true, keyId: key.keyId, publicKeyPem: key.publicKeyPem };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle('pack:trust:signPack', (_e, json: string, signerName: string, signerEmail?: string) => {
    try {
      const result = deserializePack(json);
      if (result.error) return { ok: false, error: result.error };
      if (!result.pack) return { ok: false, error: 'Invalid pack data' };
      const key    = getOrCreateLocalKey(_getDataDir());
      const signed = signPack(result.pack, key.privateKeyPem, key.publicKeyPem, signerName, signerEmail);
      _getAuditLedger().log('PACK_SIGNED', {
        metadata: { packId: signed.id, name: signed.name, keyId: key.keyId, signerName },
      });
      return { ok: true, json: serializePack(signed) };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle('pack:trust:listSigners', () => {
    return { signers: store.getTrustedSigners() };
  });

  ipcMain.handle('pack:trust:addSigner', (_e, signer: TrustedSigner) => {
    try {
      // Validate the public key is parseable before storing
      const keyId = computeKeyId(signer.publicKeyPem);
      const entry: TrustedSigner = { ...signer, keyId, addedAt: Date.now(), revoked: false };
      store.saveTrustedSigner(entry);
      _getAuditLedger().log('TRUSTED_SIGNER_ADDED', {
        metadata: { keyId, signerName: signer.name },
      });
      return { ok: true, keyId };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle('pack:trust:removeSigner', (_e, keyId: string) => {
    const removed = store.removeTrustedSigner(keyId);
    if (removed) {
      _getAuditLedger().log('TRUSTED_SIGNER_REMOVED', { metadata: { keyId } });
    }
    return { ok: removed };
  });

  ipcMain.handle('pack:trust:revokeSigner', (_e, keyId: string) => {
    const revoked = store.revokeTrustedSigner(keyId);
    if (revoked) {
      _getAuditLedger().log('TRUSTED_SIGNER_REVOKED', { metadata: { keyId } });
    }
    return { ok: revoked };
  });

  ipcMain.handle('pack:trust:getPolicy', () => {
    return { policy: store.getPackTrustPolicy() };
  });

  ipcMain.handle('pack:trust:setPolicy', (_e, policy: Record<string, boolean>) => {
    const current = store.getPackTrustPolicy();
    store.setPackTrustPolicy({ ...current, ...policy });
    return { ok: true };
  });

  // ── Phase 37 — Workspace Analytics ────────────────────────────────────────

  ipcMain.handle('analytics:report', async (_e, win: string) => {
    const w = (win === '24h' || win === '7d' || win === '30d' ? win : '7d') as AnalyticsWindow;
    const now    = Date.now();
    const fromTs = windowFromTs(w, now);
    try {
      const [audit, executions, runbooks, packs] = await Promise.all([
        _getAuditLedger().scanRange(fromTs, now),
        Promise.resolve(store.getRunbookExecutions(500)),
        Promise.resolve(store.getRunbooks()),
        Promise.resolve(store.getPacks()),
      ]);
      const report = generateReport(w, fromTs, now, executions, runbooks, packs, audit);
      return { ok: true, report };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle('analytics:exportText', async (_e, win: string) => {
    const w = (win === '24h' || win === '7d' || win === '30d' ? win : '7d') as AnalyticsWindow;
    const now    = Date.now();
    const fromTs = windowFromTs(w, now);
    try {
      const [audit, executions, runbooks, packs] = await Promise.all([
        _getAuditLedger().scanRange(fromTs, now),
        Promise.resolve(store.getRunbookExecutions(500)),
        Promise.resolve(store.getRunbooks()),
        Promise.resolve(store.getPacks()),
      ]);
      const report = generateReport(w, fromTs, now, executions, runbooks, packs, audit);
      return { ok: true, text: formatReportText(report) };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ── Phase 38 — Enterprise Admin + Policy Inheritance ──────────────────────

  // ── Org config ────────────────────────────────────────────────────────────

  ipcMain.handle('org:get', () => {
    return { org: store.getOrgConfig(), policy: store.getOrgPolicy() };
  });

  ipcMain.handle('org:create', (_e, name: string, plan: string, adminEmail?: string) => {
    if (store.getOrgConfig()) return { ok: false, error: 'Org already exists' };
    const org: OrgConfig = {
      id:          makeOrgId(),
      name:        name.trim(),
      plan:        (plan === 'enterprise' ? 'enterprise' : 'team') as 'team' | 'enterprise',
      adminEmail:  adminEmail?.trim(),
      createdAt:   Date.now(),
      updatedAt:   Date.now(),
    };
    store.setOrgConfig(org);
    store.setOrgPolicy(JSON.parse(JSON.stringify(DEFAULT_ORG_POLICY)));
    _getAuditLedger().log('ORG_CREATED', { metadata: { orgId: org.id, name: org.name, plan: org.plan } });
    return { ok: true, org };
  });

  ipcMain.handle('org:update', (_e, patch: Partial<Pick<OrgConfig, 'name' | 'plan' | 'adminEmail' | 'description'>>) => {
    const existing = store.getOrgConfig();
    if (!existing) return { ok: false, error: 'No org configured' };
    const updated: OrgConfig = { ...existing, ...patch, updatedAt: Date.now() };
    store.setOrgConfig(updated);
    _getAuditLedger().log('ORG_UPDATED', { metadata: { orgId: existing.id, changes: Object.keys(patch) } });
    return { ok: true, org: updated };
  });

  // ── Org policy ────────────────────────────────────────────────────────────

  ipcMain.handle('org:policy:get', () => {
    return { policy: store.getOrgPolicy() };
  });

  ipcMain.handle('org:policy:set', (_e, domain: string, patch: Record<string, unknown>) => {
    const org    = store.getOrgConfig();
    const policy = store.getOrgPolicy();
    if (!(domain in policy)) return { ok: false, error: `Unknown policy domain: ${domain}` };
    (policy as any)[domain] = { ...(policy as any)[domain], ...patch };
    store.setOrgPolicy(policy);
    _getAuditLedger().log('ORG_POLICY_UPDATED', {
      metadata: { orgId: org?.id, domain, changes: Object.keys(patch) },
    });
    return { ok: true, policy };
  });

  ipcMain.handle('org:policy:effective', () => {
    const orgPolicy = store.getOrgPolicy();
    const wsPolicy  = store.getPackTrustPolicy();
    return { effective: resolveOrgEffective(orgPolicy, wsPolicy) };
  });

  // ── Org-level trusted signers ─────────────────────────────────────────────

  ipcMain.handle('org:signers:list', () => {
    const policy = store.getOrgPolicy();
    return { signers: policy.signers.globalSigners };
  });

  ipcMain.handle('org:signers:add', (_e, signer: Omit<OrgSignerEntry, 'keyId' | 'addedAt' | 'revoked'>) => {
    try {
      const keyId = computeKeyId(signer.publicKeyPem);
      const policy = store.getOrgPolicy();
      const existing = policy.signers.globalSigners.findIndex(s => s.keyId === keyId);
      const entry: OrgSignerEntry = { ...signer, keyId, addedAt: Date.now(), revoked: false };
      if (existing >= 0) policy.signers.globalSigners[existing] = entry;
      else               policy.signers.globalSigners.push(entry);
      store.setOrgPolicy(policy);
      _getAuditLedger().log('ORG_SIGNER_ADDED', { metadata: { keyId, name: signer.name } });
      return { ok: true, keyId };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle('org:signers:revoke', (_e, keyId: string) => {
    const policy = store.getOrgPolicy();
    const s = policy.signers.globalSigners.find(x => x.keyId === keyId);
    if (!s) return { ok: false, error: 'Signer not found' };
    s.revoked = true;
    store.setOrgPolicy(policy);
    _getAuditLedger().log('ORG_SIGNER_REVOKED', { metadata: { keyId } });
    return { ok: true };
  });

  ipcMain.handle('org:signers:remove', (_e, keyId: string) => {
    const policy = store.getOrgPolicy();
    const idx = policy.signers.globalSigners.findIndex(s => s.keyId === keyId);
    if (idx < 0) return { ok: false, error: 'Signer not found' };
    policy.signers.globalSigners.splice(idx, 1);
    store.setOrgPolicy(policy);
    _getAuditLedger().log('ORG_SIGNER_REMOVED', { metadata: { keyId } });
    return { ok: true };
  });

  // ── Org analytics rollup ──────────────────────────────────────────────────

  ipcMain.handle('org:analytics', async (_e, win: string) => {
    // Phase 38 v1: org analytics = workspace analytics (single-node)
    // Future: aggregate across federated workspaces via control plane
    const w      = (win === '24h' || win === '7d' || win === '30d' ? win : '7d') as AnalyticsWindow;
    const now    = Date.now();
    const fromTs = windowFromTs(w, now);
    try {
      const [audit, executions, runbooks, packs] = await Promise.all([
        _getAuditLedger().scanRange(fromTs, now),
        Promise.resolve(store.getRunbookExecutions(500)),
        Promise.resolve(store.getRunbooks()),
        Promise.resolve(store.getPacks()),
      ]);
      const report = generateReport(w, fromTs, now, executions, runbooks, packs, audit);
      return { ok: true, report, workspaceCount: 1 };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ── Audit export ──────────────────────────────────────────────────────────

  ipcMain.handle('audit:export', async (_e, fromTs: number, toTs: number, format: string, filter?: string) => {
    const fmt = (['json', 'csv', 'text'].includes(format) ? format : 'text') as AuditExportFormat;
    try {
      const text = await exportAuditLog(_getAuditLedger(), fromTs, toTs, fmt, filter);
      const ws   = store.getWorkspace();
      _getAuditLedger().log('AUDIT_EXPORTED', {
        metadata: { from: fromTs, to: toTs, format: fmt, filter, workspaceId: ws?.id },
      });
      return { ok: true, text, entryCount: text.split('\n').filter(l => l.includes('T')).length };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  ipcMain.handle('audit:exportPolicyHistory', async (_e, fromTs: number, toTs: number) => {
    try {
      const text = await exportPolicyHistory(_getAuditLedger(), fromTs, toTs);
      _getAuditLedger().log('POLICY_HISTORY_EXPORTED', { metadata: { from: fromTs, to: toTs } });
      return { ok: true, text };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // Wire saved public URL into push notifier on startup
  const _savedPublicUrl = store.getDispatchPublicUrl();
  if (_savedPublicUrl) _pushNotifier.setDispatchBaseUrl(_savedPublicUrl);

  // Auto-start dispatch server on setupIpc if previously enabled
  (async () => {
    if (store.getDispatchEnabled()) {
      const token = await _getCredentialManager(store).get('dispatch_token');
      if (token) {
        _dispatchServer = new DispatchServer(store.getDispatchPort(), _buildDispatchHandlers());
        _dispatchServer.start().catch(e => console.error('[Phase17] Dispatch auto-start failed:', e));
      }
    }
  })();

  // Phase 33 — Start runbook deadline scheduler
  if (!_runbookScheduler) {
    _runbookScheduler = new RunbookScheduler(store, () => _buildRunbookExecutor());
    _runbookScheduler.start();
  }

  // ── Section 8 — Desktop Operator Engine ──────────────────────────────────────

  /** Return honest capability map for the current platform. */
  ipcMain.handle('operator:capability', async () => {
    try {
      return { ok: true, capability: await OperatorService.getCapabilityMap() };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /** List all visible running apps. Read-only, no approval required. */
  ipcMain.handle('operator:target:list', async () => {
    try {
      const apps = await OperatorService.listRunningApps();
      return { ok: true, apps };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /** Get the currently focused app and window title. Read-only. */
  ipcMain.handle('operator:target:frontmost', async () => {
    try {
      const target = await OperatorService.getFrontmostApp();
      return { ok: true, target };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /** Focus a named app. No approval required (focus-only risk). */
  ipcMain.handle('operator:target:focus', async (_e, appName: string) => {
    if (!appName || typeof appName !== 'string') {
      return { ok: false, error: 'appName is required' };
    }
    const session = OperatorService.startSession(appName);
    const action = OperatorService.buildAction(session.id, 'focus_app', { target: appName });
    try {
      const result = await OperatorService.executeAction(action);
      eventBus.emit({
        type: result.outcome === 'success' ? 'OPERATOR_TARGET_CONFIRMED' : 'OPERATOR_ACTION_FAILED',
        sessionId: session.id,
        ...(result.outcome === 'success'
          ? { appName }
          : { actionId: action.id, actionType: 'focus_app', error: result.error ?? 'focus failed' }),
      } as never);
      return { ok: result.outcome === 'success', result };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /** Capture the current screen. Returns path to the saved PNG. */
  ipcMain.handle('operator:perception:screenshot', async (_e, outputPath?: string) => {
    try {
      const res = await OperatorService.captureScreen(outputPath);
      if (res.ok && res.path) {
        eventBus.emit({ type: 'OPERATOR_SCREENSHOT_TAKEN', sessionId: 'standalone', path: res.path });
      }
      return res;
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /** Capture the current screen and return it as a base64 data URL for live view rendering. */
  ipcMain.handle('operator:screenshot:base64', async () => {
    try {
      const res = await OperatorService.captureScreen();
      if (!res.ok || !res.path) return { ok: false, error: res.error ?? 'Screenshot failed.' };
      const buf = fs.readFileSync(res.path);
      return { ok: true, dataUrl: 'data:image/png;base64,' + buf.toString('base64') };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ── Operator Task Runner — autonomous sense-plan-act loop ────────────────────
  //
  // ── Operator narration helper ─────────────────────────────────────────────
  // Converts a raw TaskProgressEvent into a human-readable sentence for Chat.

  function buildNarrationMessage(ev: {
    step:                number;
    phase:               string;
    description:         string;
    action?:             { type?: string; target?: string; text?: string; keyCombo?: string; appName?: string };
    continuationSummary?: string;
  }): string {
    const a = ev.action;
    switch (ev.phase) {
      case 'observe': return `Step ${ev.step}: Taking screenshot and reading the screen.`;
      case 'plan':    return `Step ${ev.step}: Deciding what to do next.`;
      case 'act':
        if (!a) return `Step ${ev.step}: ${ev.description}`;
        if (a.type === 'click')  return `Step ${ev.step}: Clicking "${a.target ?? 'element'}"`;
        if (a.type === 'type')   return `Step ${ev.step}: Typing "${(a.text ?? '').slice(0, 40)}"`;
        if (a.type === 'key')    return `Step ${ev.step}: Pressing ${a.keyCombo}`;
        if (a.type === 'focus')  return `Step ${ev.step}: Switching to ${a.appName ?? a.target}`;
        if (a.type === 'wait')   return `Step ${ev.step}: Waiting for screen to settle.`;
        return `Step ${ev.step}: ${ev.description}`;
      case 'verify':  return `Step ${ev.step}: Verifying the action worked.`;
      case 'done':    return `Done. ${ev.description}`;
      case 'blocked': return `Blocked at step ${ev.step}: ${ev.description}`;
      case 'error':   return `Error at step ${ev.step}: ${ev.description}`;
      case 'continuation_prompt':
        return `${ev.continuationSummary ?? ev.description} Want me to continue?`;
      default:        return `Step ${ev.step}: ${ev.description}`;
    }
  }

  // Runs a natural-language goal against the user's live desktop via a
  // repeating observe→plan→act→verify loop. This is the core "remote access
  // person" capability: it sees the screen, decides what to do, executes it,
  // and reports back — one step at a time, with approval gates for input actions.

  ipcMain.handle('operator:task:run', async (event, payload: {
    sessionId:           string;
    goal:                string;
    maxSteps?:           number;
    priorApprovedAction?: string;
  }) => {
    if (!payload?.goal || !payload?.sessionId) {
      return { ok: false, error: 'goal and sessionId are required' };
    }
    try {
      // Wire API key from store before every task run so visionAnalyzer + script generation
      // always have the latest key even if the user added it after app startup.
      const claudeKeyForTask = await store.getSecret('triforge.claude.apiKey');
      if (claudeKeyForTask) {
        setVisionApiKey(claudeKeyForTask);
        setScriptGenKey(claudeKeyForTask);
      }

      // ── B4: Create a durable WorkerRun for this operator task ────────────
      // Direct AI Task Runs (operator:task:run) previously had no persistent
      // record at all — only workflow-pack runs were captured. We now create
      // a WorkerRun in 'running' state and feed per-step transcript records
      // via the runner's workerHooks. The hooks are exception-safe and the
      // run is settled in onRunEnd regardless of how the runner exits.
      const wrQueue   = _getWorkerRunQueue();
      const workerRun = wrQueue.createRun({
        source:            'operate',
        goal:              payload.goal,
        operatorSessionId: payload.sessionId,
        contextSnapshot:   { source: 'operator:task:run', maxSteps: payload.maxSteps ?? 15 },
      });
      wrQueue.transitionStatus(workerRun.id, 'running');

      const { runOperatorTask } = await import('./services/operatorTaskRunner.js');
      const result = await runOperatorTask({
        sessionId:           payload.sessionId,
        goal:                payload.goal,
        maxSteps:            payload.maxSteps ?? 15,
        priorApprovedAction: payload.priorApprovedAction,
        onProgress: (ev) => {
          if (!event.sender.isDestroyed()) {
            event.sender.send('operator:task:progress', ev);
            // Step 6: Narration channel — live operator commentary in Chat
            event.sender.send('chat:operator-narration', {
              step:      ev.step,
              phase:     ev.phase,
              message:   buildNarrationMessage(ev as Parameters<typeof buildNarrationMessage>[0]),
              timestamp: Date.now(),
            });
          }
        },
        workerHooks: {
          onStepBegin: (info) => {
            try {
              const wstep = wrQueue.addStep({
                runId: workerRun.id,
                title: info.title,
                type:  'operator',
                input: {
                  index:       info.index,
                  actionType:  info.action.type,
                  description: info.action.description,
                  target:      info.action.target,
                  text:        info.action.text ? info.action.text.slice(0, 200) : undefined,
                  keyCombo:    info.action.keyCombo,
                  appName:     info.action.appName,
                },
              });
              wrQueue.startStep(workerRun.id, wstep.id);
              return wstep.id;
            } catch (err) {
              console.error('[operator:task:run] onStepBegin failed:', err);
              return undefined;
            }
          },
          onStepEnd: (info) => {
            try {
              if (info.screenshotPath && info.stepId) {
                wrQueue.addArtifact({
                  runId:  workerRun.id,
                  stepId: info.stepId,
                  kind:   'screenshot',
                  path:   info.screenshotPath,
                  meta:   { stepIndex: info.index, status: info.status },
                });
              }
              if (!info.stepId) return;
              if (info.status === 'completed') {
                wrQueue.completeStep(workerRun.id, info.stepId, info.output);
              } else if (info.status === 'failed') {
                wrQueue.failStep(workerRun.id, info.stepId, info.error ?? 'Step failed');
              } else if (info.status === 'blocked') {
                wrQueue.failStep(workerRun.id, info.stepId, info.error ?? 'Step blocked');
              } else if (info.status === 'waiting_approval') {
                // Mark the step complete with an approval marker — the run-level
                // status (set in onRunEnd) carries the waiting_approval state.
                wrQueue.completeStep(workerRun.id, info.stepId, { ...(info.output ?? {}), settled: 'waiting_approval' });
              }
            } catch (err) {
              console.error('[operator:task:run] onStepEnd failed:', err);
            }
          },
          onRunEnd: (info) => {
            try {
              switch (info.outcome) {
                case 'completed':
                  wrQueue.transitionStatus(workerRun.id, 'completed');
                  break;
                case 'approval_pending':
                  wrQueue.transitionStatus(workerRun.id, 'waiting_approval', {
                    kind:        'approval_required',
                    message:     info.summary,
                    recoverable: true,
                  });
                  break;
                case 'blocked':
                  wrQueue.transitionStatus(workerRun.id, 'blocked', {
                    kind:        'tool_failed',
                    message:     info.summary,
                    recoverable: false,
                  });
                  break;
                case 'max_steps_reached':
                  wrQueue.transitionStatus(workerRun.id, 'blocked', {
                    kind:        'user_input_required',
                    message:     info.summary,
                    recoverable: true,
                  });
                  break;
                case 'error':
                default:
                  wrQueue.transitionStatus(workerRun.id, 'failed');
                  break;
              }
            } catch (err) {
              console.error('[operator:task:run] onRunEnd failed:', err);
            }
          },
        },
      });
      return { ...result, workerRunId: workerRun.id };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e), stepsExecuted: 0, outcome: 'error', summary: String(e), steps: [] };
    }
  });

  /** Get the current machine perception (frontmost app + optional screenshot). */
  ipcMain.handle('operator:perception:perceive', async () => {
    try {
      const perception = await OperatorService.perceive();
      return { ok: true, perception };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /**
   * Full visual perception: screenshot + OCR + frontmost app.
   * Use this as the "observe" step in the autonomous agent loop.
   * Returns ocrText alongside the screenshot path.
   */
  ipcMain.handle('operator:perception:perceive-with-ocr', async (_e, outputPath?: string) => {
    try {
      const perception = await OperatorService.perceiveWithOCR(outputPath);
      return { ok: true, perception };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /**
   * Scan for all known apps (Adobe, Blender, DAWs, mobile dev, etc.)
   * and return which are running, installed, and frontmost.
   * Used by the Operate UI and council awareness snapshot.
   */
  ipcMain.handle('operator:apps:scan', async () => {
    try {
      const [runningApps, frontmost] = await Promise.all([
        OperatorService.listRunningApps(),
        OperatorService.getFrontmostApp(),
      ]);
      const detected = buildAppAwarenessSnapshot(
        runningApps,
        frontmost?.appName,
        frontmost?.windowTitle,
      );
      const summary  = formatAppAwarenessSummary(detected);
      return { ok: true, detected, summary };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ── iOS ──────────────────────────────────────────────────────────────────────

  /**
   * Scan all iOS simulators + connected real devices.
   * Returns the full iOSAwarenessSnapshot with booted/available simulators
   * and any physically connected devices.
   */
  ipcMain.handle('ios:scan', async () => {
    try {
      const runningApps = await OperatorService.listRunningApps();
      const frontmost   = await OperatorService.getFrontmostApp();
      const snapshot    = await buildIOSAwarenessSnapshot(runningApps, frontmost?.windowTitle);
      const summary     = formatIOSSummary(snapshot);
      return { ok: true, snapshot, summary };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /** Boot a simulator by UDID. */
  ipcMain.handle('ios:simulator:boot', async (_e, udid: string) => {
    if (!udid) return { ok: false, error: 'udid required' };
    try {
      const result = await bootSimulator(udid);
      return result;
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /** Capture a screenshot from a booted simulator. */
  ipcMain.handle('ios:simulator:screenshot', async (_e, udid: string, outputPath?: string) => {
    if (!udid) return { ok: false, error: 'udid required' };
    try {
      const result = await captureSimulatorScreen(udid, outputPath);
      return result;
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ── Android ──────────────────────────────────────────────────────────────────

  /**
   * Scan all connected Android devices, running emulators, available AVDs,
   * and detect a Gradle project in the current working directory.
   */
  ipcMain.handle('android:scan', async (_e, projectPath?: string) => {
    try {
      const { buildAndroidAwarenessSnapshot, formatAndroidSummary } =
        await import('./services/androidAwareness.js');
      const runningApps = await OperatorService.listRunningApps();
      const snapshot    = await buildAndroidAwarenessSnapshot(runningApps, projectPath);
      const summary     = formatAndroidSummary(snapshot);
      return { ok: true, snapshot, summary };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /** Capture a screenshot from a connected device or emulator via ADB. */
  ipcMain.handle('android:screenshot', async (_e, serial: string, outputPath?: string) => {
    if (!serial) return { ok: false, error: 'serial required' };
    try {
      const { buildAndroidAwarenessSnapshot, captureAndroidScreen } =
        await import('./services/androidAwareness.js');
      const runningApps = await OperatorService.listRunningApps();
      const snapshot    = await buildAndroidAwarenessSnapshot(runningApps);
      if (!snapshot.adbPath) return { ok: false, error: 'ADB not found.' };
      const result = await captureAndroidScreen(snapshot.adbPath, serial, outputPath);
      return result;
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /** Send a tap at (x, y) to a connected Android device or emulator. */
  ipcMain.handle('android:tap', async (_e, serial: string, x: number, y: number) => {
    if (!serial) return { ok: false, error: 'serial required' };
    try {
      const { buildAndroidAwarenessSnapshot, androidTap } =
        await import('./services/androidAwareness.js');
      const runningApps = await OperatorService.listRunningApps();
      const snapshot    = await buildAndroidAwarenessSnapshot(runningApps);
      if (!snapshot.adbPath) return { ok: false, error: 'ADB not found.' };
      return await androidTap(snapshot.adbPath, serial, x, y);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ── Cloud Relay ───────────────────────────────────────────────────────────────

  /** Register this device with a relay server (first-time setup). */
  ipcMain.handle('relay:register', async (_e, relayUrl: string, label?: string) => {
    const { registerDevice } = await import('./services/relayClient.js');
    return registerDevice(relayUrl, label);
  });

  /** Configure relay with existing credentials and start polling. */
  ipcMain.handle('relay:connect', async (_e, creds?: {
    deviceId: string; deviceSecret: string; relayUrl: string;
  }) => {
    try {
      const rc = await import('./services/relayClient.js');
      if (creds) {
        rc.configureRelay(creds);
      } else {
        const loaded = rc.loadSavedCredentials();
        if (!loaded) return { ok: false, error: 'No saved credentials. Call relay:register first.' };
      }
      const state = rc.startRelayClient();
      return { ok: true, state };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /** Disconnect from the relay. */
  ipcMain.handle('relay:disconnect', async () => {
    const { stopRelayClient, getRelayState } = await import('./services/relayClient.js');
    stopRelayClient();
    return { ok: true, state: getRelayState() };
  });

  /** Get current relay connection state. */
  ipcMain.handle('relay:status', async () => {
    const { getRelayState } = await import('./services/relayClient.js');
    return { ok: true, state: getRelayState() };
  });

  /** Submit a test job from the desktop (verifies relay end-to-end). */
  ipcMain.handle('relay:submit-job', async (_e, packId: string, opts?: Record<string, unknown>, label?: string) => {
    const { submitLocalJob } = await import('./services/relayClient.js');
    return submitLocalJob(packId, opts ?? {}, label);
  });

  /** Check status of a specific relay job. */
  ipcMain.handle('relay:job-status', async (_e, jobId: string) => {
    const { getJobStatus } = await import('./services/relayClient.js');
    return getJobStatus(jobId);
  });

  /** Clear relay credentials and disconnect. */
  ipcMain.handle('relay:clear', async () => {
    const { clearRelayCredentials } = await import('./services/relayClient.js');
    clearRelayCredentials();
    return { ok: true };
  });

  // ── Vision / OSK / Screen Watch ──────────────────────────────────────────────

  /** Describe what is currently on screen using Claude vision. */
  ipcMain.handle('vision:describe', async (_e, screenshotPath?: string) => {
    try {
      const { describeScreen } = await import('./services/visionAnalyzer.js');
      const { OperatorService } = await import('./services/operatorService.js');
      let imgPath = screenshotPath;
      if (!imgPath) {
        const result = await OperatorService.captureScreen();
        if (!result.ok) return { ok: false, error: result.error };
        imgPath = result.path!;
      }
      const desc = await describeScreen(imgPath);
      return { ok: true, description: desc, screenshotPath: imgPath };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /** Find a UI element's coordinates using Claude vision. */
  ipcMain.handle('vision:locate', async (_e, elementDescription: string, screenshotPath?: string) => {
    try {
      const { locateElement } = await import('./services/visionAnalyzer.js');
      const { OperatorService } = await import('./services/operatorService.js');
      let imgPath = screenshotPath;
      if (!imgPath) {
        const result = await OperatorService.captureScreen();
        if (!result.ok) return { ok: false, error: result.error };
        imgPath = result.path!;
      }
      const loc = await locateElement(imgPath, elementDescription);
      return { ok: true, location: loc, screenshotPath: imgPath };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /** Ask a freeform question about what's on screen. */
  ipcMain.handle('vision:ask', async (_e, question: string, screenshotPath?: string) => {
    try {
      const { askAboutScreen } = await import('./services/visionAnalyzer.js');
      const { OperatorService } = await import('./services/operatorService.js');
      let imgPath = screenshotPath;
      if (!imgPath) {
        const result = await OperatorService.captureScreen();
        if (!result.ok) return { ok: false, error: result.error };
        imgPath = result.path!;
      }
      const answer = await askAboutScreen(imgPath, question);
      return { ok: true, answer, screenshotPath: imgPath };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /** Get on-screen keyboard status. */
  ipcMain.handle('osk:status', async () => {
    try {
      const { getOSKStatus, getOSKRecommendationMessage } = await import('./services/oskManager.js');
      const status = await getOSKStatus();
      return { ok: true, ...status, recommendation: getOSKRecommendationMessage() };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /** Open the on-screen keyboard. */
  ipcMain.handle('osk:open', async () => {
    try {
      const { ensureOSKOpen, getOSKBounds } = await import('./services/oskManager.js');
      const result = await ensureOSKOpen();
      const bounds = await getOSKBounds();
      return { ...result, bounds };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /** Close the on-screen keyboard. */
  ipcMain.handle('osk:close', async () => {
    try {
      const { closeOSK } = await import('./services/oskManager.js');
      await closeOSK();
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /** Start the background screen change monitor. */
  ipcMain.handle('screen-watch:start', async (_e, config?: {
    intervalMs?: number;
    changeThreshold?: number;
    visionOnChange?: boolean;
  }) => {
    try {
      const { startScreenWatcher } = await import('./services/screenWatcher.js');
      const state = startScreenWatcher(config ?? {});
      return { ok: true, state };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /** Stop the screen change monitor. */
  ipcMain.handle('screen-watch:stop', async () => {
    try {
      const { stopScreenWatcher, getScreenWatcherState } = await import('./services/screenWatcher.js');
      const state = getScreenWatcherState();
      stopScreenWatcher();
      return { ok: true, finalState: state };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /** Return the current watcher state (running, changeCount, etc.). */
  ipcMain.handle('screen-watch:status', async () => {
    try {
      const { getScreenWatcherState } = await import('./services/screenWatcher.js');
      return { ok: true, ...getScreenWatcherState() };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /** One-shot: did the screen change since the last check? */
  ipcMain.handle('screen-watch:check', async () => {
    try {
      const { checkScreenChanged } = await import('./services/screenWatcher.js');
      return await checkScreenChanged();
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /** Get connected keyboard/mouse devices. */
  ipcMain.handle('devices:list', async () => {
    try {
      const { getConnectedDevices } = await import('./services/deviceEventWatcher.js');
      const devices = await getConnectedDevices();
      return { ok: true, devices };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /** Check if a physical keyboard is connected. */
  ipcMain.handle('devices:has-keyboard', async () => {
    try {
      const { hasPhysicalKeyboard } = await import('./services/deviceEventWatcher.js');
      const has = await hasPhysicalKeyboard();
      return { ok: true, hasPhysicalKeyboard: has };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ── Social Media Publishing ───────────────────────────────────────────────────

  /** Check which social platforms are currently authenticated. */
  ipcMain.handle('social:auth:status', async () => {
    try {
      const { getAuthStatus } = await import('./services/credentialStore.js');
      return { ok: true, status: getAuthStatus() };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /** Disconnect a social platform (clears stored OAuth tokens). */
  ipcMain.handle('social:auth:disconnect', async (_e, platform: string) => {
    try {
      const { disconnectPlatform } = await import('./services/socialPublisher.js');
      disconnectPlatform(platform as import('./services/credentialStore').SocialPlatform);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /**
   * Start an OAuth flow for a social platform.
   * Opens the browser; waits up to 5 minutes for the user to authorize.
   */
  ipcMain.handle('social:auth:connect', async (
    _e,
    platform: string,
    credentials: Record<string, string>,
  ) => {
    try {
      const sp = await import('./services/socialPublisher.js');
      let result: { ok: boolean; error?: string };

      if (platform === 'youtube') {
        result = await sp.connectYouTube({ clientId: credentials.clientId, clientSecret: credentials.clientSecret });
      } else if (platform === 'facebook') {
        result = await sp.connectFacebook({ appId: credentials.appId, appSecret: credentials.appSecret });
      } else if (platform === 'instagram') {
        result = await sp.connectInstagram({ appId: credentials.appId, appSecret: credentials.appSecret });
      } else if (platform === 'tiktok') {
        result = await sp.connectTikTok({ clientKey: credentials.clientKey, clientSecret: credentials.clientSecret });
      } else {
        result = { ok: false, error: `Unknown platform: ${platform}` };
      }

      return result;
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /**
   * Publish a local file to a social platform.
   * opts: { filePath, caption?, videoTitle?, isVideo?, youtubePrivacy?, tiktokPrivacy? }
   */
  ipcMain.handle('social:publish', async (
    _e,
    platform: string,
    credentials: Record<string, string>,
    publishOpts: {
      filePath:      string;
      caption?:      string;
      videoTitle?:   string;
      isVideo?:      boolean;
      youtubePrivacy?: 'public' | 'unlisted' | 'private';
      tiktokPrivacy?: string;
    },
  ) => {
    try {
      const sp = await import('./services/socialPublisher.js');
      const { filePath, caption = '', videoTitle, isVideo = false } = publishOpts;

      if (platform === 'youtube') {
        return await sp.publishToYouTube(
          { clientId: credentials.clientId, clientSecret: credentials.clientSecret },
          filePath,
          { title: videoTitle ?? caption, description: caption, privacy: publishOpts.youtubePrivacy ?? 'private' },
        );
      }
      if (platform === 'facebook') {
        return await sp.publishToFacebook(filePath, caption, isVideo, videoTitle);
      }
      if (platform === 'instagram') {
        return await sp.publishToInstagram(filePath, caption, isVideo);
      }
      if (platform === 'tiktok') {
        return await sp.publishToTikTok(
          { clientKey: credentials.clientKey, clientSecret: credentials.clientSecret },
          filePath,
          { title: videoTitle ?? caption, privacyLevel: publishOpts.tiktokPrivacy as import('./services/platforms/tiktokClient').TikTokVideoMeta['privacyLevel'] },
        );
      }
      return { ok: false, error: `Unknown platform: ${platform}` };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /** Start an operator session and return the session ID. */
  ipcMain.handle('operator:session:start', async (_e, intendedTarget?: string) => {
    try {
      const session = OperatorService.startSession(intendedTarget ?? null);
      eventBus.emit({
        type: 'OPERATOR_SESSION_STARTED',
        sessionId: session.id,
        intendedTarget: session.intendedTarget,
      });
      return { ok: true, session };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /** Stop an operator session. */
  ipcMain.handle('operator:session:stop', async (_e, sessionId: string, reason?: string) => {
    try {
      const stopped = OperatorService.stopSession(sessionId, reason);
      if (stopped) {
        const session = OperatorService.getSession(sessionId);
        eventBus.emit({
          type: 'OPERATOR_SESSION_ENDED',
          sessionId,
          status: 'stopped',
          actionCount: session?.actions.length ?? 0,
        });
      }
      return { ok: stopped };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /**
   * Set the trust level for an active operator session.
   * 'supervised' — every input action requires human approval (default).
   * 'trusted'    — input actions execute immediately; all logged to audit trail.
   */
  ipcMain.handle('operator:session:trust', async (_e, sessionId: string, level: 'supervised' | 'trusted') => {
    if (!sessionId) return { ok: false, error: 'sessionId required' };
    if (level !== 'supervised' && level !== 'trusted') return { ok: false, error: 'level must be supervised or trusted' };
    try {
      const ok = OperatorService.setSessionTrust(sessionId, level);
      return { ok };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /** List all operator sessions (active and historical). */
  ipcMain.handle('operator:session:list', async () => {
    try {
      return { ok: true, sessions: OperatorService.listSessions() };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /**
   * Queue an input action (type_text or send_key) for approval.
   * Returns { outcome: 'approval_pending', approvalId } immediately.
   * The action only executes after operator:approval:approve is called.
   */
  ipcMain.handle('operator:action:queue', async (
    _e,
    sessionId: string,
    actionType: 'type_text' | 'send_key' | 'click_at',
    opts: { text?: string; key?: string; modifiers?: string[]; x?: number; y?: number; button?: 'left' | 'right' | 'double' },
  ) => {
    if (!sessionId) return { ok: false, error: 'sessionId required' };
    const session = OperatorService.getSession(sessionId);
    if (!session) return { ok: false, error: `Session "${sessionId}" not found` };
    if (session.status !== 'active') {
      return { ok: false, error: `Session "${sessionId}" is ${session.status}, not active` };
    }

    const action = OperatorService.buildAction(sessionId, actionType, {
      text:      opts.text,
      key:       opts.key,
      modifiers: (opts.modifiers ?? []) as Array<'cmd' | 'shift' | 'alt' | 'ctrl'>,
      x:         opts.x,
      y:         opts.y,
      button:    opts.button,
    });

    try {
      const result = await OperatorService.executeAction(action);
      if (result.approvalId) {
        eventBus.emit({
          type: 'OPERATOR_ACTION_QUEUED',
          sessionId,
          actionId: action.id,
          actionType,
          approvalId: result.approvalId,
        });
      }
      return { ok: true, result };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /** List all pending operator approval requests. */
  ipcMain.handle('operator:approval:list', async () => {
    try {
      return { ok: true, approvals: OperatorService.listPendingApprovals() };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /**
   * Approve and immediately execute a queued input action.
   * Performs wrong-target validation before executing.
   */
  ipcMain.handle('operator:approval:approve', async (_e, approvalId: string, approvedBy = 'local_ui') => {
    if (!approvalId) return { ok: false, error: 'approvalId required' };
    try {
      const approval = OperatorService.getApproval(approvalId);
      if (!approval) return { ok: false, error: 'Approval not found' };

      eventBus.emit({
        type: 'OPERATOR_ACTION_APPROVED',
        sessionId: approval.sessionId,
        actionId: approval.action.id,
        approvalId,
      });

      const result = await OperatorService.executeApprovedAction(approvalId, approvedBy);

      if (result.outcome === 'success') {
        eventBus.emit({
          type: 'OPERATOR_ACTION_EXECUTED',
          sessionId: approval.sessionId,
          actionId: approval.action.id,
          actionType: approval.action.type,
          outcome: result.outcome,
          durationMs: result.durationMs,
        });
      } else if (result.outcome === 'permission_denied') {
        eventBus.emit({
          type: 'OPERATOR_PERMISSION_DENIED',
          sessionId: approval.sessionId,
          permission: 'accessibility',
        });
      } else if (result.outcome === 'wrong_target') {
        eventBus.emit({
          type: 'OPERATOR_TARGET_LOST',
          sessionId: approval.sessionId,
          expected: approval.action.target ?? approval.sessionId,
          actual: result.executedTarget?.appName ?? 'unknown',
        });
      } else {
        eventBus.emit({
          type: 'OPERATOR_ACTION_FAILED',
          sessionId: approval.sessionId,
          actionId: approval.action.id,
          actionType: approval.action.type,
          error: result.error ?? result.outcome,
        });
      }

      return { ok: result.outcome === 'success', result };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /** Deny a pending operator approval request. */
  ipcMain.handle('operator:approval:deny', async (_e, approvalId: string, reason?: string) => {
    if (!approvalId) return { ok: false, error: 'approvalId required' };
    try {
      const approval = OperatorService.getApproval(approvalId);
      const denied = OperatorService.denyApproval(approvalId, reason);
      if (denied && approval) {
        eventBus.emit({
          type: 'OPERATOR_ACTION_DENIED',
          sessionId: approval.sessionId,
          actionId: approval.action.id,
          approvalId,
          reason,
        });
      }
      return { ok: denied };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ── Section 9 — Workflow Packs ────────────────────────────────────────────────

  /** List all available workflow packs. */
  ipcMain.handle('workflow:list', async () => {
    try {
      return { ok: true, packs: WorkflowPackService.listPacks() };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /** Get a single workflow pack by ID. */
  ipcMain.handle('workflow:get', async (_e, packId: string) => {
    try {
      const pack = WorkflowPackService.getPack(packId);
      if (!pack) return { ok: false, error: `Pack "${packId}" not found` };
      return { ok: true, pack };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /**
   * Evaluate readiness for a workflow pack.
   * Returns blockers with remediations if the pack cannot run now.
   */
  ipcMain.handle('workflow:readiness', async (_e, packId: string, targetApp?: string) => {
    try {
      const result = await WorkflowPackService.evaluateReadiness(packId, targetApp);
      if (!result) return { ok: false, error: `Pack "${packId}" not found` };
      return { ok: true, readiness: result };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /** Evaluate readiness for all workflow packs in one call. */
  ipcMain.handle('workflow:readiness:all', async () => {
    try {
      const results = await WorkflowPackService.evaluateAllReadiness();
      return { ok: true, results };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /**
   * Start a workflow run.
   * For pack.readiness-check and pack.app-context: completes synchronously.
   * For pack.focus-capture: completes if Screen Recording is granted.
   * For pack.supervised-input: pauses at approval gate — call workflow:run:advance after approving.
   */
  ipcMain.handle('workflow:run:start', async (
    _e,
    packId: string,
    opts: {
      targetApp?: string;
      inputText?: string;
      inputKey?: string;
      inputModifiers?: string[];
      screenshotOutputPath?: string;
    } = {},
  ) => {
    try {
      // ── Free-tier daily quota gate ────────────────────────────────────────
      // Free users get FREE_DAILY_OPERATOR_RUNS workflow runs per day. This
      // is the "real taste, not a wall" path: they can feel the operator
      // once a day before deciding to upgrade. Pro/business have no cap.
      const license = await store.getLicense();
      const tier    = (license.tier ?? 'free') as 'free' | 'pro' | 'business';
      const used    = store.getDailyOperatorRunCount();
      if (isAtDailyOperatorLimit(used, tier)) {
        return {
          ok:    false,
          error: `DAILY_OPERATOR_LIMIT_REACHED:${FREE_DAILY_OPERATOR_RUNS}`,
          tier,
          message:
            `Free tier includes ${FREE_DAILY_OPERATOR_RUNS} operator workflow run per day. ` +
            `Upgrade to Pro for unlimited runs, or come back tomorrow.`,
        };
      }

      const result = await WorkflowPackService.startRun(packId, {
        targetApp:             opts.targetApp,
        inputText:             opts.inputText,
        inputKey:              opts.inputKey,
        inputModifiers:        opts.inputModifiers as Array<'cmd'|'shift'|'alt'|'ctrl'> | undefined,
        screenshotOutputPath:  opts.screenshotOutputPath,
      });

      // Only count successful starts toward the quota — failed pre-flights
      // shouldn't burn the user's daily allowance.
      if (result && (result as { ok?: boolean }).ok !== false) {
        store.incrementDailyOperatorRunCount();
      }

      return result;
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /**
   * Advance a workflow run that is paused at an approval gate.
   * Call this after the operator approval has been granted via operator:approval:approve.
   */
  ipcMain.handle('workflow:run:advance', async (_e, runId: string, opts: Record<string, unknown> = {}) => {
    try {
      const result = await WorkflowPackService.advanceRun(runId, opts as import('@triforge/engine').WorkflowRunOptions);
      return result;
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /** List all workflow runs (active and completed). */
  ipcMain.handle('workflow:run:list', async () => {
    try {
      return { ok: true, runs: WorkflowPackService.listRuns() };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /** Get a specific workflow run. */
  ipcMain.handle('workflow:run:get', async (_e, runId: string) => {
    try {
      const run = WorkflowPackService.getRun(runId);
      if (!run) return { ok: false, error: `Run "${runId}" not found` };
      return { ok: true, run };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /** Stop an active workflow run. */
  ipcMain.handle('workflow:run:stop', async (_e, runId: string) => {
    try {
      const stopped = WorkflowPackService.stopRun(runId);
      return { ok: stopped };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ── Phase C1 — Workflow Chains (multi-app composition) ──────────────────────

  /** List all available workflow chains. */
  ipcMain.handle('workflow-chain:list', async () => {
    try {
      return { ok: true, chains: WorkflowChainService.listChains() };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /** Get a single workflow chain by ID. */
  ipcMain.handle('workflow-chain:get', async (_e, chainId: string) => {
    try {
      const chain = WorkflowChainService.getChain(chainId);
      if (!chain) return { ok: false, error: `Chain "${chainId}" not found` };
      return { ok: true, chain };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /**
   * Start a workflow chain run. Each link is gated by the same daily-operator
   * quota that governs single packs — the first link's start consumes one slot
   * and subsequent links proceed without further quota checks for the same chain.
   */
  ipcMain.handle('workflow-chain:start', async (_e, chainId: string, initialState: Record<string, unknown> = {}) => {
    try {
      const license = await store.getLicense();
      const tier    = (license.tier ?? 'free') as 'free' | 'pro' | 'business';
      const used    = store.getDailyOperatorRunCount();
      if (isAtDailyOperatorLimit(used, tier)) {
        return {
          ok:    false,
          error: `DAILY_OPERATOR_LIMIT_REACHED:${FREE_DAILY_OPERATOR_RUNS}`,
          tier,
          message:
            `Free tier includes ${FREE_DAILY_OPERATOR_RUNS} operator workflow run per day. ` +
            `Upgrade to Pro for unlimited runs, or come back tomorrow.`,
        };
      }

      const result = await WorkflowChainService.startChain(
        chainId,
        initialState as Parameters<typeof WorkflowChainService.startChain>[1],
      );

      if (result.ok) store.incrementDailyOperatorRunCount();
      return result;
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /**
   * Advance a chain that is paused on a link approval gate.
   * The user must first approve the underlying link via operator:approval:approve
   * + workflow:run:advance, then call this to continue the chain.
   */
  ipcMain.handle('workflow-chain:advance', async (_e, chainRunId: string) => {
    try {
      return await WorkflowChainService.advanceChain(chainRunId);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /** List all chain runs (active and completed). */
  ipcMain.handle('workflow-chain:run:list', async () => {
    try {
      return { ok: true, runs: WorkflowChainService.listRuns() };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /** Get a specific chain run. */
  ipcMain.handle('workflow-chain:run:get', async (_e, runId: string) => {
    try {
      const run = WorkflowChainService.getRun(runId);
      if (!run) return { ok: false, error: `Chain run "${runId}" not found` };
      return { ok: true, run };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /** Cancel a chain run. */
  ipcMain.handle('workflow-chain:run:cancel', async (_e, runId: string) => {
    try {
      const ok = WorkflowChainService.cancelRun(runId);
      return { ok };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ── Pack Builder — custom pack CRUD ──────────────────────────────────────────

  /** List all user-built custom packs. */
  ipcMain.handle('pack-builder:list', () => {
    try {
      return { ok: true, packs: WorkflowPackService.listCustomPacks() };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /** Save (create or update) a custom pack. */
  ipcMain.handle('pack-builder:save', (_e, pack: import('@triforge/engine').WorkflowPack) => {
    try {
      if (!pack?.id) return { ok: false, error: 'Pack must have an id.' };
      WorkflowPackService.saveCustomPack(pack);
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /** Delete a custom pack by ID. */
  ipcMain.handle('pack-builder:delete', (_e, id: string) => {
    try {
      const deleted = WorkflowPackService.deleteCustomPack(id);
      return { ok: deleted, error: deleted ? undefined : 'Pack not found.' };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /**
   * Export a custom pack as a portable JSON manifest the user can share or
   * publish to a marketplace. Wraps the raw pack with a manifest envelope so
   * future versions can detect and migrate old exports.
   */
  ipcMain.handle('pack-builder:export', async (_e, id: string) => {
    try {
      const all = WorkflowPackService.listCustomPacks() as Array<{ id: string; name?: string }>;
      const pack = all.find(p => p.id === id);
      if (!pack) return { ok: false, error: 'Pack not found.' };

      const manifest = {
        kind:        'triforge.pack',
        manifestVer: 1,
        exportedAt:  new Date().toISOString(),
        exportedBy:  store.getAuth().username ?? 'TriForge user',
        pack,
      };

      const safeName = (pack.name || pack.id).replace(/[^a-z0-9._-]+/gi, '-').slice(0, 60);
      const result = await dialog.showSaveDialog({
        title:       'Export TriForge Pack',
        defaultPath: path.join(os.homedir(), 'Downloads', `${safeName}.triforge-pack.json`),
        filters:     [{ name: 'TriForge Pack', extensions: ['json'] }],
      });
      if (!result.filePath) return { ok: false };

      await fs.promises.writeFile(result.filePath, JSON.stringify(manifest, null, 2), 'utf8');
      try { shell.showItemInFolder(result.filePath); } catch { /* not fatal on headless test runs */ }
      return { ok: true, path: result.filePath };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /**
   * Import a pack manifest exported by pack-builder:export. Validates the
   * envelope, prefixes the imported id to avoid collisions with existing
   * packs, and persists via the same path as save.
   */
  ipcMain.handle('pack-builder:import', async () => {
    try {
      const result = await dialog.showOpenDialog({
        title:      'Import TriForge Pack',
        properties: ['openFile'],
        filters:    [{ name: 'TriForge Pack', extensions: ['json'] }],
      });
      if (result.canceled || result.filePaths.length === 0) return { ok: false };

      const raw = await fs.promises.readFile(result.filePaths[0], 'utf8');
      let parsed: unknown;
      try { parsed = JSON.parse(raw); } catch {
        return { ok: false, error: 'File is not valid JSON.' };
      }
      const env = parsed as { kind?: string; manifestVer?: number; pack?: { id?: string; name?: string } };
      if (env?.kind !== 'triforge.pack' || !env.pack?.id) {
        return { ok: false, error: 'Not a TriForge pack manifest.' };
      }

      // Suffix id to avoid clobbering an existing pack with the same id
      const existing = WorkflowPackService.listCustomPacks() as Array<{ id: string }>;
      let importedId = env.pack.id;
      if (existing.some(p => p.id === importedId)) {
        importedId = `${importedId}-imported-${Date.now().toString(36)}`;
      }
      const incoming = { ...env.pack, id: importedId } as import('@triforge/engine').WorkflowPack;

      WorkflowPackService.saveCustomPack(incoming);
      return { ok: true, packId: importedId, packName: env.pack.name ?? importedId };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ── Section 10 — Operator Safety Kill Switch ──────────────────────────────────

  /**
   * Disable all operator action execution immediately.
   * Pending approvals cannot execute while disabled.
   * Emits OPERATOR_DISABLED to the audit event bus.
   */
  ipcMain.handle('operator:safety:disable', async () => {
    try {
      OperatorService.setOperatorEnabled(false);
      eventBus.emit({ type: 'OPERATOR_DISABLED' });
      console.warn('[security] OPERATOR_DISABLED — operator kill switch activated');
      return { ok: true, enabled: false };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /**
   * Re-enable operator action execution.
   * Emits OPERATOR_ENABLED to the audit event bus.
   */
  ipcMain.handle('operator:safety:enable', async () => {
    try {
      OperatorService.setOperatorEnabled(true);
      eventBus.emit({ type: 'OPERATOR_ENABLED' });
      return { ok: true, enabled: true };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /** Get the current operator enabled/disabled state. */
  ipcMain.handle('operator:safety:status', async () => {
    try {
      return { ok: true, enabled: OperatorService.isOperatorEnabled() };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ── Worker Runtime — durable run persistence (Phase 1) ───────────────────

  /**
   * Create a new WorkerRun and persist it to disk.
   * The run starts in 'queued' status.
   */
  ipcMain.handle('workerRun:create', (_e, opts: CreateRunOptions) => {
    try {
      if (!opts?.goal || typeof opts.goal !== 'string' || opts.goal.trim().length === 0) {
        return { ok: false, error: 'goal is required' };
      }
      const run = _getWorkerRunQueue().createRun({ ...opts, goal: opts.goal.trim() });
      return { ok: true, run };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /**
   * List persisted WorkerRuns, most recent first.
   * Optional filter: { status } narrows by run status.
   */
  ipcMain.handle('workerRun:list', (_e, filter?: { status?: string }) => {
    try {
      const runs = _getWorkerRunQueue().listRuns(filter as Parameters<WorkerRunQueue['listRuns']>[0]);
      return { ok: true, runs };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /**
   * Get a single WorkerRun by ID, including its steps and artifact refs.
   */
  ipcMain.handle('workerRun:get', (_e, runId: string) => {
    try {
      const q    = _getWorkerRunQueue();
      const run  = q.getRun(runId);
      if (!run) return { ok: false, error: `WorkerRun "${runId}" not found` };
      const steps     = q.getSteps(runId);
      const artifacts = q.getArtifacts(runId);
      return { ok: true, run, steps, artifacts };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /**
   * Return all runs that were in a non-terminal state when the app started.
   * These were hydrated by workerRunHydrator on init() and may need user attention.
   * Any run that was 'running' at shutdown will appear here as 'blocked'.
   */
  ipcMain.handle('workerRun:resumeCandidates', () => {
    try {
      const candidates = _getWorkerRunQueue().getResumeCandidates();
      return { ok: true, runs: candidates };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /**
   * Cancel a WorkerRun. Only allowed if the run is in a non-terminal state.
   * Returns the updated run, or an error if already terminal.
   */
  ipcMain.handle('workerRun:cancel', (_e, runId: string) => {
    try {
      const run = _getWorkerRunQueue().cancel(runId);
      if (!run) return { ok: false, error: `Cannot cancel run "${runId}" — not found or already terminal` };
      return { ok: true, run };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  /**
   * Resume or recover a WorkerRun.
   *
   * Recovery semantics depend on run status:
   *   blocked / failed + saved pack metadata  → restart workflow from saved packId + targetApp
   *   waiting_approval + live WorkflowRun     → returns failReason: 'approval_live_use_panel'
   *   waiting_approval + dead WorkflowRun     → restart from saved metadata
   *   terminal / no metadata                  → structured failure
   *
   * On successful restart:
   *   • A new WorkerRun is created by the bridge when startRun() executes.
   *   • The old interrupted run is marked cancelled.
   *   • The new run will appear in the Sessions UI after the next refresh.
   *
   * NOTE: This is a restart, not a seamless resume. Execution begins from
   * phase 0 of the workflow pack — not from the exact point of interruption.
   */
  ipcMain.handle('workerRun:resume', async (_e, runId: string) => {
    try {
      if (!runId || typeof runId !== 'string') {
        return { ok: false, error: 'runId is required' };
      }
      return await _resumeWorkerRun(runId, _getWorkerRunQueue());
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }
  });

  // ── Project memory ─────────────────────────────────────────────────────────
  ipcMain.handle('project-memory:last', () => {
    try { return { project: getLastProject(), suggestion: getContinuationSuggestion() }; }
    catch { return { project: null, suggestion: null }; }
  });

  ipcMain.handle('project-memory:all', () => {
    try { return getAllProjects(); }
    catch { return []; }
  });

  ipcMain.handle('project-memory:forget', (_e, projectPath: string) => {
    try { forgetProject(projectPath); return { ok: true }; }
    catch (e) { return { ok: false, error: String(e) }; }
  });
}

// ── Prompt injection detection ─────────────────────────────────────────────────
// Runs before the inbound risk classifier on Telegram messages.
function _detectPromptInjection(text: string): boolean {
  const t = text.toLowerCase();
  return (
    /ignore (all )?(previous|above|prior) instructions?/.test(t) ||
    /you are now (a |an )?(?!triforge)/i.test(t) ||
    /\bact as\b.{0,30}\bai\b/i.test(t) ||
    /pretend (you are|to be)/i.test(t) ||
    /disregard (your|all) (previous|prior|system)/i.test(t) ||
    /\bjailbreak\b/i.test(t) ||
    /system prompt/.test(t) ||
    /\bdan mode\b/i.test(t)
  );
}

const BUNDLED_SKILL_EXAMPLES: Array<{ name: string; description: string; markdown: string }> = [
  {
    name: 'web-summary',
    description: 'Fetch a URL and return a 3-bullet summary',
    markdown: `---
name: web-summary
version: "1.0"
description: Fetches a URL and returns a concise 3-bullet summary of the content.
author: triforge-examples
permissions: []
network: true
requiresApproval: false
---

# Web Summary Skill

Fetch the provided URL and summarize the content in exactly 3 bullet points.
Each bullet should capture a key insight. Keep each bullet under 25 words.

## Input
- url: the web page to summarize

## Output
3 markdown bullet points summarizing the page content.
`,
  },
  {
    name: 'daily-standup',
    description: 'Draft a standup update from recent task activity',
    markdown: `---
name: daily-standup
version: "1.0"
description: Drafts a daily standup update based on recent completed tasks.
author: triforge-examples
permissions: []
requiresApproval: false
---

# Daily Standup Skill

Review the recent task history and draft a standup update in the format:
- What I completed yesterday
- What I am working on today
- Any blockers

Keep it concise, professional, and under 150 words total.
`,
  },
  {
    name: 'task-status-brief',
    description: 'Produce a one-paragraph status brief for a running task',
    markdown: `---
name: task-status-brief
version: "1.0"
description: Produces a one-paragraph executive status brief for the current task queue.
author: triforge-examples
permissions: []
requiresApproval: false
---

# Task Status Brief Skill

Review the current task queue and produce a single-paragraph executive status brief.
Include: number of tasks running, any blockers, expected completion signals.
Write for a non-technical reader. Maximum 80 words.
`,
  },
];

// ── Exported background service bootstrap — called from index.ts after store init
export async function restoreBackgroundServices(store: Store): Promise<void> {
  if (store.getBackgroundLoopEnabled()) {
    _getMissionManager(store).start();
    console.log('[Phase1.5] Background agent loop auto-restored');
  }

  if (store.getWebhookEnabled()) {
    const token = store.getWebhookToken();
    const port  = store.getWebhookPort();
    if (token) {
      const result = await startWebhookServer(port, token, (missionId) =>
        _getMissionManager(store).runMission(missionId),
      );
      if (result.ok) console.log(`[Phase1.5] Webhook server auto-restored on port ${port}`);
      else console.error('[Phase1.5] Webhook server restore failed:', result.error);
    }
  }

  if (store.getControlPlaneEnabled()) {
    const token = store.getControlPlaneToken();
    const port  = store.getControlPlanePort();
    if (token) {
      const cp = _controlPlane!;
      const result = await cp.start(port, token);
      if (result.ok) {
        store.setControlPlaneLastStartedAt(Date.now());
        console.log(`[Phase2] Control plane auto-restored on port ${port}`);
      } else {
        console.error('[Phase2] Control plane restore failed:', result.error);
      }
    }
  }
}

// ── Exported supervisor health tick — called by index.ts 30s interval ────────
export async function supervisorHealthTick(store: Store): Promise<void> {
  if (store.getBackgroundLoopEnabled()) {
    const mgr = _getMissionManager(store);
    if (!mgr.isRunning()) {
      console.error('[Phase1.5] Background agent loop stopped — supervisor restarting');
      mgr.start();
      broadcastBackgroundLoopStatus({ healthy: false, restarted: true });
    }
  }

  if (store.getWebhookEnabled() && !isWebhookServerRunning()) {
    const token = store.getWebhookToken();
    const port  = store.getWebhookPort();
    if (token) {
      console.error('[Phase1.5] Webhook server stopped — supervisor restarting');
      await startWebhookServer(port, token, (missionId) =>
        _getMissionManager(store).runMission(missionId),
      ).catch(console.error);
    }
  }

  if (store.getControlPlaneEnabled() && !(_controlPlane?.isRunning())) {
    const token = store.getControlPlaneToken();
    const port  = store.getControlPlanePort();
    if (token) {
      console.error('[Phase2] Control plane stopped — supervisor restarting');
      await _controlPlane!.start(port, token).catch(console.error);
    }
  }
}

// ── Exported broadcast helper — used by index.ts supervisor ─────────────────
export function broadcastBackgroundLoopStatus(extra?: Record<string, unknown>): void {
  if (!_ipcStore || !_missionManager) return;
  const payload = {
    enabled:          _ipcStore.getBackgroundLoopEnabled(),
    running:          _missionManager.isRunning(),
    lastTickAt:       _missionManager.getLastTickAt(),
    lastFiredMission: _ipcStore.getLastFiredMission(),
    ...extra,
  };
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('backgroundLoop:status', payload);
  }
}

// ── Singleton cleanup — call from app before-quit ─────────────────────────────
export function disposeIpcSingletons(): void {
  // Phase 17: Stop dispatch server
  if (_dispatchServer?.isRunning) { _dispatchServer.stop().catch(console.error); _dispatchServer = null; }

  _expertTrafficController?.dispose();  // clears rebalance interval
  _expertTrafficController = null;
  _expertLoadTracker = null;
  _evolutionOrchestrator?.dispose();    // Fix 10: unsubscribes EventBus listener in ComponentUseTracker
  _evolutionOrchestrator = null;
  _placementLearningBridge = null;
  _learningOrchestrator = null;
  _expertWorkforceEngine = null;
  _expertHiringEngine = null;
  _expertPromotionEngine = null;
  _expertReplacementEngine = null;
  _expertRouter = null;
  _expertPerformanceTracker = null;
  _expertRegistry = null;
  _expertRosterLedger = null;
  _vibeProfileStore = null;
  _vibeBuildPlanner = null;
  _vibeConsistencyChecker = null;
  _vibeOutcomeScorer = null;
  _vibePatchPlanner = null;
}
