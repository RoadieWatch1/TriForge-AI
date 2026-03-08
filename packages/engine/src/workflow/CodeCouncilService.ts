/**
 * CodeCouncilService — code generation against an approved plan only.
 *
 * Claude (architect) writes implementation from the approved plan + repo context.
 * OpenAI (precision) reviews for plan adherence, correctness, maintainability.
 * Grok (adversarial) reviews for edge cases, regressions, hidden risks.
 * Claude revises based on feedback. Scope drift detection enforced.
 */

import type { AIProvider } from '../core/providers/provider';
import type { ProviderName } from '../protocol';
import { sha256 } from '../core/hash';
import { eventBus } from '../core/eventBus';
import type {
  ApprovedPlanSnapshot,
  CouncilRole,
  CouncilRoleType,
  CodeReview,
  CodeFinding,
  CodeObjection,
  ImplementationFile,
  ImplementationSnapshot,
  ApprovedImplementation,
} from './councilWorkflowTypes';

// ── Role-Specific System Prompts ────────────────────────────────────────────

const ARCHITECT_CODE_PROMPT = `You are the Architect implementing code against an approved plan.
You MUST only modify files listed in the plan's filesToModify.
If you need to change files not in the plan, STOP and explain why.

Respond with valid JSON:
{
  "files": [
    {
      "filePath": "relative/path",
      "proposedContent": "full file content",
      "explanation": "why this change is needed"
    }
  ],
  "diffSummary": "one-paragraph summary of all changes"
}

Rules:
- Include the COMPLETE file content for each file, not just the changed parts
- Every change must trace back to a specific acceptance criterion in the plan
- Do not add features, refactoring, or improvements beyond the plan scope
- Maintain existing code style and conventions`;

const PRECISION_CODE_REVIEW_PROMPT = `You are the Precision Reviewer checking implementation against an approved plan.

Review the code and respond with valid JSON:
{
  "approved": true/false,
  "findings": [
    {
      "severity": "blocker|major|minor",
      "filePath": "path",
      "description": "issue description",
      "suggestedFix": "how to fix (optional)"
    }
  ],
  "requiredRevisions": ["specific changes needed"],
  "resolvedObjections": []
}

Focus on:
- Does the code match the plan's acceptance criteria?
- Are all planned files modified and no unplanned files changed?
- Is the code correct, complete, and maintainable?
- Are there type errors, logic bugs, or missing error handling?`;

const ADVERSARIAL_CODE_REVIEW_PROMPT = `You are the Adversarial Reviewer stress-testing implementation code.

Review the code and respond with valid JSON:
{
  "approved": true/false,
  "findings": [
    {
      "severity": "blocker|major|minor",
      "filePath": "path",
      "description": "what could go wrong",
      "suggestedFix": "how to fix (optional)"
    }
  ],
  "requiredRevisions": ["specific changes needed"],
  "resolvedObjections": []
}

Focus on:
- Edge cases: null, empty, overflow, concurrent access
- Regressions: does this break existing behavior?
- Security: injection, XSS, path traversal, secrets exposure
- Performance: O(n^2) loops, unbounded memory, blocking I/O
- Hidden risks: race conditions, resource leaks, error swallowing`;

const ARCHITECT_CODE_REVISE_PROMPT = `You are the Architect revising your implementation based on code review feedback.
Address all blocker and major findings. For minor findings, fix if reasonable.

Respond with the REVISED implementation as valid JSON (same schema):
{
  "files": [
    {
      "filePath": "relative/path",
      "proposedContent": "full file content",
      "explanation": "why this change is needed"
    }
  ],
  "diffSummary": "summary including what was revised"
}`;

// ── Config ───────────────────────────────────────────────────────────────────

export interface CodeCouncilConfig {
  maxRounds: number;
  sessionId: string;
}

// ── Service ──────────────────────────────────────────────────────────────────

export class CodeCouncilService {

