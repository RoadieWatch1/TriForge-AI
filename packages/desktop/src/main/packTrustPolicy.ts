/**
 * packTrustPolicy.ts — Phase 36
 *
 * Evaluate the workspace trust policy against a pack's trust verification
 * result and its computed diff, producing a structured decision:
 *   - `blocked`        — the policy hard-blocks this install/update
 *   - `requireConfirm` — the user must acknowledge soft warnings before proceeding
 *   - `confirmReasons` — list of human-readable warnings to display
 */

import type { PackTrustVerification, PackTrustPolicy, PackDiff } from './runbookPack';

export interface PolicyDecision {
  blocked:        boolean;
  blockReason?:   string;
  requireConfirm: boolean;
  confirmReasons: string[];
}

/**
 * Evaluate the workspace trust policy.
 *
 * @param trust      Result of signature verification.
 * @param diff       Optional semantic diff (present on updates, absent on fresh installs).
 * @param policy     Workspace policy object.
 * @param isUpdate   Whether this is an update to an existing installed pack.
 */
export function evaluateTrustPolicy(
  trust:    PackTrustVerification,
  diff:     PackDiff | undefined,
  policy:   PackTrustPolicy,
  isUpdate: boolean,
): PolicyDecision {
  const confirmReasons: string[] = [];

  // ── Hard blocks ────────────────────────────────────────────────────────────

  if (trust.status === 'invalid') {
    return {
      blocked: true,
      blockReason: 'Signature verification failed — the pack may have been tampered with.',
      requireConfirm: false,
      confirmReasons: [],
    };
  }

  if (trust.status === 'revoked') {
    return {
      blocked: true,
      blockReason: `Signer key "${trust.keyId}" has been revoked and is no longer trusted.`,
      requireConfirm: false,
      confirmReasons: [],
    };
  }

  if (trust.status === 'unsigned' && !policy.allowUnsigned) {
    return {
      blocked: true,
      blockReason: 'This workspace requires all packs to be signed. This pack has no signature.',
      requireConfirm: false,
      confirmReasons: [],
    };
  }

  if (trust.status === 'unknown_signer' && !policy.allowUnknownSigners) {
    return {
      blocked: true,
      blockReason: `Signer "${trust.signerName ?? trust.keyId}" is not in the workspace trusted signers list.`,
      requireConfirm: false,
      confirmReasons: [],
    };
  }

  if (policy.requireAdminApprovalForInstall && !isUpdate) {
    return {
      blocked: true,
      blockReason: 'Workspace policy requires admin approval before installing new packs.',
      requireConfirm: false,
      confirmReasons: [],
    };
  }

  if (diff && policy.blockNewDestinations && diff.destinationsAdded.length > 0) {
    return {
      blocked: true,
      blockReason: `Pack update introduces new output destinations (${diff.destinationsAdded.join(', ')}) which are blocked by workspace policy.`,
      requireConfirm: false,
      confirmReasons: [],
    };
  }

  // ── Soft warnings (require user acknowledgement) ───────────────────────────

  if (trust.status === 'unsigned') {
    confirmReasons.push('This pack is unsigned — its origin cannot be cryptographically verified.');
  }

  if (trust.status === 'unknown_signer') {
    confirmReasons.push(
      `Signer "${trust.signerName ?? trust.keyId}" is not in your trusted signers list.`,
    );
  }

  if (diff) {
    if (policy.requireConfirmOnRiskIncrease && diff.riskIncreased) {
      confirmReasons.push(
        'This update increases risk: new integrations or output destinations are introduced.',
      );
    }

    if (diff.destinationsAdded.length > 0) {
      confirmReasons.push(
        `New output destinations: ${diff.destinationsAdded.join(', ')}.`,
      );
    }

    if (diff.incidentModeChanged) {
      confirmReasons.push('Incident-mode configuration changes in this update.');
    }

    const removed = diff.runbooks.filter(r => r.isRemoved);
    if (removed.length > 0) {
      confirmReasons.push(
        `${removed.length} runbook${removed.length > 1 ? 's' : ''} will be removed: ${removed.map(r => r.title).join(', ')}.`,
      );
    }
  }

  return {
    blocked:        false,
    requireConfirm: confirmReasons.length > 0,
    confirmReasons,
  };
}
