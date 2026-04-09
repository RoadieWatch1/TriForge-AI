// ── workflowChainService.ts ──────────────────────────────────────────────────
//
// Phase C1 — Multi-app workflow composition runner.
//
// Drives WorkflowChain executions by sequencing WorkflowPackService.startRun
// calls, propagating chain state between links via {{key}} substitution, and
// halting on failure or approval gate.
//
// Persists nothing to disk on its own — relies on the underlying WorkerRun
// records that WorkflowPackService creates per link, plus an in-memory map
// for chain-level state. (A future Phase 2 step can wire chain runs into the
// WorkerRunStore as a parent record; for now they live for the session.)

import crypto from 'crypto';
import {
  getWorkflowChain,
  listWorkflowChains,
  substituteChainState,
} from '@triforge/engine';
import type {
  WorkflowChain,
  WorkflowChainRun,
  WorkflowChainLinkResult,
  ChainState,
  WorkflowRunOptions,
  WorkflowRun,
} from '@triforge/engine';
import { WorkflowPackService } from './workflowPackService';

// ── In-memory storage ─────────────────────────────────────────────────────────

const _chainRuns = new Map<string, WorkflowChainRun>();

function nowMs(): number { return Date.now(); }
function makeId(): string { return crypto.randomBytes(8).toString('hex'); }

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Apply chain-state substitution to a link's options template.
 * Returns a new options object — does not mutate the input.
 */
function buildLinkOptions(template: WorkflowRunOptions, state: ChainState): WorkflowRunOptions {
  return substituteChainState(template, state);
}

/**
 * Run one link to completion, approval gate, or failure.
 * Returns the link result and the (possibly updated) chain state.
 */
async function runLink(
  chain:    WorkflowChain,
  linkIndex: number,
  state:    ChainState,
): Promise<{ result: WorkflowChainLinkResult; state: ChainState }> {
  const link    = chain.links[linkIndex];
  const startedAt = nowMs();
  const opts    = buildLinkOptions(link.optionsTemplate, state);

  const startRes = await WorkflowPackService.startRun(link.packId, opts);

  if (!startRes.ok || !startRes.run) {
    return {
      result: {
        linkIndex,
        packId:    link.packId,
        status:    'failed',
        startedAt,
        endedAt:   nowMs(),
        error:     startRes.error
          ?? (startRes.readinessBlockers
              ? `Readiness blocked: ${startRes.readinessBlockers.map(b => b.message).join('; ')}`
              : 'Unknown failure starting pack'),
      },
      state,
    };
  }

  const run: WorkflowRun = startRes.run;

  // Approval gate — pause the chain
  if (run.status === 'awaiting_approval') {
    return {
      result: {
        linkIndex,
        packId:        link.packId,
        workflowRunId: run.id,
        status:        'awaiting_approval',
        startedAt,
      },
      state,
    };
  }

  // Failed link
  if (run.status === 'failed' || run.status === 'stopped') {
    return {
      result: {
        linkIndex,
        packId:        link.packId,
        workflowRunId: run.id,
        status:        'failed',
        startedAt,
        endedAt:       nowMs(),
        error:         run.error ?? 'Pack run failed',
      },
      state,
    };
  }

  // Completed — compute new chain state via reducer if defined
  let nextState = state;
  if (link.contributeState) {
    try {
      nextState = link.contributeState(run.artifact, state);
    } catch (e) {
      // Reducer errors are non-fatal but logged into state
      nextState = {
        ...state,
        [`__contributeError_${linkIndex}`]: e instanceof Error ? e.message : String(e),
      };
    }
  }

  return {
    result: {
      linkIndex,
      packId:        link.packId,
      workflowRunId: run.id,
      status:        'completed',
      startedAt,
      endedAt:       nowMs(),
    },
    state: nextState,
  };
}

/**
 * Drive the chain forward from `fromIndex` until completion, gate, or failure.
 */
async function _executeChainFrom(
  runId:     string,
  chain:     WorkflowChain,
  fromIndex: number,
): Promise<WorkflowChainRun> {
  let chainRun = _chainRuns.get(runId);
  if (!chainRun) throw new Error(`Chain run ${runId} not found`);

  for (let i = fromIndex; i < chain.links.length; i++) {
    chainRun = _chainRuns.get(runId)!;

    const updated: WorkflowChainRun = {
      ...chainRun,
      status:           'running',
      currentLinkIndex: i,
    };
    _chainRuns.set(runId, updated);
    chainRun = updated;

    const { result: linkResult, state: nextState } = await runLink(chain, i, chainRun.state);

    chainRun = _chainRuns.get(runId)!;
    const withResult: WorkflowChainRun = {
      ...chainRun,
      linkResults: [...chainRun.linkResults, linkResult],
      state:       nextState,
    };
    _chainRuns.set(runId, withResult);
    chainRun = withResult;

    if (linkResult.status === 'awaiting_approval') {
      const paused: WorkflowChainRun = {
        ...chainRun,
        status: 'waiting_link_approval',
      };
      _chainRuns.set(runId, paused);
      return paused;
    }

    if (linkResult.status === 'failed') {
      const failed: WorkflowChainRun = {
        ...chainRun,
        status:  'failed',
        endedAt: nowMs(),
        error:   linkResult.error ?? 'Chain link failed',
      };
      _chainRuns.set(runId, failed);
      return failed;
    }
  }

  // All links done
  chainRun = _chainRuns.get(runId)!;
  const completed: WorkflowChainRun = {
    ...chainRun,
    status:  'completed',
    endedAt: nowMs(),
  };
  _chainRuns.set(runId, completed);
  return completed;
}

