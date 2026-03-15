import {
  ReconciliationOutcome,
  ReviewDecision,
  ReviewSession,
  SubmissionArtifact,
  SubmissionStatus,
  VerificationCheckResult,
  VerificationRun,
} from './ReviewTypes';

function nowIso(): string {
  return new Date().toISOString();
}

export interface SubmissionGateResult {
  allowed: boolean;
  status: SubmissionStatus;
  reasons: string[];
  artifact?: SubmissionArtifact;
}

export class SubmissionGate {
  evaluate(session: ReviewSession): SubmissionGateResult {
    const reasons: string[] = [];

    if (!session.authorPlan) {
      reasons.push('Author plan is missing.');
    }

    if (!session.implementationDraft) {
      reasons.push('Implementation draft is missing.');
    }

    const planReviewCheck = this.validateReviewCoverage(
      session.planReviewDecisions,
      'plan',
    );
    reasons.push(...planReviewCheck.reasons);

    const codeReviewCheck = this.validateReviewCoverage(
      session.codeReviewDecisions,
      'code',
    );
    reasons.push(...codeReviewCheck.reasons);

    if (!session.reconciliation) {
      reasons.push('Reconciliation outcome is missing.');
    } else {
      reasons.push(...this.validateReconciliation(session.reconciliation));
    }

    if (!session.verification) {
      reasons.push('Verification run is missing.');
    } else {
      reasons.push(...this.validateVerification(session.verification));
    }

    if (session.status === 'blocked' || session.phase === 'blocked') {
      reasons.push(session.blockedReason ?? 'Session is blocked.');
    }

    if (reasons.length > 0) {
      return {
        allowed: false,
        status: this.deriveBlockedStatus(session),
        reasons: this.unique(reasons),
      };
    }

    const artifact = this.buildSubmissionArtifact(session);

    return {
      allowed: true,
      status: 'ready',
      reasons: [],
      artifact,
    };
  }

  private validateReviewCoverage(
    decisions: ReviewDecision[],
    scope: 'plan' | 'code',
  ): { ok: boolean; reasons: string[] } {
    const reasons: string[] = [];
    const scopeDecisions = decisions.filter((decision) => decision.scope === scope);

    if (scopeDecisions.length < 2) {
      reasons.push(
        `Expected 2 ${scope} review decisions, found ${scopeDecisions.length}.`,
      );
      return { ok: false, reasons };
    }

    const reviewerA = scopeDecisions.find((decision) => decision.reviewer === 'reviewer_a');
    const reviewerB = scopeDecisions.find((decision) => decision.reviewer === 'reviewer_b');

    if (!reviewerA) {
      reasons.push(`Missing reviewer_a ${scope} review decision.`);
    }

    if (!reviewerB) {
      reasons.push(`Missing reviewer_b ${scope} review decision.`);
    }

    if (reviewerA && scope === 'plan' && !reviewerA.approvedPlan) {
      reasons.push('reviewer_a has not approved the plan.');
    }

    if (reviewerB && scope === 'plan' && !reviewerB.approvedPlan) {
      reasons.push('reviewer_b has not approved the plan.');
    }

    if (reviewerA && scope === 'code' && !reviewerA.approvedCode) {
      reasons.push('reviewer_a has not approved the code.');
    }

    if (reviewerB && scope === 'code' && !reviewerB.approvedCode) {
      reasons.push('reviewer_b has not approved the code.');
    }

    return {
      ok: reasons.length === 0,
      reasons,
    };
  }

  private validateReconciliation(reconciliation: ReconciliationOutcome): string[] {
    const reasons: string[] = [];

    if (!reconciliation.alignedActors.length || reconciliation.alignedActors.length < 2) {
      reasons.push('Reconciliation must contain at least two aligned actors.');
    }

    if (reconciliation.mustDoBeforeSubmit.length > 0) {
      reasons.push(
        `Submission blocked by unresolved must-fix items: ${reconciliation.mustDoBeforeSubmit.join(
          ', ',
        )}.`,
      );
    }

    return reasons;
  }

