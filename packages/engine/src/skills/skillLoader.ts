// ── skillLoader.ts ─────────────────────────────────────────────────────────
//
// Filesystem skill discovery for TriForge.
//
// Responsibility: scan one or more root directories for SKILL.md files,
// read them, and run each through the existing trust pipeline:
//
//   skillTrustEvaluator.analyze()  →  what's inside?
//   skillPolicyGate.evaluate()     →  what do we do about it?
//
// This file does NOT re-implement trust logic. It delegates entirely to the
// existing pipeline in packages/engine/src/tools/.
//
// It does NOT execute skill code. Execution lives in skillRegistry / AgentLoop.
//
// Design rules:
//   - Read-only filesystem access (existsSync + readFileSync only)
//   - Never crashes on malformed input — returns structured errors per skill
//   - Handles duplicate IDs across roots deterministically (first root wins
//     unless the conflict is with a reserved built-in, which always wins)
//   - Blocks path traversal and symlink escapes before reading any file
//   - Multiple roots merged in priority order: builtIn > user > workspace > extra

import fs   from 'fs';
import path from 'path';
import os   from 'os';
import crypto from 'crypto';
import { analyze }   from '../tools/skillTrustEvaluator';
import { evaluate }  from '../tools/skillPolicyGate';
import type {
  SkillAnalysisResult,
  PolicyGateDecision,
} from '../tools/skillRiskTypes';

// ── Public types ────────────────────────────────────────────────────────────

export type SkillSource = 'builtin' | 'user' | 'workspace' | 'extra';

export type SkillTrustLevel = 'trusted' | 'needs_approval' | 'council_review' | 'blocked';

export interface LoadedSkill {
  /** Stable identifier derived from the skill folder name (lowercased). */
  id:           string;
  name:         string;
  version:      string;
  description:  string;
  author:       string;
  tags:         string[];
  /** Declared permissions from SKILL.md frontmatter. */
  permissions:  string[];
  /** Optional JS/TS entry file declared in frontmatter. NOT loaded here. */
  entry?:       string;
  /** Absolute path to the skill directory. */
  skillDir:     string;
  /** Absolute path to the SKILL.md file. */
  skillMdPath:  string;
  /** Which root this skill was discovered under. */
  source:       SkillSource;
  /** SHA-256 of the raw SKILL.md content for integrity tracking. */
  checksum:     string;
  /** Raw markdown — kept for re-analysis and display. */
  skillMdRaw:   string;
  /** Result from skillTrustEvaluator.analyze(). */
  analysis:     SkillAnalysisResult;
  /** Final gate decision from skillPolicyGate.evaluate(). */
  decision:     PolicyGateDecision;
  /** Derived trust level label for UI / approval queue. */
  trustLevel:   SkillTrustLevel;
  /** Whether this skill can be used (not blocked, and policy allows). */
  enabled:      boolean;
}

export interface SkillLoadError {
  skillDir:   string;
  source:     SkillSource;
  reason:     string;
}

export interface SkillConflict {
  id:       string;
  winners:  string; // skill dir that won
  losers:   string; // skill dir that lost
  reason:   string;
}

export interface SkillLoadResult {
  /** Skills that passed loading and trust evaluation (may need approval). */
  loaded:      LoadedSkill[];
  /** Skills that were hard-blocked by the trust evaluator. */
  blocked:     LoadedSkill[];
  /** Skills that need human approval before use. */
  needsApproval: LoadedSkill[];
  /** Skills that need council review before use. */
  needsCouncil: LoadedSkill[];
  /** Skill folders that could not be loaded at all (missing/malformed). */
  errors:      SkillLoadError[];
  /** Duplicate ID conflicts resolved by source priority. */
  conflicts:   SkillConflict[];
  /** Total folders scanned across all roots. */
  scannedDirs: number;
}

// ── Root path helpers ───────────────────────────────────────────────────────

export interface SkillRoots {
  /** Built-in skills shipped with the app. Always highest priority. */
  builtIn?:   string;
  /** User's personal skill folder. */
  user?:      string;
  /** Per-project skill folder (e.g. .triforge/skills in a repo). */
  workspace?: string;
  /** Additional roots (ForgeHub install directory, etc.). */
  extra?:     string[];
}

