// ── TrustComponents.tsx ──────────────────────────────────────────────────────
//
// Phase 7: Trust Layer UI sub-components.
// Imported by LiveTradeAdvisor. All advisory / simulation only.
//

import React, { useState } from 'react';

// ── Local type mirrors ──────────────────────────────────────────────────────

type SetupGrade = 'A' | 'B' | 'C' | 'D';
type ConfidenceLabel = 'high' | 'medium' | 'low';
type CouncilAgreementLabel = 'strong' | 'mixed' | 'weak';

interface CouncilSummary {
  approved: boolean;
  avgConfidence: number;
  agreementLabel: CouncilAgreementLabel;
  providerReasons: Array<{ provider: string; vote: string; confidence: number; reason: string }>;
}

interface RuleSummary {
  strengths: string[];
  warnings: string[];
  violations: string[];
}

interface TradeDecisionExplanation {
  setupGrade: SetupGrade;
  confidenceLabel: ConfidenceLabel;
  whyNow: string[];
  keyRisks: string[];
  invalidationTriggers: string[];
  councilSummary: CouncilSummary;
  ruleSummary: RuleSummary;
  trustNote: string;
}

interface BlockedTradeExplanation {
  timestamp: number;
  symbol?: string;
  blockStage: string;
  blockReason: string;
  blockMessage: string;
  setupGrade?: SetupGrade;
  trustNote: string;
}

interface GradeBucketSummary {
  grade: SetupGrade;
  trades: number;
  winRate: number;
  avgPnlR: number;
  totalPnlDollars: number;
}

interface CouncilValueAdded {
  rulesQualifiedCount: number;
  councilApprovedCount: number;
  councilBlockedCount: number;
  approvedExpectancyR: number;
  blockedExpectancyR: null;
  councilBlockRate: number;
  advisory: string;
}

interface ShadowTrade {
  id: string;
  symbol: string;
  side: 'long' | 'short';
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
  qty: number;
  status: 'open' | 'closed';
  openedAt: number;
  closedAt?: number;
  exitPrice?: number;
  exitReason?: string;
  pnl?: number;
  pnlR?: number;
  unrealizedPnl?: number;
  reason: string;
  verdict: string;
  setupType?: string;
  invalidationRule?: string;
  qualityScore?: number;
  explanation?: TradeDecisionExplanation;
  setupGrade?: SetupGrade;
}

interface ShadowPerformanceSummary {
  totalTrades: number; wins: number; losses: number; winRate: number;
  avgPnlR: number; avgWinR: number; avgLossR: number;
  profitFactor: number; expectancyR: number; totalPnlDollars: number;
  maxConsecutiveWins: number; maxConsecutiveLosses: number;
  avgTimeInTradeMs: number; avgMfeR: number; avgMaeR: number;
  edgeCaptureRatio: number;
}

interface BucketPerformanceSummary {
  bucket: string; trades: number; winRate: number; avgPnlR: number; totalPnlDollars: number;
}

interface ShadowAnalyticsSummary {
  overall: ShadowPerformanceSummary;
  bySession: BucketPerformanceSummary[];
  bySetupType: BucketPerformanceSummary[];
  bySymbol: BucketPerformanceSummary[];
  decisionFunnel: Record<string, number>;
  topBlockReasons: Array<{ reason: string; count: number; pct: number }>;
  eventCount: number;
}

type StrategyReadinessState = 'not_ready' | 'developing' | 'paper_ready' | 'guarded_live_candidate';
interface StrategyReadinessReport {
  state: StrategyReadinessState; advisory: string; blockers: string[];
}

type TradingOperationMode = 'shadow' | 'paper' | 'guarded_live_candidate';
interface ModeGuardrails {
  dailyLossCapR: number; maxTradesPerDay: number; maxPositionSize: number;
  manualConfirmation: boolean; autoDemotionEnabled: boolean; lossStreakDemotion: number;
}
interface PromotionWorkflowStatus {
  currentMode: TradingOperationMode; promotedAt?: number; demotedAt?: number;
  demotionReason?: string; dailyLossR: number; tradesTodayPromoted: number;
  consecutiveLosses: number; activeGuardrails: ModeGuardrails;
}

// ── Styles (shared, matching LiveTradeAdvisor pattern) ──────────────────────

