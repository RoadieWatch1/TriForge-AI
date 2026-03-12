// ── renderer/components/trading/CouncilDecisionPanel.tsx ─────────────────────
//
// Per-seat council decision display: Structure/Route, Risk/Discipline,
// Counter-Case/Trap. Shows vote, confidence, reason, and final outcome.
//
// Props-driven — no direct IPC calls. Local type mirrors only.

import React from 'react';

// ── Local Type Mirrors ──────────────────────────────────────────────────────

interface CouncilVoteView {
  provider: string;
  vote: string;
  confidence: number;
  reason: string;
}

interface ReviewedIntentView {
  intent: {
    id: string;
    symbol: string;
    side: 'long' | 'short';
    entry: number;
    stop: number;
    target: number;
    setupGrade?: string;
    confidence?: string;
  };
  outcome: 'approved' | 'rejected' | 'error' | 'no_council';
  reviewedAt: number;
  reason: string;
  councilApproved?: boolean | null;
  councilVotes?: CouncilVoteView[] | null;
  councilBlockedReason?: string | null;
}

interface CouncilDecisionPanelProps {
  reviewed: ReviewedIntentView[];
}

// ── Provider → Seat Mapping ─────────────────────────────────────────────────

const SEAT_CONFIG: Record<string, { seat: string; role: string; color: string; bg: string; border: string }> = {
  openai:    { seat: 'Structure / Route',     role: 'Route planning, level-to-level logic, target selection',     color: '#34d399', bg: 'rgba(52,211,153,0.06)',    border: 'rgba(52,211,153,0.15)' },
  claude:    { seat: 'Risk / Discipline',     role: 'Risk validation, R:R enforcement, session discipline',       color: '#60a5fa', bg: 'rgba(96,165,250,0.06)',    border: 'rgba(96,165,250,0.15)' },
  grok:      { seat: 'Counter-Case / Trap',   role: 'Alternate path testing, trap detection, false breakout risk', color: '#c084fc', bg: 'rgba(192,132,252,0.06)',   border: 'rgba(192,132,252,0.15)' },
};

const DEFAULT_SEAT = { seat: 'Council Seat', role: '', color: 'rgba(255,255,255,0.5)', bg: 'rgba(255,255,255,0.03)', border: 'rgba(255,255,255,0.08)' };

// ── Component ───────────────────────────────────────────────────────────────

export function CouncilDecisionPanel({ reviewed }: CouncilDecisionPanelProps) {
  if (reviewed.length === 0) {
    return (
      <div style={p.card}>
        <div style={p.cardTitle}>COUNCIL DECISIONS</div>
        <div style={p.empty}>No council decisions yet. Reviewed trade intents will appear here.</div>
      </div>
    );
  }

  return (
    <div style={p.card}>
      <div style={p.cardTitle}>COUNCIL DECISIONS ({reviewed.length})</div>
      {reviewed.map((r, idx) => (
        <ReviewCard key={r.intent.id + idx} review={r} />
      ))}
    </div>
  );
}

// ── Review Card ─────────────────────────────────────────────────────────────

