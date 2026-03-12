/**
 * CouncilWorkflowSessionStore — in-memory session store with optional persistence.
 */

import type { CouncilWorkflowSession } from './councilWorkflowTypes';

export class CouncilWorkflowSessionStore {
  private _sessions = new Map<string, CouncilWorkflowSession>();

  get(id: string): CouncilWorkflowSession | undefined {
    return this._sessions.get(id);
  }

  set(session: CouncilWorkflowSession): void {
    session.updatedAt = Date.now();
    this._sessions.set(session.id, session);
  }

  delete(id: string): boolean {
    return this._sessions.delete(id);
  }

  list(): CouncilWorkflowSession[] {
    return Array.from(this._sessions.values());
  }

  clear(): void {
    this._sessions.clear();
  }
}
