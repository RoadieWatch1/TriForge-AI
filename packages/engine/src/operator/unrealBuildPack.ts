// ── operator/unrealBuildPack.ts — Unreal Build & Package Workflow Pack ────────
//
// Phase 3, Step 3: First real Unreal execution workflow.
//
// This pack takes the readiness gate established by pack.unreal-bootstrap and
// crosses it into actual attempted work: locating the Unreal Build Tool,
// validating the project path, and launching a real build or packaging subprocess.
//
// The result is always honest:
//   - 'started'   — subprocess launched, running in background, log path returned
//   - 'blocked'   — a pre-flight check failed (bootstrap, path, tool discovery)
//   - 'failed'    — subprocess launch itself failed (exec error, permissions, etc.)
//   - 'succeeded' — reserved for future synchronous short builds; not used yet
//
// TRULY IMPLEMENTED:
//   - Bootstrap readiness gate (reuses evaluateUnrealBootstrapReadiness)
//   - Project path validation (must be 'high' confidence .uproject path)
//   - Engine root discovery from running UnrealEditor process args
//   - Build.sh / RunUAT.sh path resolution from engine root
//   - Build-already-in-progress detection via awareness snapshot
//   - Real subprocess launch (detached, stdout+stderr → temp log file)
//   - Structured result with specific issue codes
//   - Durable unreal_build_report artifact
//
// NOT YET:
//   - Synchronous build completion tracking (process runs in background)
//   - Deep stdout/stderr parsing
//   - Deterministic packaging completion signal
//   - Error triage from build output
//   - Windows or Linux build paths
//   - Custom build targets beyond '<ProjectName>Editor'

import type { WorkflowPack } from './workflowPackTypes';

// ── Result types ──────────────────────────────────────────────────────────────

/**
 * Top-level outcome of the Unreal Build & Package pack execution.
 *
 *   'started'   — subprocess launched successfully; build is running in background
 *   'blocked'   — a pre-flight gate failed; no execution was attempted
 *   'failed'    — execution was attempted but the subprocess launch itself failed
 *   'succeeded' — reserved; not currently produced (builds are async)
 */
export type UnrealBuildOutcome = 'started' | 'succeeded' | 'failed' | 'blocked';

/**
 * Machine-readable codes for build issues.
 * Stable — safe for downstream packs and error triage logic to branch on.
 */
export type UnrealBuildIssueCode =
  | 'bootstrap_blocked'        // evaluateUnrealBootstrapReadiness() returned 'blocked'
  | 'project_path_missing'     // bootstrap result has no confirmed projectPath
  | 'build_already_in_progress'// awareness snapshot shows buildState = building/packaging
  | 'engine_root_not_found'    // could not derive engine root from running process
  | 'build_tool_not_found'     // Build.sh or RunUAT.sh not present at expected path
  | 'launch_failed'            // spawn() call itself threw or returned a non-pid error
  | 'build_failed';            // reserved for future synchronous failure detection

export interface UnrealBuildIssue {
  severity: 'warning' | 'blocker';
  code: UnrealBuildIssueCode;
  message: string;
}

/**
 * Structured output of the Unreal Build & Package pack.
 * Embedded in the WorkflowArtifact.data as 'unrealBuild'.
 */
export interface UnrealBuildResult {
  /** Top-level outcome. */
  outcome: UnrealBuildOutcome;
  /**
   * The build mode that was used or attempted.
   *   'build'   — C++ compilation via UBT / Build.sh
   *   'package' — full cook+build+stage+pack via UAT / RunUAT.sh
   *   'unknown' — mode could not be determined (blocked before reaching execution)
   */
  buildMode: 'build' | 'package' | 'unknown';
  /** Project name from the bootstrap result. */
  projectName?: string;
  /** Absolute .uproject path (used as the build target). */
  projectPath?: string;
  /** Full shell command that was launched (or would have been launched). */
  command?: string;
  /** PID of the launched build subprocess, if successfully started. */
  pid?: number;
  /** Path to the temp log file where stdout/stderr is being written. */
  logPath?: string;
  /** Engine root directory (e.g. /Users/Shared/Epic Games/UE_5.3). */
  engineRoot?: string;
  /** All detected issues — ordered blockers before warnings. */
  issues: UnrealBuildIssue[];
}

// ── Pack definition ───────────────────────────────────────────────────────────

