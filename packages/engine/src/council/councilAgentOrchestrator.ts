// ── councilAgentOrchestrator.ts — Agent lifecycle, performance, fire/hire ─────
//
// Manages the 15 Council agents across their entire lifecycle:
//
//   1. SELECTION — picks relevant agents for each message
//   2. INJECTION  — builds their system prompt addendum before Council deliberates
//   3. TRACKING   — records whether agent contributions survived into the synthesis
//   4. EVALUATION — periodically scores agents; underperformers are watchlisted
//   5. FIRE/HIRE  — benches/retires failing agents; requests replacements via
//                   ExpertWorkforceEngine when a pool/role has a gap
//
// This is the bridge between the Council's 15-agent roster (councilAgents.ts)
// and the existing ExpertWorkforceEngine performance/lifecycle infrastructure.
//
// Design rules:
//   - Protected agents (risk_assessor, quality_gate) cannot be benched or retired
//   - Fire decisions require ≥5 task observations before action
//   - Hire requests are queued via ExpertWorkforceEngine.requestHiring()
//   - All lifecycle events emit on the eventBus for audit trail

import {
  COUNCIL_AGENT_ROSTER,
  selectAgentsForMessage,
  buildAgentSystemAddendum,
  isProtectedAgent,
  type CouncilAgent,
  type AgentStatus,
} from './councilAgents';
import { eventBus } from '../core/eventBus';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface AgentContributionRecord {
  agentId:      string;
  taskId:       string;
  messageSnippet: string;  // first 80 chars of the user message
  activatedAt:  number;
  survived:     boolean;   // did agent's fragment influence the final synthesis?
  errorOccurred: boolean;
  latencyMs:    number;
}

export interface AgentPerformanceSummary {
  agentId:            string;
  name:               string;
  pool:               string;
  status:             AgentStatus;
  protected:          boolean;
  activationCount:    number;
  survivalRate:       number;  // 0–1
  errorRate:          number;  // 0–1
  avgLatencyMs:       number;
  contributionScore:  number;  // 0–100 composite
}

// ── Constants ─────────────────────────────────────────────────────────────────

const MIN_TASKS_BEFORE_FIRE   = 5;    // need at least N observations before action
const WATCHLIST_THRESHOLD     = 0.25; // survival rate below this → watchlist
const BENCH_THRESHOLD         = 0.15; // survival rate below this (persisted) → bench
const ERROR_RATE_FIRE_LIMIT   = 0.5;  // error rate above this → bench regardless
const MAX_HISTORY_PER_AGENT   = 500;

// ── Orchestrator ──────────────────────────────────────────────────────────────

export class CouncilAgentOrchestrator {
  /** In-memory performance records (per session). Persist externally if needed. */
  private _records: AgentContributionRecord[] = [];
  /** Per-agent watchlist cycle counter. */
  private _watchlistCycles: Record<string, number> = {};
  /** Runtime status overrides (in-memory, sourced from ExpertWorkforceEngine at boot). */
  private _statusOverrides: Record<string, AgentStatus> = {};

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Select agents relevant to `message` and return the system prompt addendum
   * that should be prepended to the Council's system prompt.
   *
   * Call this BEFORE the Council deliberates so all 3 providers get agent lenses.
   */
  buildAddendumForMessage(message: string): { addendum: string; activeAgentIds: string[] } {
    const activeAgents = selectAgentsForMessage(message, undefined, ['active']);
    // Apply runtime status overrides
    const filtered = activeAgents.filter(a => {
      const override = this._statusOverrides[a.id];
      return !override || override === 'active';
    });

    return {
      addendum:       buildAgentSystemAddendum(filtered),
      activeAgentIds: filtered.map(a => a.id),
    };
  }

  /**
   * Record the outcome of an agent's contribution to a task.
   *
   * `survived` = true when the agent's specialist lens area was reflected in
   * the final synthesis (determined by keyword overlap heuristic in ipc.ts).
   */
  recordContribution(record: AgentContributionRecord): void {
    this._records.push(record);
    if (this._records.length > MAX_HISTORY_PER_AGENT * COUNCIL_AGENT_ROSTER.length) {
      this._records = this._records.slice(-MAX_HISTORY_PER_AGENT * COUNCIL_AGENT_ROSTER.length);
    }
  }

