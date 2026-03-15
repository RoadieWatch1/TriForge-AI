import {
  AuthorImplementationDraft,
  AuthorPlan,
  AuthorRebuttal,
  RepoContextSnapshot,
  ReviewSession,
  SubmissionArtifact,
  TaskDraft,
} from './ReviewTypes';
import {
  AuthorCoordinator,
  BuildAuthorPlanInput,
  BuildImplementationDraftInput,
  BuildRebuttalInput,
} from './AuthorCoordinator';
import { ReviewerCoordinator } from './ReviewerCoordinator';
import { ReconciliationEngine } from './ReconciliationEngine';
import { ReviewSessionStore } from './ReviewSessionStore';
import { SubmissionGate, SubmissionGateResult } from './SubmissionGate';

function nowIso(): string {
  return new Date().toISOString();
}

function makeId(prefix: string): string {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

function uniqueStrings(values: Array<string | undefined | null>): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  for (const value of values) {
    const normalized = value?.trim();
    if (!normalized) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    out.push(normalized);
  }

  return out;
}

function includesAny(haystack: string, needles: string[]): boolean {
  return needles.some((needle) => haystack.includes(needle));
}

type TaskKind =
  | 'bugfix'
  | 'feature'
  | 'refactor'
  | 'tests'
  | 'security'
  | 'performance'
  | 'docs'
  | 'review'
  | 'build';

type RiskProfile = 'low' | 'medium' | 'high' | 'critical';

interface TaskExecutionProfile {
  kind: TaskKind;
  risk: RiskProfile;
  fileBias: string[];
  summary: string;
  authorFocus: string[];
  reviewerFocus: string[];
  verificationFocus: Array<'lint' | 'typecheck' | 'test' | 'build' | 'reproduce_bug' | 'smoke_check'>;
}

type ReviewerId = 'reviewer_a' | 'reviewer_b';

export interface CreateTaskDraftInput {
  userRequest: string;
  objective: string;
  acceptanceCriteria?: string[];
  constraints?: string[];
  repoContext: RepoContextSnapshot;
}

export interface ReviewRuntimeDependencies {
  sessionStore?: ReviewSessionStore;
  authorCoordinator?: AuthorCoordinator;
  reviewerCoordinator?: ReviewerCoordinator;
  reconciliationEngine?: ReconciliationEngine;
  submissionGate?: SubmissionGate;
}

export interface RunTaskOptions {
  sessionId?: string;
  activeAgentIds?: string[];
  relevantInsights?: string[];
  implementationNotes?: string[];
  touchedFiles?: string[];
  rationale?: string;
  draftNotes?: string[];
  knownRisks?: string[];
  rebuttalStrategy?: BuildRebuttalInput['responseStrategy'];
  rebuttalSummaryHint?: string;
}

export interface RunTaskResult {
  session: ReviewSession;
  gate: SubmissionGateResult;
}

export class ReviewRuntime {
  private readonly sessionStore: ReviewSessionStore;
  private readonly authorCoordinator: AuthorCoordinator;
  private readonly reviewerCoordinator: ReviewerCoordinator;
  private readonly reconciliationEngine: ReconciliationEngine;
  private readonly submissionGate: SubmissionGate;

  constructor(deps: ReviewRuntimeDependencies = {}) {
    this.sessionStore = deps.sessionStore ?? new ReviewSessionStore();
    this.authorCoordinator = deps.authorCoordinator ?? new AuthorCoordinator();
    this.reviewerCoordinator = deps.reviewerCoordinator ?? new ReviewerCoordinator();
    this.reconciliationEngine = deps.reconciliationEngine ?? new ReconciliationEngine();
    this.submissionGate = deps.submissionGate ?? new SubmissionGate();
  }

  getSessionStore(): ReviewSessionStore {
    return this.sessionStore;
  }

  createTaskDraft(input: CreateTaskDraftInput): TaskDraft {
    const profile = this.classifyTaskDraftInput(input);

    return {
      id: makeId('task'),
      createdAtIso: nowIso(),
      userRequest: input.userRequest,
      objective: input.objective,
      acceptanceCriteria: uniqueStrings([
        ...(input.acceptanceCriteria ?? []),
        ...this.defaultAcceptanceCriteria(profile.kind),
      ]),
      constraints: uniqueStrings([
        ...(input.constraints ?? []),
        ...this.defaultConstraints(profile),
      ]),
      repoContext: input.repoContext,
    };
  }

