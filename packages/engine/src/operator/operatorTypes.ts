// ── operator/operatorTypes.ts ─────────────────────────────────────────────────
//
// Section 8 — Desktop Operator Engine: Core Contracts
//
// These types define the honest operator substrate contracts for TriForge.
// They deliberately separate what is truly implemented from what is scaffolded.
//
// Implementation status (macOS):
//   REAL now:  app/window targeting, screen capture, keyboard input (via osascript)
//   PARTIAL:   mouse click at coords (scaffolded, not wired — needs coords from perception)
//   NOT YET:   OCR, cross-app UI parsing, Windows/Linux targeting, pixel-level action

// ── Platform ──────────────────────────────────────────────────────────────────

export type OperatorPlatform = 'macOS' | 'Windows' | 'Linux' | 'unknown';

// ── Target: what app/window is being operated ─────────────────────────────────

export interface OperatorTarget {
  /** Display name of the application (e.g. "Google Chrome") */
  appName: string;
  /** Title of the frontmost window, if readable */
  windowTitle?: string;
  /** macOS process ID */
  pid?: number;
  /** macOS bundle identifier, if read (e.g. "com.google.Chrome") */
  bundleId?: string;
  /** Whether the engine positively confirmed this is the intended target */
  confirmed: boolean;
  /** When this target snapshot was captured */
  capturedAt: number;
}

// ── Perception: what the engine can see about current machine state ────────────

export interface OperatorPerception {
  timestamp: number;
  /** The frontmost app/window at perception time */
  target: OperatorTarget | null;
  /** Absolute path to a saved screenshot file, if a screenshot was taken */
  screenshotPath?: string;
  /** Whether the screenshot includes all displays or just primary */
  screenshotScope?: 'primary_display' | 'all_displays';
  /** Raw extracted text from the screenshot via OCR — NOT YET IMPLEMENTED */
  ocrText?: string;
  /** Human-readable note explaining what the engine observed */
  summary?: string;
}

// ── Action: what the engine can execute ───────────────────────────────────────

export type OperatorActionType =
  | 'focus_app'      // Bring a named app to the foreground
  | 'get_frontmost'  // Query which app is currently focused (read-only)
  | 'list_apps'      // List all visible running apps (read-only)
  | 'screenshot'     // Capture the current screen to a file
  | 'type_text'      // Type a string into the currently focused window
  | 'send_key';      // Send a named key + optional modifiers

export interface OperatorAction {
  /** Unique ID for this action instance */
  id: string;
  type: OperatorActionType;
  /** App name for focus_app */
  target?: string;
  /** Text to type for type_text */
  text?: string;
  /**
   * Key name for send_key.
   * Accepts macOS key names: "return", "escape", "tab", "space",
   * "delete", "f1"–"f12", "up", "down", "left", "right", letter/number chars.
   */
  key?: string;
  /** Modifier keys for send_key */
  modifiers?: Array<'cmd' | 'shift' | 'alt' | 'ctrl'>;
  /** Output file path for screenshot (defaults to system temp dir) */
  outputPath?: string;
  /** Operator session this action belongs to */
  sessionId: string;
  /** When this action was requested */
  requestedAt: number;
}

// ── Risk classification ───────────────────────────────────────────────────────

/**
 * Honest risk levels for operator actions.
 * Used to decide approval gating before execution.
 *
 * read_only    — observes machine state, changes nothing
 * focus_only   — switches window focus, non-destructive
 * input_action — types or sends keys into another app (requires approval)
 */
export type OperatorActionRisk = 'read_only' | 'focus_only' | 'input_action';

export const OPERATOR_ACTION_RISKS: Record<OperatorActionType, OperatorActionRisk> = {
  get_frontmost: 'read_only',
  list_apps:     'read_only',
  screenshot:    'read_only',
  focus_app:     'focus_only',
  type_text:     'input_action',
  send_key:      'input_action',
};

/**
 * Which actions must be explicitly approved before execution.
 * Input actions always require approval — they directly manipulate another app.
 */
export const OPERATOR_REQUIRES_APPROVAL: Record<OperatorActionType, boolean> = {
  get_frontmost: false,
  list_apps:     false,
  screenshot:    false,
  focus_app:     false,
  type_text:     true,
  send_key:      true,
};

// ── Action Result ─────────────────────────────────────────────────────────────

export type OperatorOutcome =
  | 'success'             // Action completed as intended
  | 'failed'              // Action attempted but produced an error
  | 'permission_denied'   // macOS Accessibility or Screen Recording not granted
  | 'target_not_found'    // Named app is not running or not focusable
  | 'wrong_target'        // Frontmost app changed between request and execution
  | 'timeout'             // Action did not complete within allowed time
  | 'approval_pending'    // Queued — waiting for human approval
  | 'approval_denied'     // Human denied the approval request
  | 'not_supported';      // This action is not supported on the current platform

