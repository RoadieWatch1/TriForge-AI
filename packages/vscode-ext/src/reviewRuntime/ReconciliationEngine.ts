import {
  AuthorRebuttal,
  ReconciliationOutcome,
  ReviewActorRole,
  ReviewDecision,
  ReviewFinding,
  WinningAlignment,
} from './ReviewTypes';

function nowIso(): string {
  return new Date().toISOString();
}

type ReviewerRole = 'reviewer_a' | 'reviewer_b';

interface ReviewerPosition {
  reviewer: ReviewerRole;
  supportsAuthor: boolean;
  mustFixIds: string[];
  findings: ReviewFinding[];
  verdict: ReviewDecision['verdict'];
  summary: string;
}

export interface ReconciliationInput {
  planReviewDecisions?: ReviewDecision[];
  codeReviewDecisions?: ReviewDecision[];
  rebuttal?: AuthorRebuttal;
}

export class ReconciliationEngine {
  reconcile(input: ReconciliationInput): ReconciliationOutcome {
    const decisions = [
      ...(input.planReviewDecisions ?? []),
      ...(input.codeReviewDecisions ?? []),
    ];

    const reviewerAPosition = this.buildReviewerPosition(
      'reviewer_a',
      decisions,
      input.rebuttal,
    );

    const reviewerBPosition = this.buildReviewerPosition(
      'reviewer_b',
      decisions,
      input.rebuttal,
    );

    const acceptedFindingIds = this.getAcceptedFindingIds(input.rebuttal);
    const rejectedFindingIds = this.getRejectedFindingIds(input.rebuttal);

    const authorAllies: ReviewerRole[] = [];
    if (reviewerAPosition.supportsAuthor) authorAllies.push('reviewer_a');
    if (reviewerBPosition.supportsAuthor) authorAllies.push('reviewer_b');

    const reviewersAlignedAgainstAuthor =
      !reviewerAPosition.supportsAuthor && !reviewerBPosition.supportsAuthor;

    let winningAlignment: WinningAlignment;
    let alignedActors: ReviewActorRole[];
    let summary: string;
    let mustDoBeforeSubmit: string[];
    let unresolvedRisks: string[];

    if (authorAllies.includes('reviewer_a')) {
      winningAlignment = 'author_reviewer_a';
      alignedActors = ['author', 'reviewer_a'];
      mustDoBeforeSubmit = this.unique([
        ...reviewerAPosition.mustFixIds,
        ...(reviewerBPosition.supportsAuthor ? reviewerBPosition.mustFixIds : []),
      ]);
      unresolvedRisks = this.buildUnresolvedRisks(
        reviewerBPosition.findings,
        acceptedFindingIds,
      );
      summary = this.buildSummary(
        winningAlignment,
        reviewerAPosition,
        reviewerBPosition,
      );
    } else if (authorAllies.includes('reviewer_b')) {
      winningAlignment = 'author_reviewer_b';
      alignedActors = ['author', 'reviewer_b'];
      mustDoBeforeSubmit = this.unique([
        ...reviewerBPosition.mustFixIds,
        ...(reviewerAPosition.supportsAuthor ? reviewerAPosition.mustFixIds : []),
      ]);
      unresolvedRisks = this.buildUnresolvedRisks(
        reviewerAPosition.findings,
        acceptedFindingIds,
      );
      summary = this.buildSummary(
        winningAlignment,
        reviewerAPosition,
        reviewerBPosition,
      );
    } else if (reviewersAlignedAgainstAuthor) {
      winningAlignment = 'reviewer_a_reviewer_b';
      alignedActors = ['reviewer_a', 'reviewer_b'];
      mustDoBeforeSubmit = this.unique([
        ...reviewerAPosition.mustFixIds,
        ...reviewerBPosition.mustFixIds,
      ]);
      unresolvedRisks = this.buildUnresolvedRisks(
        [...reviewerAPosition.findings, ...reviewerBPosition.findings],
        acceptedFindingIds,
      );
      summary = this.buildSummary(
        winningAlignment,
        reviewerAPosition,
        reviewerBPosition,
      );
    } else {
      // Conservative fallback: if alignment is unclear, reviewers win.
      winningAlignment = 'reviewer_a_reviewer_b';
      alignedActors = ['reviewer_a', 'reviewer_b'];
      mustDoBeforeSubmit = this.unique([
        ...reviewerAPosition.mustFixIds,
        ...reviewerBPosition.mustFixIds,
      ]);
      unresolvedRisks = this.buildUnresolvedRisks(
        [...reviewerAPosition.findings, ...reviewerBPosition.findings],
        acceptedFindingIds,
      );
      summary =
        'Alignment remained unclear after rebuttal. Defaulting to reviewer consensus for safety.';
    }

    return {
      winningAlignment,
      alignedActors,
      summary,
      mustDoBeforeSubmit,
      unresolvedRisks,
      reviewerFindingsAccepted: acceptedFindingIds,
      reviewerFindingsRejected: rejectedFindingIds,
      decidedAtIso: nowIso(),
    };
  }

