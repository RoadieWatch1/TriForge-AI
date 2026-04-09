import React, { useState, useEffect, useCallback } from 'react';
import { MissionControl } from '../components/MissionControl';
import { AgentHQ } from '../components/AgentHQ';
import { MissionQueueScreen } from './MissionQueueScreen';

// ── Types ─────────────────────────────────────────────────────────────────────

// ── Worker Runtime types (mirrors workerRuntime/types.ts — kept local to avoid
//    renderer importing from main process directly) ─────────────────────────

interface WorkerRunRecord {
  id: string;
  goal: string;
  packId?: string;
  workflowId?: string;
  operatorSessionId?: string;
  source: 'chat' | 'operate' | 'session_resume' | 'webhook';
  status: string;
  machineId: string;
  createdAt: number;
  updatedAt: number;
  currentStepIndex: number;
  lastHeartbeatAt?: number;
  blocker?: { kind: string; message: string; recoverable: boolean };
  artifacts: string[];
  approvals: string[];
}

interface WorkerStepRecord {
  id: string;
  runId: string;
  index: number;
  title: string;
  type: string;
  status: string;
  startedAt?: number;
  endedAt?: number;
  error?: string;
  artifactIds?: string[];
}

interface WorkerArtifactRecord {
  id: string;
  runId: string;
  stepId?: string;
  kind: string;
  path: string;
  createdAt: number;
  meta?: Record<string, unknown>;
}

interface WorkerRunDetail {
  run: WorkerRunRecord;
  steps: WorkerStepRecord[];
  artifacts: WorkerArtifactRecord[];
}

interface StepSummary {
  id: string;
  title: string;
  tool: string;
  status: 'pending' | 'running' | 'awaiting_approval' | 'completed' | 'failed' | 'skipped';
  riskLevel: 'low' | 'medium' | 'high';
  error?: string;
  blockedReason?: string;
}

interface TaskPlan {
  goalStatement: string;
  strategyNotes: string;
  steps: StepSummary[];
}

interface Task {
  id: string;
  goal: string;
  category: string;
  status: 'queued' | 'planning' | 'running' | 'paused' | 'awaiting_approval' | 'completed' | 'failed' | 'cancelled';
  createdAt: number;
  updatedAt: number;
  error?: string;
  plan?: TaskPlan;
  currentStepIndex?: number;
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
  status: 'pending' | 'approved' | 'denied' | 'expired';
}

// ── Helpers ───────────────────────────────────────────────────────────────────

const RISK_COLOR: Record<string, string> = {
  low: '#10a37f',
  medium: '#f59e0b',
  high: '#ef4444',
};

const STATUS_COLOR: Record<string, string> = {
  running:           '#10a37f',
  planning:          '#6366f1',
  queued:            '#f59e0b',
  paused:            '#f59e0b',
  awaiting_approval: '#ef4444',
  completed:         'var(--text-muted)',
  failed:            '#ef4444',
  cancelled:         'var(--text-muted)',
};

const STATUS_LABEL: Record<string, string> = {
  running:           'Running',
  planning:          'Planning',
  queued:            'Queued',
  paused:            'Paused',
  awaiting_approval: 'Needs Approval',
  completed:         'Done',
  failed:            'Failed',
  cancelled:         'Cancelled',
};

