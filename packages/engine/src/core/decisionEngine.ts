import * as crypto from 'crypto';
import type { Plan, Step, TaskCategory, TrustPolicy } from './taskTypes';

// ── DecisionEngine — pure functions ───────────────────────────────────────────

// Agreement score: ratio of steps where 2+ plans share the same tool (0–1)
export function agreementScore(plans: Plan[]): number {
  if (plans.length < 2) return plans.length === 1 ? 1 : 0;

  const allTitles = plans.flatMap(p => p.steps.map(s => s.tool));
  const freq: Record<string, number> = {};
  for (const tool of allTitles) freq[tool] = (freq[tool] ?? 0) + 1;

  const agreedTools = Object.values(freq).filter(count => count >= 2).length;
  const totalUniqueTools = Object.keys(freq).length;
  return totalUniqueTools === 0 ? 0 : agreedTools / totalUniqueTools;
}

// Merge plans: union all steps, dedupe by title similarity, sort by frequency
export function mergePlans(plans: Plan[], category: TaskCategory): Plan {
  const stepFreq: Map<string, { step: Step; count: number }> = new Map();

  for (const plan of plans) {
    for (const step of plan.steps) {
      const key = step.title.toLowerCase().trim();
      const existing = stepFreq.get(key);
      if (existing) {
        existing.count += 1;
      } else {
        // Check for near-duplicate via includes
        let found = false;
        for (const [k, v] of stepFreq.entries()) {
          if (k.includes(key) || key.includes(k)) {
            v.count += 1;
            found = true;
            break;
          }
        }
        if (!found) stepFreq.set(key, { step: { ...step }, count: 1 });
      }
    }
  }

  const sortedSteps = [...stepFreq.values()]
    .sort((a, b) => b.count - a.count)
    .map(({ step }, index) => ({
      ...step,
      id: crypto.randomUUID(),
      status: 'pending' as const,
    }));

  return {
    id: crypto.randomUUID(),
    goalStatement: plans[0]?.goalStatement ?? '',
    strategyNotes: plans[0]?.strategyNotes ?? '',
    steps: sortedSteps,
    createdAt: Date.now(),
    agreementScore: 0, // caller fills this in
  };
}

// Whether a step needs human approval given the policy
export function needsApproval(step: Step, policy: TrustPolicy): boolean {
  return policy.level === 'approve' || step.riskLevel === 'high';
}

// Fallback single-step plan when AI planning fails entirely
export function fallbackPlan(goal: string, _category: TaskCategory): Plan {
  const stepId = crypto.randomUUID();
  return {
    id: crypto.randomUUID(),
    goalStatement: goal,
    strategyNotes: 'Auto-generated fallback plan: research the goal before acting.',
    steps: [
      {
        id: stepId,
        title: 'Research the goal',
        description: `Gather information to better understand: "${goal}"`,
        tool: 'doc_search',
        args: { query: goal, limit: 5 },
        riskLevel: 'low',
        requiresApproval: false,
        estimatedCostCents: 0,
        status: 'pending',
        attempts: 0,
        maxAttempts: 3,
      },
    ],
    createdAt: Date.now(),
    agreementScore: 0,
  };
}
