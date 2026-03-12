// ── execution/buildFolderAudit.ts — Folder / Workspace Audit Engine ──────────
//
// Pure heuristics layer — no singletons, no side effects.
// Takes a folder path, uses scanWorkspace() to enumerate files, reads key
// config files, and returns a structured FolderAuditResult.
//
// Design principles:
//   • Lightweight — heuristics, not deep static analysis
//   • Safe — reads only safe extensions, never writes
//   • Honest — no fake "AI-detected dead code"; real signal only
//   • Structured — UI can render sections cleanly, not a text wall

import * as fs   from 'fs';
import * as path from 'path';
import { scanWorkspace, readSafeFile } from '../core/context';
import type { FileInfo } from '../core/context';

// ── Result types ──────────────────────────────────────────────────────────────

export interface AuditFinding {
  severity: 'low' | 'medium' | 'high';
  category:
    | 'structure'
    | 'dead_code'
    | 'todo_cluster'
    | 'large_files'
    | 'docs'
    | 'tests'
    | 'config'
    | 'organization'
    | 'risk';
  title: string;
  detail: string;
  filePaths?: string[];
}

export interface FolderAuditResult {
  ok: boolean;
  path: string;
  folderName: string;
  projectType: 'code' | 'documents' | 'mixed' | 'empty';
  summary: string;
  structure: {
    totalFiles: number;
    keyDirectories: string[];
    keyFiles: string[];
    detectedStacks: string[];
    languageBreakdown: Record<string, number>;
  };
  findings: AuditFinding[];
  healthy: string[];
  recommendations: string[];
  nextActions: string[];
  needsMissionOffer: boolean;
  unavailableReason?: string;
  durationMs: number;
}

// ── Stack detection ───────────────────────────────────────────────────────────

interface StackSignal { name: string; files: string[] }

