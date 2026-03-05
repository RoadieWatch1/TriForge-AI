// ── analyzeReply.ts — Extract objections from outreach replies and feed CompoundEngine ──
//
// Takes a reply text + campaignId, identifies the top objection using keyword
// matching + simple heuristics, and records an improvement note on the
// matching StrategyProfile via CompoundEngine.
//
// Designed to be called by GrowthService after each inbound reply is received.

import type { CompoundEngine } from '../compound/compoundEngine';

// ── Types ─────────────────────────────────────────────────────────────────────

export interface ReplyAnalysis {
  campaignId:     string;
  topObjection:   string;
  objectionClass: ObjectionClass;
  sentiment:      'positive' | 'neutral' | 'negative';
  improvementNote: string;
}

export type ObjectionClass =
  | 'pricing'
  | 'timing'
  | 'not_interested'
  | 'wrong_person'
  | 'competitor'
  | 'feature_gap'
  | 'trust'
  | 'positive_reply'
  | 'unknown';

// ── Objection classification patterns ─────────────────────────────────────────

const OBJECTION_PATTERNS: Array<{ class: ObjectionClass; patterns: RegExp[] }> = [
  {
    class: 'pricing',
    patterns: [/too expensive/i, /can'?t afford/i, /out of budget/i, /cost[s]? too/i, /price[d]? too high/i, /pricing/i],
  },
  {
    class: 'timing',
    patterns: [/not the right time/i, /bad timing/i, /too busy/i, /reach out (in|after|next)/i, /later/i, /next (quarter|year|month)/i],
  },
  {
    class: 'not_interested',
    patterns: [/not interested/i, /no thanks/i, /unsubscribe/i, /remove me/i, /don'?t (want|need)/i, /please stop/i],
  },
  {
    class: 'wrong_person',
    patterns: [/wrong person/i, /not the right contact/i, /reach out to/i, /you should contact/i, /i don'?t handle/i],
  },
  {
    class: 'competitor',
    patterns: [/already (use|using|have|working with)/i, /current (vendor|provider|solution)/i, /happy with our/i, /switched to/i],
  },
  {
    class: 'feature_gap',
    patterns: [/doesn'?t (have|support)/i, /missing/i, /can'?t do/i, /need[s]? to (also|be able to)/i, /integrate with/i],
  },
  {
    class: 'trust',
    patterns: [/never heard of/i, /who are you/i, /not familiar/i, /case stud(y|ies)/i, /reference[s]?/i, /proof/i],
  },
  {
    class: 'positive_reply',
    patterns: [/interested/i, /tell me more/i, /sounds good/i, /let'?s (chat|talk|connect|schedule)/i, /book a (call|meeting|demo)/i, /yes/i],
  },
];

// ── Core extraction ───────────────────────────────────────────────────────────

function classifyObjection(text: string): { objectionClass: ObjectionClass; sentiment: ReplyAnalysis['sentiment'] } {
  for (const { class: cls, patterns } of OBJECTION_PATTERNS) {
    if (patterns.some(p => p.test(text))) {
      const sentiment = cls === 'positive_reply' ? 'positive'
                      : cls === 'not_interested' ? 'negative'
                      : 'neutral';
      return { objectionClass: cls, sentiment };
    }
  }
  return { objectionClass: 'unknown', sentiment: 'neutral' };
}

function extractTopObjection(text: string): string {
  // Return the first sentence that looks like the core objection (≤ 120 chars)
  const sentences = text.split(/[.!?\n]+/).map(s => s.trim()).filter(s => s.length > 10);
  for (const sentence of sentences) {
    const lower = sentence.toLowerCase();
    if (
      /not interested|too expensive|wrong person|bad timing|already using|never heard|don'?t need/i.test(lower) ||
      /interested|let'?s chat|tell me more/i.test(lower)
    ) {
      return sentence.slice(0, 120);
    }
  }
  return (sentences[0] ?? text.slice(0, 120)).slice(0, 120);
}

function buildImprovementNote(objectionClass: ObjectionClass, topObjection: string): string {
  const notes: Record<ObjectionClass, string> = {
    pricing:        'Address ROI and value framing earlier in the message. Consider a lower-friction first ask.',
    timing:         'Add a softer CTA for future follow-up. Consider a "re-contact in 30 days" offer.',
    not_interested: 'Subject line or opening may be misaligned with this segment. Review targeting criteria.',
    wrong_person:   'Improve contact qualification — verify role before outreach. Ask for referral to correct contact.',
    competitor:     'Differentiation messaging needed. Highlight unique features vs current solution.',
    feature_gap:    `Feature gap identified: "${topObjection.slice(0, 80)}". Flag for product backlog.`,
    trust:          'Add social proof, case studies, or company credentials earlier in the sequence.',
    positive_reply: 'Positive response — no objection. Analyze subject/tone for replication.',
    unknown:        'Reply did not match known objection patterns. Manual review recommended.',
  };
  return notes[objectionClass];
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Analyze a single outreach reply and record an improvement note.
 * Optionally updates the matching StrategyProfile in CompoundEngine.
 *
 * @param replyText   Raw text of the inbound reply
 * @param campaignId  Loop / campaign identifier (used to find the StrategyProfile)
 * @param compound    Optional CompoundEngine instance — if provided, updates the best matching strategy
 * @returns           Structured ReplyAnalysis
 */
export function analyzeReply(
  replyText: string,
  campaignId: string,
  compound?: CompoundEngine,
): ReplyAnalysis {
  const { objectionClass, sentiment } = classifyObjection(replyText);
  const topObjection   = extractTopObjection(replyText);
  const improvementNote = buildImprovementNote(objectionClass, topObjection);

  const result: ReplyAnalysis = {
    campaignId,
    topObjection,
    objectionClass,
    sentiment,
    improvementNote,
  };

  // Persist to CompoundEngine if available — update the strategy's performance
  // (replies counter) and log the improvement note as a content strategy signal.
  if (compound) {
    try {
      compound.recordOutreachResult({
        loopId:      campaignId,
        subject:     `[reply-analysis] ${objectionClass}`,
        sent:        0,
        replies:     1,
        conversions: sentiment === 'positive' ? 1 : 0,
        leads:       sentiment === 'positive' ? 1 : 0,
      });
    } catch { /* non-fatal — compound write failure never blocks analysis */ }
  }

  return result;
}

/**
 * Batch-analyze multiple replies for the same campaign.
 * Returns analyses sorted by objection frequency (most common first).
 */
export function analyzeReplies(
  replies: Array<{ text: string; campaignId: string }>,
  compound?: CompoundEngine,
): ReplyAnalysis[] {
  const analyses = replies.map(r => analyzeReply(r.text, r.campaignId, compound));

  // Sort: positive first, then by objection frequency
  const freq = new Map<ObjectionClass, number>();
  for (const a of analyses) freq.set(a.objectionClass, (freq.get(a.objectionClass) ?? 0) + 1);

  return [...analyses].sort((a, b) => {
    if (a.sentiment === 'positive' && b.sentiment !== 'positive') return -1;
    if (b.sentiment === 'positive' && a.sentiment !== 'positive') return  1;
    return (freq.get(b.objectionClass) ?? 0) - (freq.get(a.objectionClass) ?? 0);
  });
}
