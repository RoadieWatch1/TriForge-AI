// ── ventureTypes.ts — Domain model for Council Venture Discovery + Build + Growth ──
//
// All types for the venture pipeline: discovery, scoring, proposals, build,
// audience growth, filing/formation, and daily operations.

// ── Enums / union types ──────────────────────────────────────────────────────

export type VentureCategory =
  | 'digital_product'
  | 'content_brand'
  | 'newsletter'
  | 'faceless_media'
  | 'ecommerce_dropship'
  | 'saas_micro'
  | 'service_agency'
  | 'affiliate_niche'
  | 'community_membership'
  | 'local_lead_gen';

export type TrendClass = 'flash' | 'wave' | 'evergreen';

export type VentureMode =
  | 'fast_cash'
  | 'brand_build'
  | 'authority_build'
  | 'experimental'
  | 'passive_engine';

export type VentureFormationMode =
  | 'test_mode_unfiled'
  | 'ready_to_file'
  | 'file_on_approval'
  | 'filed_and_operating';

export type ProposalStatus =
  | 'discovery_complete'
  | 'awaiting_user_approval'
  | 'approved_for_build'
  | 'approved_plan_only'
  | 'rejected'
  | 'rerun_requested'
  | 'building_site'
  | 'site_ready'
  | 'operating_unfiled'
  | 'growth_ready'
  | 'daily_growth_active'
  | 'awaiting_filing_decision'
  | 'filing_deferred'
  | 'filing_prepared'
  | 'filing_submitted'
  | 'filed_and_operating';

export type ActionGateLevel =
  | 'fully_autonomous'
  | 'autonomous_under_cap'
  | 'requires_approval'
  | 'requires_legal_auth';

// ── Market signals ───────────────────────────────────────────────────────────

export interface MarketSignal {
  source: string;
  title: string;
  snippet: string;
  url: string;
  relevance: number; // 0-1
}

// ── Scoring ──────────────────────────────────────────────────────────────────

export interface VentureScores {
  popularityNow: number;       // 0-100
  longevity: number;           // 0-100
  budgetFit: number;           // 0-100
  timeToTraction: number;      // 0-100
  remoteWorkFit: number;       // 0-100
  dailyPromoFit: number;       // 0-100
  executionComplexity: number; // 0-100 (lower = simpler)
  revenuePotential: number;    // 0-100
  risk: number;                // 0-100 (lower = safer)
  composite: number;           // weighted average
}

// ── Candidates ───────────────────────────────────────────────────────────────

export interface VentureCandidate {
  id: string;
  category: VentureCategory;
  concept: string;
  trendClass: TrendClass;
  ventureMode: VentureMode;
  scores: VentureScores;
  signals: MarketSignal[];
}

// ── Website ──────────────────────────────────────────────────────────────────

export type SiteType =
  | 'content_hub'
  | 'landing_page'
  | 'storefront'
  | 'portfolio'
  | 'membership'
  | 'blog';

export interface WebsitePlan {
  siteType: SiteType;
  requiredPages: string[];
  primaryCTA: string;
  secondaryCTA: string;
  structure: string;
}

export interface SitePage {
  slug: string;
  title: string;
  sections: SiteSection[];
  seoMeta: { title: string; description: string; keywords: string[] };
}

export interface SiteSection {
  type: 'hero' | 'features' | 'testimonials' | 'cta' | 'content' | 'faq' | 'pricing' | 'about' | 'capture';
  heading: string;
  body: string;
  cta?: string;
  image?: string;
}

export interface SiteBuild {
  siteType: SiteType;
  pages: SitePage[];
  globalSeo: { title: string; description: string; keywords: string[] };
  captureComponents: CaptureComponent[];
}

export type CaptureType =
  | 'email_signup'
  | 'waitlist'
  | 'free_guide'
  | 'contact_form'
  | 'community_join';

export interface CaptureComponent {
  type: CaptureType;
  formFields: string[];
  ctaCopy: string;
  confirmationMessage: string;
}

// ── Lead capture & audience ──────────────────────────────────────────────────

