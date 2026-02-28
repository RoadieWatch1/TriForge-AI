/**
 * @triforge/engine — public API
 *
 * Everything VS Code extension and Desktop app need from the shared engine.
 * VS Code-specific files (commands, patch, search, debugSession, actionRunner)
 * live in the vscode-ext package and are NOT exported here.
 */

// Platform adapter interface
export type { StorageAdapter } from './platform';

// Protocol — all message types and shared interfaces
export * from './protocol';

// Providers
export type { AIProvider, AIProviderConfig } from './core/providers/provider';
export { ProviderError } from './core/providers/provider';
export { OpenAIProvider } from './core/providers/openai';
export { GrokProvider } from './core/providers/grok';
export { ClaudeProvider } from './core/providers/claude';

// Core engine
export { ProviderManager } from './core/providerManager';
export { TriForgeOrchestrator } from './core/orchestrator';
export { IntentEngine } from './core/intentEngine';
export { ActionPlanner } from './core/actionPlanner';
export { DecisionLog } from './core/decisionLog';
export { Memory } from './core/memory';
export { judgeVotes, selectTiebreaker, sessionConfidence } from './core/rubric';
export { sha256 } from './core/hash';

// Workspace utilities (platform-agnostic: fs + child_process only)
export { buildContextPreview, scanWorkspace, readSafeFile } from './core/context';
export {
  buildGitContext, getGitDiff, getGitStatus,
  getGitBranch, getRecentCommits
} from './core/git';

// Types
export type { TaskResult, DebateProgress, FileChange, ReviewResult } from './core/types';

// Tools / policy
export { DEFAULT_POLICY } from './tools/index';
