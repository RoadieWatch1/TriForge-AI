// ── contextual/ReasoningExplainer.ts — Section 5 Phase 7: Explanation Layer ───
//
// Transforms fused context, blocker detection, and reasoning plan into a
// plain-language ReasoningExplanation artifact for Section 5.
//
// Pure function. No side effects. No IPC. No async. No runtime calls.
// No execution wiring. No blocker detection. No plan generation. No UI/rendering.

import type { BlockerDetectionResult } from './BlockerDetector';
import type {
  WorkIntentCategory,
  EnvironmentReadiness,
  MachineContextSignal,
  ContextFusionResult,
  ReasoningPlan,
  ReasoningExplanation,
  ApprovalPoint,
  ReasoningBlocker,
} from './types';

// ── Public input shape ────────────────────────────────────────────────────────

export interface ReasoningExplainerInput {
  fusion: ContextFusionResult;
  detection: BlockerDetectionResult;
  plan: ReasoningPlan;
}

// ── A. whatIThinkYouWant ──────────────────────────────────────────────────────

const THINK_YOU_WANT: Record<WorkIntentCategory, string> = {
  app_submission:
    'I think you want help preparing an application submission workflow.',
  creative_editing:
    'I think you want help preparing an editing or export workflow for a creative media task.',
  coding_build_debug:
    'I think you want help investigating and resolving a build or code issue.',
  file_project_organization:
    'I think you want help organizing files or project structure.',
  browser_admin_workflow:
    'I think you want help completing a browser-based administrative or site workflow.',
  desktop_assistance:
    'I think you want help with a task on this machine, but the target still needs to be clarified.',
  research_planning:
    'I think you want help researching options and outlining an approach.',
  unknown:
    'I am not yet sure what you want to accomplish — more context would help me give you a useful plan.',
};

function buildWhatIThinkYouWant(cat: WorkIntentCategory): string {
  return THINK_YOU_WANT[cat];
}

// ── B. whatIFound ─────────────────────────────────────────────────────────────

/**
 * Translate a normalized machine signal into a short user-facing sentence.
 * Returns null for signals that don't produce meaningful user-facing content.
 */
function translateSignal(signal: MachineContextSignal): string | null {
  switch (signal.key) {
    case 'files-access':
      return signal.value === 'granted'
        ? 'File system access appears to be available.'
        : 'File system access does not appear to be granted.';

    case 'browser-access':
      return signal.value === 'granted'
        ? 'Browser automation access appears to be available.'
        : 'Browser-related access does not appear to be ready.';

    case 'email-provider':
      return signal.value === 'configured'
        ? 'An email provider is configured.'
        : 'No email provider is currently configured.';

    case 'email-permission':
      return signal.value === 'granted'
        ? 'Email access permission is granted.'
        : null; // email-provider already covers the unavailable case cleanly

    case 'image-provider':
      return signal.value === 'available'
        ? 'Image generation capability is available.'
        : 'Image generation capability is not currently available.';

    case 'ai-provider':
      return signal.value.startsWith('at least one')
        ? 'At least one AI provider is configured.'
        : 'No AI provider is currently configured.';

    case 'active-mission':
      return signal.value === 'none'
        ? 'There is no clearly confirmed active project or mission context yet.'
        : 'An active mission or project context is present.';

    case 'pending-tasks':
      return signal.value !== 'none'
        ? `There are pending tasks active in the current session (${signal.value}).`
        : null;

    case 'pending-approvals':
      return signal.value !== 'none'
        ? `There are pending approval requests that may affect task progression (${signal.value}).`
        : null;

    case 'environment-readiness':
      return translateReadiness(signal.value as EnvironmentReadiness);

    default:
      return null;
  }
}

function translateReadiness(readiness: EnvironmentReadiness | string): string {
  switch (readiness) {
    case 'ready':           return 'The current environment looks ready for this kind of task.';
    case 'partially_ready': return 'The current environment looks partially ready.';
    case 'blocked':         return 'The current environment has significant readiness issues.';
    case 'unknown':         return 'The current environment readiness is unclear.';
    default:                return `Environment readiness: ${readiness}.`;
  }
}

