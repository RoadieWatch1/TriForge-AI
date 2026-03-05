// ── CommandDispatcher.ts — Core command pub/sub with source tracking ──────────
//
// Central dispatcher for voice and typed commands.
// Matches raw text → MatchedCommand, notifies subscribed handlers, and
// sends a fire-and-forget audit record to the main process (AuditLedger).
//
// Safe to import in renderer (uses window?.triforge?.command?.audit for IPC).
// Main-process code: do not import this — call matchCommand directly instead.

import { matchCommand, type MatchedCommand } from './matchCommand';

export type CommandSource = 'typed' | 'voice';

export type CouncilHandler = (matched: MatchedCommand, source: CommandSource, raw: string) => void;

const _handlers = new Set<CouncilHandler>();

/** Subscribe to matched commands. Returns unsubscribe function. */
export function onCouncilCommand(handler: CouncilHandler): () => void {
  _handlers.add(handler);
  return () => _handlers.delete(handler);
}

/**
 * Dispatch raw text from voice or typed input.
 * Returns the MatchedCommand if one was found, null otherwise.
 */
export function dispatchCommand(raw: string, source: CommandSource): MatchedCommand | null {
  const matched = matchCommand(raw);
  if (!matched) return null;

  // Notify all subscribers
  for (const h of _handlers) {
    try { h(matched, source, raw); }
    catch { /* prevent one handler from blocking others */ }
  }

  // Fire-and-forget audit log via IPC (renderer only — no-op outside renderer)
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any)?.triforge?.command?.audit?.(source, matched.command, raw);
  } catch { /* ignore — runs in tests / main process without window */ }

  return matched;
}

/**
 * Activate a pre-validated command directly from the main-process trust boundary.
 * Called by VoiceCommandBridge when it receives a sanitized command name from main.
 * Bypasses matchCommand (command name is already validated by main process).
 */
export function activateCommand(command: string, source: CommandSource, raw?: string): MatchedCommand {
  const matched: MatchedCommand = { command, confidence: 1.0, payload: raw };

  for (const h of _handlers) {
    try { h(matched, source, raw ?? command); }
    catch { /* prevent one handler from blocking others */ }
  }

  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any)?.triforge?.command?.audit?.(source, command, raw ?? command);
  } catch { /* ignore */ }

  return matched;
}
