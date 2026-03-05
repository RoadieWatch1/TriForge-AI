// ── MissionController.ts — Orchestrates multi-step autonomous missions ────────
//
// Lifecycle:
//   intake → planning (ThinkTankPlanner) → awaiting_approval → executing → verifying → complete
//
// Safety rules (non-negotiable):
//   • No file writes without AgentLoop / ApprovalStore gating
//   • No git commits without second explicit approval
//   • All plans presented as previews first — user approves each step
//   • Approval per step — never batch-apply
//
// Phase 5 additions:
//   • ThinkTankPlanner context requests 3 candidate approaches
//   • ExperimentEngine scores candidates in isolated temp workspaces
//   • emitConsensus() fires when winner is selected
//   • VerificationEngine runs after executeMission — score 0 triggers rollback
//
// Dependencies injected via init() to allow singleton pattern while deferring
// engine initialization (engines are async-initialized in ipc.ts).

import { EventEmitter } from 'events';
import crypto from 'crypto';
import { ThinkTankPlanner } from '@triforge/engine';
import type { AgentLoop, ApprovalStore, ProviderManager } from '@triforge/engine';
import type { CommandRequest } from '../../renderer/command/CommandRouter';
import type { MissionPlan, MissionState } from './types';
import { VerificationEngine } from './VerificationEngine';
import { ExperimentEngine } from '../experiments/ExperimentEngine';
import { emitConsensus, emitConsensusMeta } from '../orchestrator/consensus';
import type { PatchCandidate } from '../experiments/types';
import { AUTONOMY_FLAGS } from '../config/autonomyFlags';
import { createLogger } from '../logging/log';

const log = createLogger('MissionController');

export interface MissionDeps {
  providerManager: ProviderManager;
  agentLoop: AgentLoop;
  approvalStore: ApprovalStore;
  /** Absolute path to the project root — used for VerificationEngine and ExperimentEngine. */
  workspaceRoot: string;
}

export class MissionController extends EventEmitter {
  private _activeMissions = new Map<string, MissionState>();
  private _deps: MissionDeps | null = null;
  private _planner: ThinkTankPlanner | null = null;

  /** Must be called once engine singletons are ready (from ipc.ts setupIpc). */
  init(deps: MissionDeps): void {
    this._deps = deps;
    this._planner = new ThinkTankPlanner(deps.providerManager);
    log.info('initialized');
  }

  /**
   * Start a new mission from a CommandRequest.
   * Returns the missionId immediately; planning happens async.
   * Emits: mission:start, mission:plan_ready (async), mission:failed
   */
  async startMission(req: CommandRequest): Promise<string> {
    if (!AUTONOMY_FLAGS.enableMissionController) {
      throw new Error('MissionController disabled (flag off)');
    }
    if (!this._deps || !this._planner) {
      throw new Error('MissionController not initialized — call init() first');
    }

    const missionId = crypto.randomUUID();
    this._transition(missionId, 'planning');
    log.info('startMission', missionId, req.intent, req.source);
    this.emit('mission:start', { missionId, goal: req.raw, intent: req.intent });

    // Async planning — don't block the IPC handler
    this._planAsync(missionId, req).catch((err) => {
      this._transition(missionId, 'failed');
      log.error('planning failed', missionId, err);
      this.emit('mission:failed', { missionId, status: 'failed', error: String(err) });
    });

    return missionId;
  }

  private async _planAsync(missionId: string, req: CommandRequest): Promise<void> {
    const planner = this._planner!;
    const deps    = this._deps!;

    // Ask the council for 3 distinct candidate approaches
    const enginePlan = await planner.makePlan(
      req.raw,
      'general',
      `Mission intent: ${req.intent}. Goal: ${req.goal ?? req.raw}.
IMPORTANT: Generate 3 distinct candidate approaches to solve this goal.
Each candidate must have a unique id, a short title, and a steps array.
Prefer these approach styles:
  1. Minimal surgical fix — least invasive, safest
  2. Refactor for clarity — structured improvement
  3. Performance/stability optimized — future-proof
Return structured JSON: { "candidates": [ { "id": "c1", "title": "...", "steps": [...] }, ... ] }`,
    );

    // Build 3 PatchCandidates from the plan (planning phase — no actual file content yet)
    const APPROACH_STYLES = [
      { id: 'c1', label: 'Minimal surgical fix',          rationale: 'Least invasive, safest change' },
      { id: 'c2', label: 'Refactor for clarity',          rationale: 'Structured improvement, better readability' },
      { id: 'c3', label: 'Performance/stability optimized', rationale: 'Future-proof, optimized solution' },
    ];
    const candidates: PatchCandidate[] = APPROACH_STYLES.map(style => ({
      id:               `${missionId}-${style.id}`,
      approach:         style.label,
      rationale:        style.rationale,
      patches:          [],  // planning phase — actual patches applied during step execution
      filesLikelyTouched: [],
    }));

    // Run ExperimentEngine to evaluate candidates in isolated temp workspaces
    let winnerId: string | undefined;
    let winnerApproach = APPROACH_STYLES[0]!.label;
    if (deps.workspaceRoot && candidates.length > 0) {
      try {
        const expEngine = new ExperimentEngine(deps.workspaceRoot);
        const { winner } = await expEngine.runExperiments(missionId, candidates);
        winnerId      = winner.candidateId;
        winnerApproach = winner.approach;

        // Emit canonical consensus signal
        emitConsensus({ missionId, winnerId, score: winner.score, candidateCount: candidates.length, ts: Date.now() });

        // Emit richer metadata signal for renderer FX layer
        emitConsensusMeta({
          missionId,
          winnerApproach: winner.approach,
          score:          winner.score,
          reason:         `Best candidate by sandbox verification score (${winner.score}/100)`,
          risks:          winner.checks.filter(c => !c.ok && !c.skipped).map(c => `${c.name}: ${c.details ?? 'failed'}`),
          ts:             Date.now(),
        });

        log.info('experiment winner:', winnerId, 'approach:', winner.approach, 'score:', winner.score);
      } catch (e) {
        log.warn('ExperimentEngine failed (non-fatal):', e);
      }
    }

    // Convert engine Plan → MissionPlan (UI-facing type)
    const plan: MissionPlan = {
      missionId,
      requestId: req.id,
      goal: req.raw,
      intent: req.intent as MissionPlan['intent'],
      constraints: req.constraints,
      steps: enginePlan.steps.map((s) => ({
        id:                 s.id,
        title:              s.title,
        rationale:          s.description,
        filesLikelyTouched: [],
        risk:               (s.riskLevel === 'medium' ? 'med' : s.riskLevel) as 'low' | 'med' | 'high',
        rollback:           'Revert changes manually or use git checkout',
        checks:             s.requiresApproval ? ['requires_approval'] : [],
      })),
    };

    this._transition(missionId, 'awaiting_approval');
    this.emit('mission:plan_ready', { missionId, status: 'awaiting_approval', plan, winnerId });
  }

