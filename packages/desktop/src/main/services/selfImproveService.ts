// ── selfImproveService.ts ──────────────────────────────────────────────────────
//
// TriForge Self-Improvement Code Agent
//
// A multi-turn code agent that can analyse, plan, edit, verify, and iterate
// on TriForge's own source code — the same loop a human developer follows:
//
//   1. Read relevant source files (dynamically discovered)
//   2. Plan improvements via Claude
//   3. Apply edits (modify existing files or create new ones)
//   4. Verify with `npx tsc --noEmit`
//   5. If build fails → feed errors back to Claude → retry (up to 3 rounds)
//   6. Log everything in an audit trail
//
// Triggers:
//   - Manual:  user calls `runImprovement(goal)` via IPC
//   - Reactive: after operator task failure, `onOperatorTaskFailure()` auto-runs
//   - Proactive: `scanForImprovements()` does a code health sweep
//
// Safety:
//   - Only modifies files under packages/desktop/src/ and packages/engine/src/
//   - Creates .bak backups before every edit; auto-rollback on final build failure
//   - Rate-limited: max 1 auto-improvement per 30 min
//   - Only high-confidence edits auto-applied in reactive mode
//   - Full audit log at {sourceRoot}/.triforge/self-improve-log.json

import fs   from 'fs';
import path from 'path';
import https from 'https';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

// ── Types ────────────────────────────────────────────────────────────────────

export interface CodeEdit {
  file:       string;    // relative to source root
  search:     string;    // exact substring to find (empty = new file)
  replace:    string;    // replacement content
  reason:     string;
  confidence: 'high' | 'medium' | 'low';
  category:   'reliability' | 'capability' | 'performance' | 'safety' | 'error-handling';
}

export interface ImprovementResult {
  ok:           boolean;
  goal:         string;
  summary:      string;
  editsApplied: CodeEdit[];
  editsSkipped: CodeEdit[];
  filesCreated: string[];
  verified:     boolean;
  rolledBack:   boolean;
  retryRounds:  number;
  buildOutput?: string;
  error?:       string;
  durationMs:   number;
}

export interface ImprovementLogEntry {
  timestamp:  string;
  goal:       string;
  trigger:    'manual' | 'auto_failure' | 'auto_scan';
  result:     ImprovementResult;
}

export interface SelfImproveStatus {
  running:      boolean;
  currentGoal?: string;
  autoEnabled:  boolean;
  lastRunAt?:   string;
  totalRuns:    number;
  totalEdits:   number;
}

// ── Constants ────────────────────────────────────────────────────────────────

const IMPROVE_MODEL   = 'claude-sonnet-4-6';
const MAX_TOKENS      = 8192;
const RATE_LIMIT_MS   = 30 * 60 * 1000;
const MAX_EDITS       = 15;
const MAX_RETRY_ROUNDS = 3;          // tsc-fail → feed errors → retry
const MAX_AGENT_TURNS  = 6;          // total Claude calls per improvement run
const REQUEST_TIMEOUT  = 90_000;

// Directories the agent is allowed to touch.
const ALLOWED_DIRS = [
  'packages/desktop/src/',
  'packages/engine/src/',
];

// Files always included in the initial context for operator-related goals.
const CORE_OPERATOR_FILES = [
  'packages/desktop/src/main/services/operatorTaskRunner.ts',
  'packages/desktop/src/main/services/operatorService.ts',
  'packages/desktop/src/main/services/visionAnalyzer.ts',
  'packages/desktop/src/main/services/appAwareness.ts',
  'packages/desktop/src/main/services/windowsOperator.ts',
  'packages/desktop/src/main/services/operatorPreflight.ts',
  'packages/desktop/src/main/services/operatorTargetValidator.ts',
  'packages/desktop/src/main/services/clickHelper.ts',
  'packages/desktop/src/main/services/appForegroundWatcher.ts',
  'packages/desktop/src/main/services/screenWatcher.ts',
];

// ── Module state ─────────────────────────────────────────────────────────────

let _apiKey:        string | null = null;
let _running        = false;
let _currentGoal:   string | undefined;
let _lastAutoRunAt  = 0;
let _autoEnabled    = false;
let _totalRuns      = 0;
let _totalEdits     = 0;

