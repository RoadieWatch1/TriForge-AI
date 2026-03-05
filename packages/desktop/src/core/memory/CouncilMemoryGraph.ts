// ── CouncilMemoryGraph.ts — Persistent engineering knowledge across missions ───
//
// Stores three buckets of engineering knowledge to `.triforge-memory/`:
//   bugfixes.json      — bug diagnoses, root causes, applied fixes
//   architecture.json  — architectural decisions and trade-offs
//   experiments.json   — experiment results, scores, winning/failing approaches
//
// Retrieved before planning — the council inherits past engineering context
// so it does not repeat mistakes or re-debate settled decisions.
//
// Hardening properties:
//   • Versioned schema (schemaVersion) + migrate() path for future format changes
//   • Dedup via deterministic ID — same fix re-recorded updates lastSeen/count
//   • Recency scoring: recent entries rank higher, old entries decay out
//   • Negative memory: failed experiments stored with failureReason to block
//     the council from repeating bad patterns
//   • Retrieval threshold: zero-score matches are never injected
//   • Structured injection format with clear COUNCIL MEMORY / WORKSPACE sections
//   • All writes are atomic (tmp → rename) and failure-safe (never crash the caller)
//   • Output sanitized — common secret patterns redacted before injection

import fs   from 'fs';
import path from 'path';
import { createLogger } from '../logging/log';

const log = createLogger('CouncilMemoryGraph');

// ── Constants ──────────────────────────────────────────────────────────────────

const SCHEMA_VERSION    = 1;
const MEMORY_DIR        = '.triforge-memory';
const MAX_ENTRIES       = 200;    // per bucket — oldest pruned when exceeded
const MAX_RESULTS       = 6;      // max entries returned per retrieval query
const MAX_CONTEXT_CHARS = 3_000;  // hard cap on returned mission context string
const MIN_SCORE         = 1;      // minimum score to include an entry in results

// Recency scoring constants (in ms)
const MS_7D  = 7  * 24 * 60 * 60 * 1000;
const MS_30D = 30 * 24 * 60 * 60 * 1000;
const MS_90D = 90 * 24 * 60 * 60 * 1000;

// Secret patterns to redact from injected context
const SECRET_PATTERNS: RegExp[] = [
  /sk-[A-Za-z0-9_-]{20,}/g,              // OpenAI / Anthropic API keys
  /ghp_[A-Za-z0-9]{36}/g,                // GitHub personal access tokens
  /Bearer\s+[A-Za-z0-9_\-./=+]{20,}/g,  // Bearer tokens
  /[A-Za-z0-9_-]{32,}==/g,              // base64-ish secrets
];

// ── Types ──────────────────────────────────────────────────────────────────────

interface MemoryFile<T> {
  schemaVersion: number;
  entries:       T[];
}

export interface BugfixEntry {
  id:           string;
  ts:           number;   // first recorded
  lastSeen:     number;   // last time this dedup matched
  count:        number;   // how many times this pattern appeared
  missionId:    string;
  symptom:      string;
  rootCause:    string;
  fix:          string;
  filesChanged: string[];
}

export interface ArchitectureEntry {
  id:        string;
  ts:        number;
  lastSeen:  number;
  count:     number;
  missionId: string;
  decision:  string;
  rationale: string;
  tradeoffs: string;
}

export interface ExperimentEntry {
  id:            string;
  ts:            number;
  lastSeen:      number;
  count:         number;
  missionId:     string;
  goal:          string;
  approach:      string;
  score:         number;
  generation:    number;
  failedChecks:  string[];
  outcome:       'success' | 'fail';
  failureReason?: string;
}

export interface PositionEntry {
  id:           string;
  ts:           number;
  lastSeen:     number;
  count:        number;
  symbol:       string;
  entryThesis:  string;
  entryPrice?:  number;
  stopLoss?:    number;
  targetExit?:  number;
  status:       'open' | 'closed' | 'watching';
  notes?:       string;
}

type Bucket = 'bugfixes' | 'architecture' | 'experiments' | 'positions';

// ── CouncilMemoryGraph ─────────────────────────────────────────────────────────

export class CouncilMemoryGraph {
  private readonly memoryDir: string;

  constructor(workspaceRoot: string) {
    this.memoryDir = path.join(workspaceRoot, MEMORY_DIR);
    this._ensureDir();
  }

  // ── Write (failure-safe — never throws into caller) ───────────────────────

