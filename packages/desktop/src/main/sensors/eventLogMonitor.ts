// eventLogMonitor.ts — Watches for new critical/error events in the Windows Event Log
// macOS/Linux: polls journalctl/syslog for error-level entries
// Emits: SENSOR_EVENTLOG_ALERT { source, level, message, eventId, ts }

import { execSync } from 'child_process';
import { eventBus } from '@triforge/engine';
import type { Sensor, SensorConfig } from './index';

export class EventLogMonitor implements Sensor {
  readonly name = 'eventLogMonitor';
  readonly permissionKey = 'terminal';  // requires terminal/admin access to read event log

  private interval: ReturnType<typeof setInterval> | null = null;
  private lastCursor: number = Date.now();
  private logName: string = 'System';
  private intervalMs: number = 60_000;

  start(config?: SensorConfig): void {
    this.logName    = String(config?.logName    ?? 'System');
    this.intervalMs = Number(config?.intervalMs ?? 60_000);
    this.lastCursor = Date.now();
    this.interval   = setInterval(() => this.check(), this.intervalMs);
  }

  private check(): void {
    try {
      const since = new Date(this.lastCursor).toISOString();
      this.lastCursor = Date.now();

      if (process.platform === 'win32') {
        this.checkWindows(since);
      } else {
        this.checkUnix();
      }
    } catch { /* ignore poll errors */ }
  }

  private checkWindows(since: string): void {
    const cmd = `powershell -NoProfile -Command "
      Get-WinEvent -LogName '${this.logName}' -ErrorAction SilentlyContinue |
      Where-Object { $_.TimeCreated -gt [DateTime]'${since}' -and $_.Level -le 2 } |
      Select-Object -First 10 |
      ForEach-Object {
        [PSCustomObject]@{
          Id = $_.Id;
          Level = $_.LevelDisplayName;
          Provider = $_.ProviderName;
          Message = ($_.Message -replace '\n',' ' -replace '\r','') | Select-Object -First 1;
          Time = $_.TimeCreated.ToUniversalTime().ToString('o')
        }
      } | ConvertTo-Json -Depth 2
    "`;
    try {
      const out = execSync(cmd, { timeout: 15_000 }).toString().trim();
      if (!out) return;
      const raw = JSON.parse(out) as unknown;
      const arr = Array.isArray(raw) ? raw : [raw];
      for (const e of arr as Array<Record<string, unknown>>) {
        eventBus.emit({
          type:    'SENSOR_EVENTLOG_ALERT',
          source:  String(e['Provider'] ?? 'Unknown'),
          level:   String(e['Level'] ?? 'Error'),
          message: String(e['Message'] ?? '').slice(0, 300),
          eventId: Number(e['Id'] ?? 0),
          ts:      new Date(String(e['Time'] ?? '')).getTime() || Date.now(),
        });
      }
    } catch { /* PowerShell error or empty output */ }
  }

  private checkUnix(): void {
    try {
      const mins   = Math.ceil(this.intervalMs / 60_000);
      const isLinux = process.platform === 'linux';
      const out = isLinux
        ? execSync(`journalctl -p err --since "${mins} minutes ago" -n 10 --output short-iso --no-pager 2>/dev/null`, { timeout: 8000 }).toString()
        : execSync(`log show --last ${mins}m --predicate 'messageType >= 16' --style compact 2>/dev/null | head -10`, { timeout: 8000 }).toString();

      for (const line of out.split('\n').filter(Boolean).slice(0, 10)) {
        eventBus.emit({
          type:    'SENSOR_EVENTLOG_ALERT',
          source:  'System',
          level:   'Error',
          message: line.trim().slice(0, 300),
          eventId: 0,
          ts:      Date.now(),
        });
      }
    } catch { /* ignore */ }
  }

  stop(): void {
    if (this.interval) { clearInterval(this.interval); this.interval = null; }
  }

  isRunning(): boolean { return this.interval !== null; }
}
