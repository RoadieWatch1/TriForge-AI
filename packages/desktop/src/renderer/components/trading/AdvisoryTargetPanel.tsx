// ── renderer/components/trading/AdvisoryTargetPanel.tsx ──────────────────────
//
// Read-only analytics panel showing how often advisory T2/T3 targets would
// have been reached, based on MFE (maximum favorable excursion) data from
// the trade journal.
//
// This is observational only — it does NOT change execution behavior.
//
// Props-driven — no direct IPC calls.

import React from 'react';

// ── Local Type Mirrors ──────────────────────────────────────────────────────

interface AdvisoryTargetStatsView {
  totalTrades: number;
  tradesWithTargets: number;
  t2ReachCount: number;
  t2ReachRate: number;
  t3ReachCount: number;
  t3ReachRate: number;
  loserCount: number;
  losersWithTargets: number;
  loserT2ReachCount: number;
  loserT2ReachRate: number;
  loserT3ReachCount: number;
  loserT3ReachRate: number;
  avgMfeR: number;
  avgLeftoverRBeyondT1: number;
  avgT2RescueR: number;
}

interface AdvisoryTargetBucketView extends AdvisoryTargetStatsView {
  bucket: string;
  dimension: string;
}

interface AdvisoryTargetSummaryView {
  overall: AdvisoryTargetStatsView;
  buckets: AdvisoryTargetBucketView[];
}

interface AdvisoryTargetPanelProps {
  summary: AdvisoryTargetSummaryView | null;
}

// ── Component ───────────────────────────────────────────────────────────────

