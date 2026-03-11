// ── ReviewedIntentsPanel.tsx ──────────────────────────────────────────────────
//
// Reviewed trade intents display for the level-to-level engine inspector.
// Shows council review outcomes, vote breakdowns, and intent details.
// Read-only. No engine imports — local type mirrors only.

import React, { useState } from 'react';

// ── Local type mirrors ───────────────────────────────────────────────────────

type ReviewOutcome = 'approved' | 'rejected' | 'error' | 'no_council';

interface IntentView {
  id: string; symbol: string; side: 'long' | 'short';
  entry: number; stop: number; target: number;
  setupGrade: string; confidence: number;
  reasons: string[]; risks: string[];
}

interface CouncilVoteView {
  provider: string; vote: string; confidence: number; reason: string;
}

interface ReviewedIntentView {
  intent: IntentView;
  outcome: ReviewOutcome;
  reviewedAt: number;
  reason: string;
  councilApproved?: boolean | null;
  councilVotes?: CouncilVoteView[] | null;
  executionSuccess?: boolean | null;
  executionRejectReason?: string | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const OUTCOME_CONFIG: Record<ReviewOutcome, { label: string; color: string; bg: string }> = {
  approved:   { label: 'APPROVED',   color: '#34d399', bg: 'rgba(52,211,153,0.08)' },
  rejected:   { label: 'REJECTED',   color: '#fbbf24', bg: 'rgba(251,191,36,0.08)' },
  error:      { label: 'ERROR',      color: '#f87171', bg: 'rgba(248,113,113,0.08)' },
  no_council: { label: 'NO COUNCIL', color: 'rgba(255,255,255,0.25)', bg: 'rgba(255,255,255,0.03)' },
};

function formatPrice(price: number): string {
  return price >= 1000
    ? price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : price.toFixed(2);
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString();
}

// ── Component ────────────────────────────────────────────────────────────────

export function ReviewedIntentsPanel({ reviewed }: { reviewed: ReviewedIntentView[] }) {
  if (!reviewed || reviewed.length === 0) {
    return (
      <div style={s.card}>
        <div style={s.cardTitle}>Reviewed Intents</div>
        <div style={s.empty}>No reviewed intents yet</div>
      </div>
    );
  }

  return (
    <div style={s.card}>
      <div style={s.cardTitle}>
        Reviewed Intents
        <span style={s.reviewCount}>{reviewed.length} total</span>
      </div>

      <div style={s.intentList}>
        {reviewed.map((item, idx) => (
          <IntentCard key={item.intent?.id ?? idx} item={item} />
        ))}
      </div>
    </div>
  );
}

function IntentCard({ item }: { item: ReviewedIntentView }) {
  const [expanded, setExpanded] = useState(false);
  const outcome = OUTCOME_CONFIG[item.outcome] ?? OUTCOME_CONFIG.error;
  const intent = item.intent;
  const sideColor = intent?.side === 'long' ? '#34d399' : '#f87171';
  const votes = item.councilVotes ?? [];

  return (
    <div style={{ ...s.intentCard, borderColor: `${outcome.color}33` }}>
      {/* Header row */}
      <div style={s.intentHeader}>
        <span style={{ ...s.outcomeBadge, color: outcome.color, background: outcome.bg, borderColor: `${outcome.color}40` }}>
          {outcome.label}
        </span>
        {intent && (
          <>
            <span style={{ ...s.sideBadge, color: sideColor }}>
              {intent.side === 'long' ? '\u25B2' : '\u25BC'} {intent.side.toUpperCase()}
            </span>
            <span style={s.intentSymbol}>{intent.symbol}</span>
          </>
        )}
        <span style={s.intentTime}>{formatTime(item.reviewedAt)}</span>
      </div>

      {/* Price levels */}
      {intent && (
        <div style={s.priceRow}>
          <span style={s.priceLabel}>Entry</span>
          <span style={s.priceValue}>{formatPrice(intent.entry)}</span>
          <span style={s.priceLabel}>Stop</span>
          <span style={{ ...s.priceValue, color: '#f87171' }}>{formatPrice(intent.stop)}</span>
          <span style={s.priceLabel}>Target</span>
          <span style={{ ...s.priceValue, color: '#34d399' }}>{formatPrice(intent.target)}</span>
          {intent.setupGrade && (
            <span style={s.gradeBadge}>{intent.setupGrade}</span>
          )}
        </div>
      )}

      {/* Reason */}
      <div style={s.reasonText}>{item.reason}</div>

      {/* Council votes */}
      {votes.length > 0 && (
        <div style={s.voteList}>
          {votes.map((vote, i) => {
            const voteColor = vote.vote === 'TAKE' ? '#34d399' : vote.vote === 'REJECT' ? '#f87171' : '#fbbf24';
            return (
              <div key={i} style={s.voteRow}>
                <span style={s.voteProvider}>{vote.provider}</span>
                <span style={{ ...s.voteBadge, color: voteColor }}>{vote.vote}</span>
                <span style={s.voteConf}>{vote.confidence}%</span>
                <span style={s.voteReason}>{vote.reason}</span>
              </div>
            );
          })}
        </div>
      )}

      {/* Expandable details */}
      {intent && (intent.reasons?.length > 0 || intent.risks?.length > 0) && (
        <>
          <button style={s.expandBtn} onClick={() => setExpanded(v => !v)}>
            {expanded ? 'Hide details' : 'Show details'}
          </button>
          {expanded && (
            <div style={s.detailsBox}>
              {intent.reasons.length > 0 && (
                <div>
                  <div style={s.detailLabel}>Reasons</div>
                  {intent.reasons.map((r, i) => (
                    <div key={i} style={s.detailItem}>{r}</div>
                  ))}
                </div>
              )}
              {intent.risks.length > 0 && (
                <div>
                  <div style={{ ...s.detailLabel, color: '#f87171' }}>Risks</div>
                  {intent.risks.map((r, i) => (
                    <div key={i} style={s.detailItem}>{r}</div>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  card:          { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 10 },
  cardTitle:     { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'rgba(255,255,255,0.35)', display: 'flex', alignItems: 'center', gap: 8 },
  reviewCount:   { fontSize: 9, color: 'rgba(255,255,255,0.2)', marginLeft: 'auto', fontWeight: 400, textTransform: 'none', letterSpacing: 0 },
  empty:         { fontSize: 11, color: 'rgba(255,255,255,0.25)', fontStyle: 'italic', padding: '8px 0' },

  intentList:    { display: 'flex', flexDirection: 'column', gap: 8 },
  intentCard:    { background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 6, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 6 },
  intentHeader:  { display: 'flex', alignItems: 'center', gap: 8 },
  outcomeBadge:  { fontSize: 8, fontWeight: 800, letterSpacing: '0.08em', border: '1px solid', borderRadius: 3, padding: '1px 5px' },
  sideBadge:     { fontSize: 10, fontWeight: 700 },
  intentSymbol:  { fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.7)' },
  intentTime:    { fontSize: 9, color: 'rgba(255,255,255,0.2)', marginLeft: 'auto' },

  priceRow:      { display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  priceLabel:    { fontSize: 9, color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', letterSpacing: '0.04em' },
  priceValue:    { fontSize: 11, fontWeight: 600, color: 'rgba(255,255,255,0.6)', fontVariantNumeric: 'tabular-nums' },
  gradeBadge:    { fontSize: 9, fontWeight: 800, color: '#60a5fa', border: '1px solid rgba(96,165,250,0.3)', borderRadius: 3, padding: '0 4px', marginLeft: 'auto' },

  reasonText:    { fontSize: 10, color: 'rgba(255,255,255,0.4)', lineHeight: 1.4 },

  voteList:      { display: 'flex', flexDirection: 'column', gap: 3, background: 'rgba(255,255,255,0.02)', borderRadius: 4, padding: '6px 8px' },
  voteRow:       { display: 'flex', alignItems: 'center', gap: 6, fontSize: 10 },
  voteProvider:  { fontWeight: 600, color: 'rgba(255,255,255,0.5)', minWidth: 50, flexShrink: 0 },
  voteBadge:     { fontWeight: 700, fontSize: 9, minWidth: 40 },
  voteConf:      { color: 'rgba(255,255,255,0.3)', fontSize: 9, fontVariantNumeric: 'tabular-nums' },
  voteReason:    { color: 'rgba(255,255,255,0.35)', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' },

  expandBtn:     { background: 'none', border: 'none', color: 'rgba(255,255,255,0.2)', fontSize: 10, cursor: 'pointer', padding: '2px 0', textAlign: 'left', fontFamily: 'inherit' },
  detailsBox:    { display: 'flex', flexDirection: 'column', gap: 6, padding: '6px 0' },
  detailLabel:   { fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 2 },
  detailItem:    { fontSize: 10, color: 'rgba(255,255,255,0.35)', lineHeight: 1.4, paddingLeft: 8 },
};
