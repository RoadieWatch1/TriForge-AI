/**
 * ToolExecutionBus.ts — Centralized tool execution layer.
 *
 * Provides a unified entry point for all tool calls, enabling:
 *   - Centralized event emission (TOOL_BUS_START/COMPLETE/ERROR)
 *   - Parallel batch execution (executeMany)
 *   - Timeout enforcement per tool
 *   - Future: retry logic, rate limiting, AI supervision hooks
 *
 * Existing systems (AgentLoop, ToolRegistry, etc.) are NOT modified.
 * New code (CouncilExecutor, sensors, custom flows) should prefer this bus.
 */

import { eventBus }              from '../core/eventBus';
import type { TaskToolRegistry } from '../tools/taskRegistry';
import type { ToolContext }      from '../core/taskTypes';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface BusTask {
  tool:  string;
  input: Record<string, unknown>;
  ctx?:  ToolContext;
}

export interface BusResult {
  tool:      string;
  success:   boolean;
  result?:   unknown;
  error?:    string;
  durationMs: number;
}

const DEFAULT_TIMEOUT_MS = 120_000; // 2 minutes per tool

// ── ToolExecutionBus ──────────────────────────────────────────────────────────

export class ToolExecutionBus {
  constructor(
    private _registry: TaskToolRegistry,
    private _timeoutMs: number = DEFAULT_TIMEOUT_MS,
  ) {}

  /**
   * Execute a single tool by name with the given input.
   * Emits TOOL_BUS_START, then TOOL_BUS_COMPLETE or TOOL_BUS_ERROR.
   */
  async execute(toolName: string, input: Record<string, unknown>, ctx?: ToolContext): Promise<unknown> {
    const startMs = Date.now();

    eventBus.emit({
      type:  'TOOL_BUS_START',
      tool:  toolName,
      input,
    });

    // Build a default context if none provided
    const toolCtx: ToolContext = ctx ?? {
      taskId:   'bus',
      stepId:   'bus',
      category: 'general',
    };

    try {
      // Enforce timeout via AbortSignal-compatible race
      let result: unknown;
      const runPromise = this._registry.run(toolName as import('../core/taskTypes').TaskToolName, input, toolCtx);

      if (this._timeoutMs > 0) {
        const timeoutPromise = new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(`Tool '${toolName}' timed out after ${this._timeoutMs}ms`)), this._timeoutMs),
        );
        result = await Promise.race([runPromise, timeoutPromise]);
      } else {
        result = await runPromise;
      }

      eventBus.emit({
        type:       'TOOL_BUS_COMPLETE',
        tool:       toolName,
        durationMs: Date.now() - startMs,
      });

      return result;
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);

      eventBus.emit({
        type:  'TOOL_BUS_ERROR',
        tool:  toolName,
        error,
      });

      throw err;
    }
  }

  /**
   * Execute multiple tools in parallel.
   * Each task runs independently; failures are captured per-task (never throw globally).
   */
  async executeMany(tasks: BusTask[]): Promise<BusResult[]> {
    const results = await Promise.allSettled(
      tasks.map(async (t) => {
        const startMs = Date.now();
        try {
          const result = await this.execute(t.tool, t.input, t.ctx);
          return { tool: t.tool, success: true, result, durationMs: Date.now() - startMs } as BusResult;
        } catch (err) {
          return {
            tool:       t.tool,
            success:    false,
            error:      err instanceof Error ? err.message : String(err),
            durationMs: Date.now() - startMs,
          } as BusResult;
        }
      }),
    );

    return results.map(r =>
      r.status === 'fulfilled'
        ? r.value
        : { tool: 'unknown', success: false, error: String(r.reason), durationMs: 0 },
    );
  }

  /** List all registered tool names. */
  listTools(): string[] {
    return this._registry.listAll().map(t => t.name);
  }
}

// ── Singleton ─────────────────────────────────────────────────────────────────

let _instance: ToolExecutionBus | null = null;

export function getToolExecutionBus(registry: TaskToolRegistry): ToolExecutionBus {
  if (!_instance) {
    _instance = new ToolExecutionBus(registry);
  }
  return _instance;
}
