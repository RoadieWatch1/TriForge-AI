// ── VoiceIntentRouter.ts — Maps spoken transcripts to QueuedMission intents ──
//
// Single place where voice phrases are translated into autonomy missions.
// Called from Chat.tsx HandsFreeVoice.onTranscript AFTER built-in commands
// (e.g. "open up desktop") have been handled.
//
// Returns true if the phrase was routed (caller should skip normal chat send).
// Returns false if no intent matched (caller proceeds with normal chat flow).

import { missionQueue }  from '../../core/autonomy/MissionQueue';
import { policyGate }    from '../../core/autonomy/PolicyGate';
import { missionLedger } from '../../core/autonomy/MissionLedger';
import { QueuedMission, MissionPriority, MissionSource } from '../../core/autonomy/MissionTypes';

// ── Intent map ──────────────────────────────────────────────────────────────

interface IntentRule {
  /** Substring or phrase to match (lowercase). */
  match:    string | RegExp;
  intent:   string;
  priority: MissionPriority;
  /** Optional structured payload extracted from transcript. */
  payload?: (transcript: string) => Record<string, string>;
}

const INTENT_RULES: IntentRule[] = [
  // Dev
  { match: /fix.*build|build.*fail/,              intent: 'dev.fix_build',        priority: 'high'   },
  { match: /update.*dep|upgrade.*dep|npm.*update/, intent: 'dev.update_deps',      priority: 'normal' },
  { match: /run.*test|run.*spec/,                  intent: 'dev.run_tests',        priority: 'normal' },
  { match: /lint.*fix|fix.*lint/,                  intent: 'dev.lint_fix',         priority: 'normal' },
  { match: /deploy|push.*prod|release/,            intent: 'dev.deploy',           priority: 'urgent' },
  { match: /commit.*change|save.*commit/,          intent: 'dev.commit',           priority: 'high'   },

  // Research / scan
  { match: /scan.*code|review.*code|audit.*code/,  intent: 'scan.code_review',     priority: 'normal' },
  { match: /find.*bug|detect.*bug|check.*error/,   intent: 'scan.find_bugs',       priority: 'high'   },
  { match: /summarize.*repo|explain.*project/,     intent: 'scan.summarize_repo',  priority: 'low'    },

  // UI / navigation
  { match: 'open settings',                        intent: 'ui.open_settings',     priority: 'normal' },
  { match: 'open profiles',                        intent: 'ui.open_profiles',     priority: 'normal' },
  { match: 'open missions',                        intent: 'ui.open_missions',     priority: 'normal' },
  { match: 'show ledger',                          intent: 'ui.show_ledger',       priority: 'normal' },

  // Media / comms
  { match: /send.*email|email.*team/,              intent: 'comms.send_email',     priority: 'high'   },
  { match: /post.*slack|message.*channel/,         intent: 'comms.slack_post',     priority: 'high'   },
];

// ── VoiceIntentRouter ────────────────────────────────────────────────────────

class VoiceIntentRouter {

  /**
   * Attempt to route a voice transcript to an autonomy mission.
   * @returns true if matched (caller should not send to normal chat)
   *          false if no match (caller proceeds with normal chat)
   */
  route(transcript: string, source: MissionSource = 'voice'): boolean {
    const lower = transcript.toLowerCase().trim();
    if (!lower) return false;

    const rule = this._matchRule(lower);
    if (!rule) return false;

    const policy = policyGate.classify(rule.intent);

    const mission: Omit<QueuedMission, 'id' | 'createdAt' | 'status'> = {
      source,
      intent:           rule.intent,
      raw:              transcript,
      priority:         rule.priority,
      requiresApproval: policy.requiresApproval,
      payload:          rule.payload ? rule.payload(lower) : undefined,
    };

    const queued = missionQueue.enqueue(mission);

    missionLedger.record({
      missionId: queued.id,
      event:     'mission_created',
      intent:    rule.intent,
      source,
      detail:    `risk=${policy.riskLevel} approval=${policy.requiresApproval} raw="${transcript}"`,
    });

    if (policy.requiresApproval) {
      missionLedger.record({
        missionId: queued.id,
        event:     'approval_requested',
        intent:    rule.intent,
        source,
        detail:    policy.reason,
      });
    }

    // Dispatch UI event so approval panel / sidebar can react.
    window.dispatchEvent(new CustomEvent('triforge:mission-queued', {
      detail: { id: queued.id, intent: rule.intent, requiresApproval: policy.requiresApproval, raw: transcript },
    }));

    return true;
  }

  // ── Private ─────────────────────────────────────────────────────────────────

  private _matchRule(lower: string): IntentRule | null {
    for (const rule of INTENT_RULES) {
      if (typeof rule.match === 'string') {
        if (lower.includes(rule.match)) return rule;
      } else {
        if (rule.match.test(lower)) return rule;
      }
    }
    return null;
  }
}

/** Singleton — import and call route() from Chat.tsx or any voice handler. */
export const voiceIntentRouter = new VoiceIntentRouter();
