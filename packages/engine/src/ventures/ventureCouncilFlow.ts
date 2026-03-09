// ── ventureCouncilFlow.ts — Council tri-model venture decision flow ──────────
//
// Runs 3 providers in parallel with distinct roles (Strategist, Critic, Executor),
// then synthesizes a winner + 2 alternatives via gpt-4o-mini.
// Same Promise.allSettled pattern as chat:consensus.

import type {
  VentureCandidate, VentureOption, VentureProposal, VentureMode,
  TreasuryAllocation, FilingSummary, LaunchPack, WebsitePlan,
  LeadCapturePlan, FollowerGrowthPlan,
} from './ventureTypes';
import { getCategoryConfig } from './ventureCatalog';
import { classifyFormationNeeds } from './ventureFormationClassifier';
import { allocateBudget } from './ventureTreasury';

// ── Types ────────────────────────────────────────────────────────────────────

interface CouncilProvider {
  name: string;
  chat(messages: { role: string; content: string }[]): Promise<string>;
}

type ProgressPhase =
  | 'research_complete'
  | 'scoring_complete'
  | 'council_debating'
  | 'council_complete'
  | 'synthesis_complete';

type OnProgress = (phase: ProgressPhase, detail?: string) => void;

// ── Role prompts ─────────────────────────────────────────────────────────────

function strategistPrompt(candidates: VentureCandidate[], budget: number): string {
  return `You are the STRATEGIST in a venture council. Your job: pick the BEST venture opportunity from these candidates for someone with a $${budget} budget.

Candidates:
${formatCandidates(candidates)}

Analyze each candidate and select your TOP PICK. Return a JSON object:
{
  "pick": "<candidate id>",
  "ventureMode": "brand_build|fast_cash|authority_build|experimental|passive_engine",
  "whyNow": "why this venture right now",
  "confidence": 0-100,
  "risk": "low|low-medium|medium|medium-high|high",
  "timeToRevenue": "e.g. 2-4 weeks",
  "brandName": "suggested brand name",
  "tagline": "suggested tagline",
  "oneLinePitch": "one sentence pitch",
  "targetAudience": "who this serves",
  "monetizationPath": "how it makes money",
  "launchAngle": "how to launch",
  "contentAngle": "content strategy",
  "firstWeekActions": ["action 1", "action 2", "action 3"],
  "primaryCTA": "main call to action",
  "trafficChannels": ["channel 1", "channel 2"],
  "audienceGoal": "audience capture strategy"
}

Return ONLY valid JSON.`;
}

function criticPrompt(candidates: VentureCandidate[], budget: number): string {
  return `You are the CRITIC in a venture council. Your job: pick the SAFEST, most reliable venture from these candidates for someone with a $${budget} budget who wants low risk and steady returns.

Candidates:
${formatCandidates(candidates)}

Select the SAFEST option. Return a JSON object with the same format:
{
  "pick": "<candidate id>",
  "ventureMode": "brand_build|fast_cash|authority_build|experimental|passive_engine",
  "whyNow": "why this is the safe choice",
  "confidence": 0-100,
  "risk": "low|low-medium|medium|medium-high|high",
  "timeToRevenue": "e.g. 2-4 weeks",
  "brandName": "suggested brand name",
  "tagline": "suggested tagline",
  "oneLinePitch": "one sentence pitch",
  "targetAudience": "who this serves",
  "monetizationPath": "how it makes money",
  "launchAngle": "how to launch",
  "contentAngle": "content strategy",
  "firstWeekActions": ["action 1", "action 2", "action 3"],
  "primaryCTA": "main call to action",
  "trafficChannels": ["channel 1", "channel 2"],
  "audienceGoal": "audience capture strategy"
}

Return ONLY valid JSON.`;
}

function executorPrompt(candidates: VentureCandidate[], budget: number): string {
  return `You are the EXECUTOR in a venture council. Your job: pick the most AGGRESSIVE, high-upside venture from these candidates for someone with a $${budget} budget who wants maximum growth potential.

Candidates:
${formatCandidates(candidates)}

Select the most AGGRESSIVE option. Return a JSON object with the same format:
{
  "pick": "<candidate id>",
  "ventureMode": "brand_build|fast_cash|authority_build|experimental|passive_engine",
  "whyNow": "why this has the highest upside",
  "confidence": 0-100,
  "risk": "low|low-medium|medium|medium-high|high",
  "timeToRevenue": "e.g. 2-4 weeks",
  "brandName": "suggested brand name",
  "tagline": "suggested tagline",
  "oneLinePitch": "one sentence pitch",
  "targetAudience": "who this serves",
  "monetizationPath": "how it makes money",
  "launchAngle": "how to launch",
  "contentAngle": "content strategy",
  "firstWeekActions": ["action 1", "action 2", "action 3"],
  "primaryCTA": "main call to action",
  "trafficChannels": ["channel 1", "channel 2"],
  "audienceGoal": "audience capture strategy"
}

Return ONLY valid JSON.`;
}

// ── Main flow ────────────────────────────────────────────────────────────────

