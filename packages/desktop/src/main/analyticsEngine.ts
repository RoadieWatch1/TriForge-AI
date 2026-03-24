/**
 * analyticsEngine.ts — Phase 37
 *
 * Workspace analytics, ROI, and adoption reporting.
 *
 * All aggregation is driven by:
 *   1. RunbookExecution records from the store  (rich step-level detail)
 *   2. AuditLedgerEntry records from the ledger (cross-feature event counts)
 *   3. PackRegistryEntry records from the store  (installed pack state)
 *
 * No second telemetry system is built.  The existing audit trail is the
 * single source of truth for all counters.
 *
 * ROI estimation:
 *   estimatedTimeSavedMin = Σ(successful_runs × stepCount × MINUTES_PER_STEP)
 *   MINUTES_PER_STEP = 2  (conservative manual-equivalent estimate)
 *   Displayed as an estimate, not a finance number.
 */

import type { AuditLedgerEntry } from '@triforge/engine';
import type { RunbookDef, RunbookExecution } from './runbooks';
import type { PackRegistryEntry } from './runbookPack';

// ── Types ─────────────────────────────────────────────────────────────────────

export type AnalyticsWindow = '24h' | '7d' | '30d';

export interface RunbookStats {
  id:                    string;
  title:                 string;
  runs:                  number;
  succeeded:             number;
  failed:                number;
  cancelled:             number;
  incidentRuns:          number;
  avgDurationMs:         number;
  packId?:               string;
  estimatedTimeSavedMin: number;
}

export interface IntegrationStats {
  name:       string;
  eventCount: number;
}

export interface PackStats {
  packId:      string;
  name:        string;
  version:     string;
  runbookCount: number;
  installs:    number;
  updates:     number;
  rollbacks:   number;
  uninstalls:  number;
  trustStatus: string;
}

export interface ApprovalFunnel {
  pausedForApproval:   number;   // runs that entered paused_approval state
  pausedForConfirm:    number;   // runs that entered paused_confirm state
  manualIntervention:  number;   // runs that required operator intervention
  totalPaused:         number;
}

export interface GovernanceMetrics {
  policyBlocks:       number;
  signatureVerified:  number;
  signatureFailed:    number;
  unsignedAllowed:    number;
  unsignedBlocked:    number;
  updateRiskIncrease: number;
  signerAdded:        number;
  signerRevoked:      number;
}

export interface UsageMetrics {
  runbookRuns:      number;
  incidentRuns:     number;
  packInstalls:     number;
  packUpdates:      number;
  packRollbacks:    number;
  integrationEvents:number;
  dispatchActions:  number;
  wsIntgUsed:       number;
  packSigned:       number;
  policyBlocked:    number;
}

export interface RoiMetrics {
  estimatedTimeSavedMin: number;
  automatedSuccesses:    number;
  blockedRiskyActions:   number;
  incidentResponseRuns:  number;
  topRunbooks:           RunbookStats[];   // top 5 by runs
  topIntegrations:       IntegrationStats[];
}

