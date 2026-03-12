// ── vibeOutcomeScorer.ts — Score vibe decisions against business outcomes ────
//
// Evaluates how vibe choices affect trust, conversion, usability, and clarity.
// Keeps vibe coding from becoming stylistic nonsense — every aesthetic
// decision is measured against outcomes that matter.

import type {
  VibeProfile, VibeSystemDecision, VibeOutcomeScore,
  VibeBuildPlan, VibeDimension, OutcomeDimension,
} from './vibeTypes';
import { VIBE_DIMENSIONS } from './vibeTypes';

// ── Outcome weight matrix ───────────────────────────────────────────────────
//
// Maps each vibe dimension to its influence on each outcome dimension.
// Weights are 0-1, representing how strongly a dimension's axis value
// affects that outcome.

const OUTCOME_WEIGHTS: Record<VibeDimension, Record<OutcomeDimension, number>> = {
  layout: {
    trust: 0.3,       conversion: 0.4,    usability: 0.8,    clarity: 0.7,
  },
  typography: {
    trust: 0.5,       conversion: 0.3,    usability: 0.6,    clarity: 0.8,
  },
  spacing: {
    trust: 0.3,       conversion: 0.2,    usability: 0.7,    clarity: 0.6,
  },
  motion: {
    trust: -0.2,      conversion: 0.3,    usability: -0.1,   clarity: 0.1,
  },
  color: {
    trust: 0.2,       conversion: 0.5,    usability: 0.3,    clarity: 0.4,
  },
  copy_tone: {
    trust: 0.7,       conversion: 0.4,    usability: 0.3,    clarity: 0.6,
  },
  cta_style: {
    trust: -0.1,      conversion: 0.9,    usability: 0.2,    clarity: 0.3,
  },
  trust_indicators: {
    trust: 0.9,       conversion: 0.5,    usability: 0.1,    clarity: 0.2,
  },
  imagery: {
    trust: 0.2,       conversion: 0.4,    usability: 0.1,    clarity: -0.1,
  },
  density: {
    trust: 0.1,       conversion: -0.2,   usability: -0.3,   clarity: -0.4,
  },
};

// Outcome dimension weights for overall score
const OVERALL_WEIGHTS: Record<OutcomeDimension, number> = {
  trust: 0.30,
  conversion: 0.25,
  usability: 0.25,
  clarity: 0.20,
};

// ── Scorer ──────────────────────────────────────────────────────────────────

export class VibeOutcomeScorer {

  /**
   * Score a profile's axis values against outcome dimensions.
   *
   * Each dimension's axis value contributes positively or negatively
   * to each outcome based on the weight matrix.  The score is normalized
   * to 0-100.
   */
  score(profile: VibeProfile, decisions: VibeSystemDecision[]): VibeOutcomeScore {
    const outcomes = this._computeOutcomes(profile);

    // Bonus from decision quality (high-impact, low-risk decisions help)
    if (decisions.length > 0) {
      const avgImpact = decisions.reduce((s, d) => s + d.impactScore, 0) / decisions.length;
      const avgRisk   = decisions.reduce((s, d) => s + d.riskScore, 0) / decisions.length;
      const decisionBonus = (avgImpact - avgRisk) / 200; // -0.5 to +0.5

      for (const key of Object.keys(outcomes) as OutcomeDimension[]) {
        outcomes[key] = clamp(outcomes[key] + decisionBonus * 10, 0, 100);
      }
    }

    const overall = this._computeOverall(outcomes);

    return {
      profileId: profile.id,
      trust: Math.round(outcomes.trust),
      conversion: Math.round(outcomes.conversion),
      usability: Math.round(outcomes.usability),
      clarity: Math.round(outcomes.clarity),
      overall: Math.round(overall),
      timestamp: Date.now(),
    };
  }

  /**
   * Predict outcome from a build plan (before implementation).
   */
  predictOutcome(plan: VibeBuildPlan): VibeOutcomeScore {
    // Use plan-level metrics for a rough prediction
    const impactFactor = plan.totalImpact / 100;    // 0-1
    const riskFactor   = plan.totalRisk / 100;      // 0-1
    const violationPenalty = plan.guardrailViolations.length * 5;

    const base = 60; // baseline score
    const trust      = clamp(base + impactFactor * 20 - riskFactor * 15 - violationPenalty, 0, 100);
    const conversion = clamp(base + impactFactor * 25 - riskFactor * 10 - violationPenalty, 0, 100);
    const usability  = clamp(base + impactFactor * 15 - riskFactor * 20 - violationPenalty, 0, 100);
    const clarity    = clamp(base + impactFactor * 20 - riskFactor * 10 - violationPenalty, 0, 100);

    const outcomes = { trust, conversion, usability, clarity };
    const overall = this._computeOverall(outcomes);

    return {
      profileId: plan.profileId,
      trust: Math.round(trust),
      conversion: Math.round(conversion),
      usability: Math.round(usability),
      clarity: Math.round(clarity),
      overall: Math.round(overall),
      timestamp: Date.now(),
    };
  }

  /**
   * Retrospective scoring with actual user feedback.
   */
  scoreWithFeedback(
    profile: VibeProfile,
    feedback: { metric: OutcomeDimension; value: number }[],
  ): VibeOutcomeScore {
    // Start from computed baseline
    const outcomes = this._computeOutcomes(profile);

    // Override with actual feedback (weighted blend: 60% feedback, 40% computed)
    for (const f of feedback) {
      outcomes[f.metric] = outcomes[f.metric] * 0.4 + f.value * 0.6;
    }

    const overall = this._computeOverall(outcomes);

    return {
      profileId: profile.id,
      trust: Math.round(outcomes.trust),
      conversion: Math.round(outcomes.conversion),
      usability: Math.round(outcomes.usability),
      clarity: Math.round(outcomes.clarity),
      overall: Math.round(overall),
      timestamp: Date.now(),
    };
  }

  // ── Internal ──────────────────────────────────────────────────────────────

  private _computeOutcomes(profile: VibeProfile): Record<OutcomeDimension, number> {
    const outcomes: Record<OutcomeDimension, number> = {
      trust: 50,
      conversion: 50,
      usability: 50,
      clarity: 50,
    };

    for (const dim of VIBE_DIMENSIONS) {
      const axisValue = profile.axes[dim] ?? 50;
      const deviation = (axisValue - 50) / 50; // -1 to +1
      const weights = OUTCOME_WEIGHTS[dim];

      for (const outcome of Object.keys(outcomes) as OutcomeDimension[]) {
        const weight = weights[outcome];
        // Positive weight + positive deviation = positive impact
        // Negative weight + positive deviation = negative impact
        outcomes[outcome] += deviation * weight * 25;
      }
    }

    // Clamp all values
    for (const key of Object.keys(outcomes) as OutcomeDimension[]) {
      outcomes[key] = clamp(outcomes[key], 0, 100);
    }

    return outcomes;
  }

  private _computeOverall(outcomes: Record<OutcomeDimension, number>): number {
    let overall = 0;
    for (const [key, weight] of Object.entries(OVERALL_WEIGHTS)) {
      overall += outcomes[key as OutcomeDimension] * weight;
    }
    return clamp(overall, 0, 100);
  }
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
