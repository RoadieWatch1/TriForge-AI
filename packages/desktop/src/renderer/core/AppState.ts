// ── TriForge Agent OS — Core State Types ────────────────────────────────────

export type AgentMode =
  | 'dashboard'
  | 'launch'
  | 'operator'
  | 'world'
  | 'files'
  | 'inbox'
  | 'automation'
  | 'hustle';

export type SystemStatus = 'active' | 'available' | 'coming_soon';

export interface SystemCard {
  id: string;
  name: string;
  description: string;
  status: SystemStatus;
  modes: AgentMode[];
}

// ── System Registry ──────────────────────────────────────────────────────────

export const SYSTEM_REGISTRY: SystemCard[] = [
  {
    id: 'business_engine',
    name: 'Business Engine',
    description: 'Blueprint, asset, and structured output generation',
    status: 'active',
    modes: ['launch'],
  },
  {
    id: 'visual_engine',
    name: 'Visual Engine',
    description: 'Marketing images, mockups, and promos via DALL-E 3',
    status: 'active',
    modes: ['launch', 'operator'],
  },
  {
    id: 'social_poster',
    name: 'Social Poster',
    description: 'Generate and post content to connected platforms',
    status: 'coming_soon',
    modes: ['operator'],
  },
  {
    id: 'content_calendar',
    name: 'Content Calendar',
    description: 'Automate 7–30 day posting plans',
    status: 'coming_soon',
    modes: ['operator'],
  },
  {
    id: 'outreach_engine',
    name: 'Outreach Engine',
    description: 'Send messages, emails, and DMs on your behalf',
    status: 'coming_soon',
    modes: ['operator', 'hustle'],
  },
  {
    id: 'file_analyzer',
    name: 'File Analyzer',
    description: 'Open folders, read files, and scan codebases',
    status: 'available',
    modes: ['files'],
  },
  {
    id: 'world_feed',
    name: 'World Feed Engine',
    description: 'Daily digest of topics relevant to your business',
    status: 'coming_soon',
    modes: ['world'],
  },
  {
    id: 'scheduler',
    name: 'Scheduler Engine',
    description: 'Execute user-defined recurring tasks on schedule',
    status: 'active',
    modes: ['automation'],
  },
  {
    id: 'inbox_agent',
    name: 'Inbox Agent',
    description: 'Monitor, reply, and follow up on platform messages',
    status: 'coming_soon',
    modes: ['inbox'],
  },
  {
    id: 'deal_closer',
    name: 'Deal Closer',
    description: 'List, negotiate, and sell items automatically',
    status: 'coming_soon',
    modes: ['hustle'],
  },
  {
    id: 'investor_hunter',
    name: 'Investor Hunter',
    description: 'Build proposals, find prospects, send cold outreach',
    status: 'coming_soon',
    modes: ['hustle'],
  },
  {
    id: 'trade_desk',
    name: 'Trade Desk',
    description: 'Size positions, run Council review, and log paper trades',
    status: 'active',
    modes: ['hustle'],
  },
  {
    id: 'live_trade_advisor',
    name: 'Live Trade Advisor',
    description: 'Watch Tradovate, validate setups, and get real-time Council guidance',
    status: 'active',
    modes: ['hustle'],
  },
];

// ── TriforgeTask (Scheduler payload) ────────────────────────────────────────

export type TriforgeTaskType = 'post' | 'briefing' | 'email' | 'outreach';

export interface TriforgeTask {
  id: string;
  type: TriforgeTaskType;
  executeAt: Date;
  payload: Record<string, unknown>;
}
