// ── operator/unrealScaffoldPack.ts — Unreal System Scaffold Workflow Pack ──────
//
// Phase 3, Step 5: First prototype structure planning workflow.
//
// This pack turns a user's plain-language prototype goal into a structured,
// project-grounded system scaffold plan. It gates on the existing bootstrap
// readiness evaluator and produces a durable unreal_scaffold_report artifact.
//
// TRULY IMPLEMENTED:
//   - Bootstrap readiness gate (reuses evaluateUnrealBootstrapReadiness)
//   - Prototype goal parsing from WorkflowRunOptions.prototypeGoal
//   - Heuristic-based scaffold item generation (genre/mode keyword detection)
//   - Assumption tracking (all inferred details are explicit)
//   - Warning surfacing (underspecified input, editor warnings)
//   - Durable unreal_scaffold_report artifact via WorkerRun
//
// NOT YET:
//   - Blueprint / C++ file generation
//   - Editor-side scaffold application
//   - Milestone slicing from scaffold items
//   - Unreal plugin / remote-control bridge
//   - Semantic editor project inspection

import type { WorkflowPack } from './workflowPackTypes';

// ── Result types ──────────────────────────────────────────────────────────────

/**
 * Top-level outcome of the scaffold generation.
 *
 *   'scaffold_ready'               — plan generated cleanly
 *   'scaffold_ready_with_warnings' — plan generated but has caveats
 *   'blocked'                      — bootstrap or project context prevents planning
 */
export type UnrealScaffoldOutcome =
  | 'scaffold_ready'
  | 'scaffold_ready_with_warnings'
  | 'blocked';

/**
 * Category of a scaffold work item.
 * Guides implementation order and tooling choices.
 */
export type UnrealScaffoldCategory =
  | 'core_loop'   // core gameplay loop definition / game mode
  | 'player'      // player character, controller, movement
  | 'camera'      // camera rig, spring arm, follow behaviour
  | 'input'       // input mapping, enhanced input actions
  | 'enemy'       // enemy AI, behaviour tree stub
  | 'survival'    // survival stats (health, stamina, hunger…)
  | 'inventory'   // item pickup, inventory data, UI stub
  | 'ui'          // HUD, widget definitions, screen flow
  | 'world'       // test level, lighting, navigation mesh
  | 'build';      // playable build checkpoint, packaging gate

/** Priority rank for a scaffold item. */
export type UnrealScaffoldPriority = 'now' | 'next' | 'later';

/** A single work item in the scaffold plan. */
export interface UnrealSystemScaffoldItem {
  /** Short stable identifier (e.g. "player-controller"). */
  id: string;
  name: string;
  category: UnrealScaffoldCategory;
  priority: UnrealScaffoldPriority;
  /** One or two sentences of execution-oriented description. */
  description: string;
}

/** An assumption the pack made because it was not explicitly supplied. */
export interface UnrealScaffoldAssumption {
  message: string;
}

/**
 * Structured output of the Unreal System Scaffold Pack.
 * Embedded in the unreal_scaffold_report artifact and safe for council prompts.
 */
export interface UnrealScaffoldResult {
  /** Overall scaffold outcome. */
  outcome: UnrealScaffoldOutcome;
  /** Detected project name from the awareness snapshot (if available). */
  projectName?: string;
  /** Confirmed .uproject path (high-confidence only). */
  projectPath?: string;
  /** The prototype goal that drove scaffold generation. */
  prototypeGoal: string;
  /** Ordered scaffold items — 'now' items first, then 'next', then 'later'. */
  scaffoldItems: UnrealSystemScaffoldItem[];
  /** Every assumption the generator made; user should review these. */
  assumptions: UnrealScaffoldAssumption[];
  /** Non-blocking warnings (e.g. from bootstrap context, underspecified input). */
  warnings: string[];
}

// ── Scaffold generator ────────────────────────────────────────────────────────

/** Keywords → categories + extra items. */
interface _GenreHint {
  keywords: string[];
  items: Array<Omit<UnrealSystemScaffoldItem, 'priority'>>;
  assumptions?: string[];
}