const ts: Record<string, React.CSSProperties> = {
  card:          { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 },
  cardTitle:     { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'rgba(255,255,255,0.35)', display: 'flex', alignItems: 'center', gap: 8 },
  simBadge:      { fontSize: 8, fontWeight: 800, letterSpacing: '0.08em', background: 'rgba(167,139,250,0.15)', color: '#a78bfa', border: '1px solid rgba(167,139,250,0.25)', borderRadius: 3, padding: '1px 5px' },
  row:           { display: 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'baseline' },
  metricsRow:    { display: 'flex', gap: 20, flexWrap: 'wrap' },
  metricItem:    { display: 'flex', flexDirection: 'column', gap: 2 },
  metricLabel:   { fontSize: 10, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.06em' },
  metricValue:   { fontSize: 14, fontWeight: 700, color: 'rgba(255,255,255,0.7)', fontVariantNumeric: 'tabular-nums' },
  trustNote:     { fontSize: 11, color: 'rgba(255,255,255,0.4)', fontStyle: 'italic', lineHeight: 1.5 },
  footer:        { fontSize: 10, color: 'rgba(255,255,255,0.2)', textAlign: 'center' },
  bullet:        { fontSize: 11, color: 'rgba(255,255,255,0.55)', lineHeight: 1.6, margin: '0 0 2px', paddingLeft: 14, position: 'relative' },
  seatRow:       { display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 11, padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' },
  seatProvider:  { fontWeight: 700, color: 'rgba(255,255,255,0.7)', minWidth: 70 },
  seatVote:      { fontWeight: 700, fontSize: 10, letterSpacing: '0.04em', padding: '1px 6px', borderRadius: 3, flexShrink: 0 },
  seatConfidence:{ fontSize: 10, color: 'rgba(255,255,255,0.4)', fontVariantNumeric: 'tabular-nums', flexShrink: 0, minWidth: 30 },
  seatReason:    { fontSize: 10, color: 'rgba(255,255,255,0.4)', flex: 1 },
  sectionLabel:  { fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginTop: 4 },
  collapsible:   { cursor: 'pointer', userSelect: 'none' },
  input:         { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, color: 'rgba(255,255,255,0.85)', fontSize: 12, padding: '7px 10px', outline: 'none', width: '100%', boxSizing: 'border-box', fontFamily: 'inherit' },
  noteBox:       { fontSize: 11, color: 'rgba(255,255,255,0.4)', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 6, padding: '8px 10px', lineHeight: 1.5 },
};

// ── Grade colors ────────────────────────────────────────────────────────────

const GRADE_COLORS: Record<SetupGrade, { color: string; bg: string; border: string }> = {
  A: { color: '#34d399', bg: 'rgba(52,211,153,0.12)',  border: 'rgba(52,211,153,0.3)' },
  B: { color: '#60a5fa', bg: 'rgba(96,165,250,0.12)',  border: 'rgba(96,165,250,0.3)' },
  C: { color: '#fbbf24', bg: 'rgba(251,191,36,0.12)',  border: 'rgba(251,191,36,0.3)' },
  D: { color: '#f87171', bg: 'rgba(248,113,113,0.12)', border: 'rgba(248,113,113,0.3)' },
};

// ── SetupGradeBadge ─────────────────────────────────────────────────────────

export function SetupGradeBadge({ grade }: { grade?: SetupGrade }) {
  if (!grade) return null;
  const g = GRADE_COLORS[grade];
  return (
    <span style={{
      fontSize: 9, fontWeight: 800, letterSpacing: '0.08em',
      color: g.color, background: g.bg, border: `1px solid ${g.border}`,
      borderRadius: 3, padding: '1px 6px',
    }}>
      GRADE {grade}
    </span>
  );
}

// ── Vote badge helper ───────────────────────────────────────────────────────

function VoteBadge({ vote }: { vote: string }) {
  const colors: Record<string, { color: string; bg: string }> = {
    TAKE:   { color: '#34d399', bg: 'rgba(52,211,153,0.15)' },
    WAIT:   { color: '#fbbf24', bg: 'rgba(251,191,36,0.15)' },
    REJECT: { color: '#f87171', bg: 'rgba(248,113,113,0.15)' },
  };
  const c = colors[vote] ?? { color: 'rgba(255,255,255,0.4)', bg: 'rgba(255,255,255,0.05)' };
  return (
    <span style={{ ...ts.seatVote, color: c.color, background: c.bg }}>
      {vote}
    </span>
  );
}

// ── CouncilLiveTradeCard ────────────────────────────────────────────────────

export function CouncilLiveTradeCard({ trade, currentPrice }: { trade: ShadowTrade; currentPrice?: number }) {
  const [expanded, setExpanded] = useState(false);
  const expl = trade.explanation;

  // Compute live P/L
  const price = currentPrice ?? trade.entryPrice;
  const pointValue = 1; // simplified — controller tracks unrealizedPnl
  const livePnl = trade.unrealizedPnl ?? ((trade.side === 'long' ? price - trade.entryPrice : trade.entryPrice - price) * trade.qty * pointValue);
  const risk = Math.abs(trade.entryPrice - trade.stopPrice) * trade.qty * pointValue;
  const liveR = risk > 0 ? livePnl / risk : 0;
  const timeInTrade = Date.now() - trade.openedAt;
  const mins = Math.floor(timeInTrade / 60_000);

  // Fallback: if no explanation, render compact position card
  if (!expl) {
    return (
      <div style={ts.card}>
        <div style={ts.cardTitle}>
          <span>Council Shadow Trade</span>
          <span style={ts.simBadge}>SIM</span>
          <SetupGradeBadge grade={trade.setupGrade} />
        </div>
        <div style={ts.row}>
          <span style={{ fontWeight: 700, color: 'rgba(255,255,255,0.85)' }}>{trade.symbol}</span>
          <span style={{ fontWeight: 700, color: trade.side === 'long' ? '#34d399' : '#f87171' }}>
            {trade.side.toUpperCase()}
          </span>
          <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11 }}>
            {trade.qty} @ {trade.entryPrice.toFixed(2)}
          </span>
          <span style={{ marginLeft: 'auto', fontWeight: 700, color: livePnl >= 0 ? '#34d399' : '#f87171', fontVariantNumeric: 'tabular-nums' }}>
            {livePnl >= 0 ? '+' : ''}{livePnl.toFixed(2)} ({liveR >= 0 ? '+' : ''}{liveR.toFixed(2)}R)
          </span>
        </div>
        <div style={{ ...ts.row, fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>
          <span>Stop: {trade.stopPrice.toFixed(2)}</span>
          <span>Target: {trade.targetPrice.toFixed(2)}</span>
          <span>{mins}m in trade</span>
        </div>
        <div style={ts.footer}>Simulated trade — no real orders placed.</div>
      </div>
    );
  }

  // Full explanation card
  return (
    <div style={ts.card}>
      {/* Header */}
      <div style={ts.cardTitle}>
        <span>Council Live Shadow Trade</span>
        <span style={ts.simBadge}>SIM</span>
        <SetupGradeBadge grade={expl.setupGrade} />
      </div>

      {/* Position row */}
      <div style={ts.row}>
        <span style={{ fontWeight: 700, color: 'rgba(255,255,255,0.85)' }}>{trade.symbol}</span>
        <span style={{ fontWeight: 700, color: trade.side === 'long' ? '#34d399' : '#f87171' }}>
          {trade.side.toUpperCase()}
        </span>
        <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11 }}>
          {trade.qty} @ {trade.entryPrice.toFixed(2)}
        </span>
        {currentPrice !== undefined && (
          <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11 }}>
            now {currentPrice.toFixed(2)}
          </span>
        )}
        <span style={{ marginLeft: 'auto', fontWeight: 700, color: livePnl >= 0 ? '#34d399' : '#f87171', fontVariantNumeric: 'tabular-nums' }}>
          {livePnl >= 0 ? '+' : ''}{livePnl.toFixed(2)} ({liveR >= 0 ? '+' : ''}{liveR.toFixed(2)}R)
        </span>
      </div>

      {/* Context row */}
      <div style={{ ...ts.row, fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>
        <span>Confidence: {expl.confidenceLabel}</span>
        <span>Agreement: {expl.councilSummary.agreementLabel}</span>
        <span>{mins}m in trade</span>
      </div>

      {/* Expandable detail */}
      <div
        style={{ ...ts.sectionLabel, ...ts.collapsible }}
        onClick={() => setExpanded(v => !v)}
      >
        {expanded ? 'Collapse details' : 'Expand details'}
      </div>

      {expanded && (
        <>
          {/* Why Now */}
          <div style={ts.sectionLabel}>Why Now</div>
          {expl.whyNow.map((w, i) => (
            <div key={i} style={ts.bullet}>{w}</div>
          ))}

          {/* Key Risks */}
          {expl.keyRisks.length > 0 && (
            <>
              <div style={ts.sectionLabel}>Key Risks</div>
              {expl.keyRisks.map((r, i) => (
                <div key={i} style={{ ...ts.bullet, color: '#fbbf24' }}>{r}</div>
              ))}
            </>
          )}

          {/* Invalidation */}
          <div style={ts.sectionLabel}>Invalidation</div>
          {expl.invalidationTriggers.map((t, i) => (
            <div key={i} style={{ ...ts.bullet, color: '#f87171' }}>{t}</div>
          ))}

          {/* Council Seats */}
          <div style={ts.sectionLabel}>Council Seats</div>
          {expl.councilSummary.providerReasons.map((pr, i) => (
            <div key={i} style={ts.seatRow}>
              <span style={ts.seatProvider}>{pr.provider}</span>
              <VoteBadge vote={pr.vote} />
              <span style={ts.seatConfidence}>{pr.confidence}%</span>
              <span style={ts.seatReason}>{pr.reason}</span>
            </div>
          ))}
        </>
      )}

      {/* Trust note */}
      <div style={ts.trustNote}>{expl.trustNote}</div>

      {/* Footer */}
      <div style={ts.footer}>Simulated trade — no real orders placed.</div>
    </div>
  );
}

