/**
 * auditExporter.ts — Phase 38
 *
 * Export the audit ledger over a date range in JSON, CSV, or plain-text format.
 * Uses AuditLedger.scanRange() added in Phase 37 — no separate data store.
 */

import type { AuditLedger } from '@triforge/engine';

export type AuditExportFormat = 'json' | 'csv' | 'text';

/**
 * Export audit entries from [fromTs, toTs] in the requested format.
 * Returns a string ready for clipboard copy or file download.
 */
export async function exportAuditLog(
  ledger:  AuditLedger,
  fromTs:  number,
  toTs:    number,
  format:  AuditExportFormat,
  filter?: string,   // optional eventType substring filter
): Promise<string> {
  let entries = await ledger.scanRange(fromTs, toTs);

  if (filter) {
    const lf = filter.toLowerCase();
    entries = entries.filter(e => e.eventType.toLowerCase().includes(lf));
  }

  if (format === 'json') {
    return JSON.stringify(entries, null, 2);
  }

  if (format === 'csv') {
    const header = 'id,timestamp,datetime,eventType,taskId,stepId,tool,category,metadata';
    const rows = entries.map(e => [
      e.id,
      e.timestamp,
      new Date(e.timestamp).toISOString(),
      e.eventType,
      e.taskId          ?? '',
      e.stepId          ?? '',
      e.tool            ?? '',
      e.category        ?? '',
      JSON.stringify(e.metadata ?? {}),
    ].map(v => `"${String(v).replace(/"/g, '""')}"`).join(','));
    return [header, ...rows].join('\n');
  }

  // Plain text
  const from = new Date(fromTs).toISOString().slice(0, 10);
  const to   = new Date(toTs).toISOString().slice(0, 10);
  const lines: string[] = [
    `TRIFORGE AUDIT EXPORT — ${from} → ${to}`,
    `Entries: ${entries.length}${filter ? `  (filter: ${filter})` : ''}`,
    '═'.repeat(72),
    '',
  ];
  for (const e of entries) {
    const meta = e.metadata ? '  ' + JSON.stringify(e.metadata) : '';
    lines.push(`[${new Date(e.timestamp).toISOString()}] ${e.eventType}${meta}`);
  }
  return lines.join('\n');
}

/** Compute a policy-change history subset from audit entries. */
export async function exportPolicyHistory(
  ledger: AuditLedger,
  fromTs: number,
  toTs:   number,
): Promise<string> {
  const policyEvents = new Set([
    'PACK_POLICY_BLOCKED', 'TRUSTED_SIGNER_ADDED', 'TRUSTED_SIGNER_REMOVED',
    'TRUSTED_SIGNER_REVOKED', 'PACK_UNSIGNED_BLOCKED', 'PACK_SIGNATURE_FAILED',
    'ORG_POLICY_UPDATED', 'ORG_SIGNER_ADDED', 'ORG_SIGNER_REVOKED',
    'ORG_CREATED', 'ORG_UPDATED',
  ]);
  const all     = await ledger.scanRange(fromTs, toTs);
  const filtered = all.filter(e => policyEvents.has(e.eventType));
  return exportAuditLog(ledger, fromTs, toTs, 'text', 'POLICY').then(
    () => exportAuditLog({ scanRange: async () => filtered } as any, fromTs, toTs, 'text'),
  );
}
