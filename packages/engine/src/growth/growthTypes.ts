/**
 * growthTypes.ts — Growth Engine data model (Phase 6)
 *
 * GrowthLoops are continuous automated sequences (outreach, content, or both)
 * that run daily, build leads, and compound over time.
 */

// ── Growth Loop ────────────────────────────────────────────────────────────────

export type GrowthLoopType   = 'outreach' | 'content' | 'hybrid';
export type GrowthLoopStatus = 'active' | 'paused';

export interface EmailTarget {
  email: string;
  name?: string;
  interest?: string;
}

export interface GrowthLoop {
  id: string;
  type: GrowthLoopType;
  goal: string;                   // "Get beta users for my app"
  status: GrowthLoopStatus;
  campaignId?: string;            // links to Value Engine campaign
  config: {
    dailyEmailLimit?: number;     // default 10, hard max 50
    dailyPostLimit?: number;      // default 1, hard max 5
    targetAudience?: string;      // "founders building B2B SaaS"
    keywords?: string[];          // content topics
    emailList?: EmailTarget[];    // outreach targets
  };
  createdAt: number;
  updatedAt: number;
  lastRunAt?: number;
  nextRunAt?: number;
  runCount: number;
  improvementNotes?: string;      // AI-generated advice from compounding loop
  version?: number;               // Phase 7: incremented by scaler when limits are adjusted
  scalingAction?: string;         // Phase 7: last scaler decision ('scale_up' | 'scale_down' | 'hold')
}

// ── Lead ──────────────────────────────────────────────────────────────────────

export type LeadSource = 'email' | 'social' | 'manual';
export type LeadStatus = 'new' | 'contacted' | 'replied' | 'converted';

export interface Lead {
  id: string;
  source: LeadSource;
  contact: string;                // email address or social handle
  name?: string;
  status: LeadStatus;
  notes?: string;
  loopId?: string;
  campaignId?: string;
  createdAt: number;
  updatedAt: number;
}

// ── Published Content ──────────────────────────────────────────────────────────

export type ContentType   = 'tweet' | 'post';
export type ContentStatus = 'draft' | 'published' | 'failed';

export interface ContentItem {
  id: string;
  loopId: string;
  campaignId?: string;
  type: ContentType;
  content: string;
  status: ContentStatus;
  platform?: string;
  paperMode?: boolean;
  createdAt: number;
  publishedAt?: number;
}

// ── Loop Metrics (computed) ────────────────────────────────────────────────────

export interface GrowthLoopMetrics {
  loopId: string;
  emailsSent: number;
  postsPublished: number;
  leadsTotal: number;
  leadsReplied: number;
  leadsConverted: number;
  conversionRate: number | null;
  replyRate: number | null;
  lastRunAt: number | null;
  nextRunAt: number | null;
}
