// ── main/trading/watch/LevelWatchScheduler.ts ─────────────────────────────────
//
// Manages the lifecycle of WatchAlert objects. Each tick, the scheduler:
//
//   1. Creates new watches from the current path prediction's route
//      destinations (if not already watched).
//   2. Updates existing watches through the state machine based on
//      current price and bar data.
//   3. Runs the ConfirmationEngine on watches in "confirming" state.
//   4. Removes terminal (confirmed/rejected) watches after they've been
//      consumed by the decision engine.
//   5. Prunes stale watches whose levels are broken or whose routes
//      are no longer valid.
//
// Concurrency cap: maximum 4 active watches at any time (2 above + 2 below
// current price). This keeps the engine focused and prevents attention
// scatter in choppy conditions.
//
// The scheduler is stateful — it maintains watches across ticks. It is
// owned by TriForgeShadowSimulator and reset when the simulator resets.

import type {
  WatchAlert, WatchState, PriceLevel, Route, PathPrediction,
  NormalizedMarketData, RouteDirection,
} from '@triforge/engine';
import {
  isTerminal, isActive,
  transitionToWatching, transitionToConfirming,
  transitionToConfirmed, transitionToRejected,
  isInApproachRange, isTouchingLevel, hasBlownThrough,
  isConfirmationWindowExpired,
  CONFIRMATION_WINDOW_MS,
  type WatchUpdate,
} from './LevelWatchState';
import { evaluateConfirmation, type ConfirmationContext } from './ConfirmationEngine';
import { scoreConfirmation, isConfirmed } from './ConfirmationSignals';

// ── Configuration ─────────────────────────────────────────────────────────────

export interface WatchSchedulerConfig {
  /** Maximum concurrent active watches. Default 4. */
  maxConcurrentWatches: number;
  /** Approach range multiplier vs ATR. Default 1.5. */
  approachRangeAtrMult: number;
  /** Touch range multiplier vs ATR. Default 0.2. */
  touchRangeAtrMult: number;
  /** Break-through distance multiplier vs ATR. Default 0.5. */
  breakDistanceAtrMult: number;
  /** Confirmation window duration in ms. Default 25 min. */
  confirmationWindowMs: number;
  /** Maximum age for a watch before it is pruned (ms). Default 60 min. */
  maxWatchAgeMs: number;
}

const DEFAULT_CONFIG: WatchSchedulerConfig = {
  maxConcurrentWatches: 4,
  approachRangeAtrMult: 1.5,
  touchRangeAtrMult: 0.2,
  breakDistanceAtrMult: 0.5,
  confirmationWindowMs: CONFIRMATION_WINDOW_MS,
  maxWatchAgeMs: 60 * 60_000,
};

// ── ID Generator ──────────────────────────────────────────────────────────────

let _idCounter = 0;
function _nextWatchId(): string {
  return `watch_${Date.now()}_${++_idCounter}`;
}

// ── Scheduler ─────────────────────────────────────────────────────────────────

export class LevelWatchScheduler {
  private _watches: WatchAlert[] = [];
  private _config: WatchSchedulerConfig;

  constructor(config?: Partial<WatchSchedulerConfig>) {
    this._config = { ...DEFAULT_CONFIG, ...config };
  }

  // ── Tick Entry Point ──────────────────────────────────────────────────────

  /**
   * Run one scheduler tick. Call this every eval interval.
   *
   * @param prediction - Current path prediction (may be null if no route)
   * @param data       - Current normalized market data
   * @returns Object with confirmed watches ready for the decision engine,
   *          and all active watches for UI/diagnostics.
   */
  tick(
    prediction: PathPrediction | null,
    data: NormalizedMarketData,
  ): SchedulerTickResult {
    const nowMs = Date.now();
    const atr = data.atr5m ?? 10;

    // Step 1: Create new watches from prediction
    if (prediction) {
      this._createWatchesFromPrediction(prediction, nowMs);
    }

    // Step 2: Prune stale / broken / expired watches
    this._pruneStaleWatches(nowMs);

    // Step 3: Update state for each active watch
    for (const watch of this._watches) {
      if (isTerminal(watch.state)) continue;
      this._updateWatch(watch, data, atr, nowMs);
    }

    // Step 4: Collect results
    const confirmed = this._watches.filter(w => w.state === 'confirmed');
    const active = this._watches.filter(w => isActive(w.state));
    const rejected = this._watches.filter(w => w.state === 'rejected');

    return { confirmed, active, rejected, totalWatches: this._watches.length };
  }

