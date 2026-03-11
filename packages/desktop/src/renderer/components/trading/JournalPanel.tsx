// ── renderer/components/trading/JournalPanel.tsx ────────────────────────────────
//
// Read-only journal of completed shadow trades. Shows outcome badges,
// key columns, and expandable detail rows with score breakdown,
// council votes, and news flags.
//
// Props-driven — no direct IPC calls. Data loaded by parent polling loop.

import React, { useState } from 'react';

// ── Local Type Mirrors ──────────────────────────────────────────────────────

interface JournalEntryView {
  tradeId: string;
  symbol: string;
  direction: string;
  levelType: string;
  destinationLevelType?: string;
  tradeScoreBand: string;
  tradeScore: number;
  pnlR: number;
  mfeR?: number;
  maeR?: number;
  sessionLabel: string;
  sessionRegime?: string | null;
  exitReason: string;
  outcome: 'win' | 'loss' | 'breakeven';
  entryPrice?: number;
  stopPrice?: number;
  targetPrice?: number;
  exitPrice?: number;
  riskRewardRatio?: number;
  confirmationTypes?: string[];
  confirmationScore?: number;
  holdDurationMs?: number;
  newsFlags?: string[];
  newsScoreAdjustment?: number;
  councilVotes?: Array<{ provider: string; vote: string; confidence: number }> | null;
  councilApproved?: boolean;
  scoreBreakdown?: {
    final: number; level: number; route: number;
    confirmation: number; session: number; rr: number;
  } | null;
  createdAt: number;
}

interface JournalPanelProps {
  entries: JournalEntryView[];
  filterSymbol: string;
  filterOutcome: string;
  onFilterSymbolChange: (v: string) => void;
  onFilterOutcomeChange: (v: string) => void;
}

// ── Component ───────────────────────────────────────────────────────────────

