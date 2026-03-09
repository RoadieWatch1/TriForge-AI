// ── expertHiringEngine.ts — Justified expert candidate creation ──────────────
//
// Creates new expert candidates ONLY when justified by detected capability gaps.
// Does NOT create experts randomly. Triggers: repeated failures, missing
// specialties, user requests, capability gaps, unmet needs.

import type { StorageAdapter } from '../platform';
import type { ExpertRegistry } from './expertRegistry';
import type { ExpertPerformanceTracker } from './expertPerformanceTracker';
import type { ExpertRosterLedger } from './expertRosterLedger';
import type { LearningProfile } from '../learning/learningTypes';
import type {
  ExpertProfile, ExpertHiringNeed, ExpertRole, ExpertStatus,
} from './expertTypes';
import { TASK_TYPE_EXPERT_MAP } from './expertTypes';

export class ExpertHiringEngine {
  constructor(
    private _registry: ExpertRegistry,
    private _tracker: ExpertPerformanceTracker,
    private _ledger: ExpertRosterLedger,
    private _storage: StorageAdapter,
  ) {}

  // ── Evaluate hiring needs ─────────────────────────────────────────────────

  evaluateHiringNeeds(learningProfile?: LearningProfile): ExpertHiringNeed[] {
    const needs: ExpertHiringNeed[] = [];
    const allExperts = this._registry.getAllExperts();
    const activeRoles = new Set(
      allExperts.filter(e => e.status === 'active' || e.status === 'trial').map(e => e.role)
    );

    // Check for task types with no active experts
    for (const [taskType, roles] of Object.entries(TASK_TYPE_EXPERT_MAP)) {
      const hasActive = roles.some(role => activeRoles.has(role));
      if (!hasActive) {
        const suggestedRole = roles[0];
        if (suggestedRole) {
          needs.push({
            missingCapability: `No active expert for ${taskType}`,
            detectedFrom: 'capability_gap',
            confidence: 90,
            suggestedRole,
            timestamp: Date.now(),
          });
        }
      }
    }

    // Check for roles where all experts are benched/retired
    const allRoles = [...new Set(allExperts.map(e => e.role))];
    for (const role of allRoles) {
      const expertsWithRole = allExperts.filter(e => e.role === role);
      const allInactive = expertsWithRole.every(
        e => e.status === 'bench' || e.status === 'retired' || e.status === 'replaced'
      );
      if (allInactive && expertsWithRole.length > 0) {
        needs.push({
          missingCapability: `All ${role} experts inactive`,
          detectedFrom: 'capability_gap',
          confidence: 85,
          suggestedRole: role,
          timestamp: Date.now(),
        });
      }
    }

    // Check learning profile for repeated avoid patterns → might need different approach
    if (learningProfile) {
      const rejects = learningProfile.ventureHistory.filter(v => v.decision === 'rejected');
      if (rejects.length >= 5) {
        const rejectedCategories = new Set(rejects.map(r => r.category));
        if (rejectedCategories.size <= 2) {
          // Repeated rejections in same category → might need better niche finding
          needs.push({
            missingCapability: `Repeated rejections in ${[...rejectedCategories].join(', ')}`,
            detectedFrom: 'repeated_failure',
            confidence: 60,
            suggestedRole: 'niche_finder',
            timestamp: Date.now(),
          });
        }
      }
    }

    return needs;
  }

  // ── Candidate creation ────────────────────────────────────────────────────

  createCandidate(need: ExpertHiringNeed): ExpertProfile {
    const now = Date.now();
    const id = `expert:${need.suggestedRole}:${now}`;

    const profile: ExpertProfile = {
      id,
      name: `${formatRoleName(need.suggestedRole)} (New)`,
      role: need.suggestedRole,
      pool: 'shared', // new hires start in shared pool
      status: 'candidate',
      protectionLevel: 'experimental',
      createdAt: now,
      lastSelectedAt: 0,
      selectionCount: 0,
      successContributionScore: 50,
      redundancyScore: 0,
      userApprovalInfluence: 0,
      revenueInfluence: 0,
      speedCost: 0,
      tokenCost: 0,
      errorRate: 0,
      confidence: 30,
      systemPromptFragment: `You are a specialist in ${need.suggestedRole.replace(/_/g, ' ')}. Hired to address: ${need.missingCapability}.`,
      taskTypes: getTaskTypesForRole(need.suggestedRole),
    };

    this._registry.addExpert(profile);
    this._ledger.record('hired', id, {
      role: need.suggestedRole,
      reason: need.missingCapability,
      detectedFrom: need.detectedFrom,
    });

    return profile;
  }

  promoteToTrial(expertId: string): void {
    const expert = this._registry.getExpert(expertId);
    if (!expert || expert.status !== 'candidate') return;

    this._registry.updateStatus(expertId, 'trial');
    this._ledger.record('promoted', expertId, { from: 'candidate', to: 'trial' });
  }
}

// ── Helpers ─────────────────────────────────────────────────────────────────

function formatRoleName(role: ExpertRole): string {
  return role
    .split('_')
    .map(w => w.charAt(0).toUpperCase() + w.slice(1))
    .join(' ');
}

function getTaskTypesForRole(role: ExpertRole): string[] {
  const result: string[] = [];
  for (const [taskType, roles] of Object.entries(TASK_TYPE_EXPERT_MAP)) {
    if (roles.includes(role)) result.push(taskType);
  }
  return result;
}
