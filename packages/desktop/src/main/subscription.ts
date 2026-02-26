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
  | 'UNLIMITED_MESSAGES';  // no monthly cap

// ── Per-tier capability sets ──────────────────────────────────────────────────

const FREE_CAPS: ReadonlySet<Capability> = new Set<Capability>([]);

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
]);

const BUSINESS_CAPS: ReadonlySet<Capability> = new Set<Capability>([
  ...PRO_CAPS,
  'BROWSER_AUTOMATION',
  'EMAIL_CALENDAR',
  'FINANCE_TRADING',
  'WORKFLOW_REPLAY',
  'GOVERNANCE_PROFILES',
  'UNLIMITED_MESSAGES',
]);

export const TIER_CAPABILITIES: Record<Tier, ReadonlySet<Capability>> = {
  free:     FREE_CAPS,
  pro:      PRO_CAPS,
  business: BUSINESS_CAPS,
};

// ── Capability helpers ────────────────────────────────────────────────────────

/** Returns true if the given tier has the given capability. */
export function hasCapability(cap: Capability, tier: Tier): boolean {
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
  UNLIMITED_MESSAGES:  'Unlimited messages',
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
    annualPrice: '$39',
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
