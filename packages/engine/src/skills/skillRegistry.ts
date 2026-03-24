// ── skillRegistry.ts ───────────────────────────────────────────────────────
//
// Thin bridge between the skill system layers.
//
// Responsibility:
//   1. On startup, sync built-in ForgeHub skills into the SkillStoreManager
//      (installs any built-in skill not already stored — never overwrites user state)
//   2. Provides getActiveSkill() / listActiveSkills() for the execution layer
//
// This file does NOT re-implement storage (SkillStoreManager owns that),
// trust evaluation (skillTrustEvaluator owns that), or discovery
// (skillLoader owns that). It is a startup coordinator only.
//
// Usage (called once from ipc.ts after SkillStoreManager is initialized):
//   await syncBuiltinSkills(skillStoreManager);

import { listForgeHubSkills, getSkillMarkdown } from './forgeHub';
import { analyze }  from '../tools/skillTrustEvaluator';
import { evaluate } from '../tools/skillPolicyGate';

// ── Types consumed from the caller (SkillStoreManager interface) ────────────
// We use a structural interface so skillRegistry.ts stays decoupled from the
// desktop package where SkillStoreManager lives.

export interface ActiveSkill {
  id:          string;
  name:        string;
  version?:    string;
  description?: string;
  rawMarkdown: string;
  enabled:     boolean;
  riskLevel:   string;
  blocked:     boolean;
  requiresApproval: boolean;
}

interface SkillStoreAdapter {
  list(): ActiveSkill[];
  install(fields: Omit<ActiveSkill, 'id'> & {
    source: string;
    sourceUrl?: string;
    councilReviewRequired: boolean;
    declaredCapabilities: string[];
    detectedCapabilities: string[];
    reviewSummary: string;
    runCount: number;
    installedAt: number;
  }): ActiveSkill;
}

// ── Startup sync ────────────────────────────────────────────────────────────

/**
 * Ensures every ForgeHub built-in skill is present in the skill store.
 * - Only installs skills not already tracked by ID-prefix match.
 * - Never overwrites existing user-modified installs.
 * - Skills that are blocked by trust evaluation are not installed.
 *
 * Call once at app startup after SkillStoreManager is ready.
 */
export function syncBuiltinSkills(store: SkillStoreAdapter): { installed: string[]; skipped: string[] } {
  const existing  = store.list();
  const existingNames = new Set(existing.map(s => s.name.toLowerCase()));

  const installed: string[] = [];
  const skipped:   string[] = [];

  for (const entry of listForgeHubSkills()) {
    // Skip if a skill with the same name is already in the store
    if (existingNames.has(entry.name.toLowerCase())) {
      skipped.push(entry.id);
      continue;
    }

    const markdown = getSkillMarkdown(entry.id);
    if (!markdown) { skipped.push(entry.id); continue; }

    const analysis = analyze(markdown);
    const decision = evaluate(analysis);

    // Do not auto-install blocked skills (shouldn't happen for built-ins, but guard anyway)
    if (decision.allowed === false) {
      skipped.push(entry.id);
      continue;
    }

    store.install({
      name:                   entry.name,
      version:                entry.version,
      description:            entry.description,
      rawMarkdown:            markdown,
      source:                 'example',
      riskLevel:              analysis.riskLevel,
      blocked:                analysis.blocked,
      requiresApproval:       decision.requiresApproval,
      councilReviewRequired:  decision.requiresCouncilReview,
      declaredCapabilities:   analysis.declaredCapabilities,
      detectedCapabilities:   analysis.detectedCapabilities,
      reviewSummary:          analysis.reviewSummary,
      enabled:                !decision.requiresApproval && !decision.requiresCouncilReview,
      runCount:               0,
      installedAt:            Date.now(),
    });

    installed.push(entry.id);
  }

  return { installed, skipped };
}

// ── Active skill lookup helpers ─────────────────────────────────────────────

/** Returns all enabled, non-blocked skills from the store. */
export function listActiveSkills(store: SkillStoreAdapter): ActiveSkill[] {
  return store.list().filter(s => s.enabled && !s.blocked);
}

/** Returns a single enabled skill by name (case-insensitive). */
export function getActiveSkillByName(store: SkillStoreAdapter, name: string): ActiveSkill | undefined {
  const lower = name.toLowerCase();
  return store.list().find(s => s.name.toLowerCase() === lower && s.enabled && !s.blocked);
}
