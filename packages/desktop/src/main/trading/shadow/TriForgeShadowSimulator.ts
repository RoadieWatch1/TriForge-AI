// ── main/trading/shadow/TriForgeShadowSimulator.ts ─────────────────────────────
//
// Orchestrator for the level-to-level AI trading engine.
//
// Pipeline per tick:
//   1. Get normalized market data from provider
//   2. Update session context
//   3. Build / refresh level map (LevelMapEngine)
//   4. Predict path (PathPredictionEngine)
//   5. Update watches (LevelWatchScheduler)
//   6. Evaluate decisions (TradeDecisionEngine)
//   7. Check exits on open positions (ShadowPnLEngine)
//   8. Update P&L summary
//   9. Check session flatten signal
//  10. Council review for pending intents (with duplicate protection)
//  11. Execute approved intents through ShadowOrderEngine
//  12. Return first approved intent (or null if nothing actionable)
//
// SIMULATION ONLY. No real brokerage orders.

import type {
  LevelMap, NormalizedMarketData,
  WatchAlert, TradeIntent, SessionContext, PathPrediction,
} from '@triforge/engine';
import type { IMarketDataProvider } from '../market/MarketDataProvider';
import type { CouncilReviewFn, CouncilReviewResult } from '../shadowTradingController';

// Pipeline modules
import { LevelMapEngine } from '../levels/LevelMapEngine';
import { predictPathWithBias, type PredictionWithBias } from '../route/PathPredictionEngine';
import { LevelWatchScheduler } from '../watch/LevelWatchScheduler';
import {
  evaluateDecisions,
  type DecisionResult, type BlockedEvaluation,
} from '../decision/TradeDecisionEngine';
import type { AccountState } from '../decision/RiskModel';

// Execution modules
import { ShadowPositionBook } from './ShadowPositionBook';
import { ShadowOrderEngine, type OrderResult } from './ShadowOrderEngine';
import { ShadowSessionController } from './ShadowSessionController';
import {
  computeUnrealizedPnL, computeSessionSummary,
  type SessionPnLSummary,
} from './ShadowPnLEngine';
import { checkExitTrigger } from './ShadowFillModel';
import { adaptIntentForCouncil } from './TradeIntentAdapter';

// News / regime modules
import { NewsCalendarProvider } from '../news/NewsCalendarProvider';
import { shouldBlockForNews, getNewsRiskContext, type NewsRiskContext } from '../news/NewsRiskGate';
import { SessionRegimeMemory, type RegimeContext } from '../learning/SessionRegimeMemory';

// Reliability modules
import { computeFreshness } from '../reliability/SignalFreshness';
import { computeReliability, type SignalReliabilityScore, type ReliabilityComponents } from '../reliability/ReliabilityScorer';
import { checkRegimeCompatibility } from '../reliability/RegimeFilterGovernor';
import { validateWithGovernor, type GovernorBlock } from '../reliability/ReliabilityGovernor';
import { SetupReliabilityStore } from '../reliability/SetupReliabilityStore';

// Journal
import { TradeJournalStore, type ExtendedJournalEntry } from '../learning/TradeJournalStore';

// ── Reviewed Intent Record ─────────────────────────────────────────────────

export type ReviewOutcome = 'approved' | 'rejected' | 'error' | 'no_council';

export interface ReviewedIntent {
  intent: TradeIntent;
  outcome: ReviewOutcome;
  /** Council votes (when available). */
  councilResult?: CouncilReviewResult;
  /** Execution result (only when approved). */
  orderResult?: OrderResult;
  /** Timestamp of the review. */
  reviewedAt: number;
  /** Human-readable reason for the outcome. */
  reason: string;
}

// ── Simulator State ─────────────────────────────────────────────────────────

export interface SimulatorState {
  /** Whether the level engine is actively running. */
  active: boolean;
  /** Current level map, or null if not yet built. */
  levelMap: LevelMap | null;
  /** Active watch alerts. */
  watches: WatchAlert[];
  /** Current path prediction, or null. */
  pathPrediction: PathPrediction | null;
  /** Current session context. */
  sessionContext: SessionContext | null;
  /** Pending trade intents awaiting council review. */
  pendingIntents: TradeIntent[];
  /** Blocked evaluations from the decision engine (diagnostics). */
  blockedEvaluations: BlockedEvaluation[];
  /** Last tick timestamp. */
  lastTickAt: number;
  /** Why the simulator is not producing trades (if applicable). */
  blockedReason?: string;
  /** Session P&L summary. */
  pnlSummary: SessionPnLSummary | null;
  /** Number of ticks the pipeline has run. */
  tickCount: number;
  /** Recent reviewed intents (most recent first, max 20). */
  reviewedIntents: ReviewedIntent[];
  /** Current news risk context (from NewsRiskGate). */
  newsRiskContext: NewsRiskContext | null;
  /** Current session regime context (from SessionRegimeMemory). */
  regimeContext: RegimeContext | null;
  /** Signal reliability score for latest approved intent. */
  signalReliability: SignalReliabilityScore | null;
}

