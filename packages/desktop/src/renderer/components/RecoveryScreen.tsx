import React, { useState, useEffect, useCallback } from 'react';

// ── Types (mirrored from main — no shared type import in renderer) ─────────────

interface ValidationIssue {
  severity:   'error' | 'warn' | 'info';
  field:      string;
  message:    string;
  repairable: boolean;
}

interface ValidationResult {
  valid:         boolean;
  issues:        ValidationIssue[];
  checkedAt:     number;
  repairedCount: number;
}

interface StoreSnapshot {
  id:        string;
  label:     string;
  createdAt: number;
  trigger:   string;
}

interface MigrationRecord {
  version:   number;
  name:      string;
  appliedAt: number;
  success:   boolean;
  error?:    string;
}

interface ServiceIncident {
  serviceId:   string;
  label:       string;
  crashCount:  number;
  lastCrashAt: number;
  disabled:    boolean;
  suggestion:  string;
}

// ── Main component ─────────────────────────────────────────────────────────────

export function RecoveryScreen() {
  const [tab, setTab] = useState<'backup' | 'snapshots' | 'health' | 'migrations' | 'incidents'>('backup');

  return (
    <div style={s.page}>
      <div style={s.pageHeader}>
        <h2 style={s.pageTitle}>Recovery & Maintenance</h2>
        <p style={s.pageSubtitle}>Backup, restore, store validation, migrations, and crash recovery.</p>
      </div>

      {/* Tab bar */}
      <div style={s.tabBar}>
        {(['backup', 'snapshots', 'health', 'migrations', 'incidents'] as const).map(t => (
          <button
            key={t}
            style={{ ...s.tab, ...(tab === t ? s.tabActive : {}) }}
            onClick={() => setTab(t)}
          >
            {TAB_LABELS[t]}
          </button>
        ))}
      </div>

      <div style={s.tabContent}>
        {tab === 'backup'     && <BackupTab />}
        {tab === 'snapshots'  && <SnapshotsTab />}
        {tab === 'health'     && <HealthTab />}
        {tab === 'migrations' && <MigrationsTab />}
        {tab === 'incidents'  && <IncidentsTab />}
      </div>
    </div>
  );
}

const TAB_LABELS: Record<string, string> = {
  backup:     'Backup / Restore',
  snapshots:  'Snapshots',
  health:     'Store Health',
  migrations: 'Migrations',
  incidents:  'Crash Guard',
};

// ── Backup / Restore tab ──────────────────────────────────────────────────────

function BackupTab() {
  const [lastBackupAt, setLastBackupAt] = useState<number | null>(null);
  const [status,       setStatus]       = useState<string | null>(null);
  const [busy,         setBusy]         = useState(false);

  useEffect(() => {
    window.triforge.recovery.getLastBackupAt().then(setLastBackupAt).catch(() => {});
  }, []);

  const doBackup = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const r = await window.triforge.recovery.createBackup();
      if (r.ok) {
        setStatus(`Backup saved to: ${r.path}`);
        setLastBackupAt(Date.now());
      } else {
        setStatus(`Backup failed: ${r.error}`);
      }
    } finally { setBusy(false); }
  };

  const doRestore = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const r = await window.triforge.recovery.restoreBackup();
      if (r.ok) {
        setStatus(`Restored backup${r.label ? ` "${r.label}"` : ''} from ${r.createdAt ? new Date(r.createdAt).toLocaleString() : 'unknown date'}. A pre-restore snapshot was created.`);
      } else {
        setStatus(r.error === 'Cancelled' ? null : `Restore failed: ${r.error}`);
      }
    } finally { setBusy(false); }
  };

  return (
    <div style={s.section}>
      <p style={s.sectionDesc}>
        Export a snapshot of all TriForge configuration — workspace, runbooks, packs, integration settings, permissions, and memory — as a portable JSON file. API keys and credentials are <strong>never included</strong>.
      </p>

      <InfoRow label="Last backup" value={lastBackupAt ? new Date(lastBackupAt).toLocaleString() : 'Never'} />

      <div style={s.btnRow}>
        <ActionBtn label="Backup Now" onClick={doBackup} busy={busy} primary />
        <ActionBtn label="Restore from File" onClick={doRestore} busy={busy} />
      </div>

      {status && <StatusBanner text={status} />}

      <div style={s.noteBox}>
        <div style={s.noteTitle}>What is included</div>
        <ul style={s.noteList}>
          <li>Workspace config, members, and integration settings</li>
          <li>Runbooks and pack registry</li>
          <li>Trusted signers and pack trust policy</li>
          <li>Automation recipe states</li>
          <li>Shared context (repos, channels, projects)</li>
          <li>Dispatch settings (port, network mode, public URL)</li>
          <li>Permissions, user profile, and recent memory (last 100)</li>
        </ul>
        <div style={s.noteTitle}>What is NOT included</div>
        <ul style={s.noteList}>
          <li>API keys (OpenAI, Claude, Grok) — stored in OS keychain</li>
          <li>Integration tokens (Slack, GitHub, Jira, Linear…)</li>
          <li>Session PIN hash</li>
          <li>License key</li>
        </ul>
      </div>
    </div>
  );
}

