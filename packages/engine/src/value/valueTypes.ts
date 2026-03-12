/**
 * valueTypes.ts — Value Engine data model (Phase 5)
 *
 * Campaigns group tasks into measurable initiatives. MetricsEvents record
 * real outcomes (never fabricated). CampaignMetrics are computed from events.
 * OptimizationResult drives heuristic suggestions.
 */

// ── Campaign ───────────────────────────────────────────────────────────────────

export type CampaignType = 'outreach' | 'content' | 'research' | 'sales';
export type CampaignStatus = 'active' | 'paused' | 'completed';

export interface Campaign {
  id: string;
  name: string;
  type: CampaignType;
  status: CampaignStatus;
  createdAt: number;
  updatedAt: number;
  taskIds: string[];
  description?: string;
  goalMetrics?: {
    targetEmailsSent?: number;
    targetReplies?: number;
    targetLeads?: number;
    targetValueCents?: number;
  };
}

// ── Metrics Events — discriminated union ───────────────────────────────────────

export type MetricsEventType =
  | 'EMAIL_DRAFTED'
  | 'EMAIL_SENT'
  | 'EMAIL_FAILED'
  | 'REPLY_RECEIVED'
  | 'POST_PUBLISHED'
  | 'SPEND_COMMITTED'
  | 'VALUE_RECORDED';

export type MetricsEvent =
  | { type: 'EMAIL_DRAFTED';    id: string; campaignId?: string; taskId: string; timestamp: number; subject?: string }
  | { type: 'EMAIL_SENT';       id: string; campaignId?: string; taskId: string; timestamp: number; to: string[]; subject?: string; paperMode: boolean }
  | { type: 'EMAIL_FAILED';     id: string; campaignId?: string; taskId: string; timestamp: number; to: string[]; error?: string }
  | { type: 'REPLY_RECEIVED';   id: string; campaignId?: string; taskId: string; timestamp: number; from: string; sentiment?: 'positive' | 'neutral' | 'negative' }
  | { type: 'POST_PUBLISHED';   id: string; campaignId?: string; taskId: string; timestamp: number; platform: string; paperMode: boolean }
  | { type: 'SPEND_COMMITTED';  id: string; campaignId?: string; taskId: string; timestamp: number; amountCents: number; category: string }
  | { type: 'VALUE_RECORDED';   id: string; campaignId?: string; taskId: string; timestamp: number; amountCents: number; note?: string };

// ── Campaign Metrics (computed, never stored directly) ─────────────────────────

export interface CampaignMetrics {
  campaignId: string;
  emailsSent: number;
  emailsFailed: number;
  repliesReceived: number;
  postsPublished: number;
  leadsGenerated: number;          // inferred from positive replies
  spendCents: number;
  valueRecordedCents: number;
  roi: number | null;              // null when no spend recorded
  replyRate: number | null;        // null when no emails sent
  successRate: number | null;      // null when no emails attempted
  lastUpdatedAt: number;
}

// ── Optimization ───────────────────────────────────────────────────────────────

export type OptimizationPriority = 'low' | 'medium' | 'high';

export interface OptimizationResult {
  campaignId: string;
  suggestedActions: string[];
  priority: OptimizationPriority;
  reasoning: string;
  generatedAt: number;
}
