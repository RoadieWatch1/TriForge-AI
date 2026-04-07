// ── services/operatorTargetValidator.ts — Operator Target Matching & Validation ─
//
// Phase 2, Step 2: Target Validation + Post-Action Verification
//
// Provides target matching and context validation for operator actions.
// Used by operatorService.ts in three places:
//   1. After focus_app — verify the OS actually switched to the intended app
//   2. Before approved input — validate frontmost app matches session intent
//   3. After input execution — confirm target continuity post-action
//
// TARGET MATCHING HONESTY:
//   macOS app names are inconsistent. The user may say "Code" but the OS
//   reports "Visual Studio Code". This module uses fuzzy substring matching
//   to avoid false mismatch alarms on common variations.
//
//   Match strengths:
//     exact   — names are identical (case-insensitive)
//     partial — one name contains the other as a substring
//     none    — no detectable relationship
//
//   Both exact and partial are treated as valid matches.
//   "none" triggers a mismatch result.
//
// WHAT THIS DOES NOT DO:
//   - Bundle ID matching (would require macOS API calls)
//   - Fuzzy edit-distance matching (overkill for this use case)
//   - Window-level targeting (only app name level)
//   - Pixel-level focus confirmation

import type { OperatorTarget } from '@triforge/engine';

// ── Types ─────────────────────────────────────────────────────────────────────

/** How closely two app names match. */
export type TargetMatchStrength = 'exact' | 'partial' | 'none';

/** Structured result of a target context validation. */
export interface TargetValidationResult {
  /** Whether the target context is acceptable for proceeding. */
  valid: boolean;
  /** How well the intended and actual app names align. */
  matchStrength: TargetMatchStrength;
  /** The app name we expected to be frontmost. */
  intendedApp: string | null;
  /** The actual frontmost app name, or null if detection failed. */
  actualApp: string | null;
  /** Human-readable summary for logs and UI display. */
  message: string;
  /**
   * Machine-readable reason code on failure.
   * Maps to WorkerRun blocker kinds and OperatorActionResult.failureReason.
   */
  failureReason?:
    | 'target_mismatch'       // Intended app detected but wrong app is frontmost
    | 'target_unknown'        // Could not detect frontmost app
    | 'focus_verification_failed'; // focus_app ran but wrong app ended up frontmost
}

// ── Matching logic ────────────────────────────────────────────────────────────

/**
 * Compare two app name strings and return match strength.
 *
 * Rules:
 *   exact   — same text, case-insensitive
 *   partial — one is a substring of the other (case-insensitive)
 *   none    — no detectable relationship
 *
 * Examples:
 *   matchTarget("safari", "Safari")            → exact
 *   matchTarget("Code", "Visual Studio Code")  → partial
 *   matchTarget("Chrome", "Google Chrome")     → partial
 *   matchTarget("Slack", "Zoom")               → none
 */
export function matchTarget(a: string, b: string): TargetMatchStrength {
  const aLower = a.toLowerCase().trim();
  const bLower = b.toLowerCase().trim();
  if (aLower === bLower) return 'exact';
  if (aLower.includes(bLower) || bLower.includes(aLower)) return 'partial';
  return 'none';
}

// ── Validation functions ──────────────────────────────────────────────────────

/**
 * Validate that `focus_app` actually changed the frontmost app to the
 * intended target after the OS focus call completed.
 *
 * Called after execFocusApp() returns ok, passing the intended app name
 * and the result of getFrontmostTarget().
 *
 * Returns valid: true if the confirmed frontmost matches the intended app
 * (exact or partial match). Returns valid: false with focus_verification_failed
 * if the frontmost is still something else.
 */
export function validateFocusResult(
  intendedApp: string,
  confirmed: OperatorTarget | null,
): TargetValidationResult {
  if (!confirmed) {
    return {
      valid:         false,
      matchStrength: 'none',
      intendedApp,
      actualApp:     null,
      message:       `Could not verify focus — frontmost app detection returned nothing after focusing "${intendedApp}".`,
      failureReason: 'target_unknown',
    };
  }

  const strength = matchTarget(intendedApp, confirmed.appName);

  if (strength === 'none') {
    return {
      valid:         false,
      matchStrength: 'none',
      intendedApp,
      actualApp:     confirmed.appName,
      message:       `Focus may have failed: expected "${intendedApp}" to be frontmost, but "${confirmed.appName}" is frontmost.`,
      failureReason: 'focus_verification_failed',
    };
  }

  return {
    valid:         true,
    matchStrength: strength,
    intendedApp,
    actualApp:     confirmed.appName,
    message:       `Focus verified: "${confirmed.appName}" is frontmost (${strength} match for "${intendedApp}").`,
  };
}