const GENRE_HINTS: _GenreHint[] = [
  {
    keywords: ['survival', 'survive', 'hunger', 'thirst', 'temperature', 'permadeath'],
    items: [
      {
        id: 'survival-stats',
        name: 'Survival Stat Loop',
        category: 'survival',
        description:
          'Define core survival stats (health, stamina, hunger, thirst) as a ' +
          'UDataAsset or component. Wire decay timers and death condition.',
      },
      {
        id: 'resource-pickup',
        name: 'Resource Pickup Stub',
        category: 'inventory',
        description:
          'Basic interactable resource actors (food, materials) that add to a ' +
          'simple inventory array. No full crafting yet — just pickup + store.',
      },
    ],
    assumptions: ['Survival loop uses health + stamina as the minimum viable stat set.'],
  },
  {
    keywords: ['inventory', 'crafting', 'loot', 'items', 'equipment'],
    items: [
      {
        id: 'inventory-component',
        name: 'Inventory Component',
        category: 'inventory',
        description:
          'Actor component holding an array of FItemData structs. Expose add/remove/query. ' +
          'No UI yet — that comes separately.',
      },
      {
        id: 'inventory-ui',
        name: 'Inventory HUD Widget',
        category: 'ui',
        description:
          'Simple WBP_Inventory widget that lists held items. Toggle via I-key binding. ' +
          'Minimal styling — placeholder only.',
      },
    ],
  },
  {
    keywords: ['enemy', 'enemies', 'combat', 'npc', 'ai', 'encounter', 'monster', 'hostile'],
    items: [
      {
        id: 'enemy-base',
        name: 'Enemy Base Character',
        category: 'enemy',
        description:
          'BP_EnemyBase with a behaviour tree stub: idle → detect player → chase. ' +
          'Simple melee hit. Enough for encounter testing without full AI.',
      },
    ],
  },
  {
    keywords: ['multiplayer', 'co-op', 'coop', 'network', 'online'],
    items: [],
    assumptions: [
      'Multiplayer was mentioned but is OUT OF SCOPE for this scaffold. ' +
      'Single-player prototype only. Networking requires a separate milestone.',
    ],
  },
];

/** Camera/player mode detection. */
function detectCameraMode(goal: string): {
  cameraMode: 'third_person' | 'first_person' | 'top_down' | 'unknown';
  assumption?: string;
} {
  const lower = goal.toLowerCase();
  if (/\bthird.person\b|\b3rd.person\b|\btpp\b/.test(lower)) {
    return { cameraMode: 'third_person' };
  }
  if (/\bfirst.person\b|\b1st.person\b|\bfps\b/.test(lower)) {
    return { cameraMode: 'first_person' };
  }
  if (/\btop.down\b|\bisometric\b|\bbird.?s.eye\b/.test(lower)) {
    return { cameraMode: 'top_down' };
  }
  return {
    cameraMode: 'unknown',
    assumption: 'Camera mode was not specified — defaulting to third-person as the most common prototype mode.',
  };
}

/**
 * Pure scaffold generator.
 *
 * Takes a prototype goal string and optional project context, returns a
 * structured UnrealScaffoldResult.
 *
 * No I/O, no side effects — safe to call from any layer.
 */