/** Returns default roots for the current platform. */
export function defaultSkillRoots(appResourcesPath: string): SkillRoots {
  return {
    builtIn:   path.join(appResourcesPath, 'skills'),
    user:      path.join(os.homedir(), '.triforge', 'skills'),
    workspace: path.join(process.cwd(), '.triforge', 'skills'),
  };
}

// ── Path safety ─────────────────────────────────────────────────────────────
// Validates that a resolved path stays inside its expected root.

function isSafe(resolved: string, root: string): boolean {
  const normalRoot     = path.normalize(root)  + path.sep;
  const normalResolved = path.normalize(resolved);
  return normalResolved.startsWith(normalRoot) || normalResolved === path.normalize(root);
}

/** Checks for symlinks that escape the root. Resolves one level only. */
function isSymlinkEscape(filePath: string, root: string): boolean {
  try {
    const stat = fs.lstatSync(filePath);
    if (!stat.isSymbolicLink()) return false;
    const real = fs.realpathSync(filePath);
    return !isSafe(real, root);
  } catch {
    return false;
  }
}

// ── Entry path safety ───────────────────────────────────────────────────────

function sanitizeEntry(entry: unknown, skillDir: string): string | undefined {
  if (typeof entry !== 'string' || !entry.trim()) return undefined;

  // Strip any leading path separators or drive letters
  const cleaned = entry.trim().replace(/^[/\\]+/, '').replace(/^[A-Za-z]:/, '');

  // Must not contain traversal sequences
  if (cleaned.includes('..') || path.isAbsolute(cleaned)) return undefined;

  const resolved = path.join(skillDir, cleaned);
  if (!isSafe(resolved, skillDir)) return undefined;

  return cleaned;
}

// ── Directory discovery ─────────────────────────────────────────────────────

function findSkillDirectories(root: string): string[] {
  if (!fs.existsSync(root)) return [];
  try {
    const entries = fs.readdirSync(root, { withFileTypes: true });
    return entries
      .filter(e => e.isDirectory() || (e.isSymbolicLink() && !isSymlinkEscape(path.join(root, e.name), root)))
      .map(e => path.join(root, e.name));
  } catch {
    return [];
  }
}

function findSkillMd(skillDir: string): string | null {
  const candidate = path.join(skillDir, 'SKILL.md');
  if (fs.existsSync(candidate)) return candidate;
  return null;
}

// ── ID normalization ────────────────────────────────────────────────────────

