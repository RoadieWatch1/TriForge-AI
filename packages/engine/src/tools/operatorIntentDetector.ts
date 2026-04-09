// ── operatorIntentDetector.ts ─────────────────────────────────────────────────
//
// Detects when a user's chat message is an instruction to DO something inside
// a specific app on their desktop — not a question to answer, but a task to execute.
//
// When detected, TriForge shows an "Execute" action card in chat so the user
// can trigger the operator task runner with one click instead of navigating to
// the Operate screen.
//
// Design: conservative detection to avoid false positives. Requires BOTH a clear
// action verb AND a known target app or general desktop context.

export interface OperatorIntentResult {
  isOperatorTask: boolean;
  goal:           string;
  targetApp:      string | null;
  /** Pack to suggest, if a specific workflow pack matches the intent. */
  suggestedPackId: string | null;
  confidence:     'high' | 'medium';
}

// ── App name normalisation ────────────────────────────────────────────────────

const APP_PATTERNS: Array<{ keywords: string[]; appName: string; packHint?: string }> = [
  // Unreal Engine — also catch "Roblox-style", "Minecraft-style" game requests (TriForge builds these in Unreal)
  { keywords: ['unreal', 'ue5', 'ue4', 'unreal engine', 'roblox', 'roblox-style', 'minecraft', 'minecraft-style', 'fortnite'], appName: 'Unreal Editor', packHint: 'pack.unreal-full-build' },
  { keywords: ['blender'],                                        appName: 'Blender',            packHint: 'pack.blender' },
  { keywords: ['photoshop'],                                      appName: 'Photoshop',          packHint: 'pack.adobe-photoshop' },
  { keywords: ['illustrator'],                                    appName: 'Illustrator',        packHint: 'pack.adobe-illustrator' },
  { keywords: ['after effects', 'aftereffects'],                  appName: 'After Effects',      packHint: 'pack.adobe-aftereffects' },
  { keywords: ['premiere'],                                       appName: 'Premiere Pro',       packHint: 'pack.adobe-premiere' },
  { keywords: ['davinci', 'resolve', 'davinci resolve'],          appName: 'DaVinci Resolve',    packHint: 'pack.davinci-resolve' },
  { keywords: ['final cut', 'final cut pro'],                     appName: 'Final Cut Pro',      packHint: 'pack.final-cut-pro' },
  { keywords: ['logic pro', 'logic'],                             appName: 'Logic Pro',          packHint: 'pack.logic-pro' },
  { keywords: ['ableton', 'ableton live'],                        appName: 'Ableton Live',       packHint: 'pack.ableton-live' },
  { keywords: ['pro tools', 'protools'],                          appName: 'Pro Tools',          packHint: 'pack.pro-tools' },
  { keywords: ['xcode'],                                          appName: 'Xcode',              packHint: 'pack.xcode' },
  { keywords: ['android studio'],                                 appName: 'Android Studio',     packHint: 'pack.android-studio' },
  { keywords: ['figma'],                                          appName: 'Figma' },
  { keywords: ['sketch'],                                         appName: 'Sketch' },
];

// Strong action verbs that signal "do this" (not "explain this")
const ACTION_VERBS = [
  'build', 'create', 'make', 'generate', 'design', 'set up', 'setup',
  'add', 'implement', 'write', 'produce', 'export', 'compile', 'render',
  'record', 'edit', 'cut', 'mix', 'publish', 'deploy', 'launch', 'run',
  'fix', 'debug', 'refactor', 'test', 'open', 'close', 'save',
  'take over', 'take control', 'control my', 'operate',
];

// Suppress if the message is clearly meta / question / explanation-seeking
const SUPPRESS_PATTERNS = [
  'how do i', 'how to', 'can you explain', 'what is', 'what are', 'why does',
  'tell me about', 'help me understand', 'what should i', 'should i',
  'is it possible', 'can triforge', 'does triforge',
];

// Override suppress when the message is clearly a command to act, not a question
const SUPPRESS_OVERRIDE = [
  'take over', 'take control', 'control my mouse', 'control my keyboard',
  'use my mouse', 'use my keyboard', 'operate my',
];

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Analyse a chat message and return the operator intent if one is detected.
 * Returns isOperatorTask=false for questions, explanations, or unclear intent.
 */
export function detectOperatorIntent(message: string): OperatorIntentResult {
  const lower = message.toLowerCase().trim();
  const noResult: OperatorIntentResult = {
    isOperatorTask: false, goal: message, targetApp: null, suggestedPackId: null, confidence: 'medium',
  };

  // Too short to be a meaningful task
  if (lower.length < 8) return noResult;

  // Suppress meta / question patterns — unless the message explicitly commands action
  const isCommandOverride = SUPPRESS_OVERRIDE.some(o => lower.includes(o));
  if (!isCommandOverride && SUPPRESS_PATTERNS.some(p => lower.startsWith(p) || lower.includes(p))) return noResult;

  // Must contain an action verb
  const hasVerb = ACTION_VERBS.some(v => lower.includes(v));
  if (!hasVerb) return noResult;

  // Detect target app
  let targetApp: string | null = null;
  let suggestedPackId: string | null = null;
  let confidence: 'high' | 'medium' = 'medium';

  for (const ap of APP_PATTERNS) {
    if (ap.keywords.some(kw => lower.includes(kw))) {
      targetApp       = ap.appName;
      suggestedPackId = ap.packHint ?? null;
      confidence      = 'high';
      break;
    }
  }

  // Without a known app, only flag if the verb is very explicit ("build me a game")
  if (!targetApp) {
    const strongVerbs = ['build', 'create', 'make', 'generate', 'produce'];
    const hasStrongVerb = strongVerbs.some(v => lower.includes(v));
    const hasAppContext  = /\bin\s+(my|the|an?)\s+\w+/i.test(message) || /\bapp\b|\bprogram\b|\bapplication\b/.test(lower);
    if (!hasStrongVerb || !hasAppContext) return noResult;
    confidence = 'medium';
  }

  // Build a clean goal string (strip leading filler)
  const goal = message
    .replace(/^(can you |could you |please |i want you to |i need you to |triforge[,\s]+)/i, '')
    .trim();

  return { isOperatorTask: true, goal, targetApp, suggestedPackId, confidence };
}
