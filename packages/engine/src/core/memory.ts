/**
 * Memory — two-tier context store.
 *   • Conventions (persistent via StorageAdapter): preferred libs, naming rules, style decisions.
 *   • Session facts (in-memory): recent observations injected into prompts.
 *
 * Both are injected into AI prompts as a context suffix so every response is
 * consistent with the project's established patterns.
 */

import { StorageAdapter } from '../platform';
import { ProjectConvention } from '../protocol';

const CONVENTIONS_KEY = 'triforge.conventions';
const MAX_CONVENTIONS = 100;
const MAX_SESSION_FACTS = 20;

export class Memory {
  private _sessionFacts: string[] = [];

  constructor(private _storage: StorageAdapter) {}

  // ─── Conventions (persistent) ────────────────────────────────────

  addConvention(
    key: string,
    value: string,
    source: ProjectConvention['source'] = 'manual'
  ): void {
    const all = this.getConventions();
    const idx = all.findIndex(c => c.key.toLowerCase() === key.toLowerCase());
    const entry: ProjectConvention = { key, value, source, timestamp: Date.now() };
    if (idx >= 0) {
      all[idx] = entry;
    } else {
      all.unshift(entry);
    }
    this._storage.update(CONVENTIONS_KEY, all.slice(0, MAX_CONVENTIONS));
  }

  getConventions(): ProjectConvention[] {
    return this._storage.get<ProjectConvention[]>(CONVENTIONS_KEY, []);
  }

  removeConvention(key: string): void {
    const filtered = this.getConventions().filter(
      c => c.key.toLowerCase() !== key.toLowerCase()
    );
    this._storage.update(CONVENTIONS_KEY, filtered);
  }

  clearConventions(): void {
    this._storage.update(CONVENTIONS_KEY, []);
  }

  buildConventionsContext(): string {
    const all = this.getConventions();
    if (all.length === 0) { return ''; }
    const lines = all.map(c => `- ${c.key}: ${c.value}`).join('\n');
    return `\nProject conventions (always follow these):\n${lines}\n`;
  }

  // ─── Session facts (in-memory only) ─────────────────────────────

  addSessionFact(fact: string): void {
    this._sessionFacts.unshift(fact);
    if (this._sessionFacts.length > MAX_SESSION_FACTS) {
      this._sessionFacts.pop();
    }
  }

  getSessionFacts(): string[] {
    return [...this._sessionFacts];
  }

  buildSessionContext(): string {
    if (this._sessionFacts.length === 0) { return ''; }
    const lines = this._sessionFacts
      .slice(0, 10)
      .map(f => `- ${f}`)
      .join('\n');
    return `\nRecent session context:\n${lines}\n`;
  }

  clearSession(): void {
    this._sessionFacts = [];
  }

  buildFullContext(): string {
    return this.buildConventionsContext() + this.buildSessionContext();
  }
}