// ── Constants ───────────────────────────────────────────────────────────────

/** Max reviewed intents to keep in state for diagnostics. */
const MAX_REVIEWED_HISTORY = 20;

// ── Simulator ───────────────────────────────────────────────────────────────

export class TriForgeShadowSimulator {
  private _state: SimulatorState = this._freshState();
  private _provider: IMarketDataProvider | null = null;
  private _councilFn: CouncilReviewFn | null = null;

  // Duplicate protection: track which intent IDs and watch IDs have already
  // been submitted for council review to prevent re-submission on subsequent
  // ticks (the same confirmed watch can produce the same intent ID across
  // consecutive evalTick() calls until the watch expires).
  private readonly _reviewedIntentIds = new Set<string>();
  private readonly _reviewedWatchIds = new Set<string>();

  // Council context: the intent currently under council review.
  // Set before the council callback is invoked, cleared after.
  // Allows the callback in ipc.ts to access the full TradeIntent
  // (the callback signature only receives ProposedTradeSetup).
  private _currentReviewIntent: TradeIntent | null = null;

  // Pipeline components
  private readonly _levelMapEngine = new LevelMapEngine();
  private readonly _watchScheduler = new LevelWatchScheduler();
  private readonly _sessionController = new ShadowSessionController();
  private readonly _positionBook = new ShadowPositionBook();
  private readonly _orderEngine = new ShadowOrderEngine(this._positionBook);
  private readonly _newsProvider = new NewsCalendarProvider();
  private readonly _regimeMemory = new SessionRegimeMemory();
  private readonly _journalStore = new TradeJournalStore();
  private readonly _reliabilityStore = new SetupReliabilityStore();
  private _reliabilityStoreDirty = true;

  // Feed stale event timestamps (for governor instability check).
  private _feedStaleEvents: number[] = [];

  // Prediction stabilizer state (hysteresis to prevent route flip-flopping).
  // Holds the previous stable direction and tracks how many ticks a new
  // opposing direction has persisted before committing to a flip.
  private _stableDirection: 'long' | 'short' | null = null;
  private _stablePrediction: PathPrediction | null = null;
  private _flipPersistCount: number = 0;   // ticks the new opposing direction has persisted
  private _nullHoldCount: number = 0;      // ticks holding previous prediction after null

  // ── Setup ───────────────────────────────────────────────────────────────

  /** Attach the market data provider. */
  setProvider(provider: IMarketDataProvider): void {
    this._provider = provider;
  }

  /** Attach the council review callback. */
  setCouncilFn(fn: CouncilReviewFn): void {
    this._councilFn = fn;
  }

  // ── Eval Tick ─────────────────────────────────────────────────────────────
  // Called by shadowTradingController on each eval interval when
  // useLevelEngine=true.
  //
  // When the pipeline produces trade intents and the council callback is
  // available, intents are submitted for review. Approved intents are
  // executed through ShadowOrderEngine and the first approved intent is
  // returned to the controller so it can skip the legacy pipeline.
  //
  // When the council callback is not available, the pipeline runs in
  // observation mode (intents stored but not reviewed/executed).

