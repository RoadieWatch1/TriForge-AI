// it/networkDoctor.ts — Network diagnostics tool
// Tests DNS resolution, gateway connectivity, measures latency, and returns route hints

import * as dns from 'dns';
import * as os from 'os';
import * as crypto from 'crypto';
import { execSync } from 'child_process';
import type { ToolDefinition, ToolContext, ExecutionResult } from '../../core/taskTypes';
import { serviceLocator } from '../../core/serviceLocator';
import { eventBus } from '../../core/eventBus';

export const itNetworkDoctorDef: ToolDefinition = {
  name: 'it_network_doctor',
  description: 'Runs a network diagnostic: DNS resolution test, gateway detection, latency measurement to key hosts, and route hints. Returns structured report.',
  category: 'general',
  riskLevel: 'low',
  estimatedCostCents: 0,
  inputSchema: {
    testHosts: { type: 'string', description: 'Comma-separated hostnames to test (optional, defaults to 1.1.1.1, 8.8.8.8, google.com)' },
  },
};

export interface NetworkDoctorResult {
  online:     boolean;
  gateway?:   string;
  dnsServers: string[];
  adapters:   Array<{ name: string; address: string; mac: string }>;
  tests: Array<{
    host:          string;
    resolved?:     string;
    latencyMs?:    number;
    reachable:     boolean;
    error?:        string;
  }>;
  routeHints: string[];
  capturedAt: number;
}

function getGateway(): string | undefined {
  try {
    const isWin = process.platform === 'win32';
    const out = execSync(
      isWin ? 'powershell -Command "Get-NetRoute -DestinationPrefix 0.0.0.0/0 | Select-Object -First 1 NextHop | Format-List"'
            : 'ip route show default',
      { timeout: 5000 },
    ).toString();
    const match = isWin
      ? out.match(/NextHop\s*:\s*(\S+)/i)
      : out.match(/via\s+(\S+)/);
    return match?.[1];
  } catch { return undefined; }
}

function dnsLookup(host: string): Promise<string> {
  return new Promise((resolve, reject) => {
    dns.lookup(host, (err, addr) => {
      if (err) reject(err);
      else resolve(addr);
    });
  });
}

async function measureLatency(addr: string): Promise<number | undefined> {
  // Use ICMP ping if available via exec; fallback to DNS resolution timing
  try {
    const isWin = process.platform === 'win32';
    const cmd = isWin
      ? `ping -n 1 -w 2000 ${addr}`
      : `ping -c 1 -W 2 ${addr}`;
    const start = Date.now();
    execSync(cmd, { timeout: 5000, stdio: 'pipe' });
    return Date.now() - start;
  } catch { return undefined; }
}

function getRouteHints(tests: NetworkDoctorResult['tests'], online: boolean): string[] {
  const hints: string[] = [];
  if (!online) {
    hints.push('Network appears offline. Check physical cable or Wi-Fi connection.');
    hints.push('Try: ipconfig /release && ipconfig /renew (Windows) or dhclient (Linux)');
    hints.push('DNS flush: ipconfig /flushdns (Windows) or sudo systemd-resolve --flush-caches (Linux)');
    return hints;
  }
  const dnsOk  = tests.some(t => t.host === 'google.com' && t.resolved);
  const icmpOk = tests.some(t => t.reachable);
  if (!dnsOk)  hints.push('DNS resolution failing. Try changing DNS to 1.1.1.1 or 8.8.8.8.');
  if (!icmpOk) hints.push('ICMP blocked or hosts unreachable. Check firewall rules.');
  const high = tests.filter(t => (t.latencyMs ?? 0) > 200);
  if (high.length) hints.push(`High latency to: ${high.map(t => t.host).join(', ')}. Possible congestion or routing issue.`);
  if (!hints.length) hints.push('Network appears healthy. No issues detected.');
  return hints;
}

export async function runItNetworkDoctor(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<NetworkDoctorResult> {
  const raw = String(args.testHosts ?? '');
  const defaultHosts = ['1.1.1.1', '8.8.8.8', 'google.com', 'dns.google'];
  const testHosts = raw.trim()
    ? raw.split(',').map(h => h.trim()).filter(Boolean)
    : defaultHosts;

  const dnsServers = (dns as unknown as { getServers(): string[] }).getServers?.() ?? [];
  const gateway    = getGateway();
  const adapters   = Object.entries(os.networkInterfaces())
    .flatMap(([name, addrs]) => (addrs ?? [])
      .filter(a => a.family === 'IPv4' && !a.internal)
      .map(a => ({ name, address: a.address, mac: a.mac })));

  const tests: NetworkDoctorResult['tests'] = [];
  for (const host of testHosts) {
    try {
      const resolved = await dnsLookup(host);
      const latencyMs = await measureLatency(resolved);
      tests.push({ host, resolved, latencyMs, reachable: true });
    } catch (err) {
      tests.push({ host, reachable: false, error: (err as Error).message });
    }
  }

  const online = tests.some(t => t.reachable);
  const routeHints = getRouteHints(tests, online);

  const result: NetworkDoctorResult = {
    online, gateway, dnsServers, adapters, tests, routeHints, capturedAt: Date.now(),
  };

  const execResult: ExecutionResult = {
    id: crypto.randomUUID(),
    taskId: ctx.taskId, stepId: ctx.stepId, tool: 'it_network_doctor',
    timestamp: Date.now(), success: true, paperMode: false, data: result,
  };
  serviceLocator.logResult(execResult);
  eventBus.emit({ type: 'RESULT_LOGGED', taskId: ctx.taskId, stepId: ctx.stepId, tool: 'it_network_doctor', success: true });

  return result;
}
