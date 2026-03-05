// ── defaultBlueprint.ts — Fallback blueprint for unconfigured users ────────────
//
// Applied when no blueprint ID is set in the store, or when the active blueprint
// fails to load. Provides safe, minimal defaults that work for any user type.

import type { TriForgeBlueprint } from './BlueprintTypes';

export const DEFAULT_BLUEPRINT: TriForgeBlueprint = {
  id: 'business',
  name: 'General',
  description: 'Balanced defaults for any professional use case.',
  version: '1.0.0',

  systemPromptAdditions: [
    'You are operating in General mode. Adapt your response style to the nature of the task.',
    'For technical tasks, be precise and structured. For creative tasks, be exploratory and thorough.',
    'Always summarize key decisions and their rationale. Flag ambiguities before acting.',
    'Approval strictness: BALANCED — suggestions auto-generate, but irreversible actions require approval.',
  ],

  approvalStrictness: 'balanced',

  activeSensors: [],

  workflows: [],

  enabledTools: [
    'read_file',
    'write_file',
    'search_code',
    'run_command',
    'web_search',
  ],

  missionTemplates: [
    {
      id: 'default-summarize',
      label: 'Summarize this document',
      goal: 'Read the provided document and produce a concise summary covering: main topic, key points, action items, and open questions.',
    },
    {
      id: 'default-review',
      label: 'Review and improve this',
      goal: 'Review the provided content for clarity, accuracy, and completeness. List specific improvements with justification.',
    },
    {
      id: 'default-plan',
      label: 'Create an action plan',
      goal: 'Analyze the situation and produce a prioritized action plan with clear steps, owners, and success criteria.',
    },
  ],

  memoryTags: ['general'],

  proactiveInsights: false,
  voiceAlerts: false,
  responseStyle: 'conversational',
};
