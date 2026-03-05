// ── WorkspaceObserver.ts — File system watcher using chokidar ────────────────
import chokidar from 'chokidar';
import { EventEmitter } from 'events';
import { AUTONOMY_FLAGS } from '../config/autonomyFlags';

export class WorkspaceObserver extends EventEmitter {
  private watcher: chokidar.FSWatcher | null = null;

  start(root: string): void {
    if (!AUTONOMY_FLAGS.enableAutonomyLoop) {
      console.info('[WorkspaceObserver] autonomy loop disabled (enableAutonomyLoop=false)');
      return;
    }
    if (this.watcher) return; // already running
    this.watcher = chokidar.watch(root, {
      ignored: /node_modules|\.git|dist|out|\.claude|\.triforge-experiments/,
      persistent: true,
      ignoreInitial: true,
      awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
    });
    this.watcher.on('change', (p) => this.emit('file_changed', p));
    this.watcher.on('add',    (p) => this.emit('file_added',   p));
    this.watcher.on('unlink', (p) => this.emit('file_removed', p));
  }

  stop(): void {
    this.watcher?.close();
    this.watcher = null;
  }
}
