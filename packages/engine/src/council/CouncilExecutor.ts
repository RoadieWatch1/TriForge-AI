/**
 * CouncilExecutor.ts — AI Council orchestration layer.
 *
 * Routes execution through the full AI council pipeline:
 *   Claude → prompt expansion / architecture
 *   ThinkTankPlanner → structured execution plan
 *   Grok → critique and challenge
 *
 * This layer sits between IntentEngine and ThinkTankPlanner and ensures
 * every significant request benefits from multi-model reasoning.
 *
 * Existing systems (AgentLoop, ToolRegistry, Scheduler, etc.) are unchanged.
 */

import type { AIProvider }     from '../core/providers/provider';
import type { ThinkTankPlanner } from '../core/thinkTankPlanner';
import type { Plan, TaskCategory } from '../core/taskTypes';
import { eventBus }             from '../core/eventBus';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CouncilRequest {
  request:   string;
  category?: TaskCategory;
  context?:  string;
}

export interface CouncilResult {
  expanded:  string;           // Claude-refined request
  plan:      Plan;             // ThinkTankPlanner structured plan
  critique:  string;           // Grok challenge / improvements
  durationMs: number;
}

// ── CouncilExecutor ───────────────────────────────────────────────────────────

const EXPAND_SYSTEM = `You are an AI architect. Your job is to clarify and expand user requests
into precise, actionable specifications optimised for AI execution planning.
Be specific about goals, constraints, expected outputs, and success criteria.
Output only the expanded specification — no preamble.`;

const CRITIQUE_SYSTEM = `You are a critical systems analyst. Review the execution plan provided
and identify: gaps in the plan, risks, missing steps, better approaches, or potential failures.
Be concise and constructive. Format as bullet points.`;

export class CouncilExecutor {
  constructor(
    private _claudeProvider: AIProvider | null,
    private _critiqueProvider: AIProvider | null,
    private _planner: ThinkTankPlanner,
  ) {}

  async execute(req: CouncilRequest): Promise<CouncilResult> {
    const startMs = Date.now();
    const category = req.category ?? 'general';

    // ── 1. Emit start ──────────────────────────────────────────────────────
    eventBus.emit({
      type:     'COUNCIL_STARTED',
      request:  req.request,
      category,
    });

    // ── 2. Claude expands the request ──────────────────────────────────────
    let expanded = req.request;
    if (this._claudeProvider) {
      try {
        const ctx = req.context
          ? `Context:\n${req.context}\n\nRequest:`
          : 'Request:';
        expanded = await this._claudeProvider.generateResponse(
          `${ctx} ${req.request}`,
          EXPAND_SYSTEM,
        );
        expanded = expanded.trim();
      } catch {
        // Fall through with original request
      }
    }

    eventBus.emit({
      type:     'COUNCIL_ANALYSIS',
      expanded,
      category,
    });

    // ── 3. ThinkTankPlanner creates execution plan ─────────────────────────
    const plan = await this._planner.makePlan(expanded, category, req.context);

    eventBus.emit({
      type:     'COUNCIL_RESULT',
      planId:   plan.id,
      stepCount: plan.steps.length,
      category,
    });

    // ── 4. Grok critiques the plan ─────────────────────────────────────────
    let critique = '';
    if (this._critiqueProvider) {
      try {
        const planSummary = [
          `Goal: ${plan.goalStatement}`,
          `Strategy: ${plan.strategyNotes}`,
          `Steps (${plan.steps.length}):`,
          ...plan.steps.map((s, i) => `  ${i + 1}. ${s.title} — ${s.description}`),
        ].join('\n');

        critique = await this._critiqueProvider.generateResponse(
          planSummary,
          CRITIQUE_SYSTEM,
        );
        critique = critique.trim();
      } catch {
        critique = 'Critique unavailable.';
      }
    }

    eventBus.emit({
      type:    'COUNCIL_CRITIQUE',
      planId:  plan.id,
      critique,
    });

    return {
      expanded,
      plan,
      critique,
      durationMs: Date.now() - startMs,
    };
  }
}
