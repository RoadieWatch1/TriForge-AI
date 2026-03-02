/**
 * growthService.ts — Growth Engine execution layer (Phase 6)
 *
 * Orchestrates daily growth loops: AI-generated outreach emails + content posts.
 * Respects rate limits, trust modes, and paper-mode fallbacks.
 * Integrates with serviceLocator (mail/twitter) and ProviderManager (AI).
 * Events emitted to eventBus → ValueEngine picks them up automatically.
 */

import {
  LoopStore, LeadStore, ContentStore,
  CompoundEngine,
  serviceLocator, eventBus,
  type GrowthLoop, type Lead, type GrowthLoopMetrics,
  type EmailTarget,
} from '@triforge/engine';
import type { ProviderManager } from '@triforge/engine';

// ── Safety constants ───────────────────────────────────────────────────────────

const MAX_DAILY_EMAILS  = 50;
const MAX_DAILY_POSTS   = 5;
const SEND_DELAY_MS     = 1500;   // delay between individual sends
const MIN_HOURS_BETWEEN_RUNS = 23;
const TICK_INTERVAL_MS  = 15 * 60 * 1000;  // check every 15 min
const STARTUP_DELAY_MS  = 6000;            // delay first tick after startup

// ── GrowthService ──────────────────────────────────────────────────────────────

export class GrowthService {
  private _loopStore: LoopStore;
  private _leadStore: LeadStore;
  private _contentStore: ContentStore;
  private _getProvider: () => ProviderManager | null;
  private _compound: CompoundEngine;
  private _intervalId: ReturnType<typeof setInterval> | null = null;

  constructor(
    dataDir: string,
    getProviderManager: () => ProviderManager | null,
    compoundEngine: CompoundEngine,
  ) {
    this._loopStore    = new LoopStore(dataDir);
    this._leadStore    = new LeadStore(dataDir);
    this._contentStore = new ContentStore(dataDir);
    this._getProvider  = getProviderManager;
    this._compound     = compoundEngine;
  }

  /** Expose for IPC handlers that need direct compound access */
  getCompoundEngine(): CompoundEngine { return this._compound; }

  /** Run a full optimization cycle across all active loops (called by IPC handler) */
  runOptimization(): { scaled: number; optimized: number } {
    const activeLoops = this._loopStore.listActive();
    return this._compound.runOptimizationCycle(
      activeLoops,
      id => this.getLoopMetrics(id),
      (id, patch) => { this._loopStore.update(id, patch); },
    );
  }

  // ── Daily runner ─────────────────────────────────────────────────────────────

  startDailyRunner(): void {
    if (this._intervalId) return;
    this._intervalId = setInterval(
      () => this._tick().catch(e => console.error('[growthService] tick:', e)),
      TICK_INTERVAL_MS,
    );
    // First tick after startup delay
    setTimeout(
      () => this._tick().catch(e => console.error('[growthService] startup tick:', e)),
      STARTUP_DELAY_MS,
    );
    console.log('[growthService] daily runner started');
  }

  stopDailyRunner(): void {
    if (this._intervalId) { clearInterval(this._intervalId); this._intervalId = null; }
  }

  private async _tick(): Promise<void> {
    const loops = this._loopStore.listActive();
    for (const loop of loops) {
      if (this._isDue(loop)) {
        console.log(`[growthService] running loop ${loop.id} (${loop.type}: ${loop.goal.slice(0, 40)})`);
        await this.runLoop(loop.id).catch(e =>
          console.error(`[growthService] loop ${loop.id} failed:`, e)
        );
      }
    }
  }

  private _isDue(loop: GrowthLoop): boolean {
    if (!loop.lastRunAt) return true;
    const hoursSince = (Date.now() - loop.lastRunAt) / (1000 * 60 * 60);
    return hoursSince >= MIN_HOURS_BETWEEN_RUNS;
  }

  // ── Loop execution ────────────────────────────────────────────────────────────

