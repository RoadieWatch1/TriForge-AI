import fs from 'fs';
import path from 'path';
import os from 'os';

export interface ScannedFile {
  name: string;
  path: string;
  size: number;          // bytes
  modified: string;      // ISO string
  extension: string;
}

export interface OrganizeResult {
  moved: number;
  folders: string[];
  errors: string[];
}

export interface OrganizeDeepResult extends OrganizeResult {
  directoriesScanned: number;
}

export interface MoveResult {
  moved: number;
  errors: string[];
}

// ── Extension sets ────────────────────────────────────────────────────────────

const PHOTO_EXT  = new Set(['.jpg','.jpeg','.png','.gif','.bmp','.webp','.heic','.heif','.raw','.cr2','.nef','.arw','.tiff','.tif']);
const DOC_EXT    = new Set(['.pdf','.doc','.docx','.xls','.xlsx','.ppt','.pptx','.txt','.rtf','.odt','.ods','.odp','.csv']);
const VIDEO_EXT  = new Set(['.mp4','.mov','.avi','.mkv','.wmv','.flv','.m4v','.webm','.m2ts']);
const AUDIO_EXT  = new Set(['.mp3','.wav','.flac','.aac','.m4a','.ogg','.wma','.opus']);
const ARCHIVE_EXT = new Set(['.zip','.rar','.7z','.tar','.gz','.bz2','.xz']);

const CATEGORY_MAP: Record<string, Set<string>> = {
  Photos:    PHOTO_EXT,
  Videos:    VIDEO_EXT,
  Music:     AUDIO_EXT,
  Documents: DOC_EXT,
  Archives:  ARCHIVE_EXT,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function toMB(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function scanDir(
  dirPath: string,
  extensions: Set<string>,
  results: ScannedFile[],
  maxDepth: number,
  depth: number,
): void {
  if (depth > maxDepth) return;
  try {
    const entries = fs.readdirSync(dirPath, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isDirectory()) {
        scanDir(fullPath, extensions, results, maxDepth, depth + 1);
      } else if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (extensions.has(ext)) {
          try {
            const stat = fs.statSync(fullPath);
            results.push({ name: entry.name, path: fullPath, size: stat.size, modified: stat.mtime.toISOString(), extension: ext });
          } catch { /* skip unreadable */ }
        }
      }
    }
  } catch { /* skip unreadable dir */ }
}

// ── Public API ────────────────────────────────────────────────────────────────

/** Scan common photo locations and return up to `limit` photos sorted newest first. */
export function scanForPhotos(startPath?: string, limit = 300): ScannedFile[] {
  const home = os.homedir();
  const searchRoots = startPath
    ? [startPath]
    : [
        path.join(home, 'Pictures'),
        path.join(home, 'OneDrive', 'Pictures'),
        path.join(home, 'Desktop'),
        path.join(home, 'Downloads'),
        path.join(home, 'Documents'),
      ];

  const results: ScannedFile[] = [];
  for (const root of searchRoots) {
    if (fs.existsSync(root)) scanDir(root, PHOTO_EXT, results, 4, 0);
  }
  results.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());
  return results.slice(0, limit);
}

/** List the contents of a single directory (non-recursive). */
export function listDirectory(dirPath: string): { files: ScannedFile[]; subdirs: string[]; error?: string } {
  const resolved = dirPath.replace('~', os.homedir());
  const files: ScannedFile[] = [];
  const subdirs: string[] = [];
  try {
    const entries = fs.readdirSync(resolved, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const fullPath = path.join(resolved, entry.name);
      if (entry.isDirectory()) {
        subdirs.push(fullPath);
      } else {
        try {
          const stat = fs.statSync(fullPath);
          files.push({ name: entry.name, path: fullPath, size: stat.size, modified: stat.mtime.toISOString(), extension: path.extname(entry.name).toLowerCase() });
        } catch { /* skip */ }
      }
    }
    return { files, subdirs };
  } catch (e) {
    return { files: [], subdirs: [], error: String(e) };
  }
}

