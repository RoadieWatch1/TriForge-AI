// ── operator/unrealMilestonePack.ts — Unreal Milestone Workflow Pack ───────────
//
// Phase 3, Step 6: First ordered prototype roadmap workflow.
//
// Consumes the scaffold result produced by the unreal_scaffold_generate phase
// (run inline as a preceding step) and groups scaffold items into a sequenced
// set of execution milestones — Milestone 1 through N — each scoped to a
// coherent prototype increment with an explicit playable checkpoint.
//
// TRULY IMPLEMENTED:
//   - Bootstrap readiness gate (reuses evaluateUnrealBootstrapReadiness)
//   - Scaffold generation inline (reuses generateUnrealSystemScaffold)
//   - Deterministic category-affinity grouping into ordered milestones
//   - Playable build checkpoint milestone (always present)
//   - Assumption + warning propagation from scaffold layer
//   - Durable unreal_milestone_report artifact via WorkerRun
//
// NOT YET:
//   - Automatic milestone execution
//   - Blueprint / C++ file generation
//   - Editor-side milestone application
//   - Milestone completion tracking inside Unreal
//   - Unreal plugin / bridge support
//   - Cross-run scaffold artifact lookup (scaffold is always run inline)

import type { WorkflowPack }              from './workflowPackTypes';
import type { UnrealScaffoldResult, UnrealSystemScaffoldItem, UnrealScaffoldCategory } from './unrealScaffoldPack';

// ── Result types ──────────────────────────────────────────────────────────────

/**
 * Top-level outcome of milestone planning.
 *
 *   'milestones_ready'               — plan generated cleanly
 *   'milestones_ready_with_warnings' — plan generated with caveats
 *   'blocked'                        — bootstrap or scaffold prerequisite not met
 */
export type UnrealMilestoneOutcome =
  | 'milestones_ready'
  | 'milestones_ready_with_warnings'
  | 'blocked';

/** A single ordered step inside a milestone. */
export interface UnrealMilestoneStep {
  /** Scaffold item ID this step came from, if applicable. */
  itemId?: string;
  name: string;
  description: string;
}

/** A single prototype execution milestone. */
export interface UnrealMilestone {
  /** Short stable ID (e.g. "M1", "M2"). */
  id: string;
  title: string;
  /** One-sentence statement of what "done" means for this milestone. */
  goal: string;
  /** Relative ordering band. */
  priority: 'now' | 'next' | 'later';
  estimatedComplexity: 'low' | 'medium' | 'high';
  /** True if this milestone ends with a playable / build verification step. */
  buildCheckpoint: boolean;
  steps: UnrealMilestoneStep[];
}

/**
 * Structured output of the Unreal Milestone Pack.
 * Embedded in the unreal_milestone_report artifact and safe for council prompts.
 */
export interface UnrealMilestoneResult {
  outcome: UnrealMilestoneOutcome;
  prototypeGoal: string;
  projectName?: string;
  projectPath?: string;
  /** Ordered milestones — execute in sequence. */
  milestones: UnrealMilestone[];
  assumptions: string[];
  warnings: string[];
}

// ── Milestone grouping table ──────────────────────────────────────────────────

/**
 * Static affinity groups that define how scaffold categories map to milestones.
 * Ordered from foundational to advanced — always respected when items exist.
 */
interface _MilestoneGroup {
  id: string;
  title: string;
  goal: string;
  priority: UnrealMilestone['priority'];
  estimatedComplexity: UnrealMilestone['estimatedComplexity'];
  buildCheckpoint: boolean;
  /** Scaffold categories whose items belong in this milestone. */
  categories: UnrealScaffoldCategory[];
  /**
   * If true, this milestone is always included even if no scaffold items match.
   * Used for the mandatory playable checkpoint.
   */
  alwaysInclude?: boolean;
  /** Fixed steps to inject when no scaffold items match. */
  fallbackSteps?: UnrealMilestoneStep[];
}

