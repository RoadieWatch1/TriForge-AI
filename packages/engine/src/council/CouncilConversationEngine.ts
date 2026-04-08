// ── CouncilConversationEngine.ts ─────────────────────────────────────────────
//
// Conversation Council Layer — sits ABOVE the existing CouncilExecutor /
// ThinkTankPlanner pipeline. Provides fast, streaming multi-model responses
// for real-time chat while preserving the full planning pipeline for complex
// tasks.
//
// Architecture:
//   User message
//     ↓
//   CouncilConversationEngine.handleMessage()
//     ↓ parallel chatStream() across all providers
//   Fast draft (first provider to finish) → COUNCIL_CONV_DRAFT
//     ↓
//   Streaming tokens per provider → COUNCIL_CONV_STREAM
//     ↓
//   Synthesis (all providers done) → COUNCIL_CONV_UPDATE (streaming)
//     ↓ (if isPlanningTask)
//   ThinkTankPlanner.makePlan() → COUNCIL_CONV_PLAN
//     ↓ (async, 20-min cooldown)
//   Proactive suggestion → COUNCIL_CONV_SUGGESTION
//
// The existing CouncilExecutor and ThinkTankPlanner are UNCHANGED.

import type { ProviderManager } from '../core/providerManager';
import type { ThinkTankPlanner } from '../core/thinkTankPlanner';
import type { Plan }             from '../core/taskTypes';
import type { AIProvider }       from '../core/providers/provider';
import { eventBus }              from '../core/eventBus';
import { registerAbortController, clearAbortControllers } from './interruptController';
import { synthesizeCouncilStream }                        from './synthesizeCouncil';
import { getCouncilAgentOrchestrator, checkAgentSurvival } from './councilAgentOrchestrator';
import https from 'https';

// ── Agent pre-query helpers ───────────────────────────────────────────────────

const AGENT_PREQUERY_TIMEOUT_MS = 3000;

/**
 * Run a short focused pre-query against the Claude Haiku API.
 * Returns the text response or null on any failure / timeout.
 */
