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
  workflow?: string;
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
  { label: '📸 Find my photos',     action: 'photos' as const },
  { label: '🗂️ Organize Downloads', action: 'organize' as const },
  { label: '🖨️ Print a document',   action: 'print' as const },
  { label: '💡 Build me an app',    action: 'builder' as const },
  { label: '📈 Investment idea',    prompt: 'Suggest an investment strategy for ' },
  { label: '🔍 Research topic',     prompt: 'Research and summarize everything about ' },
];

const MSG_LIMITS: Record<string, number> = { free: 30, pro: 300, business: Infinity };

const MODE_LABELS: Record<string, string> = {
  none:      'No providers',
  single:    'Single AI',
  pair:      'Pair mode — 2 AIs',
  consensus: '⚡ Think Tank — 3 AIs',
};

const HISTORY_KEY = 'triforge-chat-v2';

const WORKFLOWS = [
  { id: 'startup',    icon: '🏢', label: 'Start a Business',       desc: 'LLC steps, EIN, checklist, 30-day launch plan' },
  { id: 'hiring',     icon: '👥', label: 'Hire Someone',            desc: 'Job post, interview questions, offer letter, onboarding' },
  { id: 'marketing',  icon: '📣', label: 'Marketing Campaign',      desc: 'Strategy, copy, content calendar, budget split' },
  { id: 'sop',        icon: '📋', label: 'Write a Policy / SOP',    desc: 'Operational procedure for any business process' },
  { id: 'client',     icon: '📧', label: 'Client Follow-up System', desc: '5-email sequence, CRM notes, re-engagement message' },
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
    if (!keyStatus.openai) return;
    setSpeaking(msgId);
    try {
      const result = await window.triforge.voice.speak(text);
      if (result.audio) {
        try {
          const bytes = Uint8Array.from(atob(result.audio), c => c.charCodeAt(0));
          const blob = new Blob([bytes], { type: 'audio/mpeg' });
          const url = URL.createObjectURL(blob);
          if (audioRef.current) {
            audioRef.current.src = url;
            await audioRef.current.play();
            audioRef.current.onended = () => { URL.revokeObjectURL(url); setSpeaking(null); };
          }
        } catch { setSpeaking(null); }
      } else { setSpeaking(null); }
    } catch { setSpeaking(null); }
  }, [keyStatus]);

  // ── Send helpers ──────────────────────────────────────────────────────────────

  const appendMsg = (msg: Message) => setMessages(m => [...m, msg]);

  const addSystemMsg = (content: string) => appendMsg({ id: crypto.randomUUID(), role: 'system', content, timestamp: new Date() });

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
          isError: !!result.error,
          timestamp: new Date(),
        };
        appendMsg(aiMsg);

        if (!result.error && result.synthesis && keyStatus.openai && (tier === 'pro' || tier === 'business')) {
          speakMessage(aiMsg.id, result.synthesis);
        }
      } else {
        const result = await window.triforge.chat.send(text.trim(), history);

        if (result.error && handleGateError(result.error)) { setSending(false); return; }

        onMessageSent();
        const aiMsg: Message = {
          id: crypto.randomUUID(),
          role: 'assistant',
          content: result.error ? `⚠️ ${result.error}` : (result.text ?? ''),
          provider: result.provider,
          isError: !!result.error,
          timestamp: new Date(),
        };
        appendMsg(aiMsg);

        if (!result.error && result.text && keyStatus.openai && (tier === 'pro' || tier === 'business')) {
          speakMessage(aiMsg.id, result.text);
        }
      }
    } catch (e) {
      setConsensusThinking(false);
      appendMsg({
        id: crypto.randomUUID(), role: 'assistant', isError: true,
        content: `⚠️ ${e instanceof Error ? e.message : 'Something went wrong'}`,
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
    addSystemMsg('📸 Scanning your computer for photos…');
    try {
      const result = await window.triforge.files.scanPhotos();
      if (result.error === 'PERMISSION_DENIED:files') {
        addSystemMsg('⚠️ Files permission is off. Go to Settings → Permissions → Files & Folders.');
        return;
      }
      const count = result.photos.length;
      if (count === 0) { addSystemMsg('No photos found in Pictures, Desktop, or Downloads.'); return; }
      const preview = result.photos.slice(0, 5).map(p => `• ${p.name} — ${new Date(p.modified).toLocaleDateString()}`).join('\n');
      addSystemMsg(`📸 Found ${count} photo${count > 1 ? 's' : ''}. Most recent:\n${preview}${count > 5 ? `\n…and ${count - 5} more.` : ''}`);
    } catch { addSystemMsg('⚠️ Could not scan for photos.'); }
  };

  const runOrganizeDownloads = async () => {
    const dirs = await window.triforge.files.commonDirs();
    const downloads = dirs['Downloads'];
    if (!downloads) { addSystemMsg('⚠️ Could not find Downloads folder.'); return; }
    addSystemMsg(`🗂️ Organizing ${downloads}…`);
    try {
      const result = await window.triforge.files.organize(downloads);
      if (result.errors.some(e => e.includes('PERMISSION_DENIED'))) {
        addSystemMsg('⚠️ Files permission is off. Go to Settings → Permissions → Files & Folders.'); return;
      }
      if (result.moved === 0) { addSystemMsg('🗂️ Downloads is already tidy — nothing needed moving.'); return; }
      const folders = result.folders.map(f => f.split(/[\\/]/).pop()).join(', ');
      addSystemMsg(`✅ Organized ${result.moved} file${result.moved > 1 ? 's' : ''} into: ${folders || 'sub-folders'}.${result.errors.length ? `\n⚠️ ${result.errors.length} file(s) skipped.` : ''}`);
    } catch { addSystemMsg('⚠️ Could not organize Downloads.'); }
  };

  const runPickAndPrint = async () => {
    const filePath = await window.triforge.files.pickFile([
      { name: 'Documents & Images', extensions: ['pdf', 'doc', 'docx', 'txt', 'png', 'jpg', 'jpeg'] },
      { name: 'All Files', extensions: ['*'] },
    ]);
    if (!filePath) return;
    addSystemMsg('🖨️ Checking available printers…');
    try {
      const { printers, error } = await window.triforge.print.list();
      if (error === 'PERMISSION_DENIED:printer') { addSystemMsg('⚠️ Printer permission is off. Go to Settings → Permissions → Printer.'); return; }
      if (printers.length === 0) { addSystemMsg('⚠️ No printers found. Make sure your printer is connected.'); return; }
      const printer = printers.find(p => p.isDefault) ?? printers[0];
      addSystemMsg(`🖨️ Sending "${filePath.split(/[\\/]/).pop()}" to ${printer.name}…`);
      const result = await window.triforge.print.file(filePath, printer.name);
      addSystemMsg(result.ok ? `✅ Print job sent to ${printer.name}.` : `⚠️ Print failed: ${result.error}`);
    } catch { addSystemMsg('⚠️ Could not complete print job.'); }
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
          {(['openai', 'claude', 'gemini'] as const).map(p => (
            <div key={p} title={`${PROVIDER_LABELS[p]}: ${keyStatus[p] ? 'active' : 'not configured'}`}
              style={{ ...cs.dot, background: keyStatus[p] ? PROVIDER_COLORS[p] : 'var(--bg-elevated)', border: `2px solid ${keyStatus[p] ? PROVIDER_COLORS[p] : 'var(--border)'}` }} />
          ))}
        </div>
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
                canSpeak={!!keyStatus.openai} onSpeak={() => speakMessage(msg.id, msg.content)}
                tier={tier} onUpgradeClick={onUpgradeClick} />
            : <MessageBubble key={msg.id} msg={msg} isSpeaking={speaking === msg.id}
                canSpeak={!!keyStatus.openai} onSpeak={() => speakMessage(msg.id, msg.content)}
                onRetry={msg.isError && msg.role === 'assistant' ? () => {
                  const prev = messages[messages.indexOf(msg) - 1];
                  if (prev?.role === 'user') sendMessage(prev.content, msg.id);
                } : undefined} />
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
          <div style={cs.workflowPanelTitle}>⚡ Think Tank Workflows — click to fire instantly</div>
          <div style={cs.workflowGrid}>
            {WORKFLOWS.map(w => (
              <button key={w.id} style={cs.workflowCard} onClick={() => fireWorkflow(w.id)}>
                <span style={cs.workflowIcon}>{w.icon}</span>
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
          ⚡ <span style={cs.actionLabel}>Quick</span>
        </button>
        <button style={{ ...cs.actionBtn, ...(showWorkflows ? cs.actionBtnActive : {}) }}
          onClick={() => { setShowWorkflows(s => !s); setShowQuickActions(false); }} title="Workflow templates">
          📋 <span style={cs.actionLabel}>Workflows</span>
        </button>
        <div style={cs.toolbarDivider} />
        <button style={cs.actionBtn} onClick={runFindPhotos} title="Find photos">
          📸 <span style={cs.actionLabel}>Photos</span>
        </button>
        <button style={cs.actionBtn} onClick={runOrganizeDownloads} title="Organize Downloads">
          🗂️ <span style={cs.actionLabel}>Organize</span>
        </button>
        <button style={cs.actionBtn} onClick={runPickAndPrint} title="Print a file">
          🖨️ <span style={cs.actionLabel}>Print</span>
        </button>
        <button style={cs.actionBtn} onClick={async () => {
          const dir = await window.triforge.files.pickDir();
          if (dir) {
            const result = await window.triforge.files.listDir(dir);
            if (result.error) { addSystemMsg(`⚠️ ${result.error}`); return; }
            addSystemMsg(`📁 ${dir}\n${result.subdirs.length} folders, ${result.files.length} files\n` +
              result.files.slice(0, 8).map(f => `• ${f.name}`).join('\n') +
              (result.files.length > 8 ? `\n…and ${result.files.length - 8} more` : ''));
          }
        }} title="Browse a folder">
          📁 <span style={cs.actionLabel}>Browse</span>
        </button>
      </div>

      {/* Input area */}
      <div style={cs.inputArea}>
        <VoiceButton
          onTranscript={(text) => sendMessage(text)}
          onError={(err) => addSystemMsg(`🎙️ ${err}`)}
          disabled={!hasKeys || sending}
        />
        <div style={cs.inputWrapper}>
          <textarea
            ref={inputRef}
            style={cs.textarea}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage(input); } }}
            placeholder={hasKeys
              ? mode === 'consensus'
                ? '⚡ Ask the Think Tank… all 3 AIs will respond (Enter to send)'
                : 'Message TriForge AI… (Enter to send, Shift+Enter for newline)'
              : 'Add an API key in Settings to get started →'
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
      <div style={cs.avatar}>⚡</div>
      <div style={cs.consensusCard}>
        {/* Header */}
        <div style={cs.consensusHeader}>
          <span style={cs.consensusBadge}>⚡ Think Tank</span>
          <span style={cs.consensusCount}>{responses.length} AI{responses.length > 1 ? 's' : ''} responded</span>
        </div>

        {/* Synthesis — primary content */}
        <div style={cs.synthesisBlock}>
          <div style={cs.synthesisLabel}>SYNTHESIS</div>
          <div style={cs.synthesisText}>{msg.content}</div>
        </div>

        {/* Forge Score trust panel */}
        {msg.forgeScore && <ForgeScorePanel score={msg.forgeScore} />}

        {/* Generate Execution Plan button */}
        {!plan && (
          <div style={cs.planBtnRow}>
            <button style={{ ...cs.planBtn, ...(!canUsePlans ? cs.planBtnLocked : {}) }} onClick={generatePlan} disabled={planLoading}>
              {planLoading ? '⏳ Generating plan…' : canUsePlans ? '🗺️ Generate Execution Plan' : '🔒 Execution Plans — Pro'}
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
            <div style={cs.tabContent}>{responses[activeTab]?.text}</div>
          </div>
        )}

        {/* Meta */}
        <div style={cs.bubbleMeta}>
          <span style={cs.timestamp}>{msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          <button style={cs.speakBtn} onClick={() => navigator.clipboard.writeText(msg.content)} title="Copy synthesis">📋</button>
          {canSpeak && (
            <button style={{ ...cs.speakBtn, ...(isSpeaking ? cs.speakBtnActive : {}) }} onClick={onSpeak} title="Read synthesis aloud">🔊</button>
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
      {score.agreement    && <ForgeRow icon="✅" label="Agreement"    text={score.agreement} />}
      {score.disagreement && <ForgeRow icon="⚠️" label="Disagreement" text={score.disagreement} />}
      {score.assumptions  && <ForgeRow icon="💭" label="Assumptions"  text={score.assumptions} />}
      {score.verify       && <ForgeRow icon="🔍" label="Verify"       text={score.verify} />}
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

// ── Regular MessageBubble ─────────────────────────────────────────────────────

function MessageBubble({ msg, isSpeaking, canSpeak, onSpeak, onRetry }: {
  msg: Message; isSpeaking: boolean; canSpeak: boolean; onSpeak: () => void;
  onRetry?: () => void;
}) {
  const isUser = msg.role === 'user';
  const isSystem = msg.role === 'system';

  if (isSystem) {
    return (
      <div style={cs.systemMsg}>
        <span style={{ whiteSpace: 'pre-wrap' }}>{msg.content}</span>
      </div>
    );
  }

  return (
    <div style={{ ...cs.bubbleRow, ...(isUser ? cs.bubbleRowUser : {}) }}>
      {!isUser && <div style={cs.avatar}>⚡</div>}
      <div style={{ ...cs.bubble, ...(isUser ? cs.bubbleUser : cs.bubbleAi), ...(msg.isError ? cs.bubbleError : {}) }}>
        <div style={cs.bubbleContent}>{msg.content}</div>
        <div style={cs.bubbleMeta}>
          {msg.provider && (
            <span style={{ ...cs.providerTag, color: PROVIDER_COLORS[msg.provider.toLowerCase()] ?? 'var(--text-muted)' }}>
              {PROVIDER_LABELS[msg.provider.toLowerCase()] ?? msg.provider}
            </span>
          )}
          <span style={cs.timestamp}>{msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span>
          {!isUser && (
            <button style={cs.speakBtn} onClick={() => navigator.clipboard.writeText(msg.content)} title="Copy">📋</button>
          )}
          {!isUser && canSpeak && (
            <button style={{ ...cs.speakBtn, ...(isSpeaking ? cs.speakBtnActive : {}) }} onClick={onSpeak} title="Read aloud">🔊</button>
          )}
          {onRetry && (
            <button style={cs.retryBtn} onClick={onRetry} title="Retry">🔄 Retry</button>
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
      <div style={cs.avatar}>⚡</div>
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
    return '👋 Welcome to TriForge AI! Go to Settings → API Keys and add at least one key to get started.';
  }
  if (mode === 'consensus') {
    return `👋 Your Think Tank is ready! ${active.join(', ')} are all active. Every question you ask will be answered by all ${active.length} AIs — then synthesized into one definitive answer. This is TriForge at full power.`;
  }
  if (active.length > 1) {
    return `👋 Welcome! ${active.join(' and ')} are active. Add ${active.length < 3 ? 'more keys' : ''} to unlock full Think Tank mode.`;
  }
  return `👋 Welcome! Running with ${active[0]}. Add more API keys in Settings to unlock Think Tank consensus mode.`;
}

// ── Profile Status Strip ──────────────────────────────────────────────────────

const PROFILE_DISPLAY: Record<string, { name: string; icon: string }> = {
  restaurant: { name: 'Restaurant & Food Service', icon: '🍽️' },
  trucking:   { name: 'Trucking & Freight',         icon: '🚛' },
  consultant: { name: 'Consultant & Agency',        icon: '💼' },
};

function ProfileStatusStrip({ profileId, onSwitch, onDeactivate }: {
  profileId: string;
  onSwitch: () => void;
  onDeactivate: () => void;
}) {
  const info = PROFILE_DISPLAY[profileId] ?? { name: profileId, icon: '🛡️' };
  return (
    <div style={stripStyle.bar}>
      <span style={stripStyle.label}>{info.icon} <strong>{info.name}</strong> profile active</span>
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