export interface LeadCapturePlan {
  captureType: CaptureType;
  leadMagnetType: string;
  signupCTA: string;
  estimatedConversionRate: number; // 0-1
}

export interface FollowerGrowthPlan {
  primaryGoal: string;
  captureMethod: string;
  first30DayTarget: number;
  channels: string[];
}

// ── Launch Pack ──────────────────────────────────────────────────────────────

export interface LaunchPack {
  brandName: string;
  logoConceptDescription: string;
  tagline: string;
  oneLinePitch: string;
  targetAudience: string;
  positioning: string;
  monetizationPath: string;
  launchAngle: string;
  contentAngle: string;
  firstWeekPlan: string[];
  brandVoice: string;
  colorDirection: string;
  homepageHeroCopy: string;
  websitePlan: WebsitePlan;
  leadCapturePlan: LeadCapturePlan;
  followerGrowthPlan: FollowerGrowthPlan;
  seoSeedTopics: string[];
  firstTrafficChannels: string[];
  firstOffer: string;
}

// ── Venture options ──────────────────────────────────────────────────────────

export interface VentureOption {
  candidate: VentureCandidate;
  ventureMode: VentureMode;
  whyNow: string;
  confidenceScore: number;      // 0-100
  startupRisk: 'low' | 'low-medium' | 'medium' | 'medium-high' | 'high';
  timeToFirstRevenue: string;   // e.g. "2-4 weeks"
  dailyPromotionFit: number;    // 0-100
  launchPack: LaunchPack;
  websiteStrategy: {
    siteType: SiteType;
    requiredPages: string[];
    primaryCTA: string;
  };
  audienceStrategy: {
    primaryGoal: string;
    captureMethod: string;
  };
  trafficPlan: {
    channels: string[];
    first14DayPush: string;
  };
  formationMode: VentureFormationMode;
  canOperateBeforeFiling: boolean;
  filingRecommendation: 'file_now' | 'wait' | 'not_needed_yet';
  filingUrgency: 'now' | 'soon' | 'later';
  filingReason: string;
  requiresEntityBeforeRevenue: boolean;
}

// ── Treasury ─────────────────────────────────────────────────────────────────

export interface TreasuryAllocation {
  totalBudget: number;
  launchSetup: number;
  tools: number;
  adPromoRunway: number;
  reserve: number;
  maxDailyPromoSpend: number;
  rationale: string;
}

// ── Proposals ────────────────────────────────────────────────────────────────

export interface VentureProposal {
  id: string;
  timestamp: number;
  status: ProposalStatus;
  winner: VentureOption;
  safer: VentureOption;
  aggressive: VentureOption;
  treasuryAllocation: TreasuryAllocation;
  councilRationale: string;
  filingSummary: FilingSummary;
}

// ── Growth funnel ────────────────────────────────────────────────────────────

export interface GrowthFunnel {
  trafficSources: string[];
  capturePoints: string[];
  nurtureMethod: string;
  conversionEvent: string;
  revenuePath: string;
  retentionMechanism: string;
}

// ── First 30 days ────────────────────────────────────────────────────────────

export interface First30DaysPlan {
  first7DaysActions: string[];
  first14DaysGoals: string[];
  first30DaysKPIs: string[];
  trafficTargets: string;
  subscriberTargets: string;
  firstMonetizationMilestone: string;
  pivotConditions: string[];
}

// ── Daily pulse ──────────────────────────────────────────────────────────────

export interface DailyPulse {
  whatWasPosted: string;
  marketChanges: string;
  performance: string;
  councilRecommendation: string;
  nextActions: string[];
}

// ── Conversion planning ──────────────────────────────────────────────────────

export interface ConversionPlan {
  primaryCTA: string;
  secondaryCTA: string;
  leadMagnetType: string;
  conversionCopyAngle: string;
  pageHierarchy: string[];
  aboveFoldOffer: string;
}

// ── Filing / Formation ───────────────────────────────────────────────────────

