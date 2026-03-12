// ── main/trading/learning/TradeJournalStore.ts ──────────────────────────────────
//
// JSONL append-friendly persistence for completed shadow trades.
// One JSON object per line — simple, crash-resilient, easy to inspect.
//
// File location: userData/triforge-trade-journal.jsonl
//
// Features:
//   - Exactly-once journaling per tradeId (in-memory dedup set)
//   - Capped retention (max 500 entries, oldest trimmed)
//   - Atomic trim via .tmp rename
//   - Rich context: levels, scores, regime, news, council
//
// SIMULATION ONLY. No real brokerage orders.

import { app } from 'electron';
import * as fs from 'fs';
import * as path from 'path';
import type {
  JournalEntry, LevelType, ConfirmationType, TradeScoreBand,
} from '@triforge/engine';
import type { SessionRegime } from './SessionRegimeMemory';

// ── Council Consensus Patterns ──────────────────────────────────────────────

export type CouncilConsensusPattern =
  | 'unanimous_take'     // All seats voted TAKE
  | 'majority_take'      // 2/3 voted TAKE (no veto)
  | 'split_approval'     // Approved but with WAIT votes
  | 'grok_veto'          // Grok used REJECT (trade blocked)
  | 'low_confidence'     // Blocked due to low average confidence
  | 'insufficient_votes' // Too few TAKE votes
  | 'no_council';        // Council was not available

// ── Extended Journal Entry ──────────────────────────────────────────────────
// Extends the engine's JournalEntry with additional simulator context.

export interface ExtendedJournalEntry extends JournalEntry {
  /** Entry level quality score. */
  entryLevelQuality: number;
  /** Destination level type. */
  destinationLevelType: string;
  /** Destination level quality score. */
  destinationLevelQuality: number;
  /** Route quality score. */
  routeQualityScore: number;
  /** Route obstacle count. */
  routeObstacleCount: number;
  /** Entry price. */
  entryPrice: number;
  /** Stop price. */
  stopPrice: number;
  /** Target price. */
  targetPrice: number;
  /** Exit price. */
  exitPrice: number;
  /** Risk/reward ratio at entry. */
  riskRewardRatio: number;
  /** Session regime at time of trade. */
  sessionRegime: SessionRegime | null;
  /** News risk flags active at time of trade. */
  newsFlags: string[];
  /** News score adjustment applied. */
  newsScoreAdjustment: number;
  /** Council votes summary (if available). */
  councilVotes: Array<{
    provider: string;
    vote: string;
    confidence: number;
    reason: string;
  }> | null;
  /** Whether the council approved. */
  councilApproved: boolean;
  /** Whether Grok used its veto (REJECT vote). */
  grokVetoed: boolean;
  /** Council blocked reason code (e.g. 'grok_veto', 'low_confidence'). */
  councilBlockedCode: string | null;
  /** Council consensus pattern for analytics bucketing. */
  councilConsensusPattern: CouncilConsensusPattern | null;
  /** Average confidence across all council seats. */
  councilAvgConfidence: number;
  /** Advisory additional targets (T2, T3 prices) at time of entry. */
  additionalTargets: number[];
  /** Final trade score breakdown. */
  scoreBreakdown: {
    final: number;
    level: number;
    route: number;
    confirmation: number;
    session: number;
    rr: number;
  } | null;
  /** Setup family classification (from reliability engine). */
  setupFamily?: string | null;
  /** Setup quality score 0-100 (from reliability engine). */
  setupQualityScore?: number | null;
  /** Setup quality band (from reliability engine). */
  setupQualityBand?: string | null;
  /** Regime compatibility at time of trade. */
  regimeCompatibility?: string | null;
}

// ── Constants ───────────────────────────────────────────────────────────────

const JOURNAL_FILENAME = 'triforge-trade-journal.jsonl';
const MAX_ENTRIES = 500;
const SIZE_CHECK_THRESHOLD = 500_000; // Check trim after 500KB

// ── Store ───────────────────────────────────────────────────────────────────

export class TradeJournalStore {
  /** In-memory dedup set — tracks journaled trade IDs for exactly-once writes. */
  private readonly _journaledIds = new Set<string>();
  private _initialized = false;

  // ── Initialization ────────────────────────────────────────────────────

  /**
   * Load existing trade IDs from disk for dedup.
   * Called lazily on first access.
   */
  private _ensureInitialized(): void {
    if (this._initialized) return;
    this._initialized = true;

    const entries = this.loadAll();
    for (const entry of entries) {
      this._journaledIds.add(entry.tradeId);
    }
  }

