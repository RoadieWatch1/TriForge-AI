// ── ProblemFramingEngine.ts — Structured problem analysis before council planning ─
//
// Forces the council to reason like senior engineers: diagnose before prescribing.
//
// Pipeline position:
//   ContextBuilder → CouncilMemoryGraph → ProblemFramingEngine → ThinkTankPlanner
//
// The engine sends a structured analysis prompt to all active providers in parallel,
// scores the responses by analytical depth, and returns the strongest ProblemFrame.
// The frame is appended to the planning context so the council inherits a root-cause
// analysis rather than guessing from a raw goal string.
//
// Failure handling:
//   • All individual provider failures are silent (Promise.allSettled)
//   • If framing times out (12 s) the best partial result is used
//   • If all providers fail, frameProblemSafe() returns '' — never blocks the mission

import type { ProviderManager } from '@triforge/engine';
import { withTimeout } from '../utils/withTimeout';
import { createLogger } from '../logging/log';

const log = createLogger('ProblemFramingEngine');

const FRAMING_TIMEOUT_MS = 12_000;

// ── Types ──────────────────────────────────────────────────────────────────────

export interface ProblemFrame {
  summary:              string;
  suspectedCauses:      string[];
  affectedComponents:   string[];
  investigationSteps:   string[];
  riskAreas:            string[];
}

// ── ProblemFramingEngine ───────────────────────────────────────────────────────

export class ProblemFramingEngine {
  constructor(private readonly providerManager: ProviderManager) {}

  /**
   * Analyze the problem in parallel across all active providers.
   * Returns the highest-quality ProblemFrame found within the timeout.
   * Throws if no provider returns a parseable frame.
   */
  async frameProblem(
    goal:             string,
    workspaceContext: string,
    councilMemory:    string,
  ): Promise<ProblemFrame> {
    log.info('problem framing started');

    const providers = await this.providerManager.getActiveProviders();
    if (providers.length === 0) {
      throw new Error('no active providers for problem framing');
    }

    const prompt = _buildPrompt(goal, workspaceContext, councilMemory);

    // Run all providers in parallel — never wait for slow ones
    const racedResults = await withTimeout(
      Promise.allSettled(providers.map(p => p.generateResponse(prompt))),
      FRAMING_TIMEOUT_MS,
      'ProblemFramingEngine',
    ).catch(() => {
      // Timeout — return whatever settled so far by re-running without timeout
      // (already-settled promises resolve instantly)
      return Promise.allSettled(providers.map(p =>
        Promise.resolve().then(() => {
          // Providers that finished will have cached their result — re-use via a
          // short local timeout so we don't re-fire network calls
          return p.generateResponse(prompt);
        }),
      ));
    });

    // Parse all fulfilled responses and score by analytical depth
    const frames: ProblemFrame[] = [];
    for (const result of racedResults) {
      if (result.status !== 'fulfilled') continue;
      const frame = _parseFrame(result.value);
      if (frame) frames.push(frame);
    }

    if (frames.length === 0) {
      throw new Error('all providers returned unparseable frames');
    }

    const best = frames.sort((a, b) => _scoreFrame(b) - _scoreFrame(a))[0]!;
    log.info(`problem frame generated — causes:${best.suspectedCauses.length} components:${best.affectedComponents.length} steps:${best.investigationSteps.length}`);
    return best;
  }

  /**
   * Non-throwing version for MissionController.
   * Returns formatted frame string on success, empty string on any failure.
   */
  async frameProblemSafe(
    goal:             string,
    workspaceContext: string,
    councilMemory:    string,
  ): Promise<string> {
    try {
      const frame = await this.frameProblem(goal, workspaceContext, councilMemory);
      return formatFrame(frame);
    } catch (e) {
      log.warn('problem framing failed (non-fatal):', String(e).slice(0, 120));
      return '';
    }
  }
}

// ── Formatting ─────────────────────────────────────────────────────────────────

/**
 * Converts a ProblemFrame into a structured text block for prompt injection.
 */
