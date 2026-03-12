/**
 * CouncilWorkflowEngine — master orchestrator for the governed pipeline.
 *
 * Owns the full lifecycle: intake → plan council → plan approval →
 * code council → verification → patch preview → git gate.
 *
 * Role assignment: Claude=architect, OpenAI=precision, Grok=adversarial.
 * Falls back gracefully if providers are missing (2-seat or solo mode).
 */

import type { AIProvider } from '../core/providers/provider';
import type { ProviderName } from '../protocol';
import type { ProviderManager } from '../core/providerManager';
import { eventBus } from '../core/eventBus';
import { PlanCouncilService } from './PlanCouncilService';
import { CodeCouncilService } from './CodeCouncilService';
import { VerificationGateService } from './VerificationGateService';
import { GitWorkflowService } from './GitWorkflowService';
import { CouncilWorkflowSessionStore } from './CouncilWorkflowSessionStore';
import {
  MODE_CONFIGS,
  type CouncilWorkflowSession,
  type CouncilWorkflowPhase,
  type CouncilRole,
  type ExecutionMode,
  type CouncilWorkflowAction,
  type WorkflowIntake,
  type UserInputAction,
} from './councilWorkflowTypes';

// ── Engine ───────────────────────────────────────────────────────────────────

const MAX_VERIFY_RETRIES = 2;

export class CouncilWorkflowEngine {
  private _planService = new PlanCouncilService();
  private _codeService = new CodeCouncilService();
  private _verifyService = new VerificationGateService();
  private _gitService = new GitWorkflowService();
  private _store = new CouncilWorkflowSessionStore();
  private _providerManager: ProviderManager;

