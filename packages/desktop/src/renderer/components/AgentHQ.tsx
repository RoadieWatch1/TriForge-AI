import React, { useState, useEffect, useRef, useCallback } from 'react';

// ── Types ─────────────────────────────────────────────────────────────────────

interface Step {
  id: string;
  title: string;
  description?: string;
  tool: string;
  args?: Record<string, unknown>;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped' | 'awaiting_approval';
  riskLevel?: 'low' | 'medium' | 'high';
  attempts?: number;
  maxAttempts?: number;
  result?: unknown;
  error?: string;
  blockedReason?: string;
  completedAt?: number;
}

interface Plan {
  steps: Step[];
  planTitle?: string;
  summary?: string;
}

interface Task {
  id: string;
  goal: string;
  category: string;
  status: 'queued' | 'planning' | 'running' | 'paused' | 'awaiting_approval' | 'completed' | 'failed' | 'cancelled';
  createdAt: number;
  updatedAt: number;
  currentStepIndex?: number;
  plan?: Plan;
  error?: string;
  result?: string;
}

interface ApprovalRequest {
  id: string;
  taskId: string;
  stepId: string;
  tool: string;
  args?: Record<string, unknown>;
  riskLevel: 'low' | 'medium' | 'high';
  estimatedCostCents?: number;
  createdAt: number;
  expiresAt: number;
  status: 'pending' | 'approved' | 'denied' | 'expired';
}

interface SchedulerJob {
  id: string;
  taskGoal: string;
  category: string;
  cronExpr?: string;
  runAt?: number;
  label?: string;
  lastRan?: number;
  nextRun?: number;
  enabled?: boolean;
}

interface WalletSnapshot {
  dailyBudgetCents: number;
  categorySpent: Record<string, number>;
  categoryReserved: Record<string, number>;
  totalSpentCents: number;
  totalReservedCents: number;
}

interface EngineEvent {
  type: string;
  taskId?: string;
  stepId?: string;
  approvalId?: string;
  tool?: string;
  error?: string;
  _ts?: number;       // tagged by UI for relative timestamps
  [key: string]: unknown;
}

interface Campaign {
  id: string;
  name: string;
  type: string;
  status: string;
  createdAt: number;
  updatedAt: number;
  taskIds: string[];
  description?: string;
}

interface CampaignMetrics {
  campaignId: string;
  emailsSent: number;
  emailsFailed: number;
  repliesReceived: number;
  postsPublished: number;
  leadsGenerated: number;
  spendCents: number;
  valueRecordedCents: number;
  roi: number | null;
  replyRate: number | null;
  successRate: number | null;
  lastUpdatedAt: number;
}

interface OptimizationResult {
  campaignId: string;
  suggestedActions: string[];
  priority: string;
  reasoning: string;
  generatedAt: number;
}

// Phase 6 — Growth Engine types
interface GrowthLoop {
  id: string;
  type: 'outreach' | 'content' | 'hybrid';
  goal: string;
  status: 'active' | 'paused';
  campaignId?: string;
  createdAt: number;
  updatedAt: number;
  lastRunAt?: number;
  nextRunAt?: number;
  runCount: number;
  improvementNotes?: string;
  version?: number;
  scalingAction?: string;
  config: {
    dailyEmailLimit?: number;
    dailyPostLimit?: number;
    targetAudience?: string;
    keywords?: string[];
    emailList?: Array<{ email: string; name?: string; interest?: string }>;
  };
}

interface GrowthLead {
  id: string;
  source: string;
  contact: string;
  name?: string;
  status: 'new' | 'contacted' | 'replied' | 'converted';
  notes?: string;
  loopId?: string;
  createdAt: number;
  updatedAt: number;
}

interface GlobalGrowthMetrics {
  totalLeads: number;
  totalEmailsSent: number;
  totalPostsPublished: number;
  totalConverted: number;
  activeLoops: number;
}

const LEAD_STATUS_COLOR: Record<string, string> = {
  new:       '#6366f1',
  contacted: '#a855f7',
  replied:   '#10a37f',
  converted: '#10b981',
};

// Phase 6 — add Phase 7 version + scalingAction fields to GrowthLoop
// (already included via existing GrowthLoop interface above — no change needed)

// Phase 7 — Compound Engine types
interface StrategyProfile {
  id: string;
  loopId?: string;
  type: 'outreach' | 'content';
  description: string;
  inputs: {
    subjectLine?: string;
    tone?: string;
    contentType?: string;
    keywords?: string[];
  };
  performance: {
    sent?: number;
    replies?: number;
    leads?: number;
    conversions?: number;
    replyRate?: number;
    conversionRate?: number;
  };
  score: number;
  status: 'active' | 'testing' | 'deprecated';
  createdAt: number;
  updatedAt: number;
}

interface CompoundStats {
  totalStrategies: number;
  highPerformers: number;
  lowPerformers: number;
  testingStrategies: number;
  avgScore: number;
  lastOptimizedAt: number | null;
}

const STRATEGY_STATUS_COLOR: Record<string, string> = {
  active:     '#10b981',
  testing:    '#f59e0b',
  deprecated: '#6b7280',
};

// Phase 7 — Policy Engine types
interface PolicyRule {
  id: string; enabled: boolean; priority: number; name: string; description?: string;
  matchSource: string; matchRiskClass: string; matchCategory?: string;
  action: string; preferLocal?: boolean; isDefault: boolean; createdAt: number;
}
interface PolicySimResult { action: string; ruleId: string | null; ruleName: string | null; preferLocal: boolean; usedFallback: boolean }

const GOV_SOURCES    = ['*', 'local_ui', 'localhost_api', 'webhook_local', 'github', 'telegram', 'slack', 'discord', 'jira', 'linear', 'skill'] as const;
const GOV_RISK_CLASS = ['*', 'informational', 'write_action', 'skill_execution', 'high_risk'] as const;
const GOV_ACTIONS    = ['allow', 'approval', 'council', 'block'] as const;

const ACTION_COLORS: Record<string, string> = {
  allow: '#10b981', approval: '#f59e0b', council: '#a855f7', block: '#ef4444',
};

// Phase 6 — Telegram types
interface TgStatus { enabled: boolean; running: boolean; botUsername: string; allowedChats: number[]; lastMessageAt: number | null }
interface TgLogMsg  { id: string; direction: string; channel: string; chatId: number; chatName?: string; text: string; riskClass?: string; taskId?: string; status: string; blockedReason?: string; timestamp: number }

// Phase 9 — Jira types
interface JiraStatus { enabled: boolean; workspaceUrl: string; email: string; displayName: string; allowedProjects: string[]; summarySlackChannel: string }
interface JiraProject { id: string; key: string; name: string; issueTypes: Array<{ id: string; name: string; subtask: boolean }> }
interface JiraIssueRow { id: string; key: string; summary: string; status: string; statusCategory: string; priority: string; issueType: string; projectKey: string; assigneeName?: string; description: string; updated: string }
interface JiraIssueDetail extends JiraIssueRow { reporterName?: string; created: string; projectName: string }
interface JiraTransitionRow { id: string; name: string; toStatus: string }
interface JiraCommentRow   { id: string; authorName: string; body: string; created: string }
interface JiraQueuedAction { id: string; type: string; issueKey?: string; projectKey?: string; summary: string; body: string; toStatus?: string; status: string; createdAt: number; processedAt?: number }

const JIRA_STATUS_COLORS: Record<string, string> = {
  'To Do': '#6b7280', 'In Progress': '#3b82f6', Done: '#10b981',
};
const JIRA_PRIORITY_COLORS: Record<string, string> = {
  Highest: '#ef4444', High: '#f97316', Medium: '#f59e0b', Low: '#10b981', Lowest: '#6b7280', None: '#6b7280',
};

// Phase 12 — Discord types
interface DiscordStatus { enabled: boolean; running: boolean; botUserName: string; botUserId: string; allowedChannels: string[]; allowedUsers: string[]; lastMessageAt: number | null }
interface DiscordGuild   { id: string; name: string }
interface DiscordChannel { id: string; name: string; type: number }
interface DiscordLogMsg  { id: string; direction: string; channel: string; chatId: number; channelId?: string; chatName?: string; text: string; riskClass?: string; taskId?: string; status: string; blockedReason?: string; timestamp: number }

// Phase 10 — Push Notification types
interface PushEventRow { key: string; label: string; description: string; enabled: boolean; priority: string }
interface PushLogRow   { id: string; event: string; title: string; provider: string; success: boolean; error?: string; timestamp: number }

// Phase 11 — Linear types
interface LinearStatus { enabled: boolean; userName: string; workspaceName: string; allowedTeams: string[]; summarySlackChannel: string }
interface LinearTeamRow { id: string; name: string; key: string }
interface LinearIssueRow { id: string; identifier: string; title: string; stateId: string; stateName: string; stateType: string; priority: number; priorityLabel: string; assigneeId?: string; assigneeName?: string; teamId: string; teamName: string; teamKey: string; description: string; updatedAt: string; createdAt: string; url: string }
interface LinearCommentRow { id: string; body: string; authorName: string; createdAt: string }
interface LinearStateRow   { id: string; name: string; type: string; color: string }
interface LinearQueuedAction { id: string; type: string; issueId?: string; teamId?: string; summary: string; body: string; stateId?: string; assigneeId?: string; priority?: number; status: string; createdAt: number; processedAt?: number }

// Phase 13 — Automation Recipe types
interface RecipeParamSchema { key: string; label: string; placeholder: string; required: boolean }
interface RecipeView { id: string; name: string; description: string; trigger: string; triggerLabel: string; paramSchema: RecipeParamSchema[]; enabled: boolean; params: Record<string, string>; lastRunAt?: number; lastRunStatus?: 'success' | 'failed' | 'skipped'; lastRunResult?: string }

// Phase 15 — Action Center types
type ActionView = 'all' | 'needs-approval' | 'blocked' | 'failures' | 'alerts';
interface ActionItem {
  id: string; source: string; service: string; severity: 'critical' | 'warning' | 'info';
  title: string; body: string;
  canApprove: boolean; canDismiss: boolean; canRetry: boolean;
  createdAt: number; metadata: Record<string, unknown>;
}
interface ActionCount { total: number; approvals: number; blocked: number; failures: number; alerts: number }

// Phase 16 — Shared Context / Team Memory types
interface RepoMappingRow { id: string; repo: string; jiraProjectKey?: string; linearTeamId?: string; linearTeamName?: string; reviewInstructions?: string; defaultLabels?: string[]; createdAt: number; updatedAt: number }
interface ChannelMappingRow { id: string; channel: string; channelId: string; channelName?: string; workstream?: string; projectKey?: string; createdAt: number; updatedAt: number }
interface ProjectNoteRow { id: string; projectKey: string; projectName?: string; summary?: string; defaultPriority?: string; defaultLabels?: string[]; automationContext?: string; escalationChannelId?: string; createdAt: number; updatedAt: number }
type MemoryTab = 'repos' | 'channels' | 'projects' | 'settings';

// Phase 14 — Ops / Analytics Dashboard types
type OpsWindow = '24h' | '7d' | '30d';
interface OpsOverview {
  window: string; tasksCreated: number; tasksCompleted: number; tasksFailed: number;
  approvalsPending: number; highRiskBlocked: number; skillBlocked: number;
  recipesCompleted: number; recipesFailed: number;
  pushSent: number; pushFailed: number;
  localModelUses: number; cloudFallbacks: number;
  githubReviewsDone: number; policyMatches: number;
}
interface OpsChannels {
  window: string;
  telegram: { received: number; blocked: number; replied: number; approvals: number; replyRate: number };
  slack:    { received: number; blocked: number; replied: number; approvals: number; replyRate: number };
  discord:  { received: number; blocked: number; replied: number; approvals: number; replyRate: number };
  recentMessages: Array<{ channel: string; direction: string; status: string; riskClass?: string; text: string; timestamp: number }>;
}
interface OpsGovernance {
  window: string; totalMatches: number; totalBlocked: number; totalApprovals: number;
  topRules:       Array<{ label: string; count: number }>;
  topSources:     Array<{ label: string; count: number }>;
  topRiskClasses: Array<{ label: string; count: number }>;
  recentBlocked:  Array<{ eventType: string; reason: string; source: string; timestamp: number }>;
}
interface OpsIntegrations {
  window: string;
  github:  { reviewsCompleted: number; commentsPosted: number; commentsBlocked: number; webhooksReceived: number; issuesTriaged: number };
  jira:    { actionsQueued: number; actionsApproved: number; actionsDismissed: number; commentsPosted: number; issuesCreated: number; transitions: number };
  linear:  { actionsQueued: number; actionsApproved: number; actionsDismissed: number; commentsPosted: number; issuesCreated: number; statusUpdates: number };
  skills:  { installed: number; executed: number; blocked: number };
  controlPlane: { tasksCreated: number };
}
interface OpsRecipeRow { id: string; name: string; trigger: string; enabled: boolean; lastRunAt?: number; lastRunStatus?: string; lastRunResult?: string; ranInWindow: boolean }
interface OpsHealthRow { name: string; connected: boolean; running: boolean; detail: string }

const LINEAR_STATE_TYPE_COLORS: Record<string, string> = {
  triage: '#8b5cf6', backlog: '#6b7280', unstarted: '#6b7280',
  started: '#3b82f6', completed: '#10b981', cancelled: '#ef4444',
};
const LINEAR_PRIORITY_COLORS: Record<number, string> = {
  0: '#6b7280', 1: '#ef4444', 2: '#f97316', 3: '#f59e0b', 4: '#10b981',
};

// Phase 8 — Slack types
interface SlackStatus {
  enabled: boolean; running: boolean; workspaceName: string; botUserName: string;
  allowedChannels: string[]; allowedUsers: string[];
  summaryChannel: string; summarySchedule: string;
  lastMessageAt: number | null;
}
interface SlackChannel { id: string; name: string; isMember: boolean; numMembers: number }
interface SlackLogMsg  { id: string; direction: string; channel: string; chatId: number; channelId?: string; chatName?: string; text: string; riskClass?: string; taskId?: string; status: string; blockedReason?: string; timestamp: number }

// Phase 5 — Skill Store types
interface InstalledSkillRow {
  id: string; name: string; version?: string; description?: string; author?: string;
  source: string; sourceUrl?: string; riskLevel: string; blocked: boolean;
  requiresApproval: boolean; councilReviewRequired: boolean;
  declaredCapabilities: string[]; detectedCapabilities: string[];
  reviewSummary: string; enabled: boolean; installedAt: number;
  lastRunAt?: number; runCount: number;
}
interface SkillAnalysisPreview {
  riskLevel: string; blocked: boolean; reviewSummary: string;
  detectedPatterns: Array<{ pattern: string; severity: string; description: string }>;
  decision?: { allowed: boolean; requiresApproval: boolean; requiresCouncilReview: boolean; blockReason?: string };
}
interface BundledExample { name: string; description: string; markdown: string }

// Phase 3 — GitHub types
interface GHRepo { id: number; full_name: string; name: string; owner: string; private: boolean; open_issues_count: number }
interface GHPR   { number: number; title: string; user: string; html_url: string; draft: boolean; additions: number; deletions: number; changed_files: number; created_at: string }
interface GHIssue{ number: number; title: string; user: string; html_url: string; labels: string[]; comments: number; created_at: string }
interface GHPendingReview {
  id: string; type: string; owner: string; repo: string; number: number;
  title: string; htmlUrl: string; synthesis: string; status: string;
  commentUrl?: string; createdAt: number;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const CATEGORY_OPTIONS = ['research', 'marketing', 'outreach', 'trading', 'ops', 'email'];

const STATUS_META: Record<string, { color: string; label: string; dot?: boolean; glow?: boolean }> = {
  queued:            { color: '#6366f1', label: 'Queued' },
  planning:          { color: '#a855f7', label: 'Planning', dot: true },
  running:           { color: '#10a37f', label: 'Running', dot: true, glow: true },
  paused:            { color: '#f59e0b', label: 'Paused' },
  awaiting_approval: { color: '#ef4444', label: 'Needs Approval', dot: true, glow: true },
  completed:         { color: '#10b981', label: 'Done' },
  failed:            { color: '#ef4444', label: 'Failed' },
  cancelled:         { color: 'rgba(255,255,255,0.25)', label: 'Cancelled' },
};

const EVENT_META: Record<string, { color: string; label: string; icon: string; summary: string }> = {
  TASK_CREATED:         { color: '#6366f1', label: 'Created',     icon: '✦',  summary: 'Task created'     },
  TASK_PLAN_READY:      { color: '#a855f7', label: 'Planned',     icon: '⊞',  summary: 'Plan ready'       },
  TASK_RUNNING:         { color: '#10a37f', label: 'Running',     icon: '▷',  summary: 'Agent started'    },
  TASK_COMPLETED:       { color: '#10b981', label: 'Done',        icon: '✓',  summary: 'Task completed'   },
  TASK_FAILED:          { color: '#ef4444', label: 'Failed',      icon: '✕',  summary: 'Task failed'      },
  TASK_CANCELLED:       { color: 'rgba(255,255,255,0.3)', label: 'Cancelled', icon: '○', summary: 'Cancelled' },
  TASK_PAUSED:          { color: '#f59e0b', label: 'Paused',      icon: '⏸',  summary: 'Paused'           },
  TASK_RESUMED:         { color: '#10a37f', label: 'Resumed',     icon: '▶',  summary: 'Resumed'          },
  STEP_STARTED:         { color: '#6366f1', label: 'Step',        icon: '▷',  summary: 'Step started'     },
  STEP_COMPLETED:       { color: '#10b981', label: 'Step Done',   icon: '✓',  summary: 'Step done'        },
  STEP_FAILED:          { color: '#ef4444', label: 'Step Fail',   icon: '✕',  summary: 'Step failed'      },
  STEP_BLOCKED:         { color: '#f59e0b', label: 'Blocked',     icon: '⊘',  summary: 'Blocked'          },
  STEP_RETRY_SCHEDULED: { color: '#f59e0b', label: 'Retry',       icon: '↺',  summary: 'Retrying…'        },
  APPROVAL_REQUIRED:    { color: '#ef4444', label: 'Approval',    icon: '⚠',  summary: 'Needs approval'   },
  STEP_APPROVED:        { color: '#10b981', label: 'Approved',    icon: '✓',  summary: 'Approved'         },
  STEP_DENIED:          { color: '#ef4444', label: 'Denied',      icon: '✕',  summary: 'Denied'           },
  TOOL_CALLED:          { color: '#a855f7', label: 'Tool',        icon: '⊞',  summary: 'Tool called'      },
  WALLET_UPDATED:       { color: '#10a37f', label: 'Wallet',      icon: '$',  summary: 'Budget updated'   },
};

const RISK_COLORS: Record<string, string> = {
  low: '#10b981', medium: '#f59e0b', high: '#ef4444',
};

const STEP_STATUS_COLORS: Record<string, string> = {
  pending:           'rgba(255,255,255,0.3)',
  running:           '#10a37f',
  completed:         '#10b981',
  failed:            '#ef4444',
  skipped:           'rgba(255,255,255,0.18)',
  awaiting_approval: '#ef4444',
};

const SYSTEM_MESSAGES = [
  'Analyzing task performance…',
  'Optimizing strategy models…',
  'Reviewing historical outcomes…',
  'Scanning for new opportunities…',
  'Cross-referencing data sources…',
  'Evaluating execution efficiency…',
  'Monitoring system resources…',
  'Validating compliance rules…',
  'Indexing knowledge base…',
  'Calibrating agent parameters…',
];

const IDLE_MESSAGES = [
  'System ready — Awaiting your direction',
  'All agents standing by',
  'Ready to execute on command',
  'Monitoring for new objectives…',
  'Triforge engine warm — assign a task',
  'Operational. No active objectives.',
];

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

function formatAge(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function formatCountdown(ms: number): string {
  if (ms <= 0) return 'Now';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

// ── CSS injection ─────────────────────────────────────────────────────────────

if (typeof document !== 'undefined' && !document.getElementById('agent-hq-css')) {
  const s = document.createElement('style');
  s.id = 'agent-hq-css';
  s.textContent = `
    @keyframes hq-pulse      { 0%,100%{opacity:1;transform:scale(1)} 50%{opacity:0.3;transform:scale(0.75)} }
    @keyframes hq-live-blink { 0%,100%{opacity:1} 45%,55%{opacity:0.15} }
    @keyframes hq-slide-in   { from{transform:translateY(-8px);opacity:0} to{transform:translateY(0);opacity:1} }
    @keyframes hq-fade-in    { from{opacity:0;transform:scale(0.96)} to{opacity:1;transform:scale(1)} }
    @keyframes hq-spin       { to{transform:rotate(360deg)} }
    @keyframes hq-shake      { 0%,100%{transform:translateX(0)} 15%,45%,75%{transform:translateX(-3px)} 30%,60%,90%{transform:translateX(3px)} }
    @keyframes hq-step-glow  { 0%,100%{box-shadow:0 0 0px transparent,inset 0 0 0px transparent} 50%{box-shadow:0 0 12px rgba(16,163,127,0.25),inset 0 0 6px rgba(16,163,127,0.06)} }
    @keyframes hq-urgency-bg { 0%,100%{background:rgba(239,68,68,0.06)} 50%{background:rgba(239,68,68,0.13)} }
    @keyframes hq-urgency-border { 0%,100%{border-color:rgba(239,68,68,0.35)} 50%{border-color:rgba(239,68,68,0.7)} }
    @keyframes hq-hustle-glow { 0%,100%{box-shadow:0 0 0px transparent} 50%{box-shadow:0 0 10px rgba(99,102,241,0.4)} }
    @keyframes hq-dot-seq    { 0%,20%{opacity:0.12} 50%{opacity:1} 80%,100%{opacity:0.12} }
    @keyframes hq-feedback-out { 0%{opacity:1;transform:translateY(0)} 70%{opacity:1;transform:translateY(-2px)} 100%{opacity:0;transform:translateY(-6px)} }
    @keyframes hq-task-glow  { 0%,100%{box-shadow:none} 50%{box-shadow:0 0 8px rgba(16,163,127,0.2)} }
    @keyframes hq-approval-task { 0%,100%{border-color:rgba(239,68,68,0.35)} 50%{border-color:rgba(239,68,68,0.75)} }
    @keyframes hq-heartbeat     { 0%,100%{transform:scale(1);box-shadow:0 0 4px #10a37f66} 40%{transform:scale(1.4);box-shadow:0 0 14px #10a37faa} 60%{transform:scale(1.15);box-shadow:0 0 8px #10a37f88} }
    @keyframes hq-shimmer       { 0%{transform:translateX(-130%)} 100%{transform:translateX(230%)} }
    @keyframes hq-gradient-shift { 0%,100%{background-position:0% 50%} 50%{background-position:100% 50%} }
    @keyframes hq-msg-in        { from{opacity:0;transform:translateY(5px)} to{opacity:1;transform:translateY(0)} }
    @keyframes hq-event-slide   { from{opacity:0;transform:translateX(10px)} to{opacity:1;transform:translateX(0)} }
    @keyframes hq-idle-pulse    { 0%,100%{opacity:0.22} 50%{opacity:0.55} }
    @keyframes hq-btn-flash     { 0%{box-shadow:none} 30%{box-shadow:0 0 12px currentColor} 100%{box-shadow:none} }

    .hq-scroll::-webkit-scrollbar { width:3px; height:3px; }
    .hq-scroll::-webkit-scrollbar-track { background:transparent; }
    .hq-scroll::-webkit-scrollbar-thumb { background:rgba(255,255,255,0.08); border-radius:2px; }

    .hq-btn { transition:all 0.15s !important; }
    .hq-btn:hover { opacity:0.85 !important; }
    .hq-btn:active { transform:scale(0.96) !important; }

    .hq-task-row { cursor:pointer; transition:all 0.18s; }
    .hq-task-row:hover { background:rgba(255,255,255,0.04) !important; }
    .hq-task-row.selected { background:rgba(99,102,241,0.09) !important; border-color:rgba(99,102,241,0.38) !important; }
    .hq-task-row.running  { animation: hq-task-glow 2s ease-in-out infinite; }
    .hq-task-row.needs-approval { animation: hq-approval-task 1.2s ease-in-out infinite; }

    .hq-dot-1 { display:inline-block; animation:hq-dot-seq 1.4s ease-in-out 0s infinite; }
    .hq-dot-2 { display:inline-block; animation:hq-dot-seq 1.4s ease-in-out 0.46s infinite; }
    .hq-dot-3 { display:inline-block; animation:hq-dot-seq 1.4s ease-in-out 0.92s infinite; }

    .hq-hustle-gradient {
      background: linear-gradient(90deg, rgba(99,102,241,0.22), rgba(168,85,247,0.18), rgba(99,102,241,0.22)) !important;
      background-size: 200% 100% !important;
      animation: hq-gradient-shift 3s ease-in-out infinite, hq-hustle-glow 2.5s ease-in-out infinite !important;
    }
  `;
  document.head.appendChild(s);
}

// ── Main Component ─────────────────────────────────────────────────────────────

export function AgentHQ() {
  const [tasks, setTasks]           = useState<Task[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [approvals, setApprovals]   = useState<ApprovalRequest[]>([]);
  const [jobs, setJobs]             = useState<SchedulerJob[]>([]);
  const [wallet, setWallet]         = useState<WalletSnapshot | null>(null);
  const [events, setEvents]         = useState<EngineEvent[]>([]);
  const [health, setHealth]         = useState<{ runningTasks?: number; pendingApprovals?: number; paperTradingOnly?: boolean }>({});
  const [trustConfig, setTrustConfig] = useState<Record<string, unknown>>({});
  const [serviceStatus, setServiceStatus] = useState<{ mail?: boolean; twitter?: boolean; notify?: boolean; storage?: boolean }>({});
  const [resultMetrics, setResultMetrics] = useState<{ total: number; successful: number; failed: number; paperMode: number; byTool: Record<string, { total: number; success: number }> } | null>(null);
  const [showCredForm, setShowCredForm]   = useState(false);
  const [credKey, setCredKey]             = useState('smtp_host');
  const [credValue, setCredValue]         = useState('');
  const [savingCred, setSavingCred]       = useState(false);

  // Value Engine — campaigns & metrics (Phase 5)
  const [campaigns, setCampaigns]                 = useState<Campaign[]>([]);
  const [activeCampaignId, setActiveCampaignId]   = useState<string | null>(null);
  const [globalMetrics, setGlobalMetrics]         = useState<CampaignMetrics | null>(null);
  const [campaignMetrics, setCampaignMetrics]     = useState<CampaignMetrics | null>(null);
  const [optimization, setOptimization]           = useState<OptimizationResult | null>(null);
  const [showNewCampaign, setShowNewCampaign]     = useState(false);
  const [newCampaignName, setNewCampaignName]     = useState('');
  const [newCampaignType, setNewCampaignType]     = useState('outreach');
  const [valueAmount, setValueAmount]             = useState('');
  const [valueNote, setValueNote]                 = useState('');
  const [recordingValue, setRecordingValue]       = useState(false);

  // Phase 6 — Growth Engine
  const [loops, setLoops]                         = useState<GrowthLoop[]>([]);
  const [leads, setLeads]                         = useState<GrowthLead[]>([]);
  const [globalGrowthMetrics, setGlobalGrowthMetrics] = useState<GlobalGrowthMetrics | null>(null);
  const [showGrowthForm, setShowGrowthForm]       = useState(false);
  const [growthGoal, setGrowthGoal]               = useState('');
  const [growthType, setGrowthType]               = useState<'outreach' | 'content' | 'hybrid'>('outreach');
  const [growthAudience, setGrowthAudience]       = useState('');
  const [growthKeywords, setGrowthKeywords]       = useState('');
  const [growthEmailList, setGrowthEmailList]     = useState('');
  const [growthEmailLimit, setGrowthEmailLimit]   = useState('10');
  const [growthPostLimit, setGrowthPostLimit]     = useState('1');
  const [creatingLoop, setCreatingLoop]           = useState(false);
  const [runningLoopId, setRunningLoopId]         = useState<string | null>(null);
  const [newLeadContact, setNewLeadContact]       = useState('');
  const [newLeadName, setNewLeadName]             = useState('');
  const [showLeadForm, setShowLeadForm]           = useState(false);
  // Phase 7 — Compound Engine state
  const [strategies, setStrategies]               = useState<StrategyProfile[]>([]);
  const [compoundStats, setCompoundStats]         = useState<CompoundStats | null>(null);
  const [runningOptimization, setRunningOptimization] = useState(false);

  // Phase 1.5 — Background Agent + Webhook
  const [bgStatus, setBgStatus] = useState<{
    enabled: boolean; running: boolean; lastTickAt: number | null;
    lastFiredMission: { id: string; name: string; firedAt: number } | null;
    healthy?: boolean;
  } | null>(null);
  const [webhookStatus, setWebhookStatus] = useState<{
    enabled: boolean; port: number; token: string; running: boolean;
  } | null>(null);
  const [bgToggling, setBgToggling]     = useState(false);
  const [whToggling, setWhToggling]     = useState(false);
  const [showWhToken, setShowWhToken]   = useState(false);

  // Phase 2 — Control Plane + Skill Trust
  const [cpStatus, setCpStatus] = useState<{
    enabled: boolean; running: boolean; port: number; token: string; lastStartedAt: number | null;
  } | null>(null);
  const [cpToggling, setCpToggling]   = useState(false);
  const [showCpToken, setShowCpToken] = useState(false);
  const [skillInput, setSkillInput]   = useState('');
  const [skillAnalyzing, setSkillAnalyzing] = useState(false);
  const [skillResult, setSkillResult] = useState<{
    riskLevel: string; blocked: boolean; blockReason?: string; reviewSummary: string;
    detectedPatterns: Array<{ pattern: string; severity: string; description: string }>;
    decision?: { allowed: boolean; requiresApproval: boolean; requiresCouncilReview: boolean; blockReason?: string };
  } | null>(null);

  // Phase 3 — GitHub
  const [ghPatInput, setGhPatInput]               = useState('');
  const [ghPatSaving, setGhPatSaving]             = useState(false);
  const [ghConnected, setGhConnected]             = useState<{ login: string } | null>(null);
  const [ghRepos, setGhRepos]                     = useState<GHRepo[]>([]);
  const [ghSelectedRepo, setGhSelectedRepo]       = useState('');
  const [ghPRs, setGhPRs]                         = useState<GHPR[]>([]);
  const [ghIssues, setGhIssues]                   = useState<GHIssue[]>([]);
  const [ghPendingReviews, setGhPendingReviews]   = useState<GHPendingReview[]>([]);
  const [ghLoadingRepo, setGhLoadingRepo]         = useState(false);
  const [ghReviewingPR, setGhReviewingPR]         = useState<number | null>(null);
  const [ghTriagingIssue, setGhTriagingIssue]     = useState<number | null>(null);
  const [ghApprovingId, setGhApprovingId]         = useState<string | null>(null);
  const [ghDismissingId, setGhDismissingId]       = useState<string | null>(null);
  const [ghWebhookEnabled, setGhWebhookEnabled]   = useState(false);
  const [ghWebhookSecret, setGhWebhookSecret]     = useState('');
  const [ghWebhookSecretSaving, setGhWebhookSecretSaving] = useState(false);
  const [ghTab, setGhTab]                         = useState<'repos' | 'pending'>('repos');

  // Phase 7 — Policy Engine
  const [policyRules, setPolicyRules]             = useState<PolicyRule[]>([]);
  const [policyTab, setPolicyTab]                 = useState<'rules' | 'add' | 'simulate'>('rules');
  const [policyResetting, setPolicyResetting]     = useState(false);
  // Add rule form
  const [newRuleName, setNewRuleName]             = useState('');
  const [newRuleSource, setNewRuleSource]         = useState('*');
  const [newRuleRisk, setNewRuleRisk]             = useState('*');
  const [newRuleAction, setNewRuleAction]         = useState('approval');
  const [newRuleCategory, setNewRuleCategory]     = useState('');
  const [newRulePriority, setNewRulePriority]     = useState('75');
  const [newRulePreferLocal, setNewRulePreferLocal] = useState(false);
  const [addingRule, setAddingRule]               = useState(false);
  // Simulate
  const [simSource, setSimSource]                 = useState('telegram');
  const [simRisk, setSimRisk]                     = useState('informational');
  const [simCategory, setSimCategory]             = useState('');
  const [simResult, setSimResult]                 = useState<PolicySimResult | null>(null);
  const [simRunning, setSimRunning]               = useState(false);

  // Phase 6 — Telegram Messaging
  const [tgStatus, setTgStatus]               = useState<TgStatus | null>(null);
  const [tgTokenInput, setTgTokenInput]       = useState('');
  const [tgTokenSaving, setTgTokenSaving]     = useState(false);
  const [tgToggling, setTgToggling]           = useState(false);
  const [tgMessages, setTgMessages]           = useState<TgLogMsg[]>([]);
  const [tgChatIdInput, setTgChatIdInput]     = useState('');
  const [tgTestMsg, setTgTestMsg]             = useState('');
  const [tgSending, setTgSending]             = useState(false);
  const [tgTab, setTgTab]                     = useState<'setup' | 'messages'>('setup');

  // Phase 8 — Slack Messaging
  const [slackStatus, setSlackStatus]               = useState<SlackStatus | null>(null);
  const [slackTokenInput, setSlackTokenInput]       = useState('');
  const [slackTokenSaving, setSlackTokenSaving]     = useState(false);
  const [slackToggling, setSlackToggling]           = useState(false);
  const [slackMessages, setSlackMessages]           = useState<SlackLogMsg[]>([]);
  const [slackChannels, setSlackChannels]           = useState<SlackChannel[]>([]);
  const [slackChannelsLoading, setSlackChannelsLoading] = useState(false);
  const [slackTestChannelId, setSlackTestChannelId] = useState('');
  const [slackTestMsg, setSlackTestMsg]             = useState('');
  const [slackSending, setSlackSending]             = useState(false);
  const [slackUserInput, setSlackUserInput]         = useState('');
  const [slackSummaryChannelInput, setSlackSummaryChannelInput] = useState('');
  const [slackTab, setSlackTab]                     = useState<'setup' | 'channels' | 'messages' | 'summary'>('setup');

  // Phase 9 — Jira
  const [jiraStatus, setJiraStatus]                 = useState<JiraStatus | null>(null);
  const [jiraWorkspaceInput, setJiraWorkspaceInput] = useState('');
  const [jiraEmailInput, setJiraEmailInput]         = useState('');
  const [jiraTokenInput, setJiraTokenInput]         = useState('');
  const [jiraConnecting, setJiraConnecting]         = useState(false);
  const [jiraProjects, setJiraProjects]             = useState<JiraProject[]>([]);
  const [jiraIssues, setJiraIssues]                 = useState<JiraIssueRow[]>([]);
  const [jiraIssuesLoading, setJiraIssuesLoading]   = useState(false);
  const [jiraJql, setJiraJql]                       = useState('assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC');
  const [jiraSelectedIssue, setJiraSelectedIssue]   = useState<JiraIssueDetail | null>(null);
  const [jiraComments, setJiraComments]             = useState<JiraCommentRow[]>([]);
  const [jiraTransitions, setJiraTransitions]       = useState<JiraTransitionRow[]>([]);
  const [jiraIssueLoading, setJiraIssueLoading]     = useState(false);
  const [jiraCommentInput, setJiraCommentInput]     = useState('');
  const [jiraCommentSending, setJiraCommentSending] = useState(false);
  const [jiraTriaging, setJiraTriaging]             = useState(false);
  const [jiraTriageTaskId, setJiraTriageTaskId]     = useState<string | null>(null);
  const [jiraQueue, setJiraQueue]                   = useState<JiraQueuedAction[]>([]);
  const [jiraQueueProcessing, setJiraQueueProcessing] = useState<string | null>(null);
  const [jiraSummaryChannelInput, setJiraSummaryChannelInput] = useState('');
  const [jiraSummaryLoading, setJiraSummaryLoading] = useState(false);
  const [jiraTab, setJiraTab]                       = useState<'setup' | 'browse' | 'act' | 'queue'>('setup');

  // Phase 12 — Discord
  const [discordStatus, setDiscordStatus]             = useState<DiscordStatus | null>(null);
  const [discordTokenInput, setDiscordTokenInput]     = useState('');
  const [discordConnecting, setDiscordConnecting]     = useState(false);
  const [discordGuilds, setDiscordGuilds]             = useState<DiscordGuild[]>([]);
  const [discordSelectedGuild, setDiscordSelectedGuild] = useState<DiscordGuild | null>(null);
  const [discordChannels, setDiscordChannels]         = useState<DiscordChannel[]>([]);
  const [discordChannelsLoading, setDiscordChannelsLoading] = useState(false);
  const [discordChannelIdInput, setDiscordChannelIdInput] = useState('');
  const [discordUserIdInput, setDiscordUserIdInput]   = useState('');
  const [discordMessages, setDiscordMessages]         = useState<DiscordLogMsg[]>([]);
  const [discordTestChannelId, setDiscordTestChannelId] = useState('');
  const [discordTestText, setDiscordTestText]         = useState('');
  const [discordTestSending, setDiscordTestSending]   = useState(false);
  const [discordTab, setDiscordTab]                   = useState<'setup' | 'channels' | 'messages'>('setup');

  // Phase 11 — Linear
  const [linearStatus, setLinearStatus]               = useState<LinearStatus | null>(null);
  const [linearApiKeyInput, setLinearApiKeyInput]     = useState('');
  const [linearConnecting, setLinearConnecting]       = useState(false);
  const [linearTeams, setLinearTeams]                 = useState<LinearTeamRow[]>([]);
  const [linearSelectedTeam, setLinearSelectedTeam]   = useState<LinearTeamRow | null>(null);
  const [linearIssues, setLinearIssues]               = useState<LinearIssueRow[]>([]);
  const [linearIssuesLoading, setLinearIssuesLoading] = useState(false);
  const [linearQuery, setLinearQuery]                 = useState('');
  const [linearSelectedIssue, setLinearSelectedIssue] = useState<LinearIssueRow | null>(null);
  const [linearComments, setLinearComments]           = useState<LinearCommentRow[]>([]);
  const [linearStates, setLinearStates]               = useState<LinearStateRow[]>([]);
  const [linearIssueLoading, setLinearIssueLoading]   = useState(false);
  const [linearCommentInput, setLinearCommentInput]   = useState('');
  const [linearCommentSending, setLinearCommentSending] = useState(false);
  const [linearTriaging, setLinearTriaging]           = useState(false);
  const [linearTriageTaskId, setLinearTriageTaskId]   = useState<string | null>(null);
  const [linearQueue, setLinearQueue]                 = useState<LinearQueuedAction[]>([]);
  const [linearQueueProcessing, setLinearQueueProcessing] = useState<string | null>(null);
  const [linearSummaryChannelInput, setLinearSummaryChannelInput] = useState('');
  const [linearSummaryLoading, setLinearSummaryLoading] = useState(false);
  const [linearTab, setLinearTab]                     = useState<'setup' | 'browse' | 'act' | 'queue'>('setup');

  // Phase 10 — Push Notifications
  const PUSH_PRIORITIES = ['min', 'low', 'normal', 'high', 'urgent'] as const;
  const PUSH_PRIORITY_COLOR: Record<string, string> = { min: '#6b7280', low: '#6b7280', normal: '#f59e0b', high: '#f97316', urgent: '#ef4444' };
  const [pushProvider, setPushProviderState]        = useState<'ntfy' | 'pushover' | 'disabled'>('disabled');
  const [pushNtfyTopic, setPushNtfyTopic]           = useState('');
  const [pushNtfyServer, setPushNtfyServer]         = useState('');
  const [pushNtfyToken, setPushNtfyToken]           = useState('');
  const [pushoverApp, setPushoverApp]               = useState('');
  const [pushoverUser, setPushoverUser]             = useState('');
  const [pushEvents, setPushEvents]                 = useState<PushEventRow[]>([]);
  const [pushLog, setPushLog]                       = useState<PushLogRow[]>([]);
  const [pushSaving, setPushSaving]                 = useState(false);
  const [pushTesting, setPushTesting]               = useState(false);
  const [pushTab, setPushTab]                       = useState<'setup' | 'events' | 'log'>('setup');

  // Phase 13 — Automation Recipes
  const [recipes, setRecipes]                       = useState<RecipeView[]>([]);
  const [recipeParams, setRecipeParams]             = useState<Record<string, Record<string, string>>>({});
  const [recipeRunning, setRecipeRunning]           = useState<Record<string, boolean>>({});
  const [recipesSaving, setRecipesSaving]           = useState<Record<string, boolean>>({});

  // Phase 14 — Ops Dashboard
  const [opsTab, setOpsTab]                         = useState<'overview' | 'channels' | 'governance' | 'integrations' | 'recipes' | 'health'>('overview');
  const [opsWindow, setOpsWindow]                   = useState<OpsWindow>('24h');
  const [opsLoading, setOpsLoading]                 = useState(false);
  const [opsOverview, setOpsOverview]               = useState<OpsOverview | null>(null);
  const [opsChannels, setOpsChannels]               = useState<OpsChannels | null>(null);
  const [opsGovernance, setOpsGovernance]           = useState<OpsGovernance | null>(null);
  const [opsIntegrations, setOpsIntegrations]       = useState<OpsIntegrations | null>(null);
  const [opsRecipes, setOpsRecipes]                 = useState<OpsRecipeRow[]>([]);
  const [opsHealth, setOpsHealth]                   = useState<OpsHealthRow[]>([]);

  // Phase 15 — Action Center
  const [actionView, setActionView]                 = useState<ActionView>('all');
  const [actionItems, setActionItems]               = useState<ActionItem[]>([]);
  const [actionCount, setActionCount]               = useState<ActionCount | null>(null);
  const [actionLoading, setActionLoading]           = useState(false);
  const [actionWorking, setActionWorking]           = useState<Record<string, boolean>>({});

  // Phase 16 — Shared Context / Team Memory
  const [memTab, setMemTab]                         = useState<MemoryTab>('repos');
  const [memRepos, setMemRepos]                     = useState<RepoMappingRow[]>([]);
  const [memChannels, setMemChannels]               = useState<ChannelMappingRow[]>([]);
  const [memProjects, setMemProjects]               = useState<ProjectNoteRow[]>([]);
  const [memEnabled, setMemEnabled]                 = useState<Record<string, boolean>>({ repo_mappings: true, channel_mappings: true, project_notes: true });
  const [memLoading, setMemLoading]                 = useState(false);
  // Repo form
  const [memRepoInput, setMemRepoInput]             = useState('');
  const [memRepoJiraKey, setMemRepoJiraKey]         = useState('');
  const [memRepoLinearId, setMemRepoLinearId]       = useState('');
  const [memRepoInstructions, setMemRepoInstructions] = useState('');
  const [memRepoSaving, setMemRepoSaving]           = useState(false);
  // Channel form
  const [memChanChannel, setMemChanChannel]         = useState<'telegram' | 'slack' | 'discord'>('slack');
  const [memChanId, setMemChanId]                   = useState('');
  const [memChanName, setMemChanName]               = useState('');
  const [memChanWorkstream, setMemChanWorkstream]   = useState('');
  const [memChanProjectKey, setMemChanProjectKey]   = useState('');
  const [memChanSaving, setMemChanSaving]           = useState(false);
  // Project form
  const [memProjKey, setMemProjKey]                 = useState('');
  const [memProjName, setMemProjName]               = useState('');
  const [memProjSummary, setMemProjSummary]         = useState('');
  const [memProjContext, setMemProjContext]          = useState('');
  const [memProjSaving, setMemProjSaving]           = useState(false);

  // Phase 17 + 18 — TriForge Dispatch
  const [dispatchStatus, setDispatchStatus] = useState<{
    enabled: boolean; running: boolean; port: number; hasToken: boolean;
    networkMode: string; deviceCount: number;
    policy: { enabled: boolean; maxRisk: string; requireDesktopConfirm: boolean };
    startedAt: number | null; allowRemoteApprove: boolean;
  } | null>(null);
  const [dispatchToken, setDispatchToken]         = useState<string | null>(null);
  const [dispatchPort, setDispatchPort]           = useState<string>('18790');
  const [dispatchLoading, setDispatchLoading]     = useState(false);
  const [dispatchCopied, setDispatchCopied]       = useState(false);
  // Phase 18
  const [dispatchDevices, setDispatchDevices]     = useState<Array<{ id: string; label: string; pairedAt: number; lastSeenAt: number | null; lastSeenIp: string | null; expired: boolean }>>([]);
  const [dispatchPairingCode, setDispatchPairingCode] = useState<{ code: string; expiresAt: number; pairUrl: string; qrDataUrl: string | null } | null>(null);
  const [dispatchPairingLoading, setDispatchPairingLoading] = useState(false);
  const [dispatchPendingConfs, setDispatchPendingConfs] = useState<Array<{ id: string; action: string; itemId: string; verb: string; deviceLabel: string; clientIp: string; createdAt: number }>>([]);
  const [dispatchTab, setDispatchTab]             = useState<'access' | 'devices' | 'policy' | 'confirms' | 'reach' | 'workspace' | 'integrations' | 'matrix' | 'automation' | 'runbooks' | 'analytics' | 'org'>('access');
  const [dispatchPublicUrl, setDispatchPublicUrl] = useState('');
  const [dispatchPublicUrlSaving, setDispatchPublicUrlSaving] = useState(false);
  // Phase 27 — Workspace
  const [workspace, setWorkspace] = useState<Record<string, any> | null>(null);
  const [wsLoading, setWsLoading] = useState(false);
  const [wsNewName, setWsNewName] = useState('');
  const [wsInviteRole, setWsInviteRole] = useState('operator');
  const [wsInviteResult, setWsInviteResult] = useState<{ code: string; expiresAt: number } | null>(null);
  const [wsInviteErr, setWsInviteErr] = useState('');
  const [wsRenaming, setWsRenaming] = useState(false);
  const [wsPolicyErr, setWsPolicyErr] = useState('');
  // Phase 31 — Runbooks + Incident Mode
  const [runbooks, setRunbooks] = useState<Array<Record<string, any>>>([]);
  const [runbookExecutions, setRunbookExecutions] = useState<Array<Record<string, any>>>([]);
  const [runbookLoading, setRunbookLoading] = useState(false);
  const [runbookErr, setRunbookErr] = useState('');
  const [runbookRunning, setRunbookRunning] = useState<string | null>(null);
  const [runbookEditId, setRunbookEditId] = useState<string | null>(null);
  const [runbookForm, setRunbookForm] = useState<Record<string, any>>({});
  const [runbookCreating, setRunbookCreating] = useState(false);
  const [runbookNewTitle, setRunbookNewTitle] = useState('');
  const [runbookNewDesc, setRunbookNewDesc] = useState('');
  const [runbookNewTrigger, setRunbookNewTrigger] = useState('manual');
  const [runbookNewIncident, setRunbookNewIncident] = useState(false);
  const [runbookNewEscChan, setRunbookNewEscChan] = useState('');
  const [incidentMode, setIncidentMode] = useState<{ active: boolean; reason?: string } | null>(null);
  const [incidentReason, setIncidentReason] = useState('');
  // Phase 32 — Pause/Resume + Handoff Queue
  const [handoffQueue, setHandoffQueue] = useState<Array<Record<string, any>>>([]);
  const [runbookDetailExec, setRunbookDetailExec] = useState<Record<string, any> | null>(null);
  const [runbookResuming, setRunbookResuming] = useState<string | null>(null);
  const [runbookAborting, setRunbookAborting] = useState<string | null>(null);
  // Phase 34 — Launch-vars modal + variable editor
  const [launchVarsModal, setLaunchVarsModal] = useState<{ rb: Record<string, any>; vals: Record<string, string> } | null>(null);
  const [runbookNewVars, setRunbookNewVars] = useState<Array<{ name: string; defaultValue: string; required: boolean; source: string }>>([]);
  // Phase 35 — Runbook Packs
  const [installedPacks, setInstalledPacks] = useState<Array<Record<string, any>>>([]);
  const [packImportModal, setPackImportModal] = useState(false);
  const [packImportJson, setPackImportJson] = useState('');
  const [packImportPreview, setPackImportPreview] = useState<Record<string, any> | null>(null);
  const [packImportErr, setPackImportErr] = useState('');
  const [packImporting, setPackImporting] = useState(false);
  const [packExportModal, setPackExportModal] = useState<{ runbookIds: string[]; json: string } | null>(null);
  const [packExportMeta, setPackExportMeta] = useState({ name: '', version: '1.0.0', description: '', author: '', changelog: '' });
  const [packExporting, setPackExporting] = useState(false);
  const [packActionErr, setPackActionErr] = useState('');
  const [packSelectIds, setPackSelectIds] = useState<Set<string>>(new Set());
  // Phase 36 — Pack trust, signing, update safety
  const [trustedSigners, setTrustedSigners] = useState<Array<Record<string, any>>>([]);
  const [packTrustPolicy, setPackTrustPolicy] = useState<Record<string, boolean>>({});
  const [packTrustPolicySaving, setPackTrustPolicySaving] = useState(false);
  const [signerModal, setSignerModal] = useState(false);
  const [signerName, setSignerName] = useState('');
  const [signerEmail, setSignerEmail] = useState('');
  const [signerPem, setSignerPem] = useState('');
  const [signerErr, setSignerErr] = useState('');
  const [localKeyInfo, setLocalKeyInfo] = useState<{ keyId: string; publicKeyPem: string } | null>(null);
  const [packSigningModal, setPackSigningModal] = useState<{ json: string } | null>(null);
  const [packSignName, setPackSignName] = useState('');
  const [packSignEmail, setPackSignEmail] = useState('');
  const [packSignErr, setPackSignErr] = useState('');
  const [packSigning, setPackSigning] = useState(false);
  // Phase 37 — Workspace analytics
  const [analyticsWindow, setAnalyticsWindow] = useState<'24h' | '7d' | '30d'>('7d');
  const [analyticsReport, setAnalyticsReport] = useState<Record<string, any> | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);
  const [analyticsErr, setAnalyticsErr] = useState('');
  const [analyticsExportText, setAnalyticsExportText] = useState('');
  // Phase 38 — Org admin
  const [orgConfig, setOrgConfig] = useState<Record<string, any> | null>(null);
  const [orgPolicy, setOrgPolicy] = useState<Record<string, any>>({});
  const [orgEffective, setOrgEffective] = useState<Record<string, any>>({});
  const [orgLoading, setOrgLoading] = useState(false);
  const [orgErr, setOrgErr] = useState('');
  const [orgCreateName, setOrgCreateName] = useState('');
  const [orgCreatePlan, setOrgCreatePlan] = useState('team');
  const [orgCreateEmail, setOrgCreateEmail] = useState('');
  const [orgSigners, setOrgSigners] = useState<Array<Record<string, any>>>([]);
  const [orgSignerModal, setOrgSignerModal] = useState(false);
  const [orgSignerName, setOrgSignerName] = useState('');
  const [orgSignerEmail, setOrgSignerEmail] = useState('');
  const [orgSignerPem, setOrgSignerPem] = useState('');
  const [orgSignerErr, setOrgSignerErr] = useState('');
  const [auditFromDate, setAuditFromDate] = useState(() => {
    const d = new Date(); d.setDate(d.getDate() - 7); return d.toISOString().slice(0, 10);
  });
  const [auditToDate, setAuditToDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [auditFormat, setAuditFormat] = useState<'json' | 'csv' | 'text'>('text');
  const [auditFilter, setAuditFilter] = useState('');
  const [auditExportText, setAuditExportText] = useState('');
  const [auditExporting, setAuditExporting] = useState(false);
  // Phase 30 — Automation governance
  const [automationPolicy, setAutomationPolicy] = useState<Record<string, any>>({});
  const [automationPolicySaving, setAutomationPolicySaving] = useState(false);
  const [automationPolicyErr, setAutomationPolicyErr] = useState('');
  const [recipePolicies, setRecipePolicies] = useState<Record<string, Record<string, any>>>({});
  const [recipePolicyEditing, setRecipePolicyEditing] = useState<string | null>(null);
  const [delegatedOperators, setDelegatedOperators] = useState<Array<Record<string, any>>>([]);
  const [delOpAssigning, setDelOpAssigning] = useState(false);
  const [delOpDeviceId, setDelOpDeviceId] = useState('');
  const [delOpLabel, setDelOpLabel] = useState('');
  const [delOpType, setDelOpType] = useState('automation_operator');
  const [automationSimRole, setAutomationSimRole] = useState('operator');
  const [automationSimRecipe, setAutomationSimRecipe] = useState('builtin-pr-review-to-slack');
  const [automationSimRemote, setAutomationSimRemote] = useState(false);
  const [automationSimResult, setAutomationSimResult] = useState<Record<string, any> | null>(null);
  const [automationSimLoading, setAutomationSimLoading] = useState(false);
  // Phase 29 — Policy matrix
  const [policyMatrix, setPolicyMatrix] = useState<Array<Record<string, any>>>([]);
  const [policyLoading, setPolicyLoading] = useState(false);
  const [policyErr, setPolicyErr] = useState('');
  const [policySimRole, setPolicySimRole] = useState('operator');
  const [policySimCat, setPolicySimCat] = useState('default');
  const [policySimResult, setPolicySimResult] = useState<{ allowed: boolean; reason: string; requiresDesktopConfirm: boolean; actorRole: string | null } | null>(null);
  const [policySimLoading, setPolicySimLoading] = useState(false);
  // Phase 28 — Workspace integrations
  const [wsIntegrations, setWsIntegrations] = useState<Record<string, any>>({});
  const [wsIntErr, setWsIntErr] = useState('');
  const [wsIntTokens, setWsIntTokens] = useState<Record<string, string>>({});
  const [wsIntUrls, setWsIntUrls]     = useState<Record<string, string>>({});
  const [wsIntEmails, setWsIntEmails] = useState<Record<string, string>>({});
  const [wsIntTestResults, setWsIntTestResults] = useState<Record<string, { ok: boolean; explanation: string } | null>>({});

  // Phase 5 — Skill Store
  const [ssTab, setSsTab]                         = useState<'import' | 'installed'>('import');
  const [ssImportMethod, setSsImportMethod]       = useState<'paste' | 'url' | 'examples'>('paste');
  const [ssPasteInput, setSsPasteInput]           = useState('');
  const [ssUrlInput, setSsUrlInput]               = useState('');
  const [ssFetching, setSsFetching]               = useState(false);
  const [ssFetchedMd, setSsFetchedMd]             = useState('');
  const [ssAnalysis, setSsAnalysis]               = useState<SkillAnalysisPreview | null>(null);
  const [ssAnalyzing, setSsAnalyzing]             = useState(false);
  const [ssInstalling, setSsInstalling]           = useState(false);
  const [ssInstalledSkills, setSsInstalledSkills] = useState<InstalledSkillRow[]>([]);
  const [ssExamples, setSsExamples]               = useState<BundledExample[]>([]);
  const [ssUninstallingId, setSsUninstallingId]   = useState<string | null>(null);
  const [ssRunningSkillId, setSsRunningSkillId]   = useState<string | null>(null);
  const [ssRunGoal, setSsRunGoal]                 = useState('');
  const [feedbacks]                               = useState<Record<string, { msg: string; color: string }>>({});

  // Phase 4 — Local Model Pipeline
  const [lmConfig, setLmConfig] = useState<{ enabled: boolean; baseUrl: string; model: string; fallback: boolean } | null>(null);
  const [lmBaseUrl, setLmBaseUrl]         = useState('http://localhost:11434');
  const [lmModelInput, setLmModelInput]   = useState('');
  const [lmAvailableModels, setLmAvailableModels] = useState<string[]>([]);
  const [lmTesting, setLmTesting]         = useState(false);
  const [lmTestResult, setLmTestResult]   = useState<{ ok: boolean; latencyMs?: number; error?: string } | null>(null);
  const [lmSaving, setLmSaving]           = useState(false);
  const [lmTogglingRouting, setLmTogglingRouting] = useState(false);
  const [lmSkillMd, setLmSkillMd]         = useState('');
  const [lmSkillAnalyzing, setLmSkillAnalyzing] = useState(false);
  const [lmSkillResult, setLmSkillResult] = useState<{ riskLevel?: string; findings?: string[]; summary?: string } | null>(null);

  // Create task form
  const [newGoal, setNewGoal]         = useState('');
  const [newCategory, setNewCategory] = useState('research');
  const [creating, setCreating]       = useState(false);

  // Scheduler form
  const [jobGoal, setJobGoal]         = useState('');
  const [jobCategory, setJobCategory] = useState('research');
  const [jobSchedule, setJobSchedule] = useState('0 9 * * *');
  const [addingJob, setAddingJob]     = useState(false);

  // UX state
  const [hustleMode, setHustleMode]   = useState(true);
  const [now, setNow]                 = useState(Date.now());
  const [approvalShake, setApprovalShake] = useState(false);
  const [awayBanner, setAwayBanner]   = useState<{ completed: number; pending: number; actions: number } | null>(null);
  const [feedback, setFeedback]       = useState<Record<string, string>>({});

  // Autonomous feel state
  const [activityMsgIdx, setActivityMsgIdx] = useState(0);
  const [activityVisible, setActivityVisible] = useState(true);
  const [idleMsgIdx, setIdleMsgIdx]     = useState(0);
  const [idleVisible, setIdleVisible]   = useState(true);
  const [transitionMsg, setTransitionMsg] = useState<string | null>(null);

  // Refs
  const mountTimeRef     = useRef(Date.now());
  const lastEventIdRef   = useRef<string | null>(null);
  const timelineRef      = useRef<HTMLDivElement>(null);
  const activeStepRef    = useRef<HTMLDivElement>(null);
  const prevApprovalCount = useRef(0);
  const centerPanelRef   = useRef<HTMLDivElement>(null);

  const selectedTask = tasks.find(t => t.id === selectedId) ?? null;

  // ── Micro-feedback helper ─────────────────────────────────────────────────

  const showFeedback = useCallback((key: string, msg: string) => {
    setFeedback(p => ({ ...p, [key]: msg }));
    setTimeout(() => setFeedback(p => { const n = { ...p }; delete n[key]; return n; }), 1800);
  }, []);

  // ── Data loaders ─────────────────────────────────────────────────────────────

  const loadTasks = useCallback(async () => {
    const res = await window.triforge.taskEngine.listTasks();
    if (res.tasks) setTasks(res.tasks as Task[]);
  }, []);

  const loadApprovals = useCallback(async () => {
    const res = await window.triforge.approvals.list();
    if (res.requests) {
      const reqs = res.requests as ApprovalRequest[];
      setApprovals(reqs);
      // Trigger shake when new approval appears
      if (reqs.length > prevApprovalCount.current) {
        setApprovalShake(true);
        setTimeout(() => setApprovalShake(false), 700);
      }
      prevApprovalCount.current = reqs.length;
    }
  }, []);

  const loadJobs    = useCallback(async () => {
    const res = await window.triforge.scheduler.listJobs();
    if (res.jobs) setJobs(res.jobs as SchedulerJob[]);
  }, []);

  const loadWallet  = useCallback(async () => {
    const res = await window.triforge.wallet.getBalance();
    if (res.snapshot) setWallet(res.snapshot as WalletSnapshot);
  }, []);

  const loadHealth  = useCallback(async () => {
    const res = await window.triforge.agentEngine.getHealth();
    setHealth(res);
  }, []);

  const loadServiceStatus = useCallback(async () => {
    const res = await (window.triforge as unknown as { hustle?: { getServiceStatus: () => Promise<{ mail?: boolean; twitter?: boolean; notify?: boolean; storage?: boolean }> } }).hustle?.getServiceStatus?.();
    if (res) setServiceStatus(res);
  }, []);

  const loadResultMetrics = useCallback(async () => {
    const res = await (window.triforge as unknown as { results?: { getMetrics: (id?: string) => Promise<{ metrics?: typeof resultMetrics }> } }).results?.getMetrics?.();
    if (res?.metrics) setResultMetrics(res.metrics);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Phase 5 — Value Engine loaders
  type ValueAPI = {
    value?: {
      listCampaigns: () => Promise<{ campaigns?: Campaign[] }>;
      createCampaign: (name: string, type: string, desc?: string) => Promise<{ campaign?: Campaign }>;
      linkTask: (campaignId: string, taskId: string) => Promise<{ ok?: boolean }>;
      getCampaignMetrics: (id: string) => Promise<{ metrics?: CampaignMetrics }>;
      getGlobalMetrics: () => Promise<{ metrics?: CampaignMetrics }>;
      getOptimization: (id: string) => Promise<{ result?: OptimizationResult }>;
      recordValue: (taskId: string, cents: number, note?: string, campaignId?: string) => Promise<{ ok?: boolean }>;
    };
  };
  const valueApi = () => (window.triforge as unknown as ValueAPI).value;

  const loadCampaigns = useCallback(async () => {
    const res = await valueApi()?.listCampaigns?.();
    if (res?.campaigns) setCampaigns(res.campaigns);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadGlobalMetrics = useCallback(async () => {
    const res = await valueApi()?.getGlobalMetrics?.();
    if (res?.metrics) setGlobalMetrics(res.metrics);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Phase 6 — Growth API helper
  type GrowthAPIShape = {
    growth?: {
      listLoops: () => Promise<{ loops?: GrowthLoop[] }>;
      createLoop: (goal: string, type: string, config: Record<string, unknown>, campaignId?: string) => Promise<{ loop?: GrowthLoop }>;
      pauseLoop:  (id: string) => Promise<{ ok?: boolean }>;
      resumeLoop: (id: string) => Promise<{ ok?: boolean }>;
      deleteLoop: (id: string) => Promise<{ ok?: boolean }>;
      runNow:     (id: string) => Promise<{ ok?: boolean }>;
      listLeads: (loopId?: string) => Promise<{ leads?: GrowthLead[] }>;
      addLead: (contact: string, name?: string, loopId?: string) => Promise<{ lead?: GrowthLead }>;
      updateLead: (id: string, patch: { status?: string; notes?: string }) => Promise<{ ok?: boolean }>;
      getGlobalMetrics: () => Promise<{ metrics?: GlobalGrowthMetrics }>;
    };
  };
  const growthApi = () => (window.triforge as unknown as GrowthAPIShape).growth;

  // Phase 7 — Compound Engine API helper
  type CompoundAPIShape = {
    compound?: {
      listStrategies: (type?: string) => Promise<{ strategies?: StrategyProfile[]; error?: string }>;
      getTopStrategies: (limit?: number) => Promise<{ strategies?: StrategyProfile[]; error?: string }>;
      getStats: () => Promise<{ stats?: CompoundStats; error?: string }>;
      runOptimization: () => Promise<{ result?: { scaled: number; optimized: number }; error?: string }>;
    };
  };
  const compoundApi = () => (window.triforge as unknown as CompoundAPIShape).compound;

  const loadStrategies = useCallback(async () => {
    const res = await compoundApi()?.getTopStrategies?.(10);
    if (res?.strategies) setStrategies(res.strategies);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadCompoundStats = useCallback(async () => {
    const res = await compoundApi()?.getStats?.();
    if (res?.stats) setCompoundStats(res.stats);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadLoops = useCallback(async () => {
    const res = await growthApi()?.listLoops?.();
    if (res?.loops) setLoops(res.loops);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadLeads = useCallback(async () => {
    const res = await growthApi()?.listLeads?.();
    if (res?.leads) setLeads(res.leads);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadGlobalGrowthMetrics = useCallback(async () => {
    const res = await growthApi()?.getGlobalMetrics?.();
    if (res?.metrics) setGlobalGrowthMetrics(res.metrics);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const loadCampaignMetrics = useCallback(async (campaignId: string) => {
    const [mRes, oRes] = await Promise.all([
      valueApi()?.getCampaignMetrics?.(campaignId),
      valueApi()?.getOptimization?.(campaignId),
    ]);
    if (mRes?.metrics) setCampaignMetrics(mRes.metrics);
    if (oRes?.result)  setOptimization(oRes.result);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const refreshTask = useCallback(async (taskId: string) => {
    const res = await window.triforge.taskEngine.getTask(taskId);
    if (res.task) setTasks(prev => prev.map(t => t.id === taskId ? (res.task as Task) : t));
  }, []);

  // ── Effects ───────────────────────────────────────────────────────────────────

  // Tick clock every second for countdowns + relative timestamps
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  // Background activity stream — cycle messages every 4.5s
  useEffect(() => {
    setActivityVisible(true);
    const id = setInterval(() => {
      setActivityVisible(false);
      setTimeout(() => {
        setActivityMsgIdx(i => (i + 1) % SYSTEM_MESSAGES.length);
        setActivityVisible(true);
      }, 450);
    }, 4500);
    return () => clearInterval(id);
  }, []);

  // Idle intelligence — cycle messages when no tasks
  useEffect(() => {
    if (tasks.length > 0) { setIdleVisible(false); return; }
    setIdleVisible(true);
    const id = setInterval(() => {
      setIdleVisible(false);
      setTimeout(() => {
        setIdleMsgIdx(i => (i + 1) % IDLE_MESSAGES.length);
        setIdleVisible(true);
      }, 450);
    }, 5000);
    return () => clearInterval(id);
  }, [tasks.length]);

  // Micro-transition message when step advances
  useEffect(() => {
    if (selectedTask?.status !== 'running') return;
    setTransitionMsg('Preparing next action…');
    const t1 = setTimeout(() => setTransitionMsg('Evaluating results…'), 1100);
    const t2 = setTimeout(() => setTransitionMsg(null), 2000);
    return () => { clearTimeout(t1); clearTimeout(t2); };
  }, [selectedTask?.currentStepIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  // Init + real-time subscription
  useEffect(() => {
    loadTasks(); loadApprovals(); loadJobs(); loadWallet(); loadHealth();
    loadServiceStatus(); loadResultMetrics();
    loadCampaigns(); loadGlobalMetrics();
    loadLoops(); loadLeads(); loadGlobalGrowthMetrics();
    loadStrategies(); loadCompoundStats();

    window.triforge.trust.getConfig().then(r => {
      if (r.config) setTrustConfig(r.config as Record<string, unknown>);
    });

    // Ring buffer backlog — tag each event with _ts from EventRecord.timestamp
    window.triforge.taskEngine.subscribeEvents().then(res => {
      if (res.events) {
        const tagged = (res.events as Array<Record<string, unknown>>).map(er => {
          const inner = (er.event as EngineEvent) ?? (er as unknown as EngineEvent);
          return { ...inner, _ts: (er.timestamp as number) ?? Date.now() };
        });
        setEvents(tagged.slice(-40));
        lastEventIdRef.current = res.lastId ?? null;
      }
    });

    // "While you were away"
    let awayTimer: ReturnType<typeof setTimeout> | null = null;
    const checkAway = async () => {
      const res = await window.triforge.taskEngine.listTasks();
      if (!res.tasks) return;
      const ts = res.tasks as Task[];
      const recentlyDone  = ts.filter(t => t.status === 'completed' && t.updatedAt > mountTimeRef.current - 15 * 60_000).length;
      const pendingApprv  = ts.filter(t => t.status === 'awaiting_approval').length;
      const evRes = await window.triforge.taskEngine.subscribeEvents();
      const actionCount   = (evRes.events?.filter((e: unknown) => (e as EngineEvent).type === 'TOOL_CALLED').length) ?? 0;
      if (recentlyDone > 0 || pendingApprv > 0 || actionCount > 3) {
        setAwayBanner({ completed: recentlyDone, pending: pendingApprv, actions: actionCount });
        awayTimer = setTimeout(() => setAwayBanner(null), 12000);
      }
    };
    checkAway();

    // Live event feed — tag with current timestamp
    const unsub = window.triforge.taskEngine.onEvent((ev) => {
      const event = { ...(ev as EngineEvent), _ts: Date.now() };
      setEvents(prev => [...prev.slice(-39), event]);

      if (event.type.startsWith('TASK_') || event.type.startsWith('STEP_') ||
          event.type === 'APPROVAL_REQUIRED' || event.type === 'APPROVAL_CREATED') {
        loadTasks();
        loadApprovals();
        loadHealth();
      }
      if (event.type === 'WALLET_UPDATED') loadWallet();
      if (['EMAIL_SENT', 'TWEET_POSTED', 'OUTREACH_COMPLETED'].includes(event.type)) {
        loadGlobalMetrics();
        loadGlobalGrowthMetrics();
        loadLeads();
        loadStrategies();
        loadCompoundStats();
        if (activeCampaignId) loadCampaignMetrics(activeCampaignId);
      }
    });

    return () => { unsub(); if (awayTimer) clearTimeout(awayTimer); };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Auto-scroll timeline to newest
  useEffect(() => {
    if (timelineRef.current) timelineRef.current.scrollLeft = timelineRef.current.scrollWidth;
  }, [events]);

  // Auto-scroll to active step when selected task changes
  useEffect(() => {
    if (activeStepRef.current) {
      setTimeout(() => activeStepRef.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }), 100);
    }
  }, [selectedTask?.currentStepIndex, selectedId]);

  // Auto-select task with pending approval (urgent)
  useEffect(() => {
    if (approvals.length > 0 && !selectedId) {
      const urgentTaskId = approvals[0].taskId;
      setSelectedId(urgentTaskId);
    }
  }, [approvals, selectedId]);

  // Load campaign-specific metrics when active campaign changes
  useEffect(() => {
    if (activeCampaignId) {
      loadCampaignMetrics(activeCampaignId);
    } else {
      setCampaignMetrics(null);
      setOptimization(null);
    }
  }, [activeCampaignId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Phase 1.5 — Background Agent + Webhook status
  useEffect(() => {
    window.triforge.backgroundLoop.status().then(s => setBgStatus(s));
    window.triforge.webhook.status().then(s => setWebhookStatus(s));
    const unsub = window.triforge.backgroundLoop.onStatus(s => setBgStatus(s));
    return unsub;
  }, []);

  // Phase 2 — Control Plane status
  useEffect(() => {
    window.triforge.controlPlane.status().then(s => setCpStatus(s));
  }, []);

  // ── Handlers ─────────────────────────────────────────────────────────────────

  const handleCreateTask = async () => {
    if (!newGoal.trim()) return;
    setCreating(true);
    try {
      const res = await window.triforge.taskEngine.createTask(newGoal.trim(), newCategory);
      if (res.task) {
        const task = res.task as Task;
        setTasks(prev => [task, ...prev]);
        setSelectedId(task.id);
        setNewGoal('');
        showFeedback('create', 'Task created');
      }
    } finally { setCreating(false); }
  };

  const handleRunTask = async (taskId: string) => {
    await window.triforge.taskEngine.runTask(taskId);
    showFeedback(`run-${taskId}`, 'Task started');
    await loadTasks();
  };

  const handlePauseTask = async (taskId: string) => {
    await window.triforge.agentTask.pause(taskId);
    showFeedback(`pause-${taskId}`, 'Paused');
    await loadTasks();
  };

  const handleCancelTask = async (taskId: string) => {
    await window.triforge.taskEngine.cancelTask(taskId);
    showFeedback(`cancel-${taskId}`, 'Cancelled');
    await loadTasks();
  };

  const handleApprove = async (approvalId: string) => {
    await window.triforge.approvals.approve(approvalId);
    showFeedback(`approval-${approvalId}`, 'Approved');
    await Promise.all([loadApprovals(), loadTasks()]);
  };

  const handleDeny = async (approvalId: string) => {
    await window.triforge.approvals.deny(approvalId, 'User denied');
    showFeedback(`approval-${approvalId}`, 'Denied');
    await Promise.all([loadApprovals(), loadTasks()]);
  };

  const handleSaveCred = async () => {
    if (!credValue.trim()) return;
    setSavingCred(true);
    try {
      const credApi = (window.triforge as unknown as { credentials?: { set: (k: string, v: string) => Promise<{ ok?: boolean; error?: string }> } }).credentials;
      if (credApi) await credApi.set(credKey, credValue.trim());
      setCredValue('');
      showFeedback('cred-save', 'Saved');
      await loadServiceStatus();
    } finally { setSavingCred(false); }
  };

  const handleCreateCampaign = async () => {
    if (!newCampaignName.trim()) return;
    const res = await valueApi()?.createCampaign?.(newCampaignName.trim(), newCampaignType);
    if (res?.campaign) {
      setCampaigns(prev => [...prev, res.campaign!]);
      setActiveCampaignId(res.campaign!.id);
      setNewCampaignName('');
      setShowNewCampaign(false);
      showFeedback('campaign-create', 'Campaign created');
    }
  };

  const handleLinkTask = async (taskId: string) => {
    if (!activeCampaignId) return;
    await valueApi()?.linkTask?.(activeCampaignId, taskId);
    showFeedback(`link-${taskId}`, 'Linked to campaign');
    await loadCampaigns();
  };

  const handleRecordValue = async () => {
    const dollars = parseFloat(valueAmount);
    if (!valueAmount.trim() || isNaN(dollars) || dollars <= 0) return;
    const cents = Math.round(dollars * 100);
    setRecordingValue(true);
    try {
      const taskId = selectedTask?.id ?? 'manual';
      await valueApi()?.recordValue?.(taskId, cents, valueNote.trim() || undefined, activeCampaignId ?? undefined);
      setValueAmount('');
      setValueNote('');
      showFeedback('record-value', 'Value recorded');
      loadGlobalMetrics();
      if (activeCampaignId) loadCampaignMetrics(activeCampaignId);
    } finally { setRecordingValue(false); }
  };

  // Phase 7 — Compound Engine handler
  const handleRunOptimization = async () => {
    setRunningOptimization(true);
    try {
      await compoundApi()?.runOptimization?.();
      await Promise.all([loadStrategies(), loadCompoundStats(), loadLoops()]);
    } finally {
      setRunningOptimization(false);
    }
  };

  // Phase 6 — Growth Engine handlers
  const handleCreateLoop = async () => {
    if (!growthGoal.trim()) return;
    setCreatingLoop(true);
    try {
      // Parse email list: one per line, format "email,name"
      const emailList = growthEmailList.trim()
        ? growthEmailList.trim().split('\n').map(line => {
            const [email, name, interest] = line.trim().split(',').map(s => s.trim());
            return email ? { email, name: name || undefined, interest: interest || undefined } : null;
          }).filter(Boolean) as Array<{ email: string; name?: string; interest?: string }>
        : [];

      const keywords = growthKeywords.trim()
        ? growthKeywords.split(',').map(k => k.trim()).filter(Boolean)
        : [];

      const config: Record<string, unknown> = {
        targetAudience: growthAudience.trim() || undefined,
        keywords:       keywords.length ? keywords : undefined,
        emailList:      emailList.length ? emailList : undefined,
        dailyEmailLimit: parseInt(growthEmailLimit, 10) || 10,
        dailyPostLimit:  parseInt(growthPostLimit, 10) || 1,
      };

      const res = await growthApi()?.createLoop?.(
        growthGoal.trim(), growthType, config, activeCampaignId ?? undefined,
      );
      if (res?.loop) {
        setLoops(prev => [res.loop!, ...prev]);
        setGrowthGoal(''); setGrowthAudience(''); setGrowthKeywords('');
        setGrowthEmailList(''); setShowGrowthForm(false);
        showFeedback('loop-create', 'Loop created');
        loadGlobalGrowthMetrics();
      }
    } finally { setCreatingLoop(false); }
  };

  const handleRunLoop = async (loopId: string) => {
    setRunningLoopId(loopId);
    try {
      await growthApi()?.runNow?.(loopId);
      showFeedback(`run-loop-${loopId}`, 'Running…');
      // Reload loops + leads after a short delay to show updated state
      setTimeout(() => { loadLoops(); loadLeads(); loadGlobalGrowthMetrics(); }, 2000);
    } finally { setRunningLoopId(null); }
  };

  const handleToggleLoop = async (loop: GrowthLoop) => {
    if (loop.status === 'active') {
      await growthApi()?.pauseLoop?.(loop.id);
      showFeedback(`toggle-${loop.id}`, 'Paused');
    } else {
      await growthApi()?.resumeLoop?.(loop.id);
      showFeedback(`toggle-${loop.id}`, 'Resumed');
    }
    await loadLoops();
  };

  const handleDeleteLoop = async (loopId: string) => {
    await growthApi()?.deleteLoop?.(loopId);
    setLoops(prev => prev.filter(l => l.id !== loopId));
    showFeedback('loop-delete', 'Deleted');
  };

  const handleAddLead = async () => {
    if (!newLeadContact.trim()) return;
    const res = await growthApi()?.addLead?.(newLeadContact.trim(), newLeadName.trim() || undefined);
    if (res?.lead) {
      setLeads(prev => [res.lead! as GrowthLead, ...prev]);
      setNewLeadContact(''); setNewLeadName(''); setShowLeadForm(false);
      showFeedback('lead-add', 'Lead added');
    }
  };

  const handleLeadStatus = async (leadId: string, status: string) => {
    await growthApi()?.updateLead?.(leadId, { status });
    setLeads(prev => prev.map(l => l.id === leadId ? { ...l, status: status as GrowthLead['status'], updatedAt: Date.now() } : l));
  };

  const handleAddJob = async () => {
    if (!jobGoal.trim()) return;
    setAddingJob(true);
    try {
      await window.triforge.scheduler.addJob(jobGoal.trim(), jobCategory, jobSchedule);
      setJobGoal('');
      showFeedback('add-job', 'Job scheduled');
      await loadJobs();
    } finally { setAddingJob(false); }
  };

  const handleCancelJob = async (jobId: string) => {
    await window.triforge.scheduler.cancelJob(jobId);
    await loadJobs();
  };

  // ── Phase 1.5 Background Agent handlers ──────────────────────────────────

  const handleBgToggle = async () => {
    setBgToggling(true);
    try {
      if (bgStatus?.enabled) {
        const s = await window.triforge.backgroundLoop.disable();
        setBgStatus(s);
      } else {
        const s = await window.triforge.backgroundLoop.enable();
        setBgStatus(s);
      }
    } finally {
      setBgToggling(false);
    }
  };

  const handleWebhookToggle = async () => {
    setWhToggling(true);
    try {
      if (webhookStatus?.enabled) {
        await window.triforge.webhook.stop();
      } else {
        const r = await window.triforge.webhook.start();
        if (r.token) setShowWhToken(true);
      }
      const s = await window.triforge.webhook.status();
      setWebhookStatus(s);
    } finally {
      setWhToggling(false);
    }
  };

  // ── Phase 2: Control Plane handlers ──────────────────────────────────────

  const handleCpToggle = async () => {
    setCpToggling(true);
    try {
      if (cpStatus?.enabled) {
        await window.triforge.controlPlane.stop();
      } else {
        const r = await window.triforge.controlPlane.start();
        if (r.token) setShowCpToken(true);
      }
      const s = await window.triforge.controlPlane.status();
      setCpStatus(s);
    } finally {
      setCpToggling(false);
    }
  };

  const handleCpGenerateToken = async () => {
    const r = await window.triforge.controlPlane.generateToken();
    if (r.token) {
      const s = await window.triforge.controlPlane.status();
      setCpStatus(s);
      setShowCpToken(true);
    }
  };

  const handleSkillAnalyze = async () => {
    if (!skillInput.trim()) return;
    setSkillAnalyzing(true);
    setSkillResult(null);
    try {
      const r = await window.triforge.skillTrust.analyze(skillInput);
      if (r.result) {
        setSkillResult({ ...r.result, decision: r.decision });
      }
    } finally {
      setSkillAnalyzing(false);
    }
  };

  // ── Phase 3: GitHub handlers ──────────────────────────────────────────────

  useEffect(() => {
    (window.triforge as unknown as { github?: { webhookStatus: () => Promise<{ enabled: boolean }> } }).github
      ?.webhookStatus().then(r => setGhWebhookEnabled(r.enabled)).catch(() => {/* no-op */});
  }, []);

  const handleGhSavePat = async () => {
    if (!ghPatInput.trim()) return;
    setGhPatSaving(true);
    try {
      await window.triforge.github.setCredential('pat', ghPatInput.trim());
      const r = await window.triforge.github.testConnection();
      if (r.ok && r.login) {
        setGhConnected({ login: r.login });
        const rr = await window.triforge.github.listRepos();
        setGhRepos(rr.repos ?? []);
        const pr = await window.triforge.github.pendingReviews();
        setGhPendingReviews(pr.reviews ?? []);
        setGhPatInput('');
      } else {
        setGhConnected(null);
        showFeedback('gh', r.error ?? 'Connection failed');
      }
    } finally {
      setGhPatSaving(false);
    }
  };

  const handleGhSelectRepo = async (fullName: string) => {
    setGhSelectedRepo(fullName);
    if (!fullName) return;
    const [owner, repo] = fullName.split('/');
    setGhLoadingRepo(true);
    setGhPRs([]);
    setGhIssues([]);
    try {
      const [prs, issues] = await Promise.all([
        window.triforge.github.listPRs(owner, repo),
        window.triforge.github.listIssues(owner, repo),
      ]);
      setGhPRs(prs.prs ?? []);
      setGhIssues(issues.issues ?? []);
    } finally {
      setGhLoadingRepo(false);
    }
  };

  const handleGhReviewPR = async (prNumber: number) => {
    if (!ghSelectedRepo) return;
    const [owner, repo] = ghSelectedRepo.split('/');
    setGhReviewingPR(prNumber);
    try {
      await window.triforge.github.reviewPR(owner, repo, prNumber);
      const pr = await window.triforge.github.pendingReviews();
      setGhPendingReviews(pr.reviews ?? []);
      setGhTab('pending');
    } finally {
      setGhReviewingPR(null);
    }
  };

  const handleGhTriageIssue = async (issueNumber: number) => {
    if (!ghSelectedRepo) return;
    const [owner, repo] = ghSelectedRepo.split('/');
    setGhTriagingIssue(issueNumber);
    try {
      await window.triforge.github.triageIssue(owner, repo, issueNumber);
      const pr = await window.triforge.github.pendingReviews();
      setGhPendingReviews(pr.reviews ?? []);
      setGhTab('pending');
    } finally {
      setGhTriagingIssue(null);
    }
  };

  const handleGhApprove = async (reviewId: string) => {
    setGhApprovingId(reviewId);
    try {
      await window.triforge.github.approveReview(reviewId);
      const pr = await window.triforge.github.pendingReviews();
      setGhPendingReviews(pr.reviews ?? []);
    } finally {
      setGhApprovingId(null);
    }
  };

  const handleGhDismiss = async (reviewId: string) => {
    setGhDismissingId(reviewId);
    try {
      await window.triforge.github.dismissReview(reviewId);
      const pr = await window.triforge.github.pendingReviews();
      setGhPendingReviews(pr.reviews ?? []);
    } finally {
      setGhDismissingId(null);
    }
  };

  const handleGhWebhookToggle = async () => {
    const r = ghWebhookEnabled
      ? await window.triforge.github.webhookDisable()
      : await window.triforge.github.webhookEnable();
    if (r.ok) setGhWebhookEnabled(!ghWebhookEnabled);
  };

  const handleGhSaveWebhookSecret = async () => {
    if (!ghWebhookSecret.trim()) return;
    setGhWebhookSecretSaving(true);
    try {
      await window.triforge.github.setCredential('webhook_secret', ghWebhookSecret.trim());
      setGhWebhookSecret('');
      showFeedback('ghwh', 'Saved');
    } finally {
      setGhWebhookSecretSaving(false);
    }
  };

  // ── Phase 7: Policy Engine handlers ───────────────────────────────────────

  const loadPolicyRules = useCallback(async () => {
    const r = await window.triforge.policy.list();
    setPolicyRules(r.rules ?? []);
  }, []);

  useEffect(() => { loadPolicyRules(); }, [loadPolicyRules]);

  const handlePolicyToggle = async (id: string, enabled: boolean) => {
    if (enabled) await window.triforge.policy.enable(id);
    else         await window.triforge.policy.disable(id);
    await loadPolicyRules();
  };

  const handlePolicyDelete = async (id: string) => {
    await window.triforge.policy.delete(id);
    await loadPolicyRules();
  };

  const handlePolicyAdd = async () => {
    if (!newRuleName.trim()) return;
    setAddingRule(true);
    try {
      await window.triforge.policy.create({
        name:          newRuleName.trim(),
        priority:      parseInt(newRulePriority, 10) || 75,
        enabled:       true,
        matchSource:   newRuleSource,
        matchRiskClass: newRuleRisk,
        matchCategory: newRuleCategory.trim() || undefined,
        action:        newRuleAction,
        preferLocal:   newRulePreferLocal,
      });
      await loadPolicyRules();
      setNewRuleName(''); setNewRuleCategory(''); setNewRulePriority('75');
      setNewRuleSource('*'); setNewRuleRisk('*'); setNewRuleAction('approval');
      setNewRulePreferLocal(false);
      setPolicyTab('rules');
    } finally {
      setAddingRule(false);
    }
  };

  const handlePolicyReset = async () => {
    setPolicyResetting(true);
    try {
      await window.triforge.policy.reset();
      await loadPolicyRules();
      showFeedback('pol', 'Defaults restored');
    } finally {
      setPolicyResetting(false);
    }
  };

  const handlePolicySimulate = async () => {
    setSimRunning(true);
    setSimResult(null);
    try {
      const r = await window.triforge.policy.simulate(simSource, simRisk, simCategory || undefined);
      setSimResult(r.resolution);
    } finally {
      setSimRunning(false);
    }
  };

  // ── Phase 6: Telegram handlers ────────────────────────────────────────────

  const loadTgStatus = useCallback(async () => {
    const r = await window.triforge.telegram.status();
    setTgStatus(r);
  }, []);

  const loadTgMessages = useCallback(async () => {
    const r = await window.triforge.telegram.listMessages(30);
    setTgMessages(r.messages ?? []);
  }, []);

  useEffect(() => {
    loadTgStatus();
  }, [loadTgStatus]);

  // Poll messages every 5s when the messages tab is active
  useEffect(() => {
    if (tgTab !== 'messages') return;
    loadTgMessages();
    const id = setInterval(loadTgMessages, 5000);
    return () => clearInterval(id);
  }, [tgTab, loadTgMessages]);

  const handleTgSaveToken = async () => {
    if (!tgTokenInput.trim()) return;
    setTgTokenSaving(true);
    try {
      await window.triforge.telegram.setToken(tgTokenInput.trim());
      const r = await window.triforge.telegram.testConnection();
      if (r.ok) {
        setTgTokenInput('');
        await loadTgStatus();
        showFeedback('tg', `Connected @${r.username}`);
      } else {
        showFeedback('tg', r.error ?? 'Invalid token');
      }
    } finally {
      setTgTokenSaving(false);
    }
  };

  const handleTgToggle = async () => {
    setTgToggling(true);
    try {
      if (tgStatus?.running) {
        await window.triforge.telegram.stop();
      } else {
        const r = await window.triforge.telegram.start();
        if (!r.ok) { showFeedback('tg', r.error ?? 'Failed to start'); }
      }
      await loadTgStatus();
    } finally {
      setTgToggling(false);
    }
  };

  const handleTgAddChat = async () => {
    const id = parseInt(tgChatIdInput.trim(), 10);
    if (isNaN(id)) return;
    await window.triforge.telegram.addAllowedChat(id);
    setTgChatIdInput('');
    await loadTgStatus();
  };

  const handleTgRemoveChat = async (chatId: number) => {
    await window.triforge.telegram.removeAllowedChat(chatId);
    await loadTgStatus();
  };

  const handleTgSendTest = async () => {
    if (!tgTestMsg.trim() || !tgChatIdInput.trim()) return;
    const chatId = parseInt(tgChatIdInput.trim(), 10);
    if (isNaN(chatId)) return;
    setTgSending(true);
    try {
      const r = await window.triforge.telegram.sendMessage(chatId, tgTestMsg.trim());
      if (r.ok) { setTgTestMsg(''); showFeedback('tg', 'Sent'); }
      else { showFeedback('tg', r.error ?? 'Failed'); }
    } finally {
      setTgSending(false);
    }
  };

  // ── Phase 8: Slack handlers ────────────────────────────────────────────────

  const loadSlackStatus = useCallback(async () => {
    const r = await window.triforge.slack.status();
    setSlackStatus(r);
    setSlackSummaryChannelInput(r.summaryChannel ?? '');
  }, []);

  const loadSlackMessages = useCallback(async () => {
    const r = await window.triforge.slack.listMessages(40);
    setSlackMessages(r.messages ?? []);
  }, []);

  useEffect(() => { loadSlackStatus(); }, [loadSlackStatus]);

  useEffect(() => {
    if (slackTab !== 'messages') return;
    loadSlackMessages();
    const id = setInterval(loadSlackMessages, 5000);
    return () => clearInterval(id);
  }, [slackTab, loadSlackMessages]);

  const handleSlackSaveToken = async () => {
    if (!slackTokenInput.trim()) return;
    setSlackTokenSaving(true);
    try {
      await window.triforge.slack.setToken(slackTokenInput.trim());
      const r = await window.triforge.slack.testConnection();
      if (r.ok) { showFeedback('sl', `Connected: ${r.workspaceName}`); setSlackTokenInput(''); await loadSlackStatus(); }
      else { showFeedback('sl', r.error ?? 'Connection failed'); }
    } finally {
      setSlackTokenSaving(false);
    }
  };

  const handleSlackToggle = async () => {
    if (!slackStatus) return;
    setSlackToggling(true);
    try {
      if (slackStatus.running) {
        await window.triforge.slack.stop();
        showFeedback('sl', 'Bot stopped');
      } else {
        const r = await window.triforge.slack.start();
        if (r.ok) showFeedback('sl', `Online: ${r.workspaceName}`);
        else showFeedback('sl', r.error ?? 'Failed to start');
      }
      await loadSlackStatus();
    } finally {
      setSlackToggling(false);
    }
  };

  const handleSlackLoadChannels = async () => {
    setSlackChannelsLoading(true);
    try {
      const r = await window.triforge.slack.listChannels();
      if (r.ok) setSlackChannels(r.channels);
      else showFeedback('sl', r.error ?? 'Failed to load channels');
    } finally {
      setSlackChannelsLoading(false);
    }
  };

  const handleSlackAddChannel = async (channelId: string) => {
    const r = await window.triforge.slack.addAllowedChannel(channelId);
    if (r.ok) await loadSlackStatus();
  };

  const handleSlackRemoveChannel = async (channelId: string) => {
    await window.triforge.slack.removeAllowedChannel(channelId);
    await loadSlackStatus();
  };

  const handleSlackAddUser = async () => {
    const uid = slackUserInput.trim();
    if (!uid) return;
    await window.triforge.slack.addAllowedUser(uid);
    setSlackUserInput('');
    await loadSlackStatus();
  };

  const handleSlackRemoveUser = async (userId: string) => {
    await window.triforge.slack.removeAllowedUser(userId);
    await loadSlackStatus();
  };

  const handleSlackSendTest = async () => {
    if (!slackTestMsg.trim() || !slackTestChannelId.trim()) return;
    setSlackSending(true);
    try {
      const r = await window.triforge.slack.sendMessage(slackTestChannelId.trim(), slackTestMsg.trim());
      if (r.ok) { setSlackTestMsg(''); showFeedback('sl', 'Sent'); }
      else showFeedback('sl', r.error ?? 'Failed');
    } finally {
      setSlackSending(false);
    }
  };

  const handleSlackSaveSummaryChannel = async () => {
    await window.triforge.slack.setSummaryChannel(slackSummaryChannelInput.trim());
    await loadSlackStatus();
    showFeedback('sl', 'Summary channel saved');
  };

  const handleSlackSetSchedule = async (schedule: 'disabled' | 'daily' | 'weekly') => {
    await window.triforge.slack.setSummarySchedule(schedule);
    await loadSlackStatus();
  };

  const handleSlackSendSummaryNow = async () => {
    await window.triforge.slack.sendSummaryNow();
    showFeedback('sl', 'Summary sent');
  };

  // ── Phase 9: Jira handlers ─────────────────────────────────────────────────

  const loadJiraStatus = useCallback(async () => {
    const r = await window.triforge.jira.status();
    setJiraStatus(r);
    setJiraSummaryChannelInput(r.summarySlackChannel ?? '');
    if (r.workspaceUrl) setJiraWorkspaceInput(r.workspaceUrl);
    if (r.email)        setJiraEmailInput(r.email);
  }, []);

  const loadJiraQueue = useCallback(async () => {
    const r = await window.triforge.jira.listQueue(true);
    setJiraQueue(r.actions ?? []);
  }, []);

  useEffect(() => { loadJiraStatus(); }, [loadJiraStatus]);

  useEffect(() => {
    if (jiraTab === 'queue') loadJiraQueue();
  }, [jiraTab, loadJiraQueue]);

  const handleJiraConnect = async () => {
    if (!jiraWorkspaceInput.trim() || !jiraEmailInput.trim() || !jiraTokenInput.trim()) return;
    setJiraConnecting(true);
    try {
      await window.triforge.jira.setCredentials(jiraWorkspaceInput.trim(), jiraEmailInput.trim(), jiraTokenInput.trim());
      const r = await window.triforge.jira.testConnection();
      if (r.ok) {
        showFeedback('jira', `Connected: ${r.displayName}`);
        setJiraTokenInput('');
        await loadJiraStatus();
        const pr = await window.triforge.jira.listProjects();
        if (pr.ok) setJiraProjects(pr.projects);
      } else {
        showFeedback('jira', r.error ?? 'Connection failed');
      }
    } finally {
      setJiraConnecting(false);
    }
  };

  const handleJiraSearch = async () => {
    setJiraIssuesLoading(true);
    setJiraIssues([]);
    try {
      const r = await window.triforge.jira.searchIssues(jiraJql, 25);
      if (r.ok) setJiraIssues(r.issues);
      else showFeedback('jira', r.error ?? 'Search failed');
    } finally {
      setJiraIssuesLoading(false);
    }
  };

  const handleJiraSelectIssue = async (key: string) => {
    setJiraIssueLoading(true);
    setJiraSelectedIssue(null);
    setJiraComments([]);
    setJiraTransitions([]);
    setJiraCommentInput('');
    setJiraTriageTaskId(null);
    setJiraTab('act');
    try {
      const r = await window.triforge.jira.getIssue(key);
      if (r.ok && r.issue) {
        setJiraSelectedIssue(r.issue as JiraIssueDetail);
        setJiraComments(r.comments ?? []);
        setJiraTransitions(r.transitions ?? []);
      } else {
        showFeedback('jira', r.error ?? 'Failed to load issue');
      }
    } finally {
      setJiraIssueLoading(false);
    }
  };

  const handleJiraQueueComment = async () => {
    if (!jiraSelectedIssue || !jiraCommentInput.trim()) return;
    setJiraCommentSending(true);
    try {
      const r = await window.triforge.jira.queueComment(jiraSelectedIssue.key, jiraCommentInput.trim());
      if (r.ok) {
        showFeedback('jira', 'Comment queued for approval');
        setJiraCommentInput('');
        await loadJiraQueue();
      } else {
        showFeedback('jira', r.error ?? 'Failed');
      }
    } finally {
      setJiraCommentSending(false);
    }
  };

  const handleJiraQueueTransition = async (transition: JiraTransitionRow) => {
    if (!jiraSelectedIssue) return;
    const r = await window.triforge.jira.queueTransition(jiraSelectedIssue.key, transition.id, transition.toStatus);
    if (r.ok) { showFeedback('jira', `Transition "${transition.name}" queued`); await loadJiraQueue(); }
    else showFeedback('jira', r.error ?? 'Failed');
  };

  const handleJiraTriage = async () => {
    if (!jiraSelectedIssue) return;
    setJiraTriaging(true);
    try {
      const r = await window.triforge.jira.triageIssue(jiraSelectedIssue.key);
      if (r.ok && r.taskId) { setJiraTriageTaskId(r.taskId); showFeedback('jira', 'Triage submitted'); }
      else showFeedback('jira', r.error ?? 'Failed');
    } finally {
      setJiraTriaging(false);
    }
  };

  const handleJiraApprove = async (actionId: string) => {
    setJiraQueueProcessing(actionId);
    try {
      const r = await window.triforge.jira.approveAction(actionId);
      if (r.ok) { showFeedback('jira', 'Action executed'); await loadJiraQueue(); }
      else showFeedback('jira', r.error ?? 'Failed');
    } finally {
      setJiraQueueProcessing(null);
    }
  };

  const handleJiraDismiss = async (actionId: string) => {
    await window.triforge.jira.dismissAction(actionId);
    await loadJiraQueue();
  };

  const handleJiraSendSummary = async () => {
    setJiraSummaryLoading(true);
    try {
      if (jiraSummaryChannelInput.trim() !== jiraStatus?.summarySlackChannel) {
        await window.triforge.jira.setSummarySlackChannel(jiraSummaryChannelInput.trim());
        await loadJiraStatus();
      }
      const r = await window.triforge.jira.sendSummaryNow(jiraJql);
      if (r.ok) showFeedback('jira', 'Summary posted to Slack');
      else showFeedback('jira', r.error ?? 'Failed');
    } finally {
      setJiraSummaryLoading(false);
    }
  };

  // ── Phase 12: Discord handlers ─────────────────────────────────────────────

  const loadDiscordStatus = useCallback(async () => {
    const r = await window.triforge.discord.status();
    setDiscordStatus(r);
  }, []);

  useEffect(() => { loadDiscordStatus(); }, [loadDiscordStatus]);

  useEffect(() => {
    if (discordTab === 'messages') {
      window.triforge.discord.listMessages(50).then(r => setDiscordMessages(r.messages ?? [])).catch(() => {});
    }
  }, [discordTab]);

  const handleDiscordConnect = async () => {
    if (!discordTokenInput.trim()) return;
    setDiscordConnecting(true);
    try {
      await window.triforge.discord.setToken(discordTokenInput.trim());
      const r = await window.triforge.discord.testConnection();
      if (r.ok) {
        showFeedback('dsc', `Connected: ${r.username}`);
        setDiscordTokenInput('');
        await loadDiscordStatus();
        const gr = await window.triforge.discord.listGuilds();
        if (gr.ok) setDiscordGuilds(gr.guilds);
      } else {
        showFeedback('dsc', r.error ?? 'Connection failed');
      }
    } finally {
      setDiscordConnecting(false);
    }
  };

  const handleDiscordToggle = async () => {
    if (discordStatus?.running) {
      await window.triforge.discord.stop();
    } else {
      const r = await window.triforge.discord.start();
      if (!r.ok) { showFeedback('dsc', r.error ?? 'Start failed'); }
    }
    await loadDiscordStatus();
  };

  const handleDiscordLoadChannels = async (guild: DiscordGuild) => {
    setDiscordSelectedGuild(guild);
    setDiscordChannelsLoading(true);
    setDiscordChannels([]);
    try {
      const r = await window.triforge.discord.listChannels(guild.id);
      if (r.ok) setDiscordChannels(r.channels);
    } finally {
      setDiscordChannelsLoading(false);
    }
  };

  const handleDiscordAddChannel = async (channelId: string) => {
    if (!channelId.trim()) return;
    const r = await window.triforge.discord.addAllowedChannel(channelId.trim());
    setDiscordStatus(prev => prev ? { ...prev, allowedChannels: r.allowedChannels } : prev);
    setDiscordChannelIdInput('');
  };

  const handleDiscordRemoveChannel = async (channelId: string) => {
    const r = await window.triforge.discord.removeAllowedChannel(channelId);
    setDiscordStatus(prev => prev ? { ...prev, allowedChannels: r.allowedChannels } : prev);
  };

  const handleDiscordAddUser = async () => {
    if (!discordUserIdInput.trim()) return;
    const r = await window.triforge.discord.addAllowedUser(discordUserIdInput.trim());
    setDiscordStatus(prev => prev ? { ...prev, allowedUsers: r.allowedUsers } : prev);
    setDiscordUserIdInput('');
  };

  const handleDiscordRemoveUser = async (userId: string) => {
    const r = await window.triforge.discord.removeAllowedUser(userId);
    setDiscordStatus(prev => prev ? { ...prev, allowedUsers: r.allowedUsers } : prev);
  };

  const handleDiscordTestSend = async () => {
    if (!discordTestChannelId.trim() || !discordTestText.trim()) return;
    setDiscordTestSending(true);
    try {
      const r = await window.triforge.discord.sendMessage(discordTestChannelId.trim(), discordTestText.trim());
      if (r.ok) showFeedback('dsc', 'Message sent');
      else showFeedback('dsc', r.error ?? 'Failed');
    } finally {
      setDiscordTestSending(false);
    }
  };

  // ── Phase 11: Linear handlers ──────────────────────────────────────────────

  const loadLinearStatus = useCallback(async () => {
    const r = await window.triforge.linear.status();
    setLinearStatus(r);
    setLinearSummaryChannelInput(r.summarySlackChannel ?? '');
  }, []);

  const loadLinearQueue = useCallback(async () => {
    const r = await window.triforge.linear.listQueue(true);
    setLinearQueue(r.actions ?? []);
  }, []);

  useEffect(() => { loadLinearStatus(); }, [loadLinearStatus]);

  useEffect(() => {
    if (linearTab === 'queue') loadLinearQueue();
  }, [linearTab, loadLinearQueue]);

  const handleLinearConnect = async () => {
    if (!linearApiKeyInput.trim()) return;
    setLinearConnecting(true);
    try {
      await window.triforge.linear.setApiKey(linearApiKeyInput.trim());
      const r = await window.triforge.linear.testConnection();
      if (r.ok) {
        showFeedback('lin', `Connected: ${r.name}`);
        setLinearApiKeyInput('');
        await loadLinearStatus();
        const tr = await window.triforge.linear.listTeams();
        if (tr.ok) setLinearTeams(tr.teams);
      } else {
        showFeedback('lin', r.error ?? 'Connection failed');
      }
    } finally {
      setLinearConnecting(false);
    }
  };

  const handleLinearSearch = async () => {
    setLinearIssuesLoading(true);
    setLinearIssues([]);
    try {
      const r = await window.triforge.linear.searchIssues(linearQuery, linearSelectedTeam?.id, 25);
      if (r.ok) setLinearIssues(r.issues);
      else showFeedback('lin', r.error ?? 'Search failed');
    } finally {
      setLinearIssuesLoading(false);
    }
  };

  const handleLinearSelectIssue = async (issue: LinearIssueRow) => {
    setLinearIssueLoading(true);
    setLinearSelectedIssue(null);
    setLinearComments([]);
    setLinearStates([]);
    setLinearCommentInput('');
    setLinearTriageTaskId(null);
    setLinearTab('act');
    try {
      const r = await window.triforge.linear.getIssue(issue.id);
      if (r.ok && r.issue) {
        setLinearSelectedIssue(r.issue);
        setLinearComments(r.comments ?? []);
        setLinearStates(r.states ?? []);
      } else {
        showFeedback('lin', r.error ?? 'Failed to load issue');
      }
    } finally {
      setLinearIssueLoading(false);
    }
  };

  const handleLinearQueueComment = async () => {
    if (!linearSelectedIssue || !linearCommentInput.trim()) return;
    setLinearCommentSending(true);
    try {
      const r = await window.triforge.linear.queueComment(linearSelectedIssue.id, linearSelectedIssue.identifier, linearCommentInput.trim());
      if (r.ok) {
        showFeedback('lin', 'Comment queued for approval');
        setLinearCommentInput('');
        await loadLinearQueue();
      } else {
        showFeedback('lin', r.error ?? 'Failed');
      }
    } finally {
      setLinearCommentSending(false);
    }
  };

  const handleLinearQueueStateUpdate = async (state: LinearStateRow) => {
    if (!linearSelectedIssue) return;
    const r = await window.triforge.linear.queueUpdate(linearSelectedIssue.id, linearSelectedIssue.identifier, { stateId: state.id, stateName: state.name });
    if (r.ok) { showFeedback('lin', `Move to "${state.name}" queued`); await loadLinearQueue(); }
    else showFeedback('lin', r.error ?? 'Failed');
  };

  const handleLinearTriage = async () => {
    if (!linearSelectedIssue) return;
    setLinearTriaging(true);
    try {
      const r = await window.triforge.linear.triageIssue(linearSelectedIssue.id);
      if (r.ok && r.taskId) { setLinearTriageTaskId(r.taskId); showFeedback('lin', 'Triage submitted'); }
      else showFeedback('lin', r.error ?? 'Failed');
    } finally {
      setLinearTriaging(false);
    }
  };

  const handleLinearApprove = async (actionId: string) => {
    setLinearQueueProcessing(actionId);
    try {
      const r = await window.triforge.linear.approveAction(actionId);
      if (r.ok) { showFeedback('lin', 'Action executed'); await loadLinearQueue(); }
      else showFeedback('lin', r.error ?? 'Failed');
    } finally {
      setLinearQueueProcessing(null);
    }
  };

  const handleLinearDismiss = async (actionId: string) => {
    await window.triforge.linear.dismissAction(actionId);
    await loadLinearQueue();
  };

  const handleLinearSendSummary = async () => {
    setLinearSummaryLoading(true);
    try {
      if (linearSummaryChannelInput.trim() !== linearStatus?.summarySlackChannel) {
        await window.triforge.linear.setSummarySlackChannel(linearSummaryChannelInput.trim());
        await loadLinearStatus();
      }
      const r = await window.triforge.linear.sendSummaryNow(linearQuery || undefined, linearSelectedTeam?.id);
      if (r.ok) showFeedback('lin', 'Summary posted to Slack');
      else showFeedback('lin', r.error ?? 'Failed');
    } finally {
      setLinearSummaryLoading(false);
    }
  };

  // ── Phase 10: Push Notification handlers ──────────────────────────────────

  const loadPushStatus = useCallback(async () => {
    const r = await window.triforge.push.status();
    setPushProviderState((r.provider as 'ntfy' | 'pushover' | 'disabled') ?? 'disabled');
    setPushNtfyTopic(r.ntfyTopic ?? '');
    setPushNtfyServer(r.ntfyServer ?? '');
    setPushoverUser(r.pushoverUser ?? '');
  }, []);

  const loadPushEvents = useCallback(async () => {
    const r = await window.triforge.push.getEventSettings();
    setPushEvents(r.events ?? []);
  }, []);

  useEffect(() => { loadPushStatus(); loadPushEvents(); }, [loadPushStatus, loadPushEvents]);

  useEffect(() => {
    if (pushTab === 'log') {
      window.triforge.push.getLog(50).then(r => setPushLog(r.entries ?? [])).catch(() => {});
    }
  }, [pushTab]);

  const handlePushSave = async () => {
    setPushSaving(true);
    try {
      await window.triforge.push.configure({
        provider: pushProvider,
        ntfyTopic: pushNtfyTopic.trim() || undefined,
        ntfyServer: pushNtfyServer.trim() || undefined,
        ntfyToken:  pushNtfyToken.trim() || undefined,
        pushoverApp: pushoverApp.trim() || undefined,
        pushoverUser: pushoverUser.trim() || undefined,
      });
      showFeedback('push', 'Saved');
      setPushNtfyToken('');
      setPushoverApp('');
      await loadPushStatus();
    } finally {
      setPushSaving(false);
    }
  };

  const handlePushTest = async () => {
    setPushTesting(true);
    try {
      const r = await window.triforge.push.sendTest();
      if (r.ok) showFeedback('push', 'Test notification sent');
      else showFeedback('push', r.error ?? 'Failed — check provider config');
    } finally {
      setPushTesting(false);
    }
  };

  const handlePushEventToggle = async (key: string, enabled: boolean) => {
    const ev = pushEvents.find(e => e.key === key);
    if (!ev) return;
    await window.triforge.push.setEventSetting(key, enabled, ev.priority);
    setPushEvents(prev => prev.map(e => e.key === key ? { ...e, enabled } : e));
  };

  const handlePushEventPriority = async (key: string, priority: string) => {
    const ev = pushEvents.find(e => e.key === key);
    if (!ev) return;
    await window.triforge.push.setEventSetting(key, ev.enabled, priority);
    setPushEvents(prev => prev.map(e => e.key === key ? { ...e, priority } : e));
  };

  // ── Phase 13: Automation Recipe handlers ──────────────────────────────────

  const loadRecipes = useCallback(async () => {
    const list = await window.triforge.recipe.list();
    setRecipes(list);
    const init: Record<string, Record<string, string>> = {};
    for (const r of list) { init[r.id] = { ...r.params }; }
    setRecipeParams(init);
  }, []);

  useEffect(() => { loadRecipes(); }, [loadRecipes]);

  const handleRecipeToggle = async (id: string, enabled: boolean) => {
    await window.triforge.recipe.toggle(id, enabled);
    setRecipes(prev => prev.map(r => r.id === id ? { ...r, enabled } : r));
  };

  const handleRecipeParamChange = (id: string, key: string, value: string) => {
    setRecipeParams(prev => ({ ...prev, [id]: { ...(prev[id] ?? {}), [key]: value } }));
  };

  const handleRecipeSaveParams = async (id: string) => {
    setRecipesSaving(prev => ({ ...prev, [id]: true }));
    try {
      await window.triforge.recipe.setParams(id, recipeParams[id] ?? {});
      setRecipes(prev => prev.map(r => r.id === id ? { ...r, params: recipeParams[id] ?? {} } : r));
    } finally {
      setRecipesSaving(prev => ({ ...prev, [id]: false }));
    }
  };

  const handleRecipeRun = async (id: string) => {
    setRecipeRunning(prev => ({ ...prev, [id]: true }));
    try {
      const result = await window.triforge.recipe.run(id);
      setRecipes(prev => prev.map(r => r.id === id ? {
        ...r,
        lastRunAt:     Date.now(),
        lastRunStatus: result.ok ? 'success' : 'failed',
        lastRunResult: result.result ?? result.error ?? '',
      } : r));
    } finally {
      setRecipeRunning(prev => ({ ...prev, [id]: false }));
    }
  };

  // ── Phase 14: Ops Dashboard handlers ─────────────────────────────────────────

  const loadOps = useCallback(async (tab: typeof opsTab, win: OpsWindow) => {
    setOpsLoading(true);
    try {
      if (tab === 'overview') {
        const r = await window.triforge.ops.overview(win);
        setOpsOverview(r);
      } else if (tab === 'channels') {
        const r = await window.triforge.ops.channels(win);
        setOpsChannels(r);
      } else if (tab === 'governance') {
        const r = await window.triforge.ops.governance(win);
        setOpsGovernance(r);
      } else if (tab === 'integrations') {
        const r = await window.triforge.ops.integrations(win);
        setOpsIntegrations(r);
      } else if (tab === 'recipes') {
        const r = await window.triforge.ops.recipes(win);
        setOpsRecipes(r.recipes);
      } else if (tab === 'health') {
        const r = await window.triforge.ops.health();
        setOpsHealth(r.services);
      }
    } finally {
      setOpsLoading(false);
    }
  }, []);

  useEffect(() => { loadOps(opsTab, opsWindow); }, [opsTab, opsWindow, loadOps]);

  // ── Phase 15: Action Center handlers ──────────────────────────────────────────

  const loadActions = useCallback(async (view: ActionView) => {
    setActionLoading(true);
    try {
      const [listResult, countResult] = await Promise.all([
        window.triforge.action.list(view),
        window.triforge.action.count(),
      ]);
      setActionItems(listResult.items);
      setActionCount(countResult);
    } finally {
      setActionLoading(false);
    }
  }, []);

  useEffect(() => { loadActions(actionView); }, [actionView, loadActions]);

  const handleActionApprove = async (item: ActionItem) => {
    setActionWorking(prev => ({ ...prev, [item.id]: true }));
    try {
      const r = await window.triforge.action.approve(item.id);
      if (r.ok) setActionItems(prev => prev.filter(i => i.id !== item.id));
    } finally {
      setActionWorking(prev => ({ ...prev, [item.id]: false }));
    }
  };

  const handleActionDismiss = async (item: ActionItem) => {
    setActionWorking(prev => ({ ...prev, [item.id]: true }));
    try {
      await window.triforge.action.dismiss(item.id);
      setActionItems(prev => prev.filter(i => i.id !== item.id));
      setActionCount(prev => prev ? { ...prev, total: Math.max(0, prev.total - 1) } : null);
    } finally {
      setActionWorking(prev => ({ ...prev, [item.id]: false }));
    }
  };

  const handleActionRetry = async (item: ActionItem) => {
    setActionWorking(prev => ({ ...prev, [item.id]: true }));
    try {
      const r = await window.triforge.action.retry(item.id);
      if (r.ok) setActionItems(prev => prev.filter(i => i.id !== item.id));
    } finally {
      setActionWorking(prev => ({ ...prev, [item.id]: false }));
    }
  };

  // ── Phase 16: Shared Context / Team Memory handlers ──────────────────────────

  const loadMemory = useCallback(async () => {
    setMemLoading(true);
    try {
      const r = await window.triforge.context.getAll();
      setMemRepos(r.repoMappings as RepoMappingRow[]);
      setMemChannels(r.channelMappings as ChannelMappingRow[]);
      setMemProjects(r.projectNotes as ProjectNoteRow[]);
      setMemEnabled((r.enabled as Record<string, boolean>) ?? {});
    } finally {
      setMemLoading(false);
    }
  }, []);

  useEffect(() => { loadMemory(); }, [loadMemory]);

  const handleMemSaveRepo = async () => {
    if (!memRepoInput.trim()) return;
    setMemRepoSaving(true);
    try {
      const r = await window.triforge.context.upsertRepo({
        repo: memRepoInput.trim(),
        jiraProjectKey: memRepoJiraKey.trim() || undefined,
        linearTeamId:   memRepoLinearId.trim() || undefined,
        reviewInstructions: memRepoInstructions.trim() || undefined,
      });
      setMemRepos(r.repoMappings as RepoMappingRow[]);
      setMemRepoInput(''); setMemRepoJiraKey(''); setMemRepoLinearId(''); setMemRepoInstructions('');
    } finally { setMemRepoSaving(false); }
  };

  const handleMemDeleteRepo = async (id: string) => {
    await window.triforge.context.deleteRepo(id);
    setMemRepos(prev => prev.filter(r => r.id !== id));
  };

  const handleMemSaveChan = async () => {
    if (!memChanId.trim()) return;
    setMemChanSaving(true);
    try {
      const r = await window.triforge.context.upsertChannel({
        channel:    memChanChannel,
        channelId:  memChanId.trim(),
        channelName: memChanName.trim() || undefined,
        workstream: memChanWorkstream.trim() || undefined,
        projectKey: memChanProjectKey.trim() || undefined,
      });
      setMemChannels(r.channelMappings as ChannelMappingRow[]);
      setMemChanId(''); setMemChanName(''); setMemChanWorkstream(''); setMemChanProjectKey('');
    } finally { setMemChanSaving(false); }
  };

  const handleMemDeleteChan = async (id: string) => {
    await window.triforge.context.deleteChannel(id);
    setMemChannels(prev => prev.filter(c => c.id !== id));
  };

  const handleMemSaveProject = async () => {
    if (!memProjKey.trim()) return;
    setMemProjSaving(true);
    try {
      const r = await window.triforge.context.upsertProject({
        projectKey:  memProjKey.trim(),
        projectName: memProjName.trim() || undefined,
        summary:     memProjSummary.trim() || undefined,
        automationContext: memProjContext.trim() || undefined,
      });
      setMemProjects(r.projectNotes as ProjectNoteRow[]);
      setMemProjKey(''); setMemProjName(''); setMemProjSummary(''); setMemProjContext('');
    } finally { setMemProjSaving(false); }
  };

  const handleMemDeleteProject = async (id: string) => {
    await window.triforge.context.deleteProject(id);
    setMemProjects(prev => prev.filter(p => p.id !== id));
  };

  const handleMemToggle = async (category: string, enabled: boolean) => {
    await window.triforge.context.setEnabled(category, enabled);
    setMemEnabled(prev => ({ ...prev, [category]: enabled }));
  };

  // ── Phase 17+18: TriForge Dispatch handlers ───────────────────────────────────

  const loadDispatch = useCallback(async () => {
    const [statusResult, devicesResult, confsResult, urlResult] = await Promise.all([
      window.triforge.dispatch.status(),
      window.triforge.dispatch.listDevices(),
      window.triforge.dispatch.listPendingConfirmations(),
      window.triforge.dispatch.getPublicUrl(),
    ]);
    setDispatchStatus(statusResult);
    setDispatchDevices(devicesResult);
    setDispatchPendingConfs(confsResult);
    if (statusResult.port) setDispatchPort(String(statusResult.port));
    if (urlResult.url) setDispatchPublicUrl(urlResult.url);
  }, []);

  useEffect(() => { loadDispatch(); }, [loadDispatch]);

  // Phase 27 — load workspace
  const loadWorkspace = useCallback(async () => {
    try { const ws = await (window.triforge as any).workspace.get(); setWorkspace(ws); } catch {}
  }, []);
  useEffect(() => { loadWorkspace(); }, [loadWorkspace]);

  const WS_INTEGRATIONS: Array<{ key: string; label: string; needsUrl?: boolean; needsEmail?: boolean; isPush?: boolean }> = [
    { key: 'github',  label: 'GitHub' },
    { key: 'slack',   label: 'Slack' },
    { key: 'jira',    label: 'Jira', needsUrl: true, needsEmail: true },
    { key: 'linear',  label: 'Linear' },
    { key: 'push',    label: 'Push', isPush: true },
  ];
  const loadWsIntegrations = useCallback(async () => {
    const results: Record<string, any> = {};
    await Promise.all(WS_INTEGRATIONS.map(async ({ key }) => {
      try { results[key] = await (window.triforge as any).workspaceIntegration.getStatus(key); } catch {}
    }));
    setWsIntegrations(results);
  }, []);
  useEffect(() => { if (dispatchTab === 'integrations') loadWsIntegrations(); }, [dispatchTab, loadWsIntegrations]);

  const loadPolicyMatrix = useCallback(async () => {
    setPolicyLoading(true);
    setPolicyErr('');
    try {
      const r = await (window.triforge as any).workspacePolicy.getMatrix();
      setPolicyMatrix(r.matrix ?? []);
    } catch (e: any) {
      setPolicyErr(e.message ?? 'Failed to load policy matrix');
    } finally {
      setPolicyLoading(false);
    }
  }, []);
  useEffect(() => { if (dispatchTab === 'matrix') loadPolicyMatrix(); }, [dispatchTab, loadPolicyMatrix]);

  const loadAutomationData = useCallback(async () => {
    setAutomationPolicyErr('');
    try {
      const [pol, dels] = await Promise.all([
        (window.triforge as any).workspaceAutomation.getPolicy(),
        (window.triforge as any).workspaceAutomation.getDelegatedOperators(),
      ]);
      setAutomationPolicy(pol);
      setDelegatedOperators(dels.operators ?? []);
      // Load per-recipe policies for all workspace-scoped recipes
      const scopes = await (window.triforge as any).workspaceIntegration.getRecipeScope
        ? {}
        : {};
      // Load all builtin recipe IDs
      const recipeIds = ['builtin-pr-review-to-slack','builtin-jira-digest-daily','builtin-linear-digest-daily','builtin-morning-brief','builtin-approval-alert'];
      const pols: Record<string, Record<string, any>> = {};
      await Promise.all(recipeIds.map(async rid => {
        const r = await (window.triforge as any).workspaceAutomation.getRecipePolicy(rid);
        if (r.policy) pols[rid] = r.policy;
      }));
      setRecipePolicies(pols);
    } catch (e: any) {
      setAutomationPolicyErr(e.message ?? 'Failed to load automation policy');
    }
  }, []);
  useEffect(() => { if (dispatchTab === 'automation') loadAutomationData(); }, [dispatchTab, loadAutomationData]);

  const loadRunbookData = useCallback(async () => {
    setRunbookLoading(true);
    setRunbookErr('');
    try {
      const [rbs, execs, im, hq, pks, signers, policy, localKey] = await Promise.all([
        (window.triforge as any).runbook.list(),
        (window.triforge as any).runbook.listExecutions(),
        (window.triforge as any).runbook.incidentMode.get(),
        (window.triforge as any).runbook.getHandoffQueue(),
        (window.triforge as any).pack.list(),
        (window.triforge as any).pack.trust.listSigners(),
        (window.triforge as any).pack.trust.getPolicy(),
        (window.triforge as any).pack.trust.getLocalKey(),
      ]);
      setRunbooks(rbs.runbooks ?? []);
      setRunbookExecutions(execs.executions ?? []);
      setIncidentMode(im);
      setHandoffQueue((hq.items ?? []).filter((h: any) => h.status === 'pending'));
      setInstalledPacks(pks.packs ?? []);
      setTrustedSigners(signers.signers ?? []);
      setPackTrustPolicy(policy.policy ?? {});
      if (localKey.ok) setLocalKeyInfo({ keyId: localKey.keyId, publicKeyPem: localKey.publicKeyPem });
    } catch (e: any) {
      setRunbookErr(e.message ?? 'Failed to load runbooks');
    } finally {
      setRunbookLoading(false);
    }
  }, []);
  useEffect(() => { if (dispatchTab === 'runbooks') loadRunbookData(); }, [dispatchTab, loadRunbookData]);

  const loadAnalytics = useCallback(async (win: '24h' | '7d' | '30d') => {
    setAnalyticsLoading(true);
    setAnalyticsErr('');
    try {
      const r = await (window.triforge as any).analytics.report(win);
      if (!r.ok) { setAnalyticsErr(r.error ?? 'Failed'); }
      else { setAnalyticsReport(r.report); }
    } catch (e: any) {
      setAnalyticsErr(e.message ?? 'Failed');
    } finally {
      setAnalyticsLoading(false);
    }
  }, []);
  useEffect(() => {
    if (dispatchTab === 'analytics') loadAnalytics(analyticsWindow);
  }, [dispatchTab, analyticsWindow, loadAnalytics]);

  const loadOrgData = useCallback(async () => {
    setOrgLoading(true);
    setOrgErr('');
    try {
      const [orgR, effR, signersR] = await Promise.all([
        (window.triforge as any).org.get(),
        (window.triforge as any).org.policy.effective(),
        (window.triforge as any).org.signers.list(),
      ]);
      setOrgConfig(orgR.org ?? null);
      setOrgPolicy(orgR.policy ?? {});
      setOrgEffective(effR.effective ?? {});
      setOrgSigners(signersR.signers ?? []);
    } catch (e: any) {
      setOrgErr(e.message ?? 'Failed to load org');
    } finally {
      setOrgLoading(false);
    }
  }, []);
  useEffect(() => { if (dispatchTab === 'org') loadOrgData(); }, [dispatchTab, loadOrgData]);

  // Subscribe to renderer events from main
  useEffect(() => {
    const unPaired = window.triforge.dispatch.onDevicePaired(() => { loadDispatch(); });
    const unConf   = window.triforge.dispatch.onConfirmationRequired(() => { loadDispatch(); setDispatchTab('confirms'); });
    return () => { unPaired(); unConf(); };
  }, [loadDispatch]);

  const handleDispatchEnable = async () => {
    setDispatchLoading(true);
    try {
      const port = parseInt(dispatchPort, 10) || 18790;
      const r = await window.triforge.dispatch.enable(port);
      if (r.ok) await loadDispatch();
    } finally { setDispatchLoading(false); }
  };

  const handleDispatchDisable = async () => {
    setDispatchLoading(true);
    try { await window.triforge.dispatch.disable(); await loadDispatch(); }
    finally { setDispatchLoading(false); }
  };

  const handleDispatchGenerateToken = async () => {
    setDispatchLoading(true);
    try {
      const r = await window.triforge.dispatch.generateToken();
      if (r.ok) { setDispatchToken(r.token ?? null); await loadDispatch(); }
    } finally { setDispatchLoading(false); }
  };

  const handleDispatchRevokeToken = async () => {
    setDispatchLoading(true);
    try {
      await window.triforge.dispatch.revokeToken();
      setDispatchToken(null);
      await loadDispatch();
    } finally { setDispatchLoading(false); }
  };

  const handleDispatchCopyToken = () => {
    if (dispatchToken) {
      navigator.clipboard.writeText(dispatchToken).then(() => {
        setDispatchCopied(true);
        setTimeout(() => setDispatchCopied(false), 2000);
      }).catch(() => {});
    }
  };

  const handleDispatchCopyUrl = () => {
    if (dispatchStatus) {
      const url = `http://localhost:${dispatchStatus.port}/`;
      navigator.clipboard.writeText(url).catch(() => {});
    }
  };

  const handleDispatchGeneratePairingCode = async () => {
    setDispatchPairingLoading(true);
    try {
      const r = await window.triforge.dispatch.generatePairingCode();
      if (r.ok && r.code) {
        setDispatchPairingCode({ code: r.code, expiresAt: r.expiresAt!, pairUrl: r.pairUrl!, qrDataUrl: r.qrDataUrl ?? null });
      }
    } finally { setDispatchPairingLoading(false); }
  };

  const handleDispatchRevokeDevice = async (id: string) => {
    await window.triforge.dispatch.revokeDevice(id);
    setDispatchDevices(prev => prev.filter(d => d.id !== id));
  };

  const handleDispatchDesktopConfirm = async (confId: string, approved: boolean) => {
    await window.triforge.dispatch.desktopConfirm(confId, approved);
    setDispatchPendingConfs(prev => prev.filter(c => c.id !== confId));
  };

  const handleDispatchSetPolicy = async (patch: { enabled?: boolean; maxRisk?: string; requireDesktopConfirm?: boolean }) => {
    await window.triforge.dispatch.setApprovePolicy(patch);
    setDispatchStatus(prev => prev ? { ...prev, policy: { ...prev.policy, ...patch } } : null);
  };

  const handleDispatchSetNetworkMode = async (mode: 'local' | 'lan' | 'remote') => {
    await window.triforge.dispatch.setNetworkMode(mode);
    setDispatchStatus(prev => prev ? { ...prev, networkMode: mode } : null);
  };

  // ── Phase 5: Skill Store handlers ─────────────────────────────────────────

  const loadInstalledSkills = useCallback(async () => {
    const r = await window.triforge.skillStore.list();
    setSsInstalledSkills(r.skills ?? []);
  }, []);

  useEffect(() => {
    loadInstalledSkills();
    window.triforge.skillStore.examples().then(r => setSsExamples(r.examples ?? [])).catch(() => {});
  }, [loadInstalledSkills]);

  const ssCurrentMarkdown = (): string => {
    if (ssImportMethod === 'paste') return ssPasteInput;
    if (ssImportMethod === 'url')   return ssFetchedMd;
    return '';
  };

  const handleSsFetch = async () => {
    if (!ssUrlInput.trim()) return;
    setSsFetching(true);
    setSsFetchedMd('');
    setSsAnalysis(null);
    try {
      const r = await window.triforge.skillStore.fetchUrl(ssUrlInput.trim());
      if (r.ok && r.markdown) {
        setSsFetchedMd(r.markdown);
      } else {
        showFeedback('ss', r.error ?? 'Fetch failed');
      }
    } finally {
      setSsFetching(false);
    }
  };

  const handleSsAnalyze = async () => {
    const md = ssCurrentMarkdown();
    if (!md.trim()) return;
    setSsAnalyzing(true);
    setSsAnalysis(null);
    try {
      const r = await window.triforge.skillTrust.analyze(md);
      if (r.result) {
        setSsAnalysis({ riskLevel: r.result.riskLevel, blocked: r.result.blocked, reviewSummary: r.result.reviewSummary, detectedPatterns: r.result.detectedPatterns, decision: r.decision });
      }
    } finally {
      setSsAnalyzing(false);
    }
  };

  const handleSsInstall = async (markdownOverride?: string, sourceOverride?: string) => {
    const md = markdownOverride ?? ssCurrentMarkdown();
    if (!md.trim()) return;
    setSsInstalling(true);
    try {
      const source = markdownOverride ? (sourceOverride ?? 'example') : ssImportMethod;
      const r = await window.triforge.skillStore.install(md, source, ssImportMethod === 'url' ? ssUrlInput : undefined);
      if (r.success) {
        await loadInstalledSkills();
        setSsTab('installed');
        setSsPasteInput('');
        setSsFetchedMd('');
        setSsUrlInput('');
        setSsAnalysis(null);
        showFeedback('ssi', 'Installed');
      } else {
        showFeedback('ssi', r.error ?? 'Install failed');
      }
    } finally {
      setSsInstalling(false);
    }
  };

  const handleSsToggleEnabled = async (id: string, enabled: boolean) => {
    if (enabled) {
      await window.triforge.skillStore.enable(id);
    } else {
      await window.triforge.skillStore.disable(id);
    }
    await loadInstalledSkills();
  };

  const handleSsUninstall = async (id: string) => {
    setSsUninstallingId(id);
    try {
      await window.triforge.skillStore.uninstall(id);
      await loadInstalledSkills();
    } finally {
      setSsUninstallingId(null);
    }
  };

  const handleSsRun = async (id: string) => {
    setSsRunningSkillId(id);
    try {
      const r = await window.triforge.skillStore.run(id, ssRunGoal || undefined);
      if (r.ok) {
        showFeedback(`ssr_${id}`, 'Task queued');
        await loadInstalledSkills();
      } else {
        showFeedback(`ssr_${id}`, r.error ?? 'Run failed');
      }
    } finally {
      setSsRunningSkillId(null);
    }
  };

  // ── Phase 4: Local Model handlers ─────────────────────────────────────────

  useEffect(() => {
    window.triforge.localProvider.getConfig().then(cfg => {
      setLmConfig(cfg);
      setLmBaseUrl(cfg.baseUrl);
      setLmModelInput(cfg.model);
    }).catch(() => {/* not critical */});
  }, []);

  const handleLmTest = async () => {
    setLmTesting(true);
    setLmTestResult(null);
    setLmAvailableModels([]);
    try {
      const [testRes, modelsRes] = await Promise.all([
        window.triforge.localProvider.test(lmBaseUrl, lmModelInput || 'llama3'),
        window.triforge.localProvider.models(lmBaseUrl),
      ]);
      setLmTestResult(testRes);
      setLmAvailableModels(modelsRes.models ?? []);
    } finally {
      setLmTesting(false);
    }
  };

  const handleLmSave = async () => {
    setLmSaving(true);
    try {
      await window.triforge.localProvider.setConfig(lmBaseUrl, lmModelInput);
      const cfg = await window.triforge.localProvider.getConfig();
      setLmConfig(cfg);
      showFeedback('lm', 'Saved');
    } finally {
      setLmSaving(false);
    }
  };

  const handleLmToggleRouting = async () => {
    if (!lmConfig) return;
    setLmTogglingRouting(true);
    try {
      if (lmConfig.enabled) {
        await window.triforge.localProvider.disableRouting();
      } else {
        await window.triforge.localProvider.enableRouting();
      }
      const cfg = await window.triforge.localProvider.getConfig();
      setLmConfig(cfg);
    } finally {
      setLmTogglingRouting(false);
    }
  };

  const handleLmToggleFallback = async () => {
    if (!lmConfig) return;
    await window.triforge.localProvider.setFallback(!lmConfig.fallback);
    const cfg = await window.triforge.localProvider.getConfig();
    setLmConfig(cfg);
  };

  const handleLmSkillAnalyze = async () => {
    if (!lmSkillMd.trim()) return;
    setLmSkillAnalyzing(true);
    setLmSkillResult(null);
    try {
      const r = await window.triforge.localProvider.skillAnalyze(lmSkillMd);
      if (r.ok) {
        setLmSkillResult({ riskLevel: r.riskLevel, findings: r.findings, summary: r.summary });
      } else {
        showFeedback('lmsk', r.error ?? 'Analysis failed');
      }
    } finally {
      setLmSkillAnalyzing(false);
    }
  };

  // ── Derived state ──────────────────────────────────────────────────────────

  const trustModeFor = (category: string): string => {
    const cfg = (trustConfig as Record<string, { level?: string }>)[category];
    return cfg?.level?.toUpperCase() ?? '—';
  };

  const approvalForTask = selectedTask?.status === 'awaiting_approval'
    ? approvals.find(a => a.taskId === selectedTask.id && a.status === 'pending')
    : null;

  const runningCount   = tasks.filter(t => t.status === 'running').length;
  const isSystemLive   = runningCount > 0;

  // Current running step in selected task
  const currentStepIdx = selectedTask?.currentStepIndex ?? 0;
  const steps          = selectedTask?.plan?.steps ?? [];
  const nextStep       = steps[currentStepIdx + 1];

  // Wallet derived
  const budgetPct = wallet
    ? Math.min(100, (wallet.totalSpentCents / Math.max(1, wallet.dailyBudgetCents)) * 100)
    : 0;
  const budgetColor = budgetPct >= 90 ? '#ef4444' : budgetPct >= 70 ? '#f59e0b' : '#10a37f';
  const remaining   = wallet ? wallet.dailyBudgetCents - wallet.totalSpentCents - wallet.totalReservedCents : 0;

  // ── Phase 31/33: Inline step-add form with branch/deadline fields ──
  function AddRunbookStepForm({ runbookId, onAdded, stepIds }: { runbookId: string; onAdded: () => void; stepIds: string[] }) {
    const [type, setType]             = React.useState('send_slack');
    const [label, setLabel]           = React.useState('');
    const [param1Key, setParam1Key]   = React.useState('');
    const [param1Val, setParam1Val]   = React.useState('');
    const [optional, setOptional]     = React.useState(false);
    // Phase 33 — branch routing
    const [onSuccess, setOnSuccess]   = React.useState('');
    const [onFailure, setOnFailure]   = React.useState('');
    const [onRejection, setOnRejection] = React.useState('');
    const [onTimeout, setOnTimeout]   = React.useState('');
    const [timeoutSecs, setTimeoutSecs] = React.useState('');
    const [escalateSecs, setEscalateSecs] = React.useState('');
    const [showAdvanced, setShowAdvanced] = React.useState(false);
    const [outputKey, setOutputKey]       = React.useState('');
    const isPausable = type === 'wait_approval' || type === 'wait_confirm' || type === 'deadline_wait';
    return (
      <div style={{ marginTop: 5, padding: '5px 6px', borderRadius: 4, border: '1px solid rgba(249,115,22,0.2)', background: 'rgba(249,115,22,0.03)' }}>
        <div style={{ fontSize: 7, fontWeight: 700, color: '#64748b', marginBottom: 4 }}>Add Step</div>
        <div style={{ display: 'flex', gap: 3, marginBottom: 4, flexWrap: 'wrap' }}>
          <select value={type} onChange={e => setType(e.target.value)} style={{ flex: 1, minWidth: 100, fontSize: 8, padding: '2px 4px', borderRadius: 3, background: '#0f172a', border: '1px solid rgba(249,115,22,0.25)', color: '#e2e8f0' }}>
            {['run_recipe','run_mission','send_slack','create_jira','create_linear','notify_push',
              'wait_approval','wait_confirm','create_task',
              'condition','deadline_wait','escalate','goto_step','retry_step'].map(t => (
              <option key={t} value={t}>{t}</option>
            ))}
          </select>
          <input type="text" value={label} onChange={e => setLabel(e.target.value)} placeholder="Label" style={{ flex: 2, minWidth: 80, background: '#0f172a', border: '1px solid rgba(249,115,22,0.25)', borderRadius: 3, color: '#e2e8f0', fontSize: 8, padding: '2px 4px' }} />
        </div>
        <div style={{ display: 'flex', gap: 3, marginBottom: 4 }}>
          <input type="text" value={param1Key} onChange={e => setParam1Key(e.target.value)} placeholder="Param key" style={{ flex: 1, background: '#0f172a', border: '1px solid rgba(249,115,22,0.2)', borderRadius: 3, color: '#e2e8f0', fontSize: 7, padding: '2px 4px' }} />
          <input type="text" value={param1Val} onChange={e => setParam1Val(e.target.value)} placeholder="Param value" style={{ flex: 2, background: '#0f172a', border: '1px solid rgba(249,115,22,0.2)', borderRadius: 3, color: '#e2e8f0', fontSize: 7, padding: '2px 4px' }} />
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: showAdvanced ? 4 : 0 }}>
          <label style={{ display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer', fontSize: 7, color: '#94a3b8' }}>
            <input type="checkbox" checked={optional} onChange={e => setOptional(e.target.checked)} />
            Optional
          </label>
          <button className="hq-btn" onClick={() => setShowAdvanced(v => !v)} style={{ fontSize: 7, padding: '1px 5px', borderRadius: 3, background: 'transparent', border: '1px solid rgba(100,116,139,0.25)', color: '#64748b', cursor: 'pointer' }}>
            {showAdvanced ? 'Hide' : 'Branches / SLA'}
          </button>
          <button
            className="hq-btn"
            disabled={!label.trim()}
            onClick={async () => {
              const params: Record<string, string> = {};
              if (param1Key.trim() && param1Val.trim()) params[param1Key.trim()] = param1Val.trim();
              const step: Record<string, any> = { type, label: label.trim(), params, optional };
              if (onSuccess.trim())  step.onSuccess   = onSuccess.trim();
              if (onFailure.trim())  step.onFailure   = onFailure.trim();
              if (onRejection.trim()) step.onRejection = onRejection.trim();
              if (onTimeout.trim())  step.onTimeout   = onTimeout.trim();
              if (timeoutSecs.trim() && !isNaN(parseInt(timeoutSecs)))  step.timeoutSecs       = parseInt(timeoutSecs);
              if (escalateSecs.trim() && !isNaN(parseInt(escalateSecs))) step.escalateAfterSecs = parseInt(escalateSecs);
              if (outputKey.trim())  step.outputKey   = outputKey.trim();
              await (window.triforge as any).runbook.addStep(runbookId, step);
              setLabel(''); setParam1Key(''); setParam1Val(''); setOptional(false);
              setOnSuccess(''); setOnFailure(''); setOnRejection(''); setOnTimeout('');
              setTimeoutSecs(''); setEscalateSecs(''); setOutputKey(''); setShowAdvanced(false);
              onAdded();
            }}
            style={{ marginLeft: 'auto', fontSize: 7, padding: '2px 8px', borderRadius: 3, background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.25)', color: '#4ade80', cursor: !label.trim() ? 'not-allowed' : 'pointer' }}
          >Add</button>
        </div>
        {showAdvanced && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 3, padding: '5px 6px', borderRadius: 3, border: '1px solid rgba(100,116,139,0.15)', background: 'rgba(15,23,42,0.5)' }}>
            <div style={{ fontSize: 6, color: '#475569', textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700, marginBottom: 2 }}>Branch Routing (step IDs)</div>
            <div style={{ marginBottom: 4 }}>
              <div style={{ fontSize: 6, color: '#64748b', marginBottom: 1 }}>Output Key (capture result → var)</div>
              <input type="text" value={outputKey} onChange={e => setOutputKey(e.target.value)} placeholder="e.g. jira_url" style={{ width: '100%', background: '#0f172a', border: '1px solid rgba(168,85,247,0.25)', borderRadius: 3, color: '#c084fc', fontSize: 7, padding: '2px 4px' }} />
            </div>
            <div style={{ display: 'flex', gap: 3 }}>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 6, color: '#64748b', marginBottom: 1 }}>On Success</div>
                <input type="text" value={onSuccess} onChange={e => setOnSuccess(e.target.value)} placeholder="step_id" style={{ width: '100%', background: '#0f172a', border: '1px solid rgba(34,197,94,0.2)', borderRadius: 3, color: '#4ade80', fontSize: 7, padding: '2px 4px' }} />
              </div>
              <div style={{ flex: 1 }}>
                <div style={{ fontSize: 6, color: '#64748b', marginBottom: 1 }}>On Failure</div>
                <input type="text" value={onFailure} onChange={e => setOnFailure(e.target.value)} placeholder="step_id" style={{ width: '100%', background: '#0f172a', border: '1px solid rgba(239,68,68,0.2)', borderRadius: 3, color: '#f87171', fontSize: 7, padding: '2px 4px' }} />
              </div>
            </div>
            {(isPausable || type === 'condition') && (
              <div style={{ display: 'flex', gap: 3 }}>
                {isPausable && (
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 6, color: '#64748b', marginBottom: 1 }}>On Rejection</div>
                    <input type="text" value={onRejection} onChange={e => setOnRejection(e.target.value)} placeholder="step_id" style={{ width: '100%', background: '#0f172a', border: '1px solid rgba(251,191,36,0.2)', borderRadius: 3, color: '#fbbf24', fontSize: 7, padding: '2px 4px' }} />
                  </div>
                )}
                {isPausable && (
                  <div style={{ flex: 1 }}>
                    <div style={{ fontSize: 6, color: '#64748b', marginBottom: 1 }}>On Timeout</div>
                    <input type="text" value={onTimeout} onChange={e => setOnTimeout(e.target.value)} placeholder="step_id" style={{ width: '100%', background: '#0f172a', border: '1px solid rgba(249,115,22,0.2)', borderRadius: 3, color: '#f97316', fontSize: 7, padding: '2px 4px' }} />
                  </div>
                )}
              </div>
            )}
            {isPausable && (
              <div style={{ display: 'flex', gap: 3 }}>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 6, color: '#64748b', marginBottom: 1 }}>Timeout (secs)</div>
                  <input type="number" value={timeoutSecs} onChange={e => setTimeoutSecs(e.target.value)} placeholder="e.g. 900" min={0} style={{ width: '100%', background: '#0f172a', border: '1px solid rgba(249,115,22,0.2)', borderRadius: 3, color: '#e2e8f0', fontSize: 7, padding: '2px 4px' }} />
                </div>
                <div style={{ flex: 1 }}>
                  <div style={{ fontSize: 6, color: '#64748b', marginBottom: 1 }}>Escalate after (secs)</div>
                  <input type="number" value={escalateSecs} onChange={e => setEscalateSecs(e.target.value)} placeholder="e.g. 300" min={0} style={{ width: '100%', background: '#0f172a', border: '1px solid rgba(249,115,22,0.2)', borderRadius: 3, color: '#e2e8f0', fontSize: 7, padding: '2px 4px' }} />
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // ── Render ────────────────────────────────────────────────────────────────────

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden', background: 'var(--bg-base)' }}>

      {/* ══ APPROVAL URGENCY BANNER (top, above everything) ══════════════════ */}
      {approvals.length > 0 && (
        <div
          style={{
            padding: '7px 16px 5px', flexShrink: 0,
            display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap',
            animation: approvalShake
              ? 'hq-shake 0.6s ease-out, hq-urgency-bg 2s ease-in-out infinite'
              : 'hq-urgency-bg 2s ease-in-out infinite',
            borderBottom: '1px solid rgba(239,68,68,0.4)',
            animationName: approvalShake ? 'hq-shake, hq-urgency-bg' : 'hq-urgency-bg',
          }}
        >
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#ef4444', display: 'inline-block', animation: 'hq-pulse 0.9s ease-in-out infinite', flexShrink: 0 }} />
          <span style={{ fontSize: 10, fontWeight: 800, color: '#ef4444', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
            Action Required — {approvals.length} Approval{approvals.length !== 1 ? 's' : ''} Pending
          </span>
          <button
            className="hq-btn"
            style={{ marginLeft: 'auto', fontSize: 10, fontWeight: 700, padding: '3px 10px', borderRadius: 5, background: '#ef444420', border: '1px solid #ef444450', color: '#ef4444', cursor: 'pointer' }}
            onClick={() => {
              const t = tasks.find(t => t.id === approvals[0].taskId);
              if (t) setSelectedId(t.id);
              if (centerPanelRef.current) centerPanelRef.current.scrollTop = 0;
            }}
          >
            Review Now →
          </button>
          <span style={{ width: '100%', fontSize: 9, color: 'rgba(239,68,68,0.45)', letterSpacing: '0.05em', marginLeft: 13, marginTop: -2, paddingBottom: 2 }}>
            System paused — awaiting your decision
          </span>
        </div>
      )}

      {/* ══ HEADER ═══════════════════════════════════════════════════════════ */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 10, padding: '7px 14px',
        borderBottom: '1px solid var(--border)', flexShrink: 0,
        background: 'var(--bg-surface)',
      }}>
        {/* LIVE indicator */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{
            width: 7, height: 7, borderRadius: '50%', flexShrink: 0, display: 'inline-block',
            background: isSystemLive ? '#10a37f' : 'rgba(255,255,255,0.18)',
            animation: isSystemLive ? 'hq-heartbeat 2.4s ease-in-out infinite' : 'hq-idle-pulse 3.5s ease-in-out infinite',
            transition: 'background 0.6s',
          }} />
          <span style={{
            fontSize: 10, fontWeight: 800, letterSpacing: '0.12em',
            color: isSystemLive ? '#10a37f' : 'rgba(255,255,255,0.25)',
            textTransform: 'uppercase', transition: 'color 0.4s',
          }}>
            {isSystemLive ? `LIVE — ${runningCount} Agent${runningCount !== 1 ? 's' : ''} Running` : 'Idle — Waiting for Tasks'}
          </span>
        </div>

        <div style={{ width: 1, height: 14, background: 'var(--border)', flexShrink: 0 }} />

        <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: 'var(--accent)' }}>
          Agent HQ
        </span>

        {health.paperTradingOnly && (
          <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.25)', color: '#f59e0b', letterSpacing: '0.07em' }}>
            PAPER
          </span>
        )}

        {/* Hustle Mode toggle */}
        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
          <button
            className={`hq-btn${hustleMode ? ' hq-hustle-gradient' : ''}`}
            onClick={() => setHustleMode(m => !m)}
            style={{
              display: 'flex', alignItems: 'center', gap: 5,
              padding: '4px 10px', borderRadius: 20, fontSize: 10, fontWeight: 700,
              cursor: 'pointer', letterSpacing: '0.06em',
              background: hustleMode ? undefined : 'rgba(255,255,255,0.05)',
              border: hustleMode ? '1px solid rgba(99,102,241,0.45)' : '1px solid var(--border)',
              color: hustleMode ? '#a5b4fc' : 'var(--text-muted)',
              transition: 'all 0.25s',
            }}
          >
            <span style={{ fontSize: 11 }}>⚡</span>
            {hustleMode ? 'Hustle: ON' : 'Hustle Mode Disabled'}
          </button>
        </div>
      </div>

      {/* ══ "WHILE YOU WERE AWAY" BANNER ════════════════════════════════════ */}
      {awayBanner && (
        <div style={{
          padding: '8px 16px', flexShrink: 0, animation: 'hq-slide-in 0.35s ease-out',
          background: 'linear-gradient(90deg, rgba(99,102,241,0.08), rgba(16,185,129,0.08))',
          borderBottom: '1px solid rgba(99,102,241,0.18)',
          display: 'flex', alignItems: 'center', gap: 14,
        }}>
          <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.1em', color: 'rgba(255,255,255,0.4)', textTransform: 'uppercase', flexShrink: 0 }}>
            While you were away
          </span>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            {awayBanner.completed > 0 && (
              <span style={{ fontSize: 11, color: '#10b981' }}>✓ {awayBanner.completed} task{awayBanner.completed !== 1 ? 's' : ''} completed</span>
            )}
            {awayBanner.pending > 0 && (
              <span style={{ fontSize: 11, color: '#ef4444' }}>⚠ {awayBanner.pending} approval{awayBanner.pending !== 1 ? 's' : ''} pending</span>
            )}
            {awayBanner.actions > 0 && (
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>⊞ {awayBanner.actions} actions executed</span>
            )}
          </div>
          <button
            className="hq-btn"
            style={{ marginLeft: 'auto', fontSize: 11, background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '2px 4px' }}
            onClick={() => setAwayBanner(null)}
          >✕</button>
        </div>
      )}

      {/* ══ BODY — 3 COLUMNS ════════════════════════════════════════════════ */}
      <div style={{ flex: 1, display: 'flex', overflow: 'hidden', minHeight: 0 }}>

        {/* ── LEFT — Task Queue ─────────────────────────────────────────────── */}
        <div style={{ width: 242, borderRight: '1px solid var(--border)', flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>

          {/* Create Task form */}
          <div style={{ padding: '10px 10px 8px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
            <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.1em', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 6 }}>
              New Task
            </div>
            <textarea
              style={{
                width: '100%', boxSizing: 'border-box', resize: 'none', height: 52,
                background: 'var(--bg-input)', border: '1px solid var(--border)',
                color: 'var(--text-primary)', borderRadius: 6, fontSize: 12, padding: '6px 8px',
                fontFamily: 'inherit', lineHeight: 1.4,
              }}
              placeholder="What do you want Triforge to do?"
              value={newGoal}
              onChange={e => setNewGoal(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) handleCreateTask(); }}
            />
            <div style={{ display: 'flex', gap: 6, marginTop: 5 }}>
              <select
                style={{ flex: 1, background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-secondary)', borderRadius: 6, fontSize: 11, padding: '4px 6px' }}
                value={newCategory}
                onChange={e => setNewCategory(e.target.value)}
              >
                {CATEGORY_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
              </select>
              <div style={{ position: 'relative' }}>
                <button
                  className="hq-btn"
                  style={{
                    padding: '4px 10px', borderRadius: 6, fontSize: 11, fontWeight: 700,
                    background: newGoal.trim() && !creating ? 'var(--accent)' : 'rgba(255,255,255,0.07)',
                    color: newGoal.trim() && !creating ? '#fff' : 'var(--text-muted)',
                    border: 'none', cursor: newGoal.trim() && !creating ? 'pointer' : 'not-allowed',
                  }}
                  onClick={handleCreateTask}
                  disabled={!newGoal.trim() || creating}
                >
                  {creating ? '…' : '+ Create'}
                </button>
                {feedback['create'] && <FeedbackBubble msg={feedback['create']} color="#10b981" />}
              </div>
            </div>
          </div>

          {/* Campaign Selector */}
          <div style={{ padding: '6px 10px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
              <div style={{ width: 3, height: 10, borderRadius: 2, background: '#a855f7', flexShrink: 0 }} />
              <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.1em', color: 'var(--text-muted)', textTransform: 'uppercase', flex: 1 }}>Campaign</span>
              <button
                className="hq-btn"
                style={{ fontSize: 8, padding: '1px 5px', borderRadius: 3, background: 'rgba(168,85,247,0.1)', border: '1px solid rgba(168,85,247,0.25)', color: '#c084fc', cursor: 'pointer' }}
                onClick={() => setShowNewCampaign(v => !v)}
                title="Create new campaign"
              >+ New</button>
            </div>

            {showNewCampaign && (
              <div style={{ marginBottom: 5, animation: 'hq-fade-in 0.2s ease-out' }}>
                <input
                  style={{ width: '100%', boxSizing: 'border-box', background: 'var(--bg-input)', border: '1px solid rgba(168,85,247,0.3)', color: 'var(--text-primary)', borderRadius: 5, fontSize: 11, padding: '3px 7px', marginBottom: 3 }}
                  placeholder="Campaign name…"
                  value={newCampaignName}
                  onChange={e => setNewCampaignName(e.target.value)}
                  onKeyDown={e => { if (e.key === 'Enter') handleCreateCampaign(); if (e.key === 'Escape') setShowNewCampaign(false); }}
                  autoFocus
                />
                <div style={{ display: 'flex', gap: 4 }}>
                  <select
                    style={{ flex: 1, background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-secondary)', borderRadius: 4, fontSize: 10, padding: '2px 4px' }}
                    value={newCampaignType}
                    onChange={e => setNewCampaignType(e.target.value)}
                  >
                    <option value="outreach">Outreach</option>
                    <option value="content">Content</option>
                    <option value="research">Research</option>
                    <option value="sales">Sales</option>
                  </select>
                  <button
                    className="hq-btn"
                    style={{ fontSize: 10, fontWeight: 700, padding: '2px 8px', borderRadius: 4, background: newCampaignName.trim() ? 'rgba(168,85,247,0.2)' : 'transparent', border: `1px solid ${newCampaignName.trim() ? 'rgba(168,85,247,0.45)' : 'var(--border)'}`, color: newCampaignName.trim() ? '#c084fc' : 'var(--text-muted)', cursor: newCampaignName.trim() ? 'pointer' : 'not-allowed' }}
                    onClick={handleCreateCampaign}
                    disabled={!newCampaignName.trim()}
                  >Create</button>
                  {feedback['campaign-create'] && <FeedbackBubble msg={feedback['campaign-create']} color="#a855f7" />}
                </div>
              </div>
            )}

            <div style={{ display: 'flex', gap: 4 }}>
              <select
                style={{ flex: 1, background: 'var(--bg-input)', border: '1px solid var(--border)', color: activeCampaignId ? '#c084fc' : 'var(--text-muted)', borderRadius: 5, fontSize: 10, padding: '3px 5px' }}
                value={activeCampaignId ?? ''}
                onChange={e => setActiveCampaignId(e.target.value || null)}
              >
                <option value="">All tasks (no campaign)</option>
                {campaigns.map(c => (
                  <option key={c.id} value={c.id}>{c.name}</option>
                ))}
              </select>
              {activeCampaignId && selectedTask && !campaigns.find(c => c.id === activeCampaignId)?.taskIds.includes(selectedTask.id) && (
                <div style={{ position: 'relative' }}>
                  <button
                    className="hq-btn"
                    style={{ fontSize: 9, padding: '3px 6px', borderRadius: 4, background: 'rgba(168,85,247,0.1)', border: '1px solid rgba(168,85,247,0.25)', color: '#c084fc', cursor: 'pointer', whiteSpace: 'nowrap' }}
                    onClick={() => handleLinkTask(selectedTask.id)}
                    title="Link selected task to this campaign"
                  >Link</button>
                  {feedback[`link-${selectedTask.id}`] && <FeedbackBubble msg={feedback[`link-${selectedTask.id}`]} color="#a855f7" />}
                </div>
              )}
            </div>

            {activeCampaignId && (
              <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.2)', marginTop: 3, paddingLeft: 2 }}>
                {campaigns.find(c => c.id === activeCampaignId)?.taskIds.length ?? 0} tasks linked
              </div>
            )}
          </div>

          {/* Task List */}
          <div className="hq-scroll" style={{ flex: 1, overflowY: 'auto', padding: '6px 8px' }}>
            {tasks.length === 0 && (
              <div style={{ textAlign: 'center', padding: '24px 12px', color: 'var(--text-muted)', fontSize: 12, lineHeight: 1.6 }}>
                No tasks yet.<br />Create one above.
              </div>
            )}
            {tasks.map(task => {
              const meta = STATUS_META[task.status] ?? { color: '#888', label: task.status };
              const isSelected  = task.id === selectedId;
              const isRunning   = task.status === 'running';
              const needsApproval = task.status === 'awaiting_approval';
              const isDone      = task.status === 'completed';
              const hasApproval = approvals.some(a => a.taskId === task.id && a.status === 'pending');

              return (
                <div
                  key={task.id}
                  className={`hq-task-row${isSelected ? ' selected' : ''}${isRunning ? ' running' : ''}${needsApproval ? ' needs-approval' : ''}`}
                  onClick={() => setSelectedId(task.id)}
                  style={{
                    padding: '7px 8px', borderRadius: 7, marginBottom: 4,
                    border: `1px solid ${isSelected ? 'rgba(99,102,241,0.38)' : needsApproval ? 'rgba(239,68,68,0.35)' : 'var(--border)'}`,
                    background: isSelected ? 'rgba(99,102,241,0.08)' : 'var(--bg-elevated)',
                    opacity: isDone ? 0.62 : 1,
                    transition: 'opacity 0.3s',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 3 }}>
                    <span style={{
                      display: 'inline-block', width: 6, height: 6, borderRadius: '50%',
                      background: meta.color, flexShrink: 0,
                      animation: meta.dot ? 'hq-pulse 1.3s ease-in-out infinite' : 'none',
                      boxShadow: meta.glow ? `0 0 5px ${meta.color}` : 'none',
                    }} />
                    <span style={{ fontSize: 9, fontWeight: 700, color: meta.color, textTransform: 'uppercase', letterSpacing: '0.07em' }}>
                      {isDone ? '✓ Done' : meta.label}
                      {hasApproval && !isDone ? ' ⚠' : ''}
                    </span>
                    <span style={{ marginLeft: 'auto', fontSize: 9, color: 'var(--text-muted)' }}>{task.category}</span>
                  </div>
                  <div style={{
                    fontSize: 11, lineHeight: 1.4, wordBreak: 'break-word', marginBottom: 4,
                    color: isDone ? 'var(--text-muted)' : 'var(--text-primary)',
                    fontStyle: task.status === 'paused' ? 'italic' : 'normal',
                  }}>
                    {task.goal.slice(0, 72)}{task.goal.length > 72 ? '…' : ''}
                  </div>
                  <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                    {(task.status === 'queued' || task.status === 'paused') && (
                      <div style={{ position: 'relative' }}>
                        <TaskActionBtn label="▶ Run" color="#10a37f" onClick={e => { e.stopPropagation(); handleRunTask(task.id); }} />
                        {feedback[`run-${task.id}`] && <FeedbackBubble msg={feedback[`run-${task.id}`]} color="#10a37f" />}
                      </div>
                    )}
                    {task.status === 'running' && (
                      <TaskActionBtn label="⏸ Pause" color="#f59e0b" onClick={e => { e.stopPropagation(); handlePauseTask(task.id); }} />
                    )}
                    {!['completed', 'failed', 'cancelled'].includes(task.status) && (
                      <TaskActionBtn label="✕" color="#ef4444" onClick={e => { e.stopPropagation(); handleCancelTask(task.id); }} />
                    )}
                    <span style={{ marginLeft: 'auto', fontSize: 9, color: 'var(--text-muted)' }}>
                      {formatAge(task.updatedAt)}
                    </span>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ── CENTER — Task Detail ──────────────────────────────────────────── */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
          {!selectedTask ? (
            <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 10 }}>
              <div style={{ fontSize: 28, opacity: 0.07, animation: 'hq-idle-pulse 3s ease-in-out infinite' }}>⚡</div>

              {/* Idle intelligence or activity stream */}
              {tasks.length === 0 ? (
                <div style={{ textAlign: 'center' }}>
                  <div
                    key={idleMsgIdx}
                    style={{
                      fontSize: 12, color: 'var(--text-muted)',
                      animation: idleVisible ? 'hq-msg-in 0.4s ease-out' : 'none',
                      opacity: idleVisible ? 1 : 0, transition: 'opacity 0.4s',
                      marginBottom: 4,
                    }}
                  >
                    {IDLE_MESSAGES[idleMsgIdx]}
                  </div>
                  <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.1)' }}>Create a task on the left to begin</div>
                </div>
              ) : (
                <div style={{ textAlign: 'center', maxWidth: 220 }}>
                  <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>Select a task to inspect</div>
                  {/* Background activity stream */}
                  <div
                    key={activityMsgIdx}
                    style={{
                      fontSize: 10, color: 'rgba(255,255,255,0.18)', fontStyle: 'italic',
                      animation: activityVisible ? 'hq-msg-in 0.45s ease-out' : 'none',
                      opacity: activityVisible ? 1 : 0, transition: 'opacity 0.4s',
                      letterSpacing: '0.02em',
                    }}
                  >
                    {SYSTEM_MESSAGES[activityMsgIdx]}
                  </div>
                </div>
              )}

              {/* Hustle mode presence gradient */}
              {hustleMode && (
                <div style={{
                  position: 'absolute', inset: 0, pointerEvents: 'none', borderRadius: 0,
                  background: 'radial-gradient(ellipse at 50% 60%, rgba(99,102,241,0.04) 0%, transparent 70%)',
                  animation: 'hq-gradient-shift 6s ease-in-out infinite',
                }} />
              )}
            </div>
          ) : (
            <div
              ref={centerPanelRef}
              className="hq-scroll"
              style={{ flex: 1, overflowY: 'auto', padding: '14px 16px', display: 'flex', flexDirection: 'column', gap: 12 }}
            >
              {/* Task header */}
              <div style={{ flexShrink: 0 }}>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.4, marginBottom: 7 }}>
                  {selectedTask.goal}
                </div>
                <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
                  {(() => {
                    const meta = STATUS_META[selectedTask.status] ?? { color: '#888', label: selectedTask.status };
                    return (
                      <span style={{
                        fontSize: 9, fontWeight: 700, padding: '2px 8px', borderRadius: 4,
                        background: `${meta.color}18`, border: `1px solid ${meta.color}44`, color: meta.color,
                        textTransform: 'uppercase', letterSpacing: '0.08em',
                        display: 'flex', alignItems: 'center', gap: 4,
                      }}>
                        {meta.dot && <span style={{ width: 5, height: 5, borderRadius: '50%', background: meta.color, display: 'inline-block', animation: 'hq-pulse 1.3s ease-in-out infinite' }} />}
                        {meta.label}
                      </span>
                    );
                  })()}
                  <span style={{ fontSize: 9, color: 'var(--text-muted)', padding: '2px 6px', border: '1px solid var(--border)', borderRadius: 4 }}>
                    {selectedTask.category}
                  </span>
                  <span style={{ fontSize: 9, color: 'var(--text-muted)', padding: '2px 6px', border: '1px solid var(--border)', borderRadius: 4 }}>
                    Mode: {trustModeFor(selectedTask.category)}
                  </span>
                  <span style={{ fontSize: 9, color: 'var(--text-muted)', marginLeft: 'auto' }}>
                    {formatAge(selectedTask.updatedAt)}
                  </span>
                </div>

                {/* Task actions */}
                <div style={{ display: 'flex', gap: 7, flexWrap: 'wrap' }}>
                  {(selectedTask.status === 'queued' || selectedTask.status === 'paused') && (
                    <div style={{ position: 'relative' }}>
                      <PrimaryBtn label="▶ Run Task" color="#10a37f" onClick={() => handleRunTask(selectedTask.id)} />
                      {feedback[`run-${selectedTask.id}`] && <FeedbackBubble msg={feedback[`run-${selectedTask.id}`]} color="#10a37f" />}
                    </div>
                  )}
                  {selectedTask.status === 'running' && (
                    <PrimaryBtn label="⏸ Pause" color="#f59e0b" onClick={() => handlePauseTask(selectedTask.id)} />
                  )}
                  {!['completed', 'failed', 'cancelled'].includes(selectedTask.status) && (
                    <PrimaryBtn label="✕ Cancel" color="#ef4444" onClick={() => handleCancelTask(selectedTask.id)} />
                  )}
                </div>
              </div>

              {/* ── APPROVAL BANNER (center panel) ── */}
              {approvalForTask && (
                <div style={{
                  padding: '12px 14px', borderRadius: 8, flexShrink: 0,
                  animation: 'hq-urgency-bg 2s ease-in-out infinite, hq-urgency-border 2s ease-in-out infinite, hq-fade-in 0.25s ease-out',
                  border: '1px solid rgba(239,68,68,0.45)',
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                    <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#ef4444', display: 'inline-block', animation: 'hq-pulse 0.9s ease-in-out infinite' }} />
                    <span style={{ fontSize: 10, fontWeight: 800, color: '#ef4444', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                      Approval Required
                    </span>
                    <span style={{ marginLeft: 'auto', fontSize: 9, color: 'rgba(239,68,68,0.6)' }}>
                      expires {formatTime(approvalForTask.expiresAt)}
                    </span>
                  </div>
                  <div style={{ display: 'flex', gap: 16, marginBottom: 10, flexWrap: 'wrap' }}>
                    <InfoPair label="Tool"     value={approvalForTask.tool} />
                    <InfoPair label="Risk"     value={approvalForTask.riskLevel.toUpperCase()} valueColor={RISK_COLORS[approvalForTask.riskLevel]} />
                    {approvalForTask.estimatedCostCents != null && (
                      <InfoPair label="Est. Cost" value={formatCents(approvalForTask.estimatedCostCents)} />
                    )}
                  </div>
                  {approvalForTask.args && Object.keys(approvalForTask.args).length > 0 && (
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', background: 'rgba(0,0,0,0.2)', borderRadius: 5, padding: '6px 8px', marginBottom: 10, fontFamily: 'monospace', wordBreak: 'break-all', lineHeight: 1.5 }}>
                      {JSON.stringify(approvalForTask.args, null, 2).slice(0, 200)}
                    </div>
                  )}
                  <div style={{ display: 'flex', gap: 8, position: 'relative' }}>
                    <button
                      className="hq-btn"
                      style={{ flex: 1, padding: '7px 0', borderRadius: 6, fontSize: 12, fontWeight: 700, background: '#10b981', border: 'none', color: '#fff', cursor: 'pointer' }}
                      onClick={() => handleApprove(approvalForTask.id)}
                    >
                      Approve
                    </button>
                    <button
                      className="hq-btn"
                      style={{ flex: 1, padding: '7px 0', borderRadius: 6, fontSize: 12, fontWeight: 700, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.35)', color: '#ef4444', cursor: 'pointer' }}
                      onClick={() => handleDeny(approvalForTask.id)}
                    >
                      Deny
                    </button>
                    {feedback[`approval-${approvalForTask.id}`] && (
                      <FeedbackBubble msg={feedback[`approval-${approvalForTask.id}`]} color="#10b981" />
                    )}
                  </div>
                </div>
              )}

              {/* Error / Result */}
              {selectedTask.error && (
                <div style={{ padding: '8px 12px', borderRadius: 7, background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.22)', fontSize: 12, color: '#ef4444', flexShrink: 0 }}>
                  {selectedTask.error}
                </div>
              )}
              {selectedTask.result && (
                <div style={{ padding: '10px 12px', borderRadius: 7, background: 'rgba(16,185,129,0.05)', border: '1px solid rgba(16,185,129,0.2)', flexShrink: 0 }}>
                  <div style={{ fontSize: 8, fontWeight: 800, color: '#10b981', letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 5 }}>Result</div>
                  <div style={{ fontSize: 12, color: 'var(--text-primary)', lineHeight: 1.55 }}>{String(selectedTask.result).slice(0, 400)}</div>
                </div>
              )}

              {/* Planning spinner */}
              {selectedTask.status === 'planning' && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', color: '#a855f7', flexShrink: 0 }}>
                  <span style={{ fontSize: 16, animation: 'hq-spin 1.1s linear infinite', display: 'inline-block' }}>◌</span>
                  <span style={{ fontSize: 12 }}>Planning task steps…</span>
                </div>
              )}

              {/* Plan steps */}
              {steps.length > 0 && (
                <div style={{ flexShrink: 0 }}>
                  {selectedTask.plan?.planTitle && (
                    <div style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.1em', color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 6 }}>
                      {selectedTask.plan.planTitle}
                    </div>
                  )}
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                    {steps.map((step, i) => {
                      const isActive = i === currentStepIdx && step.status === 'running';
                      const isNext   = i === currentStepIdx + 1 && selectedTask.status === 'running';
                      const statusColor = STEP_STATUS_COLORS[step.status] ?? 'rgba(255,255,255,0.3)';
                      const isDoneStep  = step.status === 'completed';
                      const isSkipped   = step.status === 'skipped';

                      return (
                        <div
                          key={step.id}
                          ref={isActive ? activeStepRef : undefined}
                          style={{
                            display: 'flex', gap: 9, padding: '8px 10px', borderRadius: 7, alignItems: 'flex-start',
                            background: isActive ? 'rgba(16,163,127,0.07)' : isNext ? 'rgba(255,255,255,0.025)' : 'rgba(255,255,255,0.02)',
                            border: `1px solid ${isActive ? 'rgba(16,163,127,0.28)' : isNext ? 'rgba(255,255,255,0.09)' : 'rgba(255,255,255,0.05)'}`,
                            opacity: isDoneStep ? 0.55 : isSkipped ? 0.35 : 1,
                            transition: 'all 0.35s',
                            animation: isActive ? 'hq-step-glow 2s ease-in-out infinite' : 'none',
                            position: 'relative', overflow: 'hidden',
                          }}
                        >
                          {/* Shimmer sweep on active step */}
                          {isActive && (
                            <div style={{ position: 'absolute', top: 0, bottom: 0, width: '45%', pointerEvents: 'none',
                              background: 'linear-gradient(90deg, transparent, rgba(16,163,127,0.07), transparent)',
                              animation: 'hq-shimmer 2.8s ease-in-out infinite',
                            }} />
                          )}
                          {/* Step circle */}
                          <div style={{
                            width: 19, height: 19, borderRadius: '50%', flexShrink: 0,
                            border: `1.5px solid ${statusColor}`,
                            background: isDoneStep ? statusColor : 'transparent',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 8, fontWeight: 700,
                            color: isDoneStep ? '#fff' : statusColor,
                            marginTop: 1,
                            animation: step.status === 'running' ? 'hq-pulse 1.4s ease-in-out infinite' : 'none',
                            boxShadow: isActive ? `0 0 8px ${statusColor}55` : 'none',
                          }}>
                            {isDoneStep ? '✓' : step.status === 'failed' ? '✕' : isSkipped ? '—' : i + 1}
                          </div>

                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                              <span style={{
                                fontSize: 11, fontWeight: isActive ? 700 : 600,
                                color: isActive ? 'var(--text-primary)' : 'var(--text-secondary)',
                                flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                              }}>
                                {step.title || step.tool}
                                {/* Animated dots on running step */}
                                {isActive && (
                                  <span style={{ marginLeft: 2, color: '#10a37f' }}>
                                    <span className="hq-dot-1">.</span>
                                    <span className="hq-dot-2">.</span>
                                    <span className="hq-dot-3">.</span>
                                  </span>
                                )}
                              </span>
                              <span style={{ fontSize: 9, fontWeight: 600, color: statusColor, textTransform: 'uppercase', letterSpacing: '0.06em', flexShrink: 0 }}>
                                {step.status}
                              </span>
                            </div>

                            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: step.blockedReason || step.error ? 3 : 0 }}>
                              <span style={{ fontSize: 9, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{step.tool}</span>
                              {step.riskLevel && (
                                <span style={{ fontSize: 9, fontWeight: 600, color: RISK_COLORS[step.riskLevel] ?? '#888' }}>
                                  {step.riskLevel} risk
                                </span>
                              )}
                              {step.attempts != null && step.attempts > 0 && (
                                <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>
                                  attempt {step.attempts}/{step.maxAttempts ?? 3}
                                </span>
                              )}
                            </div>

                            {step.blockedReason && (
                              <div style={{ fontSize: 9, color: '#f59e0b', marginTop: 1 }}>{step.blockedReason}</div>
                            )}
                            {step.error && (
                              <div style={{ fontSize: 9, color: '#ef4444', marginTop: 1 }}>{step.error}</div>
                            )}
                          </div>
                        </div>
                      );
                    })}

                    {/* "Next:" micro-text */}
                    {nextStep && selectedTask.status === 'running' && (
                      <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)', paddingLeft: 28, paddingTop: 2, fontStyle: 'italic' }}>
                        Next: {nextStep.title || nextStep.tool}
                      </div>
                    )}

                    {/* Micro-transition message between steps */}
                    {transitionMsg && selectedTask.status === 'running' && (
                      <div style={{
                        fontSize: 9, color: 'rgba(16,163,127,0.55)', paddingLeft: 28, paddingTop: 3,
                        fontStyle: 'italic', animation: 'hq-msg-in 0.3s ease-out',
                        letterSpacing: '0.03em',
                      }}>
                        {transitionMsg}
                      </div>
                    )}
                  </div>
                </div>
              )}

              {/* No plan placeholder */}
              {steps.length === 0 && !['queued', 'planning'].includes(selectedTask.status) && (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: '14px 0', fontStyle: 'italic' }}>
                  No plan yet — run the task to begin.
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── RIGHT — Control Stack ─────────────────────────────────────────── */}
        <div style={{ width: 222, borderLeft: '1px solid var(--border)', flexShrink: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
          <div className="hq-scroll" style={{ flex: 1, overflowY: 'auto', padding: '8px' }}>

            {/* COMPOUND INTELLIGENCE */}
            <PanelSection
              title="Compound Intelligence"
              count={compoundStats?.highPerformers ?? 0}
              accent="#f59e0b"
            >
              {/* Stats summary */}
              {compoundStats && compoundStats.totalStrategies > 0 && (
                <div style={{ display: 'flex', gap: 5, marginBottom: 7, flexWrap: 'wrap' }}>
                  {[
                    { label: 'High',    val: compoundStats.highPerformers,   color: '#10b981' },
                    { label: 'Testing', val: compoundStats.testingStrategies, color: '#f59e0b' },
                    { label: 'Total',   val: compoundStats.totalStrategies,  color: '#6366f1' },
                    { label: 'Avg',     val: compoundStats.avgScore.toFixed(2), color: '#a855f7' },
                  ].map(m => (
                    <div key={m.label} style={{ flex: '1 1 40%', padding: '3px 5px', borderRadius: 4, background: `${m.color}08`, border: `1px solid ${m.color}20`, textAlign: 'center' }}>
                      <div style={{ fontSize: 12, fontWeight: 800, color: m.color }}>{m.val}</div>
                      <div style={{ fontSize: 7, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{m.label}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* Top strategies */}
              {strategies.length === 0 && (
                <div style={{ fontSize: 10, color: 'var(--text-muted)', textAlign: 'center', padding: '6px 0', fontStyle: 'italic' }}>
                  No strategies yet — run a growth loop
                </div>
              )}
              {strategies.slice(0, 4).map(s => {
                const statusColor = STRATEGY_STATUS_COLOR[s.status] ?? '#888';
                const scoreWidth  = Math.round(s.score * 100);
                const rr          = s.performance.replyRate;
                const typeColor   = s.type === 'outreach' ? '#6366f1' : '#a855f7';
                return (
                  <div key={s.id} style={{ padding: '6px 7px', borderRadius: 5, background: 'rgba(255,255,255,0.02)', border: `1px solid rgba(255,255,255,0.07)`, marginBottom: 5 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 3 }}>
                      <span style={{ fontSize: 8, fontWeight: 700, padding: '1px 5px', borderRadius: 3, background: `${typeColor}18`, border: `1px solid ${typeColor}33`, color: typeColor, flexShrink: 0 }}>{s.type}</span>
                      <span style={{ fontSize: 9, color: 'var(--text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.description.replace(/^Subject: /, '').replace(/^content: /, '')}</span>
                    </div>
                    {/* Score bar */}
                    <div style={{ height: 3, background: 'rgba(255,255,255,0.08)', borderRadius: 2, marginBottom: 3, overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${scoreWidth}%`, background: s.status === 'active' ? '#10b981' : s.status === 'testing' ? '#f59e0b' : '#6b7280', borderRadius: 2, transition: 'width 0.4s ease' }} />
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      {rr != null && (
                        <span style={{ fontSize: 8, color: 'var(--text-muted)' }}>Reply: {Math.round(rr * 100)}%</span>
                      )}
                      <span style={{ marginLeft: 'auto', fontSize: 8, fontWeight: 700, padding: '1px 5px', borderRadius: 3, background: `${statusColor}15`, border: `1px solid ${statusColor}30`, color: statusColor, textTransform: 'uppercase' }}>
                        {s.status === 'active' ? 'Scaling' : s.status === 'testing' ? 'Testing' : 'Deprecated'}
                      </span>
                    </div>
                  </div>
                );
              })}

              {/* Run optimization button */}
              <div style={{ position: 'relative', marginTop: 4 }}>
                <button
                  className="hq-btn"
                  style={{ width: '100%', fontSize: 9, fontWeight: 700, padding: '3px 0', borderRadius: 4, background: runningOptimization ? 'transparent' : 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.3)', color: '#f59e0b', cursor: runningOptimization ? 'not-allowed' : 'pointer' }}
                  onClick={handleRunOptimization}
                  disabled={runningOptimization}
                >{runningOptimization ? 'Optimizing…' : 'Run Optimization'}</button>
              </div>
            </PanelSection>

            {/* GROWTH LOOPS */}
            <PanelSection
              title="Growth Loops"
              count={loops.filter(l => l.status === 'active').length}
              accent="#10a37f"
            >
              {/* Global summary */}
              {globalGrowthMetrics && (globalGrowthMetrics.totalLeads > 0 || globalGrowthMetrics.activeLoops > 0) && (
                <div style={{ display: 'flex', gap: 5, marginBottom: 7, flexWrap: 'wrap' }}>
                  {[
                    { label: 'Active', val: globalGrowthMetrics.activeLoops,       color: '#10b981' },
                    { label: 'Leads',  val: globalGrowthMetrics.totalLeads,         color: '#a855f7' },
                    { label: 'Sent',   val: globalGrowthMetrics.totalEmailsSent,    color: '#6366f1' },
                    { label: 'Conv.',  val: globalGrowthMetrics.totalConverted,     color: '#10b981' },
                  ].map(m => (
                    <div key={m.label} style={{ flex: '1 1 40%', padding: '3px 5px', borderRadius: 4, background: `${m.color}08`, border: `1px solid ${m.color}20`, textAlign: 'center' }}>
                      <div style={{ fontSize: 13, fontWeight: 800, color: m.color }}>{m.val}</div>
                      <div style={{ fontSize: 7, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>{m.label}</div>
                    </div>
                  ))}
                </div>
              )}

              {/* Create loop toggle */}
              <button
                className="hq-btn"
                style={{ width: '100%', fontSize: 9, fontWeight: 700, padding: '3px 0', borderRadius: 4, background: showGrowthForm ? 'rgba(16,163,127,0.12)' : 'rgba(255,255,255,0.04)', border: '1px solid rgba(16,163,127,0.25)', color: '#34d399', cursor: 'pointer', marginBottom: showGrowthForm ? 7 : 0 }}
                onClick={() => setShowGrowthForm(v => !v)}
              >{showGrowthForm ? '▲ Cancel' : '+ New Growth Loop'}</button>

              {showGrowthForm && (
                <div style={{ animation: 'hq-fade-in 0.2s ease-out', marginBottom: 7 }}>
                  <textarea
                    style={{ width: '100%', boxSizing: 'border-box', resize: 'none', height: 46, background: 'var(--bg-input)', border: '1px solid rgba(16,163,127,0.3)', color: 'var(--text-primary)', borderRadius: 5, fontSize: 11, padding: '5px 7px', fontFamily: 'inherit', lineHeight: 1.4, marginBottom: 4 }}
                    placeholder='Goal: "Get beta users for my app"'
                    value={growthGoal}
                    onChange={e => setGrowthGoal(e.target.value)}
                  />
                  <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                    <select style={{ flex: 1, background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-secondary)', borderRadius: 4, fontSize: 10, padding: '3px 4px' }} value={growthType} onChange={e => setGrowthType(e.target.value as GrowthLoop['type'])}>
                      <option value="outreach">Outreach</option>
                      <option value="content">Content</option>
                      <option value="hybrid">Hybrid</option>
                    </select>
                    {(growthType === 'outreach' || growthType === 'hybrid') && (
                      <input style={{ width: 44, background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-secondary)', borderRadius: 4, fontSize: 10, padding: '3px 5px' }} type="number" min={1} max={50} placeholder="Limit" title="Daily email limit" value={growthEmailLimit} onChange={e => setGrowthEmailLimit(e.target.value)} />
                    )}
                    {(growthType === 'content' || growthType === 'hybrid') && (
                      <input style={{ width: 36, background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-secondary)', borderRadius: 4, fontSize: 10, padding: '3px 5px' }} type="number" min={1} max={5} placeholder="Posts" title="Daily post limit" value={growthPostLimit} onChange={e => setGrowthPostLimit(e.target.value)} />
                    )}
                  </div>
                  <input
                    style={{ width: '100%', boxSizing: 'border-box', background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-secondary)', borderRadius: 4, fontSize: 10, padding: '3px 6px', marginBottom: 4 }}
                    placeholder="Target audience (e.g. B2B founders)"
                    value={growthAudience}
                    onChange={e => setGrowthAudience(e.target.value)}
                  />
                  {(growthType === 'content' || growthType === 'hybrid') && (
                    <input
                      style={{ width: '100%', boxSizing: 'border-box', background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-secondary)', borderRadius: 4, fontSize: 10, padding: '3px 6px', marginBottom: 4 }}
                      placeholder="Keywords (comma-separated)"
                      value={growthKeywords}
                      onChange={e => setGrowthKeywords(e.target.value)}
                    />
                  )}
                  {(growthType === 'outreach' || growthType === 'hybrid') && (
                    <textarea
                      style={{ width: '100%', boxSizing: 'border-box', resize: 'none', height: 52, background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-secondary)', borderRadius: 4, fontSize: 9, padding: '4px 6px', fontFamily: 'monospace', lineHeight: 1.4, marginBottom: 4 }}
                      placeholder={'Email targets (one per line):\nfoo@example.com,Name,Interest'}
                      value={growthEmailList}
                      onChange={e => setGrowthEmailList(e.target.value)}
                    />
                  )}
                  <div style={{ position: 'relative' }}>
                    <button
                      className="hq-btn"
                      style={{ width: '100%', fontSize: 10, fontWeight: 700, padding: '4px 0', borderRadius: 5, background: growthGoal.trim() && !creatingLoop ? 'rgba(16,163,127,0.18)' : 'transparent', border: `1px solid ${growthGoal.trim() ? 'rgba(16,163,127,0.4)' : 'var(--border)'}`, color: growthGoal.trim() ? '#34d399' : 'var(--text-muted)', cursor: growthGoal.trim() && !creatingLoop ? 'pointer' : 'not-allowed' }}
                      onClick={handleCreateLoop}
                      disabled={!growthGoal.trim() || creatingLoop}
                    >{creatingLoop ? 'Creating…' : 'Create Loop'}</button>
                    {feedback['loop-create'] && <FeedbackBubble msg={feedback['loop-create']} color="#10b981" />}
                  </div>
                </div>
              )}

              {/* Loop list */}
              {loops.length === 0 && !showGrowthForm && (
                <div style={{ fontSize: 10, color: 'var(--text-muted)', textAlign: 'center', padding: '8px 0', fontStyle: 'italic' }}>
                  No loops yet — create one to start growing
                </div>
              )}
              {loops.map(loop => {
                const isActive   = loop.status === 'active';
                const msUntil    = loop.nextRunAt ? loop.nextRunAt - now : null;
                const isRunning  = runningLoopId === loop.id;
                const typeColor  = loop.type === 'outreach' ? '#6366f1' : loop.type === 'content' ? '#a855f7' : '#10a37f';
                return (
                  <div key={loop.id} style={{ padding: '7px 8px', borderRadius: 6, background: isActive ? 'rgba(16,163,127,0.04)' : 'rgba(255,255,255,0.02)', border: `1px solid ${isActive ? 'rgba(16,163,127,0.18)' : 'rgba(255,255,255,0.07)'}`, marginBottom: 5, animation: 'hq-fade-in 0.2s ease-out' }}>
                    {/* Header */}
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 5, marginBottom: 4 }}>
                      <span style={{ fontSize: 8, fontWeight: 700, padding: '1px 5px', borderRadius: 3, background: `${typeColor}18`, border: `1px solid ${typeColor}33`, color: typeColor, flexShrink: 0 }}>{loop.type}</span>
                      {/* Phase 7: version badge */}
                      {(loop.version ?? 1) > 1 && (
                        <span style={{ fontSize: 8, fontWeight: 700, padding: '1px 4px', borderRadius: 3, background: 'rgba(245,158,11,0.1)', border: '1px solid rgba(245,158,11,0.25)', color: '#f59e0b', flexShrink: 0 }}>v{loop.version}</span>
                      )}
                      <span style={{ fontSize: 10, color: 'var(--text-primary)', lineHeight: 1.3, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical' }}>{loop.goal}</span>
                    </div>

                    {/* Status + next run + scaling indicator */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 5, fontSize: 8 }}>
                      <span style={{ width: 5, height: 5, borderRadius: '50%', background: isActive ? '#10b981' : 'rgba(255,255,255,0.18)', display: 'inline-block', boxShadow: isActive ? '0 0 4px #10b98166' : 'none' }} />
                      <span style={{ color: isActive ? '#10b981' : 'var(--text-muted)' }}>{isActive ? 'Active' : 'Paused'}</span>
                      {loop.runCount > 0 && <span style={{ color: 'rgba(255,255,255,0.2)', marginLeft: 2 }}>× {loop.runCount}</span>}
                      {/* Phase 7: scaling indicator */}
                      {loop.scalingAction === 'scale_up'   && <span style={{ color: '#10b981', fontWeight: 700 }}>↑</span>}
                      {loop.scalingAction === 'scale_down' && <span style={{ color: '#f59e0b', fontWeight: 700 }}>↓</span>}
                      {msUntil != null && msUntil > 0 && (
                        <span style={{ marginLeft: 'auto', color: 'var(--text-muted)' }}>
                          Next: {formatCountdown(msUntil)}
                        </span>
                      )}
                      {(!loop.lastRunAt) && (
                        <span style={{ marginLeft: 'auto', color: '#f59e0b' }}>Never run</span>
                      )}
                    </div>

                    {/* Improvement notes */}
                    {loop.improvementNotes && (
                      <div style={{ fontSize: 8, color: '#f59e0b', background: 'rgba(245,158,11,0.05)', border: '1px solid rgba(245,158,11,0.15)', borderRadius: 4, padding: '3px 5px', marginBottom: 5, lineHeight: 1.4 }}>
                        {loop.improvementNotes.slice(0, 120)}…
                      </div>
                    )}

                    {/* Actions */}
                    <div style={{ display: 'flex', gap: 4, position: 'relative' }}>
                      <button
                        className="hq-btn"
                        style={{ flex: 1, fontSize: 9, fontWeight: 700, padding: '2px 0', borderRadius: 4, background: isRunning ? 'rgba(16,163,127,0.1)' : 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.3)', color: '#a5b4fc', cursor: isRunning ? 'not-allowed' : 'pointer' }}
                        onClick={() => handleRunLoop(loop.id)}
                        disabled={isRunning}
                        title="Run now"
                      >{isRunning ? '…' : '▶ Run'}</button>
                      <button
                        className="hq-btn"
                        style={{ flex: 1, fontSize: 9, fontWeight: 700, padding: '2px 0', borderRadius: 4, background: isActive ? 'rgba(245,158,11,0.08)' : 'rgba(16,185,129,0.08)', border: `1px solid ${isActive ? 'rgba(245,158,11,0.3)' : 'rgba(16,185,129,0.3)'}`, color: isActive ? '#f59e0b' : '#34d399', cursor: 'pointer' }}
                        onClick={() => handleToggleLoop(loop)}
                        title={isActive ? 'Pause' : 'Resume'}
                      >{isActive ? '⏸' : '▶'}</button>
                      <div style={{ position: 'relative' }}>
                        <button
                          className="hq-btn"
                          style={{ fontSize: 9, fontWeight: 700, padding: '2px 6px', borderRadius: 4, background: 'none', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.3)', cursor: 'pointer' }}
                          onClick={() => handleDeleteLoop(loop.id)}
                          title="Delete loop"
                        >✕</button>
                        {feedback[`run-loop-${loop.id}`] && <FeedbackBubble msg={feedback[`run-loop-${loop.id}`]} color="#10b981" />}
                        {feedback[`toggle-${loop.id}`]   && <FeedbackBubble msg={feedback[`toggle-${loop.id}`]}   color="#f59e0b" />}
                      </div>
                    </div>
                  </div>
                );
              })}
            </PanelSection>

            {/* LEADS */}
            <PanelSection title="Leads" count={leads.length} accent="#a855f7">
              {/* Add lead toggle */}
              <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
                <button
                  className="hq-btn"
                  style={{ flex: 1, fontSize: 9, fontWeight: 700, padding: '3px 0', borderRadius: 4, background: 'rgba(168,85,247,0.08)', border: '1px solid rgba(168,85,247,0.22)', color: '#c084fc', cursor: 'pointer' }}
                  onClick={() => setShowLeadForm(v => !v)}
                >{showLeadForm ? 'Cancel' : '+ Add Lead'}</button>
              </div>

              {showLeadForm && (
                <div style={{ marginBottom: 7, animation: 'hq-fade-in 0.2s ease-out' }}>
                  <input
                    style={{ width: '100%', boxSizing: 'border-box', background: 'var(--bg-input)', border: '1px solid rgba(168,85,247,0.3)', color: 'var(--text-primary)', borderRadius: 4, fontSize: 11, padding: '3px 6px', marginBottom: 3 }}
                    placeholder="Email or handle"
                    value={newLeadContact}
                    onChange={e => setNewLeadContact(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleAddLead(); }}
                  />
                  <div style={{ display: 'flex', gap: 4 }}>
                    <input
                      style={{ flex: 1, background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-secondary)', borderRadius: 4, fontSize: 10, padding: '3px 5px', boxSizing: 'border-box' }}
                      placeholder="Name (optional)"
                      value={newLeadName}
                      onChange={e => setNewLeadName(e.target.value)}
                      onKeyDown={e => { if (e.key === 'Enter') handleAddLead(); }}
                    />
                    <div style={{ position: 'relative' }}>
                      <button
                        className="hq-btn"
                        style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 4, background: newLeadContact.trim() ? 'rgba(168,85,247,0.15)' : 'transparent', border: `1px solid ${newLeadContact.trim() ? 'rgba(168,85,247,0.4)' : 'var(--border)'}`, color: newLeadContact.trim() ? '#c084fc' : 'var(--text-muted)', cursor: 'pointer' }}
                        onClick={handleAddLead}
                        disabled={!newLeadContact.trim()}
                      >Add</button>
                      {feedback['lead-add'] && <FeedbackBubble msg={feedback['lead-add']} color="#a855f7" />}
                    </div>
                  </div>
                </div>
              )}

              {leads.length === 0 && (
                <div style={{ fontSize: 10, color: 'var(--text-muted)', textAlign: 'center', padding: '6px 0', fontStyle: 'italic' }}>
                  No leads yet — run an outreach loop
                </div>
              )}
              {leads.slice(0, 20).map(lead => {
                const statusColor = LEAD_STATUS_COLOR[lead.status] ?? '#888';
                return (
                  <div key={lead.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 7px', borderRadius: 5, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', marginBottom: 3 }}>
                    <span style={{ width: 6, height: 6, borderRadius: '50%', background: statusColor, flexShrink: 0, boxShadow: `0 0 4px ${statusColor}66` }} />
                    <div style={{ flex: 1, overflow: 'hidden' }}>
                      <div style={{ fontSize: 10, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {lead.name ?? lead.contact}
                      </div>
                      <div style={{ fontSize: 8, color: 'var(--text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {lead.name ? lead.contact : formatAge(lead.createdAt)}
                      </div>
                    </div>
                    <select
                      style={{ fontSize: 8, background: 'var(--bg-input)', border: `1px solid ${statusColor}33`, color: statusColor, borderRadius: 4, padding: '1px 3px', cursor: 'pointer', flexShrink: 0 }}
                      value={lead.status}
                      onChange={e => handleLeadStatus(lead.id, e.target.value)}
                    >
                      <option value="new">New</option>
                      <option value="contacted">Contacted</option>
                      <option value="replied">Replied</option>
                      <option value="converted">Converted</option>
                    </select>
                  </div>
                );
              })}
              {leads.length > 20 && (
                <div style={{ fontSize: 9, color: 'var(--text-muted)', textAlign: 'center', padding: '3px 0' }}>
                  +{leads.length - 20} more leads
                </div>
              )}
            </PanelSection>

            {/* APPROVALS */}
            <PanelSection title="Approvals" count={approvals.length} accent="#ef4444">
              {approvals.length === 0 ? (
                <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '6px 0', textAlign: 'center', fontStyle: 'italic' }}>
                  No approvals pending
                </div>
              ) : approvals.map(req => {
                const taskForReq = tasks.find(t => t.id === req.taskId);
                return (
                  <div key={req.id} style={{ padding: '8px', borderRadius: 6, background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', marginBottom: 5, animation: 'hq-fade-in 0.25s ease-out' }}>
                    <div style={{ fontSize: 10, fontWeight: 700, color: '#ef4444', marginBottom: 2 }}>{req.tool}</div>
                    {taskForReq && (
                      <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {taskForReq.goal.slice(0, 30)}…
                      </div>
                    )}
                    <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
                      <span style={{ fontSize: 9, fontWeight: 600, color: RISK_COLORS[req.riskLevel] ?? '#888', padding: '1px 5px', background: `${RISK_COLORS[req.riskLevel] ?? '#888'}18`, borderRadius: 3, border: `1px solid ${RISK_COLORS[req.riskLevel] ?? '#888'}33` }}>
                        {req.riskLevel}
                      </span>
                      {req.estimatedCostCents != null && (
                        <span style={{ fontSize: 9, color: 'var(--text-muted)' }}>{formatCents(req.estimatedCostCents)}</span>
                      )}
                    </div>
                    <div style={{ display: 'flex', gap: 4, position: 'relative' }}>
                      <button className="hq-btn" style={{ flex: 1, fontSize: 10, fontWeight: 700, padding: '3px 0', borderRadius: 5, background: '#10b981', border: 'none', color: '#fff', cursor: 'pointer' }} onClick={() => handleApprove(req.id)}>Approve</button>
                      <button className="hq-btn" style={{ flex: 1, fontSize: 10, fontWeight: 700, padding: '3px 0', borderRadius: 5, background: 'none', border: '1px solid rgba(239,68,68,0.4)', color: '#ef4444', cursor: 'pointer' }} onClick={() => handleDeny(req.id)}>Deny</button>
                      {feedback[`approval-${req.id}`] && <FeedbackBubble msg={feedback[`approval-${req.id}`]} color="#10b981" />}
                    </div>
                  </div>
                );
              })}
            </PanelSection>

            {/* SCHEDULER */}
            <PanelSection title="Scheduler" count={jobs.length} accent="#a855f7">
              {/* Add job form */}
              <div style={{ marginBottom: 8 }}>
                <input
                  style={{ width: '100%', boxSizing: 'border-box', background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 5, fontSize: 11, padding: '4px 7px', marginBottom: 5 }}
                  placeholder="Goal for scheduled task"
                  value={jobGoal}
                  onChange={e => setJobGoal(e.target.value)}
                />
                <div style={{ display: 'flex', gap: 4, marginBottom: 5 }}>
                  <select style={{ flex: 1, background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-secondary)', borderRadius: 5, fontSize: 10, padding: '3px 5px' }} value={jobCategory} onChange={e => setJobCategory(e.target.value)}>
                    {CATEGORY_OPTIONS.map(c => <option key={c} value={c}>{c}</option>)}
                  </select>
                  <select style={{ flex: 1, background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-secondary)', borderRadius: 5, fontSize: 10, padding: '3px 5px' }} value={jobSchedule} onChange={e => setJobSchedule(e.target.value)}>
                    <option value="0 9 * * *">Daily 9 AM</option>
                    <option value="0 */6 * * *">Every 6h</option>
                    <option value="0 9 * * 1">Mon 9 AM</option>
                    <option value="0 8,17 * * *">8 AM & 5 PM</option>
                    <option value="*/30 * * * *">Every 30m</option>
                  </select>
                </div>
                <div style={{ position: 'relative' }}>
                  <button
                    className="hq-btn"
                    style={{ width: '100%', fontSize: 10, fontWeight: 700, padding: '4px 0', borderRadius: 5, background: jobGoal.trim() && !addingJob ? 'rgba(168,85,247,0.18)' : 'rgba(255,255,255,0.04)', border: `1px solid ${jobGoal.trim() ? 'rgba(168,85,247,0.4)' : 'var(--border)'}`, color: jobGoal.trim() ? '#a855f7' : 'var(--text-muted)', cursor: jobGoal.trim() && !addingJob ? 'pointer' : 'not-allowed' }}
                    disabled={!jobGoal.trim() || addingJob}
                    onClick={handleAddJob}
                  >
                    {addingJob ? '…' : '+ Schedule'}
                  </button>
                  {feedback['add-job'] && <FeedbackBubble msg={feedback['add-job']} color="#a855f7" />}
                </div>
              </div>

              {/* Jobs list with countdown */}
              {jobs.length === 0 && (
                <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', fontStyle: 'italic', padding: '4px 0' }}>No scheduled jobs</div>
              )}
              {jobs.map(job => {
                const msUntil  = job.nextRun ? job.nextRun - now : null;
                const isNear   = msUntil != null && msUntil > 0 && msUntil < 5 * 60 * 1000;
                return (
                  <div key={job.id} style={{ padding: '6px 8px', borderRadius: 5, background: 'rgba(168,85,247,0.05)', border: `1px solid ${isNear ? 'rgba(168,85,247,0.4)' : 'rgba(168,85,247,0.12)'}`, marginBottom: 4, transition: 'border-color 0.4s' }}>
                    <div style={{ fontSize: 10, color: 'var(--text-primary)', marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {job.label ?? job.taskGoal.slice(0, 26)}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ fontSize: 9, color: '#a855f7', fontFamily: 'monospace' }}>{job.cronExpr ?? 'once'}</span>
                      {msUntil != null && (
                        <span style={{
                          marginLeft: 'auto', fontSize: 9,
                          color: isNear ? '#a855f7' : 'var(--text-muted)',
                          fontWeight: isNear ? 700 : 400,
                          animation: isNear ? 'hq-pulse 1s ease-in-out infinite' : 'none',
                        }}>
                          {isNear ? '▶ ' : ''}{msUntil > 0 ? formatCountdown(msUntil) : 'Running…'}
                        </span>
                      )}
                      <button className="hq-btn" style={{ background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', fontSize: 10, padding: '0 2px', flexShrink: 0, marginLeft: msUntil == null ? 'auto' : 0 }} onClick={() => handleCancelJob(job.id)} title="Remove">✕</button>
                    </div>
                  </div>
                );
              })}
            </PanelSection>

            {/* SERVICES */}
            <PanelSection title="Services" accent="#6366f1">
              {/* Status dots */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px 8px', marginBottom: 7 }}>
                {([['mail', 'Email'] as const, ['twitter', 'Twitter'] as const, ['notify', 'Notify'] as const] as const).map(([k, label]) => {
                  const on = serviceStatus[k as keyof typeof serviceStatus];
                  return (
                    <div key={k} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <span style={{ width: 5, height: 5, borderRadius: '50%', background: on ? '#10b981' : 'rgba(255,255,255,0.15)', display: 'inline-block', boxShadow: on ? '0 0 5px #10b98166' : 'none', transition: 'all 0.4s' }} />
                      <span style={{ fontSize: 9, color: on ? '#10b981' : 'var(--text-muted)', fontWeight: on ? 700 : 400 }}>{label}</span>
                    </div>
                  );
                })}
              </div>

              {/* Configure toggle */}
              <button
                className="hq-btn"
                style={{ fontSize: 9, fontWeight: 700, padding: '3px 8px', borderRadius: 4, background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.22)', color: '#a5b4fc', cursor: 'pointer', width: '100%', marginBottom: showCredForm ? 6 : 0 }}
                onClick={() => setShowCredForm(v => !v)}
              >
                {showCredForm ? '▲ Hide Config' : '▼ Configure'}
              </button>

              {showCredForm && (
                <div style={{ animation: 'hq-fade-in 0.2s ease-out' }}>
                  <select
                    style={{ width: '100%', background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-secondary)', borderRadius: 5, fontSize: 10, padding: '3px 5px', marginBottom: 4, boxSizing: 'border-box' }}
                    value={credKey}
                    onChange={e => setCredKey(e.target.value)}
                  >
                    <optgroup label="Email (SMTP)">
                      <option value="smtp_host">SMTP Host</option>
                      <option value="smtp_port">SMTP Port</option>
                      <option value="smtp_user">SMTP Username</option>
                      <option value="smtp_pass">SMTP Password</option>
                      <option value="smtp_from">From Address</option>
                      <option value="smtp_from_name">From Name</option>
                    </optgroup>
                    <optgroup label="Twitter / X">
                      <option value="twitter_api_key">API Key</option>
                      <option value="twitter_api_secret">API Secret</option>
                      <option value="twitter_access_token">Access Token</option>
                      <option value="twitter_access_secret">Access Secret</option>
                    </optgroup>
                  </select>
                  <input
                    type="password"
                    style={{ width: '100%', background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 5, fontSize: 11, padding: '4px 7px', marginBottom: 5, boxSizing: 'border-box' }}
                    placeholder="Enter value…"
                    value={credValue}
                    onChange={e => setCredValue(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') handleSaveCred(); }}
                  />
                  <div style={{ position: 'relative' }}>
                    <button
                      className="hq-btn"
                      style={{ width: '100%', fontSize: 10, fontWeight: 700, padding: '4px 0', borderRadius: 5, background: credValue.trim() && !savingCred ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.04)', border: `1px solid ${credValue.trim() ? 'rgba(99,102,241,0.45)' : 'var(--border)'}`, color: credValue.trim() ? '#a5b4fc' : 'var(--text-muted)', cursor: credValue.trim() && !savingCred ? 'pointer' : 'not-allowed' }}
                      onClick={handleSaveCred}
                      disabled={!credValue.trim() || savingCred}
                    >
                      {savingCred ? 'Saving…' : 'Save (encrypted)'}
                    </button>
                    {feedback['cred-save'] && <FeedbackBubble msg={feedback['cred-save']} color="#10b981" />}
                  </div>
                  <div style={{ fontSize: 8, color: 'rgba(255,255,255,0.18)', textAlign: 'center', marginTop: 4 }}>
                    Stored with OS-level encryption
                  </div>
                </div>
              )}
            </PanelSection>

            {/* BACKGROUND AGENT */}
            <PanelSection title="Background Agent" accent="#34d399">
              {/* Enable/disable toggle row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <button
                  className="hq-btn"
                  disabled={bgToggling}
                  onClick={handleBgToggle}
                  style={{
                    flex: 1, fontSize: 10, fontWeight: 700, padding: '4px 0', borderRadius: 5,
                    background: bgStatus?.enabled ? 'rgba(52,211,153,0.15)' : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${bgStatus?.enabled ? 'rgba(52,211,153,0.45)' : 'var(--border)'}`,
                    color: bgStatus?.enabled ? '#34d399' : 'var(--text-muted)',
                    cursor: bgToggling ? 'not-allowed' : 'pointer',
                  }}
                >
                  {bgToggling ? '…' : bgStatus?.enabled ? 'Agent ON' : 'Agent OFF'}
                </button>
                {/* Heartbeat pulse dot */}
                <span
                  title={bgStatus?.running ? 'Loop running' : 'Loop stopped'}
                  style={{
                    width: 8, height: 8, borderRadius: '50%', flexShrink: 0,
                    background: bgStatus?.running ? '#34d399' : 'rgba(255,255,255,0.15)',
                    boxShadow: bgStatus?.running ? '0 0 6px #34d39966' : 'none',
                    animation: bgStatus?.running ? 'hq-pulse 1.4s ease-in-out infinite' : 'none',
                    transition: 'all 0.4s',
                  }}
                />
              </div>
              {/* Last fired mission */}
              {bgStatus?.lastFiredMission && (
                <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 6, display: 'flex', justifyContent: 'space-between' }}>
                  <span>Last: {bgStatus.lastFiredMission.name}</span>
                  <span style={{ fontFamily: 'monospace' }}>
                    {new Date(bgStatus.lastFiredMission.firedAt).toLocaleTimeString()}
                  </span>
                </div>
              )}
              {bgStatus?.healthy === false && (
                <div style={{ fontSize: 9, color: '#fbbf24', marginBottom: 6 }}>
                  Supervisor restarted agent loop
                </div>
              )}

              {/* Webhook sub-panel */}
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 7, marginTop: 2 }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
                  <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.05em', flex: 1 }}>
                    WEBHOOK
                  </span>
                  {webhookStatus?.running && (
                    <span style={{ fontSize: 9, color: '#34d399', fontFamily: 'monospace' }}>
                      :{webhookStatus.port}
                    </span>
                  )}
                </div>
                <div style={{ display: 'flex', gap: 4 }}>
                  <button
                    className="hq-btn"
                    disabled={whToggling}
                    onClick={handleWebhookToggle}
                    style={{
                      flex: 1, fontSize: 9, fontWeight: 700, padding: '3px 0', borderRadius: 4,
                      background: webhookStatus?.enabled ? 'rgba(52,211,153,0.12)' : 'rgba(255,255,255,0.04)',
                      border: `1px solid ${webhookStatus?.enabled ? 'rgba(52,211,153,0.35)' : 'var(--border)'}`,
                      color: webhookStatus?.enabled ? '#34d399' : 'var(--text-muted)',
                      cursor: whToggling ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {whToggling ? '…' : webhookStatus?.enabled ? 'Stop' : 'Start'}
                  </button>
                  {webhookStatus?.token && (
                    <button
                      className="hq-btn"
                      onClick={() => setShowWhToken(v => !v)}
                      title={showWhToken ? 'Hide token' : 'Show token'}
                      style={{ fontSize: 9, padding: '3px 7px', borderRadius: 4, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer' }}
                    >
                      {showWhToken ? '🙈' : '🔑'}
                    </button>
                  )}
                </div>
                {showWhToken && webhookStatus?.token && (
                  <div style={{ marginTop: 5, fontSize: 8, fontFamily: 'monospace', color: '#60a5fa', wordBreak: 'break-all', background: 'rgba(96,165,250,0.06)', borderRadius: 3, padding: '3px 5px' }}>
                    {webhookStatus.token}
                  </div>
                )}
              </div>
            </PanelSection>

            {/* CONTROL PLANE */}
            <PanelSection title="Control Plane" accent="#f59e0b">
              {/* Enable/disable row */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                <button
                  onClick={handleCpToggle}
                  disabled={cpToggling}
                  style={{
                    flex: 1, fontSize: 10, fontWeight: 700, padding: '4px 0', borderRadius: 4,
                    background: cpStatus?.enabled ? 'rgba(245,158,11,0.12)' : 'rgba(255,255,255,0.04)',
                    border: `1px solid ${cpStatus?.enabled ? 'rgba(245,158,11,0.35)' : 'var(--border)'}`,
                    color: cpStatus?.enabled ? '#f59e0b' : 'var(--text-muted)',
                    cursor: cpToggling ? 'not-allowed' : 'pointer',
                  }}
                >
                  {cpToggling ? '…' : cpStatus?.enabled ? 'ENABLED' : 'DISABLED'}
                </button>
                {cpStatus?.running && (
                  <span style={{ fontSize: 9, color: '#f59e0b', fontFamily: 'monospace' }}>
                    :{cpStatus.port}
                  </span>
                )}
              </div>

              {/* Status row */}
              <div style={{ fontSize: 8, color: 'var(--text-muted)', marginBottom: 6, display: 'flex', justifyContent: 'space-between' }}>
                <span>localhost only</span>
                {cpStatus?.lastStartedAt && (
                  <span>{new Date(cpStatus.lastStartedAt).toLocaleTimeString()}</span>
                )}
              </div>

              {/* Token row */}
              <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                <button
                  className="hq-btn"
                  onClick={() => setShowCpToken(v => !v)}
                  style={{ fontSize: 8 }}
                >
                  {showCpToken ? 'Hide Token' : 'Show Token'}
                </button>
                <button
                  className="hq-btn"
                  onClick={handleCpGenerateToken}
                  style={{ fontSize: 8 }}
                >
                  Rotate
                </button>
              </div>
              {showCpToken && cpStatus?.token && (
                <div style={{ fontSize: 8, fontFamily: 'monospace', color: '#f59e0b', wordBreak: 'break-all', background: 'rgba(245,158,11,0.06)', borderRadius: 3, padding: '3px 5px', marginBottom: 4 }}>
                  {cpStatus.token}
                </div>
              )}

              {/* Endpoints hint */}
              <div style={{ fontSize: 7, color: 'var(--text-muted)', fontFamily: 'monospace', lineHeight: 1.6 }}>
                GET /health · GET /status · GET /missions<br />
                POST /task · GET /events
              </div>
            </PanelSection>

            {/* SKILL TRUST ANALYZER */}
            <PanelSection title="Skill Trust" accent="#ef4444">
              <div style={{ fontSize: 8, color: 'var(--text-muted)', marginBottom: 6 }}>
                Paste raw SKILL.md content to analyze for dangerous patterns before import.
              </div>
              <textarea
                value={skillInput}
                onChange={e => setSkillInput(e.target.value)}
                placeholder="---&#10;name: my-skill&#10;---&#10;&#10;Skill body..."
                style={{
                  width: '100%', height: 72, resize: 'vertical', fontSize: 9, fontFamily: 'monospace',
                  background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)',
                  borderRadius: 4, padding: '4px 6px', boxSizing: 'border-box', marginBottom: 4,
                }}
              />
              <button
                onClick={handleSkillAnalyze}
                disabled={skillAnalyzing || !skillInput.trim()}
                style={{
                  width: '100%', fontSize: 10, fontWeight: 700, padding: '4px 0', borderRadius: 4,
                  background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)',
                  color: skillAnalyzing ? 'var(--text-muted)' : '#ef4444',
                  cursor: skillAnalyzing || !skillInput.trim() ? 'not-allowed' : 'pointer',
                  marginBottom: 6,
                }}
              >
                {skillAnalyzing ? 'Analyzing…' : 'Analyze Skill'}
              </button>

              {skillResult && (() => {
                const riskColors: Record<string, string> = {
                  low: '#10b981', medium: '#f59e0b', high: '#f97316', critical: '#ef4444',
                };
                const rc = riskColors[skillResult.riskLevel] ?? '#ef4444';
                return (
                  <div style={{ fontSize: 8, lineHeight: 1.5 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5, padding: '3px 6px', borderRadius: 4, background: `${rc}12`, border: `1px solid ${rc}30` }}>
                      <span style={{ fontWeight: 800, color: rc, textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                        {skillResult.riskLevel}
                      </span>
                      {skillResult.blocked && (
                        <span style={{ fontWeight: 700, color: '#ef4444' }}>BLOCKED</span>
                      )}
                      {skillResult.decision?.requiresCouncilReview && (
                        <span style={{ color: '#f97316', fontWeight: 700 }}>COUNCIL REVIEW</span>
                      )}
                      {!skillResult.blocked && skillResult.decision?.requiresApproval && (
                        <span style={{ color: '#f59e0b', fontWeight: 700 }}>APPROVAL REQUIRED</span>
                      )}
                    </div>
                    <div style={{ color: 'var(--text-secondary)', marginBottom: 5 }}>
                      {skillResult.reviewSummary}
                    </div>
                    {skillResult.detectedPatterns.length > 0 && (
                      <div>
                        {skillResult.detectedPatterns.slice(0, 4).map((p, i) => (
                          <div key={i} style={{ marginBottom: 3, padding: '2px 5px', borderRadius: 3, background: 'rgba(239,68,68,0.04)', border: '1px solid rgba(239,68,68,0.12)' }}>
                            <span style={{ fontWeight: 700, color: p.severity === 'critical' ? '#ef4444' : p.severity === 'high' ? '#f97316' : '#f59e0b', textTransform: 'uppercase', fontSize: 7, letterSpacing: '0.06em' }}>
                              {p.severity}
                            </span>
                            {' — '}{p.description}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })()}
            </PanelSection>

            {/* APPROVAL POLICY EDITOR */}
            <PanelSection title="Policy" accent="#f59e0b" count={policyRules.filter(r => r.enabled).length}>
              {/* Tab bar */}
              <div style={{ display: 'flex', gap: 2, marginBottom: 8 }}>
                {(['rules', 'add', 'simulate'] as const).map(tab => (
                  <button
                    key={tab}
                    className="hq-btn"
                    onClick={() => setPolicyTab(tab)}
                    style={{
                      flex: 1, fontSize: 9, fontWeight: policyTab === tab ? 800 : 600,
                      background: policyTab === tab ? 'rgba(245,158,11,0.12)' : 'transparent',
                      border: policyTab === tab ? '1px solid rgba(245,158,11,0.35)' : '1px solid var(--border)',
                      color: policyTab === tab ? '#f59e0b' : 'var(--text-muted)',
                      padding: '3px 0',
                    }}
                  >
                    {tab === 'rules' ? 'Rules' : tab === 'add' ? '+ Add' : 'Simulate'}
                  </button>
                ))}
              </div>

              {/* RULES TAB */}
              {policyTab === 'rules' && (
                <div>
                  {policyRules.length === 0 && (
                    <div style={{ fontSize: 8, color: 'var(--text-muted)', textAlign: 'center', padding: '10px 0' }}>No rules loaded.</div>
                  )}
                  {policyRules.map(rule => (
                    <div
                      key={rule.id}
                      style={{
                        marginBottom: 4, padding: '5px 6px', borderRadius: 4,
                        background: rule.enabled ? 'rgba(245,158,11,0.04)' : 'rgba(255,255,255,0.02)',
                        border: `1px solid ${rule.enabled ? 'rgba(245,158,11,0.18)' : 'var(--border)'}`,
                        opacity: rule.enabled ? 1 : 0.55,
                      }}
                    >
                      {/* Row 1: priority + name + action badge */}
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 3 }}>
                        <span style={{ fontSize: 7, fontWeight: 800, color: 'var(--text-muted)', minWidth: 22 }}>P{rule.priority}</span>
                        <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-primary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{rule.name}</span>
                        <span style={{
                          fontSize: 7, fontWeight: 800, letterSpacing: '0.07em',
                          padding: '1px 5px', borderRadius: 10, textTransform: 'uppercase',
                          background: `${ACTION_COLORS[rule.action] ?? '#888'}18`,
                          color: ACTION_COLORS[rule.action] ?? '#888',
                          border: `1px solid ${ACTION_COLORS[rule.action] ?? '#888'}30`,
                        }}>
                          {rule.action}
                        </span>
                      </div>
                      {/* Row 2: match conditions */}
                      <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap', marginBottom: 4 }}>
                        {[
                          { label: 'src', value: rule.matchSource },
                          { label: 'risk', value: rule.matchRiskClass },
                          ...(rule.matchCategory ? [{ label: 'cat', value: rule.matchCategory }] : []),
                          ...(rule.preferLocal ? [{ label: 'local', value: '✓' }] : []),
                        ].map((tag, i) => (
                          <span key={i} style={{ fontSize: 7, fontFamily: 'monospace', padding: '1px 4px', borderRadius: 3, background: 'rgba(255,255,255,0.05)', border: '1px solid var(--border)', color: 'var(--text-secondary)' }}>
                            {tag.label}:{tag.value}
                          </span>
                        ))}
                        {rule.isDefault && (
                          <span style={{ fontSize: 7, padding: '1px 4px', borderRadius: 3, background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)', color: '#818cf8' }}>default</span>
                        )}
                      </div>
                      {/* Row 3: controls */}
                      <div style={{ display: 'flex', gap: 3 }}>
                        <button
                          className="hq-btn"
                          style={{ fontSize: 8, flex: 1, color: rule.enabled ? '#10b981' : 'var(--text-muted)' }}
                          onClick={() => handlePolicyToggle(rule.id, !rule.enabled)}
                        >
                          {rule.enabled ? 'Enabled' : 'Disabled'}
                        </button>
                        {!rule.isDefault && (
                          <button
                            className="hq-btn"
                            style={{ fontSize: 8, color: '#ef4444' }}
                            onClick={() => handlePolicyDelete(rule.id)}
                          >
                            Delete
                          </button>
                        )}
                      </div>
                    </div>
                  ))}

                  {/* Reset defaults */}
                  <div style={{ position: 'relative', marginTop: 6 }}>
                    {feedbacks['pol'] && <FeedbackBubble msg={feedbacks['pol'].msg} color={feedbacks['pol'].color} />}
                    <button
                      className="hq-btn"
                      onClick={handlePolicyReset}
                      disabled={policyResetting}
                      style={{ width: '100%', fontSize: 8, color: '#f59e0b', borderColor: 'rgba(245,158,11,0.25)' }}
                    >
                      {policyResetting ? 'Restoring…' : 'Restore Default Rules'}
                    </button>
                  </div>
                </div>
              )}

              {/* ADD RULE TAB */}
              {policyTab === 'add' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div>
                    <div style={{ fontSize: 8, color: 'var(--text-muted)', marginBottom: 2 }}>Rule name *</div>
                    <input
                      value={newRuleName}
                      onChange={e => setNewRuleName(e.target.value)}
                      placeholder="e.g. Block all Telegram writes"
                      style={{ width: '100%', fontSize: 9, padding: '3px 6px', borderRadius: 4, background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', boxSizing: 'border-box' }}
                    />
                  </div>

                  <div style={{ display: 'flex', gap: 4 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 8, color: 'var(--text-muted)', marginBottom: 2 }}>Source</div>
                      <select
                        value={newRuleSource}
                        onChange={e => setNewRuleSource(e.target.value)}
                        style={{ width: '100%', fontSize: 9, padding: '3px 4px', borderRadius: 4, background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                      >
                        {GOV_SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 8, color: 'var(--text-muted)', marginBottom: 2 }}>Risk class</div>
                      <select
                        value={newRuleRisk}
                        onChange={e => setNewRuleRisk(e.target.value)}
                        style={{ width: '100%', fontSize: 9, padding: '3px 4px', borderRadius: 4, background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                      >
                        {GOV_RISK_CLASS.map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </div>
                  </div>

                  <div style={{ display: 'flex', gap: 4 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 8, color: 'var(--text-muted)', marginBottom: 2 }}>Action</div>
                      <select
                        value={newRuleAction}
                        onChange={e => setNewRuleAction(e.target.value)}
                        style={{ width: '100%', fontSize: 9, padding: '3px 4px', borderRadius: 4, background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                      >
                        {GOV_ACTIONS.map(a => <option key={a} value={a}>{a}</option>)}
                      </select>
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 8, color: 'var(--text-muted)', marginBottom: 2 }}>Priority</div>
                      <input
                        type="number"
                        value={newRulePriority}
                        onChange={e => setNewRulePriority(e.target.value)}
                        min={1} max={999}
                        style={{ width: '100%', fontSize: 9, padding: '3px 6px', borderRadius: 4, background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', boxSizing: 'border-box' }}
                      />
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize: 8, color: 'var(--text-muted)', marginBottom: 2 }}>Category (optional)</div>
                    <input
                      value={newRuleCategory}
                      onChange={e => setNewRuleCategory(e.target.value)}
                      placeholder="e.g. research, ops"
                      style={{ width: '100%', fontSize: 9, padding: '3px 6px', borderRadius: 4, background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', boxSizing: 'border-box' }}
                    />
                  </div>

                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 9, color: 'var(--text-secondary)', cursor: 'pointer' }}>
                    <input
                      type="checkbox"
                      checked={newRulePreferLocal}
                      onChange={e => setNewRulePreferLocal(e.target.checked)}
                    />
                    Prefer local model for matched tasks
                  </label>

                  <button
                    className="hq-btn"
                    onClick={handlePolicyAdd}
                    disabled={addingRule || !newRuleName.trim()}
                    style={{
                      width: '100%', fontSize: 10, fontWeight: 700, padding: '5px 0', borderRadius: 4,
                      background: addingRule || !newRuleName.trim() ? 'transparent' : 'rgba(245,158,11,0.08)',
                      border: '1px solid rgba(245,158,11,0.3)',
                      color: addingRule || !newRuleName.trim() ? 'var(--text-muted)' : '#f59e0b',
                      cursor: addingRule || !newRuleName.trim() ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {addingRule ? 'Creating…' : 'Create Rule'}
                  </button>
                </div>
              )}

              {/* SIMULATE TAB */}
              {policyTab === 'simulate' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ fontSize: 8, color: 'var(--text-muted)' }}>
                    Test which policy rule fires for a given source + risk combination.
                  </div>

                  <div style={{ display: 'flex', gap: 4 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 8, color: 'var(--text-muted)', marginBottom: 2 }}>Source</div>
                      <select
                        value={simSource}
                        onChange={e => setSimSource(e.target.value)}
                        style={{ width: '100%', fontSize: 9, padding: '3px 4px', borderRadius: 4, background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                      >
                        {GOV_SOURCES.filter(s => s !== '*').map(s => <option key={s} value={s}>{s}</option>)}
                      </select>
                    </div>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 8, color: 'var(--text-muted)', marginBottom: 2 }}>Risk class</div>
                      <select
                        value={simRisk}
                        onChange={e => setSimRisk(e.target.value)}
                        style={{ width: '100%', fontSize: 9, padding: '3px 4px', borderRadius: 4, background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                      >
                        {GOV_RISK_CLASS.filter(r => r !== '*').map(r => <option key={r} value={r}>{r}</option>)}
                      </select>
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize: 8, color: 'var(--text-muted)', marginBottom: 2 }}>Category (optional)</div>
                    <input
                      value={simCategory}
                      onChange={e => setSimCategory(e.target.value)}
                      placeholder="e.g. research"
                      style={{ width: '100%', fontSize: 9, padding: '3px 6px', borderRadius: 4, background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', boxSizing: 'border-box' }}
                    />
                  </div>

                  <button
                    className="hq-btn"
                    onClick={handlePolicySimulate}
                    disabled={simRunning}
                    style={{
                      width: '100%', fontSize: 10, fontWeight: 700, padding: '5px 0', borderRadius: 4,
                      background: simRunning ? 'transparent' : 'rgba(245,158,11,0.08)',
                      border: '1px solid rgba(245,158,11,0.3)',
                      color: simRunning ? 'var(--text-muted)' : '#f59e0b',
                      cursor: simRunning ? 'not-allowed' : 'pointer',
                    }}
                  >
                    {simRunning ? 'Running…' : 'Run Simulation'}
                  </button>

                  {simResult && (
                    <div style={{ padding: '6px 8px', borderRadius: 4, background: `${ACTION_COLORS[simResult.action] ?? '#888'}0d`, border: `1px solid ${ACTION_COLORS[simResult.action] ?? '#888'}30` }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                        <span style={{ fontSize: 8, fontWeight: 600, color: 'var(--text-muted)' }}>RESULT</span>
                        <span style={{
                          fontSize: 8, fontWeight: 800, letterSpacing: '0.07em', textTransform: 'uppercase',
                          padding: '1px 6px', borderRadius: 10,
                          background: `${ACTION_COLORS[simResult.action] ?? '#888'}18`,
                          color: ACTION_COLORS[simResult.action] ?? '#888',
                        }}>
                          {simResult.action}
                        </span>
                        {simResult.preferLocal && (
                          <span style={{ fontSize: 7, padding: '1px 4px', borderRadius: 3, background: 'rgba(16,163,127,0.1)', border: '1px solid rgba(16,163,127,0.25)', color: '#10a37f' }}>prefer local</span>
                        )}
                        {simResult.usedFallback && (
                          <span style={{ fontSize: 7, padding: '1px 4px', borderRadius: 3, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#ef4444' }}>fallback</span>
                        )}
                      </div>
                      <div style={{ fontSize: 8, color: 'var(--text-secondary)' }}>
                        {simResult.ruleId
                          ? <><span style={{ fontWeight: 700 }}>Matched:</span> {simResult.ruleName}</>
                          : <span style={{ color: 'var(--text-muted)' }}>No rule matched — fallback applied.</span>
                        }
                      </div>
                    </div>
                  )}
                </div>
              )}
            </PanelSection>

            {/* TELEGRAM MESSAGING */}
            <PanelSection title="Telegram" accent="#229ed9">
              {/* Tab bar */}
              <div style={{ display: 'flex', gap: 2, marginBottom: 8 }}>
                {(['setup', 'messages'] as const).map(tab => (
                  <button
                    key={tab}
                    className="hq-btn"
                    onClick={() => setTgTab(tab)}
                    style={{
                      flex: 1, fontSize: 8, fontWeight: 700, padding: '3px 0', borderRadius: 4,
                      background: tgTab === tab ? 'rgba(34,158,217,0.15)' : 'rgba(255,255,255,0.03)',
                      border: `1px solid ${tgTab === tab ? 'rgba(34,158,217,0.45)' : 'var(--border)'}`,
                      color: tgTab === tab ? '#38bdf8' : 'var(--text-muted)',
                      cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.06em',
                    }}
                  >
                    {tab}
                  </button>
                ))}
              </div>

              {tgTab === 'setup' && (
                <>
                  {/* Bot status / token */}
                  {tgStatus?.botUsername ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 8, padding: '3px 6px', borderRadius: 4, background: tgStatus.running ? 'rgba(34,158,217,0.08)' : 'rgba(255,255,255,0.03)', border: `1px solid ${tgStatus.running ? 'rgba(34,158,217,0.3)' : 'var(--border)'}` }}>
                      <span style={{ fontSize: 8, color: tgStatus.running ? '#38bdf8' : 'rgba(255,255,255,0.3)', fontWeight: 800 }}>●</span>
                      <span style={{ fontSize: 9, color: 'var(--text-secondary)', flex: 1 }}>@{tgStatus.botUsername}</span>
                      {tgStatus.lastMessageAt && (
                        <span style={{ fontSize: 7, color: 'var(--text-muted)' }}>{formatAge(tgStatus.lastMessageAt)}</span>
                      )}
                    </div>
                  ) : (
                    <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
                      <input
                        type="password"
                        value={tgTokenInput}
                        onChange={e => setTgTokenInput(e.target.value)}
                        placeholder="Bot token from @BotFather"
                        style={{ flex: 1, fontSize: 8, padding: '3px 5px', borderRadius: 4, background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                        onKeyDown={e => e.key === 'Enter' && handleTgSaveToken()}
                      />
                      <button
                        className="hq-btn"
                        onClick={handleTgSaveToken}
                        disabled={tgTokenSaving || !tgTokenInput.trim()}
                        style={{ fontSize: 8, fontWeight: 700, padding: '3px 8px', borderRadius: 4, background: 'rgba(34,158,217,0.1)', border: '1px solid rgba(34,158,217,0.3)', color: '#38bdf8', cursor: tgTokenSaving ? 'not-allowed' : 'pointer' }}
                      >
                        {tgTokenSaving ? '…' : 'Save'}
                      </button>
                    </div>
                  )}

                  {/* Start/Stop toggle */}
                  {tgStatus?.botUsername && (
                    <button
                      className="hq-btn"
                      onClick={handleTgToggle}
                      disabled={tgToggling}
                      style={{
                        width: '100%', fontSize: 10, fontWeight: 700, padding: '4px 0', borderRadius: 4,
                        background: tgStatus.running ? 'rgba(34,158,217,0.12)' : 'rgba(255,255,255,0.04)',
                        border: `1px solid ${tgStatus.running ? 'rgba(34,158,217,0.4)' : 'var(--border)'}`,
                        color: tgStatus.running ? '#38bdf8' : 'var(--text-muted)',
                        cursor: tgToggling ? 'not-allowed' : 'pointer', marginBottom: 8,
                      }}
                    >
                      {tgToggling ? '…' : tgStatus.running ? 'POLLING — STOP' : 'START POLLING'}
                    </button>
                  )}

                  {/* Allowlist */}
                  <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 8, marginTop: 2 }}>
                    <div style={{ fontSize: 7, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 5 }}>Chat Allowlist</div>
                    {(tgStatus?.allowedChats ?? []).length === 0 ? (
                      <div style={{ fontSize: 7, color: 'var(--text-muted)', marginBottom: 5 }}>Empty — all chats allowed (not recommended)</div>
                    ) : (
                      (tgStatus?.allowedChats ?? []).map(id => (
                        <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 3 }}>
                          <span style={{ fontSize: 8, fontFamily: 'monospace', color: 'var(--text-secondary)', flex: 1 }}>{id}</span>
                          <button
                            className="hq-btn"
                            onClick={() => handleTgRemoveChat(id)}
                            style={{ fontSize: 7, padding: '1px 5px', borderRadius: 3, background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.18)', color: '#f87171', cursor: 'pointer' }}
                          >
                            Remove
                          </button>
                        </div>
                      ))
                    )}
                    <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                      <input
                        value={tgChatIdInput}
                        onChange={e => setTgChatIdInput(e.target.value)}
                        placeholder="Chat ID (e.g. 123456789)"
                        style={{ flex: 1, fontSize: 8, padding: '3px 5px', borderRadius: 4, background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontFamily: 'monospace' }}
                        onKeyDown={e => e.key === 'Enter' && handleTgAddChat()}
                      />
                      <button
                        className="hq-btn"
                        onClick={handleTgAddChat}
                        style={{ fontSize: 8, fontWeight: 700, padding: '3px 7px', borderRadius: 4, background: 'rgba(34,158,217,0.1)', border: '1px solid rgba(34,158,217,0.25)', color: '#38bdf8', cursor: 'pointer' }}
                      >
                        Add
                      </button>
                    </div>
                  </div>

                  {/* Test send */}
                  {tgStatus?.running && (
                    <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 8, marginTop: 8 }}>
                      <div style={{ fontSize: 7, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 5 }}>Test Send</div>
                      <input
                        value={tgTestMsg}
                        onChange={e => setTgTestMsg(e.target.value)}
                        placeholder="Message text"
                        style={{ width: '100%', fontSize: 8, padding: '3px 5px', borderRadius: 4, background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', marginBottom: 4, boxSizing: 'border-box' }}
                      />
                      <button
                        className="hq-btn"
                        onClick={handleTgSendTest}
                        disabled={tgSending || !tgTestMsg.trim() || !tgChatIdInput.trim()}
                        style={{ width: '100%', fontSize: 9, fontWeight: 700, padding: '3px 0', borderRadius: 4, background: 'rgba(34,158,217,0.08)', border: '1px solid rgba(34,158,217,0.22)', color: '#38bdf8', cursor: tgSending ? 'not-allowed' : 'pointer' }}
                      >
                        {tgSending ? 'Sending…' : 'Send to Chat ID above'}
                      </button>
                    </div>
                  )}

                  {/* Trust policy hint */}
                  <div style={{ marginTop: 8, fontSize: 7, color: 'var(--text-muted)', lineHeight: 1.6, padding: '3px 5px', background: 'rgba(34,158,217,0.04)', borderRadius: 3 }}>
                    informational → auto-reply after task<br />
                    write_action  → holds for approval<br />
                    high_risk     → blocked, no reply<br />
                    injection     → blocked immediately
                  </div>
                </>
              )}

              {tgTab === 'messages' && (
                <>
                  {tgMessages.length === 0 ? (
                    <div style={{ fontSize: 8, color: 'var(--text-muted)', textAlign: 'center', padding: '10px 0' }}>No messages yet</div>
                  ) : (
                    tgMessages.map(msg => {
                      const statusColors: Record<string, string> = {
                        received: 'rgba(255,255,255,0.3)', classified: '#a855f7', task_created: '#10a37f',
                        blocked: '#ef4444', replied: '#10b981', approval_pending: '#f59e0b',
                      };
                      const sc = statusColors[msg.status] ?? 'rgba(255,255,255,0.3)';
                      return (
                        <div key={msg.id} style={{ padding: '4px 6px', borderRadius: 4, background: msg.direction === 'inbound' ? 'rgba(34,158,217,0.04)' : 'rgba(16,185,129,0.04)', border: `1px solid ${msg.direction === 'inbound' ? 'rgba(34,158,217,0.15)' : 'rgba(16,185,129,0.15)'}`, marginBottom: 3 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                            <span style={{ fontSize: 7, color: msg.direction === 'inbound' ? '#38bdf8' : '#10b981', fontWeight: 800 }}>{msg.direction === 'inbound' ? '↓' : '↑'}</span>
                            <span style={{ fontSize: 7, color: 'rgba(255,255,255,0.3)', fontFamily: 'monospace', flex: 1 }}>{msg.chatName ?? msg.chatId}</span>
                            <span style={{ fontSize: 6, fontWeight: 700, color: sc, textTransform: 'uppercase', letterSpacing: '0.05em' }}>{msg.status.replace('_', ' ')}</span>
                            <span style={{ fontSize: 6, color: 'rgba(255,255,255,0.2)' }}>{formatAge(msg.timestamp)}</span>
                          </div>
                          <div style={{ fontSize: 8, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={msg.text}>
                            {msg.text}
                          </div>
                          {msg.riskClass && (
                            <div style={{ fontSize: 6, color: 'rgba(255,255,255,0.2)', marginTop: 1 }}>risk: {msg.riskClass}</div>
                          )}
                          {msg.blockedReason && (
                            <div style={{ fontSize: 6, color: '#ef4444', marginTop: 1 }}>{msg.blockedReason}</div>
                          )}
                        </div>
                      );
                    })
                  )}
                </>
              )}
            </PanelSection>

            {/* SLACK MESSAGING */}
            <PanelSection title="Slack" accent="#4a154b" count={slackStatus?.allowedChannels.length}>
              {/* Tab bar */}
              <div style={{ display: 'flex', gap: 2, marginBottom: 8 }}>
                {(['setup', 'channels', 'messages', 'summary'] as const).map(tab => (
                  <button
                    key={tab}
                    className="hq-btn"
                    onClick={() => setSlackTab(tab)}
                    style={{
                      flex: 1, fontSize: 8, fontWeight: slackTab === tab ? 800 : 600,
                      background: slackTab === tab ? 'rgba(74,21,75,0.18)' : 'transparent',
                      border: `1px solid ${slackTab === tab ? 'rgba(74,21,75,0.5)' : 'var(--border)'}`,
                      color: slackTab === tab ? '#a855f7' : 'var(--text-muted)',
                      padding: '3px 0',
                    }}
                  >
                    {tab === 'setup' ? 'Setup' : tab === 'channels' ? 'Channels' : tab === 'messages' ? 'Log' : 'Summary'}
                  </button>
                ))}
              </div>

              {/* SETUP TAB */}
              {slackTab === 'setup' && (
                <div>
                  {/* Status strip */}
                  {slackStatus && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8, padding: '4px 6px', borderRadius: 4, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--border)' }}>
                      <div style={{ width: 6, height: 6, borderRadius: '50%', background: slackStatus.running ? '#10b981' : '#6b7280', flexShrink: 0 }} />
                      <div style={{ flex: 1 }}>
                        {slackStatus.running
                          ? <span style={{ fontSize: 8, fontWeight: 700, color: '#10b981' }}>Online — {slackStatus.workspaceName || slackStatus.botUserName}</span>
                          : <span style={{ fontSize: 8, color: 'var(--text-muted)' }}>Offline{slackStatus.workspaceName ? ` — ${slackStatus.workspaceName}` : ''}</span>
                        }
                      </div>
                      <div style={{ position: 'relative' }}>
                        {feedbacks['sl'] && <FeedbackBubble msg={feedbacks['sl'].msg} color={feedbacks['sl'].color} />}
                        <button
                          className="hq-btn"
                          onClick={handleSlackToggle}
                          disabled={slackToggling}
                          style={{ fontSize: 9, fontWeight: 700, padding: '2px 8px', color: slackStatus.running ? '#ef4444' : '#10b981', borderColor: slackStatus.running ? 'rgba(239,68,68,0.3)' : 'rgba(16,185,129,0.3)' }}
                        >
                          {slackToggling ? '…' : slackStatus.running ? 'Stop' : 'Start'}
                        </button>
                      </div>
                    </div>
                  )}

                  {/* Token input */}
                  <div style={{ fontSize: 8, color: 'var(--text-muted)', marginBottom: 3 }}>Bot token (xoxb-…)</div>
                  <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
                    <input
                      type="password"
                      value={slackTokenInput}
                      onChange={e => setSlackTokenInput(e.target.value)}
                      placeholder="xoxb-…"
                      style={{ flex: 1, fontSize: 9, padding: '3px 6px', borderRadius: 4, background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                    />
                    <button
                      className="hq-btn"
                      onClick={handleSlackSaveToken}
                      disabled={slackTokenSaving || !slackTokenInput.trim()}
                      style={{ fontSize: 9, fontWeight: 700, color: '#a855f7', borderColor: 'rgba(168,85,247,0.3)', padding: '3px 8px' }}
                    >
                      {slackTokenSaving ? '…' : 'Save'}
                    </button>
                  </div>

                  {/* Test send */}
                  {slackStatus?.running && (
                    <div>
                      <div style={{ fontSize: 8, color: 'var(--text-muted)', marginBottom: 3 }}>Test message</div>
                      <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                        <input
                          value={slackTestChannelId}
                          onChange={e => setSlackTestChannelId(e.target.value)}
                          placeholder="Channel ID (e.g. C012AB3CD)"
                          style={{ flex: 1, fontSize: 9, padding: '3px 6px', borderRadius: 4, background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                        />
                      </div>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <input
                          value={slackTestMsg}
                          onChange={e => setSlackTestMsg(e.target.value)}
                          placeholder="Message text…"
                          style={{ flex: 1, fontSize: 9, padding: '3px 6px', borderRadius: 4, background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                        />
                        <button
                          className="hq-btn"
                          onClick={handleSlackSendTest}
                          disabled={slackSending || !slackTestMsg.trim() || !slackTestChannelId.trim()}
                          style={{ fontSize: 9, fontWeight: 700, color: '#a855f7', borderColor: 'rgba(168,85,247,0.3)' }}
                        >
                          {slackSending ? '…' : 'Send'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* CHANNELS TAB */}
              {slackTab === 'channels' && (
                <div>
                  {/* Allowed channels list */}
                  <div style={{ fontSize: 8, color: 'var(--text-muted)', marginBottom: 4 }}>Allowed channels (channel IDs)</div>
                  {(slackStatus?.allowedChannels ?? []).length === 0
                    ? <div style={{ fontSize: 8, color: 'var(--text-muted)', marginBottom: 6 }}>All channels allowed (no filter).</div>
                    : (slackStatus?.allowedChannels ?? []).map(id => (
                        <div key={id} style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 3 }}>
                          <span style={{ flex: 1, fontSize: 9, fontFamily: 'monospace', color: '#a855f7' }}>{id}</span>
                          <button className="hq-btn" style={{ fontSize: 8, color: '#ef4444' }} onClick={() => handleSlackRemoveChannel(id)}>✕</button>
                        </div>
                      ))
                  }

                  {/* Load bot channels */}
                  <button
                    className="hq-btn"
                    onClick={handleSlackLoadChannels}
                    disabled={slackChannelsLoading}
                    style={{ width: '100%', fontSize: 8, marginBottom: 6, color: '#a855f7', borderColor: 'rgba(168,85,247,0.25)' }}
                  >
                    {slackChannelsLoading ? 'Loading…' : 'Refresh Bot Channels'}
                  </button>

                  {/* Channel picker */}
                  {slackChannels.length > 0 && (
                    <div style={{ maxHeight: 140, overflowY: 'auto', marginBottom: 8 }}>
                      {slackChannels.filter(c => c.isMember).map(ch => {
                        const isAllowed = slackStatus?.allowedChannels.includes(ch.id);
                        return (
                          <div key={ch.id} style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 3, padding: '3px 5px', borderRadius: 3, background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)' }}>
                            <span style={{ flex: 1, fontSize: 9, color: isAllowed ? '#a855f7' : 'var(--text-secondary)' }}>#{ch.name}</span>
                            <span style={{ fontSize: 7, color: 'var(--text-muted)' }}>{ch.numMembers}m</span>
                            <button
                              className="hq-btn"
                              style={{ fontSize: 8, color: isAllowed ? '#ef4444' : '#10b981', padding: '1px 6px' }}
                              onClick={() => isAllowed ? handleSlackRemoveChannel(ch.id) : handleSlackAddChannel(ch.id)}
                            >
                              {isAllowed ? 'Remove' : 'Allow'}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* User allowlist */}
                  <div style={{ fontSize: 8, color: 'var(--text-muted)', marginBottom: 3 }}>Allowed users (Slack user IDs)</div>
                  {(slackStatus?.allowedUsers ?? []).map(uid => (
                    <div key={uid} style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 3 }}>
                      <span style={{ flex: 1, fontSize: 9, fontFamily: 'monospace', color: 'var(--text-secondary)' }}>{uid}</span>
                      <button className="hq-btn" style={{ fontSize: 8, color: '#ef4444' }} onClick={() => handleSlackRemoveUser(uid)}>✕</button>
                    </div>
                  ))}
                  <div style={{ display: 'flex', gap: 4 }}>
                    <input
                      value={slackUserInput}
                      onChange={e => setSlackUserInput(e.target.value)}
                      placeholder="U012AB3CD"
                      style={{ flex: 1, fontSize: 9, padding: '3px 6px', borderRadius: 4, background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                    />
                    <button
                      className="hq-btn"
                      onClick={handleSlackAddUser}
                      disabled={!slackUserInput.trim()}
                      style={{ fontSize: 9, color: '#a855f7', borderColor: 'rgba(168,85,247,0.25)' }}
                    >
                      Add
                    </button>
                  </div>
                </div>
              )}

              {/* MESSAGES TAB */}
              {slackTab === 'messages' && (
                <div>
                  {slackMessages.length === 0
                    ? <div style={{ fontSize: 8, color: 'var(--text-muted)', textAlign: 'center', padding: '10px 0' }}>No messages yet.</div>
                    : slackMessages.map(msg => {
                        const statusColors: Record<string, string> = {
                          received: '#6b7280', classified: '#f59e0b', task_created: '#10b981',
                          blocked: '#ef4444', replied: '#a855f7', approval_pending: '#f97316',
                        };
                        const sc = statusColors[msg.status] ?? '#6b7280';
                        return (
                          <div key={msg.id} style={{ marginBottom: 5, padding: '4px 6px', borderRadius: 4, background: 'rgba(255,255,255,0.02)', border: `1px solid ${sc}20` }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                              <span style={{ fontSize: 7, fontWeight: 800, textTransform: 'uppercase', color: msg.direction === 'inbound' ? '#6366f1' : '#10b981' }}>
                                {msg.direction === 'inbound' ? '↓' : '↑'} {msg.chatName ?? msg.channelId}
                              </span>
                              <span style={{ marginLeft: 'auto', fontSize: 7, fontWeight: 700, color: sc, padding: '1px 4px', borderRadius: 10, background: `${sc}14` }}>{msg.status}</span>
                            </div>
                            <div style={{ fontSize: 8, color: 'var(--text-secondary)', wordBreak: 'break-word' }}>{msg.text.slice(0, 120)}{msg.text.length > 120 ? '…' : ''}</div>
                            {msg.blockedReason && <div style={{ fontSize: 7, color: '#ef4444', marginTop: 2 }}>{msg.blockedReason}</div>}
                            <div style={{ fontSize: 7, color: 'var(--text-muted)', marginTop: 2 }}>{new Date(msg.timestamp).toLocaleTimeString()}</div>
                          </div>
                        );
                      })
                  }
                </div>
              )}

              {/* SUMMARY TAB */}
              {slackTab === 'summary' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ fontSize: 8, color: 'var(--text-muted)' }}>
                    TriForge will post a mission/task digest to a channel on a fixed schedule.
                  </div>

                  <div>
                    <div style={{ fontSize: 8, color: 'var(--text-muted)', marginBottom: 2 }}>Summary channel ID</div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <input
                        value={slackSummaryChannelInput}
                        onChange={e => setSlackSummaryChannelInput(e.target.value)}
                        placeholder="C012AB3CD"
                        style={{ flex: 1, fontSize: 9, padding: '3px 6px', borderRadius: 4, background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                      />
                      <button
                        className="hq-btn"
                        onClick={handleSlackSaveSummaryChannel}
                        disabled={!slackSummaryChannelInput.trim()}
                        style={{ fontSize: 9, color: '#a855f7', borderColor: 'rgba(168,85,247,0.25)' }}
                      >
                        Save
                      </button>
                    </div>
                  </div>

                  <div>
                    <div style={{ fontSize: 8, color: 'var(--text-muted)', marginBottom: 3 }}>Schedule</div>
                    <div style={{ display: 'flex', gap: 3 }}>
                      {(['disabled', 'daily', 'weekly'] as const).map(s => (
                        <button
                          key={s}
                          className="hq-btn"
                          onClick={() => handleSlackSetSchedule(s)}
                          style={{
                            flex: 1, fontSize: 9, fontWeight: slackStatus?.summarySchedule === s ? 800 : 600,
                            background: slackStatus?.summarySchedule === s ? 'rgba(168,85,247,0.12)' : 'transparent',
                            border: `1px solid ${slackStatus?.summarySchedule === s ? 'rgba(168,85,247,0.35)' : 'var(--border)'}`,
                            color: slackStatus?.summarySchedule === s ? '#a855f7' : 'var(--text-muted)',
                          }}
                        >
                          {s.charAt(0).toUpperCase() + s.slice(1)}
                        </button>
                      ))}
                    </div>
                  </div>

                  {slackStatus?.summarySchedule !== 'disabled' && slackStatus?.summaryChannel && (
                    <div style={{ position: 'relative' }}>
                      {feedbacks['sl'] && <FeedbackBubble msg={feedbacks['sl'].msg} color={feedbacks['sl'].color} />}
                      <button
                        className="hq-btn"
                        onClick={handleSlackSendSummaryNow}
                        disabled={!slackStatus?.running}
                        style={{ width: '100%', fontSize: 9, fontWeight: 700, color: '#a855f7', borderColor: 'rgba(168,85,247,0.3)', opacity: slackStatus?.running ? 1 : 0.4 }}
                      >
                        Send Summary Now
                      </button>
                    </div>
                  )}
                </div>
              )}
            </PanelSection>

            {/* SKILL STORE */}
            <PanelSection title="Skill Store" accent="#a855f7" count={ssInstalledSkills.filter(s => s.enabled).length}>
              {/* Tab bar */}
              <div style={{ display: 'flex', gap: 2, marginBottom: 8 }}>
                {(['import', 'installed'] as const).map(tab => (
                  <button
                    key={tab}
                    className="hq-btn"
                    onClick={() => setSsTab(tab)}
                    style={{
                      flex: 1, fontSize: 8, fontWeight: 700, padding: '3px 0', borderRadius: 4,
                      background: ssTab === tab ? 'rgba(168,85,247,0.15)' : 'rgba(255,255,255,0.03)',
                      border: `1px solid ${ssTab === tab ? 'rgba(168,85,247,0.45)' : 'var(--border)'}`,
                      color: ssTab === tab ? '#c084fc' : 'var(--text-muted)',
                      cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.06em',
                    }}
                  >
                    {tab === 'installed' ? `Installed (${ssInstalledSkills.length})` : 'Import'}
                  </button>
                ))}
              </div>

              {ssTab === 'import' && (
                <>
                  {/* Import method selector */}
                  <div style={{ display: 'flex', gap: 2, marginBottom: 8 }}>
                    {(['paste', 'url', 'examples'] as const).map(m => (
                      <button
                        key={m}
                        className="hq-btn"
                        onClick={() => { setSsImportMethod(m); setSsAnalysis(null); }}
                        style={{
                          flex: 1, fontSize: 7, fontWeight: 700, padding: '2px 0', borderRadius: 3,
                          background: ssImportMethod === m ? 'rgba(168,85,247,0.1)' : 'transparent',
                          border: `1px solid ${ssImportMethod === m ? 'rgba(168,85,247,0.35)' : 'var(--border)'}`,
                          color: ssImportMethod === m ? '#c084fc' : 'var(--text-muted)',
                          cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.05em',
                        }}
                      >
                        {m}
                      </button>
                    ))}
                  </div>

                  {ssImportMethod === 'paste' && (
                    <textarea
                      value={ssPasteInput}
                      onChange={e => { setSsPasteInput(e.target.value); setSsAnalysis(null); }}
                      placeholder="---&#10;name: my-skill&#10;---&#10;&#10;Skill body…"
                      style={{ width: '100%', height: 80, resize: 'vertical', fontSize: 8, fontFamily: 'monospace', background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 4, padding: '4px 6px', boxSizing: 'border-box', marginBottom: 6 }}
                    />
                  )}

                  {ssImportMethod === 'url' && (
                    <>
                      <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
                        <input
                          value={ssUrlInput}
                          onChange={e => { setSsUrlInput(e.target.value); setSsFetchedMd(''); setSsAnalysis(null); }}
                          placeholder="https://raw.githubusercontent.com/…/skill.md"
                          style={{ flex: 1, fontSize: 8, padding: '3px 5px', borderRadius: 4, background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                          onKeyDown={e => e.key === 'Enter' && handleSsFetch()}
                        />
                        <button
                          className="hq-btn"
                          onClick={handleSsFetch}
                          disabled={ssFetching || !ssUrlInput.trim()}
                          style={{ fontSize: 8, fontWeight: 700, padding: '3px 7px', borderRadius: 4, background: 'rgba(168,85,247,0.1)', border: '1px solid rgba(168,85,247,0.3)', color: '#c084fc', cursor: ssFetching ? 'not-allowed' : 'pointer' }}
                        >
                          {ssFetching ? '…' : 'Fetch'}
                        </button>
                      </div>
                      {ssFetchedMd && (
                        <div style={{ fontSize: 7, color: '#10b981', marginBottom: 5 }}>Fetched {ssFetchedMd.length.toLocaleString()} chars — ready to analyze</div>
                      )}
                    </>
                  )}

                  {ssImportMethod === 'examples' && (
                    <div style={{ marginBottom: 6 }}>
                      {ssExamples.map((ex, i) => (
                        <div key={i} style={{ padding: '5px 6px', borderRadius: 4, background: 'rgba(168,85,247,0.04)', border: '1px solid rgba(168,85,247,0.14)', marginBottom: 4 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                            <span style={{ fontSize: 8, fontWeight: 800, color: '#c084fc', flex: 1 }}>{ex.name}</span>
                            <button
                              className="hq-btn"
                              onClick={() => handleSsInstall(ex.markdown, 'example')}
                              disabled={ssInstalling}
                              style={{ fontSize: 7, fontWeight: 700, padding: '1px 5px', borderRadius: 3, background: 'rgba(168,85,247,0.1)', border: '1px solid rgba(168,85,247,0.3)', color: '#c084fc', cursor: ssInstalling ? 'not-allowed' : 'pointer' }}
                            >
                              Install
                            </button>
                          </div>
                          <div style={{ fontSize: 7, color: 'var(--text-muted)' }}>{ex.description}</div>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Analyze + Install buttons */}
                  {ssImportMethod !== 'examples' && (
                    <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
                      <button
                        className="hq-btn"
                        onClick={handleSsAnalyze}
                        disabled={ssAnalyzing || !ssCurrentMarkdown().trim()}
                        style={{ flex: 1, fontSize: 9, fontWeight: 700, padding: '3px 0', borderRadius: 4, background: 'rgba(168,85,247,0.07)', border: '1px solid rgba(168,85,247,0.2)', color: '#c084fc', cursor: ssAnalyzing || !ssCurrentMarkdown().trim() ? 'not-allowed' : 'pointer' }}
                      >
                        {ssAnalyzing ? 'Analyzing…' : 'Analyze'}
                      </button>
                      {ssAnalysis && ssAnalysis.decision?.allowed && (
                        <button
                          className="hq-btn"
                          onClick={() => handleSsInstall()}
                          disabled={ssInstalling}
                          style={{ flex: 1, fontSize: 9, fontWeight: 700, padding: '3px 0', borderRadius: 4, background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', color: '#10b981', cursor: ssInstalling ? 'not-allowed' : 'pointer' }}
                        >
                          {ssInstalling ? '…' : 'Install'}
                        </button>
                      )}
                    </div>
                  )}

                  {/* Analysis result */}
                  {ssAnalysis && (() => {
                    const riskColors: Record<string, string> = { low: '#10b981', medium: '#f59e0b', high: '#f97316', critical: '#ef4444' };
                    const rc = riskColors[ssAnalysis.riskLevel] ?? '#a855f7';
                    return (
                      <div style={{ fontSize: 8, lineHeight: 1.5 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4, padding: '3px 6px', borderRadius: 4, background: `${rc}12`, border: `1px solid ${rc}28` }}>
                          <span style={{ fontWeight: 800, color: rc, textTransform: 'uppercase', fontSize: 7, letterSpacing: '0.08em' }}>{ssAnalysis.riskLevel}</span>
                          {ssAnalysis.blocked && <span style={{ fontWeight: 700, color: '#ef4444' }}>BLOCKED</span>}
                          {ssAnalysis.decision?.requiresCouncilReview && !ssAnalysis.blocked && <span style={{ color: '#f97316', fontWeight: 700 }}>COUNCIL REVIEW</span>}
                          {ssAnalysis.decision?.requiresApproval && !ssAnalysis.decision?.requiresCouncilReview && !ssAnalysis.blocked && <span style={{ color: '#f59e0b', fontWeight: 700 }}>APPROVAL</span>}
                          {ssAnalysis.decision?.allowed && !ssAnalysis.decision?.requiresApproval && <span style={{ color: '#10b981', fontWeight: 700 }}>SAFE</span>}
                        </div>
                        <div style={{ color: 'var(--text-secondary)', marginBottom: 4 }}>{ssAnalysis.reviewSummary}</div>
                        {ssAnalysis.detectedPatterns.slice(0, 3).map((p, i) => (
                          <div key={i} style={{ fontSize: 7, color: p.severity === 'critical' ? '#ef4444' : p.severity === 'high' ? '#f97316' : '#f59e0b', marginBottom: 1 }}>
                            [{p.severity.toUpperCase()}] {p.description}
                          </div>
                        ))}
                        {ssAnalysis.blocked && ssAnalysis.decision?.blockReason && (
                          <div style={{ fontSize: 7, color: '#ef4444', marginTop: 3, fontWeight: 700 }}>{ssAnalysis.decision.blockReason}</div>
                        )}
                      </div>
                    );
                  })()}
                </>
              )}

              {ssTab === 'installed' && (
                <>
                  {ssInstalledSkills.length === 0 ? (
                    <div style={{ fontSize: 8, color: 'var(--text-muted)', textAlign: 'center', padding: '10px 0' }}>No skills installed — use Import tab</div>
                  ) : (
                    ssInstalledSkills.map(skill => {
                      const riskColors: Record<string, string> = { low: '#10b981', medium: '#f59e0b', high: '#f97316', critical: '#ef4444' };
                      const rc = riskColors[skill.riskLevel] ?? '#a855f7';
                      const isRunning = ssRunningSkillId === skill.id;
                      const isUninstalling = ssUninstallingId === skill.id;
                      return (
                        <div key={skill.id} style={{ padding: '5px 6px', borderRadius: 5, background: skill.enabled ? 'rgba(168,85,247,0.04)' : 'rgba(255,255,255,0.01)', border: `1px solid ${skill.enabled ? 'rgba(168,85,247,0.18)' : 'rgba(255,255,255,0.06)'}`, marginBottom: 4, opacity: skill.enabled ? 1 : 0.55 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 3 }}>
                            <span style={{ fontSize: 8, fontWeight: 800, color: skill.enabled ? '#c084fc' : 'var(--text-muted)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{skill.name}</span>
                            <span style={{ fontSize: 7, fontWeight: 700, color: rc, textTransform: 'uppercase', letterSpacing: '0.05em', flexShrink: 0 }}>{skill.riskLevel}</span>
                          </div>
                          {skill.description && (
                            <div style={{ fontSize: 7, color: 'var(--text-muted)', marginBottom: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{skill.description}</div>
                          )}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 3, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 6, color: 'rgba(255,255,255,0.2)', fontFamily: 'monospace' }}>{skill.source}</span>
                            {skill.runCount > 0 && <span style={{ fontSize: 6, color: 'rgba(255,255,255,0.2)' }}>runs:{skill.runCount}</span>}
                            <span style={{ flex: 1 }} />
                            <button
                              className="hq-btn"
                              onClick={() => handleSsToggleEnabled(skill.id, !skill.enabled)}
                              style={{ fontSize: 6, fontWeight: 700, padding: '1px 4px', borderRadius: 2, background: skill.enabled ? 'rgba(16,185,129,0.08)' : 'rgba(255,255,255,0.04)', border: `1px solid ${skill.enabled ? 'rgba(16,185,129,0.25)' : 'rgba(255,255,255,0.1)'}`, color: skill.enabled ? '#10b981' : 'var(--text-muted)', cursor: 'pointer' }}
                            >
                              {skill.enabled ? 'ON' : 'OFF'}
                            </button>
                            <button
                              className="hq-btn"
                              onClick={() => handleSsRun(skill.id)}
                              disabled={!skill.enabled || isRunning}
                              style={{ fontSize: 6, fontWeight: 700, padding: '1px 4px', borderRadius: 2, background: 'rgba(168,85,247,0.08)', border: '1px solid rgba(168,85,247,0.22)', color: '#c084fc', cursor: !skill.enabled || isRunning ? 'not-allowed' : 'pointer' }}
                            >
                              {isRunning ? '…' : 'Run'}
                            </button>
                            <button
                              className="hq-btn"
                              onClick={() => handleSsUninstall(skill.id)}
                              disabled={isUninstalling}
                              style={{ fontSize: 6, fontWeight: 700, padding: '1px 4px', borderRadius: 2, background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.18)', color: '#f87171', cursor: isUninstalling ? 'not-allowed' : 'pointer' }}
                            >
                              {isUninstalling ? '…' : 'Remove'}
                            </button>
                          </div>
                        </div>
                      );
                    })
                  )}
                </>
              )}
            </PanelSection>

            {/* JIRA INTEGRATION */}
            <PanelSection title="Jira" accent="#0052cc" count={jiraQueue.filter(a => a.status === 'pending').length}>
              {/* Tab bar */}
              <div style={{ display: 'flex', gap: 2, marginBottom: 8 }}>
                {(['setup', 'browse', 'act', 'queue'] as const).map(tab => (
                  <button
                    key={tab}
                    className="hq-btn"
                    onClick={() => setJiraTab(tab)}
                    style={{
                      flex: 1, fontSize: 8, fontWeight: jiraTab === tab ? 800 : 600,
                      background: jiraTab === tab ? 'rgba(0,82,204,0.14)' : 'transparent',
                      border: `1px solid ${jiraTab === tab ? 'rgba(0,82,204,0.4)' : 'var(--border)'}`,
                      color: jiraTab === tab ? '#4c9aff' : 'var(--text-muted)',
                      padding: '3px 0',
                    }}
                  >
                    {tab === 'setup' ? 'Setup' : tab === 'browse' ? 'Browse' : tab === 'act' ? 'Act' : `Queue${jiraQueue.filter(a => a.status === 'pending').length > 0 ? ` (${jiraQueue.filter(a => a.status === 'pending').length})` : ''}`}
                  </button>
                ))}
              </div>

              {/* SETUP TAB */}
              {jiraTab === 'setup' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                  {/* Connection status */}
                  {jiraStatus?.enabled && jiraStatus.displayName && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 6px', borderRadius: 4, background: 'rgba(0,82,204,0.08)', border: '1px solid rgba(0,82,204,0.25)', marginBottom: 2 }}>
                      <span style={{ fontSize: 8, color: '#4c9aff', fontWeight: 800 }}>●</span>
                      <span style={{ fontSize: 8, color: '#4c9aff', fontWeight: 700, flex: 1 }}>{jiraStatus.displayName}</span>
                      <span style={{ fontSize: 7, color: 'var(--text-muted)' }}>{jiraStatus.email}</span>
                    </div>
                  )}

                  <div>
                    <div style={{ fontSize: 8, color: 'var(--text-muted)', marginBottom: 2 }}>Workspace URL</div>
                    <input
                      value={jiraWorkspaceInput}
                      onChange={e => setJiraWorkspaceInput(e.target.value)}
                      placeholder="https://mycompany.atlassian.net"
                      style={{ width: '100%', fontSize: 9, padding: '3px 6px', borderRadius: 4, background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', boxSizing: 'border-box' }}
                    />
                  </div>
                  <div>
                    <div style={{ fontSize: 8, color: 'var(--text-muted)', marginBottom: 2 }}>Email</div>
                    <input
                      value={jiraEmailInput}
                      onChange={e => setJiraEmailInput(e.target.value)}
                      placeholder="you@company.com"
                      style={{ width: '100%', fontSize: 9, padding: '3px 6px', borderRadius: 4, background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', boxSizing: 'border-box' }}
                    />
                  </div>
                  <div>
                    <div style={{ fontSize: 8, color: 'var(--text-muted)', marginBottom: 2 }}>API token</div>
                    <input
                      type="password"
                      value={jiraTokenInput}
                      onChange={e => setJiraTokenInput(e.target.value)}
                      placeholder="Atlassian API token"
                      style={{ width: '100%', fontSize: 9, padding: '3px 6px', borderRadius: 4, background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', boxSizing: 'border-box' }}
                    />
                  </div>

                  <div style={{ position: 'relative' }}>
                    {feedbacks['jira'] && <FeedbackBubble msg={feedbacks['jira'].msg} color={feedbacks['jira'].color} />}
                    <button
                      className="hq-btn"
                      onClick={handleJiraConnect}
                      disabled={jiraConnecting || !jiraWorkspaceInput.trim() || !jiraEmailInput.trim() || !jiraTokenInput.trim()}
                      style={{ width: '100%', fontSize: 10, fontWeight: 700, padding: '5px 0', borderRadius: 4, background: 'rgba(0,82,204,0.08)', border: '1px solid rgba(0,82,204,0.3)', color: '#4c9aff', cursor: jiraConnecting ? 'not-allowed' : 'pointer' }}
                    >
                      {jiraConnecting ? 'Connecting…' : 'Connect & Verify'}
                    </button>
                  </div>

                  {/* Slack summary cross-flow */}
                  {jiraStatus?.enabled && (
                    <div style={{ marginTop: 4, padding: '6px 8px', borderRadius: 4, background: 'rgba(74,21,75,0.06)', border: '1px solid rgba(74,21,75,0.18)' }}>
                      <div style={{ fontSize: 8, color: '#a855f7', fontWeight: 700, marginBottom: 4 }}>Post summary to Slack</div>
                      <div style={{ display: 'flex', gap: 4 }}>
                        <input
                          value={jiraSummaryChannelInput}
                          onChange={e => setJiraSummaryChannelInput(e.target.value)}
                          placeholder="Slack channel ID"
                          style={{ flex: 1, fontSize: 9, padding: '3px 6px', borderRadius: 4, background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                        />
                        <button
                          className="hq-btn"
                          onClick={handleJiraSendSummary}
                          disabled={jiraSummaryLoading || !jiraSummaryChannelInput.trim()}
                          style={{ fontSize: 8, color: '#a855f7', borderColor: 'rgba(168,85,247,0.3)' }}
                        >
                          {jiraSummaryLoading ? '…' : 'Send'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* BROWSE TAB */}
              {jiraTab === 'browse' && (
                <div>
                  {/* JQL presets */}
                  <div style={{ display: 'flex', gap: 3, marginBottom: 5 }}>
                    {[
                      { label: 'My open', jql: 'assignee = currentUser() AND statusCategory != Done ORDER BY updated DESC' },
                      { label: 'All open', jql: 'statusCategory != Done ORDER BY updated DESC' },
                      { label: 'Recent', jql: 'updated >= -7d ORDER BY updated DESC' },
                    ].map(p => (
                      <button
                        key={p.label}
                        className="hq-btn"
                        onClick={() => setJiraJql(p.jql)}
                        style={{ flex: 1, fontSize: 8, color: jiraJql === p.jql ? '#4c9aff' : 'var(--text-muted)', borderColor: jiraJql === p.jql ? 'rgba(0,82,204,0.35)' : 'var(--border)' }}
                      >
                        {p.label}
                      </button>
                    ))}
                  </div>

                  {/* JQL input */}
                  <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
                    <input
                      value={jiraJql}
                      onChange={e => setJiraJql(e.target.value)}
                      placeholder="JQL query…"
                      style={{ flex: 1, fontSize: 8, fontFamily: 'monospace', padding: '3px 6px', borderRadius: 4, background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                    />
                    <button
                      className="hq-btn"
                      onClick={handleJiraSearch}
                      disabled={jiraIssuesLoading}
                      style={{ fontSize: 9, fontWeight: 700, color: '#4c9aff', borderColor: 'rgba(0,82,204,0.3)', padding: '3px 8px' }}
                    >
                      {jiraIssuesLoading ? '…' : 'Search'}
                    </button>
                  </div>

                  {/* Issue list */}
                  {jiraIssues.length === 0 && !jiraIssuesLoading && (
                    <div style={{ fontSize: 8, color: 'var(--text-muted)', textAlign: 'center', padding: '8px 0' }}>No results. Run a search.</div>
                  )}
                  {jiraIssues.map(issue => {
                    const sc = JIRA_STATUS_COLORS[issue.statusCategory] ?? '#6b7280';
                    const pc = JIRA_PRIORITY_COLORS[issue.priority] ?? '#6b7280';
                    return (
                      <div
                        key={issue.id}
                        style={{ marginBottom: 4, padding: '5px 6px', borderRadius: 4, background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', cursor: 'pointer' }}
                        onClick={() => handleJiraSelectIssue(issue.key)}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                          <span style={{ fontSize: 8, fontWeight: 800, fontFamily: 'monospace', color: '#4c9aff' }}>{issue.key}</span>
                          <span style={{ fontSize: 7, padding: '1px 4px', borderRadius: 10, background: `${sc}18`, color: sc, fontWeight: 700 }}>{issue.status}</span>
                          <span style={{ fontSize: 7, color: pc, marginLeft: 'auto', fontWeight: 700 }}>{issue.priority}</span>
                        </div>
                        <div style={{ fontSize: 9, color: 'var(--text-secondary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{issue.summary}</div>
                        {issue.assigneeName && <div style={{ fontSize: 7, color: 'var(--text-muted)', marginTop: 1 }}>{issue.assigneeName}</div>}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* ACT TAB */}
              {jiraTab === 'act' && (
                <div>
                  {jiraIssueLoading && <div style={{ fontSize: 8, color: 'var(--text-muted)', textAlign: 'center', padding: '12px 0' }}>Loading…</div>}

                  {!jiraIssueLoading && !jiraSelectedIssue && (
                    <div style={{ fontSize: 8, color: 'var(--text-muted)', textAlign: 'center', padding: '12px 0' }}>Select an issue from Browse.</div>
                  )}

                  {jiraSelectedIssue && (() => {
                    const sc = JIRA_STATUS_COLORS[jiraSelectedIssue.statusCategory] ?? '#6b7280';
                    const pc = JIRA_PRIORITY_COLORS[jiraSelectedIssue.priority] ?? '#6b7280';
                    return (
                      <div>
                        {/* Issue header */}
                        <div style={{ padding: '6px 8px', borderRadius: 4, background: 'rgba(0,82,204,0.06)', border: '1px solid rgba(0,82,204,0.2)', marginBottom: 8 }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 3 }}>
                            <span style={{ fontSize: 9, fontWeight: 800, fontFamily: 'monospace', color: '#4c9aff' }}>{jiraSelectedIssue.key}</span>
                            <span style={{ fontSize: 7, padding: '1px 4px', borderRadius: 10, background: `${sc}18`, color: sc, fontWeight: 700 }}>{jiraSelectedIssue.status}</span>
                            <span style={{ fontSize: 7, color: pc, fontWeight: 700, marginLeft: 'auto' }}>{jiraSelectedIssue.priority}</span>
                          </div>
                          <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 3 }}>{jiraSelectedIssue.summary}</div>
                          {jiraSelectedIssue.description && (
                            <div style={{ fontSize: 8, color: 'var(--text-secondary)', lineHeight: 1.5, maxHeight: 60, overflow: 'hidden' }}>
                              {jiraSelectedIssue.description.slice(0, 300)}
                            </div>
                          )}
                          {jiraSelectedIssue.assigneeName && (
                            <div style={{ fontSize: 7, color: 'var(--text-muted)', marginTop: 3 }}>Assignee: {jiraSelectedIssue.assigneeName}</div>
                          )}
                        </div>

                        {/* Triage */}
                        <div style={{ position: 'relative', marginBottom: 6 }}>
                          {feedbacks['jira'] && <FeedbackBubble msg={feedbacks['jira'].msg} color={feedbacks['jira'].color} />}
                          <button
                            className="hq-btn"
                            onClick={handleJiraTriage}
                            disabled={jiraTriaging}
                            style={{ width: '100%', fontSize: 9, fontWeight: 700, padding: '5px 0', borderRadius: 4, background: 'rgba(168,85,247,0.08)', border: '1px solid rgba(168,85,247,0.3)', color: '#a855f7', cursor: jiraTriaging ? 'not-allowed' : 'pointer' }}
                          >
                            {jiraTriaging ? 'Submitting…' : 'Triage with TriForge'}
                          </button>
                          {jiraTriageTaskId && (
                            <div style={{ fontSize: 7, color: 'var(--text-muted)', marginTop: 3, textAlign: 'center' }}>
                              Triage task submitted — view result in task queue.
                            </div>
                          )}
                        </div>

                        {/* Available transitions */}
                        {jiraTransitions.length > 0 && (
                          <div style={{ marginBottom: 6 }}>
                            <div style={{ fontSize: 8, color: 'var(--text-muted)', marginBottom: 3 }}>Transition status (queued for approval)</div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                              {jiraTransitions.map(t => (
                                <button
                                  key={t.id}
                                  className="hq-btn"
                                  onClick={() => handleJiraQueueTransition(t)}
                                  style={{ fontSize: 8, color: '#4c9aff', borderColor: 'rgba(0,82,204,0.25)' }}
                                >
                                  → {t.name}
                                </button>
                              ))}
                            </div>
                          </div>
                        )}

                        {/* Recent comments */}
                        {jiraComments.length > 0 && (
                          <div style={{ marginBottom: 6 }}>
                            <div style={{ fontSize: 8, color: 'var(--text-muted)', marginBottom: 3 }}>Recent comments</div>
                            {jiraComments.slice(0, 3).map(c => (
                              <div key={c.id} style={{ marginBottom: 3, padding: '3px 5px', borderRadius: 3, background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)' }}>
                                <div style={{ display: 'flex', gap: 4, marginBottom: 1 }}>
                                  <span style={{ fontSize: 7, fontWeight: 700, color: '#4c9aff' }}>{c.authorName}</span>
                                  <span style={{ fontSize: 7, color: 'var(--text-muted)' }}>{new Date(c.created).toLocaleDateString()}</span>
                                </div>
                                <div style={{ fontSize: 8, color: 'var(--text-secondary)' }}>{c.body.slice(0, 120)}</div>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* Add comment */}
                        <div>
                          <div style={{ fontSize: 8, color: 'var(--text-muted)', marginBottom: 2 }}>Draft comment (queued for approval)</div>
                          <textarea
                            value={jiraCommentInput}
                            onChange={e => setJiraCommentInput(e.target.value)}
                            placeholder="Write a comment…"
                            rows={3}
                            style={{ width: '100%', fontSize: 9, padding: '4px 6px', borderRadius: 4, background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', resize: 'vertical', boxSizing: 'border-box', marginBottom: 4 }}
                          />
                          <button
                            className="hq-btn"
                            onClick={handleJiraQueueComment}
                            disabled={jiraCommentSending || !jiraCommentInput.trim()}
                            style={{ width: '100%', fontSize: 9, fontWeight: 700, padding: '4px 0', borderRadius: 4, background: 'rgba(0,82,204,0.08)', border: '1px solid rgba(0,82,204,0.3)', color: '#4c9aff', cursor: jiraCommentSending || !jiraCommentInput.trim() ? 'not-allowed' : 'pointer' }}
                          >
                            {jiraCommentSending ? 'Queuing…' : 'Queue Comment'}
                          </button>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              )}

              {/* QUEUE TAB */}
              {jiraTab === 'queue' && (
                <div>
                  {jiraQueue.length === 0 && (
                    <div style={{ fontSize: 8, color: 'var(--text-muted)', textAlign: 'center', padding: '12px 0' }}>No queued actions.</div>
                  )}
                  {jiraQueue.map(action => {
                    const isPending = action.status === 'pending';
                    const statusColor = isPending ? '#f59e0b' : action.status === 'approved' ? '#10b981' : '#6b7280';
                    return (
                      <div
                        key={action.id}
                        style={{ marginBottom: 5, padding: '5px 7px', borderRadius: 4, background: 'rgba(255,255,255,0.02)', border: `1px solid ${statusColor}25`, opacity: isPending ? 1 : 0.6 }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                          <span style={{ fontSize: 7, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#4c9aff' }}>{action.type}</span>
                          {action.issueKey && <span style={{ fontSize: 7, fontFamily: 'monospace', color: 'var(--text-muted)' }}>{action.issueKey}</span>}
                          <span style={{ marginLeft: 'auto', fontSize: 7, fontWeight: 700, padding: '1px 4px', borderRadius: 10, background: `${statusColor}16`, color: statusColor }}>{action.status}</span>
                        </div>
                        <div style={{ fontSize: 8, color: 'var(--text-secondary)', marginBottom: 3 }}>{action.summary}</div>
                        {action.body && (
                          <div style={{ fontSize: 7, color: 'var(--text-muted)', fontFamily: 'monospace', background: 'rgba(255,255,255,0.03)', padding: '2px 4px', borderRadius: 3, marginBottom: 4 }}>
                            {action.body.slice(0, 100)}{action.body.length > 100 ? '…' : ''}
                          </div>
                        )}
                        {isPending && (
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button
                              className="hq-btn"
                              onClick={() => handleJiraApprove(action.id)}
                              disabled={jiraQueueProcessing === action.id}
                              style={{ flex: 1, fontSize: 9, fontWeight: 700, color: '#10b981', borderColor: 'rgba(16,185,129,0.3)' }}
                            >
                              {jiraQueueProcessing === action.id ? '…' : 'Approve & Execute'}
                            </button>
                            <button
                              className="hq-btn"
                              onClick={() => handleJiraDismiss(action.id)}
                              style={{ flex: 1, fontSize: 9, color: '#ef4444', borderColor: 'rgba(239,68,68,0.25)' }}
                            >
                              Dismiss
                            </button>
                          </div>
                        )}
                        {!isPending && (
                          <div style={{ fontSize: 7, color: 'var(--text-muted)' }}>
                            {action.processedAt ? new Date(action.processedAt).toLocaleTimeString() : ''}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </PanelSection>

            {/* DISCORD INTEGRATION */}
            <PanelSection title="Discord" accent="#5865f2" count={0}>
              {/* Tab bar */}
              <div style={{ display: 'flex', gap: 3, marginBottom: 8 }}>
                {(['setup', 'channels', 'messages'] as const).map(tab => (
                  <button
                    key={tab}
                    className="hq-btn"
                    onClick={() => setDiscordTab(tab)}
                    style={{
                      flex: 1, fontSize: 8, fontWeight: discordTab === tab ? 800 : 600,
                      background: discordTab === tab ? 'rgba(88,101,242,0.14)' : 'transparent',
                      border: `1px solid ${discordTab === tab ? 'rgba(88,101,242,0.4)' : 'var(--border)'}`,
                      color: discordTab === tab ? '#7983f5' : 'var(--text-muted)',
                    }}
                  >
                    {tab === 'setup' ? 'Setup' : tab === 'channels' ? 'Channels' : 'Messages'}
                  </button>
                ))}
              </div>

              {/* SETUP TAB */}
              {discordTab === 'setup' && (
                <div>
                  {/* Bot user badge */}
                  {discordStatus?.botUserName ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 8, padding: '3px 6px', borderRadius: 4, background: 'rgba(88,101,242,0.08)', border: '1px solid rgba(88,101,242,0.25)' }}>
                      <span style={{ fontSize: 8, color: '#5865f2', fontWeight: 800 }}>●</span>
                      <span style={{ fontSize: 9, color: 'var(--text-secondary)', flex: 1 }}>{discordStatus.botUserName}</span>
                      <span style={{ fontSize: 7, padding: '1px 5px', borderRadius: 10, background: discordStatus.running ? 'rgba(16,185,129,0.12)' : 'rgba(107,114,128,0.12)', color: discordStatus.running ? '#10b981' : '#6b7280', fontWeight: 700 }}>
                        {discordStatus.running ? 'listening' : 'stopped'}
                      </span>
                    </div>
                  ) : (
                    <div style={{ fontSize: 8, color: 'var(--text-muted)', marginBottom: 6 }}>Enter your Discord bot token to connect.</div>
                  )}

                  {/* Token input */}
                  <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
                    <input
                      type="password"
                      value={discordTokenInput}
                      onChange={e => setDiscordTokenInput(e.target.value)}
                      placeholder="Bot token (from Discord Developer Portal)"
                      onKeyDown={e => e.key === 'Enter' && handleDiscordConnect()}
                      style={{ flex: 1, fontSize: 9, padding: '3px 6px', borderRadius: 4, background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                    />
                    <button
                      className="hq-btn"
                      onClick={handleDiscordConnect}
                      disabled={discordConnecting || !discordTokenInput.trim()}
                      style={{ fontSize: 9, fontWeight: 700, color: '#7983f5', borderColor: 'rgba(88,101,242,0.35)', whiteSpace: 'nowrap' }}
                    >
                      {discordConnecting ? '…' : 'Connect'}
                    </button>
                  </div>

                  {/* Start / Stop */}
                  {discordStatus?.botUserName && (
                    <button
                      className="hq-btn"
                      onClick={handleDiscordToggle}
                      style={{ width: '100%', fontSize: 9, fontWeight: 700, marginBottom: 8, color: discordStatus.running ? '#ef4444' : '#10b981', borderColor: discordStatus.running ? 'rgba(239,68,68,0.3)' : 'rgba(16,185,129,0.3)' }}
                    >
                      {discordStatus.running ? 'Stop listener' : 'Start listener'}
                    </button>
                  )}
                  {feedback['dsc'] && (
                    <div style={{ marginBottom: 6, fontSize: 8, color: '#10b981', textAlign: 'center' }}>{feedback['dsc']}</div>
                  )}

                  {/* Test send */}
                  {discordStatus?.running && (
                    <div style={{ marginTop: 4 }}>
                      <div style={{ fontSize: 7, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 4 }}>Test send</div>
                      <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                        <input
                          type="text"
                          value={discordTestChannelId}
                          onChange={e => setDiscordTestChannelId(e.target.value)}
                          placeholder="Channel ID"
                          style={{ width: '40%', fontSize: 9, padding: '3px 6px', borderRadius: 4, background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                        />
                        <input
                          type="text"
                          value={discordTestText}
                          onChange={e => setDiscordTestText(e.target.value)}
                          placeholder="Message…"
                          style={{ flex: 1, fontSize: 9, padding: '3px 6px', borderRadius: 4, background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                          onKeyDown={e => e.key === 'Enter' && handleDiscordTestSend()}
                        />
                        <button
                          className="hq-btn"
                          onClick={handleDiscordTestSend}
                          disabled={discordTestSending}
                          style={{ fontSize: 9, color: '#7983f5', borderColor: 'rgba(88,101,242,0.3)' }}
                        >
                          {discordTestSending ? '…' : 'Send'}
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* CHANNELS TAB */}
              {discordTab === 'channels' && (
                <div>
                  {/* Guild picker */}
                  {discordGuilds.length > 0 && (
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 7, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 4 }}>Servers</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                        {discordGuilds.map(g => (
                          <button
                            key={g.id}
                            className="hq-btn"
                            onClick={() => handleDiscordLoadChannels(g)}
                            style={{ fontSize: 7, background: discordSelectedGuild?.id === g.id ? 'rgba(88,101,242,0.14)' : 'transparent', borderColor: discordSelectedGuild?.id === g.id ? 'rgba(88,101,242,0.4)' : 'var(--border)', color: discordSelectedGuild?.id === g.id ? '#7983f5' : 'var(--text-muted)' }}
                          >
                            {g.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Channels from selected guild */}
                  {discordChannelsLoading && <div style={{ fontSize: 8, color: 'var(--text-muted)', marginBottom: 6 }}>Loading…</div>}
                  {discordChannels.length > 0 && (
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 7, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 4 }}>Add channel to allowlist</div>
                      <div style={{ maxHeight: 80, overflowY: 'auto', display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                        {discordChannels.map(c => {
                          const already = discordStatus?.allowedChannels.includes(c.id);
                          return (
                            <button
                              key={c.id}
                              className="hq-btn"
                              onClick={() => !already && handleDiscordAddChannel(c.id)}
                              style={{ fontSize: 7, color: already ? '#10b981' : 'var(--text-muted)', borderColor: already ? 'rgba(16,185,129,0.3)' : 'var(--border)', cursor: already ? 'default' : 'pointer' }}
                            >
                              #{c.name}{already ? ' ✓' : ''}
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  )}

                  {/* Manual channel ID entry */}
                  <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
                    <input
                      type="text"
                      value={discordChannelIdInput}
                      onChange={e => setDiscordChannelIdInput(e.target.value)}
                      placeholder="Paste channel ID manually…"
                      onKeyDown={e => e.key === 'Enter' && handleDiscordAddChannel(discordChannelIdInput)}
                      style={{ flex: 1, fontSize: 9, padding: '3px 6px', borderRadius: 4, background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                    />
                    <button
                      className="hq-btn"
                      onClick={() => handleDiscordAddChannel(discordChannelIdInput)}
                      style={{ fontSize: 9, color: '#7983f5', borderColor: 'rgba(88,101,242,0.3)' }}
                    >
                      Add
                    </button>
                  </div>

                  {/* Allowed channels list */}
                  {(discordStatus?.allowedChannels ?? []).length > 0 && (
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 7, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 4 }}>Allowed channels</div>
                      {discordStatus!.allowedChannels.map(cid => (
                        <div key={cid} style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                          <span style={{ fontSize: 8, color: 'var(--text-secondary)', fontFamily: 'monospace', flex: 1 }}>{cid}</span>
                          <button className="hq-btn" onClick={() => handleDiscordRemoveChannel(cid)} style={{ fontSize: 7, color: '#ef4444', borderColor: 'rgba(239,68,68,0.2)', padding: '1px 5px' }}>✕</button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* User allowlist */}
                  <div>
                    <div style={{ fontSize: 7, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 4 }}>User allowlist</div>
                    <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                      <input
                        type="text"
                        value={discordUserIdInput}
                        onChange={e => setDiscordUserIdInput(e.target.value)}
                        placeholder="Discord user ID…"
                        onKeyDown={e => e.key === 'Enter' && handleDiscordAddUser()}
                        style={{ flex: 1, fontSize: 9, padding: '3px 6px', borderRadius: 4, background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                      />
                      <button className="hq-btn" onClick={handleDiscordAddUser} style={{ fontSize: 9, color: '#7983f5', borderColor: 'rgba(88,101,242,0.3)' }}>Add</button>
                    </div>
                    {(discordStatus?.allowedUsers ?? []).length === 0 && (
                      <div style={{ fontSize: 7, color: 'var(--text-muted)' }}>Empty = any user in allowed channels can message the bot.</div>
                    )}
                    {(discordStatus?.allowedUsers ?? []).map(uid => (
                      <div key={uid} style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                        <span style={{ fontSize: 8, color: 'var(--text-secondary)', fontFamily: 'monospace', flex: 1 }}>{uid}</span>
                        <button className="hq-btn" onClick={() => handleDiscordRemoveUser(uid)} style={{ fontSize: 7, color: '#ef4444', borderColor: 'rgba(239,68,68,0.2)', padding: '1px 5px' }}>✕</button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* MESSAGES TAB */}
              {discordTab === 'messages' && (
                <div>
                  {discordMessages.length === 0 && (
                    <div style={{ fontSize: 8, color: 'var(--text-muted)', textAlign: 'center', padding: '12px 0' }}>No messages yet.</div>
                  )}
                  {discordMessages.map(m => {
                    const isIn    = m.direction === 'inbound';
                    const blocked = m.status === 'blocked';
                    const statusColor = blocked ? '#ef4444' : m.status === 'approval_pending' ? '#f59e0b' : m.status === 'replied' ? '#10b981' : 'var(--text-muted)';
                    return (
                      <div
                        key={m.id}
                        style={{ marginBottom: 4, padding: '4px 6px', borderRadius: 4, background: `rgba(88,101,242,${isIn ? '0.04' : '0.02'})`, border: `1px solid ${blocked ? 'rgba(239,68,68,0.2)' : 'var(--border)'}` }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                          <span style={{ fontSize: 7, fontWeight: 700, color: isIn ? '#7983f5' : 'var(--text-muted)' }}>{isIn ? '▼ in' : '▲ out'}</span>
                          {m.channelId && <span style={{ fontSize: 7, fontFamily: 'monospace', color: 'var(--text-muted)' }}>#{m.channelId}</span>}
                          {m.riskClass && <span style={{ fontSize: 7, color: '#f59e0b', fontWeight: 700 }}>{m.riskClass}</span>}
                          <span style={{ marginLeft: 'auto', fontSize: 7, color: statusColor, fontWeight: 700 }}>{m.status}</span>
                        </div>
                        <div style={{ fontSize: 8, color: 'var(--text-secondary)' }}>{m.text}</div>
                        {m.blockedReason && <div style={{ fontSize: 7, color: '#ef4444', marginTop: 1 }}>{m.blockedReason}</div>}
                        <div style={{ fontSize: 7, color: 'var(--text-muted)', marginTop: 1 }}>{new Date(m.timestamp).toLocaleTimeString()}</div>
                      </div>
                    );
                  })}
                </div>
              )}
            </PanelSection>

            {/* LINEAR INTEGRATION */}
            <PanelSection title="Linear" accent="#5e6ad2" count={linearQueue.filter(a => a.status === 'pending').length}>
              {/* Tab bar */}
              <div style={{ display: 'flex', gap: 3, marginBottom: 8 }}>
                {(['setup', 'browse', 'act', 'queue'] as const).map(tab => (
                  <button
                    key={tab}
                    className="hq-btn"
                    onClick={() => setLinearTab(tab)}
                    style={{
                      flex: 1, fontSize: 8, fontWeight: linearTab === tab ? 800 : 600,
                      background: linearTab === tab ? 'rgba(94,106,210,0.14)' : 'transparent',
                      border: `1px solid ${linearTab === tab ? 'rgba(94,106,210,0.4)' : 'var(--border)'}`,
                      color: linearTab === tab ? '#818cf8' : 'var(--text-muted)',
                    }}
                  >
                    {tab === 'setup' ? 'Setup' : tab === 'browse' ? 'Browse' : tab === 'act' ? 'Act' : `Queue${linearQueue.filter(a => a.status === 'pending').length > 0 ? ` (${linearQueue.filter(a => a.status === 'pending').length})` : ''}`}
                  </button>
                ))}
              </div>

              {/* SETUP TAB */}
              {linearTab === 'setup' && (
                <div>
                  {linearStatus?.enabled ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 8, padding: '3px 6px', borderRadius: 4, background: 'rgba(94,106,210,0.08)', border: '1px solid rgba(94,106,210,0.25)' }}>
                      <span style={{ fontSize: 8, color: '#5e6ad2', fontWeight: 800 }}>●</span>
                      <span style={{ fontSize: 9, color: 'var(--text-secondary)', flex: 1 }}>{linearStatus.userName || 'Connected'}</span>
                      <button className="hq-btn" onClick={() => setLinearApiKeyInput('rotate')} style={{ fontSize: 7, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: '1px 3px' }}>change key</button>
                    </div>
                  ) : (
                    <div style={{ fontSize: 8, color: 'var(--text-muted)', marginBottom: 6 }}>Enter your Linear Personal API key to connect.</div>
                  )}
                  <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
                    <input
                      type="password"
                      value={linearApiKeyInput}
                      onChange={e => setLinearApiKeyInput(e.target.value)}
                      placeholder="lin_api_… (Personal API key)"
                      onKeyDown={e => e.key === 'Enter' && handleLinearConnect()}
                      style={{ flex: 1, fontSize: 9, padding: '3px 6px', borderRadius: 4, background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                    />
                    <button
                      className="hq-btn"
                      onClick={handleLinearConnect}
                      disabled={linearConnecting || !linearApiKeyInput.trim()}
                      style={{ fontSize: 9, fontWeight: 700, color: '#818cf8', borderColor: 'rgba(94,106,210,0.35)', whiteSpace: 'nowrap' }}
                    >
                      {linearConnecting ? '…' : 'Connect'}
                    </button>
                  </div>
                  {feedback['lin'] && (
                    <div style={{ marginBottom: 6, fontSize: 8, color: '#10b981', textAlign: 'center' }}>{feedback['lin']}</div>
                  )}

                  {/* Team filter */}
                  {linearTeams.length > 0 && (
                    <div style={{ marginBottom: 8 }}>
                      <div style={{ fontSize: 7, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 4 }}>Filter to team</div>
                      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                        <button
                          className="hq-btn"
                          onClick={() => setLinearSelectedTeam(null)}
                          style={{ fontSize: 7, background: !linearSelectedTeam ? 'rgba(94,106,210,0.14)' : 'transparent', borderColor: !linearSelectedTeam ? 'rgba(94,106,210,0.4)' : 'var(--border)', color: !linearSelectedTeam ? '#818cf8' : 'var(--text-muted)' }}
                        >
                          All teams
                        </button>
                        {linearTeams.map(t => (
                          <button
                            key={t.id}
                            className="hq-btn"
                            onClick={() => setLinearSelectedTeam(linearSelectedTeam?.id === t.id ? null : t)}
                            style={{ fontSize: 7, background: linearSelectedTeam?.id === t.id ? 'rgba(94,106,210,0.14)' : 'transparent', borderColor: linearSelectedTeam?.id === t.id ? 'rgba(94,106,210,0.4)' : 'var(--border)', color: linearSelectedTeam?.id === t.id ? '#818cf8' : 'var(--text-muted)' }}
                          >
                            [{t.key}] {t.name}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Slack summary channel */}
                  <div style={{ marginBottom: 4 }}>
                    <div style={{ fontSize: 7, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 3 }}>Slack summary channel</div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <input
                        type="text"
                        value={linearSummaryChannelInput}
                        onChange={e => setLinearSummaryChannelInput(e.target.value)}
                        placeholder="C0123456789"
                        style={{ flex: 1, fontSize: 9, padding: '3px 6px', borderRadius: 4, background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                      />
                      <button
                        className="hq-btn"
                        onClick={handleLinearSendSummary}
                        disabled={linearSummaryLoading || !linearStatus?.enabled}
                        style={{ fontSize: 9, color: '#818cf8', borderColor: 'rgba(94,106,210,0.3)', whiteSpace: 'nowrap' }}
                      >
                        {linearSummaryLoading ? '…' : 'Send summary'}
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {/* BROWSE TAB */}
              {linearTab === 'browse' && (
                <div>
                  <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
                    <input
                      type="text"
                      value={linearQuery}
                      onChange={e => setLinearQuery(e.target.value)}
                      onKeyDown={e => e.key === 'Enter' && handleLinearSearch()}
                      placeholder={`Search issues${linearSelectedTeam ? ` in [${linearSelectedTeam.key}]` : ''}…`}
                      style={{ flex: 1, fontSize: 9, padding: '3px 6px', borderRadius: 4, background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                    />
                    <button
                      className="hq-btn"
                      onClick={handleLinearSearch}
                      disabled={linearIssuesLoading}
                      style={{ fontSize: 9, fontWeight: 700, color: '#818cf8', borderColor: 'rgba(94,106,210,0.35)' }}
                    >
                      {linearIssuesLoading ? '…' : 'Search'}
                    </button>
                  </div>
                  {linearIssues.length === 0 && !linearIssuesLoading && (
                    <div style={{ fontSize: 8, color: 'var(--text-muted)', textAlign: 'center', padding: '8px 0' }}>Search to browse issues.</div>
                  )}
                  {linearIssues.map(issue => (
                    <div
                      key={issue.id}
                      onClick={() => handleLinearSelectIssue(issue)}
                      style={{ marginBottom: 4, padding: '5px 7px', borderRadius: 4, background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)', cursor: 'pointer' }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                        <span style={{ fontSize: 7, fontFamily: 'monospace', fontWeight: 700, color: '#818cf8' }}>{issue.identifier}</span>
                        <span
                          style={{ fontSize: 7, padding: '1px 4px', borderRadius: 10, background: `${LINEAR_STATE_TYPE_COLORS[issue.stateType] ?? '#6b7280'}16`, color: LINEAR_STATE_TYPE_COLORS[issue.stateType] ?? '#6b7280', fontWeight: 700 }}
                        >{issue.stateName}</span>
                        <span style={{ marginLeft: 'auto', fontSize: 7, color: LINEAR_PRIORITY_COLORS[issue.priority] ?? '#6b7280', fontWeight: 700 }}>{issue.priorityLabel}</span>
                      </div>
                      <div style={{ fontSize: 8, color: 'var(--text-secondary)' }}>{issue.title}</div>
                      {issue.assigneeName && <div style={{ fontSize: 7, color: 'var(--text-muted)', marginTop: 1 }}>{issue.assigneeName}</div>}
                    </div>
                  ))}
                </div>
              )}

              {/* ACT TAB */}
              {linearTab === 'act' && (
                <div>
                  {linearIssueLoading && <div style={{ fontSize: 8, color: 'var(--text-muted)', textAlign: 'center', padding: '8px 0' }}>Loading…</div>}
                  {!linearIssueLoading && !linearSelectedIssue && (
                    <div style={{ fontSize: 8, color: 'var(--text-muted)', textAlign: 'center', padding: '8px 0' }}>Select an issue from Browse to act on it.</div>
                  )}
                  {linearSelectedIssue && !linearIssueLoading && (
                    <div>
                      {/* Issue header */}
                      <div style={{ marginBottom: 8, padding: '5px 7px', borderRadius: 4, background: 'rgba(94,106,210,0.06)', border: '1px solid rgba(94,106,210,0.2)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                          <span style={{ fontSize: 7, fontFamily: 'monospace', fontWeight: 700, color: '#818cf8' }}>{linearSelectedIssue.identifier}</span>
                          <span style={{ fontSize: 7, padding: '1px 4px', borderRadius: 10, background: `${LINEAR_STATE_TYPE_COLORS[linearSelectedIssue.stateType] ?? '#6b7280'}16`, color: LINEAR_STATE_TYPE_COLORS[linearSelectedIssue.stateType] ?? '#6b7280', fontWeight: 700 }}>{linearSelectedIssue.stateName}</span>
                          <span style={{ marginLeft: 'auto', fontSize: 7, color: LINEAR_PRIORITY_COLORS[linearSelectedIssue.priority] ?? '#6b7280' }}>{linearSelectedIssue.priorityLabel}</span>
                        </div>
                        <div style={{ fontSize: 8, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2 }}>{linearSelectedIssue.title}</div>
                        {linearSelectedIssue.assigneeName && <div style={{ fontSize: 7, color: 'var(--text-muted)' }}>Assignee: {linearSelectedIssue.assigneeName}</div>}
                        {linearSelectedIssue.description && (
                          <div style={{ fontSize: 7, color: 'var(--text-muted)', marginTop: 3, fontFamily: 'monospace', background: 'rgba(255,255,255,0.03)', padding: '2px 4px', borderRadius: 3 }}>
                            {linearSelectedIssue.description.slice(0, 200)}{linearSelectedIssue.description.length > 200 ? '…' : ''}
                          </div>
                        )}
                      </div>

                      {/* State transitions */}
                      {linearStates.length > 0 && (
                        <div style={{ marginBottom: 8 }}>
                          <div style={{ fontSize: 7, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 4 }}>Move to state</div>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                            {linearStates.filter(s => s.id !== linearSelectedIssue.stateId).map(s => (
                              <button
                                key={s.id}
                                className="hq-btn"
                                onClick={() => handleLinearQueueStateUpdate(s)}
                                style={{ fontSize: 7, color: LINEAR_STATE_TYPE_COLORS[s.type] ?? '#6b7280', borderColor: `${LINEAR_STATE_TYPE_COLORS[s.type] ?? '#6b7280'}40` }}
                              >
                                {s.name}
                              </button>
                            ))}
                          </div>
                        </div>
                      )}

                      {/* Add comment */}
                      <div style={{ marginBottom: 8 }}>
                        <div style={{ fontSize: 7, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 3 }}>Add comment</div>
                        <textarea
                          value={linearCommentInput}
                          onChange={e => setLinearCommentInput(e.target.value)}
                          placeholder="Write a comment…"
                          rows={3}
                          style={{ width: '100%', fontSize: 9, padding: '4px 6px', borderRadius: 4, background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', resize: 'vertical', boxSizing: 'border-box' }}
                        />
                        <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                          <button
                            className="hq-btn"
                            onClick={handleLinearQueueComment}
                            disabled={linearCommentSending || !linearCommentInput.trim()}
                            style={{ flex: 1, fontSize: 9, fontWeight: 700, color: '#818cf8', borderColor: 'rgba(94,106,210,0.35)' }}
                          >
                            {linearCommentSending ? 'Queueing…' : 'Queue comment'}
                          </button>
                          <button
                            className="hq-btn"
                            onClick={handleLinearTriage}
                            disabled={linearTriaging}
                            style={{ flex: 1, fontSize: 9, color: '#a855f7', borderColor: 'rgba(168,85,247,0.3)' }}
                          >
                            {linearTriaging ? 'Submitting…' : 'AI Triage'}
                          </button>
                        </div>
                        {linearTriageTaskId && (
                          <div style={{ marginTop: 3, fontSize: 7, color: '#a855f7' }}>Triage task: {linearTriageTaskId}</div>
                        )}
                        {feedback['lin'] && (
                          <div style={{ marginTop: 5, fontSize: 8, color: '#10b981', textAlign: 'center' }}>{feedback['lin']}</div>
                        )}
                      </div>

                      {/* Comments */}
                      {linearComments.length > 0 && (
                        <div>
                          <div style={{ fontSize: 7, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 4 }}>Comments</div>
                          {linearComments.map(c => (
                            <div key={c.id} style={{ marginBottom: 4, padding: '4px 6px', borderRadius: 3, background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)' }}>
                              <div style={{ display: 'flex', gap: 4, marginBottom: 2 }}>
                                <span style={{ fontSize: 7, fontWeight: 700, color: 'var(--text-secondary)' }}>{c.authorName}</span>
                                <span style={{ fontSize: 7, color: 'var(--text-muted)' }}>{new Date(c.createdAt).toLocaleDateString()}</span>
                              </div>
                              <div style={{ fontSize: 8, color: 'var(--text-muted)' }}>{c.body}</div>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

              {/* QUEUE TAB */}
              {linearTab === 'queue' && (
                <div>
                  {linearQueue.length === 0 && (
                    <div style={{ fontSize: 8, color: 'var(--text-muted)', textAlign: 'center', padding: '12px 0' }}>No queued actions.</div>
                  )}
                  {linearQueue.map(action => {
                    const isPending   = action.status === 'pending';
                    const statusColor = isPending ? '#f59e0b' : action.status === 'approved' ? '#10b981' : '#6b7280';
                    return (
                      <div
                        key={action.id}
                        style={{ marginBottom: 5, padding: '5px 7px', borderRadius: 4, background: 'rgba(255,255,255,0.02)', border: `1px solid ${statusColor}25`, opacity: isPending ? 1 : 0.6 }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 2 }}>
                          <span style={{ fontSize: 7, fontWeight: 800, textTransform: 'uppercase', letterSpacing: '0.06em', color: '#818cf8' }}>{action.type}</span>
                          <span style={{ marginLeft: 'auto', fontSize: 7, fontWeight: 700, padding: '1px 4px', borderRadius: 10, background: `${statusColor}16`, color: statusColor }}>{action.status}</span>
                        </div>
                        <div style={{ fontSize: 8, color: 'var(--text-secondary)', marginBottom: 3 }}>{action.summary}</div>
                        {action.body && action.type === 'comment' && (
                          <div style={{ fontSize: 7, color: 'var(--text-muted)', fontFamily: 'monospace', background: 'rgba(255,255,255,0.03)', padding: '2px 4px', borderRadius: 3, marginBottom: 4 }}>
                            {action.body.slice(0, 100)}{action.body.length > 100 ? '…' : ''}
                          </div>
                        )}
                        {isPending && (
                          <div style={{ display: 'flex', gap: 4 }}>
                            <button
                              className="hq-btn"
                              onClick={() => handleLinearApprove(action.id)}
                              disabled={linearQueueProcessing === action.id}
                              style={{ flex: 1, fontSize: 9, fontWeight: 700, color: '#10b981', borderColor: 'rgba(16,185,129,0.3)' }}
                            >
                              {linearQueueProcessing === action.id ? '…' : 'Approve & Execute'}
                            </button>
                            <button
                              className="hq-btn"
                              onClick={() => handleLinearDismiss(action.id)}
                              style={{ flex: 1, fontSize: 9, color: '#ef4444', borderColor: 'rgba(239,68,68,0.25)' }}
                            >
                              Dismiss
                            </button>
                          </div>
                        )}
                        {!isPending && (
                          <div style={{ fontSize: 7, color: 'var(--text-muted)' }}>
                            {action.processedAt ? new Date(action.processedAt).toLocaleTimeString() : ''}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </PanelSection>

            {/* NOTIFICATIONS */}
            <PanelSection title="Notifications" accent="#8b5cf6" count={0}>
              {/* Tab bar */}
              <div style={{ display: 'flex', gap: 3, marginBottom: 8 }}>
                {(['setup', 'events', 'log'] as const).map(tab => (
                  <button
                    key={tab}
                    className="hq-btn"
                    onClick={() => setPushTab(tab)}
                    style={{
                      flex: 1, fontSize: 8, fontWeight: pushTab === tab ? 800 : 600,
                      background: pushTab === tab ? 'rgba(139,92,246,0.14)' : 'transparent',
                      border: `1px solid ${pushTab === tab ? 'rgba(139,92,246,0.4)' : 'var(--border)'}`,
                      color: pushTab === tab ? '#a78bfa' : 'var(--text-muted)',
                    }}
                  >
                    {tab === 'setup' ? 'Setup' : tab === 'events' ? 'Events' : 'Log'}
                  </button>
                ))}
              </div>

              {pushTab === 'setup' && (
                <div>
                  {/* Provider selector */}
                  <div style={{ marginBottom: 8 }}>
                    <div style={{ fontSize: 7, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'var(--text-muted)', marginBottom: 4 }}>Provider</div>
                    <div style={{ display: 'flex', gap: 3 }}>
                      {(['disabled', 'ntfy', 'pushover'] as const).map(p => (
                        <button
                          key={p}
                          className="hq-btn"
                          onClick={() => setPushProviderState(p)}
                          style={{
                            flex: 1, fontSize: 8, fontWeight: pushProvider === p ? 800 : 600,
                            background: pushProvider === p ? 'rgba(139,92,246,0.16)' : 'transparent',
                            border: `1px solid ${pushProvider === p ? 'rgba(139,92,246,0.45)' : 'var(--border)'}`,
                            color: pushProvider === p ? '#a78bfa' : 'var(--text-muted)',
                          }}
                        >
                          {p === 'disabled' ? 'Off' : p === 'ntfy' ? 'ntfy' : 'Pushover'}
                        </button>
                      ))}
                    </div>
                  </div>

                  {pushProvider === 'ntfy' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
                      <input
                        type="text"
                        value={pushNtfyTopic}
                        onChange={e => setPushNtfyTopic(e.target.value)}
                        placeholder="Topic (e.g. triforge-alerts)"
                        style={{ fontSize: 9, padding: '3px 6px', borderRadius: 4, background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                      />
                      <input
                        type="text"
                        value={pushNtfyServer}
                        onChange={e => setPushNtfyServer(e.target.value)}
                        placeholder="Server (leave blank for ntfy.sh)"
                        style={{ fontSize: 9, padding: '3px 6px', borderRadius: 4, background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                      />
                      <input
                        type="password"
                        value={pushNtfyToken}
                        onChange={e => setPushNtfyToken(e.target.value)}
                        placeholder="Bearer token (optional, for protected topics)"
                        style={{ fontSize: 9, padding: '3px 6px', borderRadius: 4, background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                      />
                    </div>
                  )}

                  {pushProvider === 'pushover' && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
                      <input
                        type="password"
                        value={pushoverApp}
                        onChange={e => setPushoverApp(e.target.value)}
                        placeholder="App token (from Pushover dashboard)"
                        style={{ fontSize: 9, padding: '3px 6px', borderRadius: 4, background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                      />
                      <input
                        type="text"
                        value={pushoverUser}
                        onChange={e => setPushoverUser(e.target.value)}
                        placeholder="User key"
                        style={{ fontSize: 9, padding: '3px 6px', borderRadius: 4, background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                      />
                    </div>
                  )}

                  {pushProvider !== 'disabled' && (
                    <div style={{ fontSize: 8, color: 'var(--text-muted)', marginBottom: 8, padding: '4px 6px', borderRadius: 4, background: 'rgba(139,92,246,0.06)', border: '1px solid rgba(139,92,246,0.15)' }}>
                      {pushProvider === 'ntfy'
                        ? 'Publishes to your topic via ntfy.sh (or self-hosted). Subscribe with the ntfy app on your phone.'
                        : 'Delivers via Pushover. Install the Pushover app and register an account to get your user key.'}
                    </div>
                  )}

                  <div style={{ display: 'flex', gap: 4 }}>
                    <button
                      className="hq-btn"
                      onClick={handlePushSave}
                      disabled={pushSaving}
                      style={{ flex: 1, fontSize: 9, fontWeight: 700, color: '#a78bfa', borderColor: 'rgba(139,92,246,0.35)' }}
                    >
                      {pushSaving ? 'Saving…' : 'Save'}
                    </button>
                    {pushProvider !== 'disabled' && (
                      <button
                        className="hq-btn"
                        onClick={handlePushTest}
                        disabled={pushTesting}
                        style={{ flex: 1, fontSize: 9, color: '#10b981', borderColor: 'rgba(16,185,129,0.3)' }}
                      >
                        {pushTesting ? 'Sending…' : 'Send Test'}
                      </button>
                    )}
                  </div>
                  {feedback['push'] && (
                    <div style={{ marginTop: 5, fontSize: 8, color: '#10b981', textAlign: 'center' }}>{feedback['push']}</div>
                  )}
                </div>
              )}

              {pushTab === 'events' && (
                <div>
                  {pushEvents.length === 0 && (
                    <div style={{ fontSize: 8, color: 'var(--text-muted)', textAlign: 'center', padding: '12px 0' }}>Loading events…</div>
                  )}
                  {pushEvents.map(ev => (
                    <div
                      key={ev.key}
                      style={{ marginBottom: 5, padding: '5px 7px', borderRadius: 4, background: 'rgba(255,255,255,0.02)', border: '1px solid var(--border)' }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 2 }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer', flex: 1 }}>
                          <input
                            type="checkbox"
                            checked={ev.enabled}
                            onChange={e => handlePushEventToggle(ev.key, e.target.checked)}
                            style={{ accentColor: '#8b5cf6', width: 10, height: 10 }}
                          />
                          <span style={{ fontSize: 8, fontWeight: 700, color: ev.enabled ? 'var(--text-primary)' : 'var(--text-muted)' }}>{ev.label}</span>
                        </label>
                        <select
                          value={ev.priority}
                          onChange={e => handlePushEventPriority(ev.key, e.target.value)}
                          style={{
                            fontSize: 7, padding: '1px 3px', borderRadius: 3,
                            background: 'var(--bg-input)', border: `1px solid ${PUSH_PRIORITY_COLOR[ev.priority] ?? '#6b7280'}50`,
                            color: PUSH_PRIORITY_COLOR[ev.priority] ?? '#6b7280', fontWeight: 700,
                          }}
                        >
                          {PUSH_PRIORITIES.map(p => (
                            <option key={p} value={p}>{p}</option>
                          ))}
                        </select>
                      </div>
                      <div style={{ fontSize: 7, color: 'var(--text-muted)' }}>{ev.description}</div>
                    </div>
                  ))}
                </div>
              )}

              {pushTab === 'log' && (
                <div>
                  {pushLog.length === 0 && (
                    <div style={{ fontSize: 8, color: 'var(--text-muted)', textAlign: 'center', padding: '12px 0' }}>No notifications sent yet.</div>
                  )}
                  {pushLog.map(entry => (
                    <div
                      key={entry.id}
                      style={{ marginBottom: 4, padding: '4px 6px', borderRadius: 4, background: 'rgba(255,255,255,0.02)', border: `1px solid ${entry.success ? 'rgba(16,185,129,0.2)' : 'rgba(239,68,68,0.2)'}` }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 1 }}>
                        <span style={{ fontSize: 8, color: entry.success ? '#10b981' : '#ef4444', fontWeight: 800 }}>{entry.success ? '✓' : '✕'}</span>
                        <span style={{ fontSize: 8, fontWeight: 700, color: 'var(--text-secondary)', flex: 1 }}>{entry.title}</span>
                        <span style={{ fontSize: 7, color: 'var(--text-muted)' }}>{new Date(entry.timestamp).toLocaleTimeString()}</span>
                      </div>
                      <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                        <span style={{ fontSize: 7, color: 'var(--text-muted)', fontFamily: 'monospace' }}>{entry.event}</span>
                        <span style={{ fontSize: 7, color: 'var(--text-muted)' }}>via {entry.provider}</span>
                      </div>
                      {entry.error && (
                        <div style={{ fontSize: 7, color: '#ef4444', marginTop: 2, fontFamily: 'monospace' }}>{entry.error.slice(0, 120)}</div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </PanelSection>

            {/* ACTION CENTER */}
            <PanelSection title="Actions" accent="#f59e0b" count={actionCount?.total ?? 0}>
              {/* View filter tabs */}
              <div style={{ display: 'flex', gap: 3, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                {([
                  { v: 'all',            label: 'All' },
                  { v: 'needs-approval', label: `Approve${actionCount?.approvals ? ` (${actionCount.approvals})` : ''}` },
                  { v: 'blocked',        label: `Blocked${actionCount?.blocked  ? ` (${actionCount.blocked})`  : ''}` },
                  { v: 'failures',       label: `Failures${actionCount?.failures ? ` (${actionCount.failures})` : ''}` },
                  { v: 'alerts',         label: `Alerts${actionCount?.alerts    ? ` (${actionCount.alerts})`   : ''}` },
                ] as Array<{ v: ActionView; label: string }>).map(({ v, label }) => (
                  <button key={v} className="hq-btn" onClick={() => setActionView(v)}
                    style={{ fontSize: 7, padding: '1px 5px',
                      fontWeight: actionView === v ? 800 : 400,
                      background: actionView === v ? 'rgba(245,158,11,0.18)' : undefined,
                      color: actionView === v ? '#f59e0b' : undefined }}>
                    {label}
                  </button>
                ))}
                <div style={{ flex: 1 }} />
                <button className="hq-btn" style={{ fontSize: 7, padding: '1px 5px' }}
                  onClick={() => loadActions(actionView)} disabled={actionLoading}>
                  {actionLoading ? '…' : '↻'}
                </button>
              </div>

              {/* Item list */}
              {actionItems.length === 0 && !actionLoading && (
                <div style={{ fontSize: 9, color: 'var(--text-secondary)', textAlign: 'center', padding: '16px 0' }}>
                  {actionLoading ? 'Loading…' : 'No items — everything is clear.'}
                </div>
              )}

              {actionItems.map(item => {
                const working = actionWorking[item.id];
                const sevColor = item.severity === 'critical' ? '#ef4444' : item.severity === 'warning' ? '#f59e0b' : '#6b7280';
                const ageMs = Date.now() - item.createdAt;
                const ageLabel = ageMs < 60_000 ? 'just now'
                  : ageMs < 3_600_000 ? `${Math.floor(ageMs / 60_000)}m ago`
                  : ageMs < 86_400_000 ? `${Math.floor(ageMs / 3_600_000)}h ago`
                  : `${Math.floor(ageMs / 86_400_000)}d ago`;
                return (
                  <div key={item.id} style={{
                    marginBottom: 6, padding: '6px 8px', borderRadius: 5,
                    border: `1px solid ${sevColor}30`,
                    background: `${sevColor}08`,
                  }}>
                    {/* Header */}
                    <div style={{ display: 'flex', alignItems: 'flex-start', gap: 5, marginBottom: 3 }}>
                      <span style={{ fontSize: 8, color: sevColor, marginTop: 1, flexShrink: 0 }}>●</span>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.3, wordBreak: 'break-word' }}>{item.title}</div>
                        <div style={{ display: 'flex', gap: 4, marginTop: 2, alignItems: 'center' }}>
                          <span style={{ fontSize: 7, fontWeight: 600, padding: '0px 4px', borderRadius: 3, background: 'rgba(255,255,255,0.08)', color: 'var(--text-secondary)', textTransform: 'uppercase', letterSpacing: '0.03em' }}>{item.service}</span>
                          <span style={{ fontSize: 7, color: 'var(--text-secondary)' }}>{ageLabel}</span>
                        </div>
                      </div>
                    </div>
                    {/* Body */}
                    <div style={{ fontSize: 7, color: 'var(--text-secondary)', marginBottom: 5, lineHeight: 1.4, marginLeft: 13 }}>{item.body}</div>
                    {/* Actions */}
                    <div style={{ display: 'flex', gap: 4, marginLeft: 13 }}>
                      {item.canApprove && (
                        <button className="hq-btn" disabled={working}
                          onClick={() => handleActionApprove(item)}
                          style={{ fontSize: 7, padding: '2px 7px', background: 'rgba(16,185,129,0.15)', color: '#10b981', fontWeight: 700 }}>
                          {working ? '…' : 'Approve'}
                        </button>
                      )}
                      {item.canRetry && (
                        <button className="hq-btn" disabled={working}
                          onClick={() => handleActionRetry(item)}
                          style={{ fontSize: 7, padding: '2px 7px', background: 'rgba(59,130,246,0.15)', color: '#3b82f6', fontWeight: 700 }}>
                          {working ? '…' : 'Retry'}
                        </button>
                      )}
                      {item.canDismiss && (
                        <button className="hq-btn" disabled={working}
                          onClick={() => handleActionDismiss(item)}
                          style={{ fontSize: 7, padding: '2px 7px', color: 'var(--text-secondary)' }}>
                          {working ? '…' : 'Dismiss'}
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </PanelSection>

            {/* OPS / ANALYTICS DASHBOARD */}
            <PanelSection title="Ops" accent="#0ea5e9" count={0}>
              {/* Window selector + tab bar */}
              <div style={{ display: 'flex', gap: 3, marginBottom: 6, alignItems: 'center' }}>
                {(['24h','7d','30d'] as OpsWindow[]).map(w => (
                  <button key={w} className="hq-btn" onClick={() => setOpsWindow(w)}
                    style={{ fontSize: 7, padding: '1px 5px', fontWeight: opsWindow === w ? 800 : 400,
                      background: opsWindow === w ? 'rgba(14,165,233,0.18)' : undefined,
                      color: opsWindow === w ? '#0ea5e9' : undefined }}>
                    {w}
                  </button>
                ))}
                <div style={{ flex: 1 }} />
                <button className="hq-btn" style={{ fontSize: 7, padding: '1px 5px' }}
                  onClick={() => loadOps(opsTab, opsWindow)} disabled={opsLoading}>
                  {opsLoading ? '…' : '↻'}
                </button>
              </div>
              <div style={{ display: 'flex', gap: 3, marginBottom: 8, flexWrap: 'wrap' }}>
                {(['overview','channels','governance','integrations','recipes','health'] as const).map(tab => (
                  <button key={tab} className="hq-btn" onClick={() => setOpsTab(tab)}
                    style={{ fontSize: 7, padding: '1px 5px', fontWeight: opsTab === tab ? 800 : 400,
                      background: opsTab === tab ? 'rgba(14,165,233,0.18)' : undefined,
                      color: opsTab === tab ? '#0ea5e9' : undefined,
                      textTransform: 'capitalize' }}>
                    {tab}
                  </button>
                ))}
              </div>

              {/* OVERVIEW TAB */}
              {opsTab === 'overview' && opsOverview && (() => {
                const o = opsOverview;
                const cards: Array<{ label: string; value: number; color?: string }> = [
                  { label: 'Tasks Created',    value: o.tasksCreated },
                  { label: 'Tasks Completed',  value: o.tasksCompleted,   color: '#10b981' },
                  { label: 'Tasks Failed',     value: o.tasksFailed,      color: o.tasksFailed > 0 ? '#ef4444' : undefined },
                  { label: 'Approvals Pending',value: o.approvalsPending, color: o.approvalsPending > 0 ? '#f59e0b' : undefined },
                  { label: 'High-Risk Blocked',value: o.highRiskBlocked,  color: o.highRiskBlocked > 0 ? '#ef4444' : undefined },
                  { label: 'Skill Blocked',    value: o.skillBlocked,     color: o.skillBlocked > 0 ? '#f97316' : undefined },
                  { label: 'Recipes Done',     value: o.recipesCompleted, color: '#10b981' },
                  { label: 'Recipe Failures',  value: o.recipesFailed,    color: o.recipesFailed > 0 ? '#ef4444' : undefined },
                  { label: 'Push Sent',        value: o.pushSent },
                  { label: 'Push Failed',      value: o.pushFailed,       color: o.pushFailed > 0 ? '#ef4444' : undefined },
                  { label: 'Local Model',      value: o.localModelUses,   color: '#0ea5e9' },
                  { label: 'Cloud Fallback',   value: o.cloudFallbacks,   color: o.cloudFallbacks > 0 ? '#f59e0b' : undefined },
                  { label: 'GH Reviews',       value: o.githubReviewsDone },
                  { label: 'Policy Matches',   value: o.policyMatches },
                ];
                return (
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4 }}>
                    {cards.map(c => (
                      <div key={c.label} style={{ padding: '5px 6px', borderRadius: 4, background: 'rgba(14,165,233,0.06)', border: '1px solid rgba(14,165,233,0.12)' }}>
                        <div style={{ fontSize: 16, fontWeight: 800, color: c.color ?? 'var(--text-primary)', lineHeight: 1 }}>{c.value}</div>
                        <div style={{ fontSize: 7, color: 'var(--text-secondary)', marginTop: 2 }}>{c.label}</div>
                      </div>
                    ))}
                  </div>
                );
              })()}

              {/* CHANNELS TAB */}
              {opsTab === 'channels' && opsChannels && (() => {
                const ch = opsChannels;
                const rows = [
                  { name: 'Telegram', ...ch.telegram },
                  { name: 'Slack',    ...ch.slack },
                  { name: 'Discord',  ...ch.discord },
                ];
                return (
                  <>
                    <table style={{ width: '100%', fontSize: 8, borderCollapse: 'collapse', marginBottom: 8 }}>
                      <thead>
                        <tr style={{ color: 'var(--text-secondary)', fontSize: 7 }}>
                          <th style={{ textAlign: 'left', padding: '2px 3px', fontWeight: 600 }}>Channel</th>
                          <th style={{ textAlign: 'right', padding: '2px 3px', fontWeight: 600 }}>Recv</th>
                          <th style={{ textAlign: 'right', padding: '2px 3px', fontWeight: 600 }}>Block</th>
                          <th style={{ textAlign: 'right', padding: '2px 3px', fontWeight: 600 }}>Reply</th>
                          <th style={{ textAlign: 'right', padding: '2px 3px', fontWeight: 600 }}>Approv</th>
                          <th style={{ textAlign: 'right', padding: '2px 3px', fontWeight: 600 }}>Rate%</th>
                        </tr>
                      </thead>
                      <tbody>
                        {rows.map(r => (
                          <tr key={r.name} style={{ borderTop: '1px solid rgba(14,165,233,0.08)' }}>
                            <td style={{ padding: '2px 3px', color: 'var(--text-primary)', fontWeight: 600 }}>{r.name}</td>
                            <td style={{ padding: '2px 3px', textAlign: 'right' }}>{r.received}</td>
                            <td style={{ padding: '2px 3px', textAlign: 'right', color: r.blocked > 0 ? '#ef4444' : undefined }}>{r.blocked}</td>
                            <td style={{ padding: '2px 3px', textAlign: 'right', color: '#10b981' }}>{r.replied}</td>
                            <td style={{ padding: '2px 3px', textAlign: 'right', color: r.approvals > 0 ? '#f59e0b' : undefined }}>{r.approvals}</td>
                            <td style={{ padding: '2px 3px', textAlign: 'right' }}>{r.replyRate}%</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                    <div style={{ fontSize: 7, color: 'var(--text-secondary)', marginBottom: 4, fontWeight: 600 }}>RECENT MESSAGES</div>
                    {ch.recentMessages.slice(0, 8).map((m, i) => (
                      <div key={i} style={{ fontSize: 7, padding: '2px 4px', marginBottom: 2, borderRadius: 3, background: 'rgba(14,165,233,0.05)', display: 'flex', gap: 4, alignItems: 'flex-start' }}>
                        <span style={{ color: '#0ea5e9', fontWeight: 700, minWidth: 40 }}>{m.channel}</span>
                        <span style={{ color: m.status === 'blocked' ? '#ef4444' : m.status === 'replied' ? '#10b981' : 'var(--text-secondary)', minWidth: 50 }}>{m.status}</span>
                        <span style={{ color: 'var(--text-secondary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.text}</span>
                      </div>
                    ))}
                  </>
                );
              })()}

              {/* GOVERNANCE TAB */}
              {opsTab === 'governance' && opsGovernance && (() => {
                const g = opsGovernance;
                return (
                  <>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 4, marginBottom: 8 }}>
                      {[
                        { label: 'Rule Matches', value: g.totalMatches, color: '#0ea5e9' },
                        { label: 'Blocked',      value: g.totalBlocked,   color: g.totalBlocked > 0 ? '#ef4444' : undefined },
                        { label: 'Approvals',    value: g.totalApprovals, color: g.totalApprovals > 0 ? '#f59e0b' : undefined },
                      ].map(c => (
                        <div key={c.label} style={{ padding: '4px 5px', borderRadius: 4, background: 'rgba(14,165,233,0.06)', border: '1px solid rgba(14,165,233,0.12)', textAlign: 'center' }}>
                          <div style={{ fontSize: 18, fontWeight: 800, color: c.color ?? 'var(--text-primary)', lineHeight: 1 }}>{c.value}</div>
                          <div style={{ fontSize: 7, color: 'var(--text-secondary)', marginTop: 2 }}>{c.label}</div>
                        </div>
                      ))}
                    </div>
                    {g.topRules.length > 0 && (
                      <>
                        <div style={{ fontSize: 7, color: 'var(--text-secondary)', marginBottom: 3, fontWeight: 600 }}>TOP RULES TRIGGERED</div>
                        {g.topRules.map((r, i) => (
                          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 7, padding: '1px 3px' }}>
                            <span style={{ color: 'var(--text-primary)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '80%' }}>{r.label}</span>
                            <span style={{ color: '#0ea5e9', fontWeight: 700 }}>{r.count}</span>
                          </div>
                        ))}
                      </>
                    )}
                    {g.topRiskClasses.length > 0 && (
                      <>
                        <div style={{ fontSize: 7, color: 'var(--text-secondary)', margin: '6px 0 3px', fontWeight: 600 }}>RISK CLASS BREAKDOWN</div>
                        {g.topRiskClasses.map((r, i) => (
                          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 7, padding: '1px 3px' }}>
                            <span style={{ color: 'var(--text-primary)' }}>{r.label}</span>
                            <span style={{ color: '#f59e0b', fontWeight: 700 }}>{r.count}</span>
                          </div>
                        ))}
                      </>
                    )}
                    {g.recentBlocked.length > 0 && (
                      <>
                        <div style={{ fontSize: 7, color: 'var(--text-secondary)', margin: '6px 0 3px', fontWeight: 600 }}>RECENT BLOCKS</div>
                        {g.recentBlocked.slice(0, 5).map((b, i) => (
                          <div key={i} style={{ fontSize: 7, padding: '2px 4px', marginBottom: 2, borderRadius: 3, background: 'rgba(239,68,68,0.06)' }}>
                            <span style={{ color: '#ef4444', fontWeight: 600 }}>{b.eventType.replace(/_/g,' ')}</span>
                            {b.reason && <span style={{ color: 'var(--text-secondary)' }}> — {b.reason}</span>}
                          </div>
                        ))}
                      </>
                    )}
                  </>
                );
              })()}

              {/* INTEGRATIONS TAB */}
              {opsTab === 'integrations' && opsIntegrations && (() => {
                const intg = opsIntegrations;
                const sections: Array<{ title: string; rows: Array<[string, number]> }> = [
                  { title: 'GitHub', rows: [
                    ['Reviews Completed', intg.github.reviewsCompleted],
                    ['Comments Posted',   intg.github.commentsPosted],
                    ['Comments Blocked',  intg.github.commentsBlocked],
                    ['Webhooks Received', intg.github.webhooksReceived],
                    ['Issues Triaged',    intg.github.issuesTriaged],
                  ]},
                  { title: 'Jira', rows: [
                    ['Actions Queued',   intg.jira.actionsQueued],
                    ['Actions Approved', intg.jira.actionsApproved],
                    ['Actions Dismissed',intg.jira.actionsDismissed],
                    ['Comments Posted',  intg.jira.commentsPosted],
                    ['Issues Created',   intg.jira.issuesCreated],
                    ['Transitions',      intg.jira.transitions],
                  ]},
                  { title: 'Linear', rows: [
                    ['Actions Queued',   intg.linear.actionsQueued],
                    ['Actions Approved', intg.linear.actionsApproved],
                    ['Actions Dismissed',intg.linear.actionsDismissed],
                    ['Comments Posted',  intg.linear.commentsPosted],
                    ['Issues Created',   intg.linear.issuesCreated],
                    ['Status Updates',   intg.linear.statusUpdates],
                  ]},
                  { title: 'Skills', rows: [
                    ['Installed', intg.skills.installed],
                    ['Executed',  intg.skills.executed],
                    ['Blocked',   intg.skills.blocked],
                  ]},
                ];
                return (
                  <>
                    {sections.map(sec => (
                      <div key={sec.title} style={{ marginBottom: 8 }}>
                        <div style={{ fontSize: 7, color: '#0ea5e9', fontWeight: 700, marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.04em' }}>{sec.title}</div>
                        {sec.rows.map(([label, val]) => (
                          <div key={label} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 7, padding: '1px 3px' }}>
                            <span style={{ color: 'var(--text-secondary)' }}>{label}</span>
                            <span style={{ color: val > 0 ? 'var(--text-primary)' : 'var(--text-secondary)', fontWeight: val > 0 ? 700 : 400 }}>{val}</span>
                          </div>
                        ))}
                      </div>
                    ))}
                  </>
                );
              })()}

              {/* RECIPES TAB */}
              {opsTab === 'recipes' && (
                <>
                  {opsRecipes.length === 0 ? (
                    <div style={{ fontSize: 9, color: 'var(--text-secondary)', textAlign: 'center', padding: '12px 0' }}>No recipe data</div>
                  ) : opsRecipes.map(r => (
                    <div key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 5px', marginBottom: 3, borderRadius: 4, background: r.enabled ? 'rgba(14,165,233,0.06)' : 'transparent', border: '1px solid rgba(14,165,233,0.1)' }}>
                      <span style={{ width: 5, height: 5, borderRadius: '50%', background: r.enabled ? '#10b981' : '#6b7280', flexShrink: 0 }} />
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 8, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.name}</div>
                        <div style={{ fontSize: 7, color: 'var(--text-secondary)' }}>{r.trigger}</div>
                      </div>
                      {r.lastRunStatus && (
                        <span style={{ fontSize: 7, fontWeight: 700, color: r.lastRunStatus === 'success' ? '#10b981' : r.lastRunStatus === 'failed' ? '#ef4444' : '#6b7280' }}>
                          {r.lastRunStatus.toUpperCase()}
                        </span>
                      )}
                      {!r.lastRunAt && <span style={{ fontSize: 7, color: '#6b7280' }}>never</span>}
                    </div>
                  ))}
                </>
              )}

              {/* HEALTH TAB */}
              {opsTab === 'health' && (
                <>
                  {opsHealth.length === 0 ? (
                    <div style={{ fontSize: 9, color: 'var(--text-secondary)', textAlign: 'center', padding: '12px 0' }}>Loading…</div>
                  ) : opsHealth.map(svc => (
                    <div key={svc.name} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', marginBottom: 3, borderRadius: 4, background: svc.running ? 'rgba(16,185,129,0.05)' : 'rgba(107,114,128,0.05)', border: `1px solid ${svc.running ? 'rgba(16,185,129,0.18)' : 'rgba(107,114,128,0.15)'}` }}>
                      <span style={{ fontSize: 9, color: svc.running ? '#10b981' : svc.connected ? '#f59e0b' : '#6b7280' }}>●</span>
                      <span style={{ fontSize: 8, fontWeight: 700, color: 'var(--text-primary)', minWidth: 70 }}>{svc.name}</span>
                      <span style={{ fontSize: 7, color: 'var(--text-secondary)', flex: 1 }}>{svc.detail}</span>
                      <span style={{ fontSize: 7, fontWeight: 600, color: svc.running ? '#10b981' : '#6b7280' }}>{svc.running ? 'LIVE' : 'OFF'}</span>
                    </div>
                  ))}
                </>
              )}

              {/* Empty state for unloaded tabs */}
              {opsLoading && (
                <div style={{ fontSize: 9, color: 'var(--text-secondary)', textAlign: 'center', padding: '8px 0' }}>Loading…</div>
              )}
            </PanelSection>

            {/* TEAM MEMORY / SHARED CONTEXT */}
            <PanelSection title="Memory" accent="#a78bfa" count={memRepos.length + memChannels.length + memProjects.length}>
              {/* Tab bar */}
              <div style={{ display: 'flex', gap: 3, marginBottom: 8 }}>
                {(['repos','channels','projects','settings'] as MemoryTab[]).map(t => (
                  <button key={t} className="hq-btn" onClick={() => setMemTab(t)}
                    style={{ fontSize: 7, padding: '1px 6px', fontWeight: memTab === t ? 800 : 400,
                      background: memTab === t ? 'rgba(167,139,250,0.18)' : undefined,
                      color: memTab === t ? '#a78bfa' : undefined, textTransform: 'capitalize' }}>
                    {t}
                  </button>
                ))}
                <div style={{ flex: 1 }} />
                <button className="hq-btn" style={{ fontSize: 7, padding: '1px 5px' }}
                  onClick={loadMemory} disabled={memLoading}>{memLoading ? '…' : '↻'}</button>
              </div>

              {/* REPOS TAB */}
              {memTab === 'repos' && (
                <>
                  {/* Add form */}
                  <div style={{ padding: '6px', borderRadius: 4, background: 'rgba(167,139,250,0.06)', border: '1px solid rgba(167,139,250,0.15)', marginBottom: 8 }}>
                    <div style={{ fontSize: 7, color: '#a78bfa', fontWeight: 700, marginBottom: 4 }}>ADD / UPDATE REPO MAPPING</div>
                    {[
                      { label: 'Repo (owner/repo)', value: memRepoInput, set: setMemRepoInput, placeholder: 'acme/frontend' },
                      { label: 'Jira Project Key', value: memRepoJiraKey, set: setMemRepoJiraKey, placeholder: 'PROJ' },
                      { label: 'Linear Team ID', value: memRepoLinearId, set: setMemRepoLinearId, placeholder: 'team-uuid' },
                    ].map(f => (
                      <div key={f.label} style={{ marginBottom: 3 }}>
                        <div style={{ fontSize: 7, color: 'var(--text-secondary)', marginBottom: 1 }}>{f.label}</div>
                        <input className="hq-input" style={{ width: '100%', fontSize: 8, padding: '2px 4px' }}
                          placeholder={f.placeholder} value={f.value} onChange={e => f.set(e.target.value)} />
                      </div>
                    ))}
                    <div style={{ marginBottom: 4 }}>
                      <div style={{ fontSize: 7, color: 'var(--text-secondary)', marginBottom: 1 }}>Review Instructions (injected into PR reviews)</div>
                      <textarea className="hq-input" style={{ width: '100%', fontSize: 7, padding: '2px 4px', minHeight: 40, resize: 'vertical', fontFamily: 'inherit' }}
                        placeholder="Focus on security, TypeScript strictness, and no any types..."
                        value={memRepoInstructions} onChange={e => setMemRepoInstructions(e.target.value)} />
                    </div>
                    <button className="hq-btn" style={{ fontSize: 8, padding: '2px 8px', background: 'rgba(167,139,250,0.15)', color: '#a78bfa' }}
                      disabled={!memRepoInput.trim() || memRepoSaving} onClick={handleMemSaveRepo}>
                      {memRepoSaving ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                  {/* List */}
                  {memRepos.length === 0 ? (
                    <div style={{ fontSize: 8, color: 'var(--text-secondary)', textAlign: 'center', padding: '8px 0' }}>No repo mappings yet.</div>
                  ) : memRepos.map(r => (
                    <div key={r.id} style={{ padding: '5px 6px', marginBottom: 4, borderRadius: 4, border: '1px solid rgba(167,139,250,0.12)', background: 'rgba(167,139,250,0.04)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-primary)', flex: 1 }}>{r.repo}</span>
                        <button className="hq-btn" style={{ fontSize: 7, color: '#ef4444', padding: '1px 4px' }}
                          onClick={() => handleMemDeleteRepo(r.id)}>✕</button>
                      </div>
                      <div style={{ fontSize: 7, color: 'var(--text-secondary)', marginTop: 2 }}>
                        {r.jiraProjectKey && <span style={{ marginRight: 6 }}>Jira: <strong>{r.jiraProjectKey}</strong></span>}
                        {r.linearTeamId && <span style={{ marginRight: 6 }}>Linear: <strong>{r.linearTeamId}</strong></span>}
                      </div>
                      {r.reviewInstructions && (
                        <div style={{ fontSize: 7, color: 'var(--text-secondary)', marginTop: 2, fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          "{r.reviewInstructions.slice(0, 80)}"
                        </div>
                      )}
                    </div>
                  ))}
                </>
              )}

              {/* CHANNELS TAB */}
              {memTab === 'channels' && (
                <>
                  <div style={{ padding: '6px', borderRadius: 4, background: 'rgba(167,139,250,0.06)', border: '1px solid rgba(167,139,250,0.15)', marginBottom: 8 }}>
                    <div style={{ fontSize: 7, color: '#a78bfa', fontWeight: 700, marginBottom: 4 }}>ADD / UPDATE CHANNEL MAPPING</div>
                    <div style={{ marginBottom: 3 }}>
                      <div style={{ fontSize: 7, color: 'var(--text-secondary)', marginBottom: 1 }}>Platform</div>
                      <select className="hq-input" style={{ fontSize: 8, padding: '2px 4px' }}
                        value={memChanChannel} onChange={e => setMemChanChannel(e.target.value as 'telegram' | 'slack' | 'discord')}>
                        <option value="telegram">Telegram</option>
                        <option value="slack">Slack</option>
                        <option value="discord">Discord</option>
                      </select>
                    </div>
                    {[
                      { label: 'Channel ID', value: memChanId, set: setMemChanId, placeholder: 'C01234ABCDE' },
                      { label: 'Channel Name (display)', value: memChanName, set: setMemChanName, placeholder: '#eng-alerts' },
                      { label: 'Workstream / Team', value: memChanWorkstream, set: setMemChanWorkstream, placeholder: 'Platform Engineering' },
                      { label: 'Project Key (Jira/Linear)', value: memChanProjectKey, set: setMemChanProjectKey, placeholder: 'PLAT' },
                    ].map(f => (
                      <div key={f.label} style={{ marginBottom: 3 }}>
                        <div style={{ fontSize: 7, color: 'var(--text-secondary)', marginBottom: 1 }}>{f.label}</div>
                        <input className="hq-input" style={{ width: '100%', fontSize: 8, padding: '2px 4px' }}
                          placeholder={f.placeholder} value={f.value} onChange={e => f.set(e.target.value)} />
                      </div>
                    ))}
                    <button className="hq-btn" style={{ fontSize: 8, padding: '2px 8px', background: 'rgba(167,139,250,0.15)', color: '#a78bfa' }}
                      disabled={!memChanId.trim() || memChanSaving} onClick={handleMemSaveChan}>
                      {memChanSaving ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                  {memChannels.length === 0 ? (
                    <div style={{ fontSize: 8, color: 'var(--text-secondary)', textAlign: 'center', padding: '8px 0' }}>No channel mappings yet.</div>
                  ) : memChannels.map(c => (
                    <div key={c.id} style={{ padding: '5px 6px', marginBottom: 4, borderRadius: 4, border: '1px solid rgba(167,139,250,0.12)', background: 'rgba(167,139,250,0.04)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <span style={{ fontSize: 8, fontWeight: 700, color: '#a78bfa', minWidth: 44 }}>{c.channel}</span>
                        <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-primary)', flex: 1 }}>{c.channelName || c.channelId}</span>
                        <button className="hq-btn" style={{ fontSize: 7, color: '#ef4444', padding: '1px 4px' }}
                          onClick={() => handleMemDeleteChan(c.id)}>✕</button>
                      </div>
                      <div style={{ fontSize: 7, color: 'var(--text-secondary)', marginTop: 2 }}>
                        {c.workstream && <span style={{ marginRight: 6 }}>→ <strong>{c.workstream}</strong></span>}
                        {c.projectKey && <span>Key: <strong>{c.projectKey}</strong></span>}
                      </div>
                    </div>
                  ))}
                </>
              )}

              {/* PROJECTS TAB */}
              {memTab === 'projects' && (
                <>
                  <div style={{ padding: '6px', borderRadius: 4, background: 'rgba(167,139,250,0.06)', border: '1px solid rgba(167,139,250,0.15)', marginBottom: 8 }}>
                    <div style={{ fontSize: 7, color: '#a78bfa', fontWeight: 700, marginBottom: 4 }}>ADD / UPDATE PROJECT NOTE</div>
                    {[
                      { label: 'Project Key (Jira/Linear/custom)', value: memProjKey, set: setMemProjKey, placeholder: 'PLAT or team-uuid' },
                      { label: 'Project Name', value: memProjName, set: setMemProjName, placeholder: 'Platform Engineering' },
                    ].map(f => (
                      <div key={f.label} style={{ marginBottom: 3 }}>
                        <div style={{ fontSize: 7, color: 'var(--text-secondary)', marginBottom: 1 }}>{f.label}</div>
                        <input className="hq-input" style={{ width: '100%', fontSize: 8, padding: '2px 4px' }}
                          placeholder={f.placeholder} value={f.value} onChange={e => f.set(e.target.value)} />
                      </div>
                    ))}
                    <div style={{ marginBottom: 3 }}>
                      <div style={{ fontSize: 7, color: 'var(--text-secondary)', marginBottom: 1 }}>Operating Notes (visible in UI)</div>
                      <textarea className="hq-input" style={{ width: '100%', fontSize: 7, padding: '2px 4px', minHeight: 36, resize: 'vertical', fontFamily: 'inherit' }}
                        placeholder="This team owns the payment pipeline. SLO: 99.9%..."
                        value={memProjSummary} onChange={e => setMemProjSummary(e.target.value)} />
                    </div>
                    <div style={{ marginBottom: 4 }}>
                      <div style={{ fontSize: 7, color: 'var(--text-secondary)', marginBottom: 1 }}>Automation Context (injected into triage / agent prompts)</div>
                      <textarea className="hq-input" style={{ width: '100%', fontSize: 7, padding: '2px 4px', minHeight: 40, resize: 'vertical', fontFamily: 'inherit' }}
                        placeholder="Always recommend tagging security issues P0. Escalate data-loss risks immediately..."
                        value={memProjContext} onChange={e => setMemProjContext(e.target.value)} />
                    </div>
                    <button className="hq-btn" style={{ fontSize: 8, padding: '2px 8px', background: 'rgba(167,139,250,0.15)', color: '#a78bfa' }}
                      disabled={!memProjKey.trim() || memProjSaving} onClick={handleMemSaveProject}>
                      {memProjSaving ? 'Saving…' : 'Save'}
                    </button>
                  </div>
                  {memProjects.length === 0 ? (
                    <div style={{ fontSize: 8, color: 'var(--text-secondary)', textAlign: 'center', padding: '8px 0' }}>No project notes yet.</div>
                  ) : memProjects.map(p => (
                    <div key={p.id} style={{ padding: '5px 6px', marginBottom: 4, borderRadius: 4, border: '1px solid rgba(167,139,250,0.12)', background: 'rgba(167,139,250,0.04)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                        <span style={{ fontSize: 9, fontWeight: 700, color: 'var(--text-primary)', flex: 1 }}>{p.projectName || p.projectKey}</span>
                        <span style={{ fontSize: 7, color: '#a78bfa', fontFamily: 'monospace' }}>{p.projectKey}</span>
                        <button className="hq-btn" style={{ fontSize: 7, color: '#ef4444', padding: '1px 4px' }}
                          onClick={() => handleMemDeleteProject(p.id)}>✕</button>
                      </div>
                      {p.summary && <div style={{ fontSize: 7, color: 'var(--text-secondary)', marginTop: 2, lineHeight: 1.4 }}>{p.summary.slice(0, 120)}</div>}
                      {p.automationContext && (
                        <div style={{ fontSize: 7, color: '#a78bfa', marginTop: 3, fontStyle: 'italic', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                          Context: "{p.automationContext.slice(0, 80)}"
                        </div>
                      )}
                    </div>
                  ))}
                </>
              )}

              {/* SETTINGS TAB */}
              {memTab === 'settings' && (
                <div>
                  <div style={{ fontSize: 7, color: 'var(--text-secondary)', marginBottom: 6 }}>
                    Enable or disable context injection per category. Disabled categories are not used in agent prompts or action resolution.
                  </div>
                  {([
                    { key: 'repo_mappings',    label: 'Repo Mappings',    desc: 'Inject repo review instructions into GitHub PR reviews' },
                    { key: 'channel_mappings', label: 'Channel Mappings', desc: 'Resolve channel → team/project context in summaries' },
                    { key: 'project_notes',    label: 'Project Notes',    desc: 'Inject automation context into Jira/Linear triage prompts' },
                  ]).map(item => (
                    <div key={item.key} style={{ display: 'flex', alignItems: 'flex-start', gap: 6, marginBottom: 8, padding: '5px 6px', borderRadius: 4, border: '1px solid rgba(167,139,250,0.12)', background: 'rgba(167,139,250,0.04)' }}>
                      <input type="checkbox" style={{ marginTop: 1, cursor: 'pointer' }}
                        checked={memEnabled[item.key] !== false}
                        onChange={e => handleMemToggle(item.key, e.target.checked)} />
                      <div>
                        <div style={{ fontSize: 8, fontWeight: 700, color: 'var(--text-primary)' }}>{item.label}</div>
                        <div style={{ fontSize: 7, color: 'var(--text-secondary)', marginTop: 1 }}>{item.desc}</div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </PanelSection>

            {/* AUTOMATION RECIPES */}
            <PanelSection title="Recipes" accent="#10b981" count={recipes.filter(r => r.enabled).length}>
              {recipes.length === 0 ? (
                <div style={{ fontSize: 9, color: 'var(--text-secondary)', textAlign: 'center', padding: '12px 0' }}>Loading recipes…</div>
              ) : recipes.map(recipe => (
                <div key={recipe.id} style={{ marginBottom: 10, padding: '8px 8px 6px', borderRadius: 5, border: '1px solid rgba(16,185,129,0.18)', background: recipe.enabled ? 'rgba(16,185,129,0.04)' : 'transparent' }}>
                  {/* Header row */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-primary)' }}>{recipe.name}</div>
                      <div style={{ fontSize: 8, color: '#10b981', marginTop: 1 }}>{recipe.triggerLabel}</div>
                    </div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        checked={recipe.enabled}
                        onChange={e => handleRecipeToggle(recipe.id, e.target.checked)}
                        style={{ cursor: 'pointer' }}
                      />
                      <span style={{ fontSize: 8, color: 'var(--text-secondary)' }}>{recipe.enabled ? 'On' : 'Off'}</span>
                    </label>
                  </div>
                  {/* Description */}
                  <div style={{ fontSize: 8, color: 'var(--text-secondary)', marginBottom: 5, lineHeight: 1.4 }}>{recipe.description}</div>
                  {/* Param inputs */}
                  {recipe.paramSchema.length > 0 && (
                    <div style={{ marginBottom: 5 }}>
                      {recipe.paramSchema.map(p => (
                        <div key={p.key} style={{ marginBottom: 3 }}>
                          <div style={{ fontSize: 7, color: 'var(--text-secondary)', marginBottom: 1 }}>{p.label}{p.required ? ' *' : ''}</div>
                          <input
                            className="hq-input"
                            style={{ width: '100%', fontSize: 8, padding: '2px 4px' }}
                            placeholder={p.placeholder}
                            value={recipeParams[recipe.id]?.[p.key] ?? ''}
                            onChange={e => handleRecipeParamChange(recipe.id, p.key, e.target.value)}
                          />
                        </div>
                      ))}
                      <button
                        className="hq-btn"
                        style={{ fontSize: 8, padding: '2px 6px', marginTop: 2 }}
                        disabled={recipesSaving[recipe.id]}
                        onClick={() => handleRecipeSaveParams(recipe.id)}
                      >
                        {recipesSaving[recipe.id] ? 'Saving…' : 'Save Params'}
                      </button>
                    </div>
                  )}
                  {/* Run Now */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                    <button
                      className="hq-btn"
                      style={{ fontSize: 8, padding: '2px 8px', background: 'rgba(16,185,129,0.15)', color: '#10b981' }}
                      disabled={recipeRunning[recipe.id]}
                      onClick={() => handleRecipeRun(recipe.id)}
                    >
                      {recipeRunning[recipe.id] ? 'Running…' : 'Run Now'}
                    </button>
                    {recipe.lastRunAt && (
                      <span style={{ fontSize: 7, color: recipe.lastRunStatus === 'success' ? '#10b981' : recipe.lastRunStatus === 'failed' ? '#ef4444' : 'var(--text-secondary)' }}>
                        {recipe.lastRunStatus?.toUpperCase()} — {new Date(recipe.lastRunAt).toLocaleTimeString()}
                      </span>
                    )}
                  </div>
                  {/* Last run result */}
                  {recipe.lastRunResult && (
                    <div style={{ fontSize: 7, color: 'var(--text-secondary)', marginTop: 3, fontFamily: 'monospace', wordBreak: 'break-all' }}>{recipe.lastRunResult.slice(0, 120)}</div>
                  )}
                </div>
              ))}
            </PanelSection>

            {/* TRIFORGE DISPATCH */}
            <PanelSection
              title="Dispatch"
              accent="#f97316"
              count={(dispatchPendingConfs.length > 0 ? dispatchPendingConfs.length : 0) + (dispatchStatus?.running ? 0 : 0)}
            >
              {/* Pending confirmation banner */}
              {dispatchPendingConfs.length > 0 && (
                <div style={{ marginBottom: 8, padding: '6px 8px', borderRadius: 4, background: 'rgba(239,68,68,0.12)', border: '1px solid rgba(239,68,68,0.35)' }}>
                  <div style={{ fontSize: 8, color: '#f87171', fontWeight: 700, marginBottom: 4 }}>
                    {dispatchPendingConfs.length} Remote Action{dispatchPendingConfs.length > 1 ? 's' : ''} Awaiting Confirmation
                  </div>
                  {dispatchPendingConfs.slice(0, 3).map(c => (
                    <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 3 }}>
                      <span style={{ fontSize: 7, color: '#fca5a5', flex: 1 }}>{c.verb.toUpperCase()} · {c.action.slice(0, 40)} · {c.deviceLabel}</span>
                      <button style={{ fontSize: 7, padding: '1px 5px', borderRadius: 3, border: 'none', cursor: 'pointer', background: 'rgba(34,197,94,0.2)', color: '#22c55e', fontWeight: 600 }}
                        onClick={() => handleDispatchDesktopConfirm(c.id, true)}>Allow</button>
                      <button style={{ fontSize: 7, padding: '1px 5px', borderRadius: 3, border: 'none', cursor: 'pointer', background: 'rgba(239,68,68,0.2)', color: '#ef4444', fontWeight: 600 }}
                        onClick={() => handleDispatchDesktopConfirm(c.id, false)}>Deny</button>
                    </div>
                  ))}
                </div>
              )}

              {/* Status strip */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 8 }}>
                <span style={{ fontSize: 8, color: dispatchStatus?.running ? '#22c55e' : '#94a3b8', fontWeight: 800 }}>●</span>
                <span style={{ fontSize: 8, color: 'var(--text-secondary)', flex: 1 }}>
                  {dispatchStatus?.running
                    ? `Port ${dispatchStatus.port} · ${dispatchStatus.networkMode?.toUpperCase() ?? 'LAN'} · ${dispatchStatus.deviceCount} device${dispatchStatus.deviceCount !== 1 ? 's' : ''}`
                    : 'Not running'}
                </span>
                <button style={{ fontSize: 7, padding: '1px 5px', borderRadius: 3, border: 'none', cursor: 'pointer', background: 'rgba(249,115,22,0.15)', color: '#f97316' }} disabled={dispatchLoading} onClick={loadDispatch}>↻</button>
              </div>

              {/* Sub-tabs */}
              <div style={{ display: 'flex', gap: 4, marginBottom: 8, flexWrap: 'wrap' }}>
                {(['access', 'devices', 'policy', 'confirms', 'reach', 'workspace', 'integrations', 'matrix', 'automation', 'runbooks', 'analytics', 'org'] as const).map(t => (
                  <button key={t} onClick={() => setDispatchTab(t)} style={{
                    fontSize: 7, padding: '2px 6px', borderRadius: 3, border: 'none', cursor: 'pointer', fontWeight: 600,
                    background: dispatchTab === t ? '#f97316' : 'rgba(249,115,22,0.1)',
                    color: dispatchTab === t ? '#fff' : '#f97316',
                  }}>
                    {t === 'confirms' && dispatchPendingConfs.length > 0 ? `Confirms (${dispatchPendingConfs.length})` : t.charAt(0).toUpperCase() + t.slice(1)}
                  </button>
                ))}
              </div>

              {/* ACCESS TAB */}
              {dispatchTab === 'access' && (<>
                {/* Master token */}
                <div style={{ marginBottom: 8 }}>
                  <div style={{ fontSize: 8, color: 'var(--text-secondary)', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Master Token</div>
                  {dispatchToken ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                      <div style={{ flex: 1, fontFamily: 'monospace', fontSize: 7, padding: '3px 5px', borderRadius: 3, background: 'rgba(0,0,0,0.3)', color: '#94a3b8', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {dispatchToken.slice(0, 22)}…
                      </div>
                      <button style={{ fontSize: 7, padding: '2px 6px', borderRadius: 3, border: 'none', cursor: 'pointer', background: dispatchCopied ? 'rgba(34,197,94,0.2)' : 'rgba(249,115,22,0.15)', color: dispatchCopied ? '#22c55e' : '#f97316', fontWeight: 600 }} onClick={handleDispatchCopyToken}>{dispatchCopied ? 'Copied!' : 'Copy'}</button>
                      <button style={{ fontSize: 7, padding: '2px 6px', borderRadius: 3, border: 'none', cursor: 'pointer', background: 'rgba(239,68,68,0.15)', color: '#ef4444', fontWeight: 600 }} disabled={dispatchLoading} onClick={handleDispatchRevokeToken}>Revoke All</button>
                    </div>
                  ) : (
                    <button style={{ fontSize: 7, padding: '3px 8px', borderRadius: 3, border: 'none', cursor: 'pointer', background: 'rgba(249,115,22,0.15)', color: '#f97316', fontWeight: 600 }} disabled={dispatchLoading} onClick={handleDispatchGenerateToken}>Generate Master Token</button>
                  )}
                  <div style={{ fontSize: 7, color: '#64748b', marginTop: 3 }}>Master token is an admin key. Normal devices pair via 6-digit code and use session tokens.</div>
                </div>

                {/* Port + start/stop */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 6 }}>
                  <span style={{ fontSize: 8, color: 'var(--text-secondary)', whiteSpace: 'nowrap' }}>Port</span>
                  <input
                    style={{ flex: 1, fontSize: 8, padding: '3px 5px', borderRadius: 3, border: '1px solid rgba(249,115,22,0.2)', background: 'rgba(0,0,0,0.3)', color: 'var(--text-primary)', minWidth: 0 }}
                    value={dispatchPort} onChange={e => setDispatchPort(e.target.value)}
                    disabled={dispatchStatus?.running} type="number" min={1024} max={65535}
                  />
                  {dispatchStatus?.running ? (
                    <button style={{ fontSize: 7, padding: '3px 8px', borderRadius: 3, border: 'none', cursor: 'pointer', background: 'rgba(239,68,68,0.15)', color: '#ef4444', fontWeight: 600, whiteSpace: 'nowrap' }} disabled={dispatchLoading} onClick={handleDispatchDisable}>Stop</button>
                  ) : (
                    <button style={{ fontSize: 7, padding: '3px 8px', borderRadius: 3, border: 'none', cursor: 'pointer', background: dispatchStatus?.hasToken ? 'rgba(249,115,22,0.15)' : 'rgba(148,163,184,0.1)', color: dispatchStatus?.hasToken ? '#f97316' : '#94a3b8', fontWeight: 600, whiteSpace: 'nowrap' }} disabled={dispatchLoading || !dispatchStatus?.hasToken} onClick={handleDispatchEnable} title={dispatchStatus?.hasToken ? undefined : 'Generate a master token first'}>Start</button>
                  )}
                </div>

                {/* URL + pairing code */}
                {dispatchStatus?.running && (<>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6, padding: '3px 5px', borderRadius: 3, background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(249,115,22,0.15)' }}>
                    <span style={{ fontFamily: 'monospace', fontSize: 7, color: '#f97316', flex: 1 }}>http://localhost:{dispatchStatus.port}/</span>
                    <button style={{ fontSize: 7, padding: '1px 5px', borderRadius: 3, border: 'none', cursor: 'pointer', background: 'rgba(249,115,22,0.15)', color: '#f97316', fontWeight: 600 }} onClick={handleDispatchCopyUrl}>Copy URL</button>
                  </div>

                  {/* Pairing code */}
                  <div style={{ marginBottom: 4 }}>
                    <div style={{ fontSize: 8, color: 'var(--text-secondary)', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Pair a Device</div>
                    {dispatchPairingCode && Date.now() < dispatchPairingCode.expiresAt ? (
                      <div style={{ padding: '8px', borderRadius: 4, background: 'rgba(249,115,22,0.08)', border: '1px solid rgba(249,115,22,0.25)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{ fontFamily: 'monospace', fontSize: 22, fontWeight: 700, color: '#f97316', letterSpacing: '0.15em' }}>
                            {dispatchPairingCode.code}
                          </div>
                          {dispatchPairingCode.qrDataUrl && (
                            <img src={dispatchPairingCode.qrDataUrl} alt="QR code" style={{ width: 64, height: 64, borderRadius: 4 }} />
                          )}
                        </div>
                        <div style={{ fontSize: 7, color: '#94a3b8', marginTop: 4 }}>
                          On your phone, open <span style={{ color: '#f97316' }}>{dispatchPairingCode.pairUrl}</span> and enter this code.
                          Expires {new Date(dispatchPairingCode.expiresAt).toLocaleTimeString()}.
                        </div>
                      </div>
                    ) : (
                      <button style={{ fontSize: 7, padding: '3px 8px', borderRadius: 3, border: 'none', cursor: 'pointer', background: 'rgba(249,115,22,0.15)', color: '#f97316', fontWeight: 600 }} disabled={dispatchPairingLoading} onClick={handleDispatchGeneratePairingCode}>
                        {dispatchPairingLoading ? 'Generating…' : 'Generate Pairing Code'}
                      </button>
                    )}
                  </div>
                </>)}
              </>)}

              {/* DEVICES TAB */}
              {dispatchTab === 'devices' && (
                <div>
                  {dispatchDevices.length === 0 ? (
                    <div style={{ fontSize: 8, color: '#64748b', textAlign: 'center', padding: '12px 0' }}>No paired devices. Generate a pairing code in the Access tab.</div>
                  ) : dispatchDevices.map(d => (
                    <div key={d.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 0', borderBottom: '1px solid rgba(249,115,22,0.1)' }}>
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 8, fontWeight: 600, color: d.expired ? '#94a3b8' : 'var(--text-primary)', display: 'flex', alignItems: 'center', gap: 4 }}>
                          {d.label}
                          {d.expired && <span style={{ fontSize: 6, color: '#ef4444', fontWeight: 700 }}>EXPIRED</span>}
                        </div>
                        <div style={{ fontSize: 7, color: '#64748b' }}>
                          Paired {new Date(d.pairedAt).toLocaleDateString()}
                          {d.lastSeenAt && ` · Last seen ${new Date(d.lastSeenAt).toLocaleTimeString()}`}
                          {d.lastSeenIp && ` · ${d.lastSeenIp}`}
                        </div>
                      </div>
                      <button style={{ fontSize: 7, padding: '2px 6px', borderRadius: 3, border: 'none', cursor: 'pointer', background: 'rgba(239,68,68,0.15)', color: '#ef4444', fontWeight: 600 }} onClick={() => handleDispatchRevokeDevice(d.id)}>Revoke</button>
                    </div>
                  ))}
                </div>
              )}

              {/* POLICY TAB */}
              {dispatchTab === 'policy' && dispatchStatus && (
                <div>
                  {/* Network mode */}
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 8, color: 'var(--text-secondary)', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Network Scope</div>
                    {(['local', 'lan', 'remote'] as const).map(mode => (
                      <label key={mode} style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 4, cursor: 'pointer' }}>
                        <input type="radio" name="networkMode" value={mode} checked={dispatchStatus.networkMode === mode} onChange={() => handleDispatchSetNetworkMode(mode)} />
                        <div>
                          <span style={{ fontSize: 8, fontWeight: 600, color: 'var(--text-primary)' }}>{mode.toUpperCase()}</span>
                          <span style={{ fontSize: 7, color: '#64748b', marginLeft: 4 }}>
                            {mode === 'local' ? '127.0.0.1 only' : mode === 'lan' ? '192.168.x.x / 10.x.x.x / 172.x.x.x' : 'Any IP (use with caution)'}
                          </span>
                        </div>
                        {mode === 'remote' && <span style={{ fontSize: 7, color: '#f59e0b', fontWeight: 600 }}>⚠ Exposes to internet</span>}
                      </label>
                    ))}
                  </div>

                  {/* Remote approve policy */}
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 8, color: 'var(--text-secondary)', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Remote Approve</div>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6, cursor: 'pointer' }}>
                      <input type="checkbox" checked={dispatchStatus.policy.enabled} onChange={e => handleDispatchSetPolicy({ enabled: e.target.checked })} />
                      <span style={{ fontSize: 8, color: 'var(--text-secondary)' }}>Allow remote devices to approve / dismiss / retry</span>
                    </label>
                    {dispatchStatus.policy.enabled && (<>
                      <div style={{ fontSize: 8, color: 'var(--text-secondary)', marginBottom: 4 }}>Max risk level remote can approve:</div>
                      <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
                        {(['low', 'medium', 'high', 'critical'] as const).map(risk => (
                          <button key={risk} onClick={() => handleDispatchSetPolicy({ maxRisk: risk })} style={{
                            fontSize: 7, padding: '2px 7px', borderRadius: 3, border: 'none', cursor: 'pointer', fontWeight: 600,
                            background: dispatchStatus.policy.maxRisk === risk
                              ? (risk === 'critical' ? '#7f1d1d' : risk === 'high' ? '#7c2d12' : risk === 'medium' ? '#78350f' : '#1e3a5f')
                              : 'rgba(100,116,139,0.15)',
                            color: dispatchStatus.policy.maxRisk === risk
                              ? (risk === 'critical' ? '#fca5a5' : risk === 'high' ? '#fdba74' : risk === 'medium' ? '#fcd34d' : '#93c5fd')
                              : '#94a3b8',
                          }}>{risk}</button>
                        ))}
                      </div>
                      <label style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                        <input type="checkbox" checked={dispatchStatus.policy.requireDesktopConfirm} onChange={e => handleDispatchSetPolicy({ requireDesktopConfirm: e.target.checked })} />
                        <span style={{ fontSize: 8, color: 'var(--text-secondary)' }}>Require desktop confirmation for every remote approve</span>
                      </label>
                    </>)}
                  </div>
                </div>
              )}

              {/* CONFIRMS TAB */}
              {dispatchTab === 'confirms' && (
                <div>
                  {dispatchPendingConfs.length === 0 ? (
                    <div style={{ fontSize: 8, color: '#64748b', textAlign: 'center', padding: '12px 0' }}>No pending confirmations.</div>
                  ) : dispatchPendingConfs.map(c => (
                    <div key={c.id} style={{ marginBottom: 8, padding: '8px', borderRadius: 4, background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.2)' }}>
                      <div style={{ fontSize: 8, fontWeight: 600, marginBottom: 3 }}>{c.verb.toUpperCase()} — {c.action}</div>
                      <div style={{ fontSize: 7, color: '#94a3b8', marginBottom: 6 }}>
                        Requested by <strong>{c.deviceLabel}</strong> from {c.clientIp} · {new Date(c.createdAt).toLocaleTimeString()}
                      </div>
                      <div style={{ display: 'flex', gap: 6 }}>
                        <button style={{ fontSize: 8, padding: '3px 10px', borderRadius: 4, border: 'none', cursor: 'pointer', background: 'rgba(34,197,94,0.2)', color: '#22c55e', fontWeight: 600 }} onClick={() => handleDispatchDesktopConfirm(c.id, true)}>Allow</button>
                        <button style={{ fontSize: 8, padding: '3px 10px', borderRadius: 4, border: 'none', cursor: 'pointer', background: 'rgba(239,68,68,0.2)', color: '#ef4444', fontWeight: 600 }} onClick={() => handleDispatchDesktopConfirm(c.id, false)}>Deny</button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* REACH TAB — remote reachability + public URL */}
              {dispatchTab === 'reach' && (
                <div>
                  {/* Public URL field */}
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 8, color: 'var(--text-secondary)', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Public URL</div>
                    <div style={{ fontSize: 7, color: '#64748b', marginBottom: 6 }}>
                      The URL where Dispatch is reachable externally. Used in push notification deep-links and QR codes.
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <input
                        type="url"
                        value={dispatchPublicUrl}
                        onChange={e => setDispatchPublicUrl(e.target.value)}
                        placeholder={dispatchStatus?.port ? `http://your-ip:${dispatchStatus.port}` : 'https://…'}
                        style={{ flex: 1, fontSize: 8, padding: '3px 6px', borderRadius: 3, background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(249,115,22,0.3)', color: 'var(--text-primary)', outline: 'none' }}
                        onKeyDown={async e => {
                          if (e.key === 'Enter') {
                            setDispatchPublicUrlSaving(true);
                            await window.triforge.dispatch.setPublicUrl(dispatchPublicUrl);
                            setDispatchPublicUrlSaving(false);
                          }
                        }}
                      />
                      <button
                        style={{ fontSize: 7, padding: '2px 8px', borderRadius: 3, border: 'none', cursor: 'pointer', background: 'rgba(249,115,22,0.2)', color: '#f97316', fontWeight: 600 }}
                        disabled={dispatchPublicUrlSaving}
                        onClick={async () => {
                          setDispatchPublicUrlSaving(true);
                          await window.triforge.dispatch.setPublicUrl(dispatchPublicUrl);
                          setDispatchPublicUrlSaving(false);
                        }}
                      >
                        {dispatchPublicUrlSaving ? '…' : 'Save'}
                      </button>
                    </div>
                  </div>

                  {/* Cloudflare Tunnel guide */}
                  <div style={{ marginBottom: 10 }}>
                    <div style={{ fontSize: 8, color: 'var(--text-secondary)', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Free Tunnel via Cloudflare</div>
                    <div style={{ padding: '8px', borderRadius: 4, background: 'rgba(249,115,22,0.05)', border: '1px solid rgba(249,115,22,0.15)' }}>
                      <div style={{ fontSize: 7, color: '#94a3b8', lineHeight: 1.6 }}>
                        <div style={{ marginBottom: 4, color: '#f97316', fontWeight: 600 }}>One-time setup:</div>
                        <div>1. Install <span style={{ fontFamily: 'monospace', color: '#e2e8f0' }}>cloudflared</span> — <span style={{ fontFamily: 'monospace', color: '#64748b' }}>brew install cloudflared</span> or download from cloudflare.com</div>
                        <div style={{ marginTop: 3 }}>2. Run: <span style={{ fontFamily: 'monospace', color: '#e2e8f0' }}>cloudflared tunnel --url http://localhost:{dispatchStatus?.port ?? 18790}</span></div>
                        <div style={{ marginTop: 3 }}>3. Copy the <span style={{ color: '#f97316' }}>trycloudflare.com</span> URL shown and paste it above as your Public URL.</div>
                        <div style={{ marginTop: 3, color: '#64748b' }}>The tunnel URL changes each session. For a permanent URL, create a named tunnel with a free Cloudflare account.</div>
                      </div>
                    </div>
                  </div>

                  {/* ngrok alternative */}
                  <div>
                    <div style={{ fontSize: 8, color: 'var(--text-secondary)', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Alternative — ngrok</div>
                    <div style={{ padding: '8px', borderRadius: 4, background: 'rgba(99,102,241,0.05)', border: '1px solid rgba(99,102,241,0.15)' }}>
                      <div style={{ fontSize: 7, color: '#94a3b8', lineHeight: 1.6 }}>
                        <div><span style={{ fontFamily: 'monospace', color: '#e2e8f0' }}>ngrok http {dispatchStatus?.port ?? 18790}</span></div>
                        <div style={{ marginTop: 3 }}>Paste the <span style={{ color: '#818cf8' }}>ngrok.io</span> HTTPS URL above. Free tier works for personal use.</div>
                      </div>
                    </div>
                  </div>
                </div>
              )}

              {/* WORKSPACE TAB */}
              {dispatchTab === 'workspace' && (
                <div>
                  {!workspace ? (
                    <div>
                      <div style={{ fontSize: 8, color: '#94a3b8', marginBottom: 8 }}>
                        Create a workspace to manage team members, roles, and shared policies across Dispatch.
                      </div>
                      <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
                        <input
                          value={wsNewName} onChange={e => setWsNewName(e.target.value)}
                          placeholder="Workspace name…"
                          style={{ flex: 1, fontSize: 8, padding: '3px 6px', borderRadius: 3, background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(249,115,22,0.3)', color: '#e2e8f0', outline: 'none' }}
                        />
                        <button
                          style={{ fontSize: 7, padding: '2px 8px', borderRadius: 3, border: 'none', cursor: 'pointer', background: 'rgba(249,115,22,0.2)', color: '#f97316', fontWeight: 600 }}
                          disabled={wsLoading}
                          onClick={async () => {
                            setWsLoading(true);
                            try {
                              const r = await (window.triforge as any).workspace.create(wsNewName || 'My Workspace');
                              if (r.ok) { setWorkspace(r.workspace); setWsNewName(''); }
                            } finally { setWsLoading(false); }
                          }}
                        >
                          {wsLoading ? '…' : 'Create'}
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div>
                      {/* Workspace name */}
                      <div style={{ marginBottom: 10 }}>
                        <div style={{ fontSize: 8, color: 'var(--text-secondary)', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Workspace</div>
                        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                          <input
                            defaultValue={workspace.name}
                            key={workspace.name}
                            onBlur={async e => {
                              const n = e.target.value.trim();
                              if (n && n !== workspace.name) {
                                setWsRenaming(true);
                                await (window.triforge as any).workspace.rename(n);
                                await loadWorkspace();
                                setWsRenaming(false);
                              }
                            }}
                            style={{ flex: 1, fontSize: 9, fontWeight: 700, padding: '3px 6px', borderRadius: 3, background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(249,115,22,0.2)', color: '#e2e8f0', outline: 'none' }}
                          />
                          {wsRenaming && <span style={{ fontSize: 7, color: '#94a3b8' }}>saving…</span>}
                        </div>
                        <div style={{ fontSize: 7, color: '#64748b', marginTop: 2 }}>Owner: {workspace.ownerId} · ID: {workspace.id}</div>
                      </div>

                      {/* Members */}
                      <div style={{ marginBottom: 10 }}>
                        <div style={{ fontSize: 8, color: 'var(--text-secondary)', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Members ({(workspace.members ?? []).length})</div>
                        {(workspace.members ?? []).length === 0 ? (
                          <div style={{ fontSize: 7, color: '#64748b' }}>No remote members yet. Generate an invite below.</div>
                        ) : (workspace.members as any[]).map((m: any) => (
                          <div key={m.deviceId} style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '4px 0', borderBottom: '1px solid rgba(249,115,22,0.08)' }}>
                            <span style={{ fontSize: 8, flex: 1, color: '#e2e8f0' }}>{m.deviceLabel || m.deviceId.slice(0, 10)}</span>
                            <select
                              value={m.role}
                              style={{ fontSize: 7, background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(249,115,22,0.2)', color: '#f97316', borderRadius: 3, padding: '1px 3px' }}
                              onChange={async e => {
                                await (window.triforge as any).workspace.setMemberRole(m.deviceId, e.target.value);
                                await loadWorkspace();
                              }}
                            >
                              {['viewer','reviewer','operator','admin'].map(r => <option key={r} value={r}>{r}</option>)}
                            </select>
                            <button
                              style={{ fontSize: 7, padding: '1px 4px', borderRadius: 3, border: 'none', cursor: 'pointer', background: 'rgba(239,68,68,0.1)', color: '#ef4444' }}
                              onClick={async () => {
                                await (window.triforge as any).workspace.removeMember(m.deviceId);
                                await loadWorkspace();
                              }}
                            >✕</button>
                          </div>
                        ))}
                      </div>

                      {/* Invite */}
                      <div style={{ marginBottom: 10 }}>
                        <div style={{ fontSize: 8, color: 'var(--text-secondary)', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Invite Member</div>
                        <div style={{ display: 'flex', gap: 4, alignItems: 'center' }}>
                          <select
                            value={wsInviteRole} onChange={e => setWsInviteRole(e.target.value)}
                            style={{ fontSize: 7, background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(249,115,22,0.2)', color: '#f97316', borderRadius: 3, padding: '2px 4px' }}
                          >
                            {['viewer','reviewer','operator','admin'].map(r => <option key={r} value={r}>{r}</option>)}
                          </select>
                          <button
                            style={{ fontSize: 7, padding: '2px 8px', borderRadius: 3, border: 'none', cursor: 'pointer', background: 'rgba(249,115,22,0.2)', color: '#f97316', fontWeight: 600 }}
                            onClick={async () => {
                              setWsInviteErr('');
                              const r = await (window.triforge as any).workspace.invite(wsInviteRole);
                              if (r.ok) setWsInviteResult({ code: r.invite.code, expiresAt: r.invite.expiresAt });
                              else setWsInviteErr(r.error || 'Failed');
                            }}
                          >Generate Code</button>
                        </div>
                        {wsInviteErr && <div style={{ fontSize: 7, color: '#ef4444', marginTop: 3 }}>{wsInviteErr}</div>}
                        {wsInviteResult && (
                          <div style={{ marginTop: 6, padding: '8px', borderRadius: 4, background: 'rgba(249,115,22,0.08)', border: '1px solid rgba(249,115,22,0.2)' }}>
                            <div style={{ fontFamily: 'monospace', fontSize: 16, fontWeight: 700, color: '#f97316', letterSpacing: '0.15em', marginBottom: 4 }}>{wsInviteResult.code}</div>
                            <div style={{ fontSize: 7, color: '#94a3b8' }}>
                              Send this code to the member. They join at <span style={{ color: '#f97316' }}>/dispatch/workspace/join</span> or via the mobile Dispatch app.
                              Expires {new Date(wsInviteResult.expiresAt).toLocaleString()}.
                            </div>
                            <button
                              style={{ marginTop: 4, fontSize: 7, padding: '1px 6px', borderRadius: 3, border: 'none', cursor: 'pointer', background: 'rgba(249,115,22,0.15)', color: '#f97316' }}
                              onClick={() => navigator.clipboard.writeText(wsInviteResult.code)}
                            >Copy Code</button>
                          </div>
                        )}
                      </div>

                      {/* Policy */}
                      <div>
                        <div style={{ fontSize: 8, color: 'var(--text-secondary)', marginBottom: 4, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Workspace Policy</div>
                        {wsPolicyErr && <div style={{ fontSize: 7, color: '#ef4444', marginBottom: 4 }}>{wsPolicyErr}</div>}
                        {[
                          { key: 'minApproveRole',        label: 'Min role to approve actions' },
                          { key: 'minRecipeRole',          label: 'Min role to run recipes' },
                          { key: 'minDispatchAdminRole',   label: 'Min role for dispatch admin' },
                          { key: 'minIntegrationRole',     label: 'Min role to edit integrations' },
                          { key: 'minMemoryRole',          label: 'Min role to edit shared memory' },
                        ].map(({ key, label }) => (
                          <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
                            <span style={{ fontSize: 7, color: '#94a3b8', flex: 1 }}>{label}</span>
                            <select
                              value={(workspace.policy as any)?.[key] ?? 'operator'}
                              style={{ fontSize: 7, background: 'rgba(0,0,0,0.3)', border: '1px solid rgba(249,115,22,0.2)', color: '#f97316', borderRadius: 3, padding: '1px 3px' }}
                              onChange={async e => {
                                setWsPolicyErr('');
                                const r = await (window.triforge as any).workspace.updatePolicy({ [key]: e.target.value });
                                if (r.ok) await loadWorkspace();
                                else setWsPolicyErr(r.error || 'Failed');
                              }}
                            >
                              {['viewer','reviewer','operator','admin','owner'].map(r => <option key={r} value={r}>{r}</option>)}
                            </select>
                          </div>
                        ))}
                        <label style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4, cursor: 'pointer' }}>
                          <input
                            type="checkbox"
                            checked={(workspace.policy as any)?.requireDesktopConfirmForWrite ?? true}
                            onChange={async e => {
                              await (window.triforge as any).workspace.updatePolicy({ requireDesktopConfirmForWrite: e.target.checked });
                              await loadWorkspace();
                            }}
                          />
                          <span style={{ fontSize: 7, color: '#94a3b8' }}>Require desktop confirm for write tasks</span>
                        </label>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── Phase 29: Policy Matrix tab ── */}
              {dispatchTab === 'matrix' && (
                <div>
                  <div style={{ fontSize: 7, color: '#94a3b8', marginBottom: 8 }}>
                    Per-action approval rules. Define which workspace role can approve each action category and whether desktop confirmation is required.
                  </div>
                  {policyErr && <div style={{ fontSize: 7, color: '#ef4444', marginBottom: 6 }}>{policyErr}</div>}
                  {policyLoading ? (
                    <div style={{ fontSize: 8, color: '#64748b', textAlign: 'center', padding: '10px 0' }}>Loading…</div>
                  ) : (
                    <>
                      {/* Matrix rules table */}
                      <div style={{ marginBottom: 10 }}>
                        {policyMatrix.map((rule: any) => (
                          <div key={rule.category} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', borderRadius: 4, border: '1px solid rgba(249,115,22,0.15)', background: 'rgba(249,115,22,0.03)', marginBottom: 3 }}>
                            <span style={{ fontSize: 8, fontFamily: 'monospace', color: '#f97316', minWidth: 120 }}>{rule.category}</span>
                            <select
                              value={rule.minApproverRole}
                              onChange={async e => {
                                const r = await (window.triforge as any).workspacePolicy.setRule(rule.category, { minApproverRole: e.target.value });
                                if (r.ok) loadPolicyMatrix(); else setPolicyErr(r.error ?? 'Failed');
                              }}
                              style={{ fontSize: 8, padding: '1px 4px', borderRadius: 3, background: '#0f172a', border: '1px solid rgba(249,115,22,0.3)', color: '#e2e8f0', cursor: 'pointer' }}
                            >
                              {['viewer', 'reviewer', 'operator', 'admin', 'owner'].map(r => <option key={r} value={r}>{r}</option>)}
                            </select>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer', marginLeft: 'auto' }}>
                              <input
                                type="checkbox"
                                checked={rule.requireDesktopConfirm}
                                onChange={async e => {
                                  const r = await (window.triforge as any).workspacePolicy.setRule(rule.category, { requireDesktopConfirm: e.target.checked });
                                  if (r.ok) loadPolicyMatrix(); else setPolicyErr(r.error ?? 'Failed');
                                }}
                              />
                              <span style={{ fontSize: 7, color: '#94a3b8' }}>Confirm</span>
                            </label>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer' }}>
                              <input
                                type="checkbox"
                                checked={rule.enabled}
                                onChange={async e => {
                                  const r = await (window.triforge as any).workspacePolicy.setRule(rule.category, { enabled: e.target.checked });
                                  if (r.ok) loadPolicyMatrix(); else setPolicyErr(r.error ?? 'Failed');
                                }}
                              />
                              <span style={{ fontSize: 7, color: '#94a3b8' }}>On</span>
                            </label>
                          </div>
                        ))}
                      </div>

                      {/* Reset to defaults */}
                      <div style={{ marginBottom: 12 }}>
                        <button
                          className="hq-btn"
                          onClick={async () => {
                            const r = await (window.triforge as any).workspacePolicy.resetDefaults();
                            if (r.ok) { setPolicyMatrix(r.matrix); setPolicyErr(''); }
                            else setPolicyErr('Failed to reset');
                          }}
                          style={{ fontSize: 8, padding: '3px 10px', borderRadius: 4, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171', cursor: 'pointer' }}
                        >
                          Reset to Defaults
                        </button>
                      </div>

                      {/* Simulation tool */}
                      <div style={{ borderTop: '1px solid rgba(249,115,22,0.15)', paddingTop: 10 }}>
                        <div style={{ fontSize: 7, fontWeight: 800, color: '#f97316', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Simulate Access</div>
                        <div style={{ display: 'flex', gap: 6, marginBottom: 6, flexWrap: 'wrap' }}>
                          <div style={{ flex: 1, minWidth: 80 }}>
                            <div style={{ fontSize: 7, color: '#64748b', marginBottom: 2 }}>Role or Device ID</div>
                            <input
                              type="text"
                              value={policySimRole}
                              onChange={e => setPolicySimRole(e.target.value)}
                              placeholder="operator / owner / deviceId..."
                              style={{ width: '100%', background: '#0f172a', border: '1px solid rgba(249,115,22,0.25)', borderRadius: 4, color: '#e2e8f0', fontSize: 9, padding: '4px 6px', boxSizing: 'border-box' }}
                            />
                          </div>
                          <div style={{ flex: 1, minWidth: 80 }}>
                            <div style={{ fontSize: 7, color: '#64748b', marginBottom: 2 }}>Action Category</div>
                            <select
                              value={policySimCat}
                              onChange={e => setPolicySimCat(e.target.value)}
                              style={{ width: '100%', fontSize: 8, padding: '4px 6px', borderRadius: 4, background: '#0f172a', border: '1px solid rgba(249,115,22,0.25)', color: '#e2e8f0', cursor: 'pointer' }}
                            >
                              {['github:comment','github:review','github:issue','jira:write','jira:transition','linear:write','slack:send','dispatch:remote_approve','bundle:send','artifact:send','recipe:run','destructive','default'].map(c => (
                                <option key={c} value={c}>{c}</option>
                              ))}
                            </select>
                          </div>
                        </div>
                        <button
                          className="hq-btn"
                          disabled={policySimLoading || !policySimRole.trim()}
                          onClick={async () => {
                            setPolicySimLoading(true);
                            setPolicySimResult(null);
                            try {
                              const r = await (window.triforge as any).workspacePolicy.simulate(policySimRole.trim(), policySimCat);
                              setPolicySimResult(r);
                            } catch {
                              setPolicyErr('Simulation failed');
                            } finally {
                              setPolicySimLoading(false);
                            }
                          }}
                          style={{ fontSize: 8, fontWeight: 700, padding: '3px 12px', borderRadius: 4, background: 'rgba(249,115,22,0.12)', border: '1px solid rgba(249,115,22,0.35)', color: '#f97316', cursor: policySimLoading ? 'not-allowed' : 'pointer' }}
                        >
                          {policySimLoading ? 'Simulating…' : 'Simulate'}
                        </button>
                        {policySimResult && (
                          <div style={{ marginTop: 8, padding: '6px 8px', borderRadius: 5, background: policySimResult.allowed ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)', border: `1px solid ${policySimResult.allowed ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}` }}>
                            <div style={{ fontSize: 9, fontWeight: 700, color: policySimResult.allowed ? '#4ade80' : '#f87171', marginBottom: 3 }}>
                              {policySimResult.allowed ? 'ALLOWED' : 'DENIED'}
                              {policySimResult.requiresDesktopConfirm && ' (desktop confirm required)'}
                            </div>
                            <div style={{ fontSize: 8, color: '#94a3b8' }}>{policySimResult.reason}</div>
                            {policySimResult.actorRole && (
                              <div style={{ fontSize: 7, color: '#64748b', marginTop: 2 }}>Role: {policySimResult.actorRole}</div>
                            )}
                          </div>
                        )}
                      </div>
                    </>
                  )}
                </div>
              )}

              {/* ── Phase 31: Runbooks + Incident Mode tab ── */}
              {dispatchTab === 'runbooks' && (
                <div>
                  {runbookErr && <div style={{ fontSize: 7, color: '#ef4444', marginBottom: 6 }}>{runbookErr}</div>}

                  {/* ── Incident Mode Banner ── */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10, padding: '6px 10px', borderRadius: 6, border: `1px solid ${incidentMode?.active ? 'rgba(239,68,68,0.5)' : 'rgba(249,115,22,0.2)'}`, background: incidentMode?.active ? 'rgba(239,68,68,0.08)' : 'rgba(249,115,22,0.04)' }}>
                    <span style={{ fontSize: 9, fontWeight: 800, color: incidentMode?.active ? '#ef4444' : '#64748b', letterSpacing: '0.06em' }}>
                      {incidentMode?.active ? 'INCIDENT MODE ACTIVE' : 'INCIDENT MODE'}
                    </span>
                    {incidentMode?.active && incidentMode.reason && (
                      <span style={{ fontSize: 7, color: '#fca5a5', flex: 1 }}>{incidentMode.reason}</span>
                    )}
                    {!incidentMode?.active && (
                      <input
                        type="text"
                        value={incidentReason}
                        onChange={e => setIncidentReason(e.target.value)}
                        placeholder="Reason (optional)"
                        style={{ flex: 1, background: '#0f172a', border: '1px solid rgba(249,115,22,0.25)', borderRadius: 4, color: '#e2e8f0', fontSize: 8, padding: '2px 5px' }}
                      />
                    )}
                    <button
                      className="hq-btn"
                      onClick={async () => {
                        const newState = !incidentMode?.active;
                        const r = await (window.triforge as any).runbook.incidentMode.set(newState, incidentReason || undefined);
                        if (r.ok) { setIncidentMode(r.state); if (newState) setIncidentReason(''); }
                      }}
                      style={{ fontSize: 8, fontWeight: 700, padding: '2px 8px', borderRadius: 4, background: incidentMode?.active ? 'rgba(239,68,68,0.15)' : 'rgba(249,115,22,0.12)', border: `1px solid ${incidentMode?.active ? 'rgba(239,68,68,0.35)' : 'rgba(249,115,22,0.35)'}`, color: incidentMode?.active ? '#f87171' : '#f97316', cursor: 'pointer' }}
                    >
                      {incidentMode?.active ? 'Deactivate' : 'Activate'}
                    </button>
                  </div>

                  {/* ── Create new runbook ── */}
                  {runbookCreating ? (
                    <div style={{ border: '1px solid rgba(249,115,22,0.3)', borderRadius: 6, padding: '8px 10px', marginBottom: 10, background: 'rgba(249,115,22,0.04)' }}>
                      <div style={{ fontSize: 7, fontWeight: 800, color: '#f97316', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>New Runbook</div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                        <input type="text" value={runbookNewTitle} onChange={e => setRunbookNewTitle(e.target.value)} placeholder="Title" style={{ background: '#0f172a', border: '1px solid rgba(249,115,22,0.3)', borderRadius: 4, color: '#e2e8f0', fontSize: 9, padding: '4px 6px' }} />
                        <input type="text" value={runbookNewDesc} onChange={e => setRunbookNewDesc(e.target.value)} placeholder="Description" style={{ background: '#0f172a', border: '1px solid rgba(249,115,22,0.3)', borderRadius: 4, color: '#e2e8f0', fontSize: 9, padding: '4px 6px' }} />
                        <input type="text" value={runbookNewEscChan} onChange={e => setRunbookNewEscChan(e.target.value)} placeholder="Escalation Slack channel (optional, e.g. #incidents)" style={{ background: '#0f172a', border: '1px solid rgba(249,115,22,0.3)', borderRadius: 4, color: '#e2e8f0', fontSize: 9, padding: '4px 6px' }} />
                        {/* Phase 34 — Variable declarations */}
                        <div style={{ border: '1px solid rgba(168,85,247,0.2)', borderRadius: 4, padding: '6px 8px' }}>
                          <div style={{ fontSize: 7, fontWeight: 700, color: '#a855f7', marginBottom: 5, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span>Variables ({runbookNewVars.length})</span>
                            <button className="hq-btn" onClick={() => setRunbookNewVars(v => [...v, { name: '', defaultValue: '', required: false, source: 'input' }])} style={{ fontSize: 7, padding: '1px 6px', borderRadius: 3, background: 'rgba(168,85,247,0.1)', border: '1px solid rgba(168,85,247,0.3)', color: '#c084fc', cursor: 'pointer' }}>+ Var</button>
                          </div>
                          {runbookNewVars.map((v, idx) => (
                            <div key={idx} style={{ display: 'flex', gap: 3, marginBottom: 4, alignItems: 'center' }}>
                              <input type="text" value={v.name} placeholder="name" onChange={e => setRunbookNewVars(vars => vars.map((x, i) => i === idx ? { ...x, name: e.target.value } : x))} style={{ flex: 2, background: '#0f172a', border: '1px solid rgba(168,85,247,0.25)', borderRadius: 3, color: '#e2e8f0', fontSize: 7, padding: '2px 4px' }} />
                              <input type="text" value={v.defaultValue} placeholder="default" onChange={e => setRunbookNewVars(vars => vars.map((x, i) => i === idx ? { ...x, defaultValue: e.target.value } : x))} style={{ flex: 2, background: '#0f172a', border: '1px solid rgba(168,85,247,0.2)', borderRadius: 3, color: '#e2e8f0', fontSize: 7, padding: '2px 4px' }} />
                              <select value={v.source} onChange={e => setRunbookNewVars(vars => vars.map((x, i) => i === idx ? { ...x, source: e.target.value } : x))} style={{ flex: 1, background: '#0f172a', border: '1px solid rgba(168,85,247,0.2)', borderRadius: 3, color: '#94a3b8', fontSize: 7, padding: '2px 2px' }}>
                                <option value="input">input</option>
                                <option value="context">context</option>
                                <option value="fixed">fixed</option>
                              </select>
                              <label style={{ display: 'flex', alignItems: 'center', gap: 2, cursor: 'pointer', fontSize: 6, color: '#94a3b8', whiteSpace: 'nowrap' }}>
                                <input type="checkbox" checked={v.required} onChange={e => setRunbookNewVars(vars => vars.map((x, i) => i === idx ? { ...x, required: e.target.checked } : x))} />
                                req
                              </label>
                              <button className="hq-btn" onClick={() => setRunbookNewVars(vars => vars.filter((_, i) => i !== idx))} style={{ fontSize: 6, padding: '1px 4px', borderRadius: 3, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171', cursor: 'pointer' }}>✕</button>
                            </div>
                          ))}
                        </div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 7, color: '#64748b', marginBottom: 2 }}>Trigger</div>
                            <select value={runbookNewTrigger} onChange={e => setRunbookNewTrigger(e.target.value)} style={{ width: '100%', fontSize: 8, padding: '3px 4px', borderRadius: 4, background: '#0f172a', border: '1px solid rgba(249,115,22,0.3)', color: '#e2e8f0' }}>
                              {['manual','incident','health_alert'].map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                          </div>
                          <label style={{ display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer', marginTop: 12 }}>
                            <input type="checkbox" checked={runbookNewIncident} onChange={e => setRunbookNewIncident(e.target.checked)} />
                            <span style={{ fontSize: 7, color: '#e2e8f0' }}>Incident mode</span>
                          </label>
                        </div>
                        <div style={{ display: 'flex', gap: 4 }}>
                          <button
                            className="hq-btn"
                            onClick={async () => {
                              const r = await (window.triforge as any).runbook.create({
                                title: runbookNewTitle || 'Untitled', description: runbookNewDesc,
                                trigger: runbookNewTrigger, incidentMode: runbookNewIncident,
                                escalationChannel: runbookNewEscChan || undefined,
                                variables: runbookNewVars.filter(v => v.name.trim()),
                              });
                              if (r.ok) { setRunbookCreating(false); setRunbookNewTitle(''); setRunbookNewDesc(''); setRunbookNewVars([]); await loadRunbookData(); }
                              else setRunbookErr(r.error ?? 'Failed');
                            }}
                            style={{ fontSize: 8, padding: '3px 10px', borderRadius: 4, background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', color: '#4ade80', cursor: 'pointer' }}
                          >Create</button>
                          <button className="hq-btn" onClick={() => setRunbookCreating(false)} style={{ fontSize: 8, padding: '3px 8px', borderRadius: 4, background: 'rgba(100,116,139,0.1)', border: '1px solid rgba(100,116,139,0.3)', color: '#94a3b8', cursor: 'pointer' }}>Cancel</button>
                        </div>
                      </div>
                    </div>
                  ) : (
                    <button className="hq-btn" onClick={() => setRunbookCreating(true)} style={{ fontSize: 8, fontWeight: 700, padding: '3px 10px', borderRadius: 4, background: 'rgba(249,115,22,0.12)', border: '1px solid rgba(249,115,22,0.35)', color: '#f97316', cursor: 'pointer', marginBottom: 10 }}>
                      + New Runbook
                    </button>
                  )}

                  {/* ── Runbook list ── */}
                  {runbookLoading ? (
                    <div style={{ fontSize: 8, color: '#64748b', textAlign: 'center', padding: '10px 0' }}>Loading…</div>
                  ) : runbooks.length === 0 ? (
                    <div style={{ fontSize: 7, color: '#64748b', textAlign: 'center', padding: '12px 0' }}>No runbooks yet. Create one above.</div>
                  ) : (
                    runbooks.map((rb: any) => {
                      const lastExec = runbookExecutions.filter((e: any) => e.runbookId === rb.id).sort((a: any, b: any) => b.startedAt - a.startedAt)[0];
                      const isRunning = runbookRunning === rb.id;
                      return (
                        <div key={rb.id} style={{ border: `1px solid ${rb.incidentMode ? 'rgba(239,68,68,0.3)' : 'rgba(249,115,22,0.2)'}`, borderRadius: 6, padding: '8px 10px', marginBottom: 8, background: 'rgba(0,0,0,0.15)' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4 }}>
                            {rb.incidentMode && <span style={{ fontSize: 7, padding: '1px 4px', borderRadius: 3, background: 'rgba(239,68,68,0.15)', color: '#f87171', fontWeight: 700 }}>INCIDENT</span>}
                            <span style={{ fontSize: 9, fontWeight: 700, color: '#e2e8f0', flex: 1 }}>{rb.title}</span>
                            <span style={{ fontSize: 7, padding: '1px 5px', borderRadius: 10, background: rb.enabled ? 'rgba(34,197,94,0.1)' : 'rgba(100,116,139,0.1)', color: rb.enabled ? '#4ade80' : '#64748b', fontWeight: 600 }}>{rb.enabled ? 'ON' : 'OFF'}</span>
                          </div>
                          {rb.description && <div style={{ fontSize: 7, color: '#94a3b8', marginBottom: 4 }}>{rb.description}</div>}
                          <div style={{ display: 'flex', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                            <span style={{ fontSize: 7, color: '#64748b' }}>Trigger: {rb.trigger}</span>
                            <span style={{ fontSize: 7, color: '#64748b' }}>Steps: {rb.stepCount ?? rb.steps?.length ?? 0}</span>
                            {(rb.variables?.length > 0) && <span style={{ fontSize: 7, color: '#a855f7' }}>Vars: {rb.variables.length}</span>}
                            {rb.version && <span style={{ fontSize: 6, padding: '1px 4px', borderRadius: 3, background: 'rgba(99,102,241,0.12)', color: '#818cf8', border: '1px solid rgba(99,102,241,0.25)', fontFamily: 'monospace' }}>v{rb.version}</span>}
                            {rb.packId && <span style={{ fontSize: 6, padding: '1px 4px', borderRadius: 3, background: 'rgba(99,102,241,0.08)', color: '#6366f1', border: '1px solid rgba(99,102,241,0.2)' }}>PKG</span>}
                            {rb.escalationChannel && <span style={{ fontSize: 7, color: '#64748b' }}>Escalation: {rb.escalationChannel}</span>}
                            {lastExec && (
                              <span style={{ fontSize: 7, color: lastExec.status === 'completed' ? '#4ade80' : lastExec.status === 'failed' ? '#f87171' : '#f97316' }}>
                                Last: {lastExec.status}
                              </span>
                            )}
                          </div>
                          <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                            <button
                              className="hq-btn"
                              disabled={isRunning || !rb.enabled}
                              onClick={async () => {
                                // Phase 34 — if runbook has required vars without defaults, show modal
                                const requiredVars = (rb.variables ?? []).filter((v: any) => v.required && !v.defaultValue && v.source !== 'fixed');
                                if (requiredVars.length > 0) {
                                  const initialVals: Record<string, string> = {};
                                  for (const v of (rb.variables ?? [])) initialVals[v.name] = v.defaultValue ?? '';
                                  setLaunchVarsModal({ rb, vals: initialVals });
                                  return;
                                }
                                setRunbookRunning(rb.id);
                                setRunbookErr('');
                                try {
                                  const prefilledVars: Record<string, string> = {};
                                  for (const v of (rb.variables ?? [])) if (v.defaultValue) prefilledVars[v.name] = v.defaultValue;
                                  const r = await (window.triforge as any).runbook.run(rb.id, prefilledVars);
                                  if (!r.ok) setRunbookErr(`Run failed: ${r.error}`);
                                  await loadRunbookData();
                                } finally { setRunbookRunning(null); }
                              }}
                              style={{ fontSize: 8, fontWeight: 700, padding: '2px 10px', borderRadius: 4, background: isRunning ? 'rgba(100,116,139,0.1)' : 'rgba(34,197,94,0.1)', border: `1px solid ${isRunning ? 'rgba(100,116,139,0.3)' : 'rgba(34,197,94,0.3)'}`, color: isRunning ? '#64748b' : '#4ade80', cursor: isRunning || !rb.enabled ? 'not-allowed' : 'pointer' }}
                            >
                              {isRunning ? 'Running…' : 'Run Now'}
                            </button>
                            <button
                              className="hq-btn"
                              onClick={async () => {
                                await (window.triforge as any).runbook.update(rb.id, { enabled: !rb.enabled });
                                await loadRunbookData();
                              }}
                              style={{ fontSize: 8, padding: '2px 8px', borderRadius: 4, background: 'rgba(100,116,139,0.08)', border: '1px solid rgba(100,116,139,0.2)', color: '#94a3b8', cursor: 'pointer' }}
                            >
                              {rb.enabled ? 'Disable' : 'Enable'}
                            </button>
                            <button
                              className="hq-btn"
                              onClick={() => setRunbookEditId(runbookEditId === rb.id ? null : rb.id)}
                              style={{ fontSize: 8, padding: '2px 8px', borderRadius: 4, background: 'rgba(249,115,22,0.08)', border: '1px solid rgba(249,115,22,0.2)', color: '#f97316', cursor: 'pointer' }}
                            >
                              {runbookEditId === rb.id ? 'Close' : 'Steps'}
                            </button>
                            <button
                              className="hq-btn"
                              onClick={async () => {
                                if (!confirm(`Delete runbook "${rb.title}"?`)) return;
                                await (window.triforge as any).runbook.delete(rb.id);
                                setPackSelectIds(prev => { const n = new Set(prev); n.delete(rb.id); return n; });
                                await loadRunbookData();
                              }}
                              style={{ fontSize: 8, padding: '2px 8px', borderRadius: 4, background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171', cursor: 'pointer' }}
                            >Delete</button>
                            {/* Phase 35 — select for export */}
                            <label style={{ display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer', fontSize: 7, color: packSelectIds.has(rb.id) ? '#818cf8' : '#64748b' }}>
                              <input type="checkbox" checked={packSelectIds.has(rb.id)} onChange={e => setPackSelectIds(prev => { const n = new Set(prev); e.target.checked ? n.add(rb.id) : n.delete(rb.id); return n; })} />
                              Export
                            </label>
                          </div>

                          {/* Step editor (inline) */}
                          {runbookEditId === rb.id && (
                            <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(249,115,22,0.15)' }}>
                              <div style={{ fontSize: 7, fontWeight: 700, color: '#94a3b8', marginBottom: 5 }}>Steps ({rb.steps?.length ?? 0})</div>
                              {(rb.steps ?? []).map((step: any, idx: number) => (
                                <div key={step.id} style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 3, padding: '3px 5px', borderRadius: 4, background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.06)' }}>
                                  <span style={{ fontSize: 7, color: '#64748b', minWidth: 16 }}>{idx + 1}.</span>
                                  <span style={{ fontSize: 8, fontFamily: 'monospace', color: '#f97316', minWidth: 90 }}>{step.type}</span>
                                  <span style={{ fontSize: 8, color: '#e2e8f0', flex: 1 }}>{step.label}</span>
                                  {step.optional && <span style={{ fontSize: 6, color: '#64748b', padding: '1px 3px', borderRadius: 2, border: '1px solid rgba(100,116,139,0.3)' }}>opt</span>}
                                  <button
                                    className="hq-btn"
                                    onClick={async () => {
                                      await (window.triforge as any).runbook.removeStep(rb.id, step.id);
                                      await loadRunbookData();
                                    }}
                                    style={{ fontSize: 6, padding: '1px 4px', borderRadius: 3, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171', cursor: 'pointer' }}
                                  >✕</button>
                                </div>
                              ))}
                              {/* Add step quick-form */}
                              <AddRunbookStepForm runbookId={rb.id} onAdded={loadRunbookData} stepIds={(rb.steps ?? []).map((s: any) => s.id)} />
                            </div>
                          )}
                        </div>
                      );
                    })
                  )}

                  {/* ── Recent executions ── */}
                  {runbookExecutions.length > 0 && (
                    <div style={{ marginTop: 10, borderTop: '1px solid rgba(249,115,22,0.15)', paddingTop: 8 }}>
                      <div style={{ fontSize: 7, fontWeight: 800, color: '#f97316', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Recent Executions</div>
                      {runbookExecutions.slice().sort((a: any, b: any) => b.startedAt - a.startedAt).slice(0, 8).map((exec: any) => {
                        const isPaused = exec.status === 'paused_approval' || exec.status === 'paused_confirm' || exec.status === 'paused_manual';
                        const statusColor = exec.status === 'completed' ? '#4ade80' : exec.status === 'failed' || exec.status === 'cancelled' ? '#f87171' : isPaused ? '#fbbf24' : '#f97316';
                        return (
                          <div key={exec.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '3px 6px', borderRadius: 4, border: `1px solid ${isPaused ? 'rgba(251,191,36,0.25)' : 'rgba(255,255,255,0.06)'}`, marginBottom: 3, background: isPaused ? 'rgba(251,191,36,0.04)' : 'transparent', cursor: 'pointer' }}
                            onClick={() => setRunbookDetailExec(exec === runbookDetailExec ? null : exec)}>
                            <span style={{ fontSize: 7, color: statusColor, fontWeight: 700, minWidth: 70 }}>{exec.status}</span>
                            <span style={{ fontSize: 8, color: '#e2e8f0', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{exec.runbookTitle}</span>
                            {exec.isIncident && <span style={{ fontSize: 6, color: '#f87171', fontWeight: 700 }}>INC</span>}
                            <span style={{ fontSize: 7, color: '#64748b' }}>{exec.steps?.filter((s: any) => s.status === 'completed').length ?? 0}/{exec.steps?.length ?? 0}</span>
                            {isPaused && (
                              <div style={{ display: 'flex', gap: 3 }} onClick={e => e.stopPropagation()}>
                                {exec.status === 'paused_approval' && (
                                  <button className="hq-btn"
                                    disabled={runbookResuming === exec.id}
                                    onClick={async () => {
                                      setRunbookResuming(exec.id);
                                      await (window.triforge as any).runbook.resume(exec.id, 'approved');
                                      setRunbookResuming(null);
                                      await loadRunbookData();
                                    }}
                                    style={{ fontSize: 7, padding: '1px 6px', borderRadius: 3, background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', color: '#4ade80', cursor: 'pointer' }}
                                  >{runbookResuming === exec.id ? '...' : 'Approve'}</button>
                                )}
                                {exec.status === 'paused_confirm' && (
                                  <button className="hq-btn"
                                    disabled={runbookResuming === exec.id}
                                    onClick={async () => {
                                      setRunbookResuming(exec.id);
                                      await (window.triforge as any).runbook.resume(exec.id, 'confirmed');
                                      setRunbookResuming(null);
                                      await loadRunbookData();
                                    }}
                                    style={{ fontSize: 7, padding: '1px 6px', borderRadius: 3, background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.3)', color: '#60a5fa', cursor: 'pointer' }}
                                  >{runbookResuming === exec.id ? '...' : 'Confirm'}</button>
                                )}
                                <button className="hq-btn"
                                  disabled={runbookAborting === exec.id}
                                  onClick={async () => {
                                    setRunbookAborting(exec.id);
                                    await (window.triforge as any).runbook.abort(exec.id);
                                    setRunbookAborting(null);
                                    await loadRunbookData();
                                  }}
                                  style={{ fontSize: 7, padding: '1px 6px', borderRadius: 3, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171', cursor: 'pointer' }}
                                >{runbookAborting === exec.id ? '...' : 'Abort'}</button>
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}

                  {/* ── Execution Detail Drawer ── */}
                  {runbookDetailExec && (() => {
                    const branchDecisions: any[] = runbookDetailExec.branchDecisions ?? [];
                    const deadlineAt: number | undefined = runbookDetailExec.deadlineAt;
                    const isOverdueExec = deadlineAt && Date.now() >= deadlineAt;
                    const minsLeft = deadlineAt ? Math.round((deadlineAt - Date.now()) / 60000) : undefined;
                    return (
                      <div style={{ marginTop: 8, border: '1px solid rgba(249,115,22,0.25)', borderRadius: 6, padding: '8px 10px', background: 'rgba(249,115,22,0.03)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                          <span style={{ fontSize: 7, fontWeight: 800, color: '#f97316', textTransform: 'uppercase', letterSpacing: '0.06em' }}>Execution Detail</span>
                          <span style={{ fontSize: 7, color: '#64748b', fontFamily: 'monospace' }}>{runbookDetailExec.id}</span>
                          {runbookDetailExec.escalationCount > 0 && (
                            <span style={{ fontSize: 6, color: '#f97316', fontWeight: 700 }}>ESC×{runbookDetailExec.escalationCount}</span>
                          )}
                          <button className="hq-btn" onClick={() => setRunbookDetailExec(null)} style={{ marginLeft: 'auto', fontSize: 7, padding: '1px 5px', borderRadius: 3, background: 'rgba(100,116,139,0.1)', border: '1px solid rgba(100,116,139,0.25)', color: '#94a3b8', cursor: 'pointer' }}>Close</button>
                        </div>
                        {runbookDetailExec.pausedReason && (
                          <div style={{ fontSize: 7, color: '#fbbf24', marginBottom: 4, padding: '3px 6px', borderRadius: 3, border: `1px solid ${isOverdueExec ? 'rgba(239,68,68,0.4)' : 'rgba(251,191,36,0.25)'}`, background: isOverdueExec ? 'rgba(239,68,68,0.08)' : 'rgba(251,191,36,0.06)', display: 'flex', gap: 6, alignItems: 'center' }}>
                            <span>Paused at step {(runbookDetailExec.pausedAtStepIdx ?? 0) + 1}: {runbookDetailExec.pausedReason}</span>
                            {isOverdueExec && <span style={{ fontSize: 6, color: '#f87171', fontWeight: 800 }}>OVERDUE {Math.abs(minsLeft ?? 0)}m</span>}
                            {!isOverdueExec && minsLeft !== undefined && minsLeft <= 30 && (
                              <span style={{ fontSize: 6, color: '#fbbf24', fontWeight: 700 }}>{minsLeft}m left</span>
                            )}
                          </div>
                        )}
                        {/* Steps */}
                        {(runbookDetailExec.steps ?? []).map((step: any, idx: number) => {
                          const sc = step.status === 'completed' ? '#4ade80' : step.status === 'failed' ? '#f87171' : step.status === 'skipped' || step.status === 'branched' ? '#475569' : step.status === 'attention' ? '#fbbf24' : step.status === 'running' ? '#f97316' : '#64748b';
                          return (
                            <div key={step.stepId ?? idx} style={{ display: 'flex', gap: 5, alignItems: 'flex-start', padding: '2px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                              <span style={{ fontSize: 6, color: '#475569', minWidth: 14, paddingTop: 1 }}>{idx + 1}.</span>
                              <span style={{ fontSize: 7, color: sc, minWidth: 58, fontWeight: 600 }}>{step.status}</span>
                              <span style={{ fontSize: 6, color: '#64748b', minWidth: 65 }}>{step.type}</span>
                              <span style={{ fontSize: 7, color: '#e2e8f0', flex: 1 }}>{step.label}</span>
                              {step.branchedTo && <span style={{ fontSize: 6, color: '#f97316' }}>→{step.branchedTo.slice(0, 10)}</span>}
                              {step.result && <span style={{ fontSize: 6, color: '#64748b', maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{step.result}</span>}
                              {step.error && <span style={{ fontSize: 6, color: '#f87171', maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{step.error}</span>}
                            </div>
                          );
                        })}
                        {/* Branch decisions */}
                        {branchDecisions.length > 0 && (
                          <div style={{ marginTop: 5, paddingTop: 4, borderTop: '1px solid rgba(249,115,22,0.1)' }}>
                            <div style={{ fontSize: 6, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>Branch Decisions</div>
                            {branchDecisions.map((bd: any, i: number) => (
                              <div key={i} style={{ display: 'flex', gap: 5, fontSize: 6, color: '#94a3b8', marginBottom: 1 }}>
                                <span style={{ color: '#f97316' }}>{bd.branchType}</span>
                                <span>{bd.fromStepId.slice(0, 10)} → {bd.toStepId.slice(0, 10)}</span>
                                <span style={{ color: '#475569', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{bd.reason}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        {/* Phase 34 — Runtime vars */}
                        {runbookDetailExec.vars && Object.keys(runbookDetailExec.vars).length > 0 && (
                          <div style={{ marginTop: 5, paddingTop: 4, borderTop: '1px solid rgba(249,115,22,0.1)' }}>
                            <div style={{ fontSize: 6, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>Variables</div>
                            {Object.entries(runbookDetailExec.vars).map(([k, v]: [string, any]) => (
                              <div key={k} style={{ display: 'flex', gap: 5, fontSize: 6, color: '#94a3b8', marginBottom: 1 }}>
                                <span style={{ color: '#f97316', fontFamily: 'monospace', minWidth: 80 }}>{k}</span>
                                <span style={{ color: '#e2e8f0', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{String(v)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        {/* Phase 34 — Step outputs */}
                        {runbookDetailExec.stepOutputs && Object.keys(runbookDetailExec.stepOutputs).length > 0 && (
                          <div style={{ marginTop: 5, paddingTop: 4, borderTop: '1px solid rgba(249,115,22,0.1)' }}>
                            <div style={{ fontSize: 6, color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>Step Outputs</div>
                            {Object.entries(runbookDetailExec.stepOutputs).map(([stepId, val]: [string, any]) => (
                              <div key={stepId} style={{ display: 'flex', gap: 5, fontSize: 6, color: '#94a3b8', marginBottom: 1 }}>
                                <span style={{ color: '#64748b', fontFamily: 'monospace', minWidth: 80 }}>{stepId.slice(0, 12)}</span>
                                <span style={{ color: '#e2e8f0', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{String(val)}</span>
                              </div>
                            ))}
                          </div>
                        )}
                        {/* Phase 35 — Pack provenance */}
                        {(runbookDetailExec.packId || runbookDetailExec.packVersion) && (
                          <div style={{ marginTop: 4, display: 'flex', gap: 6, fontSize: 6, color: '#6366f1', alignItems: 'center' }}>
                            <span style={{ fontFamily: 'monospace', padding: '1px 4px', borderRadius: 3, background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.2)' }}>
                              PKG {runbookDetailExec.packId?.slice(0, 14)} @ v{runbookDetailExec.packVersion}
                            </span>
                          </div>
                        )}
                        {runbookDetailExec.error && (
                          <div style={{ marginTop: 4, fontSize: 7, color: '#f87171', padding: '3px 6px', borderRadius: 3, background: 'rgba(239,68,68,0.06)' }}>{runbookDetailExec.error}</div>
                        )}
                      </div>
                    );
                  })()}

                  {/* ── Phase 34: Launch-vars modal ── */}
                  {launchVarsModal && (() => {
                    const rb = launchVarsModal.rb;
                    const vars = rb.variables ?? [];
                    return (
                      <div style={{ position: 'fixed', inset: 0, zIndex: 9000, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <div style={{ width: 320, background: '#0f172a', border: '1px solid rgba(249,115,22,0.4)', borderRadius: 8, padding: '14px 16px' }}>
                          <div style={{ fontSize: 9, fontWeight: 800, color: '#f97316', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Run: {rb.title}</div>
                          <div style={{ fontSize: 7, color: '#64748b', marginBottom: 10 }}>Fill in required variables to launch this runbook.</div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
                            {vars.map((v: any) => (
                              <div key={v.name}>
                                <div style={{ fontSize: 7, color: v.required && !launchVarsModal.vals[v.name] ? '#f87171' : '#94a3b8', marginBottom: 2, display: 'flex', gap: 4 }}>
                                  <span style={{ fontWeight: 600 }}>{v.name}</span>
                                  {v.required && <span style={{ color: '#f87171' }}>*</span>}
                                  {v.description && <span style={{ color: '#475569' }}>— {v.description}</span>}
                                </div>
                                <input
                                  type="text"
                                  value={launchVarsModal.vals[v.name] ?? ''}
                                  placeholder={v.defaultValue ?? (v.required ? 'Required' : 'Optional')}
                                  onChange={e => setLaunchVarsModal(prev => prev ? { ...prev, vals: { ...prev.vals, [v.name]: e.target.value } } : null)}
                                  style={{ width: '100%', background: '#1e293b', border: `1px solid ${v.required && !launchVarsModal.vals[v.name] ? 'rgba(239,68,68,0.4)' : 'rgba(249,115,22,0.25)'}`, borderRadius: 4, color: '#e2e8f0', fontSize: 8, padding: '4px 6px', boxSizing: 'border-box' }}
                                />
                              </div>
                            ))}
                          </div>
                          <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                            <button className="hq-btn" onClick={() => setLaunchVarsModal(null)} style={{ fontSize: 8, padding: '3px 10px', borderRadius: 4, background: 'rgba(100,116,139,0.1)', border: '1px solid rgba(100,116,139,0.3)', color: '#94a3b8', cursor: 'pointer' }}>Cancel</button>
                            <button
                              className="hq-btn"
                              disabled={vars.filter((v: any) => v.required).some((v: any) => !launchVarsModal.vals[v.name])}
                              onClick={async () => {
                                const modal = launchVarsModal;
                                setLaunchVarsModal(null);
                                setRunbookRunning(modal.rb.id);
                                setRunbookErr('');
                                try {
                                  const r = await (window.triforge as any).runbook.run(modal.rb.id, modal.vals);
                                  if (!r.ok) setRunbookErr(`Run failed: ${r.error}`);
                                  await loadRunbookData();
                                } finally { setRunbookRunning(null); }
                              }}
                              style={{ fontSize: 8, fontWeight: 700, padding: '3px 12px', borderRadius: 4, background: 'rgba(34,197,94,0.12)', border: '1px solid rgba(34,197,94,0.35)', color: '#4ade80', cursor: 'pointer' }}
                            >Launch</button>
                          </div>
                        </div>
                      </div>
                    );
                  })()}

                  {/* ── Handoff Queue Panel ── */}
                  {handoffQueue.length > 0 && (() => {
                    const now = Date.now();
                    // Sort: overdue incident > overdue > incident > by creation
                    const sorted = [...handoffQueue].sort((a: any, b: any) => {
                      const aOverdue = !!(a.expiresAt && now >= a.expiresAt);
                      const bOverdue = !!(b.expiresAt && now >= b.expiresAt);
                      if (aOverdue && b.isIncident && !bOverdue) return -1;
                      if (bOverdue && a.isIncident && !aOverdue) return 1;
                      if (a.isIncident !== b.isIncident) return a.isIncident ? -1 : 1;
                      if (aOverdue !== bOverdue) return aOverdue ? -1 : 1;
                      return a.createdAt - b.createdAt;
                    });
                    return (
                    <div style={{ marginTop: 10, borderTop: '1px solid rgba(251,191,36,0.2)', paddingTop: 8 }}>
                      <div style={{ fontSize: 7, fontWeight: 800, color: '#fbbf24', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>
                        Handoff Queue — {handoffQueue.length} Pending
                      </div>
                      {sorted.map((h: any) => {
                        const isOverdue = !!(h.expiresAt && now >= h.expiresAt);
                        const minsLeft  = h.expiresAt ? Math.round((h.expiresAt - now) / 60000) : undefined;
                        const hasSoftEsc = !!(h.escalateAt && now >= h.escalateAt && !h.escalatedAt);
                        const borderColor = isOverdue ? 'rgba(239,68,68,0.5)' : h.isIncident ? 'rgba(239,68,68,0.35)' : hasSoftEsc ? 'rgba(251,191,36,0.4)' : 'rgba(251,191,36,0.25)';
                        const bg = isOverdue ? 'rgba(239,68,68,0.08)' : h.isIncident ? 'rgba(239,68,68,0.06)' : 'rgba(251,191,36,0.04)';
                        return (
                        <div key={h.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '5px 8px', borderRadius: 4, border: `1px solid ${borderColor}`, background: bg, marginBottom: 4 }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                              <span style={{ fontSize: 7, fontWeight: 700, color: isOverdue ? '#ef4444' : h.isIncident ? '#f87171' : '#fbbf24', textTransform: 'uppercase' }}>{h.type}</span>
                              {h.isIncident && <span style={{ fontSize: 6, color: '#f87171', fontWeight: 700 }}>INCIDENT</span>}
                              {isOverdue && <span style={{ fontSize: 6, color: '#ef4444', fontWeight: 800 }}>OVERDUE {Math.abs(minsLeft ?? 0)}m</span>}
                              {!isOverdue && minsLeft !== undefined && minsLeft <= 30 && <span style={{ fontSize: 6, color: '#fbbf24', fontWeight: 700 }}>{minsLeft}m left</span>}
                              {h.escalatedAt && <span style={{ fontSize: 6, color: '#f97316' }}>ESC×{h.escalationCount ?? 1}</span>}
                              {h.onTimeout && <span style={{ fontSize: 6, color: '#64748b' }}>→timeout:{h.onTimeout.slice(0, 8)}</span>}
                              <span style={{ fontSize: 7, color: '#94a3b8' }}>{h.runbookTitle}</span>
                            </div>
                            <div style={{ fontSize: 7, color: '#64748b', marginTop: 1 }}>{h.stepLabel}: {h.blockedReason}</div>
                            {h.actorNeeded && <div style={{ fontSize: 6, color: '#475569', marginTop: 1 }}>Needs: {h.actorNeeded}</div>}
                            {h.onRejection && <div style={{ fontSize: 6, color: '#64748b' }}>Rejection → {h.onRejection.slice(0, 12)}</div>}
                          </div>
                          <div style={{ display: 'flex', gap: 3, flexShrink: 0 }}>
                            {h.type === 'approval' && (
                              <>
                                <button className="hq-btn"
                                  disabled={runbookResuming === h.executionId}
                                  onClick={async () => {
                                    setRunbookResuming(h.executionId);
                                    await (window.triforge as any).runbook.resume(h.executionId, 'approved');
                                    setRunbookResuming(null);
                                    await loadRunbookData();
                                  }}
                                  style={{ fontSize: 7, padding: '2px 7px', borderRadius: 3, background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', color: '#4ade80', cursor: 'pointer' }}
                                >{runbookResuming === h.executionId ? '...' : 'Approve'}</button>
                                <button className="hq-btn"
                                  disabled={runbookResuming === h.executionId}
                                  onClick={async () => {
                                    setRunbookResuming(h.executionId);
                                    await (window.triforge as any).runbook.resume(h.executionId, 'rejected');
                                    setRunbookResuming(null);
                                    await loadRunbookData();
                                  }}
                                  style={{ fontSize: 7, padding: '2px 7px', borderRadius: 3, background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.3)', color: '#f87171', cursor: 'pointer' }}
                                >Reject</button>
                              </>
                            )}
                            {h.type === 'confirm' && (
                              <button className="hq-btn"
                                disabled={runbookResuming === h.executionId}
                                onClick={async () => {
                                  setRunbookResuming(h.executionId);
                                  await (window.triforge as any).runbook.resume(h.executionId, 'confirmed');
                                  setRunbookResuming(null);
                                  await loadRunbookData();
                                }}
                                style={{ fontSize: 7, padding: '2px 7px', borderRadius: 3, background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.3)', color: '#60a5fa', cursor: 'pointer' }}
                              >{runbookResuming === h.executionId ? '...' : 'Confirm'}</button>
                            )}
                            {(h.type === 'manual' || h.type === 'escalation') && (
                              <button className="hq-btn"
                                disabled={runbookResuming === h.executionId}
                                onClick={async () => {
                                  setRunbookResuming(h.executionId);
                                  await (window.triforge as any).runbook.resume(h.executionId, 'manual');
                                  setRunbookResuming(null);
                                  await loadRunbookData();
                                }}
                                style={{ fontSize: 7, padding: '2px 7px', borderRadius: 3, background: 'rgba(59,130,246,0.1)', border: '1px solid rgba(59,130,246,0.3)', color: '#60a5fa', cursor: 'pointer' }}
                              >{runbookResuming === h.executionId ? '...' : 'Done'}</button>
                            )}
                            <button className="hq-btn"
                              disabled={runbookAborting === h.executionId}
                              onClick={async () => {
                                setRunbookAborting(h.executionId);
                                await (window.triforge as any).runbook.abort(h.executionId);
                                setRunbookAborting(null);
                                await loadRunbookData();
                              }}
                              style={{ fontSize: 7, padding: '2px 5px', borderRadius: 3, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.25)', color: '#f87171', cursor: 'pointer' }}
                            >{runbookAborting === h.executionId ? '...' : 'Abort'}</button>
                          </div>
                        </div>
                        );
                      })}
                    </div>
                    );
                  })()}

                  {/* ── Phase 35: Pack Management ── */}
                  <div style={{ marginTop: 12, borderTop: '1px solid rgba(99,102,241,0.2)', paddingTop: 10 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 8 }}>
                      <span style={{ fontSize: 7, fontWeight: 800, color: '#818cf8', textTransform: 'uppercase', letterSpacing: '0.08em' }}>
                        Runbook Packs {installedPacks.length > 0 ? `(${installedPacks.length})` : ''}
                      </span>
                      <button className="hq-btn" onClick={() => { setPackImportModal(true); setPackImportJson(''); setPackImportPreview(null); setPackImportErr(''); }}
                        style={{ fontSize: 7, padding: '1px 7px', borderRadius: 3, background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.3)', color: '#818cf8', cursor: 'pointer' }}>
                        Import Pack
                      </button>
                      {packSelectIds.size > 0 && (
                        <button className="hq-btn"
                          disabled={packExporting}
                          onClick={() => {
                            setPackExportMeta({ name: '', version: '1.0.0', description: '', author: '', changelog: '' });
                            setPackExportModal(null);
                            setPackExporting(false);
                            setPackActionErr('');
                            // Open export meta form (json will be generated after meta is filled)
                            setPackExportModal({ runbookIds: Array.from(packSelectIds), json: '' });
                          }}
                          style={{ fontSize: 7, padding: '1px 7px', borderRadius: 3, background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.3)', color: '#818cf8', cursor: 'pointer' }}>
                          Export {packSelectIds.size} Selected
                        </button>
                      )}
                    </div>

                    {/* Installed packs list */}
                    {installedPacks.length === 0 ? (
                      <div style={{ fontSize: 7, color: '#475569', padding: '6px 0' }}>No packs installed. Import a pack JSON to get started.</div>
                    ) : (
                      installedPacks.map((pk: any) => {
                        const canRollback = (pk.previousVersions ?? []).length > 0;
                        const trustStatus: string = pk.trustStatus ?? 'unsigned';
                        const trustColor = trustStatus === 'trusted' ? '#4ade80' : trustStatus === 'unsigned' ? '#94a3b8' : '#f87171';
                        const trustLabel = trustStatus === 'trusted' ? `SIGNED by ${pk.signerName ?? pk.signer}` : trustStatus === 'unsigned' ? 'UNSIGNED' : trustStatus.toUpperCase();
                        return (
                          <div key={pk.packId} style={{ border: '1px solid rgba(99,102,241,0.2)', borderRadius: 6, padding: '7px 10px', marginBottom: 6, background: 'rgba(99,102,241,0.03)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                              <span style={{ fontSize: 9, fontWeight: 700, color: '#e2e8f0', flex: 1 }}>{pk.name}</span>
                              <span style={{ fontSize: 6, padding: '1px 5px', borderRadius: 10, background: 'rgba(99,102,241,0.15)', color: '#818cf8', fontFamily: 'monospace', fontWeight: 700 }}>v{pk.version}</span>
                              <span style={{ fontSize: 6, padding: '1px 5px', borderRadius: 10, background: `${trustColor}18`, color: trustColor, fontWeight: 700 }}>{trustLabel}</span>
                              {!pk.enabled && <span style={{ fontSize: 6, color: '#64748b', padding: '1px 3px', borderRadius: 2, border: '1px solid rgba(100,116,139,0.3)' }}>OFF</span>}
                            </div>
                            {pk.description && <div style={{ fontSize: 7, color: '#64748b', marginBottom: 3 }}>{pk.description}</div>}
                            {pk.changelog && <div style={{ fontSize: 6, color: '#475569', marginBottom: 3, fontStyle: 'italic' }}>{pk.changelog}</div>}
                            <div style={{ display: 'flex', gap: 6, marginBottom: 4, flexWrap: 'wrap' }}>
                              <span style={{ fontSize: 6, color: '#64748b' }}>Runbooks: {(pk.runbookIds ?? []).length}</span>
                              {(pk.requiredIntegrations ?? []).length > 0 && <span style={{ fontSize: 6, color: '#64748b' }}>Integrations: {pk.requiredIntegrations.join(', ')}</span>}
                              <span style={{ fontSize: 6, color: '#475569', fontFamily: 'monospace' }}>{pk.packId?.slice(0, 16)}</span>
                            </div>
                            {canRollback && (
                              <div style={{ fontSize: 6, color: '#64748b', marginBottom: 4 }}>
                                Rollback available: {(pk.previousVersions ?? []).map((s: any) => `v${s.version}`).join(', ')}
                              </div>
                            )}
                            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                              {canRollback && (
                                <button className="hq-btn"
                                  onClick={async () => {
                                    setPackActionErr('');
                                    const r = await (window.triforge as any).pack.rollback(pk.packId);
                                    if (!r.ok) { setPackActionErr(`Rollback failed: ${r.error}`); }
                                    else { await loadRunbookData(); }
                                  }}
                                  style={{ fontSize: 7, padding: '2px 8px', borderRadius: 4, background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.3)', color: '#fbbf24', cursor: 'pointer' }}>
                                  Rollback to v{pk.previousVersions?.[0]?.version}
                                </button>
                              )}
                              <button className="hq-btn"
                                onClick={async () => {
                                  if (!confirm(`Uninstall pack "${pk.name}" and all its runbooks?`)) return;
                                  setPackActionErr('');
                                  const r = await (window.triforge as any).pack.uninstall(pk.packId);
                                  if (!r.ok) { setPackActionErr(`Uninstall failed: ${r.error}`); }
                                  else { await loadRunbookData(); }
                                }}
                                style={{ fontSize: 7, padding: '2px 8px', borderRadius: 4, background: 'rgba(239,68,68,0.06)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171', cursor: 'pointer' }}>
                                Uninstall
                              </button>
                            </div>
                          </div>
                        );
                      })
                    )}
                    {packActionErr && <div style={{ fontSize: 7, color: '#f87171', marginTop: 4 }}>{packActionErr}</div>}

                    {/* ── Phase 36: Trusted Signers ── */}
                    <div style={{ marginTop: 12, borderTop: '1px solid rgba(99,102,241,0.15)', paddingTop: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                        <span style={{ fontSize: 7, fontWeight: 800, color: '#818cf8', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Trusted Signers</span>
                        <button className="hq-btn" onClick={() => { setSignerModal(true); setSignerName(''); setSignerEmail(''); setSignerPem(''); setSignerErr(''); }}
                          style={{ fontSize: 7, padding: '1px 7px', borderRadius: 3, background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.3)', color: '#818cf8', cursor: 'pointer' }}>
                          Add Signer
                        </button>
                      </div>
                      {localKeyInfo && (
                        <div style={{ marginBottom: 6, padding: '5px 8px', borderRadius: 4, background: 'rgba(74,222,128,0.05)', border: '1px solid rgba(74,222,128,0.2)' }}>
                          <div style={{ fontSize: 6, color: '#4ade80', fontWeight: 700, marginBottom: 2 }}>This workspace's signing key</div>
                          <div style={{ fontSize: 6, color: '#64748b', fontFamily: 'monospace' }}>{localKeyInfo.keyId}</div>
                          <div style={{ fontSize: 6, color: '#475569', marginTop: 2 }}>Share your public key (in signer settings) so other workspaces can trust packs you sign.</div>
                        </div>
                      )}
                      {trustedSigners.length === 0 ? (
                        <div style={{ fontSize: 7, color: '#475569', padding: '4px 0' }}>No trusted signers configured. Add a signer's public key to verify their packs.</div>
                      ) : trustedSigners.map((sig: any) => (
                        <div key={sig.keyId} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', borderRadius: 4, background: sig.revoked ? 'rgba(239,68,68,0.05)' : 'rgba(99,102,241,0.04)', border: `1px solid ${sig.revoked ? 'rgba(239,68,68,0.2)' : 'rgba(99,102,241,0.15)'}`, marginBottom: 4 }}>
                          <div style={{ flex: 1 }}>
                            <div style={{ fontSize: 7, fontWeight: 600, color: sig.revoked ? '#64748b' : '#e2e8f0' }}>{sig.name} {sig.revoked && <span style={{ fontSize: 6, color: '#f87171' }}>[REVOKED]</span>}</div>
                            {sig.email && <div style={{ fontSize: 6, color: '#64748b' }}>{sig.email}</div>}
                            <div style={{ fontSize: 6, color: '#475569', fontFamily: 'monospace' }}>{sig.keyId}</div>
                          </div>
                          {!sig.revoked && (
                            <button className="hq-btn" onClick={async () => {
                              await (window.triforge as any).pack.trust.revokeSigner(sig.keyId);
                              await loadRunbookData();
                            }} style={{ fontSize: 6, padding: '1px 5px', borderRadius: 3, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171', cursor: 'pointer' }}>Revoke</button>
                          )}
                          <button className="hq-btn" onClick={async () => {
                            if (!confirm(`Remove signer "${sig.name}"?`)) return;
                            await (window.triforge as any).pack.trust.removeSigner(sig.keyId);
                            await loadRunbookData();
                          }} style={{ fontSize: 6, padding: '1px 5px', borderRadius: 3, background: 'rgba(100,116,139,0.08)', border: '1px solid rgba(100,116,139,0.2)', color: '#94a3b8', cursor: 'pointer' }}>Remove</button>
                        </div>
                      ))}
                    </div>

                    {/* ── Phase 36: Trust Policy ── */}
                    <div style={{ marginTop: 10, borderTop: '1px solid rgba(99,102,241,0.15)', paddingTop: 10 }}>
                      <div style={{ fontSize: 7, fontWeight: 800, color: '#818cf8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Trust Policy</div>
                      {[
                        { key: 'allowUnsigned',                  label: 'Allow unsigned packs',                         defaultVal: true },
                        { key: 'allowUnknownSigners',            label: 'Allow unknown signers',                        defaultVal: true },
                        { key: 'requireAdminApprovalForInstall', label: 'Require admin approval for new pack installs',  defaultVal: false },
                        { key: 'requireConfirmOnRiskIncrease',   label: 'Require confirmation when update increases risk', defaultVal: false },
                        { key: 'blockNewDestinations',           label: 'Block updates that introduce new destinations', defaultVal: false },
                      ].map(({ key, label, defaultVal }) => (
                        <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 5 }}>
                          <input type="checkbox"
                            checked={packTrustPolicy[key] !== undefined ? !!packTrustPolicy[key] : defaultVal}
                            onChange={async e => {
                              const updated = { ...packTrustPolicy, [key]: e.target.checked };
                              setPackTrustPolicy(updated);
                              setPackTrustPolicySaving(true);
                              try { await (window.triforge as any).pack.trust.setPolicy(updated); } finally { setPackTrustPolicySaving(false); }
                            }}
                            style={{ accentColor: '#818cf8' }}
                          />
                          <span style={{ fontSize: 7, color: '#94a3b8' }}>{label}</span>
                        </div>
                      ))}
                      {packTrustPolicySaving && <div style={{ fontSize: 6, color: '#818cf8', marginTop: 4 }}>Saving…</div>}
                    </div>
                  </div>

                  {/* ── Phase 35: Import modal ── */}
                  {packImportModal && (
                    <div style={{ position: 'fixed', inset: 0, zIndex: 9100, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <div style={{ width: 440, maxHeight: '80vh', overflowY: 'auto', background: '#0f172a', border: '1px solid rgba(99,102,241,0.4)', borderRadius: 8, padding: '14px 16px' }}>
                        <div style={{ fontSize: 9, fontWeight: 800, color: '#818cf8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Import Runbook Pack</div>
                        {!packImportPreview ? (
                          <>
                            <div style={{ fontSize: 7, color: '#64748b', marginBottom: 6 }}>Paste the pack JSON below to preview before installing.</div>
                            <textarea
                              value={packImportJson}
                              onChange={e => { setPackImportJson(e.target.value); setPackImportErr(''); }}
                              placeholder='{ "schemaVersion": "35", "id": "pack_...", ... }'
                              rows={8}
                              style={{ width: '100%', background: '#1e293b', border: '1px solid rgba(99,102,241,0.25)', borderRadius: 4, color: '#e2e8f0', fontSize: 7, padding: '6px 8px', fontFamily: 'monospace', resize: 'vertical', boxSizing: 'border-box' }}
                            />
                            {packImportErr && <div style={{ fontSize: 7, color: '#f87171', marginTop: 4 }}>{packImportErr}</div>}
                            <div style={{ display: 'flex', gap: 6, marginTop: 8, justifyContent: 'flex-end' }}>
                              <button className="hq-btn" onClick={() => setPackImportModal(false)} style={{ fontSize: 8, padding: '3px 10px', borderRadius: 4, background: 'rgba(100,116,139,0.1)', border: '1px solid rgba(100,116,139,0.3)', color: '#94a3b8', cursor: 'pointer' }}>Cancel</button>
                              <button className="hq-btn"
                                disabled={!packImportJson.trim()}
                                onClick={async () => {
                                  setPackImportErr('');
                                  const r = await (window.triforge as any).pack.previewImport(packImportJson.trim());
                                  if (!r.ok) { setPackImportErr(r.error ?? 'Parse failed'); }
                                  else { setPackImportPreview(r.preview); }
                                }}
                                style={{ fontSize: 8, fontWeight: 700, padding: '3px 12px', borderRadius: 4, background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.35)', color: '#818cf8', cursor: 'pointer' }}>
                                Preview
                              </button>
                            </div>
                          </>
                        ) : (
                          <>
                            <div style={{ fontSize: 8, fontWeight: 700, color: '#e2e8f0', marginBottom: 4 }}>
                              {packImportPreview.pack?.name} <span style={{ color: '#818cf8', fontFamily: 'monospace' }}>v{packImportPreview.pack?.version}</span>
                              {packImportPreview.isUpdate && <span style={{ fontSize: 6, color: '#fbbf24', marginLeft: 6 }}>UPDATE (was v{packImportPreview.existingVersion})</span>}
                            </div>
                            {packImportPreview.pack?.description && <div style={{ fontSize: 7, color: '#94a3b8', marginBottom: 6 }}>{packImportPreview.pack.description}</div>}

                            {/* Phase 36 — Trust badge */}
                            {(() => {
                              const trust = packImportPreview.trust;
                              if (!trust) return null;
                              const trustColor = trust.status === 'trusted' ? '#4ade80' : trust.status === 'unsigned' ? '#94a3b8' : '#f87171';
                              const trustLabel = trust.status === 'trusted'
                                ? `Signed by ${trust.signerName}`
                                : trust.status === 'unsigned' ? 'Unsigned pack'
                                : trust.status === 'unknown_signer' ? `Unknown signer: ${trust.signerName ?? trust.keyId}`
                                : `Signature ${trust.status}`;
                              return (
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, padding: '5px 8px', borderRadius: 4, background: `${trustColor}08`, border: `1px solid ${trustColor}28` }}>
                                  <span style={{ fontSize: 7, color: trustColor, fontWeight: 700 }}>
                                    {trust.status === 'trusted' ? '✓' : trust.status === 'invalid' ? '✗' : '?'} {trustLabel}
                                  </span>
                                  {trust.error && <span style={{ fontSize: 6, color: '#f87171' }}>{trust.error}</span>}
                                </div>
                              );
                            })()}

                            {/* Phase 36 — Policy block */}
                            {packImportPreview.policyBlocked && (
                              <div style={{ marginBottom: 8, padding: '6px 8px', borderRadius: 4, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.3)' }}>
                                <div style={{ fontSize: 7, fontWeight: 700, color: '#f87171', marginBottom: 2 }}>Blocked by workspace policy</div>
                                <div style={{ fontSize: 7, color: '#fca5a5' }}>{packImportPreview.policyBlockReason}</div>
                              </div>
                            )}

                            {/* Phase 36 — Soft confirm warnings */}
                            {!packImportPreview.policyBlocked && (packImportPreview.confirmReasons ?? []).length > 0 && (
                              <div style={{ marginBottom: 8, padding: '6px 8px', borderRadius: 4, background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.25)' }}>
                                <div style={{ fontSize: 7, fontWeight: 700, color: '#fbbf24', marginBottom: 4 }}>Review before installing</div>
                                {(packImportPreview.confirmReasons as string[]).map((r: string, i: number) => (
                                  <div key={i} style={{ fontSize: 7, color: '#fde68a', marginBottom: 2 }}>• {r}</div>
                                ))}
                              </div>
                            )}

                            <div style={{ fontSize: 7, color: '#94a3b8', marginBottom: 3, fontWeight: 600 }}>Runbooks ({(packImportPreview.runbooks ?? []).length})</div>
                            <div style={{ marginBottom: 8 }}>
                              {(packImportPreview.runbooks ?? []).map((rb: any) => (
                                <div key={rb.id} style={{ display: 'flex', gap: 5, alignItems: 'center', fontSize: 7, color: '#e2e8f0', marginBottom: 2 }}>
                                  <span style={{ color: rb.isUpdate ? '#fbbf24' : '#4ade80', minWidth: 40 }}>{rb.isUpdate ? 'UPDATE' : 'NEW'}</span>
                                  <span style={{ flex: 1 }}>{rb.title}</span>
                                  <span style={{ fontSize: 6, color: '#64748b' }}>{rb.stepCount} steps</span>
                                  {rb.hasIncidentMode && <span style={{ fontSize: 6, color: '#f87171' }}>INC</span>}
                                </div>
                              ))}
                            </div>

                            {/* Phase 36 — Diff view (updates only) */}
                            {packImportPreview.diff && !packImportPreview.diff.isEmpty && (
                              <div style={{ marginBottom: 8, padding: '6px 8px', borderRadius: 4, background: 'rgba(99,102,241,0.05)', border: '1px solid rgba(99,102,241,0.2)' }}>
                                <div style={{ fontSize: 7, fontWeight: 700, color: '#818cf8', marginBottom: 4 }}>Changes in this update</div>
                                {(packImportPreview.diff.runbooks ?? []).filter((r: any) => r.isNew).length > 0 && (
                                  <div style={{ fontSize: 7, color: '#4ade80', marginBottom: 2 }}>+ {packImportPreview.diff.runbooks.filter((r: any) => r.isNew).length} new runbook(s)</div>
                                )}
                                {(packImportPreview.diff.runbooks ?? []).filter((r: any) => r.isRemoved).length > 0 && (
                                  <div style={{ fontSize: 7, color: '#f87171', marginBottom: 2 }}>- {packImportPreview.diff.runbooks.filter((r: any) => r.isRemoved).map((r: any) => r.title).join(', ')}</div>
                                )}
                                {(packImportPreview.diff.runbooks ?? []).filter((r: any) => !r.isNew && !r.isRemoved).map((r: any) => (
                                  <div key={r.id} style={{ fontSize: 7, color: '#94a3b8', marginBottom: 1 }}>
                                    ~ {r.title}: {r.steps.added > 0 ? `+${r.steps.added} ` : ''}{r.steps.removed > 0 ? `-${r.steps.removed} ` : ''}{r.steps.modified > 0 ? `~${r.steps.modified} steps` : ''}
                                    {r.integrationsAdded.length > 0 && <span style={{ color: '#fbbf24', marginLeft: 4 }}>+intg: {r.integrationsAdded.join(', ')}</span>}
                                    {r.incidentModeChanged && <span style={{ color: '#f87171', marginLeft: 4 }}>incident mode changed</span>}
                                  </div>
                                ))}
                                {(packImportPreview.diff.integrationsAdded ?? []).length > 0 && (
                                  <div style={{ fontSize: 7, color: '#fbbf24', marginTop: 2 }}>New integrations: {packImportPreview.diff.integrationsAdded.join(', ')}</div>
                                )}
                                {(packImportPreview.diff.destinationsAdded ?? []).length > 0 && (
                                  <div style={{ fontSize: 7, color: '#f87171', marginTop: 2 }}>New destinations: {packImportPreview.diff.destinationsAdded.join(', ')}</div>
                                )}
                                {packImportPreview.diff.totalStepDelta !== 0 && (
                                  <div style={{ fontSize: 6, color: '#64748b', marginTop: 2 }}>Step delta: {packImportPreview.diff.totalStepDelta > 0 ? '+' : ''}{packImportPreview.diff.totalStepDelta}</div>
                                )}
                              </div>
                            )}

                            {(packImportPreview.missingIntegrations ?? []).length > 0 && (
                              <div style={{ fontSize: 7, color: '#fbbf24', marginBottom: 6, padding: '4px 6px', borderRadius: 3, background: 'rgba(251,191,36,0.06)', border: '1px solid rgba(251,191,36,0.2)' }}>
                                Missing integrations: {packImportPreview.missingIntegrations.join(', ')}
                              </div>
                            )}
                            <div style={{ fontSize: 7, color: '#64748b', marginBottom: 8, padding: '4px 6px', borderRadius: 3, background: 'rgba(99,102,241,0.04)', border: '1px solid rgba(99,102,241,0.15)' }}>
                              {packImportPreview.riskSummary}
                            </div>
                            {packImportErr && <div style={{ fontSize: 7, color: '#f87171', marginBottom: 6 }}>{packImportErr}</div>}
                            <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                              <button className="hq-btn" onClick={() => setPackImportPreview(null)} style={{ fontSize: 8, padding: '3px 10px', borderRadius: 4, background: 'rgba(100,116,139,0.1)', border: '1px solid rgba(100,116,139,0.3)', color: '#94a3b8', cursor: 'pointer' }}>Back</button>
                              <button className="hq-btn" onClick={() => { setPackImportModal(false); setPackImportPreview(null); }} style={{ fontSize: 8, padding: '3px 10px', borderRadius: 4, background: 'rgba(100,116,139,0.1)', border: '1px solid rgba(100,116,139,0.3)', color: '#94a3b8', cursor: 'pointer' }}>Cancel</button>
                              <button className="hq-btn"
                                disabled={packImporting || packImportPreview.policyBlocked}
                                onClick={async () => {
                                  setPackImporting(true);
                                  setPackImportErr('');
                                  try {
                                    const r = await (window.triforge as any).pack.import(packImportJson.trim());
                                    if (!r.ok) { setPackImportErr(r.error ?? 'Install failed'); }
                                    else { setPackImportModal(false); setPackImportPreview(null); await loadRunbookData(); }
                                  } finally { setPackImporting(false); }
                                }}
                                style={{ fontSize: 8, fontWeight: 700, padding: '3px 14px', borderRadius: 4, background: packImportPreview.policyBlocked ? 'rgba(100,116,139,0.1)' : 'rgba(99,102,241,0.15)', border: packImportPreview.policyBlocked ? '1px solid rgba(100,116,139,0.3)' : '1px solid rgba(99,102,241,0.4)', color: packImportPreview.policyBlocked ? '#64748b' : '#818cf8', cursor: packImportPreview.policyBlocked ? 'not-allowed' : 'pointer' }}>
                                {packImporting ? 'Installing…' : packImportPreview.isUpdate ? 'Update Pack' : 'Install Pack'}
                              </button>
                            </div>
                          </>
                        )}
                      </div>
                    </div>
                  )}

                  {/* ── Phase 35: Export modal ── */}
                  {packExportModal && !packExportModal.json && (
                    <div style={{ position: 'fixed', inset: 0, zIndex: 9100, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <div style={{ width: 360, background: '#0f172a', border: '1px solid rgba(99,102,241,0.4)', borderRadius: 8, padding: '14px 16px' }}>
                        <div style={{ fontSize: 9, fontWeight: 800, color: '#818cf8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>
                          Export {packExportModal.runbookIds.length} Runbook{packExportModal.runbookIds.length > 1 ? 's' : ''} as Pack
                        </div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
                          {[
                            { key: 'name',        placeholder: 'Pack name *',        label: 'Name' },
                            { key: 'version',     placeholder: '1.0.0',              label: 'Version' },
                            { key: 'description', placeholder: 'Pack description',   label: 'Description' },
                            { key: 'author',      placeholder: 'Author (optional)',   label: 'Author' },
                            { key: 'changelog',   placeholder: 'Release notes (opt)', label: 'Changelog' },
                          ].map(({ key, placeholder }) => (
                            <input key={key} type="text"
                              value={(packExportMeta as any)[key]}
                              placeholder={placeholder}
                              onChange={e => setPackExportMeta(m => ({ ...m, [key]: e.target.value }))}
                              style={{ background: '#1e293b', border: '1px solid rgba(99,102,241,0.25)', borderRadius: 4, color: '#e2e8f0', fontSize: 8, padding: '4px 6px' }}
                            />
                          ))}
                        </div>
                        {packActionErr && <div style={{ fontSize: 7, color: '#f87171', marginBottom: 6 }}>{packActionErr}</div>}
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                          <button className="hq-btn" onClick={() => { setPackExportModal(null); setPackActionErr(''); }} style={{ fontSize: 8, padding: '3px 10px', borderRadius: 4, background: 'rgba(100,116,139,0.1)', border: '1px solid rgba(100,116,139,0.3)', color: '#94a3b8', cursor: 'pointer' }}>Cancel</button>
                          <button className="hq-btn"
                            disabled={!packExportMeta.name.trim() || packExporting}
                            onClick={async () => {
                              setPackExporting(true);
                              setPackActionErr('');
                              try {
                                const r = await (window.triforge as any).pack.export(
                                  packExportModal.runbookIds,
                                  { name: packExportMeta.name, version: packExportMeta.version || '1.0.0', description: packExportMeta.description, author: packExportMeta.author, changelog: packExportMeta.changelog },
                                );
                                if (!r.ok) { setPackActionErr(r.error ?? 'Export failed'); }
                                else { setPackExportModal({ ...packExportModal, json: r.json ?? '' }); }
                              } finally { setPackExporting(false); }
                            }}
                            style={{ fontSize: 8, fontWeight: 700, padding: '3px 12px', borderRadius: 4, background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.35)', color: '#818cf8', cursor: !packExportMeta.name.trim() ? 'not-allowed' : 'pointer' }}>
                            {packExporting ? 'Exporting…' : 'Generate JSON'}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                  {packExportModal?.json && (
                    <div style={{ position: 'fixed', inset: 0, zIndex: 9100, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <div style={{ width: 500, maxHeight: '80vh', background: '#0f172a', border: '1px solid rgba(99,102,241,0.4)', borderRadius: 8, padding: '14px 16px', display: 'flex', flexDirection: 'column' }}>
                        <div style={{ fontSize: 9, fontWeight: 800, color: '#818cf8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Pack JSON — Copy to Share</div>
                        <textarea
                          readOnly value={packExportModal.json}
                          rows={14}
                          style={{ flex: 1, background: '#1e293b', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 4, color: '#94a3b8', fontSize: 7, padding: '6px 8px', fontFamily: 'monospace', resize: 'none' }}
                        />
                        <div style={{ display: 'flex', gap: 6, marginTop: 8, justifyContent: 'flex-end' }}>
                          <button className="hq-btn"
                            onClick={() => { setPackSignName(''); setPackSignEmail(''); setPackSignErr(''); setPackSigningModal({ json: packExportModal.json }); }}
                            style={{ fontSize: 8, padding: '3px 10px', borderRadius: 4, background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.25)', color: '#4ade80', cursor: 'pointer' }}>
                            Sign Pack
                          </button>
                          <button className="hq-btn"
                            onClick={() => { try { (navigator as any).clipboard?.writeText(packExportModal.json); } catch {} }}
                            style={{ fontSize: 8, padding: '3px 10px', borderRadius: 4, background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.3)', color: '#818cf8', cursor: 'pointer' }}>
                            Copy
                          </button>
                          <button className="hq-btn" onClick={() => { setPackExportModal(null); setPackSelectIds(new Set()); }} style={{ fontSize: 8, padding: '3px 10px', borderRadius: 4, background: 'rgba(100,116,139,0.1)', border: '1px solid rgba(100,116,139,0.3)', color: '#94a3b8', cursor: 'pointer' }}>Close</button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ── Phase 36: Sign Pack modal ── */}
                  {packSigningModal && (
                    <div style={{ position: 'fixed', inset: 0, zIndex: 9200, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <div style={{ width: 360, background: '#0f172a', border: '1px solid rgba(74,222,128,0.3)', borderRadius: 8, padding: '14px 16px' }}>
                        <div style={{ fontSize: 9, fontWeight: 800, color: '#4ade80', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Sign Pack</div>
                        <div style={{ fontSize: 7, color: '#64748b', marginBottom: 8 }}>
                          Sign this pack with your local workspace key so recipients can verify its origin.
                          {localKeyInfo && <span style={{ color: '#475569' }}> Your key ID: <span style={{ fontFamily: 'monospace' }}>{localKeyInfo.keyId}</span></span>}
                        </div>
                        <input type="text" placeholder="Your name *"
                          value={packSignName} onChange={e => setPackSignName(e.target.value)}
                          style={{ width: '100%', marginBottom: 6, background: '#1e293b', border: '1px solid rgba(74,222,128,0.2)', borderRadius: 4, color: '#e2e8f0', fontSize: 8, padding: '4px 6px', boxSizing: 'border-box' }} />
                        <input type="text" placeholder="Email (optional)"
                          value={packSignEmail} onChange={e => setPackSignEmail(e.target.value)}
                          style={{ width: '100%', marginBottom: 8, background: '#1e293b', border: '1px solid rgba(74,222,128,0.2)', borderRadius: 4, color: '#e2e8f0', fontSize: 8, padding: '4px 6px', boxSizing: 'border-box' }} />
                        {packSignErr && <div style={{ fontSize: 7, color: '#f87171', marginBottom: 6 }}>{packSignErr}</div>}
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                          <button className="hq-btn" onClick={() => setPackSigningModal(null)} style={{ fontSize: 8, padding: '3px 10px', borderRadius: 4, background: 'rgba(100,116,139,0.1)', border: '1px solid rgba(100,116,139,0.3)', color: '#94a3b8', cursor: 'pointer' }}>Cancel</button>
                          <button className="hq-btn"
                            disabled={!packSignName.trim() || packSigning}
                            onClick={async () => {
                              setPackSigning(true);
                              setPackSignErr('');
                              try {
                                const r = await (window.triforge as any).pack.trust.signPack(packSigningModal.json, packSignName.trim(), packSignEmail.trim() || undefined);
                                if (!r.ok) { setPackSignErr(r.error ?? 'Signing failed'); }
                                else {
                                  setPackSigningModal(null);
                                  setPackExportModal(prev => prev ? { ...prev, json: r.json } : null);
                                }
                              } finally { setPackSigning(false); }
                            }}
                            style={{ fontSize: 8, fontWeight: 700, padding: '3px 12px', borderRadius: 4, background: 'rgba(74,222,128,0.12)', border: '1px solid rgba(74,222,128,0.35)', color: '#4ade80', cursor: !packSignName.trim() ? 'not-allowed' : 'pointer' }}>
                            {packSigning ? 'Signing…' : 'Sign & Replace JSON'}
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* ── Phase 36: Add Signer modal ── */}
                  {signerModal && (
                    <div style={{ position: 'fixed', inset: 0, zIndex: 9200, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <div style={{ width: 420, background: '#0f172a', border: '1px solid rgba(99,102,241,0.4)', borderRadius: 8, padding: '14px 16px' }}>
                        <div style={{ fontSize: 9, fontWeight: 800, color: '#818cf8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Add Trusted Signer</div>
                        <div style={{ fontSize: 7, color: '#64748b', marginBottom: 8 }}>Paste the signer's public key PEM to add them to your trusted list. Future packs signed by this key will show as "Trusted".</div>
                        <input type="text" placeholder="Name *"
                          value={signerName} onChange={e => setSignerName(e.target.value)}
                          style={{ width: '100%', marginBottom: 6, background: '#1e293b', border: '1px solid rgba(99,102,241,0.25)', borderRadius: 4, color: '#e2e8f0', fontSize: 8, padding: '4px 6px', boxSizing: 'border-box' }} />
                        <input type="text" placeholder="Email (optional)"
                          value={signerEmail} onChange={e => setSignerEmail(e.target.value)}
                          style={{ width: '100%', marginBottom: 6, background: '#1e293b', border: '1px solid rgba(99,102,241,0.25)', borderRadius: 4, color: '#e2e8f0', fontSize: 8, padding: '4px 6px', boxSizing: 'border-box' }} />
                        <textarea placeholder="-----BEGIN PUBLIC KEY-----&#10;...&#10;-----END PUBLIC KEY-----"
                          value={signerPem} onChange={e => { setSignerPem(e.target.value); setSignerErr(''); }}
                          rows={6}
                          style={{ width: '100%', marginBottom: 8, background: '#1e293b', border: '1px solid rgba(99,102,241,0.25)', borderRadius: 4, color: '#94a3b8', fontSize: 7, padding: '6px 8px', fontFamily: 'monospace', resize: 'vertical', boxSizing: 'border-box' }} />
                        {signerErr && <div style={{ fontSize: 7, color: '#f87171', marginBottom: 6 }}>{signerErr}</div>}
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                          <button className="hq-btn" onClick={() => setSignerModal(false)} style={{ fontSize: 8, padding: '3px 10px', borderRadius: 4, background: 'rgba(100,116,139,0.1)', border: '1px solid rgba(100,116,139,0.3)', color: '#94a3b8', cursor: 'pointer' }}>Cancel</button>
                          <button className="hq-btn"
                            disabled={!signerName.trim() || !signerPem.trim()}
                            onClick={async () => {
                              setSignerErr('');
                              const r = await (window.triforge as any).pack.trust.addSigner({
                                name: signerName.trim(),
                                email: signerEmail.trim() || undefined,
                                publicKeyPem: signerPem.trim(),
                                keyId: '',
                                addedAt: Date.now(),
                                revoked: false,
                              });
                              if (!r.ok) { setSignerErr(r.error ?? 'Failed to add signer'); }
                              else { setSignerModal(false); await loadRunbookData(); }
                            }}
                            style={{ fontSize: 8, fontWeight: 700, padding: '3px 12px', borderRadius: 4, background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.35)', color: '#818cf8', cursor: !signerName.trim() || !signerPem.trim() ? 'not-allowed' : 'pointer' }}>
                            Add Signer
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── Phase 37: Analytics tab ── */}
              {dispatchTab === 'analytics' && (
                <div>
                  {/* Window selector */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 12 }}>
                    <span style={{ fontSize: 7, fontWeight: 700, color: '#94a3b8' }}>Window:</span>
                    {(['24h', '7d', '30d'] as const).map(w => (
                      <button key={w} onClick={() => setAnalyticsWindow(w)}
                        style={{ fontSize: 7, padding: '2px 8px', borderRadius: 3, border: 'none', cursor: 'pointer', fontWeight: 600,
                          background: analyticsWindow === w ? '#f97316' : 'rgba(249,115,22,0.1)',
                          color: analyticsWindow === w ? '#fff' : '#f97316' }}>
                        {w}
                      </button>
                    ))}
                    <button onClick={() => loadAnalytics(analyticsWindow)}
                      style={{ fontSize: 7, padding: '2px 8px', borderRadius: 3, background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.3)', color: '#818cf8', cursor: 'pointer' }}>
                      {analyticsLoading ? 'Loading…' : 'Refresh'}
                    </button>
                    {analyticsReport && (
                      <button onClick={async () => {
                        const r = await (window.triforge as any).analytics.exportText(analyticsWindow);
                        if (r.ok) setAnalyticsExportText(r.text);
                      }}
                        style={{ fontSize: 7, padding: '2px 8px', borderRadius: 3, background: 'rgba(74,222,128,0.08)', border: '1px solid rgba(74,222,128,0.25)', color: '#4ade80', cursor: 'pointer' }}>
                        Export Report
                      </button>
                    )}
                  </div>

                  {analyticsErr && <div style={{ fontSize: 7, color: '#f87171', marginBottom: 8 }}>{analyticsErr}</div>}

                  {analyticsReport && (() => {
                    const r = analyticsReport as any;
                    const usage = r.usage ?? {};
                    const roi   = r.roi ?? {};
                    const gov   = r.governance ?? {};
                    const timeSavedH = (roi.estimatedTimeSavedMin ?? 0) >= 60
                      ? `${Math.round((roi.estimatedTimeSavedMin / 60) * 10) / 10}h`
                      : `${roi.estimatedTimeSavedMin ?? 0}min`;

                    return (
                      <>
                        {/* Summary cards */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginBottom: 12 }}>
                          {[
                            { label: 'Runbook Runs',       value: usage.runbookRuns ?? 0,         color: '#f97316' },
                            { label: 'Time Saved (est.)',  value: timeSavedH,                      color: '#4ade80' },
                            { label: 'Auto Successes',     value: roi.automatedSuccesses ?? 0,    color: '#818cf8' },
                            { label: 'Risk Blocked',       value: roi.blockedRiskyActions ?? 0,   color: '#f87171' },
                          ].map(({ label, value, color }) => (
                            <div key={label} style={{ padding: '8px 10px', borderRadius: 6, background: `${color}08`, border: `1px solid ${color}28` }}>
                              <div style={{ fontSize: 6, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 2 }}>{label}</div>
                              <div style={{ fontSize: 14, fontWeight: 800, color }}>{value}</div>
                            </div>
                          ))}
                        </div>

                        {/* Secondary cards */}
                        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 6, marginBottom: 12 }}>
                          {[
                            { label: 'Incident Runs',     value: usage.incidentRuns ?? 0,       color: '#f87171' },
                            { label: 'Pack Installs',     value: usage.packInstalls ?? 0,       color: '#818cf8' },
                            { label: 'Pack Updates',      value: usage.packUpdates ?? 0,        color: '#fbbf24' },
                            { label: 'Intg Events',       value: usage.integrationEvents ?? 0,  color: '#4ade80' },
                          ].map(({ label, value, color }) => (
                            <div key={label} style={{ padding: '6px 10px', borderRadius: 5, background: 'rgba(99,102,241,0.04)', border: '1px solid rgba(99,102,241,0.14)' }}>
                              <div style={{ fontSize: 6, color: '#64748b', fontWeight: 700, textTransform: 'uppercase', marginBottom: 1 }}>{label}</div>
                              <div style={{ fontSize: 11, fontWeight: 700, color }}>{value}</div>
                            </div>
                          ))}
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                          {/* Top Runbooks */}
                          <div style={{ padding: '8px 10px', borderRadius: 6, background: 'rgba(249,115,22,0.04)', border: '1px solid rgba(249,115,22,0.18)' }}>
                            <div style={{ fontSize: 7, fontWeight: 800, color: '#f97316', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Top Runbooks</div>
                            {(roi.topRunbooks ?? []).length === 0 ? (
                              <div style={{ fontSize: 7, color: '#475569' }}>No runbook activity in this window.</div>
                            ) : (roi.topRunbooks as any[]).map((rb: any) => (
                              <div key={rb.id} style={{ marginBottom: 5, paddingBottom: 5, borderBottom: '1px solid rgba(249,115,22,0.1)' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                  <span style={{ fontSize: 7, fontWeight: 600, color: '#e2e8f0', flex: 1 }}>{rb.title}</span>
                                  <span style={{ fontSize: 6, color: '#f97316', fontWeight: 700 }}>{rb.runs} runs</span>
                                </div>
                                <div style={{ display: 'flex', gap: 6, marginTop: 2 }}>
                                  <span style={{ fontSize: 6, color: '#4ade80' }}>{rb.succeeded}✓</span>
                                  <span style={{ fontSize: 6, color: '#f87171' }}>{rb.failed}✗</span>
                                  {rb.incidentRuns > 0 && <span style={{ fontSize: 6, color: '#fb923c' }}>INC:{rb.incidentRuns}</span>}
                                  <span style={{ fontSize: 6, color: '#64748b' }}>~{rb.estimatedTimeSavedMin}min saved</span>
                                </div>
                                {rb.avgDurationMs > 0 && (
                                  <div style={{ fontSize: 6, color: '#475569' }}>avg {Math.round(rb.avgDurationMs / 1000)}s</div>
                                )}
                              </div>
                            ))}
                          </div>

                          {/* Integrations + Governance */}
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            {/* Integration activity */}
                            <div style={{ padding: '8px 10px', borderRadius: 6, background: 'rgba(129,140,248,0.04)', border: '1px solid rgba(129,140,248,0.18)' }}>
                              <div style={{ fontSize: 7, fontWeight: 800, color: '#818cf8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Integration Activity</div>
                              {(r.integrations ?? []).length === 0 ? (
                                <div style={{ fontSize: 7, color: '#475569' }}>No integration usage in this window.</div>
                              ) : (r.integrations as any[]).slice(0, 6).map((i: any) => (
                                <div key={i.name} style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 3 }}>
                                  <span style={{ fontSize: 7, color: '#94a3b8', flex: 1, textTransform: 'capitalize' }}>{i.name}</span>
                                  <div style={{ height: 4, borderRadius: 2, background: '#818cf8', width: `${Math.min(80, Math.round((i.eventCount / ((r.integrations[0]?.eventCount) || 1)) * 80))}px`, minWidth: 4 }} />
                                  <span style={{ fontSize: 6, color: '#818cf8', fontWeight: 700, minWidth: 20, textAlign: 'right' }}>{i.eventCount}</span>
                                </div>
                              ))}
                            </div>

                            {/* Governance impact */}
                            <div style={{ padding: '8px 10px', borderRadius: 6, background: 'rgba(239,68,68,0.04)', border: '1px solid rgba(239,68,68,0.15)' }}>
                              <div style={{ fontSize: 7, fontWeight: 800, color: '#f87171', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Governance</div>
                              {[
                                { label: 'Policy blocks',    value: gov.policyBlocks ?? 0,      color: '#f87171' },
                                { label: 'Sig verified',     value: gov.signatureVerified ?? 0, color: '#4ade80' },
                                { label: 'Sig failed',       value: gov.signatureFailed ?? 0,   color: '#f87171' },
                                { label: 'Unsigned allowed', value: gov.unsignedAllowed ?? 0,   color: '#94a3b8' },
                                { label: 'Risk increased',   value: gov.updateRiskIncrease ?? 0,color: '#fbbf24' },
                              ].map(({ label, value, color }) => (
                                <div key={label} style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 2 }}>
                                  <span style={{ fontSize: 6, color: '#64748b' }}>{label}</span>
                                  <span style={{ fontSize: 6, fontWeight: 700, color }}>{value}</span>
                                </div>
                              ))}
                            </div>
                          </div>
                        </div>

                        {/* Pack analytics */}
                        {(r.packs ?? []).length > 0 && (
                          <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 6, background: 'rgba(99,102,241,0.04)', border: '1px solid rgba(99,102,241,0.16)' }}>
                            <div style={{ fontSize: 7, fontWeight: 800, color: '#818cf8', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>Pack Activity</div>
                            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 6 }}>
                              {(r.packs as any[]).map((pk: any) => {
                                const trustColor = pk.trustStatus === 'trusted' ? '#4ade80' : pk.trustStatus === 'unsigned' ? '#94a3b8' : '#f87171';
                                return (
                                  <div key={pk.packId} style={{ padding: '5px 8px', borderRadius: 4, background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(99,102,241,0.12)' }}>
                                    <div style={{ fontSize: 7, fontWeight: 600, color: '#e2e8f0', marginBottom: 2 }}>{pk.name}</div>
                                    <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                      <span style={{ fontSize: 6, color: '#818cf8' }}>v{pk.version}</span>
                                      <span style={{ fontSize: 6, color: '#64748b' }}>{pk.runbookCount} rbs</span>
                                      <span style={{ fontSize: 6, color: trustColor }}>{pk.trustStatus}</span>
                                    </div>
                                    <div style={{ display: 'flex', gap: 5, marginTop: 2 }}>
                                      {pk.installs  > 0 && <span style={{ fontSize: 6, color: '#4ade80' }}>+{pk.installs}ins</span>}
                                      {pk.updates   > 0 && <span style={{ fontSize: 6, color: '#fbbf24' }}>~{pk.updates}upd</span>}
                                      {pk.rollbacks > 0 && <span style={{ fontSize: 6, color: '#f87171' }}>↩{pk.rollbacks}rb</span>}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        )}

                        {/* Approval funnel */}
                        {((r.approvals?.totalPaused ?? 0) > 0) && (
                          <div style={{ marginTop: 10, padding: '8px 10px', borderRadius: 6, background: 'rgba(251,191,36,0.04)', border: '1px solid rgba(251,191,36,0.18)' }}>
                            <div style={{ fontSize: 7, fontWeight: 800, color: '#fbbf24', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 5 }}>Approval / Pause Funnel</div>
                            <div style={{ display: 'flex', gap: 12 }}>
                              <div><div style={{ fontSize: 6, color: '#64748b' }}>Await approval</div><div style={{ fontSize: 11, fontWeight: 700, color: '#fbbf24' }}>{r.approvals.pausedForApproval}</div></div>
                              <div><div style={{ fontSize: 6, color: '#64748b' }}>Await confirm</div><div style={{ fontSize: 11, fontWeight: 700, color: '#fbbf24' }}>{r.approvals.pausedForConfirm}</div></div>
                              <div><div style={{ fontSize: 6, color: '#64748b' }}>Manual intervention</div><div style={{ fontSize: 11, fontWeight: 700, color: '#fbbf24' }}>{r.approvals.manualIntervention}</div></div>
                            </div>
                          </div>
                        )}
                      </>
                    );
                  })()}

                  {/* Export text modal */}
                  {analyticsExportText && (
                    <div style={{ position: 'fixed', inset: 0, zIndex: 9100, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <div style={{ width: 560, maxHeight: '80vh', background: '#0f172a', border: '1px solid rgba(74,222,128,0.4)', borderRadius: 8, padding: '14px 16px', display: 'flex', flexDirection: 'column' }}>
                        <div style={{ fontSize: 9, fontWeight: 800, color: '#4ade80', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Analytics Report — {analyticsWindow.toUpperCase()}</div>
                        <textarea readOnly value={analyticsExportText} rows={20}
                          style={{ flex: 1, background: '#1e293b', border: '1px solid rgba(74,222,128,0.2)', borderRadius: 4, color: '#94a3b8', fontSize: 7, padding: '6px 8px', fontFamily: 'monospace', resize: 'none' }} />
                        <div style={{ display: 'flex', gap: 6, marginTop: 8, justifyContent: 'flex-end' }}>
                          <button onClick={() => { try { (navigator as any).clipboard?.writeText(analyticsExportText); } catch {} }}
                            style={{ fontSize: 8, padding: '3px 10px', borderRadius: 4, background: 'rgba(74,222,128,0.1)', border: '1px solid rgba(74,222,128,0.3)', color: '#4ade80', cursor: 'pointer' }}>
                            Copy
                          </button>
                          <button onClick={() => setAnalyticsExportText('')}
                            style={{ fontSize: 8, padding: '3px 10px', borderRadius: 4, background: 'rgba(100,116,139,0.1)', border: '1px solid rgba(100,116,139,0.3)', color: '#94a3b8', cursor: 'pointer' }}>
                            Close
                          </button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── Phase 38: Org Admin tab ── */}
              {dispatchTab === 'org' && (
                <div>
                  {orgLoading && <div style={{ fontSize: 7, color: '#94a3b8' }}>Loading…</div>}
                  {orgErr && <div style={{ fontSize: 7, color: '#f87171', marginBottom: 6 }}>{orgErr}</div>}

                  {/* ── Org setup ── */}
                  {!orgConfig ? (
                    <div style={{ marginBottom: 14 }}>
                      <div style={{ fontSize: 7, fontWeight: 800, color: '#f97316', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Create Organization</div>
                      <div style={{ fontSize: 7, color: '#64748b', marginBottom: 8 }}>
                        An organization record enables policy inheritance, org-level signers, and audit export controls across workspaces.
                      </div>
                      <div style={{ display: 'flex', flexDirection: 'column', gap: 5, marginBottom: 8 }}>
                        <input type="text" placeholder="Organization name *" value={orgCreateName} onChange={e => setOrgCreateName(e.target.value)}
                          style={{ background: '#1e293b', border: '1px solid rgba(249,115,22,0.3)', borderRadius: 4, color: '#e2e8f0', fontSize: 8, padding: '4px 8px' }} />
                        <select value={orgCreatePlan} onChange={e => setOrgCreatePlan(e.target.value)}
                          style={{ background: '#1e293b', border: '1px solid rgba(249,115,22,0.3)', borderRadius: 4, color: '#e2e8f0', fontSize: 8, padding: '4px 8px' }}>
                          <option value="team">Team</option>
                          <option value="enterprise">Enterprise</option>
                        </select>
                        <input type="text" placeholder="Admin email (optional)" value={orgCreateEmail} onChange={e => setOrgCreateEmail(e.target.value)}
                          style={{ background: '#1e293b', border: '1px solid rgba(249,115,22,0.3)', borderRadius: 4, color: '#e2e8f0', fontSize: 8, padding: '4px 8px' }} />
                      </div>
                      <button onClick={async () => {
                        if (!orgCreateName.trim()) return;
                        const r = await (window.triforge as any).org.create(orgCreateName.trim(), orgCreatePlan, orgCreateEmail.trim() || undefined);
                        if (r.ok) { await loadOrgData(); } else setOrgErr(r.error ?? 'Failed');
                      }} style={{ fontSize: 8, fontWeight: 700, padding: '3px 12px', borderRadius: 4, background: 'rgba(249,115,22,0.12)', border: '1px solid rgba(249,115,22,0.35)', color: '#f97316', cursor: 'pointer' }}>
                        Create Org
                      </button>
                    </div>
                  ) : (
                    <>
                      {/* Org header */}
                      <div style={{ marginBottom: 12, padding: '8px 10px', borderRadius: 6, background: 'rgba(249,115,22,0.05)', border: '1px solid rgba(249,115,22,0.2)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: 10, fontWeight: 800, color: '#f97316', flex: 1 }}>{orgConfig.name}</span>
                          <span style={{ fontSize: 6, padding: '1px 6px', borderRadius: 10, background: 'rgba(249,115,22,0.15)', color: '#f97316', fontWeight: 700, textTransform: 'uppercase' }}>{orgConfig.plan}</span>
                        </div>
                        {orgConfig.adminEmail && <div style={{ fontSize: 6, color: '#64748b', marginTop: 2 }}>{orgConfig.adminEmail}</div>}
                        <div style={{ fontSize: 6, color: '#475569', fontFamily: 'monospace', marginTop: 2 }}>{orgConfig.id}</div>
                      </div>

                      {/* ── Policy inheritance controls ── */}
                      <div style={{ marginBottom: 12 }}>
                        <div style={{ fontSize: 7, fontWeight: 800, color: '#818cf8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Policy Inheritance</div>

                        {/* Pack Trust Defaults */}
                        <div style={{ marginBottom: 8, padding: '7px 10px', borderRadius: 5, background: 'rgba(99,102,241,0.04)', border: '1px solid rgba(99,102,241,0.18)' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
                            <span style={{ fontSize: 7, fontWeight: 700, color: '#818cf8', flex: 1 }}>Pack Trust Defaults</span>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 6, color: '#f87171', cursor: 'pointer' }}>
                              <input type="checkbox" checked={!!orgPolicy?.packTrust?.enforced}
                                onChange={async e => {
                                  const r = await (window.triforge as any).org.policy.set('packTrust', { enforced: e.target.checked });
                                  if (r.ok) { setOrgPolicy(r.policy); await loadOrgData(); }
                                }} style={{ accentColor: '#f87171' }} />
                              Enforced (workspaces cannot override)
                            </label>
                          </div>
                          {[
                            { key: 'allowUnsigned',                  label: 'Allow unsigned packs' },
                            { key: 'allowUnknownSigners',            label: 'Allow unknown signers' },
                            { key: 'requireAdminApprovalForInstall', label: 'Require admin approval for install' },
                            { key: 'requireConfirmOnRiskIncrease',   label: 'Require confirm on risk increase' },
                            { key: 'blockNewDestinations',           label: 'Block packs adding new destinations' },
                          ].map(({ key, label }) => {
                            const eff = (orgEffective?.packTrust as any)?.[key];
                            const src = eff?.source ?? 'workspace';
                            return (
                              <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                                <input type="checkbox" checked={!!orgPolicy?.packTrust?.[key]}
                                  onChange={async e => {
                                    const r = await (window.triforge as any).org.policy.set('packTrust', { [key]: e.target.checked });
                                    if (r.ok) { setOrgPolicy(r.policy); }
                                  }} style={{ accentColor: '#818cf8' }} />
                                <span style={{ fontSize: 7, color: '#94a3b8', flex: 1 }}>{label}</span>
                                <span style={{ fontSize: 6, color: src === 'org' ? '#f97316' : '#475569', fontWeight: 700 }}>{src === 'org' ? 'ORG' : 'WS'}</span>
                              </div>
                            );
                          })}
                        </div>

                        {/* Dispatch Policy */}
                        <div style={{ marginBottom: 8, padding: '7px 10px', borderRadius: 5, background: 'rgba(99,102,241,0.04)', border: '1px solid rgba(99,102,241,0.18)' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
                            <span style={{ fontSize: 7, fontWeight: 700, color: '#818cf8', flex: 1 }}>Dispatch & Remote Access</span>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 6, color: '#f87171', cursor: 'pointer' }}>
                              <input type="checkbox" checked={!!orgPolicy?.dispatch?.enforced}
                                onChange={async e => {
                                  const r = await (window.triforge as any).org.policy.set('dispatch', { enforced: e.target.checked });
                                  if (r.ok) { setOrgPolicy(r.policy); }
                                }} style={{ accentColor: '#f87171' }} />
                              Enforced
                            </label>
                          </div>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                            <span style={{ fontSize: 7, color: '#94a3b8' }}>Max remote risk level:</span>
                            <select value={orgPolicy?.dispatch?.maxRemoteRiskLevel ?? 'high'}
                              onChange={async e => {
                                const r = await (window.triforge as any).org.policy.set('dispatch', { maxRemoteRiskLevel: e.target.value });
                                if (r.ok) setOrgPolicy(r.policy);
                              }}
                              style={{ background: '#1e293b', border: '1px solid rgba(99,102,241,0.25)', borderRadius: 3, color: '#e2e8f0', fontSize: 7, padding: '2px 4px' }}>
                              <option value="low">Low</option>
                              <option value="medium">Medium</option>
                              <option value="high">High</option>
                            </select>
                          </div>
                          {[
                            { key: 'requireMFA',          label: 'Require MFA for remote access' },
                            { key: 'allowPublicDispatch',  label: 'Allow public dispatch URLs' },
                          ].map(({ key, label }) => (
                            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                              <input type="checkbox" checked={!!orgPolicy?.dispatch?.[key]}
                                onChange={async e => {
                                  const r = await (window.triforge as any).org.policy.set('dispatch', { [key]: e.target.checked });
                                  if (r.ok) setOrgPolicy(r.policy);
                                }} style={{ accentColor: '#818cf8' }} />
                              <span style={{ fontSize: 7, color: '#94a3b8' }}>{label}</span>
                            </div>
                          ))}
                        </div>

                        {/* Integration Policy */}
                        <div style={{ marginBottom: 8, padding: '7px 10px', borderRadius: 5, background: 'rgba(99,102,241,0.04)', border: '1px solid rgba(99,102,241,0.18)' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
                            <span style={{ fontSize: 7, fontWeight: 700, color: '#818cf8', flex: 1 }}>Integrations</span>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 6, color: '#f87171', cursor: 'pointer' }}>
                              <input type="checkbox" checked={!!orgPolicy?.integrations?.enforced}
                                onChange={async e => {
                                  const r = await (window.triforge as any).org.policy.set('integrations', { enforced: e.target.checked });
                                  if (r.ok) setOrgPolicy(r.policy);
                                }} style={{ accentColor: '#f87171' }} />
                              Enforced
                            </label>
                          </div>
                          <div style={{ marginBottom: 4 }}>
                            <div style={{ fontSize: 6, color: '#64748b', marginBottom: 2 }}>Blocked integrations (comma-separated):</div>
                            <input type="text"
                              defaultValue={(orgPolicy?.integrations?.blockedIntegrations ?? []).join(', ')}
                              onBlur={async e => {
                                const vals = e.target.value.split(',').map((s: string) => s.trim()).filter(Boolean);
                                const r = await (window.triforge as any).org.policy.set('integrations', { blockedIntegrations: vals });
                                if (r.ok) setOrgPolicy(r.policy);
                              }}
                              placeholder="e.g. discord, telegram"
                              style={{ width: '100%', background: '#1e293b', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 3, color: '#e2e8f0', fontSize: 7, padding: '3px 6px', boxSizing: 'border-box' }} />
                          </div>
                          {(orgEffective?.integrations as any)?.orgEnforced && (orgEffective?.integrations as any)?.effectiveBlocked?.length > 0 && (
                            <div style={{ fontSize: 6, color: '#f87171' }}>Blocked: {(orgEffective.integrations as any).effectiveBlocked.join(', ')}</div>
                          )}
                        </div>

                        {/* Signer Policy */}
                        <div style={{ marginBottom: 8, padding: '7px 10px', borderRadius: 5, background: 'rgba(99,102,241,0.04)', border: '1px solid rgba(99,102,241,0.18)' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
                            <span style={{ fontSize: 7, fontWeight: 700, color: '#818cf8', flex: 1 }}>Signer Policy</span>
                          </div>
                          {[
                            { key: 'allowWorkspaceSigners', label: 'Allow workspaces to add local signers' },
                          ].map(({ key, label }) => (
                            <div key={key} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 3 }}>
                              <input type="checkbox" checked={orgPolicy?.signers?.[key] !== false}
                                onChange={async e => {
                                  const r = await (window.triforge as any).org.policy.set('signers', { [key]: e.target.checked });
                                  if (r.ok) setOrgPolicy(r.policy);
                                }} style={{ accentColor: '#818cf8' }} />
                              <span style={{ fontSize: 7, color: '#94a3b8' }}>{label}</span>
                            </div>
                          ))}
                        </div>

                        {/* Audit Policy */}
                        <div style={{ padding: '7px 10px', borderRadius: 5, background: 'rgba(99,102,241,0.04)', border: '1px solid rgba(99,102,241,0.18)' }}>
                          <span style={{ fontSize: 7, fontWeight: 700, color: '#818cf8' }}>Audit Settings</span>
                          <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 5 }}>
                            <span style={{ fontSize: 7, color: '#94a3b8' }}>Retention (days):</span>
                            <select value={orgPolicy?.audit?.retentionDays ?? 90}
                              onChange={async e => {
                                const r = await (window.triforge as any).org.policy.set('audit', { retentionDays: Number(e.target.value) });
                                if (r.ok) setOrgPolicy(r.policy);
                              }}
                              style={{ background: '#1e293b', border: '1px solid rgba(99,102,241,0.25)', borderRadius: 3, color: '#e2e8f0', fontSize: 7, padding: '2px 4px' }}>
                              {[30, 90, 365, 0].map(d => <option key={d} value={d}>{d === 0 ? 'Unlimited' : d}</option>)}
                            </select>
                          </div>
                        </div>
                      </div>

                      {/* ── Org-level Trusted Signers ── */}
                      <div style={{ marginBottom: 12 }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                          <span style={{ fontSize: 7, fontWeight: 800, color: '#818cf8', textTransform: 'uppercase', letterSpacing: '0.08em' }}>Org Trusted Signers</span>
                          <button onClick={() => { setOrgSignerModal(true); setOrgSignerName(''); setOrgSignerEmail(''); setOrgSignerPem(''); setOrgSignerErr(''); }}
                            style={{ fontSize: 7, padding: '1px 7px', borderRadius: 3, background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.3)', color: '#818cf8', cursor: 'pointer' }}>
                            Add Org Signer
                          </button>
                        </div>
                        <div style={{ fontSize: 7, color: '#64748b', marginBottom: 6 }}>Org signers are trusted by all workspaces automatically — no per-workspace configuration needed.</div>
                        {orgSigners.length === 0 ? (
                          <div style={{ fontSize: 7, color: '#475569' }}>No org-level signers configured.</div>
                        ) : orgSigners.map((s: any) => (
                          <div key={s.keyId} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', borderRadius: 4, background: s.revoked ? 'rgba(239,68,68,0.04)' : 'rgba(74,222,128,0.04)', border: `1px solid ${s.revoked ? 'rgba(239,68,68,0.2)' : 'rgba(74,222,128,0.18)'}`, marginBottom: 4 }}>
                            <div style={{ flex: 1 }}>
                              <span style={{ fontSize: 7, fontWeight: 600, color: s.revoked ? '#64748b' : '#e2e8f0' }}>{s.name}</span>
                              {s.revoked && <span style={{ fontSize: 6, color: '#f87171', marginLeft: 4 }}>[REVOKED]</span>}
                              <div style={{ fontSize: 6, color: '#475569', fontFamily: 'monospace' }}>{s.keyId}</div>
                            </div>
                            {!s.revoked && <button onClick={async () => {
                              await (window.triforge as any).org.signers.revoke(s.keyId);
                              await loadOrgData();
                            }} style={{ fontSize: 6, padding: '1px 5px', borderRadius: 3, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171', cursor: 'pointer' }}>Revoke</button>}
                            <button onClick={async () => {
                              if (!confirm(`Remove org signer "${s.name}"?`)) return;
                              await (window.triforge as any).org.signers.remove(s.keyId);
                              await loadOrgData();
                            }} style={{ fontSize: 6, padding: '1px 5px', borderRadius: 3, background: 'rgba(100,116,139,0.08)', border: '1px solid rgba(100,116,139,0.2)', color: '#94a3b8', cursor: 'pointer' }}>Remove</button>
                          </div>
                        ))}
                      </div>

                      {/* ── Audit Export ── */}
                      <div style={{ borderTop: '1px solid rgba(99,102,241,0.18)', paddingTop: 10 }}>
                        <div style={{ fontSize: 7, fontWeight: 800, color: '#818cf8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Audit Export</div>
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', alignItems: 'center', marginBottom: 6 }}>
                          <span style={{ fontSize: 7, color: '#94a3b8' }}>From:</span>
                          <input type="date" value={auditFromDate} onChange={e => setAuditFromDate(e.target.value)}
                            style={{ background: '#1e293b', border: '1px solid rgba(99,102,241,0.25)', borderRadius: 3, color: '#e2e8f0', fontSize: 7, padding: '2px 4px' }} />
                          <span style={{ fontSize: 7, color: '#94a3b8' }}>To:</span>
                          <input type="date" value={auditToDate} onChange={e => setAuditToDate(e.target.value)}
                            style={{ background: '#1e293b', border: '1px solid rgba(99,102,241,0.25)', borderRadius: 3, color: '#e2e8f0', fontSize: 7, padding: '2px 4px' }} />
                          <select value={auditFormat} onChange={e => setAuditFormat(e.target.value as any)}
                            style={{ background: '#1e293b', border: '1px solid rgba(99,102,241,0.25)', borderRadius: 3, color: '#e2e8f0', fontSize: 7, padding: '2px 4px' }}>
                            <option value="text">Text</option>
                            <option value="json">JSON</option>
                            <option value="csv">CSV</option>
                          </select>
                        </div>
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 6 }}>
                          <input type="text" placeholder="Filter by event type (optional)" value={auditFilter} onChange={e => setAuditFilter(e.target.value)}
                            style={{ flex: 1, background: '#1e293b', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 3, color: '#e2e8f0', fontSize: 7, padding: '3px 6px' }} />
                        </div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button disabled={auditExporting} onClick={async () => {
                            setAuditExporting(true);
                            try {
                              const from = new Date(auditFromDate).getTime();
                              const to   = new Date(auditToDate).getTime() + 86399000;
                              const r = await (window.triforge as any).audit.export(from, to, auditFormat, auditFilter || undefined);
                              if (r.ok) setAuditExportText(r.text);
                              else setOrgErr(r.error ?? 'Export failed');
                            } finally { setAuditExporting(false); }
                          }} style={{ fontSize: 8, fontWeight: 700, padding: '3px 12px', borderRadius: 4, background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.35)', color: '#818cf8', cursor: 'pointer' }}>
                            {auditExporting ? 'Exporting…' : 'Export Audit Log'}
                          </button>
                          <button disabled={auditExporting} onClick={async () => {
                            setAuditExporting(true);
                            try {
                              const from = new Date(auditFromDate).getTime();
                              const to   = new Date(auditToDate).getTime() + 86399000;
                              const r = await (window.triforge as any).audit.exportPolicyHistory(from, to);
                              if (r.ok) setAuditExportText(r.text);
                              else setOrgErr(r.error ?? 'Export failed');
                            } finally { setAuditExporting(false); }
                          }} style={{ fontSize: 7, padding: '3px 10px', borderRadius: 4, background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.25)', color: '#fbbf24', cursor: 'pointer' }}>
                            Policy History Only
                          </button>
                        </div>
                      </div>
                    </>
                  )}

                  {/* Org signer add modal */}
                  {orgSignerModal && (
                    <div style={{ position: 'fixed', inset: 0, zIndex: 9200, background: 'rgba(0,0,0,0.7)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <div style={{ width: 420, background: '#0f172a', border: '1px solid rgba(74,222,128,0.35)', borderRadius: 8, padding: '14px 16px' }}>
                        <div style={{ fontSize: 9, fontWeight: 800, color: '#4ade80', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Add Org Trusted Signer</div>
                        <div style={{ fontSize: 7, color: '#64748b', marginBottom: 8 }}>This signer will be trusted by all workspaces in this org automatically.</div>
                        <input type="text" placeholder="Name *" value={orgSignerName} onChange={e => setOrgSignerName(e.target.value)}
                          style={{ width: '100%', marginBottom: 5, background: '#1e293b', border: '1px solid rgba(74,222,128,0.2)', borderRadius: 4, color: '#e2e8f0', fontSize: 8, padding: '4px 6px', boxSizing: 'border-box' }} />
                        <input type="text" placeholder="Email (optional)" value={orgSignerEmail} onChange={e => setOrgSignerEmail(e.target.value)}
                          style={{ width: '100%', marginBottom: 5, background: '#1e293b', border: '1px solid rgba(74,222,128,0.2)', borderRadius: 4, color: '#e2e8f0', fontSize: 8, padding: '4px 6px', boxSizing: 'border-box' }} />
                        <textarea placeholder="-----BEGIN PUBLIC KEY-----&#10;...&#10;-----END PUBLIC KEY-----" value={orgSignerPem} onChange={e => { setOrgSignerPem(e.target.value); setOrgSignerErr(''); }}
                          rows={5}
                          style={{ width: '100%', marginBottom: 8, background: '#1e293b', border: '1px solid rgba(74,222,128,0.2)', borderRadius: 4, color: '#94a3b8', fontSize: 7, padding: '6px 8px', fontFamily: 'monospace', resize: 'vertical', boxSizing: 'border-box' }} />
                        {orgSignerErr && <div style={{ fontSize: 7, color: '#f87171', marginBottom: 5 }}>{orgSignerErr}</div>}
                        <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                          <button onClick={() => setOrgSignerModal(false)} style={{ fontSize: 8, padding: '3px 10px', borderRadius: 4, background: 'rgba(100,116,139,0.1)', border: '1px solid rgba(100,116,139,0.3)', color: '#94a3b8', cursor: 'pointer' }}>Cancel</button>
                          <button disabled={!orgSignerName.trim() || !orgSignerPem.trim()} onClick={async () => {
                            setOrgSignerErr('');
                            const r = await (window.triforge as any).org.signers.add({ name: orgSignerName.trim(), email: orgSignerEmail.trim() || undefined, publicKeyPem: orgSignerPem.trim() });
                            if (!r.ok) { setOrgSignerErr(r.error ?? 'Failed'); }
                            else { setOrgSignerModal(false); await loadOrgData(); }
                          }} style={{ fontSize: 8, fontWeight: 700, padding: '3px 12px', borderRadius: 4, background: 'rgba(74,222,128,0.12)', border: '1px solid rgba(74,222,128,0.35)', color: '#4ade80', cursor: !orgSignerName.trim() || !orgSignerPem.trim() ? 'not-allowed' : 'pointer' }}>
                            Add Org Signer
                          </button>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Audit export result */}
                  {auditExportText && (
                    <div style={{ position: 'fixed', inset: 0, zIndex: 9100, background: 'rgba(0,0,0,0.65)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                      <div style={{ width: 620, maxHeight: '80vh', background: '#0f172a', border: '1px solid rgba(99,102,241,0.4)', borderRadius: 8, padding: '14px 16px', display: 'flex', flexDirection: 'column' }}>
                        <div style={{ fontSize: 9, fontWeight: 800, color: '#818cf8', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 8 }}>Audit Export</div>
                        <textarea readOnly value={auditExportText} rows={22}
                          style={{ flex: 1, background: '#1e293b', border: '1px solid rgba(99,102,241,0.2)', borderRadius: 4, color: '#94a3b8', fontSize: 7, padding: '6px 8px', fontFamily: 'monospace', resize: 'none' }} />
                        <div style={{ display: 'flex', gap: 6, marginTop: 8, justifyContent: 'flex-end' }}>
                          <button onClick={() => { try { (navigator as any).clipboard?.writeText(auditExportText); } catch {} }}
                            style={{ fontSize: 8, padding: '3px 10px', borderRadius: 4, background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.3)', color: '#818cf8', cursor: 'pointer' }}>Copy</button>
                          <button onClick={() => setAuditExportText('')}
                            style={{ fontSize: 8, padding: '3px 10px', borderRadius: 4, background: 'rgba(100,116,139,0.1)', border: '1px solid rgba(100,116,139,0.3)', color: '#94a3b8', cursor: 'pointer' }}>Close</button>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── Phase 30: Automation Governance tab ── */}
              {dispatchTab === 'automation' && (
                <div>
                  {!workspace ? (
                    <div style={{ fontSize: 7, color: '#94a3b8', padding: '8px 0' }}>Create a workspace first to manage automation governance.</div>
                  ) : (
                    <div>
                      {automationPolicyErr && <div style={{ fontSize: 7, color: '#ef4444', marginBottom: 6 }}>{automationPolicyErr}</div>}

                      {/* ── Global policy ── */}
                      <div style={{ marginBottom: 12 }}>
                        <div style={{ fontSize: 7, fontWeight: 800, color: '#f97316', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Global Automation Policy</div>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 4, padding: '8px 10px', borderRadius: 6, border: '1px solid rgba(249,115,22,0.2)', background: 'rgba(249,115,22,0.04)' }}>
                          {[
                            { key: 'allowRemoteRunDefault',        label: 'Allow remote run by default' },
                            { key: 'requireDesktopConfirmDefault', label: 'Require desktop confirm by default' },
                            { key: 'allowBundleSendFromRecipe',    label: 'Allow bundle send from recipe runs' },
                          ].map(({ key, label }) => (
                            <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer' }}>
                              <input
                                type="checkbox"
                                checked={automationPolicy[key] ?? false}
                                onChange={e => setAutomationPolicy(p => ({ ...p, [key]: e.target.checked }))}
                              />
                              <span style={{ fontSize: 8, color: '#e2e8f0' }}>{label}</span>
                            </label>
                          ))}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2 }}>
                            <span style={{ fontSize: 7, color: '#64748b' }}>Min runner role</span>
                            <select
                              value={automationPolicy.minRunnerRole ?? 'operator'}
                              onChange={e => setAutomationPolicy(p => ({ ...p, minRunnerRole: e.target.value }))}
                              style={{ fontSize: 8, padding: '1px 4px', borderRadius: 3, background: '#0f172a', border: '1px solid rgba(249,115,22,0.3)', color: '#e2e8f0' }}
                            >
                              {['viewer','reviewer','operator','admin','owner'].map(r => <option key={r} value={r}>{r}</option>)}
                            </select>
                            <span style={{ fontSize: 7, color: '#64748b' }}>Max risk</span>
                            <select
                              value={automationPolicy.maxRiskDefault ?? 'medium'}
                              onChange={e => setAutomationPolicy(p => ({ ...p, maxRiskDefault: e.target.value }))}
                              style={{ fontSize: 8, padding: '1px 4px', borderRadius: 3, background: '#0f172a', border: '1px solid rgba(249,115,22,0.3)', color: '#e2e8f0' }}
                            >
                              {['low','medium','high'].map(r => <option key={r} value={r}>{r}</option>)}
                            </select>
                          </div>
                          <button
                            className="hq-btn"
                            disabled={automationPolicySaving}
                            onClick={async () => {
                              setAutomationPolicySaving(true);
                              try {
                                const r = await (window.triforge as any).workspaceAutomation.setPolicy(automationPolicy);
                                if (r.ok) setAutomationPolicy(r.policy);
                                else setAutomationPolicyErr(r.error ?? 'Failed');
                              } finally { setAutomationPolicySaving(false); }
                            }}
                            style={{ alignSelf: 'flex-start', marginTop: 4, fontSize: 8, padding: '3px 10px', borderRadius: 4, background: 'rgba(249,115,22,0.12)', border: '1px solid rgba(249,115,22,0.35)', color: '#f97316', cursor: automationPolicySaving ? 'not-allowed' : 'pointer' }}
                          >
                            {automationPolicySaving ? 'Saving…' : 'Save'}
                          </button>
                        </div>
                      </div>

                      {/* ── Per-recipe policies ── */}
                      <div style={{ marginBottom: 12 }}>
                        <div style={{ fontSize: 7, fontWeight: 800, color: '#f97316', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Recipe Policies</div>
                        {['builtin-pr-review-to-slack','builtin-jira-digest-daily','builtin-linear-digest-daily','builtin-morning-brief','builtin-approval-alert'].map(rid => {
                          const pol = recipePolicies[rid];
                          const shortName = rid.replace('builtin-','').replace(/-/g,' ');
                          const isEditing = recipePolicyEditing === rid;
                          return (
                            <div key={rid} style={{ border: '1px solid rgba(249,115,22,0.15)', borderRadius: 5, padding: '6px 8px', marginBottom: 5, background: 'rgba(0,0,0,0.2)' }}>
                              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: isEditing ? 6 : 0 }}>
                                <span style={{ fontSize: 8, fontWeight: 700, color: '#e2e8f0', flex: 1, textTransform: 'capitalize' }}>{shortName}</span>
                                {pol ? (
                                  <span style={{ fontSize: 7, color: '#f97316', fontWeight: 600 }}>POLICY SET</span>
                                ) : (
                                  <span style={{ fontSize: 7, color: '#64748b' }}>workspace default</span>
                                )}
                                <button
                                  className="hq-btn"
                                  onClick={() => setRecipePolicyEditing(isEditing ? null : rid)}
                                  style={{ fontSize: 7, padding: '1px 6px', borderRadius: 3, background: 'rgba(249,115,22,0.1)', border: '1px solid rgba(249,115,22,0.3)', color: '#f97316', cursor: 'pointer' }}
                                >
                                  {isEditing ? 'Close' : 'Edit'}
                                </button>
                                {pol && (
                                  <button
                                    className="hq-btn"
                                    onClick={async () => {
                                      await (window.triforge as any).workspaceAutomation.deleteRecipePolicy(rid);
                                      setRecipePolicies(p => { const n = { ...p }; delete n[rid]; return n; });
                                    }}
                                    style={{ fontSize: 7, padding: '1px 6px', borderRadius: 3, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171', cursor: 'pointer' }}
                                  >
                                    Clear
                                  </button>
                                )}
                              </div>
                              {isEditing && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                  {[
                                    { key: 'allowRemoteRun',        label: 'Allow remote run' },
                                    { key: 'requireDesktopConfirm', label: 'Require desktop confirm' },
                                    { key: 'enabled',               label: 'Enabled' },
                                  ].map(({ key, label }) => (
                                    <label key={key} style={{ display: 'flex', alignItems: 'center', gap: 4, cursor: 'pointer' }}>
                                      <input
                                        type="checkbox"
                                        checked={pol?.[key] ?? (key === 'enabled')}
                                        onChange={async e => {
                                          const r = await (window.triforge as any).workspaceAutomation.setRecipePolicy(rid, { [key]: e.target.checked });
                                          if (r.ok && r.policy) setRecipePolicies(p => ({ ...p, [rid]: r.policy }));
                                        }}
                                      />
                                      <span style={{ fontSize: 7, color: '#e2e8f0' }}>{label}</span>
                                    </label>
                                  ))}
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <span style={{ fontSize: 7, color: '#64748b' }}>Min role</span>
                                    <select
                                      value={pol?.allowedRunnerRoles?.[0] ?? 'operator'}
                                      onChange={async e => {
                                        const r = await (window.triforge as any).workspaceAutomation.setRecipePolicy(rid, { allowedRunnerRoles: [e.target.value] });
                                        if (r.ok && r.policy) setRecipePolicies(p => ({ ...p, [rid]: r.policy }));
                                      }}
                                      style={{ fontSize: 8, padding: '1px 4px', borderRadius: 3, background: '#0f172a', border: '1px solid rgba(249,115,22,0.3)', color: '#e2e8f0' }}
                                    >
                                      {['viewer','reviewer','operator','admin','owner'].map(r => <option key={r} value={r}>{r}</option>)}
                                    </select>
                                    <span style={{ fontSize: 7, color: '#64748b' }}>Risk</span>
                                    <select
                                      value={pol?.maxRisk ?? 'medium'}
                                      onChange={async e => {
                                        const r = await (window.triforge as any).workspaceAutomation.setRecipePolicy(rid, { maxRisk: e.target.value });
                                        if (r.ok && r.policy) setRecipePolicies(p => ({ ...p, [rid]: r.policy }));
                                      }}
                                      style={{ fontSize: 8, padding: '1px 4px', borderRadius: 3, background: '#0f172a', border: '1px solid rgba(249,115,22,0.3)', color: '#e2e8f0' }}
                                    >
                                      {['low','medium','high'].map(r => <option key={r} value={r}>{r}</option>)}
                                    </select>
                                  </div>
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>

                      {/* ── Delegated operators ── */}
                      <div style={{ marginBottom: 12 }}>
                        <div style={{ fontSize: 7, fontWeight: 800, color: '#f97316', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Delegated Operators</div>
                        {delegatedOperators.length === 0 ? (
                          <div style={{ fontSize: 7, color: '#64748b', marginBottom: 6 }}>No delegated operators assigned.</div>
                        ) : (
                          delegatedOperators.map((op: any) => (
                            <div key={op.deviceId} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 6px', borderRadius: 4, border: '1px solid rgba(249,115,22,0.15)', background: 'rgba(0,0,0,0.15)', marginBottom: 3 }}>
                              <span style={{ fontSize: 8, color: '#e2e8f0', flex: 1 }}>{op.label || op.deviceId}</span>
                              <span style={{ fontSize: 7, padding: '1px 5px', borderRadius: 10, background: 'rgba(249,115,22,0.15)', color: '#f97316', fontWeight: 600 }}>{op.delegationType}</span>
                              {op.recipeIds?.length > 0 && (
                                <span style={{ fontSize: 7, color: '#64748b' }}>{op.recipeIds.length} recipe(s)</span>
                              )}
                              <button
                                className="hq-btn"
                                onClick={async () => {
                                  const r = await (window.triforge as any).workspaceAutomation.revokeDelegatedOperator(op.deviceId);
                                  if (r.ok) setDelegatedOperators(prev => prev.filter(o => o.deviceId !== op.deviceId));
                                }}
                                style={{ fontSize: 7, padding: '1px 5px', borderRadius: 3, background: 'rgba(239,68,68,0.08)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171', cursor: 'pointer' }}
                              >
                                Revoke
                              </button>
                            </div>
                          ))
                        )}
                        {/* Assign form */}
                        <div style={{ border: '1px solid rgba(249,115,22,0.15)', borderRadius: 5, padding: '8px 10px', background: 'rgba(0,0,0,0.1)' }}>
                          <div style={{ fontSize: 7, fontWeight: 700, color: '#94a3b8', marginBottom: 5 }}>Assign Delegated Operator</div>
                          <div style={{ display: 'flex', gap: 4, marginBottom: 4, flexWrap: 'wrap' }}>
                            <input
                              type="text"
                              value={delOpDeviceId}
                              onChange={e => setDelOpDeviceId(e.target.value)}
                              placeholder="Device ID"
                              style={{ flex: 2, minWidth: 80, background: '#0f172a', border: '1px solid rgba(249,115,22,0.25)', borderRadius: 4, color: '#e2e8f0', fontSize: 9, padding: '3px 6px' }}
                            />
                            <input
                              type="text"
                              value={delOpLabel}
                              onChange={e => setDelOpLabel(e.target.value)}
                              placeholder="Label"
                              style={{ flex: 2, minWidth: 60, background: '#0f172a', border: '1px solid rgba(249,115,22,0.25)', borderRadius: 4, color: '#e2e8f0', fontSize: 9, padding: '3px 6px' }}
                            />
                            <select
                              value={delOpType}
                              onChange={e => setDelOpType(e.target.value)}
                              style={{ flex: 2, minWidth: 100, fontSize: 8, padding: '3px 4px', borderRadius: 4, background: '#0f172a', border: '1px solid rgba(249,115,22,0.25)', color: '#e2e8f0' }}
                            >
                              {['operator','automation_operator','approval_operator','dispatch_only'].map(t => <option key={t} value={t}>{t}</option>)}
                            </select>
                          </div>
                          <button
                            className="hq-btn"
                            disabled={delOpAssigning || !delOpDeviceId.trim()}
                            onClick={async () => {
                              setDelOpAssigning(true);
                              try {
                                const r = await (window.triforge as any).workspaceAutomation.assignDelegatedOperator({
                                  deviceId: delOpDeviceId.trim(),
                                  label: delOpLabel.trim() || delOpDeviceId.trim(),
                                  delegationType: delOpType,
                                  assignedBy: 'desktop',
                                });
                                if (r.ok) {
                                  setDelOpDeviceId(''); setDelOpLabel('');
                                  await loadAutomationData();
                                } else {
                                  setAutomationPolicyErr(r.error ?? 'Failed to assign');
                                }
                              } finally { setDelOpAssigning(false); }
                            }}
                            style={{ fontSize: 8, padding: '3px 10px', borderRadius: 4, background: 'rgba(34,197,94,0.1)', border: '1px solid rgba(34,197,94,0.3)', color: '#4ade80', cursor: delOpAssigning || !delOpDeviceId.trim() ? 'not-allowed' : 'pointer' }}
                          >
                            {delOpAssigning ? 'Assigning…' : 'Assign'}
                          </button>
                        </div>
                      </div>

                      {/* ── Simulate run ── */}
                      <div style={{ borderTop: '1px solid rgba(249,115,22,0.15)', paddingTop: 10 }}>
                        <div style={{ fontSize: 7, fontWeight: 800, color: '#f97316', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 6 }}>Simulate Recipe Run</div>
                        <div style={{ display: 'flex', gap: 4, marginBottom: 4, flexWrap: 'wrap' }}>
                          <div style={{ flex: 1, minWidth: 80 }}>
                            <div style={{ fontSize: 7, color: '#64748b', marginBottom: 2 }}>Role or Device ID</div>
                            <input
                              type="text"
                              value={automationSimRole}
                              onChange={e => setAutomationSimRole(e.target.value)}
                              placeholder="operator / deviceId…"
                              style={{ width: '100%', background: '#0f172a', border: '1px solid rgba(249,115,22,0.25)', borderRadius: 4, color: '#e2e8f0', fontSize: 9, padding: '4px 6px', boxSizing: 'border-box' }}
                            />
                          </div>
                          <div style={{ flex: 1, minWidth: 100 }}>
                            <div style={{ fontSize: 7, color: '#64748b', marginBottom: 2 }}>Recipe</div>
                            <select
                              value={automationSimRecipe}
                              onChange={e => setAutomationSimRecipe(e.target.value)}
                              style={{ width: '100%', fontSize: 8, padding: '4px 4px', borderRadius: 4, background: '#0f172a', border: '1px solid rgba(249,115,22,0.25)', color: '#e2e8f0' }}
                            >
                              {['builtin-pr-review-to-slack','builtin-jira-digest-daily','builtin-linear-digest-daily','builtin-morning-brief','builtin-approval-alert'].map(r => (
                                <option key={r} value={r}>{r.replace('builtin-','').replace(/-/g,' ')}</option>
                              ))}
                            </select>
                          </div>
                        </div>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 6, cursor: 'pointer' }}>
                          <input type="checkbox" checked={automationSimRemote} onChange={e => setAutomationSimRemote(e.target.checked)} />
                          <span style={{ fontSize: 7, color: '#94a3b8' }}>Is remote run</span>
                        </label>
                        <button
                          className="hq-btn"
                          disabled={automationSimLoading || !automationSimRole.trim()}
                          onClick={async () => {
                            setAutomationSimLoading(true);
                            setAutomationSimResult(null);
                            try {
                              const r = await (window.triforge as any).workspaceAutomation.simulateRun(automationSimRole.trim(), automationSimRecipe, automationSimRemote);
                              setAutomationSimResult(r);
                            } catch { setAutomationPolicyErr('Simulation failed'); }
                            finally { setAutomationSimLoading(false); }
                          }}
                          style={{ fontSize: 8, fontWeight: 700, padding: '3px 12px', borderRadius: 4, background: 'rgba(249,115,22,0.12)', border: '1px solid rgba(249,115,22,0.35)', color: '#f97316', cursor: automationSimLoading ? 'not-allowed' : 'pointer' }}
                        >
                          {automationSimLoading ? 'Simulating…' : 'Simulate'}
                        </button>
                        {automationSimResult && (
                          <div style={{ marginTop: 8, padding: '6px 8px', borderRadius: 5, background: automationSimResult.allowed ? 'rgba(34,197,94,0.08)' : 'rgba(239,68,68,0.08)', border: `1px solid ${automationSimResult.allowed ? 'rgba(34,197,94,0.3)' : 'rgba(239,68,68,0.3)'}` }}>
                            <div style={{ fontSize: 9, fontWeight: 700, color: automationSimResult.allowed ? '#4ade80' : '#f87171', marginBottom: 3 }}>
                              {automationSimResult.allowed ? 'ALLOWED' : 'DENIED'}
                              {automationSimResult.requiresDesktopConfirm && ' (desktop confirm)'}
                            </div>
                            <div style={{ fontSize: 8, color: '#94a3b8' }}>{automationSimResult.reason}</div>
                            <div style={{ fontSize: 7, color: '#64748b', marginTop: 2 }}>
                              Policy: {automationSimResult.effectivePolicy}
                              {automationSimResult.blockedBy ? ` · Blocked by: ${automationSimResult.blockedBy}` : ''}
                              {automationSimResult.delegationType ? ` · Delegated: ${automationSimResult.delegationType}` : ''}
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* ── Phase 28: Workspace Integrations tab ── */}
              {dispatchTab === 'integrations' && (
                <div>
                  {!workspace ? (
                    <div style={{ fontSize: 7, color: '#94a3b8', padding: '8px 0' }}>
                      Create a workspace first (Workspace tab) to manage shared integrations.
                    </div>
                  ) : (
                    <div>
                      <div style={{ fontSize: 7, color: '#94a3b8', marginBottom: 10 }}>
                        Workspace-owned credentials are used by all authorized members. Role required to manage: Admin or Owner.
                      </div>
                      {wsIntErr && <div style={{ fontSize: 7, color: '#ef4444', marginBottom: 6 }}>{wsIntErr}</div>}
                      {[
                        { key: 'github',  label: 'GitHub',  tokenLabel: 'Personal Access Token', tokenPh: 'ghp_...' },
                        { key: 'slack',   label: 'Slack',   tokenLabel: 'Bot Token', tokenPh: 'xoxb-...' },
                        { key: 'jira',    label: 'Jira',    tokenLabel: 'API Token', tokenPh: 'Your Jira API token', needsUrl: true, needsEmail: true },
                        { key: 'linear',  label: 'Linear',  tokenLabel: 'API Key', tokenPh: 'lin_api_...' },
                        { key: 'push',    label: 'Push (ntfy)', tokenLabel: 'ntfy Token (optional)', tokenPh: 'tk_...', isPush: true },
                      ].map(({ key, label, tokenLabel, tokenPh, needsUrl, needsEmail, isPush }) => {
                        const status  = wsIntegrations[key];
                        const cfg     = status?.config;
                        const hasCred = cfg?.configured;
                        const testR   = wsIntTestResults[key];
                        return (
                          <div key={key} style={{ border: '1px solid rgba(249,115,22,0.2)', borderRadius: 6, padding: '8px 10px', marginBottom: 8, background: 'rgba(249,115,22,0.04)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
                              <span style={{ fontSize: 10, fontWeight: 700, color: '#e2e8f0' }}>{label}</span>
                              <span style={{ fontSize: 8, padding: '1px 5px', borderRadius: 10, background: hasCred ? 'rgba(34,197,94,0.15)' : 'rgba(100,116,139,0.15)', color: hasCred ? '#4ade80' : '#64748b', fontWeight: 600 }}>
                                {hasCred ? 'CONFIGURED' : 'NOT SET'}
                              </span>
                              {cfg?.useWorkspaceByDefault && <span style={{ fontSize: 7, color: '#f97316', fontWeight: 600 }}>ACTIVE</span>}
                              {cfg?.lastTestAt && (
                                <span style={{ fontSize: 7, color: cfg.lastTestOk ? '#4ade80' : '#f87171', marginLeft: 'auto' }}>
                                  Last test: {cfg.lastTestOk ? 'OK' : 'FAILED'}
                                </span>
                              )}
                            </div>
                            {cfg?.connectedLabel && <div style={{ fontSize: 7, color: '#94a3b8', marginBottom: 4 }}>{cfg.connectedLabel}</div>}
                            {/* Token input */}
                            <div style={{ marginBottom: 4 }}>
                              <div style={{ fontSize: 7, color: '#64748b', marginBottom: 2 }}>{tokenLabel}</div>
                              <input
                                type="password"
                                placeholder={hasCred ? '••••••••••••••••' : tokenPh}
                                value={wsIntTokens[key] ?? ''}
                                onChange={e => setWsIntTokens(p => ({ ...p, [key]: e.target.value }))}
                                style={{ width: '100%', background: '#0f172a', border: '1px solid rgba(249,115,22,0.25)', borderRadius: 4, color: '#e2e8f0', fontSize: 9, padding: '4px 6px', boxSizing: 'border-box' }}
                              />
                            </div>
                            {/* Jira-specific URL + email */}
                            {needsUrl && (
                              <div style={{ marginBottom: 4 }}>
                                <div style={{ fontSize: 7, color: '#64748b', marginBottom: 2 }}>Workspace URL</div>
                                <input
                                  type="text"
                                  placeholder={cfg?.url || 'https://yourorg.atlassian.net'}
                                  value={wsIntUrls[key] ?? ''}
                                  onChange={e => setWsIntUrls(p => ({ ...p, [key]: e.target.value }))}
                                  style={{ width: '100%', background: '#0f172a', border: '1px solid rgba(249,115,22,0.25)', borderRadius: 4, color: '#e2e8f0', fontSize: 9, padding: '4px 6px', boxSizing: 'border-box' }}
                                />
                              </div>
                            )}
                            {needsEmail && (
                              <div style={{ marginBottom: 4 }}>
                                <div style={{ fontSize: 7, color: '#64748b', marginBottom: 2 }}>Email</div>
                                <input
                                  type="text"
                                  placeholder={cfg?.email || 'you@yourorg.com'}
                                  value={wsIntEmails[key] ?? ''}
                                  onChange={e => setWsIntEmails(p => ({ ...p, [key]: e.target.value }))}
                                  style={{ width: '100%', background: '#0f172a', border: '1px solid rgba(249,115,22,0.25)', borderRadius: 4, color: '#e2e8f0', fontSize: 9, padding: '4px 6px', boxSizing: 'border-box' }}
                                />
                              </div>
                            )}
                            {/* Push-specific ntfy topic */}
                            {isPush && (
                              <div style={{ marginBottom: 4 }}>
                                <div style={{ fontSize: 7, color: '#64748b', marginBottom: 2 }}>ntfy Topic</div>
                                <input
                                  type="text"
                                  placeholder={cfg?.pushTopic || 'workspace-alerts'}
                                  value={wsIntUrls[`push_topic`] ?? ''}
                                  onChange={e => setWsIntUrls(p => ({ ...p, 'push_topic': e.target.value }))}
                                  style={{ width: '100%', background: '#0f172a', border: '1px solid rgba(249,115,22,0.25)', borderRadius: 4, color: '#e2e8f0', fontSize: 9, padding: '4px 6px', boxSizing: 'border-box' }}
                                />
                              </div>
                            )}
                            {/* Controls row */}
                            <div style={{ display: 'flex', gap: 4, marginTop: 4, flexWrap: 'wrap', alignItems: 'center' }}>
                              <button
                                onClick={async () => {
                                  setWsIntErr('');
                                  const payload: Record<string, unknown> = {};
                                  if (wsIntTokens[key]) payload.token = wsIntTokens[key];
                                  if (wsIntUrls[key])   payload.url   = wsIntUrls[key];
                                  if (wsIntEmails[key]) payload.email = wsIntEmails[key];
                                  if (isPush) {
                                    payload.pushProvider = 'ntfy';
                                    if (wsIntUrls['push_topic']) payload.pushTopic = wsIntUrls['push_topic'];
                                  }
                                  const r = await (window.triforge as any).workspaceIntegration.setConfig(key, payload);
                                  if (r.ok) { setWsIntTokens(p => ({ ...p, [key]: '' })); await loadWsIntegrations(); }
                                  else setWsIntErr(r.error ?? 'Failed to save');
                                }}
                                style={{ fontSize: 8, padding: '3px 8px', background: '#f97316', color: '#fff', border: 'none', borderRadius: 4, cursor: 'pointer' }}
                              >Save</button>
                              <button
                                onClick={async () => {
                                  const r = await (window.triforge as any).workspaceIntegration.test(key);
                                  setWsIntTestResults(p => ({ ...p, [key]: { ok: r.ok, explanation: r.explanation } }));
                                  await loadWsIntegrations();
                                }}
                                style={{ fontSize: 8, padding: '3px 8px', background: 'rgba(249,115,22,0.15)', color: '#f97316', border: '1px solid rgba(249,115,22,0.3)', borderRadius: 4, cursor: 'pointer' }}
                              >Test</button>
                              {hasCred && (
                                <button
                                  onClick={async () => {
                                    const r = await (window.triforge as any).workspaceIntegration.revoke(key);
                                    if (r.ok) await loadWsIntegrations();
                                    else setWsIntErr(r.error ?? 'Failed to revoke');
                                  }}
                                  style={{ fontSize: 8, padding: '3px 8px', background: 'rgba(239,68,68,0.12)', color: '#f87171', border: '1px solid rgba(239,68,68,0.3)', borderRadius: 4, cursor: 'pointer' }}
                                >Revoke</button>
                              )}
                              <label style={{ display: 'flex', alignItems: 'center', gap: 3, marginLeft: 'auto', cursor: 'pointer' }}>
                                <input
                                  type="checkbox"
                                  checked={cfg?.useWorkspaceByDefault ?? false}
                                  onChange={async e => {
                                    await (window.triforge as any).workspaceIntegration.setDefaults(key, {
                                      useWorkspaceByDefault: e.target.checked,
                                      allowPersonalFallback: cfg?.allowPersonalFallback ?? true,
                                    });
                                    await loadWsIntegrations();
                                  }}
                                />
                                <span style={{ fontSize: 7, color: '#94a3b8' }}>Use workspace by default</span>
                              </label>
                            </div>
                            <div style={{ marginTop: 3 }}>
                              <label style={{ display: 'flex', alignItems: 'center', gap: 3, cursor: 'pointer' }}>
                                <input
                                  type="checkbox"
                                  checked={cfg?.allowPersonalFallback ?? true}
                                  onChange={async e => {
                                    await (window.triforge as any).workspaceIntegration.setDefaults(key, {
                                      useWorkspaceByDefault: cfg?.useWorkspaceByDefault ?? false,
                                      allowPersonalFallback: e.target.checked,
                                    });
                                    await loadWsIntegrations();
                                  }}
                                />
                                <span style={{ fontSize: 7, color: '#94a3b8' }}>Allow personal fallback</span>
                              </label>
                            </div>
                            {testR && <div style={{ fontSize: 7, marginTop: 4, color: testR.ok ? '#4ade80' : '#f87171' }}>{testR.explanation}</div>}
                            {status?.hasPersonalCred && !hasCred && (
                              <div style={{ fontSize: 7, color: '#64748b', marginTop: 3 }}>Personal credential available as fallback.</div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}
            </PanelSection>

            {/* GITHUB INTEGRATION */}
            <PanelSection title="GitHub" accent="#6366f1" count={ghPendingReviews.filter(r => r.status === 'pending').length}>
              {/* Connection status / PAT input */}
              {ghConnected ? (
                <div style={{ display: 'flex', alignItems: 'center', gap: 5, marginBottom: 8, padding: '3px 6px', borderRadius: 4, background: 'rgba(99,102,241,0.08)', border: '1px solid rgba(99,102,241,0.25)' }}>
                  <span style={{ fontSize: 8, color: '#6366f1', fontWeight: 800 }}>●</span>
                  <span style={{ fontSize: 9, color: 'var(--text-secondary)', flex: 1 }}>{ghConnected.login}</span>
                  <button
                    className="hq-btn"
                    onClick={() => setGhConnected(null)}
                    style={{ fontSize: 7, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: '1px 3px' }}
                  >
                    change
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: 4, marginBottom: 8 }}>
                  <input
                    type="password"
                    value={ghPatInput}
                    onChange={e => setGhPatInput(e.target.value)}
                    placeholder="GitHub PAT (ghp_…)"
                    style={{ flex: 1, fontSize: 9, padding: '3px 6px', borderRadius: 4, background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                    onKeyDown={e => e.key === 'Enter' && handleGhSavePat()}
                  />
                  <button
                    className="hq-btn"
                    onClick={handleGhSavePat}
                    disabled={ghPatSaving || !ghPatInput.trim()}
                    style={{ fontSize: 9, fontWeight: 700, padding: '3px 8px', borderRadius: 4, background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.3)', color: '#818cf8', cursor: ghPatSaving ? 'not-allowed' : 'pointer' }}
                  >
                    {ghPatSaving ? '…' : 'Connect'}
                  </button>
                </div>
              )}

              {ghConnected && (
                <>
                  {/* Tab bar */}
                  <div style={{ display: 'flex', gap: 2, marginBottom: 8 }}>
                    {(['repos', 'pending'] as const).map(tab => (
                      <button
                        key={tab}
                        className="hq-btn"
                        onClick={() => setGhTab(tab)}
                        style={{
                          flex: 1, fontSize: 8, fontWeight: 700, padding: '3px 0', borderRadius: 4,
                          background: ghTab === tab ? 'rgba(99,102,241,0.15)' : 'rgba(255,255,255,0.03)',
                          border: `1px solid ${ghTab === tab ? 'rgba(99,102,241,0.45)' : 'var(--border)'}`,
                          color: ghTab === tab ? '#818cf8' : 'var(--text-muted)',
                          cursor: 'pointer', textTransform: 'uppercase', letterSpacing: '0.06em',
                        }}
                      >
                        {tab === 'pending' ? `Pending${ghPendingReviews.filter(r => r.status === 'pending').length > 0 ? ` (${ghPendingReviews.filter(r => r.status === 'pending').length})` : ''}` : 'Repos'}
                      </button>
                    ))}
                  </div>

                  {ghTab === 'repos' && (
                    <>
                      {/* Repo selector */}
                      <select
                        value={ghSelectedRepo}
                        onChange={e => handleGhSelectRepo(e.target.value)}
                        style={{ width: '100%', fontSize: 9, padding: '3px 5px', borderRadius: 4, background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', marginBottom: 6 }}
                      >
                        <option value="">— Select repository —</option>
                        {ghRepos.map(r => (
                          <option key={r.id} value={r.full_name}>{r.full_name}{r.private ? ' 🔒' : ''}</option>
                        ))}
                      </select>

                      {ghLoadingRepo && (
                        <div style={{ fontSize: 9, color: 'var(--text-muted)', textAlign: 'center', padding: '6px 0' }}>Loading…</div>
                      )}

                      {/* PRs */}
                      {!ghLoadingRepo && ghPRs.length > 0 && (
                        <div style={{ marginBottom: 6 }}>
                          <div style={{ fontSize: 7, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3 }}>Pull Requests</div>
                          {ghPRs.slice(0, 6).map(pr => (
                            <div key={pr.number} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 5px', borderRadius: 4, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', marginBottom: 2 }}>
                              <span style={{ fontSize: 7, color: 'rgba(255,255,255,0.2)', fontFamily: 'monospace', flexShrink: 0 }}>#{pr.number}</span>
                              <span style={{ fontSize: 8, color: 'var(--text-secondary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={pr.title}>{pr.title}</span>
                              <button
                                className="hq-btn"
                                onClick={() => handleGhReviewPR(pr.number)}
                                disabled={ghReviewingPR === pr.number}
                                style={{ fontSize: 7, fontWeight: 700, padding: '1px 5px', borderRadius: 3, background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.28)', color: '#818cf8', cursor: ghReviewingPR === pr.number ? 'not-allowed' : 'pointer', flexShrink: 0 }}
                              >
                                {ghReviewingPR === pr.number ? '…' : 'Review'}
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      {/* Issues */}
                      {!ghLoadingRepo && ghIssues.length > 0 && (
                        <div style={{ marginBottom: 6 }}>
                          <div style={{ fontSize: 7, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 3 }}>Issues</div>
                          {ghIssues.slice(0, 6).map(issue => (
                            <div key={issue.number} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 5px', borderRadius: 4, background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', marginBottom: 2 }}>
                              <span style={{ fontSize: 7, color: 'rgba(255,255,255,0.2)', fontFamily: 'monospace', flexShrink: 0 }}>#{issue.number}</span>
                              <span style={{ fontSize: 8, color: 'var(--text-secondary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={issue.title}>{issue.title}</span>
                              <button
                                className="hq-btn"
                                onClick={() => handleGhTriageIssue(issue.number)}
                                disabled={ghTriagingIssue === issue.number}
                                style={{ fontSize: 7, fontWeight: 700, padding: '1px 5px', borderRadius: 3, background: 'rgba(16,163,127,0.1)', border: '1px solid rgba(16,163,127,0.28)', color: '#10a37f', cursor: ghTriagingIssue === issue.number ? 'not-allowed' : 'pointer', flexShrink: 0 }}
                              >
                                {ghTriagingIssue === issue.number ? '…' : 'Triage'}
                              </button>
                            </div>
                          ))}
                        </div>
                      )}

                      {!ghLoadingRepo && ghSelectedRepo && ghPRs.length === 0 && ghIssues.length === 0 && (
                        <div style={{ fontSize: 8, color: 'var(--text-muted)', textAlign: 'center', padding: '5px 0' }}>No open PRs or issues</div>
                      )}
                    </>
                  )}

                  {ghTab === 'pending' && (
                    <>
                      {ghPendingReviews.filter(r => r.status === 'pending').length === 0 ? (
                        <div style={{ fontSize: 8, color: 'var(--text-muted)', textAlign: 'center', padding: '8px 0' }}>No pending reviews</div>
                      ) : (
                        ghPendingReviews.filter(r => r.status === 'pending').map(rev => (
                          <div key={rev.id} style={{ padding: '5px 6px', borderRadius: 5, background: 'rgba(99,102,241,0.05)', border: '1px solid rgba(99,102,241,0.18)', marginBottom: 4 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginBottom: 3 }}>
                              <span style={{ fontSize: 7, fontWeight: 800, color: rev.type === 'pr' ? '#818cf8' : '#10a37f', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{rev.type}</span>
                              <span style={{ fontSize: 8, color: 'var(--text-secondary)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={rev.title}>{rev.owner}/{rev.repo} #{rev.number}</span>
                            </div>
                            <div style={{ fontSize: 8, color: 'var(--text-primary)', lineHeight: 1.4, marginBottom: 5, maxHeight: 48, overflow: 'hidden' }}>
                              {rev.synthesis}
                            </div>
                            <div style={{ display: 'flex', gap: 3 }}>
                              <button
                                className="hq-btn"
                                onClick={() => handleGhApprove(rev.id)}
                                disabled={ghApprovingId === rev.id}
                                style={{ flex: 1, fontSize: 8, fontWeight: 700, padding: '3px 0', borderRadius: 3, background: 'rgba(16,185,129,0.1)', border: '1px solid rgba(16,185,129,0.3)', color: '#10b981', cursor: ghApprovingId === rev.id ? 'not-allowed' : 'pointer' }}
                              >
                                {ghApprovingId === rev.id ? '…' : 'Approve & Post'}
                              </button>
                              <button
                                className="hq-btn"
                                onClick={() => handleGhDismiss(rev.id)}
                                disabled={ghDismissingId === rev.id}
                                style={{ flex: 1, fontSize: 8, fontWeight: 700, padding: '3px 0', borderRadius: 3, background: 'rgba(239,68,68,0.07)', border: '1px solid rgba(239,68,68,0.2)', color: '#f87171', cursor: ghDismissingId === rev.id ? 'not-allowed' : 'pointer' }}
                              >
                                {ghDismissingId === rev.id ? '…' : 'Dismiss'}
                              </button>
                            </div>
                          </div>
                        ))
                      )}
                    </>
                  )}

                  {/* Webhook row */}
                  <div style={{ marginTop: 8, paddingTop: 8, borderTop: '1px solid rgba(255,255,255,0.06)' }}>
                    <div style={{ fontSize: 7, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 5 }}>Webhook Automation</div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
                      <button
                        className="hq-btn"
                        onClick={handleGhWebhookToggle}
                        style={{
                          flex: 1, fontSize: 9, fontWeight: 700, padding: '3px 0', borderRadius: 4,
                          background: ghWebhookEnabled ? 'rgba(99,102,241,0.12)' : 'rgba(255,255,255,0.03)',
                          border: `1px solid ${ghWebhookEnabled ? 'rgba(99,102,241,0.35)' : 'var(--border)'}`,
                          color: ghWebhookEnabled ? '#818cf8' : 'var(--text-muted)', cursor: 'pointer',
                        }}
                      >
                        {ghWebhookEnabled ? 'WEBHOOK ON' : 'WEBHOOK OFF'}
                      </button>
                    </div>
                    <div style={{ display: 'flex', gap: 4 }}>
                      <input
                        type="password"
                        value={ghWebhookSecret}
                        onChange={e => setGhWebhookSecret(e.target.value)}
                        placeholder="Webhook secret (HMAC)"
                        style={{ flex: 1, fontSize: 8, padding: '3px 5px', borderRadius: 4, background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                      />
                      <button
                        className="hq-btn"
                        onClick={handleGhSaveWebhookSecret}
                        disabled={ghWebhookSecretSaving || !ghWebhookSecret.trim()}
                        style={{ fontSize: 8, fontWeight: 700, padding: '3px 7px', borderRadius: 4, background: 'rgba(99,102,241,0.1)', border: '1px solid rgba(99,102,241,0.25)', color: '#818cf8', cursor: ghWebhookSecretSaving ? 'not-allowed' : 'pointer' }}
                      >
                        {ghWebhookSecretSaving ? '…' : 'Save'}
                      </button>
                    </div>
                  </div>
                </>
              )}
            </PanelSection>

            {/* LOCAL MODEL PIPELINE */}
            <PanelSection title="Local Model" accent="#10a37f">
              {/* Endpoint + model config */}
              <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                <input
                  value={lmBaseUrl}
                  onChange={e => setLmBaseUrl(e.target.value)}
                  placeholder="http://localhost:11434"
                  style={{ flex: 1, fontSize: 8, padding: '3px 5px', borderRadius: 4, background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', fontFamily: 'monospace' }}
                />
              </div>
              <div style={{ display: 'flex', gap: 4, marginBottom: 6 }}>
                {lmAvailableModels.length > 0 ? (
                  <select
                    value={lmModelInput}
                    onChange={e => setLmModelInput(e.target.value)}
                    style={{ flex: 1, fontSize: 8, padding: '3px 5px', borderRadius: 4, background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                  >
                    <option value="">— select model —</option>
                    {lmAvailableModels.map(m => <option key={m} value={m}>{m}</option>)}
                  </select>
                ) : (
                  <input
                    value={lmModelInput}
                    onChange={e => setLmModelInput(e.target.value)}
                    placeholder="Model name (e.g. llama3, mistral)"
                    style={{ flex: 1, fontSize: 8, padding: '3px 5px', borderRadius: 4, background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)' }}
                  />
                )}
                <button
                  className="hq-btn"
                  onClick={handleLmTest}
                  disabled={lmTesting}
                  style={{ fontSize: 8, fontWeight: 700, padding: '3px 8px', borderRadius: 4, background: 'rgba(16,163,127,0.1)', border: '1px solid rgba(16,163,127,0.3)', color: '#10a37f', cursor: lmTesting ? 'not-allowed' : 'pointer', flexShrink: 0 }}
                >
                  {lmTesting ? '…' : 'Test'}
                </button>
              </div>

              {/* Test result */}
              {lmTestResult && (
                <div style={{ marginBottom: 6, padding: '3px 6px', borderRadius: 4, background: lmTestResult.ok ? 'rgba(16,163,127,0.07)' : 'rgba(239,68,68,0.07)', border: `1px solid ${lmTestResult.ok ? 'rgba(16,163,127,0.25)' : 'rgba(239,68,68,0.25)'}` }}>
                  <span style={{ fontSize: 8, color: lmTestResult.ok ? '#10a37f' : '#ef4444', fontWeight: 700 }}>
                    {lmTestResult.ok ? `Connected — ${lmTestResult.latencyMs}ms` : lmTestResult.error}
                  </span>
                </div>
              )}

              {/* Save button */}
              <button
                className="hq-btn"
                onClick={handleLmSave}
                disabled={lmSaving}
                style={{ width: '100%', fontSize: 9, fontWeight: 700, padding: '3px 0', borderRadius: 4, background: 'rgba(16,163,127,0.08)', border: '1px solid rgba(16,163,127,0.22)', color: '#10a37f', cursor: lmSaving ? 'not-allowed' : 'pointer', marginBottom: 8 }}
              >
                {lmSaving ? 'Saving…' : 'Save Config'}
              </button>

              {/* Routing toggle */}
              <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                <button
                  className="hq-btn"
                  onClick={handleLmToggleRouting}
                  disabled={lmTogglingRouting}
                  style={{
                    flex: 1, fontSize: 9, fontWeight: 700, padding: '4px 0', borderRadius: 4,
                    background: lmConfig?.enabled ? 'rgba(16,163,127,0.12)' : 'rgba(255,255,255,0.03)',
                    border: `1px solid ${lmConfig?.enabled ? 'rgba(16,163,127,0.4)' : 'var(--border)'}`,
                    color: lmConfig?.enabled ? '#10a37f' : 'var(--text-muted)',
                    cursor: lmTogglingRouting ? 'not-allowed' : 'pointer',
                  }}
                >
                  {lmTogglingRouting ? '…' : lmConfig?.enabled ? 'LOCAL ROUTING ON' : 'LOCAL ROUTING OFF'}
                </button>
              </div>

              {/* Fallback toggle */}
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                <span style={{ fontSize: 8, color: 'var(--text-muted)' }}>Cloud fallback if unavailable</span>
                <button
                  className="hq-btn"
                  onClick={handleLmToggleFallback}
                  style={{ fontSize: 7, fontWeight: 700, padding: '1px 6px', borderRadius: 3, background: lmConfig?.fallback ? 'rgba(16,163,127,0.1)' : 'rgba(239,68,68,0.08)', border: `1px solid ${lmConfig?.fallback ? 'rgba(16,163,127,0.3)' : 'rgba(239,68,68,0.2)'}`, color: lmConfig?.fallback ? '#10a37f' : '#f87171', cursor: 'pointer' }}
                >
                  {lmConfig?.fallback ? 'ON' : 'OFF'}
                </button>
              </div>

              {/* Routing policy hint */}
              {lmConfig?.enabled && (
                <div style={{ fontSize: 7, color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: 8, padding: '3px 5px', background: 'rgba(16,163,127,0.04)', borderRadius: 3 }}>
                  informational · research · ops → local<br />
                  write_action · high_risk → cloud<br />
                  council → cloud (per-model)
                </div>
              )}

              {/* Local skill analysis */}
              <div style={{ borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 8, marginTop: 2 }}>
                <div style={{ fontSize: 7, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginBottom: 5 }}>Local Skill Analysis</div>
                <textarea
                  value={lmSkillMd}
                  onChange={e => setLmSkillMd(e.target.value)}
                  placeholder="Paste SKILL.md to analyze locally…"
                  style={{ width: '100%', height: 60, resize: 'vertical', fontSize: 8, fontFamily: 'monospace', background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-primary)', borderRadius: 4, padding: '3px 5px', boxSizing: 'border-box', marginBottom: 4 }}
                />
                <button
                  className="hq-btn"
                  onClick={handleLmSkillAnalyze}
                  disabled={lmSkillAnalyzing || !lmSkillMd.trim() || !lmConfig?.enabled}
                  style={{ width: '100%', fontSize: 9, fontWeight: 700, padding: '3px 0', borderRadius: 4, background: 'rgba(16,163,127,0.07)', border: '1px solid rgba(16,163,127,0.2)', color: lmConfig?.enabled ? '#10a37f' : 'var(--text-muted)', cursor: lmSkillAnalyzing || !lmConfig?.enabled ? 'not-allowed' : 'pointer', marginBottom: 5 }}
                >
                  {lmSkillAnalyzing ? 'Analyzing…' : lmConfig?.enabled ? 'Analyze Locally' : 'Enable routing first'}
                </button>

                {lmSkillResult && (() => {
                  const riskColors: Record<string, string> = { low: '#10b981', medium: '#f59e0b', high: '#f97316', critical: '#ef4444' };
                  const rc = riskColors[lmSkillResult.riskLevel ?? ''] ?? '#10a37f';
                  return (
                    <div style={{ fontSize: 8, lineHeight: 1.5 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 4, padding: '2px 5px', borderRadius: 3, background: `${rc}12`, border: `1px solid ${rc}25` }}>
                        <span style={{ fontWeight: 800, color: rc, textTransform: 'uppercase', fontSize: 7, letterSpacing: '0.08em' }}>{lmSkillResult.riskLevel ?? '—'}</span>
                        <span style={{ fontSize: 7, color: 'rgba(16,163,127,0.7)' }}>via local model</span>
                      </div>
                      <div style={{ color: 'var(--text-secondary)', marginBottom: 4 }}>{lmSkillResult.summary}</div>
                      {(lmSkillResult.findings ?? []).slice(0, 3).map((f, i) => (
                        <div key={i} style={{ fontSize: 7, color: 'var(--text-muted)', padding: '1px 4px', borderRadius: 2, background: 'rgba(255,255,255,0.02)', marginBottom: 1 }}>• {f}</div>
                      ))}
                    </div>
                  );
                })()}
              </div>
            </PanelSection>

            {/* VALUE SIGNALS */}
            {(() => {
              const vm = campaignMetrics ?? globalMetrics;
              const activeCampaign = campaigns.find(c => c.id === activeCampaignId);
              if (!vm && !activeCampaignId) return null;
              const roiPct = vm?.roi != null ? Math.round(vm.roi * 100) : null;
              const roiColor = roiPct == null ? 'var(--text-muted)' : roiPct > 0 ? '#10b981' : roiPct < 0 ? '#ef4444' : 'var(--text-muted)';
              const replyRatePct = vm?.replyRate != null ? (vm.replyRate * 100).toFixed(1) : null;
              return (
                <PanelSection title={activeCampaign ? activeCampaign.name : 'Value Signals'} accent="#a855f7">
                  {vm ? (
                    <>
                      {/* Key metrics grid */}
                      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 4, marginBottom: 6 }}>
                        <div style={{ padding: '4px 6px', borderRadius: 5, background: 'rgba(168,85,247,0.05)', border: '1px solid rgba(168,85,247,0.12)', textAlign: 'center' }}>
                          <div style={{ fontSize: 15, fontWeight: 800, color: '#c084fc' }}>{vm.emailsSent}</div>
                          <div style={{ fontSize: 7, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Sent</div>
                        </div>
                        <div style={{ padding: '4px 6px', borderRadius: 5, background: 'rgba(168,85,247,0.05)', border: '1px solid rgba(168,85,247,0.12)', textAlign: 'center' }}>
                          <div style={{ fontSize: 15, fontWeight: 800, color: '#a5b4fc' }}>{vm.repliesReceived}</div>
                          <div style={{ fontSize: 7, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Replies</div>
                        </div>
                        <div style={{ padding: '4px 6px', borderRadius: 5, background: 'rgba(168,85,247,0.05)', border: '1px solid rgba(168,85,247,0.12)', textAlign: 'center' }}>
                          <div style={{ fontSize: 15, fontWeight: 800, color: '#10b981' }}>{vm.leadsGenerated}</div>
                          <div style={{ fontSize: 7, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Leads</div>
                        </div>
                        <div style={{ padding: '4px 6px', borderRadius: 5, background: 'rgba(168,85,247,0.05)', border: '1px solid rgba(168,85,247,0.12)', textAlign: 'center' }}>
                          <div style={{ fontSize: 15, fontWeight: 800, color: roiColor }}>
                            {roiPct != null ? `${roiPct > 0 ? '+' : ''}${roiPct}%` : '—'}
                          </div>
                          <div style={{ fontSize: 7, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>ROI</div>
                        </div>
                      </div>

                      {/* Secondary row */}
                      <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--text-muted)', marginBottom: 5, padding: '3px 5px', background: 'rgba(255,255,255,0.02)', borderRadius: 4 }}>
                        <span>Reply rate: <span style={{ color: replyRatePct ? (parseFloat(replyRatePct) >= 3 ? '#10b981' : '#f59e0b') : 'var(--text-muted)', fontWeight: 600 }}>{replyRatePct != null ? `${replyRatePct}%` : '—'}</span></span>
                        <span>Posts: <span style={{ color: vm.postsPublished > 0 ? '#a5b4fc' : 'var(--text-muted)', fontWeight: 600 }}>{vm.postsPublished}</span></span>
                      </div>

                      {/* Spend / Value row */}
                      {(vm.spendCents > 0 || vm.valueRecordedCents > 0) && (
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, marginBottom: 5, padding: '3px 5px', background: 'rgba(255,255,255,0.02)', borderRadius: 4 }}>
                          <span style={{ color: 'var(--text-muted)' }}>Spend: <span style={{ color: '#f59e0b', fontWeight: 600 }}>{formatCents(vm.spendCents)}</span></span>
                          <span style={{ color: 'var(--text-muted)' }}>Value: <span style={{ color: '#10b981', fontWeight: 600 }}>{formatCents(vm.valueRecordedCents)}</span></span>
                        </div>
                      )}

                      {/* Optimization hint */}
                      {optimization && optimization.suggestedActions.length > 0 && (
                        <div style={{
                          padding: '5px 7px', borderRadius: 5, marginBottom: 5,
                          background: optimization.priority === 'high' ? 'rgba(239,68,68,0.05)' : optimization.priority === 'medium' ? 'rgba(245,158,11,0.05)' : 'rgba(99,102,241,0.04)',
                          border: `1px solid ${optimization.priority === 'high' ? 'rgba(239,68,68,0.18)' : optimization.priority === 'medium' ? 'rgba(245,158,11,0.18)' : 'rgba(99,102,241,0.14)'}`,
                        }}>
                          <div style={{ fontSize: 8, fontWeight: 700, color: optimization.priority === 'high' ? '#ef4444' : optimization.priority === 'medium' ? '#f59e0b' : '#a5b4fc', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 3 }}>
                            {optimization.priority.toUpperCase()} PRIORITY
                          </div>
                          <div style={{ fontSize: 9, color: 'var(--text-secondary)', lineHeight: 1.4 }}>
                            {optimization.suggestedActions[0]}
                          </div>
                        </div>
                      )}

                      {/* Record Value form */}
                      <div style={{ marginTop: 4 }}>
                        <div style={{ fontSize: 8, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em', marginBottom: 4 }}>Record Value</div>
                        <div style={{ display: 'flex', gap: 4, marginBottom: 4 }}>
                          <input
                            style={{ width: 58, background: 'var(--bg-input)', border: '1px solid rgba(168,85,247,0.25)', color: 'var(--text-primary)', borderRadius: 4, fontSize: 11, padding: '3px 6px', boxSizing: 'border-box' }}
                            placeholder="$0.00"
                            value={valueAmount}
                            onChange={e => setValueAmount(e.target.value.replace(/[^0-9.]/g, ''))}
                            onKeyDown={e => { if (e.key === 'Enter') handleRecordValue(); }}
                          />
                          <input
                            style={{ flex: 1, background: 'var(--bg-input)', border: '1px solid var(--border)', color: 'var(--text-secondary)', borderRadius: 4, fontSize: 10, padding: '3px 6px', boxSizing: 'border-box' }}
                            placeholder="Note (optional)"
                            value={valueNote}
                            onChange={e => setValueNote(e.target.value)}
                            onKeyDown={e => { if (e.key === 'Enter') handleRecordValue(); }}
                          />
                        </div>
                        <div style={{ position: 'relative' }}>
                          <button
                            className="hq-btn"
                            style={{ width: '100%', fontSize: 9, fontWeight: 700, padding: '3px 0', borderRadius: 4, background: valueAmount.trim() && !recordingValue ? 'rgba(168,85,247,0.15)' : 'transparent', border: `1px solid ${valueAmount.trim() ? 'rgba(168,85,247,0.35)' : 'var(--border)'}`, color: valueAmount.trim() ? '#c084fc' : 'var(--text-muted)', cursor: valueAmount.trim() && !recordingValue ? 'pointer' : 'not-allowed' }}
                            onClick={handleRecordValue}
                            disabled={!valueAmount.trim() || recordingValue}
                          >{recordingValue ? 'Recording…' : 'Record'}</button>
                          {feedback['record-value'] && <FeedbackBubble msg={feedback['record-value']} color="#a855f7" />}
                        </div>
                      </div>
                    </>
                  ) : (
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', textAlign: 'center', padding: '8px 0', fontStyle: 'italic' }}>
                      No metrics yet — run tasks to begin tracking
                    </div>
                  )}
                </PanelSection>
              );
            })()}

            {/* RESULTS */}
            {resultMetrics && (
              <PanelSection title="Results" accent="#10b981">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5, marginBottom: 8 }}>
                  <div style={{ padding: '5px 7px', borderRadius: 5, background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.15)', textAlign: 'center' }}>
                    <div style={{ fontSize: 17, fontWeight: 800, color: '#10b981' }}>{resultMetrics.total}</div>
                    <div style={{ fontSize: 8, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Total</div>
                  </div>
                  <div style={{ padding: '5px 7px', borderRadius: 5, background: 'rgba(16,185,129,0.06)', border: '1px solid rgba(16,185,129,0.15)', textAlign: 'center' }}>
                    <div style={{ fontSize: 17, fontWeight: 800, color: resultMetrics.failed > 0 ? '#ef4444' : '#10b981' }}>
                      {resultMetrics.total > 0 ? Math.round((resultMetrics.successful / resultMetrics.total) * 100) : 0}%
                    </div>
                    <div style={{ fontSize: 8, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.07em' }}>Success</div>
                  </div>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--text-muted)', marginBottom: 6 }}>
                  <span>✓ {resultMetrics.successful} succeeded</span>
                  <span style={{ color: resultMetrics.failed > 0 ? '#ef4444' : 'var(--text-muted)' }}>✕ {resultMetrics.failed} failed</span>
                </div>
                {resultMetrics.paperMode > 0 && (
                  <div style={{ fontSize: 9, color: '#f59e0b', padding: '2px 6px', background: 'rgba(245,158,11,0.06)', border: '1px solid rgba(245,158,11,0.18)', borderRadius: 4, marginBottom: 6, textAlign: 'center' }}>
                    {resultMetrics.paperMode} paper-mode executions
                  </div>
                )}
                {Object.entries(resultMetrics.byTool).length > 0 && (
                  <div>
                    {Object.entries(resultMetrics.byTool).slice(0, 4).map(([tool, s]) => (
                      <div key={tool} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--text-muted)', marginBottom: 2 }}>
                        <span style={{ fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 120 }}>{tool}</span>
                        <span style={{ color: s.success === s.total ? '#10b981' : s.success === 0 ? '#ef4444' : '#f59e0b', fontWeight: 600 }}>{s.success}/{s.total}</span>
                      </div>
                    ))}
                  </div>
                )}
              </PanelSection>
            )}

            {/* WALLET */}
            <PanelSection title="Wallet" accent="#10a37f">
              {!wallet ? (
                <div style={{ fontSize: 11, color: 'var(--text-muted)', textAlign: 'center', fontStyle: 'italic' }}>Loading…</div>
              ) : (
                <>
                  {/* Main bar */}
                  <div style={{ marginBottom: 6 }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, fontWeight: 700, letterSpacing: '0.07em', color: 'rgba(255,255,255,0.28)', textTransform: 'uppercase', marginBottom: 3 }}>
                      <span>Daily Budget</span>
                      <span style={{ color: budgetColor }}>{budgetPct.toFixed(0)}% used</span>
                    </div>
                    <div style={{ height: 5, background: 'rgba(255,255,255,0.06)', borderRadius: 3, overflow: 'hidden', marginBottom: 4 }}>
                      <div style={{ height: '100%', borderRadius: 3, width: `${budgetPct.toFixed(1)}%`, background: `linear-gradient(90deg, ${budgetColor}bb, ${budgetColor})`, transition: 'width 0.8s ease, background 0.5s ease', boxShadow: `0 0 6px ${budgetColor}66` }} />
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10 }}>
                      <span style={{ color: 'var(--text-muted)' }}>Spent: <span style={{ color: budgetColor, fontWeight: 600 }}>{formatCents(wallet.totalSpentCents)}</span></span>
                      <span style={{ color: remaining > 0 ? 'rgba(255,255,255,0.4)' : '#ef4444', fontWeight: remaining < 0 ? 700 : 400 }}>
                        {remaining >= 0 ? `${formatCents(remaining)} left` : `${formatCents(-remaining)} over`}
                      </span>
                    </div>
                  </div>

                  {/* Reserved */}
                  {wallet.totalReservedCents > 0 && (
                    <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 5, padding: '3px 6px', background: 'rgba(255,255,255,0.03)', borderRadius: 4 }}>
                      Reserved: <span style={{ color: '#f59e0b' }}>{formatCents(wallet.totalReservedCents)}</span>
                    </div>
                  )}

                  {/* Per-category bars */}
                  {Object.entries(wallet.categorySpent).filter(([, v]) => v > 0).map(([cat, v]) => {
                    const catPct = Math.min(100, (v / Math.max(1, wallet.dailyBudgetCents)) * 100);
                    return (
                      <div key={cat} style={{ marginBottom: 4 }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 9, color: 'var(--text-muted)', marginBottom: 2 }}>
                          <span>{cat}</span>
                          <span style={{ color: 'var(--text-secondary)' }}>{formatCents(v)}</span>
                        </div>
                        <div style={{ height: 2, background: 'rgba(255,255,255,0.05)', borderRadius: 2, overflow: 'hidden' }}>
                          <div style={{ height: '100%', width: `${catPct.toFixed(1)}%`, background: '#10a37f88', borderRadius: 2, transition: 'width 0.6s ease' }} />
                        </div>
                      </div>
                    );
                  })}
                </>
              )}
            </PanelSection>
          </div>
        </div>
      </div>

      {/* ══ EVENT TIMELINE (bottom strip) ════════════════════════════════════ */}
      <div style={{ height: 80, borderTop: '1px solid var(--border)', flexShrink: 0, background: 'var(--bg-surface)', display: 'flex', flexDirection: 'column' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '4px 12px 0' }}>
          <span style={{ fontSize: 8, fontWeight: 800, letterSpacing: '0.12em', color: 'var(--text-muted)', textTransform: 'uppercase' }}>
            Live Events
          </span>
          {events.length > 0 && (
            <span style={{ fontSize: 8, color: 'rgba(255,255,255,0.18)' }}>
              {events.length} events
            </span>
          )}
        </div>
        <div
          ref={timelineRef}
          className="hq-scroll"
          style={{ overflowX: 'auto', overflowY: 'hidden', display: 'flex', gap: 5, padding: '4px 12px 6px', alignItems: 'flex-start', flex: 1 }}
        >
          {events.length === 0 && (
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.12)', fontStyle: 'italic', alignSelf: 'center', paddingLeft: 4 }}>
              Waiting for activity…
            </div>
          )}
          {events.map((ev, i) => {
            const meta = EVENT_META[ev.type] ?? { color: 'rgba(255,255,255,0.25)', label: ev.type, icon: '·', summary: ev.type.toLowerCase() };
            const isNewest  = i === events.length - 1;
            const isRecent  = i >= events.length - 3;
            const ageS      = ev._ts ? Math.floor((now - ev._ts) / 1000) : null;
            const ageLabel  = ageS === null ? null : ageS < 5 ? 'now' : ageS < 60 ? `${ageS}s` : `${Math.floor(ageS / 60)}m`;
            return (
              <div
                key={i}
                style={{
                  flexShrink: 0, padding: '4px 8px', borderRadius: 6, minWidth: 72, maxWidth: 104,
                  background: `${meta.color}${isRecent ? '14' : '09'}`,
                  border: `1px solid ${meta.color}${isNewest ? '55' : isRecent ? '35' : '1e'}`,
                  display: 'flex', flexDirection: 'column', gap: 2,
                  animation: isNewest ? 'hq-event-slide 0.32s ease-out' : 'none',
                  boxShadow: isNewest ? `0 0 10px ${meta.color}25` : 'none',
                  opacity: isRecent ? 1 : 0.55,
                  transition: 'opacity 0.5s, box-shadow 0.5s',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ fontSize: 9, color: meta.color }}>{meta.icon}</span>
                  <span style={{ fontSize: 8, fontWeight: 800, color: meta.color, letterSpacing: '0.05em', textTransform: 'uppercase', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }}>
                    {meta.label}
                  </span>
                  {ageLabel && (
                    <span style={{ fontSize: 7, color: 'rgba(255,255,255,0.2)', flexShrink: 0, fontFamily: 'monospace' }}>
                      +{ageLabel}
                    </span>
                  )}
                </div>
                <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.5)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {meta.summary}
                </span>
                {ev.taskId && (
                  <span style={{ fontSize: 7, color: 'rgba(255,255,255,0.18)', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    …{String(ev.taskId).slice(-6)}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────────────

function TaskActionBtn({ label, color, onClick }: { label: string; color: string; onClick: React.MouseEventHandler }) {
  return (
    <button
      className="hq-btn"
      style={{ fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 4, cursor: 'pointer', background: `${color}18`, border: `1px solid ${color}44`, color, letterSpacing: '0.04em' }}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function PrimaryBtn({ label, color, onClick }: { label: string; color: string; onClick: () => void }) {
  return (
    <button
      className="hq-btn"
      style={{ fontSize: 11, fontWeight: 700, padding: '5px 13px', borderRadius: 6, cursor: 'pointer', background: `${color}1a`, border: `1px solid ${color}55`, color }}
      onClick={onClick}
    >
      {label}
    </button>
  );
}

function PanelSection({ title, count, accent, children }: { title: string; count?: number; accent?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 12 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6, padding: '0 2px' }}>
        <div style={{ width: 3, height: 12, borderRadius: 2, background: accent ?? 'var(--accent)', flexShrink: 0 }} />
        <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.1em', color: 'var(--text-secondary)', textTransform: 'uppercase' }}>{title}</span>
        {count != null && count > 0 && (
          <span style={{ marginLeft: 'auto', fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 10, background: `${accent ?? 'var(--accent)'}20`, color: accent ?? 'var(--accent)' }}>
            {count}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}

function InfoPair({ label, value, valueColor }: { label: string; value: string; valueColor?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
      <span style={{ fontSize: 8, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{label}</span>
      <span style={{ fontSize: 11, fontWeight: 700, color: valueColor ?? 'var(--text-primary)' }}>{value}</span>
    </div>
  );
}

function FeedbackBubble({ msg, color }: { msg: string; color: string }) {
  return (
    <div style={{
      position: 'absolute', bottom: '100%', left: '50%',
      transform: 'translateX(-50%)', marginBottom: 5,
      padding: '3px 8px', borderRadius: 5, whiteSpace: 'nowrap', zIndex: 10,
      background: `${color}22`, border: `1px solid ${color}55`, color,
      fontSize: 10, fontWeight: 700, pointerEvents: 'none',
      animation: 'hq-feedback-out 1.8s ease-out forwards',
    }}>
      {msg}
    </div>
  );
}
