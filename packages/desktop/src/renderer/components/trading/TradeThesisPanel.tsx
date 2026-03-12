// ── TradeThesisPanel.tsx ─────────────────────────────────────────────────────
//
// Top-level advisory panel: bias, action state, setup, and context.
// Derives all state from existing polled data — no IPC calls.

import React, { useRef, useEffect, useState } from 'react';

// ── Types ────────────────────────────────────────────────────────────────────

type ActionState = 'ACT' | 'WAIT' | 'BLOCKED' | 'EXPIRED' | 'STAND_DOWN';
type BiasDirection = 'LONG' | 'SHORT' | 'NEUTRAL';

interface ThesisSetup {
  name: string;
  entry: number | null;
  stop: number | null;
  target: number | null;
  rr: number | null;
  confidence: string | null;
  grade: string | null;
  councilAgreement: string | null;
}

interface ThesisState {
  bias: BiasDirection;
  actionState: ActionState;
  setup: ThesisSetup | null;
  blockerText: string | null;
  nextUnlock: string | null;
  contextSentence: string;
}

interface TradeThesisProps {
  pathPrediction: any;
  snapshot: { lastPrice?: number; trend?: string; feedFreshnessMs?: number } | null;
  levelMap: any;
  proposedSetup: any;
  reviewedIntents: any[];
  watches: any[];
  shadow: { enabled: boolean; paused: boolean; openTrades: any[]; blockedReason?: string } | null;
  simulatorState: any;
  sessionContext: any;
}

// ── Compute thesis from existing data ────────────────────────────────────────