export function setSelfImproveKey(key: string): void { _apiKey = key; }
function getApiKey(): string | null { return _apiKey ?? process.env.ANTHROPIC_API_KEY ?? null; }

// ── Source root detection ────────────────────────────────────────────────────

let _cachedSourceRoot: string | null | undefined;

export function findSourceRoot(): string | null {
  if (_cachedSourceRoot !== undefined) return _cachedSourceRoot;
  let dir = __dirname;
  for (let i = 0; i < 10; i++) {
    if (
      fs.existsSync(path.join(dir, '.git')) &&
      fs.existsSync(path.join(dir, 'packages', 'desktop', 'src'))
    ) {
      _cachedSourceRoot = dir;
      return dir;
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  _cachedSourceRoot = null;
  return null;
}

// ── Path safety ──────────────────────────────────────────────────────────────

function isPathAllowed(relativePath: string): boolean {
  const normalized = relativePath.replace(/\\/g, '/');
  // Block path traversal
  if (normalized.includes('..')) return false;
  return ALLOWED_DIRS.some(d => normalized.startsWith(d));
}

// ── File I/O ─────────────────────────────────────────────────────────────────

function safeReadFile(sourceRoot: string, relativePath: string): string | null {
  if (!isPathAllowed(relativePath)) return null;
  try {
    return fs.readFileSync(path.join(sourceRoot, relativePath), 'utf-8');
  } catch {
    return null;
  }
}

/** Discover source files matching a glob-like pattern (simple suffix match). */
function discoverFiles(sourceRoot: string, pattern: string): string[] {
  const results: string[] = [];
  const searchDirs = ALLOWED_DIRS.map(d => path.join(sourceRoot, d));

  function walk(dir: string) {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === 'node_modules' || entry.name === 'dist' || entry.name === 'out') continue;
        walk(full);
      } else if (entry.isFile() && entry.name.endsWith('.ts') && !entry.name.endsWith('.d.ts')) {
        const rel = path.relative(sourceRoot, full).replace(/\\/g, '/');
        if (pattern === '*' || entry.name.includes(pattern) || rel.includes(pattern)) {
          results.push(rel);
        }
      }
    }
  }

  for (const d of searchDirs) walk(d);
  return results.slice(0, 30); // cap to avoid flooding context
}

// ── Keyword → file selection ─────────────────────────────────────────────────

function selectRelevantFiles(
  sourceRoot: string,
  goal: string,
): Array<{ file: string; content: string }> {
  const lower = goal.toLowerCase();

  const KEYWORD_MAP: Record<string, string[]> = {
    'planner|plan|stuck|wait|loop|step|history|prompt':
      ['operatorTaskRunner.ts'],
    'click|mouse|keyboard|key|type|input|modifier|combo':
      ['operatorService.ts', 'windowsOperator.ts', 'clickHelper.ts'],
    'screenshot|screen|vision|ocr|describe|analyze|image':
      ['visionAnalyzer.ts', 'screenWatcher.ts'],
    'app|detect|running|frontmost|awareness|registry':
      ['appAwareness.ts', 'appForegroundWatcher.ts'],
    'preflight|permission|capability|accessibility':
      ['operatorPreflight.ts', 'operatorService.ts'],
    'target|focus|window|title|validate':
      ['operatorTargetValidator.ts', 'operatorService.ts'],
    'windows|win32|powershell':
      ['windowsOperator.ts'],
  };

  const matchedFiles = new Set<string>();
  for (const [keywords, files] of Object.entries(KEYWORD_MAP)) {
    if (keywords.split('|').some(p => lower.includes(p))) {
      files.forEach(f => matchedFiles.add(f));
    }
  }

  // Default: core files
  if (matchedFiles.size === 0) {
    matchedFiles.add('operatorTaskRunner.ts');
    matchedFiles.add('operatorService.ts');
    matchedFiles.add('visionAnalyzer.ts');
  }

  const results: Array<{ file: string; content: string }> = [];
  for (const shortName of matchedFiles) {
    const fullPath = CORE_OPERATOR_FILES.find(f => f.endsWith(shortName));
    if (!fullPath) continue;
    const content = safeReadFile(sourceRoot, fullPath);
    if (content) results.push({ file: fullPath, content });
  }
  return results;
}

