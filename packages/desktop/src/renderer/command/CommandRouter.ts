// ── CommandRouter.ts — Parse "triforge X ..." into structured CommandRequest ──

import type { CommandSource } from '../../core/commands/CommandDispatcher';

export type CommandIntent = 'build' | 'fix' | 'refactor' | 'audit' | 'test' | 'docs';

export interface CommandRequest {
  id: string;
  source: CommandSource;
  raw: string;
  intent: CommandIntent;
  /** Payload extracted from command (text after the trigger phrase) */
  goal?: string;
  scope?: string[];
  constraints: {
    noUiChanges: boolean;
    requireApproval: boolean;
    safePreviewOnly: boolean;
  };
  createdAt: number;
}

export function routeCommand(raw: string, source: CommandSource = 'typed', goal?: string): CommandRequest | null {
  const t = raw.toLowerCase().trim();
  if (!t.startsWith('triforge ')) return null;

  let intent: CommandIntent = 'build';
  if (t.startsWith('triforge fix'))      intent = 'fix';
  if (t.startsWith('triforge refactor')) intent = 'refactor';
  if (t.startsWith('triforge audit'))    intent = 'audit';
  if (t.startsWith('triforge test'))     intent = 'test';
  if (t.startsWith('triforge docs'))     intent = 'docs';

  return {
    id: crypto.randomUUID(),
    source,
    raw,
    intent,
    goal,
    constraints: { noUiChanges: true, requireApproval: true, safePreviewOnly: true },
    createdAt: Date.now(),
  };
}
