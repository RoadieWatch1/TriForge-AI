// ── unrealAwareness.ts — Unreal Engine domain awareness for TriForge ──────────
//
// Detects Unreal Editor process presence, active project identity, and basic
// log/build signals. Produces an UnrealAwarenessSnapshot for injection into
// the Council awareness pipeline.
//
// TRULY IMPLEMENTED:
//   - Unreal Editor process detection via running-apps list (osascript)
//   - Frontmost-app check for Unreal
//   - Project detection from process command-line args (.uproject path in argv)
//   - Project name extraction from window title (medium confidence)
//   - Install detection via known macOS paths (Epic Games Launcher, app bundle)
//   - Recent log file discovery (~Library/Logs/Unreal Engine/)
//   - Basic build/package signal from last 50 lines of active log
//   - Obvious crash/fatal error hint from last 50 log lines
//
// INTENTIONALLY NOT IMPLEMENTED HERE:
//   - Full log parsing / structured log analysis
//   - Build command orchestration
//   - Unreal plugin or remote-control bridge
//   - Editor UI inspection

import { exec }    from 'child_process';
import path        from 'path';
import os          from 'os';
import fs          from 'fs';
import type { UnrealAwarenessSnapshot } from '@triforge/engine';

const IS_MACOS = process.platform === 'darwin';

// ── Constants ─────────────────────────────────────────────────────────────────

/**
 * Known Unreal Editor process name fragments.
 * Matched case-insensitively against the running-apps list.
 */
const UNREAL_PROCESS_PATTERNS = ['UnrealEditor', 'UE4Editor', 'UnrealFrontend'];

// ── Shell helper ──────────────────────────────────────────────────────────────

/** Run a shell command and return stdout. Returns '' on any failure. */
function safeExec(cmd: string, timeoutMs = 5000): Promise<string> {
  return new Promise(resolve => {
    exec(cmd, { timeout: timeoutMs }, (err, stdout) => {
      resolve(err ? '' : (stdout ?? '').trim());
    });
  });
}

// ── Process detection ─────────────────────────────────────────────────────────

/**
 * Match any entry in a running-apps list against the Unreal process patterns.
 * Returns the matched app name, or null if no Unreal process is found.
 */
function detectEditorProcess(apps: string[]): string | null {
  for (const app of apps) {
    for (const pattern of UNREAL_PROCESS_PATTERNS) {
      if (app.toLowerCase().includes(pattern.toLowerCase())) return app;
    }
  }
  return null;
}

/** Check if the currently frontmost app is Unreal Editor. */
function isFrontmostUnreal(frontmostAppName: string | null | undefined): boolean {
  if (!frontmostAppName) return false;
  return UNREAL_PROCESS_PATTERNS.some(p =>
    frontmostAppName.toLowerCase().includes(p.toLowerCase()),
  );
}

// ── Project detection ─────────────────────────────────────────────────────────

/**
 * Use `ps` to get the full command line of Unreal Editor processes and look for
 * a .uproject argument. This is the highest-confidence project detection path.
 *
 * Returns null if no .uproject is found in the process args.
 */
