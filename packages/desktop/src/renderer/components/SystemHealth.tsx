import React, { useState, useEffect, useCallback, useRef } from 'react';

interface HealthItem {
  id: string;
  label: string;
  category: string;
  status: 'ok' | 'warn' | 'error' | 'unknown';
  detail: string;
  action?: { label: string; screen?: string };
}

interface SystemHealthProps {
  onNavigate: (screen: string) => void;
}

export function SystemHealth({ onNavigate }: SystemHealthProps) {
  const [items,     setItems]     = useState<HealthItem[]>([]);
  const [loading,   setLoading]   = useState(true);
  const [lastCheck, setLastCheck] = useState<number | null>(null);
  const mountedRef = React.useRef(true);

  const runCheck = useCallback(async () => {
    if (!mountedRef.current) return;
    setLoading(true);
    try {
      const result: HealthItem[] = [];

      // ── AI Providers ───────────────────────────────────────────────────────
      try {
        const keys = await window.triforge.keys.status();
        const providerNames: Record<string, string> = { openai: 'OpenAI', claude: 'Claude', grok: 'Grok' };
        const connected = Object.entries(keys).filter(([, v]) => v);
        result.push({
          id: 'providers',
          label: 'AI Providers',
          category: 'Core',
          status: connected.length === 3 ? 'ok' : connected.length > 0 ? 'warn' : 'error',
          detail: connected.length === 3
            ? 'All three providers connected — full consensus mode active'
            : connected.length === 0
              ? 'No AI providers connected — add API keys in Settings'
              : `${connected.map(([k]) => providerNames[k] ?? k).join(', ')} connected (${connected.length}/3)`,
          action: connected.length < 3 ? { label: 'Add keys', screen: 'settings' } : undefined,
        });
      } catch {
        result.push({ id: 'providers', label: 'AI Providers', category: 'Core', status: 'unknown', detail: 'Could not check provider status' });
      }

      // ── GitHub ─────────────────────────────────────────────────────────────
      try {
        const gh = await window.triforge.github.testConnection();
        result.push({
          id: 'github',
          label: 'GitHub',
          category: 'Integrations',
          status: gh.ok ? 'ok' : 'warn',
          detail: gh.ok
            ? `Connected${gh.user ? ` as @${gh.user}` : ''}`
            : gh.error ?? 'Not connected — set a Personal Access Token in Settings',
          action: !gh.ok ? { label: 'Connect', screen: 'settings' } : undefined,
        });
      } catch {
        result.push({ id: 'github', label: 'GitHub', category: 'Integrations', status: 'unknown', detail: 'Not configured' });
      }

      // ── Slack ──────────────────────────────────────────────────────────────
      try {
        const sl = await window.triforge.slack.status();
        const slConnected = sl.connected ?? sl.ok ?? false;
        result.push({
          id: 'slack',
          label: 'Slack',
          category: 'Integrations',
          status: slConnected ? 'ok' : 'warn',
          detail: slConnected
            ? `Connected${sl.workspaceName ? ` to ${sl.workspaceName}` : ''}`
            : 'Not connected — add bot token in Settings',
          action: !slConnected ? { label: 'Connect', screen: 'settings' } : undefined,
        });
      } catch {
        result.push({ id: 'slack', label: 'Slack', category: 'Integrations', status: 'unknown', detail: 'Not configured' });
      }

      // ── Jira ───────────────────────────────────────────────────────────────
      try {
        const jr = await window.triforge.jira.status();
        result.push({
          id: 'jira',
          label: 'Jira',
          category: 'Integrations',
          status: jr.connected ? 'ok' : 'warn',
          detail: jr.connected
            ? `Connected to ${jr.host ?? 'Jira instance'}`
            : 'Not connected — configure in Settings',
          action: !jr.connected ? { label: 'Connect', screen: 'settings' } : undefined,
        });
      } catch {
        result.push({ id: 'jira', label: 'Jira', category: 'Integrations', status: 'unknown', detail: 'Not configured' });
      }

      // ── Linear ─────────────────────────────────────────────────────────────
      try {
        const ln = await window.triforge.linear.status();
        result.push({
          id: 'linear',
          label: 'Linear',
          category: 'Integrations',
          status: ln.connected ? 'ok' : 'warn',
          detail: ln.connected
            ? `Connected${ln.workspace ? ` to ${ln.workspace}` : ''}`
            : 'Not connected — add API key in Settings',
          action: !ln.connected ? { label: 'Connect', screen: 'settings' } : undefined,
        });
      } catch {
        result.push({ id: 'linear', label: 'Linear', category: 'Integrations', status: 'unknown', detail: 'Not configured' });
      }

      // ── Dispatch server ────────────────────────────────────────────────────
      try {
        const ds = await window.triforge.dispatch.status();
        result.push({
          id: 'dispatch',
          label: 'Dispatch Server',
          category: 'Remote Access',
          status: ds.running ? 'ok' : 'warn',
          detail: ds.running
            ? `Running — ${ds.deviceCount ?? 0} device${ds.deviceCount !== 1 ? 's' : ''} paired${ds.networkMode === 'public' ? ' (public URL)' : ''}`
            : 'Not running — start in Phone Link or Settings',
          action: !ds.running ? { label: 'Configure', screen: 'phonelink' } : undefined,
        });
      } catch {
        result.push({ id: 'dispatch', label: 'Dispatch Server', category: 'Remote Access', status: 'unknown', detail: 'Status unavailable' });
      }

      // ── Runbook packs ──────────────────────────────────────────────────────
      try {
        const packs = await window.triforge.pack.list();
        const total = packs?.packs?.length ?? 0;
        const untrusted = packs?.packs?.filter((p: { trusted?: boolean }) => !p.trusted)?.length ?? 0;
        result.push({
          id: 'packs',
          label: 'Runbook Packs',
          category: 'Automation',
          status: total === 0 ? 'warn' : untrusted > 0 ? 'warn' : 'ok',
          detail: total === 0
            ? 'No packs installed — import a starter pack in Automate'
            : untrusted > 0
              ? `${total} pack${total !== 1 ? 's' : ''} installed, ${untrusted} untrusted`
              : `${total} pack${total !== 1 ? 's' : ''} installed, all trusted`,
          action: total === 0 ? { label: 'Browse', screen: 'automation' } : undefined,
        });
      } catch {
        result.push({ id: 'packs', label: 'Runbook Packs', category: 'Automation', status: 'unknown', detail: 'Could not load pack list' });
      }

      // ── Permissions ────────────────────────────────────────────────────────
      try {
        const perms = await window.triforge.permissions.get();
        const granted = perms.filter((p: { granted: boolean }) => p.granted).length;
        result.push({
          id: 'permissions',
          label: 'Permissions',
          category: 'Core',
          status: granted === 0 ? 'warn' : 'ok',
          detail: `${granted} / ${perms.length} permissions granted`,
          action: granted === 0 ? { label: 'Review', screen: 'settings' } : undefined,
        });
      } catch {
        result.push({ id: 'permissions', label: 'Permissions', category: 'Core', status: 'unknown', detail: 'Could not load permissions' });
      }

      // ── Session lock ───────────────────────────────────────────────────────
      try {
        const auth = await window.triforge.auth.status();
        result.push({
          id: 'session_lock',
          label: 'Session Lock',
          category: 'Security',
          status: auth.hasPin ? 'ok' : 'warn',
          detail: auth.hasPin
            ? `Enabled — user: ${auth.username}`
            : 'Not set — add a PIN in Settings to protect access',
          action: !auth.hasPin ? { label: 'Enable', screen: 'settings' } : undefined,
        });
      } catch {
        result.push({ id: 'session_lock', label: 'Session Lock', category: 'Security', status: 'unknown', detail: 'Could not check auth status' });
      }

      if (!mountedRef.current) return;
      setItems(result);
      setLastCheck(Date.now());
    } finally {
      if (mountedRef.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    runCheck();
    return () => { mountedRef.current = false; };
  }, [runCheck]);

  // Group by category
  const categories = Array.from(new Set(items.map(i => i.category)));
  const countByStatus = (s: HealthItem['status']) => items.filter(i => i.status === s).length;
  const okCount    = countByStatus('ok');
  const warnCount  = countByStatus('warn');
  const errorCount = countByStatus('error');

  return (
    <div style={s.page}>
      {/* Header */}
      <div style={s.pageHeader}>
        <div>
          <h2 style={s.pageTitle}>System Health</h2>
          <p style={s.pageSubtitle}>
            Status of all integrations, services, and configuration items.
            {lastCheck && <span style={{ color: 'var(--text-muted)' }}> — Last checked {new Date(lastCheck).toLocaleTimeString()}</span>}
          </p>
        </div>
        <button style={s.refreshBtn} onClick={runCheck} disabled={loading}>
          {loading ? 'Checking…' : 'Refresh'}
        </button>
      </div>

      {/* Score banner */}
      {!loading && (
        <div style={s.scoreBanner}>
          <ScorePill count={okCount}    label="Healthy"  color="#10a37f" />
          <ScorePill count={warnCount}  label="Warnings" color="#f59e0b" />
          <ScorePill count={errorCount} label="Errors"   color="#ef4444" />
        </div>
      )}

      {loading ? (
        <div style={s.loadingMsg}>Running health checks…</div>
      ) : (
        categories.map(cat => (
          <div key={cat} style={s.section}>
            <div style={s.sectionLabel}>{cat}</div>
            {items.filter(i => i.category === cat).map(item => (
              <HealthRow key={item.id} item={item} onNavigate={onNavigate} />
            ))}
          </div>
        ))
      )}

      <MachineContextPanel />
    </div>
  );
}

// ── ScorePill ─────────────────────────────────────────────────────────────────

function ScorePill({ count, label, color }: { count: number; label: string; color: string }) {
  return (
    <div style={{ ...s.scorePill, borderColor: count > 0 ? color : 'var(--border)', opacity: count === 0 ? 0.4 : 1 }}>
      <span style={{ color, fontWeight: 700, fontSize: 18 }}>{count}</span>
      <span style={{ color: 'var(--text-muted)', fontSize: 11 }}>{label}</span>
    </div>
  );
}

// ── HealthRow ─────────────────────────────────────────────────────────────────

function HealthRow({ item, onNavigate }: { item: HealthItem; onNavigate: (s: string) => void }) {
  const COLOR: Record<HealthItem['status'], string> = {
    ok:      '#10a37f',
    warn:    '#f59e0b',
    error:   '#ef4444',
    unknown: 'var(--text-muted)',
  };
  const ICON: Record<HealthItem['status'], string> = {
    ok: '●', warn: '◉', error: '✕', unknown: '○',
  };

  return (
    <div style={s.row}>
      <span style={{ ...s.statusDot, color: COLOR[item.status] }}>{ICON[item.status]}</span>
      <div style={s.rowBody}>
        <span style={s.rowLabel}>{item.label}</span>
        <span style={s.rowDetail}>{item.detail}</span>
      </div>
      {item.action && item.action.screen && (
        <button style={s.actionBtn} onClick={() => onNavigate(item.action!.screen!)}>
          {item.action.label}
        </button>
      )}
    </div>
  );
}

// ── MachineContextPanel ───────────────────────────────────────────────────────
// Section 4 — Goal 3: Controlled Exposure Layer
// Read-only. Fetches once on mount. No polling. No actions.

type MachineContext = {
  system: { os: string; platform: string };
  apps: Array<{ name: string; path: string; present: boolean }>;
  files: { desktop: string[]; documents: string[] };
  error?: string;
};

function MachineContextPanel() {
  const [ctx,     setCtx]     = useState<MachineContext | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed,  setFailed]  = useState(false);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const result = await window.triforge.machine.getContext();
      if (!mounted.current) return;
      if (!result || result.error) { setFailed(true); setCtx(null); }
      else setCtx(result);
    } catch {
      if (mounted.current) setFailed(true);
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    load();
    return () => { mounted.current = false; };
  }, [load]);

  return (
    <div style={s.section}>
      <div style={{ ...s.sectionLabel, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <span>Machine Environment</span>
        <button style={s.refreshBtn} onClick={load} disabled={loading}>
          {loading ? 'Loading…' : 'Refresh'}
        </button>
      </div>

      {loading && (
        <div style={s.mcRow}>
          <span style={s.mcMuted}>Reading machine context…</span>
        </div>
      )}

      {!loading && failed && (
        <div style={s.mcRow}>
          <span style={s.mcMuted}>Machine context unavailable right now.</span>
        </div>
      )}

      {!loading && !failed && ctx && (
        <>
          {/* System */}
          <div style={s.mcRow}>
            <span style={s.mcLabel}>System</span>
            <span style={s.mcValue}>{ctx.system.os}</span>
            <span style={s.mcSub}>{ctx.system.platform}</span>
          </div>

          {/* Apps */}
          <div style={s.mcBlock}>
            <span style={s.mcBlockLabel}>Detected Apps</span>
            {ctx.apps.length === 0
              ? <span style={s.mcEmpty}>No apps detected</span>
              : ctx.apps.map(app => (
                  <div key={app.name} style={s.mcItem}>
                    <span style={s.mcItemName}>{app.name}</span>
                    <span style={s.mcItemSub}>{app.path}</span>
                  </div>
                ))
            }
          </div>

          {/* Desktop */}
          <div style={s.mcBlock}>
            <span style={s.mcBlockLabel}>Desktop</span>
            {ctx.files.desktop.length === 0
              ? <span style={s.mcEmpty}>No Desktop items found</span>
              : <span style={s.mcFileList}>{ctx.files.desktop.join('  ·  ')}</span>
            }
          </div>

          {/* Documents */}
          <div style={s.mcBlock}>
            <span style={s.mcBlockLabel}>Documents</span>
            {ctx.files.documents.length === 0
              ? <span style={s.mcEmpty}>No Documents items found</span>
              : <span style={s.mcFileList}>{ctx.files.documents.join('  ·  ')}</span>
            }
          </div>
        </>
      )}
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  page: {
    padding: '24px 28px', overflowY: 'auto', height: '100%',
  },
  pageHeader: {
    display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
    marginBottom: 16,
  },
  pageTitle: {
    fontSize: 17, fontWeight: 700, color: 'var(--text-primary)',
    margin: '0 0 4px',
  },
  pageSubtitle: {
    fontSize: 12, color: 'var(--text-secondary)', margin: 0,
  },
  refreshBtn: {
    height: 30, padding: '0 14px',
    background: 'transparent', border: '1px solid var(--border)',
    borderRadius: 5, color: 'var(--text-secondary)', fontSize: 12,
    cursor: 'pointer', flexShrink: 0,
  },

  scoreBanner: {
    display: 'flex', gap: 12, marginBottom: 24,
  },
  scorePill: {
    display: 'flex', flexDirection: 'column', alignItems: 'center',
    gap: 2, padding: '10px 20px',
    border: '1px solid', borderRadius: 8,
    minWidth: 80,
  },

  loadingMsg: {
    color: 'var(--text-muted)', fontSize: 13, padding: '40px 0',
    textAlign: 'center',
  },

  section: { marginBottom: 24 },
  sectionLabel: {
    fontSize: 10, fontWeight: 700, letterSpacing: '0.1em',
    color: 'var(--text-muted)', textTransform: 'uppercase',
    marginBottom: 8,
  },

  row: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '10px 12px',
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 6, marginBottom: 4,
  },
  statusDot: { fontSize: 11, flexShrink: 0 },
  rowBody: {
    flex: 1, display: 'flex', flexDirection: 'column', gap: 2,
  },
  rowLabel: { fontSize: 13, fontWeight: 600, color: 'var(--text-primary)' },
  rowDetail: { fontSize: 11, color: 'var(--text-muted)' },
  actionBtn: {
    height: 24, padding: '0 10px',
    background: 'transparent', border: '1px solid var(--accent)',
    borderRadius: 4, color: 'var(--accent)', fontSize: 11,
    cursor: 'pointer', flexShrink: 0,
  },

  // MachineContextPanel styles
  mcRow: {
    display: 'flex', alignItems: 'center', gap: 10,
    padding: '10px 12px',
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 6, marginBottom: 4,
  },
  mcLabel:  { fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', minWidth: 60 },
  mcValue:  { fontSize: 13, color: 'var(--text-primary)' },
  mcSub:    { fontSize: 11, color: 'var(--text-muted)' },
  mcMuted:  { fontSize: 12, color: 'var(--text-muted)' },

  mcBlock: {
    padding: '10px 12px',
    background: 'var(--surface)',
    border: '1px solid var(--border)',
    borderRadius: 6, marginBottom: 4,
    display: 'flex', flexDirection: 'column' as const, gap: 6,
  },
  mcBlockLabel: {
    fontSize: 11, fontWeight: 700, color: 'var(--text-muted)',
    textTransform: 'uppercase' as const, letterSpacing: '0.06em',
  },
  mcEmpty: { fontSize: 12, color: 'var(--text-muted)', fontStyle: 'italic' as const },

  mcItem: { display: 'flex', flexDirection: 'column' as const, gap: 1 },
  mcItemName: { fontSize: 13, color: 'var(--text-primary)' },
  mcItemSub:  { fontSize: 10, color: 'var(--text-muted)' },

  mcFileList: {
    fontSize: 11, color: 'var(--text-secondary)',
    lineHeight: '1.7', wordBreak: 'break-word' as const,
  },
};
