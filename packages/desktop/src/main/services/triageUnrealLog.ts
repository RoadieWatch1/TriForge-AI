// ── triageUnrealLog.ts — Unreal Log Failure Pattern Classifier ────────────────
//
// Phase 3, Step 4: Deterministic pattern-based Unreal log triage.
//
// Reads a bounded portion of an Unreal log file and applies a library of
// known failure patterns. Returns structured findings with evidence lines
// and remediation hints for each classified failure.
//
// Design principles:
//   - Bounded reads: last 500 lines first, expand to 2000 if needed
//   - One finding per code: if a pattern matches multiple times, emit the
//     best match (most evidence, highest confidence) once
//   - Evidence: at most 5 surrounding lines per finding
//   - No deep parsing: regex-first, pattern confidence is explicit
//   - Fallback: if nothing matches, emit unknown_failure with the last few lines
//
// TRULY IMPLEMENTED:
//   - 8 classified failure codes with high/medium/low confidence patterns
//   - Evidence extraction (±2 lines around each match)
//   - Deduplication (best match per code)
//   - Summary generation
//   - unknown_failure fallback with raw log tail
//
// NOT YET:
//   - Semantic understanding of Unreal error output
//   - Automatic fix generation
//   - Cross-referencing source files
//   - Windows-specific patterns

import { exec }  from 'child_process';
import path      from 'path';
import fs        from 'fs';
import type { UnrealTriageResult, UnrealTriageIssueCode, UnrealTriageFinding } from '@triforge/engine';

const IS_MACOS = process.platform === 'darwin';

// ── Shell helper ──────────────────────────────────────────────────────────────

function safeExec(cmd: string, timeoutMs = 8000): Promise<string> {
  return new Promise(resolve => {
    exec(cmd, { timeout: timeoutMs }, (err, stdout) => {
      resolve(err ? '' : (stdout ?? '').trim());
    });
  });
}

// ── Pattern library ───────────────────────────────────────────────────────────

/**
 * A single failure pattern entry.
 * Patterns are applied in priority order. The first strong match wins.
 */
interface TriagePattern {
  code:       UnrealTriageIssueCode;
  confidence: 'high' | 'medium' | 'low';
  /** Patterns that must ALL match at least one line in the log chunk. */
  anyOf:      RegExp[];
  /** Optional: refine confidence if this secondary pattern also matches. */
  boostIf?:   RegExp;
  remediationHints: string[];
}

/**
 * Ordered pattern library — higher priority patterns first.
 * Within a code, the first `anyOf` match found will be the one with evidence.
 */
