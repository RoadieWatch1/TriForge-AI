// ── webSearchDetector.ts — Heuristic detector for queries needing live web data
//
// Returns true when a user message likely needs current/real-time information
// that the AI models cannot answer from training data alone.
//
// Design: phrase-level matching (not single-word) to reduce false positives.
// "what's the latest news" → true
// "implement the latest React patterns" → false (coding context)

// ── Phrase banks ─────────────────────────────────────────────────────────────

const TIME_SENSITIVE = [
  "today's news", 'todays news', 'top news', 'latest news', 'breaking news',
  'current news', 'recent news', 'news today', 'headlines today',
  'what happened today', 'what is happening', "what's happening",
  'trending now', 'trending today', 'right now',
  'this week in', 'this month in',
];

const DATA_QUERIES = [
  'current weather', "today's weather", 'weather in', 'weather forecast',
  'stock price', 'share price', 'market price', 'price of bitcoin',
  'price of eth', 'crypto price', 'exchange rate', 'dollar to',
  'euro to', 'yen to', 'gold price', 'oil price', 'gas price',
  'interest rate', 'inflation rate',
];

const CURRENT_EVENTS = [
  'who won the', 'who won today', 'game score', 'match score',
  'election results', 'did they win', 'is it true that',
  'latest update on', 'latest on the', 'update on the',
  'what did .* say today', 'has .* been',
];

const SEARCH_INTENT = [
  'search the web', 'search online', 'look up online',
  'google it', 'search for', 'find online', 'look online',
  'what does the internet say', 'check online',
  'can you search', 'can you look up', 'can you find out',
  'tell me the latest', 'tell me the current',
  'tell me today',
];

// ── Operator task intent — always search before acting in an app ─────────────
// When user asks TriForge to do something inside an app, search the web first
// to get current best-practice knowledge of that app's tools and workflows.

const OPERATOR_TASK_APPS = [
  'unreal', 'ue5', 'ue4', 'unreal engine',
  'blender',
  'photoshop', 'illustrator', 'after effects', 'premiere', 'adobe',
  'davinci', 'resolve', 'final cut', 'logic pro', 'ableton', 'pro tools',
  'xcode', 'android studio',
  'figma', 'sketch', 'affinity',
];

const OPERATOR_TASK_VERBS = [
  'build', 'create', 'make', 'add', 'implement in', 'set up', 'set-up',
  'configure in', 'open in', 'run in', 'export from', 'compile',
];

// ── False-positive guards ────────────────────────────────────────────────────
// If any of these appear, suppress the web search trigger —
// these indicate coding, strategy, or internal TriForge questions.

const SUPPRESS = [
  'implement', 'refactor', 'function', 'component', 'class ',
  'typescript', 'javascript', 'python', 'react', 'node',
  'git ', 'commit', 'deploy', 'code ',
  'triforge', 'council', 'forge profile', 'think tank',
  'api key', 'settings',
];
// Note: 'build the' removed from SUPPRESS — "build" alone is an operator verb

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Returns true if the message likely needs live web data to answer properly.
 */
export function needsWebSearch(message: string): boolean {
  const lower = message.toLowerCase();

  // Operator task: user wants to do something inside a known app
  // → search the web so TriForge learns current techniques before acting
  const mentionsApp  = OPERATOR_TASK_APPS.some(app => lower.includes(app));
  const mentionsVerb = OPERATOR_TASK_VERBS.some(v => lower.includes(v));
  if (mentionsApp && mentionsVerb) return true;

  // Suppress if message is clearly about coding/internal TriForge internals
  if (SUPPRESS.some(s => lower.includes(s))) return false;

  // Check phrase banks
  if (TIME_SENSITIVE.some(p => lower.includes(p))) return true;
  if (DATA_QUERIES.some(p => lower.includes(p)))   return true;
  if (SEARCH_INTENT.some(p => lower.includes(p)))  return true;

  // Regex patterns for current events (allow wildcards)
  if (CURRENT_EVENTS.some(p => {
    try { return new RegExp(p, 'i').test(lower); } catch { return lower.includes(p); }
  })) return true;

  return false;
}
