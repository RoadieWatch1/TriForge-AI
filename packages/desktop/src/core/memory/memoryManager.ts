/**
 * memoryManager.ts — System-level memory + knowledge graph manager.
 *
 * Listens to EventBus events and records significant system events to the
 * MemoryStore. Maintains a KnowledgeGraph of relationships between missions,
 * tasks, tools, and outcomes for cross-session contextual awareness.
 *
 * NOTE: This is distinct from the user-facing Store.memory (which holds AI
 * context memories). This manager records system-level operational history.
 */

import * as crypto from 'crypto';
import { eventBus } from '@triforge/engine';
import { MemoryStore, type MemoryItem } from './memoryStore';
import { KnowledgeGraph } from './knowledgeGraph';

export class MemoryManager {
  private _graph:  KnowledgeGraph;
  private _unsubscribers: Array<() => void> = [];

  constructor(private _store: MemoryStore) {
    this._graph = this._loadGraph();
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  add(type: string, content: string, metadata?: Record<string, unknown>): void {
    const item: MemoryItem = {
      id:        crypto.randomUUID(),
      type,
      content,
      metadata,
      timestamp: Date.now(),
    };
    this._store.save(item);
  }

  search(query: string): MemoryItem[] {
    return this._store.search(query);
  }

  getRecent(n: number = 20): MemoryItem[] {
    return this._store.getRecent(n);
  }

  getGraph(): KnowledgeGraph {
    return this._graph;
  }

  // ── EventBus wiring ────────────────────────────────────────────────────────

  /** Subscribe to EventBus and auto-record significant events. */
  connectEventBus(): void {
    this._unsubscribers.push(
      eventBus.on('MISSION_COMPLETED', (ev) => {
        this.add('mission', `Mission completed: ${ev.name}`, { missionId: ev.missionId });
        this._graph.addNode({ id: `mission:${ev.missionId}`, type: 'mission', label: ev.name });
        this._graph.addEdge({ from: 'system', to: `mission:${ev.missionId}`, relation: 'completed' });
        this._persistGraph();
      }),

      eventBus.on('MISSION_FAILED', (ev) => {
        this.add('mission', `Mission failed: ${ev.name} — ${ev.error}`, { missionId: ev.missionId, error: ev.error });
      }),

      eventBus.on('TOOL_EXECUTE_COMPLETED', (ev) => {
        this.add('tool', `Tool executed: ${ev.tool}`, { requestId: ev.requestId });
        this._graph.addNode({ id: `tool:${ev.tool}`, type: 'tool', label: ev.tool });
        this._graph.addEdge({ from: 'system', to: `tool:${ev.tool}`, relation: 'executed' });
        this._persistGraph();
      }),

      eventBus.on('TASK_COMPLETED', (ev) => {
        this.add('task', `Task completed: ${ev.taskId}`, { taskId: ev.taskId });
      }),

      eventBus.on('TASK_FAILED', (ev) => {
        this.add('task', `Task failed: ${ev.taskId} — ${ev.error}`, { taskId: ev.taskId, error: ev.error });
      }),

      eventBus.on('WORKFLOW_FIRED', (ev) => {
        this.add('workflow', `Workflow fired: ${ev.workflowName}`, { workflowId: ev.workflowId });
        this._graph.addNode({ id: `workflow:${ev.workflowId}`, type: 'workflow', label: ev.workflowName });
        this._graph.addEdge({ from: 'system', to: `workflow:${ev.workflowId}`, relation: 'triggered' });
        this._persistGraph();
      }),
    );

    // Ensure the root 'system' node always exists
    if (!this._graph.getNode('system')) {
      this._graph.addNode({ id: 'system', type: 'root', label: 'TriForge System' });
    }
  }

  disconnect(): void {
    this._unsubscribers.forEach(fn => fn());
    this._unsubscribers = [];
  }

  // ── Graph persistence ──────────────────────────────────────────────────────

  private _loadGraph(): KnowledgeGraph {
    try {
      const items = this._store.search('__graph__');
      const graphItem = items.find(i => i.type === '__graph__');
      if (graphItem?.metadata?.graph) {
        return KnowledgeGraph.fromJSON(
          graphItem.metadata.graph as { nodes: never[]; edges: never[] },
        );
      }
    } catch { /* start fresh */ }
    return new KnowledgeGraph();
  }

  private _persistGraph(): void {
    // Store graph as a special memory item (upsert pattern)
    const existing = this._store.search('__graph__').find(i => i.type === '__graph__');
    if (existing) {
      // Overwrite by re-saving (MemoryStore appends, so old entry becomes stale —
      // search returns the last match, so this is acceptable for a small graph)
    }
    const item: MemoryItem = {
      id:        '__graph__',
      type:      '__graph__',
      content:   '__graph__',
      metadata:  { graph: this._graph.toJSON() },
      timestamp: Date.now(),
    };
    this._store.save(item);
  }
}

/** Singleton — shared across main process */
let _instance: MemoryManager | null = null;

export function getMemoryManager(store: MemoryStore): MemoryManager {
  if (!_instance) {
    _instance = new MemoryManager(store);
  }
  return _instance;
}