const TRIAGE_PATTERNS: TriagePattern[] = [

  // ── Toolchain / SDK missing ────────────────────────────────────────────────
  {
    code:       'toolchain_missing',
    confidence: 'high',
    anyOf: [
      /xcrun:\s+error:/i,
      /xcode-select:\s+error:/i,
      /no\s+toolchain\s+found/i,
      /could\s+not\s+find\s+toolchain/i,
      /command\s+line\s+tools.*not\s+(?:installed|found)/i,
    ],
    remediationHints: [
      'Run `xcode-select --install` in Terminal to install Xcode Command Line Tools.',
      'Open Xcode, go to Preferences → Locations and set the Command Line Tools version.',
      'If Xcode is installed, try running `sudo xcode-select -r` to reset the path.',
    ],
  },

  // ── Missing plugin ─────────────────────────────────────────────────────────
  {
    code:       'missing_plugin',
    confidence: 'high',
    anyOf: [
      /plugin\s+['"]?\w+['"]?\s+(?:not\s+found|could\s+not\s+be\s+found)/i,
      /failed\s+to\s+find\s+plugin/i,
      /enabledplugin.*not\s+found/i,
      /error:\s+plugin\s+'[^']+'\s+not\s+found/i,
    ],
    remediationHints: [
      'Verify the plugin is listed in the project .uproject file under "Plugins".',
      'Check that the plugin is installed in either the Engine/Plugins or Project/Plugins directory.',
      'If it\'s a marketplace plugin, re-install it through the Epic Games Launcher.',
      'Try running "Generate Project Files" from the Unreal Editor to refresh plugin references.',
    ],
  },

  // ── Missing module ─────────────────────────────────────────────────────────
  {
    code:       'missing_module',
    confidence: 'high',
    anyOf: [
      /module\s+'[^']+'\s+(?:not\s+found|could\s+not\s+be\s+found)/i,
      /failed\s+to\s+load\s+module/i,
      /modulemanager.*error.*\bmodule\b/i,
      /error:\s+module.*not\s+(?:found|loaded)/i,
    ],
    remediationHints: [
      'Verify the module is included in the project\'s .Build.cs dependencies.',
      'Check that the module exists in Source/ and its Build.cs is correct.',
      'Try deleting Binaries/, Intermediate/, and DerivedDataCache/, then rebuilding.',
      'Run "Generate Project Files" from the Unreal Editor menu.',
    ],
  },

  // ── C++ compile error ─────────────────────────────────────────────────────
  {
    code:       'cpp_compile_error',
    confidence: 'high',
    anyOf: [
      /\.[ch]pp?:\d+:\d*:\s+(?:fatal\s+)?error:/i,
      /\berror\s+C\d{4}:/i,    // MSVC style (rare on Mac, but defensive)
      /error:\s+use\s+of\s+undeclared\s+identifier/i,
      /error:\s+no\s+matching\s+function/i,
      /error:\s+cannot\s+convert/i,
      /fatal\s+error:\s+.*\.h.*file\s+not\s+found/i,
    ],
    boostIf: /\.[ch]pp?:\d+:\d*:/,
    remediationHints: [
      'Open the referenced source file and fix the compiler error at the indicated line.',
      'Check for missing #include headers — the file path is usually shown in the error line.',
      'If a class or function is undeclared, verify the relevant module is in the Build.cs PublicDependencyModuleNames.',
      'Run a clean rebuild: delete Binaries/ and Intermediate/, then rebuild in the editor.',
    ],
  },

  // ── Cook failure ──────────────────────────────────────────────────────────
  {
    code:       'cook_failure',
    confidence: 'high',
    anyOf: [
      /logcook:\s+error:/i,
      /cook(?:commandlet)?\s+failed/i,
      /error.*cooking\s+content/i,
      /unrealEditor-cmd.*exited\s+with\s+code\s+[^0]/i,
    ],
    remediationHints: [
      'Open the Unreal Editor and attempt a manual cook (Platforms → Cook Content for Current Platform).',
      'Check for missing or broken asset references in the Content Browser — look for assets marked with a warning icon.',
      'Review the full log at the sourceLogPath for specific asset paths that failed to cook.',
      'Try resaving all assets before cooking: in the editor, go to File → Save All.',
    ],
  },

  // ── UBT failure ───────────────────────────────────────────────────────────
  {
    code:       'ubt_failure',
    confidence: 'high',
    anyOf: [
      /unrealbuildtool\s+exception/i,
      /error:\s+ubt\s+terminated/i,
      /error:\s+the\s+following\s+modules\s+are\s+failing\s+to\s+build/i,
      /failed\s+to\s+produce\s+item.*\.dylib/i,
      /error:\s+building\s+.+\s+failed/i,
    ],
    remediationHints: [
      'Delete Binaries/ and Intermediate/ directories, then retry the build.',
      'Check if Xcode and its command line tools are properly installed.',
      'If this is a module dependency issue, verify all referenced modules exist in Build.cs.',
      'Try "Generate Project Files" from the Unreal Editor, then rebuild.',
    ],
  },

  // ── UAT / AutomationTool failure ──────────────────────────────────────────
  {
    code:       'uat_failure',
    confidence: 'high',
    anyOf: [
      /automationtool\s+exiting\s+with\s+exitcode=[1-9]/i,
      /error:\s+automationtool/i,
      /runuat\s+error:/i,
      /automationtool\s+terminated\s+with\s+an\s+exception/i,
    ],
    boostIf: /exitcode=[1-9]/,
    remediationHints: [
      'Review the full UAT log for the specific failure stage (Build, Cook, Stage, Pak, Archive).',
      'Ensure the project builds successfully in the editor before running UAT packaging.',
      'Check that all Platform SDKs are installed for your target platform.',
      'Try running a manual "Package Project" from the editor (Platforms menu) to see a cleaner error.',
    ],
  },

  // ── Packaging failure ─────────────────────────────────────────────────────
  {
    code:       'packaging_failure',
    confidence: 'medium',
    anyOf: [
      /packagingresults:\s+error:/i,
      /packaging\s+failed/i,
      /buildcookrun.*failed/i,
      /error.*package.*project/i,
    ],
    remediationHints: [
      'Package the project manually from the Unreal Editor (Platforms → Package Project) for a cleaner error message.',
      'Ensure all content has been saved and there are no missing or broken assets.',
      'Verify the packaging settings in Project Settings → Platforms match your target.',
    ],
  },

  // ── Missing asset reference ────────────────────────────────────────────────
  {
    code:       'missing_asset_reference',
    confidence: 'medium',
    anyOf: [
      /missing\s+asset:/i,
      /failed\s+to\s+load\s+asset/i,
      /asset\s+reference\s+is\s+broken/i,
      /unresolved\s+(?:soft\s+)?(?:object|class)\s+path/i,
      /logassetregistry.*warning.*missing/i,
    ],
    remediationHints: [
      'Open the Unreal Editor and use "Fix Up Redirectors" (right-click in Content Browser) to resolve broken references.',
      'Check for deleted or renamed assets — find them in source control history if available.',
      'Use the Reference Viewer (right-click on an asset) to trace broken dependency chains.',
    ],
  },
];

