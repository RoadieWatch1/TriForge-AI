// ── renderer/components/trading/ExpectancyPanel.tsx ─────────────────────────────
//
// Expectancy tables by dimension. Dimension selector at top, table below.
// Color-coded win rates, expectancy, and profit factor values.
//
// Props-driven — no direct IPC calls.

import React from 'react';

// ── Local Type Mirrors ──────────────────────────────────────────────────────

interface BucketStatsView {
  bucket: string;
  dimension: string;
  trades: number;
  wins: number;
  losses: number;
  winRate: number;
  avgPnlR: number;
  expectancy: number;
  profitFactor: number;
  avgWinR: number;
  avgLossR: number;
  avgHoldMinutes: number;
}

interface ExpectancySummaryView {
  overall: BucketStatsView;
  buckets: BucketStatsView[];
}

type DimensionKey = 'levelType' | 'confirmationType' | 'sessionRegime' | 'symbol' | 'scoreBand' | 'sessionWindow' | 'councilConsensus';

const DIMENSION_LABELS: Record<DimensionKey, string> = {
  levelType:         'Level Type',
  confirmationType:  'Confirmation',
  sessionRegime:     'Session Regime',
  symbol:            'Symbol',
  scoreBand:         'Score Band',
  sessionWindow:     'Session Window',
  councilConsensus:  'Council Consensus',
};

interface ExpectancyPanelProps {
  summary: ExpectancySummaryView | null;
  dimension: DimensionKey;
  onDimensionChange: (d: DimensionKey) => void;
}

// ── Component ───────────────────────────────────────────────────────────────

