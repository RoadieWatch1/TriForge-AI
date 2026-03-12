/**
 * resultStore.ts — JSONL execution result persistence for Phase 4
 *
 * Stores ExecutionResult records in a JSONL file at userData/triforge-results.jsonl.
 * Provides query methods used by the analyze_results tool via serviceLocator.
 */

import fs from 'fs';
import path from 'path';
import { app } from 'electron';
import type { ExecutionResult } from '@triforge/engine';

export class ResultStore {
  private filePath: string;

  constructor() {
    this.filePath = path.join(app.getPath('userData'), 'triforge-results.jsonl');
  }

  /** Append a single ExecutionResult to the JSONL file */
  append(result: ExecutionResult): void {
    try {
      const line = JSON.stringify(result) + '\n';
      fs.appendFileSync(this.filePath, line, 'utf8');
    } catch (e) {
      console.error('[resultStore] append failed:', e);
    }
  }

  /** Load all results — used for analysis */
  loadAll(): ExecutionResult[] {
    if (!fs.existsSync(this.filePath)) return [];
    try {
      const lines = fs.readFileSync(this.filePath, 'utf8')
        .split('\n')
        .filter(Boolean);
      return lines.map(l => JSON.parse(l) as ExecutionResult);
    } catch (e) {
      console.error('[resultStore] loadAll failed:', e);
      return [];
    }
  }

  /** Return recent results, optionally filtered by taskId */
  query(taskId?: string, limit = 200): ExecutionResult[] {
    const all = this.loadAll();
    const filtered = taskId ? all.filter(r => r.taskId === taskId) : all;
    return filtered.slice(-limit);
  }

  /** Summary metrics across all results (or for a task) */
  getMetrics(taskId?: string): {
    total: number;
    successful: number;
    failed: number;
    paperMode: number;
    byTool: Record<string, { total: number; success: number }>;
  } {
    const results = this.query(taskId, 10_000);
    const byTool: Record<string, { total: number; success: number }> = {};
    let successful = 0, failed = 0, paperMode = 0;

    for (const r of results) {
      if (r.success) successful++; else failed++;
      if (r.paperMode) paperMode++;
      if (!byTool[r.tool]) byTool[r.tool] = { total: 0, success: 0 };
      byTool[r.tool].total++;
      if (r.success) byTool[r.tool].success++;
    }

    return { total: results.length, successful, failed, paperMode, byTool };
  }

  /**
   * Adapter for serviceLocator.registerResultLogger().
   * Returns a function matching the (result: ExecutionResult) => void signature.
   */
  createLoggerAdapter(): (result: ExecutionResult) => void {
    return (result: ExecutionResult) => this.append(result);
  }

  /**
   * Adapter for serviceLocator.registerResultQuerier().
   * Returns a function matching the (taskId?: string) => ExecutionResult[] signature.
   */
  createQuerierAdapter(): (taskId?: string) => ExecutionResult[] {
    return (taskId?: string) => this.query(taskId);
  }
}