  constructor(providerManager: ProviderManager) {
    this._providerManager = providerManager;
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /**
   * Start a new workflow session.
   */
  async startSession(
    intake: WorkflowIntake,
    mode: ExecutionMode,
    action: CouncilWorkflowAction,
  ): Promise<CouncilWorkflowSession> {
    const id = `wf_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
    const roles = await this._assignRoles();

    const session: CouncilWorkflowSession = {
      id,
      phase: 'intake',
      mode,
      action,
      roles,
      intake,
      planSnapshots: [],
      codeSnapshots: [],
      history: [{ phase: 'intake', timestamp: Date.now(), message: 'Session started' }],
      createdAt: Date.now(),
      updatedAt: Date.now(),
      verifyRetries: 0,
    };

    this._store.set(session);

    eventBus.emit({
      type: 'WORKFLOW_STARTED',
      sessionId: id,
      mode,
      action,
    });

    return session;
  }

  /**
   * Advance the session to the next phase. Optionally accepts user input
   * for phases that require approval/rejection.
   */
  async advancePhase(
    sessionId: string,
    userInput?: UserInputAction,
  ): Promise<CouncilWorkflowSession> {
    const session = this._store.get(sessionId);
    if (!session) { throw new Error(`Session not found: ${sessionId}`); }

    // Handle abort from any phase
    if (userInput?.type === 'abort') {
      return this._transitionTo(session, 'blocked', 'Aborted by user');
    }

    switch (session.phase) {
      case 'intake':
        return this._runPlanDraft(session);

      case 'plan_draft':
      case 'plan_review':
        // Plan council runs as a unit; this shouldn't be called mid-council
        return session;

      case 'plan_approved':
        if (session.action === 'plan_only') {
          return this._transitionTo(session, 'pushed', 'Plan-only workflow complete');
        }
        if (userInput?.type === 'approve_plan') {
          return this._runCodeDraft(session);
        }
        if (userInput?.type === 'reject_plan') {
          return this._transitionTo(session, 'blocked', `Plan rejected: ${userInput.reason}`);
        }
        if (userInput?.type === 'narrow_plan') {
          // Re-run plan council with narrowed instructions
          session.intake.request = `${session.intake.request}\n\nAdditional instructions: ${userInput.instructions}`;
          return this._runPlanDraft(session);
        }
        // Waiting for user input
        eventBus.emit({
          type: 'USER_INPUT_REQUIRED',
          sessionId,
          prompt: 'Review the plan and approve, reject, or narrow scope.',
          options: ['approve_plan', 'reject_plan', 'narrow_plan'],
        });
        return session;

      case 'code_draft':
      case 'code_review':
        return session;

      case 'verifying':
        return session;

      case 'verify_failed':
        if (session.verifyRetries < MAX_VERIFY_RETRIES) {
          return this._retryCodeAfterVerifyFailure(session);
        }
        return this._transitionTo(session, 'blocked', 'Verification failed after max retries');

      case 'ready_to_commit':
        if (userInput?.type === 'approve_commit') {
          return this._runCommit(session);
        }
        if (userInput?.type === 'reject_commit') {
          return this._transitionTo(session, 'blocked', 'Commit rejected by user');
        }
        // Check auto-commit
        if (MODE_CONFIGS[session.mode].autoCommit) {
          return this._runCommit(session);
        }
        eventBus.emit({
          type: 'USER_INPUT_REQUIRED',
          sessionId,
          prompt: 'Review changes and approve or reject the commit.',
          options: ['approve_commit', 'reject_commit'],
        });
        return session;

      case 'committed':
        return this._transitionTo(session, 'ready_to_push', 'Commit complete, push available');

      case 'ready_to_push':
        if (userInput?.type === 'approve_push') {
          return this._runPush(session);
        }
        if (userInput?.type === 'reject_push') {
          // Push rejected is fine — workflow is still complete
          return this._transitionTo(session, 'pushed', 'Push declined by user');
        }
        eventBus.emit({
          type: 'USER_INPUT_REQUIRED',
          sessionId,
          prompt: 'Push to remote?',
          options: ['approve_push', 'reject_push'],
        });
        return session;

      case 'pushed':
      case 'blocked':
        // Terminal states
        return session;

      default:
        return session;
    }
  }

  /**
   * Run the full pipeline automatically (for non-interactive use).
   * Stops at user-input-required phases.
   */
  async runToCompletion(
    intake: WorkflowIntake,
    mode: ExecutionMode,
    action: CouncilWorkflowAction,
  ): Promise<CouncilWorkflowSession> {
    let session = await this.startSession(intake, mode, action);

    // Phase 1: Plan
    session = await this._runPlanDraft(session);

    if (session.phase === 'blocked') { return session; }

    // For plan_only, we're done
    if (action === 'plan_only') { return session; }

    // Phase 2: Wait for plan approval (caller must handle)
    return session;
  }

  /**
   * Abort a session.
   */
  abortSession(sessionId: string): void {
    const session = this._store.get(sessionId);
    if (session) {
      this._transitionTo(session, 'blocked', 'Session aborted');
    }
  }

  /**
   * Get a session by ID.
   */
  getSession(sessionId: string): CouncilWorkflowSession | undefined {
    return this._store.get(sessionId);
  }

  /**
   * List all sessions.
   */
  listSessions(): CouncilWorkflowSession[] {
    return this._store.list();
  }

  // ── Accessors for sub-services (used by panel.ts integration) ────────────

  get planService(): PlanCouncilService { return this._planService; }
  get codeService(): CodeCouncilService { return this._codeService; }
  get verifyService(): VerificationGateService { return this._verifyService; }
  get gitService(): GitWorkflowService { return this._gitService; }

  // ── Phase Runners ────────────────────────────────────────────────────────

  private async _runPlanDraft(session: CouncilWorkflowSession): Promise<CouncilWorkflowSession> {
    this._transitionTo(session, 'plan_draft', 'Starting plan council');

    const providers = await this._getProviderMap();
    const modeConfig = MODE_CONFIGS[session.mode];

    try {
      const planSnapshot = await this._planService.runPlanCouncil(
        session.intake.request,
        session.intake.context,
        session.roles,
        providers,
        { maxRounds: modeConfig.maxPlanRounds, sessionId: session.id },
      );

      session.planSnapshots.push(planSnapshot);
      return this._transitionTo(session, 'plan_approved', 'Plan approved by council');
    } catch (err: unknown) {
      const error = err as Error;
      return this._transitionTo(session, 'blocked', `Plan council failed: ${error.message}`);
    }
  }

  private async _runCodeDraft(session: CouncilWorkflowSession): Promise<CouncilWorkflowSession> {
    if (session.planSnapshots.length === 0) {
      return this._transitionTo(session, 'blocked', 'Cannot generate code without approved plan');
    }

    this._transitionTo(session, 'code_draft', 'Starting code council');

    const providers = await this._getProviderMap();
    const modeConfig = MODE_CONFIGS[session.mode];
    const latestPlan = session.planSnapshots[session.planSnapshots.length - 1];

    try {
      const codeResult = await this._codeService.runCodeCouncil(
        latestPlan,
        session.intake.context,
        session.roles,
        providers,
        { maxRounds: modeConfig.maxCodeRounds, sessionId: session.id },
      );

      session.codeSnapshots.push(codeResult);

      // Run verification
      return this._runVerification(session);
    } catch (err: unknown) {
      const error = err as Error;
      return this._transitionTo(session, 'blocked', `Code council failed: ${error.message}`);
    }
  }

  private async _runVerification(session: CouncilWorkflowSession): Promise<CouncilWorkflowSession> {
    this._transitionTo(session, 'verifying', 'Running verification checks');

    const modeConfig = MODE_CONFIGS[session.mode];

    try {
      const result = await this._verifyService.runChecks(
        session.intake.workspacePath,
        modeConfig.verificationChecks,
        { sessionId: session.id },
      );

      session.verification = result;

      if (result.allPassed) {
        return this._transitionTo(session, 'ready_to_commit', 'All checks passed');
      } else {
        return this._transitionTo(session, 'verify_failed', 'Verification checks failed');
      }
    } catch (err: unknown) {
      const error = err as Error;
      return this._transitionTo(session, 'verify_failed', `Verification error: ${error.message}`);
    }
  }

  private async _retryCodeAfterVerifyFailure(session: CouncilWorkflowSession): Promise<CouncilWorkflowSession> {
    session.verifyRetries++;

    // Feed verification failures back into code council
    const failureFeedback = session.verification
      ? this._verifyService.formatFailuresForCouncil(session.verification)
      : 'Verification failed';

    // Update context with failure feedback
    session.intake.context = `${session.intake.context}\n\nVerification Failures (retry ${session.verifyRetries}):\n${failureFeedback}`;

    return this._runCodeDraft(session);
  }

  private async _runCommit(session: CouncilWorkflowSession): Promise<CouncilWorkflowSession> {
    const gate = this._gitService.evaluateGitGate(session);

    if (!gate.commitReady) {
      return this._transitionTo(session, 'blocked', `Commit blocked: ${gate.blockingRisks.join('; ')}`);
    }

    // Stage files
    if (session.codeSnapshots.length > 0) {
      const latestCode = session.codeSnapshots[session.codeSnapshots.length - 1];
      const files = latestCode.snapshot.files.map(f => f.filePath);
      await this._gitService.stageFiles(session.intake.workspacePath, files);
    }

    // Commit
    const message = gate.commitMessage || this._gitService.generateCommitMessage(session);
    const result = await this._gitService.commit(session.intake.workspacePath, message, session);

    if (result.success) {
      return this._transitionTo(session, 'committed', `Committed: ${result.commitHash}`);
    } else {
      return this._transitionTo(session, 'blocked', `Commit failed: ${result.message}`);
    }
  }

  private async _runPush(session: CouncilWorkflowSession): Promise<CouncilWorkflowSession> {
    const result = await this._gitService.push(session.intake.workspacePath, session);

    if (result.success) {
      return this._transitionTo(session, 'pushed', `Pushed to ${result.remote}/${result.branch}`);
    } else {
      return this._transitionTo(session, 'blocked', `Push failed: ${result.message}`);
    }
  }

  // ── Role Assignment ──────────────────────────────────────────────────────

  private async _assignRoles(): Promise<CouncilRole[]> {
    const providers = await this._providerManager.getActiveProviders();
    const roles: CouncilRole[] = [];

    // Fixed assignment: Claude=architect, OpenAI=precision, Grok=adversarial
    const roleMap: Record<ProviderName, CouncilRole['role']> = {
      claude: 'architect',
      openai: 'precision',
      grok: 'adversarial',
    };

    for (const p of providers) {
      const role = roleMap[p.name];
      if (role) {
        roles.push({ provider: p.name, role });
      }
    }

    // Fallback: if Claude is missing, assign architect to first available
    if (!roles.find(r => r.role === 'architect') && roles.length > 0) {
      roles[0].role = 'architect';
    }

    // Solo mode: single provider acts as architect (no reviewers)
    if (roles.length === 0) {
      throw new Error('No AI providers configured. At least one provider is required.');
    }

    return roles;
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private async _getProviderMap(): Promise<Map<ProviderName, AIProvider>> {
    const providers = await this._providerManager.getActiveProviders();
    const map = new Map<ProviderName, AIProvider>();
    for (const p of providers) {
      map.set(p.name, p);
    }
    return map;
  }

  private _transitionTo(
    session: CouncilWorkflowSession,
    phase: CouncilWorkflowPhase,
    message: string,
  ): CouncilWorkflowSession {
    const from = session.phase;
    session.phase = phase;
    session.history.push({ phase, timestamp: Date.now(), message });
    session.updatedAt = Date.now();

    if (phase === 'blocked') {
      session.blockReason = message;
    }

    this._store.set(session);

    eventBus.emit({
      type: 'PHASE_CHANGED',
      sessionId: session.id,
      from,
      to: phase,
    });

    // Emit terminal events
    if (phase === 'pushed') {
      eventBus.emit({
        type: 'WORKFLOW_COMPLETE',
        sessionId: session.id,
        summary: message,
      });
    } else if (phase === 'blocked') {
      eventBus.emit({
        type: 'WORKFLOW_BLOCKED',
        sessionId: session.id,
        reason: message,
      });
    }

    return session;
  }
}
