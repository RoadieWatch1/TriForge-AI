import React, { useState, useRef, useEffect, useCallback } from 'react';
import { VoiceButton } from './VoiceButton';
import { UpgradeGate } from './UpgradeGate';

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  provider?: string;
  timestamp: Date;
  speaking?: boolean;
}

interface Props {
  mode: string;
  keyStatus: Record<string, boolean>;
  tier: string;
  messagesThisMonth: number;
  onMessageSent: () => void;
  onUpgradeClick: () => void;
}

const PROVIDER_COLORS: Record<string, string> = {
  openai: '#10a37f',
  claude: '#d97706',
  gemini: '#4285f4',
};

const QUICK_ACTIONS = [
  { label: '📸 Find my photos',     prompt: 'Find all my photos on this computer' },
  { label: '🗂️ Organize Downloads', prompt: 'Organize my Downloads folder — sort everything into Photos, Documents, Videos, and Music sub-folders' },
  { label: '🖨️ Print a document',   prompt: 'I want to print a document. List the available printers and help me print.' },
  { label: '💡 Build me an app',    prompt: 'Build me a web application for ' },
  { label: '📈 Investment idea',    prompt: 'Suggest an investment strategy for ' },
  { label: '🔍 Research topic',     prompt: 'Research and summarize everything about ' },
];

const MSG_LIMITS: Record<string, number> = { free: 30, pro: Infinity, business: Infinity };

