// ── services/operatorPreflight.ts — Operator Execution Preflight Validator ────
//
// Phase 2, Step 1: Operator Substrate v2 Reliability Hardening
//
// Validates operator readiness before any action is executed.
// Called from OperatorService.executeAction() and executeApprovedAction()
// BEFORE routing to the actual execution path.
//
// WHAT THIS PROVIDES:
//   1. Kill switch gate — checked first on every action
//   2. Session validation — action must belong to an active session
//   3. Platform gate — macOS-only enforcement
//   4. Capability preflight — required permissions probed at action time
//      (not just at app boot — machine can drift)
//   5. Permission drift detection — distinguishes "never had it" from
//      "had it before, now revoked"
//
// CAPABILITY CACHE:
//   Permission probes (Accessibility, Screen Recording) are OS calls
//   that take ~100–300ms each. We cache the result for CAPABILITY_CACHE_TTL_MS
//   (30s) to avoid blocking every action. The cache is:
//     • invalidated at startup via invalidateCapabilityCache()
//     • refreshed automatically when the TTL expires
//     • invalidated explicitly if an action receives a denied signal from OS
//
// WHAT THIS DOES NOT DO:
//   • Auto-fix missing permissions
//   • Synthesize capability state
//   • Block read-only actions for capabilities they don't need

import { exec } from 'child_process';
import path from 'path';
import os from 'os';
import type { OperatorActionType, OperatorSession } from '@triforge/engine';

// ── Permission probe helpers ──────────────────────────────────────────────────

/** Probe whether Accessibility permission is currently granted on macOS. */
async function probeAccessibility(): Promise<boolean> {
  return new Promise(resolve => {
    exec(
      `osascript -e 'tell application "System Events" to get name of first process where frontmost is true'`,
      { timeout: 3000 },
      (err) => resolve(!err),
    );
  });
}

/** Probe Screen Recording by attempting a 1×1 screencapture. */
async function probeScreenRecording(): Promise<boolean> {
  const probe = path.join(os.tmpdir(), `tf-probe-${Date.now()}.png`);
  return new Promise(resolve => {
    exec(
      `screencapture -x -R 0,0,1,1 "${probe}"`,
      { timeout: 3000 },
      (err) => resolve(!err),
    );
  });
}

// ── Capability cache ──────────────────────────────────────────────────────────

/** How long to trust a capability probe result before re-probing the OS. */
const CAPABILITY_CACHE_TTL_MS = 30_000; // 30 seconds

interface CapabilitySnapshot {
  accessibilityGranted: boolean;
  screenRecordingGranted: boolean;
  probedAt: number;
}

/** Currently cached capability snapshot, or null if never probed / invalidated. */
let _capabilityCache: CapabilitySnapshot | null = null;

/**
 * Tracks the last state where each permission was confirmed granted.
 * Used to detect permission revocation: "had it before → lost it now."
 * Monotonically true — never reset to false once set.
 */
const _everGranted = {
  accessibility:   false,
  screenRecording: false,
};

/**
 * Clear the capability cache. Call at app startup and after any permission
 * change signal to force a fresh OS probe on the next action.
 */
export function invalidateCapabilityCache(): void {
  _capabilityCache = null;
}

/**
 * Return the last known capability state.
 * May be null if never probed or if the cache was just invalidated.
 */
export function getLastKnownCapabilities(): CapabilitySnapshot | null {
  return _capabilityCache;
}

/**
 * Return the current permission drift state.
 *
 * A permission is "revoked" if it was confirmed granted in this process run
 * (_everGranted = true) but is no longer granted in the current cached state.
 * This signals that the user manually withdrew a previously-active permission.
 *
 * Returns false for both fields if the cache is null (never probed) — in that
 * case drift cannot be determined yet.
 */
export function getPermissionDriftState(): {
  accessibilityRevoked:   boolean;
  screenRecordingRevoked: boolean;
} {
  return {
    accessibilityRevoked:   _everGranted.accessibility   && (_capabilityCache?.accessibilityGranted === false),
    screenRecordingRevoked: _everGranted.screenRecording && (_capabilityCache?.screenRecordingGranted === false),
  };
}

/**
 * Probe OS capabilities with cache.
 * If the cache is valid, return it immediately.
 * Otherwise probe the OS and update the cache.
 */
