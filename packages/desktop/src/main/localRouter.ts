// ── localRouter.ts — Phase 4 routing policy ────────────────────────────────────
//
// Decides whether a given task should be routed to the local model (Ollama) or
// to cloud providers, based on task category and inbound risk class.
//
// Policy (default — all overridable via UI):
//   informational risk class → prefer local
//   research / ops category  → prefer local
//   skill analysis           → always prefer local when enabled
//   council (multi-model)    → stays cloud unless explicitly set otherwise
//   write_action / high_risk → cloud only (needs best model)

import type { InboundRiskClass } from '@triforge/engine';

// Categories that benefit most from local routing — low-stakes, informational.
const LOCAL_PREFERRED_CATEGORIES = new Set(['research', 'ops']);

// Risk classes safe to run locally.
const LOCAL_PREFERRED_RISK = new Set<InboundRiskClass>(['informational']);

export interface LocalRoutingConfig {
  enabled: boolean;
  baseUrl: string;
  model: string;
  fallback: boolean;  // fall back to cloud if local unavailable
}

export type RoutingTarget = 'local' | 'cloud';

export interface RoutingDecision {
  target: RoutingTarget;
  reason: string;
}

/**
 * Decide where to route a task. Returns 'local' or 'cloud' with a reason string
 * suitable for the audit log.
 */
export function routeTask(
  config: LocalRoutingConfig,
  category: string,
  riskClass?: InboundRiskClass,
): RoutingDecision {
  if (!config.enabled || !config.model) {
    return { target: 'cloud', reason: 'local routing disabled' };
  }

  // High-risk and write actions stay on best available cloud model.
  if (riskClass === 'high_risk' || riskClass === 'write_action') {
    return { target: 'cloud', reason: `risk class ${riskClass} requires cloud` };
  }

  if (riskClass && LOCAL_PREFERRED_RISK.has(riskClass)) {
    return { target: 'local', reason: `risk class ${riskClass} routed locally` };
  }

  if (LOCAL_PREFERRED_CATEGORIES.has(category)) {
    return { target: 'local', reason: `category ${category} prefers local` };
  }

  return { target: 'cloud', reason: 'default cloud routing' };
}

/**
 * Skill analysis is always preferred to run locally when local is enabled —
 * keeping raw SKILL.md content off external APIs.
 */
export function routeSkillAnalysis(config: LocalRoutingConfig): RoutingDecision {
  if (!config.enabled || !config.model) {
    return { target: 'cloud', reason: 'local routing disabled — skill analysis via cloud' };
  }
  return { target: 'local', reason: 'skill analysis routed locally for privacy' };
}