function buildWhatIFound(
  fusion: ContextFusionResult,
  detection: BlockerDetectionResult,
): string[] {
  const findings: string[] = [];
  const seen = new Set<string>();

  const add = (s: string) => {
    const key = s.trim().toLowerCase();
    if (!seen.has(key)) { seen.add(key); findings.push(s); }
  };

  // Translate relevant machine signals
  for (const signal of fusion.relevantMachineContext) {
    const sentence = translateSignal(signal);
    if (sentence) add(sentence);
  }

  // Surface unverified named tools from assumptions
  for (const assumption of fusion.assumptions ?? []) {
    if (
      assumption.includes('not directly verified') ||
      assumption.includes('could not be resolved')
    ) {
      add(assumption);
    }
  }

  // Add overall task-aware readiness if not already covered by environment-readiness signal
  if (!fusion.relevantMachineContext.some((s) => s.key === 'environment-readiness')) {
    add(translateReadiness(detection.readiness));
  }

  return findings.slice(0, 6);
}

// ── C. whatIWouldDo ───────────────────────────────────────────────────────────

/**
 * Summarize plan steps into 3–4 short, human-readable workflow bullets.
 * Does not copy step descriptions verbatim — derives a summary sentence per step.
 */
function buildWhatIWouldDo(plan: ReasoningPlan): string[] {
  const steps = plan.orderedSteps.slice(0, 4);
  return steps.map((step) => {
    switch (step.id) {
      case 'step-confirm-target':
        return 'First, I would confirm the specific project, target, or asset involved in the request.';
      case 'step-verify-environment':
        return 'Then I would verify the relevant environment access, permissions, and readiness conditions.';
      case 'step-review-risks':
        return 'After that, I would review any blockers, missing requirements, and the approval-sensitive parts of the workflow.';
      case 'step-prepare-workflow':
        return 'Once the environment and target are confirmed, I would prepare the task workflow, noting where explicit authorization is needed.';
      default:
        return step.title;
    }
  });
}

// ── D. whatIStillNeed ─────────────────────────────────────────────────────────

const MISSING_REQ_TRANSLATIONS: Record<string, string> = {
  files_access_likely_needed:         'File system access is likely needed for this workflow.',
  files_access_unavailable:           'File system access is currently unavailable.',
  browser_access_likely_needed:       'Browser access is likely needed for this workflow.',
  browser_unavailable:                'Browser access is currently unavailable.',
  email_access_likely_needed:         'Email access may be needed for this workflow.',
  email_unavailable:                  'An email provider is not currently configured.',
  no_ai_provider_configured:          'No AI provider is currently configured.',
  target_project_not_specified:       'The specific project or target still needs to be confirmed.',
  active_workspace_not_confirmed:     'The active workspace or project context still needs to be confirmed.',
  named_creative_app_not_verified:    'The creative application named in the request could not be verified on this machine.',
  named_ide_not_verified:             'The development environment named in the request could not be verified.',
  environment_access_undetermined:    'The available environment access is not yet clearly determined.',
  task_intent_unclear:                'The specific task intent still needs to be clarified before proceeding.',
};

function translateBlockerToNeed(b: ReasoningBlocker): string | null {
  switch (b.type) {
    case 'missing_permission':
      return `${b.title.toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}.`;
    case 'missing_provider':
      return `${b.title.toLowerCase().replace(/^\w/, (c) => c.toUpperCase())}.`;
    case 'missing_project':
      return 'The specific project or target still needs to be confirmed.';
    case 'ambiguous_target':
      return 'The active workspace or environment context is not yet confirmed.';
    case 'missing_app':
      return 'A named application could not be verified as available on this machine.';
    case 'no_active_environment':
      return 'No active project environment could be detected for this task.';
    case 'readiness_gap':
      return b.severity === 'high'
        ? 'The environment has significant readiness issues that need to be resolved first.'
        : 'One or more environment readiness gaps should be resolved before proceeding.';
    case 'tier_limitation':
      return 'A subscription tier limitation may affect access to a required capability.';
    case 'approval_dependency':
      return 'An approval dependency must be resolved before this workflow can proceed.';
    default:
      return null;
  }
}

