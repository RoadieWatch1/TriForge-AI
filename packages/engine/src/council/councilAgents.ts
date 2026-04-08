// ── councilAgents.ts — 15 Council Agent Definitions ──────────────────────────
//
// 5 specialized agents per AI pool (Claude · GPT · Grok) = 15 total.
// Each agent has a focused role that applies to ALL task types — not just
// trading. They run in parallel before the Council deliberates, injecting
// their specialist lens into the system prompt.
//
// Agent lifecycle:
//   active   → selected for tasks, performance tracked
//   watchlist → underperforming, monitored (2 cycles before bench)
//   bench    → sidelined, not selected (can be restored)
//   retired  → permanently removed, replacement triggered
//   trial    → newly hired, probationary (5 tasks to prove value)
//
// Protected agents (cannot be benched or retired):
//   - risk_assessor (claude pool)
//   - quality_gate (grok pool)
//
// Fire/hire is handled by CouncilAgentOrchestrator via ExpertWorkforceEngine.

export type AgentPool   = 'claude' | 'gpt' | 'grok';
export type AgentStatus = 'active' | 'watchlist' | 'bench' | 'retired' | 'trial';

export interface CouncilAgent {
  id:                    string;
  name:                  string;
  pool:                  AgentPool;
  role:                  string;
  status:                AgentStatus;
  protected:             boolean;
  /** Injected into the Council system prompt when this agent is active. */
  systemPromptFragment:  string;
  /** Task type keywords this agent specializes in. Empty = all tasks. */
  taskAffinity:          string[];
  /** Minimum words in user message to activate this agent. Default 0. */
  minMessageLength:      number;
}

// ── Claude Pool — 5 agents (analytical, structured, code-strong) ──────────────

const CLAUDE_RESEARCHER: CouncilAgent = {
  id:     'claude-researcher',
  name:   'Research Agent',
  pool:   'claude',
  role:   'researcher',
  status: 'active',
  protected: false,
  systemPromptFragment:
    'RESEARCH AGENT (Claude pool): Before answering, recall any relevant background knowledge, ' +
    'prior patterns, and established best practices for this type of request. ' +
    'Surface what is already known about the domain before proposing anything new.',
  taskAffinity: [],   // all tasks
  minMessageLength: 0,
};

const CLAUDE_STRATEGIST: CouncilAgent = {
  id:     'claude-strategist',
  name:   'Strategic Planner',
  pool:   'claude',
  role:   'strategist',
  status: 'active',
  protected: false,
  systemPromptFragment:
    'STRATEGIC PLANNER (Claude pool): Decompose the request into clear, ordered steps. ' +
    'Identify dependencies between steps. Flag which step is the critical path ' +
    '(the one that blocks all others if it fails). Present a concrete execution order.',
  taskAffinity: ['build', 'plan', 'create', 'design', 'implement', 'develop'],
  minMessageLength: 20,
};

const CLAUDE_CODE_CRITIC: CouncilAgent = {
  id:     'claude-code-critic',
  name:   'Code & Logic Critic',
  pool:   'claude',
  role:   'code_critic',
  status: 'active',
  protected: false,
  systemPromptFragment:
    'CODE & LOGIC CRITIC (Claude pool): Review any code, script, or logical plan in the response. ' +
    'Catch: off-by-one errors, missing null checks, wrong API usage, type mismatches, ' +
    'security issues (injection, exposure), and logic that looks right but is subtly wrong. ' +
    'If no code is involved, review the reasoning chain for logical gaps.',
  taskAffinity: ['code', 'script', 'function', 'implement', 'fix', 'debug', 'build'],
  minMessageLength: 10,
};

const CLAUDE_RISK_ASSESSOR: CouncilAgent = {
  id:     'claude-risk-assessor',
  name:   'Risk Assessor',
  pool:   'claude',
  role:   'risk_assessor',
  status: 'active',
  protected: true,   // cannot be benched or retired
  systemPromptFragment:
    'RISK ASSESSOR (Claude pool — protected): Before finalizing any recommendation or action plan, ' +
    'identify the top 2–3 risks. For each risk state: what could go wrong, how likely, ' +
    'and what the mitigation is. Flag any irreversible actions that need explicit user confirmation. ' +
    'This applies to code changes, UI operations, file writes, and strategic decisions.',
  taskAffinity: [],  // all tasks
  minMessageLength: 0,
};

const CLAUDE_VERIFIER: CouncilAgent = {
  id:     'claude-verifier',
  name:   'Output Verifier',
  pool:   'claude',
  role:   'verifier',
  status: 'active',
  protected: false,
  systemPromptFragment:
    'OUTPUT VERIFIER (Claude pool): After forming a response, verify it actually answers ' +
    'what the user asked. Check: Does it address all parts of the question? ' +
    'Are any key details missing? Does the conclusion follow from the reasoning? ' +
    'If the response is incomplete or drifts from the question, correct it.',
  taskAffinity: [],  // all tasks
  minMessageLength: 0,
};

