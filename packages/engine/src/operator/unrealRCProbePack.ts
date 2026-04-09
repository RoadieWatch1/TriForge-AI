// ── operator/unrealRCProbePack.ts — Unreal Remote Control Probe Pack ───────────
//
// Phase 4, Step 3: First editor automation bridge diagnostic.
//
// Probes whether Unreal's Remote Control HTTP plugin is active and reachable
// on the current machine. This is the first step toward deterministic in-editor
// automation — it answers the capability question before any RC command is sent.
//
// TRULY IMPLEMENTED:
//   - Bootstrap readiness gate (editor must be running)
//   - HTTP GET probe to http://localhost:30010/remote/info
//   - Outcome classification: available | unavailable | blocked | unexpected_response
//   - ECONNREFUSED / timeout / unknown-response distinction
//   - RC signature detection from response body
//   - Structured probe result with endpoint, status code, details, warnings
//   - Durable unreal_rc_probe_report artifact via WorkerRun
//
// NOT YET:
//   - Authenticated probe (custom API key)
//   - Remote preset / object enumeration
//   - Blueprint creation via RC commands
//   - Property mutation commands
//   - Plugin install / enable flows
//   - Alternative port discovery

import type { WorkflowPack } from './workflowPackTypes';

// ── Result types ──────────────────────────────────────────────────────────────

/**
 * Top-level outcome of the Remote Control probe.
 *
 *   'available'            — RC endpoint reachable and response is recognizable
 *   'unavailable'          — port refused or timed out; RC not accessible
 *   'blocked'              — bootstrap blocked; probe not attempted
 *   'unexpected_response'  — port open but response does not match RC signature
 */
export type UnrealRCProbeOutcome =
  | 'available'
  | 'unavailable'
  | 'blocked'
  | 'unexpected_response';

/**
 * Structured output of the Unreal Remote Control Probe Pack.
 * Embedded in the unreal_rc_probe_report artifact.
 */
export interface UnrealRCProbeResult {
  outcome: UnrealRCProbeOutcome;
  /** Full URL probed (e.g. http://localhost:30010/remote/info). */
  endpoint?: string;
  /** HTTP status code received (undefined if connection failed). */
  httpStatus?: number;
  /** True if a TCP connection was established to the port. */
  reachable: boolean;
  /** True if the response body contained recognizable Unreal RC fields. */
  rcSignatureFound: boolean;
  /** Whether the editor was running at probe time. */
  editorRunning?: boolean;
  projectName?: string;
  projectPath?: string;
  /** Probe duration in milliseconds. */
  durationMs?: number;
  /** Ordered detail lines — what the probe attempted and observed. */
  details: string[];
  /** Non-blocking notes (e.g. ambiguous response). */
  warnings: string[];
  /**
   * Human-readable guidance on what this outcome means for future automation.
   * Surfaced in Sessions and council context.
   */
  automationImplication: string;
}

// ── Pack definition ───────────────────────────────────────────────────────────

/**
 * Unreal Remote Control Probe Pack.
 *
 * Determines whether the Unreal editor's HTTP Remote Control plugin is active
 * and reachable. This is a capability diagnostic — it does not send automation
 * commands or create editor assets.
 *
 * Flow:
 *   1. List running apps + get frontmost (awareness context)
 *   2. Run Unreal Bootstrap gate — STOP if blocked
 *   3. Probe http://localhost:30010/remote/info with a 3-second timeout
 *   4. Classify: available | unavailable | unexpected_response
 *   5. Assemble durable unreal_rc_probe_report artifact
 *
 * Outcomes and their implications:
 *   available            → RC bridge is usable; future packs can send editor commands
 *   unavailable          → Remain on file-generation / operator-assisted path
 *   unexpected_response  → Something is on the port but not Unreal RC; investigate
 *   blocked              → Editor not running; probe not attempted
 */
export const UNREAL_RC_PROBE: WorkflowPack = {
  id:       'pack.unreal-rc-probe',
  name:     'Unreal RC Probe',
  tagline:  'Check whether the Unreal Remote Control HTTP API is reachable.',
  description:
    'Probes the Unreal Engine Remote Control HTTP plugin endpoint ' +
    '(http://localhost:30010/remote/info) to determine whether the editor ' +
    'exposes a deterministic machine automation surface on this machine. ' +
    'Returns a structured result classifying the probe as: available ' +
    '(RC active and responding), unavailable (port refused or timed out), ' +
    'or unexpected_response (port open but not recognizable as Unreal RC). ' +
    'Each outcome includes an automation implication — whether future packs ' +
    'can use editor-side RC commands, or should remain on the file-generation path. ' +
    'No editor commands are sent — this is a capability diagnostic only. ' +
    'Emits a durable unreal_rc_probe_report artifact.',
  category: 'diagnostic',
  version:  '1.0.0',
  requirements: {
    platforms:        ['macOS', 'Windows'],
    capabilities:     [],
    permissions:      {},
    targetApp:        null,
    providerRequired: false,
  },
  phases: [
    {
      id:          'list-apps',
      name:        'List Running Apps',
      description: 'Gathers the current running-app state for Unreal awareness context.',
      kind:        'list_apps',
      requiresApproval: false,
      onFailure:   'warn_continue',
    },
    {
      id:          'get-frontmost',
      name:        'Get Frontmost App',
      description: 'Reads the currently focused app for awareness context.',
      kind:        'get_frontmost',
      requiresApproval: false,
      onFailure:   'warn_continue',
      optional:    true,
    },
    {
      id:          'unreal-bootstrap-preflight',
      name:        'Unreal Bootstrap Preflight',
      description:
        'Runs the Unreal Bootstrap readiness evaluator. ' +
        'If the editor is not running, the probe is blocked — there is ' +
        'nothing to probe and the result would be misleading.',
      kind:        'unreal_bootstrap_check',
      requiresApproval: false,
      onFailure:   'stop',
    },
    {
      id:          'unreal-rc-probe',
      name:        'Probe Remote Control Endpoint',
      description:
        'Sends a GET request to http://localhost:30010/remote/info with a ' +
        '3-second timeout. Classifies the response as available, unavailable, ' +
        'or unexpected, and records an automation implication.',
      kind:        'unreal_rc_probe',
      requiresApproval: false,
      onFailure:   'warn_continue',   // Probe failure is a valid diagnostic result
    },
    {
      id:          'report',
      name:        'Build RC Probe Report',
      description: 'Assembles the probe outcome, endpoint, status, and implication into a durable artifact.',
      kind:        'report',
      requiresApproval: false,
      onFailure:   'warn_continue',
    },
  ],
  tags: [
    'unreal', 'unreal-engine', 'remote-control', 'rc', 'probe',
    'diagnostic', 'automation', 'http', 'plugin', 'bridge',
  ],
  estimatedDurationSec: 8,
  successCriteria:
    'A structured probe result is returned with an honest outcome classification. ' +
    'Success even when outcome is "unavailable" — the honest probe report IS the deliverable.',
};
