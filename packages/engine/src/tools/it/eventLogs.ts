// it/eventLogs.ts — Pull recent Windows event log errors/criticals
// Windows: uses PowerShell Get-EventLog or Get-WinEvent
// macOS/Linux: reads /var/log/syslog or journalctl

import { execSync } from 'child_process';
import * as crypto from 'crypto';
import type { ToolDefinition, ToolContext, ExecutionResult } from '../../core/taskTypes';
import { serviceLocator } from '../../core/serviceLocator';
import { eventBus } from '../../core/eventBus';

export const itEventLogsDef: ToolDefinition = {
  name: 'it_event_logs',
  description: 'Retrieves recent critical and error entries from the system event log. Windows: Event Viewer (System/Application). macOS/Linux: syslog or journalctl. Returns structured entries with timestamp, source, and message.',
  category: 'general',
  riskLevel: 'low',
  estimatedCostCents: 0,
  inputSchema: {
    logName:  { type: 'string', description: 'Log to query: System, Application, Security (Windows default: System)' },
    maxItems: { type: 'number', description: 'Max entries to return (default 20, max 100)' },
    minutesBack: { type: 'number', description: 'Look back this many minutes (default 60)' },
    levelFilter: { type: 'string', description: 'Level filter: "all" | "error" | "critical" | "warning" (default: error)' },
  },
};

export interface EventLogEntry {
  eventId:    number;
  level:      string;
  source:     string;
  message:    string;
  ts:         number;   // epoch ms
  logName:    string;
}

export interface EventLogsResult {
  entries:     EventLogEntry[];
  logName:     string;
  platform:    string;
  minutesBack: number;
  capturedAt:  number;
}

const LEVEL_MAP: Record<string, number> = {
  critical: 1, error: 2, warning: 3, information: 4,
};

function pullWindowsLogs(logName: string, maxItems: number, minutesBack: number, levelFilter: string): EventLogEntry[] {
  const level = levelFilter === 'all' ? '' : `and $_.Level -le ${LEVEL_MAP[levelFilter] ?? 2}`;
  const since = `(Get-Date).AddMinutes(-${minutesBack})`;
  const cmd = `powershell -NoProfile -Command "Get-WinEvent -LogName '${logName}' -ErrorAction SilentlyContinue | Where-Object { $_.TimeCreated -ge ${since} ${level} } | Select-Object -First ${maxItems} | ForEach-Object { [PSCustomObject]@{ Id=$_.Id; LevelDisplayName=$_.LevelDisplayName; ProviderName=$_.ProviderName; Message=($_.Message -replace '\\n',' ' -replace '\\r',''); TimeCreated=$_.TimeCreated.ToUniversalTime().ToString('o') } } | ConvertTo-Json -Depth 3"`;
  try {
    const out = execSync(cmd, { timeout: 15_000 }).toString().trim();
    if (!out) return [];
    const raw = JSON.parse(out) as unknown;
    const arr = Array.isArray(raw) ? raw : [raw];
    return arr.map((e: Record<string, unknown>) => ({
      eventId: Number(e['Id'] ?? 0),
      level:   String(e['LevelDisplayName'] ?? 'Unknown'),
      source:  String(e['ProviderName'] ?? 'Unknown'),
      message: String(e['Message'] ?? '').slice(0, 500),
      ts:      new Date(String(e['TimeCreated'] ?? '')).getTime() || Date.now(),
      logName,
    }));
  } catch { return []; }
}

function pullUnixLogs(maxItems: number, minutesBack: number): EventLogEntry[] {
  try {
    const sinceMin = `${minutesBack} minutes ago`;
    const isLinux = process.platform === 'linux';
    let out = '';
    if (isLinux) {
      out = execSync(`journalctl -p err --since "${sinceMin}" -n ${maxItems} --output short-iso --no-pager`, { timeout: 8000 }).toString();
    } else {
      // macOS
      out = execSync(`log show --last ${minutesBack}m --predicate 'eventType == logEvent and messageType >= 16' --style compact 2>/dev/null | head -${maxItems}`, { timeout: 8000 }).toString();
    }
    if (!out.trim()) return [];
    return out.split('\n').filter(Boolean).slice(-maxItems).map((line, i) => ({
      eventId: i,
      level:   'Error',
      source:  'System',
      message: line.trim().slice(0, 500),
      ts:      Date.now(),
      logName: 'syslog',
    }));
  } catch { return []; }
}

export async function runItEventLogs(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<EventLogsResult> {
  const logName     = String(args.logName ?? 'System');
  const maxItems    = Math.min(Number(args.maxItems ?? 20), 100);
  const minutesBack = Number(args.minutesBack ?? 60);
  const levelFilter = String(args.levelFilter ?? 'error').toLowerCase();

  const entries = process.platform === 'win32'
    ? pullWindowsLogs(logName, maxItems, minutesBack, levelFilter)
    : pullUnixLogs(maxItems, minutesBack);

  const result: EventLogsResult = {
    entries, logName, platform: process.platform, minutesBack, capturedAt: Date.now(),
  };

  const execResult: ExecutionResult = {
    id: crypto.randomUUID(),
    taskId: ctx.taskId, stepId: ctx.stepId, tool: 'it_event_logs',
    timestamp: Date.now(), success: true, paperMode: false,
    data: { count: entries.length, logName },
  };
  serviceLocator.logResult(execResult);
  eventBus.emit({ type: 'RESULT_LOGGED', taskId: ctx.taskId, stepId: ctx.stepId, tool: 'it_event_logs', success: true });

  return result;
}
