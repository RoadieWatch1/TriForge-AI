// ── starterPacks.ts ───────────────────────────────────────────────────────────
//
// Phase 7.2 — Curated income starter packs.
//
// Each pack bundles:
//   - ForgeHub skill IDs to install
//   - Required platform credentials (informational — user provides)
//   - Experiment template (prefilled defaults for CreateExperiment)
//
// These are static catalog data — no network fetch, no persistence.
// Skill IDs map directly to the ForgeHub seed catalog in @triforge/engine.

export interface StarterPackPlatform {
  id:            string;  // platform identifier
  name:          string;  // human label
  credentialKey: string;  // key name in Settings → Credentials
  setupHint:     string;  // one-line setup instruction
}

export interface StarterPackTemplate {
  name:         string;   // suggested experiment name (user can edit)
  rationale:    string;   // pre-filled rationale
  budgetAsk:    number;   // suggested budget in dollars
  autoKillRule: { budgetPctSpent: number; afterDays: number };
}

export interface StarterPack {
  id:          string;
  name:        string;
  description: string;
  laneId:      string;
  skillIds:    string[];               // ForgeHub skill IDs
  platforms:   StarterPackPlatform[];
  template:    StarterPackTemplate;
}

export const STARTER_PACKS: StarterPack[] = [
  {
    id:          'digital-product-pack',
    name:        'Digital Product Pack',
    description: 'Launch and sell digital products on Gumroad or Etsy. Covers product listing, SEO copy, and revenue tracking.',
    laneId:      'digital_products',
    skillIds:    ['gumroad-product-lister', 'etsy-listing-generator'],
    platforms: [
      {
        id:            'gumroad',
        name:          'Gumroad',
        credentialKey: 'gumroad_access_token',
        setupHint:     'Set gumroad_access_token in Settings → Credentials',
      },
    ],
    template: {
      name:      'First Gumroad Digital Product',
      rationale: 'Validate demand for a digital product by listing on Gumroad with a minimal budget cap.',
      budgetAsk: 50,
      autoKillRule: { budgetPctSpent: 80, afterDays: 14 },
    },
  },

  {
    id:          'affiliate-shorts-pack',
    name:        'Affiliate Shorts Pack',
    description: 'Build an affiliate funnel using short-form video. Covers TikTok scripting, YouTube metadata, and content planning.',
    laneId:      'affiliate_content',
    skillIds:    ['tiktok-script-writer', 'affiliate-content-planner', 'youtube-metadata-builder'],
    platforms: [
      {
        id:            'tiktok',
        name:          'TikTok',
        credentialKey: 'tiktok_session_token',
        setupHint:     'Set tiktok_session_token in Settings → Credentials',
      },
    ],
    template: {
      name:      'TikTok Affiliate Funnel',
      rationale: 'Drive affiliate conversions through short-form content with optimized hooks and tracked links.',
      budgetAsk: 30,
      autoKillRule: { budgetPctSpent: 90, afterDays: 21 },
    },
  },

  {
    id:          'ai-music-pack',
    name:        'AI Music Pack',
    description: 'Generate and distribute AI music tracks. Covers prompt generation for music tools and distribution tracking.',
    laneId:      'ai_music',
    skillIds:    ['ai-music-prompt-generator'],
    platforms: [
      {
        id:            'distrokid',
        name:          'DistroKid',
        credentialKey: 'distrokid_api_key',
        setupHint:     'Set distrokid_api_key in Settings → Credentials',
      },
    ],
    template: {
      name:      'AI Music Distribution Run',
      rationale: 'Publish AI-generated music tracks and measure streaming revenue over 30 days.',
      budgetAsk: 20,
      autoKillRule: { budgetPctSpent: 100, afterDays: 30 },
    },
  },

  {
    id:          'mini-game-pack',
    name:        'Mini Game Pack',
    description: 'Ship and monetize small games on Itch.io. Covers game concept, description copy, and pay-what-you-want pricing strategy.',
    laneId:      'mini_games',
    skillIds:    ['game-concept-brief'],
    platforms: [
      {
        id:            'itchio',
        name:          'Itch.io',
        credentialKey: 'itchio_api_key',
        setupHint:     'Set itchio_api_key in Settings → Credentials',
      },
    ],
    template: {
      name:      'Itch.io Mini Game Launch',
      rationale: 'Ship a focused small game and test pay-what-you-want pricing with no upfront spend.',
      budgetAsk: 0,
      autoKillRule: { budgetPctSpent: 100, afterDays: 30 },
    },
  },
];
