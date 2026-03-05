// ── SYSTEM_MAP.ts — TriForge AI architecture blueprint for AI agents ──────────
//
// AI agents and planners should read this file before performing code changes.
// It describes every subsystem, its purpose, entry points, and key constraints.

export const SYSTEM_MAP = {

  project: 'TriForge AI',
  version: '1.8.0',
  description: 'Multi-AI council engineering platform. Three AI minds debate, evolve, and verify solutions before any change reaches the user.',

  // ── Voice Layer ─────────────────────────────────────────────────────────────
  voiceSystem: {
    description: 'Offline wake-word detection using vosk-browser WASM. IPC trust boundary: renderer reports raw phrase, main validates, sends back sanitized command.',
    files: [
      'renderer/voice/VoskWakeEngine.ts',   // mic capture + vosk recognition (engine only, no app logic)
      'renderer/voice/VoiceCommandBridge.ts', // thin adapter: routes phrase to IPC or direct dispatch
    ],
    entryPoint: 'Chat.tsx boots VoiceCommandBridge; index.tsx boots it for offline mode',
    sacredFiles: ['renderer/voice/VoskWakeEngine.ts', 'renderer/voice/VoiceCommandBridge.ts'],
  },

  // ── Command System ───────────────────────────────────────────────────────────
  commandSystem: {
    description: 'Phrase matching and pub/sub dispatch for voice and typed commands. All commands validated server-side (main process) before action.',
    files: [
      'core/commands/CommandDispatcher.ts',  // pub/sub dispatcher with audit logging
      'core/commands/CouncilCommands.ts',    // central wake phrase registry
      'core/commands/matchCommand.ts',       // longest-phrase-wins matcher
      'renderer/command/CommandDispatcher.ts', // re-export shim for renderer imports
      'renderer/command/CommandRouter.ts',   // parses "triforge X ..." into CommandRequest
    ],
    sacredFiles: ['core/commands/CommandDispatcher.ts'],
  },

  // ── Council System ──────────────────────────────────────────────────────────
  councilSystem: {
    description: 'Multi-AI debate and consensus engine. Claude, GPT, and Grok run in parallel via Promise.allSettled. Consensus signals emitted on winner selection.',
    files: [
      'core/orchestrator/CouncilDecisionBus.ts', // EventEmitter bus for consensus signals
    ],
    engineFiles: [
      'packages/engine/src/council/CouncilExecutor.ts',       // parallel provider execution
      'packages/engine/src/council/CouncilRouter.ts',
      'packages/engine/src/council/DebateStreamCoordinator.ts',
      'packages/engine/src/core/thinkTankPlanner.ts',         // structured plan generation
      'packages/engine/src/core/orchestrator.ts',             // per-file unanimous debate loop
    ],
    parallelExecution: true,
    sacredFiles: ['core/orchestrator/CouncilDecisionBus.ts'],
  },

  // ── Engineering System ──────────────────────────────────────────────────────
  engineeringSystem: {
    description: 'Autonomous engineering missions: voice/typed command → AI plan → per-step user approval → execution → verification.',
    files: [
      'core/engineering/MissionController.ts', // lifecycle orchestrator (singleton)
      'core/engineering/types.ts',             // MissionPlan, MissionState, etc.
    ],
    lifecycle: 'intake → planning → awaiting_approval → executing → verifying → complete',
    safetyRules: [
      'No file writes without AgentLoop/ApprovalStore gating',
      'No git commits without second explicit approval',
      'All plans shown as previews first',
      'Approval per step — never batch-apply',
    ],
    sacredFiles: ['core/engineering/MissionController.ts'],
  },

  // ── Experimentation System ──────────────────────────────────────────────────
  experimentationSystem: {
    description: 'Generates 3 candidate approaches, runs them in isolated sandboxes, evolves across 3 generations (mutant-A + mutant-B + hybrid), selects the strongest.',
    files: [
      'core/experiments/ExperimentEngine.ts',   // sandbox runner (copy workspace → apply patches → verify)
      'core/experiments/EvolutionEngine.ts',    // multi-generation evolution loop with hybrid cross-breeding
      'core/experiments/VerificationRunner.ts', // script-aware lint/build/test runner
      'core/experiments/types.ts',              // PatchCandidate, ExperimentResult, scoring
    ],
    sandboxDir: 'os.tmpdir()/.triforge-experiments/<missionId>/',
    sacredFiles: ['core/experiments/ExperimentEngine.ts', 'core/experiments/EvolutionEngine.ts', 'core/experiments/VerificationRunner.ts'],
  },

  // ── Autonomy System ─────────────────────────────────────────────────────────
  autonomySystem: {
    description: 'Passive workspace observer. Detects issues (large files, TODO clusters, dead code) and emits proposals for user approval. Never writes files.',
    files: [
      'core/autonomy/AutonomyController.ts', // coordinator (disabled by default)
      'core/autonomy/WorkspaceObserver.ts',  // fs.watch wrapper
      'core/autonomy/AnalysisEngine.ts',     // orchestrates TS file scan
      'core/autonomy/ProblemDetector.ts',    // static analysis rules
      'core/autonomy/Scheduler.ts',          // setInterval with jitter
    ],
    defaultState: 'disabled (enableAutonomyLoop=false)',
  },

  // ── Context + Memory ────────────────────────────────────────────────────────
  contextMemorySystem: {
    description: 'Compresses workspace context for AI prompts and stores engineering knowledge across missions.',
    files: [
      'core/context/ContextBuilder.ts',      // workspace scan → compressed context string
      'core/memory/CouncilMemoryGraph.ts',   // file-persisted engineering memory (bugfixes, architecture, experiments)
    ],
    memoryDir: '.triforge-memory/',
    memoryFiles: ['bugfixes.json', 'architecture.json', 'experiments.json'],
  },

  // ── Configuration ───────────────────────────────────────────────────────────
  configuration: {
    flagsFile: 'core/config/autonomyFlags.ts',
    sacredFilesConfig: 'core/config/sacredFiles.ts',
    keyFlags: {
      enableEvolutionEngine:   'Multi-generation candidate evolution (default: true)',
      enableSelfImprovement:   'Allow patching sacred files (default: false)',
      enableAutonomyLoop:      'Passive workspace scanning (default: false)',
      enableMissionController: 'Engineering missions pipeline (default: true)',
    },
  },

  // ── IPC Bridge ──────────────────────────────────────────────────────────────
  ipcBridge: {
    description: 'All renderer→main communication goes through ipcMain.handle in ipc.ts. All main→renderer push events go through BrowserWindow.webContents.send.',
    files: [
      'main/ipc.ts',        // all ipcMain handlers (sacred)
      'preload/index.ts',   // contextBridge surface (sacred)
    ],
    sacredFiles: ['main/ipc.ts', 'preload/index.ts'],
  },

} as const;

export type SystemMap = typeof SYSTEM_MAP;
