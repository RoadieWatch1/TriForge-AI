// ── ventureFilingPrep.ts — Filing packet preparation ─────────────────────────
//
// Prepares filing packets (EIN application, state registration) for review.
// filing_prepared ≠ filed. Actual submission is a separate gated step.
// Council prepares everything, user explicitly authorizes submission,
// and filed_and_operating only after confirmation.

import type {
  VentureOption, FounderProfile, FilingPacket, FilingSummary, FormationDecision,
} from './ventureTypes';
import { getCategoryConfig } from './ventureCatalog';

interface FilingProvider {
  chat(messages: { role: string; content: string }[]): Promise<string>;
}

/**
 * Prepare a filing packet for a venture.
 * Returns all documents and requirements needed for filing — but does NOT submit.
 * AI-assisted with deterministic fallback.
 */
export async function prepareFilingPacket(
  option: VentureOption,
  founderProfile: FounderProfile,
  provider?: FilingProvider,
): Promise<FilingPacket> {
  if (provider) {
    try {
      return await aiPreparePacket(option, founderProfile, provider);
    } catch {
      // Fall through to deterministic
    }
  }
  return deterministicPacket(option, founderProfile);
}

/**
 * Summarize the filing need for a venture option.
 * Pure function — used for display in proposals and phone notifications.
 */
export function summarizeFilingNeed(
  option: VentureOption,
  formationDecision: FormationDecision,
): FilingSummary {
  return {
    recommended: formationDecision.recommendation === 'file_now',
    urgency: formationDecision.urgency,
    reason: formationDecision.reason,
  };
}

// ── AI-assisted packet preparation ───────────────────────────────────────────

async function aiPreparePacket(
  option: VentureOption,
  founder: FounderProfile,
  provider: FilingProvider,
): Promise<FilingPacket> {
  const cat = getCategoryConfig(option.candidate.category);
  const state = founder.state ?? 'the founder\'s state';

  const prompt = `You are a business formation specialist. Prepare a filing summary for a new venture.

Venture: ${option.candidate.concept}
Category: ${cat?.label ?? option.candidate.category}
Monetization: ${option.launchPack.monetizationPath}
State: ${state}
Founder entity preference: ${founder.preferredEntityType ?? 'no preference'}
Can operate before filing: ${option.canOperateBeforeFiling}

Return a JSON object:
{
  "entityType": "LLC|S-Corp|Sole Proprietorship|C-Corp",
  "einReady": true/false,
  "stateFilingReady": true/false,
  "requirements": ["requirement 1", "requirement 2"],
  "suggestedTiming": "when to file",
  "preparedDocuments": ["document 1", "document 2"]
}

Rules:
- For most small online ventures, LLC is the default recommendation
- EIN is ready if we have founder name + address
- State filing readiness depends on having all required founder info
- Requirements should list what the founder still needs to provide
- Suggested timing should consider the venture's operational needs

Return ONLY valid JSON.`;

  const response = await provider.chat([
    { role: 'system', content: 'You are a business formation specialist. Return only valid JSON.' },
    { role: 'user', content: prompt },
  ]);

  const jsonMatch = response.match(/\{[\s\S]*\}/);
  if (!jsonMatch) throw new Error('No JSON in response');

  const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

  return {
    entityType: String(parsed.entityType ?? recommendEntityType(option)),
    einReady: Boolean(parsed.einReady ?? hasMinimumForEIN(founder)),
    stateFilingReady: Boolean(parsed.stateFilingReady ?? isStateFilingReady(founder)),
    requirements: asStringArray(parsed.requirements) ?? getRequirements(founder, option),
    suggestedTiming: String(parsed.suggestedTiming ?? getSuggestedTiming(option)),
    preparedDocuments: asStringArray(parsed.preparedDocuments) ?? getPreparedDocuments(founder, option),
  };
}

// ── Deterministic packet ─────────────────────────────────────────────────────

function deterministicPacket(
  option: VentureOption,
  founder: FounderProfile,
): FilingPacket {
  return {
    entityType: recommendEntityType(option),
    einReady: hasMinimumForEIN(founder),
    stateFilingReady: isStateFilingReady(founder),
    requirements: getRequirements(founder, option),
    suggestedTiming: getSuggestedTiming(option),
    preparedDocuments: getPreparedDocuments(founder, option),
  };
}

// ── Entity type recommendation ───────────────────────────────────────────────

function recommendEntityType(option: VentureOption): string {
  // Sole prop for very small/testing ventures
  if (option.formationMode === 'test_mode_unfiled') return 'Sole Proprietorship';

  // SaaS and service with contracts → LLC
  if (['saas_micro', 'service_agency'].includes(option.candidate.category)) return 'LLC';

  // E-commerce → LLC for liability protection
  if (option.candidate.category === 'ecommerce_dropship') return 'LLC';

  // Default for anything seeking revenue → LLC
  if (option.requiresEntityBeforeRevenue) return 'LLC';

  return 'LLC';
}

// ── Readiness checks ─────────────────────────────────────────────────────────

function hasMinimumForEIN(founder: FounderProfile): boolean {
  return Boolean(founder.legalName && founder.address);
}

function isStateFilingReady(founder: FounderProfile): boolean {
  return Boolean(
    founder.legalName &&
    founder.address &&
    founder.state &&
    founder.phone &&
    founder.email
  );
}

// ── Requirements ─────────────────────────────────────────────────────────────

function getRequirements(founder: FounderProfile, option: VentureOption): string[] {
  const reqs: string[] = [];

  if (!founder.legalName) reqs.push('Legal name of the business owner');
  if (!founder.address) reqs.push('Business or home address for filing');
  if (!founder.state) reqs.push('State of formation');
  if (!founder.phone) reqs.push('Phone number for IRS/state contact');
  if (!founder.email) reqs.push('Email address for filing correspondence');

  if (option.candidate.category === 'ecommerce_dropship') {
    reqs.push('Sales tax nexus determination for your state');
  }

  if (reqs.length === 0) {
    reqs.push('All required information is on file — ready for filing preparation');
  }

  return reqs;
}

// ── Timing ───────────────────────────────────────────────────────────────────

function getSuggestedTiming(option: VentureOption): string {
  if (!option.canOperateBeforeFiling) {
    return 'File before launch — entity needed for payment processing and contracts.';
  }

  if (option.filingUrgency === 'soon') {
    return 'File within 2-4 weeks — before first revenue event to avoid personal liability exposure.';
  }

  return 'File when traction confirms viability — after reaching 250+ subscribers or first revenue signal. No urgency if operating as content/media brand.';
}

// ── Prepared documents ───────────────────────────────────────────────────────

function getPreparedDocuments(founder: FounderProfile, option: VentureOption): string[] {
  const docs: string[] = [];
  const entityType = recommendEntityType(option);

  if (hasMinimumForEIN(founder)) {
    docs.push('EIN Application (IRS Form SS-4) — pre-filled, ready for review');
  }

  if (entityType === 'LLC') {
    docs.push('Articles of Organization — template prepared for state filing');
    docs.push('Operating Agreement — single-member LLC template');
  }

  if (isStateFilingReady(founder)) {
    docs.push(`State Registration — ${founder.state ?? 'state'} filing form pre-filled`);
  }

  docs.push('Business address documentation');
  docs.push('Registered agent designation (self or service)');

  return docs;
}

function asStringArray(val: unknown): string[] | null {
  if (!Array.isArray(val)) return null;
  const filtered = val.filter((v): v is string => typeof v === 'string');
  return filtered.length > 0 ? filtered : null;
}
