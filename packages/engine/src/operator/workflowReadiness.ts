// ── operator/workflowReadiness.ts ─────────────────────────────────────────────
//
// Section 9 — Workflow Packs: Readiness Evaluation
//
// Pure function — no side effects, no imports of desktop services.
// Takes a workflow pack + capability map + optional running-apps list.
// Returns a structured readiness result with blockers and warnings.
//
// Used by:
//   - workflowPackService.ts (before starting a run)
//   - IPC handler 'workflow:readiness' (for UI readiness cards)

import type { WorkflowPack, WorkflowReadinessResult, WorkflowBlocker } from './workflowPackTypes';
import type { OperatorCapabilityMap } from './operatorTypes';

/**
 * Evaluate whether a workflow pack can run given the current machine state.
 *
 * @param pack           The workflow pack to evaluate
 * @param capabilityMap  The result of OperatorService.getCapabilityMap()
 * @param runningApps    The result of OperatorService.listRunningApps() (optional)
 */
export function evaluateWorkflowReadiness(
  pack: WorkflowPack,
  capabilityMap: OperatorCapabilityMap,
  runningApps?: string[],
): WorkflowReadinessResult {
  const blockers: WorkflowBlocker[] = [];
  const warnings: string[] = [];

  // ── Platform check ──────────────────────────────────────────────────────────

  const platformSupported =
    pack.requirements.platforms.length === 0 ||
    pack.requirements.platforms.includes(capabilityMap.platform);

  if (!platformSupported) {
    blockers.push({
      type: 'platform_unsupported',
      message:
        `"${pack.name}" requires ${pack.requirements.platforms.join(' or ')}, ` +
        `but this machine is running ${capabilityMap.platform}.`,
      remediation:
        pack.requirements.platforms.includes('macOS')
          ? 'This workflow requires macOS. It is not available on the current platform.'
          : 'This workflow is not available on the current platform.',
    });
  }

  // ── Permission checks ────────────────────────────────────────────────────────

  let permissionsOk = true;

  // Windows uses PowerShell — no separate OS permission grants needed.
  // Only apply macOS-specific permission checks when actually on macOS.
  if (capabilityMap.platform !== 'Windows') {
    if (pack.requirements.permissions.accessibility && !capabilityMap.accessibilityGranted) {
      permissionsOk = false;
      blockers.push({
        type: 'permission_missing',
        message: `"${pack.name}" requires macOS Accessibility permission, which is not granted.`,
        remediation:
          'Open System Settings → Privacy & Security → Accessibility and add TriForge to the list.',
      });
    }

    if (pack.requirements.permissions.screenRecording && !capabilityMap.canCaptureScreen) {
      permissionsOk = false;
      blockers.push({
        type: 'permission_missing',
        message: `"${pack.name}" requires macOS Screen Recording permission, which is not granted.`,
        remediation:
          'Open System Settings → Privacy & Security → Screen Recording and add TriForge to the list.',
      });
    }
  } else {
    // Windows: if screenshot is needed but canCaptureScreen is false, warn (not block)
    if (pack.requirements.permissions.screenRecording && !capabilityMap.canCaptureScreen) {
      warnings.push(
        'Screenshot capability is unavailable on this Windows machine. ' +
        'Ensure .NET Framework and user32.dll are accessible.',
      );
    }
  }

  // ── Capability checks ────────────────────────────────────────────────────────

  let capabilitiesOk = true;

  const CAPABILITY_AVAILABLE: Record<string, boolean> = {
    list_apps:     capabilityMap.canListRunningApps,
    get_frontmost: capabilityMap.canGetFrontmostApp,
    focus_app:     capabilityMap.canFocusApp,
    screenshot:    capabilityMap.canCaptureScreen,
    type_text:     capabilityMap.canTypeText,
    send_key:      capabilityMap.canSendKeystroke,
  };

  for (const cap of pack.requirements.capabilities) {
    const available = CAPABILITY_AVAILABLE[cap];
    if (available === false) {
      capabilitiesOk = false;
      const friendlyName = cap.replace(/_/g, ' ');

      if (cap === 'screenshot' && !capabilityMap.screenRecordingGranted) {
        // Already covered by permission check — don't double-report
        continue;
      }
      if ((cap === 'type_text' || cap === 'send_key') && !capabilityMap.accessibilityGranted) {
        // Already covered by permission check — don't double-report
        continue;
      }

      blockers.push({
        type: 'capability_unavailable',
        message: `The "${friendlyName}" capability is not available on this platform (${capabilityMap.platform}).`,
        remediation: 'This capability requires macOS or Windows with PowerShell access.',
      });
    }
  }

  // ── Target app check ─────────────────────────────────────────────────────────

  let targetAppAvailable: boolean | null = null;

  if (pack.requirements.targetApp && runningApps) {
    const targetLower = pack.requirements.targetApp.toLowerCase();
    targetAppAvailable = runningApps.some(app => app.toLowerCase().includes(targetLower));
    if (!targetAppAvailable) {
      blockers.push({
        type: 'app_not_running',
        message: `"${pack.requirements.targetApp}" does not appear to be running.`,
        remediation: `Launch "${pack.requirements.targetApp}" before starting this workflow.`,
      });
    }
  } else if (pack.requirements.targetApp) {
    // Can't check without runningApps — emit a warning
    warnings.push(
      `Cannot verify whether "${pack.requirements.targetApp}" is running without a running-apps list.`,
    );
  }

  // ── Optional capability warnings ─────────────────────────────────────────────

  if (
    pack.requirements.capabilities.includes('screenshot') &&
    !capabilityMap.canCaptureScreen &&
    !pack.requirements.permissions.screenRecording
  ) {
    // Pack wants screenshots but doesn't strictly require the permission
    warnings.push(
      'Screenshot steps will be skipped — Screen Recording permission is not granted. ' +
      'Grant it in System Settings for full functionality.',
    );
  }

  // ── Result ────────────────────────────────────────────────────────────────────

  return {
    packId:              pack.id,
    ready:               blockers.length === 0,
    blockers,
    warnings,
    platformSupported,
    permissionsOk,
    capabilitiesOk,
    targetAppAvailable,
  };
}

/**
 * Quick convenience: evaluate readiness for all packs and return a map.
 * Useful for the Operate UI readiness panel.
 */
export function evaluateAllPackReadiness(
  packs: WorkflowPack[],
  capabilityMap: OperatorCapabilityMap,
  runningApps?: string[],
): Map<string, WorkflowReadinessResult> {
  const results = new Map<string, WorkflowReadinessResult>();
  for (const pack of packs) {
    results.set(pack.id, evaluateWorkflowReadiness(pack, capabilityMap, runningApps));
  }
  return results;
}
