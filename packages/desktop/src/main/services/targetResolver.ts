// ── targetResolver.ts ────────────────────────────────────────────────────────
//
// Canonical target resolution for the operator task runner.
//
// PROBLEM:
//   When a user says "Unreal Engine" the actual macOS process they want to
//   interact with might be:
//     - "EpicGamesLauncher"      (the launcher window with "New Project")
//     - "UnrealEditor"           (the editor itself, post-load)
//     - "UnrealEngineLauncher"   (older naming)
//   Each step's focus/bounds queries restart from the user's loose string,
//   so the runner oscillates between these executables during retries.
//
// SOLUTION:
//   Resolve the user-supplied targetApp ONCE at session start into a
//   BoundRuntimeTarget {family, processName, ...} based on what is actually
//   running. Every subsequent step uses processName, never the loose string.
//   Re-resolution only happens explicitly (e.g. when the bound process exits).

import { OperatorService, type AppWindowBounds } from './operatorService';

// ── Types ────────────────────────────────────────────────────────────────────

export type AppFamily =
  | 'unreal-editor'
  | 'unreal-launcher'
  | 'unreal-any'
  | 'vscode'
  | 'chrome'
  | 'safari'
  | 'finder'
  | 'terminal'
  | 'unknown';

export interface BoundRuntimeTarget {
  /** The user-supplied label (preserved for display/logs) */
  requestedLabel: string;
  /** The canonical process name as it appears in System Events */
  processName:    string;
  /** App family for context-aware behavior */
  family:         AppFamily;
  /** Window title at bind time (may change during the session) */
  windowTitleAtBind?: string;
  /** Whether this target was bound automatically vs. exact user request */
  fuzzyMatched:   boolean;
  /** Reason this binding was chosen (for diagnostics) */
  bindingReason:  string;
}

// ── App family registry ──────────────────────────────────────────────────────
//
// Maps loose user strings to a family + ordered list of candidate process
// names to look for among running apps. The first match wins.
//
// IMPORTANT: order matters. For "Unreal" we prefer Editor > Launcher because
// when both are running the user almost certainly means the editor.

interface FamilyDef {
  family:         AppFamily;
  /** Patterns the user might type — matched case-insensitively, substring */
  userAliases:    string[];
  /** Candidate process names to look for among running apps, in priority order */
  processCandidates: string[];
}

const FAMILY_REGISTRY: FamilyDef[] = [
  {
    family: 'unreal-editor',
    userAliases: ['unreal editor', 'unrealeditor', 'ue editor', 'ue5 editor'],
    processCandidates: ['UnrealEditor', 'UE5Editor', 'UE4Editor'],
  },
  {
    family: 'unreal-launcher',
    userAliases: ['epic games launcher', 'epicgameslauncher', 'unreal launcher', 'unreal engine launcher', 'unrealenginelauncher'],
    processCandidates: ['EpicGamesLauncher', 'UnrealEngineLauncher', 'EpicWebHelper'],
  },
  // Generic "Unreal" — picks Editor if running, otherwise Launcher.
  // Modeled as a separate family so the resolver can fall back gracefully.
  {
    family: 'unreal-any',
    userAliases: ['unreal', 'unreal engine', 'ue', 'ue5', 'ue4'],
    processCandidates: ['UnrealEditor', 'UE5Editor', 'UE4Editor', 'EpicGamesLauncher', 'UnrealEngineLauncher'],
  },
  {
    family: 'vscode',
    userAliases: ['vscode', 'visual studio code', 'vs code', 'code'],
    processCandidates: ['Code', 'Visual Studio Code', 'Code - Insiders'],
  },
  {
    family: 'chrome',
    userAliases: ['chrome', 'google chrome'],
    processCandidates: ['Google Chrome', 'Chrome'],
  },
  {
    family: 'safari',
    userAliases: ['safari'],
    processCandidates: ['Safari'],
  },
  {
    family: 'finder',
    userAliases: ['finder'],
    processCandidates: ['Finder'],
  },
  {
    family: 'terminal',
    userAliases: ['terminal'],
    processCandidates: ['Terminal', 'iTerm2', 'iTerm'],
  },
];

// ── Resolution ───────────────────────────────────────────────────────────────

