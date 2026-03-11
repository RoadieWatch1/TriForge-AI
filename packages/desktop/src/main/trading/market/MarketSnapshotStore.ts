// ── main/trading/market/MarketSnapshotStore.ts ────────────────────────────────
//
// Maintains a rolling window of recent market snapshots and tracks
// previous-day and overnight price levels for the level map engine.
//
// These derived levels (prev-day H/L/C, overnight H/L) are not available from
// a single Tradovate snapshot — they must be computed from historical bar data.

import type { OhlcBar } from '../tradovateClient';

// ── Types ───────────────────────────────────────────────────────────────────

export interface PrevDayLevels {
  high?: number;
  low?: number;
  close?: number;
}

export interface OvernightLevels {
  high?: number;
  low?: number;
}

interface SnapshotEntry {
  price: number;
  timestamp: number;
}

// ── Store ───────────────────────────────────────────────────────────────────

export class MarketSnapshotStore {
  private _snapshots: SnapshotEntry[] = [];
  private _maxWindowMs = 60_000; // 60-second rolling window
  private _prevDay: PrevDayLevels = {};
  private _overnight: OvernightLevels = {};
  private _lastComputeKey = '';

  /** Record a new price tick. */
  recordTick(price: number, timestamp: number): void {
    this._snapshots.push({ price, timestamp });
    // Trim entries older than the window
    const cutoff = timestamp - this._maxWindowMs;
    while (this._snapshots.length > 0 && this._snapshots[0].timestamp < cutoff) {
      this._snapshots.shift();
    }
  }

  /** Get the rolling snapshot window. */
  getRecentSnapshots(): SnapshotEntry[] {
    return [...this._snapshots];
  }

  /** Get previous-day levels. */
  getPrevDayLevels(): PrevDayLevels {
    return { ...this._prevDay };
  }

  /** Get overnight (globex) levels. */
  getOvernightLevels(): OvernightLevels {
    return { ...this._overnight };
  }

  /**
   * Compute prev-day and overnight levels from historical 1m bars.
   * Should be called when historical bars are loaded or refreshed.
   *
   * @param bars1m - Sorted array of 1-minute OHLC bars
   * @param todayDateKey - Today's date key in YYYY-MM-DD format (ET)
   * @param rthStartMinET - RTH start in minutes since midnight ET (default 570 = 09:30)
   */
  computeFromHistory(
    bars1m: OhlcBar[],
    todayDateKey: string,
    rthStartMinET = 570,
  ): void {
    // Avoid recomputation if already done for the same date
    if (this._lastComputeKey === todayDateKey && this._prevDay.high != null) return;
    this._lastComputeKey = todayDateKey;

    const prevDayBars: OhlcBar[] = [];
    const overnightBars: OhlcBar[] = [];

    for (const bar of bars1m) {
      const d = new Date(bar.timestamp);
      const dateKey = _getDateKeyET(d);
      const minET = _getMinutesSinceMidnightET(d);

      if (dateKey < todayDateKey) {
        // Previous trading day(s)
        prevDayBars.push(bar);
      } else if (dateKey === todayDateKey && minET < rthStartMinET) {
        // Today's overnight/premarket session
        overnightBars.push(bar);
      }
    }

    // Previous day levels — from the most recent prior date
    if (prevDayBars.length > 0) {
      // Only use the last trading day (not all prior bars)
      const lastDate = _getDateKeyET(new Date(prevDayBars[prevDayBars.length - 1].timestamp));
      const lastDayBars = prevDayBars.filter(b => _getDateKeyET(new Date(b.timestamp)) === lastDate);

      this._prevDay = {
        high:  Math.max(...lastDayBars.map(b => b.high)),
        low:   Math.min(...lastDayBars.map(b => b.low)),
        close: lastDayBars[lastDayBars.length - 1].close,
      };
    }

    // Overnight levels — today's pre-RTH session
    if (overnightBars.length > 0) {
      this._overnight = {
        high: Math.max(...overnightBars.map(b => b.high)),
        low:  Math.min(...overnightBars.map(b => b.low)),
      };
    }
  }

  /** Reset all stored data. */
  reset(): void {
    this._snapshots = [];
    this._prevDay = {};
    this._overnight = {};
    this._lastComputeKey = '';
  }
}

// ── Timezone Helpers ────────────────────────────────────────────────────────

function _getDateKeyET(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/New_York' }).format(d);
}

function _getMinutesSinceMidnightET(d: Date): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/New_York',
    hour: 'numeric', minute: 'numeric', hour12: false,
  }).formatToParts(d);
  const h = Number(parts.find(p => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find(p => p.type === 'minute')?.value ?? 0);
  return h * 60 + m;
}
