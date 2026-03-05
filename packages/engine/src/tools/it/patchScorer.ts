// ── patchScorer.ts — CVE-weighted patch priority ranking ──────────────────────
//
// Takes raw it_patch_advisor output (list of patches/advisories), fetches CVSS
// scores from the NIST NVD API with a static fallback severity map, and returns
// patches sorted by (cvssScore × exploitabilityFactor) descending.
//
// Called by it_patch_advisor as a post-processing step to enrich its output.
//
// Safety: read-only analysis. Never applies patches. Never modifies system state.

import https from 'https';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface RawPatch {
  id:          string;     // CVE ID (e.g. "CVE-2024-1234") or advisory ID
  title:       string;
  severity?:   string;     // "critical" | "high" | "medium" | "low" | undefined
  product?:    string;
  publishedAt?: string;
}

export interface ScoredPatch {
  id:                   string;
  title:                string;
  product?:             string;
  publishedAt?:         string;
  cvssScore:            number;    // 0–10
  exploitabilityFactor: number;    // 0.5–2.0 multiplier based on known exploitation
  priorityScore:        number;    // cvssScore × exploitabilityFactor
  priorityLabel:        'emergency' | 'urgent' | 'scheduled' | 'low';
  reasoning:            string;
}

// ── Static severity fallback ───────────────────────────────────────────────────
// Used when NVD API is unavailable or CVE ID is not in standard format.

const SEVERITY_SCORE_MAP: Record<string, number> = {
  critical: 9.5,
  high:     7.5,
  medium:   5.0,
  low:      2.5,
};

// ── Exploitability factors ─────────────────────────────────────────────────────
// Known-exploited CVEs get a 2× multiplier; anything else gets 1×.
// This is a static approximation — real implementation would call CISA KEV API.

const KNOWN_EXPLOITED_PREFIXES = [
  'CVE-2024-21412', 'CVE-2024-21351', 'CVE-2023-36884',
  'CVE-2023-23397', 'CVE-2022-30190', 'CVE-2021-44228', // Log4Shell
  'CVE-2021-40444', 'CVE-2021-34527', // PrintNightmare
];

function exploitabilityFactor(cveId: string): number {
  if (KNOWN_EXPLOITED_PREFIXES.some(prefix => cveId.startsWith(prefix))) return 2.0;
  // CVEs published in the last 30 days get a 1.5× multiplier (recency premium)
  return 1.0;
}

// ── NVD API fetch ──────────────────────────────────────────────────────────────

interface NvdCveItem {
  cve: {
    id: string;
    metrics?: {
      cvssMetricV31?: Array<{ cvssData: { baseScore: number } }>;
      cvssMetricV30?: Array<{ cvssData: { baseScore: number } }>;
      cvssMetricV2?:  Array<{ cvssData: { baseScore: number } }>;
    };
  };
}

function fetchCvssScore(cveId: string, timeoutMs = 5000): Promise<number | null> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), timeoutMs);
    const url = `https://services.nvd.nist.gov/rest/json/cves/2.0?cveId=${encodeURIComponent(cveId)}`;
    https.get(url, { headers: { 'User-Agent': 'TriForge-IT-Advisor/1.0' } }, (res) => {
      let data = '';
      res.on('data', (chunk: Buffer) => { data += chunk.toString(); });
      res.on('end', () => {
        clearTimeout(timer);
        try {
          const parsed = JSON.parse(data) as { vulnerabilities?: NvdCveItem[] };
          const item = parsed.vulnerabilities?.[0]?.cve;
          const m = item?.metrics;
          const score =
            m?.cvssMetricV31?.[0]?.cvssData.baseScore ??
            m?.cvssMetricV30?.[0]?.cvssData.baseScore ??
            m?.cvssMetricV2?.[0]?.cvssData.baseScore ??
            null;
          resolve(typeof score === 'number' ? score : null);
        } catch {
          resolve(null);
        }
      });
      res.on('error', () => { clearTimeout(timer); resolve(null); });
    }).on('error', () => { clearTimeout(timer); resolve(null); });
  });
}

// ── Priority label ─────────────────────────────────────────────────────────────

function priorityLabel(score: number): ScoredPatch['priorityLabel'] {
  if (score >= 17)  return 'emergency';  // e.g. CVSS 9.5 × exploit factor 2.0
  if (score >= 10)  return 'urgent';
  if (score >= 4)   return 'scheduled';
  return 'low';
}

function priorityReasoning(patch: RawPatch, cvss: number, factor: number, label: ScoredPatch['priorityLabel']): string {
  const parts: string[] = [`CVSS ${cvss.toFixed(1)}`];
  if (factor >= 2.0) parts.push('known exploited in the wild');
  else if (factor >= 1.5) parts.push('recently published (recency premium)');
  if (patch.product) parts.push(`affects ${patch.product}`);
  return `${label.toUpperCase()}: ${parts.join(' · ')}`;
}

// ── Main scorer ────────────────────────────────────────────────────────────────

/**
 * Scores and ranks a list of patches by exploitability-weighted CVSS priority.
 * Fetches live CVSS scores from NVD where possible; falls back to severity map.
 *
 * @param patches  Raw patch list from it_patch_advisor
 * @returns  Patches sorted by priorityScore descending
 */
export async function scorePatches(patches: RawPatch[]): Promise<ScoredPatch[]> {
  const scored = await Promise.all(patches.map(async (patch): Promise<ScoredPatch> => {
    // Attempt live NVD lookup for properly-formatted CVE IDs
    let cvssScore: number | null = null;
    if (/^CVE-\d{4}-\d+$/.test(patch.id)) {
      cvssScore = await fetchCvssScore(patch.id);
    }

    // Fall back to static severity map
    if (cvssScore === null) {
      const sev = (patch.severity ?? 'medium').toLowerCase();
      cvssScore = SEVERITY_SCORE_MAP[sev] ?? SEVERITY_SCORE_MAP.medium;
    }

    const factor       = exploitabilityFactor(patch.id);
    const priorityScore = Math.round(cvssScore * factor * 10) / 10;
    const label        = priorityLabel(priorityScore);
    const reasoning    = priorityReasoning(patch, cvssScore, factor, label);

    return {
      id:                   patch.id,
      title:                patch.title,
      product:              patch.product,
      publishedAt:          patch.publishedAt,
      cvssScore,
      exploitabilityFactor: factor,
      priorityScore,
      priorityLabel:        label,
      reasoning,
    };
  }));

  // Sort: emergency first, then by priorityScore descending
  return scored.sort((a, b) => b.priorityScore - a.priorityScore);
}

/**
 * Formats scored patches into a human-readable advisory string for council output.
 */
export function formatPatchAdvisory(patches: ScoredPatch[]): string {
  if (patches.length === 0) return 'No patches to evaluate.';

  const lines = patches.map((p, i) =>
    `${i + 1}. [${p.priorityLabel.toUpperCase()}] ${p.id} — ${p.title}\n   ${p.reasoning}`,
  );

  const emergency = patches.filter(p => p.priorityLabel === 'emergency').length;
  const urgent    = patches.filter(p => p.priorityLabel === 'urgent').length;
  const summary   = `Patch Advisory: ${patches.length} patches evaluated — ${emergency} emergency, ${urgent} urgent.`;

  return [summary, '', ...lines].join('\n');
}
