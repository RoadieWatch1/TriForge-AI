// ── appAwareness.ts ────────────────────────────────────────────────────────────
//
// Phase 2.1 — Generic App Awareness: Runtime Detection
//
// Iterates APP_REGISTRY to detect which known apps are running, frontmost,
// and installed on disk. Mirrors the pattern of unrealAwareness.ts but is
// fully generic — new apps just need an AppDefinition entry in appRegistry.ts.
//
// TRULY IMPLEMENTED:
//   - Process name matching against running-apps list
//   - Frontmost app detection
//   - Install path check (fs.existsSync on known locations)
//   - Open document extraction from window title (regex)
//
// NOT HERE:
//   - Scripting execution (that's workflowPackService.ts phase handlers)
//   - Full disk scan for unknown apps

import fs from 'fs';
import {
  APP_REGISTRY,
  type AppDefinition,
  type DetectedApp,
} from '@triforge/engine';

// ── Detection helpers ─────────────────────────────────────────────────────────

function matchProcess(def: AppDefinition, runningApps: string[]): string | undefined {
  const lower = runningApps.map(a => a.toLowerCase());
  for (const pattern of def.processPatterns) {
    const idx = lower.findIndex(a => a.includes(pattern.toLowerCase()));
    if (idx !== -1) return runningApps[idx];
  }
  return undefined;
}

function isFrontmost(def: AppDefinition, frontmostApp: string | null | undefined): boolean {
  if (!frontmostApp) return false;
  const lower = frontmostApp.toLowerCase();
  return def.processPatterns.some(p => lower.includes(p.toLowerCase()));
}

function extractOpenDocument(def: AppDefinition, windowTitle?: string): string | undefined {
  if (!windowTitle || !def.windowTitleExtract) return undefined;
  const match = windowTitle.match(def.windowTitleExtract);
  return match?.[1]?.trim();
}

function checkInstalled(def: AppDefinition): boolean | undefined {
  const platform = process.platform;
  const paths = platform === 'darwin' ? def.installPaths.mac
              : platform === 'win32'  ? def.installPaths.win
              : undefined;

  if (!paths?.length) return undefined;

  for (const p of paths) {
    try {
      if (fs.existsSync(p)) return true;
    } catch {
      continue;
    }
  }
  return undefined; // couldn't confirm either way
}

// ── Public API ─────────────────────────────────────────────────────────────────

/**
 * Scan the running-apps list against the app registry and return detected apps.
 *
 * Only returns apps that are either:
 *   - Currently running (running === true), OR
 *   - Confirmed installed on disk (installed === true)
 *
 * Use this to populate the council awareness snapshot and the Operate UI.
 *
 * @param runningApps          From OperatorService.listRunningApps()
 * @param frontmostAppName     From OperatorService.getFrontmostApp()
 * @param frontmostWindowTitle Window title of the frontmost app
 * @param includeNotInstalled  If true, includes all registry entries even if not running/installed
 */
export function buildAppAwarenessSnapshot(
  runningApps: string[],
  frontmostAppName: string | null | undefined,
  frontmostWindowTitle?: string,
  includeNotInstalled = false,
): DetectedApp[] {
  const results: DetectedApp[] = [];

  for (const def of APP_REGISTRY) {
    const processName = matchProcess(def, runningApps);
    const running     = processName !== undefined;
    const frontmost   = running && isFrontmost(def, frontmostAppName);

    // Extract open document only when this app is frontmost (we only have
    // the window title for the foreground app)
    const windowTitle    = frontmost ? frontmostWindowTitle : undefined;
    const openDocument   = extractOpenDocument(def, windowTitle);

    // Install check is cheap (fs.existsSync), run it for all entries
    const installed = checkInstalled(def);

    const detected: DetectedApp = {
      definition: def,
      running,
      frontmost,
      processName,
      windowTitle,
      openDocument,
      installed,
    };

    // Filter: only surface apps that have a meaningful signal
    if (includeNotInstalled || running || installed === true) {
      results.push(detected);
    }
  }

  return results;
}

/**
 * Return only the apps that are currently running.
 * Useful for the council awareness snapshot to avoid noise.
 */
export function getRunningApps(
  runningApps: string[],
  frontmostAppName?: string | null,
  frontmostWindowTitle?: string,
): DetectedApp[] {
  return buildAppAwarenessSnapshot(runningApps, frontmostAppName, frontmostWindowTitle)
    .filter(a => a.running);
}

/**
 * Return a compact text summary for council injection.
 * Format: "Running: Photoshop (frontmost, open: MyFile.psd), Blender"
 */
export function formatAppAwarenessSummary(detectedApps: DetectedApp[]): string {
  const running = detectedApps.filter(a => a.running);
  if (running.length === 0) return 'No known apps currently running.';

  const parts = running.map(a => {
    const tags: string[] = [];
    if (a.frontmost) tags.push('frontmost');
    if (a.openDocument) tags.push(`open: ${a.openDocument}`);
    const suffix = tags.length ? ` (${tags.join(', ')})` : '';
    return `${a.definition.name}${suffix}`;
  });

  return `Running: ${parts.join(', ')}.`;
}
