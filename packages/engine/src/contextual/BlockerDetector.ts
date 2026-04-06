// ── contextual/BlockerDetector.ts — Section 5 Phase 5: Blocker Detection ──────
//
// Examines fused context + normalized machine state to produce structured
// ReasoningBlocker and ApprovalPoint objects for Section 5.
//
// Pure function. No side effects. No IPC. No async. No runtime calls.
// No plan generation. No explanation generation. No approval workflow wiring.

import type { NormalizedMachineContext } from './MachineContextNormalizer';
import type {
  WorkIntentCategory,
  EnvironmentReadiness,
  ContextFusionResult,
  ReasoningBlocker,
  ApprovalPoint,
} from './types';

// ── Public output shape ───────────────────────────────────────────────────────

export interface BlockerDetectionResult {
  blockers: ReasoningBlocker[];
  approvalPoints: ApprovalPoint[];
  /** Task-aware readiness — may be tighter than fusion-level readiness */
  readiness: EnvironmentReadiness;
}

// ── Public input shape ────────────────────────────────────────────────────────

export interface BlockerDetectionInput {
  fusion: ContextFusionResult;
  machine: NormalizedMachineContext;
}

// ── Internal builder helpers ──────────────────────────────────────────────────

let _blockerSeq = 0;
let _approvalSeq = 0;

function resetSeqs(): void {
  _blockerSeq = 0;
  _approvalSeq = 0;
}

function blocker(
  type: ReasoningBlocker['type'],
  title: string,
  description: string,
  severity: ReasoningBlocker['severity'],
  blocking: boolean,
  options: {
    suggestedResolution?: string;
    relatedKeys?: string[];
  } = {},
): ReasoningBlocker {
  const id = `blocker-${++_blockerSeq}`;
  const b: ReasoningBlocker = { id, type, title, description, severity, blocking };
  if (options.suggestedResolution) b.suggestedResolution = options.suggestedResolution;
  if (options.relatedKeys)         b.relatedKeys = options.relatedKeys;
  return b;
}

function approval(
  stage: ApprovalPoint['stage'],
  title: string,
  description: string,
  required: boolean,
  relatedTool?: string,
): ApprovalPoint {
  const id = `approval-${++_approvalSeq}`;
  const a: ApprovalPoint = { id, stage, title, description, required };
  if (relatedTool) a.relatedTool = relatedTool;
  return a;
}

// ── Readiness adjuster ────────────────────────────────────────────────────────

/**
 * Tighten readiness when high-severity blockers are present for the task's
 * primary requirements. Conservative — only escalates, never inflates.
 */
function adjustReadiness(
  baseReadiness: EnvironmentReadiness,
  blockers: ReasoningBlocker[],
): EnvironmentReadiness {
  const hasHighBlocking = blockers.some((b) => b.severity === 'high' && b.blocking);
  const hasMediumBlocking = blockers.some((b) => b.severity === 'medium' && b.blocking);

  if (hasHighBlocking) return 'blocked';
  if (baseReadiness === 'ready' && hasMediumBlocking) return 'partially_ready';
  return baseReadiness;
}

// ── Missing requirements index ────────────────────────────────────────────────

function hasMissingReq(fusion: ContextFusionResult, key: string): boolean {
  return fusion.missingRequirements.includes(key);
}

function hasAssumption(fusion: ContextFusionResult, fragment: string): boolean {
  return (fusion.assumptions ?? []).some((a) => a.includes(fragment));
}

// ── A. Permission blockers ────────────────────────────────────────────────────

