// ── operator/operatorSafetyPolicy.ts ─────────────────────────────────────────
//
// Section 10 — Trust, Security, and Safety Hardening
//
// Canonical safety constants for the TriForge desktop operator substrate.
// These are the single source of truth for what always requires approval,
// which permissions map to which capabilities, and what can be revoked.
//
// All operator code enforces through these constants — no local overrides.

import type { OperatorActionType, OperatorActionRisk } from './operatorTypes';
import type { TrustModeSnapshot, TrustLevel } from '../core/taskTypes';

// ── Actions that ALWAYS require explicit human approval ───────────────────────
//
// This list is the hard floor — no trust level, session state, or runtime flag
// can bypass it. If an action type is listed here, it must go through the
// approval queue regardless of other settings.
//
// Rationale: type_text and send_key directly mutate another application's state.
// They are the only actions with real-world consequences (send a message, submit
// a form, execute a command in a terminal). Anything wrong here is hard to undo.

export const OPERATOR_ALWAYS_REQUIRES_APPROVAL: readonly OperatorActionType[] = [
  'type_text',
  'send_key',
] as const;

// ── Capabilities gated by macOS permission ────────────────────────────────────
//
// Maps permission name → which OperatorActionTypes it enables.
// If the permission is not granted, those actions cannot execute.
// This is the authoritative mapping used by readiness checks and kill-switch UI.

export const OPERATOR_PERMISSION_GATES: Record<
  'accessibility' | 'screen_recording',
  readonly OperatorActionType[]
> = {
  accessibility:    ['type_text', 'send_key'],
  screen_recording: ['screenshot'],
};

// ── Risk floor by action type ─────────────────────────────────────────────────
//
// Minimum risk level that must be surfaced to the user before execution.
// 'read_only'    → show in activity log, no gate required
// 'focus_only'   → show in activity log, no gate required
// 'input_action' → always gate on explicit approval (see OPERATOR_ALWAYS_REQUIRES_APPROVAL)

export const OPERATOR_RISK_FLOOR: Record<OperatorActionType, OperatorActionRisk> = {
  get_frontmost: 'read_only',
  list_apps:     'read_only',
  screenshot:    'read_only',
  focus_app:     'focus_only',
  type_text:     'input_action',
  send_key:      'input_action',
  click_at:      'input_action',
};

// ── Approval TTL ──────────────────────────────────────────────────────────────
//
// Operator approvals are time-sensitive: the user looked at what would happen
// in a specific window context. 10 minutes later, the app state may have changed.
// If a user approves, execution must happen within this window or the approval
// is automatically expired.

export const OPERATOR_APPROVAL_TTL_MS = 10 * 60 * 1000; // 10 minutes

// ── Audit requirements ────────────────────────────────────────────────────────
//
// Which events MUST be logged. These cannot be suppressed by configuration.
// They provide the forensic trail required for user trust and future debugging.

export const OPERATOR_ALWAYS_AUDIT: readonly string[] = [
  'OPERATOR_ACTION_APPROVED',
  'OPERATOR_ACTION_DENIED',
  'OPERATOR_ACTION_EXECUTED',
  'OPERATOR_ACTION_FAILED',
  'OPERATOR_PERMISSION_DENIED',
  'OPERATOR_ENABLED',
  'OPERATOR_DISABLED',
  'TRUST_OVERRIDE_APPLIED',
  'AUTOPASS_EXECUTED',
] as const;

// ── Trust override validation ─────────────────────────────────────────────────
//
// When the renderer passes a trustOverride to taskEngine:runTask, it must be
// validated before use. This prevents escalation exploits where a compromised
// renderer passes a fully-permissive snapshot to execute without approval.
//
// Returns array of validation error strings (empty = valid).

const TRUST_LEVEL_ORDER: TrustLevel[] = ['off', 'suggest', 'approve', 'full'];

function trustLevelIndex(level: TrustLevel): number {
  return TRUST_LEVEL_ORDER.indexOf(level);
}

/**
 * Validates that a trust override snapshot is structurally sound.
 * Also detects attempts to escalate trust to 'full' on categories that
 * are currently 'off', since the main threat model is renderer-driven escalation.
 */
export function validateTrustOverride(
  override: TrustModeSnapshot,
  baseSnapshot: TrustModeSnapshot,
): string[] {
  const errors: string[] = [];
  const categories = Object.keys(override) as Array<keyof TrustModeSnapshot>;

  for (const cat of categories) {
    const base = baseSnapshot[cat];
    const over = override[cat];
    if (!over) continue;

    if (!TRUST_LEVEL_ORDER.includes(over.level)) {
      errors.push(`Invalid trust level '${over.level}' for category '${cat}'`);
      continue;
    }

    // Prevent jumping more than one level in a single override
    const baseLevel = base?.level ?? 'off';
    const overLevel = over.level;
    const delta = trustLevelIndex(overLevel) - trustLevelIndex(baseLevel);
    if (delta > 1) {
      errors.push(
        `Trust override for '${cat}' attempts to escalate from '${baseLevel}' to '${overLevel}' ` +
        `(${delta} levels) — maximum single override is 1 level`
      );
    }

    // Budget sanity
    if (typeof over.dailyBudgetCents !== 'number' || over.dailyBudgetCents < 0) {
      errors.push(`Invalid dailyBudgetCents in override for '${cat}'`);
    }
    if (typeof over.perActionLimitCents !== 'number' || over.perActionLimitCents < 0) {
      errors.push(`Invalid perActionLimitCents in override for '${cat}'`);
    }
    if (!Array.isArray(over.allowedTools)) {
      errors.push(`allowedTools must be an array in override for '${cat}'`);
    }
  }

  return errors;
}
