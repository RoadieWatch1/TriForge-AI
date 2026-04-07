// ── operator/unrealM3ExecutePack.ts — Unreal Milestone 3 Execution Pack ────────
//
// Phase 4, Step 4B: Third real project-modification workflow.
//
// Continues the M1→M2 file-generation chain into the supporting-systems layer:
// inventory config, item data definitions, and interaction setup.
//
// Execution mode: project-side file generation (same as M1/M2)
//   - TriForge/M3_SupportingSystems_Setup.md — human-readable M3 implementation guide
//   - TriForge/M3_InventoryConfig.json       — inventory component spec (slots/weight/categories)
//   - TriForge/M3_ItemData.json              — item data definitions (adapted per scaffold goal)
//   - TriForge/M3_InteractionConfig.json     — interaction system config (trace/prompt/component)
//   - TriForge/M3_Manifest.json              — machine-readable manifest with M2 dependency
//
// TRULY IMPLEMENTED:
//   - Bootstrap readiness gate
//   - High-confidence project path gate
//   - Scaffold/milestone inline generation (reused from M1/M2 pattern)
//   - M1 + M2 manifest presence check (chain signal; warns if absent, does not block)
//   - Scaffold-driven content adaptation (inventory/survival/enemy signals)
//   - Durable unreal_m3_execution_report artifact via WorkerRun
//
// NOT YET:
//   - Blueprint component generation
//   - Editor-native asset mutation
//   - Post-write editor reload
//   - Milestone 4+ execution

import type { WorkflowPack } from './workflowPackTypes';

// ── Result types ──────────────────────────────────────────────────────────────

export type UnrealM3ExecutionOutcome =
  | 'applied'
  | 'applied_with_warnings'
  | 'partially_applied'
  | 'blocked'
  | 'failed';

export interface UnrealM3ExecutionAction {
  name: string;
  kind: 'file_generated' | 'config_written' | 'spec_created' | 'manifest_written';
  status: 'done' | 'skipped' | 'failed';
  relativePath?: string;
  detail: string;
}

export interface UnrealM3ExecutionResult {
  outcome: UnrealM3ExecutionOutcome;
  projectName?: string;
  projectPath?: string;
  triforgeDir?: string;
  /** True if M1_Manifest.json was found — indicates M1 was applied first. */
  m1FoundationPresent: boolean;
  /** True if M2_Manifest.json was found — indicates M2 was applied first. */
  m2FoundationPresent: boolean;
  actions: UnrealM3ExecutionAction[];
  warnings: string[];
  blockers: string[];
}

// ── Pack definition ───────────────────────────────────────────────────────────

export const UNREAL_M3_EXECUTE: WorkflowPack = {
  id:       'pack.unreal-m3-execute',
  name:     'Unreal M3 Execute',
  tagline:  'Apply Milestone 3 supporting-systems artifacts (inventory, items, interaction) to the Unreal project.',
  description:
    'Continues the M1→M2 project-side file generation chain into the supporting-systems ' +
    'layer. Gates on Bootstrap readiness and a high-confidence project path, generates ' +
    'scaffold and milestone context inline, then checks for M1 and M2 manifest presence ' +
    '(warns if absent, does not block). Writes M3 implementation artifacts into the ' +
    'project\'s TriForge/ directory: a supporting-systems setup guide (Markdown), an ' +
    'inventory component spec (JSON), item data definitions (JSON), an interaction system ' +
    'config (JSON), and an M3 manifest that links back to the M2 foundation. ' +
    'Inventory categories, item types, and interaction hints adapt to scaffold signals ' +
    '(survival adds food/water items; enemy adds ammo; inventory scaffold expands categories). ' +
    'Execution mode: project-side file generation only — no Blueprints or editor assets created.',
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
        'Provides the category context that drives M3 specification content ' +
        '(inventory depth, item types, enemy/survival signals).',
      kind:        'unreal_scaffold_generate',
      requiresApproval: false,
      onFailure:   'warn_continue',
    },
    {
      id:          'unreal-milestone-plan',
      name:        'Generate Milestone Plan',
      description:
        'Groups scaffold items into ordered milestones. M4 steps (supporting systems) ' +
        'are used to populate the M3 setup guide content.',
      kind:        'unreal_milestone_plan',
      requiresApproval: false,
      onFailure:   'warn_continue',
    },
    {
      id:          'unreal-m3-execute',
      name:        'Apply M3 Project Artifacts',
      description:
        'Checks for M1 and M2 foundation presence, then writes ' +
        'M3_SupportingSystems_Setup.md, M3_InventoryConfig.json, M3_ItemData.json, ' +
        'M3_InteractionConfig.json, and M3_Manifest.json into the project\'s TriForge/ ' +
        'directory. Item types and inventory categories adapt to prototype goal and ' +
        'scaffold signals (survival, enemy, inventory).',
      kind:        'unreal_m3_execute',
      requiresApproval: false,
      onFailure:   'warn_continue',
    },
    {
      id:          'report',
      name:        'Build Execution Report',
      description:
        'Assembles the execution outcome, file list, project identity, chain integrity ' +
        'status, and warnings into a durable unreal_m3_execution_report artifact.',
      kind:        'report',
      requiresApproval: false,
      onFailure:   'warn_continue',
    },
  ],
  tags: [
    'unreal', 'unreal-engine', 'milestone', 'execute', 'm3',
    'supporting-systems', 'inventory', 'interaction', 'items',
    'project-modification', 'file-generation',
  ],
  estimatedDurationSec: 20,
  successCriteria:
    'Milestone 3 supporting-systems artifacts are written to <projectRoot>/TriForge/. ' +
    'outcome="applied" with at least 4 generated files is the success state.',
};
