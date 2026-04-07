// ── workflowPackService.ts ────────────────────────────────────────────────────
//
// Section 9 — Workflow Packs: Desktop Execution Service
//
// Orchestrates workflow pack execution by:
//   - Evaluating readiness before starting
//   - Running phases sequentially using OperatorService
//   - Pausing at approval gates (status: 'awaiting_approval')
//   - Advancing on resume after approval
//   - Tracking all runs in memory
//   - Emitting EventBus events for audit trail
//
// TRULY IMPLEMENTED:
//   - pack.readiness-check  — full execution
//   - pack.app-context      — full execution
//   - pack.focus-capture    — full execution (needs Screen Recording)
//   - pack.supervised-input — full execution (needs Accessibility + Screen Recording)
//
// PARTIAL / SCAFFOLDED:
//   - Run persistence — in-memory only; lost on restart
//
// NOT YET:
//   - Windows/Linux execution backends
//   - Resume-from-crash for interrupted runs

import path from 'path';
import os from 'os';
import crypto from 'crypto';

import { OperatorService } from './operatorService';
import {
  WORKFLOW_PACK_REGISTRY,
  getWorkflowPack,
  listWorkflowPacks,
} from '@triforge/engine';
import {
  evaluateWorkflowReadiness,
  evaluateAllPackReadiness,
} from '@triforge/engine';
import type {
  WorkflowPack,
  WorkflowRun,
  WorkflowRunOptions,
  WorkflowPhaseResult,
  WorkflowArtifact,
  WorkflowReadinessResult,
} from '@triforge/engine';
import { eventBus } from '@triforge/engine';

// ── Run store ─────────────────────────────────────────────────────────────────

const _runs = new Map<string, WorkflowRun>();

function makeId(): string {
  return crypto.randomUUID();
}

