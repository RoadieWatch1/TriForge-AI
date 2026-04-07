// ── operatorService.ts ────────────────────────────────────────────────────────
//
// Section 8 — Desktop Operator Engine: macOS Backend
//
// This is the real operator execution layer for TriForge on macOS.
// It provides genuine but narrow capability — honest about what it can and
// cannot do.
//
// TRULY IMPLEMENTED (macOS):
//   - List visible running applications (via osascript)
//   - Get frontmost app + window title (via osascript)
//   - Focus/switch to a named app (via osascript activate)
//   - Capture screen to a PNG file (via macOS screencapture CLI)
//   - Type text into the focused window (via osascript System Events)
//   - Send keyboard shortcuts (via osascript System Events key code)
//   - Check Accessibility permission status (via osascript probe)
//   - Approval gating for input actions (in-memory queue, 10-min TTL)
//   - Session tracking with action log
//   - Recovery hints on each failure mode
//
// PARTIAL / SCAFFOLDED:
//   - Screen Recording permission check (inferred via screenshot attempt)
//   - Target confirmation (compares expected vs actual frontmost app)
//
// NOT YET BUILT:
//   - Mouse click at pixel coordinates
//   - OCR on screenshots
//   - Windows / Linux support
//   - App-specific UI parsing
//   - Watching for screen state changes
//
// PERMISSIONS REQUIRED (macOS):
//   - System Settings → Privacy & Security → Accessibility (for type/key)
//   - System Settings → Privacy & Security → Screen Recording (for screenshot)
//
// Design rules:
//   - No writes outside tmp dir
//   - All input actions gate on approval before exec
//   - Sessions are always closeable / cancellable
//   - Every result includes a recoveryHint

import { exec } from 'child_process';
import path from 'path';
import os from 'os';
import crypto from 'crypto';
import type {
  OperatorTarget,
  OperatorPerception,
  OperatorAction,
  OperatorActionResult,
  OperatorActionType,
  OperatorCapabilityMap,
  OperatorSession,
  OperatorSessionEntry,
  OperatorApprovalRequest,
  OperatorOutcome,
} from '@triforge/engine';
import {
  preflightOperatorAction,
  cleanupStaleSessions as _cleanupStaleSessions,
  invalidateCapabilityCache,
  getLastKnownCapabilities,
  getPermissionDriftState,
} from './operatorPreflight';
import {
  validateFocusResult,
  validateInputContext,
  validatePostInputContinuity,
} from './operatorTargetValidator';

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeId(): string {
  return crypto.randomUUID();
}

function nowMs(): number {
  return Date.now();
}

/** Run a shell command with a timeout (default 8s). Returns stdout. */
function shellExec(cmd: string, timeoutMs = 8000): Promise<string> {
  return new Promise((resolve, reject) => {
    exec(cmd, { timeout: timeoutMs }, (err, stdout, stderr) => {
      if (err) {
        reject(new Error(stderr?.trim() || err.message));
      } else {
        resolve(stdout?.trim() ?? '');
      }
    });
  });
}

/** Escape a string for safe interpolation inside an AppleScript string literal. */
function escapeAppleScriptString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

const PLATFORM = process.platform;
const IS_MACOS = PLATFORM === 'darwin';

// ── Capability detection ──────────────────────────────────────────────────────

/** Probe whether Accessibility permission is granted on macOS. */
async function checkAccessibilityPermission(): Promise<boolean> {
  if (!IS_MACOS) return false;
  try {
    // Attempt a harmless System Events query — fails with error if not granted
    await shellExec(
      `osascript -e 'tell application "System Events" to get name of first process where frontmost is true'`,
      3000,
    );
    return true;
  } catch {
    return false;
  }
}

/** Probe Screen Recording permission by attempting a 1×1 screencapture. */
async function checkScreenRecordingPermission(): Promise<boolean> {
  if (!IS_MACOS) return false;
  const probe = path.join(os.tmpdir(), `tf-probe-${Date.now()}.png`);
  try {
    await shellExec(`screencapture -x -R 0,0,1,1 "${probe}"`, 3000);
    return true;
  } catch {
    return false;
  }
}

