// ── executeUnrealBuild.ts — Unreal Build Subprocess Execution Helper ──────────
//
// Phase 3, Step 3: Real Unreal build/package execution for TriForge.
//
// Responsible for:
//   - Discovering the Unreal Engine root from the running UnrealEditor process
//   - Locating the appropriate build script (Build.sh/.bat / RunUAT.sh/.bat)
//   - Constructing the build command for the detected project
//   - Launching the build subprocess (detached, stdout+stderr → temp log file)
//   - Returning a structured launch result with PID, command, and log path
//
// The build is launched asynchronously. The subprocess runs in the background
// and will outlive the workflow pack execution. Progress monitoring is via the
// log file at the returned logPath.
//
// TRULY IMPLEMENTED (macOS + Windows):
//   - Engine root discovery from running UnrealEditor process args (ps / Get-Process)
//   - Build.sh / Build.bat path resolution (editor C++ compilation via UBT)
//   - RunUAT.sh / RunUAT.bat path resolution (cook+build+stage+pak via UAT)
//   - Build command construction for both 'build' and 'package' modes
//   - Detached subprocess launch with temp log file capture

import { exec, spawn } from 'child_process';
import path             from 'path';
import os               from 'os';
import fs               from 'fs';

const IS_MACOS   = process.platform === 'darwin';
const IS_WINDOWS = process.platform === 'win32';
const PLATFORM_NAME: 'Mac' | 'Win64' | null = IS_MACOS ? 'Mac' : IS_WINDOWS ? 'Win64' : null;

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
 * Expected path structures:
 *   macOS:    /Users/Shared/Epic Games/UE_5.3/Engine/Binaries/Mac/UnrealEditor
 *   Windows:  C:\Program Files\Epic Games\UE_5.3\Engine\Binaries\Win64\UnrealEditor.exe
 *                                            ↑ install root
 *
 * Strategy: walk up the path components looking for an `Engine` segment, then
 * return the parent of that `Engine` directory.
 */
export function deriveEngineRoot(execPath: string): string | null {
  // Normalize separators so Windows backslash paths split correctly
  const normalized = execPath.replace(/\\/g, '/');
  const parts = normalized.split('/');

  const engineIdx = parts.indexOf('Engine');
  if (engineIdx <= 0) return null;

  const root = parts.slice(0, engineIdx).join(path.sep);
  return root || path.sep;
}

/**
 * Discover the Unreal Engine install root by inspecting the running
 * UnrealEditor process. Uses `ps` on macOS and `Get-Process` on Windows.
 */
export async function findEngineRootFromProcess(): Promise<string | null> {
  if (IS_MACOS) {
    const raw = await safeExec(
      `ps -ax -o args | grep -iE "UnrealEditor|UE4Editor" | grep -v grep | head -n 1`,
      5000,
    );
    if (!raw) return null;
    const execPath = raw.trim().split(/\s+/)[0];
    if (!execPath || !execPath.includes('/')) return null;
    return deriveEngineRoot(execPath);
  }

  if (IS_WINDOWS) {
    const raw = await safeExec(
      `powershell -NoProfile -Command "(Get-Process -Name UnrealEditor,UE4Editor -ErrorAction SilentlyContinue | Select-Object -First 1).Path"`,
      5000,
    );
    if (!raw) return null;
    return deriveEngineRoot(raw);
  }

  return null;
}

// ── Build script discovery ────────────────────────────────────────────────────

/**
 * Verify that Build.sh / Build.bat exists for UBT-based C++ compilation.
 * Returns the absolute path if found, null if not present.
 */
export function findBuildScript(engineRoot: string): string | null {
  const candidates = IS_WINDOWS
    ? [path.join(engineRoot, 'Engine', 'Build', 'BatchFiles', 'Build.bat')]
    : [path.join(engineRoot, 'Engine', 'Build', 'BatchFiles', 'Mac', 'Build.sh')];
  for (const c of candidates) {
    try { if (fs.existsSync(c)) return c; } catch { /* ignore */ }
  }
  return null;
}

/**
 * Verify that RunUAT.sh / RunUAT.bat exists for full cook+build+stage+package.
 */
export function findRunUATScript(engineRoot: string): string | null {
  const scriptName = IS_WINDOWS ? 'RunUAT.bat' : 'RunUAT.sh';
  const scriptPath = path.join(engineRoot, 'Engine', 'Build', 'BatchFiles', scriptName);
  try {
    return fs.existsSync(scriptPath) ? scriptPath : null;
  } catch {
    return null;
  }
}

// ── Command construction ──────────────────────────────────────────────────────

