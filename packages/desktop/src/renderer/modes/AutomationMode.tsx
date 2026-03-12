import React, { useEffect, useState } from 'react';
import { ModeShell, SystemTile } from '../ui/Dashboard';
import { SYSTEM_REGISTRY } from '../core/AppState';

interface Props {
  onNavigate: (screen: string) => void;
}

interface Job {
  id: string;
  label?: string;
  goal?: string;
  category?: string;
  cron?: string;
  runAt?: number;
  lastRun?: number | null;
  status?: string;
}

interface AuditEntry {
  id?: string;
  ts?: number;
  type?: string;
  action?: string;
  detail?: string;
  [key: string]: unknown;
}

export function AutomationMode({ onNavigate }: Props) {
  const systems = SYSTEM_REGISTRY.filter(s => s.modes.includes('automation'));
  const [jobs, setJobs] = useState<Job[]>([]);
  const [auditEntries, setAuditEntries] = useState<AuditEntry[]>([]);
  const [cancelling, setCancelling] = useState<string | null>(null);

  useEffect(() => {
    window.triforge.scheduler.listJobs().then(res => {
      if (res.jobs) setJobs(res.jobs as Job[]);
    }).catch(() => {});

    window.triforge.audit.getRecent(5).then(res => {
      if (res.entries) setAuditEntries(res.entries as AuditEntry[]);
    }).catch(() => {});
  }, []);

  const handleCancel = async (jobId: string) => {
    setCancelling(jobId);
    try {
      await window.triforge.scheduler.cancelJob(jobId);
      setJobs(prev => prev.filter(j => j.id !== jobId));
    } catch {
      // ignore
    } finally {
      setCancelling(null);
    }
  };

  const formatTime = (ts?: number | null) => {
    if (!ts) return '—';
    return new Date(ts).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  };

  const extra = (
    <div style={styles.extraRoot}>
      {/* Scheduled jobs */}
      <div style={styles.section}>
        <div style={styles.sectionHeaderRow}>
          <p style={styles.sectionLabel}>Scheduled Jobs</p>
          <button
            style={styles.linkBtn}
            onClick={() => onNavigate('agenthq')}
          >
            View Task Queue
          </button>
        </div>
        {jobs.length === 0 ? (
          <p style={styles.emptyNote}>No scheduled jobs. Use the Scheduler Engine to create recurring tasks.</p>
        ) : (
          <div style={styles.jobList}>
            {jobs.map(job => (
              <div key={job.id} style={styles.jobRow}>
                <div style={styles.jobInfo}>
                  <span style={styles.jobLabel}>{job.label || job.goal || job.id}</span>
                  <span style={styles.jobMeta}>
                    {job.cron ? `cron: ${job.cron}` : job.runAt ? `once: ${formatTime(job.runAt)}` : ''}
                    {job.lastRun ? ` · last: ${formatTime(job.lastRun)}` : ''}
                  </span>
                </div>
                <button
                  style={styles.cancelBtn}
                  onClick={() => handleCancel(job.id)}
                  disabled={cancelling === job.id}
                >
                  {cancelling === job.id ? 'Cancelling...' : 'Cancel'}
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Audit log */}
      <div style={styles.section}>
        <p style={styles.sectionLabel}>Recent Activity</p>
        {auditEntries.length === 0 ? (
          <p style={styles.emptyNote}>No recent activity recorded.</p>
        ) : (
          <div style={styles.auditList}>
            {auditEntries.map((entry, i) => (
              <div key={entry.id ?? i} style={styles.auditRow}>
                <span style={styles.auditTime}>{formatTime(entry.ts)}</span>
                <span style={styles.auditText}>
                  {entry.action || entry.type || JSON.stringify(entry).slice(0, 60)}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <ModeShell
      title="Automation Mode"
      subtitle="Schedule and execute recurring tasks — autonomous, time-based operations."
      extra={extra}
    >
      {systems.map(s => (
        <SystemTile
          key={s.id}
          system={s}
          onAction={() => onNavigate('agenthq')}
          actionLabel="View Queue"
        />
      ))}
    </ModeShell>
  );
}

const styles: Record<string, React.CSSProperties> = {
  extraRoot: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  section: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  sectionHeaderRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sectionLabel: {
    fontSize: 9,
    fontWeight: 700,
    color: 'rgba(255,255,255,0.3)',
    textTransform: 'uppercase',
    letterSpacing: '0.8px',
    margin: 0,
  },
  linkBtn: {
    background: 'transparent',
    border: 'none',
    color: '#60a5fa',
    fontSize: 10,
    fontWeight: 600,
    cursor: 'pointer',
    padding: 0,
    textDecoration: 'underline',
    textUnderlineOffset: 2,
  },
  jobList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  jobRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '8px 10px',
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: 6,
  },
  jobInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  jobLabel: {
    fontSize: 11,
    fontWeight: 600,
    color: 'rgba(255,255,255,0.65)',
  },
  jobMeta: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.3)',
    fontFamily: 'monospace',
  },
  cancelBtn: {
    background: 'rgba(255,80,80,0.08)',
    border: '1px solid rgba(255,80,80,0.2)',
    borderRadius: 5,
    color: 'rgba(255,130,130,0.7)',
    fontSize: 10,
    fontWeight: 600,
    padding: '4px 10px',
    cursor: 'pointer',
  },
  auditList: {
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
  },
  auditRow: {
    display: 'flex',
    gap: 8,
    alignItems: 'flex-start',
    padding: '4px 0',
    borderBottom: '1px solid rgba(255,255,255,0.04)',
  },
  auditTime: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.2)',
    whiteSpace: 'nowrap',
    flexShrink: 0,
  },
  auditText: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.45)',
    lineHeight: 1.5,
  },
  emptyNote: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.2)',
    margin: 0,
    lineHeight: 1.6,
  },
};
