// ── expertRouter.ts — MoE-like expert routing ───────────────────────────────
//
// Decides which experts to activate for each task type. Only wakes the
// minimum useful set — irrelevant experts stay asleep. Prefers experts
// with higher contribution scores. Never selects benched/retired/replaced.

import type { ExpertRegistry } from './expertRegistry';
import type { ExpertPerformanceTracker } from './expertPerformanceTracker';
import type {
  ExpertProfile, ExpertSelectionDecision, ExpertRoutingContext,
} from './expertTypes';
import { TASK_TYPE_EXPERT_MAP } from './expertTypes';

const INACTIVE_STATUSES = new Set(['bench', 'retired', 'replaced']);
const MAX_EXPERTS_PER_TASK = 4;

export class ExpertRouter {
  constructor(
    private _registry: ExpertRegistry,
    private _tracker: ExpertPerformanceTracker,
  ) {}

  // ── Main routing ──────────────────────────────────────────────────────────

  selectExperts(
    taskType: string,
    context?: ExpertRoutingContext,
  ): ExpertSelectionDecision {
    const now = Date.now();
    const allExperts = this._registry.getAllExperts();
    const rolesForTask = TASK_TYPE_EXPERT_MAP[taskType] ?? [];

    // Find eligible experts for this task type
    const eligible: ExpertProfile[] = [];
    const skipped: string[] = [];

    for (const expert of allExperts) {
      // Skip inactive experts
      if (INACTIVE_STATUSES.has(expert.status)) {
        skipped.push(expert.id);
        continue;
      }

      // Must handle this task type OR have the role mapped to this task
      const matchesTask = expert.taskTypes.includes(taskType);
      const matchesRole = rolesForTask.includes(expert.role);

      if (!matchesTask && !matchesRole) {
        skipped.push(expert.id);
        continue;
      }

      eligible.push(expert);
    }

    // Sort by contribution score (highest first), then by selection count (least-used tiebreaker)
    eligible.sort((a, b) => {
      const scoreDiff = b.successContributionScore - a.successContributionScore;
      if (scoreDiff !== 0) return scoreDiff;
      return a.selectionCount - b.selectionCount; // prefer less-used on tie
    });

    // Apply learning recommendations if provided
    if (context?.learningRecommendations?.length) {
      const recommended = new Set(context.learningRecommendations);
      eligible.sort((a, b) => {
        const aRec = recommended.has(a.id) ? 1 : 0;
        const bRec = recommended.has(b.id) ? 1 : 0;
        if (aRec !== bRec) return bRec - aRec;
        return b.successContributionScore - a.successContributionScore;
      });
    }

    // Placement awareness: deprioritize experts on saturated lanes
    if (context?.placementContext?.saturatedLanes?.length) {
      const saturated = new Set(context.placementContext.saturatedLanes);
      eligible.sort((a, b) => {
        const aOnSaturated = a.currentLane && saturated.has(a.currentLane) ? 1 : 0;
        const bOnSaturated = b.currentLane && saturated.has(b.currentLane) ? 1 : 0;
        if (aOnSaturated !== bOnSaturated) return aOnSaturated - bOnSaturated;
        return b.successContributionScore - a.successContributionScore;
      });
    }

    // Prefer active over trial, but don't exclude trial
    // Prefer non-watchlist over watchlist (use watchlist only if no alternative)
    const active = eligible.filter(e => e.status === 'active');
    const trial = eligible.filter(e => e.status === 'trial');
    const watchlist = eligible.filter(e => e.status === 'watchlist');

    const selected: ExpertProfile[] = [];

    // Fill from active first, then trial, then watchlist
    for (const pool of [active, trial, watchlist]) {
      for (const expert of pool) {
        if (selected.length >= MAX_EXPERTS_PER_TASK) break;
        if (!selected.find(e => e.id === expert.id)) {
          selected.push(expert);
        }
      }
    }

    const selectedIds = selected.map(e => e.id);
    const skippedIds = allExperts
      .filter(e => !selectedIds.includes(e.id))
      .map(e => e.id);

    const decision: ExpertSelectionDecision = {
      taskType,
      selectedExperts: selectedIds,
      skippedExperts: skippedIds,
      reason: `Selected ${selectedIds.length} experts for ${taskType}`,
      timestamp: now,
    };

    // Update selection timestamps
    for (const expert of selected) {
      this._registry.updateExpert(expert.id, {
        lastSelectedAt: now,
        selectionCount: expert.selectionCount + 1,
      });
    }

    return decision;
  }

  // ── Prompt fragments ──────────────────────────────────────────────────────

  getSystemPromptFragments(selectedExpertIds: string[]): string[] {
    const fragments: string[] = [];
    for (const id of selectedExpertIds) {
      const expert = this._registry.getExpert(id);
      if (expert?.systemPromptFragment) {
        fragments.push(`[${expert.name}]: ${expert.systemPromptFragment}`);
      }
    }
    return fragments;
  }

  // ── Build combined expert context for council prompts ──────────────────────

  buildExpertContext(selectedExpertIds: string[]): string {
    const fragments = this.getSystemPromptFragments(selectedExpertIds);
    if (fragments.length === 0) return '';

    return [
      'ACTIVE SPECIALISTS:',
      ...fragments,
      '',
      'Consider each specialist\'s perspective when forming your position.',
    ].join('\n');
  }
}
