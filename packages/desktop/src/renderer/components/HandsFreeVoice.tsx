import { useEffect, useRef } from 'react';

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

export function HandsFreeVoice({ active, isSpeaking, onTranscript, onStop }: Props) {
  const recRef       = useRef<SpeechRecognition | null>(null);
  const activeRef    = useRef(active);
  const speakingRef  = useRef(isSpeaking);
  const listeningRef = useRef(false);
  const restartTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep refs in sync with latest props so callbacks see current values
  useEffect(() => { activeRef.current = active; }, [active]);
  useEffect(() => { speakingRef.current = isSpeaking; }, [isSpeaking]);

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
      startListening();
    } else {
      stopListening();
    }
    return () => stopListening();
  }, [active]); // eslint-disable-line react-hooks/exhaustive-deps

  function startListening() {
    if (!activeRef.current || speakingRef.current || listeningRef.current) return;

    const SR = window.SpeechRecognition ?? window.webkitSpeechRecognition;
    if (!SR) { onStop(); return; }

    const rec = new SR();
    rec.continuous      = false;
    rec.interimResults  = true;
    rec.lang            = 'en-US';
    recRef.current      = rec;
    listeningRef.current = true;

    rec.onresult = (e: SpeechRecognitionEvent) => {
      // Collect all results — use the last final transcript
      let finalText = '';
      for (let i = 0; i < e.results.length; i++) {
        if (e.results[i].isFinal) finalText += e.results[i][0].transcript;
      }
      if (finalText.trim()) {
        onTranscript(finalText.trim());
        stopListening();
      }
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

// Web Speech API type declarations (Electron/Chromium supports these)
declare global {
  interface Window {
    SpeechRecognition?: new () => SpeechRecognition;
    webkitSpeechRecognition?: new () => SpeechRecognition;
  }
}
