// ── learning/index.ts — Public API for the Learning Brain subsystem ─────────

export type {
  LearningSignalType, LearningSignal,
  VentureDecision, VentureOutcomeRecord,
  ExpertContributionRecord,
  LearningProfile, TrendMomentum, TrendSnapshot, TrendData,
  LearningConfig,
} from './learningTypes';
export { DEFAULT_LEARNING_PROFILE, DEFAULT_LEARNING_CONFIG } from './learningTypes';

export { LearningProfileStore } from './learningProfileStore';
export { SignalCollector } from './signalCollector';
export type { PulseMetrics } from './signalCollector';
export { TrendTracker } from './trendTracker';
export type { SearchFn } from './trendTracker';
export {
  applyUserDecisionBias, applyOutcomeBias, applyTrendBias,
  applyExpertBias, computeBiases,
} from './biasEngine';
export { VentureMemoryGraph } from './ventureMemoryGraph';
export { LearningOrchestrator } from './learningOrchestrator';
