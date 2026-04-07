// ── awareness/desktopActionContext.ts — Desktop Action Context & Actionability ─
//
// Implements the Council Capability-Awareness Spec (Section 12).
//
// Exports:
//   • ActionabilityClass  — 8-class request classification (spec §6)
//   • ActionabilityResult — classification + reason + recommended next step
//   • classifyActionability() — classify a user message against operator state
//   • buildDesktopContextSection() — compact text section for the council addendum
//
// Design goals:
//   • Pure functions — no singletons, no side effects
//   • Honest — reflects real capability/permission/trust state, never claims more
//   • Compact — the generated text section fits within the 500-token addendum budget
//   • Aligned with spec §5 language rules: supervised, approval-first, visible

import type { DesktopOperatorSnapshot } from './types';

// ── ActionabilityClass ────────────────────────────────────────────────────────

/**
 * How the council classifies the actionability of a user request.
 *
 * Applied in the reasoning order defined in spec §4:
 *   1. No action needed → CHAT_ONLY
 *   2. Actionable in theory but blocked → PLAN_ONLY
 *   3. Kill switch off → TRUST_BLOCKED
 *   4. Platform unsupported → CAPABILITY_BLOCKED
 *   5. Runtime blocked (session invalid, preflight failed, permission drift) → RUNTIME_BLOCKED
 *   6. Permissions missing → PERMISSION_BLOCKED
 *   7. Workflow pack available → WORKFLOW_READY
 *   8. Approval gate required → APPROVAL_REQUIRED
 *   9. Direct operator path ready → OPERATOR_READY
 *  10. Target mismatch / drift → TARGET_BLOCKED
 */
export type ActionabilityClass =
  | 'CHAT_ONLY'          // Pure reasoning — no desktop action needed or implied
  | 'PLAN_ONLY'          // Can plan but cannot safely execute yet
  | 'WORKFLOW_READY'     // A matching workflow pack is available and requirements are met
  | 'OPERATOR_READY'     // A direct operator action path exists and is safe to propose
  | 'APPROVAL_REQUIRED'  // Execution path exists but user approval is required first
  | 'PERMISSION_BLOCKED' // OS/app permissions are missing
  | 'CAPABILITY_BLOCKED' // The needed capability is not yet implemented
  | 'TRUST_BLOCKED'      // Kill switch, risk policy, or trust rules prevent execution
  | 'RUNTIME_BLOCKED'    // Session invalid, stale, preflight blocked, or permission drift detected
  | 'TARGET_BLOCKED';    // Intended target app is not frontmost, mismatched, or drifted

export interface ActionabilityResult {
  classification: ActionabilityClass;
  reason: string;
  /** What the council should do or say next */
  nextStep: string;
}

// ── Keyword bank for desktop/operator intent signals ─────────────────────────

const OPERATOR_SIGNAL_KW = [
  // Input
  'type', 'click', 'press', 'keystroke', 'keyboard',
  // App control
  'open app', 'launch app', 'focus app', 'focus window', 'switch app',
  'switch to', 'bring up', 'bring forward',
  // Perception
  'screenshot', 'take a screenshot', 'capture screen', 'capture the screen',
  'what is on my screen', 'what\'s on my screen',
  // Desktop context
  'on my desktop', 'on my computer', 'on my mac', 'on my machine',
  'in the app', 'in the window', 'in the background',
  // Operator / workflow vocabulary
  'operator', 'workflow pack', 'run workflow', 'start workflow',
  'supervised', 'automate', 'perform on desktop',
  'control my desktop', 'desktop control',
];

function matchesAny(msg: string, kws: string[]): boolean {
  return kws.some(k => msg.includes(k));
}

// ── classifyActionability ─────────────────────────────────────────────────────

/**
 * Classify the actionability of a user message against the current operator
 * context. Implements the 4-step reasoning order from spec §4.
 *
 * @param message  The raw user message (will be lowercased internally).
 * @param context  Live desktop operator snapshot from SystemStateService.
 */
