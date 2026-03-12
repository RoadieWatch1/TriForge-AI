// ── vibeProfileStore.ts — Persisted vibe profile CRUD ────────────────────────
//
// Stores durable vibe preferences per user / product / venture.
// Uses the shared StorageAdapter so profiles survive across sessions.

import type { StorageAdapter } from '../platform';
import type {
  VibeProfile, VibeAnchor, VibeDecisionRecord,
  VibeDimension, VibeMode, VibeSignal, VibeConfig,
} from './vibeTypes';
import { DEFAULT_VIBE_CONFIG, DEFAULT_VIBE_AXES } from './vibeTypes';

const STORAGE_KEY = 'triforge.vibeProfiles';

interface VibeProfileData {
  profiles: VibeProfile[];
}

export class VibeProfileStore {
  private _storage: StorageAdapter;
  private _config: VibeConfig;

  constructor(storage: StorageAdapter, config?: Partial<VibeConfig>) {
    this._storage = storage;
    this._config = { ...DEFAULT_VIBE_CONFIG, ...config };
  }

  // ── CRUD ────────────────────────────────────────────────────────────────────

  createProfile(name: string, mode: VibeMode, ventureId?: string): VibeProfile {
    const data = this._load();
    const profile: VibeProfile = {
      id: `vibe-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      name,
      ventureId,
      mode,
      axes: { ...DEFAULT_VIBE_AXES },
      anchors: [],
      history: [],
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    data.profiles.push(profile);
    this._save(data);
    return profile;
  }

  getProfile(id: string): VibeProfile | undefined {
    return this._load().profiles.find(p => p.id === id);
  }

  getAllProfiles(): VibeProfile[] {
    return this._load().profiles;
  }

  updateProfile(id: string, updates: Partial<Pick<VibeProfile, 'name' | 'mode' | 'axes' | 'anchors' | 'ventureId'>>): boolean {
    const data = this._load();
    const idx = data.profiles.findIndex(p => p.id === id);
    if (idx === -1) return false;

    const profile = data.profiles[idx];
    if (updates.name !== undefined)      profile.name = updates.name;
    if (updates.mode !== undefined)      profile.mode = updates.mode;
    if (updates.ventureId !== undefined) profile.ventureId = updates.ventureId;
    if (updates.axes !== undefined)      profile.axes = { ...profile.axes, ...updates.axes };
    if (updates.anchors !== undefined)   profile.anchors = updates.anchors;
    profile.updatedAt = Date.now();

    this._save(data);
    return true;
  }

  deleteProfile(id: string): boolean {
    const data = this._load();
    const before = data.profiles.length;
    data.profiles = data.profiles.filter(p => p.id !== id);
    if (data.profiles.length === before) return false;
    this._save(data);
    return true;
  }

  // ── Axis manipulation ──────────────────────────────────────────────────────

  /**
   * Apply parsed vibe signals to a profile's axes.
   * Each signal adjusts its dimension based on direction and intensity.
   */
  applySignals(profileId: string, signals: VibeSignal[]): boolean {
    const data = this._load();
    const profile = data.profiles.find(p => p.id === profileId);
    if (!profile) return false;

    for (const signal of signals) {
      const current = profile.axes[signal.dimension] ?? 50;
      let next: number;

      if (signal.direction === 'set') {
        next = signal.intensity;
      } else if (signal.direction === 'increase') {
        // Move toward 100 proportionally
        const room = 100 - current;
        next = current + room * (signal.intensity / 100);
      } else {
        // Move toward 0 proportionally
        next = current - current * (signal.intensity / 100);
      }

      profile.axes[signal.dimension] = Math.round(Math.max(0, Math.min(100, next)));
    }

    profile.updatedAt = Date.now();
    this._save(data);
    return true;
  }

  // ── Anchors ────────────────────────────────────────────────────────────────

  addAnchor(profileId: string, anchor: VibeAnchor): boolean {
    const data = this._load();
    const profile = data.profiles.find(p => p.id === profileId);
    if (!profile) return false;

    profile.anchors.push(anchor);
    profile.updatedAt = Date.now();
    this._save(data);
    return true;
  }

  // ── History ────────────────────────────────────────────────────────────────

  recordDecision(profileId: string, record: VibeDecisionRecord): boolean {
    const data = this._load();
    const profile = data.profiles.find(p => p.id === profileId);
    if (!profile) return false;

    profile.history.push(record);
    // Cap history
    if (profile.history.length > this._config.maxProfileHistory) {
      profile.history = profile.history.slice(-this._config.maxProfileHistory);
    }
    profile.updatedAt = Date.now();
    this._save(data);
    return true;
  }

  getHistory(profileId: string): VibeDecisionRecord[] {
    const profile = this.getProfile(profileId);
    return profile?.history ?? [];
  }

  // ── Persistence ────────────────────────────────────────────────────────────

  private _load(): VibeProfileData {
    return this._storage.get<VibeProfileData>(STORAGE_KEY, { profiles: [] });
  }

  private _save(data: VibeProfileData): void {
    this._storage.update(STORAGE_KEY, data);
  }
}
