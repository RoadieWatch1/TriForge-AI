// ── CouncilRouter.ts ──────────────────────────────────────────────────────────
//
// Intent-based dynamic provider selection for the council.
//
// Two layers of intent detection:
//
//   1. Triforge-native intents (checked first, highest priority)
//      Detect requests for specific Triforge capabilities so Council can
//      respond from the live awareness pack rather than from model memory.
//      Examples: image_request, mission_request, capability_discovery.
//
//   2. Generic reasoning intents (checked if no native intent matches)
//      Shape which provider leads each council seat for best results.
//      Examples: coding, strategy, research, creative.
//
// Integration: call routeCouncil(message, pm) before CouncilConversationEngine.
// It sets the preferred provider order on the ProviderManager via
// setPreferredProviders(), which getActiveProviders() respects.

import type { ProviderManager } from '../core/providerManager';
import type { ProviderName }     from '../protocol';

export type IntentType =
  | 'coding'
  | 'strategy'
  | 'research'
  | 'creative'
  // ── Triforge-native intents (resolved before generic buckets) ────────────
  | 'capability_discovery'  // "what can you do", "what tools do you have"
  | 'system_status'         // "is X available", "what's configured"
  | 'image_request'         // "generate an image", "create a picture"
  | 'mission_request'       // "run a mission", "build X for me"
  | 'voice_request'         // "use voice mode", "speak to me"
  | 'phone_request'         // "pair my phone", "phone link"
  | 'task_request'          // "check my tasks", "pending approvals"
  | 'desktop_control'       // "open desktop", "bring triforge forward"
  | 'operator_action'       // "type in app", "take a screenshot", "run workflow pack"
  | 'folder_audit'          // "audit this folder", "analyze this codebase"
  | 'vibe_request'          // "make this feel premium", "vibe check"
  | 'default';

// ── Triforge-native keyword banks (exact phrase or substring match) ───────────

const CAPABILITY_DISCOVERY_KW = [
  'what can you do', 'what tools', 'what features', 'list your capabilities',
  'what systems', 'what do you have', 'what are your abilities',
  'what can triforge', 'capabilities', 'what powers do you',
  'show me what you can', 'what is available', 'what can i use',
];

const SYSTEM_STATUS_KW = [
  'is image generation', 'is voice', 'is autonomy', 'is phone',
  'are you configured', 'what is configured', 'what\'s configured',
  'what is set up', 'what\'s set up', 'system status', 'is X available',
  'do you have image', 'do you have voice', 'do you have grok',
  'is openai configured', 'is claude configured',
  'what providers', 'which providers', 'what api keys',
  'which systems are active', 'what is running', 'what\'s running',
];

const IMAGE_REQUEST_KW = [
  'generate an image', 'generate image', 'create an image', 'create image',
  'make an image', 'make image', 'draw', 'illustrate', 'dall-e', 'dalle',
  'generate a picture', 'create a picture', 'make a picture',
  'generate a photo', 'create a photo', 'visual for', 'design a logo',
  'create a poster', 'make a poster', 'generate artwork', 'image of',
];

const MISSION_REQUEST_KW = [
  'run a mission', 'start a mission', 'launch a mission',
  'engineering mission', 'run this mission', 'start mission',
  'build this for me', 'implement this for me', 'execute this plan',
  'mission control', 'open mission', 'create a mission',
];

const VOICE_REQUEST_KW = [
  'use voice mode', 'voice mode', 'speak to me', 'talk to me',
  'activate voice', 'enable voice', 'voice chat', 'live voice',
  'hey council', 'hands-free', 'voice conversation',
  'use the microphone', 'start listening',
];

const PHONE_REQUEST_KW = [
  'pair my phone', 'phone link', 'connect my phone', 'phone pairing',
  'mobile pairing', 'pair device', 'connect mobile',
  'set up phone', 'link my phone',
];

const TASK_REQUEST_KW = [
  'check my tasks', 'what tasks', 'pending tasks', 'pending approvals',
  'task status', 'task queue', 'what\'s pending', 'what is pending',
  'show tasks', 'list tasks', 'my tasks', 'approve', 'approval queue',
  'create a task', 'add a task', 'make a task', 'schedule a task',
  'remind me to', 'remind me tomorrow',
];