function ReviewCard({ review }: { review: ReviewedIntentView }) {
  const intent = review.intent;
  const votes = review.councilVotes ?? [];
  const oCfg = OUTCOME_STYLE[review.outcome] ?? OUTCOME_STYLE.error;

  return (
    <div style={p.reviewCard}>
      {/* Header */}
      <div style={p.reviewHeader}>
        <span style={p.reviewSymbol}>{intent.symbol}</span>
        <span style={{ ...p.reviewSide, color: intent.side === 'long' ? '#34d399' : '#f87171' }}>
          {intent.side === 'long' ? 'LONG' : 'SHORT'}
        </span>
        <span style={p.reviewPrices}>
          {intent.entry.toFixed(2)} → {intent.target.toFixed(2)}
        </span>
        <span style={{ ...p.reviewOutcome, color: oCfg.color, background: oCfg.bg, borderColor: oCfg.border }}>
          {review.outcome === 'no_council' ? 'NO COUNCIL' : review.outcome.toUpperCase()}
        </span>
        <span style={p.reviewTime}>{formatTime(review.reviewedAt)}</span>
      </div>

      {/* Council Votes */}
      {votes.length > 0 && (
        <div style={p.votesGrid}>
          {votes.map((v, i) => {
            const seatCfg = SEAT_CONFIG[v.provider.toLowerCase()] ?? DEFAULT_SEAT;
            const voteCfg = VOTE_STYLE[v.vote] ?? VOTE_STYLE.WAIT;
            return (
              <div key={i} style={{ ...p.seatCard, background: seatCfg.bg, borderColor: seatCfg.border }}>
                <div style={p.seatHeader}>
                  <span style={{ ...p.seatName, color: seatCfg.color }}>{seatCfg.seat}</span>
                  <span style={{ ...p.voteBadge, color: voteCfg.color, background: voteCfg.bg, borderColor: voteCfg.border }}>
                    {v.vote}
                  </span>
                  <span style={p.seatConfidence}>{v.confidence}%</span>
                </div>
                {v.reason && (
                  <div style={p.seatReason}>{v.reason}</div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* No council votes */}
      {votes.length === 0 && review.outcome === 'no_council' && (
        <div style={p.noCouncilNote}>Council review was not available for this intent.</div>
      )}

      {/* Blocked reason */}
      {review.councilBlockedReason && (
        <div style={p.blockedReason}>
          Blocked: {review.councilBlockedReason}
        </div>
      )}

      {/* Outcome reason */}
      {review.reason && (
        <div style={p.outcomeReason}>{review.reason}</div>
      )}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

const VOTE_STYLE: Record<string, { color: string; bg: string; border: string }> = {
  TAKE:   { color: '#34d399', bg: 'rgba(52,211,153,0.1)',    border: 'rgba(52,211,153,0.3)' },
  WAIT:   { color: '#fbbf24', bg: 'rgba(251,191,36,0.1)',    border: 'rgba(251,191,36,0.3)' },
  REJECT: { color: '#f87171', bg: 'rgba(248,113,113,0.1)',   border: 'rgba(248,113,113,0.3)' },
};

const OUTCOME_STYLE: Record<string, { color: string; bg: string; border: string }> = {
  approved:   { color: '#34d399', bg: 'rgba(52,211,153,0.1)',    border: 'rgba(52,211,153,0.3)' },
  rejected:   { color: '#fbbf24', bg: 'rgba(251,191,36,0.1)',    border: 'rgba(251,191,36,0.3)' },
  error:      { color: '#f87171', bg: 'rgba(248,113,113,0.1)',   border: 'rgba(248,113,113,0.3)' },
  no_council: { color: 'rgba(255,255,255,0.4)', bg: 'rgba(255,255,255,0.04)', border: 'rgba(255,255,255,0.12)' },
};

// ── Styles ──────────────────────────────────────────────────────────────────

const p: Record<string, React.CSSProperties> = {
  card:             { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 10, padding: '16px 18px', display: 'flex', flexDirection: 'column', gap: 12 },
  cardTitle:        { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'rgba(255,255,255,0.35)' },
  empty:            { fontSize: 12, color: 'rgba(255,255,255,0.3)', fontStyle: 'italic', padding: '8px 0' },

  // Review card
  reviewCard:       { display: 'flex', flexDirection: 'column', gap: 8, borderBottom: '1px solid rgba(255,255,255,0.05)', paddingBottom: 12 },
  reviewHeader:     { display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
  reviewSymbol:     { fontSize: 13, fontWeight: 800, color: 'rgba(255,255,255,0.85)' },
  reviewSide:       { fontSize: 10, fontWeight: 800, letterSpacing: '0.04em' },
  reviewPrices:     { fontSize: 10, color: 'rgba(255,255,255,0.4)', fontVariantNumeric: 'tabular-nums' },
  reviewOutcome:    { fontSize: 9, fontWeight: 800, letterSpacing: '0.06em', border: '1px solid', borderRadius: 3, padding: '1px 6px', flexShrink: 0, marginLeft: 'auto' },
  reviewTime:       { fontSize: 9, color: 'rgba(255,255,255,0.2)' },

  // Votes grid
  votesGrid:        { display: 'flex', flexDirection: 'column', gap: 6 },
  seatCard:         { border: '1px solid', borderRadius: 6, padding: '10px 12px', display: 'flex', flexDirection: 'column', gap: 4 },
  seatHeader:       { display: 'flex', alignItems: 'center', gap: 8 },
  seatName:         { fontSize: 10, fontWeight: 700, letterSpacing: '0.04em' },
  voteBadge:        { fontSize: 9, fontWeight: 800, letterSpacing: '0.06em', border: '1px solid', borderRadius: 3, padding: '1px 6px', flexShrink: 0 },
  seatConfidence:   { fontSize: 10, color: 'rgba(255,255,255,0.35)', fontVariantNumeric: 'tabular-nums', marginLeft: 'auto' },
  seatReason:       { fontSize: 10, color: 'rgba(255,255,255,0.5)', lineHeight: 1.5 },

  // States
  noCouncilNote:    { fontSize: 10, color: 'rgba(255,255,255,0.25)', fontStyle: 'italic' },
  blockedReason:    { fontSize: 10, color: '#f87171', background: 'rgba(248,113,113,0.05)', border: '1px solid rgba(248,113,113,0.12)', borderRadius: 4, padding: '6px 10px' },
  outcomeReason:    { fontSize: 10, color: 'rgba(255,255,255,0.4)', fontStyle: 'italic' },
};
