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
    'You are a world-class SaaS startup CTO and go-to-market strategist. All output must be final, copy-paste-ready content. In the assets array, every "body" field must contain only actual written text — zero bracket instructions, zero placeholder labels. Write as the author. Respond ONLY with a valid JSON object — no prose, no markdown fences, no preamble.',
  promptTemplate: (answers) => `
Build a complete SaaS launch package for this product:
- Problem: ${answers.problem}
- Audience: ${answers.audience}
- App type: ${answers.appType}
- Pricing model: ${answers.pricing}

You must generate 5 assets. Write each one in full BEFORE placing it in the JSON.

ASSET 1 — Cold Email (type: "Cold Email")
Write a complete B2B cold email targeting ${answers.audience}. Line 1: subject line formatted as "Subject: [line]". Blank line. Opening hook (1 sentence naming a specific pain). Problem amplification (2 sentences). Solution intro (2 sentences naming the product and what it eliminates). Social proof or credibility line (1 sentence). CTA asking for a 15-minute call with a specific day suggestion. Sign-off. Use {first_name} and {company} as the only personalization tokens.

ASSET 2 — LinkedIn Post (type: "LinkedIn Post")
Write a full 150–200 word LinkedIn post. Open with a bold 1-line hook about ${answers.problem}. Then 3–4 short paragraphs: the insight that led to building this, what the product does, who it's for. End with a CTA (comment, follow, or try). Format with line breaks between paragraphs — ready to paste into LinkedIn.

ASSET 3 — Google Ads (type: "Google Ads")
Write all 5 fields for one ad set:
Line 1: "Headline 1: [max 30 chars]"
Line 2: "Headline 2: [max 30 chars]"
Line 3: "Headline 3: [max 30 chars]"
Line 4: "Description 1: [max 90 chars]"
Line 5: "Description 2: [max 90 chars]"
Make headlines specific to ${answers.problem} and ${answers.audience}. No truncation.

ASSET 4 — Product Hunt Launch (type: "Product Hunt")
Line 1: "Tagline: [max 60 chars — punchy, benefit-first]"
Blank line. Then a 180–200 word launch description: open with the problem, describe the solution, list 3 key features as bullet points, end with a "Made for [audience]" closing line. Ready to paste into Product Hunt.

ASSET 5 — Onboarding Email Sequence (type: "Onboarding Sequence")
Write 5 subject lines + the opening sentence of each email for a new ${answers.audience} user:
"Email 1 (Day 0) — Subject: [line] | Opens: [first sentence]"
"Email 2 (Day 2) — Subject: [line] | Opens: [first sentence]"
"Email 3 (Day 5) — Subject: [line] | Opens: [first sentence]"
"Email 4 (Day 10) — Subject: [line] | Opens: [first sentence]"
"Email 5 (Day 21) — Subject: [line] | Opens: [first sentence]"

Now return the full JSON:

{
  "blueprint": {
    "businessIdea": "One sharp sentence naming the product, the exact problem it eliminates, and who it's for — written as a founding pitch.",
    "targetMarket": "3–4 sentences: specific job title or situation, the exact broken workflow they use today, the emotional cost of that pain, and why they will pay $X/month to fix it.",
    "revenueModel": "Name each tier with a dollar amount (e.g. Starter $29/mo · Pro $79/mo · Business $199/mo). List what's included per tier. State the upsell trigger — the usage event that converts Starter to Pro. State target LTV and churn rate.",
    "strategy": "Name 2 primary acquisition channels with specific tactics for each. State the launch sequence: what ships day 1, week 2, what milestone triggers paid campaigns. Give the 90-day revenue target and the one metric to track it."
  },
  "assets": [
    {"type": "Cold Email", "body": ""},
    {"type": "LinkedIn Post", "body": ""},
    {"type": "Google Ads", "body": ""},
    {"type": "Product Hunt", "body": ""},
    {"type": "Onboarding Sequence", "body": ""}
  ],
  "buildOutput": {
    "techStack": [
      "Frontend: [specific framework + 1-sentence rationale — e.g. Next.js 14 App Router: SSR for SEO, React Server Components cut bundle size]",
      "Backend: [specific runtime + framework + rationale]",
      "Database: [specific DB + ORM + rationale — why it fits this product's data model]",
      "Auth: [specific solution + rationale — e.g. Clerk: OAuth, MFA, session management out of the box; eliminates 3 weeks of auth build]",
      "Payments: [specific solution + rationale]",
      "Hosting: [frontend platform + API/DB platform + rationale]"
    ],
    "apiRoutes": [
      "POST /auth/register → creates user, sends welcome email, returns JWT + refresh token",
      "POST /auth/login → validates credentials, returns JWT (15 min) + refresh token (30 d), logs login event",
      "POST /auth/refresh → rotates refresh token, returns new JWT",
      "GET /api/me → returns user profile, current plan, usage stats",
      "PATCH /api/me → updates name, email (triggers reverify), timezone, notification prefs",
      "GET /api/dashboard → aggregated usage metrics, last 30d activity feed",
      "POST /api/subscribe → creates Stripe subscription, updates plan in DB, fires plan:upgraded event",
      "POST /api/subscribe/cancel → schedules cancel at period end, triggers retention email flow",
      "GET /api/usage → current period usage vs plan limits with percentage consumed",
      "DELETE /api/account → soft-deletes user, cancels subscription, queues data export"
    ],
    "dbSchema": [
      "users: id UUID PK | email VARCHAR UNIQUE NOT NULL | password_hash VARCHAR | name VARCHAR | plan ENUM('free','starter','pro','business') DEFAULT 'free' | plan_expires_at TIMESTAMPTZ | stripe_customer_id VARCHAR UNIQUE | created_at TIMESTAMPTZ | last_active_at TIMESTAMPTZ",
      "subscriptions: id UUID PK | user_id UUID FK→users | stripe_subscription_id VARCHAR UNIQUE | plan VARCHAR | status ENUM('active','past_due','canceled','trialing') | current_period_start/end TIMESTAMPTZ | cancel_at_period_end BOOLEAN",
      "usage_events: id UUID PK | user_id UUID FK→users | event_type VARCHAR | metadata JSONB | created_at TIMESTAMPTZ — INDEX(user_id, event_type, created_at)",
      "api_keys: id UUID PK | user_id UUID FK→users | key_hash VARCHAR UNIQUE | label VARCHAR | last_used_at TIMESTAMPTZ | expires_at TIMESTAMPTZ | revoked_at TIMESTAMPTZ"
    ]
  }
}

Fill every "body" field with the complete written content from the asset specs above. Do not leave any body empty or use brackets inside a body value.`.trim(),
};

