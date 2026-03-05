// ── PolicyGate.ts — Risk classification for mission approval gating ───────────
//
// Classifies a mission intent into a risk tier and decides whether it
// requires explicit user approval before execution.
//
// Policy (default — conservative):
//   Auto-execute (no approval needed):
//     • read-only scans, analysis, summarization
//     • preview / dry-run actions
//     • UI navigation intents
//
//   Require approval:
//     • file writes / patch apply
//     • git operations (commit, push, reset)
//     • shell command execution
//     • dependency updates
//     • network calls beyond configured providers
//
// The gate is intentionally strict: unknown intents default to requiring approval.

export type RiskLevel = 'safe' | 'low' | 'medium' | 'high' | 'critical';

export interface GateDecision {
  requiresApproval: boolean;
  riskLevel:        RiskLevel;
  reason:           string;
}

// ── Intent → risk rules (checked in order, first match wins) ─────────────────

interface Rule {
  /** Substring or regex that the intent must match. */
  match:            string | RegExp;
  riskLevel:        RiskLevel;
  requiresApproval: boolean;
  reason:           string;
}

const RULES: Rule[] = [
  // Critical — never auto-execute
  { match: /git\.(push|force|reset|rebase)/,     riskLevel: 'critical', requiresApproval: true,  reason: 'Destructive git operation' },
  { match: /shell\.|exec\.|run_command/,          riskLevel: 'critical', requiresApproval: true,  reason: 'Shell command execution' },
  { match: /delete\.|drop\.|remove_db/,           riskLevel: 'critical', requiresApproval: true,  reason: 'Destructive data operation' },

  // High — require approval
  { match: /git\.(commit|branch|merge)/,          riskLevel: 'high',    requiresApproval: true,  reason: 'Git write operation' },
  { match: /file\.write|patch\.apply|apply_patch/, riskLevel: 'high',   requiresApproval: true,  reason: 'File system write' },
  { match: /dev\.fix|dev\.refactor|dev\.update/,  riskLevel: 'high',    requiresApproval: true,  reason: 'Code modification' },
  { match: /deps\.update|package\.install/,       riskLevel: 'high',    requiresApproval: true,  reason: 'Dependency change' },

  // Medium — approval recommended
  { match: /media\.generate/,                     riskLevel: 'medium',  requiresApproval: true,  reason: 'Generative media (may incur cost)' },
  { match: /email\.|slack\.|notify\./,             riskLevel: 'medium',  requiresApproval: true,  reason: 'External communication' },

  // Safe — auto-execute
  { match: /ui\./,                                riskLevel: 'safe',    requiresApproval: false, reason: 'UI navigation — no side effects' },
  { match: /scan\.|analyze\.|summarize\./,        riskLevel: 'safe',    requiresApproval: false, reason: 'Read-only analysis' },
  { match: /preview\.|dry_run\./,                 riskLevel: 'safe',    requiresApproval: false, reason: 'Preview only — no writes' },
  { match: /file\.read|file\.search/,             riskLevel: 'safe',    requiresApproval: false, reason: 'Read-only file access' },
];

// ── PolicyGate ────────────────────────────────────────────────────────────────

export class PolicyGate {
  /**
   * Classify a mission intent and decide approval requirements.
   * Unknown intents default to high-risk / approval required.
   */
  classify(intent: string): GateDecision {
    for (const rule of RULES) {
      const matched = typeof rule.match === 'string'
        ? intent.includes(rule.match)
        : rule.match.test(intent);

      if (matched) {
        return {
          requiresApproval: rule.requiresApproval,
          riskLevel:        rule.riskLevel,
          reason:           rule.reason,
        };
      }
    }

    // Default: unknown intent → require approval
    return {
      requiresApproval: true,
      riskLevel:        'medium',
      reason:           'Unknown intent — defaulting to approval required',
    };
  }

  /** Returns true if this intent can execute without a user approval step. */
  isSafeToAutoExecute(intent: string): boolean {
    return !this.classify(intent).requiresApproval;
  }
}

/** Singleton. */
export const policyGate = new PolicyGate();