function computeThesis(p: TradeThesisProps): ThesisState {
  const now = Date.now();
  const price = p.snapshot?.lastPrice;

  // ── Bias ──
  let bias: BiasDirection = 'NEUTRAL';
  const pathDir = p.pathPrediction?.direction;
  const trend = p.snapshot?.trend;
  if (pathDir === 'long' || pathDir === 'up') bias = 'LONG';
  else if (pathDir === 'short' || pathDir === 'down') bias = 'SHORT';
  else if (trend === 'up') bias = 'LONG';
  else if (trend === 'down') bias = 'SHORT';

  // ── Find best actionable intent ──
  const approvedIntent = p.reviewedIntents.find(
    (ri: any) => ri.outcome === 'approved' && ri.intent,
  );
  const intentAge = approvedIntent?.reviewedAt ? now - approvedIntent.reviewedAt : Infinity;
  const intent = approvedIntent?.intent;

  // ── ACT validation: entry near price, stop not breached, not stale ──
  let isActionable = false;
  if (intent && price && intentAge < 300_000) {
    const entryDist = Math.abs(intent.entry - price) / price;
    const stopBreached = intent.side === 'long'
      ? price <= intent.stop
      : price >= intent.stop;
    isActionable = entryDist < 0.003 && !stopBreached;
  }

  // ── Setup from intent or proposedSetup ──
  let setup: ThesisSetup | null = null;
  if (intent) {
    setup = {
      name: (intent.setupType ?? intent.setupGrade ?? 'SETUP').toString().replace(/_/g, ' ').toUpperCase(),
      entry: intent.entry ?? null,
      stop: intent.stop ?? null,
      target: intent.target ?? null,
      rr: intent.riskRewardRatio ?? (intent.score?.rrScore ? null : null),
      confidence: intent.confidence ?? null,
      grade: intent.setupGrade ?? intent.score?.band ?? null,
      councilAgreement: approvedIntent?.outcome?.toUpperCase() ?? null,
    };
    if (setup.entry && setup.stop && setup.target) {
      const risk = Math.abs(setup.entry - setup.stop);
      if (risk > 0) setup.rr = Math.round(Math.abs(setup.target - setup.entry) / risk * 10) / 10;
    }
  } else if (p.proposedSetup) {
    const ps = p.proposedSetup;
    setup = {
      name: (ps.setupType ?? 'SETUP').toString().replace(/_/g, ' ').toUpperCase(),
      entry: ps.entry ?? null,
      stop: ps.stop ?? null,
      target: ps.target ?? null,
      rr: null,
      confidence: ps.confidence ?? null,
      grade: null,
      councilAgreement: null,
    };
    if (setup.entry && setup.stop && setup.target) {
      const risk = Math.abs(setup.entry - setup.stop);
      if (risk > 0) setup.rr = Math.round(Math.abs(setup.target - setup.entry) / risk * 10) / 10;
    }
  }

  // ── Reliability check ──
  const reliability = p.simulatorState?.signalReliability;

  // ── Action state ──
  const blockedReason = p.shadow?.blockedReason || p.simulatorState?.blockedReason;
  const hasOpenTrade = (p.shadow?.openTrades?.length ?? 0) > 0;
  const hasLevels = (p.levelMap?.levels?.length ?? 0) > 0;
  const hasWatches = p.watches.length > 0;
  const hasPath = !!p.pathPrediction?.primaryRoute || !!p.pathPrediction?.direction;
  const sessionClosed = p.sessionContext && !p.sessionContext.isActive;

  let actionState: ActionState;
  let blockerText: string | null = null;
  let nextUnlock: string | null = null;
  let contextSentence: string;

  if (hasOpenTrade) {
    const t = p.shadow!.openTrades[0];
    const uPnl = t.unrealizedPnl !== undefined ? `${t.unrealizedPnl >= 0 ? '+' : ''}$${t.unrealizedPnl.toFixed(0)}` : '';
    actionState = 'ACT';
    contextSentence = `${t.side.toUpperCase()} ${t.symbol} open at ${t.entryPrice.toFixed(2)} ${uPnl}`;
  } else if (reliability?.expired && !hasOpenTrade) {
    actionState = 'EXPIRED';
    contextSentence = `Signal expired: ${reliability.explanation}`;
  } else if (isActionable) {
    actionState = 'ACT';
    contextSentence = `Actionable ${intent.side} setup at ${intent.entry?.toFixed(2)} — council approved`;
  } else if (blockedReason) {
    actionState = 'BLOCKED';
    blockerText = blockedReason;
    nextUnlock = computeNextUnlock(blockedReason, p);
    contextSentence = blockerText;
  } else if (sessionClosed) {
    actionState = 'STAND_DOWN';
    contextSentence = 'Session closed — no trading window active';
    nextUnlock = 'Wait for next session open';
  } else if (!hasLevels && !hasWatches && !hasPath) {
    actionState = 'STAND_DOWN';
    contextSentence = 'Engine scanning for structural levels';
    if (p.simulatorState?.active) nextUnlock = 'Level map building in progress';
  } else if (p.watches.some((w: any) => w.state === 'confirming')) {
    actionState = 'WAIT';
    const best = p.watches.find((w: any) => w.state === 'confirming');
    const score = best?.confirmationScore ?? 0;
    const levelPrice = best?.level?.price ?? best?.levelPrice;
    contextSentence = `Confirmation in progress${levelPrice ? ` at ${levelPrice.toFixed?.(2) ?? levelPrice}` : ''} (${score}%)`;
    nextUnlock = `Need ${80 - score}% more confirmation`;
  } else if (hasWatches) {
    actionState = 'WAIT';
    const watching = p.watches.filter((w: any) => w.state === 'watching').length;
    contextSentence = `Monitoring ${watching} level approach${watching !== 1 ? 'es' : ''}`;
  } else if (hasPath) {
    actionState = 'WAIT';
    const route = p.pathPrediction.primaryRoute ?? p.pathPrediction;
    const dir = route.direction === 'long' || route.direction === 'up' ? 'UP' : 'DOWN';
    const targetPrice = route.toLevel?.price ?? route.nextTargetLevel?.price;
    contextSentence = `Path predicts ${dir}${targetPrice ? ` to ${targetPrice.toFixed(2)}` : ''} — waiting for level approach`;
  } else {
    actionState = 'WAIT';
    contextSentence = `${hasLevels ? p.levelMap.levels.filter((l: any) => !l.broken).length + ' levels mapped' : 'Scanning'} — no clear path yet`;
  }

  return { bias, actionState, setup, blockerText, nextUnlock, contextSentence };
}

function computeNextUnlock(reason: string, p: TradeThesisProps): string {
  const r = reason.toLowerCase();
  if (r.includes('session')) return 'Wait for prime trading window';
  if (r.includes('news')) return 'News embargo to expire';
  if (r.includes('daily_loss') || r.includes('max_loss')) return 'Daily loss limit — resume tomorrow';
  if (r.includes('max_trades')) return 'Trade limit reached — resume tomorrow';
  if (r.includes('manual_confirmation')) return 'Confirm or reject pending trade';
  if (r.includes('cool')) return 'Cooldown period active';
  if (r.includes('paused')) return 'Resume shadow trading';
  return 'Condition change needed';
}

// ── Colors ───────────────────────────────────────────────────────────────────

