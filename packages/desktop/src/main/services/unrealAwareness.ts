// ── unrealAwareness.ts — Unreal Engine domain awareness for TriForge ──────────
//
// Detects Unreal Editor process presence, active project identity, and basic
// log/build signals. Produces an UnrealAwarenessSnapshot for injection into
// the Council awareness pipeline.
//
// TRULY IMPLEMENTED (cross-platform — macOS + Windows):
//   - Unreal Editor process detection via running-apps list
//   - Frontmost-app check for Unreal
//   - Project detection from process command-line args (.uproject path in argv)
//     macOS:   ps -ax -o args
//     Windows: PowerShell Get-CimInstance Win32_Process
//   - Project name extraction from window title (medium confidence)
//   - Install detection via known platform paths
//     macOS:   /Applications/Epic Games Launcher.app, ~/Library/...
//     Windows: C:\Program Files\Epic Games\, %PROGRAMDATA%\Epic\...
//   - Recent log file discovery
//     macOS:   ~/Library/Logs/Unreal Engine/
//     Windows: %LOCALAPPDATA%\UnrealEngine\<version>\Saved\Logs\
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

const IS_MACOS   = process.platform === 'darwin';
const IS_WINDOWS = process.platform === 'win32';

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
 * Get the full command line of Unreal Editor processes and look for a
 * .uproject argument. This is the highest-confidence project detection path.
 *
 * macOS:   `ps -ax -o args | grep UnrealEditor`
 * Windows: PowerShell `Get-CimInstance Win32_Process` filtered by image name
 *
 * Returns null if no .uproject is found in the process args.
 */
