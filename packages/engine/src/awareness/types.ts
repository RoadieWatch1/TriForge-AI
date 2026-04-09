// ── awareness/types.ts — Council Awareness Layer data contracts ───────────────
//
// Shared type definitions used by CapabilityRegistry, SystemStateService,
// and CouncilAwarenessService.

export type CapabilityRisk = 'safe' | 'moderate' | 'high' | 'restricted';

export type CapabilityCategory =
  | 'provider'
  | 'council'
  | 'image'
  | 'voice'
  | 'mission'
  | 'autonomy'
  | 'files'
  | 'phone'
  | 'memory'
  | 'forge'
  | 'tasks'
  | 'social'
  | 'insight'
  | 'trading'
  | 'operator';  // Section 8 — Desktop Operator Engine

/**
 * Static descriptor for a single Triforge capability.
 * Defined at build time in CapabilityRegistry.ts.
 */
export interface CapabilityDescriptor {
  /** Unique dotted identifier, e.g. "image.generate" */
  id: string;
  name: string;
  category: CapabilityCategory;
  description: string;
  tags: string[];
  riskLevel: CapabilityRisk;
  /** Whether this capability always requires explicit user approval before use */
  approvalRequired: boolean;
  /** Minimum subscription tier required. Absent = available on all tiers. */
  requiresTier?: 'pro' | 'business';
  /** How Council should invoke or surface this capability to the user */
  invocationHint?: string;
  /** Example user phrases that should trigger this capability */
  examples?: string[];
}

/**
 * Live operator substrate state — gathered per-turn when the desktop operator
 * getter is registered. Encodes the spec §9 desktopActionContext shape.
 */
export interface DesktopOperatorSnapshot {
  /** Whether the operator kill switch is on (true = actions can execute) */
  operatorEnabled: boolean;
  /** Whether the current platform has operator substrate support */
  platformSupported: boolean;
  /** Human-readable platform name, e.g. 'macOS', 'Windows' */
  platformName?: string;
  /** Action types that are currently executable (permissions satisfied) */
  availableCapabilities: string[];
  /** Action types blocked by missing OS permissions */
  missingCapabilities: string[];
  /** OS permissions that are currently granted (e.g. 'accessibility', 'screen_recording') */
  permissionsGranted: string[];
  /** OS permissions that are currently missing */
  permissionsMissing: string[];
  /** IDs of workflow packs available for this session */
  workflowsAvailable: string[];
  /** Action types that always require explicit user approval before execution */
  approvalRequiredFor: string[];

  // ── Phase 2 Step 3 additions: richer operator runtime signals ────────────

  /**
   * Current preflight readiness based on the last capability probe.
   *
   *   'ready'    — all required permissions satisfied for the current action type
   *   'degraded' — some capabilities unavailable but read-only actions still work
   *   'blocked'  — execution cannot proceed (revoked permission, invalid session, etc.)
   *   undefined  — not yet probed (first action since startup)
   */
  preflightReadiness?: 'ready' | 'degraded' | 'blocked';

  /**
   * Detected permission drift — a permission was granted earlier in this process
   * run but is no longer granted. Indicates the user manually revoked access.
   * Present only after at least one capability probe has completed.
   */
  permissionDrift?: {
    accessibilityRevoked:   boolean;
    screenRecordingRevoked: boolean;
  };

  /**
   * Whether the active operator session is valid (active + not stale).
   * False = session is stopped, stale, or missing — input actions will fail.
   * undefined = session validity not yet assessed.
   */
  sessionValid?: boolean;

  // ── B3: Live operator-run telemetry ──────────────────────────────────────
  //
  // When an operator task is mid-flight, these fields surface the most recent
  // step state to the council so it can react to in-progress runs (e.g. advise
  // on a stuck step, propose a different approach mid-workflow). Stale values
  // (older than ~2 minutes) should be cleared by the producer.

