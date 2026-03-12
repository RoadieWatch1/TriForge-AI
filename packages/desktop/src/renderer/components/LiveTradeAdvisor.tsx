// ── LiveTradeAdvisor.tsx ──────────────────────────────────────────────────────
//
// Real-time futures trade advisory screen backed by Tradovate.
// Includes Shadow Trading Mode — Triforge trades beside you in simulation.
//
// ADVISORY ONLY / SIMULATION ONLY — no live orders ever placed by Triforge.

import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  SetupGradeBadge, CouncilLiveTradeCard, BlockedTradeCards,
  UserComparisonPanel, TrustDashboardPanel, GradeAnalyticsPanel,
} from './TrustComponents';
import { LevelMapPanel } from './trading/LevelMapPanel';
import { RoutePanel } from './trading/RoutePanel';
import { WatchPanel } from './trading/WatchPanel';
import { ReviewedIntentsPanel } from './trading/ReviewedIntentsPanel';
import { SessionContextPanel } from './trading/SessionContextPanel';
import { SimulatorPositionsPanel } from './trading/SimulatorPositionsPanel';
import { JournalPanel } from './trading/JournalPanel';
import { ExpectancyPanel } from './trading/ExpectancyPanel';
import { CalibrationPanel } from './trading/CalibrationPanel';
import { NewsCalendarPanel } from './trading/NewsCalendarPanel';
import { SessionRegimePanel } from './trading/SessionRegimePanel';
import { ShadowTradeCard } from './trading/ShadowTradeCard';
import { CouncilDecisionPanel } from './trading/CouncilDecisionPanel';
import { CouncilEffectivenessPanel } from './trading/CouncilEffectivenessPanel';
import { AdvisoryTargetPanel } from './trading/AdvisoryTargetPanel';
import { CandlestickChart } from './trading/CandlestickChart';
import { MarketDataStrip } from './trading/MarketDataStrip';
import { PipelineStatusPanel } from './trading/PipelineStatusPanel';
import { TradeThesisPanel } from './trading/TradeThesisPanel';
import { ReliabilityPanel } from './trading/ReliabilityPanel';
import { TrustEvidencePanel } from './trading/TrustEvidencePanel';
import { ShadowTradeToastContainer, type TradeSignalAlert } from './trading/ShadowTradeToast';
import { ShadowTraderHeader } from './trading/ShadowTraderHeader';
import { ChartTruthStrip } from './trading/ChartTruthStrip';
import { CurrentTradeStateCard } from './trading/CurrentTradeStateCard';
import { DecisionReasonCard } from './trading/DecisionReasonCard';
import { MarketContextCard } from './trading/MarketContextCard';
import { ShadowTraderBottomDock } from './trading/ShadowTraderBottomDock';

// ── Local type mirrors (engine types, no direct import) ───────────────────────

