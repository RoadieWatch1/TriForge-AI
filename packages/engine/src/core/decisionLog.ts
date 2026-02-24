/**
 * DecisionLog — records every council decision (code or think-tank) with full context.
 * Persisted via StorageAdapter. Searchable by goal / summary / decision text.
 */

import { StorageAdapter } from '../platform';
import { CouncilResult } from '../protocol';

const LOG_KEY = 'triforge.decisionLog';
const MAX_ENTRIES = 200;

export class DecisionLog {
  constructor(private _storage: StorageAdapter) {}

  record(result: CouncilResult): void {
    const entries = this._getAll();
    const idx = entries.findIndex(e => e.id === result.id);
    if (idx >= 0) {
      entries[idx] = result;
    } else {
      entries.unshift(result);
    }
    this._storage.update(LOG_KEY, entries.slice(0, MAX_ENTRIES));
  }

  getRecent(n: number): CouncilResult[] {
    return this._getAll().slice(0, n);
  }

  search(query: string): CouncilResult[] {
    const q = query.toLowerCase();
    return this._getAll().filter(e =>
      (e.goalStatement ?? e.request).toLowerCase().includes(q) ||
      e.finalDecision.toLowerCase().includes(q) ||
      e.rationale.some(r => r.toLowerCase().includes(q))
    );
  }

  clear(): void {
    this._storage.update(LOG_KEY, []);
  }

  private _getAll(): CouncilResult[] {
    return this._storage.get<CouncilResult[]>(LOG_KEY, []);
  }
}
