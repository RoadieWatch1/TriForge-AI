// ── PipelineStatusPanel.tsx ──────────────────────────────────────────────────
//
// 3-tier engine intelligence panel:
//   Tier 1 — Signal summary (always visible, single line)
//   Tier 2 — Key metrics row (always visible)
//   Tier 3 — Diagnostics (collapsed by default)

import React, { useState } from 'react';

// ── Types ───────────────────────────────────────────────────────────────────

interface PipelineStatusPanelProps {
  simulatorState: any;
  levelMap: any;
  pathPrediction: any;
  watches: any[];
  sessionContext: any;
  reviewedIntents: any[];
  blockedEvaluations: any[];
  snapshot: { lastPrice?: number; trend?: string; feedFreshnessMs?: number } | null;
  shadow: { enabled: boolean; paused: boolean; openTrades: any[]; closedTrades: any[]; tradesToday: number; blockedReason?: string; lastEvalAt?: number } | null;
  reliability?: any;
}

// ── Colors ──────────────────────────────────────────────────────────────────

const c = {
  up: '#34d399', down: '#f87171', blue: '#60a5fa', yellow: '#fbbf24',
  purple: '#a78bfa', orange: '#fb923c', muted: 'rgba(255,255,255,0.3)',
  dimBg: 'rgba(255,255,255,0.03)', border: 'rgba(255,255,255,0.07)',
};

// ── Styles ──────────────────────────────────────────────────────────────────

const st = {
  panel: {
    display: 'flex', flexDirection: 'column' as const, gap: 8,
    background: c.dimBg, border: `1px solid ${c.border}`, borderRadius: 6,
    padding: '10px 14px',
  },
  signalRow: {
    display: 'flex', alignItems: 'center' as const, gap: 8,
    padding: '2px 0', borderBottom: '1px solid rgba(255,255,255,0.04)',
  },
  signalText: {
    fontSize: 11, fontWeight: 700 as const, lineHeight: 1.4,
  },
  signalHint: {
    fontSize: 9, color: 'rgba(255,255,255,0.2)', marginLeft: 'auto' as const,
    flexShrink: 0 as const,
  },
  metricsRow: {
    display: 'flex', gap: 12, flexWrap: 'wrap' as const, alignItems: 'center' as const,
    padding: '2px 0',
  },
  chip: {
    fontSize: 8, fontWeight: 700 as const, letterSpacing: '0.04em',
    borderRadius: 3, padding: '2px 6px', flexShrink: 0 as const,
  },
  nextTrigger: {
    fontSize: 9, color: 'rgba(96,165,250,0.5)', fontStyle: 'italic' as const,
    marginLeft: 'auto' as const,
  },
  diagToggle: {
    background: 'none', border: 'none', color: 'rgba(255,255,255,0.2)',
    fontSize: 9, fontWeight: 700 as const, cursor: 'pointer', padding: '2px 6px',
    letterSpacing: '0.04em',
  },
  divider: {
    height: 1, background: 'rgba(255,255,255,0.04)',
  },
  // Diagnostics section styles
  sectionTitle: {
    fontSize: 9, fontWeight: 800 as const, textTransform: 'uppercase' as const,
    letterSpacing: '0.08em', color: 'rgba(255,255,255,0.25)', marginBottom: 2,
  },
  row: {
    display: 'flex', gap: 12, flexWrap: 'wrap' as const, alignItems: 'center' as const,
  },
  metric: {
    display: 'flex', flexDirection: 'column' as const, gap: 1, minWidth: 60,
  },
  metricLabel: {
    fontSize: 8, fontWeight: 700 as const, textTransform: 'uppercase' as const,
    letterSpacing: '0.06em', color: 'rgba(255,255,255,0.22)',
  },
  metricValue: {
    fontSize: 13, fontWeight: 700 as const, fontVariantNumeric: 'tabular-nums' as const,
    color: 'rgba(255,255,255,0.75)',
  },
  pipeRow: {
    display: 'flex', gap: 2, alignItems: 'center' as const, flexWrap: 'wrap' as const,
  },
  pipeStage: {
    fontSize: 8, fontWeight: 700 as const, letterSpacing: '0.04em',
    padding: '2px 6px', borderRadius: 3,
  },
  pipeArrow: {
    fontSize: 8, color: 'rgba(255,255,255,0.12)', margin: '0 1px',
  },
  blockCard: {
    background: 'rgba(248,113,113,0.05)', border: '1px solid rgba(248,113,113,0.12)',
    borderRadius: 6, padding: '8px 12px', fontSize: 10, color: 'rgba(255,255,255,0.5)',
    lineHeight: 1.5,
  },
  watchBar: {
    height: 4, borderRadius: 2, background: 'rgba(255,255,255,0.06)', flex: 1,
    position: 'relative' as const, overflow: 'hidden' as const,
  },
  watchFill: {
    position: 'absolute' as const, top: 0, left: 0, height: '100%', borderRadius: 2,
    transition: 'width 0.3s',
  },
  expandBtn: {
    background: 'none', border: 'none', color: 'rgba(255,255,255,0.25)',
    fontSize: 9, fontWeight: 700 as const, cursor: 'pointer', padding: '2px 6px',
    letterSpacing: '0.04em',
  },
};