  /**
   * Run one evaluation tick of the level-to-level engine.
   *
   * @returns The first approved TradeIntent if the council approved and
   *          execution succeeded, or null if nothing actionable.
   */
  async evalTick(): Promise<TradeIntent | null> {
    const now = Date.now();
    this._state.lastTickAt = now;
    this._state.tickCount++;

    if (!this._state.active) {
      this._state.blockedReason = 'Simulator is not active.';
      return null;
    }

    // ── Step 1: Get normalized market data ──────────────────────────────
    if (!this._provider) {
      this._state.blockedReason = 'No market data provider attached.';
      return null;
    }

    const data = this._provider.getNormalizedData();
    if (!data) {
      this._state.blockedReason = 'Market data not available.';
      return null;
    }

    // ── Step 2: Update session context ──────────────────────────────────
    const session = this._sessionController.getSessionContext();
    this._state.sessionContext = session;

    // ── Step 2b: News risk assessment ────────────────────────────────────
    const newsCtx = getNewsRiskContext(this._newsProvider, now);
    this._state.newsRiskContext = newsCtx;

    // Inject news buffer flag and active events into session context
    if (newsCtx.hasActiveRisk) {
      session.newsBuffer = newsCtx.blocked;
      session.activeEvents = newsCtx.nearbyEvents;
    }

    // ── Step 2c: Session regime detection ────────────────────────────────
    const regimeCtx = this._regimeMemory.detect(data);
    this._state.regimeContext = regimeCtx;

    // ── Step 2d: Hard news block — skip trade generation ─────────────────
    if (newsCtx.blocked) {
      this._state.blockedReason = `News block: ${newsCtx.reason}`;
      // Still build the level map and run exits, but skip new entry generation
    }

    // ── Step 3: Build / refresh level map ───────────────────────────────
    const levelMap = this._levelMapEngine.buildLevelMap(data);
    this._state.levelMap = levelMap;

    if (!levelMap) {
      this._state.blockedReason = 'Insufficient data to build level map.';
      this._state.pathPrediction = null;
      this._state.watches = [];
      this._state.pendingIntents = [];
      this._state.blockedEvaluations = [];
      return null;
    }

    // ── Step 4: Predict path (with hysteresis stabilization) ───────────
    const rawResult = predictPathWithBias(levelMap, data, session);
    const prediction = this._stabilizePrediction(rawResult);
    this._state.pathPrediction = prediction;

    // ── Step 5: Update watches ──────────────────────────────────────────
    const watchResult = this._watchScheduler.tick(prediction, data);
    this._state.watches = this._watchScheduler.getActiveWatches();

    // ── Step 6: Evaluate decisions (skipped when news-blocked) ──────────
    const accountState = this._buildAccountState(data);
    let decisionResult: DecisionResult = { intents: [], blocked: [] };

    if (!newsCtx.blocked && watchResult.confirmed.length > 0) {
      this._ensureReliabilityStore();
      const empiricalOverrides = this._reliabilityStore.buildEmpiricalOverrides();
      decisionResult = evaluateDecisions(
        watchResult.confirmed,
        data,
        session,
        accountState,
        undefined,           // riskSettings
        undefined,           // config
        levelMap,            // for structure-based stop placement
        regimeCtx,           // for setup quality + regime filter
        empiricalOverrides,  // for empirical regime compatibility overrides
      );
    }

    // ── Step 6b: Feed stale tracking + Governor gate ──────────────────
    // Track feed stale events for governor instability check
    if (data.feedFreshnessMs != null && data.feedFreshnessMs > 5000) {
      this._feedStaleEvents.push(now);
    }
    // Prune to 5-minute window
    const staleWindowStart = now - 300_000;
    this._feedStaleEvents = this._feedStaleEvents.filter(t => t >= staleWindowStart);

    // Governor gate: validate each intent through reliability governor
    if (decisionResult.intents.length > 0) {
      const governed: TradeIntent[] = [];
      const lastClosed = this._getLastClosedTradeForGovernor();
      for (const intent of decisionResult.intents) {
        // Compute fresh per-candidate reliability (not stale global state)
        const candidateReliability = this._computeCandidateReliability(intent, data, regimeCtx);
        const gov = validateWithGovernor(
          intent,
          accountState,
          candidateReliability,
          this._state.reviewedIntents,
          this._feedStaleEvents.length,
          lastClosed,
          undefined,
          session,
        );
        if (gov.allowed) {
          governed.push(intent);
        } else {
          // Preserve structured governor blocks in diagnostics
          decisionResult.blocked.push({
            watchId: intent.watchId,
            levelLabel: intent.entryLevel.label,
            reasons: gov.blocks.map(b => `[${b.category}] ${b.code}: ${b.explanation}`),
            governorBlocks: gov.blocks,
          });
        }
      }
      decisionResult.intents = governed;
    }

    this._state.pendingIntents = decisionResult.intents;
    this._state.blockedEvaluations = decisionResult.blocked;

    // ── Step 7: Check exits on open positions ───────────────────────────
    this._checkExits(data.currentPrice);

    // ── Step 8: Update P&L summary ──────────────────────────────────────
    this._state.pnlSummary = computeSessionSummary(
      this._positionBook.getOpenPositions(),
      this._positionBook.getClosedPositions(),
      data.currentPrice,
    );

    // ── Step 9: Check session flatten ───────────────────────────────────
    if (this._sessionController.shouldFlattenNow() && this._positionBook.openCount > 0) {
      this._positionBook.flattenAll(data.currentPrice, 'session_close');
      this._journalClosedPositions(); // Journal flattened positions
    }

    // ── Step 10: Council review + execution (skipped when news-blocked) ─
    let approvedIntent: TradeIntent | null = null;

    if (!newsCtx.blocked && decisionResult.intents.length > 0) {
      approvedIntent = await this._reviewAndExecute(
        decisionResult.intents,
        data,
      );
    }

    // ── Step 10b: Compute reliability for latest approved intent ────────
    this._computeReliability(data);

    // ── Step 11: Set blocked reason or clear it ─────────────────────────
    if (newsCtx.blocked) {
      // News block reason was already set in step 2d — keep it
    } else if (approvedIntent) {
      this._state.blockedReason = undefined;
    } else if (decisionResult.intents.length > 0) {
      // Had intents but none approved
      const lastReview = this._state.reviewedIntents[0];
      this._state.blockedReason = lastReview
        ? `Council: ${lastReview.reason}`
        : 'Intents generated but not approved.';
    } else if (!prediction) {
      this._state.blockedReason = 'No clear path predicted (ambiguous bias).';
    } else if (watchResult.confirmed.length === 0) {
      this._state.blockedReason = 'No confirmed watches — waiting for confirmation.';
    } else if (decisionResult.blocked.length > 0) {
      const reasons = decisionResult.blocked.flatMap(b => b.reasons);
      this._state.blockedReason = `Decisions blocked: ${reasons.join(', ')}`;
    } else {
      this._state.blockedReason = 'Pipeline ran — no actionable output.';
    }

    return approvedIntent;
  }

