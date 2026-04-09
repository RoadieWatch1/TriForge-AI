// ── MissionQueueScreen.tsx ───────────────────────────────────────────────────
//
// Phase C3 — Mission Queue / "Continue from where you left off"
//
// Surfaces:
//   • Resume candidates  — runs interrupted by app close, blocked, waiting approval
//   • Project memory     — last project the user worked on, click to continue
//   • Recent activity    — completed/failed runs from the WorkerRun store
//
// This is the daily-use loop the audit said TriForge was missing. Instead of
// opening to an empty Chat, returning users see "you have unfinished work."
//
// Reads from existing IPC:
//   window.triforge.workerRuntime.list / resumeCandidates / resume / cancel
//   window.triforge.projectMemory.last / all / forget
//
// No new main-process APIs required.

import React, { useEffect, useState, useCallback } from 'react';

// ── Types (mirror preload.ts shapes; renderer-local to avoid main-process imports)
interface WorkerRunSummary {
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

interface ProjectMemoryEntry {
  projectPath:    string;
  projectName:    string;
  lastMilestone?: string;
  lastPackId?:    string;
  prototypeGoal?: string;
  lastRunAt:      string;
}

interface WorkflowChainSummary {
  id:          string;
  name:        string;
  tagline:     string;
  description: string;
  links:       Array<{ packId: string; label: string; description: string }>;
  estimatedDurationSec?: number;
  tags?:       string[];
}

interface MissionQueueScreenProps {
  onNavigate?: (screen: string) => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function fmtRelative(ms: number): string {
  const diff = Date.now() - ms;
  if (diff < 0) return 'just now';
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);
  if (mins  < 1)   return 'just now';
  if (mins  < 60)  return `${mins}m ago`;
  if (hours < 24)  return `${hours}h ago`;
  if (days  < 7)   return `${days}d ago`;
  return new Date(ms).toLocaleDateString();
}

function statusColor(status: string): string {
  switch (status) {
    case 'completed':         return '#10b981';
    case 'running':           return '#3b82f6';
    case 'waiting_approval':  return '#f59e0b';
    case 'blocked':           return '#f97316';
    case 'failed':            return '#ef4444';
    case 'cancelled':         return '#737373';
    default:                  return '#8b8b9e';
  }
}

function statusLabel(status: string): string {
  switch (status) {
    case 'waiting_approval':  return 'Waiting on approval';
    case 'blocked':           return 'Blocked';
    case 'running':           return 'Running';
    case 'completed':         return 'Completed';
    case 'failed':            return 'Failed';
    case 'cancelled':         return 'Cancelled';
    default:                  return status;
  }
}

// ── Component ─────────────────────────────────────────────────────────────────

export function MissionQueueScreen({ onNavigate }: MissionQueueScreenProps) {
  const [resumeCandidates, setResumeCandidates] = useState<WorkerRunSummary[]>([]);
  const [recentRuns,       setRecentRuns]       = useState<WorkerRunSummary[]>([]);
  const [projects,         setProjects]         = useState<ProjectMemoryEntry[]>([]);
  const [lastSuggestion,   setLastSuggestion]   = useState<string | null>(null);
  const [chains,           setChains]           = useState<WorkflowChainSummary[]>([]);
  const [loading,          setLoading]          = useState(true);
  const [actionMessage,    setActionMessage]    = useState<string | null>(null);
  const [busyRunId,        setBusyRunId]        = useState<string | null>(null);
  const [busyChainId,      setBusyChainId]      = useState<string | null>(null);

  // ── Data load ──────────────────────────────────────────────────────────────
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const tf = window.triforge as unknown as Record<string, any>;
      const [candidates, allRuns, allProjects, lastProject, chainList] = await Promise.all([
        window.triforge.workerRuntime.resumeCandidates().catch(() => ({ ok: false, runs: [] as WorkerRunSummary[] })),
        window.triforge.workerRuntime.list().catch(() => ({ ok: false, runs: [] as WorkerRunSummary[] })),
        window.triforge.projectMemory.all().catch(() => [] as ProjectMemoryEntry[]),
        window.triforge.projectMemory.last().catch(() => ({ project: null, suggestion: null })),
        tf?.workflowChain?.list?.().catch(() => ({ ok: false, chains: [] as WorkflowChainSummary[] })) ?? Promise.resolve({ ok: false, chains: [] as WorkflowChainSummary[] }),
      ]);

      setResumeCandidates(((candidates as any).runs ?? []) as WorkerRunSummary[]);

      const runs = (((allRuns as any).runs ?? []) as WorkerRunSummary[])
        .filter(r => r.status === 'completed' || r.status === 'failed' || r.status === 'cancelled')
        .sort((a, b) => b.updatedAt - a.updatedAt)
        .slice(0, 12);
      setRecentRuns(runs);

      setProjects(((allProjects as any) ?? []) as ProjectMemoryEntry[]);
      setLastSuggestion((lastProject as any)?.suggestion ?? null);
      setChains(((chainList as any)?.chains ?? []) as WorkflowChainSummary[]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  // ── Actions ────────────────────────────────────────────────────────────────
  const handleResume = useCallback(async (runId: string) => {
    setBusyRunId(runId);
    setActionMessage(null);
    try {
      const result = await window.triforge.workerRuntime.resume(runId);
      if (result.ok) {
        setActionMessage(result.message ?? 'Run restarted from saved metadata.');
      } else {
        setActionMessage(result.message ?? 'Could not resume this run.');
      }
      await refresh();
    } catch (e) {
      setActionMessage(e instanceof Error ? e.message : 'Resume failed.');
    } finally {
      setBusyRunId(null);
    }
  }, [refresh]);

  const handleCancel = useCallback(async (runId: string) => {
    setBusyRunId(runId);
    try {
      await window.triforge.workerRuntime.cancel(runId);
      await refresh();
    } finally {
      setBusyRunId(null);
    }
  }, [refresh]);

  const handleForget = useCallback(async (projectPath: string) => {
    await window.triforge.projectMemory.forget(projectPath);
    await refresh();
  }, [refresh]);

  const handleStartChain = useCallback(async (chainId: string) => {
    setBusyChainId(chainId);
    setActionMessage(null);
    try {
      const tf = window.triforge as unknown as Record<string, any>;
      const result = await tf?.workflowChain?.start?.(chainId, {});
      if (result?.ok) {
        const chain = chains.find(c => c.id === chainId);
        const completedLinks = result.run?.linkResults?.filter((l: any) => l.status === 'completed').length ?? 0;
        const totalLinks = chain?.links.length ?? 0;
        const status = result.run?.status ?? 'completed';
        if (status === 'waiting_link_approval') {
          setActionMessage(`Chain "${chain?.name ?? chainId}" paused for approval (${completedLinks}/${totalLinks} steps done). Open the underlying run in the approval panel.`);
        } else if (status === 'failed') {
          setActionMessage(`Chain "${chain?.name ?? chainId}" failed: ${result.run?.error ?? 'unknown error'}`);
        } else {
          setActionMessage(`Chain "${chain?.name ?? chainId}" finished (${completedLinks}/${totalLinks} steps).`);
        }
      } else {
        setActionMessage(result?.error ?? 'Could not start chain.');
      }
      await refresh();
    } catch (e) {
      setActionMessage(e instanceof Error ? e.message : 'Chain start failed.');
    } finally {
      setBusyChainId(null);
    }
  }, [chains, refresh]);

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <div>
          <div style={styles.titleRow}>
            <span style={styles.titleIcon}>◈</span>
            <h1 style={styles.title}>Mission Queue</h1>
          </div>
          <p style={styles.subtitle}>
            Pick up where you left off. Interrupted runs, recent activity, and your tracked projects in one place.
          </p>
        </div>
        <button style={styles.refreshBtn} onClick={refresh} disabled={loading}>
          {loading ? 'Refreshing…' : 'Refresh'}
        </button>
      </div>

      {actionMessage && (
        <div style={styles.actionBanner}>{actionMessage}</div>
      )}

      {/* ── Section 1 — Needs your attention ─────────────────────────────────── */}
      <section style={styles.section}>
        <div style={styles.sectionHeader}>
          <h2 style={styles.sectionTitle}>Needs your attention</h2>
          <span style={styles.sectionCount}>{resumeCandidates.length}</span>
        </div>
        {resumeCandidates.length === 0 ? (
          <div style={styles.empty}>
            Nothing waiting. All recent runs ended cleanly.
          </div>
        ) : (
          <div style={styles.list}>
            {resumeCandidates.map(run => (
              <div key={run.id} style={styles.runCard}>
                <div style={styles.runMain}>
                  <div style={styles.runHeader}>
                    <span style={{ ...styles.statusPill, background: statusColor(run.status) }}>
                      {statusLabel(run.status)}
                    </span>
                    <span style={styles.runMeta}>
                      {run.packId ?? run.workflowId ?? 'Direct AI task'} · {fmtRelative(run.updatedAt)}
                    </span>
                  </div>
                  <div style={styles.runGoal}>{run.goal || 'Untitled run'}</div>
                  {run.blocker && (
                    <div style={styles.blocker}>
                      <span style={styles.blockerLabel}>{run.blocker.kind}:</span> {run.blocker.message}
                    </div>
                  )}
                  <div style={styles.runFooter}>
                    Step {run.currentStepIndex + 1} · source: {run.source}
                  </div>
                </div>
                <div style={styles.runActions}>
                  <button
                    style={styles.primaryBtn}
                    disabled={busyRunId === run.id}
                    onClick={() => handleResume(run.id)}
                  >
                    {busyRunId === run.id ? '…' : 'Resume'}
                  </button>
                  <button
                    style={styles.ghostBtn}
                    disabled={busyRunId === run.id}
                    onClick={() => handleCancel(run.id)}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Section 1.5 — Multi-app chains ─────────────────────────────────── */}
      <section style={styles.section}>
        <div style={styles.sectionHeader}>
          <h2 style={styles.sectionTitle}>Multi-app missions</h2>
          <span style={styles.sectionCount}>{chains.length}</span>
        </div>
        {chains.length === 0 ? (
          <div style={styles.empty}>
            No chains available. Chains compose multiple workflow packs into one mission.
          </div>
        ) : (
          <div style={styles.list}>
            {chains.map(chain => (
              <div key={chain.id} style={styles.chainCard}>
                <div style={styles.runMain}>
                  <div style={styles.chainName}>{chain.name}</div>
                  <div style={styles.chainTagline}>{chain.tagline}</div>
                  <div style={styles.chainSteps}>
                    {chain.links.map((link, i) => (
                      <span key={i} style={styles.chainStep}>
                        <span style={styles.chainStepNum}>{i + 1}</span>
                        {link.label}
                        {i < chain.links.length - 1 && <span style={styles.chainArrow}>→</span>}
                      </span>
                    ))}
                  </div>
                  {chain.estimatedDurationSec && (
                    <div style={styles.runFooter}>~{Math.round(chain.estimatedDurationSec / 60)} min · {chain.links.length} steps</div>
                  )}
                </div>
                <div style={styles.runActions}>
                  <button
                    style={styles.primaryBtn}
                    disabled={busyChainId === chain.id}
                    onClick={() => handleStartChain(chain.id)}
                  >
                    {busyChainId === chain.id ? 'Starting…' : 'Run chain'}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Section 2 — Tracked projects ────────────────────────────────────── */}
      <section style={styles.section}>
        <div style={styles.sectionHeader}>
          <h2 style={styles.sectionTitle}>Continue a project</h2>
          <span style={styles.sectionCount}>{projects.length}</span>
        </div>
        {lastSuggestion && (
          <div style={styles.suggestion} dangerouslySetInnerHTML={{ __html: lastSuggestion.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>') }} />
        )}
        {projects.length === 0 ? (
          <div style={styles.empty}>
            No projects tracked yet. Run a workflow pack against an Unreal/Photoshop project and TriForge will remember it here.
          </div>
        ) : (
          <div style={styles.list}>
            {projects.slice(0, 8).map(p => (
              <div key={p.projectPath} style={styles.projectCard}>
                <div style={styles.runMain}>
                  <div style={styles.projectName}>{p.projectName}</div>
                  <div style={styles.projectPath} title={p.projectPath}>{p.projectPath}</div>
                  <div style={styles.runFooter}>
                    {p.lastMilestone ? <>Last milestone: <strong>{p.lastMilestone}</strong> · </> : null}
                    {p.lastPackId ? <>{p.lastPackId} · </> : null}
                    {fmtRelative(new Date(p.lastRunAt).getTime())}
                  </div>
                  {p.prototypeGoal && (
                    <div style={styles.projectGoal}>"{p.prototypeGoal}"</div>
                  )}
                </div>
                <div style={styles.runActions}>
                  <button
                    style={styles.primaryBtn}
                    onClick={() => onNavigate?.('operate')}
                    title="Open Operate to run the next pack on this project"
                  >
                    Open in Operate
                  </button>
                  <button
                    style={styles.ghostBtn}
                    onClick={() => handleForget(p.projectPath)}
                    title="Remove this project from memory"
                  >
                    Forget
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      {/* ── Section 3 — Recent activity ─────────────────────────────────────── */}
      <section style={styles.section}>
        <div style={styles.sectionHeader}>
          <h2 style={styles.sectionTitle}>Recent activity</h2>
          <span style={styles.sectionCount}>{recentRuns.length}</span>
        </div>
        {recentRuns.length === 0 ? (
          <div style={styles.empty}>
            No completed runs yet. Open Operate to launch your first workflow pack.
          </div>
        ) : (
          <div style={styles.list}>
            {recentRuns.map(run => (
              <div key={run.id} style={styles.recentCard}>
                <span style={{ ...styles.statusDot, background: statusColor(run.status) }} />
                <div style={styles.recentMain}>
                  <div style={styles.recentGoal}>{run.goal || 'Untitled run'}</div>
                  <div style={styles.recentMeta}>
                    {run.packId ?? run.workflowId ?? 'Direct AI task'} · {statusLabel(run.status)} · {fmtRelative(run.updatedAt)}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  container: {
    padding:    '32px 40px',
    height:     '100%',
    overflowY:  'auto',
    color:      '#e5e5ea',
    fontFamily: 'system-ui, -apple-system, sans-serif',
  },
  header: {
    display:        'flex',
    justifyContent: 'space-between',
    alignItems:     'flex-start',
    marginBottom:   28,
    gap:            16,
  },
  titleRow: {
    display:    'flex',
    alignItems: 'center',
    gap:        12,
  },
  titleIcon: {
    fontSize: 28,
    color:    '#3b82f6',
  },
  title: {
    fontSize:   24,
    fontWeight: 700,
    margin:     0,
    color:      '#f5f5f7',
  },
  subtitle: {
    margin:    '6px 0 0 40px',
    color:     '#8b8b9e',
    fontSize:  13,
    maxWidth:  640,
  },
  refreshBtn: {
    padding:      '8px 14px',
    background:   '#1a1a1f',
    border:       '1px solid #2a2a32',
    borderRadius: 6,
    color:        '#e5e5ea',
    fontSize:     12,
    cursor:       'pointer',
  },
  actionBanner: {
    background:   '#1e293b',
    border:       '1px solid #334155',
    color:        '#bfdbfe',
    padding:      '10px 14px',
    borderRadius: 6,
    fontSize:     13,
    marginBottom: 16,
  },
  section: {
    marginBottom: 32,
  },
  sectionHeader: {
    display:      'flex',
    alignItems:   'baseline',
    gap:          10,
    marginBottom: 12,
    borderBottom: '1px solid #1f1f25',
    paddingBottom: 8,
  },
  sectionTitle: {
    fontSize:   14,
    fontWeight: 600,
    color:      '#c5c5d0',
    margin:     0,
    textTransform: 'uppercase',
    letterSpacing: 0.6,
  },
  sectionCount: {
    fontSize:   11,
    color:      '#6b6b7a',
    background: '#16161b',
    padding:    '2px 8px',
    borderRadius: 10,
  },
  empty: {
    padding:      '20px 16px',
    background:   '#0f0f13',
    border:       '1px dashed #2a2a32',
    borderRadius: 8,
    color:        '#737380',
    fontSize:     13,
    fontStyle:    'italic',
  },
  list: {
    display:        'flex',
    flexDirection:  'column',
    gap:            10,
  },
  runCard: {
    display:        'flex',
    gap:            16,
    background:     '#0f0f13',
    border:         '1px solid #1f1f25',
    borderRadius:   8,
    padding:        16,
    alignItems:     'flex-start',
  },
  runMain: {
    flex: 1,
    minWidth: 0,
  },
  runHeader: {
    display:    'flex',
    alignItems: 'center',
    gap:        10,
    marginBottom: 8,
  },
  statusPill: {
    fontSize:    10,
    fontWeight:  600,
    padding:     '3px 8px',
    borderRadius: 4,
    color:       '#0a0a0d',
    textTransform: 'uppercase',
    letterSpacing: 0.4,
  },
  runMeta: {
    fontSize: 11,
    color:    '#737380',
  },
  runGoal: {
    fontSize:   14,
    color:      '#f0f0f5',
    fontWeight: 500,
    marginBottom: 6,
    overflow:   'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap',
  },
  blocker: {
    background:    '#2a1a14',
    border:        '1px solid #5a2a18',
    color:         '#fbbf24',
    padding:       '6px 10px',
    borderRadius:  4,
    fontSize:      11,
    marginBottom:  6,
  },
  blockerLabel: {
    fontWeight: 600,
    color:      '#f59e0b',
  },
  runFooter: {
    fontSize: 11,
    color:    '#6b6b7a',
  },
  runActions: {
    display:        'flex',
    flexDirection:  'column',
    gap:            6,
    minWidth:       100,
  },
  primaryBtn: {
    padding:      '7px 14px',
    background:   '#3b82f6',
    border:       'none',
    borderRadius: 5,
    color:        '#fff',
    fontSize:     12,
    fontWeight:   600,
    cursor:       'pointer',
  },
  ghostBtn: {
    padding:      '7px 14px',
    background:   'transparent',
    border:       '1px solid #2a2a32',
    borderRadius: 5,
    color:        '#8b8b9e',
    fontSize:     12,
    cursor:       'pointer',
  },
  suggestion: {
    background:   '#0f1a2e',
    border:       '1px solid #1e3a5f',
    borderLeft:   '3px solid #3b82f6',
    color:        '#bfdbfe',
    padding:      '10px 14px',
    borderRadius: 4,
    fontSize:     13,
    marginBottom: 12,
  },
  projectCard: {
    display:        'flex',
    gap:            16,
    background:     '#0f0f13',
    border:         '1px solid #1f1f25',
    borderRadius:   8,
    padding:        16,
    alignItems:     'flex-start',
  },
  projectName: {
    fontSize:   15,
    color:      '#f0f0f5',
    fontWeight: 600,
    marginBottom: 4,
  },
  projectPath: {
    fontSize:    11,
    color:       '#6b6b7a',
    fontFamily:  'ui-monospace, "SF Mono", Menlo, monospace',
    marginBottom: 6,
    overflow:    'hidden',
    textOverflow: 'ellipsis',
    whiteSpace:  'nowrap',
  },
  projectGoal: {
    fontSize:  12,
    color:     '#a0a0b0',
    marginTop: 6,
    fontStyle: 'italic',
  },
  recentCard: {
    display:      'flex',
    gap:          12,
    background:   '#0c0c10',
    border:       '1px solid #16161b',
    borderRadius: 6,
    padding:      '10px 14px',
    alignItems:   'center',
  },
  statusDot: {
    width:        8,
    height:       8,
    borderRadius: '50%',
    flexShrink:   0,
  },
  recentMain: {
    flex:     1,
    minWidth: 0,
  },
  recentGoal: {
    fontSize:     13,
    color:        '#d4d4dc',
    overflow:     'hidden',
    textOverflow: 'ellipsis',
    whiteSpace:   'nowrap',
  },
  recentMeta: {
    fontSize: 11,
    color:    '#6b6b7a',
    marginTop: 2,
  },
  chainCard: {
    display:        'flex',
    gap:            16,
    background:     '#0f0f13',
    border:         '1px solid #1f1f25',
    borderLeft:     '3px solid #8b5cf6',
    borderRadius:   8,
    padding:        16,
    alignItems:     'flex-start',
  },
  chainName: {
    fontSize:   15,
    color:      '#f0f0f5',
    fontWeight: 600,
    marginBottom: 4,
  },
  chainTagline: {
    fontSize: 12,
    color:    '#a0a0b0',
    marginBottom: 10,
  },
  chainSteps: {
    display:    'flex',
    flexWrap:   'wrap',
    alignItems: 'center',
    gap:        4,
    marginBottom: 8,
  },
  chainStep: {
    display:      'inline-flex',
    alignItems:   'center',
    gap:          6,
    fontSize:     11,
    color:        '#c5c5d0',
    background:   '#16161b',
    padding:      '4px 10px 4px 4px',
    borderRadius: 12,
  },
  chainStepNum: {
    display:        'inline-flex',
    alignItems:     'center',
    justifyContent: 'center',
    width:          18,
    height:         18,
    borderRadius:   '50%',
    background:     '#8b5cf6',
    color:          '#fff',
    fontSize:       10,
    fontWeight:     700,
  },
  chainArrow: {
    color:    '#5b5b6a',
    fontSize: 11,
    margin:   '0 2px 0 6px',
  },
};