export function AdvisoryTargetPanel({ summary }: AdvisoryTargetPanelProps) {
  const hasData = summary && summary.overall.tradesWithTargets > 0;

  return (
    <div style={s.card}>
      <div style={s.cardTitle}>ADVISORY TARGET ANALYTICS</div>
      <div style={s.subtitle}>
        Observational analysis of T2/T3 advisory target reachability. Does not change execution.
      </div>

      {/* ── Empty State ── */}
      {!hasData && (
        <div style={s.empty}>
          No journal entries with advisory targets yet. Complete trades with advisory
          targets enabled to see reachability analytics.
        </div>
      )}

      {/* ── Overall Summary ── */}
      {hasData && (
        <>
          <div style={s.overallRow}>
            <Metric label="Trades w/ Targets" value={String(summary!.overall.tradesWithTargets)} />
            <Metric label="Avg MFE" value={fmtR(summary!.overall.avgMfeR)} color={rColor(summary!.overall.avgMfeR)} />
            <Metric label="Leftover R (T1)" value={fmtR(summary!.overall.avgLeftoverRBeyondT1)} color={rColor(summary!.overall.avgLeftoverRBeyondT1)} />
          </div>

          {/* ── Reach Rate Section ── */}
          <div style={s.section}>
            <div style={s.sectionLabel}>OVERALL REACH RATES</div>
            <div style={s.reachGrid}>
              <ReachBar label="T2 Reached" count={summary!.overall.t2ReachCount} total={summary!.overall.tradesWithTargets} rate={summary!.overall.t2ReachRate} color="#60a5fa" />
              <ReachBar label="T3 Reached" count={summary!.overall.t3ReachCount} total={summary!.overall.tradesWithTargets} rate={summary!.overall.t3ReachRate} color="#818cf8" />
            </div>
          </div>

          {/* ── Loser Rescue Section ── */}
          {summary!.overall.losersWithTargets > 0 && (
            <div style={s.section}>
              <div style={s.sectionLabel}>LOSER-SIDE RESCUE POTENTIAL</div>
              <div style={s.reachGrid}>
                <ReachBar label="Losers reaching T2" count={summary!.overall.loserT2ReachCount} total={summary!.overall.losersWithTargets} rate={summary!.overall.loserT2ReachRate} color="#fbbf24" />
                <ReachBar label="Losers reaching T3" count={summary!.overall.loserT3ReachCount} total={summary!.overall.losersWithTargets} rate={summary!.overall.loserT3ReachRate} color="#fb923c" />
              </div>
              {summary!.overall.avgT2RescueR > 0 && (
                <div style={s.rescueLine}>
                  Avg rescue R if partial taken at T2: <strong>{fmtR(summary!.overall.avgT2RescueR)}</strong>
                </div>
              )}
            </div>
          )}

          {/* ── Bucket Breakdown ── */}
          {summary!.buckets.length > 0 && (
            <div style={s.section}>
              <div style={s.sectionLabel}>BREAKDOWN BY BUCKET</div>
              <div style={s.bucketList}>
                {summary!.buckets.map(b => (
                  <div key={b.bucket} style={s.bucketRow}>
                    <div style={s.bucketHeader}>
                      <span style={s.bucketName}>{b.bucket.replace(/_/g, ' ')}</span>
                      <span style={s.bucketCount}>{b.tradesWithTargets} trade{b.tradesWithTargets !== 1 ? 's' : ''}</span>
                    </div>
                    <div style={s.bucketStats}>
                      <StatCell label="T2 Rate" value={fmtPct(b.t2ReachRate)} color={reachColor(b.t2ReachRate)} />
                      <StatCell label="T3 Rate" value={fmtPct(b.t3ReachRate)} color={reachColor(b.t3ReachRate)} />
                      <StatCell label="Avg MFE" value={fmtR(b.avgMfeR)} color={rColor(b.avgMfeR)} />
                      <StatCell label="Leftover R" value={fmtR(b.avgLeftoverRBeyondT1)} color={rColor(b.avgLeftoverRBeyondT1)} />
                      {b.losersWithTargets > 0 && (
                        <StatCell label="Loser T2" value={fmtPct(b.loserT2ReachRate)} color={reachColor(b.loserT2ReachRate)} />
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* ── Interpretation Hints ── */}
          {summary!.buckets.length >= 2 && (
            <div style={s.hints}>
              {(() => {
                const viable = summary!.buckets.filter(b => b.tradesWithTargets >= 3);
                if (viable.length < 2) return null;

                const sorted = [...viable].sort((a, b) => b.t2ReachRate - a.t2ReachRate);
                const best = sorted[0];
                const worst = sorted[sorted.length - 1];

                return (
                  <>
                    <div style={s.hintLine}>
                      Highest T2 reach: <strong>{best.bucket.replace(/_/g, ' ')}</strong> ({fmtPct(best.t2ReachRate)}, {best.tradesWithTargets} trades)
                    </div>
                    {worst.t2ReachRate < best.t2ReachRate && (
                      <div style={s.hintLine}>
                        Lowest T2 reach: <strong>{worst.bucket.replace(/_/g, ' ')}</strong> ({fmtPct(worst.t2ReachRate)}, {worst.tradesWithTargets} trades)
                      </div>
                    )}
                    {summary!.overall.avgLeftoverRBeyondT1 > 0.1 && (
                      <div style={s.hintLine}>
                        Positive leftover R beyond T1 may indicate runner potential — worth observing further.
                      </div>
                    )}
                    {summary!.overall.loserT2ReachRate > 0.2 && (
                      <div style={s.hintLine}>
                        Notable loser-side T2 reach rate — candidate for future execution testing.
                      </div>
                    )}
                  </>
                );
              })()}
            </div>
          )}

          {/* ── Observational Note ── */}
          <div style={s.note}>
            Advisory target analytics are observational only. Winner-side T2/T3 stats may be
            understated when trades exit at T1. Conclusions should be based on multiple metrics,
            not one percentage.
          </div>
        </>
      )}
    </div>
  );
}

// ── Sub-Components ──────────────────────────────────────────────────────────

function Metric({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={s.metric}>
      <div style={s.metricLabel}>{label}</div>
      <div style={{ ...s.metricValue, ...(color ? { color } : {}) }}>{value}</div>
    </div>
  );
}

function StatCell({ label, value, color }: { label: string; value: string; color: string }) {
  return (
    <div style={s.statCell}>
      <div style={s.statLabel}>{label}</div>
      <div style={{ ...s.statValue, color }}>{value}</div>
    </div>
  );
}

function ReachBar({ label, count, total, rate, color }: { label: string; count: number; total: number; rate: number; color: string }) {
  return (
    <div style={s.reachRow}>
      <div style={s.reachLabel}>{label}</div>
      <div style={s.reachMeta}>{count}/{total} ({fmtPct(rate)})</div>
      <div style={s.barTrack}>
        <div style={{ ...s.barFill, width: `${Math.round(rate * 100)}%`, background: color }} />
      </div>
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function fmtR(r: number): string {
  return `${r >= 0 ? '+' : ''}${r.toFixed(2)}R`;
}

function fmtPct(rate: number): string {
  return `${(rate * 100).toFixed(0)}%`;
}

function rColor(r: number): string {
  if (r > 0.05) return '#60a5fa';
  if (r < -0.05) return '#f87171';
  return 'rgba(255,255,255,0.5)';
}

function reachColor(rate: number): string {
  if (rate >= 0.4) return '#60a5fa';
  if (rate >= 0.2) return 'rgba(255,255,255,0.6)';
  return 'rgba(255,255,255,0.35)';
}

// ── Styles ──────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  card:          { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(96,165,250,0.1)', borderRadius: 10, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 },
  cardTitle:     { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'rgba(96,165,250,0.5)' },
  subtitle:      { fontSize: 10, color: 'rgba(255,255,255,0.25)', fontStyle: 'italic', marginTop: -6 },
  empty:         { fontSize: 12, color: 'rgba(255,255,255,0.3)', fontStyle: 'italic', padding: '8px 0' },

  overallRow:    { display: 'flex', gap: 20, flexWrap: 'wrap', padding: '8px 0', borderBottom: '1px solid rgba(96,165,250,0.08)' },
  metric:        { display: 'flex', flexDirection: 'column', gap: 2 },
  metricLabel:   { fontSize: 9, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.06em' },
  metricValue:   { fontSize: 14, fontWeight: 700, color: 'rgba(255,255,255,0.7)', fontVariantNumeric: 'tabular-nums' },

  section:       { display: 'flex', flexDirection: 'column', gap: 6 },
  sectionLabel:  { fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em', color: 'rgba(96,165,250,0.35)' },

  reachGrid:     { display: 'flex', flexDirection: 'column', gap: 6 },
  reachRow:      { display: 'flex', alignItems: 'center', gap: 8 },
  reachLabel:    { fontSize: 10, color: 'rgba(255,255,255,0.4)', width: 120, flexShrink: 0 },
  reachMeta:     { fontSize: 10, color: 'rgba(255,255,255,0.5)', fontVariantNumeric: 'tabular-nums', width: 70, flexShrink: 0, textAlign: 'right' },
  barTrack:      { flex: 1, height: 4, background: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden' },
  barFill:       { height: '100%', borderRadius: 2, transition: 'width 0.3s ease' },

  rescueLine:    { fontSize: 10, color: 'rgba(255,255,255,0.4)', paddingTop: 4 },

  bucketList:    { display: 'flex', flexDirection: 'column', gap: 8 },
  bucketRow:     { background: 'rgba(96,165,250,0.03)', border: '1px solid rgba(96,165,250,0.06)', borderRadius: 6, padding: '8px 10px', display: 'flex', flexDirection: 'column', gap: 4 },
  bucketHeader:  { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  bucketName:    { fontSize: 10, fontWeight: 700, color: 'rgba(96,165,250,0.6)', textTransform: 'uppercase', letterSpacing: '0.04em' },
  bucketCount:   { fontSize: 10, color: 'rgba(255,255,255,0.3)' },
  bucketStats:   { display: 'flex', gap: 12, flexWrap: 'wrap' },
  statCell:      { display: 'flex', flexDirection: 'column', gap: 1, minWidth: 52 },
  statLabel:     { fontSize: 8, color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', letterSpacing: '0.05em' },
  statValue:     { fontSize: 12, fontWeight: 600, fontVariantNumeric: 'tabular-nums' },

  hints:         { borderTop: '1px solid rgba(96,165,250,0.08)', paddingTop: 8 },
  hintLine:      { fontSize: 10, color: 'rgba(255,255,255,0.35)', lineHeight: 1.6 },

  note:          { fontSize: 9, color: 'rgba(255,255,255,0.2)', fontStyle: 'italic', borderTop: '1px solid rgba(255,255,255,0.04)', paddingTop: 8, lineHeight: 1.5 },
};
