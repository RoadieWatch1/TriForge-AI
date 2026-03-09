// ── learningProfileStore.ts — Persisted learning profile ─────────────────────
//
// Stores and manages the learning profile via StorageAdapter.
// Same persistence pattern as CouncilMemoryGraph.

import type { StorageAdapter } from '../platform';
import type {
  LearningProfile, VentureOutcomeRecord, ExpertContributionRecord,
  LearningConfig,
} from './learningTypes';
import { DEFAULT_LEARNING_PROFILE, DEFAULT_LEARNING_CONFIG } from './learningTypes';

const STORAGE_KEY = 'triforge.learningProfile';

export class LearningProfileStore {
  private _config: LearningConfig;

  constructor(
    private _storage: StorageAdapter,
    config?: Partial<LearningConfig>,
  ) {
    this._config = { ...DEFAULT_LEARNING_CONFIG, ...config };
  }

  // ── Read ──────────────────────────────────────────────────────────────────

  getProfile(): LearningProfile {
    return this._storage.get<LearningProfile>(STORAGE_KEY, { ...DEFAULT_LEARNING_PROFILE });
  }

  // ── Bias management ───────────────────────────────────────────────────────

  updateBias(dimension: string, delta: number): void {
    const profile = this.getProfile();
    const current = profile.biases[dimension] ?? 1.0;
    profile.biases[dimension] = clamp(
      current + delta,
      this._config.biasClampMin,
      this._config.biasClampMax,
    );
    profile.lastUpdated = Date.now();
    this._save(profile);
  }

  setBias(dimension: string, value: number): void {
    const profile = this.getProfile();
    profile.biases[dimension] = clamp(value, this._config.biasClampMin, this._config.biasClampMax);
    profile.lastUpdated = Date.now();
    this._save(profile);
  }

  // ── Decision / outcome recording ──────────────────────────────────────────

  recordDecision(record: VentureOutcomeRecord): void {
    const profile = this.getProfile();
    profile.ventureHistory.push(record);
    // Keep last 200 records
    if (profile.ventureHistory.length > 200) {
      profile.ventureHistory = profile.ventureHistory.slice(-200);
    }
    profile.signalCount++;
    profile.lastUpdated = Date.now();
    this._save(profile);
  }

  recordOutcome(ventureId: string, metrics: Partial<VentureOutcomeRecord>): void {
    const profile = this.getProfile();
    const existing = profile.ventureHistory.find(r => r.ventureId === ventureId);
    if (existing) {
      Object.assign(existing, metrics);
    }
    profile.lastUpdated = Date.now();
    this._save(profile);
  }

  recordExpertContribution(record: ExpertContributionRecord): void {
    const profile = this.getProfile();
    profile.expertPerformanceHistory.push(record);
    // Keep last 500 records
    if (profile.expertPerformanceHistory.length > 500) {
      profile.expertPerformanceHistory = profile.expertPerformanceHistory.slice(-500);
    }
    profile.signalCount++;
    profile.lastUpdated = Date.now();
    this._save(profile);
  }

  // ── Queries ───────────────────────────────────────────────────────────────

  getPreferredCategories(topN: number): string[] {
    const profile = this.getProfile();
    return Object.entries(profile.categoryPreferences)
      .sort(([, a], [, b]) => b - a)
      .slice(0, topN)
      .map(([cat]) => cat);
  }

  getTopExpertsForCategory(category: string): string[] {
    const profile = this.getProfile();
    const relevant = profile.expertPerformanceHistory.filter(r => {
      const venture = profile.ventureHistory.find(v => v.ventureId === r.ventureId);
      return venture?.category === category && r.outputSurvived;
    });

    // Count expert successes
    const counts: Record<string, number> = {};
    for (const r of relevant) {
      counts[r.expertId] = (counts[r.expertId] ?? 0) + r.contributionScore;
    }
    return Object.entries(counts)
      .sort(([, a], [, b]) => b - a)
      .slice(0, 5)
      .map(([id]) => id);
  }

  // ── Decay ─────────────────────────────────────────────────────────────────

  decay(): void {
    const profile = this.getProfile();
    const { decayRate, minSignalWeight, biasClampMin, biasClampMax } = this._config;

    // Decay biases toward 1.0
    for (const key of Object.keys(profile.biases)) {
      const current = profile.biases[key];
      const decayed = 1.0 + (current - 1.0) * decayRate;
      profile.biases[key] = clamp(decayed, biasClampMin, biasClampMax);

      // Remove if effectively neutral
      if (Math.abs(profile.biases[key] - 1.0) < minSignalWeight) {
        delete profile.biases[key];
      }
    }

    // Decay category preferences
    for (const key of Object.keys(profile.categoryPreferences)) {
      profile.categoryPreferences[key] *= decayRate;
      if (Math.abs(profile.categoryPreferences[key]) < minSignalWeight) {
        delete profile.categoryPreferences[key];
      }
    }

    profile.lastUpdated = Date.now();
    this._save(profile);
  }

  // ── Persistence ───────────────────────────────────────────────────────────

  private _save(profile: LearningProfile): void {
    this._storage.update(STORAGE_KEY, profile);
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}
