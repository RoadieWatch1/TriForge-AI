// ── contextual/buildContextualReasoningAddendum.ts — Section 5 Phase 9 ────────
//
// Converts a completed ContextualIntelligenceResult into a compact,
// deterministic plain-text addendum suitable for injection into a system prompt.
//
// Pure function. No side effects. No IPC. No async. No runtime calls.
// No reasoning logic. No chat wiring. No UI. Formatting only.

import type {
  ContextualIntelligenceResult,
  MachineContextSignal,
  ReasoningBlocker,
  ApprovalPoint,
  EnvironmentReadiness,
} from './types';

// ── Signal summarizer ─────────────────────────────────────────────────────────

function summarizeSignal(signal: MachineContextSignal): string | null {
  switch (signal.key) {
    case 'files-access':
      return signal.value === 'granted' ? 'File system access available' : 'File system access unavailable';
    case 'browser-access':
      return signal.value === 'granted' ? 'Browser access available' : 'Browser access unavailable';
    case 'email-provider':
      return signal.value === 'configured' ? 'Email provider configured' : 'Email provider not configured';
    case 'image-provider':
      return signal.value === 'available' ? 'Image generation available' : 'Image generation unavailable';
    case 'ai-provider':
      return signal.value.startsWith('at least one') ? 'AI provider configured' : 'No AI provider configured';
    case 'active-mission':
      return signal.value === 'none' ? 'No active mission or project context' : 'Active mission context present';
    case 'pending-tasks':
      return signal.value !== 'none' ? `Pending tasks: ${signal.value}` : null;
    case 'pending-approvals':
      return signal.value !== 'none' ? `Pending approvals: ${signal.value}` : null;
    case 'environment-readiness':
      return null; // Readiness is surfaced separately
    default:
      return null;
  }
}

// ── Blocker summarizer ────────────────────────────────────────────────────────

function summarizeBlocker(b: ReasoningBlocker): string {
  return `${b.title} [${b.severity}${b.blocking ? ', blocking' : ''}]`;
}

// ── Approval summarizer ───────────────────────────────────────────────────────

const APPROVAL_STAGE_LABELS: Record<ApprovalPoint['stage'], string> = {
  access:            'Access authorization required',
  destructive_change: 'Approval required before file or code changes',
  export:            'Approval required before export',
  submission:        'Approval required before external submission',
  external_action:   'Approval required before external platform action',
  unknown:           'Approval checkpoint (type unclear)',
};

function summarizeApproval(a: ApprovalPoint): string {
  return APPROVAL_STAGE_LABELS[a.stage];
}

// ── Readiness label ───────────────────────────────────────────────────────────

function readinessLabel(r: EnvironmentReadiness): string {
  switch (r) {
    case 'ready':           return 'ready';
    case 'partially_ready': return 'partially ready';
    case 'blocked':         return 'blocked';
    case 'unknown':         return 'unknown';
  }
}

// ── Caution line ──────────────────────────────────────────────────────────────

