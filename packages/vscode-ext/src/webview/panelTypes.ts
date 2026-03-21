// ── Panel Data Contracts ───────────────────────────────────────────────────
// Extracted from panel.ts — types and interfaces for the council session,
// pipelines, and intensity policy.

export type RiskLevel         = 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
export type SessionPhase      = 'IDLE' | 'DRAFTING' | 'RISK_CHECK' | 'CRITIQUE' | 'DEBATE' | 'COMPLETE' | 'BYPASSED';
export type ConsensusState    = 'UNANIMOUS' | 'MAJORITY' | 'SPLIT' | 'BLOCKED';
export type DeadlockResolution = 'ESCALATE' | 'USER_DECIDES' | 'SYNTHESIS' | 'EXTENDED_DEBATE';
export type CouncilMode       = 'FULL' | 'PARTIAL' | 'SOLO';
export type IntensityLevel    = 'COOPERATIVE' | 'ANALYTICAL' | 'CRITICAL' | 'RUTHLESS';

export interface IntensityState  { mode: 'ADAPTIVE' | 'LOCKED'; level: IntensityLevel; }
export interface VersionCandidate { provider: string; code: string; reasoning: string; }

export interface CouncilRecord {
  timestamp:         number;
  prompt:            string;
  draftAuthor:       string;
  councilMode:       CouncilMode;
  riskLevel:         RiskLevel;
  confidenceInitial: number;
  confidenceFinal:   number;
  consensus:         ConsensusState;
  intensity:         string;
  deadlockResolution?: DeadlockResolution;
  userOverride?:     boolean;
}

export interface DraftResult {
  code:            string;
  reasoning:       string;
  provider:        string;
  confidence:      number;
  preliminaryRisk: RiskLevel;
}

export interface RiskAnalysis {
  level:    RiskLevel;
  triggers: string[];
}

export interface SeatVerdict {
  provider:         string;
  agrees:           boolean;
  riskLevel:        RiskLevel;
  confidence:       number;
  objections:       string[];
  suggestedChanges: string[];
}

export interface CouncilDebate {
  proposal:                string;
  critique:                string;
  revision:                string;
  final:                   string;
  finalCode:               string;
  confidenceInitial:       number;
  confidenceAfterCritique: number;
  confidenceFinal:         number;
}

export interface AlternativeProposal {
  provider:       string;
  reasoning:      string;
  implementation: string;
  riskLevel:      RiskLevel;
  confidence:     number;
}

export interface CouncilSession {
  id:               string;
  prompt:           string;
  originalCode:     string;
  phase:            SessionPhase;
  draft?:           DraftResult;
  risk?:            RiskAnalysis;
  verdicts?:        SeatVerdict[];
  debate?:          CouncilDebate;
  consensus?:       ConsensusState;
  finalCode?:       string;
  alternative?:     AlternativeProposal;
  intensity:        string;
  viewMode:         'SUMMARY' | 'DEBATE';
  filePath?:        string;
  fullFileContent?: string;
  contextFiles:     Record<string, string>;
}

// ── Intensity Policy ───────────────────────────────────────────────────────

export interface IntensityPolicy {
  critiquePasses:             number;
  requireVote:                boolean;
  requireUnanimousForLowRisk: boolean;
  forceAlternativeOnDissent:  boolean;
  applyDoubleConfirm:         boolean;
  confidenceThreshold:        number;
}

export const INTENSITY_POLICY: Record<IntensityLevel, IntensityPolicy> = {
  COOPERATIVE: { critiquePasses: 0, requireVote: false, requireUnanimousForLowRisk: false,
                 forceAlternativeOnDissent: false, applyDoubleConfirm: false, confidenceThreshold: 0  },
  ANALYTICAL:  { critiquePasses: 1, requireVote: true,  requireUnanimousForLowRisk: false,
                 forceAlternativeOnDissent: false, applyDoubleConfirm: false, confidenceThreshold: 60 },
  CRITICAL:    { critiquePasses: 2, requireVote: true,  requireUnanimousForLowRisk: false,
                 forceAlternativeOnDissent: true,  applyDoubleConfirm: false, confidenceThreshold: 70 },
  RUTHLESS:    { critiquePasses: 2, requireVote: true,  requireUnanimousForLowRisk: true,
                 forceAlternativeOnDissent: true,  applyDoubleConfirm: true,  confidenceThreshold: 80 },
};