  async runLoop(loopId: string): Promise<{ ok: boolean; error?: string }> {
    const loop = this._loopStore.get(loopId);
    if (!loop)                    return { ok: false, error: 'Loop not found' };
    if (loop.status !== 'active') return { ok: false, error: 'Loop is paused' };

    try {
      if (loop.type === 'outreach' || loop.type === 'hybrid') {
        await this._runOutreach(loop);
      }
      if (loop.type === 'content' || loop.type === 'hybrid') {
        await this._runContent(loop);
      }

      this._loopStore.update(loopId, {
        lastRunAt: Date.now(),
        runCount: loop.runCount + 1,
        nextRunAt: Date.now() + 24 * 60 * 60 * 1000,
      });

      // Phase 7: run optimization cycle (sync, fast — no AI)
      try {
        const { scaled, optimized } = this._compound.runOptimizationCycle(
          [this._loopStore.get(loopId) ?? loop],
          id => this.getLoopMetrics(id),
          (id, patch) => { this._loopStore.update(id, patch); },
        );
        if (scaled > 0 || optimized > 0) {
          console.log(`[growthService] compound: ${optimized} strategies re-evaluated, ${scaled} loops scaled`);
        }
      } catch (e) {
        console.error('[growthService] compoundEngine optimization error:', e);
      }

      // Phase 7: cross-learn — if a winning outreach strategy exists, share with sibling content loops
      try {
        const winner = this._compound.getBestStrategy('outreach');
        if (winner && loop.type !== 'content' && loop.campaignId) {
          const sibling = this._loopStore.listActive()
            .filter(l => l.type !== 'outreach' && l.campaignId === loop.campaignId);
          sibling.forEach(cl => this._compound.crossLearnOutreachToContent(winner, cl.id));
        }
      } catch (e) {
        console.error('[growthService] cross-learn error:', e);
      }

      // Async improvement analysis — non-blocking
      this._analyzeAndImprove(loopId).catch(console.error);

      return { ok: true };
    } catch (e) {
      console.error('[growthService] runLoop error:', e);
      return { ok: false, error: String(e) };
    }
  }

  // ── Outreach ──────────────────────────────────────────────────────────────────

  private async _runOutreach(loop: GrowthLoop): Promise<void> {
    const targets = loop.config.emailList ?? [];
    if (targets.length === 0) {
      console.log(`[growthService] loop ${loop.id}: no email targets configured`);
      return;
    }

    // Filter already-contacted leads for this loop
    const sent = new Set(this._leadStore.list(loop.id).map(l => l.contact));
    const pending = targets.filter(t => !sent.has(t.email));

    const limit = Math.min(loop.config.dailyEmailLimit ?? 10, MAX_DAILY_EMAILS);
    const batch = pending.slice(0, limit);

    console.log(`[growthService] outreach: ${batch.length} new targets (${pending.length - batch.length} deferred)`);

    // Phase 7: get best strategy to inject into generation
    const bestStrategy = this._compound.getBestStrategy('outreach');
    let lastSubject = '';

    for (let i = 0; i < batch.length; i++) {
      const target = batch[i];
      const email = await this._generateEmail(loop, target, bestStrategy ?? undefined);
      if (i === 0) lastSubject = email.subject;

      const result = await serviceLocator.sendMail({
        to:      target.email,
        subject: email.subject,
        body:    email.body,
      });

      // Create lead in pipeline
      this._leadStore.create({
        source:     'email',
        contact:    target.email,
        name:       target.name,
        status:     'contacted',
        loopId:     loop.id,
        campaignId: loop.campaignId,
      });

      // Emit to eventBus — ValueEngine will pick up EMAIL_SENT
      eventBus.emit({
        type:      'EMAIL_SENT',
        taskId:    loop.id,
        stepId:    `outreach-${Date.now()}`,
        to:        [target.email],
        subject:   email.subject,
        paperMode: result.paperMode,
      });

      // Rate limit: small delay between sends
      if (i < batch.length - 1) {
        await _sleep(SEND_DELAY_MS);
      }
    }

    // Phase 7: record outreach result for strategy learning
    if (batch.length > 0 && lastSubject) {
      const loopLeads = this._leadStore.list(loop.id);
      const replied   = loopLeads.filter(l => ['replied', 'converted'].includes(l.status)).length;
      const converted = loopLeads.filter(l => l.status === 'converted').length;
      this._compound.recordOutreachResult({
        loopId:      loop.id,
        subject:     lastSubject,
        tone:        bestStrategy?.inputs.tone,
        sent:        batch.length,
        replies:     replied,
        conversions: converted,
        leads:       loopLeads.length,
      });
    }
  }

  private async _generateEmail(
    loop: GrowthLoop,
    target: EmailTarget,
    bestStrategy?: { inputs: { subjectLine?: string; tone?: string } },
  ): Promise<{ subject: string; body: string }> {
    const fallback = _emailFallback(loop, target);
    const pm = this._getProvider();
    if (!pm) return fallback;

    try {
      const providers = await pm.getActiveProviders();
      if (!providers.length) return fallback;

      // Phase 7: inject winning strategy angle if available
      const winnerHint = bestStrategy?.inputs.subjectLine
        ? `\nWinning angle to emulate (adapt, don't copy): "${bestStrategy.inputs.subjectLine}"${bestStrategy.inputs.tone ? ` Tone: ${bestStrategy.inputs.tone}` : ''}`
        : '';

      const prompt = [
        `Write a short outreach email. Max 120 words. No spam. Value-first tone.`,
        `Goal: ${loop.goal}`,
        `Recipient: ${target.name ?? target.email}${target.interest ? `, interested in ${target.interest}` : ''}`,
        `Target audience: ${loop.config.targetAudience ?? 'professionals'}`,
        winnerHint,
        ``,
        `Return ONLY a JSON object: {"subject": "...", "body": "..."}`,
        `No markdown. No extra text. Valid JSON only.`,
      ].join('\n');

      const raw = await providers[0].generateResponse(prompt);
      const match = raw.match(/\{[\s\S]*?\}/);
      if (!match) return fallback;
      const parsed = JSON.parse(match[0]) as { subject?: string; body?: string };
      if (parsed.subject && parsed.body) return { subject: parsed.subject, body: parsed.body };
    } catch {
      // fall through to template
    }
    return fallback;
  }

