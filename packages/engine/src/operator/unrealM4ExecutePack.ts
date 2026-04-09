// ── operator/unrealM4ExecutePack.ts — Unreal Milestone 4 Execution Pack ────────
//
// Phase 4, Step 5: Fourth real project-modification workflow.
//
// Continues the M1→M2→M3 file-generation chain into the enemy/combat layer —
// the fastest path toward a visibly playable prototype loop.
//
// Execution mode: project-side file generation (same as M1/M2/M3)
//   - TriForge/M4_EnemyCombat_Setup.md      — human-readable M4 implementation guide
//   - TriForge/M4_EnemyArchetypes.json      — enemy archetype definitions (scaffold-adaptive)
//   - TriForge/M4_CombatConfig.json         — foundational combat tuning config
//   - TriForge/M4_DetectionAggroConfig.json — sight/hearing/chase/aggro shell config
//   - TriForge/M4_Manifest.json             — machine-readable manifest with M3 dependency
//
// TRULY IMPLEMENTED:
//   - Bootstrap readiness gate
//   - High-confidence project path gate
//   - Scaffold/milestone inline generation (reused from M1/M2/M3 pattern)
//   - M1 + M2 + M3 manifest presence check (chain signal; warns if absent, does not block)
//   - Scaffold-driven content adaptation (survival/enemy/sci-fi/horror goal signals)
//   - Durable unreal_m4_execution_report artifact via WorkerRun
//
// NOT YET:
//   - Enemy Blueprint creation inside Unreal Editor
//   - Behavior tree generation or asset mutation
//   - RC-based editor automation
//   - Milestone 5+ execution

import type { WorkflowPack } from './workflowPackTypes';

// ── Result types ──────────────────────────────────────────────────────────────

export type UnrealM4ExecutionOutcome =
  | 'applied'
  | 'applied_with_warnings'
  | 'partially_applied'
  | 'blocked'
  | 'failed';

export interface UnrealM4ExecutionAction {
  name: string;
  kind: 'file_generated' | 'config_written' | 'spec_created' | 'manifest_written';
  status: 'done' | 'skipped' | 'failed';
  relativePath?: string;
  detail: string;
}

export interface UnrealM4ExecutionResult {
  outcome: UnrealM4ExecutionOutcome;
  projectName?: string;
  projectPath?: string;
  triforgeDir?: string;
  /** True if M1_Manifest.json was found — indicates M1 was applied first. */
  m1FoundationPresent: boolean;
  /** True if M2_Manifest.json was found — indicates M2 was applied first. */
  m2FoundationPresent: boolean;
  /** True if M3_Manifest.json was found — indicates M3 was applied first. */
  m3FoundationPresent: boolean;
  actions: UnrealM4ExecutionAction[];
  warnings: string[];
  blockers: string[];
}

// ── Pack definition ───────────────────────────────────────────────────────────

export const UNREAL_M4_EXECUTE: WorkflowPack = {
  id:       'pack.unreal-m4-execute',
  name:     'Unreal M4 Execute',
  tagline:  'Apply Milestone 4 enemy/combat artifacts (archetypes, combat config, detection) to the Unreal project.',
  description:
    'Continues the M1→M2→M3 project-side file generation chain into the enemy/combat ' +
    'layer — the fastest path toward a visibly playable prototype loop. Gates on Bootstrap ' +
    'readiness and a high-confidence project path, generates scaffold and milestone context ' +
    'inline, then checks for M1/M2/M3 manifest presence (warns if absent, does not block). ' +
    'Writes M4 artifacts into the project\'s TriForge/ directory: an enemy/combat setup ' +
    'guide (Markdown), enemy archetype definitions (JSON), foundational combat config (JSON), ' +
    'detection/aggro shell config (JSON), and an M4 manifest linking back to the M3 chain. ' +
    'Enemy archetypes and combat style adapt to scaffold signals (survival → creatures/infected; ' +
    'sci-fi → drones/raiders; horror → stalkers/brutes; default → melee/ranged/heavy). ' +
    'Execution mode: project-side file generation only — no Blueprints, behavior trees, ' +
    'or editor assets are created.',
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
        'Provides the category context that drives M4 enemy archetype style ' +
        '(survival creatures, sci-fi units, horror stalkers, or default grunts).',
      kind:        'unreal_scaffold_generate',
      requiresApproval: false,
      onFailure:   'warn_continue',
    },
    {
      id:          'unreal-milestone-plan',
      name:        'Generate Milestone Plan',
      description:
        'Groups scaffold items into ordered milestones. M5 steps (enemy/combat) ' +
        'are used to populate the M4 setup guide content.',
      kind:        'unreal_milestone_plan',
      requiresApproval: false,
      onFailure:   'warn_continue',
    },
    {
      id:          'unreal-m4-execute',
      name:        'Apply M4 Project Artifacts',
      description:
        'Checks for M1/M2/M3 foundation presence, then writes ' +
        'M4_EnemyCombat_Setup.md, M4_EnemyArchetypes.json, M4_CombatConfig.json, ' +
        'M4_DetectionAggroConfig.json, and M4_Manifest.json into the project\'s ' +
        'TriForge/ directory. Enemy archetypes and combat style adapt to prototype ' +
        'goal and scaffold signals (survival/sci-fi/horror/default).',
      kind:        'unreal_m4_execute',
      requiresApproval: false,
      onFailure:   'warn_continue',
    },
    {
      id:          'report',
      name:        'Build Execution Report',
      description:
        'Assembles the execution outcome, file list, project identity, chain integrity ' +
        'status, and warnings into a durable unreal_m4_execution_report artifact.',
      kind:        'report',
      requiresApproval: false,
      onFailure:   'warn_continue',
    },
  ],
  tags: [
    'unreal', 'unreal-engine', 'milestone', 'execute', 'm4',
    'enemy', 'combat', 'prototype', 'archetypes', 'detection',
    'project-modification', 'file-generation',
  ],
  estimatedDurationSec: 20,
  successCriteria:
    'Milestone 4 enemy/combat artifacts are written to <projectRoot>/TriForge/. ' +
    'outcome="applied" with at least 4 generated files is the success state.',
};
