import React, { useState, useEffect, useCallback, useRef } from 'react';
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
  /**
   * True when this pack has phases that require a natural-language goal
   * to auto-generate scripts (adobe_extendscript, blender_python, app_applescript).
   */
  needsGoal?: boolean;
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

// ── Sample tasks rail (A4) ───────────────────────────────────────────────────
//
// Match by simple keyword on the detected app name. Each entry is one starter
// task the user can run with a single click. Most tasks pre-fill the AI Task
// Runner; tasks with `runWith: 'pack'` instead launch a workflow pack chain
// (e.g. Unreal Blueprint generation needs the M1–M5 manifest pipeline, NOT
// the live click runner — the runner would just thrash through the editor).
interface SampleTask {
  matchKeywords: RegExp;
  icon: string;
  appLabel: string;
  title: string;
  prompt: string;
  /** When set, launches a workflow pack instead of the AI Task Runner. */
  runWith?: { kind: 'pack'; packId: string };
}
const SAMPLE_TASKS: SampleTask[] = [
  {
    matchKeywords: /unreal/i,
    icon:          '⬡',
    appLabel:      'Unreal Engine',
    title:         'Build a survival game prototype',
    prompt:        'Build me a survival game in Unreal with health, hunger, basic inventory, and a simple enemy. Generate the Blueprint files and compile.',
    runWith:       { kind: 'pack', packId: 'pack.unreal-m1-execute' },
  },
  {
    matchKeywords: /photoshop|illustrator/i,
    icon:          '◬',
    appLabel:      'Photoshop',
    title:         'Auto-resize the open image for social',
    prompt:        'Take the currently open image in Photoshop and export 1:1, 16:9, and 9:16 versions sized for Instagram, YouTube, and TikTok.',
  },
  {
    matchKeywords: /blender/i,
    icon:          '◇',
    appLabel:      'Blender',
    title:         'Render the current scene',
    prompt:        'Render the current Blender scene at 1080p with Cycles, save the PNG to my desktop, and report when done.',
  },
  {
    matchKeywords: /premiere|davinci|after.?effects/i,
    icon:          '▶',
    appLabel:      'Premiere',
    title:         'Export the open timeline as H.264',
    prompt:        'Export the current Premiere timeline as 1080p H.264 to my desktop and report the file path when complete.',
  },
  {
    matchKeywords: /maya|houdini/i,
    icon:          '◐',
    appLabel:      '3D Tools',
    title:         'Set up a basic lighting rig',
    prompt:        'Add a 3-point lighting rig to the current scene with a key, fill, and rim light. Use studio lighting defaults.',
  },
  {
    matchKeywords: /figma/i,
    icon:          '◳',
    appLabel:      'Figma',
    title:         'Export selected frames as PNG',
    prompt:        'Export every selected Figma frame as 2x PNG to my desktop, in a folder named with today\'s date.',
  },
];

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

  // Trust mode — tracked per active session. 'supervised' = require approval,
  // 'trusted' = auto-execute and audit-log only.
  const [activeSessionId, setActiveSessionId]      = useState<string | null>(null);
  const [trustLevel, setTrustLevel]                = useState<'supervised' | 'trusted'>('supervised');
  const [trustChanging, setTrustChanging]          = useState(false);

  // Proactive app detection nudge
  interface DetectedAppNudge {
    appId: string; appName: string; category: string; icon?: string;
    packIds: string[]; suggestions: string[]; detectedAt: number;
  }
  const [detectedApp, setDetectedApp]              = useState<DetectedAppNudge | null>(null);

  // ── Sample tasks rail (A4) — scoped to apps the capability scanner found ──
  interface DetectedInstalledApp { name: string; version?: string }
  const [scannedApps, setScannedApps] = useState<DetectedInstalledApp[]>([]);

  // ── AI Task Runner ──────────────────────────────────────────────────────────
  interface TaskStep {
    step: number; phase: string; description: string; screenshotPath?: string;
  }
  const [taskGoal, setTaskGoal]                       = useState('');
  const [taskRunning, setTaskRunning]                 = useState(false);
  const [taskSteps, setTaskSteps]                     = useState<TaskStep[]>([]);
  const [taskOutcome, setTaskOutcome]                 = useState<{
    ok: boolean;
    summary: string;
    outcome: string;
    beforeScreenshotPath?: string;
    afterScreenshotPath?:  string;
    scopedTargeting?: {
      requestedLabel: string;
      bound: { processName: string; family: string; windowTitleAtBind?: string; fuzzyMatched: boolean; bindingReason: string } | null;
      everDegraded: boolean;
      boundsFailureCount: number;
      lastFallbackReason?: string;
    };
  } | null>(null);
  const [taskPendingApprovalId, setTaskPendingApprovalId] = useState<string | null>(null);
  const [taskSessionId, setTaskSessionId]             = useState<string | null>(null);
  const unsubTaskRef                                  = useRef<(() => void) | null>(null);

  // ── Unreal Hero Flow ───────────────────────────────────────────────────────
  interface HeroFlowStepUI {
    stage: string; action: string; ok: boolean;
    controlMethod: string; detail: string;
    screenshotPath?: string; durationMs: number; timestamp: string;
  }
  interface HeroFlowResultUI {
    ok: boolean; summary: string; stages: HeroFlowStepUI[];
    primaryControl: string; projectName?: string; totalDurationMs: number;
  }
  const [heroFlowRunning, setHeroFlowRunning]         = useState(false);
  const [heroFlowSteps, setHeroFlowSteps]             = useState<HeroFlowStepUI[]>([]);
  const [heroFlowResult, setHeroFlowResult]           = useState<HeroFlowResultUI | null>(null);
  const [heroFlowTemplate, setHeroFlowTemplate]       = useState<string>('third-person');
  const unsubHeroRef                                  = useRef<(() => void) | null>(null);

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
    const SCRIPT_PHASE_KINDS = new Set(['adobe_extendscript', 'blender_python', 'app_applescript']);
    try {
      const packsRes = await (tf['workflows'] as Record<string, () => Promise<unknown>>)?.list?.();
      const allReadinessRes = await (tf['workflows'] as Record<string, () => Promise<unknown>>)?.readinessAll?.();
      if (packsRes && typeof packsRes === 'object' && (packsRes as Record<string, unknown>)['ok']) {
        const rawPacks = (packsRes as { packs?: Array<WorkflowPackSummary & { phases?: Array<{ kind: string }> }> }).packs ?? [];
        // Compute needsGoal for each pack based on its phase kinds
        const ps: WorkflowPackSummary[] = rawPacks.map(p => ({
          ...p,
          needsGoal: p.phases?.some(ph => SCRIPT_PHASE_KINDS.has(ph.kind)) ?? false,
        }));
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
    // Refresh readiness state whenever the window regains focus — covers the
    // common case of the user granting a permission or adding an API key in
    // System Preferences / Settings and tabbing back to Operate.
    const onFocus = () => fetchData();
    window.addEventListener('focus', onFocus);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', onFocus);
    };
  }, [fetchData]);

  // Subscribe to proactive app detection from the main process
  useEffect(() => {
    if (!tf) return;
    const op = tf['operator'] as Record<string, (...a: unknown[]) => unknown> | undefined;
    if (!op?.onAppDetected) return;
    const unsub = (op.onAppDetected as (cb: (ev: DetectedAppNudge) => void) => () => void)(
      (ev) => setDetectedApp(ev),
    );
    return unsub;
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tf]);

  // Cleanup the task progress listener on unmount — prevents a leaked
  // IPC subscription if the user navigates away while a task is running.
  useEffect(() => {
    return () => {
      if (unsubTaskRef.current) { unsubTaskRef.current(); unsubTaskRef.current = null; }
      if (unsubHeroRef.current) { unsubHeroRef.current(); unsubHeroRef.current = null; }
    };
  }, []);

  // Capability-scan loader. Pulled out as a callable so the rail can offer
  // a "Re-scan" button after the user installs a new app while Operate is open.
  const [rescanning, setRescanning] = useState(false);
  const runCapabilityScan = useCallback(async () => {
    if (!tf) return;
    const scanner = tf['incomeScanner'] as Record<string, () => Promise<unknown>> | undefined;
    if (!scanner?.run) return;
    setRescanning(true);
    try {
      const r = await scanner.run();
      const result = (r as { result?: { installedApps?: DetectedInstalledApp[] } } | null)?.result;
      if (result?.installedApps) setScannedApps(result.installedApps);
    } catch { /* best effort */ }
    finally { setRescanning(false); }
  }, [tf]);

  // Load capability scan once on mount — feeds the "Sample tasks for your apps" rail
  useEffect(() => {
    runCapabilityScan();
  }, [runCapabilityScan]);

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
    } catch {
      // Re-fetch so the item reappears if the approve call failed
      fetchData();
    } finally {
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
    } catch {
      // Re-fetch so the item reappears if the deny call failed
      fetchData();
    } finally {
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

  const startWorkflow = useCallback(async (packId: string, targetApp?: string, goal?: string) => {
    if (!tf || startingPackId) return;
    setStartingPackId(packId);
    setWorkflowResult(prev => ({ ...prev, [packId]: { ok: false } }));
    // Clear any prior pending run for this pack
    setPendingRuns(prev => { const n = { ...prev }; delete n[packId]; return n; });
    try {
      const runOpts: { targetApp?: string; goal?: string } = {};
      if (targetApp) runOpts.targetApp = targetApp;
      if (goal)      runOpts.goal = goal;
      const res = await (tf['workflows'] as {
        startRun: (id: string, opts?: { targetApp?: string; goal?: string }) => Promise<{
          ok: boolean;
          run?: { id: string; status: string; pendingApprovalId?: string };
          readinessBlockers?: Array<{ message: string }>;
          error?: string;
        }>;
      })?.startRun?.(packId, runOpts);
      if (!res) return;
      if (res.ok && res.run) {
        setWorkflowResult(prev => ({ ...prev, [packId]: { ok: true, status: res.run!.status } }));
        if (res.run.status === 'awaiting_approval' && res.run.pendingApprovalId) {
          setPendingRuns(prev => ({
            ...prev,
            [packId]: { runId: res.run!.id, packId, status: res.run!.status, pendingApprovalId: res.run!.pendingApprovalId },
          }));
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
  }, [tf, startingPackId, fetchData, fetchOperatorApproval]);

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

  // Listen for prefill event from council→operator bridge (generic AI Task Runner)
  useEffect(() => {
    const handler = (e: Event) => {
      const goal = (e as CustomEvent<string>).detail;
      if (goal) {
        setTaskGoal(goal);
        document.getElementById('ai-task-runner-section')?.scrollIntoView({ behavior: 'smooth' });
      }
    };
    window.addEventListener('triforge:operator-prefill', handler);
    return () => window.removeEventListener('triforge:operator-prefill', handler);
  }, []);

  // Listen for pack-launch event from council→operator bridge (specific workflow pack)
  useEffect(() => {
    const handler = (e: Event) => {
      const { packId, goal } = (e as CustomEvent<{ packId: string; goal: string }>).detail;
      if (packId) {
        // Scroll to workflow packs section and auto-start the pack
        document.getElementById('workflow-packs-section')?.scrollIntoView({ behavior: 'smooth' });
        // Small delay so packs have loaded
        setTimeout(() => startWorkflow(packId, undefined, goal || undefined), 400);
      }
    };
    window.addEventListener('triforge:start-pack', handler);
    return () => window.removeEventListener('triforge:start-pack', handler);
  }, [startWorkflow]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Run an AI-driven Sense→Plan→Act→Verify task loop.
   *
   * `priorApprovedAction` is set when resuming after a paused approval — it
   * gets seeded into the planner history so the planner does NOT re-issue
   * the same action and trigger another approval prompt.
   */
  /**
   * Extract a leading `Target app: <Name>.` directive from the user's prompt.
   * The runner has the same extractor as a safety net, but doing it here lets
   * us (a) pass targetApp through the preload IPC cleanly, and (b) strip the
   * prefix from the textarea submission so it doesn't also appear inside the
   * planner history as a distracting user-goal fragment.
   */
  const parseTargetAppDirective = (raw: string): { targetApp?: string; goal: string } => {
    if (!raw) return { goal: raw };
    const m = raw.match(/^\s*(?:target\s*app|target|app)\s*[:=]\s*([^.\n—–;]+?)\s*(?:[.\n—–;]|$)/i);
    if (!m) return { goal: raw };
    const name = m[1].trim();
    if (!name) return { goal: raw };
    const stripped = raw.slice(m[0].length).replace(/^[\s.—–;]+/, '').trim();
    return { targetApp: name, goal: stripped || raw };
  };

  const runAiTask = async (priorApprovedAction?: string) => {
    if (!tf || !taskGoal.trim() || taskRunning) return;
    setTaskRunning(true);
    if (!priorApprovedAction) setTaskSteps([]);
    setTaskOutcome(null);
    setTaskPendingApprovalId(null);

    // Lift any "Target app: <Name>." prefix into an explicit targetApp
    // argument so the runner activates scoped / side-by-side mode instead
    // of falling back to unscoped full-screen dispatch.
    const { targetApp, goal: workingGoal } = parseTargetAppDirective(taskGoal.trim());

    const op = tf['operator'] as Record<string, (...a: unknown[]) => Promise<unknown>>;
    try {
      // Create (or reuse) a session
      let sid = activeSessionId ?? taskSessionId;
      if (!sid) {
        const r = await op?.startSession?.() as { ok: boolean; session?: { id: string } } | null;
        if (r?.ok && r.session?.id) { sid = r.session.id; setActiveSessionId(sid); setTaskSessionId(sid); }
      }
      if (!sid) { setTaskOutcome({ ok: false, summary: 'Could not create operator session.', outcome: 'error' }); return; }

      // If in trusted mode, apply it to the session
      if (trustLevel === 'trusted') { await op?.setTrust?.(sid, 'trusted').catch(() => {}); }

      // Subscribe to step-by-step progress
      if (unsubTaskRef.current) unsubTaskRef.current();
      unsubTaskRef.current = (op?.onTaskProgress as unknown as ((cb: (ev: TaskStep) => void) => () => void) | undefined)?.(
        (ev) => setTaskSteps(prev => [...prev, ev]),
      ) ?? null;

      // Pass targetApp as the 6th arg so the runner can bind a canonical
      // BoundRuntimeTarget before any dispatch. observeOnly (5th arg) is
      // left undefined to preserve the existing heuristic routing.
      const result = await op?.runTask?.(sid, workingGoal, undefined, priorApprovedAction, undefined, targetApp) as {
        ok: boolean; outcome: string; summary: string; stepsExecuted: number;
        pendingApprovalId?: string;
        beforeScreenshotPath?: string;
        afterScreenshotPath?:  string;
        scopedTargeting?: {
          requestedLabel: string;
          bound: { processName: string; family: string; windowTitleAtBind?: string; fuzzyMatched: boolean; bindingReason: string } | null;
          everDegraded: boolean;
          boundsFailureCount: number;
          lastFallbackReason?: string;
        };
      } | null;

      if (result?.outcome === 'approval_pending' && result?.pendingApprovalId) {
        setTaskPendingApprovalId(result.pendingApprovalId);
      }

      setTaskOutcome({
        ok:                   result?.ok ?? false,
        summary:              result?.summary ?? 'Task finished.',
        outcome:              result?.outcome ?? 'unknown',
        beforeScreenshotPath: result?.beforeScreenshotPath,
        afterScreenshotPath:  result?.afterScreenshotPath,
        scopedTargeting:      result?.scopedTargeting,
      });
    } catch (e) {
      setTaskOutcome({ ok: false, summary: e instanceof Error ? e.message : 'Task failed.', outcome: 'error' });
    } finally {
      setTaskRunning(false);
      if (unsubTaskRef.current) { unsubTaskRef.current(); unsubTaskRef.current = null; }
      fetchData();
    }
  };

  /** Approve the pending operator action and resume the task loop. */
  const approveAndResume = async () => {
    if (!tf || !taskPendingApprovalId || taskRunning) return;
    // Capture the description of the action that's about to be approved so
    // we can seed the planner history on resume — without this hint the
    // planner may re-issue the same action and re-prompt for approval.
    const approvalDetails = operatorApprovals[taskPendingApprovalId];
    const justApprovedDescription =
      approvalDetails?.description ?? taskSteps[taskSteps.length - 1]?.description;

    const op = tf['operator'] as Record<string, (...a: unknown[]) => Promise<unknown>>;
    try {
      const approveRes = await op?.approveAction?.(taskPendingApprovalId) as { ok: boolean; error?: string } | null;
      if (!approveRes?.ok) {
        setTaskOutcome({ ok: false, summary: approveRes?.error ?? 'Approval failed.', outcome: 'error' });
        setTaskPendingApprovalId(null);
        return;
      }
    } catch (e) {
      setTaskOutcome({ ok: false, summary: e instanceof Error ? e.message : 'Approval failed.', outcome: 'error' });
      setTaskPendingApprovalId(null);
      return;
    }
    // Approved — clear pending state and re-run from current screen state,
    // injecting the just-approved action so the planner skips re-issuing it.
    setTaskPendingApprovalId(null);
    setTaskOutcome(null);
    await runAiTask(justApprovedDescription);
  };

  /** Toggle trust level for the active session. Creates a new session if none is active. */
  const handleTrustToggle = async () => {
    if (!tf || trustChanging) return;
    setTrustChanging(true);
    try {
      const op = tf['operator'] as Record<string, (...a: unknown[]) => Promise<unknown>>;
      let sid = activeSessionId;
      if (!sid) {
        const r = await op?.startSession?.() as { ok: boolean; session?: { id: string } } | null;
        if (r?.ok && r.session?.id) { sid = r.session.id; setActiveSessionId(sid); }
      }
      if (!sid) return;
      const newLevel: 'supervised' | 'trusted' = trustLevel === 'supervised' ? 'trusted' : 'supervised';
      const res = await op?.setTrust?.(sid, newLevel) as { ok: boolean } | null;
      if (res?.ok) setTrustLevel(newLevel);
    } catch { /* ignore */ } finally {
      setTrustChanging(false);
    }
  };

  /** Run the Unreal Hero Flow: detect → probe → focus → configure → verify. */
  const startHeroFlow = async () => {
    if (!tf || heroFlowRunning) return;
    setHeroFlowRunning(true);
    setHeroFlowSteps([]);
    setHeroFlowResult(null);

    const heroNs = tf['unrealHeroFlow'] as Record<string, (...a: unknown[]) => unknown> | undefined;
    if (!heroNs) { setHeroFlowRunning(false); return; }

    // Subscribe to step-by-step progress
    if (unsubHeroRef.current) unsubHeroRef.current();
    unsubHeroRef.current = (heroNs.onProgress as (cb: (step: HeroFlowStepUI) => void) => () => void)?.(
      (step) => setHeroFlowSteps(prev => [...prev, step]),
    ) ?? null;

    try {
      const res = await heroNs.run?.({ projectTemplate: heroFlowTemplate }) as {
        ok: boolean; result?: HeroFlowResultUI; error?: string;
      } | null;
      if (res?.ok && res.result) {
        setHeroFlowResult(res.result);
      } else {
        setHeroFlowResult({
          ok: false,
          summary: res?.error ?? 'Hero flow failed.',
          stages: [],
          primaryControl: 'visual',
          totalDurationMs: 0,
        });
      }
    } catch (e) {
      setHeroFlowResult({
        ok: false,
        summary: e instanceof Error ? e.message : 'Hero flow failed.',
        stages: [],
        primaryControl: 'visual',
        totalDurationMs: 0,
      });
    } finally {
      setHeroFlowRunning(false);
      if (unsubHeroRef.current) { unsubHeroRef.current(); unsubHeroRef.current = null; }
    }
  };

  // Derived readiness state
  const connectedProviders    = Object.values(keyStatus).filter(Boolean).length;
  const grantedCount          = permissions.filter(p => p.granted).length;
  const blockedActionPerms    = ACTION_PERM_KEYS.filter(k => !permissions.find(p => p.key === k)?.granted);
  const runningSensors        = sensors.filter(s => s.running);
  const canAssignWork         = tier === 'pro';
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
        <button
          style={hasActiveWork ? s.sessionsHotlink : { ...s.sessionsHotlink, background: 'transparent', borderColor: 'var(--border)', color: 'var(--text-muted)' }}
          onClick={onViewSessions}
        >
          {hasActiveWork
            ? (pendingApprovals > 0
                ? `${pendingApprovals} approval${pendingApprovals > 1 ? 's' : ''} pending`
                : runningTasks > 0
                ? `${runningTasks} task${runningTasks > 1 ? 's' : ''} running`
                : `${queuedTasks} queued`)
            : 'Sessions'}
          &nbsp;→
        </button>
      </div>

      {/* ── Supervision / Trust Notice ─────────────────────────────────────── */}
      <div style={{
        ...s.supervisionBar,
        justifyContent: 'space-between',
        background: trustLevel === 'trusted' ? 'rgba(245,158,11,0.07)' : 'rgba(99,102,241,0.06)',
        borderColor: trustLevel === 'trusted' ? 'rgba(245,158,11,0.22)' : 'rgba(99,102,241,0.15)',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{
            ...s.supervisionDot,
            background: trustLevel === 'trusted' ? '#f59e0b' : '#6366f1',
          }} />
          <span style={{
            ...s.supervisionText,
            color: trustLevel === 'trusted' ? 'rgba(245,158,11,0.95)' : 'rgba(99,102,241,0.9)',
          }}>
            {trustLevel === 'trusted'
              ? 'Trust Mode — input actions execute immediately and are audit-logged. Toggle off to require approval.'
              : 'Supervised Mode — TriForge pauses for your approval before every input action.'}
          </span>
        </div>
        {tier === 'pro' ? (
          <button
            style={{
              flexShrink: 0,
              background: trustLevel === 'trusted' ? 'rgba(245,158,11,0.14)' : 'rgba(99,102,241,0.12)',
              border: `1px solid ${trustLevel === 'trusted' ? 'rgba(245,158,11,0.35)' : 'rgba(99,102,241,0.3)'}`,
              borderRadius: 6,
              color: trustLevel === 'trusted' ? '#f59e0b' : '#6366f1',
              fontSize: 11,
              fontWeight: 700,
              padding: '4px 10px',
              cursor: trustChanging ? 'not-allowed' : 'pointer',
              opacity: trustChanging ? 0.5 : 1,
              letterSpacing: '0.02em',
              whiteSpace: 'nowrap' as const,
            }}
            onClick={handleTrustToggle}
            disabled={trustChanging}
          >
            {trustChanging ? '…' : trustLevel === 'trusted' ? 'Switch to Supervised' : 'Enable Trust Mode'}
          </button>
        ) : (
          <button
            style={{
              flexShrink: 0,
              background: 'rgba(255,255,255,0.04)',
              border: '1px dashed rgba(255,255,255,0.18)',
              borderRadius: 6,
              color: 'var(--text-muted)',
              fontSize: 11,
              fontWeight: 600,
              padding: '4px 10px',
              cursor: 'pointer',
              letterSpacing: '0.02em',
              whiteSpace: 'nowrap' as const,
            }}
            onClick={() => onNavigate('settings')}
            title="Trust Mode lets the operator execute input actions without per-action approval. Available on Pro — click to upgrade in Settings."
          >
            Trust Mode · Pro →
          </button>
        )}
      </div>

      {/* ── Detected App Nudge ────────────────────────────────────────────── */}
      {detectedApp && (
        <div style={{
          background: 'rgba(16,163,127,0.07)',
          border: '1px solid rgba(16,163,127,0.22)',
          borderRadius: 10,
          padding: '12px 14px',
          display: 'flex',
          alignItems: 'flex-start',
          gap: 12,
        }}>
          <div style={{ fontSize: 22, lineHeight: 1 }}>{detectedApp.icon ?? '🖥'}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: '#10a37f' }}>
                {detectedApp.appName} detected — ready to operate
              </span>
              <button
                style={{ background: 'none', border: 'none', color: 'var(--text-muted)', fontSize: 13, cursor: 'pointer', padding: 0, lineHeight: 1 }}
                onClick={() => setDetectedApp(null)}
              >✕</button>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              {detectedApp.suggestions.slice(0, 2).join(' · ')}
            </div>
            {detectedApp.packIds.length > 0 && (
              <button
                style={{
                  marginTop: 7, background: 'rgba(16,163,127,0.12)',
                  border: '1px solid rgba(16,163,127,0.28)', borderRadius: 5,
                  color: '#10a37f', fontSize: 11, fontWeight: 700, padding: '4px 11px',
                  cursor: 'pointer', letterSpacing: '0.02em',
                }}
                onClick={() => {
                  setDetectedApp(null);
                  // Scroll to workflow packs section
                  document.getElementById('workflow-packs-section')?.scrollIntoView({ behavior: 'smooth' });
                }}
              >
                View Workflow Packs →
              </button>
            )}
          </div>
        </div>
      )}

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
                : 'Requires Pro tier — upgrade in Settings'
            }
            action={!canAssignWork ? () => onNavigate('settings') : undefined}
            actionLabel="Upgrade →"
          />

        </div>
      </div>

      {/* ── Sample Tasks Rail (A4) — scoped to detected apps ──────────────── */}
      {(() => {
        const matchedTasks = SAMPLE_TASKS.filter(task =>
          scannedApps.some(app => task.matchKeywords.test(app.name)),
        );
        const rescanBtn = (
          <button
            onClick={runCapabilityScan}
            disabled={rescanning}
            style={{
              background: 'transparent',
              border: '1px solid var(--border)',
              color: 'var(--text-muted)',
              fontSize: 10,
              fontWeight: 600,
              padding: '3px 8px',
              borderRadius: 5,
              cursor: rescanning ? 'wait' : 'pointer',
              letterSpacing: '0.04em',
              textTransform: 'uppercase' as const,
            }}
            title="Re-scan installed apps"
          >
            {rescanning ? 'Scanning…' : 'Re-scan'}
          </button>
        );

        if (matchedTasks.length === 0) {
          // Empty state — tell users the rail exists and what unlocks it
          return (
            <div style={s.section}>
              <div style={s.sectionLabelRow}>
                <span style={s.sectionLabel}>Sample Tasks</span>
                {rescanBtn}
              </div>
              <div style={{
                padding: '14px 16px',
                background: 'rgba(255,255,255,0.02)',
                border: '1px dashed var(--border)',
                borderRadius: 8,
                fontSize: 12,
                color: 'var(--text-muted)',
                lineHeight: 1.55,
              }}>
                We didn't find any pro apps on your machine yet. Install one of{' '}
                <strong style={{ color: 'var(--text-secondary)' }}>Unreal, Photoshop, Blender, Premiere, Maya, or Figma</strong>{' '}
                to unlock one-click sample tasks tailored to that app.
              </div>
            </div>
          );
        }
        return (
          <div style={s.section}>
            <div style={s.sectionLabelRow}>
              <span style={s.sectionLabel}>Try a Sample Task</span>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={s.sectionMeta}>Scoped to apps you have installed</span>
                {rescanBtn}
              </div>
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))', gap: 8 }}>
              {matchedTasks.slice(0, 6).map(task => (
                <button
                  key={task.title}
                  style={{
                    background: 'var(--bg)',
                    border: '1px solid var(--border)',
                    borderRadius: 8,
                    padding: '12px 13px',
                    textAlign: 'left',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 5,
                    transition: 'border-color 0.15s, background 0.15s',
                  }}
                  onClick={() => {
                    if (task.runWith?.kind === 'pack') {
                      // Workflow pack route — fires the same listener the
                      // council→operator bridge uses, so the pack scrolls
                      // into view and auto-starts with this goal injected.
                      window.dispatchEvent(new CustomEvent('triforge:start-pack', {
                        detail: { packId: task.runWith.packId, goal: task.prompt },
                      }));
                    } else {
                      setTaskGoal(task.prompt);
                      const el = document.getElementById('ai-task-runner-section');
                      if (el) el.scrollIntoView({ behavior: 'smooth' });
                    }
                  }}
                  onMouseEnter={(e) => { e.currentTarget.style.borderColor = '#10a37f'; }}
                  onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ fontSize: 13, color: '#10a37f' }}>{task.icon}</span>
                    <span style={{ fontSize: 10, fontWeight: 700, color: '#10a37f', letterSpacing: '0.04em', textTransform: 'uppercase' }}>
                      {task.appLabel}
                    </span>
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>{task.title}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.45 }}>
                    {task.runWith?.kind === 'pack' ? 'Click to launch workflow pack' : 'Click to load into Task Runner'}
                  </div>
                </button>
              ))}
            </div>
          </div>
        );
      })()}

      {/* ── Assign Work ────────────────────────────────────────────────────── */}
      {/*
        Two distinct task surfaces — keep them visually separate so users
        understand which one to reach for:
          • Assign Work     → background, scheduled, multi-category, no live click loop (Pro)
          • AI Task Runner  → live desktop, immediate, no scheduling (Free with daily cap)
      */}
      <div style={s.section}>
        <div style={s.sectionLabelRow}>
          <span style={s.sectionLabel}>Assign Work</span>
          <span style={s.sectionMeta}>
            Background scheduled task · Pro
          </span>
        </div>
        <p style={{
          fontSize: 11,
          color: 'var(--text-muted)',
          margin: '0 0 10px 0',
          lineHeight: 1.5,
        }}>
          Hands a long-running goal to the autonomous task engine — research, file work,
          shell commands, or multi-step plans. Runs in the background and shows up in Sessions.
          Use this when the work doesn't need to click on your live desktop.
        </p>
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
              Autonomous task assignment requires Pro tier.{' '}
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

      {/* ── AI Task Runner ─────────────────────────────────────────────────── */}
      <div id="ai-task-runner-section" style={s.section}>
        <div style={s.sectionLabelRow}>
          <span style={s.sectionLabel}>AI Task Runner</span>
          <span style={s.sectionMeta}>
            Live desktop · Sense → Plan → Act → Verify
            {tier === 'free' && ' · Free: 1 run/day'}
          </span>
        </div>
        <p style={{
          fontSize: 11,
          color: 'var(--text-muted)',
          margin: '0 0 10px 0',
          lineHeight: 1.5,
        }}>
          Drives your open app like a remote-access human — takes a screenshot,
          decides the next click, executes it, verifies, and repeats. Use this when
          you need TriForge to physically operate the UI in front of you.
        </p>
        <div style={s.workIntake}>
          <textarea
            style={s.goalInput}
            placeholder="Describe what to do in your open app — e.g. 'Export the current Premiere timeline as H.264', 'Click the Render button in Blender'…"
            value={taskGoal}
            onChange={e => { setTaskGoal(e.target.value); setTaskOutcome(null); }}
            rows={2}
            disabled={taskRunning || connectedProviders === 0}
          />
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
            <button
              style={{
                ...s.assignBtn,
                ...(!taskGoal.trim() || taskRunning || connectedProviders === 0 ? s.assignBtnDisabled : {}),
                background: taskRunning ? 'rgba(99,102,241,0.25)' : undefined,
              }}
              onClick={() => runAiTask()}
              disabled={!taskGoal.trim() || taskRunning || connectedProviders === 0}
            >
              {taskRunning ? 'Running…' : 'Run with AI'}
            </button>
          </div>
        </div>

        {connectedProviders === 0 && (
          <div style={{
            marginTop: 8,
            padding: '8px 12px',
            background: 'rgba(239,68,68,0.07)',
            border: '1px solid rgba(239,68,68,0.22)',
            borderRadius: 6,
            fontSize: 11,
            color: 'rgba(239,68,68,0.95)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
          }}>
            <span>Connect at least one AI provider to run tasks.</span>
            <button style={s.inlineLink} onClick={() => onNavigate('settings')}>Open Settings →</button>
          </div>
        )}

        {/* Live step feed */}
        {(taskRunning || taskSteps.length > 0) && (
          <div style={{
            marginTop: 10,
            background: 'rgba(0,0,0,0.15)',
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: 8,
            overflow: 'hidden',
          }}>
            {taskSteps.map((step, i) => (
              <div key={i} style={{
                display: 'flex', alignItems: 'flex-start', gap: 10,
                padding: '8px 12px',
                borderBottom: i < taskSteps.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
              }}>
                <span style={{
                  flexShrink: 0,
                  width: 20, height: 20,
                  borderRadius: '50%',
                  background: 'rgba(99,102,241,0.18)',
                  border: '1px solid rgba(99,102,241,0.35)',
                  color: '#6366f1',
                  fontSize: 9,
                  fontWeight: 800,
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  letterSpacing: '0.02em',
                }}>
                  {step.step}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(99,102,241,0.85)', marginBottom: 2, letterSpacing: '0.05em', textTransform: 'uppercase' as const }}>
                    {step.phase}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.45 }}>
                    {step.description}
                  </div>
                </div>
              </div>
            ))}
            {taskRunning && (
              <div style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                  background: '#6366f1', animation: 'none', opacity: 0.7,
                }} />
                <span style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>Working…</span>
              </div>
            )}
          </div>
        )}

        {/* Outcome */}
        {taskOutcome && (
          <div style={{
            marginTop: 10,
            padding: '10px 14px',
            borderRadius: 8,
            background: taskOutcome.outcome === 'approval_pending'
              ? 'rgba(245,158,11,0.07)'
              : taskOutcome.ok ? 'rgba(16,163,127,0.07)' : 'rgba(239,68,68,0.07)',
            border: `1px solid ${
              taskOutcome.outcome === 'approval_pending'
                ? 'rgba(245,158,11,0.28)'
                : taskOutcome.ok ? 'rgba(16,163,127,0.22)' : 'rgba(239,68,68,0.22)'}`,
          }}>
            <div style={{
              fontSize: 11, fontWeight: 700, marginBottom: 3,
              color: taskOutcome.outcome === 'approval_pending' ? '#f59e0b' : taskOutcome.ok ? '#10a37f' : '#ef4444',
            }}>
              {taskOutcome.outcome === 'approval_pending'
                ? 'Paused — approval required'
                : taskOutcome.ok ? 'Task complete' : 'Task stopped'}{' '}
              — {taskOutcome.outcome}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>
              {taskOutcome.summary}
            </div>

            {/* Canonical scoped-targeting identity — shown whenever the run
                was invoked with a targetApp. Surfaces the actual bound process
                (not the planner's element description) so the user can verify
                side-by-side mode actually engaged. */}
            {taskOutcome.scopedTargeting && (
              <div style={{
                marginTop: 10,
                padding: '8px 10px',
                borderRadius: 6,
                background: 'rgba(99,102,241,0.06)',
                border: '1px solid rgba(99,102,241,0.22)',
                fontSize: 11,
                color: 'var(--text-secondary)',
                fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace',
                lineHeight: 1.55,
              }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: '#818cf8', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 4 }}>
                  Scoped target binding
                </div>
                <div>requested: <b>{taskOutcome.scopedTargeting.requestedLabel}</b></div>
                {taskOutcome.scopedTargeting.bound ? (
                  <>
                    <div>bound process: <b>{taskOutcome.scopedTargeting.bound.processName}</b></div>
                    <div>family: {taskOutcome.scopedTargeting.bound.family}</div>
                    {taskOutcome.scopedTargeting.bound.windowTitleAtBind && (
                      <div>window at bind: "{taskOutcome.scopedTargeting.bound.windowTitleAtBind}"</div>
                    )}
                    <div>match: {taskOutcome.scopedTargeting.bound.bindingReason}{taskOutcome.scopedTargeting.bound.fuzzyMatched ? ' (fuzzy)' : ''}</div>
                  </>
                ) : (
                  <div style={{ color: '#ef4444' }}>bound process: &lt;binding failed&gt;</div>
                )}
                <div style={{ color: taskOutcome.scopedTargeting.everDegraded ? '#ef4444' : '#10a37f' }}>
                  scoped integrity: {taskOutcome.scopedTargeting.everDegraded ? 'DEGRADED (ran unscoped at some point)' : 'OK (cropped every step)'}
                  {taskOutcome.scopedTargeting.boundsFailureCount > 0 && ` — bounds failures: ${taskOutcome.scopedTargeting.boundsFailureCount}`}
                </div>
                {taskOutcome.scopedTargeting.lastFallbackReason && (
                  <div style={{ color: 'var(--text-muted)' }}>last fallback: {taskOutcome.scopedTargeting.lastFallbackReason}</div>
                )}
              </div>
            )}

            {/* Before / After visual proof */}
            {taskOutcome.ok && taskOutcome.beforeScreenshotPath && taskOutcome.afterScreenshotPath && (
              <div style={{ marginTop: 12 }}>
                <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.06em', textTransform: 'uppercase', marginBottom: 6 }}>
                  Before → After
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                  {[
                    { label: 'Before', path: taskOutcome.beforeScreenshotPath },
                    { label: 'After',  path: taskOutcome.afterScreenshotPath  },
                  ].map(({ label, path }) => (
                    <div key={label} style={{ position: 'relative' }}>
                      <div style={{ fontSize: 9, fontWeight: 700, color: label === 'After' ? '#10a37f' : 'var(--text-muted)', marginBottom: 3, letterSpacing: '0.05em', textTransform: 'uppercase' }}>
                        {label}
                      </div>
                      <img
                        src={`file://${path}`}
                        alt={label}
                        style={{ width: '100%', borderRadius: 5, border: `1px solid ${label === 'After' ? 'rgba(16,163,127,0.35)' : 'var(--border)'}`, display: 'block', objectFit: 'cover', maxHeight: 120 }}
                      />
                    </div>
                  ))}
                </div>
              </div>
            )}

            {taskOutcome.outcome === 'approval_pending' && taskPendingApprovalId && (
              <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                <button
                  style={{
                    background: 'rgba(245,158,11,0.14)',
                    border: '1px solid rgba(245,158,11,0.4)',
                    borderRadius: 6,
                    color: '#f59e0b',
                    fontSize: 11,
                    fontWeight: 700,
                    padding: '5px 14px',
                    cursor: taskRunning ? 'not-allowed' : 'pointer',
                    opacity: taskRunning ? 0.5 : 1,
                  }}
                  onClick={approveAndResume}
                  disabled={taskRunning}
                >
                  {taskRunning ? 'Running…' : 'Approve & Continue'}
                </button>
                <button
                  style={{
                    background: 'rgba(239,68,68,0.08)',
                    border: '1px solid rgba(239,68,68,0.25)',
                    borderRadius: 6,
                    color: '#ef4444',
                    fontSize: 11,
                    fontWeight: 600,
                    padding: '5px 14px',
                    cursor: 'pointer',
                  }}
                  onClick={async () => {
                    // Deny the pending operator action server-side so it doesn't
                    // linger in the approval queue for 10 minutes after cancel.
                    if (taskPendingApprovalId && tf) {
                      try {
                        const op = tf['operator'] as Record<string, (...a: unknown[]) => Promise<unknown>>;
                        await op?.denyAction?.(taskPendingApprovalId, 'Cancelled by user');
                      } catch { /* best-effort */ }
                    }
                    setTaskPendingApprovalId(null);
                    setTaskOutcome({ ok: false, summary: 'Task cancelled by user.', outcome: 'cancelled' });
                  }}
                >
                  Cancel
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Unreal Hero Flow ─────────────────────────────────────────────── */}
      <div id="hero-flow-section" style={s.section}>
        <div style={s.sectionLabelRow}>
          <span style={s.sectionLabel}>Set Up Unreal Project</span>
          <span style={s.sectionMeta}>
            Detect → Probe → Focus → Configure → Verify
          </span>
        </div>
        <p style={{
          fontSize: 11,
          color: 'var(--text-muted)',
          margin: '0 0 10px 0',
          lineHeight: 1.5,
        }}>
          Automatically detects Unreal Engine, probes the Remote Control plugin,
          focuses the editor, sets up a project template, and verifies the result
          — all in one pipeline. Uses the fastest available control path (RC API or visual).
        </p>

        {/* Template selector + trigger */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: 8,
        }}>
          <select
            value={heroFlowTemplate}
            onChange={e => setHeroFlowTemplate(e.target.value)}
            disabled={heroFlowRunning}
            style={{
              background: 'var(--bg-input)',
              border: '1px solid var(--border)',
              borderRadius: 6,
              color: 'var(--text-primary)',
              fontSize: 12,
              padding: '6px 10px',
              cursor: heroFlowRunning ? 'not-allowed' : 'pointer',
            }}
          >
            <option value="third-person">Third Person</option>
            <option value="first-person">First Person</option>
            <option value="top-down">Top Down</option>
            <option value="blank">Blank</option>
          </select>
          <button
            style={{
              ...s.assignBtn,
              ...(heroFlowRunning || connectedProviders === 0 ? s.assignBtnDisabled : {}),
              background: heroFlowRunning ? 'rgba(99,102,241,0.25)' : '#6366f1',
            }}
            onClick={startHeroFlow}
            disabled={heroFlowRunning || connectedProviders === 0}
          >
            {heroFlowRunning ? 'Running…' : 'Set Up Unreal Project'}
          </button>
        </div>

        {connectedProviders === 0 && (
          <div style={{
            marginTop: 8,
            padding: '8px 12px',
            background: 'rgba(239,68,68,0.07)',
            border: '1px solid rgba(239,68,68,0.22)',
            borderRadius: 6,
            fontSize: 11,
            color: 'rgba(239,68,68,0.95)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
          }}>
            <span>Connect at least one AI provider to run the hero flow.</span>
            <button style={s.inlineLink} onClick={() => onNavigate('settings')}>Open Settings →</button>
          </div>
        )}

        {/* Live step ledger */}
        {(heroFlowRunning || heroFlowSteps.length > 0) && (
          <div style={{
            marginTop: 10,
            background: 'rgba(0,0,0,0.15)',
            border: '1px solid rgba(255,255,255,0.06)',
            borderRadius: 8,
            overflow: 'hidden',
          }}>
            {heroFlowSteps.map((step, i) => {
              const stageColor: Record<string, string> = {
                DETECT: '#6366f1', PROBE: '#8b5cf6', FOCUS: '#f59e0b',
                CONFIGURE: '#10a37f', VERIFY: '#06b6d4', REPORT: '#10a37f',
              };
              const methodBadge: Record<string, { label: string; color: string }> = {
                rc:              { label: 'RC',     color: '#10a37f' },
                visual:          { label: 'VISUAL', color: '#f59e0b' },
                detect:          { label: 'DETECT', color: '#6366f1' },
                probe:           { label: 'PROBE',  color: '#8b5cf6' },
                mixed:           { label: 'MIXED',  color: '#06b6d4' },
                'vision-verify': { label: 'VERIFY', color: '#06b6d4' },
                failed:          { label: 'FAILED', color: '#ef4444' },
              };
              const badge = methodBadge[step.controlMethod] ?? { label: step.controlMethod, color: 'var(--text-muted)' };
              const color = stageColor[step.stage] ?? '#6366f1';
              return (
                <div key={i} style={{
                  display: 'flex', alignItems: 'flex-start', gap: 10,
                  padding: '8px 12px',
                  borderBottom: i < heroFlowSteps.length - 1 ? '1px solid rgba(255,255,255,0.04)' : 'none',
                }}>
                  {/* Stage badge */}
                  <span style={{
                    flexShrink: 0,
                    padding: '2px 7px',
                    borderRadius: 4,
                    background: `${color}18`,
                    border: `1px solid ${color}40`,
                    color,
                    fontSize: 9,
                    fontWeight: 800,
                    letterSpacing: '0.06em',
                  }}>
                    {step.stage}
                  </span>
                  {/* Content */}
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 2 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-primary)' }}>
                        {step.action}
                      </span>
                      <span style={{
                        fontSize: 9, fontWeight: 700,
                        padding: '1px 5px', borderRadius: 3,
                        background: `${badge.color}18`,
                        color: badge.color,
                        letterSpacing: '0.05em',
                      }}>
                        {badge.label}
                      </span>
                      {step.ok ? (
                        <span style={{ fontSize: 10, color: '#10a37f', fontWeight: 700 }}>OK</span>
                      ) : (
                        <span style={{ fontSize: 10, color: '#ef4444', fontWeight: 700 }}>FAIL</span>
                      )}
                    </div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.45 }}>
                      {step.detail}
                    </div>
                    {step.durationMs > 0 && (
                      <span style={{ fontSize: 10, color: 'var(--text-muted)', opacity: 0.6 }}>
                        {step.durationMs < 1000 ? `${step.durationMs}ms` : `${(step.durationMs / 1000).toFixed(1)}s`}
                      </span>
                    )}
                  </div>
                </div>
              );
            })}
            {heroFlowRunning && (
              <div style={{ padding: '8px 12px', display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  display: 'inline-block', width: 8, height: 8, borderRadius: '50%',
                  background: '#6366f1', opacity: 0.7,
                }} />
                <span style={{ fontSize: 11, color: 'var(--text-muted)', fontStyle: 'italic' }}>
                  Pipeline running — {heroFlowSteps.length} step{heroFlowSteps.length !== 1 ? 's' : ''} completed…
                </span>
              </div>
            )}
          </div>
        )}

        {/* Final result */}
        {heroFlowResult && (
          <div style={{
            marginTop: 10,
            padding: '10px 14px',
            borderRadius: 8,
            background: heroFlowResult.ok ? 'rgba(16,163,127,0.07)' : 'rgba(239,68,68,0.07)',
            border: `1px solid ${heroFlowResult.ok ? 'rgba(16,163,127,0.22)' : 'rgba(239,68,68,0.22)'}`,
          }}>
            <div style={{
              fontSize: 11, fontWeight: 700, marginBottom: 4,
              color: heroFlowResult.ok ? '#10a37f' : '#ef4444',
            }}>
              {heroFlowResult.ok ? 'Unreal Project Setup Complete' : 'Setup Failed'}
              {heroFlowResult.totalDurationMs > 0 && (
                <span style={{ fontWeight: 500, marginLeft: 8, color: 'var(--text-muted)' }}>
                  {(heroFlowResult.totalDurationMs / 1000).toFixed(1)}s total
                </span>
              )}
            </div>
            <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
              {heroFlowResult.summary}
            </div>
            {heroFlowResult.primaryControl && (
              <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>
                Primary control: <strong style={{ color: heroFlowResult.primaryControl === 'rc' ? '#10a37f' : '#f59e0b' }}>
                  {heroFlowResult.primaryControl === 'rc' ? 'Remote Control API' : heroFlowResult.primaryControl === 'visual' ? 'Visual Automation' : 'Mixed'}
                </strong>
                {heroFlowResult.projectName && (
                  <span> · Project: <strong style={{ color: 'var(--text-secondary)' }}>{heroFlowResult.projectName}</strong></span>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* ── Empty-state start guide ───────────────────────────────────────── */}
      {workflowPacks.length === 0 && activeTasks.length === 0 && !loading && (
        <div style={{
          margin: '8px 16px 0',
          padding: '16px 18px',
          background: 'var(--bg-elevated)',
          border: '1px solid var(--border)',
          borderRadius: 10,
        }}>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
            How to start a task
          </div>
          <div style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6, marginBottom: 12 }}>
            TriForge works inside your apps — just describe what you want done.
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 12 }}>
            {[
              { icon: '⬡', title: 'Unreal Engine', desc: 'Type a game idea — TriForge builds Blueprint files, compiles, and runs it', action: 'Build a survival game with health, inventory, and enemy AI in Unreal' },
              { icon: '◈', title: 'Any App', desc: 'Describe a task in plain English — TriForge sees your screen and clicks for you', action: 'Export the current Blender scene as a 1080p PNG render' },
            ].map(item => (
              <button
                key={item.title}
                style={{
                  background: 'var(--bg)',
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  padding: '10px 12px',
                  textAlign: 'left',
                  cursor: 'pointer',
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 4,
                }}
                onClick={() => {
                  const el = document.getElementById('ai-task-runner-section');
                  if (el) el.scrollIntoView({ behavior: 'smooth' });
                  // Pre-fill the task runner textarea via custom event
                  window.dispatchEvent(new CustomEvent('triforge:operator-prefill', { detail: item.action }));
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ fontSize: 14, opacity: 0.6 }}>{item.icon}</span>
                  <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-primary)' }}>{item.title}</span>
                </div>
                <span style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.4 }}>{item.desc}</span>
              </button>
            ))}
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
            Or scroll down to <strong style={{ color: 'var(--text-secondary)' }}>AI Task Runner</strong> and describe your task directly.
          </div>
        </div>
      )}

      {/* ── Workflow Packs ─────────────────────────────────────────────────── */}
      {workflowPacks.length > 0 && (
        <div id="workflow-packs-section" style={s.section}>
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
                  onStart={(targetApp, goal) => startWorkflow(pack.id, targetApp, goal)}
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

      {/* ── Live View ──────────────────────────────────────────────────────── */}
      <LiveViewPanel tf={tf} />

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
        <button style={{ ...s.utilBtn, color: 'var(--accent)', borderColor: 'var(--accent)' }} onClick={() => onNavigate('pack-builder')}>
          Pack Builder
        </button>
      </div>

    </div>
  );
}