  // ── Watch Creation ────────────────────────────────────────────────────────

  private _createWatchesFromPrediction(prediction: PathPrediction, nowMs: number): void {
    const routes = [prediction.route, ...prediction.alternateRoutes];

    for (const route of routes) {
      // Skip if already watching this destination level
      if (this._isAlreadyWatched(route.toLevel.id)) continue;

      // Skip if at cap
      const activeCount = this._watches.filter(w => isActive(w.state)).length;
      if (activeCount >= this._config.maxConcurrentWatches) break;

      // Skip broken destination
      if (route.toLevel.broken) continue;

      // Create the watch
      const watch: WatchAlert = {
        id: _nextWatchId(),
        level: route.toLevel,
        route,
        direction: route.direction,
        state: 'idle',
        createdAt: nowMs,
        confirmations: [],
      };

      this._watches.push(watch);
    }
  }

  private _isAlreadyWatched(levelId: string): boolean {
    return this._watches.some(w =>
      w.level.id === levelId && isActive(w.state),
    );
  }

  // ── Watch State Update ────────────────────────────────────────────────────

  private _updateWatch(
    watch: WatchAlert,
    data: NormalizedMarketData,
    atr: number,
    nowMs: number,
  ): void {
    const price = data.currentPrice;
    const levelPrice = watch.level.price;
    const approachRange = atr * this._config.approachRangeAtrMult;
    const touchRange = atr * this._config.touchRangeAtrMult;
    const breakDistance = atr * this._config.breakDistanceAtrMult;

    // ── Check for blow-through (any active state) ──────────────────────
    if (hasBlownThrough(price, levelPrice, watch.direction, breakDistance)) {
      this._applyUpdate(watch, transitionToRejected(nowMs,
        `Price blew through ${levelPrice.toFixed(2)} by >${(breakDistance).toFixed(1)} pts`));
      return;
    }

    // ── Check for level broken ─────────────────────────────────────────
    if (watch.level.broken) {
      this._applyUpdate(watch, transitionToRejected(nowMs, 'Watched level was broken'));
      return;
    }

    // ── State-specific transitions ─────────────────────────────────────

    switch (watch.state) {
      case 'idle': {
        // idle → watching when price enters approach range
        if (isInApproachRange(price, levelPrice, approachRange)) {
          this._applyUpdate(watch, transitionToWatching(nowMs));
        }
        break;
      }

      case 'watching': {
        // watching → confirming when price touches the level
        if (isTouchingLevel(price, levelPrice, touchRange, watch.level.priceHigh)) {
          this._applyUpdate(watch, transitionToConfirming(nowMs));
          // Set arrivedAt if not already set
          if (!watch.arrivedAt) watch.arrivedAt = nowMs;
        }
        break;
      }

      case 'confirming': {
        // Run confirmation engine
        this._evaluateConfirmation(watch, data, atr, nowMs);
        break;
      }

      // confirmed and rejected are terminal — handled by isTerminal check above
    }
  }

  // ── Confirmation Evaluation ───────────────────────────────────────────────

