// it/processes.ts — List processes or kill a specific one
// List: always safe (read-only). Kill: high risk, always requires approval.

import { execSync } from 'child_process';
import * as crypto from 'crypto';
import type { ToolDefinition, ToolContext, ExecutionResult } from '../../core/taskTypes';
import { serviceLocator } from '../../core/serviceLocator';
import { eventBus } from '../../core/eventBus';

export const itProcessesDef: ToolDefinition = {
  name: 'it_processes',
  description: 'List running processes or terminate a specific one by name or PID. Kill action always requires prior approval. Returns process list with name, PID, CPU%, and memory.',
  category: 'general',
  riskLevel: 'high',
  estimatedCostCents: 0,
  inputSchema: {
    action: { type: 'string', description: '"list" | "kill"' },
    target: { type: 'string', description: 'Process name or PID (required for kill)' },
    topN:   { type: 'number', description: 'Top N processes by CPU for list (default 30, max 100)' },
    sortBy: { type: 'string', description: '"cpu" | "memory" | "name" (default: cpu)' },
  },
};

export interface ProcessEntry {
  pid: number; name: string; cpu?: number; memMB?: number; status?: string;
}

export interface ProcessesResult {
  action: string; processes?: ProcessEntry[]; killed?: string;
  ok: boolean; error?: string; capturedAt: number;
}

function listWindowsProcesses(topN: number, sortBy: string): ProcessEntry[] {
  const sortProp = sortBy === 'memory' ? 'WorkingSet' : sortBy === 'name' ? 'ProcessName' : 'CPU';
  try {
    const out = execSync(`powershell -NoProfile -Command "Get-Process | Sort-Object ${sortProp} -Descending | Select-Object -First ${topN} | Select-Object Id,ProcessName,CPU,WorkingSet | ConvertTo-Json -Depth 2"`, { timeout: 10_000 }).toString().trim();
    if (!out) return [];
    const arr = Array.isArray(JSON.parse(out)) ? JSON.parse(out) : [JSON.parse(out)];
    return arr.map((p: Record<string, unknown>) => ({
      pid: Number(p['Id'] ?? 0), name: String(p['ProcessName'] ?? ''),
      cpu: Math.round(Number(p['CPU'] ?? 0) * 10) / 10,
      memMB: Math.round(Number(p['WorkingSet'] ?? 0) / (1024 * 1024) * 10) / 10,
    }));
  } catch { return []; }
}

function listUnixProcesses(topN: number): ProcessEntry[] {
  try {
    const out = execSync(`ps aux --sort=-%cpu 2>/dev/null | head -${topN + 1}`, { timeout: 8000 }).toString();
    return out.split('\n').slice(1).filter(Boolean).map(line => {
      const p = line.split(/\s+/);
      return { pid: Number(p[1] ?? 0), name: p[10] ?? 'unknown', cpu: parseFloat(p[2] ?? '0'), memMB: parseFloat(p[3] ?? '0') };
    });
  } catch { return []; }
}

function killProcess(target: string): { ok: boolean; error?: string } {
  try {
    const isPid = /^\d+$/.test(target.trim());
    if (process.platform === 'win32') {
      execSync(`taskkill /F ${isPid ? `/PID ${target}` : `/IM "${target}"`}`, { timeout: 10_000 });
    } else {
      execSync(isPid ? `kill -9 ${target}` : `pkill -f "${target}"`, { timeout: 10_000 });
    }
    return { ok: true };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

export async function runItProcesses(args: Record<string, unknown>, ctx: ToolContext): Promise<ProcessesResult> {
  const action = String(args.action ?? 'list').toLowerCase();
  const target = String(args.target ?? '');
  const topN   = Math.min(Number(args.topN ?? 30), 100);
  const sortBy = String(args.sortBy ?? 'cpu').toLowerCase();

  let result: ProcessesResult;
  if (action === 'list') {
    const processes = process.platform === 'win32' ? listWindowsProcesses(topN, sortBy) : listUnixProcesses(topN);
    result = { action, processes, ok: true, capturedAt: Date.now() };
  } else if (action === 'kill') {
    if (!target.trim()) {
      result = { action, ok: false, error: 'target (name or PID) is required for kill', capturedAt: Date.now() };
    } else {
      const res = killProcess(target);
      result = { action, killed: target, ok: res.ok, error: res.error, capturedAt: Date.now() };
    }
  } else {
    result = { action, ok: false, error: `Unknown action "${action}". Use "list" or "kill".`, capturedAt: Date.now() };
  }

  const execResult: ExecutionResult = {
    id: crypto.randomUUID(), taskId: ctx.taskId, stepId: ctx.stepId, tool: 'it_processes',
    timestamp: Date.now(), success: result.ok, paperMode: false, data: result,
  };
  serviceLocator.logResult(execResult);
  eventBus.emit({ type: 'RESULT_LOGGED', taskId: ctx.taskId, stepId: ctx.stepId, tool: 'it_processes', success: result.ok });
  return result;
}
