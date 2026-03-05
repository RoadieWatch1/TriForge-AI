# TriForge AI — Code Constitution

> This document is the permanent architectural rulebook for every AI agent that modifies TriForge.
> Read it before generating any code patch. Violating these laws degrades the system.

---

## 1. Layer Architecture

TriForge has four strictly ordered layers. No layer may bypass another.

```
┌─────────────────────────────┐
│  1. UI Layer                │  renderer/ — React components, no AI calls
├─────────────────────────────┤
│  2. Command Layer           │  core/commands/ — phrase routing and dispatch
├─────────────────────────────┤
│  3. Engineering Layer       │  core/engineering/ — mission orchestration
├─────────────────────────────┤
│  4. Experimentation Layer   │  core/experiments/ — sandbox, evolve, verify
└─────────────────────────────┘
```

**Laws:**
- The UI layer must never call AI providers directly.
- The UI layer must never import from `core/experiments/` or `core/engineering/`.
- All inter-layer communication goes through IPC (renderer→main) or EventEmitter events (within main).
- Engineering layer must always produce a plan before the experimentation layer runs.

---

## 2. IPC Boundary

All renderer→main communication is gated through `main/ipc.ts`.
All main→renderer push events use `BrowserWindow.webContents.send()`.

**Laws:**
- Do not add direct Electron imports to renderer files.
- Do not call `ipcRenderer` directly — use the `preload/index.ts` contextBridge surface.
- `main/ipc.ts` and `preload/index.ts` are **sacred** — do not modify without explicit approval.
- New IPC channels must be declared in both `ipc.ts` (handler) and `preload/index.ts` (bridge).

---

## 3. Council Architecture

All AI reasoning flows through the council system in `packages/engine/`.

**Laws:**
- Modules must never instantiate AI provider classes (OpenAIProvider, ClaudeProvider, GrokProvider) directly.
- All AI calls go through `ProviderManager` → `ThinkTankPlanner` or `ProviderManager.getActiveProviders()`.
- Provider calls must run in parallel using `Promise.allSettled()`. Sequential execution is prohibited.
- The `withTimeout()` wrapper must be used when calling providers outside of `ThinkTankPlanner`.
- Council reasoning pipeline order: ContextBuilder → CouncilMemoryGraph → ProblemFramingEngine → ThinkTankPlanner.

---

## 4. Engineering Safety

Every code modification must pass through the full engineering pipeline.

**Laws:**
- Direct file writes to the workspace are forbidden from any autonomous process.
- All changes must go through: `ExperimentEngine` (sandbox) → `VerificationRunner` → user approval.
- `ApprovalStore` gates all file mutations. Never bypass it.
- `AgentLoop` must be used for task execution. Do not execute shell commands ad hoc.
- Rollback must be defined for every step before that step is applied.

---

## 5. Sacred Infrastructure

The following files form the execution, safety, and trust backbone of TriForge.
They must **not** be modified by autonomous experiments unless `enableSelfImprovement = true`
AND the patch passes a full canary sandbox run (build + lint + test).

```
core/engineering/MissionController.ts         — mission lifecycle
core/experiments/ExperimentEngine.ts          — sandbox runner
core/experiments/EvolutionEngine.ts           — multi-generation evolution
core/experiments/VerificationRunner.ts        — build/lint/test verification
core/commands/CommandDispatcher.ts            — command trust boundary
core/orchestrator/CouncilDecisionBus.ts       — consensus event bus
core/config/autonomyFlags.ts                  — feature flag registry
core/config/sacredFiles.ts                    — this list (self-protecting)
renderer/voice/VoskWakeEngine.ts              — voice trust boundary
renderer/voice/VoiceCommandBridge.ts          — voice IPC adapter
main/ipc.ts                                   — all IPC handlers
preload/index.ts                              — contextBridge surface
```

---

## 6. Memory Architecture

Two memory systems coexist. They must never be merged into one.

