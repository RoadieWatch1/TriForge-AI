/**
 * imageService.ts — Pro Image Generation orchestrator.
 *
 * Pipeline:
 *   1. refinePrompt()   — Claude expands the user prompt (creative director)
 *   2. getStyleSuffix() — append style preset keywords
 *   3. generate()       — call OpenAI DALL-E 3 or Grok
 *   4. critiqueImages() — optional AI council critique
 *   5. persist()        — save to ImageHistoryStore
 *   6. eventBus.emit()  — IMAGE_REQUESTED, IMAGE_GENERATED, IMAGE_CRITIQUE
 */

import * as crypto from 'crypto';
import { eventBus }               from '../core/eventBus';
import type { AIProvider }         from '../core/providers/provider';
import { refinePrompt }            from './promptRefiner';
import { getStyleSuffix }          from './styles';
import { createGeneratorRouter }   from './generatorRouter';
import type { GenerateImageOptions, GeneratedImage } from './generatorRouter';
import { critiqueImages }          from './imageCritique';
import type { ImageHistoryStore, ImageHistoryEntry } from './imageHistoryStore';

// ── Public request / result types ─────────────────────────────────────────────

export interface ImageGenerationRequest {
  userPrompt:      string;
  style?:          string;    // StylePresetKey
  negativePrompt?: string;
  seed?:           number;
  count?:          number;    // 1–4
  width?:          number;
  height?:         number;
  quality?:        'standard' | 'hd';
  imageStyle?:     'vivid' | 'natural';
  enableCritique?: boolean;   // default true
  enableRefine?:   boolean;   // default true (Claude prompt expansion)
}

export interface ImageGenerationResult {
  id:             string;
  userPrompt:     string;
  refinedPrompt:  string;
  images:         Array<{
    base64:    string;
    mimeType:  string;
    seed?:     number;
    generator: string;
  }>;
  bestIndex:      number;
  critique?:      import('./imageCritique').CritiqueResult;
  durationMs:     number;
  generator:      string;
}

// ── ImageService ──────────────────────────────────────────────────────────────

export class ImageService {
  constructor(
    private _refineProvider:   AIProvider | null,   // Claude for prompt expansion
    private _critiqueProvider: AIProvider | null,   // any AI for critique
    private _openAiKey:        string | undefined,
    private _grokKey:          string | undefined,
    private _historyStore:     ImageHistoryStore,
  ) {}

  canGenerate(): boolean {
    return createGeneratorRouter(this._openAiKey, this._grokKey).canGenerate();
  }

  async generate(req: ImageGenerationRequest): Promise<ImageGenerationResult> {
    const startMs  = Date.now();
    const id       = crypto.randomUUID();

    // 1. Emit request event
    eventBus.emit({
      type:       'IMAGE_REQUESTED',
      requestId:  id,
      userPrompt: req.userPrompt,
    });

    // 2. Refine prompt via Claude (optional)
    let refinedPrompt = req.userPrompt;
    if (req.enableRefine !== false && this._refineProvider) {
      refinedPrompt = await refinePrompt(this._refineProvider, req.userPrompt, req.style);
    }

    // 3. Append style suffix
    const styleSuffix = getStyleSuffix(req.style);
    const fullPrompt  = refinedPrompt + styleSuffix;

    // 4. Generate images
    const router  = createGeneratorRouter(this._openAiKey, this._grokKey);
    const genOpts: GenerateImageOptions = {
      prompt:         fullPrompt,
      negativePrompt: req.negativePrompt,
      width:          req.width    ?? 1024,
      height:         req.height   ?? 1024,
      seed:           req.seed,
      count:          req.count    ?? 1,
      quality:        req.quality  ?? 'standard',
      style:          req.imageStyle ?? 'vivid',
    };

    let generatedImages: GeneratedImage[];
    try {
      generatedImages = await router.generate(genOpts);
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      eventBus.emit({ type: 'IMAGE_FAILED', requestId: id, error });
      throw err;
    }

    // 5. Emit generated event
    eventBus.emit({
      type:      'IMAGE_GENERATED',
      requestId: id,
      count:     generatedImages.length,
      generator: generatedImages[0]?.generator ?? 'openai',
    });

    // 6. Critique (optional)
    let critique: import('./imageCritique').CritiqueResult | undefined;
    let bestIndex = 0;

    if (req.enableCritique !== false && this._critiqueProvider && generatedImages.length > 0) {
      critique  = await critiqueImages(
        this._critiqueProvider,
        req.userPrompt,
        generatedImages.map(img => img.base64),
      );
      bestIndex = critique.bestIndex;

      if (!critique.skipped) {
        eventBus.emit({
          type:      'IMAGE_CRITIQUE',
          requestId: id,
          bestIndex: critique.bestIndex,
          summary:   critique.summary,
        });
      }
    }

    const durationMs = Date.now() - startMs;

    // 7. Persist to history
    const entry: ImageHistoryEntry = {
      id,
      userPrompt:     req.userPrompt,
      refinedPrompt:  fullPrompt,
      style:          req.style,
      negativePrompt: req.negativePrompt,
      seed:           req.seed,
      width:          req.width   ?? 1024,
      height:         req.height  ?? 1024,
      quality:        req.quality ?? 'standard',
      generator:      generatedImages[0]?.generator ?? 'openai',
      images:         generatedImages.map(img => img.base64),
      critique,
      bestIndex,
      generatedAt:    startMs,
      durationMs,
    };
    this._historyStore.save(entry);

    return {
      id,
      userPrompt:    req.userPrompt,
      refinedPrompt: fullPrompt,
      images:        generatedImages,
      bestIndex,
      critique,
      durationMs,
      generator:     generatedImages[0]?.generator ?? 'openai',
    };
  }
}
