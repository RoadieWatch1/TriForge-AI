// ── codeConstitution.ts — Architectural rulebook for AI agents ────────────────
//
// The canonical human-readable source is CODE_CONSTITUTION.md at the package root.
// This file exports the same content as an importable TypeScript constant so that
// MissionController and other planners can inject it into prompts without any
// filesystem path resolution at runtime (which is fragile across dev/prod/packaged Electron).
//
// When you update CODE_CONSTITUTION.md, keep this string in sync.
// The condensed version below strips markdown formatting to reduce token overhead.

export const CODE_CONSTITUTION = `TRIFORGE CODE CONSTITUTION
===========================

READ THIS BEFORE GENERATING ANY CODE PATCH.
Violating these rules degrades the system.

── 1. LAYER ARCHITECTURE ──────────────────────────────────────────────────────

Four strictly ordered layers. No layer may bypass another.

  1. UI Layer          → renderer/          — React components, no AI calls
  2. Command Layer     → core/commands/     — phrase routing and dispatch
  3. Engineering Layer → core/engineering/  — mission orchestration
  4. Experimentation   → core/experiments/  — sandbox, evolve, verify

LAWS:
• UI never calls AI providers directly.
• UI never imports from core/experiments/ or core/engineering/.
• All inter-layer comms: IPC (renderer→main) or EventEmitter (within main).

── 2. IPC BOUNDARY ────────────────────────────────────────────────────────────

LAWS:
• All renderer→main: ipcMain.handle in main/ipc.ts only.
• All main→renderer: BrowserWindow.webContents.send() only.
• Never use ipcRenderer directly — use preload/index.ts contextBridge surface.
• main/ipc.ts and preload/index.ts are SACRED — no autonomous modification.
• New channels must be declared in both ipc.ts and preload/index.ts.

── 3. COUNCIL ARCHITECTURE ────────────────────────────────────────────────────

LAWS:
• Never instantiate OpenAIProvider, ClaudeProvider, or GrokProvider directly.
• All AI calls go through ProviderManager → ThinkTankPlanner or getActiveProviders().
• Provider calls MUST run in parallel: Promise.allSettled(). Never sequential.
• Use withTimeout() when calling providers outside ThinkTankPlanner.
• Planning pipeline order: ContextBuilder → CouncilMemoryGraph → ProblemFramingEngine → ThinkTankPlanner.

── 4. ENGINEERING SAFETY ──────────────────────────────────────────────────────

LAWS:
• Direct workspace file writes from autonomous processes are forbidden.
• All changes: ExperimentEngine (sandbox) → VerificationRunner → user approval.
• ApprovalStore gates all file mutations. Never bypass.
• AgentLoop executes tasks. No ad hoc shell commands.
• Every step must have a rollback defined before execution.

── 5. SACRED INFRASTRUCTURE ───────────────────────────────────────────────────

Do NOT modify these files unless enableSelfImprovement=true AND canary sandbox passes:

  core/engineering/MissionController.ts
  core/experiments/ExperimentEngine.ts
  core/experiments/EvolutionEngine.ts
  core/experiments/VerificationRunner.ts
  core/commands/CommandDispatcher.ts
  core/orchestrator/CouncilDecisionBus.ts
  core/config/autonomyFlags.ts
  core/config/sacredFiles.ts
  renderer/voice/VoskWakeEngine.ts
  renderer/voice/VoiceCommandBridge.ts
  main/ipc.ts
  preload/index.ts
  CODE_CONSTITUTION.md
  SYSTEM_MAP.ts

── 6. MEMORY ARCHITECTURE ─────────────────────────────────────────────────────

Two memory systems. Do NOT merge them.

  Council Memory   → engine/src/memory/councilMemoryGraph.ts
                     Purpose: project decisions, strategies, insights
                     Storage: session-based via StorageAdapter

  Engineering Memory → core/memory/CouncilMemoryGraph.ts
                       Purpose: bugfixes, experiments, architecture decisions
                       Storage: file-persisted in .triforge-memory/

LAWS:
• Engineering data (patch results, scores) stays in Engineering Memory.
• Conversation knowledge (decisions, strategies) stays in Council Memory.
• Engineering Memory writes are atomic (tmp → rename). Never write directly.
• 200-entry cap per bucket. Oldest pruned when exceeded.

── 7. CONTEXT HANDLING ────────────────────────────────────────────────────────

LAWS:
• All prompts use ContextBuilder. Raw file dumps are forbidden.
• Max injected context: 8000 chars (ContextBuilder) + 3000 chars (CouncilMemoryGraph).
• Secrets must never appear in context. CouncilMemoryGraph._sanitize() handles this.
• Prompt injection order:
    1. [COUNCIL MEMORY] block
    2. WORKSPACE CONTEXT block
    3. --- PROBLEM ANALYSIS --- block
    4. Planning instruction

── 8. EXPERIMENT POLICY ───────────────────────────────────────────────────────

Pipeline (never skip steps):
  1. Generate 3 candidates   (ThinkTankPlanner)
  2. Sandbox experiment      (ExperimentEngine — tmpdir copy, apply, verify)
  3. Verify                  (VerificationRunner — lint + build + test)
  4. Evolve up to 3 gens     (EvolutionEngine, optional)
  5. Present to user         (MissionController emits plan_ready)
  6. Execute with approval   (AgentLoop + ApprovalStore)
  7. Post-verify + rollback  (score 0 → rollback)

LAWS:
• Never skip the sandbox for autonomous patches.
• Never commit to git without second explicit user approval.
• Clean up experiment sandboxes after every run.

── 9. PARALLEL EXECUTION ──────────────────────────────────────────────────────

LAWS:
• Provider calls: always Promise.allSettled(). Never sequential await.
• Context prep: Promise.all([ContextBuilder, CouncilMemoryGraph]).
• Problem framing: after context prep, before planning.
• Evolution generations: sequential by design (each depends on previous winner).

── 10. AUTONOMY LIMITS ────────────────────────────────────────────────────────

LAWS:
• enableAutonomyLoop = false (default). No self-initiated missions without this flag.
• enableSelfImprovement = false (default). Sacred files protected without this flag.
• No feature flag may be flipped by an autonomous process.
• All new features must be gated in core/config/autonomyFlags.ts.

── 11. FILE PLACEMENT ─────────────────────────────────────────────────────────

LAWS:
• New core systems: packages/desktop/src/core/<subsystem>/
• New renderer components: packages/desktop/src/renderer/components/
• Check SYSTEM_MAP.ts before adding any new subsystem.
• Do not create duplicate systems.

END CONSTITUTION`;
