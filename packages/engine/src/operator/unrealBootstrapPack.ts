// ── operator/unrealBootstrapPack.ts — Unreal Bootstrap Workflow Pack ──────────
//
// Phase 3, Step 2: First real Unreal-domain workflow pack.
//
// The Unreal Bootstrap Pack is the canonical entry gate for all Unreal work
// in TriForge. It evaluates whether the current machine state is ready for
// Unreal Engine operations and returns a structured, honest readiness result.
//
// This pack:
//   - Uses the Phase 3 Step 1 UnrealAwarenessSnapshot
//   - Evaluates Unreal installed / running / project / build / error state
//   - Returns structured blockers and warnings (never silently ignores gaps)
//   - Produces a durable WorkerRun via the existing workflow bridge
//   - Serves as the gate before all later Unreal packs
//
// TRULY IMPLEMENTED:
//   - Unreal installed/running/frontmost detection
//   - Project identity evaluation with confidence tracking
//   - Build-in-progress warning
//   - Obvious error hint surfacing
//   - Structured readiness output (ready | ready_with_warnings | blocked)
//
// NOT YET:
//   - Project creation or scaffolding
//   - Build or package command execution
//   - Deep log analysis
//   - Unreal plugin / remote-control bridge
//   - Editor UI manipulation

import type { WorkflowPack } from './workflowPackTypes';
import type { UnrealAwarenessSnapshot } from '../awareness/types';

// ── Result types ──────────────────────────────────────────────────────────────

/** Top-level readiness verdict for the Unreal Bootstrap check. */
export type UnrealBootstrapReadiness = 'ready' | 'ready_with_warnings' | 'blocked';

/**
 * Machine-readable codes for each detected issue.
 * These codes are stable and safe for downstream packs to branch on.
 */
export type UnrealBootstrapIssueCode =
  | 'unreal_not_installed'    // Engine not detected on this machine
  | 'unreal_not_running'      // Editor process not found in running-apps list
  | 'project_not_detected'    // Editor running but no project identified
  | 'project_confidence_low'  // Project identified but confidence is low (medium/low/unknown)
  | 'build_in_progress'       // Build or packaging operation appears active
  | 'obvious_error_state';    // Fatal error or crash hint found in recent log

export interface UnrealBootstrapIssue {
  severity: 'warning' | 'blocker';
  code: UnrealBootstrapIssueCode;
  message: string;
}

/**
 * The structured output of `evaluateUnrealBootstrapReadiness()`.
 *
 * Safe to embed in WorkflowArtifact.data and in council prompts.
 */
export interface UnrealBootstrapResult {
  /** Overall readiness verdict. */
  readiness: UnrealBootstrapReadiness;
  /** Whether the Unreal Editor process is currently running. */
  editorRunning: boolean;
  /** Whether the Unreal Editor is currently the frontmost app. */
  editorFrontmost?: boolean;
  /** Detected project name (if any). */
  projectName?: string;
  /** Absolute .uproject path (only present at 'high' confidence). */
  projectPath?: string;
  /** How confident we are about the project identification. */
  projectConfidence?: 'high' | 'medium' | 'low' | 'unknown';
  /** Last known build / packaging state. */
  buildState?: 'idle' | 'building' | 'packaging' | 'unknown';
  /** All detected issues — ordered blockers before warnings. */
  issues: UnrealBootstrapIssue[];
}

// ── Pure evaluation function ──────────────────────────────────────────────────

/**
 * Evaluate Unreal Engine readiness from a live `UnrealAwarenessSnapshot`.
 *
 * Pure function — no I/O, no side effects. Safe to call in the engine layer
 * and in council context builders.
 *
 * Evaluation order (mirrors spec §7):
 *   1. Engine installed?      → blocker: unreal_not_installed
 *   2. Editor running?        → blocker: unreal_not_running
 *   3. Project detected?      → blocker: project_not_detected
 *   4. Project confidence?    → warning (medium) or blocker (low/unknown)
 *   5. Build in progress?     → warning: build_in_progress
 *   6. Obvious error in log?  → warning: obvious_error_state
 */