  recordBugfix(data: Omit<BugfixEntry, 'id' | 'ts' | 'lastSeen' | 'count'>): void {
    try {
      const id = this._hash(data.symptom, data.rootCause, data.fix);
      this._upsert<BugfixEntry>('bugfixes', id, (existing) => ({
        id,
        ts:           existing?.ts ?? Date.now(),
        lastSeen:     Date.now(),
        count:        (existing?.count ?? 0) + 1,
        ...data,
      }));
    } catch (e) {
      log.warn('recordBugfix failed (non-fatal):', e);
    }
  }

  recordArchitectureDecision(data: Omit<ArchitectureEntry, 'id' | 'ts' | 'lastSeen' | 'count'>): void {
    try {
      const id = this._hash(data.decision, data.rationale);
      this._upsert<ArchitectureEntry>('architecture', id, (existing) => ({
        id,
        ts:       existing?.ts ?? Date.now(),
        lastSeen: Date.now(),
        count:    (existing?.count ?? 0) + 1,
        ...data,
      }));
    } catch (e) {
      log.warn('recordArchitectureDecision failed (non-fatal):', e);
    }
  }

  recordExperiment(data: Omit<ExperimentEntry, 'id' | 'ts' | 'lastSeen' | 'count'>): void {
    try {
      const id = this._hash(data.goal, data.approach);
      this._upsert<ExperimentEntry>('experiments', id, (existing) => ({
        id,
        ts:       existing?.ts ?? Date.now(),
        lastSeen: Date.now(),
        count:    (existing?.count ?? 0) + 1,
        ...data,
      }));
    } catch (e) {
      log.warn('recordExperiment failed (non-fatal):', e);
    }
  }

  /**
   * Record or update a trader position in the positions bucket.
   * Deduped by symbol — updating the same symbol updates its thesis/notes.
   */
  recordPosition(data: Omit<PositionEntry, 'id' | 'ts' | 'lastSeen' | 'count'>): void {
    try {
      const id = this._hash(data.symbol.toUpperCase(), data.entryThesis.slice(0, 60));
      this._upsert<PositionEntry>('positions', id, (existing) => ({
        id,
        ts:       existing?.ts ?? Date.now(),
        lastSeen: Date.now(),
        count:    (existing?.count ?? 0) + 1,
        ...data,
        symbol: data.symbol.toUpperCase(),
      }));
    } catch (e) {
      log.warn('recordPosition failed (non-fatal):', e);
    }
  }

  /**
   * Retrieve all open and watching positions for Trader blueprint context injection.
   */
  retrieveActivePositions(): PositionEntry[] {
    try {
      const all = this._read<PositionEntry>('positions');
      return all.filter(p => p.status === 'open' || p.status === 'watching');
    } catch {
      return [];
    }
  }

  // ── Read ───────────────────────────────────────────────────────────────────

  /**
   * Retrieve bugfix entries that previously touched any of the given file paths.
   * Used by MissionController to inject file-specific failure history before planning.
   */
  retrieveByFiles(files: string[]): BugfixEntry[] {
    if (files.length === 0) return [];
    try {
      const normalised = files.map(f => f.toLowerCase().replace(/\\/g, '/'));
      return this._read<BugfixEntry>('bugfixes')
        .filter(e => e.filesChanged.some(fc => {
          const norm = fc.toLowerCase().replace(/\\/g, '/');
          return normalised.some(f => norm.includes(f) || f.includes(norm));
        }))
        .slice(0, MAX_RESULTS);
    } catch {
      return [];
    }
  }

  retrieveRelevant(query: string): {
    bugfixes:      BugfixEntry[];
    architecture:  ArchitectureEntry[];
    experiments:   ExperimentEntry[];
  } {
    const keywords = this._keywords(query);
    const now      = Date.now();
    return {
      bugfixes:     this._topMatches<BugfixEntry>(    'bugfixes',     keywords, now, e => `${e.symptom} ${e.rootCause} ${e.fix}`),
      architecture: this._topMatches<ArchitectureEntry>('architecture', keywords, now, e => `${e.decision} ${e.rationale}`),
      experiments:  this._topMatches<ExperimentEntry>( 'experiments',  keywords, now, e => `${e.goal} ${e.approach}`),
    };
  }