export interface FilingPacket {
  entityType: string;            // LLC, S-Corp, Sole Prop, etc.
  einReady: boolean;
  stateFilingReady: boolean;
  requirements: string[];
  suggestedTiming: string;
  preparedDocuments: string[];
}

export type FilingRecommendation = 'file_now' | 'wait' | 'not_needed_yet';

export interface FilingSummary {
  recommendation: FilingRecommendation;
  urgency: 'now' | 'soon' | 'later';
  reason: string;
}

export interface FormationDecision {
  canOperateBefore: boolean;
  recommendation: 'file_now' | 'wait' | 'not_needed_yet';
  urgency: 'now' | 'soon' | 'later';
  reason: string;
  requiresEntityBeforeRevenue: boolean;
}

// ── Founder profile ──────────────────────────────────────────────────────────

export interface FounderProfile {
  legalName?: string;
  address?: string;
  state?: string;
  phone?: string;
  email?: string;
  preferredEntityType?: string;
  registeredAgentPreference?: string;
  filingPreferences?: Record<string, string>;
  taxPreferences?: Record<string, string>;
  notificationPreferences?: Record<string, boolean>;
}

// ── Operator policy ──────────────────────────────────────────────────────────

export interface OperatorPolicy {
  contentCreation: ActionGateLevel;
  socialPosting: ActionGateLevel;
  emailOutreach: ActionGateLevel;
  adSpend: ActionGateLevel;
  websiteChanges: ActionGateLevel;
  brandChanges: ActionGateLevel;
  budgetReallocation: ActionGateLevel;
  externalPurchases: ActionGateLevel;
  filingPreparation: ActionGateLevel;
  filingSubmission: ActionGateLevel;
  einPreparation: ActionGateLevel;
  einSubmission: ActionGateLevel;
  complianceCalendarSetup: ActionGateLevel;
  bookkeepingSetup: ActionGateLevel;
  legalFilings: ActionGateLevel;
  financialTransfers: ActionGateLevel;
}

// ── Audience metrics ─────────────────────────────────────────────────────────

export interface AudienceGoal {
  metric: string;
  target: number;
  timeframeDays: number;
}

export interface LeadCaptureAsset {
  type: CaptureType;
  title: string;
  description: string;
  deliveryMethod: string;
}

export interface SubscriberSegment {
  label: string;
  count: number;
  source: string;
}

export interface OwnedAudienceMetrics {
  totalSubscribers: number;
  totalFollowers: number;
  emailOpenRate: number;
  segments: SubscriberSegment[];
  growthRatePerWeek: number;
}

// ── Venture catalog entry (used by ventureCatalog.ts) ────────────────────────

export interface VentureCategoryConfig {
  category: VentureCategory;
  label: string;
  description: string;
  startupCostRange: [number, number]; // [min, max] in USD
  timeToLaunch: string;
  timeToFirstRevenue: string;
  automationSuitability: number;   // 0-100
  dailyPromoSuitability: number;   // 0-100
  contentVelocity: 'low' | 'medium' | 'high';
  riskLevel: 'low' | 'medium' | 'high';
  recommendedSiteType: SiteType;
  recommendedCaptureMethod: CaptureType;
  trafficChannels: string[];
  monetizationPaths: string[];
  canOperateBeforeFiling: boolean;
}

// ── Brand assets (used by brandBuilder) ──────────────────────────────────────

export interface BrandAssets {
  brandName: string;
  tagline: string;
  logoConceptDescription: string;
  colorDirection: string;
  brandVoice: string;
  positioning: string;
  homepageHeroCopy: string;
}

// ── Signup flow (used by signupFlowBuilder) ──────────────────────────────────

export interface SignupFlow {
  captureType: CaptureType;
  formFields: string[];
  ctaCopy: string;
  confirmationMessage: string;
  followUpSequence: string[];
}

// ── Desktop proposal view (for UI rendering) ─────────────────────────────────

export interface VentureProposalView {
  proposal: VentureProposal;
  winnerSummary: string;
  saferSummary: string;
  aggressiveSummary: string;
  budgetBreakdown: { label: string; amount: number; percent: number }[];
  filingSummaryText: string;
}
