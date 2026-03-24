// ── governanceTypes.ts — Phase 7: Approval Policy Engine ─────────────────────
//
// Defines the GovernanceRule data model and the pure resolveGovernance()
// function that evaluates an ordered rule set to produce a routing decision.
//
// Intentionally separate from the existing PolicyConfig (tool-executor
// permission layer). GovernanceRule operates one level higher: it decides
// what happens to an inbound task *before* any tools are called.

// ── Match dimension types ──────────────────────────────────────────────────────

/** Which channel/source originated the task. '*' matches any. */
export type GovSource =
  | 'local_ui'
  | 'localhost_api'
  | 'webhook_local'
  | 'github'
  | 'telegram'
  | 'slack'
  | 'jira'
  | 'linear'
  | 'discord'
  | 'skill'
  | '*';

/** Inbound risk classification result. '*' matches any. */
export type GovRiskClass =
  | 'informational'
  | 'write_action'
  | 'skill_execution'
  | 'high_risk'
  | '*';

/** Outcome the rule enforces. */
export type GovAction = 'allow' | 'approval' | 'council' | 'block';

// ── Rule ──────────────────────────────────────────────────────────────────────

export interface GovernanceRule {
  id:           string;
  enabled:      boolean;
  /** Lower numbers are evaluated first. */
  priority:     number;
  name:         string;
  description?: string;

  // ── Match conditions (all must match; '*' is wildcard) ──────────────────
  matchSource:    GovSource;
  matchRiskClass: GovRiskClass;
  /** Task category string, or undefined to match any category. */
  matchCategory?: string;

  // ── Action ──────────────────────────────────────────────────────────────
  action:       GovAction;
  /** Hint to prefer local model routing for tasks matching this rule. */
  preferLocal?: boolean;

  isDefault:    boolean;   // default rules cannot be deleted, only disabled
  createdAt:    number;
}

// ── Resolution ────────────────────────────────────────────────────────────────

export interface GovernanceResolution {
  action:        GovAction;
  ruleId:        string | null;
  ruleName:      string | null;
  preferLocal:   boolean;
  /** True when no rule matched and the hardcoded fallback was used. */
  usedFallback:  boolean;
}

// ── Resolver ──────────────────────────────────────────────────────────────────

/**
 * Evaluate the ordered rule list against (source, riskClass, category).
 * Rules are sorted by priority ascending before evaluation. The first
 * enabled rule whose match conditions all pass wins.
 *
 * Falls back to 'approval' if no rule matches (safe default).
 */
export function resolveGovernance(
  rules: GovernanceRule[],
  source: GovSource,
  riskClass: GovRiskClass,
  category?: string,
): GovernanceResolution {
  const sorted = [...rules].sort((a, b) => a.priority - b.priority);

  for (const rule of sorted) {
    if (!rule.enabled) continue;

    const sourceMatch    = rule.matchSource    === '*' || rule.matchSource    === source;
    const riskMatch      = rule.matchRiskClass === '*' || rule.matchRiskClass === riskClass;
    const categoryMatch  = !rule.matchCategory || rule.matchCategory === category;

    if (sourceMatch && riskMatch && categoryMatch) {
      return {
        action:      rule.action,
        ruleId:      rule.id,
        ruleName:    rule.name,
        preferLocal: rule.preferLocal ?? false,
        usedFallback: false,
      };
    }
  }

  // Fallback: no rule matched → require approval (conservative default)
  return {
    action:      'approval',
    ruleId:      null,
    ruleName:    null,
    preferLocal: false,
    usedFallback: true,
  };
}

// ── Default rule set ──────────────────────────────────────────────────────────