export function ExpectancyPanel({ summary, dimension, onDimensionChange }: ExpectancyPanelProps) {
  return (
    <div style={p.card}>
      <div style={p.cardTitle}>EXPECTANCY ANALYTICS</div>

      {/* ── Dimension Selector ── */}
      <div style={p.dimRow}>
        {(Object.keys(DIMENSION_LABELS) as DimensionKey[]).map(d => (
          <button
            key={d}
            style={{ ...p.dimBtn, ...(d === dimension ? p.dimBtnActive : {}) }}
            onClick={() => onDimensionChange(d)}
          >
            {DIMENSION_LABELS[d]}
          </button>
        ))}
      </div>

      {/* ── Empty State ── */}
      {(!summary || summary.overall.trades === 0) && (
        <div style={p.empty}>
          No journal data for analytics. Complete some simulated trades first.
        </div>
      )}

      {/* ── Overall Summary ── */}
      {summary && summary.overall.trades > 0 && (
        <>
          <div style={p.overallRow}>
            <Metric label="Trades" value={String(summary.overall.trades)} />
            <Metric label="Win Rate" value={fmtPct(summary.overall.winRate)} color={winRateColor(summary.overall.winRate)} />
            <Metric label="Avg P&L" value={fmtR(summary.overall.avgPnlR)} color={rColor(summary.overall.avgPnlR)} />
            <Metric label="Expectancy" value={fmtR(summary.overall.expectancy)} color={rColor(summary.overall.expectancy)} />
            <Metric label="Profit Factor" value={fmtPF(summary.overall.profitFactor)} color={pfColor(summary.overall.profitFactor)} />
          </div>

          {/* ── Bucket Table ── */}
          {summary.buckets.length > 0 && (
            <div style={p.tableWrap}>
              <table style={p.table}>
                <thead>
                  <tr>
                    <th style={p.th}>{DIMENSION_LABELS[dimension]}</th>
                    <th style={{ ...p.th, textAlign: 'right' }}>Trades</th>
                    <th style={{ ...p.th, textAlign: 'right' }}>Win Rate</th>
                    <th style={{ ...p.th, textAlign: 'right' }}>Avg P&L (R)</th>
                    <th style={{ ...p.th, textAlign: 'right' }}>Expectancy</th>
                    <th style={{ ...p.th, textAlign: 'right' }}>PF</th>
                    <th style={{ ...p.th, textAlign: 'right' }}>Avg Hold</th>
                  </tr>
                </thead>
                <tbody>
                  {summary.buckets.map(b => (
                    <tr key={b.bucket} style={p.tr}>
                      <td style={p.td}>{b.bucket.replace(/_/g, ' ')}</td>
                      <td style={{ ...p.td, textAlign: 'right' }}>{b.trades}</td>
                      <td style={{ ...p.td, textAlign: 'right', color: winRateColor(b.winRate) }}>
                        {fmtPct(b.winRate)}
                      </td>
                      <td style={{ ...p.td, textAlign: 'right', color: rColor(b.avgPnlR) }}>
                        {fmtR(b.avgPnlR)}
                      </td>
                      <td style={{ ...p.td, textAlign: 'right', color: rColor(b.expectancy) }}>
                        {fmtR(b.expectancy)}
                      </td>
                      <td style={{ ...p.td, textAlign: 'right', color: pfColor(b.profitFactor) }}>
                        {fmtPF(b.profitFactor)}
                      </td>
                      <td style={{ ...p.td, textAlign: 'right' }}>
                        {b.avgHoldMinutes > 0 ? `${Math.round(b.avgHoldMinutes)}m` : '—'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function Metric({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={p.metric}>
      <div style={p.metricLabel}>{label}</div>
      <div style={{ ...p.metricValue, ...(color ? { color } : {}) }}>{value}</div>
    </div>
  );
}

function fmtR(r: number): string {
  return `${r >= 0 ? '+' : ''}${r.toFixed(2)}R`;
}

function fmtPct(rate: number): string {
  return `${(rate * 100).toFixed(0)}%`;
}

function fmtPF(pf: number): string {
  if (!isFinite(pf)) return '\u221E';
  return pf.toFixed(2);
}

function winRateColor(rate: number): string {
  if (rate >= 0.6) return '#34d399';
  if (rate >= 0.45) return 'rgba(255,255,255,0.6)';
  return '#f87171';
}

function rColor(r: number): string {
  if (r > 0.05) return '#34d399';
  if (r < -0.05) return '#f87171';
  return 'rgba(255,255,255,0.5)';
}

function pfColor(pf: number): string {
  if (!isFinite(pf) || pf >= 1.5) return '#34d399';
  if (pf >= 1.0) return 'rgba(255,255,255,0.6)';
  return '#f87171';
}

// ── Styles ──────────────────────────────────────────────────────────────────

const p: Record<string, React.CSSProperties> = {
  card:          { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 },
  cardTitle:     { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'rgba(255,255,255,0.35)' },
  empty:         { fontSize: 12, color: 'rgba(255,255,255,0.3)', fontStyle: 'italic', padding: '8px 0' },
  dimRow:        { display: 'flex', gap: 4, flexWrap: 'wrap' },
  dimBtn:        { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 4, color: 'rgba(255,255,255,0.4)', fontSize: 10, fontWeight: 600, padding: '4px 8px', cursor: 'pointer', fontFamily: 'inherit' },
  dimBtnActive:  { background: 'rgba(96,165,250,0.12)', borderColor: 'rgba(96,165,250,0.3)', color: '#60a5fa' },
  overallRow:    { display: 'flex', gap: 20, flexWrap: 'wrap', padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' },
  metric:        { display: 'flex', flexDirection: 'column', gap: 2 },
  metricLabel:   { fontSize: 9, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.06em' },
  metricValue:   { fontSize: 14, fontWeight: 700, color: 'rgba(255,255,255,0.7)', fontVariantNumeric: 'tabular-nums' },
  tableWrap:     { overflowX: 'auto' },
  table:         { width: '100%', borderCollapse: 'collapse', fontSize: 11 },
  th:            { fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'rgba(255,255,255,0.3)', padding: '6px 8px', borderBottom: '1px solid rgba(255,255,255,0.08)', textAlign: 'left' as const, whiteSpace: 'nowrap' },
  tr:            { borderBottom: '1px solid rgba(255,255,255,0.03)' },
  td:            { padding: '5px 8px', color: 'rgba(255,255,255,0.6)', fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' },
};