  /**
   * Build a structured context string for injection into ThinkTankPlanner prompts.
   * Returns an empty string if no entries clear the MIN_SCORE threshold.
   * Output is sanitized — secret-looking strings are redacted.
   */
  buildMissionContext(goal: string): string {
    const { bugfixes, architecture, experiments } = this.retrieveRelevant(goal);
    const activePositions = this._isTraderQuery(goal) ? this.retrieveActivePositions() : [];

    if (bugfixes.length === 0 && architecture.length === 0 && experiments.length === 0 && activePositions.length === 0) {
      return '';
    }

    const lines: string[] = ['[COUNCIL MEMORY — RELEVANT PAST ENGINEERING]'];

    if (bugfixes.length > 0) {
      lines.push('');
      for (const e of bugfixes) {
        const age = e.count > 1 ? ` (seen ${e.count}×)` : '';
        lines.push(`Bug fix${age}: ${e.symptom}`);
        lines.push(`  Root cause: ${e.rootCause}`);
        lines.push(`  Applied fix: ${e.fix}`);
        if (e.filesChanged.length > 0) lines.push(`  Files: ${e.filesChanged.slice(0, 4).join(', ')}`);
      }
    }

    if (architecture.length > 0) {
      lines.push('');
      for (const e of architecture) {
        lines.push(`Architecture decision: ${e.decision}`);
        lines.push(`  Rationale: ${e.rationale}`);
        if (e.tradeoffs) lines.push(`  Trade-offs: ${e.tradeoffs}`);
      }
    }

    if (experiments.length > 0) {
      const successes = experiments.filter(e => e.outcome === 'success');
      const failures  = experiments.filter(e => e.outcome === 'fail');

      if (successes.length > 0) {
        lines.push('');
        lines.push('Successful approaches (prefer these patterns):');
        for (const e of successes) {
          lines.push(`  "${e.approach}" — score ${e.score}/100, goal: ${e.goal}`);
        }
      }

      if (failures.length > 0) {
        lines.push('');
        lines.push('Failed approaches (avoid these patterns):');
        for (const e of failures) {
          lines.push(`  "${e.approach}" — score ${e.score}/100, goal: ${e.goal}`);
          if (e.failureReason) lines.push(`    Reason: ${e.failureReason}`);
          if (e.failedChecks.length > 0) lines.push(`    Failed checks: ${e.failedChecks.join(', ')}`);
        }
      }
    }

    if (activePositions.length > 0) {
      lines.push('');
      lines.push('Active positions (open / watching):');
      for (const p of activePositions) {
        const price  = p.entryPrice  != null ? ` entry $${p.entryPrice}`  : '';
        const stop   = p.stopLoss    != null ? ` stop $${p.stopLoss}`     : '';
        const target = p.targetExit  != null ? ` target $${p.targetExit}` : '';
        lines.push(`  ${p.symbol} [${p.status}]${price}${stop}${target} — ${p.entryThesis}`);
        if (p.notes) lines.push(`    Notes: ${p.notes}`);
      }
    }

    const result = this._sanitize(lines.join('\n'));
    return result.length > MAX_CONTEXT_CHARS
      ? result.slice(0, MAX_CONTEXT_CHARS) + '\n[memory truncated]'
      : result;
  }

  // ── Private ────────────────────────────────────────────────────────────────

  private _ensureDir(): void {
    try { fs.mkdirSync(this.memoryDir, { recursive: true }); }
    catch { /* already exists or unwritable — reads will return [] */ }
  }

  private _filePath(bucket: Bucket): string {
    return path.join(this.memoryDir, `${bucket}.json`);
  }

  private _read<T>(bucket: Bucket): T[] {
    try {
      const raw  = fs.readFileSync(this._filePath(bucket), 'utf8');
      const data = JSON.parse(raw) as unknown;

      // Legacy flat array (pre-schema): wrap and migrate
      if (Array.isArray(data)) {
        return this._migrate<T>({ schemaVersion: 0, entries: data });
      }

      const file = data as MemoryFile<T>;
      if (file.schemaVersion !== SCHEMA_VERSION) {
        return this._migrate<T>(file);
      }

      return Array.isArray(file.entries) ? file.entries : [];
    } catch {
      return [];
    }
  }

  private _migrate<T>(file: MemoryFile<T>): T[] {
    // v0 → v1: entries were flat arrays with no lastSeen/count — backfill defaults
    if (file.schemaVersion === 0) {
      const now = Date.now();
      return (file.entries ?? []).map((e: unknown) => ({
        lastSeen: now,
        count:    1,
        ...(e as object),
      })) as T[];
    }
    // Future migrations go here
    return file.entries ?? [];
  }

