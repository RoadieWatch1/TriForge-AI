// ── screenWatcher.ts ──────────────────────────────────────────────────────────
//
// Continuous Screen Change Watcher
//
// Runs a background loop that:
//   1. Takes a screenshot every N seconds (configurable, default 3s)
//   2. Compares it to the previous screenshot using a fast pixel hash
//   3. Emits a SCREEN_CHANGED event when significant change is detected
//   4. Optionally runs vision analysis on changes to classify what changed
//
// Use cases:
//   - Detect when a dialog, keyboard, or error popup appears
//   - Trigger re-assessment when an app's state changes
//   - Confirm that an action had the expected effect
//   - Alert the operator when the screen changes unexpectedly during a task
//
// The watcher is lightweight: it uses sampled pixel comparison (not full diff)
// to minimize CPU/memory impact, only running the full vision pass when the
// fast hash shows a significant change.

import crypto  from 'crypto';
import path    from 'path';
import os      from 'os';
import fs      from 'fs';
import { eventBus } from '@triforge/engine';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ScreenChangeEvent {
  timestamp:       number;
  screenshotPath:  string;
  previousPath?:   string;
  changeScore:     number;   // 0–100, higher = more change
  significant:     boolean;  // true if above the threshold
}

export interface ScreenWatcherConfig {
  /** Poll interval in milliseconds. Default: 3000 (3 seconds) */
  intervalMs?:          number;
  /** Change score threshold to emit a SCREEN_CHANGED event (0–100). Default: 15 */
  changeThreshold?:     number;
  /** Directory to store screenshots. Default: os.tmpdir() */
  outputDir?:           string;
  /** Maximum number of screenshots to keep on disk (oldest deleted). Default: 5 */
  maxScreenshots?:      number;
  /** If true, run vision analysis on each significant change. Default: false */
  visionOnChange?:      boolean;
}

export interface ScreenWatcherState {
  running:           boolean;
  startedAt?:        number;
  lastCheckAt?:      number;
  lastChangedAt?:    number;
  lastScreenshotPath?: string;
  changeCount:       number;
  intervalMs:        number;
  threshold:         number;
}

// ── Capture backend (platform agnostic via operatorService) ───────────────────

// We import lazily to avoid circular deps
async function captureScreenshot(outputPath: string): Promise<boolean> {
  try {
    const { OperatorService } = await import('./operatorService.js');
    const result = await OperatorService.captureScreen(outputPath);
    return result.ok;
  } catch {
    return false;
  }
}

// ── Fast pixel hash ───────────────────────────────────────────────────────────

/**
 * Compute a fast fingerprint of a PNG file by reading a sample of bytes
 * (start, middle, end of file). This avoids reading the entire file for
 * large screenshots and gives a good-enough change signal.
 */
async function fastFileHash(filePath: string): Promise<string | null> {
  try {
    const stat = await fs.promises.stat(filePath);
    if (stat.size < 100) return null;

    const handle  = await fs.promises.open(filePath, 'r');
    const sampleSize = Math.min(4096, Math.floor(stat.size / 3));
    const buf1 = Buffer.alloc(sampleSize);
    const buf2 = Buffer.alloc(sampleSize);
    const buf3 = Buffer.alloc(sampleSize);

    await handle.read(buf1, 0, sampleSize, 0);
    await handle.read(buf2, 0, sampleSize, Math.floor(stat.size / 2));
    await handle.read(buf3, 0, sampleSize, stat.size - sampleSize);
    await handle.close();

    const combined = Buffer.concat([buf1, buf2, buf3]);
    return crypto.createHash('md5').update(combined).digest('hex');
  } catch {
    return null;
  }
}

/**
 * Estimate how much the screen changed (0–100) based on file hashes.
 * This is a heuristic: identical hash = 0, different hash = ~50–100
 * scaled by relative file size difference.
 */
function estimateChangeScore(
  prevHash: string | null,
  currHash: string | null,
  prevSize: number,
  currSize: number,
): number {
  if (!prevHash || !currHash) return 0;
  if (prevHash === currHash) return 0;

  // Different hash = meaningful change
  // Scale by file size difference: larger size delta = more content changed
  const sizeDelta = Math.abs(currSize - prevSize) / Math.max(prevSize, currSize, 1);
  const baseScore = 40;
  const sizeBonus = Math.round(sizeDelta * 60);
  return Math.min(100, baseScore + sizeBonus);
}

// ── Watcher state ─────────────────────────────────────────────────────────────

let _timer:       ReturnType<typeof setInterval> | null = null;
let _state:       ScreenWatcherState = {
  running:    false,
  changeCount: 0,
  intervalMs: 3000,
  threshold:  15,
};
let _prevHash:    string | null = null;
let _prevSize:    number = 0;
let _prevPath:    string | null = null;
let _screenshotQueue: string[] = [];
let _config:      Required<ScreenWatcherConfig> = {
  intervalMs:      3000,
  changeThreshold: 15,
  outputDir:       os.tmpdir(),
  maxScreenshots:  5,
  visionOnChange:  false,
};

