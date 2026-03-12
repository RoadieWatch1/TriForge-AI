// ── vibeBuildPlanner.ts — Turn vibe decisions into implementation plans ───────
//
// Takes VibeSystemDecision[] from the translator and generates a concrete
// VibeBuildPlan with component targets, style changes, copy changes, and
// priorities.  Enforces guardrails: risky decisions are flagged, not applied.

import type {
  VibeProfile, VibeSystemDecision, VibeBuildPlan, VibeMode,
  VibeComponentTarget, VibeStyleChange, VibeCopyChange, VibeConfig,
} from './vibeTypes';
import { DEFAULT_VIBE_CONFIG } from './vibeTypes';

// ── Component resolution rules ──────────────────────────────────────────────

interface ComponentRule {
  targetKeywords: string[];
  component: string;
}

const COMPONENT_RULES: ComponentRule[] = [
  { targetKeywords: ['hero', 'above-the-fold'],          component: 'HeroSection' },
  { targetKeywords: ['navigation', 'nav', 'header'],     component: 'Navigation' },
  { targetKeywords: ['cta', 'action button', 'primary action'], component: 'CTAButton' },
  { targetKeywords: ['footer'],                           component: 'Footer' },
  { targetKeywords: ['pricing', 'price'],                 component: 'PricingTable' },
  { targetKeywords: ['testimonial', 'social proof', 'review'], component: 'SocialProof' },
  { targetKeywords: ['dashboard', 'panel'],               component: 'DashboardPanel' },
  { targetKeywords: ['onboarding', 'welcome'],            component: 'Onboarding' },
  { targetKeywords: ['form', 'input'],                    component: 'FormSection' },
  { targetKeywords: ['card', 'tile'],                     component: 'CardGrid' },
  { targetKeywords: ['modal', 'dialog'],                  component: 'Modal' },
  { targetKeywords: ['error', 'empty state'],             component: 'StateMessage' },
];

// ── Style property mapping ──────────────────────────────────────────────────

interface StyleRule {
  dimensionKeywords: string[];
  property: string;
  fromDefault: string;
}

const STYLE_RULES: StyleRule[] = [
  { dimensionKeywords: ['padding', 'spacing', 'whitespace', 'margin'], property: 'padding', fromDefault: '16px' },
  { dimensionKeywords: ['gap', 'card gap'],                property: 'gap', fromDefault: '12px' },
  { dimensionKeywords: ['font', 'headline', 'type'],      property: 'font-size', fromDefault: '16px' },
  { dimensionKeywords: ['weight', 'bold'],                 property: 'font-weight', fromDefault: '400' },
  { dimensionKeywords: ['color', 'palette', 'accent'],     property: 'color', fromDefault: 'inherit' },
  { dimensionKeywords: ['contrast', 'saturat'],            property: 'color', fromDefault: 'inherit' },
  { dimensionKeywords: ['transition', 'animation', 'motion'], property: 'transition', fromDefault: 'none' },
  { dimensionKeywords: ['opacity', 'subtle'],              property: 'opacity', fromDefault: '1' },
  { dimensionKeywords: ['border', 'radius'],               property: 'border-radius', fromDefault: '4px' },
  { dimensionKeywords: ['width', 'max-width'],             property: 'max-width', fromDefault: '100%' },
];

// ── Copy tone mapping ───────────────────────────────────────────────────────

interface CopyRule {
  dimensionKeywords: string[];
  location: string;
}

const COPY_RULES: CopyRule[] = [
  { dimensionKeywords: ['headline', 'hero'],      location: 'headline' },
  { dimensionKeywords: ['subheadline', 'sub'],     location: 'subheadline' },
  { dimensionKeywords: ['cta', 'action', 'button'], location: 'cta_button' },
  { dimensionKeywords: ['voice', 'tone', 'copy'],  location: 'body_copy' },
  { dimensionKeywords: ['error', 'empty'],          location: 'error_states' },
  { dimensionKeywords: ['onboarding', 'welcome'],   location: 'onboarding_flow' },
];

// ── Build planner ───────────────────────────────────────────────────────────

export class VibeBuildPlanner {
  private _config: VibeConfig;

  constructor(config?: Partial<VibeConfig>) {
    this._config = { ...DEFAULT_VIBE_CONFIG, ...config };
  }

