// ── TradeDesk.tsx ─────────────────────────────────────────────────────────────
//
// Paper-trade planning screen. No live brokerage connectivity.
// Risk sizing: size = floor((balance * riskPct / 100) / |entry - stop|)
// Council review panel: structured verdict from math + rule checks before submit.

import React, { useState, useCallback } from 'react';

interface TradeForm {
  ticker: string;
  side: 'long' | 'short';
  thesis: string;
  entry: string;
  stop: string;
  target: string;
  riskPercent: string;
}

interface SizingResult {
  size: number;
  riskDollars: number;
  rewardDollars: number;
  rr: number;
  riskPct: number;
}

interface CouncilVerdict {
  approved: boolean;
  warnings: string[];
  notes: string[];
}

interface SubmittedTrade {
  tradeId: string;
  ticker: string;
  side: 'long' | 'short';
  entry: number;
  stop: number;
  target: number;
  size: number;
  riskPercent: number;
  timestamp: number;
}

const PAPER_BALANCE = 10_000; // default paper balance in dollars

function calcSizing(form: TradeForm): SizingResult | null {
  const entry = parseFloat(form.entry);
  const stop  = parseFloat(form.stop);
  const target = parseFloat(form.target);
  const riskPct = parseFloat(form.riskPercent);

  if (!entry || !stop || !target || !riskPct) return null;
  if (entry === stop) return null;

  const riskPerShare = Math.abs(entry - stop);
  const riskDollars  = PAPER_BALANCE * (riskPct / 100);
  const size         = Math.floor(riskDollars / riskPerShare);

  if (size <= 0) return null;

  const rewardPerShare = Math.abs(target - entry);
  const rewardDollars  = size * rewardPerShare;
  const rr             = rewardPerShare / riskPerShare;

  return { size, riskDollars, rewardDollars, rr, riskPct };
}

function runCouncilReview(form: TradeForm, sizing: SizingResult | null): CouncilVerdict {
  const warnings: string[] = [];
  const notes: string[]    = [];

  const entry  = parseFloat(form.entry);
  const stop   = parseFloat(form.stop);
  const target = parseFloat(form.target);
  const side   = form.side;

  // Rule: stop on correct side
  if (side === 'long'  && stop >= entry)  warnings.push('Stop is at or above entry — invalid for a long position.');
  if (side === 'short' && stop <= entry)  warnings.push('Stop is at or below entry — invalid for a short position.');

  // Rule: target on correct side
  if (side === 'long'  && target <= entry) warnings.push('Target is at or below entry — no upside for a long.');
  if (side === 'short' && target >= entry) warnings.push('Target is at or above entry — no downside for a short.');

  // Rule: R:R
  if (sizing && sizing.rr < 1.5) warnings.push(`R:R of ${sizing.rr.toFixed(2)} is below the 1.5 minimum. Consider tightening stop or widening target.`);

  // Rule: risk percent
  if (sizing && sizing.riskPct > 2) warnings.push(`Risk of ${sizing.riskPct}% exceeds the 2% per-trade guideline.`);
  if (sizing && sizing.riskPct < 0.25) notes.push('Risk below 0.25% — position may be too small to be meaningful.');

  // Rule: thesis
  if (!form.thesis.trim()) warnings.push('No thesis provided. A trade without a thesis is a gamble.');
  else if (form.thesis.trim().length < 20) notes.push('Thesis is brief — consider adding entry catalyst and invalidation.');

  // Rule: size
  if (sizing && sizing.size < 1) warnings.push('Position size rounds to 0 shares. Widen stop or increase risk percent.');

  // R:R notes
  if (sizing && sizing.rr >= 3) notes.push(`Strong R:R of ${sizing.rr.toFixed(2)}. Confirm target has a realistic catalyst.`);
  else if (sizing && sizing.rr >= 1.5) notes.push(`Acceptable R:R of ${sizing.rr.toFixed(2)}.`);

  return {
    approved: warnings.length === 0,
    warnings,
    notes,
  };
}

