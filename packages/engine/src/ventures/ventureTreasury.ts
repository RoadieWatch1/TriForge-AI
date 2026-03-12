// ── ventureTreasury.ts — Budget allocation for venture launch ────────────────
//
// Splits the user's total budget across launch setup, tools, ad/promo runway,
// and a mandatory reserve (>= 10%). Caps daily promo spend to prevent runaway.

import type { TreasuryAllocation, VentureCategory } from './ventureTypes';
import { getCategoryConfig } from './ventureCatalog';

/**
 * Allocate budget across launch categories.
 *
 * Split ratios:
 *   launchSetup:    35-45%  — domain, hosting, initial content creation
 *   tools:          15-20%  — subscriptions, email platform, analytics
 *   adPromoRunway:  25-30%  — paid promotion, ad credits, boosts
 *   reserve:        >= 10%  — buffer for unexpected costs
 *
 * maxDailyPromoSpend = adPromoRunway / 14 (two-week runway)
 */
export function allocateBudget(
  totalBudget: number,
  winnerCategory: VentureCategory,
): TreasuryAllocation {
  const cat = getCategoryConfig(winnerCategory);

  // Adjust ratios based on category characteristics
  const ratios = getCategoryRatios(winnerCategory, cat?.automationSuitability ?? 60);

  const launchSetup = Math.round(totalBudget * ratios.setup);
  const tools = Math.round(totalBudget * ratios.tools);
  const adPromoRunway = Math.round(totalBudget * ratios.promo);

  // Reserve = whatever is left, but at least 10%
  const minReserve = Math.round(totalBudget * 0.10);
  const computedReserve = totalBudget - launchSetup - tools - adPromoRunway;
  const reserve = Math.max(minReserve, computedReserve);

  // If reserve forced higher, trim promo first, then tools
  let finalPromo = adPromoRunway;
  let finalTools = tools;
  const overspend = (launchSetup + tools + adPromoRunway + reserve) - totalBudget;
  if (overspend > 0) {
    const promoTrim = Math.min(overspend, finalPromo - Math.round(totalBudget * 0.15));
    finalPromo -= Math.max(0, promoTrim);
    const remaining = overspend - Math.max(0, promoTrim);
    if (remaining > 0) {
      finalTools -= remaining;
    }
  }

  const maxDailyPromoSpend = Math.round(finalPromo / 14);

  const rationale = buildRationale(winnerCategory, totalBudget, launchSetup, finalTools, finalPromo, reserve);

  return {
    totalBudget,
    launchSetup,
    tools: Math.max(0, finalTools),
    adPromoRunway: Math.max(0, finalPromo),
    reserve,
    maxDailyPromoSpend: Math.max(1, maxDailyPromoSpend),
    rationale,
  };
}

// ── Category-specific ratios ─────────────────────────────────────────────────

interface BudgetRatios {
  setup: number;
  tools: number;
  promo: number;
}

function getCategoryRatios(category: VentureCategory, automationSuitability: number): BudgetRatios {
  // Higher automation = less setup, more promo
  // Lower automation = more setup, less promo

  switch (category) {
    // Content-heavy: low setup, heavy on promo
    case 'content_brand':
    case 'faceless_media':
    case 'newsletter':
      return { setup: 0.25, tools: 0.20, promo: 0.40 };

    // Product-based: more setup
    case 'digital_product':
    case 'saas_micro':
      return { setup: 0.40, tools: 0.20, promo: 0.25 };

    // E-commerce: balanced but higher setup
    case 'ecommerce_dropship':
      return { setup: 0.45, tools: 0.15, promo: 0.25 };

    // Service: minimal setup, invest in outreach
    case 'service_agency':
      return { setup: 0.30, tools: 0.15, promo: 0.40 };

    // SEO-driven: content investment
    case 'affiliate_niche':
      return { setup: 0.35, tools: 0.15, promo: 0.35 };

    // Community: platform setup + growth
    case 'community_membership':
      return { setup: 0.35, tools: 0.20, promo: 0.30 };

    // Local lead gen: ads-heavy
    case 'local_lead_gen':
      return { setup: 0.35, tools: 0.15, promo: 0.35 };

    default:
      return { setup: 0.35, tools: 0.18, promo: 0.30 };
  }
}

function buildRationale(
  category: VentureCategory,
  total: number,
  setup: number,
  tools: number,
  promo: number,
  reserve: number,
): string {
  const cat = getCategoryConfig(category);
  const label = cat?.label ?? category;
  const parts: string[] = [
    `Budget of $${total} allocated for ${label} venture:`,
    `- Launch setup ($${setup}): domain, hosting, initial content/assets`,
    `- Tools ($${tools}): email platform, analytics, essential subscriptions`,
    `- Ad/promo runway ($${promo}): paid promotion across ${cat?.trafficChannels.slice(0, 2).join(', ') ?? 'primary channels'}`,
    `- Reserve ($${reserve}): buffer for adjustments (${Math.round(reserve / total * 100)}% of total)`,
  ];
  return parts.join('\n');
}