  createSession(task: TaskDraft, activeAgentIds: string[] = []): ReviewSession {
    return this.sessionStore.createSession({
      id: makeId('review_session'),
      task,
      activeAgentIds,
    });
  }

  runTask(task: TaskDraft, options: RunTaskOptions = {}): RunTaskResult {
    const profile = this.classifyTask(task);
    const normalizedTask = this.enrichTaskForExecution(task, profile, options);

    const sessionId =
      options.sessionId && this.sessionStore.hasSession(options.sessionId)
        ? options.sessionId
        : this.sessionStore.createSession({
            id: options.sessionId ?? makeId('review_session'),
            task: normalizedTask,
            activeAgentIds: options.activeAgentIds ?? [],
          }).id;

    this.sessionStore.clearBlockedState(sessionId);
    this.sessionStore.replaceTask(sessionId, normalizedTask);
    this.sessionStore.setActiveAgents(sessionId, options.activeAgentIds ?? []);
    this.sessionStore.updateStatus(sessionId, 'active');
    this.sessionStore.updatePhase(sessionId, 'investigating');
    this.sessionStore.updatePhase(sessionId, 'planning');

    const authorPlan = this.buildAuthorPlan(normalizedTask, profile, options);
    this.sessionStore.setAuthorPlan(sessionId, authorPlan);

    this.sessionStore.updatePhase(sessionId, 'plan_review');
    const planReviewDecisions = this.buildPlanReviews(normalizedTask, authorPlan, profile);
    this.sessionStore.setPlanReviewDecisions(sessionId, planReviewDecisions);

    this.sessionStore.updatePhase(sessionId, 'implementing');
    const implementationDraft = this.buildImplementationDraft(
      normalizedTask,
      authorPlan,
      profile,
      options,
    );
    this.sessionStore.setImplementationDraft(sessionId, implementationDraft);

    this.sessionStore.updatePhase(sessionId, 'code_review');
    const codeReviewDecisions = this.buildCodeReviews(
      normalizedTask,
      authorPlan,
      implementationDraft,
      profile,
    );
    this.sessionStore.setCodeReviewDecisions(sessionId, codeReviewDecisions);

    this.sessionStore.updatePhase(sessionId, 'reconciling');
    const rebuttal = this.buildRebuttal(
      normalizedTask,
      authorPlan,
      implementationDraft,
      [...planReviewDecisions, ...codeReviewDecisions],
      profile,
      options,
    );
    this.sessionStore.setRebuttal(sessionId, rebuttal);

    const reconciliation = this.reconciliationEngine.reconcile({
      planReviewDecisions,
      codeReviewDecisions,
      rebuttal,
    });
    this.sessionStore.setReconciliation(sessionId, reconciliation);

    const verification = this.createVerificationRun(
      normalizedTask,
      profile,
      authorPlan,
      implementationDraft,
      reconciliation.mustDoBeforeSubmit,
    );

    this.sessionStore.updatePhase(sessionId, 'verifying');
    this.sessionStore.setVerification(sessionId, verification);

    const afterVerification = this.sessionStore.getSession(sessionId);
    if (!afterVerification) {
      throw new Error(`ReviewRuntime: session "${sessionId}" vanished unexpectedly`);
    }

    const gate = this.submissionGate.evaluate(afterVerification);

    if (gate.allowed && gate.artifact) {
      this.sessionStore.updateStatus(sessionId, 'active');
      this.sessionStore.updatePhase(sessionId, 'ready_for_submission');
      this.sessionStore.setSubmission(sessionId, gate.artifact);
    } else {
      const status = gate.status === 'draft' ? 'active' : 'blocked';
      const reason = gate.reasons.join(' | ') || 'Submission gate blocked the session.';
      this.sessionStore.updateStatus(sessionId, status, status === 'blocked' ? reason : undefined);

      if (status === 'active') {
        this.sessionStore.updatePhase(sessionId, 'repairing');
      }
    }

    const finalSession = this.sessionStore.getSession(sessionId);
    if (!finalSession) {
      throw new Error(`ReviewRuntime: final session "${sessionId}" not found`);
    }

    return {
      session: finalSession,
      gate,
    };
  }