function detectPermissionBlockers(
  fusion: ContextFusionResult,
  machine: NormalizedMachineContext,
): ReasoningBlocker[] {
  const result: ReasoningBlocker[] = [];
  const { permissions } = machine;
  const tools = new Set(fusion.requiredTools);
  const cat = fusion.interpretedTaskType;

  const needsFiles =
    tools.has('files') ||
    hasMissingReq(fusion, 'files_access_likely_needed') ||
    hasMissingReq(fusion, 'files_access_unavailable');

  const needsBrowser =
    tools.has('browser') ||
    hasMissingReq(fusion, 'browser_access_likely_needed') ||
    hasMissingReq(fusion, 'browser_unavailable');

  const needsEmail =
    tools.has('email') ||
    hasMissingReq(fusion, 'email_access_likely_needed') ||
    hasMissingReq(fusion, 'email_unavailable');

  if (needsFiles && permissions.files === false) {
    const isHighSeverity =
      cat === 'file_project_organization' ||
      cat === 'coding_build_debug' ||
      cat === 'app_submission' ||
      cat === 'creative_editing';

    result.push(blocker(
      'missing_permission',
      'File system access unavailable',
      'This task likely requires file system access, but the current environment does not have it granted.',
      isHighSeverity ? 'high' : 'medium',
      true,
      {
        suggestedResolution: 'Grant file system access in TriForge settings before proceeding.',
        relatedKeys: ['files-access'],
      },
    ));
  }

  if (needsBrowser && permissions.browser === false) {
    const isHighSeverity = cat === 'browser_admin_workflow' || cat === 'app_submission';

    result.push(blocker(
      'missing_permission',
      'Browser automation access unavailable',
      'This task likely requires browser access, but it is not currently granted.',
      isHighSeverity ? 'high' : 'medium',
      true,
      {
        suggestedResolution: 'Enable browser access in TriForge settings.',
        relatedKeys: ['browser-access'],
      },
    ));
  }

  if (needsEmail && permissions.email === false) {
    result.push(blocker(
      'missing_permission',
      'Email access unavailable',
      'This task may involve sending or reading email, but email permission is not granted.',
      'medium',
      false,
      {
        suggestedResolution: 'Configure email access in TriForge settings.',
        relatedKeys: ['email-permission', 'email-provider'],
      },
    ));
  }

  return result;
}

// ── B. Provider blockers ──────────────────────────────────────────────────────

function detectProviderBlockers(
  fusion: ContextFusionResult,
  machine: NormalizedMachineContext,
): ReasoningBlocker[] {
  const result: ReasoningBlocker[] = [];
  const { providers } = machine;
  const cat = fusion.interpretedTaskType;
  const tools = new Set(fusion.requiredTools);

  // Browser provider
  if (cat === 'browser_admin_workflow' && !providers.browserReady) {
    // Already covered by permission blocker if files access is also absent —
    // only emit if not already a permission blocker for browser
    if (machine.permissions.browser !== false) {
      result.push(blocker(
        'missing_provider',
        'Browser provider not ready',
        'Browser-based workflow is required but the browser provider is not fully configured.',
        'high',
        true,
        { relatedKeys: ['browser-access'] },
      ));
    }
  }

  // Email provider
  if (
    (cat === 'app_submission' || tools.has('email')) &&
    !providers.emailReady &&
    hasMissingReq(fusion, 'email_unavailable')
  ) {
    result.push(blocker(
      'missing_provider',
      'Email provider not configured',
      'This task may require sending notifications or confirmations via email, but no email provider is configured.',
      'medium',
      false,
      {
        suggestedResolution: 'Connect an email provider in TriForge settings.',
        relatedKeys: ['email-provider'],
      },
    ));
  }

  // Image / creative provider
  if (cat === 'creative_editing' && !providers.imageReady && tools.has('image')) {
    result.push(blocker(
      'missing_provider',
      'Image generation provider unavailable',
      'Creative editing assistance may require an image-capable provider, but none is currently available.',
      'low',
      false,
      {
        suggestedResolution: 'Configure an image-capable provider (OpenAI or Grok) in TriForge settings.',
        relatedKeys: ['image-provider'],
      },
    ));
  }

  return result;
}

// ── C. Missing project / target blockers ──────────────────────────────────────