// ── BlockedTradeCards ────────────────────────────────────────────────────────

export function BlockedTradeCards({ explanations }: { explanations: BlockedTradeExplanation[] }) {
  if (explanations.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {explanations.map((e, i) => {
        const time = new Date(e.timestamp);
        const hh = String(time.getHours()).padStart(2, '0');
        const mm = String(time.getMinutes()).padStart(2, '0');
        const stageLabel = e.blockStage.replace(/_/g, ' ');
        const reasonLabel = e.blockReason.replace(/_/g, ' ');

        return (
          <div key={i} style={{ ...ts.card, padding: '10px 14px', gap: 6 }}>
            <div style={{ ...ts.row, fontSize: 11, gap: 8 }}>
              <span style={{ color: 'rgba(255,255,255,0.3)', fontVariantNumeric: 'tabular-nums' }}>{hh}:{mm}</span>
              {e.symbol && <span style={{ fontWeight: 700, color: 'rgba(255,255,255,0.7)' }}>{e.symbol}</span>}
              <span style={{
                fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
                color: '#f87171', background: 'rgba(248,113,113,0.1)', border: '1px solid rgba(248,113,113,0.2)',
                borderRadius: 3, padding: '1px 5px',
              }}>
                {stageLabel}
              </span>
              <SetupGradeBadge grade={e.setupGrade} />
            </div>
            <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)' }}>
              {reasonLabel}{e.blockMessage ? ` — ${e.blockMessage}` : ''}
            </div>
            <div style={ts.trustNote}>{e.trustNote}</div>
          </div>
        );
      })}
    </div>
  );
}

