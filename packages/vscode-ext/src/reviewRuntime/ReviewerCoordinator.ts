import {
  AuthorImplementationDraft,
  AuthorPlan,
  ReviewDecision,
  ReviewDecisionScope,
  ReviewFinding,
  ReviewFindingCategory,
  ReviewVerdict,
  TaskDraft,
} from './ReviewTypes';

function nowIso(): string {
  return new Date().toISOString();
}

function makeFindingId(
  reviewer: 'reviewer_a' | 'reviewer_b',
  scope: ReviewDecisionScope,
  category: ReviewFindingCategory,
  index: number,
): string {
  return `${reviewer}_${scope}_${category}_${Date.now()}_${index}`;
}

export interface BuildPlanReviewInput {
  reviewer: 'reviewer_a' | 'reviewer_b';
  task: TaskDraft;
  plan: AuthorPlan;
}

export interface BuildCodeReviewInput {
  reviewer: 'reviewer_a' | 'reviewer_b';
  task: TaskDraft;
  plan: AuthorPlan;
  implementationDraft: AuthorImplementationDraft;
}

export class ReviewerCoordinator {
  buildPlanReview(input: BuildPlanReviewInput): ReviewDecision {
    const findings =
      input.reviewer === 'reviewer_a'
        ? this.buildReviewerAPlanFindings(input.task, input.plan)
        : this.buildReviewerBPlanFindings(input.task, input.plan);

    return this.buildDecision(input.reviewer, 'plan', findings);
  }

  buildCodeReview(input: BuildCodeReviewInput): ReviewDecision {
    const findings =
      input.reviewer === 'reviewer_a'
        ? this.buildReviewerACodeFindings(input.task, input.plan, input.implementationDraft)
        : this.buildReviewerBCodeFindings(input.task, input.plan, input.implementationDraft);

    return this.buildDecision(input.reviewer, 'code', findings);
  }

  private buildDecision(
    reviewer: 'reviewer_a' | 'reviewer_b',
    scope: ReviewDecisionScope,
    findings: ReviewFinding[],
  ): ReviewDecision {
    const verdict = this.deriveVerdict(findings);
    const mustFixIds = findings
      .filter((finding) => finding.severity === 'critical' || finding.severity === 'high')
      .map((finding) => finding.id);

    const approved = verdict === 'approve' || verdict === 'approve_with_notes';

    return {
      reviewer,
      scope,
      verdict,
      summary: this.buildDecisionSummary(reviewer, scope, verdict, findings),
      findings,
      mustFixIds,
      approvedPlan: scope === 'plan' ? approved : true,
      approvedCode: scope === 'code' ? approved : true,
      reviewedAtIso: nowIso(),
    };
  }

  private deriveVerdict(findings: ReviewFinding[]): ReviewVerdict {
    if (!findings.length) return 'approve';
    if (findings.some((finding) => finding.severity === 'critical')) return 'reject';
    if (findings.some((finding) => finding.severity === 'high')) return 'revise_required';
    if (findings.some((finding) => finding.severity === 'medium')) return 'approve_with_notes';
    return 'approve_with_notes';
  }

  private buildDecisionSummary(
    reviewer: 'reviewer_a' | 'reviewer_b',
    scope: ReviewDecisionScope,
    verdict: ReviewVerdict,
    findings: ReviewFinding[],
  ): string {
    if (!findings.length) {
      return `${reviewer} approved the ${scope} with no findings.`;
    }

    const critical = findings.filter((finding) => finding.severity === 'critical').length;
    const high = findings.filter((finding) => finding.severity === 'high').length;
    const medium = findings.filter((finding) => finding.severity === 'medium').length;

    return `${reviewer} reviewed the ${scope} and returned ${verdict} with ${findings.length} finding(s) (${critical} critical, ${high} high, ${medium} medium).`;
  }

  private buildReviewerAPlanFindings(task: TaskDraft, plan: AuthorPlan): ReviewFinding[] {
    const findings: ReviewFinding[] = [];
    let index = 0;

    if (!plan.filesLikelyToChange.length) {
      findings.push(
        this.makeFinding(
          'reviewer_a',
          'plan',
          'scope',
          'high',
          'Plan does not identify target files',
          'The plan needs likely file targets before implementation can be reviewed seriously.',
          undefined,
          undefined,
          ++index,
        ),
      );
    }

    if (plan.filesLikelyToChange.length > 12) {
      findings.push(
        this.makeFinding(
          'reviewer_a',
          'plan',
          'simplicity',
          'medium',
          'Plan scope is too broad',
          'The plan touches too many files and risks becoming a workspace-wide refactor instead of a focused change.',
          undefined,
          'Reduce the touched file list to the smallest realistic set.',
          ++index,
        ),
      );
    }

    if (!plan.nonGoals.length) {
      findings.push(
        this.makeFinding(
          'reviewer_a',
          'plan',
          'maintainability',
          'medium',
          'Plan does not define non-goals',
          'Without non-goals, the author can drift into unnecessary implementation work.',
          undefined,
          'Add explicit non-goals that fence off unrelated areas.',
          ++index,
        ),
      );
    }

    if (!plan.risks.length) {
      findings.push(
        this.makeFinding(
          'reviewer_a',
          'plan',
          'architecture',
          'medium',
          'Plan does not record any risks',
          'Every meaningful coding task should acknowledge at least a few plausible failure or regression risks.',
          undefined,
          'Add the main interface, dependency, and regression risks.',
          ++index,
        ),
      );
    }

    const acceptanceCoverage = task.acceptanceCriteria.filter((criterion) =>
      plan.goals.some((goal) => this.includesNormalized(goal, criterion)),
    );

    if (task.acceptanceCriteria.length > 0 && acceptanceCoverage.length === 0) {
      findings.push(
        this.makeFinding(
          'reviewer_a',
          'plan',
          'scope',
          'high',
          'Plan goals do not clearly cover acceptance criteria',
          'The plan should map more directly to the requested acceptance criteria before implementation begins.',
          undefined,
          'Rewrite goals so they directly reflect the task acceptance criteria.',
          ++index,
        ),
      );
    }

    return findings;
  }

