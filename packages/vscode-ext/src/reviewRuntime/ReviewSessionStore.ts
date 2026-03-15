import {
  AuthorImplementationDraft,
  AuthorPlan,
  AuthorRebuttal,
  ReconciliationOutcome,
  ReviewDecision,
  ReviewRuntimePhase,
  ReviewSession,
  ReviewSessionStatus,
  SubmissionArtifact,
  TaskDraft,
  VerificationRun,
} from './ReviewTypes';

function nowIso(): string {
  return new Date().toISOString();
}

function cloneSession(session: ReviewSession): ReviewSession {
  return JSON.parse(JSON.stringify(session)) as ReviewSession;
}

export interface CreateReviewSessionInput {
  id: string;
  task: TaskDraft;
  activeAgentIds?: string[];
}

export class ReviewSessionStore {
  private readonly sessions = new Map<string, ReviewSession>();

  createSession(input: CreateReviewSessionInput): ReviewSession {
    const timestamp = nowIso();

    const session: ReviewSession = {
      id: input.id,
      status: 'active',
      phase: 'idle',
      task: input.task,
      planReviewDecisions: [],
      codeReviewDecisions: [],
      activeAgentIds: input.activeAgentIds ?? [],
      createdAtIso: timestamp,
      updatedAtIso: timestamp,
    };

    this.sessions.set(session.id, session);
    return cloneSession(session);
  }

  getSession(sessionId: string): ReviewSession | undefined {
    const session = this.sessions.get(sessionId);
    return session ? cloneSession(session) : undefined;
  }

  hasSession(sessionId: string): boolean {
    return this.sessions.has(sessionId);
  }

  listSessions(): ReviewSession[] {
    return Array.from(this.sessions.values()).map(cloneSession);
  }

  deleteSession(sessionId: string): boolean {
    return this.sessions.delete(sessionId);
  }

  updatePhase(sessionId: string, phase: ReviewRuntimePhase): ReviewSession {
    return this.mutateSession(sessionId, (session) => {
      session.phase = phase;
      this.syncStatusWithPhase(session);
    });
  }

  updateStatus(sessionId: string, status: ReviewSessionStatus, blockedReason?: string): ReviewSession {
    return this.mutateSession(sessionId, (session) => {
      session.status = status;
      session.blockedReason = blockedReason;

      if (status === 'blocked') {
        session.phase = 'blocked';
      }
    });
  }

  setActiveAgents(sessionId: string, agentIds: string[]): ReviewSession {
    return this.mutateSession(sessionId, (session) => {
      session.activeAgentIds = [...agentIds];
    });
  }

  setAuthorPlan(sessionId: string, authorPlan: AuthorPlan): ReviewSession {
    return this.mutateSession(sessionId, (session) => {
      session.authorPlan = authorPlan;
    });
  }

  setImplementationDraft(sessionId: string, implementationDraft: AuthorImplementationDraft): ReviewSession {
    return this.mutateSession(sessionId, (session) => {
      session.implementationDraft = implementationDraft;
    });
  }

  setPlanReviewDecisions(sessionId: string, decisions: ReviewDecision[]): ReviewSession {
    return this.mutateSession(sessionId, (session) => {
      session.planReviewDecisions = [...decisions];
    });
  }

  addPlanReviewDecision(sessionId: string, decision: ReviewDecision): ReviewSession {
    return this.mutateSession(sessionId, (session) => {
      session.planReviewDecisions = [
        ...session.planReviewDecisions.filter((item) => item.reviewer !== decision.reviewer),
        decision,
      ];
    });
  }

  setCodeReviewDecisions(sessionId: string, decisions: ReviewDecision[]): ReviewSession {
    return this.mutateSession(sessionId, (session) => {
      session.codeReviewDecisions = [...decisions];
    });
  }

  addCodeReviewDecision(sessionId: string, decision: ReviewDecision): ReviewSession {
    return this.mutateSession(sessionId, (session) => {
      session.codeReviewDecisions = [
        ...session.codeReviewDecisions.filter((item) => item.reviewer !== decision.reviewer),
        decision,
      ];
    });
  }

  setRebuttal(sessionId: string, rebuttal: AuthorRebuttal): ReviewSession {
    return this.mutateSession(sessionId, (session) => {
      session.rebuttal = rebuttal;
    });
  }

  setReconciliation(sessionId: string, reconciliation: ReconciliationOutcome): ReviewSession {
    return this.mutateSession(sessionId, (session) => {
      session.reconciliation = reconciliation;
    });
  }

  setVerification(sessionId: string, verification: VerificationRun): ReviewSession {
    return this.mutateSession(sessionId, (session) => {
      session.verification = verification;
    });
  }

  setSubmission(sessionId: string, submission: SubmissionArtifact): ReviewSession {
    return this.mutateSession(sessionId, (session) => {
      session.submission = submission;
    });
  }

  clearBlockedState(sessionId: string): ReviewSession {
    return this.mutateSession(sessionId, (session) => {
      session.blockedReason = undefined;
      if (session.status === 'blocked') {
        session.status = 'active';
        if (session.phase === 'blocked') {
          session.phase = 'idle';
        }
      }
    });
  }

  replaceTask(sessionId: string, task: TaskDraft): ReviewSession {
    return this.mutateSession(sessionId, (session) => {
      session.task = task;
    });
  }

  private mutateSession(sessionId: string, mutator: (session: ReviewSession) => void): ReviewSession {
    const current = this.sessions.get(sessionId);
    if (!current) {
      throw new Error(`ReviewSessionStore: session "${sessionId}" not found`);
    }

    const next = cloneSession(current);
    mutator(next);
    next.updatedAtIso = nowIso();

    this.sessions.set(sessionId, next);
    return cloneSession(next);
  }

  private syncStatusWithPhase(session: ReviewSession): void {
    if (session.phase === 'submitted') {
      session.status = 'completed';
      session.blockedReason = undefined;
      return;
    }

    if (session.phase === 'blocked') {
      session.status = 'blocked';
      if (!session.blockedReason) {
        session.blockedReason = 'Session entered blocked phase.';
      }
      return;
    }

    if (session.status === 'completed' || session.status === 'cancelled') {
      return;
    }

    session.status = 'active';
    session.blockedReason = undefined;
  }
}