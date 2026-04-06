// ── contextual/ReasoningPlanBuilder.ts — Section 5 Phase 6: Reasoning Plan ────
//
// Transforms fused context + blocker detection output into a structured,
// ordered, non-executable ReasoningPlan artifact for Section 5.
//
// Pure function. No side effects. No IPC. No async. No runtime calls.
// No explanation generation. No execution wiring. No approval workflow hooks.

import type { BlockerDetectionResult } from './BlockerDetector';
import type {
  WorkIntentCategory,
  ContextFusionResult,
  ReasoningPlan,
  ReasoningPlanStep,
} from './types';

// ── Public input shape ────────────────────────────────────────────────────────

export interface ReasoningPlanInput {
  fusion: ContextFusionResult;
  detection: BlockerDetectionResult;
}

// ── Step template shape ───────────────────────────────────────────────────────

interface StepTemplate {
  id: string;
  title: string;
  description: string;
  requiresApproval?: boolean;
}

// ── Base plan templates by category ──────────────────────────────────────────

const BASE_TEMPLATES: Record<WorkIntentCategory, StepTemplate[]> = {
  app_submission: [
    {
      id: 'step-confirm-target',
      title: 'Confirm application and submission target',
      description:
        'Confirm the specific application, build target, and intended submission destination (e.g. App Store, TestFlight) before proceeding.',
    },
    {
      id: 'step-verify-environment',
      title: 'Verify required access and environment readiness',
      description:
        'Verify that the required files, browser access, email configuration, and any connected account credentials are available and ready.',
    },
    {
      id: 'step-review-risks',
      title: 'Review prerequisites, blockers, and approval needs',
      description:
        'Review submission prerequisites, surface any missing requirements or blockers, and identify where explicit approval will be needed before the submission proceeds.',
      requiresApproval: true,
    },
    {
      id: 'step-prepare-workflow',
      title: 'Prepare the submission workflow once the environment is ready',
      description:
        'Once the target is confirmed and the environment is ready, outline the submission workflow — including any external platform interactions that require user authorization.',
      requiresApproval: true,
    },
  ],

  creative_editing: [
    {
      id: 'step-confirm-target',
      title: 'Confirm the media project, assets, and editing or export target',
      description:
        'Confirm which media project, footage, or asset is involved and what the intended editing or export outcome is.',
    },
    {
      id: 'step-verify-environment',
      title: 'Verify file access, creative tooling context, and readiness',
      description:
        'Verify that file system access is available, the relevant creative tooling context is accessible, and any readiness gaps are understood.',
    },
    {
      id: 'step-review-risks',
      title: 'Review likely edits, export needs, and approval points',
      description:
        'Review the intended editing or export changes, identify any irreversible output steps, and surface the approval points that would be required before changes are made.',
      requiresApproval: true,
    },
    {
      id: 'step-prepare-workflow',
      title: 'Prepare the editing or export workflow once the environment is ready',
      description:
        'Once the project and environment are confirmed, prepare the editing or export workflow — noting any steps where explicit authorization is required.',
      requiresApproval: true,
    },
  ],

  coding_build_debug: [
    {
      id: 'step-confirm-target',
      title: 'Confirm the project, build target, and current goal',
      description:
        'Confirm the specific project or codebase involved, the build target, and whether the goal is to fix an error, investigate a failure, or resolve a specific debugging question.',
    },
    {
      id: 'step-verify-environment',
      title: 'Verify workspace, file access, and environment readiness',
      description:
        'Verify that the project workspace is accessible, file system access is available, and any relevant environment readiness signals (active mission, pending tasks) are understood.',
    },
    {
      id: 'step-review-risks',
      title: 'Review blockers, missing context, and approval needs',
      description:
        'Surface any missing project context, permission gaps, or environment blockers. Identify the approval points that would be required before changes to source files or configuration are made.',
      requiresApproval: true,
    },
    {
      id: 'step-prepare-workflow',
      title: 'Prepare the investigation and fix workflow once the environment is ready',
      description:
        'Once the build target and environment are confirmed, prepare the investigation and resolution workflow — noting the specific areas where explicit authorization would be needed before file changes are applied.',
      requiresApproval: true,
    },
  ],

  file_project_organization: [
    {
      id: 'step-confirm-target',
      title: 'Confirm the folder, workspace, or file set to reorganize',
      description:
        'Confirm the specific folder, project workspace, or set of files to be reorganized, and clarify the intended structural outcome.',
    },
    {
      id: 'step-verify-environment',
      title: 'Verify file access and missing environment requirements',
      description:
        'Verify that file system access is granted and identify any environment gaps that would prevent the reorganization from proceeding.',
    },
    {
      id: 'step-review-risks',
      title: 'Review intended changes and destructive-change approval needs',
      description:
        'Review the planned structural changes — moves, renames, or deletions — and identify any steps that require explicit approval before irreversible file operations are performed.',
      requiresApproval: true,
    },
    {
      id: 'step-prepare-workflow',
      title: 'Prepare the organization workflow once the environment is ready',
      description:
        'Once the target file set and environment are confirmed, prepare the organization workflow — noting any steps where user authorization is required before changes are applied.',
      requiresApproval: true,
    },
  ],

  browser_admin_workflow: [
    {
      id: 'step-confirm-target',
      title: 'Confirm the site, dashboard, or admin target',
      description:
        'Confirm which website, admin panel, CMS, or web portal is involved, and clarify the specific action or workflow to be completed.',
    },
    {
      id: 'step-verify-environment',
      title: 'Verify browser access, provider readiness, and account prerequisites',
      description:
        'Verify that browser automation access is available, any related provider or credential requirements are met, and relevant account prerequisites are understood.',
    },
    {
      id: 'step-review-risks',
      title: 'Review intended changes and required approvals',
      description:
        'Review the intended browser-based actions — form submissions, content changes, or account interactions — and surface the approval points required before any live site changes are made.',
      requiresApproval: true,
    },
    {
      id: 'step-prepare-workflow',
      title: 'Prepare the browser-based workflow once the environment is ready',
      description:
        'Once browser access is confirmed and the target is clear, prepare the workflow — noting every point where explicit user authorization is required before actions are performed on the live site.',
      requiresApproval: true,
    },
  ],

  desktop_assistance: [
    {
      id: 'step-confirm-target',
      title: 'Clarify the target task and the relevant part of this machine',
      description:
        'Clarify exactly what the user wants to accomplish and which part of their machine, workflow, or application is involved.',
    },
    {
      id: 'step-verify-environment',
      title: 'Review available environment context and readiness gaps',
      description:
        'Review the available machine context — permissions, active context, pending work — and identify any readiness gaps that would affect this task.',
    },
    {
      id: 'step-review-risks',
      title: 'Surface blockers and approval needs before proceeding',
      description:
        'Surface any blockers, missing requirements, or approval points that would need to be addressed before any desktop-level actions are taken.',
      requiresApproval: true,
    },
    {
      id: 'step-prepare-workflow',
      title: 'Prepare the next best workflow once the task and environment are clear',
      description:
        'Once the task is clarified and the environment is understood, prepare the most appropriate workflow — noting where explicit authorization is needed before any actions are performed.',
      requiresApproval: true,
    },
  ],

  research_planning: [
    {
      id: 'step-confirm-target',
      title: 'Clarify the decision, comparison, or planning target',
      description:
        'Clarify what the user wants to research, compare, or plan — including the question to be answered, the options to evaluate, or the approach to outline.',
    },
    {
      id: 'step-verify-environment',
      title: 'Review available context and identify information gaps',
      description:
        'Review what is already known from the current context and identify any information gaps that would need to be filled before a useful plan or comparison can be produced.',
    },
    {
      id: 'step-review-risks',
      title: 'Organize evaluation criteria, options, and any approval implications',
      description:
        'Organize the likely evaluation criteria and candidate options, and surface any approval implications — such as external web access — that would apply.',
    },
    {
      id: 'step-prepare-workflow',
      title: 'Prepare a structured approach for the research or planning task',
      description:
        'Prepare a structured approach for carrying out the research or planning task — including sources to consult, criteria to apply, and how to present the outcome.',
    },
  ],

  unknown: [
    {
      id: 'step-confirm-target',
      title: 'Clarify the requested task and intended outcome',
      description:
        'The request could not be confidently classified. Begin by clarifying what the user wants to accomplish and what a successful outcome looks like.',
    },
    {
      id: 'step-verify-environment',
      title: 'Review currently available machine context',
      description:
        'Review the available machine context to understand what environment is present and what could reasonably support the clarified task.',
    },
    {
      id: 'step-review-risks',
      title: 'Surface missing information, blockers, or approval needs',
      description:
        'Once the task is clearer, surface any missing information, blockers, or approval requirements that would affect the approach.',
    },
    {
      id: 'step-prepare-workflow',
      title: 'Prepare a more specific plan once the task is clarified',
      description:
        'Once the task and environment are understood, prepare a more specific and realistic reasoning plan.',
    },
  ],
};