async function detectProjectFromProcessArgs(): Promise<{
  projectPath: string;
  projectName: string;
} | null> {
  if (!IS_MACOS) return null;

  // Pull full argv of all Unreal-related processes (limit to 3 lines to be safe)
  const raw = await safeExec(
    `ps -ax -o args | grep -iE "UnrealEditor|UE4Editor" | grep -v grep | head -n 3`,
    5000,
  );
  if (!raw) return null;

  // Find the first .uproject path in the output
  const match = raw.match(/([^\s"']+\.uproject)/i);
  if (!match) return null;

  const projectPath = match[1];
  const projectName = path.basename(projectPath, '.uproject');
  return { projectPath, projectName };
}

/**
 * Try to extract a project name from the Unreal Editor window title.
 *
 * Known title formats:
 *   UE5: "ProjectName - Unreal Editor"
 *   UE5 with path: "ProjectName [/absolute/path] - Unreal Editor"
 *   UE4: "UE4Editor - ProjectName"
 *   UE4: "Unreal Editor - ProjectName"
 *
 * Returns a trimmed project name string, or null on no match.
 */
function extractProjectFromWindowTitle(windowTitle: string | undefined): string | null {
  if (!windowTitle) return null;

  // UE5 format: "ProjectName [optional path] - Unreal Editor"
  const ue5 = windowTitle.match(/^(.+?)\s*(?:\[.*?\])?\s*[-–]\s*Unreal Editor/i);
  if (ue5) return ue5[1].trim();

  // UE4 format: "UE4Editor - ProjectName" or "Unreal Editor - ProjectName"
  const ue4 = windowTitle.match(/(?:UE4Editor|Unreal Editor)\s*[-–]\s*(.+)/i);
  if (ue4) return ue4[1].split(/\s*[-–]\s*/)[0].trim();

  return null;
}

// ── Install detection ─────────────────────────────────────────────────────────

/**
 * Check whether Unreal Engine is likely installed by probing known macOS paths.
 * Returns true if strong evidence found, undefined if inconclusive, false only
 * if we actively verified absence (not implemented — we return undefined).
 */
function checkUnrealInstalled(): boolean | undefined {
  if (!IS_MACOS) return undefined;

  const home = os.homedir();
  const knownPaths = [
    '/Applications/Epic Games Launcher.app',
    path.join(home, 'Applications', 'Epic Games Launcher.app'),
    path.join(home, 'Library', 'Application Support', 'Epic', 'EpicGamesLauncher'),
    // Direct UE installs outside the launcher
    '/Applications/UnrealEditor.app',
    '/Users/Shared/Epic Games',
  ];

  for (const p of knownPaths) {
    try {
      if (fs.existsSync(p)) return true;
    } catch {
      continue;
    }
  }

  return undefined; // Cannot confirm without a full disk scan
}

// ── Log detection ─────────────────────────────────────────────────────────────

/**
 * Locate the most recently modified Unreal log file.
 *
 * Search order:
 *   1. ~/Library/Logs/Unreal Engine/      (UE4/5 system-level logs)
 *   2. ~/Library/Logs/EpicGames/          (launcher logs — may overlap)
 *
 * Returns the absolute path, or null if nothing found.
 */
async function findRecentLogPath(): Promise<string | null> {
  if (!IS_MACOS) return null;

  const home = os.homedir();
  const searchDirs = [
    path.join(home, 'Library', 'Logs', 'Unreal Engine'),
    path.join(home, 'Library', 'Logs', 'EpicGames'),
  ];

  for (const dir of searchDirs) {
    try {
      if (!fs.existsSync(dir)) continue;

      // Find the most recently touched .log file in this directory subtree
      const candidate = await safeExec(
        `find "${dir}" -name "*.log" -type f -print0 | xargs -0 ls -t 2>/dev/null | head -n 1`,
        3000,
      );

      if (candidate && fs.existsSync(candidate)) return candidate;
    } catch {
      continue;
    }
  }

  return null;
}

/**
 * Also try project-local log if a project path is available.
 * UE convention: <ProjectRoot>/Saved/Logs/<ProjectName>.log
 */
function getProjectLogPath(projectPath: string, projectName: string): string {
  return path.join(path.dirname(projectPath), 'Saved', 'Logs', `${projectName}.log`);
}

// ── Build / error signal ──────────────────────────────────────────────────────

/**
 * Scan the last 50 lines of the active log for build/package keywords.
 * Does NOT do deep parsing — this is a lightweight signal only.
 */
async function detectBuildState(
  logPath: string | null,
): Promise<UnrealAwarenessSnapshot['buildState']> {
  if (!logPath) return 'unknown';

  try {
    if (!fs.existsSync(logPath)) return 'unknown';

    const recent = await safeExec(`tail -n 50 "${logPath}"`, 2000);
    if (!recent) return 'unknown';

    const lower = recent.toLowerCase();

    if (
      lower.includes('packageproject') ||
      lower.includes('cookcommandlet') ||
      lower.includes('automationtool') && lower.includes('packaging') ||
      lower.includes('deploying ')
    ) {
      return 'packaging';
    }

    if (
      lower.includes('building modules') ||
      lower.includes('compiling ') ||
      lower.includes('unrealbuildtool') ||
      lower.includes('starting hot reload')
    ) {
      return 'building';
    }

    return 'idle';
  } catch {
    return 'unknown';
  }
}

/**
 * Scan the last 50 lines of the log for obvious crash or fatal error lines.
 * Returns a brief (≤200 char) hint string, or null if nothing obvious found.
 */
async function detectObviousError(logPath: string | null): Promise<string | null> {
  if (!logPath) return null;

  try {
    if (!fs.existsSync(logPath)) return null;

    const recent = await safeExec(`tail -n 50 "${logPath}"`, 2000);
    if (!recent) return null;

    const lines = recent.split('\n').reverse();
    for (const line of lines) {
      if (/\b(fatal error|assert failed|crash reporter|unhandled exception|access violation)\b/i.test(line)) {
        return line.trim().slice(0, 200);
      }
    }

    return null;
  } catch {
    return null;
  }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Build a compact, honest Unreal Engine awareness snapshot.
 *
 * @param runningApps           Running app/process names (from OperatorService.listRunningApps())
 * @param frontmostAppName      Name of the frontmost app (from OperatorService.getFrontmostApp())
 * @param frontmostWindowTitle  Window title of the frontmost app (if available)
 */
export async function buildUnrealAwarenessSnapshot(
  runningApps: string[],
  frontmostAppName: string | null | undefined,
  frontmostWindowTitle: string | undefined,
): Promise<UnrealAwarenessSnapshot> {

  const editorProcess = detectEditorProcess(runningApps);
  const running       = editorProcess !== null;
  const frontmost     = isFrontmostUnreal(frontmostAppName);

  // Not running — return the minimal snapshot quickly
  if (!running) {
    return {
      installed:        checkUnrealInstalled(),
      running:          false,
      frontmost:        false,
      projectDetected:  false,
      buildState:       'unknown',
    };
  }

  // ── Project detection (parallel — both are I/O-bound) ─────────────────────
  const [argsProject, systemLogPath] = await Promise.all([
    detectProjectFromProcessArgs(),
    findRecentLogPath(),
  ]);

  // Window-title fallback (medium confidence) — only if args gave nothing
  const titleProjectName = (!argsProject && frontmost)
    ? extractProjectFromWindowTitle(frontmostWindowTitle)
    : null;

  // Resolve project fields + confidence
  let projectDetected                                        = false;
  let projectPath:       string | undefined                 = undefined;
  let projectName:       string | undefined                 = undefined;
  let projectConfidence: UnrealAwarenessSnapshot['projectConfidence'] = 'unknown';

  if (argsProject) {
    projectDetected  = true;
    projectPath      = argsProject.projectPath;
    projectName      = argsProject.projectName;
    projectConfidence = 'high';
  } else if (titleProjectName) {
    projectDetected  = true;
    projectName      = titleProjectName;
    projectConfidence = 'medium';
  }

  // ── Log selection ─────────────────────────────────────────────────────────
  // Prefer project-local log (more specific) over system log
  const projectLogPath = (projectPath && projectName)
    ? getProjectLogPath(projectPath, projectName)
    : null;

  const activeLog = (projectLogPath && fs.existsSync(projectLogPath))
    ? projectLogPath
    : systemLogPath;

  // ── Build + error signals (parallel) ─────────────────────────────────────
  const [buildState, obviousErrorState] = await Promise.all([
    detectBuildState(activeLog),
    detectObviousError(activeLog),
  ]);

  return {
    installed:          true, // Running implies installed
    running:            true,
    frontmost,
    editorProcessName:  editorProcess,
    projectDetected,
    projectName,
    projectPath,
    projectConfidence,
    recentLogPath:      activeLog ?? undefined,
    buildState,
    obviousErrorState:  obviousErrorState ?? undefined,
  };
}