export function classifyActionability(
  message: string,
  context: DesktopOperatorSnapshot,
): ActionabilityResult {
  const lower = message.toLowerCase();
  const needsDesktop = matchesAny(lower, OPERATOR_SIGNAL_KW);

  // Step 1 — No desktop action implied
  if (!needsDesktop) {
    return {
      classification: 'CHAT_ONLY',
      reason: 'No desktop action required by this request.',
      nextStep: 'Respond directly from reasoning.',
    };
  }

  // Step 2 — Kill switch
  if (!context.operatorEnabled) {
    return {
      classification: 'TRUST_BLOCKED',
      reason: 'Operator execution is disabled. The kill switch is currently active.',
      nextStep: 'Inform the user. Suggest enabling the operator in Settings → Operate.',
    };
  }

  // Step 3 — Platform support
  if (!context.platformSupported) {
    return {
      classification: 'CAPABILITY_BLOCKED',
      reason: 'Desktop operator is not supported on this platform. macOS is required.',
      nextStep: 'Explain the platform limitation. Offer to plan the steps instead.',
    };
  }

  // Step 4 — Runtime health (preflight blocked, session invalid, permission drift)
  if (context.preflightReadiness === 'blocked') {
    // Distinguish permission drift (was granted, now revoked) from other blocks
    const drift = context.permissionDrift;
    if (drift?.accessibilityRevoked || drift?.screenRecordingRevoked) {
      const which = [
        drift.accessibilityRevoked   ? 'Accessibility'    : '',
        drift.screenRecordingRevoked ? 'Screen Recording' : '',
      ].filter(Boolean).join(' and ');
      return {
        classification: 'RUNTIME_BLOCKED',
        reason: `Permission drift detected: ${which} was granted but has been revoked. Operator actions cannot execute.`,
        nextStep: `Ask the user to re-grant ${which} in System Settings → Privacy & Security. No actions can execute until restored.`,
      };
    }
    return {
      classification: 'RUNTIME_BLOCKED',
      reason: 'Operator preflight check failed — execution is blocked. Permissions or session state is invalid.',
      nextStep: 'Inform the user that the operator substrate is currently blocked. Suggest checking System Settings → Privacy & Security and restarting the session.',
    };
  }

  if (context.sessionValid === false) {
    return {
      classification: 'RUNTIME_BLOCKED',
      reason: 'No valid operator session is active. The session may be stale or was stopped.',
      nextStep: 'Inform the user. Input actions cannot execute without an active session. Suggest starting a new operator session in Operate → Sessions.',
    };
  }

  // Step 5 — Workflow pack available?
  if (context.workflowsAvailable.length > 0) {
    if (context.permissionsMissing.length > 0) {
      return {
        classification: 'PERMISSION_BLOCKED',
        reason: `Missing OS permissions: ${context.permissionsMissing.join(', ')}.`,
        nextStep: `Ask the user to grant ${context.permissionsMissing.join(' and ')} in System Settings → Privacy & Security.`,
      };
    }
    return {
      classification: 'WORKFLOW_READY',
      reason: 'A supervised workflow pack can carry out this request.',
      nextStep: 'Guide the user to Operate → Workflow Packs. Select the best matching pack.',
    };
  }

  // Step 5 — Direct operator path
  if (context.availableCapabilities.length > 0) {
    if (context.approvalRequiredFor.some(a => lower.includes(a.replace('_', ' ')))) {
      return {
        classification: 'APPROVAL_REQUIRED',
        reason: `This action (${context.approvalRequiredFor.join(', ')}) always requires explicit user approval before it executes.`,
        nextStep: 'Queue the action for approval. Direct the user to Sessions → Pending Approvals.',
      };
    }
    return {
      classification: 'OPERATOR_READY',
      reason: 'An operator action path exists and permissions are satisfied.',
      nextStep: 'Propose the supervised action in Operate. Confirm before executing.',
    };
  }

  // Step 6 — Capability not yet implemented
  return {
    classification: 'CAPABILITY_BLOCKED',
    reason: 'The desktop capability needed for this request is not yet implemented.',
    nextStep: 'Provide a plan instead. Describe what capability would be required and what the steps would be.',
  };
}