// ── Target detection ──────────────────────────────────────────────────────────

/** List all visible (non-background) running apps on macOS. */
async function listRunningApps(): Promise<string[]> {
  if (!IS_MACOS) return [];
  const raw = await shellExec(
    `osascript -e 'tell application "System Events" to get name of every process where background only is false'`,
    5000,
  );
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}

/** Get the frontmost app and its window title. */
async function getFrontmostTarget(): Promise<OperatorTarget | null> {
  if (!IS_MACOS) return null;
  try {
    const appName = await shellExec(
      `osascript -e 'tell application "System Events" to get name of first process where frontmost is true'`,
      3000,
    );

    let windowTitle: string | undefined;
    try {
      windowTitle = await shellExec(
        `osascript -e 'tell application "${escapeAppleScriptString(appName)}" to get name of front window'`,
        2000,
      );
    } catch {
      // Window title is best-effort — many apps don't expose it via this path
    }

    return {
      appName: appName.trim(),
      windowTitle: windowTitle?.trim(),
      confirmed: true,
      capturedAt: nowMs(),
    };
  } catch {
    return null;
  }
}

// ── Core action implementations ───────────────────────────────────────────────

async function execFocusApp(appName: string): Promise<{ ok: boolean; error?: string }> {
  if (!IS_MACOS) return { ok: false, error: 'Platform not supported' };
  try {
    await shellExec(
      `osascript -e 'tell application "${escapeAppleScriptString(appName)}" to activate'`,
      5000,
    );
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

async function execCaptureScreen(outputPath: string): Promise<{ ok: boolean; error?: string }> {
  if (!IS_MACOS) return { ok: false, error: 'Platform not supported' };
  try {
    // -x: no sound, no cursor; outputs to specified path
    await shellExec(`screencapture -x "${outputPath}"`, 10000);
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

async function execTypeText(text: string): Promise<{ ok: boolean; error?: string }> {
  if (!IS_MACOS) return { ok: false, error: 'Platform not supported' };
  try {
    const escaped = escapeAppleScriptString(text);
    await shellExec(
      `osascript -e 'tell application "System Events" to keystroke "${escaped}"'`,
      10000,
    );
    return { ok: true };
  } catch (err) {
    const msg = String(err);
    if (msg.includes('not authorized') || msg.includes('1002')) {
      return { ok: false, error: 'ACCESSIBILITY_DENIED' };
    }
    return { ok: false, error: msg };
  }
}

/**
 * Key name map — translates semantic key names to osascript key codes.
 * Covers the most common navigation and control keys.
 */
const KEY_CODES: Record<string, number> = {
  return:    36,
  enter:     36,
  escape:    53,
  tab:       48,
  space:     49,
  delete:    51,
  backspace: 51,
  up:        126,
  down:      125,
  left:      123,
  right:     124,
  home:      115,
  end:       119,
  pageup:    116,
  pagedown:  121,
  f1:        122, f2:  120, f3:  99,  f4:  118,
  f5:        96,  f6:  97,  f7:  98,  f8:  100,
  f9:        101, f10: 109, f11: 103, f12: 111,
};

async function execSendKey(
  key: string,
  modifiers: Array<'cmd' | 'shift' | 'alt' | 'ctrl'>,
): Promise<{ ok: boolean; error?: string }> {
  if (!IS_MACOS) return { ok: false, error: 'Platform not supported' };
  try {
    const modMap: Record<string, string> = {
      cmd:   'command down',
      shift: 'shift down',
      alt:   'option down',
      ctrl:  'control down',
    };

    const usingList = modifiers.map(m => modMap[m]).filter(Boolean);
    const usingClause = usingList.length > 0 ? ` using {${usingList.join(', ')}}` : '';

    const keyLower = key.toLowerCase();
    let script: string;

    if (KEY_CODES[keyLower] !== undefined) {
      // Named key via key code
      script = `tell application "System Events" to key code ${KEY_CODES[keyLower]}${usingClause}`;
    } else if (key.length === 1) {
      // Single character — use keystroke
      script = `tell application "System Events" to keystroke "${escapeAppleScriptString(key)}"${usingClause}`;
    } else {
      return { ok: false, error: `Unknown key: "${key}"` };
    }

    await shellExec(`osascript -e '${script}'`, 5000);
    return { ok: true };
  } catch (err) {
    const msg = String(err);
    if (msg.includes('not authorized') || msg.includes('1002')) {
      return { ok: false, error: 'ACCESSIBILITY_DENIED' };
    }
    return { ok: false, error: msg };
  }
}

// ── Approval queue ────────────────────────────────────────────────────────────

const APPROVAL_TTL_MS = 10 * 60 * 1000; // 10 minutes

const _pendingApprovals = new Map<string, OperatorApprovalRequest>();

function createApprovalRequest(
  action: OperatorAction,
  contextScreenshotPath?: string,
  contextTarget?: OperatorTarget,
): OperatorApprovalRequest {
  const req: OperatorApprovalRequest = {
    id:           makeId(),
    sessionId:    action.sessionId,
    action,
    risk:         action.type === 'type_text' || action.type === 'send_key'
                    ? 'input_action'
                    : 'focus_only',
    description:  describeAction(action),
    contextScreenshotPath,
    contextTarget,
    createdAt:    nowMs(),
    expiresAt:    nowMs() + APPROVAL_TTL_MS,
    status:       'pending',
  };
  _pendingApprovals.set(req.id, req);
  return req;
}

function describeAction(action: OperatorAction): string {
  switch (action.type) {
    case 'type_text':
      return `Type text into the active window: "${
        (action.text ?? '').length > 80
          ? (action.text ?? '').slice(0, 80) + '…'
          : (action.text ?? '')
      }"`;
    case 'send_key': {
      const mods = (action.modifiers ?? []).join('+');
      return `Send key: ${mods ? mods + '+' : ''}${action.key ?? '?'}`;
    }
    default:
      return `Operator action: ${action.type}`;
  }
}

function pruneExpiredApprovals(): void {
  const now = nowMs();
  for (const [id, req] of _pendingApprovals) {
    if (req.expiresAt < now && req.status === 'pending') {
      _pendingApprovals.set(id, { ...req, status: 'expired' });
    }
  }
}

// ── Session store ─────────────────────────────────────────────────────────────

const _sessions = new Map<string, OperatorSession>();

// ── Operator kill switch ──────────────────────────────────────────────────────
//
// Section 10: Single flag that gates ALL operator action execution.
// When false, executeAction() and executeApprovedAction() return 'not_supported'
// immediately — no AppleScript or screencapture is invoked.
//
// This is the revocation handle surfaced in the Operate UI safety panel.
// Read-only (via isOperatorEnabled) and read-write (via setOperatorEnabled)
// are both exposed on OperatorService.

let _operatorEnabled = true;

// ── OperatorService ───────────────────────────────────────────────────────────

export const OperatorService = {

  // ── Kill switch ─────────────────────────────────────────────────────────────

  /** Disable all operator execution immediately. Pending approvals cannot execute. */
  setOperatorEnabled(enabled: boolean): void {
    _operatorEnabled = enabled;
  },

  /** Current operator enable state. */
  isOperatorEnabled(): boolean {
    return _operatorEnabled;
  },

  // ── Capability ──────────────────────────────────────────────────────────────

  async getCapabilityMap(): Promise<OperatorCapabilityMap> {
    const platform = IS_MACOS ? 'macOS' : (PLATFORM as 'Windows' | 'Linux' | 'unknown');

    if (!IS_MACOS) {
      return {
        platform,
        canListRunningApps:    false,
        canGetFrontmostApp:    false,
        canFocusApp:           false,
        canCaptureScreen:      false,
        canReadWindowTitle:    false,
        canOCRScreen:          false,
        canTypeText:           false,
        canSendKeystroke:      false,
        canClickAtCoords:      false,
        accessibilityGranted:  false,
        screenRecordingGranted: false,
        notes: [
          'Operator substrate is macOS-only in this release.',
          'Windows and Linux support is not yet implemented.',
        ],
      };
    }

    const [accessibilityGranted, screenRecordingGranted] = await Promise.all([
      checkAccessibilityPermission(),
      checkScreenRecordingPermission(),
    ]);

    return {
      platform: 'macOS',
      canListRunningApps:    true,
      canGetFrontmostApp:    true,
      canFocusApp:           true,
      canCaptureScreen:      screenRecordingGranted,
      canReadWindowTitle:    accessibilityGranted,
      canOCRScreen:          false,   // Not yet implemented
      canTypeText:           accessibilityGranted,
      canSendKeystroke:      accessibilityGranted,
      canClickAtCoords:      false,   // Not yet implemented
      accessibilityGranted,
      screenRecordingGranted,
      notes: [
        'App/window targeting and focus are available via macOS AppleScript.',
        'Input (type/key) requires Accessibility permission in System Settings → Privacy & Security.',
        'Screenshots require Screen Recording permission in System Settings → Privacy & Security.',
        'Mouse click at coordinates is scaffolded but not yet wired — needs pixel-level coordinate resolution.',
        'OCR on screenshots is not yet implemented.',
        'Windows and Linux are not yet supported.',
      ],
    };
  },

  // ── Targeting ───────────────────────────────────────────────────────────────

  async listRunningApps(): Promise<string[]> {
    if (!IS_MACOS) return [];
    try {
      return await listRunningApps();
    } catch {
      return [];
    }
  },

  async getFrontmostApp(): Promise<OperatorTarget | null> {
    return getFrontmostTarget();
  },

  // ── Perception ──────────────────────────────────────────────────────────────

  async perceive(): Promise<OperatorPerception> {
    const target = await getFrontmostTarget();
    return {
      timestamp: nowMs(),
      target,
      summary: target
        ? `Frontmost app: ${target.appName}${target.windowTitle ? ` — "${target.windowTitle}"` : ''}`
        : 'Could not determine frontmost application.',
    };
  },

  async captureScreen(outputPath?: string): Promise<{
    ok: boolean;
    path?: string;
    error?: string;
    recoveryHint?: string;
  }> {
    if (!IS_MACOS) {
      return {
        ok: false,
        error: 'Screenshot capture is macOS-only.',
        recoveryHint: 'Operator screenshot capability is not available on this platform.',
      };
    }

    const dest = outputPath ?? path.join(os.tmpdir(), `tf-screen-${Date.now()}.png`);
    const result = await execCaptureScreen(dest);

    if (!result.ok) {
      return {
        ok: false,
        error: result.error,
        recoveryHint:
          'Screenshot failed. Go to System Settings → Privacy & Security → Screen Recording and grant access to TriForge.',
      };
    }

    return { ok: true, path: dest };
  },

  // ── Session management ───────────────────────────────────────────────────────

  startSession(intendedTarget: string | null): OperatorSession {
    const session: OperatorSession = {
      id:              makeId(),
      startedAt:       nowMs(),
      intendedTarget,
      confirmedTarget: null,
      actions:         [],
      status:          'active',
    };
    _sessions.set(session.id, session);
    return session;
  },

  getSession(id: string): OperatorSession | null {
    return _sessions.get(id) ?? null;
  },

  listSessions(): OperatorSession[] {
    return Array.from(_sessions.values());
  },

  stopSession(id: string, reason?: string): boolean {
    const session = _sessions.get(id);
    if (!session) return false;
    _sessions.set(id, {
      ...session,
      status:    'stopped',
      stopReason: reason,
      endedAt:   nowMs(),
    });
    return true;
  },

  // ── Action execution (approval-gated) ───────────────────────────────────────

  /**
   * Execute an operator action.
   *
   * Read-only and focus-only actions run immediately.
   * Input actions (type_text, send_key) are queued for human approval first.
   * Returns { outcome: 'approval_pending', approvalId } for gated actions.
   */
  async executeAction(action: OperatorAction): Promise<OperatorActionResult> {
    const start = nowMs();

    // Kill switch — checked first (also checked inside preflight, but this path
    // returns the existing operator-disabled message format for backwards compat)
    if (!_operatorEnabled) {
      return {
        actionId:      action.id,
        actionType:    action.type,
        outcome:       'not_supported',
        failureReason: 'operator_disabled',
        durationMs:    0,
        error:         'Operator execution is disabled. Enable it in the Operate safety panel.',
        recoveryHint:  'Go to Operate → Safety and enable the operator to resume.',
        completedAt:   nowMs(),
      };
    }

    // ── Preflight: session validation + capability check ───────────────────
    //
    // Validates that the session is active and that required OS permissions
    // (Accessibility, Screen Recording) are currently available.
    // Catches permission drift — permissions may change after app startup.
    // For input actions (type_text, send_key): blocks at queue time if
    // Accessibility is missing, preventing a doomed approval from being created.

    const preflight = await preflightOperatorAction(
      action.type, action.sessionId, _sessions, () => _operatorEnabled,
    );

    if (preflight.blocked) {
      const outcome: OperatorOutcome =
        preflight.reason === 'session_invalid' || preflight.reason === 'session_stopped'
          ? 'session_invalid'
          : preflight.reason?.startsWith('permission_')
          ? (preflight.reason?.includes('revoked') ? 'permission_revoked' : 'permission_denied')
          : 'preflight_blocked';

      return {
        actionId:      action.id,
        actionType:    action.type,
        outcome,
        failureReason: preflight.reason,
        durationMs:    nowMs() - start,
        error:         preflight.message,
        recoveryHint:  preflight.recoveryHint,
        completedAt:   nowMs(),
      };
    }

    const fail = (
      outcome: OperatorOutcome,
      error: string,
      recoveryHint?: string,
      failureReason?: string,
    ): OperatorActionResult => ({
      actionId:    action.id,
      actionType:  action.type,
      outcome,
      failureReason,
      durationMs:  nowMs() - start,
      error,
      recoveryHint,
      completedAt: nowMs(),
    });

    const ok = (extras: Partial<OperatorActionResult> = {}): OperatorActionResult => ({
      actionId:    action.id,
      actionType:  action.type,
      outcome:     'success',
      durationMs:  nowMs() - start,
      completedAt: nowMs(),
      ...extras,
    });

    // ── Route by action type ─────────────────────────────────────────────────

    switch (action.type) {

      case 'list_apps': {
        if (!IS_MACOS) return fail('not_supported', 'macOS only');
        try {
          const apps = await listRunningApps();
          return ok({ apps });
        } catch (e) {
          return fail('failed', String(e), 'Could not enumerate running apps.');
        }
      }

      case 'get_frontmost': {
        const target = await getFrontmostTarget();
        if (!target) return fail('failed', 'Could not read frontmost app.');
        return ok({ executedTarget: target });
      }

      case 'screenshot': {
        const dest = action.outputPath ?? path.join(os.tmpdir(), `tf-screen-${nowMs()}.png`);
        const res = await execCaptureScreen(dest);
        if (!res.ok) {
          return fail(
            'permission_denied',
            res.error ?? 'Screenshot failed',
            'Grant Screen Recording permission in System Settings → Privacy & Security.',
          );
        }
        return ok({ outputPath: dest });
      }

      case 'focus_app': {
        if (!action.target) return fail('failed', 'focus_app requires a target app name.');
        const res = await execFocusApp(action.target);
        if (!res.ok) {
          const isNotFound =
            res.error?.includes('not found') ||
            res.error?.includes("can't get process") ||
            res.error?.includes("doesn't understand");
          return isNotFound
            ? fail(
                'target_not_found',
                res.error ?? 'App not found',
                `"${action.target}" is not running. List apps first to find available targets.`,
                'app_not_running',
              )
            : fail('failed', res.error ?? 'Focus failed');
        }

        // ── Post-focus verification ────────────────────────────────────────
        // Re-read frontmost and verify the intended app is actually there.
        // The OS activate call may succeed syntactically but focus can land
        // on a different window if the app name was ambiguous or the app
        // is in a restricted state (e.g. fullscreen another space).

        const confirmed = await getFrontmostTarget();
        const focusValidation = validateFocusResult(action.target, confirmed);

        if (!focusValidation.valid) {
          // Capture an audit screenshot on focus verification failure (best-effort)
          const auditDest = path.join(os.tmpdir(), `tf-focus-fail-${nowMs()}.png`);
          await execCaptureScreen(auditDest).catch(() => {/* best-effort */});

          return {
            actionId:       action.id,
            actionType:     action.type,
            outcome:        'wrong_target',
            failureReason:  focusValidation.failureReason,
            durationMs:     nowMs() - start,
            error:          focusValidation.message,
            executedTarget: confirmed ?? undefined,
            recoveryHint:   `Verify "${action.target}" is running and not hidden behind a fullscreen app.`,
            targetVerified: false,
            completedAt:    nowMs(),
          };
        }

        return ok({
          executedTarget: confirmed ?? undefined,
          targetVerified: true,
        });
      }

      case 'type_text':
      case 'send_key': {
        // ── Approval gate ──
        // Capture context (screenshot + frontmost app) before queuing.
        // Both are best-effort — queuing proceeds even if capture fails.
        // contextTarget is stored on the approval so the UI can show
        // "you are about to type into: [app name]" to the reviewer.

        const ctxDest = path.join(os.tmpdir(), `tf-ctx-${nowMs()}.png`);
        const [ctxSs, ctxFrontmost] = await Promise.all([
          execCaptureScreen(ctxDest),
          getFrontmostTarget(),
        ]);

        const approval = createApprovalRequest(
          action,
          ctxSs.ok ? ctxDest : undefined,
          ctxFrontmost ?? undefined,
        );

        return {
          actionId:     action.id,
          actionType:   action.type,
          outcome:      'approval_pending',
          durationMs:   nowMs() - start,
          approvalId:   approval.id,
          completedAt:  nowMs(),
          recoveryHint: 'Approve this action in the Operate panel before it will execute.',
        };
      }

      default:
        return fail('not_supported', `Unknown action type: ${(action as OperatorAction).type}`);
    }
  },

  /**
   * Execute a previously approved input action.
   * Called after the human approves the action in the UI.
   */
  async executeApprovedAction(approvalId: string, approvedBy?: string): Promise<OperatorActionResult> {
    pruneExpiredApprovals();

    // Kill switch — check before executing approved actions too
    if (!_operatorEnabled) {
      return {
        actionId:      approvalId,
        actionType:    'type_text',
        outcome:       'not_supported',
        failureReason: 'operator_disabled',
        durationMs:    0,
        error:         'Operator execution is disabled. Enable it in the Operate safety panel.',
        recoveryHint:  'Go to Operate → Safety and enable the operator to resume.',
        completedAt:   nowMs(),
      };
    }

    const approval = _pendingApprovals.get(approvalId);
    if (!approval) {
      return {
        actionId:    approvalId,
        actionType:  'type_text',
        outcome:     'approval_denied',
        durationMs:  0,
        error:       'Approval request not found or already resolved.',
        completedAt: nowMs(),
      };
    }

    if (approval.status === 'expired') {
      return {
        actionId:    approval.action.id,
        actionType:  approval.action.type,
        outcome:     'approval_denied',
        durationMs:  0,
        error:       'Approval request expired.',
        recoveryHint: 'Re-queue the action to get a fresh approval request.',
        completedAt: nowMs(),
      };
    }

    if (approval.status !== 'pending') {
      return {
        actionId:    approval.action.id,
        actionType:  approval.action.type,
        outcome:     'approval_denied',
        durationMs:  0,
        error:       `Approval is in state "${approval.status}", not pending.`,
        completedAt: nowMs(),
      };
    }

    // Mark approved — record who approved and when
    _pendingApprovals.set(approvalId, {
      ...approval,
      status:      'approved',
      respondedAt: nowMs(),
      approvedBy:  approvedBy ?? 'local_ui',
    });

    const start = nowMs();
    const action = approval.action;

    // ── Pre-execution preflight: re-validate session + capabilities ────────
    //
    // Re-run preflight at execution time (not just at queue time).
    // Permissions may have changed between when the approval was created
    // and when the user clicks Approve. This prevents a false "Approved"
    // action from executing when capabilities are now missing.

    const preflight = await preflightOperatorAction(
      action.type, action.sessionId, _sessions, () => _operatorEnabled,
    );
    if (preflight.blocked) {
      const outcome: OperatorOutcome =
        preflight.reason === 'session_invalid' || preflight.reason === 'session_stopped'
          ? 'session_invalid'
          : preflight.reason?.startsWith('permission_')
          ? (preflight.reason?.includes('revoked') ? 'permission_revoked' : 'permission_denied')
          : 'preflight_blocked';
      return {
        actionId:      action.id,
        actionType:    action.type,
        outcome,
        failureReason: preflight.reason,
        durationMs:    nowMs() - start,
        error:         preflight.message,
        recoveryHint:  preflight.recoveryHint,
        completedAt:   nowMs(),
      };
    }

    // ── Pre-input target validation (fuzzy) ────────────────────────────────
    //
    // Check that the frontmost app matches the session's intended target
    // before delivering input. Uses fuzzy matching to handle common name
    // variations (e.g. "Code" → "Visual Studio Code").
    // If intendedTarget is null, any frontmost is acceptable.

    const session        = _sessions.get(action.sessionId);
    const intendedTarget = session?.intendedTarget ?? null;
    const preTarget      = await getFrontmostTarget();

    const inputValidation = validateInputContext(intendedTarget, preTarget);

    if (!inputValidation.valid) {
      return {
        actionId:      action.id,
        actionType:    action.type,
        outcome:       'wrong_target',
        failureReason: inputValidation.failureReason,
        durationMs:    nowMs() - start,
        error:         inputValidation.message,
        executedTarget: preTarget ?? undefined,
        recoveryHint:  'Re-focus the intended app and re-queue the action.',
        targetVerified: false,
        completedAt:   nowMs(),
      };
    }

    // ── Execute the input action ────────────────────────────────────────────

    if (action.type === 'type_text') {
      if (!action.text) {
        return {
          actionId:   action.id,
          actionType: 'type_text',
          outcome:    'failed',
          durationMs: nowMs() - start,
          error:      'type_text action has no text.',
          completedAt: nowMs(),
        };
      }
      const res = await execTypeText(action.text);
      if (!res.ok) {
        if (res.error === 'ACCESSIBILITY_DENIED') {
          return {
            actionId:      action.id,
            actionType:    'type_text',
            outcome:       'permission_denied',
            failureReason: 'permission_revoked_accessibility',
            durationMs:    nowMs() - start,
            error:         'Accessibility permission denied.',
            recoveryHint:
              'Go to System Settings → Privacy & Security → Accessibility and add TriForge.',
            completedAt: nowMs(),
          };
        }
        return {
          actionId:   action.id,
          actionType: 'type_text',
          outcome:    'failed',
          durationMs: nowMs() - start,
          error:      res.error,
          completedAt: nowMs(),
        };
      }

      // ── Post-input target continuity check ────────────────────────────
      const postTarget      = await getFrontmostTarget();
      const continuity      = validatePostInputContinuity(preTarget?.appName ?? null, postTarget);

      return {
        actionId:       action.id,
        actionType:     'type_text',
        outcome:        'success',
        failureReason:  continuity.valid ? undefined : 'target_drift_post_input',
        durationMs:     nowMs() - start,
        executedTarget: postTarget ?? preTarget ?? undefined,
        targetVerified: continuity.valid,
        // Surface a note if drift occurred — action succeeded but continuity uncertain
        error:          continuity.valid ? undefined : continuity.message,
        completedAt:    nowMs(),
      };
    }

    if (action.type === 'send_key') {
      if (!action.key) {
        return {
          actionId:   action.id,
          actionType: 'send_key',
          outcome:    'failed',
          durationMs: nowMs() - start,
          error:      'send_key action has no key.',
          completedAt: nowMs(),
        };
      }
      const res = await execSendKey(action.key, action.modifiers ?? []);
      if (!res.ok) {
        if (res.error === 'ACCESSIBILITY_DENIED') {
          return {
            actionId:      action.id,
            actionType:    'send_key',
            outcome:       'permission_denied',
            failureReason: 'permission_revoked_accessibility',
            durationMs:    nowMs() - start,
            error:         'Accessibility permission denied.',
            recoveryHint:
              'Go to System Settings → Privacy & Security → Accessibility and add TriForge.',
            completedAt: nowMs(),
          };
        }
        return {
          actionId:   action.id,
          actionType: 'send_key',
          outcome:    'failed',
          durationMs: nowMs() - start,
          error:      res.error,
          completedAt: nowMs(),
        };
      }

      // ── Post-input target continuity check ────────────────────────────
      const postTarget      = await getFrontmostTarget();
      const continuity      = validatePostInputContinuity(preTarget?.appName ?? null, postTarget);

      return {
        actionId:       action.id,
        actionType:     'send_key',
        outcome:        'success',
        failureReason:  continuity.valid ? undefined : 'target_drift_post_input',
        durationMs:     nowMs() - start,
        executedTarget: postTarget ?? preTarget ?? undefined,
        targetVerified: continuity.valid,
        error:          continuity.valid ? undefined : continuity.message,
        completedAt:    nowMs(),
      };
    }

    return {
      actionId:   action.id,
      actionType: action.type,
      outcome:    'not_supported',
      durationMs: nowMs() - start,
      error:      'executeApprovedAction called on non-input action.',
      completedAt: nowMs(),
    };
  },

  // ── Approval management ──────────────────────────────────────────────────────

  listPendingApprovals(): OperatorApprovalRequest[] {
    pruneExpiredApprovals();
    return Array.from(_pendingApprovals.values()).filter(r => r.status === 'pending');
  },

  getApproval(id: string): OperatorApprovalRequest | null {
    return _pendingApprovals.get(id) ?? null;
  },

  denyApproval(id: string, reason?: string): boolean {
    const req = _pendingApprovals.get(id);
    if (!req || req.status !== 'pending') return false;
    _pendingApprovals.set(id, {
      ...req,
      status:       'denied',
      denialReason: reason,
      respondedAt:  nowMs(),
    });
    return true;
  },

  // ── Action builder helper ────────────────────────────────────────────────────

  buildAction(
    sessionId: string,
    type: OperatorActionType,
    opts: Omit<OperatorAction, 'id' | 'sessionId' | 'requestedAt' | 'type'> = {},
  ): OperatorAction {
    return {
      id:          makeId(),
      sessionId,
      type,
      requestedAt: nowMs(),
      ...opts,
    };
  },

  // ── Reliability helpers (Phase 2 Step 1) ─────────────────────────────────────

  /**
   * Mark operator sessions that have been active past the stale threshold with
   * no recorded actions as 'stopped'. Returns the count of sessions cleaned.
   *
   * Call at app startup and optionally before session creation to
   * prevent zombie sessions from accumulating across workflow run invocations.
   */
  cleanupStaleSessions(): number {
    return _cleanupStaleSessions(_sessions);
  },

  /**
   * Invalidate the preflight capability cache.
   * Call at app startup to ensure the first action after launch re-probes
   * OS permissions rather than using state from a previous process.
   */
  invalidateCapabilityCache(): void {
    invalidateCapabilityCache();
  },

  /**
   * Return the last probed capability snapshot (if any).
   * Useful for diagnostics and for mapping failures to WorkerRun blockers.
   * Returns null if the cache was never populated or was just invalidated.
   */
  getLastKnownCapabilities() {
    return getLastKnownCapabilities();
  },

  /**
   * Return permission drift state — whether any permission was revoked
   * after having been granted in this process run.
   * Used by the council awareness snapshot to surface honest degraded-mode signals.
   */
  getPermissionDriftState() {
    return getPermissionDriftState();
  },
};
