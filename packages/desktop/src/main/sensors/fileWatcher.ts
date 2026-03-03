// fileWatcher.ts — watches Desktop, Downloads, Documents for new files

import fs from 'fs';
import path from 'path';
import os from 'os';
import { eventBus } from '@triforge/engine';
import type { Sensor, SensorConfig } from './index';

export class FileWatcher implements Sensor {
  readonly name = 'fileWatcher';
  readonly permissionKey = 'files';

  private watchers: fs.FSWatcher[] = [];

  start(config?: SensorConfig): void {
    const defaultDirs = [
      path.join(os.homedir(), 'Desktop'),
      path.join(os.homedir(), 'Downloads'),
      path.join(os.homedir(), 'Documents'),
    ];
    const dirs = (config?.dirs as string[] | undefined) ?? defaultDirs;

    for (const dir of dirs) {
      try {
        if (!fs.existsSync(dir)) continue;
        const watcher = fs.watch(dir, (_event, filename) => {
          if (filename) {
            const fullPath = path.join(dir, filename);
            try {
              if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
                eventBus.emit({ type: 'SENSOR_FILE_NEW', path: fullPath, name: filename, dir });
              }
            } catch { /* file may have been deleted immediately */ }
          }
        });
        this.watchers.push(watcher);
      } catch { /* dir may not be accessible */ }
    }
  }

  stop(): void {
    this.watchers.forEach(w => { try { w.close(); } catch { /* ignore */ } });
    this.watchers = [];
  }

  isRunning(): boolean { return this.watchers.length > 0; }
}
