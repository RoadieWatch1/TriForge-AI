// ── experiments/types.ts — Types for parallel council experiment runner ────────

/** A file write operation within a candidate patch. Path is relative to workspaceRoot. */
export interface FilePatch {
  path:    string;
  content: string;
}

/** A single candidate approach produced by the council. */
export interface PatchCandidate {
  id:               string;
  approach:         string;   // Short title of the approach
  rationale:        string;   // Why this approach is recommended
  patches:          FilePatch[];
  /** Optional hint for which files the council expects to change (planning phase only). */
  filesLikelyTouched?: string[];
}

/** Verification check result. */
export interface VerificationCheck {
  name:      string;
  ok:        boolean;
  skipped?:  boolean;
  details?:  string;   // First 300 chars of output/error
}

/** Result of running one experiment candidate through the sandbox + verifier. */
export interface ExperimentResult {
  candidateId:  string;
  approach:     string;
  sandboxPath:  string;
  /** 0–100. Scoring policy: lint(+40), build(+40), test(+20). Fail = subtract 60, cap at 0. Skipped = full points. */
  score:        number;
  checks:       VerificationCheck[];
  artifacts?:   { diffSummary?: string };
}

/** Council vote result — selects winner from candidates after experiments. */
export interface CouncilVote {
  winnerCandidateId:    string;
  reason:               string;
  risks:                string[];
  fallbackCandidateId?: string;
}

// ── Scoring policy ────────────────────────────────────────────────────────────
// Pass/skip: lint+40, build+40, test+20 → max 100
// Hard fail: deduct 60 per failed check, floor at 0

export function scoreChecks(checks: VerificationCheck[]): number {
  let score = 100;
  const WEIGHTS: Record<string, number> = { lint: 40, build: 40, test: 20 };
  const PENALTY = 60;

  for (const check of checks) {
    if (check.skipped) continue;                // skipped → keep full weight
    if (!check.ok) score -= PENALTY;
  }

  // Subtract points for checks that weren't included at all (only for explicitly included ones)
  const checkedNames = new Set(checks.map(c => c.name));
  for (const [name, weight] of Object.entries(WEIGHTS)) {
    if (!checkedNames.has(name)) score -= weight; // missing check = not available = subtract its weight
  }

  return Math.max(0, score);
}

// Simpler: score based on what was actually checked
export function scoreChecksWeighted(checks: VerificationCheck[]): number {
  const WEIGHTS: Record<string, number> = { lint: 40, build: 40, test: 20 };
  let score = 0;

  for (const check of checks) {
    const weight = WEIGHTS[check.name] ?? 0;
    if (check.skipped || check.ok) {
      score += weight;  // pass or skipped = full points
    }
    // fail = 0 for that check
  }

  return Math.min(100, score);
}
