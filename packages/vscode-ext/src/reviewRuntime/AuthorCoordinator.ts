import {
  AuthorImplementationDraft,
  AuthorPlan,
  AuthorRebuttal,
  AuthorResponseDisposition,
  RepoContextSnapshot,
  ReviewDecision,
  ReviewFinding,
  TaskDraft,
} from './ReviewTypes';

function nowIso(): string {
  return new Date().toISOString();
}

function makeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

export interface BuildAuthorPlanInput {
  task: TaskDraft;
  relevantInsights?: string[];
  implementationNotes?: string[];
}

export interface BuildImplementationDraftInput {
  task: TaskDraft;
  plan: AuthorPlan;
  touchedFiles?: string[];
  rationale?: string;
  notes?: string[];
  knownRisks?: string[];
}

export interface BuildRebuttalInput {
  task: TaskDraft;
  plan?: AuthorPlan;
  implementationDraft?: AuthorImplementationDraft;
  reviewDecisions: ReviewDecision[];
  responseStrategy?: {
    acceptCategories?: ReviewFinding['category'][];
    rejectCategories?: ReviewFinding['category'][];
    partialAcceptCategories?: ReviewFinding['category'][];
  };
  summaryHint?: string;
}

export class AuthorCoordinator {
  buildPlan(input: BuildAuthorPlanInput): AuthorPlan {
    const repoContext = input.task.repoContext;
    const filesLikelyToChange = this.deriveFilesLikelyToChange(repoContext);
    const goals = this.deriveGoals(input.task);
    const nonGoals = this.deriveNonGoals(input.task);
    const risks = this.deriveRisks(repoContext);
    const verificationPlan = this.deriveVerificationPlan(repoContext);
    const implementationNotes = this.deriveImplementationNotes(
      repoContext,
      input.relevantInsights,
      input.implementationNotes,
    );

    return {
      summary: this.buildPlanSummary(input.task, filesLikelyToChange),
      goals,
      nonGoals,
      filesLikelyToChange,
      risks,
      verificationPlan,
      implementationNotes,
    };
  }

  buildImplementationDraft(
    input: BuildImplementationDraftInput,
  ): AuthorImplementationDraft {
    const fileChanges = this.deriveFileChanges(
      input.touchedFiles ?? input.plan.filesLikelyToChange,
      input.task.repoContext,
    );

    return {
      summary: this.buildImplementationSummary(input.plan, fileChanges.map((f) => f.filePath)),
      rationale:
        input.rationale ??
        `Implementation follows the approved author plan and targets the highest-confidence files for the requested change.`,
      fileChanges,
      notes: this.unique([
        ...(input.notes ?? []),
        ...input.plan.implementationNotes,
      ]),
      knownRisks: this.unique([
        ...(input.knownRisks ?? []),
        ...input.plan.risks,
      ]),
      patchIds: fileChanges.map((change) => makeId(`patch_${this.safeName(change.filePath)}`)),
    };
  }

  buildRebuttal(input: BuildRebuttalInput): AuthorRebuttal {
    const findings = this.uniqueFindings(input.reviewDecisions);
    const acceptCategories = new Set(input.responseStrategy?.acceptCategories ?? []);
    const rejectCategories = new Set(input.responseStrategy?.rejectCategories ?? []);
    const partialAcceptCategories = new Set(
      input.responseStrategy?.partialAcceptCategories ?? [],
    );

    const responses = findings.map((finding) => {
      const disposition = this.chooseDisposition(
        finding,
        acceptCategories,
        rejectCategories,
        partialAcceptCategories,
      );

      return {
        findingId: finding.id,
        disposition,
        rationale: this.buildFindingRationale(
          disposition,
          finding,
          input.task,
          input.plan,
          input.implementationDraft,
        ),
        changeSummary:
          disposition === 'reject'
            ? undefined
            : this.buildChangeSummaryForFinding(finding),
      };
    });

    return {
      summary:
        input.summaryHint ??
        this.buildRebuttalSummary(input.reviewDecisions, responses.map((r) => r.disposition)),
      responses,
      revisedPlanSummary: input.plan?.summary,
      revisedImplementationSummary: input.implementationDraft?.summary,
      respondedAtIso: nowIso(),
    };
  }

  private deriveGoals(task: TaskDraft): string[] {
    const goals = [
      task.objective,
      ...task.acceptanceCriteria,
    ].filter(Boolean);

    return this.unique(goals.length ? goals : ['Satisfy the user request safely and cleanly.']);
  }

  private deriveNonGoals(task: TaskDraft): string[] {
    if (task.constraints.length) {
      return task.constraints.map((constraint) => `Do not violate constraint: ${constraint}`);
    }

    return [
      'Do not expand scope beyond the requested coding task.',
      'Do not change unrelated files without review justification.',
    ];
  }

  private deriveFilesLikelyToChange(repoContext: RepoContextSnapshot): string[] {
    const sorted = [...repoContext.relevantFiles].sort((a, b) => b.confidence - a.confidence);
    return this.unique(sorted.slice(0, 8).map((file) => file.path));
  }

