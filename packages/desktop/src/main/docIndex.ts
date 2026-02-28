import fs from 'fs';
import path from 'path';
import os from 'os';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface DocEntry {
  path: string;
  name: string;
  size: number;
  modified: string;
  extension: string;
  ocrText: string;
  docTypes: Array<{ type: string; confidence: number }>;
  indexedAt: string;
}

export interface DocResult extends DocEntry {
  matchScore: number;
}

// ── File extensions to index ───────────────────────────────────────────────────

const OCR_IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.bmp', '.tiff', '.tif', '.webp']);

// ── Document type patterns ─────────────────────────────────────────────────────

const DOC_PATTERNS: Array<{ type: string; keywords: string[] }> = [
  { type: 'Driver License / State ID',  keywords: ['driver', 'licens', 'state id', 'dmv', 'motor vehicle', 'department of motor'] },
  { type: 'Passport',                   keywords: ['passport', 'nationality', 'place of birth', 'travel document'] },
  { type: 'EIN / Tax ID',               keywords: ['employer identification', 'ein', 'federal tax', 'internal revenue', 'tax id'] },
  { type: 'DBA / Business Name',        keywords: ['doing business as', 'dba', 'fictitious business', 'assumed name', 'trade name'] },
  { type: 'Business Registration',      keywords: ['incorporation', 'articles of', 'business license', 'secretary of state', 'registered agent'] },
  { type: 'Social Security Card',       keywords: ['social security', 'administration', 'this number has been'] },
  { type: 'Insurance Document',         keywords: ['insurance', 'policy', 'insured', 'coverage', 'premium', 'beneficiary'] },
  { type: 'Tax Return',                 keywords: ['form 1040', 'tax return', 'irs', '1099', 'w-2', 'adjusted gross income'] },
  { type: 'Bank Statement',             keywords: ['bank', 'account', 'routing', 'balance', 'statement', 'transaction'] },
  { type: 'Contract / Agreement',       keywords: ['agreement', 'contract', 'terms and conditions', 'hereby', 'parties agree'] },
  { type: 'Invoice',                    keywords: ['invoice', 'bill to', 'payment due', 'amount due', 'invoice number'] },
  { type: 'Birth Certificate',          keywords: ['birth certificate', 'certificate of birth', 'date of birth', 'place of birth'] },
  { type: 'Vehicle Title / Registration', keywords: ['vehicle', 'title', 'registration', 'vin', 'license plate'] },
  { type: 'Lease / Rental Agreement',  keywords: ['lease', 'tenant', 'landlord', 'rent', 'premises', 'rental'] },
];

// ── Document type detection ────────────────────────────────────────────────────

export function detectDocTypes(text: string): Array<{ type: string; confidence: number }> {
  const lower = text.toLowerCase();
  return DOC_PATTERNS
    .map(dp => {
      const matches = dp.keywords.filter(kw => lower.includes(kw)).length;
      if (matches === 0) return null;
      // Base score: proportion of matched keywords + bonus for multiple hits
      const base = (matches / dp.keywords.length) * 80;
      const bonus = Math.min(20, matches * 5);
      return { type: dp.type, confidence: Math.min(100, Math.round(base + bonus)) };
    })
    .filter((r): r is { type: string; confidence: number } => r !== null)
    .sort((a, b) => b.confidence - a.confidence);
}

// ── File scanner ───────────────────────────────────────────────────────────────

interface ScannedDoc {
  name: string;
  path: string;
  size: number;
  modified: string;
  extension: string;
}

function walkDir(dir: string, results: ScannedDoc[], depth: number): void {
  if (depth < 0 || !fs.existsSync(dir)) return;
  let entries: fs.Dirent[];
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    const fullPath = path.join(dir, e.name);
    if (e.isDirectory()) {
      walkDir(fullPath, results, depth - 1);
    } else if (e.isFile()) {
      const ext = path.extname(e.name).toLowerCase();
      if (!OCR_IMAGE_EXT.has(ext)) continue;
      try {
        const stat = fs.statSync(fullPath);
        results.push({ name: e.name, path: fullPath, size: stat.size, modified: stat.mtime.toISOString(), extension: ext });
      } catch { /* skip locked files */ }
    }
  }
}

export function scanForDocuments(startPath?: string): ScannedDoc[] {
  const home = os.homedir();
  const roots = startPath
    ? [startPath]
    : [
        path.join(home, 'Documents'),
        path.join(home, 'Desktop'),
        path.join(home, 'Downloads'),
        path.join(home, 'OneDrive', 'Documents'),
        path.join(home, 'OneDrive', 'Desktop'),
        path.join(home, 'Pictures'),
      ];
  const results: ScannedDoc[] = [];
  for (const root of roots) {
    walkDir(root, results, 4);
  }
  results.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());
  return results.slice(0, 500);
}

// ── OCR ────────────────────────────────────────────────────────────────────────

export async function ocrFile(filePath: string, langPath: string): Promise<string> {
  // Dynamic import so tesseract.js is only loaded when actually needed
  const { createWorker } = await import('tesseract.js');
  const worker = await createWorker('eng', 1, {
    // @ts-ignore — tesseract.js v5 option
    cacheMethod: 'readWrite',
    langPath,
    logger: () => { /* suppress verbose output */ },
  });
  try {
    const { data: { text } } = await worker.recognize(filePath);
    return text.trim();
  } catch {
    return '';
  } finally {
    await worker.terminate();
  }
}

// ── Index search ───────────────────────────────────────────────────────────────

export function searchIndex(index: DocEntry[], query: string): DocResult[] {
  const q = query.toLowerCase();
  const qWords = q.split(/\s+/).filter(w => w.length > 1);

  const scored = index.map(entry => {
    let score = 0;

    // 1. Doc type label match (up to 50 pts)
    for (const dt of entry.docTypes) {
      const label = dt.type.toLowerCase();
      if (label.includes(q) || q.includes(label.split(' ')[0])) {
        score += Math.round(dt.confidence * 0.5);
        break;
      }
      const wordMatches = qWords.filter(w => label.includes(w)).length;
      if (wordMatches > 0) {
        score += Math.round((wordMatches / qWords.length) * dt.confidence * 0.4);
        break;
      }
    }

    // 2. OCR text keyword match (up to 40 pts)
    const ocrLower = entry.ocrText.toLowerCase();
    const ocrMatches = qWords.filter(w => ocrLower.includes(w)).length;
    if (ocrMatches > 0) {
      score += Math.round((ocrMatches / qWords.length) * 40);
    }

    // 3. Filename match (up to 10 pts)
    const nameLower = entry.name.toLowerCase();
    const nameMatches = qWords.filter(w => nameLower.includes(w)).length;
    if (nameMatches > 0) {
      score += Math.round((nameMatches / qWords.length) * 10);
    }

    return { ...entry, matchScore: Math.min(100, score) };
  });

  return scored
    .filter(r => r.matchScore > 0)
    .sort((a, b) => b.matchScore - a.matchScore)
    .slice(0, 10);
}
