import type {
  TaskCategory, Step, TrustPolicy, TrustModeSnapshot, TrustDecision,
  WalletSnapshot, TaskToolName,
} from './taskTypes';

// ── Phase 3.5 constants ────────────────────────────────────────────────────────

// These tools are safe to auto-execute even in 'approve' mode (read-only / draft-only)
export const SAFE_AUTOPASS_TOOLS: TaskToolName[] = ['draft_email', 'schedule_post', 'doc_search'];

// Phase 4 will flip this to allow real broker integration
export const PAPER_TRADING_ONLY = true;

// ── TrustEngine — pure functions ──────────────────────────────────────────────

export function evaluateStepTrust(
  category: TaskCategory,
  trust: TrustModeSnapshot,
  wallet: WalletSnapshot,
  step: Step,
): TrustDecision {
  const policy = trust[category];

  if (policy.level === 'off') {
    return { allowed: false, requiresApproval: false, reason: `Trust is off for ${category}`, reservedCents: 0 };
  }

  if (policy.level === 'suggest') {
    return { allowed: false, requiresApproval: false, reason: 'Suggest mode: plan only, no execution', reservedCents: 0 };
  }

  if (!policy.allowedTools.includes(step.tool)) {
    return { allowed: false, requiresApproval: false, reason: `Tool '${step.tool}' is not whitelisted for ${category}`, reservedCents: 0 };
  }

  if (step.estimatedCostCents > policy.perActionLimitCents) {
    return {
      allowed: false, requiresApproval: false,
      reason: `Per-action limit exceeded (${step.estimatedCostCents}¢ > ${policy.perActionLimitCents}¢)`,
      reservedCents: 0,
    };
  }

  const currentSpent = wallet.categorySpent[category] ?? 0;
  if (currentSpent + step.estimatedCostCents > policy.dailyBudgetCents) {
    return {
      allowed: false, requiresApproval: false,
      reason: `Daily budget exceeded for ${category} (${currentSpent + step.estimatedCostCents}¢ > ${policy.dailyBudgetCents}¢)`,
      reservedCents: 0,
    };
  }

  if (category === 'trading' && policy.requireStopLoss && !(step.args as Record<string, unknown>).stopLoss) {
    return {
      allowed: false, requiresApproval: false,
      reason: 'Stop-loss required for trading steps',
      reservedCents: 0,
    };
  }

  // Paper trading check — still allow, but flag it
  const isPaperTrade = PAPER_TRADING_ONLY && category === 'trading';

  if (policy.level === 'approve') {
    // Safe autopass: low-risk read-only tools bypass human gate even in approve mode
    const isAutopass = SAFE_AUTOPASS_TOOLS.includes(step.tool) && step.riskLevel === 'low';
    return {
      allowed: true,
      requiresApproval: !isAutopass,
      // autopassApplied signals the caller to emit an AUTOPASS_EXECUTED audit event
      autopassApplied: isAutopass,
      reason: isAutopass
        ? 'Auto-approved (safe read-only tool)'
        : isPaperTrade ? 'Requires approval (paper trade)' : 'Requires manual approval',
      reservedCents: step.estimatedCostCents,
      isPaperTrade,
    };
  }

  // level === 'full'
  return {
    allowed: true,
    requiresApproval: false,
    reason: isPaperTrade ? 'Approved by trust policy (paper trade only — Phase 3.5)' : 'Approved by trust policy',
    reservedCents: step.estimatedCostCents,
    isPaperTrade,
  };
}

export function needsApproval(step: Step, policy: TrustPolicy): boolean {
  return policy.level === 'approve' || step.riskLevel === 'high';
}

// ── Defaults ──────────────────────────────────────────────────────────────────

const EMPTY_POLICY: TrustPolicy = {
  level: 'off',
  dailyBudgetCents: 0,
  perActionLimitCents: 0,
  allowedTools: [],
  requireStopLoss: false,
};

const ALL_CATEGORIES: TaskCategory[] = ['email', 'social', 'research', 'files', 'trading', 'general'];

export const DEFAULT_TRUST_SNAPSHOT: TrustModeSnapshot = Object.fromEntries(
  ALL_CATEGORIES.map(c => [c, { ...EMPTY_POLICY }])
) as TrustModeSnapshot;

export function validateTrustMode(snap: TrustModeSnapshot): string[] {
  const errors: string[] = [];
  for (const cat of ALL_CATEGORIES) {
    const p = snap[cat];
    if (!p) { errors.push(`Missing policy for category: ${cat}`); continue; }
    if (!['off', 'suggest', 'approve', 'full'].includes(p.level)) {
      errors.push(`Invalid trust level '${p.level}' for ${cat}`);
    }
    if (typeof p.dailyBudgetCents !== 'number' || p.dailyBudgetCents < 0) {
      errors.push(`Invalid dailyBudgetCents for ${cat}`);
    }
    if (typeof p.perActionLimitCents !== 'number' || p.perActionLimitCents < 0) {
      errors.push(`Invalid perActionLimitCents for ${cat}`);
    }
    if (!Array.isArray(p.allowedTools)) {
      errors.push(`allowedTools must be an array for ${cat}`);
    }
  }
  return errors;
}

export function buildDefaultPolicyFor(
  category: TaskCategory,
  level: 'full' | 'approve' = 'full',
  tools: TaskToolName[] = [],
): TrustPolicy {
  return {
    level,
    dailyBudgetCents: 1000,
    perActionLimitCents: 200,
    allowedTools: tools,
    requireStopLoss: category === 'trading',
  };
}
