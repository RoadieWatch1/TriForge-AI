// ── main/trading/decision/TradeBlockReason.ts ─────────────────────────────────
//
// Runtime catalog of trade block reasons. Each reason has a machine-safe id
// (matching the LevelBlockReason union from shared types where applicable)
// and a concise, operator-friendly human-readable description suitable for
// UI display and journal logging.
//
// The catalog extends beyond the shared type's 13 reasons to cover
// risk-model and decision-engine blocks. All ids are unique strings.

// ── Block Reason Entry ────────────────────────────────────────────────────────

export interface BlockReasonEntry {
  /** Machine-safe identifier. */
  id: string;
  /** Short operator-friendly description for UI. */
  description: string;
  /** Which subsystem generated this block. */
  source: 'level_engine' | 'risk_model' | 'decision_engine' | 'session';
}

// ── Catalog ───────────────────────────────────────────────────────────────────

const BLOCK_REASONS: BlockReasonEntry[] = [
  // Level engine blocks (match LEVEL_BLOCK_REASONS from shared types)
  { id: 'no_levels_detected',    description: 'No decision levels detected in the current map.',               source: 'level_engine' },
  { id: 'no_valid_route',        description: 'No valid route to a quality destination level.',                source: 'level_engine' },
  { id: 'path_unclear',          description: 'Directional bias is ambiguous — no clear path predicted.',      source: 'level_engine' },
  { id: 'destination_too_close', description: 'Destination level is too close for a meaningful move.',         source: 'level_engine' },
  { id: 'insufficient_rr',       description: 'Risk-reward ratio is below the 1.5 minimum threshold.',        source: 'level_engine' },
  { id: 'level_degraded',        description: 'Entry level quality has degraded below the 50-point minimum.', source: 'level_engine' },
  { id: 'session_closed',        description: 'Trading session has ended — no new entries after 12:00 CT.',    source: 'session' },
  { id: 'news_buffer_active',    description: 'Within a high-impact news event buffer window.',                source: 'session' },
  { id: 'feed_stale',            description: 'Market data feed is stale (>5 seconds since last tick).',       source: 'decision_engine' },
  { id: 'confirmation_rejected', description: 'Level confirmation score was below the 65-point threshold.',    source: 'level_engine' },
  { id: 'mid_range_no_level',    description: 'Price is in mid-range with no nearby decision level.',          source: 'level_engine' },
  { id: 'stop_too_wide',         description: 'Calculated stop distance exceeds the maximum allowed width.',   source: 'risk_model' },
  { id: 'score_below_threshold', description: 'Final trade score is below the 65-point no-trade threshold.',   source: 'decision_engine' },

  // Risk model blocks
  { id: 'max_daily_loss_hit',           description: 'Daily loss limit has been reached.',                     source: 'risk_model' },
  { id: 'max_trades_hit',               description: 'Maximum trades per session has been reached.',           source: 'risk_model' },
  { id: 'max_consecutive_losses_hit',   description: 'Maximum consecutive losses reached — session paused.',   source: 'risk_model' },
  { id: 'max_concurrent_positions_hit', description: 'Maximum concurrent open positions reached.',             source: 'risk_model' },
  { id: 'outside_session_window',       description: 'Outside the active trading window (8:30–12:00 CT).',    source: 'session' },
  { id: 'mid_range_no_trade',           description: 'Price is mid-range with no structural justification.',   source: 'decision_engine' },
  { id: 'invalid_market_data',          description: 'Market data is missing or invalid.',                     source: 'decision_engine' },
  { id: 'risk_model_blocked',           description: 'Trade blocked by the risk management model.',            source: 'risk_model' },
  { id: 'route_quality_too_low',        description: 'Route quality score is too low for a trade.',            source: 'decision_engine' },
  { id: 'confirmation_too_weak',        description: 'Confirmation evidence is insufficient for entry.',       source: 'decision_engine' },
];

// ── Index for fast lookup ─────────────────────────────────────────────────────

const _byId = new Map<string, BlockReasonEntry>();
for (const entry of BLOCK_REASONS) {
  _byId.set(entry.id, entry);
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Get the human-readable description for a block reason id.
 * Returns a generic message if the id is not in the catalog.
 */
export function getBlockDescription(id: string): string {
  return _byId.get(id)?.description ?? `Trade blocked: ${id}`;
}

/**
 * Get the full BlockReasonEntry for a block reason id.
 */
export function getBlockReason(id: string): BlockReasonEntry | undefined {
  return _byId.get(id);
}

/**
 * Get all registered block reasons.
 */
export function getAllBlockReasons(): BlockReasonEntry[] {
  return [...BLOCK_REASONS];
}

/**
 * Build a concise block summary from multiple block reason ids.
 * Returns a single string with all reasons separated by "; ".
 */
export function formatBlockSummary(ids: string[]): string {
  if (ids.length === 0) return 'No block reasons.';
  return ids.map(id => getBlockDescription(id)).join('; ');
}