// ── Evidence extraction ───────────────────────────────────────────────────────

/**
 * Given a matched line index and the full line array, extract ±2 lines of
 * context. Deduplicates and caps at 5 lines.
 */
function extractEvidence(lines: string[], matchIdx: number): string[] {
  const radius  = 2;
  const start   = Math.max(0, matchIdx - radius);
  const end     = Math.min(lines.length - 1, matchIdx + radius);
  const result: string[] = [];

  for (let i = start; i <= end; i++) {
    const line = lines[i].trim();
    if (line.length > 0 && !result.includes(line)) {
      result.push(line.slice(0, 200)); // cap line length
    }
  }
  return result;
}

// ── Core classifier ───────────────────────────────────────────────────────────

interface ClassifyResult {
  findings: UnrealTriageFinding[];
}

function classifyLines(lines: string[]): ClassifyResult {
  const findings: UnrealTriageFinding[] = [];
  const seenCodes = new Set<UnrealTriageIssueCode>();

  for (const pattern of TRIAGE_PATTERNS) {
    if (seenCodes.has(pattern.code)) continue;

    // Try each anyOf pattern and collect the best match
    let bestMatchIdx = -1;
    let bestPattern: RegExp | null = null;

    for (const re of pattern.anyOf) {
      for (let i = 0; i < lines.length; i++) {
        if (re.test(lines[i])) {
          // Prefer matches closer to the end of the log (most recent errors)
          if (bestMatchIdx === -1 || i > bestMatchIdx) {
            bestMatchIdx = i;
            bestPattern  = re;
          }
          break; // found a match for this anyOf entry
        }
      }
      if (bestMatchIdx !== -1) break; // first matching anyOf is enough
    }

    if (bestMatchIdx === -1 || !bestPattern) continue; // no match for this pattern

    // Refine confidence
    let confidence = pattern.confidence;
    if (pattern.boostIf && lines.some(l => pattern.boostIf!.test(l))) {
      confidence = 'high';
    }

    const evidence = extractEvidence(lines, bestMatchIdx);

    findings.push({
      code:      pattern.code,
      confidence,
      message:   buildFindingMessage(pattern.code, evidence),
      evidence,
      remediationHints: pattern.remediationHints,
    });

    seenCodes.add(pattern.code);
  }

  return { findings };
}

