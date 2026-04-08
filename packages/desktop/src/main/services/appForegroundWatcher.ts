// ── appForegroundWatcher.ts ───────────────────────────────────────────────────
//
// Proactive app foreground detection — polls the frontmost app every 3 seconds
// and notifies the renderer when a known app (from APP_REGISTRY) comes to the
// front. This powers the "detected app" nudge in the Operate screen.
//
// When a known app appears in the foreground:
//   - Emits IPC event 'operator:app:detected' to all renderer windows
//   - Provides the app definition + suggested task titles from its pack list
//
// The watcher debounces: the same app won't fire events more than once per
// 30 seconds, avoiding notification spam during normal use.

import { BrowserWindow } from 'electron';
import { OperatorService } from './operatorService';
import { APP_REGISTRY } from '@triforge/engine';

// ── State ─────────────────────────────────────────────────────────────────────

let _timer: ReturnType<typeof setInterval> | null = null;
let _lastDetectedApp: string | null = null;
let _lastDetectedAt  = 0;
const POLL_INTERVAL_MS = 3_000;
const DEBOUNCE_MS      = 30_000;

// ── Broadcast helpers ─────────────────────────────────────────────────────────

function broadcast(channel: string, payload: unknown): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) {
      win.webContents.send(channel, payload);
    }
  }
}

// ── Poll ──────────────────────────────────────────────────────────────────────

async function poll(): Promise<void> {
  try {
    const target = await OperatorService.getFrontmostApp();
    if (!target?.appName) return;

    const frontmost = target.appName;
    const now = Date.now();

    // Debounce: skip if same app was notified recently
    if (
      frontmost === _lastDetectedApp &&
      now - _lastDetectedAt < DEBOUNCE_MS
    ) return;

    // Check against APP_REGISTRY
    const lowerFrontmost = frontmost.toLowerCase();
    const match = APP_REGISTRY.find(def =>
      def.processPatterns.some(p => lowerFrontmost.includes(p.toLowerCase()))
    );

    if (!match) return;

    // New known app in foreground — emit event
    _lastDetectedApp = frontmost;
    _lastDetectedAt  = now;

    const suggestions = buildSuggestions(match.id, match.packIds ?? []);

    broadcast('operator:app:detected', {
      appId:       match.id,
      appName:     match.name,
      category:    match.category,
      icon:        match.icon,
      packIds:     match.packIds ?? [],
      suggestions,
      detectedAt:  now,
    });
  } catch {
    // Best-effort — never crash the main process
  }
}

// ── Task suggestion labels ────────────────────────────────────────────────────

const PACK_SUGGESTIONS: Record<string, string> = {
  'pack.unreal-bootstrap':    'Bootstrap Unreal Engine project',
  'pack.unreal-build':        'Build & package the project',
  'pack.unreal-triage':       'Triage build errors',
  'pack.unreal-scaffold':     'Plan prototype structure',
  'pack.unreal-milestone':    'Generate milestone plan',
  'pack.unreal-m1-execute':   'Execute Milestone 1 (Core)',
  'pack.unreal-m2-execute':   'Execute Milestone 2 (Health/HUD)',
  'pack.unreal-m3-execute':   'Execute Milestone 3 (Inventory)',
  'pack.unreal-m4-execute':   'Execute Milestone 4 (Combat)',
  'pack.unreal-m5-execute':   'Execute Milestone 5 (Progression)',
  'pack.adobe-photoshop':     'Batch-process images in Photoshop',
  'pack.adobe-premiere':      'Apply LUT or export from Premiere',
  'pack.adobe-aftereffects':  'Render composition in After Effects',
  'pack.adobe-illustrator':   'Export assets from Illustrator',
  'pack.blender-python':      'Run Python automation in Blender',
  'pack.logic-pro':           'Export mix or bounce stems in Logic',
  'pack.ableton-live':        'Set BPM or export session in Ableton',
  'pack.protools':            'Bounce mix or apply processing in Pro Tools',
  'pack.xcode-build':         'Build, test, or archive in Xcode',
  'pack.android-studio':      'Install APK or run ADB commands',
  'pack.davinci-resolve':     'Color grade or export in DaVinci Resolve',
  'pack.finalcut-pro':        'Export or organize timeline in Final Cut',
};

function buildSuggestions(appId: string, packIds: string[]): string[] {
  const out: string[] = [];
  for (const pid of packIds.slice(0, 3)) {
    const label = PACK_SUGGESTIONS[pid];
    if (label) out.push(label);
  }
  if (out.length === 0) {
    out.push(`Automate tasks in ${appId}`);
  }
  return out;
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Start polling for known apps in the foreground. Safe to call multiple times. */
export function startAppForegroundWatcher(): void {
  if (_timer) return;
  _timer = setInterval(poll, POLL_INTERVAL_MS);
}

/** Stop the foreground watcher. */
export function stopAppForegroundWatcher(): void {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
  _lastDetectedApp = null;
  _lastDetectedAt  = 0;
}