// ── GPT Pool — 5 agents (creative, generalist, synthesis-strong) ──────────────

const GPT_CREATIVE_DIRECTOR: CouncilAgent = {
  id:     'gpt-creative-director',
  name:   'Creative Director',
  pool:   'gpt',
  role:   'creative_director',
  status: 'active',
  protected: false,
  systemPromptFragment:
    'CREATIVE DIRECTOR (GPT pool): Generate at least one creative, non-obvious approach ' +
    'to the request alongside the standard approach. Think laterally. ' +
    'Ask: "What would make this solution memorable or significantly better?" ' +
    'Especially valuable for game design, content creation, UI decisions, and naming.',
  taskAffinity: ['game', 'design', 'creative', 'content', 'video', 'music', 'art', 'build'],
  minMessageLength: 15,
};

const GPT_UX_AGENT: CouncilAgent = {
  id:     'gpt-ux-agent',
  name:   'UX & Flow Agent',
  pool:   'gpt',
  role:   'ux_agent',
  status: 'active',
  protected: false,
  systemPromptFragment:
    'UX & FLOW AGENT (GPT pool): Consider the end user\'s experience with whatever is being built. ' +
    'Ask: Is this intuitive? What friction points exist? ' +
    'How does the user get from start to done without confusion? ' +
    'Flag any steps that require hidden knowledge or that could confuse a first-time user.',
  taskAffinity: ['app', 'game', 'ui', 'build', 'design', 'create', 'unreal', 'blender'],
  minMessageLength: 10,
};

const GPT_RESOURCE_SCOUT: CouncilAgent = {
  id:     'gpt-resource-scout',
  name:   'Resource Scout',
  pool:   'gpt',
  role:   'resource_scout',
  status: 'active',
  protected: false,
  systemPromptFragment:
    'RESOURCE SCOUT (GPT pool): Identify the best tools, libraries, APIs, or methods for this task. ' +
    'Compare at least two options when alternatives exist. ' +
    'State the key tradeoff (speed vs quality, simple vs powerful, free vs paid). ' +
    'If a built-in solution exists that avoids a dependency, prefer it.',
  taskAffinity: ['build', 'implement', 'create', 'use', 'integrate', 'setup'],
  minMessageLength: 15,
};

const GPT_DEVILS_ADVOCATE: CouncilAgent = {
  id:     'gpt-devils-advocate',
  name:   "Devil's Advocate",
  pool:   'gpt',
  role:   'devils_advocate',
  status: 'active',
  protected: false,
  systemPromptFragment:
    "DEVIL'S ADVOCATE (GPT pool): Argue against the current plan. " +
    'Find the assumption most likely to be wrong. ' +
    'Ask: "What if the user\'s premise is incorrect?" or "What breaks this approach at scale?" ' +
    'One strong counterargument is more valuable than agreement. Do not just criticize — propose what to do instead.',
  taskAffinity: ['plan', 'build', 'design', 'strategy', 'should', 'best'],
  minMessageLength: 20,
};

const GPT_SYNTHESIZER: CouncilAgent = {
  id:     'gpt-synthesizer',
  name:   'Synthesis Agent',
  pool:   'gpt',
  role:   'synthesizer',
  status: 'active',
  protected: false,
  systemPromptFragment:
    'SYNTHESIS AGENT (GPT pool): After all perspectives are considered, ' +
    'distill them into a single, clear, actionable response. ' +
    'Resolve conflicts between different approaches by picking the best fit for the user\'s stated context. ' +
    'Eliminate redundancy. Lead with the most important point.',
  taskAffinity: [],  // all tasks
  minMessageLength: 0,
};

// ── Grok Pool — 5 agents (fast, real-time aware, challenger) ─────────────────

const GROK_TREND_ANALYST: CouncilAgent = {
  id:     'grok-trend-analyst',
  name:   'Trend Analyst',
  pool:   'grok',
  role:   'trend_analyst',
  status: 'active',
  protected: false,
  systemPromptFragment:
    'TREND ANALYST (Grok pool): Check if the proposed approach aligns with current best practices ' +
    'as of today. Flag any outdated patterns, deprecated APIs, or techniques that have been ' +
    'superseded by better solutions. Prefer approaches that are actively maintained and widely adopted.',
  taskAffinity: ['build', 'implement', 'use', 'integrate', 'unreal', 'blender', 'game', 'app'],
  minMessageLength: 10,
};

const GROK_EFFICIENCY_AGENT: CouncilAgent = {
  id:     'grok-efficiency-agent',
  name:   'Efficiency Agent',
  pool:   'grok',
  role:   'efficiency_agent',
  status: 'active',
  protected: false,
  systemPromptFragment:
    'EFFICIENCY AGENT (Grok pool): Find the simplest, fastest path to the goal. ' +
    'Ask: "What is the minimum viable version of this that works?" ' +
    'Eliminate steps that add complexity without proportional value. ' +
    'If the plan has 10 steps and 4 can be removed without loss, say so.',
  taskAffinity: [],  // all tasks
  minMessageLength: 0,
};