export function Chat({ mode, keyStatus, tier, messagesThisMonth, onMessageSent, onUpgradeClick }: Props) {
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '0',
      role: 'system',
      content: getWelcomeMessage(mode, keyStatus),
      timestamp: new Date(),
    },
  ]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [speaking, setSpeaking] = useState<string | null>(null);
  const [gate, setGate] = useState<{ feature: string; neededTier: 'pro' | 'business' } | null>(null);
  const [checkoutUrls, setCheckoutUrls] = useState<{ pro: string; business: string; portal: string }>({ pro: '', business: '', portal: '' });
  const bottomRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const audioRef = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    window.triforge.license.checkoutUrls().then(setCheckoutUrls).catch(() => {});
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const speakMessage = useCallback(async (msgId: string, text: string) => {
    if (!keyStatus.openai) return;
    setSpeaking(msgId);
    try {
      const result = await window.triforge.voice.speak(text);
      if (result.audio) {
        const bytes = Uint8Array.from(atob(result.audio), c => c.charCodeAt(0));
        const blob = new Blob([bytes], { type: 'audio/mpeg' });
        const url = URL.createObjectURL(blob);
        if (audioRef.current) {
          audioRef.current.src = url;
          await audioRef.current.play();
          audioRef.current.onended = () => {
            URL.revokeObjectURL(url);
            setSpeaking(null);
          };
        }
      }
    } catch {
      setSpeaking(null);
    }
  }, [keyStatus]);

  const sendMessage = useCallback(async (text: string) => {
    if (!text.trim() || sending) return;
    setInput('');
    setSending(true);

    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: text.trim(),
      timestamp: new Date(),
    };
    setMessages(m => [...m, userMsg]);

    try {
      const history = messages
        .filter(m => m.role !== 'system')
        .map(m => ({ role: m.role, content: m.content }));

      const result = await window.triforge.chat.send(text.trim(), history);

      // Handle paywall errors returned from IPC
      if (result.error === 'MESSAGE_LIMIT_REACHED') {
        setGate({ feature: 'MESSAGE_LIMIT_REACHED', neededTier: 'pro' });
        setSending(false);
        return;
      }
      if (result.error?.startsWith('FEATURE_LOCKED:')) {
        const feature = result.error.split(':')[1] ?? 'unknown';
        setGate({ feature, neededTier: feature === 'browser' || feature === 'email' || feature === 'financeTrading' ? 'business' : 'pro' });
        setSending(false);
        return;
      }

      onMessageSent();

      const aiMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: result.error ? `⚠️ ${result.error}` : (result.text ?? ''),
        provider: result.provider,
        timestamp: new Date(),
      };
      setMessages(m => [...m, aiMsg]);

      // Auto-speak if no error
      if (!result.error && result.text && keyStatus.openai) {
        speakMessage(aiMsg.id, result.text);
      }
    } catch (e) {
      setMessages(m => [...m, {
        id: Date.now().toString(),
        role: 'assistant',
        content: `⚠️ ${e instanceof Error ? e.message : 'Something went wrong'}`,
        timestamp: new Date(),
      }]);
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }, [messages, sending, keyStatus, speakMessage]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      sendMessage(input);
    }
  };

  // ── System actions (photo, files, print) ─────────────────────────────────
  const addSystemMessage = (content: string) => {
    setMessages(m => [...m, { id: Date.now().toString(), role: 'system', content, timestamp: new Date() }]);
  };

  const runFindPhotos = async () => {
    addSystemMessage('📸 Scanning your computer for photos…');
    try {
      const result = await window.triforge.files.scanPhotos();
      if (result.error === 'PERMISSION_DENIED:files') {
        addSystemMessage('⚠️ Files permission is not enabled. Go to Settings → Permissions → Files & Folders to enable it.');
        return;
      }
      const count = result.photos.length;
      if (count === 0) {
        addSystemMessage('No photos found in Pictures, Desktop, or Downloads.');
        return;
      }
      const preview = result.photos.slice(0, 5).map(p => `• ${p.name} — ${new Date(p.modified).toLocaleDateString()}`).join('\n');
      addSystemMessage(`📸 Found ${count} photo${count > 1 ? 's' : ''}. Most recent:\n${preview}${count > 5 ? `\n…and ${count - 5} more.` : ''}`);
    } catch {
      addSystemMessage('⚠️ Could not scan for photos.');
    }
  };

  const runOrganizeDownloads = async () => {
    const dirs = await window.triforge.files.commonDirs();
    const downloads = dirs['Downloads'];
    if (!downloads) { addSystemMessage('⚠️ Could not find Downloads folder.'); return; }
    addSystemMessage(`🗂️ Organizing ${downloads}…`);
    try {
      const result = await window.triforge.files.organize(downloads);
      if (result.errors.some(e => e.includes('PERMISSION_DENIED'))) {
        addSystemMessage('⚠️ Files permission is not enabled. Go to Settings → Permissions → Files & Folders.');
        return;
      }
      if (result.moved === 0) {
        addSystemMessage('🗂️ Downloads is already organized — no files needed moving.');
        return;
      }
      const folderNames = result.folders.map(f => f.split(/[\\/]/).pop()).join(', ');
      addSystemMessage(`✅ Organized ${result.moved} file${result.moved > 1 ? 's' : ''} into: ${folderNames || 'sub-folders'}.${result.errors.length ? `\n⚠️ ${result.errors.length} file(s) could not be moved.` : ''}`);
    } catch {
      addSystemMessage('⚠️ Could not organize Downloads.');
    }
  };

  const runPickAndPrint = async () => {
    const filePath = await window.triforge.files.pickFile([
      { name: 'Documents & Images', extensions: ['pdf', 'doc', 'docx', 'txt', 'png', 'jpg', 'jpeg'] },
      { name: 'All Files', extensions: ['*'] },
    ]);
    if (!filePath) return;
    addSystemMessage(`🖨️ Checking available printers…`);
    try {
      const { printers, error } = await window.triforge.print.list();
      if (error === 'PERMISSION_DENIED:printer') {
        addSystemMessage('⚠️ Printer permission is not enabled. Go to Settings → Permissions → Printer.');
        return;
      }
      if (printers.length === 0) {
        addSystemMessage('⚠️ No printers found. Make sure your printer is connected and installed.');
        return;
      }
      const defaultPrinter = printers.find(p => p.isDefault) ?? printers[0];
      addSystemMessage(`🖨️ Sending "${filePath.split(/[\\/]/).pop()}" to ${defaultPrinter.name}…`);
      const result = await window.triforge.print.file(filePath, defaultPrinter.name);
      if (result.ok) {
        addSystemMessage(`✅ Print job sent to ${defaultPrinter.name} successfully.`);
      } else {
        addSystemMessage(`⚠️ Print failed: ${result.error}`);
      }
    } catch {
      addSystemMessage('⚠️ Could not complete print job.');
    }
  };

  const hasKeys = Object.values(keyStatus).some(Boolean);

  const msgLimit = MSG_LIMITS[tier] ?? 30;
  const unlimited = msgLimit === Infinity;
  const remaining = unlimited ? Infinity : Math.max(0, msgLimit - messagesThisMonth);
  const atLimit = !unlimited && remaining <= 0;

  return (
    <div style={styles.container}>
      {/* Upgrade gate overlay */}
      {gate && (
        <UpgradeGate
          feature={gate.feature}
          neededTier={gate.neededTier}
          onClose={() => setGate(null)}
          onUpgrade={(url) => { window.triforge.system.openExternal(url); setGate(null); }}
          proCheckout={checkoutUrls.pro}
          bizCheckout={checkoutUrls.business}
        />
      )}

      {/* Status bar */}
      <div style={styles.statusBar}>
        <div style={styles.statusDots}>
          {(['openai', 'claude', 'gemini'] as const).map(p => (
            <div key={p} style={{ ...styles.dot, background: keyStatus[p] ? PROVIDER_COLORS[p] : 'var(--text-muted)' }}
              title={`${p}: ${keyStatus[p] ? 'active' : 'not configured'}`}
            />
          ))}
        </div>
        <span style={styles.modeLabel}>{MODE_LABELS[mode] ?? mode}</span>
        <div style={{ flex: 1 }} />
        {/* Message quota */}
        {unlimited
          ? <span style={styles.quotaLabel}>∞ unlimited</span>
          : (
            <button style={{ ...styles.quotaLabel, ...(atLimit ? styles.quotaAtLimit : {}), background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
              onClick={onUpgradeClick}
              title={atLimit ? 'Upgrade to send more messages' : `${remaining} messages remaining this month`}
            >
              {atLimit ? '⚠ Limit reached — Upgrade' : `${remaining} / ${msgLimit} msgs`}
            </button>
          )
        }
      </div>

      {/* Messages */}
      <div style={styles.messages}>
        {messages.map(msg => (
          <MessageBubble
            key={msg.id}
            msg={msg}
            isSpeaking={speaking === msg.id}
            canSpeak={!!keyStatus.openai}
            onSpeak={() => speakMessage(msg.id, msg.content)}
          />
        ))}
        {sending && <TypingIndicator />}
        <div ref={bottomRef} />
      </div>

      {/* Quick actions (shown when chat is empty) */}
      {messages.length <= 1 && !sending && (
        <div style={styles.quickActions}>
          {QUICK_ACTIONS.map(a => (
            <button key={a.label} style={styles.quickBtn}
              onClick={() => setInput(a.prompt)}
            >
              {a.label}
            </button>
          ))}
        </div>
      )}

      {/* System action toolbar */}
      <div style={styles.actionToolbar}>
        <button style={styles.actionBtn} onClick={runFindPhotos} title="Scan your computer for photos">
          📸 <span style={styles.actionLabel}>Find Photos</span>
        </button>
        <button style={styles.actionBtn} onClick={runOrganizeDownloads} title="Sort Downloads into sub-folders">
          🗂️ <span style={styles.actionLabel}>Organize Downloads</span>
        </button>
        <button style={styles.actionBtn} onClick={runPickAndPrint} title="Pick a file and print it">
          🖨️ <span style={styles.actionLabel}>Print</span>
        </button>
        <button style={styles.actionBtn} onClick={async () => {
          const dir = await window.triforge.files.pickDir();
          if (dir) {
            const result = await window.triforge.files.listDir(dir);
            if (result.error) { addSystemMessage(`⚠️ ${result.error}`); return; }
            const summary = `📁 ${dir}\n${result.subdirs.length} folders, ${result.files.length} files\n` +
              result.files.slice(0, 8).map(f => `• ${f.name}`).join('\n') +
              (result.files.length > 8 ? `\n…and ${result.files.length - 8} more` : '');
            addSystemMessage(summary);
          }
        }} title="Browse a folder">
          📁 <span style={styles.actionLabel}>Browse Folder</span>
        </button>
      </div>

      {/* Input area */}
      <div style={styles.inputArea}>
        <VoiceButton
          onTranscript={(text) => sendMessage(text)}
          onError={(err) => setMessages(m => [...m, { id: Date.now().toString(), role: 'system', content: `🎙️ ${err}`, timestamp: new Date() }])}
          disabled={!hasKeys || sending}
        />
        <div style={styles.inputWrapper}>
          <textarea
            ref={inputRef}
            style={styles.textarea}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={hasKeys ? 'Message TriForge AI… (Enter to send, Shift+Enter for newline)' : 'Add an API key in Settings to get started →'}
            rows={1}
            disabled={!hasKeys || sending}
          />
        </div>
        <button
          style={{ ...styles.sendBtn, ...((!input.trim() || sending || !hasKeys) ? styles.sendBtnDisabled : {}) }}
          onClick={() => sendMessage(input)}
          disabled={!input.trim() || sending || !hasKeys}
          title="Send (Enter)"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor">
            <path d="M2.01 21L23 12 2.01 3 2 10l15 2-15 2z"/>
          </svg>
        </button>
      </div>

      {/* Hidden audio element for TTS playback */}
      <audio ref={audioRef} style={{ display: 'none' }} />
    </div>
  );
}

function MessageBubble({ msg, isSpeaking, canSpeak, onSpeak }: {
  msg: Message; isSpeaking: boolean; canSpeak: boolean; onSpeak: () => void;
}) {
  const isUser = msg.role === 'user';
  const isSystem = msg.role === 'system';

  if (isSystem) {
    return (
      <div style={styles.systemMsg}>
        <span>{msg.content}</span>
      </div>
    );
  }

  return (
    <div style={{ ...styles.bubbleRow, ...(isUser ? styles.bubbleRowUser : {}) }}>
      {!isUser && <div style={styles.avatar}>⚡</div>}
      <div style={{ ...styles.bubble, ...(isUser ? styles.bubbleUser : styles.bubbleAi) }}>
        <div style={styles.bubbleContent}>{msg.content}</div>
        <div style={styles.bubbleMeta}>
          {msg.provider && (
            <span style={{ ...styles.providerTag, color: PROVIDER_COLORS[msg.provider.toLowerCase()] ?? 'var(--text-muted)' }}>
              {msg.provider}
            </span>
          )}
          <span style={styles.timestamp}>
            {msg.timestamp.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
          </span>
          {!isUser && canSpeak && (
            <button style={{ ...styles.speakBtn, ...(isSpeaking ? styles.speakBtnActive : {}) }}
              onClick={onSpeak} title="Read aloud">
              🔊
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

function TypingIndicator() {
  return (
    <div style={styles.bubbleRow}>
      <div style={styles.avatar}>⚡</div>
      <div style={{ ...styles.bubble, ...styles.bubbleAi, padding: '12px 16px' }}>
        <div style={styles.typingDots}>
          <span /><span /><span />
        </div>
      </div>
    </div>
  );
}

function getWelcomeMessage(mode: string, keys: Record<string, boolean>): string {
  const active = Object.entries(keys).filter(([, v]) => v).map(([k]) => k);
  if (active.length === 0) {
    return '👋 Welcome to TriForge AI! To get started, go to Settings → API Keys and add at least one key (OpenAI, Claude, or Gemini).';
  }
  if (active.length === 1) {
    return `👋 Welcome! I'm running in single-provider mode with ${active[0]}. Add more API keys to unlock full consensus mode.`;
  }
  return `👋 Welcome to TriForge AI! Your personal think tank is active with ${active.length} AI models in ${MODE_LABELS[mode] ?? mode} mode. What do you need help with today?`;
}

const MODE_LABELS: Record<string, string> = {
  none: 'No providers',
  single: 'Single provider',
  pair: 'Pair mode',
  consensus: 'Consensus mode',
};

const styles: Record<string, React.CSSProperties> = {
  container: { display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' },

  statusBar: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0 },
  statusDots: { display: 'flex', gap: 5 },
  dot: { width: 8, height: 8, borderRadius: '50%', transition: 'background 0.3s' },
  modeLabel: { fontSize: 11, color: 'var(--text-muted)', marginLeft: 4, fontWeight: 500 },
  quotaLabel: { fontSize: 11, color: 'var(--text-muted)', fontWeight: 500 },
  quotaAtLimit: { color: '#ef4444', fontWeight: 700 },

  messages: { flex: 1, overflowY: 'auto', padding: '16px', display: 'flex', flexDirection: 'column', gap: 12 },

  systemMsg: { textAlign: 'center', color: 'var(--text-secondary)', fontSize: 13, padding: '8px 16px', background: 'var(--bg-elevated)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)' },

  bubbleRow: { display: 'flex', gap: 10, alignItems: 'flex-end', maxWidth: '80%' },
  bubbleRowUser: { alignSelf: 'flex-end', flexDirection: 'row-reverse' },
  avatar: { width: 28, height: 28, borderRadius: '50%', background: 'linear-gradient(135deg, var(--accent), var(--purple))', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, flexShrink: 0 },
  bubble: { borderRadius: 'var(--radius)', padding: '10px 14px', maxWidth: '100%', wordBreak: 'break-word' },
  bubbleUser: { background: 'var(--user-bubble)', color: 'var(--text-primary)' },
  bubbleAi: { background: 'var(--bg-elevated)', border: '1px solid var(--border)', color: 'var(--text-primary)' },
  bubbleContent: { fontSize: 14, lineHeight: 1.6, whiteSpace: 'pre-wrap' },
  bubbleMeta: { display: 'flex', alignItems: 'center', gap: 8, marginTop: 6 },
  providerTag: { fontSize: 10, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.06em' },
  timestamp: { fontSize: 11, color: 'var(--text-muted)' },
  speakBtn: { fontSize: 12, background: 'none', border: 'none', cursor: 'pointer', opacity: 0.5, padding: '0 2px' },
  speakBtnActive: { opacity: 1 },

  typingDots: { display: 'flex', gap: 4, alignItems: 'center' },

  quickActions: { display: 'flex', flexWrap: 'wrap', gap: 8, padding: '0 16px 12px' },
  quickBtn: { background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 20, color: 'var(--text-secondary)', fontSize: 12, padding: '6px 14px', cursor: 'pointer', transition: 'all 0.2s' },

  actionToolbar: {
    display: 'flex', gap: 6, padding: '6px 16px 0', flexShrink: 0, overflowX: 'auto',
    borderTop: '1px solid var(--border)',
  },
  actionBtn: {
    display: 'flex', alignItems: 'center', gap: 5,
    background: 'var(--bg-elevated)', border: '1px solid var(--border)',
    borderRadius: 8, color: 'var(--text-secondary)', fontSize: 12,
    padding: '5px 10px', cursor: 'pointer', whiteSpace: 'nowrap' as const,
    transition: 'background 0.15s',
    flexShrink: 0,
  },
  actionLabel: { fontSize: 11, fontWeight: 500 },

  inputArea: { display: 'flex', alignItems: 'flex-end', gap: 10, padding: '10px 16px 12px', background: 'var(--bg-surface)', flexShrink: 0 },
  inputWrapper: { flex: 1 },
  textarea: {
    width: '100%', background: 'var(--bg-input)', border: '1px solid var(--border)',
    borderRadius: 'var(--radius-sm)', color: 'var(--text-primary)', fontSize: 14,
    padding: '10px 14px', resize: 'none', outline: 'none', fontFamily: 'var(--font)',
    lineHeight: 1.5, maxHeight: 120, overflowY: 'auto',
  },
  sendBtn: {
    width: 40, height: 40, borderRadius: '50%',
    background: 'linear-gradient(135deg, var(--accent), var(--purple))',
    border: 'none', color: '#fff', cursor: 'pointer',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    flexShrink: 0, transition: 'opacity 0.2s',
  },
  sendBtnDisabled: { opacity: 0.3, cursor: 'not-allowed' },
};
