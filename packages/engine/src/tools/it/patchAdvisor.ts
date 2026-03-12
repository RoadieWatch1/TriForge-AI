// it/patchAdvisor.ts — Detect missing OS updates and outdated software fingerprints
// Windows: checks Windows Update pending count via PowerShell
// macOS: uses softwareupdate --list
// Linux: apt/dnf/pacman list-upgradeable
// Returns recommendations without installing anything (read-only)

import { execSync } from 'child_process';
import * as crypto from 'crypto';
import type { ToolDefinition, ToolContext, ExecutionResult } from '../../core/taskTypes';
import { serviceLocator } from '../../core/serviceLocator';
import { eventBus } from '../../core/eventBus';

export const itPatchAdvisorDef: ToolDefinition = {
  name: 'it_patch_advisor',
  description: 'Checks for pending OS updates and outdated software. Read-only — does NOT install anything. Returns a list of recommended patches with severity hints.',
  category: 'general',
  riskLevel: 'low',
  estimatedCostCents: 0,
  inputSchema: {
    scope: { type: 'string', description: '"os" | "apps" | "all" (default: all)' },
  },
};

export interface PatchEntry {
  name:        string;
  currentVersion?: string;
  latestVersion?:  string;
  severity:    'critical' | 'important' | 'optional' | 'unknown';
  category:    string;
  description?: string;
}

export interface PatchAdvisorResult {
  pending:      PatchEntry[];
  totalCount:   number;
  critical:     number;
  important:    number;
  platform:     string;
  recommendation: string;
  capturedAt:   number;
}

function getWindowsUpdates(): PatchEntry[] {
  try {
    const cmd = `powershell -NoProfile -Command "
      $session = New-Object -ComObject Microsoft.Update.Session;
      $searcher = $session.CreateUpdateSearcher();
      $result = $searcher.Search('IsInstalled=0 and Type=\\'Software\\'');
      $result.Updates | ForEach-Object {
        [PSCustomObject]@{
          Title = $_.Title;
          Severity = if ($_.MsrcSeverity) { $_.MsrcSeverity } else { 'Unknown' };
          Categories = ($_.Categories | Select-Object -First 1 -ExpandProperty Name)
        }
      } | ConvertTo-Json -Depth 2
    "`;
    const out = execSync(cmd, { timeout: 30_000 }).toString().trim();
    if (!out) return [];
    const raw = JSON.parse(out) as unknown;
    const arr = Array.isArray(raw) ? raw : [raw];
    return arr.map((u: Record<string, unknown>) => ({
      name:        String(u['Title'] ?? 'Unknown Update'),
      severity:    mapSeverity(String(u['Severity'] ?? '')),
      category:    String(u['Categories'] ?? 'Update'),
      description: String(u['Title'] ?? ''),
    }));
  } catch { return []; }
}

function getMacUpdates(): PatchEntry[] {
  try {
    const out = execSync('softwareupdate --list 2>&1', { timeout: 30_000 }).toString();
    const entries: PatchEntry[] = [];
    const lines = out.split('\n');
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes('* ') || line.includes('- ')) {
        const name = line.replace(/^\s*[*-]\s*/, '').split(',')[0].trim();
        if (name && !name.includes('No new software')) {
          entries.push({ name, severity: 'unknown', category: 'macOS Update' });
        }
      }
    }
    return entries;
  } catch { return []; }
}

function getLinuxUpdates(): PatchEntry[] {
  try {
    // Try apt first, then dnf, then pacman
    let out = '';
    try { out = execSync('apt list --upgradeable 2>/dev/null | tail -n +2', { timeout: 15_000 }).toString(); }
    catch {
      try { out = execSync('dnf list --upgrades 2>/dev/null | tail -n +2', { timeout: 15_000 }).toString(); }
      catch { out = execSync('checkupdates 2>/dev/null', { timeout: 15_000 }).toString(); }
    }
    return out.split('\n').filter(Boolean).slice(0, 50).map(line => ({
      name:     line.split('/')[0].trim(),
      severity: 'unknown' as const,
      category: 'Package Update',
    }));
  } catch { return []; }
}

function mapSeverity(raw: string): PatchEntry['severity'] {
  const s = raw.toLowerCase();
  if (s.includes('critical')) return 'critical';
  if (s.includes('important')) return 'important';
  if (s.includes('optional') || s.includes('low')) return 'optional';
  return 'unknown';
}

function buildRecommendation(pending: PatchEntry[]): string {
  const crit = pending.filter(p => p.severity === 'critical').length;
  const imp  = pending.filter(p => p.severity === 'important').length;
  if (crit > 0) return `URGENT: ${crit} critical security patch${crit > 1 ? 'es' : ''} pending. Install immediately via Windows Update or system package manager.`;
  if (imp > 0)  return `${imp} important update${imp > 1 ? 's' : ''} available. Schedule installation within 48 hours.`;
  if (pending.length > 0) return `${pending.length} optional update${pending.length > 1 ? 's' : ''} available. Install when convenient.`;
  return 'System appears up to date. No pending updates detected.';
}

export async function runItPatchAdvisor(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<PatchAdvisorResult> {
  const scope = String(args.scope ?? 'all').toLowerCase();

  let pending: PatchEntry[] = [];
  if (scope === 'os' || scope === 'all') {
    if (process.platform === 'win32')   pending.push(...getWindowsUpdates());
    else if (process.platform === 'darwin') pending.push(...getMacUpdates());
    else pending.push(...getLinuxUpdates());
  }

  const result: PatchAdvisorResult = {
    pending:    pending.slice(0, 50),
    totalCount: pending.length,
    critical:   pending.filter(p => p.severity === 'critical').length,
    important:  pending.filter(p => p.severity === 'important').length,
    platform:   process.platform,
    recommendation: buildRecommendation(pending),
    capturedAt: Date.now(),
  };

  const execResult: ExecutionResult = {
    id: crypto.randomUUID(),
    taskId: ctx.taskId, stepId: ctx.stepId, tool: 'it_patch_advisor',
    timestamp: Date.now(), success: true, paperMode: false,
    data: { totalCount: result.totalCount, critical: result.critical },
  };
  serviceLocator.logResult(execResult);
  eventBus.emit({ type: 'RESULT_LOGGED', taskId: ctx.taskId, stepId: ctx.stepId, tool: 'it_patch_advisor', success: true });

  return result;
}
