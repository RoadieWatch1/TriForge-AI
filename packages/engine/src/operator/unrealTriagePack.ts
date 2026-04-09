// ── operator/unrealTriagePack.ts — Unreal Error Triage Workflow Pack ──────────
//
// Phase 3, Step 4: First real Unreal failure intelligence layer.
//
// Consumes a build log path (from a prior build run, the Unreal awareness
// snapshot, or the project's Saved/Logs/ directory) and returns a structured
// triage result — classified failure types, evidence lines, and remediation hints.
//
// TRULY IMPLEMENTED:
//   - Log source discovery (build artifact → awareness log → project log)
//   - Bounded log reading (last 500 → 2000 lines if needed)
//   - Pattern classification for 8+ Unreal failure categories
//   - Evidence extraction (3–5 surrounding lines per finding)
//   - Remediation hints per finding code
//   - Durable unreal_triage_report artifact
//
// NOT YET:
//   - Automatic remediation application
//   - Full semantic log understanding
//   - Deep project-level analysis (dependency graphs, asset trees)
//   - Windows / Linux support in the execution path
//   - Unreal plugin/bridge integration

import type { WorkflowPack } from './workflowPackTypes';

// ── Result types ──────────────────────────────────────────────────────────────

/**
 * Top-level triage outcome.
 *
 *   'classified'    — at least one recognized failure pattern found
 *   'unclassified'  — log was read but no known pattern matched
 *   'blocked'       — no usable log source was found
 */
export type UnrealTriageOutcome = 'classified' | 'unclassified' | 'blocked';

/**
 * Machine-readable failure classification codes.
 * Stable — safe for downstream packs and remediation logic.
 */
export type UnrealTriageIssueCode =
  | 'cpp_compile_error'       // C++ compilation error (syntax, undeclared id, type mismatch)
  | 'missing_plugin'          // Plugin not found / failed to load
  | 'missing_module'          // Module not found / failed to load
  | 'cook_failure'            // Cook commandlet failure
  | 'packaging_failure'       // UAT packaging stage failure
  | 'ubt_failure'             // UnrealBuildTool failure
  | 'uat_failure'             // AutomationTool failure (non-zero exit)
  | 'missing_asset_reference' // Missing / broken asset references
  | 'toolchain_missing'       // Xcode / clang / toolchain not found
  | 'log_not_found'           // No usable log source located
  | 'no_build_artifact'       // No prior build run artifact available
  | 'unknown_failure';        // Log read successfully but no pattern matched

export interface UnrealTriageFinding {
  code: UnrealTriageIssueCode;
  /** How confident the pattern match is. */
  confidence: 'high' | 'medium' | 'low';
  /** Short human-readable description of what was found. */
  message: string;
  /** Matching log lines + surrounding context (max 5 entries). */
  evidence?: string[];
  /** Practical next-step guidance. */
  remediationHints: string[];
}

/**
 * Full structured output of the Unreal Error Triage Pack.
 * Embedded in the unreal_triage_report artifact and safe for council prompts.
 */
export interface UnrealTriageResult {
  /** Overall triage verdict. */
  outcome: UnrealTriageOutcome;
  /** The log file that was analyzed. */
  sourceLogPath?: string;
  /** Which source was used for the log. */
  sourceKind?: 'build_artifact' | 'awareness_log' | 'project_log';
  /** All identified findings, most critical first. */
  findings: UnrealTriageFinding[];
  /** One-or-two sentence human-readable summary for council / Sessions. */
  summary: string;
}

// ── Pack definition ───────────────────────────────────────────────────────────

/**
 * Unreal Error Triage Pack — the first Unreal failure intelligence workflow.
 *
 * Discovers the best available Unreal log source (explicit path, build artifact
 * log, awareness snapshot log, or project Saved/Logs/), reads a bounded portion,
 * applies a deterministic pattern library, and returns structured findings with
 * remediation hints.
 *
 * Can be run:
 *   - Immediately after pack.unreal-build when a build fails
 *   - Standalone as a diagnostic for any Unreal log file
 *   - With opts.triageLogPath to target a specific log
 *
 * Always produces a triage artifact — even when the outcome is 'blocked' or
 * 'unclassified', the report tells you why and what was checked.
 */
export const UNREAL_ERROR_TRIAGE: WorkflowPack = {
  id:      'pack.unreal-triage',
  name:    'Unreal Error Triage',
  tagline: 'Analyze Unreal build logs and classify failures with remediation hints.',
  description:
    'Locates the best available Unreal log source — from a prior build artifact, ' +
    'the live awareness snapshot, or the project\'s Saved/Logs/ directory — then reads ' +
    'a bounded portion and applies a deterministic pattern library to classify the ' +
    'most common Unreal failure types. Returns structured findings with issue codes, ' +
    'confidence levels, evidence lines, and practical remediation hints. ' +
    'Produces a durable unreal_triage_report artifact for Sessions and workflow chaining. ' +
    'Provide opts.triageLogPath to target a specific log file; otherwise the pack ' +
    'auto-discovers the best available source.',
  category: 'diagnostic',
  version:  '1.0.0',
  requirements: {
    platforms:        ['macOS', 'Windows'],
    capabilities:     [],
    permissions:      {},
    targetApp:        null,
    providerRequired: false,
  },
  phases: [
    {
      id:          'list-apps',
      name:        'List Running Apps',
      description: 'Gathers the current running-app state for awareness context.',
      kind:        'list_apps',
      requiresApproval: false,
      onFailure:   'warn_continue',
    },
    {
      id:          'get-frontmost',
      name:        'Get Frontmost App',
      description: 'Reads the currently focused app for context.',
      kind:        'get_frontmost',
      requiresApproval: false,
      onFailure:   'warn_continue',
      optional:    true,
    },
    {
      id:          'unreal-bootstrap-context',
      name:        'Unreal Context Snapshot',
      description:
        'Runs the bootstrap awareness check to get the current Unreal snapshot ' +
        '(project path, log path, build state). Does NOT block if Unreal is not ready — ' +
        'triage should work even when the editor is in a bad state.',
      kind:        'unreal_bootstrap_check',
      requiresApproval: false,
      onFailure:   'warn_continue',  // Never block triage — we may be triaging a crash
    },
    {
      id:          'unreal-log-triage',
      name:        'Analyze Unreal Log',
      description:
        'Discovers the best available log source, reads a bounded portion, applies ' +
        'failure pattern classification, and extracts evidence + remediation hints.',
      kind:        'unreal_triage_analyze',
      requiresApproval: false,
      onFailure:   'warn_continue',  // Always produce a report
    },
    {
      id:          'report',
      name:        'Build Triage Report',
      description: 'Assembles the triage outcome, findings, and log source into a durable artifact.',
      kind:        'report',
      requiresApproval: false,
      onFailure:   'warn_continue',
    },
  ],
  tags: [
    'unreal', 'unreal-engine', 'triage', 'error', 'diagnostic',
    'build-failure', 'log-analysis', 'remediation',
  ],
  estimatedDurationSec: 12,
  successCriteria:
    'A triage report is produced with an honest outcome (classified/unclassified/blocked). ' +
    'Success even when the outcome is "unclassified" — the report IS the deliverable.',
};
