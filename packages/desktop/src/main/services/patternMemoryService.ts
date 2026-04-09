// ── patternMemoryService.ts ──────────────────────────────────────────────────
//
// Phase D1 — Cross-session pattern learning.
//
// The audit found TriForge has no compounding intelligence — every session
// starts fresh, even though the user runs the same kinds of work over and
// over. Project memory tracks individual projects; this service tracks the
// *behavior* across all projects so the council can adapt.
//
// What it observes:
//   • Which apps the user targets most often (Photoshop / Premiere / Unreal …)
//   • Which workflow packs the user runs most often
//   • Which Unreal milestones the user typically reaches
//   • Recurring scaffold goals (e.g. "survival", "roguelite", "dungeon")
//
// What it produces:
//   • Pattern memory entries (type='pattern') in the store, surfaced in the
//     Memory tab and injected into the council prompt.
//
// How it works:
//   1. After every successful WorkerRun completes, recordRunPatterns() is
//      called with the run's metadata.
//   2. The service increments named pattern counters in store.patternCounters.
//   3. When a counter crosses its threshold, the service flushes a one-line
//      pattern memory entry — but only if the same content does not already
//      exist (idempotent).
//
// Why counters not just memories: counters compound silently. Memories are
// promoted only when the signal is strong enough to be worth telling the
// council about. This stops the memory tab from filling with noise after
// the first session.

import type { Store } from '../store';

// ── Thresholds ────────────────────────────────────────────────────────────────
//
// All thresholds picked deliberately small so the patterns become visible
// after only a handful of sessions. They are not tunable from the UI; if
// users want to reset them they use clearPatternCounters().

const APP_THRESHOLD       = 3;  // 3 runs against same app → pattern
const PACK_THRESHOLD      = 3;  // 3 runs of same pack → pattern
const MILESTONE_THRESHOLD = 2;  // 2 successful milestones → "user reaches M2+" pattern
const GOAL_KEYWORD_THRESHOLD = 2; // 2 scaffolds with same keyword → genre pattern

// ── Run summary input ─────────────────────────────────────────────────────────
//
// Decoupled from any specific WorkerRun shape — callers pass only what the
// service needs. This keeps the service free of cross-package imports.