function buildFindingMessage(code: UnrealTriageIssueCode, evidence: string[]): string {
  const firstLine = evidence[0] ?? '';

  switch (code) {
    case 'cpp_compile_error':
      return `C++ compilation error detected.${firstLine ? ` First match: "${firstLine.slice(0, 100)}"` : ''}`;
    case 'missing_plugin':
      return `A required plugin could not be found or loaded.${firstLine ? ` Detail: "${firstLine.slice(0, 100)}"` : ''}`;
    case 'missing_module':
      return `A required module could not be found or loaded.${firstLine ? ` Detail: "${firstLine.slice(0, 100)}"` : ''}`;
    case 'cook_failure':
      return 'Unreal cook operation failed. Content could not be cooked for the target platform.';
    case 'ubt_failure':
      return 'UnrealBuildTool failure detected. The build tool could not complete compilation.';
    case 'uat_failure':
      return 'AutomationTool (UAT) exited with a non-zero error code. Packaging pipeline failed.';
    case 'packaging_failure':
      return 'Project packaging failed. The package operation did not complete successfully.';
    case 'missing_asset_reference':
      return 'Missing or broken asset references were detected. Some content could not be resolved.';
    case 'toolchain_missing':
      return 'Build toolchain (Xcode / clang) is missing or misconfigured.';
    default:
      return `Failure detected (code: ${code}).`;
  }
}

// ── Summary generator ─────────────────────────────────────────────────────────

function buildSummary(
  outcome: UnrealTriageResult['outcome'],
  findings: UnrealTriageFinding[],
  sourceKind: UnrealTriageResult['sourceKind'],
  sourceLogPath: string | undefined,
): string {
  if (outcome === 'blocked') {
    return 'No usable log source could be located. Provide opts.triageLogPath or ensure a build has run recently.';
  }

  if (outcome === 'unclassified') {
    return `Log was read (${sourceKind ?? 'unknown source'}) but no recognizable failure pattern was found. ` +
           (sourceLogPath ? `Review the full log at: ${sourceLogPath}` : 'No log path available for manual inspection.');
  }

  // classified
  const highCount = findings.filter(f => f.confidence === 'high').length;
  const codes     = findings.map(f => f.code).join(', ');

  if (findings.length === 1) {
    return `One failure classified: ${findings[0]!.code} (${findings[0]!.confidence} confidence). ${findings[0]!.message}`;
  }

  return `${findings.length} failures classified${highCount > 0 ? ` (${highCount} high confidence)` : ''}: ${codes}.`;
}

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Analyze a Unreal log file and return structured triage findings.
 *
 * Reads in two passes:
 *   1. Last 500 lines — fast path for obvious recent errors
 *   2. Last 2000 lines — expanded pass if the first yields nothing
 *
 * @param logPath     Absolute path to the log file to analyze
 * @param sourceKind  How this log was discovered (for result metadata)
 */