// ── Pipeline stages ─────────────────────────────────────────────────────────

const PIPELINE_STAGES = [
  { key: 'market',    label: 'MARKET' },
  { key: 'session',   label: 'SESSION' },
  { key: 'levels',    label: 'LEVELS' },
  { key: 'path',      label: 'PATH' },
  { key: 'watches',   label: 'WATCHES' },
  { key: 'decision',  label: 'DECISION' },
  { key: 'trust',     label: 'TRUST' },
  { key: 'council',   label: 'COUNCIL' },
  { key: 'execution', label: 'EXECUTE' },
];

function getPipelineProgress(sim: any, levelMap: any, pathPrediction: any, watches: any[], reviewed: any[], shadow: any) {
  const stages: Record<string, 'pass' | 'active' | 'blocked' | 'idle'> = {};
  stages.market = sim?.active ? 'pass' : 'idle';
  stages.session = sim?.active ? 'pass' : 'idle';
  stages.levels = levelMap?.levels?.length > 0 ? 'pass' : sim?.active ? 'blocked' : 'idle';
  if (pathPrediction?.primaryRoute) stages.path = 'pass';
  else if (sim?.active && levelMap?.levels?.length > 0) stages.path = 'blocked';
  else stages.path = 'idle';
  const confirmed = watches.filter((w: any) => w.state === 'confirmed');
  const watching = watches.filter((w: any) => w.state === 'watching' || w.state === 'confirming');
  if (confirmed.length > 0) stages.watches = 'pass';
  else if (watching.length > 0) stages.watches = 'active';
  else if (stages.path === 'pass') stages.watches = 'blocked';
  else stages.watches = 'idle';
  const hasRecentIntent = reviewed.length > 0 && (Date.now() - (reviewed[0]?.reviewedAt ?? 0)) < 120_000;
  if (hasRecentIntent) stages.decision = 'pass';
  else if (stages.watches === 'pass') stages.decision = 'active';
  else stages.decision = 'idle';
  // Trust stage: based on reliability band from simulator state
  const relBand = sim?.signalReliability?.band;
  if (relBand === 'elite' || relBand === 'qualified') stages.trust = 'pass';
  else if (relBand === 'blocked' || relBand === 'watchlist') stages.trust = 'blocked';
  else if (stages.decision === 'pass') stages.trust = 'active';
  else stages.trust = 'idle';
  if (reviewed[0]?.outcome === 'approved') stages.council = 'pass';
  else if (reviewed[0]?.outcome === 'rejected') stages.council = 'blocked';
  else if (stages.decision === 'pass') stages.council = 'active';
  else stages.council = 'idle';
  if (shadow?.openTrades?.length > 0) stages.execution = 'pass';
  else if (stages.council === 'pass') stages.execution = 'active';
  else stages.execution = 'idle';
  return stages;
}