  /**
   * Generate implementation from an approved plan.
   * Throws if no plan is provided.
   */
  async generateImplementation(
    planSnapshot: ApprovedPlanSnapshot,
    context: string,
    architect: AIProvider,
  ): Promise<ImplementationSnapshot> {
    const plan = planSnapshot.plan;

    const messages = [
      { role: 'system', content: ARCHITECT_CODE_PROMPT },
      { role: 'user', content: [
        'Approved plan:',
        JSON.stringify(plan, null, 2),
        '',
        'Repository context:',
        context,
      ].join('\n') },
    ];

    const raw = await architect.chat(messages);
    const parsed = this._parseJson<{
      files: Array<{ filePath: string; proposedContent: string; explanation: string }>;
      diffSummary: string;
    }>(raw, 'implementation');

    const files: ImplementationFile[] = (parsed.files || []).map(f => ({
      filePath: f.filePath,
      originalContent: '', // filled in by caller if needed
      proposedContent: f.proposedContent,
      explanation: f.explanation,
    }));

    const codeHash = sha256(files.map(f => f.proposedContent).join('\n'));

    return {
      files,
      diffSummary: parsed.diffSummary || '',
      codeHash,
      approvedBy: [],
    };
  }

  /**
   * Review implementation code from a specific reviewer role.
   */
  async reviewImplementation(
    impl: ImplementationSnapshot,
    planSnapshot: ApprovedPlanSnapshot,
    reviewer: AIProvider,
    role: CouncilRoleType,
  ): Promise<CodeReview> {
    const systemPrompt = role === 'precision'
      ? PRECISION_CODE_REVIEW_PROMPT
      : ADVERSARIAL_CODE_REVIEW_PROMPT;

    const messages = [
      { role: 'system', content: systemPrompt },
      { role: 'user', content: [
        'Approved plan:',
        JSON.stringify(planSnapshot.plan, null, 2),
        '',
        'Implementation to review:',
        JSON.stringify({
          files: impl.files.map(f => ({
            filePath: f.filePath,
            proposedContent: f.proposedContent.substring(0, 3000), // truncate for context
            explanation: f.explanation,
          })),
          diffSummary: impl.diffSummary,
        }, null, 2),
      ].join('\n') },
    ];

    const raw = await reviewer.chat(messages);
    const parsed = this._parseJson<{
      approved: boolean;
      findings: Array<{ severity: string; filePath: string; description: string; suggestedFix?: string }>;
      requiredRevisions: string[];
      resolvedObjections: Array<{ provider: string; severity: string; description: string; resolution?: string }>;
    }>(raw, 'code review');

    return {
      provider: reviewer.name,
      role,
      approved: parsed.approved,
      findings: (parsed.findings || []).map((f): CodeFinding => ({
        severity: (f.severity as CodeFinding['severity']) || 'minor',
        filePath: f.filePath || '',
        description: f.description,
        suggestedFix: f.suggestedFix,
      })),
      requiredRevisions: parsed.requiredRevisions || [],
      resolvedObjections: (parsed.resolvedObjections || []).map((o): CodeObjection => ({
        provider: (o.provider as ProviderName) || reviewer.name,
        severity: (o.severity as CodeObjection['severity']) || 'minor',
        description: o.description,
        resolution: o.resolution,
      })),
    };
  }

  /**
   * Revise implementation based on code review feedback.
   */
  async reviseImplementation(
    impl: ImplementationSnapshot,
    reviews: CodeReview[],
    planSnapshot: ApprovedPlanSnapshot,
    architect: AIProvider,
  ): Promise<ImplementationSnapshot> {
    const feedback = reviews.map(r => ({
      reviewer: r.provider,
      role: r.role,
      approved: r.approved,
      findings: r.findings,
      requiredRevisions: r.requiredRevisions,
    }));

    const messages = [
      { role: 'system', content: ARCHITECT_CODE_REVISE_PROMPT },
      { role: 'user', content: [
        'Approved plan:',
        JSON.stringify(planSnapshot.plan, null, 2),
        '',
        'Current implementation:',
        JSON.stringify({
          files: impl.files.map(f => ({
            filePath: f.filePath,
            proposedContent: f.proposedContent,
            explanation: f.explanation,
          })),
          diffSummary: impl.diffSummary,
        }, null, 2),
        '',
        'Code review feedback:',
        JSON.stringify(feedback, null, 2),
      ].join('\n') },
    ];

    const raw = await architect.chat(messages);
    const parsed = this._parseJson<{
      files: Array<{ filePath: string; proposedContent: string; explanation: string }>;
      diffSummary: string;
    }>(raw, 'revised implementation');

    const files: ImplementationFile[] = (parsed.files || []).map(f => ({
      filePath: f.filePath,
      originalContent: '',
      proposedContent: f.proposedContent,
      explanation: f.explanation,
    }));

    const codeHash = sha256(files.map(f => f.proposedContent).join('\n'));

    return {
      files,
      diffSummary: parsed.diffSummary || '',
      codeHash,
      approvedBy: [],
    };
  }

