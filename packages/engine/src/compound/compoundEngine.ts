/**
 * compoundEngine.ts — Adaptive learning orchestrator (Phase 7)
 *
 * Ties together StrategyStore, evaluator, and scaler.
 * Called by GrowthService after each loop run to learn, scale, and cross-pollinate.
 */

import type { ProviderManager } from '../core/providerManager';
import type { GrowthLoop, GrowthLoopMetrics } from '../growth/growthTypes';
import type { StrategyProfile, CompoundStats } from './compoundTypes';
import { StrategyStore } from './strategyStore';
import { evaluate } from './evaluator';
import { getScalingDecision, applyScaling } from './scaler';

export class CompoundEngine {
  private _store: StrategyStore;
  private _getProvider: () => ProviderManager | null;
  private _lastOptimizedAt: number | null = null;

  constructor(dataDir: string, getProvider: () => ProviderManager | null) {
    this._store       = new StrategyStore(dataDir);
    this._getProvider = getProvider;
  }

  // ── Record results ────────────────────────────────────────────────────────────

  /**
   * Called by GrowthService after each outreach batch (sync).
   * Upserts a StrategyProfile keyed on subject line.
   */
  recordOutreachResult(params: {
    loopId: string;
    subject: string;
    tone?: string;
    sent: number;
    replies: number;
    conversions: number;
    leads: number;
    /** Optional A/B variant label — 'A' | 'B' | custom string. Tracked separately per variant. */
    variantLabel?: string;
  }): StrategyProfile {
    // Include variantLabel in description key so A/B variants are tracked separately
    const variantSuffix = params.variantLabel ? ` [${params.variantLabel}]` : '';
    const desc = `Subject: ${params.subject.slice(0, 80)}${variantSuffix}`;

    // Upsert: find existing by description or create new
    const existing = this._store.findByDescription(desc, 'outreach');
    const sent        = (existing?.performance.sent      ?? 0) + params.sent;
    const replies     = (existing?.performance.replies   ?? 0) + params.replies;
    const conversions = (existing?.performance.conversions ?? 0) + params.conversions;
    const leads       = (existing?.performance.leads     ?? 0) + params.leads;

    const performance: StrategyProfile['performance'] = {
      sent,
      replies,
      conversions,
      leads,
      replyRate:      sent > 0 ? replies / sent      : 0,
      conversionRate: sent > 0 ? conversions / sent  : 0,
    };

    const { score, status } = evaluate({ ...({} as StrategyProfile), performance });

    if (existing) {
      return this._store.update(existing.id, { performance, score, status })!;
    }

    return this._store.create({
      loopId:       params.loopId,
      type:         'outreach',
      description:  desc,
      variantLabel: params.variantLabel,
      inputs:       { subjectLine: params.subject, tone: params.tone },
      performance,
      score,
      status,
    });
  }

  /**
   * Compares the A and B variants of an active A/B test.
   * Returns the winner (higher score) and the loser ID for retirement.
   * Returns null if there are fewer than 2 variants with sufficient data.
   */
  evaluateAbTest(loopId: string): { winner: StrategyProfile; loserId: string } | null {
    const variants = this._store.list('outreach').filter(
      s => s.loopId === loopId && s.variantLabel && (s.performance.sent ?? 0) >= 10,
    );
    if (variants.length < 2) return null;

    // Sort by score — highest first
    const sorted = [...variants].sort((a, b) => b.score - a.score);
    const winner = sorted[0];
    const loser  = sorted[sorted.length - 1];

    if (winner.id === loser.id) return null;  // all tied
    return { winner, loserId: loser.id };
  }

  /**
   * Called by GrowthService after each content batch (sync).
   * Upserts a StrategyProfile keyed on contentType + keywords.
   */
  recordContentResult(params: {
    loopId: string;
    contentType: string;
    keywords: string[];
    postsPublished: number;
  }): StrategyProfile {
    const desc = `${params.contentType}: ${params.keywords.slice(0, 3).join(', ') || 'general'}`;

    const existing = this._store.findByDescription(desc, 'content');
    const sent = (existing?.performance.sent ?? 0) + params.postsPublished;

    const performance: StrategyProfile['performance'] = {
      sent,
      // replies and conversions are updated externally via optimization cycle
      replies:     existing?.performance.replies     ?? 0,
      conversions: existing?.performance.conversions ?? 0,
      leads:       existing?.performance.leads       ?? 0,
      replyRate:      sent > 0 ? (existing?.performance.replies ?? 0) / sent : 0,
      conversionRate: sent > 0 ? (existing?.performance.conversions ?? 0) / sent : 0,
    };

    const { score, status } = evaluate({ ...({} as StrategyProfile), performance });

    if (existing) {
      return this._store.update(existing.id, { performance, score, status })!;
    }

    return this._store.create({
      loopId:      params.loopId,
      type:        'content',
      description: desc,
      inputs:      { contentType: params.contentType, keywords: params.keywords },
      performance,
      score,
      status,
    });
  }

  // ── Strategy access ───────────────────────────────────────────────────────────

  /**
   * Returns the best active strategy of the given type.
   * GrowthService injects this into AI generation prompts.
   * Returns null if no high-performer found yet.
   */
  getBestStrategy(type: 'outreach' | 'content'): StrategyProfile | null {
    const best = this._store.findBest(type, 1);
    return best[0] ?? null;
  }

  // ── Optimization cycle ────────────────────────────────────────────────────────

