// ── renderer/components/trading/CouncilEffectivenessPanel.tsx ─────────────────
//
// Read-only panel showing trade performance broken down by council consensus
// pattern. Helps evaluate whether unanimous approvals, split decisions, Grok
// vetoes, etc. are actually correlated with better/worse outcomes.
//
// This is observational data — it does NOT auto-optimize or change strategy.
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

interface EffectSummaryView {
  overall: BucketStatsView;
  buckets: BucketStatsView[];
}

// ── Pattern Display Config ──────────────────────────────────────────────────

const PATTERN_LABELS: Record<string, string> = {
  unanimous_take:     'Unanimous Take',
  majority_take:      'Majority Take',
  split_approval:     'Split Approval',
  grok_veto:          'Grok Veto',
  low_confidence:     'Low Confidence',
  insufficient_votes: 'Insufficient Votes',
  no_council:         'No Council',
  unknown:            'Unknown',
};

const PATTERN_COLORS: Record<string, string> = {
  unanimous_take:     '#34d399',           // green — strongest agreement
  majority_take:      '#60a5fa',           // blue — solid consensus
  split_approval:     '#fbbf24',           // amber — mixed signals
  grok_veto:          '#f87171',           // red — blocked by counter-case
  low_confidence:     '#fb923c',           // orange — weak conviction
  insufficient_votes: 'rgba(255,255,255,0.3)', // dim — not enough data
  no_council:         'rgba(255,255,255,0.25)', // dim
  unknown:            'rgba(255,255,255,0.2)',
};

interface CouncilEffectivenessPanelProps {
  summary: EffectSummaryView | null;
}

// ── Component ───────────────────────────────────────────────────────────────

