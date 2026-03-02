import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import type { AuditEventType, AuditLedgerEntry, TaskCategory } from './taskTypes';

// ── AuditLedger ───────────────────────────────────────────────────────────────
// Append-only JSONL audit log with daily file rotation.
// Files: <dataDir>/ledger-YYYY-MM-DD.jsonl

function todayDateStr(d?: Date): string {
  return (d ?? new Date()).toISOString().slice(0, 10);
}

function yesterdayDateStr(): string {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return d.toISOString().slice(0, 10);
}

export class AuditLedger {
  private _dataDir: string;
  private _writeQueue: Promise<void> = Promise.resolve();

  constructor(dataDir: string) {
    this._dataDir = dataDir;
  }

  private _filePath(dateStr?: string): string {
    return path.join(this._dataDir, `ledger-${dateStr ?? todayDateStr()}.jsonl`);
  }

  // Append a pre-built entry to today's JSONL file
  append(entry: AuditLedgerEntry): Promise<void> {
    const filePath = this._filePath(); // always today
    this._writeQueue = this._writeQueue.then(() =>
      fs.promises.appendFile(filePath, JSON.stringify(entry) + '\n', 'utf8')
    );
    return this._writeQueue;
  }

  // Convenience: build entry and append
  log(
    eventType: AuditEventType,
    opts: {
      taskId?: string;
      stepId?: string;
      tool?: string;
      category?: TaskCategory;
      metadata?: Record<string, unknown>;
    } = {}
  ): Promise<void> {
    const entry: AuditLedgerEntry = {
      id: crypto.createHash('sha256')
        .update(eventType + Date.now() + Math.random())
        .digest('hex')
        .slice(0, 16),
      timestamp: Date.now(),
      eventType,
      ...opts,
    };
    return this.append(entry);
  }

  // Read last N entries from today's + yesterday's files (newest first)
  async getRecent(n: number): Promise<AuditLedgerEntry[]> {
    const files = [this._filePath(), this._filePath(yesterdayDateStr())];
    const allLines: string[] = [];

    for (const file of files) {
      try {
        const raw = await fs.promises.readFile(file, 'utf8');
        allLines.push(...raw.split('\n').filter(Boolean));
      } catch {
        // file doesn't exist yet — fine
      }
    }

    return allLines
      .slice(-n)
      .map(line => { try { return JSON.parse(line) as AuditLedgerEntry; } catch { return null; } })
      .filter((e): e is AuditLedgerEntry => e !== null)
      .reverse();
  }

  // Read all entries since a given timestamp (ms) — scans recent files
  async tailSince(ts: number): Promise<AuditLedgerEntry[]> {
    const results: AuditLedgerEntry[] = [];
    const today = todayDateStr();
    const yesterday = yesterdayDateStr();

    for (const dateStr of [today, yesterday]) {
      try {
        const raw = await fs.promises.readFile(this._filePath(dateStr), 'utf8');
        const entries = raw
          .split('\n')
          .filter(Boolean)
          .map(line => { try { return JSON.parse(line) as AuditLedgerEntry; } catch { return null; } })
          .filter((e): e is AuditLedgerEntry => e !== null && e.timestamp >= ts);
        results.push(...entries);
      } catch {
        // skip missing files
      }
    }

    return results.sort((a, b) => a.timestamp - b.timestamp);
  }
}
