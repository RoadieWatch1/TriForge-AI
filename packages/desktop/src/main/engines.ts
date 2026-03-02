// ── Forge Engine Configs ────────────────────────────────────────────────────
// Business engine definitions for Engine Mode (Phase 1).
// Each engine drives: onboarding questions → AI generation → structured output.
// Kept separate from profiles.ts so engines scale to 15+ without coupling.

export type EngineProfileType = 'saas' | 'realestate' | 'restaurant';

export interface EngineConfig {
  id: EngineProfileType;
  name: string;
  systemPrompt: string;
  promptTemplate: (answers: Record<string, string>) => string;
}

const saasEngine: EngineConfig = {
  id: 'saas',
  name: 'SaaS Builder',
  systemPrompt:
    'You are a world-class SaaS startup strategist and product architect. Your outputs are precise, structured, and actionable. Respond ONLY with a valid JSON object — no prose, no markdown fences, no preamble.',
  promptTemplate: (answers) => `
You are building a SaaS product. Use the following inputs to generate a full business engine output.

Inputs:
- Problem being solved: ${answers.problem}
- Target audience: ${answers.audience}
- App type: ${answers.appType}
- Pricing model: ${answers.pricing}

Return a single JSON object with EXACTLY this structure:
{
  "blueprint": {
    "businessIdea": "One clear sentence describing the SaaS product and the problem it solves.",
    "targetMarket": "Specific description of the target user segment, their pain points, and why they will pay.",
    "revenueModel": "Detailed pricing strategy: tiers, amounts, what's included, upsell path.",
    "strategy": "Go-to-market approach: acquisition channels, launch sequence, first 90 days."
  },
  "assets": [
    "Cold email outreach template for [target audience]",
    "LinkedIn post announcing the product launch",
    "Google Ads headline and description copy",
    "Product Hunt launch day post draft",
    "Onboarding email sequence subject lines (5 emails)"
  ],
  "buildOutput": {
    "screens": ["Screen 1: Landing page with hero + CTA", "Screen 2: Signup / onboarding flow", "Screen 3: Dashboard — primary feature view", "Screen 4: Settings + billing", "Screen 5: Usage / analytics view"],
    "apiRoutes": ["POST /auth/register", "POST /auth/login", "GET /api/user", "GET /api/dashboard", "POST /api/subscribe", "DELETE /api/account"],
    "dbSchema": ["users (id, email, password_hash, plan, created_at)", "subscriptions (id, user_id, plan, status, expires_at)", "usage_events (id, user_id, event_type, metadata, created_at)"]
  }
}

Tailor all content specifically to the inputs above. Be specific, not generic.`.trim(),
};

const realestateEngine: EngineConfig = {
  id: 'realestate',
  name: 'Real Estate Growth',
  systemPrompt:
    'You are an elite real estate business strategist specializing in lead generation, conversion, and scaling. Respond ONLY with a valid JSON object — no prose, no markdown fences, no preamble.',
  promptTemplate: (answers) => `
You are building a real estate growth engine. Use the following inputs.

Inputs:
- City / market: ${answers.city}
- Focus area: ${answers.focus}
- Target price range: ${answers.priceRange}

Return a single JSON object with EXACTLY this structure:
{
  "blueprint": {
    "businessIdea": "One sentence describing this real estate business model and the specific market opportunity.",
    "targetMarket": "Precise profile of the ideal client: demographics, motivations, objections, and buying timeline.",
    "revenueModel": "How this business generates revenue: transaction fees, retainer structures, referral income, repeat client value.",
    "strategy": "Lead generation strategy, nurture funnel, conversion approach, and 90-day growth plan."
  },
  "assets": [
    "Cold outreach script for targeting ${answers.focus}s in ${answers.city}",
    "Social media post series for establishing local market authority",
    "Email drip sequence for new leads (subject lines for 5 emails)",
    "Listing presentation talking points for the ${answers.priceRange} range",
    "Google Ads copy targeting ${answers.city} ${answers.focus}s"
  ],
  "buildOutput": {
    "funnelSteps": [
      "Awareness: Targeted Facebook/Google ads + local content marketing",
      "Lead capture: Landing page with home valuation tool or buyer guide CTA",
      "Qualification: 5-question intake form to identify timeline and motivation",
      "Nurture: Automated email sequence (7 emails over 30 days)",
      "Consultation: 30-minute strategy call booking via Calendly",
      "Close: Signed buyer/seller agreement within 48 hours of consultation"
    ],
    "crmStructure": [
      "Contact record: name, email, phone, lead source, price range, timeline",
      "Pipeline stages: New Lead → Contacted → Qualified → Active → Under Contract → Closed",
      "Automated follow-up triggers: no contact in 3 days, 7 days, 30 days",
      "Tags: buyer, seller, investor, referral, hot-lead, long-term",
      "Monthly reporting: leads in, contacts made, consultations booked, deals closed"
    ]
  }
}

Tailor all content specifically to ${answers.city}, ${answers.focus}s, and the ${answers.priceRange} price range.`.trim(),
};

