// it/diagnostics.ts — Machine Snapshot tool
// Returns a structured overview of the local machine's health:
// CPU load, memory, disk, OS version, uptime, network adapters

import * as os from 'os';
import * as crypto from 'crypto';
import type { ToolDefinition, ToolContext, ExecutionResult } from '../../core/taskTypes';
import { serviceLocator } from '../../core/serviceLocator';
import { eventBus } from '../../core/eventBus';

export const itDiagnosticsDef: ToolDefinition = {
  name: 'it_diagnostics',
  description: 'Returns a structured Machine Snapshot: CPU load, memory usage, disk free space, OS version, uptime, and network adapters. Safe read-only operation.',
  category: 'general',
  riskLevel: 'low',
  estimatedCostCents: 0,
  inputSchema: {},
};

export interface MachineSnapshot {
  hostname:    string;
  platform:    string;
  osRelease:   string;
  arch:        string;
  uptimeHours: number;
  cpu: {
    model:       string;
    cores:       number;
    loadAvg1m:   number;   // unix only; 0 on Windows
    usagePercent: number;  // derived from os.cpus idle vs total
  };
  memory: {
    totalGB:  number;
    freeGB:   number;
    usedPercent: number;
  };
  disks: Array<{ mount: string; totalGB: number; freeGB: number; usedPercent: number }>;
  networkAdapters: Array<{ name: string; address: string; mac: string }>;
  capturedAt: number;
}

function getCpuUsage(): number {
  const cpus = os.cpus();
  let idle = 0, total = 0;
  for (const cpu of cpus) {
    for (const val of Object.values(cpu.times)) { total += val; }
    idle += cpu.times.idle;
  }
  return total > 0 ? Math.round((1 - idle / total) * 100) : 0;
}

function getDiskInfo(): Array<{ mount: string; totalGB: number; freeGB: number; usedPercent: number }> {
  // Try fs.statfsSync (Node 18+) on homedir and root
  const fs = require('fs') as typeof import('fs');
  const mounts = process.platform === 'win32'
    ? ['C:\\', os.homedir()]
    : ['/', os.homedir()];
  const seen = new Set<string>();
  const result: Array<{ mount: string; totalGB: number; freeGB: number; usedPercent: number }> = [];
  for (const mount of mounts) {
    if (seen.has(mount)) continue;
    seen.add(mount);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stats = (fs as any).statfsSync?.(mount);
      if (stats) {
        const totalGB = (stats.blocks * stats.bsize) / (1024 ** 3);
        const freeGB  = (stats.bfree  * stats.bsize) / (1024 ** 3);
        result.push({
          mount,
          totalGB:     Math.round(totalGB * 10) / 10,
          freeGB:      Math.round(freeGB  * 10) / 10,
          usedPercent: totalGB > 0 ? Math.round((1 - freeGB / totalGB) * 100) : 0,
        });
      }
    } catch { /* statfsSync not available or access denied */ }
  }
  return result;
}

function getNetworkAdapters(): Array<{ name: string; address: string; mac: string }> {
  const ifaces = os.networkInterfaces();
  const result: Array<{ name: string; address: string; mac: string }> = [];
  for (const [name, addrs] of Object.entries(ifaces)) {
    if (!addrs) continue;
    for (const addr of addrs) {
      if (addr.family === 'IPv4' && !addr.internal) {
        result.push({ name, address: addr.address, mac: addr.mac });
      }
    }
  }
  return result;
}

export async function runItDiagnostics(
  _args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<MachineSnapshot> {
  const totalMem = os.totalmem();
  const freeMem  = os.freemem();

  const snapshot: MachineSnapshot = {
    hostname:    os.hostname(),
    platform:    os.platform(),
    osRelease:   os.release(),
    arch:        os.arch(),
    uptimeHours: Math.round(os.uptime() / 3600 * 10) / 10,
    cpu: {
      model:        os.cpus()[0]?.model ?? 'Unknown',
      cores:        os.cpus().length,
      loadAvg1m:    os.platform() !== 'win32' ? Math.round(os.loadavg()[0] * 100) / 100 : 0,
      usagePercent: getCpuUsage(),
    },
    memory: {
      totalGB:     Math.round(totalMem / (1024 ** 3) * 10) / 10,
      freeGB:      Math.round(freeMem  / (1024 ** 3) * 10) / 10,
      usedPercent: Math.round((1 - freeMem / totalMem) * 100),
    },
    disks:           getDiskInfo(),
    networkAdapters: getNetworkAdapters(),
    capturedAt:      Date.now(),
  };

  const execResult: ExecutionResult = {
    id: crypto.randomUUID(),
    taskId: ctx.taskId, stepId: ctx.stepId, tool: 'it_diagnostics',
    timestamp: Date.now(), success: true, paperMode: false,
    data: snapshot,
  };
  serviceLocator.logResult(execResult);
  eventBus.emit({ type: 'RESULT_LOGGED', taskId: ctx.taskId, stepId: ctx.stepId, tool: 'it_diagnostics', success: true });

  return snapshot;
}