function detectProjectBlockers(
  fusion: ContextFusionResult,
  machine: NormalizedMachineContext,
): ReasoningBlocker[] {
  const result: ReasoningBlocker[] = [];
  const cat = fusion.interpretedTaskType;
  const { activeContext } = machine;

  const targetNotSpecified = hasMissingReq(fusion, 'target_project_not_specified');
  const workspaceNotConfirmed = hasMissingReq(fusion, 'active_workspace_not_confirmed');
  const creativeAppNotVerified = hasMissingReq(fusion, 'named_creative_app_not_verified');
  const ideNotVerified = hasMissingReq(fusion, 'named_ide_not_verified');

  if (targetNotSpecified) {
    const severity = cat === 'app_submission' ? 'high' : 'medium';
    result.push(blocker(
      'missing_project',
      'Target project not specified',
      'The task requires a specific project or target but none has been identified in the current context.',
      severity,
      severity === 'high',
      {
        suggestedResolution: 'Open or specify the target project before proceeding.',
        relatedKeys: ['active-mission'],
      },
    ));
  }

  if (workspaceNotConfirmed && !targetNotSpecified) {
    result.push(blocker(
      'ambiguous_target',
      'Active workspace not confirmed',
      'The task implies an active project workspace but none could be confirmed from current context.',
      'medium',
      false,
      {
        suggestedResolution: 'Set an active mission or open the relevant project.',
        relatedKeys: ['active-mission', 'active-profile'],
      },
    ));
  }

  // Named app not verified — only a blocker if fusion already lists it as
  // an unmet requirement, not merely an assumption
  if (
    creativeAppNotVerified &&
    cat === 'creative_editing' &&
    machine.permissions.files === false
  ) {
    // The files blocker is more pressing; surface app gap as medium non-blocking
    result.push(blocker(
      'missing_app',
      'Named creative application not verified',
      'A specific creative application was mentioned in the request but cannot be verified as available on this machine.',
      'medium',
      false,
      {
        suggestedResolution: 'Confirm the application is installed and accessible before proceeding.',
      },
    ));
  }

  if (ideNotVerified && cat === 'coding_build_debug') {
    result.push(blocker(
      'missing_app',
      'Named development environment not verified',
      'A specific IDE or development environment was mentioned but cannot be confirmed as available.',
      'medium',
      false,
      {
        suggestedResolution: 'Confirm the IDE is installed and the project is open.',
      },
    ));
  }

  return result;
}

// ── D. No active environment blocker ─────────────────────────────────────────

const CATEGORIES_NEEDING_ACTIVE_CONTEXT: WorkIntentCategory[] = [
  'coding_build_debug',
  'file_project_organization',
  'app_submission',
  'creative_editing',
];

function detectNoActiveEnvBlocker(
  fusion: ContextFusionResult,
  machine: NormalizedMachineContext,
): ReasoningBlocker | null {
  const cat = fusion.interpretedTaskType;
  if (!CATEGORIES_NEEDING_ACTIVE_CONTEXT.includes(cat)) return null;

  const { activeContext } = machine;
  const hasAnyContext =
    activeContext.activeMissionId !== null ||
    activeContext.pendingTasks > 0;

  if (hasAnyContext) return null;

  // Only emit if we don't already have a more specific project/target blocker
  if (
    hasMissingReq(fusion, 'target_project_not_specified') ||
    hasMissingReq(fusion, 'active_workspace_not_confirmed')
  ) {
    return null; // Already covered
  }

  return blocker(
    'no_active_environment',
    'No active project environment detected',
    'This task is most useful within an active project or workspace context, but none could be found.',
    'medium',
    false,
    {
      suggestedResolution: 'Open a project or activate a mission before proceeding.',
      relatedKeys: ['active-mission', 'active-profile'],
    },
  );
}

// ── E. Readiness gap blocker ──────────────────────────────────────────────────

function detectReadinessGapBlocker(
  fusion: ContextFusionResult,
  existingBlockerCount: number,
): ReasoningBlocker | null {
  // Only emit a summary gap blocker when the environment is broadly impaired
  // and we don't already have multiple specific blockers covering the same ground
  const { readiness } = fusion;

  if (readiness === 'ready') return null;
  if (existingBlockerCount >= 2) return null; // Specific blockers already tell the story

  if (readiness === 'blocked') {
    return blocker(
      'readiness_gap',
      'Environment broadly unavailable for this task',
      'Multiple required capabilities are unavailable in the current environment, making this task difficult to proceed with.',
      'high',
      true,
      {
        suggestedResolution: 'Review TriForge settings and ensure the necessary permissions and providers are configured.',
      },
    );
  }

  if (readiness === 'partially_ready') {
    return blocker(
      'readiness_gap',
      'Environment partially ready for this task',
      'Some required capabilities are available, but one or more key areas are not fully configured.',
      'medium',
      false,
      {
        suggestedResolution: 'Check which tools and permissions are still needed before proceeding.',
      },
    );
  }

  if (readiness === 'unknown') {
    return blocker(
      'readiness_gap',
      'Environment readiness unclear',
      'Insufficient information is available to confirm whether the environment can support this task.',
      'low',
      false,
    );
  }

  return null;
}

// ── Approval points by category ───────────────────────────────────────────────

