// ── CommandDispatcher.ts — Re-export shim ────────────────────────────────────
// Source of truth moved to core/commands/CommandDispatcher.ts
export { dispatchCommand, onCouncilCommand } from '../../core/commands/CommandDispatcher';
export type { CouncilHandler, CommandSource } from '../../core/commands/CommandDispatcher';
