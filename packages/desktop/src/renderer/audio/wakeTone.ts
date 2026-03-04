// ── wakeTone.ts ───────────────────────────────────────────────────────────────
//
// Plays the council wake acknowledgement tone using the Web Audio API.
//
// Characteristics:
//   - Duration: ~200ms
//   - Frequency: 880Hz → 1100Hz (A5, quick upward sweep)
//   - Volume: 0.08 (subtle confirmation, not distracting)
//   - No file dependency — generated entirely via oscillator
//
// Extracted from WakeWordListener so any renderer component can trigger the
// tone independently (e.g. programmatic wake activation from the UI).

export function playCouncilWakeTone(): void {
  try {
    const AC =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;

    const ctx  = new AC();
    const osc  = ctx.createOscillator();
    const gain = ctx.createGain();

    osc.connect(gain);
    gain.connect(ctx.destination);

    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(1100, ctx.currentTime + 0.08);

    gain.gain.setValueAtTime(0.08, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.18);

    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.2);
    osc.onended = () => ctx.close();
  } catch {
    // AudioContext unavailable in this context — skip tone silently
  }
}
