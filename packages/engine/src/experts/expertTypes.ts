// ── expertTypes.ts — Domain model for the Expert Workforce Engine ────────────
//
// All types for expert management: roles, lifecycle states, performance
// tracking, hiring, promotion, bench, replacement.

// ── Expert roles ────────────────────────────────────────────────────────────

export type ExpertRole =
  | 'niche_finder'
  | 'business_model_selector'
  | 'monetization_strategist'
  | 'risk_assessor'
  | 'brand_architect'
  | 'logo_identity_expert'
  | 'positioning_expert'
  | 'landing_page_architect'
  | 'seo_expert'
  | 'newsletter_growth_expert'
  | 'short_form_growth_expert'
  | 'conversion_optimizer'
  | 'paid_traffic_expert'
  | 'filing_prep_expert'
  | 'bookkeeping_setup_expert'
  | 'automation_systems_expert'
  | 'kpi_analyst'
  | 'trend_hunter'
  | 'contrarian_growth_expert'
  | 'research_verifier'
  | 'execution_planner'
  | 'compliance_checker'
  | 'vibe_translator'
  | 'ux_consistency_auditor';

// ── Lifecycle states ────────────────────────────────────────────────────────

export type ExpertStatus =
  | 'candidate'   // new concept, not yet proven
  | 'trial'       // being tested on real tasks
  | 'active'      // regularly useful and selected
  | 'watchlist'   // underperforming or rarely selected
  | 'bench'       // disabled from default routing, not deleted
  | 'retired'     // removed from live use
  | 'replaced';   // another expert took over its role

// ── Protection levels ───────────────────────────────────────────────────────

export type ExpertProtectionLevel =
  | 'protected'     // must always exist in some form
  | 'competitive'   // can compete for active seat
  | 'experimental'; // trial-only, high-risk

// ── Expert pools ────────────────────────────────────────────────────────────

export type ExpertPool = 'claude' | 'gpt' | 'grok' | 'shared';

// ── Expert profile ──────────────────────────────────────────────────────────

export interface ExpertProfile {
  id: string;
  name: string;
  role: ExpertRole;
  pool: ExpertPool;
  status: ExpertStatus;
  protectionLevel: ExpertProtectionLevel;
  createdAt: number;
  lastSelectedAt: number;
  selectionCount: number;
  successContributionScore: number;    // 0-100
  redundancyScore: number;             // 0-100 — high = likely redundant
  userApprovalInfluence: number;       // how much this expert's work affects approvals
  revenueInfluence: number;            // correlation with revenue outcomes
  speedCost: number;                   // avg latency contribution in ms
  tokenCost: number;                   // avg token usage per activation
  errorRate: number;                   // 0-1
  confidence: number;                  // 0-100
  systemPromptFragment: string;        // injected when expert is activated
  taskTypes: string[];                 // which task types this expert handles
  // Placement metadata (optional — populated by Adaptive Placement engine)
  homeLane?: string;                   // default execution lane
  currentLane?: string;               // current execution lane
  priorityClass?: 'critical' | 'standard' | 'background';
  placementAffinity?: number;          // 0-100 — binding to home lane
}

// ── Task result ─────────────────────────────────────────────────────────────

export interface ExpertTaskResult {
  expertId: string;
  taskType: string;
  ventureId?: string;
  output: string;
  outputSurvivedToFinal: boolean;
  latencyMs: number;
  tokenCount: number;
  errorOccurred: boolean;
  timestamp: number;
}

// ── Selection ───────────────────────────────────────────────────────────────

export interface ExpertSelectionDecision {
  taskType: string;
  selectedExperts: string[];
  skippedExperts: string[];
  reason: string;
  timestamp: number;
}

export interface ExpertRoutingContext {
  ventureCategory?: string;
  budget?: number;
  learningRecommendations?: string[];
  placementContext?: {
    saturatedLanes?: string[];        // lane IDs currently at capacity
    expertUtilization?: Record<string, number>; // expertId → utilization %
  };
}

// ── Hiring ──────────────────────────────────────────────────────────────────

