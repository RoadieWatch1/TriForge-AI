/**
 * promptRefiner.ts — Claude-powered prompt expansion for image generation.
 *
 * Takes a short user description and produces a rich, detailed image prompt
 * optimised for DALL-E 3 / Grok image generators. Claude acts as a creative
 * director: it adds composition, lighting, mood, and technical details that
 * would otherwise require prompt-engineering expertise from the user.
 */

import type { AIProvider } from '../core/providers/provider';

const SYSTEM_CONTEXT = `You are an expert AI image prompt engineer and creative director.
Your task is to expand a short user description into a detailed, vivid image generation prompt.

Rules:
- Output ONLY the expanded prompt — no explanations, no preambles, no quotes.
- Add specific details about: composition, lighting, mood, color palette, camera angle, texture.
- Use comma-separated descriptive phrases, not full sentences.
- Keep the output under 400 words.
- Never add explicit, violent, or harmful content.
- Preserve the user's original intent and subject matter exactly.`;

export async function refinePrompt(
  provider: AIProvider,
  userPrompt: string,
  style?: string,
): Promise<string> {
  const styleHint = style ? ` The image style should be: ${style}.` : '';
  const input = `Expand this into a detailed image generation prompt:
"${userPrompt}"${styleHint}

Return only the expanded prompt text.`;

  try {
    const refined = await provider.generateResponse(input, SYSTEM_CONTEXT);
    // Strip any stray quotes the model might add
    return refined.trim().replace(/^["']|["']$/g, '');
  } catch {
    // Fallback: return the original prompt unchanged
    return userPrompt;
  }
}