  // ── Write ─────────────────────────────────────────────────────────────

  /**
   * Append a journal entry. Skips silently if the tradeId has already
   * been journaled (exactly-once guarantee).
   *
   * @returns true if the entry was written, false if it was a duplicate.
   */
  append(entry: ExtendedJournalEntry): boolean {
    this._ensureInitialized();

    if (this._journaledIds.has(entry.tradeId)) {
      return false; // Already journaled — skip
    }

    this._journaledIds.add(entry.tradeId);

    try {
      const line = JSON.stringify(entry) + '\n';
      fs.appendFileSync(this._filePath(), line, 'utf8');
      this._trimIfNeeded();
    } catch {
      // Write failure — entry is lost but app continues
    }

    return true;
  }

  // ── Read ──────────────────────────────────────────────────────────────

  /**
   * Load all journal entries from disk.
   * Returns empty array if the file does not exist or is corrupt.
   */
  loadAll(): ExtendedJournalEntry[] {
    const filePath = this._filePath();
    if (!fs.existsSync(filePath)) return [];

    try {
      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n').filter(Boolean);
      const entries: ExtendedJournalEntry[] = [];

      for (const line of lines) {
        try {
          entries.push(JSON.parse(line) as ExtendedJournalEntry);
        } catch {
          // Skip corrupt lines
        }
      }

      return entries;
    } catch {
      return [];
    }
  }

  /**
   * Query journal entries with optional filters.
   *
   * @param opts.symbol   - Filter by symbol
   * @param opts.since    - Only entries created after this timestamp
   * @param opts.limit    - Max entries to return (default 100)
   * @param opts.outcome  - Filter by outcome (win/loss/breakeven)
   */
  query(opts?: {
    symbol?: string;
    since?: number;
    limit?: number;
    outcome?: 'win' | 'loss' | 'breakeven';
  }): ExtendedJournalEntry[] {
    let entries = this.loadAll();

    if (opts?.symbol) {
      entries = entries.filter(e => e.symbol === opts.symbol);
    }
    if (opts?.since) {
      entries = entries.filter(e => e.createdAt >= opts.since!);
    }
    if (opts?.outcome) {
      entries = entries.filter(e => e.outcome === opts.outcome);
    }

    // Most recent first
    entries.sort((a, b) => b.createdAt - a.createdAt);

    const limit = opts?.limit ?? 100;
    return entries.slice(0, limit);
  }

  /**
   * Get the total number of journal entries.
   */
  get entryCount(): number {
    this._ensureInitialized();
    return this._journaledIds.size;
  }

  /**
   * Check if a trade has already been journaled.
   */
  hasEntry(tradeId: string): boolean {
    this._ensureInitialized();
    return this._journaledIds.has(tradeId);
  }

  /**
   * Clear all journal data. Used for testing or manual reset.
   */
  clear(): void {
    try {
      const filePath = this._filePath();
      if (fs.existsSync(filePath)) {
        fs.unlinkSync(filePath);
      }
    } catch {
      // Ignore
    }
    this._journaledIds.clear();
  }

  // ── Private ───────────────────────────────────────────────────────────

  private _filePath(): string {
    return path.join(app.getPath('userData'), JOURNAL_FILENAME);
  }

  /**
   * Trim journal to MAX_ENTRIES if file is large.
   * Uses atomic .tmp rename to avoid data corruption.
   */
  private _trimIfNeeded(): void {
    const filePath = this._filePath();
    try {
      const stat = fs.statSync(filePath);
      if (stat.size < SIZE_CHECK_THRESHOLD) return;

      const content = fs.readFileSync(filePath, 'utf8');
      const lines = content.split('\n').filter(Boolean);

      if (lines.length > MAX_ENTRIES) {
        const trimmed = lines.slice(lines.length - MAX_ENTRIES);
        const tmpPath = filePath + '.tmp';
        fs.writeFileSync(tmpPath, trimmed.join('\n') + '\n', 'utf8');
        fs.renameSync(tmpPath, filePath);

        // Rebuild dedup set from trimmed data
        this._journaledIds.clear();
        for (const line of trimmed) {
          try {
            const entry = JSON.parse(line) as ExtendedJournalEntry;
            this._journaledIds.add(entry.tradeId);
          } catch {
            // Skip
          }
        }
      }
    } catch {
      // Trim failure is non-fatal
    }
  }
}