function stageColor(state: 'pass' | 'active' | 'blocked' | 'idle') {
  if (state === 'pass') return { bg: 'rgba(52,211,153,0.12)', color: c.up };
  if (state === 'active') return { bg: 'rgba(96,165,250,0.12)', color: c.blue };
  if (state === 'blocked') return { bg: 'rgba(248,113,113,0.08)', color: c.down };
  return { bg: 'rgba(255,255,255,0.03)', color: 'rgba(255,255,255,0.15)' };
}

// ── Signal summary ──────────────────────────────────────────────────────────

function computeSignalSummary(
  stages: Record<string, string>,
  watches: any[],
  reviewed: any[],
  blockedReason: string | null,
  pathPrediction: any,
  shadow: any,
): { text: string; color: string; hint: string } {
  // 1. Trade open
  if (shadow?.openTrades?.length > 0) {
    const t = shadow.openTrades[0];
    const uPnl = t.unrealizedPnl !== undefined ? ` (${t.unrealizedPnl >= 0 ? '+' : ''}$${t.unrealizedPnl.toFixed(0)})` : '';
    return { text: `${t.side.toUpperCase()} ${t.symbol} open at ${t.entryPrice.toFixed(2)}${uPnl}`, color: c.up, hint: 'POSITION OPEN' };
  }
  // 2. Approved intent
  if (reviewed[0]?.outcome === 'approved' && reviewed[0]?.intent) {
    const ri = reviewed[0].intent;
    return { text: `Council APPROVED ${ri.side} ${ri.symbol ?? ''}`, color: c.up, hint: 'APPROVED' };
  }
  // 3. Confirmed watch
  const conf = watches.find((w: any) => w.state === 'confirmed');
  if (conf) {
    const price = conf.levelPrice ?? conf.level?.price;
    return { text: `Watch CONFIRMED at ${price?.toFixed(2) ?? '—'}`, color: c.up, hint: 'CONFIRMED' };
  }
  // 4. Blocked
  if (blockedReason) {
    return { text: blockedReason, color: c.down, hint: 'BLOCKED' };
  }
  // 5. Active watches
  const active = watches.filter((w: any) => w.state === 'watching' || w.state === 'confirming');
  if (active.length > 0) {
    const best = active.reduce((b: any, w: any) => (w.confirmationScore ?? 0) > (b?.confirmationScore ?? 0) ? w : b, null);
    const pct = best?.confirmationScore ?? 0;
    return { text: `Monitoring ${active.length} level approach${active.length > 1 ? 'es' : ''} (best: ${pct}%)`, color: c.blue, hint: 'WATCHING' };
  }
  // 6. Path available
  if (pathPrediction?.primaryRoute) {
    const r = pathPrediction.primaryRoute;
    const dir = r.direction === 'up' ? 'UP' : 'DOWN';
    const tgt = r.toLevel?.price?.toFixed(2) ?? '—';
    return { text: `Path predicts ${dir} to ${tgt}`, color: c.blue, hint: 'PATH' };
  }
  // 7. Idle
  return { text: 'Engine scanning for opportunities', color: c.muted, hint: 'SCANNING' };
}

// ── Next trigger ────────────────────────────────────────────────────────────

function computeNextTrigger(
  stages: Record<string, string>,
  watches: any[],
  reviewed: any[],
  blockedReason: string | null,
  sessionContext: any,
): string {
  if (blockedReason) {
    const r = blockedReason.toLowerCase();
    if (r.includes('session')) return 'Wait for prime window';
    if (r.includes('news')) return 'News embargo to expire';
    if (r.includes('daily_loss') || r.includes('max_loss')) return 'Resume tomorrow';
    if (r.includes('max_trades')) return 'Trade limit — resume tomorrow';
    if (r.includes('manual')) return 'Confirm or reject pending trade';
    if (r.includes('cool')) return 'Cooldown active';
    if (r.includes('paused')) return 'Resume trading';
    return 'Condition change needed';
  }
  if (stages.execution === 'active') return 'Execution pending';
  if (stages.council === 'active') return 'Council review in progress';
  if (stages.decision === 'active') return 'Intent generation pending';
  const confirming = watches.find((w: any) => w.state === 'confirming');
  if (confirming) {
    const pct = confirming.confirmationScore ?? 0;
    return `Confirmation at ${pct}% (need 80%)`;
  }
  if (stages.watches === 'active') return 'Watching for level test';
  if (stages.watches === 'blocked') return 'Approaching level would create watch';
  if (stages.path === 'blocked') return 'Need clear path between levels';
  if (stages.levels === 'blocked') return 'Level map building';
  if (sessionContext && !sessionContext.isActive) return 'Wait for session open';
  return '';
}

