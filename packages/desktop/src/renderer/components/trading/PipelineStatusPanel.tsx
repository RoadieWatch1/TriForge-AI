// ── PipelineStatusPanel.tsx ──────────────────────────────────────────────────
//
// Surfaces the full trading pipeline state so the Simulator tab never feels
// empty. Shows: eval activity, session/regime, path prediction, level map
// summary, watch progress, blocked evaluations, and pipeline stage diagram.
//
// All data is already polled every 2s in LiveTradeAdvisor — this component
// just renders it visually instead of hiding it behind other tabs.

import React, { useState } from 'react';

// ── Types (mirrors — no engine imports) ─────────────────────────────────────

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
}

// ── Styles ──────────────────────────────────────────────────────────────────

const c = {
  up: '#34d399', down: '#f87171', blue: '#60a5fa', yellow: '#fbbf24',
  purple: '#a78bfa', orange: '#fb923c', muted: 'rgba(255,255,255,0.3)',
  dimBg: 'rgba(255,255,255,0.03)', border: 'rgba(255,255,255,0.07)',
};

const st = {
  panel: {
    display: 'flex', flexDirection: 'column' as const, gap: 10,
    background: c.dimBg, border: `1px solid ${c.border}`, borderRadius: 10,
    padding: '14px 16px',
  },
  sectionTitle: {
    fontSize: 9, fontWeight: 800 as const, textTransform: 'uppercase' as const,
    letterSpacing: '0.08em', color: 'rgba(255,255,255,0.25)', marginBottom: 2,
  },
  row: {
    display: 'flex', gap: 12, flexWrap: 'wrap' as const, alignItems: 'center' as const,
  },
  chip: {
    fontSize: 9, fontWeight: 700 as const, letterSpacing: '0.06em',
    borderRadius: 3, padding: '2px 7px', flexShrink: 0 as const,
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
  { key: 'market',     label: 'MARKET' },
  { key: 'session',    label: 'SESSION' },
  { key: 'levels',     label: 'LEVELS' },
  { key: 'path',       label: 'PATH' },
  { key: 'watches',    label: 'WATCHES' },
  { key: 'decision',   label: 'DECISION' },
  { key: 'council',    label: 'COUNCIL' },
  { key: 'execution',  label: 'EXECUTE' },
];

function getPipelineProgress(sim: any, levelMap: any, pathPrediction: any, watches: any[], reviewed: any[], shadow: any) {
  const stages: Record<string, 'pass' | 'active' | 'blocked' | 'idle'> = {};

  // Market: pass if simulator is active and has data
  stages.market = sim?.active ? 'pass' : 'idle';

  // Session: pass if session context exists
  stages.session = sim?.active ? 'pass' : 'idle';

  // Levels: pass if level map built
  stages.levels = levelMap?.levels?.length > 0 ? 'pass' : sim?.active ? 'blocked' : 'idle';

  // Path: pass if prediction exists, blocked if no clear path
  if (pathPrediction?.primaryRoute) stages.path = 'pass';
  else if (sim?.active && levelMap?.levels?.length > 0) stages.path = 'blocked';
  else stages.path = 'idle';

  // Watches: pass if any confirmed, active if any watching/confirming, blocked if none
  const confirmed = watches.filter((w: any) => w.state === 'confirmed');
  const watching = watches.filter((w: any) => w.state === 'watching' || w.state === 'confirming');
  if (confirmed.length > 0) stages.watches = 'pass';
  else if (watching.length > 0) stages.watches = 'active';
  else if (stages.path === 'pass') stages.watches = 'blocked';
  else stages.watches = 'idle';

  // Decision: pass if recent intent exists
  const hasRecentIntent = reviewed.length > 0 && (Date.now() - (reviewed[0]?.reviewedAt ?? 0)) < 120_000;
  if (hasRecentIntent) stages.decision = 'pass';
  else if (stages.watches === 'pass') stages.decision = 'active';
  else stages.decision = 'idle';

  // Council: pass if approved, blocked if rejected
  if (reviewed[0]?.outcome === 'approved') stages.council = 'pass';
  else if (reviewed[0]?.outcome === 'rejected') stages.council = 'blocked';
  else if (stages.decision === 'pass') stages.council = 'active';
  else stages.council = 'idle';

  // Execution: pass if trade open
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

// ── Regime config ───────────────────────────────────────────────────────────

const regimeStyles: Record<string, { color: string }> = {
  open_drive: { color: c.orange },
  trend:      { color: c.up },
  range:      { color: c.blue },
  reversal:   { color: c.down },
  expansion:  { color: c.purple },
  drift:      { color: c.muted },
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
}: PipelineStatusPanelProps) {
  const [showBlocked, setShowBlocked] = useState(false);

  if (!sim?.active) return null;

  const stages = getPipelineProgress(sim, levelMap, pathPrediction, watches, reviewedIntents, shadow);
  const regime = sim?.regimeContext?.current;
  const rCfg = regime ? regimeStyles[regime.regime] ?? regimeStyles.drift : null;
  const pred = pathPrediction?.primaryRoute;
  const levelCount = levelMap?.levels?.length ?? 0;
  const brokenCount = levelMap?.levels?.filter((l: any) => l.broken)?.length ?? 0;
  const activeLevelCount = levelCount - brokenCount;
  const watchingCount = watches.filter((w: any) => w.state === 'watching' || w.state === 'confirming').length;
  const confirmedCount = watches.filter((w: any) => w.state === 'confirmed').length;
  const blockedReason = shadow?.blockedReason || sim?.blockedReason;
  const tickCount = sim?.tickCount ?? 0;
  const lastTick = sim?.lastTickAt;

  // Session info
  const sessionWindow = sessionContext?.windowLabel ?? sim?.sessionContext?.windowLabel;
  const sessionScore = sessionContext?.sessionScore ?? sim?.sessionContext?.sessionScore;

  // Best watch confirmation score
  const bestWatch = watches.reduce((best: any, w: any) =>
    (w.confirmationScore ?? 0) > (best?.confirmationScore ?? 0) ? w : best, null);

  return (
    <div style={st.panel}>
      {/* ── Pipeline Stage Diagram ── */}
      <div>
        <div style={st.sectionTitle}>Engine Pipeline</div>
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
          {/* Eval counter */}
          <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.15)', marginLeft: 'auto' }}>
            Cycle {tickCount}{lastTick ? ` \u00b7 ${new Date(lastTick).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}` : ''}
          </span>
        </div>
      </div>

      {/* ── Engine Snapshot: session, regime, path ── */}
      <div style={st.row}>
        {/* Session window */}
        {sessionWindow && (
          <span style={{
            ...st.chip,
            background: sessionScore != null && sessionScore >= 60 ? 'rgba(52,211,153,0.1)' : 'rgba(255,255,255,0.04)',
            color: sessionScore != null && sessionScore >= 60 ? c.up : c.muted,
          }}>
            {sessionWindow.replace(/_/g, ' ')}{sessionScore != null ? ` (${sessionScore})` : ''}
          </span>
        )}

        {/* Regime */}
        {regime && rCfg && (
          <span style={{ ...st.chip, background: rCfg.color + '15', color: rCfg.color }}>
            {regime.regime.replace(/_/g, ' ').toUpperCase()} {Math.round(regime.confidence)}%
          </span>
        )}

        {/* Path prediction */}
        {pred ? (
          <span style={{
            ...st.chip,
            background: (pred.direction === 'up' ? c.up : c.down) + '12',
            color: pred.direction === 'up' ? c.up : c.down,
          }}>
            {pred.direction === 'up' ? '\u2191' : '\u2193'}{' '}
            {pred.toLevel?.type?.replace(/_/g, ' ') ?? 'target'} @ {pred.toLevel?.price?.toFixed(2) ?? '—'}
            {pred.qualityScore != null ? ` Q${Math.round(pred.qualityScore)}` : ''}
          </span>
        ) : sim?.active && (
          <span style={{ ...st.chip, background: 'rgba(255,255,255,0.03)', color: 'rgba(255,255,255,0.18)' }}>
            No clear path
          </span>
        )}

        {/* News block */}
        {sim?.newsRiskContext?.blocked && (
          <span style={{ ...st.chip, background: 'rgba(248,113,113,0.1)', color: c.down }}>
            NEWS BLOCK
          </span>
        )}
      </div>

      {/* ── Level Map + Watch Summary ── */}
      <div style={st.row}>
        {/* Level count */}
        <div style={st.metric}>
          <span style={st.metricLabel}>Levels</span>
          <span style={{ ...st.metricValue, color: activeLevelCount > 0 ? 'rgba(255,255,255,0.7)' : c.muted }}>
            {activeLevelCount}{brokenCount > 0 ? ` / ${brokenCount}b` : ''}
          </span>
        </div>

        {/* Watch status */}
        <div style={st.metric}>
          <span style={st.metricLabel}>Watches</span>
          <span style={{
            ...st.metricValue,
            color: confirmedCount > 0 ? c.up : watchingCount > 0 ? c.blue : c.muted,
          }}>
            {confirmedCount > 0 ? `${confirmedCount} confirmed` :
             watchingCount > 0 ? `${watchingCount} active` : 'none'}
          </span>
        </div>

        {/* Best confirmation progress */}
        {bestWatch && (bestWatch.state === 'watching' || bestWatch.state === 'confirming') && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flex: 1, minWidth: 100 }}>
            <span style={st.metricLabel}>
              Confirmation {bestWatch.confirmationScore ?? 0}%
            </span>
            <div style={st.watchBar}>
              <div style={{
                ...st.watchFill,
                width: `${Math.min(bestWatch.confirmationScore ?? 0, 100)}%`,
                background: (bestWatch.confirmationScore ?? 0) >= 80 ? c.up : (bestWatch.confirmationScore ?? 0) >= 50 ? c.yellow : c.blue,
              }} />
            </div>
          </div>
        )}

        {/* Recent council outcome */}
        {reviewedIntents[0] && (
          <div style={st.metric}>
            <span style={st.metricLabel}>Last Council</span>
            <span style={{
              ...st.metricValue, fontSize: 11,
              color: reviewedIntents[0].outcome === 'approved' ? c.up :
                     reviewedIntents[0].outcome === 'rejected' ? c.down : c.muted,
            }}>
              {reviewedIntents[0].outcome?.toUpperCase() ?? '—'}
            </span>
          </div>
        )}

        {/* P&L summary even when no position */}
        {sim?.pnlSummary && (sim.pnlSummary.closedPositionCount > 0) && (
          <div style={st.metric}>
            <span style={st.metricLabel}>Session P&L</span>
            <span style={{
              ...st.metricValue, fontSize: 11,
              color: sim.pnlSummary.totalPnLDollars >= 0 ? c.up : c.down,
            }}>
              {sim.pnlSummary.totalPnLDollars >= 0 ? '+' : ''}${sim.pnlSummary.totalPnLDollars.toFixed(0)}
              <span style={{ fontSize: 9, color: c.muted, marginLeft: 4 }}>
                {sim.pnlSummary.winCount}W / {sim.pnlSummary.lossCount}L
              </span>
            </span>
          </div>
        )}
      </div>

      {/* ── Blocked Reason (expanded) ── */}
      {blockedReason && (
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', lineHeight: 1.5, fontStyle: 'italic' }}>
          {blockedReason}
        </div>
      )}

      {/* ── Blocked Evaluations (why decisions were rejected) ── */}
      {blockedEvaluations.length > 0 && (
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            <span style={{ ...st.sectionTitle, marginBottom: 0 }}>
              Blocked Decisions ({blockedEvaluations.length})
            </span>
            <button style={st.expandBtn} onClick={() => setShowBlocked(v => !v)}>
              {showBlocked ? 'Hide' : 'Show'}
            </button>
          </div>
          {showBlocked && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 6 }}>
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
                      <div key={j} style={{ color: 'rgba(255,255,255,0.4)', paddingLeft: 8 }}>
                        {'\u2022'} {r}
                      </div>
                    ))
                  ) : be.reason ? (
                    <div style={{ color: 'rgba(255,255,255,0.4)', paddingLeft: 8 }}>{'\u2022'} {be.reason}</div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Nearby watches detail (when any are active) ── */}
      {watches.length > 0 && watches.some((w: any) => w.state !== 'rejected') && (
        <div>
          <div style={st.sectionTitle}>Watch Alerts</div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            {watches.filter((w: any) => w.state !== 'rejected').slice(0, 4).map((w: any, i: number) => {
              const stateColor = w.state === 'confirmed' ? c.up :
                w.state === 'confirming' ? c.blue :
                w.state === 'watching' ? c.yellow : c.muted;
              return (
                <div key={w.id ?? i} style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 10 }}>
                  <span style={{
                    ...st.chip, fontSize: 8,
                    background: stateColor + '15', color: stateColor,
                  }}>
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
    </div>
  );
}
