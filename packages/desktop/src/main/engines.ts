// ── Forge Engine Configs ────────────────────────────────────────────────────
// 20 business engines across 4 categories — all config-driven.
// UI metadata (questions, icon, category) lives here alongside AI prompts.

export interface EngineQuestion {
  key: string;
  label: string;
  type: 'text' | 'select';
  options?: string[];
}

export type EngineCategory =
  | 'Tech & Digital'
  | 'Financial Services'
  | 'Local & Service'
  | 'Retail & Hospitality';

export interface EngineConfig {
  id: string;
  category: EngineCategory;
  name: string;
  description: string;
  icon: string;
  detail: string;
  systemPrompt: string;
  questions: EngineQuestion[];
  promptTemplate: (answers: Record<string, string>) => string;
  executionPromptTemplate: (
    blueprint: Record<string, string>,
    buildOutput: Record<string, string[]>,
  ) => string;
}

// ── Tone rule (shared across all system prompts) ──────────────────────────────
const TONE =
  'Write in a direct, commanding tone throughout. Use imperative language. Never write "could", "might", "may want to", "consider", "potentially", or "you might". All output must be final, copy-paste-ready content. In the assets array, every "body" field must contain only actual written text — zero bracket instructions, zero placeholder labels. Respond ONLY with a valid JSON object — no prose, no markdown fences, no preamble.';

// ── Generic execution prompt (used by all new engines) ────────────────────────
function genericExec(engineName: string) {
  return (blueprint: Record<string, string>, _b: Record<string, string[]>): string =>
    `You are an execution strategist. This founder just built their ${engineName} business plan. Give them a structured execution roadmap and their exact first action.

Business overview:
- Business: ${blueprint.businessIdea ?? ''}
- Market: ${blueprint.targetMarket ?? ''}
- Revenue model: ${blueprint.revenueModel ?? ''}
- Strategy: ${blueprint.strategy ?? ''}

Write every sentence as a direct command. No hedging words.

Return ONLY this JSON — no prose, no markdown fences:
{
  "executionPlan": {
    "immediate": [
      "[First concrete action for today — specific and actionable]",
      "[Second urgent action within the next few hours]"
    ],
    "thisWeek": [
      "[Action to complete in days 2–7]",
      "[Another this-week milestone]"
    ],
    "nextPhase": [
      "[Weeks 2–4 action once foundation is set]"
    ]
  },
  "firstTask": {
    "title": "[Direct task title — 4–6 words]",
    "objective": "[One sentence: the specific outcome this task delivers for the business.]",
    "steps": [
      "[Step 1 — specific, actionable instruction]",
      "[Step 2 — specific, actionable instruction]",
      "[Step 3 — specific, actionable instruction]",
      "[Step 4 — specific, actionable instruction]",
      "[Step 5 — specific, actionable instruction]"
    ],
    "resources": ["[Tool or platform needed]", "[Second resource]"],
    "deliverable": "[Exactly what exists when this task is complete — one concrete sentence.]"
  },
  "marketing": {
    "poster": {
      "prompt": "[Write a complete DALL-E 3 image generation prompt for a professional marketing poster for this ${engineName} business. Describe: visual style, color palette matching the business type, central imagery, background treatment, and brand mood. Self-contained image description, 3–4 sentences, no instruction brackets in output.]",
      "description": "Marketing poster"
    },
    "website": {
      "prompt": "[Write a complete DALL-E 3 image generation prompt for a professional website hero section image for this ${engineName} business. Describe: composition, background colors and textures, imagery or illustrations, lighting mood, and atmosphere. Wide landscape orientation. No readable text in image. 3–4 sentences, no instruction brackets in output.]",
      "description": "Website hero image"
    }
  }
}

Tailor everything specifically to this business: ${blueprint.businessIdea ?? ''}`.trim();
}

// ════════════════════════════════════════════════════════════════════════════
// TECH & DIGITAL
// ════════════════════════════════════════════════════════════════════════════

const saasEngine: EngineConfig = {
  id: 'saas',
  category: 'Tech & Digital',
  name: 'SaaS Builder',
  description: 'Build and launch a software product',
  icon: '💻',
  detail: 'Blueprint · Assets · API routes · DB schema',
  systemPrompt:
    `You are a world-class SaaS startup CTO and go-to-market strategist. ${TONE}`,
  questions: [
    { key: 'problem',  label: 'What problem does your SaaS solve?', type: 'text' },
    { key: 'audience', label: 'Who is your target audience?',        type: 'text' },
    { key: 'appType',  label: 'App type',    type: 'select', options: ['web', 'mobile'] },
    { key: 'pricing',  label: 'Pricing model', type: 'select', options: ['free', 'paid'] },
  ],
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
      "Frontend: [specific framework + 1-sentence rationale]",
      "Backend: [specific runtime + framework + rationale]",
      "Database: [specific DB + ORM + rationale]",
      "Auth: [specific solution + rationale]",
      "Payments: [specific solution + rationale]",
      "Hosting: [frontend platform + API/DB platform + rationale]"
    ],
    "apiRoutes": [
      "POST /auth/register → creates user, sends welcome email, returns JWT + refresh token",
      "POST /auth/login → validates credentials, returns JWT (15 min) + refresh token (30 d)",
      "POST /auth/refresh → rotates refresh token, returns new JWT",
      "GET /api/me → returns user profile, current plan, usage stats",
      "PATCH /api/me → updates name, email (triggers reverify), timezone, notification prefs",
      "GET /api/dashboard → aggregated usage metrics, last 30d activity feed",
      "POST /api/subscribe → creates Stripe subscription, updates plan in DB",
      "POST /api/subscribe/cancel → schedules cancel at period end, triggers retention email",
      "GET /api/usage → current period usage vs plan limits with percentage consumed",
      "DELETE /api/account → soft-deletes user, cancels subscription, queues data export"
    ],
    "dbSchema": [
      "users: id UUID PK | email VARCHAR UNIQUE NOT NULL | password_hash VARCHAR | name VARCHAR | plan ENUM('free','starter','pro','business') DEFAULT 'free' | stripe_customer_id VARCHAR UNIQUE | created_at TIMESTAMPTZ | last_active_at TIMESTAMPTZ",
      "subscriptions: id UUID PK | user_id UUID FK→users | stripe_subscription_id VARCHAR UNIQUE | plan VARCHAR | status ENUM('active','past_due','canceled','trialing') | current_period_start/end TIMESTAMPTZ | cancel_at_period_end BOOLEAN",
      "usage_events: id UUID PK | user_id UUID FK→users | event_type VARCHAR | metadata JSONB | created_at TIMESTAMPTZ — INDEX(user_id, event_type, created_at)",
      "api_keys: id UUID PK | user_id UUID FK→users | key_hash VARCHAR UNIQUE | label VARCHAR | last_used_at TIMESTAMPTZ | expires_at TIMESTAMPTZ | revoked_at TIMESTAMPTZ"
    ]
  }
}

Fill every "body" field with the complete written content from the asset specs above. Do not leave any body empty or use brackets inside a body value.`.trim(),

  executionPromptTemplate: (blueprint, buildOutput) => `
You are an execution strategist. This SaaS founder just finished their business plan. Give them a structured execution roadmap and their exact first action.

Their business:
- Idea: ${blueprint.businessIdea ?? ''}
- Target market: ${blueprint.targetMarket ?? ''}
- Revenue model: ${blueprint.revenueModel ?? ''}
- Tech stack: ${(buildOutput.techStack ?? [])[0] ?? 'not specified'}

Write every sentence as a direct command. No hedging words.

Return ONLY this JSON object — no prose, no markdown fences:
{
  "executionPlan": {
    "immediate": [
      "Validate your core assumption: send the cold email asset to 5 prospects from your target market today — measure replies within 24 hours.",
      "Set up your development environment: initialize the repo, install auth and payments libraries from your tech stack, push first commit to main."
    ],
    "thisWeek": [
      "Build your MVP: implement the single feature that directly solves the core problem — ship nothing else.",
      "Deploy to production and onboard 10 beta testers from your target market using your onboarding email sequence."
    ],
    "nextPhase": [
      "Activate your first paid acquisition channel using your Google Ads asset and hit your 90-day revenue target."
    ]
  },
  "firstTask": {
    "title": "Set Up Your Development Foundation",
    "objective": "Create the project infrastructure so you can build and deploy your first feature without interruption.",
    "steps": [
      "Create a GitHub repo named for your product with README and .gitignore",
      "Initialize with your chosen framework (Next.js, React, or mobile framework)",
      "Install auth provider and payments library from your tech stack",
      "Configure your database connection string in a .env file",
      "git add . && git commit -m 'Initial setup' && push to main"
    ],
    "resources": ["GitHub", "Framework CLI (Next.js/Vite/Expo)", "Stripe Dashboard", "Auth provider (Auth0/Clerk/Supabase)"],
    "deliverable": "A live GitHub repo with auth and payments dependencies installed — ready to build your first feature."
  },
  "marketing": {
    "poster": {
      "prompt": "[Write a complete DALL-E 3 image prompt for a B2B SaaS product marketing poster for this specific product: ${blueprint.businessIdea ?? ''}. Describe: modern minimal design style, color palette (dark navy or white), abstract tech or UI imagery as the central element, typography layout areas, and brand energy. 3–4 sentences, no instruction brackets in output.]",
      "description": "SaaS product marketing poster"
    },
    "website": {
      "prompt": "[Write a complete DALL-E 3 image prompt for a professional SaaS website hero image for this product. Describe: layout style (full-bleed or split), background gradient or texture, floating UI or dashboard elements, color palette matching B2B tech, and overall mood. Wide landscape format, no readable text. 3–4 sentences, no instruction brackets in output.]",
      "description": "SaaS website hero image"
    },
    "app": {
      "prompt": "[Write a complete DALL-E 3 image prompt for a clean app dashboard UI mockup for this SaaS product: ${blueprint.businessIdea ?? ''}. Describe: screen layout (dark or light mode), navigation sidebar, data visualization types visible (charts, metrics, cards), color accents, and hardware context (laptop or monitor). 3–4 sentences, no instruction brackets in output.]",
      "description": "App dashboard UI mockup"
    }
  }
}

Tailor the executionPlan steps and firstTask content specifically to this product and market: ${blueprint.businessIdea ?? ''}`.trim(),
};

const aiAgencyEngine: EngineConfig = {
  id: 'aiagency',
  category: 'Tech & Digital',
  name: 'AI Automation Agency',
  description: 'Launch and sell AI automation services to businesses',
  icon: '🤖',
  detail: 'Blueprint · Client assets · Service packages · Tech stack',
  systemPrompt: `You are a world-class AI automation consultant who has built automation systems for 100+ businesses across sales, operations, and marketing. ${TONE}`,
  questions: [
    { key: 'targetIndustry', label: 'Target industry to serve?',      type: 'text' },
    { key: 'automationFocus', label: 'Automation focus area?',        type: 'text' },
    { key: 'pricingModel',    label: 'Pricing model',                 type: 'select', options: ['project-based', 'retainer'] },
  ],
  promptTemplate: (answers) => `
Build a complete AI Automation Agency business package:
- Target industry: ${answers.targetIndustry}
- Automation focus: ${answers.automationFocus}
- Pricing model: ${answers.pricingModel}

Write 5 assets in full before placing them in the JSON.

ASSET 1 — Agency One-Pager (type: "Agency Overview")
Write a 200-word agency overview document. Open with a bold positioning statement. Describe what you automate and for whom. List 3 specific outcomes clients achieve (with metrics). Name your process (3 steps: Audit → Build → Deploy). End with a CTA to book a discovery call.

ASSET 2 — Cold Email (type: "Cold Email")
Write a B2B cold email targeting operations directors or CTOs in ${answers.targetIndustry}. Subject line on line 1. Hook: name a specific manual process costing them time. Problem: 2 sentences on what that inefficiency costs. Solution: 2 sentences naming your ${answers.automationFocus} automation and what it eliminates. Proof: 1 ROI stat or outcome. CTA: 20-minute discovery call, specific day.

ASSET 3 — LinkedIn Post (type: "LinkedIn Post")
Write a 150-200 word post. Hook: a bold claim about automation in ${answers.targetIndustry}. Body: the specific workflow you automate, the result your clients see, and how you built the system. End with a CTA to DM or comment for more.

