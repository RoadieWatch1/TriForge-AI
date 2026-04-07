// ── operator/unrealM2ExecutePack.ts — Unreal Milestone 2 Execution Pack ────────
//
// Phase 4, Step 2: Second real project-modification workflow.
//
// Extends the M1 file-generation pattern into the primary gameplay loop layer:
// health/survival stats, HUD/status display configuration, and primary loop
// implementation guidance.
//
// Execution mode: project-side file generation (same as M1)
//   - TriForge/M2_PrimaryLoop_Setup.md  — human-readable M2 implementation guide
//   - TriForge/M2_SurvivalStats.json    — stat component spec (health/stamina always;
//                                         hunger/thirst when survival goal detected)
//   - TriForge/M2_HUDConfig.json        — HUD widget layout + stat binding spec
//   - TriForge/M2_Manifest.json         — machine-readable manifest with M1 dependency
//
// TRULY IMPLEMENTED:
//   - Bootstrap readiness gate
//   - High-confidence project path gate
//   - Scaffold/milestone inline generation
//   - M1 manifest presence check (chain signal; warns if absent, does not block)
//   - Survival-mode detection (from prototype goal keywords + scaffold categories)
//   - Stat set derived from scaffold (health + stamina always; hunger/thirst if survival)
//   - HUD layout adapted to scaffold (enemy damage flash slot; inventory reservation)
//   - Durable unreal_m2_execution_report artifact via WorkerRun
//
// NOT YET:
//   - Blueprint component generation
//   - Widget Blueprint (.uasset) creation
//   - Editor-side UMG layout writing
//   - Post-write editor reload
//   - Milestone 3+ execution

import type { WorkflowPack } from './workflowPackTypes';

// ── Result types ──────────────────────────────────────────────────────────────

export type UnrealM2ExecutionOutcome =
  | 'applied'
  | 'applied_with_warnings'
  | 'partially_applied'
  | 'blocked'
  | 'failed';

export interface UnrealM2ExecutionAction {
  name: string;
  kind: 'file_generated' | 'config_written' | 'spec_created' | 'manifest_written';
  status: 'done' | 'skipped' | 'failed';
  relativePath?: string;
  detail: string;
}

export interface UnrealM2ExecutionResult {
  outcome: UnrealM2ExecutionOutcome;
  projectName?: string;
  projectPath?: string;
  triforgeDir?: string;
  /** True if M1_Manifest.json was found — indicates M1 was applied first. */
  m1FoundationPresent: boolean;
  actions: UnrealM2ExecutionAction[];
  warnings: string[];
  blockers: string[];
}

// ── Pack definition ───────────────────────────────────────────────────────────

export const UNREAL_M2_EXECUTE: WorkflowPack = {
  id:       'pack.unreal-m2-execute',
  name:     'Unreal M2 Execute',
  tagline:  'Apply Milestone 2 primary loop / health / HUD artifacts to the Unreal project.',
  description:
    'Extends the M1 project-side file generation pattern into the primary gameplay ' +
    'loop layer. Gates on Bootstrap readiness and a high-confidence project path, ' +
    'generates scaffold and milestone context inline, then writes M2 implementation ' +
    'artifacts into the project\'s TriForge/ directory: a primary loop setup guide ' +
    '(Markdown), a survival stat component spec (JSON), a HUD widget layout spec ' +
    '(JSON), and an M2 manifest that links back to the M1 foundation. ' +
    'Survival stats (hunger/thirst) are included only when the prototype goal or ' +
    'scaffold items indicate a survival loop — otherwise only health and stamina are ' +
    'written. HUD layout adapts to enemy and inventory scaffold signals. ' +
    'Execution mode: project-side file generation only — no Blueprints or widget ' +
    'assets are created.',
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
        'Runs the Unreal Bootstrap readiness evaluator. Execution is blocked ' +
        'if readiness is blocked — writing project files without a confirmed ' +
        'project context would be unsafe.',
      kind:        'unreal_bootstrap_check',
      requiresApproval: false,
      onFailure:   'stop',
    },
    {
      id:          'unreal-scaffold-generate',
      name:        'Generate System Scaffold',
      description:
        'Generates the prototype system scaffold from the prototypeGoal option. ' +
        'Provides the category context that drives M2 specification content ' +
        '(survival vs minimal, enemy presence, inventory presence).',
      kind:        'unreal_scaffold_generate',
      requiresApproval: false,
      onFailure:   'warn_continue',
    },
    {
      id:          'unreal-milestone-plan',
      name:        'Generate Milestone Plan',
      description:
        'Groups scaffold items into ordered milestones. M3 steps (primary loop) ' +
        'are used to populate the M2 setup guide content.',
      kind:        'unreal_milestone_plan',
      requiresApproval: false,
      onFailure:   'warn_continue',
    },
    {
      id:          'unreal-m2-execute',
      name:        'Apply M2 Project Artifacts',
      description:
        'Checks for M1 foundation presence, then writes M2_PrimaryLoop_Setup.md, ' +
        'M2_SurvivalStats.json, M2_HUDConfig.json, and M2_Manifest.json into ' +
        'the project\'s TriForge/ directory. Survival depth and HUD layout adapt ' +
        'to the prototype goal and scaffold signals.',
      kind:        'unreal_m2_execute',
      requiresApproval: false,
      onFailure:   'warn_continue',
    },
    {
      id:          'report',
      name:        'Build Execution Report',
      description:
        'Assembles the execution outcome, file list, project identity, and ' +
        'warnings into a durable unreal_m2_execution_report artifact.',
      kind:        'report',
      requiresApproval: false,
      onFailure:   'warn_continue',
    },
  ],
  tags: [
    'unreal', 'unreal-engine', 'milestone', 'execute', 'm2',
    'project-modification', 'file-generation', 'primary-loop',
    'health', 'survival', 'hud', 'stats',
  ],
  estimatedDurationSec: 20,
  successCriteria:
    'Milestone 2 implementation artifacts are written to <projectRoot>/TriForge/. ' +
    'outcome="applied" with at least 3 generated files is the success state.',
};
