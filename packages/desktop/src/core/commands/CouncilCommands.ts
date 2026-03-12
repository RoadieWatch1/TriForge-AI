// ── CouncilCommands.ts — Central wake phrase registry ────────────────────────
//
// Keys use snake_case command names. Phrases are matched longest-first in matchCommand.ts.
// Order within each array matters — more specific phrases should come before shorter ones.

export const CouncilCommands: Record<string, string[]> = {
  council_assemble:   ['council assemble', 'assemble council', 'wake council',
                       'hey council', 'okay council', 'council listen', 'council help', 'council'],
  council_deliberate: ['council deliberate', 'council debate', 'start deliberation'],
  claude_advise:      ['claude advise', 'claude opinion'],
  grok_challenge:     ['grok challenge', 'grok counter'],
  apply_solution:     ['apply solution', 'apply decision'],
  mission_build:      ['triforge build'],
  mission_fix:        ['triforge fix'],
  mission_audit:      ['triforge audit'],
  mission_refactor:   ['triforge refactor'],
};