const realestateEngine: EngineConfig = {
  id: 'realestate',
  name: 'Real Estate Growth',
  systemPrompt:
    'You are an elite real estate growth operator who has closed 200+ deals and built lead systems generating 50+ qualified leads per month. All output must be final, word-for-word scripts and copy — not descriptions of them. In the assets array, every "body" field must contain only actual written text, zero bracket instructions. Write as the agent. Respond ONLY with a valid JSON object — no prose, no markdown fences, no preamble.',
  promptTemplate: (answers) => `
Build a complete real estate growth engine for this operator:
- City / market: ${answers.city}
- Focus area: ${answers.focus}
- Target price range: ${answers.priceRange}

You must generate 5 assets. Write each one in full BEFORE placing it in the JSON.

ASSET 1 — Cold Call Script (type: "Cold Call Script")
Write a word-for-word phone script for reaching ${answers.focus}s in ${answers.city} at the ${answers.priceRange} range.
Section 1 — Opener (2 sentences): state your name, company, and the specific reason you're calling related to their market.
Section 2 — Pain bridge (2 sentences): acknowledge a real challenge ${answers.focus}s in ${answers.city} face right now.
Section 3 — Value statement (1 sentence): state the one specific result you deliver for ${answers.priceRange} ${answers.focus}s.
Section 4 — Qualification question (1 sentence): ask about their timeline in a non-pressuring way.
Section 5 — Close (1 sentence): ask for a 15-minute strategy call with two specific day options.
Section 6 — Objection "I already have an agent" (2 sentences): acknowledge and pivot to a specific differentiator.
Label each section. Write every line as if speaking on the phone.

ASSET 2 — Facebook Ad (type: "Facebook Ad")
Write all 3 parts:
"Primary Text: [100-word ad body targeting ${answers.focus}s in ${answers.city} at ${answers.priceRange} — open with a bold pattern-interrupt statement, include one specific local market proof point (e.g., '87% of ${answers.city} ${answers.focus}s who called us...'), close with a direct CTA]"
"Headline: [max 40 chars — specific to the audience]"
"Description: [max 30 chars — supporting the headline]"

ASSET 3 — 5-Email Drip Sequence (type: "Email Drip Sequence")
Write all 5 subject lines + the opening sentence for a new lead from ${answers.city}:
"Email 1 (Day 0) — Subject: [line] | Opens: [first sentence]"
"Email 2 (Day 3) — Subject: [line] | Opens: [first sentence]"
"Email 3 (Day 7) — Subject: [line] | Opens: [first sentence]"
"Email 4 (Day 14) — Subject: [line] | Opens: [first sentence]"
"Email 5 (Day 30) — Subject: [line] | Opens: [first sentence]"
Each subject line must be specific to ${answers.city}, ${answers.focus}s, or ${answers.priceRange}.

ASSET 4 — Listing Presentation Opener (type: "Listing Presentation")
Write a word-for-word 3-paragraph verbal opener for a listing appointment:
Paragraph 1: Establish credibility with a specific number (deals closed, days on market, list-to-sale ratio) specific to ${answers.city} and ${answers.priceRange}.
Paragraph 2: Name the concern most ${answers.focus}s at ${answers.priceRange} have right now and show you understand it.
Paragraph 3: State your specific process and the one promise you make to every client.
Write every sentence as if speaking in the room.

ASSET 5 — Google Ads (type: "Google Ads")
Write all 5 fields:
"Headline 1: [max 30 chars — include ${answers.city}]"
"Headline 2: [max 30 chars — audience-specific]"
"Headline 3: [max 30 chars — CTA]"
"Description 1: [max 90 chars — include a proof point or number]"
"Description 2: [max 90 chars — differentiator or urgency]"

Now return the full JSON:

{
  "blueprint": {
    "businessIdea": "One aggressive sentence: who you serve, what you do, why you win in ${answers.city} at ${answers.priceRange}.",
    "targetMarket": "Precise profile: age range, household income, neighborhood clusters in ${answers.city}, triggering life event (job change, divorce, growing family, retirement), biggest fear about the process, and typical timeline from first contact to signed contract.",
    "revenueModel": "Average commission per transaction at ${answers.priceRange}. Monthly deal volume target and GCI target. Revenue split by source: buyer side, listing side, referral income, repeat clients. Unit economics: cost per lead, cost per closed deal, target ROI on ad spend.",
    "strategy": "Two lead gen channels with monthly budget, expected lead volume, and cost-per-lead for each. Conversion targets: contact-to-consultation rate, consultation-to-signed rate, days-to-close average. 90-day plan: week 1 actions, month 1 milestone, month 3 milestone with specific deal and GCI numbers."
  },
  "assets": [
    {"type": "Cold Call Script", "body": ""},
    {"type": "Facebook Ad", "body": ""},
    {"type": "Email Drip Sequence", "body": ""},
    {"type": "Listing Presentation", "body": ""},
    {"type": "Google Ads", "body": ""}
  ],
  "buildOutput": {
    "funnelSteps": [
      "AWARENESS — Channel: [name]. Format: [ad type]. Budget: $[X]/mo. Targeting: [specific criteria for ${answers.city} ${answers.focus}s at ${answers.priceRange}]. Expected: [X] leads/mo at $[CPL] each.",
      "LEAD CAPTURE — Page headline: [write it]. CTA: [write it]. Lead magnet: [name the specific offer]. Form fields: [list exactly which fields]. Target conversion rate: [X]%.",
      "QUALIFICATION — Question 1: [write it] | Question 2: [write it] | Question 3: [write it] | Disqualification rule: [state criteria]. Speed-to-lead target: contact within [X] minutes.",
      "NURTURE — Tool: [specific CRM/automation]. Sequence: [X emails over Y days]. Hot-lead trigger: [specific behavior]. Re-engagement at day [X]: [specific action]. Nurture-to-consultation rate target: [X]%.",
      "CONSULTATION — Booking tool: [specific tool]. Call length: [X min]. Agenda: [4-step agenda]. Pre-call SMS: [write the exact text]. Show rate target: [X]%. No-show follow-up SMS: [write the exact text].",
      "CLOSE — Agreement type: [buyer rep / listing agreement]. Close rate from consultation target: [X]%. First-contact-to-signed target: [X days]. Post-close referral trigger at day [X]: [describe the touchpoint]."
    ],
    "crmStructure": [
      "CONTACT FIELDS — Required at entry: name, phone, email, lead source, property type, price range, timeline, motivation. Auto-populated: lead score (0–100), days in pipeline, last contact date, total touchpoints.",
      "PIPELINE STAGES — New Lead (SLA: contact in 5 min) → Attempted Contact (SLA: 3 tries in 48hr) → Contacted → Consultation Booked → Consultation Completed → Active Client → Under Contract → Closed Won / Closed Lost (with loss reason tag).",
      "AUTOMATION TRIGGERS — No contact day 3: send text [template A] + create call task. No contact day 7: send email [template B] + escalate. Day 14: move to long-term nurture. No-show: reschedule text within 1 hour. Day 365 post-close: send referral request email.",
      "LEAD SCORING — +20 responded to outreach | +15 completed qualification | +25 booked consultation | +30 attended | −10 no response 7 days | −20 said 'not now'. Hot threshold: 60+ → immediate agent push notification.",
      "MONTHLY KPIs — Leads in: target [X]/mo | 5-min contact rate: target 80%+ | Consultations: target [X]/mo | Show rate: target 70%+ | Agreements signed: target [X]/mo | GCI closed: target $[X]/mo | Active pipeline value: $[X] (running total)."
    ]
  }
}

Fill every "body" field with the complete written content from the asset specs above. Write every word as if you are the agent — do not use brackets inside any body value.`.trim(),
};

