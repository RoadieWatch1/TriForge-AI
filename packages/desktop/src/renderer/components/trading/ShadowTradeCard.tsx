// ── renderer/components/trading/ShadowTradeCard.tsx ──────────────────────────
//
// Enhanced trade card showing full score breakdown, level/route context,
// confidence, rationale, and risks for an active or recently reviewed
// trade intent.
//
// Props-driven — no direct IPC calls. Local type mirrors only.

import React from 'react';

// ── Local Type Mirrors ──────────────────────────────────────────────────────

interface TradeScoreView {
  final: number;
  band: 'elite' | 'A' | 'B' | 'no_trade';
  levelScore: number;
  routeScore: number;
  confirmationScore: number;
  sessionScore: number;
  rrScore: number;
}

interface LevelView {
  type: string;
  price: number;
  qualityScore: number;
  label?: string;
  grade?: string;
}

interface RouteView {
  direction: string;
  distancePoints: number;
  qualityScore: number;
  intermediateObstacles?: any[];
}

interface IntentView {
  id: string;
  symbol: string;
  side: 'long' | 'short';
  entry: number;
  stop: number;
  target: number;
  additionalTargets?: number[];
  riskRewardRatio?: number;
  setupGrade?: string;
  confidence?: string;
  reasons?: string[];
  risks?: string[];
  score?: TradeScoreView;
  entryLevel?: LevelView;
  route?: RouteView;
}

interface ShadowTradeCardProps {
  intent: IntentView;
  outcome?: 'approved' | 'rejected' | 'error' | 'no_council' | 'pending';
  reason?: string;
}

// ── Component ───────────────────────────────────────────────────────────────

