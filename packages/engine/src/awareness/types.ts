// ── awareness/types.ts — Council Awareness Layer data contracts ───────────────
//
// Shared type definitions used by CapabilityRegistry, SystemStateService,
// and CouncilAwarenessService.

export type CapabilityRisk = 'safe' | 'moderate' | 'high' | 'restricted';

export type CapabilityCategory =
  | 'provider'
  | 'council'
  | 'image'
  | 'voice'
  | 'mission'
  | 'autonomy'
  | 'files'
  | 'phone'
  | 'memory'
  | 'forge'
  | 'tasks'
  | 'social'
  | 'insight'
  | 'trading';

/**
 * Static descriptor for a single Triforge capability.
 * Defined at build time in CapabilityRegistry.ts.
 */
export interface CapabilityDescriptor {
  /** Unique dotted identifier, e.g. "image.generate" */
  id: string;
  name: string;
  category: CapabilityCategory;
  description: string;
  tags: string[];
  riskLevel: CapabilityRisk;
  /** Whether this capability always requires explicit user approval before use */
  approvalRequired: boolean;
  /** Minimum subscription tier required. Absent = available on all tiers. */
  requiresTier?: 'pro' | 'business';
  /** How Council should invoke or surface this capability to the user */
  invocationHint?: string;
  /** Example user phrases that should trigger this capability */
  examples?: string[];
}

/**
 * Live runtime snapshot gathered before each Council turn.
 * Reflects the actual state of the running app — not cached assumptions.
 */
export interface SystemStateSnapshot {
  timestamp: number;
  tier: 'free' | 'pro' | 'business';
  activeProfileId: string | null;
  activeMissionId: string | null;
  autonomyRunning: boolean;
  autonomyWorkflowCount: number;
  providers: {
    openai: boolean;
    claude: boolean;
    grok: boolean;
    ollama: boolean;
  };
  /** At least one image-capable provider key is present (OpenAI or Grok) */
  imageReady: boolean;
  voiceAuthConfigured: boolean;
  phonePaired: boolean;
  pendingApprovals: number;
  pendingTasks: number;
  mailConfigured: boolean;
  twitterConfigured: boolean;
  permissions: {
    files: boolean;
    browser: boolean;
    printer: boolean;
    email: boolean;
  };
  /** Tradovate broker is connected and live data is flowing */
  tradingConnected: boolean;
  /** Current shadow trading operation mode */
  tradingMode: 'off' | 'shadow' | 'paper' | 'guarded_live_candidate';
}

/**
 * Final product of CouncilAwarenessService — injected into every Council turn.
 */
export interface CouncilAwarenessPack {
  /** Compact human-readable text (< 500 tokens) for LLM context injection */
  addendum: string;
  /** Raw snapshot — available to routing logic without re-querying */
  snapshot: SystemStateSnapshot;
}
