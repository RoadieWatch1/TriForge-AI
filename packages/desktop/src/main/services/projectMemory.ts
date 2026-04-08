// ── projectMemory.ts ──────────────────────────────────────────────────────────
//
// Project-scoped persistent memory for TriForge operator sessions.
//
// Tracks per-project state across app restarts so TriForge can resume:
//   "Last time I worked on TowerDefense.uproject, I finished M3 (inventory).
//    Want to continue to M4?"
//
// Stored in <userData>/project-memory.json — plain JSON, never synced off-device.

import path from 'path';
import fs   from 'fs';
import { app } from 'electron';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ProjectMemoryEntry {
  /** Absolute path to the .uproject (or other project root file) */
  projectPath:   string;
  /** Human-readable project name */
  projectName:   string;
  /** The last milestone completed, e.g. "M3" */
  lastMilestone?: string;
  /** The workflow pack ID that was last run */
  lastPackId?:   string;
  /** The prototype goal the user described */
  prototypeGoal?: string;
  /** ISO timestamp of last activity */
  lastRunAt:     string;
  /** Any notes saved during the run */
  notes?:        string;
}

interface ProjectMemoryStore {
  version:  1;
  projects: Record<string, ProjectMemoryEntry>;  // keyed by projectPath
  /** The most recently active project path */
  lastActiveProjectPath?: string;
}

// ── Storage helpers ───────────────────────────────────────────────────────────

let _cache: ProjectMemoryStore | null = null;

function getStorePath(): string {
  return path.join(app.getPath('userData'), 'project-memory.json');
}

function loadStore(): ProjectMemoryStore {
  if (_cache) return _cache;
  try {
    const raw = fs.readFileSync(getStorePath(), 'utf8');
    const parsed = JSON.parse(raw) as ProjectMemoryStore;
    if (parsed.version === 1 && parsed.projects) {
      _cache = parsed;
      return _cache;
    }
  } catch { /* first run or corrupt */ }
  _cache = { version: 1, projects: {} };
  return _cache;
}

function saveStore(store: ProjectMemoryStore): void {
  try {
    fs.writeFileSync(getStorePath(), JSON.stringify(store, null, 2), 'utf8');
    _cache = store;
  } catch { /* non-fatal */ }
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Save or update progress for a project.
 * Partial updates — only provided fields are written.
 */
export function saveProjectProgress(entry: Omit<ProjectMemoryEntry, 'lastRunAt'> & { lastRunAt?: string }): void {
  const store = loadStore();
  const existing = store.projects[entry.projectPath] ?? {} as Partial<ProjectMemoryEntry>;
  store.projects[entry.projectPath] = {
    ...existing,
    ...entry,
    lastRunAt: entry.lastRunAt ?? new Date().toISOString(),
  };
  store.lastActiveProjectPath = entry.projectPath;
  saveStore(store);
}

/**
 * Load saved progress for a specific project path.
 * Returns null if no record exists.
 */
export function loadProjectProgress(projectPath: string): ProjectMemoryEntry | null {
  const store = loadStore();
  return store.projects[projectPath] ?? null;
}

/**
 * Returns the most recently active project, or null if none.
 * Used to show "continue where you left off" in Chat + Operate.
 */
export function getLastProject(): ProjectMemoryEntry | null {
  const store = loadStore();
  if (!store.lastActiveProjectPath) return null;
  return store.projects[store.lastActiveProjectPath] ?? null;
}

/**
 * Returns all tracked projects, sorted by most recent activity first.
 */
export function getAllProjects(): ProjectMemoryEntry[] {
  const store = loadStore();
  return Object.values(store.projects)
    .sort((a, b) => new Date(b.lastRunAt).getTime() - new Date(a.lastRunAt).getTime());
}

/**
 * Remove a project's memory record (e.g. if the project was deleted).
 */
export function forgetProject(projectPath: string): void {
  const store = loadStore();
  delete store.projects[projectPath];
  if (store.lastActiveProjectPath === projectPath) {
    const remaining = Object.keys(store.projects);
    store.lastActiveProjectPath = remaining.length > 0 ? remaining[0] : undefined;
  }
  saveStore(store);
}

/**
 * Returns a human-readable continuation suggestion for Chat/Operate onboarding.
 * e.g. "Last time: TowerDefense — finished M3 (inventory). Want to continue to M4?"
 */
export function getContinuationSuggestion(): string | null {
  const last = getLastProject();
  if (!last) return null;

  const ago = getRelativeTime(new Date(last.lastRunAt));
  const milestoneNote = last.lastMilestone
    ? ` — finished ${last.lastMilestone}`
    : '';
  const goalNote = last.prototypeGoal
    ? ` (${last.prototypeGoal.slice(0, 40)}${last.prototypeGoal.length > 40 ? '…' : ''})`
    : '';

  return `Last time${ago}: **${last.projectName}**${goalNote}${milestoneNote}. Want to continue?`;
}

function getRelativeTime(date: Date): string {
  const diff = Date.now() - date.getTime();
  const mins  = Math.floor(diff / 60_000);
  const hours = Math.floor(diff / 3_600_000);
  const days  = Math.floor(diff / 86_400_000);
  if (mins < 2)   return ' just now';
  if (mins < 60)  return ` ${mins}m ago`;
  if (hours < 24) return ` ${hours}h ago`;
  if (days < 7)   return ` ${days}d ago`;
  return ` on ${date.toLocaleDateString()}`;
}
