// diskMonitor.ts — checks disk free space every 5 minutes, alerts when < threshold

import fs from 'fs';
import os from 'os';
import { eventBus } from '@triforge/engine';
import type { Sensor } from './index';

const THRESHOLD_GB = 5; // alert when free space drops below 5GB

export class DiskMonitor implements Sensor {
  readonly name = 'diskMonitor';
  readonly permissionKey = ''; // no permission required — passive health check

  private interval: ReturnType<typeof setInterval> | null = null;

  start(): void {
    this.check();
    this.interval = setInterval(() => this.check(), 5 * 60 * 1000);
  }

  private check(): void {
    const homePath = os.homedir();
    try {
      // fs.statfsSync available Node 18+; cast to any for older type defs
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const stats = (fs as any).statfsSync?.(homePath);
      if (stats) {
        const freeGB  = (stats.bfree  * stats.bsize) / (1024 ** 3);
        const totalGB = (stats.blocks * stats.bsize) / (1024 ** 3);
        if (freeGB < THRESHOLD_GB) {
          eventBus.emit({
            type: 'SENSOR_DISK_LOW',
            path: homePath,
            freeGB:  Math.round(freeGB  * 10) / 10,
            totalGB: Math.round(totalGB * 10) / 10,
          });
        }
      }
    } catch { /* statfsSync not available on this Node version */ }
  }

  stop(): void {
    if (this.interval) { clearInterval(this.interval); this.interval = null; }
  }

  isRunning(): boolean { return this.interval !== null; }
}
