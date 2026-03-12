// clipboardMonitor.ts — polls clipboard every 2s, emits SENSOR_CLIPBOARD_CHANGED on change

import { clipboard } from 'electron';
import { eventBus } from '@triforge/engine';
import type { Sensor } from './index';

export class ClipboardMonitor implements Sensor {
  readonly name = 'clipboardMonitor';
  readonly permissionKey = 'files'; // desktop content access, gated same as files

  private interval: ReturnType<typeof setInterval> | null = null;
  private lastContent = '';

  start(): void {
    this.lastContent = clipboard.readText();
    this.interval = setInterval(() => {
      try {
        const current = clipboard.readText();
        if (current && current !== this.lastContent) {
          this.lastContent = current;
          eventBus.emit({ type: 'SENSOR_CLIPBOARD_CHANGED', content: current });
        }
      } catch { /* clipboard may be locked by another process */ }
    }, 2000);
  }

  stop(): void {
    if (this.interval) { clearInterval(this.interval); this.interval = null; }
  }

  isRunning(): boolean { return this.interval !== null; }
}