export function generateUnrealSystemScaffold(
  prototypeGoal: string,
  projectContext?: { projectName?: string; projectPath?: string; bootstrapWarnings?: string[]; webResearchContext?: string },
): UnrealScaffoldResult {
  const assumptions: UnrealScaffoldAssumption[] = [];
  const warnings: string[] = [...(projectContext?.bootstrapWarnings ?? [])];

  // If web research context was provided, record it as a high-value assumption
  // so every downstream pack (milestones, M1–M5) inherits this knowledge
  if (projectContext?.webResearchContext) {
    assumptions.push({
      message: `Web research summary: ${projectContext.webResearchContext}`,
    });
  }

  const goal = prototypeGoal.trim();
  if (!goal) {
    return {
      outcome:       'blocked',
      projectName:   projectContext?.projectName,
      projectPath:   projectContext?.projectPath,
      prototypeGoal: '(none provided)',
      scaffoldItems: [],
      assumptions:   [],
      warnings:      ['No prototype goal was supplied. Provide a plain-language description of what you want to build.'],
    };
  }

  // ── Camera / player mode ──────────────────────────────────────────────────
  const { cameraMode, assumption: cameraAssumption } = detectCameraMode(goal);
  if (cameraAssumption) {
    assumptions.push({ message: cameraAssumption });
  }

  // ── Underspecified goal detection ─────────────────────────────────────────
  const wordCount = goal.split(/\s+/).length;
  if (wordCount < 4) {
    warnings.push(
      `The prototype goal is very short ("${goal}"). ` +
      'The scaffold is generated from reasonable defaults — review assumptions carefully.',
    );
  }

  // ── Base scaffold items (always present) ──────────────────────────────────
  const baseItems: UnrealSystemScaffoldItem[] = [
    {
      id:          'core-game-mode',
      name:        'Core Game Mode',
      category:    'core_loop',
      priority:    'now',
      description: 'Define BP_GameMode and BP_GameState stubs. Set the default player controller. ' +
                   'Establishes the skeleton every other system attaches to.',
    },
    {
      id:          'player-character',
      name:        'Player Character',
      category:    'player',
      priority:    'now',
      description: 'BP_PlayerCharacter with movement component defaults tuned for the prototype ' +
                   `(${cameraMode === 'unknown' ? 'third-person' : cameraMode.replace('_', '-')}). ` +
                   'Walking, jumping, and basic collision are the minimum.',
    },
    {
      id:          'camera-setup',
      name:        cameraMode === 'first_person'
                     ? 'First-Person Camera'
                     : cameraMode === 'top_down'
                     ? 'Top-Down Camera Rig'
                     : 'Third-Person Spring Arm Camera',
      category:    'camera',
      priority:    'now',
      description: cameraMode === 'first_person'
                     ? 'Camera component attached to the head socket. Hide the mesh in first-person view.'
                     : cameraMode === 'top_down'
                     ? 'Fixed isometric camera with optional edge-scroll. Disable character rotation from camera.'
                     : 'USpringArmComponent (300 cm boom) + UCameraComponent. Enable lag for smooth follow.',
    },
    {
      id:          'input-mapping',
      name:        'Enhanced Input Mapping',
      category:    'input',
      priority:    'now',
      description: 'Create IMC_Default with IA_Move, IA_Look, IA_Jump, IA_Interact. ' +
                   'Bind in PlayerController. Required by all gameplay actions.',
    },
    {
      id:          'test-arena',
      name:        'Test Arena Level',
      category:    'world',
      priority:    'now',
      description: 'L_TestArena: flat 100m × 100m modular mesh floor, basic directional light, ' +
                   'NavMesh volume, player start. Used to iterate on all systems before a real world.',
    },
    {
      id:          'health-component',
      name:        'Health Component',
      category:    'survival',
      priority:    'next',
      description: 'BP_HealthComponent with MaxHealth, CurrentHealth, TakeDamage(), Die(). ' +
                   'Base for all damage and death logic regardless of genre.',
    },
    {
      id:          'hud-status',
      name:        'HUD Status Display',
      category:    'ui',
      priority:    'next',
      description: 'WBP_HUD showing health bar (and survival stats if applicable). ' +
                   'Minimal — no styling required yet, just functional readout.',
    },
    {
      id:          'playable-build-checkpoint',
      name:        'Playable Build Checkpoint',
      category:    'build',
      priority:    'later',
      description: 'Milestone gate: player can enter L_TestArena, move, interact, not crash. ' +
                   'Run pack.unreal-build to confirm. Gate for the next scaffold iteration.',
    },
  ];

  // ── Genre / keyword-driven extra items ───────────────────────────────────
  const extraItems: UnrealSystemScaffoldItem[] = [];

  for (const hint of GENRE_HINTS) {
    const lower = goal.toLowerCase();
    const matched = hint.keywords.some(kw => lower.includes(kw));
    if (!matched) continue;

    for (const item of hint.items) {
      // Don't add duplicate IDs
      if (!baseItems.some(b => b.id === item.id) && !extraItems.some(e => e.id === item.id)) {
        extraItems.push({ ...item, priority: 'next' });
      }
    }
    for (const asm of hint.assumptions ?? []) {
      assumptions.push({ message: asm });
    }
  }

  // ── Merge and sort (now → next → later) ──────────────────────────────────
  const priorityOrder: Record<UnrealScaffoldPriority, number> = { now: 0, next: 1, later: 2 };
  const allItems = [...baseItems, ...extraItems].sort(
    (a, b) => priorityOrder[a.priority] - priorityOrder[b.priority],
  );

  // ── Outcome ───────────────────────────────────────────────────────────────
  const outcome: UnrealScaffoldOutcome =
    warnings.length > 0 ? 'scaffold_ready_with_warnings' : 'scaffold_ready';

  return {
    outcome,
    projectName:   projectContext?.projectName,
    projectPath:   projectContext?.projectPath,
    prototypeGoal: goal,
    scaffoldItems: allItems,
    assumptions,
    warnings,
  };
}