const MILESTONE_GROUPS: _MilestoneGroup[] = [
  {
    id:                  'M1',
    title:               'Foundation: Player Control',
    goal:                'Establish game mode, player character, camera rig, and input mapping.',
    priority:            'now',
    estimatedComplexity: 'low',
    buildCheckpoint:     false,
    categories:          ['core_loop', 'player', 'camera', 'input'],
  },
  {
    id:                  'M2',
    title:               'World Slice & First Playable Gate',
    goal:                'Build the test arena and validate player locomotion end-to-end.',
    priority:            'now',
    estimatedComplexity: 'low',
    buildCheckpoint:     true,
    categories:          ['world'],
    alwaysInclude:       true,
    fallbackSteps: [
      {
        name:        'Create L_TestArena level',
        description: 'Flat test arena with directional light, NavMesh, and player start. ' +
                     'Required by all downstream systems.',
      },
      {
        name:        'Verify player locomotion',
        description: 'Confirm player character spawns, moves, and camera follows correctly.',
      },
    ],
  },
  {
    id:                  'M3',
    title:               'Primary Gameplay Loop',
    goal:                'Implement health/survival stats and HUD status display.',
    priority:            'next',
    estimatedComplexity: 'medium',
    buildCheckpoint:     false,
    categories:          ['survival', 'ui'],
  },
  {
    id:                  'M4',
    title:               'Supporting Systems',
    goal:                'Add pickup/inventory and any other supporting gameplay stubs.',
    priority:            'next',
    estimatedComplexity: 'medium',
    buildCheckpoint:     false,
    categories:          ['inventory'],
  },
  {
    id:                  'M5',
    title:               'Enemy & Challenge Loop',
    goal:                'Introduce enemy encounter, threat, and a basic fail/win condition.',
    priority:            'next',
    estimatedComplexity: 'high',
    buildCheckpoint:     false,
    categories:          ['enemy'],
  },
  {
    id:                  'M6',
    title:               'Playable Build Checkpoint',
    goal:                'Run pack.unreal-build and verify the prototype is playable end-to-end.',
    priority:            'later',
    estimatedComplexity: 'low',
    buildCheckpoint:     true,
    categories:          ['build'],
    alwaysInclude:       true,
    fallbackSteps: [
      {
        name:        'Run Unreal build verification',
        description: 'Execute pack.unreal-build. All M1–M5 systems must compile and load ' +
                     'without error before this checkpoint passes.',
      },
      {
        name:        'Smoke-test playable session',
        description: 'Enter L_TestArena, exercise all implemented systems, confirm no fatal crashes.',
      },
    ],
  },
];

// ── Pure milestone generator ──────────────────────────────────────────────────

/**
 * Convert a scaffold result into an ordered milestone plan.
 *
 * Pure function — no I/O, no side effects.
 */
export function generateUnrealMilestones(
  scaffold: UnrealScaffoldResult,
): UnrealMilestoneResult {
  const assumptions: string[] = [...scaffold.assumptions.map(a => a.message)];
  const warnings: string[]    = [...scaffold.warnings];

  // Pass through scaffold-blocked outcome
  if (scaffold.outcome === 'blocked') {
    return {
      outcome:       'blocked',
      prototypeGoal: scaffold.prototypeGoal,
      projectName:   scaffold.projectName,
      projectPath:   scaffold.projectPath,
      milestones:    [],
      assumptions,
      warnings:      [
        'Scaffold generation was blocked — milestone planning cannot proceed without a valid scaffold.',
        ...warnings,
      ],
    };
  }

  const items = scaffold.scaffoldItems;

  // Build a lookup: category → matching scaffold items
  const byCategory = new Map<UnrealScaffoldCategory, UnrealSystemScaffoldItem[]>();
  for (const item of items) {
    const bucket = byCategory.get(item.category) ?? [];
    bucket.push(item);
    byCategory.set(item.category, bucket);
  }

  const milestones: UnrealMilestone[] = [];

  for (const group of MILESTONE_GROUPS) {
    // Collect scaffold items that belong to this milestone
    const matchingItems: UnrealSystemScaffoldItem[] = [];
    for (const cat of group.categories) {
      matchingItems.push(...(byCategory.get(cat) ?? []));
    }

    if (matchingItems.length === 0 && !group.alwaysInclude) {
      continue; // Nothing to put here — skip this milestone band
    }

    const steps: UnrealMilestoneStep[] =
      matchingItems.length > 0
        ? matchingItems.map(item => ({
            itemId:      item.id,
            name:        item.name,
            description: item.description,
          }))
        : (group.fallbackSteps ?? []);

    milestones.push({
      id:                  group.id,
      title:               group.title,
      goal:                group.goal,
      priority:            group.priority,
      estimatedComplexity: group.estimatedComplexity,
      buildCheckpoint:     group.buildCheckpoint,
      steps,
    });
  }

  // ── Assumption capture ────────────────────────────────────────────────────
  if (!scaffold.projectPath) {
    assumptions.push(
      'Project path was unavailable — milestone plan is conceptually grounded ' +
      'but not anchored to a confirmed .uproject file.',
    );
  }

  const enemyItems = byCategory.get('enemy') ?? [];
  if (enemyItems.length === 0) {
    assumptions.push(
      'No enemy/combat scaffold items were detected — the Enemy & Challenge ' +
      'milestone (M5) was omitted. Add "enemy" or "combat" to the prototype ' +
      'goal if an enemy encounter is desired.',
    );
  }

  const inventoryItems = byCategory.get('inventory') ?? [];
  if (inventoryItems.length === 0) {
    assumptions.push(
      'No inventory scaffold items were detected — the Supporting Systems ' +
      'milestone (M4) was omitted.',
    );
  }

  // ── Outcome ───────────────────────────────────────────────────────────────
  const outcome: UnrealMilestoneOutcome =
    warnings.length > 0 || scaffold.outcome === 'scaffold_ready_with_warnings'
      ? 'milestones_ready_with_warnings'
      : 'milestones_ready';

  return {
    outcome,
    prototypeGoal: scaffold.prototypeGoal,
    projectName:   scaffold.projectName,
    projectPath:   scaffold.projectPath,
    milestones,
    assumptions,
    warnings,
  };
}

