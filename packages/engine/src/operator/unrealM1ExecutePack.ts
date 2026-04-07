// ── operator/unrealM1ExecutePack.ts — Unreal Milestone 1 Execution Pack ────────
//
// Phase 4, Step 1: First real project-modification workflow.
//
// This pack moves from planning into actual project action. It generates
// structured implementation artifacts into the active Unreal project's
// TriForge/ directory — real files on disk, tied to the confirmed project path.
//
// Execution mode: project-side file generation
//   - TriForge/M1_Foundation_Setup.md  — human-readable M1 implementation guide
//   - TriForge/M1_InputActions.json    — Enhanced Input action spec
//   - TriForge/M1_ProjectConfig.json   — game mode / player / camera spec
//   - TriForge/M1_Manifest.json        — machine-readable manifest for chaining
//
// TRULY IMPLEMENTED:
//   - Bootstrap readiness gate (reuses evaluateUnrealBootstrapReadiness)
//   - Scaffold generation inline (reuses generateUnrealSystemScaffold)
//   - Milestone generation inline (reuses generateUnrealMilestones)
//   - Project-path gate (requires high-confidence .uproject path)
//   - TriForge/ directory creation in the real project root
//   - 3 structured specification files + 1 manifest written to disk
//   - Durable unreal_m1_execution_report artifact via WorkerRun
//
// NOT YET:
//   - Blueprint asset generation
//   - C++ file generation
//   - Editor-side asset creation / import
//   - Input mapping context .uasset creation
//   - Post-write editor reload trigger
//   - Milestone 2+ execution

import type { WorkflowPack } from './workflowPackTypes';

// ── Result types ──────────────────────────────────────────────────────────────

/**
 * Top-level outcome of Milestone 1 execution.
 *
 *   'applied'               — all target files written cleanly
 *   'applied_with_warnings' — files written but with non-fatal issues
 *   'partially_applied'     — some files written, some failed
 *   'blocked'               — bootstrap / project path / planning gate failed
 *   'failed'                — file system error prevented all writes
 */
export type UnrealM1ExecutionOutcome =
  | 'applied'
  | 'applied_with_warnings'
  | 'partially_applied'
  | 'blocked'
  | 'failed';

/** A single action taken (or attempted) during M1 execution. */
export interface UnrealM1ExecutionAction {
  name: string;
  kind: 'file_generated' | 'directory_created' | 'spec_created' | 'manifest_written';
  status: 'done' | 'skipped' | 'failed';
  /** Relative path (relative to project root) for file/directory actions. */
  relativePath?: string;
  detail: string;
}

/**
 * Structured output of the Unreal Milestone 1 Execution Pack.
 * Embedded in the unreal_m1_execution_report artifact.
 */
export interface UnrealM1ExecutionResult {
  outcome: UnrealM1ExecutionOutcome;
  projectName?: string;
  projectPath?: string;
  /** Absolute path to the TriForge/ working directory in the project. */
  triforgeDir?: string;
  milestoneTitle?: string;
  actions: UnrealM1ExecutionAction[];
  warnings: string[];
  blockers: string[];
}

// ── Pack definition ───────────────────────────────────────────────────────────

/**
 * Unreal Milestone 1 Execution Pack.
 *
 * The first pack that makes real changes to an Unreal project.
 *
 * Flow:
 *   1. List running apps + get frontmost (awareness context)
 *   2. Run Unreal Bootstrap gate — STOP if blocked
 *   3. Generate scaffold plan inline
 *   4. Generate milestone plan inline
 *   5. Validate project path gate (requires high-confidence path)
 *   6. Write M1 implementation artifacts to <projectRoot>/TriForge/
 *   7. Assemble durable unreal_m1_execution_report artifact
 *
 * Input:  WorkflowRunOptions.prototypeGoal  — plain-language prototype goal
 * Output: UnrealM1ExecutionResult embedded in the unreal_m1_execution_report
 *
 * Execution mode: project-side file generation only.
 * No Blueprints, C++ files, or editor assets are created.
 * The generated files are immediately usable by the developer in Unreal Editor.
 */
