// webMonitor.ts — watches URLs for content changes, emits SENSOR_WEBSITE_CHANGED

import https from 'https';
import http from 'http';
import { eventBus } from '@triforge/engine';
import type { Sensor, SensorConfig } from './index';

interface WatchEntry {
  url: string;
  intervalMs: number;
  lastContent?: string;
  timer?: ReturnType<typeof setInterval>;
}

export class WebMonitor implements Sensor {
  readonly name = 'webMonitor';
  readonly permissionKey = 'browser';

  private watched: WatchEntry[] = [];

  start(config?: SensorConfig): void {
    const urls = (config?.urls as Array<{ url: string; interval?: number }> | undefined) ?? [];
    for (const entry of urls) {
      this.addUrl(entry.url, entry.interval ?? 60_000);
    }
  }

  addUrl(url: string, intervalMs = 60_000): void {
    if (this.watched.find(w => w.url === url)) return; // already watching
    const entry: WatchEntry = { url, intervalMs };
    this.fetchOnce(entry); // immediate first check establishes baseline
    entry.timer = setInterval(() => this.fetchOnce(entry), intervalMs);
    this.watched.push(entry);
  }

  removeUrl(url: string): void {
    const idx = this.watched.findIndex(w => w.url === url);
    if (idx >= 0) {
      const entry = this.watched[idx];
      if (entry.timer) clearInterval(entry.timer);
      this.watched.splice(idx, 1);
    }
  }

  private fetchOnce(entry: WatchEntry): void {
    const lib = entry.url.startsWith('https') ? https : http;
    let body = '';
    try {
      lib.get(entry.url, { timeout: 10_000 }, res => {
        res.on('data', (chunk: Buffer) => { body += chunk.toString(); });
        res.on('end', () => {
          const trimmed = body.slice(0, 10_000); // cap diff scope at 10KB
          if (entry.lastContent !== undefined && trimmed !== entry.lastContent) {
            eventBus.emit({ type: 'SENSOR_WEBSITE_CHANGED', url: entry.url, diff: `Content changed (${body.length} chars)` });
          }
          entry.lastContent = trimmed;
        });
      }).on('error', () => { /* ignore fetch errors — network may be down */ });
    } catch { /* ignore */ }
  }

  stop(): void {
    for (const entry of this.watched) {
      if (entry.timer) clearInterval(entry.timer);
    }
    this.watched = [];
  }

  isRunning(): boolean { return this.watched.length > 0; }
}
