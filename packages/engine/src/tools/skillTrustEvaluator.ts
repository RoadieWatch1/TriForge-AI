// ── Skill Trust Evaluator — Phase 2: Skill Trust Layer ───────────────────────
//
// Analyzes raw SKILL.md text and produces a SkillAnalysisResult.
//
// Design: zero external dependencies, works on raw string input only.
// No filesystem access — the caller reads the file; we only inspect text.
//
// Detection strategy:
//   1. Parse YAML frontmatter (--- block at top of file)
//   2. Build declared capabilities from frontmatter fields
//   3. Scan body text for dangerous patterns with regex
//   4. Compute risk level and block/approval decisions
//   5. Detect mismatches between declared and actual capabilities
//
// Block criteria (critical — outright rejected):
//   - Raw shell execution without an explicitly allowed tool wrapper
//   - Silent network exfiltration (curl, wget, embedded fetch to external URLs)
//   - Credential/secret scraping patterns
//   - Attempts to self-modify trust or policy settings
//   - Claims requiresApproval: false while body contains write/exec patterns
//
// High risk (requires council review):
//   - Undeclared network access
//   - File mutation without declared files permission
//   - Declared but unusually broad permissions
//
// Medium risk (requires human approval):
//   - Network access that is declared
//   - File writes that are declared
//   - Command execution that is declared

import type {
  SkillAnalysisResult,
  SkillFrontmatter,
  DetectedPattern,
  SkillRiskLevel,
} from './skillRiskTypes';

// ── Pattern definitions ───────────────────────────────────────────────────────

interface RawPattern {
  regex: RegExp;
  severity: DetectedPattern['severity'];
  capability: string;
  description: string;
  block: boolean; // if true, triggers an outright block
}