  /**
   * Detect scope drift: files changed that aren't in the approved plan.
   */
  detectScopeDrift(
    impl: ImplementationSnapshot,
    planSnapshot: ApprovedPlanSnapshot,
  ): string[] {
    const planned = new Set(planSnapshot.plan.filesToModify.map(f => f.toLowerCase()));
    return impl.files
      .map(f => f.filePath)
      .filter(fp => !planned.has(fp.toLowerCase()));
  }

  /**
   * Run the full code council: generate → review → revise loop.
   */
  async runCodeCouncil(
    planSnapshot: ApprovedPlanSnapshot,
    context: string,
    roles: CouncilRole[],
    providers: Map<ProviderName, AIProvider>,
    config: CodeCouncilConfig,
  ): Promise<ApprovedImplementation> {
    const architect = this._findRole(roles, providers, 'architect');
    const reviewers = this._findReviewers(roles, providers);

    let impl: ImplementationSnapshot | null = null;
    let allReviews: CodeReview[] = [];
    let round = 0;

    for (round = 1; round <= config.maxRounds; round++) {
      // Generate or revise
      if (round === 1) {
        eventBus.emit({
          type: 'CODE_DRAFT_STARTED',
          sessionId: config.sessionId,
          round,
          fileCount: planSnapshot.plan.filesToModify.length,
        });
        impl = await this.generateImplementation(planSnapshot, context, architect);
      } else {
        impl = await this.reviseImplementation(impl!, allReviews, planSnapshot, architect);
        eventBus.emit({
          type: 'CODE_REVISION',
          sessionId: config.sessionId,
          round,
          revisionCount: allReviews.reduce((n, r) => n + r.requiredRevisions.length, 0),
        });
      }

      // Scope drift check
      const drift = this.detectScopeDrift(impl, planSnapshot);
      if (drift.length > 0) {
        eventBus.emit({
          type: 'SCOPE_DRIFT_DETECTED',
          sessionId: config.sessionId,
          extraFiles: drift,
        });
        eventBus.emit({
          type: 'CODE_BLOCKED',
          sessionId: config.sessionId,
          reason: `Scope drift: files not in plan: ${drift.join(', ')}`,
        });
        // Remove drifted files and continue
        impl.files = impl.files.filter(f => !drift.includes(f.filePath));
      }

      // Review
      allReviews = [];
      for (const { provider, role } of reviewers) {
        const review = await this.reviewImplementation(impl, planSnapshot, provider, role);
        allReviews.push(review);

        eventBus.emit({
          type: 'CODE_REVIEW_SUBMITTED',
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

      if (round === config.maxRounds) {
        eventBus.emit({
          type: 'CODE_BLOCKED',
          sessionId: config.sessionId,
          reason: 'Unresolved code review findings after max rounds',
        });
      }
    }

    const approvedBy = allReviews
      .filter(r => r.approved)
      .map(r => r.provider);
    if (!approvedBy.includes(architect.name)) {
      approvedBy.unshift(architect.name);
    }
    impl!.approvedBy = approvedBy;

    const result: ApprovedImplementation = {
      snapshot: impl!,
      reviews: allReviews,
      round,
    };

    eventBus.emit({
      type: 'CODE_APPROVED',
      sessionId: config.sessionId,
      codeHash: impl!.codeHash,
      approvedBy,
    });

    return result;
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
