// ── vibeTypes.ts — Domain model for Council-guided Vibe Coding ────────────────
//
// Translates loose aesthetic / emotional language into concrete product
// implementation decisions.  Every vibe request is scored against trust,
// conversion, usability, and clarity — the vibe must serve the product.

// ── Vibe modes ──────────────────────────────────────────────────────────────

export type VibeMode = 'explore' | 'refine' | 'build' | 'audit' | 'rescue';

// ── Dimension axes (what the system reasons about) ──────────────────────────

export type VibeDimension =
  | 'layout'           // spatial arrangement, density, whitespace
  | 'typography'       // font weight, size, hierarchy, serif vs sans
  | 'spacing'          // margins, padding, rhythm
  | 'motion'           // transitions, animations, micro-interactions
  | 'color'            // palette, saturation, contrast
  | 'copy_tone'        // formal/casual, technical/friendly, authoritative/warm
  | 'cta_style'        // CTA urgency, size, prominence, color
  | 'trust_indicators' // social proof, certifications, guarantees
  | 'imagery'          // photo style, illustration, iconography
  | 'density';         // information density, visual breathing room

export const VIBE_DIMENSIONS: readonly VibeDimension[] = [
  'layout', 'typography', 'spacing', 'motion', 'color',
  'copy_tone', 'cta_style', 'trust_indicators', 'imagery', 'density',
] as const;

// ── Parsed vibe signal from user language ───────────────────────────────────

export interface VibeSignal {
  raw: string;
  dimension: VibeDimension;
  direction: 'increase' | 'decrease' | 'set';
  intensity: number;    // 0-100
  confidence: number;   // parser confidence 0-100
}

// ── Vibe profile (accumulated state for a product / venture) ────────────────

export interface VibeProfile {
  id: string;
  name: string;
  ventureId?: string;
  mode: VibeMode;
  axes: Record<VibeDimension, number>;   // current value per dimension, 0-100
  anchors: VibeAnchor[];
  history: VibeDecisionRecord[];
  createdAt: number;
  updatedAt: number;
}

export interface VibeAnchor {
  label: string;                         // e.g. "Apple.com", "Bloomberg terminal"
  dimensions: Partial<Record<VibeDimension, number>>;
  addedAt: number;
}

// ── System decision (a single translatable product change) ──────────────────

export interface VibeSystemDecision {
  dimension: VibeDimension;
  target: string;           // e.g. "hero section", "navigation bar"
  current?: string;         // current state description
  proposed: string;         // proposed change
  rationale: string;        // why this change serves the vibe
  impactScore: number;      // 0-100
  riskScore: number;        // 0-100
}

// ── Build plan ──────────────────────────────────────────────────────────────

export interface VibeBuildPlan {
  profileId: string;
  mode: VibeMode;
  decisions: VibeSystemDecision[];
  componentTargets: VibeComponentTarget[];
  styleChanges: VibeStyleChange[];
  copyChanges: VibeCopyChange[];
  totalImpact: number;
  totalRisk: number;
  guardrailViolations: string[];
  createdAt: number;
}

export interface VibeComponentTarget {
  component: string;         // e.g. "HeroSection", "PricingTable"
  changes: string[];
  priority: 'critical' | 'standard' | 'optional';
}

export interface VibeStyleChange {
  selector: string;          // CSS selector or component path
  property: string;
  from: string;
  to: string;
}

export interface VibeCopyChange {
  location: string;          // "headline", "cta_button", "subheadline"
  from: string;
  to: string;
  toneShift: string;         // e.g. "casual -> authoritative"
}

// ── Consistency check result ────────────────────────────────────────────────

export interface VibeConsistencyResult {
  profileId: string;
  overallScore: number;
  dimensionScores: Record<VibeDimension, number>;
  violations: VibeConsistencyViolation[];
  suggestions: string[];
}

export interface VibeConsistencyViolation {
  dimension: VibeDimension;
  description: string;
  severity: 'minor' | 'moderate' | 'critical';
}

// ── Outcome scoring ─────────────────────────────────────────────────────────

export type OutcomeDimension = 'trust' | 'conversion' | 'usability' | 'clarity';

export interface VibeOutcomeScore {
  profileId: string;
  trust: number;        // 0-100
  conversion: number;
  usability: number;
  clarity: number;
  overall: number;      // weighted average
  timestamp: number;
}

// ── Decision record (history / learning) ────────────────────────────────────

export interface VibeDecisionRecord {
  timestamp: number;
  mode: VibeMode;
  signals: VibeSignal[];
  decisionsApplied: number;
  outcomeScore?: VibeOutcomeScore;
  contributingExperts?: string[];
}

// ── Patch plan (audit / rescue mode) ────────────────────────────────────────

export interface VibePatchPlan {
  profileId: string;
  issues: VibePatchIssue[];
  fixes: VibePatchFix[];
  estimatedImpact: number;  // 0-100
}

export interface VibePatchIssue {
  id: string;
  dimension: VibeDimension;
  description: string;
  severity: 'minor' | 'moderate' | 'critical';
}

export interface VibePatchFix {
  issueId: string;
  fix: string;
  componentTarget?: string;
  priority: number;          // 1 = highest
}

// ── Council flow ────────────────────────────────────────────────────────────

export type VibeCouncilRole = 'brand_taste' | 'implementation_ux' | 'boldness_edge';

export interface VibeCouncilPosition {
  role: VibeCouncilRole;
  provider: string;
  decisions: VibeSystemDecision[];
  confidence: number;
  reasoning: string;
}

export type VibeProgressPhase =
  | 'vibe_parsing'
  | 'council_debating'
  | 'council_position:brand_taste'
  | 'council_position:implementation_ux'
  | 'council_position:boldness_edge'
  | 'synthesis'
  | 'plan_building'
  | 'consistency_check'
  | 'scoring'
  | 'complete';

// ── Configuration ───────────────────────────────────────────────────────────

export interface VibeConfig {
  maxProfileHistory: number;
  guardrailThreshold: number;     // risk above which guardrail fires, 0-100
  minConsistencyScore: number;    // below which audit flags issues, 0-100
}

export const DEFAULT_VIBE_CONFIG: VibeConfig = {
  maxProfileHistory: 100,
  guardrailThreshold: 70,
  minConsistencyScore: 60,
};

export const DEFAULT_VIBE_AXES: Record<VibeDimension, number> = {
  layout: 50,
  typography: 50,
  spacing: 50,
  motion: 50,
  color: 50,
  copy_tone: 50,
  cta_style: 50,
  trust_indicators: 50,
  imagery: 50,
  density: 50,
};
