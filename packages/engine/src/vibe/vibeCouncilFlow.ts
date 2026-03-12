// ── vibeCouncilFlow.ts — Council-guided vibe debate ──────────────────────────
//
// Three council roles reason about vibe requests:
//   brand_taste       — "Does this feel right for the brand?"
//   implementation_ux — "Can we build this without hurting UX?"
//   boldness_edge     — "Is this bold enough? Too safe?"
//
// Follows the same Promise.allSettled pattern as ventureCouncilFlow.ts
// and chat:consensus.

import type {
  VibeProfile, VibeMode, VibeSignal, VibeSystemDecision,
  VibeBuildPlan, VibeConsistencyResult, VibeOutcomeScore,
  VibeCouncilRole, VibeCouncilPosition, VibeProgressPhase,
} from './vibeTypes';
import { parseVibeIntent } from './vibeIntentParser';
import { translateVibeToDecisions, applyGuardrails } from './vibeToSystemTranslator';
import { VibeBuildPlanner } from './vibeBuildPlanner';
import { VibeConsistencyChecker } from './vibeConsistencyChecker';
import { VibeOutcomeScorer } from './vibeOutcomeScorer';
import { DEFAULT_VIBE_CONFIG } from './vibeTypes';

// ── Provider interface (matches existing council pattern) ───────────────────

export interface VibeCouncilProvider {
  name: string;
  chat(messages: { role: string; content: string }[]): Promise<string>;
}

export type OnVibeProgress = (phase: VibeProgressPhase, detail?: string) => void;

export interface VibeCouncilResult {
  signals: VibeSignal[];
  positions: VibeCouncilPosition[];
  synthesizedDecisions: VibeSystemDecision[];
  plan: VibeBuildPlan;
  consistency?: VibeConsistencyResult;
  outcomeScore: VibeOutcomeScore;
}

// ── Role prompt builders ────────────────────────────────────────────────────

function brandTastePrompt(
  profile: VibeProfile, signals: VibeSignal[], expertContext: string, userInput: string,
): string {
  const axesSummary = Object.entries(profile.axes)
    .map(([dim, val]) => `  ${dim}: ${val}/100`)
    .join('\n');

  const signalsSummary = signals.map(s =>
    `  ${s.dimension}: ${s.direction} (intensity ${s.intensity}, confidence ${s.confidence})`,
  ).join('\n');

  return `You are the BRAND & TASTE advisor on a council evaluating a vibe coding request.

USER REQUEST: "${userInput}"

CURRENT VIBE PROFILE (axis values 0-100, 50 = neutral):
${axesSummary}

PARSED SIGNALS:
${signalsSummary}

${expertContext ? `EXPERT CONTEXT:\n${expertContext}\n` : ''}
YOUR ROLE: Evaluate whether these vibe signals create an authentic, coherent brand direction.

Answer in this JSON format:
{
  "decisions": [
    { "dimension": "...", "target": "...", "proposed": "...", "rationale": "...", "impactScore": 0-100, "riskScore": 0-100 }
  ],
  "confidence": 0-100,
  "reasoning": "your overall assessment"
}

Focus on: brand coherence, visual identity consistency, emotional authenticity, premium perception.
Flag any signals that create brand confusion or identity conflict.`;
}

function implementationUxPrompt(
  profile: VibeProfile, signals: VibeSignal[], expertContext: string, userInput: string,
): string {
  const axesSummary = Object.entries(profile.axes)
    .map(([dim, val]) => `  ${dim}: ${val}/100`)
    .join('\n');

  const signalsSummary = signals.map(s =>
    `  ${s.dimension}: ${s.direction} (intensity ${s.intensity})`,
  ).join('\n');

  return `You are the IMPLEMENTATION & UX advisor on a council evaluating a vibe coding request.

USER REQUEST: "${userInput}"

CURRENT VIBE PROFILE:
${axesSummary}

PARSED SIGNALS:
${signalsSummary}

${expertContext ? `EXPERT CONTEXT:\n${expertContext}\n` : ''}
YOUR ROLE: Evaluate whether these vibe changes can be built without hurting usability.

Answer in this JSON format:
{
  "decisions": [
    { "dimension": "...", "target": "...", "proposed": "...", "rationale": "...", "impactScore": 0-100, "riskScore": 0-100 }
  ],
  "confidence": 0-100,
  "reasoning": "your overall assessment"
}

Focus on: technical feasibility, usability impact, accessibility, performance cost, implementation complexity.
Flag any signals that would hurt user experience, break responsive behavior, or create accessibility issues.`;
}