const CLR = {
  green: '#34d399',
  red: '#f87171',
  blue: '#60a5fa',
  amber: '#fbbf24',
  muted: 'rgba(255,255,255,0.3)',
  dimBg: 'rgba(255,255,255,0.03)',
  border: 'rgba(255,255,255,0.07)',
};

const ACTION_STYLE: Record<ActionState, { color: string; bg: string }> = {
  ACT:        { color: CLR.green,    bg: 'rgba(52,211,153,0.1)' },
  WAIT:       { color: CLR.amber,    bg: 'rgba(251,191,36,0.08)' },
  BLOCKED:    { color: CLR.red,      bg: 'rgba(248,113,113,0.08)' },
  EXPIRED:    { color: '#a78bfa',    bg: 'rgba(167,139,250,0.08)' },
  STAND_DOWN: { color: CLR.muted,    bg: 'rgba(255,255,255,0.03)' },
};

const BIAS_STYLE: Record<BiasDirection, { color: string }> = {
  LONG:    { color: CLR.green },
  SHORT:   { color: CLR.red },
  NEUTRAL: { color: CLR.muted },
};

// ── Styles ───────────────────────────────────────────────────────────────────

const st = {
  panel: {
    display: 'flex', flexDirection: 'column', gap: 8, padding: '12px 14px',
    height: '100%', justifyContent: 'flex-start',
  } as React.CSSProperties,
  title: {
    fontSize: 9, fontWeight: 800, textTransform: 'uppercase',
    letterSpacing: '0.08em', color: 'rgba(255,255,255,0.25)',
  } as React.CSSProperties,
  biasRow: {
    display: 'flex', alignItems: 'center', gap: 8,
  } as React.CSSProperties,
  biasBadge: {
    fontSize: 12, fontWeight: 800, letterSpacing: '0.06em',
  } as React.CSSProperties,
  actionChip: {
    fontSize: 9, fontWeight: 700, letterSpacing: '0.04em',
    borderRadius: 3, padding: '2px 6px',
  } as React.CSSProperties,
  setupRow: {
    display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'baseline',
  } as React.CSSProperties,
  setupName: {
    fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.6)',
  } as React.CSSProperties,
  metric: {
    display: 'flex', flexDirection: 'column', gap: 1,
  } as React.CSSProperties,
  metricLabel: {
    fontSize: 8, fontWeight: 700, textTransform: 'uppercase',
    letterSpacing: '0.06em', color: 'rgba(255,255,255,0.2)',
  } as React.CSSProperties,
  metricValue: {
    fontSize: 12, fontWeight: 700, color: 'rgba(255,255,255,0.75)',
    fontVariantNumeric: 'tabular-nums',
  } as React.CSSProperties,
  metaRow: {
    display: 'flex', gap: 10, flexWrap: 'wrap',
  } as React.CSSProperties,
  metaChip: {
    fontSize: 8, fontWeight: 700, borderRadius: 3, padding: '1px 5px',
    letterSpacing: '0.04em',
  } as React.CSSProperties,
  context: {
    fontSize: 10, color: 'rgba(255,255,255,0.35)', lineHeight: 1.5,
    fontStyle: 'italic',
  } as React.CSSProperties,
  unlock: {
    fontSize: 9, color: 'rgba(96,165,250,0.5)', marginTop: 2,
  } as React.CSSProperties,
  divider: {
    height: 1, background: 'rgba(255,255,255,0.04)',
  } as React.CSSProperties,
  noSetup: {
    fontSize: 10, color: 'rgba(255,255,255,0.15)', fontStyle: 'italic',
  } as React.CSSProperties,
};

// ── Component ────────────────────────────────────────────────────────────────

