// ── experimentManager.ts ───────────────────────────────────────────────────
//
// Income Experiment state machine for TriForge Income Operator.
//
// An Experiment is a controlled income attempt:
//   "Launch Notion budget template on Gumroad"
//   "Start TikTok affiliate page for home office gear"
//   "Upload 10 YouTube Shorts in 30 days"
//
// Design rules:
//   - No experiment starts, spends, or publishes without approval
//   - Every spend and revenue event is written to a JSONL ledger
//   - Auto-kill rule fires when spend threshold is hit with $0 revenue
//   - State machine is strict: invalid transitions are rejected
//   - Store is atomic: all mutations go through the Store class

import fs   from 'fs';
import path from 'path';
import os   from 'os';
import crypto from 'crypto';
import type { Store, IncomeExperiment, BudgetState, ExperimentStatus, IncomeLaneId, ExperimentMetrics } from './store';

// ── Spend / Revenue ledger ──────────────────────────────────────────────────
// Append-only JSONL file at <dataDir>/income-ledger.jsonl

interface LedgerEntry {
  ts:           number;
  experimentId: string;
  type:         'spend' | 'revenue' | 'status_change' | 'decision';
  amount?:      number;
  source?:      string;    // platform or reason
  reason?:      string;
  from?:        ExperimentStatus;
  to?:          ExperimentStatus;
  decision?:    'continue' | 'kill' | 'scale';
  decisionReason?: string;
}

function writeLedger(ledgerPath: string, entry: LedgerEntry): void {
  try {
    fs.appendFileSync(ledgerPath, JSON.stringify(entry) + '\n', 'utf8');
  } catch {
    // Non-fatal: ledger write failures do not block experiment operations
  }
}

// ── State machine ───────────────────────────────────────────────────────────

// Allowed transitions: from → to[]
const VALID_TRANSITIONS: Record<ExperimentStatus, ExperimentStatus[]> = {
  proposed:  ['approved', 'killed'],
  approved:  ['building', 'killed'],
  building:  ['launched', 'killed'],
  launched:  ['measuring', 'killed'],
  measuring: ['scaling', 'killed', 'completed'],
  scaling:   ['completed', 'killed'],
  killed:    [],
  completed: [],
};

function canTransition(from: ExperimentStatus, to: ExperimentStatus): boolean {
  return VALID_TRANSITIONS[from]?.includes(to) ?? false;
}

// ── Daily budget guard ──────────────────────────────────────────────────────