  submitSession(sessionId: string): ReviewSession {
    const session = this.sessionStore.getSession(sessionId);
    if (!session) {
      throw new Error(`ReviewRuntime: session "${sessionId}" not found`);
    }

    const gate = this.submissionGate.evaluate(session);
    if (!gate.allowed || !gate.artifact) {
      throw new Error(
        `ReviewRuntime: session "${sessionId}" is not ready for submission: ${gate.reasons.join(
          '; ',
        )}`,
      );
    }

    const submittedArtifact: SubmissionArtifact = {
      ...gate.artifact,
      status: 'submitted',
      preparedAtIso: nowIso(),
    };

    this.sessionStore.setSubmission(sessionId, submittedArtifact);
    this.sessionStore.updatePhase(sessionId, 'submitted');
    this.sessionStore.updateStatus(sessionId, 'active');

    const submittedSession = this.sessionStore.getSession(sessionId);
    if (!submittedSession) {
      throw new Error(`ReviewRuntime: submitted session "${sessionId}" not found`);
    }

    return submittedSession;
  }

  private buildAuthorPlan(
    task: TaskDraft,
    profile: TaskExecutionProfile,
    options: RunTaskOptions,
  ): AuthorPlan {
    const input: BuildAuthorPlanInput = {
      task,
      relevantInsights: uniqueStrings([
        ...(options.relevantInsights ?? []),
        ...profile.authorFocus,
        `Task profile: ${profile.summary}`,
        `Risk profile: ${profile.risk}`,
        ...profile.fileBias.map((bias) => `Prioritize files matching: ${bias}`),
      ]),
      implementationNotes: uniqueStrings([
        ...(options.implementationNotes ?? []),
        ...profile.reviewerFocus.map((focus) => `Plan must account for: ${focus}`),
      ]),
    };

    return this.authorCoordinator.buildPlan(input);
  }

  private buildImplementationDraft(
    task: TaskDraft,
    plan: AuthorPlan,
    profile: TaskExecutionProfile,
    options: RunTaskOptions,
  ): AuthorImplementationDraft {
    const input: BuildImplementationDraftInput = {
      task,
      plan,
      touchedFiles: uniqueStrings([
        ...(options.touchedFiles ?? []),
        ...(task.repoContext.relevantFiles ?? []).map((f) => f.path),
      ]),
      rationale: uniqueStrings([
        options.rationale,
        `Execution profile: ${profile.summary}`,
        ...profile.authorFocus,
      ]).join(' | '),
      notes: uniqueStrings([
        ...(options.draftNotes ?? []),
        ...profile.reviewerFocus.map((focus) => `Implementation must survive review for: ${focus}`),
      ]),
      knownRisks: uniqueStrings([
        ...(options.knownRisks ?? []),
        ...this.deriveKnownRisks(task, profile),
      ]),
    };

    return this.authorCoordinator.buildImplementationDraft(input);
  }

  private buildPlanReviews(
    task: TaskDraft,
    plan: AuthorPlan,
    profile: TaskExecutionProfile,
  ) {
    const reviewerOrder = this.selectReviewerOrder(profile);

    return reviewerOrder.map((reviewer) =>
      this.reviewerCoordinator.buildPlanReview({
        reviewer,
        task,
        plan,
      }),
    );
  }

  private buildCodeReviews(
    task: TaskDraft,
    plan: AuthorPlan,
    implementationDraft: AuthorImplementationDraft,
    profile: TaskExecutionProfile,
  ) {
    const reviewerOrder = this.selectReviewerOrder(profile);

    return reviewerOrder.map((reviewer) =>
      this.reviewerCoordinator.buildCodeReview({
        reviewer,
        task,
        plan,
        implementationDraft,
      }),
    );
  }

  private buildRebuttal(
    task: TaskDraft,
    plan: AuthorPlan,
    implementationDraft: AuthorImplementationDraft,
    reviewDecisions: ReturnType<ReviewRuntime['buildPlanReviews']>[number][],
    profile: TaskExecutionProfile,
    options: RunTaskOptions,
  ): AuthorRebuttal {
    const input: BuildRebuttalInput = {
      task,
      plan,
      implementationDraft,
      reviewDecisions,
      responseStrategy: options.rebuttalStrategy,
      summaryHint:
        options.rebuttalSummaryHint ??
        [
          `Defend only what is structurally justified.`,
          `Concede valid reviewer findings quickly.`,
          `Task profile: ${profile.summary}.`,
          `Priority review areas: ${profile.reviewerFocus.join('; ') || 'general correctness'}.`,
        ].join(' '),
    };

    return this.authorCoordinator.buildRebuttal(input);
  }