// ── Claude API — multi-turn ──────────────────────────────────────────────────

interface Message { role: 'user' | 'assistant'; content: string; }

async function callClaude(messages: Message[], systemPrompt: string): Promise<string | null> {
  const key = getApiKey();
  if (!key) return null;

  const body = JSON.stringify({
    model:      IMPROVE_MODEL,
    max_tokens: MAX_TOKENS,
    system:     systemPrompt,
    messages,
  });

  return new Promise<string | null>((resolve) => {
    const req = https.request(
      {
        hostname: 'api.anthropic.com',
        path:     '/v1/messages',
        method:   'POST',
        headers: {
          'Content-Type':      'application/json',
          'Content-Length':     Buffer.byteLength(body),
          'x-api-key':         key,
          'anthropic-version': '2023-06-01',
        },
      },
      (res) => {
        let data = '';
        res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
        res.on('end', () => {
          try {
            const parsed = JSON.parse(data);
            const text = parsed?.content?.[0]?.text;
            resolve(text ?? null);
          } catch {
            resolve(null);
          }
        });
      },
    );
    req.on('error', () => resolve(null));
    req.setTimeout(REQUEST_TIMEOUT, () => { req.destroy(); resolve(null); });
    req.write(body);
    req.end();
  });
}

// ── System prompt ────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are TriForge's self-improvement code agent. TriForge is an Electron desktop operator app that controls the user's computer via mouse, keyboard, and screen capture to automate tasks in apps like Unreal Engine, Photoshop, Blender, etc.

You operate in a multi-turn loop: you can request to read more files, apply edits, and fix build errors — just like a human developer.

RESPOND WITH ONLY VALID JSON — no markdown fences, no prose outside the JSON.

You MUST respond with exactly one of these action types:

## Action: read_files
Request additional source files before making changes. Use this when you need to understand imports, types, or related code.
{"action":"read_files","files":["packages/desktop/src/main/services/someFile.ts"],"reason":"why you need these files"}

## Action: discover_files
Search for files by name pattern when you don't know exact paths.
{"action":"discover_files","pattern":"someKeyword","reason":"what you're looking for"}

## Action: improve
Apply code improvements. Each edit must have an exact "search" string from the file.
For NEW files, set search to "" (empty) and file to the desired path.
{
  "action": "improve",
  "improvements": [
    {
      "file": "packages/desktop/src/main/services/example.ts",
      "search": "exact existing code to replace",
      "replace": "improved code",
      "reason": "why",
      "confidence": "high"|"medium"|"low",
      "category": "reliability"|"capability"|"performance"|"safety"|"error-handling"
    }
  ],
  "summary": "what was improved overall"
}

## Action: done
No improvements needed or all improvements have been applied.
{"action":"done","summary":"explanation"}

