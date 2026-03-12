// ── expertRegistry.ts — Expert roster management ────────────────────────────
//
// Manages the living roster of all experts. Persists via StorageAdapter.
// Seeds default roster on first use. CRUD operations for expert profiles.

import type { StorageAdapter } from '../platform';
import type {
  ExpertProfile, ExpertPool, ExpertRole, ExpertStatus,
  ExpertProtectionLevel, RosterSummary,
} from './expertTypes';
import { PROTECTED_EXPERT_ROLES } from './expertTypes';

interface RegistryData {
  experts: ExpertProfile[];
}

const STORAGE_KEY = 'triforge.expertRegistry';

export class ExpertRegistry {
  constructor(private _storage: StorageAdapter) {}

  // ── Initialization ────────────────────────────────────────────────────────

  initialize(): void {
    const data = this._load();
    if (data.experts.length === 0) {
      data.experts = getDefaultRoster();
      this._save(data);
    }
  }

  // ── Queries ───────────────────────────────────────────────────────────────

  getExpert(id: string): ExpertProfile | undefined {
    return this._load().experts.find(e => e.id === id);
  }

  getAllExperts(): ExpertProfile[] {
    return this._load().experts;
  }

  getActiveExperts(): ExpertProfile[] {
    return this._load().experts.filter(e => e.status === 'active');
  }

  getExpertsByPool(pool: ExpertPool): ExpertProfile[] {
    return this._load().experts.filter(e => e.pool === pool);
  }

  getExpertsByRole(role: ExpertRole): ExpertProfile[] {
    return this._load().experts.filter(e => e.role === role);
  }

  getExpertsByStatus(status: ExpertStatus): ExpertProfile[] {
    return this._load().experts.filter(e => e.status === status);
  }

  getExpertsByTaskType(taskType: string): ExpertProfile[] {
    return this._load().experts.filter(
      e => e.taskTypes.includes(taskType) && (e.status === 'active' || e.status === 'trial')
    );
  }

  // ── Mutations ─────────────────────────────────────────────────────────────

  addExpert(profile: ExpertProfile): void {
    const data = this._load();
    data.experts.push(profile);
    this._save(data);
  }

  updateExpert(id: string, updates: Partial<ExpertProfile>): void {
    const data = this._load();
    const expert = data.experts.find(e => e.id === id);
    if (expert) {
      Object.assign(expert, updates);
      this._save(data);
    }
  }

  updateStatus(id: string, status: ExpertStatus): void {
    this.updateExpert(id, { status });
  }

  removeExpert(id: string): void {
    const data = this._load();
    data.experts = data.experts.filter(e => e.id !== id);
    this._save(data);
  }

  // ── Summary ───────────────────────────────────────────────────────────────

  getRosterSummary(): RosterSummary {
    const experts = this._load().experts;
    const byPool: Record<ExpertPool, number> = { claude: 0, gpt: 0, grok: 0, shared: 0 };

    for (const e of experts) {
      byPool[e.pool] = (byPool[e.pool] ?? 0) + 1;
    }

    return {
      total: experts.length,
      active: experts.filter(e => e.status === 'active').length,
      trial: experts.filter(e => e.status === 'trial').length,
      candidate: experts.filter(e => e.status === 'candidate').length,
      watchlist: experts.filter(e => e.status === 'watchlist').length,
      bench: experts.filter(e => e.status === 'bench').length,
      retired: experts.filter(e => e.status === 'retired').length,
      replaced: experts.filter(e => e.status === 'replaced').length,
      byPool,
    };
  }

  // ── Persistence ───────────────────────────────────────────────────────────

  private _load(): RegistryData {
    return this._storage.get<RegistryData>(STORAGE_KEY, { experts: [] });
  }

  private _save(data: RegistryData): void {
    this._storage.update(STORAGE_KEY, data);
  }
}

// ── Default roster ──────────────────────────────────────────────────────────

