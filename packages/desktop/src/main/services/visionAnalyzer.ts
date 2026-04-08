// ── visionAnalyzer.ts ─────────────────────────────────────────────────────────
//
// Phase 6 — Vision Model Integration
//
// Feeds screenshots directly to Claude's vision API so TriForge can
// understand any UI without pre-programmed coordinates.
//
// Capabilities:
//   - describeScreen()       — full natural-language description of what's visible
//   - locateElement()        — find pixel coordinates of a named UI element
//   - isElementVisible()     — yes/no: is X visible on screen right now?
//   - readScreenText()       — structured text extraction (better than raw OCR)
//   - analyzeScreen()        — ask any freeform question about the screen
//   - detectKeyboard()       — specifically detect on-screen keyboard presence + bounds
//
// Uses the Anthropic Messages API directly (same auth as ClaudeProvider).
// Requires ANTHROPIC_API_KEY in environment or electron-store settings.

import https  from 'https';
import fs     from 'fs';
import path   from 'path';
import os     from 'os';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface VisionElementLocation {
  found:       boolean;
  x?:          number;
  y?:          number;
  width?:      number;
  height?:     number;
  confidence?: 'high' | 'medium' | 'low';
  description?: string;
}

export interface VisionScreenDescription {
  summary:        string;
  activeApp?:     string;
  visibleWindows: string[];
  hasKeyboard:    boolean;
  keyboardType?:  'on-screen' | 'physical-indicator' | 'none';
  dominantContent?: string;
}

export interface VisionAnalysisResult {
  ok:       boolean;
  answer:   string;
  error?:   string;
  modelUsed?: string;
}

// ── Config ────────────────────────────────────────────────────────────────────

const ANTHROPIC_API_HOST = 'api.anthropic.com';
const ANTHROPIC_API_PATH = '/v1/messages';
const VISION_MODEL       = 'claude-sonnet-4-6';
const MAX_TOKENS         = 1024;

// ── API key ───────────────────────────────────────────────────────────────────
//
// Resolved in priority order:
//   1. ANTHROPIC_API_KEY environment variable (set by user or CI)
//   2. Key injected via setVisionApiKey() from the IPC layer (loaded from
//      electron-store 'triforge.claude.apiKey' before each task run)
//
// Call setVisionApiKey(key) from ipc.ts before invoking any vision function.

let _injectedApiKey: string | null = null;

/**
 * Inject the Anthropic API key at runtime.
 * Called from ipc.ts when the Claude key is loaded from electron-store.
 */
export function setVisionApiKey(key: string): void {
  _injectedApiKey = key;
}

function getApiKey(): string | null {
  return process.env.ANTHROPIC_API_KEY ?? _injectedApiKey ?? null;
}

// ── Core vision call ──────────────────────────────────────────────────────────

/**
 * Send a screenshot + question to Claude's vision API.
 * @param imagePath  Path to a PNG/JPEG screenshot file
 * @param prompt     What to ask about the screenshot
 * @param systemPrompt  Optional system instruction for structured output
 */
export async function analyzeScreen(
  imagePath:    string,
  prompt:       string,
  systemPrompt?: string,
): Promise<VisionAnalysisResult> {
  const apiKey = getApiKey();
  if (!apiKey) {
    return {
      ok:     false,
      answer: '',
      error:  'ANTHROPIC_API_KEY not set. Add it to environment variables or TriForge settings.',
    };
  }

  let base64Image: string;
  try {
    const buf = await fs.promises.readFile(imagePath);
    base64Image = buf.toString('base64');
  } catch (err) {
    return { ok: false, answer: '', error: `Could not read screenshot: ${String(err)}` };
  }

  const ext      = path.extname(imagePath).toLowerCase();
  const mimeType = ext === '.jpg' || ext === '.jpeg' ? 'image/jpeg' : 'image/png';

  const messages = [
    {
      role:    'user',
      content: [
        {
          type:   'image',
          source: {
            type:       'base64',
            media_type: mimeType,
            data:       base64Image,
          },
        },
        {
          type: 'text',
          text: prompt,
        },
      ],
    },
  ];

  const body: Record<string, unknown> = {
    model:      VISION_MODEL,
    max_tokens: MAX_TOKENS,
    messages,
  };
  if (systemPrompt) {
    body.system = systemPrompt;
  }

  const bodyStr = JSON.stringify(body);

  try {
    const response = await new Promise<string>((resolve, reject) => {
      const req = https.request(
        {
          hostname: ANTHROPIC_API_HOST,
          path:     ANTHROPIC_API_PATH,
          method:   'POST',
          headers:  {
            'Content-Type':      'application/json',
            'Content-Length':    Buffer.byteLength(bodyStr),
            'x-api-key':         apiKey,
            'anthropic-version': '2023-06-01',
          },
        },
        res => {
          let data = '';
          res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
          res.on('end', () => resolve(data));
        },
      );
      req.on('error', reject);
      req.setTimeout(30_000, () => { req.destroy(); reject(new Error('Vision API timeout')); });
      req.write(bodyStr);
      req.end();
    });

    const parsed = JSON.parse(response) as {
      content?: Array<{ type: string; text?: string }>;
      error?:   { message: string };
    };

    if (parsed.error) {
      return { ok: false, answer: '', error: parsed.error.message };
    }

    const text = parsed.content?.find(c => c.type === 'text')?.text ?? '';
    return { ok: true, answer: text, modelUsed: VISION_MODEL };
  } catch (err) {
    return { ok: false, answer: '', error: String(err) };
  }
}