/** Organize a directory by moving files into category sub-folders. */
export function organizeDirectory(dirPath: string): OrganizeResult {
  const resolved = dirPath.replace('~', os.homedir());
  const result: OrganizeResult = { moved: 0, folders: [], errors: [] };

  try {
    const entries = fs.readdirSync(resolved, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isFile() || entry.name.startsWith('.')) continue;
      const ext = path.extname(entry.name).toLowerCase();
      let targetFolder: string | null = null;

      for (const [folder, exts] of Object.entries(CATEGORY_MAP)) {
        if (exts.has(ext)) { targetFolder = folder; break; }
      }
      if (!targetFolder) continue;

      const destDir = path.join(resolved, targetFolder);
      if (!fs.existsSync(destDir)) {
        fs.mkdirSync(destDir, { recursive: true });
        if (!result.folders.includes(destDir)) result.folders.push(destDir);
      }

      const srcPath = path.join(resolved, entry.name);
      let destPath = path.join(destDir, entry.name);
      if (fs.existsSync(destPath)) {
        const base = path.basename(entry.name, ext);
        destPath = path.join(destDir, `${base}_${Date.now()}${ext}`);
      }

      try {
        fs.renameSync(srcPath, destPath);
        result.moved++;
      } catch (e) {
        result.errors.push(`Could not move ${entry.name}: ${e}`);
      }
    }
  } catch (e) {
    result.errors.push(`Cannot read directory: ${e}`);
  }

  return result;
}

/** Recursively organize all files in a directory tree, consolidating into category sub-folders at the root. */
export function organizeDirectoryDeep(dirPath: string): OrganizeDeepResult {
  const resolved = dirPath.replace('~', os.homedir());
  const result: OrganizeDeepResult = { moved: 0, folders: [], errors: [], directoriesScanned: 0 };
  const CATEGORY_FOLDERS = new Set(Object.keys(CATEGORY_MAP));

  // Collect every file recursively, but skip files already inside a root-level category folder
  function collectFiles(dir: string, isRoot: boolean): string[] {
    result.directoriesScanned++;
    const files: string[] = [];
    try {
      const entries = fs.readdirSync(dir, { withFileTypes: true });
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (isRoot && CATEGORY_FOLDERS.has(entry.name)) continue; // already organized
          files.push(...collectFiles(fullPath, false));
        } else if (entry.isFile()) {
          files.push(fullPath);
        }
      }
    } catch { /* skip unreadable */ }
    return files;
  }

  for (const srcPath of collectFiles(resolved, true)) {
    const name = path.basename(srcPath);
    const ext  = path.extname(name).toLowerCase();
    let targetFolder: string | null = null;
    for (const [folder, exts] of Object.entries(CATEGORY_MAP)) {
      if (exts.has(ext)) { targetFolder = folder; break; }
    }
    if (!targetFolder) continue;

    const destDir = path.join(resolved, targetFolder);
    if (!fs.existsSync(destDir)) {
      fs.mkdirSync(destDir, { recursive: true });
      if (!result.folders.includes(destDir)) result.folders.push(destDir);
    }

    let destPath = path.join(destDir, name);
    if (srcPath === destPath) continue; // already in the right place
    if (fs.existsSync(destPath)) {
      const base = path.basename(name, ext);
      destPath = path.join(destDir, `${base}_${Date.now()}${ext}`);
    }

    try {
      fs.renameSync(srcPath, destPath);
      result.moved++;
    } catch (e) {
      result.errors.push(`Could not move ${name}: ${e}`);
    }
  }
  return result;
}