export function JournalPanel({
  entries, filterSymbol, filterOutcome,
  onFilterSymbolChange, onFilterOutcomeChange,
}: JournalPanelProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);

  if (entries.length === 0 && !filterSymbol && !filterOutcome) {
    return (
      <div style={p.card}>
        <div style={p.cardTitle}>TRADE JOURNAL</div>
        <div style={p.empty}>No completed trades yet. Journal entries appear here after simulated positions close.</div>
      </div>
    );
  }

  return (
    <div style={p.card}>
      <div style={p.cardTitle}>TRADE JOURNAL ({entries.length})</div>

      {/* ── Filters ── */}
      <div style={p.filterRow}>
        <input
          style={p.filterInput}
          placeholder="Symbol..."
          value={filterSymbol}
          onChange={e => onFilterSymbolChange(e.target.value)}
        />
        <select
          style={p.filterSelect}
          value={filterOutcome}
          onChange={e => onFilterOutcomeChange(e.target.value)}
        >
          <option value="">All outcomes</option>
          <option value="win">Wins</option>
          <option value="loss">Losses</option>
          <option value="breakeven">Breakeven</option>
        </select>
      </div>

      {entries.length === 0 && (
        <div style={p.empty}>No entries match the current filters.</div>
      )}

      {/* ── Entry List ── */}
      {entries.map(e => {
        const isExpanded = expandedId === e.tradeId;
        return (
          <div key={e.tradeId} style={p.entryCard}>
            {/* Summary row */}
            <div
              style={p.entryRow}
              onClick={() => setExpandedId(isExpanded ? null : e.tradeId)}
            >
              <span style={outcomeBadgeStyle(e.outcome)}>
                {e.outcome.toUpperCase()}
              </span>
              <span style={p.entrySymbol}>{e.symbol}</span>
              <span style={{ ...p.entrySide, color: e.direction === 'up' ? '#34d399' : '#f87171' }}>
                {e.direction === 'up' ? 'LONG' : 'SHORT'}
              </span>
              <span style={p.entryDetail}>{e.levelType.replace(/_/g, ' ')}</span>
              <span style={p.entryDetail}>{e.tradeScoreBand.toUpperCase()}</span>
              <span style={{ ...p.entryPnl, color: e.pnlR >= 0 ? '#34d399' : '#f87171' }}>
                {e.pnlR >= 0 ? '+' : ''}{e.pnlR.toFixed(2)}R
              </span>
              <span style={p.entryDetail}>{e.sessionLabel}</span>
              <span style={p.entryDetail}>{e.exitReason}</span>
              <span style={p.expandArrow}>{isExpanded ? '\u25B2' : '\u25BC'}</span>
            </div>

            {/* Expanded detail */}
            {isExpanded && (
              <div style={p.detailBlock}>
                {/* Prices */}
                <div style={p.detailSection}>
                  <div style={p.detailLabel}>PRICES</div>
                  <div style={p.detailText}>
                    Entry: {e.entryPrice?.toFixed(2) ?? '—'} | Stop: {e.stopPrice?.toFixed(2) ?? '—'} | Target: {e.targetPrice?.toFixed(2) ?? '—'} | Exit: {e.exitPrice?.toFixed(2) ?? '—'}
                  </div>
                  <div style={p.detailText}>
                    R:R: {e.riskRewardRatio?.toFixed(2) ?? '—'}:1 | MFE: {e.mfeR?.toFixed(2) ?? '—'}R | MAE: {e.maeR?.toFixed(2) ?? '—'}R
                  </div>
                  {e.holdDurationMs != null && (
                    <div style={p.detailText}>
                      Hold: {Math.round(e.holdDurationMs / 60_000)}m
                    </div>
                  )}
                </div>

                {/* Score breakdown */}
                {e.scoreBreakdown && (
                  <div style={p.detailSection}>
                    <div style={p.detailLabel}>SCORE BREAKDOWN</div>
                    <div style={p.detailText}>
                      Final: {Math.round(e.scoreBreakdown.final)} | Level: {Math.round(e.scoreBreakdown.level)} | Route: {Math.round(e.scoreBreakdown.route)} | Confirm: {Math.round(e.scoreBreakdown.confirmation)} | Session: {Math.round(e.scoreBreakdown.session)} | R:R: {Math.round(e.scoreBreakdown.rr)}
                    </div>
                  </div>
                )}

                {/* Confirmation */}
                {e.confirmationTypes && e.confirmationTypes.length > 0 && (
                  <div style={p.detailSection}>
                    <div style={p.detailLabel}>CONFIRMATIONS ({e.confirmationScore ?? '—'})</div>
                    <div style={p.detailText}>
                      {e.confirmationTypes.map(c => c.replace(/_/g, ' ')).join(', ')}
                    </div>
                  </div>
                )}

                {/* Session regime */}
                {e.sessionRegime && (
                  <div style={p.detailSection}>
                    <div style={p.detailLabel}>SESSION REGIME</div>
                    <div style={p.detailText}>{e.sessionRegime.replace(/_/g, ' ')}</div>
                  </div>
                )}

                {/* Council votes */}
                {e.councilVotes && e.councilVotes.length > 0 && (
                  <div style={p.detailSection}>
                    <div style={p.detailLabel}>COUNCIL {e.councilApproved ? '(APPROVED)' : '(REJECTED)'}</div>
                    {e.councilVotes.map((v, i) => (
                      <div key={i} style={p.detailText}>
                        {v.provider}: {v.vote} ({v.confidence}%)
                      </div>
                    ))}
                  </div>
                )}

                {/* News flags */}
                {e.newsFlags && e.newsFlags.length > 0 && (
                  <div style={p.detailSection}>
                    <div style={p.detailLabel}>NEWS FLAGS{e.newsScoreAdjustment ? ` (adj: ${e.newsScoreAdjustment})` : ''}</div>
                    {e.newsFlags.map((f, i) => (
                      <div key={i} style={p.detailText}>- {f}</div>
                    ))}
                  </div>
                )}

                {/* Destination */}
                {e.destinationLevelType && (
                  <div style={p.detailSection}>
                    <div style={p.detailLabel}>DESTINATION</div>
                    <div style={p.detailText}>{e.destinationLevelType.replace(/_/g, ' ')}</div>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function outcomeBadgeStyle(outcome: string): React.CSSProperties {
  const colors: Record<string, { bg: string; fg: string; border: string }> = {
    win:       { bg: 'rgba(52,211,153,0.1)',  fg: '#34d399', border: 'rgba(52,211,153,0.3)' },
    loss:      { bg: 'rgba(248,113,113,0.1)', fg: '#f87171', border: 'rgba(248,113,113,0.3)' },
    breakeven: { bg: 'rgba(255,255,255,0.05)', fg: 'rgba(255,255,255,0.4)', border: 'rgba(255,255,255,0.15)' },
  };
  const c = colors[outcome] ?? colors.breakeven;
  return {
    fontSize: 9, fontWeight: 800, letterSpacing: '0.06em',
    background: c.bg, color: c.fg, border: `1px solid ${c.border}`,
    borderRadius: 3, padding: '1px 6px', flexShrink: 0,
  };
}

// ── Styles ──────────────────────────────────────────────────────────────────

const p: Record<string, React.CSSProperties> = {
  card:        { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 },
  cardTitle:   { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'rgba(255,255,255,0.35)' },
  empty:       { fontSize: 12, color: 'rgba(255,255,255,0.3)', fontStyle: 'italic', padding: '8px 0' },
  filterRow:   { display: 'flex', gap: 8 },
  filterInput: { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 5, color: 'rgba(255,255,255,0.85)', fontSize: 11, padding: '5px 8px', outline: 'none', fontFamily: 'inherit', width: 100 },
  filterSelect:{ background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 5, color: 'rgba(255,255,255,0.85)', fontSize: 11, padding: '5px 8px', outline: 'none', fontFamily: 'inherit', cursor: 'pointer' },
  entryCard:   { borderBottom: '1px solid rgba(255,255,255,0.04)', paddingBottom: 4 },
  entryRow:    { display: 'flex', gap: 8, alignItems: 'center', fontSize: 11, cursor: 'pointer', padding: '4px 0', flexWrap: 'wrap' },
  entrySymbol: { fontWeight: 700, color: 'rgba(255,255,255,0.85)', flexShrink: 0 },
  entrySide:   { fontWeight: 700, fontSize: 10, letterSpacing: '0.04em', flexShrink: 0 },
  entryDetail: { color: 'rgba(255,255,255,0.4)', fontSize: 10 },
  entryPnl:    { fontWeight: 700, fontSize: 12, fontVariantNumeric: 'tabular-nums', flexShrink: 0 },
  expandArrow: { color: 'rgba(255,255,255,0.2)', fontSize: 8, marginLeft: 'auto', flexShrink: 0 },
  detailBlock: { background: 'rgba(255,255,255,0.02)', borderRadius: 6, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 },
  detailSection: { display: 'flex', flexDirection: 'column', gap: 2 },
  detailLabel: { fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'rgba(255,255,255,0.3)' },
  detailText:  { fontSize: 11, color: 'rgba(255,255,255,0.55)', lineHeight: 1.5 },
};