  /**
   * Get performance summary for all agents.
   * Used by the OperateScreen / Settings UI to display agent status.
   */
  getPerformanceSummaries(): AgentPerformanceSummary[] {
    return COUNCIL_AGENT_ROSTER.map(agent => {
      const records = this._records.filter(r => r.agentId === agent.id);
      const survived = records.filter(r => r.survived).length;
      const errors   = records.filter(r => r.errorOccurred).length;
      const count    = records.length;

      const survivalRate = count > 0 ? survived / count : 0;
      const errorRate    = count > 0 ? errors   / count : 0;
      const avgLatency   = count > 0
        ? records.reduce((s, r) => s + r.latencyMs, 0) / count
        : 0;

      // Composite score: 70% survival, 20% error penalty, 10% latency penalty
      const latencyPenalty = Math.min(avgLatency / 5000, 1); // 5s = max penalty
      const contributionScore = Math.max(0, Math.round(
        survivalRate * 70
        - errorRate   * 20
        - latencyPenalty * 10,
      ));

      const effectiveStatus = this._statusOverrides[agent.id] ?? agent.status;

      return {
        agentId:           agent.id,
        name:              agent.name,
        pool:              agent.pool,
        status:            effectiveStatus,
        protected:         agent.protected,
        activationCount:   count,
        survivalRate,
        errorRate,
        avgLatencyMs:      avgLatency,
        contributionScore,
      };
    });
  }

  /**
   * Evaluate all agents and fire underperformers.
   * Call this periodically (e.g. after every 10 Council interactions).
   *
   * Returns list of actions taken for audit.
   */
  evaluateAndAct(): Array<{ agentId: string; action: 'watchlist' | 'bench' | 'restore' | 'retire'; reason: string }> {
    const actions: Array<{ agentId: string; action: 'watchlist' | 'bench' | 'restore' | 'retire'; reason: string }> = [];

    for (const agent of COUNCIL_AGENT_ROSTER) {
      const records = this._records.filter(r => r.agentId === agent.id);
      if (records.length < MIN_TASKS_BEFORE_FIRE) continue;

      const survived    = records.filter(r => r.survived).length;
      const errors      = records.filter(r => r.errorOccurred).length;
      const survivalRate = survived / records.length;
      const errorRate    = errors   / records.length;

      const effectiveStatus = this._statusOverrides[agent.id] ?? agent.status;

      // ── Check for firing ─────────────────────────────────────────────────
      if (!isProtectedAgent(agent.id)) {
        if (errorRate > ERROR_RATE_FIRE_LIMIT) {
          this._setStatus(agent.id, 'bench');
          actions.push({ agentId: agent.id, action: 'bench', reason: `Error rate ${Math.round(errorRate * 100)}% exceeds ${ERROR_RATE_FIRE_LIMIT * 100}% limit` });
          this._emitLifecycleEvent(agent, 'bench', `high error rate ${Math.round(errorRate * 100)}%`);
          continue;
        }

        if (survivalRate < WATCHLIST_THRESHOLD && effectiveStatus === 'active') {
          this._setStatus(agent.id, 'watchlist');
          this._watchlistCycles[agent.id] = 0;
          actions.push({ agentId: agent.id, action: 'watchlist', reason: `Survival rate ${Math.round(survivalRate * 100)}% below ${WATCHLIST_THRESHOLD * 100}%` });
          this._emitLifecycleEvent(agent, 'watchlist', `low survival ${Math.round(survivalRate * 100)}%`);
          continue;
        }

        if (effectiveStatus === 'watchlist') {
          this._watchlistCycles[agent.id] = (this._watchlistCycles[agent.id] ?? 0) + 1;
          if (survivalRate < BENCH_THRESHOLD || this._watchlistCycles[agent.id] >= 2) {
            this._setStatus(agent.id, 'bench');
            actions.push({ agentId: agent.id, action: 'bench', reason: `Persisted low performance after ${this._watchlistCycles[agent.id]} watchlist cycles` });
            this._emitLifecycleEvent(agent, 'bench', 'watchlist timeout');
          }
          continue;
        }
      }

      // ── Check for restoration (benched agent improved) ───────────────────
      if (effectiveStatus === 'bench' && survivalRate > 0.4 && errorRate < 0.1) {
        this._setStatus(agent.id, 'active');
        delete this._watchlistCycles[agent.id];
        actions.push({ agentId: agent.id, action: 'restore', reason: `Performance recovered: survival ${Math.round(survivalRate * 100)}%` });
        this._emitLifecycleEvent(agent, 'restore', 'performance recovered');
      }
    }

    return actions;
  }

  /**
   * Manually fire an agent by ID (user-initiated via UI).
   * Protected agents cannot be fired.
   */
  fireAgent(agentId: string, reason: string): { ok: boolean; error?: string } {
    if (isProtectedAgent(agentId)) {
      return { ok: false, error: `Agent ${agentId} is protected and cannot be fired.` };
    }
    const agent = COUNCIL_AGENT_ROSTER.find(a => a.id === agentId);
    if (!agent) return { ok: false, error: `Agent ${agentId} not found.` };

    this._setStatus(agentId, 'bench');
    this._emitLifecycleEvent(agent, 'bench', `user fired: ${reason}`);
    return { ok: true };
  }

