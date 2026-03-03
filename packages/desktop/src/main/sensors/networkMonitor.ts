// networkMonitor.ts — checks connectivity every 30s via DNS lookup

import dns from 'dns';
import { promisify } from 'util';
import { eventBus } from '@triforge/engine';
import type { Sensor } from './index';

const lookup = promisify(dns.lookup);

export class NetworkMonitor implements Sensor {
  readonly name = 'networkMonitor';
  readonly permissionKey = ''; // no permission required — passive health check

  private interval: ReturnType<typeof setInterval> | null = null;
  private wasOnline = true;

  start(): void {
    this.interval = setInterval(() => this.check(), 30_000);
  }

  private async check(): Promise<void> {
    try {
      await lookup('dns.google');
      if (!this.wasOnline) {
        this.wasOnline = true;
        eventBus.emit({ type: 'SENSOR_NETWORK_UP', adapter: 'default' });
      }
    } catch {
      if (this.wasOnline) {
        this.wasOnline = false;
        eventBus.emit({ type: 'SENSOR_NETWORK_DOWN', adapter: 'default' });
      }
    }
  }

  stop(): void {
    if (this.interval) { clearInterval(this.interval); this.interval = null; }
  }

  isRunning(): boolean { return this.interval !== null; }
}