  // ── Content ───────────────────────────────────────────────────────────────────

  private async _runContent(loop: GrowthLoop): Promise<void> {
    const limit   = Math.min(loop.config.dailyPostLimit ?? 1, MAX_DAILY_POSTS);
    const topics  = loop.config.keywords?.length ? loop.config.keywords : [loop.goal];
    const recent  = this._contentStore.recentContent(loop.id, 10);

    // Phase 7: get best content strategy for prompt injection
    const bestContentStrategy = this._compound.getBestStrategy('content');
    let postsPublished = 0;

    for (let i = 0; i < limit; i++) {
      const topic   = topics[i % topics.length];
      const postText = await this._generatePost(loop, topic, recent, bestContentStrategy ?? undefined);

      const result = await serviceLocator.postTweet({ content: postText });

      this._contentStore.create({
        loopId:      loop.id,
        campaignId:  loop.campaignId,
        type:        'tweet',
        content:     postText,
        status:      'published',
        platform:    'twitter',
        paperMode:   result.paperMode,
        publishedAt: Date.now(),
      });

      postsPublished++;

      // Emit to eventBus
      eventBus.emit({
        type:      'TWEET_POSTED',
        taskId:    loop.id,
        stepId:    `content-${i}-${Date.now()}`,
        tweetId:   result.tweetId,
        url:       result.url,
        paperMode: result.paperMode,
      });
    }

    // Phase 7: record content result for strategy learning
    if (postsPublished > 0) {
      this._compound.recordContentResult({
        loopId:         loop.id,
        contentType:    'tweet',
        keywords:       topics,
        postsPublished,
      });
    }
  }

