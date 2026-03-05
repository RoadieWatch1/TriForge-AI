// ── MissionQueue.ts — Priority queue with dedup for one-shot missions ────────
//
// Behaviours:
//   • FIFO within same priority tier (urgent > high > normal > low)
//   • Deduplicates missions with the same intent within DEDUP_WINDOW_MS
//   • Max queue depth capped at MAX_DEPTH (oldest low-priority items evicted)
//   • Pausing stops next() from resolving until resumed

import crypto from 'crypto';
import { EventEmitter } from 'events';
import type { QueuedMission, MissionPriority, MissionSource } from './MissionTypes';
import { PRIORITY_WEIGHT } from './MissionTypes';

const DEDUP_WINDOW_MS = 20_000; // 20 s
const MAX_DEPTH       = 50;

export class MissionQueue extends EventEmitter {
  private _items:  QueuedMission[] = [];
  private _paused = false;

  // ── Enqueue ───────────────────────────────────────────────────────────────

  /**
   * Add a mission to the queue.
   * Returns the new mission, or the existing duplicate if deduplicated.
   */
  enqueue(opts: {
    source:           MissionSource;
    intent:           string;
    raw:              string;
    priority?:        MissionPriority;
    requiresApproval?: boolean;
    payload?:         Record<string, unknown>;
  }): QueuedMission {
    const now = Date.now();
    const priority = opts.priority ?? 'normal';

    // Dedup: same intent within window?
    const dup = this._items.find(
      m => m.intent === opts.intent && now - m.createdAt < DEDUP_WINDOW_MS,
    );
    if (dup) return dup;

    const mission: QueuedMission = {
      id:               crypto.randomUUID(),
      createdAt:        now,
      source:           opts.source,
      intent:           opts.intent,
      raw:              opts.raw,
      priority,
      requiresApproval: opts.requiresApproval ?? true,
      status:           'queued',
      payload:          opts.payload,
    };

    // Evict excess low-priority items if at cap
    if (this._items.length >= MAX_DEPTH) {
      const lowIdx = this._items.findLastIndex(m => m.priority === 'low');
      if (lowIdx >= 0) this._items.splice(lowIdx, 1);
    }

    this._items.push(mission);
    this._sortByPriority();
    this.emit('mission:queued', mission);
    return mission;
  }

  // ── Dequeue ───────────────────────────────────────────────────────────────

  /** Returns the next mission without waiting. Null if empty or paused. */
  dequeue(): QueuedMission | null {
    if (this._paused || this._items.length === 0) return null;
    return this._items.shift() ?? null;
  }

  /** Peek at the highest-priority pending item without removing it. */
  peek(): QueuedMission | null {
    return this._items[0] ?? null;
  }

  // ── Control ───────────────────────────────────────────────────────────────

  pause():  void { this._paused = true;  this.emit('queue:paused'); }
  resume(): void { this._paused = false; this.emit('queue:resumed'); }

  isPaused(): boolean { return this._paused; }
  size():     number  { return this._items.length; }

  /** Remove a specific mission (e.g. cancelled by user). */
  cancel(id: string): boolean {
    const idx = this._items.findIndex(m => m.id === id);
    if (idx < 0) return false;
    this._items.splice(idx, 1);
    return true;
  }

  list(): QueuedMission[] {
    return [...this._items];
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private _sortByPriority(): void {
    this._items.sort((a, b) =>
      PRIORITY_WEIGHT[b.priority] - PRIORITY_WEIGHT[a.priority]
      || a.createdAt - b.createdAt, // FIFO within same tier
    );
  }
}

/** Singleton — shared between VoiceIntentRouter and AutonomyEngine. */
export const missionQueue = new MissionQueue();