export function ShadowTradeCard({ intent, outcome, reason }: ShadowTradeCardProps) {
  const score = intent.score;
  const oCfg = OUTCOME_CONFIG[outcome ?? 'pending'];

  return (
    <div style={p.card}>
      {/* ── Header: symbol, direction, outcome ── */}
      <div style={p.header}>
        <span style={p.symbol}>{intent.symbol}</span>
        <span style={{ ...p.sideBadge, color: intent.side === 'long' ? '#34d399' : '#f87171', background: intent.side === 'long' ? 'rgba(52,211,153,0.1)' : 'rgba(248,113,113,0.1)', borderColor: intent.side === 'long' ? 'rgba(52,211,153,0.3)' : 'rgba(248,113,113,0.3)' }}>
          {intent.side === 'long' ? 'LONG' : 'SHORT'}
        </span>
        {intent.setupGrade && (
          <span style={gradeBadgeStyle(intent.setupGrade)}>
            {intent.setupGrade === 'elite' ? 'ELITE' : intent.setupGrade.toUpperCase()}
          </span>
        )}
        <span style={{ ...p.outcomeBadge, color: oCfg.color, background: oCfg.bg, borderColor: oCfg.border }}>
          {oCfg.label}
        </span>
      </div>

      {/* ── Prices ── */}
      <div style={p.priceRow}>
        <PriceCell label="Entry" value={fmt(intent.entry)} />
        <PriceCell label="Stop" value={fmt(intent.stop)} color="#f87171" />
        <PriceCell label="Target" value={fmt(intent.target)} color="#34d399" />
        {intent.riskRewardRatio != null && (
          <PriceCell label="R:R" value={`${intent.riskRewardRatio.toFixed(1)}:1`} color={intent.riskRewardRatio >= 2 ? '#34d399' : intent.riskRewardRatio >= 1.5 ? 'rgba(255,255,255,0.6)' : '#fbbf24'} />
        )}
      </div>

      {/* ── Advisory Targets ── */}
      {intent.additionalTargets && intent.additionalTargets.length > 0 && (
        <div style={p.advisoryRow}>
          <span style={p.advisoryLabel}>ADVISORY ONLY</span>
          {intent.additionalTargets.map((t, i) => (
            <PriceCell key={i} label={`T${i + 2}`} value={fmt(t)} color="rgba(96,165,250,0.6)" />
          ))}
          <span style={p.advisoryNote}>Not active exits</span>
        </div>
      )}

      {/* ── Score Breakdown ── */}
      {score && (
        <div style={p.scoreSection}>
          <div style={p.sectionLabel}>SCORE BREAKDOWN</div>
          <div style={p.finalScoreRow}>
            <span style={p.finalScoreLabel}>Final</span>
            <span style={{ ...p.finalScoreValue, color: scoreColor(score.final) }}>{Math.round(score.final)}</span>
            <span style={bandBadgeStyle(score.band)}>{score.band === 'no_trade' ? 'NO TRADE' : score.band === 'elite' ? 'ELITE' : score.band.toUpperCase()}</span>
          </div>
          <div style={p.scoreGrid}>
            <ScoreBar label="Level" value={score.levelScore} weight={30} />
            <ScoreBar label="Route" value={score.routeScore} weight={25} />
            <ScoreBar label="Confirm" value={score.confirmationScore} weight={20} />
            <ScoreBar label="R:R" value={score.rrScore} weight={15} />
            <ScoreBar label="Session" value={score.sessionScore} weight={10} />
          </div>
        </div>
      )}

      {/* ── Level / Route Context ── */}
      {(intent.entryLevel || intent.route) && (
        <div style={p.contextSection}>
          <div style={p.sectionLabel}>LEVEL / ROUTE</div>
          <div style={p.contextGrid}>
            {intent.entryLevel && (
              <div style={p.contextItem}>
                <span style={p.contextKey}>Entry level</span>
                <span style={p.contextVal}>
                  {intent.entryLevel.type.replace(/_/g, ' ')} @ {fmt(intent.entryLevel.price)}
                  {intent.entryLevel.grade && <span style={{ ...p.gradeInline, color: gradeColor(intent.entryLevel.grade) }}> [{intent.entryLevel.grade.toUpperCase()}]</span>}
                </span>
              </div>
            )}
            {intent.route && (
              <>
                <div style={p.contextItem}>
                  <span style={p.contextKey}>Route quality</span>
                  <span style={{ ...p.contextVal, color: scoreColor(intent.route.qualityScore) }}>
                    {Math.round(intent.route.qualityScore)}
                  </span>
                </div>
                <div style={p.contextItem}>
                  <span style={p.contextKey}>Distance</span>
                  <span style={p.contextVal}>{intent.route.distancePoints.toFixed(1)} pts</span>
                </div>
                {intent.route.intermediateObstacles && intent.route.intermediateObstacles.length > 0 && (
                  <div style={p.contextItem}>
                    <span style={p.contextKey}>Obstacles</span>
                    <span style={{ ...p.contextVal, color: intent.route.intermediateObstacles.length >= 3 ? '#f87171' : 'rgba(255,255,255,0.5)' }}>
                      {intent.route.intermediateObstacles.length}
                    </span>
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Reasons / Risks ── */}
      {((intent.reasons && intent.reasons.length > 0) || (intent.risks && intent.risks.length > 0)) && (
        <div style={p.rationaleSection}>
          {intent.reasons && intent.reasons.length > 0 && (
            <div style={p.rationaleBlock}>
              <div style={p.sectionLabel}>REASONS</div>
              {intent.reasons.map((r, i) => (
                <div key={i} style={p.reasonItem}>{r}</div>
              ))}
            </div>
          )}
          {intent.risks && intent.risks.length > 0 && (
            <div style={p.rationaleBlock}>
              <div style={{ ...p.sectionLabel, color: 'rgba(248,113,113,0.5)' }}>RISKS</div>
              {intent.risks.map((r, i) => (
                <div key={i} style={p.riskItem}>{r}</div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* ── Outcome Reason ── */}
      {reason && (
        <div style={p.outcomeReason}>{reason}</div>
      )}
    </div>
  );
}

// ── Sub-Components ──────────────────────────────────────────────────────────

function PriceCell({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={p.priceCell}>
      <div style={p.priceCellLabel}>{label}</div>
      <div style={{ ...p.priceCellValue, ...(color ? { color } : {}) }}>{value}</div>
    </div>
  );
}

function ScoreBar({ label, value, weight }: { label: string; value: number; weight: number }) {
  const pct = Math.min(100, Math.max(0, value));
  return (
    <div style={p.scoreBarRow}>
      <span style={p.scoreBarLabel}>{label} ({weight}%)</span>
      <div style={p.scoreBarTrack}>
        <div style={{ ...p.scoreBarFill, width: `${pct}%`, background: scoreColor(value) }} />
      </div>
      <span style={{ ...p.scoreBarValue, color: scoreColor(value) }}>{Math.round(value)}</span>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmt(n: number): string {
  return n.toFixed(2);
}

function scoreColor(v: number): string {
  if (v >= 80) return '#34d399';
  if (v >= 65) return '#60a5fa';
  if (v >= 50) return 'rgba(255,255,255,0.6)';
  return '#f87171';
}

function gradeColor(grade: string): string {
  if (grade === 'A' || grade === 'elite') return '#34d399';
  if (grade === 'B') return '#60a5fa';
  if (grade === 'C') return 'rgba(255,255,255,0.5)';
  return 'rgba(255,255,255,0.3)';
}

function gradeBadgeStyle(grade: string): React.CSSProperties {
  const c = gradeColor(grade);
  return {
    fontSize: 9, fontWeight: 800, letterSpacing: '0.06em',
    color: c, background: `${c}18`, border: `1px solid ${c}40`,
    borderRadius: 3, padding: '1px 6px', flexShrink: 0,
  };
}

function bandBadgeStyle(band: string): React.CSSProperties {
  const colors: Record<string, { fg: string; bg: string; border: string }> = {
    elite:    { fg: '#34d399', bg: 'rgba(52,211,153,0.1)',    border: 'rgba(52,211,153,0.3)' },
    A:        { fg: '#60a5fa', bg: 'rgba(96,165,250,0.1)',    border: 'rgba(96,165,250,0.3)' },
    B:        { fg: '#fbbf24', bg: 'rgba(251,191,36,0.1)',    border: 'rgba(251,191,36,0.3)' },
    no_trade: { fg: '#f87171', bg: 'rgba(248,113,113,0.1)',   border: 'rgba(248,113,113,0.3)' },
  };
  const c = colors[band] ?? colors.no_trade;
  return {
    fontSize: 9, fontWeight: 800, letterSpacing: '0.06em',
    color: c.fg, background: c.bg, border: `1px solid ${c.border}`,
    borderRadius: 3, padding: '1px 6px', flexShrink: 0, marginLeft: 6,
  };
}

const OUTCOME_CONFIG: Record<string, { label: string; color: string; bg: string; border: string }> = {
  approved:   { label: 'APPROVED',   color: '#34d399', bg: 'rgba(52,211,153,0.1)',    border: 'rgba(52,211,153,0.3)' },
  rejected:   { label: 'REJECTED',   color: '#fbbf24', bg: 'rgba(251,191,36,0.1)',    border: 'rgba(251,191,36,0.3)' },
  error:      { label: 'ERROR',      color: '#f87171', bg: 'rgba(248,113,113,0.1)',   border: 'rgba(248,113,113,0.3)' },
  no_council: { label: 'NO COUNCIL', color: 'rgba(255,255,255,0.4)', bg: 'rgba(255,255,255,0.04)', border: 'rgba(255,255,255,0.12)' },
  pending:    { label: 'PENDING',    color: '#60a5fa', bg: 'rgba(96,165,250,0.1)',    border: 'rgba(96,165,250,0.3)' },
};

// ── Styles ──────────────────────────────────────────────────────────────────

const p: Record<string, React.CSSProperties> = {
  card:             { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 },

  // Header
  header:           { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  symbol:           { fontSize: 16, fontWeight: 800, color: 'rgba(255,255,255,0.9)' },
  sideBadge:        { fontSize: 10, fontWeight: 800, letterSpacing: '0.06em', border: '1px solid', borderRadius: 4, padding: '2px 8px', flexShrink: 0 },
  outcomeBadge:     { fontSize: 9, fontWeight: 800, letterSpacing: '0.06em', border: '1px solid', borderRadius: 3, padding: '1px 6px', flexShrink: 0, marginLeft: 'auto' },

  // Prices
  priceRow:         { display: 'flex', gap: 16, flexWrap: 'wrap' },
  priceCell:        { display: 'flex', flexDirection: 'column', gap: 2 },
  priceCellLabel:   { fontSize: 9, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.06em' },
  priceCellValue:   { fontSize: 14, fontWeight: 700, color: 'rgba(255,255,255,0.75)', fontVariantNumeric: 'tabular-nums' },

  // Advisory targets
  advisoryRow:    { display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', opacity: 0.6, borderTop: '1px dashed rgba(96,165,250,0.15)', paddingTop: 8 },
  advisoryLabel:  { fontSize: 8, fontWeight: 700, textTransform: 'uppercase' as const, letterSpacing: '0.06em', color: 'rgba(96,165,250,0.4)' },
  advisoryNote:   { fontSize: 8, color: 'rgba(96,165,250,0.3)', fontStyle: 'italic' as const, marginLeft: 'auto' as const },

  // Score breakdown
  scoreSection:     { display: 'flex', flexDirection: 'column', gap: 8, borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 10 },
  sectionLabel:     { fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'rgba(255,255,255,0.3)' },
  finalScoreRow:    { display: 'flex', alignItems: 'center', gap: 8 },
  finalScoreLabel:  { fontSize: 10, color: 'rgba(255,255,255,0.4)' },
  finalScoreValue:  { fontSize: 20, fontWeight: 800, fontVariantNumeric: 'tabular-nums' },
  scoreGrid:        { display: 'flex', flexDirection: 'column', gap: 4 },
  scoreBarRow:      { display: 'flex', alignItems: 'center', gap: 8 },
  scoreBarLabel:    { fontSize: 9, color: 'rgba(255,255,255,0.35)', width: 80, flexShrink: 0 },
  scoreBarTrack:    { flex: 1, height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden' },
  scoreBarFill:     { height: '100%', borderRadius: 2, transition: 'width 0.3s ease' },
  scoreBarValue:    { fontSize: 10, fontWeight: 700, fontVariantNumeric: 'tabular-nums', width: 24, textAlign: 'right', flexShrink: 0 },

  // Level / route context
  contextSection:   { display: 'flex', flexDirection: 'column', gap: 6, borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 10 },
  contextGrid:      { display: 'flex', flexDirection: 'column', gap: 4 },
  contextItem:      { display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' },
  contextKey:       { fontSize: 10, color: 'rgba(255,255,255,0.3)' },
  contextVal:       { fontSize: 11, color: 'rgba(255,255,255,0.6)', fontVariantNumeric: 'tabular-nums' },
  gradeInline:      { fontSize: 9, fontWeight: 800, letterSpacing: '0.04em' },

  // Reasons / risks
  rationaleSection: { display: 'flex', gap: 16, borderTop: '1px solid rgba(255,255,255,0.05)', paddingTop: 10 },
  rationaleBlock:   { flex: 1, display: 'flex', flexDirection: 'column', gap: 4 },
  reasonItem:       { fontSize: 10, color: 'rgba(255,255,255,0.5)', paddingLeft: 8, borderLeft: '2px solid rgba(52,211,153,0.2)', lineHeight: 1.5 },
  riskItem:         { fontSize: 10, color: 'rgba(255,255,255,0.45)', paddingLeft: 8, borderLeft: '2px solid rgba(248,113,113,0.2)', lineHeight: 1.5 },

  // Outcome reason
  outcomeReason:    { fontSize: 10, color: 'rgba(255,255,255,0.4)', fontStyle: 'italic', borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: 8 },
};
