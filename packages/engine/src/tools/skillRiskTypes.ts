// ── Skill Risk Types — Phase 2: Skill Trust Layer ────────────────────────────
//
// Shared types for skillTrustEvaluator and skillPolicyGate.
// No runtime dependencies — pure type definitions.

export type SkillRiskLevel = 'low' | 'medium' | 'high' | 'critical';

/** Parsed YAML frontmatter from a SKILL.md file. */
export interface SkillFrontmatter {
  name?: string;
  version?: string;
  description?: string;
  author?: string;
  // Declared capability flags
  permissions?: string[];
  tools?: string[];
  network?: boolean;
  files?: boolean;
  commands?: boolean;
  credentials?: boolean;
  requiresApproval?: boolean;
  trustLevel?: string;
  trigger?: string;
  [key: string]: unknown;
}

/** A single dangerous pattern found in the skill body. */
export interface DetectedPattern {
  pattern: string;
  severity: 'medium' | 'high' | 'critical';
  description: string;
}

/** Full result returned by skillTrustEvaluator.analyze(). */
export interface SkillAnalysisResult {
  /** Overall risk classification. */
  riskLevel: SkillRiskLevel;
  /** If true, the policy gate will block this skill outright. */
  blocked: boolean;
  /** Human-readable reason for a block. Present when blocked === true. */
  blockReason?: string;
  /** If true, a human must explicitly approve before execution. */
  requiresApproval: boolean;
  /** If true, the three-head council must review before execution. */
  councilReviewRequired: boolean;
  /** Capabilities the skill declared in its frontmatter. */
  declaredCapabilities: string[];
  /** Capabilities inferred by scanning the skill body. */
  detectedCapabilities: string[];
  /** Individual dangerous patterns found during analysis. */
  detectedPatterns: DetectedPattern[];
  /** One-paragraph human-readable summary for display in UI. */
  reviewSummary: string;
  /** Parsed frontmatter (raw). */
  frontmatter: SkillFrontmatter;
}

/** Decision returned by skillPolicyGate.evaluate(). */
export interface PolicyGateDecision {
  allowed: boolean;
  requiresApproval: boolean;
  requiresCouncilReview: boolean;
  blockReason?: string;
}