/** Convert a raw tool identifier to a human-readable label. */
function toolLabel(tool: string): string {
  const LABELS: Record<string, string> = {
    draft_email:       'Draft Email',
    send_email:        'Send Email',
    schedule_post:     'Schedule Post',
    post_twitter:      'Post to Twitter',
    run_outreach:      'Run Outreach',
    doc_search:        'Document Search',
    file_organize:     'Organize Files',
    broker_sim:        'Broker Simulation',
    analyze_results:   'Analyze Results',
    web_research:      'Web Research',
    read_file:         'Read File',
    write_file:        'Write File',
    append_file:       'Append to File',
    run_command:       'Run Command',
    fetch_url:         'Fetch URL',
    search_workspace:  'Search Workspace',
    it_diagnostics:    'IT Diagnostics',
    it_network_doctor: 'Network Check',
    it_event_logs:     'Event Logs',
    it_services:       'Services',
    it_processes:      'Processes',
    it_script_runner:  'Script Runner',
    it_patch_advisor:  'Patch Advisor',
    launch_experiment: 'Launch Experiment',
    spend_budget:      'Spend Budget',
    publish_content:   'Publish Content',
    kill_experiment:   'Stop Experiment',
    scale_experiment:  'Scale Experiment',
    connect_platform:  'Connect Platform',
    install_tool:      'Install Tool',
  };
  return LABELS[tool] ?? tool.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/** Capitalize the first letter of a word. */
function capitalize(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// ── Worker Run helpers ────────────────────────────────────────────────────────

const WORKER_RUN_STATUS_COLOR: Record<string, string> = {
  queued:           '#f59e0b',
  planning:         '#6366f1',
  ready:            '#6366f1',
  running:          '#10a37f',
  waiting_approval: '#ef4444',
  blocked:          '#f59e0b',
  completed:        'var(--text-muted)',
  failed:           '#ef4444',
  cancelled:        'var(--text-muted)',
};

const WORKER_RUN_STATUS_LABEL: Record<string, string> = {
  queued:           'Queued',
  planning:         'Planning',
  ready:            'Ready',
  running:          'Running',
  waiting_approval: 'Needs Approval',
  blocked:          'Interrupted',
  completed:        'Done',
  failed:           'Failed',
  cancelled:        'Cancelled',
};

/** Human-readable label for a workflow pack ID. */
function packLabel(packId?: string): string {
  if (!packId) return 'Workflow';
  const PACK_LABELS: Record<string, string> = {
    'pack.readiness-check':  'Readiness Check',
    'pack.app-context':      'App Context',
    'pack.focus-capture':    'Focus & Capture',
    'pack.supervised-input': 'Supervised Input',
  };
  return PACK_LABELS[packId]
    ?? packId.replace(/^pack\./, '').replace(/-/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/** Describe a blocker in plain language. */
function blockerLabel(blocker?: WorkerRunRecord['blocker']): string | null {
  if (!blocker) return null;
  const msg = blocker.message ?? '';
  if (blocker.kind === 'tool_failed' && msg.toLowerCase().includes('restart')) {
    return 'Interrupted after restart — review to continue';
  }
  const KIND_LABELS: Record<string, string> = {
    approval_required:   'Waiting for approval',
    permission_missing:  'Missing OS permission',
    capability_missing:  'Capability not available',
    target_not_found:    'Target app not found',
    user_input_required: 'User input needed',
    tool_failed:         'Step failed',
  };
  return KIND_LABELS[blocker.kind] ?? blocker.message.slice(0, 80);
}

/** Source label shown as a secondary badge. */
function sourceLabel(source: string): string {
  const LABELS: Record<string, string> = {
    operate:         'Operate',
    chat:            'Chat',
    session_resume:  'Resumed',
    webhook:         'Webhook',
  };
  return LABELS[source] ?? source;
}

/** Artifact kind label. */
function artifactKindLabel(kind: string): string {
  const LABELS: Record<string, string> = {
    screenshot:    'Screenshot',
    log:           'Log',
    plan:          'Plan',
    file:          'File',
    diff:          'Diff',
    'build-output': 'Build Output',
  };
  return LABELS[kind] ?? kind;
}

// ── Shared window.triforge accessor ──────────────────────────────────────────

function getTf(): Record<string, unknown> | undefined {
  return (window as unknown as { triforge?: Record<string, unknown> }).triforge;
}

function relativeTime(ts: number): string {
  const diff = Date.now() - ts;
  const s = Math.floor(diff / 1000);
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** Produce a short args preview for an approval row — shows key/value pairs, truncated. */
function argsPreview(args?: Record<string, unknown>): string {
  if (!args) return '';
  const pairs = Object.entries(args)
    .filter(([, v]) => v !== undefined && v !== null && v !== '')
    .slice(0, 2)
    .map(([k, v]) => `${k}: ${String(v).slice(0, 40)}`);
  return pairs.join(' · ');
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

type SessionsView = 'overview' | 'missions' | 'queue' | 'history';

// ── Main Component ────────────────────────────────────────────────────────────

export function SessionsScreen() {
  const [view, setView] = useState<SessionsView>('overview');

  return (
    <div style={styles.page}>

      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerTop}>
          <h1 style={styles.title}>Sessions</h1>
          <div style={styles.statusPill}>
            <span style={styles.statusDot} />
            <span style={styles.statusLabel}>Runtime</span>
          </div>
        </div>
        <p style={styles.subtitle}>
          Monitor active tasks, respond to approval requests, and review execution history.
        </p>
      </div>

      {/* Sub-nav */}
      <div style={styles.subnav}>
        <TabBtn active={view === 'overview'} onClick={() => setView('overview')}>Overview</TabBtn>
        <TabBtn active={view === 'missions'} onClick={() => setView('missions')}>Mission Queue</TabBtn>
        <TabBtn active={view === 'queue'}    onClick={() => setView('queue')}>Task Queue</TabBtn>
        <TabBtn active={view === 'history'}  onClick={() => setView('history')}>History</TabBtn>
      </div>

      {/* Content */}
      <div style={styles.content}>
        {view === 'overview' && <SessionsOverview />}
        {view === 'missions' && (
          <div style={styles.embeddedSurface}>
            <MissionQueueScreen />
          </div>
        )}
        {view === 'queue' && (
          <div style={styles.embeddedSurface}>
            <AgentHQ />
          </div>
        )}
        {view === 'history' && (
          <div style={styles.embeddedSurface}>
            <div style={styles.historyFrame}>
              <span style={styles.historyFrameLabel}>Session History</span>
              <span style={styles.historyFrameDesc}>Completed sessions, task history, and execution records</span>
            </div>
            <MissionControl />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Overview ──────────────────────────────────────────────────────────────────

function SessionsOverview() {
  const [tasks, setTasks]                   = useState<Task[]>([]);
  const [approvals, setApprovals]           = useState<ApprovalRequest[]>([]);
  const [workerRuns, setWorkerRuns]         = useState<WorkerRunRecord[]>([]);
  const [resumeCandidates, setResumeCandidates] = useState<WorkerRunRecord[]>([]);
  const [loading, setLoading]               = useState(true);
  const [actionBusy, setActionBusy]         = useState<string | null>(null);
  const [expandedRunId, setExpandedRunId]   = useState<string | null>(null);
  const [runDetails, setRunDetails]         = useState<Record<string, WorkerRunDetail>>({});
  const [resumeMessages, setResumeMessages] = useState<Record<string, { ok: boolean; msg: string }>>({});
  const [resumeBusy, setResumeBusy]         = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const tf = getTf();
      if (!tf) { setLoading(false); return; }

      const [taskRes, approvalRes, workerRunsRes, resumeRes] = await Promise.allSettled([
        (tf['taskEngine'] as Record<string, () => Promise<unknown>>)?.listTasks?.(),
        (tf['approvals']  as Record<string, () => Promise<unknown>>)?.list?.(),
        (tf['workerRuntime'] as Record<string, () => Promise<unknown>>)?.list?.(),
        (tf['workerRuntime'] as Record<string, () => Promise<unknown>>)?.resumeCandidates?.(),
      ]);

      if (taskRes.status === 'fulfilled' && taskRes.value) {
        const val = taskRes.value as { tasks?: Task[] };
        setTasks(Array.isArray(val.tasks) ? val.tasks : []);
      }

      if (approvalRes.status === 'fulfilled' && approvalRes.value) {
        const val = approvalRes.value as { requests?: ApprovalRequest[] };
        const raw = Array.isArray(val.requests) ? val.requests : [];
        setApprovals(raw.filter(a => a.status === 'pending'));
      }

      if (workerRunsRes.status === 'fulfilled' && workerRunsRes.value) {
        const val = workerRunsRes.value as { ok?: boolean; runs?: WorkerRunRecord[] };
        setWorkerRuns(Array.isArray(val.runs) ? val.runs.slice(0, 20) : []);
      }

      if (resumeRes.status === 'fulfilled' && resumeRes.value) {
        const val = resumeRes.value as { ok?: boolean; runs?: WorkerRunRecord[] };
        setResumeCandidates(Array.isArray(val.runs) ? val.runs : []);
      }
    } catch { /* ignore */ }
    setLoading(false);
  }, []);

  useEffect(() => {
    fetchData();
    const timer = setInterval(fetchData, 10_000);
    return () => clearInterval(timer);
  }, [fetchData]);

  const handleApprove = async (id: string) => {
    setActionBusy(id);
    setApprovals(prev => prev.filter(a => a.id !== id)); // optimistic
    try {
      const tf = getTf();
      await (tf?.['approvals'] as Record<string, (id: string) => Promise<unknown>>)?.approve?.(id);
    } catch {
      fetchData(); // restore on failure
    } finally {
      setActionBusy(null);
    }
  };

  const handleDeny = async (id: string) => {
    setActionBusy(id);
    setApprovals(prev => prev.filter(a => a.id !== id)); // optimistic
    try {
      const tf = getTf();
      await (tf?.['approvals'] as Record<string, (id: string, r: string) => Promise<unknown>>)?.deny?.(id, 'Denied from Sessions');
    } catch {
      fetchData();
    } finally {
      setActionBusy(null);
    }
  };

  const handleExpandRun = useCallback(async (runId: string) => {
    if (expandedRunId === runId) {
      setExpandedRunId(null);
      return;
    }
    setExpandedRunId(runId);
    // Fetch detail if not cached
    if (!runDetails[runId]) {
      try {
        const tf = getTf();
        const res = await (tf?.['workerRuntime'] as Record<string, (id: string) => Promise<unknown>>)
          ?.get?.(runId) as { ok?: boolean; run?: WorkerRunRecord; steps?: WorkerStepRecord[]; artifacts?: WorkerArtifactRecord[] } | undefined;
        if (res?.ok && res.run) {
          setRunDetails(prev => ({
            ...prev,
            [runId]: { run: res.run!, steps: res.steps ?? [], artifacts: res.artifacts ?? [] },
          }));
        }
      } catch { /* ignore */ }
    }
  }, [expandedRunId, runDetails]);

  const handleCancelRun = useCallback(async (runId: string) => {
    try {
      const tf = getTf();
      await (tf?.['workerRuntime'] as Record<string, (id: string) => Promise<unknown>>)?.cancel?.(runId);
      fetchData();
    } catch { /* ignore */ }
  }, [fetchData]);

  const handleResumeRun = useCallback(async (runId: string) => {
    setResumeBusy(runId);
    try {
      const tf = getTf();
      const res = await (tf?.['workerRuntime'] as Record<string, (id: string) => Promise<unknown>>)
        ?.resume?.(runId) as { ok: boolean; kind?: string; failReason?: string; message: string } | undefined;
      if (res) {
        setResumeMessages(prev => ({ ...prev, [runId]: { ok: res.ok, msg: res.message } }));
        if (res.ok) {
          // Refresh data after a short delay to allow bridge to finalize new run
          setTimeout(() => fetchData(), 500);
        }
      }
    } catch (e) {
      setResumeMessages(prev => ({
        ...prev,
        [runId]: { ok: false, msg: 'Recovery request failed. Please try again.' },
      }));
    } finally {
      setResumeBusy(null);
    }
  }, [fetchData]);

  // Task buckets — each status is covered exactly once
  const activeTasks  = tasks.filter(t => t.status === 'running' || t.status === 'planning');
  const waitingTasks = tasks.filter(t => t.status === 'awaiting_approval' || t.status === 'paused');
  const queuedTasks  = tasks.filter(t => t.status === 'queued');
  const completedCount = tasks.filter(t => t.status === 'completed').length;
  const recentTasks  = tasks
    .filter(t => t.status === 'completed' || t.status === 'failed' || t.status === 'cancelled')
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 10);

  // Worker run buckets
  const activeWorkerRuns = workerRuns.filter(r =>
    r.status === 'running' || r.status === 'planning' || r.status === 'ready',
  );
  const recentWorkerRuns = workerRuns
    .filter(r => r.status === 'completed' || r.status === 'failed' || r.status === 'cancelled')
    .slice(0, 8);

  return (
    <div style={styles.overview}>

      {/* Metrics row */}
      <div style={styles.metricsRow}>
        <MetricCard
          label="Active"
          value={loading ? '…' : String(activeTasks.length || '—')}
          valueColor={activeTasks.length > 0 ? '#10a37f' : 'var(--text-muted)'}
          icon="◉"
          sub={activeTasks.length > 0 ? `${activeTasks.length} task${activeTasks.length > 1 ? 's' : ''} running` : 'Nothing running'}
        />
        <MetricCard
          label="Needs Approval"
          value={loading ? '…' : String(approvals.length || '—')}
          valueColor={approvals.length > 0 ? '#ef4444' : 'var(--text-muted)'}
          icon="⊟"
          sub={approvals.length > 0 ? `${approvals.length} action${approvals.length > 1 ? 's' : ''} need review` : 'No actions pending'}
        />
        <MetricCard
          label="Queued"
          value={loading ? '…' : String(queuedTasks.length || '—')}
          valueColor={queuedTasks.length > 0 ? '#f59e0b' : 'var(--text-muted)'}
          icon="⊡"
          sub={queuedTasks.length > 0 ? `${queuedTasks.length} task${queuedTasks.length > 1 ? 's' : ''} queued` : 'Queue empty'}
        />
        <MetricCard
          label="Completed"
          value={loading ? '…' : String(completedCount || '—')}
          valueColor={completedCount > 0 ? 'var(--text-secondary)' : 'var(--text-muted)'}
          icon="✓"
          sub={completedCount > 0 ? `${completedCount} task${completedCount > 1 ? 's' : ''} done` : 'None yet'}
        />
      </div>

      {/* ── Needs Attention — interrupted / blocked WorkerRuns ─────────────── */}
      {resumeCandidates.length > 0 && (
        <div style={styles.panel}>
          <div style={{ ...styles.panelHeader, borderLeft: '3px solid #f59e0b' }}>
            <span style={{ ...styles.panelLabel, color: '#f59e0b' }}>Needs Attention</span>
            <span style={{ ...styles.panelBadge, background: '#f59e0b20', color: '#f59e0b' }}>
              {resumeCandidates.length} interrupted
            </span>
          </div>
          <div style={styles.panelBody}>
            {resumeCandidates.map(r => (
              <WorkerRunRow
                key={r.id}
                run={r}
                expanded={expandedRunId === r.id}
                detail={runDetails[r.id]}
                onExpand={() => handleExpandRun(r.id)}
                onCancel={() => handleCancelRun(r.id)}
                onResume={() => handleResumeRun(r.id)}
                resumeBusy={resumeBusy === r.id}
                resumeMessage={resumeMessages[r.id]}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Pending Approvals — highest priority ────────────────────────────── */}
      {approvals.length > 0 && (
        <div style={styles.panel}>
          <div style={{ ...styles.panelHeader, borderLeft: '3px solid #ef4444' }}>
            <span style={{ ...styles.panelLabel, color: '#ef4444' }}>Needs Approval</span>
            <span style={{ ...styles.panelBadge, background: '#ef444420', color: '#ef4444' }}>
              {approvals.length} paused
            </span>
          </div>
          <div style={styles.panelBody}>
            {approvals.map(a => {
              const relatedTask = tasks.find(t => t.id === a.taskId);
              return (
                <ApprovalRow
                  key={a.id}
                  approval={a}
                  taskGoal={relatedTask?.goal}
                  busy={actionBusy === a.id}
                  onApprove={() => handleApprove(a.id)}
                  onDeny={() => handleDeny(a.id)}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* ── Active tasks ────────────────────────────────────────────────────── */}
      {activeTasks.length > 0 && (
        <div style={styles.panel}>
          <div style={styles.panelHeader}>
            <span style={styles.panelLabel}>Active</span>
            <span style={styles.panelBadge}>{activeTasks.length} running</span>
          </div>
          <div style={styles.panelBody}>
            {activeTasks.map(t => <TaskRow key={t.id} task={t} />)}
          </div>
        </div>
      )}

      {/* ── Active WorkerRuns — workflow packs currently executing ──────────── */}
      {activeWorkerRuns.length > 0 && (
        <div style={styles.panel}>
          <div style={styles.panelHeader}>
            <span style={styles.panelLabel}>Running Workflows</span>
            <span style={styles.panelBadge}>{activeWorkerRuns.length} active</span>
          </div>
          <div style={styles.panelBody}>
            {activeWorkerRuns.map(r => (
              <WorkerRunRow
                key={r.id}
                run={r}
                expanded={expandedRunId === r.id}
                detail={runDetails[r.id]}
                onExpand={() => handleExpandRun(r.id)}
                onCancel={() => handleCancelRun(r.id)}
              />
            ))}
          </div>
        </div>
      )}

      {/* ── Waiting / paused tasks ──────────────────────────────────────────── */}
      {waitingTasks.length > 0 && (
        <div style={styles.panel}>
          <div style={styles.panelHeader}>
            <span style={styles.panelLabel}>Waiting</span>
            <span style={{ ...styles.panelBadge, background: '#f59e0b20', color: '#f59e0b' }}>
              {waitingTasks.length} paused
            </span>
          </div>
          <div style={styles.panelBody}>
            {waitingTasks.map(t => <TaskRow key={t.id} task={t} />)}
          </div>
        </div>
      )}

      {/* ── Queued tasks ────────────────────────────────────────────────────── */}
      {queuedTasks.length > 0 && (
        <div style={styles.panel}>
          <div style={styles.panelHeader}>
            <span style={styles.panelLabel}>Queued</span>
          </div>
          <div style={styles.panelBody}>
            {queuedTasks.map(t => <TaskRow key={t.id} task={t} />)}
          </div>
        </div>
      )}

      {/* ── Recent activity ─────────────────────────────────────────────────── */}
      <div style={styles.panel}>
        <div style={styles.panelHeader}>
          <span style={styles.panelLabel}>Recent</span>
        </div>
        <div style={styles.panelBody}>
          {loading && tasks.length === 0 ? (
            <div style={styles.emptyRow}>Loading…</div>
          ) : recentTasks.length === 0 ? (
            <div style={styles.emptyRow}>
              No recent activity. Assign work in Operate to see execution here.
            </div>
          ) : (
            recentTasks.map(t => <TaskRow key={t.id} task={t} />)
          )}
        </div>
      </div>

      {/* ── Workflow Run History — completed/failed/cancelled WorkerRuns ────── */}
      {recentWorkerRuns.length > 0 && (
        <div style={styles.panel}>
          <div style={styles.panelHeader}>
            <span style={styles.panelLabel}>Workflow Runs</span>
            <span style={styles.panelBadge}>{recentWorkerRuns.length} recent</span>
          </div>
          <div style={styles.panelBody}>
            {recentWorkerRuns.map(r => (
              <WorkerRunRow
                key={r.id}
                run={r}
                expanded={expandedRunId === r.id}
                detail={runDetails[r.id]}
                onExpand={() => handleExpandRun(r.id)}
                onCancel={() => handleCancelRun(r.id)}
              />
            ))}
          </div>
        </div>
      )}

    </div>
  );
}

// ── Approval Row ──────────────────────────────────────────────────────────────

function ApprovalRow({
  approval,
  taskGoal,
  busy,
  onApprove,
  onDeny,
}: {
  approval: ApprovalRequest;
  taskGoal?: string;
  busy: boolean;
  onApprove: () => void;
  onDeny: () => void;
}) {
  const preview = argsPreview(approval.args);
  return (
    <div style={styles.approvalRow}>
      <div style={styles.approvalMeta}>
        <span style={{
          ...styles.riskBadge,
          color: RISK_COLOR[approval.riskLevel],
          borderColor: RISK_COLOR[approval.riskLevel] + '44',
          background: RISK_COLOR[approval.riskLevel] + '14',
        }}>
          {capitalize(approval.riskLevel)}
        </span>
        <div style={styles.approvalDetail}>
          <span style={styles.approvalTool}>{toolLabel(approval.tool)}</span>
          {preview && <span style={styles.approvalArgs}>{preview}</span>}
          {taskGoal && <span style={styles.approvalContext}>← {taskGoal}</span>}
        </div>
        <div style={styles.approvalMeta2}>
          {approval.estimatedCostCents != null && (
            <span style={styles.approvalCost}>{formatCents(approval.estimatedCostCents)}</span>
          )}
          <span style={styles.approvalAge}>{relativeTime(approval.createdAt)}</span>
        </div>
      </div>
      <div style={styles.approvalActions}>
        <button style={{ ...styles.approveBtn, opacity: busy ? 0.6 : 1 }} onClick={onApprove} disabled={busy}>
          {busy ? '…' : 'Approve'}
        </button>
        <button style={{ ...styles.denyBtn, opacity: busy ? 0.6 : 1 }} onClick={onDeny} disabled={busy}>
          Deny
        </button>
      </div>
    </div>
  );
}

// ── Task Row ──────────────────────────────────────────────────────────────────

function TaskRow({ task }: { task: Task }) {
  const statusColor = STATUS_COLOR[task.status] ?? 'var(--text-muted)';
  const statusLabel = STATUS_LABEL[task.status] ?? task.status;

  // Step detail: show current step title for active tasks, error for failed
  const currentStep = (task.plan?.steps && task.currentStepIndex != null)
    ? task.plan.steps[task.currentStepIndex]
    : undefined;

  const stepDetail = (() => {
    if (task.status === 'failed' && task.error) {
      return task.error.slice(0, 80);
    }
    if ((task.status === 'running' || task.status === 'planning') && currentStep) {
      return `Step: ${currentStep.title}`;
    }
    if (task.status === 'awaiting_approval' && currentStep) {
      return `Waiting on: ${toolLabel(currentStep.tool)}`;
    }
    if (task.status === 'paused' && currentStep?.blockedReason) {
      return `Paused: ${currentStep.blockedReason.slice(0, 60)}`;
    }
    return null;
  })();

  // Step progress: show completed/total for tasks with a plan
  const stepProgress = (task.plan?.steps?.length && task.status !== 'queued')
    ? `${task.plan.steps.filter(st => st.status === 'completed').length}/${task.plan.steps.length} steps`
    : null;

  return (
    <div style={styles.taskRow}>
      <span style={{ ...styles.statusDotSmall, background: statusColor }} />
      <div style={styles.taskBody}>
        <div style={styles.taskGoalRow}>
          <span style={styles.taskGoal}>{task.goal}</span>
          <span style={styles.taskCategory}>{task.category}</span>
        </div>
        {stepDetail && <span style={styles.taskDetail}>{stepDetail}</span>}
      </div>
      <div style={styles.taskMeta}>
        {stepProgress && <span style={styles.taskProgress}>{stepProgress}</span>}
        <span style={{ ...styles.taskStatus, color: statusColor }}>{statusLabel}</span>
        <span style={styles.taskAge}>{relativeTime(task.updatedAt)}</span>
      </div>
    </div>
  );
}

// ── Worker Run Row ────────────────────────────────────────────────────────────

function WorkerRunRow({
  run,
  expanded,
  detail,
  onExpand,
  onCancel,
  onResume,
  resumeBusy,
  resumeMessage,
}: {
  run: WorkerRunRecord;
  expanded: boolean;
  detail?: WorkerRunDetail;
  onExpand: () => void;
  onCancel: () => void;
  onResume?: () => void;
  resumeBusy?: boolean;
  resumeMessage?: { ok: boolean; msg: string };
}) {
  const statusColor = WORKER_RUN_STATUS_COLOR[run.status] ?? 'var(--text-muted)';
  const statusText  = WORKER_RUN_STATUS_LABEL[run.status]  ?? capitalize(run.status);
  const blocker     = blockerLabel(run.blocker);
  const isActive    = run.status === 'running' || run.status === 'planning' || run.status === 'ready';
  const isTerminal  = run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled';

  // Show Recover button for blocked/failed runs that have pack metadata
  const canRecover  = !isTerminal && !!run.packId
    && (run.status === 'blocked' || run.status === 'failed');

  return (
    <>
      <div
        style={{
          ...styles.taskRow,
          cursor: 'pointer',
          background: expanded ? 'var(--bg-elevated)' : undefined,
        }}
        onClick={onExpand}
        role="button"
        tabIndex={0}
        onKeyDown={e => e.key === 'Enter' && onExpand()}
      >
        <span style={{ ...styles.statusDotSmall, background: statusColor }} />
        <div style={styles.taskBody}>
          <div style={styles.taskGoalRow}>
            <span style={styles.taskGoal}>{run.goal}</span>
            {run.packId && (
              <span style={{ ...styles.taskCategory, background: 'var(--bg-elevated)' }}>
                {packLabel(run.packId)}
              </span>
            )}
            <span style={{ ...styles.taskCategory, opacity: 0.7 }}>
              {sourceLabel(run.source)}
            </span>
          </div>
          {blocker && (
            <span style={{ ...styles.taskDetail, color: statusColor }}>
              {blocker}
            </span>
          )}
        </div>
        <div style={styles.taskMeta}>
          {run.artifacts.length > 0 && (
            <span style={styles.taskProgress}>{run.artifacts.length} artifact{run.artifacts.length !== 1 ? 's' : ''}</span>
          )}
          <span style={{ ...styles.taskStatus, color: statusColor }}>{statusText}</span>
          <span style={styles.taskAge}>{relativeTime(run.updatedAt)}</span>
          {canRecover && onResume && (
            <button
              style={{
                ...styles.recoverRunBtn,
                opacity: resumeBusy ? 0.6 : 1,
              }}
              onClick={e => { e.stopPropagation(); onResume(); }}
              disabled={resumeBusy}
              title="Restart this workflow from saved context"
            >
              {resumeBusy ? '…' : 'Recover'}
            </button>
          )}
          {!isTerminal && (
            <button
              style={styles.cancelRunBtn}
              onClick={e => { e.stopPropagation(); onCancel(); }}
              title="Cancel this run"
            >
              ✕
            </button>
          )}
          <span style={{ ...styles.taskAge, color: expanded ? 'var(--accent)' : 'var(--text-muted)' }}>
            {expanded ? '▲' : '▼'}
          </span>
        </div>
      </div>

      {/* Inline resume feedback message */}
      {resumeMessage && (
        <div style={{
          ...styles.resumeMessage,
          borderColor: resumeMessage.ok ? '#10a37f44' : '#f59e0b44',
          background:  resumeMessage.ok ? '#10a37f0a' : '#f59e0b0a',
          color:       resumeMessage.ok ? '#10a37f'   : '#f59e0b',
        }}>
          <span style={styles.resumeMessageIcon}>{resumeMessage.ok ? '✓' : '⚠'}</span>
          <span>{resumeMessage.msg}</span>
        </div>
      )}

      {expanded && (
        <WorkerRunDetail
          run={run}
          detail={detail}
          isActive={isActive}
          onResume={canRecover && onResume ? onResume : undefined}
          resumeBusy={resumeBusy}
        />
      )}
    </>
  );
}

// ── Worker Run Detail ─────────────────────────────────────────────────────────

function WorkerRunDetail({
  run,
  detail,
  isActive,
  onResume,
  resumeBusy,
}: {
  run: WorkerRunRecord;
  detail?: WorkerRunDetail;
  isActive: boolean;
  onResume?: () => void;
  resumeBusy?: boolean;
}) {
  const isRestartInterrupted = run.status === 'blocked'
    && run.blocker?.kind === 'tool_failed'
    && run.blocker.message?.toLowerCase().includes('restart');

  return (
    <div style={styles.runDetail}>
      {/* Summary row */}
      <div style={styles.runDetailSummary}>
        <div style={styles.runDetailField}>
          <span style={styles.runDetailLabel}>Status</span>
          <span style={{
            ...styles.runDetailValue,
            color: WORKER_RUN_STATUS_COLOR[run.status] ?? 'var(--text-secondary)',
            fontWeight: 600,
          }}>
            {WORKER_RUN_STATUS_LABEL[run.status] ?? capitalize(run.status)}
          </span>
        </div>
        {run.packId && (
          <div style={styles.runDetailField}>
            <span style={styles.runDetailLabel}>Pack</span>
            <span style={styles.runDetailValue}>{packLabel(run.packId)}</span>
          </div>
        )}
        <div style={styles.runDetailField}>
          <span style={styles.runDetailLabel}>Started</span>
          <span style={styles.runDetailValue}>{relativeTime(run.createdAt)}</span>
        </div>
        <div style={styles.runDetailField}>
          <span style={styles.runDetailLabel}>Source</span>
          <span style={styles.runDetailValue}>{sourceLabel(run.source)}</span>
        </div>
        {isActive && (
          <div style={styles.runDetailField}>
            <span style={styles.runDetailLabel}>Note</span>
            <span style={{ ...styles.runDetailValue, color: 'var(--text-secondary)', fontStyle: 'italic' }}>
              Execution does not auto-resume after restart. Use Recover to restart.
            </span>
          </div>
        )}
      </div>

      {/* Blocker */}
      {run.blocker && (
        <div style={styles.runBlocker}>
          <span style={styles.runBlockerIcon}>⚠</span>
          <div style={styles.runBlockerBody}>
            <span style={styles.runBlockerTitle}>{blockerLabel(run.blocker)}</span>
            {run.blocker.message && run.blocker.message !== blockerLabel(run.blocker) && (
              <span style={styles.runBlockerMsg}>{run.blocker.message}</span>
            )}
            {run.blocker.recoverable && (
              <span style={styles.runBlockerRecoverable}>
                {isRestartInterrupted
                  ? 'Interrupted by app restart — click Recover to restart this workflow from the beginning.'
                  : 'Recoverable — review and restart if needed.'}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Recovery action panel — only for blocked/failed runs with pack context */}
      {onResume && run.packId && (
        <div style={styles.runRecoveryPanel}>
          <div style={styles.runRecoveryBody}>
            <span style={styles.runRecoveryTitle}>
              {isRestartInterrupted ? 'Recovery available' : 'Restart available'}
            </span>
            <span style={styles.runRecoveryDesc}>
              {isRestartInterrupted
                ? `Recover will restart "${packLabel(run.packId)}" from the beginning using the original workflow context. This is a fresh run, not a continuation from the interruption point.`
                : `Recover will restart "${packLabel(run.packId)}" from the beginning. The same failure may recur if the underlying issue is not resolved.`}
            </span>
          </div>
          <button
            style={{ ...styles.recoverRunBtn, ...styles.recoverRunBtnLarge, opacity: resumeBusy ? 0.6 : 1 }}
            onClick={onResume}
            disabled={resumeBusy}
          >
            {resumeBusy ? 'Recovering…' : 'Recover run'}
          </button>
        </div>
      )}

      {/* Loading state */}
      {!detail && (
        <div style={styles.runDetailLoading}>Loading details…</div>
      )}

      {/* Steps */}
      {detail && detail.steps.length > 0 && (
        <div style={styles.runSection}>
          <div style={styles.runSectionHeader}>Steps</div>
          {detail.steps.map(step => (
            <div key={step.id} style={styles.runStep}>
              <span style={{
                ...styles.runStepDot,
                background: step.status === 'completed' ? '#10a37f'
                  : step.status === 'failed' ? '#ef4444'
                  : step.status === 'running' ? '#6366f1'
                  : 'var(--text-muted)',
              }} />
              <span style={styles.runStepTitle}>{step.title}</span>
              <span style={styles.runStepType}>{step.type}</span>
              <span style={{
                ...styles.runStepStatus,
                color: step.status === 'completed' ? '#10a37f'
                  : step.status === 'failed' ? '#ef4444'
                  : step.status === 'running' ? '#6366f1'
                  : 'var(--text-muted)',
              }}>
                {capitalize(step.status)}
              </span>
              {step.error && (
                <span style={styles.runStepError}>{step.error.slice(0, 80)}</span>
              )}
            </div>
          ))}
        </div>
      )}

      {/* Artifacts */}
      {detail && detail.artifacts.length > 0 && (
        <div style={styles.runSection}>
          <div style={styles.runSectionHeader}>Artifacts</div>
          {detail.artifacts.map(art => (
            <div key={art.id} style={styles.runArtifact}>
              <span style={styles.runArtifactKind}>{artifactKindLabel(art.kind)}</span>
              <span style={styles.runArtifactPath} title={art.path}>
                {art.path.split('/').pop() ?? art.path}
              </span>
              <span style={styles.runArtifactAge}>{relativeTime(art.createdAt)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Metric Card ───────────────────────────────────────────────────────────────

function MetricCard({
  label,
  value,
  valueColor,
  icon,
  sub,
}: {
  label: string;
  value: string;
  valueColor: string;
  icon: string;
  sub: string;
}) {
  return (
    <div style={styles.metricCard}>
      <div style={styles.metricTop}>
        <span style={styles.metricIcon}>{icon}</span>
        <span style={{ ...styles.metricValue, color: valueColor }}>{value}</span>
      </div>
      <div style={styles.metricLabel}>{label}</div>
      <div style={styles.metricSub}>{sub}</div>
    </div>
  );
}

// ── Tab Button ────────────────────────────────────────────────────────────────

function TabBtn({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      style={{ ...styles.tabBtn, ...(active ? styles.tabBtnActive : {}) }}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  page: {
    flex: 1,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  },
  header: {
    padding: '28px 28px 20px',
    borderBottom: '1px solid var(--border)',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    flexShrink: 0,
  },
  headerTop: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
  },
  title: {
    fontSize: 22,
    fontWeight: 700,
    color: 'var(--text-primary)',
    margin: 0,
    letterSpacing: '-0.01em',
  },
  statusPill: {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    borderRadius: 99,
    padding: '2px 10px',
  },
  statusDot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: '#10a37f',
    flexShrink: 0,
  },
  statusLabel: {
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--text-secondary)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
  },
  subtitle: {
    fontSize: 13,
    color: 'var(--text-secondary)',
    lineHeight: 1.6,
    margin: 0,
    maxWidth: 580,
  },
  subnav: {
    display: 'flex',
    gap: 2,
    padding: '10px 28px',
    borderBottom: '1px solid var(--border)',
    flexShrink: 0,
  },
  tabBtn: {
    background: 'none',
    border: 'none',
    borderRadius: 6,
    padding: '5px 12px',
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--text-muted)',
    cursor: 'pointer',
    letterSpacing: '0.02em',
  },
  tabBtnActive: {
    background: 'var(--accent-dim)',
    color: 'var(--accent)',
  },
  content: {
    flex: 1,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  },
  embeddedSurface: {
    flex: 1,
    overflow: 'hidden',
    display: 'flex',
    flexDirection: 'column',
  },
  historyFrame: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '10px 20px',
    borderBottom: '1px solid var(--border)',
    background: 'var(--bg-elevated)',
    flexShrink: 0,
  },
  historyFrameLabel: {
    fontSize: 11,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.07em',
    color: 'var(--text-muted)',
  },
  historyFrameDesc: {
    fontSize: 11,
    color: 'var(--text-muted)',
    opacity: 0.7,
  },

  // Overview layout
  overview: {
    flex: 1,
    overflowY: 'auto',
    padding: '20px 28px',
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  metricsRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 10,
  },
  metricCard: {
    background: 'var(--bg-surface)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    padding: '14px 14px 12px',
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
  },
  metricTop: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 3,
  },
  metricIcon: {
    fontSize: 14,
    color: 'var(--text-muted)',
  },
  metricValue: {
    fontSize: 22,
    fontWeight: 700,
    letterSpacing: '-0.02em',
  },
  metricLabel: {
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--text-primary)',
  },
  metricSub: {
    fontSize: 11,
    color: 'var(--text-muted)',
  },

  // Panels
  panel: {
    background: 'var(--bg-surface)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    overflow: 'hidden',
  },
  panelHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '9px 14px',
    borderBottom: '1px solid var(--border)',
    background: 'var(--bg-elevated)',
  },
  panelLabel: {
    fontSize: 11,
    fontWeight: 700,
    color: 'var(--text-muted)',
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    flex: 1,
  },
  panelBadge: {
    fontSize: 10,
    fontWeight: 700,
    padding: '2px 8px',
    borderRadius: 99,
    background: 'var(--bg-base)',
    color: 'var(--text-muted)',
    letterSpacing: '0.02em',
  },
  panelBody: {
    display: 'flex',
    flexDirection: 'column',
  },

  // Task row — two-line layout when step detail is present
  taskRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
    padding: '9px 14px',
    borderBottom: '1px solid var(--border)',
    minHeight: 38,
  },
  statusDotSmall: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    flexShrink: 0,
    marginTop: 4,
  },
  taskBody: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  taskGoalRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
  },
  taskGoal: {
    flex: 1,
    fontSize: 12,
    fontWeight: 500,
    color: 'var(--text-primary)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  taskCategory: {
    fontSize: 10,
    color: 'var(--text-muted)',
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    borderRadius: 4,
    padding: '1px 6px',
    flexShrink: 0,
    textTransform: 'lowercase',
  },
  taskDetail: {
    fontSize: 11,
    color: 'var(--text-secondary)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontStyle: 'italic',
  },
  taskMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  taskProgress: {
    fontSize: 10,
    color: 'var(--text-muted)',
    fontFamily: 'monospace',
  },
  taskStatus: {
    fontSize: 10,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    flexShrink: 0,
  },
  taskAge: {
    fontSize: 10,
    color: 'var(--text-muted)',
    flexShrink: 0,
  },

  // Approval row — two-line with context
  approvalRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 12,
    padding: '10px 14px',
    borderBottom: '1px solid var(--border)',
  },
  approvalMeta: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
    flex: 1,
    minWidth: 0,
  },
  approvalDetail: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  approvalTool: {
    fontSize: 12,
    color: 'var(--text-primary)',
    fontWeight: 600,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  approvalArgs: {
    fontSize: 11,
    color: 'var(--text-muted)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontFamily: 'monospace',
  },
  approvalContext: {
    fontSize: 11,
    color: 'var(--text-secondary)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
    fontStyle: 'italic',
  },
  approvalMeta2: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: 2,
    flexShrink: 0,
  },
  riskBadge: {
    fontSize: 10,
    fontWeight: 700,
    padding: '2px 7px',
    borderRadius: 4,
    border: '1px solid',
    textTransform: 'uppercase',
    letterSpacing: '0.05em',
    flexShrink: 0,
    alignSelf: 'flex-start',
    marginTop: 1,
  },
  approvalCost: {
    fontSize: 11,
    color: 'var(--text-muted)',
  },
  approvalAge: {
    fontSize: 10,
    color: 'var(--text-muted)',
  },
  approvalActions: {
    display: 'flex',
    gap: 6,
    flexShrink: 0,
    alignSelf: 'center',
  },
  approveBtn: {
    background: '#10a37f20',
    border: '1px solid #10a37f44',
    borderRadius: 5,
    color: '#10a37f',
    fontSize: 11,
    fontWeight: 600,
    padding: '4px 12px',
    cursor: 'pointer',
  },
  denyBtn: {
    background: 'none',
    border: '1px solid var(--border)',
    borderRadius: 5,
    color: 'var(--text-secondary)',
    fontSize: 11,
    fontWeight: 600,
    padding: '4px 12px',
    cursor: 'pointer',
  },

  // Empty state
  emptyRow: {
    padding: '20px 14px',
    fontSize: 12,
    color: 'var(--text-muted)',
    textAlign: 'center',
  },

  // ── Worker Run components ──────────────────────────────────────────────────
  recoverRunBtn: {
    background: '#10a37f18',
    border: '1px solid #10a37f44',
    borderRadius: 4,
    color: '#10a37f',
    fontSize: 10,
    fontWeight: 700,
    padding: '2px 10px',
    cursor: 'pointer',
    flexShrink: 0,
    letterSpacing: '0.02em',
  },
  recoverRunBtnLarge: {
    fontSize: 12,
    padding: '5px 16px',
    borderRadius: 5,
    flexShrink: 0,
  },
  resumeMessage: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 6,
    padding: '6px 14px',
    borderTop: '1px solid',
    fontSize: 11,
  },
  resumeMessageIcon: {
    flexShrink: 0,
    fontWeight: 700,
    marginTop: 1,
  },
  runRecoveryPanel: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    background: '#10a37f08',
    border: '1px solid #10a37f28',
    borderRadius: 6,
    padding: '8px 12px',
    marginBottom: 10,
  },
  runRecoveryBody: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 3,
  },
  runRecoveryTitle: {
    fontSize: 11,
    fontWeight: 700,
    color: '#10a37f',
  },
  runRecoveryDesc: {
    fontSize: 11,
    color: 'var(--text-secondary)',
    lineHeight: 1.4,
  },
  cancelRunBtn: {
    background: 'none',
    border: '1px solid var(--border)',
    borderRadius: 4,
    color: 'var(--text-secondary)',
    fontSize: 10,
    fontWeight: 600,
    padding: '2px 8px',
    cursor: 'pointer',
    flexShrink: 0,
  },
  runDetail: {
    borderTop: '1px solid var(--border)',
    background: 'var(--bg-secondary)',
    padding: '12px 14px 14px 14px',
  },
  runDetailSummary: {
    display: 'flex',
    gap: 20,
    flexWrap: 'wrap' as const,
    marginBottom: 10,
  },
  runDetailField: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 2,
  },
  runDetailLabel: {
    fontSize: 10,
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
    color: 'var(--text-muted)',
  },
  runDetailValue: {
    fontSize: 12,
    color: 'var(--text-primary)',
  },
  runBlocker: {
    display: 'flex',
    gap: 8,
    alignItems: 'flex-start',
    background: '#f5a62310',
    border: '1px solid #f5a62330',
    borderRadius: 6,
    padding: '8px 10px',
    marginBottom: 10,
  },
  runBlockerIcon: {
    fontSize: 14,
    flexShrink: 0,
    marginTop: 1,
  },
  runBlockerBody: {
    flex: 1,
    minWidth: 0,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 2,
  },
  runBlockerTitle: {
    fontSize: 11,
    fontWeight: 700,
    color: '#f5a623',
  },
  runBlockerMsg: {
    fontSize: 11,
    color: 'var(--text-secondary)',
  },
  runBlockerRecoverable: {
    fontSize: 10,
    color: 'var(--text-muted)',
    fontStyle: 'italic' as const,
  },
  runDetailLoading: {
    padding: '10px 0',
    fontSize: 11,
    color: 'var(--text-muted)',
  },
  runSection: {
    marginBottom: 8,
  },
  runSectionHeader: {
    fontSize: 10,
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
    color: 'var(--text-muted)',
    marginBottom: 4,
  },
  runStep: {
    display: 'flex',
    alignItems: 'baseline',
    gap: 6,
    padding: '3px 0',
    borderBottom: '1px solid var(--border)',
  },
  runStepDot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    flexShrink: 0,
    marginTop: 4,
  },
  runStepTitle: {
    fontSize: 12,
    color: 'var(--text-primary)',
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  runStepType: {
    fontSize: 10,
    color: 'var(--text-muted)',
    flexShrink: 0,
  },
  runStepStatus: {
    fontSize: 10,
    fontWeight: 600,
    flexShrink: 0,
  },
  runStepError: {
    fontSize: 10,
    color: '#ff6b6b',
    marginLeft: 12,
    marginTop: 1,
    fontFamily: 'monospace',
  },
  runArtifact: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    padding: '3px 0',
    borderBottom: '1px solid var(--border)',
  },
  runArtifactKind: {
    fontSize: 10,
    fontWeight: 600,
    color: 'var(--text-muted)',
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    flexShrink: 0,
    width: 60,
  },
  runArtifactPath: {
    fontSize: 11,
    color: 'var(--text-secondary)',
    flex: 1,
    minWidth: 0,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
    fontFamily: 'monospace',
  },
  runArtifactAge: {
    fontSize: 10,
    color: 'var(--text-muted)',
    flexShrink: 0,
  },
};
