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
    'You are a world-class SaaS startup CTO and go-to-market strategist. You produce precise, technical, immediately actionable output. Every field must contain real content — actual copy, actual routes, actual schema — not descriptions of what content should go there. Respond ONLY with a valid JSON object — no prose, no markdown fences, no preamble.',
  promptTemplate: (answers) => `
Build a complete SaaS launch package for the following product.

Inputs:
- Problem being solved: ${answers.problem}
- Target audience: ${answers.audience}
- App type: ${answers.appType}
- Pricing model: ${answers.pricing}

Return a single JSON object with EXACTLY this structure. Every string value must be fully written-out content, not a placeholder or label:

{
  "blueprint": {
    "businessIdea": "One sharp sentence naming the product, the exact problem it eliminates, and who it's for — written as a founding pitch, not a description.",
    "targetMarket": "3–4 sentences: specific job title or life situation, the exact workflow they currently use that is broken, the emotional cost of that pain, and what motivates them to pay $X/month to fix it.",
    "revenueModel": "Name each pricing tier with a dollar amount (e.g. Starter $29/mo, Pro $79/mo, Business $199/mo). List exactly what's included per tier. Describe the upsell trigger — the usage event or feature gate that converts Starter → Pro. State estimated LTV and target churn rate.",
    "strategy": "Name the 2 primary acquisition channels with specific tactics for each. State the launch sequence: what ships on day 1, what ships in week 2, what milestone triggers the first paid campaign. Give the 90-day revenue target and the leading metric to track it."
  },
  "assets": [
    "COLD EMAIL — Subject: [write the subject line]. Body: [write the full 5–7 sentence cold email ready to send to ${answers.audience}, referencing ${answers.problem}, ending with a specific CTA]",
    "LINKEDIN POST — [write the full LinkedIn post, 150–200 words, opening with a hook about ${answers.problem}, sharing the insight that led to building this, ending with a CTA to try or follow]",
    "GOOGLE ADS — Headline 1: [max 30 chars] | Headline 2: [max 30 chars] | Headline 3: [max 30 chars] | Description 1: [max 90 chars] | Description 2: [max 90 chars]",
    "PRODUCT HUNT LAUNCH — Tagline: [write it, max 60 chars] | Description: [write the full 200-word Product Hunt description opening with the problem and ending with what makes this different]",
    "ONBOARDING EMAIL SEQUENCE — Email 1 Subject: [write it] | Email 2 Subject: [write it] | Email 3 Subject: [write it] | Email 4 Subject: [write it] | Email 5 Subject: [write it] — each subject line written to maximize open rate for a ${answers.audience} user who just signed up"
  ],
  "buildOutput": {
    "techStack": [
      "Frontend: [specific framework + reason — e.g. Next.js 14 (App Router) — SSR for SEO, fast initial load, React Server Components reduce JS bundle]",
      "Backend: [specific runtime + framework — e.g. Node.js + Fastify — lightweight, schema validation built-in, 3x faster than Express for API-heavy workloads]",
      "Database: [specific DB + ORM — e.g. PostgreSQL + Prisma — ACID compliance for billing data, type-safe queries, migration history]",
      "Auth: [specific solution — e.g. Clerk — handles OAuth, MFA, session management; cuts auth build time from 3 weeks to 1 day]",
      "Payments: [specific solution — e.g. Stripe Billing — subscription lifecycle, proration, webhooks for seat changes]",
      "Hosting: [specific platform — e.g. Vercel (frontend) + Railway (API + DB) — zero-config deploys, preview environments per PR]"
    ],
    "apiRoutes": [
      "POST /auth/register → creates user record, triggers welcome email, returns JWT + refresh token",
      "POST /auth/login → validates credentials, returns JWT (15min) + refresh token (30d), logs login event",
      "POST /auth/refresh → exchanges refresh token for new JWT, rotates refresh token",
      "GET /api/me → returns authenticated user profile, plan, usage stats",
      "PATCH /api/me → updates name, email (triggers re-verify), timezone, notification prefs",
      "GET /api/dashboard → returns aggregated usage data, feature usage metrics, last 30d activity",
      "POST /api/subscribe → creates Stripe subscription, stores plan in DB, emits plan:upgraded event",
      "POST /api/subscribe/cancel → schedules cancellation at period end, triggers retention email",
      "GET /api/usage → returns current period usage vs plan limits",
      "DELETE /api/account → soft-deletes user, cancels subscription, queues data export email"
    ],
    "dbSchema": [
      "users: id UUID PK, email VARCHAR UNIQUE NOT NULL, password_hash VARCHAR, name VARCHAR, plan ENUM('free','starter','pro','business') DEFAULT 'free', plan_expires_at TIMESTAMPTZ, stripe_customer_id VARCHAR UNIQUE, created_at TIMESTAMPTZ DEFAULT NOW(), last_active_at TIMESTAMPTZ",
      "subscriptions: id UUID PK, user_id UUID FK→users, stripe_subscription_id VARCHAR UNIQUE, plan VARCHAR NOT NULL, status ENUM('active','past_due','canceled','trialing'), current_period_start TIMESTAMPTZ, current_period_end TIMESTAMPTZ, cancel_at_period_end BOOLEAN DEFAULT false",
      "usage_events: id UUID PK, user_id UUID FK→users, event_type VARCHAR NOT NULL, metadata JSONB, created_at TIMESTAMPTZ DEFAULT NOW() — INDEX on (user_id, event_type, created_at)",
      "api_keys: id UUID PK, user_id UUID FK→users, key_hash VARCHAR UNIQUE NOT NULL, label VARCHAR, last_used_at TIMESTAMPTZ, expires_at TIMESTAMPTZ, revoked_at TIMESTAMPTZ"
    ]
  }
}

Every value must be written as final, production-ready content specific to: ${answers.problem} / ${answers.audience} / ${answers.appType} / ${answers.pricing} pricing. Do not use placeholder brackets in the final output.`.trim(),
};

