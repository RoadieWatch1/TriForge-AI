// ── contextual/ContextFusionEngine.ts — Section 5 Phase 4: Context Fusion ─────
//
// Merges a classified user request with normalized machine context into a
// single ContextFusionResult ready for later blocker detection and plan generation.
//
// Pure function. No side effects. No IPC. No async. No runtime calls.
// No blocker detection. No plan generation. No explanation generation.

import type { IntentClassificationResult } from './IntentClassifier';
import type { NormalizedMachineContext } from './MachineContextNormalizer';
import type {
  WorkIntentCategory,
  EnvironmentReadiness,
  MachineContextSignal,
  ContextFusionResult,
} from './types';

// ── Public input shape ────────────────────────────────────────────────────────

export interface ContextFusionInput {
  rawUserRequest: string;
  classification: IntentClassificationResult;
  machine: NormalizedMachineContext;
  /** Resolved mission title if available from the mission store (optional) */
  activeMissionTitle?: string | null;
  /** Human-readable operator profile label if available (optional) */
  activeProfileLabel?: string | null;
}

// ── Goal summaries by category ────────────────────────────────────────────────

const GOAL_BY_CATEGORY: Record<WorkIntentCategory, string> = {
  app_submission:             'Prepare to submit or publish an application',
  creative_editing:           'Prepare to edit, render, or export creative media',
  coding_build_debug:         'Prepare to investigate and resolve a build or code issue',
  file_project_organization:  'Prepare to organize or restructure project files',
  browser_admin_workflow:     'Prepare to complete a browser-based administrative workflow',
  desktop_assistance:         'Prepare to assist with a task on this machine',
  research_planning:          'Prepare to research options and outline an approach',
  unknown:                    'Clarify the requested task before proceeding',
};

// ── Signal relevance keys per category ───────────────────────────────────────

const RELEVANT_SIGNAL_KEYS: Record<WorkIntentCategory, string[]> = {
  app_submission: [
    'files-access',
    'browser-access',
    'email-provider',
    'email-permission',
    'active-mission',
    'pending-approvals',
    'environment-readiness',
  ],
  creative_editing: [
    'files-access',
    'image-provider',
    'ai-provider',
    'active-mission',
    'pending-tasks',
    'environment-readiness',
  ],
  coding_build_debug: [
    'files-access',
    'browser-access',
    'active-mission',
    'pending-tasks',
    'pending-approvals',
    'environment-readiness',
  ],
  file_project_organization: [
    'files-access',
    'active-mission',
    'pending-tasks',
    'environment-readiness',
  ],
  browser_admin_workflow: [
    'browser-access',
    'email-provider',
    'email-permission',
    'pending-approvals',
    'environment-readiness',
  ],
  desktop_assistance: [
    'files-access',
    'browser-access',
    'active-mission',
    'pending-tasks',
    'pending-approvals',
    'environment-readiness',
  ],
  research_planning: [
    'browser-access',
    'ai-provider',
    'active-mission',
    'environment-readiness',
  ],
  unknown: [
    'files-access',
    'browser-access',
    'ai-provider',
    'active-mission',
    'environment-readiness',
  ],
};

// ── Likely required tools by category ────────────────────────────────────────

const LIKELY_TOOLS_BY_CATEGORY: Record<WorkIntentCategory, string[]> = {
  app_submission:             ['files', 'browser', 'email'],
  creative_editing:           ['files', 'image'],
  coding_build_debug:         ['files'],
  file_project_organization:  ['files'],
  browser_admin_workflow:     ['browser'],
  desktop_assistance:         ['files', 'browser'],
  research_planning:          ['browser'],
  unknown:                    [],
};

// ── Signal selection ──────────────────────────────────────────────────────────

function selectRelevantSignals(
  signals: MachineContextSignal[],
  category: WorkIntentCategory,
): MachineContextSignal[] {
  const keys = new Set(RELEVANT_SIGNAL_KEYS[category] ?? []);
  return signals.filter((s) => keys.has(s.key));
}

// ── Required tools derivation ─────────────────────────────────────────────────

/**
 * Start from the category's likely tools, then trim to those the environment
 * actually supports. If the environment has none, keep the full likely list
 * so downstream phases can detect the gap.
 */