/**
 * Unreal Build & Package Pack.
 *
 * The first pack that performs real Unreal execution work:
 *   1. Runs the bootstrap readiness gate (hard stop if blocked)
 *   2. Validates the project path is confirmed
 *   3. Checks no build is already running
 *   4. Resolves the engine root from the running UnrealEditor process
 *   5. Verifies the appropriate build tool script exists
 *   6. Launches the build/package subprocess (detached, logging to file)
 *   7. Returns outcome='started' with PID and log path
 *
 * Build mode is set via WorkflowRunOptions.buildMode (default: 'build').
 *
 * The build subprocess is long-running and runs in the background.
 * Use the logPath artifact field to monitor progress.
 */
export const UNREAL_BUILD_PACKAGE: WorkflowPack = {
  id:      'pack.unreal-build',
  name:    'Unreal Build & Package',
  tagline: 'Validate readiness and launch a real Unreal Engine build or package operation.',
  description:
    'Runs the Unreal Bootstrap readiness gate, then — if the machine is ready — ' +
    'locates the Unreal Build Tool relative to the running editor, validates the ' +
    'confirmed project path, and launches a real build (C++ compilation) or ' +
    'package (full cook/build/stage/pak) subprocess. ' +
    'The build runs in the background; the pack returns outcome="started" with ' +
    'the subprocess PID and a log file path for progress monitoring. ' +
    'All pre-flight failures surface as structured blockers with specific codes. ' +
    'Build mode is controlled by the buildMode option (default: build). ' +
    'Requires Unreal Editor to be running with a confirmed project open.',
  category: 'diagnostic',
  version:  '1.0.0',
  requirements: {
    platforms:        ['macOS'],
    capabilities:     [],      // detection is internal; no operator capability needed
    permissions:      {},      // no OS permissions required for subprocess launch
    // targetApp null — bootstrap check gates on Unreal presence internally
    targetApp:        null,
    providerRequired: false,
  },
  phases: [
    {
      id:          'list-apps',
      name:        'List Running Apps',
      description: 'Confirms the current running-app state before the bootstrap gate.',
      kind:        'list_apps',
      requiresApproval: false,
      onFailure:   'warn_continue',
    },
    {
      id:          'get-frontmost',
      name:        'Get Frontmost App',
      description: 'Reads the currently focused app for bootstrap context.',
      kind:        'get_frontmost',
      requiresApproval: false,
      onFailure:   'warn_continue',
      optional:    true,
    },
    {
      id:          'unreal-bootstrap-preflight',
      name:        'Unreal Bootstrap Preflight',
      description:
        'Runs the Unreal Bootstrap readiness evaluator. ' +
        'Aborts the build pack if readiness is blocked — no execution attempted.',
      kind:        'unreal_bootstrap_check',
      requiresApproval: false,
      onFailure:   'stop',   // Bootstrap blocked → abort; do not attempt the build
    },
    {
      id:          'unreal-build-check',
      name:        'Validate Build Environment',
      description:
        'Confirms the project path, checks that no build is already active, ' +
        'resolves the engine root from the running process, and verifies that ' +
        'the appropriate build script (Build.sh / RunUAT.sh) is present.',
      kind:        'unreal_build_check',
      requiresApproval: false,
      onFailure:   'stop',   // Missing path or tool → abort cleanly
    },
    {
      id:          'unreal-build-execute',
      name:        'Launch Build Subprocess',
      description:
        'Launches the build or package subprocess in the background. ' +
        'Captures the PID and redirects stdout/stderr to a temp log file. ' +
        'Returns outcome="started" immediately — the build runs asynchronously.',
      kind:        'unreal_build_execute',
      requiresApproval: false,
      onFailure:   'warn_continue',  // Launch failure → record error, still produce report
    },
    {
      id:          'report',
      name:        'Build Build Report',
      description: 'Assembles the build outcome, project info, command, PID, and log path into a durable artifact.',
      kind:        'report',
      requiresApproval: false,
      onFailure:   'warn_continue',
    },
  ],
  tags: [
    'unreal', 'unreal-engine', 'build', 'package', 'compile',
    'ubt', 'uat', 'execute', 'worker',
  ],
  estimatedDurationSec: 15,  // Until 'started' — the build itself takes much longer
  successCriteria:
    'A build subprocess is launched and a durable build report artifact is produced. ' +
    'outcome="started" with a valid PID and log path is the success state. ' +
    'A blocked or failed result is also valid output — precision is the goal.',
};