// ── AI-driven scaffold generator ─────────────────────────────────────────────
//
// Calls Claude Haiku to intelligently plan the game systems needed for ANY goal.
// Falls back to the heuristic generator if the API key is missing or the call fails.
// This closes the gap where keyword detection missed unusual games or creative descriptions.

import https from 'https';

export async function generateUnrealSystemScaffoldWithAI(
  prototypeGoal: string,
  projectContext?: { projectName?: string; projectPath?: string; bootstrapWarnings?: string[]; webResearchContext?: string },
  claudeApiKey?: string,
): Promise<UnrealScaffoldResult> {
  const key = claudeApiKey ?? (typeof process !== 'undefined' ? process.env.ANTHROPIC_API_KEY : undefined);

  // No key — fall back immediately to heuristic
  if (!key) {
    return generateUnrealSystemScaffold(prototypeGoal, projectContext);
  }

  const webCtx = projectContext?.webResearchContext
    ? `\n\nWeb research context (use this to inform your decisions):\n${projectContext.webResearchContext}`
    : '';

  const prompt = [
    `You are an Unreal Engine 5 game architect. A developer wants to build this game prototype:`,
    `"${prototypeGoal}"`,
    webCtx,
    ``,
    `List exactly the Blueprint systems and components needed. For each item output ONE line:`,
    `ID | NAME | CATEGORY | PRIORITY | DESCRIPTION`,
    ``,
    `Rules:`,
    `- ID: lowercase-hyphenated, unique (e.g. "player-character")`,
    `- NAME: short label (e.g. "Player Character")`,
    `- CATEGORY: one of: core_loop, player, camera, input, enemy, survival, inventory, ui, world, build`,
    `- PRIORITY: now (MVP), next (important), or later (nice-to-have)`,
    `- DESCRIPTION: one sentence, Unreal-specific (mention Blueprint class names like BP_PlayerCharacter)`,
    ``,
    `Output ONLY the pipe-delimited lines, no headers, no markdown, no extra text.`,
    `Include 6-12 items. Always include: core game mode (core_loop), player character (player), camera (camera).`,
  ].join('\n');

  const body = JSON.stringify({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 1024,
    messages:   [{ role: 'user', content: prompt }],
  });

  try {
    const raw = await new Promise<string>((resolve, reject) => {
      const req = https.request({
        hostname: 'api.anthropic.com',
        path:     '/v1/messages',
        method:   'POST',
        headers: {
          'Content-Type':      'application/json',
          'Content-Length':    Buffer.byteLength(body),
          'x-api-key':         key,
          'anthropic-version': '2023-06-01',
        },
      }, res => {
        let data = '';
        res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
        res.on('end', () => resolve(data));
      });
      req.on('error', reject);
      req.setTimeout(15_000, () => { req.destroy(); reject(new Error('timeout')); });
      req.write(body);
      req.end();
    });

    const parsed = JSON.parse(raw) as { content?: Array<{ type: string; text?: string }> };
    const text = parsed.content?.find(c => c.type === 'text')?.text?.trim() ?? '';

    if (!text) throw new Error('empty response');

    // Parse pipe-delimited lines into scaffold items
    const items: UnrealSystemScaffoldItem[] = [];
    for (const line of text.split('\n')) {
      const parts = line.split('|').map(p => p.trim());
      if (parts.length < 5) continue;
      const [id, name, categoryRaw, priorityRaw, description] = parts;
      const validCategories: UnrealScaffoldCategory[] = ['core_loop','player','camera','input','enemy','survival','inventory','ui','world','build'];
      const validPriorities: UnrealScaffoldPriority[] = ['now','next','later'];
      const category = validCategories.includes(categoryRaw as UnrealScaffoldCategory)
        ? (categoryRaw as UnrealScaffoldCategory) : 'core_loop';
      const priority = validPriorities.includes(priorityRaw as UnrealScaffoldPriority)
        ? (priorityRaw as UnrealScaffoldPriority) : 'now';
      if (id && name && description) {
        items.push({ id, name, category, priority, description });
      }
    }

    if (items.length < 3) throw new Error('too few items parsed');

    // Sort: now → next → later
    items.sort((a, b) => {
      const rank: Record<UnrealScaffoldPriority, number> = { now: 0, next: 1, later: 2 };
      return rank[a.priority] - rank[b.priority];
    });

    const assumptions: UnrealScaffoldAssumption[] = [
      { message: 'Scaffold generated by Claude AI based on the prototype goal and web research.' },
    ];
    if (projectContext?.webResearchContext) {
      assumptions.push({ message: `Web research was used to inform game system selection.` });
    }

    return {
      outcome:       items.length > 0 ? 'scaffold_ready' : 'blocked',
      projectName:   projectContext?.projectName,
      projectPath:   projectContext?.projectPath,
      prototypeGoal: prototypeGoal.trim(),
      scaffoldItems: items,
      assumptions,
      warnings:      projectContext?.bootstrapWarnings ?? [],
    };

  } catch {
    // AI call failed — fall back to heuristic so the user always gets a result
    return generateUnrealSystemScaffold(prototypeGoal, projectContext);
  }
}

