// panelMessages.ts — Inbound command and outbound message type string constants.
// No logic — import from here to avoid scattered string literals.

// ── Inbound commands (webview → extension) ────────────────────────────────

export const CMD = {
  // Council pipeline
  COUNCIL_RUN:              'council:run',
  COUNCIL_APPLY:            'council:apply',
  COUNCIL_EXPORT:           'council:export',
  COUNCIL_APPLY_DRAFT:      'council:applyDraft',
  COUNCIL_ESCALATE:         'council:escalate',
  COUNCIL_REQUEST_ALT:      'council:requestAlt',
  COUNCIL_RUN_VOTE_ON_ALT:  'council:runVoteOnAlt',
  COUNCIL_ADOPT_ALT:        'council:adoptAlt',
  COUNCIL_ABORT:            'council:abort',
  COUNCIL_SET_INTENSITY:    'council:setIntensity',
  COUNCIL_SELECT_VERSION:   'council:selectVersion',
  COUNCIL_OVERRIDE_APPLY:   'council:override:apply',
  DEADLOCK_ESCALATE:        'council:deadlock:escalate',
  DEADLOCK_SYNTHESIS:       'council:deadlock:synthesis',
  DEADLOCK_EXTENDED:        'council:deadlock:extended',
  DEADLOCK_USER:            'council:deadlock:user',

  // Review runtime
  REVIEW_RUN:               'review:run',
  REVIEW_GET_LATEST:        'review:getLatest',

  // Provider / API keys
  SET_API_KEY:              'setApiKey',
  REMOVE_API_KEY:           'removeApiKey',
  GET_PROVIDERS:            'getProviders',

  // Workspace context
  WORKSPACE_ADD_CONTEXT:    'workspace:addContext',
  WORKSPACE_REMOVE_CONTEXT: 'workspace:removeContext',
  WORKSPACE_CLEAR_CONTEXT:  'workspace:clearContext',
  WORKSPACE_GET_TREE:       'workspace:getTree',

  // Git
  GIT_STATUS:               'git:status',
  GIT_STAGE_ALL:            'git:stageAll',
  GIT_STAGE:                'git:stage',
  GIT_UNSTAGE:              'git:unstage',
  GIT_UNSTAGE_ALL:          'git:unstageAll',
  GIT_COMMIT:               'git:commit',
  GIT_PUSH:                 'git:push',
  GIT_GENERATE_MESSAGE:     'git:generateMessage',
  GIT_BRANCHES:             'git:branches',
  GIT_DIFF:                 'git:diff',
  GIT_LOG:                  'git:log',
  GIT_CREATE_BRANCH:        'git:createBranch',
  GIT_SWITCH_BRANCH:        'git:switchBranch',

  // Config
  CONFIG_GET_MODELS:        'config:getModels',
  CONFIG_SET_MODEL:         'config:setModel',

  // License
  LICENSE_GET_STATUS:       'license:getStatus',
  LICENSE_ACTIVATE:         'license:activate',
  LICENSE_DEACTIVATE:       'license:deactivate',

  // Workflow
  WORKFLOW_APPROVE_PLAN:    'workflow:approvePlan',
  WORKFLOW_REJECT_PLAN:     'workflow:rejectPlan',
  WORKFLOW_NARROW_PLAN:     'workflow:narrowPlan',
  WORKFLOW_APPROVE_COMMIT:  'workflow:approveCommit',
  WORKFLOW_REJECT_COMMIT:   'workflow:rejectCommit',
  WORKFLOW_APPROVE_PUSH:    'workflow:approvePush',
  WORKFLOW_REJECT_PUSH:     'workflow:rejectPush',
  WORKFLOW_ABORT:           'workflow:abort',
  WORKFLOW_SET_MODE:        'workflow:setMode',

  // Misc
  OPEN_EXTERNAL:            'openExternal',
} as const;

// ── Outbound message types (extension → webview) ─────────────────────────

export const MSG = {
  // Provider / session init
  PROVIDERS:                'providers',
  LICENSE_STATUS:           'license-status',
  LICENSE_ACTIVATING:       'license-activating',
  LICENSE_ERROR:            'license-error',
  LICENSE_GATE:             'license-gate',
  INSERT_PROMPT:            'insert-prompt',

  // Council pipeline
  COUNCIL_STARTED:          'council-started',
  COUNCIL_MODE:             'council-mode',
  PHASE:                    'phase',
  DRAFT_READY:              'draft-ready',
  RISK_RESULT:              'risk-result',
  INTENSITY_RESOLVED:       'intensity-resolved',
  VERDICT:                  'verdict',
  DEADLOCK:                 'deadlock',
  DEBATE_COMPLETE:          'debate-complete',
  SESSION_COMPLETE:         'session-complete',
  ESCALATED:                'escalated',
  ALTERNATIVE_READY:        'alternative-ready',
  PROVIDER_OFFLINE:         'provider-offline',
  CRITICAL_OBJECTION:       'critical-objection',
  SYNTHESIS_READY:          'synthesis-ready',
  APPLY_DONE:               'apply-done',
  APPLY_CANCELLED:          'apply-cancelled',

  // Review runtime
  REVIEW_RUNTIME_STARTED:   'review-runtime-started',
  REVIEW_RUNTIME_RESULT:    'review-runtime-result',
  REVIEW_RUNTIME_ERROR:     'review-runtime-error',

  // Workspace
  CONTEXT_UPDATED:          'context-updated',

  // Config
  CONFIG_MODELS:            'config-models',
  CONFIG_MODEL_SAVED:       'config-model-saved',

  // Git
  GIT_STATUS:               'git-status',
  GIT_ERROR:                'git-error',
  GIT_COMMITTED:            'git-committed',
  GIT_PUSHED:               'git-pushed',
  GIT_GENERATING:           'git-generating',
  GIT_MESSAGE_READY:        'git-message-ready',
  GIT_BRANCHES:             'git-branches',
  GIT_DIFF:                 'git-diff',
  GIT_LOG:                  'git-log',
  WORKSPACE_TREE:           'workspace-tree',

  // Governed workflow
  WORKFLOW_STARTED:         'workflow-started',
  WORKFLOW_ERROR:           'workflow-error',
  WORKFLOW_PHASE:           'workflow-phase',
  WORKFLOW_STAGE:           'workflow-stage',
  WORKFLOW_REVIEW:          'workflow-review',
  WORKFLOW_PLAN_APPROVED:   'workflow-plan-approved',
  WORKFLOW_CODE_APPROVED:   'workflow-code-approved',
  WORKFLOW_SCOPE_DRIFT:     'workflow-scope-drift',
  WORKFLOW_CHECK:           'workflow-check',
  WORKFLOW_VERIFY_COMPLETE: 'workflow-verify-complete',
  WORKFLOW_GIT_GATE:        'workflow-git-gate',
  WORKFLOW_COMMITTED:       'workflow-committed',
  WORKFLOW_PUSHED:          'workflow-pushed',
  WORKFLOW_INPUT_REQUIRED:  'workflow-input-required',
  WORKFLOW_COMPLETE:        'workflow-complete',
  WORKFLOW_BLOCKED:         'workflow-blocked',

  // Generic
  ERROR:                    'error',
} as const;