  private buildReviewerPosition(
    reviewer: ReviewerRole,
    decisions: ReviewDecision[],
    rebuttal?: AuthorRebuttal,
  ): ReviewerPosition {
    const ownDecisions = decisions.filter((decision) => decision.reviewer === reviewer);
    const findings = ownDecisions.flatMap((decision) => decision.findings);
    const mustFixIds = this.unique(ownDecisions.flatMap((decision) => decision.mustFixIds));
    const acceptedFindingIds = new Set(this.getAcceptedFindingIds(rebuttal));
    const partialFindingIds = new Set(this.getPartiallyAcceptedFindingIds(rebuttal));
    const rejectedFindingIds = new Set(this.getRejectedFindingIds(rebuttal));

    const verdict = this.combineVerdicts(ownDecisions);
    const blockingFindingIds = this.unique(
      findings
        .filter(
          (finding) =>
            finding.severity === 'critical' || finding.severity === 'high',
        )
        .map((finding) => finding.id),
    );

    const unresolvedMustFix = mustFixIds.filter(
      (id) => !acceptedFindingIds.has(id) && !partialFindingIds.has(id),
    );

    const unresolvedBlocking = blockingFindingIds.filter(
      (id) => !acceptedFindingIds.has(id) && !partialFindingIds.has(id),
    );

    const reviewerHadStrongRejection =
      verdict === 'reject' || verdict === 'revise_required';

    const reviewerExplicitlyRejectedAll =
      mustFixIds.length > 0 &&
      mustFixIds.every((id) => rejectedFindingIds.has(id)) &&
      !acceptedFindingIds.size &&
      !partialFindingIds.size;

    const supportsAuthor =
      !reviewerHadStrongRejection ||
      (!unresolvedMustFix.length && !unresolvedBlocking.length && !reviewerExplicitlyRejectedAll);

    return {
      reviewer,
      supportsAuthor,
      mustFixIds: supportsAuthor ? [] : this.unique([...unresolvedMustFix, ...unresolvedBlocking]),
      findings,
      verdict,
      summary: this.buildReviewerSummary(
        reviewer,
        verdict,
        supportsAuthor,
        unresolvedMustFix.length,
        unresolvedBlocking.length,
      ),
    };
  }

  private combineVerdicts(
    decisions: ReviewDecision[],
  ): ReviewDecision['verdict'] {
    if (!decisions.length) return 'approve';

    const verdicts = decisions.map((decision) => decision.verdict);

    if (verdicts.includes('reject')) return 'reject';
    if (verdicts.includes('revise_required')) return 'revise_required';
    if (verdicts.includes('approve_with_notes')) return 'approve_with_notes';
    return 'approve';
  }

  private buildReviewerSummary(
    reviewer: ReviewerRole,
    verdict: ReviewDecision['verdict'],
    supportsAuthor: boolean,
    unresolvedMustFixCount: number,
    unresolvedBlockingCount: number,
  ): string {
    if (supportsAuthor) {
      if (verdict === 'approve') {
        return `${reviewer} approved the submission path.`;
      }
      return `${reviewer} accepted the author's path after review and rebuttal.`;
    }

    return `${reviewer} still requires revision (${unresolvedMustFixCount} unresolved must-fix item(s), ${unresolvedBlockingCount} blocking risk(s)).`;
  }

  private buildSummary(
    alignment: WinningAlignment,
    reviewerA: ReviewerPosition,
    reviewerB: ReviewerPosition,
  ): string {
    if (alignment === 'author_reviewer_a') {
      return `Author and reviewer_a aligned on the final path. reviewer_b concerns remain advisory unless resolved before submit. ${reviewerA.summary} ${reviewerB.summary}`;
    }

    if (alignment === 'author_reviewer_b') {
      return `Author and reviewer_b aligned on the final path. reviewer_a concerns remain advisory unless resolved before submit. ${reviewerB.summary} ${reviewerA.summary}`;
    }

    return `Both reviewers aligned against the current author path, so reviewer consensus wins. ${reviewerA.summary} ${reviewerB.summary}`;
  }

  private buildUnresolvedRisks(
    findings: ReviewFinding[],
    acceptedFindingIds: string[],
  ): string[] {
    const accepted = new Set(acceptedFindingIds);

    return this.unique(
      findings
        .filter((finding) => !accepted.has(finding.id))
        .filter(
          (finding) =>
            finding.severity === 'critical' ||
            finding.severity === 'high' ||
            finding.severity === 'medium',
        )
        .map((finding) => {
          const location = finding.filePath
            ? ` (${finding.filePath}${finding.lineStart ? `:${finding.lineStart}` : ''})`
            : '';
          return `[${finding.category}] ${finding.title}${location}`;
        }),
    );
  }

  private getAcceptedFindingIds(rebuttal?: AuthorRebuttal): string[] {
    if (!rebuttal) return [];
    return rebuttal.responses
      .filter((response) => response.disposition === 'accept')
      .map((response) => response.findingId);
  }

  private getPartiallyAcceptedFindingIds(rebuttal?: AuthorRebuttal): string[] {
    if (!rebuttal) return [];
    return rebuttal.responses
      .filter((response) => response.disposition === 'partially_accept')
      .map((response) => response.findingId);
  }

  private getRejectedFindingIds(rebuttal?: AuthorRebuttal): string[] {
    if (!rebuttal) return [];
    return rebuttal.responses
      .filter((response) => response.disposition === 'reject')
      .map((response) => response.findingId);
  }

  private unique<T>(values: T[]): T[] {
    return Array.from(new Set(values));
  }
}