// ── Pack definition ───────────────────────────────────────────────────────────

/**
 * Unreal Milestone Pack.
 *
 * Converts scaffold structure into an ordered, executable milestone plan.
 *
 * Flow:
 *   1. List running apps + get frontmost (awareness context)
 *   2. Run Unreal Bootstrap gate — STOP if blocked
 *   3. Generate scaffold plan inline (same as pack.unreal-scaffold step)
 *   4. Group scaffold items into ordered milestones
 *   5. Assemble durable unreal_milestone_report artifact
 *
 * Input:  WorkflowRunOptions.prototypeGoal  — plain-language prototype goal
 * Output: UnrealMilestoneResult embedded in the unreal_milestone_report artifact
 *
 * This pack does NOT execute milestones, write Blueprints, or touch the editor.
 * It produces the ordered planning substrate for future execution packs.
 */
export const UNREAL_MILESTONE: WorkflowPack = {
  id:       'pack.unreal-milestone',
  name:     'Unreal Milestone Plan',
  tagline:  'Convert a prototype scaffold into an ordered execution milestone roadmap.',
  description:
    'Gates on the Unreal Bootstrap readiness check, generates a prototype system ' +
    'scaffold from the prototypeGoal run option, then groups scaffold items into ' +
    'sequenced execution milestones — each scoped to a coherent prototype increment ' +
    'with at least one explicit playable build checkpoint. ' +
    'Returns an ordered UnrealMilestoneResult with structured steps, complexity ' +
    'estimates, honest assumptions, and propagated warnings. ' +
    'Emits a durable unreal_milestone_report artifact for Sessions and future packs. ' +
    'Provide the goal via the prototypeGoal run option. ' +
    'This pack plans only — it does not execute milestones or write editor assets.',
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
        'If blocked, the milestone pack stops — a plan not grounded in a ' +
        'real running project would be misleading.',
      kind:        'unreal_bootstrap_check',
      requiresApproval: false,
      onFailure:   'stop',
    },
    {
      id:          'unreal-scaffold-generate',
      name:        'Generate System Scaffold',
      description:
        'Generates the prototype system scaffold from the prototypeGoal option. ' +
        'The scaffold result is used as the substrate for milestone grouping.',
      kind:        'unreal_scaffold_generate',
      requiresApproval: false,
      onFailure:   'warn_continue',
    },
    {
      id:          'unreal-milestone-plan',
      name:        'Generate Milestone Plan',
      description:
        'Groups scaffold items into sequenced execution milestones using ' +
        'category-affinity ordering. Records assumptions and propagates warnings.',
      kind:        'unreal_milestone_plan',
      requiresApproval: false,
      onFailure:   'warn_continue',
    },
    {
      id:          'report',
      name:        'Build Milestone Report',
      description: 'Assembles the milestone plan, project identity, and goal into a durable artifact.',
      kind:        'report',
      requiresApproval: false,
      onFailure:   'warn_continue',
    },
  ],
  tags: [
    'unreal', 'unreal-engine', 'milestone', 'planning', 'roadmap',
    'prototype', 'execution-order', 'build-checkpoint',
  ],
  estimatedDurationSec: 15,
  successCriteria:
    'An ordered milestone plan is returned tied to the prototype goal and active Unreal project. ' +
    'Success even when warnings are present — the honest, ordered plan IS the deliverable.',
};