  // ── Council Review + Execution ──────────────────────────────────────────

  /**
   * Submit intents for council review and execute approved ones.
   *
   * Only processes intents that have not been previously reviewed
   * (duplicate protection by intent ID and watch ID).
   *
   * @returns The first approved and executed intent, or null.
   */
  private async _reviewAndExecute(
    intents: TradeIntent[],
    data: NormalizedMarketData,
  ): Promise<TradeIntent | null> {
    // Filter to intents not already reviewed
    const newIntents = intents.filter(
      i => !this._reviewedIntentIds.has(i.id) && !this._reviewedWatchIds.has(i.watchId),
    );

    if (newIntents.length === 0) return null;

    // No council callback — record as observation only
    if (!this._councilFn) {
      for (const intent of newIntents) {
        this._recordReview(intent, 'no_council', undefined, undefined, 'Council callback not available.');
      }
      return null;
    }

    // Review each new intent sequentially (typically 1 per tick)
    for (const intent of newIntents) {
      const adapted = adaptIntentForCouncil(intent, this._provider);
      if (!adapted) {
        this._recordReview(intent, 'error', undefined, undefined, 'Failed to adapt intent for council (no market data).');
        continue;
      }

      let councilResult: CouncilReviewResult;
      try {
        this._currentReviewIntent = intent;
        councilResult = await this._councilFn(adapted.setup, adapted.snapshot, adapted.symbol);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this._recordReview(intent, 'error', undefined, undefined, `Council error: ${msg}`);
        continue;
      } finally {
        this._currentReviewIntent = null;
      }

      if (!councilResult.approved) {
        this._recordReview(
          intent, 'rejected', councilResult, undefined,
          councilResult.blockedReason ?? 'Council rejected.',
        );
        continue;
      }

      // Council approved — execute through ShadowOrderEngine
      const orderResult = this._orderEngine.processIntent(intent, data.currentPrice);

      if (!orderResult.success) {
        this._recordReview(
          intent, 'error', councilResult, orderResult,
          `Execution failed: ${orderResult.rejectReason ?? 'unknown'}`,
        );
        continue;
      }

      // Successfully executed
      this._recordReview(intent, 'approved', councilResult, orderResult, 'Approved and executed.');
      return intent;
    }

    return null;
  }

  /**
   * Record a reviewed intent for diagnostics and mark its IDs as consumed.
   */
  private _recordReview(
    intent: TradeIntent,
    outcome: ReviewOutcome,
    councilResult: CouncilReviewResult | undefined,
    orderResult: OrderResult | undefined,
    reason: string,
  ): void {
    // Mark as reviewed to prevent re-submission
    this._reviewedIntentIds.add(intent.id);
    this._reviewedWatchIds.add(intent.watchId);

    const record: ReviewedIntent = {
      intent,
      outcome,
      councilResult,
      orderResult,
      reviewedAt: Date.now(),
      reason,
    };

    this._state.reviewedIntents = [
      record,
      ...this._state.reviewedIntents,
    ].slice(0, MAX_REVIEWED_HISTORY);
  }

  // ── Exit Checking ───────────────────────────────────────────────────────

  private _checkExits(currentPrice: number): void {
    for (const pos of this._positionBook.getOpenPositions()) {
      // Update unrealized P&L and excursions
      computeUnrealizedPnL(pos, currentPrice);

      // Check stop/target
      const trigger = checkExitTrigger(
        pos.side, pos.stopPrice, pos.targetPrice, currentPrice,
      );
      if (trigger) {
        const exitPrice = trigger === 'stop' ? pos.stopPrice : pos.targetPrice;
        this._positionBook.closePosition(pos.id, exitPrice, trigger);
      }
    }

    // Journal any newly-closed positions
    this._journalClosedPositions();
  }

  // ── Journal Writer ────────────────────────────────────────────────────────