export interface OperatorActionResult {
  actionId: string;
  actionType: OperatorActionType;
  outcome: OperatorOutcome;
  /** The target at the time of execution */
  executedTarget?: OperatorTarget;
  /** For screenshot actions — absolute path to the saved file */
  outputPath?: string;
  /** For list_apps — the returned app names */
  apps?: string[];
  /** How long the action took */
  durationMs: number;
  error?: string;
  /** What the caller should do next given this outcome */
  recoveryHint?: string;
  /** When execution completed (or was rejected) */
  completedAt: number;
  /** Approval ID if approval was required and is pending/resolved */
  approvalId?: string;
}

// ── Recovery contract ─────────────────────────────────────────────────────────

export interface OperatorRecoveryBehavior {
  onPermissionDenied: 'stop' | 'request_permission' | 'ask_user';
  onTargetNotFound:   'stop' | 'list_alternatives'  | 'ask_user';
  onWrongTarget:      'stop' | 'reconfirm'          | 'ask_user';
  onTimeout:          'stop' | 'retry_once'         | 'ask_user';
  onUnknownState:     'stop' | 'screenshot_and_report' | 'ask_user';
}

export const DEFAULT_RECOVERY: OperatorRecoveryBehavior = {
  onPermissionDenied: 'ask_user',
  onTargetNotFound:   'list_alternatives',
  onWrongTarget:      'reconfirm',
  onTimeout:          'retry_once',
  onUnknownState:     'screenshot_and_report',
};

// ── Capability map — honest statement of what this platform can do ────────────

export interface OperatorCapabilityMap {
  platform: OperatorPlatform;

  // ── Targeting
  /** Can enumerate visible running applications */
  canListRunningApps: boolean;
  /** Can query which app is currently in the foreground */
  canGetFrontmostApp: boolean;
  /** Can bring a named app to the foreground */
  canFocusApp: boolean;

  // ── Perception
  /** Can capture a screenshot of the primary display */
  canCaptureScreen: boolean;
  /** Can read the frontmost window's title */
  canReadWindowTitle: boolean;
  /**
   * Can perform OCR on a captured screenshot.
   * FALSE — not yet implemented. Placeholder for future integration.
   */
  canOCRScreen: boolean;

  // ── Input execution
  /** Can type text into the currently focused window */
  canTypeText: boolean;
  /** Can send keyboard shortcuts to the currently focused window */
  canSendKeystroke: boolean;
  /**
   * Can click at specific pixel coordinates.
   * FALSE — not yet implemented. Requires coordinate resolution from perception.
   */
  canClickAtCoords: boolean;

  // ── Permissions (macOS-specific)
  /**
   * macOS Accessibility permission (System Settings → Privacy & Security).
   * Required for typeText and sendKey. Must be granted manually.
   */
  accessibilityGranted: boolean;
  /**
   * macOS Screen Recording permission.
   * Required for screenshot capture since macOS 10.15 Catalina.
   */
  screenRecordingGranted: boolean;

  // ── Honesty notes
  /** Plain-English explanation of current capability boundaries */
  notes: string[];
}

// ── Operator session ──────────────────────────────────────────────────────────

/**
 * An operator session groups a sequence of related operator actions.
 * Sessions tie back to the Sessions surface in the desktop app.
 */
export interface OperatorSession {
  id: string;
  startedAt: number;
  /** The intended target app for this session */
  intendedTarget: string | null;
  /** The confirmed target at the time of the last perception */
  confirmedTarget: OperatorTarget | null;
  /** Ordered log of actions and their results */
  actions: OperatorSessionEntry[];
  status: 'active' | 'completed' | 'failed' | 'stopped';
  stopReason?: string;
  endedAt?: number;
}

export interface OperatorSessionEntry {
  action: OperatorAction;
  result: OperatorActionResult;
  perception?: OperatorPerception;
}

// ── Pending approval for operator actions ─────────────────────────────────────

/**
 * An operator-specific approval request.
 * Surfaces through the Operate/Sessions UI for human review before execution.
 */
export interface OperatorApprovalRequest {
  id: string;
  sessionId: string;
  action: OperatorAction;
  risk: OperatorActionRisk;
  /** Plain-English description of what will happen if approved */
  description: string;
  /** Screenshot path captured immediately before this action was queued */
  contextScreenshotPath?: string;
  createdAt: number;
  /** 10-minute TTL — operator approvals are time-sensitive */
  expiresAt: number;
  status: 'pending' | 'approved' | 'denied' | 'expired';
  respondedAt?: number;
  /** Identity token of who approved/denied (e.g. 'local_ui', 'remote_approval_server'). */
  approvedBy?: string;
  denialReason?: string;
}
