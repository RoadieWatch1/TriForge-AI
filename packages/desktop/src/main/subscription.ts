import type { Tier } from './license';
import { LEMONSQUEEZY } from './license';

// ── Capability type ───────────────────────────────────────────────────────────

export type Capability =
  | 'MULTI_PROVIDER'       // use more than 1 AI simultaneously
  | 'THINK_TANK'           // 3-way consensus synthesis
  | 'VOICE'                // Whisper STT + TTS
  | 'EXECUTION_PLANS'      // generate + run execution plans
  | 'WORKFLOW_TEMPLATES'   // one-click business workflow packs
  | 'DECISION_LEDGER'      // auto-saved searchable Think Tank log
  | 'EXPORT_TOOLS'         // export ledger as MD / PDF
  | 'APP_ANALYSIS'         // App Builder Services Guide analysis
  | 'FINANCE_DASHBOARD'    // read-only finance view
  | 'BROWSER_AUTOMATION'   // browser control
  | 'EMAIL_CALENDAR'       // read/write email & calendar
  | 'FINANCE_TRADING'      // live investment order placement
  | 'WORKFLOW_REPLAY'      // replay past plans from Ledger
  | 'GOVERNANCE_PROFILES'  // custom permission profiles
  | 'FORGE_PROFILES'       // industry operational profiles (Restaurant, Trucking, Consultant)
  | 'AGENT_TASKS'          // autonomous task engine with trust policies + audit ledger
  | 'DISPATCH_COLLAB'      // shared threads + team collaboration in Dispatch
  | 'VENTURE_DISCOVERY'    // council venture discovery + build + growth pipeline
  | 'VIBE_CODING'          // council-guided aesthetic-to-implementation translation
  | 'UNLIMITED_MESSAGES'   // no monthly cap
  // ── Income Operator capabilities ─────────────────────────────────────────
  | 'INCOME_SCANNER'       // desktop capability scanner + tool gap detector
  | 'INCOME_LANES'         // income lane scoring + experiment creation
  | 'CONTENT_FACTORY'      // AI content generation pipeline (scripts, listings, posts)
  | 'INCOME_OPERATOR'      // autonomous experiment lifecycle + budget reallocation
  | 'REVENUE_TRACKER'      // real revenue recording + ROI reports + spend ledger
  | 'PLATFORM_PUBLISHING'; // YouTube / TikTok / Gumroad / Itch publishing adapters

// ── Per-tier capability sets ──────────────────────────────────────────────────

// Trading trial: free users get full trading capabilities for 30 days from first launch.
// After the trial window closes, trading features require Pro tier.
const TRADING_TRIAL_DAYS = 30;
const TRADING_TRIAL_START = new Date('2026-03-10T00:00:00Z').getTime(); // v1.17.0 release date
const TRADING_TRIAL_END   = TRADING_TRIAL_START + TRADING_TRIAL_DAYS * 24 * 60 * 60 * 1000;

const _tradingTrialActive = (): boolean => Date.now() < TRADING_TRIAL_END;

const FREE_CAPS_BASE: Capability[] = [];
const FREE_CAPS_TRIAL: Capability[] = ['FINANCE_DASHBOARD', 'FINANCE_TRADING'];

function _buildFreeCaps(): ReadonlySet<Capability> {
  return new Set<Capability>([
    ...FREE_CAPS_BASE,
    ...(_tradingTrialActive() ? FREE_CAPS_TRIAL : []),
  ]);
}

// Re-evaluated on each capability check via hasCapability()
let _freeCapsCache: ReadonlySet<Capability> | null = null;
let _freeCapsCacheTime = 0;
function _getFreeCaps(): ReadonlySet<Capability> {
  // Refresh cache every 60 seconds to pick up trial expiry
  if (!_freeCapsCache || Date.now() - _freeCapsCacheTime > 60_000) {
    _freeCapsCache = _buildFreeCaps();
    _freeCapsCacheTime = Date.now();
  }
  return _freeCapsCache;
}

// Static alias for non-trial code paths
const FREE_CAPS: ReadonlySet<Capability> = _buildFreeCaps();

const PRO_CAPS: ReadonlySet<Capability> = new Set<Capability>([
  'MULTI_PROVIDER',
  'THINK_TANK',
  'VOICE',
  'EXECUTION_PLANS',
  'WORKFLOW_TEMPLATES',
  'DECISION_LEDGER',
  'EXPORT_TOOLS',
  'APP_ANALYSIS',
  'FINANCE_DASHBOARD',
  'FINANCE_TRADING',
  'FORGE_PROFILES',
  'VENTURE_DISCOVERY',
  'VIBE_CODING',
  'INCOME_SCANNER',
  'INCOME_LANES',
  'CONTENT_FACTORY',
]);

const BUSINESS_CAPS: ReadonlySet<Capability> = new Set<Capability>([
  ...PRO_CAPS,
  'BROWSER_AUTOMATION',
  'EMAIL_CALENDAR',
  'FINANCE_TRADING',
  'WORKFLOW_REPLAY',
  'GOVERNANCE_PROFILES',
  'AGENT_TASKS',
  'DISPATCH_COLLAB',
  'UNLIMITED_MESSAGES',
  'INCOME_OPERATOR',
  'REVENUE_TRACKER',
  'PLATFORM_PUBLISHING',
]);

export const TIER_CAPABILITIES: Record<Tier, ReadonlySet<Capability>> = {
  free:     FREE_CAPS,
  pro:      PRO_CAPS,
  business: BUSINESS_CAPS,
};

