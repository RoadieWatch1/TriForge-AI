import React, { useState, useEffect, useCallback } from 'react';

// ── Types ──────────────────────────────────────────────────────────────────────

type CheckStatus = 'pass' | 'warn' | 'fail' | 'loading';

interface ReadinessCheck {
  id: string;
  label: string;
  description: string;
  status: CheckStatus;
  detail?: string;
  actionLabel?: string;
  onAction?: () => void;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function statusColor(s: CheckStatus): string {
  if (s === 'pass')    return '#10a37f';
  if (s === 'warn')    return '#f59e0b';
  if (s === 'fail')    return '#ef4444';
  return 'var(--text-muted)';
}

function statusIcon(s: CheckStatus): string {
  if (s === 'pass')    return '✓';
  if (s === 'warn')    return '△';
  if (s === 'fail')    return '✗';
  return '○';
}

function statusLabel(s: CheckStatus): string {
  if (s === 'pass') return 'PASS';
  if (s === 'warn') return 'WARN';
  if (s === 'fail') return 'FAIL';
  return '…';
}

// ── Component ─────────────────────────────────────────────────────────────────

interface Props {
  onNavigate?: (screen: string) => void;
}

export function ReadinessScreen({ onNavigate }: Props) {
  const [checks, setChecks] = useState<ReadinessCheck[]>([]);
  const [loading, setLoading] = useState(true);
  const [lastRun, setLastRun] = useState<Date | null>(null);
  const [appVersion, setAppVersion] = useState<string>('');
  const [appName, setAppName] = useState<string>('TriForge AI');
  const mountedRef = React.useRef(true);

  const runChecks = useCallback(async () => {
    if (!mountedRef.current) return;
    setLoading(true);

    // Load version info
    try {
      const [v, n] = await Promise.all([
        window.triforge.app?.version?.() ?? Promise.resolve(''),
        window.triforge.app?.name?.()    ?? Promise.resolve('TriForge AI'),
      ]);
      setAppVersion(v);
      setAppName(n);
    } catch { /* ok */ }

    const results: ReadinessCheck[] = [];

    // ── 1. AI Provider Keys ──────────────────────────────────────────────────
    try {
      const keys = await window.triforge.keys.status();
      const connected = Object.values(keys).filter(Boolean).length;
      const total = Object.keys(keys).length;
      results.push({
        id: 'ai_keys',
        label: 'AI Providers Connected',
        description: 'At least one AI provider API key must be configured for the app to function.',
        status: connected === 0 ? 'fail' : connected < total ? 'warn' : 'pass',
        detail: `${connected} / ${total} providers connected`,
        actionLabel: connected < total ? 'Configure Keys' : undefined,
        onAction: connected < total ? () => onNavigate?.('settings') : undefined,
      });
    } catch {
      results.push({ id: 'ai_keys', label: 'AI Providers Connected', description: '', status: 'fail', detail: 'Could not load key status' });
    }

    // ── 2. Session Lock ──────────────────────────────────────────────────────
    try {
      const auth = await window.triforge.auth.status();
      results.push({
        id: 'session_lock',
        label: 'Session Lock',
        description: 'Protect the app with a PIN to prevent unauthorized access.',
        status: auth.hasPin ? 'pass' : 'warn',
        detail: auth.hasPin ? `Enabled — user: ${auth.username}` : 'No PIN set. Session is unprotected.',
        actionLabel: !auth.hasPin ? 'Set PIN' : undefined,
        onAction: !auth.hasPin ? () => onNavigate?.('settings') : undefined,
      });
    } catch {
      results.push({ id: 'session_lock', label: 'Session Lock', description: '', status: 'warn', detail: 'Could not check auth status' });
    }

    // ── 3. License / Plan ────────────────────────────────────────────────────
    try {
      const lic = await window.triforge.license.load();
      const tier = lic?.tier ?? 'free';
      results.push({
        id: 'license',
        label: 'License Plan',
        description: 'Your active subscription tier unlocks capabilities.',
        status: tier === 'free' ? 'warn' : 'pass',
        detail: tier === 'free'
          ? 'Free tier active. Upgrade for full capabilities.'
          : `${tier.charAt(0).toUpperCase() + tier.slice(1)} plan active.`,
        actionLabel: tier === 'free' ? 'Upgrade' : undefined,
        onAction: tier === 'free' ? () => onNavigate?.('plan') : undefined,
      });
    } catch {
      results.push({ id: 'license', label: 'License Plan', description: '', status: 'warn', detail: 'Could not load license' });
    }

    // ── 4. Backup Currency ───────────────────────────────────────────────────
    try {
      const lastBackup = await window.triforge.recovery?.getLastBackupAt?.();
      const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
      const hasRecent = lastBackup && new Date(lastBackup).getTime() > sevenDaysAgo;
      results.push({
        id: 'backup',
        label: 'Recent Backup',
        description: 'A configuration backup within the last 7 days ensures data safety.',
        status: !lastBackup ? 'fail' : hasRecent ? 'pass' : 'warn',
        detail: !lastBackup
          ? 'No backup on record. Create one now.'
          : hasRecent
            ? `Last backup: ${new Date(lastBackup).toLocaleDateString()}`
            : `Last backup: ${new Date(lastBackup).toLocaleDateString()} — over 7 days ago.`,
        actionLabel: !hasRecent ? 'Create Backup' : undefined,
        onAction: !hasRecent ? () => onNavigate?.('recovery') : undefined,
      });
    } catch {
      results.push({ id: 'backup', label: 'Recent Backup', description: '', status: 'warn', detail: 'Could not check backup status' });
    }

    // ── 5. Store Health ──────────────────────────────────────────────────────
    try {
      const validation = await window.triforge.recovery?.validateStore?.();
      const errorCount = validation?.issues?.filter((i: any) => i.severity === 'error')?.length ?? 0;
      const warnCount  = validation?.issues?.filter((i: any) => i.severity === 'warn')?.length ?? 0;
      results.push({
        id: 'store_health',
        label: 'Store Integrity',
        description: 'Validates configuration structure for consistency and required fields.',
        status: errorCount > 0 ? 'fail' : warnCount > 0 ? 'warn' : 'pass',
        detail: errorCount > 0
          ? `${errorCount} error${errorCount > 1 ? 's' : ''} detected — repair recommended`
          : warnCount > 0
            ? `${warnCount} warning${warnCount > 1 ? 's' : ''} — review in Recovery`
            : 'Store validated, no issues found',
        actionLabel: (errorCount > 0 || warnCount > 0) ? 'Open Recovery' : undefined,
        onAction: (errorCount > 0 || warnCount > 0) ? () => onNavigate?.('recovery') : undefined,
      });
    } catch {
      results.push({ id: 'store_health', label: 'Store Integrity', description: '', status: 'warn', detail: 'Could not run validation' });
    }

    // ── 6. Migrations ────────────────────────────────────────────────────────
    try {
      const schemaVersion = await window.triforge.recovery?.getSchemaVersion?.() ?? 0;
      const LATEST_SCHEMA = 8;
      const pending = LATEST_SCHEMA - (schemaVersion as number);
      results.push({
        id: 'migrations',
        label: 'Schema Migrations',
        description: 'All database migrations must be applied for full functionality.',
        status: pending === 0 ? 'pass' : pending <= 2 ? 'warn' : 'fail',
        detail: pending === 0
          ? `Schema v${schemaVersion} — up to date`
          : `Schema v${schemaVersion} — ${pending} migration${pending > 1 ? 's' : ''} pending`,
        actionLabel: pending > 0 ? 'Run Migrations' : undefined,
        onAction: pending > 0 ? () => onNavigate?.('recovery') : undefined,
      });
    } catch {
      results.push({ id: 'migrations', label: 'Schema Migrations', description: '', status: 'warn', detail: 'Could not check schema version' });
    }

    // ── 7. Workspace ─────────────────────────────────────────────────────────
    try {
      const ws = await window.triforge.workspace?.get?.() as { name?: string } | null | undefined;
      const hasWs = ws && ws.name && ws.name.length > 0;
      results.push({
        id: 'workspace',
        label: 'Workspace Configured',
        description: 'A named workspace enables team features, approval gates, and policy enforcement.',
        status: hasWs ? 'pass' : 'warn',
        detail: hasWs ? `Workspace: "${ws.name}"` : 'No workspace configured.',
        actionLabel: !hasWs ? 'Configure' : undefined,
        onAction: !hasWs ? () => onNavigate?.('settings') : undefined,
      });
    } catch {
      results.push({ id: 'workspace', label: 'Workspace Configured', description: '', status: 'warn', detail: 'Workspace module not available' });
    }

    // ── 8. Dispatch ──────────────────────────────────────────────────────────
    try {
      const dispatchStatus = await window.triforge.dispatch?.status?.();
      const running = dispatchStatus?.running ?? false;
      results.push({
        id: 'dispatch',
        label: 'Dispatch Server',
        description: 'The local dispatch server routes agent tasks to the right endpoints.',
        status: running ? 'pass' : 'warn',
        detail: running
          ? `Running on port ${dispatchStatus?.port ?? '?'}`
          : 'Dispatch server not running.',
        actionLabel: !running ? 'Configure Dispatch' : undefined,
        onAction: !running ? () => onNavigate?.('missioncontrol') : undefined,
      });
    } catch {
      results.push({ id: 'dispatch', label: 'Dispatch Server', description: '', status: 'warn', detail: 'Dispatch module not available' });
    }

    // ── 9. Trusted Signers ───────────────────────────────────────────────────
    try {
      const signerRes = await window.triforge.pack?.trust?.listSigners?.();
      const signers: unknown[] = signerRes?.signers ?? [];
      results.push({
        id: 'signers',
        label: 'Trusted Signers',
        description: 'At least one trusted signer key enables verified runbook pack validation.',
        status: signers.length > 0 ? 'pass' : 'warn',
        detail: signers.length > 0
          ? `${signers.length} trusted signer${signers.length > 1 ? 's' : ''} configured`
          : 'No trusted signers configured. Unsigned packs will fail trust checks.',
      });
    } catch {
      results.push({ id: 'signers', label: 'Trusted Signers', description: '', status: 'warn', detail: 'Pack module not available' });
    }

    // ── 10. Runbook Packs ────────────────────────────────────────────────────
    try {
      const packRes = await window.triforge.pack?.list?.();
      const packs: unknown[] = packRes?.packs ?? [];
      results.push({
        id: 'packs',
        label: 'Runbook Packs',
        description: 'Installed packs provide reusable automation workflows.',
        status: packs.length > 0 ? 'pass' : 'warn',
        detail: packs.length > 0
          ? `${packs.length} pack${packs.length > 1 ? 's' : ''} installed`
          : 'No packs installed. Import a starter pack from Runbooks.',
      });
    } catch {
      results.push({ id: 'packs', label: 'Runbook Packs', description: '', status: 'warn', detail: 'Pack module not available' });
    }

    if (!mountedRef.current) return;
    setChecks(results);
    setLastRun(new Date());
    setLoading(false);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // onNavigate intentionally excluded — stable navigation cb, prevents re-running all checks on every render

  useEffect(() => {
    mountedRef.current = true;
    runChecks();
    return () => { mountedRef.current = false; };
  }, [runChecks]);

  const passCount = checks.filter(c => c.status === 'pass').length;
  const warnCount = checks.filter(c => c.status === 'warn').length;
  const failCount = checks.filter(c => c.status === 'fail').length;

  const overallStatus: CheckStatus =
    failCount > 0 ? 'fail' : warnCount > 0 ? 'warn' : checks.length > 0 ? 'pass' : 'loading';

  return (
    <div style={s.page}>
      {/* Header */}
      <div style={s.header}>
        <div style={s.headerLeft}>
          <div style={s.headerTitle}>Release Readiness</div>
          <div style={s.headerSub}>
            {appName} {appVersion ? `v${appVersion}` : ''} — pre-launch checklist
          </div>
        </div>
        <button style={s.refreshBtn} onClick={runChecks} disabled={loading}>
          {loading ? 'Checking…' : 'Re-run Checks'}
        </button>
      </div>

      {/* Score banner */}
      <div style={{ ...s.scoreBanner, borderColor: statusColor(overallStatus) }}>
        <div style={{ ...s.scoreIcon, color: statusColor(overallStatus) }}>
          {overallStatus === 'loading' ? '○' : statusIcon(overallStatus)}
        </div>
        <div style={s.scoreBody}>
          <div style={{ ...s.scoreHeading, color: statusColor(overallStatus) }}>
            {overallStatus === 'pass' && 'All checks passed — ready to ship'}
            {overallStatus === 'warn' && 'Warnings present — review before release'}
            {overallStatus === 'fail' && 'Critical issues detected — do not release'}
            {overallStatus === 'loading' && 'Running checks…'}
          </div>
          {checks.length > 0 && (
            <div style={s.scoreCounts}>
              <span style={{ color: '#10a37f' }}>{passCount} passed</span>
              {warnCount > 0 && <span style={{ color: '#f59e0b' }}>{warnCount} warning{warnCount > 1 ? 's' : ''}</span>}
              {failCount > 0 && <span style={{ color: '#ef4444' }}>{failCount} failure{failCount > 1 ? 's' : ''}</span>}
              {lastRun && (
                <span style={{ color: 'var(--text-muted)', marginLeft: 8 }}>
                  Last run: {lastRun.toLocaleTimeString()}
                </span>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Check list */}
      <div style={s.checkList}>
        {loading && checks.length === 0 ? (
          <div style={s.loadingRow}>Running readiness checks…</div>
        ) : (
          checks.map(check => (
            <div key={check.id} style={s.checkRow}>
              {/* Status badge */}
              <div style={{ ...s.badge, color: statusColor(check.status), borderColor: statusColor(check.status) }}>
                <span style={s.badgeIcon}>{statusIcon(check.status)}</span>
                <span style={s.badgeText}>{statusLabel(check.status)}</span>
              </div>

              {/* Content */}
              <div style={s.checkContent}>
                <div style={s.checkLabel}>{check.label}</div>
                <div style={s.checkDesc}>{check.description}</div>
                {check.detail && (
                  <div style={{ ...s.checkDetail, color: statusColor(check.status) }}>
                    {check.detail}
                  </div>
                )}
              </div>

              {/* Action */}
              {check.actionLabel && check.onAction && (
                <button style={s.actionBtn} onClick={check.onAction}>
                  {check.actionLabel}
                </button>
              )}
            </div>
          ))
        )}
      </div>

      {/* Footer note */}
      <div style={s.footer}>
        Warnings are non-blocking but should be resolved before production deployment.
        Critical failures require immediate attention before release.
      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  page: {
    padding: '24px 28px',
    maxWidth: 760,
    margin: '0 auto',
    color: 'var(--text-primary)',
    fontFamily: 'inherit',
  },
  header: {
    display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between',
    marginBottom: 20,
  },
  headerLeft: {},
  headerTitle: {
    fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 3,
  },
  headerSub: {
    fontSize: 12, color: 'var(--text-muted)',
  },
  refreshBtn: {
    padding: '7px 14px',
    background: 'var(--surface-alt, #16161a)',
    border: '1px solid var(--border)',
    borderRadius: 7, color: 'var(--text-secondary)',
    fontSize: 12, fontWeight: 600, cursor: 'pointer',
  },
  scoreBanner: {
    display: 'flex', alignItems: 'center', gap: 16,
    background: 'var(--surface, #1a1a22)',
    border: '1px solid',
    borderRadius: 10, padding: '14px 18px',
    marginBottom: 20,
  },
  scoreIcon: {
    fontSize: 28, lineHeight: 1, flexShrink: 0, fontWeight: 700,
  },
  scoreBody: {
    flex: 1,
  },
  scoreHeading: {
    fontSize: 14, fontWeight: 700, marginBottom: 4,
  },
  scoreCounts: {
    display: 'flex', gap: 12, fontSize: 12, flexWrap: 'wrap' as const,
  },
  checkList: {
    display: 'flex', flexDirection: 'column' as const, gap: 8,
    marginBottom: 20,
  },
  loadingRow: {
    color: 'var(--text-muted)', fontSize: 13, padding: '16px 0', textAlign: 'center' as const,
  },
  checkRow: {
    display: 'flex', alignItems: 'flex-start', gap: 14,
    background: 'var(--surface, #1a1a22)',
    border: '1px solid var(--border)',
    borderRadius: 9, padding: '12px 14px',
  },
  badge: {
    display: 'flex', flexDirection: 'column' as const, alignItems: 'center', gap: 2,
    border: '1px solid',
    borderRadius: 6, padding: '4px 8px',
    minWidth: 48, flexShrink: 0,
  },
  badgeIcon: {
    fontSize: 14, fontWeight: 700, lineHeight: 1,
  },
  badgeText: {
    fontSize: 9, fontWeight: 700, letterSpacing: '0.06em',
  },
  checkContent: {
    flex: 1, minWidth: 0,
  },
  checkLabel: {
    fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 2,
  },
  checkDesc: {
    fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.5, marginBottom: 4,
  },
  checkDetail: {
    fontSize: 11, fontWeight: 600,
  },
  actionBtn: {
    padding: '5px 12px',
    background: 'none',
    border: '1px solid var(--border)',
    borderRadius: 6, color: 'var(--accent)',
    fontSize: 11, fontWeight: 600, cursor: 'pointer', flexShrink: 0, alignSelf: 'center' as const,
    whiteSpace: 'nowrap' as const,
  },
  footer: {
    fontSize: 11, color: 'var(--text-muted)',
    borderTop: '1px solid var(--border)', paddingTop: 14, lineHeight: 1.6,
  },
};
