// sensors/index.ts — SensorManager: starts/stops all OS sensors based on permissions

import { Store } from '../store';
import { FileWatcher } from './fileWatcher';
import { ClipboardMonitor } from './clipboardMonitor';
import { DiskMonitor } from './diskMonitor';
import { NetworkMonitor } from './networkMonitor';
import { ProcessMonitor } from './processMonitor';
import { WebMonitor } from './webMonitor';
import { EventLogMonitor } from './eventLogMonitor';
import { ServiceMonitor } from './serviceMonitor';

export interface SensorConfig {
  [key: string]: unknown;
}

export interface Sensor {
  readonly name: string;
  readonly permissionKey: string;   // empty string = no permission required
  start(config?: SensorConfig): void;
  stop(): void;
  isRunning(): boolean;
}

export class SensorManager {
  private sensors: Map<string, Sensor> = new Map();

  constructor(private store: Store) {
    this.register(new FileWatcher());
    this.register(new ClipboardMonitor());
    this.register(new DiskMonitor());
    this.register(new NetworkMonitor());
    this.register(new ProcessMonitor());
    this.register(new WebMonitor());
    this.register(new EventLogMonitor());
    this.register(new ServiceMonitor());
  }

  private register(sensor: Sensor): void {
    this.sensors.set(sensor.name, sensor);
  }

  // Call at app startup — starts sensors whose permission is already granted
  startGranted(): void {
    const perms = this.store.getPermissions();
    for (const sensor of this.sensors.values()) {
      if (sensor.isRunning()) continue;
      const needsPerm = !!sensor.permissionKey;
      const granted = !needsPerm || perms.find(p => p.key === sensor.permissionKey)?.granted;
      if (granted) {
        try { sensor.start(); } catch { /* ignore startup errors */ }
      }
    }
  }

  // Call when user grants or revokes a permission
  onPermissionChange(key: string, granted: boolean): void {
    for (const sensor of this.sensors.values()) {
      if (sensor.permissionKey !== key) continue;
      if (granted && !sensor.isRunning()) {
        try { sensor.start(); } catch { /* ignore */ }
      } else if (!granted && sensor.isRunning()) {
        sensor.stop();
      }
    }
  }

  startSensor(name: string, config?: SensorConfig): { ok?: boolean; error?: string } {
    const sensor = this.sensors.get(name);
    if (!sensor) return { error: `Unknown sensor: ${name}` };
    const perms = this.store.getPermissions();
    if (sensor.permissionKey && !perms.find(p => p.key === sensor.permissionKey)?.granted) {
      return { error: `PERMISSION_DENIED:${sensor.permissionKey}` };
    }
    try {
      if (!sensor.isRunning()) sensor.start(config);
      return { ok: true };
    } catch (e) {
      return { error: e instanceof Error ? e.message : String(e) };
    }
  }

  stopSensor(name: string): { ok?: boolean; error?: string } {
    const sensor = this.sensors.get(name);
    if (!sensor) return { error: `Unknown sensor: ${name}` };
    sensor.stop();
    return { ok: true };
  }

  stopAll(): void {
    for (const sensor of this.sensors.values()) {
      if (sensor.isRunning()) sensor.stop();
    }
  }

  listSensors(): Array<{ name: string; running: boolean; permissionKey: string }> {
    return Array.from(this.sensors.values()).map(s => ({
      name: s.name,
      running: s.isRunning(),
      permissionKey: s.permissionKey,
    }));
  }

  getSensor<T extends Sensor>(name: string): T | undefined {
    return this.sensors.get(name) as T | undefined;
  }
}
