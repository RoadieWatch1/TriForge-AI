// ── executeUnrealBuild.ts — Unreal Build Subprocess Execution Helper ──────────
//
// Phase 3, Step 3: Real Unreal build/package execution for TriForge.
//
// Responsible for:
//   - Discovering the Unreal Engine root from the running UnrealEditor process
//   - Locating the appropriate build script (Build.sh / RunUAT.sh)
//   - Constructing the build command for the detected project
//   - Launching the build subprocess (detached, stdout+stderr → temp log file)
//   - Returning a structured launch result with PID, command, and log path
//
// The build is launched asynchronously. The subprocess runs in the background
// and will outlive the workflow pack execution. Progress monitoring is via the
// log file at the returned logPath.
//
// TRULY IMPLEMENTED (macOS):
//   - Engine root discovery from running UnrealEditor process args (ps)
//   - Build.sh path resolution (editor C++ compilation via UBT)
//   - RunUAT.sh path resolution (cook+build+stage+pak via UAT)
//   - Build command construction for both 'build' and 'package' modes
//   - Detached subprocess launch with temp log file capture
//
// NOT YET:
//   - Windows or Linux support
//   - Synchronous build completion tracking
//   - Custom build targets beyond '<ProjectName>Editor' / Development config
//   - Package output directory configuration

import { exec, spawn } from 'child_process';
import path             from 'path';
import os               from 'os';
import fs               from 'fs';

const IS_MACOS = process.platform === 'darwin';

// ── Internal helpers ──────────────────────────────────────────────────────────

function safeExec(cmd: string, timeoutMs = 5000): Promise<string> {
  return new Promise(resolve => {
    exec(cmd, { timeout: timeoutMs }, (err, stdout) => {
      resolve(err ? '' : (stdout ?? '').trim());
    });
  });
}

// ── Engine root discovery ─────────────────────────────────────────────────────

/**
 * Given the full path to the UnrealEditor executable, navigate to the engine
 * install root (the directory that directly contains the `Engine/` folder).
 *
 * Expected path structure (Epic Games Launcher install):
 *   /Users/Shared/Epic Games/UE_5.3/Engine/Binaries/Mac/UnrealEditor
 *                                   ↑ this is the engine install root
 *
 * Strategy: walk up the path components looking for an `Engine` segment, then
 * return the parent of that `Engine` directory.
 */
export function deriveEngineRoot(execPath: string): string | null {
  const parts = execPath.split(path.sep);

  // Find the index of 'Engine' in the path (case-sensitive on macOS)
  const engineIdx = parts.indexOf('Engine');
  if (engineIdx <= 0) return null;

  // The install root is the directory that contains 'Engine/'
  return parts.slice(0, engineIdx).join(path.sep) || path.sep;
}

/**
 * Discover the Unreal Engine install root by inspecting the running
 * UnrealEditor process arguments via `ps`.
 *
 * Returns the engine install root path (e.g. /Users/Shared/Epic Games/UE_5.3),
 * or null if no Unreal process is found or the path cannot be derived.
 */
export async function findEngineRootFromProcess(): Promise<string | null> {
  if (!IS_MACOS) return null;

  const raw = await safeExec(
    `ps -ax -o args | grep -iE "UnrealEditor|UE4Editor" | grep -v grep | head -n 1`,
    5000,
  );
  if (!raw) return null;

  // Extract the executable path — first token (before any arguments)
  const execPath = raw.trim().split(/\s+/)[0];
  if (!execPath || !execPath.includes('/')) return null;

  return deriveEngineRoot(execPath);
}

// ── Build script discovery ────────────────────────────────────────────────────

/**
 * Verify that the Build.sh script exists for UBT-based C++ compilation.
 * Returns the absolute path if found, null if not present.
 */
export function findBuildScript(engineRoot: string): string | null {
  const scriptPath = path.join(
    engineRoot, 'Engine', 'Build', 'BatchFiles', 'Mac', 'Build.sh',
  );
  try {
    return fs.existsSync(scriptPath) ? scriptPath : null;
  } catch {
    return null;
  }
}

/**
 * Verify that the RunUAT.sh script exists for full cook+build+stage+package.
 * Returns the absolute path if found, null if not present.
 */
export function findRunUATScript(engineRoot: string): string | null {
  const scriptPath = path.join(
    engineRoot, 'Engine', 'Build', 'BatchFiles', 'RunUAT.sh',
  );
  try {
    return fs.existsSync(scriptPath) ? scriptPath : null;
  } catch {
    return null;
  }
}

// ── Command construction ──────────────────────────────────────────────────────

/**
 * Construct the shell arguments for a UBT C++ build (Build.sh).
 *
 * Produces a command of the form:
 *   Build.sh <ProjectName>Editor Mac Development "<projectPath>" -WaitMutex
 *
 * Target: '<ProjectName>Editor' builds the editor module, which is the most
 * common development build target in an Unreal project.
 */