export function CouncilEffectivenessPanel({ summary }: CouncilEffectivenessPanelProps) {
  const hasTrades = summary && summary.overall.trades > 0;
  const buckets = summary?.buckets ?? [];

  return (
    <div style={p.card}>
      <div style={p.cardTitle}>COUNCIL EFFECTIVENESS</div>
      <div style={p.subtitle}>
        Performance by council consensus pattern. Observational only — does not change strategy.
      </div>

      {/* ── Empty State ── */}
      {!hasTrades && (
        <div style={p.empty}>
          No journal data with council outcomes yet. Complete some simulated trades
          with the council enabled to see effectiveness metrics.
        </div>
      )}

      {/* ── Overall Summary ── */}
      {hasTrades && (
        <>
          <div style={p.overallRow}>
            <Metric label="Total Trades" value={String(summary!.overall.trades)} />
            <Metric label="Overall Win Rate" value={fmtPct(summary!.overall.winRate)} color={winRateColor(summary!.overall.winRate)} />
            <Metric label="Expectancy" value={fmtR(summary!.overall.expectancy)} color={rColor(summary!.overall.expectancy)} />
            <Metric label="Profit Factor" value={fmtPF(summary!.overall.profitFactor)} color={pfColor(summary!.overall.profitFactor)} />
          </div>

          {/* ── Pattern Breakdown ── */}
          {buckets.length > 0 && (
            <div style={p.bucketList}>
              {buckets.map(b => {
                const label = PATTERN_LABELS[b.bucket] ?? b.bucket.replace(/_/g, ' ');
                const color = PATTERN_COLORS[b.bucket] ?? 'rgba(255,255,255,0.4)';
                return (
                  <div key={b.bucket} style={p.bucketRow}>
                    {/* ── Pattern badge + trade count ── */}
                    <div style={p.bucketHeader}>
                      <span style={{ ...p.badge, borderColor: color, color }}>{label}</span>
                      <span style={p.tradeCount}>{b.trades} trade{b.trades !== 1 ? 's' : ''}</span>
                    </div>

                    {/* ── Stats row ── */}
                    <div style={p.statsRow}>
                      <StatCell label="Win Rate" value={fmtPct(b.winRate)} color={winRateColor(b.winRate)} />
                      <StatCell label="Avg P&L" value={fmtR(b.avgPnlR)} color={rColor(b.avgPnlR)} />
                      <StatCell label="Expectancy" value={fmtR(b.expectancy)} color={rColor(b.expectancy)} />
                      <StatCell label="PF" value={fmtPF(b.profitFactor)} color={pfColor(b.profitFactor)} />
                      <StatCell label="Avg Win" value={fmtR(b.avgWinR)} color="rgba(255,255,255,0.5)" />
                      <StatCell label="Avg Loss" value={fmtR(-b.avgLossR)} color="rgba(255,255,255,0.5)" />
                    </div>

                    {/* ── Win rate bar ── */}
                    <div style={p.barTrack}>
                      <div style={{ ...p.barFill, width: `${Math.round(b.winRate * 100)}%`, background: color }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* ── Interpretation Hints ── */}
          {buckets.length >= 2 && (
            <div style={p.hints}>
              {(() => {
                const sorted = [...buckets].filter(b => b.trades >= 3).sort((a, b) => b.expectancy - a.expectancy);
                if (sorted.length < 2) return null;
                const best = sorted[0];
                const worst = sorted[sorted.length - 1];
                const bestLabel = PATTERN_LABELS[best.bucket] ?? best.bucket;
                const worstLabel = PATTERN_LABELS[worst.bucket] ?? worst.bucket;
                return (
                  <>
                    <div style={p.hintLine}>
                      Best pattern: <strong>{bestLabel}</strong> ({fmtR(best.expectancy)} expectancy, {best.trades} trades)
                    </div>
                    {worst.expectancy < best.expectancy && (
                      <div style={p.hintLine}>
                        Weakest pattern: <strong>{worstLabel}</strong> ({fmtR(worst.expectancy)} expectancy, {worst.trades} trades)
                      </div>
                    )}
                  </>
                );
              })()}
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

function StatCell({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={p.statCell}>
      <div style={p.statLabel}>{label}</div>
      <div style={{ ...p.statValue, color }}>{value}</div>
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
  subtitle:      { fontSize: 10, color: 'rgba(255,255,255,0.25)', fontStyle: 'italic', marginTop: -6 },
  empty:         { fontSize: 12, color: 'rgba(255,255,255,0.3)', fontStyle: 'italic', padding: '8px 0' },
  overallRow:    { display: 'flex', gap: 20, flexWrap: 'wrap', padding: '8px 0', borderBottom: '1px solid rgba(255,255,255,0.06)' },
  metric:        { display: 'flex', flexDirection: 'column', gap: 2 },
  metricLabel:   { fontSize: 9, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.06em' },
  metricValue:   { fontSize: 14, fontWeight: 700, color: 'rgba(255,255,255,0.7)', fontVariantNumeric: 'tabular-nums' },
  bucketList:    { display: 'flex', flexDirection: 'column', gap: 10 },
  bucketRow:     { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 6, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 },
  bucketHeader:  { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  badge:         { fontSize: 10, fontWeight: 700, border: '1px solid', borderRadius: 4, padding: '2px 7px', textTransform: 'uppercase', letterSpacing: '0.04em' },
  tradeCount:    { fontSize: 10, color: 'rgba(255,255,255,0.3)' },
  statsRow:      { display: 'flex', gap: 12, flexWrap: 'wrap' },
  statCell:      { display: 'flex', flexDirection: 'column', gap: 1, minWidth: 52 },
  statLabel:     { fontSize: 8, color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', letterSpacing: '0.05em' },
  statValue:     { fontSize: 12, fontWeight: 600, fontVariantNumeric: 'tabular-nums' },
  barTrack:      { height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden' },
  barFill:       { height: '100%', borderRadius: 2, transition: 'width 0.3s ease' },
  hints:         { borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 8 },
  hintLine:      { fontSize: 10, color: 'rgba(255,255,255,0.35)', lineHeight: 1.6 },
};
