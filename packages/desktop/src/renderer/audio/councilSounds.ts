// ── councilSounds.ts — Web Audio API feedback tones ──────────────────────────
//
// All sounds are generated via oscillators — zero file dependencies.
// Every function is non-throwing; failures are silently swallowed.
//
// Sounds:
//   playWakeTone()       — upward sweep (880→1100 Hz, 200ms) [reused from wakeTone.ts]
//   playListeningTone()  — soft low pulse (440 Hz, 120ms)
//   playThinkingHum()    — 60Hz sub-hum, 600ms fade
//   playConsensusTone()  — bright chord (523+659+784 Hz, 500ms)
//   playErrorTone()      — descending minor (440→330 Hz, 300ms)

function ac(): AudioContext | null {
  try {
    const AC = window.AudioContext
      ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    return new AC();
  } catch { return null; }
}

function tone(
  ctx:        AudioContext,
  freq:       number,
  startHz:    number | null,
  endHz:      number | null,
  durationMs: number,
  volume:     number,
  type:       OscillatorType = 'sine',
): void {
  const osc  = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.type = type;
  osc.frequency.setValueAtTime(startHz ?? freq, ctx.currentTime);
  if (endHz !== null) {
    osc.frequency.exponentialRampToValueAtTime(endHz, ctx.currentTime + durationMs / 1000);
  }

  gain.gain.setValueAtTime(volume, ctx.currentTime);
  gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + durationMs / 1000);

  osc.start(ctx.currentTime);
  osc.stop(ctx.currentTime + durationMs / 1000 + 0.01);
  osc.onended = () => ctx.close();
}

/** 880→1100 Hz upward sweep — wake word confirmed. */
export function playWakeTone(): void {
  const ctx = ac(); if (!ctx) return;
  tone(ctx, 880, 880, 1100, 200, 0.08);
}

/** 440 Hz soft pulse — council is listening. */
export function playListeningTone(): void {
  const ctx = ac(); if (!ctx) return;
  tone(ctx, 440, 440, null, 120, 0.05);
}

/** 60 Hz sub-hum — council is thinking. */
export function playThinkingHum(): void {
  const ctx = ac(); if (!ctx) return;
  tone(ctx, 60, 60, null, 600, 0.04, 'triangle');
}

/**
 * Bright major chord (C5 + E5 + G5) — consensus reached.
 * Three oscillators fired simultaneously for chord effect.
 */
export function playConsensusTone(): void {
  const ctx = ac(); if (!ctx) return;
  const freqs = [523.25, 659.25, 783.99]; // C5, E5, G5
  for (const f of freqs) {
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.value = f;
    gain.gain.setValueAtTime(0.06, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.5);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.52);
    osc.onended = () => { try { ctx.close(); } catch { /* ignore */ } };
  }
}

/** 440→330 Hz descending — error or access denied. */
export function playErrorTone(): void {
  const ctx = ac(); if (!ctx) return;
  tone(ctx, 440, 440, 330, 300, 0.07);
}

/** Ascending double-beep — shadow trade opened (copy-trade signal). */
export function playTradeOpenTone(): void {
  const ctx = ac(); if (!ctx) return;
  tone(ctx, 660, 660, 880, 150, 0.06);
  setTimeout(() => { const c = ac(); if (c) tone(c, 880, 880, 1100, 150, 0.06); }, 180);
}

/** Trade closed tone — ascending for profit, descending for loss. */
export function playTradeCloseTone(isProfit: boolean): void {
  const ctx = ac(); if (!ctx) return;
  if (isProfit) tone(ctx, 880, 880, 1320, 200, 0.05);
  else          tone(ctx, 660, 660, 440, 200, 0.05);
}