  private buildReviewerBPlanFindings(task: TaskDraft, plan: AuthorPlan): ReviewFinding[] {
    const findings: ReviewFinding[] = [];
    let index = 0;

    if (!plan.verificationPlan.length) {
      findings.push(
        this.makeFinding(
          'reviewer_b',
          'plan',
          'verification',
          'high',
          'Plan does not include verification',
          'A coding plan without lint, test, typecheck, or build coverage is not ready for implementation.',
          undefined,
          'Add concrete verification steps to prove the change works.',
          ++index,
        ),
      );
    }

    if (plan.verificationPlan.length > 0 && !plan.verificationPlan.some((step) => /test|typecheck|lint|build/i.test(step))) {
      findings.push(
        this.makeFinding(
          'reviewer_b',
          'plan',
          'tests',
          'medium',
          'Verification plan is too vague',
          'The plan references verification, but it does not clearly include any meaningful engineering checks.',
          undefined,
          'State the exact checks that should run after the code is written.',
          ++index,
        ),
      );
    }

    if (task.repoContext.diagnostics.length > 0 && !plan.risks.some((risk) => /existing/i.test(risk))) {
      findings.push(
        this.makeFinding(
          'reviewer_b',
          'plan',
          'correctness',
          'medium',
          'Plan ignores current diagnostics',
          'The repo snapshot already contains diagnostics, but the plan does not mention how they affect the change.',
          undefined,
          'Call out whether existing diagnostics are in scope, out of scope, or blockers.',
          ++index,
        ),
      );
    }

    if (!plan.implementationNotes.length) {
      findings.push(
        this.makeFinding(
          'reviewer_b',
          'plan',
          'maintainability',
          'low',
          'Plan has no implementation notes',
          'Implementation notes help anchor the author to the intended constraints and file reasons.',
          undefined,
          'Add brief implementation notes tied to the most relevant files.',
          ++index,
        ),
      );
    }

    return findings;
  }

  private buildReviewerACodeFindings(
    task: TaskDraft,
    plan: AuthorPlan,
    implementationDraft: AuthorImplementationDraft,
  ): ReviewFinding[] {
    const findings: ReviewFinding[] = [];
    let index = 0;

    const plannedFiles = new Set(plan.filesLikelyToChange);
    const changedFiles = implementationDraft.fileChanges.map((change) => change.filePath);

    const unplannedFiles = changedFiles.filter((file) => !plannedFiles.has(file));
    if (unplannedFiles.length > 0) {
      findings.push(
        this.makeFinding(
          'reviewer_a',
          'code',
          'scope',
          'high',
          'Implementation changed files outside the plan',
          `The draft includes files that were not named in the plan: ${unplannedFiles.join(', ')}.`,
          unplannedFiles[0],
          'Either update the plan and justify the expansion, or remove the extra file changes.',
          ++index,
        ),
      );
    }

    if (!implementationDraft.fileChanges.length) {
      findings.push(
        this.makeFinding(
          'reviewer_a',
          'code',
          'architecture',
          'critical',
          'Implementation draft has no file changes',
          'The draft claims to implement the plan, but no file-level change set is present.',
          undefined,
          'Provide concrete file changes before review can continue.',
          ++index,
        ),
      );
    }

    if (!implementationDraft.rationale || implementationDraft.rationale.trim().length < 20) {
      findings.push(
        this.makeFinding(
          'reviewer_a',
          'code',
          'maintainability',
          'medium',
          'Implementation rationale is too thin',
          'A serious submission should explain why this route is the right one.',
          undefined,
          'Expand the rationale with architectural reasoning and scope boundaries.',
          ++index,
        ),
      );
    }

    if (implementationDraft.fileChanges.length > Math.max(10, plan.filesLikelyToChange.length + 3)) {
      findings.push(
        this.makeFinding(
          'reviewer_a',
          'code',
          'simplicity',
          'medium',
          'Implementation appears broader than necessary',
          'The number of changed files suggests the author may be over-solving the task.',
          undefined,
          'Trim the implementation to the minimum necessary surface area.',
          ++index,
        ),
      );
    }

    if (task.constraints.length > 0) {
      const violatedConstraint = task.constraints.find((constraint) =>
        implementationDraft.notes.some((note) => this.includesNormalized(note, constraint)),
      );

      if (violatedConstraint) {
        findings.push(
          this.makeFinding(
            'reviewer_a',
            'code',
            'scope',
            'high',
            'Implementation may be colliding with a task constraint',
            `A draft note suggests the code path may violate a constraint: ${violatedConstraint}.`,
            undefined,
            'Re-check the implementation against the recorded task constraints.',
            ++index,
          ),
        );
      }
    }

    return findings;
  }