const DESKTOP_CONTROL_KW = [
  'open desktop', 'open up desktop', 'bring triforge', 'show triforge',
  'focus triforge', 'open triforge', 'bring window', 'show window',
  'switch to desktop', 'desktop mode', 'open the app', 'bring the app',
  'triforge forward', 'show the app',
];

// Operator-action intent: supervised desktop actions via the operator substrate
const OPERATOR_ACTION_KW = [
  // Input
  'type into', 'type in the', 'type for me', 'press enter', 'press escape',
  'send keystroke', 'send key', 'keyboard shortcut',
  // Perception
  'take a screenshot', 'capture the screen', 'screenshot my desktop',
  'what\'s on my screen', 'what is on my screen', 'capture screen',
  // App control via operator
  'focus the app', 'focus app', 'switch to the app',
  'run a workflow', 'run workflow pack', 'start workflow',
  'supervised input', 'operator action', 'workflow pack',
  // Desktop automation language
  'automate on my desktop', 'perform on my desktop',
  'do it on my computer', 'do it on my mac',
];

const FOLDER_AUDIT_KW = [
  'audit this folder', 'audit folder', 'audit the folder', 'audit my folder',
  'audit this project', 'audit my project', 'audit this repo', 'audit the repo',
  'audit this codebase', 'audit the codebase', 'audit codebase',
  'analyze this folder', 'analyze this project', 'analyze this codebase',
  'analyze this workspace', 'analyze workspace',
  'inspect this folder', 'inspect this project', 'inspect the folder',
  'review this folder', 'review this project', 'review this codebase',
  'review project folder', 'review my project',
  'scan this folder', 'scan this project', 'scan this directory',
  'scan folder', 'scan the folder',
  'what\'s wrong with this folder', 'what\'s wrong with this project',
  'check this folder', 'check this repo', 'check this project',
  'check for issues', 'find issues in', 'what issues are in',
];

const VIBE_REQUEST_KW = [
  'vibe', 'make this feel', 'make it feel', 'give it a', 'look and feel',
  'premium feel', 'boardroom', 'visual identity', 'brand feel',
  'vibe check', 'rescue this design', 'audit the vibe', 'refine the look',
  'explore directions', 'design direction', 'product personality',
  'more polished', 'more premium', 'more trustworthy', 'more cinematic',
  'more professional', 'more corporate', 'more playful', 'more minimal',
  'more bold', 'more confident', 'more stealthy', 'business mood',
];

// ── Generic keyword banks ─────────────────────────────────────────────────────

const CODING_KW: string[] = [
  'code', 'function', 'bug', 'debug', 'implement', 'script', 'api',
  'database', 'typescript', 'javascript', 'python', 'class', 'component',
  'hook', 'query', 'refactor', 'test', 'endpoint', 'backend', 'frontend',
];

const STRATEGY_KW: string[] = [
  'strategy', 'plan', 'roadmap', 'business', 'launch', 'market', 'compete',
  'growth', 'pricing', 'revenue', 'startup', 'investor', 'acquisition',
  'monetize', 'scale', 'expansion', 'partnership',
];

const RESEARCH_KW: string[] = [
  'research', 'analyze', 'compare', 'study', 'explain', 'what is',
  'how does', 'why does', 'report', 'survey', 'overview', 'summarize',
  'difference between', 'pros and cons',
];

const CREATIVE_KW: string[] = [
  'write', 'create', 'design', 'brainstorm', 'idea', 'story', 'content',
  'copy', 'draft', 'blog', 'headline', 'tagline', 'pitch', 'narrative',
];

// ── Intent detection ──────────────────────────────────────────────────────────

/** Returns true if any phrase in the bank is a substring of the message. */
function matchesAny(message: string, phrases: string[]): boolean {
  return phrases.some(p => message.includes(p));
}

/** Score a message against a keyword bank (count of matching keywords). */
function score(message: string, keywords: string[]): number {
  return keywords.filter(k => message.includes(k)).length;
}

