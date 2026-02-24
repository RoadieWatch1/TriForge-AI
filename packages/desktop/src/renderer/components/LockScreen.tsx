import React, { useState, useRef, useEffect } from 'react';

interface Props {
  username: string | null;  // pre-fill username if known
  onUnlock: () => void;
}

export function LockScreen({ username: knownUser, onUnlock }: Props) {
  const [username, setUsername] = useState(knownUser ?? '');
  const [pin, setPin] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState(false);
  const [shake, setShake] = useState(false);
  const pinRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    // Auto-focus username or PIN on mount
    if (!knownUser) {
      document.getElementById('lock-username')?.focus();
    } else {
      pinRef.current?.focus();
    }
  }, [knownUser]);

  const handlePinChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value.replace(/\D/g, '').slice(0, 7);
    setPin(val);
    setError(null);
  };

  const verify = async () => {
    if (!username.trim() || pin.length !== 7) return;
    setVerifying(true);
    setError(null);
    try {
      const result = await window.triforge.auth.verify(username.trim(), pin);
      if (result.valid) {
        onUnlock();
      } else {
        setError('Wrong username or PIN. Try again.');
        setPin('');
        pinRef.current?.focus();
        setShake(true);
        setTimeout(() => setShake(false), 500);
      }
    } catch {
      setError('Could not verify. Please try again.');
    } finally {
      setVerifying(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') verify();
  };

  const dots = Array.from({ length: 7 }, (_, i) => (
    <div key={i} style={{ ...styles.dot, ...(i < pin.length ? styles.dotFilled : {}) }} />
  ));

  return (
    <div style={styles.overlay}>
      <div style={{ ...styles.card, ...(shake ? styles.shake : {}) }}>
        {/* Logo */}
        <div style={styles.logo}>⚡</div>
        <h1 style={styles.appName}>TriForge AI</h1>
        <p style={styles.prompt}>Identify yourself</p>

        {/* Username */}
        <input
          id="lock-username"
          style={styles.input}
          placeholder="Username"
          value={username}
          onChange={e => { setUsername(e.target.value); setError(null); }}
          onKeyDown={handleKeyDown}
          autoComplete="off"
          spellCheck={false}
          disabled={verifying}
        />

        {/* PIN dots display */}
        <div style={styles.dotsRow}>{dots}</div>

        {/* Hidden numeric PIN input */}
        <input
          ref={pinRef}
          style={styles.pinInput}
          type="tel"
          inputMode="numeric"
          pattern="[0-9]*"
          placeholder="7-digit PIN"
          value={pin}
          onChange={handlePinChange}
          onKeyDown={handleKeyDown}
          autoComplete="off"
          disabled={verifying}
          maxLength={7}
        />

        {/* Error */}
        {error && <div style={styles.errorMsg}>{error}</div>}

        {/* Unlock button */}
        <button
          style={{
            ...styles.unlockBtn,
            ...(!username.trim() || pin.length !== 7 || verifying ? styles.unlockBtnDisabled : {}),
          }}
          onClick={verify}
          disabled={!username.trim() || pin.length !== 7 || verifying}
        >
          {verifying ? 'Verifying…' : 'Unlock'}
        </button>

        <p style={styles.hint}>
          Say <strong style={{ color: 'var(--accent)' }}>TriForge</strong> to activate
        </p>
      </div>
    </div>
  );
}

// ── Styles ──────────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  overlay: {
    position: 'fixed', inset: 0, zIndex: 9999,
    background: 'var(--bg-base)',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    WebkitAppRegion: 'drag' as never,
  },
  card: {
    WebkitAppRegion: 'no-drag' as never,
    display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14,
    padding: '48px 40px',
    background: 'var(--bg-surface)', border: '1px solid var(--border)',
    borderRadius: 20,
    boxShadow: '0 32px 80px rgba(0,0,0,0.6)',
    width: 340,
    animation: 'fadeInUp 0.3s ease',
  },
  shake: {
    animation: 'shake 0.4s ease',
  },
  logo: {
    fontSize: 48, lineHeight: 1,
    filter: 'drop-shadow(0 0 16px var(--accent))',
  },
  appName: {
    margin: 0, fontSize: 22, fontWeight: 800,
    color: 'var(--text-primary)', letterSpacing: '-0.02em',
  },
  prompt: {
    margin: 0, fontSize: 14, color: 'var(--text-secondary)',
    marginBottom: 4,
  },
  input: {
    width: '100%', boxSizing: 'border-box' as const,
    background: 'var(--bg-input)', border: '1px solid var(--border)',
    borderRadius: 10, color: 'var(--text-primary)', fontSize: 15,
    padding: '10px 14px', fontFamily: 'var(--font)',
    outline: 'none',
  },
  dotsRow: {
    display: 'flex', gap: 10, justifyContent: 'center',
    padding: '6px 0',
  },
  dot: {
    width: 14, height: 14, borderRadius: '50%',
    background: 'var(--bg-input)', border: '2px solid var(--border)',
    transition: 'background 0.15s, border-color 0.15s',
  },
  dotFilled: {
    background: 'var(--accent)', borderColor: 'var(--accent)',
  },
  pinInput: {
    width: '100%', boxSizing: 'border-box' as const,
    background: 'var(--bg-input)', border: '1px solid var(--border)',
    borderRadius: 10, color: 'var(--text-primary)', fontSize: 22,
    padding: '10px 14px', fontFamily: 'monospace', letterSpacing: '0.3em',
    textAlign: 'center', outline: 'none',
  },
  errorMsg: {
    background: '#ef444420', border: '1px solid #ef4444',
    borderRadius: 8, color: '#ef4444', fontSize: 13,
    padding: '8px 12px', width: '100%', boxSizing: 'border-box' as const,
    textAlign: 'center',
  },
  unlockBtn: {
    width: '100%', padding: '12px 0',
    background: 'linear-gradient(135deg, var(--accent), var(--purple))',
    border: 'none', borderRadius: 10, color: '#fff',
    fontSize: 15, fontWeight: 700, cursor: 'pointer',
  },
  unlockBtnDisabled: {
    opacity: 0.4, cursor: 'not-allowed',
  },
  hint: {
    margin: 0, fontSize: 12, color: 'var(--text-muted)',
    textAlign: 'center',
  },
};