export function TradeThesisPanel(props: TradeThesisProps) {
  const sim = props.simulatorState;
  if (!sim?.active && !props.shadow?.enabled) return null;

  const thesis = computeThesis(props);
  const reliability = props.simulatorState?.signalReliability ?? null;
  const aSt = ACTION_STYLE[thesis.actionState];
  const bSt = BIAS_STYLE[thesis.bias];

  // ACT flash
  const [flash, setFlash] = useState(false);
  const prevAction = useRef<ActionState | null>(null);
  useEffect(() => {
    if (prevAction.current !== null && prevAction.current !== 'ACT' && thesis.actionState === 'ACT') {
      setFlash(true);
      const t = setTimeout(() => setFlash(false), 1200);
      return () => clearTimeout(t);
    }
    prevAction.current = thesis.actionState;
  }, [thesis.actionState]);

  return (
    <div style={{
      ...st.panel,
      borderColor: flash ? 'rgba(52,211,153,0.4)' : undefined,
      transition: 'border-color 0.3s',
    }}>
      <div style={st.title}>Trade Thesis</div>

      {/* Bias + Action */}
      <div style={st.biasRow}>
        <span style={{ ...st.biasBadge, color: bSt.color }}>{thesis.bias}</span>
        <span style={{ ...st.actionChip, color: aSt.color, background: aSt.bg }}>
          {thesis.actionState.replace('_', ' ')}
        </span>
      </div>

      <div style={st.divider} />

      {/* Setup */}
      {thesis.setup ? (
        <>
          <div style={st.setupRow}>
            <span style={st.setupName}>{thesis.setup.name}</span>
          </div>
          <div style={st.setupRow}>
            <div style={st.metric}>
              <span style={st.metricLabel}>Entry</span>
              <span style={st.metricValue}>{thesis.setup.entry?.toFixed(2) ?? '—'}</span>
            </div>
            <div style={st.metric}>
              <span style={st.metricLabel}>Stop</span>
              <span style={{ ...st.metricValue, color: CLR.red }}>{thesis.setup.stop?.toFixed(2) ?? '—'}</span>
            </div>
            <div style={st.metric}>
              <span style={st.metricLabel}>Target</span>
              <span style={{ ...st.metricValue, color: CLR.green }}>{thesis.setup.target?.toFixed(2) ?? '—'}</span>
            </div>
            <div style={st.metric}>
              <span style={st.metricLabel}>R:R</span>
              <span style={st.metricValue}>{thesis.setup.rr !== null ? `${thesis.setup.rr}R` : '—'}</span>
            </div>
          </div>

          {/* Meta chips */}
          <div style={st.metaRow}>
            {reliability?.band && (
              <span style={{
                ...st.metaChip,
                color: reliability.band === 'elite' ? CLR.green : reliability.band === 'qualified' ? CLR.blue : reliability.band === 'watchlist' ? CLR.amber : CLR.red,
                background: reliability.band === 'elite' ? 'rgba(52,211,153,0.08)' : reliability.band === 'qualified' ? 'rgba(96,165,250,0.08)' : reliability.band === 'watchlist' ? 'rgba(251,191,36,0.08)' : 'rgba(248,113,113,0.08)',
              }}>
                {reliability.band.toUpperCase()}
              </span>
            )}
            {thesis.setup.confidence && (
              <span style={{
                ...st.metaChip,
                color: thesis.setup.confidence === 'high' ? CLR.green : thesis.setup.confidence === 'medium' ? CLR.amber : CLR.muted,
                background: thesis.setup.confidence === 'high' ? 'rgba(52,211,153,0.08)' : thesis.setup.confidence === 'medium' ? 'rgba(251,191,36,0.08)' : 'rgba(255,255,255,0.03)',
              }}>
                {thesis.setup.confidence.toUpperCase()}
              </span>
            )}
            {thesis.setup.grade && (
              <span style={{
                ...st.metaChip,
                color: thesis.setup.grade === 'A' || thesis.setup.grade === 'elite' ? CLR.green : thesis.setup.grade === 'B' ? CLR.blue : CLR.muted,
                background: 'rgba(255,255,255,0.04)',
              }}>
                {thesis.setup.grade.toUpperCase()}
              </span>
            )}
            {thesis.setup.councilAgreement && (
              <span style={{
                ...st.metaChip,
                color: thesis.setup.councilAgreement === 'APPROVED' ? CLR.green : thesis.setup.councilAgreement === 'REJECTED' ? CLR.red : CLR.muted,
                background: thesis.setup.councilAgreement === 'APPROVED' ? 'rgba(52,211,153,0.08)' : thesis.setup.councilAgreement === 'REJECTED' ? 'rgba(248,113,113,0.08)' : 'rgba(255,255,255,0.03)',
              }}>
                {thesis.setup.councilAgreement}
              </span>
            )}
          </div>
        </>
      ) : (
        <div style={st.noSetup}>No active setup</div>
      )}

      <div style={st.divider} />

      {/* Context sentence */}
      <div style={st.context}>{thesis.contextSentence}</div>
      {thesis.nextUnlock && (
        <div style={st.unlock}>Unlocks when: {thesis.nextUnlock}</div>
      )}
    </div>
  );
}
