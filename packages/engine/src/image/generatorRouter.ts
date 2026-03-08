/**
 * generatorRouter.ts — Routes image generation requests to the best available API.
 *
 * Priority: OpenAI DALL-E 3 → Grok image generation → error (no local fallback)
 * Each generator returns an array of base64-encoded image strings.
 */

export interface GenerateImageOptions {
  prompt:         string;
  negativePrompt?: string;
  width?:         number;   // default 1024
  height?:        number;   // default 1024
  seed?:          number;
  count?:         number;   // 1–4
  quality?:       'standard' | 'hd';
  style?:         'vivid' | 'natural';
}

export interface GeneratedImage {
  base64:    string;        // data-url ready (without prefix)
  mimeType:  'image/png';
  seed?:     number;
  generator: 'openai' | 'grok';
}

export interface GeneratorRouter {
  /** True when at least one generator is available */
  canGenerate(): boolean;
  generate(options: GenerateImageOptions): Promise<GeneratedImage[]>;
}

// ── OpenAI DALL-E 3 ───────────────────────────────────────────────────────────

async function generateWithOpenAI(
  apiKey: string,
  options: GenerateImageOptions,
): Promise<GeneratedImage[]> {
  const count = Math.min(options.count ?? 1, 4);
  const results: GeneratedImage[] = [];

  // DALL-E 3 only supports n=1; loop for batches
  for (let i = 0; i < count; i++) {
    const seedPrompt = options.seed !== undefined
      ? `${options.prompt} [seed:${options.seed + i}]`
      : options.prompt;

    const resp = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model:            'dall-e-3',
        prompt:           seedPrompt,
        n:                1,
        size:             `${options.width ?? 1024}x${options.height ?? 1024}`,
        quality:          options.quality ?? 'standard',
        style:            options.style   ?? 'vivid',
        response_format:  'b64_json',
      }),
      signal: AbortSignal.timeout(120_000),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({})) as { error?: { message?: string } };
      throw new Error(err?.error?.message ?? `OpenAI image error ${resp.status}`);
    }

    const data = await resp.json() as { data: Array<{ b64_json: string }> };
    const b64 = data.data?.[0]?.b64_json;
    if (!b64) throw new Error('OpenAI returned no image data');

    results.push({
      base64:    b64,
      mimeType:  'image/png',
      seed:      options.seed !== undefined ? options.seed + i : undefined,
      generator: 'openai',
    });
  }

  return results;
}

// ── Grok image generation ─────────────────────────────────────────────────────

async function generateWithGrok(
  apiKey: string,
  options: GenerateImageOptions,
): Promise<GeneratedImage[]> {
  const count = Math.min(options.count ?? 1, 4);
  const results: GeneratedImage[] = [];

  for (let i = 0; i < count; i++) {
    const resp = await fetch('https://api.x.ai/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model:            'grok-2-image',
        prompt:           options.prompt,
        n:                1,
        response_format:  'b64_json',
      }),
      signal: AbortSignal.timeout(120_000),
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({})) as { error?: { message?: string } };
      throw new Error(err?.error?.message ?? `Grok image error ${resp.status}`);
    }

    const data = await resp.json() as { data: Array<{ b64_json: string }> };
    const b64 = data.data?.[0]?.b64_json;
    if (!b64) throw new Error('Grok returned no image data');

    results.push({
      base64:    b64,
      mimeType:  'image/png',
      seed:      options.seed !== undefined ? options.seed + i : undefined,
      generator: 'grok',
    });
  }

  return results;
}

// ── Public factory ────────────────────────────────────────────────────────────

export function createGeneratorRouter(
  openAiKey: string | undefined,
  grokKey:   string | undefined,
): GeneratorRouter {
  return {
    canGenerate(): boolean {
      return !!(openAiKey || grokKey);
    },

    async generate(options: GenerateImageOptions): Promise<GeneratedImage[]> {
      if (openAiKey) {
        try {
          return await generateWithOpenAI(openAiKey, options);
        } catch (err) {
          // Fall back to Grok if available
          if (grokKey) {
            console.warn(`[GeneratorRouter] OpenAI failed, falling back to Grok: ${err instanceof Error ? err.message : err}`);
            return generateWithGrok(grokKey, options);
          }
          throw err;
        }
      }
      if (grokKey) {
        return generateWithGrok(grokKey, options);
      }
      throw new Error(
        'No image generation API key configured. Add an OpenAI or Grok API key in Settings → API Keys.',
      );
    },
  };
}
