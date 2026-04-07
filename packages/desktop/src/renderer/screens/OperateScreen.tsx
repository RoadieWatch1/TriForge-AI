import React, { useState, useEffect, useCallback } from 'react';
import type { Permission } from '../../main/store';

// ── Props ─────────────────────────────────────────────────────────────────────

interface OperateScreenProps {
  onNavigate: (screen: string) => void;
  onViewSessions: () => void;
  tier: string;
  permissions: Permission[];
  keyStatus: Record<string, boolean>;
}

// ── Types ─────────────────────────────────────────────────────────────────────

interface EngineHealth {
  runningTasks: number;
  queuedTasks: number;
  pendingApprovals: number;
}

interface SensorInfo {
  name: string;
  running: boolean;
  permissionKey: string;
}

interface ActiveTask {
  id: string;
  goal: string;
  status: 'queued' | 'planning' | 'running' | 'paused' | 'awaiting_approval';
}

interface ApprovalItem {
  id: string;
  taskId: string;
  tool: string;
  riskLevel: 'low' | 'medium' | 'high';
  createdAt: number;
  status: 'pending' | 'approved' | 'denied' | 'expired';
}

type WorkCategory = 'general' | 'file' | 'command' | 'research';

// ── Workflow pack UI types ─────────────────────────────────────────────────────

interface WorkflowPackSummary {
  id: string;
  name: string;
  tagline: string;
  category: string;
  requirements: {
    platforms: string[];
    permissions: { accessibility?: boolean; screenRecording?: boolean };
  };
  estimatedDurationSec?: number;
}

interface PackReadiness {
  ready: boolean;
  blockers: Array<{ type: string; message: string; remediation: string }>;
  warnings: string[];
}

/** Run info tracked client-side for the approval/advance flow. */
interface WorkflowRunInfo {
  runId: string;
  packId: string;
  status: string;
  pendingApprovalId?: string;
}

/** Operator approval detail fetched from operator:approval:list. */
interface OperatorApprovalInfo {
  id: string;
  sessionId: string;
  risk: string;
  description: string;
  contextScreenshotPath?: string;
  createdAt: number;
  expiresAt: number;
  status: string;
}

const WORKFLOW_CATEGORY_COLOR: Record<string, string> = {
  perception:  '#6366f1',
  input:       '#f59e0b',
  diagnostic:  '#10a37f',
  handoff:     '#8b5cf6',
};

const CATEGORY_LABELS: Record<WorkCategory, string> = {
  general:  'General',
  file:     'File Work',
  command:  'Command',
  research: 'Research',
};

const CATEGORY_DETAILS: Record<WorkCategory, { description: string; requiredPerm?: string }> = {
  general:  { description: 'Multi-step reasoning, research, and decision-making tasks' },
  file:     { description: 'Read, process, or transform files on disk', requiredPerm: 'files' },
  command:  { description: 'Execute shell commands or scripts', requiredPerm: 'terminal' },
  research: { description: 'Web research and information synthesis', requiredPerm: 'browser' },
};

// Permissions that directly unlock machine work capability
const ACTION_PERM_KEYS = ['files', 'terminal', 'browser'];

const SENSOR_LABELS: Record<string, string> = {
  fileWatcher:      'File Watcher',
  clipboardMonitor: 'Clipboard',
  diskMonitor:      'Disk',
  networkMonitor:   'Network',
  processMonitor:   'Processes',
  webMonitor:       'Web',
  eventLogMonitor:  'Event Log',
  serviceMonitor:   'Services',
};