interface OhlcBar {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

interface MarketStatePayload {
  snapshot: LiveSnapshot | null;
  bars: { bars1m: OhlcBar[]; bars5m: OhlcBar[]; bars15m: OhlcBar[] } | null;
  source: 'tradovate' | 'simulated';
  connected: boolean;
  symbol: string | null;
}

type TradeAdviceVerdict = 'buy' | 'wait' | 'skip' | 'reduce_size' | 'missing_confirmation';
type TradeAdviceConfidence = 'low' | 'medium' | 'high';

interface TradeAdviceResult {
  verdict: TradeAdviceVerdict;
  confidence: TradeAdviceConfidence;
  summary: string;
  strengths: string[];
  warnings: string[];
  ruleViolations: string[];
  suggestedSize?: number;
  riskDollars?: number;
  rewardDollars?: number;
  rr?: number;
}

interface LiveSnapshot {
  connected: boolean;
  accountMode: 'simulation' | 'live' | 'unknown';
  symbol: string;
  lastPrice?: number;
  bidPrice?: number;
  askPrice?: number;
  highOfDay?: number;
  lowOfDay?: number;
  trend?: 'up' | 'down' | 'range' | 'unknown';
  feedFreshnessMs?: number;
  warning?: string;
  atr5m?: number;
  vwap?: number;
  trend5m?: string;
  trend15m?: string;
  sessionLabel?: string;
  volatilityRegime?: string;
}

interface ShadowTrade {
  id: string;
  symbol: string;
  side: 'long' | 'short';
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
  qty: number;
  status: 'open' | 'closed';
  openedAt: number;
  closedAt?: number;
  exitPrice?: number;
  exitReason?: string;
  pnl?: number;
  pnlR?: number;
  unrealizedPnl?: number;
  reason: string;
  verdict: string;
  setupType?: string;
  invalidationRule?: string;
  qualityScore?: number;
  // Phase 7: Explainability
  explanation?: { setupGrade: 'A' | 'B' | 'C' | 'D'; confidenceLabel: 'high' | 'medium' | 'low'; whyNow: string[]; keyRisks: string[]; invalidationTriggers: string[]; councilSummary: { approved: boolean; avgConfidence: number; agreementLabel: 'strong' | 'mixed' | 'weak'; providerReasons: Array<{ provider: string; vote: string; confidence: number; reason: string }> }; ruleSummary: { strengths: string[]; warnings: string[]; violations: string[] }; trustNote: string };
  setupGrade?: 'A' | 'B' | 'C' | 'D';
}

interface TradovateAccountPosition {
  symbol: string;
  netPos: number;
  avgPrice: number;
  openPnl: number;
}

interface TradovateWorkingOrder {
  orderId: number;
  symbol: string;
  side: 'Buy' | 'Sell';
  qty: number;
  limitPrice?: number;
  orderType: string;
  status: string;
}

interface TradovateAccountState {
  accountId: number;
  accountName: string;
  cashBalance: number;
  openPnl: number;
  totalPnl: number;
  marginBalance: number;
  buyingPower: number;
  accountMode: 'simulation' | 'live' | 'unknown';
  positions: TradovateAccountPosition[];
  workingOrders: TradovateWorkingOrder[];
}

type SetupType = 'breakout_long' | 'breakout_short' | 'pullback_long' | 'pullback_short' | 'reversal_long' | 'reversal_short' | 'none';

interface ProposedTradeSetup {
  setupType: SetupType;
  side: 'long' | 'short' | null;
  entry?: number;
  stop?: number;
  target?: number;
  stopPoints?: number;
  thesis: string;
  confidence: 'low' | 'medium' | 'high';
}

interface ShadowAccountSettings {
  startingBalance: number;
  riskPercentPerTrade: number;
  maxDailyLossPercent: number;
  maxTradesPerDay: number;
  maxConcurrentPositions: number;
}

interface ShadowAccountState {
  enabled: boolean;
  paused: boolean;
  settings: ShadowAccountSettings;
  startingBalance: number;
  currentBalance: number;
  dailyPnL: number;
  tradesToday: number;
  openTrades: ShadowTrade[];
  closedTrades: ShadowTrade[];
  lastEvalAt?: number;
  blockedReason?: string;
}

// ── Phase 3: Analytics type mirrors ──────────────────────────────────────────

interface ShadowPerformanceSummary {
  totalTrades: number; wins: number; losses: number; winRate: number;
  avgPnlR: number; avgWinR: number; avgLossR: number;
  profitFactor: number; expectancyR: number; totalPnlDollars: number;
  maxConsecutiveWins: number; maxConsecutiveLosses: number;
  avgTimeInTradeMs: number; avgMfeR: number; avgMaeR: number;
  edgeCaptureRatio: number;
}

interface BucketPerformanceSummary {
  bucket: string; trades: number; winRate: number; avgPnlR: number; totalPnlDollars: number;
}

interface CouncilEffectivenessSummary {
  totalReviews: number; approvals: number; rejections: number;
  approvalRate: number; approvedWinRate: number;
  avgConfidenceWins: number; avgConfidenceLosses: number;
  providerAccuracy: Record<string, { votes: number; correctCalls: number; accuracy: number }>;
}

interface ShadowAnalyticsSummary {
  overall: ShadowPerformanceSummary;
  bySession: BucketPerformanceSummary[];
  bySetupType: BucketPerformanceSummary[];
  bySymbol: BucketPerformanceSummary[];
  council: CouncilEffectivenessSummary;
  decisionFunnel: Record<string, number>;
  topBlockReasons: Array<{ reason: string; count: number; pct: number }>;
  eventCount: number;
  oldestEventTs: number;
  newestEventTs: number;
}

// ── Phase 4: Refinement type mirrors ────────────────────────────────────────

interface StrategyInsight {
  category: string; bucket: string; trades: number; winRate: number;
  avgPnlR: number; totalPnlDollars: number; sampleTier: string;
  recommendation: string; rationale: string;
}

interface StrategyRefinementSummary {
  generatedAt: number; totalClosedTrades: number;
  baselineWinRate: number; baselineAvgPnlR: number;
  insights: StrategyInsight[];
  config: Record<string, unknown>;
}

// ── Phase 5: Readiness type mirrors ──────────────────────────────────────────
type StrategyReadinessState = 'not_ready' | 'developing' | 'paper_ready' | 'guarded_live_candidate';
interface ThresholdCheck { key: string; currentValue: number; requiredValue: number; passed: boolean; rationale: string; }
interface StabilityCheck { category: string; bucket: string; trades: number; metric: number; metricName: string; passed: boolean; rationale: string; }
interface StrategyReadinessReport {
  state: StrategyReadinessState; generatedAt: number;
  performance: ShadowPerformanceSummary; maxDrawdownR: number;
  thresholdChecks: ThresholdCheck[]; stabilityChecks: StabilityCheck[];
  stabilityPassed: boolean; blockers: string[]; advisory: string;
}

// ── Phase 6: Promotion type mirrors ─────────────────────────────────────────
type TradingOperationMode = 'shadow' | 'paper' | 'guarded_live_candidate';
interface ModeGuardrails {
  dailyLossCapR: number; maxTradesPerDay: number; maxPositionSize: number;
  manualConfirmation: boolean; autoDemotionEnabled: boolean; lossStreakDemotion: number;
}
interface PromotionWorkflowStatus {
  currentMode: TradingOperationMode; promotedAt?: number; demotedAt?: number;
  demotionReason?: string; dailyLossR: number; tradesTodayPromoted: number;
  consecutiveLosses: number; activeGuardrails: ModeGuardrails;
  guardrails: { paper: ModeGuardrails; guardedLiveCandidate: ModeGuardrails };
  lastReadinessState: StrategyReadinessState;
}

// ── Derived state types + helpers ────────────────────────────────────────────

type ShadowTraderUiState =
  | 'DISCONNECTED' | 'READY' | 'RUNNING' | 'PAUSED' | 'BLOCKED' | 'OPEN_POSITION';

interface DerivedDisplayState {
  uiState: ShadowTraderUiState;
  sentence: string;
  sessionLabel: string | null;
  feedSource: 'Live Tradovate' | 'Simulated';
}

interface ChartLevel {
  price: number;
  type: string;
  strength: number;
  grade?: string;
}

interface ChartEvent {
  timestamp: number;
  type: 'approved' | 'rejected';
  side?: string;
  price?: number;
}

interface ActiveChartModel {
  symbol: string;
  timeframe: '1m' | '5m' | '15m';
  source: 'live' | 'sim';
  bars: OhlcBar[];
  tradeOverlay: { entryPrice: number; stopPrice: number; targetPrice: number; side: 'long' | 'short' } | null;
  currentPrice: number | undefined;
  feedFreshnessMs: number | undefined;
  levels: ChartLevel[];
  events: ChartEvent[];
}

function normalizeSymbol(s: string): string {
  return s.trim().toUpperCase();
}

function deriveShadowTraderUiState(
  isConnected: boolean,
  shadow: ShadowAccountState | null,
  simulatorState: any,
  symbol: string,
  snapshot: LiveSnapshot | null,
  marketSource: 'tradovate' | 'simulated' | undefined,
): DerivedDisplayState {
  const feedSource: 'Live Tradovate' | 'Simulated' =
    marketSource === 'tradovate' ? 'Live Tradovate' : 'Simulated';
  const sessionLabel = snapshot?.sessionLabel ?? null;

  // Not connected to any feed and shadow not enabled
  if (!isConnected && !shadow?.enabled) {
    return { uiState: 'DISCONNECTED', sentence: 'No market feed connected. Connect Tradovate or enable Shadow Trading to start.', sessionLabel, feedSource };
  }

  // Shadow not enabled but feed is connected
  if (!shadow?.enabled) {
    return { uiState: 'READY', sentence: `Market feed active on ${symbol}. Enable Shadow Trading to begin.`, sessionLabel, feedSource };
  }

  // Shadow enabled — check for open position on the CURRENT symbol
  const tradeOnSymbol = shadow.openTrades.find(tr => normalizeSymbol(tr.symbol) === normalizeSymbol(symbol));
  if (tradeOnSymbol) {
    const pnlStr = tradeOnSymbol.unrealizedPnl !== undefined ? ` (${tradeOnSymbol.unrealizedPnl >= 0 ? '+' : ''}$${tradeOnSymbol.unrealizedPnl.toFixed(2)})` : '';
    return { uiState: 'OPEN_POSITION', sentence: `Open ${tradeOnSymbol.side.toUpperCase()} on ${tradeOnSymbol.symbol} @ ${tradeOnSymbol.entryPrice}${pnlStr}`, sessionLabel, feedSource };
  }
  // Open trade exists on a DIFFERENT symbol — note it but don't override this symbol's state
  const otherTrade = shadow.openTrades.length > 0 ? shadow.openTrades[0] : null;
  const otherTradeNote = otherTrade ? ` (open ${otherTrade.side} on ${otherTrade.symbol})` : '';

  // Shadow enabled, paused
  if (shadow.paused) {
    return { uiState: 'PAUSED', sentence: `Shadow Trading paused — no new trades will be taken.${otherTradeNote}`, sessionLabel, feedSource };
  }

  // Shadow enabled, blocked
  if (shadow.blockedReason || simulatorState?.blockedReason) {
    const reason = shadow.blockedReason || simulatorState?.blockedReason || 'Unknown';
    return { uiState: 'BLOCKED', sentence: `Blocked: ${reason}${otherTradeNote}`, sessionLabel, feedSource };
  }

  // Shadow enabled, running
  return { uiState: 'RUNNING', sentence: `Shadow Trading active on ${symbol} — scanning for setups.${otherTradeNote}`, sessionLabel, feedSource };
}

// ── Constants ─────────────────────────────────────────────────────────────────

const SYMBOL_LABELS: Record<string, string> = {
  NQ:  'Nasdaq-100 (Full)',
  MNQ: 'Micro Nasdaq-100',
  ES:  'S&P 500 (Full)',
  MES: 'Micro S&P 500',
  RTY: 'Russell 2000',
  M2K: 'Micro Russell 2000',
  CL:  'Crude Oil',
  GC:  'Gold',
};
const SUPPORTED_SYMBOLS = Object.keys(SYMBOL_LABELS);

const VERDICT_CONFIG: Record<TradeAdviceVerdict, { label: string; color: string; bg: string }> = {
  buy:                  { label: 'BUY',                  color: '#34d399', bg: 'rgba(52,211,153,0.12)' },
  wait:                 { label: 'WAIT',                 color: '#fbbf24', bg: 'rgba(251,191,36,0.12)' },
  skip:                 { label: 'SKIP',                 color: '#f87171', bg: 'rgba(248,113,113,0.12)' },
  reduce_size:          { label: 'REDUCE SIZE',          color: '#fb923c', bg: 'rgba(251,146,60,0.12)' },
  missing_confirmation: { label: 'MISSING CONFIRMATION', color: 'rgba(255,255,255,0.4)', bg: 'rgba(255,255,255,0.05)' },
};

// ── Component ─────────────────────────────────────────────────────────────────

export function LiveTradeAdvisor({ onBack }: { onBack: () => void }) {
  // ── Connection state ────────────────────────────────────────────────────────
  const [isConnected, setIsConnected]     = useState(false);
  const [accountMode, setAccountMode]     = useState<'simulation' | 'live' | 'unknown'>('unknown');
  // showConnForm removed — connection form is now in dock Settings tab
  const [connCreds, setConnCreds]         = useState({ username: '', password: '', accountMode: 'simulation' as 'simulation' | 'live', cid: '', sec: '' });
  const [connecting, setConnecting]       = useState(false);
  const [connError, setConnError]         = useState<string | null>(null);

  // ── Balance / risk ──────────────────────────────────────────────────────────
  const [balance, setBalance]             = useState('25000');
  const [riskPct, setRiskPct]             = useState('1');

  // ── Symbol / setup ──────────────────────────────────────────────────────────
  const [symbol, setSymbol]               = useState('NQ');
  const [side, setSide]                   = useState<'long' | 'short'>('long');
  const [entry, setEntry]                 = useState('');
  const [stop, setStop]                   = useState('');
  const [target, setTarget]               = useState('');
  const [thesis, setThesis]               = useState('');

  // ── Live snapshot ───────────────────────────────────────────────────────────
  const [snapshot, setSnapshot]           = useState<LiveSnapshot | null>(null);
  const fastPollRef                       = useRef<ReturnType<typeof setInterval> | null>(null);
  const medPollRef                        = useRef<ReturnType<typeof setInterval> | null>(null);
  const slowPollRef                       = useRef<ReturnType<typeof setInterval> | null>(null);

  // ── Advice ──────────────────────────────────────────────────────────────────
  const [advice, setAdvice]               = useState<TradeAdviceResult | null>(null);
  const [adviceLoading, setAdviceLoading] = useState(false);
  const [councilReview, setCouncilReview] = useState<string | null>(null);
  const [councilLoading, setCouncilLoading] = useState(false);

  // ── Shadow trading ──────────────────────────────────────────────────────────
  const [shadow, setShadow]               = useState<ShadowAccountState | null>(null);
  const [shadowToggling, setShadowToggling] = useState(false);
  const [shadowResetConfirm, setShadowResetConfirm] = useState(false);
  const [showHistory, setShowHistory]     = useState(false);

  // ── Shadow analytics (Phase 3) ────────────────────────────────────────────
  const [showAnalytics, setShowAnalytics] = useState(false);
  const [analyticsSummary, setAnalyticsSummary] = useState<ShadowAnalyticsSummary | null>(null);
  const [analyticsLoading, setAnalyticsLoading] = useState(false);

  // ── Strategy refinement (Phase 4) ──────────────────────────────────────────
  const [refinementSummary, setRefinementSummary] = useState<StrategyRefinementSummary | null>(null);
  const [readinessReport, setReadinessReport] = useState<StrategyReadinessReport | null>(null);

  // ── Promotion workflow (Phase 6) ──────────────────────────────────────────
  const [promotionStatus, setPromotionStatus] = useState<PromotionWorkflowStatus | null>(null);
  const [promotionLoading, setPromotionLoading] = useState(false);

  // Phase 7: Trust Layer state
  const [blockedExplanations, setBlockedExplanations] = useState<any[]>([]);
  const [gradeSummary, setGradeSummary] = useState<any[] | null>(null);
  const [councilValueAdded, setCouncilValueAdded] = useState<any | null>(null);
  const [showBlockedTrades, setShowBlockedTrades] = useState(false);

  // Level Engine Inspector state
  const [levelMap, setLevelMap] = useState<any>(null);
  const [pathPrediction, setPathPrediction] = useState<any>(null);
  const [watches, setWatches] = useState<any[]>([]);
  const [reviewedIntents, setReviewedIntents] = useState<any[]>([]);
  const [sessionContext, setSessionContext] = useState<any>(null);
  const [simPositions, setSimPositions] = useState<{ open: any[]; closed: any[]; orders: any[] }>({ open: [], closed: [], orders: [] });
  const [simulatorState, setSimulatorState] = useState<any>(null);

  // Chart state
  const [marketState, setMarketState] = useState<MarketStatePayload | null>(null);
  const [chartTimeframe, setChartTimeframe] = useState<'1m' | '5m' | '15m'>('5m');
  const [dockCollapsed, setDockCollapsed] = useState(false);
  const [dockActiveTab, setDockActiveTab] = useState<string | undefined>(undefined);

  // Pipeline visibility state
  const [blockedEvals, setBlockedEvals] = useState<any[]>([]);

  // Journal / Analytics state
  const [journalEntries, setJournalEntries] = useState<any[]>([]);
  const [expectancySummary, setExpectancySummary] = useState<any>(null);
  const [expectancyDimension, setExpectancyDimension] = useState<string>('levelType');
  const [calibrationSuggestions, setCalibrationSuggestions] = useState<any[]>([]);
  const [journalFilterSymbol, setJournalFilterSymbol] = useState('');
  const [journalFilterOutcome, setJournalFilterOutcome] = useState('');
  const [councilEffectSummary, setCouncilEffectSummary] = useState<any>(null);
  const [advisoryTargetSummary, setAdvisoryTargetSummary] = useState<any>(null);
  const [setupTrustRecords, setSetupTrustRecords] = useState<any[]>([]);
  const [latestSignal, setLatestSignal] = useState<TradeSignalAlert | null>(null);
  const [signalAge, setSignalAge] = useState(0);
  const expectancyDimRef = useRef(expectancyDimension);

  // ── Trading trial ──────────────────────────────────────────────────────────
  const [trialStatus, setTrialStatus] = useState<{ active: boolean; daysRemaining: number } | null>(null);

  // ── Tradovate account + proposed setup ─────────────────────────────────────
  const [accountState, setAccountState]   = useState<TradovateAccountState | null>(null);
  const [proposedSetup, setProposedSetup] = useState<ProposedTradeSetup | null>(null);

  // ── Init ─────────────────────────────────────────────────────────────────────

  useEffect(() => {
    // Load trial status
    (window.triforge.trading as any).trialStatus?.().then((ts: any) => {
      if (ts) setTrialStatus(ts);
    }).catch(() => {});
    // Load initial status
    Promise.all([
      window.triforge.trading.tradovateStatus(),
      window.triforge.trading.shadowState(),
    ]).then(([status, shadowState]) => {
      setIsConnected(status.connected);
      setAccountMode(status.accountMode);
      setShadow(shadowState as ShadowAccountState);
      const ss = shadowState as ShadowAccountState;
      // Start polling if Tradovate is connected OR shadow trading is enabled
      // (simulated data mode still needs polling for simulator state, trades, etc.)
      if (status.connected || ss.enabled) startPolling(symbol);
      else setSnapshot({ connected: false, accountMode: 'unknown', symbol });
    }).catch(() => {
      setSnapshot({ connected: false, accountMode: 'unknown', symbol });
    });
    return () => stopPolling();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Real-time copy-trade signal listener ──────────────────────────────────
  useEffect(() => {
    const SIGNAL_EXPIRY_MS = 5 * 60 * 1000; // 5 minutes
    const unsub = (window.triforge.trading as any).onShadowTradeAlert?.((alert: TradeSignalAlert) => {
      setLatestSignal(alert);
      setSignalAge(0);
    });
    const ageTick = setInterval(() => {
      setLatestSignal(prev => {
        if (!prev) return null;
        const age = Date.now() - prev.timestamp;
        if (age > SIGNAL_EXPIRY_MS) return null; // expired
        setSignalAge(Math.round(age / 1000));
        return prev;
      });
    }, 1000);
    return () => { unsub?.(); clearInterval(ageTick); };
  }, []);

  // ── Polling (market + shadow state) ─────────────────────────────────────────

  const startPolling = useCallback((sym: string) => {
    stopPolling();

    // FAST LANE (1.5s): price-sensitive + thesis-critical
    const fastTick = async () => {
      try {
        const [mktStateRes, shadowState, simStateRes, watchesRes, reviewedRes] = await Promise.all([
          (window.triforge.trading as any).marketState?.() ?? Promise.resolve(null),
          window.triforge.trading.shadowState(),
          (window.triforge.trading as any).simulatorStateGet?.() ?? Promise.resolve(null),
          (window.triforge.trading as any).watchesGet?.() ?? Promise.resolve(null),
          (window.triforge.trading as any).reviewedIntentsGet?.() ?? Promise.resolve(null),
        ]);
        if (mktStateRes?.marketState) {
          const ms = mktStateRes.marketState as MarketStatePayload;
          setMarketState(ms);
          if (ms.snapshot) setSnapshot(ms.snapshot);
        }
        setShadow(shadowState as ShadowAccountState);
        if (simStateRes?.state) setSimulatorState(simStateRes.state);
        if (watchesRes?.watches) setWatches(watchesRes.watches);
        if (reviewedRes?.reviewed) setReviewedIntents(reviewedRes.reviewed);
      } catch { /* ignore */ }
    };

    // MEDIUM LANE (4s): engine analysis
    const medTick = async () => {
      try {
        const [levelMapRes, predRes, sessionRes, posBookRes, setupRes, blockedEvalsRes] = await Promise.all([
          (window.triforge.trading as any).levelMapGet?.() ?? Promise.resolve(null),
          (window.triforge.trading as any).pathPredictionGet?.() ?? Promise.resolve(null),
          (window.triforge.trading as any).sessionContextGet?.() ?? Promise.resolve(null),
          (window.triforge.trading as any).positionBookGet?.() ?? Promise.resolve(null),
          (window.triforge.trading as any).buildTradeLevels?.(sym) ?? Promise.resolve(null),
          (window.triforge.trading as any).blockedEvaluationsGet?.() ?? Promise.resolve(null),
        ]);
        if (levelMapRes?.levelMap) setLevelMap(levelMapRes.levelMap);
        if (predRes?.prediction) setPathPrediction(predRes.prediction);
        if (sessionRes?.session) setSessionContext(sessionRes.session);
        if (posBookRes) setSimPositions({ open: posBookRes.open ?? [], closed: posBookRes.closed ?? [], orders: posBookRes.orders ?? [] });
        if (setupRes?.setup) setProposedSetup(setupRes.setup as ProposedTradeSetup);
        if (blockedEvalsRes?.blocked) setBlockedEvals(blockedEvalsRes.blocked);
      } catch { /* ignore */ }
    };

    // SLOW LANE (12s): journal, analytics, account
    const slowTick = async () => {
      try {
        const [journalRes, expectancyRes, weightsRes, councilEffRes, advisoryTargetRes, acctRes, trustRes] = await Promise.all([
          (window.triforge.trading as any).journalEntriesGet?.({ limit: 50 }) ?? Promise.resolve(null),
          (window.triforge.trading as any).journalExpectancyGet?.(expectancyDimRef.current) ?? Promise.resolve(null),
          (window.triforge.trading as any).journalWeightsGet?.() ?? Promise.resolve(null),
          (window.triforge.trading as any).journalExpectancyGet?.('councilConsensus') ?? Promise.resolve(null),
          (window.triforge.trading as any).journalAdvisoryTargetsGet?.() ?? Promise.resolve(null),
          (window.triforge.trading as any).tradovateAccountState?.() ?? Promise.resolve(null),
          (window.triforge.trading as any).reliabilitySetupTrust?.() ?? Promise.resolve(null),
        ]);
        if (journalRes?.entries) setJournalEntries(journalRes.entries);
        if (expectancyRes?.summary) setExpectancySummary(expectancyRes.summary);
        if (weightsRes?.suggestions) setCalibrationSuggestions(weightsRes.suggestions);
        if (councilEffRes?.summary) setCouncilEffectSummary(councilEffRes.summary);
        if (advisoryTargetRes?.summary) setAdvisoryTargetSummary(advisoryTargetRes.summary);
        if (acctRes?.state) setAccountState(acctRes.state as TradovateAccountState);
        if (trustRes?.records) setSetupTrustRecords(trustRes.records);
      } catch { /* ignore */ }
    };

    // Fire all immediately, then set intervals
    fastTick(); medTick(); slowTick();
    fastPollRef.current = setInterval(fastTick, 1500);
    medPollRef.current = setInterval(medTick, 4000);
    slowPollRef.current = setInterval(slowTick, 12000);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const stopPolling = useCallback(() => {
    if (fastPollRef.current) { clearInterval(fastPollRef.current); fastPollRef.current = null; }
    if (medPollRef.current) { clearInterval(medPollRef.current); medPollRef.current = null; }
    if (slowPollRef.current) { clearInterval(slowPollRef.current); slowPollRef.current = null; }
  }, []);

  const handleSymbolChange = (sym: string) => {
    setSymbol(sym);
    setAdvice(null);
    setCouncilReview(null);
    // Notify backend so both simulated and Tradovate providers sync to new symbol
    (window.triforge.trading as any).shadowSetSymbol?.(sym);
    // Restart polling on symbol change (works for both Tradovate and simulated)
    if (isConnected || shadow?.enabled) startPolling(sym);
  };

  // ── Shadow analytics fetch (Phase 3 + 4) ─────────────────────────────────────
  const closedCount = shadow?.closedTrades.length ?? 0;
  useEffect(() => {
    if (!showAnalytics || !shadow?.enabled) return;
    setAnalyticsLoading(true);
    Promise.all([
      (window.triforge.trading as any).shadowAnalyticsSummary(),
      (window.triforge.trading as any).shadowRefinementSummary(),
      (window.triforge.trading as any).shadowReadinessReport(),
      (window.triforge.trading as any).promotionStatus(),
      (window.triforge.trading as any).recentBlockedExplanations?.(),
      (window.triforge.trading as any).gradeSummary?.(),
      (window.triforge.trading as any).councilValueAdded?.(),
    ]).then(([analyticsRes, refinementRes, readinessRes, promotionRes, blockedRes, gradeRes, councilValueRes]: any[]) => {
      if (analyticsRes?.summary) setAnalyticsSummary(analyticsRes.summary as ShadowAnalyticsSummary);
      if (refinementRes?.summary) setRefinementSummary(refinementRes.summary as StrategyRefinementSummary);
      if (readinessRes?.report) setReadinessReport(readinessRes.report as StrategyReadinessReport);
      if (promotionRes?.status) setPromotionStatus(promotionRes.status as PromotionWorkflowStatus);
      if (blockedRes?.explanations) setBlockedExplanations(blockedRes.explanations);
      if (gradeRes?.summary) setGradeSummary(gradeRes.summary);
      if (councilValueRes?.analysis) setCouncilValueAdded(councilValueRes.analysis);
    }).catch(() => {}).finally(() => setAnalyticsLoading(false));
  }, [showAnalytics, closedCount, shadow?.enabled]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleAnalyticsClear = async () => {
    await (window.triforge.trading as any).shadowAnalyticsClear();
    setAnalyticsSummary(null);
    setReadinessReport(null);
    setShowAnalytics(false);
  };

  // ── Promotion workflow handlers (Phase 6) ─────────────────────────────────
  const refreshPromotionStatus = async () => {
    try {
      const res = await (window.triforge.trading as any).promotionStatus();
      if (res?.status) setPromotionStatus(res.status as PromotionWorkflowStatus);
    } catch { /* ignore */ }
  };

  const handlePromote = async (targetMode: TradingOperationMode) => {
    setPromotionLoading(true);
    try {
      const res = await (window.triforge.trading as any).promotionModeSet(targetMode);
      if (res?.error) { alert(res.error); return; }
      await refreshPromotionStatus();
    } finally { setPromotionLoading(false); }
  };

  const handleReturnToShadow = async () => {
    setPromotionLoading(true);
    try {
      await (window.triforge.trading as any).promotionModeSet('shadow');
      await refreshPromotionStatus();
    } finally { setPromotionLoading(false); }
  };

  const handleConfirmPendingTrade = async () => {
    await (window.triforge.trading as any).confirmPendingTrade();
    setShadow(await window.triforge.trading.shadowState() as ShadowAccountState);
  };

  const handleRejectPendingTrade = async () => {
    await (window.triforge.trading as any).rejectPendingTrade();
    setShadow(await window.triforge.trading.shadowState() as ShadowAccountState);
  };

  // ── Connection ───────────────────────────────────────────────────────────────

  const handleConnect = async () => {
    if (!connCreds.username || !connCreds.password) { setConnError('Username and password required.'); return; }
    setConnecting(true); setConnError(null);
    try {
      const res = await window.triforge.trading.tradovateConnect({
        username: connCreds.username, password: connCreds.password,
        accountMode: connCreds.accountMode,
        cid: connCreds.cid ? Number(connCreds.cid) : undefined,
        sec: connCreds.sec || undefined,
      });
      if (res.error) { setConnError(res.error); return; }
      const status = await window.triforge.trading.tradovateStatus();
      setIsConnected(status.connected);
      setAccountMode(status.accountMode);
      setShowConnForm(false);
      startPolling(symbol);
    } catch (err) {
      setConnError(err instanceof Error ? err.message : String(err));
    } finally { setConnecting(false); }
  };

  const handleDisconnect = async () => {
    stopPolling();
    await window.triforge.trading.tradovateDisconnect();
    setIsConnected(false); setAccountMode('unknown');
    setSnapshot({ connected: false, accountMode: 'unknown', symbol });
    setAdvice(null); setCouncilReview(null);
  };

  // ── Advice ───────────────────────────────────────────────────────────────────

  const handleGetAdvice = async () => {
    setAdviceLoading(true); setAdvice(null); setCouncilReview(null);
    try {
      const snap: LiveSnapshot = snapshot ?? { connected: false, accountMode: 'unknown', symbol };
      const res = await window.triforge.trading.buildAdvice({
        snapshot: snap as unknown,
        balance: parseFloat(balance) || 0,
        riskPercent: parseFloat(riskPct) || 1,
        symbol, side,
        thesis: thesis.trim() || undefined,
        entry: entry ? parseFloat(entry) : undefined,
        stop: stop ? parseFloat(stop) : undefined,
        target: target ? parseFloat(target) : undefined,
      });
      if (res.result) setAdvice(res.result as TradeAdviceResult);
    } catch (err) {
      setAdvice({ verdict: 'skip', confidence: 'low', summary: String(err), strengths: [], warnings: [], ruleViolations: [] });
    } finally { setAdviceLoading(false); }
  };

  const handleCouncilReview = async () => {
    if (!advice) return;
    setCouncilLoading(true); setCouncilReview(null);
    try {
      const prompt = buildCouncilPrompt({ symbol, side, entry, stop, target, thesis, balance, riskPct, snapshot, advice });
      // Real 3-model consensus — all active providers vote in parallel, synthesis combines them.
      const res = await (window.triforge as any).chat?.consensus(prompt, [], 'analytical');
      const synthesis = (res as { synthesis?: string; responses?: Array<{ provider: string; text: string }> })?.synthesis;
      const responses = (res as { responses?: Array<{ provider: string; text: string }> })?.responses ?? [];
      // Build a combined display: individual seats + synthesis
      const parts: string[] = [];
      for (const r of responses) {
        parts.push(`[${r.provider}]\n${r.text.trim()}`);
      }
      if (synthesis) parts.push(`\n— Council Synthesis —\n${synthesis.trim()}`);
      setCouncilReview(parts.join('\n\n') || 'No response from council.');
    } catch (err) {
      setCouncilReview(`Council review failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally { setCouncilLoading(false); }
  };

  // ── Shadow trading ───────────────────────────────────────────────────────────

  const handleShadowToggle = async () => {
    if (!shadow) return;
    setShadowToggling(true);
    try {
      if (shadow.enabled) {
        await window.triforge.trading.shadowDisable();
        // Stop polling if Tradovate is also not connected
        if (!isConnected) stopPolling();
      } else {
        await window.triforge.trading.shadowEnable();
        // Start polling for simulator state even without Tradovate
        startPolling(symbol);
      }
      const state = await window.triforge.trading.shadowState();
      setShadow(state as ShadowAccountState);
    } finally { setShadowToggling(false); }
  };

  const handleShadowPauseResume = async () => {
    if (!shadow) return;
    if (shadow.paused) await window.triforge.trading.shadowResume();
    else               await window.triforge.trading.shadowPause();
    setShadow(await window.triforge.trading.shadowState() as ShadowAccountState);
  };

  const handleShadowReset = async () => {
    if (!shadowResetConfirm) { setShadowResetConfirm(true); return; }
    await window.triforge.trading.shadowReset();
    setShadow(await window.triforge.trading.shadowState() as ShadowAccountState);
    setShadowResetConfirm(false);
  };

  const handleShadowFlatten = async () => {
    await window.triforge.trading.shadowFlatten();
    setShadow(await window.triforge.trading.shadowState() as ShadowAccountState);
  };

  // ── Derived values ───────────────────────────────────────────────────────────

  const maxRiskDollars = (parseFloat(balance) || 0) * (parseFloat(riskPct) || 1) / 100;
  const shadowPnlColor = !shadow ? 'rgba(255,255,255,0.7)' : shadow.dailyPnL > 0 ? '#34d399' : shadow.dailyPnL < 0 ? '#f87171' : 'rgba(255,255,255,0.7)';
  const shadowBalPct   = shadow ? ((shadow.currentBalance - shadow.startingBalance) / shadow.startingBalance * 100) : 0;

  // ── Derived display state ─────────────────────────────────────────────────
  const displayState: DerivedDisplayState = deriveShadowTraderUiState(
    isConnected, shadow, simulatorState, symbol, snapshot, marketState?.source,
  );

  // ── Active chart model (single source of truth for chart UI) ──────────────
  const activeTradeForSymbol = shadow?.openTrades?.find(
    t => normalizeSymbol(t.symbol) === normalizeSymbol(symbol)
  ) ?? null;

  const chartModel: ActiveChartModel = {
    symbol: marketState?.symbol ?? symbol,
    timeframe: chartTimeframe,
    source: marketState?.source === 'tradovate' ? 'live' : 'sim',
    bars: !marketState?.bars ? [] :
      chartTimeframe === '1m' ? marketState.bars.bars1m :
      chartTimeframe === '5m' ? marketState.bars.bars5m :
      marketState.bars.bars15m,
    tradeOverlay: activeTradeForSymbol ? {
      entryPrice: activeTradeForSymbol.entryPrice,
      stopPrice: activeTradeForSymbol.stopPrice,
      targetPrice: activeTradeForSymbol.targetPrice,
      side: activeTradeForSymbol.side,
    } : null,
    currentPrice: snapshot?.lastPrice,
    feedFreshnessMs: snapshot?.feedFreshnessMs,
    levels: levelMap?.levels?.filter((l: any) => !l.broken).slice(0, 8).map((l: any) => ({
      price: l.price, type: l.type, strength: l.strength ?? 50, grade: l.grade,
    })) ?? [],
    events: reviewedIntents.slice(0, 10).map((ri: any) => ({
      timestamp: ri.reviewedAt ?? 0,
      type: ri.outcome as 'approved' | 'rejected',
      side: ri.intent?.side,
      price: ri.intent?.entry,
    })),
  };

  // ── Render ───────────────────────────────────────────────────────────────────

  return (
    <div style={s.page}>
      {/* ── Sticky Header ── */}
      <ShadowTraderHeader
        symbol={symbol}
        supportedSymbols={SUPPORTED_SYMBOLS}
        symbolLabels={SYMBOL_LABELS}
        onSymbolChange={handleSymbolChange}
        displayState={displayState}
        onStartShadow={handleShadowToggle}
        onPauseShadow={handleShadowPauseResume}
        onResumeShadow={handleShadowPauseResume}
        onFlattenStop={handleShadowFlatten}
        onConnectFeed={() => { setDockCollapsed(false); setDockActiveTab('settings'); }}
        onBack={onBack}
        shadowEnabled={shadow?.enabled ?? false}
        shadowPaused={shadow?.paused ?? false}
        hasOpenTrades={(shadow?.openTrades?.length ?? 0) > 0}
        lastEvalAt={shadow?.lastEvalAt ?? null}
        shadowToggling={shadowToggling}
      />

      {/* ── Trading Trial Banner ── */}
      {trialStatus?.active && (
        <div style={s.trialBanner}>
          Trading features are free for {trialStatus.daysRemaining} more day{trialStatus.daysRemaining !== 1 ? 's' : ''}.
          All trading capabilities are unlocked during the trial period.
        </div>
      )}

      <div style={s.disclaimer}>
        No live orders are placed by this feature. Shadow trades use virtual funds only. Always confirm inside Tradovate.
      </div>

      {/* ── Latest Signal Strip (persistent copy-trade reference) ── */}
      {shadow?.enabled && latestSignal && (
        <LatestSignalStrip signal={latestSignal} ageSec={signalAge} />
      )}

      <div style={s.body}>
        {/* ── Main chart-first layout ── */}
        <>

        {/* ── 1. Main Workspace: Chart + Decision Rail ── */}
        <div style={s.mainWorkspace}>
          {/* LEFT: Chart area (~70%) */}
          <div style={s.chartArea}>
            <ChartTruthStrip
              symbol={chartModel.symbol}
              timeframe={chartModel.timeframe}
              source={chartModel.source}
              feedFreshnessMs={chartModel.feedFreshnessMs}
              tradeOverlay={chartModel.tradeOverlay}
              uiState={displayState.uiState}
            />
            <CandlestickChart
              bars={chartModel.bars}
              timeframe={chartModel.timeframe}
              onTimeframeChange={setChartTimeframe}
              currentPrice={chartModel.currentPrice}
              symbol={chartModel.symbol}
              source={marketState?.source}
              feedFreshnessMs={chartModel.feedFreshnessMs}
              tradeOverlay={chartModel.tradeOverlay}
              levels={chartModel.levels}
              events={chartModel.events}
              height={400}
            />
            {marketState?.bars && (
              <MarketDataStrip
                lastPrice={snapshot?.lastPrice}
                bidPrice={snapshot?.bidPrice}
                askPrice={snapshot?.askPrice}
                highOfDay={snapshot?.highOfDay}
                lowOfDay={snapshot?.lowOfDay}
                trend={snapshot?.trend}
                feedFreshnessMs={snapshot?.feedFreshnessMs}
                source={marketState.source}
              />
            )}
          </div>

          {/* RIGHT: Decision rail (~30%) */}
          <div style={s.decisionRail}>
            <CurrentTradeStateCard
              trade={activeTradeForSymbol}
              blockedReason={shadow?.blockedReason ?? simulatorState?.blockedReason ?? null}
            />
            <DecisionReasonCard
              shadowBlockedReason={shadow?.blockedReason ?? null}
              simulatorBlockedReason={simulatorState?.blockedReason ?? null}
              latestReviewed={reviewedIntents[0] ?? null}
              shadowEnabled={shadow?.enabled ?? false}
            />
            <MarketContextCard
              regimeContext={simulatorState?.regimeContext ?? null}
              pathPrediction={pathPrediction}
              sessionLabel={displayState.sessionLabel}
              newsBlocked={simulatorState?.newsRiskContext?.blocked ?? false}
              newsReason={simulatorState?.newsRiskContext?.reason ?? null}
            />
            <TradeThesisPanel
              pathPrediction={pathPrediction}
              snapshot={snapshot}
              levelMap={levelMap}
              proposedSetup={proposedSetup}
              reviewedIntents={reviewedIntents}
              watches={watches}
              shadow={shadow}
              simulatorState={simulatorState}
              sessionContext={sessionContext}
            />
            <ReliabilityPanel reliability={simulatorState?.signalReliability ?? null} />
          </div>
        </div>

        {/* ── Bottom Dock ── */}
        <ShadowTraderBottomDock
          simPositions={simPositions}
          shadow={shadow}
          accountState={accountState}
          reviewedIntents={reviewedIntents}
          simulatorState={simulatorState}
          journalEntries={journalEntries}
          journalFilterSymbol={journalFilterSymbol}
          journalFilterOutcome={journalFilterOutcome}
          onFilterSymbolChange={setJournalFilterSymbol}
          onFilterOutcomeChange={setJournalFilterOutcome}
          expectancySummary={expectancySummary}
          expectancyDimension={expectancyDimension}
          onExpectancyDimensionChange={(d: string) => { setExpectancyDimension(d); expectancyDimRef.current = d; }}
          councilEffectSummary={councilEffectSummary}
          advisoryTargetSummary={advisoryTargetSummary}
          calibrationSuggestions={calibrationSuggestions}
          setupTrustRecords={setupTrustRecords}
          activeSetupFamily={simulatorState?.signalReliability ? (reviewedIntents.find((r: any) => r.outcome === 'approved')?.intent?.setupFamily ?? null) : null}
          activeRegime={simulatorState?.regimeContext?.current?.regime ?? null}
          blockedEvals={blockedEvals}
          snapshot={snapshot}
          levelMap={levelMap}
          pathPrediction={pathPrediction}
          watches={watches}
          sessionContext={sessionContext}
          blockedEvaluations={blockedEvals}
          reliability={simulatorState?.signalReliability ?? null}
          collapsed={dockCollapsed}
          onToggleCollapsed={() => setDockCollapsed(c => !c)}
          externalActiveTab={dockActiveTab as any}
          onTabChange={() => setDockActiveTab(undefined)}
          renderConnectionForm={() => !isConnected ? (
            <div style={s.card}>
              <div style={s.cardTitle}>Connect Tradovate</div>
              <div style={s.noteBox}>
                Requires a Tradovate account with API access enabled.{' '}
                To get your API credentials: log in to Tradovate, go to <strong>Settings &rarr; API Access &rarr; Generate API Key</strong>.{' '}
                Save the <strong>CID</strong> and <strong>Secret</strong> shown after generation.{' '}
                Use your <strong>dedicated API password</strong> below (not your regular login password).
              </div>
              <div style={s.row}>
                <Field label="Username"><input style={s.input} value={connCreds.username} onChange={e => setConnCreds(c => ({ ...c, username: e.target.value }))} placeholder="username" autoComplete="off" /></Field>
                <Field label="API Password"><input style={s.input} type="password" value={connCreds.password} onChange={e => setConnCreds(c => ({ ...c, password: e.target.value }))} placeholder="dedicated API password" /></Field>
              </div>
              <div style={s.row}>
                <Field label="Mode">
                  <div style={s.segmented}>
                    {(['simulation', 'live'] as const).map(m => (
                      <button key={m} style={{ ...s.seg, ...(connCreds.accountMode === m ? s.segActive : {}) }} onClick={() => setConnCreds(c => ({ ...c, accountMode: m }))}>
                        {m === 'simulation' ? 'Simulation' : 'Live'}
                      </button>
                    ))}
                  </div>
                </Field>
                <Field label="CID"><input style={s.input} value={connCreds.cid} onChange={e => setConnCreds(c => ({ ...c, cid: e.target.value }))} placeholder="e.g. 154" /></Field>
                <Field label="Secret"><input style={s.input} type="password" value={connCreds.sec} onChange={e => setConnCreds(c => ({ ...c, sec: e.target.value }))} placeholder="API secret key" /></Field>
              </div>
              {connError && <div style={s.errorBanner}>{connError}</div>}
              <div style={s.actions}>
                <button style={{ ...s.btn, ...s.btnPrimary, opacity: connecting ? 0.5 : 1 }} disabled={connecting} onClick={handleConnect}>
                  {connecting ? 'Connecting...' : 'Connect'}
                </button>
              </div>
            </div>
          ) : null}
          renderAccountSettings={() => (
            <div style={s.card}>
              <div style={s.cardTitle}>Account Settings</div>
              <div style={s.row}>
                <Field label="Balance ($)">
                  <input style={s.input} type="number" value={balance} onChange={e => { setBalance(e.target.value); setAdvice(null); }} placeholder="25000" />
                </Field>
                <Field label="Risk %">
                  <input style={{ ...s.input, width: 80 }} type="number" min="0.1" max="5" step="0.25" value={riskPct} onChange={e => { setRiskPct(e.target.value); setAdvice(null); }} />
                </Field>
                <div style={s.derivedMetric}>
                  <span style={s.derivedLabel}>Max Risk $</span>
                  <span style={s.derivedValue}>${maxRiskDollars.toFixed(0)}</span>
                </div>
              </div>
            </div>
          )}
          renderManualSetup={() => !shadow?.enabled ? (
            <div style={s.card}>
              <div style={s.cardTitle}>Your Setup</div>
              <div style={s.row}>
                <Field label="Direction">
                  <div style={s.segmented}>
                    {(['long', 'short'] as const).map(d => (
                      <button key={d} style={{ ...s.seg, ...(side === d ? (d === 'long' ? s.segLong : s.segShort) : {}) }} onClick={() => { setSide(d); setAdvice(null); }}>
                        {d === 'long' ? '▲ Long' : '▼ Short'}
                      </button>
                    ))}
                  </div>
                </Field>
              </div>
              <div style={s.row}>
                <Field label="Entry"><input style={s.input} type="number" placeholder="0.00" value={entry} onChange={e => { setEntry(e.target.value); setAdvice(null); }} /></Field>
                <Field label="Stop"><input style={s.input} type="number" placeholder="0.00" value={stop} onChange={e => { setStop(e.target.value); setAdvice(null); }} /></Field>
                <Field label="Target"><input style={s.input} type="number" placeholder="0.00" value={target} onChange={e => { setTarget(e.target.value); setAdvice(null); }} /></Field>
              </div>
              <Field label="Thesis">
                <textarea style={s.textarea} rows={2} placeholder="Entry catalyst, structure, invalidation..." value={thesis} onChange={e => { setThesis(e.target.value); setAdvice(null); }} />
              </Field>
            </div>
          ) : null}
        />

        {/* Positions, comparisons, blocked candidates, history, analytics — now in bottom dock */}
        </>
      </div>

      {/* Real-time copy-trade signal toasts */}
      <ShadowTradeToastContainer />
    </div>
  );
}

// ── Latest Signal Strip ──────────────────────────────────────────────────────

function LatestSignalStrip({ signal, ageSec }: { signal: TradeSignalAlert; ageSec: number }) {
  const isOpen = signal.type === 'trade_opened';
  const sideColor = signal.side === 'long' ? '#34d399' : '#f87171';

  type Freshness = 'live' | 'aging' | 'stale';
  const freshness: Freshness = ageSec < 15 ? 'live' : ageSec < 60 ? 'aging' : 'stale';
  const freshnessLabel: Record<Freshness, string> = { live: 'LIVE NOW', aging: 'AGING', stale: 'STALE' };
  const freshnessColor: Record<Freshness, string> = { live: '#34d399', aging: '#fbbf24', stale: '#f87171' };
  const fc = freshnessColor[freshness];

  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' as const,
      background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)',
      borderLeft: `3px solid ${fc}`, borderRadius: 6, padding: '6px 12px',
      margin: '0 0 4px', fontFamily: 'var(--font-mono, monospace)', fontSize: 10,
    }}>
      <span style={{ fontSize: 8, fontWeight: 800, letterSpacing: '0.08em', color: 'rgba(255,255,255,0.35)' }}>
        LATEST SIGNAL
      </span>
      <span style={{ fontWeight: 700, color: 'rgba(255,255,255,0.5)', fontSize: 9 }}>
        {isOpen ? 'OPENED' : 'CLOSED'}
      </span>
      <span style={{ fontWeight: 700, color: sideColor, fontSize: 10 }}>
        {signal.side.toUpperCase()}
      </span>
      <span style={{ fontWeight: 700, color: 'rgba(255,255,255,0.9)', fontSize: 11 }}>
        {signal.symbol}
      </span>
      <span style={{ color: 'rgba(255,255,255,0.35)', fontSize: 9 }}>
        {signal.symbolLabel}
      </span>

      {isOpen ? (
        <>
          <span style={{ color: 'rgba(255,255,255,0.6)' }}>
            Entry <b style={{ color: 'rgba(255,255,255,0.9)' }}>{signal.entryPrice.toFixed(2)}</b>
          </span>
          <span style={{ color: 'rgba(255,255,255,0.6)' }}>
            Stop <b style={{ color: 'rgba(255,255,255,0.9)' }}>{signal.stopPrice.toFixed(2)}</b>
          </span>
          <span style={{ color: 'rgba(255,255,255,0.6)' }}>
            Target <b style={{ color: 'rgba(255,255,255,0.9)' }}>{signal.targetPrice.toFixed(2)}</b>
          </span>
          {signal.setupGrade && (
            <span style={{ color: 'rgba(255,255,255,0.5)' }}>
              Grade <b>{signal.setupGrade}</b>
            </span>
          )}
        </>
      ) : (
        <>
          {signal.exitPrice != null && (
            <span style={{ color: 'rgba(255,255,255,0.6)' }}>
              Exit <b style={{ color: 'rgba(255,255,255,0.9)' }}>{signal.exitPrice.toFixed(2)}</b>
            </span>
          )}
          {signal.exitReason && (
            <span style={{ fontWeight: 700, fontSize: 9, color: signal.exitReason === 'target' ? '#34d399' : '#f87171' }}>
              {signal.exitReason.toUpperCase()}
            </span>
          )}
          {signal.pnl != null && (
            <span style={{ fontWeight: 700, color: signal.pnl >= 0 ? '#34d399' : '#f87171' }}>
              {signal.pnl >= 0 ? '+' : ''}{signal.pnl.toFixed(2)}
            </span>
          )}
        </>
      )}

      <span style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6 }}>
        <span style={{
          fontSize: 8, fontWeight: 700, letterSpacing: '0.1em',
          color: fc, border: `1px solid ${fc}`, borderRadius: 3, padding: '1px 5px',
        }}>
          {freshnessLabel[freshness]}
        </span>
        <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.25)' }}>
          {ageSec}s ago
        </span>
      </span>
    </div>
  );
}

// ── Council prompt ────────────────────────────────────────────────────────────

function buildCouncilPrompt(p: {
  symbol: string; side: string; entry: string; stop: string; target: string;
  thesis: string; balance: string; riskPct: string;
  snapshot: LiveSnapshot | null; advice: TradeAdviceResult;
}): string {
  const price = p.snapshot?.lastPrice !== undefined ? `Last: ${p.snapshot.lastPrice}` : 'No live price';
  return `[LIVE TRADE ADVISORY — Council Short Review]

Instrument: ${p.symbol} | Direction: ${p.side.toUpperCase()}
Entry: ${p.entry || 'not set'} | Stop: ${p.stop || 'not set'} | Target: ${p.target || 'not set'}
Thesis: ${p.thesis || 'none'}
Balance: $${p.balance} | Risk: ${p.riskPct}%
Live Context: ${price}, Trend: ${p.snapshot?.trend ?? 'unknown'}

Rule Engine Verdict: ${p.advice.verdict.toUpperCase()} (${p.advice.confidence} confidence)
${p.advice.summary}
${p.advice.ruleViolations.length > 0 ? `Violations: ${p.advice.ruleViolations.join('; ')}` : ''}

Provide a concise Council review (4–6 sentences): agree/disagree with verdict, what would invalidate, best next move.`;
}

// ── Sub-components ────────────────────────────────────────────────────────────

function OpenPositionRow({ trade }: { trade: ShadowTrade }) {
  const pnl   = trade.unrealizedPnl ?? 0;
  const color = pnl > 0 ? '#34d399' : pnl < 0 ? '#f87171' : 'rgba(255,255,255,0.5)';
  const qColor = trade.qualityScore !== undefined
    ? trade.qualityScore >= 70 ? '#34d399' : trade.qualityScore >= 50 ? '#fbbf24' : '#f87171'
    : 'rgba(255,255,255,0.3)';
  return (
    <div style={s.positionRow}>
      <span style={{ ...s.posSide, color: trade.side === 'long' ? '#34d399' : '#f87171' }}>
        {trade.side === 'long' ? '▲' : '▼'} {trade.side.toUpperCase()}
      </span>
      <span style={s.posSymbol}>{trade.symbol}</span>
      <span style={s.posDetail}>×{trade.qty} @ {trade.entryPrice.toFixed(2)}</span>
      <span style={s.posDetail}>Stop: {trade.stopPrice.toFixed(2)}</span>
      <span style={s.posDetail}>Target: {trade.targetPrice.toFixed(2)}</span>
      {trade.setupType && trade.setupType !== 'none' && (
        <span style={{ ...s.posDetail, color: 'rgba(96,165,250,0.7)', flexShrink: 0 }}>{trade.setupType.replace(/_/g, ' ')}</span>
      )}
      {trade.qualityScore !== undefined && (
        <span style={{ fontSize: 10, fontWeight: 700, color: qColor, flexShrink: 0 }}>Q{trade.qualityScore}</span>
      )}
      <span style={{ ...s.posPnl, color }}>{pnl >= 0 ? '+' : ''}${pnl.toFixed(0)}</span>
      <span style={s.posReason} title={trade.invalidationRule ?? trade.reason}>
        {trade.invalidationRule ?? trade.reason.slice(0, 60)}{!trade.invalidationRule && trade.reason.length > 60 ? '…' : ''}
      </span>
    </div>
  );
}

function ComparisonPanel({ symbol, userSide, userEntry, userStop, userTarget, shadowTrade }: {
  symbol: string;
  userSide: 'long' | 'short';
  userEntry?: number;
  userStop?: number;
  userTarget?: number;
  shadowTrade: ShadowTrade;
}) {
  const userRr = userEntry && userStop && userTarget
    ? Math.abs(userTarget - userEntry) / Math.abs(userEntry - userStop)
    : undefined;
  const shadowRr = Math.abs(shadowTrade.targetPrice - shadowTrade.entryPrice) / Math.abs(shadowTrade.entryPrice - shadowTrade.stopPrice);

  return (
    <div style={{ ...s.card, borderColor: 'rgba(167,139,250,0.2)' }}>
      <div style={s.cardTitle}>Compare — {symbol} — Your Trade vs Council Shadow</div>
      <div style={s.compareGrid}>
        {/* User */}
        <div style={s.compareCol}>
          <div style={s.compareHeader}>Your Setup</div>
          <CompareRow label="Direction" value={userSide.toUpperCase()} color={userSide === 'long' ? '#34d399' : '#f87171'} />
          <CompareRow label="Entry"  value={userEntry  ? userEntry.toFixed(2)  : '—'} />
          <CompareRow label="Stop"   value={userStop   ? userStop.toFixed(2)   : '—'} />
          <CompareRow label="Target" value={userTarget ? userTarget.toFixed(2) : '—'} />
          <CompareRow label="R:R"    value={userRr ? `${userRr.toFixed(2)}:1` : '—'} />
        </div>
        <div style={s.compareDivider} />
        {/* Shadow */}
        <div style={s.compareCol}>
          <div style={{ ...s.compareHeader, color: '#a78bfa' }}>Council Shadow <span style={s.simBadge}>SIM</span></div>
          <CompareRow label="Direction" value={shadowTrade.side.toUpperCase()} color={shadowTrade.side === 'long' ? '#34d399' : '#f87171'} />
          <CompareRow label="Entry"  value={shadowTrade.entryPrice.toFixed(2)} />
          <CompareRow label="Stop"   value={shadowTrade.stopPrice.toFixed(2)} />
          <CompareRow label="Target" value={shadowTrade.targetPrice.toFixed(2)} />
          <CompareRow label="R:R"    value={`${shadowRr.toFixed(2)}:1`} />
          {shadowTrade.unrealizedPnl !== undefined && (
            <CompareRow label="P/L" value={`${shadowTrade.unrealizedPnl >= 0 ? '+' : ''}$${shadowTrade.unrealizedPnl.toFixed(0)}`} color={shadowTrade.unrealizedPnl >= 0 ? '#34d399' : '#f87171'} />
          )}
        </div>
      </div>
      {shadowTrade.reason && (
        <div style={{ fontSize: 11, color: 'rgba(167,139,250,0.7)', marginTop: 4, fontStyle: 'italic' }}>
          Council reason: {shadowTrade.reason}
        </div>
      )}
    </div>
  );
}

function HistoryTable({ trades }: { trades: ShadowTrade[] }) {
  const histGrid = '60px 50px 50px 70px 70px 60px 50px 50px 45px';
  return (
    <div style={s.historyTable}>
      <div style={{ ...s.historyHeader, gridTemplateColumns: histGrid }}>
        <span>Time</span><span>Symbol</span><span>Side</span><span>Entry</span><span>Exit</span><span>P/L</span><span>R</span><span>Exit</span><span>Grade</span>
      </div>
      {trades.map(t => {
        const pnl   = t.pnl ?? 0;
        const color = pnl > 0 ? '#34d399' : pnl < 0 ? '#f87171' : 'rgba(255,255,255,0.4)';
        return (
          <div key={t.id} style={{ ...s.historyRow, gridTemplateColumns: histGrid }}>
            <span>{new Date(t.openedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
            <span>{t.symbol}</span>
            <span style={{ color: t.side === 'long' ? '#34d399' : '#f87171' }}>{t.side.toUpperCase()}</span>
            <span>{t.entryPrice.toFixed(2)}</span>
            <span>{t.exitPrice?.toFixed(2) ?? '—'}</span>
            <span style={{ color }}>{pnl >= 0 ? '+' : ''}${pnl.toFixed(0)}</span>
            <span style={{ color }}>{t.pnlR !== undefined ? `${t.pnlR >= 0 ? '+' : ''}${t.pnlR.toFixed(2)}R` : '—'}</span>
            <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 9 }}>{t.exitReason ?? '—'}</span>
            <span><SetupGradeBadge grade={t.setupGrade as any} /></span>
          </div>
        );
      })}
    </div>
  );
}

function VerdictCard({ advice, onCouncilReview, councilLoading }: {
  advice: TradeAdviceResult;
  onCouncilReview: () => void;
  councilLoading: boolean;
}) {
  const cfg = VERDICT_CONFIG[advice.verdict];
  return (
    <div style={{ ...s.card, borderColor: cfg.color + '44' }}>
      <div style={s.verdictHeader}>
        <div style={{ ...s.verdictBadge, background: cfg.bg, color: cfg.color }}>{cfg.label}</div>
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.35)' }}>{advice.confidence} confidence</span>
      </div>
      <p style={s.verdictSummary}>{advice.summary}</p>
      {advice.suggestedSize !== undefined && (
        <div style={s.sizingRow}>
          <span style={s.sizingLabel}>Suggested</span>
          <span style={s.sizingValue}>{advice.suggestedSize} contract{advice.suggestedSize !== 1 ? 's' : ''}</span>
          {advice.riskDollars    !== undefined && <span style={s.sizingMeta}>Risk: ${advice.riskDollars.toFixed(0)}</span>}
          {advice.rewardDollars  !== undefined && <span style={s.sizingMeta}>Reward: ${advice.rewardDollars.toFixed(0)}</span>}
          {advice.rr             !== undefined && <span style={s.sizingMeta}>R:R {advice.rr.toFixed(2)}:1</span>}
        </div>
      )}
      {advice.ruleViolations.length > 0 && <ItemList items={advice.ruleViolations} icon="✕" color="#f87171" />}
      {advice.warnings.length > 0        && <ItemList items={advice.warnings}       icon="⚠" color="#fbbf24" />}
      {advice.strengths.length > 0       && <ItemList items={advice.strengths}      icon="✓" color="#34d399" />}
      <div style={{ ...s.actions, marginTop: 8 }}>
        <button style={{ ...s.btn, ...s.btnPrimary, opacity: councilLoading ? 0.5 : 1 }} disabled={councilLoading} onClick={onCouncilReview}>
          {councilLoading ? 'Reviewing...' : 'Council Review'}
        </button>
      </div>
    </div>
  );
}

function ItemList({ items, icon, color }: { items: string[]; icon: string; color: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      {items.map((item, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, fontSize: 12, color: 'rgba(255,255,255,0.6)', lineHeight: 1.5 }}>
          <span style={{ color, flexShrink: 0 }}>{icon}</span><span>{item}</span>
        </div>
      ))}
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, flex: 1 }}>
      <span style={{ fontSize: 10, fontWeight: 600, color: 'rgba(255,255,255,0.35)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
      {children}
    </div>
  );
}

function Metric({ label, value, highlight, dim, dimRed }: { label: string; value: string; highlight?: boolean; dim?: boolean; dimRed?: boolean }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2, minWidth: 70 }}>
      <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
      <span style={{ fontSize: 16, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: highlight ? '#34d399' : dimRed ? '#f87171' : dim ? 'rgba(255,255,255,0.4)' : 'rgba(255,255,255,0.85)' }}>{value}</span>
    </div>
  );
}

function ShadowStat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span style={{ fontSize: 9, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</span>
      <span style={{ fontSize: 15, fontWeight: 700, fontVariantNumeric: 'tabular-nums', color: color ?? 'rgba(255,255,255,0.8)' }}>{value}</span>
    </div>
  );
}

// ── Phase 3: Analytics sub-components ─────────────────────────────────────────

function ShadowAnalyticsPanel({ summary, refinement, readiness, onClear, promotion, onPromote, onReturnToShadow, promotionLoading: promoLoading, councilValueAdded: cvaProp, gradeSummary: gradeProp }: {
  summary: ShadowAnalyticsSummary; refinement?: StrategyRefinementSummary | null; readiness?: StrategyReadinessReport | null; onClear: () => void;
  promotion?: PromotionWorkflowStatus | null; onPromote?: (mode: TradingOperationMode) => void; onReturnToShadow?: () => void; promotionLoading?: boolean;
  councilValueAdded?: any; gradeSummary?: any[] | null;
}) {
  const o = summary.overall;
  const c = summary.council;
  const [showRefinement, setShowRefinement] = useState(false);
  const sectionLabel: React.CSSProperties = { fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 };
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
      {/* Core stats */}
      <div style={s.shadowStats}>
        <ShadowStat label="Trades" value={String(o.totalTrades)} />
        <ShadowStat label="Win Rate" value={`${(o.winRate * 100).toFixed(0)}%`} color={o.winRate >= 0.5 ? '#34d399' : '#f87171'} />
        <ShadowStat label="Expectancy" value={`${o.expectancyR >= 0 ? '+' : ''}${o.expectancyR.toFixed(2)}R`} color={o.expectancyR > 0 ? '#34d399' : '#f87171'} />
        <ShadowStat label="Profit Factor" value={o.profitFactor === Infinity ? '\u221e' : o.profitFactor.toFixed(2)} color={o.profitFactor > 1 ? '#34d399' : '#f87171'} />
        <ShadowStat label="Net P/L" value={`${o.totalPnlDollars >= 0 ? '+' : ''}$${o.totalPnlDollars.toFixed(0)}`} color={o.totalPnlDollars >= 0 ? '#34d399' : '#f87171'} />
      </div>

      {/* Excursion stats */}
      <div style={s.shadowStats}>
        <ShadowStat label="Avg MFE" value={`${o.avgMfeR.toFixed(2)}R`} />
        <ShadowStat label="Avg MAE" value={`${o.avgMaeR.toFixed(2)}R`} />
        <ShadowStat label="Edge Capture" value={`${(o.edgeCaptureRatio * 100).toFixed(0)}%`} />
        <ShadowStat label="Max Win Streak" value={String(o.maxConsecutiveWins)} />
        <ShadowStat label="Max Loss Streak" value={String(o.maxConsecutiveLosses)} color={o.maxConsecutiveLosses >= 3 ? '#f87171' : undefined} />
      </div>

      {/* Top block reasons — exclude manual_confirmation workflow states */}
      {(() => {
        const filtered = summary.topBlockReasons.filter(r =>
          r.reason !== 'manual_confirmation_pending' && r.reason !== 'manual_confirmation_timeout' && r.reason !== 'manual_confirmation_rejected'
        );
        return filtered.length > 0 ? (
          <div>
            <div style={sectionLabel}>Top Block Reasons</div>
            {filtered.slice(0, 3).map((r, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'rgba(255,255,255,0.5)', padding: '3px 0' }}>
                <span>{r.reason.replace(/_/g, ' ')}</span>
                <span style={{ color: 'rgba(255,255,255,0.35)' }}>{r.count} ({r.pct.toFixed(0)}%)</span>
              </div>
            ))}
          </div>
        ) : null;
      })()}

      {/* Council effectiveness */}
      {c.totalReviews > 0 && (
        <div>
          <div style={sectionLabel}>Council Effectiveness</div>
          <div style={s.shadowStats}>
            <ShadowStat label="Reviews" value={String(c.totalReviews)} />
            <ShadowStat label="Approval Rate" value={`${(c.approvalRate * 100).toFixed(0)}%`} />
            <ShadowStat label="Approved Win%" value={`${(c.approvedWinRate * 100).toFixed(0)}%`} color={c.approvedWinRate >= 0.5 ? '#34d399' : '#f87171'} />
          </div>
          {Object.keys(c.providerAccuracy).length > 0 && (
            <div style={{ marginTop: 8 }}>
              {Object.entries(c.providerAccuracy).map(([name, pa]) => (
                <div key={name} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11, color: 'rgba(255,255,255,0.5)', padding: '3px 0' }}>
                  <span>{name}</span>
                  <span style={{ color: pa.accuracy >= 0.5 ? '#34d399' : '#f87171' }}>{(pa.accuracy * 100).toFixed(0)}% agreement ({pa.votes} votes)</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Phase 4: Refinement Insights */}
      {refinement && refinement.insights.length > 0 && (
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 }}>
            <div style={sectionLabel}>Refinement Insights</div>
            <button
              style={{ ...s.btn, ...s.btnGhost, fontSize: 9, padding: '2px 6px' }}
              onClick={() => setShowRefinement(v => !v)}
            >
              {showRefinement ? 'Collapse' : 'Show Insights'}
            </button>
          </div>
          {showRefinement && (
            <RefinementInsightsPanel refinement={refinement} />
          )}
        </div>
      )}

      {/* Phase 5: Strategy Readiness */}
      {readiness && <StrategyReadinessSection report={readiness} />}

      {/* Phase 6: Promotion Workflow Status */}
      {promotion && (
        <PromotionStatusSection
          status={promotion}
          readiness={readiness}
          onPromote={onPromote}
          onReturnToShadow={onReturnToShadow}
          loading={promoLoading}
        />
      )}

      {/* By Session */}
      {summary.bySession.length > 0 && <BucketTable title="By Session" rows={summary.bySession} />}

      {/* By Setup Type */}
      {summary.bySetupType.length > 0 && <BucketTable title="By Setup Type" rows={summary.bySetupType} />}

      {/* Phase 7: Trust Dashboard */}
      <TrustDashboardPanel
        analytics={summary}
        readiness={readiness as any}
        promotion={promotion as any}
        councilValueAdded={cvaProp}
        gradeSummary={gradeProp}
      />

      {/* Phase 7: Grade-Based Analytics */}
      {gradeProp && gradeProp.length > 0 && (
        <GradeAnalyticsPanel gradeSummary={gradeProp} />
      )}

      {/* Clear button */}
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button style={{ ...s.btn, ...s.btnGhost, fontSize: 10, padding: '3px 8px' }} onClick={onClear}>Clear Analytics Data</button>
      </div>
    </div>
  );
}

function BucketTable({ title, rows }: { title: string; rows: BucketPerformanceSummary[] }) {
  const headerStyle: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 50px 55px 55px 60px', gap: 6, fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', letterSpacing: '0.05em', paddingBottom: 4, borderBottom: '1px solid rgba(255,255,255,0.06)' };
  const rowStyle: React.CSSProperties = { display: 'grid', gridTemplateColumns: '1fr 50px 55px 55px 60px', gap: 6, fontSize: 11, color: 'rgba(255,255,255,0.6)', padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.04)', fontVariantNumeric: 'tabular-nums' };
  return (
    <div>
      <div style={{ fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 }}>{title}</div>
      <div style={headerStyle}><span>Bucket</span><span>Trades</span><span>Win%</span><span>Avg R</span><span>P/L</span></div>
      {rows.map((r, i) => (
        <div key={i} style={rowStyle}>
          <span>{r.bucket?.replace(/_/g, ' ') ?? 'unknown'}</span>
          <span>{r.trades}</span>
          <span style={{ color: r.winRate >= 0.5 ? '#34d399' : '#f87171' }}>{(r.winRate * 100).toFixed(0)}%</span>
          <span style={{ color: r.avgPnlR >= 0 ? '#34d399' : '#f87171' }}>{r.avgPnlR >= 0 ? '+' : ''}{r.avgPnlR.toFixed(2)}</span>
          <span style={{ color: r.totalPnlDollars >= 0 ? '#34d399' : '#f87171' }}>{r.totalPnlDollars >= 0 ? '+' : ''}${r.totalPnlDollars.toFixed(0)}</span>
        </div>
      ))}
    </div>
  );
}

// ── Phase 4: Refinement insights sub-component ──────────────────────────────

const RECOMMENDATION_COLORS: Record<string, string> = {
  promote: '#22c55e',
  keep: '#6366f1',
  watch: '#eab308',
  demote: '#f97316',
  block: '#ef4444',
};

const CATEGORY_LABELS: Record<string, string> = {
  session: 'Session',
  volatility: 'Volatility',
  vwap: 'VWAP',
  instrument: 'Instrument',
  council_confidence: 'Council Confidence',
  warnings: 'Warnings',
};

function RefinementInsightsPanel({ refinement }: { refinement: StrategyRefinementSummary }) {
  // Group insights by category
  const grouped = new Map<string, StrategyInsight[]>();
  for (const insight of refinement.insights) {
    let arr = grouped.get(insight.category);
    if (!arr) { arr = []; grouped.set(insight.category, arr); }
    arr.push(insight);
  }

  const sectionLabel: React.CSSProperties = { fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 8, marginBottom: 4 };
  const rowStyle: React.CSSProperties = { display: 'grid', gridTemplateColumns: '90px 40px 50px 50px 55px auto', gap: 6, fontSize: 10, color: 'rgba(255,255,255,0.5)', padding: '3px 0', borderBottom: '1px solid rgba(255,255,255,0.04)', fontVariantNumeric: 'tabular-nums', alignItems: 'baseline' };
  const headerStyle: React.CSSProperties = { ...rowStyle, fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.2)', textTransform: 'uppercase', letterSpacing: '0.04em', borderBottom: '1px solid rgba(255,255,255,0.06)', padding: '0 0 3px' };

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      {/* Baseline */}
      <div style={{ display: 'flex', gap: 16, fontSize: 10, color: 'rgba(255,255,255,0.4)', marginBottom: 4 }}>
        <span>Baseline: {(refinement.baselineWinRate * 100).toFixed(0)}% win, {refinement.baselineAvgPnlR >= 0 ? '+' : ''}{refinement.baselineAvgPnlR.toFixed(2)}R</span>
        <span>({refinement.totalClosedTrades} trades)</span>
      </div>

      {/* Header row */}
      <div style={headerStyle}>
        <span>Bucket</span><span>N</span><span>Win%</span><span>Avg R</span><span>Tier</span><span>Rec</span>
      </div>

      {/* Grouped insights */}
      {[...grouped.entries()].map(([category, insights]) => (
        <div key={category}>
          <div style={sectionLabel}>{CATEGORY_LABELS[category] ?? category}</div>
          {insights.map((insight, i) => {
            const recColor = RECOMMENDATION_COLORS[insight.recommendation] ?? 'rgba(255,255,255,0.4)';
            return (
              <div key={i} style={rowStyle} title={insight.rationale}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{insight.bucket.replace(/_/g, ' ')}</span>
                <span>{insight.trades}</span>
                <span style={{ color: insight.winRate >= refinement.baselineWinRate ? '#34d399' : '#f87171' }}>{(insight.winRate * 100).toFixed(0)}%</span>
                <span style={{ color: insight.avgPnlR >= 0 ? '#34d399' : '#f87171' }}>{insight.avgPnlR >= 0 ? '+' : ''}{insight.avgPnlR.toFixed(2)}</span>
                <span style={{ fontSize: 8, fontWeight: 700, color: insight.sampleTier === 'full' ? 'rgba(255,255,255,0.5)' : 'rgba(255,255,255,0.25)', textTransform: 'uppercase' }}>{insight.sampleTier}</span>
                <span style={{ fontSize: 9, fontWeight: 800, color: recColor, letterSpacing: '0.04em', textTransform: 'uppercase' }}>{insight.recommendation}</span>
              </div>
            );
          })}
        </div>
      ))}

      {/* Footer */}
      <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)', marginTop: 6, fontStyle: 'italic' }}>
        Recommendations are advisory only. They are not auto-applied.
      </div>
    </div>
  );
}

// ── Phase 5: Strategy Readiness sub-component ────────────────────────────────

const READINESS_STATE_COLORS: Record<StrategyReadinessState, string> = {
  not_ready: '#6b7280',
  developing: '#eab308',
  paper_ready: '#3b82f6',
  guarded_live_candidate: '#22c55e',
};

const READINESS_STATE_LABELS: Record<StrategyReadinessState, string> = {
  not_ready: 'NOT READY',
  developing: 'DEVELOPING',
  paper_ready: 'PAPER READY',
  guarded_live_candidate: 'GUARDED LIVE CANDIDATE',
};

function formatThresholdValue(key: string, value: number): string {
  if (key === 'minWinRate' || key === 'minEdgeCaptureRatio') return `${(value * 100).toFixed(1)}%`;
  if (key === 'minAvgPnlR' || key === 'maxDrawdownR') return `${value.toFixed(2)}R`;
  if (key === 'minProfitFactor') return value === Infinity ? '\u221e' : value.toFixed(2);
  return String(value);
}

function StrategyReadinessSection({ report }: { report: StrategyReadinessReport }) {
  const [expanded, setExpanded] = useState(false);
  const stateColor = READINESS_STATE_COLORS[report.state];
  const stateLabel = READINESS_STATE_LABELS[report.state];
  const sectionLabel: React.CSSProperties = { fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 };

  const passedCount = report.thresholdChecks.filter(c => c.passed).length;
  const totalChecks = report.thresholdChecks.length;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={sectionLabel}>Strategy Readiness</div>
        <button
          style={{ ...s.btn, ...s.btnGhost, fontSize: 9, padding: '2px 6px' }}
          onClick={() => setExpanded(v => !v)}
        >
          {expanded ? 'Collapse' : 'Details'}
        </button>
      </div>

      {/* State badge + key metrics */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        <span style={{
          fontSize: 10, fontWeight: 800, letterSpacing: '0.06em',
          color: stateColor, background: `${stateColor}18`,
          border: `1px solid ${stateColor}40`,
          borderRadius: 4, padding: '3px 8px',
        }}>
          {stateLabel}
        </span>
        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>
          {report.performance.totalTrades} trades | {passedCount}/{totalChecks} checks passed
          {!report.stabilityPassed && ' | Stability: FAIL'}
        </span>
      </div>

      {/* Core readiness metrics — always visible */}
      {report.performance.totalTrades > 0 && (() => {
        const p = report.performance;
        const statStyle: React.CSSProperties = { fontSize: 10, color: 'rgba(255,255,255,0.5)', fontVariantNumeric: 'tabular-nums' };
        const valStyle = (good: boolean): React.CSSProperties => ({ fontWeight: 700, color: good ? '#34d399' : '#f87171' });
        return (
          <div style={{ display: 'flex', gap: 14, flexWrap: 'wrap', marginBottom: 8 }}>
            <span style={statStyle}>Win <span style={valStyle(p.winRate >= 0.50)}>{(p.winRate * 100).toFixed(0)}%</span></span>
            <span style={statStyle}>Avg R <span style={valStyle(p.avgPnlR >= 0.10)}>{p.avgPnlR >= 0 ? '+' : ''}{p.avgPnlR.toFixed(2)}</span></span>
            <span style={statStyle}>PF <span style={valStyle(p.profitFactor >= 1.2)}>{p.profitFactor === Infinity ? '\u221e' : p.profitFactor.toFixed(2)}</span></span>
            <span style={statStyle}>DD <span style={valStyle(report.maxDrawdownR <= 5)}>{report.maxDrawdownR.toFixed(1)}R</span></span>
            <span style={statStyle}>Edge <span style={valStyle(p.edgeCaptureRatio >= 0.15)}>{(p.edgeCaptureRatio * 100).toFixed(0)}%</span></span>
          </div>
        );
      })()}

      {/* Collapsible detail */}
      {expanded && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
          {/* Threshold checks */}
          {report.thresholdChecks.length > 0 && (
            <div>
              <div style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.2)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
                Threshold Checks
              </div>
              {report.thresholdChecks.map((tc, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'rgba(255,255,255,0.5)', padding: '3px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  <span>{tc.key.replace(/([A-Z])/g, ' $1').replace(/^./, c => c.toUpperCase()).trim()}</span>
                  <span style={{ display: 'flex', gap: 8 }}>
                    <span style={{ color: tc.passed ? '#34d399' : '#f87171', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                      {formatThresholdValue(tc.key, tc.currentValue)}
                    </span>
                    <span style={{ color: tc.passed ? '#34d399' : '#f87171', fontSize: 9, fontWeight: 800 }}>
                      {tc.passed ? 'PASS' : 'FAIL'}
                    </span>
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Stability checks */}
          {report.stabilityChecks.length > 0 && (
            <div>
              <div style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.2)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
                Stability Checks{' '}
                <span style={{ color: report.stabilityPassed ? '#34d399' : '#f87171', marginLeft: 6 }}>
                  {report.stabilityPassed ? 'PASSED' : 'FAILED'}
                </span>
              </div>
              {report.stabilityChecks.map((sc, i) => (
                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'rgba(255,255,255,0.5)', padding: '3px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                  <span>{sc.category.replace(/_/g, ' ')}: {sc.bucket}</span>
                  <span style={{ color: sc.passed ? '#34d399' : '#f87171', fontSize: 9, fontVariantNumeric: 'tabular-nums' }}>
                    {sc.trades} trades, {sc.metricName === 'winRate' ? `${(sc.metric * 100).toFixed(0)}%` : `${sc.metric.toFixed(2)}R`}
                    {' '}{sc.passed ? 'PASS' : 'FAIL'}
                  </span>
                </div>
              ))}
            </div>
          )}

          {/* Blockers */}
          {report.blockers.length > 0 && (
            <div>
              <div style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.2)', textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 4 }}>
                Blockers
              </div>
              {report.blockers.map((b, i) => (
                <div key={i} style={{ fontSize: 10, color: '#f87171', padding: '2px 0' }}>{b}</div>
              ))}
            </div>
          )}

          {/* Advisory */}
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', fontStyle: 'italic', marginTop: 2 }}>
            {report.advisory}
          </div>
        </div>
      )}

      {/* Footer — always visible */}
      <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)', marginTop: 6, fontStyle: 'italic' }}>
        This status is advisory. It does not enable live trading.
      </div>
    </div>
  );
}

// ── Phase 6: Promotion Status sub-component ──────────────────────────────────

const MODE_BADGE_CONFIG: Record<TradingOperationMode, { label: string; color: string }> = {
  shadow:                 { label: 'SHADOW',                              color: '#6b7280' },
  paper:                  { label: 'PAPER (SIMULATED)',                   color: '#3b82f6' },
  guarded_live_candidate: { label: 'GUARDED LIVE CANDIDATE (SIMULATED)', color: '#22c55e' },
};

const PROMOTION_LADDER: Record<TradingOperationMode, TradingOperationMode | null> = {
  shadow: 'paper',
  paper: 'guarded_live_candidate',
  guarded_live_candidate: null,
};

function PromotionStatusSection({ status, readiness, onPromote, onReturnToShadow, loading }: {
  status: PromotionWorkflowStatus;
  readiness?: StrategyReadinessReport | null;
  onPromote?: (mode: TradingOperationMode) => void;
  onReturnToShadow?: () => void;
  loading?: boolean;
}) {
  const [showGuardrails, setShowGuardrails] = useState(false);
  const badge = MODE_BADGE_CONFIG[status.currentMode];
  const nextMode = PROMOTION_LADDER[status.currentMode];
  const sectionLabel: React.CSSProperties = { fontSize: 10, fontWeight: 700, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 6 };

  // Determine if promotion is possible based on readiness
  const canPromote = nextMode && readiness && (
    (nextMode === 'paper' && (readiness.state === 'paper_ready' || readiness.state === 'guarded_live_candidate')) ||
    (nextMode === 'guarded_live_candidate' && readiness.state === 'guarded_live_candidate')
  ) && readiness.stabilityPassed;

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <div style={sectionLabel}>Promotion Workflow</div>
        <button
          style={{ ...s.btn, ...s.btnGhost, fontSize: 9, padding: '2px 6px' }}
          onClick={() => setShowGuardrails(v => !v)}
        >
          {showGuardrails ? 'Hide Guardrails' : 'Guardrails'}
        </button>
      </div>

      {/* Mode badge */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 8 }}>
        <span style={{
          fontSize: 10, fontWeight: 800, letterSpacing: '0.06em',
          color: badge.color, background: `${badge.color}18`,
          border: `1px solid ${badge.color}40`,
          borderRadius: 4, padding: '3px 8px',
        }}>
          {badge.label}
        </span>
        {status.currentMode !== 'shadow' && (
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)', fontVariantNumeric: 'tabular-nums' }}>
            Simulated trades: {status.tradesTodayPromoted}/{status.activeGuardrails.maxTradesPerDay} |
            Simulated loss: {status.dailyLossR.toFixed(1)}R/{status.activeGuardrails.dailyLossCapR}R |
            Streak: {status.consecutiveLosses}/{status.activeGuardrails.lossStreakDemotion}
          </span>
        )}
      </div>

      {/* Demotion notice */}
      {status.demotedAt && status.demotionReason && (
        <div style={{ background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 6, padding: '8px 12px', marginBottom: 8 }}>
          <div style={{ fontSize: 11, fontWeight: 700, color: '#f87171', marginBottom: 2 }}>Demoted to Shadow</div>
          <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.4)' }}>
            Reason: {status.demotionReason.replace(/_/g, ' ')} — {new Date(status.demotedAt).toLocaleString()}
          </div>
        </div>
      )}

      {/* Promote / Return buttons */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
        {canPromote && nextMode && (
          <button
            style={{ ...s.btn, ...s.btnPrimary, fontSize: 10, padding: '6px 14px', opacity: loading ? 0.5 : 1 }}
            disabled={loading}
            onClick={() => onPromote?.(nextMode)}
          >
            {loading ? 'Processing...' : `Promote to ${nextMode === 'paper' ? 'Paper (Simulated)' : 'Guarded Live Candidate (Simulated)'}`}
          </button>
        )}
        {status.currentMode !== 'shadow' && (
          <button
            style={{ ...s.btn, ...s.btnGhost, fontSize: 10, padding: '6px 14px', color: '#f87171', borderColor: 'rgba(248,113,113,0.25)', opacity: loading ? 0.5 : 1 }}
            disabled={loading}
            onClick={onReturnToShadow}
          >
            Return to Shadow Mode
          </button>
        )}
      </div>

      {/* Guardrail details */}
      {showGuardrails && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 8 }}>
          <div style={{ fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.2)', textTransform: 'uppercase', letterSpacing: '0.04em' }}>
            Active Guardrails ({status.currentMode !== 'shadow' ? status.currentMode.replace(/_/g, ' ') : 'paper defaults'})
          </div>
          {(() => {
            const g = status.activeGuardrails;
            const rows = [
              { label: 'Daily Loss Cap', value: `${g.dailyLossCapR}R` },
              { label: 'Max Simulated Trades/Day', value: String(g.maxTradesPerDay) },
              { label: 'Max Position Size', value: `${g.maxPositionSize} contract(s)` },
              { label: 'Manual Confirmation', value: g.manualConfirmation ? 'Required' : 'Off' },
              { label: 'Auto-Demotion', value: g.autoDemotionEnabled ? 'Enabled' : 'Disabled' },
              { label: 'Loss Streak Demotion', value: `${g.lossStreakDemotion} consecutive` },
            ];
            return rows.map((r, i) => (
              <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'rgba(255,255,255,0.5)', padding: '2px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
                <span>{r.label}</span>
                <span style={{ color: 'rgba(255,255,255,0.65)', fontVariantNumeric: 'tabular-nums' }}>{r.value}</span>
              </div>
            ));
          })()}
        </div>
      )}

      {/* Advisory */}
      <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.2)', fontStyle: 'italic' }}>
        All modes remain simulation only. No live brokerage orders are placed. Mode changes require explicit user action.
      </div>
    </div>
  );
}

function CompareRow({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '3px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' }}>
      <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>{label}</span>
      <span style={{ fontSize: 12, fontWeight: 600, color: color ?? 'rgba(255,255,255,0.75)', fontVariantNumeric: 'tabular-nums' }}>{value}</span>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  page:      { display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', background: 'var(--bg, #0d0d0f)', color: 'rgba(255,255,255,0.85)', fontFamily: 'var(--font-mono, monospace)', padding: '0 24px 0' },
  header:    { display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', padding: '20px 0 12px', borderBottom: '1px solid rgba(255,255,255,0.06)', marginBottom: 16, gap: 12, flexWrap: 'wrap' },
  backBtn:   { background: 'none', border: 'none', color: 'rgba(255,255,255,0.35)', fontSize: 11, cursor: 'pointer', padding: '4px 0', marginTop: 2 },
  title:     { fontSize: 18, fontWeight: 700, margin: '0 0 6px', color: 'rgba(255,255,255,0.9)' },
  badges:    { display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' },
  badgeAdvisory: { fontSize: 9, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#fbbf24', background: 'rgba(251,191,36,0.1)', border: '1px solid rgba(251,191,36,0.25)', borderRadius: 4, padding: '2px 7px' },
  badgeShadow:   { fontSize: 9, fontWeight: 800, letterSpacing: '0.08em', textTransform: 'uppercase', color: '#a78bfa', background: 'rgba(167,139,250,0.1)', border: '1px solid rgba(167,139,250,0.25)', borderRadius: 4, padding: '2px 7px' },
  badgeConn:     { fontSize: 10, fontWeight: 600, border: '1px solid', borderRadius: 4, padding: '2px 8px' },
  headerActions: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 2 },
  trialBanner:   { fontSize: 11, color: '#34d399', background: 'rgba(52,211,153,0.08)', border: '1px solid rgba(52,211,153,0.2)', borderRadius: 6, padding: '8px 12px', lineHeight: 1.5, fontWeight: 600 },
  disclaimer:    { fontSize: 11, color: 'rgba(255,255,255,0.3)', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: 6, padding: '8px 12px', marginBottom: 16, lineHeight: 1.5 },
  body:          { display: 'flex', flexDirection: 'column', gap: 10, flex: 1, minHeight: 0, overflow: 'hidden' },
  heroRow:       { display: 'flex', gap: 12, alignItems: 'stretch', borderTop: '1px solid rgba(96,165,250,0.15)', paddingTop: 12 },
  heroChartCol:  { flex: 2, minWidth: 0, display: 'flex', flexDirection: 'column' },
  heroThesisCol: { flex: 1, minWidth: 300, maxWidth: 380, display: 'flex', flexDirection: 'column', background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 6 },
  mainWorkspace: { display: 'flex', flex: 1, gap: 10, minHeight: 0 },
  chartArea:     { flex: 7, display: 'flex', flexDirection: 'column', minWidth: 0 },
  decisionRail:  { flex: 3, minWidth: 260, maxWidth: 380, display: 'flex', flexDirection: 'column', gap: 8, overflowY: 'auto' },
  card:          { background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 6, padding: '12px 14px', display: 'flex', flexDirection: 'column', gap: 12 },
  cardTitle:     { fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.07em', color: 'rgba(255,255,255,0.35)', display: 'flex', alignItems: 'center', gap: 6 },
  noteBox:       { fontSize: 11, color: 'rgba(255,255,255,0.4)', background: 'rgba(255,255,255,0.02)', border: '1px solid rgba(255,255,255,0.06)', borderRadius: 6, padding: '8px 10px', lineHeight: 1.5 },
  row:           { display: 'flex', gap: 12, flexWrap: 'wrap' },
  input:         { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, color: 'rgba(255,255,255,0.85)', fontSize: 12, padding: '7px 10px', outline: 'none', width: '100%', boxSizing: 'border-box', fontFamily: 'inherit' },
  select:        { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, color: 'rgba(255,255,255,0.85)', fontSize: 12, padding: '7px 10px', outline: 'none', width: '100%', boxSizing: 'border-box', fontFamily: 'inherit', cursor: 'pointer', colorScheme: 'dark' },
  textarea:      { background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, color: 'rgba(255,255,255,0.85)', fontSize: 12, padding: '7px 10px', outline: 'none', width: '100%', boxSizing: 'border-box', resize: 'vertical', fontFamily: 'inherit', lineHeight: 1.5 },
  segmented:     { display: 'flex', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6, overflow: 'hidden' },
  seg:           { flex: 1, background: 'none', border: 'none', color: 'rgba(255,255,255,0.35)', fontSize: 11, fontWeight: 600, padding: '7px 12px', cursor: 'pointer', fontFamily: 'inherit' },
  segActive:     { background: 'rgba(96,165,250,0.12)', color: '#60a5fa' },
  segLong:       { background: 'rgba(52,211,153,0.12)', color: '#34d399' },
  segShort:      { background: 'rgba(248,113,113,0.12)', color: '#f87171' },
  metricsRow:    { display: 'flex', gap: 20, flexWrap: 'wrap' },
  liveDot:       { display: 'inline-block', width: 6, height: 6, borderRadius: '50%', background: '#34d399' },
  offlineNote:   { fontSize: 12, color: 'rgba(255,255,255,0.3)', fontStyle: 'italic' },
  statusNote:    { display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, color: 'rgba(255,255,255,0.4)', lineHeight: 1.5 },
  statusDot:     { display: 'inline-block', width: 7, height: 7, borderRadius: '50%', background: 'rgba(255,255,255,0.2)', flexShrink: 0, marginTop: 4 },
  snapshotWarning: { fontSize: 11, color: '#fbbf24', marginTop: -4 },
  errorBanner:   { background: 'rgba(248,113,113,0.08)', border: '1px solid rgba(248,113,113,0.2)', borderRadius: 6, padding: '10px 14px', fontSize: 12, color: '#f87171' },
  actions:       { display: 'flex', gap: 10, flexWrap: 'wrap' },
  btn:           { border: 'none', borderRadius: 6, fontSize: 12, fontWeight: 700, padding: '9px 18px', cursor: 'pointer', fontFamily: 'inherit' },
  btnPrimary:    { background: 'rgba(96,165,250,0.15)', border: '1px solid rgba(96,165,250,0.3)', color: '#60a5fa' },
  btnGhost:      { background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.1)', color: 'rgba(255,255,255,0.4)' },
  derivedMetric: { display: 'flex', flexDirection: 'column', gap: 2, justifyContent: 'flex-end' },
  derivedLabel:  { fontSize: 10, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.06em' },
  derivedValue:  { fontSize: 16, fontWeight: 700, color: 'rgba(255,255,255,0.7)', fontVariantNumeric: 'tabular-nums' },
  // Shadow trading
  shadowDesc:    { fontSize: 12, color: 'rgba(255,255,255,0.5)', lineHeight: 1.6, margin: 0 },
  shadowStats:   { display: 'flex', gap: 24, flexWrap: 'wrap' },
  shadowStatus:  { fontSize: 11, color: 'rgba(255,255,255,0.35)', fontStyle: 'italic' },
  simBadge:      { fontSize: 8, fontWeight: 800, letterSpacing: '0.08em', background: 'rgba(167,139,250,0.15)', color: '#a78bfa', border: '1px solid rgba(167,139,250,0.25)', borderRadius: 3, padding: '1px 5px' },
  toggleRow:     { display: 'flex', alignItems: 'center', gap: 8, marginLeft: 'auto' },
  toggleBtn:     { width: 40, height: 22, borderRadius: 11, border: 'none', cursor: 'pointer', position: 'relative', padding: 0, transition: 'background 0.2s' },
  toggleKnob:    { position: 'absolute', top: 2, width: 18, height: 18, borderRadius: '50%', background: '#fff', transition: 'transform 0.2s' },
  // Position row
  positionRow:   { display: 'flex', gap: 12, alignItems: 'baseline', fontSize: 12, flexWrap: 'wrap', paddingBottom: 8, borderBottom: '1px solid rgba(255,255,255,0.05)' },
  posSide:       { fontWeight: 700, fontSize: 11, letterSpacing: '0.04em', flexShrink: 0 },
  posSymbol:     { fontWeight: 700, color: 'rgba(255,255,255,0.85)', flexShrink: 0 },
  posDetail:     { color: 'rgba(255,255,255,0.4)', fontVariantNumeric: 'tabular-nums', flexShrink: 0 },
  posPnl:        { fontWeight: 700, fontVariantNumeric: 'tabular-nums', marginLeft: 'auto', flexShrink: 0 },
  posReason:     { fontSize: 10, color: 'rgba(167,139,250,0.6)', width: '100%', fontStyle: 'italic' },
  // Compare
  compareGrid:   { display: 'flex', gap: 16 },
  compareCol:    { flex: 1, display: 'flex', flexDirection: 'column', gap: 2 },
  compareHeader: { fontSize: 11, fontWeight: 700, color: 'rgba(255,255,255,0.6)', marginBottom: 6, letterSpacing: '0.04em' },
  compareDivider:{ width: 1, background: 'rgba(255,255,255,0.06)', flexShrink: 0 },
  // Verdict
  verdictHeader: { display: 'flex', alignItems: 'center', gap: 12 },
  verdictBadge:  { fontSize: 13, fontWeight: 800, letterSpacing: '0.06em', padding: '5px 14px', borderRadius: 6 },
  verdictSummary:{ fontSize: 13, color: 'rgba(255,255,255,0.75)', lineHeight: 1.6, margin: 0 },
  sizingRow:     { display: 'flex', gap: 16, alignItems: 'baseline', flexWrap: 'wrap' },
  sizingLabel:   { fontSize: 10, color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase', letterSpacing: '0.06em' },
  sizingValue:   { fontSize: 18, fontWeight: 700, color: 'rgba(255,255,255,0.85)', fontVariantNumeric: 'tabular-nums' },
  sizingMeta:    { fontSize: 11, color: 'rgba(255,255,255,0.4)' },
  councilText:   { fontSize: 13, color: 'rgba(255,255,255,0.7)', lineHeight: 1.7, whiteSpace: 'pre-wrap' },
  // Account summary rows
  acctRow:       { display: 'flex', gap: 12, alignItems: 'baseline', fontSize: 12, padding: '4px 0', borderBottom: '1px solid rgba(255,255,255,0.04)' },
  acctDetail:    { color: 'rgba(255,255,255,0.4)', fontVariantNumeric: 'tabular-nums', fontSize: 11 },
  // History
  historyTable:  { display: 'flex', flexDirection: 'column', gap: 0 },
  historyHeader: { display: 'grid', gridTemplateColumns: '60px 50px 50px 70px 70px 60px 50px 50px', gap: 8, fontSize: 9, fontWeight: 700, color: 'rgba(255,255,255,0.25)', textTransform: 'uppercase', letterSpacing: '0.05em', padding: '0 0 6px', borderBottom: '1px solid rgba(255,255,255,0.06)' },
  historyRow:    { display: 'grid', gridTemplateColumns: '60px 50px 50px 70px 70px 60px 50px 50px', gap: 8, fontSize: 11, color: 'rgba(255,255,255,0.6)', padding: '6px 0', borderBottom: '1px solid rgba(255,255,255,0.04)', fontVariantNumeric: 'tabular-nums' },
};