// ── Step adaptation ───────────────────────────────────────────────────────────

/**
 * Adjust step descriptions to reflect readiness, blockers, and approvals.
 * Language is reinforced — not replaced — to stay deterministic.
 */
function adaptSteps(
  base: StepTemplate[],
  fusion: ContextFusionResult,
  detection: BlockerDetectionResult,
): ReasoningPlanStep[] {
  const { readiness } = detection;
  const hasBlockingBlockers = detection.blockers.some((b) => b.blocking);
  const hasHighBlockers = detection.blockers.some((b) => b.severity === 'high');
  const hasApprovals = detection.approvalPoints.length > 0;

  return base.map((template, idx): ReasoningPlanStep => {
    const order = idx + 1;
    let description = template.description;

    // Step 2 (verify-environment): reinforce when there are known blockers
    if (template.id === 'step-verify-environment' && hasBlockingBlockers) {
      description +=
        ' Note: one or more environment requirements are currently missing and must be resolved before this task can proceed.';
    }

    // Step 3 (review-risks): reinforce approval language when approval points exist
    if (template.id === 'step-review-risks' && hasApprovals) {
      description +=
        ` This step includes ${detection.approvalPoints.length} identified approval point(s) that require explicit user authorization.`;
    }

    // Step 4 (prepare-workflow): adjust final readiness framing
    if (template.id === 'step-prepare-workflow') {
      if (readiness === 'blocked' || hasHighBlockers) {
        description =
          description.replace(/once the .+ is ready/i, 'once the identified blockers are resolved') +
          ' The current environment has one or more high-severity blockers that prevent credible progress until resolved.';
      } else if (readiness === 'partially_ready') {
        description +=
          ' The environment is partially ready — remaining gaps should be resolved before the full workflow is initiated.';
      }
      // readiness === 'ready': no modification needed
    }

    const step: ReasoningPlanStep = {
      id: template.id,
      title: template.title,
      description,
      order,
    };

    // Mark steps that involve approval points
    if (template.requiresApproval && hasApprovals) {
      step.requiresApproval = true;
    }

    // Add inter-step dependencies
    if (order > 1) {
      step.dependsOnStepIds = [base[idx - 1].id];
    }

    return step;
  });
}