  /**
   * Scan closed positions and journal any that haven't been journaled yet.
   * Matches each closed position back to its originating TradeIntent via
   * the reviewed intents history, then builds a full journal entry.
   */
  private _journalClosedPositions(): void {
    const closed = this._positionBook.getClosedPositions();

    for (const pos of closed) {
      if (this._journalStore.hasEntry(pos.intentId)) continue;
      if (pos.exitPrice === undefined || pos.closedAt === undefined) continue;

      // Find the reviewed intent that produced this position
      const review = this._state.reviewedIntents.find(
        r => r.intent.id === pos.intentId,
      );
      const intent = review?.intent;
      if (!intent) continue;

      // Determine outcome
      const pnlR = pos.rMultiple ?? 0;
      const outcome: 'win' | 'loss' | 'breakeven' =
        pnlR > 0.05 ? 'win' : pnlR < -0.05 ? 'loss' : 'breakeven';

      // Extract confirmation types from the triggering watch
      const watch = this._state.watches.find(w => w.id === intent.watchId)
        ?? this._watchScheduler.getActiveWatches().find(w => w.id === intent.watchId);
      const confirmationTypes = watch?.confirmations
        .filter(c => c.detected)
        .map(c => c.type) ?? [];

      // Get current regime and news context
      const regimeCtx = this._state.regimeContext;
      const newsCtx = this._state.newsRiskContext;
      const session = this._state.sessionContext;

      // Build council votes summary (now includes reason for analytics)
      let councilVotes: ExtendedJournalEntry['councilVotes'] = null;
      let grokVetoed = false;
      let councilBlockedCode: string | null = null;
      let councilConsensusPattern: ExtendedJournalEntry['councilConsensusPattern'] = null;
      let councilAvgConfidence = 0;

      if (review?.councilResult) {
        const cr = review.councilResult;
        if (cr.votes && cr.votes.length > 0) {
          councilVotes = cr.votes.map(v => ({
            provider: v.provider,
            vote: v.vote,
            confidence: v.confidence,
            reason: v.reason,
          }));

          const takeCount = cr.votes.filter(v => v.vote === 'TAKE').length;
          const total = cr.votes.length;
          councilAvgConfidence = cr.votes.reduce((s, v) => s + v.confidence, 0) / total;
          grokVetoed = cr.votes.some(v => v.provider === 'grok' && v.vote === 'REJECT');
          councilBlockedCode = cr.blockedCode ?? null;

          // Determine consensus pattern
          if (cr.approved) {
            if (takeCount === total) councilConsensusPattern = 'unanimous_take';
            else if (takeCount >= 2) councilConsensusPattern = 'majority_take';
            else councilConsensusPattern = 'split_approval';
          } else {
            if (grokVetoed) councilConsensusPattern = 'grok_veto';
            else if (cr.blockedCode === 'low_confidence') councilConsensusPattern = 'low_confidence';
            else councilConsensusPattern = 'insufficient_votes';
          }
        }
      } else if (review?.outcome === 'no_council') {
        councilConsensusPattern = 'no_council';
      }

      // Build score breakdown
      let scoreBreakdown: ExtendedJournalEntry['scoreBreakdown'] = null;
      if (intent.score) {
        scoreBreakdown = {
          final: intent.score.final,
          level: intent.score.levelScore,
          route: intent.score.routeScore,
          confirmation: intent.score.confirmationScore,
          session: intent.score.sessionScore,
          rr: intent.score.rrScore,
        };
      }

      const stopDistance = Math.abs(pos.entryPrice - pos.stopPrice);

      const entry: ExtendedJournalEntry = {
        tradeId: pos.intentId,
        symbol: intent.symbol,
        direction: intent.side === 'long' ? 'up' : 'down',
        levelType: intent.entryLevel.type,
        levelQualityScore: intent.entryLevel.qualityScore,
        routeQualityScore: intent.route.qualityScore,
        confirmationScore: intent.score.confirmationScore,
        tradeScore: intent.score.final,
        tradeScoreBand: intent.score.band,
        sessionLabel: session?.windowLabel ?? 'unknown',
        confirmationTypes: confirmationTypes as any[],
        outcome,
        pnlR,
        mfeR: stopDistance > 0 ? pos.mfePoints / stopDistance : 0,
        maeR: stopDistance > 0 ? pos.maePoints / stopDistance : 0,
        holdDurationMs: (pos.closedAt ?? 0) - pos.openedAt,
        exitReason: pos.exitReason ?? 'unknown',
        tags: [
          intent.entryLevel.type,
          intent.symbol,
          intent.side === 'long' ? 'long' : 'short',
          intent.score.band,
          session?.windowLabel ?? 'unknown',
          regimeCtx?.current?.regime ?? 'unknown',
        ],
        createdAt: Date.now(),

        // Extended fields
        entryLevelQuality: intent.entryLevel.qualityScore,
        destinationLevelType: intent.route.toLevel.type,
        destinationLevelQuality: intent.route.toLevel.qualityScore,
        routeObstacleCount: intent.route.intermediateObstacles.length,
        entryPrice: pos.entryPrice,
        stopPrice: pos.stopPrice,
        targetPrice: pos.targetPrice,
        exitPrice: pos.exitPrice,
        riskRewardRatio: intent.riskRewardRatio,
        sessionRegime: regimeCtx?.current?.regime ?? null,
        newsFlags: newsCtx?.riskFlags ?? [],
        newsScoreAdjustment: newsCtx?.scoreAdjustment ?? 0,
        councilVotes,
        councilApproved: review?.outcome === 'approved',
        grokVetoed,
        councilBlockedCode,
        councilConsensusPattern,
        councilAvgConfidence,
        additionalTargets: intent.additionalTargets ?? [],
        scoreBreakdown,
        setupFamily: intent.setupFamily ?? null,
        setupQualityScore: intent.setupQualityScore ?? null,
        setupQualityBand: intent.setupQualityBand ?? null,
        regimeCompatibility: (() => {
          const family = (intent.setupFamily ?? 'unclassified') as any;
          const rc = checkRegimeCompatibility(family, regimeCtx ?? null);
          return rc.compatibility;
        })(),
      };

      this._journalStore.append(entry);
      this._reliabilityStoreDirty = true;
    }
  }