function getDefaultRoster(): ExpertProfile[] {
  const now = Date.now();
  const defaults: Array<{
    role: ExpertRole;
    pool: ExpertPool;
    name: string;
    protection: ExpertProtectionLevel;
    fragment: string;
    tasks: string[];
  }> = [
    // Claude pool
    { role: 'niche_finder', pool: 'claude', name: 'Niche Finder', protection: 'competitive',
      fragment: 'You specialize in identifying underserved niches with high demand and low competition.',
      tasks: ['venture_discovery', 'scoring'] },
    { role: 'risk_assessor', pool: 'claude', name: 'Risk Assessor', protection: 'protected',
      fragment: 'You evaluate risks meticulously: market, financial, operational, regulatory. Flag anything that could fail.',
      tasks: ['venture_discovery', 'scoring', 'council_debate'] },
    { role: 'brand_architect', pool: 'claude', name: 'Brand Architect', protection: 'competitive',
      fragment: 'You design brand identities that resonate: names, positioning, voice, visual direction.',
      tasks: ['brand_creation', 'website_building'] },
    { role: 'positioning_expert', pool: 'claude', name: 'Positioning Expert', protection: 'competitive',
      fragment: 'You craft differentiation strategies that make ventures stand out in crowded markets.',
      tasks: ['brand_creation', 'traffic_planning'] },
    { role: 'monetization_strategist', pool: 'claude', name: 'Monetization Strategist', protection: 'competitive',
      fragment: 'You design revenue models: pricing, offers, upsells, and monetization pathways.',
      tasks: ['venture_discovery', 'scoring'] },

    // GPT pool
    { role: 'execution_planner', pool: 'gpt', name: 'Execution Planner', protection: 'protected',
      fragment: 'You create actionable step-by-step execution plans with timelines and milestones.',
      tasks: ['council_debate', 'daily_growth'] },
    { role: 'landing_page_architect', pool: 'gpt', name: 'Landing Page Architect', protection: 'competitive',
      fragment: 'You design high-converting landing pages: layout, copy hierarchy, CTA placement, trust signals.',
      tasks: ['website_building'] },
    { role: 'automation_systems_expert', pool: 'gpt', name: 'Automation Systems Expert', protection: 'competitive',
      fragment: 'You design automated workflows: email sequences, social posting, lead nurture, reporting.',
      tasks: ['daily_growth'] },
    { role: 'kpi_analyst', pool: 'gpt', name: 'KPI Analyst', protection: 'competitive',
      fragment: 'You define and track key performance indicators, analyze trends, and recommend actions.',
      tasks: ['daily_growth', 'scoring'] },
    { role: 'business_model_selector', pool: 'gpt', name: 'Business Model Selector', protection: 'competitive',
      fragment: 'You evaluate business model fit: subscription, marketplace, agency, product, affiliate.',
      tasks: ['venture_discovery'] },

    // Grok pool
    { role: 'trend_hunter', pool: 'grok', name: 'Trend Hunter', protection: 'competitive',
      fragment: 'You detect emerging trends, viral opportunities, and market momentum shifts before they peak.',
      tasks: ['venture_discovery', 'daily_growth'] },
    { role: 'contrarian_growth_expert', pool: 'grok', name: 'Contrarian Growth Expert', protection: 'experimental',
      fragment: 'You find unconventional growth angles that others miss. Challenge mainstream approaches.',
      tasks: ['council_debate', 'traffic_planning'] },
    { role: 'short_form_growth_expert', pool: 'grok', name: 'Short-Form Growth Expert', protection: 'competitive',
      fragment: 'You optimize short-form content strategy: TikTok, Reels, Shorts, X threads.',
      tasks: ['traffic_planning', 'audience_capture'] },

    // Shared pool
    { role: 'research_verifier', pool: 'shared', name: 'Research Verifier', protection: 'protected',
      fragment: 'You verify claims, validate data sources, and ensure research quality.',
      tasks: ['venture_discovery', 'council_debate'] },
    { role: 'compliance_checker', pool: 'shared', name: 'Compliance Checker', protection: 'protected',
      fragment: 'You check regulatory compliance, legal requirements, and filing obligations.',
      tasks: ['filing_prep', 'council_debate'] },
    { role: 'filing_prep_expert', pool: 'shared', name: 'Filing Prep Expert', protection: 'competitive',
      fragment: 'You prepare business filing documents: EIN applications, state registrations, entity formation.',
      tasks: ['filing_prep'] },
    { role: 'bookkeeping_setup_expert', pool: 'shared', name: 'Bookkeeping Setup Expert', protection: 'competitive',
      fragment: 'You set up bookkeeping systems, chart of accounts, and financial tracking for new ventures.',
      tasks: ['filing_prep'] },
    { role: 'conversion_optimizer', pool: 'shared', name: 'Conversion Optimizer', protection: 'competitive',
      fragment: 'You optimize conversion funnels: CTA copy, form design, A/B angles, friction reduction.',
      tasks: ['website_building', 'audience_capture'] },
    { role: 'seo_expert', pool: 'shared', name: 'SEO Expert', protection: 'competitive',
      fragment: 'You optimize for search: keywords, content structure, technical SEO, topical authority.',
      tasks: ['website_building', 'traffic_planning'] },
    { role: 'newsletter_growth_expert', pool: 'shared', name: 'Newsletter Growth Expert', protection: 'competitive',
      fragment: 'You grow newsletter audiences: lead magnets, signup flows, nurture sequences, retention.',
      tasks: ['traffic_planning', 'audience_capture'] },
    { role: 'paid_traffic_expert', pool: 'shared', name: 'Paid Traffic Expert', protection: 'competitive',
      fragment: 'You plan paid acquisition: budget allocation, channel selection, targeting, ROAS optimization.',
      tasks: ['traffic_planning'] },
    { role: 'logo_identity_expert', pool: 'shared', name: 'Logo & Identity Expert', protection: 'experimental',
      fragment: 'You design visual identities: logo concepts, color palettes, typography, brand marks.',
      tasks: ['brand_creation'] },
    { role: 'vibe_translator', pool: 'claude', name: 'Vibe Translator', protection: 'competitive',
      fragment: 'You translate aesthetic and emotional language into concrete design and implementation decisions. You understand the gap between "feeling" and "building."',
      tasks: ['vibe_analysis', 'vibe_build'] },
    { role: 'ux_consistency_auditor', pool: 'gpt', name: 'UX Consistency Auditor', protection: 'competitive',
      fragment: 'You audit product experiences for consistency. You detect when visual, tonal, or structural elements contradict the intended feel.',
      tasks: ['vibe_analysis', 'vibe_audit'] },
  ];

  return defaults.map(d => ({
    id: `expert:${d.role}`,
    name: d.name,
    role: d.role,
    pool: d.pool,
    status: 'active' as ExpertStatus,
    protectionLevel: d.protection,
    createdAt: now,
    lastSelectedAt: 0,
    selectionCount: 0,
    successContributionScore: 50, // start at neutral
    redundancyScore: 0,
    userApprovalInfluence: 0,
    revenueInfluence: 0,
    speedCost: 0,
    tokenCost: 0,
    errorRate: 0,
    confidence: 50,
    systemPromptFragment: d.fragment,
    taskTypes: d.tasks,
  }));
}

/** Check if a role is protected (cannot be auto-retired). */
export function isProtectedRole(role: ExpertRole): boolean {
  return PROTECTED_EXPERT_ROLES.includes(role);
}