export type HiringDetectionSource =
  | 'repeated_failure'
  | 'missing_specialty'
  | 'user_request'
  | 'capability_gap'
  | 'unmet_need';

export interface ExpertHiringNeed {
  missingCapability: string;
  detectedFrom: HiringDetectionSource;
  confidence: number;
  suggestedRole: ExpertRole;
  timestamp: number;
}

// ── Replacement ─────────────────────────────────────────────────────────────

export interface ExpertReplacementDecision {
  outgoingExpertId: string;
  incomingExpertId: string;
  reason: string;
  confidence: number;
  timestamp: number;
}

// ── Performance ─────────────────────────────────────────────────────────────

export type PerformancePeriod = 'daily' | 'weekly' | 'monthly';

export interface ExpertPerformanceRecord {
  expertId: string;
  period: PerformancePeriod;
  selectionCount: number;
  outputSurvivedRate: number;   // 0-1
  approvalInfluence: number;
  revenueInfluence: number;
  errorRate: number;
  avgLatencyMs: number;
  avgTokenCost: number;
  redundancyScore: number;
  timestamp: number;
}

// ── Roster summaries ────────────────────────────────────────────────────────

export interface RosterSummary {
  total: number;
  active: number;
  trial: number;
  candidate: number;
  watchlist: number;
  bench: number;
  retired: number;
  replaced: number;
  byPool: Record<ExpertPool, number>;
}

export interface RosterHealthSummary {
  summary: RosterSummary;
  topPerformers: string[];       // expert IDs
  underperformers: string[];     // expert IDs
  dormant: string[];             // expert IDs
  hiringNeeds: ExpertHiringNeed[];
}

// ── Workforce health report ─────────────────────────────────────────────────

export interface WorkforceHealthReport {
  timestamp: number;
  summary: RosterSummary;
  recommendations: WorkforceRecommendation[];
}

export interface WorkforceRecommendation {
  expertId: string;
  action: 'promote' | 'watchlist' | 'bench' | 'retire' | 'replace' | 'hire';
  reason: string;
  confidence: number;
}

// ── Roster ledger ───────────────────────────────────────────────────────────

export type RosterAction =
  | 'hired'
  | 'promoted'
  | 'watchlisted'
  | 'benched'
  | 'retired'
  | 'replaced'
  | 'restored'
  | 'selected'
  | 'task_completed';

export interface RosterLedgerEntry {
  timestamp: number;
  action: RosterAction;
  expertId: string;
  details: Record<string, unknown>;
}

// ── Protected roles ─────────────────────────────────────────────────────────

export const PROTECTED_EXPERT_ROLES: ExpertRole[] = [
  'risk_assessor',
  'compliance_checker',
  'research_verifier',
  'execution_planner',
];

// ── Task type routing map ───────────────────────────────────────────────────

export const TASK_TYPE_EXPERT_MAP: Record<string, ExpertRole[]> = {
  venture_discovery: ['niche_finder', 'trend_hunter', 'risk_assessor', 'business_model_selector'],
  brand_creation: ['brand_architect', 'positioning_expert', 'logo_identity_expert'],
  website_building: ['landing_page_architect', 'seo_expert', 'conversion_optimizer'],
  traffic_planning: ['paid_traffic_expert', 'short_form_growth_expert', 'newsletter_growth_expert'],
  audience_capture: ['newsletter_growth_expert', 'conversion_optimizer', 'short_form_growth_expert'],
  filing_prep: ['filing_prep_expert', 'compliance_checker', 'bookkeeping_setup_expert'],
  daily_growth: ['kpi_analyst', 'automation_systems_expert', 'trend_hunter'],
  scoring: ['risk_assessor', 'monetization_strategist', 'kpi_analyst'],
  council_debate: ['execution_planner', 'research_verifier', 'contrarian_growth_expert'],
  vibe_analysis: ['brand_architect', 'positioning_expert', 'vibe_translator', 'ux_consistency_auditor'],
  vibe_build: ['landing_page_architect', 'vibe_translator', 'conversion_optimizer', 'ux_consistency_auditor'],
  vibe_audit: ['ux_consistency_auditor', 'brand_architect', 'vibe_translator'],
};