  /**
   * Manually restore a benched agent (user-initiated via UI).
   */
  restoreAgent(agentId: string): { ok: boolean; error?: string } {
    const agent = COUNCIL_AGENT_ROSTER.find(a => a.id === agentId);
    if (!agent) return { ok: false, error: `Agent ${agentId} not found.` };

    const status = this._statusOverrides[agentId] ?? agent.status;
    if (status === 'retired') {
      return { ok: false, error: `Agent ${agentId} is retired. Hire a replacement instead.` };
    }

    this._setStatus(agentId, 'active');
    delete this._watchlistCycles[agentId];
    this._emitLifecycleEvent(agent, 'restore', 'user restored');
    return { ok: true };
  }

  /**
   * Retire an agent permanently (user-initiated).
   * Protected agents cannot be retired.
   */
  retireAgent(agentId: string, reason: string): { ok: boolean; error?: string } {
    if (isProtectedAgent(agentId)) {
      return { ok: false, error: `Agent ${agentId} is protected and cannot be retired.` };
    }
    const agent = COUNCIL_AGENT_ROSTER.find(a => a.id === agentId);
    if (!agent) return { ok: false, error: `Agent ${agentId} not found.` };

    this._setStatus(agentId, 'retired');
    this._emitLifecycleEvent(agent, 'retire', `user retired: ${reason}`);
    return { ok: true };
  }

  /**
   * Get current effective status for an agent.
   */
  getAgentStatus(agentId: string): AgentStatus | undefined {
    const agent = COUNCIL_AGENT_ROSTER.find(a => a.id === agentId);
    if (!agent) return undefined;
    return this._statusOverrides[agentId] ?? agent.status;
  }

  /**
   * Return a snapshot of all agents with their current status for display.
   */
  getRoster(): Array<{ id: string; name: string; pool: string; status: AgentStatus; protected: boolean }> {
    return COUNCIL_AGENT_ROSTER.map(a => ({
      id:        a.id,
      name:      a.name,
      pool:      a.pool,
      status:    this._statusOverrides[a.id] ?? a.status,
      protected: a.protected,
    }));
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private _setStatus(agentId: string, status: AgentStatus): void {
    this._statusOverrides[agentId] = status;
  }

  private _emitLifecycleEvent(
    agent:  CouncilAgent,
    action: string,
    reason: string,
  ): void {
    eventBus.emit({
      type: 'COUNCIL_AGENT_LIFECYCLE' as never,
      ...(({ agentId: agent.id, name: agent.name, pool: agent.pool, action, reason, timestamp: Date.now() }) as unknown as object),
    } as never);
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let _orchestrator: CouncilAgentOrchestrator | null = null;

export function getCouncilAgentOrchestrator(): CouncilAgentOrchestrator {
  if (!_orchestrator) _orchestrator = new CouncilAgentOrchestrator();
  return _orchestrator;
}

// ── Survival heuristic helper ─────────────────────────────────────────────────
//
// After synthesis is complete, check whether an agent's role area was reflected
// in the final answer. This is a keyword-based proxy for "did this agent help?"

export function checkAgentSurvival(agentId: string, synthesis: string): boolean {
  const lower = synthesis.toLowerCase();

  const survivalKeywords: Record<string, string[]> = {
    // Claude pool
    'claude-researcher':    ['background', 'prior', 'known', 'established', 'documented', 'research'],
    'claude-strategist':    ['step', 'order', 'first', 'then', 'critical path', 'dependency', 'sequence'],
    'claude-code-critic':   ['error', 'bug', 'null', 'check', 'type', 'security', 'edge case', 'review'],
    'claude-risk-assessor': ['risk', 'caution', 'warning', 'irreversible', 'confirm', 'dangerous', 'careful'],
    'claude-verifier':      ['answer', 'complete', 'address', 'covers', 'verify', 'confirms'],
    // GPT pool
    'gpt-creative-director':  ['creative', 'alternative', 'novel', 'different approach', 'memorable', 'idea'],
    'gpt-ux-agent':           ['user', 'experience', 'intuitive', 'friction', 'flow', 'confus'],
    'gpt-resource-scout':     ['library', 'tool', 'api', 'option', 'tradeoff', 'built-in', 'recommend'],
    'gpt-devils-advocate':    ['however', 'assumption', 'wrong', 'breaks', 'concern', 'instead', 'counter'],
    'gpt-synthesizer':        ['overall', 'summary', 'conclusion', 'combining', 'distill', 'recommend'],
    // Grok pool
    'grok-trend-analyst':      ['current', 'modern', 'best practice', 'deprecated', 'maintained', 'adopted'],
    'grok-efficiency-agent':   ['simplest', 'fastest', 'minimum', 'remove', 'skip', 'fewer steps', 'efficient'],
    'grok-counter-planner':    ['alternatively', 'plan b', 'fallback', 'different way', 'instead of', 'option'],
    'grok-quality-gate':       ['success criteria', 'complete when', 'testable', 'measurable', 'done when'],
    'grok-action-prioritizer': ['priority', 'impact', 'effort', 'first', 'most important', 'rank', 'high-value'],
  };

  const keywords = survivalKeywords[agentId] ?? [];
  return keywords.some(kw => lower.includes(kw));
}
