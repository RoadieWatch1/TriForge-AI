import React, { useState, useEffect } from 'react';
import { SYSTEM_REGISTRY } from '../core/AppState';
import type { SystemCard } from '../core/AppState';

// ── Types ───────────────────────────────────────────────────────────────────

interface DashboardProps {
  tier: string;
  onNavigate: (screen: string) => void;
}

interface HealthData {
  runningTasks: number;
  queuedTasks: number;
  pendingApprovals: number;
}

interface AuditEntry {
  id?: string;
  ts?: number;
  type?: string;
  summary?: string;
  [key: string]: unknown;
}

interface ScheduledJob {
  id: string;
  label?: string;
  goal?: string;
  cronExpr?: string;
  runAt?: number;
  nextRun?: number;
  [key: string]: unknown;
}

// ── Mode strip config ────────────────────────────────────────────────────────

const MODES: Array<{ label: string; screen: string }> = [
  { label: 'Home',     screen: 'dashboard' },
  { label: 'Files',    screen: 'files' },
  { label: 'Inbox',    screen: 'inbox' },
];

// ── Dashboard Component ──────────────────────────────────────────────────────

export function Dashboard({ onNavigate }: DashboardProps) {
  const [health, setHealth] = useState<HealthData | null>(null);
  const [auditLog, setAuditLog] = useState<AuditEntry[]>([]);
  const [jobs, setJobs] = useState<ScheduledJob[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const tf = (window as any).triforge;

    Promise.all([
      tf.agentEngine.getHealth().catch(() => null),
      tf.audit.getRecent(8).catch(() => ({ entries: [] })),
      tf.scheduler.listJobs().catch(() => ({ jobs: [] })),
    ]).then(([h, a, j]) => {
      if (h) setHealth(h);
      setAuditLog(a?.entries ?? []);
      setJobs(j?.jobs ?? []);
      setLoading(false);
    });
  }, []);

  const now = new Date();
  const dateStr = now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' });
  const timeStr = now.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });

  const pendingApprovals = health?.pendingApprovals ?? 0;
  const runningTasks    = health?.runningTasks ?? 0;
  const todayJobs       = jobs.length;

  const suggestion = pendingApprovals > 0
    ? `${pendingApprovals} approval${pendingApprovals > 1 ? 's' : ''} waiting — review before proceeding.`
    : runningTasks > 0
    ? `${runningTasks} task${runningTasks > 1 ? 's' : ''} running in background.`
    : todayJobs > 0
    ? `${todayJobs} scheduled job${todayJobs > 1 ? 's' : ''} configured. System is active.`
    : 'No active tasks. Select a mode to begin.';

  return (
    <div style={styles.root}>
      {/* Header */}
      <div style={styles.header}>
        <div style={styles.headerLeft}>
          <p style={styles.appTitle}>Triforge Agent OS</p>
          <p style={styles.dateText}>{dateStr} — {timeStr}</p>
        </div>
        <div style={styles.healthBadge}>
          <span style={{
            ...styles.healthDot,
            background: loading ? '#fbbf24' : runningTasks > 0 ? '#34d399' : 'rgba(255,255,255,0.2)',
          }} />
          <span style={styles.healthLabel}>
            {loading ? 'Connecting' : runningTasks > 0 ? 'Active' : 'Idle'}
          </span>
        </div>
      </div>

      {/* Daily Intent Strip */}
      <div style={styles.intentStrip}>
        <div style={styles.intentStat}>
          <span style={styles.intentNum}>{loading ? '—' : todayJobs}</span>
          <span style={styles.intentLabel}>Scheduled</span>
        </div>
        <div style={styles.intentDivider} />
        <div style={styles.intentStat}>
          <span style={{
            ...styles.intentNum,
            color: pendingApprovals > 0 ? '#fbbf24' : 'rgba(255,255,255,0.7)',
          }}>{loading ? '—' : pendingApprovals}</span>
          <span style={styles.intentLabel}>Approvals</span>
        </div>
        <div style={styles.intentDivider} />
        <div style={styles.intentStat}>
          <span style={{
            ...styles.intentNum,
            color: runningTasks > 0 ? '#34d399' : 'rgba(255,255,255,0.7)',
          }}>{loading ? '—' : runningTasks}</span>
          <span style={styles.intentLabel}>Running</span>
        </div>
        <div style={styles.intentDivider} />
        <p style={styles.intentSuggestion}>{suggestion}</p>
      </div>

      {/* Mode Strip */}
      <div style={styles.modeStrip}>
        {MODES.map(m => (
          <button
            key={m.screen}
            style={styles.modeBtn}
            onClick={() => onNavigate(m.screen)}
          >
            {m.label}
          </button>
        ))}
      </div>

      {/* Main grid */}
      <div style={styles.mainGrid}>
        {/* Left column */}
        <div style={styles.leftCol}>

          {/* Today's Schedule */}
          <div style={styles.panel}>
            <p style={styles.panelLabel}>Today's Schedule</p>
            {loading ? (
              <p style={styles.emptyText}>Loading…</p>
            ) : jobs.length === 0 ? (
              <p style={styles.emptyText}>No scheduled jobs. Set one up in Automate mode.</p>
            ) : (
              <div style={styles.jobList}>
                {jobs.slice(0, 5).map(job => (
                  <div key={job.id} style={styles.jobRow}>
                    <div style={styles.jobDot} />
                    <div style={styles.jobInfo}>
                      <p style={styles.jobLabel}>{job.label ?? job.goal ?? 'Scheduled task'}</p>
                      <p style={styles.jobMeta}>
                        {job.cronExpr ?? (job.runAt ? new Date(job.runAt).toLocaleTimeString() : 'Recurring')}
                      </p>
                    </div>
                  </div>
                ))}
                {jobs.length > 5 && (
                  <p style={styles.moreText}>+{jobs.length - 5} more</p>
                )}
              </div>
            )}
          </div>

          {/* Pending Approvals */}
          {pendingApprovals > 0 && (
            <div style={{ ...styles.panel, borderColor: 'rgba(251,191,36,0.2)' }}>
              <p style={styles.panelLabel}>Pending Approvals</p>
              <div style={styles.approvalRow}>
                <span style={styles.approvalNum}>{pendingApprovals}</span>
                <span style={styles.approvalText}>task approval{pendingApprovals > 1 ? 's' : ''} require your review</span>
                <button style={styles.approvalBtn} onClick={() => onNavigate('agenthq')}>
                  Review
                </button>
              </div>
            </div>
          )}
        </div>

        {/* Right column — System Log */}
        <div style={styles.rightCol}>
          <div style={styles.panel}>
            <p style={styles.panelLabel}>System Log</p>
            {loading ? (
              <p style={styles.emptyText}>Loading…</p>
            ) : auditLog.length === 0 ? (
              <p style={styles.emptyText}>No entries yet. Activity appears here as agents run.</p>
            ) : (
              <div style={styles.logList}>
                {auditLog.map((entry, i) => (
                  <div key={entry.id ?? i} style={styles.logRow}>
                    <span style={styles.logTime}>
                      {entry.ts ? new Date(entry.ts).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' }) : '—'}
                    </span>
                    <span style={styles.logSummary}>
                      {entry.summary ?? entry.type ?? 'System event'}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ── ModeShell ────────────────────────────────────────────────────────────────
// Reusable layout for all mode screens. Imported by mode files.
// Children are the SystemTile components for that mode.

interface ModeShellProps {
  title: string;
  subtitle: string;
  children: React.ReactNode;
  extra?: React.ReactNode;
}

export function ModeShell({ title, subtitle, children, extra }: ModeShellProps) {
  return (
    <div style={shellStyles.root}>
      <div style={shellStyles.header}>
        <p style={shellStyles.title}>{title}</p>
        <p style={shellStyles.subtitle}>{subtitle}</p>
      </div>
      <div style={shellStyles.systemGrid}>
        {children}
      </div>
      {extra && <div style={shellStyles.extra}>{extra}</div>}
    </div>
  );
}

// ── SystemTile ───────────────────────────────────────────────────────────────
// Individual system card. Imported by mode files that need custom onAction.

interface SystemTileProps {
  system: SystemCard;
  onAction?: () => void;
  actionLabel?: string;
  children?: React.ReactNode;  // inline content for active systems
}

export function SystemTile({ system, onAction, actionLabel, children }: SystemTileProps) {
  const isActive = system.status === 'active';
  const isAvailable = system.status === 'available';
  const isComingSoon = system.status === 'coming_soon';

  const badgeStyle = isActive
    ? tileStyles.badgeActive
    : isAvailable
    ? tileStyles.badgeAvailable
    : tileStyles.badgeComingSoon;

  const badgeText = isActive ? 'ACTIVE' : isAvailable ? 'AVAILABLE' : 'COMING SOON';

  return (
    <div style={tileStyles.card}>
      <div style={tileStyles.cardTop}>
        <div style={tileStyles.cardInfo}>
          <p style={tileStyles.cardName}>{system.name}</p>
          <p style={tileStyles.cardDesc}>{system.description}</p>
        </div>
        <span style={badgeStyle}>{badgeText}</span>
      </div>
      {children && <div style={tileStyles.cardContent}>{children}</div>}
      {!children && (
        <button
          style={isComingSoon ? tileStyles.actionBtnDisabled : tileStyles.actionBtn}
          disabled={isComingSoon}
          onClick={isComingSoon ? undefined : onAction}
        >
          {isComingSoon ? 'Coming Soon' : (actionLabel ?? 'Launch')}
        </button>
      )}
    </div>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
    padding: '20px 20px 40px',
    overflowY: 'auto',
    height: '100%',
    boxSizing: 'border-box',
  },
  header: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
  },
  headerLeft: {
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
  },
  appTitle: {
    fontSize: 16,
    fontWeight: 700,
    color: 'rgba(255,255,255,0.9)',
    margin: 0,
    letterSpacing: '0.3px',
  },
  dateText: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.35)',
    margin: 0,
  },
  healthBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 20,
    padding: '4px 10px',
  },
  healthDot: {
    width: 7,
    height: 7,
    borderRadius: '50%',
    flexShrink: 0,
  },
  healthLabel: {
    fontSize: 10,
    fontWeight: 600,
    color: 'rgba(255,255,255,0.5)',
    letterSpacing: '0.5px',
    textTransform: 'uppercase',
  },
  intentStrip: {
    display: 'flex',
    alignItems: 'center',
    gap: 0,
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 8,
    overflow: 'hidden',
    minHeight: 52,
  },
  intentStat: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: 2,
    padding: '10px 18px',
    flexShrink: 0,
  } as React.CSSProperties,
  intentNum: {
    fontSize: 18,
    fontWeight: 700,
    color: 'rgba(255,255,255,0.7)',
    lineHeight: 1,
  },
  intentLabel: {
    fontSize: 8,
    fontWeight: 600,
    color: 'rgba(255,255,255,0.3)',
    textTransform: 'uppercase',
    letterSpacing: '0.6px',
    whiteSpace: 'nowrap',
  },
  intentDivider: {
    width: 1,
    height: 32,
    background: 'rgba(255,255,255,0.06)',
    flexShrink: 0,
  },
  intentSuggestion: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.4)',
    margin: 0,
    padding: '0 16px',
    lineHeight: 1.5,
    flex: 1,
  },
  modeStrip: {
    display: 'flex',
    gap: 6,
    overflowX: 'auto',
    paddingBottom: 2,
  },
  modeBtn: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 6,
    color: 'rgba(255,255,255,0.55)',
    fontSize: 11,
    fontWeight: 600,
    padding: '6px 14px',
    cursor: 'pointer',
    whiteSpace: 'nowrap',
    letterSpacing: '0.3px',
    flexShrink: 0,
  },
  mainGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr',
    gap: 12,
    flex: 1,
  },
  leftCol: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  rightCol: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  },
  panel: {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: 8,
    padding: '12px 14px',
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  } as React.CSSProperties,
  panelLabel: {
    fontSize: 9,
    fontWeight: 700,
    color: 'rgba(255,255,255,0.35)',
    textTransform: 'uppercase',
    letterSpacing: '0.8px',
    margin: 0,
  },
  emptyText: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.25)',
    margin: 0,
    lineHeight: 1.5,
  },
  jobList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  } as React.CSSProperties,
  jobRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 10,
  },
  jobDot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    background: '#34d399',
    flexShrink: 0,
    marginTop: 4,
  },
  jobInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: 1,
  } as React.CSSProperties,
  jobLabel: {
    fontSize: 12,
    color: 'rgba(255,255,255,0.7)',
    margin: 0,
    fontWeight: 500,
  },
  jobMeta: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.3)',
    margin: 0,
    fontFamily: 'monospace',
  },
  moreText: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.25)',
    margin: 0,
  },
  approvalRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  approvalNum: {
    fontSize: 22,
    fontWeight: 700,
    color: '#fbbf24',
    lineHeight: 1,
  },
  approvalText: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.5)',
    flex: 1,
  },
  approvalBtn: {
    background: 'rgba(251,191,36,0.1)',
    border: '1px solid rgba(251,191,36,0.25)',
    borderRadius: 5,
    color: '#fbbf24',
    fontSize: 11,
    fontWeight: 600,
    padding: '5px 12px',
    cursor: 'pointer',
  },
  logList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  } as React.CSSProperties,
  logRow: {
    display: 'flex',
    gap: 8,
    alignItems: 'baseline',
  },
  logTime: {
    fontSize: 9,
    color: 'rgba(255,255,255,0.25)',
    flexShrink: 0,
    fontFamily: 'monospace',
    letterSpacing: '0.3px',
  },
  logSummary: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.5)',
    lineHeight: 1.4,
  },
};