export const UNREAL_M1_EXECUTE: WorkflowPack = {
  id:       'pack.unreal-m1-execute',
  name:     'Unreal M1 Execute',
  tagline:  'Apply Milestone 1 foundation artifacts to the active Unreal project.',
  description:
    'The first pack that makes real changes to an Unreal project. ' +
    'Gates on the Bootstrap readiness check, generates a prototype scaffold and ' +
    'milestone plan inline, then writes structured implementation artifacts into ' +
    'the project\'s TriForge/ directory: an M1 implementation guide (Markdown), ' +
    'an Enhanced Input action spec (JSON), a project configuration spec (JSON), ' +
    'and a machine-readable manifest for future pack chaining. ' +
    'Requires a high-confidence project path (Unreal Editor must be running with a ' +
    'confirmed project open). Provide the prototype goal via the prototypeGoal run option. ' +
    'Execution mode: project-side file generation only — no Blueprints are created.',
  category: 'diagnostic',
  version:  '1.0.0',
  requirements: {
    platforms:        ['macOS'],
    capabilities:     [],
    permissions:      {},
    targetApp:        null,
    providerRequired: false,
  },
  phases: [
    {
      id:          'list-apps',
      name:        'List Running Apps',
      description: 'Gathers the current running-app state for Unreal awareness context.',
      kind:        'list_apps',
      requiresApproval: false,
      onFailure:   'warn_continue',
    },
    {
      id:          'get-frontmost',
      name:        'Get Frontmost App',
      description: 'Reads the currently focused app for awareness context.',
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
        'Execution is blocked if readiness is blocked — writing project files ' +
        'without a confirmed project context would be unsafe.',
      kind:        'unreal_bootstrap_check',
      requiresApproval: false,
      onFailure:   'stop',
    },
    {
      id:          'unreal-scaffold-generate',
      name:        'Generate System Scaffold',
      description:
        'Generates the prototype system scaffold from the prototypeGoal option. ' +
        'Provides the system/category context that drives M1 specification content.',
      kind:        'unreal_scaffold_generate',
      requiresApproval: false,
      onFailure:   'warn_continue',
    },
    {
      id:          'unreal-milestone-plan',
      name:        'Generate Milestone Plan',
      description:
        'Groups scaffold items into ordered milestones. ' +
        'M1 steps are used to populate the implementation guide content.',
      kind:        'unreal_milestone_plan',
      requiresApproval: false,
      onFailure:   'warn_continue',
    },
    {
      id:          'unreal-m1-execute',
      name:        'Apply M1 Project Artifacts',
      description:
        'Creates the TriForge/ directory in the project root and writes ' +
        'M1_Foundation_Setup.md, M1_InputActions.json, M1_ProjectConfig.json, ' +
        'and M1_Manifest.json. These are real files on disk that ground the ' +
        'prototype plan in the actual Unreal project.',
      kind:        'unreal_m1_execute',
      requiresApproval: false,
      onFailure:   'warn_continue',
    },
    {
      id:          'report',
      name:        'Build Execution Report',
      description:
        'Assembles the execution outcome, file list, project identity, and ' +
        'warnings into a durable unreal_m1_execution_report artifact.',
      kind:        'report',
      requiresApproval: false,
      onFailure:   'warn_continue',
    },
  ],
  tags: [
    'unreal', 'unreal-engine', 'milestone', 'execute', 'm1',
    'project-modification', 'file-generation', 'foundation',
    'player', 'camera', 'input', 'game-mode',
  ],
  estimatedDurationSec: 20,
  successCriteria:
    'Milestone 1 implementation artifacts are written to <projectRoot>/TriForge/. ' +
    'outcome="applied" with at least 3 generated files is the success state. ' +
    'A blocked or failed result is also valid output — precision is the goal.',
};