  private _evaluateConfirmation(
    watch: WatchAlert,
    data: NormalizedMarketData,
    atr: number,
    nowMs: number,
  ): void {
    // Select bars for confirmation analysis (5m preferred, fall back to 1m)
    const bars = data.bars5m.length >= 3 ? data.bars5m : data.bars1m;
    const recentBars = bars.slice(Math.max(0, bars.length - 8));

    const ctx: ConfirmationContext = {
      level: watch.level,
      direction: watch.direction,
      atr,
      recentBars,
      allBars: bars,
      touchTimestamp: watch.arrivedAt ?? nowMs,
    };

    // Detect signals
    const signals = evaluateConfirmation(ctx);
    watch.confirmations = signals;

    // Score
    const score = scoreConfirmation(signals);
    watch.confirmationScore = score;

    if (isConfirmed(score)) {
      // Confirmation achieved
      this._applyUpdate(watch, transitionToConfirmed(nowMs));
      return;
    }

    // Check if confirmation window has expired
    const windowStart = watch.arrivedAt ?? watch.createdAt;
    if (isConfirmationWindowExpired(windowStart, nowMs, this._config.confirmationWindowMs)) {
      this._applyUpdate(watch, transitionToRejected(nowMs,
        `Confirmation window expired: score ${score.total.toFixed(1)} < 65 threshold`));
      return;
    }

    // Still within window, keep confirming — signals may strengthen next tick
  }

  // ── Pruning ───────────────────────────────────────────────────────────────

  private _pruneStaleWatches(nowMs: number): void {
    this._watches = this._watches.filter(watch => {
      // Remove terminal watches that are old (already consumed or logged)
      if (isTerminal(watch.state)) {
        const terminalAge = nowMs - (watch.confirmedAt ?? watch.rejectedAt ?? watch.createdAt);
        // Keep terminal watches for 2 minutes so consumers can read them
        return terminalAge < 2 * 60_000;
      }

      // Remove active watches that are too old
      const age = nowMs - watch.createdAt;
      if (age > this._config.maxWatchAgeMs) return false;

      // Remove watches for broken levels
      if (watch.level.broken) return false;

      return true;
    });
  }

  // ── State Application ─────────────────────────────────────────────────────

  private _applyUpdate(watch: WatchAlert, update: WatchUpdate): void {
    watch.state = update.state;
    if (update.arrivedAt != null) watch.arrivedAt = update.arrivedAt;
    if (update.confirmedAt != null) watch.confirmedAt = update.confirmedAt;
    if (update.rejectedAt != null) watch.rejectedAt = update.rejectedAt;
    if (update.rejectionReason != null) watch.rejectionReason = update.rejectionReason;
  }

  // ── Accessors ─────────────────────────────────────────────────────────────

  /** Get all current watches (active + recently terminal). */
  getAllWatches(): WatchAlert[] {
    return [...this._watches];
  }

  /** Get only active (non-terminal) watches. */
  getActiveWatches(): WatchAlert[] {
    return this._watches.filter(w => isActive(w.state));
  }

  /** Get confirmed watches that haven't been consumed yet. */
  getConfirmedWatches(): WatchAlert[] {
    return this._watches.filter(w => w.state === 'confirmed');
  }

  /** Number of active watches. */
  get activeCount(): number {
    return this._watches.filter(w => isActive(w.state)).length;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /** Clear all watches. Called on simulator reset. */
  reset(): void {
    this._watches = [];
  }

  /** Remove a specific watch by ID (e.g. after decision engine consumes it). */
  removeWatch(watchId: string): void {
    this._watches = this._watches.filter(w => w.id !== watchId);
  }

  /** Update configuration. */
  updateConfig(config: Partial<WatchSchedulerConfig>): void {
    Object.assign(this._config, config);
  }
}

// ── Tick Result ───────────────────────────────────────────────────────────────

export interface SchedulerTickResult {
  /** Watches that have reached confirmed state this tick. */
  confirmed: WatchAlert[];
  /** All currently active (non-terminal) watches. */
  active: WatchAlert[];
  /** Watches rejected this tick. */
  rejected: WatchAlert[];
  /** Total watches in the scheduler (including recently terminal). */
  totalWatches: number;
}
