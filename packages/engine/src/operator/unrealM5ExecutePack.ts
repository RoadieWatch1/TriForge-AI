// ── operator/unrealM5ExecutePack.ts — Unreal Milestone 5 Execution Pack ────────
//
// Phase 4, Step 6: Fifth real project-modification workflow.
//
// Continues the M1→M2→M3→M4 file-generation chain into the progression/save layer —
// the system that makes the prototype's enemy loop persistent and replayable.
//
// Execution mode: project-side file generation (same as M1/M2/M3/M4)
//   - TriForge/M5_Progression_Setup.md      — human-readable M5 implementation guide
//   - TriForge/M5_SaveGameConfig.json        — save game spec (what/when/how to save)
//   - TriForge/M5_ProgressionConfig.json     — unlock/level/XP progression spec
//   - TriForge/M5_CheckpointConfig.json      — checkpoint placement and respawn config
//   - TriForge/M5_Manifest.json              — machine-readable manifest with M4 dependency
//
// TRULY IMPLEMENTED:
//   - Bootstrap readiness gate
//   - High-confidence project path gate
//   - Scaffold/milestone inline generation (reused from M1–M4 pattern)
//   - M1 + M2 + M3 + M4 manifest presence check (warns if absent, does not block)
//   - Scaffold-driven content adaptation (survival/enemy/inventory signals)
//   - Durable unreal_m5_execution_report artifact via WorkerRun
//
// NOT YET:
//   - Save game Blueprint generation inside Unreal Editor
//   - Asset mutation or RC-based automation
//   - Milestone 6+ execution

import type { WorkflowPack } from './workflowPackTypes';

// ── Result types ──────────────────────────────────────────────────────────────

export type UnrealM5ExecutionOutcome =
  | 'applied'
  | 'applied_with_warnings'
  | 'partially_applied'
  | 'blocked'
  | 'failed';

export interface UnrealM5ExecutionAction {
  name: string;
  kind: 'file_generated' | 'config_written' | 'spec_created' | 'manifest_written';
  status: 'done' | 'skipped' | 'failed';
  relativePath?: string;
  detail: string;
}

export interface UnrealM5ExecutionResult {
  outcome: UnrealM5ExecutionOutcome;
  projectName?: string;
  projectPath?: string;
  triforgeDir?: string;
  m1FoundationPresent: boolean;
  m2FoundationPresent: boolean;
  m3FoundationPresent: boolean;
  m4FoundationPresent: boolean;
  actions: UnrealM5ExecutionAction[];
  warnings: string[];
  blockers: string[];
}

// ── Pack definition ───────────────────────────────────────────────────────────

export const UNREAL_M5_EXECUTE: WorkflowPack = {
  id:       'pack.unreal-m5-execute',
  name:     'Unreal M5 Execute',
  tagline:  'Apply Milestone 5 progression/save-system artifacts to the Unreal project.',
  description:
    'Continues the M1→M2→M3→M4 project-side file generation chain into the progression ' +
    'and save-system layer — the system that makes the enemy loop persistent and replayable. ' +
    'Gates on Bootstrap readiness and a high-confidence project path, generates scaffold and ' +
    'milestone context inline, then checks for M1–M4 manifest presence (warns if absent, ' +
    'does not block). Writes M5 artifacts into the project\'s TriForge/ directory: a ' +
    'progression setup guide (Markdown), a save game spec (JSON), a progression/unlock ' +
    'config (JSON), and a checkpoint/respawn config (JSON). Save data fields and unlock ' +
    'tracks adapt to scaffold signals (survival → resource tracking; enemy → kill counts, ' +
    'score; inventory → carried items). ' +
    'Execution mode: project-side file generation only — no Blueprints or editor assets created.',
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
        'Drives what save data fields, progression tracks, and checkpoint behavior ' +
        'are relevant for this prototype.',
      kind:        'unreal_scaffold_generate',
      requiresApproval: false,
      onFailure:   'warn_continue',
    },
    {
      id:          'unreal-milestone-plan',
      name:        'Generate Milestone Plan',
      description:
        'Groups scaffold items into ordered milestones. M6 steps are used to ' +
        'populate the M5 setup guide content.',
      kind:        'unreal_milestone_plan',
      requiresApproval: false,
      onFailure:   'warn_continue',
    },
    {
      id:          'unreal-m5-execute',
      name:        'Apply M5 Project Artifacts',
      description:
        'Checks for M1–M4 foundation presence, then writes M5_Progression_Setup.md, ' +
        'M5_SaveGameConfig.json, M5_ProgressionConfig.json, M5_CheckpointConfig.json, ' +
        'and M5_Manifest.json into the project\'s TriForge/ directory.',
      kind:        'unreal_m5_execute',
      requiresApproval: false,
      onFailure:   'warn_continue',
    },
    {
      id:          'report',
      name:        'Build Execution Report',
      description:
        'Assembles the execution outcome, file list, project identity, chain integrity ' +
        'status, and warnings into a durable unreal_m5_execution_report artifact.',
      kind:        'report',
      requiresApproval: false,
      onFailure:   'warn_continue',
    },
  ],
  tags: [
    'unreal', 'unreal-engine', 'milestone', 'execute', 'm5',
    'progression', 'save', 'checkpoint', 'unlocks',
    'project-modification', 'file-generation',
  ],
  estimatedDurationSec: 20,
  successCriteria:
    'Milestone 5 progression/save artifacts are written to <projectRoot>/TriForge/. ' +
    'outcome="applied" with at least 4 generated files is the success state.',
};
