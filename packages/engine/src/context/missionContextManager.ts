// ── missionContextManager.ts ──────────────────────────────────────────────────
//
// Manages the user's active council mission context.
//
// Persisted via StorageAdapter (same pattern as Memory, DecisionLog).
// The mission is injected into every council system prompt so the council
// reasons within the user's ongoing project rather than treating each message
// as a standalone request.
//
// Usage:
//   const mgr = new MissionContextManager(storage);
//   mgr.set({ mission: "Launch SaaS", objectives: [...], decisions: [], openQuestions: [] });
//   // Later, in system prompt:
//   const addendum = mgr.buildAddendum(); // injected before council runs

import type { StorageAdapter } from '../platform';
import type { MissionContext }  from './missionStore';

const STORAGE_KEY = 'triforge.councilMission';

export class MissionContextManager {
  constructor(private _storage: StorageAdapter) {}

  // ── Read ────────────────────────────────────────────────────────────────────

  get(): MissionContext | null {
    return this._storage.get<MissionContext | null>(STORAGE_KEY, null);
  }

  // ── Write ───────────────────────────────────────────────────────────────────

  set(ctx: Omit<MissionContext, 'updatedAt'>): void {
    const full: MissionContext = { ...ctx, updatedAt: Date.now() };
    this._storage.update(STORAGE_KEY, full);
  }

  update(patch: Partial<Omit<MissionContext, 'updatedAt'>>): MissionContext | null {
    const existing = this.get();
    if (!existing) return null;
    const updated: MissionContext = { ...existing, ...patch, updatedAt: Date.now() };
    this._storage.update(STORAGE_KEY, updated);
    return updated;
  }

  /**
   * Append a new decision to the existing mission.
   * No-op if no mission is set or the decision is already recorded.
   */
  addDecision(decision: string): void {
    const ctx = this.get();
    if (!ctx) return;
    if (ctx.decisions.includes(decision)) return;
    ctx.decisions = [...ctx.decisions, decision];
    ctx.updatedAt = Date.now();
    this._storage.update(STORAGE_KEY, ctx);
  }

  clear(): void {
    this._storage.update(STORAGE_KEY, null);
  }

  // ── System prompt injection ─────────────────────────────────────────────────

  /**
   * Build a system prompt addendum from the current mission context.
   * Returns an empty string if no mission is set.
   */
  buildAddendum(): string {
    const ctx = this.get();
    if (!ctx?.mission) return '';

    const lines: string[] = [
      '\n\n--- COUNCIL MISSION CONTEXT ---',
      `Mission: ${ctx.mission}`,
    ];

    if (ctx.objectives?.length > 0) {
      lines.push(`Objectives: ${ctx.objectives.join('; ')}`);
    }
    if (ctx.decisions?.length > 0) {
      lines.push(`Decisions made: ${ctx.decisions.join('; ')}`);
    }
    if (ctx.openQuestions?.length > 0) {
      lines.push(`Open questions: ${ctx.openQuestions.join('; ')}`);
    }

    lines.push(
      'Use this mission context to give advice that advances the user\'s ongoing project.',
    );

    return lines.join('\n');
  }
}
