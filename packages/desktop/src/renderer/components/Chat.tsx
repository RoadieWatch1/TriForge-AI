import React, { useState, useRef, useEffect, useCallback } from 'react';
import { VoiceButton } from './VoiceButton';
import { VoiceConversation } from './VoiceConversation';
import { HandsFreeVoice } from './HandsFreeVoice';
import { UpgradeGate } from './UpgradeGate';
import { ExecutionPlanView, type ExecutionPlan } from './ExecutionPlanView';
import { ForgeChamber } from './ForgeChamber';
import { CouncilChamber } from './forge/CouncilChamber';
import { loadLastMission, type LastMissionSummary } from '../forge/ForgeContextStore';
import { voiceService } from '../voice/VoiceService';
import { onCouncilCommand, dispatchCommand } from '../command/CommandDispatcher';
import { councilPresence } from '../state/CouncilPresence';
import { playConsensusTone, playListeningTone } from '../audio/councilSounds';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ConsensusResponse { provider: string; text: string; }

interface ForgeScore {
  confidence: number;
  agreement: string;
  disagreement: string;
  risk: 'Low' | 'Medium' | 'High';
  assumptions: string;
  verify: string;
  initialConfidence?: number;
  intensity?: string;
  escalatedFrom?: string;
}

type PhotoFile = { name: string; path: string; size: number; modified: string; extension: string };

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;           // For consensus: the synthesis text
  provider?: string;
  timestamp: Date;
  isError?: boolean;
  // Think-tank consensus fields
  consensusResponses?: ConsensusResponse[];
  forgeScore?: ForgeScore;
  failedProviders?: { provider: string; error: string }[];
  workflow?: string;
  // Photo result payloads
  photos?: PhotoFile[];
  photoLabel?: string;
  // Streaming state — true while tokens are still arriving
  streaming?: boolean;
  // Task mode fields
  executionPlan?: ExecutionPlan;
  taskPhase?: 'decomposing' | 'planning' | 'ready' | 'error';
  // Debate intensity that produced this consensus response
  debateIntensity?: string;
  // Document finder results
  docResults?: DocResult[];
  docQuery?: string;
}

interface DocEntry {
  path: string;
  name: string;
  size: number;
  modified: string;
  extension: string;
  ocrText: string;
  docTypes: Array<{ type: string; confidence: number }>;
  indexedAt: string;
}
interface DocResult extends DocEntry { matchScore: number; }

interface Props {
  mode: string;
  keyStatus: Record<string, boolean>;
  tier: string;
  messagesThisMonth: number;
  onMessageSent: () => void;
  onUpgradeClick: () => void;
  onBuildApp: () => void;
  activeProfileId?: string | null;
  onProfileSwitch?: () => void;
  onProfileDeactivate?: () => void;
  /** When set, pre-fills the chat input field once then clears. */
  prefill?: string | null;
  onClearPrefill?: () => void;
  /** Navigate to the Command screen (◉) — used for strategic escalation suggestion. */
  onNavigateToCommand?: () => void;
  /** Navigate to the Files screen (⊡) — used when a binary file is attached. */
  onNavigateToFiles?: () => void;
  /** Controlled voice-output mode — set by parent (Settings screen). */
  voiceMode?: boolean;
  onVoiceModeChange?: (on: boolean) => void;
}

// ── Constants ─────────────────────────────────────────────────────────────────

const PROVIDER_COLORS: Record<string, string> = {
  openai: '#10a37f',
  claude: '#d97706',
  grok:   '#6366f1',
};

const PROVIDER_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  claude: 'Claude',
  grok:   'Grok',
};

const INTENSITY_COLORS: Record<string, string> = {
  cooperative: '#10a37f',
  analytical:  '#f59e0b',
  critical:    '#f97316',
  combative:   '#ef4444',
  ruthless:    '#7c3aed',
};

const INTENSITY_LABELS: Record<string, string> = {
  cooperative: 'Cooperative',
  analytical:  'Analytical',
  critical:    'Critical',
  combative:   'Combative',
  ruthless:    'Ruthless',
};

const COUNCIL_ROLE_LABELS = ['Strategist', 'Critic', 'Executor'];

function detectIntensity(message: string): string {
  const m = message.toLowerCase();
  if (/security|auth|exploit|vulnerabilit|injection|breach|crypto|zero.?day/.test(m)) return 'critical';
  if (/production|deploy|infrastructure|migration|breaking.change|delete all|rm -|drop table/.test(m)) return 'combative';
  if (/refactor|architect|restructure|optim|performance|scale/.test(m)) return 'analytical';
  if (/brainstorm|idea|explore|what if|imagine|could we|suggestion/.test(m)) return 'cooperative';
  return 'analytical';
}

const QUICK_ACTIONS = [
  { label: 'Find a Document',      action: 'docs' as const },
  { label: 'Organize Folder',      action: 'organize' as const },
  { label: 'Print Document',       action: 'print' as const },
  { label: 'Generate Application', action: 'builder' as const },
  { label: 'Investment Analysis',  action: 'investment' as const },
  { label: 'Raise Funding',        action: 'funding' as const },
];

const INVESTMENT_PROMPT = `Create a comprehensive investment guide for a small business owner with excess cash. Include:
## Cash vs. Reinvestment Decision Framework (when to save vs. invest in the business vs. the market)
## Market Investment Options Ranked by Risk (index funds, ETFs, bonds, REITs — pros/cons for each)
## Tax-Advantaged Business Accounts (SEP-IRA, Solo 401k, HSA — eligibility, contribution limits, tax benefits)
## Real Estate as a Business Asset (buy vs. lease analysis, pros/cons for small business owners)
## Recommended Allocation by Business Stage (startup / growing / established — specific percentage targets)
## Red Flags and Common Mistakes (what most founders get wrong with excess cash)
Format with clear headers, specific dollar figures and percentages where helpful, and actionable steps. Assume the owner is a U.S. sole proprietor or LLC with $10,000–$500,000 to deploy.`;

const FUNDING_PROMPT = `Create a complete fundraising guide for a startup seeking outside investment. Include:
## Funding Stage Assessment (pre-seed, seed, Series A — which stage applies and why)
## Investor Types Compared (angels, VCs, accelerators, crowdfunding, grants — best fit for each stage)
## What Investors Actually Look For (the 5 criteria every investor evaluates — with specific examples)
## Pitch Deck Structure (10 slides, what goes on each, the most common mistakes per slide)
## Key Terms Decoded (valuation, dilution, SAFE note, convertible note, pro-rata rights — plain English)
## Finding and Approaching Investors (where to find them, how to get warm intros, follow-up cadence)
## Alternatives to Equity Funding (revenue-based financing, SBA loans, SBIR grants, bootstrapping)
Format as an actionable founder guide with concrete next steps and real-world benchmarks.`;

const MSG_LIMITS: Record<string, number> = { free: 30, pro: 300, business: Infinity };

const MODE_LABELS: Record<string, string> = {
  none:      'No providers',
  single:    'Single AI',
  pair:      'Pair mode — 2 AIs',
  consensus: 'Think Tank — 3 AIs',
};

const HISTORY_KEY = 'triforge-chat-v2';

const WORKFLOWS = [
  { id: 'startup',    label: 'Start a Business',       desc: 'LLC steps, EIN, checklist, 30-day launch plan' },
  { id: 'hiring',     label: 'Hire Someone',            desc: 'Job post, interview questions, offer letter, onboarding' },
  { id: 'marketing',  label: 'Marketing Campaign',      desc: 'Strategy, copy, content calendar, budget split' },
  { id: 'sop',        label: 'Write a Policy / SOP',    desc: 'Operational procedure for any business process' },
  { id: 'client',     label: 'Client Follow-up System', desc: '5-email sequence, CRM notes, re-engagement message' },
];

const WORKFLOW_PROMPTS: Record<string, string> = {
  startup: `Create a complete business launch guide with these sections:
## Legal Setup Checklist (numbered: choose structure, register, get EIN, open bank account, licenses)
## Essential Tools & Accounts (accounting, website, email — free options first for each)
## First 30 Days Action Plan (week-by-week: week 1 legal, week 2 brand, week 3 marketing, week 4 first sale)
## Key Documents to Create (brief description of each: operating agreement, invoice template, contract)
## Common Mistakes to Avoid (top 5 with why each matters)
Format with clear headers, numbered steps, and checkboxes where applicable. Be specific and actionable.`,

  hiring: `Create a complete hiring package with these sections:
## Job Description Template (role summary, responsibilities, requirements, compensation guidance)
## 10 Interview Questions (with what to listen for in each answer)
## Offer Letter Template (professional and legally safe language, fill-in-the-blank format)
## Week 1 Onboarding Checklist (day-by-day: accounts, introductions, training, first assignment)
## Red Flags to Watch For (behaviors in interviews and first weeks that signal poor fit)
Format with clear headers, numbered lists, and ready-to-use templates.`,

  marketing: `Create a complete marketing campaign plan with these sections:
## Target Audience Profile (demographics, pain points, goals, where they spend time online)
## Channel Strategy (3 channels with why each, content type, posting frequency)
## 30-Day Content Calendar (4 weeks of content themes, post ideas, and formats)
## Copy Templates (social media post, email subject + preview text, ad headline — 3 variations each)
## Budget Split Guide (percentage allocation across channels with rationale)
## KPIs to Track (5 metrics, how to measure, what numbers to aim for)
Format with tables where useful, ready-to-use copy, and specific numbers.`,

  sop: `Write a complete Standard Operating Procedure (SOP) document with these sections:
## Purpose & Scope (what this procedure covers and who it applies to)
## Roles & Responsibilities (who does what at each step)
## Step-by-Step Process (numbered steps with decision points clearly marked)
## Tools & Resources Required (software, templates, access needed)
## Quality Checkpoints (how to verify each major step was done correctly)
## What Can Go Wrong & How to Handle It (top 5 failure points with solutions)
## Review Schedule (when and how to update this SOP)
Format as a professional operational document with clear, unambiguous language.`,

  client: `Build a complete client follow-up system with these sections:
## 5-Email Follow-up Sequence (subject line + full email body for: initial contact, follow-up 1, follow-up 2, value-add, final close)
## CRM Notes Template (what to log after every call/meeting: date, discussed, next step, sentiment)
## Monthly Check-in Script (what to say, 5 key questions to ask, how to end the call)
## Re-engagement Message (for clients who went quiet — subject line + email body)
## Client Tier System (how to categorize clients A/B/C and what touchpoint frequency each gets)
Format with actual email copy that can be used directly, not just descriptions.`,
};

// ── Chat Component ─────────────────────────────────────────────────────────────