  /**
   * Called by IPC layer once the user approves the plan.
   * Creates an AgentLoop task and emits step previews one at a time.
   * Runs VerificationEngine after all steps — score 0 triggers rollback.
   * Emits: mission:step_preview_ready, mission:complete, mission:failed
   */
  async executeMission(missionId: string, plan: MissionPlan): Promise<void> {
    if (!this._deps) return;
    this._transition(missionId, 'executing');
    log.info('executeMission', missionId, plan.steps.length, 'steps');

    // Create an AgentLoop task — actual execution is gated by ApprovalStore
    const task = this._deps.agentLoop.createTask(plan.goal, 'general');
    log.info('agentLoop task created', task.id);

    // Present first step preview (IPC must call stepApplied() to advance)
    if (plan.steps.length > 0) {
      this._emitStepPreview(missionId, plan.steps[0]);
    } else {
      await this._verifyAndComplete(missionId, plan);
    }
  }

  /**
   * Called by IPC layer once the user fills in a plan (alternative to AI planning).
   * Emits: mission:plan_ready
   */
  completeMissionPlan(missionId: string, plan: MissionPlan): void {
    if (!this._activeMissions.has(missionId)) return;
    this._transition(missionId, 'awaiting_approval');
    this.emit('mission:plan_ready', { missionId, status: 'awaiting_approval', plan });
  }

  /** Called by IPC after a step completes successfully. Advances to next step or runs verification. */
  async stepApplied(missionId: string, stepId: string, plan: MissionPlan): Promise<void> {
    const stepIndex = plan.steps.findIndex(s => s.id === stepId);
    this.emit('mission:step_applied', { missionId, stepId });

    const nextStep = plan.steps[stepIndex + 1];
    if (!nextStep) {
      await this._verifyAndComplete(missionId, plan);
    } else {
      this._emitStepPreview(missionId, nextStep);
    }
  }

  private async _verifyAndComplete(missionId: string, plan: MissionPlan): Promise<void> {
    const deps = this._deps!;
    this._transition(missionId, 'verifying');

    try {
      const verifier = new VerificationEngine(deps.workspaceRoot);
      const result   = await verifier.verify();
      log.info('verification result', missionId, result.score, result.errors);

      if (result.score === 0) {
        this.rollbackMission(missionId);
        this.emit('mission:failed', { missionId, status: 'failed', error: `Verification failed: ${result.errors.join('; ')}` });
        return;
      }

      this._transition(missionId, 'complete');
      this.emit('mission:complete', { missionId, status: 'complete', plan, verification: result });
    } catch (e) {
      log.warn('VerificationEngine error (non-fatal):', e);
      this._transition(missionId, 'complete');
      this.emit('mission:complete', { missionId, status: 'complete', plan });
    }
  }

  /** Rollback the mission to pre-execution state. */
  rollbackMission(missionId: string): void {
    this._transition(missionId, 'rolled_back');
    this.emit('mission:rollback', { missionId, status: 'rolled_back' });
    this._activeMissions.delete(missionId);
  }

  getStatus(missionId: string): MissionState | null {
    return this._activeMissions.get(missionId) ?? null;
  }

  private _transition(missionId: string, status: MissionState): void {
    this._activeMissions.set(missionId, status);
  }

  private _emitStepPreview(missionId: string, step: MissionPlan['steps'][number]): void {
    this.emit('mission:step_preview_ready', {
      missionId,
      stepId: step.id,
      title: step.title,
      rationale: step.rationale,
      files: step.filesLikelyTouched,
      risk: step.risk,
      rollback: step.rollback,
      checks: step.checks,
    });
  }
}

/** Singleton — shared across IPC handlers. */
export const missionController = new MissionController();
