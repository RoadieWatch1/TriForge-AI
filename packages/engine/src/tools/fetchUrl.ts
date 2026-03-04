import type { ToolDefinition, ToolContext } from '../core/taskTypes';

export const fetchUrlDef: ToolDefinition = {
  name: 'fetch_url',
  description: 'Fetch raw content from a URL. Supports text, HTML, and JSON responses.',
  category: 'research',
  riskLevel: 'low',
  estimatedCostCents: 0,
  inputSchema: {
    url:       { type: 'string', description: 'HTTP/HTTPS URL to fetch' },
    method:    { type: 'string', description: 'HTTP method: GET or POST (default: GET)' },
    body:      { type: 'string', description: 'Request body for POST (optional)' },
    headers:   { type: 'object', description: 'Additional request headers (optional)' },
    maxChars:  { type: 'number', description: 'Max characters to return (default 10000)' },
  },
};

export async function runFetchUrl(
  args: Record<string, unknown>,
  _ctx: ToolContext,
): Promise<unknown> {
  const { url, method = 'GET', body, headers = {}, maxChars = 10_000 } = args as {
    url:       string;
    method?:   string;
    body?:     string;
    headers?:  Record<string, string>;
    maxChars?: number;
  };

  if (!url?.trim()) throw new Error('fetch_url: "url" is required');

  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`fetch_url: invalid URL "${url}"`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('fetch_url: only http/https URLs are allowed');
  }

  const safeMethod = (method ?? 'GET').toUpperCase();
  if (!['GET', 'POST'].includes(safeMethod)) throw new Error('fetch_url: only GET and POST are supported');

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15_000);

  let response: Response;
  try {
    response = await fetch(url, {
      method: safeMethod,
      headers: {
        'User-Agent': 'TriforgeAI/1.0',
        ...headers,
      },
      body: safeMethod === 'POST' ? body : undefined,
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    if ((err as Error)?.name === 'AbortError') throw new Error('fetch_url: request timed out after 15s');
    throw err;
  }
  clearTimeout(timeout);

  const contentType = response.headers.get('content-type') ?? '';
  const raw = await response.text();
  const cap = Math.min(Number(maxChars) || 10_000, 100_000);

  let data: unknown = raw.slice(0, cap);
  if (contentType.includes('application/json')) {
    try { data = JSON.parse(raw); } catch { /* return as text */ }
  }

  return {
    url,
    status:      response.status,
    contentType,
    data,
    truncated:   raw.length > cap,
    size:        raw.length,
  };
}
