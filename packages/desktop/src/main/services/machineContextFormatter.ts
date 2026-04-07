// ── machineContextFormatter.ts ────────────────────────────────────────────────
//
// Section 4 — Goal 4: Context Packaging Layer
//
// Pure transformation only. No I/O, no IPC, no side effects.
// Converts a MachineContext into a clean, human-readable summary string
// suitable for use as AI context input.

import type { MachineContext } from './machineContext';
import { getMachineContext } from './machineContext';

// ── Constants ─────────────────────────────────────────────────────────────────

const MAX_ITEMS = 10;

// ── Helpers ───────────────────────────────────────────────────────────────────

function renderList(items: string[], max = MAX_ITEMS): string {
  if (items.length === 0) return '- (none)';
  const visible = items.slice(0, max);
  const remainder = items.length - visible.length;
  const lines = visible.map(item => `- ${item}`);
  if (remainder > 0) lines.push(`  ...and ${remainder} more`);
  return lines.join('\n');
}

// ── Formatter ─────────────────────────────────────────────────────────────────

export function formatMachineContext(context: MachineContext): string {
  const sections: string[] = [];

  // System
  sections.push(
    `System:\n- OS: ${context.system.os} (${context.system.platform})`,
  );

  // Apps — name only, path omitted
  const appNames = context.apps.map(a => a.name);
  sections.push(`Apps:\n${renderList(appNames)}`);

  // Desktop
  sections.push(`Desktop:\n${renderList(context.files.desktop)}`);

  // Documents
  sections.push(`Documents:\n${renderList(context.files.documents)}`);

  return sections.join('\n\n');
}

// ── Optional helper ───────────────────────────────────────────────────────────

export async function getFormattedMachineContext(): Promise<string> {
  const context = await getMachineContext();
  return formatMachineContext(context);
}