RULES:
1. "search" must be EXACT — character-for-character match including whitespace/newlines. Pick 3-8 unique lines.
2. "replace" must be valid TypeScript.
3. Never remove existing functionality — only enhance, harden, or extend.
4. Focus: reliability > error handling > capability > safety > performance.
5. Skip cosmetic changes (formatting, comments, renames).
6. Max ${MAX_EDITS} edits per improve action.
7. Each edit must be independently correct.
8. Prefer small, targeted fixes over rewrites.
9. Only modify files under packages/desktop/src/ or packages/engine/src/.`;

// ── Edit parsing ─────────────────────────────────────────────────────────────

interface AgentAction {
  type:          'read_files' | 'discover_files' | 'improve' | 'done';
  files?:        string[];
  pattern?:      string;
  improvements?: CodeEdit[];
  summary?:      string;
  reason?:       string;
}

function parseAgentResponse(raw: string): AgentAction | null {
  try {
    const cleaned = raw.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
    const parsed  = JSON.parse(cleaned);

    if (parsed.action === 'read_files' && Array.isArray(parsed.files)) {
      return { type: 'read_files', files: parsed.files.slice(0, 10), reason: parsed.reason };
    }

    if (parsed.action === 'discover_files' && typeof parsed.pattern === 'string') {
      return { type: 'discover_files', pattern: parsed.pattern, reason: parsed.reason };
    }

    if (parsed.action === 'done') {
      return { type: 'done', summary: parsed.summary ?? 'No improvements needed.' };
    }

    if (parsed.action === 'improve' && Array.isArray(parsed.improvements)) {
      const edits: CodeEdit[] = parsed.improvements
        .filter((e: Record<string, unknown>) =>
          typeof e.file === 'string' &&
          typeof e.replace === 'string' &&
          (typeof e.search === 'string')
        )
        .slice(0, MAX_EDITS)
        .map((e: Record<string, unknown>) => ({
          file:       e.file as string,
          search:     (e.search as string) ?? '',
          replace:    e.replace as string,
          reason:     (e.reason as string) ?? '',
          confidence: (['high', 'medium', 'low'].includes(e.confidence as string)
                        ? e.confidence : 'low') as CodeEdit['confidence'],
          category:   (e.category as CodeEdit['category']) ?? 'reliability',
        }));
      return { type: 'improve', improvements: edits, summary: parsed.summary };
    }

    return null;
  } catch {
    return null;
  }
}

// ── Backup / Rollback ────────────────────────────────────────────────────────

function backupFile(absPath: string): string {
  const bakPath = absPath + '.self-improve.bak';
  fs.copyFileSync(absPath, bakPath);
  return bakPath;
}

function rollbackFiles(backups: Map<string, string>): void {
  for (const [original, backup] of backups) {
    try { fs.copyFileSync(backup, original); fs.unlinkSync(backup); } catch { /* best effort */ }
  }
}

function cleanupBackups(backups: Map<string, string>): void {
  for (const backup of backups.values()) {
    try { fs.unlinkSync(backup); } catch { /* best effort */ }
  }
}

// ── Apply edits ──────────────────────────────────────────────────────────────

function applyEdit(sourceRoot: string, edit: CodeEdit): boolean {
  if (!isPathAllowed(edit.file)) return false;
  const absPath = path.join(sourceRoot, edit.file);

  // New file creation: search is empty
  if (edit.search === '') {
    try {
      const dir = path.dirname(absPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      if (fs.existsSync(absPath)) return false; // won't overwrite existing file with empty search
      fs.writeFileSync(absPath, edit.replace, 'utf-8');
      return true;
    } catch { return false; }
  }

  // Modify existing file
  try {
    const content = fs.readFileSync(absPath, 'utf-8');
    if (!content.includes(edit.search)) return false;
    // Ensure uniqueness
    const firstIdx  = content.indexOf(edit.search);
    const secondIdx = content.indexOf(edit.search, firstIdx + 1);
    if (secondIdx !== -1) return false;

    fs.writeFileSync(absPath, content.replace(edit.search, edit.replace), 'utf-8');
    return true;
  } catch { return false; }
}

function removeCreatedFile(absPath: string): void {
  try { if (fs.existsSync(absPath)) fs.unlinkSync(absPath); } catch { /* best effort */ }
}

// ── Build verification ───────────────────────────────────────────────────────

async function verifyBuild(sourceRoot: string): Promise<{ ok: boolean; output: string }> {
  try {
    const { stdout, stderr } = await execAsync(
      'npx tsc -p packages/desktop/tsconfig.json --noEmit 2>&1',
      { cwd: sourceRoot, timeout: 120_000 },
    );
    return { ok: true, output: (stdout + '\n' + stderr).trim() };
  } catch (err: unknown) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return { ok: false, output: ((e.stdout ?? '') + '\n' + (e.stderr ?? '') + '\n' + (e.message ?? '')).trim() };
  }
}

// ── Improvement log ──────────────────────────────────────────────────────────

function logDir(sourceRoot: string): string {
  const dir = path.join(sourceRoot, '.triforge');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function logPath(sourceRoot: string): string {
  return path.join(logDir(sourceRoot), 'self-improve-log.json');
}

function logImprovement(sourceRoot: string, entry: ImprovementLogEntry): void {
  const lp = logPath(sourceRoot);
  let existing: ImprovementLogEntry[] = [];
  try { existing = JSON.parse(fs.readFileSync(lp, 'utf-8')); } catch { /* new file */ }
  existing.push(entry);
  if (existing.length > 100) existing = existing.slice(-100);
  fs.writeFileSync(lp, JSON.stringify(existing, null, 2), 'utf-8');
}

export function getImprovementHistory(): ImprovementLogEntry[] {
  const root = findSourceRoot();
  if (!root) return [];
  try { return JSON.parse(fs.readFileSync(logPath(root), 'utf-8')); } catch { return []; }
}

// ── Main orchestration — multi-turn agent loop ───────────────────────────────

export async function runImprovement(
  goal: string,
  context?: { trigger?: 'manual' | 'auto_failure' | 'auto_scan'; errorLog?: string; failedGoal?: string },
): Promise<ImprovementResult> {
  const startTime = Date.now();
  const trigger   = context?.trigger ?? 'manual';

  const mkResult = (partial: Partial<ImprovementResult>): ImprovementResult => ({
    ok: false, goal, summary: '', editsApplied: [], editsSkipped: [], filesCreated: [],
    verified: false, rolledBack: false, retryRounds: 0, durationMs: Date.now() - startTime,
    ...partial,
  });

  if (_running) return mkResult({ error: 'busy', summary: 'Another improvement is already running.' });

  const sourceRoot = findSourceRoot();
  if (!sourceRoot) return mkResult({ error: 'no_source_root', summary: 'Could not locate TriForge source root.' });
  if (!getApiKey()) return mkResult({ error: 'no_api_key', summary: 'No API key for self-improvement.' });

  _running = true;
  _currentGoal = goal;
  _totalRuns++;

  // Accumulate all edits across retry rounds
  const allApplied:  CodeEdit[] = [];
  const allSkipped:  CodeEdit[] = [];
  const allCreated:  string[]   = [];
  const backups     = new Map<string, string>();
  let   retryRounds = 0;
  let   summary     = '';

  try {
    // ── Initial file context ────────────────────────────────────────────────
    const initialFiles = selectRelevantFiles(sourceRoot, goal);
    const fileSection  = initialFiles.map(f => `=== ${f.file} ===\n${f.content}`).join('\n\n');

    let userPrompt = `Goal: ${goal}\n\n`;
    if (context?.errorLog) {
      userPrompt += `Context — triggered by an operator failure:\n`;
      userPrompt += `Task goal: "${context.failedGoal ?? 'unknown'}"\n`;
      userPrompt += `Error: ${context.errorLog.slice(0, 1500)}\n\n`;
    }
    userPrompt += `Source files (initial context):\n\n${fileSection}\n\n`;
    userPrompt += `You can request more files with read_files or discover_files before editing. `;
    userPrompt += `When ready, use "improve" to apply changes, or "done" if nothing needs fixing.`;

    // ── Multi-turn conversation ──────────────────────────────────────────────
    const conversation: Message[] = [{ role: 'user', content: userPrompt }];

    for (let turn = 0; turn < MAX_AGENT_TURNS; turn++) {
      const response = await callClaude(conversation, SYSTEM_PROMPT);
      if (!response) {
        return mkResult({ error: 'api_failed', summary: 'Claude API call failed.' });
      }
      conversation.push({ role: 'assistant', content: response });

      const action = parseAgentResponse(response);
      if (!action) {
        // Unrecognisable response — ask Claude to fix it
        conversation.push({ role: 'user', content: 'Your response was not valid JSON. Please respond with a valid action JSON object.' });
        continue;
      }

      // ── read_files ──────────────────────────────────────────────────────
      if (action.type === 'read_files' && action.files) {
        const fileContents: string[] = [];
        for (const f of action.files) {
          const content = safeReadFile(sourceRoot, f);
          if (content) {
            fileContents.push(`=== ${f} ===\n${content}`);
          } else {
            fileContents.push(`=== ${f} === FILE NOT FOUND or not readable.`);
          }
        }
        conversation.push({ role: 'user', content: `Requested files:\n\n${fileContents.join('\n\n')}` });
        continue;
      }

      // ── discover_files ──────────────────────────────────────────────────
      if (action.type === 'discover_files' && action.pattern) {
        const found = discoverFiles(sourceRoot, action.pattern);
        const msg = found.length > 0
          ? `Found ${found.length} files matching "${action.pattern}":\n${found.join('\n')}\n\nUse read_files to read any of these.`
          : `No files found matching "${action.pattern}".`;
        conversation.push({ role: 'user', content: msg });
        continue;
      }

      // ── done ────────────────────────────────────────────────────────────
      if (action.type === 'done') {
        summary = action.summary ?? 'No improvements needed.';
        break;
      }

      // ── improve ─────────────────────────────────────────────────────────
      if (action.type === 'improve' && action.improvements) {
        const edits = action.improvements.filter(e => e.search !== e.replace);

        // Confidence filter
        const autoApply = trigger === 'manual'
          ? edits.filter(e => e.confidence !== 'low')
          : edits.filter(e => e.confidence === 'high');
        const skipped = edits.filter(e => !autoApply.includes(e));
        allSkipped.push(...skipped);

        if (autoApply.length === 0) {
          summary = `${edits.length} improvements found but none met confidence threshold.`;
          conversation.push({ role: 'user', content: summary + ' You can try again with higher-confidence edits, or respond with done.' });
          continue;
        }

        // Backup + apply
        for (const edit of autoApply) {
          const absPath = path.join(sourceRoot, edit.file);
          const isNewFile = edit.search === '';

          // Backup existing files before first modification
          if (!isNewFile && !backups.has(absPath) && fs.existsSync(absPath)) {
            backups.set(absPath, backupFile(absPath));
          }

          if (applyEdit(sourceRoot, edit)) {
            allApplied.push(edit);
            if (isNewFile) allCreated.push(edit.file);
          } else {
            allSkipped.push(edit);
          }
        }

        if (allApplied.length === 0 && allCreated.length === 0) {
          conversation.push({
            role: 'user',
            content: 'All edits failed to apply — the "search" strings did not match the source files. ' +
                     'Double-check that your search strings are exact copies from the files. Try again or respond with done.',
          });
          continue;
        }

        // Verify build
        const buildResult = await verifyBuild(sourceRoot);

        if (buildResult.ok) {
          summary = action.summary ?? `${allApplied.length} improvement(s) applied.`;
          // Tell Claude it worked, give it a chance to make more improvements
          conversation.push({
            role: 'user',
            content: `Build verification PASSED. ${allApplied.length} edit(s) applied successfully.\n` +
                     `If you have more improvements, send another "improve" action. Otherwise, respond with "done".`,
          });
          continue;
        }

        // Build failed — feed errors back to Claude for correction
        retryRounds++;
        if (retryRounds > MAX_RETRY_ROUNDS) {
          // Max retries exceeded — rollback everything
          rollbackFiles(backups);
          for (const f of allCreated) removeCreatedFile(path.join(sourceRoot, f));
          const result = mkResult({
            ok: false,
            summary: `Exceeded ${MAX_RETRY_ROUNDS} retry rounds — all changes rolled back.`,
            editsApplied: allApplied, editsSkipped: allSkipped, filesCreated: allCreated,
            verified: false, rolledBack: true, retryRounds,
            buildOutput: buildResult.output.slice(0, 2000), error: 'max_retries_exceeded',
          });
          logImprovement(sourceRoot, { timestamp: new Date().toISOString(), goal, trigger, result });
          return result;
        }

        // Feed tsc errors back to Claude
        conversation.push({
          role: 'user',
          content: `BUILD FAILED after applying your edits. TypeScript errors:\n\n` +
                   `${buildResult.output.slice(0, 3000)}\n\n` +
                   `Please fix these errors. Send a new "improve" action with corrected edits. ` +
                   `The broken edits are still in the files — you can search for your replacement text to fix it, ` +
                   `or if the fix is complex, I can rollback and you can start fresh.`,
        });
        continue;
      }
    }

    // ── Final verification ────────────────────────────────────────────────────
    if (allApplied.length === 0 && allCreated.length === 0) {
      cleanupBackups(backups);
      const result = mkResult({
        ok: true, summary: summary || 'No improvements applied.', verified: true,
      });
      logImprovement(sourceRoot, { timestamp: new Date().toISOString(), goal, trigger, result });
      return result;
    }

    // One final tsc check to be absolutely sure
    const finalBuild = await verifyBuild(sourceRoot);
    if (!finalBuild.ok) {
      rollbackFiles(backups);
      for (const f of allCreated) removeCreatedFile(path.join(sourceRoot, f));
      const result = mkResult({
        ok: false, summary: 'Final build verification failed — all changes rolled back.',
        editsApplied: allApplied, editsSkipped: allSkipped, filesCreated: allCreated,
        verified: false, rolledBack: true, retryRounds,
        buildOutput: finalBuild.output.slice(0, 2000), error: 'final_build_failed',
      });
      logImprovement(sourceRoot, { timestamp: new Date().toISOString(), goal, trigger, result });
      return result;
    }

    // Success
    cleanupBackups(backups);
    _totalEdits += allApplied.length;

    const result = mkResult({
      ok: true,
      summary: `${summary} — ${allApplied.length} edit(s) applied, ${allCreated.length} file(s) created, verified clean.`,
      editsApplied: allApplied, editsSkipped: allSkipped, filesCreated: allCreated,
      verified: true, rolledBack: false, retryRounds,
      buildOutput: finalBuild.output.slice(0, 500),
    });
    logImprovement(sourceRoot, { timestamp: new Date().toISOString(), goal, trigger, result });
    return result;

  } finally {
    _running = false;
    _currentGoal = undefined;
  }
}

// ── Auto-trigger after operator failures ─────────────────────────────────────

const NON_CODE_FAILURES = [
  'permission', 'not granted', 'api key', 'apikey', 'api_key',
  'authentication dialog', 'password prompt', 'screen recording',
  'accessibility',
];

export async function onOperatorTaskFailure(info: {
  goal: string; outcome: string; error?: string; summary: string; stepsExecuted: number;
}): Promise<ImprovementResult | null> {
  if (!_autoEnabled) return null;
  if (Date.now() - _lastAutoRunAt < RATE_LIMIT_MS) return null;

  const lowerError = (info.error ?? info.summary).toLowerCase();
  if (NON_CODE_FAILURES.some(kw => lowerError.includes(kw))) return null;
  if (info.outcome !== 'error' && info.outcome !== 'blocked') return null;
  if (info.stepsExecuted < 2) return null;

  _lastAutoRunAt = Date.now();

  const goal =
    info.outcome === 'blocked' && lowerError.includes('stuck')
      ? `The operator planner got stuck in a wait loop while trying to: "${info.goal}". ` +
        `Improve the stuck-detection logic or planner prompt to handle this better.`
      : `The operator failed after ${info.stepsExecuted} steps trying to: "${info.goal}". ` +
        `Error: "${info.error ?? info.summary}". Fix the root cause.`;

  return runImprovement(goal, {
    trigger: 'auto_failure', errorLog: info.error ?? info.summary, failedGoal: info.goal,
  });
}

// ── Proactive code scan ──────────────────────────────────────────────────────

export async function scanForImprovements(): Promise<ImprovementResult> {
  return runImprovement(
    'Proactive code health scan. Look for:\n' +
    '1. Missing error handling — unhandled promise rejections, missing try/catch\n' +
    '2. Reliability gaps — missing retries, timeouts on flaky operations\n' +
    '3. Edge cases — null/undefined, empty arrays, empty strings\n' +
    '4. Hardcoded limits that should be higher or configurable\n' +
    '5. Race conditions or state issues\n' +
    '6. Resolvable TODO/FIXME comments\n' +
    'Prioritize changes that make the operator more reliable.',
    { trigger: 'auto_scan' },
  );
}

// ── Status & config ──────────────────────────────────────────────────────────

export function getStatus(): SelfImproveStatus {
  return {
    running: _running, currentGoal: _currentGoal, autoEnabled: _autoEnabled,
    lastRunAt: _lastAutoRunAt > 0 ? new Date(_lastAutoRunAt).toISOString() : undefined,
    totalRuns: _totalRuns, totalEdits: _totalEdits,
  };
}

export function setAutoImprove(enabled: boolean): void { _autoEnabled = enabled; }
export function isAutoImproveEnabled(): boolean { return _autoEnabled; }
