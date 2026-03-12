// ── vibePatchPlanner.ts — Audit / rescue fix generation ──────────────────────
//
// Used by audit and rescue modes.  Identifies vibe inconsistencies via the
// consistency checker and generates targeted fixes via the build planner.

import type {
  VibeProfile, VibePatchPlan, VibePatchIssue, VibePatchFix, VibeConfig,
} from './vibeTypes';
import { DEFAULT_VIBE_CONFIG, DEFAULT_VIBE_AXES } from './vibeTypes';
import { VibeConsistencyChecker } from './vibeConsistencyChecker';
import { VibeBuildPlanner } from './vibeBuildPlanner';
import { translateVibeToDecisions } from './vibeToSystemTranslator';

export class VibePatchPlanner {
  private _checker: VibeConsistencyChecker;
  private _planner: VibeBuildPlanner;
  private _config: VibeConfig;

  constructor(
    checker: VibeConsistencyChecker,
    planner: VibeBuildPlanner,
    config?: Partial<VibeConfig>,
  ) {
    this._checker = checker;
    this._planner = planner;
    this._config = { ...DEFAULT_VIBE_CONFIG, ...config };
  }

  /**
   * Audit mode: identify issues in the current product state relative to
   * the vibe profile and generate targeted fixes.
   */
  audit(profile: VibeProfile, currentState: string): VibePatchPlan {
    const consistency = this._checker.check(profile, currentState);

    const issues: VibePatchIssue[] = consistency.violations.map((v, i) => ({
      id: `audit-${Date.now()}-${i}`,
      dimension: v.dimension,
      description: v.description,
      severity: v.severity,
    }));

    const fixes = issues.map((issue, i) => this._generateFix(issue, profile, i + 1));

    return {
      profileId: profile.id,
      issues,
      fixes: this._prioritizeFixes(fixes),
      estimatedImpact: consistency.overallScore < 50
        ? 80  // large improvement potential
        : consistency.overallScore < 70
        ? 60  // moderate improvement
        : 30, // minor polish
    };
  }

  /**
   * Rescue mode: aggressive fix plan for products that feel broken,
   * cheap, or incoherent.  Uses a lower threshold for flagging issues
   * and generates higher-priority fixes.
   */
  rescue(profile: VibeProfile, currentState: string): VibePatchPlan {
    // Use a stricter checker for rescue mode
    const rescueChecker = new VibeConsistencyChecker({
      ...this._config,
      minConsistencyScore: this._config.minConsistencyScore + 15, // flag more issues
    });

    const consistency = rescueChecker.check(profile, currentState);

    const issues: VibePatchIssue[] = consistency.violations.map((v, i) => ({
      id: `rescue-${Date.now()}-${i}`,
      dimension: v.dimension,
      description: v.description,
      severity: v.severity === 'minor' ? 'moderate' : v.severity, // escalate
    }));

    // Generate fixes with higher priority
    const fixes = issues.map((issue, i) => ({
      ...this._generateFix(issue, profile, i + 1),
      priority: Math.max(1, Math.ceil(i / 2)), // more aggressive priority
    }));

    // Also generate proactive fixes from the build planner
    const decisions = translateVibeToDecisions(profile);
    const plan = this._planner.buildPlan(profile, decisions, currentState);

    // Add component-level fixes from the build plan
    for (const target of plan.componentTargets) {
      if (target.priority === 'critical') {
        fixes.push({
          issueId: 'proactive',
          fix: `[${target.component}] ${target.changes.join('; ')}`,
          componentTarget: target.component,
          priority: 1,
        });
      }
    }

    return {
      profileId: profile.id,
      issues,
      fixes: this._prioritizeFixes(fixes),
      estimatedImpact: Math.min(95, consistency.violations.length * 15 + 40),
    };
  }

  // ── Fix generation ────────────────────────────────────────────────────────

  private _generateFix(
    issue: VibePatchIssue,
    profile: VibeProfile,
    baselinePriority: number,
  ): VibePatchFix {
    const intendedValue = profile.axes[issue.dimension] ?? 50;
    const label = issue.dimension.replace('_', ' ');

    let fix: string;
    if (intendedValue > 60) {
      fix = `Strengthen ${label}: increase visibility, prominence, and consistency of ${label}-related elements to match intended level (${intendedValue}/100).`;
    } else if (intendedValue < 40) {
      fix = `Reduce ${label}: simplify or remove excessive ${label}-related elements to match intended minimal level (${intendedValue}/100).`;
    } else {
      fix = `Balance ${label}: ensure ${label}-related elements are consistent and neither over- nor under-represented.`;
    }

    const priority = issue.severity === 'critical' ? Math.max(1, baselinePriority - 2)
                   : issue.severity === 'moderate' ? baselinePriority
                   : baselinePriority + 2;

    return {
      issueId: issue.id,
      fix,
      priority: Math.max(1, priority),
    };
  }

  // ── Priority sorting ──────────────────────────────────────────────────────

  private _prioritizeFixes(fixes: VibePatchFix[]): VibePatchFix[] {
    return fixes.sort((a, b) => a.priority - b.priority);
  }
}