const restaurantEngine: EngineConfig = {
  id: 'restaurant',
  name: 'Restaurant Growth',
  systemPrompt:
    'You are a restaurant operations and growth strategist. You specialize in menu engineering, local marketing, and profitability systems. Respond ONLY with a valid JSON object — no prose, no markdown fences, no preamble.',
  promptTemplate: (answers) => `
You are building a restaurant growth engine. Use the following inputs.

Inputs:
- Cuisine type: ${answers.cuisine}
- Location / city: ${answers.location}
- Service type: ${answers.serviceType}

Return a single JSON object with EXACTLY this structure:
{
  "blueprint": {
    "businessIdea": "One sentence describing this restaurant concept, cuisine, and service model.",
    "targetMarket": "Specific customer profile: who visits, why, how often, average spend, and what drives loyalty.",
    "revenueModel": "Revenue streams: dine-in covers, ${answers.serviceType === 'takeout' ? 'delivery and takeout orders' : 'private events and catering'}, upsell strategy, loyalty mechanics.",
    "strategy": "Local marketing approach, grand opening plan, repeat visit strategy, and 90-day revenue ramp."
  },
  "assets": [
    "Google Business Profile post announcing the restaurant",
    "Instagram caption series for ${answers.cuisine} food photography (5 posts)",
    "Yelp response template for 5-star and 1-star reviews",
    "Email to local businesses proposing group lunch or catering partnership",
    "Flyer copy for ${answers.serviceType} promotion targeting ${answers.location} residents"
  ],
  "buildOutput": {
    "menu": [
      "Appetizers (3–4 items): high-margin starters that pair with drinks",
      "Mains (6–8 items): Stars = your signature ${answers.cuisine} dishes with 65%+ margin",
      "Sides (3–4 items): sharable, low food cost, high attachment rate",
      "Desserts (2–3 items): simple, high margin, brand-reinforcing",
      "Drinks: house cocktails/mocktails + local beer/wine pairings"
    ],
    "pricing": [
      "Appetizers: $8–$14 (food cost target: 22–28%)",
      "Mains: $16–$32 (food cost target: 28–34%)",
      "Sides: $5–$9 (food cost target: 18–24%)",
      "Desserts: $7–$12 (food cost target: 20–26%)",
      "Prime cost target (food + labor): below 65% of revenue"
    ],
    "landingPageSections": [
      "Hero: restaurant name + tagline + ${answers.serviceType} CTA button",
      "About: 2-sentence story — cuisine origin, chef background, location",
      "Menu highlights: 3 signature dishes with photo + price",
      "Hours + location: embedded map, hours table, parking note",
      "Order / Reserve CTA: online ordering link or OpenTable embed",
      "Reviews: 3 featured Google/Yelp quotes with star rating"
    ]
  }
}

Tailor all content specifically to ${answers.cuisine} cuisine in ${answers.location} with ${answers.serviceType} service.`.trim(),
};

export const ENGINE_CONFIGS: Record<EngineProfileType, EngineConfig> = {
  saas: saasEngine,
  realestate: realestateEngine,
  restaurant: restaurantEngine,
};

export function getEngineConfig(type: EngineProfileType): EngineConfig {
  return ENGINE_CONFIGS[type];
}
