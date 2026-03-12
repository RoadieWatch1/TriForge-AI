/**
 * PlanCouncilService — multi-round plan debate with fixed council roles.
 *
 * Claude (architect) drafts a structured plan.
 * OpenAI (precision) reviews for completeness, correctness, edge cases.
 * Grok (adversarial) challenges assumptions, finds risks, proposes stress tests.
 * Claude revises based on feedback. Repeat up to maxRounds.
 */

import type { AIProvider } from '../core/providers/provider';
import type { ProviderName } from '../protocol';
import { sha256 } from '../core/hash';
import { eventBus } from '../core/eventBus';
import type {
  CouncilPlan,
  CouncilRole,
  CouncilRoleType,
  PlanReview,
  PlanAmendment,
  PlanObjection,
  ApprovedPlanSnapshot,
  WorkflowModeConfig,
} from './councilWorkflowTypes';

// ── Role-Specific System Prompts ────────────────────────────────────────────

const ARCHITECT_PLAN_PROMPT = `You are the Architect on a council of three AI agents.
Your job is to draft a structured implementation plan for the user's request.

You MUST respond with valid JSON matching this schema:
{
  "goal": "one-sentence goal",
  "summary": "2-3 sentence overview",
  "filesToRead": ["paths to read for context"],
  "filesToModify": ["paths to create/modify/delete"],
  "nonGoals": ["things explicitly out of scope"],
  "risks": ["potential issues"],
  "acceptanceCriteria": ["conditions that must be true when done"],
  "checksToRun": ["lint", "typecheck", "test", "build"],
  "rollbackPlan": "how to undo if needed",
  "commitScope": "what the commit message should describe",
  "pushAllowed": true
}

Be precise about file paths. Include only files that actually need to change.
Do not include aspirational or speculative changes.`;

const PRECISION_REVIEW_PROMPT = `You are the Precision Reviewer on a council of three AI agents.
Your job is to review a plan for completeness, correctness, and missing edge cases.

Review the plan and respond with valid JSON:
{
  "approved": true/false,
  "objections": [
    { "severity": "blocker|major|minor", "description": "what's wrong" }
  ],
  "suggestedAmendments": [
    { "description": "what to change", "reason": "why" }
  ],
  "confidence": 0.0-1.0
}

Focus on:
- Are all necessary files listed?
- Are acceptance criteria testable and complete?
- Are there missing edge cases or error handling gaps?
- Is the commit scope accurate?`;

const ADVERSARIAL_REVIEW_PROMPT = `You are the Adversarial Reviewer on a council of three AI agents.
Your job is to challenge assumptions, find risks, and propose stress tests.

Review the plan and respond with valid JSON:
{
  "approved": true/false,
  "objections": [
    { "severity": "blocker|major|minor", "description": "what could go wrong" }
  ],
  "suggestedAmendments": [
    { "description": "what to strengthen", "reason": "why it matters" }
  ],
  "confidence": 0.0-1.0
}

Focus on:
- What assumptions could be wrong?
- What happens under failure conditions?
- Are there security, performance, or reliability risks?
- What would a stress test or adversarial input reveal?
- Is the rollback plan actually workable?`;

const ARCHITECT_REVISE_PROMPT = `You are the Architect revising your plan based on council feedback.
You previously drafted a plan that received objections from the Precision and Adversarial reviewers.

Review their feedback carefully. Address all blocker and major objections.
For minor objections, address them if reasonable or explain why they're acceptable.

Respond with the REVISED plan as valid JSON (same schema as before):
{
  "goal": "...",
  "summary": "...",
  "filesToRead": [...],
  "filesToModify": [...],
  "nonGoals": [...],
  "risks": [...],
  "acceptanceCriteria": [...],
  "checksToRun": [...],
  "rollbackPlan": "...",
  "commitScope": "...",
  "pushAllowed": true/false
}`;

// ── Config ───────────────────────────────────────────────────────────────────

export interface PlanCouncilConfig {
  maxRounds: number;
  sessionId: string;
}

// ── Service ──────────────────────────────────────────────────────────────────

export class PlanCouncilService {

  /**
   * Draft a structured plan using the architect provider.
   */
  async draftPlan(
    request: string,
    context: string,
    architect: AIProvider,
  ): Promise<CouncilPlan> {
    const messages = [
      { role: 'system', content: ARCHITECT_PLAN_PROMPT },
      { role: 'user', content: `Request: ${request}\n\nRepository context:\n${context}` },
    ];

    const raw = await architect.chat(messages);
    const plan = this._parseJson<CouncilPlan>(raw, 'plan');

    // Ensure planHash is set
    plan.planHash = sha256(JSON.stringify(plan));
    return plan;
  }