// ── Public service ────────────────────────────────────────────────────────────

export const WorkflowChainService = {

  // ── Discovery ──────────────────────────────────────────────────────────────

  listChains(): WorkflowChain[] {
    return listWorkflowChains();
  },

  getChain(id: string): WorkflowChain | undefined {
    return getWorkflowChain(id);
  },

  // ── Run management ─────────────────────────────────────────────────────────

  getRun(id: string): WorkflowChainRun | null {
    return _chainRuns.get(id) ?? null;
  },

  listRuns(): WorkflowChainRun[] {
    return Array.from(_chainRuns.values()).sort((a, b) => b.startedAt - a.startedAt);
  },

  cancelRun(id: string): boolean {
    const run = _chainRuns.get(id);
    if (!run) return false;
    if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
      return false;
    }
    const cancelled: WorkflowChainRun = { ...run, status: 'cancelled', endedAt: nowMs() };
    _chainRuns.set(id, cancelled);
    return true;
  },

  /**
   * Start a new chain run. Optional initialState seeds the substitution map.
   */
  async startChain(
    chainId: string,
    initialState: ChainState = {},
  ): Promise<{ ok: boolean; run?: WorkflowChainRun; error?: string }> {
    const chain = getWorkflowChain(chainId);
    if (!chain) return { ok: false, error: `Chain "${chainId}" not found.` };
    if (chain.links.length < 2) {
      return { ok: false, error: `Chain "${chainId}" must have at least 2 links.` };
    }

    const run: WorkflowChainRun = {
      id:               makeId(),
      chainId:          chain.id,
      chainName:        chain.name,
      startedAt:        nowMs(),
      status:           'running',
      currentLinkIndex: 0,
      linkResults:      [],
      state:            { ...initialState },
    };
    _chainRuns.set(run.id, run);

    const finalRun = await _executeChainFrom(run.id, chain, 0);
    return { ok: true, run: finalRun };
  },

  /**
   * Advance a chain that is paused on a link approval gate.
   *
   * The user must first approve the underlying pack run via the normal
   * approval flow (which advances the link's WorkflowRun internally).
   * This method then continues from the next link.
   */
  async advanceChain(
    chainRunId: string,
  ): Promise<{ ok: boolean; run?: WorkflowChainRun; error?: string }> {
    const run = _chainRuns.get(chainRunId);
    if (!run) return { ok: false, error: `Chain run "${chainRunId}" not found.` };
    if (run.status !== 'waiting_link_approval') {
      return { ok: false, error: `Chain is not waiting on an approval (status: ${run.status}).` };
    }

    const chain = getWorkflowChain(run.chainId);
    if (!chain) return { ok: false, error: `Chain "${run.chainId}" not found.` };

    // The currently-blocking link's underlying WorkflowRun must have been advanced
    // separately (via WorkflowPackService.advanceRun). Here we recompute the link
    // result based on the now-settled run, then move on.
    const blockingResult = run.linkResults[run.linkResults.length - 1];
    if (!blockingResult || blockingResult.status !== 'awaiting_approval' || !blockingResult.workflowRunId) {
      return { ok: false, error: 'No pending link approval found.' };
    }

    const settledRun = WorkflowPackService.getRun(blockingResult.workflowRunId);
    if (!settledRun) {
      return { ok: false, error: 'Underlying pack run no longer exists.' };
    }

    if (settledRun.status === 'awaiting_approval') {
      return { ok: false, error: 'Underlying pack run is still waiting for approval.' };
    }

    // Update the blocking link result with its post-approval outcome
    const link = chain.links[blockingResult.linkIndex];
    let nextState = run.state;
    let nextStatus: WorkflowChainLinkResult['status'] = 'completed';
    let error: string | undefined;

    if (settledRun.status === 'completed') {
      if (link.contributeState) {
        try {
          nextState = link.contributeState(settledRun.artifact, run.state);
        } catch (e) {
          nextState = {
            ...run.state,
            [`__contributeError_${blockingResult.linkIndex}`]: e instanceof Error ? e.message : String(e),
          };
        }
      }
    } else {
      nextStatus = 'failed';
      error = settledRun.error ?? 'Underlying pack run did not complete.';
    }

    const updatedResult: WorkflowChainLinkResult = {
      ...blockingResult,
      status:  nextStatus,
      endedAt: nowMs(),
      error,
    };
    const updatedResults = [...run.linkResults.slice(0, -1), updatedResult];

    const updatedRun: WorkflowChainRun = {
      ...run,
      linkResults: updatedResults,
      state:       nextState,
      status:      nextStatus === 'failed' ? 'failed' : 'running',
      endedAt:     nextStatus === 'failed' ? nowMs() : undefined,
      error,
    };
    _chainRuns.set(chainRunId, updatedRun);

    if (nextStatus === 'failed') return { ok: true, run: updatedRun };

    // Continue from the next link
    const finalRun = await _executeChainFrom(chainRunId, chain, blockingResult.linkIndex + 1);
    return { ok: true, run: finalRun };
  },
};
