// ── skillStore.ts — Phase 5: Skill Store install registry ─────────────────────
//
// Persists installed skills to <dataDir>/skills.json using the same atomic
// write + in-memory cache pattern as GitHubReviewStore and ApprovalStore.
//
// Each skill retains its original rawMarkdown for re-analysis and the full
// SkillAnalysisResult so the UI can always show why a skill was classified.

import * as fs   from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { SkillRiskLevel } from '@triforge/engine';

// ── Types ─────────────────────────────────────────────────────────────────────

export type SkillSource = 'paste' | 'file' | 'url' | 'example';

export interface InstalledSkill {
  id:          string;
  name:        string;
  version?:    string;
  description?: string;
  author?:     string;
  source:      SkillSource;
  sourceUrl?:  string;       // populated when source === 'url'
  rawMarkdown: string;
  riskLevel:   SkillRiskLevel;
  blocked:     boolean;
  requiresApproval:       boolean;
  councilReviewRequired:  boolean;
  declaredCapabilities:   string[];
  detectedCapabilities:   string[];
  reviewSummary:          string;
  enabled:     boolean;
  installedAt: number;
  lastRunAt?:  number;
  runCount:    number;
}

interface StoreFile {
  skills: Record<string, InstalledSkill>;
}

// ── SkillStoreManager ─────────────────────────────────────────────────────────

export class SkillStoreManager {
  private _filePath: string;
  private _tmpPath:  string;
  private _cache:    Record<string, InstalledSkill> = {};
  private _loaded = false;

  constructor(dataDir: string) {
    this._filePath = path.join(dataDir, 'skills.json');
    this._tmpPath  = this._filePath + '.tmp';
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  install(fields: Omit<InstalledSkill, 'id' | 'installedAt' | 'runCount'>): InstalledSkill {
    this._ensureLoaded();
    const skill: InstalledSkill = {
      ...fields,
      id:          crypto.randomUUID(),
      installedAt: Date.now(),
      runCount:    0,
    };
    this._cache[skill.id] = skill;
    this._persist();
    return skill;
  }

  get(id: string): InstalledSkill | undefined {
    this._ensureLoaded();
    return this._cache[id];
  }

  list(): InstalledSkill[] {
    this._ensureLoaded();
    return Object.values(this._cache).sort((a, b) => b.installedAt - a.installedAt);
  }

  setEnabled(id: string, enabled: boolean): boolean {
    this._ensureLoaded();
    if (!this._cache[id]) return false;
    this._cache[id].enabled = enabled;
    this._persist();
    return true;
  }

  recordRun(id: string): void {
    this._ensureLoaded();
    if (!this._cache[id]) return;
    this._cache[id].lastRunAt = Date.now();
    this._cache[id].runCount  = (this._cache[id].runCount ?? 0) + 1;
    this._persist();
  }

  uninstall(id: string): boolean {
    this._ensureLoaded();
    if (!this._cache[id]) return false;
    delete this._cache[id];
    this._persist();
    return true;
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private _ensureLoaded(): void {
    if (this._loaded) return;
    try {
      const raw  = fs.readFileSync(this._filePath, 'utf8');
      const data = JSON.parse(raw) as StoreFile;
      this._cache = data.skills ?? {};
    } catch {
      this._cache = {};
    }
    this._loaded = true;
  }

  private _persist(): void {
    const data: StoreFile = { skills: this._cache };
    fs.writeFileSync(this._tmpPath, JSON.stringify(data, null, 2), 'utf8');
    fs.renameSync(this._tmpPath, this._filePath);
  }
}
