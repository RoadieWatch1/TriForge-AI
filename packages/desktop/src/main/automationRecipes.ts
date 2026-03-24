/**
 * automationRecipes.ts — Cross-System Automation Recipe definitions
 *
 * Recipes wire together integrations (GitHub, Jira, Linear, Slack, Push, etc.)
 * into multi-step automation flows. Each recipe has a trigger, optional params,
 * and an executor (implemented in ipc.ts).
 */

export type RecipeTrigger =
  | 'manual'
  | 'schedule:daily'
  | 'event:github_review_completed'
  | 'event:approval_required';

export interface RecipeParamSchema {
  key: string;
  label: string;
  placeholder: string;
  required: boolean;
}

export interface RecipeDef {
  id: string;
  name: string;
  description: string;
  trigger: RecipeTrigger;
  triggerLabel: string;
  paramSchema: RecipeParamSchema[];
}

export interface RecipeState {
  id: string;
  enabled: boolean;
  params: Record<string, string>;
  lastRunAt?: number;
  lastRunStatus?: 'success' | 'failed' | 'skipped';
  lastRunResult?: string;
  // Phase 28 — workspace recipe scope
  scope?: 'personal' | 'workspace';
  workspaceId?: string;
}

export type RecipeView = RecipeDef & RecipeState;

export const BUILTIN_RECIPES: RecipeDef[] = [
  {
    id: 'builtin-pr-review-to-slack',
    name: 'PR Review → Slack',
    description: 'When a GitHub PR review completes, post the AI synthesis to a Slack channel.',
    trigger: 'event:github_review_completed',
    triggerLabel: 'On: GitHub PR Review Completed',
    paramSchema: [
      { key: 'slack_channel', label: 'Slack Channel', placeholder: '#dev-reviews', required: true },
    ],
  },
  {
    id: 'builtin-jira-digest-daily',
    name: 'Jira Daily Digest',
    description: 'Post a daily summary of open Jira issues (assigned to you or by JQL) to Slack.',
    trigger: 'schedule:daily',
    triggerLabel: 'Daily Schedule',
    paramSchema: [
      { key: 'slack_channel', label: 'Slack Channel', placeholder: '#standup', required: true },
      { key: 'jql', label: 'JQL Filter', placeholder: 'assignee = currentUser() AND status != Done', required: false },
    ],
  },
  {
    id: 'builtin-linear-digest-daily',
    name: 'Linear Daily Digest',
    description: 'Post a daily summary of open Linear issues (by team or query) to Slack.',
    trigger: 'schedule:daily',
    triggerLabel: 'Daily Schedule',
    paramSchema: [
      { key: 'slack_channel', label: 'Slack Channel', placeholder: '#standup', required: true },
      { key: 'query', label: 'Search Query', placeholder: 'assignee:me state:started', required: false },
      { key: 'team_id', label: 'Team ID (optional)', placeholder: 'Leave blank for all teams', required: false },
    ],
  },
  {
    id: 'builtin-morning-brief',
    name: 'Morning Brief',
    description: 'Daily digest combining GitHub pending reviews, Jira issues, and Linear issues into one Slack message.',
    trigger: 'schedule:daily',
    triggerLabel: 'Daily Schedule',
    paramSchema: [
      { key: 'slack_channel', label: 'Slack Channel', placeholder: '#morning-brief', required: true },
    ],
  },
  {
    id: 'builtin-approval-alert',
    name: 'Approval Required → Push',
    description: 'When any action enters the approval queue (Telegram, Slack, Discord, Linear, Jira), fire a push notification.',
    trigger: 'event:approval_required',
    triggerLabel: 'On: Approval Required',
    paramSchema: [],
  },
];
