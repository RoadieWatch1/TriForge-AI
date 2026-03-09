// ── expertRosterLedger.ts — Append-only roster action log ────────────────────
//
// Logs all workforce actions (hires, promotions, benchings, retirements,
// replacements, restorations, selections, task completions).
// Daily file rotation, same pattern as AuditLedger.

import * as fs from 'fs';
import * as path from 'path';
import type { RosterLedgerEntry, RosterAction } from './expertTypes';

function todayDateStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export class ExpertRosterLedger {
  private _dataDir: string;
  private _writeQueue: Promise<void> = Promise.resolve();

  constructor(dataDir: string) {
    this._dataDir = dataDir;
  }

  private _filePath(dateStr?: string): string {
    return path.join(this._dataDir, `expert-roster-${dateStr ?? todayDateStr()}.jsonl`);
  }

  // ── Logging ───────────────────────────────────────────────────────────────

  log(entry: RosterLedgerEntry): void {
    const filePath = this._filePath();
    this._writeQueue = this._writeQueue.then(async () => {
      await fs.promises.mkdir(this._dataDir, { recursive: true });
      await fs.promises.appendFile(filePath, JSON.stringify(entry) + '\n', 'utf8');
    });
  }

  /** Convenience: build entry and log. */
  record(
    action: RosterAction,
    expertId: string,
    details: Record<string, unknown> = {},
  ): void {
    this.log({
      timestamp: Date.now(),
      action,
      expertId,
      details,
    });
  }

  // ── Reading ───────────────────────────────────────────────────────────────

  async getEntries(since?: number): Promise<RosterLedgerEntry[]> {
    const entries: RosterLedgerEntry[] = [];
    const files = await this._listLedgerFiles();

    for (const file of files) {
      try {
        const content = await fs.promises.readFile(file, 'utf8');
        for (const line of content.split('\n')) {
          if (!line.trim()) continue;
          try {
            const entry = JSON.parse(line) as RosterLedgerEntry;
            if (!since || entry.timestamp >= since) {
              entries.push(entry);
            }
          } catch {
            // Skip malformed lines
          }
        }
      } catch {
        // Skip unreadable files
      }
    }

    return entries.sort((a, b) => a.timestamp - b.timestamp);
  }

  // ── File management ───────────────────────────────────────────────────────

  private async _listLedgerFiles(): Promise<string[]> {
    try {
      const files = await fs.promises.readdir(this._dataDir);
      return files
        .filter(f => f.startsWith('expert-roster-') && f.endsWith('.jsonl'))
        .map(f => path.join(this._dataDir, f))
        .sort();
    } catch {
      return [];
    }
  }
}
