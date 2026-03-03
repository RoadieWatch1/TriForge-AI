// it/services.ts — List and restart system services
// Windows: PowerShell Get-Service + Restart-Service
// macOS/Linux: launchctl / systemctl
// State-changing actions always require requiresApproval: true in workflow

import { execSync } from 'child_process';
import * as crypto from 'crypto';
import type { ToolDefinition, ToolContext, ExecutionResult } from '../../core/taskTypes';
import { serviceLocator } from '../../core/serviceLocator';
import { eventBus } from '../../core/eventBus';

export const itServicesDef: ToolDefinition = {
  name: 'it_services',
  description: 'List running/stopped system services, or restart/stop/start a specific service. State-changing actions always require prior approval in workflow. Returns service name, status, and start type.',
  category: 'general',
  riskLevel: 'high',
  estimatedCostCents: 0,
  inputSchema: {
    action:      { type: 'string', description: '"list" | "restart" | "stop" | "start"' },
    serviceName: { type: 'string', description: 'Service name (required for restart/stop/start)' },
    filter:      { type: 'string', description: 'For list: "all" | "running" | "stopped" (default: all)' },
  },
};

export interface ServiceEntry {
  name: string; displayName: string; status: string; startType?: string;
}

export interface ServicesResult {
  action: string; services?: ServiceEntry[]; affected?: string;
  status?: string; ok: boolean; error?: string; capturedAt: number;
}

function listWindowsServices(filter: string): ServiceEntry[] {
  const f = filter === 'running' ? '| Where-Object Status -eq Running'
          : filter === 'stopped' ? '| Where-Object Status -eq Stopped' : '';
  try {
    const out = execSync(`powershell -NoProfile -Command "Get-Service ${f} | Select-Object Name,DisplayName,Status,StartType | ConvertTo-Json -Depth 2"`, { timeout: 10_000 }).toString().trim();
    if (!out) return [];
    const arr = Array.isArray(JSON.parse(out)) ? JSON.parse(out) : [JSON.parse(out)];
    return arr.map((s: Record<string, unknown>) => ({
      name: String(s['Name'] ?? ''), displayName: String(s['DisplayName'] ?? ''),
      status: String(s['Status'] ?? ''), startType: String(s['StartType'] ?? ''),
    }));
  } catch { return []; }
}

function listUnixServices(): ServiceEntry[] {
  try {
    const out = process.platform === 'linux'
      ? execSync('systemctl list-units --type=service --no-pager --plain --no-legend 2>/dev/null | head -50', { timeout: 8000 }).toString()
      : execSync('launchctl list 2>/dev/null | head -50', { timeout: 8000 }).toString();
    return out.split('\n').filter(Boolean).map(line => {
      const p = line.split(/\s+/);
      return { name: p[0] ?? line, displayName: line.trim(), status: p[2] ?? 'unknown' };
    });
  } catch { return []; }
}

function changeWindowsService(action: string, name: string): { ok: boolean; error?: string } {
  const verb = action === 'restart' ? 'Restart-Service' : action === 'stop' ? 'Stop-Service' : 'Start-Service';
  try { execSync(`powershell -NoProfile -Command "${verb} -Name '${name}' -Force -ErrorAction Stop"`, { timeout: 30_000 }); return { ok: true }; }
  catch (e) { return { ok: false, error: (e as Error).message }; }
}

function changeUnixService(action: string, name: string): { ok: boolean; error?: string } {
  const cmd = process.platform === 'linux' ? `sudo systemctl ${action} ${name}` : `sudo launchctl ${action === 'restart' ? 'kickstart -k' : action} gui/$(id -u)/${name}`;
  try { execSync(cmd, { timeout: 30_000 }); return { ok: true }; }
  catch (e) { return { ok: false, error: (e as Error).message }; }
}

export async function runItServices(args: Record<string, unknown>, ctx: ToolContext): Promise<ServicesResult> {
  const action = String(args.action ?? 'list').toLowerCase();
  const serviceName = String(args.serviceName ?? '');
  const filter = String(args.filter ?? 'all').toLowerCase();

  let result: ServicesResult;
  if (action === 'list') {
    const services = process.platform === 'win32' ? listWindowsServices(filter) : listUnixServices();
    result = { action, services, ok: true, capturedAt: Date.now() };
  } else if (!serviceName.trim()) {
    result = { action, ok: false, error: 'serviceName is required for non-list actions', capturedAt: Date.now() };
  } else {
    const res = process.platform === 'win32' ? changeWindowsService(action, serviceName) : changeUnixService(action, serviceName);
    result = { action, affected: serviceName, status: res.ok ? `${action}ed` : 'failed', ok: res.ok, error: res.error, capturedAt: Date.now() };
  }

  const execResult: ExecutionResult = {
    id: crypto.randomUUID(), taskId: ctx.taskId, stepId: ctx.stepId, tool: 'it_services',
    timestamp: Date.now(), success: result.ok, paperMode: false, data: result,
  };
  serviceLocator.logResult(execResult);
  eventBus.emit({ type: 'RESULT_LOGGED', taskId: ctx.taskId, stepId: ctx.stepId, tool: 'it_services', success: result.ok });
  return result;
}