// ── Regime config ───────────────────────────────────────────────────────────

const regimeStyles: Record<string, { color: string }> = {
  open_drive: { color: c.orange }, trend: { color: c.up },
  range: { color: c.blue }, reversal: { color: c.down },
  expansion: { color: c.purple }, drift: { color: c.muted },
};

// ── Component ───────────────────────────────────────────────────────────────

export function PipelineStatusPanel({
  simulatorState: sim,
  levelMap,
  pathPrediction,
  watches,
  sessionContext,
  reviewedIntents,
  blockedEvaluations,
  snapshot,
  shadow,
  reliability,
}: PipelineStatusPanelProps) {
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  if (!sim?.active) return null;

  const stages = getPipelineProgress(sim, levelMap, pathPrediction, watches, reviewedIntents, shadow);
  const blockedReason = shadow?.blockedReason || sim?.blockedReason;
  const signal = computeSignalSummary(stages, watches, reviewedIntents, blockedReason, pathPrediction, shadow);
  const nextTrigger = computeNextTrigger(stages, watches, reviewedIntents, blockedReason, sessionContext);

  const regime = sim?.regimeContext?.current;
  const rCfg = regime ? regimeStyles[regime.regime] ?? regimeStyles.drift : null;
  const sessionWindow = sessionContext?.windowLabel ?? sim?.sessionContext?.windowLabel;
  const sessionScore = sessionContext?.sessionScore ?? sim?.sessionContext?.sessionScore;
  const bestWatch = watches.reduce((best: any, w: any) =>
    (w.confirmationScore ?? 0) > (best?.confirmationScore ?? 0) ? w : best, null);

  return (
    <div style={st.panel}>
      {/* ── Tier 1: Signal Summary ── */}
      <div style={st.signalRow}>
        <span style={{ ...st.signalText, color: signal.color }}>{signal.text}</span>
        <span style={st.signalHint}>{signal.hint}</span>
      </div>

      {/* ── Tier 2: Key Metrics Row ── */}
      <div style={st.metricsRow}>
        {/* Session */}
        {sessionWindow && (
          <span style={{
            ...st.chip,
            background: sessionScore != null && sessionScore >= 60 ? 'rgba(52,211,153,0.08)' : 'rgba(255,255,255,0.04)',
            color: sessionScore != null && sessionScore >= 60 ? c.up : c.muted,
          }}>
            {sessionWindow.replace(/_/g, ' ')}{sessionScore != null ? ` ${sessionScore}` : ''}
          </span>
        )}

        {/* Regime */}
        {regime && rCfg && (
          <span style={{ ...st.chip, background: rCfg.color + '12', color: rCfg.color }}>
            {regime.regime.replace(/_/g, ' ').toUpperCase()} {Math.round(regime.confidence)}%
          </span>
        )}

        {/* Best confidence */}
        {bestWatch && bestWatch.confirmationScore != null && (
          <span style={{
            ...st.chip,
            background: (bestWatch.confirmationScore >= 80 ? c.up : bestWatch.confirmationScore >= 50 ? c.yellow : c.blue) + '12',
            color: bestWatch.confirmationScore >= 80 ? c.up : bestWatch.confirmationScore >= 50 ? c.yellow : c.blue,
          }}>
            Conf {bestWatch.confirmationScore}%
          </span>
        )}

        {/* Council alignment */}
        {reviewedIntents[0] && (
          <span style={{
            ...st.chip,
            background: reviewedIntents[0].outcome === 'approved' ? 'rgba(52,211,153,0.08)' :
                         reviewedIntents[0].outcome === 'rejected' ? 'rgba(248,113,113,0.08)' : 'rgba(255,255,255,0.04)',
            color: reviewedIntents[0].outcome === 'approved' ? c.up :
                   reviewedIntents[0].outcome === 'rejected' ? c.down : c.muted,
          }}>
            {reviewedIntents[0].outcome?.toUpperCase() ?? '—'}
          </span>
        )}

        {/* Next trigger */}
        {nextTrigger && <span style={st.nextTrigger}>{nextTrigger}</span>}
      </div>

      {/* ── Diagnostics toggle ── */}
      <div style={{ display: 'flex', alignItems: 'center' }}>
        <button style={st.diagToggle} onClick={() => setShowDiagnostics(v => !v)}>
          {showDiagnostics ? 'Hide Diagnostics' : 'Diagnostics'}
        </button>
      </div>

      {/* ── Tier 3: Diagnostics (collapsed) ── */}
      {showDiagnostics && <>
        <div style={st.divider} />

        {/* Pipeline stage diagram */}
        <div>
          <div style={st.sectionTitle}>Pipeline Stages</div>
          <div style={st.pipeRow}>
            {PIPELINE_STAGES.map((stage, i) => {
              const state = stages[stage.key];
              const sc = stageColor(state);
              return (
                <React.Fragment key={stage.key}>
                  {i > 0 && <span style={st.pipeArrow}>{'\u25B8'}</span>}
                  <span style={{ ...st.pipeStage, background: sc.bg, color: sc.color }}>
                    {stage.label}
                  </span>
                </React.Fragment>
              );
            })}
            <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.15)', marginLeft: 'auto' }}>
              Cycle {sim?.tickCount ?? 0}
            </span>
          </div>
        </div>

        {/* Engine snapshot chips */}
        <div style={st.row}>
          {pathPrediction?.primaryRoute && (() => {
            const pred = pathPrediction.primaryRoute;
            return (
              <span style={{
                ...st.chip,
                background: (pred.direction === 'up' ? c.up : c.down) + '12',
                color: pred.direction === 'up' ? c.up : c.down,
              }}>
                {pred.direction === 'up' ? '\u2191' : '\u2193'}{' '}
                {pred.toLevel?.type?.replace(/_/g, ' ') ?? 'target'} @ {pred.toLevel?.price?.toFixed(2) ?? '—'}
                {pred.qualityScore != null ? ` Q${Math.round(pred.qualityScore)}` : ''}
              </span>
            );
          })()}
          {sim?.newsRiskContext?.blocked && (
            <span style={{ ...st.chip, background: 'rgba(248,113,113,0.1)', color: c.down }}>NEWS BLOCK</span>
          )}
        </div>

        {/* Level + Watch detail */}
        <div style={st.row}>
          <div style={st.metric}>
            <span style={st.metricLabel}>Levels</span>
            <span style={{ ...st.metricValue, color: (levelMap?.levels?.length ?? 0) > 0 ? 'rgba(255,255,255,0.7)' : c.muted }}>
              {(levelMap?.levels?.filter((l: any) => !l.broken)?.length ?? 0)}{(levelMap?.levels?.filter((l: any) => l.broken)?.length ?? 0) > 0 ? ` / ${levelMap.levels.filter((l: any) => l.broken).length}b` : ''}
            </span>
          </div>
          <div style={st.metric}>
            <span style={st.metricLabel}>Watches</span>
            <span style={{
              ...st.metricValue,
              color: watches.some((w: any) => w.state === 'confirmed') ? c.up :
                     watches.some((w: any) => w.state === 'watching' || w.state === 'confirming') ? c.blue : c.muted,
            }}>
              {watches.filter((w: any) => w.state === 'confirmed').length > 0
                ? `${watches.filter((w: any) => w.state === 'confirmed').length} confirmed`
                : watches.filter((w: any) => w.state === 'watching' || w.state === 'confirming').length > 0
                  ? `${watches.filter((w: any) => w.state === 'watching' || w.state === 'confirming').length} active`
                  : 'none'}
            </span>
          </div>
          {sim?.pnlSummary && sim.pnlSummary.closedPositionCount > 0 && (
            <div style={st.metric}>
              <span style={st.metricLabel}>Session P&L</span>
              <span style={{ ...st.metricValue, fontSize: 11, color: sim.pnlSummary.totalPnLDollars >= 0 ? c.up : c.down }}>
                {sim.pnlSummary.totalPnLDollars >= 0 ? '+' : ''}${sim.pnlSummary.totalPnLDollars.toFixed(0)}
                <span style={{ fontSize: 9, color: c.muted, marginLeft: 4 }}>
                  {sim.pnlSummary.winCount}W / {sim.pnlSummary.lossCount}L
                </span>
              </span>
            </div>
          )}
        </div>

        {/* Blocked reason */}
        {blockedReason && (
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', lineHeight: 1.5, fontStyle: 'italic' }}>
            {blockedReason}
          </div>
        )}

        {/* Blocked evaluations */}
        {blockedEvaluations.length > 0 && (
          <div>
            <div style={st.sectionTitle}>Blocked Decisions ({blockedEvaluations.length})</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
              {blockedEvaluations.slice(0, 5).map((be: any, i: number) => (
                <div key={i} style={st.blockCard}>
                  <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginBottom: 3 }}>
                    <span style={{ fontWeight: 700, color: c.down, fontSize: 9 }}>BLOCKED</span>
                    {be.intent?.symbol && <span style={{ fontWeight: 700, color: 'rgba(255,255,255,0.5)' }}>{be.intent.symbol}</span>}
                    {be.intent?.side && (
                      <span style={{ color: be.intent.side === 'long' ? c.up : c.down, fontWeight: 700, fontSize: 9 }}>
                        {be.intent.side.toUpperCase()}
                      </span>
                    )}
                    {be.intent?.score?.final != null && (
                      <span style={{ fontSize: 9, color: c.muted }}>Score: {Math.round(be.intent.score.final)}</span>
                    )}
                  </div>
                  {be.reasons?.length > 0 ? (
                    be.reasons.map((r: string, j: number) => (
                      <div key={j} style={{ color: 'rgba(255,255,255,0.4)', paddingLeft: 8 }}>{'\u2022'} {r}</div>
                    ))
                  ) : be.reason ? (
                    <div style={{ color: 'rgba(255,255,255,0.4)', paddingLeft: 8 }}>{'\u2022'} {be.reason}</div>
                  ) : null}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Watch alerts */}
        {watches.length > 0 && watches.some((w: any) => w.state !== 'rejected') && (
          <div>
            <div style={st.sectionTitle}>Watch Alerts</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              {watches.filter((w: any) => w.state !== 'rejected').slice(0, 4).map((w: any, i: number) => {
                const stateCol = w.state === 'confirmed' ? c.up :
                  w.state === 'confirming' ? c.blue :
                  w.state === 'watching' ? c.yellow : c.muted;
                return (
                  <div key={w.id ?? i} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 10 }}>
                    <span style={{ ...st.chip, fontSize: 8, background: stateCol + '15', color: stateCol }}>
                      {(w.state ?? 'idle').toUpperCase()}
                    </span>
                    <span style={{ color: 'rgba(255,255,255,0.5)' }}>
                      {w.levelType?.replace(/_/g, ' ') ?? 'level'} @ {w.levelPrice?.toFixed(2) ?? w.price?.toFixed(2) ?? '—'}
                    </span>
                    {w.qualityScore != null && (
                      <span style={{ fontSize: 9, color: c.muted }}>Q{Math.round(w.qualityScore)}</span>
                    )}
                    {w.confirmationScore != null && w.state !== 'confirmed' && (
                      <div style={{ ...st.watchBar, maxWidth: 60 }}>
                        <div style={{
                          ...st.watchFill,
                          width: `${Math.min(w.confirmationScore, 100)}%`,
                          background: w.confirmationScore >= 80 ? c.up : w.confirmationScore >= 50 ? c.yellow : c.blue,
                        }} />
                      </div>
                    )}
                    {w.route?.direction && (
                      <span style={{ fontSize: 9, color: w.route.direction === 'up' ? c.up : c.down }}>
                        {w.route.direction === 'up' ? '\u2191' : '\u2193'}
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </>}
    </div>
  );
}