async function getCapabilities(): Promise<CapabilitySnapshot | null> {
  const now = Date.now();
  if (_capabilityCache && (now - _capabilityCache.probedAt) < CAPABILITY_CACHE_TTL_MS) {
    return _capabilityCache;
  }
  try {
    const [a, s] = await Promise.all([probeAccessibility(), probeScreenRecording()]);
    const snapshot: CapabilitySnapshot = {
      accessibilityGranted:   a,
      screenRecordingGranted: s,
      probedAt:               now,
    };
    _capabilityCache = snapshot;
    // Update "ever granted" tracking — monotonically true
    if (a) _everGranted.accessibility   = true;
    if (s) _everGranted.screenRecording = true;
    return snapshot;
  } catch {
    // Probe failed (e.g. os command unavailable) — return null, caller degrades
    return null;
  }
}

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Overall readiness status for a specific operator action.
 *
 *   ready    — all requirements verified, action may proceed
 *   blocked  — action cannot proceed — structured reason provided
 *   degraded — capability probe failed, action may attempt but may fail
 */
export type PreflightStatus = 'ready' | 'blocked' | 'degraded';

/**
 * Machine-readable reason code when preflight blocks or degrades.
 * Maps cleanly to WorkerRun blocker kinds:
 *   operator_disabled              → capability_missing
 *   session_invalid                → tool_failed
 *   session_stopped                → tool_failed
 *   permission_missing_*           → permission_missing
 *   permission_revoked_*           → permission_missing (with stronger wording)
 *   platform_unsupported           → capability_missing
 *   capability_probe_failed        → capability_missing
 */
export type PreflightFailReason =
  | 'operator_disabled'
  | 'session_invalid'                   // session ID not found in store
  | 'session_stopped'                   // session was explicitly stopped/completed/failed
  | 'permission_missing_accessibility'  // Accessibility never granted
  | 'permission_missing_screen_recording' // Screen Recording never granted
  | 'permission_revoked_accessibility'  // Accessibility was granted, now gone
  | 'permission_revoked_screen_recording' // Screen Recording was granted, now gone
  | 'platform_unsupported'             // Not macOS
  | 'capability_probe_failed';          // OS capability probe threw unexpectedly

export interface PreflightResult {
  /** Overall pass/fail/degrade for this specific action. */
  status: PreflightStatus;
  /** True means the action must not proceed. */
  blocked: boolean;
  /** Structured reason code — present when blocked or degraded. */
  reason?: PreflightFailReason;
  /** Human-readable summary for UI display and logs. */
  message: string;
  /** What the user should do to resolve the block. */
  recoveryHint?: string;
  /** Capability snapshot at preflight time, if probed. */
  capabilities?: CapabilitySnapshot;
}

// ── Action capability requirements ───────────────────────────────────────────

/** True if the action requires macOS Accessibility permission. */
function requiresAccessibility(type: OperatorActionType): boolean {
  return type === 'type_text' || type === 'send_key' || type === 'click_at';
}

/** True if the action requires macOS Screen Recording permission. */
function requiresScreenRecording(type: OperatorActionType): boolean {
  return type === 'screenshot';
}

// ── Stale session threshold ───────────────────────────────────────────────────

/** Sessions active for longer than this with no actions are considered stale. */
const STALE_SESSION_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes

// ── Core preflight function ───────────────────────────────────────────────────

/**
 * Validate that an operator action is safe to execute.
 *
 * Checks (in order):
 *   1. Kill switch — operator must be enabled
 *   2. Session — must exist and be active
 *   3. Platform — macOS only
 *   4. Capabilities — only for actions that need specific permissions
 *      (type/key need Accessibility; screenshot needs Screen Recording)
 *
 * Actions that don't require specific permissions (list_apps, get_frontmost,
 * focus_app) pass the capability check automatically.
 *
 * @param actionType   The operator action type about to execute
 * @param sessionId    The session ID embedded in the action
 * @param sessions     Reference to the live session map from OperatorService
 * @param isEnabled    Getter for the operator kill switch state
 */