// ── User intent summary ───────────────────────────────────────────────────────

const INTENT_SUMMARY_BY_CATEGORY: Record<WorkIntentCategory, string> = {
  app_submission:             'You want help preparing an application submission workflow.',
  creative_editing:           'You want help preparing an editing or export workflow for a creative media task.',
  coding_build_debug:         'You want help investigating and resolving a build or code issue.',
  file_project_organization:  'You want help organizing or restructuring a project file set.',
  browser_admin_workflow:     'You want help completing a browser-based administrative or site workflow.',
  desktop_assistance:         'You want help with a task on this machine.',
  research_planning:          'You want help researching options and outlining an approach.',
  unknown:                    'The specific task is not yet clear — more context is needed to proceed.',
};

// ── Confidence adjustment ─────────────────────────────────────────────────────

function adjustConfidence(
  base: number,
  detection: BlockerDetectionResult,
): number {
  const highBlockerCount = detection.blockers.filter((b) => b.severity === 'high').length;
  const blockingCount    = detection.blockers.filter((b) => b.blocking).length;

  let delta = 0;
  if (detection.readiness === 'blocked') delta -= 0.10;
  if (highBlockerCount >= 2)             delta -= 0.08;
  else if (highBlockerCount === 1)       delta -= 0.04;
  if (blockingCount >= 3)                delta -= 0.05;

  return parseFloat(Math.max(0.05, Math.min(base + delta, 0.95)).toFixed(2));
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Build a structured, ordered, non-executable ReasoningPlan from fused context
 * and blocker detection output.
 *
 * Pure and synchronous. Steps are deterministic templates adapted by readiness,
 * blockers, and approval presence. Blockers and approval points come directly
 * from Phase 5 — they are not recomputed here.
 *
 * @param input - Phase 4 ContextFusionResult + Phase 5 BlockerDetectionResult.
 * @returns A fully populated ReasoningPlan ready for Phase 7 explanation generation.
 */
export function buildReasoningPlan(input: ReasoningPlanInput): ReasoningPlan {
  const { fusion, detection } = input;
  const cat = fusion.interpretedTaskType;

  const baseTemplate = BASE_TEMPLATES[cat];
  const orderedSteps = adaptSteps(baseTemplate, fusion, detection);

  const userIntentSummary = INTENT_SUMMARY_BY_CATEGORY[cat];
  const confidence = adjustConfidence(fusion.confidence, detection);

  const plan: ReasoningPlan = {
    goal:                  fusion.interpretedGoal,
    interpretedTaskType:   cat,
    userIntentSummary,
    readiness:             detection.readiness,
    confidence,
    relevantMachineContext: fusion.relevantMachineContext,
    requiredTools:         fusion.requiredTools,
    orderedSteps,
    approvalPoints:        detection.approvalPoints,
    blockers:              detection.blockers,
  };

  if (fusion.missingRequirements.length > 0) {
    plan.missingRequirements = fusion.missingRequirements;
  }

  if (fusion.assumptions && fusion.assumptions.length > 0) {
    plan.assumptions = fusion.assumptions;
  }

  return plan;
}