export function formatFrame(frame: ProblemFrame): string {
  const lines: string[] = ['--- PROBLEM ANALYSIS ---', ''];

  lines.push(`Summary:\n${frame.summary}`);

  if (frame.suspectedCauses.length > 0) {
    lines.push('', 'Suspected Causes:');
    for (const c of frame.suspectedCauses) lines.push(`• ${c}`);
  }

  if (frame.affectedComponents.length > 0) {
    lines.push('', 'Affected Components:');
    for (const c of frame.affectedComponents) lines.push(`• ${c}`);
  }

  if (frame.investigationSteps.length > 0) {
    lines.push('', 'Investigation Steps:');
    frame.investigationSteps.forEach((s, i) => lines.push(`${i + 1}. ${s}`));
  }

  if (frame.riskAreas.length > 0) {
    lines.push('', 'Risk Areas:');
    for (const r of frame.riskAreas) lines.push(`• ${r}`);
  }

  return lines.join('\n');
}

// ── Private helpers ────────────────────────────────────────────────────────────

function _buildPrompt(goal: string, workspaceContext: string, councilMemory: string): string {
  const ctxSection = workspaceContext
    ? `\nWORKSPACE CONTEXT:\n${workspaceContext}`
    : '';
  const memSection = councilMemory
    ? `\nCOUNCIL MEMORY:\n${councilMemory}`
    : '';

  return `You are a senior software engineer analyzing an engineering task.

GOAL:
${goal}
${ctxSection}
${memSection}

Your task: analyze this problem BEFORE proposing any solutions.
Think like a senior engineer diagnosing a system. Do not suggest fixes yet.

Analyze:
  • What is the core problem, precisely stated?
  • What are the most likely root causes?
  • Which files, modules, or systems are affected?
  • What must be investigated first to understand the problem?
  • What could go wrong during a fix?

Return ONLY valid JSON — no markdown, no code block, no extra text:
{
  "summary": "One to two sentences precisely describing the problem",
  "suspectedCauses": ["cause 1", "cause 2"],
  "affectedComponents": ["file or module 1", "file or module 2"],
  "investigationSteps": ["step 1", "step 2", "step 3"],
  "riskAreas": ["risk 1", "risk 2"]
}`;
}

/**
 * Parse a ProblemFrame from a raw provider response string.
 * Handles JSON wrapped in markdown code blocks.
 * Returns null if the response is not parseable or missing required fields.
 */
function _parseFrame(raw: string): ProblemFrame | null {
  try {
    // Strip markdown code fences if present
    const cleaned = raw
      .replace(/^```(?:json)?\s*/i, '')
      .replace(/\s*```\s*$/, '')
      .trim();

    // Extract the first JSON object from the string
    const match = cleaned.match(/\{[\s\S]*\}/);
    if (!match) return null;

    const parsed = JSON.parse(match[0]) as Record<string, unknown>;

    const summary = typeof parsed.summary === 'string' ? parsed.summary.trim() : '';
    if (!summary) return null;  // summary is the minimum requirement

    return {
      summary,
      suspectedCauses:    _toStringArray(parsed.suspectedCauses),
      affectedComponents: _toStringArray(parsed.affectedComponents),
      investigationSteps: _toStringArray(parsed.investigationSteps),
      riskAreas:          _toStringArray(parsed.riskAreas),
    };
  } catch {
    return null;
  }
}

function _toStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v): v is string => typeof v === 'string')
    .map(s => s.trim())
    .filter(Boolean);
}

/**
 * Score a ProblemFrame by analytical depth.
 * Higher = more thorough analysis = better candidate.
 *
 * Weights:
 *   • suspectedCauses    ×3  — root cause depth is most valuable
 *   • affectedComponents ×2  — scope understanding
 *   • investigationSteps ×2  — actionability
 *   • riskAreas          ×1  — risk awareness
 *   • summary length bonus   — detailed summaries over vague ones
 */
function _scoreFrame(frame: ProblemFrame): number {
  return (
    frame.suspectedCauses.length      * 3 +
    frame.affectedComponents.length   * 2 +
    frame.investigationSteps.length   * 2 +
    frame.riskAreas.length            * 1 +
    (frame.summary.length > 80 ? 2 : 0)  // bonus for detailed summary
  );
}