const DANGEROUS_PATTERNS: RawPattern[] = [
  // Shell execution — critical
  {
    regex: /\bexec\s*\(/,
    severity: 'critical',
    capability: 'shell_exec',
    description: 'exec() call detected — raw shell execution',
    block: true,
  },
  {
    regex: /\bexecSync\s*\(/,
    severity: 'critical',
    capability: 'shell_exec',
    description: 'execSync() detected — synchronous shell execution',
    block: true,
  },
  {
    regex: /\bspawn\s*\(/,
    severity: 'critical',
    capability: 'shell_exec',
    description: 'spawn() call detected — child process creation',
    block: true,
  },
  {
    regex: /\bsubprocess\b/,
    severity: 'critical',
    capability: 'shell_exec',
    description: 'subprocess module usage detected',
    block: true,
  },
  {
    regex: /\bos\.system\s*\(/,
    severity: 'critical',
    capability: 'shell_exec',
    description: 'os.system() call detected — shell execution',
    block: true,
  },
  {
    regex: /\b(?:bash|sh|zsh)\s+-c\b/,
    severity: 'critical',
    capability: 'shell_exec',
    description: 'Inline shell invocation (sh -c / bash -c) detected',
    block: true,
  },
  {
    regex: /\bcmd(?:\.exe)?\s+\/[cCkK]\b/,
    severity: 'critical',
    capability: 'shell_exec',
    description: 'cmd.exe /c invocation detected — Windows shell execution',
    block: true,
  },
  {
    regex: /\beval\s*\(/,
    severity: 'critical',
    capability: 'shell_exec',
    description: 'eval() detected — arbitrary code execution risk',
    block: true,
  },

  // Silent network exfiltration — critical
  {
    regex: /\bcurl\s+/,
    severity: 'critical',
    capability: 'network_exfil',
    description: 'curl command detected — potential silent network exfiltration',
    block: true,
  },
  {
    regex: /\bwget\s+/,
    severity: 'critical',
    capability: 'network_exfil',
    description: 'wget command detected — potential silent data upload/download',
    block: true,
  },
  {
    regex: /fetch\s*\(\s*['"`]https?:\/\//,
    severity: 'critical',
    capability: 'network_exfil',
    description: 'Hardcoded external fetch() URL detected — undeclared network call',
    block: true,
  },
  {
    regex: /(?:axios|got|needle|superagent)\s*\.\s*(?:get|post|put|delete)\s*\(\s*['"`]https?:\/\//,
    severity: 'critical',
    capability: 'network_exfil',
    description: 'HTTP client call to hardcoded external URL detected',
    block: true,
  },
  {
    regex: /requests\s*\.\s*(?:get|post|put|delete)\s*\(/,
    severity: 'critical',
    capability: 'network_exfil',
    description: 'Python requests library HTTP call detected',
    block: true,
  },

  // Credential / secret scraping — critical
  {
    regex: /process\.env\s*\[\s*['"`][A-Z_]*(?:KEY|SECRET|TOKEN|PASS|PASSWORD|API)[A-Z_]*['"`]/i,
    severity: 'critical',
    capability: 'credential_access',
    description: 'Reads sensitive environment variable (key/secret/token/password)',
    block: true,
  },
  {
    regex: /os\.environ\s*\[/,
    severity: 'critical',
    capability: 'credential_access',
    description: 'Python os.environ access detected — potential secret scraping',
    block: true,
  },
  {
    regex: /\~\/\.ssh\b/,
    severity: 'critical',
    capability: 'credential_access',
    description: 'Access to ~/.ssh directory detected — SSH key scraping risk',
    block: true,
  },
  {
    regex: /\~\/\.aws\b/,
    severity: 'critical',
    capability: 'credential_access',
    description: 'Access to ~/.aws directory detected — AWS credential scraping risk',
    block: true,
  },
  {
    regex: /Keychain|SecKeychainFind/,
    severity: 'critical',
    capability: 'credential_access',
    description: 'macOS Keychain API access detected',
    block: true,
  },

  // Self-modification of trust/policy — critical
  {
    regex: /requiresApproval\s*[:=]\s*false/i,
    severity: 'critical',
    capability: 'policy_bypass',
    description: 'Attempts to set requiresApproval: false in body — policy bypass',
    block: true,
  },
  {
    regex: /trustLevel\s*[:=]\s*['"`]?full['"`]?/i,
    severity: 'critical',
    capability: 'policy_bypass',
    description: 'Attempts to elevate trust to "full" — policy self-modification',
    block: true,
  },
  {
    regex: /skills?[\\/].*\bSKILL\.md\b/i,
    severity: 'critical',
    capability: 'self_modify',
    description: 'References own SKILL.md path — possible self-modification attempt',
    block: true,
  },

  // Undeclared network access — high (not block, but council review)
  {
    regex: /https?:\/\/[^\s'"]{6,}/,
    severity: 'high',
    capability: 'network_access',
    description: 'Hardcoded remote URL found in skill body',
    block: false,
  },
  {
    regex: /new\s+(?:XMLHttpRequest|WebSocket)\s*\(/,
    severity: 'high',
    capability: 'network_access',
    description: 'XMLHttpRequest or WebSocket constructor detected',
    block: false,
  },

  // File mutations — high if undeclared
  {
    regex: /fs\.(?:writeFile|writeFileSync|appendFile|appendFileSync|unlink|unlinkSync|rmdir|rmdirSync|rm\s*\()/,
    severity: 'high',
    capability: 'file_write',
    description: 'Node.js file write/delete operation detected',
    block: false,
  },
  {
    regex: /\bopen\s*\([^)]+,\s*['"`]w[+ba]?['"`]/,
    severity: 'high',
    capability: 'file_write',
    description: 'Python file open in write mode detected',
    block: false,
  },

  // Command execution (declared but high-risk) — medium
  {
    regex: /\bchild_process\b/,
    severity: 'medium',
    capability: 'shell_exec',
    description: 'child_process module import detected',
    block: false,
  },
];

// ── Frontmatter parser ────────────────────────────────────────────────────────
// Handles the standard YAML fence: ---\n...\n---
// Simple line-by-line parse — no external yaml library required.

function parseFrontmatter(raw: string): { fm: SkillFrontmatter; body: string } {
  const fm: SkillFrontmatter = {};
  const lines = raw.split('\n');

  if (lines[0]?.trim() !== '---') {
    return { fm, body: raw };
  }

  let endLine = -1;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i].trim() === '---') {
      endLine = i;
      break;
    }
  }

  if (endLine === -1) {
    return { fm, body: raw };
  }

  const fmLines = lines.slice(1, endLine);
  for (const line of fmLines) {
    const colonIdx = line.indexOf(':');
    if (colonIdx === -1) continue;
    const key = line.slice(0, colonIdx).trim();
    const rawVal = line.slice(colonIdx + 1).trim();
    if (!key) continue;

    // Boolean
    if (rawVal === 'true')  { fm[key] = true;  continue; }
    if (rawVal === 'false') { fm[key] = false; continue; }
    // Number
    if (/^\d+$/.test(rawVal)) { fm[key] = parseInt(rawVal, 10); continue; }
    // Quoted string
    if ((rawVal.startsWith('"') && rawVal.endsWith('"')) ||
        (rawVal.startsWith("'") && rawVal.endsWith("'"))) {
      fm[key] = rawVal.slice(1, -1);
      continue;
    }
    // Inline array: [a, b, c]
    if (rawVal.startsWith('[') && rawVal.endsWith(']')) {
      fm[key] = rawVal
        .slice(1, -1)
        .split(',')
        .map(s => s.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);
      continue;
    }
    // Plain string
    fm[key] = rawVal;
  }

  const body = lines.slice(endLine + 1).join('\n');
  return { fm, body };
}

// ── Declared capabilities extractor ──────────────────────────────────────────

function extractDeclaredCapabilities(fm: SkillFrontmatter): string[] {
  const caps: string[] = [];
  if (fm.network === true) caps.push('network');
  if (fm.files === true) caps.push('files');
  if (fm.commands === true) caps.push('commands');
  if (fm.credentials === true) caps.push('credentials');
  if (Array.isArray(fm.permissions)) caps.push(...(fm.permissions as string[]));
  if (Array.isArray(fm.tools)) caps.push(...(fm.tools as string[]).map(t => `tool:${t}`));
  return [...new Set(caps)];
}

// ── Main evaluator ────────────────────────────────────────────────────────────

export function analyze(rawMarkdown: string): SkillAnalysisResult {
  const { fm, body } = parseFrontmatter(rawMarkdown.trim());
  const declaredCapabilities = extractDeclaredCapabilities(fm);

  // Run pattern scan over the full raw text (frontmatter + body) to catch
  // patterns hidden in comments or metadata blocks.
  const detectedPatterns: DetectedPattern[] = [];
  const seenPatternDescriptions = new Set<string>();
  const detectedCapabilities = new Set<string>();

  for (const def of DANGEROUS_PATTERNS) {
    if (def.regex.test(rawMarkdown)) {
      // Deduplicate by description to avoid noisy output
      if (!seenPatternDescriptions.has(def.description)) {
        seenPatternDescriptions.add(def.description);
        detectedPatterns.push({
          pattern: def.regex.source.slice(0, 60),
          severity: def.severity,
          description: def.description,
        });
        detectedCapabilities.add(def.capability);
      }
    }
  }

  // ── Mismatch detection: capability present in body but not declared ─────────
  const CAPABILITY_CHECKS: Array<{ capability: string; declared: string[] }> = [
    { capability: 'network_access', declared: ['network'] },
    { capability: 'network_exfil',  declared: ['network'] },
    { capability: 'file_write',     declared: ['files'] },
    { capability: 'shell_exec',     declared: ['commands'] },
    { capability: 'credential_access', declared: ['credentials'] },
  ];

  for (const check of CAPABILITY_CHECKS) {
    if (
      detectedCapabilities.has(check.capability) &&
      !check.declared.some(d => declaredCapabilities.includes(d))
    ) {
      // Undeclared — escalate severity if not already blocking
      const existing = detectedPatterns.find(p => p.description.includes(check.capability));
      if (existing && existing.severity === 'medium') {
        existing.severity = 'high';
      }
    }
  }

  // ── Compute block decision ─────────────────────────────────────────────────
  const blockingPatterns = DANGEROUS_PATTERNS.filter(
    def => def.block && def.regex.test(rawMarkdown),
  );

  // Extra block: requiresApproval:false in frontmatter + dangerous body
  const fmBypassesApproval = fm.requiresApproval === false;
  const bodyHasDangerousOps = detectedPatterns.some(
    p => p.severity === 'critical' || p.severity === 'high',
  );
  const mismatchBlock = fmBypassesApproval && bodyHasDangerousOps;

  const blocked = blockingPatterns.length > 0 || mismatchBlock;
  let blockReason: string | undefined;

  if (blocked) {
    if (mismatchBlock) {
      blockReason = 'Frontmatter declares requiresApproval: false but body contains dangerous operations — policy bypass attempt.';
    } else {
      blockReason = blockingPatterns
        .map(p => p.description)
        .slice(0, 2)
        .join('; ');
    }
  }

  // ── Risk level ────────────────────────────────────────────────────────────
  let riskLevel: SkillRiskLevel = 'low';

  if (blocked) {
    riskLevel = 'critical';
  } else if (detectedPatterns.some(p => p.severity === 'high')) {
    riskLevel = 'high';
  } else if (detectedPatterns.some(p => p.severity === 'medium')) {
    riskLevel = 'medium';
  } else if (declaredCapabilities.some(c => ['network', 'files', 'commands', 'credentials'].includes(c))) {
    // Declared capabilities with no dangerous body patterns = medium
    riskLevel = 'medium';
  }

  // ── Approval / council flags ──────────────────────────────────────────────
  const requiresApproval = !blocked && riskLevel !== 'low';
  const councilReviewRequired = !blocked && (riskLevel === 'high' || detectedPatterns.some(p => p.severity === 'high'));

  // ── Review summary ────────────────────────────────────────────────────────
  let reviewSummary: string;
  const skillName = fm.name ?? 'Unknown skill';

  if (blocked) {
    reviewSummary = `"${skillName}" is BLOCKED. ${blockReason}`;
  } else if (riskLevel === 'high') {
    const caps = [...detectedCapabilities].join(', ');
    reviewSummary = `"${skillName}" requires council review. Detected undeclared or high-risk capabilities: ${caps || 'see patterns'}.`;
  } else if (riskLevel === 'medium') {
    const decl = declaredCapabilities.join(', ');
    reviewSummary = `"${skillName}" requires human approval. Declared capabilities: ${decl || 'none stated'}. ${detectedPatterns.length} pattern(s) flagged.`;
  } else {
    reviewSummary = `"${skillName}" passed initial trust scan. Risk level: low. No dangerous patterns detected.`;
  }

  return {
    riskLevel,
    blocked,
    blockReason,
    requiresApproval,
    councilReviewRequired,
    declaredCapabilities,
    detectedCapabilities: [...detectedCapabilities],
    detectedPatterns,
    reviewSummary,
    frontmatter: fm,
  };
}