export interface ResolveOptions {
  /** Provide an existing running-apps list to avoid an extra IPC call */
  runningApps?: string[];
}

/**
 * Resolve a user-supplied targetApp string into a stable BoundRuntimeTarget
 * by matching against currently running processes.
 *
 * Returns null when nothing matches — the caller MUST treat this as a
 * blocking error if the runner is in scoped mode.
 */
export async function resolveCanonicalTarget(
  requestedLabel: string,
  opts: ResolveOptions = {},
): Promise<BoundRuntimeTarget | null> {
  if (!requestedLabel?.trim()) return null;
  const label = requestedLabel.trim();
  const lower = label.toLowerCase();

  // Get the running apps list once — used by all match strategies below
  let runningApps = opts.runningApps;
  if (!runningApps) {
    try {
      runningApps = await OperatorService.listRunningApps();
    } catch {
      runningApps = [];
    }
  }
  const runningLower = runningApps.map(a => a.toLowerCase());

  // ── Strategy 1: exact process name match ────────────────────────────────
  // If the user typed "UnrealEditor" verbatim and that process is running,
  // use it directly. No fuzziness, no aliases.
  const exactIdx = runningLower.findIndex(a => a === lower);
  if (exactIdx !== -1) {
    return {
      requestedLabel: label,
      processName:    runningApps[exactIdx],
      family:         familyOfProcess(runningApps[exactIdx]),
      fuzzyMatched:   false,
      bindingReason:  'exact_process_name_match',
    };
  }

  // ── Strategy 2: family alias match ──────────────────────────────────────
  // Walk the family registry. The first family whose user alias substring-
  // matches gets searched against running processes in its priority order.
  for (const fam of FAMILY_REGISTRY) {
    const aliasMatched = fam.userAliases.some(a => lower.includes(a) || a.includes(lower));
    if (!aliasMatched) continue;

    for (const candidate of fam.processCandidates) {
      const candidateLower = candidate.toLowerCase();
      const idx = runningLower.findIndex(a => a === candidateLower || a.includes(candidateLower));
      if (idx !== -1) {
        return {
          requestedLabel: label,
          processName:    runningApps[idx],
          family:         fam.family,
          fuzzyMatched:   true,
          bindingReason:  `family_alias[${fam.family}] candidate=${candidate}`,
        };
      }
    }
  }

  // ── Strategy 3: substring match against any running process ─────────────
  // Last resort: any running process whose name contains (or is contained
  // in) the requested label. This handles "Photoshop" → "Adobe Photoshop 2024".
  const subIdx = runningLower.findIndex(a => a.includes(lower) || lower.includes(a));
  if (subIdx !== -1) {
    return {
      requestedLabel: label,
      processName:    runningApps[subIdx],
      family:         familyOfProcess(runningApps[subIdx]),
      fuzzyMatched:   true,
      bindingReason:  'substring_running_process',
    };
  }

  // Nothing matched
  return null;
}

/**
 * Lookup the family of a known process name.
 * Used when the user typed an exact process name and we still want a family
 * label for diagnostics and family-aware behavior.
 */
function familyOfProcess(processName: string): AppFamily {
  const lower = processName.toLowerCase();
  for (const fam of FAMILY_REGISTRY) {
    if (fam.processCandidates.some(c => c.toLowerCase() === lower)) return fam.family;
  }
  return 'unknown';
}

/**
 * Re-resolve bounds for a previously bound target without changing the
 * binding. Returns null if the bound process no longer has a visible window.
 *
 * This is the per-step refresh — windows can be moved/resized/snapped
 * between iterations, so we always re-fetch the bounds rectangle.
 */
export async function refreshBoundsForTarget(
  bound: BoundRuntimeTarget,
): Promise<AppWindowBounds | null> {
  try {
    return await OperatorService.getAppWindowBounds(bound.processName);
  } catch {
    return null;
  }
}

/**
 * Check whether a previously bound target is still running. If not, the
 * runner should treat the binding as broken and either re-resolve or abort.
 */
export async function isBoundTargetStillRunning(
  bound: BoundRuntimeTarget,
): Promise<boolean> {
  try {
    const apps = await OperatorService.listRunningApps();
    return apps.some(a => a === bound.processName);
  } catch {
    return false;
  }
}
