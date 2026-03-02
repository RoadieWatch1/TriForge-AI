import * as crypto from 'crypto';
import type { ProviderManager } from './providerManager';
import type { Plan, Step, TaskCategory } from './taskTypes';
import { agreementScore, mergePlans, fallbackPlan } from './decisionEngine';

// ── ThinkTankPlanner ──────────────────────────────────────────────────────────
// Sends the goal to all active AI providers in parallel, parses the JSON plans
// each returns, then merges them into a single consensus plan.

export class ThinkTankPlanner {
  constructor(private _pm: ProviderManager) {}

  async makePlan(
    goal: string,
    category: TaskCategory,
    context?: string,
  ): Promise<Plan> {
    const providers = await this._pm.getActiveProviders();
    const prompt = buildPlanningPrompt(goal, category, context);

    const results = await Promise.allSettled(
      providers.map(p => p.generateResponse(prompt))
    );

    const rawPlans: Plan[] = [];
    for (const r of results) {
      if (r.status !== 'fulfilled') continue;
      try {
        const plan = parsePlanJSON(r.value, category);
        if (plan) rawPlans.push(plan);
      } catch {
        // ignore malformed responses
      }
    }

    if (rawPlans.length === 0) {
      return fallbackPlan(goal, category);
    }

    const merged = mergePlans(rawPlans, category);
    merged.agreementScore = agreementScore(rawPlans);
    merged.goalStatement = merged.goalStatement || goal;
    return merged;
  }
}

// ── Prompt builder ────────────────────────────────────────────────────────────

function buildPlanningPrompt(
  goal: string,
  category: TaskCategory,
  context?: string,
): string {
  return `You are a task planning AI. Create an execution plan for the following goal.

GOAL: ${goal}
CATEGORY: ${category}
${context ? `CONTEXT: ${context}` : ''}

Respond ONLY with a valid JSON object (no markdown, no explanation) using this exact schema:
{
  "goalStatement": "one-sentence restatement of the goal",
  "strategyNotes": "brief strategy in 1-2 sentences",
  "steps": [
    {
      "title": "short step title",
      "description": "what this step does",
      "tool": "one of: draft_email, schedule_post, doc_search, file_organize, broker_sim",
      "args": { "key": "value" },
      "riskLevel": "low | medium | high",
      "estimatedCostCents": 0
    }
  ]
}

Rules:
- Use only tools relevant to category "${category}"
- Keep steps to 3-5 maximum
- estimatedCostCents should be 0 for informational tools, 5-50 for communication tools
- riskLevel: low=informational, medium=file/content changes, high=financial/irreversible`;
}

// ── Plan parser ───────────────────────────────────────────────────────────────

function parsePlanJSON(raw: string, category: TaskCategory): Plan | null {
  // Strip markdown code fences
  let text = raw.trim();
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) text = fenceMatch[1].trim();

  // Extract first {...} block
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  const parsed = JSON.parse(jsonMatch[0]);
  if (!parsed.steps || !Array.isArray(parsed.steps)) return null;

  const steps: Step[] = parsed.steps.map((s: Record<string, unknown>) => ({
    id: crypto.randomUUID(),
    title: String(s.title ?? 'Step'),
    description: String(s.description ?? ''),
    tool: s.tool as Step['tool'] ?? 'doc_search',
    args: (s.args as Record<string, unknown>) ?? {},
    riskLevel: (['low', 'medium', 'high'].includes(s.riskLevel as string)
      ? s.riskLevel : 'low') as Step['riskLevel'],
    requiresApproval: false, // set by agentLoop via evaluateStepTrust
    estimatedCostCents: typeof s.estimatedCostCents === 'number' ? s.estimatedCostCents : 0,
    status: 'pending' as const,
  }));

  return {
    id: crypto.randomUUID(),
    goalStatement: String(parsed.goalStatement ?? ''),
    strategyNotes: String(parsed.strategyNotes ?? ''),
    steps,
    createdAt: Date.now(),
    agreementScore: 0,
  };
}