export function evaluateUnrealBootstrapReadiness(
  snapshot: UnrealAwarenessSnapshot,
): UnrealBootstrapResult {
  const issues: UnrealBootstrapIssue[] = [];

  // ── 1. Installed ─────────────────────────────────────────────────────────────
  // installed === false means we actively found no evidence of an install.
  // installed === undefined means we can't tell — don't block on uncertainty.
  if (snapshot.installed === false) {
    issues.push({
      severity: 'blocker',
      code:    'unreal_not_installed',
      message: 'Unreal Engine does not appear to be installed on this machine. ' +
               'Install it from the Epic Games Launcher before starting Unreal work.',
    });
  }

  // ── 2. Running ───────────────────────────────────────────────────────────────
  if (!snapshot.running) {
    issues.push({
      severity: 'blocker',
      code:    'unreal_not_running',
      message: snapshot.installed === false
        ? 'Unreal Editor is not running. Install Unreal Engine first, then launch the editor.'
        : 'Unreal Editor is not currently running. ' +
          'Launch it from the Epic Games Launcher or from your project before starting Unreal work.',
    });

    // Can't assess project/build/error if the editor isn't running
    return {
      readiness:      'blocked',
      editorRunning:  false,
      editorFrontmost: false,
      issues,
    };
  }

  // ── 3. Project detected ──────────────────────────────────────────────────────
  if (!snapshot.projectDetected) {
    issues.push({
      severity: 'blocker',
      code:    'project_not_detected',
      message: 'Unreal Editor is running but no project could be identified. ' +
               'Open or select a project in the editor before starting Unreal work.',
    });
  }

  // ── 4. Project confidence ────────────────────────────────────────────────────
  if (snapshot.projectDetected) {
    if (snapshot.projectConfidence === 'medium') {
      // Window-title detection only — path is unknown
      issues.push({
        severity: 'warning',
        code:    'project_confidence_low',
        message: `Project "${snapshot.projectName ?? 'unknown'}" was identified from the editor window title only. ` +
                 'The project file path is not confirmed. ' +
                 'If this is the wrong project, switch projects in the editor.',
      });
    } else if (
      snapshot.projectConfidence === 'low' ||
      snapshot.projectConfidence === 'unknown'
    ) {
      // Detected but confidence too low to proceed safely
      issues.push({
        severity: 'blocker',
        code:    'project_confidence_low',
        message: `A project was detected but confidence is too low to proceed safely ` +
                 `(confidence: ${snapshot.projectConfidence ?? 'unknown'}). ` +
                 'Open a specific project in the Unreal Editor to continue.',
      });
    }
    // 'high' confidence → no issue
  }

  // ── 5. Build in progress ─────────────────────────────────────────────────────
  if (snapshot.buildState === 'building') {
    issues.push({
      severity: 'warning',
      code:    'build_in_progress',
      message: 'A build or compilation appears to be in progress in Unreal Editor. ' +
               'Wait for the build to complete before starting Unreal work.',
    });
  } else if (snapshot.buildState === 'packaging') {
    issues.push({
      severity: 'warning',
      code:    'build_in_progress',
      message: 'A packaging operation appears to be in progress. ' +
               'Wait for packaging to complete before starting Unreal work.',
    });
  }

  // ── 6. Obvious error ─────────────────────────────────────────────────────────
  if (snapshot.obviousErrorState) {
    issues.push({
      severity: 'warning',
      code:    'obvious_error_state',
      message: 'An error or crash hint was found in the recent Unreal log: ' +
               snapshot.obviousErrorState.slice(0, 150),
    });
  }

  // ── Readiness verdict ────────────────────────────────────────────────────────
  const hasBlockers = issues.some(i => i.severity === 'blocker');
  const hasWarnings = issues.some(i => i.severity === 'warning');
  const readiness: UnrealBootstrapReadiness =
    hasBlockers ? 'blocked' :
    hasWarnings ? 'ready_with_warnings' :
                  'ready';

  return {
    readiness,
    editorRunning:    snapshot.running,
    editorFrontmost:  snapshot.frontmost,
    projectName:      snapshot.projectName,
    projectPath:      snapshot.projectPath,
    projectConfidence: snapshot.projectConfidence,
    buildState:       snapshot.buildState,
    issues,
  };
}