// ── Capability helpers ────────────────────────────────────────────────────────

/** Returns true if the given tier has the given capability. */
export function hasCapability(cap: Capability, tier: Tier): boolean {
  // For free tier, use dynamic caps that include time-limited trials
  if (tier === 'free') return _getFreeCaps().has(cap);
  return TIER_CAPABILITIES[tier].has(cap);
}

/** Returns the minimum tier required to unlock a capability, or null if it is not offered. */
export function requiredTierFor(cap: Capability): Tier | null {
  if (TIER_CAPABILITIES.pro.has(cap)) return 'pro';
  if (TIER_CAPABILITIES.business.has(cap)) return 'business';
  return null;
}

/** Produces the structured error string sent to the renderer. */
export function lockedError(cap: Capability): string {
  const tier = requiredTierFor(cap) ?? 'pro';
  return `FEATURE_LOCKED:${cap}:${tier}`;
}

/** Human-readable labels for capabilities. */
export const CAPABILITY_LABELS: Record<Capability, string> = {
  MULTI_PROVIDER:      'Multiple AI providers',
  THINK_TANK:          'Think Tank (3-AI consensus)',
  VOICE:               'Voice input & speech output',
  EXECUTION_PLANS:     'Execution plan generation',
  WORKFLOW_TEMPLATES:  'One-click workflow templates',
  DECISION_LEDGER:     'Decision Ledger',
  EXPORT_TOOLS:        'Export to Markdown & PDF',
  APP_ANALYSIS:        'App Builder Services Guide',
  FINANCE_DASHBOARD:   'Finance dashboard',
  BROWSER_AUTOMATION:  'Browser automation',
  EMAIL_CALENDAR:      'Email & Calendar access',
  FINANCE_TRADING:     'Investment trading',
  WORKFLOW_REPLAY:     'Workflow replay from Ledger',
  GOVERNANCE_PROFILES: 'Governance profiles',
  FORGE_PROFILES:      'Forge Profiles (operational intelligence)',
  AGENT_TASKS:         'Autonomous Task Engine (trust policies + audit ledger)',
  DISPATCH_COLLAB:     'Shared Threads + Team Collaboration in Dispatch',
  VENTURE_DISCOVERY:    'Venture Discovery + Build + Growth',
  VIBE_CODING:          'Vibe Coding (aesthetic translation)',
  UNLIMITED_MESSAGES:   'Unlimited messages',
  INCOME_SCANNER:       'Desktop Capability Scanner + Tool Gap Detector',
  INCOME_LANES:         'Income Lane Scoring + Experiment Creation',
  CONTENT_FACTORY:      'AI Content Factory (scripts, listings, posts, sequences)',
  INCOME_OPERATOR:      'Autonomous Income Operator (experiment lifecycle + reallocation)',
  REVENUE_TRACKER:      'Revenue Tracker + Spend Ledger + ROI Reports',
  PLATFORM_PUBLISHING:  'Platform Publishing (YouTube, TikTok, Gumroad, Itch)',
};

// ── Tier metadata (display / quota only — no boolean feature flags) ───────────

export interface TierConfig {
  name: string;
  price: string;
  annualPrice: string;
  tagline: string;
  maxMessagesPerMonth: number;  // Infinity = unlimited
  memoryLimit: number;          // max long-term memory entries
  providers: number;            // max concurrent AI providers
  checkoutUrl: string;
}

export const TIERS: Record<Tier, TierConfig> = {
  free: {
    name: 'Free',
    price: '$0',
    annualPrice: '$0',
    tagline: "Explore what's possible",
    maxMessagesPerMonth: 30,
    memoryLimit: 10,
    providers: 1,
    checkoutUrl: LEMONSQUEEZY.PRO_CHECKOUT,
  },
  pro: {
    name: 'Pro',
    price: '$19',
    annualPrice: '$15',
    tagline: 'Your personal think tank',
    maxMessagesPerMonth: 300,
    memoryLimit: 50,
    providers: 3,
    checkoutUrl: LEMONSQUEEZY.PRO_CHECKOUT,
  },
  business: {
    name: 'Business',
    price: '$49',
    annualPrice: '$40',
    tagline: 'Governance-first AI for serious work',
    maxMessagesPerMonth: Infinity,
    memoryLimit: 200,
    providers: 3,
    checkoutUrl: LEMONSQUEEZY.BIZ_CHECKOUT,
  },
};

// ── Quota helpers ─────────────────────────────────────────────────────────────

/** Returns the memory entry limit for a given tier. */
export function getMemoryLimit(tier: Tier): number {
  return TIERS[tier].memoryLimit;
}

/** Check if user has hit their monthly message limit. */
export function isAtMessageLimit(used: number, tier: Tier): boolean {
  const limit = TIERS[tier].maxMessagesPerMonth;
  return limit !== Infinity && used >= limit;
}

/** Returns remaining messages for display ("30 / 30" or "∞"). */
export function messageQuota(used: number, tier: Tier): string {
  const limit = TIERS[tier].maxMessagesPerMonth;
  if (limit === Infinity) return '∞';
  return `${Math.max(0, limit - used)} remaining`;
}

/** Trading trial status for UI display. */
export function tradingTrialStatus(): { active: boolean; daysRemaining: number; endsAt: string } {
  const remaining = Math.max(0, Math.ceil((TRADING_TRIAL_END - Date.now()) / (24 * 60 * 60 * 1000)));
  return {
    active: _tradingTrialActive(),
    daysRemaining: remaining,
    endsAt: new Date(TRADING_TRIAL_END).toISOString(),
  };
}
