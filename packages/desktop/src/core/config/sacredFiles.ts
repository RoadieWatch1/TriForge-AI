// ── sacredFiles.ts — Critical infrastructure protected from autonomous patching ─
//
// These files form the core execution, safety, and orchestration backbone of
// TriForge. They must not be modified by autonomous experiments unless
// enableSelfImprovement is explicitly set to true AND the patch passes a full
// canary sandbox run (build + lint + test) before reaching the approval queue.
//
// Path format: relative to the desktop src/ directory (forward slashes).

export const SACRED_FILES: readonly string[] = [
  // Core engineering orchestration
  'core/engineering/MissionController.ts',

  // Experiment + verification infrastructure
  'core/experiments/ExperimentEngine.ts',
  'core/experiments/EvolutionEngine.ts',
  'core/experiments/VerificationRunner.ts',

  // Command trust boundary
  'core/commands/CommandDispatcher.ts',

  // Main process IPC (all feature entry points live here)
  'main/ipc.ts',

  // Voice recognition trust boundary
  'renderer/voice/VoskWakeEngine.ts',
  'renderer/voice/VoiceCommandBridge.ts',

  // Feature flags (guard against autonomous flag flipping)
  'core/config/autonomyFlags.ts',
  'core/config/sacredFiles.ts',

  // Council decision bus (consensus infrastructure)
  'core/orchestrator/CouncilDecisionBus.ts',

  // Preload bridge (IPC surface)
  'preload/index.ts',
] as const;

/**
 * Returns true if the given relative file path matches a sacred file.
 * Comparison is case-insensitive and normalises separators.
 */
export function isSacredFile(filePath: string): boolean {
  const normalised = filePath.replace(/\\/g, '/').toLowerCase();
  return SACRED_FILES.some(sf => normalised.endsWith(sf.toLowerCase()));
}