function nowMs(): number {
  return Date.now();
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makePhaseResult(
  phase: WorkflowPack['phases'][number],
  status: WorkflowPhaseResult['status'],
  outputs: Record<string, unknown> = {},
  error?: string,
  warning?: string,
): WorkflowPhaseResult {
  return {
    phaseId:     phase.id,
    phaseName:   phase.name,
    status,
    startedAt:   nowMs(),
    completedAt: status !== 'awaiting_approval' ? nowMs() : undefined,
    outputs,
    error,
    warning,
  };
}

// ── Phase executors ───────────────────────────────────────────────────────────

async function executePhase(
  pack: WorkflowPack,
  phaseIndex: number,
  run: WorkflowRun,
  opts: WorkflowRunOptions,
): Promise<{ phaseResult: WorkflowPhaseResult; shouldStop: boolean; approvalId?: string }> {
  const phase = pack.phases[phaseIndex];
  if (!phase) {
    return {
      phaseResult: {
        phaseId: 'unknown', phaseName: 'Unknown', status: 'failed',
        startedAt: nowMs(), completedAt: nowMs(), outputs: {},
        error: `Phase index ${phaseIndex} out of range`,
      },
      shouldStop: true,
    };
  }

  const fail = (error: string) => ({
    phaseResult: makePhaseResult(phase, 'failed', {}, error),
    shouldStop:  phase.onFailure === 'stop',
  });

  const warn = (warning: string, outputs: Record<string, unknown> = {}) => ({
    phaseResult: makePhaseResult(phase, phase.optional ? 'skipped' : 'completed', outputs, undefined, warning),
    shouldStop:  false,
  });

  switch (phase.kind) {

    // ── list_apps ──────────────────────────────────────────────────────────────
    case 'list_apps': {
      const apps = await OperatorService.listRunningApps();
      if (run.targetApp) {
        const targetLower = run.targetApp.toLowerCase();
        const isRunning = apps.some(a => a.toLowerCase().includes(targetLower));
        if (!isRunning) {
          const msg = `Target app "${run.targetApp}" is not in the running app list.`;
          if (phase.onFailure === 'stop') {
            return fail(msg);
          }
          return warn(msg, { apps, targetFound: false });
        }
      }
      return {
        phaseResult: makePhaseResult(phase, 'completed', { apps, count: apps.length }),
        shouldStop:  false,
      };
    }

    // ── get_frontmost ──────────────────────────────────────────────────────────
    case 'get_frontmost': {
      const target = await OperatorService.getFrontmostApp();
      if (!target) {
        return warn('Could not read frontmost app.', {});
      }
      // Update the session's confirmed target
      const session = OperatorService.getSession(run.sessionId);
      if (session) {
        // Best-effort update — session.confirmedTarget is internal
      }
      return {
        phaseResult: makePhaseResult(phase, 'completed', {
          appName:     target.appName,
          windowTitle: target.windowTitle ?? null,
          confirmed:   target.confirmed,
        }),
        shouldStop: false,
      };
    }

    // ── focus_app ──────────────────────────────────────────────────────────────
    case 'focus_app': {
      if (!run.targetApp) {
        return fail('focus_app phase requires a targetApp — none was provided.');
      }
      const session = OperatorService.getSession(run.sessionId);
      if (!session) {
        return fail('Session not found — cannot build focus action.');
      }
      const action = OperatorService.buildAction(run.sessionId, 'focus_app', {
        target: run.targetApp,
      });
      const result = await OperatorService.executeAction(action);
      if (result.outcome !== 'success') {
        const msg = result.error ?? `Focus failed: ${result.outcome}`;
        if (phase.onFailure === 'stop') return fail(msg);
        return warn(msg, { outcome: result.outcome, recoveryHint: result.recoveryHint ?? null });
      }
      return {
        phaseResult: makePhaseResult(phase, 'completed', {
          focusedApp:  result.executedTarget?.appName ?? run.targetApp,
          windowTitle: result.executedTarget?.windowTitle ?? null,
        }),
        shouldStop: false,
      };
    }

    // ── screenshot ─────────────────────────────────────────────────────────────
    case 'screenshot': {
      const outputPath = opts.screenshotOutputPath ??
        path.join(os.tmpdir(), `tf-wf-${run.id}-${phaseIndex}-${nowMs()}.png`);
      const res = await OperatorService.captureScreen(outputPath);
      if (!res.ok) {
        if (phase.optional) {
          return warn(`Screenshot skipped: ${res.error ?? 'failed'}. ${res.recoveryHint ?? ''}`, {
            screenshotPath: null,
          });
        }
        if (phase.onFailure === 'stop') return fail(res.error ?? 'Screenshot failed');
        return warn(res.error ?? 'Screenshot failed', { screenshotPath: null });
      }
      return {
        phaseResult: makePhaseResult(phase, 'completed', { screenshotPath: res.path ?? null }),
        shouldStop:  false,
      };
    }

    // ── queue_input ────────────────────────────────────────────────────────────
    case 'queue_input': {
      if (!opts.inputText && !opts.inputKey) {
        return fail('queue_input phase requires inputText or inputKey in run options.');
      }
      const session = OperatorService.getSession(run.sessionId);
      if (!session) return fail('Session not found — cannot queue input action.');

      const actionType = opts.inputKey ? 'send_key' : 'type_text';
      const action = OperatorService.buildAction(run.sessionId, actionType, {
        text:      opts.inputText,
        key:       opts.inputKey,
        modifiers: opts.inputModifiers,
      });

      const result = await OperatorService.executeAction(action);
      if (result.outcome !== 'approval_pending' || !result.approvalId) {
        return fail(`Expected approval_pending, got: ${result.outcome}. ${result.error ?? ''}`);
      }

      return {
        phaseResult: {
          phaseId:     phase.id,
          phaseName:   phase.name,
          status:      'awaiting_approval',
          startedAt:   nowMs(),
          outputs:     { approvalId: result.approvalId, actionType },
        },
        shouldStop:  false,
        approvalId:  result.approvalId,
      };
    }

    // ── execute_approved ───────────────────────────────────────────────────────
    case 'execute_approved': {
      // Find the approvalId from the previous queue_input phase result
      const queueResult = run.phaseResults.find(r => r.phaseId === 'queue-input');
      const approvalId = queueResult?.outputs?.approvalId as string | undefined;
      if (!approvalId) {
        return fail('execute_approved: no approvalId found from queue_input phase.');
      }
      const result = await OperatorService.executeApprovedAction(approvalId);
      if (result.outcome !== 'success') {
        const msg = result.error ?? `Input execution failed: ${result.outcome}`;
        if (phase.onFailure === 'stop') return fail(msg);
        return warn(msg, { outcome: result.outcome, recoveryHint: result.recoveryHint ?? null });
      }
      return {
        phaseResult: makePhaseResult(phase, 'completed', {
          executedApp:   result.executedTarget?.appName ?? null,
          windowTitle:   result.executedTarget?.windowTitle ?? null,
          durationMs:    result.durationMs,
        }),
        shouldStop: false,
      };
    }

    // ── readiness_check ────────────────────────────────────────────────────────
    case 'readiness_check': {
      const capMap = await OperatorService.getCapabilityMap();
      const runningApps = capMap.platform === 'macOS'
        ? await OperatorService.listRunningApps()
        : [];
      const allResults: Record<string, WorkflowReadinessResult> = {};
      for (const [id, res] of evaluateAllPackReadiness(
        WORKFLOW_PACK_REGISTRY,
        capMap,
        runningApps,
      )) {
        allResults[id] = res;
      }
      return {
        phaseResult: makePhaseResult(phase, 'completed', {
          capabilityMap: capMap,
          packReadiness: allResults,
        }),
        shouldStop: false,
      };
    }

    // ── report ─────────────────────────────────────────────────────────────────
    case 'report': {
      // Assemble outputs from all previous phases into an artifact
      const allOutputs: Record<string, unknown> = {};
      for (const r of run.phaseResults) {
        Object.assign(allOutputs, r.outputs);
      }

      let artifactType: WorkflowArtifact['type'] = 'context_report';
      if (pack.category === 'input')       artifactType = 'input_delivery';
      if (pack.id === 'pack.readiness-check') artifactType = 'readiness_report';
      if (pack.category === 'perception')  artifactType = 'perception_snapshot';

      const artifact: WorkflowArtifact = {
        type:        artifactType,
        capturedAt:  nowMs(),
        data:        allOutputs,
      };

      return {
        phaseResult: makePhaseResult(phase, 'completed', { artifactType, artifact }),
        shouldStop:  false,
      };
    }

    default:
      return fail(`Unknown phase kind: ${phase.kind}`);
  }
}

// ── WorkflowPackService ───────────────────────────────────────────────────────

export const WorkflowPackService = {

  // ── Pack discovery ────────────────────────────────────────────────────────────

  listPacks(): WorkflowPack[] {
    return listWorkflowPacks();
  },

  getPack(id: string): WorkflowPack | undefined {
    return getWorkflowPack(id);
  },

  // ── Readiness ─────────────────────────────────────────────────────────────────

  async evaluateReadiness(
    packId: string,
    targetApp?: string,
  ): Promise<WorkflowReadinessResult | null> {
    const pack = getWorkflowPack(packId);
    if (!pack) return null;

    const capMap = await OperatorService.getCapabilityMap();
    const runningApps = capMap.platform === 'macOS' && (pack.requirements.targetApp || targetApp)
      ? await OperatorService.listRunningApps()
      : undefined;

    const effectivePack: WorkflowPack = targetApp
      ? { ...pack, requirements: { ...pack.requirements, targetApp } }
      : pack;

    return evaluateWorkflowReadiness(effectivePack, capMap, runningApps);
  },

  async evaluateAllReadiness(): Promise<Record<string, WorkflowReadinessResult>> {
    const capMap = await OperatorService.getCapabilityMap();
    const runningApps = capMap.platform === 'macOS'
      ? await OperatorService.listRunningApps()
      : undefined;
    const results: Record<string, WorkflowReadinessResult> = {};
    for (const [id, res] of evaluateAllPackReadiness(
      WORKFLOW_PACK_REGISTRY,
      capMap,
      runningApps,
    )) {
      results[id] = res;
    }
    return results;
  },

  // ── Run management ────────────────────────────────────────────────────────────

  getRun(id: string): WorkflowRun | null {
    return _runs.get(id) ?? null;
  },

  listRuns(): WorkflowRun[] {
    return Array.from(_runs.values()).sort((a, b) => b.startedAt - a.startedAt);
  },

  stopRun(id: string): boolean {
    const run = _runs.get(id);
    if (!run || run.status === 'completed' || run.status === 'failed') return false;
    const updated: WorkflowRun = { ...run, status: 'stopped', endedAt: nowMs() };
    _runs.set(id, updated);
    OperatorService.stopSession(run.sessionId, 'workflow stopped');
    eventBus.emit({
      type:      'OPERATOR_SESSION_ENDED',
      sessionId: run.sessionId,
      status:    'stopped',
      actionCount: run.phaseResults.length,
    });
    return true;
  },

  // ── Start a workflow run ──────────────────────────────────────────────────────

  async startRun(
    packId: string,
    opts: WorkflowRunOptions = {},
  ): Promise<{ ok: boolean; run?: WorkflowRun; readinessBlockers?: WorkflowReadinessResult['blockers']; error?: string }> {
    const pack = getWorkflowPack(packId);
    if (!pack) {
      return { ok: false, error: `Workflow pack "${packId}" not found.` };
    }

    // Readiness check before starting
    const readiness = await this.evaluateReadiness(packId, opts.targetApp);
    if (!readiness) {
      return { ok: false, error: 'Could not evaluate readiness.' };
    }
    if (!readiness.ready) {
      return { ok: false, readinessBlockers: readiness.blockers };
    }

    // Create operator session
    const session = OperatorService.startSession(opts.targetApp ?? pack.requirements.targetApp);

    const run: WorkflowRun = {
      id:                makeId(),
      packId:            pack.id,
      packName:          pack.name,
      sessionId:         session.id,
      targetApp:         opts.targetApp ?? pack.requirements.targetApp,
      startedAt:         nowMs(),
      status:            'running',
      currentPhaseIndex: 0,
      phaseResults:      [],
    };
    _runs.set(run.id, run);

    eventBus.emit({
      type:            'OPERATOR_SESSION_STARTED',
      sessionId:       session.id,
      intendedTarget:  run.targetApp,
    });

    // Execute phases sequentially until done, approval gate, or failure
    const result = await this._executePhasesFrom(run.id, pack, opts, 0);
    return { ok: true, run: result };
  },

  // ── Advance a run after an approval is granted ────────────────────────────────

  async advanceRun(
    runId: string,
    opts: WorkflowRunOptions = {},
  ): Promise<{ ok: boolean; run?: WorkflowRun; error?: string }> {
    const run = _runs.get(runId);
    if (!run) return { ok: false, error: `Run "${runId}" not found.` };
    if (run.status !== 'awaiting_approval') {
      return { ok: false, error: `Run is not awaiting approval (status: ${run.status}).` };
    }

    const pack = getWorkflowPack(run.packId);
    if (!pack) return { ok: false, error: `Pack "${run.packId}" not found.` };

    // Advance from the NEXT phase — the approval gate phase already ran and its
    // approvalId is stored in phaseResults. The execute_approved phase reads it.
    // Starting at currentPhaseIndex would re-run queue_input and queue a new action.
    const result = await this._executePhasesFrom(
      run.id, pack, opts, run.currentPhaseIndex + 1,
    );
    return { ok: true, run: result };
  },

  // ── Internal: execute phases from a given index ───────────────────────────────

  async _executePhasesFrom(
    runId: string,
    pack: WorkflowPack,
    opts: WorkflowRunOptions,
    fromPhaseIndex: number,
  ): Promise<WorkflowRun> {
    let run = _runs.get(runId);
    if (!run) throw new Error(`Run ${runId} not found`);

    for (let i = fromPhaseIndex; i < pack.phases.length; i++) {
      run = _runs.get(runId)!;

      // Update current phase index
      const updatedRun: WorkflowRun = { ...run, currentPhaseIndex: i };
      _runs.set(runId, updatedRun);
      run = updatedRun;

      const { phaseResult, shouldStop, approvalId } = await executePhase(pack, i, run, opts);

      // Append phase result
      const withResult: WorkflowRun = {
        ...run,
        phaseResults: [...run.phaseResults, phaseResult],
      };
      _runs.set(runId, withResult);
      run = withResult;

      if (phaseResult.status === 'awaiting_approval' && approvalId) {
        const suspended: WorkflowRun = {
          ...run,
          status:             'awaiting_approval',
          pendingApprovalId:  approvalId,
          currentPhaseIndex:  i,  // stay at this phase for advance()
        };
        _runs.set(runId, suspended);
        return suspended;
      }

      if (shouldStop || phaseResult.status === 'failed') {
        const failed: WorkflowRun = {
          ...run,
          status:   'failed',
          endedAt:  nowMs(),
          error:    phaseResult.error ?? 'Phase failed',
        };
        _runs.set(runId, failed);
        eventBus.emit({
          type:       'OPERATOR_ACTION_FAILED',
          sessionId:  run.sessionId,
          actionId:   run.id,
          actionType: pack.phases[i]?.kind ?? 'unknown',
          error:      phaseResult.error ?? 'Phase failed',
        });
        OperatorService.stopSession(run.sessionId, phaseResult.error ?? 'Phase failed');
        return failed;
      }
    }

    // All phases done — build final artifact from the 'report' phase output
    run = _runs.get(runId)!;
    const reportPhaseResult = run.phaseResults.find(r => r.phaseId === 'report');
    const artifact = reportPhaseResult?.outputs?.artifact as WorkflowArtifact | undefined;

    const completed: WorkflowRun = {
      ...run,
      status:   'completed',
      endedAt:  nowMs(),
      artifact,
    };
    _runs.set(runId, completed);

    eventBus.emit({
      type:       'OPERATOR_SESSION_ENDED',
      sessionId:  run.sessionId,
      status:     'completed',
      actionCount: run.phaseResults.length,
    });

    return completed;
  },
};
