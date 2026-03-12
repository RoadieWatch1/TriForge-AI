/**
 * valueEngine.ts — Value Engine loop (Phase 5)
 *
 * Subscribes to eventBus and translates engine events into MetricsEvents.
 * No events are fabricated — only real tool results produce metrics.
 * Works with partial integrations: if email adapter isn't wired, no events fire.
 */

import { eventBus } from '../core/eventBus';
import type { EngineEvent } from '../core/taskTypes';
import { MetricsStore } from './metricsStore';
import { CampaignStore } from './campaignStore';
import { computeCampaignMetrics, aggregateMetrics } from './roi';
import { generateOptimization } from './optimization';
import type { CampaignMetrics, OptimizationResult, Campaign } from './valueTypes';

export class ValueEngine {
  private _metrics: MetricsStore;
  private _campaigns: CampaignStore;
  private _unsubscribe: (() => void) | null = null;
  private _running = false;

  constructor(metricsStore: MetricsStore, campaignStore: CampaignStore) {
    this._metrics = metricsStore;
    this._campaigns = campaignStore;
  }

  /** Start listening to engine events and translating to MetricsEvents */
  start(): void {
    if (this._running) return;
    this._running = true;

    this._unsubscribe = eventBus.onAny((ev: EngineEvent) => {
      this._handleEvent(ev);
    });

    console.log('[valueEngine] started — listening for real execution events');
  }

  stop(): void {
    if (this._unsubscribe) {
      this._unsubscribe();
      this._unsubscribe = null;
    }
    this._running = false;
  }

  // ── Event translation ────────────────────────────────────────────────────────

  private _handleEvent(ev: EngineEvent): void {
    try {
      switch (ev.type) {
        case 'EMAIL_SENT': {
          const campaignId = this._findCampaignId(ev.taskId) ?? undefined;
          this._metrics.record('EMAIL_SENT', ev.taskId, {
            campaignId,
            to: ev.to,
            subject: undefined,
            paperMode: ev.paperMode,
          });
          break;
        }

        case 'TWEET_POSTED': {
          const campaignId = this._findCampaignId(ev.taskId) ?? undefined;
          this._metrics.record('POST_PUBLISHED', ev.taskId, {
            campaignId,
            platform: 'twitter',
            paperMode: ev.paperMode,
          });
          break;
        }

        case 'OUTREACH_COMPLETED': {
          // outreach emits individual EMAIL_SENT events per target — this is summary only
          // We don't double-count; this is just for diagnostics if needed
          break;
        }

        case 'WALLET_UPDATED': {
          // Wallet updates don't directly map to campaign spend unless we have more context.
          // Spend is recorded explicitly via value:recordSpend IPC.
          break;
        }

        default:
          break;
      }
    } catch (e) {
      console.error('[valueEngine] event handler error:', e);
    }
  }

  private _findCampaignId(taskId: string): string | null {
    const c = this._campaigns.findByTask(taskId);
    return c?.id ?? null;
  }

  // ── Query API ────────────────────────────────────────────────────────────────

  /** Compute metrics for a specific campaign */
  getCampaignMetrics(campaignId: string): CampaignMetrics {
    const campaign = this._campaigns.get(campaignId);
    const events = this._metrics.query({ campaignId });

    // Also include events tagged only by taskId from linked tasks
    if (campaign && campaign.taskIds.length > 0) {
      const taskEvents = this._metrics.queryByTaskIds(campaign.taskIds)
        .filter(e => !e.campaignId); // avoid double-counting tagged events
      return computeCampaignMetrics(campaignId, [...events, ...taskEvents]);
    }

    return computeCampaignMetrics(campaignId, events);
  }

  /** Get metrics for all active campaigns */
  getAllMetrics(): CampaignMetrics[] {
    const campaigns = this._campaigns.list();
    return campaigns.map(c => this.getCampaignMetrics(c.id));
  }

  /** Get aggregated metrics across all campaigns */
  getGlobalMetrics(): CampaignMetrics {
    return aggregateMetrics(this.getAllMetrics());
  }

  /** Generate optimization suggestions for a campaign */
  getOptimization(campaignId: string): OptimizationResult | null {
    const campaign = this._campaigns.get(campaignId);
    if (!campaign) return null;
    const metrics = this.getCampaignMetrics(campaignId);
    return generateOptimization(campaign, metrics);
  }

  /** List all campaigns */
  listCampaigns(): Campaign[] {
    return this._campaigns.list();
  }

  /** Create a campaign */
  createCampaign(name: string, type: import('./valueTypes').CampaignType, description?: string): Campaign {
    return this._campaigns.create(name, type, description);
  }

  /** Link a task to a campaign */
  linkTask(campaignId: string, taskId: string): boolean {
    return this._campaigns.linkTask(campaignId, taskId);
  }

  /** Record value manually (conversion, revenue, etc.) */
  recordValue(taskId: string, amountCents: number, note?: string, campaignId?: string): void {
    this._metrics.record('VALUE_RECORDED', taskId, { campaignId, amountCents, note });
  }

  /** Record spend committed by a task */
  recordSpend(taskId: string, amountCents: number, category: string, campaignId?: string): void {
    this._metrics.record('SPEND_COMMITTED', taskId, { campaignId, amountCents, category });
  }

  /** Record a reply received (for reply-rate tracking) */
  recordReply(
    taskId: string,
    from: string,
    sentiment: 'positive' | 'neutral' | 'negative',
    campaignId?: string,
  ): void {
    this._metrics.record('REPLY_RECEIVED', taskId, { campaignId, from, sentiment });
  }
}