// ── UserComparisonPanel ─────────────────────────────────────────────────────
// Component-local state only. Not persisted, not stored, not sent to analytics.

export function UserComparisonPanel({ matchedTrade }: { matchedTrade?: ShadowTrade }) {
  const [showComparison, setShowComparison] = useState(false);
  const [userEntry, setUserEntry] = useState('');
  const [userStop, setUserStop] = useState('');
  const [userTarget, setUserTarget] = useState('');
  const [userSize, setUserSize] = useState('');
  const [userOutcome, setUserOutcome] = useState('');

  if (!matchedTrade) return null;

  const uEntry = parseFloat(userEntry);
  const uStop = parseFloat(userStop);
  const uTarget = parseFloat(userTarget);
  const uSize = parseFloat(userSize);
  const uOutcome = parseFloat(userOutcome);

  const hasUserData = !isNaN(uEntry);
  const entryDiff = hasUserData ? uEntry - matchedTrade.entryPrice : null;
  const stopDiff = !isNaN(uStop) ? uStop - matchedTrade.stopPrice : null;
  const targetDiff = !isNaN(uTarget) ? uTarget - matchedTrade.targetPrice : null;

  // R comparison if both have outcomes
  const cRisk = Math.abs(matchedTrade.entryPrice - matchedTrade.stopPrice);
  const userRisk = (!isNaN(uEntry) && !isNaN(uStop)) ? Math.abs(uEntry - uStop) : null;
  const userR = (userRisk && userRisk > 0 && !isNaN(uOutcome)) ? (uOutcome / (userRisk * (uSize || 1))) : null;

  return (
    <div style={ts.card}>
      <div style={{ ...ts.cardTitle, justifyContent: 'space-between' }}>
        <span>Your Trade Comparison</span>
        <button
          style={{
            background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)',
            color: 'rgba(255,255,255,0.4)', fontSize: 10, padding: '3px 8px',
            borderRadius: 4, cursor: 'pointer', fontFamily: 'inherit',
          }}
          onClick={() => setShowComparison(v => !v)}
        >
          {showComparison ? 'Hide' : 'Compare'}
        </button>
      </div>

      {showComparison && (
        <>
          <div style={ts.noteBox}>
            User-entered comparison data. Not broker-verified. Manual input only.
            This data stays in this component and does not feed into core analytics.
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 8 }}>
            <div>
              <div style={ts.metricLabel}>Your Entry</div>
              <input style={ts.input} value={userEntry} onChange={e => setUserEntry(e.target.value)} placeholder="Entry" />
            </div>
            <div>
              <div style={ts.metricLabel}>Your Stop</div>
              <input style={ts.input} value={userStop} onChange={e => setUserStop(e.target.value)} placeholder="Stop" />
            </div>
            <div>
              <div style={ts.metricLabel}>Your Target</div>
              <input style={ts.input} value={userTarget} onChange={e => setUserTarget(e.target.value)} placeholder="Target" />
            </div>
            <div>
              <div style={ts.metricLabel}>Your P/L ($)</div>
              <input style={ts.input} value={userOutcome} onChange={e => setUserOutcome(e.target.value)} placeholder="P/L" />
            </div>
          </div>

          {hasUserData && (
            <div style={ts.metricsRow}>
              {entryDiff !== null && (
                <div style={ts.metricItem}>
                  <div style={ts.metricLabel}>Entry diff</div>
                  <div style={{ ...ts.metricValue, fontSize: 12, color: entryDiff === 0 ? 'rgba(255,255,255,0.5)' : entryDiff > 0 ? '#fbbf24' : '#34d399' }}>
                    {entryDiff >= 0 ? '+' : ''}{entryDiff.toFixed(2)}
                  </div>
                </div>
              )}
              {stopDiff !== null && (
                <div style={ts.metricItem}>
                  <div style={ts.metricLabel}>Stop diff</div>
                  <div style={{ ...ts.metricValue, fontSize: 12 }}>{stopDiff >= 0 ? '+' : ''}{stopDiff.toFixed(2)}</div>
                </div>
              )}
              {targetDiff !== null && (
                <div style={ts.metricItem}>
                  <div style={ts.metricLabel}>Target diff</div>
                  <div style={{ ...ts.metricValue, fontSize: 12 }}>{targetDiff >= 0 ? '+' : ''}{targetDiff.toFixed(2)}</div>
                </div>
              )}
              {matchedTrade.pnlR !== undefined && (
                <div style={ts.metricItem}>
                  <div style={ts.metricLabel}>Council R</div>
                  <div style={{ ...ts.metricValue, fontSize: 12, color: matchedTrade.pnlR >= 0 ? '#34d399' : '#f87171' }}>
                    {matchedTrade.pnlR >= 0 ? '+' : ''}{matchedTrade.pnlR.toFixed(2)}R
                  </div>
                </div>
              )}
              {userR !== null && (
                <div style={ts.metricItem}>
                  <div style={ts.metricLabel}>Your R</div>
                  <div style={{ ...ts.metricValue, fontSize: 12, color: userR >= 0 ? '#34d399' : '#f87171' }}>
                    {userR >= 0 ? '+' : ''}{userR.toFixed(2)}R
                  </div>
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── TrustDashboardPanel ─────────────────────────────────────────────────────

export function TrustDashboardPanel({
  analytics,
  readiness,
  promotion,
  councilValueAdded: cva,
  gradeSummary,
}: {
  analytics: ShadowAnalyticsSummary;
  readiness?: StrategyReadinessReport;
  promotion?: PromotionWorkflowStatus;
  councilValueAdded?: CouncilValueAdded;
  gradeSummary?: GradeBucketSummary[];
}) {
  const o = analytics.overall;

  // Best/weakest session
  const sessions = analytics.bySession.filter(b => b.trades >= 3);
  const bestSession = sessions.length > 0 ? sessions.reduce((a, b) => b.avgPnlR > a.avgPnlR ? b : a) : null;
  const weakestSession = sessions.length > 0 ? sessions.reduce((a, b) => b.avgPnlR < a.avgPnlR ? b : a) : null;

  // Mode label
  const modeLabels: Record<TradingOperationMode, string> = {
    shadow: 'SHADOW', paper: 'PAPER', guarded_live_candidate: 'GUARDED LIVE',
  };
  const readinessLabels: Record<StrategyReadinessState, { label: string; color: string }> = {
    not_ready:    { label: 'NOT READY', color: '#f87171' },
    developing:   { label: 'DEVELOPING', color: '#fbbf24' },
    paper_ready:  { label: 'PAPER READY', color: '#60a5fa' },
    guarded_live_candidate: { label: 'GUARDED LIVE CANDIDATE', color: '#34d399' },
  };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={ts.sectionLabel}>Trust Dashboard</div>

      {/* Mode + Readiness badges */}
      <div style={{ ...ts.row, gap: 8 }}>
        {promotion && (
          <span style={{
            fontSize: 9, fontWeight: 800, letterSpacing: '0.08em',
            color: '#a78bfa', background: 'rgba(167,139,250,0.1)',
            border: '1px solid rgba(167,139,250,0.25)', borderRadius: 3, padding: '2px 6px',
          }}>
            {modeLabels[promotion.currentMode] || promotion.currentMode}
          </span>
        )}
        {readiness && (
          <span style={{
            fontSize: 9, fontWeight: 800, letterSpacing: '0.08em',
            color: readinessLabels[readiness.state]?.color ?? '#fff',
            background: 'rgba(255,255,255,0.05)',
            border: `1px solid ${readinessLabels[readiness.state]?.color ?? '#fff'}40`,
            borderRadius: 3, padding: '2px 6px',
          }}>
            {readinessLabels[readiness.state]?.label ?? readiness.state}
          </span>
        )}
      </div>

      {/* Key metrics */}
      {o.totalTrades > 0 ? (
        <div style={ts.metricsRow}>
          <Metric label="Win Rate" value={`${(o.winRate * 100).toFixed(0)}%`} color={o.winRate >= 0.5 ? '#34d399' : '#f87171'} />
          <Metric label="Expectancy" value={`${o.expectancyR >= 0 ? '+' : ''}${o.expectancyR.toFixed(2)}R`} color={o.expectancyR >= 0 ? '#34d399' : '#f87171'} />
          <Metric label="Profit Factor" value={o.profitFactor === Infinity ? 'Inf' : o.profitFactor.toFixed(2)} color={o.profitFactor >= 1 ? '#34d399' : '#f87171'} />
          <Metric label="Total P/L" value={`$${o.totalPnlDollars.toFixed(0)}`} color={o.totalPnlDollars >= 0 ? '#34d399' : '#f87171'} />
          <Metric label="Edge Capture" value={`${(o.edgeCaptureRatio * 100).toFixed(0)}%`} color="rgba(255,255,255,0.5)" />
        </div>
      ) : (
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', fontStyle: 'italic' }}>
          Insufficient data — no closed trades yet.
        </div>
      )}

      {/* Best/Weakest session */}
      {(bestSession || weakestSession) && (
        <div style={{ ...ts.row, fontSize: 11, color: 'rgba(255,255,255,0.4)', gap: 16 }}>
          {bestSession && <span>Best session: <b style={{ color: '#34d399' }}>{bestSession.bucket}</b> ({bestSession.avgPnlR >= 0 ? '+' : ''}{bestSession.avgPnlR.toFixed(2)}R, {bestSession.trades} trades)</span>}
          {weakestSession && bestSession !== weakestSession && <span>Weakest: <b style={{ color: '#f87171' }}>{weakestSession.bucket}</b> ({weakestSession.avgPnlR >= 0 ? '+' : ''}{weakestSession.avgPnlR.toFixed(2)}R)</span>}
        </div>
      )}

      {/* Council discipline */}
      {analytics.decisionFunnel && (
        <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>
          Setups detected: {analytics.decisionFunnel['setup_detection'] ?? 0} | Reached council: {analytics.decisionFunnel['council_review'] ?? 0} | Trades opened: {analytics.decisionFunnel['trade_opened'] ?? 0}
        </div>
      )}

      {/* Council value-added */}
      {cva && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <div style={ts.sectionLabel}>Council Value Added</div>
          <div style={{ ...ts.row, fontSize: 11, color: 'rgba(255,255,255,0.4)', gap: 16 }}>
            <span>Qualified: {cva.rulesQualifiedCount}</span>
            <span>Approved: {cva.councilApprovedCount}</span>
            <span>Blocked: {cva.councilBlockedCount}</span>
            <span>Block rate: {(cva.councilBlockRate * 100).toFixed(0)}%</span>
            {cva.approvedExpectancyR !== 0 && (
              <span>Approved expectancy: {cva.approvedExpectancyR >= 0 ? '+' : ''}{cva.approvedExpectancyR.toFixed(2)}R</span>
            )}
          </div>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', fontStyle: 'italic' }}>
            Outcome of blocked trades is unknowable — these trades were not taken.
          </div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>{cva.advisory}</div>
        </div>
      )}

      {/* Grade distribution */}
      {gradeSummary && gradeSummary.length > 0 && (
        <div style={{ ...ts.row, gap: 8, alignItems: 'center' }}>
          <span style={ts.sectionLabel}>Grades:</span>
          {gradeSummary.map(g => (
            <span key={g.grade} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <SetupGradeBadge grade={g.grade} />
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)' }}>{g.trades}</span>
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={ts.metricItem}>
      <div style={ts.metricLabel}>{label}</div>
      <div style={{ ...ts.metricValue, color }}>{value}</div>
    </div>
  );
}

// ── GradeAnalyticsPanel ─────────────────────────────────────────────────────

export function GradeAnalyticsPanel({ gradeSummary }: { gradeSummary: GradeBucketSummary[] }) {
  if (gradeSummary.length === 0) return null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={ts.sectionLabel}>Performance by Setup Grade</div>
      {/* Header */}
      <div style={{
        display: 'grid', gridTemplateColumns: '50px 50px 60px 60px 80px', gap: 8,
        fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase',
        letterSpacing: '0.05em', padding: '0 0 4px', borderBottom: '1px solid rgba(255,255,255,0.06)',
      }}>
        <span>Grade</span><span>Trades</span><span>Win %</span><span>Avg R</span><span>P/L</span>
      </div>
      {/* Rows */}
      {gradeSummary.map(g => (
        <div key={g.grade} style={{
          display: 'grid', gridTemplateColumns: '50px 50px 60px 60px 80px', gap: 8,
          fontSize: 11, color: 'rgba(255,255,255,0.6)', padding: '4px 0',
          borderBottom: '1px solid rgba(255,255,255,0.04)', fontVariantNumeric: 'tabular-nums',
        }}>
          <span><SetupGradeBadge grade={g.grade} /></span>
          <span>{g.trades}</span>
          <span>{(g.winRate * 100).toFixed(0)}%</span>
          <span style={{ color: g.avgPnlR >= 0 ? '#34d399' : '#f87171' }}>
            {g.avgPnlR >= 0 ? '+' : ''}{g.avgPnlR.toFixed(2)}
          </span>
          <span style={{ color: g.totalPnlDollars >= 0 ? '#34d399' : '#f87171' }}>
            ${g.totalPnlDollars.toFixed(0)}
          </span>
        </div>
      ))}
    </div>
  );
}