// ── Live View Panel ───────────────────────────────────────────────────────────

interface LiveViewEntry {
  ts: number;
  text: string;
  score?: number;
}

function LiveViewPanel({ tf }: { tf: Record<string, unknown> | undefined }) {
  const [open, setOpen]                   = useState(false);
  const [screenshot, setScreenshot]       = useState<string | null>(null);
  const [capturing, setCapturing]         = useState(false);
  const [capturedAt, setCapturedAt]       = useState<number | null>(null);
  const [watcherRunning, setWatcherRunning] = useState<boolean | null>(null);
  const [log, setLog]                     = useState<LiveViewEntry[]>([]);
  const intervalRef                       = useRef<ReturnType<typeof setInterval> | null>(null);
  const unsubRef                          = useRef<(() => void) | null>(null);

  const addLog = (text: string, score?: number) => {
    setLog(prev => [{ ts: Date.now(), text, score }, ...prev].slice(0, 50));
  };

  const capture = useCallback(async () => {
    if (!tf) return;
    setCapturing(true);
    try {
      const res = await (tf['operator'] as Record<string, () => Promise<{ ok: boolean; dataUrl?: string; error?: string }>>)
        ?.screenshotBase64?.();
      if (res?.ok && res.dataUrl) {
        setScreenshot(res.dataUrl);
        setCapturedAt(Date.now());
      }
    } catch { /* best-effort */ } finally {
      setCapturing(false);
    }
  }, [tf]);

  const loadWatcherStatus = useCallback(async () => {
    if (!tf) return;
    try {
      // Use .status() not .check() — check returns a one-shot diff result
      // with no 'running' field, so the watcher dot always shows "off".
      const res = await (tf['screenWatch'] as Record<string, () => Promise<{ ok: boolean; running: boolean }>>)
        ?.status?.();
      setWatcherRunning(res?.running ?? false);
    } catch { setWatcherRunning(false); }
  }, [tf]);

  useEffect(() => {
    if (!open) {
      // Cleanup when collapsed
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
      if (unsubRef.current)    { unsubRef.current(); unsubRef.current = null; }
      return;
    }

    // Initial capture + watcher status
    capture();
    loadWatcherStatus();

    // Subscribe to screen-watch:changed events
    const screenWatchNs = tf?.['screenWatch'] as Record<string, unknown> | undefined;
    if (typeof screenWatchNs?.onChanged === 'function') {
      unsubRef.current = (screenWatchNs.onChanged as (cb: (d: { score: number; imagePath?: string }) => void) => () => void)(
        (d) => {
          addLog(`Screen changed`, d.score);
          capture();
        }
      );
    }

    // Poll for screenshot every 4s
    intervalRef.current = setInterval(() => {
      capture();
      loadWatcherStatus();
    }, 4_000);

    return () => {
      if (intervalRef.current) { clearInterval(intervalRef.current); intervalRef.current = null; }
      if (unsubRef.current)    { unsubRef.current(); unsubRef.current = null; }
    };
  }, [open, capture, loadWatcherStatus, tf]);

  return (
    <div style={s.section}>
      <div style={s.sectionLabelRow}>
        <span style={s.sectionLabel}>Live View</span>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {open && (
            <>
              <span style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: watcherRunning ? '#10a37f' : '#555' }}>
                <span style={{ width: 6, height: 6, borderRadius: '50%', background: watcherRunning ? '#10a37f' : '#555', display: 'inline-block' }} />
                {watcherRunning === null ? 'watcher …' : watcherRunning ? 'watcher active' : 'watcher off'}
              </span>
              <button
                style={{ ...s.sectionAction, opacity: capturing ? 0.5 : 1 }}
                onClick={capture}
                disabled={capturing}
              >
                {capturing ? 'Capturing…' : 'Capture now'}
              </button>
            </>
          )}
          <button style={s.sectionAction} onClick={() => setOpen(x => !x)}>
            {open ? 'Collapse ↑' : 'Expand ↓'}
          </button>
        </div>
      </div>

      {!open && (
        <p style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
          Expand to see a live screenshot feed and screen-change log.
        </p>
      )}

      {open && (
        <div style={s.liveViewBody}>
          {/* Screenshot pane */}
          <div style={s.liveViewScreenshot}>
            {screenshot ? (
              <>
                <img
                  src={screenshot}
                  alt="Current screen"
                  style={{ width: '100%', borderRadius: 6, display: 'block', border: '1px solid var(--border)' }}
                />
                {capturedAt && (
                  <div style={s.liveViewCaption}>
                    Captured {new Date(capturedAt).toLocaleTimeString()}
                    {capturing && ' · refreshing…'}
                  </div>
                )}
              </>
            ) : (
              <div style={s.liveViewPlaceholder}>
                {capturing ? 'Capturing screenshot…' : 'No screenshot yet — Screen Recording permission required.'}
              </div>
            )}
          </div>

          {/* Event log pane */}
          <div style={s.liveViewLog}>
            <div style={s.liveViewLogTitle}>Screen Events</div>
            {log.length === 0 ? (
              <div style={s.liveViewLogEmpty}>Waiting for screen changes…</div>
            ) : (
              log.map((entry, i) => (
                <div key={i} style={s.liveViewLogEntry}>
                  <span style={s.liveViewLogTime}>{new Date(entry.ts).toLocaleTimeString()}</span>
                  <span style={s.liveViewLogText}>
                    {entry.text}
                    {entry.score != null && (
                      <span style={{ color: 'var(--text-muted)', marginLeft: 4 }}>
                        ({Math.round(entry.score)}% diff)
                      </span>
                    )}
                  </span>
                </div>
              ))
            )}
          </div>
        </div>
      )}
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
  onStart: (targetApp?: string, goal?: string) => void;
  onApprove: (runId: string, approvalId: string) => void;
  onDeny: (approvalId: string) => void;
}) {
  const [packGoal, setPackGoal]           = React.useState('');
  const [showGoalInput, setShowGoalInput] = React.useState(false);

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

      {/* Goal input for script-generating packs */}
      {!isAwaitingApproval && pack.needsGoal && showGoalInput && (
        <div style={{ marginTop: 8 }}>
          <input
            type="text"
            style={{
              width: '100%',
              background: 'rgba(0,0,0,0.2)',
              border: '1px solid rgba(99,102,241,0.3)',
              borderRadius: 6,
              color: 'var(--text-primary)',
              fontSize: 12,
              padding: '6px 10px',
              outline: 'none',
              boxSizing: 'border-box' as const,
            }}
            placeholder={`What do you want to do in ${pack.name}?`}
            value={packGoal}
            onChange={e => setPackGoal(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter' && packGoal.trim()) onStart(undefined, packGoal.trim());
              if (e.key === 'Escape') { setShowGoalInput(false); setPackGoal(''); }
            }}
            autoFocus
          />
          <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
            <button
              style={{
                ...s.workflowStartBtn,
                ...(!packGoal.trim() || starting ? s.workflowStartBtnDisabled : {}),
                flex: 1,
              }}
              onClick={() => { if (packGoal.trim()) onStart(undefined, packGoal.trim()); }}
              disabled={!packGoal.trim() || starting}
            >
              {starting ? 'Starting…' : 'Run with Goal'}
            </button>
            <button
              style={{ ...s.workflowStartBtn, background: 'transparent', color: 'var(--text-muted)', border: '1px solid rgba(255,255,255,0.08)' }}
              onClick={() => { setShowGoalInput(false); setPackGoal(''); }}
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {/* Start button — hidden while awaiting approval to prevent double-starts */}
      {!isAwaitingApproval && !showGoalInput && (
        <button
          style={{
            ...s.workflowStartBtn,
            ...((!ready || starting) ? s.workflowStartBtnDisabled : {}),
          }}
          onClick={() => {
            if (pack.needsGoal) { setShowGoalInput(true); }
            else                { onStart(); }
          }}
          disabled={!ready || starting || needsTarget}
          title={!ready ? (blockers[0]?.message ?? 'Not ready') : undefined}
        >
          {starting ? 'Starting…' : pack.needsGoal ? 'Set Goal & Run' : 'Run'}
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

  // ── Live View ─────────────────────────────────────────────────────────────────
  liveViewBody: {
    display: 'flex',
    gap: 12,
    marginTop: 10,
    flexWrap: 'wrap' as const,
  },
  liveViewScreenshot: {
    flex: '1 1 320px',
    minWidth: 0,
  },
  liveViewPlaceholder: {
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    padding: '28px 16px',
    textAlign: 'center' as const,
    fontSize: 12,
    color: 'var(--text-muted)',
  },
  liveViewCaption: {
    fontSize: 10,
    color: 'var(--text-muted)',
    marginTop: 5,
    textAlign: 'right' as const,
  },
  liveViewLog: {
    flex: '0 0 200px',
    background: 'var(--bg-elevated)',
    border: '1px solid var(--border)',
    borderRadius: 6,
    padding: '10px 12px',
    overflowY: 'auto' as const,
    maxHeight: 320,
  },
  liveViewLogTitle: {
    fontSize: 10,
    fontWeight: 700,
    textTransform: 'uppercase' as const,
    letterSpacing: '0.07em',
    color: 'var(--text-muted)',
    marginBottom: 8,
  },
  liveViewLogEmpty: {
    fontSize: 11,
    color: 'var(--text-muted)',
    fontStyle: 'italic' as const,
  },
  liveViewLogEntry: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 1,
    marginBottom: 8,
    paddingBottom: 8,
    borderBottom: '1px solid var(--border)',
  },
  liveViewLogTime: {
    fontSize: 10,
    color: 'var(--text-muted)',
  },
  liveViewLogText: {
    fontSize: 12,
    color: 'var(--text-primary)',
  },
};
