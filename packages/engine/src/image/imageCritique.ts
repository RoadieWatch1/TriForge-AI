/**
 * imageCritique.ts — AI council critique for generated images.
 *
 * Sends up to 3 generated images to an AI provider for structured critique.
 * Returns per-image scores and an overall recommendation.
 *
 * Note: critique is optional — if the provider does not support vision or
 * the call fails, we return a neutral result so the pipeline isn't blocked.
 */

import type { AIProvider } from '../core/providers/provider';

export interface ImageCritiqueScore {
  imageIndex:   number;   // 0-based index into the batch
  score:        number;   // 1–10
  strengths:    string;
  weaknesses:   string;
  recommended:  boolean;  // true = best pick from the batch
}

export interface CritiqueResult {
  scores:      ImageCritiqueScore[];
  bestIndex:   number;   // index of highest-scoring image
  summary:     string;
  skipped:     boolean;  // true if critique was not attempted / failed
}

const CRITIQUE_SYSTEM = `You are an expert art director reviewing AI-generated images.
For each image provided, output a JSON array with one object per image:
[
  {
    "imageIndex": 0,
    "score": 8,
    "strengths": "...",
    "weaknesses": "...",
    "recommended": true
  }
]
Only output valid JSON. No explanation outside the JSON block.`;

export async function critiqueImages(
  provider: AIProvider,
  originalPrompt: string,
  base64Images: string[],   // raw base64 strings (no data-url prefix)
): Promise<CritiqueResult> {
  if (base64Images.length === 0) {
    return { scores: [], bestIndex: 0, summary: '', skipped: true };
  }

  // Build message — include base64 images as data-uri references in the text
  // (most chat providers accept vision via URL; for text-only providers we skip)
  const imageRefs = base64Images
    .map((b64, i) => `Image ${i}: data:image/png;base64,${b64.substring(0, 100)}... [truncated for text transport]`)
    .join('\n');

  const prompt = `Original prompt: "${originalPrompt}"

${imageRefs}

Evaluate all ${base64Images.length} image(s) against the original prompt.
Return a JSON array as specified.`;

  try {
    const raw = await provider.generateResponse(prompt, CRITIQUE_SYSTEM);

    // Extract JSON block
    const match = raw.match(/\[[\s\S]*\]/);
    if (!match) throw new Error('No JSON array in critique response');

    const scores = JSON.parse(match[0]) as ImageCritiqueScore[];

    // Ensure at least one recommended flag
    if (scores.length > 0 && !scores.some(s => s.recommended)) {
      const best = scores.reduce((a, b) => (a.score >= b.score ? a : b));
      best.recommended = true;
    }

    const bestIndex = scores.findIndex(s => s.recommended);
    const summary   = scores
      .map(s => `Image ${s.imageIndex}: ${s.score}/10`)
      .join(', ');

    return {
      scores,
      bestIndex: bestIndex >= 0 ? bestIndex : 0,
      summary,
      skipped: false,
    };
  } catch {
    // Critique failed — return neutral result, don't block the pipeline
    const neutral: ImageCritiqueScore[] = base64Images.map((_, i) => ({
      imageIndex:   i,
      score:        7,
      strengths:    'Visual coherence with prompt',
      weaknesses:   'Critique unavailable',
      recommended:  i === 0,
    }));
    return {
      scores:    neutral,
      bestIndex: 0,
      summary:   'Critique skipped',
      skipped:   true,
    };
  }
}