function boldnessEdgePrompt(
  profile: VibeProfile, signals: VibeSignal[], expertContext: string, userInput: string,
): string {
  const axesSummary = Object.entries(profile.axes)
    .map(([dim, val]) => `  ${dim}: ${val}/100`)
    .join('\n');

  const signalsSummary = signals.map(s =>
    `  ${s.dimension}: ${s.direction} (intensity ${s.intensity})`,
  ).join('\n');

  return `You are the BOLDNESS & EDGE advisor on a council evaluating a vibe coding request.

USER REQUEST: "${userInput}"

CURRENT VIBE PROFILE:
${axesSummary}

PARSED SIGNALS:
${signalsSummary}

${expertContext ? `EXPERT CONTEXT:\n${expertContext}\n` : ''}
YOUR ROLE: Evaluate whether this direction is bold enough to be memorable, or too safe to matter.

Answer in this JSON format:
{
  "decisions": [
    { "dimension": "...", "target": "...", "proposed": "...", "rationale": "...", "impactScore": 0-100, "riskScore": 0-100 }
  ],
  "confidence": 0-100,
  "reasoning": "your overall assessment"
}

Focus on: differentiation, memorability, competitive edge, visual uniqueness, emotional impact.
Push back if the direction is generic or forgettable. Suggest bolder alternatives where appropriate.`;
}

// ── Position parser ─────────────────────────────────────────────────────────

function parsePosition(
  role: VibeCouncilRole,
  provider: string,
  raw: string,
): VibeCouncilPosition {
  try {
    // Extract JSON from response (may contain markdown code fences)
    const jsonMatch = raw.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error('No JSON found');

    const parsed = JSON.parse(jsonMatch[0]);
    const decisions: VibeSystemDecision[] = (parsed.decisions || []).map((d: any) => ({
      dimension: String(d.dimension || 'layout'),
      target: String(d.target || 'general'),
      proposed: String(d.proposed || ''),
      rationale: String(d.rationale || ''),
      impactScore: Number(d.impactScore) || 50,
      riskScore: Number(d.riskScore) || 20,
    }));

    return {
      role,
      provider,
      decisions,
      confidence: Number(parsed.confidence) || 50,
      reasoning: String(parsed.reasoning || raw.slice(0, 300)),
    };
  } catch {
    // Fallback: treat entire response as reasoning with no decisions
    return {
      role,
      provider,
      decisions: [],
      confidence: 40,
      reasoning: raw.slice(0, 500),
    };
  }
}

// ── Synthesis ───────────────────────────────────────────────────────────────

function synthesizePositions(positions: VibeCouncilPosition[]): VibeSystemDecision[] {
  // Merge all decisions from all positions, weighted by confidence
  const dimensionDecisions = new Map<string, { decision: VibeSystemDecision; weight: number }>();

  for (const pos of positions) {
    for (const d of pos.decisions) {
      const key = `${d.dimension}:${d.target}`;
      const existing = dimensionDecisions.get(key);
      const weight = pos.confidence / 100;

      if (!existing || weight > existing.weight) {
        dimensionDecisions.set(key, { decision: d, weight });
      }
    }
  }

  // Sort by weighted impact
  return Array.from(dimensionDecisions.values())
    .sort((a, b) => (b.decision.impactScore * b.weight) - (a.decision.impactScore * a.weight))
    .map(v => v.decision);
}

