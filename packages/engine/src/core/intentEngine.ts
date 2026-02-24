/**
 * Intent Engine — converts vague user goals into structured plans using the AI council.
 * Core of the TriForge Personal Think Tank OS.
 */

import { AIProvider } from './providers/provider';
import { ProviderName, IntentPlan } from '../protocol';

export type { IntentPlan };

const buildPrompt = (goal: string): string =>
  `Analyze this goal or challenge and respond ONLY with valid JSON matching this exact schema:
{
  "goalStatement": "refined, clearer statement of the goal",
  "obstacles": ["main obstacle 1", "main obstacle 2", "main obstacle 3"],
  "strategy": {
    "focus": "your analytical focus (e.g. 'execution planning', 'risk assessment', 'creative alternatives')",
    "steps": ["concrete step 1", "concrete step 2", "concrete step 3", "concrete step 4"]
  },
  "metrics": ["how to measure success 1", "how to measure success 2"]
}
Be specific and practical. Max 4 items per array. No explanations outside the JSON.

Goal/Challenge: ${goal}`;

export class IntentEngine {
  constructor(private _providers: AIProvider[]) {}

  async decompose(userGoal: string, signal?: AbortSignal): Promise<IntentPlan> {
    if (this._providers.length === 0) {
      throw new Error('No AI providers available. Add at least one API key to use Think Tank.');
    }

    const results = await Promise.allSettled(
      this._providers.map(p => this._callProvider(p, userGoal, signal))
    );

    let goalStatement = userGoal;
    const obstacles: string[] = [];
    const strategies: IntentPlan['strategies'] = [];
    const allSteps: string[] = [];
    const metrics: string[] = [];

    for (const result of results) {
      if (result.status !== 'fulfilled' || !result.value.parsed) { continue; }
      const { provider, parsed } = result.value;

      // Use the first valid goalStatement refinement
      if (parsed.goalStatement && typeof parsed.goalStatement === 'string' && goalStatement === userGoal) {
        goalStatement = parsed.goalStatement;
      }

      // Merge obstacles (case-insensitive dedup)
      for (const obs of (parsed.obstacles || [])) {
        if (typeof obs === 'string' && !obstacles.some(o => o.toLowerCase() === obs.toLowerCase())) {
          obstacles.push(obs);
        }
      }

      // Collect strategy
      if (parsed.strategy && typeof parsed.strategy === 'object') {
        const steps: string[] = Array.isArray(parsed.strategy.steps)
          ? parsed.strategy.steps.filter((s: unknown) => typeof s === 'string')
          : [];
        strategies.push({
          provider,
          focus: typeof parsed.strategy.focus === 'string' ? parsed.strategy.focus : provider,
          steps,
        });
        allSteps.push(...steps);
      }

      // Merge metrics (case-insensitive dedup)
      for (const m of (parsed.metrics || [])) {
        if (typeof m === 'string' && !metrics.some(x => x.toLowerCase() === m.toLowerCase())) {
          metrics.push(m);
        }
      }
    }

    // Build consensus action plan (deduplicated from all strategy steps, max 8)
    const actionPlan: string[] = [];
    for (const step of allSteps) {
      if (actionPlan.length >= 8) { break; }
      if (!actionPlan.some(s => s.toLowerCase() === step.toLowerCase())) {
        actionPlan.push(step);
      }
    }

    return { goalStatement, obstacles, strategies, actionPlan, metrics };
  }

  private async _callProvider(
    provider: AIProvider,
    userGoal: string,
    signal?: AbortSignal
  ): Promise<{ provider: ProviderName; parsed: any }> {
    try {
      const raw = await provider.generateResponse(buildPrompt(userGoal), undefined, signal);
      const cleaned = raw.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      return { provider: provider.name, parsed: JSON.parse(cleaned) };
    } catch {
      return { provider: provider.name, parsed: null };
    }
  }
}
