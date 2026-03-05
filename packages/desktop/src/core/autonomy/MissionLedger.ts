// ── MissionLedger.ts — Append-only audit log for autonomy missions ────────────
//
// Every mission and its key lifecycle events are recorded here for:
//   • User audit ("what did TriForge do?")
//   • Debugging and replay
//   • Compliance / review
//
// Storage: localStorage under key `triforge_mission_ledger`.
// Entries are capped at MAX_ENTRIES (oldest trimmed first).
// All writes are best-effort; failures are silently swallowed.
//
// This runs in the renderer process. For main-process audit, use the
// existing AuditLedger / Ledger IPC instead.

const STORAGE_KEY  = 'triforge_mission_ledger';
const MAX_ENTRIES  = 500;

// ── Types ─────────────────────────────────────────────────────────────────────

export type LedgerEventType =
  | 'mission_created'
  | 'mission_planned'
  | 'approval_requested'
  | 'approval_granted'
  | 'approval_rejected'
  | 'execution_started'
  | 'execution_complete'
  | 'execution_failed'
  | 'mission_cancelled';

export interface LedgerEntry {
  id:         string;
  ts:         number;
  missionId:  string;
  event:      LedgerEventType;
  intent:     string;
  source:     string;
  detail?:    string;
}

// ── MissionLedger ─────────────────────────────────────────────────────────────

class MissionLedgerStore {
  private _cache: LedgerEntry[] | null = null;

  /** Append a new event to the ledger. */
  record(entry: Omit<LedgerEntry, 'id' | 'ts'>): void {
    try {
      const entries = this._load();
      entries.push({
        id:  crypto.randomUUID(),
        ts:  Date.now(),
        ...entry,
      });

      // Trim to cap
      const trimmed = entries.length > MAX_ENTRIES
        ? entries.slice(entries.length - MAX_ENTRIES)
        : entries;

      this._save(trimmed);
    } catch { /* non-fatal */ }
  }

  /** Return all entries, newest first. */
  getAll(): LedgerEntry[] {
    return [...this._load()].reverse();
  }

  /** Return entries for a specific missionId. */
  getByMission(missionId: string): LedgerEntry[] {
    return this._load().filter(e => e.missionId === missionId);
  }

  /** Clear all entries (admin / debug use). */
  clear(): void {
    this._cache = [];
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private _load(): LedgerEntry[] {
    if (this._cache) return this._cache;
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      this._cache = raw ? (JSON.parse(raw) as LedgerEntry[]) : [];
    } catch {
      this._cache = [];
    }
    return this._cache;
  }

  private _save(entries: LedgerEntry[]): void {
    this._cache = entries;
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entries));
  }
}

/** Singleton — import and call record() from anywhere in the renderer. */
export const missionLedger = new MissionLedgerStore();
