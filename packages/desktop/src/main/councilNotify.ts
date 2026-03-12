// ── councilNotify.ts ──────────────────────────────────────────────────────────
//
// Pushes council updates to all paired remote devices via the PhoneLinkServer's
// update queue. Devices poll GET /remote/updates?since=N to receive these.
//
// Also integrates with councilBus so Council events automatically flow to
// paired devices without manual wiring.

import type { PhoneLinkServer } from './phoneLink';
import { councilBus } from '@triforge/engine';

let _server: PhoneLinkServer | null = null;

/** Register the PhoneLinkServer instance. Call once during setup. */
export function initCouncilNotify(server: PhoneLinkServer): void {
  _server = server;

  // Forward council results to paired devices automatically
  councilBus.on('RESULT', (data: unknown) => {
    const d = data as { planId?: string; stepCount?: number };
    sendRemoteUpdate(`Plan ready: ${d.stepCount ?? 0} steps.`);
  });

  councilBus.on('CRITIQUE', (data: unknown) => {
    const d = data as { critique?: string };
    if (d.critique && d.critique !== 'Critique unavailable.') {
      sendRemoteUpdate(`Council critique: ${d.critique.slice(0, 200)}`);
    }
  });
}

/**
 * Push a text notification to all paired devices' update queues.
 * Devices receive it the next time they poll /remote/updates.
 *
 * @param text    - The message to push.
 * @param taskId  - Optional task identifier (defaults to 'council').
 */
export function sendRemoteUpdate(text: string, taskId = 'council'): void {
  _server?.pushUpdate(text, taskId);
}

/** Convenience: notify paired devices that a council suggestion is available. */
export function sendCouncilSuggestion(suggestion: string): void {
  sendRemoteUpdate(`Council: ${suggestion}`, 'suggestion');
}

/** Convenience: notify paired devices that a response is ready. */
export function sendResponseReady(summary: string): void {
  sendRemoteUpdate(`Response ready: ${summary.slice(0, 160)}`, 'response');
}

// ── Venture Discovery notifications ──────────────────────────────────────────

/** Push a formatted venture proposal to paired devices. */
export function sendVentureProposal(formattedText: string): void {
  sendRemoteUpdate(formattedText, 'venture:proposal');
}

/** Push a venture build progress update. */
export function sendVentureBuildUpdate(proposalId: string, phase: string): void {
  sendRemoteUpdate(`Venture ${proposalId.slice(0, 8)}: ${phase}`, 'venture:build');
}

/** Push a filing decision prompt. */
export function sendVentureFilingPrompt(proposalId: string, summary: string): void {
  sendRemoteUpdate(
    `FILING DECISION NEEDED\n${summary}\n\nReply: FILE NOW | WAIT | ASK AGAIN LATER\nPOST /remote/venture/${proposalId}/filing`,
    'venture:filing',
  );
}

/** Push a daily pulse summary. */
export function sendVentureDailyPulse(pulseText: string): void {
  sendRemoteUpdate(pulseText, 'venture:pulse');
}