export function buildDefaultRules(): GovernanceRule[] {
  const now = Date.now();
  return [
    {
      id: 'default-block-high-risk',
      enabled: true, priority: 10, isDefault: true, createdAt: now,
      name: 'Block all high-risk tasks',
      description: 'Any high-risk classification from any source is blocked unconditionally.',
      matchSource: '*', matchRiskClass: 'high_risk',
      action: 'block',
    },
    {
      id: 'default-block-telegram-skill-exec',
      enabled: true, priority: 20, isDefault: true, createdAt: now,
      name: 'Block skill execution via Telegram',
      description: 'Telegram is not a trusted source for skill execution commands.',
      matchSource: 'telegram', matchRiskClass: 'skill_execution',
      action: 'block',
    },
    {
      id: 'default-approve-telegram-write',
      enabled: true, priority: 30, isDefault: true, createdAt: now,
      name: 'Require approval for Telegram write actions',
      description: 'Write/action tasks from Telegram must be explicitly approved before execution.',
      matchSource: 'telegram', matchRiskClass: 'write_action',
      action: 'approval',
    },
    {
      id: 'default-approve-github-write',
      enabled: true, priority: 40, isDefault: true, createdAt: now,
      name: 'Require approval before GitHub writes',
      description: 'Posting comments and other write actions on GitHub require human approval.',
      matchSource: 'github', matchRiskClass: 'write_action',
      action: 'approval',
    },
    {
      id: 'default-approve-jira-write',
      enabled: true, priority: 45, isDefault: true, createdAt: now,
      name: 'Require approval for Jira write actions',
      description: 'Creating issues, adding comments, and transitioning status in Jira require human approval.',
      matchSource: 'jira', matchRiskClass: 'write_action',
      action: 'approval',
    },
    {
      id: 'default-approve-linear-write',
      enabled: true, priority: 46, isDefault: true, createdAt: now,
      name: 'Require approval for Linear write actions',
      description: 'Creating issues, adding comments, and updating status in Linear require human approval.',
      matchSource: 'linear', matchRiskClass: 'write_action',
      action: 'approval',
    },
    {
      id: 'default-allow-linear-info',
      enabled: true, priority: 83, isDefault: true, createdAt: now,
      name: 'Allow Linear informational queries',
      description: 'Browsing and searching Linear issues runs automatically without approval.',
      matchSource: 'linear', matchRiskClass: 'informational',
      action: 'allow',
    },
    {
      id: 'default-approve-skill-exec',
      enabled: true, priority: 50, isDefault: true, createdAt: now,
      name: 'Require approval for skill execution',
      description: 'Skills imported from external sources require explicit approval before running.',
      matchSource: 'skill', matchRiskClass: 'skill_execution',
      action: 'approval',
    },
    {
      id: 'default-approve-api-write',
      enabled: true, priority: 60, isDefault: true, createdAt: now,
      name: 'Require approval for API write actions',
      description: 'Write/action tasks submitted via the control plane API require human approval.',
      matchSource: 'localhost_api', matchRiskClass: 'write_action',
      action: 'approval',
    },
    {
      id: 'default-approve-webhook-write',
      enabled: true, priority: 70, isDefault: true, createdAt: now,
      name: 'Require approval for webhook write actions',
      description: 'Write/action tasks triggered by local webhooks require human approval.',
      matchSource: 'webhook_local', matchRiskClass: 'write_action',
      action: 'approval',
    },
    {
      id: 'default-block-discord-skill-exec',
      enabled: true, priority: 27, isDefault: true, createdAt: now,
      name: 'Block skill execution via Discord',
      description: 'Discord is not a trusted source for skill execution commands.',
      matchSource: 'discord', matchRiskClass: 'skill_execution',
      action: 'block',
    },
    {
      id: 'default-approve-discord-write',
      enabled: true, priority: 34, isDefault: true, createdAt: now,
      name: 'Require approval for Discord write actions',
      description: 'Write/action tasks from Discord must be explicitly approved before execution.',
      matchSource: 'discord', matchRiskClass: 'write_action',
      action: 'approval',
    },
    {
      id: 'default-block-slack-skill-exec',
      enabled: true, priority: 25, isDefault: true, createdAt: now,
      name: 'Block skill execution via Slack',
      description: 'Slack is not a trusted source for skill execution commands.',
      matchSource: 'slack', matchRiskClass: 'skill_execution',
      action: 'block',
    },
    {
      id: 'default-approve-slack-write',
      enabled: true, priority: 32, isDefault: true, createdAt: now,
      name: 'Require approval for Slack write actions',
      description: 'Write/action tasks from Slack must be explicitly approved before execution.',
      matchSource: 'slack', matchRiskClass: 'write_action',
      action: 'approval',
    },
    {
      id: 'default-allow-discord-info',
      enabled: true, priority: 84, isDefault: true, createdAt: now,
      name: 'Allow Discord informational tasks',
      description: 'Informational queries from allowlisted Discord channels auto-run and reply.',
      matchSource: 'discord', matchRiskClass: 'informational',
      action: 'allow', preferLocal: true,
    },
    {
      id: 'default-allow-telegram-info',
      enabled: true, priority: 80, isDefault: true, createdAt: now,
      name: 'Allow Telegram informational tasks',
      description: 'Informational queries from allowlisted Telegram chats auto-run and reply.',
      matchSource: 'telegram', matchRiskClass: 'informational',
      action: 'allow', preferLocal: true,
    },
    {
      id: 'default-allow-slack-info',
      enabled: true, priority: 82, isDefault: true, createdAt: now,
      name: 'Allow Slack informational tasks',
      description: 'Informational queries from allowlisted Slack channels auto-run and reply.',
      matchSource: 'slack', matchRiskClass: 'informational',
      action: 'allow', preferLocal: true,
    },
    {
      id: 'default-allow-informational',
      enabled: true, priority: 90, isDefault: true, createdAt: now,
      name: 'Allow all informational tasks',
      description: 'Low-risk informational tasks from any source run automatically.',
      matchSource: '*', matchRiskClass: 'informational',
      action: 'allow',
    },
    {
      id: 'default-catchall-approval',
      enabled: true, priority: 100, isDefault: true, createdAt: now,
      name: 'Catch-all: require approval',
      description: 'Anything not matched by a higher-priority rule requires human approval.',
      matchSource: '*', matchRiskClass: '*',
      action: 'approval',
    },
  ];
}