// ── High-level helpers ────────────────────────────────────────────────────────

/**
 * Get a full description of what's currently on screen.
 */
export async function describeScreen(imagePath: string): Promise<VisionScreenDescription> {
  const result = await analyzeScreen(
    imagePath,
    'Describe this screenshot. List: 1) What app/window is in focus, 2) All visible windows or panels, 3) Is an on-screen keyboard visible? 4) What is the main content on screen?',
    'Respond in JSON with this exact shape: { "activeApp": string, "visibleWindows": string[], "hasKeyboard": boolean, "keyboardType": "on-screen"|"none", "dominantContent": string, "summary": string }. No markdown, just raw JSON.',
  );

  if (!result.ok) {
    return {
      summary:        result.error ?? 'Vision analysis failed.',
      visibleWindows: [],
      hasKeyboard:    false,
    };
  }

  try {
    const cleaned = result.answer.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(cleaned) as VisionScreenDescription;
  } catch {
    return {
      summary:        result.answer,
      visibleWindows: [],
      hasKeyboard:    result.answer.toLowerCase().includes('keyboard'),
    };
  }
}

/**
 * Find the screen coordinates of a named UI element.
 * Returns center (x, y) and approximate bounding box.
 */
export async function locateElement(
  imagePath:   string,
  elementDesc: string,
): Promise<VisionElementLocation> {
  const result = await analyzeScreen(
    imagePath,
    `Find the UI element described as: "${elementDesc}". Give its center pixel coordinates (x, y) and approximate width/height in pixels. If not visible, say so.`,
    'Respond in JSON: { "found": boolean, "x": number|null, "y": number|null, "width": number|null, "height": number|null, "confidence": "high"|"medium"|"low", "description": string }. No markdown.',
  );

  if (!result.ok) return { found: false, description: result.error };

  try {
    const cleaned = result.answer.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(cleaned) as VisionElementLocation;
  } catch {
    return { found: false, description: result.answer };
  }
}

/**
 * Check if a specific element or condition is visible on screen.
 */
export async function isElementVisible(
  imagePath:   string,
  elementDesc: string,
): Promise<boolean> {
  const result = await analyzeScreen(
    imagePath,
    `Is there a "${elementDesc}" visible on screen? Answer only: YES or NO.`,
  );
  return result.ok && result.answer.trim().toUpperCase().startsWith('YES');
}

/**
 * Detect whether an on-screen keyboard is visible and where it is.
 */
export async function detectKeyboard(imagePath: string): Promise<{
  visible:     boolean;
  type?:       'on-screen' | 'floating' | 'emoji' | 'unknown';
  position?:   'bottom' | 'top' | 'floating' | 'unknown';
  approximate?: { x: number; y: number; width: number; height: number };
}> {
  const result = await analyzeScreen(
    imagePath,
    'Is an on-screen / virtual keyboard visible? If yes: what type (standard, emoji, floating)? Where is it (bottom, top, floating)? Estimate its bounding box (x, y, width, height in pixels).',
    'Respond in JSON: { "visible": boolean, "type": "on-screen"|"floating"|"emoji"|"unknown"|null, "position": "bottom"|"top"|"floating"|"unknown"|null, "approximate": { "x": number, "y": number, "width": number, "height": number } | null }. No markdown.',
  );

  if (!result.ok) return { visible: false };

  try {
    const cleaned = result.answer.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(cleaned);
  } catch {
    const lower = result.answer.toLowerCase();
    return {
      visible: lower.includes('yes') || lower.includes('keyboard'),
      type:    'unknown',
    };
  }
}

/**
 * Read and structure all text visible on screen (better than raw tesseract OCR
 * because Claude understands context: labels, buttons, paragraphs, etc.)
 */
export async function readScreenText(imagePath: string): Promise<{
  fullText:  string;
  labels:    string[];
  buttons:   string[];
  headings:  string[];
}> {
  const result = await analyzeScreen(
    imagePath,
    'Extract all text visible on screen. Categorize as: labels, button text, headings, and everything else as fullText.',
    'Respond in JSON: { "fullText": string, "labels": string[], "buttons": string[], "headings": string[] }. No markdown.',
  );

  if (!result.ok) return { fullText: '', labels: [], buttons: [], headings: [] };

  try {
    const cleaned = result.answer.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    return JSON.parse(cleaned);
  } catch {
    return { fullText: result.answer, labels: [], buttons: [], headings: [] };
  }
}

/**
 * Ask a freeform question about what's on screen.
 * Useful for: "Is there an error dialog?", "What is the file name shown?",
 * "Which menu is open?", "What color is the selected button?"
 */
export async function askAboutScreen(
  imagePath: string,
  question:  string,
): Promise<string> {
  const result = await analyzeScreen(imagePath, question);
  return result.ok ? result.answer : `Vision error: ${result.error}`;
}