export async function preflightOperatorAction(
  actionType: OperatorActionType,
  sessionId: string,
  sessions: Map<string, OperatorSession>,
  isEnabled: () => boolean,
): Promise<PreflightResult> {

  // ── 1. Kill switch ─────────────────────────────────────────────────────────

  if (!isEnabled()) {
    return {
      status:       'blocked',
      blocked:      true,
      reason:       'operator_disabled',
      message:      'Operator execution is disabled.',
      recoveryHint: 'Go to Operate → Safety and enable the operator to resume.',
    };
  }

  // ── 2. Session validation ──────────────────────────────────────────────────

  const session = sessions.get(sessionId);

  if (!session) {
    return {
      status:       'blocked',
      blocked:      true,
      reason:       'session_invalid',
      message:      `Session "${sessionId}" was not found. It may have been cleared after a restart.`,
      recoveryHint: 'Start a new operator session before executing actions.',
    };
  }

  if (session.status !== 'active') {
    return {
      status:       'blocked',
      blocked:      true,
      reason:       'session_stopped',
      message:      `Session "${sessionId}" is ${session.status} and cannot accept new actions.`,
      recoveryHint: 'Start a new operator session to continue.',
    };
  }

  // ── 3. Platform gate ───────────────────────────────────────────────────────

  if (process.platform !== 'darwin') {
    return {
      status:       'blocked',
      blocked:      true,
      reason:       'platform_unsupported',
      message:      'Operator actions are macOS-only in this release.',
      recoveryHint: 'Windows and Linux operator support is not yet implemented.',
    };
  }

  // ── 4. Capability check — only for permission-dependent actions ────────────
  //
  // list_apps, get_frontmost, focus_app do NOT require special permissions
  // (standard macOS AppleScript access). Skip capability probe for them.

  const needsAccess   = requiresAccessibility(actionType);
  const needsRecording = requiresScreenRecording(actionType);

  if (!needsAccess && !needsRecording) {
    return {
      status:   'ready',
      blocked:  false,
      message:  'Preflight passed.',
    };
  }

  // Probe OS capabilities (cached for 30s)
  const caps = await getCapabilities();

  if (!caps) {
    // Probe itself failed — degrade, let the action attempt and surface its own error
    return {
      status:       'degraded',
      blocked:      false,
      reason:       'capability_probe_failed',
      message:      'Could not probe OS capabilities. Action will attempt but may fail.',
      recoveryHint: 'If the action fails, check System Settings → Privacy & Security.',
    };
  }

  // Check Accessibility
  if (needsAccess && !caps.accessibilityGranted) {
    const wasRevoked = _everGranted.accessibility;
    return {
      status:        'blocked',
      blocked:       true,
      reason:        wasRevoked
        ? 'permission_revoked_accessibility'
        : 'permission_missing_accessibility',
      message:       wasRevoked
        ? 'Accessibility permission was revoked since last check. Input actions are blocked.'
        : 'Accessibility permission is not granted. Input actions require this permission.',
      recoveryHint:  'Go to System Settings → Privacy & Security → Accessibility and add TriForge.',
      capabilities:  caps,
    };
  }

  // Check Screen Recording
  if (needsRecording && !caps.screenRecordingGranted) {
    const wasRevoked = _everGranted.screenRecording;
    return {
      status:        'blocked',
      blocked:       true,
      reason:        wasRevoked
        ? 'permission_revoked_screen_recording'
        : 'permission_missing_screen_recording',
      message:       wasRevoked
        ? 'Screen Recording permission was revoked since last check. Screenshots are blocked.'
        : 'Screen Recording permission is not granted. Screenshots require this permission.',
      recoveryHint:  'Go to System Settings → Privacy & Security → Screen Recording and add TriForge.',
      capabilities:  caps,
    };
  }

  return {
    status:       'ready',
    blocked:      false,
    message:      'Preflight passed.',
    capabilities: caps,
  };
}

// ── Stale session cleanup ─────────────────────────────────────────────────────

/**
 * Mark operator sessions that have been active past the stale threshold.
 * A session is stale if it is 'active' and has been running longer than
 * STALE_SESSION_THRESHOLD_MS with no recorded actions.
 *
 * Returns the number of sessions marked stale.
 *
 * Called at app startup and optionally before action execution to
 * prevent accumulation of zombie sessions from workflow runs that
 * did not cleanly call stopSession().
 */
export function cleanupStaleSessions(sessions: Map<string, OperatorSession>): number {
  const threshold = Date.now() - STALE_SESSION_THRESHOLD_MS;
  let cleaned = 0;

  for (const [id, session] of sessions) {
    if (session.status !== 'active') continue;

    const isOverAge = session.startedAt < threshold;
    const hasNoActions = session.actions.length === 0;

    if (isOverAge && hasNoActions) {
      sessions.set(id, {
        ...session,
        status:    'stopped',
        stopReason: 'stale_session_cleanup',
        endedAt:   Date.now(),
      });
      cleaned++;
    }
  }

  return cleaned;
}
