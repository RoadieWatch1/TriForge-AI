import type { Tier } from './license';
import { LEMONSQUEEZY } from './license';

// ── Tier definitions ─────────────────────────────────────────────────────────

export interface TierConfig {
  name: string;
  price: string;
  annualPrice: string;
  tagline: string;
  maxMessagesPerMonth: number;       // Infinity = unlimited
  providers: number;                 // max concurrent AI providers
  voice: boolean;                    // Whisper STT + TTS
  consensusMode: boolean;            // 3-way debate
  longTermMemory: boolean;
  browserAutomation: boolean;
  emailCalendar: boolean;
  financeView: boolean;
  financeTrading: boolean;
  checkoutUrl: string;
}

export const TIERS: Record<Tier, TierConfig> = {
  free: {
    name: 'Free',
    price: '$0',
    annualPrice: '$0',
    tagline: 'Try TriForge AI',
    maxMessagesPerMonth: 30,
    providers: 1,
    voice: false,
    consensusMode: false,
    longTermMemory: false,
    browserAutomation: false,
    emailCalendar: false,
    financeView: false,
    financeTrading: false,
    checkoutUrl: LEMONSQUEEZY.PRO_CHECKOUT,
  },
  pro: {
    name: 'Pro',
    price: '$19',
    annualPrice: '$15',
    tagline: 'Your personal think tank',
    maxMessagesPerMonth: Infinity,
    providers: 3,
    voice: true,
    consensusMode: true,
    longTermMemory: true,
    browserAutomation: false,
    emailCalendar: false,
    financeView: true,
    financeTrading: false,
    checkoutUrl: LEMONSQUEEZY.PRO_CHECKOUT,
  },
  business: {
    name: 'Business',
    price: '$49',
    annualPrice: '$39',
    tagline: 'Full autonomous agent',
    maxMessagesPerMonth: Infinity,
    providers: 3,
    voice: true,
    consensusMode: true,
    longTermMemory: true,
    browserAutomation: true,
    emailCalendar: true,
    financeView: true,
    financeTrading: true,
    checkoutUrl: LEMONSQUEEZY.BIZ_CHECKOUT,
  },
};

// ── Feature keys ─────────────────────────────────────────────────────────────

export type Feature =
  | 'voice'
  | 'consensus'
  | 'memory'
  | 'browser'
  | 'email'
  | 'financeView'
  | 'financeTrading'
  | 'unlimitedMessages';

/** Returns true if the given tier can use the given feature. */
export function canUse(feature: Feature, tier: Tier): boolean {
  const t = TIERS[tier];
  switch (feature) {
    case 'voice':             return t.voice;
    case 'consensus':         return t.consensusMode;
    case 'memory':            return t.longTermMemory;
    case 'browser':           return t.browserAutomation;
    case 'email':             return t.emailCalendar;
    case 'financeView':       return t.financeView;
    case 'financeTrading':    return t.financeTrading;
    case 'unlimitedMessages': return t.maxMessagesPerMonth === Infinity;
    default:                  return false;
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
  voice:             'Voice input & speech output',
  consensus:         'Full 3-model consensus mode',
  memory:            'Long-term memory',
  browser:           'Browser automation',
  email:             'Email & Calendar',
  financeView:       'Finance dashboard',
  financeTrading:    'Investment trading',
  unlimitedMessages: 'Unlimited messages',
};

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