  private createVerificationRun(
    task: TaskDraft,
    profile: TaskExecutionProfile,
    plan: AuthorPlan,
    implementationDraft: AuthorImplementationDraft,
    mustDoBeforeSubmit: string[],
  ) {
    const verificationSteps = this.buildVerificationChecklist(task, profile, plan);
    const blocked = mustDoBeforeSubmit.length > 0;
    const startIso = nowIso();
    const finishIso = nowIso();

    const checks = verificationSteps.map((intent) => {
      const summary = blocked
        ? `Verification blocked until reviewer-required fixes are resolved for ${intent}.`
        : this.buildVerificationSummary(intent, implementationDraft.fileChanges.length, profile);

      return {
        intent,
        status: blocked ? ('blocked' as const) : ('passed' as const),
        summary,
        details: blocked ? mustDoBeforeSubmit.join('; ') : undefined,
        startedAtIso: startIso,
        finishedAtIso: finishIso,
      };
    });

    return {
      id: makeId('verification'),
      status: blocked ? ('blocked' as const) : ('passed' as const),
      checks,
      startedAtIso: startIso,
      finishedAtIso: finishIso,
      retryCount: 0,
    };
  }

  private buildVerificationChecklist(
    task: TaskDraft,
    profile: TaskExecutionProfile,
    plan: AuthorPlan,
  ): Array<'lint' | 'typecheck' | 'test' | 'build' | 'reproduce_bug' | 'smoke_check'> {
    const fromPlan = (plan.verificationPlan ?? []).map((step) => this.mapVerificationIntent(step));
    const fromRepoContext = (task.repoContext.verificationIntents ?? []).map((intent) => intent);
    const fromProfile = profile.verificationFocus;

    const ordered = [
      ...fromRepoContext,
      ...fromPlan,
      ...fromProfile,
      'lint' as const,
      'typecheck' as const,
    ];

    const seen = new Set<string>();
    const deduped: Array<
      'lint' | 'typecheck' | 'test' | 'build' | 'reproduce_bug' | 'smoke_check'
    > = [];

    for (const step of ordered) {
      if (seen.has(step)) continue;
      seen.add(step);
      deduped.push(step);
    }

    return deduped;
  }

  private buildVerificationSummary(
    intent: 'lint' | 'typecheck' | 'test' | 'build' | 'reproduce_bug' | 'smoke_check',
    fileChangeCount: number,
    profile: TaskExecutionProfile,
  ): string {
    switch (intent) {
      case 'lint':
        return `Lint verification placeholder recorded for ${fileChangeCount} changed file(s).`;
      case 'typecheck':
        return `Type safety verification placeholder recorded for ${fileChangeCount} changed file(s).`;
      case 'test':
        return profile.kind === 'bugfix'
          ? `Regression-test verification placeholder recorded for the bug-fix path.`
          : `Test verification placeholder recorded for changed behavior and edge cases.`;
      case 'build':
        return `Build verification placeholder recorded for integration readiness.`;
      case 'reproduce_bug':
        return `Bug reproduction / no-regression verification placeholder recorded.`;
      case 'smoke_check':
      default:
        return `Smoke-check verification placeholder recorded for execution sanity.`;
    }
  }

  private mapVerificationIntent(
    step: string,
  ): 'lint' | 'typecheck' | 'test' | 'build' | 'reproduce_bug' | 'smoke_check' {
    const normalized = step.trim().toLowerCase();

    if (normalized.includes('lint')) return 'lint';
    if (normalized.includes('type')) return 'typecheck';
    if (normalized.includes('test')) return 'test';
    if (normalized.includes('build')) return 'build';
    if (normalized.includes('reproduce')) return 'reproduce_bug';
    return 'smoke_check';
  }

