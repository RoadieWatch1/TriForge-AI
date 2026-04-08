import React, { useState, useEffect, useRef } from 'react';

interface VentureDiscoveryProps {
  tier: string;
}

interface VentureOption {
  candidate: { id: string; concept: string; category: string; trendClass: string; scores: Record<string, number> };
  ventureMode: string;
  whyNow: string;
  confidenceScore: number;
  startupRisk: string;
  timeToFirstRevenue: string;
  dailyPromotionFit: number;
  launchPack?: {
    brandName: string; tagline: string; oneLinePitch: string; targetAudience: string;
    positioning: string; monetizationPath: string; launchAngle: string;
    contentAngle: string; firstWeekPlan: string[]; brandVoice: string;
    colorDirection: string; homepageHeroCopy: string;
    websitePlan?: { siteType: string; requiredPages: string[]; primaryCTA: string; secondaryCTA: string };
    leadCapturePlan?: { captureType: string; leadMagnetType: string; signupCTA: string; estimatedConversionRate: number };
    followerGrowthPlan?: { primaryGoal: string; captureMethod: string; first30DayTarget: number; channels: string[] };
    seoSeedTopics?: string[];
    firstTrafficChannels?: string[];
    firstOffer?: string;
  };
  formationMode: string;
  canOperateBeforeFiling: boolean;
  filingRecommendation: string;
  filingUrgency: string;
  filingReason: string;
  requiresEntityBeforeRevenue: boolean;
}

interface VentureProposal {
  id: string;
  timestamp: number;
  status: string;
  winner: VentureOption;
  safer: VentureOption;
  aggressive: VentureOption;
  treasuryAllocation?: {
    totalBudget: number; launchSetup: number; tools: number;
    adPromoRunway: number; reserve: number; maxDailyPromoSpend: number; rationale: string;
  };
  councilRationale: string;
  filingSummary?: { recommendation: 'file_now' | 'wait' | 'not_needed_yet'; urgency: string; reason: string };
  siteBuild?: unknown;
  first30DaysPlan?: {
    first7DaysActions: string[]; first14DaysGoals: string[];
    first30DaysKPIs: string[]; trafficTargets: string[];
    subscriberTargets: string[];
    firstMonetizationMilestone: string; pivotConditions: string[];
  };
  filingPacket?: {
    entityType: string; einReady: boolean; stateFilingReady: boolean;
    requirements: string[]; suggestedTiming: string; preparedDocuments: string[];
  };
}

type Tab = 'launchpack' | 'website' | 'audience' | 'traffic' | '30days' | 'filing';

const CATEGORY_LABELS: Record<string, string> = {
  digital_product: 'Digital Product',
  content_brand: 'Content Brand',
  newsletter: 'Newsletter',
  faceless_media: 'Faceless Media',
  ecommerce_dropship: 'E-Commerce',
  saas_micro: 'Micro SaaS',
  service_agency: 'Service Agency',
  affiliate_niche: 'Affiliate Niche',
  community_membership: 'Community',
  local_lead_gen: 'Local Lead Gen',
};

const STATUS_LABELS: Record<string, string> = {
  discovery_complete: 'Discovery Complete',
  awaiting_user_approval: 'Awaiting Approval',
  approved_for_build: 'Approved for Build',
  approved_plan_only: 'Plan Only',
  rejected: 'Rejected',
  rerun_requested: 'Re-run Requested',
  building_site: 'Building Site',
  operating_unfiled: 'Operating (Unfiled)',
  growth_ready: 'Growth Ready',
  daily_growth_active: 'Growth Active',
  awaiting_filing_decision: 'Filing Decision Required',
  filing_deferred: 'Filing Deferred',
  filing_prepared: 'Filing Prepared',
  filing_submitted: 'Filing Submitted',
  filed_and_operating: 'Filed & Operating',
};

const STATUS_DESCRIPTIONS: Record<string, string> = {
  approved_plan_only: 'Plan approved for reference. You can escalate to a full build at any time.',
  operating_unfiled: 'This venture is operational without formal filing. The Council is running growth and audience capture. You can file later when traction confirms viability.',
  awaiting_filing_decision: 'Site is built. This venture type requires a filing decision before operation can begin. Choose File Now, Wait, or Ask Again Later on the Filing tab.',
  filing_deferred: 'Filing has been deferred. You can revisit the filing decision at any time.',
  filed_and_operating: 'This venture is fully filed and operational. All legal formation steps are complete.',
  daily_growth_active: 'Growth engine is active. The Council is publishing content, capturing audience, and optimizing daily.',
  building_site: 'The Council is building the website, lead capture, and growth plan.',
  filing_prepared: 'Filing packet has been prepared and is ready for your review. Confirm filing to proceed, or defer.',
};

