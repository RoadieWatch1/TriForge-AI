import type { ToolDefinition, ToolContext } from '../core/taskTypes';

export const docSearchDef: ToolDefinition = {
  name: 'doc_search',
  description: 'Search for documents and web resources relevant to a query (simulated in MVP).',
  category: 'research',
  riskLevel: 'low',
  estimatedCostCents: 0,
  inputSchema: {
    query: { type: 'string', description: 'Search query' },
    limit: { type: 'number', description: 'Max results (default 5)' },
  },
};

interface DocSearchArgs {
  query: string;
  limit?: number;
}

interface SearchResult {
  title: string;
  snippet: string;
  relevance: number;
}

interface DocSearchResult {
  query: string;
  results: SearchResult[];
  totalFound: number;
}

// Simulated search — returns plausible-looking results based on query terms
export async function runDocSearch(
  args: Record<string, unknown>,
  _ctx: ToolContext,
): Promise<DocSearchResult> {
  const { query, limit = 5 } = args as unknown as DocSearchArgs;
  const terms = query.split(/\s+/).filter(Boolean).slice(0, 4);

  const results: SearchResult[] = Array.from({ length: Math.min(limit, 5) }, (_, i) => ({
    title: `${terms[0] ?? 'Topic'} — Resource ${i + 1}`,
    snippet: `This resource covers ${terms.join(', ')} in detail. It provides ${i + 1 === 1 ? 'an overview' : 'advanced insights'} relevant to your query.`,
    relevance: parseFloat((1 - i * 0.15).toFixed(2)),
  }));

  return {
    query,
    results,
    totalFound: results.length,
  };
}