export function TradeDesk({ onBack }: { onBack: () => void }) {
  const [form, setForm] = useState<TradeForm>({
    ticker: '',
    side: 'long',
    thesis: '',
    entry: '',
    stop: '',
    target: '',
    riskPercent: '1',
  });
  const [reviewed, setReviewed]   = useState(false);
  const [verdict, setVerdict]     = useState<CouncilVerdict | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState<SubmittedTrade | null>(null);
  const [submitError, setSubmitError] = useState<string | null>(null);

  const sizing = calcSizing(form);

  const handleChange = useCallback((field: keyof TradeForm, value: string) => {
    setForm(f => ({ ...f, [field]: value }));
    setReviewed(false);
    setVerdict(null);
    setSubmitted(null);
    setSubmitError(null);
  }, []);

  const handleReview = () => {
    const v = runCouncilReview(form, sizing);
    setVerdict(v);
    setReviewed(true);
  };

  const handleSubmit = async () => {
    if (!sizing || !verdict) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const result = await window.triforge.wallet.paperTrade({
        ticker:      form.ticker.toUpperCase().trim(),
        side:        form.side,
        thesis:      form.thesis.trim(),
        entry:       parseFloat(form.entry),
        stop:        parseFloat(form.stop),
        target:      parseFloat(form.target),
        size:        sizing.size,
        riskPercent: sizing.riskPct,
        balance:     PAPER_BALANCE,
      });
      if (result.error) {
        setSubmitError(result.error);
      } else {
        setSubmitted({
          tradeId:     result.tradeId!,
          ticker:      form.ticker.toUpperCase().trim(),
          side:        form.side,
          entry:       parseFloat(form.entry),
          stop:        parseFloat(form.stop),
          target:      parseFloat(form.target),
          size:        sizing.size,
          riskPercent: sizing.riskPct,
          timestamp:   Date.now(),
        });
      }
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : String(err));
    } finally {
      setSubmitting(false);
    }
  };

  const handleReset = () => {
    setForm({ ticker: '', side: 'long', thesis: '', entry: '', stop: '', target: '', riskPercent: '1' });
    setReviewed(false);
    setVerdict(null);
    setSubmitted(null);
    setSubmitError(null);
  };

  return (
    <div style={s.page}>
      {/* Header */}
      <div style={s.header}>
        <button style={s.backBtn} onClick={onBack}>← Hustle</button>
        <div>
          <h1 style={s.title}>Trade Desk</h1>
          <span style={s.badge}>Paper Trading Only</span>
        </div>
        <div style={s.balanceChip}>
          <span style={s.balanceLabel}>Paper Balance</span>
          <span style={s.balanceValue}>${PAPER_BALANCE.toLocaleString()}</span>
        </div>
      </div>

      {submitted ? (
        <ConfirmationCard trade={submitted} onNewTrade={handleReset} />
      ) : (
        <div style={s.body}>
          {/* Trade form */}
          <div style={s.card}>
            <div style={s.cardTitle}>Trade Setup</div>

            <div style={s.row}>
              <Field label="Ticker">
                <input
                  style={s.input}
                  placeholder="AAPL"
                  value={form.ticker}
                  onChange={e => handleChange('ticker', e.target.value.toUpperCase())}
                />
              </Field>
              <Field label="Direction">
                <div style={s.segmented}>
                  {(['long', 'short'] as const).map(d => (
                    <button
                      key={d}
                      style={{ ...s.seg, ...(form.side === d ? (d === 'long' ? s.segActiveLong : s.segActiveShort) : {}) }}
                      onClick={() => handleChange('side', d)}
                    >
                      {d === 'long' ? '▲ Long' : '▼ Short'}
                    </button>
                  ))}
                </div>
              </Field>
              <Field label="Risk %">
                <input
                  style={{ ...s.input, width: 70 }}
                  type="number"
                  min="0.1"
                  max="5"
                  step="0.25"
                  value={form.riskPercent}
                  onChange={e => handleChange('riskPercent', e.target.value)}
                />
              </Field>
            </div>

            <div style={s.row}>
              <Field label="Entry">
                <input style={s.input} type="number" placeholder="0.00" value={form.entry} onChange={e => handleChange('entry', e.target.value)} />
              </Field>
              <Field label="Stop">
                <input style={s.input} type="number" placeholder="0.00" value={form.stop} onChange={e => handleChange('stop', e.target.value)} />
              </Field>
              <Field label="Target">
                <input style={s.input} type="number" placeholder="0.00" value={form.target} onChange={e => handleChange('target', e.target.value)} />
              </Field>
            </div>

            <Field label="Thesis">
              <textarea
                style={s.textarea}
                placeholder="Why are you taking this trade? Entry catalyst, structure, invalidation level..."
                value={form.thesis}
                rows={3}
                onChange={e => handleChange('thesis', e.target.value)}
              />
            </Field>
          </div>

          {/* Sizing panel */}
          {sizing && (
            <div style={s.card}>
              <div style={s.cardTitle}>Position Sizing</div>
              <div style={s.metricsRow}>
                <Metric label="Shares" value={sizing.size.toString()} />
                <Metric label="Risk $" value={`$${sizing.riskDollars.toFixed(2)}`} dim={sizing.riskPct > 2} />
                <Metric label="Reward $" value={`$${sizing.rewardDollars.toFixed(2)}`} />
                <Metric label="R:R" value={`${sizing.rr.toFixed(2)}:1`} highlight={sizing.rr >= 1.5} dim={sizing.rr < 1.5} />
              </div>
            </div>
          )}

          {/* Council review */}
          {reviewed && verdict && (
            <div style={{ ...s.card, borderColor: verdict.approved ? 'rgba(52,211,153,0.25)' : 'rgba(248,113,113,0.25)' }}>
              <div style={s.cardTitle}>
                Council Review
                <span style={{ ...s.verdictBadge, background: verdict.approved ? 'rgba(52,211,153,0.15)' : 'rgba(248,113,113,0.15)', color: verdict.approved ? '#34d399' : '#f87171' }}>
                  {verdict.approved ? 'APPROVED' : 'FLAGGED'}
                </span>
              </div>
              {verdict.warnings.map((w, i) => (
                <div key={i} style={s.warningRow}>
                  <span style={s.warningIcon}>⚠</span>
                  <span style={s.warningText}>{w}</span>
                </div>
              ))}
              {verdict.notes.map((n, i) => (
                <div key={i} style={s.noteRow}>
                  <span style={s.noteIcon}>◦</span>
                  <span style={s.noteText}>{n}</span>
                </div>
              ))}
            </div>
          )}

          {submitError && (
            <div style={s.errorBanner}>{submitError}</div>
          )}

          {/* Actions */}
          <div style={s.actions}>
            {!reviewed ? (
              <button
                style={{ ...s.btn, ...s.btnPrimary, opacity: (!sizing || !form.ticker.trim()) ? 0.4 : 1 }}
                disabled={!sizing || !form.ticker.trim()}
                onClick={handleReview}
              >
                Council Review
              </button>
            ) : (
              <>
                <button style={{ ...s.btn, ...s.btnGhost }} onClick={handleReview}>Re-review</button>
                <button
                  style={{ ...s.btn, ...s.btnPrimary, opacity: (!verdict?.approved || submitting) ? 0.4 : 1 }}
                  disabled={!verdict?.approved || submitting}
                  onClick={handleSubmit}
                >
                  {submitting ? 'Logging...' : 'Log Paper Trade'}
                </button>
              </>
            )}
            <button style={{ ...s.btn, ...s.btnGhost }} onClick={handleReset}>Reset</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Sub-components ────────────────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
      <span style={{ fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
      {children}
    </div>
  );
}

function Metric({ label, value, highlight, dim }: { label: string; value: string; highlight?: boolean; dim?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 80 }}>
      <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
      <span style={{ fontSize: 20, fontWeight: 700, color: highlight ? '#34d399' : dim ? '#f87171' : 'rgba(255,255,255,0.85)', fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  );
}

function ConfirmationCard({ trade, onNewTrade }: { trade: SubmittedTrade; onNewTrade: () => void }) {
  return (
    <div style={{ ...s.card, margin: '24px 0', borderColor: 'rgba(52,211,153,0.3)' }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: '#34d399', marginBottom: 12 }}>Trade Logged</div>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6, fontSize: 12, color: 'rgba(255,255,255,0.65)' }}>
        <div><b style={{ color: 'rgba(255,255,255,0.85)' }}>{trade.ticker}</b> — Paper {trade.side.toUpperCase()}</div>
        <div>Entry: {trade.entry} · Stop: {trade.stop} · Target: {trade.target}</div>
        <div>Size: {trade.size} shares · Risk: {trade.riskPercent.toFixed(1)}%</div>
        <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)', marginTop: 4 }}>ID: {trade.tradeId}</div>
      </div>
      <div style={{ marginTop: 16 }}>
        <button style={{ ...s.btn, ...s.btnPrimary }} onClick={onNewTrade}>New Trade</button>
      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  page: {
    display: 'flex',
    flexDirection: 'column',
    height: '100%',
    overflowY: 'auto',
    background: 'var(--bg, #0d0d0f)',
    color: 'rgba(255,255,255,0.85)',
    fontFamily: 'var(--font-mono, monospace)',
    padding: '0 24px 32px',
  },
  header: {
    display: 'flex',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    padding: '20px 0 16px',
    borderBottom: '1px solid rgba(255,255,255,0.06)',
    marginBottom: 20,
    gap: 12,
  },
  backBtn: {
    background: 'none',
    border: 'none',
    color: 'rgba(255,255,255,0.35)',
    fontSize: 11,
    cursor: 'pointer',
    padding: '4px 0',
    marginTop: 2,
  },
  title: {
    fontSize: 18,
    fontWeight: 700,
    margin: 0,
    color: 'rgba(255,255,255,0.9)',
  },
  badge: {
    display: 'inline-block',
    marginTop: 4,
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: '#fbbf24',
    background: 'rgba(251,191,36,0.1)',
    border: '1px solid rgba(251,191,36,0.2)',
    borderRadius: 4,
    padding: '2px 6px',
  },
  balanceChip: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'flex-end',
    gap: 2,
  },
  balanceLabel: {
    fontSize: 9,
    fontWeight: 600,
    textTransform: 'uppercase',
    letterSpacing: '0.06em',
    color: 'rgba(255,255,255,0.3)',
  },
  balanceValue: {
    fontSize: 16,
    fontWeight: 700,
    color: 'rgba(255,255,255,0.75)',
    fontVariantNumeric: 'tabular-nums',
  },
  body: {
    display: 'flex',
    flexDirection: 'column',
    gap: 16,
  },
  card: {
    background: 'rgba(255,255,255,0.03)',
    border: '1px solid rgba(255,255,255,0.07)',
    borderRadius: 10,
    padding: '16px 18px',
    display: 'flex',
    flexDirection: 'column',
    gap: 14,
  },
  cardTitle: {
    fontSize: 11,
    fontWeight: 700,
    textTransform: 'uppercase',
    letterSpacing: '0.07em',
    color: 'rgba(255,255,255,0.4)',
    display: 'flex',
    alignItems: 'center',
    gap: 10,
  },
  row: {
    display: 'flex',
    gap: 12,
    flexWrap: 'wrap',
  },
  input: {
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 6,
    color: 'rgba(255,255,255,0.85)',
    fontSize: 12,
    padding: '7px 10px',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
    fontFamily: 'inherit',
  },
  textarea: {
    background: 'rgba(255,255,255,0.05)',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 6,
    color: 'rgba(255,255,255,0.85)',
    fontSize: 12,
    padding: '7px 10px',
    outline: 'none',
    width: '100%',
    boxSizing: 'border-box',
    resize: 'vertical',
    fontFamily: 'inherit',
    lineHeight: 1.5,
  },
  segmented: {
    display: 'flex',
    border: '1px solid rgba(255,255,255,0.1)',
    borderRadius: 6,
    overflow: 'hidden',
  },
  seg: {
    flex: 1,
    background: 'none',
    border: 'none',
    color: 'rgba(255,255,255,0.4)',
    fontSize: 11,
    fontWeight: 600,
    padding: '7px 12px',
    cursor: 'pointer',
    fontFamily: 'inherit',
  },
  segActiveLong: {
    background: 'rgba(52,211,153,0.12)',
    color: '#34d399',
  },
  segActiveShort: {
    background: 'rgba(248,113,113,0.12)',
    color: '#f87171',
  },
  metricsRow: {
    display: 'flex',
    gap: 24,
    flexWrap: 'wrap',
  },
  verdictBadge: {
    fontSize: 9,
    fontWeight: 800,
    letterSpacing: '0.08em',
    padding: '2px 7px',
    borderRadius: 4,
  },
  warningRow: {
    display: 'flex',
    gap: 8,
    alignItems: 'flex-start',
  },
  warningIcon: { color: '#fbbf24', fontSize: 12, flexShrink: 0, paddingTop: 1 },
  warningText: { fontSize: 12, color: 'rgba(255,255,255,0.65)', lineHeight: 1.5 },
  noteRow: {
    display: 'flex',
    gap: 8,
    alignItems: 'flex-start',
  },
  noteIcon: { color: 'rgba(255,255,255,0.3)', fontSize: 12, flexShrink: 0, paddingTop: 1 },
  noteText: { fontSize: 12, color: 'rgba(255,255,255,0.4)', lineHeight: 1.5 },
  errorBanner: {
    background: 'rgba(248,113,113,0.1)',
    border: '1px solid rgba(248,113,113,0.2)',
    borderRadius: 6,
    padding: '10px 14px',
    fontSize: 12,
    color: '#f87171',
  },
  actions: {
    display: 'flex',
    gap: 10,
  },
  btn: {
    border: 'none',
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 700,
    padding: '9px 18px',
    cursor: 'pointer',
    fontFamily: 'inherit',
    transition: 'opacity 0.15s',
  },
  btnPrimary: {
    background: 'rgba(96,165,250,0.15)',
    border: '1px solid rgba(96,165,250,0.3)',
    color: '#60a5fa',
  },
  btnGhost: {
    background: 'rgba(255,255,255,0.04)',
    border: '1px solid rgba(255,255,255,0.1)',
    color: 'rgba(255,255,255,0.4)',
  },
};