export function VentureDiscovery({ tier }: VentureDiscoveryProps) {
  const [budget, setBudget] = useState(500);
  const [loading, setLoading] = useState(false);
  const [progress, setProgress] = useState<{ phase: string; detail?: string } | null>(null);
  const [proposal, setProposal] = useState<VentureProposal | null>(null);
  const [history, setHistory] = useState<VentureProposal[]>([]);
  const [selectedOption, setSelectedOption] = useState<'winner' | 'safer' | 'aggressive'>('winner');
  const [activeTab, setActiveTab] = useState<Tab>('launchpack');
  const [error, setError] = useState<string | null>(null);
  const cleanupRef = useRef<(() => void) | null>(null);

  // Load history
  useEffect(() => {
    window.triforge.venture.list().then(list => {
      setHistory(list as unknown as VentureProposal[]);
      // Show latest awaiting proposal
      const latest = list.find((p: Record<string, unknown>) => p.status === 'awaiting_user_approval');
      if (latest) setProposal(latest as unknown as VentureProposal);
    });
  }, []);

  // Subscribe to progress events
  useEffect(() => {
    const cleanup = window.triforge.venture.onProgress((data) => {
      setProgress(data);
    });
    cleanupRef.current = cleanup;
    return () => cleanup();
  }, []);

  const handleDiscover = async () => {
    setLoading(true);
    setError(null);
    setProgress({ phase: 'starting', detail: 'Initializing venture discovery...' });

    try {
      const result = await window.triforge.venture.discover(budget);
      if (result.error) {
        setError(result.error as string);
        if (result.tier) setError(`${result.error} (${result.tier} tier)`);
      } else if (result.proposal) {
        setProposal(result.proposal as unknown as VentureProposal);
        // Refresh history
        const list = await window.triforge.venture.list();
        setHistory(list as unknown as VentureProposal[]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      setProgress(null);
    }
  };

  const handleRespond = async (action: string) => {
    if (!proposal) return;
    try {
      const result = await window.triforge.venture.respond(proposal.id, action);
      if (result.error) {
        setError(result.error);
      } else {
        // Refresh
        const updated = await window.triforge.venture.get(proposal.id);
        if (updated) setProposal(updated as unknown as VentureProposal);
        const list = await window.triforge.venture.list();
        setHistory(list as unknown as VentureProposal[]);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleBuild = async () => {
    if (!proposal) return;
    setLoading(true);
    setProgress({ phase: 'build_start', detail: 'Starting venture build...' });
    try {
      const result = await window.triforge.venture.build(proposal.id);
      if (result.error) setError(result.error);
      // Refresh
      const updated = await window.triforge.venture.get(proposal.id);
      if (updated) setProposal(updated as unknown as VentureProposal);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      setProgress(null);
    }
  };

  const handleLaunch = async () => {
    if (!proposal) return;
    try {
      const result = await window.triforge.venture.launch(proposal.id);
      if (result.error) setError(result.error);
      const updated = await window.triforge.venture.get(proposal.id);
      if (updated) setProposal(updated as unknown as VentureProposal);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const handleFilingRespond = async (action: string) => {
    if (!proposal) return;
    try {
      const result = await window.triforge.venture.filingRespond(proposal.id, action);
      if (result.error) setError(result.error);
      const updated = await window.triforge.venture.get(proposal.id);
      if (updated) setProposal(updated as unknown as VentureProposal);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const loadProposal = async (id: string) => {
    const data = await window.triforge.venture.get(id);
    if (data) {
      setProposal(data as unknown as VentureProposal);
      setSelectedOption('winner');
      setActiveTab('launchpack');
    }
  };

  const currentOption = proposal ? proposal[selectedOption] : null;

  return (
    <div style={s.container}>
      {/* Sidebar — history */}
      <aside style={s.sidebar}>
        <div style={s.sidebarTitle}>VENTURES</div>
        {history.map(p => (
          <button
            key={p.id}
            style={{ ...s.historyItem, ...(proposal?.id === p.id ? s.historyItemActive : {}) }}
            onClick={() => loadProposal(p.id)}
          >
            <div style={s.historyConceptName}>{p.winner?.candidate?.concept?.slice(0, 30) ?? 'Venture'}</div>
            <div style={s.historyMeta}>
              <span style={{ ...s.statusBadge, background: statusColor(p.status) }}>{STATUS_LABELS[p.status] ?? p.status}</span>
            </div>
          </button>
        ))}
        {history.length === 0 && <div style={s.emptyHistory}>No ventures yet</div>}
      </aside>

      {/* Main panel */}
      <div style={s.mainPanel}>
        {/* Discovery bar */}
        {!proposal && !loading && (
          <div style={s.discoveryBar}>
            <div style={s.discoveryTitle}>Discover a Venture</div>
            <div style={s.discoveryDesc}>
              The Council will research live market signals, score opportunities, and propose 3 venture options within your budget.
            </div>
            <div style={s.budgetRow}>
              <label style={s.budgetLabel}>Budget ($)</label>
              <input
                type="number"
                value={budget}
                onChange={e => setBudget(Math.max(50, Number(e.target.value)))}
                style={s.budgetInput}
                min={50}
                max={50000}
              />
              <button style={s.discoverBtn} onClick={handleDiscover} disabled={tier === 'free'}>
                {tier === 'free' ? 'Upgrade to Discover' : 'Discover Venture'}
              </button>
            </div>
            {tier === 'free' && (
              <div style={s.tierWarning}>Venture Discovery requires Pro or Business tier.</div>
            )}
          </div>
        )}

        {/* Loading / progress */}
        {loading && (
          <div style={s.progressPanel}>
            <div style={s.progressPhase}>{progress?.phase?.replace(/_/g, ' ').toUpperCase() ?? 'STARTING'}</div>
            <div style={s.progressDetail}>{progress?.detail ?? 'Initializing...'}</div>
            <div style={s.spinner} />
          </div>
        )}

        {/* Error */}
        {error && (
          <div style={s.errorBox}>
            {error}
            <button style={s.dismissBtn} onClick={() => setError(null)}>Dismiss</button>
          </div>
        )}

        {/* Proposal view */}
        {proposal && !loading && (
          <div style={s.proposalContainer}>
            {/* Three option cards */}
            <div style={s.optionRow}>
              {(['winner', 'safer', 'aggressive'] as const).map(key => {
                const opt = proposal[key];
                if (!opt) return null;
                const colors = { winner: '#22c55e', safer: '#3b82f6', aggressive: '#f97316' };
                const labels = { winner: 'WINNER', safer: 'SAFER', aggressive: 'AGGRESSIVE' };
                return (
                  <button
                    key={key}
                    style={{
                      ...s.optionCard,
                      borderColor: selectedOption === key ? colors[key] : '#2a2a3e',
                      background: selectedOption === key ? `${colors[key]}10` : '#15151f',
                    }}
                    onClick={() => { setSelectedOption(key); setActiveTab('launchpack'); }}
                  >
                    <div style={{ ...s.optionLabel, color: colors[key] }}>{labels[key]}</div>
                    <div style={s.optionCategory}>{CATEGORY_LABELS[opt.candidate.category] ?? opt.candidate.category}</div>
                    <div style={s.optionConcept}>{opt.candidate.concept}</div>
                    <div style={s.optionMeta}>
                      <span>Confidence: {opt.confidenceScore}%</span>
                      <span>Risk: {opt.startupRisk}</span>
                    </div>
                    <div style={s.optionMeta}>
                      <span>Revenue: {opt.timeToFirstRevenue}</span>
                      <span>Mode: {opt.ventureMode?.replace(/_/g, ' ')}</span>
                    </div>
                    {opt.canOperateBeforeFiling && (
                      <div style={s.operateTag}>Can operate before filing</div>
                    )}
                  </button>
                );
              })}
            </div>

            {/* Budget breakdown */}
            {proposal.treasuryAllocation && (
              <div style={s.budgetBreakdown}>
                <div style={s.sectionTitle}>BUDGET ALLOCATION</div>
                <div style={s.budgetBar}>
                  <div style={{ ...s.budgetSegment, background: '#6366f1', width: `${(proposal.treasuryAllocation.launchSetup / proposal.treasuryAllocation.totalBudget) * 100}%` }} title={`Launch: $${proposal.treasuryAllocation.launchSetup}`} />
                  <div style={{ ...s.budgetSegment, background: '#8b5cf6', width: `${(proposal.treasuryAllocation.tools / proposal.treasuryAllocation.totalBudget) * 100}%` }} title={`Tools: $${proposal.treasuryAllocation.tools}`} />
                  <div style={{ ...s.budgetSegment, background: '#a78bfa', width: `${(proposal.treasuryAllocation.adPromoRunway / proposal.treasuryAllocation.totalBudget) * 100}%` }} title={`Promo: $${proposal.treasuryAllocation.adPromoRunway}`} />
                  <div style={{ ...s.budgetSegment, background: '#c4b5fd', width: `${(proposal.treasuryAllocation.reserve / proposal.treasuryAllocation.totalBudget) * 100}%` }} title={`Reserve: $${proposal.treasuryAllocation.reserve}`} />
                </div>
                <div style={s.budgetLegend}>
                  <span><span style={{ ...s.legendDot, background: '#6366f1' }} /> Launch ${proposal.treasuryAllocation.launchSetup}</span>
                  <span><span style={{ ...s.legendDot, background: '#8b5cf6' }} /> Tools ${proposal.treasuryAllocation.tools}</span>
                  <span><span style={{ ...s.legendDot, background: '#a78bfa' }} /> Promo ${proposal.treasuryAllocation.adPromoRunway}</span>
                  <span><span style={{ ...s.legendDot, background: '#c4b5fd' }} /> Reserve ${proposal.treasuryAllocation.reserve}</span>
                </div>
              </div>
            )}

            {/* Why Now */}
            {currentOption?.whyNow && (
              <div style={s.whyNowCard}>
                <div style={s.sectionTitle}>WHY NOW</div>
                <div style={s.whyNowText}>{currentOption.whyNow}</div>
              </div>
            )}

            {/* Tab bar */}
            <div style={s.tabBar}>
              {(['launchpack', 'website', 'audience', 'traffic', '30days', 'filing'] as Tab[]).map(tab => (
                <button
                  key={tab}
                  style={{ ...s.tab, ...(activeTab === tab ? s.tabActive : {}) }}
                  onClick={() => setActiveTab(tab)}
                >
                  {tab === 'launchpack' ? 'LaunchPack' : tab === '30days' ? '30 Days' : tab.charAt(0).toUpperCase() + tab.slice(1)}
                </button>
              ))}
            </div>

            {/* Tab content */}
            <div style={s.tabContent}>
              {activeTab === 'launchpack' && currentOption?.launchPack && <LaunchPackTab pack={currentOption.launchPack} />}
              {activeTab === 'website' && currentOption?.launchPack?.websitePlan && <WebsiteTab plan={currentOption.launchPack.websitePlan} siteBuild={proposal.siteBuild} />}
              {activeTab === 'audience' && currentOption?.launchPack?.followerGrowthPlan && <AudienceTab plan={currentOption.launchPack.followerGrowthPlan} capture={currentOption.launchPack.leadCapturePlan} />}
              {activeTab === 'traffic' && currentOption?.launchPack && <TrafficTab pack={currentOption.launchPack} />}
              {activeTab === '30days' && proposal.first30DaysPlan && <ThirtyDaysTab plan={proposal.first30DaysPlan} />}
              {activeTab === 'filing' && currentOption && <FilingTab option={currentOption} packet={proposal.filingPacket} status={proposal.status} onFilingRespond={handleFilingRespond} />}
            </div>

            {/* Action buttons */}
            <div style={s.actionRow}>
              {proposal.status === 'awaiting_user_approval' && (
                <>
                  <button style={{ ...s.actionBtn, background: '#22c55e' }} onClick={() => handleRespond('approve')}>Approve</button>
                  <button style={{ ...s.actionBtn, background: '#3b82f6' }} onClick={() => handleRespond('approve_plan_only')}>Plan Only</button>
                  <button style={{ ...s.actionBtn, background: '#f97316' }} onClick={() => handleRespond('alternative')}>Alternative</button>
                  <button style={{ ...s.actionBtn, background: '#64748b' }} onClick={() => handleRespond('hold')}>Hold</button>
                  <button style={{ ...s.actionBtn, background: '#ef4444' }} onClick={() => handleRespond('reject')}>Reject</button>
                </>
              )}
              {proposal.status === 'approved_for_build' && (
                <button style={{ ...s.actionBtn, background: '#6366f1' }} onClick={handleBuild}>Build Venture</button>
              )}
              {proposal.status === 'approved_plan_only' && (
                <button style={{ ...s.actionBtn, background: '#6366f1' }} onClick={() => handleRespond('escalate_to_build')}>Proceed to Build</button>
              )}
              {['operating_unfiled', 'growth_ready', 'filed_and_operating'].includes(proposal.status) && (
                <button style={{ ...s.actionBtn, background: '#22c55e' }} onClick={handleLaunch}>Launch Growth</button>
              )}
            </div>

            {/* Status badge */}
            <div style={s.statusRow}>
              <span style={{ ...s.statusBadge, background: statusColor(proposal.status), fontSize: 13 }}>
                {STATUS_LABELS[proposal.status] ?? proposal.status}
              </span>
              {proposal.status !== 'awaiting_user_approval' && (
                <button style={s.newDiscoverBtn} onClick={() => { setProposal(null); setError(null); }}>
                  New Discovery
                </button>
              )}
            </div>
            {STATUS_DESCRIPTIONS[proposal.status] && (
              <div style={s.statusDescription}>
                {STATUS_DESCRIPTIONS[proposal.status]}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Sub-components for tabs ──────────────────────────────────────────────────

function LaunchPackTab({ pack }: { pack: NonNullable<VentureOption['launchPack']> }) {
  return (
    <div style={s.tabPanel}>
      <div style={s.field}><span style={s.fieldLabel}>Brand</span> {pack.brandName}</div>
      <div style={s.field}><span style={s.fieldLabel}>Tagline</span> {pack.tagline}</div>
      <div style={s.field}><span style={s.fieldLabel}>Pitch</span> {pack.oneLinePitch}</div>
      <div style={s.field}><span style={s.fieldLabel}>Audience</span> {pack.targetAudience}</div>
      <div style={s.field}><span style={s.fieldLabel}>Positioning</span> {pack.positioning}</div>
      <div style={s.field}><span style={s.fieldLabel}>Monetization</span> {pack.monetizationPath}</div>
      <div style={s.field}><span style={s.fieldLabel}>Launch Angle</span> {pack.launchAngle}</div>
      <div style={s.field}><span style={s.fieldLabel}>Content Angle</span> {pack.contentAngle}</div>
      <div style={s.field}><span style={s.fieldLabel}>Voice</span> {pack.brandVoice}</div>
      <div style={s.field}><span style={s.fieldLabel}>Colors</span> {pack.colorDirection}</div>
      <div style={s.field}><span style={s.fieldLabel}>First Offer</span> {pack.firstOffer ?? 'TBD'}</div>
      {pack.homepageHeroCopy && (
        <div style={s.heroCopy}>
          <div style={s.fieldLabel}>Homepage Hero</div>
          <div style={s.heroText}>{pack.homepageHeroCopy}</div>
        </div>
      )}
      {pack.firstWeekPlan && pack.firstWeekPlan.length > 0 && (
        <div style={s.listSection}>
          <div style={s.fieldLabel}>First Week</div>
          <ol style={s.orderedList}>
            {pack.firstWeekPlan.map((item, i) => <li key={i}>{item}</li>)}
          </ol>
        </div>
      )}
    </div>
  );
}

function WebsiteTab({ plan, siteBuild }: { plan: NonNullable<VentureOption['launchPack']>['websitePlan']; siteBuild?: unknown }) {
  return (
    <div style={s.tabPanel}>
      {plan && (
        <>
          <div style={s.field}><span style={s.fieldLabel}>Site Type</span> {plan.siteType}</div>
          <div style={s.field}><span style={s.fieldLabel}>Primary CTA</span> {plan.primaryCTA}</div>
          <div style={s.field}><span style={s.fieldLabel}>Secondary CTA</span> {plan.secondaryCTA}</div>
          {plan.requiredPages && (
            <div style={s.listSection}>
              <div style={s.fieldLabel}>Pages</div>
              <ul style={s.bulletList}>
                {plan.requiredPages.map((p, i) => <li key={i}>{p}</li>)}
              </ul>
            </div>
          )}
        </>
      )}
      {!!siteBuild && (
        <div style={{ ...s.field, color: '#22c55e' }}>
          Site has been generated. Preview available in build output.
        </div>
      )}
    </div>
  );
}

function AudienceTab({ plan, capture }: {
  plan: NonNullable<VentureOption['launchPack']>['followerGrowthPlan'];
  capture?: NonNullable<VentureOption['launchPack']>['leadCapturePlan'];
}) {
  return (
    <div style={s.tabPanel}>
      {plan && (
        <>
          <div style={s.field}><span style={s.fieldLabel}>Goal</span> {plan.primaryGoal}</div>
          <div style={s.field}><span style={s.fieldLabel}>Capture Method</span> {plan.captureMethod}</div>
          <div style={s.field}><span style={s.fieldLabel}>30-Day Target</span> {plan.first30DayTarget} subscribers</div>
          {plan.channels && (
            <div style={s.listSection}>
              <div style={s.fieldLabel}>Channels</div>
              <ul style={s.bulletList}>
                {plan.channels.map((c, i) => <li key={i}>{c}</li>)}
              </ul>
            </div>
          )}
        </>
      )}
      {capture && (
        <div style={{ marginTop: 16 }}>
          <div style={s.fieldLabel}>Lead Capture</div>
          <div style={s.field}><span style={s.fieldLabel}>Type</span> {capture.captureType}</div>
          <div style={s.field}><span style={s.fieldLabel}>Lead Magnet</span> {capture.leadMagnetType}</div>
          <div style={s.field}><span style={s.fieldLabel}>CTA</span> {capture.signupCTA}</div>
          <div style={s.field}><span style={s.fieldLabel}>Est. Conversion</span> {capture.estimatedConversionRate}%</div>
        </div>
      )}
    </div>
  );
}

function TrafficTab({ pack }: { pack: NonNullable<VentureOption['launchPack']> }) {
  return (
    <div style={s.tabPanel}>
      {pack.firstTrafficChannels && (
        <div style={s.listSection}>
          <div style={s.fieldLabel}>Traffic Channels</div>
          <ul style={s.bulletList}>
            {pack.firstTrafficChannels.map((c, i) => <li key={i}>{c}</li>)}
          </ul>
        </div>
      )}
      {pack.seoSeedTopics && (
        <div style={s.listSection}>
          <div style={s.fieldLabel}>SEO Seed Topics</div>
          <ul style={s.bulletList}>
            {pack.seoSeedTopics.map((t, i) => <li key={i}>{t}</li>)}
          </ul>
        </div>
      )}
      {/* Funnel visualization */}
      <div style={s.funnelContainer}>
        <div style={s.fieldLabel}>Growth Funnel</div>
        <div style={s.funnelRow}>
          {['Traffic', 'Capture', 'Nurture', 'Convert', 'Retain'].map((stage, i) => (
            <React.Fragment key={stage}>
              <div style={s.funnelStage}>{stage}</div>
              {i < 4 && <div style={s.funnelArrow}>&rarr;</div>}
            </React.Fragment>
          ))}
        </div>
      </div>
    </div>
  );
}

function ThirtyDaysTab({ plan }: { plan: NonNullable<VentureProposal['first30DaysPlan']> }) {
  return (
    <div style={s.tabPanel}>
      <div style={s.listSection}>
        <div style={s.fieldLabel}>Week 1 Actions</div>
        <ol style={s.orderedList}>
          {plan.first7DaysActions.map((a, i) => <li key={i}>{a}</li>)}
        </ol>
      </div>
      <div style={s.listSection}>
        <div style={s.fieldLabel}>Week 2 Goals</div>
        <ol style={s.orderedList}>
          {plan.first14DaysGoals.map((g, i) => <li key={i}>{g}</li>)}
        </ol>
      </div>
      <div style={s.listSection}>
        <div style={s.fieldLabel}>30-Day KPIs</div>
        <ul style={s.bulletList}>
          {plan.first30DaysKPIs.map((k, i) => <li key={i}>{k}</li>)}
        </ul>
      </div>
      <div style={s.field}>
        <span style={s.fieldLabel}>First Monetization</span> {plan.firstMonetizationMilestone}
      </div>
      {plan.pivotConditions && plan.pivotConditions.length > 0 && (
        <div style={s.listSection}>
          <div style={s.fieldLabel}>Pivot Conditions</div>
          <ul style={s.bulletList}>
            {plan.pivotConditions.map((c, i) => <li key={i}>{c}</li>)}
          </ul>
        </div>
      )}
    </div>
  );
}

function FilingTab({ option, packet, status, onFilingRespond }: {
  option: VentureOption;
  packet?: VentureProposal['filingPacket'];
  status: string;
  onFilingRespond: (action: string) => void;
}) {
  return (
    <div style={s.tabPanel}>
      <div style={s.field}>
        <span style={s.fieldLabel}>Formation Mode</span> {option.formationMode?.replace(/_/g, ' ')}
      </div>
      <div style={s.field}>
        <span style={s.fieldLabel}>Can Operate Before Filing</span> {option.canOperateBeforeFiling ? 'Yes' : 'No'}
      </div>
      <div style={s.field}>
        <span style={s.fieldLabel}>Filing Recommendation</span> {option.filingRecommendation?.replace(/_/g, ' ')}
      </div>
      <div style={s.field}>
        <span style={s.fieldLabel}>Urgency</span> {option.filingUrgency}
      </div>
      <div style={s.field}>
        <span style={s.fieldLabel}>Reason</span> {option.filingReason}
      </div>
      <div style={s.field}>
        <span style={s.fieldLabel}>Requires Entity Before Revenue</span> {option.requiresEntityBeforeRevenue ? 'Yes' : 'No'}
      </div>

      {/* Filing packet details */}
      {packet && (
        <div style={{ marginTop: 16, padding: 12, background: '#1a1a2e', borderRadius: 8 }}>
          <div style={s.fieldLabel}>Filing Packet</div>
          <div style={s.field}><span style={s.fieldLabel}>Entity Type</span> {packet.entityType}</div>
          <div style={s.field}><span style={s.fieldLabel}>EIN Ready</span> {packet.einReady ? 'Yes' : 'No'}</div>
          <div style={s.field}><span style={s.fieldLabel}>State Filing Ready</span> {packet.stateFilingReady ? 'Yes' : 'No'}</div>
          <div style={s.field}><span style={s.fieldLabel}>Timing</span> {packet.suggestedTiming}</div>
          {packet.requirements.length > 0 && (
            <div style={s.listSection}>
              <div style={s.fieldLabel}>Requirements</div>
              <ul style={s.bulletList}>
                {packet.requirements.map((r, i) => <li key={i}>{r}</li>)}
              </ul>
            </div>
          )}
          {packet.preparedDocuments.length > 0 && (
            <div style={s.listSection}>
              <div style={s.fieldLabel}>Prepared Documents</div>
              <ul style={s.bulletList}>
                {packet.preparedDocuments.map((d, i) => <li key={i}>{d}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}

      {/* Filing action buttons */}
      {!['filing_prepared', 'filing_submitted', 'filed_and_operating', 'filing_deferred'].includes(status) && (
        <div style={{ ...s.actionRow, marginTop: 16 }}>
          <button style={{ ...s.actionBtn, background: '#22c55e' }} onClick={() => onFilingRespond('file_now')}>File Now</button>
          <button style={{ ...s.actionBtn, background: '#64748b' }} onClick={() => onFilingRespond('wait')}>Wait</button>
          <button style={{ ...s.actionBtn, background: '#8b5cf6' }} onClick={() => onFilingRespond('ask_again_later')}>Ask Again Later</button>
        </div>
      )}
      {status === 'filing_deferred' && (
        <div style={{ marginTop: 12 }}>
          <div style={{ color: '#94a3b8', fontSize: 13, marginBottom: 8 }}>
            Filing deferred. You can revisit the filing decision at any time.
          </div>
          <button style={{ ...s.actionBtn, background: '#8b5cf6' }} onClick={() => onFilingRespond('revisit_filing')}>Revisit Filing Decision</button>
        </div>
      )}
      {status === 'filing_prepared' && (
        <div style={{ marginTop: 12 }}>
          <div style={{ color: '#22c55e', fontSize: 13, marginBottom: 8 }}>
            Filing packet prepared and ready for review. Confirm filing to mark this venture as filed and operating.
          </div>
          <div style={{ ...s.actionRow, marginTop: 8 }}>
            <button style={{ ...s.actionBtn, background: '#22c55e' }} onClick={() => onFilingRespond('confirm_filing')}>Confirm Filing</button>
            <button style={{ ...s.actionBtn, background: '#64748b' }} onClick={() => onFilingRespond('wait')}>Defer</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function statusColor(status: string): string {
  const colors: Record<string, string> = {
    awaiting_user_approval: '#f59e0b',
    approved_for_build: '#3b82f6',
    building_site: '#8b5cf6',
    awaiting_filing_decision: '#f59e0b',
    operating_unfiled: '#22c55e',
    growth_ready: '#22c55e',
    daily_growth_active: '#10b981',
    filing_prepared: '#a78bfa',
    filing_submitted: '#6366f1',
    filed_and_operating: '#22c55e',
    filing_deferred: '#64748b',
    rejected: '#ef4444',
    approved_plan_only: '#3b82f6',
    rerun_requested: '#f97316',
  };
  return colors[status] ?? '#64748b';
}

// ── Inline styles ────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  container: { display: 'flex', height: '100%', background: '#0d0d1a', color: '#e2e8f0', fontFamily: 'system-ui, sans-serif' },
  sidebar: { width: 220, borderRight: '1px solid #1e1e32', padding: 12, overflowY: 'auto', flexShrink: 0 },
  sidebarTitle: { fontSize: 11, fontWeight: 700, letterSpacing: 1.5, color: '#64748b', marginBottom: 12 },
  historyItem: { display: 'block', width: '100%', padding: '8px 10px', marginBottom: 4, background: 'transparent', border: '1px solid transparent', borderRadius: 6, cursor: 'pointer', textAlign: 'left' as const, color: '#cbd5e1', fontSize: 12 },
  historyItemActive: { borderColor: '#6366f1', background: '#6366f115' },
  historyConceptName: { fontWeight: 600, fontSize: 12, marginBottom: 4, whiteSpace: 'nowrap' as const, overflow: 'hidden', textOverflow: 'ellipsis' },
  historyMeta: { display: 'flex', gap: 6, alignItems: 'center' },
  emptyHistory: { color: '#475569', fontSize: 12, padding: '20px 0', textAlign: 'center' as const },
  mainPanel: { flex: 1, padding: 24, overflowY: 'auto' },
  discoveryBar: { maxWidth: 600, margin: '60px auto', textAlign: 'center' as const },
  discoveryTitle: { fontSize: 24, fontWeight: 700, color: '#f0f0f5', marginBottom: 8 },
  discoveryDesc: { fontSize: 14, color: '#94a3b8', marginBottom: 24, lineHeight: 1.5 },
  budgetRow: { display: 'flex', gap: 12, justifyContent: 'center', alignItems: 'center' },
  budgetLabel: { fontSize: 13, color: '#94a3b8' },
  budgetInput: { width: 100, padding: '8px 12px', background: '#15151f', border: '1px solid #2a2a3e', borderRadius: 6, color: '#e2e8f0', fontSize: 14, textAlign: 'center' as const },
  discoverBtn: { padding: '10px 24px', background: '#6366f1', color: '#fff', border: 'none', borderRadius: 8, fontWeight: 600, fontSize: 14, cursor: 'pointer' },
  tierWarning: { marginTop: 16, color: '#f59e0b', fontSize: 13 },
  progressPanel: { display: 'flex', flexDirection: 'column' as const, alignItems: 'center', justifyContent: 'center', minHeight: 300, gap: 16 },
  progressPhase: { fontSize: 16, fontWeight: 700, color: '#6366f1', letterSpacing: 1 },
  progressDetail: { fontSize: 13, color: '#94a3b8' },
  spinner: { width: 32, height: 32, border: '3px solid #2a2a3e', borderTop: '3px solid #6366f1', borderRadius: '50%', animation: 'spin 0.8s linear infinite' },
  errorBox: { background: '#1c1017', border: '1px solid #7f1d1d', borderRadius: 8, padding: '12px 16px', color: '#fca5a5', fontSize: 13, marginBottom: 16, display: 'flex', justifyContent: 'space-between', alignItems: 'center' },
  dismissBtn: { background: 'transparent', border: '1px solid #7f1d1d', color: '#fca5a5', padding: '4px 12px', borderRadius: 4, cursor: 'pointer', fontSize: 12 },
  proposalContainer: {},
  optionRow: { display: 'flex', gap: 12, marginBottom: 20 },
  optionCard: { flex: 1, padding: 16, border: '1px solid #2a2a3e', borderRadius: 10, cursor: 'pointer', textAlign: 'left' as const, color: '#e2e8f0', transition: 'border-color 0.15s' },
  optionLabel: { fontSize: 10, fontWeight: 800, letterSpacing: 2, marginBottom: 6 },
  optionCategory: { fontSize: 11, color: '#8b8b9e', marginBottom: 4 },
  optionConcept: { fontSize: 14, fontWeight: 600, marginBottom: 8, lineHeight: 1.3 },
  optionMeta: { display: 'flex', justifyContent: 'space-between', fontSize: 11, color: '#8b8b9e', marginBottom: 4 },
  operateTag: { marginTop: 6, fontSize: 10, color: '#22c55e', background: '#22c55e15', padding: '2px 8px', borderRadius: 4, display: 'inline-block' },
  budgetBreakdown: { marginBottom: 20, padding: 16, background: '#15151f', borderRadius: 8 },
  sectionTitle: { fontSize: 11, fontWeight: 700, letterSpacing: 1.5, color: '#64748b', marginBottom: 10 },
  budgetBar: { display: 'flex', height: 8, borderRadius: 4, overflow: 'hidden', marginBottom: 8 },
  budgetSegment: { height: '100%' },
  budgetLegend: { display: 'flex', gap: 16, fontSize: 11, color: '#94a3b8' },
  legendDot: { display: 'inline-block', width: 8, height: 8, borderRadius: '50%', marginRight: 4 },
  whyNowCard: { marginBottom: 20, padding: 16, background: '#15151f', borderRadius: 8 },
  whyNowText: { fontSize: 13, color: '#cbd5e1', lineHeight: 1.5 },
  tabBar: { display: 'flex', gap: 2, marginBottom: 2, borderBottom: '1px solid #1e1e32' },
  tab: { padding: '8px 16px', background: 'transparent', border: 'none', color: '#64748b', fontSize: 12, fontWeight: 600, cursor: 'pointer', borderBottom: '2px solid transparent' },
  tabActive: { color: '#e2e8f0', borderBottomColor: '#6366f1' },
  tabContent: { minHeight: 200, padding: '16px 0' },
  tabPanel: {},
  field: { fontSize: 13, color: '#cbd5e1', marginBottom: 8, lineHeight: 1.4 },
  fieldLabel: { fontSize: 11, fontWeight: 700, color: '#64748b', marginRight: 8, textTransform: 'uppercase' as const, letterSpacing: 0.5 },
  heroCopy: { marginTop: 12, padding: 12, background: '#1a1a2e', borderRadius: 6 },
  heroText: { fontSize: 14, color: '#e2e8f0', fontStyle: 'italic' as const, lineHeight: 1.5, marginTop: 6 },
  listSection: { marginTop: 12, marginBottom: 8 },
  orderedList: { margin: '6px 0', paddingLeft: 20, fontSize: 13, color: '#cbd5e1', lineHeight: 1.6 },
  bulletList: { margin: '6px 0', paddingLeft: 20, fontSize: 13, color: '#cbd5e1', lineHeight: 1.6, listStyleType: 'disc' as const },
  funnelContainer: { marginTop: 16 },
  funnelRow: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 8 },
  funnelStage: { padding: '6px 14px', background: '#6366f120', border: '1px solid #6366f140', borderRadius: 6, fontSize: 12, fontWeight: 600, color: '#a5b4fc' },
  funnelArrow: { color: '#475569', fontSize: 16 },
  actionRow: { display: 'flex', gap: 10, marginTop: 20, flexWrap: 'wrap' as const },
  actionBtn: { padding: '8px 20px', border: 'none', borderRadius: 6, color: '#fff', fontWeight: 600, fontSize: 13, cursor: 'pointer' },
  statusRow: { display: 'flex', alignItems: 'center', gap: 12, marginTop: 16 },
  statusBadge: { padding: '3px 10px', borderRadius: 4, fontSize: 11, fontWeight: 700, color: '#fff' },
  newDiscoverBtn: { background: 'transparent', border: '1px solid #2a2a3e', color: '#94a3b8', padding: '4px 14px', borderRadius: 6, cursor: 'pointer', fontSize: 12 },
  statusDescription: { marginTop: 8, padding: '10px 14px', background: '#15151f', border: '1px solid #1e1e32', borderRadius: 6, fontSize: 12, color: '#94a3b8', lineHeight: 1.5 },
};