const realestateEngine: EngineConfig = {
  id: 'realestate',
  name: 'Real Estate Growth',
  systemPrompt:
    'You are an elite real estate growth operator who has personally closed 200+ deals and built lead systems that generate 50+ qualified leads per month. You produce aggressive, numbers-driven, immediately deployable output. Every asset must be a word-for-word script or copy block — not a description of one. Respond ONLY with a valid JSON object — no prose, no markdown fences, no preamble.',
  promptTemplate: (answers) => `
Build a complete real estate growth engine for the following operator.

Inputs:
- City / market: ${answers.city}
- Focus area: ${answers.focus}
- Target price range: ${answers.priceRange}

Return a single JSON object with EXACTLY this structure. Every string must be fully written content, not a template label:

{
  "blueprint": {
    "businessIdea": "One aggressive sentence describing the exact market position: who you serve, what you do for them, and why you win in ${answers.city} at the ${answers.priceRange} price point.",
    "targetMarket": "Precise profile with specifics: age range, household income, neighborhood or zip code clusters in ${answers.city}, the triggering life event that puts them in the market (job change, divorce, growing family, retirement), their biggest fear about the process, and their timeline from first contact to signed contract.",
    "revenueModel": "State the average commission per transaction at ${answers.priceRange}. State the target deal volume: X deals/month, Y GCI/month. Break down income by source: buyer side, listing side, referral splits, repeat clients. State the unit economics: cost per lead, cost per closed deal, ROI target on ad spend.",
    "strategy": "Lead gen: name the 2 specific channels with monthly budget, expected lead volume, and cost-per-lead for each. Conversion: state the contact-to-consultation rate target (e.g. 30%), consultation-to-signed rate (e.g. 60%), days-to-close average. 90-day plan: week 1 actions, month 1 milestone (e.g. 10 leads in pipeline), month 3 milestone (e.g. first 2 deals closed)."
  },
  "assets": [
    "COLD CALL SCRIPT — Opening: [write the exact 2-sentence opener for calling ${answers.focus}s in ${answers.city}] | Pain bridge: [write the 2-sentence pain acknowledgment] | Value statement: [write the 1-sentence value prop specific to ${answers.priceRange} ${answers.focus}s] | Qualification question: [write the 1 question to identify timeline] | Close: [write the exact ask to book a 15-minute call] | Objection — 'I already have an agent': [write the 2-sentence response]",
    "FACEBOOK AD COPY — Primary text: [write the full 100-word Facebook ad body targeting ${answers.focus}s in ${answers.city} at ${answers.priceRange}, opening with a pattern interrupt, including a specific proof point, ending with CTA] | Headline: [max 40 chars] | Description: [max 30 chars]",
    "5-EMAIL DRIP SEQUENCE — Email 1 (Day 0) Subject: [write it] + first line: [write the opening sentence] | Email 2 (Day 3) Subject: [write it] + first line: [write the opening sentence] | Email 3 (Day 7) Subject: [write it] + first line: [write the opening sentence] | Email 4 (Day 14) Subject: [write it] + first line: [write the opening sentence] | Email 5 (Day 30) Subject: [write it] + first line: [write the opening sentence]",
    "LISTING PRESENTATION OPENER — [Write the exact 3-paragraph verbal opening for a listing appointment with a ${answers.priceRange} ${answers.focus} in ${answers.city}: paragraph 1 establishes credibility with a specific number, paragraph 2 identifies their likely concern, paragraph 3 states your unique process]",
    "GOOGLE ADS — Headline 1: [max 30 chars, location-specific] | Headline 2: [max 30 chars, audience-specific] | Headline 3: [max 30 chars, CTA] | Description 1: [max 90 chars with proof point] | Description 2: [max 90 chars with differentiator]"
  ],
  "buildOutput": {
    "funnelSteps": [
      "AWARENESS — Channel: [specific channel name]. Ad format: [specific format]. Budget: $[amount]/mo. Targeting: [specific audience criteria for ${answers.city} ${answers.focus}s]. Expected impressions: [number]/mo. Expected leads: [number]/mo at $[CPL].",
      "LEAD CAPTURE — Landing page headline: [write it]. Primary CTA: [write it]. Lead magnet: [name the specific offer — e.g. 'Free ${answers.city} ${answers.priceRange} Market Report']. Form fields: [list exactly which fields to ask — fewer = higher conversion]. Expected conversion rate: [X]%.",
      "QUALIFICATION — Intake form question 1: [write it] | Question 2: [write it] | Question 3: [write it] | Question 4: [write it] | Disqualification rule: [state the criteria that removes a lead from the pipeline]. Speed-to-lead target: contact within [X] minutes of form submission.",
      "NURTURE — Automation tool: [specific tool]. Sequence length: [X emails over Y days]. Trigger for 'hot lead' tag: [specific behavior — e.g. opens 3+ emails, clicks pricing page]. Re-engagement trigger at day [X]: [specific action]. Expected nurture-to-consultation rate: [X]%.",
      "CONSULTATION — Booking tool: [specific tool]. Call length: [X minutes]. Agenda: [write the 4-step agenda]. Pre-call text reminder: [write the exact SMS]. Show rate target: [X]%. Post no-show follow-up: [write the exact text message to send].",
      "CLOSE — Agreement type: [buyer rep / exclusive listing agreement / both]. Close rate from consultation target: [X]%. Days from first contact to signed agreement target: [X days]. Post-close handoff: [describe the client onboarding step that triggers referral asks 30 days later]."
    ],
    "crmStructure": [
      "CONTACT RECORD FIELDS — Required at entry: name, phone, email, lead source, property type, price range, timeline, motivation (dropdown: buying, selling, investing, relocating). Auto-populated: lead score (0–100), days in pipeline, last contact date, total touchpoints.",
      "PIPELINE STAGES — New Lead (SLA: contact in 5 min) → Attempted Contact (SLA: 3 attempts in 48hr) → Contacted (SLA: qualify in first call) → Consultation Booked → Consultation Completed → Active Client → Under Contract → Closed Won / Closed Lost (with loss reason).",
      "AUTOMATION TRIGGERS — No contact after 3 days: send text template A + log task. No contact after 7 days: send email template B + call reminder. No contact after 14 days: move to long-term nurture sequence. Consultation no-show: send reschedule text within 1 hour. Closing anniversary (day 365): send referral request email.",
      "LEAD SCORING RULES — +20: responded to outreach. +15: completed qualification form. +25: booked consultation. +30: attended consultation. -10: no response after 7 days. -20: explicitly said 'not now'. Hot threshold: 60+ points → notify agent immediately via push.",
      "MONTHLY KPI DASHBOARD — Leads in (target: [X]/mo) | Contacts made within 5 min (target: 80%+) | Consultations booked (target: [X]/mo) | Show rate (target: 70%+) | Agreements signed (target: [X]/mo) | GCI closed (target: $[amount]/mo) | Pipeline value (running total of active deals × avg commission)."
    ]
  }
}

All content must be specific to: ${answers.city} market / ${answers.focus} focus / ${answers.priceRange} price range. Write actual scripts and copy — not descriptions of what they should say.`.trim(),
};