export interface RunPatternInput {
  /** Pack ID that ran (e.g. 'pack.unreal-m3-execute', 'pack.adobe-photoshop'). */
  packId?: string;
  /** Target application name, if known. */
  targetApp?: string;
  /** Free-text goal / prototypeGoal the user supplied. */
  prototypeGoal?: string;
  /** Final outcome — only 'completed' contributes to pattern counters. */
  outcome: 'completed' | 'failed' | 'cancelled' | 'blocked' | 'awaiting_approval';
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const KNOWN_GENRE_KEYWORDS = [
  'survival', 'roguelite', 'roguelike', 'dungeon', 'tower defense', 'open world',
  'first person', 'third person', 'top down', 'horror', 'sci-fi', 'fantasy',
  'puzzle', 'platformer', 'shooter', 'rpg',
];

function normalize(s: string): string {
  return s.trim().toLowerCase();
}

/** Return the genre keywords present in a free-text goal. */
function extractGenreKeywords(goal: string): string[] {
  const normalized = normalize(goal);
  return KNOWN_GENRE_KEYWORDS.filter(kw => normalized.includes(kw));
}

/** Pretty-print an app name for memory content. */
function appLabel(app: string): string {
  return app.replace(/^Adobe\s+/i, 'Adobe ').trim();
}

/** Pretty-print a pack ID. */
function packLabel(packId: string): string {
  return packId
    .replace(/^pack\./, '')
    .replace(/-/g, ' ')
    .replace(/\b\w/g, c => c.toUpperCase());
}

/** Detect Unreal milestone packs and return the milestone level (1-5). */
function unrealMilestoneLevel(packId?: string): number | null {
  if (!packId) return null;
  const match = packId.match(/^pack\.unreal-m(\d)-execute$/);
  if (!match) return null;
  const n = parseInt(match[1], 10);
  return n >= 1 && n <= 5 ? n : null;
}

// ── Service ───────────────────────────────────────────────────────────────────

export const PatternMemoryService = {

  /**
   * Record patterns from a single run. Called from the WorkerRunQueue
   * lifecycle hook (or directly from operators that complete outside the
   * queue, e.g. workflowPackService).
   *
   * Only successful completions contribute. Failures are recorded as a
   * separate counter so the council can be told "user has had 4 failed runs
   * of pack-X — consider asking if they want a different approach."
   */
  recordRunPatterns(store: Store, input: RunPatternInput): void {
    if (input.outcome !== 'completed') {
      // Track failures separately so we can flag chronic friction
      if (input.outcome === 'failed' && input.packId) {
        const failKey = `pack-fail:${input.packId}`;
        const failCount = store.incrementPatternCounter(failKey, { packId: input.packId });
        if (failCount === 3) {
          const content =
            `The user has had 3 failed runs of "${packLabel(input.packId)}". ` +
            `Consider suggesting an alternative approach or asking what is going wrong.`;
          if (!store.hasPatternMemory(content)) {
            store.addMemory('pattern', content, 'pattern:auto');
          }
        }
      }
      return;
    }

    // 1. Target app pattern
    if (input.targetApp) {
      const appKey = `app:${normalize(input.targetApp)}`;
      const appCount = store.incrementPatternCounter(appKey, { app: input.targetApp });
      if (appCount === APP_THRESHOLD) {
        const content =
          `The user frequently targets ${appLabel(input.targetApp)} ` +
          `(${APP_THRESHOLD} successful runs and counting). Tailor suggestions to this app.`;
        if (!store.hasPatternMemory(content)) {
          store.addMemory('pattern', content, 'pattern:auto');
        }
      }
    }

    // 2. Pack usage pattern
    if (input.packId) {
      const packKey = `pack:${input.packId}`;
      const packCount = store.incrementPatternCounter(packKey, { packId: input.packId });
      if (packCount === PACK_THRESHOLD) {
        const content =
          `The user runs the "${packLabel(input.packId)}" workflow regularly ` +
          `(${PACK_THRESHOLD} successful runs). It is a known-good path for them.`;
        if (!store.hasPatternMemory(content)) {
          store.addMemory('pattern', content, 'pattern:auto');
        }
      }
    }

    // 3. Unreal milestone progression pattern
    const milestoneLevel = unrealMilestoneLevel(input.packId);
    if (milestoneLevel !== null) {
      const mKey = `unreal-milestone:M${milestoneLevel}`;
      const mCount = store.incrementPatternCounter(mKey, { milestone: `M${milestoneLevel}` });
      if (mCount === MILESTONE_THRESHOLD && milestoneLevel >= 2) {
        const content =
          `The user has successfully reached Unreal Milestone M${milestoneLevel} multiple times. ` +
          `They are comfortable with the M1–M${milestoneLevel} chain — propose deeper milestones with confidence.`;
        if (!store.hasPatternMemory(content)) {
          store.addMemory('pattern', content, 'pattern:auto');
        }
      }
    }

    // 4. Genre / scaffold goal pattern
    if (input.prototypeGoal) {
      const genres = extractGenreKeywords(input.prototypeGoal);
      for (const genre of genres) {
        const gKey = `genre:${genre}`;
        const gCount = store.incrementPatternCounter(gKey, { genre });
        if (gCount === GOAL_KEYWORD_THRESHOLD) {
          const content =
            `The user is repeatedly building ${genre} prototypes. ` +
            `Bias scaffold and milestone suggestions toward ${genre} mechanics by default.`;
          if (!store.hasPatternMemory(content)) {
            store.addMemory('pattern', content, 'pattern:auto');
          }
        }
      }
    }
  },

  /**
   * Return the active pattern memories — used by the council prompt builder
   * to inject the user's behavioral profile into the system message.
   */
  listPatterns(store: Store): Array<{ id: number; content: string; created_at: number }> {
    return store.getMemory(200)
      .filter(m => m.type === 'pattern')
      .map(m => ({ id: m.id, content: m.content, created_at: m.created_at }));
  },

  /**
   * Reset all pattern state — counters and pattern memory entries.
   * Use sparingly; users should be able to rebuild this in a few sessions.
   */
  resetPatterns(store: Store): void {
    store.clearPatternCounters();
    const all = store.getMemory(200);
    for (const m of all) {
      if (m.type === 'pattern') store.deleteMemory(m.id);
    }
  },
};