  // ── Account State Builder ───────────────────────────────────────────────

  private _buildAccountState(data: NormalizedMarketData): AccountState {
    const closed = this._positionBook.getClosedPositions();
    const summary = computeSessionSummary(
      this._positionBook.getOpenPositions(),
      closed,
      data.currentPrice,
    );

    return {
      dailyPnL: summary.totalRealizedPoints,
      dayStartBalance: 50_000, // default shadow account balance
      tradesToday: closed.length,
      consecutiveLosses: summary.consecutiveLosses,
      openPositionCount: this._positionBook.openCount,
      feedFreshnessMs: data.feedFreshnessMs,
      currentAtr: data.atr5m,
    };
  }

  // ── State Accessors (for IPC / UI) ────────────────────────────────────────

  /** Get the current simulator state. */
  getState(): SimulatorState {
    return { ...this._state };
  }

  /** Get the current level map. */
  getLevelMap(): LevelMap | null {
    return this._state.levelMap;
  }

  /** Get active watch alerts. */
  getWatches(): WatchAlert[] {
    return [...this._state.watches];
  }

  /** Get the current path prediction. */
  getPathPrediction(): PathPrediction | null {
    return this._state.pathPrediction;
  }

  /** Get the current session context. */
  getSessionContext(): SessionContext | null {
    return this._state.sessionContext;
  }

  /** Get pending trade intents. */
  getPendingIntents(): TradeIntent[] {
    return [...this._state.pendingIntents];
  }

  /** Get blocked evaluations from the decision engine. */
  getBlockedEvaluations(): BlockedEvaluation[] {
    return [...this._state.blockedEvaluations];
  }

  /** Get recent reviewed intents (most recent first). */
  getReviewedIntents(): ReviewedIntent[] {
    return [...this._state.reviewedIntents];
  }

  /** Get the position book for external inspection. */
  getPositionBook(): ShadowPositionBook {
    return this._positionBook;
  }

  /** Get the session controller for external use. */
  getSessionController(): ShadowSessionController {
    return this._sessionController;
  }

  /** Get the intent currently under council review (set during callback). */
  getCurrentReviewIntent(): TradeIntent | null {
    return this._currentReviewIntent;
  }

  /** Get the current news risk context. */
  getNewsRiskContext(): NewsRiskContext | null {
    return this._state.newsRiskContext;
  }

  /** Get the current session regime context. */
  getRegimeContext(): RegimeContext | null {
    return this._state.regimeContext;
  }

  /** Get the news calendar provider (for external queries). */
  getNewsProvider(): NewsCalendarProvider {
    return this._newsProvider;
  }

