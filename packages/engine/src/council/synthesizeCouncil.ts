// ── synthesizeCouncil.ts ──────────────────────────────────────────────────────
//
// Merges responses from multiple council providers into a single, improved
// answer. Uses the first available provider (prefers OpenAI for speed).

import type { AIProvider } from '../core/providers/provider';

const SYNTHESIS_SYSTEM = `You are a council synthesis engine. You receive responses from multiple AI advisors on the same question.
Your task: extract the strongest ideas from each, resolve any contradictions, and return a single superior answer.
Be concise and decisive. Do not attribute ideas to individual advisors. Return only the synthesized answer.`;

/**
 * Synthesize multiple council responses into one coherent answer.
 *
 * @param responses - Array of {provider, text} from each council member.
 * @param synProvider - The AI provider to use for synthesis (prefer a fast model).
 * @param signal - Optional abort signal.
 * @returns Synthesized text.
 */
export async function synthesizeCouncil(
  responses: Array<{ provider: string; text: string }>,
  synProvider: AIProvider,
  signal?: AbortSignal,
): Promise<string> {
  if (responses.length === 0) return '';
  if (responses.length === 1) return responses[0].text;

  const userContent = responses
    .map(r => `[${r.provider.toUpperCase()}]:\n${r.text.slice(0, 1500)}`)
    .join('\n\n');

  const messages = [
    { role: 'system',  content: SYNTHESIS_SYSTEM },
    { role: 'user',    content: `Synthesize these council responses into one best answer:\n\n${userContent}` },
  ];

  try {
    return await synProvider.chat(messages, signal);
  } catch {
    // Fallback: return the longest response on failure
    return responses.reduce((best, r) => r.text.length > best.text.length ? r : best).text;
  }
}

/**
 * Streaming variant — calls onChunk for each token.
 * Resolves with the full synthesized text.
 */
export async function synthesizeCouncilStream(
  responses: Array<{ provider: string; text: string }>,
  synProvider: AIProvider,
  onChunk: (token: string) => void,
  signal?: AbortSignal,
): Promise<string> {
  if (responses.length === 0) return '';
  if (responses.length === 1) {
    // Simulate streaming for a single response
    onChunk(responses[0].text);
    return responses[0].text;
  }

  const userContent = responses
    .map(r => `[${r.provider.toUpperCase()}]:\n${r.text.slice(0, 1500)}`)
    .join('\n\n');

  const messages = [
    { role: 'system',  content: SYNTHESIS_SYSTEM },
    { role: 'user',    content: `Synthesize these council responses into one best answer:\n\n${userContent}` },
  ];

  try {
    return await synProvider.chatStream(messages, onChunk, signal);
  } catch {
    const fallback = responses.reduce((best, r) => r.text.length > best.text.length ? r : best).text;
    onChunk(fallback);
    return fallback;
  }
}
