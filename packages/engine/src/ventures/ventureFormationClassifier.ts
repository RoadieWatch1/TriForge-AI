// ── ventureFormationClassifier.ts — Filing/formation need classifier ─────────
//
// Determines whether a venture can operate before formal legal filing,
// and what formation actions are recommended and when.
//
// Pre-filing OK: content brands, newsletters, blogs, faceless media,
//   simple lead-gen, digital product landing pages, audience-building media.
// Earlier filing needed: e-commerce with payment processing, B2B contracts,
//   ventures needing business bank accounts immediately.

import type { FormationDecision, VentureCategory, LaunchPack } from './ventureTypes';
import { getCategoryConfig } from './ventureCatalog';

/**
 * Classify the formation/filing needs for a venture option.
 * Returns a FormationDecision with recommendation, urgency, and reasoning.
 */
export function classifyFormationNeeds(
  category: VentureCategory,
  monetizationPath: string,
  launchPack?: LaunchPack,
): FormationDecision {
  const config = getCategoryConfig(category);
  const canOperate = config?.canOperateBeforeFiling ?? true;

  // Determine if entity is required before revenue
  const requiresEntity = needsEntityBeforeRevenue(category, monetizationPath);

  // Build reasoning
  if (!canOperate || requiresEntity) {
    return {
      canOperateBefore: false,
      recommendation: 'file_now',
      urgency: 'now',
      reason: buildFilingReason(category, 'file_now', monetizationPath),
      requiresEntityBeforeRevenue: true,
    };
  }

  // Check if monetization path suggests near-term filing
  if (suggestsNearTermFiling(monetizationPath, launchPack)) {
    return {
      canOperateBefore: true,
      recommendation: 'wait',
      urgency: 'soon',
      reason: buildFilingReason(category, 'wait_soon', monetizationPath),
      requiresEntityBeforeRevenue: false,
    };
  }

  // Default: can operate, filing not urgent
  return {
    canOperateBefore: true,
    recommendation: 'wait',
    urgency: 'later',
    reason: buildFilingReason(category, 'wait_later', monetizationPath),
    requiresEntityBeforeRevenue: false,
  };
}

// ── Internal helpers ─────────────────────────────────────────────────────────

function needsEntityBeforeRevenue(category: VentureCategory, monetization: string): boolean {
  // E-commerce and dropshipping need payment processing → need entity
  if (category === 'ecommerce_dropship') return true;

  // Local lead gen with contracts needs entity
  if (category === 'local_lead_gen') return true;

  // If monetization explicitly mentions contracts or invoicing
  const lower = monetization.toLowerCase();
  if (lower.includes('contract') || lower.includes('invoice') || lower.includes('b2b retainer')) {
    return true;
  }

  return false;
}

function suggestsNearTermFiling(monetization: string, launchPack?: LaunchPack): boolean {
  const lower = monetization.toLowerCase();

  // If they plan to sell products or services directly soon
  if (lower.includes('direct sales') || lower.includes('project fee')) return true;

  // If they plan paid subscriptions
  if (lower.includes('paid subscription') || lower.includes('membership fee')) return true;

  // If launch pack mentions taking payments in first week
  if (launchPack?.firstWeekPlan.some(step =>
    step.toLowerCase().includes('payment') || step.toLowerCase().includes('stripe')
  )) return true;

  return false;
}

function buildFilingReason(
  category: VentureCategory,
  scenario: 'file_now' | 'wait_soon' | 'wait_later',
  monetization: string,
): string {
  const config = getCategoryConfig(category);
  const label = config?.label ?? category;

  switch (scenario) {
    case 'file_now':
      return `${label} ventures typically need a business entity for payment processing, contracts, or compliance. Filing is recommended before accepting revenue.`;

    case 'wait_soon':
      return `${label} can start building audience and content without filing. However, the monetization path (${monetization}) will require an entity within a few weeks when you begin accepting payments.`;

    case 'wait_later':
      return `${label} ventures can validate audience, build traffic, and test market fit before formal filing. File when traction confirms the venture is worth formalizing — typically after the first 250+ subscribers or first revenue signal.`;
  }
}