function deriveFolderId(skillDir: string): string {
  return path.basename(skillDir)
    .toLowerCase()
    .replace(/[^a-z0-9_-]/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

function extractId(frontmatterRaw: string, skillDir: string): string {
  // Attempt to read `id:` from frontmatter
  const match = frontmatterRaw.match(/^id\s*:\s*(.+)$/m);
  if (match) {
    const raw = match[1].trim().replace(/^['"]|['"]$/g, '').toLowerCase().replace(/[^a-z0-9_-]/g, '-');
    if (raw) return raw;
  }
  // Fall back to folder name
  return deriveFolderId(skillDir);
}

// ── Trust level derivation ──────────────────────────────────────────────────

function deriveTrustLevel(decision: PolicyGateDecision): SkillTrustLevel {
  if (!decision.allowed)                  return 'blocked';
  if (decision.requiresCouncilReview)     return 'council_review';
  if (decision.requiresApproval)          return 'needs_approval';
  return 'trusted';
}

// ── Single skill loader ─────────────────────────────────────────────────────

function loadSkillFromDir(
  skillDir: string,
  root:     string,
  source:   SkillSource,
): { skill: LoadedSkill } | { error: SkillLoadError } {
  // Path safety check
  if (!isSafe(skillDir, root)) {
    return { error: { skillDir, source, reason: 'Skill directory escapes its root — path traversal blocked.' } };
  }

  const skillMdPath = findSkillMd(skillDir);
  if (!skillMdPath) {
    return { error: { skillDir, source, reason: 'No SKILL.md found in directory.' } };
  }

  if (isSymlinkEscape(skillMdPath, root)) {
    return { error: { skillDir, source, reason: 'SKILL.md is a symlink that escapes the skills root.' } };
  }

  let raw: string;
  try {
    raw = fs.readFileSync(skillMdPath, 'utf8');
  } catch (err) {
    return { error: { skillDir, source, reason: `Could not read SKILL.md: ${err instanceof Error ? err.message : String(err)}` } };
  }

  if (!raw.trim()) {
    return { error: { skillDir, source, reason: 'SKILL.md is empty.' } };
  }

  const checksum = crypto.createHash('sha256').update(raw, 'utf8').digest('hex');
  const analysis = analyze(raw);
  const decision = evaluate(analysis);
  const trustLevel = deriveTrustLevel(decision);
  const fm = analysis.frontmatter;

  // Required field validation
  const name    = typeof fm.name    === 'string' && fm.name.trim()    ? fm.name.trim()    : '';
  const version = typeof fm.version === 'string' && fm.version.trim() ? fm.version.trim() : '0.0.0';

  if (!name) {
    return { error: { skillDir, source, reason: 'SKILL.md missing required field: name.' } };
  }

  const id          = extractId(raw, skillDir);
  const description = typeof fm.description === 'string' ? fm.description.trim() : '';
  const author      = typeof fm.author      === 'string' ? fm.author.trim()      : 'Unknown';
  const tags        = Array.isArray(fm.tags)        ? (fm.tags as string[]).map(String).filter(Boolean)        : [];
  const permissions = Array.isArray(fm.permissions) ? (fm.permissions as string[]).map(String).filter(Boolean) : [];
  const entry       = sanitizeEntry(fm.entry, skillDir);

  const skill: LoadedSkill = {
    id,
    name,
    version,
    description,
    author,
    tags:        [...new Set(tags)],
    permissions: [...new Set(permissions)],
    entry,
    skillDir,
    skillMdPath,
    source,
    checksum,
    skillMdRaw: raw,
    analysis,
    decision,
    trustLevel,
    enabled: decision.allowed && !decision.requiresApproval && !decision.requiresCouncilReview,
  };

  return { skill };
}

// ── Multi-root scanner ──────────────────────────────────────────────────────

export function loadSkills(roots: SkillRoots): SkillLoadResult {
  const result: SkillLoadResult = {
    loaded:        [],
    blocked:       [],
    needsApproval: [],
    needsCouncil:  [],
    errors:        [],
    conflicts:     [],
    scannedDirs:   0,
  };

  // Process roots in priority order: builtIn > user > workspace > extra
  const rootEntries: Array<{ rootPath: string; source: SkillSource }> = [];

  if (roots.builtIn)   rootEntries.push({ rootPath: roots.builtIn,   source: 'builtin'   });
  if (roots.user)      rootEntries.push({ rootPath: roots.user,       source: 'user'      });
  if (roots.workspace) rootEntries.push({ rootPath: roots.workspace,  source: 'workspace' });
  for (const extra of roots.extra ?? []) {
    rootEntries.push({ rootPath: extra, source: 'extra' });
  }

  // Track seen IDs for conflict detection (id → winning skill dir)
  const seenIds = new Map<string, string>();

  for (const { rootPath, source } of rootEntries) {
    const dirs = findSkillDirectories(rootPath);
    result.scannedDirs += dirs.length;

    for (const skillDir of dirs) {
      const outcome = loadSkillFromDir(skillDir, rootPath, source);

      if ('error' in outcome) {
        result.errors.push(outcome.error);
        continue;
      }

      const { skill } = outcome;

      // Conflict detection
      if (seenIds.has(skill.id)) {
        const winner = seenIds.get(skill.id)!;
        result.conflicts.push({
          id:     skill.id,
          winners: winner,
          losers:  skillDir,
          reason: `Duplicate skill ID "${skill.id}". "${winner}" (higher priority root) wins.`,
        });
        continue; // skip the duplicate
      }

      seenIds.set(skill.id, skillDir);

      // Route into result buckets
      if (skill.trustLevel === 'blocked') {
        result.blocked.push(skill);
      } else if (skill.trustLevel === 'council_review') {
        result.needsCouncil.push(skill);
      } else if (skill.trustLevel === 'needs_approval') {
        result.needsApproval.push(skill);
      } else {
        result.loaded.push(skill);
      }
    }
  }

  return result;
}

// ── Single-skill loader (for on-demand install flows) ───────────────────────
// Used when ForgeHub or the user installs a skill from a known directory.

export function loadSingleSkill(
  skillDir:   string,
  root:       string,
  source:     SkillSource = 'user',
): { skill: LoadedSkill } | { error: SkillLoadError } {
  return loadSkillFromDir(skillDir, root, source);
}