async function runClaudePreQuery(
  systemFragment: string,
  userMessage:    string,
  apiKey:         string,
): Promise<string | null> {
  const body = JSON.stringify({
    model:      'claude-haiku-4-5-20251001',
    max_tokens: 200,
    system:     systemFragment,
    messages:   [{ role: 'user', content: userMessage }],
  });

  const fetchPromise = new Promise<string>((resolve, reject) => {
    const req = https.request({
      hostname: 'api.anthropic.com',
      path:     '/v1/messages',
      method:   'POST',
      headers: {
        'Content-Type':      'application/json',
        'Content-Length':    Buffer.byteLength(body),
        'x-api-key':         apiKey,
        'anthropic-version': '2023-06-01',
      },
    }, res => {
      let data = '';
      res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.setTimeout(AGENT_PREQUERY_TIMEOUT_MS, () => { req.destroy(); reject(new Error('timeout')); });
    req.write(body);
    req.end();
  });

  const timeoutPromise = new Promise<null>(resolve =>
    setTimeout(() => resolve(null), AGENT_PREQUERY_TIMEOUT_MS + 200));

  try {
    const result = await Promise.race([fetchPromise, timeoutPromise]);
    if (!result) return null;
    const parsed = JSON.parse(result) as { content?: Array<{ type: string; text?: string }> };
    return parsed.content?.find(c => c.type === 'text')?.text?.trim() ?? null;
  } catch {
    return null;
  }
}

// ── Constants ─────────────────────────────────────────────────────────────────

/** Role-specific thinking message shown before tokens arrive (Council Awareness). */
const ROLE_THINKING: Record<string, string> = {
  openai:  'Generating analysis…',
  claude:  'Reasoning through the problem…',
  grok:    'Challenging assumptions…',
};

/**
 * Keywords that indicate a request needs deep planning (ThinkTankPlanner).
 * Requires ≥2 matches to avoid false positives on short casual questions.
 */
const PLANNING_KEYWORDS = [
  'build', 'design', 'plan', 'architecture', 'system', 'project',
  'develop', 'create', 'implement', 'strategy',
];

/** Minimum message length for planning detection. */
const PLANNING_MIN_LENGTH = 60;

/** Proactive suggestion cooldown: 20 minutes. */
const SUGGESTION_COOLDOWN_MS = 20 * 60 * 1000;

// ── Types ─────────────────────────────────────────────────────────────────────

export interface CouncilConversationCallbacks {
  /** Called just before a provider starts streaming (Council Awareness). */
  onThinking?:    (provider: string, thinkingText: string) => void;
  /** Called for each streaming token from a provider. */
  onStream?:      (provider: string, token: string) => void;
  /** Called when the first provider finishes (fast draft). */
  onDraft?:       (provider: string, text: string) => void;
  /** Called for each synthesis token once all providers are done. */
  onSynthesisToken?: (token: string) => void;
  /** Called when consensus synthesis is complete. */
  onUpdate?:      (text: string) => void;
  /** Called when ThinkTankPlanner produces a structured plan. */
  onPlan?:        (plan: Plan) => void;
  /** Called when a proactive suggestion is ready. */
  onSuggestion?:  (text: string) => void;
}

export interface CouncilConversationResult {
  responses:  Array<{ provider: string; text: string }>;
  synthesis:  string;
  plan?:      Plan;
  durationMs: number;
}

// ── CouncilConversationEngine ─────────────────────────────────────────────────

export class CouncilConversationEngine {
  private _lastSuggestionTime = 0;

  constructor(
    private _pm: ProviderManager,
    private _planner?: ThinkTankPlanner,
    /** Optional Claude API key — enables active agent pre-queries before deliberation */
    private _claudeApiKey?: string,
  ) {}

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Handle a user message with parallel council streaming.
   *
   * - Emits callbacks and eventBus events as data arrives.
   * - Returns when synthesis is complete (planning + suggestions run async).
   */
  async handleMessage(
    message: string,
    systemPrompt: string,
    history: Array<{ role: string; content: string }>,
    callbacks?: CouncilConversationCallbacks,
  ): Promise<CouncilConversationResult> {
    const startMs = Date.now();

    const providers = await this._pm.getActiveProviders();
    if (providers.length === 0) {
      return { responses: [], synthesis: '', durationMs: 0 };
    }

    // ── Agent Council: select active agents and inject their lenses ──────────
    const orchestrator = getCouncilAgentOrchestrator();
    const { addendum: agentAddendum, activeAgentIds } =
      orchestrator.buildAddendumForMessage(message);

    // ── Active agent pre-queries (Research + Creative Director) ─────────────
    // For complex or planning-type messages, run 2 agents as real API calls
    // in parallel before the main deliberation so they contribute actual insight,
    // not just static prompt fragments. Hard 3s timeout — skip if slow.
    let activeAgentInsights = '';
    const apiKey = this._claudeApiKey ?? (typeof process !== 'undefined' ? process.env.ANTHROPIC_API_KEY : undefined);
    if (apiKey && isPlanningTask(message)) {
      const [researchResult, creativeResult] = await Promise.all([
        runClaudePreQuery(
          'You are a Research Agent. In 2-3 sentences, summarize the most relevant background knowledge, established patterns, or best practices the Council needs to know before answering this request. Be specific and actionable.',
          message,
          apiKey,
        ).catch(() => null),
        runClaudePreQuery(
          'You are a Creative Director. In 2-3 sentences, suggest the most creative or non-obvious approach to this request. Think laterally — what would make the solution significantly better or more interesting than the obvious answer?',
          message,
          apiKey,
        ).catch(() => null),
      ]);

      if (researchResult || creativeResult) {
        const parts: string[] = [];
        if (researchResult) parts.push(`RESEARCH AGENT INSIGHT: ${researchResult}`);
        if (creativeResult) parts.push(`CREATIVE DIRECTOR INSIGHT: ${creativeResult}`);
        activeAgentInsights = '\n\n─── LIVE AGENT PRE-ANALYSIS ─────────────────────────────────────────\n' +
          parts.join('\n\n') +
          '\n─────────────────────────────────────────────────────────────────────';
      }
    }

    const enrichedSystemPrompt = [
      systemPrompt,
      agentAddendum || '',
      activeAgentInsights,
    ].filter(Boolean).join('\n\n');

    // Build the messages array (system + history + current message)
    const messages: Array<{ role: string; content: string }> = [
      { role: 'system', content: enrichedSystemPrompt },
      ...history,
      { role: 'user',   content: message },
    ];

    // ── Phase 1: Parallel streaming across all providers ─────────────────────

    const responses: Array<{ provider: string; text: string }> = [];
    let firstDone = false;

    await Promise.all(providers.map(async (p: AIProvider) => {
      const providerName = p.name as string;

      // Council Awareness: emit thinking message before tokens arrive
      const thinkingText = ROLE_THINKING[providerName] ?? 'Thinking…';
      callbacks?.onThinking?.(providerName, thinkingText);

      // Register abort controller so interrupt() can cancel this stream
      const ac = new AbortController();
      registerAbortController(ac);

      let accumulated = '';

      try {
        await p.chatStream(
          messages,
          (token: string) => {
            accumulated += token;
            callbacks?.onStream?.(providerName, token);
            eventBus.emit({ type: 'COUNCIL_CONV_STREAM', provider: providerName, token });
          },
          ac.signal,
        );
      } catch (err: unknown) {
        // Silently absorb abort errors — provider was interrupted intentionally
        if (err instanceof Error && (err.name === 'AbortError' || err.message.includes('aborted'))) {
          return;
        }
        // For other errors, proceed with whatever was accumulated so far
      }

      if (!accumulated) return;

      responses.push({ provider: providerName, text: accumulated });

      // Fast-First: emit draft on the first provider to finish
      if (!firstDone) {
        firstDone = true;
        callbacks?.onDraft?.(providerName, accumulated);
        eventBus.emit({ type: 'COUNCIL_CONV_DRAFT', provider: providerName, text: accumulated });
      }
    }));

    clearAbortControllers();

    // ── Phase 2: Synthesis (streaming) ───────────────────────────────────────

    let synthesis = '';

    if (responses.length > 0) {
      // Prefer OpenAI for synthesis speed; fall back to first available
      const synProvider =
        providers.find((p: AIProvider) => (p.name as string) === 'openai') ?? providers[0];

      synthesis = await synthesizeCouncilStream(
        responses,
        synProvider,
        (token: string) => {
          callbacks?.onSynthesisToken?.(token);
        },
      );

      callbacks?.onUpdate?.(synthesis);
      eventBus.emit({ type: 'COUNCIL_CONV_UPDATE', text: synthesis });

      // ── Agent survival tracking ─────────────────────────────────────────
      // Record whether each active agent's contribution area appeared in the
      // synthesis. Done async, non-blocking, fail-silently.
      if (activeAgentIds.length > 0) {
        const taskId    = `council-${startMs}`;
        const msgSnip   = message.slice(0, 80);
        const agentStart = startMs;
        for (const agentId of activeAgentIds) {
          const survived = checkAgentSurvival(agentId, synthesis);
          orchestrator.recordContribution({
            agentId,
            taskId,
            messageSnippet: msgSnip,
            activatedAt:    agentStart,
            survived,
            errorOccurred:  false,
            latencyMs:      Date.now() - agentStart,
          });
        }
        // Evaluate and act every 10 interactions (non-blocking)
        const totalRecords = activeAgentIds.length;
        if (totalRecords % 10 === 0) {
          try { orchestrator.evaluateAndAct(); } catch { /* non-fatal */ }
        }
      }
    }

    // ── Phase 3: ThinkTankPlanner (async, non-blocking) ──────────────────────

    let plan: Plan | undefined;

    if (this._planner && isPlanningTask(message)) {
      this._planner.makePlan(message, 'general').then((p: Plan) => {
        plan = p;
        callbacks?.onPlan?.(p);
        eventBus.emit({ type: 'COUNCIL_CONV_PLAN', plan: p });
      }).catch(() => { /* planner failure is non-fatal */ });
    }

    // ── Phase 4: Proactive suggestion (async, fire-and-forget) ───────────────

    this._maybeProactiveSuggestion(message, responses, providers, callbacks);

    return {
      responses,
      synthesis,
      plan,
      durationMs: Date.now() - startMs,
    };
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private _maybeProactiveSuggestion(
    message:   string,
    responses: Array<{ provider: string; text: string }>,
    providers: AIProvider[],
    callbacks?: CouncilConversationCallbacks,
  ): void {
    const now = Date.now();
    if (now - this._lastSuggestionTime < SUGGESTION_COOLDOWN_MS) return;

    const synProvider =
      providers.find((p: AIProvider) => (p.name as string) === 'openai') ?? providers[0];
    if (!synProvider) return;

    const snippet = responses
      .slice(0, 2)
      .map(r => `${r.provider}: ${r.text.slice(0, 200)}`)
      .join('\n');

    const suggestionMessages = [
      {
        role: 'system',
        content: `You are an AI council assistant reviewing an ongoing conversation.
If there is ONE specific, non-obvious, and genuinely helpful suggestion that could meaningfully improve the user's outcome, provide it in a single concise sentence.
Be very selective — only suggest when it adds real, specific value.
If no strong suggestion is available, respond with exactly: null`,
      },
      {
        role: 'user',
        content: `User message: ${message.slice(0, 200)}\n\nCouncil responses:\n${snippet}\n\nOne helpful suggestion, or null:`,
      },
    ];

    synProvider.chat(suggestionMessages).then((suggestion: string) => {
      suggestion = suggestion.trim();
      if (!suggestion || suggestion.toLowerCase() === 'null' || suggestion.length < 15) return;
      this._lastSuggestionTime = Date.now();
      callbacks?.onSuggestion?.(suggestion);
      eventBus.emit({ type: 'COUNCIL_CONV_SUGGESTION', text: suggestion });
    }).catch(() => { /* stay silent on errors */ });
  }
}

// ── Utilities ─────────────────────────────────────────────────────────────────

/**
 * Detect whether a message is likely requesting a structured plan rather than
 * a conversational response. Requires ≥2 planning keyword matches.
 */
export function isPlanningTask(message: string): boolean {
  if (message.length < PLANNING_MIN_LENGTH) return false;
  const lower = message.toLowerCase();
  const matches = PLANNING_KEYWORDS.filter(k => lower.includes(k));
  return matches.length >= 2;
}