async function detectProjectFromProcessArgs(): Promise<{
  projectPath: string;
  projectName: string;
} | null> {
  let raw = '';

  if (IS_MACOS) {
    raw = await safeExec(
      `ps -ax -o args | grep -iE "UnrealEditor|UE4Editor" | grep -v grep | head -n 3`,
      5000,
    );
  } else if (IS_WINDOWS) {
    // Get-CimInstance is the modern PowerShell replacement for wmic (deprecated).
    // -NoProfile keeps startup fast; -Command runs a single expression then exits.
    // We pull CommandLine for any UnrealEditor / UE4Editor process and emit raw text.
    raw = await safeExec(
      `powershell.exe -NoProfile -NonInteractive -Command "Get-CimInstance Win32_Process -Filter \\"Name='UnrealEditor.exe' OR Name='UE4Editor.exe' OR Name='UnrealEditor-Win64-DebugGame.exe'\\" | Select-Object -ExpandProperty CommandLine"`,
      8000,
    );
  } else {
    return null;
  }

  if (!raw) return null;

  // Find the first .uproject path in the output. The path may contain spaces
  // and may be wrapped in quotes (Windows command lines almost always quote it).
  // First try a quoted match, then fall back to unquoted.
  const quoted   = raw.match(/"([^"]+\.uproject)"/i);
  const unquoted = quoted ? null : raw.match(/([^\s"']+\.uproject)/i);
  const match    = quoted ?? unquoted;
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
 * Check whether Unreal Engine is likely installed by probing known platform paths.
 * Returns true if strong evidence found, undefined if inconclusive, false only
 * if we actively verified absence (not implemented — we return undefined).
 */
function checkUnrealInstalled(): boolean | undefined {
  const home = os.homedir();
  const knownPaths: string[] = [];

  if (IS_MACOS) {
    knownPaths.push(
      '/Applications/Epic Games Launcher.app',
      path.join(home, 'Applications', 'Epic Games Launcher.app'),
      path.join(home, 'Library', 'Application Support', 'Epic', 'EpicGamesLauncher'),
      // Direct UE installs outside the launcher
      '/Applications/UnrealEditor.app',
      '/Users/Shared/Epic Games',
    );
  } else if (IS_WINDOWS) {
    const programFiles   = process.env['ProgramFiles']   ?? 'C:\\Program Files';
    const programFilesX86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
    const programData    = process.env['ProgramData']    ?? 'C:\\ProgramData';
    const localAppData   = process.env['LOCALAPPDATA']   ?? path.join(home, 'AppData', 'Local');

    knownPaths.push(
      // Default Epic Games Launcher install root — engine versions live under here
      path.join(programFiles, 'Epic Games'),
      path.join(programFilesX86, 'Epic Games'),
      // Launcher state / install manifests
      path.join(programData, 'Epic', 'EpicGamesLauncher'),
      path.join(programData, 'Epic', 'UnrealEngineLauncher'),
      // User-local engine state (UE writes here even for source builds)
      path.join(localAppData, 'UnrealEngine'),
    );

    // Also probe specific engine version directories — finding any one is strong proof
    for (const ver of ['UE_5.5', 'UE_5.4', 'UE_5.3', 'UE_5.2', 'UE_5.1', 'UE_5.0', 'UE_4.27', 'UE_4.26']) {
      knownPaths.push(path.join(programFiles, 'Epic Games', ver));
    }
  } else {
    return undefined;
  }

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
 * Recursively walk a directory looking for `.log` files. Returns up to `maxFiles`
 * results — bounded to avoid runaway scans on large engine installs. Errors at any
 * subdirectory are swallowed and skipped.
 */
function collectLogFiles(rootDir: string, maxFiles = 50): string[] {
  const out: string[] = [];
  const stack: string[] = [rootDir];
  const visited = new Set<string>();

  while (stack.length > 0 && out.length < maxFiles) {
    const dir = stack.pop()!;
    if (visited.has(dir)) continue;
    visited.add(dir);

    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (out.length >= maxFiles) break;
      const full = path.join(dir, entry.name);
      try {
        if (entry.isDirectory()) {
          stack.push(full);
        } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.log')) {
          out.push(full);
        }
      } catch {
        continue;
      }
    }
  }

  return out;
}

/**
 * Locate the most recently modified Unreal log file (cross-platform).
 *
 * macOS search order:
 *   1. ~/Library/Logs/Unreal Engine/      (UE4/5 system-level logs)
 *   2. ~/Library/Logs/EpicGames/          (launcher logs — may overlap)
 *
 * Windows search order:
 *   1. %LOCALAPPDATA%\UnrealEngine\<version>\Saved\Logs\
 *   2. %LOCALAPPDATA%\EpicGamesLauncher\Saved\Logs\
 *
 * Returns the absolute path of the most-recently-modified candidate, or null.
 */
async function findRecentLogPath(): Promise<string | null> {
  const home = os.homedir();
  const searchDirs: string[] = [];

  if (IS_MACOS) {
    searchDirs.push(
      path.join(home, 'Library', 'Logs', 'Unreal Engine'),
      path.join(home, 'Library', 'Logs', 'EpicGames'),
    );
  } else if (IS_WINDOWS) {
    const localAppData = process.env['LOCALAPPDATA'] ?? path.join(home, 'AppData', 'Local');
    searchDirs.push(
      path.join(localAppData, 'UnrealEngine'),
      path.join(localAppData, 'EpicGamesLauncher', 'Saved', 'Logs'),
    );
  } else {
    return null;
  }

  let bestPath: string | null = null;
  let bestMtime = -Infinity;

  for (const dir of searchDirs) {
    try {
      if (!fs.existsSync(dir)) continue;

      const candidates = collectLogFiles(dir, 50);
      for (const candidate of candidates) {
        try {
          const stat = fs.statSync(candidate);
          if (stat.mtimeMs > bestMtime) {
            bestMtime = stat.mtimeMs;
            bestPath  = candidate;
          }
        } catch {
          continue;
        }
      }
    } catch {
      continue;
    }
  }

  return bestPath;
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
 * Read the last `n` lines of a text file without shelling out to `tail`.
 * Falls back to reading the whole file if it's smaller than the tail window —
 * Unreal logs grow large, so we cap reads at the trailing 64 KB.
 */
function readLastLines(filePath: string, lineCount: number): string {
  try {
    const stat = fs.statSync(filePath);
    const tailBytes = 64 * 1024;
    const start = Math.max(0, stat.size - tailBytes);

    const fd = fs.openSync(filePath, 'r');
    try {
      const buf = Buffer.alloc(stat.size - start);
      fs.readSync(fd, buf, 0, buf.length, start);
      const text = buf.toString('utf8');
      const lines = text.split(/\r?\n/);
      return lines.slice(-lineCount).join('\n');
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return '';
  }
}

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

    const recent = readLastLines(logPath, 50);
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

    const recent = readLastLines(logPath, 50);
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