const shellStyles: Record<string, React.CSSProperties> = {
  root: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
    padding: '20px 20px 40px',
    overflowY: 'auto',
    height: '100%',
    boxSizing: 'border-box',
  },
  header: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    marginBottom: 4,
  },
  title: {
    fontSize: 15,
    fontWeight: 700,
    color: 'rgba(255,255,255,0.9)',
    margin: 0,
    letterSpacing: '0.2px',
  },
  subtitle: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.4)',
    margin: 0,
    lineHeight: 1.5,
  },
  systemGrid: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
  },
  extra: {
    display: 'flex',
    flexDirection: 'column',
    gap: 10,
    marginTop: 4,
  },
};

const tileStyles: Record<string, React.CSSProperties> = {
  card: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 8,
    padding: '14px 16px',
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
  } as React.CSSProperties,
  cardTop: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    gap: 12,
  },
  cardInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
    flex: 1,
  } as React.CSSProperties,
  cardName: {
    fontSize: 13,
    fontWeight: 700,
    color: 'rgba(255,255,255,0.85)',
    margin: 0,
    letterSpacing: '0.1px',
  },
  cardDesc: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.45)',
    margin: 0,
    lineHeight: 1.5,
  },
  badgeActive: {
    fontSize: 8,
    fontWeight: 700,
    letterSpacing: '0.6px',
    textTransform: 'uppercase',
    color: '#34d399',
    background: 'rgba(52,211,153,0.12)',
    border: '1px solid rgba(52,211,153,0.25)',
    borderRadius: 3,
    padding: '3px 7px',
    whiteSpace: 'nowrap',
    flexShrink: 0,
    alignSelf: 'flex-start',
  } as React.CSSProperties,
  badgeAvailable: {
    fontSize: 8,
    fontWeight: 700,
    letterSpacing: '0.6px',
    textTransform: 'uppercase',
    color: '#60a5fa',
    background: 'rgba(96,165,250,0.1)',
    border: '1px solid rgba(96,165,250,0.22)',
    borderRadius: 3,
    padding: '3px 7px',
    whiteSpace: 'nowrap',
    flexShrink: 0,
    alignSelf: 'flex-start',
  } as React.CSSProperties,
  badgeComingSoon: {
    fontSize: 8,
    fontWeight: 700,
    letterSpacing: '0.6px',
    textTransform: 'uppercase',
    color: 'rgba(255,255,255,0.25)',
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.08)',
    borderRadius: 3,
    padding: '3px 7px',
    whiteSpace: 'nowrap',
    flexShrink: 0,
    alignSelf: 'flex-start',
  } as React.CSSProperties,
  cardContent: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  } as React.CSSProperties,
  actionBtn: {
    background: 'rgba(255,255,255,0.06)',
    border: '1px solid rgba(255,255,255,0.12)',
    borderRadius: 5,
    color: 'rgba(255,255,255,0.7)',
    fontSize: 11,
    fontWeight: 600,
    padding: '7px 14px',
    cursor: 'pointer',
    letterSpacing: '0.2px',
    alignSelf: 'flex-start',
  } as React.CSSProperties,
  actionBtnDisabled: {
    background: 'rgba(255,255,255,0.02)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: 5,
    color: 'rgba(255,255,255,0.2)',
    fontSize: 11,
    fontWeight: 600,
    padding: '7px 14px',
    cursor: 'not-allowed',
    letterSpacing: '0.2px',
    alignSelf: 'flex-start',
  } as React.CSSProperties,
};
