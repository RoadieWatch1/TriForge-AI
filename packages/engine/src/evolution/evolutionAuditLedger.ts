// ── evolutionAuditLedger.ts — Append-only evolution action log ───────────────
//
// Logs all Performance Hunter actions (scans, quarantines, restores,
// shadow tests, dormant/degraded detections).
// Daily file rotation, same pattern as AuditLedger / ExpertRosterLedger.

import * as fs from 'fs';
import * as path from 'path';
import type { EvolutionLogEntry, EvolutionAction } from './evolutionTypes';

function todayDateStr(): string {
  return new Date().toISOString().slice(0, 10);
}

export class EvolutionAuditLedger {
  private _dataDir: string;
  private _writeQueue: Promise<void> = Promise.resolve();

  constructor(dataDir: string) {
    this._dataDir = dataDir;
  }

  private _filePath(dateStr?: string): string {
    return path.join(this._dataDir, `evolution-ledger-${dateStr ?? todayDateStr()}.jsonl`);
  }

  // ── Logging ─────────────────────────────────────────────────────────────────

  log(entry: EvolutionLogEntry): void {
    const filePath = this._filePath();
    this._writeQueue = this._writeQueue.then(async () => {
      await fs.promises.mkdir(this._dataDir, { recursive: true });
      await fs.promises.appendFile(filePath, JSON.stringify(entry) + '\n', 'utf8');
    });
  }

  /** Convenience: build entry and log. */
  record(
    action: EvolutionAction,
    componentId: string,
    details: Record<string, unknown> = {},
  ): void {
    this.log({
      timestamp: Date.now(),
      action,
      componentId,
      details,
    });
  }

  // ── Reading ─────────────────────────────────────────────────────────────────

  async getEntries(since?: number): Promise<EvolutionLogEntry[]> {
    const entries: EvolutionLogEntry[] = [];
    const files = await this._listLedgerFiles();

    for (const file of files) {
      try {
        const content = await fs.promises.readFile(file, 'utf8');
        for (const line of content.split('\n')) {
          if (!line.trim()) continue;
          try {
            const entry = JSON.parse(line) as EvolutionLogEntry;
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

  // ── File management ─────────────────────────────────────────────────────────

  private async _listLedgerFiles(): Promise<string[]> {
    try {
      const files = await fs.promises.readdir(this._dataDir);
      return files
        .filter(f => f.startsWith('evolution-ledger-') && f.endsWith('.jsonl'))
        .map(f => path.join(this._dataDir, f))
        .sort();
    } catch {
      return [];
    }
  }
}