// ── Pack definition ───────────────────────────────────────────────────────────

/**
 * Unreal Bootstrap Pack — the canonical entry gate for all Unreal work.
 *
 * Evaluates Unreal Editor + project state and returns a structured readiness
 * report. Run this before any build, package, or scaffold pack.
 *
 * This pack always produces a readiness report regardless of blocker count.
 * A 'blocked' result is not an error — it is the honest output of a
 * diagnostic pack that found something to fix.
 */
export const UNREAL_BOOTSTRAP: WorkflowPack = {
  id:       'pack.unreal-bootstrap',
  name:     'Unreal Bootstrap',
  tagline:  'Evaluate whether TriForge is ready to begin Unreal Engine work.',
  description:
    'Checks the current machine for a running Unreal Editor, identifies the ' +
    'active project (with confidence tracking), and surfaces any build-in-progress ' +
    'or obvious error signals. Returns a structured readiness report classifying ' +
    'the result as ready, ready with warnings, or blocked — with specific issue ' +
    'codes and remediation messages for every blocker or warning found. ' +
    'Run this as the first step before any Unreal build, package, or scaffold action. ' +
    'No approval required and no write operations are performed.',
  category: 'diagnostic',
  version:  '1.0.0',
  requirements: {
    platforms:        ['macOS'],
    // The pack uses list_apps and get_frontmost internally but does not
    // require them as hard prerequisites — the Unreal check phase handles
    // graceful degradation if these calls fail.
    capabilities:     [],
    permissions:      {},
    // targetApp is intentionally null — the pack diagnoses Unreal presence
    // and reports 'not running' rather than blocking before execution starts.
    targetApp:        null,
    providerRequired: false,
  },
  phases: [
    {
      id:          'list-apps',
      name:        'List Running Apps',
      description: 'Retrieves the current running-apps list to check for Unreal Editor.',
      kind:        'list_apps',
      requiresApproval: false,
      onFailure:   'warn_continue', // If this fails, Unreal check still runs
    },
    {
      id:          'get-frontmost',
      name:        'Get Frontmost App',
      description: 'Reads the currently focused app to determine if Unreal is active.',
      kind:        'get_frontmost',
      requiresApproval: false,
      onFailure:   'warn_continue', // Best-effort — not a blocker
      optional:    true,
    },
    {
      id:          'unreal-bootstrap-check',
      name:        'Evaluate Unreal Readiness',
      description: 'Gathers the Unreal Engine awareness snapshot and evaluates readiness ' +
                   'across installed, running, project, build, and error dimensions.',
      kind:        'unreal_bootstrap_check',
      requiresApproval: false,
      onFailure:   'warn_continue', // Always produce a report, even on partial failure
    },
    {
      id:          'report',
      name:        'Build Bootstrap Report',
      description: 'Assembles the readiness verdict, issues, and project details into ' +
                   'a durable Unreal readiness report artifact.',
      kind:        'report',
      requiresApproval: false,
      onFailure:   'warn_continue',
    },
  ],
  tags: [
    'unreal', 'unreal-engine', 'bootstrap', 'readiness',
    'diagnostic', 'project', 'entry-gate',
  ],
  estimatedDurationSec: 10,
  successCriteria:
    'A structured Unreal readiness report is produced with an honest verdict. ' +
    'Success even if the verdict is "blocked" — the report IS the deliverable.',
};