const RISK_COLOR: Record<string, string> = {
  high:   '#ef4444',
  medium: '#f59e0b',
  low:    '#10a37f',
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

// ── Component ─────────────────────────────────────────────────────────────────

export function OperateScreen({
  onNavigate,
  onViewSessions,
  tier,
  permissions,
  keyStatus,
}: OperateScreenProps) {
  const [health, setHealth]           = useState<EngineHealth | null>(null);
  const [sensors, setSensors]         = useState<SensorInfo[]>([]);
  const [activeTasks, setActiveTasks] = useState<ActiveTask[]>([]);
  const [approvals, setApprovals]     = useState<ApprovalItem[]>([]);
  const [loading, setLoading]         = useState(true);
  const [approvingId, setApprovingId] = useState<string | null>(null);

  // Work assignment
  const [goal, setGoal]               = useState('');
  const [category, setCategory]       = useState<WorkCategory>('general');
  const [assigning, setAssigning]     = useState(false);
  const [assignResult, setAssignResult] = useState<{ taskId?: string; error?: string } | null>(null);

  // Workflow packs
  const [workflowPacks, setWorkflowPacks]         = useState<WorkflowPackSummary[]>([]);
  const [packReadiness, setPackReadiness]          = useState<Record<string, PackReadiness>>({});
  const [startingPackId, setStartingPackId]        = useState<string | null>(null);
  const [workflowResult, setWorkflowResult]        = useState<Record<string, { ok: boolean; status?: string; error?: string }>>({});
  // Approval/resume tracking — keyed by packId
  const [pendingRuns, setPendingRuns]              = useState<Record<string, WorkflowRunInfo>>({});
  const [operatorApprovals, setOperatorApprovals]  = useState<Record<string, OperatorApprovalInfo>>({});
  const [advancingPackId, setAdvancingPackId]      = useState<string | null>(null);

  const tf = (window as unknown as { triforge?: Record<string, unknown> }).triforge;

  const fetchData = useCallback(async () => {
    if (!tf) { setLoading(false); return; }

    const [healthRes, sensorRes, tasksRes, approvalsRes] = await Promise.allSettled([
      (tf['agentEngine'] as Record<string, () => Promise<unknown>>)?.getHealth?.(),
      (tf['sensors']     as Record<string, () => Promise<unknown>>)?.list?.(),
      (tf['taskEngine']  as Record<string, () => Promise<unknown>>)?.listTasks?.(),
      (tf['approvals']   as Record<string, () => Promise<unknown>>)?.list?.(),
    ]);

    if (healthRes.status === 'fulfilled' && healthRes.value) {
      setHealth(healthRes.value as EngineHealth);
    }
    if (sensorRes.status === 'fulfilled' && Array.isArray(sensorRes.value)) {
      setSensors(sensorRes.value as SensorInfo[]);
    }
    if (tasksRes.status === 'fulfilled') {
      const val = tasksRes.value as { tasks?: ActiveTask[] } | ActiveTask[] | null;
      const raw: ActiveTask[] = Array.isArray(val) ? val : ((val as { tasks?: ActiveTask[] })?.tasks ?? []);
      setActiveTasks(
        raw.filter(t =>
          t.status === 'running' || t.status === 'planning' ||
          t.status === 'queued'  || t.status === 'paused'   ||
          t.status === 'awaiting_approval'
        )
      );
    }
    if (approvalsRes.status === 'fulfilled') {
      const val = approvalsRes.value as { requests?: unknown[] } | null;
      const raw = (val as { requests?: unknown[] })?.requests ?? [];
      setApprovals(
        (raw as ApprovalItem[]).filter(a => a.status === 'pending')
      );
    }

    // Workflow packs (best-effort — don't fail the whole fetch)
    try {
      const packsRes = await (tf['workflows'] as Record<string, () => Promise<unknown>>)?.list?.();
      const allReadinessRes = await (tf['workflows'] as Record<string, () => Promise<unknown>>)?.readinessAll?.();
      if (packsRes && typeof packsRes === 'object' && (packsRes as Record<string, unknown>)['ok']) {
        const ps = (packsRes as { packs?: WorkflowPackSummary[] }).packs ?? [];
        setWorkflowPacks(ps);
      }
      if (allReadinessRes && typeof allReadinessRes === 'object' && (allReadinessRes as Record<string, unknown>)['ok']) {
        setPackReadiness((allReadinessRes as { results?: Record<string, PackReadiness> }).results ?? {});
      }
    } catch { /* ignore — workflow packs are additive */ }

    // Refresh operator approvals so expiry info stays current
    try {
      const opsRes = await (tf['operator'] as Record<string, () => Promise<unknown>>)?.listApprovals?.();
      const opsVal = opsRes as { ok: boolean; approvals?: OperatorApprovalInfo[] } | null;
      if (opsVal?.ok && opsVal.approvals) {
        setOperatorApprovals(() => {
          const byId: Record<string, OperatorApprovalInfo> = {};
          for (const a of opsVal.approvals!) byId[a.id] = a;
          return byId;
        });
      }
    } catch { /* best effort */ }

    setLoading(false);
  }, [tf]);

  useEffect(() => {
    fetchData();
    const timer = setInterval(fetchData, 15_000);
    return () => clearInterval(timer);
  }, [fetchData]);

  const assignWork = async () => {
    if (!goal.trim() || !tf) return;
    setAssigning(true);
    setAssignResult(null);
    try {
      const createRes = await (tf['taskEngine'] as Record<string, (g: string, c: string) => Promise<{ task?: { id?: string }; error?: string }>>)
        ?.createTask?.(goal.trim(), category);

      if (createRes?.error) {
        setAssignResult({ error: createRes.error });
        return;
      }

      const taskId = (createRes?.task as { id?: string } | undefined)?.id;
      if (!taskId) { setAssignResult({ error: 'Task created but no ID returned.' }); return; }

      await (tf['taskEngine'] as Record<string, (id: string) => Promise<unknown>>)?.runTask?.(taskId);
      setAssignResult({ taskId });
      setGoal('');
      fetchData();
    } catch (e) {
      setAssignResult({ error: e instanceof Error ? e.message : 'Assignment failed.' });
    } finally {
      setAssigning(false);
    }
  };

  const handleApprove = async (approvalId: string) => {
    if (!tf) return;
    setApprovingId(approvalId);
    try {
      await (tf['approvals'] as Record<string, (id: string) => Promise<unknown>>)?.approve?.(approvalId);
      setApprovals(prev => prev.filter(a => a.id !== approvalId));
      fetchData();
    } catch { /* ignore */ } finally {
      setApprovingId(null);
    }
  };

  const handleDeny = async (approvalId: string) => {
    if (!tf) return;
    setApprovingId(approvalId);
    try {
      await (tf['approvals'] as Record<string, (id: string, reason?: string) => Promise<unknown>>)?.deny?.(approvalId);
      setApprovals(prev => prev.filter(a => a.id !== approvalId));
      fetchData();
    } catch { /* ignore */ } finally {
      setApprovingId(null);
    }
  };

  /** Fetch and cache operator approval details for a given approvalId. */
  const fetchOperatorApproval = useCallback(async (approvalId: string) => {
    if (!tf) return;
    try {
      const res = await (tf['operator'] as Record<string, () => Promise<unknown>>)?.listApprovals?.();
      const val = res as { ok: boolean; approvals?: OperatorApprovalInfo[] } | null;
      if (val?.ok && val.approvals) {
        const found = val.approvals.find(a => a.id === approvalId);
        if (found) setOperatorApprovals(prev => ({ ...prev, [approvalId]: found }));
      }
    } catch { /* best effort */ }
  }, [tf]);

  const startWorkflow = async (packId: string, targetApp?: string) => {
    if (!tf || startingPackId) return;
    setStartingPackId(packId);
    setWorkflowResult(prev => ({ ...prev, [packId]: { ok: false } }));
    // Clear any prior pending run for this pack
    setPendingRuns(prev => { const n = { ...prev }; delete n[packId]; return n; });
    try {
      const res = await (tf['workflows'] as Record<string, (id: string, opts?: Record<string, unknown>) => Promise<{
        ok: boolean;
        run?: { id: string; status: string; pendingApprovalId?: string };
        readinessBlockers?: Array<{ message: string }>;
        error?: string;
      }>>)?.startRun?.(packId, targetApp ? { targetApp } : {});
      if (!res) return;
      if (res.ok && res.run) {
        setWorkflowResult(prev => ({ ...prev, [packId]: { ok: true, status: res.run!.status } }));
        if (res.run.status === 'awaiting_approval' && res.run.pendingApprovalId) {
          setPendingRuns(prev => ({
            ...prev,
            [packId]: { runId: res.run!.id, packId, status: res.run!.status, pendingApprovalId: res.run!.pendingApprovalId },
          }));
          // Eagerly fetch approval details so the panel renders immediately
          await fetchOperatorApproval(res.run.pendingApprovalId);
        }
        fetchData();
      } else if (res.readinessBlockers?.length) {
        setWorkflowResult(prev => ({ ...prev, [packId]: { ok: false, error: res.readinessBlockers![0]?.message ?? 'Not ready' } }));
      } else {
        setWorkflowResult(prev => ({ ...prev, [packId]: { ok: false, error: res.error ?? 'Failed to start' } }));
      }
    } catch (e) {
      setWorkflowResult(prev => ({ ...prev, [packId]: { ok: false, error: e instanceof Error ? e.message : 'Failed' } }));
    } finally {
      setStartingPackId(null);
    }
  };

  /** Approve the operator action and advance the workflow run. */
  const handleWorkflowApprove = async (packId: string, runId: string, approvalId: string) => {
    if (!tf || advancingPackId) return;
    setAdvancingPackId(packId);
    try {
      // 1. Execute the approved operator action
      const approveRes = await (tf['operator'] as Record<string, (id: string) => Promise<{ ok: boolean; error?: string }>>)
        ?.approveAction?.(approvalId);
      if (!approveRes?.ok) {
        setWorkflowResult(prev => ({ ...prev, [packId]: { ok: false, error: approveRes?.error ?? 'Approval execution failed' } }));
        setPendingRuns(prev => { const n = { ...prev }; delete n[packId]; return n; });
        return;
      }
      // 2. Advance the workflow from the next phase (execute_approved)
      const advanceRes = await (tf['workflows'] as Record<string, (id: string) => Promise<{
        ok: boolean;
        run?: Record<string, unknown>;
        error?: string;
      }>>)?.advanceRun?.(runId);
      if (advanceRes?.ok && advanceRes.run) {
        const newStatus = advanceRes.run['status'] as string;
        setWorkflowResult(prev => ({ ...prev, [packId]: { ok: true, status: newStatus } }));
        const newApprovalId = advanceRes.run['pendingApprovalId'] as string | undefined;
        if (newStatus === 'awaiting_approval' && newApprovalId) {
          // Another approval gate — update run info and re-fetch approval details
          setPendingRuns(prev => ({
            ...prev,
            [packId]: { runId, packId, status: newStatus, pendingApprovalId: newApprovalId },
          }));
          await fetchOperatorApproval(newApprovalId);
        } else {
          // Run completed, failed, or stopped — clear pending run
          setPendingRuns(prev => { const n = { ...prev }; delete n[packId]; return n; });
        }
      } else {
        setWorkflowResult(prev => ({ ...prev, [packId]: { ok: false, error: advanceRes?.error ?? 'Failed to resume workflow' } }));
        setPendingRuns(prev => { const n = { ...prev }; delete n[packId]; return n; });
      }
    } catch (e) {
      setWorkflowResult(prev => ({ ...prev, [packId]: { ok: false, error: e instanceof Error ? e.message : 'Approval failed' } }));
    } finally {
      setAdvancingPackId(null);
      fetchData();
    }
  };

  /** Deny the operator action — workflow stops cleanly. */
  const handleWorkflowDeny = async (packId: string, approvalId: string) => {
    if (!tf || advancingPackId) return;
    setAdvancingPackId(packId);
    try {
      await (tf['operator'] as Record<string, (id: string, reason?: string) => Promise<unknown>>)
        ?.denyAction?.(approvalId, 'Denied by user');
      setWorkflowResult(prev => ({ ...prev, [packId]: { ok: false, error: 'Workflow stopped — approval denied' } }));
      setPendingRuns(prev => { const n = { ...prev }; delete n[packId]; return n; });
    } catch {
      setWorkflowResult(prev => ({ ...prev, [packId]: { ok: false, error: 'Failed to deny — please try again' } }));
    } finally {
      setAdvancingPackId(null);
      fetchData();
    }
  };

  // Derived readiness state
  const connectedProviders    = Object.values(keyStatus).filter(Boolean).length;
  const grantedCount          = permissions.filter(p => p.granted).length;
  const blockedActionPerms    = ACTION_PERM_KEYS.filter(k => !permissions.find(p => p.key === k)?.granted);
  const runningSensors        = sensors.filter(s => s.running);
  const canAssignWork         = tier === 'business';
  const categoryDetail        = CATEGORY_DETAILS[category];
  const categoryPermBlocked   = !!categoryDetail.requiredPerm &&
    !permissions.find(p => p.key === categoryDetail.requiredPerm)?.granted;

  const pendingApprovals = health?.pendingApprovals ?? approvals.length;
  const runningTasks     = health?.runningTasks     ?? 0;
  const queuedTasks      = health?.queuedTasks      ?? 0;
  const hasActiveWork    = runningTasks > 0 || queuedTasks > 0 || pendingApprovals > 0;

  return (
    <div style={s.page}>

      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <div style={s.header}>
        <div>
          <h1 style={s.title}>Operate</h1>
          <p style={s.subtitle}>
            Review readiness, assign autonomous work, and track execution in Sessions.
          </p>
        </div>
        {hasActiveWork && (
          <button style={s.sessionsHotlink} onClick={onViewSessions}>
            {pendingApprovals > 0
              ? `${pendingApprovals} approval${pendingApprovals > 1 ? 's' : ''} pending`
              : runningTasks > 0
              ? `${runningTasks} task${runningTasks > 1 ? 's' : ''} running`
              : `${queuedTasks} queued`
            }
            &nbsp;— Sessions →
          </button>
        )}
      </div>

      {/* ── Supervision Notice ─────────────────────────────────────────────── */}
      <div style={s.supervisionBar}>
        <span style={s.supervisionDot} />
        <span style={s.supervisionText}>
          Work is supervised. TriForge pauses for your approval before sensitive or destructive actions — nothing runs silently.
        </span>
      </div>

      {/* ── Pending Approvals ──────────────────────────────────────────────── */}
      {approvals.length > 0 && (
        <div style={s.section}>
          <div style={s.sectionLabelRow}>
            <span style={{ ...s.sectionLabel, color: '#ef4444' }}>
              Approvals Waiting — {approvals.length} action{approvals.length > 1 ? 's' : ''} paused
            </span>
            <button style={s.sectionAction} onClick={onViewSessions}>
              Review all in Sessions →
            </button>
          </div>
          <div style={s.approvalList}>
            {approvals.slice(0, 3).map(req => (
              <ApprovalRow
                key={req.id}
                req={req}
                busy={approvingId === req.id}
                onApprove={() => handleApprove(req.id)}
                onDeny={() => handleDeny(req.id)}
              />
            ))}
            {approvals.length > 3 && (
              <div style={s.approvalMore}>
                +{approvals.length - 3} more —{' '}
                <button style={s.inlineLink} onClick={onViewSessions}>see all in Sessions</button>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ── Readiness ──────────────────────────────────────────────────────── */}
      <div style={s.section}>
        <div style={s.sectionLabel}>Readiness</div>
        <div style={s.readinessRow}>

          <ReadinessCard
            label="AI Providers"
            value={`${connectedProviders} / 3`}
            ok={connectedProviders > 0}
            detail={connectedProviders === 0 ? 'No providers — go to Settings' : connectedProviders < 3 ? 'Add more for Think Tank' : 'All connected'}
            action={connectedProviders < 3 ? () => onNavigate('settings') : undefined}
            actionLabel="Add key →"
          />

          <ReadinessCard
            label="Permissions"
            value={`${grantedCount} / ${permissions.length}`}
            ok={blockedActionPerms.length === 0}
            detail={
              blockedActionPerms.length === 0
                ? 'Action permissions granted'
                : `${blockedActionPerms.join(', ')} not granted`
            }
            action={blockedActionPerms.length > 0 ? () => onNavigate('settings') : undefined}
            actionLabel="Review →"
          />

          <ReadinessCard
            label="Execution Status"
            value={loading ? '…' : runningTasks > 0 ? 'Active' : 'Idle'}
            ok={connectedProviders > 0}
            detail={
              loading ? 'Loading…'
              : runningTasks > 0 ? `${runningTasks} task${runningTasks > 1 ? 's' : ''} running`
              : queuedTasks > 0  ? `${queuedTasks} queued`
              : 'Ready for work'
            }
          />

          <ReadinessCard
            label="Autonomous Work"
            value={canAssignWork ? 'Enabled' : 'Locked'}
            ok={canAssignWork}
            detail={
              canAssignWork
                ? 'Supervised task execution with approval gates'
                : 'Requires Business tier — upgrade in Settings'
            }
            action={!canAssignWork ? () => onNavigate('settings') : undefined}
            actionLabel="Upgrade →"
          />

        </div>
      </div>

      {/* ── Assign Work ────────────────────────────────────────────────────── */}
      <div style={s.section}>
        <div style={s.sectionLabel}>Assign Work</div>
        <div style={s.workIntake}>
          <textarea
            style={s.goalInput}
            placeholder="Describe the work — research, process a file, run a command, or complete a multi-step task…"
            value={goal}
            onChange={e => { setGoal(e.target.value); setAssignResult(null); }}
            rows={3}
            disabled={!canAssignWork}
          />
          <div style={s.workIntakeRow}>
            <div style={s.categoryCol}>
              <div style={s.categoryRow}>
                {(Object.keys(CATEGORY_LABELS) as WorkCategory[]).map(c => (
                  <button
                    key={c}
                    style={{ ...s.categoryBtn, ...(category === c ? s.categoryBtnActive : {}) }}
                    onClick={() => { setCategory(c); setAssignResult(null); }}
                    disabled={!canAssignWork}
                  >
                    {CATEGORY_LABELS[c]}
                  </button>
                ))}
              </div>
              <div style={s.categoryHint}>
                {categoryDetail.description}
                {categoryPermBlocked && (
                  <span style={s.categoryPermWarn}>
                    {' '}— {categoryDetail.requiredPerm} permission not granted
                  </span>
                )}
              </div>
            </div>
            <button
              style={{
                ...s.assignBtn,
                ...(!goal.trim() || assigning || !canAssignWork ? s.assignBtnDisabled : {}),
              }}
              onClick={assignWork}
              disabled={!goal.trim() || assigning || !canAssignWork}
            >
              {assigning ? 'Starting…' : 'Start Work'}
            </button>
          </div>

          {!canAssignWork && (
            <div style={s.tierGate}>
              Autonomous task assignment requires Business tier.{' '}
              <button style={s.inlineLink} onClick={() => onNavigate('settings')}>
                Upgrade in Settings →
              </button>
            </div>
          )}

          {connectedProviders === 0 && canAssignWork && (
            <div style={s.assignWarning}>
              No AI providers connected — add API keys in{' '}
              <button style={s.inlineLink} onClick={() => onNavigate('settings')}>Settings</button>{' '}
              before assigning work.
            </div>
          )}

          {assignResult?.error && (
            <div style={s.assignError}>
              Could not start: {assignResult.error}
            </div>
          )}

          {assignResult?.taskId && (
            <div style={s.assignSuccess}>
              <div style={s.assignSuccessTitle}>Work assigned and running.</div>
              <div style={s.assignSuccessBody}>
                TriForge will pause for your approval before sensitive actions. Track progress, review steps, and handle approvals in{' '}
                <button style={s.inlineLink} onClick={onViewSessions}>
                  Sessions →
                </button>
              </div>
            </div>
          )}
        </div>

        <p style={s.workHandoffHint}>
          After assignment, work moves to{' '}
          <button style={s.inlineLink} onClick={onViewSessions}>Sessions</button>{' '}
          where you can track steps, review actions, and respond to approval requests.
        </p>
      </div>

      {/* ── Workflow Packs ─────────────────────────────────────────────────── */}
      {workflowPacks.length > 0 && (
        <div style={s.section}>
          <div style={s.sectionLabelRow}>
            <span style={s.sectionLabel}>Workflow Packs</span>
            <span style={s.sectionMeta}>Structured supervised workflows</span>
          </div>
          <div style={s.workflowGrid}>
            {workflowPacks.map(pack => {
              const run = pendingRuns[pack.id] ?? null;
              const approval = run?.pendingApprovalId ? (operatorApprovals[run.pendingApprovalId] ?? null) : null;
              return (
                <WorkflowPackCard
                  key={pack.id}
                  pack={pack}
                  readiness={packReadiness[pack.id] ?? null}
                  starting={startingPackId === pack.id}
                  result={workflowResult[pack.id] ?? null}
                  pendingRun={run}
                  pendingApproval={approval}
                  advancing={advancingPackId === pack.id}
                  onStart={(targetApp) => startWorkflow(pack.id, targetApp)}
                  onApprove={(runId, approvalId) => handleWorkflowApprove(pack.id, runId, approvalId)}
                  onDeny={(approvalId) => handleWorkflowDeny(pack.id, approvalId)}
                />
              );
            })}
          </div>
        </div>
      )}

      {/* ── Active Work ────────────────────────────────────────────────────── */}
      {activeTasks.length > 0 && (
        <div style={s.section}>
          <div style={s.sectionLabelRow}>
            <span style={s.sectionLabel}>Active Work</span>
            <button style={s.sectionAction} onClick={onViewSessions}>
              View all in Sessions →
            </button>
          </div>
          <div style={s.taskList}>
            {activeTasks.slice(0, 5).map(task => (
              <ActiveTaskRow key={task.id} task={task} onViewSessions={onViewSessions} />
            ))}
            {activeTasks.length > 5 && (
              <div style={s.taskMore}>+{activeTasks.length - 5} more</div>
            )}
          </div>
        </div>
      )}

      {/* ── Environment ────────────────────────────────────────────────────── */}
      <div style={s.section}>
        <div style={s.sectionLabelRow}>
          <span style={s.sectionLabel}>Environment</span>
          {runningSensors.length > 0 && (
            <span style={s.sectionMeta}>{runningSensors.length} sensor{runningSensors.length > 1 ? 's' : ''} active</span>
          )}
        </div>
        <EnvironmentPanel
          sensors={sensors}
          permissions={permissions}
          loading={loading}
        />
      </div>

      {/* ── Utilities — demoted, not the main identity of Operate ────────── */}
      <div style={s.utilities}>
        <span style={s.utilitiesLabel}>Quick Access</span>
        <button style={s.utilBtn} onClick={() => onNavigate('forge')}>
          Direct Command
        </button>
        <button style={s.utilBtn} onClick={() => onNavigate('files')}>
          File Work
        </button>
        <button style={s.utilBtn} onClick={() => onNavigate('inbox')}>
          Work Queue
        </button>
        <button style={s.utilBtn} onClick={() => onNavigate('automation')}>
          Automation
        </button>
        <button style={s.utilBtn} onClick={() => onNavigate('builder')}>
          App Builder
        </button>
      </div>

    </div>
  );
}

// ── Approval Row ──────────────────────────────────────────────────────────────

function ApprovalRow({
  req,
  busy,
  onApprove,
  onDeny,
}: {
  req: ApprovalItem;
  busy: boolean;
  onApprove: () => void;
  onDeny: () => void;
}) {
  const riskColor = RISK_COLOR[req.riskLevel] ?? 'var(--text-muted)';
  return (
    <div style={s.approvalRow}>
      <div style={s.approvalInfo}>
        <span style={s.approvalTool}>{toolLabel(req.tool)}</span>
        <span style={{ ...s.approvalRisk, color: riskColor }}>
          {capitalize(req.riskLevel)} risk
        </span>
      </div>
      <div style={s.approvalActions}>
        <button
          style={s.approveBtn}
          onClick={onApprove}
          disabled={busy}
        >
          {busy ? '…' : 'Approve'}
        </button>
        <button
          style={s.denyBtn}
          onClick={onDeny}
          disabled={busy}
        >
          Deny
        </button>
      </div>
    </div>
  );
}

// ── Readiness Card ─────────────────────────────────────────────────────────────

function ReadinessCard({
  label,
  value,
  ok,
  detail,
  action,
  actionLabel,
}: {
  label: string;
  value: string;
  ok: boolean;
  detail: string;
  action?: () => void;
  actionLabel?: string;
}) {
  return (
    <div style={s.readinessCard}>
      <div style={s.readinessTop}>
        <span style={{ ...s.readinessDot, background: ok ? '#10a37f' : '#f59e0b' }} />
        <span style={s.readinessLabel}>{label}</span>
      </div>
      <div style={{ ...s.readinessValue, color: ok ? 'var(--text-primary)' : '#f59e0b' }}>
        {value}
      </div>
      <div style={s.readinessDetail}>{detail}</div>
      {action && actionLabel && (
        <button style={s.readinessAction} onClick={action}>{actionLabel}</button>
      )}
    </div>
  );
}

// ── Active Task Row ───────────────────────────────────────────────────────────

const STATUS_COLOR: Record<string, string> = {
  running:           '#10a37f',
  planning:          '#6366f1',
  queued:            '#f59e0b',
  paused:            '#f59e0b',
  awaiting_approval: '#ef4444',
};

const STATUS_LABEL: Record<string, string> = {
  running:           'Running',
  planning:          'Planning',
  queued:            'Queued',
  paused:            'Paused',
  awaiting_approval: 'Needs Approval',
};

function ActiveTaskRow({ task, onViewSessions }: { task: ActiveTask; onViewSessions: () => void }) {
  const color = STATUS_COLOR[task.status] ?? 'var(--text-muted)';
  const label = STATUS_LABEL[task.status] ?? task.status;
  return (
    <div style={s.taskRow}>
      <span style={{ ...s.taskDot, background: color }} />
      <span style={s.taskGoal}>{task.goal}</span>
      {task.status === 'awaiting_approval' ? (
        <button style={{ ...s.taskStatus, color, cursor: 'pointer', background: 'none', border: 'none', padding: 0 }}
          onClick={onViewSessions}
        >
          {label} →
        </button>
      ) : (
        <span style={{ ...s.taskStatus, color }}>{label}</span>
      )}
    </div>
  );
}

// ── Environment Panel ─────────────────────────────────────────────────────────

function EnvironmentPanel({
  sensors,
  permissions,
  loading,
}: {
  sensors: SensorInfo[];
  permissions: Permission[];
  loading: boolean;
}) {
  if (loading) {
    return <div style={s.envLoading}>Loading environment…</div>;
  }

  if (sensors.length === 0) {
    return <div style={s.envEmpty}>Environment monitoring unavailable. Grant permissions in Settings to enable sensors.</div>;
  }

  return (
    <div style={s.envGrid}>
      {sensors.map(sensor => {
        const needsPerm = !!sensor.permissionKey;
        const permGranted = !needsPerm || !!permissions.find(p => p.key === sensor.permissionKey)?.granted;
        const label = SENSOR_LABELS[sensor.name] ?? sensor.name;
        return (
          <div key={sensor.name} style={s.envTile}>
            <span style={{
              ...s.envDot,
              background: sensor.running ? '#10a37f' : (permGranted ? '#6366f1' : 'var(--border)'),
            }} />
            <span style={s.envLabel}>{label}</span>
            <span style={s.envState}>
              {sensor.running ? 'active' : (permGranted ? 'available' : 'needs permission')}
            </span>
          </div>
        );
      })}
    </div>
  );
}

// ── Workflow Pack Card ────────────────────────────────────────────────────────

function WorkflowPackCard({
  pack,
  readiness,
  starting,
  result,
  pendingRun,
  pendingApproval,
  advancing,
  onStart,
  onApprove,
  onDeny,
}: {
  pack: WorkflowPackSummary;
  readiness: PackReadiness | null;
  starting: boolean;
  result: { ok: boolean; status?: string; error?: string } | null;
  pendingRun: WorkflowRunInfo | null;
  pendingApproval: OperatorApprovalInfo | null;
  advancing: boolean;
  onStart: (targetApp?: string) => void;
  onApprove: (runId: string, approvalId: string) => void;
  onDeny: (approvalId: string) => void;
}) {
  const ready     = readiness?.ready ?? false;
  const blockers  = readiness?.blockers ?? [];
  const warnings  = readiness?.warnings ?? [];
  const catColor  = WORKFLOW_CATEGORY_COLOR[pack.category] ?? 'var(--text-muted)';
  const needsTarget = pack.requirements.platforms.includes('macOS') && !ready;

  const isAwaitingApproval = result?.status === 'awaiting_approval' || pendingRun?.status === 'awaiting_approval';

  const statusText = result
    ? result.ok
      ? result.status === 'completed'         ? 'Workflow completed'
      : isAwaitingApproval                    ? null  // rendered by approval panel below
      : result.status === 'running'           ? 'Running — track progress in Sessions'
      : result.status === 'failed'            ? 'Workflow failed'
      : 'Started — check Sessions for status'
      : result.error ?? 'Could not start workflow'
    : null;

  return (
    <div style={{
      ...s.workflowCard,
      ...(isAwaitingApproval ? { borderColor: 'rgba(245,158,11,0.35)' } : {}),
    }}>
      {/* Category badge + name */}
      <div style={s.workflowCardTop}>
        <span style={{ ...s.workflowCatBadge, color: catColor, borderColor: catColor }}>
          {capitalize(pack.category)}
        </span>
        <span style={s.workflowCardName}>{pack.name}</span>
        {pack.estimatedDurationSec && (
          <span style={s.workflowDuration}>~{pack.estimatedDurationSec}s</span>
        )}
      </div>

      {/* Tagline */}
      <div style={s.workflowTagline}>{pack.tagline}</div>

      {/* Readiness indicator */}
      {readiness && !isAwaitingApproval && (
        <div style={s.workflowReadiness}>
          <span style={{
            ...s.workflowReadinessDot,
            background: ready ? '#10a37f' : '#f59e0b',
          }} />
          <span style={{ ...s.workflowReadinessText, color: ready ? '#10a37f' : '#f59e0b' }}>
            {ready
              ? 'Ready'
              : `${blockers.length} blocker${blockers.length > 1 ? 's' : ''}`
            }
          </span>
          {warnings.length > 0 && (
            <span style={s.workflowWarning}>· {warnings.length} warning{warnings.length > 1 ? 's' : ''}</span>
          )}
        </div>
      )}

      {/* First blocker */}
      {blockers.length > 0 && !isAwaitingApproval && (
        <div style={s.workflowBlocker}>
          {blockers[0]!.message}
          <div style={s.workflowRemediation}>{blockers[0]!.remediation}</div>
        </div>
      )}

      {/* Inline operator approval panel */}
      {isAwaitingApproval && pendingRun?.pendingApprovalId && (
        pendingApproval
          ? (
            <WorkflowApprovalPanel
              approval={pendingApproval}
              runId={pendingRun.runId}
              advancing={advancing}
              onApprove={() => onApprove(pendingRun.runId, pendingRun.pendingApprovalId!)}
              onDeny={() => onDeny(pendingRun.pendingApprovalId!)}
            />
          )
          : (
            <div style={s.workflowApprovalLoading}>
              Paused — loading approval details…
            </div>
          )
      )}

      {/* If awaiting_approval but we lost the pendingRun (page refresh) */}
      {isAwaitingApproval && !pendingRun && (
        <div style={s.workflowApprovalLoading}>
          Paused — go to Sessions to review and approve the pending action.
        </div>
      )}

      {/* Non-approval result feedback */}
      {statusText && (
        <div style={{
          ...s.workflowStatus,
          color: result?.ok ? '#10a37f' : '#ef4444',
        }}>
          {statusText}
        </div>
      )}

      {/* Start button — hidden while awaiting approval to prevent double-starts */}
      {!isAwaitingApproval && (
        <button
          style={{
            ...s.workflowStartBtn,
            ...((!ready || starting) ? s.workflowStartBtnDisabled : {}),
          }}
          onClick={() => onStart()}
          disabled={!ready || starting || needsTarget}
          title={!ready ? (blockers[0]?.message ?? 'Not ready') : undefined}
        >
          {starting ? 'Starting…' : 'Run'}
        </button>
      )}
    </div>
  );
}

// ── Workflow Approval Panel ───────────────────────────────────────────────────

const OPERATOR_RISK_LABEL: Record<string, string> = {
  input_action: 'Input Action',
  focus_only:   'Focus Only',
  read_only:    'Read Only',
};
const OPERATOR_RISK_COLOR: Record<string, string> = {
  input_action: '#f59e0b',
  focus_only:   '#6366f1',
  read_only:    '#10a37f',
};

function WorkflowApprovalPanel({
  approval,
  advancing,
  onApprove,
  onDeny,
}: {
  approval: OperatorApprovalInfo;
  runId: string;
  advancing: boolean;
  onApprove: () => void;
  onDeny: () => void;
}) {
  const riskColor = OPERATOR_RISK_COLOR[approval.risk] ?? '#f59e0b';
  const riskLabel = OPERATOR_RISK_LABEL[approval.risk] ?? approval.risk;
  const minsLeft  = Math.max(0, Math.round((approval.expiresAt - Date.now()) / 60_000));
  const expired   = approval.status === 'expired' || approval.expiresAt <= Date.now();

  if (expired) {
    return (
      <div style={s.workflowApprovalPanel}>
        <div style={{ ...s.workflowApprovalHeader, color: '#ef4444' }}>
          Approval expired — restart the workflow to try again.
        </div>
      </div>
    );
  }

  return (
    <div style={s.workflowApprovalPanel}>
      <div style={s.workflowApprovalHeader}>
        <span style={s.workflowApprovalTitle}>Approval Required</span>
        <span style={{ ...s.workflowApprovalRisk, color: riskColor }}>{riskLabel}</span>
      </div>
      <div style={s.workflowApprovalDesc}>{approval.description}</div>
      {minsLeft > 0 && minsLeft <= 5 && (
        <div style={s.workflowApprovalExpiry}>Expires in {minsLeft}m</div>
      )}
      <div style={s.workflowApprovalBtns}>
        <button
          style={{ ...s.approveBtn, ...(advancing ? { opacity: 0.5 } : {}) }}
          onClick={onApprove}
          disabled={advancing}
        >
          {advancing ? 'Processing…' : 'Approve & Continue'}
        </button>
        <button
          style={{ ...s.denyBtn, ...(advancing ? { opacity: 0.5 } : {}) }}
          onClick={onDeny}
          disabled={advancing}
        >
          Deny
        </button>
      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  page: {
    flex: 1,
    overflowY: 'auto',
    padding: '28px 28px 40px',
    display: 'flex',
    flexDirection: 'column',
    gap: 24,
  },

  // Header
  header: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 16,
    borderBottom: '1px solid var(--border)',
    paddingBottom: 20,
  },
  title: {
    fontSize: 22,
    fontWeight: 700,
    color: 'var(--text-primary)',
    margin: '0 0 6px',
    letterSpacing: '-0.01em',
  },
  subtitle: {
    fontSize: 13,
    color: 'var(--text-secondary)',
    lineHeight: 1.5,
    margin: 0,
    maxWidth: 520,
  },
  sessionsHotlink: {
    flexShrink: 0,
    background: 'rgba(239,68,68,0.1)',
    border: '1px solid rgba(239,68,68,0.3)',
    borderRadius: 6,
    color: '#ef4444',
    fontSize: 11,
    fontWeight: 700,
    padding: '5px 12px',
    cursor: 'pointer',
    letterSpacing: '0.02em',
    whiteSpace: 'nowrap' as const,
    marginTop: 4,
  },

  // Supervision bar
  supervisionBar: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '8px 12px',
    background: 'rgba(99,102,241,0.06)',
    border: '1px solid rgba(99,102,241,0.15)',
    borderRadius: 8,
    marginTop: -8,
  },
  supervisionDot: {
    width: 7,
    height: 7,
    borderRadius: '50%',
    background: '#6366f1',
    flexShrink: 0,
  },
  supervisionText: {
    fontSize: 11,
    color: 'rgba(99,102,241,0.9)',
    lineHeight: 1.5,
  },

  // Sections
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  sectionLabel: {
    fontSize: 10,
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
    color: 'var(--text-muted)',
  },
  sectionLabelRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionMeta: {
    fontSize: 11,
    color: 'var(--text-muted)',
  },
  sectionAction: {
    background: 'none',
    border: 'none',
    color: 'var(--accent)',
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
    padding: 0,
    letterSpacing: '0.02em',
  },

  // Pending approvals
  approvalList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  approvalRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    padding: '10px 14px',
    background: 'rgba(239,68,68,0.04)',
    border: '1px solid rgba(239,68,68,0.2)',
    borderRadius: 8,
  },
  approvalInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
    flex: 1,
    minWidth: 0,
  },
  approvalTool: {
    fontSize: 12,
    fontWeight: 600,
    color: 'var(--text-primary)',
    fontFamily: 'monospace',
  },
  approvalRisk: {
    fontSize: 10,
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
  },
  approvalActions: {
    display: 'flex',
    gap: 6,
    flexShrink: 0,
  },
  approveBtn: {
    background: 'rgba(16,163,127,0.1)',
    border: '1px solid rgba(16,163,127,0.3)',
    borderRadius: 5,
    color: '#10a37f',
    fontSize: 11,
    fontWeight: 600,
    padding: '4px 12px',
    cursor: 'pointer',
  },
  denyBtn: {
    background: 'rgba(239,68,68,0.08)',
    border: '1px solid rgba(239,68,68,0.2)',
    borderRadius: 5,
    color: '#ef4444',
    fontSize: 11,
    fontWeight: 600,
    padding: '4px 12px',
    cursor: 'pointer',
  },
  approvalMore: {
    fontSize: 11,
    color: 'var(--text-muted)',
    padding: '4px 2px',
  },

  // Readiness
  readinessRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 10,
  },
  readinessCard: {
    background: 'var(--bg-surface)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    padding: '12px 14px',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  readinessTop: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    marginBottom: 2,
  },
  readinessDot: {
    width: 7,
    height: 7,
    borderRadius: '50%',
    flexShrink: 0,
  },
  readinessLabel: {
    fontSize: 10,
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
    color: 'var(--text-muted)',
  },
  readinessValue: {
    fontSize: 18,
    fontWeight: 700,
    letterSpacing: '-0.01em',
  },
  readinessDetail: {
    fontSize: 11,
    color: 'var(--text-secondary)',
    lineHeight: 1.4,
  },
  readinessAction: {
    background: 'none',
    border: 'none',
    color: 'var(--accent)',
    fontSize: 11,
    fontWeight: 600,
    cursor: 'pointer',
    padding: 0,
    marginTop: 2,
    textAlign: 'left' as const,
  },

  // Work intake
  workIntake: {
    background: 'var(--bg-surface)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    padding: '14px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  goalInput: {
    width: '100%',
    background: 'var(--bg-input)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    color: 'var(--text-primary)',
    fontSize: 13,
    padding: '10px 12px',
    resize: 'vertical' as const,
    fontFamily: 'inherit',
    lineHeight: 1.5,
    boxSizing: 'border-box' as const,
  },
  workIntakeRow: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 10,
    flexWrap: 'wrap' as const,
  },
  categoryCol: {
    display: 'flex',
    flexDirection: 'column',
    gap: 5,
    flex: 1,
  },
  categoryRow: {
    display: 'flex',
    gap: 5,
    flexWrap: 'wrap' as const,
  },
  categoryBtn: {
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    borderRadius: 5,
    color: 'var(--text-secondary)',
    fontSize: 11,
    fontWeight: 600,
    padding: '3px 10px',
    cursor: 'pointer',
    letterSpacing: '0.02em',
  },
  categoryBtnActive: {
    background: 'var(--accent-dim)',
    borderColor: 'var(--accent)',
    color: 'var(--accent)',
  },
  categoryHint: {
    fontSize: 11,
    color: 'var(--text-muted)',
    lineHeight: 1.4,
  },
  categoryPermWarn: {
    color: '#f59e0b',
    fontWeight: 600,
  },
  assignBtn: {
    background: 'var(--accent)',
    color: '#fff',
    border: 'none',
    borderRadius: 7,
    padding: '7px 20px',
    fontSize: 13,
    fontWeight: 700,
    cursor: 'pointer',
    letterSpacing: '0.01em',
    flexShrink: 0,
    alignSelf: 'flex-start',
  },
  assignBtnDisabled: {
    opacity: 0.4,
    cursor: 'not-allowed',
  },
  tierGate: {
    background: 'rgba(245,158,11,0.07)',
    border: '1px solid rgba(245,158,11,0.2)',
    borderRadius: 6,
    color: '#f59e0b',
    fontSize: 11,
    padding: '7px 12px',
  },
  assignSuccess: {
    background: '#10a37f10',
    border: '1px solid #10a37f33',
    borderRadius: 8,
    padding: '10px 14px',
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  assignSuccessTitle: {
    fontSize: 12,
    fontWeight: 700,
    color: '#10a37f',
  },
  assignSuccessBody: {
    fontSize: 11,
    color: 'var(--text-secondary)',
    lineHeight: 1.5,
  },
  assignError: {
    background: '#ef444414',
    border: '1px solid #ef444444',
    borderRadius: 6,
    color: '#ef4444',
    fontSize: 12,
    padding: '7px 12px',
  },
  assignWarning: {
    background: '#f59e0b0d',
    border: '1px solid #f59e0b33',
    borderRadius: 6,
    color: '#f59e0b',
    fontSize: 11,
    padding: '7px 12px',
  },
  inlineLink: {
    background: 'none',
    border: 'none',
    color: 'var(--accent)',
    fontSize: 'inherit',
    fontWeight: 700,
    cursor: 'pointer',
    padding: 0,
    textDecoration: 'underline',
  },
  workHandoffHint: {
    fontSize: 11,
    color: 'var(--text-muted)',
    margin: 0,
    lineHeight: 1.5,
  },

  // Active task list
  taskList: {
    background: 'var(--bg-surface)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    overflow: 'hidden',
  },
  taskRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    padding: '8px 14px',
    borderBottom: '1px solid var(--border)',
  },
  taskDot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    flexShrink: 0,
  },
  taskGoal: {
    flex: 1,
    fontSize: 12,
    color: 'var(--text-primary)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  taskStatus: {
    fontSize: 10,
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.05em',
    flexShrink: 0,
  },
  taskMore: {
    padding: '7px 14px',
    fontSize: 11,
    color: 'var(--text-muted)',
    textAlign: 'center' as const,
  },

  // Environment
  envLoading: {
    fontSize: 12,
    color: 'var(--text-muted)',
    padding: '10px 0',
  },
  envEmpty: {
    fontSize: 12,
    color: 'var(--text-muted)',
    padding: '10px 0',
    fontStyle: 'italic' as const,
  },
  envGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(130px, 1fr))',
    gap: 8,
  },
  envTile: {
    background: 'var(--bg-surface)',
    border: '1px solid var(--border)',
    borderRadius: 8,
    padding: '8px 10px',
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
  },
  envDot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    marginBottom: 2,
  },
  envLabel: {
    fontSize: 11,
    fontWeight: 600,
    color: 'var(--text-primary)',
  },
  envState: {
    fontSize: 10,
    color: 'var(--text-muted)',
    textTransform: 'lowercase' as const,
  },

  // Utility links — demoted, not the product identity
  utilities: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    paddingTop: 8,
    borderTop: '1px solid var(--border)',
    flexWrap: 'wrap' as const,
  },
  utilitiesLabel: {
    fontSize: 10,
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
    color: 'var(--text-muted)',
    marginRight: 4,
  },
  utilBtn: {
    background: 'none',
    border: '1px solid var(--border)',
    borderRadius: 5,
    color: 'var(--text-muted)',
    fontSize: 11,
    fontWeight: 500,
    padding: '3px 10px',
    cursor: 'pointer',
    letterSpacing: '0.01em',
  },

  // ── Workflow Pack Cards ───────────────────────────────────────────────────────
  workflowGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
    gap: 12,
  },
  workflowCard: {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 10,
    padding: '14px 14px 12px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 6,
  },
  workflowCardTop: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    flexWrap: 'wrap' as const,
  },
  workflowCatBadge: {
    fontSize: 9,
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.08em',
    border: '1px solid',
    borderRadius: 4,
    padding: '1px 5px',
  },
  workflowCardName: {
    fontSize: 13,
    fontWeight: 600,
    color: 'var(--text-primary)',
    flex: 1,
  },
  workflowDuration: {
    fontSize: 10,
    color: 'var(--text-muted)',
    flexShrink: 0,
  },
  workflowTagline: {
    fontSize: 11,
    color: 'var(--text-secondary)',
    lineHeight: 1.45,
  },
  workflowReadiness: {
    display: 'flex',
    alignItems: 'center',
    gap: 5,
    marginTop: 2,
  },
  workflowReadinessDot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    flexShrink: 0,
  },
  workflowReadinessText: {
    fontSize: 11,
    fontWeight: 600,
  },
  workflowWarning: {
    fontSize: 10,
    color: '#f59e0b',
  },
  workflowBlocker: {
    fontSize: 10,
    color: '#f59e0b',
    background: 'rgba(245,158,11,0.07)',
    border: '1px solid rgba(245,158,11,0.2)',
    borderRadius: 5,
    padding: '4px 7px',
    lineHeight: 1.4,
  },
  workflowRemediation: {
    color: 'var(--text-muted)',
    marginTop: 2,
  },
  workflowStatus: {
    fontSize: 11,
    fontWeight: 600,
    marginTop: 2,
  },
  workflowStartBtn: {
    marginTop: 4,
    background: 'rgba(99,102,241,0.12)',
    border: '1px solid rgba(99,102,241,0.3)',
    borderRadius: 6,
    color: '#6366f1',
    fontSize: 11,
    fontWeight: 700,
    padding: '5px 14px',
    cursor: 'pointer',
    alignSelf: 'flex-start' as const,
    letterSpacing: '0.02em',
  },
  workflowStartBtnDisabled: {
    opacity: 0.4,
    cursor: 'not-allowed',
  },

  // Workflow approval panel (inline inside WorkflowPackCard)
  workflowApprovalPanel: {
    background: 'rgba(245,158,11,0.06)',
    border: '1px solid rgba(245,158,11,0.22)',
    borderRadius: 8,
    padding: '10px 12px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 7,
    marginTop: 2,
  },
  workflowApprovalHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
  },
  workflowApprovalTitle: {
    fontSize: 10,
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.07em',
    color: '#f59e0b',
  },
  workflowApprovalRisk: {
    fontSize: 9,
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.06em',
  },
  workflowApprovalDesc: {
    fontSize: 11,
    color: 'var(--text-secondary)',
    lineHeight: 1.5,
    wordBreak: 'break-word' as const,
  },
  workflowApprovalExpiry: {
    fontSize: 10,
    color: '#ef4444',
    fontWeight: 600,
  },
  workflowApprovalBtns: {
    display: 'flex',
    gap: 6,
    marginTop: 2,
  },
  workflowApprovalLoading: {
    fontSize: 11,
    color: '#f59e0b',
    fontStyle: 'italic' as const,
    padding: '6px 0',
  },
};