  /** Get the trade journal store (for IPC queries). */
  getJournalStore(): TradeJournalStore {
    return this._journalStore;
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /** Reset the simulator to fresh state. */
  reset(): void {
    this._state = this._freshState();
    this._watchScheduler.reset();
    this._positionBook.reset();
    this._reviewedIntentIds.clear();
    this._reviewedWatchIds.clear();
    this._regimeMemory.reset();
    this._feedStaleEvents = [];
    this._reliabilityStoreDirty = true;
    this._stableDirection = null;
    this._stablePrediction = null;
    this._flipPersistCount = 0;
    this._nullHoldCount = 0;
  }

  /** Mark the simulator as active. */
  activate(): void {
    this._state.active = true;
    this._state.blockedReason = undefined;
  }

  /** Mark the simulator as inactive. */
  deactivate(): void {
    this._state.active = false;
    this._state.watches = [];
    this._state.pendingIntents = [];
    this._state.pathPrediction = null;
    this._watchScheduler.reset();
    this._stableDirection = null;
    this._stablePrediction = null;
    this._flipPersistCount = 0;
    this._nullHoldCount = 0;
  }

  // ── Prediction Stabilizer (Hysteresis) ──────────────────────────────────
  //
  // Prevents rapid direction flip-flopping in choppy conditions.
  //
  // Rules:
  //   1. Same direction as previous → accept immediately
  //   2. Different direction + strong bias (|biasScore| >= 35) → flip immediately
  //   3. Different direction + moderate bias → hold previous, count ticks;
  //      flip only after 3 consecutive ticks of opposing bias
  //   4. Null prediction + previous was valid → hold previous for up to 2 ticks
  //   5. Null prediction + no previous → return null

  private _stabilizePrediction(result: PredictionWithBias): PathPrediction | null {
    const { prediction: raw, biasScore } = result;

    // ── Case: raw prediction is null (ambiguous) ──────────────────────
    if (!raw) {
      if (this._stablePrediction && this._nullHoldCount < 2) {
        // Hold previous prediction briefly to avoid flicker (2 ticks = 20s max)
        this._nullHoldCount++;
        return this._stablePrediction;
      }
      // No previous or held too long — clear
      this._stableDirection = null;
      this._stablePrediction = null;
      this._flipPersistCount = 0;
      this._nullHoldCount = 0;
      return null;
    }

    // We have a valid prediction — reset null hold counter
    this._nullHoldCount = 0;

    // ── Case: no previous direction (first prediction) ────────────────
    if (this._stableDirection === null) {
      this._stableDirection = raw.direction;
      this._stablePrediction = raw;
      this._flipPersistCount = 0;
      return raw;
    }

    // ── Case: same direction as previous ──────────────────────────────
    if (raw.direction === this._stableDirection) {
      this._stablePrediction = raw;
      this._flipPersistCount = 0; // reset any pending flip
      return raw;
    }

    // ── Case: different direction ─────────────────────────────────────
    // Strong bias → flip immediately
    if (Math.abs(biasScore) >= 35) {
      this._stableDirection = raw.direction;
      this._stablePrediction = raw;
      this._flipPersistCount = 0;
      return raw;
    }

    // Moderate bias → require persistence before committing
    this._flipPersistCount++;
    if (this._flipPersistCount >= 3) {
      // Opposing direction has persisted long enough — commit to flip
      this._stableDirection = raw.direction;
      this._stablePrediction = raw;
      this._flipPersistCount = 0;
      return raw;
    }

    // Not yet persistent enough — hold previous prediction
    return this._stablePrediction;
  }

  // ── Reliability Store ─────────────────────────────────────────────────

  /**
   * Ensure the SetupReliabilityStore is up-to-date with journal entries.
   * Only recomputes when the journal has changed (dirty flag).
   */
  private _ensureReliabilityStore(): void {
    if (this._reliabilityStoreDirty) {
      this._reliabilityStore.recompute(this._journalStore.loadAll());
      this._reliabilityStoreDirty = false;
    }
  }

  // ── Governor Helpers ────────────────────────────────────────────────────

  /**
   * Get the last closed trade data for slippage cooldown check.
   */
  private _getLastClosedTradeForGovernor(): {
    exitPrice: number; stopPrice: number; targetPrice: number; closedAt: number;
  } | null {
    const closed = this._positionBook.getClosedPositions();
    if (closed.length === 0) return null;
    const last = closed[closed.length - 1];
    if (last.exitPrice === undefined || last.closedAt === undefined) return null;
    return {
      exitPrice: last.exitPrice,
      stopPrice: last.stopPrice,
      targetPrice: last.targetPrice,
      closedAt: last.closedAt,
    };
  }

  // ── Reliability Computation ───────────────────────────────────────────────

  /**
   * Compute reliability for the latest approved (and still-relevant) intent.
   * Sets `signalReliability` on state — null when no approved intent exists.
   */
  private _computeReliability(data: NormalizedMarketData): void {
    const latestApproved = this._state.reviewedIntents.find(
      ri => ri.outcome === 'approved',
    );

    if (!latestApproved?.intent || !data.currentPrice) {
      this._state.signalReliability = null;
      return;
    }

    const intent = latestApproved.intent;
    const regimeCtx = this._state.regimeContext;

    // Determine current and intent-time regime
    const currentRegime = regimeCtx?.current?.regime ?? null;
    const intentRegime = intent.tags?.find(
      (t: string) => ['open_drive', 'trend', 'range', 'reversal', 'expansion', 'drift'].includes(t),
    ) ?? null;

    // Regime compatibility for freshness check (with empirical overrides)
    const family = (intent.setupFamily ?? 'unclassified') as any;
    this._ensureReliabilityStore();
    const empiricalOverrides = this._reliabilityStore.buildEmpiricalOverrides();
    const regimeResult = checkRegimeCompatibility(family, regimeCtx ?? null, empiricalOverrides);

    // Compute freshness
    const freshness = computeFreshness(
      intent,
      data.currentPrice,
      currentRegime,
      intentRegime,
      regimeResult.compatibility,
    );

    // Historical edge from SetupReliabilityStore
    const regime = currentRegime ?? 'unknown';
    const historicalEdge = this._reliabilityStore.getHistoricalEdge(family, regime);
    const historicalTrustLevel = this._reliabilityStore.getTrustLevel(family, regime) as any;
    const historicalRecord = this._reliabilityStore.getAll().find(
      r => r.setupFamily === family && r.regime === regime,
    );
    const historicalSampleTier = (historicalRecord?.sampleTier ?? 'insufficient') as any;

    // Build reliability components
    const components: ReliabilityComponents = {
      setupQuality:      intent.setupQualityScore ?? 50,
      regimeAlignment:   regimeResult.alignmentScore,
      signalFreshness:   freshness.freshnessScore,
      confirmationDepth: intent.score?.confirmationScore ?? 50,
      routeClarity:      intent.score?.routeScore ?? 50,
      councilConsensus:  this._councilConsensusScore(latestApproved),
      feedStability:     this._feedStabilityScore(data),
      historicalEdge,
    };

    this._state.signalReliability = computeReliability(
      components,
      freshness.expired,
      historicalTrustLevel,
      historicalSampleTier,
    );
  }

  /**
   * Compute fresh reliability for a candidate intent (used by governor gate).
   * Unlike _computeReliability() which targets the latest approved intent,
   * this targets a new candidate intent that hasn't been approved yet.
   */
  private _computeCandidateReliability(
    intent: TradeIntent,
    data: NormalizedMarketData,
    regimeCtx: RegimeContext | null,
  ): SignalReliabilityScore | null {
    if (!data.currentPrice) return null;

    const currentRegime = regimeCtx?.current?.regime ?? null;
    const family = (intent.setupFamily ?? 'unclassified') as any;

    this._ensureReliabilityStore();
    const empiricalOverrides = this._reliabilityStore.buildEmpiricalOverrides();
    const regimeResult = checkRegimeCompatibility(family, regimeCtx ?? null, empiricalOverrides);

    // For a new candidate, freshness is at peak (just created)
    const freshness = computeFreshness(
      intent,
      data.currentPrice,
      currentRegime,
      currentRegime, // intent regime = current regime for new candidates
      regimeResult.compatibility,
    );

    // Historical edge from store
    const regime = currentRegime ?? 'unknown';
    const historicalEdge = this._reliabilityStore.getHistoricalEdge(family, regime);
    const historicalTrustLevel = this._reliabilityStore.getTrustLevel(family, regime) as any;
    const historicalRecord = this._reliabilityStore.getAll().find(
      r => r.setupFamily === family && r.regime === regime,
    );
    const historicalSampleTier = (historicalRecord?.sampleTier ?? 'insufficient') as any;

    const components: ReliabilityComponents = {
      setupQuality:      intent.setupQualityScore ?? 50,
      regimeAlignment:   regimeResult.alignmentScore,
      signalFreshness:   freshness.freshnessScore,
      confirmationDepth: intent.score?.confirmationScore ?? 50,
      routeClarity:      intent.score?.routeScore ?? 50,
      councilConsensus:  50, // no council review yet for candidates
      feedStability:     this._feedStabilityScore(data),
      historicalEdge,
    };

    return computeReliability(
      components,
      freshness.expired,
      historicalTrustLevel,
      historicalSampleTier,
    );
  }

  /**
   * Derive council consensus score 0-100 from the review result.
   */
  private _councilConsensusScore(review: ReviewedIntent): number {
    if (!review.councilResult?.votes || review.councilResult.votes.length === 0) return 50;
    const votes = review.councilResult.votes;
    const takeCount = votes.filter(v => v.vote === 'TAKE').length;
    const avgConf = votes.reduce((s, v) => s + v.confidence, 0) / votes.length;
    // Score: take ratio * avg confidence
    return Math.round((takeCount / votes.length) * avgConf);
  }

  /**
   * Derive feed stability score 0-100 from feed freshness.
   */
  private _feedStabilityScore(data: NormalizedMarketData): number {
    const freshMs = data.feedFreshnessMs;
    if (freshMs == null || freshMs <= 0) return 90; // no data = assume stable
    if (freshMs < 1000) return 100;
    if (freshMs < 3000) return 80;
    if (freshMs < 5000) return 60;
    if (freshMs < 10000) return 30;
    return 10;
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private _freshState(): SimulatorState {
    return {
      active:              false,
      levelMap:            null,
      watches:             [],
      pathPrediction:      null,
      sessionContext:      null,
      pendingIntents:      [],
      blockedEvaluations:  [],
      lastTickAt:          0,
      pnlSummary:          null,
      tickCount:           0,
      reviewedIntents:     [],
      newsRiskContext:      null,
      regimeContext:        null,
      signalReliability:   null,
    };
  }
}