// ── Screenshot rotation ───────────────────────────────────────────────────────

function nextScreenshotPath(): string {
  const name = `tf-watch-${Date.now()}.png`;
  return path.join(_config.outputDir, name);
}

function pruneOldScreenshots(): void {
  while (_screenshotQueue.length > _config.maxScreenshots) {
    const old = _screenshotQueue.shift();
    if (old) {
      fs.unlink(old, () => { /* best-effort */ });
    }
  }
}

// ── Poll tick ─────────────────────────────────────────────────────────────────

async function tick(): Promise<void> {
  if (!_state.running) return;

  const outputPath = nextScreenshotPath();
  const captured   = await captureScreenshot(outputPath);
  if (!captured) return;

  _state.lastCheckAt = Date.now();
  _screenshotQueue.push(outputPath);
  pruneOldScreenshots();

  let currSize = 0;
  try {
    currSize = (await fs.promises.stat(outputPath)).size;
  } catch { return; }

  const currHash  = await fastFileHash(outputPath);
  const score     = estimateChangeScore(_prevHash, currHash, _prevSize, currSize);
  const significant = score >= _config.changeThreshold;

  if (significant && _prevHash !== null) {
    _state.lastChangedAt = Date.now();
    _state.changeCount++;
    _state.lastScreenshotPath = outputPath;

    const changeEvent: ScreenChangeEvent = {
      timestamp:      Date.now(),
      screenshotPath: outputPath,
      previousPath:   _prevPath ?? undefined,
      changeScore:    score,
      significant:    true,
    };

    // Emit on the engine event bus so any subscriber can react
    eventBus.emit({
      type:    'SCREEN_CHANGED' as never,
      ...changeEvent,
    } as never);

    // Optional: run vision analysis on the new screenshot
    if (_config.visionOnChange) {
      (async () => {
        try {
          const { describeScreen } = await import('./visionAnalyzer.js');
          const desc = await describeScreen(outputPath);
          eventBus.emit({
            type:        'SCREEN_DESCRIBED' as never,
            timestamp:   Date.now(),
            screenshot:  outputPath,
            description: desc,
          } as never);
        } catch { /* non-critical */ }
      })();
    }
  }

  _prevHash = currHash;
  _prevSize = currSize;
  _prevPath = outputPath;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Start the continuous screen watcher.
 * No-op if already running.
 */
export function startScreenWatcher(config: ScreenWatcherConfig = {}): ScreenWatcherState {
  if (_state.running) return _state;

  _config = {
    intervalMs:      config.intervalMs      ?? 3000,
    changeThreshold: config.changeThreshold ?? 15,
    outputDir:       config.outputDir       ?? os.tmpdir(),
    maxScreenshots:  config.maxScreenshots  ?? 5,
    visionOnChange:  config.visionOnChange  ?? false,
  };

  _prevHash = null;
  _prevSize = 0;
  _prevPath = null;
  _screenshotQueue = [];

  _state = {
    running:     true,
    startedAt:   Date.now(),
    changeCount: 0,
    intervalMs:  _config.intervalMs,
    threshold:   _config.changeThreshold,
  };

  _timer = setInterval(() => {
    tick().catch(() => { /* swallow errors in background loop */ });
  }, _config.intervalMs);

  return _state;
}

/**
 * Stop the screen watcher and clean up screenshots.
 */
export function stopScreenWatcher(): void {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
  _state.running = false;

  // Clean up watcher screenshots
  for (const p of _screenshotQueue) {
    fs.unlink(p, () => { /* best-effort */ });
  }
  _screenshotQueue = [];
}

/** Get current watcher state. */
export function getScreenWatcherState(): ScreenWatcherState {
  return { ..._state };
}

/**
 * Take a one-shot screenshot and compare to the last known state.
 * Useful for "did the screen change since the last action?" checks.
 */
export async function checkScreenChanged(): Promise<ScreenChangeEvent & { captured: boolean }> {
  const outputPath = nextScreenshotPath();
  const captured   = await captureScreenshot(outputPath);
  if (!captured) {
    return { timestamp: Date.now(), screenshotPath: outputPath, changeScore: 0, significant: false, captured: false };
  }

  let currSize = 0;
  try { currSize = (await fs.promises.stat(outputPath)).size; } catch { /* ignore */ }

  const currHash  = await fastFileHash(outputPath);
  const score     = estimateChangeScore(_prevHash, currHash, _prevSize, currSize);
  const significant = score >= _config.changeThreshold;

  return {
    timestamp:      Date.now(),
    screenshotPath: outputPath,
    previousPath:   _prevPath ?? undefined,
    changeScore:    score,
    significant,
    captured:       true,
  };
}
