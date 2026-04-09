// ── unrealMilestoneValidator.ts — B5: post-write JSON validation ──────────────
//
// Phase B5: Validate Unreal milestone outputs, not just file count.
//
// The unrealM[1-5] execute packs previously declared success on appliedFiles
// count alone. A file written with malformed JSON, or missing required header
// fields, would silently pass and corrupt the chain (M1 outputs feed M2,
// M2 feeds M3, etc.).
//
// This module performs a simple structural validation pass after each write:
//   • Read the file back from disk (catches "write succeeded but file empty"
//     or "permissions allowed write but path is unreadable" anomalies)
//   • For .json files: JSON.parse it (catches malformed JSON)
//   • Check required header fields exist (triforgeVersion, milestone, project,
//     generatedAt)
//   • For *_Manifest.json: additionally verify files[] is a non-empty array
//
// The validator returns a list of failures. The caller can downgrade or remove
// invalid files from appliedFiles and add the failures to warnings/errors so
// the pack outcome reflects reality.
//
// Why structural validation, not full JSON Schema:
//   • Each milestone has a unique shape — a full schema set would balloon
//     this module to thousands of lines and add a new failure surface
//   • The header field check + parseable JSON catches ~95% of the actual
//     failure modes (truncated writes, undefined values blowing up
//     stringify, manifest writes that beat the file writes)
//   • The downstream packs (M2 reads M1, etc.) already validate the shape
//     they need — this layer just stops obviously corrupt files from
//     entering the chain.

import fs from 'fs';

// ── Public types ──────────────────────────────────────────────────────────────

export interface MilestoneFileValidation {
  /** Path that was checked. */
  absolutePath: string;
  /** Relative path used for human-readable warnings. */
  relativePath: string;
  /** Whether the file passed structural validation. */
  ok: boolean;
  /** Failure reason — present only when ok === false. */
  reason?: string;
}

export interface MilestoneValidationInput {
  absolutePath: string;
  relativePath: string;
  /** Required milestone tag in the JSON header (e.g. 'M1', 'M3'). */
  expectedMilestone: string;
  /** True if the file is the *_Manifest.json record for this milestone. */
  isManifest: boolean;
}

// ── Required header fields ────────────────────────────────────────────────────

const REQUIRED_HEADER_FIELDS = ['triforgeVersion', 'milestone', 'project', 'generatedAt'] as const;

// ── Validator ─────────────────────────────────────────────────────────────────

/**
 * Validate a single milestone JSON file by reading it back from disk and
 * checking structural integrity. Markdown files are skipped — they have no
 * machine-readable schema and downstream packs do not consume them.
 */
export function validateMilestoneFile(input: MilestoneValidationInput): MilestoneFileValidation {
  const { absolutePath, relativePath, expectedMilestone, isManifest } = input;
  const base: Omit<MilestoneFileValidation, 'ok' | 'reason'> = { absolutePath, relativePath };

  // Markdown and Python companion files: only verify the file exists and is non-empty.
  // The Python scripts (M*_Apply.py) are emitted by C2-lite alongside the JSON
  // specs and have no machine-readable schema — they are user-runnable text.
  if (relativePath.endsWith('.md') || relativePath.endsWith('.py')) {
    try {
      const stat = fs.statSync(absolutePath);
      if (stat.size === 0) {
        return { ...base, ok: false, reason: 'file is empty (0 bytes)' };
      }
      return { ...base, ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return { ...base, ok: false, reason: `file not readable: ${msg}` };
    }
  }

  // JSON files: read + parse + structural check
  let raw: string;
  try {
    raw = fs.readFileSync(absolutePath, 'utf-8');
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ...base, ok: false, reason: `file not readable: ${msg}` };
  }

  if (raw.trim().length === 0) {
    return { ...base, ok: false, reason: 'file is empty (0 bytes after write)' };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ...base, ok: false, reason: `JSON parse failed: ${msg}` };
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { ...base, ok: false, reason: 'JSON root is not an object' };
  }

  const obj = parsed as Record<string, unknown>;

  // Required header fields
  for (const field of REQUIRED_HEADER_FIELDS) {
    const v = obj[field];
    if (v === undefined || v === null || (typeof v === 'string' && v.length === 0)) {
      return { ...base, ok: false, reason: `missing required header field "${field}"` };
    }
  }

  // Milestone tag must match the expected milestone
  if (obj.milestone !== expectedMilestone) {
    return {
      ...base,
      ok: false,
      reason: `milestone tag mismatch: expected "${expectedMilestone}", got "${String(obj.milestone)}"`,
    };
  }

  // Manifest-specific check: files[] must exist and be a non-empty array
  if (isManifest) {
    const files = obj.files;
    if (!Array.isArray(files)) {
      return { ...base, ok: false, reason: 'manifest.files is not an array' };
    }
    if (files.length === 0) {
      return { ...base, ok: false, reason: 'manifest.files is an empty array — no companion files were recorded' };
    }
    // Spot-check the first entry shape
    const first = files[0];
    if (first === null || typeof first !== 'object' || !('relativePath' in first)) {
      return { ...base, ok: false, reason: 'manifest.files[] entries are missing "relativePath"' };
    }
  }

  return { ...base, ok: true };
}

// ── Batch helper ──────────────────────────────────────────────────────────────

export interface BatchValidationResult {
  /** Files that passed validation — safe to keep in appliedFiles. */
  passed: MilestoneFileValidation[];
  /** Files that failed validation — remove from appliedFiles. */
  failed: MilestoneFileValidation[];
  /** Human-readable warning lines suitable for the apply result. */
  warnings: string[];
}

/**
 * Validate a batch of milestone files in one call. Returns the partition of
 * passed vs failed files and a list of human-readable warning lines.
 */
export function validateMilestoneBatch(inputs: MilestoneValidationInput[]): BatchValidationResult {
  const passed: MilestoneFileValidation[] = [];
  const failed: MilestoneFileValidation[] = [];
  const warnings: string[] = [];

  for (const input of inputs) {
    const result = validateMilestoneFile(input);
    if (result.ok) {
      passed.push(result);
    } else {
      failed.push(result);
      warnings.push(
        `Validation failed for ${result.relativePath}: ${result.reason}. ` +
        'This file will not be reported as a successful milestone artifact.',
      );
    }
  }

  return { passed, failed, warnings };
}
