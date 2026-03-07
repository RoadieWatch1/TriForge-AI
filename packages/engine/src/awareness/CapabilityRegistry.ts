// ── awareness/CapabilityRegistry.ts — Central Triforge Capability Directory ───
//
// Single source of truth for every meaningful Triforge capability.
// Static data — no runtime dependencies. SystemStateService answers "is it live?".
// CouncilAwarenessService merges both to produce the Council context pack.
//
// To register a new subsystem: add one entry here. Council awareness is automatic.

import type { CapabilityDescriptor } from './types';

export const CAPABILITY_REGISTRY: CapabilityDescriptor[] = [

  // ── Providers ───────────────────────────────────────────────────────────────

  {
    id: 'provider.openai',
    name: 'OpenAI GPT-4o',
    category: 'provider',
    description: 'OpenAI GPT-4o — excels at coding, math, analysis, and instruction following. Also powers DALL-E 3 image generation and streaming TTS.',
    tags: ['openai', 'gpt', 'gpt-4o', 'ai', 'language model'],
    riskLevel: 'safe',
    approvalRequired: false,
    examples: ['write code', 'analyze data', 'solve a math problem'],
  },
  {
    id: 'provider.claude',
    name: 'Claude (Anthropic)',
    category: 'provider',
    description: 'Claude 3.5 Sonnet — excels at long-form reasoning, nuanced writing, strategy, and document analysis.',
    tags: ['claude', 'anthropic', 'ai', 'language model'],
    riskLevel: 'safe',
    approvalRequired: false,
    examples: ['write a report', 'strategic planning', 'analyze a long document'],
  },
  {
    id: 'provider.grok',
    name: 'Grok (xAI)',
    category: 'provider',
    description: 'Grok by xAI — contrarian thinking, real-time information awareness, and live voice agent for Siri-style conversation.',
    tags: ['grok', 'xai', 'ai', 'language model', 'live voice'],
    riskLevel: 'safe',
    approvalRequired: false,
    examples: ['challenge my assumptions', 'live voice conversation', 'play devil\'s advocate'],
  },
  {
    id: 'provider.ollama',
    name: 'Ollama (Local AI)',
    category: 'provider',
    description: '100% offline local AI via Ollama. No API key needed. Complete privacy — nothing leaves the device.',
    tags: ['ollama', 'local', 'offline', 'private', 'ai'],
    riskLevel: 'safe',
    approvalRequired: false,
    examples: ['offline AI', 'private local model', 'no internet required'],
  },

  // ── Council ─────────────────────────────────────────────────────────────────

  {
    id: 'council.consensus',
    name: 'Council Consensus (Think Tank)',
    category: 'council',
    description: 'Three AI models (GPT-4o, Claude, Grok) deliberate in parallel and synthesize the strongest answer. Requires 2+ provider keys and Pro tier.',
    tags: ['council', 'consensus', 'think tank', 'multi-model', 'debate'],
    riskLevel: 'safe',
    approvalRequired: false,
    requiresTier: 'pro',
    invocationHint: 'Activated automatically when mode is set to Consensus and 2+ providers are configured.',
    examples: ['get multiple perspectives', 'hard decision', 'debate the options', 'council opinion'],
  },
  {
    id: 'council.deliberate',
    name: 'Council Deliberation Mode',
    category: 'council',
    description: 'Three-phase debate: each AI states its position, cross-reacts to the others, then delivers a full informed response. Slower but deeper.',
    tags: ['deliberate', 'debate', 'cross-reaction', 'council'],
    riskLevel: 'safe',
    approvalRequired: false,
    requiresTier: 'pro',
    invocationHint: 'Toggle the Deliberation switch in the chat toolbar.',
    examples: ['deep deliberation', 'complex tradeoff analysis', 'contested topic'],
  },

  // ── Image Generation ────────────────────────────────────────────────────────

  {
    id: 'image.generate',
    name: 'Image Generator (DALL-E 3 / Grok)',
    category: 'image',
    description: 'Generates 1024×1024 images from text prompts using DALL-E 3 (OpenAI key) or Grok Vision. Includes AI-powered prompt refinement and quality critique pipeline.',
    tags: ['image', 'generate', 'dall-e', 'visual', 'art', 'design', 'picture', 'photo', 'poster', 'logo'],
    riskLevel: 'safe',
    approvalRequired: false,
    requiresTier: 'pro',
    invocationHint: 'Tell the user to open the Studio tab, or describe what to generate and ask them to open Studio.',
    examples: ['generate an image', 'create a poster', 'make a product photo', 'design a logo', 'draw a scene', 'create artwork'],
  },

  // ── Voice ────────────────────────────────────────────────────────────────────

  {
    id: 'voice.tts',
    name: 'Spoken AI Responses (TTS)',
    category: 'voice',
    description: 'Council responses are spoken aloud. Uses OpenAI streaming TTS (Pro + OpenAI key) with Web Speech API as universal fallback.',
    tags: ['voice', 'tts', 'speech', 'audio', 'speak', 'spoken', 'read aloud'],
    riskLevel: 'safe',
    approvalRequired: false,
    invocationHint: 'Toggle "Voice: On" in the chat toolbar. Always available as fallback via system voices.',
    examples: ['speak the answer', 'read it to me', 'voice mode', 'talk to me'],
  },
  {
    id: 'voice.wake',
    name: 'Wake Word — Hey Council',
    category: 'voice',
    description: 'Offline wake-word detection. Say "Hey Council" at any time to jump directly into hands-free chat mode without touching the keyboard. Zero network dependency.',
    tags: ['wake', 'hey council', 'hands-free', 'voice trigger', 'offline wake word'],
    riskLevel: 'safe',
    approvalRequired: false,
    invocationHint: 'Always active in the background once the app is running. Say "Hey Council" to trigger.',
    examples: ['hey council', 'okay council', 'council listen', 'hands-free mode'],
  },
  {
    id: 'voice.chat',
    name: 'Live Voice Chat',
    category: 'voice',
    description: 'Real-time Siri-style voice conversation with Council. Uses Grok live voice agent (Grok key) for full audio-in/audio-out, or Web Speech API fallback.',
    tags: ['live voice', 'voice chat', 'real-time', 'conversation', 'siri', 'microphone'],
    riskLevel: 'safe',
    approvalRequired: false,
    invocationHint: 'Click the mic "Voice Chat" button in the chat toolbar.',
    examples: ['live voice', 'talk to council', 'voice conversation', 'speak to me'],
  },

  // ── Missions ─────────────────────────────────────────────────────────────────

  {
    id: 'mission.engineering',
    name: 'Engineering Mission Controller',
    category: 'mission',
    description: 'End-to-end engineering missions: AI plans the work → user approves each step → Council executes → verifies result. Per-step approval is mandatory — no batch execution.',
    tags: ['mission', 'engineering', 'execute', 'build', 'implement', 'automate', 'project'],
    riskLevel: 'moderate',
    approvalRequired: true,
    invocationHint: 'Triggered when user says "run a mission", "build X", or navigates to Mission Control.',
    examples: ['run a mission', 'build this feature', 'implement a system', 'create an app', 'develop X'],
  },
  {
    id: 'mission.context',
    name: 'Mission Context Tracking',
    category: 'mission',
    description: 'Tracks active project context (objective, risk level, progress) across conversation turns. Council stays coherent throughout a long-running project.',
    tags: ['mission', 'context', 'project', 'tracking', 'continuity'],
    riskLevel: 'safe',
    approvalRequired: false,
    examples: ['remember my project', 'what are we building', 'project status'],
  },

  // ── Autonomy ─────────────────────────────────────────────────────────────────

  {
    id: 'autonomy.loop',
    name: 'Autonomy Loop (Passive Workspace Observer)',
    category: 'autonomy',
    description: 'Passively watches the workspace for issues (dead code, TODO clusters, large files, anti-patterns). Never writes files. Emits proposals that require explicit user approval.',
    tags: ['autonomy', 'observer', 'passive', 'workspace', 'analysis', 'monitor'],
    riskLevel: 'moderate',
    approvalRequired: true,
    invocationHint: 'Enabled/disabled in Settings → Autonomy. Disabled by default.',
    examples: ['watch my code', 'passive analysis', 'flag issues automatically', 'background monitoring'],
  },
  {
    id: 'autonomy.workflows',
    name: 'Autonomy Workflows',
    category: 'autonomy',
    description: 'Custom automation workflows triggered by events (schedule, file change, sensor data). All actions are gated by the approval store before execution.',
    tags: ['workflow', 'automation', 'trigger', 'schedule', 'event-driven'],
    riskLevel: 'high',
    approvalRequired: true,
    requiresTier: 'business',
    examples: ['automate X when Y happens', 'run on schedule', 'workflow trigger', 'event automation'],
  },

  // ── Files & System ───────────────────────────────────────────────────────────

  {
    id: 'files.organize',
    name: 'File Organizer',
    category: 'files',
    description: 'Organizes Desktop, Downloads, Documents, or any custom folder. Supports deep recursive organization. Requires Files permission.',
    tags: ['files', 'organize', 'desktop', 'downloads', 'documents', 'clean up', 'sort'],
    riskLevel: 'moderate',
    approvalRequired: false,
    invocationHint: 'Append [RUN:organize_desktop], [RUN:organize_downloads], [RUN:organize_documents], or [RUN:organize] for a custom folder.',
    examples: ['organize my downloads', 'clean up desktop', 'sort my files', 'organize documents'],
  },
  {
    id: 'files.search',
    name: 'Document Finder (Local OCR Search)',
    category: 'files',
    description: 'Indexes all PDFs and images using local OCR then searches by content. 100% offline — no files leave the device.',
    tags: ['files', 'search', 'ocr', 'document', 'find', 'pdf', 'scan'],
    riskLevel: 'safe',
    approvalRequired: false,
    invocationHint: 'Use [RUN:index_docs] to index first, then [RUN:search_docs:<query>] to find documents.',
    examples: ['find my passport', 'where is my EIN', 'find my insurance card', 'search my documents'],
  },
  {
    id: 'files.browser',
    name: 'Browser Automation',
    category: 'files',
    description: 'Controls a web browser to navigate, fill forms, scrape content, and take screenshots. Requires Browser permission and Pro tier.',
    tags: ['browser', 'web', 'automation', 'scrape', 'navigate', 'screenshot', 'form'],
    riskLevel: 'moderate',
    approvalRequired: false,
    requiresTier: 'pro',
    examples: ['open this URL', 'fill out this form', 'scrape this page', 'take a screenshot'],
  },
  {
    id: 'files.print',
    name: 'Printer',
    category: 'files',
    description: 'Lists available printers and prints files or text on behalf of the user. Requires Printer permission.',
    tags: ['print', 'printer', 'document', 'paper'],
    riskLevel: 'safe',
    approvalRequired: false,
    invocationHint: 'Append [RUN:print] to trigger the print dialog.',
    examples: ['print this', 'print the document', 'print this page'],
  },
  {
    id: 'files.email',
    name: 'Email (Read & Send)',
    category: 'files',
    description: 'Reads inbox and sends emails on the user\'s behalf. Requires Email permission and Pro tier.',
    tags: ['email', 'mail', 'inbox', 'send', 'draft', 'reply'],
    riskLevel: 'moderate',
    approvalRequired: false,
    requiresTier: 'pro',
    examples: ['send an email', 'check my inbox', 'draft a reply', 'compose an email'],
  },

  // ── Phone Link ───────────────────────────────────────────────────────────────

  {
    id: 'phone.link',
    name: 'Phone Link',
    category: 'phone',
    description: 'Pairs with the user\'s phone to receive mobile notifications, view mobile context, and push Council responses to the phone.',
    tags: ['phone', 'mobile', 'pair', 'link', 'connect', 'device'],
    riskLevel: 'safe',
    approvalRequired: false,
    invocationHint: 'Navigate to the Phone Link screen in the sidebar to generate a pairing token.',
    examples: ['pair my phone', 'phone link', 'connect my mobile', 'set up phone'],
  },

  // ── Memory ───────────────────────────────────────────────────────────────────

  {
    id: 'memory.user',
    name: 'User Memory',
    category: 'memory',
    description: 'Stores facts, goals, preferences, and business context about the user. Retrieved and injected into every Council turn for personalized responses.',
    tags: ['memory', 'facts', 'goals', 'preferences', 'remember', 'context'],
    riskLevel: 'safe',
    approvalRequired: false,
    examples: ['remember that I...', 'my goal is...', 'always prefer...', 'add this to memory'],
  },
  {
    id: 'memory.council',
    name: 'Council Memory Graph',
    category: 'memory',
    description: 'Persistent engineering memory across sessions: bugfixes, architecture decisions, and experiment results. Council learns from its own history.',
    tags: ['memory', 'engineering', 'architecture', 'history', 'decisions', 'graph'],
    riskLevel: 'safe',
    approvalRequired: false,
    examples: ['what did we decide about...', 'recall the architecture for...', 'what bugs did we fix'],
  },

  // ── Forge Profiles ──────────────────────────────────────────────────────────

  {
    id: 'forge.profiles',
    name: 'Forge Profiles (Strategist / Operator / Executor)',
    category: 'forge',
    description: 'Pre-built Council personas with tailored system context, tone, and mission orientation. Strategist = visionary long-range planning. Operator = execution focus. Executor = tactical delivery.',
    tags: ['forge', 'profile', 'persona', 'strategist', 'operator', 'executor', 'mode'],
    riskLevel: 'safe',
    approvalRequired: false,
    requiresTier: 'pro',
    invocationHint: 'Navigate to Forge Profiles in the sidebar.',
    examples: ['activate strategist mode', 'switch to operator', 'use executor profile', 'forge profile'],
  },
  {
    id: 'forge.blueprint',
    name: 'Forge Blueprint Generator',
    category: 'forge',
    description: 'Generates a structured operational blueprint for any objective using tri-model debate (same pattern as Council consensus). Saved to Decision Ledger.',
    tags: ['forge', 'blueprint', 'plan', 'generate', 'strategy', 'operational'],
    riskLevel: 'safe',
    approvalRequired: false,
    requiresTier: 'pro',
    examples: ['generate a blueprint', 'create an operational plan', 'forge blueprint for X'],
  },

  // ── Tasks & Scheduling ───────────────────────────────────────────────────────

  {
    id: 'tasks.schedule',
    name: 'Task Scheduler',
    category: 'tasks',
    description: 'Schedules tasks to run at specific times or intervals. Integrates with the agent loop for autonomous execution.',
    tags: ['tasks', 'schedule', 'cron', 'timer', 'recurring', 'interval'],
    riskLevel: 'moderate',
    approvalRequired: true,
    examples: ['run this every day', 'schedule a task', 'every Monday at 9am do X'],
  },
  {
    id: 'tasks.approval',
    name: 'Approval Workflow',
    category: 'tasks',
    description: 'Gates any high-risk action behind explicit user approval. All agent and autonomy actions route through the approval store before execution.',
    tags: ['approval', 'gate', 'review', 'authorize', 'confirm'],
    riskLevel: 'safe',
    approvalRequired: false,
    examples: ['review pending approvals', 'what needs approval', 'approve the action'],
  },
  {
    id: 'tasks.agent',
    name: 'Agent Loop (Autonomous Execution)',
    category: 'tasks',
    description: 'Executes multi-step plans autonomously using tools (file ops, shell, web). Always gated by the approval store. High-risk actions require explicit confirmation.',
    tags: ['agent', 'autonomous', 'execute', 'loop', 'automate'],
    riskLevel: 'high',
    approvalRequired: true,
    requiresTier: 'business',
    examples: ['run autonomously', 'execute the plan end-to-end', 'agent mode'],
  },

  // ── Insight ──────────────────────────────────────────────────────────────────

  {
    id: 'insight.proactive',
    name: 'Proactive Council Suggestions',
    category: 'insight',
    description: 'Council monitors ongoing conversations and proactively surfaces non-obvious suggestions, risks, or opportunities. Fires at most once every 20 minutes.',
    tags: ['insight', 'proactive', 'suggestion', 'opportunity', 'risk', 'flag'],
    riskLevel: 'safe',
    approvalRequired: false,
    examples: ['what am I missing', 'any risks', 'proactive insight'],
  },
  {
    id: 'insight.event',
    name: 'Event Intelligence',
    category: 'insight',
    description: 'Observes the engine event bus and generates high-level insights about system patterns, anomalies, and health signals.',
    tags: ['insight', 'events', 'intelligence', 'observability', 'patterns'],
    riskLevel: 'safe',
    approvalRequired: false,
    examples: ['system health', 'what events are happening', 'event analysis'],
  },

  // ── Workspace Audit ──────────────────────────────────────────────────────────

  {
    id: 'files.auditFolder',
    name: 'Folder / Workspace Audit',
    category: 'files',
    description: 'Scans a local folder or codebase and produces a structured audit report: project type, tech stack, TODO clusters, large files, missing tests/docs, config risks, and recommended next steps. User selects the folder via a native picker or provides a path. Requires Files permission.',
    tags: ['audit', 'folder', 'workspace', 'codebase', 'repo', 'inspect', 'review', 'analyze', 'scan', 'issues', 'code quality'],
    riskLevel: 'safe',
    approvalRequired: false,
    invocationHint: 'Say "audit this folder", "analyze this project", or "scan this codebase". A folder picker opens if no path is given.',
    examples: [
      'audit this folder', 'analyze this codebase', 'review my project folder',
      'scan this repo for issues', 'what\'s wrong with this project',
      'check this folder', 'inspect this codebase',
    ],
  },

  // ── Social ───────────────────────────────────────────────────────────────────

  {
    id: 'social.twitter',
    name: 'Twitter / X Posting',
    category: 'social',
    description: 'Composes and posts tweets on the user\'s behalf. Requires Twitter credentials in Settings.',
    tags: ['twitter', 'x', 'social', 'post', 'tweet', 'publish'],
    riskLevel: 'moderate',
    approvalRequired: false,
    examples: ['post this to Twitter', 'draft a tweet', 'share on X', 'tweet this'],
  },
];

// ── Lookup helpers ────────────────────────────────────────────────────────────

export function getCapabilityById(id: string): CapabilityDescriptor | undefined {
  return CAPABILITY_REGISTRY.find(c => c.id === id);
}

export function getCapabilitiesByCategory(
  category: CapabilityDescriptor['category'],
): CapabilityDescriptor[] {
  return CAPABILITY_REGISTRY.filter(c => c.category === category);
}

/**
 * Find capabilities whose tags or name match any word in the query.
 * Used by the intent router for capability-discovery responses.
 */
export function searchCapabilities(query: string): CapabilityDescriptor[] {
  const lower = query.toLowerCase();
  return CAPABILITY_REGISTRY.filter(c =>
    c.tags.some(t => lower.includes(t)) ||
    lower.includes(c.name.toLowerCase()) ||
    c.examples?.some(e => lower.includes(e.split(' ')[0] ?? '')),
  );
}