const GROK_COUNTER_PLANNER: CouncilAgent = {
  id:     'grok-counter-planner',
  name:   'Counter Planner',
  pool:   'grok',
  role:   'counter_planner',
  status: 'active',
  protected: false,
  systemPromptFragment:
    'COUNTER PLANNER (Grok pool): Propose an alternative execution order or completely different ' +
    'approach to stress-test the main plan. If the primary approach fails midway, what is Plan B? ' +
    'Think: "Is there a completely different way to achieve the same outcome that avoids the main risk?"',
  taskAffinity: ['plan', 'build', 'design', 'implement', 'create'],
  minMessageLength: 20,
};

const GROK_QUALITY_GATE: CouncilAgent = {
  id:     'grok-quality-gate',
  name:   'Quality Gate',
  pool:   'grok',
  role:   'quality_gate',
  status: 'active',
  protected: true,  // cannot be benched or retired
  systemPromptFragment:
    'QUALITY GATE (Grok pool — protected): Define clear success criteria BEFORE the plan executes. ' +
    'State: "This task is complete when X, Y, and Z are true." ' +
    'Make criteria observable and testable, not vague. ' +
    'This prevents scope creep and lets the user know exactly when they\'re done.',
  taskAffinity: [],  // all tasks
  minMessageLength: 0,
};

const GROK_ACTION_PRIORITIZER: CouncilAgent = {
  id:     'grok-action-prioritizer',
  name:   'Action Prioritizer',
  pool:   'grok',
  role:   'action_prioritizer',
  status: 'active',
  protected: false,
  systemPromptFragment:
    'ACTION PRIORITIZER (Grok pool): Rank the next actions by impact-to-effort ratio. ' +
    'The highest-priority action should give the most value for the least work. ' +
    'Explicitly call out if the plan is starting with low-impact work when high-impact work is available.',
  taskAffinity: ['plan', 'build', 'next', 'what should', 'how do', 'create'],
  minMessageLength: 10,
};

// ── Master roster ─────────────────────────────────────────────────────────────

export const COUNCIL_AGENT_ROSTER: CouncilAgent[] = [
  // Claude pool
  CLAUDE_RESEARCHER,
  CLAUDE_STRATEGIST,
  CLAUDE_CODE_CRITIC,
  CLAUDE_RISK_ASSESSOR,
  CLAUDE_VERIFIER,
  // GPT pool
  GPT_CREATIVE_DIRECTOR,
  GPT_UX_AGENT,
  GPT_RESOURCE_SCOUT,
  GPT_DEVILS_ADVOCATE,
  GPT_SYNTHESIZER,
  // Grok pool
  GROK_TREND_ANALYST,
  GROK_EFFICIENCY_AGENT,
  GROK_COUNTER_PLANNER,
  GROK_QUALITY_GATE,
  GROK_ACTION_PRIORITIZER,
];

// ── Agent selection helpers ───────────────────────────────────────────────────

/**
 * Return active agents relevant to the given message and pool.
 * All-task agents (taskAffinity=[]) are always included.
 * Affinity agents are included when the message contains one of their keywords.
 */
export function selectAgentsForMessage(
  message:     string,
  pool?:       AgentPool,
  statusAllow: AgentStatus[] = ['active'],
): CouncilAgent[] {
  const lower = message.toLowerCase();

  return COUNCIL_AGENT_ROSTER.filter(a => {
    if (!statusAllow.includes(a.status)) return false;
    if (pool && a.pool !== pool) return false;
    if (message.length < a.minMessageLength) return false;

    // Zero affinity = always selected
    if (a.taskAffinity.length === 0) return true;
    return a.taskAffinity.some(kw => lower.includes(kw));
  });
}

/**
 * Build the combined system prompt fragment from a list of active agents.
 * Returns an empty string if no agents are active.
 */
export function buildAgentSystemAddendum(agents: CouncilAgent[]): string {
  if (agents.length === 0) return '';

  const fragments = agents.map(a => a.systemPromptFragment).join('\n\n');
  return [
    '─── COUNCIL AGENT ANALYSIS LENS ─────────────────────────────────────────',
    'The following specialized agents are active for this task.',
    'Each lens below must inform your response:',
    '',
    fragments,
    '─────────────────────────────────────────────────────────────────────────',
  ].join('\n');
}

/** Get a single agent by ID. */
export function getCouncilAgent(id: string): CouncilAgent | undefined {
  return COUNCIL_AGENT_ROSTER.find(a => a.id === id);
}

/** Check if an agent is protected (cannot be benched or retired). */
export function isProtectedAgent(id: string): boolean {
  return COUNCIL_AGENT_ROSTER.find(a => a.id === id)?.protected ?? false;
}
