// ── councilMemoryGraph.ts ─────────────────────────────────────────────────────
//
// Stores structured knowledge about the user's projects so the council can
// reason with prior decisions, strategies, and insights across sessions.
//
// This is DISTINCT from packages/desktop/src/core/memory/knowledgeGraph.ts,
// which tracks system-level relationships (tools, missions, tasks).
// CouncilMemoryGraph is focused on council-level project knowledge.
//
// Persisted via StorageAdapter. Key: triforge.councilMemoryGraph
//
// Usage:
//   const graph = new CouncilMemoryGraph(storage);
//   graph.addNode({ id: 'pricing_v1', type: 'decision', project: 'saas_launch',
//                   content: 'Three-tier pricing', related: [] });
//   const addendum = graph.buildContextAddendum(userMessage); // inject into prompt

import type { StorageAdapter } from '../platform';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface MemoryNode {
  id:        string;
  type:      'decision' | 'strategy' | 'idea' | 'insight' | 'fact';
  project:   string;
  content:   string;
  related:   string[];   // ids of related nodes
  createdAt: number;     // unix ms
}

interface GraphData {
  nodes: MemoryNode[];
}

const STORAGE_KEY = 'triforge.councilMemoryGraph';

// ── CouncilMemoryGraph ────────────────────────────────────────────────────────

export class CouncilMemoryGraph {
  constructor(private _storage: StorageAdapter) {}

  // ── Private helpers ──────────────────────────────────────────────────────────

  private _load(): MemoryNode[] {
    const data = this._storage.get<GraphData>(STORAGE_KEY, { nodes: [] });
    return data?.nodes ?? [];
  }

  private _save(nodes: MemoryNode[]): void {
    this._storage.update(STORAGE_KEY, { nodes } satisfies GraphData);
  }

  // ── Write ────────────────────────────────────────────────────────────────────

  /**
   * Add or replace a node. If a node with the same `id` already exists it is
   * overwritten (upsert). `createdAt` is always set to now.
   */
  addNode(node: Omit<MemoryNode, 'createdAt'>): void {
    const nodes = this._load();
    const idx   = nodes.findIndex(n => n.id === node.id);
    const full: MemoryNode = { ...node, createdAt: Date.now() };
    if (idx >= 0) {
      nodes[idx] = full;
    } else {
      nodes.push(full);
    }
    this._save(nodes);
  }

  // ── Read ─────────────────────────────────────────────────────────────────────

  /** Find nodes that are directly related to the given node id (bi-directional). */
  findRelated(nodeId: string): MemoryNode[] {
    const nodes = this._load();
    const node  = nodes.find(n => n.id === nodeId);
    if (!node) return [];
    return nodes.filter(n =>
      node.related.includes(n.id) || n.related.includes(nodeId),
    );
  }

  /** Search nodes by project name (case-insensitive substring match). */
  searchProject(projectName: string): MemoryNode[] {
    const lower = projectName.toLowerCase();
    return this._load().filter(n => n.project.toLowerCase().includes(lower));
  }

  /** Search nodes by content or project (used for context injection). */
  searchContent(query: string): MemoryNode[] {
    const lower = query.toLowerCase();
    return this._load().filter(n =>
      n.content.toLowerCase().includes(lower) ||
      n.project.toLowerCase().includes(lower),
    );
  }

  /** Return all stored nodes. */
  getAll(): MemoryNode[] {
    return this._load();
  }

  // ── System prompt injection ──────────────────────────────────────────────────

  /**
   * Build a system prompt addendum from nodes that match the user's message.
   * Returns an empty string when no relevant nodes exist.
   * Injects up to 5 most relevant nodes to keep the prompt concise.
   */
  buildContextAddendum(message: string): string {
    const related = this.searchContent(message).slice(0, 5);
    if (related.length === 0) return '';

    const lines: string[] = [
      '\n\n--- COUNCIL KNOWLEDGE ---',
      'Previous decisions and strategies relevant to this request:',
    ];

    for (const node of related) {
      lines.push(`• [${node.type}] ${node.content}`);
    }

    return lines.join('\n');
  }
}