// ── Pack definition ───────────────────────────────────────────────────────────

/**
 * Unreal System Scaffold Pack.
 *
 * Turns a user prototype goal into a structured, project-grounded scaffold plan.
 *
 * Flow:
 *   1. List running apps + get frontmost (for awareness context)
 *   2. Run Unreal Bootstrap gate — STOP if blocked
 *   3. Generate scaffold plan from the prototype goal (pure, deterministic)
 *   4. Assemble durable unreal_scaffold_report artifact
 *
 * Input:  WorkflowRunOptions.prototypeGoal  — plain-language prototype goal
 * Output: UnrealScaffoldResult embedded in the unreal_scaffold_report artifact
 *
 * This pack does NOT create Blueprints, C++ files, or editor assets.
 * It produces the structured planning substrate for later execution packs.
 */
export const UNREAL_SYSTEM_SCAFFOLD: WorkflowPack = {
  id:       'pack.unreal-scaffold',
  name:     'Unreal System Scaffold',
  tagline:  'Turn a prototype goal into a grounded Unreal system scaffold plan.',
  description:
    'Gates on the Unreal Bootstrap readiness check, then converts a plain-language ' +
    'prototype goal (e.g. "third-person sci-fi survival") into a structured, ' +
    'prioritised system scaffold plan tied to the active Unreal project. ' +
    'Returns an ordered list of scaffold items (player, camera, input, survival, ' +
    'enemy, UI, world, build checkpoint), tracks all assumptions and warnings, ' +
    'and emits a durable unreal_scaffold_report artifact for Sessions and future packs. ' +
    'Provide the goal via the prototypeGoal run option. ' +
    'This pack plans only — it does not create Blueprints or write editor assets.',
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
        'If readiness is blocked, the scaffold pack stops — a plan grounded in ' +
        'an unavailable or unidentified project would be misleading.',
      kind:        'unreal_bootstrap_check',
      requiresApproval: false,
      onFailure:   'stop',   // Blocked bootstrap → no scaffold; be honest
    },
    {
      id:          'unreal-scaffold-generate',
      name:        'Generate System Scaffold',
      description:
        'Reads the prototype goal from run options, applies heuristic scaffold ' +
        'generation, and produces a structured prioritised system scaffold result. ' +
        'Records all assumptions and warnings. Pure — no I/O or operator actions.',
      kind:        'unreal_scaffold_generate',
      requiresApproval: false,
      onFailure:   'warn_continue',  // Always produce a report
    },
    {
      id:          'report',
      name:        'Build Scaffold Report',
      description: 'Assembles the scaffold result, project identity, and goal into a durable artifact.',
      kind:        'report',
      requiresApproval: false,
      onFailure:   'warn_continue',
    },
  ],
  tags: [
    'unreal', 'unreal-engine', 'scaffold', 'prototype', 'planning',
    'game-design', 'system-design', 'first-structure',
  ],
  estimatedDurationSec: 12,
  successCriteria:
    'A structured scaffold plan is returned tied to the active Unreal project. ' +
    'Success even when warnings are present — the honest, grounded plan IS the deliverable.',
};
