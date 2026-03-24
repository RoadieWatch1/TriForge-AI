// ── forgeHub.ts ────────────────────────────────────────────────────────────
//
// ForgeHub: TriForge's curated skill catalog.
//
// Phase 2B scope:
//   - 8 seed skills bundled with the app (no network required)
//   - Each skill is a SKILL.md string ready for the existing skill:install flow
//   - ForgeHub does NOT execute skills — it provides raw markdown to the
//     install pipeline which runs it through the trust evaluator before storage
//
// Future phases will add:
//   - Remote catalog fetch with signature verification
//   - Version pinning and update safety
//   - Community submission pipeline
//
// Skill selection rationale:
//   Each seed skill maps to an income lane from the Income Operator and uses
//   only safe (no shell, no credential) operations to stay at low/medium risk.

export interface ForgeHubEntry {
  id:          string;
  name:        string;
  version:     string;
  description: string;
  author:      string;
  tags:        string[];
  incomeLanes: string[];
  markdown:    string;
}

// ── Seed skill catalog ──────────────────────────────────────────────────────

const SEED_SKILLS: ForgeHubEntry[] = [
  // ── 1. Gumroad Product Lister ─────────────────────────────────────────────
  {
    id:          'gumroad-product-lister',
    name:        'Gumroad Product Lister',
    version:     '1.0.0',
    description: 'Lists all products from a Gumroad store and returns sales metrics.',
    author:      'ForgeHub',
    tags:        ['gumroad', 'digital-products', 'revenue'],
    incomeLanes: ['digital_products', 'asset_packs'],
    markdown: `---
id: gumroad-product-lister
name: Gumroad Product Lister
version: 1.0.0
description: Lists all products from a Gumroad store and returns sales metrics.
author: ForgeHub
permissions: [network]
network: true
requiresApproval: true
entry: index.js
---

# Gumroad Product Lister

Fetches your Gumroad product catalog and returns name, price, sales count, and revenue for each product. Output is structured JSON for the Income Operator revenue tracker.

## What this skill does
1. Calls the Gumroad Products API using your stored access token
2. Returns each product: id, name, price, sales_count, revenue
3. Saves a summary to the TriForge audit ledger

## Required credentials
- \`gumroad_access_token\` — set via Settings → Credentials

## Output
Returns a JSON array of product objects. The Income Operator reads this to update revenue tracking.

## Approval note
This skill reads from the Gumroad API over HTTPS. No data is written or published. Approval is required because it makes a network call.
`,
  },

  // ── 2. YouTube Video Metadata Builder ────────────────────────────────────
  {
    id:          'youtube-metadata-builder',
    name:        'YouTube Metadata Builder',
    version:     '1.0.0',
    description: 'Generates SEO-optimized titles, descriptions, and tags for YouTube videos using the council.',
    author:      'ForgeHub',
    tags:        ['youtube', 'seo', 'content', 'faceless-youtube'],
    incomeLanes: ['faceless_youtube', 'short_form_brand'],
    markdown: `---
id: youtube-metadata-builder
name: YouTube Metadata Builder
version: 1.0.0
description: Generates SEO-optimized titles, descriptions, and tags for YouTube videos.
author: ForgeHub
permissions: []
requiresApproval: false
entry: index.js
---

# YouTube Metadata Builder

Uses the TriForge council to generate YouTube-ready metadata: title, description, hashtags, and tags optimized for discoverability.

## What this skill does
1. Accepts a video topic or script excerpt as input
2. Sends to the council for SEO optimization (Claude leads for copy, GPT validates)
3. Returns structured metadata: title (≤100 chars), description (≤5000 chars), tags (≤500 chars)

## Input
\`\`\`json
{ "topic": "Top 10 AI tools for freelancers in 2026" }
\`\`\`

## Output
\`\`\`json
{
  "title": "10 AI Tools That Will Replace Your Freelance Stack in 2026",
  "description": "...",
  "tags": ["AI tools", "freelance", "2026", "productivity"]
}
\`\`\`

## No approval required
This skill calls the TriForge council (local model routing) only. No external network calls, no file writes.
`,
  },

  // ── 3. Etsy Listing Generator ─────────────────────────────────────────────
  {
    id:          'etsy-listing-generator',
    name:        'Etsy Listing Generator',
    version:     '1.0.0',
    description: 'Generates complete Etsy product listings: title, description, tags, and pricing strategy.',
    author:      'ForgeHub',
    tags:        ['etsy', 'digital-products', 'listings', 'seo'],
    incomeLanes: ['digital_products', 'asset_packs'],
    markdown: `---
id: etsy-listing-generator
name: Etsy Listing Generator
version: 1.0.0
description: Generates complete Etsy product listings optimized for search visibility.
author: ForgeHub
permissions: []
requiresApproval: false
entry: index.js
---

# Etsy Listing Generator

Uses the TriForge council to produce a complete, SEO-ready Etsy product listing from a product description and target audience.

## What this skill does
1. Accepts product type, target buyer, and key features
2. Council generates: title (≤140 chars), description (structured), 13 tags, suggested price range
3. Output formatted for direct paste into Etsy's listing editor

## Input
\`\`\`json
{
  "productType": "Notion budget template",
  "targetBuyer": "small business owners",
  "features": ["monthly tracking", "invoice log", "tax categories"]
}
\`\`\`

## No approval required
Council-only. No network calls, no file writes.
`,
  },

  // ── 4. TikTok Script Writer ───────────────────────────────────────────────
  {
    id:          'tiktok-script-writer',
    name:        'TikTok Script Writer',
    version:     '1.0.0',
    description: 'Writes 15–60 second TikTok/Reels scripts optimized for hooks and watch time.',
    author:      'ForgeHub',
    tags:        ['tiktok', 'reels', 'shorts', 'script', 'short-form'],
    incomeLanes: ['short_form_brand', 'affiliate_content'],
    markdown: `---
id: tiktok-script-writer
name: TikTok Script Writer
version: 1.0.0
description: Writes TikTok and Reels scripts optimized for hooks and watch time retention.
author: ForgeHub
permissions: []
requiresApproval: false
entry: index.js
---

# TikTok Script Writer

Generates short-form video scripts (15–60 seconds) with a proven hook → value → CTA structure optimized for TikTok and Instagram Reels algorithm retention.

## What this skill does
1. Accepts niche, product/topic, and target emotion (entertain / educate / inspire)
2. Council (Grok leads for tone, Claude reviews for clarity) writes the script
3. Returns a formatted script with [HOOK], [BODY], [CTA] markers

## Input
\`\`\`json
{
  "niche": "personal finance",
  "topic": "credit card trick most people don't know",
  "emotion": "surprise"
}
\`\`\`

## No approval required
Council-only. No network calls.
`,
  },

  // ── 5. Affiliate Content Planner ─────────────────────────────────────────
  {
    id:          'affiliate-content-planner',
    name:        'Affiliate Content Planner',
    version:     '1.0.0',
    description: 'Builds a 30-day affiliate content calendar with post ideas, angles, and call-to-action templates.',
    author:      'ForgeHub',
    tags:        ['affiliate', 'content-calendar', 'planning'],
    incomeLanes: ['affiliate_content'],
    markdown: `---
id: affiliate-content-planner
name: Affiliate Content Planner
version: 1.0.0
description: Generates a 30-day affiliate content calendar with post ideas, angles, and CTAs.
author: ForgeHub
permissions: []
requiresApproval: false
entry: index.js
---

# Affiliate Content Planner

Builds a 30-day content plan for affiliate marketing. Each day includes a content angle, platform recommendation, hook, and CTA linking to the affiliate product.

## What this skill does
1. Accepts product niche, affiliate product name, and target platform(s)
2. Council generates 30 content ideas, each with: date slot, angle, platform, hook line, CTA draft
3. Output in structured JSON for import into scheduling tools

## Input
\`\`\`json
{
  "niche": "home office setup",
  "product": "standing desk brand",
  "platforms": ["TikTok", "Instagram", "YouTube Shorts"]
}
\`\`\`

## No approval required
Council-only. No network calls.
`,
  },

  // ── 6. AI Music Prompt Generator ─────────────────────────────────────────
  {
    id:          'ai-music-prompt-generator',
    name:        'AI Music Prompt Generator',
    version:     '1.0.0',
    description: 'Generates structured prompts for Suno, Udio, and other AI music tools optimized for streaming.',
    author:      'ForgeHub',
    tags:        ['ai-music', 'suno', 'udio', 'prompt-engineering'],
    incomeLanes: ['ai_music'],
    markdown: `---
id: ai-music-prompt-generator
name: AI Music Prompt Generator
version: 1.0.0
description: Generates optimized prompts for AI music generators (Suno, Udio) targeting streaming placements.
author: ForgeHub
permissions: []
requiresApproval: false
entry: index.js
---

# AI Music Prompt Generator

Builds structured generation prompts for Suno, Udio, and compatible AI music tools. Prompts are optimized for:
- Streaming distributor acceptance (DistroKid / TuneCore format)
- Playlist placement metadata tags
- Consistent genre/mood targeting

## What this skill does
1. Accepts target genre, mood, BPM range, and placement goal (background, lo-fi, cinematic, etc.)
2. Council generates: style prompt, negative prompt, recommended tags, suggested title pattern
3. Output formatted for direct paste into Suno or Udio

## Input
\`\`\`json
{
  "genre": "lo-fi hip hop",
  "mood": "focused study",
  "bpmRange": "75-90",
  "placement": "study playlist"
}
\`\`\`

## No approval required
Council-only. No network calls.
`,
  },

  // ── 7. Game Concept Brief Generator ──────────────────────────────────────
  {
    id:          'game-concept-brief',
    name:        'Game Concept Brief Generator',
    version:     '1.0.0',
    description: 'Generates a one-page game concept brief for mini-games monetizable on Itch.io.',
    author:      'ForgeHub',
    tags:        ['game-dev', 'itch-io', 'mini-games', 'concept'],
    incomeLanes: ['mini_games'],
    markdown: `---
id: game-concept-brief
name: Game Concept Brief Generator
version: 1.0.0
description: Generates a one-page game concept brief for mini-games targeting Itch.io monetization.
author: ForgeHub
permissions: []
requiresApproval: false
entry: index.js
---

# Game Concept Brief Generator

Produces a structured one-page brief for a mini-game. Output includes core loop, art style, estimated dev time, monetization model, and Itch.io page copy.

## What this skill does
1. Accepts genre, target audience, and available engine (Unity / Unreal / Godot)
2. Council generates: concept title, core loop (2–3 sentences), art direction, mechanic list, estimated dev time, Itch.io pricing recommendation, page description
3. Output in structured JSON

## Input
\`\`\`json
{
  "genre": "puzzle",
  "audience": "casual mobile gamers",
  "engine": "Unity",
  "sessionLength": "5 minutes"
}
\`\`\`

## No approval required
Council-only. No network calls.
`,
  },

  // ── 8. Asset Pack Description Writer ─────────────────────────────────────
  {
    id:          'asset-pack-description-writer',
    name:        'Asset Pack Description Writer',
    version:     '1.0.0',
    description: 'Writes marketplace-ready descriptions for 3D, UI, audio, and font asset packs.',
    author:      'ForgeHub',
    tags:        ['asset-packs', 'marketplace', 'unity-asset-store', 'unreal-fab'],
    incomeLanes: ['asset_packs'],
    markdown: `---
id: asset-pack-description-writer
name: Asset Pack Description Writer
version: 1.0.0
description: Writes marketplace-ready descriptions for asset packs on Unity Asset Store, Fab, and Gumroad.
author: ForgeHub
permissions: []
requiresApproval: false
entry: index.js
---

# Asset Pack Description Writer

Generates optimized marketplace copy for asset packs. Tailored for Unity Asset Store, Unreal Fab, and Gumroad listing formats.

## What this skill does
1. Accepts asset type, key contents, target engine/platform, and price point
2. Council writes: headline, feature bullet list, technical specs section, compatibility note, and SEO tags
3. Output formatted for each target marketplace separately

## Input
\`\`\`json
{
  "assetType": "3D low-poly environment",
  "contents": ["50 modular pieces", "4 biome themes", "LOD included"],
  "targetPlatforms": ["Unity Asset Store", "Gumroad"],
  "priceUsd": 29
}
\`\`\`

## No approval required
Council-only. No network calls.
`,
  },
];

// ── Public API ──────────────────────────────────────────────────────────────

/** Returns all seed skills in the catalog. */
export function listForgeHubSkills(): ForgeHubEntry[] {
  return SEED_SKILLS;
}

/** Returns a single skill by ID, or undefined if not found. */
export function getForgeHubSkill(id: string): ForgeHubEntry | undefined {
  return SEED_SKILLS.find(s => s.id === id);
}

/** Returns skills filtered by income lane ID. */
export function getSkillsForLane(laneId: string): ForgeHubEntry[] {
  return SEED_SKILLS.filter(s => s.incomeLanes.includes(laneId));
}

/** Returns the raw SKILL.md markdown for a skill by ID. */
export function getSkillMarkdown(id: string): string | undefined {
  return SEED_SKILLS.find(s => s.id === id)?.markdown;
}