function deriveRequiredTools(
  category: WorkIntentCategory,
  machine: NormalizedMachineContext,
  rawRequest: string,
): string[] {
  const likelyTools = LIKELY_TOOLS_BY_CATEGORY[category] ?? [];
  const available = new Set(machine.availableTools);

  // Always include the likely tools; downstream phases decide whether they're missing
  const result = new Set<string>(likelyTools);

  // If research_planning and image is available, it may help
  if (category === 'research_planning' && available.has('image')) {
    result.add('image');
  }

  // If the raw request explicitly names a recognizable app/tool, surface it
  // as an inferred tool reference (not a machine-verified one)
  const requestLower = rawRequest.toLowerCase();
  if (/premiere|final cut|davinci/.test(requestLower)) result.add('creative_app');
  if (/xcode|android studio/.test(requestLower))        result.add('ide');
  if (/testflight|app store connect/.test(requestLower)) result.add('app_store_tooling');

  return [...result];
}

// ── Missing requirements derivation ──────────────────────────────────────────

function deriveMissingRequirements(
  category: WorkIntentCategory,
  machine: NormalizedMachineContext,
  rawRequest: string,
): string[] {
  const missing = new Set<string>();
  const { permissions, providers, activeContext } = machine;

  // Carry forward broad environment gaps from normalizer
  for (const m of machine.missingRequirements) {
    missing.add(m);
  }

  // Task-category specific gaps
  switch (category) {
    case 'app_submission':
      if (!permissions.files)   missing.add('files_access_likely_needed');
      if (!permissions.browser) missing.add('browser_access_likely_needed');
      if (!providers.emailReady) missing.add('email_access_likely_needed');
      if (!activeContext.activeMissionId) missing.add('target_project_not_specified');
      break;

    case 'creative_editing':
      if (!permissions.files) missing.add('files_access_likely_needed');
      if (!activeContext.activeMissionId) missing.add('active_workspace_not_confirmed');
      break;

    case 'coding_build_debug':
      if (!permissions.files) missing.add('files_access_likely_needed');
      if (!activeContext.activeMissionId) missing.add('active_workspace_not_confirmed');
      break;

    case 'file_project_organization':
      if (!permissions.files) missing.add('files_access_likely_needed');
      if (!activeContext.activeMissionId) missing.add('target_project_not_specified');
      break;

    case 'browser_admin_workflow':
      if (!permissions.browser) missing.add('browser_access_likely_needed');
      break;

    case 'desktop_assistance':
      // Request is intentionally vague — surface environment gaps only
      if (!permissions.files && !permissions.browser) {
        missing.add('environment_access_undetermined');
      }
      break;

    case 'research_planning':
      if (!permissions.browser) missing.add('browser_access_likely_needed');
      break;

    case 'unknown':
      missing.add('task_intent_unclear');
      break;
  }

  // If request names an app we cannot verify
  const requestLower = rawRequest.toLowerCase();
  if (/premiere|final cut|davinci/.test(requestLower)) {
    missing.add('named_creative_app_not_verified');
  }
  if (/xcode|android studio/.test(requestLower)) {
    missing.add('named_ide_not_verified');
  }

  return [...missing];
}

// ── Confidence merger ─────────────────────────────────────────────────────────

/**
 * Merge classifier confidence with machine readiness quality conservatively.
 *
 * Rules:
 * - If the request is vague (unknown / low classifier confidence), machine
 *   readiness cannot rescue the score.
 * - Good machine readiness can moderately lift a moderate classifier score.
 * - Poor readiness (blocked/unknown) dampens any classifier score.
 * - Result is always rounded to 2 decimal places and capped at 0.95.
 */
function mergeConfidence(
  classifierConfidence: number,
  machineReadiness: EnvironmentReadiness,
  category: WorkIntentCategory,
  relevantSignalCount: number,
): number {
  if (category === 'unknown') return Math.min(classifierConfidence, 0.20);

  const readinessFactor: Record<EnvironmentReadiness, number> = {
    ready:           0.10,
    partially_ready: 0.00,
    blocked:        -0.10,
    unknown:        -0.05,
  };

  // Signal quality: more relevant signals found → slight boost
  const signalBoost = Math.min(relevantSignalCount * 0.02, 0.06);

  const merged = classifierConfidence + readinessFactor[machineReadiness] + signalBoost;
  return parseFloat(Math.max(0.05, Math.min(merged, 0.95)).toFixed(2));
}