  private classifyTaskDraftInput(input: CreateTaskDraftInput): TaskExecutionProfile {
    return this.classifyTask({
      id: 'draft_preview',
      createdAtIso: nowIso(),
      userRequest: input.userRequest,
      objective: input.objective,
      acceptanceCriteria: input.acceptanceCriteria ?? [],
      constraints: input.constraints ?? [],
      repoContext: input.repoContext,
    });
  }

  private classifyTask(task: TaskDraft): TaskExecutionProfile {
    const text = [
      task.userRequest,
      task.objective,
      ...(task.acceptanceCriteria ?? []),
      ...(task.constraints ?? []),
      ...(task.repoContext.notes ?? []),
      ...(task.repoContext.relevantFiles ?? []).map((f) => `${f.path} ${f.reason}`),
    ]
      .join(' ')
      .toLowerCase();

    const fileText = (task.repoContext.relevantFiles ?? [])
      .map((f) => f.path.toLowerCase())
      .join(' ');

    const isSecurity =
      includesAny(text, [
        'auth',
        'token',
        'jwt',
        'secret',
        'password',
        'permission',
        'payment',
        'billing',
        'checkout',
        'encryption',
        'security',
      ]) || includesAny(fileText, ['auth', 'token', 'secret', 'payment', 'billing', 'vault']);

    const isTests = includesAny(text, ['test', 'coverage', 'spec', 'regression', 'assert']) ||
      includesAny(fileText, ['.test.', '.spec.', '__tests__']);

    const isDocs = includesAny(text, ['docs', 'documentation', 'readme', 'markdown']) ||
      includesAny(fileText, ['readme', '.md']);

    const isBuild =
      includesAny(text, ['build', 'bundle', 'compile', 'webpack', 'vite', 'esbuild', 'pipeline']) ||
      includesAny(fileText, ['package.json', 'tsconfig', 'vite.config', 'webpack', 'esbuild']);

    const isReview =
      includesAny(text, ['review existing', 'audit', 'inspect', 'analyze', 'code review']) &&
      !includesAny(text, ['implement', 'build feature']);

    const isRefactor =
      includesAny(text, ['refactor', 'cleanup', 'clean up', 'restructure', 'modularize']) &&
      !includesAny(text, ['bug', 'broken']);

    const isPerformance = includesAny(text, [
      'performance',
      'slow',
      'optimize',
      'memory',
      'latency',
      'throughput',
      'faster',
    ]);

    const isBugfix = includesAny(text, [
      'bug',
      'fix',
      'broken',
      'error',
      'failing',
      'issue',
      'incorrect',
      'regression',
      'not working',
    ]);

    const kind: TaskKind = isSecurity
      ? 'security'
      : isTests
      ? 'tests'
      : isDocs
      ? 'docs'
      : isBuild
      ? 'build'
      : isReview
      ? 'review'
      : isRefactor
      ? 'refactor'
      : isPerformance
      ? 'performance'
      : isBugfix
      ? 'bugfix'
      : 'feature';

    const diagnostics = task.repoContext.diagnostics ?? [];
    const hasErrors = diagnostics.some((d) => d.severity === 'error');
    const highRiskFiles = includesAny(fileText, [
      'auth',
      'token',
      'payment',
      'billing',
      'checkout',
      'vault',
      'permission',
    ]);

    const risk: RiskProfile =
      kind === 'security' || highRiskFiles
        ? 'critical'
        : hasErrors || kind === 'build' || kind === 'performance'
        ? 'high'
        : kind === 'bugfix' || kind === 'refactor' || kind === 'review'
        ? 'medium'
        : 'low';

    const fileBias = this.deriveFileBias(task, kind);
    const authorFocus = this.deriveAuthorFocus(kind, risk);
    const reviewerFocus = this.deriveReviewerFocus(kind, risk);
    const verificationFocus = this.deriveVerificationFocus(kind, risk);

    return {
      kind,
      risk,
      fileBias,
      summary: `${kind} task under ${risk} risk`,
      authorFocus,
      reviewerFocus,
      verificationFocus,
    };
  }