  /**
   * Review a plan from a specific reviewer role.
   */
  async reviewPlan(
    plan: CouncilPlan,
    reviewer: AIProvider,
    role: CouncilRoleType,
  ): Promise<PlanReview> {
    const systemPrompt = role === 'precision'
      ? PRECISION_REVIEW_PROMPT
      : ADVERSARIAL_REVIEW_PROMPT;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Plan to review:\n${JSON.stringify(plan, null, 2)}` },
    ];

    const raw = await reviewer.chat(messages);
    const parsed = this._parseJson<{
      approved: boolean;
      objections: Array<{ severity: string; description: string }>;
      suggestedAmendments: Array<{ description: string; reason: string }>;
      confidence: number;
    }>(raw, 'review');

    return {
      provider: reviewer.name,
      role,
      approved: parsed.approved,
      objections: (parsed.objections || []).map((o): PlanObjection => ({
        provider: reviewer.name,
        severity: (o.severity as PlanObjection['severity']) || 'minor',
        description: o.description,
      })),
      suggestedAmendments: (parsed.suggestedAmendments || []).map((a): PlanAmendment => ({
        round: 0, // filled in by caller
        proposedBy: reviewer.name,
        description: a.description,
        accepted: false,
        reason: a.reason,
      })),
      confidence: Math.max(0, Math.min(1, parsed.confidence || 0.5)),
    };
  }

  /**
   * Revise the plan based on reviewer feedback.
   */
  async revisePlan(
    plan: CouncilPlan,
    reviews: PlanReview[],
    architect: AIProvider,
  ): Promise<CouncilPlan> {
    const feedback = reviews.map(r => ({
      reviewer: r.provider,
      role: r.role,
      approved: r.approved,
      objections: r.objections,
      suggestedAmendments: r.suggestedAmendments,
    }));

    const messages = [
      { role: 'system', content: ARCHITECT_REVISE_PROMPT },
      { role: 'user', content: [
        'Original plan:',
        JSON.stringify(plan, null, 2),
        '',
        'Council feedback:',
        JSON.stringify(feedback, null, 2),
      ].join('\n') },
    ];

    const raw = await architect.chat(messages);
    const revised = this._parseJson<CouncilPlan>(raw, 'revised plan');
    revised.planHash = sha256(JSON.stringify(revised));
    return revised;
  }

  /**
   * Run the full plan council: draft → review → revise loop.
   * Returns an ApprovedPlanSnapshot when consensus is reached or max rounds hit.
   */
  async runPlanCouncil(
    request: string,
    context: string,
    roles: CouncilRole[],
    providers: Map<ProviderName, AIProvider>,
    config: PlanCouncilConfig,
  ): Promise<ApprovedPlanSnapshot> {
    const architect = this._findRole(roles, providers, 'architect');
    const reviewers = this._findReviewers(roles, providers);

    let plan: CouncilPlan | null = null;
    let allReviews: PlanReview[] = [];
    let allAmendments: PlanAmendment[] = [];
    let round = 0;

    for (round = 1; round <= config.maxRounds; round++) {
      // Draft or revise
      eventBus.emit({ type: 'PLAN_DRAFT_STARTED', sessionId: config.sessionId, round });

      if (round === 1) {
        plan = await this.draftPlan(request, context, architect);
      } else {
        plan = await this.revisePlan(plan!, allReviews, architect);
        eventBus.emit({
          type: 'PLAN_REVISION',
          sessionId: config.sessionId,
          round,
          amendmentCount: allAmendments.length,
        });
      }

      // Review
      allReviews = [];
      for (const { provider, role } of reviewers) {
        const review = await this.reviewPlan(plan, provider, role);
        review.objections.forEach(o => { o.resolution = undefined; });
        review.suggestedAmendments.forEach(a => { a.round = round; });
        allReviews.push(review);
        allAmendments.push(...review.suggestedAmendments);

        eventBus.emit({
          type: 'PLAN_REVIEW_SUBMITTED',
          sessionId: config.sessionId,
          provider: provider.name,
          role,
          approved: review.approved,
        });
      }

      // Check consensus
      const allApproved = allReviews.every(r => r.approved);
      if (allApproved) {
        break;
      }

      // Check for blockers that can't be resolved
      const hasBlockers = allReviews.some(r =>
        r.objections.some(o => o.severity === 'blocker')
      );
      if (hasBlockers && round === config.maxRounds) {
        eventBus.emit({
          type: 'PLAN_BLOCKED',
          sessionId: config.sessionId,
          reason: 'Unresolved blocker objections after max rounds',
        });
      }
    }

    const approvedBy = allReviews
      .filter(r => r.approved)
      .map(r => r.provider);

    // Always include architect as approver (they wrote it)
    if (!approvedBy.includes(architect.name)) {
      approvedBy.unshift(architect.name);
    }

    const snapshot: ApprovedPlanSnapshot = {
      plan: plan!,
      reviews: allReviews,
      amendments: allAmendments,
      planHash: plan!.planHash,
      approvedBy,
      round,
    };

    eventBus.emit({
      type: 'PLAN_APPROVED',
      sessionId: config.sessionId,
      planHash: snapshot.planHash,
      approvedBy,
    });

    return snapshot;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private _findRole(
    roles: CouncilRole[],
    providers: Map<ProviderName, AIProvider>,
    roleType: CouncilRoleType,
  ): AIProvider {
    const match = roles.find(r => r.role === roleType);
    if (!match) { throw new Error(`No ${roleType} role assigned`); }
    const provider = providers.get(match.provider);
    if (!provider) { throw new Error(`Provider ${match.provider} not available for ${roleType} role`); }
    return provider;
  }

  private _findReviewers(
    roles: CouncilRole[],
    providers: Map<ProviderName, AIProvider>,
  ): Array<{ provider: AIProvider; role: CouncilRoleType }> {
    return roles
      .filter(r => r.role !== 'architect')
      .map(r => {
        const provider = providers.get(r.provider);
        if (!provider) { return null; }
        return { provider, role: r.role };
      })
      .filter((r): r is { provider: AIProvider; role: CouncilRoleType } => r !== null);
  }

  private _parseJson<T>(raw: string, label: string): T {
    // Strip markdown code fences if present
    let cleaned = raw.trim();
    if (cleaned.startsWith('```')) {
      cleaned = cleaned.replace(/^```(?:json)?\s*\n?/, '').replace(/\n?```\s*$/, '');
    }
    try {
      return JSON.parse(cleaned) as T;
    } catch {
      throw new Error(`Failed to parse ${label} JSON from provider response: ${cleaned.substring(0, 200)}`);
    }
  }
}