// ── Snapshots tab ─────────────────────────────────────────────────────────────

function SnapshotsTab() {
  const [snapshots, setSnapshots]   = useState<StoreSnapshot[]>([]);
  const [busy,      setBusy]        = useState<string | null>(null);
  const [status,    setStatus]      = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setSnapshots(await window.triforge.recovery.listSnapshots()); } catch { /* ok */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  const createManual = async () => {
    setBusy('create');
    try {
      await window.triforge.recovery.createSnapshot('manual', 'Manual snapshot');
      setStatus('Snapshot created.');
      await load();
    } finally { setBusy(null); }
  };

  const rollback = async (id: string) => {
    if (!window.confirm('Roll back to this snapshot? The current state will be saved as a new snapshot first.')) return;
    setBusy(id);
    try {
      const r = await window.triforge.recovery.rollbackSnapshot(id);
      if (r.ok) { setStatus('Rollback applied.'); await load(); }
      else       setStatus(`Rollback failed: ${r.error}`);
    } finally { setBusy(null); }
  };

  const del = async (id: string) => {
    if (!window.confirm('Delete this snapshot?')) return;
    try {
      await window.triforge.recovery.deleteSnapshot(id);
      await load();
    } catch { /* ok */ }
  };

  return (
    <div style={s.section}>
      <p style={s.sectionDesc}>
        Snapshots are restore points created automatically before major mutations (pack installs, policy changes, restores). You can also create one manually. Up to 5 snapshots are kept.
      </p>

      <div style={s.btnRow}>
        <ActionBtn label="Create Snapshot Now" onClick={createManual} busy={busy === 'create'} primary />
      </div>

      {status && <StatusBanner text={status} />}

      {snapshots.length === 0 ? (
        <EmptyState message="No snapshots yet. Create one manually or trigger a pack install." />
      ) : (
        <div style={s.list}>
          {snapshots.map(snap => (
            <div key={snap.id} style={s.row}>
              <div style={s.rowBody}>
                <span style={s.rowLabel}>{snap.label}</span>
                <span style={s.rowMeta}>
                  {new Date(snap.createdAt).toLocaleString()} — trigger: {snap.trigger}
                </span>
              </div>
              <button style={s.warnBtn} onClick={() => rollback(snap.id)} disabled={!!busy}>
                {busy === snap.id ? '…' : 'Rollback'}
              </button>
              <button style={s.ghostBtn} onClick={() => del(snap.id)} disabled={!!busy}>Delete</button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Store Health tab ──────────────────────────────────────────────────────────

function HealthTab() {
  const [result, setResult] = useState<ValidationResult | null>(null);
  const [busy,   setBusy]   = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const validate = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const r = await window.triforge.recovery.validateStore();
      setResult(r);
    } finally { setBusy(false); }
  };

  const repair = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const r = await window.triforge.recovery.repairStore();
      setResult(r);
      setStatus(r.repairedCount > 0
        ? `${r.repairedCount} issue${r.repairedCount !== 1 ? 's' : ''} repaired.`
        : 'No repairable issues found.');
    } finally { setBusy(false); }
  };

  const SEVERITY_COLOR: Record<string, string> = { error: '#ef4444', warn: '#f59e0b', info: 'var(--text-muted)' };
  const SEVERITY_ICON:  Record<string, string> = { error: '✕', warn: '◉', info: '○' };

  return (
    <div style={s.section}>
      <p style={s.sectionDesc}>
        Validates every field in the TriForge store for type correctness, missing entries, and constraint violations. Safe issues can be repaired automatically.
      </p>

      <div style={s.btnRow}>
        <ActionBtn label="Validate Store"    onClick={validate} busy={busy} primary />
        <ActionBtn label="Validate & Repair" onClick={repair}   busy={busy} />
      </div>

      {status && <StatusBanner text={status} />}

      {result && (
        <>
          <div style={s.scoreRow}>
            <span style={{ color: result.valid ? '#10a37f' : '#ef4444', fontWeight: 700 }}>
              {result.valid ? '✓ Store valid' : '✕ Issues found'}
            </span>
            <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>
              Checked {new Date(result.checkedAt).toLocaleTimeString()}
            </span>
          </div>

          {result.issues.length === 0 ? (
            <EmptyState message="No issues found — store is healthy." />
          ) : (
            <div style={s.list}>
              {result.issues.map((issue, i) => (
                <div key={i} style={s.row}>
                  <span style={{ color: SEVERITY_COLOR[issue.severity], fontSize: 11, flexShrink: 0 }}>
                    {SEVERITY_ICON[issue.severity]}
                  </span>
                  <div style={s.rowBody}>
                    <span style={s.rowLabel}>{issue.field}</span>
                    <span style={s.rowMeta}>{issue.message}</span>
                  </div>
                  {issue.repairable && (
                    <span style={{ fontSize: 10, color: 'var(--accent)', flexShrink: 0 }}>auto-fixable</span>
                  )}
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Migrations tab ────────────────────────────────────────────────────────────

function MigrationsTab() {
  const [history,        setHistory]        = useState<MigrationRecord[]>([]);
  const [schemaVersion,  setSchemaVersion]  = useState<number>(0);
  const [busy,           setBusy]           = useState(false);
  const [status,         setStatus]         = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [h, v] = await Promise.all([
        window.triforge.recovery.getMigrationHistory(),
        window.triforge.recovery.getSchemaVersion(),
      ]);
      setHistory(h);
      setSchemaVersion(v);
    } catch { /* ok */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  const runMigrations = async () => {
    setBusy(true);
    setStatus(null);
    try {
      const r = await window.triforge.recovery.runMigrations();
      if (r.errors.length > 0) {
        setStatus(`${r.ran} applied, ${r.errors.length} failed: ${r.errors.join('; ')}`);
      } else if (r.ran === 0) {
        setStatus('All migrations are already up to date.');
      } else {
        setStatus(`${r.ran} migration${r.ran !== 1 ? 's' : ''} applied successfully.`);
      }
      await load();
    } finally { setBusy(false); }
  };

  return (
    <div style={s.section}>
      <p style={s.sectionDesc}>
        Schema migrations ensure the store format stays compatible with new TriForge versions. They run automatically at startup. You can also trigger them manually here.
      </p>

      <InfoRow label="Current schema version" value={`v${schemaVersion}`} />

      <div style={s.btnRow}>
        <ActionBtn label="Run Pending Migrations" onClick={runMigrations} busy={busy} primary />
      </div>

      {status && <StatusBanner text={status} />}

      {history.length === 0 ? (
        <EmptyState message="No migration history. Migrations run automatically on startup." />
      ) : (
        <div style={s.list}>
          {history.map((rec, i) => (
            <div key={i} style={s.row}>
              <span style={{ color: rec.success ? '#10a37f' : '#ef4444', fontSize: 11, flexShrink: 0 }}>
                {rec.success ? '●' : '✕'}
              </span>
              <div style={s.rowBody}>
                <span style={s.rowLabel}>v{rec.version} — {rec.name}</span>
                <span style={s.rowMeta}>
                  {new Date(rec.appliedAt).toLocaleString()}
                  {rec.error && <span style={{ color: '#ef4444' }}> — {rec.error}</span>}
                </span>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Incidents tab ─────────────────────────────────────────────────────────────

function IncidentsTab() {
  const [incidents, setIncidents] = useState<ServiceIncident[]>([]);
  const [busy,      setBusy]      = useState<string | null>(null);

  const load = useCallback(async () => {
    try { setIncidents(await window.triforge.recovery.getIncidents()); } catch { /* ok */ }
  }, []);

  useEffect(() => { load(); }, [load]);

  const reset = async (serviceId: string) => {
    setBusy(serviceId);
    try {
      await window.triforge.recovery.resetIncident(serviceId);
      await load();
    } finally { setBusy(null); }
  };

  return (
    <div style={s.section}>
      <p style={s.sectionDesc}>
        TriForge monitors background services (Dispatch, webhooks, control plane, messaging adapters) and records crash incidents. Services that crash 3+ times are automatically disabled until manually reset here.
      </p>

      {incidents.length === 0 ? (
        <EmptyState message="No incidents recorded — all services are healthy." />
      ) : (
        <div style={s.list}>
          {incidents.map(inc => (
            <div key={inc.serviceId} style={s.row}>
              <span style={{ color: inc.disabled ? '#ef4444' : '#f59e0b', fontSize: 11, flexShrink: 0 }}>
                {inc.disabled ? '✕' : '◉'}
              </span>
              <div style={s.rowBody}>
                <span style={s.rowLabel}>
                  {inc.label}
                  {inc.disabled && <span style={{ color: '#ef4444', marginLeft: 8, fontWeight: 400, fontSize: 11 }}>DISABLED</span>}
                </span>
                <span style={s.rowMeta}>
                  {inc.crashCount} crash{inc.crashCount !== 1 ? 'es' : ''} — last {new Date(inc.lastCrashAt).toLocaleString()}
                </span>
                <span style={{ ...s.rowMeta, color: 'var(--text-secondary)' }}>{inc.suggestion}</span>
              </div>
              <button
                style={s.actionBtn}
                onClick={() => reset(inc.serviceId)}
                disabled={busy === inc.serviceId}
              >
                {busy === inc.serviceId ? '…' : 'Reset'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Shared sub-components ─────────────────────────────────────────────────────

function ActionBtn({ label, onClick, busy, primary }: { label: string; onClick: () => void; busy?: boolean; primary?: boolean }) {
  return (
    <button
      style={{ ...s.btn, ...(primary ? s.btnPrimary : {}), ...(busy ? s.btnDisabled : {}) }}
      onClick={onClick}
      disabled={busy}
    >
      {busy ? 'Working…' : label}
    </button>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div style={s.infoRow}>
      <span style={s.infoLabel}>{label}</span>
      <span style={s.infoValue}>{value}</span>
    </div>
  );
}

function StatusBanner({ text }: { text: string }) {
  return <div style={s.statusBanner}>{text}</div>;
}

function EmptyState({ message }: { message: string }) {
  return <div style={s.emptyState}>{message}</div>;
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  page: {
    padding: '24px 28px', overflowY: 'auto', height: '100%',
  },
  pageHeader: { marginBottom: 20 },
  pageTitle:  { fontSize: 17, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 4px' },
  pageSubtitle: { fontSize: 12, color: 'var(--text-secondary)', margin: 0 },

  tabBar: {
    display: 'flex', gap: 4, marginBottom: 20,
    borderBottom: '1px solid var(--border)', paddingBottom: 1,
  },
  tab: {
    height: 30, padding: '0 14px',
    background: 'transparent', border: 'none',
    borderRadius: '5px 5px 0 0', cursor: 'pointer',
    fontSize: 12, color: 'var(--text-secondary)',
  },
  tabActive: {
    background: 'var(--surface)',
    color: 'var(--text-primary)', fontWeight: 600,
    borderBottom: '2px solid var(--accent)',
  },
  tabContent: { flex: 1 },

  section: {},
  sectionDesc: {
    fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.6,
    margin: '0 0 16px',
  },

  btnRow: { display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' as const },
  btn: {
    height: 30, padding: '0 14px',
    background: 'transparent', border: '1px solid var(--border)',
    borderRadius: 5, color: 'var(--text-secondary)', fontSize: 12,
    cursor: 'pointer',
  },
  btnPrimary: {
    background: 'var(--accent)', border: 'none',
    color: '#fff', fontWeight: 600,
  },
  btnDisabled: { opacity: 0.5, cursor: 'not-allowed' },

  statusBanner: {
    padding: '8px 12px', borderRadius: 5, marginBottom: 14,
    background: 'rgba(99,102,241,0.07)',
    border: '1px solid rgba(99,102,241,0.25)',
    fontSize: 12, color: 'var(--text-primary)',
  },

  infoRow: {
    display: 'flex', gap: 12, alignItems: 'center',
    padding: '6px 0', borderBottom: '1px solid var(--border)',
    marginBottom: 8,
  },
  infoLabel: { fontSize: 12, color: 'var(--text-muted)', minWidth: 160 },
  infoValue:  { fontSize: 12, color: 'var(--text-primary)', fontWeight: 500 },

  noteBox: {
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 7, padding: '12px 14px', marginTop: 16,
  },
  noteTitle: { fontSize: 11, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4, marginTop: 8 },
  noteList:  { margin: '0 0 4px', paddingLeft: 16, fontSize: 11, color: 'var(--text-secondary)', lineHeight: 1.8 },

  list: { display: 'flex', flexDirection: 'column', gap: 4 },
  row:  {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '10px 12px',
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 6,
  },
  rowBody:  { flex: 1, display: 'flex', flexDirection: 'column', gap: 2 },
  rowLabel: { fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' },
  rowMeta:  { fontSize: 11, color: 'var(--text-muted)' },

  scoreRow: {
    display: 'flex', alignItems: 'center', gap: 16,
    marginBottom: 12, fontSize: 13,
  },

  actionBtn: {
    height: 24, padding: '0 10px',
    background: 'transparent', border: '1px solid var(--accent)',
    borderRadius: 4, color: 'var(--accent)', fontSize: 11,
    cursor: 'pointer', flexShrink: 0,
  },
  warnBtn: {
    height: 24, padding: '0 10px',
    background: 'transparent', border: '1px solid #f59e0b',
    borderRadius: 4, color: '#f59e0b', fontSize: 11,
    cursor: 'pointer', flexShrink: 0,
  },
  ghostBtn: {
    height: 24, padding: '0 10px',
    background: 'transparent', border: '1px solid var(--border)',
    borderRadius: 4, color: 'var(--text-muted)', fontSize: 11,
    cursor: 'pointer', flexShrink: 0,
  },

  emptyState: {
    padding: '32px 0', textAlign: 'center',
    fontSize: 12, color: 'var(--text-muted)',
  },
};
