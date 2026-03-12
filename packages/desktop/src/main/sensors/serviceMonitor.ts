// serviceMonitor.ts — Watches specific services for status changes every 30–60s
// Windows: PowerShell Get-Service
// macOS/Linux: systemctl is-active / launchctl list
// Emits: SENSOR_SERVICE_ALERT { name, status: 'stopped'|'running'|'restarting' }

import { execSync } from 'child_process';
import { eventBus } from '@triforge/engine';
import type { Sensor, SensorConfig } from './index';

interface ServiceState {
  name: string;
  status: 'running' | 'stopped' | 'restarting' | 'unknown';
}

export class ServiceMonitor implements Sensor {
  readonly name = 'serviceMonitor';
  readonly permissionKey = 'terminal';

  private interval: ReturnType<typeof setInterval> | null = null;
  private watchList: string[] = [];
  private knownStates = new Map<string, string>();

  start(config?: SensorConfig): void {
    this.watchList = (config?.watchList as string[] | undefined) ?? [];
    if (this.watchList.length === 0) return;
    this.knownStates = this.getStates();
    this.interval = setInterval(() => this.check(), 30_000);
  }

  private getServiceStatus(name: string): string {
    try {
      if (process.platform === 'win32') {
        const out = execSync(`powershell -NoProfile -Command "(Get-Service '${name}' -ErrorAction SilentlyContinue).Status"`, { timeout: 5000 }).toString().trim().toLowerCase();
        return out || 'unknown';
      } else if (process.platform === 'linux') {
        const out = execSync(`systemctl is-active ${name} 2>/dev/null`, { timeout: 5000 }).toString().trim();
        return out; // 'active', 'inactive', 'activating', 'failed', etc.
      } else {
        // macOS
        const out = execSync(`launchctl print system/${name} 2>/dev/null | grep -i state`, { timeout: 5000 }).toString().trim();
        return out.includes('running') ? 'running' : 'stopped';
      }
    } catch { return 'unknown'; }
  }

  private getStates(): Map<string, string> {
    const states = new Map<string, string>();
    for (const svc of this.watchList) {
      states.set(svc, this.getServiceStatus(svc));
    }
    return states;
  }

  private normalizeStatus(raw: string): 'running' | 'stopped' | 'restarting' {
    const s = raw.toLowerCase();
    if (s === 'running' || s === 'active') return 'running';
    if (s === 'activating' || s === 'reloading' || s === 'stop-sigterm') return 'restarting';
    return 'stopped';
  }

  private check(): void {
    if (this.watchList.length === 0) return;
    for (const svc of this.watchList) {
      const current  = this.getServiceStatus(svc);
      const previous = this.knownStates.get(svc) ?? 'unknown';
      if (current !== previous) {
        this.knownStates.set(svc, current);
        eventBus.emit({
          type:   'SENSOR_SERVICE_ALERT',
          name:   svc,
          status: this.normalizeStatus(current),
        });
      }
    }
  }

  stop(): void {
    if (this.interval) { clearInterval(this.interval); this.interval = null; }
  }

  isRunning(): boolean { return this.interval !== null; }
}
