// ── CouncilDecisionBus.ts — Council consensus signal bus ─────────────────────
//
// Emits a signal when ExperimentEngine selects a winner from competing candidate
// plans. The IPC layer forwards this to the renderer (triangle merge animation,
// confirmation tone).
//
// Usage:
//   emitConsensus({ missionId, winnerId, score, candidateCount, ts: Date.now() });
//   onConsensus((e) => mainWindow?.webContents.send('council:consensus', e));

import { EventEmitter } from 'events';

export interface ConsensusEvent {
  missionId:      string;
  winnerId:       string;
  score:          number;
  candidateCount: number;
  ts:             number;
}

class CouncilBus extends EventEmitter {}

/** Singleton bus for council consensus signals. */
export const councilBus = new CouncilBus();

/** Emit a consensus signal — call from ExperimentEngine/MissionController after winner is chosen. */
export function emitConsensus(event: ConsensusEvent): void {
  councilBus.emit('council:consensus', event);
}

/** Subscribe to consensus events. Returns an unsubscribe function. */
export function onConsensus(handler: (e: ConsensusEvent) => void): () => void {
  councilBus.on('council:consensus', handler);
  return () => councilBus.off('council:consensus', handler);
}

// ── consensus_meta — richer signal with approach metadata ─────────────────────
// Emitted alongside council:consensus. The renderer uses this to show the
// winning approach name and score in the triangle merge animation.

export interface ConsensusMetaEvent {
  missionId:      string;
  winnerApproach: string;
  score:          number;
  risks?:         string[];
  reason?:        string;
  ts:             number;
}

/** Emit extended consensus metadata — call immediately after emitConsensus(). */
export function emitConsensusMeta(event: ConsensusMetaEvent): void {
  councilBus.emit('council:consensus_meta', event);
}

/** Subscribe to consensus_meta events. Returns an unsubscribe function. */
export function onConsensusMeta(handler: (e: ConsensusMetaEvent) => void): () => void {
  councilBus.on('council:consensus_meta', handler);
  return () => councilBus.off('council:consensus_meta', handler);
}