  /**
   * Re-evaluate all strategies, update their scores, and scale loop limits.
   * Safe to call repeatedly — no AI calls, fast and synchronous.
   */
  runOptimizationCycle(
    loops: GrowthLoop[],
    getLoopMetrics: (id: string) => GrowthLoopMetrics,
    updateLoop: (id: string, patch: Partial<GrowthLoop>) => void,
  ): { scaled: number; optimized: number } {
    let scaled = 0;
    let optimized = 0;

    // Re-evaluate all strategies
    const all = this._store.list();
    for (const s of all) {
      const { score, status } = evaluate(s);
      if (score !== s.score || status !== s.status) {
        this._store.update(s.id, { score, status });
        optimized++;
      }
    }

    // Scale each loop based on its best strategy
    for (const loop of loops) {
      const loopType: 'outreach' | 'content' = loop.type === 'content' ? 'content' : 'outreach';
      const best = this.getBestStrategy(loopType);
      const metrics = getLoopMetrics(loop.id);

      const decision = getScalingDecision(best, metrics.emailsSent + metrics.postsPublished);
      if (decision.action !== 'hold') {
        const patch = applyScaling(loop, decision);
        updateLoop(loop.id, patch);
        scaled++;
        console.log(`[compoundEngine] loop ${loop.id}: ${decision.action} — ${decision.reason}`);
      }
    }

    this._lastOptimizedAt = Date.now();
    return { scaled, optimized };
  }

  // ── Cross-loop learning ───────────────────────────────────────────────────────

  /**
   * If an outreach strategy is a high-performer, create a content strategy
   * variant using its tone/angle for a sibling content loop.
   */
  crossLearnOutreachToContent(
    outreachStrategy: StrategyProfile,
    contentLoopId: string,
  ): StrategyProfile {
    const angle = outreachStrategy.inputs.subjectLine ?? outreachStrategy.description;
    const desc  = `content: angle from "${angle.slice(0, 50)}"`;

    const existing = this._store.findByDescription(desc, 'content');
    if (existing) return existing;

    return this._store.create({
      loopId:      contentLoopId,
      type:        'content',
      description: desc,
      inputs: {
        contentType: 'tweet',
        tone:        outreachStrategy.inputs.tone ?? 'value-first',
        keywords:    outreachStrategy.inputs.keywords,
      },
      performance: {},
      score:       0,
      status:      'testing',
    });
  }

  // ── AI variation generation ───────────────────────────────────────────────────

  /**
   * AI-generate 2 A/B variations for a strategy.
   * Creates them as 'testing' StrategyProfiles.
   * Non-blocking — caller does not need to await in critical path.
   */
  async generateVariations(baseStrategy: StrategyProfile): Promise<StrategyProfile[]> {
    const pm = this._getProvider();
    if (!pm) return [];

    try {
      const providers = await pm.getActiveProviders();
      if (!providers.length) return [];

      const prompt = [
        `You are a growth optimization assistant.`,
        `Current ${baseStrategy.type} strategy: "${baseStrategy.description}"`,
        `Current score: ${baseStrategy.score.toFixed(2)} (reply rate: ${Math.round((baseStrategy.performance.replyRate ?? 0) * 100)}%)`,
        ``,
        `Generate 2 A/B test variations. Each should test a different angle.`,
        `Return ONLY a JSON array with 2 objects:`,
        `[{"subjectLine": "...", "tone": "..."}, {"subjectLine": "...", "tone": "..."}]`,
        `No markdown. Valid JSON only.`,
      ].join('\n');

      const raw = await providers[0].generateResponse(prompt);
      const match = raw.match(/\[[\s\S]*?\]/);
      if (!match) return [];

      const variations = JSON.parse(match[0]) as Array<{ subjectLine?: string; tone?: string }>;
      const created: StrategyProfile[] = [];

      const variantLabels = ['A', 'B'];
      for (const [idx, v] of variations.slice(0, 2).entries()) {
        if (!v.subjectLine) continue;
        const variantLabel = variantLabels[idx];
        const desc = `Subject: ${v.subjectLine.slice(0, 80)} [${variantLabel}]`;
        const existing = this._store.findByDescription(desc, baseStrategy.type);
        if (!existing) {
          created.push(this._store.create({
            loopId:       baseStrategy.loopId,
            type:         baseStrategy.type,
            description:  desc,
            variantLabel,
            inputs:       { subjectLine: v.subjectLine, tone: v.tone },
            performance:  {},
            score:        0,
            status:       'testing',
          }));
        }
      }

      return created;
    } catch {
      return [];
    }
  }

  // ── Query API ─────────────────────────────────────────────────────────────────

  getTopStrategies(limit = 5, type?: StrategyProfile['type']): StrategyProfile[] {
    return this._store.list(type).slice(0, limit);
  }

  getCompoundStats(): CompoundStats {
    const all  = this._store.list();
    const high = all.filter(s => s.status === 'active').length;
    const low  = all.filter(s => s.status === 'deprecated').length;
    const test = all.filter(s => s.status === 'testing').length;
    const avg  = all.length > 0 ? all.reduce((sum, s) => sum + s.score, 0) / all.length : 0;

    return {
      totalStrategies:  all.length,
      highPerformers:   high,
      lowPerformers:    low,
      testingStrategies: test,
      avgScore:         Math.round(avg * 100) / 100,
      lastOptimizedAt:  this._lastOptimizedAt,
    };
  }
}
