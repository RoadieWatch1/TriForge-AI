import * as fs from 'fs';
import * as path from 'path';

/**
 * Safety module: Filters secrets and sensitive data before sending to AI providers.
 */

const SECRET_PATTERNS = [
  /\.env/,
  /\.env\.\w+/,
  /node_modules/,
  /dist/,
  /build/,
  /\.git/,
  /__pycache__/,
  /\.egg-info/,
  /package-lock\.json/,
  /yarn\.lock/,
  /pnpm-lock\.yaml/,
];

const SECRET_FILE_CONTENTS = [
  /PRIVATE[\s_]*KEY/i,
  /PASSWORD/i,
  /API[\s_]*KEY/i,
  /SECRET/i,
  /TOKEN/i,
  /BEARER/i,
];

/**
 * Check if a file path should be excluded from context.
 */
export function isPathExcluded(filePath: string): boolean {
  return SECRET_PATTERNS.some(pattern => pattern.test(filePath));
}

/**
 * Check if file content contains sensitive data.
 */
export function containsSensitiveData(content: string): boolean {
  return SECRET_FILE_CONTENTS.some(pattern => pattern.test(content));
}

/**
 * Sanitize content by redacting sensitive lines.
 */
export function sanitizeContent(content: string): string {
  const lines = content.split('\n');
  return lines
    .map(line => {
      if (containsSensitiveData(line)) {
        return '// [SENSITIVE LINE REDACTED]';
      }
      return line;
    })
    .join('\n');
}

/**
 * Get safe file extensions to scan (default allowlist for code).
 */
export function getSafeExtensions(): string[] {
  return [
    '.ts',
    '.tsx',
    '.js',
    '.jsx',
    '.py',
    '.java',
    '.go',
    '.rs',
    '.cs',
    '.cpp',
    '.c',
    '.h',
    '.hpp',
    '.rb',
    '.php',
    '.swift',
    '.kt',
    '.json',
    '.yaml',
    '.yml',
    '.toml',
    '.xml',
    '.md',
    '.txt',
  ];
}
