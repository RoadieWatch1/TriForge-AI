import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { ModeShell, SystemTile } from '../ui/Dashboard';
import { SYSTEM_REGISTRY } from '../core/AppState';

// ── Types ────────────────────────────────────────────────────────────────────

interface Experiment {
  id: string;
  name: string;
  laneId: string;
  status: string;
  budgetAllocated: number;
  budgetSpent: number;
  revenueEarned: number;
  createdAt: number;
  launchedAt?: number;
  autoKillRule?: { budgetPctSpent: number; afterDays: number };
  metrics: { views: number; clicks: number; conversions: number; revenue: number; lastUpdatedAt: number };
  decision?: string;
}

interface BudgetState {
  totalBudget: number;
  maxPerExperiment: number;
  dailyLimit: number;
  reservePct: number;
  dailySpentToday: number;
  dailySpentDate: string;
}

interface ForgeHubSkill {
  id: string;
  name: string;
  description: string;
  incomeLanes: string[];
}

interface AutoKillEval {
  shouldKill: boolean;
  shouldScale: boolean;
  reason: string;
  roi: number;
}

interface IncomeApprovalRequest {
  id: string;
  taskId: string;   // experimentId
  stepId: string;   // action name
  tool: string;
  args?: Record<string, unknown>;
  riskLevel: 'low' | 'medium' | 'high';
  createdAt: number;
  expiresAt: number;
  status: 'pending' | 'approved' | 'denied' | 'expired';
}

interface IncomeRecommendation {
  experimentId:      string;
  experimentName:    string;
  recommendedAction: string;
  reason:            string;
  riskLevel:         'low' | 'medium' | 'high';
  approvalRequired:  boolean;
  blockedBy:         string[];
  priority:          'critical' | 'high' | 'normal';
}

interface LaneReadiness {
  laneId:    string;
  laneName:  string;
  readiness: 'live' | 'building' | 'pending';
  skills:    Array<{ id: string; name: string; installed: boolean }>;
  platforms: Array<{ id: string; name: string; connected: boolean }>;
}

interface AutopilotStatus {
  enabled:         boolean;
  running:         boolean;
  lastRunAt:       number | null;
  intervalMs:      number;
  newRecoCount:    number;
  lastCycleResult: string | null;
}

const INCOME_TOOLS = new Set([
  'launch_experiment', 'spend_budget', 'publish_content',
  'kill_experiment', 'scale_experiment', 'connect_platform', 'install_tool',
]);

const INCOME_ACTION_LABELS: Record<string, string> = {
  launch_experiment: 'Launch Experiment',
  spend_budget:      'Record Spend',
  publish_content:   'Publish Content',
  kill_experiment:   'Kill Experiment',
  scale_experiment:  'Scale Experiment',
  connect_platform:  'Connect Platform',
  install_tool:      'Install Tool',
};

const RISK_COLORS: Record<string, string> = {
  low:    '#4ade80',
  medium: '#f59e0b',
  high:   '#f87171',
};

// ── Status config ─────────────────────────────────────────────────────────────

const STATUS_COLORS: Record<string, string> = {
  proposed:  'rgba(148,163,184,0.6)',
  approved:  'rgba(96,165,250,0.7)',
  building:  'rgba(251,191,36,0.7)',
  launched:  'rgba(167,139,250,0.7)',
  measuring: 'rgba(34,211,238,0.7)',
  scaling:   'rgba(74,222,128,0.8)',
  killed:    'rgba(248,113,113,0.7)',
  completed: 'rgba(52,211,153,0.8)',
};

const STATUS_LABELS: Record<string, string> = {
  proposed:  'Draft',
  approved:  'Approved',
  building:  'Building',
  launched:  'Live',
  measuring: 'Measuring',
  scaling:   'Scaling',
  killed:    'Killed',
  completed: 'Done',
};

