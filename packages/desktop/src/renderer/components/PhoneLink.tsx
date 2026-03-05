// PhoneLink.tsx — Phone Link pairing panel
import React, { useState, useEffect, useCallback, useRef } from 'react';

interface PairInfo { pairUrl: string; pairToken: string; qrData: string; }
interface ServerStatus { running: boolean; port: number; url: string; pairedDevices: number; }

export function PhoneLink() {
  const [status,       setStatus]       = useState<ServerStatus | null>(null);
  const [pairInfo,     setPairInfo]     = useState<PairInfo | null>(null);
  const [loading,      setLoading]      = useState(true);
  const [starting,     setStarting]     = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [copied,       setCopied]       = useState(false);
  const [qrError,      setQrError]      = useState(false);
  const [error,        setError]        = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const refreshStatus = useCallback(async () => {
    try { const s = await window.triforge.phoneLink.status(); setStatus(s as ServerStatus); } catch { /* non-fatal */ }
  }, []);

  // Poll paired-device count every 5s while server is running
  useEffect(() => {
    if (status?.running) {
      pollRef.current = setInterval(refreshStatus, 5000);
    } else {
      if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null; }
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [status?.running, refreshStatus]);

  useEffect(() => {
    refreshStatus().finally(async () => {
      setLoading(false);
      // Auto-generate a pairing code if the server is already running
      try {
        const s = await window.triforge.phoneLink.status() as ServerStatus;
        if (s?.running) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const p: any = await window.triforge.phoneLink.pair();
          if (p?.pairUrl) setPairInfo({ pairUrl: p.pairUrl, pairToken: p.pairToken, qrData: p.qrData });
        }
      } catch { /* non-fatal */ }
    });
  }, [refreshStatus]);

  const handleStart = async () => {
    setStarting(true); setError(null); setQrError(false);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r: any = await window.triforge.phoneLink.start();
      if (r?.error) { setError(r.error); return; }
      await refreshStatus();
      if (r?.pairUrl) {
        setPairInfo({ pairUrl: r.pairUrl, pairToken: r.pairToken, qrData: r.qrData });
      } else {
        // Server already running — generate fresh code
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const p: any = await window.triforge.phoneLink.pair();
        if (p?.pairUrl) setPairInfo({ pairUrl: p.pairUrl, pairToken: p.pairToken, qrData: p.qrData });
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to start server'); }
    finally { setStarting(false); }
  };

  const handleStop = async () => {
    await window.triforge.phoneLink.stop(); setPairInfo(null); await refreshStatus();
  };

  const handleNewCode = async () => {
    setRegenerating(true); setError(null); setQrError(false);
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const r: any = await window.triforge.phoneLink.pair();
      if (r?.error) { setError(r.error); return; }
      if (r?.pairUrl) setPairInfo({ pairUrl: r.pairUrl, pairToken: r.pairToken, qrData: r.qrData });
    } catch (e) { setError(e instanceof Error ? e.message : 'Failed to generate code'); }
    finally { setRegenerating(false); }
  };

  const handleCopy = async () => {
    if (!pairInfo?.pairUrl) return;
    await navigator.clipboard.writeText(pairInfo.pairUrl);
    setCopied(true); setTimeout(() => setCopied(false), 1500);
  };

  if (loading) {
    return <div style={cs.page}><div style={cs.loadingMsg}>Checking server status...</div></div>;
  }

  return (
    <div style={cs.page}>
      <h2 style={cs.heading}>Phone Link</h2>
      <p style={cs.desc}>
        Connect any phone or tablet on the same Wi-Fi to control TriForge remotely
        and receive real-time council notifications.
      </p>

      {/* ── Status card ─────────────────────────────────────────────────── */}
      <div style={cs.card}>
        <div style={cs.statusRow}>
          <div style={cs.statusLeft}>
            <span style={{ ...cs.dot, background: status?.running ? '#10a37f' : '#4b4b5e' }} />
            <span style={cs.statusText}>
              {status?.running ? `Running on port ${status.port}` : 'Server offline'}
            </span>
          </div>
          <button
            style={status?.running ? cs.stopBtn : cs.primaryBtn}
            disabled={starting}
            onClick={status?.running ? handleStop : handleStart}
          >
            {starting ? 'Starting...' : status?.running ? 'Stop Server' : 'Start Server'}
          </button>
        </div>
        {status?.running && (
          <div style={cs.pairedCount}>
            <span style={cs.pairedNum}>{status.pairedDevices ?? 0}</span>
            {' '}device{(status.pairedDevices ?? 0) !== 1 ? 's' : ''} paired
          </div>
        )}
      </div>

      {error && <div style={cs.errorMsg}>{error}</div>}

      {/* ── QR / pairing card ───────────────────────────────────────────── */}
      {status?.running && (
        <div style={cs.pairCard}>
          <p style={cs.pairTitle}>Scan to pair your device</p>
          {pairInfo ? (
            <>
              {!qrError ? (
                <img
                  src={pairInfo.qrData}
                  alt="Pairing QR code"
                  style={cs.qrImg}
                  onError={() => setQrError(true)}
                />
              ) : (
                <div style={cs.qrFallback}>QR unavailable — use the URL below</div>
              )}
              <p style={cs.urlLabel}>Or open this URL on your device:</p>
              <div style={cs.urlBox}>{pairInfo.pairUrl}</div>
              <div style={cs.btnRow}>
                <button style={cs.secondaryBtn} onClick={handleCopy}>
                  {copied ? 'Copied!' : 'Copy URL'}
                </button>
                <button style={cs.secondaryBtn} disabled={regenerating} onClick={handleNewCode}>
                  {regenerating ? 'Generating...' : 'New Code'}
                </button>
              </div>
            </>
          ) : (
            <div style={cs.noPairWrap}>
              <p style={cs.noPairText}>Generate a pairing code to connect a device.</p>
              <button style={cs.primaryBtn} disabled={regenerating} onClick={handleNewCode}>
                {regenerating ? 'Generating...' : 'Generate Pairing Code'}
              </button>
            </div>
          )}
        </div>
      )}

      {/* ── Instructions ────────────────────────────────────────────────── */}
      <div style={cs.instrCard}>
        <p style={cs.instrTitle}>How it works</p>
        {[
          'Make sure your phone is on the same Wi-Fi network as this computer.',
          'Start the server, then generate a pairing code.',
          'Scan the QR code or open the URL in your phone browser.',
          'Your device pairs automatically and starts receiving council updates.',
          'Tap New Code to revoke and re-pair a device at any time.',
        ].map((step, i) => (
          <div key={i} style={cs.instrRow}>
            <span style={cs.instrNum}>{i + 1}</span>
            <span style={cs.instrText}>{step}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────
const cs: Record<string, React.CSSProperties> = {
  page:        { flex: 1, overflowY: 'auto', padding: 24, maxWidth: 560 },
  heading:     { fontSize: 18, fontWeight: 700, color: 'var(--text-primary)', margin: '0 0 6px' },
  desc:        { fontSize: 13, color: 'var(--text-secondary)', margin: '0 0 20px', lineHeight: 1.5 },
  loadingMsg:  { color: 'var(--text-muted)', fontSize: 13, padding: 24 },

  card:        { background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '14px 16px', marginBottom: 12 },
  statusRow:   { display: 'flex', alignItems: 'center', justifyContent: 'space-between' },
  statusLeft:  { display: 'flex', alignItems: 'center', gap: 8 },
  dot:         { width: 8, height: 8, borderRadius: '50%', flexShrink: 0 },
  statusText:  { fontSize: 13, color: 'var(--text-primary)', fontWeight: 500 },
  pairedCount: { marginTop: 8, fontSize: 12, color: 'var(--text-secondary)' },
  pairedNum:   { color: 'var(--accent)', fontWeight: 700 },

  pairCard:    { background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '20px 24px', marginBottom: 12, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 14 },
  pairTitle:   { fontSize: 14, fontWeight: 600, color: 'var(--text-primary)', margin: 0 },
  qrImg:       { width: 200, height: 200, borderRadius: 10, display: 'block', background: '#fff', padding: 8, boxSizing: 'border-box' },
  qrFallback:  { width: 200, height: 200, borderRadius: 10, background: 'var(--bg-input)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 12, color: 'var(--text-muted)', textAlign: 'center', padding: 16, boxSizing: 'border-box' },
  urlLabel:    { fontSize: 12, color: 'var(--text-secondary)', margin: 0 },
  urlBox:      { background: 'var(--bg-input)', border: '1px solid var(--border)', borderRadius: 6, padding: '7px 12px', fontSize: 11, color: 'var(--text-secondary)', fontFamily: 'monospace', wordBreak: 'break-all', textAlign: 'center', width: '100%', boxSizing: 'border-box' },
  noPairWrap:  { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 },
  noPairText:  { fontSize: 13, color: 'var(--text-secondary)', margin: 0 },

  btnRow:      { display: 'flex', gap: 8 },
  primaryBtn:  { background: 'var(--accent)', color: '#fff', border: 'none', borderRadius: 6, padding: '7px 16px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  stopBtn:     { background: 'none', color: '#ef4444', border: '1px solid rgba(239,68,68,0.4)', borderRadius: 6, padding: '7px 14px', fontSize: 13, fontWeight: 600, cursor: 'pointer' },
  secondaryBtn:{ background: 'none', border: '1px solid var(--border)', color: 'var(--text-secondary)', borderRadius: 6, padding: '6px 12px', fontSize: 12, cursor: 'pointer' },
  errorMsg:    { background: '#ef444420', border: '1px solid #ef4444', borderRadius: 8, color: '#ef4444', fontSize: 13, padding: '8px 12px', marginBottom: 12 },

  instrCard:   { background: 'var(--bg-elevated)', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', padding: '14px 16px' },
  instrTitle:  { fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', margin: '0 0 10px' },
  instrRow:    { display: 'flex', gap: 10, marginBottom: 8, alignItems: 'flex-start' },
  instrNum:    { color: 'var(--accent)', fontWeight: 700, fontSize: 13, minWidth: 16, flexShrink: 0 },
  instrText:   { fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.45 },
};