function buildUBTArgs(projectPath: string, projectName: string): string[] {
  return [
    `${projectName}Editor`,   // Build target
    'Mac',                    // Platform
    'Development',            // Configuration
    projectPath,              // .uproject path
    '-WaitMutex',             // Prevent concurrent UBT runs
  ];
}

/**
 * Construct the shell arguments for a UAT build+cook+package (RunUAT.sh).
 *
 * Produces a BuildCookRun command targeting Mac Development with staging.
 * Output archive is written to <ProjectRoot>/Build/Packaged/Mac/.
 */
function buildUATArgs(projectPath: string): string[] {
  const projectRoot  = path.dirname(projectPath);
  const archiveDir   = path.join(projectRoot, 'Build', 'Packaged', 'Mac');

  return [
    'BuildCookRun',
    `-project=${projectPath}`,
    '-platform=Mac',
    '-clientconfig=Development',
    '-cook',
    '-allmaps',
    '-build',
    '-stage',
    '-pak',
    '-archive',
    `-archivedirectory=${archiveDir}`,
  ];
}

// ── Launch result ─────────────────────────────────────────────────────────────

export interface UnrealBuildLaunchResult {
  ok: boolean;
  /** PID of the launched subprocess (present on success). */
  pid?: number;
  /** Full command string that was executed. */
  command?: string;
  /** Path to the temp log file where stdout/stderr is being written. */
  logPath?: string;
  /** Human-readable error description (present on failure). */
  error?: string;
}

// ── Build launcher ────────────────────────────────────────────────────────────

/**
 * Launch a real Unreal build or package subprocess.
 *
 * The subprocess is launched detached from the TriForge process:
 *   - stdout and stderr are redirected to a temp log file
 *   - the process is unref'd so it can outlive TriForge
 *   - the function returns as soon as the process is spawned
 *
 * Returns a `UnrealBuildLaunchResult` describing success (PID + logPath)
 * or failure (error message).
 *
 * @param projectPath   Absolute path to the .uproject file
 * @param projectName   Project name (basename of .uproject without extension)
 * @param engineRoot    Engine install root (contains Engine/ directory)
 * @param buildMode     'build' for C++ compilation, 'package' for full UAT packaging
 */
export async function launchUnrealBuild(
  projectPath: string,
  projectName: string,
  engineRoot: string,
  buildMode: 'build' | 'package',
): Promise<UnrealBuildLaunchResult> {
  if (!IS_MACOS) {
    return { ok: false, error: 'Unreal build execution is only supported on macOS.' };
  }

  // Resolve the correct script
  let scriptPath: string | null;
  let args: string[];

  if (buildMode === 'build') {
    scriptPath = findBuildScript(engineRoot);
    if (!scriptPath) {
      return {
        ok: false,
        error: `Build.sh not found at expected path: ${path.join(engineRoot, 'Engine/Build/BatchFiles/Mac/Build.sh')}`,
      };
    }
    args = buildUBTArgs(projectPath, projectName);
  } else {
    // package
    scriptPath = findRunUATScript(engineRoot);
    if (!scriptPath) {
      return {
        ok: false,
        error: `RunUAT.sh not found at expected path: ${path.join(engineRoot, 'Engine/Build/BatchFiles/RunUAT.sh')}`,
      };
    }
    args = buildUATArgs(projectPath);
  }

  // Ensure the script is executable
  try {
    fs.chmodSync(scriptPath, 0o755);
  } catch {
    // Non-fatal — spawn will fail with a clear error if it can't execute
  }

  // Create a timestamped log file for stdout/stderr capture
  const logPath = path.join(
    os.tmpdir(),
    `tf-unreal-${buildMode}-${Date.now()}.log`,
  );

  const command = `${scriptPath} ${args.map(a => a.includes(' ') ? `"${a}"` : a).join(' ')}`;

  try {
    const logStream = fs.createWriteStream(logPath, { flags: 'w' });

    // Write a header so the log is identifiable
    logStream.write(
      `# TriForge Unreal ${buildMode === 'build' ? 'Build' : 'Package'} Log\n` +
      `# Started: ${new Date().toISOString()}\n` +
      `# Command: ${command}\n` +
      `# Project: ${projectPath}\n\n`,
    );

    const proc = spawn(scriptPath, args, {
      detached: true,
      stdio:    ['ignore', logStream, logStream],
      cwd:      path.dirname(projectPath),
    });

    // Allow the build to outlive this process
    proc.unref();

    // If spawn fails synchronously (e.g. ENOENT), pid will be undefined
    if (!proc.pid) {
      return {
        ok: false,
        command,
        logPath,
        error: 'Process spawned but no PID was assigned — the build script may not be executable.',
      };
    }

    return {
      ok:      true,
      pid:     proc.pid,
      command,
      logPath,
    };

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      command,
      logPath,
      error: `Failed to spawn build process: ${msg}`,
    };
  }
}
