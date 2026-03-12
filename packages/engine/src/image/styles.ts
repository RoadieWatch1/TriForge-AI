/**
 * styles.ts — Style preset library for AI image generation.
 *
 * Each preset appends visual keywords to the expanded prompt so the generator
 * has strong stylistic direction without requiring users to know prompt
 * engineering terminology.
 */

export const STYLE_PRESETS = {
  cinematic:    'cinematic lighting, dramatic shadows, volumetric light rays, film grain, anamorphic lens flare, shallow depth of field',
  cyberpunk:    'cyberpunk neon lighting, futuristic megacity, glowing holographic reflections on wet pavement, rain-soaked streets, electric atmosphere',
  anime:        'anime style illustration, vibrant colors, clean expressive linework, cel shading, studio production quality',
  product:      'studio product photography, softbox lighting, ultra sharp focus, neutral gradient background, commercial grade quality',
  architecture: 'architectural visualization, photorealistic materials, global illumination, ambient occlusion, professional render',
  fantasy:      'epic fantasy art, intricate magical details, mystical atmosphere, soft ethereal lighting, hand-painted texture',
  portrait:     'professional portrait photography, studio lighting, bokeh background, high detail skin texture, editorial quality',
  landscape:    'sweeping landscape photography, golden hour lighting, wide angle panorama, sharp foreground detail, dramatic sky',
  noir:         'film noir style, high contrast black and white, dramatic shadows, 1940s atmospheric mood',
  watercolor:   'watercolor illustration, soft wet edges, translucent layers, artistic brush strokes, pastel tones',
} as const;

export type StylePresetKey = keyof typeof STYLE_PRESETS;

export function getStyleSuffix(style: string | undefined): string {
  if (!style) return '';
  const preset = STYLE_PRESETS[style as StylePresetKey];
  return preset ? `, ${preset}` : '';
}
