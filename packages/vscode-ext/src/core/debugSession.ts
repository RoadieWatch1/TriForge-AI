import * as vscode from 'vscode';
import { previewCommand, executePreview } from './commands';
import { createPatch, modifyPatch, ChangePatch, createApprovalRequest } from './patch';

export interface DebugIteration {
  id: string;
  description: string;
  attemptedFix?: ChangePatch;
  testResult?: { passed: boolean; output?: string };
  timestamp: number;
}

export class DebugSession {
  private _id: string;
  private _workspacePath: string;
  private _errorLogs: string[] = [];
  private _iterations: DebugIteration[] = [];
  private _onUpdate: ((u: any) => void) | null = null;

  constructor(workspacePath: string, onUpdate?: (u: any) => void) {
    this._id = `dbg-${Date.now()}-${Math.random().toString(36).slice(2,8)}`;
    this._workspacePath = workspacePath;
    this._onUpdate = onUpdate || null;
  }

  id() { return this._id; }

  addErrorLog(text: string) {
    this._errorLogs.push(text);
    this._emit({ type: 'logAdded', text });
  }

  getState() {
    return {
      id: this._id,
      errors: this._errorLogs.slice(-10),
      iterations: this._iterations,
    };
  }

  proposeFix(description: string, filePath: string, original: string, proposed: string) {
    const patch = modifyPatch(filePath, original, proposed, this._workspacePath);
    const approval = createApprovalRequest([patch]);
    const iter: DebugIteration = {
      id: approval.token,
      description,
      attemptedFix: patch,
      timestamp: Date.now(),
    };
    this._iterations.push(iter);
    this._emit({ type: 'proposedFix', iteration: iter, approvalToken: approval.token, summary: approval.summary });
    return { iteration: iter, approval };
  }

  async runTests(command = 'npm test') {
    const preview = previewCommand(command, this._workspacePath, 'Run project tests as part of debugging', 'medium');
    this._emit({ type: 'testsSuggested', preview });
    return preview;
  }

  async executePreview(token: string) {
    const res = await executePreview(token);
    this._emit({ type: 'testsExecuted', token, result: res });
    return res;
  }

  recordTestResult(iterationId: string, passed: boolean, output?: string) {
    const it = this._iterations.find(i => i.id === iterationId);
    if (it) {
      it.testResult = { passed, output };
      this._emit({ type: 'iterationUpdated', iteration: it });
    }
  }

  private _emit(u: any) {
    if (this._onUpdate) { this._onUpdate(u); }
  }
}