  buildPlan(
    profile: VibeProfile,
    decisions: VibeSystemDecision[],
    currentState?: string,
  ): VibeBuildPlan {
    const componentTargets = this._resolveComponentTargets(decisions);
    const styleChanges     = this._resolveStyleChanges(decisions);
    const copyChanges      = this._resolveCopyChanges(decisions);

    const guardrailViolations: string[] = [];
    for (const d of decisions) {
      if (d.riskScore > this._config.guardrailThreshold) {
        guardrailViolations.push(
          `[${d.dimension}] "${d.proposed}" — risk ${d.riskScore} exceeds threshold`,
        );
      }
    }

    const safeDecs = decisions.filter(d => d.riskScore <= this._config.guardrailThreshold);
    const totalImpact = safeDecs.length > 0
      ? Math.round(safeDecs.reduce((s, d) => s + d.impactScore, 0) / safeDecs.length)
      : 0;
    const totalRisk = safeDecs.length > 0
      ? Math.round(safeDecs.reduce((s, d) => s + d.riskScore, 0) / safeDecs.length)
      : 0;

    const plan: VibeBuildPlan = {
      profileId: profile.id,
      mode: profile.mode,
      decisions: safeDecs,
      componentTargets,
      styleChanges,
      copyChanges,
      totalImpact,
      totalRisk,
      guardrailViolations,
      createdAt: Date.now(),
    };

    return this._prioritize(plan);
  }

  // ── Component resolution ────────────────────────────────────────────────

  private _resolveComponentTargets(decisions: VibeSystemDecision[]): VibeComponentTarget[] {
    const targets = new Map<string, VibeComponentTarget>();

    for (const d of decisions) {
      const lower = d.target.toLowerCase();
      for (const rule of COMPONENT_RULES) {
        if (rule.targetKeywords.some(kw => lower.includes(kw))) {
          const existing = targets.get(rule.component);
          if (existing) {
            existing.changes.push(d.proposed);
            // Upgrade priority if impact is high
            if (d.impactScore >= 80) existing.priority = 'critical';
          } else {
            targets.set(rule.component, {
              component: rule.component,
              changes: [d.proposed],
              priority: d.impactScore >= 80 ? 'critical'
                      : d.impactScore >= 50 ? 'standard'
                      : 'optional',
            });
          }
          break;
        }
      }
    }

    return Array.from(targets.values());
  }

  // ── Style resolution ────────────────────────────────────────────────────

  private _resolveStyleChanges(decisions: VibeSystemDecision[]): VibeStyleChange[] {
    const changes: VibeStyleChange[] = [];

    for (const d of decisions) {
      const lower = d.proposed.toLowerCase();
      for (const rule of STYLE_RULES) {
        if (rule.dimensionKeywords.some(kw => lower.includes(kw))) {
          // Extract numeric values from proposed text
          const numMatch = d.proposed.match(/(\d+)px/);
          const to = numMatch ? `${numMatch[1]}px` : d.proposed.slice(0, 60);

          changes.push({
            selector: `.${d.target.replace(/\s+/g, '-').toLowerCase()}`,
            property: rule.property,
            from: rule.fromDefault,
            to,
          });
          break;
        }
      }
    }

    return changes;
  }

  // ── Copy resolution ─────────────────────────────────────────────────────

  private _resolveCopyChanges(decisions: VibeSystemDecision[]): VibeCopyChange[] {
    const changes: VibeCopyChange[] = [];

    for (const d of decisions) {
      if (d.dimension !== 'copy_tone' && d.dimension !== 'cta_style') continue;

      const lower = d.proposed.toLowerCase();
      for (const rule of COPY_RULES) {
        if (rule.dimensionKeywords.some(kw => lower.includes(kw))) {
          changes.push({
            location: rule.location,
            from: d.current ?? '(current copy)',
            to: d.proposed,
            toneShift: d.dimension === 'copy_tone'
              ? d.rationale.split('—')[0]?.trim() ?? d.rationale
              : 'action emphasis',
          });
          break;
        }
      }
    }

    return changes;
  }

  // ── Prioritization ──────────────────────────────────────────────────────

  private _prioritize(plan: VibeBuildPlan): VibeBuildPlan {
    // Sort component targets: critical > standard > optional
    const priorityOrder = { critical: 0, standard: 1, optional: 2 };
    plan.componentTargets.sort((a, b) => priorityOrder[a.priority] - priorityOrder[b.priority]);

    // Sort decisions by impact desc
    plan.decisions.sort((a, b) => b.impactScore - a.impactScore);

    return plan;
  }
}