  /**
   * The currently-running operator task summary, if any. undefined when no
   * task is in flight or the most recent task has finished.
   */
  liveRun?: {
    /** Task session id (matches OperatorService session id) */
    sessionId: string;
    /** Goal text the task was started with */
    goal: string;
    /** Current step number (1-indexed) */
    currentStep: number;
    /** Maximum allowed steps for this run */
    maxSteps: number;
    /** Phase of the most recent step emit */
    phase: 'observe' | 'plan' | 'act' | 'verify' | 'done' | 'blocked' | 'error' | 'continuation_prompt';
    /** Description of the most recent action / observation */
    lastDescription: string;
    /** Action type of the most recent planned action, if any */
    lastActionType?: 'click' | 'type' | 'key' | 'focus' | 'wait' | 'done' | 'blocked';
    /** Whether the most recent verification passed */
    lastVerifyPassed?: boolean;
    /** Last verify failure message (if any) — populated when verification failed */
    lastVerifyError?: string;
    /** How many consecutive verify failures the run has logged */
    consecutiveVerifyFailures: number;
    /** How many consecutive "wait" actions the planner has output — non-zero means the operator may be stuck */
    consecutiveWaits: number;
    /** Wall-clock time of the most recent emit */
    lastEmitAt: number;
  };
}

/**
 * Live runtime snapshot gathered before each Council turn.
 * Reflects the actual state of the running app — not cached assumptions.
 */
export interface SystemStateSnapshot {
  timestamp: number;
  tier: 'free' | 'pro' | 'business';
  activeProfileId: string | null;
  activeMissionId: string | null;
  autonomyRunning: boolean;
  autonomyWorkflowCount: number;
  providers: {
    openai: boolean;
    claude: boolean;
    grok: boolean;
    ollama: boolean;
  };
  /** At least one image-capable provider key is present (OpenAI or Grok) */
  imageReady: boolean;
  voiceAuthConfigured: boolean;
  phonePaired: boolean;
  pendingApprovals: number;
  pendingTasks: number;
  mailConfigured: boolean;
  twitterConfigured: boolean;
  permissions: {
    files: boolean;
    browser: boolean;
    printer: boolean;
    email: boolean;
  };
  /** Tradovate broker is connected and live data is flowing */
  tradingConnected: boolean;
  /** Current shadow trading operation mode */
  tradingMode: 'off' | 'shadow' | 'paper' | 'guarded_live_candidate';
  /**
   * Live desktop operator state. Present when the operator getter is registered
   * in the desktop process. Absent in engine-only / test contexts.
   */
  desktopOperator?: DesktopOperatorSnapshot;
  /**
   * Live Unreal Engine domain awareness. Present when the Unreal getter is
   * registered in the desktop process (macOS only, best-effort).
   */
  unrealState?: UnrealAwarenessSnapshot;
}

/**
 * Unreal Engine domain awareness snapshot.
 *
 * Produced by the desktop unrealAwareness service. Represents what TriForge can
 * currently determine about the Unreal editor / project state — honestly and at
 * the right confidence level.
 *
 * This is NOT execution state. It is detection state only.
 */
export interface UnrealAwarenessSnapshot {
  /** Whether Unreal Engine appears to be installed. undefined = inconclusive. */
  installed?: boolean;
  /** Whether any Unreal Editor process is currently running. */
  running: boolean;
  /** Whether Unreal Editor is currently the frontmost (active) app. */
  frontmost?: boolean;
  /** The exact process name detected (e.g. 'UnrealEditor', 'UE4Editor'). */
  editorProcessName?: string;
  /** Whether a specific Unreal project has been identified. */
  projectDetected: boolean;
  /** Project name (from process args or window title). */
  projectName?: string;
  /** Absolute path to the .uproject file (only set at 'high' confidence). */
  projectPath?: string;
  /**
   * Confidence in the project identification.
   *   'high'    — found from process command-line args (.uproject path explicit)
   *   'medium'  — inferred from window title
   *   'low'     — heuristic guess only
   *   'unknown' — project not identified
   */
  projectConfidence?: 'high' | 'medium' | 'low' | 'unknown';
  /** Path to the most recently modified Unreal log file (if found). */
  recentLogPath?: string;
  /**
   * Current build / packaging state based on recent log content.
   * 'unknown' = log not available or not parseable.
   */
  buildState?: 'idle' | 'building' | 'packaging' | 'unknown';
  /** Brief error hint if an obvious crash or fatal error is in the recent log. */
  obviousErrorState?: string;
}

/**
 * Final product of CouncilAwarenessService — injected into every Council turn.
 */
export interface CouncilAwarenessPack {
  /** Compact human-readable text (< 500 tokens) for LLM context injection */
  addendum: string;
  /** Raw snapshot — available to routing logic without re-querying */
  snapshot: SystemStateSnapshot;
}