export function Chat({ mode, keyStatus, tier, messagesThisMonth, onMessageSent, onUpgradeClick, onBuildApp, activeProfileId, onProfileSwitch, onProfileDeactivate, prefill, onClearPrefill, onNavigateToCommand, onNavigateToFiles, voiceMode: voiceModeProp, onVoiceModeChange }: Props) {
  const [messages, setMessages] = useState<Message[]>(() => {
    // Load persisted history on first render
    try {
      const raw = localStorage.getItem(HISTORY_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Message[];
        if (parsed.length > 0) {
          return parsed.map(m => ({ ...m, timestamp: new Date(m.timestamp) }));
        }
      }
    } catch { /* use default */ }
    return [{ id: 'welcome', role: 'system', content: getWelcomeMessage(mode, keyStatus), timestamp: new Date() }];
  });

  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [consensusThinking, setConsensusThinking] = useState(false);
  const [singleModelStreaming, setSingleModelStreaming] = useState(false);
  const [localMode, setLocalMode] = useState<'chat' | 'thinktank' | 'task'>(() =>
    mode === 'consensus' ? 'thinktank' : 'chat'
  );
  const [taskRunning, setTaskRunning] = useState(false);
  const [intensity, setIntensity] = useState<string>(() =>
    localStorage.getItem('triforge-intensity') ?? 'analytical'
  );
  const [intensitySuggestion, setIntensitySuggestion] = useState<string | null>(null);
  const [speaking, setSpeaking] = useState<string | null>(null);
  // voiceMode: controlled by parent (Settings) if prop provided, else local localStorage state
  const [_voiceModeLocal, _setVoiceModeLocal] = useState(
    () => voiceModeProp !== undefined ? voiceModeProp : localStorage.getItem('triforge-voice-mode') === 'on'
  );
  const voiceMode = voiceModeProp !== undefined ? voiceModeProp : _voiceModeLocal;
  const setVoiceMode = (next: boolean) => {
    _setVoiceModeLocal(next);
    localStorage.setItem('triforge-voice-mode', next ? 'on' : 'off');
    onVoiceModeChange?.(next);
  };
  const [voiceChatActive, setVoiceChatActive] = useState(false);
  const [handsFreeMode, setHandsFreeMode] = useState(false);
  const [councilListening, setCouncilListening] = useState(false);
  // Council Deliberation Mode — 3-phase cross-reaction before full response
  const [deliberateMode, setDeliberateMode] = useState(() =>
    localStorage.getItem('triforge-deliberate-mode') === 'on'
  );
  const [deliberationPhase, setDeliberationPhase] = useState<string | null>(null);
  // Live streaming state for Council consensus
  const [liveProviderTokens, setLiveProviderTokens] = useState<Record<string, string>>({});
  const [liveSynthesisText, setLiveSynthesisText]   = useState('');
  // Council Awareness — thinking messages per provider before tokens arrive
  const [providerThinkingMessages, setProviderThinkingMessages] = useState<Record<string, string>>({});
  const [gate, setGate] = useState<{ feature: string; neededTier: 'pro' | 'business' } | null>(null);
  const [checkoutUrls, setCheckoutUrls] = useState<{ pro: string; business: string; portal: string }>({ pro: '', business: '', portal: '' });
  const [showQuickActions, setShowQuickActions] = useState(false);
  const [showWorkflows, setShowWorkflows] = useState(false);
  const [attachedFiles, setAttachedFiles] = useState<{ name: string; path: string; content: string }[]>([]);
  // Council system state
  const [agreementMap, setAgreementMap] = useState<Record<string, boolean | null>>({});
  const [selectedProvider, setSelectedProvider] = useState<string>('merge');
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Streaming batch buffer — accumulates chunks between 50ms render ticks
  const streamBuf   = useRef('');
  const streamTimer = useRef<ReturnType<typeof setInterval> | null>(null);
  // MediaSource for streaming TTS playback
  const mediaSourceRef  = useRef<MediaSource | null>(null);
  const sourceBufferRef = useRef<SourceBuffer | null>(null);
  const ttsChunkQueue   = useRef<Uint8Array[]>([]);
  const ttsAppending    = useRef(false);
  // voiceService (singleton) owns the wake bridge — started from index.tsx
  // Interrupt voice detection — active while TTS is speaking
  const interruptRecRef = useRef<SpeechRecognition | null>(null);
  // Panel refs for outside-click dismiss
  const quickPanelRef    = useRef<HTMLDivElement>(null);
  const workflowPanelRef = useRef<HTMLDivElement>(null);

  // Mission awareness (Phase 3 — ForgeCommand integration)
  const [lastMission, setLastMission] = useState<LastMissionSummary | null>(null);
  const [missionBannerDismissed, setMissionBannerDismissed] = useState(false);
  const [escalationSuggested, setEscalationSuggested] = useState(false);

  useEffect(() => {
    window.triforge.license.checkoutUrls().then(setCheckoutUrls).catch(() => {});
  }, []);

  // Load mission context from ForgeCommand (within 24h window) + inject awareness message
  useEffect(() => {
    const mission = loadLastMission();
    if (mission && Date.now() - mission.timestamp < 24 * 60 * 60 * 1000) {
      setLastMission(mission);
      setMissionBannerDismissed(false);
      const alignment = mission.semanticScore ?? mission.confidenceScore;
      const pillarsNote = mission.strategicPillars.length > 0
        ? ` Key pillar: ${mission.strategicPillars[0]}.` : '';
      const awarenessMsg: Message = {
        id: 'mission-awareness',
        role: 'system',
        content: `Mission context loaded: "${mission.objective.slice(0, 60)}${mission.objective.length > 60 ? '…' : ''}" — ${alignment}% council alignment · ${mission.riskLevel} risk.${pillarsNote} Ask me to refine, explain, or build on it.`,
        timestamp: new Date(mission.timestamp),
      };
      setMessages(prev =>
        prev.some(m => m.id === 'mission-awareness') ? prev
          : [prev[0], awarenessMsg, ...prev.slice(1)]
      );
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

  // Proactive Council suggestions — persistent subscription for fire-and-forget events
  useEffect(() => {
    const unsub = window.triforge.forge.onSuggestion((data) => {
      appendMsg({ id: crypto.randomUUID(), role: 'system', content: `Council: ${data.text}`, timestamp: new Date() });
    });
    return unsub;
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Persist chat history (debounced)
  useEffect(() => {
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(messages.slice(-150)));
      } catch { /* quota exceeded — ignore */ }
    }, 600);
    return () => { if (saveTimer.current) clearTimeout(saveTimer.current); };
  }, [messages]);

  // Pre-fill input when a template prompt is passed in from ForgeProfiles
  useEffect(() => {
    if (prefill) {
      setInput(prefill);
      onClearPrefill?.();
      inputRef.current?.focus();
    }
  }, [prefill]); // eslint-disable-line react-hooks/exhaustive-deps

  // Close Quick / Flows panels on outside click
  useEffect(() => {
    if (!showQuickActions && !showWorkflows) return;
    const handler = (e: MouseEvent) => {
      const t = e.target as Node;
      if (showQuickActions && quickPanelRef.current && !quickPanelRef.current.contains(t)) {
        setShowQuickActions(false);
      }
      if (showWorkflows && workflowPanelRef.current && !workflowPanelRef.current.contains(t)) {
        setShowWorkflows(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [showQuickActions, showWorkflows]);

  // Auto-detect intensity from message content (debounced 400ms) — only in thinktank mode
  useEffect(() => {
    if (localMode !== 'thinktank') { setIntensitySuggestion(null); return; }
    const t = setTimeout(() => {
      const detected = detectIntensity(input);
      setIntensitySuggestion(detected !== intensity ? detected : null);
    }, 400);
    return () => clearTimeout(t);
  }, [input, intensity, localMode]);

  // Strategic escalation detection — suggest Command after 6+ user messages with strategic keywords
  const STRATEGIC_KEYWORDS = ['launch', 'monetize', 'scale', 'roadmap', 'execution',
    'budget', 'risk', 'strategy', 'market', 'revenue', 'growth', 'compete', 'expansion', 'funding'];
  useEffect(() => {
    if (escalationSuggested || !onNavigateToCommand) return;
    const userMsgs = messages.filter(m => m.role === 'user');
    if (userMsgs.length < 6) return;
    const combined = userMsgs.map(m => m.content.toLowerCase()).join(' ');
    if (STRATEGIC_KEYWORDS.some(kw => combined.includes(kw))) setEscalationSuggested(true);
  }, [messages]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Wake Word listener — always active, independent of voice output mode ──────
  // Explicitly requests getUserMedia first so Chromium/Electron actually prompts for
  // microphone permission. Without this call, SpeechRecognition fails silently with
  // 'not-allowed' because Electron never triggers the permission dialog on its own.

  // ── Council authenticated — fired by App.tsx after identity verification passes
  // triforge:council-wake is intercepted by App.tsx → CouncilWakeScreen → auth
  // Only start hands-free mode here, AFTER the user is verified.
  useEffect(() => {
    const handler = () => {
      setHandsFreeMode(true);
      setCouncilListening(true);
      setTimeout(() => setCouncilListening(false), 500);
      window.triforge.voice.notifyWake();
      councilPresence.setState('listening');
      playListeningTone();
    };
    window.addEventListener('triforge:council-authenticated', handler);
    return () => window.removeEventListener('triforge:council-authenticated', handler);
  }, []);

  // ── Voice-triggered mission commands ─────────────────────────────────────────
  useEffect(() => {
    const unsub = onCouncilCommand((matched, source) => {
      if (source === 'voice' && matched.command.startsWith('mission_')) {
        const intent = matched.command.replace('mission_', '');
        window.triforge.mission?.start(matched.payload ?? matched.command, intent, 'voice').catch(console.warn);
      }
      // 'council_deliberate', 'claude_advise', 'grok_challenge', 'apply_solution' — future wiring
    });
    return () => unsub();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Pause wake detection + sync council presence while TTS or HandsFreeVoice is active
  useEffect(() => {
    if (speaking || handsFreeMode) {
      voiceService.pause();
      if (handsFreeMode && !speaking) councilPresence.setState('listening');
    } else {
      voiceService.resume();
      councilPresence.setState('idle');
    }
  }, [speaking, handsFreeMode]);

  // ── TTS ───────────────────────────────────────────────────────────────────────

  const speakMessage = useCallback(async (msgId: string, text: string) => {
    // Stop anything currently playing
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ''; }
    window.speechSynthesis?.cancel();
    // Tear down any prior MediaSource
    if (mediaSourceRef.current && mediaSourceRef.current.readyState === 'open') {
      try { mediaSourceRef.current.endOfStream(); } catch { /* ignore */ }
    }
    mediaSourceRef.current = null;
    sourceBufferRef.current = null;
    ttsChunkQueue.current = [];
    ttsAppending.current = false;

    setSpeaking(msgId);
    councilPresence.setState('speaking');
    const truncated = text.slice(0, 4096);

    // Priority 1: OpenAI TTS streaming — Pro/Business users with an OpenAI key
    if (keyStatus.openai && (tier === 'pro' || tier === 'business')) {
      try {
        await new Promise<void>((resolve, reject) => {
          const ms  = new MediaSource();
          mediaSourceRef.current = ms;

          const appendNext = () => {
            if (!sourceBufferRef.current || sourceBufferRef.current.updating) return;
            if (ttsChunkQueue.current.length > 0) {
              ttsAppending.current = true;
              const chunk = ttsChunkQueue.current.shift()!;
              try { sourceBufferRef.current.appendBuffer(chunk); } catch { /* ignore abort */ }
            } else {
              ttsAppending.current = false;
            }
          };

          ms.onsourceopen = () => {
            const sb = ms.addSourceBuffer('audio/mpeg');
            sourceBufferRef.current = sb;
            sb.onupdateend = appendNext;
          };

          // Set up IPC streaming listeners
          const unsubChunk = window.triforge.voice.onSpeakChunk((b64: string) => {
            const bytes = Uint8Array.from(atob(b64), c => c.charCodeAt(0));
            ttsChunkQueue.current.push(bytes);
            appendNext();
          });

          const unsubDone = window.triforge.voice.onSpeakDone(() => {
            unsubChunk();
            unsubDone();
            // Wait for all buffered chunks to be appended before ending stream
            const finish = () => {
              if (ttsChunkQueue.current.length > 0 || (sourceBufferRef.current?.updating)) {
                setTimeout(finish, 50);
                return;
              }
              if (ms.readyState === 'open') {
                try { ms.endOfStream(); } catch { /* ignore */ }
              }
            };
            finish();
          });

          const blobUrl = URL.createObjectURL(ms);
          if (audioRef.current) {
            audioRef.current.src = blobUrl;
            audioRef.current.play().catch(reject);
            audioRef.current.onended = () => { URL.revokeObjectURL(blobUrl); setSpeaking(null); councilPresence.setState('idle'); resolve(); };
            audioRef.current.onerror = () => { URL.revokeObjectURL(blobUrl); setSpeaking(null); councilPresence.setState('idle'); resolve(); };
          }

          // Kick off the IPC streaming request
          window.triforge.voice.speak(truncated).catch(reject);
        });
        return;
      } catch { /* fall through to Web Speech */ }
    }

    // Fallback: Web Speech API — built into Electron/Chromium, works for all users
    if ('speechSynthesis' in window) {
      const utt = new SpeechSynthesisUtterance(truncated);
      // Prefer neural / high-quality voices — same priority order as splash.html
      const voices = window.speechSynthesis.getVoices();
      const preferred =
        voices.find(v => /Microsoft (Aria|Jenny|Guy|Davis|Tony) Online.*Natural/i.test(v.name)) ||
        voices.find(v => /(Ava|Allison|Samantha).*Enhanced/i.test(v.name))                      ||
        voices.find(v => v.name === 'Samantha')                                                  ||
        voices.find(v => /^Microsoft Aria$/i.test(v.name))                                       ||
        voices.find(v => /Google US English/i.test(v.name))                                      ||
        voices.find(v => v.lang === 'en-US' && v.localService);
      if (preferred) utt.voice = preferred;
      utt.rate  = 0.92;
      utt.pitch = 1.0;
      utt.onend = () => setSpeaking(null); councilPresence.setState('idle');
      utt.onerror = () => setSpeaking(null); councilPresence.setState('idle');
      window.speechSynthesis.speak(utt);
      return;
    }

    setSpeaking(null); councilPresence.setState('idle');
  }, [keyStatus, tier]);

  // ── Interrupt current TTS speech immediately ───────────────────────────────────

  const interruptSpeech = useCallback(() => {
    // Stop audio playback
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ''; }
    window.speechSynthesis?.cancel();
    if (mediaSourceRef.current?.readyState === 'open') {
      try { mediaSourceRef.current.endOfStream(); } catch { /* ignore */ }
    }
    mediaSourceRef.current = null;
    sourceBufferRef.current = null;
    ttsChunkQueue.current = [];
    // Signal main process to abort its streaming fetch
    window.triforge.voice.interrupt();
    setSpeaking(null); councilPresence.setState('idle');
  }, []);

  // Voice interrupt detection — lightweight SpeechRecognition active only while TTS is playing
  useEffect(() => {
    if (!speaking) {
      interruptRecRef.current?.stop();
      interruptRecRef.current = null;
      return;
    }
    const SR = (window as Window & typeof globalThis).SpeechRecognition
            ?? (window as Window & typeof globalThis).webkitSpeechRecognition;
    if (!SR) return;
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = false;
    rec.lang = 'en-US';
    interruptRecRef.current = rec;
    const INTERRUPT_WORDS = ['stop', 'cancel', 'council stop', 'stop council', 'quiet', 'silence', 'enough'];
    rec.onresult = (e: SpeechRecognitionEvent) => {
      const lastIdx = e.results.length - 1;
      const t = e.results[lastIdx][0].transcript.toLowerCase().trim();
      if (INTERRUPT_WORDS.some(w => t === w || t.startsWith(w + ' ') || t.endsWith(' ' + w))) {
        interruptSpeech();
      }
    };
    rec.onerror = () => { interruptRecRef.current = null; };
    rec.onend   = () => { interruptRecRef.current = null; };
    try { rec.start(); } catch { interruptRecRef.current = null; }
    return () => {
      rec.stop();
      interruptRecRef.current = null;
    };
  }, [speaking, interruptSpeech]);

  // ── Send helpers ──────────────────────────────────────────────────────────────

  const appendMsg = (msg: Message) => setMessages(m => [...m, msg]);

  const addSystemMsg = (content: string) => appendMsg({ id: crypto.randomUUID(), role: 'system', content, timestamp: new Date() });

  const attachFile = useCallback(async () => {
    const result = await window.triforge.files.pickFile();
    if (!result) return;
    const read = await window.triforge.files.readFile(result);
    if (read.error === 'PERMISSION_DENIED:files') {
      addSystemMsg('File access requires the Files permission. Enable it in Settings → Permissions.');
      return;
    }
    if (read.error === 'BINARY_FILE') {
      const fname = result.split(/[/\\]/).pop() ?? result;
      addSystemMsg(`"${fname}" is a binary file. Opening ⊡ Files to index it.`);
      onNavigateToFiles?.();
      return;
    }
    if (read.error) { addSystemMsg(`Could not read file: ${read.error}`); return; }
    const name = result.split(/[/\\]/).pop() ?? result;
    setAttachedFiles(prev => prev.length < 5 ? [...prev, { name, path: result, content: read.content ?? '' }] : prev);
  }, []);

  const addPhotoMsg = (label: string, photos: PhotoFile[]) =>
    appendMsg({ id: crypto.randomUUID(), role: 'system', content: label, photos, timestamp: new Date() });

  const addDocResultsMsg = (query: string, results: DocResult[]) =>
    appendMsg({ id: crypto.randomUUID(), role: 'system', content: `Document search: "${query}"`, docResults: results, docQuery: query, timestamp: new Date() });

  const handleGateError = (error: string) => {
    if (error === 'MESSAGE_LIMIT_REACHED') { setGate({ feature: 'MESSAGE_LIMIT_REACHED', neededTier: 'pro' }); return true; }
    if (error.startsWith('FEATURE_LOCKED:')) {
      const parts = error.split(':');
      const feat = parts[1] ?? 'unknown';
      const neededTier = (parts[2] === 'business' ? 'business' : 'pro') as 'pro' | 'business';
      setGate({ feature: feat, neededTier });
      return true;
    }
    return false;
  };

  // ── Main send (branches on mode) ─────────────────────────────────────────────

  const sendMessage = useCallback(async (text: string, retryId?: string) => {
    if (!text.trim() || sending) return;

    // Intercept mission commands typed by user (voice is handled in onCouncilCommand)
    const dispatched = dispatchCommand(text.trim(), 'typed');
    if (dispatched?.command.startsWith('mission_')) {
      const intent = dispatched.command.replace('mission_', '');
      window.triforge.mission?.start(text.trim(), intent, 'typed').catch(console.warn);
      setInput('');
      return;
    }

    setInput('');
    setSending(true);
    setShowQuickActions(false);
    councilPresence.setState('thinking');

    // Remove error message being retried
    if (retryId) setMessages(m => m.filter(msg => msg.id !== retryId));

    const userMsg: Message = { id: crypto.randomUUID(), role: 'user', content: text.trim(), timestamp: new Date() };
    setMessages(m => [...m, userMsg]);

    const history = messages
      .filter(m => m.role !== 'system')
      .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    // Prepend compact mission context when banner is active (Phase 3)
    const contextPrefix = (lastMission && !missionBannerDismissed)
      ? `[FORGE CONTEXT: Strategic mission "${lastMission.objective.slice(0, 80)}" — Council alignment ${lastMission.semanticScore ?? lastMission.confidenceScore}%, Risk ${lastMission.riskLevel}. Summary: ${lastMission.executiveSummary.slice(0, 200)}]\n\n`
      : '';
    const fileContext = attachedFiles.map(f => `[FILE: ${f.name}]\n${f.content}\n[/FILE]`).join('\n\n');
    const fileContextStr = fileContext ? fileContext + '\n\n' : '';
    setAttachedFiles([]);
    const messageToSend = fileContextStr + contextPrefix + text.trim();

    const activeProviders = Object.entries(keyStatus).filter(([, v]) => v);
    const useConsensus = mode === 'consensus' && activeProviders.length > 1;

    try {
      if (useConsensus) {
        setConsensusThinking(true);
        setLiveProviderTokens({});
        setLiveSynthesisText('');
        setProviderThinkingMessages({});

        // Subscribe to streaming council events so CouncilSeat cards type live
        const unsubForge = window.triforge.forge.onUpdate((data) => {
          // Council Awareness — role-specific thinking message before tokens arrive
          if (data.phase === 'provider:thinking' && data.provider && data.thinkingText) {
            setProviderThinkingMessages(prev => ({ ...prev, [data.provider!.toLowerCase()]: data.thinkingText! }));
          // Clear thinking message once real tokens start arriving
          } else if (data.phase === 'provider:token' && data.provider) {
            setProviderThinkingMessages(prev => {
              if (!prev[data.provider!.toLowerCase()]) return prev;
              const next = { ...prev };
              delete next[data.provider!.toLowerCase()];
              return next;
            });
            if (data.token) {
              setLiveProviderTokens(prev => ({
                ...prev,
                [data.provider!.toLowerCase()]: (prev[data.provider!.toLowerCase()] ?? '') + data.token,
              }));
            }
          // Deliberation Phase 1 — initial positions
          } else if (data.phase === 'deliberation:phase1:start') {
            setDeliberationPhase('Round 1 — Initial positions');
            setLiveProviderTokens({});
            setProviderThinkingMessages({});
          } else if (data.phase === 'deliberation:phase1:token' && data.provider && data.token) {
            setLiveProviderTokens(prev => ({
              ...prev,
              [data.provider!.toLowerCase()]: (prev[data.provider!.toLowerCase()] ?? '') + data.token,
            }));
          // Deliberation Phase 2 — cross-reactions
          } else if (data.phase === 'deliberation:phase2:start') {
            setDeliberationPhase('Round 2 — Cross-reactions');
            setLiveProviderTokens({});
            setProviderThinkingMessages({});
          } else if (data.phase === 'deliberation:phase2:token' && data.provider && data.token) {
            setLiveProviderTokens(prev => ({
              ...prev,
              [data.provider!.toLowerCase()]: (prev[data.provider!.toLowerCase()] ?? '') + data.token,
            }));
          } else if (data.phase === 'deliberation:complete') {
            setDeliberationPhase('Round 3 — Full response');
            setLiveProviderTokens({});
            setProviderThinkingMessages({});
          } else if (data.phase === 'synthesis:token' && data.token) {
            setLiveSynthesisText(prev => prev + data.token);
          }
        });

        // Fast-First: show draft immediately when first provider finishes
        const unsubDraft = window.triforge.forge.onDraft((_data) => {
          // draft already visible via liveProviderTokens; no extra state needed
        });

        // Council Update: interim refinement from second provider pair
        const unsubUpdate = window.triforge.forge.onCouncilUpdate((data) => {
          setLiveSynthesisText(data.text);
        });

        const result = await window.triforge.chat.consensus(messageToSend, history, intensity, deliberateMode);
        unsubForge();
        unsubDraft();
        unsubUpdate();
        setConsensusThinking(false);
        setLiveProviderTokens({});
        setLiveSynthesisText('');
        setProviderThinkingMessages({});
        setDeliberationPhase(null);

        if (result.error && handleGateError(result.error)) { setSending(false); return; }

        onMessageSent();
        const aiMsg: Message = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: result.error ? result.error : (result.synthesis ?? ''),
          consensusResponses: result.responses,
          forgeScore: result.forgeScore,
          failedProviders: result.failedProviders,
          isError: !!result.error,
          debateIntensity: intensity,
          timestamp: new Date(),
        };
        appendMsg(aiMsg);

        // Reset council agreement map — neutral by default (user must explicitly agree/disagree)
        if (!result.error && result.responses) {
          setAgreementMap({});
          setSelectedProvider('merge');
          // Fire consensus presence state + chime when all council members responded
          councilPresence.setState('consensus');
          playConsensusTone();
        }

        if (!result.error && result.synthesis && voiceMode) {
          speakMessage(aiMsg.id, result.synthesis);
        }
      } else {
        // Add a live streaming placeholder — tokens will fill it in real time
        const streamId = crypto.randomUUID();
        setMessages(m => [...m, { id: streamId, role: 'assistant', content: '', streaming: true, timestamp: new Date() }]);

        // Batch chunk updates at 50ms cadence (~20fps) to avoid per-token re-renders
        streamBuf.current = '';
        streamTimer.current = setInterval(() => {
          if (!streamBuf.current) return;
          const pending = streamBuf.current;
          streamBuf.current = '';
          setMessages(m => m.map(msg => msg.id === streamId ? { ...msg, content: msg.content + pending } : msg));
        }, 50);

        const unsub = window.triforge.chat.onChunk((chunk: string) => {
          setSingleModelStreaming(true);
          streamBuf.current += chunk;
        });

        const result = await window.triforge.chat.send(messageToSend, history);
        unsub();
        clearInterval(streamTimer.current!);
        streamTimer.current = null;
        setSingleModelStreaming(false);

        if (result.error && handleGateError(result.error)) {
          setMessages(m => m.filter(msg => msg.id !== streamId));
          setSending(false);
          return;
        }

        onMessageSent();
        // Finalise the streaming message with confirmed text + metadata
        setMessages(m => m.map(msg => msg.id === streamId ? {
          ...msg,
          content: result.text ?? msg.content, // keep streamed content if result.text is empty
          provider: result.provider,
          isError: false,
          streaming: false,
        } : msg));

        if (result.text && voiceMode) {
          speakMessage(streamId, result.text);
        }
      }
    } catch (e) {
      setConsensusThinking(false);
      appendMsg({
        id: crypto.randomUUID(), role: 'assistant', isError: true,
        content: `${e instanceof Error ? e.message : 'Something went wrong'}`,
        timestamp: new Date(),
      });
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }, [messages, sending, keyStatus, mode, tier, onMessageSent, speakMessage]);

  const clearChat = () => {
    const welcome = { id: crypto.randomUUID(), role: 'system' as const, content: getWelcomeMessage(mode, keyStatus), timestamp: new Date() };
    setMessages([welcome]);
    setInput('');
    setAgreementMap({});
    setSelectedProvider('merge');
    try { localStorage.removeItem(HISTORY_KEY); } catch { /* ok */ }
  };

  // ── Council — propose alternative from a specific provider ────────────────────

  const proposeAlternative = useCallback((provider: string) => {
    const pl: Record<string, string> = { openai: 'GPT', claude: 'Claude', grok: 'Grok' };
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
    if (!lastUserMsg) return;
    sendMessage(`${pl[provider] ?? provider}, please propose an alternative approach to: "${lastUserMsg.content.slice(0, 200)}"`);
  }, [messages, sendMessage]);

  const mergeProviders = useCallback((p1: string, p2: string) => {
    const pl: Record<string, string> = { openai: 'GPT', claude: 'Claude', grok: 'Grok' };
    const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
    if (!lastUserMsg) return;
    sendMessage(`Synthesize the best elements from ${pl[p1] ?? p1} and ${pl[p2] ?? p2}'s approaches on: "${lastUserMsg.content.slice(0, 200)}"`);
  }, [messages, sendMessage]);

  // ── Task Runtime ────────────────────────────────────────────────────────────────
  // Decomposes goal with IntentEngine, generates an execution plan, then auto-runs it.

  const runAsTask = useCallback(async (goal: string) => {
    const text = goal.trim();
    if (!text || sending) return;
    setInput('');
    setSending(true);
    setTaskRunning(true);

    // User message
    appendMsg({ id: crypto.randomUUID(), role: 'user', content: text, timestamp: new Date() });

    // Planning placeholder
    const statusId = crypto.randomUUID();
    setMessages(m => [...m, {
      id: statusId, role: 'assistant',
      content: 'Decomposing goal…',
      taskPhase: 'decomposing' as const,
      timestamp: new Date(),
    }]);

    const unsub = window.triforge.task.onUpdate(({ phase }) => {
      setMessages(m => m.map(msg => msg.id === statusId ? {
        ...msg,
        content: phase === 'decomposing' ? 'Decomposing goal…' : 'Building execution plan…',
        taskPhase: phase as 'decomposing' | 'planning' | 'ready',
      } : msg));
    });

    try {
      const result = await window.triforge.task.run(text);
      unsub();
      setTaskRunning(false);
      if (result.error) {
        setMessages(m => m.map(msg => msg.id === statusId ? {
          ...msg, content: result.error!, isError: true, taskPhase: 'error' as const,
        } : msg));
      } else {
        onMessageSent();
        setMessages(m => m.map(msg => msg.id === statusId ? {
          ...msg,
          content: result.summary ?? 'Task plan ready.',
          taskPhase: 'ready' as const,
          executionPlan: result.plan,
        } : msg));
      }
    } catch (e) {
      unsub();
      setTaskRunning(false);
      setMessages(m => m.map(msg => msg.id === statusId ? {
        ...msg,
        content: e instanceof Error ? e.message : 'Task failed.',
        isError: true, taskPhase: 'error' as const,
      } : msg));
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }, [sending, onMessageSent, appendMsg]);

  // ── System actions ────────────────────────────────────────────────────────────

  const runFindPhotos = async () => {
    addSystemMsg('Scanning for photos…');
    try {
      const result = await window.triforge.files.scanPhotos();
      if (result.error === 'PERMISSION_DENIED:files') {
        addSystemMsg('Files permission is off. Enable Files & Folders in Settings → Permissions.');
        return;
      }
      const count = result.photos.length;
      if (count === 0) { addSystemMsg('No photos found in Pictures, Desktop, or Downloads.'); return; }
      const preview = result.photos.slice(0, 5).map(p => `• ${p.name} — ${new Date(p.modified).toLocaleDateString()}`).join('\n');
      addSystemMsg(`Found ${count} photo${count > 1 ? 's' : ''}. Most recent:\n${preview}${count > 5 ? `\n…and ${count - 5} more.` : ''}`);
    } catch { addSystemMsg('Could not scan for photos.'); }
  };

  const runIndexDocs = async () => {
    const msgId = crypto.randomUUID();
    appendMsg({ id: msgId, role: 'system', content: 'Indexing documents — first run may take 1–3 minutes…\nAll processing is local. No files leave your device.', timestamp: new Date() });
    try {
      const unsub = window.triforge.docs.onProgress((d) => {
        if (d.phase === 'start') {
          const toScan = d.total ?? 0;
          const cached = d.existing ?? 0;
          setMessages(m => m.map(msg => msg.id === msgId
            ? { ...msg, content: `Indexing documents — ${toScan} new file${toScan !== 1 ? 's' : ''} to process${cached > 0 ? `, ${cached} already indexed` : ''}…\nAll processing is local. No files leave your device.` }
            : msg
          ));
        } else if (d.phase === 'indexed' && d.current && d.total) {
          setMessages(m => m.map(msg => msg.id === msgId
            ? { ...msg, content: `Indexing… ${d.current}/${d.total}: ${d.name ?? ''}\nAll processing is local. No files leave your device.` }
            : msg
          ));
        } else if (d.phase === 'complete') {
          setMessages(m => m.map(msg => msg.id === msgId
            ? { ...msg, content: `Index complete — ${d.total} document${(d.total ?? 0) !== 1 ? 's' : ''} indexed. You can now search them.\nAll processing is local. No files leave your device.` }
            : msg
          ));
        }
      });
      const result = await window.triforge.docs.index();
      unsub();
      if (result.error === 'PERMISSION_DENIED:files') {
        setMessages(m => m.map(msg => msg.id === msgId ? { ...msg, content: 'Files permission is off. Enable Files & Folders in Settings → Permissions.' } : msg));
      }
    } catch {
      setMessages(m => m.map(msg => msg.id === msgId ? { ...msg, content: 'Could not index documents.' } : msg));
    }
  };

  const runSearchDocs = async (query: string) => {
    addSystemMsg(`Searching for "${query}"…`);
    try {
      const result = await window.triforge.docs.search(query);
      if (result.error === 'PERMISSION_DENIED:files') {
        addSystemMsg('Files permission is off. Enable Files & Folders in Settings → Permissions.');
        return;
      }
      if (result.needsIndex) {
        addSystemMsg(`No document index found. Indexing your documents first, then searching for "${query}"…`);
        await runIndexDocs();
        const retry = await window.triforge.docs.search(query);
        addDocResultsMsg(query, retry.results ?? []);
        return;
      }
      addDocResultsMsg(query, result.results ?? []);
    } catch { addSystemMsg('Could not search documents.'); }
  };

  const runOrganizeDownloads = async () => {
    const dirPath = await window.triforge.files.pickDir();
    if (!dirPath) return;
    addSystemMsg(`Organizing ${dirPath}…`);
    try {
      const result = await window.triforge.files.organize(dirPath);
      if (result.errors.some(e => e.includes('PERMISSION_DENIED'))) {
        addSystemMsg('Files permission is off. Enable Files & Folders in Settings → Permissions.'); return;
      }
      if (result.moved === 0) {
        addSystemMsg('No loose files found — folder may already be sorted or contains unsupported types.');
        return;
      }
      const folders = result.folders.map(f => f.split(/[\\/]/).pop()).join(', ');
      addSystemMsg(`Organized ${result.moved} file${result.moved > 1 ? 's' : ''} → ${folders || 'category sub-folders'}.${result.errors.length ? `\n${result.errors.length} file(s) skipped.` : ''}`);
    } catch { addSystemMsg('Could not organize the selected folder.'); }
  };

  const runOrganizeDeep = async () => {
    const dirPath = await window.triforge.files.pickDir();
    if (!dirPath) return;
    addSystemMsg(`Deep scan of ${dirPath} — organizing all nested files…`);
    try {
      const result = await window.triforge.files.organizeDeep(dirPath);
      if (result.errors.some(e => e.includes('PERMISSION_DENIED'))) {
        addSystemMsg('Files permission is off. Enable Files & Folders in Settings → Permissions.'); return;
      }
      if (result.moved === 0) {
        addSystemMsg(`Scanned ${result.directoriesScanned} folders — all files already organized or no supported types found.`);
        return;
      }
      const folders = result.folders.map(f => f.split(/[\\/]/).pop()).join(', ');
      addSystemMsg(`Organized ${result.moved} file${result.moved > 1 ? 's' : ''} across ${result.directoriesScanned} folders → ${folders || 'category sub-folders'}.${result.errors.length ? `\n${result.errors.length} file(s) skipped.` : ''}`);
    } catch { addSystemMsg('Could not complete deep organization.'); }
  };

  // Auto-organize a known system folder (no folder picker — path resolved on main process side)
  const runOrganizeKnownDir = async (dirKey: 'Desktop' | 'Downloads' | 'Documents') => {
    try {
      const dirs = await window.triforge.files.commonDirs();
      const dirPath = dirs[dirKey];
      if (!dirPath) { addSystemMsg(`Could not locate your ${dirKey} folder.`); return; }
      addSystemMsg(`Organizing ${dirKey} (${dirPath})…`);
      const result = await window.triforge.files.organize(dirPath);
      if (result.errors.some(e => e.includes('PERMISSION_DENIED'))) {
        addSystemMsg('Files permission is off. Enable Files & Folders in Settings → Permissions.'); return;
      }
      if (result.moved === 0) {
        addSystemMsg(`${dirKey} is already sorted — no loose files matching known categories were found.`); return;
      }
      const folders = result.folders.map(f => f.split(/[\\/]/).pop()).join(', ');
      addSystemMsg(`${dirKey} organized: moved ${result.moved} file${result.moved > 1 ? 's' : ''} into ${folders || 'category sub-folders'}.${result.errors.length ? ` ${result.errors.length} file(s) skipped.` : ''}`);
    } catch { addSystemMsg(`Could not organize your ${dirKey} folder.`); }
  };

  const runSearchPhotos = async (query?: string) => {
    const q = query ?? prompt('Search photos by name or keyword:');
    if (!q?.trim()) return;
    addSystemMsg(`Searching for photos matching "${q}"…`);
    try {
      const result = await window.triforge.files.searchPhotos(q.trim());
      if (result.error === 'PERMISSION_DENIED:files') {
        addSystemMsg('Files permission is off. Go to Settings → Permissions → Files & Folders.'); return;
      }
      if (result.photos.length === 0) {
        addSystemMsg(`No photos found matching "${q}".`); return;
      }
      addPhotoMsg(`Found ${result.photos.length} photo${result.photos.length > 1 ? 's' : ''} matching "${q}"`, result.photos);
    } catch { addSystemMsg('Photo search failed.'); }
  };

  const runFindSimilar = async () => {
    const refPath = await window.triforge.files.pickFile([
      { name: 'Images', extensions: ['jpg','jpeg','png','gif','bmp','webp','heic','heif','tiff','tif'] },
    ]);
    if (!refPath) return;
    const refName = refPath.split(/[\\/]/).pop() ?? refPath;
    addSystemMsg(`Scanning for photos similar to "${refName}"…`);
    try {
      const result = await window.triforge.files.findSimilar(refPath);
      if (result.error === 'PERMISSION_DENIED:files') {
        addSystemMsg('Files permission is off. Go to Settings → Permissions → Files & Folders.'); return;
      }
      if (result.photos.length === 0) {
        addSystemMsg(`No photos found similar to "${refName}" — try a broader folder or different reference.`); return;
      }
      addPhotoMsg(`${result.photos.length} photo${result.photos.length > 1 ? 's' : ''} similar to "${refName}"`, result.photos);
    } catch { addSystemMsg('Could not scan for similar photos.'); }
  };

  const runPickAndPrint = async () => {
    const filePath = await window.triforge.files.pickFile([
      { name: 'Documents & Images', extensions: ['pdf', 'doc', 'docx', 'txt', 'png', 'jpg', 'jpeg'] },
      { name: 'All Files', extensions: ['*'] },
    ]);
    if (!filePath) return;
    addSystemMsg('Checking available printers…');
    try {
      const { printers, error } = await window.triforge.print.list();
      if (error === 'PERMISSION_DENIED:printer') { addSystemMsg('Printer permission is off. Go to Settings → Permissions → Printer.'); return; }
      if (printers.length === 0) { addSystemMsg('No printers found. Make sure your printer is connected.'); return; }
      const printer = printers.find(p => p.isDefault) ?? printers[0];
      addSystemMsg(`Sending "${filePath.split(/[\\/]/).pop()}" to ${printer.name}…`);
      const result = await window.triforge.print.file(filePath, printer.name);
      addSystemMsg(result.ok ? `Print job sent to ${printer.name}.` : `Print failed: ${result.error}`);
    } catch { addSystemMsg('Could not complete print job.'); }
  };

  const handleQuickAction = (a: typeof QUICK_ACTIONS[number]) => {
    setShowQuickActions(false);
    if ('action' in a) {
      if (a.action === 'docs')       { setInput('Find my '); inputRef.current?.focus(); return; }
      if (a.action === 'organize')   { runOrganizeDownloads(); return; }
      if (a.action === 'print')      { runPickAndPrint(); return; }
      if (a.action === 'builder')    { onBuildApp(); return; }
      if (a.action === 'investment') { sendMessage(INVESTMENT_PROMPT); return; }
      if (a.action === 'funding')    { sendMessage(FUNDING_PROMPT); return; }
    }
  };

  const fireWorkflow = (workflowId: string) => {
    if (tier === 'free') {
      setShowWorkflows(false);
      setGate({ feature: 'WORKFLOW_TEMPLATES', neededTier: 'pro' });
      return;
    }
    setShowWorkflows(false);
    const prompt = WORKFLOW_PROMPTS[workflowId];
    if (prompt) sendMessage(prompt);
  };

  const hasKeys = Object.values(keyStatus).some(Boolean);
  const msgLimit = MSG_LIMITS[tier] ?? 30;
  const unlimited = msgLimit === Infinity;
  const remaining = unlimited ? Infinity : Math.max(0, msgLimit - messagesThisMonth);
  const atLimit = !unlimited && remaining <= 0;

  // Derived values for panels
  const latestConsensusMsg = [...messages].reverse().find(m => m.role === 'assistant' && m.consensusResponses);
  const latestAssistantMsg = localMode !== 'thinktank'
    ? [...messages].reverse().find(m => m.role === 'assistant' && !m.streaming)
    : null;
  // Content shown in right panel for thinktank mode
  const finalContent: string | null = latestConsensusMsg
    ? (selectedProvider && selectedProvider !== 'merge')
      ? (latestConsensusMsg.consensusResponses?.find(r => r.provider.toLowerCase() === selectedProvider)?.text ?? latestConsensusMsg.content)
      : latestConsensusMsg.content
    : null;

  // Right panel ForgeScore display vars
  const rfScore = latestConsensusMsg?.forgeScore ?? null;
  const rfBarC = rfScore
    ? rfScore.confidence >= 75 ? '#10a37f' : rfScore.confidence >= 50 ? '#f59e0b' : '#ef4444'
    : null;
  const rfRiskColors: Record<string, string> = { Low: '#10a37f', Medium: '#f59e0b', High: '#ef4444' };
  const rfRc = rfScore ? (rfRiskColors[rfScore.risk] ?? '#f59e0b') : null;

  return (
    <div style={cs.container}>
      {gate && (
        <UpgradeGate
          feature={gate.feature} neededTier={gate.neededTier}
          onClose={() => setGate(null)}
          onUpgrade={(url) => { window.triforge.system.openExternal(url); setGate(null); }}
          proCheckout={checkoutUrls.pro} bizCheckout={checkoutUrls.business}
        />
      )}

      {/* Active profile strip */}
      {activeProfileId && (
        <ProfileStatusStrip
          profileId={activeProfileId}
          onSwitch={onProfileSwitch ?? (() => {})}
          onDeactivate={onProfileDeactivate ?? (() => {})}
        />
      )}

      {/* Mission awareness banner — visible when a recent ForgeCommand mission exists */}
      {lastMission && !missionBannerDismissed && messages.length < 3 && (
        <div style={cs.missionBanner}>
          <div style={cs.missionBannerLeft}>
            <span style={cs.missionBannerLabel}>MISSION ACTIVE</span>
            <span style={cs.missionBannerObjective}>
              {lastMission.objective.length > 60
                ? lastMission.objective.slice(0, 60) + '…'
                : lastMission.objective}
            </span>
            <span style={cs.missionBannerMeta}>
              Alignment: {lastMission.semanticScore ?? lastMission.confidenceScore}%
              &nbsp;&nbsp;|&nbsp;&nbsp;Risk: {lastMission.riskLevel}
            </span>
          </div>
          <div style={cs.missionBannerActions}>
            <button
              style={cs.missionBannerAsk}
              onClick={() => {
                setInput(`Based on our last strategic mission regarding: "${lastMission.objective}", can you help me refine the approach?`);
                inputRef.current?.focus();
              }}
            >
              Ask about this
            </button>
            <button style={cs.missionBannerDismiss} onClick={() => setMissionBannerDismissed(true)}>
              ✕
            </button>
          </div>
        </div>
      )}

      {/* TOP BAR */}
      <div style={cs.topBar}>
        {/* Row 1 — controls */}
        <div style={cs.topBarControls}>
          <div style={cs.statusDots}>
            {(['openai', 'claude', 'grok'] as const).map(p => {
              const active = keyStatus[p];
              const color = PROVIDER_COLORS[p];
              return (
                <div key={p} title={`${PROVIDER_LABELS[p]}: ${active ? 'active' : 'not configured'}`} style={{
                  display: 'flex', alignItems: 'center', gap: 4,
                  padding: '2px 7px', borderRadius: 20,
                  background: active ? `${color}18` : 'transparent',
                  border: `1px solid ${active ? `${color}55` : 'var(--border)'}`,
                  transition: 'all 0.3s',
                }}>
                  <div style={{ width: 6, height: 6, borderRadius: '50%', background: active ? color : 'var(--bg-elevated)', border: `1.5px solid ${active ? color : 'var(--border)'}`, flexShrink: 0 }} />
                  <span style={{ fontSize: 10, fontWeight: 600, color: active ? color : 'var(--text-muted)', letterSpacing: '0.03em' }}>
                    {p === 'openai' ? 'GPT' : p === 'claude' ? 'Claude' : 'Grok'}
                  </span>
                </div>
              );
            })}
          </div>
          <div style={cs.toolbarDivider} />
          <div style={cs.modeSelector}>
            {(['chat', 'thinktank', 'task'] as const).map(m => {
              const labels: Record<typeof m, string> = { chat: 'Chat', thinktank: 'Think Tank', task: 'Run as Task' };
              const isActive = localMode === m;
              const disabled = !hasKeys || (m === 'thinktank' && mode !== 'consensus');
              return (
                <button
                  key={m}
                  style={{ ...cs.modePill, ...(isActive ? cs.modePillActive : {}), ...(disabled ? cs.modePillDisabled : {}) }}
                  onClick={() => !disabled && setLocalMode(m)}
                  title={m === 'thinktank' && mode !== 'consensus' ? 'Add 2+ API keys to enable Think Tank' : labels[m]}
                  disabled={disabled}
                >
                  {labels[m]}
                </button>
              );
            })}
          </div>
          {localMode === 'thinktank' && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 3, marginLeft: 4 }}>
              {(Object.keys(INTENSITY_LABELS) as string[]).map(lvl => {
                const active = intensity === lvl;
                const color = INTENSITY_COLORS[lvl];
                return (
                  <button
                    key={lvl}
                    title={INTENSITY_LABELS[lvl]}
                    style={{
                      padding: '2px 8px', borderRadius: 10, fontSize: 10, fontWeight: 600, cursor: 'pointer',
                      background: active ? `${color}22` : 'transparent',
                      color: active ? color : 'var(--text-muted)',
                      border: `1px solid ${active ? `${color}66` : 'var(--border)'}`,
                      transition: 'all 0.2s',
                    }}
                    onClick={() => { setIntensity(lvl); localStorage.setItem('triforge-intensity', lvl); setIntensitySuggestion(null); }}
                  >
                    {INTENSITY_LABELS[lvl]}
                  </button>
                );
              })}
              {intensitySuggestion && (
                <button
                  title={`Apply suggested intensity: ${INTENSITY_LABELS[intensitySuggestion]}`}
                  style={{ marginLeft: 4, fontSize: 10, padding: '2px 8px', borderRadius: 10, background: `${INTENSITY_COLORS[intensitySuggestion]}18`, color: INTENSITY_COLORS[intensitySuggestion], border: `1px dashed ${INTENSITY_COLORS[intensitySuggestion]}66`, cursor: 'pointer', fontWeight: 600 }}
                  onClick={() => { setIntensity(intensitySuggestion); localStorage.setItem('triforge-intensity', intensitySuggestion); setIntensitySuggestion(null); }}
                >
                  Suggested: {INTENSITY_LABELS[intensitySuggestion]} ↵
                </button>
              )}
              {/* Deliberation Mode toggle — 3-phase cross-reaction before full response */}
              <button
                title={deliberateMode ? 'Deliberation Mode ON — Council debates in 3 rounds. Click to disable.' : 'Enable Deliberation Mode — Council deliberates in 3 rounds before responding.'}
                style={{
                  marginLeft: 8, fontSize: 10, padding: '2px 8px', borderRadius: 10,
                  background: deliberateMode ? 'rgba(99,102,241,0.15)' : 'transparent',
                  color: deliberateMode ? '#6366f1' : 'var(--text-muted)',
                  border: deliberateMode ? '1px solid rgba(99,102,241,0.4)' : '1px dashed rgba(255,255,255,0.12)',
                  cursor: 'pointer', fontWeight: deliberateMode ? 700 : 500,
                  transition: 'all 0.2s',
                }}
                onClick={() => {
                  const next = !deliberateMode;
                  setDeliberateMode(next);
                  localStorage.setItem('triforge-deliberate-mode', next ? 'on' : 'off');
                }}
              >
                ⬡ {deliberateMode ? 'Deliberate ON' : 'Deliberate'}
              </button>
            </div>
          )}
          {/* Deliberation phase indicator — shown while Council is deliberating */}
          {deliberationPhase && (
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', color: '#6366f1', textTransform: 'uppercase', padding: '4px 12px 2px', opacity: 0.85 }}>
              Council Deliberation · {deliberationPhase}
            </div>
          )}
          <div style={{ flex: 1 }} />
          {messages.length > 1 && (
            <button style={cs.clearBtn} onClick={clearChat} title="Clear chat">✕ Clear</button>
          )}
          {unlimited
            ? <span style={cs.quotaLabel}>∞ unlimited</span>
            : <button style={{ ...cs.quotaLabel, ...(atLimit ? cs.quotaAtLimit : {}), background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
                onClick={onUpgradeClick} title={atLimit ? 'Upgrade to send more' : `${remaining} messages left`}>
                {atLimit ? '⚠ Limit reached' : `${remaining} / ${msgLimit} msgs`}
              </button>
          }
        </div>

        {/* Row 2 — input */}
        <div style={cs.topBarInput}>
          <VoiceButton
            onTranscript={(text) => { setInput(text); inputRef.current?.focus(); }}
            onError={(err) => addSystemMsg(`Voice input: ${err}`)}
            disabled={sending}
            hasOpenAI={keyStatus.openai}
          />
          <div style={cs.inputWrapper}>
            {attachedFiles.map(f => (
              <div key={f.path} style={cs.attachedFileTag}>
                <span style={cs.attachedFileName}>{f.name}</span>
                <button style={cs.attachedFileRemove} onClick={() => setAttachedFiles(prev => prev.filter(x => x.path !== f.path))}>✕</button>
              </div>
            ))}
            <textarea
              ref={inputRef}
              style={cs.textarea}
              spellCheck={true}
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  localMode === 'task' ? runAsTask(input) : sendMessage(input);
                }
              }}
              placeholder={hasKeys
                ? localMode === 'task'
                  ? 'Describe your goal — TriForge will plan and execute it (Enter to run)'
                  : localMode === 'thinktank'
                    ? 'Ask the Council — all 3 models will respond independently (Enter to send)'
                    : 'Message TriForge AI (Enter to send, Shift+Enter for newline)'
                : 'Configure API keys in Settings to activate TriForge'
              }
              rows={1}
              disabled={!hasKeys || sending}
            />
          </div>
          <button
            style={{ ...cs.sendBtn, ...(!input.trim() || sending || !hasKeys ? cs.sendBtnDisabled : {}) }}
            onClick={() => localMode === 'task' ? runAsTask(input) : sendMessage(input)}
            disabled={!input.trim() || sending || !hasKeys}
            title={localMode === 'task' ? 'Run as Task' : 'Send'}
          >
            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
              <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
            </svg>
          </button>
          <div style={cs.toolbarDivider} />
          <button style={{ ...cs.actionBtn, ...(showQuickActions ? cs.actionBtnActive : {}) }}
            onClick={() => setShowQuickActions(s => !s)} title="Quick actions">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
            <span style={cs.actionLabel}>Quick</span>
          </button>
          <button style={{ ...cs.actionBtn, ...(showWorkflows ? cs.actionBtnActive : {}) }}
            onClick={() => { setShowWorkflows(s => !s); setShowQuickActions(false); }} title="Workflow templates">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
            <span style={cs.actionLabel}>Flows</span>
          </button>
          <button style={{ ...cs.actionBtn, ...(attachedFiles.length > 0 ? cs.actionBtnActive : {}) }}
            onClick={attachFile} title="Attach file" disabled={sending}>
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21.44 11.05l-9.19 9.19a6 6 0 0 1-8.49-8.49l9.19-9.19a4 4 0 0 1 5.66 5.66l-9.2 9.19a2 2 0 0 1-2.83-2.83l8.49-8.48"/>
            </svg>
            <span style={cs.actionLabel}>File</span>
          </button>
        </div>

        {/* Collapsible panels */}
        {showWorkflows && (
          <div ref={workflowPanelRef} style={cs.workflowPanel}>
            <div style={cs.workflowPanelTitle}>Think Tank Workflows</div>
            <div style={cs.workflowGrid}>
              {WORKFLOWS.map(w => (
                <button key={w.id} style={{ ...cs.workflowCard, ...(tier === 'free' ? cs.workflowCardLocked : {}) }} onClick={() => fireWorkflow(w.id)}>
                  <div>
                    <div style={cs.workflowLabel}>
                      {w.label}
                      {tier === 'free' && <span style={cs.workflowProBadge}>PRO</span>}
                    </div>
                    <div style={cs.workflowDesc}>{w.desc}</div>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}
        {showQuickActions && (
          <div ref={quickPanelRef} style={cs.quickActionsPanel}>
            {QUICK_ACTIONS.map(a => (
              <button key={a.label} style={cs.quickBtn} onClick={() => handleQuickAction(a)}>
                {a.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Strategic escalation suggestion — appears after 6+ exchanges with strategic keywords */}
      {escalationSuggested && onNavigateToCommand && (
        <div style={cs.escalationSuggestion}>
          <span style={cs.escalationText}>
            This conversation feels strategic. Run a full council analysis in ◉ Command?
          </span>
          <button style={cs.escalationBtn} onClick={onNavigateToCommand}>Switch to Command</button>
          <button style={cs.escalationDismiss} onClick={() => setEscalationSuggested(false)}>✕</button>
        </div>
      )}

      {/* WORKSPACE — 3-column grid */}
      <div style={cs.workspace}>
        {/* Left — Context Dock */}
        <div style={cs.leftPanel}>
          <div style={cs.panelSection}>
            <div style={cs.panelSectionTitle}>AI COUNCIL</div>
            {(['openai', 'claude', 'grok'] as const).map(p => {
              const active = keyStatus[p];
              const color = PROVIDER_COLORS[p];
              return (
                <div key={p} style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 5 }}>
                  <div style={{ width: 7, height: 7, borderRadius: '50%', background: active ? color : 'rgba(255,255,255,0.08)', flexShrink: 0 }} />
                  <span style={{ fontSize: 11, color: active ? 'var(--text-primary)' : 'var(--text-muted)', fontWeight: active ? 600 : 400 }}>
                    {PROVIDER_LABELS[p]}
                  </span>
                  {active && <span style={{ fontSize: 9, color, fontWeight: 700, marginLeft: 'auto', letterSpacing: '0.04em' }}>LIVE</span>}
                </div>
              );
            })}
          </div>
          <div style={cs.panelSection}>
            <div style={cs.panelSectionTitle}>SESSION</div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', lineHeight: 1.9 }}>
              <div>Mode: <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>
                {localMode === 'chat' ? 'Chat' : localMode === 'thinktank' ? 'Think Tank' : 'Task'}
              </span></div>
              <div>Messages: <span style={{ color: 'var(--text-secondary)', fontWeight: 600 }}>
                {messages.filter(m => m.role !== 'system').length}
              </span></div>
            </div>
          </div>
          <div style={cs.panelSection}>
            <div style={cs.panelSectionTitle}>ACTIONS</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
              <button style={cs.dockBtn} onClick={() => { setInput('Find my '); inputRef.current?.focus(); }}>Find Doc</button>
              <button style={cs.dockBtn} onClick={runOrganizeDownloads}>Organize Folder</button>
              <button style={cs.dockBtn} onClick={runPickAndPrint}>Print File</button>
              <button style={cs.dockBtn} onClick={async () => {
                const dir = await window.triforge.files.pickDir();
                if (dir) {
                  const result = await window.triforge.files.listDir(dir);
                  if (result.error) { addSystemMsg(`${result.error}`); return; }
                  addSystemMsg(`${dir}\n${result.subdirs.length} folders, ${result.files.length} files\n` +
                    result.files.slice(0, 8).map(f => `• ${f.name}`).join('\n') +
                    (result.files.length > 8 ? `\n…and ${result.files.length - 8} more` : ''));
                }
              }}>Browse Folder</button>
              <button
                style={{ ...cs.dockBtn, ...(voiceMode ? { color: 'var(--accent)', borderColor: 'rgba(99,102,241,0.4)' } : {}) }}
                onClick={() => {
                  const next = !voiceMode;
                  setVoiceMode(next);
                  localStorage.setItem('triforge-voice-mode', next ? 'on' : 'off');
                  if (!next) {
                    if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ''; }
                    window.speechSynthesis?.cancel();
                    setSpeaking(null); councilPresence.setState('idle');
                  }
                }}
              >
                {voiceMode ? 'Voice: On' : 'Voice: Off'}
              </button>
              <button
                style={{ ...cs.dockBtn, ...(voiceChatActive ? { color: 'var(--accent)', borderColor: 'rgba(99,102,241,0.4)' } : {}) }}
                onClick={() => {
                  const next = !voiceChatActive;
                  setVoiceChatActive(next);
                  // Live Voice Chat owns the mic — disable wake detection while active
                  if (next) { voiceService.disable(); } else { voiceService.enable(); }
                }}
              >
                {voiceChatActive ? 'Live Voice: On' : 'Voice Chat'}
              </button>
            </div>
          </div>
          <div style={cs.panelSection}>
            <div style={cs.panelSectionTitle}>HUSTLE MODE</div>
            <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.15)', textAlign: 'center', padding: '6px 0', fontStyle: 'italic', lineHeight: 1.5 }}>
              Autonomous task automation
            </div>
            <div style={{ fontSize: 9, color: 'rgba(255,255,255,0.1)', textAlign: 'center', letterSpacing: '0.08em', fontWeight: 700 }}>
              COMING SOON
            </div>
          </div>
        </div>

        {/* Center — Council Chamber (Think Tank) or Message Feed (Chat/Task) */}
        <div style={cs.centerPanel}>
          {localMode === 'thinktank' ? (
            <CouncilChamber
              latestMsg={latestConsensusMsg ?? null}
              thinking={consensusThinking}
              keyStatus={keyStatus}
              agreementMap={agreementMap}
              selectedProvider={selectedProvider}
              onAgreementChange={(p, v) => setAgreementMap(m => ({ ...m, [p]: v }))}
              onProposeAlternative={proposeAlternative}
              onSelectOutput={setSelectedProvider}
              onMergeProviders={mergeProviders}
              liveProviderTokens={liveProviderTokens}
              liveSynthesisText={liveSynthesisText || undefined}
              providerThinkingMessages={providerThinkingMessages}
              listening={councilListening}
            />
          ) : (
            <>
              {taskRunning && (
                <div style={cs.chamberWrap}>
                  <ForgeChamber visible={true} />
                </div>
              )}
              {voiceChatActive && (
                <VoiceConversation
                  hasGrok={keyStatus.grok}
                  hasOpenAI={keyStatus.openai}
                  sending={sending}
                  onTranscript={(text) => sendMessage(text)}
                  onAssistantTranscript={(text) => appendMsg({ id: crypto.randomUUID(), role: 'assistant', content: text, timestamp: new Date() })}
                />
              )}
              <div style={cs.messages}>
                {messages.map(msg => (
                  msg.consensusResponses
                    ? <ConsensusMessage key={msg.id} msg={msg} isSpeaking={speaking === msg.id}
                        canSpeak={true} onSpeak={() => speakMessage(msg.id, msg.content)}
                        tier={tier} onUpgradeClick={onUpgradeClick} />
                    : <MessageBubble key={msg.id} msg={msg} isSpeaking={speaking === msg.id}
                        canSpeak={true} onSpeak={() => speakMessage(msg.id, msg.content)}
                        onRetry={msg.isError && msg.role === 'assistant' ? () => {
                          const prev = messages[messages.indexOf(msg) - 1];
                          if (prev?.role === 'user') sendMessage(prev.content, msg.id);
                        } : undefined}
                        onRunAction={(action) => {
                          if (action === 'index_docs')                          runIndexDocs();
                          else if (action?.startsWith('search_docs:'))          runSearchDocs(action.slice('search_docs:'.length));
                          else if (action === 'find_photos')                    runFindPhotos();
                          else if (action === 'organize')                       runOrganizeDownloads();
                          else if (action === 'organize_deep')                  runOrganizeDeep();
                          else if (action === 'organize_desktop')               runOrganizeKnownDir('Desktop');
                          else if (action === 'organize_downloads')             runOrganizeKnownDir('Downloads');
                          else if (action === 'organize_documents')             runOrganizeKnownDir('Documents');
                          else if (action === 'search_photos')                  runSearchPhotos();
                          else if (action === 'find_similar')                   runFindSimilar();
                          else if (action === 'print')                          runPickAndPrint();
                        }} />
                ))}
                {sending && !consensusThinking && !singleModelStreaming && !taskRunning && <TypingIndicator />}
                <div ref={bottomRef} />
              </div>
            </>
          )}
        </div>

        {/* Right — Final Decision (Think Tank) or Latest Output (Chat/Task) */}
        <div style={cs.rightPanel}>
          {localMode === 'thinktank' ? (
            <>
              <div style={cs.rightHeader}>
                <span style={cs.rightTitle}>Final Decision</span>
                {latestConsensusMsg?.consensusResponses && (
                  <div style={{ display: 'flex', gap: 3, flexWrap: 'wrap' }}>
                    <button
                      style={{ ...cs.copyBtn, ...(selectedProvider === 'merge' ? { color: 'var(--accent)', borderColor: 'rgba(99,102,241,0.4)' } : {}) }}
                      onClick={() => setSelectedProvider('merge')}
                    >
                      Merged
                    </button>
                    {latestConsensusMsg.consensusResponses.map(r => {
                      const pid = r.provider.toLowerCase();
                      const color = PROVIDER_COLORS[pid] ?? 'var(--accent)';
                      return (
                        <button
                          key={pid}
                          style={{ ...cs.copyBtn, ...(selectedProvider === pid ? { color, borderColor: `${color}55` } : {}) }}
                          onClick={() => setSelectedProvider(pid)}
                        >
                          {PROVIDER_LABELS[pid] ?? r.provider}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
              {/* ForgeScore bar — confidence + risk + "why" */}
              {rfScore && rfBarC && rfRc && finalContent && (
                <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border)', background: 'rgba(0,0,0,0.12)', flexShrink: 0 }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
                    <span style={{ fontSize: 9, fontWeight: 800, letterSpacing: '0.08em', color: 'rgba(255,255,255,0.3)', textTransform: 'uppercase' as const }}>Confidence</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
                      <span style={{ fontSize: 14, fontWeight: 800, color: rfBarC }}>{rfScore.confidence}%</span>
                      <span style={{ fontSize: 9, fontWeight: 700, padding: '1px 6px', borderRadius: 4, color: rfRc, background: `${rfRc}18`, border: `1px solid ${rfRc}44` }}>{rfScore.risk} Risk</span>
                    </div>
                  </div>
                  <div style={{ height: 3, background: 'rgba(255,255,255,0.06)', borderRadius: 2, overflow: 'hidden', marginBottom: rfScore.agreement ? 7 : 0 }}>
                    <div style={{ height: '100%', width: `${rfScore.confidence}%`, background: rfBarC, borderRadius: 2, transition: 'width 0.8s ease' }} />
                  </div>
                  {rfScore.agreement && (
                    <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', lineHeight: 1.5, marginTop: 4 }}>
                      <strong style={{ color: '#10b981', fontWeight: 700 }}>Why:</strong> {rfScore.agreement.slice(0, 100)}
                    </div>
                  )}
                </div>
              )}
              {finalContent ? (
                <>
                  <div style={cs.rightContent}>
                    <MarkdownText text={finalContent} />
                  </div>
                  <div style={cs.applyRow}>
                    <button style={cs.applyBtn} onClick={() => { setInput(finalContent.slice(0, 500)); inputRef.current?.focus(); }}>
                      Use as Prompt →
                    </button>
                    <button style={{ ...cs.applyBtn, marginTop: 4, background: 'none', border: '1px solid var(--border)', color: 'var(--text-muted)' }} onClick={() => navigator.clipboard.writeText(finalContent)}>
                      Copy
                    </button>
                  </div>
                </>
              ) : (
                <div style={cs.rightIdle}>
                  <div style={{ fontSize: 28, opacity: 0.1, marginBottom: 8 }}>⬡</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Council output</div>
                  <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.18)', marginTop: 3 }}>appears here</div>
                </div>
              )}
            </>
          ) : latestAssistantMsg ? (
            <>
              <div style={cs.rightHeader}>
                <span style={cs.rightTitle}>Latest Output</span>
                <button style={cs.copyBtn} onClick={() => navigator.clipboard.writeText(latestAssistantMsg.content)}>Copy</button>
              </div>
              <div style={cs.rightContent}>
                {latestAssistantMsg.forgeScore && <ForgeScorePanel score={latestAssistantMsg.forgeScore} />}
                <MarkdownText text={latestAssistantMsg.content} />
              </div>
              <div style={cs.applyRow}>
                <button style={cs.applyBtn} onClick={() => { setInput(latestAssistantMsg.content.slice(0, 500)); inputRef.current?.focus(); }}>
                  Use as Prompt →
                </button>
              </div>
            </>
          ) : (
            <div style={cs.rightIdle}>
              <div style={{ fontSize: 28, opacity: 0.1, marginBottom: 8 }}>⬡</div>
              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Latest output</div>
              <div style={{ fontSize: 10, color: 'rgba(255,255,255,0.18)', marginTop: 3 }}>appears here</div>
            </div>
          )}
        </div>
      </div>

      {/* BOTTOM TIMELINE */}
      <div style={cs.bottomTimeline}>
        <SessionTimeline messages={messages} running={sending || consensusThinking || taskRunning} />
      </div>

      <audio ref={audioRef} style={{ display: 'none' }} />

      {/* HandsFreeVoice — headless, renders nothing, manages the Siri-style voice loop */}
      <HandsFreeVoice
        active={handsFreeMode}
        isSpeaking={!!speaking}
        onTranscript={(t) => {
          // "Open up desktop" exits voice session and returns to normal chat
          const lower = t.toLowerCase();
          if (lower.includes('open up desktop') || lower.includes('open desktop') || lower.includes('exit council')) {
            setHandsFreeMode(false);
            return;
          }
          setHandsFreeMode(false);
          setTimeout(() => setHandsFreeMode(true), 100);
          sendMessage(t);
        }}
        onStop={() => setHandsFreeMode(false)}
      />
    </div>
  );
}

// ── Provider error → human-readable message ───────────────────────────────────

function friendlyProviderError(provider: string, raw: string): React.ReactNode {
  const lower = raw.toLowerCase();

  // Billing / credits
  if (lower.includes('credit balance') || lower.includes('insufficient_quota') || lower.includes('billing')) {
    const links: Record<string, string> = {
      claude: 'https://console.anthropic.com/settings/billing',
      openai: 'https://platform.openai.com/settings/organization/billing',
      grok:   'https://console.x.ai/',
    };
    const link = links[provider.toLowerCase()];
    return (
      <span>
        No credits — add billing at{' '}
        <a href={link} onClick={e => { e.preventDefault(); window.triforge.system.openExternal(link); }}
          style={{ color: '#f59e0b', textDecoration: 'underline', cursor: 'pointer' }}>
          {link?.replace('https://', '')}
        </a>
      </span>
    );
  }

  // Rate limit / quota
  if (lower.includes('429') || lower.includes('quota') || lower.includes('rate limit') || lower.includes('too many')) {
    return 'Rate limit hit — wait a minute and try again, or upgrade your API plan.';
  }

  // Invalid key
  if (lower.includes('401') || lower.includes('invalid') && lower.includes('key') || lower.includes('authentication')) {
    return 'Invalid API key — re-enter it in Settings → API Keys.';
  }

  // Timeout
  if (lower.includes('timeout') || lower.includes('timed out')) {
    return 'Request timed out — the model took too long. Try again.';
  }

  // Generic — trim the raw JSON noise, show first 120 chars
  return raw.replace(/\{.*\}/s, '').trim() || raw.substring(0, 120);
}

// ── Consensus Message (Think Tank result) ─────────────────────────────────────

function ConsensusMessage({ msg, isSpeaking, canSpeak, onSpeak, tier, onUpgradeClick }: {
  msg: Message; isSpeaking: boolean; canSpeak: boolean; onSpeak: () => void;
  tier: string; onUpgradeClick: () => void;
}) {
  const [activeTab, setActiveTab] = useState(0);
  const [plan, setPlan] = useState<ExecutionPlan | null>(null);
  const [planLoading, setPlanLoading] = useState(false);
  const [planError, setPlanError] = useState<string | null>(null);
  const responses = msg.consensusResponses ?? [];
  const canUsePlans = tier === 'pro' || tier === 'business';

  const generatePlan = async () => {
    if (!canUsePlans) { onUpgradeClick(); return; }
    setPlanLoading(true);
    setPlanError(null);
    try {
      const result = await window.triforge.plan.generate(msg.content);
      if (result.error) {
        setPlanError(result.error);
      } else if (result.plan) {
        setPlan(result.plan as ExecutionPlan);
      }
    } catch (e) {
      setPlanError(e instanceof Error ? e.message : 'Failed to generate plan.');
    } finally {
      setPlanLoading(false);
    }
  };

  return (
    <div style={cs.bubbleRow}>
      <div style={cs.avatar}>TF</div>
      <div style={cs.consensusCard}>
        {/* Header */}
        <div style={cs.consensusHeader}>
          <span style={cs.consensusBadge}>Think Tank</span>
          {msg.debateIntensity && (
            <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 10, fontWeight: 600,
              background: `${INTENSITY_COLORS[msg.debateIntensity] ?? '#f59e0b'}18`,
              color: INTENSITY_COLORS[msg.debateIntensity] ?? '#f59e0b',
              border: `1px solid ${INTENSITY_COLORS[msg.debateIntensity] ?? '#f59e0b'}55`,
              marginLeft: 4 }}>
              {INTENSITY_LABELS[msg.debateIntensity] ?? msg.debateIntensity}
            </span>
          )}
          <span style={cs.consensusCount}>{responses.length} AI{responses.length > 1 ? 's' : ''} responded</span>
        </div>

        {/* Synthesis — primary content */}
        <div style={cs.synthesisBlock}>
          <div style={cs.synthesisLabel}>SYNTHESIS</div>
          <MarkdownText text={msg.content} />
        </div>

        {/* Failed providers warning */}
        {msg.failedProviders && msg.failedProviders.length > 0 && (
          <div style={{ fontSize: 11, color: '#f59e0b', background: 'rgba(245,158,11,0.08)', border: '1px solid rgba(245,158,11,0.2)', borderRadius: 6, padding: '6px 10px', marginBottom: 8 }}>
            {msg.failedProviders.map(f => (
              <div key={f.provider} style={{ marginBottom: 4 }}>
                <strong>{f.provider}</strong> did not respond — {friendlyProviderError(f.provider, f.error)}
              </div>
            ))}
          </div>
        )}

        {/* Forge Score trust panel */}
        {msg.forgeScore && <ForgeScorePanel score={msg.forgeScore} />}

        {/* Generate Execution Plan button — hidden when synthesis already has a direct [RUN:*] action */}
        {!plan && !/\[RUN:[^\]]+\]/i.test(msg.content) && (
          <div style={cs.planBtnRow}>
            <button style={{ ...cs.planBtn, ...(!canUsePlans ? cs.planBtnLocked : {}) }} onClick={generatePlan} disabled={planLoading}>
              {planLoading ? 'Generating plan…' : canUsePlans ? 'Generate Execution Plan' : 'Execution Plans — Pro'}
            </button>
            {planError && <span style={cs.planError}>{planError}</span>}
          </div>
        )}

        {/* Execution Plan (shown after generation) */}
        {plan && <ExecutionPlanView plan={plan} />}

        {/* Individual responses — tabs */}
        {responses.length > 1 && (
          <div style={cs.indivBlock}>
            <div style={cs.indivLabel}>INDIVIDUAL RESPONSES</div>
            <div style={cs.tabBar}>
              {responses.map((r, i) => {
                const roleLabel = COUNCIL_ROLE_LABELS[i];
                const providerLabel = PROVIDER_LABELS[r.provider.toLowerCase()] ?? r.provider;
                return (
                  <button key={r.provider} style={{ ...cs.tab, ...(activeTab === i ? cs.tabActive : {}) }}
                    onClick={() => setActiveTab(i)}>
                    <span style={{ color: PROVIDER_COLORS[r.provider.toLowerCase()] ?? 'var(--accent)' }}>●</span>
                    {' '}{roleLabel ? `${roleLabel} · ` : ''}{providerLabel}
                  </button>
                );
              })}
            </div>
            <div style={cs.tabContent}><MarkdownText text={responses[activeTab]?.text ?? ''} /></div>
          </div>
        )}

        {/* Meta */}
        <div style={cs.bubbleMeta}>
          <span style={cs.timestamp}>{msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          <button style={cs.speakBtn} onClick={() => navigator.clipboard.writeText(msg.content)} title="Copy synthesis">Copy</button>
          {canSpeak && (
            <button style={{ ...cs.speakBtn, ...(isSpeaking ? cs.speakBtnActive : {}) }} onClick={onSpeak} title="Read synthesis aloud">Read</button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Forge Score Panel ─────────────────────────────────────────────────────────

function ForgeScorePanel({ score }: { score: ForgeScore }) {
  const RISK_COLORS: Record<string, string> = { Low: '#10a37f', Medium: '#f59e0b', High: '#ef4444' };
  const c = RISK_COLORS[score.risk] ?? '#f59e0b';
  const barColor = score.confidence >= 75 ? '#10a37f' : score.confidence >= 50 ? '#f59e0b' : '#ef4444';
  return (
    <div style={cs.forgePanel}>
      {/* Escalation banner */}
      {score.escalatedFrom && (
        <div style={{ fontSize: 10, color: '#f97316', background: 'rgba(249,115,22,0.08)', border: '1px solid rgba(249,115,22,0.25)', borderRadius: 6, padding: '5px 10px', marginBottom: 8 }}>
          Council auto-escalated from {INTENSITY_LABELS[score.escalatedFrom] ?? score.escalatedFrom} → Critical — risk signals detected
        </div>
      )}
      <div style={cs.forgePanelHeader}>
        <span style={cs.forgePanelTitle}>FORGE SCORE</span>
        <span style={{ ...cs.riskBadge, background: c + '22', color: c, border: `1px solid ${c}55` }}>
          {score.risk} Risk
        </span>
      </div>
      <div style={cs.confRow}>
        <span style={cs.confLabel}>Confidence</span>
        <div style={cs.confTrack}>
          <div style={{ ...cs.confBar, width: `${score.confidence}%`, background: barColor }} />
        </div>
        {score.initialConfidence !== undefined
          ? <span style={cs.confPct}>{score.initialConfidence}% → {score.confidence}%</span>
          : <span style={cs.confPct}>{score.confidence}%</span>
        }
      </div>
      {score.agreement    && <ForgeRow icon="✓" label="Agreement"    text={score.agreement} />}
      {score.disagreement && <ForgeRow icon="✗" label="Disagreement" text={score.disagreement} />}
      {score.assumptions  && <ForgeRow icon="≈" label="Assumptions"  text={score.assumptions} />}
      {score.verify       && <ForgeRow icon="→" label="Verify"       text={score.verify} />}
    </div>
  );
}

function ForgeRow({ icon, label, text }: { icon: string; label: string; text: string }) {
  return (
    <div style={cs.forgeRow}>
      <span style={{ width: 18, flexShrink: 0 }}>{icon}</span>
      <span style={cs.forgeRowLabel}>{label}: </span>
      <span style={cs.forgeRowText}>{text}</span>
    </div>
  );
}

// ── RUN tag parser ────────────────────────────────────────────────────────────

const RUN_TAG_RE = /\[RUN:((?:search_docs:[^\]]+)|index_docs|find_photos|organize|organize_deep|organize_desktop|organize_downloads|organize_documents|search_photos|find_similar|print)\]/i;

const RUN_LABELS: Record<string, string> = {
  index_docs:           'Index Documents',
  find_photos:          'Scan for Photos',
  organize:             'Organize Folder…',
  organize_deep:        'Deep Organize (All Sub-folders)…',
  organize_desktop:     'Organize Desktop Now',
  organize_downloads:   'Organize Downloads Now',
  organize_documents:   'Organize Documents Now',
  search_photos:        'Search Photos by Name',
  find_similar:         'Find Similar Photos',
  print:                'Choose File & Print',
};

// ── Photo Results Grid ────────────────────────────────────────────────────────

function PhotoGrid({ photos }: { photos: PhotoFile[] }) {
  const [filing, setFiling] = React.useState(false);

  const open   = (p: PhotoFile) => window.triforge.files.openFile(p.path);
  const reveal = (p: PhotoFile) => window.triforge.files.showInFolder(p.path);

  const fileAll = async () => {
    const dest = await window.triforge.files.pickDir();
    if (!dest) return;
    setFiling(true);
    try {
      const result = await window.triforge.files.moveFiles(photos.map(p => p.path), dest);
      alert(`Moved ${result.moved} photo${result.moved !== 1 ? 's' : ''} to ${dest}.${result.errors.length ? `\n${result.errors.length} skipped.` : ''}`);
    } finally { setFiling(false); }
  };

  return (
    <div style={{ marginTop: 8 }}>
      {photos.slice(0, 50).map(p => (
        <div key={p.path} style={pgStyles.row}>
          <div style={pgStyles.icon}>◻</div>
          <div style={pgStyles.info}>
            <div style={pgStyles.name}>{p.name}</div>
            <div style={pgStyles.meta}>
              {new Date(p.modified).toLocaleDateString()} · {(p.size / 1024).toFixed(0)} KB
            </div>
          </div>
          <button style={pgStyles.btn} onClick={() => open(p)}>Open</button>
          <button style={pgStyles.btn} onClick={() => reveal(p)}>Reveal</button>
        </div>
      ))}
      {photos.length > 50 && (
        <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>…and {photos.length - 50} more</div>
      )}
      <button
        style={{ ...pgStyles.btn, marginTop: 10, background: 'rgba(99,102,241,0.18)', width: '100%' }}
        onClick={fileAll}
        disabled={filing}
      >
        {filing ? 'Moving…' : `Move all ${photos.length} here…`}
      </button>
    </div>
  );
}

const pgStyles = {
  row:  { display: 'flex', alignItems: 'center', gap: 8, padding: '5px 0', borderBottom: '1px solid rgba(255,255,255,0.05)' } as React.CSSProperties,
  icon: { fontSize: 18, flexShrink: 0 } as React.CSSProperties,
  info: { flex: 1, minWidth: 0 } as React.CSSProperties,
  name: { fontSize: 12, fontWeight: 600, color: 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  meta: { fontSize: 11, color: 'var(--text-muted)', marginTop: 1 },
  btn:  { fontSize: 11, padding: '3px 9px', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 4, color: 'var(--text-secondary)', cursor: 'pointer', flexShrink: 0 } as React.CSSProperties,
};

// ── Document Results ──────────────────────────────────────────────────────────

function DocResultsMessage({ query, results }: { query: string; results: DocResult[] }) {
  const open   = (p: string) => window.triforge.files.openFile(p);
  const reveal = (p: string) => window.triforge.files.showInFolder(p);

  const confidenceColor = (score: number) =>
    score >= 80 ? '#10b981' : score >= 50 ? '#f59e0b' : '#ef4444';

  return (
    <div style={drStyles.wrap}>
      <div style={drStyles.header}>
        <span style={drStyles.title}>Document Search — "{query}"</span>
        <span style={drStyles.privacy}>🔐 All indexing is local — no files leave your device</span>
      </div>
      {results.length === 0 ? (
        <div style={drStyles.empty}>
          No documents matched "{query}". Try different keywords, or re-index with Index Documents.
        </div>
      ) : (
        results.map((doc, i) => (
          <div key={doc.path} style={{ ...drStyles.row, borderTop: i > 0 ? '1px solid rgba(255,255,255,0.06)' : 'none' }}>
            <div style={drStyles.scoreBar}>
              <div style={{ ...drStyles.scoreBarFill, width: `${doc.matchScore}%`, background: confidenceColor(doc.matchScore) }} />
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
              <div>
                <div style={{ ...drStyles.docType, color: confidenceColor(doc.matchScore) }}>
                  {doc.matchScore}% · {doc.docTypes[0]?.type ?? 'Document'}
                </div>
                <div style={drStyles.docName}>{doc.name}</div>
                <div style={drStyles.docMeta}>
                  {new Date(doc.modified).toLocaleDateString()} · {doc.size > 1024 * 1024
                    ? `${(doc.size / 1024 / 1024).toFixed(1)} MB`
                    : `${(doc.size / 1024).toFixed(0)} KB`}
                </div>
              </div>
              <div style={drStyles.actions}>
                <button style={drStyles.btn} onClick={() => open(doc.path)}>Open</button>
                <button style={drStyles.btn} onClick={() => reveal(doc.path)}>Show in Folder</button>
              </div>
            </div>
          </div>
        ))
      )}
      <div style={drStyles.footer}>{results.length} result{results.length !== 1 ? 's' : ''} found</div>
    </div>
  );
}

const drStyles = {
  wrap:         { background: 'rgba(99,102,241,0.06)', border: '1px solid rgba(99,102,241,0.18)', borderRadius: 10, overflow: 'hidden', fontSize: 13 } as React.CSSProperties,
  header:       { padding: '10px 14px 8px', borderBottom: '1px solid rgba(255,255,255,0.06)', display: 'flex', flexDirection: 'column' as const, gap: 3 },
  title:        { fontWeight: 600, color: 'var(--text-primary)', fontSize: 13 } as React.CSSProperties,
  privacy:      { fontSize: 11, color: 'rgba(255,255,255,0.35)', letterSpacing: '0.02em' } as React.CSSProperties,
  row:          { padding: '10px 14px' } as React.CSSProperties,
  scoreBar:     { height: 3, background: 'rgba(255,255,255,0.08)', borderRadius: 2, marginBottom: 8, overflow: 'hidden' } as React.CSSProperties,
  scoreBarFill: { height: '100%', borderRadius: 2, transition: 'width 600ms ease' } as React.CSSProperties,
  docType:      { fontSize: 11, fontWeight: 700, letterSpacing: '0.04em', textTransform: 'uppercase' as const, marginBottom: 2 },
  docName:      { fontWeight: 500, color: 'var(--text-primary)', marginBottom: 2 } as React.CSSProperties,
  docMeta:      { fontSize: 11, color: 'var(--text-muted)' } as React.CSSProperties,
  actions:      { display: 'flex', gap: 6, flexShrink: 0 } as React.CSSProperties,
  btn:          { fontSize: 11, padding: '4px 10px', background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.12)', borderRadius: 5, color: 'var(--text-secondary)', cursor: 'pointer', whiteSpace: 'nowrap' as const },
  empty:        { padding: '12px 14px', color: 'var(--text-muted)', fontSize: 12 } as React.CSSProperties,
  footer:       { padding: '6px 14px', borderTop: '1px solid rgba(255,255,255,0.06)', fontSize: 11, color: 'rgba(255,255,255,0.3)' } as React.CSSProperties,
};

// ── Regular MessageBubble ─────────────────────────────────────────────────────

function MessageBubble({ msg, isSpeaking, canSpeak, onSpeak, onRetry, onRunAction }: {
  msg: Message; isSpeaking: boolean; canSpeak: boolean; onSpeak: () => void;
  onRetry?: () => void;
  onRunAction?: (action: string) => void;
}) {
  const isUser = msg.role === 'user';
  const isSystem = msg.role === 'system';

  if (isSystem) {
    return (
      <div style={cs.systemMsg}>
        {msg.docResults !== undefined
          ? <DocResultsMessage query={msg.docQuery ?? ''} results={msg.docResults} />
          : <><span style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</span>{msg.photos && msg.photos.length > 0 && <PhotoGrid photos={msg.photos} />}</>
        }
      </div>
    );
  }

  // Strip [RUN:xxx] tag from displayed text and capture the action
  const runMatch = !isUser ? RUN_TAG_RE.exec(msg.content) : null;
  const displayContent = runMatch ? msg.content.replace(runMatch[0], '').trimEnd() : msg.content;
  const runAction = runMatch ? runMatch[1].toLowerCase() : null;

  return (
    <div style={{ ...cs.bubbleRow, ...(isUser ? cs.bubbleRowUser : {}) }}>
      {!isUser && <div style={cs.avatar}>TF</div>}
      <div style={{ ...cs.bubble, ...(isUser ? cs.bubbleUser : cs.bubbleAi), ...(msg.isError ? cs.bubbleError : {}) }}>
        {isUser
          ? <div style={cs.bubbleContent}>{displayContent}</div>
          : msg.streaming && !displayContent
            ? <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>▌</span>
            : <><MarkdownText text={displayContent} />{msg.streaming && <span style={cs.streamCursor}>▌</span>}</>
        }
        {msg.executionPlan && (
          <ExecutionPlanView plan={msg.executionPlan} autoRun={true} />
        )}
        {runAction && onRunAction && (
          <button
            style={cs.runActionBtn}
            onClick={() => onRunAction(runAction)}
          >
            ▶ {runAction.startsWith('search_docs:') ? `Search: "${runAction.slice('search_docs:'.length)}"` : (RUN_LABELS[runAction] ?? 'Run')}
          </button>
        )}
        <div style={cs.bubbleMeta}>
          {msg.provider && (
            <span style={{ ...cs.providerTag, color: PROVIDER_COLORS[msg.provider.toLowerCase()] ?? 'var(--text-muted)' }}>
              {PROVIDER_LABELS[msg.provider.toLowerCase()] ?? msg.provider}
            </span>
          )}
          <span style={cs.timestamp}>{msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          {!isUser && (
            <button style={cs.speakBtn} onClick={() => navigator.clipboard.writeText(msg.content)} title="Copy">Copy</button>
          )}
          {!isUser && canSpeak && (
            <button style={{ ...cs.speakBtn, ...(isSpeaking ? cs.speakBtnActive : {}) }} onClick={onSpeak} title="Read aloud">Read</button>
          )}
          {onRetry && (
            <button style={cs.retryBtn} onClick={onRetry} title="Retry">Retry</button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Typing / Thinking indicators ──────────────────────────────────────────────

function TypingIndicator() {
  return (
    <div style={cs.bubbleRow}>
      <div style={cs.avatar}>TF</div>
      <div style={{ ...cs.bubble, ...cs.bubbleAi, padding: '12px 16px' }}>
        <div style={cs.typingDots}><span /><span /><span /></div>
      </div>
    </div>
  );
}


// ── Helpers ───────────────────────────────────────────────────────────────────

function getWelcomeMessage(mode: string, keys: Record<string, boolean>): string {
  const active = Object.entries(keys).filter(([, v]) => v).map(([k]) => PROVIDER_LABELS[k] ?? k);
  if (active.length === 0) {
    return 'TriForge requires at least one AI provider key to operate. Configure API keys in Settings → API Keys to activate the council.';
  }
  if (mode === 'consensus') {
    return `Council active. ${active.join(', ')} are all online. Every query is processed by all ${active.length} models independently — then synthesized into a single verified answer with a Forge Score.`;
  }
  if (active.length > 1) {
    return `${active.join(' and ')} are active. Add the remaining provider key to enable full three-model consensus mode.`;
  }
  return `Running on ${active[0]}. Add additional provider keys in Settings to enable Think Tank consensus mode.`;
}

// ── Profile Status Strip ──────────────────────────────────────────────────────

const PROFILE_DISPLAY: Record<string, { name: string }> = {
  restaurant: { name: 'Restaurant & Food Service' },
  trucking:   { name: 'Trucking & Freight' },
  consultant: { name: 'Consultant & Agency' },
};

function ProfileStatusStrip({ profileId, onSwitch, onDeactivate }: {
  profileId: string;
  onSwitch: () => void;
  onDeactivate: () => void;
}) {
  const info = PROFILE_DISPLAY[profileId] ?? { name: profileId };
  return (
    <div style={stripStyle.bar}>
      <span style={stripStyle.label}>Active Profile: <strong>{info.name}</strong></span>
      <div style={stripStyle.actions}>
        <button style={stripStyle.btn} onClick={onSwitch}>Switch Profile</button>
        <button style={stripStyle.btn} onClick={onDeactivate}>Deactivate</button>
      </div>
    </div>
  );
}

const stripStyle: Record<string, React.CSSProperties> = {
  bar: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '6px 16px', background: 'var(--accent-dim)',
    borderBottom: '1px solid var(--accent)33', flexShrink: 0,
  },
  label: { fontSize: 12, color: 'var(--text-secondary)' },
  actions: { display: 'flex', gap: 8 },
  btn: {
    background: 'none', border: '1px solid var(--accent)55',
    color: 'var(--accent)', borderRadius: 5, padding: '3px 10px',
    fontSize: 11, fontWeight: 600, cursor: 'pointer',
  },
};

// ── Markdown Renderer ─────────────────────────────────────────────────────────

function inlineFormat(text: string): React.ReactNode {
  // Matches **bold**, *italic*, `inline code` in order of appearance
  const INLINE_RE = /(\*\*([^*\n]+)\*\*|\*([^*\n]+)\*|`([^`\n]+)`)/g;
  const parts: React.ReactNode[] = [];
  let last = 0;
  let idx = 0;
  let m: RegExpExecArray | null;
  while ((m = INLINE_RE.exec(text)) !== null) {
    if (m.index > last) parts.push(text.slice(last, m.index));
    if (m[2] !== undefined) parts.push(<strong key={idx++}>{m[2]}</strong>);
    else if (m[3] !== undefined) parts.push(<em key={idx++} style={{ opacity: 0.85 }}>{m[3]}</em>);
    else if (m[4] !== undefined) parts.push(<code key={idx++} style={mdSt.inlineCode}>{m[4]}</code>);
    last = m.index + m[0].length;
  }
  if (last < text.length) parts.push(text.slice(last));
  return parts.length === 0 ? '' : parts.length === 1 ? parts[0] : <>{parts}</>;
}

function MarkdownText({ text }: { text: string }) {
  const lines = text.split('\n');
  const elements: React.ReactNode[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    // Fenced code block
    if (line.startsWith('```')) {
      const lang = line.slice(3).trim();
      const codeLines: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith('```')) { codeLines.push(lines[i]); i++; }
      elements.push(
        <pre key={elements.length} style={mdSt.codeBlock}>
          {lang && <span style={mdSt.codeLang}>{lang}</span>}
          <code style={mdSt.codeContent}>{codeLines.join('\n')}</code>
        </pre>
      );
      i++; continue;
    }
    const h3 = line.match(/^###\s+(.+)/);
    if (h3) { elements.push(<h3 key={elements.length} style={mdSt.h3}>{inlineFormat(h3[1])}</h3>); i++; continue; }
    const h2 = line.match(/^##\s+(.+)/);
    if (h2) { elements.push(<h2 key={elements.length} style={mdSt.h2}>{inlineFormat(h2[1])}</h2>); i++; continue; }
    const h1 = line.match(/^#\s+(.+)/);
    if (h1) { elements.push(<h1 key={elements.length} style={mdSt.h1}>{inlineFormat(h1[1])}</h1>); i++; continue; }
    if (/^---+$/.test(line.trim())) { elements.push(<hr key={elements.length} style={mdSt.hr} />); i++; continue; }
    if (/^[-*]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*]\s+/.test(lines[i])) { items.push(lines[i].replace(/^[-*]\s+/, '')); i++; }
      elements.push(<ul key={elements.length} style={mdSt.ul}>{items.map((it, j) => <li key={j} style={mdSt.li}>{inlineFormat(it)}</li>)}</ul>);
      continue;
    }
    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i])) { items.push(lines[i].replace(/^\d+\.\s+/, '')); i++; }
      elements.push(<ol key={elements.length} style={mdSt.ol}>{items.map((it, j) => <li key={j} style={mdSt.li}>{inlineFormat(it)}</li>)}</ol>);
      continue;
    }
    if (line.startsWith('> ')) { elements.push(<blockquote key={elements.length} style={mdSt.blockquote}>{inlineFormat(line.slice(2))}</blockquote>); i++; continue; }
    if (line.trim() === '') { elements.push(<div key={elements.length} style={{ height: 6 }} />); i++; continue; }
    elements.push(<p key={elements.length} style={mdSt.p}>{inlineFormat(line)}</p>);
    i++;
  }
  return <div style={mdSt.wrapper}>{elements}</div>;
}

const mdSt: Record<string, React.CSSProperties> = {
  wrapper: { fontSize: 14, lineHeight: 1.65, color: 'var(--text-primary)' },
  h1: { fontSize: 17, fontWeight: 700, color: 'var(--text-primary)', margin: '12px 0 5px', borderBottom: '1px solid var(--border)', paddingBottom: 5 },
  h2: { fontSize: 15, fontWeight: 700, color: 'var(--text-primary)', margin: '10px 0 4px' },
  h3: { fontSize: 12, fontWeight: 700, color: 'var(--accent)', margin: '10px 0 3px', textTransform: 'uppercase' as const, letterSpacing: '0.06em' },
  p:  { margin: '3px 0', lineHeight: 1.65 },
  ul: { margin: '4px 0', paddingLeft: 22 },
  ol: { margin: '4px 0', paddingLeft: 22 },
  li: { margin: '2px 0', lineHeight: 1.6 },
  hr: { border: 'none', borderTop: '1px solid var(--border)', margin: '10px 0' },
  blockquote: { margin: '6px 0', paddingLeft: 12, borderLeft: '3px solid var(--accent)88', color: 'var(--text-secondary)', fontStyle: 'italic' as const },
  codeBlock: { background: '#09090d', border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, padding: '12px 14px', margin: '8px 0', overflow: 'auto' as const },
  codeLang: { fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' as const, color: 'var(--accent)', display: 'block', marginBottom: 6 },
  codeContent: { fontFamily: 'Consolas, "Cascadia Code", monospace', fontSize: 12.5, color: '#c9d1d9', display: 'block', whiteSpace: 'pre' as const, lineHeight: 1.55 },
  inlineCode: { background: 'rgba(255,255,255,0.07)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 4, padding: '1px 5px', fontFamily: 'Consolas, "Cascadia Code", monospace', fontSize: 12.5, color: '#c9d1d9' },
};

// ── Session Timeline ──────────────────────────────────────────────────────────

function SessionTimeline({ messages, running }: { messages: Message[]; running: boolean }) {
  const events = messages.filter(m => m.role !== 'system').slice(-10).map(m => ({
    isUser: m.role === 'user',
    label: m.role === 'user'
      ? (m.content.slice(0, 22) + (m.content.length > 22 ? '…' : ''))
      : m.consensusResponses ? '⬡ Think Tank' : '◈ Response',
    time: new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
    isConsensus: !!m.consensusResponses,
  }));
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 0, height: '100%', padding: '0 16px', overflowX: 'auto' }}>
      {running && (
        <span style={{ fontSize: 9, fontWeight: 700, padding: '2px 7px', borderRadius: 10,
          background: 'var(--accent)22', color: 'var(--accent)', border: '1px solid var(--accent)44',
          marginRight: 8, flexShrink: 0, letterSpacing: '0.06em' }}>
          RUNNING
        </span>
      )}
      {events.map((ev, i) => (
        <React.Fragment key={i}>
          {i > 0 && <div style={{ width: 12, height: 1, background: 'var(--border)', flexShrink: 0 }} />}
          <div style={{
            padding: '2px 8px', borderRadius: 6, flexShrink: 0,
            background: ev.isConsensus ? 'var(--accent)11' : ev.isUser ? 'rgba(255,255,255,0.04)' : 'transparent',
            border: `1px solid ${ev.isConsensus ? 'var(--accent)33' : 'var(--border)'}`,
          }}>
            <div style={{ fontSize: 9, color: 'var(--text-muted)', marginBottom: 1 }}>{ev.time}</div>
            <div style={{ fontSize: 9, fontWeight: 600, whiteSpace: 'nowrap' as const,
              color: ev.isConsensus ? 'var(--accent)' : ev.isUser ? 'var(--text-secondary)' : 'var(--text-muted)' }}>
              {ev.label}
            </div>
          </div>
        </React.Fragment>
      ))}
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const cs: Record<string, React.CSSProperties> = {
  container: { display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' },

  escalationSuggestion: {
    display: 'flex', alignItems: 'center', gap: 10, padding: '7px 14px',
    background: 'rgba(139,92,246,0.06)', borderTop: '1px solid rgba(139,92,246,0.15)', flexShrink: 0,
  },
  escalationText: { fontSize: 11, color: 'var(--text-muted)', flex: 1 },
  escalationBtn: {
    fontSize: 10, fontWeight: 600, padding: '3px 10px', borderRadius: 5,
    background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.35)',
    color: '#a78bfa', cursor: 'pointer', flexShrink: 0,
  },
  escalationDismiss: {
    fontSize: 11, background: 'none', border: 'none', color: 'var(--text-muted)',
    cursor: 'pointer', padding: '2px 5px', lineHeight: 1,
  },

  missionBanner: {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '8px 14px', gap: 12,
    background: 'rgba(139,92,246,0.07)',
    borderLeft: '3px solid #8b5cf6',
    borderBottom: '1px solid rgba(139,92,246,0.2)',
    flexShrink: 0,
  },
  missionBannerLeft: { display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 },
  missionBannerLabel: {
    fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' as const,
    color: '#a78bfa', flexShrink: 0,
  },
  missionBannerObjective: {
    fontSize: 11, color: 'var(--text-secondary)', fontWeight: 500,
    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const, flex: 1,
  },
  missionBannerMeta: {
    fontSize: 10, color: 'var(--text-muted)', flexShrink: 0,
  },
  missionBannerActions: { display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 },
  missionBannerAsk: {
    fontSize: 10, fontWeight: 600, padding: '3px 10px', borderRadius: 5,
    background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.35)',
    color: '#a78bfa', cursor: 'pointer',
  },
  missionBannerDismiss: {
    fontSize: 11, background: 'none', border: 'none', color: 'var(--text-muted)',
    cursor: 'pointer', padding: '2px 5px', lineHeight: 1,
  },

  statusBar: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0, background: 'var(--bg-surface)' },
  statusDots: { display: 'flex', gap: 5 },
  dot: { width: 9, height: 9, borderRadius: '50%', transition: 'background 0.3s' },
  modeLabel: { fontSize: 11, color: 'var(--text-muted)', marginLeft: 4, fontWeight: 500 },
  modeLabelConsensus: { color: 'var(--accent)', fontWeight: 700 },
  modeSelector: { display: 'flex', gap: 4 },
  modePill: {
    fontSize: 10, fontWeight: 600, padding: '3px 9px', borderRadius: 20,
    border: '1px solid var(--border)', background: 'none',
    color: 'var(--text-muted)', cursor: 'pointer', transition: 'all 0.15s',
  },
  modePillActive: {
    background: 'var(--accent)', color: '#fff', border: '1px solid var(--accent)',
  },
  modePillDisabled: { opacity: 0.35, cursor: 'not-allowed' },
  quotaLabel: { fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 },
  quotaAtLimit: { color: '#ef4444', fontWeight: 700 },
  clearBtn: { fontSize: 11, background: 'none', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text-muted)', padding: '2px 8px', cursor: 'pointer', marginRight: 4 },

  messages: { flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: 12 },

  systemMsg: { textAlign: 'center' as const, color: 'var(--text-secondary)', fontSize: 13, padding: '8px 16px', background: 'var(--bg-elevated)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', alignSelf: 'center', maxWidth: '85%' },

  bubbleRow: { display: 'flex', gap: 10, alignItems: 'flex-end', maxWidth: '85%' },
  bubbleRowUser: { alignSelf: 'flex-end', flexDirection: 'row-reverse' as const },
  avatar: { width: 28, height: 28, borderRadius: '50%', background: 'linear-gradient(135deg, var(--accent), var(--purple))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 },
  bubble: { borderRadius: 'var(--radius)', padding: '10px 14px', maxWidth: '100%', wordBreak: 'break-word' as const },
  bubbleUser: { background: 'var(--user-bubble)', color: 'var(--text-primary)' },
  bubbleAi: { background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-primary)' },
  bubbleError: { border: '1px solid #ef444444', background: '#ef44440d' },
  bubbleContent: { fontSize: 14, lineHeight: 1.6, whiteSpace: 'pre-wrap' as const },
  bubbleMeta: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 },
  providerTag: { fontSize: 10, fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.06em' },
  timestamp: { fontSize: 11, color: 'var(--text-muted)' },
  speakBtn: { fontSize: 12, background: 'none', border: 'none', cursor: 'pointer', opacity: 0.5, padding: '0 2px' },
  speakBtnActive: { opacity: 1 },
  retryBtn: { fontSize: 11, background: 'none', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--accent)', padding: '2px 8px', cursor: 'pointer' },
  streamCursor: { display: 'inline-block', color: 'var(--accent)', fontWeight: 400, animation: 'blink 1s step-end infinite', marginLeft: 1 },
  runActionBtn: { display: 'inline-block', marginTop: 10, padding: '7px 16px', fontSize: 13, fontWeight: 600, background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 8, cursor: 'pointer' },

  typingDots: { display: 'flex', gap: 4, alignItems: 'center' },
  // Consensus card
  consensusCard: {
    background: 'var(--bg-elevated)', border: '1px solid var(--accent)', borderRadius: 12,
    overflow: 'hidden', maxWidth: '100%', display: 'flex', flexDirection: 'column',
  },
  consensusHeader: {
    display: 'flex', alignItems: 'center', gap: 10, padding: '10px 14px',
    background: 'linear-gradient(135deg, var(--accent)22, var(--purple)22)',
    borderBottom: '1px solid var(--accent)44',
  },
  consensusBadge: { fontSize: 12, fontWeight: 800, color: 'var(--accent)', letterSpacing: '0.04em' },
  consensusCount: { fontSize: 11, color: 'var(--text-muted)' },

  synthesisBlock: { padding: '14px 16px', borderBottom: '1px solid var(--border)' },
  synthesisLabel: { fontSize: 9, fontWeight: 800, color: 'var(--accent)', letterSpacing: '0.12em', textTransform: 'uppercase' as const, marginBottom: 8 },
  synthesisText: { fontSize: 14, lineHeight: 1.7, color: 'var(--text-primary)', whiteSpace: 'pre-wrap' as const },

  indivBlock: { padding: '12px 14px 0' },
  indivLabel: { fontSize: 9, fontWeight: 700, color: 'var(--text-muted)', letterSpacing: '0.1em', textTransform: 'uppercase' as const, marginBottom: 8 },
  tabBar: { display: 'flex', gap: 4, marginBottom: 10 },
  tab: { fontSize: 11, fontWeight: 600, padding: '4px 10px', borderRadius: 20, background: 'var(--bg-base)', border: '1px solid var(--border)', color: 'var(--text-secondary)', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4 },
  tabActive: { background: 'var(--accent)22', border: '1px solid var(--accent)55', color: 'var(--text-primary)' },
  tabContent: { fontSize: 13, lineHeight: 1.6, color: 'var(--text-secondary)', paddingBottom: 12, whiteSpace: 'pre-wrap' as const },

  quickActionsPanel: { display: 'flex', flexWrap: 'wrap' as const, gap: 6, padding: '10px 16px', borderTop: '1px solid var(--border)', background: 'var(--bg-surface)', flexShrink: 0 },
  quickBtn: { background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 20, color: 'var(--text-secondary)', fontSize: 12, padding: '6px 14px', cursor: 'pointer' },

  actionToolbar: { display: 'flex', alignItems: 'center', gap: 4, padding: '6px 16px 4px', flexShrink: 0, overflowX: 'auto' as const, borderTop: '1px solid var(--border)' },
  toolbarDivider: { width: 1, height: 16, background: 'var(--border)', flexShrink: 0, margin: '0 4px' },
  actionBtn: { display: 'flex', alignItems: 'center', gap: 4, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 7, color: 'var(--text-secondary)', fontSize: 12, padding: '5px 10px', cursor: 'pointer', whiteSpace: 'nowrap' as const, flexShrink: 0 },
  actionBtnActive: { background: 'var(--accent)22', border: '1px solid var(--accent)', color: 'var(--accent)' },
  actionLabel: { fontSize: 11, fontWeight: 500 },

  inputArea: { display: 'flex', alignItems: 'flex-end', gap: 10, padding: '10px 16px 12px', background: 'var(--bg-surface)', flexShrink: 0 },
  inputWrapper: { flex: 1 },
  attachedFileTag: { display: 'flex', alignItems: 'center', gap: 6, padding: '4px 8px', background: 'rgba(99,102,241,0.12)', border: '1px solid rgba(99,102,241,0.3)', borderRadius: 5, marginBottom: 4 },
  attachedFileName: { fontSize: 11, color: 'var(--accent)', fontWeight: 500, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' as const },
  attachedFileRemove: { fontSize: 11, background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer', padding: '0 2px', lineHeight: 1 },
  textarea: { width: '100%', background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)', fontSize: 14, padding: '10px 14px', resize: 'none' as const, outline: 'none', fontFamily: 'var(--font)', lineHeight: 1.5, maxHeight: 120, overflowY: 'auto' as const },
  sendBtn: { width: 40, height: 40, borderRadius: '50%', background: 'linear-gradient(135deg, var(--accent), var(--purple))', border: 'none', color: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, transition: 'opacity 0.2s' },
  sendBtnDisabled: { opacity: 0.3, cursor: 'not-allowed' },

  // Workflow panel
  workflowPanel: { borderTop: '1px solid var(--border)', background: 'var(--bg-surface)', padding: '12px 16px', flexShrink: 0 },
  workflowPanelTitle: { fontSize: 11, color: 'var(--accent)', fontWeight: 700 as const, marginBottom: 10, textTransform: 'uppercase' as const, letterSpacing: '0.06em' },
  workflowGrid: { display: 'flex', flexDirection: 'column' as const, gap: 6 },
  workflowCard: { display: 'flex', alignItems: 'center', gap: 12, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 8, padding: '9px 14px', cursor: 'pointer', textAlign: 'left' as const, width: '100%' },
  workflowIcon: { fontSize: 22, flexShrink: 0 },
  workflowLabel: { fontSize: 13, fontWeight: 600 as const, color: 'var(--text-primary)', marginBottom: 2 },
  workflowDesc:       { fontSize: 11, color: 'var(--text-secondary)' },
  workflowCardLocked: { opacity: 0.75 },
  workflowProBadge:   { marginLeft: 6, fontSize: 9, fontWeight: 700 as const, color: 'var(--accent)', background: 'rgba(99,179,237,0.12)', border: '1px solid rgba(99,179,237,0.3)', borderRadius: 3, padding: '1px 4px', letterSpacing: '0.05em', verticalAlign: 'middle' },

  // Forge Score panel
  forgePanel: { borderTop: '1px solid var(--border)', padding: '10px 14px', display: 'flex', flexDirection: 'column' as const, gap: 6, background: '#0d0d0f55' },
  forgePanelHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  forgePanelTitle: { fontSize: 9, fontWeight: 800 as const, color: 'var(--text-muted)', letterSpacing: '0.12em', textTransform: 'uppercase' as const },
  riskBadge: { fontSize: 10, fontWeight: 700 as const, borderRadius: 20, padding: '2px 8px', textTransform: 'uppercase' as const, letterSpacing: '0.05em' },
  confRow: { display: 'flex', alignItems: 'center', gap: 8 },
  confLabel: { fontSize: 11, color: 'var(--text-muted)', minWidth: 72, flexShrink: 0 },
  confTrack: { flex: 1, height: 6, background: 'var(--bg-input)', borderRadius: 3, overflow: 'hidden' },
  confBar: { height: '100%', borderRadius: 3, transition: 'width 0.6s' },
  confPct: { fontSize: 11, fontWeight: 600 as const, color: 'var(--text-primary)', minWidth: 32, textAlign: 'right' as const },
  forgeRow: { display: 'flex', gap: 6, fontSize: 12, lineHeight: 1.5, alignItems: 'flex-start' },
  forgeRowLabel: { color: 'var(--text-muted)', flexShrink: 0, fontWeight: 600 as const },
  forgeRowText: { color: 'var(--text-secondary)', flex: 1 },

  // Execution plan generation
  planBtnRow: { padding: '10px 14px', borderTop: '1px solid var(--border)', display: 'flex', alignItems: 'center', gap: 10 },
  planBtn: { fontSize: 12, fontWeight: 600 as const, background: '#8b5cf622', border: '1px solid #8b5cf655', color: '#8b5cf6', borderRadius: 7, padding: '7px 14px', cursor: 'pointer' },
  planBtnLocked: { background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-muted)', cursor: 'pointer' },
  planError: { fontSize: 12, color: '#ef4444' },

  // ── Forge 3-column layout ─────────────────────────────────────────────────
  topBar: { flexShrink: 0, background: 'var(--bg-surface)', borderBottom: '1px solid var(--border)', display: 'flex', flexDirection: 'column' as const },
  topBarControls: { display: 'flex', alignItems: 'center', gap: 8, padding: '6px 16px', borderBottom: '1px solid var(--border)' },
  topBarInput: { display: 'flex', alignItems: 'flex-end', gap: 8, padding: '8px 16px' },
  workspace: { flex: 1, display: 'grid', gridTemplateColumns: '196px 1fr 236px', overflow: 'hidden', minHeight: 0 },
  leftPanel: { borderRight: '1px solid var(--border)', background: 'var(--bg-surface)', overflowY: 'auto' as const },
  centerPanel: { display: 'flex', flexDirection: 'column' as const, overflow: 'hidden', minHeight: 0 },
  rightPanel: { borderLeft: '1px solid var(--border)', background: 'var(--bg-surface)', display: 'flex', flexDirection: 'column' as const, overflow: 'hidden' },
  chamberWrap: { flexShrink: 0, borderBottom: '1px solid var(--border)' },
  bottomTimeline: { height: 42, borderTop: '1px solid var(--border)', background: 'var(--bg-surface)', flexShrink: 0, overflow: 'hidden' as const, display: 'flex', alignItems: 'center' },
  panelSection: { padding: '8px 12px', borderBottom: '1px solid var(--border)' },
  panelSectionTitle: { fontSize: 9, fontWeight: 800 as const, color: 'rgba(255,255,255,0.22)', letterSpacing: '0.12em', textTransform: 'uppercase' as const, marginBottom: 6 },
  dockBtn: { width: '100%', textAlign: 'left' as const, background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 5, color: 'var(--text-secondary)', fontSize: 11, padding: '5px 10px', cursor: 'pointer' },
  rightIdle: { flex: 1, display: 'flex', flexDirection: 'column' as const, alignItems: 'center', justifyContent: 'center' },
  rightHeader: { display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderBottom: '1px solid var(--border)', flexShrink: 0 },
  rightTitle: { fontSize: 9, fontWeight: 800 as const, color: 'rgba(255,255,255,0.25)', letterSpacing: '0.12em', textTransform: 'uppercase' as const },
  copyBtn: { fontSize: 11, background: 'none', border: '1px solid var(--border)', borderRadius: 5, color: 'var(--text-muted)', padding: '2px 8px', cursor: 'pointer' },
  rightContent: { flex: 1, overflowY: 'auto' as const, padding: '12px' },
  applyRow: { padding: '8px 12px', borderTop: '1px solid var(--border)', flexShrink: 0 },
  applyBtn: { width: '100%', fontSize: 11, fontWeight: 600 as const, background: 'var(--accent)22', border: '1px solid var(--accent)55', color: 'var(--accent)', borderRadius: 6, padding: '6px 0', cursor: 'pointer' },
};