/**
 * Detect the dominant intent type from a user message.
 *
 * Triforge-native intents are tested first (higher specificity).
 * Falls back to generic reasoning intents when no native intent matches.
 * Returns 'default' when nothing wins clearly.
 */
export function detectIntentType(message: string): IntentType {
  const lower = message.toLowerCase();

  // ── Priority 1: Triforge-native intents ────────────────────────────────────
  if (matchesAny(lower, CAPABILITY_DISCOVERY_KW)) return 'capability_discovery';
  if (matchesAny(lower, SYSTEM_STATUS_KW))        return 'system_status';
  if (matchesAny(lower, IMAGE_REQUEST_KW))         return 'image_request';
  if (matchesAny(lower, MISSION_REQUEST_KW))       return 'mission_request';
  if (matchesAny(lower, VOICE_REQUEST_KW))         return 'voice_request';
  if (matchesAny(lower, PHONE_REQUEST_KW))         return 'phone_request';
  if (matchesAny(lower, TASK_REQUEST_KW))          return 'task_request';
  if (matchesAny(lower, DESKTOP_CONTROL_KW))        return 'desktop_control';
  if (matchesAny(lower, OPERATOR_ACTION_KW))        return 'operator_action';
  if (matchesAny(lower, VIBE_REQUEST_KW))           return 'vibe_request';
  if (matchesAny(lower, FOLDER_AUDIT_KW))           return 'folder_audit';

  // ── Priority 2: Generic reasoning intents ──────────────────────────────────
  const scores: [IntentType, number][] = [
    ['coding',   score(lower, CODING_KW)],
    ['strategy', score(lower, STRATEGY_KW)],
    ['research', score(lower, RESEARCH_KW)],
    ['creative', score(lower, CREATIVE_KW)],
  ];

  const winning = scores
    .filter(([, s]) => s > 0)
    .sort(([, a], [, b]) => b - a);

  return winning[0]?.[0] ?? 'default';
}

// ── Provider selection ────────────────────────────────────────────────────────

/**
 * Select the optimal council provider order for a given intent type.
 *
 * The UI still shows exactly three seats — the order determines which
 * provider anchors which seat role for this request.
 */
export function selectCouncil(intent: IntentType): ProviderName[] {
  switch (intent) {
    // Native intents: Claude leads (strongest at nuanced, capability-aware responses)
    case 'capability_discovery':
    case 'system_status':        return ['claude', 'openai', 'grok'];
    // Image: GPT-4o leads (knows DALL-E capabilities best)
    case 'image_request':        return ['openai', 'claude', 'grok'];
    // Mission / tasks: Claude leads (best at structured planning)
    case 'mission_request':
    case 'task_request':         return ['claude', 'openai', 'grok'];
    // Voice / phone / desktop: balanced — navigation/system responses
    case 'voice_request':
    case 'phone_request':
    case 'desktop_control':      return ['claude', 'openai', 'grok'];
    // Operator actions: Claude leads (best at capability-aware, approval-first reasoning)
    case 'operator_action':      return ['claude', 'openai', 'grok'];
    // Folder audit: Claude leads (best at structured code analysis and report writing)
    case 'folder_audit':         return ['claude', 'openai', 'grok'];
    // Generic reasoning intents
    case 'coding':               return ['openai', 'claude', 'grok'];
    case 'strategy':             return ['claude', 'grok', 'openai'];
    case 'research':             return ['claude', 'openai', 'grok'];
    case 'creative':             return ['claude', 'grok', 'openai'];
    default:                     return ['claude', 'openai', 'grok'];
  }
}

// ── One-call integration helper ───────────────────────────────────────────────

/**
 * Detect intent from the message and apply the resulting provider order to
 * the ProviderManager. Call once before CouncilConversationEngine.handleMessage().
 *
 * @returns The detected intent type (useful for logging / telemetry).
 */
export function routeCouncil(message: string, pm: ProviderManager): IntentType {
  const intent = detectIntentType(message);
  pm.setPreferredProviders(selectCouncil(intent));
  return intent;
}