  private buildReviewerBCodeFindings(
    task: TaskDraft,
    plan: AuthorPlan,
    implementationDraft: AuthorImplementationDraft,
  ): ReviewFinding[] {
    const findings: ReviewFinding[] = [];
    let index = 0;

    if (!implementationDraft.patchIds.length || implementationDraft.patchIds.length !== implementationDraft.fileChanges.length) {
      findings.push(
        this.makeFinding(
          'reviewer_b',
          'code',
          'correctness',
          'high',
          'Patch tracking is incomplete',
          'Each proposed file change should have a corresponding patch id so the runtime can trace and verify it.',
          implementationDraft.fileChanges[0]?.filePath,
          'Ensure every file change produces a stable patch id.',
          ++index,
        ),
      );
    }

    if (!implementationDraft.knownRisks.length) {
      findings.push(
        this.makeFinding(
          'reviewer_b',
          'code',
          'regression_risk',
          'medium',
          'Implementation draft records no known risks',
          'The code draft should preserve the main regression concerns from the plan or add new ones discovered during implementation.',
          undefined,
          'Carry plan risks forward and add any new risks discovered while coding.',
          ++index,
        ),
      );
    }

    const missingVerificationCoverage =
      plan.verificationPlan.length > 0 &&
      !implementationDraft.notes.some((note) =>
        plan.verificationPlan.some((step) => this.includesNormalized(note, step)),
      );

    if (missingVerificationCoverage) {
      findings.push(
        this.makeFinding(
          'reviewer_b',
          'code',
          'verification',
          'medium',
          'Implementation notes do not connect back to verification',
          'The draft should acknowledge how the planned checks relate to the implementation surface.',
          undefined,
          'Tie the implementation back to the planned verification steps.',
          ++index,
        ),
      );
    }

    if (task.repoContext.diagnostics.length > 0) {
      const overlappingDiagnostic = task.repoContext.diagnostics.find((diag) =>
        implementationDraft.fileChanges.some((change) => change.filePath === diag.filePath),
      );

      if (overlappingDiagnostic) {
        findings.push(
          this.makeFinding(
            'reviewer_b',
            'code',
            'type_safety',
            overlappingDiagnostic.severity === 'error' ? 'high' : 'medium',
            'Implementation touches a file that already has diagnostics',
            `The draft changes ${overlappingDiagnostic.filePath}, which already has a ${overlappingDiagnostic.severity}: ${overlappingDiagnostic.message}`,
            overlappingDiagnostic.filePath,
            'Verify that the draft fixes or safely works around the existing diagnostic.',
            ++index,
          ),
        );
      }
    }

    const fileChangesWithoutSummary = implementationDraft.fileChanges.filter(
      (change) => !change.summary || change.summary.trim().length < 12,
    );

    if (fileChangesWithoutSummary.length > 0) {
      findings.push(
        this.makeFinding(
          'reviewer_b',
          'code',
          'maintainability',
          'low',
          'Some file changes are under-described',
          `The draft contains ${fileChangesWithoutSummary.length} file change(s) without a meaningful summary.`,
          fileChangesWithoutSummary[0]?.filePath,
          'Add clearer summaries so the user can understand why each file is changing.',
          ++index,
        ),
      );
    }

    return findings;
  }

  private makeFinding(
    reviewer: 'reviewer_a' | 'reviewer_b',
    scope: ReviewDecisionScope,
    category: ReviewFindingCategory,
    severity: ReviewFinding['severity'],
    title: string,
    detail: string,
    filePath: string | undefined,
    proposedChange: string | undefined,
    index: number,
  ): ReviewFinding {
    return {
      id: makeFindingId(reviewer, scope, category, index),
      reviewer,
      scope,
      category,
      severity,
      title,
      detail,
      filePath,
      proposedChange,
      confidence: this.deriveConfidence(severity),
    };
  }

  private deriveConfidence(severity: ReviewFinding['severity']): number {
    switch (severity) {
      case 'critical':
        return 0.98;
      case 'high':
        return 0.9;
      case 'medium':
        return 0.78;
      case 'low':
        return 0.64;
      default:
        return 0.55;
    }
  }

  private includesNormalized(haystack: string, needle: string): boolean {
    return haystack.trim().toLowerCase().includes(needle.trim().toLowerCase());
  }
}