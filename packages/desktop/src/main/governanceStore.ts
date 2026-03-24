// ── governanceStore.ts — Phase 7: Persisted governance rule set ───────────────
//
// Stores GovernanceRules to <dataDir>/governance.json using the same atomic
// write pattern as all other stores.
//
// On first load, if the file doesn't exist, the default rule set from
// buildDefaultRules() is written and returned.

import * as fs   from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { buildDefaultRules } from '@triforge/engine';
import type { GovernanceRule } from '@triforge/engine';

interface StoreFile {
  rules: Record<string, GovernanceRule>;
}

export class GovernanceStore {
  private _filePath: string;
  private _tmpPath:  string;
  private _cache:    Record<string, GovernanceRule> = {};
  private _loaded    = false;

  constructor(dataDir: string) {
    this._filePath = path.join(dataDir, 'governance.json');
    this._tmpPath  = this._filePath + '.tmp';
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  list(): GovernanceRule[] {
    this._ensureLoaded();
    return Object.values(this._cache).sort((a, b) => a.priority - b.priority);
  }

  listEnabled(): GovernanceRule[] {
    return this.list().filter(r => r.enabled);
  }

  get(id: string): GovernanceRule | undefined {
    this._ensureLoaded();
    return this._cache[id];
  }

  create(fields: Omit<GovernanceRule, 'id' | 'createdAt' | 'isDefault'>): GovernanceRule {
    this._ensureLoaded();
    const rule: GovernanceRule = {
      ...fields,
      id:        crypto.randomUUID(),
      isDefault: false,
      createdAt: Date.now(),
    };
    this._cache[rule.id] = rule;
    this._persist();
    return rule;
  }

  update(id: string, patch: Partial<Omit<GovernanceRule, 'id' | 'isDefault' | 'createdAt'>>): GovernanceRule | null {
    this._ensureLoaded();
    const rule = this._cache[id];
    if (!rule) return null;
    Object.assign(rule, patch);
    this._persist();
    return rule;
  }

  /** Delete a non-default rule. Returns false if the rule is a default or not found. */
  delete(id: string): boolean {
    this._ensureLoaded();
    const rule = this._cache[id];
    if (!rule || rule.isDefault) return false;
    delete this._cache[id];
    this._persist();
    return true;
  }

  setEnabled(id: string, enabled: boolean): boolean {
    this._ensureLoaded();
    if (!this._cache[id]) return false;
    this._cache[id].enabled = enabled;
    this._persist();
    return true;
  }

  setPriority(id: string, priority: number): boolean {
    this._ensureLoaded();
    if (!this._cache[id]) return false;
    this._cache[id].priority = priority;
    this._persist();
    return true;
  }

  /** Restore all default rules to their shipped state (does not remove custom rules). */
  resetDefaults(): void {
    this._ensureLoaded();
    for (const rule of buildDefaultRules()) {
      this._cache[rule.id] = rule;
    }
    this._persist();
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private _ensureLoaded(): void {
    if (this._loaded) return;
    try {
      const raw  = fs.readFileSync(this._filePath, 'utf8');
      const data = JSON.parse(raw) as StoreFile;
      this._cache = data.rules ?? {};
      // If the file exists but is missing some default rules (schema migration),
      // merge defaults in without overwriting existing customizations.
      const defaults = buildDefaultRules();
      for (const def of defaults) {
        if (!this._cache[def.id]) this._cache[def.id] = def;
      }
    } catch {
      // File doesn't exist yet — seed with defaults
      this._cache = {};
      for (const rule of buildDefaultRules()) {
        this._cache[rule.id] = rule;
      }
    }
    this._loaded = true;
  }

  private _persist(): void {
    const data: StoreFile = { rules: this._cache };
    fs.writeFileSync(this._tmpPath, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(this._tmpPath, this._filePath);
  }
}