const STACK_SIGNALS: StackSignal[] = [
  { name: 'Node.js / npm',          files: ['package.json'] },
  { name: 'TypeScript',             files: ['tsconfig.json'] },
  { name: 'React',                  files: ['vite.config.ts', 'vite.config.js', 'next.config.js', 'next.config.ts', 'next.config.mjs'] },
  { name: 'Next.js',                files: ['next.config.js', 'next.config.ts', 'next.config.mjs'] },
  { name: 'Electron',               files: ['electron-builder.yml', 'electron-builder.json', 'forge.config.js', 'forge.config.ts'] },
  { name: 'Expo / React Native',    files: ['expo.json', 'app.json', 'metro.config.js'] },
  { name: 'Python',                 files: ['requirements.txt', 'pyproject.toml', 'setup.py', 'Pipfile'] },
  { name: 'Rust',                   files: ['Cargo.toml'] },
  { name: 'Go',                     files: ['go.mod'] },
  { name: 'Java / Maven',           files: ['pom.xml'] },
  { name: 'Java / Gradle',          files: ['build.gradle', 'build.gradle.kts'] },
  { name: 'Docker',                 files: ['Dockerfile', 'docker-compose.yml', 'docker-compose.yaml'] },
  { name: 'Terraform',              files: ['main.tf'] },
  { name: 'Ruby on Rails',          files: ['Gemfile'] },
  { name: 'PHP / Composer',         files: ['composer.json'] },
  { name: 'C / C++',               files: ['CMakeLists.txt', 'Makefile'] },
  { name: 'Monorepo / Turborepo',   files: ['turbo.json', 'lerna.json', 'pnpm-workspace.yaml'] },
  { name: 'ESLint',                 files: ['.eslintrc', '.eslintrc.js', '.eslintrc.json', '.eslintrc.ts', 'eslint.config.js', 'eslint.config.ts'] },
  { name: 'Prettier',               files: ['.prettierrc', '.prettierrc.json', '.prettierrc.js', 'prettier.config.js'] },
  { name: 'Tailwind CSS',           files: ['tailwind.config.js', 'tailwind.config.ts'] },
  { name: 'Prisma',                 files: ['schema.prisma', 'prisma/schema.prisma'] },
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function rootNames(folderPath: string): Set<string> {
  try {
    return new Set(fs.readdirSync(folderPath));
  } catch {
    return new Set();
  }
}

function countTodosInFile(filePath: string): number {
  const content = readSafeFile(filePath);
  if (!content) return 0;
  return (content.match(/\b(TODO|FIXME|HACK|XXX|BUG)\b/gi) ?? []).length;
}

function isCodeFile(info: FileInfo): boolean {
  const CODE_LANGS = new Set([
    'typescript', 'typescriptreact', 'javascript', 'javascriptreact',
    'python', 'java', 'go', 'rust', 'csharp', 'cpp', 'c', 'ruby', 'php', 'swift', 'kotlin',
  ]);
  return CODE_LANGS.has(info.language);
}

// ── Main audit function ───────────────────────────────────────────────────────

export async function buildFolderAudit(folderPath: string): Promise<FolderAuditResult> {
  const startMs = Date.now();
  const folderName = path.basename(folderPath);

  // Validate path
  if (!fs.existsSync(folderPath)) {
    return {
      ok: false,
      path: folderPath,
      folderName,
      projectType: 'empty',
      summary: `Path not found: ${folderPath}`,
      structure: { totalFiles: 0, keyDirectories: [], keyFiles: [], detectedStacks: [], languageBreakdown: {} },
      findings: [],
      healthy: [],
      recommendations: [],
      nextActions: [],
      needsMissionOffer: false,
      unavailableReason: 'Path does not exist or is inaccessible.',
      durationMs: Date.now() - startMs,
    };
  }

  const files = await scanWorkspace(folderPath);
  const root  = rootNames(folderPath);

  if (files.length === 0) {
    return {
      ok: true,
      path: folderPath,
      folderName,
      projectType: 'empty',
      summary: 'The folder appears to be empty or contains only unsupported file types (binaries, media).',
      structure: { totalFiles: 0, keyDirectories: [], keyFiles: [], detectedStacks: [], languageBreakdown: {} },
      findings: [{ severity: 'low', category: 'structure', title: 'Empty or binary-only folder', detail: 'No readable source files found. Triforge audits text and code files only.' }],
      healthy: [],
      recommendations: ['Add source files or select a different folder to audit.'],
      nextActions: [],
      needsMissionOffer: false,
      durationMs: Date.now() - startMs,
    };
  }

  // ── Language breakdown ──────────────────────────────────────────────────────
  const langBreakdown: Record<string, number> = {};
  for (const f of files) {
    langBreakdown[f.language] = (langBreakdown[f.language] ?? 0) + 1;
  }
  const codeFileCount = files.filter(isCodeFile).length;
  const docFileCount  = files.filter(f => f.language === 'markdown' || f.language === 'plaintext').length;
  const projectType: FolderAuditResult['projectType'] =
    codeFileCount > docFileCount * 2 ? 'code'
    : docFileCount > codeFileCount   ? 'documents'
    : codeFileCount > 0              ? 'mixed'
    : 'empty';

  // ── Stack detection ─────────────────────────────────────────────────────────
  const detectedStacks: string[] = [];
  for (const sig of STACK_SIGNALS) {
    if (sig.files.some(f => root.has(f) || root.has(path.basename(f)))) {
      detectedStacks.push(sig.name);
    }
  }

  // ── Key directories ─────────────────────────────────────────────────────────
  const KEY_DIRS = ['src', 'lib', 'app', 'pages', 'components', 'api', 'server',
    'client', 'tests', 'test', '__tests__', 'spec', 'docs', 'scripts', 'config',
    'public', 'static', 'assets', 'dist', 'build', 'out', 'packages', 'modules'];
  const keyDirectories = KEY_DIRS.filter(d => root.has(d));

  // ── Key files in root ───────────────────────────────────────────────────────
  const KEY_FILES = ['package.json', 'tsconfig.json', 'README.md', '.env', '.env.example',
    'Dockerfile', 'docker-compose.yml', 'Makefile', 'Cargo.toml', 'go.mod',
    'requirements.txt', 'pyproject.toml', 'turbo.json', 'pnpm-workspace.yaml'];
  const keyFiles = KEY_FILES.filter(f => root.has(f));

  // ── Findings ────────────────────────────────────────────────────────────────
  const findings: AuditFinding[] = [];
  const healthy: string[] = [];

  // 1. Large source files
  const LARGE_FILE_BYTES = 80_000;
  const largeFiles = files.filter(f => isCodeFile(f) && f.size > LARGE_FILE_BYTES);
  if (largeFiles.length > 0) {
    findings.push({
      severity: largeFiles.length > 3 ? 'high' : 'medium',
      category: 'large_files',
      title: `${largeFiles.length} oversized source file${largeFiles.length > 1 ? 's' : ''} detected`,
      detail: `Files over 80 KB are typically candidates for splitting. Largest: ${largeFiles.sort((a,b) => b.size - a.size).slice(0,3).map(f => `${f.relativePath} (${Math.round(f.size/1024)}KB)`).join(', ')}.`,
      filePaths: largeFiles.slice(0, 5).map(f => f.relativePath),
    });
  } else if (codeFileCount > 0) {
    healthy.push('Source files are within reasonable size limits.');
  }

  // 2. TODO/FIXME clusters (sample up to 50 source files)
  let totalTodos = 0;
  const todoFiles: string[] = [];
  const sampleFiles = files.filter(isCodeFile).slice(0, 50);
  for (const f of sampleFiles) {
    const count = countTodosInFile(f.path);
    if (count > 0) {
      totalTodos += count;
      todoFiles.push(`${f.relativePath} (${count})`);
    }
  }
  if (totalTodos > 10) {
    findings.push({
      severity: totalTodos > 40 ? 'high' : 'medium',
      category: 'todo_cluster',
      title: `${totalTodos} TODO/FIXME markers found`,
      detail: `High concentrations of technical debt markers. Top files: ${todoFiles.slice(0,4).join(', ')}.`,
      filePaths: todoFiles.slice(0,6).map(s => s.split(' ')[0]),
    });
  } else if (codeFileCount > 0) {
    healthy.push('TODO/FIXME count is low — low visible technical debt.');
  }

  // 3. Missing README
  if (!root.has('README.md') && !root.has('README.txt') && !root.has('readme.md')) {
    findings.push({
      severity: 'medium',
      category: 'docs',
      title: 'No README found',
      detail: 'There is no README at the root. New contributors and tools cannot quickly understand the project.',
    });
  } else {
    healthy.push('README present.');
  }

  // 4. Missing tests directory
  const hasTests = root.has('tests') || root.has('test') || root.has('__tests__') || root.has('spec')
    || files.some(f => /\.(test|spec)\.(ts|tsx|js|jsx|py)$/.test(f.relativePath));
  if (projectType === 'code' && !hasTests) {
    findings.push({
      severity: 'high',
      category: 'tests',
      title: 'No test files or test directory detected',
      detail: 'No test directory or *.test.* / *.spec.* files found. Test coverage cannot be verified.',
    });
  } else if (projectType === 'code') {
    healthy.push('Test files or test directory present.');
  }

  // 5. Missing .env.example
  if (root.has('.env') && !root.has('.env.example') && !root.has('.env.sample')) {
    findings.push({
      severity: 'medium',
      category: 'config',
      title: '.env present but .env.example missing',
      detail: 'A .env file exists, but there is no .env.example to document required variables for other developers.',
    });
  }

  // 6. Secrets risk: raw .env in root
  if (root.has('.env')) {
    findings.push({
      severity: 'low',
      category: 'risk',
      title: '.env file detected at root',
      detail: 'Ensure .env is listed in .gitignore and never committed to source control.',
    });
  }

  // 7. Build artifacts in repo
  const BUILD_ARTIFACTS = ['dist', 'build', 'out', '.next', '__pycache__'];
  const committedArtifacts = BUILD_ARTIFACTS.filter(d => root.has(d));
  if (committedArtifacts.length > 0) {
    findings.push({
      severity: 'low',
      category: 'structure',
      title: `Build output directories present: ${committedArtifacts.join(', ')}`,
      detail: 'Build artifact directories are typically excluded via .gitignore. Verify they are not being committed.',
      filePaths: committedArtifacts,
    });
  }

  // 8. Too many root-level files (clutter)
  const rootFiles = [...root].filter(name => {
    try { return fs.statSync(path.join(folderPath, name)).isFile(); } catch { return false; }
  });
  if (rootFiles.length > 20) {
    findings.push({
      severity: 'low',
      category: 'organization',
      title: `${rootFiles.length} files at the root level`,
      detail: 'A large number of files at the root can make the project harder to navigate. Consider moving non-critical files into subdirectories.',
    });
  }

  // 9. Document folder: naming inconsistency
  if (projectType === 'documents') {
    const docFiles = files.filter(f => f.language === 'markdown' || f.language === 'plaintext');
    const extensions = new Set(docFiles.map(f => path.extname(f.relativePath).toLowerCase()));
    if (extensions.size > 3) {
      findings.push({
        severity: 'low',
        category: 'organization',
        title: `${extensions.size} different file extensions in a document folder`,
        detail: `Mixed extensions found: ${[...extensions].join(', ')}. Consider standardizing on one format.`,
      });
    }
    if (docFiles.length > 30) {
      findings.push({
        severity: 'low',
        category: 'organization',
        title: `${docFiles.length} documents — consider sub-folders`,
        detail: 'A large flat document collection can be hard to navigate. Grouping by topic or date may help.',
      });
    }
  }

  // ── Recommendations ─────────────────────────────────────────────────────────
  const recommendations: string[] = [];
  if (largeFiles.length > 0) recommendations.push(`Split or refactor the ${largeFiles.length} oversized source file${largeFiles.length > 1 ? 's' : ''}.`);
  if (totalTodos > 10) recommendations.push(`Address or tag the ${totalTodos} TODO/FIXME markers.`);
  if (!root.has('README.md')) recommendations.push('Add a README.md with project overview, setup steps, and usage.');
  if (projectType === 'code' && !hasTests) recommendations.push('Introduce a test suite (unit + integration) to protect core logic.');
  if (root.has('.env') && !root.has('.env.example')) recommendations.push('Create a .env.example documenting required environment variables.');
  if (committedArtifacts.length > 0) recommendations.push(`Add ${committedArtifacts.join(', ')} to .gitignore.`);
  if (recommendations.length === 0) recommendations.push('No major structural issues found. Run a deeper mission to investigate code quality in detail.');

  // ── Next actions ─────────────────────────────────────────────────────────────
  const nextActions: string[] = [
    'Create a mission from this audit to fix the top issues.',
    'Ask: "What should I fix first?" for a prioritized plan.',
    'Ask: "Show me the worst files" for a deep dive.',
  ];

  // ── Summary ──────────────────────────────────────────────────────────────────
  const highCount = findings.filter(f => f.severity === 'high').length;
  const medCount  = findings.filter(f => f.severity === 'medium').length;
  const severity  = highCount > 0 ? 'significant issues' : medCount > 1 ? 'moderate issues' : 'minor issues';
  const summary = detectedStacks.length > 0
    ? `**${folderName}** — ${detectedStacks.slice(0,3).join(' / ')} project. ${files.length} files scanned. Found ${findings.length} finding${findings.length !== 1 ? 's' : ''} (${severity}).`
    : `**${folderName}** — ${projectType} folder. ${files.length} files scanned. Found ${findings.length} finding${findings.length !== 1 ? 's' : ''} (${severity}).`;

  return {
    ok: true,
    path: folderPath,
    folderName,
    projectType,
    summary,
    structure: {
      totalFiles: files.length,
      keyDirectories,
      keyFiles,
      detectedStacks,
      languageBreakdown: langBreakdown,
    },
    findings,
    healthy,
    recommendations,
    nextActions,
    needsMissionOffer: findings.some(f => f.severity === 'high') || recommendations.length > 2,
    durationMs: Date.now() - startMs,
  };
}

// ── Format audit as readable Council response text ────────────────────────────

export function formatAuditAsText(result: FolderAuditResult): string {
  if (!result.ok || result.projectType === 'empty') {
    return `**Folder Audit — ${result.folderName}**\n\n${result.summary}`;
  }

  const lines: string[] = [];

  lines.push(`## Folder Audit — ${result.folderName}`);
  lines.push('');
  lines.push(`**${result.summary}**`);
  lines.push('');

  // Stack
  if (result.structure.detectedStacks.length > 0) {
    lines.push(`**Detected Stack:** ${result.structure.detectedStacks.join(' · ')}`);
  }
  lines.push(`**Files Scanned:** ${result.structure.totalFiles}  |  **Scan Time:** ${result.durationMs}ms`);
  if (result.structure.keyDirectories.length > 0) {
    lines.push(`**Key Directories:** ${result.structure.keyDirectories.join(', ')}`);
  }
  lines.push('');

  // Findings
  if (result.findings.length > 0) {
    lines.push('### Findings');
    for (const f of result.findings) {
      const icon = f.severity === 'high' ? '🔴' : f.severity === 'medium' ? '🟡' : '⚪';
      lines.push(`${icon} **${f.title}**`);
      lines.push(`   ${f.detail}`);
    }
    lines.push('');
  }

  // Healthy
  if (result.healthy.length > 0) {
    lines.push('### What Looks Healthy');
    for (const h of result.healthy) lines.push(`✅ ${h}`);
    lines.push('');
  }

  // Recommendations
  lines.push('### Recommended Next Steps');
  for (const r of result.recommendations) lines.push(`→ ${r}`);
  lines.push('');

  // Mission offer
  if (result.needsMissionOffer) {
    lines.push('---');
    lines.push('**Ready to fix this?** Say "Create a mission from this audit" and the Council will plan a structured remediation.');
  }

  return lines.join('\n');
}
