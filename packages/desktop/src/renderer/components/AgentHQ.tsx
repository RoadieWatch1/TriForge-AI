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
        setTimeout(() => setAwayBanner(null), 12000);
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

    return unsub;
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
