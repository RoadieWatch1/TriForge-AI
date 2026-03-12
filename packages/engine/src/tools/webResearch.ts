import * as crypto from 'crypto';
import type { ToolDefinition, ToolContext, ExecutionResult } from '../core/taskTypes';
import { serviceLocator } from '../core/serviceLocator';
import { eventBus } from '../core/eventBus';

export const webResearchDef: ToolDefinition = {
  name: 'web_research',
  description: 'Fetch and extract text content from a URL for research purposes. Returns title, snippet, and word count.',
  category: 'research',
  riskLevel: 'low',
  estimatedCostCents: 0,
  inputSchema: {
    url:   { type: 'string', description: 'URL to research (must be http/https)' },
    query: { type: 'string', description: 'Focus query — what to look for in the page (optional)' },
    maxChars: { type: 'number', description: 'Max chars to return in snippet (default 2000)' },
  },
};

interface WebResearchArgs {
  url:      string;
  query?:   string;
  maxChars?: number;
}

export interface WebResearchResult {
  url:       string;
  title:     string;
  snippet:   string;
  charCount: number;
  wordCount: number;
  query?:    string;
  statusCode: number;
  fetchedAt: number;
}

export async function runWebResearch(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<WebResearchResult> {
  const { url, query, maxChars = 2000 } = args as unknown as WebResearchArgs;

  if (!url?.trim()) throw new Error('web_research: "url" is required');

  // Safety: only HTTP/HTTPS
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new Error(`web_research: invalid URL "${url}"`);
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    throw new Error('web_research: only http/https URLs are allowed');
  }

  // Block localhost / private ranges
  const hostname = parsed.hostname;
  if (hostname === 'localhost' || hostname.startsWith('127.') || hostname.startsWith('192.168.') || hostname.startsWith('10.')) {
    throw new Error('web_research: private/local URLs are not allowed');
  }

  let statusCode = 0;
  let html = '';
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'TriforgeAI-Research/1.0 (+https://triforge.ai)',
        'Accept': 'text/html,application/xhtml+xml,text/plain;q=0.9',
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    statusCode = response.status;
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${response.statusText}`);
    html = await response.text();
  } catch (err) {
    if ((err as Error)?.name === 'AbortError') throw new Error('web_research: request timed out after 12s');
    throw err;
  }

  // Extract title
  const titleMatch = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  const title = titleMatch ? titleMatch[1].replace(/\s+/g, ' ').trim() : parsed.hostname;

  // Strip HTML to plain text
  const text = html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/\s{2,}/g, ' ')
    .trim();

  const cap     = Math.min(Number(maxChars) || 2000, 10_000);
  const snippet = text.slice(0, cap);
  const words   = text.split(/\s+/).filter(Boolean);

  const execResult: ExecutionResult = {
    id:        crypto.randomUUID(),
    taskId:    ctx.taskId,
    stepId:    ctx.stepId,
    tool:      'web_research',
    timestamp: Date.now(),
    success:   true,
    paperMode: false,
    data:      { url, title, charCount: text.length },
    metrics:   { charCount: text.length },
  };
  serviceLocator.logResult(execResult);

  eventBus.emit({
    type:    'RESULT_LOGGED',
    taskId:  ctx.taskId,
    stepId:  ctx.stepId,
    tool:    'web_research',
    success: true,
  });

  return {
    url,
    title,
    snippet,
    charCount:  text.length,
    wordCount:  words.length,
    query:      query || undefined,
    statusCode,
    fetchedAt:  Date.now(),
  };
}
