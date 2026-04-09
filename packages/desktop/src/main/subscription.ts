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

// ── Capability sets ───────────────────────────────────────────────────────────

// Free tier — curated taste of the product, NOT an empty wall.
//
// The original FREE_CAPS was an empty set, which meant a brand-new user hit
// FEATURE_LOCKED errors the moment they touched anything past plain chat. They
// never saw the operator, the templates, or the decision ledger — the actual
// differentiators of the product. This list lets a free user feel the operator
// (one workflow run per day, see the FREE_DAILY_OPERATOR_RUNS quota below)
// and see the surrounding surfaces (plans, ledger, exports, scanner, replay)
// while keeping the heavy paid surfaces (autonomous agent, browser, email,
// finance trading, ventures, income operator) gated.
const FREE_CAPS: ReadonlySet<Capability> = new Set<Capability>([
  'WORKFLOW_TEMPLATES',  // operator pack templates — quota-limited via FREE_DAILY_OPERATOR_RUNS
  'EXECUTION_PLANS',     // generate plans (no autonomous execution — that's AGENT_TASKS)
  'DECISION_LEDGER',     // see the council's decision history
  'EXPORT_TOOLS',        // export plans/ledger as MD/PDF
  'APP_ANALYSIS',        // App Builder Services Guide
  'INCOME_SCANNER',      // local capability scan — already runs on the user's machine, free is fine
  'WORKFLOW_REPLAY',     // replay past plans from the ledger
]);

/**
 * Daily operator workflow runs allowed for the free tier.
 * Counted in store.operatorRunsDaily, gated at the workflow:run:start IPC.
 * Pro/business have no daily cap.
 */
export const FREE_DAILY_OPERATOR_RUNS = 1;

// Paid subscribers get access to everything — no feature tiers
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
  'BROWSER_AUTOMATION',
  'EMAIL_CALENDAR',
  'WORKFLOW_REPLAY',
  'GOVERNANCE_PROFILES',
  'FORGE_PROFILES',
  'AGENT_TASKS',
  'DISPATCH_COLLAB',
  'VENTURE_DISCOVERY',
  'VIBE_CODING',
  'UNLIMITED_MESSAGES',
  'INCOME_SCANNER',
  'INCOME_LANES',
  'CONTENT_FACTORY',
  'INCOME_OPERATOR',
  'REVENUE_TRACKER',
  'PLATFORM_PUBLISHING',
]);

export const TIER_CAPABILITIES: Record<Tier, ReadonlySet<Capability>> = {
  free:     FREE_CAPS,
  pro:      PRO_CAPS,
  business: PRO_CAPS,  // business is a superset of pro
};

// ── Capability helpers ────────────────────────────────────────────────────────

/** Returns true if the given tier has the given capability. */
export function hasCapability(cap: Capability, tier: Tier): boolean {
  return TIER_CAPABILITIES[tier].has(cap);
}

/** Returns the minimum tier required to unlock a capability. */
export function requiredTierFor(_cap: Capability): Tier {
  return 'pro';
}

/** Produces the structured error string sent to the renderer. */
export function lockedError(cap: Capability): string {
  return `FEATURE_LOCKED:${cap}:pro`;
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

// ── Tier metadata ─────────────────────────────────────────────────────────────

export interface TierConfig {
  name: string;
  price: string;
  annualPrice: string;
  tagline: string;
  maxMessagesPerMonth: number;  // Infinity = unlimited
  memoryLimit: number;
  providers: number;
  checkoutUrl: string;
  annualCheckoutUrl: string;
}

export const TIERS: Record<Tier, TierConfig> = {
  free: {
    name:                'Free',
    price:               '$0',
    annualPrice:         '$0',
    tagline:             "Explore what's possible",
    maxMessagesPerMonth: 30,
    memoryLimit:         10,
    providers:           1,
    checkoutUrl:         LEMONSQUEEZY.PRO_CHECKOUT,
    annualCheckoutUrl:   LEMONSQUEEZY.PRO_ANNUAL_CHECKOUT,
  },
  pro: {
    name:                'Pro',
    price:               '$19',
    annualPrice:         '$15',
    tagline:             'Full access. Everything included.',
    maxMessagesPerMonth: Infinity,
    memoryLimit:         500,
    providers:           3,
    checkoutUrl:         LEMONSQUEEZY.PRO_CHECKOUT,
    annualCheckoutUrl:   LEMONSQUEEZY.PRO_ANNUAL_CHECKOUT,
  },
  business: {
    name:                'Business',
    price:               '$49',
    annualPrice:         '$39',
    tagline:             'Team access with workspace features.',
    maxMessagesPerMonth: Infinity,
    memoryLimit:         1000,
    providers:           3,
    checkoutUrl:         LEMONSQUEEZY.PRO_CHECKOUT,
    annualCheckoutUrl:   LEMONSQUEEZY.PRO_ANNUAL_CHECKOUT,
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

/**
 * Returns true if the given tier has hit its daily operator-run quota.
 * Only free tier has a daily cap; pro/business return false unconditionally.
 */
export function isAtDailyOperatorLimit(used: number, tier: Tier): boolean {
  if (tier !== 'free') return false;
  return used >= FREE_DAILY_OPERATOR_RUNS;
}

/** Returns remaining messages for display ("30 / 30" or "∞"). */
export function messageQuota(used: number, tier: Tier): string {
  const limit = TIERS[tier].maxMessagesPerMonth;
  if (limit === Infinity) return '∞';
  return `${Math.max(0, limit - used)} remaining`;
}

/** @deprecated — no trading trial; kept for call-site compatibility */
export function tradingTrialStatus(): { active: boolean; daysRemaining: number; endsAt: string } {
  return { active: false, daysRemaining: 0, endsAt: new Date(0).toISOString() };
}