/**
 * Validate that the current frontmost app matches the intended session target
 * before executing an input action (type_text / send_key).
 *
 * This is the pre-input target check. It replaces the previous exact
 * string equality check with fuzzy matching to reduce false mismatch alarms.
 *
 * @param intendedApp  Session's intended target app, or null if no target set
 * @param current      Currently frontmost app from getFrontmostTarget()
 *
 * If intendedApp is null (session has no target), the check passes — some
 * sessions are intentionally target-agnostic.
 */
export function validateInputContext(
  intendedApp: string | null,
  current: OperatorTarget | null,
): TargetValidationResult {
  // No intended target means any frontmost is acceptable
  if (!intendedApp) {
    return {
      valid:         true,
      matchStrength: 'exact',
      intendedApp:   null,
      actualApp:     current?.appName ?? null,
      message:       'No intended target — input will proceed to current frontmost app.',
    };
  }

  if (!current) {
    return {
      valid:         false,
      matchStrength: 'none',
      intendedApp,
      actualApp:     null,
      message:       `Cannot validate input target — frontmost app detection failed (expected "${intendedApp}").`,
      failureReason: 'target_unknown',
    };
  }

  const strength = matchTarget(intendedApp, current.appName);

  if (strength === 'none') {
    return {
      valid:         false,
      matchStrength: 'none',
      intendedApp,
      actualApp:     current.appName,
      message:       `Wrong target: expected "${intendedApp}" to be frontmost, but "${current.appName}" is frontmost. Input would go to the wrong app.`,
      failureReason: 'target_mismatch',
    };
  }

  return {
    valid:         true,
    matchStrength: strength,
    intendedApp,
    actualApp:     current.appName,
    message:       `Input target confirmed: "${current.appName}" matches "${intendedApp}" (${strength} match).`,
  };
}

/**
 * Validate target continuity AFTER an input action has executed.
 *
 * Reads the frontmost app after execution and checks it against the app
 * that was frontmost before execution. The goal is to detect focus loss
 * or unexpected app switches during the input operation.
 *
 * This is NOT a guarantee that the typed content landed correctly.
 * It only confirms that the expected app was still frontmost after input.
 * A false result means target continuity is uncertain — not that the
 * input was definitely wrong.
 *
 * @param preActionApp   The app name frontmost when input started
 * @param postActionTarget  The app from getFrontmostTarget() after input
 */
export function validatePostInputContinuity(
  preActionApp: string | null,
  postActionTarget: OperatorTarget | null,
): TargetValidationResult {
  // No pre-action target to compare — continuity cannot be assessed
  if (!preActionApp) {
    return {
      valid:         true,
      matchStrength: 'exact',
      intendedApp:   null,
      actualApp:     postActionTarget?.appName ?? null,
      message:       'No pre-action target recorded — continuity check skipped.',
    };
  }

  if (!postActionTarget) {
    return {
      valid:         false,
      matchStrength: 'none',
      intendedApp:   preActionApp,
      actualApp:     null,
      message:       `Target continuity uncertain — could not detect frontmost app after input (pre-action: "${preActionApp}").`,
      failureReason: 'target_unknown',
    };
  }

  const strength = matchTarget(preActionApp, postActionTarget.appName);

  if (strength === 'none') {
    return {
      valid:         false,
      matchStrength: 'none',
      intendedApp:   preActionApp,
      actualApp:     postActionTarget.appName,
      message:       `Target drifted after input: was "${preActionApp}", now "${postActionTarget.appName}". Input may have been delivered to the wrong app.`,
      failureReason: 'target_mismatch',
    };
  }

  return {
    valid:         true,
    matchStrength: strength,
    intendedApp:   preActionApp,
    actualApp:     postActionTarget.appName,
    message:       `Target continuity confirmed: "${postActionTarget.appName}" still frontmost after input.`,
  };
}