const restaurantEngine: EngineConfig = {
  id: 'restaurant',
  name: 'Restaurant Growth',
  systemPrompt:
    'You are a restaurant operations and profitability strategist who has launched 30+ concepts and engineered menus that consistently hit 28–32% food cost. You produce specific, operational, immediately usable output — actual dish names, actual prices, actual copy ready to post. Respond ONLY with a valid JSON object — no prose, no markdown fences, no preamble.',
  promptTemplate: (answers) => `
Build a complete restaurant launch and growth package for the following concept.

Inputs:
- Cuisine type: ${answers.cuisine}
- Location / city: ${answers.location}
- Service type: ${answers.serviceType}

Return a single JSON object with EXACTLY this structure. Every value must be real, specific content — actual dish names, actual prices, actual copy — not placeholder labels:

{
  "blueprint": {
    "businessIdea": "One sentence naming the concept, the cuisine angle, the ${answers.serviceType} model, and the specific position in the ${answers.location} market — written as a pitch to an investor.",
    "targetMarket": "Specific guest profile: age range, income bracket, neighborhood in ${answers.location}, visit frequency (e.g. 2x/month), average check target ($X/person), and the 3 things that drive their restaurant choice (convenience, experience, price, cuisine type, social signaling). Include the day-part and occasion that drives 60% of covers.",
    "revenueModel": "State: average check per head ($X), table turns per service (X for ${answers.serviceType}), target covers per day, daily revenue target, monthly revenue target. Break down by revenue stream. State the food cost target (%) and prime cost target (food + labor, target <65%). Name the 2 highest-margin items on the menu and why they anchor the pricing strategy.",
    "strategy": "Grand opening: state the specific pre-launch marketing actions (2 weeks out, 1 week out, opening day). Local marketing: 2 specific channels with monthly budget and expected ROI. Repeat visit driver: the specific loyalty mechanic or offer that brings guests back within 14 days. 90-day ramp: week 1 covers target, month 1 revenue target, month 3 steady-state revenue target."
  },
  "assets": [
    "GOOGLE BUSINESS PROFILE POST — [Write the full 150-word post announcing the restaurant: opening with a hook about ${answers.cuisine} in ${answers.location}, describing the experience, mentioning ${answers.serviceType}, ending with address, hours, and CTA to order/visit]",
    "INSTAGRAM CAPTIONS — Post 1 (hero dish reveal): [write the full caption, 80 words, with hook, dish description, sensory language, hashtags for ${answers.location}] | Post 2 (behind the scenes): [write the full caption, 70 words] | Post 3 (guest testimonial format): [write the full caption, 60 words] | Post 4 (limited time offer): [write the full caption, 80 words with urgency] | Post 5 (community post): [write the full caption, 70 words connecting to ${answers.location}]",
    "REVIEW RESPONSE TEMPLATES — 5-STAR: [write the exact 3-sentence response to a 5-star review — thank them, reference something specific about their experience, invite them back with a specific reason] | 1-STAR: [write the exact 4-sentence response to a 1-star complaint — acknowledge, take responsibility without admitting fault, offer a specific resolution, provide a direct contact]",
    "B2B OUTREACH EMAIL — Subject: [write it] | Body: [write the full 120-word email to a local office manager or HR director proposing group lunch catering for their team, specific to ${answers.cuisine} in ${answers.location}, with a specific introductory offer and clear next step]",
    "PROMOTIONAL FLYER COPY — Headline: [write it, max 8 words] | Subheadline: [write it, max 15 words, specific to ${answers.serviceType}] | Body: [write 40 words describing the offer] | CTA: [write the exact action + URL/phone/address] | Urgency line: [write the deadline or scarcity element]"
  ],
  "buildOutput": {
    "menu": [
      "APPETIZERS — Item 1: [dish name] — [2-sentence description with key ingredient and flavor profile] — $[price] (food cost: [X]%, margin: [Y]%) | Item 2: [dish name] — [description] — $[price] (food cost: [X]%) | Item 3: [dish name] — [description] — $[price] (food cost: [X]%) | Engineering note: Item [1/2/3] is the star — push it verbally; highest margin, best attachment rate.",
      "MAINS — Item 1 (STAR): [dish name] — [3-sentence description] — $[price] (food cost: [X]%) — STAR: signature ${answers.cuisine} item, table-side presentation drives social sharing | Item 2 (PLOWHORSE): [dish name] — $[price] (food cost: [X]%) — PLOWHORSE: high volume, lower margin, drives covers | Item 3: [dish name] — $[price] | Item 4: [dish name] — $[price] | Item 5: [dish name] — $[price] | Item 6: [dish name] — $[price]",
      "SIDES — Item 1: [dish name] — $[price] (food cost: [X]%) — designed for table sharing, attaches to 40%+ of main orders | Item 2: [dish name] — $[price] | Item 3: [dish name] — $[price]",
      "DESSERTS — Item 1: [dish name] — $[price] (food cost: [X]%) — impulse buy, presented on a small dessert card at the table | Item 2: [dish name] — $[price] | Item 3 (shareable): [dish name for 2] — $[price]",
      "DRINKS — Signature cocktail: [name] — $[price] (cost: [X]%) — house special, photo-worthy, drives Instagram mentions | House mocktail: [name] — $[price] | Local beer/wine pairing: [specific local brewery or winery name] on draft — $[price] | Upsell prompt: server script — '[write the exact 1-sentence drink upsell line servers say when dropping menus]'"
    ],
    "pricing": [
      "UNIT ECONOMICS — Average check per head: $[X] (target). Average table spend (2 guests): $[Y]. Food cost target: [Z]% of revenue. Labor cost target: [W]% of revenue. Prime cost (food + labor): <65% of revenue. Contribution margin per cover: $[amount].",
      "BREAK-EVEN ANALYSIS — Fixed monthly costs (rent + utilities + insurance estimate): $[X]. Variable cost per cover: $[Y]. Break-even covers per month: [Z covers] = [Z/30 = X covers/day]. Current target daily covers: [A]. Days to break-even at target volume: [B days].",
      "MENU ENGINEERING MATRIX — Stars (high popularity, high margin): [dish names] — protect these, never discount | Plowhorses (high popularity, low margin): [dish names] — increase price by $1–2, simplify prep | Puzzles (low popularity, high margin): [dish names] — reposition on menu, train staff to upsell | Dogs (low popularity, low margin): [dish names] — remove next menu revision.",
      "PRICING PSYCHOLOGY LEVERS — Anchor item: [highest-priced dish name at $X] — makes mid-tier items look reasonable. Decoy item: [specific item at $Y] — positioned to drive guests toward the $Z option. Bundle offer for ${answers.serviceType}: [write the specific bundle — e.g. 'Lunch combo: any main + side + drink for $[price], saves $[X]']. Happy hour window (if dine-in): [time range] — [specific offer that drives off-peak covers].",
      "90-DAY REVENUE RAMP — Week 1: [X] covers/day at $[avg check] = $[daily revenue]. Month 1 target: $[monthly revenue] (soft launch, word-of-mouth phase). Month 2 target: $[monthly revenue] (paid ads + Google profile active). Month 3 target: $[monthly revenue] (steady state, repeat guest rate >30%)."
    ],
    "landingPageSections": [
      "HERO — H1: [write the exact headline, max 8 words, specific to ${answers.cuisine} in ${answers.location}] | Subheading: [write it, 15 words, naming the service type and location] | Primary CTA button: [write the exact button label for ${answers.serviceType}] | Secondary CTA: [write it]",
      "ABOUT — [Write the exact 3-sentence about section: sentence 1 = cuisine origin or chef story, sentence 2 = what makes this concept different in ${answers.location}, sentence 3 = the promise to the guest]",
      "MENU HIGHLIGHTS — Dish 1: [name] + [10-word description] + $[price] | Dish 2: [name] + [10-word description] + $[price] | Dish 3: [name] + [10-word description] + $[price] — these are the 3 highest-margin, most photogenic items.",
      "SOCIAL PROOF — Review quote 1: [write a realistic 2-sentence 5-star review] — [Name, ${answers.location}] | Review quote 2: [write a realistic 2-sentence 5-star review focused on ${answers.serviceType}] — [Name] | Review quote 3: [write a realistic 2-sentence 5-star review focused on the food]",
      "ORDER / RESERVE CTA — Section headline: [write it, max 6 words] | Body: [write 20 words describing what they get when they click] | Button: [write the CTA for ${answers.serviceType}] | Trust line below button: [write a 1-sentence reassurance — e.g. no reservation fee, cancel anytime, delivered hot]",
      "FOOTER — Tagline: [write a 6-word brand tagline] | Hours: [write placeholder hours table format for ${answers.serviceType}] | Address: [placeholder] | Phone: [placeholder] | Social links: Instagram, Google Reviews, [relevant delivery platform for ${answers.serviceType}]"
    ]
  }
}

All content must be specific to: ${answers.cuisine} cuisine / ${answers.location} / ${answers.serviceType} service. Write actual dish names, actual prices, actual copy — not descriptions of what content should go there.`.trim(),
};

export const ENGINE_CONFIGS: Record<EngineProfileType, EngineConfig> = {
  saas: saasEngine,
  realestate: realestateEngine,
  restaurant: restaurantEngine,
};

export function getEngineConfig(type: EngineProfileType): EngineConfig {
  return ENGINE_CONFIGS[type];
}