const LANE_LABELS: Record<string, string> = {
  digital_products:  'Digital Products',
  client_services:   'Client Services',
  affiliate_content: 'Affiliate Content',
  faceless_youtube:  'Faceless YouTube',
  short_form_brand:  'Short-Form Brand',
  ai_music:          'AI Music',
  mini_games:        'Mini Games',
  asset_packs:       'Asset Packs',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function roi(exp: Experiment): number {
  if (exp.budgetSpent <= 0) return 0;
  return ((exp.revenueEarned - exp.budgetSpent) / exp.budgetSpent) * 100;
}

function spentPct(exp: Experiment): number {
  if (exp.budgetAllocated <= 0) return 0;
  return (exp.budgetSpent / exp.budgetAllocated) * 100;
}

function daysSince(ts: number): number {
  return Math.floor((Date.now() - ts) / (1000 * 60 * 60 * 24));
}

function isActive(exp: Experiment): boolean {
  return exp.status !== 'killed' && exp.status !== 'completed';
}

const tf = () => (window as any).triforge;

// ── Props ─────────────────────────────────────────────────────────────────────

interface Props {
  onNavigate: (screen: string) => void;
}

// ── HustleMode ────────────────────────────────────────────────────────────────

export function HustleMode({ onNavigate }: Props) {
  const [tab, setTab] = useState<'income' | 'tools'>('income');

  // Trading systems
  const systems       = SYSTEM_REGISTRY.filter(s => s.modes.includes('hustle'));
  const tradeSystem   = systems.find(s => s.id === 'trade_desk');
  const liveAdvisor   = systems.find(s => s.id === 'live_trade_advisor');
  const otherSystems  = systems.filter(s => !['trade_desk', 'live_trade_advisor'].includes(s.id));

  return (
    <ModeShell
      title="Income Operator"
      subtitle="Run controlled income experiments — budget-capped, approval-first, ROI-driven."
    >
      {/* Tab bar */}
      <div style={styles.tabBar}>
        <button
          style={{ ...styles.tab, ...(tab === 'income' ? styles.tabActive : {}) }}
          onClick={() => setTab('income')}
        >
          Income Operator
        </button>
        <button
          style={{ ...styles.tab, ...(tab === 'tools' ? styles.tabActive : {}) }}
          onClick={() => setTab('tools')}
        >
          Trading
        </button>
      </div>

      {tab === 'income' && (
        <IncomeOperatorPanel onNavigate={onNavigate} />
      )}

      {tab === 'tools' && (
        <TradingPanel
          tradeSystem={tradeSystem}
          liveAdvisor={liveAdvisor}
          otherSystems={otherSystems}
          onNavigate={onNavigate}
        />
      )}
    </ModeShell>
  );
}

// ── Income Operator Panel ─────────────────────────────────────────────────────

function IncomeOperatorPanel({ onNavigate }: { onNavigate: (screen: string) => void }) {
  const [experiments, setExperiments]           = useState<Experiment[]>([]);
  const [budget, setBudget]                     = useState<BudgetState | null>(null);
  const [skills, setSkills]                     = useState<ForgeHubSkill[]>([]);
  const [evaluations, setEvaluations]           = useState<Record<string, AutoKillEval>>({});
  const [pendingApprovals, setPendingApprovals] = useState<IncomeApprovalRequest[]>([]);
  const [recommendations, setRecommendations]   = useState<IncomeRecommendation[]>([]);
  const [readiness, setReadiness]               = useState<LaneReadiness[]>([]);
  const [autopilotStatus, setAutopilotStatus]   = useState<AutopilotStatus | null>(null);
  const [loading, setLoading]                   = useState(true);
  const [error, setError]                       = useState<string | null>(null);
  const [actionMsg, setActionMsg]               = useState<string | null>(null);
  const [actionError, setActionError]           = useState<string | null>(null);
  const [feedTick, setFeedTick]                 = useState(0); // increments after each successful mutation to refresh ActivityFeed
  const _loadingRef                             = useRef(false); // prevent concurrent loads
  const _debounceRef                            = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Modals
  const [spendModal, setSpendModal]     = useState<{ id: string; name: string } | null>(null);
  const [revenueModal, setRevenueModal] = useState<{ id: string; name: string } | null>(null);
  const [createModal, setCreateModal]   = useState(false);
  const [detailExp, setDetailExp]       = useState<Experiment | null>(null);

  const load = useCallback(async () => {
    if (_loadingRef.current) return;
    _loadingRef.current = true;
    setLoading(true);
    setError(null);

    try {
      // ── Critical path: experiments + budget ──────────────────────────────
      // If either fails the panel cannot function — show error banner with Retry.
      let exps: Experiment[];
      let budgetVal: BudgetState | null;
      try {
        const [expResult, budgetResult] = await Promise.all([
          tf().experiments.list(),
          tf().experiments.getBudget(),
        ]);
        exps     = (expResult.experiments ?? []) as Experiment[];
        budgetVal = budgetResult.budget ?? null;
      } catch {
        setError('Failed to load experiments. Check that Income Operator is enabled.');
        return;
      }
      setExperiments(exps);
      setBudget(budgetVal);

      // ── Non-critical: ForgeHub skills (fall back to empty) ───────────────
      try {
        const skillsResult = await tf().forgeHub.list();
        setSkills((skillsResult.skills ?? []) as ForgeHubSkill[]);
      } catch { setSkills([]); }

      // ── Non-critical: Pending approvals (fall back to empty) ─────────────
      let incomeApprovals: IncomeApprovalRequest[] = [];
      try {
        const approvalsResult = await tf().approvals.list();
        const all = (approvalsResult.requests ?? []) as IncomeApprovalRequest[];
        incomeApprovals = all.filter(a => INCOME_TOOLS.has(a.tool) && a.status === 'pending');
      } catch { incomeApprovals = []; }
      setPendingApprovals(incomeApprovals);

      // ── Non-critical: Auto-kill evaluations (parallel, per-experiment) ────
      const evals: Record<string, AutoKillEval> = {};
      await Promise.all(
        exps.filter(isActive).map(async exp => {
          try {
            const ev = await tf().experiments.evaluateAutoKill(exp.id);
            if (!ev.error) evals[exp.id] = ev as AutoKillEval;
          } catch { /* skip — card renders without kill signal */ }
        }),
      );
      setEvaluations(evals);

      // ── Non-critical: Recommendations (fall back to empty) ───────────────
      try {
        const approvalKeys = incomeApprovals.map(a => `${a.taskId}:${a.tool}`);
        const recoResult   = await tf().income.getRecommendations(approvalKeys);
        setRecommendations((recoResult.recommendations ?? []) as IncomeRecommendation[]);
      } catch { setRecommendations([]); }

      // ── Non-critical: Lane readiness (fall back to empty) ────────────────
      try {
        const activeLaneIds = [...new Set(exps.filter(isActive).map(e => e.laneId))];
        if (activeLaneIds.length > 0) {
          const readinessResult = await tf().income.getReadiness(activeLaneIds);
          setReadiness((readinessResult.lanes ?? []) as LaneReadiness[]);
        } else {
          setReadiness([]);
        }
      } catch { setReadiness([]); }

      // ── Non-critical: Autopilot status (keep current on failure) ─────────
      try {
        const apResult = await tf().autopilot.status();
        if (apResult.status) setAutopilotStatus(apResult.status as AutopilotStatus);
      } catch { /* keep last known status */ }

    } finally {
      setLoading(false);
      _loadingRef.current = false;
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  // Debounced refresh — used by push event handlers to avoid burst reloads
  // when multiple autopilot events fire in quick succession.
  const scheduleLoad = useCallback(() => {
    if (_debounceRef.current) clearTimeout(_debounceRef.current);
    _debounceRef.current = setTimeout(() => { void load(); }, 350);
  }, [load]);

  // Subscribe to autopilot push events (Phase 5)
  useEffect(() => {
    const unsubStatus  = tf().autopilot.onStatus(() => {
      tf().autopilot.status().then((r: { status?: AutopilotStatus }) => {
        if (r.status) setAutopilotStatus(r.status);
      });
    });
    const unsubChanged = tf().autopilot.onChanged(() => {
      // Recommendations changed — debounced full refresh
      scheduleLoad();
    });
    return () => {
      unsubStatus();
      unsubChanged();
      if (_debounceRef.current) clearTimeout(_debounceRef.current);
    };
  }, [load, scheduleLoad]);

  const act = async (fn: () => Promise<unknown>, successMsg: string) => {
    setActionError(null);
    try {
      const result = (await fn()) as Record<string, unknown>;
      // Support both ActionResult shape (success/error) and legacy {ok/error} shape
      const failed = result.success === false || (result.success === undefined && result.error);
      if (failed) {
        setActionError((result.error as string) ?? 'Action failed.');
        setTimeout(() => setActionError(null), 5000);
      } else {
        setActionMsg(successMsg);
        setTimeout(() => setActionMsg(null), 3500);
        setFeedTick(t => t + 1);
        void load();
      }
    } catch (e) {
      setActionError(e instanceof Error ? e.message : 'Action failed.');
      setTimeout(() => setActionError(null), 5000);
    }
  };

  const handleTransition = (id: string, to: string, reason: string) =>
    act(() => tf().experiments.transition(id, to, reason), `Experiment moved to ${STATUS_LABELS[to] ?? to}.`);

  const handleKill = (id: string, name: string) => {
    if (!confirm(`Kill "${name}"? This cannot be undone.`)) return;
    void act(() => tf().experiments.kill(id, 'User-initiated kill from Income Operator'), `"${name}" killed.`);
  };

  // Execute the action matching a just-approved income approval
  const executeApprovedAction = async (approval: IncomeApprovalRequest): Promise<void> => {
    const { taskId: expId, tool } = approval;
    switch (tool) {
      case 'kill_experiment':    await tf().experiments.kill(expId, 'Approved via Income Operator'); break;
      case 'scale_experiment':   await tf().experiments.scale(expId, 'Approved via Income Operator'); break;
      case 'launch_experiment':  await tf().experiments.launch(expId, 'Approved via Income Operator'); break;
      case 'publish_content':    await tf().experiments.publishContent(expId, String(approval.args?.platform ?? 'unknown'), 'Approved via Income Operator'); break;
      case 'connect_platform':   await tf().experiments.connectPlatform(expId, String(approval.args?.platform ?? 'unknown'), String(approval.args?.url ?? '')); break;
      // spend_budget and install_tool are handled externally — no direct execution here
      default: break;
    }
  };

  const handleApprove = async (approvalId: string) => {
    // Re-validate: find the approval in current state before executing.
    // This guards against the race where the approval was denied/expired
    // in another session while this UI was open.
    const approval = pendingApprovals.find(a => a.id === approvalId && a.status === 'pending');
    if (!approval) {
      setActionError('Approval no longer pending — refresh to see current state.');
      setTimeout(() => setActionError(null), 5000);
      void load();
      return;
    }
    await act(async () => {
      const result = await tf().approvals.approve(approvalId);
      if (result.success && approval) {
        await executeApprovedAction(approval);
      }
      return result;
    }, 'Action approved and executed.');
  };

  const handleDeny = (approvalId: string) =>
    act(() => tf().approvals.deny(approvalId, 'Denied from Income Operator'), 'Action denied.');

  // Phase 5: Autopilot controls
  const handleAutopilotToggle = async () => {
    const ap = autopilotStatus;
    if (!ap) return;
    if (ap.enabled) {
      const r = await tf().autopilot.disable();
      if (r.data?.status) setAutopilotStatus(r.data.status as AutopilotStatus);
    } else {
      const r = await tf().autopilot.enable();
      if (!r.success) { setActionError(`Autopilot: ${r.error ?? 'Enable failed.'}`); setTimeout(() => setActionError(null), 4000); return; }
      if (r.data?.status) setAutopilotStatus(r.data.status as AutopilotStatus);
    }
  };

  const handleAutopilotRunNow = async () => {
    setActionMsg('Running autopilot cycle...');
    const r = await tf().autopilot.runNow();
    if (!r.success) {
      setActionMsg(null);
      setActionError(`Autopilot: ${r.error ?? 'Run failed.'}`);
      setTimeout(() => setActionError(null), 4000);
      return;
    }
    if (r.data?.status) setAutopilotStatus(r.data.status as AutopilotStatus);
    setActionMsg((r.data?.status as AutopilotStatus | undefined)?.lastCycleResult ?? 'Autopilot cycle complete.');
    setTimeout(() => setActionMsg(null), 4000);
  };

  // Phase 4E: Install a ForgeHub skill directly (low risk — no approval required)
  const handleInstallSkill = async (skillId: string, skillName: string) => {
    await act(async () => {
      const mdResult = await tf().forgeHub.getMarkdown(skillId) as { markdown?: string; error?: string };
      if (mdResult.error || !mdResult.markdown) return { error: mdResult.error ?? 'No markdown found' };
      return tf().skillStore.install(mdResult.markdown, 'forgehub');
    }, `"${skillName}" installed.`);
  };

  // Phase 4E: Request a platform connection (medium risk — requires approval)
  const handleConnectPlatform = async (laneId: string, platformId: string, platformName: string) => {
    await act(
      () => tf().incomeApprovals.create(laneId, 'connect_platform', { platform: platformId }, 'medium'),
      `Connection request created for ${platformName}.`,
    );
  };

  // Route a recommendation — either create an approval or execute directly
  const handleRecommendedAction = async (rec: IncomeRecommendation) => {
    if (rec.blockedBy.length > 0) {
      setActionMsg(`Blocked: ${rec.blockedBy.join(', ')}`);
      setTimeout(() => setActionMsg(null), 4000);
      return;
    }

    if (rec.approvalRequired) {
      await act(
        () => tf().incomeApprovals.create(rec.experimentId, rec.recommendedAction, {}, rec.riskLevel),
        `Approval request created for: ${INCOME_ACTION_LABELS[rec.recommendedAction] ?? rec.recommendedAction}.`,
      );
    } else {
      // Safe action — execute directly through the appropriate handler
      switch (rec.recommendedAction) {
        case 'launch_experiment':
          await act(() => tf().experiments.launch(rec.experimentId, rec.reason), `"${rec.experimentName}" advanced.`);
          break;
        case 'publish_content':
          await act(() => tf().experiments.publishContent(rec.experimentId, 'unknown', rec.reason), 'Content publish recorded.');
          break;
        default:
          await act(() => tf().experiments.transition(rec.experimentId, 'approved', rec.reason), 'Experiment updated.');
      }
    }
  };

  const activeExps   = useMemo(() => experiments.filter(isActive),                                   [experiments]);
  const finishedExps = useMemo(() => experiments.filter(e => !isActive(e)),                          [experiments]);
  const totalRevenue = useMemo(() => experiments.reduce((a, e) => a + e.revenueEarned, 0),           [experiments]);
  const totalSpent   = useMemo(() => experiments.reduce((a, e) => a + e.budgetSpent, 0),             [experiments]);
  const atRisk       = useMemo(() => activeExps.filter(e => evaluations[e.id]?.shouldKill).length,   [activeExps, evaluations]);

  if (loading) {
    return <div style={styles.loading}>Loading Income Operator...</div>;
  }

  // First-run: no experiments and no budget configured yet — show 3-step onboarding
  if (experiments.length === 0 && budget === null) {
    return (
      <div style={styles.operatorRoot}>
        {error && (
          <div style={styles.errorBanner}>
            {error}
            <button style={styles.retryBtn} onClick={() => void load()}>Retry</button>
          </div>
        )}
        <FirstRunGuide onCreateExperiment={() => setCreateModal(true)} onBrowseCatalog={() => onNavigate('forgehub')} />
        {createModal && (
          <CreateExperimentModal
            onClose={() => setCreateModal(false)}
            onCreated={() => { setCreateModal(false); void load(); }}
          />
        )}
      </div>
    );
  }

  return (
    <div style={styles.operatorRoot}>
      {error && (
        <div style={styles.errorBanner}>
          {error}
          <button style={styles.retryBtn} onClick={() => void load()}>Retry</button>
        </div>
      )}
      {actionError && <div style={styles.errorBanner}>{actionError}</div>}
      {actionMsg && <div style={styles.actionBanner}>{actionMsg}</div>}

      {/* ── Overview stats ────────────────────────────────────────────────── */}
      <div style={styles.statsRow}>
        <StatCard label="Active Experiments" value={String(activeExps.length)} accent="#60a5fa" />
        <StatCard label="Total Revenue"      value={`$${totalRevenue.toFixed(2)}`} accent="#4ade80" />
        <StatCard label="Total Spent"        value={`$${totalSpent.toFixed(2)}`}   accent="#f59e0b" />
        <StatCard label="At Risk"            value={String(atRisk)} accent={atRisk > 0 ? '#f87171' : '#94a3b8'} />
      </div>

      {/* ── Budget bar ────────────────────────────────────────────────────── */}
      {budget ? (
        <BudgetBar budget={budget} />
      ) : (
        <div style={styles.noBudget}>
          No budget configured.{' '}
          <span style={styles.link} onClick={() => setCreateModal(true)}>Set budget to start an experiment.</span>
        </div>
      )}

      {/* ── Pending income approvals ──────────────────────────────────────── */}
      {pendingApprovals.length > 0 && (
        <IncomeApprovalsPanel
          approvals={pendingApprovals}
          experiments={experiments}
          onApprove={handleApprove}
          onDeny={handleDeny}
        />
      )}

      {/* ── Autopilot bar (Phase 5) ───────────────────────────────────────── */}
      {autopilotStatus && (
        <AutopilotBar
          status={autopilotStatus}
          onToggle={handleAutopilotToggle}
          onRunNow={handleAutopilotRunNow}
        />
      )}

      {/* ── Recommended Actions rail (Phase 4C decision engine) ───────────── */}
      <RecommendedActionsRail
        recommendations={recommendations}
        onAction={handleRecommendedAction}
        onCreateExperiment={() => setCreateModal(true)}
        hasExperiments={activeExps.length > 0}
      />

      {/* ── Active experiments table ──────────────────────────────────────── */}
      <SectionHeader label="Active Experiments" count={activeExps.length} />
      {activeExps.length === 0 ? (
        <div style={styles.emptyState}>
          No active experiments.{' '}
          <span style={styles.link} onClick={() => setCreateModal(true)}>Create your first experiment.</span>
        </div>
      ) : (
        activeExps.map(exp => (
          <ExperimentCard
            key={exp.id}
            experiment={exp}
            evaluation={evaluations[exp.id]}
            onTransition={handleTransition}
            onKill={handleKill}
            onRecordSpend={() => setSpendModal({ id: exp.id, name: exp.name })}
            onRecordRevenue={() => setRevenueModal({ id: exp.id, name: exp.name })}
            onDetails={() => setDetailExp(exp)}
          />
        ))
      )}

      {/* ── ForgeHub skills panel ─────────────────────────────────────────── */}
      <SkillsPanel experiments={activeExps} skills={skills} onBrowseCatalog={() => onNavigate('forgehub')} />

      {/* ── Finished experiments ──────────────────────────────────────────── */}
      {finishedExps.length > 0 && (
        <>
          <SectionHeader label="Finished Experiments" count={finishedExps.length} />
          {finishedExps.slice(0, 5).map(exp => (
            <ExperimentCard key={exp.id} experiment={exp} evaluation={evaluations[exp.id]} onTransition={handleTransition} onKill={handleKill} onRecordSpend={() => {}} onRecordRevenue={() => {}} />
          ))}
        </>
      )}

      {/* ── Lane readiness (Phase 4E: skills + platforms) ─────────────────── */}
      <ReadinessPanel
        lanes={readiness}
        onInstallSkill={handleInstallSkill}
        onConnectPlatform={handleConnectPlatform}
      />

      {/* ── Inline activity feed ──────────────────────────────────────────── */}
      <ActivityFeed key={feedTick} />

      {/* ── Modals ────────────────────────────────────────────────────────── */}
      {detailExp && (
        <ExperimentDetailModal
          experiment={detailExp}
          evaluation={evaluations[detailExp.id]}
          recommendation={recommendations.find(r => r.experimentId === detailExp.id) ?? null}
          pendingApprovals={pendingApprovals.filter(a => a.taskId === detailExp.id)}
          onClose={() => setDetailExp(null)}
          onAction={handleRecommendedAction}
          onApprove={handleApprove}
          onDeny={handleDeny}
        />
      )}
      {spendModal && (
        <SpendModal
          experimentId={spendModal.id}
          experimentName={spendModal.name}
          onClose={() => setSpendModal(null)}
          onSubmit={(amount, reason) =>
            act(() => tf().experiments.recordSpend(spendModal.id, amount, reason), `Spend of $${amount} recorded.`)
              .then(() => setSpendModal(null))
          }
        />
      )}
      {revenueModal && (
        <RevenueModal
          experimentId={revenueModal.id}
          experimentName={revenueModal.name}
          onClose={() => setRevenueModal(null)}
          onSubmit={(amount, source) =>
            act(() => tf().experiments.recordRevenue(revenueModal.id, amount, source), `Revenue of $${amount} recorded.`)
              .then(() => setRevenueModal(null))
          }
        />
      )}
      {createModal && (
        <CreateExperimentModal
          onClose={() => setCreateModal(false)}
          onCreated={() => { setCreateModal(false); void load(); }}
        />
      )}
    </div>
  );
}

// ── StatCard ─────────────────────────────────────────────────────────────────

function StatCard({ label, value, accent }: { label: string; value: string; accent: string }) {
  return (
    <div style={styles.statCard}>
      <div style={{ ...styles.statValue, color: accent }}>{value}</div>
      <div style={styles.statLabel}>{label}</div>
    </div>
  );
}

// ── BudgetBar ─────────────────────────────────────────────────────────────────

function BudgetBar({ budget }: { budget: BudgetState }) {
  const dailyPct = budget.dailyLimit > 0 ? (budget.dailySpentToday / budget.dailyLimit) * 100 : 0;
  const dailyWarning = dailyPct >= 80;
  return (
    <div style={styles.budgetBar}>
      <div style={styles.budgetRow}>
        <span style={styles.budgetLabel}>Budget Pool</span>
        <span style={styles.budgetValue}>${budget.totalBudget} total / ${budget.maxPerExperiment} per experiment / {budget.reservePct}% reserve</span>
      </div>
      <div style={styles.budgetRow}>
        <span style={styles.budgetLabel}>Daily Cap</span>
        <span style={{ ...styles.budgetValue, color: dailyWarning ? '#f87171' : 'rgba(255,255,255,0.6)' }}>
          ${budget.dailySpentToday.toFixed(2)} / ${budget.dailyLimit} today
          {dailyWarning && '  — NEAR LIMIT'}
        </span>
      </div>
      <div style={styles.progressTrack}>
        <div style={{ ...styles.progressFill, width: `${Math.min(100, dailyPct)}%`, background: dailyWarning ? '#f87171' : '#60a5fa' }} />
      </div>
    </div>
  );
}

// ── IncomeApprovalsPanel ──────────────────────────────────────────────────────

function IncomeApprovalsPanel({
  approvals, experiments, onApprove, onDeny,
}: {
  approvals:   IncomeApprovalRequest[];
  experiments: Experiment[];
  onApprove:   (id: string) => void;
  onDeny:      (id: string) => void;
}) {
  const expMap = Object.fromEntries(experiments.map(e => [e.id, e.name]));

  return (
    <div style={styles.approvalsPanel}>
      <div style={styles.approvalsPanelHeader}>
        <span style={styles.approvalsPanelTitle}>Pending Approvals</span>
        <span style={styles.approvalsBadge}>{approvals.length}</span>
      </div>
      {approvals.map(a => {
        const expName  = expMap[a.taskId] ?? a.taskId;
        const action   = INCOME_ACTION_LABELS[a.tool] ?? a.tool;
        const riskColor = RISK_COLORS[a.riskLevel] ?? '#94a3b8';
        const expiresIn = Math.max(0, Math.floor((a.expiresAt - Date.now()) / (1000 * 60 * 60)));
        return (
          <div key={a.id} style={styles.approvalRow}>
            <div style={styles.approvalInfo}>
              <div style={styles.approvalAction}>
                <span style={{ ...styles.approvalRisk, color: riskColor }}>{a.riskLevel.toUpperCase()}</span>
                {action}
              </div>
              <div style={styles.approvalMeta}>
                Experiment: <strong>{expName}</strong>
                {a.args && Object.keys(a.args).length > 0 && (
                  <span style={styles.approvalArgs}>
                    {' — '}
                    {Object.entries(a.args)
                      .filter(([, v]) => v !== undefined && v !== null)
                      .map(([k, v]) => `${k}: ${String(v)}`)
                      .join(', ')}
                  </span>
                )}
              </div>
              <div style={styles.approvalExpiry}>Expires in {expiresIn}h</div>
            </div>
            <div style={styles.approvalActions}>
              <button style={styles.approveBtn} onClick={() => onApprove(a.id)}>Approve</button>
              <button style={styles.denyBtn}    onClick={() => onDeny(a.id)}>Deny</button>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ── SectionHeader ─────────────────────────────────────────────────────────────

function SectionHeader({ label, count }: { label: string; count: number }) {
  return (
    <div style={styles.sectionHeader}>
      <span style={styles.sectionLabel}>{label}</span>
      <span style={styles.sectionCount}>{count}</span>
    </div>
  );
}

// ── AutopilotBar (Phase 5) ────────────────────────────────────────────────────

function AutopilotBar({
  status, onToggle, onRunNow,
}: {
  status:    AutopilotStatus;
  onToggle:  () => void;
  onRunNow:  () => void;
}) {
  const intervalLabel = status.intervalMs >= 60_000
    ? `every ${Math.round(status.intervalMs / 60_000)}m`
    : `every ${Math.round(status.intervalMs / 1_000)}s`;

  const lastRunLabel = status.lastRunAt
    ? new Date(status.lastRunAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : 'Never';

  return (
    <div style={styles.autopilotBar}>
      <div style={styles.autopilotLeft}>
        <button
          style={{
            ...styles.autopilotToggle,
            background: status.enabled ? 'rgba(74,222,128,0.12)' : 'rgba(255,255,255,0.04)',
            borderColor: status.enabled ? 'rgba(74,222,128,0.35)' : 'rgba(255,255,255,0.1)',
            color: status.enabled ? '#4ade80' : 'rgba(255,255,255,0.4)',
          }}
          onClick={onToggle}
        >
          {status.enabled ? 'Autopilot ON' : 'Autopilot OFF'}
        </button>
        <span style={styles.autopilotMeta}>
          {status.enabled ? intervalLabel : 'manual only'}
          {' · '}
          Last run: {lastRunLabel}
        </span>
        {status.newRecoCount > 0 && (
          <span style={styles.autopilotNewBadge}>
            {status.newRecoCount} new
          </span>
        )}
      </div>
      <div style={styles.autopilotRight}>
        {status.lastCycleResult && (
          <span style={styles.autopilotResult}>{status.lastCycleResult}</span>
        )}
        <button
          style={styles.autopilotRunBtn}
          onClick={onRunNow}
          disabled={status.running}
          title="Run autopilot cycle now"
        >
          {status.running ? 'Running...' : 'Run Now'}
        </button>
      </div>
    </div>
  );
}

// ── RecommendedActionsRail (Phase 4C) ────────────────────────────────────────

const ACTION_LABELS: Record<string, string> = {
  launch_experiment:  'Launch',
  kill_experiment:    'Kill Experiment',
  scale_experiment:   'Scale Experiment',
  spend_budget:       'Record Spend',
  publish_content:    'Publish Content',
  connect_platform:   'Connect Platform',
  install_tool:       'Install Tool',
};

const PRIORITY_COLORS: Record<string, string> = {
  critical: '#f87171',
  high:     '#f59e0b',
  normal:   '#60a5fa',
};

function RecommendedActionsRail({
  recommendations, onAction, onCreateExperiment, hasExperiments,
}: {
  recommendations:   IncomeRecommendation[];
  onAction:          (rec: IncomeRecommendation) => void;
  onCreateExperiment: () => void;
  hasExperiments:    boolean;
}) {
  // Prompt to create experiment if none exist
  if (!hasExperiments) {
    return (
      <div style={styles.recoSection}>
        <div style={styles.sectionLabel}>Recommended Actions</div>
        <div style={styles.recoCards}>
          <RecoCard
            priority="normal" riskLevel="low" approvalRequired={false}
            experimentName="" action="Create Experiment"
            reason="No active experiments. Start your first income experiment to begin tracking ROI."
            blockedBy={[]}
            onAction={onCreateExperiment}
          />
        </div>
      </div>
    );
  }

  if (recommendations.length === 0) {
    return (
      <div style={styles.recoSection}>
        <div style={styles.sectionLabel}>Recommended Actions</div>
        <div style={styles.recoCalm}>
          No actions needed right now. Experiments are running as expected.
        </div>
      </div>
    );
  }

  return (
    <div style={styles.recoSection}>
      <div style={styles.sectionLabel}>Recommended Actions</div>
      <div style={styles.recoCards}>
        {recommendations.map(rec => (
          <RecoCard
            key={`${rec.experimentId}:${rec.recommendedAction}`}
            priority={rec.priority}
            riskLevel={rec.riskLevel}
            approvalRequired={rec.approvalRequired}
            experimentName={rec.experimentName}
            action={ACTION_LABELS[rec.recommendedAction] ?? rec.recommendedAction}
            reason={rec.reason}
            blockedBy={rec.blockedBy}
            onAction={() => onAction(rec)}
          />
        ))}
      </div>
    </div>
  );
}

function RecoCard({
  priority, riskLevel, approvalRequired, experimentName, action, reason, blockedBy, onAction,
}: {
  priority:        'critical' | 'high' | 'normal';
  riskLevel:       'low' | 'medium' | 'high';
  approvalRequired: boolean;
  experimentName:  string;
  action:          string;
  reason:          string;
  blockedBy:       string[];
  onAction:        () => void;
}) {
  const priorityColor = PRIORITY_COLORS[priority] ?? '#60a5fa';
  const riskColor     = RISK_COLORS[riskLevel] ?? '#94a3b8';
  const borderColor   = priority === 'critical' ? 'rgba(248,113,113,0.35)'
    : priority === 'high' ? 'rgba(245,158,11,0.3)' : 'rgba(96,165,250,0.2)';
  const blocked = blockedBy.length > 0;

  return (
    <div style={{ ...styles.recoCard, borderColor, opacity: blocked ? 0.6 : 1 }}>
      <div style={styles.recoCardHeader}>
        {experimentName && <span style={styles.recoExpName}>{experimentName}</span>}
        <div style={styles.recoBadges}>
          <span style={{ ...styles.recoBadge, color: priorityColor, borderColor: `${priorityColor}44` }}>
            {priority.toUpperCase()}
          </span>
          <span style={{ ...styles.recoBadge, color: riskColor, borderColor: `${riskColor}44` }}>
            {riskLevel.toUpperCase()} RISK
          </span>
          {approvalRequired && (
            <span style={{ ...styles.recoBadge, color: '#a78bfa', borderColor: 'rgba(167,139,250,0.4)' }}>
              NEEDS APPROVAL
            </span>
          )}
        </div>
      </div>
      <span style={styles.recoText}>{reason}</span>
      {blockedBy.length > 0 && (
        <div style={styles.recoBlockers}>
          {blockedBy.map(b => (
            <span key={b} style={styles.blockerChip}>{b}</span>
          ))}
        </div>
      )}
      <button
        style={{ ...styles.recoBtn, color: priorityColor, borderColor: `${priorityColor}44` }}
        onClick={onAction}
        disabled={blocked}
        title={blocked ? `Blocked by: ${blockedBy.join(', ')}` : undefined}
      >
        {approvalRequired ? `Request: ${action}` : action}
      </button>
    </div>
  );
}

// ── ExperimentCard ────────────────────────────────────────────────────────────

function ExperimentCard({ experiment: exp, evaluation: ev, onTransition, onKill, onRecordSpend, onRecordRevenue, onDetails }: {
  experiment:    Experiment;
  evaluation?:   AutoKillEval;
  onTransition:  (id: string, to: string, reason: string) => void;
  onKill:        (id: string, name: string) => void;
  onRecordSpend: () => void;
  onRecordRevenue: () => void;
  onDetails?:    () => void;
}) {
  const roiVal    = roi(exp);
  const roiColor  = roiVal > 0 ? '#4ade80' : roiVal < 0 ? '#f87171' : 'rgba(255,255,255,0.4)';
  const roiLabel  = roiVal > 0 ? `+${roiVal.toFixed(0)}%` : `${roiVal.toFixed(0)}%`;
  const spent     = spentPct(exp);
  const statusColor = STATUS_COLORS[exp.status] ?? 'rgba(148,163,184,0.5)';
  const ageLabel  = exp.launchedAt ? `${daysSince(exp.launchedAt)}d live` : `${daysSince(exp.createdAt)}d old`;
  const finished  = !isActive(exp);

  // Guard banners
  const overBudget    = spent >= 100;
  const nearBudget    = spent >= 80 && spent < 100;
  const autoKillAlert = ev?.shouldKill;

  return (
    <div style={{ ...styles.expCard, opacity: finished ? 0.65 : 1 }}>
      {/* Header row */}
      <div style={styles.expHeader}>
        <div style={styles.expTitleRow}>
          <span style={styles.expName}>{exp.name}</span>
          <span style={{ ...styles.statusChip, background: statusColor }}>{STATUS_LABELS[exp.status] ?? exp.status}</span>
        </div>
        <span style={styles.expMeta}>{LANE_LABELS[exp.laneId] ?? exp.laneId} · {ageLabel}</span>
      </div>

      {/* Guard banners */}
      {autoKillAlert && (
        <div style={styles.guardBanner}>
          Auto-kill threshold reached — {ev!.reason}
        </div>
      )}
      {overBudget && !autoKillAlert && (
        <div style={{ ...styles.guardBanner, borderColor: 'rgba(248,113,113,0.4)', color: '#f87171' }}>
          Budget exhausted — no more spend allowed without approval.
        </div>
      )}
      {nearBudget && !overBudget && (
        <div style={{ ...styles.guardBanner, borderColor: 'rgba(251,191,36,0.4)', color: '#fbbf24' }}>
          Warning: {spent.toFixed(0)}% of budget spent.
        </div>
      )}

      {/* Metrics row */}
      <div style={styles.metricsRow}>
        <MetricPill label="Budget"  value={`$${exp.budgetAllocated}`}        />
        <MetricPill label="Spent"   value={`$${exp.budgetSpent.toFixed(2)}`} warn={nearBudget} danger={overBudget} />
        <MetricPill label="Revenue" value={`$${exp.revenueEarned.toFixed(2)}`} />
        <MetricPill label="ROI"     value={roiLabel} color={roiColor} />
        <MetricPill label="Views"   value={String(exp.metrics.views)}        />
        <MetricPill label="Conversions" value={String(exp.metrics.conversions)} />
      </div>

      {/* Budget progress bar */}
      <div style={styles.progressTrack}>
        <div style={{
          ...styles.progressFill,
          width: `${Math.min(100, spent)}%`,
          background: overBudget ? '#f87171' : nearBudget ? '#fbbf24' : '#60a5fa',
        }} />
      </div>

      {/* Actions */}
      <div style={styles.expActions}>
        {onDetails && (
          <button style={{ ...styles.actionBtn, color: '#a78bfa', borderColor: 'rgba(167,139,250,0.3)' }} onClick={onDetails}>Details</button>
        )}
        {!finished && (
          <>
            <button style={styles.actionBtn} onClick={onRecordSpend}>Record Spend</button>
            <button style={styles.actionBtn} onClick={onRecordRevenue}>Record Revenue</button>
            <button style={{ ...styles.actionBtn, color: '#f87171', borderColor: 'rgba(248,113,113,0.3)' }} onClick={() => onKill(exp.id, exp.name)}>Kill</button>
          </>
        )}
      </div>
    </div>
  );
}

function MetricPill({ label, value, warn, danger, color }: {
  label: string; value: string; warn?: boolean; danger?: boolean; color?: string;
}) {
  const clr = color ?? (danger ? '#f87171' : warn ? '#fbbf24' : 'rgba(255,255,255,0.7)');
  return (
    <div style={styles.metricPill}>
      <span style={styles.metricLabel}>{label}</span>
      <span style={{ ...styles.metricValue, color: clr }}>{value}</span>
    </div>
  );
}

// ── SkillsPanel ───────────────────────────────────────────────────────────────

function SkillsPanel({ experiments, skills, onBrowseCatalog }: {
  experiments:      Experiment[];
  skills:           ForgeHubSkill[];
  onBrowseCatalog:  () => void;
}) {
  const activeLanes = [...new Set(experiments.map(e => e.laneId))];
  if (activeLanes.length === 0 || skills.length === 0) return null;

  const relevantSkills = skills.filter(s => s.incomeLanes.some(l => activeLanes.includes(l)));
  if (relevantSkills.length === 0) return null;

  return (
    <div style={styles.skillsSection}>
      <div style={styles.skillsSectionHeader}>
        <span style={styles.sectionLabel}>ForgeHub Skills for Active Lanes</span>
        <button style={styles.browseCatalogLink} onClick={onBrowseCatalog}>Browse Catalog →</button>
      </div>
      <div style={styles.skillGrid}>
        {relevantSkills.slice(0, 6).map(skill => (
          <div key={skill.id} style={styles.skillCard}>
            <div style={styles.skillName}>{skill.name}</div>
            <div style={styles.skillDesc}>{skill.description}</div>
            <div style={styles.skillLanes}>
              {skill.incomeLanes.filter(l => activeLanes.includes(l)).map(l => (
                <span key={l} style={styles.laneChip}>{LANE_LABELS[l] ?? l}</span>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── SpendModal ────────────────────────────────────────────────────────────────

function SpendModal({ experimentId, experimentName, onClose, onSubmit }: {
  experimentId: string; experimentName: string;
  onClose: () => void;
  onSubmit: (amount: number, reason: string) => void;
}) {
  const [amount, setAmount]   = useState('');
  const [reason, setReason]   = useState('');
  const [error, setError]     = useState('');
  void experimentId; // used by parent

  const submit = () => {
    const n = parseFloat(amount);
    if (isNaN(n) || n <= 0) { setError('Enter a valid positive amount.'); return; }
    if (!reason.trim()) { setError('Enter a reason for this spend.'); return; }
    onSubmit(n, reason.trim());
  };

  return (
    <Modal title={`Record Spend — ${experimentName}`} onClose={onClose}>
      <ModalField label="Amount ($)" value={amount} onChange={setAmount} placeholder="e.g. 12.50" type="number" />
      <ModalField label="Reason"     value={reason} onChange={setReason} placeholder="e.g. Gumroad listing fee" />
      {error && <p style={styles.modalError}>{error}</p>}
      <div style={styles.modalActions}>
        <button style={styles.modalCancel} onClick={onClose}>Cancel</button>
        <button style={styles.modalSubmit} onClick={submit}>Record Spend</button>
      </div>
    </Modal>
  );
}

// ── RevenueModal ──────────────────────────────────────────────────────────────

function RevenueModal({ experimentId, experimentName, onClose, onSubmit }: {
  experimentId: string; experimentName: string;
  onClose: () => void;
  onSubmit: (amount: number, source: string) => void;
}) {
  const [amount, setAmount] = useState('');
  const [source, setSource] = useState('');
  const [error, setError]   = useState('');
  void experimentId;

  const submit = () => {
    const n = parseFloat(amount);
    if (isNaN(n) || n <= 0) { setError('Enter a valid positive amount.'); return; }
    if (!source.trim()) { setError('Enter the revenue source (e.g. Gumroad).'); return; }
    onSubmit(n, source.trim());
  };

  return (
    <Modal title={`Record Revenue — ${experimentName}`} onClose={onClose}>
      <ModalField label="Amount ($)" value={amount} onChange={setAmount} placeholder="e.g. 29.00" type="number" />
      <ModalField label="Source"     value={source} onChange={setSource} placeholder="e.g. Gumroad, Etsy, TikTok" />
      {error && <p style={styles.modalError}>{error}</p>}
      <div style={styles.modalActions}>
        <button style={styles.modalCancel} onClick={onClose}>Cancel</button>
        <button style={{ ...styles.modalSubmit, background: 'rgba(74,222,128,0.15)', borderColor: 'rgba(74,222,128,0.3)', color: '#4ade80' }} onClick={submit}>Record Revenue</button>
      </div>
    </Modal>
  );
}

// ── CreateExperimentModal ─────────────────────────────────────────────────────

// ── ActivityFeed (Phase 4D) ───────────────────────────────────────────────────

interface ActivityEvent { ts: number; label: string; detail: string; eventType: string; }

const EVENT_COLORS: Record<string, string> = {
  revenue:                         '#4ade80',
  spend:                           '#f59e0b',
  decision:                        '#a78bfa',
  action:                          '#60a5fa',
  status:                          'rgba(255,255,255,0.45)',
  AUTOPILOT_RUN_COMPLETED:         'rgba(255,255,255,0.25)',
  AUTOPILOT_RECOMMENDATION_CHANGED:'#f59e0b',
  AUTOPILOT_APPROVAL_CREATED:      '#a78bfa',
};

function ActivityFeed() {
  const [events, setEvents]   = useState<ActivityEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const result = await tf().income.getActivity(20);
        setEvents((result.events ?? []) as ActivityEvent[]);
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  if (loading) return null; // Silent — don't block the main view
  if (events.length === 0) return null;

  const visible = expanded ? events : events.slice(0, 5);

  return (
    <div style={styles.feedSection}>
      <div style={styles.feedHeader}>
        <span style={styles.sectionLabel}>Recent Activity</span>
        {events.length > 5 && (
          <button style={styles.feedToggle} onClick={() => setExpanded(v => !v)}>
            {expanded ? 'Show less' : `Show all ${events.length}`}
          </button>
        )}
      </div>
      {visible.map((e, i) => (
        <div key={i} style={styles.feedRow}>
          <span style={{ ...styles.feedDot, background: EVENT_COLORS[e.eventType] ?? 'rgba(255,255,255,0.2)' }} />
          <div style={styles.feedContent}>
            <span style={{ ...styles.feedLabel, color: EVENT_COLORS[e.eventType] ?? 'rgba(255,255,255,0.45)' }}>{e.label}</span>
            {e.detail && <span style={styles.feedDetail}>{e.detail}</span>}
          </div>
          <span style={styles.feedTime}>{new Date(e.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
        </div>
      ))}
    </div>
  );
}

// ── ReadinessPanel (Phase 4E) ─────────────────────────────────────────────────
// Replaces the Phase 4D LaneReadinessPanel with skill install + platform connect.

function ReadinessPanel({
  lanes, onInstallSkill, onConnectPlatform,
}: {
  lanes:              LaneReadiness[];
  onInstallSkill:     (id: string, name: string) => void;
  onConnectPlatform:  (laneId: string, platformId: string, platformName: string) => void;
}) {
  if (lanes.length === 0) return null;

  return (
    <div style={styles.readinessSection}>
      <div style={styles.sectionLabel}>Lane Readiness</div>
      <div style={styles.readinessGrid}>
        {lanes.map(lane => {
          const color = lane.readiness === 'live' ? '#4ade80'
            : lane.readiness === 'building' ? '#f59e0b' : '#94a3b8';
          const label = lane.readiness === 'live' ? 'Live'
            : lane.readiness === 'building' ? 'Building' : 'Pending';

          const installedSkills = lane.skills.filter(s => s.installed);
          const missingSkills   = lane.skills.filter(s => !s.installed);
          const connectedPlats  = lane.platforms.filter(p => p.connected);
          const missingPlats    = lane.platforms.filter(p => !p.connected);

          return (
            <div key={lane.laneId} style={styles.readinessCard}>
              {/* Header */}
              <div style={styles.readinessTop}>
                <span style={styles.readinessLane}>{lane.laneName}</span>
                <span style={{ ...styles.readinessBadge, color, borderColor: `${color}44` }}>{label}</span>
              </div>

              {/* Skills row */}
              {lane.skills.length > 0 && (
                <div style={styles.readinessRow}>
                  <span style={styles.readinessRowLabel}>Skills</span>
                  <div style={styles.readinessChips}>
                    {installedSkills.map(s => (
                      <span key={s.id} style={{ ...styles.readinessSkillChip, ...styles.readinessChipInstalled }}>
                        {s.name}
                      </span>
                    ))}
                    {missingSkills.map(s => (
                      <button
                        key={s.id}
                        style={{ ...styles.readinessSkillChip, ...styles.readinessChipMissing }}
                        onClick={() => onInstallSkill(s.id, s.name)}
                        title={`Install "${s.name}" from ForgeHub`}
                      >
                        + {s.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Platforms row */}
              {lane.platforms.length > 0 && (
                <div style={styles.readinessRow}>
                  <span style={styles.readinessRowLabel}>Platforms</span>
                  <div style={styles.readinessChips}>
                    {connectedPlats.map(p => (
                      <span key={p.id} style={{ ...styles.readinessSkillChip, ...styles.readinessChipInstalled }}>
                        {p.name}
                      </span>
                    ))}
                    {missingPlats.map(p => (
                      <button
                        key={p.id}
                        style={{ ...styles.readinessSkillChip, ...styles.readinessChipConnect }}
                        onClick={() => onConnectPlatform(lane.laneId, p.id, p.name)}
                        title={`Request connection to ${p.name}`}
                      >
                        ↗ {p.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ── FirstRunGuide (Phase 6) ───────────────────────────────────────────────────
// 3-step onboarding: pick lane → install starter skill → create first experiment.
// Shown when experiments.length === 0 AND budget === null (truly fresh workspace).

function FirstRunGuide({ onCreateExperiment, onBrowseCatalog }: { onCreateExperiment: () => void; onBrowseCatalog: () => void }) {
  const [step, setStep]                       = useState<1 | 2 | 3>(1);
  const [selectedLane, setSelectedLane]       = useState<string | null>(null);
  const [starterSkill, setStarterSkill]       = useState<{ id: string; name: string } | null>(null);
  const [loadingSkill, setLoadingSkill]       = useState(false);
  const [skillMsg, setSkillMsg]               = useState<string | null>(null);
  const [skillError, setSkillError]           = useState<string | null>(null);

  const handlePickLane = async (laneId: string) => {
    setSelectedLane(laneId);
    setStep(2);
    setLoadingSkill(true);
    setStarterSkill(null);
    try {
      const result = await tf().forgeHub.forLane(laneId) as { skills?: Array<{ id: string; name: string }> };
      setStarterSkill(result.skills?.[0] ?? null);
    } catch {
      setStarterSkill(null);
    } finally {
      setLoadingSkill(false);
    }
  };

  const handleInstallSkill = async () => {
    if (!starterSkill) { setStep(3); return; }
    setSkillError(null);
    setSkillMsg(null);
    try {
      const mdResult = await tf().forgeHub.getMarkdown(starterSkill.id) as { markdown?: string; error?: string };
      if (mdResult.error || !mdResult.markdown) {
        setSkillError(mdResult.error ?? 'Skill not found in ForgeHub.');
        return;
      }
      const result = await tf().skillStore.install(mdResult.markdown, 'forgehub');
      if (!result.success) {
        setSkillError(result.error ?? 'Install failed.');
        return;
      }
      setSkillMsg(`"${starterSkill.name}" installed.`);
      setTimeout(() => setStep(3), 900);
    } catch (e) {
      setSkillError(e instanceof Error ? e.message : 'Install failed.');
    }
  };

  const LANE_ENTRIES = Object.entries(LANE_LABELS);

  return (
    <div style={styles.firstRunRoot}>
      <div style={styles.firstRunHeader}>Get started with Income Operator</div>
      <div style={styles.firstRunSubtitle}>3 steps to your first income experiment.</div>

      {/* Step progress dots */}
      <div style={styles.firstRunDots}>
        {([1, 2, 3] as const).map(s => (
          <div
            key={s}
            style={{
              ...styles.firstRunDot,
              background: step === s ? '#a78bfa'
                : step > s ? 'rgba(74,222,128,0.5)'
                : 'rgba(255,255,255,0.1)',
            }}
          />
        ))}
      </div>

      {/* Step 1: Pick an income lane */}
      {step === 1 && (
        <div style={styles.firstRunStep}>
          <div style={styles.firstRunStepLabel}>Step 1 — Choose an income lane</div>
          <div style={styles.firstRunLaneGrid}>
            {LANE_ENTRIES.map(([id, name]) => (
              <button
                key={id}
                style={styles.firstRunLaneBtn}
                onClick={() => void handlePickLane(id)}
              >
                {name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Step 2: Install starter skill */}
      {step === 2 && (
        <div style={styles.firstRunStep}>
          <div style={styles.firstRunStepLabel}>
            Step 2 — Starter skill for {LANE_LABELS[selectedLane ?? ''] ?? selectedLane}
          </div>
          {loadingSkill ? (
            <div style={styles.firstRunHint}>Looking up top skill...</div>
          ) : starterSkill ? (
            <>
              <div style={styles.firstRunSkillName}>{starterSkill.name}</div>
              {skillError && <div style={styles.firstRunError}>{skillError}</div>}
              {skillMsg  && <div style={styles.firstRunSuccess}>{skillMsg}</div>}
              <div style={styles.firstRunBtns}>
                <button style={styles.firstRunPrimaryBtn} onClick={() => void handleInstallSkill()}>
                  Install Skill
                </button>
                <button style={styles.firstRunSkipBtn} onClick={() => setStep(3)}>Skip</button>
              </div>
            </>
          ) : (
            <>
              <div style={styles.firstRunHint}>No starter skill found for this lane.</div>
              <div style={styles.firstRunBtns}>
                <button style={styles.firstRunPrimaryBtn} onClick={() => setStep(3)}>Continue</button>
                <button style={styles.firstRunSkipBtn} onClick={onBrowseCatalog}>Browse Catalog</button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Step 3: Create first experiment */}
      {step === 3 && (
        <div style={styles.firstRunStep}>
          <div style={styles.firstRunStepLabel}>Step 3 — Create your first experiment</div>
          <div style={styles.firstRunHint}>
            Set a budget cap, pick a lane, and let the operator track your ROI automatically.
          </div>
          <button style={styles.firstRunPrimaryBtn} onClick={onCreateExperiment}>
            Create Experiment
          </button>
        </div>
      )}
    </div>
  );
}

// ── ExperimentDetailModal (Phase 4D) ──────────────────────────────────────────

interface IncomeEvent {
  ts: number; type?: string; amount?: number; source?: string;
  reason?: string; from?: string; to?: string;
  decision?: string; decisionReason?: string;
}

function ExperimentDetailModal({
  experiment: exp, evaluation: ev, recommendation: rec,
  pendingApprovals: approvals, onClose, onAction, onApprove, onDeny,
}: {
  experiment:      Experiment;
  evaluation?:     AutoKillEval;
  recommendation:  IncomeRecommendation | null;
  pendingApprovals: IncomeApprovalRequest[];
  onClose:         () => void;
  onAction:        (rec: IncomeRecommendation) => void;
  onApprove:       (id: string) => void;
  onDeny:          (id: string) => void;
}) {
  const [events, setEvents] = useState<IncomeEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(true);

  useEffect(() => {
    void (async () => {
      try {
        const result = await tf().experiments.getEvents(exp.id, 20);
        setEvents((result.events ?? []) as IncomeEvent[]);
      } finally {
        setLoadingEvents(false);
      }
    })();
  }, [exp.id]);

  const roiVal   = roi(exp);
  const roiColor = roiVal > 0 ? '#4ade80' : roiVal < 0 ? '#f87171' : 'rgba(255,255,255,0.4)';
  const spent    = spentPct(exp);

  function eventLabel(e: IncomeEvent): string {
    if (e.type === 'spend')         return `Spend: $${(e.amount ?? 0).toFixed(2)} — ${e.reason ?? ''}`;
    if (e.type === 'revenue')       return `Revenue: $${(e.amount ?? 0).toFixed(2)} — ${e.source ?? ''}`;
    if (e.type === 'status_change') return `Status: ${e.from} → ${e.to}`;
    if (e.type === 'decision')      return `Decision: ${e.decision}${e.decisionReason ? ` — ${e.decisionReason}` : ''}`;
    return e.type ?? 'Event';
  }

  function eventColor(e: IncomeEvent): string {
    if (e.type === 'revenue')              return '#4ade80';
    if (e.type === 'spend')                return '#f59e0b';
    if (e.type === 'decision' && e.decision === 'kill') return '#f87171';
    if (e.type === 'decision' && e.decision === 'scale') return '#4ade80';
    return 'rgba(255,255,255,0.45)';
  }

  return (
    <div style={styles.modalOverlay} onClick={onClose}>
      <div style={{ ...styles.modalBox, maxWidth: 560, maxHeight: '80vh', overflowY: 'auto' }} onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div style={styles.modalHeader}>
          <div>
            <span style={styles.modalTitle}>{exp.name}</span>
            <span style={{ ...styles.statusChip, background: STATUS_COLORS[exp.status] ?? 'rgba(148,163,184,0.5)', marginLeft: 8 }}>
              {STATUS_LABELS[exp.status] ?? exp.status}
            </span>
          </div>
          <button style={styles.modalClose} onClick={onClose}>✕</button>
        </div>

        {/* Meta */}
        <div style={styles.detailSection}>
          <div style={styles.detailGrid}>
            <DetailCell label="Lane"     value={LANE_LABELS[exp.laneId] ?? exp.laneId} />
            <DetailCell label="Age"      value={exp.launchedAt ? `${daysSince(exp.launchedAt)}d live` : `${daysSince(exp.createdAt)}d old`} />
            <DetailCell label="Budget"   value={`$${exp.budgetAllocated}`} />
            <DetailCell label="Spent"    value={`$${exp.budgetSpent.toFixed(2)} (${spent.toFixed(0)}%)`} color={spent >= 80 ? '#f87171' : undefined} />
            <DetailCell label="Revenue"  value={`$${exp.revenueEarned.toFixed(2)}`} color={exp.revenueEarned > 0 ? '#4ade80' : undefined} />
            <DetailCell label="ROI"      value={roiVal !== 0 ? `${roiVal > 0 ? '+' : ''}${roiVal.toFixed(0)}%` : '—'} color={roiColor} />
          </div>
        </div>

        {/* Auto-kill eval */}
        {ev && (ev.shouldKill || ev.shouldScale) && (
          <div style={{ ...styles.detailSection, borderColor: ev.shouldKill ? 'rgba(248,113,113,0.3)' : 'rgba(74,222,128,0.3)' }}>
            <span style={{ fontSize: 10, fontWeight: 700, color: ev.shouldKill ? '#f87171' : '#4ade80', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              {ev.shouldKill ? 'Kill Signal' : 'Scale Signal'}
            </span>
            <p style={{ color: 'rgba(255,255,255,0.6)', fontSize: 11, margin: '4px 0 0' }}>{ev.reason}</p>
          </div>
        )}

        {/* Recommendation */}
        {rec && (
          <div style={styles.detailSection}>
            <span style={styles.detailSectionLabel}>Recommended Action</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 6 }}>
              <span style={{ color: 'rgba(255,255,255,0.6)', fontSize: 11, flex: 1 }}>{rec.reason}</span>
              <button
                style={{ ...styles.recoBtn, color: PRIORITY_COLORS[rec.priority] ?? '#60a5fa', borderColor: `${PRIORITY_COLORS[rec.priority] ?? '#60a5fa'}44` }}
                onClick={() => { onAction(rec); onClose(); }}
              >
                {rec.approvalRequired ? `Request: ${ACTION_LABELS[rec.recommendedAction] ?? rec.recommendedAction}` : (ACTION_LABELS[rec.recommendedAction] ?? rec.recommendedAction)}
              </button>
            </div>
          </div>
        )}

        {/* Pending approvals for this experiment */}
        {approvals.length > 0 && (
          <div style={styles.detailSection}>
            <span style={styles.detailSectionLabel}>Pending Approvals ({approvals.length})</span>
            {approvals.map(a => (
              <div key={a.id} style={styles.detailApprovalRow}>
                <span style={{ color: RISK_COLORS[a.riskLevel] ?? '#94a3b8', fontSize: 10, fontWeight: 700 }}>{a.riskLevel.toUpperCase()}</span>
                <span style={{ color: 'rgba(255,255,255,0.65)', fontSize: 11, flex: 1 }}>{INCOME_ACTION_LABELS[a.tool] ?? a.tool}</span>
                <button style={{ ...styles.approveBtn, fontSize: 10, padding: '3px 10px' }} onClick={() => onApprove(a.id)}>Approve</button>
                <button style={{ ...styles.denyBtn,    fontSize: 10, padding: '3px 10px' }} onClick={() => onDeny(a.id)}>Deny</button>
              </div>
            ))}
          </div>
        )}

        {/* Recent events */}
        <div style={styles.detailSection}>
          <span style={styles.detailSectionLabel}>Recent Events</span>
          {loadingEvents ? (
            <div style={{ color: 'rgba(255,255,255,0.3)', fontSize: 11, marginTop: 6 }}>Loading...</div>
          ) : events.length === 0 ? (
            <div style={{ color: 'rgba(255,255,255,0.2)', fontSize: 11, marginTop: 6 }}>No events recorded yet.</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, marginTop: 6 }}>
              {events.map((e, i) => (
                <div key={i} style={styles.detailEventRow}>
                  <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: 9, minWidth: 60 }}>
                    {new Date(e.ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <span style={{ color: eventColor(e), fontSize: 11 }}>{eventLabel(e)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DetailCell({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={styles.detailCell}>
      <span style={styles.detailCellLabel}>{label}</span>
      <span style={{ ...styles.detailCellValue, ...(color ? { color } : {}) }}>{value}</span>
    </div>
  );
}

// ── Experiment templates (Phase 7.4) ──────────────────────────────────────────

interface ExperimentTemplate {
  id:        string;
  name:      string;    // suggested experiment name
  laneId:    string;
  rationale: string;
  budgetAsk: string;
  killPct:   string;
  killDays:  string;
}

const EXPERIMENT_TEMPLATES: ExperimentTemplate[] = [
  { id: 'gumroad',          name: 'First Gumroad Digital Product',    laneId: 'digital_products',  rationale: 'Validate demand for a digital product by listing on Gumroad with a minimal budget cap.', budgetAsk: '50', killPct: '80', killDays: '14' },
  { id: 'etsy',             name: 'Etsy Asset Pack Launch',           laneId: 'asset_packs',        rationale: 'Sell a themed asset pack on Etsy and measure conversion rate over two weeks.',             budgetAsk: '30', killPct: '90', killDays: '14' },
  { id: 'tiktok-affiliate', name: 'TikTok Affiliate Funnel',          laneId: 'affiliate_content',  rationale: 'Drive affiliate conversions through short-form TikTok content with tracked links.',         budgetAsk: '30', killPct: '90', killDays: '21' },
  { id: 'youtube-faceless', name: 'Faceless YouTube Channel',         laneId: 'faceless_youtube',   rationale: 'Grow a faceless channel with SEO-optimized videos and measure watch-time and ad revenue.',  budgetAsk: '40', killPct: '80', killDays: '30' },
  { id: 'short-brand',      name: 'Short-Form Brand Build',           laneId: 'short_form_brand',   rationale: 'Build a branded short-form content presence and convert followers to product revenue.',      budgetAsk: '30', killPct: '90', killDays: '21' },
  { id: 'ai-music',         name: 'AI Music Distribution Run',        laneId: 'ai_music',           rationale: 'Publish AI-generated music tracks and measure streaming revenue over 30 days.',             budgetAsk: '20', killPct: '100', killDays: '30' },
  { id: 'mini-game',        name: 'Itch.io Mini Game Launch',         laneId: 'mini_games',         rationale: 'Ship a focused small game and test pay-what-you-want pricing with no upfront spend.',       budgetAsk: '0',  killPct: '100', killDays: '30' },
  { id: 'client-ai',        name: 'AI Client Service Pilot',          laneId: 'client_services',    rationale: 'Offer an AI-powered client service and validate pricing through early paid engagements.',    budgetAsk: '0',  killPct: '100', killDays: '21' },
];

const LANE_OPTIONS: Array<{ id: string; label: string }> = [
  { id: 'digital_products',  label: 'Digital Products (Gumroad / Etsy)' },
  { id: 'client_services',   label: 'Client Services (AI Automation)' },
  { id: 'affiliate_content', label: 'Affiliate Content' },
  { id: 'faceless_youtube',  label: 'Faceless YouTube' },
  { id: 'short_form_brand',  label: 'Short-Form Brand (TikTok / Reels)' },
  { id: 'ai_music',          label: 'AI Music Channel' },
  { id: 'mini_games',        label: 'Mini Games (Itch.io)' },
  { id: 'asset_packs',       label: 'Digital Asset Packs' },
];

function CreateExperimentModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [name, setName]           = useState('');
  const [laneId, setLaneId]       = useState('digital_products');
  const [rationale, setRationale] = useState('');
  const [budgetAsk, setBudgetAsk] = useState('');
  const [killPct, setKillPct]     = useState('80');
  const [killDays, setKillDays]   = useState('14');
  const [error, setError]         = useState('');
  const [submitting, setSubmitting] = useState(false);

  const applyTemplate = (templateId: string) => {
    const t = EXPERIMENT_TEMPLATES.find(t => t.id === templateId);
    if (!t) return;
    setName(t.name);
    setLaneId(t.laneId);
    setRationale(t.rationale);
    setBudgetAsk(t.budgetAsk);
    setKillPct(t.killPct);
    setKillDays(t.killDays);
  };

  const submit = async () => {
    if (!name.trim())      { setError('Name is required.'); return; }
    if (!rationale.trim()) { setError('Rationale is required.'); return; }
    const budget = parseFloat(budgetAsk);
    if (isNaN(budget) || budget < 0) { setError('Enter a budget amount (0 or more).'); return; }

    setSubmitting(true);
    try {
      const result = await tf().experiments.create({
        laneId,
        name: name.trim(),
        rationale: rationale.trim(),
        budgetAsk: budget,
        autoKillRule: { budgetPctSpent: parseInt(killPct, 10), afterDays: parseInt(killDays, 10) },
      }) as { success: boolean; error?: string };

      if (!result.success) {
        setError(result.error ?? 'Failed to create experiment.');
      } else {
        onCreated();
      }
    } catch {
      setError('Failed to create experiment. Is a budget configured?');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Modal title="New Income Experiment" onClose={onClose}>
      {/* Template selector */}
      <div style={styles.modalField}>
        <label style={styles.modalLabel}>Start from template (optional)</label>
        <select
          style={styles.modalSelect}
          defaultValue=""
          onChange={e => { if (e.target.value) applyTemplate(e.target.value); }}
        >
          <option value="">— Start blank —</option>
          {EXPERIMENT_TEMPLATES.map(t => (
            <option key={t.id} value={t.id}>{t.name}</option>
          ))}
        </select>
      </div>
      <ModalField label="Name"      value={name}      onChange={setName}      placeholder="e.g. Notion Budget Template on Gumroad" />
      <div style={styles.modalField}>
        <label style={styles.modalLabel}>Income Lane</label>
        <select style={styles.modalSelect} value={laneId} onChange={e => setLaneId(e.target.value)}>
          {LANE_OPTIONS.map(o => <option key={o.id} value={o.id}>{o.label}</option>)}
        </select>
      </div>
      <ModalField label="Rationale"  value={rationale}  onChange={setRationale}  placeholder="Why this experiment now?" />
      <ModalField label="Budget ($)" value={budgetAsk}  onChange={setBudgetAsk}  placeholder="e.g. 50" type="number" />
      <div style={styles.killRow}>
        <div style={styles.killField}>
          <label style={styles.modalLabel}>Kill if spent %</label>
          <input style={styles.modalInput} value={killPct} onChange={e => setKillPct(e.target.value)} type="number" min="1" max="100" />
        </div>
        <div style={styles.killField}>
          <label style={styles.modalLabel}>with $0 revenue after days</label>
          <input style={styles.modalInput} value={killDays} onChange={e => setKillDays(e.target.value)} type="number" min="1" />
        </div>
      </div>
      {error && <p style={styles.modalError}>{error}</p>}
      <div style={styles.modalActions}>
        <button style={styles.modalCancel}  onClick={onClose}>Cancel</button>
        <button style={styles.modalSubmit}  onClick={submit} disabled={submitting}>
          {submitting ? 'Creating...' : 'Create Experiment'}
        </button>
      </div>
    </Modal>
  );
}

// ── Modal shell ───────────────────────────────────────────────────────────────

function Modal({ title, children, onClose }: { title: string; children: React.ReactNode; onClose: () => void }) {
  return (
    <div style={styles.modalOverlay} onClick={onClose}>
      <div style={styles.modalBox} onClick={e => e.stopPropagation()}>
        <div style={styles.modalHeader}>
          <span style={styles.modalTitle}>{title}</span>
          <button style={styles.modalClose} onClick={onClose}>✕</button>
        </div>
        {children}
      </div>
    </div>
  );
}

function ModalField({ label, value, onChange, placeholder, type = 'text' }: {
  label: string; value: string; onChange: (v: string) => void; placeholder: string; type?: string;
}) {
  return (
    <div style={styles.modalField}>
      <label style={styles.modalLabel}>{label}</label>
      <input style={styles.modalInput} type={type} value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} />
    </div>
  );
}

// ── Trading Panel ─────────────────────────────────────────────────────────────

function TradingPanel({ tradeSystem, liveAdvisor, otherSystems, onNavigate }: {
  tradeSystem:  ReturnType<typeof SYSTEM_REGISTRY.find>;
  liveAdvisor:  ReturnType<typeof SYSTEM_REGISTRY.find>;
  otherSystems: ReturnType<typeof SYSTEM_REGISTRY.filter>;
  onNavigate:   (screen: string) => void;
}) {
  return (
    <>
      {tradeSystem  && <SystemTile system={tradeSystem}  onAction={() => onNavigate('tradeDesk')}        actionLabel="Open Trade Desk" />}
      {liveAdvisor  && <SystemTile system={liveAdvisor}  onAction={() => onNavigate('liveTradeAdvisor')} actionLabel="Open Live Trade Advisor" />}
      {otherSystems.map(s => (
        <SystemTile key={s.id} system={s}
          onAction={() => console.log(`[HustleMode] stub: ${s.id}`)}
          actionLabel={s.id === 'deal_closer' ? 'Set Up Deals' : 'Find Investors'}
        />
      ))}
    </>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  // ── Tabs
  tabBar: {
    display: 'flex',
    gap: 4,
    marginBottom: 16,
    borderBottom: '1px solid rgba(255,255,255,0.07)',
    paddingBottom: 0,
    width: '100%',
  },
  tab: {
    background: 'none',
    border: 'none',
    borderBottom: '2px solid transparent',
    color: 'rgba(255,255,255,0.4)',
    cursor: 'pointer',
    fontSize: 12,
    fontWeight: 600,
    padding: '6px 14px 8px',
    letterSpacing: '0.03em',
  },
  tabActive: {
    borderBottom: '2px solid #a78bfa',
    color: '#a78bfa',
  },

  // ── Operator root
  operatorRoot: {
    display: 'flex',
    flexDirection: 'column',
    gap: 12,
    width: '100%',
  },
  loading: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 12,
    padding: '24px 0',
    textAlign: 'center',
  },
  // ── Autopilot bar (Phase 5)
  autopilotBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    background: 'rgba(255,255,255,0.025)',
    border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: 7,
    padding: '8px 12px',
  },
  autopilotLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: 10,
    flex: 1,
    minWidth: 0,
  },
  autopilotToggle: {
    border: '1px solid',
    borderRadius: 5,
    cursor: 'pointer',
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.03em',
    padding: '4px 10px',
    flexShrink: 0,
  },
  autopilotMeta: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: 10,
    whiteSpace: 'nowrap' as const,
  },
  autopilotNewBadge: {
    background: 'rgba(245,158,11,0.15)',
    border: '1px solid rgba(245,158,11,0.3)',
    borderRadius: 4,
    color: '#f59e0b',
    fontSize: 9,
    fontWeight: 700,
    padding: '1px 5px',
    flexShrink: 0,
  },
  autopilotRight: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    flexShrink: 0,
  },
  autopilotResult: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: 10,
    maxWidth: 200,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  autopilotRunBtn: {
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 5,
    color: 'rgba(255,255,255,0.5)',
    cursor: 'pointer',
    fontSize: 10,
    padding: '3px 9px',
  },

  errorBanner: {
    background: 'rgba(248,113,113,0.1)',
    border: '1px solid rgba(248,113,113,0.25)',
    borderRadius: 6,
    color: '#f87171',
    fontSize: 11,
    padding: '8px 12px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 10,
  },
  retryBtn: {
    background: 'rgba(248,113,113,0.12)',
    border: '1px solid rgba(248,113,113,0.3)',
    borderRadius: 5,
    color: '#f87171',
    cursor: 'pointer',
    fontSize: 10,
    fontWeight: 700,
    flexShrink: 0,
    padding: '3px 10px',
  },
  actionBanner: {
    background: 'rgba(74,222,128,0.1)',
    border: '1px solid rgba(74,222,128,0.25)',
    borderRadius: 6,
    color: '#4ade80',
    fontSize: 11,
    padding: '8px 12px',
  },
  noBudget: {
    background: 'rgba(255,255,255,0.03)',
    border: '1px dashed rgba(255,255,255,0.1)',
    borderRadius: 6,
    color: 'rgba(255,255,255,0.4)',
    fontSize: 11,
    padding: '10px 14px',
  },
  link: {
    color: '#a78bfa',
    cursor: 'pointer',
    textDecoration: 'underline',
  },

  // ── Income Approvals Panel
  approvalsPanel: {
    background: 'rgba(167,139,250,0.06)',
    border: '1px solid rgba(167,139,250,0.2)',
    borderRadius: 8,
    padding: '10px 12px',
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  approvalsPanelHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginBottom: 2,
  },
  approvalsPanelTitle: {
    color: '#a78bfa',
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.06em',
    textTransform: 'uppercase' as const,
  },
  approvalsBadge: {
    background: '#a78bfa',
    borderRadius: 10,
    color: '#1e1b4b',
    fontSize: 10,
    fontWeight: 700,
    padding: '1px 6px',
  },
  approvalRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: 6,
    padding: '8px 12px',
  },
  approvalInfo: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 2,
    flex: 1,
    minWidth: 0,
  },
  approvalAction: {
    color: 'rgba(255,255,255,0.9)',
    fontSize: 12,
    fontWeight: 600,
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  approvalRisk: {
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: '0.05em',
  },
  approvalMeta: {
    color: 'rgba(255,255,255,0.45)',
    fontSize: 11,
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  approvalArgs: {
    color: 'rgba(255,255,255,0.3)',
  },
  approvalExpiry: {
    color: 'rgba(255,255,255,0.25)',
    fontSize: 10,
  },
  approvalActions: {
    display: 'flex',
    gap: 6,
    flexShrink: 0,
  },
  approveBtn: {
    background: 'rgba(74,222,128,0.15)',
    border: '1px solid rgba(74,222,128,0.35)',
    borderRadius: 5,
    color: '#4ade80',
    cursor: 'pointer',
    fontSize: 11,
    fontWeight: 600,
    padding: '4px 10px',
  },
  denyBtn: {
    background: 'rgba(248,113,113,0.1)',
    border: '1px solid rgba(248,113,113,0.25)',
    borderRadius: 5,
    color: '#f87171',
    cursor: 'pointer',
    fontSize: 11,
    fontWeight: 600,
    padding: '4px 10px',
  },

  // ── Stats row
  statsRow: {
    display: 'grid',
    gridTemplateColumns: 'repeat(4, 1fr)',
    gap: 8,
  },
  statCard: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: 8,
    padding: '10px 12px',
    textAlign: 'center',
  },
  statValue: {
    fontSize: 18,
    fontWeight: 700,
    lineHeight: 1.2,
  },
  statLabel: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 10,
    marginTop: 3,
  },

  // ── Budget bar
  budgetBar: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: 8,
    padding: '10px 14px',
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  budgetRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'baseline',
  },
  budgetLabel: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
  },
  budgetValue: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 11,
  },
  progressTrack: {
    background: 'rgba(255,255,255,0.06)',
    borderRadius: 3,
    height: 3,
    marginTop: 2,
    overflow: 'hidden',
  },
  progressFill: {
    background: '#60a5fa',
    borderRadius: 3,
    height: '100%',
    transition: 'width 0.3s ease',
  },

  // ── Section
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginTop: 4,
  },
  sectionLabel: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: 10,
    fontWeight: 700,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
  },
  sectionCount: {
    background: 'rgba(255,255,255,0.07)',
    borderRadius: 10,
    color: 'rgba(255,255,255,0.4)',
    fontSize: 10,
    fontWeight: 600,
    padding: '1px 7px',
  },
  emptyState: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: 12,
    padding: '8px 0',
  },

  // ── Reco cards
  recoSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  recoCalm: {
    background: 'rgba(255,255,255,0.025)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: 6,
    color: 'rgba(255,255,255,0.3)',
    fontSize: 11,
    padding: '10px 14px',
    textAlign: 'center' as const,
  },
  recoCards: {
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
  },
  recoCard: {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(167,139,250,0.2)',
    borderRadius: 7,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    padding: '10px 12px',
  },
  recoCardHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    flexWrap: 'wrap' as const,
  },
  recoExpName: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 11,
    fontWeight: 700,
  },
  recoBadges: {
    display: 'flex',
    gap: 4,
    flexWrap: 'wrap' as const,
  },
  recoBadge: {
    border: '1px solid',
    borderRadius: 4,
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: '0.05em',
    padding: '1px 5px',
  },
  recoText: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 11,
    lineHeight: 1.4,
  },
  recoBlockers: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: 4,
  },
  blockerChip: {
    background: 'rgba(248,113,113,0.1)',
    border: '1px solid rgba(248,113,113,0.25)',
    borderRadius: 4,
    color: '#f87171',
    fontSize: 9,
    padding: '1px 6px',
  },
  recoBtn: {
    alignSelf: 'flex-start',
    background: 'none',
    border: '1px solid rgba(167,139,250,0.3)',
    borderRadius: 5,
    color: '#a78bfa',
    cursor: 'pointer',
    fontSize: 10,
    fontWeight: 700,
    padding: '4px 12px',
    whiteSpace: 'nowrap' as const,
    marginTop: 2,
  },

  // ── Activity feed (Phase 4D)
  feedSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
  },
  feedHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 2,
  },
  feedToggle: {
    background: 'none',
    border: 'none',
    color: 'rgba(255,255,255,0.3)',
    cursor: 'pointer',
    fontSize: 10,
    padding: 0,
  },
  feedRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
    padding: '4px 0',
    borderBottom: '1px solid rgba(255,255,255,0.04)',
  },
  feedDot: {
    width: 6,
    height: 6,
    borderRadius: '50%',
    flexShrink: 0,
    marginTop: 3,
  },
  feedContent: {
    display: 'flex',
    flexDirection: 'column',
    gap: 1,
    flex: 1,
    minWidth: 0,
  },
  feedLabel: {
    fontSize: 11,
    fontWeight: 600,
  },
  feedDetail: {
    fontSize: 10,
    color: 'rgba(255,255,255,0.3)',
    overflow: 'hidden',
    textOverflow: 'ellipsis',
    whiteSpace: 'nowrap' as const,
  },
  feedTime: {
    color: 'rgba(255,255,255,0.2)',
    fontSize: 9,
    flexShrink: 0,
    marginTop: 2,
  },

  // ── Lane readiness (Phase 4E)
  readinessSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
  },
  readinessGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
    gap: 8,
  },
  readinessCard: {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: 7,
    display: 'flex',
    flexDirection: 'column',
    gap: 6,
    padding: '10px 12px',
  },
  readinessTop: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 6,
  },
  readinessLane: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 11,
    fontWeight: 600,
  },
  readinessBadge: {
    border: '1px solid',
    borderRadius: 4,
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: '0.05em',
    padding: '1px 5px',
  },
  readinessRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: 3,
  },
  readinessRowLabel: {
    color: 'rgba(255,255,255,0.25)',
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: '0.06em',
    textTransform: 'uppercase' as const,
  },
  readinessChips: {
    display: 'flex',
    flexWrap: 'wrap' as const,
    gap: 3,
  },
  readinessSkillChip: {
    borderRadius: 4,
    fontSize: 9,
    padding: '2px 6px',
    border: '1px solid',
    cursor: 'default',
  },
  readinessChipInstalled: {
    background: 'rgba(74,222,128,0.08)',
    borderColor: 'rgba(74,222,128,0.25)',
    color: '#4ade80',
  },
  readinessChipMissing: {
    background: 'rgba(255,255,255,0.04)',
    borderColor: 'rgba(255,255,255,0.12)',
    color: 'rgba(255,255,255,0.45)',
    cursor: 'pointer',
  },
  readinessChipConnect: {
    background: 'rgba(245,158,11,0.07)',
    borderColor: 'rgba(245,158,11,0.25)',
    color: '#f59e0b',
    cursor: 'pointer',
  },

  // ── Experiment detail modal (Phase 4D)
  detailSection: {
    border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: 7,
    display: 'flex',
    flexDirection: 'column',
    margin: '8px 0 0',
    padding: '10px 12px',
  },
  detailSectionLabel: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: '0.06em',
    textTransform: 'uppercase' as const,
  },
  detailGrid: {
    display: 'grid',
    gridTemplateColumns: '1fr 1fr 1fr',
    gap: 8,
    marginTop: 6,
  },
  detailCell: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  detailCellLabel: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: '0.05em',
    textTransform: 'uppercase' as const,
  },
  detailCellValue: {
    color: 'rgba(255,255,255,0.7)',
    fontSize: 12,
    fontWeight: 600,
  },
  detailApprovalRow: {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    marginTop: 6,
    padding: '4px 0',
    borderBottom: '1px solid rgba(255,255,255,0.05)',
  },
  detailEventRow: {
    display: 'flex',
    alignItems: 'flex-start',
    gap: 8,
    padding: '2px 0',
    borderBottom: '1px solid rgba(255,255,255,0.04)',
  },

  // ── Experiment card
  expCard: {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: 8,
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    padding: '12px 14px',
  },
  expHeader: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  expTitleRow: {
    alignItems: 'center',
    display: 'flex',
    gap: 8,
  },
  expName: {
    color: 'rgba(255,255,255,0.85)',
    flex: 1,
    fontSize: 13,
    fontWeight: 600,
  },
  statusChip: {
    borderRadius: 10,
    color: 'rgba(0,0,0,0.75)',
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: '0.04em',
    padding: '2px 8px',
    textTransform: 'uppercase',
  },
  expMeta: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: 10,
  },
  guardBanner: {
    background: 'rgba(248,113,113,0.08)',
    border: '1px solid rgba(248,113,113,0.3)',
    borderRadius: 5,
    color: '#f87171',
    fontSize: 10,
    padding: '5px 10px',
  },
  metricsRow: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 6,
  },
  metricPill: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.06)',
    borderRadius: 5,
    display: 'flex',
    flexDirection: 'column',
    gap: 1,
    padding: '4px 8px',
    minWidth: 58,
  },
  metricLabel: {
    color: 'rgba(255,255,255,0.3)',
    fontSize: 9,
    fontWeight: 600,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
  },
  metricValue: {
    color: 'rgba(255,255,255,0.75)',
    fontSize: 11,
    fontWeight: 600,
  },
  expActions: {
    display: 'flex',
    gap: 6,
    marginTop: 2,
  },
  actionBtn: {
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 5,
    color: 'rgba(255,255,255,0.55)',
    cursor: 'pointer',
    fontSize: 10,
    fontWeight: 600,
    padding: '4px 12px',
  },

  // ── Skills panel
  skillsSection: {
    display: 'flex',
    flexDirection: 'column',
    gap: 8,
    marginTop: 4,
  },
  skillsSectionHeader: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  browseCatalogLink: {
    background: 'transparent',
    border: 'none',
    color: '#a78bfa',
    fontSize: 11,
    cursor: 'pointer',
    padding: 0,
    textDecoration: 'none',
  },
  skillGrid: {
    display: 'grid',
    gap: 8,
    gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
  },
  skillCard: {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: 7,
    display: 'flex',
    flexDirection: 'column',
    gap: 4,
    padding: '10px 12px',
  },
  skillName: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 11,
    fontWeight: 600,
  },
  skillDesc: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 10,
    lineHeight: 1.4,
  },
  skillLanes: {
    display: 'flex',
    flexWrap: 'wrap',
    gap: 4,
    marginTop: 2,
  },
  laneChip: {
    background: 'rgba(167,139,250,0.1)',
    border: '1px solid rgba(167,139,250,0.2)',
    borderRadius: 8,
    color: '#a78bfa',
    fontSize: 9,
    fontWeight: 600,
    padding: '1px 6px',
  },

  // ── Modal
  modalOverlay: {
    alignItems: 'center',
    background: 'rgba(0,0,0,0.7)',
    bottom: 0,
    display: 'flex',
    justifyContent: 'center',
    left: 0,
    position: 'fixed',
    right: 0,
    top: 0,
    zIndex: 1000,
  },
  modalBox: {
    background: '#1a1a2e',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 10,
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
    maxWidth: 460,
    padding: '20px 24px',
    width: '90vw',
  },
  modalHeader: {
    alignItems: 'center',
    display: 'flex',
    justifyContent: 'space-between',
  },
  modalTitle: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 13,
    fontWeight: 700,
  },
  modalClose: {
    background: 'none',
    border: 'none',
    color: 'rgba(255,255,255,0.35)',
    cursor: 'pointer',
    fontSize: 12,
    padding: '2px 6px',
  },
  modalField: {
    display: 'flex',
    flexDirection: 'column',
    gap: 5,
  },
  modalLabel: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: '0.04em',
    textTransform: 'uppercase',
  },
  modalInput: {
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 6,
    color: 'rgba(255,255,255,0.8)',
    fontSize: 12,
    outline: 'none',
    padding: '7px 10px',
  },
  modalSelect: {
    background: '#1a1a2e',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 6,
    color: 'rgba(255,255,255,0.8)',
    fontSize: 12,
    outline: 'none',
    padding: '7px 10px',
  },
  killRow: {
    display: 'flex',
    gap: 12,
  },
  killField: {
    display: 'flex',
    flex: 1,
    flexDirection: 'column',
    gap: 5,
  },
  modalError: {
    color: '#f87171',
    fontSize: 11,
    margin: 0,
  },
  modalActions: {
    display: 'flex',
    gap: 8,
    justifyContent: 'flex-end',
    marginTop: 4,
  },
  modalCancel: {
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 6,
    color: 'rgba(255,255,255,0.45)',
    cursor: 'pointer',
    fontSize: 11,
    fontWeight: 600,
    padding: '7px 16px',
  },
  modalSubmit: {
    background: 'rgba(167,139,250,0.15)',
    border: '1px solid rgba(167,139,250,0.35)',
    borderRadius: 6,
    color: '#a78bfa',
    cursor: 'pointer',
    fontSize: 11,
    fontWeight: 700,
    padding: '7px 16px',
  },

  // ── FirstRunGuide (Phase 6)
  firstRunRoot: {
    background: 'rgba(167,139,250,0.04)',
    border: '1px solid rgba(167,139,250,0.15)',
    borderRadius: 10,
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 16,
    padding: '24px 28px',
  },
  firstRunHeader: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: 15,
    fontWeight: 700,
  },
  firstRunSubtitle: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: 11,
    marginTop: -10,
  },
  firstRunDots: {
    display: 'flex',
    gap: 6,
    alignItems: 'center',
  },
  firstRunDot: {
    borderRadius: '50%',
    height: 7,
    width: 7,
    transition: 'background 0.2s ease',
  },
  firstRunStep: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: 12,
  },
  firstRunStepLabel: {
    color: 'rgba(255,255,255,0.55)',
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.04em',
    textTransform: 'uppercase' as const,
  },
  firstRunLaneGrid: {
    display: 'grid',
    gap: 6,
    gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
  },
  firstRunLaneBtn: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 6,
    color: 'rgba(255,255,255,0.7)',
    cursor: 'pointer',
    fontSize: 11,
    fontWeight: 600,
    padding: '9px 12px',
    textAlign: 'left' as const,
  },
  firstRunSkillName: {
    color: 'rgba(255,255,255,0.8)',
    fontSize: 12,
    fontWeight: 600,
  },
  firstRunHint: {
    color: 'rgba(255,255,255,0.35)',
    fontSize: 11,
    lineHeight: 1.5,
  },
  firstRunError: {
    background: 'rgba(248,113,113,0.08)',
    border: '1px solid rgba(248,113,113,0.2)',
    borderRadius: 5,
    color: '#f87171',
    fontSize: 11,
    padding: '6px 10px',
  },
  firstRunSuccess: {
    background: 'rgba(74,222,128,0.08)',
    border: '1px solid rgba(74,222,128,0.2)',
    borderRadius: 5,
    color: '#4ade80',
    fontSize: 11,
    padding: '6px 10px',
  },
  firstRunBtns: {
    display: 'flex',
    gap: 8,
    alignItems: 'center',
  },
  firstRunPrimaryBtn: {
    background: 'rgba(167,139,250,0.15)',
    border: '1px solid rgba(167,139,250,0.35)',
    borderRadius: 6,
    color: '#a78bfa',
    cursor: 'pointer',
    fontSize: 11,
    fontWeight: 700,
    padding: '8px 18px',
  },
  firstRunSkipBtn: {
    background: 'none',
    border: 'none',
    color: 'rgba(255,255,255,0.3)',
    cursor: 'pointer',
    fontSize: 10,
    padding: '4px 8px',
  },

};