  private _write<T>(bucket: Bucket, entries: T[]): void {
    const filePath = this._filePath(bucket);
    const tmpPath  = filePath + '.tmp';
    const file: MemoryFile<T> = { schemaVersion: SCHEMA_VERSION, entries };
    try {
      fs.writeFileSync(tmpPath, JSON.stringify(file, null, 2), 'utf8');
      fs.renameSync(tmpPath, filePath);
    } catch (e) {
      log.warn(`failed to write ${bucket} memory (non-fatal):`, e);
    }
  }

  /** Upsert by ID. Calls `build(existing | undefined)` to construct the new entry. */
  private _upsert<T extends { id: string }>(
    bucket:  Bucket,
    id:      string,
    build:   (existing: T | undefined) => T,
  ): void {
    const entries  = this._read<T>(bucket);
    const idx      = entries.findIndex(e => e.id === id);
    const existing = idx >= 0 ? entries[idx] : undefined;
    const updated  = build(existing);

    if (idx >= 0) {
      entries[idx] = updated;
    } else {
      entries.push(updated);
    }

    // Prune oldest when over cap
    const pruned = entries.length > MAX_ENTRIES
      ? entries.slice(entries.length - MAX_ENTRIES)
      : entries;

    this._write(bucket, pruned);
    log.info(`upserted ${bucket} entry id=${id} count=${(updated as unknown as BugfixEntry).count}`);
  }

  private _keywords(query: string): string[] {
    return query.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  }

  /**
   * Score an entry by keyword overlap + recency boost - decay.
   *
   * base  = number of keywords found in text
   * +2    if updated within 7 days
   * +1    if updated within 30 days
   * -1    if older than 90 days
   * -2    if older than 180 days
   */
  private _scoreEntry<T extends { lastSeen: number }>(
    entry:    T,
    keywords: string[],
    now:      number,
    toText:   (e: T) => string,
  ): number {
    const haystack = toText(entry).toLowerCase();
    let score = keywords.reduce((n, kw) => n + (haystack.includes(kw) ? 1 : 0), 0);

    const age = now - entry.lastSeen;
    if      (age < MS_7D)          score += 2;
    else if (age < MS_30D)         score += 1;
    else if (age > MS_90D * 2)     score -= 2;
    else if (age > MS_90D)         score -= 1;

    return score;
  }

  private _topMatches<T extends { lastSeen: number }>(
    bucket:   Bucket,
    keywords: string[],
    now:      number,
    toText:   (e: T) => string,
  ): T[] {
    const entries = this._read<T>(bucket);

    if (keywords.length === 0) {
      // No query — return most recent, skip decay
      return [...entries]
        .sort((a, b) => b.lastSeen - a.lastSeen)
        .slice(0, MAX_RESULTS);
    }

    return entries
      .map(e => ({ e, score: this._scoreEntry(e, keywords, now, toText) }))
      .filter(({ score }) => score >= MIN_SCORE)
      .sort((a, b) => b.score - a.score)
      .slice(0, MAX_RESULTS)
      .map(({ e }) => e);
  }

  /** Returns true if the query looks trading/position-related. */
  private _isTraderQuery(query: string): boolean {
    const q = query.toLowerCase();
    return /\b(trade|trading|position|stock|ticker|equity|option|forex|crypto|portfolio|entry|exit|bull|bear|long|short|hold|sell|buy)\b/.test(q);
  }

  /** Redact common secret patterns from output before injection. */
  private _sanitize(text: string): string {
    let result = text;
    for (const pattern of SECRET_PATTERNS) {
      result = result.replace(pattern, '[REDACTED]');
    }
    return result;
  }

  /** Deterministic djb2-based hash — used as dedup ID. */
  private _hash(...parts: string[]): string {
    const str  = parts.join('|').toLowerCase().trim();
    let   hash = 5381;
    for (let i = 0; i < str.length; i++) {
      hash = (((hash << 5) + hash) ^ str.charCodeAt(i)) >>> 0;
    }
    return hash.toString(36);
  }
}

/**
 * Singleton instance for use by ExperimentEngine and other core subsystems.
 * Uses the default .triforge-memory/ directory relative to process.cwd().
 * ipc.ts may create a separate instance scoped to userData if needed.
 */
export const engineMemoryGraph = new CouncilMemoryGraph(process.cwd());