// ── Assumptions builder ───────────────────────────────────────────────────────

function buildAssumptions(
  rawRequest: string,
  category: WorkIntentCategory,
  machine: NormalizedMachineContext,
  activeMissionTitle: string | null | undefined,
  activeProfileLabel: string | null | undefined,
): string[] {
  const assumptions: string[] = [];
  const requestLower = rawRequest.toLowerCase();

  if (/premiere/.test(requestLower)) {
    assumptions.push('Adobe Premiere was named in the request but is not directly verified by current machine context.');
  }
  if (/final cut/.test(requestLower)) {
    assumptions.push('Final Cut Pro was named in the request but is not directly verified by current machine context.');
  }
  if (/davinci/.test(requestLower)) {
    assumptions.push('DaVinci Resolve was named in the request but is not directly verified by current machine context.');
  }
  if (/xcode/.test(requestLower)) {
    assumptions.push('Xcode was named in the request but is not directly verified by current machine context.');
  }
  if (/android studio/.test(requestLower)) {
    assumptions.push('Android Studio was named in the request but is not directly verified by current machine context.');
  }

  if (activeMissionTitle) {
    assumptions.push(`Active mission "${activeMissionTitle}" is assumed to be the project context for this task.`);
  } else if (machine.activeContext.activeMissionId) {
    assumptions.push('An active mission ID is present but its title could not be resolved at this stage.');
  }

  if (activeProfileLabel) {
    assumptions.push(`Operating under profile "${activeProfileLabel}".`);
  }

  if (category === 'desktop_assistance') {
    assumptions.push('Request is general — environment scope assumed to be broad until further clarification.');
  }

  return assumptions;
}

// ── Notes builder ─────────────────────────────────────────────────────────────

function buildNotes(
  machine: NormalizedMachineContext,
): string[] {
  const notes: string[] = [];

  if (machine.activeContext.pendingApprovals > 0) {
    notes.push(`${machine.activeContext.pendingApprovals} pending approval(s) may affect task progression.`);
  }
  if (machine.activeContext.pendingTasks > 0) {
    notes.push(`${machine.activeContext.pendingTasks} pending task(s) are active in the current session.`);
  }
  if (machine.notes) {
    notes.push(...machine.notes);
  }

  return notes;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Fuse a classified user request with normalized machine context into a single
 * ContextFusionResult.
 *
 * Pure and synchronous. Produces a reasoning-safe merged understanding.
 * Blockers and approval points are left empty — those are Phase 5 responsibilities.
 *
 * @param input - Raw request, Phase 2 classification, Phase 3 normalized machine context,
 *                and optional resolved mission/profile labels.
 * @returns ContextFusionResult ready for Phase 5 blocker detection.
 */
export function fuseContext(input: ContextFusionInput): ContextFusionResult {
  const {
    rawUserRequest,
    classification,
    machine,
    activeMissionTitle,
    activeProfileLabel,
  } = input;

  const category = classification.category;

  // A. Interpreted goal — deterministic, category-driven
  const interpretedGoal = GOAL_BY_CATEGORY[category];

  // B. Select relevant machine signals for this task type
  const relevantMachineContext = selectRelevantSignals(machine.signals, category);

  // C. Derive required tools
  const requiredTools = deriveRequiredTools(category, machine, rawUserRequest);

  // D. Derive missing requirements (broad, reasoning-safe)
  const missingRequirements = deriveMissingRequirements(category, machine, rawUserRequest);

  // E. Merge confidence conservatively
  const confidence = mergeConfidence(
    classification.confidence,
    machine.readiness,
    category,
    relevantMachineContext.length,
  );

  // F. Assumptions and notes
  const assumptions = buildAssumptions(
    rawUserRequest,
    category,
    machine,
    activeMissionTitle,
    activeProfileLabel,
  );

  const notes = buildNotes(machine);

  return {
    rawUserRequest,
    interpretedGoal,
    interpretedTaskType: category,
    readiness: machine.readiness,
    confidence,
    relevantMachineContext,
    requiredTools,
    missingRequirements,
    // Phase 5 is responsible for blocker and approval-point detection
    blockers: [],
    approvalPoints: [],
    ...(assumptions.length > 0 ? { assumptions } : {}),
    ...(notes.length > 0 ? { notes } : {}),
  };
}