/** Search for photos whose filename contains the given query (case-insensitive). */
export function searchPhotos(query: string, startPath?: string, limit = 200): ScannedFile[] {
  const q = query.toLowerCase().trim();
  if (!q) return [];
  const home = os.homedir();
  const searchRoots = startPath ? [startPath] : [
    path.join(home, 'Pictures'),
    path.join(home, 'OneDrive', 'Pictures'),
    path.join(home, 'Desktop'),
    path.join(home, 'Downloads'),
    path.join(home, 'Documents'),
  ];
  const results: ScannedFile[] = [];
  for (const root of searchRoots) {
    if (fs.existsSync(root)) scanDir(root, PHOTO_EXT, results, 6, 0);
  }
  const filtered = results.filter(f => f.name.toLowerCase().includes(q));
  filtered.sort((a, b) => new Date(b.modified).getTime() - new Date(a.modified).getTime());
  return filtered.slice(0, limit);
}

/** Find photos similar to a reference file: scored by date proximity, same folder, name prefix, and file size. */
export function findSimilarPhotos(refPath: string, startPath?: string, limit = 100): ScannedFile[] {
  if (!fs.existsSync(refPath)) return [];
  let refStat: fs.Stats;
  try { refStat = fs.statSync(refPath); } catch { return []; }

  const refName   = path.basename(refPath, path.extname(refPath)).toLowerCase();
  const refDir    = path.dirname(refPath);
  const refDate   = refStat.mtime.getTime();
  const refSize   = refStat.size;
  const TWO_DAYS  = 2 * 24 * 60 * 60 * 1000;
  const ONE_HOUR  = 60 * 60 * 1000;
  const refPrefix = refName.substring(0, Math.min(6, refName.length));

  const home = os.homedir();
  const roots = startPath ? [startPath] : [
    path.join(home, 'Pictures'),
    path.join(home, 'OneDrive', 'Pictures'),
    path.join(home, 'Desktop'),
    path.join(home, 'Downloads'),
    refDir,
  ];

  const all: ScannedFile[] = [];
  const seen = new Set<string>();
  for (const root of roots) {
    if (fs.existsSync(root) && !seen.has(root)) {
      seen.add(root);
      scanDir(root, PHOTO_EXT, all, 4, 0);
    }
  }

  return all
    .filter(f => f.path !== refPath)
    .map(f => {
      let score = 0;
      const dateDiff = Math.abs(new Date(f.modified).getTime() - refDate);
      if (dateDiff < TWO_DAYS) score += 3;
      if (dateDiff < ONE_HOUR) score += 2; // same session
      if (path.dirname(f.path) === refDir) score += 2;
      if (f.name.toLowerCase().startsWith(refPrefix)) score += 2;
      if (Math.abs(f.size - refSize) / Math.max(refSize, 1) < 0.3) score += 1;
      return { file: f, score };
    })
    .filter(s => s.score >= 2)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(s => s.file);
}

/** Move a list of files to a destination directory. */
export function moveFiles(srcPaths: string[], destDir: string): MoveResult {
  const result: MoveResult = { moved: 0, errors: [] };
  try {
    fs.mkdirSync(destDir, { recursive: true });
  } catch (e) {
    result.errors.push(`Cannot create destination: ${e}`);
    return result;
  }
  for (const src of srcPaths) {
    const name = path.basename(src);
    let dest = path.join(destDir, name);
    if (fs.existsSync(dest)) {
      const ext  = path.extname(name);
      const base = path.basename(name, ext);
      dest = path.join(destDir, `${base}_${Date.now()}${ext}`);
    }
    try {
      fs.renameSync(src, dest);
      result.moved++;
    } catch (e) {
      result.errors.push(`Could not move ${name}: ${e}`);
    }
  }
  return result;
}

/** Return the user's common directories for navigation. */
export function getCommonDirs(): Record<string, string> {
  const home = os.homedir();
  return {
    Home:      home,
    Desktop:   path.join(home, 'Desktop'),
    Documents: path.join(home, 'Documents'),
    Downloads: path.join(home, 'Downloads'),
    Pictures:  path.join(home, 'Pictures'),
    Music:     path.join(home, 'Music'),
    Videos:    path.join(home, 'Videos'),
  };
}

/** Human-friendly summary of a scanned file (for AI context). */
export function fileSummary(f: ScannedFile): string {
  return `${f.name} (${toMB(f.size)}, modified ${new Date(f.modified).toLocaleDateString()})`;
}
