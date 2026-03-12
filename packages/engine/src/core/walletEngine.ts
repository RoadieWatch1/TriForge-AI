import type { StorageAdapter } from '../platform';
import type { TaskCategory, WalletSnapshot } from './taskTypes';

// ── WalletEngine ──────────────────────────────────────────────────────────────
// Budget tracking with daily reset. Uses StorageAdapter sync get/update.

const WALLET_KEY = 'triforge.wallet';

const ALL_CATEGORIES: TaskCategory[] = ['email', 'social', 'research', 'files', 'trading', 'general'];

function todayISO(): string {
  return new Date().toISOString().slice(0, 10);
}

function emptySnapshot(): WalletSnapshot {
  const empty = Object.fromEntries(ALL_CATEGORIES.map(c => [c, 0])) as Record<TaskCategory, number>;
  return {
    dailySpentCents: 0,
    categorySpent: { ...empty },
    categoryReserved: { ...empty },
    date: todayISO(),
  };
}

export class WalletEngine {
  private _storage: StorageAdapter;

  constructor(storage: StorageAdapter) {
    this._storage = storage;
  }

  getSnapshot(): WalletSnapshot {
    const snap = this._storage.get<WalletSnapshot>(WALLET_KEY, emptySnapshot());
    return this._resetDailyIfNeeded(snap);
  }

  // Check if spending `cents` in `category` would exceed the daily budget
  // considering both already-spent AND already-reserved amounts.
  canSpend(category: TaskCategory, cents: number, dailyBudgetCents: number): boolean {
    const snap = this.getSnapshot();
    const spent = snap.categorySpent[category] ?? 0;
    const reserved = snap.categoryReserved[category] ?? 0;
    return spent + reserved + cents <= dailyBudgetCents;
  }

  // Reserve budget before approval/execution. Throws if over limit.
  reserve(category: TaskCategory, cents: number, dailyBudgetCents?: number): void {
    if (cents <= 0) return;
    if (dailyBudgetCents !== undefined && !this.canSpend(category, cents, dailyBudgetCents)) {
      throw new Error(`Daily budget exceeded for ${category}: cannot reserve ${cents}¢`);
    }
    const snap = this.getSnapshot();
    snap.categoryReserved[category] = (snap.categoryReserved[category] ?? 0) + cents;
    this._storage.update(WALLET_KEY, snap);
  }

  commit(category: TaskCategory, cents: number): void {
    if (cents <= 0) return;
    const snap = this.getSnapshot();
    snap.categorySpent[category] = (snap.categorySpent[category] ?? 0) + cents;
    snap.dailySpentCents = (snap.dailySpentCents ?? 0) + cents;
    snap.categoryReserved[category] = Math.max(0, (snap.categoryReserved[category] ?? 0) - cents);
    this._storage.update(WALLET_KEY, snap);
  }

  release(category: TaskCategory, cents: number): void {
    if (cents <= 0) return;
    const snap = this.getSnapshot();
    snap.categoryReserved[category] = Math.max(0, (snap.categoryReserved[category] ?? 0) - cents);
    this._storage.update(WALLET_KEY, snap);
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  private _resetDailyIfNeeded(snap: WalletSnapshot): WalletSnapshot {
    if (snap.date !== todayISO()) {
      const fresh = emptySnapshot();
      this._storage.update(WALLET_KEY, fresh);
      return fresh;
    }
    return snap;
  }
}
