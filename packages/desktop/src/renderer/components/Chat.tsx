import React, { useState, useRef, useEffect, useCallback } from 'react';
import { VoiceButton } from './VoiceButton';
import { UpgradeGate } from './UpgradeGate';
import { ExecutionPlanView, type ExecutionPlan } from './ExecutionPlanView';
import { ForgeChamber } from './ForgeChamber';

// ── Types ─────────────────────────────────────────────────────────────────────

interface ConsensusResponse { provider: string; text: string; }

interface ForgeScore {
  confidence: number;
  agreement: string;
  disagreement: string;
  risk: 'Low' | 'Medium' | 'High';
  assumptions: string;
  verify: string;
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
}

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
}

// ── Constants ─────────────────────────────────────────────────────────────────

const PROVIDER_COLORS: Record<string, string> = {
  openai: '#10a37f',
  claude: '#d97706',
  gemini: '#4285f4',
};

const PROVIDER_LABELS: Record<string, string> = {
  openai: 'OpenAI',
  claude: 'Claude',
  gemini: 'Gemini',
};

const QUICK_ACTIONS = [
  { label: 'Scan for Photos',      action: 'photos' as const },
  { label: 'Organize Folder',      action: 'organize' as const },
  { label: 'Print Document',       action: 'print' as const },
  { label: 'Generate Application', action: 'builder' as const },
  { label: 'Investment Analysis',  prompt: 'Suggest an investment strategy for ' },
  { label: 'Research Topic',       prompt: 'Research and summarize everything about ' },
];

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

