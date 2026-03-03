// processMonitor.ts — watches for specific processes starting/stopping every 30s

import { execSync } from 'child_process';
import { eventBus } from '@triforge/engine';
import type { Sensor, SensorConfig } from './index';

export class ProcessMonitor implements Sensor {
  readonly name = 'processMonitor';
  readonly permissionKey = 'terminal';

  private interval: ReturnType<typeof setInterval> | null = null;
  private knownProcesses = new Set<string>();
  private watchList: string[] = [];

  start(config?: SensorConfig): void {
    this.watchList = (config?.watchList as string[] | undefined) ?? [];
    this.knownProcesses = this.getRunning();
    this.interval = setInterval(() => this.check(), 30_000);
  }

  private getRunning(): Set<string> {
    try {
      const isWin = process.platform === 'win32';
      const cmd = isWin ? 'tasklist /fo csv /nh' : 'ps -eo comm';
      const out = execSync(cmd, { timeout: 5000 }).toString();
      const names = new Set<string>();
      if (isWin) {
        for (const line of out.split('\n').filter(Boolean)) {
          const name = line.split('","')[0]?.replace(/"/g, '').toLowerCase();
          if (name) names.add(name);
        }
      } else {
        for (const line of out.split('\n').slice(1).filter(Boolean)) {
          names.add(line.trim().toLowerCase());
        }
      }
      return names;
    } catch { return new Set(); }
  }

  private check(): void {
    if (this.watchList.length === 0) return;
    const current = this.getRunning();
    for (const proc of this.watchList) {
      const key = proc.toLowerCase();
      const wasRunning = this.knownProcesses.has(key);
      const isRunning  = current.has(key);
      if (!wasRunning && isRunning)  eventBus.emit({ type: 'SENSOR_PROCESS_ALERT', name: proc, status: 'started' });
      if (wasRunning  && !isRunning) eventBus.emit({ type: 'SENSOR_PROCESS_ALERT', name: proc, status: 'stopped' });
    }
    this.knownProcesses = current;
  }

  stop(): void {
    if (this.interval) { clearInterval(this.interval); this.interval = null; }
  }

  isRunning(): boolean { return this.interval !== null; }
}