  private enrichTaskForExecution(
    task: TaskDraft,
    profile: TaskExecutionProfile,
    options: RunTaskOptions,
  ): TaskDraft {
    const repoNotes = uniqueStrings([
      ...(task.repoContext.notes ?? []),
      `Execution profile: ${profile.summary}.`,
      ...profile.authorFocus.map((focus) => `Author focus: ${focus}`),
      ...profile.reviewerFocus.map((focus) => `Reviewer focus: ${focus}`),
      ...(options.implementationNotes ?? []).map((note) => `Operator note: ${note}`),
    ]);

    const enrichedContext: RepoContextSnapshot = {
      ...task.repoContext,
      notes: repoNotes,
      verificationIntents: this.buildRepositoryVerificationIntentSet(task, profile),
    };

    return {
      ...task,
      acceptanceCriteria: uniqueStrings([
        ...(task.acceptanceCriteria ?? []),
        ...this.defaultAcceptanceCriteria(profile.kind),
      ]),
      constraints: uniqueStrings([
        ...(task.constraints ?? []),
        ...this.defaultConstraints(profile),
      ]),
      repoContext: enrichedContext,
    };
  }

  private buildRepositoryVerificationIntentSet(
    task: TaskDraft,
    profile: TaskExecutionProfile,
  ): Array<'lint' | 'typecheck' | 'test' | 'build'> {
    const base = (task.repoContext.verificationIntents ?? []).filter(
      (
        step,
      ): step is 'lint' | 'typecheck' | 'test' | 'build' =>
        step === 'lint' ||
        step === 'typecheck' ||
        step === 'test' ||
        step === 'build',
    );

    const mapped = profile.verificationFocus.filter(
      (
        step,
      ): step is 'lint' | 'typecheck' | 'test' | 'build' =>
        step === 'lint' ||
        step === 'typecheck' ||
        step === 'test' ||
        step === 'build',
    );

    const out: Array<'lint' | 'typecheck' | 'test' | 'build'> = [];
    const seen = new Set<string>();

    for (const step of [...base, ...mapped]) {
      if (seen.has(step)) continue;
      seen.add(step);
      out.push(step);
    }

    return out;
  }

  private defaultAcceptanceCriteria(kind: TaskKind): string[] {
    switch (kind) {
      case 'bugfix':
        return [
          'Root cause is addressed, not only the symptom.',
          'No obvious regression path is introduced.',
        ];
      case 'security':
        return [
          'Security-sensitive behavior is hardened against misuse.',
          'No secret, token, or privileged flow is weakened.',
        ];
      case 'tests':
        return [
          'Tests cover happy path, edge cases, and failure path where applicable.',
        ];
      case 'refactor':
        return [
          'Behavior remains equivalent unless explicitly requested otherwise.',
          'Readability and maintainability improve measurably.',
        ];
      case 'build':
        return [
          'Build / compile path remains valid after changes.',
        ];
      case 'docs':
        return [
          'Documentation matches actual implementation behavior.',
        ];
      default:
        return [
          'Implementation is complete and internally consistent.',
        ];
    }
  }

  private defaultConstraints(profile: TaskExecutionProfile): string[] {
    const base = [
      'Do not drift outside the requested scope without justification.',
      'Prefer concrete, reviewable changes over vague placeholders.',
    ];

    if (profile.risk === 'high' || profile.risk === 'critical') {
      base.push('Preserve safety and correctness over speed.');
      base.push('Assume reviewers will challenge weak assumptions.');
    }

    if (profile.kind === 'refactor') {
      base.push('Keep public behavior stable unless change is explicitly required.');
    }

    if (profile.kind === 'tests') {
      base.push('Avoid shallow tests that only mirror implementation.');
    }

    return base;
  }

  private deriveFileBias(task: TaskDraft, kind: TaskKind): string[] {
    const relevant = task.repoContext.relevantFiles ?? [];
    const bias = relevant
      .map((f) => f.path)
      .slice(0, 6);

    if (kind === 'tests') bias.push('__tests__', '.test.', '.spec.');
    if (kind === 'build') bias.push('package.json', 'tsconfig', 'build config');
    if (kind === 'docs') bias.push('.md', 'README');

    return uniqueStrings(bias);
  }

