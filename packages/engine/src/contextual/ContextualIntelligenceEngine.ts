// ── contextual/ContextualIntelligenceEngine.ts — Section 5 Phase 8: Orchestrator
//
// Single entry point that composes Phases 2–7 of the Section 5 reasoning
// pipeline into one ContextualIntelligenceResult.
//
// Thin composition only. No new reasoning logic. No side effects. No IPC.
// No execution wiring. No UI. No runtime calls beyond local function composition.

import type { SystemStateSnapshot } from '../awareness/types';
import { classifyWorkIntent }          from './IntentClassifier';
import { normalizeMachineContext }     from './MachineContextNormalizer';
import { fuseContext }                 from './ContextFusionEngine';
import { detectBlockers }             from './BlockerDetector';
import { buildReasoningPlan }         from './ReasoningPlanBuilder';
import { buildReasoningExplanation }  from './ReasoningExplainer';
import type { ContextualIntelligenceResult } from './types';

// ── Public input shape ────────────────────────────────────────────────────────

export interface ContextualIntelligenceInput {
  rawUserRequest: string;
  snapshot: SystemStateSnapshot;
  /** Resolved mission title if available from the caller's context */
  activeMissionTitle?: string | null;
  /** Human-readable operator profile label if available from the caller's context */
  activeProfileLabel?: string | null;
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Run the full Section 5 contextual intelligence pipeline and return one
 * complete ContextualIntelligenceResult.
 *
 * Pipeline order:
 *   1. Classify user request           (Phase 2)
 *   2. Normalize machine snapshot      (Phase 3)
 *   3. Fuse request + context          (Phase 4)
 *   4. Detect blockers + approvals     (Phase 5)
 *   5. Build reasoning plan            (Phase 6)
 *   6. Build reasoning explanation     (Phase 7)
 *
 * The plan and explanation reflect the task-aware readiness produced by Phase 5.
 * The fusion object is preserved as the original Phase 4 artifact.
 *
 * Pure and synchronous. No side effects, no IPC, no runtime calls.
 *
 * @param input - Raw user request, live system snapshot, and optional resolved labels.
 * @returns ContextualIntelligenceResult with fusion, plan, and explanation.
 */
export function buildContextualIntelligence(
  input: ContextualIntelligenceInput,
): ContextualIntelligenceResult {
  const { rawUserRequest, snapshot, activeMissionTitle, activeProfileLabel } = input;

  // Phase 2 — classify the raw request
  const classification = classifyWorkIntent(rawUserRequest);

  // Phase 3 — normalize machine snapshot into planning-safe signals
  const machine = normalizeMachineContext(snapshot);

  // Phase 4 — fuse request + classification + machine context
  const fusion = fuseContext({
    rawUserRequest,
    classification,
    machine,
    activeMissionTitle,
    activeProfileLabel,
  });

  // Phase 5 — detect blockers, approval points, and task-aware readiness
  const detection = detectBlockers({ fusion, machine });

  // Phase 6 — build reasoning plan (uses task-aware readiness from detection)
  const plan = buildReasoningPlan({ fusion, detection });

  // Phase 7 — build plain-language explanation (uses task-aware detection output)
  const explanation = buildReasoningExplanation({ fusion, detection, plan });

  return { fusion, plan, explanation };
}
