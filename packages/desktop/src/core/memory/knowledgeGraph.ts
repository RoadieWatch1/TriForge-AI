/**
 * knowledgeGraph.ts — In-memory knowledge graph of system relationships.
 *
 * Tracks relationships between concepts, tasks, tools, missions, and users.
 * Used by MemoryManager to build contextual understanding over time.
 * Graph is persisted via MemoryStore for cross-session continuity.
 */

export interface KnowledgeNode {
  id:     string;
  type:   string;  // 'mission' | 'task' | 'tool' | 'user' | 'concept'
  label:  string;
  metadata?: Record<string, unknown>;
}

export interface KnowledgeEdge {
  from:     string;  // node id
  to:       string;  // node id
  relation: string;  // 'created' | 'executed' | 'triggered' | 'uses' | 'produced'
  weight?:  number;  // higher = stronger relationship
}

export class KnowledgeGraph {
  nodes = new Map<string, KnowledgeNode>();
  edges: KnowledgeEdge[] = [];

  // ── Mutations ──────────────────────────────────────────────────────────────

  addNode(node: KnowledgeNode): void {
    this.nodes.set(node.id, node);
  }

  addEdge(edge: KnowledgeEdge): void {
    // Avoid exact duplicate edges
    const dup = this.edges.find(
      e => e.from === edge.from && e.to === edge.to && e.relation === edge.relation,
    );
    if (dup) {
      dup.weight = (dup.weight ?? 1) + 1; // strengthen existing edge
    } else {
      this.edges.push({ ...edge, weight: edge.weight ?? 1 });
    }
  }

  // ── Queries ────────────────────────────────────────────────────────────────

  getNode(id: string): KnowledgeNode | undefined {
    return this.nodes.get(id);
  }

  getNeighbors(id: string): KnowledgeNode[] {
    const ids = this.edges
      .filter(e => e.from === id || e.to === id)
      .map(e   => e.from === id ? e.to : e.from);
    return [...new Set(ids)].map(i => this.nodes.get(i)).filter(Boolean) as KnowledgeNode[];
  }

  getEdgesFor(id: string): KnowledgeEdge[] {
    return this.edges.filter(e => e.from === id || e.to === id);
  }

  // ── Serialization ──────────────────────────────────────────────────────────

  toJSON(): { nodes: KnowledgeNode[]; edges: KnowledgeEdge[] } {
    return {
      nodes: [...this.nodes.values()],
      edges: this.edges,
    };
  }

  static fromJSON(data: { nodes: KnowledgeNode[]; edges: KnowledgeEdge[] }): KnowledgeGraph {
    const g = new KnowledgeGraph();
    for (const n of data.nodes ?? []) g.nodes.set(n.id, n);
    g.edges = data.edges ?? [];
    return g;
  }
}
