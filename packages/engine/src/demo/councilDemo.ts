// ── councilDemo.ts ────────────────────────────────────────────────────────────
//
// Council Demonstration Moment — runs a scripted council interaction at startup
// so new users immediately understand what TriForge does.
//
// The demo emits events on councilBus at timed intervals. The IPC layer listens
// and forwards them to the renderer via 'council:demo' IPC events so the UI
// can react (seat glow, thinking indicator) without new UI components.
//
// Demo sequence (total ~5 seconds):
//   500ms  — Claude begins reasoning  (demo:thinking)
//   1500ms — Grok challenges          (demo:challenge)
//   2500ms — OpenAI synthesizes       (demo:synthesis)
//   4000ms — Consensus reached        (demo:consensus)
//   5000ms — Demo ends                (demo:end)
//
// Integration (ipc.ts, called once at app start):
//   const { stopCouncilDemo } = startCouncilDemo(hasAnyKey);
//   // stopCouncilDemo() cancels if user sends a message during the demo.

import { councilBus } from '../events/buses';

export interface DemoHandle {
  stop: () => void;
}

const SEQUENCE: Array<{ delayMs: number; phase: string; label: string }> = [
  { delayMs: 500,  phase: 'demo:thinking',  label: 'Claude is reasoning…'           },
  { delayMs: 1500, phase: 'demo:challenge',  label: 'Grok is challenging…'           },
  { delayMs: 2500, phase: 'demo:synthesis',  label: 'OpenAI is synthesizing…'        },
  { delayMs: 4000, phase: 'demo:consensus',  label: 'Council reached consensus'      },
  { delayMs: 5000, phase: 'demo:end',        label: 'Council Ready'                  },
];

/**
 * Start the council demonstration sequence.
 *
 * @param enabled - Pass false to skip the demo (e.g. user already has API keys
 *   configured and the council is not needed for onboarding).
 * @returns A handle with a `stop()` method to cancel the demo early.
 */
export function startCouncilDemo(enabled = true): DemoHandle {
  const timers: ReturnType<typeof setTimeout>[] = [];
  let stopped = false;

  if (enabled) {
    for (const { delayMs, phase, label } of SEQUENCE) {
      const t = setTimeout(() => {
        if (stopped) return;
        councilBus.emit('COUNCIL_DEMO', { phase, label });
      }, delayMs);
      timers.push(t);
    }
  }

  return {
    stop: () => {
      stopped = true;
      for (const t of timers) clearTimeout(t);
    },
  };
}