export function Chat({ mode, keyStatus, tier, messagesThisMonth, onMessageSent, onUpgradeClick, onBuildApp, activeProfileId, onProfileSwitch, onProfileDeactivate, prefill, onClearPrefill }: Props) {
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
  const [speaking, setSpeaking] = useState<string | null>(null);
  const [voiceMode, setVoiceMode] = useState(() => localStorage.getItem('triforge-voice-mode') === 'on');
  const [gate, setGate] = useState<{ feature: string; neededTier: 'pro' | 'business' } | null>(null);
  const [checkoutUrls, setCheckoutUrls] = useState<{ pro: string; business: string; portal: string }>({ pro: '', business: '', portal: '' });
  const [showQuickActions, setShowQuickActions] = useState(false);
  const [showWorkflows, setShowWorkflows] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    window.triforge.license.checkoutUrls().then(setCheckoutUrls).catch(() => {});
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

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

  // ── TTS ───────────────────────────────────────────────────────────────────────

  const speakMessage = useCallback(async (msgId: string, text: string) => {
    // Stop anything currently playing
    if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ''; }
    window.speechSynthesis?.cancel();

    setSpeaking(msgId);
    const truncated = text.slice(0, 4096);

    // Priority 1: OpenAI TTS — Pro/Business users with an OpenAI key (higher quality)
    if (keyStatus.openai && (tier === 'pro' || tier === 'business')) {
      try {
        const result = await window.triforge.voice.speak(truncated);
        if (result.audio) {
          const bytes = Uint8Array.from(atob(result.audio), c => c.charCodeAt(0));
          const blob = new Blob([bytes], { type: 'audio/mpeg' });
          const url = URL.createObjectURL(blob);
          if (audioRef.current) {
            audioRef.current.src = url;
            await audioRef.current.play();
            audioRef.current.onended = () => { URL.revokeObjectURL(url); setSpeaking(null); };
            return;
          }
        }
      } catch { /* fall through to Web Speech */ }
    }

    // Fallback: Web Speech API — built into Electron/Chromium, works for all users
    if ('speechSynthesis' in window) {
      const utt = new SpeechSynthesisUtterance(truncated);
      utt.rate = 1.05;
      utt.onend = () => setSpeaking(null);
      utt.onerror = () => setSpeaking(null);
      window.speechSynthesis.speak(utt);
      return;
    }

    setSpeaking(null);
  }, [keyStatus, tier]);

  // ── Send helpers ──────────────────────────────────────────────────────────────

  const appendMsg = (msg: Message) => setMessages(m => [...m, msg]);

  const addSystemMsg = (content: string) => appendMsg({ id: crypto.randomUUID(), role: 'system', content, timestamp: new Date() });

  const addPhotoMsg = (label: string, photos: PhotoFile[]) =>
    appendMsg({ id: crypto.randomUUID(), role: 'system', content: label, photos, timestamp: new Date() });

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
    setInput('');
    setSending(true);
    setShowQuickActions(false);

    // Remove error message being retried
    if (retryId) setMessages(m => m.filter(msg => msg.id !== retryId));

    const userMsg: Message = { id: crypto.randomUUID(), role: 'user', content: text.trim(), timestamp: new Date() };
    setMessages(m => [...m, userMsg]);

    const history = messages
      .filter(m => m.role !== 'system')
      .map(m => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    const activeProviders = Object.entries(keyStatus).filter(([, v]) => v);
    const useConsensus = mode === 'consensus' && activeProviders.length > 1;

    try {
      if (useConsensus) {
        setConsensusThinking(true);
        const result = await window.triforge.chat.consensus(text.trim(), history);
        setConsensusThinking(false);

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
          timestamp: new Date(),
        };
        appendMsg(aiMsg);

        if (!result.error && result.synthesis && voiceMode) {
          speakMessage(aiMsg.id, result.synthesis);
        }
      } else {
        const result = await window.triforge.chat.send(text.trim(), history);

        if (result.error && handleGateError(result.error)) { setSending(false); return; }

        onMessageSent();
        const aiMsg: Message = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: result.error ? `${result.error}` : (result.text ?? ''),
          provider: result.provider,
          isError: !!result.error,
          timestamp: new Date(),
        };
        appendMsg(aiMsg);

        if (!result.error && result.text && voiceMode) {
          speakMessage(aiMsg.id, result.text);
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
    try { localStorage.removeItem(HISTORY_KEY); } catch { /* ok */ }
  };

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
      if (a.action === 'photos') { runFindPhotos(); return; }
      if (a.action === 'organize') { runOrganizeDownloads(); return; }
      if (a.action === 'print') { runPickAndPrint(); return; }
      if (a.action === 'builder') { onBuildApp(); return; }
    }
    if ('prompt' in a) { setInput(a.prompt); inputRef.current?.focus(); }
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

      {/* Status bar */}
      <div style={cs.statusBar}>
        <div style={cs.statusDots}>
          {(['openai', 'claude', 'gemini'] as const).map(p => {
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
                  {p === 'openai' ? 'GPT' : p === 'claude' ? 'Claude' : 'Gemini'}
                </span>
              </div>
            );
          })}
        </div>
        <div style={cs.toolbarDivider} />
        <span style={{ ...cs.modeLabel, ...(mode === 'consensus' ? cs.modeLabelConsensus : {}) }}>
          {MODE_LABELS[mode] ?? mode}
        </span>
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

      {/* Messages */}
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
                  if (action === 'find_photos')           runFindPhotos();
                  else if (action === 'organize')              runOrganizeDownloads();
                  else if (action === 'organize_deep')         runOrganizeDeep();
                  else if (action === 'organize_desktop')      runOrganizeKnownDir('Desktop');
                  else if (action === 'organize_downloads')    runOrganizeKnownDir('Downloads');
                  else if (action === 'organize_documents')    runOrganizeKnownDir('Documents');
                  else if (action === 'search_photos')         runSearchPhotos();
                  else if (action === 'find_similar')          runFindSimilar();
                  else if (action === 'print')                 runPickAndPrint();
                }} />
        ))}
        {(sending || consensusThinking) && (
          consensusThinking
            ? <ForgeChamber visible={consensusThinking} />
            : <TypingIndicator />
        )}
        <div ref={bottomRef} />
      </div>

      {/* Workflow templates panel (collapsible) */}
      {showWorkflows && (
        <div style={cs.workflowPanel}>
          <div style={cs.workflowPanelTitle}>Think Tank Workflows</div>
          <div style={cs.workflowGrid}>
            {WORKFLOWS.map(w => (
              <button key={w.id} style={cs.workflowCard} onClick={() => fireWorkflow(w.id)}>
                <div>
                  <div style={cs.workflowLabel}>{w.label}</div>
                  <div style={cs.workflowDesc}>{w.desc}</div>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Quick actions panel (collapsible) */}
      {showQuickActions && (
        <div style={cs.quickActionsPanel}>
          {QUICK_ACTIONS.map(a => (
            <button key={a.label} style={cs.quickBtn} onClick={() => handleQuickAction(a)}>
              {a.label}
            </button>
          ))}
        </div>
      )}

      {/* System action toolbar */}
      <div style={cs.actionToolbar}>
        <button style={{ ...cs.actionBtn, ...(showQuickActions ? cs.actionBtnActive : {}) }}
          onClick={() => setShowQuickActions(s => !s)} title="Quick actions">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>
          <span style={cs.actionLabel}>Quick</span>
        </button>
        <button style={{ ...cs.actionBtn, ...(showWorkflows ? cs.actionBtnActive : {}) }}
          onClick={() => { setShowWorkflows(s => !s); setShowQuickActions(false); }} title="Workflow templates">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></svg>
          <span style={cs.actionLabel}>Workflows</span>
        </button>
        <div style={cs.toolbarDivider} />
        <button style={cs.actionBtn} onClick={runFindPhotos} title="Scan for photos">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></svg>
          <span style={cs.actionLabel}>Photos</span>
        </button>
        <button style={cs.actionBtn} onClick={runOrganizeDownloads} title="Organize a folder">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/><line x1="12" y1="11" x2="12" y2="17"/><polyline points="9 14 12 17 15 14"/></svg>
          <span style={cs.actionLabel}>Organize</span>
        </button>
        <button style={cs.actionBtn} onClick={runPickAndPrint} title="Print a file">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="6 9 6 2 18 2 18 9"/><path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"/><rect x="6" y="14" width="12" height="8"/></svg>
          <span style={cs.actionLabel}>Print</span>
        </button>
        <button style={cs.actionBtn} onClick={async () => {
          const dir = await window.triforge.files.pickDir();
          if (dir) {
            const result = await window.triforge.files.listDir(dir);
            if (result.error) { addSystemMsg(`${result.error}`); return; }
            addSystemMsg(`${dir}\n${result.subdirs.length} folders, ${result.files.length} files\n` +
              result.files.slice(0, 8).map(f => `• ${f.name}`).join('\n') +
              (result.files.length > 8 ? `\n…and ${result.files.length - 8} more` : ''));
          }
        }} title="Browse a folder">
          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"/></svg>
          <span style={cs.actionLabel}>Browse</span>
        </button>
        <div style={cs.toolbarDivider} />
        <button
          style={{ ...cs.actionBtn, ...(voiceMode ? cs.actionBtnActive : {}) }}
          onClick={() => {
            const next = !voiceMode;
            setVoiceMode(next);
            localStorage.setItem('triforge-voice-mode', next ? 'on' : 'off');
            if (!next) {
              if (audioRef.current) { audioRef.current.pause(); audioRef.current.src = ''; }
              window.speechSynthesis?.cancel();
              setSpeaking(null);
            }
          }}
          title={voiceMode ? 'Voice responses active — click to mute' : 'Voice responses off — click to enable'}
        >
          {voiceMode
            ? <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M11 5L6 9H2v6h4l5 4V5z"/><path d="M19.07 4.93a10 10 0 0 1 0 14.14M15.54 8.46a5 5 0 0 1 0 7.07" stroke="currentColor" strokeWidth="2" fill="none" strokeLinecap="round"/></svg>
            : <svg width="13" height="13" viewBox="0 0 24 24" fill="currentColor"><path d="M11 5L6 9H2v6h4l5 4V5z"/><line x1="23" y1="9" x2="17" y2="15" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/><line x1="17" y1="9" x2="23" y2="15" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
          }
          <span style={cs.actionLabel}>{voiceMode ? 'Voice On' : 'Voice'}</span>
        </button>
      </div>

      {/* Input area */}
      <div style={cs.inputArea}>
        <VoiceButton
          onTranscript={(text) => sendMessage(text)}
          onError={(err) => addSystemMsg(`Voice input: ${err}`)}
          disabled={sending}
          hasOpenAI={keyStatus.openai}
        />
        <div style={cs.inputWrapper}>
          <textarea
            ref={inputRef}
            style={cs.textarea}
            spellCheck={true}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input); } }}
            placeholder={hasKeys
              ? mode === 'consensus'
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
          onClick={() => sendMessage(input)}
          disabled={!input.trim() || sending || !hasKeys}
          title="Send"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
          </svg>
        </button>
      </div>

      <audio ref={audioRef} style={{ display: 'none' }} />
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
      gemini: 'https://aistudio.google.com/apikey',
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
              {responses.map((r, i) => (
                <button key={r.provider} style={{ ...cs.tab, ...(activeTab === i ? cs.tabActive : {}) }}
                  onClick={() => setActiveTab(i)}>
                  <span style={{ color: PROVIDER_COLORS[r.provider.toLowerCase()] ?? 'var(--accent)' }}>●</span>
                  {' '}{PROVIDER_LABELS[r.provider.toLowerCase()] ?? r.provider}
                </button>
              ))}
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
        <span style={cs.confPct}>{score.confidence}%</span>
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

const RUN_TAG_RE = /\[RUN:(find_photos|organize|organize_deep|organize_desktop|organize_downloads|organize_documents|search_photos|find_similar|print)\]/i;

const RUN_LABELS: Record<string, string> = {
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
        <span style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</span>
        {msg.photos && msg.photos.length > 0 && <PhotoGrid photos={msg.photos} />}
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
          : <MarkdownText text={displayContent} />
        }
        {runAction && onRunAction && (
          <button
            style={cs.runActionBtn}
            onClick={() => onRunAction(runAction)}
          >
            ▶ {RUN_LABELS[runAction] ?? 'Run'}
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

// ── Styles ────────────────────────────────────────────────────────────────────

const cs: Record<string, React.CSSProperties> = {
  container: { display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' },

  statusBar: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0, background: 'var(--bg-surface)' },
  statusDots: { display: 'flex', gap: 5 },
  dot: { width: 9, height: 9, borderRadius: '50%', transition: 'background 0.3s' },
  modeLabel: { fontSize: 11, color: 'var(--text-muted)', marginLeft: 4, fontWeight: 500 },
  modeLabelConsensus: { color: 'var(--accent)', fontWeight: 700 },
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
  workflowDesc: { fontSize: 11, color: 'var(--text-secondary)' },

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
};