| System | File | Purpose | Storage |
|---|---|---|---|
| Council Memory | `engine/src/memory/councilMemoryGraph.ts` | Project decisions, strategies, insights for conversation | Session via StorageAdapter |
| Engineering Memory | `core/memory/CouncilMemoryGraph.ts` | Bugfixes, architecture decisions, experiment results for mission planning | File-persisted `.triforge-memory/` |

**Laws:**
- Do not add engineering-specific data (experiment scores, patch results) to Council Memory.
- Do not add conversational project knowledge to Engineering Memory.
- Engineering Memory uses atomic writes (tmp → rename). Never write directly to the bucket file.
- Engineering Memory has a 200-entry cap per bucket. Oldest entries are pruned when exceeded.

---

## 7. Context Handling

**Laws:**
- All AI prompts must use `ContextBuilder` to compress workspace context. Raw file dumps are forbidden.
- Maximum injected context size per prompt: 8,000 chars from ContextBuilder + 3,000 chars from CouncilMemoryGraph.
- Secrets (API keys, tokens) must never appear in injected context. `CouncilMemoryGraph._sanitize()` handles this — call it.
- The planning prompt structure must follow this order:
  1. Past memory (`[COUNCIL MEMORY]` block)
  2. Workspace context (`WORKSPACE CONTEXT` block)
  3. Problem analysis (`--- PROBLEM ANALYSIS ---` block)
  4. Planning instruction

---

## 8. Experiment Policy

Every engineering change must follow this lifecycle:

```
1. Generate candidates    — ThinkTankPlanner produces 3 distinct approaches
2. Sandbox experiment     — ExperimentEngine copies workspace to tmpdir, applies patches
3. Verify                 — VerificationRunner runs lint + build + test
4. Evolve (optional)      — EvolutionEngine runs up to 3 generations if score < 100
5. Present to user        — MissionController emits plan_ready, user approves each step
6. Execute                — AgentLoop applies steps with ApprovalStore gating
7. Post-verify            — VerificationRunner runs again; score 0 triggers rollback
```

**Laws:**
- Never skip the sandbox step for autonomous patches.
- Never apply patches to the real workspace before VerificationRunner passes.
- Never commit to git without a second explicit approval from the user.
- Experiment sandboxes are in `os.tmpdir()/.triforge-experiments/`. Clean them up after every run.

---

## 9. Parallel Execution

**Laws:**
- Provider calls always use `Promise.allSettled()`. Never await providers sequentially.
- `Promise.all()` (not allSettled) is only acceptable when all operations must succeed together.
- Context preparation (ContextBuilder + CouncilMemoryGraph) runs in `Promise.all()`.
- Problem framing runs after context preparation, before planning.
- Evolution generations are sequential by design (each generation depends on the previous winner).

---

## 10. Autonomy Limits

**Laws:**
- `enableAutonomyLoop` defaults to `false`. The system must not self-initiate missions without this flag.
- `enableSelfImprovement` defaults to `false`. Sacred files must not be patched without this flag.
- `enableEvolutionEngine` defaults to `true`. This may be disabled for faster single-round experiments.
- No feature flag may be flipped by an autonomous process. Only human approval can change flags.
- All new features must be gated behind a flag in `core/config/autonomyFlags.ts` before shipping.

---

## 11. Naming and File Placement

**Laws:**
- New core systems go in `packages/desktop/src/core/<subsystem>/`.
- New renderer components go in `packages/desktop/src/renderer/components/` (not `core/`).
- Do not create files outside the established subsystem folders without justification.
- Do not create duplicate systems. Before adding a new subsystem, check SYSTEM_MAP.ts.
- File names use PascalCase for classes (`MissionController.ts`) and camelCase for utilities (`withTimeout.ts`).

---

## 12. What Never Changes Without Explicit Human Approval

- This file (`CODE_CONSTITUTION.md`)
- `SYSTEM_MAP.ts`
- Any file in `core/config/`
- Any file listed in section 5 (Sacred Infrastructure)
- The pricing, tiers, or capability gates in `subscription.ts`
- The IPC surface (`ipc.ts`, `preload/index.ts`)

---

*Last updated: 2026-03 — TriForge AI v1.8+*