// ── buildDesktopContextSection ────────────────────────────────────────────────

/**
 * Build the desktop operator context section injected into the council addendum.
 *
 * Compact format — must stay within the overall < 500-token addendum budget.
 * Called from CouncilAwarenessService when a DesktopOperatorSnapshot is available.
 */
export function buildDesktopContextSection(op: DesktopOperatorSnapshot): string {
  const killState   = op.operatorEnabled ? 'enabled' : 'DISABLED (kill switch active)';
  const platform    = op.platformSupported ? 'macOS' : 'unsupported platform';
  const permGranted = op.permissionsGranted.length > 0 ? op.permissionsGranted.join(', ') : 'none';
  const permMissing = op.permissionsMissing.length > 0 ? op.permissionsMissing.join(', ') : 'none';

  const lines: string[] = [
    '',
    '## Desktop Operator State',
    `Operator: ${killState} | Platform: ${platform}`,
    `Permissions granted: ${permGranted} | Missing: ${permMissing}`,
  ];

  // Preflight readiness
  if (op.preflightReadiness !== undefined) {
    const readinessLabel =
      op.preflightReadiness === 'ready'    ? 'READY' :
      op.preflightReadiness === 'degraded' ? 'DEGRADED (some capabilities unavailable)' :
                                             'BLOCKED (execution halted)';
    lines.push(`Preflight: ${readinessLabel}`);
  }

  // Permission drift — riskiest state, call it out explicitly
  if (op.permissionDrift) {
    const revokedParts: string[] = [];
    if (op.permissionDrift.accessibilityRevoked)   revokedParts.push('Accessibility');
    if (op.permissionDrift.screenRecordingRevoked) revokedParts.push('Screen Recording');
    if (revokedParts.length > 0) {
      lines.push(`PERMISSION DRIFT: ${revokedParts.join(', ')} was granted earlier but is now revoked. Input/screenshot actions are blocked.`);
    }
  }

  // Session validity
  if (op.sessionValid === false) {
    lines.push('Session: INVALID or stale — input actions cannot execute without a valid active session.');
  } else if (op.sessionValid === true) {
    lines.push('Session: active');
  }

  if (op.availableCapabilities.length > 0) {
    lines.push(`Actions ready: ${op.availableCapabilities.join(', ')}`);
  }

  if (op.missingCapabilities.length > 0) {
    lines.push(`Actions blocked (missing permission): ${op.missingCapabilities.join(', ')}`);
  }

  if (op.approvalRequiredFor.length > 0) {
    lines.push(`Always requires approval: ${op.approvalRequiredFor.join(', ')}`);
  }

  if (op.workflowsAvailable.length > 0) {
    lines.push(`Workflow packs: ${op.workflowsAvailable.join(', ')}`);
  }

  lines.push('');
  lines.push(
    'Operator rule: Classify every desktop request as ' +
    'CHAT_ONLY / PLAN_ONLY / WORKFLOW_READY / OPERATOR_READY / ' +
    'APPROVAL_REQUIRED / PERMISSION_BLOCKED / CAPABILITY_BLOCKED / TRUST_BLOCKED / ' +
    'RUNTIME_BLOCKED / TARGET_BLOCKED. ' +
    'Never claim unrestricted desktop control. ' +
    'If operator is disabled or RUNTIME_BLOCKED, no actions can execute — state this honestly. ' +
    'Input actions (type_text, send_key) ALWAYS require explicit user approval. ' +
    'Missing or revoked permissions must be named and surfaced. ' +
    'Route approvals through Sessions. Route workflow execution through Operate.',
  );

  return lines.join('\n');
}