// ── Main council flow ───────────────────────────────────────────────────────

/**
 * Run the vibe coding council.
 *
 * 1. Parse user input into signals
 * 2. Run 3 providers in parallel with role-specific prompts
 * 3. Synthesize positions into merged decisions
 * 4. Build implementation plan
 * 5. Optionally run consistency check (audit/rescue modes)
 * 6. Score outcomes
 */
export async function runVibeCouncil(
  input: string,
  profile: VibeProfile,
  providers: VibeCouncilProvider[],
  expertContext: string,
  mode: VibeMode,
  onProgress?: OnVibeProgress,
): Promise<VibeCouncilResult> {
  // 1. Parse signals
  onProgress?.('vibe_parsing', 'Parsing vibe intent...');
  const signals = parseVibeIntent(input);

  // 2. Run council debate
  onProgress?.('council_debating', 'Council debating vibe direction...');

  const roles: { role: VibeCouncilRole; promptFn: typeof brandTastePrompt }[] = [
    { role: 'brand_taste',        promptFn: brandTastePrompt },
    { role: 'implementation_ux',  promptFn: implementationUxPrompt },
    { role: 'boldness_edge',      promptFn: boldnessEdgePrompt },
  ];

  const results = await Promise.allSettled(
    roles.map(async ({ role, promptFn }, i) => {
      const provider = providers[i % providers.length];
      const prompt = promptFn(profile, signals, expertContext, input);

      onProgress?.(`council_position:${role}` as VibeProgressPhase, `${provider.name} reasoning...`);

      const response = await provider.chat([
        { role: 'system', content: prompt },
        { role: 'user', content: input },
      ]);

      return parsePosition(role, provider.name, response);
    }),
  );

  const positions: VibeCouncilPosition[] = results
    .filter((r): r is PromiseFulfilledResult<VibeCouncilPosition> => r.status === 'fulfilled')
    .map(r => r.value);

  // 3. Synthesize
  onProgress?.('synthesis', 'Synthesizing council positions...');
  let synthesizedDecisions = synthesizePositions(positions);

  // If no council decisions, fall back to rule-based translation
  if (synthesizedDecisions.length === 0) {
    // Apply signals to a working copy to translate
    const workingProfile = { ...profile, axes: { ...profile.axes } };
    for (const s of signals) {
      const current = workingProfile.axes[s.dimension] ?? 50;
      if (s.direction === 'set') {
        workingProfile.axes[s.dimension] = s.intensity;
      } else if (s.direction === 'increase') {
        workingProfile.axes[s.dimension] = Math.round(current + (100 - current) * (s.intensity / 100));
      } else {
        workingProfile.axes[s.dimension] = Math.round(current - current * (s.intensity / 100));
      }
    }
    synthesizedDecisions = translateVibeToDecisions(workingProfile);
  }

  // Apply guardrails
  const { safe, violations } = applyGuardrails(synthesizedDecisions);

  // 4. Build plan
  onProgress?.('plan_building', 'Building implementation plan...');
  const planner = new VibeBuildPlanner();
  const plan = planner.buildPlan(profile, safe);
  plan.guardrailViolations.push(...violations);

  // 5. Consistency check (audit / rescue modes)
  let consistency: VibeConsistencyResult | undefined;
  if (mode === 'audit' || mode === 'rescue') {
    onProgress?.('consistency_check', 'Checking vibe consistency...');
    const checker = new VibeConsistencyChecker();
    consistency = checker.check(profile, input);
  }

  // 6. Outcome scoring
  onProgress?.('scoring', 'Scoring against outcomes...');
  const scorer = new VibeOutcomeScorer();
  const outcomeScore = scorer.score(profile, safe);

  onProgress?.('complete', 'Vibe analysis complete.');

  return {
    signals,
    positions,
    synthesizedDecisions: safe,
    plan,
    consistency,
    outcomeScore,
  };
}
