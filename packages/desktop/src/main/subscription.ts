import type { Tier } from './license';
import { LEMONSQUEEZY } from './license';

// ── Tier definitions ─────────────────────────────────────────────────────────

export interface TierConfig {
  name: string;
  price: string;
  annualPrice: string;
  tagline: string;
  // Usage limits
  maxMessagesPerMonth: number;       // Infinity = unlimited
  memoryLimit: number;               // max long-term memory entries
  providers: number;                 // max concurrent AI providers
  // Core AI features
  voice: boolean;                    // Whisper STT + TTS
  consensusMode: boolean;            // Think Tank (3-way debate + synthesis)
  longTermMemory: boolean;
  // Execution & automation
  executionPlans: boolean;           // Generate Execution Plans from synthesis
  workflowTemplates: boolean;        // One-click business workflow packs
  workflowReplay: boolean;           // Replay past plans from Ledger (Business)
  // Data & export
  ledger: boolean;                   // Decision Ledger + search
  exportTools: boolean;              // Export ledger as MD / PDF
  appBuilderAnalysis: boolean;       // App Builder "Services Guide" analysis
  // Advanced permissions
  browserAutomation: boolean;
  emailCalendar: boolean;
  financeView: boolean;
  financeTrading: boolean;
  governanceProfiles: boolean;       // Advanced permission profiles (Business)
  checkoutUrl: string;
}

export const TIERS: Record<Tier, TierConfig> = {
  free: {
    name: 'Free',
    price: '$0',
    annualPrice: '$0',
    tagline: 'Explore what\'s possible',
    maxMessagesPerMonth: 30,
    memoryLimit: 10,
    providers: 1,
    voice: false,
    consensusMode: false,
    longTermMemory: true,           // basic — up to memoryLimit entries
    executionPlans: false,
    workflowTemplates: false,
    workflowReplay: false,
    ledger: false,
    exportTools: false,
    appBuilderAnalysis: false,
    browserAutomation: false,
    emailCalendar: false,
    financeView: false,
    financeTrading: false,
    governanceProfiles: false,
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
    voice: true,
    consensusMode: true,
    longTermMemory: true,
    executionPlans: true,
    workflowTemplates: true,
    workflowReplay: false,
    ledger: true,
    exportTools: true,
    appBuilderAnalysis: true,
    browserAutomation: false,
    emailCalendar: false,
    financeView: true,
    financeTrading: false,
    governanceProfiles: false,
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
    voice: true,
    consensusMode: true,
    longTermMemory: true,
    executionPlans: true,
    workflowTemplates: true,
    workflowReplay: true,
    ledger: true,
    exportTools: true,
    appBuilderAnalysis: true,
    browserAutomation: true,
    emailCalendar: true,
    financeView: true,
    financeTrading: true,
    governanceProfiles: true,
    checkoutUrl: LEMONSQUEEZY.BIZ_CHECKOUT,
  },
};

// ── Feature keys ─────────────────────────────────────────────────────────────

export type Feature =
  | 'voice'
  | 'consensus'
  | 'memory'
  | 'executionPlans'
  | 'workflowTemplates'
  | 'workflowReplay'
  | 'ledger'
  | 'exportTools'
  | 'appBuilderAnalysis'
  | 'browser'
  | 'email'
  | 'financeView'
  | 'financeTrading'
  | 'governanceProfiles'
  | 'unlimitedMessages';

/** Returns true if the given tier can use the given feature. */
export function canUse(feature: Feature, tier: Tier): boolean {
  const t = TIERS[tier];
  switch (feature) {
    case 'voice':               return t.voice;
    case 'consensus':           return t.consensusMode;
    case 'memory':              return t.longTermMemory;
    case 'executionPlans':      return t.executionPlans;
    case 'workflowTemplates':   return t.workflowTemplates;
    case 'workflowReplay':      return t.workflowReplay;
    case 'ledger':              return t.ledger;
    case 'exportTools':         return t.exportTools;
    case 'appBuilderAnalysis':  return t.appBuilderAnalysis;
    case 'browser':             return t.browserAutomation;
    case 'email':               return t.emailCalendar;
    case 'financeView':         return t.financeView;
    case 'financeTrading':      return t.financeTrading;
    case 'governanceProfiles':  return t.governanceProfiles;
    case 'unlimitedMessages':   return t.maxMessagesPerMonth === Infinity;
    default:                    return false;
  }
}

/** Returns the upgrade tier needed for a blocked feature, or null if already unlocked. */
export function upgradeNeeded(feature: Feature, currentTier: Tier): Tier | null {
  if (canUse(feature, currentTier)) return null;
  if (canUse(feature, 'pro')) return 'pro';
  if (canUse(feature, 'business')) return 'business';
  return null;
}

/** Human-readable label for a feature. */
export const FEATURE_LABELS: Record<Feature, string> = {
  voice:              'Voice input & speech output',
  consensus:          'Think Tank (3-AI consensus)',
  memory:             'Long-term memory',
  executionPlans:     'Execution plan generation',
  workflowTemplates:  'One-click workflow templates',
  workflowReplay:     'Workflow replay from Ledger',
  ledger:             'Decision Ledger',
  exportTools:        'Export to Markdown & PDF',
  appBuilderAnalysis: 'App Builder Services Guide',
  browser:            'Browser automation',
  email:              'Email & Calendar access',
  financeView:        'Finance dashboard',
  financeTrading:     'Investment trading',
  governanceProfiles: 'Governance profiles',
  unlimitedMessages:  'Unlimited messages',
};

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
