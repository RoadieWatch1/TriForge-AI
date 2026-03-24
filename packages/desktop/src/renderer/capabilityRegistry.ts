/**
 * capabilityRegistry.ts — Phase 41
 *
 * Renderer-side capability registry and gate resolver.
 *
 * Main process sends `FEATURE_LOCKED:{CAP}:{tier}` error strings.
 * This module provides a single parser + label lookup so every surface
 * in the renderer handles locks consistently.
 */

// ── Capability labels (mirror of subscription.ts CAPABILITY_LABELS) ───────────

export const CAPABILITY_LABELS: Record<string, string> = {
  MULTI_PROVIDER:      'Multiple AI providers',
  THINK_TANK:          'Think Tank — 3-AI consensus',
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
  FORGE_PROFILES:      'Forge Profiles',
  AGENT_TASKS:         'Autonomous Task Engine',
  DISPATCH_COLLAB:     'Shared Threads & Team Collaboration',
  VENTURE_DISCOVERY:   'Venture Discovery',
  VIBE_CODING:         'Vibe Coding',
  UNLIMITED_MESSAGES:  'Unlimited messages',
  // Synthetic codes
  MESSAGE_LIMIT_REACHED: 'Unlimited messages',
};

// ── Upgrade descriptions per capability ───────────────────────────────────────

export const CAPABILITY_DESCRIPTIONS: Record<string, string> = {
  MULTI_PROVIDER:      'Run multiple AI models simultaneously for richer answers.',
  THINK_TANK:          'Consult OpenAI, Claude, and Grok together and synthesize their reasoning.',
  VOICE:               'Speak to TriForge and hear responses aloud via Whisper + TTS.',
  EXECUTION_PLANS:     'Generate step-by-step execution plans and run commands directly.',
  WORKFLOW_TEMPLATES:  'Launch proven business workflows in one click.',
  DECISION_LEDGER:     'Auto-save every council decision to a searchable, starred ledger.',
  EXPORT_TOOLS:        'Export ledger entries as Markdown or PDF.',
  APP_ANALYSIS:        'Get an AI-powered services guide for any app idea.',
  FINANCE_DASHBOARD:   'View your portfolio and account balances inside TriForge.',
  BROWSER_AUTOMATION:  'Let TriForge control web browsers on your behalf.',
  EMAIL_CALENDAR:      'Read and create emails and calendar events.',
  FINANCE_TRADING:     'Place investment orders through connected brokers.',
  WORKFLOW_REPLAY:     'Replay any past execution plan from your Ledger.',
  GOVERNANCE_PROFILES: 'Create custom permission profiles for different contexts.',
  FORGE_PROFILES:      'Activate industry-specific AI personas (Restaurant, Trucking, Consultant).',
  AGENT_TASKS:         'Run fully autonomous multi-step tasks with approval flows and audit trails.',
  DISPATCH_COLLAB:     'Share threads, delegate tasks, and collaborate with teammates via Dispatch.',
  VENTURE_DISCOVERY:   'AI-guided venture ideation, validation, and growth pipeline.',
  VIBE_CODING:         'Translate aesthetic intentions into code with council guidance.',
  UNLIMITED_MESSAGES:  'Remove the monthly message cap entirely.',
  MESSAGE_LIMIT_REACHED: 'Remove the monthly message cap entirely.',
};

// ── Plan feature bullets ──────────────────────────────────────────────────────

export const PRO_FEATURE_BULLETS = [
  '300 messages per month',
  'Think Tank — 3-AI consensus synthesis',
  'Voice I/O (Whisper STT + TTS)',
  'Execution plan generation & runner',
  'One-click workflow templates',
  'Decision Ledger + Markdown/PDF export',
  'Forge Profiles (operational intelligence)',
  'Venture Discovery & Vibe Coding',
  'Long-term memory — 50 entries',
  'App Builder Services Guide',
];

export const BUSINESS_FEATURE_BULLETS = [
  'Unlimited messages',
  'Everything in Pro',
  'Autonomous Task Engine (trust policies + audit)',
  'Shared Threads & Team Collaboration in Dispatch',
  'Browser automation',
  'Email & Calendar access',
  'Investment trading via brokers',
  'Workflow replay from Ledger',
  'Governance profiles',
  'Memory up to 200 entries',
];

// ── Gate resolver ─────────────────────────────────────────────────────────────

export interface GateInfo {
  feature:    string;
  label:      string;
  description: string;
  neededTier: 'pro' | 'business';
}

/**
 * Parse a `FEATURE_LOCKED:{cap}:{tier}` or `MESSAGE_LIMIT_REACHED` error string.
 * Returns null if the string is not a gate error.
 */
export function parseLockedError(error: string): GateInfo | null {
  if (!error) return null;

  if (error === 'MESSAGE_LIMIT_REACHED') {
    return {
      feature:    'MESSAGE_LIMIT_REACHED',
      label:      CAPABILITY_LABELS['MESSAGE_LIMIT_REACHED'],
      description: CAPABILITY_DESCRIPTIONS['MESSAGE_LIMIT_REACHED'],
      neededTier: 'pro',
    };
  }

  if (!error.startsWith('FEATURE_LOCKED:')) return null;

  const parts      = error.split(':');
  const feature    = parts[1] ?? 'unknown';
  const neededTier = (parts[2] === 'business' ? 'business' : 'pro') as 'pro' | 'business';

  return {
    feature,
    label:       CAPABILITY_LABELS[feature] ?? feature,
    description: CAPABILITY_DESCRIPTIONS[feature] ?? '',
    neededTier,
  };
}

/**
 * Returns true if the error string is any kind of gate/lock error.
 */
export function isGateError(error: string | undefined | null): boolean {
  if (!error) return false;
  return error === 'MESSAGE_LIMIT_REACHED' || error.startsWith('FEATURE_LOCKED:');
}

// ── Tier display helpers ──────────────────────────────────────────────────────

export const TIER_NAMES: Record<string, string> = {
  free:     'Free',
  pro:      'Pro',
  business: 'Business',
};

export const TIER_PRICES: Record<string, string> = {
  free:     '$0',
  pro:      '$19/mo',
  business: '$49/mo',
};

export const TIER_TAGLINES: Record<string, string> = {
  free:     "Explore what's possible",
  pro:      'Your personal think tank',
  business: 'Governance-first AI for serious work',
};