function buildWhatIStillNeed(
  fusion: ContextFusionResult,
  detection: BlockerDetectionResult,
): string[] {
  const items: string[] = [];
  const seen = new Set<string>();

  const add = (s: string) => {
    const key = s.trim().toLowerCase();
    if (!seen.has(key)) { seen.add(key); items.push(s); }
  };

  // Blocking blockers first
  for (const b of detection.blockers.filter((b) => b.blocking)) {
    const t = translateBlockerToNeed(b);
    if (t) add(t);
  }

  // Non-blocking but meaningful blockers
  for (const b of detection.blockers.filter((b) => !b.blocking && b.severity !== 'low')) {
    const t = translateBlockerToNeed(b);
    if (t) add(t);
  }

  // Missing requirements not already covered by a blocker
  for (const req of fusion.missingRequirements) {
    const sentence = MISSING_REQ_TRANSLATIONS[req];
    if (sentence) add(sentence);
  }

  return items.slice(0, 5);
}

// ── E. whereApprovalIsNeeded ──────────────────────────────────────────────────

const APPROVAL_STAGE_TRANSLATIONS: Record<ApprovalPoint['stage'], string> = {
  access:
    'Approval would likely be needed before using protected access or account-linked areas.',
  destructive_change:
    'Approval would likely be needed before making changes that could alter files, code, or project structure.',
  export:
    'Approval would likely be needed before exporting or producing final output.',
  submission:
    'Approval would likely be needed before submitting anything externally.',
  external_action:
    'Approval would likely be needed before any external or account-level action.',
  unknown:
    'An approval checkpoint may be needed at a step that is not yet fully characterized.',
};

function buildWhereApprovalIsNeeded(approvalPoints: ApprovalPoint[]): string[] {
  const seen = new Set<string>();
  const items: string[] = [];

  for (const point of approvalPoints) {
    const sentence = APPROVAL_STAGE_TRANSLATIONS[point.stage];
    if (!seen.has(sentence)) {
      seen.add(sentence);
      items.push(sentence);
    }
  }

  return items.slice(0, 3);
}

// ── Optional honesty note ─────────────────────────────────────────────────────

function buildHonestyNote(
  fusion: ContextFusionResult,
  detection: BlockerDetectionResult,
): string | undefined {
  const hasUnverified = (fusion.assumptions ?? []).some(
    (a) => a.includes('not directly verified'),
  );
  const readiness = detection.readiness;
  const isAmbiguous = fusion.interpretedTaskType === 'unknown';
  const isLimitedReadiness = readiness === 'partially_ready' || readiness === 'blocked';

  if (isAmbiguous) {
    return 'The request could not be clearly classified. This understanding is based on limited evidence and should be treated as a starting point only.';
  }

  if (hasUnverified && isLimitedReadiness) {
    return 'Some parts of this understanding are based on the request language rather than direct machine verification, and the environment appears only partially ready. This is a preparation-level understanding, not a fully ready workflow.';
  }

  if (hasUnverified) {
    return 'Some parts of this understanding are based on the request language rather than direct machine verification.';
  }

  if (readiness === 'blocked') {
    return 'The environment has significant readiness issues. This plan reflects what would be needed, not what can proceed immediately.';
  }

  if (readiness === 'partially_ready') {
    return 'The environment appears only partially ready, so this is a preparation-level understanding rather than a fully ready workflow.';
  }

  return undefined;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Build a plain-language ReasoningExplanation from fused context, blocker
 * detection output, and the reasoning plan.
 *
 * Pure and synchronous. All output is derived deterministically from prior-phase
 * artifacts — no freeform generation, no LLM calls, no external state.
 *
 * @param input - Phase 4 ContextFusionResult, Phase 5 BlockerDetectionResult,
 *                and Phase 6 ReasoningPlan.
 * @returns A ReasoningExplanation ready to be surfaced to the user.
 */
export function buildReasoningExplanation(
  input: ReasoningExplainerInput,
): ReasoningExplanation {
  const { fusion, detection, plan } = input;

  const whatIThinkYouWant = buildWhatIThinkYouWant(fusion.interpretedTaskType);
  const whatIFound        = buildWhatIFound(fusion, detection);
  const whatIWouldDo      = buildWhatIWouldDo(plan);
  const whatIStillNeed    = buildWhatIStillNeed(fusion, detection);
  const whereApprovalIsNeeded = buildWhereApprovalIsNeeded(detection.approvalPoints);
  const honestyNote       = buildHonestyNote(fusion, detection);

  const result: ReasoningExplanation = {
    whatIThinkYouWant,
    whatIFound,
    whatIWouldDo,
    whatIStillNeed,
    whereApprovalIsNeeded,
  };

  if (honestyNote !== undefined) {
    result.honestyNote = honestyNote;
  }

  return result;
}
