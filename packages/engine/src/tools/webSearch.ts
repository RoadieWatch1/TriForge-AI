// ── webSearch.ts — Lightweight DuckDuckGo web search ──────────────────────────
//
// Performs a web search using DuckDuckGo's HTML endpoint (no API key required).
// Returns structured results with title, snippet, and source URL.
// Used by the Council pre-flight to inject live web context before deliberation.

export interface WebSearchResult {
  title: string;
  snippet: string;
  url: string;
}

/**
 * Build a better search query from the user's natural-language message.
 * Strips conversational filler and appends today's date for time-sensitive queries.
 */
function refineQuery(raw: string): string {
  // Remove common conversational prefixes that hurt search quality
  let q = raw
    .replace(/^(can you |could you |please |tell me |what('?s| is| are) )/i, '')
    .replace(/^(search for |search the web for |look up |find )/i, '')
    .replace(/[?.!]+$/g, '')
    .trim();

  // If still too short, use the original
  if (q.length < 5) q = raw;

  // Append today's date for time-sensitive queries so results are current
  const today = new Date();
  const dateStr = today.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' });
  const timePhrases = [
    'today', 'latest', 'current', 'recent', 'now', 'breaking',
    'this week', 'this month', 'trending', 'top news', 'headlines',
  ];
  if (timePhrases.some(p => q.toLowerCase().includes(p))) {
    q += ` ${dateStr}`;
  }

  return q;
}

/**
 * Search the web using DuckDuckGo HTML and return structured results.
 * Gracefully returns an empty array on any failure.
 */
export async function searchWeb(query: string, maxResults = 5): Promise<WebSearchResult[]> {
  try {
    const refined = refineQuery(query);
    const encoded = encodeURIComponent(refined);
    const res = await fetch(`https://html.duckduckgo.com/html/?q=${encoded}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded',
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      },
      body: `q=${encoded}`,
      signal: AbortSignal.timeout(10_000),
    });

    if (!res.ok) return [];

    const html = await res.text();
    return parseResults(html, maxResults);
  } catch {
    return [];
  }
}

// ── HTML parsing ─────────────────────────────────────────────────────────────

function stripTags(html: string): string {
  return html.replace(/<[^>]*>/g, '').replace(/&amp;/g, '&').replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#x27;/g, "'")
    .replace(/&nbsp;/g, ' ').replace(/&#\d+;/g, '').replace(/\s+/g, ' ').trim();
}

function parseResults(html: string, max: number): WebSearchResult[] {
  const results: WebSearchResult[] = [];

  // DuckDuckGo HTML wraps each result in a div with class "result" or "web-result"
  // Each result has:
  //   - <a class="result__a"> for title + URL
  //   - class="result__snippet" for snippet text (may be <a>, <span>, or <div>)
  const resultBlocks = html.split(/class="result\s/);

  for (let i = 1; i < resultBlocks.length && results.length < max; i++) {
    const block = resultBlocks[i];

    // Extract URL from result__a href
    const urlMatch = block.match(/class="result__a"[^>]*href="([^"]+)"/);
    if (!urlMatch) continue;

    let url = urlMatch[1];
    // DuckDuckGo wraps URLs in redirect: //duckduckgo.com/l/?uddg=<encoded_url>
    const uddgMatch = url.match(/uddg=([^&]+)/);
    if (uddgMatch) {
      url = decodeURIComponent(uddgMatch[1]);
    }

    // Skip DuckDuckGo internal links
    if (url.includes('duckduckgo.com') || !url.startsWith('http')) continue;

    // Extract title from result__a inner text
    const titleMatch = block.match(/class="result__a"[^>]*>([\s\S]*?)<\/a>/);
    const title = titleMatch ? stripTags(titleMatch[1]) : '';

    // Extract snippet — try multiple selectors (a, span, div with result__snippet)
    let snippet = '';
    const snippetMatchA = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
    const snippetMatchSpan = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/span>/);
    const snippetMatchDiv = block.match(/class="result__snippet"[^>]*>([\s\S]*?)<\/div>/);
    if (snippetMatchA) {
      snippet = stripTags(snippetMatchA[1]);
    } else if (snippetMatchSpan) {
      snippet = stripTags(snippetMatchSpan[1]);
    } else if (snippetMatchDiv) {
      snippet = stripTags(snippetMatchDiv[1]);
    }

    // Fallback: grab any text blob after the title link (first 300 chars)
    if (!snippet && title) {
      const afterTitle = block.split(/class="result__a"[\s\S]*?<\/a>/)[1] ?? '';
      const raw = stripTags(afterTitle).slice(0, 300);
      if (raw.length > 30) snippet = raw;
    }

    if (title && (snippet || url)) {
      results.push({ title, snippet, url });
    }
  }

  return results;
}
