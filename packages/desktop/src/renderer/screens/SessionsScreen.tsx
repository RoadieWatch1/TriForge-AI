import React, { useState, useEffect, useCallback } from 'react';
import { MissionControl } from '../components/MissionControl';
import { AgentHQ } from '../components/AgentHQ';

// ── Types ─────────────────────────────────────────────────────────────────────

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

type SessionsView = 'overview' | 'queue' | 'history';

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
        <TabBtn active={view === 'queue'}    onClick={() => setView('queue')}>Task Queue</TabBtn>
        <TabBtn active={view === 'history'}  onClick={() => setView('history')}>History</TabBtn>
      </div>

      {/* Content */}
      <div style={styles.content}>
        {view === 'overview' && <SessionsOverview />}
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
  const [tasks, setTasks]         = useState<Task[]>([]);
  const [approvals, setApprovals] = useState<ApprovalRequest[]>([]);
  const [loading, setLoading]     = useState(true);
  const [actionBusy, setActionBusy] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    try {
      const tf = (window as unknown as { triforge?: Record<string, unknown> }).triforge;
      if (!tf) { setLoading(false); return; }

      const [taskRes, approvalRes] = await Promise.allSettled([
        (tf['taskEngine'] as Record<string, () => Promise<unknown>>)?.listTasks?.(),
        (tf['approvals']  as Record<string, () => Promise<unknown>>)?.list?.(),
      ]);

      // listTasks returns { tasks?: Task[] } — not a bare array
      if (taskRes.status === 'fulfilled' && taskRes.value) {
        const val = taskRes.value as { tasks?: Task[] };
        setTasks(Array.isArray(val.tasks) ? val.tasks : []);
      }

      // approvals.list returns { requests?: ApprovalRequest[] } — not a bare array
      if (approvalRes.status === 'fulfilled' && approvalRes.value) {
        const val = approvalRes.value as { requests?: ApprovalRequest[] };
        const raw = Array.isArray(val.requests) ? val.requests : [];
        setApprovals(raw.filter(a => a.status === 'pending'));
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
      const tf = (window as unknown as { triforge?: Record<string, unknown> }).triforge;
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
      const tf = (window as unknown as { triforge?: Record<string, unknown> }).triforge;
      await (tf?.['approvals'] as Record<string, (id: string, r: string) => Promise<unknown>>)?.deny?.(id, 'Denied from Sessions');
    } catch {
      fetchData();
    } finally {
      setActionBusy(null);
    }
  };

  // Task buckets — each status is covered exactly once
  const activeTasks  = tasks.filter(t => t.status === 'running' || t.status === 'planning');
  const waitingTasks = tasks.filter(t => t.status === 'awaiting_approval' || t.status === 'paused');
  const queuedTasks  = tasks.filter(t => t.status === 'queued');
  const completedCount = tasks.filter(t => t.status === 'completed').length;
  const recentTasks  = tasks
    .filter(t => t.status === 'completed' || t.status === 'failed' || t.status === 'cancelled')
    .sort((a, b) => b.updatedAt - a.updatedAt)
    .slice(0, 10);

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
};