function buildCautionLine(result: ContextualIntelligenceResult): string {
  const { fusion, plan } = result;

  // Honesty note from explanation takes highest priority
  if (result.explanation.honestyNote) {
    return result.explanation.honestyNote;
  }

  const hasUnverified = (fusion.assumptions ?? []).some(
    (a) => a.includes('not directly verified'),
  );
  const readiness = plan.readiness;
  const hasAmbiguousTarget =
    plan.blockers.some((b) => b.type === 'ambiguous_target' || b.type === 'missing_project') ||
    (fusion.missingRequirements ?? []).some(
      (r) => r === 'target_project_not_specified' || r === 'active_workspace_not_confirmed',
    );

  if (hasAmbiguousTarget) {
    return 'The target or project context remains ambiguous — clarify before committing to a workflow.';
  }
  if (hasUnverified && (readiness === 'partially_ready' || readiness === 'blocked')) {
    return 'Some tool references come from the request language and are not machine-verified; environment is only partially ready — keep planning conservative.';
  }
  if (hasUnverified) {
    return 'Use direct machine evidence where available; treat named apps from the request as unverified unless explicitly confirmed.';
  }
  if (readiness === 'blocked') {
    return 'Environment is blocked — planning should stay at the preparation level until blockers are resolved.';
  }
  if (readiness === 'partially_ready') {
    return 'Environment is only partially ready — planning should stay conservative.';
  }
  if (fusion.interpretedTaskType === 'unknown') {
    return 'Task intent is unclear — seek clarification before generating a specific workflow.';
  }

  return 'Proceed with awareness of the identified blockers and approval requirements listed above.';
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Convert a completed ContextualIntelligenceResult into a compact plain-text
 * addendum suitable for appending to a system prompt.
 *
 * Deterministic. Pure. No LLM calls. No side effects.
 *
 * @param result - The full Section 5 orchestrator output.
 * @returns A compact plain-text reasoning addendum (8–18 lines).
 */
export function buildContextualReasoningAddendum(
  result: ContextualIntelligenceResult,
): string {
  const { fusion, plan, explanation } = result;
  const lines: string[] = [];

  const push  = (s: string) => lines.push(s);
  const blank = ()          => lines.push('');

  // ── Header ──────────────────────────────────────────────────────────────────

  push('Contextual Intelligence (Section 5):');
  blank();

  // ── Task ────────────────────────────────────────────────────────────────────

  push(`- Task Type: ${fusion.interpretedTaskType}`);
  push(`- Goal: ${plan.userIntentSummary}`);
  push(`- Readiness: ${readinessLabel(plan.readiness)}`);

  // ── Key machine context ──────────────────────────────────────────────────────

  const signalLines = fusion.relevantMachineContext
    .map(summarizeSignal)
    .filter((s): s is string => s !== null)
    .slice(0, 5);

  if (signalLines.length > 0) {
    blank();
    push('- Key Context:');
    for (const s of signalLines) push(`  - ${s}`);
  }

  // ── Required tools ───────────────────────────────────────────────────────────

  blank();
  const toolList = plan.requiredTools.length > 0
    ? plan.requiredTools.join(', ')
    : 'none clearly confirmed';
  push(`- Required Tools: ${toolList}`);

  // ── Blockers and missing requirements ────────────────────────────────────────

  blank();
  push('- Blockers:');

  const seen = new Set<string>();
  let blockerCount = 0;

  for (const b of plan.blockers) {
    const line = summarizeBlocker(b);
    if (!seen.has(line)) {
      seen.add(line);
      push(`  - ${line}`);
      blockerCount++;
    }
  }

  // Add missing requirements not already represented by a blocker title
  const blockerTitles = new Set(plan.blockers.map((b) => b.title.toLowerCase()));
  for (const req of plan.missingRequirements ?? []) {
    // Skip machine-level gaps that always surface in blockers
    if (
      req === 'files_access_unavailable' ||
      req === 'browser_unavailable'      ||
      req === 'email_unavailable'
    ) continue;

    const readable = req.replace(/_/g, ' ');
    if (!blockerTitles.has(readable)) {
      const line = `Missing: ${readable}`;
      if (!seen.has(line)) {
        seen.add(line);
        push(`  - ${line}`);
        blockerCount++;
      }
    }
  }

  if (blockerCount === 0) {
    push('  - No major blockers currently identified');
  }

  // ── Approval-sensitive points ─────────────────────────────────────────────────

  blank();
  push('- Approvals:');

  const approvalSeen = new Set<string>();
  let approvalCount = 0;

  for (const a of plan.approvalPoints) {
    const line = summarizeApproval(a);
    if (!approvalSeen.has(line)) {
      approvalSeen.add(line);
      push(`  - ${line}`);
      approvalCount++;
    }
  }

  if (approvalCount === 0) {
    push('  - None likely at this stage');
  }

  // ── Caution ───────────────────────────────────────────────────────────────────

  blank();
  push(`- Caution: ${buildCautionLine(result)}`);

  return lines.join('\n');
}