ASSET 4 — Discovery Call Script (type: "Discovery Call Script")
Write a word-for-word script: opener (introduce yourself + why you're calling), 3 qualification questions (what tools they use, where they lose time, what a 20% efficiency gain is worth), value statement (what you deliver in 2 weeks), and close (ask for a paid audit engagement).

ASSET 5 — Proposal Template (type: "Proposal Template")
Write a structured proposal: engagement title, problem statement (2 sentences), solution scope (3 bullet deliverables), timeline (2-4 weeks), investment (${answers.pricingModel} price), and what you need from the client to start.

Return this JSON:
{
  "blueprint": {
    "businessIdea": "One sentence: what you automate, for whom in ${answers.targetIndustry}, and what result they get.",
    "targetMarket": "Specific client profile: company size, title of decision-maker, 2 processes they waste time on today, budget range for automation, and how they currently try to solve the problem.",
    "revenueModel": "Pricing for ${answers.pricingModel}: discovery audit price, build project range, retainer rate. Average engagement value. Target clients per month and monthly revenue goal.",
    "strategy": "2 acquisition channels with specific outreach tactics. First client acquisition plan: week 1 actions, first paid engagement milestone. 90-day revenue target."
  },
  "assets": [
    {"type": "Agency Overview", "body": ""},
    {"type": "Cold Email", "body": ""},
    {"type": "LinkedIn Post", "body": ""},
    {"type": "Discovery Call Script", "body": ""},
    {"type": "Proposal Template", "body": ""}
  ],
  "buildOutput": {
    "servicePackages": [
      "AUTOMATION AUDIT — Scope: map all manual workflows, identify top 3 automation opportunities | Timeline: 3 days | Investment: $[X] | Deliverable: Automation Roadmap PDF + implementation quote",
      "BUILD + DEPLOY — Scope: build and launch 1 automation system end-to-end | Timeline: 2 weeks | Investment: $[X]–$[Y] based on complexity | Deliverable: live system + documentation + 30-day support",
      "RETAINER — Scope: ongoing automation builds, maintenance, and optimization | Timeline: monthly | Investment: $[X]/mo | Deliverable: [N] automation builds/month + priority support + monthly report"
    ],
    "techStack": [
      "Automation platform: [Zapier / Make.com / n8n — choose based on client tech stack and budget]",
      "AI layer: [OpenAI API for text generation, classification, and summarization tasks]",
      "CRM integration: [HubSpot / Salesforce / Pipedrive — via native connector or API]",
      "Communication: [Slack / Email via SendGrid — for automated notifications and reports]",
      "Data: [Google Sheets / Airtable for lightweight data — PostgreSQL for complex pipelines]",
      "Deployment: [Zapier/Make hosted OR self-hosted n8n on Railway/Render for cost control]"
    ]
  }
}

Fill every body field with complete written content from the asset specs above.`.trim(),
  executionPromptTemplate: genericExec('AI Automation Agency'),
};

const noCodeEngine: EngineConfig = {
  id: 'nocode',
  category: 'Tech & Digital',
  name: 'No-Code Startup',
  description: 'Build and launch a startup using no-code tools',
  icon: '⚡',
  detail: 'Blueprint · Launch assets · No-code stack · Launch checklist',
  systemPrompt: `You are an expert no-code startup builder who has launched 50+ products on Bubble, Webflow, Glide, and Softr without writing a single line of code. ${TONE}`,
  questions: [
    { key: 'productIdea',  label: 'What is your product idea?',    type: 'text' },
    { key: 'targetUser',   label: 'Who is your target user?',      type: 'text' },
    { key: 'platform',     label: 'Preferred platform',            type: 'select', options: ['Bubble', 'Webflow', 'Glide'] },
  ],
  promptTemplate: (answers) => `
Build a complete No-Code Startup launch package:
- Product idea: ${answers.productIdea}
- Target user: ${answers.targetUser}
- Platform: ${answers.platform}

Write 5 assets in full before placing them in the JSON.

ASSET 1 — Landing Page Copy (type: "Landing Page")
Write all 5 sections: H1 (8 words max, benefit-first), subheadline (15 words, names problem and solution), 3 feature bullets (each 10 words: feature + outcome), social proof line (1 sentence), and primary CTA button label + supporting text. Ready to paste into ${answers.platform}.

ASSET 2 — Product Hunt Launch (type: "Product Hunt")
Line 1: "Tagline: [max 60 chars]". Blank line. Write a 180-200 word launch post: open with the problem, describe the product, list 3 key features as bullets, close with who it's made for.

ASSET 3 — LinkedIn Post (type: "LinkedIn Post")
Write 150-200 words. Hook: bold statement about the problem your product solves. Body: why you built it, what it does, why no-code makes it faster. CTA: link to try it or join the waitlist.

ASSET 4 — Cold Email (type: "Cold Email")
Write a cold email targeting ${answers.targetUser}. Subject line on line 1. Hook: name the exact pain. Solution: 2 sentences on the product. Offer: free beta access. CTA: one-click reply to get access.

ASSET 5 — Welcome Email (type: "Welcome Email")
Write the onboarding email sent to new users. Subject line. 3-step quickstart guide (tell them exactly what to do first, second, third). Support CTA. Friendly close.

Return this JSON:
{
  "blueprint": {
    "businessIdea": "One sentence: the product, the problem it eliminates for ${answers.targetUser}, built on ${answers.platform}.",
    "targetMarket": "Specific user profile: job or life situation, the exact workflow they hate today, what they've tried that failed, willingness to pay.",
    "revenueModel": "Freemium or paid tier structure with prices. Feature gates that convert free to paid. Target MRR at month 3 and month 6.",
    "strategy": "2 launch channels (Product Hunt, LinkedIn, Reddit, etc.) with specific tactics. Launch day checklist. 30-day user growth target."
  },
  "assets": [
    {"type": "Landing Page", "body": ""},
    {"type": "Product Hunt", "body": ""},
    {"type": "LinkedIn Post", "body": ""},
    {"type": "Cold Email", "body": ""},
    {"type": "Welcome Email", "body": ""}
  ],
  "buildOutput": {
    "toolStack": [
      "Frontend/UI: ${answers.platform} — [rationale for this product type]",
      "Database: Airtable or ${answers.platform} DB — [what data you store]",
      "Auth: [${answers.platform} native auth OR Memberstack/Outseta]",
      "Payments: Stripe via [${answers.platform} plugin or Outseta]",
      "Email: Mailchimp / ConvertKit — [trigger: signup, upgrade, churn]",
      "Analytics: PostHog (free) or Mixpanel — [key events to track]"
    ],
    "launchChecklist": [
      "Week -1: Build core flow in ${answers.platform}, set up Stripe test mode, write landing page copy",
      "Week -1: Set up email sequences, configure auth, test end-to-end user journey",
      "Launch day: Post on Product Hunt at 12:01 AM PST, share on LinkedIn, post in 3 relevant communities",
      "Launch day: DM 20 target users personally with a direct link to try it",
      "Week +1: Collect feedback from first 50 users, ship one improvement based on top request",
      "Week +2: Activate first paid acquisition channel based on launch data"
    ]
  }
}

Fill every body field with complete written content.`.trim(),
  executionPromptTemplate: genericExec('No-Code Startup'),
};

const ecommerceEngine: EngineConfig = {
  id: 'ecommerce',
  category: 'Tech & Digital',
  name: 'E-commerce Brand',
  description: 'Launch and scale an e-commerce brand',
  icon: '🛍',
  detail: 'Blueprint · Product copy · Ad creative · Email flows',
  systemPrompt: `You are an elite e-commerce brand strategist who has scaled 20+ DTC brands past $1M ARR using paid social, email, and conversion optimization. ${TONE}`,
  questions: [
    { key: 'niche',          label: 'Product niche?',           type: 'text' },
    { key: 'priceRange',     label: 'Price range per item?',    type: 'text' },
    { key: 'targetAudience', label: 'Target audience?',         type: 'text' },
  ],
  promptTemplate: (answers) => `
Build a complete E-commerce Brand launch package:
- Niche: ${answers.niche}
- Price range: ${answers.priceRange}
- Target audience: ${answers.targetAudience}

Write 5 assets in full before placing them in the JSON.

ASSET 1 — Product Page Copy (type: "Product Page")
Write a complete product page for the hero product: product title (6 words max), 1-sentence hook below the title, 3-bullet feature/benefit list (feature → outcome format), a 100-word "Why you'll love it" section, 3 trust signals (guarantee, shipping, returns), and a CTA button label.

ASSET 2 — Facebook Ad (type: "Facebook Ad")
Write all 3 parts: Primary text (100-word ad body for ${answers.targetAudience}, open with a bold pattern-interrupt, include one specific proof point, close with direct CTA). Headline: max 40 chars. Description: max 30 chars.

ASSET 3 — Instagram Captions (type: "Instagram Captions")
Write 3 complete captions separated by "---": Caption 1 (product reveal, 70 words, sensory hook + price + 5 niche hashtags). Caption 2 (lifestyle/use case, 60 words, personal voice). Caption 3 (limited promo, 75 words, urgency + offer + CTA).

ASSET 4 — Abandon Cart Email (type: "Abandon Cart Email")
Write the subject line + complete 150-word email. Create urgency without being pushy. Reference what they left behind. Include one specific objection handle. CTA: complete your order.

ASSET 5 — Google Shopping Ad (type: "Google Shopping Ad")
Write: Product title (max 150 chars, keyword-rich for ${answers.niche}). Description (max 90 chars). Promotional message (max 60 chars with offer or urgency).

Return this JSON:
{
  "blueprint": {
    "businessIdea": "One sentence: the brand, the product category, the audience, and the positioning in the ${answers.niche} market.",
    "targetMarket": "Specific buyer profile for ${answers.targetAudience}: age range, purchase trigger, where they discover products, average order frequency, and what they hate about alternatives.",
    "revenueModel": "AOV, LTV, target orders/month at 3 months and 6 months. Revenue split: direct site vs marketplaces. Margin target after COGS + ads. Break-even ROAS.",
    "strategy": "2 paid channels (Meta, Google, TikTok) with launch budget and target ROAS. Email list growth strategy. 90-day revenue target and key milestones."
  },
  "assets": [
    {"type": "Product Page", "body": ""},
    {"type": "Facebook Ad", "body": ""},
    {"type": "Instagram Captions", "body": ""},
    {"type": "Abandon Cart Email", "body": ""},
    {"type": "Google Shopping Ad", "body": ""}
  ],
  "buildOutput": {
    "productCatalog": [
      "HERO PRODUCT — [Name]: [15-word description] | Price: $[X] | COGS: $[Y] | Margin: [Z]% | Why it wins: [1 sentence differentiator]",
      "UPSELL — [Name]: [description] | Price: $[X] | AOV lift: $[Y] when bundled | Attach rate target: [Z]%",
      "BUNDLE — [Name + components]: [description] | Bundle price: $[X] (saves $[Y]) | Margin: [Z]%",
      "BESTSELLER candidate: [Name] — highest repeat purchase rate, drives reviews and LTV",
      "SEASONAL/LIMITED — [Name]: [description] | Strategy: launch during [event/season] to drive urgency"
    ],
    "emailFlows": [
      "WELCOME SERIES (3 emails): Day 0 → brand story + hero product spotlight | Day 2 → social proof + top seller | Day 5 → 10% discount offer for first purchase",
      "ABANDON CART (3 emails): 1hr → reminder + product image | 24hr → objection handle + review | 72hr → final urgency + discount",
      "POST-PURCHASE (3 emails): Day 1 → order confirmation + what to expect | Day 7 → care/use tips + review request | Day 30 → reorder prompt + referral offer",
      "WIN-BACK (2 emails): Day 60 since last order → 'We miss you' + 15% off | Day 75 → final offer before list removal"
    ]
  }
}

Fill every body field with complete written content.`.trim(),
  executionPromptTemplate: genericExec('E-commerce Brand'),
};

const digitalProductEngine: EngineConfig = {
  id: 'digitalproduct',
  category: 'Tech & Digital',
  name: 'Digital Product Business',
  description: 'Launch a course, ebook, or template business',
  icon: '📦',
  detail: 'Blueprint · Sales page · Launch sequence · Content outline',
  systemPrompt: `You are a top-tier digital product launch strategist who has helped creators generate $500K+ from courses, ebooks, and templates. ${TONE}`,
  questions: [
    { key: 'productType', label: 'Product type', type: 'select', options: ['course', 'ebook', 'templates'] },
    { key: 'topic',       label: 'Topic or subject?',     type: 'text' },
    { key: 'audience',    label: 'Target audience?',      type: 'text' },
  ],
  promptTemplate: (answers) => `
Build a complete Digital Product Business launch package:
- Product type: ${answers.productType}
- Topic: ${answers.topic}
- Audience: ${answers.audience}

Write 5 assets in full before placing them in the JSON.

ASSET 1 — Sales Page Copy (type: "Sales Page")
Write a complete sales page: H1 (bold outcome-driven headline for ${answers.audience}), subheadline (who it's for + what they'll achieve), "Is this for you?" section (3 bullet pain points), "What's inside" section (5 bullet deliverables with outcomes), Instructor/Creator bio (2 sentences of authority), price + guarantee statement, and CTA button text.

ASSET 2 — Launch Email Sequence (type: "Launch Emails")
Write 4 emails: Email 1 (teaser — subject + 100-word problem agitation). Email 2 (open cart — subject + 120-word solution reveal + price). Email 3 (social proof — subject + testimonial framework + urgency). Email 4 (last day — subject + 80-word final push + CTA). Write every word, no placeholders.

ASSET 3 — LinkedIn Announcement (type: "LinkedIn Post")
Write a 200-word launch announcement post. Open with a polarizing insight about ${answers.topic}. Share the personal story of why you built this. Reveal the product with key benefit. CTA to the sales page.

ASSET 4 — Facebook Ad (type: "Facebook Ad")
Write: Primary text (100 words targeting ${answers.audience} who struggle with ${answers.topic}, open with a before/after hook, end with urgency CTA). Headline (40 chars). Description (30 chars).

ASSET 5 — Product Description (type: "Product Description")
Write a 150-word marketplace description (Gumroad, Teachable, etc.): what the ${answers.productType} covers, who it's for, what they'll be able to do after, what's included, format and access details.

Return this JSON:
{
  "blueprint": {
    "businessIdea": "One sentence: the ${answers.productType} name, the transformation it delivers for ${answers.audience} on the topic of ${answers.topic}.",
    "targetMarket": "Specific buyer: situation they're stuck in, what they've tried before, the exact outcome they want, what they'll pay for it.",
    "revenueModel": "Launch price, evergreen price, upsells. Target units in launch week, month 1, month 3. Revenue per launch. Passive income projection at 6 months.",
    "strategy": "Launch strategy: beta cohort, email list build, launch week promotions. Evergreen funnel after launch. 2 traffic sources with budget and expected conversion."
  },
  "assets": [
    {"type": "Sales Page", "body": ""},
    {"type": "Launch Emails", "body": ""},
    {"type": "LinkedIn Post", "body": ""},
    {"type": "Facebook Ad", "body": ""},
    {"type": "Product Description", "body": ""}
  ],
  "buildOutput": {
    "contentOutline": [
      "MODULE 1 — [Name]: [Core concept] | Lessons: [N] | Key outcome: [what they can do after]",
      "MODULE 2 — [Name]: [Core concept] | Lessons: [N] | Key outcome: [what they can do after]",
      "MODULE 3 — [Name]: [Core concept] | Lessons: [N] | Key outcome: [what they can do after]",
      "MODULE 4 — [Name]: [Core concept] | Lessons: [N] | Key outcome: [what they can do after]",
      "MODULE 5 — [Name]: [Core concept] | Lessons: [N] | Key outcome: [what they can do after]",
      "BONUS — [Name]: [What it is] | Why included: [the objection it handles]"
    ],
    "launchTimeline": [
      "Week -2: Build email waitlist, post daily teaser content, open beta enrollment at 50% discount",
      "Week -1: Close beta, collect testimonials, finalize sales page and email sequences",
      "Launch Day 1: Send open cart email, post announcement on LinkedIn/Twitter, DM 50 warm contacts",
      "Launch Days 2-4: Send social proof email, share testimonials on social, run paid ads",
      "Launch Day 5-7: Final urgency push, last-day email, close cart or raise price",
      "Week +1: Set up evergreen funnel, turn on ads, publish first content marketing piece"
    ]
  }
}

Fill every body field with complete written content.`.trim(),
  executionPromptTemplate: genericExec('Digital Product Business'),
};

const contentCreatorEngine: EngineConfig = {
  id: 'contentcreator',
  category: 'Tech & Digital',
  name: 'Content Creator Brand',
  description: 'Build a monetized content brand on any platform',
  icon: '🎥',
  detail: 'Blueprint · Brand assets · Content calendar · Monetization plan',
  systemPrompt: `You are an expert content monetization strategist who has helped 200+ creators build 6-figure income streams from their audience. ${TONE}`,
  questions: [
    { key: 'platform',          label: 'Primary platform',         type: 'select', options: ['YouTube', 'TikTok', 'Instagram'] },
    { key: 'niche',             label: 'Content niche?',           type: 'text' },
    { key: 'monetizationGoal',  label: 'Monetization model',       type: 'select', options: ['brand deals', 'courses', 'memberships'] },
  ],
  promptTemplate: (answers) => `
Build a complete Content Creator Brand package:
- Platform: ${answers.platform}
- Niche: ${answers.niche}
- Monetization: ${answers.monetizationGoal}

Write 5 assets in full before placing them in the JSON.

ASSET 1 — Platform Bio (type: "Platform Bio")
Write 2 versions: Short bio (150 chars max, for ${answers.platform} profile) and Extended about (150 words, for website/media kit). Both must name the niche, who you help, and what they get. Include a CTA.

ASSET 2 — Brand Pitch Email (type: "Brand Pitch")
Write a 200-word pitch email to potential sponsors or brands in the ${answers.niche} space. Subject line on line 1. Cover: who you are, your audience (size/demographics), engagement rate, what a partnership looks like, your package offer, and a specific CTA.

ASSET 3 — 4-Week Content Calendar (type: "Content Calendar")
Write a 4-week content calendar for ${answers.platform}. Each week: theme (1 sentence), 3 post/video ideas with titles and hooks. Format each idea as "Title: [title] | Hook: [opening line]". Total: 12 content ideas, ready to execute.

ASSET 4 — First Post/Video Script (type: "First Script")
Write the script for a debut piece of content: Hook (10 words, scroll-stopping opening). Intro (30 seconds: who you are, who this is for). Main content (2 minutes: 3 key insights or steps). CTA (15 seconds: what to do next).

ASSET 5 — Monetization Page Copy (type: "Monetization Page")
Write a 200-word pitch page for your ${answers.monetizationGoal} offer: headline (what they get), 3-bullet breakdown of what's included, social proof line, price, and CTA.

Return this JSON:
{
  "blueprint": {
    "businessIdea": "One sentence: the creator brand, the ${answers.niche} niche, the platform, and the primary monetization model.",
    "targetMarket": "Specific audience profile: age range, situation, what they search for on ${answers.platform}, what they've tried before, and what they'll pay for.",
    "revenueModel": "${answers.monetizationGoal} revenue structure with prices and targets. Brand deal rate card. Monthly revenue target at 10K, 50K, 100K followers.",
    "strategy": "Content growth engine: posting frequency, content mix (educational/entertaining/promotional ratio), collaboration strategy, and 90-day follower growth target."
  },
  "assets": [
    {"type": "Platform Bio", "body": ""},
    {"type": "Brand Pitch", "body": ""},
    {"type": "Content Calendar", "body": ""},
    {"type": "First Script", "body": ""},
    {"type": "Monetization Page", "body": ""}
  ],
  "buildOutput": {
    "contentPillars": [
      "PILLAR 1 — [Theme name]: [What content falls here] | Formats: [post types] | Frequency: [X/week] | Goal: [awareness/trust/conversion]",
      "PILLAR 2 — [Theme name]: [What content falls here] | Formats: [post types] | Frequency: [X/week] | Goal: [awareness/trust/conversion]",
      "PILLAR 3 — [Theme name]: [What content falls here] | Formats: [post types] | Frequency: [X/week] | Goal: [awareness/trust/conversion]",
      "PILLAR 4 — MONETIZATION CONTENT: direct promotion of ${answers.monetizationGoal} | Frequency: 1/week max | Format: [specific type]"
    ],
    "revenueStreams": [
      "STREAM 1 — ${answers.monetizationGoal}: [Description] | Price: $[X] | Activation: [what needs to happen first] | Timeline: launch at [follower milestone]",
      "STREAM 2 — Brand Deals: [Target brands in niche] | Rate: $[X] per post at [follower count] | How to pitch: [specific approach]",
      "STREAM 3 — [Third revenue stream relevant to niche]: [Description] | Price: $[X] | When to add: [month or milestone]"
    ]
  }
}

Fill every body field with complete written content.`.trim(),
  executionPromptTemplate: genericExec('Content Creator Brand'),
};

const newsletterEngine: EngineConfig = {
  id: 'newsletter',
  category: 'Tech & Digital',
  name: 'Newsletter / Media Brand',
  description: 'Build a paid or sponsored newsletter business',
  icon: '📰',
  detail: 'Blueprint · Editorial assets · Sponsor packages · Growth plan',
  systemPrompt: `You are an expert newsletter growth operator who has built and monetized newsletters with 50K+ subscribers across finance, tech, and business niches. ${TONE}`,
  questions: [
    { key: 'niche',              label: 'Newsletter niche?',       type: 'text' },
    { key: 'monetizationModel',  label: 'Monetization model',      type: 'select', options: ['sponsorships', 'paid subscription', 'both'] },
    { key: 'frequency',          label: 'Send frequency',          type: 'select', options: ['daily', 'weekly', 'biweekly'] },
  ],
  promptTemplate: (answers) => `
Build a complete Newsletter / Media Brand package:
- Niche: ${answers.niche}
- Monetization: ${answers.monetizationModel}
- Frequency: ${answers.frequency}

Write 5 assets in full before placing them in the JSON.

ASSET 1 — Welcome Email (type: "Welcome Email")
Write the welcome email sent to all new subscribers. Subject line on line 1. 200-word body: thank them, explain what they'll get and when, tell them what to do first, set the tone of the newsletter, and invite a reply.

ASSET 2 — Sponsor Pitch Email (type: "Sponsor Pitch")
Write a 200-word outreach email to potential sponsors in the ${answers.niche} space. Subject: what the newsletter does + audience size. Body: audience profile + engagement metrics + what a sponsorship looks like + CTA to see the media kit.

ASSET 3 — Growth Post (type: "Growth Post")
Write a 150-word LinkedIn or Twitter post designed to drive newsletter subscriptions. Hook: a bold insight or contrarian take on ${answers.niche}. Body: what subscribers learn each ${answers.frequency} issue. CTA: direct link to subscribe.

ASSET 4 — Sample Issue Intro (type: "Sample Issue")
Write a 120-word editorial intro section in the newsletter's voice. Open with a strong insight or news hook on ${answers.niche}. Brief analysis (2-3 sentences). Tease what's in this issue (3 bullets). Sign-off line.

ASSET 5 — Referral Email (type: "Referral Email")
Write a 150-word email to current subscribers asking for referrals. Subject line. Explain the referral reward. Tell them exactly how to share it. Close with appreciation and a deadline or incentive.

Return this JSON:
{
  "blueprint": {
    "businessIdea": "One sentence: the newsletter name concept, the ${answers.niche} niche, the ${answers.frequency} cadence, and the primary revenue model.",
    "targetMarket": "Specific reader profile: job title or situation, what they read today, why they'll switch to this, willingness to pay or forward to peers.",
    "revenueModel": "${answers.monetizationModel} revenue structure with rates, targets, and subscriber milestones. Revenue per 1,000 subscribers. 12-month revenue projection.",
    "strategy": "Subscriber growth engine: launch strategy, content seeding channels, referral mechanic, paid growth trigger. 90-day subscriber target and monetization activation milestone."
  },
  "assets": [
    {"type": "Welcome Email", "body": ""},
    {"type": "Sponsor Pitch", "body": ""},
    {"type": "Growth Post", "body": ""},
    {"type": "Sample Issue", "body": ""},
    {"type": "Referral Email", "body": ""}
  ],
  "buildOutput": {
    "editorialCalendar": [
      "SECTION 1 — [Name: e.g. 'The Brief']: [What it covers] | Format: [bullets/prose] | Word count: [X] | Position: top of issue",
      "SECTION 2 — [Name: e.g. 'Deep Dive']: [What it covers] | Format: [analysis] | Word count: [X] | Position: middle",
      "SECTION 3 — [Name: e.g. 'Tools & Tactics']: [What it covers] | Format: [listicle] | Word count: [X] | Position: bottom",
      "SPONSOR SLOT: [position in issue] | Format: [native mention / dedicated block] | Rate: $[X] per placement",
      "FREQUENCY: ${answers.frequency} | Send day: [best day for ${answers.niche} audience] | Send time: [optimal time]"
    ],
    "sponsorPackages": [
      "SOLO SPONSOR — Exclusive sponsor for one issue | Placement: top-of-email banner + 1 mention | Audience: [X] subscribers | Rate: $[Y] per issue",
      "FEATURED SPONSOR — Native mention in top section + logo | Audience: [X] subscribers | Rate: $[Y] per issue | 4-issue minimum",
      "NEWSLETTER PARTNER — 3-month exclusive category sponsorship | All placements included | Rate: $[Y]/mo | Includes: content integration + social mention"
    ]
  }
}

Fill every body field with complete written content.`.trim(),
  executionPromptTemplate: genericExec('Newsletter / Media Brand'),
};

const freelanceEngine: EngineConfig = {
  id: 'freelance',
  category: 'Tech & Digital',
  name: 'Freelance Service Business',
  description: 'Launch and scale a high-ticket freelance practice',
  icon: '🧑‍💻',
  detail: 'Blueprint · Client outreach · Proposal template · Service packages',
  systemPrompt: `You are an expert freelance business strategist who has helped 300+ service providers go from zero to $10K+/month through positioning, outreach, and premium packaging. ${TONE}`,
  questions: [
    { key: 'serviceType',   label: 'Your service type?',           type: 'text' },
    { key: 'targetClient',  label: 'Ideal client type?',           type: 'text' },
    { key: 'pricingStyle',  label: 'Pricing style',                type: 'select', options: ['hourly', 'project-based', 'retainer'] },
  ],
  promptTemplate: (answers) => `
Build a complete Freelance Service Business package:
- Service: ${answers.serviceType}
- Target client: ${answers.targetClient}
- Pricing model: ${answers.pricingStyle}

Write 5 assets in full before placing them in the JSON.

ASSET 1 — Professional Bio (type: "Professional Bio")
Write a 200-word bio for website, LinkedIn, and Upwork/Toptal. Open with a bold positioning statement (who you help + what result). 2 sentences of credibility (experience, results, or specific clients/industries). What makes your approach different. CTA to book a discovery call or view portfolio.

ASSET 2 — Cold Outreach Email (type: "Cold Email")
Write a cold email targeting ${answers.targetClient} for ${answers.serviceType} services. Subject line on line 1. Hook: name a specific problem they face. Solution: 2 sentences on what you deliver and the outcome. Social proof: one specific result. CTA: 20-minute strategy call this week.

ASSET 3 — LinkedIn Post (type: "LinkedIn Post")
Write a 180-word thought leadership post on ${answers.serviceType}. Share a specific insight, case study result (anonymized), or contrarian take. End with a question or CTA that drives engagement and visibility.

ASSET 4 — Proposal Template (type: "Proposal Template")
Write a structured proposal: Your Understanding (1 paragraph restating the problem), Proposed Solution (scope of work, 3 deliverable bullets), Timeline (phases with weeks), Investment (${answers.pricingStyle} pricing with package options), What You Need From Them, Next Steps.

ASSET 5 — Client Onboarding Email (type: "Onboarding Email")
Write the email sent after the contract is signed. Confirm the engagement, set timeline, list 3 things you need from them in the first 48 hours, share how to reach you, and set the tone for the working relationship.

Return this JSON:
{
  "blueprint": {
    "businessIdea": "One sentence: your ${answers.serviceType} practice, who you serve (${answers.targetClient}), and the specific result you deliver.",
    "targetMarket": "Specific client profile: company size or situation, the exact pain they have before hiring you, budget range for ${answers.pricingStyle} engagements, how they find freelancers today.",
    "revenueModel": "${answers.pricingStyle} rate structure with packages and prices. Average project/retainer value. Target monthly revenue. Clients needed to hit goal.",
    "strategy": "Client acquisition: 2 channels (LinkedIn outreach, referrals, platforms) with specific weekly actions. First client target: timeline and approach. 90-day revenue goal."
  },
  "assets": [
    {"type": "Professional Bio", "body": ""},
    {"type": "Cold Email", "body": ""},
    {"type": "LinkedIn Post", "body": ""},
    {"type": "Proposal Template", "body": ""},
    {"type": "Onboarding Email", "body": ""}
  ],
  "buildOutput": {
    "servicePackages": [
      "STARTER — Scope: [specific deliverables for small engagement] | Timeline: [X weeks] | Price: $[Y] | Best for: [client situation]",
      "STANDARD — Scope: [full engagement deliverables] | Timeline: [X weeks] | Price: $[Y] | Best for: [client situation] | Most popular",
      "PREMIUM / RETAINER — Scope: [ongoing or comprehensive deliverables] | Timeline: monthly | Price: $[Y]/mo | Best for: [client situation]"
    ],
    "clientProcess": [
      "INQUIRY: Prospect fills contact form or replies to outreach → respond within 4 hours with calendar link",
      "DISCOVERY CALL (30 min): Understand their situation, budget, timeline → qualify or disqualify → send proposal within 24 hours",
      "PROPOSAL: Send tailored proposal using template → follow up in 48 hours if no response → close or handle objections",
      "ONBOARDING: Contract signed → collect assets/access → kick off call within 3 business days → begin work",
      "DELIVERY: Weekly status update → milestone reviews → revisions within scope → final delivery + sign-off",
      "CLOSE + REFERRAL: Collect testimonial within 7 days → ask for referral → offer repeat/retainer at discounted rate"
    ]
  }
}

Fill every body field with complete written content.`.trim(),
  executionPromptTemplate: genericExec('Freelance Service Business'),
};

// ════════════════════════════════════════════════════════════════════════════
// FINANCIAL SERVICES
// ════════════════════════════════════════════════════════════════════════════

const debtCollectionEngine: EngineConfig = {
  id: 'debtcollection',
  category: 'Financial Services',
  name: 'Debt Collection Agency',
  description: 'Launch a compliant B2B debt collection operation',
  icon: '💼',
  detail: 'Blueprint · Client pitch · Collection process · Pricing structure',
  systemPrompt: `You are an expert debt collection agency operator with 15 years of experience building compliant, high-recovery agencies serving healthcare, retail, and B2B sectors. ${TONE}`,
  questions: [
    { key: 'targetClientType', label: 'Target client type?',      type: 'text' },
    { key: 'region',           label: 'Operating region?',        type: 'text' },
    { key: 'commissionModel',  label: 'Fee structure',            type: 'select', options: ['contingency', 'flat-fee'] },
  ],
  promptTemplate: (answers) => `
Build a complete Debt Collection Agency business package:
- Target clients: ${answers.targetClientType}
- Region: ${answers.region}
- Fee model: ${answers.commissionModel}

Write 5 assets in full before placing them in the JSON.

ASSET 1 — Client Pitch Letter (type: "Client Pitch Letter")
Write a professional 200-word pitch letter to ${answers.targetClientType} offering collection services. Letterhead format. State the problem (uncollected receivables costing them). Your service overview (what you do, how you comply with FDCPA/state laws). Your ${answers.commissionModel} fee structure. What they risk by waiting. CTA: schedule a consultation.

ASSET 2 — Cold Call Script (type: "Cold Call Script")
Write a word-for-word phone script for calling AR managers or CFOs at ${answers.targetClientType}. Opener (who you are + why you're calling). Pain bridge (2 sentences: the cost of aging receivables). Value statement (recovery rate + compliance). Qualification question (age of their outstanding accounts). Close (schedule a portfolio review call).

ASSET 3 — LinkedIn Post (type: "LinkedIn Post")
Write a 150-word professional post positioning the agency as a compliance-first recovery partner for ${answers.targetClientType}. Share one insight about recovery rates or compliance. CTA to connect or message.

ASSET 4 — Service Agreement Overview (type: "Service Agreement")
Write a 200-word overview of the engagement terms: scope of services, ${answers.commissionModel} fee structure, reporting cadence (monthly statements), compliance commitments (FDCPA, TCPA, state laws), account age requirements, and what happens on recovery.

ASSET 5 — Follow-Up Email (type: "Follow-Up Email")
Write a 5-day post-call follow-up email to warm prospects. Subject line. Restate the key value. Include one industry-specific stat on uncollected debt. Attach the pitch letter. CTA: 15-minute call to review their portfolio.

Return this JSON:
{
  "blueprint": {
    "businessIdea": "One sentence: the agency, the client type (${answers.targetClientType}), the region (${answers.region}), and the ${answers.commissionModel} model.",
    "targetMarket": "Specific client profile: industry, company size, average AR balance, age of receivables they write off, why they haven't used a collection agency yet.",
    "revenueModel": "${answers.commissionModel} rate structure with ranges by account age and balance. Average collection per account. Target accounts under management and monthly revenue.",
    "strategy": "Client acquisition: 2 channels with specific outreach tactics. First client target. Compliance setup checklist. 90-day revenue target."
  },
  "assets": [
    {"type": "Client Pitch Letter", "body": ""},
    {"type": "Cold Call Script", "body": ""},
    {"type": "LinkedIn Post", "body": ""},
    {"type": "Service Agreement", "body": ""},
    {"type": "Follow-Up Email", "body": ""}
  ],
  "buildOutput": {
    "collectionProcess": [
      "ACCOUNT INTAKE: Receive debtor list from client → verify data completeness → run skip trace → assign to collector",
      "INITIAL CONTACT (Day 1-3): Send validation notice per FDCPA → attempt first call → log all contact attempts",
      "ACTIVE COLLECTION (Day 4-30): Daily call attempts per state law limits → send follow-up letters → negotiate payment plans",
      "ESCALATION (Day 31-60): Skip trace update → escalate to demand letter → offer settlement at [X]% of balance",
      "LEGAL REVIEW (Day 61-90): Flag accounts for attorney review → recommend litigation for balances over $[X]",
      "RESOLUTION: Process payment → remit to client minus ${answers.commissionModel} fee → send monthly recovery report",
      "REPORTING: Monthly statement per client showing: accounts worked, contacts made, promises received, payments collected, recovery rate"
    ],
    "pricingStructure": [
      "CONTINGENCY RATE (no recovery = no fee): 0-1 year accounts: [25-30]% of amount collected | 1-2 year accounts: [30-35]% | 2+ years: [35-40]% | Legal placement: [50]%",
      "FLAT FEE OPTION: Per account fee of $[X] regardless of outcome | Best for: high-volume, low-balance portfolios under $500/account",
      "CONTRACT TERMS: Minimum portfolio: [X] accounts or $[Y] in receivables | Exclusivity period: [30-90] days per account | Client retains ownership of debt at all times",
      "COMPLIANCE COSTS (pass-through): Skip trace: $[X] per search | Attorney referral: [X]% of legal collections | Credit bureau reporting: $[X]/account/month"
    ]
  }
}

Fill every body field with complete written content.`.trim(),
  executionPromptTemplate: genericExec('Debt Collection Agency'),
};

const creditRepairEngine: EngineConfig = {
  id: 'creditrepair',
  category: 'Financial Services',
  name: 'Credit Repair Business',
  description: 'Launch a credit repair and consulting practice',
  icon: '📊',
  detail: 'Blueprint · Client scripts · Dispute strategy · Growth plan',
  systemPrompt: `You are an expert credit repair business consultant who has helped 500+ clients improve their scores and built compliant, profitable credit repair agencies. ${TONE}`,
  questions: [
    { key: 'targetDemographic', label: 'Target client demographic?',  type: 'text' },
    { key: 'pricingModel',      label: 'Pricing model',               type: 'select', options: ['monthly retainer', 'per-deletion'] },
    { key: 'serviceScope',      label: 'Service scope',               type: 'select', options: ['full-service', 'DIY-assisted'] },
  ],
  promptTemplate: (answers) => `
Build a complete Credit Repair Business package:
- Target demographic: ${answers.targetDemographic}
- Pricing model: ${answers.pricingModel}
- Service scope: ${answers.serviceScope}

Write 5 assets in full before placing them in the JSON.

ASSET 1 — Consultation Script (type: "Consultation Script")
Write a word-for-word discovery call script for new client intake. Opener (who you are + what you do). 4 qualification questions (current score, negative items, goal score, timeline). Value statement (what you deliver in ${answers.serviceScope} service). Price reveal and objection handle for cost concern. Close: get them to sign up or schedule follow-up.

ASSET 2 — Facebook Ad (type: "Facebook Ad")
Write all 3 parts targeting ${answers.targetDemographic}: Primary text (100 words, open with score pain point, describe the impact on their life, introduce your ${answers.serviceScope} service, urgency CTA for free consultation). Headline (40 chars). Description (30 chars).

ASSET 3 — Educational Post (type: "Educational Post")
Write a 150-word value-driven social post on a credit repair topic relevant to ${answers.targetDemographic}. Share one specific, actionable insight they can use today. Position yourself as the expert. Soft CTA to book a free consultation.

ASSET 4 — Referral Partner Pitch (type: "Partner Pitch")
Write a 200-word outreach email to mortgage brokers, real estate agents, or car dealerships in the area. Propose a referral partnership: you fix their clients' credit so they close more deals. Describe what you offer, the referral process, and compensation (referral fee or reciprocal referrals).

ASSET 5 — Welcome Email (type: "Welcome Email")
Write the onboarding email sent to new paying clients. Confirm enrollment, explain what happens in the first 7 days (credit pull, analysis, first dispute letters sent). List 3 things they need to provide. Set expectations on timeline. Give them a direct contact method.

Return this JSON:
{
  "blueprint": {
    "businessIdea": "One sentence: the ${answers.serviceScope} credit repair service, who it serves (${answers.targetDemographic}), and the pricing model.",
    "targetMarket": "Specific client profile: score range when they come to you, 3 most common negative items, life goal blocked by bad credit, what they've tried before.",
    "revenueModel": "${answers.pricingModel} pricing with rates. Average client revenue. Client retention duration. Monthly revenue target. Referral partner revenue split.",
    "strategy": "Client acquisition: 2 channels (Facebook ads, referral partners). First client in 14 days plan. Compliance setup (CROA). 90-day revenue target."
  },
  "assets": [
    {"type": "Consultation Script", "body": ""},
    {"type": "Facebook Ad", "body": ""},
    {"type": "Educational Post", "body": ""},
    {"type": "Partner Pitch", "body": ""},
    {"type": "Welcome Email", "body": ""}
  ],
  "buildOutput": {
    "serviceProcess": [
      "INTAKE (Day 1): Client signs agreement → pull all 3 credit reports → identify all negative items → create dispute list",
      "ANALYSIS (Day 2-3): Categorize items: inaccurate, unverifiable, outdated → prioritize disputes by score impact",
      "FIRST ROUND DISPUTES (Day 4-7): Send customized dispute letters to TransUnion, Experian, Equifax → track via certified mail",
      "BUREAU RESPONSE (Day 30-45): Review results → document removals → prepare second round for remaining items",
      "ONGOING MONITORING (Monthly): Check for new negatives → send additional dispute rounds → update client on score progress",
      "GRADUATION: Client reaches target score → offboard with credit maintenance guide → request testimonial + referrals"
    ],
    "disputeStrategy": [
      "FACTUAL ERROR DISPUTES: Items with wrong amounts, dates, or account status → dispute directly with bureau → highest removal rate (60-80%)",
      "UNVERIFIABLE ITEM DISPUTES: Request debt validation from original creditor → if unverifiable within 30 days → remove per FCRA",
      "GOODWILL DELETION REQUESTS: For paid collections or late payments with good history → write to original creditor directly → 30-40% success rate",
      "HIPAA DISPUTES (for medical debt): Dispute medical collections citing HIPAA privacy violation in collection process",
      "TIMELINE: Round 1 results in 35-45 days | Round 2 in 75-90 days | Average 3-6 rounds for full program | Average score improvement: 50-150 points"
    ]
  }
}

Fill every body field with complete written content.`.trim(),
  executionPromptTemplate: genericExec('Credit Repair Business'),
};

const taxPrepEngine: EngineConfig = {
  id: 'taxprep',
  category: 'Financial Services',
  name: 'Tax Preparation Service',
  description: 'Launch a tax preparation and advisory practice',
  icon: '🧾',
  detail: 'Blueprint · Client acquisition · Service packages · Marketing calendar',
  systemPrompt: `You are an expert tax preparation business strategist who has helped 100+ tax professionals build practices generating $150K+ per tax season. ${TONE}`,
  questions: [
    { key: 'targetClient',     label: 'Target client type?',    type: 'text' },
    { key: 'location',         label: 'City / location?',       type: 'text' },
    { key: 'seasonalStrategy', label: 'Operating model',        type: 'select', options: ['year-round', 'seasonal'] },
  ],
  promptTemplate: (answers) => `
Build a complete Tax Preparation Service business package:
- Target client: ${answers.targetClient}
- Location: ${answers.location}
- Model: ${answers.seasonalStrategy}

Write 5 assets in full before placing them in the JSON.

ASSET 1 — Client Acquisition Email (type: "Acquisition Email")
Write a 150-word outreach email targeting ${answers.targetClient} in ${answers.location}. Subject line on line 1 (seasonal or urgency hook). Pain hook: the cost of doing taxes wrong or missing deductions. Your service intro (2 sentences). What's included + price range. CTA: book a free 15-minute consultation.

ASSET 2 — Google Ads (type: "Google Ads")
Write: Headline 1 (max 30 chars, include ${answers.location}). Headline 2 (max 30 chars, audience-specific). Headline 3 (max 30 chars, CTA). Description 1 (max 90 chars, proof point or service highlight). Description 2 (max 90 chars, urgency or guarantee).

ASSET 3 — Referral Partner Letter (type: "Partner Letter")
Write a 200-word letter to financial advisors, bookkeepers, or attorneys in ${answers.location} proposing a mutual referral relationship. Describe your client type, what you offer, your referral process, and the mutual benefit.

ASSET 4 — Social Announcement Post (type: "Social Post")
Write a 100-word Facebook/Instagram seasonal announcement post for ${answers.location}. Open with a tax deadline hook. Describe your services. Include one specific offer (free consultation, first-year discount). CTA to book or call.

ASSET 5 — Appointment Booking Script (type: "Booking Script")
Write a word-for-word phone/text script for converting inbound inquiries into booked appointments. Greeting, 2 qualifying questions (what type of return, last year's situation), service match, price range, and calendar booking close.

Return this JSON:
{
  "blueprint": {
    "businessIdea": "One sentence: the tax practice, the client type (${answers.targetClient}), location (${answers.location}), and the ${answers.seasonalStrategy} model.",
    "targetMarket": "Specific client profile: income range, filing complexity, what they hate about tax prep, what they've used before, and willingness to pay for expert service.",
    "revenueModel": "Service package prices for each tier. Average revenue per client. Clients per season target. Total season revenue target. ${answers.seasonalStrategy} monthly revenue smoothing.",
    "strategy": "Client acquisition: referral partners, Google Ads, seasonal social push. First 10 clients plan. 90-day revenue target for first season."
  },
  "assets": [
    {"type": "Acquisition Email", "body": ""},
    {"type": "Google Ads", "body": ""},
    {"type": "Partner Letter", "body": ""},
    {"type": "Social Post", "body": ""},
    {"type": "Booking Script", "body": ""}
  ],
  "buildOutput": {
    "servicePackages": [
      "BASIC — W-2 and simple returns | Includes: 1 state + federal | Timeline: 48-hour turnaround | Price: $[X]",
      "STANDARD — Self-employed / freelancers / multiple income sources | Includes: Schedule C, deduction optimization | Timeline: 3-5 days | Price: $[X]",
      "BUSINESS — Small business / S-Corp / LLC | Includes: business + personal, bookkeeping review, planning | Timeline: 1 week | Price: $[X]",
      "PREMIUM / ADVISORY — Complex returns + year-round tax planning | Includes: quarterly check-ins, audit support | Price: $[X]/year retainer"
    ],
    "marketingCalendar": [
      "JANUARY: Send acquisition emails to prior-year clients | Launch Google Ads | Post social announcement | Activate referral partners",
      "FEBRUARY: Tax document collection reminders | Upsell planning sessions | Run Facebook ads for last-minute filers",
      "MARCH-APRIL (PEAK): Maximize capacity | Offer extended hours | Partner referral push | Collect reviews from completed clients",
      "MAY: Extension filing outreach | Off-season planning consultations | Request Google reviews",
      "JUNE-AUGUST: Year-round clients: mid-year tax review | Estimated tax payment reminders | Content marketing on tax tips",
      "SEPTEMBER-OCTOBER: Extension deadline push | Business clients: Q3 review | Begin next-season prospect outreach",
      "NOVEMBER-DECEMBER: Year-end planning meetings | IRA contribution advice | Lock in appointments for January"
    ]
  }
}

Fill every body field with complete written content.`.trim(),
  executionPromptTemplate: genericExec('Tax Preparation Service'),
};

const investmentEduEngine: EngineConfig = {
  id: 'investmentedu',
  category: 'Financial Services',
  name: 'Investment Education Brand',
  description: 'Build an investment education and coaching business',
  icon: '📈',
  detail: 'Blueprint · Course sales page · Curriculum · Launch strategy',
  systemPrompt: `You are a financial education brand strategist who has helped 50+ investment educators build audiences and monetize through courses, newsletters, and coaching. ${TONE}`,
  questions: [
    { key: 'focusArea',     label: 'Investment focus area?',    type: 'text' },
    { key: 'audience',      label: 'Target audience?',          type: 'text' },
    { key: 'contentFormat', label: 'Primary format',            type: 'select', options: ['course', 'newsletter', 'coaching'] },
  ],
  promptTemplate: (answers) => `
Build a complete Investment Education Brand package:
- Focus area: ${answers.focusArea}
- Audience: ${answers.audience}
- Primary format: ${answers.contentFormat}

Write 5 assets in full before placing them in the JSON.

ASSET 1 — Sales/Signup Page Copy (type: "Sales Page")
Write a complete sales page for the ${answers.contentFormat}: headline (bold transformation for ${answers.audience}), subheadline (what they'll be able to do), "Who this is for" (3 bullet situations), "What you'll learn" (5 specific outcomes), instructor authority paragraph (2 sentences), price + guarantee, CTA button.

ASSET 2 — Email Newsletter Sample (type: "Newsletter Sample")
Write one complete newsletter issue intro on ${answers.focusArea}: editorial hook (1 compelling insight), market update or concept breakdown (3-4 paragraphs, 200 words total), 3 takeaway bullets, and a closer that teases the next issue.

ASSET 3 — YouTube Script Hook (type: "YouTube Hook")
Write the first 60 seconds of a ${answers.focusArea} video designed to hold attention: pattern interrupt opening (10 words), problem statement (20 seconds), credibility (10 seconds), promise of what they'll learn today (10 seconds), and transition into content (10 seconds).

ASSET 4 — Authority Social Post (type: "Authority Post")
Write a 200-word LinkedIn or Twitter thread on ${answers.focusArea}. Open with a contrarian or surprising take. Share one specific insight backed by a stat or personal experience. End with a clear takeaway and CTA to follow or subscribe.

ASSET 5 — Brand Bio (type: "Brand Bio")
Write a short (100-word) and long (200-word) bio for ${answers.audience} who are discovering you for the first time. Include: your background in ${answers.focusArea}, a specific result or credential, your mission, and what they'll get by following you.

Return this JSON:
{
  "blueprint": {
    "businessIdea": "One sentence: the education brand, the ${answers.focusArea} focus, who it serves (${answers.audience}), and the ${answers.contentFormat} model.",
    "targetMarket": "Specific learner profile: financial situation, what they know now, what they want to achieve, where they currently learn (YouTube, Reddit, etc.), willingness to pay.",
    "revenueModel": "${answers.contentFormat} pricing and revenue structure. Audience size needed per revenue milestone. Multiple income streams ranked by launch priority.",
    "strategy": "Audience building: 2 content channels with posting frequency. ${answers.contentFormat} launch plan. 90-day subscriber or student target."
  },
  "assets": [
    {"type": "Sales Page", "body": ""},
    {"type": "Newsletter Sample", "body": ""},
    {"type": "YouTube Hook", "body": ""},
    {"type": "Authority Post", "body": ""},
    {"type": "Brand Bio", "body": ""}
  ],
  "buildOutput": {
    "curriculumOutline": [
      "MODULE 1 — [Foundation]: [Core concept introduced] | Lessons: [N] | Outcome: students understand [specific thing]",
      "MODULE 2 — [Strategy]: [Core concept] | Lessons: [N] | Outcome: students can [specific action]",
      "MODULE 3 — [Execution]: [Core concept] | Lessons: [N] | Outcome: students execute [specific task]",
      "MODULE 4 — [Advanced]: [Core concept] | Lessons: [N] | Outcome: students master [specific skill]",
      "MODULE 5 — [System]: [Core concept] | Lessons: [N] | Outcome: students have a repeatable [process]",
      "BONUS — [Resource/Tool]: [What it is] | Why included: handles the #1 objection about [specific barrier]"
    ],
    "launchStrategy": [
      "BETA COHORT (Week -4 to -1): Open enrollment for 20 beta students at 50% discount → collect feedback → build testimonials",
      "LAUNCH PREP (Week -1): Finalize sales page with beta testimonials → set up email sequences → schedule social content",
      "LAUNCH WEEK: Day 1 email to list + social announcement | Day 3 social proof post + YouTube video | Day 5 urgency email + final push",
      "POST-LAUNCH (Month 2): Set up evergreen funnel → run paid ads on YouTube/Meta → publish 2 content pieces per week",
      "SCALE (Month 3+): Add coaching upsell → launch newsletter sponsorship → build referral/affiliate program"
    ]
  }
}

Fill every body field with complete written content.`.trim(),
  executionPromptTemplate: genericExec('Investment Education Brand'),
};

// ════════════════════════════════════════════════════════════════════════════
// LOCAL & SERVICE
// ════════════════════════════════════════════════════════════════════════════

const realestateEngine: EngineConfig = {
  id: 'realestate',
  category: 'Local & Service',
  name: 'Real Estate Growth',
  description: 'Scale your real estate business with a full growth engine',
  icon: '🏠',
  detail: 'Blueprint · Outreach assets · Lead funnel · CRM structure',
  systemPrompt:
    `You are an elite real estate growth operator who has closed 200+ deals and built lead systems generating 50+ qualified leads per month. ${TONE} Write as the agent.`,
  questions: [
    { key: 'city',       label: 'City / market?',        type: 'text' },
    { key: 'focus',      label: 'Focus area',            type: 'select', options: ['buyer', 'seller'] },
    { key: 'priceRange', label: 'Target price range?',   type: 'text' },
  ],
  promptTemplate: (answers) => `
Build a complete real estate growth engine for this operator:
- City / market: ${answers.city}
- Focus area: ${answers.focus}
- Target price range: ${answers.priceRange}

You must generate 5 assets. Write each one in full BEFORE placing it in the JSON.

ASSET 1 — Cold Call Script (type: "Cold Call Script")
Write a word-for-word phone script for reaching ${answers.focus}s in ${answers.city} at the ${answers.priceRange} range.
Section 1 — Opener (2 sentences): state your name, company, and the specific reason you're calling.
Section 2 — Pain bridge (2 sentences): acknowledge a real challenge ${answers.focus}s in ${answers.city} face right now.
Section 3 — Value statement (1 sentence): state the one specific result you deliver.
Section 4 — Qualification question (1 sentence): ask about their timeline.
Section 5 — Close (1 sentence): ask for a 15-minute strategy call with two specific day options.
Section 6 — Objection "I already have an agent" (2 sentences): acknowledge and pivot to a specific differentiator.
Label each section. Write every line as if speaking on the phone.

ASSET 2 — Facebook Ad (type: "Facebook Ad")
Write all 3 parts:
"Primary Text: [100-word ad body targeting ${answers.focus}s in ${answers.city} at ${answers.priceRange} — open with a bold pattern-interrupt, include one specific local market proof point, close with direct CTA]"
"Headline: [max 40 chars — specific to the audience]"
"Description: [max 30 chars — supporting the headline]"

ASSET 3 — 5-Email Drip Sequence (type: "Email Drip Sequence")
Write all 5 subject lines + the opening sentence for a new lead from ${answers.city}:
"Email 1 (Day 0) — Subject: [line] | Opens: [first sentence]"
"Email 2 (Day 3) — Subject: [line] | Opens: [first sentence]"
"Email 3 (Day 7) — Subject: [line] | Opens: [first sentence]"
"Email 4 (Day 14) — Subject: [line] | Opens: [first sentence]"
"Email 5 (Day 30) — Subject: [line] | Opens: [first sentence]"

ASSET 4 — Listing Presentation Opener (type: "Listing Presentation")
Write a word-for-word 3-paragraph verbal opener for a listing appointment specific to ${answers.city} and ${answers.priceRange}.

ASSET 5 — Google Ads (type: "Google Ads")
Write all 5 fields: Headline 1/2/3 (max 30 chars each), Description 1/2 (max 90 chars each).

Now return the full JSON:

{
  "blueprint": {
    "businessIdea": "One aggressive sentence: who you serve, what you do, why you win in ${answers.city} at ${answers.priceRange}.",
    "targetMarket": "Precise profile: age range, household income, neighborhood clusters in ${answers.city}, triggering life event, biggest fear, typical timeline from first contact to signed contract.",
    "revenueModel": "Average commission per transaction at ${answers.priceRange}. Monthly deal volume target and GCI target. Revenue split by source. Unit economics: cost per lead, cost per closed deal.",
    "strategy": "Two lead gen channels with monthly budget, expected lead volume, and CPL for each. Conversion targets. 90-day plan with specific deal and GCI numbers."
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
      "LEAD CAPTURE — Page headline: [write it]. CTA: [write it]. Lead magnet: [name the specific offer]. Target conversion rate: [X]%.",
      "QUALIFICATION — Question 1: [write it] | Question 2: [write it] | Question 3: [write it] | Speed-to-lead target: contact within [X] minutes.",
      "NURTURE — Tool: [specific CRM]. Sequence: [X emails over Y days]. Hot-lead trigger: [specific behavior]. Nurture-to-consultation rate: [X]%.",
      "CONSULTATION — Booking tool: [specific]. Call length: [X min]. Pre-call SMS: [write the exact text]. Show rate target: [X]%.",
      "CLOSE — Agreement type: [buyer rep / listing]. Close rate from consultation: [X]%. First-contact-to-signed: [X days]."
    ],
    "crmStructure": [
      "CONTACT FIELDS — Required at entry: name, phone, email, lead source, property type, price range, timeline, motivation.",
      "PIPELINE STAGES — New Lead (SLA: 5 min) → Attempted Contact → Contacted → Consultation Booked → Active Client → Under Contract → Closed Won / Lost.",
      "AUTOMATION TRIGGERS — No contact day 3: text [template A] + call task. Day 7: email [template B] + escalate. Day 14: long-term nurture. No-show: reschedule text within 1hr.",
      "LEAD SCORING — +20 responded | +25 booked consultation | +30 attended | −10 no response 7 days. Hot threshold: 60+ → immediate push notification.",
      "MONTHLY KPIs — Leads in: [X]/mo | 5-min contact rate: 80%+ | Consultations: [X]/mo | Show rate: 70%+ | Agreements signed: [X]/mo | GCI: $[X]/mo."
    ]
  }
}

Fill every "body" field with complete written content. Write every word as if you are the agent.`.trim(),

  executionPromptTemplate: (blueprint, buildOutput) => `
You are an execution strategist. This real estate operator just built their growth plan. Give them a structured execution roadmap and their exact first action.

Their business:
- Model: ${blueprint.businessIdea ?? ''}
- Target client: ${blueprint.targetMarket ?? ''}
- Strategy: ${blueprint.strategy ?? ''}
- Funnel step 1: ${(buildOutput.funnelSteps ?? [])[0] ?? ''}

Write every sentence as a direct command. No hedging words.

Return ONLY this JSON object — no prose, no markdown fences:
{
  "executionPlan": {
    "immediate": [
      "Find your first 10 target leads: search Zillow, Facebook Marketplace, and LinkedIn for your market and price range right now.",
      "Make your first 5 calls: open your Cold Call Script asset and dial within the next 2 hours — leave a voicemail for every no-answer."
    ],
    "thisWeek": [
      "Send Email 1 from your drip sequence to every lead you reached — set calendar reminders for Day 3 follow-ups.",
      "Book 3 consultation calls: send your booking link in every follow-up and confirm each with the pre-call SMS."
    ],
    "nextPhase": [
      "Close your first agreement: run your Listing Presentation script, handle objections, and get the contract signed."
    ]
  },
  "firstTask": {
    "title": "Contact Your First 10 Leads Today",
    "objective": "Build an initial prospect list and make first contact within the next 2 hours.",
    "steps": [
      "Open Zillow, filter by your price range, sort by Recently Listed — copy 5 names and phone numbers",
      "Search Facebook Groups for '[City] Real Estate' — copy 3 names and phone numbers",
      "Search LinkedIn by job title and city — copy 2 contacts",
      "Open your Cold Call Script asset and read it once before dialing",
      "Make your first call within 60 minutes of reading this — speed to lead closes deals"
    ],
    "resources": ["Zillow", "Facebook Groups", "LinkedIn", "Cold Call Script asset", "Google Sheets or CRM"],
    "deliverable": "10 leads in a spreadsheet with names, phone numbers, and first contact attempted."
  },
  "marketing": {
    "poster": {
      "prompt": "[Write a complete DALL-E 3 image prompt for a professional real estate marketing poster for this business: ${blueprint.businessIdea ?? ''}. Describe: imagery (luxury property exterior, professional agent headshot overlay, or skyline), color palette (navy, white, gold accents), headline placement area, and premium real estate brand feel. 3–4 sentences, no instruction brackets in output.]",
      "description": "Real estate marketing poster"
    },
    "website": {
      "prompt": "[Write a complete DALL-E 3 image prompt for a real estate agent website hero image. Describe: background scene (upscale property exterior or interior, or city skyline at golden hour), atmospheric treatment, lifestyle elements (family, couple, or professional agent), color warmth and lighting, and premium feel. Wide landscape format, no readable text. 3–4 sentences, no instruction brackets in output.]",
      "description": "Real estate website hero image"
    }
  }
}

Tailor the executionPlan and firstTask specifically to this market and strategy: ${blueprint.businessIdea ?? ''}`.trim(),
};

const constructionEngine: EngineConfig = {
  id: 'construction',
  category: 'Local & Service',
  name: 'Construction Company',
  description: 'Launch and grow a construction or contracting business',
  icon: '🏗',
  detail: 'Blueprint · Bid letter · Proposal template · Service offerings',
  systemPrompt: `You are a construction business growth expert who has helped 80+ contractors build $1M+ businesses through systemized bidding, marketing, and operations. ${TONE}`,
  questions: [
    { key: 'serviceFocus', label: 'Service focus?',          type: 'text' },
    { key: 'location',     label: 'Location / city?',        type: 'text' },
    { key: 'clientType',   label: 'Primary client type',     type: 'select', options: ['residential', 'commercial'] },
  ],
  promptTemplate: (answers) => `
Build a complete Construction Company growth package:
- Service focus: ${answers.serviceFocus}
- Location: ${answers.location}
- Client type: ${answers.clientType}

Write 5 assets in full before placing them in the JSON.

ASSET 1 — Company Overview / Bid Cover Letter (type: "Bid Cover Letter")
Write a professional 200-word company overview and bid cover letter for ${answers.clientType} clients in ${answers.location}. State: who you are, your ${answers.serviceFocus} specialization, years or projects of experience, your quality commitment, what makes your bid different, and a CTA to discuss the project.

ASSET 2 — Google Ads (type: "Google Ads")
Write: Headline 1 (30 chars, include ${answers.location}). Headline 2 (30 chars, ${answers.serviceFocus}-specific). Headline 3 (30 chars, CTA or trust signal). Description 1 (90 chars, proof point or guarantee). Description 2 (90 chars, differentiator).

ASSET 3 — Referral Script (type: "Referral Script")
Write a word-for-word script for asking past clients for referrals in person or by phone. Opener (reference the project). Ask (specific phrasing). Incentive mention. How to refer. Thank you close.

ASSET 4 — Project Proposal Template (type: "Project Proposal")
Write a structured proposal: Project Overview (1 paragraph restating the scope), Scope of Work (5 bullet deliverables), Timeline (phases), Payment Schedule (3 milestones with amounts), Warranty Terms, and signature line.

ASSET 5 — Website Hero Copy (type: "Website Hero")
Write the full hero section: H1 (8 words max, specific to ${answers.serviceFocus} in ${answers.location}), subheadline (15 words, promise + differentiator), 3 trust signals (license, insurance, experience stat), and primary CTA button text.

Return this JSON:
{
  "blueprint": {
    "businessIdea": "One sentence: the ${answers.serviceFocus} contracting company, ${answers.clientType} focus, ${answers.location} market, and key differentiator.",
    "targetMarket": "Specific client profile: homeowner or business decision-maker, typical project size, what they fear most in hiring a contractor, how they find contractors.",
    "revenueModel": "Average project revenue for ${answers.serviceFocus}. Target projects per month. Monthly revenue goal. Markup target on materials + labor. Break-even overhead coverage.",
    "strategy": "2 lead generation channels (Google Ads, referrals, Houzz, etc.) with monthly budget and expected leads. Bidding win rate target. 90-day revenue target."
  },
  "assets": [
    {"type": "Bid Cover Letter", "body": ""},
    {"type": "Google Ads", "body": ""},
    {"type": "Referral Script", "body": ""},
    {"type": "Project Proposal", "body": ""},
    {"type": "Website Hero", "body": ""}
  ],
  "buildOutput": {
    "serviceOfferings": [
      "SERVICE 1 — ${answers.serviceFocus} [primary]: Typical scope: [description] | Typical project size: $[X]–$[Y] | Timeline: [Z weeks] | Margin target: [%]",
      "SERVICE 2 — [Related service]: Typical scope: [description] | Project size: $[X]–$[Y] | Margin target: [%] | Upsell from: [service 1]",
      "SERVICE 3 — [Add-on or specialty]: Typical scope: [description] | Project size: $[X]–$[Y] | When to offer: [trigger]",
      "SERVICE 4 — Maintenance / Service contracts: Annual agreement for ${answers.clientType} clients | Rate: $[X]/year | Benefit: recurring revenue + referral source"
    ],
    "bidProcess": [
      "LEAD RECEIVED: Respond within 2 hours — call or text to schedule site visit. Speed wins bids.",
      "SITE VISIT (Day 1-2): Walk the job, take photos and measurements, identify scope risks. Ask budget question directly.",
      "ESTIMATE (Day 3-4): Materials + labor + 20% overhead + [X]% profit margin. Use consistent pricing spreadsheet.",
      "PROPOSAL DELIVERY (Day 4-5): Send via email with cover letter asset. Follow up with a call within 24 hours.",
      "NEGOTIATION: One revision maximum. Do not discount more than 5% without scope reduction.",
      "CONTRACT SIGNED: Collect 30% deposit. Schedule start date. Order materials. Add to project board."
    ]
  }
}

Fill every body field with complete written content.`.trim(),
  executionPromptTemplate: genericExec('Construction Company'),
};

const cleaningEngine: EngineConfig = {
  id: 'cleaning',
  category: 'Local & Service',
  name: 'Cleaning Service',
  description: 'Launch a residential or commercial cleaning business',
  icon: '🧹',
  detail: 'Blueprint · Ad creative · Booking scripts · Service packages',
  systemPrompt: `You are a cleaning business growth expert who has helped 150+ cleaning companies scale to $30K+/month through systemized marketing, pricing, and operations. ${TONE}`,
  questions: [
    { key: 'cleaningType',     label: 'Service type',           type: 'select', options: ['residential', 'commercial'] },
    { key: 'city',             label: 'City / area?',           type: 'text' },
    { key: 'pricingStructure', label: 'Pricing structure',      type: 'select', options: ['hourly', 'flat-rate'] },
  ],
  promptTemplate: (answers) => `
Build a complete Cleaning Service business package:
- Service type: ${answers.cleaningType}
- City: ${answers.city}
- Pricing: ${answers.pricingStructure}

Write 5 assets in full before placing them in the JSON.

ASSET 1 — Facebook Ad (type: "Facebook Ad")
Write all 3 parts targeting ${answers.cleaningType} clients in ${answers.city}: Primary text (100 words, open with a before/after hook specific to ${answers.city} homeowners/offices, include one social proof element, close with direct booking CTA). Headline (40 chars). Description (30 chars).

ASSET 2 — Google Business Post (type: "Google Business Post")
Write a 130-word Google Business Profile post announcing the cleaning service. Open with a hook about cleanliness in ${answers.city}. Describe what sets this service apart (2 sentences). State the service type and pricing approach. CTA to book online or call.

ASSET 3 — Booking Call Script (type: "Booking Script")
Write a word-for-word phone script for converting inbound inquiries. Greeting. 3 qualifying questions (home/office size, frequency, last cleaned). Price quote delivery (${answers.pricingStructure} method). Objection handle for price. Booking close with specific available date.

ASSET 4 — Post-Service Email (type: "Follow-Up Email")
Write a 120-word email sent after the first cleaning. Thank them. Ask for a Google review with direct link placeholder. Offer a recurring booking discount. Include a referral incentive (credit or discount for each referral).

ASSET 5 — Referral Card Copy (type: "Referral Card")
Write all copy for a physical or digital referral card: headline (8 words, benefit-first), offer for the referrer (what they get), offer for the referred client (first-clean discount), how to redeem, and business name/contact placeholder.

Return this JSON:
{
  "blueprint": {
    "businessIdea": "One sentence: the ${answers.cleaningType} cleaning service, ${answers.city} market, ${answers.pricingStructure} pricing, and key differentiator.",
    "targetMarket": "Specific client profile: homeowner or office manager, why they hire out cleaning, what they hate about other cleaning services, frequency and budget.",
    "revenueModel": "${answers.pricingStructure} rates by service tier. Average ticket per clean. Target weekly cleans. Monthly revenue goal. Recurring vs one-time client ratio.",
    "strategy": "2 client acquisition channels (Facebook Ads, Google, door-to-door, Nextdoor). First 10 clients plan. Recurring client conversion strategy. 90-day revenue target."
  },
  "assets": [
    {"type": "Facebook Ad", "body": ""},
    {"type": "Google Business Post", "body": ""},
    {"type": "Booking Script", "body": ""},
    {"type": "Follow-Up Email", "body": ""},
    {"type": "Referral Card", "body": ""}
  ],
  "buildOutput": {
    "servicePackages": [
      "STANDARD CLEAN — [Bedrooms + bathrooms + kitchen + living areas] | Time: [X hrs for average home/office] | ${answers.pricingStructure} rate: $[Y] | Frequency: weekly/biweekly/monthly",
      "DEEP CLEAN — All standard areas + [baseboards, inside appliances, blinds, cabinets] | Time: [X hrs] | Rate: $[Y] | Best for: first-time clients, move-in/out, spring clean",
      "MOVE IN/OUT — Full property clean for tenant turnover | Rate: $[Y]–$[Z] depending on size | Turnaround: 24-hour availability | Targets: property managers, realtors",
      "COMMERCIAL — [Office/retail space] | Frequency: daily/weekly | Rate: $[X]/visit or $[Y]/mo contract | Minimum: [sqft or rooms]"
    ],
    "operationsChecklist": [
      "KITCHEN: Countertops + sink + stovetop + microwave exterior + cabinet fronts + floor | Supplies: [list] | Time: [X min]",
      "BATHROOMS: Toilet (inside + outside) + sink + mirror + shower/tub + floor | Supplies: [list] | Time: [X min]",
      "BEDROOMS: Dust surfaces + make beds + vacuum + baseboards | Supplies: [list] | Time: [X min per room]",
      "COMMON AREAS: Dust + vacuum/mop + windows (interior) + light switches + doorknobs | Time: [X min]",
      "FINAL CHECK: Walk through every room + photo documentation + lock up procedure + leave thank-you card"
    ]
  }
}

Fill every body field with complete written content.`.trim(),
  executionPromptTemplate: genericExec('Cleaning Service'),
};

const landscapingEngine: EngineConfig = {
  id: 'landscaping',
  category: 'Local & Service',
  name: 'Landscaping Business',
  description: 'Build a lawn care and landscaping operation',
  icon: '🌿',
  detail: 'Blueprint · Service flyer · Proposal template · Seasonal plan',
  systemPrompt: `You are a landscaping business growth expert who has helped 100+ operators build $500K+ landscaping operations through route-density pricing, referrals, and systematic quoting. ${TONE}`,
  questions: [
    { key: 'serviceType',   label: 'Primary service type?',   type: 'text' },
    { key: 'region',        label: 'Region / city?',          type: 'text' },
    { key: 'contractModel', label: 'Contract model',          type: 'select', options: ['one-time', 'seasonal contract'] },
  ],
  promptTemplate: (answers) => `
Build a complete Landscaping Business package:
- Service: ${answers.serviceType}
- Region: ${answers.region}
- Model: ${answers.contractModel}

Write 5 assets in full before placing them in the JSON.

ASSET 1 — Service Flyer Copy (type: "Service Flyer")
Write all 5 elements for a door hanger or digital flyer: Headline (8 words max, benefit-first). Subheadline (15 words, names service + region). Body (40 words on service + quality + reliability). Offer (first service discount or free estimate). CTA (call/text number or website).

ASSET 2 — Cold Call Script (type: "Cold Call Script")
Write a word-for-word script for calling homeowners in ${answers.region} about ${answers.serviceType}. Opener (who you are, why calling this neighborhood). Qualification question (current lawn care situation). Value statement (what you do differently). Quote offer. Close (schedule a free estimate).

ASSET 3 — Google Ads (type: "Google Ads")
Write: Headline 1 (30 chars, include ${answers.region}). Headline 2 (30 chars, service-specific). Headline 3 (30 chars, CTA). Description 1 (90 chars). Description 2 (90 chars with guarantee or urgency).

ASSET 4 — Client Proposal Template (type: "Proposal Template")
Write a structured proposal: site assessment summary (2 sentences), scope of work (4 bullet services), schedule (${answers.contractModel} terms), investment (price + what's included), and start date close.

ASSET 5 — Referral Email (type: "Referral Email")
Write a 150-word email to current clients asking for neighbor referrals. Subject line. Reference their good experience. Explain the referral incentive (discount or credit). Tell them exactly how to refer. Thank them.

Return this JSON:
{
  "blueprint": {
    "businessIdea": "One sentence: the ${answers.serviceType} landscaping business, ${answers.region} market, ${answers.contractModel} model, and differentiator.",
    "targetMarket": "Specific homeowner or commercial property manager: neighborhood type, property size, why they hire out, what they hate about their current service.",
    "revenueModel": "${answers.contractModel} pricing for each service. Average contract value. Target active clients. Monthly recurring revenue goal. Revenue per truck/crew.",
    "strategy": "2 lead channels (door hangers, Google Ads, referrals). Route density strategy (target one zip code first). First 15 clients plan. 90-day revenue target."
  },
  "assets": [
    {"type": "Service Flyer", "body": ""},
    {"type": "Cold Call Script", "body": ""},
    {"type": "Google Ads", "body": ""},
    {"type": "Proposal Template", "body": ""},
    {"type": "Referral Email", "body": ""}
  ],
  "buildOutput": {
    "serviceOfferings": [
      "${answers.serviceType} — CORE SERVICE: [Scope] | Frequency: [weekly/biweekly/as-needed] | ${answers.contractModel} price: $[X]/visit or $[Y]/season | Margin: [Z]%",
      "LAWN MAINTENANCE — Mowing + edging + blowing | Frequency: weekly | Price: $[X]–$[Y] depending on size | Upsell from: first visit",
      "SEASONAL CLEANUP — Spring and fall cleanups | Price: $[X]–$[Y] per property | Best margin: [Z]% | Sell in advance as add-on",
      "MULCH/BED MAINTENANCE — Annual mulching + bed edging | Price: $[X] per yard installed | High margin: [Z]% | Sell in March/April",
      "MAINTENANCE CONTRACT — Annual agreement: all services included | Price: $[X]/mo | Benefit: predictable revenue + priority scheduling"
    ],
    "seasonalPlan": [
      "Q1 (Jan-Mar): Pre-season marketing push — send flyers, run Google Ads, lock in contracts for spring | Revenue: [X]% of annual from retainers",
      "Q2 (Apr-Jun): PEAK SEASON — mowing + spring cleanup + mulching | Maximize crew utilization | Upsell: irrigation and landscaping installs",
      "Q3 (Jul-Sep): Mowing peak continues + aeration + overseeding sales in Aug-Sep | Add commercial clients to fill weekday capacity",
      "Q4 (Oct-Dec): Fall cleanup + leaf removal + holiday lighting install | Sell spring contracts early at discount | Plan equipment maintenance"
    ]
  }
}

Fill every body field with complete written content.`.trim(),
  executionPromptTemplate: genericExec('Landscaping Business'),
};

// ════════════════════════════════════════════════════════════════════════════
// RETAIL & HOSPITALITY
// ════════════════════════════════════════════════════════════════════════════

const restaurantEngine: EngineConfig = {
  id: 'restaurant',
  category: 'Retail & Hospitality',
  name: 'Restaurant Growth',
  description: 'Launch and optimize your restaurant for profitability',
  icon: '🍽',
  detail: 'Blueprint · Marketing assets · Menu · Pricing · Landing page',
  systemPrompt:
    `You are a restaurant operations and profitability strategist who has launched 30+ concepts and engineered menus that consistently hit 28–32% food cost. ${TONE} Write as the owner.`,
  questions: [
    { key: 'cuisine',     label: 'Cuisine type?',    type: 'text' },
    { key: 'location',    label: 'Location / city?', type: 'text' },
    { key: 'serviceType', label: 'Service type',     type: 'select', options: ['dine-in', 'takeout'] },
  ],
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
Close with a brand tagline.

ASSET 2 — Instagram Captions (type: "Instagram Captions")
Write 5 complete captions separated by "---".
Caption 1 — Hero dish reveal: 70-word caption with sensory hook, dish name, price, 5 ${answers.location}-specific hashtags.
Caption 2 — Behind the scenes: 60-word kitchen/prep story with personal voice.
Caption 3 — Guest experience: 60-word caption written as if a guest is describing their visit.
Caption 4 — Limited time offer: 75-word caption with urgency, specific offer, and CTA.
Caption 5 — Local community: 65-word caption connecting the restaurant to ${answers.location}, with local hashtags.

ASSET 3 — Review Response Templates (type: "Review Responses")
Write both in full separated by "---".
5-STAR RESPONSE: 3 sentences. Thank + specific dish reference + invite back.
1-STAR RESPONSE: 4 sentences. Acknowledge + take responsibility + specific resolution + invite to reach out.
Label each clearly.

ASSET 4 — B2B Catering Outreach Email (type: "Catering Outreach Email")
Subject line on line 1. 100–120 word body: reference feeding their team well, introduce the concept, specific group lunch offer with price, one social proof line, CTA to book a tasting. Sign-off with name, title, restaurant name, phone.

ASSET 5 — Promotional Flyer Copy (type: "Promo Flyer")
Write all 5 copy elements: Headline (max 8 words). Subheadline (max 15 words). Body (35–45 words). CTA (exact action). Urgency line (deadline or scarcity).

Now return the full JSON:

{
  "blueprint": {
    "businessIdea": "One sentence: concept name, cuisine angle, ${answers.serviceType} model, and position in ${answers.location} market — written as an investor pitch.",
    "targetMarket": "Specific guest profile: age range, income, neighborhood in ${answers.location}, visit frequency, average check, 3 decision drivers, and the day-part driving 60% of covers.",
    "revenueModel": "Average check per head, table turns per service, covers per day, daily and monthly revenue target. Break down by revenue stream. Food cost target (%) and prime cost (<65%). 2 highest-margin items.",
    "strategy": "Grand opening: pre-launch actions 2 weeks out, 1 week out, opening day. 2 local marketing channels with budget. Repeat visit driver. 90-day ramp: week 1 covers, month 1 revenue, month 3 steady-state."
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
      "APPETIZERS — [Dish 1]: [10-word description] — $[price] (food cost [X]%, margin [Y]%) | [Dish 2]: [description] — $[price] | [Dish 3]: [description] — $[price]. Star: [Dish 1 or 2] — highest margin, push verbally.",
      "MAINS — [Dish 1 — STAR]: [15-word description] — $[price] (food cost [X]%) | [Dish 2 — PLOWHORSE]: [description] — $[price] | [Dish 3]: [description] — $[price] | [Dish 4]: [description] — $[price]",
      "SIDES — [Dish 1]: [description] — $[price] (attaches to 40%+ of mains) | [Dish 2]: [description] — $[price] | [Dish 3]: [description] — $[price]",
      "DESSERTS — [Dish 1]: [description] — $[price] (presented on dessert card, impulse buy) | [Dish 2]: [description] — $[price] | [Dish 3 — shareable]: [description for 2] — $[price]",
      "DRINKS — Signature: [name] — $[price] (photo-worthy, drives Instagram) | Mocktail: [name] — $[price] | Draft: [local brewery] — $[price] | Server upsell line: [write it]"
    ],
    "pricing": [
      "UNIT ECONOMICS — Avg check/head: $[X]. Table spend (2 guests): $[Y]. Food cost target: [Z]%. Labor cost: [W]%. Prime cost: <65%. Contribution margin/cover: $[amount].",
      "BREAK-EVEN — Fixed monthly costs: $[X]. Variable cost/cover: $[Y]. Break-even covers/month: [Z]. Current daily target: [A] covers.",
      "MENU ENGINEERING — Stars (high pop, high margin): [dishes] — protect. Plowhorses (high pop, low margin): [dishes] — raise price $1–2. Puzzles (low pop, high margin): [dishes] — reposition. Dogs: remove.",
      "90-DAY RAMP — Week 1: [X] covers/day at $[avg] = $[daily]. Month 1: $[monthly] (soft launch). Month 2: $[monthly] (paid ads). Month 3: $[monthly] steady state, repeat >30%."
    ],
    "landingPageSections": [
      "HERO — H1: [headline, 8 words, specific to ${answers.cuisine} in ${answers.location}] | Subheading: [15 words] | Primary CTA: [${answers.serviceType} action] | Secondary CTA: [view menu]",
      "ABOUT — [3-sentence section: cuisine origin, what makes it different in ${answers.location}, the promise to the guest]",
      "MENU HIGHLIGHTS — [Dish 1 name + 10-word description + $price] | [Dish 2] | [Dish 3] — 3 highest-margin, most photogenic items",
      "SOCIAL PROOF — Review 1: [2-sentence 5-star quote] — [Name, ${answers.location}] | Review 2: [about ${answers.serviceType}] | Review 3: [about the food]",
      "ORDER CTA — Section headline: [max 6 words] | Body: [20 words] | Button: [${answers.serviceType} CTA] | Trust line: [1-sentence reassurance]"
    ]
  }
}

Fill every "body" field with complete written content. Write every word as the restaurant owner.`.trim(),

  executionPromptTemplate: (blueprint, buildOutput) => `
You are an execution strategist. This restaurant owner just built their launch plan. Give them a structured execution roadmap and their exact first action.

Their concept:
- Concept: ${blueprint.businessIdea ?? ''}
- Target guest: ${blueprint.targetMarket ?? ''}
- Revenue model: ${blueprint.revenueModel ?? ''}
- Grand opening strategy: ${blueprint.strategy ?? ''}
- Menu highlight: ${(buildOutput.menu ?? [])[1] ?? ''}

Write every sentence as a direct command. No hedging words.

Return ONLY this JSON object — no prose, no markdown fences:
{
  "executionPlan": {
    "immediate": [
      "Post your launch content: paste your Google Business Post, Instagram Caption 1, and Promo Flyer copy across all 3 platforms in the next 20 minutes.",
      "Claim your Google Business Profile: verify ownership and post your announcement today — local search traffic starts within 24 hours."
    ],
    "thisWeek": [
      "Email 5 local offices: send your Catering Outreach Email asset to HR directors and office managers within 5 miles — book your first group tasting.",
      "Finalize and print your menu: use the exact items and prices from your menu build output — send to printer by end of week."
    ],
    "nextPhase": [
      "Execute grand opening day: run your full opening-day marketing push, fill your first covers, and capture content for week 2 social posts."
    ]
  },
  "firstTask": {
    "title": "Launch Your First Promotion Today",
    "objective": "Create immediate local awareness by publishing your launch content across all platforms in under 20 minutes.",
    "steps": [
      "Open Google Business Profile → paste your Google Business Post asset → publish",
      "Open Instagram → post Caption 1 with your hero dish photo → publish",
      "Open Nextdoor → paste your Promo Flyer body copy → publish",
      "Open Facebook Local Groups → share the same promo → publish",
      "Screenshot all 4 published posts as proof of your launch going live"
    ],
    "resources": ["Google Business Profile", "Instagram", "Nextdoor", "Facebook", "Your Deploy-Ready Assets"],
    "deliverable": "All 4 social posts live and receiving impressions — first inquiries expected within 24 hours."
  },
  "marketing": {
    "poster": {
      "prompt": "[Write a complete DALL-E 3 image prompt for a restaurant marketing poster for this concept: ${blueprint.businessIdea ?? ''}. Describe: hero food photography style (signature dish beautifully plated), background treatment (dark rustic, bold vibrant, or clean white), typography placement area, atmospheric lighting, and specific cuisine aesthetic. 3–4 sentences, no instruction brackets in output.]",
      "description": "Restaurant marketing poster"
    },
    "website": {
      "prompt": "[Write a complete DALL-E 3 image prompt for a restaurant website hero image for this concept. Describe: full-width composition (food, dining atmosphere, or chef in action), lighting mood (warm candlelight, bright natural, or moody evening), color palette matching the cuisine style, and photorealistic food photography or lifestyle dining aesthetic. Wide landscape format, no readable text. 3–4 sentences, no instruction brackets in output.]",
      "description": "Restaurant website hero image"
    }
  }
}

Tailor the executionPlan and firstTask specifically to this concept and location: ${blueprint.businessIdea ?? ''}`.trim(),
};

const ghostKitchenEngine: EngineConfig = {
  id: 'ghostkitchen',
  category: 'Retail & Hospitality',
  name: 'Ghost Kitchen',
  description: 'Launch a delivery-only food brand on DoorDash or UberEats',
  icon: '👻',
  detail: 'Blueprint · Platform listing · Menu engineering · Delivery optimization',
  systemPrompt: `You are a ghost kitchen launch expert who has opened 20+ delivery-only concepts and achieved top-10 rankings on DoorDash and UberEats in competitive markets. ${TONE} Write as the operator.`,
  questions: [
    { key: 'cuisine',          label: 'Cuisine type?',        type: 'text' },
    { key: 'deliveryPlatform', label: 'Primary platform',     type: 'select', options: ['DoorDash', 'UberEats', 'both'] },
    { key: 'priceRange',       label: 'Average order price?', type: 'text' },
  ],
  promptTemplate: (answers) => `
Build a complete Ghost Kitchen launch package:
- Cuisine: ${answers.cuisine}
- Platform: ${answers.deliveryPlatform}
- Price range: ${answers.priceRange}

Write 5 assets in full before placing them in the JSON.

ASSET 1 — Platform Listing Copy (type: "Platform Listing")
Write the complete ${answers.deliveryPlatform} restaurant listing: brand name concept (2-3 words), restaurant description (150 words: cuisine story, signature style, why this stands out on the platform, what to order first), and descriptions for 5 menu items (each 30 words: dish name + ingredients + why it's special).

ASSET 2 — Instagram Captions (type: "Instagram Captions")
Write 3 captions separated by "---": Caption 1 (hero dish reveal, 70 words, strong visual hook + taste description + delivery CTA). Caption 2 (behind-the-scenes kitchen prep, 60 words, personal/authentic voice). Caption 3 (limited promo or new item, 75 words, urgency + link to order).

ASSET 3 — Promotional Offer Post (type: "Promo Post")
Write a 120-word social media post announcing a launch promotion. Urgency hook. Describe the offer (discount, free item, or bundle). How to claim it (order on ${answers.deliveryPlatform}). Scarcity or deadline. CTA with direct link placeholder.

ASSET 4 — Review Response Templates (type: "Review Responses")
Write both for delivery platforms, separated by "---": 5-STAR (3 sentences: thank + reference their dish + invite back with a specific next item to try). 1-STAR (4 sentences: acknowledge + apologize for specific issue + resolution + invite to reorder). Label each.

ASSET 5 — B2B Meal Prep Pitch (type: "B2B Pitch")
Write a 200-word outreach email to local gyms, offices, or meal-prep buyers offering bulk ordering. Subject line. Introduction of the brand and cuisine. The group order offer (minimum, price, delivery range). Social proof or quality claim. CTA to schedule a tasting or first group order.

Return this JSON:
{
  "blueprint": {
    "businessIdea": "One sentence: the ghost kitchen concept, ${answers.cuisine} cuisine, ${answers.deliveryPlatform} platform, and target average order value.",
    "targetMarket": "Specific delivery customer: neighborhood, order occasion (lunch/dinner/late night), what they order from competitors, why they'll try a new brand.",
    "revenueModel": "Average order value: ${answers.priceRange}. Target orders/day. Daily and monthly revenue. Platform commission impact. Food cost target. Net margin after platform fees.",
    "strategy": "Platform launch: listing optimization, early review strategy, promotional launch offer. Off-platform growth: Instagram, B2B. 90-day revenue and rating targets."
  },
  "assets": [
    {"type": "Platform Listing", "body": ""},
    {"type": "Instagram Captions", "body": ""},
    {"type": "Promo Post", "body": ""},
    {"type": "Review Responses", "body": ""},
    {"type": "B2B Pitch", "body": ""}
  ],
  "buildOutput": {
    "menu": [
      "HERO ITEM — [Name]: [20-word description] | Price: $[X] | Food cost: [Y]% | Why it wins: [photography appeal + platform search keyword]",
      "BESTSELLER — [Name]: [description] | Price: $[X] | Food cost: [Y]% | Position: top of menu, highest reorder rate",
      "BUNDLE DEAL — [Name + components]: [description] | Bundle price: $[X] | Upsell: every order, train platform algorithm",
      "HIGH MARGIN — [Name]: [description] | Price: $[X] | Food cost: [Y — target <20%]% | Placement: featured item",
      "DESSERT/ADD-ON — [Name]: [description] | Price: $[X] | Attach rate target: 30%+ | Add-to-cart prompt in platform"
    ],
    "deliveryOptimization": [
      "LISTING SEO: Use keywords [${answers.cuisine} delivery, [city], [occasion]] in restaurant name and description | Photos: minimum 10 high-res images, hero dish first",
      "PACKAGING: Branded bags + stickers | Containers: [specific type for ${answers.cuisine} to maintain quality in transit] | Temperature: [hot/cold packaging spec]",
      "PEAK HOURS: Target top delivery windows — [Lunch: 11am-1pm | Dinner: 5pm-9pm | Late night if applicable] | Prep time: set to [15-20] min max on platform",
      "RATING STRATEGY: Include a card in every order asking for 5-star review on ${answers.deliveryPlatform} | Target: 50 reviews in first 30 days | Response to every review within 2 hours",
      "PROMO STRATEGY: Week 1-2: [X]% off all orders to drive trial | Week 3-4: free item with orders over $[Y] | Month 2: remove promos, maintain rating-driven organic rank"
    ]
  }
}

Fill every body field with complete written content.`.trim(),
  executionPromptTemplate: genericExec('Ghost Kitchen'),
};

const retailStoreEngine: EngineConfig = {
  id: 'retailstore',
  category: 'Retail & Hospitality',
  name: 'Retail Store',
  description: 'Launch and grow a retail store or boutique',
  icon: '🏪',
  detail: 'Blueprint · Store copy · Marketing plan · Product categories',
  systemPrompt: `You are a retail business launch expert who has helped 60+ store owners achieve $500K+ in first-year revenue through product curation, local marketing, and customer experience design. ${TONE} Write as the store owner.`,
  questions: [
    { key: 'niche',        label: 'Store niche or category?',  type: 'text' },
    { key: 'locationType', label: 'Store format',              type: 'select', options: ['storefront', 'online', 'both'] },
    { key: 'pricingTier',  label: 'Pricing tier',             type: 'select', options: ['budget', 'mid-range', 'premium'] },
  ],
  promptTemplate: (answers) => `
Build a complete Retail Store launch package:
- Niche: ${answers.niche}
- Format: ${answers.locationType}
- Pricing: ${answers.pricingTier}

Write 5 assets in full before placing them in the JSON.

ASSET 1 — Store Description / About Copy (type: "Store Description")
Write a 200-word about section for the store's website, Google Business Profile, and Yelp. Open with a bold positioning statement about the ${answers.niche} niche. Share the store's story and mission (2 sentences). Describe what makes the curation and experience different. Name the specific ${answers.pricingTier} price point and what it means for quality. Close with a CTA to visit or shop.

ASSET 2 — Google Business Post (type: "Google Business Post")
Write a 130-word Google Business post announcing the store or promoting a new arrival. Hook: a specific product or reason to visit. Describe the experience of shopping here. State the format (${answers.locationType}) and hours. CTA to visit, call, or shop online.

ASSET 3 — Promotional Email (type: "Promo Email")
Write a 150-word promotional email to existing customers. Subject line (urgency or curiosity hook). Feature a specific product or sale. Describe the offer in detail. 2-sentence story about why this product was chosen. CTA to shop with link placeholder. Urgency line (deadline or limited stock).

ASSET 4 — Instagram Caption (type: "Instagram Caption")
Write an 80-word lifestyle/product caption for the hero product category. Sensory/visual hook. Brief product story. Price and where to get it. 5 niche-specific hashtags including a local one.

ASSET 5 — Loyalty Program Pitch (type: "Loyalty Pitch")
Write a 150-word in-store or email pitch for a loyalty or rewards program. Explain how it works (points or punch card). What they earn. Why it's worth joining. How to sign up. Close with an immediate incentive for signing up today.

Return this JSON:
{
  "blueprint": {
    "businessIdea": "One sentence: the ${answers.niche} retail store, ${answers.locationType} format, ${answers.pricingTier} positioning, and customer promise.",
    "targetMarket": "Specific customer profile: demographics, shopping habits, what they currently buy and where, what they hate about alternatives, average transaction size.",
    "revenueModel": "Average transaction value. Target daily transactions. Monthly revenue goal. Margin target by category. Seasonal revenue distribution. Online vs in-store split.",
    "strategy": "2 marketing channels (Instagram, Google, local events). Grand opening plan. Repeat customer strategy. 90-day revenue target."
  },
  "assets": [
    {"type": "Store Description", "body": ""},
    {"type": "Google Business Post", "body": ""},
    {"type": "Promo Email", "body": ""},
    {"type": "Instagram Caption", "body": ""},
    {"type": "Loyalty Pitch", "body": ""}
  ],
  "buildOutput": {
    "productCategories": [
      "CATEGORY 1 — [Name, e.g. 'Core ${answers.niche}']: Key SKUs: [3 specific items] | Price range: $[X]–$[Y] | Margin: [Z]% | Hero item: [name — drives discovery]",
      "CATEGORY 2 — [Name]: Key SKUs: [3 items] | Price range: $[X]–$[Y] | Margin: [Z]% | Role: [impulse buy / repeat purchase / gift]",
      "CATEGORY 3 — [Name]: Key SKUs: [3 items] | Price range: $[X]–$[Y] | Margin: [Z]% | Upsell from: [Category 1]",
      "GIFT / BUNDLE — [Name]: Curated sets at $[X] | Margin: [Y]% | Peak season: [holiday/occasion] | Display: front of store for impulse"
    ],
    "marketingPlan": [
      "GOOGLE BUSINESS: Complete profile → post weekly → collect 20 reviews in first 30 days → appear in 'near me' searches",
      "INSTAGRAM: Post 5x/week (3 product + 1 lifestyle + 1 UGC) | Story daily | Collab with 2 local accounts | Hashtag strategy: [local + niche tags]",
      "EMAIL LIST: Capture at point of sale → send weekly feature + monthly promotion → target 30% open rate",
      "LOCAL EVENTS: Partner with [complementary local business] for joint promotion | Attend [local market or fair] monthly | Host in-store event quarterly",
      "SEASONAL PROMOTIONS: [Spring launch offer] | [Summer clearance] | [Back to school] | [Holiday gift guide] | [New Year promo]"
    ]
  }
}

Fill every body field with complete written content.`.trim(),
  executionPromptTemplate: genericExec('Retail Store'),
};

// ════════════════════════════════════════════════════════════════════════════
// Registry
// ════════════════════════════════════════════════════════════════════════════

export const ENGINE_CONFIGS: EngineConfig[] = [
  // Tech & Digital
  saasEngine,
  aiAgencyEngine,
  noCodeEngine,
  ecommerceEngine,
  digitalProductEngine,
  contentCreatorEngine,
  newsletterEngine,
  freelanceEngine,
  // Financial Services
  debtCollectionEngine,
  creditRepairEngine,
  taxPrepEngine,
  investmentEduEngine,
  // Local & Service
  realestateEngine,
  constructionEngine,
  cleaningEngine,
  landscapingEngine,
  // Retail & Hospitality
  restaurantEngine,
  ghostKitchenEngine,
  retailStoreEngine,
];

export function getEngineConfig(id: string): EngineConfig | undefined {
  return ENGINE_CONFIGS.find(e => e.id === id);
}