/**
 * Run the venture council: 3 providers debate candidates, synthesize proposal.
 */
export async function runVentureCouncil(
  candidates: VentureCandidate[],
  budget: number,
  providers: CouncilProvider[],
  onProgress?: OnProgress,
): Promise<VentureProposal> {
  if (providers.length < 1) throw new Error('At least one provider required');

  const top8 = candidates.slice(0, 8);

  onProgress?.('council_debating');

  // ── Assign roles (3 providers = 3 roles; fewer = reuse first provider) ────
  const strategist = providers[0];
  const critic = providers[Math.min(1, providers.length - 1)];
  const executor = providers[Math.min(2, providers.length - 1)];

  // ── Run all 3 in parallel ─────────────────────────────────────────────────
  const [stratResult, critResult, execResult] = await Promise.allSettled([
    strategist.chat([
      { role: 'system', content: 'You are a venture strategist. Return only valid JSON.' },
      { role: 'user', content: strategistPrompt(top8, budget) },
    ]),
    critic.chat([
      { role: 'system', content: 'You are a venture risk analyst. Return only valid JSON.' },
      { role: 'user', content: criticPrompt(top8, budget) },
    ]),
    executor.chat([
      { role: 'system', content: 'You are an aggressive growth executor. Return only valid JSON.' },
      { role: 'user', content: executorPrompt(top8, budget) },
    ]),
  ]);

  onProgress?.('council_complete');

  // ── Parse responses ───────────────────────────────────────────────────────
  const winnerPick = parseCouncilResponse(stratResult, top8);
  const saferPick = parseCouncilResponse(critResult, top8);
  const aggressivePick = parseCouncilResponse(execResult, top8);

  // Ensure all 3 are distinct candidates where possible
  const picks = deduplicatePicks(winnerPick, saferPick, aggressivePick, top8);

  // ── Build venture options with formation classification ────────────────────
  const winnerOption = buildVentureOption(picks.winner, budget, 'winner');
  const saferOption = buildVentureOption(picks.safer, budget, 'safer');
  const aggressiveOption = buildVentureOption(picks.aggressive, budget, 'aggressive');

  // ── Treasury allocation for winner ────────────────────────────────────────
  const treasury = allocateBudget(budget, winnerOption.candidate.category);

  // ── Build council rationale ───────────────────────────────────────────────
  const rationale = buildRationale(winnerOption, saferOption, aggressiveOption);

  // ── Filing summary based on winner ────────────────────────────────────────
  const filingSummary: FilingSummary = {
    recommended: winnerOption.filingRecommendation === 'file_now',
    urgency: winnerOption.filingUrgency,
    reason: winnerOption.filingReason,
  };

  onProgress?.('synthesis_complete');

  return {
    id: `vp-${Date.now()}`,
    timestamp: Date.now(),
    status: 'awaiting_user_approval',
    winner: winnerOption,
    safer: saferOption,
    aggressive: aggressiveOption,
    treasuryAllocation: treasury,
    councilRationale: rationale,
    filingSummary,
  };
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatCandidates(candidates: VentureCandidate[]): string {
  return candidates.map(c =>
    `ID: ${c.id}\nCategory: ${c.category}\nConcept: ${c.concept}\nTrend: ${c.trendClass}\nComposite Score: ${c.scores.composite}/100\nSignals: ${c.signals.length}`
  ).join('\n\n');
}

interface CouncilPick {
  candidate: VentureCandidate;
  raw: Record<string, unknown>;
}

function parseCouncilResponse(
  result: PromiseSettledResult<string>,
  candidates: VentureCandidate[],
): CouncilPick {
  if (result.status === 'rejected') {
    // Fallback to first candidate
    return { candidate: candidates[0], raw: {} };
  }

  try {
    const jsonMatch = result.value.match(/\{[\s\S]*\}/);
    if (!jsonMatch) return { candidate: candidates[0], raw: {} };

    const parsed = JSON.parse(jsonMatch[0]);
    const pickId = parsed.pick;

    const matched = candidates.find(c => c.id === pickId) ?? candidates[0];
    return { candidate: matched, raw: parsed };
  } catch {
    return { candidate: candidates[0], raw: {} };
  }
}

function deduplicatePicks(
  winner: CouncilPick,
  safer: CouncilPick,
  aggressive: CouncilPick,
  candidates: VentureCandidate[],
): { winner: CouncilPick; safer: CouncilPick; aggressive: CouncilPick } {
  const used = new Set<string>([winner.candidate.id]);

  // If safer picks same as winner, find next best
  if (used.has(safer.candidate.id)) {
    const alt = candidates.find(c => !used.has(c.id));
    if (alt) safer = { candidate: alt, raw: safer.raw };
  }
  used.add(safer.candidate.id);

  // If aggressive picks same as either, find next best
  if (used.has(aggressive.candidate.id)) {
    const alt = candidates.find(c => !used.has(c.id));
    if (alt) aggressive = { candidate: alt, raw: aggressive.raw };
  }

  return { winner, safer, aggressive };
}

function buildVentureOption(pick: CouncilPick, budget: number, role: string): VentureOption {
  const r = pick.raw as Record<string, unknown>;
  const cat = getCategoryConfig(pick.candidate.category);

  const monetizationPath = String(r.monetizationPath ?? cat?.monetizationPaths[0] ?? 'Direct sales');

  // Formation classification
  const formation = classifyFormationNeeds(
    pick.candidate.category,
    monetizationPath,
  );

  const brandName = String(r.brandName ?? `${pick.candidate.category}-venture`);
  const tagline = String(r.tagline ?? '');
  const primaryCTA = String(r.primaryCTA ?? 'Get Started');

  const websitePlan: WebsitePlan = {
    siteType: cat?.recommendedSiteType ?? 'landing_page',
    requiredPages: ['home', 'about', 'offer'],
    primaryCTA,
    secondaryCTA: 'Learn More',
    structure: 'Single page with capture form',
  };

  const leadCapturePlan: LeadCapturePlan = {
    captureType: cat?.recommendedCaptureMethod ?? 'email_signup',
    leadMagnetType: 'Free guide or checklist',
    signupCTA: primaryCTA,
    estimatedConversionRate: 0.05,
  };

  const followerGrowthPlan: FollowerGrowthPlan = {
    primaryGoal: String(r.audienceGoal ?? 'Build initial subscriber base'),
    captureMethod: cat?.recommendedCaptureMethod ?? 'email_signup',
    first30DayTarget: 250,
    channels: (r.trafficChannels as string[]) ?? cat?.trafficChannels ?? [],
  };

  const launchPack: LaunchPack = {
    brandName,
    logoConceptDescription: `Clean, modern logo for ${brandName}`,
    tagline,
    oneLinePitch: String(r.oneLinePitch ?? pick.candidate.concept),
    targetAudience: String(r.targetAudience ?? 'Online entrepreneurs'),
    positioning: `The go-to resource for ${pick.candidate.concept}`,
    monetizationPath,
    launchAngle: String(r.launchAngle ?? 'Content-first launch'),
    contentAngle: String(r.contentAngle ?? 'Educational content'),
    firstWeekPlan: (r.firstWeekActions as string[]) ?? ['Set up brand', 'Build landing page', 'Create first content'],
    brandVoice: 'Professional, approachable, authoritative',
    colorDirection: 'Modern, clean palette',
    homepageHeroCopy: String(r.oneLinePitch ?? pick.candidate.concept),
    websitePlan,
    leadCapturePlan,
    followerGrowthPlan,
    seoSeedTopics: [pick.candidate.concept, pick.candidate.category],
    firstTrafficChannels: (r.trafficChannels as string[]) ?? cat?.trafficChannels ?? [],
    firstOffer: monetizationPath,
  };

  return {
    candidate: pick.candidate,
    ventureMode: (r.ventureMode as VentureMode) ?? pick.candidate.ventureMode,
    whyNow: String(r.whyNow ?? 'Market signals indicate strong timing'),
    confidenceScore: typeof r.confidence === 'number' ? r.confidence : 70,
    startupRisk: (r.risk as VentureOption['startupRisk']) ?? 'medium',
    timeToFirstRevenue: String(r.timeToRevenue ?? cat?.timeToFirstRevenue ?? '4-8 weeks'),
    dailyPromotionFit: cat?.dailyPromoSuitability ?? 60,
    launchPack,
    websiteStrategy: {
      siteType: cat?.recommendedSiteType ?? 'landing_page',
      requiredPages: websitePlan.requiredPages,
      primaryCTA,
    },
    audienceStrategy: {
      primaryGoal: followerGrowthPlan.primaryGoal,
      captureMethod: followerGrowthPlan.captureMethod,
    },
    trafficPlan: {
      channels: followerGrowthPlan.channels,
      first14DayPush: `Launch on ${followerGrowthPlan.channels.slice(0, 2).join(' and ')} with daily content`,
    },
    formationMode: formation.canOperateBefore ? 'test_mode_unfiled' : 'file_on_approval',
    canOperateBeforeFiling: formation.canOperateBefore,
    filingRecommendation: formation.recommendation,
    filingUrgency: formation.urgency,
    filingReason: formation.reason,
    requiresEntityBeforeRevenue: formation.requiresEntityBeforeRevenue,
  };
}

function buildRationale(
  winner: VentureOption,
  safer: VentureOption,
  aggressive: VentureOption,
): string {
  return [
    `**Winner: ${winner.launchPack.brandName}** (${winner.candidate.category}) — ${winner.whyNow}`,
    `Confidence: ${winner.confidenceScore}% | Risk: ${winner.startupRisk} | Revenue: ${winner.timeToFirstRevenue}`,
    '',
    `**Safer Alternative: ${safer.launchPack.brandName}** (${safer.candidate.category}) — lower risk, steady path`,
    `**Aggressive Alternative: ${aggressive.launchPack.brandName}** (${aggressive.candidate.category}) — higher upside, more execution`,
    '',
    `Filing: ${winner.canOperateBeforeFiling ? 'Can operate before filing' : 'Filing recommended before launch'}`,
    winner.filingReason,
  ].join('\n');
}
