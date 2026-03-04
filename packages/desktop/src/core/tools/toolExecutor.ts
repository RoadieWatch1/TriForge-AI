/**
 * toolExecutor.ts — Approval-gated direct tool execution.
 *
 * Allows TriForge to safely execute tools outside of a full task/plan cycle.
 * Low-risk tools are auto-approved. Medium/high-risk tools create an
 * ApprovalRequest and wait for human sign-off via IPC.
 *
 * Integration points:
 *   - TaskToolRegistry  — tool lookup + execution
 *   - ApprovalStore     — approval request persistence
 *   - AuditLedger       — append-only execution record
 *   - EventBus          — TOOL_EXECUTE_* events
 */

import * as crypto from 'crypto';
import type { TaskToolRegistry, AuditLedger, ApprovalStore, TaskCategory, TaskToolName } from '@triforge/engine';
import { eventBus } from '@triforge/engine';

// ── Public interfaces ──────────────────────────────────────────────────────────

export interface ToolExecutionRequest {
  id:        string;
  tool:      string;
  params:    Record<string, unknown>;
  category?: TaskCategory;
}

export interface ToolExecutionResult {
  ok:      boolean;
  result?: unknown;
  error?:  string;
  denied?: boolean;
}

// ── ToolExecutor ───────────────────────────────────────────────────────────────

export class ToolExecutor {
  /** Pending approval callbacks: approvalId → resolve(approved) */
  private _pending = new Map<string, (approved: boolean) => void>();

  constructor(
    private _registry:      TaskToolRegistry,
    private _ledger:        AuditLedger,
    private _approvalStore: ApprovalStore,
  ) {}

  isReady(): boolean {
    return true; // always ready once constructed
  }

  async execute(request: ToolExecutionRequest): Promise<ToolExecutionResult> {
    const def = this._registry.describe(request.tool as TaskToolName);
    if (!def) {
      return { ok: false, error: `Tool not found: ${request.tool}` };
    }

    eventBus.emit({
      type:      'TOOL_EXECUTE_REQUESTED',
      requestId: request.id,
      tool:      request.tool,
      riskLevel: def.riskLevel,
    });

    // Low-risk: auto-approved — no human gate needed
    let approved = def.riskLevel === 'low';

    if (!approved) {
      const approvalReq = this._approvalStore.create({
        taskId:             `executor:${request.id}`,
        stepId:             request.id,
        tool:               request.tool as TaskToolName,
        args:               request.params,
        riskLevel:          def.riskLevel,
        estimatedCostCents: def.estimatedCostCents,
        expiresAt:          Date.now() + 24 * 60 * 60 * 1_000,
      });

      // Wait until UI calls resolveApproval(approvalId, true/false) via IPC
      approved = await new Promise<boolean>((resolve) => {
        this._pending.set(approvalReq.id, resolve);
      });

      if (approved) {
        eventBus.emit({
          type:      'TOOL_EXECUTE_APPROVED',
          requestId: request.id,
          tool:      request.tool,
        });
      }
    }

    if (!approved) {
      return { ok: false, denied: true };
    }

    const ctx = {
      taskId:   `executor:${request.id}`,
      stepId:   request.id,
      category: request.category ?? 'general' as TaskCategory,
    };

    try {
      const result = await this._registry.run(request.tool as TaskToolName, request.params, ctx);

      await this._ledger.log('TOOL_CALLED', {
        tool:     request.tool,
        metadata: { requestId: request.id, params: request.params, approved: true },
      });

      eventBus.emit({ type: 'TOOL_EXECUTE_COMPLETED', requestId: request.id, tool: request.tool, result });
      return { ok: true, result };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);

      await this._ledger.log('TOOL_RESULT', {
        tool:     request.tool,
        metadata: { requestId: request.id, error },
      });

      eventBus.emit({ type: 'TOOL_EXECUTE_FAILED', requestId: request.id, tool: request.tool, error });
      return { ok: false, error };
    }
  }

  /** Called by IPC when user approves or denies a pending tool request. */
  resolveApproval(approvalId: string, approved: boolean): void {
    const cb = this._pending.get(approvalId);
    if (cb) {
      cb(approved);
      this._pending.delete(approvalId);
    }
  }

  listPendingApprovals(): string[] {
    return [...this._pending.keys()];
  }
}

// ── Singleton factory (used by ipc.ts) ────────────────────────────────────────

let _instance: ToolExecutor | null = null;

export function getToolExecutor(
  registry:      TaskToolRegistry,
  ledger:        AuditLedger,
  approvalStore: ApprovalStore,
): ToolExecutor {
  if (!_instance) {
    _instance = new ToolExecutor(registry, ledger, approvalStore);
  }
  return _instance;
}

/** Generate a unique request ID for tool execution requests. */
export function newRequestId(): string {
  return crypto.randomUUID();
}