function todayKey(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function resetDailyIfNeeded(budget: BudgetState): BudgetState {
  const today = todayKey();
  if (budget.dailySpentDate !== today) {
    return { ...budget, dailySpentToday: 0, dailySpentDate: today };
  }
  return budget;
}

// ── ExperimentManager ───────────────────────────────────────────────────────

export class ExperimentManager {
  private _ledgerPath: string;

  constructor(private _store: Store, dataDir: string) {
    this._ledgerPath = path.join(dataDir, 'income-ledger.jsonl');
  }

  // ── Budget setup ───────────────────────────────────────────────────────────

  setBudget(params: {
    totalBudget:      number;
    maxPerExperiment: number;
    dailyLimit:       number;
    reservePct?:      number;
  }): BudgetState {
    const existing = this._getBudget();
    const budget: BudgetState = {
      totalBudget:      Math.max(0, params.totalBudget),
      maxPerExperiment: Math.max(0, params.maxPerExperiment),
      dailyLimit:       Math.max(0, params.dailyLimit),
      reservePct:       Math.max(0, Math.min(100, params.reservePct ?? 20)),
      allocated:        existing?.allocated ?? {},
      spent:            existing?.spent ?? {},
      dailySpentToday:  existing?.dailySpentToday ?? 0,
      dailySpentDate:   existing?.dailySpentDate ?? todayKey(),
      setAt:            Date.now(),
    };
    this._store.setKv('incomeBudget', JSON.stringify(budget));
    return budget;
  }

  getBudget(): BudgetState | null {
    return this._getBudget();
  }

  // ── Experiment creation ────────────────────────────────────────────────────

  createExperiment(params: {
    laneId:      IncomeLaneId;
    name:        string;
    rationale:   string;
    budgetAsk:   number;  // how much budget this experiment requests
    autoKillRule?: { budgetPctSpent: number; afterDays: number };
  }): { experiment?: IncomeExperiment; error?: string } {
    const budget = this._getBudget();
    if (!budget) {
      return { error: 'Set a budget with experimentManager.setBudget() before creating experiments.' };
    }

    // Check available budget
    const totalAllocated = Object.values(budget.allocated).reduce((a, b) => a + b, 0);
    const reserveHeld    = budget.totalBudget * (budget.reservePct / 100);
    const available      = budget.totalBudget - totalAllocated - reserveHeld;
    const alloc          = Math.min(params.budgetAsk, budget.maxPerExperiment, available);

    if (alloc <= 0) {
      return { error: `Insufficient budget. Available: $${available.toFixed(2)} (reserve: ${budget.reservePct}%). Reduce budget ask or add funds.` };
    }

    const id: string = crypto.randomUUID();
    const now = Date.now();

    const experiment: IncomeExperiment = {
      id,
      laneId:           params.laneId,
      name:             params.name.trim(),
      rationale:        params.rationale.trim(),
      status:           'proposed',
      createdAt:        now,
      budgetAllocated:  alloc,
      budgetSpent:      0,
      revenueEarned:    0,
      runbookIds:       [],
      contentJobIds:    [],
      platformLinks:    {},
      metrics:          { views: 0, clicks: 0, followers: 0, watchTimeHours: 0, conversions: 0, revenue: 0, adSpend: 0, lastUpdatedAt: now },
      autoKillRule:     params.autoKillRule ?? { budgetPctSpent: 80, afterDays: 14 },
    };

    // Persist experiment
    const existing = this._getAllExperiments();
    existing.push(experiment);
    this._saveExperiments(existing);

    // Reserve budget
    budget.allocated[id] = alloc;
    budget.spent[id]     = 0;
    this._store.setKv('incomeBudget', JSON.stringify(budget));

    writeLedger(this._ledgerPath, {
      ts: now, experimentId: id, type: 'status_change', from: undefined as never, to: 'proposed',
      reason: `Created: ${params.name}`,
    });

    return { experiment };
  }

  // ── State transitions ──────────────────────────────────────────────────────

  /**
   * Advances an experiment to the next status.
   * ALL transitions must be user-approved before calling this — this method
   * does not gate on approval, the IPC handler does.
   */
  transition(id: string, to: ExperimentStatus, reason?: string): { experiment?: IncomeExperiment; error?: string } {
    const experiment = this._getExperiment(id);
    if (!experiment) return { error: `Experiment "${id}" not found.` };

    if (!canTransition(experiment.status, to)) {
      return { error: `Cannot transition from "${experiment.status}" to "${to}".` };
    }

    const prev = experiment.status;
    experiment.status = to;
    if (to === 'launched') experiment.launchedAt = Date.now();
    if (to === 'killed' || to === 'completed') experiment.endedAt = Date.now();

    this._updateExperiment(experiment);

    writeLedger(this._ledgerPath, {
      ts: Date.now(), experimentId: id, type: 'status_change',
      from: prev, to, reason,
    });

    return { experiment };
  }

  // ── Spend recording ────────────────────────────────────────────────────────

  recordSpend(id: string, amount: number, reason: string): {
    ok?: boolean;
    experiment?: IncomeExperiment;
    dailyLimitHit?: boolean;
    budgetExceeded?: boolean;
    error?: string;
  } {
    if (amount <= 0) return { error: 'Spend amount must be positive.' };

    const experiment = this._getExperiment(id);
    if (!experiment) return { error: `Experiment "${id}" not found.` };
    if (experiment.status === 'killed' || experiment.status === 'completed') {
      return { error: 'Cannot record spend on a finished experiment.' };
    }

    let budget = this._getBudget();
    if (!budget) return { error: 'No budget configured.' };
    budget = resetDailyIfNeeded(budget);

    // Daily limit guard
    if (budget.dailySpentToday + amount > budget.dailyLimit) {
      return { dailyLimitHit: true, error: `Daily spend limit of $${budget.dailyLimit} would be exceeded. Approve to override or wait until tomorrow.` };
    }

    // Experiment budget guard
    if (experiment.budgetSpent + amount > experiment.budgetAllocated) {
      return { budgetExceeded: true, experiment, error: `Experiment budget of $${experiment.budgetAllocated} would be exceeded (spent: $${experiment.budgetSpent.toFixed(2)}).` };
    }

    // Record
    experiment.budgetSpent += amount;
    experiment.metrics.adSpend += amount;
    experiment.metrics.lastUpdatedAt = Date.now();
    this._updateExperiment(experiment);

    budget.spent[id] = (budget.spent[id] ?? 0) + amount;
    budget.dailySpentToday += amount;
    this._store.setKv('incomeBudget', JSON.stringify(budget));

    writeLedger(this._ledgerPath, {
      ts: Date.now(), experimentId: id, type: 'spend', amount, reason,
    });

    return { ok: true, experiment };
  }

  // ── Revenue recording ──────────────────────────────────────────────────────

  recordRevenue(id: string, amount: number, source: string): { ok?: boolean; experiment?: IncomeExperiment; error?: string } {
    if (amount <= 0) return { error: 'Revenue amount must be positive.' };

    const experiment = this._getExperiment(id);
    if (!experiment) return { error: `Experiment "${id}" not found.` };

    experiment.revenueEarned += amount;
    experiment.metrics.revenue += amount;
    experiment.metrics.conversions += 1;
    experiment.metrics.lastUpdatedAt = Date.now();
    this._updateExperiment(experiment);

    writeLedger(this._ledgerPath, {
      ts: Date.now(), experimentId: id, type: 'revenue', amount, source,
    });

    return { ok: true, experiment };
  }

  // ── Metrics update ─────────────────────────────────────────────────────────

  updateMetrics(id: string, patch: Partial<ExperimentMetrics>): { ok?: boolean; error?: string } {
    const experiment = this._getExperiment(id);
    if (!experiment) return { error: `Experiment "${id}" not found.` };

    experiment.metrics = { ...experiment.metrics, ...patch, lastUpdatedAt: Date.now() };
    this._updateExperiment(experiment);
    return { ok: true };
  }

  // ── Auto-kill evaluation ───────────────────────────────────────────────────

  /**
   * Evaluates the auto-kill rule for an experiment.
   * Returns a recommendation — the caller (IPC handler / scheduler) decides whether to act.
   * Never kills automatically — always surfaces for user approval.
   */
  evaluateAutoKill(id: string): {
    shouldKill:  boolean;
    shouldScale: boolean;
    reason:      string;
    roi:         number;
  } {
    const experiment = this._getExperiment(id);
    if (!experiment || experiment.status === 'killed' || experiment.status === 'completed') {
      return { shouldKill: false, shouldScale: false, reason: 'Experiment is not active.', roi: 0 };
    }

    const roi = experiment.budgetSpent > 0
      ? ((experiment.revenueEarned - experiment.budgetSpent) / experiment.budgetSpent) * 100
      : 0;

    const rule      = experiment.autoKillRule ?? { budgetPctSpent: 80, afterDays: 14 };
    const spentPct  = experiment.budgetAllocated > 0
      ? (experiment.budgetSpent / experiment.budgetAllocated) * 100
      : 0;
    const ageMs     = Date.now() - (experiment.launchedAt ?? experiment.createdAt);
    const ageDays   = ageMs / (1000 * 60 * 60 * 24);

    // Kill signal: spent ≥ threshold % of budget AND $0 revenue AND past the day window
    if (spentPct >= rule.budgetPctSpent && experiment.revenueEarned === 0 && ageDays >= rule.afterDays) {
      return {
        shouldKill:  true,
        shouldScale: false,
        reason:      `Spent ${spentPct.toFixed(0)}% of budget over ${ageDays.toFixed(0)} days with $0 revenue. Auto-kill threshold reached.`,
        roi,
      };
    }

    // Scale signal: ROI > 50% with meaningful revenue
    if (roi > 50 && experiment.revenueEarned > 10) {
      return {
        shouldKill:  false,
        shouldScale: true,
        reason:      `ROI is ${roi.toFixed(0)}% — experiment is outperforming. Consider scaling budget.`,
        roi,
      };
    }

    return {
      shouldKill:  false,
      shouldScale: false,
      reason:      `No action needed. ROI: ${roi.toFixed(0)}%, spend: ${spentPct.toFixed(0)}% of budget.`,
      roi,
    };
  }

  // ── Decision recording ─────────────────────────────────────────────────────

  recordDecision(id: string, decision: 'continue' | 'kill' | 'scale', reason: string): { ok?: boolean; error?: string } {
    const experiment = this._getExperiment(id);
    if (!experiment) return { error: `Experiment "${id}" not found.` };

    experiment.decision       = decision;
    experiment.decisionReason = reason;
    this._updateExperiment(experiment);

    writeLedger(this._ledgerPath, {
      ts: Date.now(), experimentId: id, type: 'decision', decision, decisionReason: reason,
    });

    // Auto-transition killed/scaling decisions
    if (decision === 'kill' && canTransition(experiment.status, 'killed')) {
      this.transition(id, 'killed', reason);
    }
    if (decision === 'scale' && canTransition(experiment.status, 'scaling')) {
      this.transition(id, 'scaling', reason);
    }

    return { ok: true };
  }

  // ── Summary ────────────────────────────────────────────────────────────────

  getExperimentSummary(id: string): {
    experiment?: IncomeExperiment;
    roi?:        number;
    roiLabel?:   string;
    recommendation?: 'continue' | 'kill' | 'scale';
    recommendationReason?: string;
    error?: string;
  } {
    const experiment = this._getExperiment(id);
    if (!experiment) return { error: `Experiment "${id}" not found.` };

    const evaluation  = this.evaluateAutoKill(id);
    const roi         = evaluation.roi;
    const roiLabel    = roi > 0 ? `+${roi.toFixed(0)}%` : `${roi.toFixed(0)}%`;

    let recommendation: 'continue' | 'kill' | 'scale' = 'continue';
    if (evaluation.shouldKill)  recommendation = 'kill';
    if (evaluation.shouldScale) recommendation = 'scale';

    return {
      experiment,
      roi,
      roiLabel,
      recommendation,
      recommendationReason: evaluation.reason,
    };
  }

  // ── List / Get ─────────────────────────────────────────────────────────────

  getAllExperiments(): IncomeExperiment[] {
    return this._getAllExperiments();
  }

  getExperiment(id: string): IncomeExperiment | undefined {
    return this._getExperiment(id) ?? undefined;
  }

  getActiveExperiments(): IncomeExperiment[] {
    return this._getAllExperiments().filter(
      e => e.status !== 'killed' && e.status !== 'completed'
    );
  }

  /** Returns an income context block for injection into the system prompt. */
  buildPromptContext(): string {
    const active = this.getActiveExperiments();
    if (active.length === 0) return '';

    const budget = this._getBudget();
    const lines: string[] = ['## Active Income Experiments'];

    for (const exp of active.slice(0, 3)) { // cap at 3 to keep prompt focused
      const roi      = exp.budgetSpent > 0
        ? ((exp.revenueEarned - exp.budgetSpent) / exp.budgetSpent * 100).toFixed(0)
        : '0';
      const spentPct = exp.budgetAllocated > 0
        ? ((exp.budgetSpent / exp.budgetAllocated) * 100).toFixed(0)
        : '0';

      lines.push(
        `\n### ${exp.name} (${exp.laneId.replace(/_/g, ' ')})`,
        `- Status: ${exp.status}`,
        `- Budget: $${exp.budgetAllocated} | Spent: $${exp.budgetSpent.toFixed(2)} (${spentPct}%)`,
        `- Revenue: $${exp.revenueEarned.toFixed(2)} | ROI: ${roi}%`,
      );
    }

    if (budget) {
      const totalSpent = Object.values(budget.spent).reduce((a, b) => a + b, 0);
      lines.push(
        '\n## Budget Constraints',
        `- Total budget: $${budget.totalBudget} | Spent: $${totalSpent.toFixed(2)}`,
        `- Daily limit: $${budget.dailyLimit} | Today: $${budget.dailySpentToday.toFixed(2)}`,
        '- Do not propose spending above daily limit without approval.',
        '- Do not publish or launch without explicit user approval.',
      );
    }

    return lines.join('\n');
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private _getBudget(): BudgetState | null {
    const raw = this._store.getKv('incomeBudget');
    if (!raw) return null;
    try { return JSON.parse(raw) as BudgetState; } catch { return null; }
  }

  private _getAllExperiments(): IncomeExperiment[] {
    const raw = this._store.getKv('incomeExperiments');
    if (!raw) return [];
    try { return JSON.parse(raw) as IncomeExperiment[]; } catch { return []; }
  }

  private _saveExperiments(experiments: IncomeExperiment[]): void {
    this._store.setKv('incomeExperiments', JSON.stringify(experiments));
  }

  private _getExperiment(id: string): IncomeExperiment | null {
    return this._getAllExperiments().find(e => e.id === id) ?? null;
  }

  private _updateExperiment(updated: IncomeExperiment): void {
    const all = this._getAllExperiments();
    const idx = all.findIndex(e => e.id === updated.id);
    if (idx === -1) return;
    all[idx] = updated;
    this._saveExperiments(all);
  }
}