  private validateVerification(verification: VerificationRun): string[] {
    const reasons: string[] = [];

    if (verification.status !== 'passed') {
      reasons.push(`Verification status is ${verification.status}, not passed.`);
    }

    const failedChecks = verification.checks.filter(
      (check) => check.status !== 'passed',
    );

    if (failedChecks.length > 0) {
      reasons.push(
        `Verification has non-passing checks: ${failedChecks
          .map((check) => this.describeCheck(check))
          .join('; ')}.`,
      );
    }

    return reasons;
  }

  private buildSubmissionArtifact(session: ReviewSession): SubmissionArtifact {
    const verification = session.verification as VerificationRun;
    const reconciliation = session.reconciliation as ReconciliationOutcome;

    return {
      taskId: session.task.id,
      status: 'ready',
      finalSummary: this.buildFinalSummary(session),
      finalApproach: session.authorPlan?.summary ?? 'Final approach not recorded.',
      authorPlan: session.authorPlan!,
      implementationDraft: session.implementationDraft,
      planReviewDecisions: session.planReviewDecisions,
      codeReviewDecisions: session.codeReviewDecisions,
      rebuttal: session.rebuttal,
      reconciliation,
      verification,
      filesTouched: this.unique(
        session.implementationDraft?.fileChanges.map((change) => change.filePath) ?? [],
      ),
      remainingRisks: reconciliation.unresolvedRisks,
      commitMessageDraft: this.buildCommitMessageDraft(session),
      preparedAtIso: nowIso(),
    };
  }

  private buildFinalSummary(session: ReviewSession): string {
    const planSummary = session.authorPlan?.summary ?? 'No plan summary available.';
    const implementationSummary =
      session.implementationDraft?.summary ?? 'No implementation summary available.';
    const reconciliationSummary =
      session.reconciliation?.summary ?? 'No reconciliation summary available.';
    const verificationSummary = this.buildVerificationSummary(session.verification);

    return [
      planSummary,
      implementationSummary,
      reconciliationSummary,
      verificationSummary,
    ].join(' ');
  }

  private buildVerificationSummary(verification?: VerificationRun): string {
    if (!verification) {
      return 'Verification not run.';
    }

    const passedChecks = verification.checks
      .filter((check) => check.status === 'passed')
      .map((check) => check.intent);

    if (!passedChecks.length) {
      return `Verification finished with status ${verification.status}.`;
    }

    return `Verification passed for: ${passedChecks.join(', ')}.`;
  }

  private buildCommitMessageDraft(session: ReviewSession): string {
    const files = this.unique(
      session.implementationDraft?.fileChanges.map((change) => change.filePath) ?? [],
    );

    const scope =
      files.length === 1
        ? this.extractScopeFromPath(files[0])
        : files.length > 1
        ? 'workspace'
        : 'extension';

    const summary = session.authorPlan?.summary ?? 'reviewed implementation update';

    return `${scope}: ${this.toCommitLine(summary)}`;
  }

  private extractScopeFromPath(filePath: string): string {
    const normalized = filePath.replace(/\\/g, '/');
    const segments = normalized.split('/').filter(Boolean);

    if (!segments.length) {
      return 'workspace';
    }

    if (segments.length === 1) {
      return segments[0];
    }

    return segments[segments.length - 2] || 'workspace';
  }

  private toCommitLine(summary: string): string {
    return summary
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/[.!?]+$/g, '')
      .slice(0, 72);
  }

  private deriveBlockedStatus(session: ReviewSession): SubmissionStatus {
    if (!session.authorPlan || !session.implementationDraft) {
      return 'draft';
    }

    if (!session.reconciliation) {
      return 'awaiting_review';
    }

    if (!session.verification || session.verification.status !== 'passed') {
      return 'awaiting_verification';
    }

    return 'blocked';
  }

  private describeCheck(check: VerificationCheckResult): string {
    return `${check.intent}=${check.status}`;
  }

  private unique<T>(values: T[]): T[] {
    return Array.from(new Set(values));
  }
}