/**
 * Construct the shell arguments for a UBT C++ build (Build.sh / Build.bat).
 *
 * macOS:    Build.sh   <ProjectName>Editor Mac    Development "<projectPath>" -WaitMutex
 * Windows:  Build.bat  <ProjectName>Editor Win64  Development "<projectPath>" -WaitMutex
 *
 * Target: '<ProjectName>Editor' builds the editor module, which is the most
 * common development build target in an Unreal project.
 */
function buildUBTArgs(projectPath: string, projectName: string): string[] {
  if (!PLATFORM_NAME) {
    throw new Error(`Unsupported platform for Unreal build: ${process.platform}`);
  }
  return [
    `${projectName}Editor`,   // Build target
    PLATFORM_NAME,            // Platform: Mac or Win64
    'Development',            // Configuration
    projectPath,              // .uproject path
    '-WaitMutex',             // Prevent concurrent UBT runs
  ];
}

/**
 * Construct the shell arguments for a UAT build+cook+package (RunUAT.sh / .bat).
 *
 * Produces a BuildCookRun command targeting the host platform Development with
 * staging. Output archive is written to <ProjectRoot>/Build/Packaged/<Platform>/.
 */
function buildUATArgs(projectPath: string): string[] {
  if (!PLATFORM_NAME) {
    throw new Error(`Unsupported platform for Unreal package: ${process.platform}`);
  }
  const projectRoot = path.dirname(projectPath);
  const archiveDir  = path.join(projectRoot, 'Build', 'Packaged', PLATFORM_NAME);

  return [
    'BuildCookRun',
    `-project=${projectPath}`,
    `-platform=${PLATFORM_NAME}`,
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
  if (!IS_MACOS && !IS_WINDOWS) {
    return { ok: false, error: `Unreal build execution is not supported on platform: ${process.platform}` };
  }

  // Resolve the correct script
  let scriptPath: string | null;
  let args: string[];

  if (buildMode === 'build') {
    scriptPath = findBuildScript(engineRoot);
    if (!scriptPath) {
      const expected = IS_WINDOWS
        ? path.join(engineRoot, 'Engine\\Build\\BatchFiles\\Build.bat')
        : path.join(engineRoot, 'Engine/Build/BatchFiles/Mac/Build.sh');
      return { ok: false, error: `Build script not found at expected path: ${expected}` };
    }
    args = buildUBTArgs(projectPath, projectName);
  } else {
    // package
    scriptPath = findRunUATScript(engineRoot);
    if (!scriptPath) {
      const expected = IS_WINDOWS
        ? path.join(engineRoot, 'Engine\\Build\\BatchFiles\\RunUAT.bat')
        : path.join(engineRoot, 'Engine/Build/BatchFiles/RunUAT.sh');
      return { ok: false, error: `RunUAT script not found at expected path: ${expected}` };
    }
    args = buildUATArgs(projectPath);
  }

  // On macOS the .sh script needs to be executable. On Windows .bat is run by
  // cmd.exe so chmod doesn't apply.
  if (IS_MACOS) {
    try { fs.chmodSync(scriptPath, 0o755); } catch { /* non-fatal */ }
  }

  // Create a timestamped log file for stdout/stderr capture
  const logPath = path.join(os.tmpdir(), `tf-unreal-${buildMode}-${Date.now()}.log`);

  const quoted = args.map(a => a.includes(' ') ? `"${a}"` : a).join(' ');
  const command = IS_WINDOWS ? `cmd /c "${scriptPath}" ${quoted}` : `${scriptPath} ${quoted}`;

  try {
    const logStream = fs.createWriteStream(logPath, { flags: 'w' });
    logStream.write(
      `# TriForge Unreal ${buildMode === 'build' ? 'Build' : 'Package'} Log\n` +
      `# Started: ${new Date().toISOString()}\n` +
      `# Platform: ${IS_WINDOWS ? 'Windows' : 'macOS'}\n` +
      `# Command: ${command}\n` +
      `# Project: ${projectPath}\n\n`,
    );

    // Windows: invoke the .bat through cmd.exe so PATH/quoting work correctly.
    // macOS:   spawn the .sh directly (already chmod +x'd above).
    const proc = IS_WINDOWS
      ? spawn('cmd.exe', ['/c', scriptPath, ...args], {
          detached: true,
          stdio:    ['ignore', logStream, logStream],
          cwd:      path.dirname(projectPath),
          windowsHide: true,
        })
      : spawn(scriptPath, args, {
          detached: true,
          stdio:    ['ignore', logStream, logStream],
          cwd:      path.dirname(projectPath),
        });

    proc.unref();

    if (!proc.pid) {
      return {
        ok: false,
        command,
        logPath,
        error: 'Process spawned but no PID was assigned — the build script may not be executable.',
      };
    }

    return { ok: true, pid: proc.pid, command, logPath };

  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, command, logPath, error: `Failed to spawn build process: ${msg}` };
  }
}