  private async _generatePost(
    loop: GrowthLoop,
    topic: string,
    recentContent: string[],
    bestStrategy?: { inputs: { tone?: string; keywords?: string[] } },
  ): Promise<string> {
    const fallback = _postFallback(loop, topic);
    const pm = this._getProvider();
    if (!pm) return fallback;

    try {
      const providers = await pm.getActiveProviders();
      if (!providers.length) return fallback;

      const avoidClause = recentContent.length > 0
        ? `Avoid repeating these recent posts:\n${recentContent.slice(0, 3).map(c => `- ${c.slice(0, 60)}`).join('\n')}\n\n`
        : '';

      // Phase 7: inject winning content tone if available
      const toneHint = bestStrategy?.inputs.tone
        ? `\nUse this proven tone: ${bestStrategy.inputs.tone}`
        : '';

      const prompt = [
        `Write a Twitter/X post. Max 240 characters. Genuinely useful, not promotional.`,
        `Topic: ${topic}`,
        `Context: ${loop.goal}`,
        `Audience: ${loop.config.targetAudience ?? 'professionals'}`,
        toneHint,
        avoidClause,
        `Return ONLY the post text. No quotes. No hashtag spam. One natural hashtag max.`,
      ].join('\n');

      const raw = await providers[0].generateResponse(prompt);
      const text = raw.trim().replace(/^["'`]|["'`]$/g, '').slice(0, 240);
      return text || fallback;
    } catch {
      return fallback;
    }
  }

  // ── Compounding improvement ───────────────────────────────────────────────────

  private async _analyzeAndImprove(loopId: string): Promise<void> {
    const loop  = this._loopStore.get(loopId);
    if (!loop)  return;

    const leads      = this._leadStore.list(loopId);
    const contacted  = leads.filter(l => ['contacted', 'replied', 'converted'].includes(l.status)).length;
    const replied    = leads.filter(l => ['replied', 'converted'].includes(l.status)).length;

    if (contacted < 10) return;  // need data before advising

    const replyRate = contacted > 0 ? replied / contacted : 0;
    const pm        = this._getProvider();
    if (!pm) return;

    if (replyRate < 0.03) {
      try {
        const providers = await pm.getActiveProviders();
        if (!providers.length) return;

        const prompt = [
          `Outreach campaign analysis — low reply rate.`,
          `Goal: ${loop.goal}`,
          `Emails sent: ${contacted}`,
          `Reply rate: ${(replyRate * 100).toFixed(1)}% (target: 3%+)`,
          `Target audience: ${loop.config.targetAudience ?? 'not specified'}`,
          ``,
          `Give exactly 3 specific, actionable improvements. Max 180 words total.`,
          `Number them 1. 2. 3. Be concrete. No fluff.`,
        ].join('\n');

        const advice = await providers[0].generateResponse(prompt);
        this._loopStore.update(loopId, { improvementNotes: advice.slice(0, 600) });
        console.log(`[growthService] loop ${loopId}: improvement analysis saved`);
      } catch {
        // non-critical
      }
    }
  }

  // ── CRUD API ─────────────────────────────────────────────────────────────────

  createLoop(params: Omit<GrowthLoop, 'id' | 'createdAt' | 'updatedAt' | 'runCount'>): GrowthLoop {
    return this._loopStore.create(params);
  }

  listLoops(): GrowthLoop[] { return this._loopStore.list(); }

  getLoop(id: string): GrowthLoop | null { return this._loopStore.get(id); }

  pauseLoop(id: string): GrowthLoop | null {
    return this._loopStore.update(id, { status: 'paused' });
  }

  resumeLoop(id: string): GrowthLoop | null {
    return this._loopStore.update(id, { status: 'active' });
  }

  deleteLoop(id: string): boolean { return this._loopStore.delete(id); }

  // ── Lead API ──────────────────────────────────────────────────────────────────

  listLeads(loopId?: string, limit = 200): Lead[] {
    return this._leadStore.list(loopId).slice(0, limit);
  }

  addLead(params: Omit<Lead, 'id' | 'createdAt' | 'updatedAt'>): Lead {
    return this._leadStore.create(params);
  }

  updateLead(id: string, patch: Partial<Lead>): Lead | null {
    return this._leadStore.update(id, patch);
  }

  // ── Metrics ───────────────────────────────────────────────────────────────────

  getLoopMetrics(loopId: string): GrowthLoopMetrics {
    const loop     = this._loopStore.get(loopId);
    const leads    = this._leadStore.list(loopId);
    const content  = this._contentStore.list(loopId);

    const contacted  = leads.filter(l => ['contacted', 'replied', 'converted'].includes(l.status)).length;
    const replied    = leads.filter(l => ['replied', 'converted'].includes(l.status)).length;
    const converted  = leads.filter(l => l.status === 'converted').length;

    return {
      loopId,
      emailsSent:      contacted,
      postsPublished:  content.filter(c => c.status === 'published').length,
      leadsTotal:      leads.length,
      leadsReplied:    replied,
      leadsConverted:  converted,
      conversionRate:  contacted > 0 ? converted / contacted : null,
      replyRate:       contacted > 0 ? replied   / contacted : null,
      lastRunAt:       loop?.lastRunAt  ?? null,
      nextRunAt:       loop?.nextRunAt  ?? null,
    };
  }

  getGlobalGrowthMetrics(): {
    totalLeads: number;
    totalEmailsSent: number;
    totalPostsPublished: number;
    totalConverted: number;
    activeLoops: number;
  } {
    const allLeads   = this._leadStore.list();
    const allContent = this._contentStore.list();
    const activeLoops = this._loopStore.listActive();

    return {
      totalLeads:          allLeads.length,
      totalEmailsSent:     allLeads.filter(l => l.source === 'email').length,
      totalPostsPublished: allContent.filter(c => c.status === 'published').length,
      totalConverted:      allLeads.filter(l => l.status === 'converted').length,
      activeLoops:         activeLoops.length,
    };
  }
}

// ── Fallback templates ────────────────────────────────────────────────────────

function _emailFallback(loop: GrowthLoop, target: EmailTarget): { subject: string; body: string } {
  const audience = loop.config.targetAudience ?? 'your work';
  return {
    subject: `Quick question about ${audience}`,
    body: [
      `Hi ${target.name ?? 'there'},`,
      '',
      `I came across your profile and thought you'd find this relevant: ${loop.goal}`,
      '',
      target.interest ? `Given your interest in ${target.interest}, I think this could resonate with you.` : '',
      '',
      `Would love to hear your thoughts — does this align with what you're working on?`,
      '',
      'Best,',
      'The Triforge Team',
    ].filter(Boolean).join('\n'),
  };
}

function _postFallback(loop: GrowthLoop, topic: string): string {
  return `Working on ${loop.goal.slice(0, 80)}. One thing I've learned: ${topic} matters more than most people realize. What's your experience? #growth`;
}

function _sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