function buildApprovalPoints(
  cat: WorkIntentCategory,
  fusion: ContextFusionResult,
): ApprovalPoint[] {
  const points: ApprovalPoint[] = [];

  switch (cat) {
    case 'app_submission':
      points.push(approval(
        'submission',
        'Confirm app submission',
        'Submitting an application to the App Store or TestFlight is an external, irreversible action that requires explicit confirmation.',
        true,
        'app_store_tooling',
      ));
      points.push(approval(
        'external_action',
        'Confirm external platform interaction',
        'Interacting with App Store Connect or a third-party distribution platform requires user authorization.',
        true,
        'browser',
      ));
      break;

    case 'creative_editing':
      points.push(approval(
        'destructive_change',
        'Confirm changes to media files',
        'Editing or overwriting media project files is a potentially irreversible operation.',
        true,
        'files',
      ));
      points.push(approval(
        'export',
        'Confirm media export',
        'Exporting rendered media may overwrite existing files or create large output artifacts.',
        false,
        'files',
      ));
      break;

    case 'coding_build_debug':
      points.push(approval(
        'destructive_change',
        'Confirm changes to project files',
        'Modifying source code or configuration files may affect the build in ways that are hard to reverse without version control.',
        true,
        'files',
      ));
      break;

    case 'file_project_organization':
      points.push(approval(
        'destructive_change',
        'Confirm file reorganization',
        'Moving, renaming, or deleting files is difficult to reverse without a backup.',
        true,
        'files',
      ));
      break;

    case 'browser_admin_workflow':
      points.push(approval(
        'access',
        'Confirm browser session access',
        'Automating browser actions on an admin panel or CMS requires explicit authorization.',
        true,
        'browser',
      ));
      points.push(approval(
        'external_action',
        'Confirm external site interaction',
        'Actions performed on a live website or CMS can have immediate visible effects.',
        true,
        'browser',
      ));
      break;

    case 'desktop_assistance':
      points.push(approval(
        'access',
        'Confirm desktop action authorization',
        'Performing actions on behalf of the user on their machine requires confirmation.',
        true,
      ));
      break;

    case 'research_planning':
      // Typically no approval needed unless browser use is implied
      if (fusion.requiredTools.includes('browser')) {
        points.push(approval(
          'external_action',
          'Confirm external web access for research',
          'Accessing external websites for research involves sending requests to third-party services.',
          false,
          'browser',
        ));
      }
      break;

    case 'unknown':
      // No approval points until intent is clarified
      break;
  }

  return points;
}

// ── Deduplication ─────────────────────────────────────────────────────────────

/**
 * Remove blockers with the same type + relatedKeys signature.
 * Preserves the higher-severity entry when duplicates are found.
 */
function dedupeBlockers(blockers: ReasoningBlocker[]): ReasoningBlocker[] {
  const seen = new Map<string, ReasoningBlocker>();
  const severityRank: Record<ReasoningBlocker['severity'], number> = {
    high: 3, medium: 2, low: 1,
  };

  for (const b of blockers) {
    const key = `${b.type}:${(b.relatedKeys ?? []).sort().join(',')}`;
    const existing = seen.get(key);
    if (!existing || severityRank[b.severity] > severityRank[existing.severity]) {
      seen.set(key, b);
    }
  }

  return [...seen.values()];
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Detect structured blockers and approval points from fused context and
 * normalized machine state.
 *
 * Pure and synchronous. Uses only evidence already present in prior phases.
 * Returns task-aware readiness that may be tighter than the fusion-level value.
 *
 * @param input - Phase 4 ContextFusionResult + Phase 3 NormalizedMachineContext.
 * @returns Structured blockers, approval points, and adjusted task-aware readiness.
 */
export function detectBlockers(input: BlockerDetectionInput): BlockerDetectionResult {
  resetSeqs();

  const { fusion, machine } = input;
  const cat = fusion.interpretedTaskType;

  // Collect candidate blockers from each detection rule
  const candidates: ReasoningBlocker[] = [
    ...detectPermissionBlockers(fusion, machine),
    ...detectProviderBlockers(fusion, machine),
    ...detectProjectBlockers(fusion, machine),
  ];

  const envBlocker = detectNoActiveEnvBlocker(fusion, machine);
  if (envBlocker) candidates.push(envBlocker);

  // Readiness gap is a summary — only add after specific blockers are known
  const gapBlocker = detectReadinessGapBlocker(fusion, candidates.length);
  if (gapBlocker) candidates.push(gapBlocker);

  // Deduplicate
  const blockers = dedupeBlockers(candidates);

  // Build approval points
  const approvalPoints = buildApprovalPoints(cat, fusion);

  // Adjust readiness based on final blocker set
  const readiness = adjustReadiness(fusion.readiness, blockers);

  return { blockers, approvalPoints, readiness };
}