const restaurantEngine: EngineConfig = {
  id: 'restaurant',
  name: 'Restaurant Growth',
  systemPrompt:
    'You are a restaurant operations and profitability strategist who has launched 30+ concepts and engineered menus that consistently hit 28–32% food cost. All output must be specific, operational, and immediately usable — actual dish names, actual prices, actual copy. In the assets array, every "body" field must contain only actual written text — zero bracket instructions, zero placeholder labels. Write as the owner. Respond ONLY with a valid JSON object — no prose, no markdown fences, no preamble.',
  promptTemplate: (answers) => `
Build a complete restaurant launch and growth package for this concept:
- Cuisine: ${answers.cuisine}
- Location / city: ${answers.location}
- Service type: ${answers.serviceType}

You must generate 5 assets. Write each one in full BEFORE placing it in the JSON.

ASSET 1 — Google Business Profile Post (type: "Google Business Post")
Write a complete 130–150 word Google Business post announcing this restaurant.
Open with a 1-sentence hook about ${answers.cuisine} in ${answers.location}.
Describe the dining experience (2–3 sentences with sensory/atmosphere details).
Mention the ${answers.serviceType} option specifically.
State hours, a specific address format, and a CTA to visit or order.
Close with a brand tagline. Ready to paste directly into Google Business Profile.

ASSET 2 — Instagram Captions (type: "Instagram Captions")
Write 5 complete captions (not descriptions of them). Separate with "---".
Caption 1 — Hero dish reveal: 70-word caption with sensory hook, dish name, price, 5 ${answers.location}-specific hashtags.
Caption 2 — Behind the scenes: 60-word kitchen/prep story with personal voice, no hashtags.
Caption 3 — Guest experience: 60-word caption written as if a guest is describing their visit.
Caption 4 — Limited time offer: 75-word caption with urgency, specific offer, and CTA.
Caption 5 — Local community: 65-word caption connecting the restaurant to ${answers.location}, with local hashtags.

ASSET 3 — Review Response Templates (type: "Review Responses")
Write both in full. Separate with "---".
5-STAR RESPONSE: 3 sentences. Sentence 1: thank them and reference something specific (use a placeholder like [dish they mentioned]). Sentence 2: share something genuine about what makes the experience special. Sentence 3: invite them back with a specific next visit reason (a menu item or upcoming special).
1-STAR RESPONSE: 4 sentences. Sentence 1: acknowledge without being defensive. Sentence 2: take responsibility for the experience. Sentence 3: offer a specific resolution (direct line or email). Sentence 4: invite them to reach out with a genuine commitment to make it right.
Label each response clearly.

ASSET 4 — B2B Catering Outreach Email (type: "Catering Outreach Email")
Write a complete outreach email to a local office manager or HR director.
Subject line on line 1 formatted as "Subject: [line]".
Blank line. Then a 100–120 word email body:
Opening: reference a specific shared value (feeding their team well).
Introduction of the concept (2 sentences: cuisine type, ${answers.location} location).
Specific introductory group lunch offer with a real price or discount.
One social proof line (could be a milestone, award, or simple local claim).
Clear next step: reply to this email or call a number to book a tasting.
Sign-off with name, title, restaurant name, and phone placeholder.

ASSET 5 — Promotional Flyer Copy (type: "Promo Flyer")
Write all 5 copy elements:
"Headline: [max 8 words — bold, benefit-first]"
"Subheadline: [max 15 words — names the ${answers.serviceType} offer and location]"
"Body: [35–45 words describing the offer and the experience]"
"CTA: [the exact action + where to go/call/order]"
"Urgency line: [deadline or scarcity — e.g., 'Valid through March 31' or 'First 50 orders only']"

Now return the full JSON:

{
  "blueprint": {
    "businessIdea": "One sentence: the concept name, the cuisine angle, the ${answers.serviceType} model, and the specific position in the ${answers.location} market — written as a pitch to an investor.",
    "targetMarket": "Specific guest profile: age range, income bracket, neighborhood in ${answers.location}, visit frequency, average check target, 3 decision drivers for their restaurant choice, and the day-part or occasion that drives 60% of covers.",
    "revenueModel": "Average check per head, table turns per service (for ${answers.serviceType}), target covers per day, daily and monthly revenue target. Break down by revenue stream. State food cost target (%) and prime cost target (food + labor, <65%). Name the 2 highest-margin items and why they anchor pricing.",
    "strategy": "Grand opening: specific pre-launch actions 2 weeks out, 1 week out, opening day. Local marketing: 2 channels with monthly budget and expected ROI. Repeat visit driver: the specific loyalty mechanic or offer that brings guests back within 14 days. 90-day ramp: week 1 covers, month 1 revenue, month 3 steady-state revenue."
  },
  "assets": [
    {"type": "Google Business Post", "body": ""},
    {"type": "Instagram Captions", "body": ""},
    {"type": "Review Responses", "body": ""},
    {"type": "Catering Outreach Email", "body": ""},
    {"type": "Promo Flyer", "body": ""}
  ],
  "buildOutput": {
    "menu": [
      "APPETIZERS — [Dish 1 name]: [10-word description] — $[price] (food cost [X]%, margin [Y]%) | [Dish 2 name]: [description] — $[price] (food cost [X]%) | [Dish 3 name]: [description] — $[price] (food cost [X]%). Engineering note: [Dish 1 or 2 name] is the star — highest margin, best attachment rate, push verbally.",
      "MAINS — [Dish 1 — STAR]: [15-word description] — $[price] (food cost [X]%) STAR: signature ${answers.cuisine} item, drives social sharing | [Dish 2 — PLOWHORSE]: [description] — $[price] (food cost [X]%) PLOWHORSE: high volume, lower margin, drives covers | [Dish 3]: [description] — $[price] | [Dish 4]: [description] — $[price] | [Dish 5]: [description] — $[price]",
      "SIDES — [Dish 1 name]: [description] — $[price] (food cost [X]%) — attaches to 40%+ of main orders | [Dish 2 name]: [description] — $[price] | [Dish 3 name]: [description] — $[price]",
      "DESSERTS — [Dish 1 name]: [description] — $[price] (food cost [X]%) — presented on dessert card, impulse buy | [Dish 2 name]: [description] — $[price] | [Dish 3 name — shareable]: [description for 2] — $[price]",
      "DRINKS — Signature cocktail: [name] — $[price] (cost [X]%) — photo-worthy, drives Instagram | House mocktail: [name] — $[price] | Draft: [local brewery or winery name] — $[price] | Server upsell line: [write the exact 1-sentence line servers say when dropping menus]"
    ],
    "pricing": [
      "UNIT ECONOMICS — Average check/head: $[X]. Table spend (2 guests): $[Y]. Food cost target: [Z]% of revenue. Labor cost target: [W]%. Prime cost (food + labor): <65%. Contribution margin per cover: $[amount].",
      "BREAK-EVEN — Fixed monthly costs (rent + utilities + insurance estimate): $[X]. Variable cost per cover: $[Y]. Break-even covers/month: [Z] = [Z/30] covers/day. Current daily target: [A] covers. Days to break-even at target volume: [B].",
      "MENU ENGINEERING — Stars (high popularity, high margin): [dish names] — protect, never discount. Plowhorses (high popularity, low margin): [dish names] — raise price $1–2, simplify prep. Puzzles (low popularity, high margin): [dish names] — reposition on menu, train staff to mention. Dogs (low popularity, low margin): [dish names] — remove next revision.",
      "PRICING PSYCHOLOGY — Anchor: [highest-priced dish at $X] makes mid-tier look reasonable. Decoy: [specific item at $Y] steers toward [target item at $Z]. Bundle for ${answers.serviceType}: [write the specific bundle — e.g., 'Lunch combo: main + side + drink for $[price], saves $[X]']. Peak-hour incentive: [specific off-peak offer to drive covers during [time]].",
      "90-DAY RAMP — Week 1: [X] covers/day at $[avg check] = $[daily revenue]. Month 1: $[monthly revenue] (soft launch, word-of-mouth). Month 2: $[monthly revenue] (paid ads + Google active). Month 3: $[monthly revenue] steady state, repeat guest rate >30%."
    ],
    "landingPageSections": [
      "HERO — H1: [write the headline, max 8 words, specific to ${answers.cuisine} in ${answers.location}] | Subheading: [write it, 15 words, naming service and location] | Primary CTA: [write the exact button label for ${answers.serviceType}] | Secondary CTA: [write it]",
      "ABOUT — [Write the exact 3-sentence section: sentence 1 = cuisine origin or founder story, sentence 2 = what makes this different in ${answers.location}, sentence 3 = the promise to the guest]",
      "MENU HIGHLIGHTS — [Dish 1 name] + [10-word description] + $[price] | [Dish 2 name] + [10-word description] + $[price] | [Dish 3 name] + [10-word description] + $[price] — 3 highest-margin, most photogenic items",
      "SOCIAL PROOF — Review 1: [write a 2-sentence 5-star quote] — [Name, ${answers.location}] | Review 2: [write a 2-sentence 5-star quote about ${answers.serviceType}] — [Name] | Review 3: [write a 2-sentence 5-star quote about the food] — [Name]",
      "ORDER CTA — Section headline: [write it, max 6 words] | Body: [20 words on what they get] | Button: [CTA for ${answers.serviceType}] | Trust line: [1-sentence reassurance below the button]",
      "FOOTER — Tagline: [6-word brand tagline] | Hours: [hours format for ${answers.serviceType}] | Address: [placeholder] | Phone: [placeholder] | Links: Instagram, Google Reviews, [delivery platform relevant to ${answers.serviceType}]"
    ]
  }
}

Fill every "body" field with the complete written content from the asset specs above. Write every word as the restaurant owner — do not use brackets inside any body value.`.trim(),
};

export const ENGINE_CONFIGS: Record<EngineProfileType, EngineConfig> = {
  saas: saasEngine,
  realestate: realestateEngine,
  restaurant: restaurantEngine,
};

export function getEngineConfig(type: EngineProfileType): EngineConfig {
  return ENGINE_CONFIGS[type];
}