  private deriveRisks(repoContext: RepoContextSnapshot): string[] {
    const diagnosticRisks = repoContext.diagnostics.slice(0, 6).map((diag) => {
      const location =
        diag.line != null ? `${diag.filePath}:${diag.line}` : diag.filePath;
      return `Existing ${diag.severity} in ${location}: ${diag.message}`;
    });

    const repoNotes = repoContext.notes.map((note) => `Repo note: ${note}`);

    const fallback = [
      'Regression risk in neighboring call sites and related tests.',
      'Type or build breakage if interface changes ripple across the workspace.',
    ];

    return this.unique([...
      diagnosticRisks,
      ...repoNotes,
      ...fallback,
    ]).slice(0, 10);
  }

  private deriveVerificationPlan(repoContext: RepoContextSnapshot): string[] {
    const items = repoContext.verificationIntents.map((intent) => `Run ${intent}`);
    if (!items.length) {
      return ['Run targeted verification for impacted files'];
    }
    return this.unique(items);
  }

  private deriveImplementationNotes(
    repoContext: RepoContextSnapshot,
    relevantInsights?: string[],
    implementationNotes?: string[],
  ): string[] {
    const fileReasons = repoContext.relevantFiles.slice(0, 6).map((file) => {
      return `${file.path}: ${file.reason}`;
    });

    return this.unique([
      ...(relevantInsights ?? []),
      ...(implementationNotes ?? []),
      ...fileReasons,
    ]).slice(0, 12);
  }

  private buildPlanSummary(task: TaskDraft, filesLikelyToChange: string[]): string {
    const scope =
      filesLikelyToChange.length === 1
        ? filesLikelyToChange[0]
        : filesLikelyToChange.length > 1
        ? `${filesLikelyToChange.length} likely files`
        : 'the relevant workspace files';

    return `Implement the requested change for "${task.objective}" with a focused update across ${scope}.`;
  }

  private deriveFileChanges(
    filePaths: string[],
    repoContext: RepoContextSnapshot,
  ): AuthorImplementationDraft['fileChanges'] {
    const relevantByPath = new Map(repoContext.relevantFiles.map((file) => [file.path, file]));
    return this.unique(filePaths).map((filePath) => {
      const relevant = relevantByPath.get(filePath);
      return {
        filePath,
        changeType: 'modify' as const,
        summary: relevant
          ? `Update ${filePath} because ${relevant.reason}`
          : `Update ${filePath} to satisfy the reviewed task scope`,
        symbolsAffected: relevant?.symbolHints,
      };
    });
  }

  private buildImplementationSummary(plan: AuthorPlan, files: string[]): string {
    if (!files.length) {
      return `Implementation draft follows the plan but still needs concrete file targets.`;
    }

    if (files.length === 1) {
      return `Implementation draft updates ${files[0]} in line with the approved plan.`;
    }

    return `Implementation draft applies the approved plan across ${files.length} files.`;
  }

  private uniqueFindings(reviewDecisions: ReviewDecision[]): ReviewFinding[] {
    const byId = new Map<string, ReviewFinding>();
    for (const decision of reviewDecisions) {
      for (const finding of decision.findings) {
        if (!byId.has(finding.id)) {
          byId.set(finding.id, finding);
        }
      }
    }
    return Array.from(byId.values());
  }

  private chooseDisposition(
    finding: ReviewFinding,
    acceptCategories: Set<ReviewFinding['category']>,
    rejectCategories: Set<ReviewFinding['category']>,
    partialAcceptCategories: Set<ReviewFinding['category']>,
  ): AuthorResponseDisposition {
    if (rejectCategories.has(finding.category)) return 'reject';
    if (acceptCategories.has(finding.category)) return 'accept';
    if (partialAcceptCategories.has(finding.category)) return 'partially_accept';

    if (finding.severity === 'critical' || finding.severity === 'high') {
      return 'accept';
    }

    if (finding.category === 'simplicity' || finding.category === 'maintainability') {
      return 'partially_accept';
    }

    return 'accept';
  }

  private buildFindingRationale(
    disposition: AuthorResponseDisposition,
    finding: ReviewFinding,
    task: TaskDraft,
    plan?: AuthorPlan,
    implementationDraft?: AuthorImplementationDraft,
  ): string {
    const scopeRef = plan?.summary ?? implementationDraft?.summary ?? task.objective;

    if (disposition === 'accept') {
      return `Accepted because the finding improves the final submission without breaking the core task scope: ${scopeRef}.`;
    }

    if (disposition === 'partially_accept') {
      return `Partially accepted because the concern is valid, but the implementation should preserve the current task direction: ${scopeRef}.`;
    }

    return `Rejected because the current implementation path better serves the task objective while staying inside scope: ${scopeRef}.`;
  }

  private buildChangeSummaryForFinding(finding: ReviewFinding): string {
    const location = finding.filePath ? ` in ${finding.filePath}` : '';
    return `Address ${finding.category} concern${location} by revising the affected implementation details.`;
  }

  private buildRebuttalSummary(
    decisions: ReviewDecision[],
    dispositions: AuthorResponseDisposition[],
  ): string {
    const accepted = dispositions.filter((d) => d === 'accept').length;
    const partial = dispositions.filter((d) => d === 'partially_accept').length;
    const rejected = dispositions.filter((d) => d === 'reject').length;
    const reviewerCount = new Set(decisions.map((d) => d.reviewer)).size;

    return `Author responded to review from ${reviewerCount} reviewer(s): ${accepted} accepted, ${partial} partially accepted, ${rejected} rejected.`;
  }

  private safeName(value: string): string {
    return value.replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 40) || 'file';
  }

  private unique<T>(values: T[]): T[] {
    return Array.from(new Set(values));
  }
}