  private deriveAuthorFocus(kind: TaskKind, risk: RiskProfile): string[] {
    const focus: string[] = [];

    switch (kind) {
      case 'bugfix':
        focus.push('Fix root cause before polishing downstream symptoms.');
        focus.push('Minimize regression surface.');
        break;
      case 'feature':
        focus.push('Implement the requested behavior completely.');
        focus.push('Keep scope tight and explicit.');
        break;
      case 'refactor':
        focus.push('Improve structure without silently changing behavior.');
        focus.push('Reduce complexity and preserve intent.');
        break;
      case 'tests':
        focus.push('Write meaningful tests, not cosmetic coverage.');
        focus.push('Cover failure paths and edge cases.');
        break;
      case 'security':
        focus.push('Default to safe behavior under misuse.');
        focus.push('Harden sensitive flows before optimizing convenience.');
        break;
      case 'performance':
        focus.push('Remove obvious inefficiency without harming correctness.');
        focus.push('Prefer measurable simplification.');
        break;
      case 'docs':
        focus.push('Make documentation match system reality exactly.');
        break;
      case 'review':
        focus.push('Surface the real technical risks clearly and directly.');
        break;
      case 'build':
        focus.push('Keep the toolchain and integration path stable.');
        break;
    }

    if (risk === 'high' || risk === 'critical') {
      focus.push('Treat correctness as higher priority than speed.');
    }

    return focus;
  }

  private deriveReviewerFocus(kind: TaskKind, risk: RiskProfile): string[] {
    const focus: string[] = [
      'Look for hidden scope drift.',
      'Challenge weak assumptions and missing edge cases.',
    ];

    if (kind === 'bugfix') {
      focus.push('Verify the claimed root cause is actually fixed.');
      focus.push('Look for regressions around the same execution path.');
    }

    if (kind === 'feature') {
      focus.push('Check completeness of behavior and integration touchpoints.');
    }

    if (kind === 'refactor') {
      focus.push('Look for accidental behavior changes behind structure cleanup.');
    }

    if (kind === 'tests') {
      focus.push('Reject weak or overly coupled tests.');
    }

    if (kind === 'security') {
      focus.push('Probe privilege, validation, and secret-handling assumptions.');
    }

    if (kind === 'performance') {
      focus.push('Check that optimization claims are not just speculative.');
    }

    if (kind === 'build') {
      focus.push('Check config, environment, and dependency breakage risk.');
    }

    if (risk === 'critical') {
      focus.push('Apply adversarial scrutiny to misuse and failure modes.');
    }

    return focus;
  }

  private deriveVerificationFocus(
    kind: TaskKind,
    risk: RiskProfile,
  ): Array<'lint' | 'typecheck' | 'test' | 'build' | 'reproduce_bug' | 'smoke_check'> {
    const steps: Array<'lint' | 'typecheck' | 'test' | 'build' | 'reproduce_bug' | 'smoke_check'> =
      ['lint', 'typecheck', 'smoke_check'];

    if (
      kind === 'bugfix' ||
      kind === 'tests' ||
      kind === 'feature' ||
      kind === 'security' ||
      risk === 'high' ||
      risk === 'critical'
    ) {
      steps.push('test');
    }

    if (kind === 'build' || kind === 'feature' || risk === 'high' || risk === 'critical') {
      steps.push('build');
    }

    if (kind === 'bugfix') {
      steps.push('reproduce_bug');
    }

    return steps;
  }

  private deriveKnownRisks(task: TaskDraft, profile: TaskExecutionProfile): string[] {
    const risks = [...(task.constraints ?? [])];

    if (profile.kind === 'security') {
      risks.push('Security-sensitive task. Weak validation or leakage is unacceptable.');
    }

    if (profile.kind === 'bugfix') {
      risks.push('Bug-fix tasks often pass superficially while leaving root cause intact.');
    }

    if (profile.kind === 'refactor') {
      risks.push('Refactors can silently change behavior while appearing cleaner.');
    }

    if (profile.kind === 'build') {
      risks.push('Build/config changes can break unrelated project paths.');
    }

    if ((task.repoContext.diagnostics ?? []).some((d) => d.severity === 'error')) {
      risks.push('Repository snapshot already contains diagnostics errors.');
    }

    return uniqueStrings(risks);
  }

  private selectReviewerOrder(profile: TaskExecutionProfile): ReviewerId[] {
    if (profile.risk === 'critical' || profile.kind === 'security') {
      return ['reviewer_b', 'reviewer_a'];
    }

    if (profile.kind === 'refactor' || profile.kind === 'review') {
      return ['reviewer_a', 'reviewer_b'];
    }

    return ['reviewer_a', 'reviewer_b'];
  }
}