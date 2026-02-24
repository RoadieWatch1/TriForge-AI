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