export interface WorkspaceAnalyticsReport {
  window:      AnalyticsWindow;
  fromTs:      number;
  toTs:        number;
  generatedAt: number;
  usage:       UsageMetrics;
  roi:         RoiMetrics;
  runbooks:    RunbookStats[];    // all runbooks with any activity
  packs:       PackStats[];
  integrations:IntegrationStats[];
  approvals:   ApprovalFunnel;
  governance:  GovernanceMetrics;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MINUTES_PER_STEP = 2;  // conservative manual-equivalent estimate per runbook step

const WINDOW_MS: Record<AnalyticsWindow, number> = {
  '24h': 24 * 60 * 60 * 1000,
  '7d':  7  * 24 * 60 * 60 * 1000,
  '30d': 30 * 24 * 60 * 60 * 1000,
};

// Step types that indicate integration usage
const INTEGRATION_STEP_TYPES: Record<string, string> = {
  slack:       'slack',
  jira:        'jira',
  linear:      'linear',
  notify_push: 'push',
  webhook:     'webhook',
  discord:     'discord',
  telegram:    'telegram',
  email:       'email',
  github:      'github',
};

// ── Window helper ─────────────────────────────────────────────────────────────

export function windowFromTs(w: AnalyticsWindow, now = Date.now()): number {
  return now - WINDOW_MS[w];
}

// ── Main aggregation ──────────────────────────────────────────────────────────

/**
 * Generate a complete analytics report from raw data sources.
 * All filtering by time window has already been applied by the caller.
 */
export function generateReport(
  win:          AnalyticsWindow,
  fromTs:       number,
  toTs:         number,
  executions:   RunbookExecution[],   // all executions, caller pre-filters by startedAt >= fromTs
  allRunbooks:  RunbookDef[],
  packs:        PackRegistryEntry[],
  audit:        AuditLedgerEntry[],   // already filtered to [fromTs, toTs]
): WorkspaceAnalyticsReport {

  // ── Runbook stats ───────────────────────────────────────────────────────────

  const rbMap = new Map<string, RunbookStats>();

  // Seed map with known runbooks
  for (const rb of allRunbooks) {
    rbMap.set(rb.id, {
      id: rb.id, title: rb.title, runs: 0, succeeded: 0, failed: 0,
      cancelled: 0, incidentRuns: 0, avgDurationMs: 0,
      packId: rb.packId, estimatedTimeSavedMin: 0,
    });
  }

  const durationSums = new Map<string, number>();
  const durationCounts = new Map<string, number>();

  for (const ex of executions) {
    if (ex.startedAt < fromTs) continue;
    if (!rbMap.has(ex.runbookId)) {
      rbMap.set(ex.runbookId, {
        id: ex.runbookId, title: ex.runbookTitle, runs: 0, succeeded: 0,
        failed: 0, cancelled: 0, incidentRuns: 0, avgDurationMs: 0,
        estimatedTimeSavedMin: 0,
      });
    }
    const stats = rbMap.get(ex.runbookId)!;
    stats.runs++;
    if (ex.status === 'completed') {
      stats.succeeded++;
      const stepCount = ex.steps?.length ?? 0;
      stats.estimatedTimeSavedMin += stepCount * MINUTES_PER_STEP;
      if (ex.completedAt) {
        durationSums.set(ex.runbookId, (durationSums.get(ex.runbookId) ?? 0) + (ex.completedAt - ex.startedAt));
        durationCounts.set(ex.runbookId, (durationCounts.get(ex.runbookId) ?? 0) + 1);
      }
    } else if (ex.status === 'failed') {
      stats.failed++;
    } else if (ex.status === 'cancelled') {
      stats.cancelled++;
    }
    if (ex.isIncident) stats.incidentRuns++;
  }

  // Compute avgDuration
  for (const [id, sum] of durationSums) {
    const count = durationCounts.get(id) ?? 1;
    rbMap.get(id)!.avgDurationMs = Math.round(sum / count);
  }

  const runbookStats = [...rbMap.values()].filter(s => s.runs > 0);
  runbookStats.sort((a, b) => b.runs - a.runs);

  // ── Integration stats from executions ───────────────────────────────────────

  const intgCounts = new Map<string, number>();
  for (const ex of executions) {
    if (ex.startedAt < fromTs) continue;
    for (const step of ex.steps ?? []) {
      const intg = INTEGRATION_STEP_TYPES[step.type];
      if (intg) intgCounts.set(intg, (intgCounts.get(intg) ?? 0) + 1);
    }
  }
  // Also count from WS_INTEGRATION_USED audit events
  for (const e of audit) {
    if (e.eventType === 'WS_INTEGRATION_USED') {
      const intg = String((e.metadata as any)?.integration ?? '');
      if (intg) intgCounts.set(intg, (intgCounts.get(intg) ?? 0) + 1);
    }
  }

  const integrationStats: IntegrationStats[] = [...intgCounts.entries()]
    .map(([name, eventCount]) => ({ name, eventCount }))
    .sort((a, b) => b.eventCount - a.eventCount);

  // ── Pack stats ──────────────────────────────────────────────────────────────

  // Count pack events from audit in window
  const packInstallCount  = new Map<string, number>();
  const packUpdateCount   = new Map<string, number>();
  const packRollbackCount = new Map<string, number>();
  const packUninstallCount = new Map<string, number>();

  for (const e of audit) {
    const pid = String((e.metadata as any)?.packId ?? '');
    if (!pid) continue;
    if (e.eventType === 'PACK_INSTALLED') packInstallCount.set(pid, (packInstallCount.get(pid) ?? 0) + 1);
    if (e.eventType === 'PACK_UPDATED')   packUpdateCount.set(pid, (packUpdateCount.get(pid) ?? 0) + 1);
    if (e.eventType === 'PACK_ROLLBACK')  packRollbackCount.set(pid, (packRollbackCount.get(pid) ?? 0) + 1);
    if (e.eventType === 'PACK_UNINSTALLED') packUninstallCount.set(pid, (packUninstallCount.get(pid) ?? 0) + 1);
  }

  const packStats: PackStats[] = packs.map(pk => ({
    packId:       pk.packId,
    name:         pk.name,
    version:      pk.version,
    runbookCount: (pk.runbookIds ?? []).length,
    installs:     packInstallCount.get(pk.packId)  ?? 0,
    updates:      packUpdateCount.get(pk.packId)   ?? 0,
    rollbacks:    packRollbackCount.get(pk.packId) ?? 0,
    uninstalls:   packUninstallCount.get(pk.packId) ?? 0,
    trustStatus:  (pk as any).trustStatus ?? 'unsigned',
  }));

  // ── Approval funnel from executions ─────────────────────────────────────────

  let pausedApproval = 0, pausedConfirm = 0, pausedManual = 0;
  for (const ex of executions) {
    if (ex.startedAt < fromTs) continue;
    if (ex.status === 'paused_approval') pausedApproval++;
    if (ex.status === 'paused_confirm')  pausedConfirm++;
    if (ex.status === 'paused_manual')   pausedManual++;
    // completed runs that went through a pause state
    if (ex.status === 'completed' && ex.pausedAt) {
      const wasPausedApproval = ex.steps?.some(s => (s as any).pauseType === 'approval');
      if (wasPausedApproval) pausedApproval++;
    }
  }

  const approvals: ApprovalFunnel = {
    pausedForApproval:  pausedApproval,
    pausedForConfirm:   pausedConfirm,
    manualIntervention: pausedManual,
    totalPaused:        pausedApproval + pausedConfirm + pausedManual,
  };

  // ── Governance metrics from audit ───────────────────────────────────────────

  const countEvent = (type: string) => audit.filter(e => e.eventType === type).length;

  const governance: GovernanceMetrics = {
    policyBlocks:       countEvent('PACK_POLICY_BLOCKED'),
    signatureVerified:  countEvent('PACK_SIGNATURE_VERIFIED'),
    signatureFailed:    countEvent('PACK_SIGNATURE_FAILED'),
    unsignedAllowed:    countEvent('PACK_UNSIGNED_ALLOWED'),
    unsignedBlocked:    countEvent('PACK_UNSIGNED_BLOCKED'),
    updateRiskIncrease: countEvent('PACK_UPDATE_RISK_INCREASED'),
    signerAdded:        countEvent('TRUSTED_SIGNER_ADDED'),
    signerRevoked:      countEvent('TRUSTED_SIGNER_REVOKED'),
  };

  // ── Usage summary ───────────────────────────────────────────────────────────

  const windowExecs = executions.filter(e => e.startedAt >= fromTs);

  const usage: UsageMetrics = {
    runbookRuns:       windowExecs.length,
    incidentRuns:      windowExecs.filter(e => e.isIncident).length,
    packInstalls:      [...packInstallCount.values()].reduce((a, b) => a + b, 0),
    packUpdates:       [...packUpdateCount.values()].reduce((a, b) => a + b, 0),
    packRollbacks:     [...packRollbackCount.values()].reduce((a, b) => a + b, 0),
    integrationEvents: [...intgCounts.values()].reduce((a, b) => a + b, 0),
    dispatchActions:   countEvent('DISPATCH_ACTION_EXECUTED'),
    wsIntgUsed:        countEvent('WS_INTEGRATION_USED'),
    packSigned:        countEvent('PACK_SIGNED'),
    policyBlocked:     countEvent('PACK_POLICY_BLOCKED'),
  };

  // ── ROI summary ─────────────────────────────────────────────────────────────

  const totalTimeSaved = runbookStats.reduce((s, r) => s + r.estimatedTimeSavedMin, 0);
  const totalSucceeded = runbookStats.reduce((s, r) => s + r.succeeded, 0);
  const incidentTotal  = windowExecs.filter(e => e.isIncident).length;

  const roi: RoiMetrics = {
    estimatedTimeSavedMin: totalTimeSaved,
    automatedSuccesses:    totalSucceeded,
    blockedRiskyActions:   governance.policyBlocks + governance.signatureFailed + governance.unsignedBlocked,
    incidentResponseRuns:  incidentTotal,
    topRunbooks:           runbookStats.slice(0, 5),
    topIntegrations:       integrationStats.slice(0, 5),
  };

  return {
    window:      win,
    fromTs,
    toTs,
    generatedAt: Date.now(),
    usage,
    roi,
    runbooks:    runbookStats,
    packs:       packStats,
    integrations: integrationStats,
    approvals,
    governance,
  };
}

// ── Plain-text export ─────────────────────────────────────────────────────────

export function formatReportText(report: WorkspaceAnalyticsReport): string {
  const win  = report.window;
  const date = new Date(report.generatedAt).toISOString().slice(0, 10);
  const lines: string[] = [
    `TRIFORGE WORKSPACE ANALYTICS — ${win.toUpperCase()} — ${date}`,
    '═'.repeat(55),
    '',
    '▸ USAGE',
    `  Runbook runs:        ${report.usage.runbookRuns}  (incident: ${report.usage.incidentRuns})`,
    `  Pack installs:       ${report.usage.packInstalls}  updates: ${report.usage.packUpdates}  rollbacks: ${report.usage.packRollbacks}`,
    `  Integration events:  ${report.usage.integrationEvents}`,
    `  Dispatch actions:    ${report.usage.dispatchActions}`,
    '',
    '▸ ROI (estimated)',
    `  Time saved:          ${report.roi.estimatedTimeSavedMin} min  (~${Math.round(report.roi.estimatedTimeSavedMin / 60 * 10) / 10}h)`,
    `  Automated successes: ${report.roi.automatedSuccesses}`,
    `  Blocked risky actions: ${report.roi.blockedRiskyActions}`,
    `  Incident response runs: ${report.roi.incidentResponseRuns}`,
    '',
    '▸ TOP RUNBOOKS',
    ...report.roi.topRunbooks.map(r =>
      `  ${r.title.padEnd(32)} ${r.runs} runs  ${r.succeeded}✓  ${r.failed}✗  ~${r.estimatedTimeSavedMin}min saved`
    ),
    '',
    '▸ INTEGRATIONS',
    ...report.integrations.map(i =>
      `  ${i.name.padEnd(15)} ${i.eventCount} events`
    ),
    '',
    '▸ GOVERNANCE',
    `  Policy blocks:       ${report.governance.policyBlocks}`,
    `  Signatures verified: ${report.governance.signatureVerified}`,
    `  Signatures failed:   ${report.governance.signatureFailed}`,
    `  Unsigned allowed:    ${report.governance.unsignedAllowed}`,
    '',
    '▸ PACKS',
    ...report.packs.map(p =>
      `  ${p.name.padEnd(28)} v${p.version}  ${p.runbookCount} runbooks  trust: ${p.trustStatus}`
    ),
    '',
    `Generated by TriForge AI · ${new Date(report.generatedAt).toISOString()}`,
  ];
  return lines.join('\n');
}