export async function triageUnrealLog(
  logPath: string,
  sourceKind: NonNullable<UnrealTriageResult['sourceKind']>,
): Promise<UnrealTriageResult> {

  // Verify the file exists
  try {
    if (!fs.existsSync(logPath)) {
      return {
        outcome:      'blocked',
        sourceLogPath: logPath,
        sourceKind,
        findings:     [{
          code:      'log_not_found',
          confidence: 'high',
          message:   `Log file not found at path: ${logPath}`,
          remediationHints: [
            'Verify the log path — the file may have been moved or the build may not have started.',
            'Check ~/Library/Logs/Unreal Engine/ for recent logs.',
            'Run pack.unreal-build first to produce a fresh log.',
          ],
        }],
        summary: `Log file not found at: ${logPath}`,
      };
    }
  } catch {
    return {
      outcome:  'blocked',
      sourceLogPath: logPath,
      sourceKind,
      findings: [{
        code:      'log_not_found',
        confidence: 'high',
        message:   'Could not access the log file path.',
        remediationHints: ['Check file system permissions for the log path.'],
      }],
      summary: 'Could not access the log file.',
    };
  }

  // ── Pass 1: last 500 lines ──────────────────────────────────────────────────
  const rawSmall = await safeExec(`tail -n 500 "${logPath}"`, 4000);
  if (!rawSmall) {
    return {
      outcome:  'unclassified',
      sourceLogPath: logPath,
      sourceKind,
      findings: [{
        code:      'unknown_failure',
        confidence: 'low',
        message:   'Log file is empty or could not be read.',
        remediationHints: ['Verify the log file is not empty. The build may not have written any output.'],
      }],
      summary: 'Log file is empty or unreadable.',
    };
  }

  const linesSmall  = rawSmall.split('\n');
  const resultSmall = classifyLines(linesSmall);

  if (resultSmall.findings.length > 0) {
    const summary = buildSummary('classified', resultSmall.findings, sourceKind, logPath);
    return {
      outcome:      'classified',
      sourceLogPath: logPath,
      sourceKind,
      findings:     resultSmall.findings,
      summary,
    };
  }

  // ── Pass 2: last 2000 lines ─────────────────────────────────────────────────
  const rawLarge = await safeExec(`tail -n 2000 "${logPath}"`, 8000);
  const linesLarge  = (rawLarge || rawSmall).split('\n');
  const resultLarge = classifyLines(linesLarge);

  if (resultLarge.findings.length > 0) {
    const summary = buildSummary('classified', resultLarge.findings, sourceKind, logPath);
    return {
      outcome:      'classified',
      sourceLogPath: logPath,
      sourceKind,
      findings:     resultLarge.findings,
      summary,
    };
  }

  // ── Unclassified: include log tail as evidence ──────────────────────────────
  const tailLines = linesSmall.slice(-8).map(l => l.trim()).filter(Boolean).slice(0, 5);

  return {
    outcome:  'unclassified',
    sourceLogPath: logPath,
    sourceKind,
    findings: [{
      code:       'unknown_failure',
      confidence: 'low',
      message:
        'No recognizable Unreal failure pattern was found in the log. ' +
        'The build may have failed for an unusual reason, or the log may be truncated.',
      evidence:   tailLines.length > 0 ? tailLines : undefined,
      remediationHints: [
        `Review the full log manually at: ${logPath}`,
        'Look for lines containing "Error:" or "Exception:" near the end of the log.',
        'Try running the build again from the Unreal Editor for a more verbose error output.',
      ],
    }],
    summary: buildSummary('unclassified', [], sourceKind, logPath),
  };
}

// ── Log source discovery ──────────────────────────────────────────────────────

/**
 * Attempt to locate a usable Unreal log file, trying sources in priority order:
 *   1. explicit path (opts.triageLogPath)
 *   2. recentLogPath from Unreal awareness snapshot
 *   3. project Saved/Logs/<ProjectName>.log derived from project path
 *
 * Returns null for all three if no source exists.
 */
export function resolveTriageLogSource(params: {
  explicitLogPath?: string;
  awarenessLogPath?: string;
  projectPath?: string;
  projectName?: string;
}): { logPath: string; sourceKind: NonNullable<UnrealTriageResult['sourceKind']> } | null {

  // 1. Explicit override
  if (params.explicitLogPath) {
    try {
      if (fs.existsSync(params.explicitLogPath)) {
        // Distinguish TriForge-generated build logs from native logs
        const isBuildArtifact = path.basename(params.explicitLogPath).startsWith('tf-unreal-');
        return {
          logPath: params.explicitLogPath,
          sourceKind: isBuildArtifact ? 'build_artifact' : 'project_log',
        };
      }
    } catch { /* fall through */ }
  }

  // 2. Awareness snapshot log (~/Library/Logs/Unreal Engine/)
  if (params.awarenessLogPath) {
    try {
      if (fs.existsSync(params.awarenessLogPath)) {
        return { logPath: params.awarenessLogPath, sourceKind: 'awareness_log' };
      }
    } catch { /* fall through */ }
  }

  // 3. Project Saved/Logs/<ProjectName>.log
  if (params.projectPath && params.projectName) {
    const projectLog = path.join(
      path.dirname(params.projectPath), 'Saved', 'Logs', `${params.projectName}.log`,
    );
    try {
      if (fs.existsSync(projectLog)) {
        return { logPath: projectLog, sourceKind: 'project_log' };
      }
    } catch { /* fall through */ }
  }

  return null;
}
