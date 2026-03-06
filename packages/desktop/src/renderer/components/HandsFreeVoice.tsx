import { useEffect, useRef } from 'react';
import { WAKE_PHRASES } from '../voice/VoskWakeEngine';

// ── HandsFreeVoice ────────────────────────────────────────────────────────────
//
// Headless component — renders nothing. Manages a continuous speech-recognition
// loop that feeds transcripts into the Council without requiring the user to
// press any button. Siri-style: speak → Council responds → listen again.
//
// Loop logic:
//   1. Recognition starts (single-shot, not continuous)
//   2. Final result → onTranscript(text) → stops listening
//   3. After TTS ends (isSpeaking goes false) → restart recognition
//   4. If active goes false or component unmounts → clean up
//   5. 10-min inactivity → onStop() (forces new wake word to re-enter)

const INACTIVITY_MS   = 10 * 60 * 1000; // 10 minutes of user silence → exit
const WAKE_PHRASE_SET = new Set<string>(WAKE_PHRASES as unknown as string[]);

interface Props {
  /** Whether hands-free mode is currently on */
  active: boolean;
  /** True while the Council is speaking — prevents recognition restart (avoids echo) */
  isSpeaking: boolean;
  /** Called with the final transcript for the Council to process */
  onTranscript: (text: string) => void;
  /** Called when hands-free mode should be deactivated (e.g. error) */
  onStop: () => void;
}

// Local ctor type — avoids dependency on global SpeechRecognition name
type SRCtor = new() => {
  continuous:     boolean;
  interimResults: boolean;
  lang:           string;
  onresult:  ((e: Event) => void) | null;
  onerror:   ((e: Event) => void) | null;
  onend:     (() => void) | null;
  start(): void;
  stop():  void;
};

type SRResult = { isFinal: boolean; [j: number]: { transcript: string } };

function getSR(): SRCtor | undefined {
  const w = window as Window & { SpeechRecognition?: SRCtor; webkitSpeechRecognition?: SRCtor };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition;
}

export function HandsFreeVoice({ active, isSpeaking, onTranscript, onStop }: Props) {
  const recRef          = useRef<{ stop(): void } | null>(null);
  const activeRef       = useRef(active);
  const speakingRef     = useRef(isSpeaking);
  const listeningRef    = useRef(false);
  const restartTimer    = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inactivityTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep refs in sync with latest props so callbacks see current values
  useEffect(() => { activeRef.current = active; }, [active]);
  useEffect(() => { speakingRef.current = isSpeaking; }, [isSpeaking]);

  function resetInactivityTimer() {
    if (inactivityTimer.current) clearTimeout(inactivityTimer.current);
    inactivityTimer.current = setTimeout(() => {
      if (activeRef.current) {
        console.log('[HandsFreeVoice] 10 min inactivity — exiting hands-free mode');
        onStop();
      }
    }, INACTIVITY_MS);
  }

  function clearInactivityTimer() {
    if (inactivityTimer.current) { clearTimeout(inactivityTimer.current); inactivityTimer.current = null; }
  }

  // When speaking ends and we're still active, restart recognition
  useEffect(() => {
    if (!active) return;
    if (!isSpeaking && !listeningRef.current) {
      // Small delay to let the audio output fully settle before listening
      restartTimer.current = setTimeout(() => startListening(), 400);
    }
    return () => {
      if (restartTimer.current) clearTimeout(restartTimer.current);
    };
  }, [isSpeaking]); // eslint-disable-line react-hooks/exhaustive-deps

  // Start / stop the whole mode
  useEffect(() => {
    if (active) {
      resetInactivityTimer();
      startListening();
    } else {
      clearInactivityTimer();
      stopListening();
    }
    return () => { clearInactivityTimer(); stopListening(); };
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  function startListening() {
    if (!activeRef.current || speakingRef.current || listeningRef.current) return;

    const SR = getSR();
    if (!SR) { onStop(); return; }

    const rec = new SR();
    rec.continuous      = false;
    rec.interimResults  = true;
    rec.lang            = 'en-US';
    recRef.current      = rec;
    listeningRef.current = true;

    rec.onresult = (e: Event) => {
      const results = (e as Event & { results: SRResult[] }).results;
      let finalText = '';
      for (let i = 0; i < results.length; i++) {
        if (results[i].isFinal) finalText += results[i][0].transcript;
      }
      const trimmed = finalText.trim();
      if (!trimmed) return;

      // If user said only a wake phrase (e.g. "council") — already in session,
      // just keep listening rather than sending it as a message.
      if (WAKE_PHRASE_SET.has(trimmed.toLowerCase())) {
        stopListening();
        // restart immediately to keep listening
        restartTimer.current = setTimeout(() => startListening(), 200);
        return;
      }

      resetInactivityTimer();
      onTranscript(trimmed);
      stopListening();
    };

    rec.onerror = () => {
      listeningRef.current = false;
      recRef.current = null;
      // Non-fatal — restart after a short delay if still active
      if (activeRef.current && !speakingRef.current) {
        restartTimer.current = setTimeout(() => startListening(), 800);
      }
    };

    rec.onend = () => {
      listeningRef.current = false;
      recRef.current = null;
      // If we ended without a transcript (e.g. silence timeout), restart if still active
      if (activeRef.current && !speakingRef.current) {
        restartTimer.current = setTimeout(() => startListening(), 300);
      }
    };

    try {
      rec.start();
    } catch {
      listeningRef.current = false;
      recRef.current = null;
    }
  }

  function stopListening() {
    if (restartTimer.current) { clearTimeout(restartTimer.current); restartTimer.current = null; }
    recRef.current?.stop();
    recRef.current = null;
    listeningRef.current = false;
  }

  return null; // headless — no visual output
}
