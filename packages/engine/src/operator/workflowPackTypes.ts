// ── operator/workflowPackTypes.ts ─────────────────────────────────────────────
//
// Section 9 — Workflow Packs: Type System
//
// Defines the contracts for all workflow pack definitions, readiness evaluation,
// and run-time state tracking.
//
// Design principles:
//   - Readiness is explicitly modeled — every pack knows what it needs
//   - Every blocker has a remediation hint
//   - Approval points are first-class, not optional
//   - Runs are serializable for audit and session visibility
//   - No invented capabilities — only what Section 8 truly built

import type { OperatorPlatform, OperatorActionType } from './operatorTypes';

// ── Workflow categories ───────────────────────────────────────────────────────

export type WorkflowCategory =
  | 'perception'    // read-only observation: screenshot, context capture
  | 'input'         // supervised keyboard/shortcut delivery
  | 'diagnostic'    // readiness and environment checks
  | 'handoff';      // prepare context and hand off to human or next step

// ── Requirements ─────────────────────────────────────────────────────────────

export interface WorkflowPermissions {
  /** macOS Accessibility (System Settings → Privacy & Security) */
  accessibility?: boolean;
  /** macOS Screen Recording (System Settings → Privacy & Security) */
  screenRecording?: boolean;
}

/**
 * What a workflow pack requires to run.
 * Evaluated at runtime via workflowReadiness.ts.
 */
export interface WorkflowRequirements {
  /** Which platforms support this pack. Empty = no platform support. */
  platforms: OperatorPlatform[];
  /** Which operator capabilities are needed (from Section 8) */
  capabilities: OperatorActionType[];
  /** OS-level permissions required */
  permissions: WorkflowPermissions;
  /**
   * Named app that must be running for this workflow to make sense.
   * null = any app / not app-specific.
   */
  targetApp: string | null;
  /** Whether an AI provider must be connected */
  providerRequired: boolean;
}

// ── Phases ────────────────────────────────────────────────────────────────────

export type PhaseActionKind =
  | 'list_apps'              // get running app list
  | 'get_frontmost'          // read current active app
  | 'focus_app'              // bring target to foreground
  | 'screenshot'             // capture screen to file
  | 'queue_input'            // queue type_text or send_key (triggers approval gate)
  | 'execute_approved'       // execute a previously approved input action
  | 'readiness_check'        // evaluate capability/permission/platform readiness
  | 'unreal_bootstrap_check' // evaluate Unreal Engine state using the awareness snapshot
  | 'unreal_build_check'     // validate engine tools + project path before build execution
  | 'unreal_build_execute'   // launch a real Unreal build/package subprocess
  | 'unreal_triage_analyze'   // analyze Unreal log output for failure classification
  | 'unreal_scaffold_generate'// generate a structured prototype system scaffold plan
  | 'unreal_milestone_plan'   // group scaffold items into ordered execution milestones
  | 'unreal_m1_execute'       // write M1 implementation artifacts to the project directory
  | 'unreal_m2_execute'       // write M2 primary-loop / health / HUD artifacts to the project
  | 'unreal_rc_probe'         // probe the Unreal Remote Control HTTP endpoint for availability
  | 'unreal_m3_execute'       // write M3 supporting-systems artifacts to the project directory
  | 'unreal_m4_execute'       // write M4 enemy/combat milestone artifacts to the project directory
  | 'unreal_m5_execute'       // write M5 progression/save-system artifacts to the project directory
  | 'unreal_full_chain'      // end-to-end: bootstrap→AI scaffold→milestones→M1-M5 files→compile
  // ── Unreal Editor UI Operations ──────────────────────────────────────────────
  | 'unreal_editor_status'    // snapshot: is editor running, is it frontmost?
  | 'unreal_editor_focus'     // bring Unreal Editor window to front
  | 'unreal_editor_compile'   // vision-locate + click Compile button, then wait for result
  | 'unreal_editor_play'      // vision-locate + click Play In Editor button
  | 'unreal_editor_open_bp'   // Quick-Open a Blueprint class by name (Ctrl+P flow)
  | 'unreal_editor_content_browser' // vision-locate + click Content Browser tab
  // ── Phase 2: Visual + App-specific ──────────────────────────────────────────
  | 'perceive_with_ocr'       // screenshot + OCR + frontmost — the visual feedback loop observe step
  | 'queue_click_at'          // queue a click_at action at pixel coordinates (approval-gated)
  | 'vision_plan_act'         // screenshot → Claude Vision plans one action → approval-gated execute
  | 'app_awareness_check'     // run the generic app registry detection scan
  | 'adobe_extendscript'      // run an ExtendScript snippet inside an Adobe CC app
  | 'blender_python'          // run a Python script inside Blender's embedded interpreter
  | 'app_applescript'         // run an AppleScript against any macOS app
  | 'adb_command'             // run an ADB command against a connected Android device
  | 'xcodebuild'              // run an xcodebuild command against an Xcode project
  // ── Phase 3: iOS ────────────────────────────────────────────────────────────
  | 'ios_awareness_check'    // scan simulators + real devices (simctl + devicectl)
  | 'ios_simctl'             // run an arbitrary xcrun simctl command
  | 'ios_devicectl'          // run an arbitrary xcrun devicectl command
  | 'ios_build_simulator'    // xcodebuild + simctl install + launch on a simulator
  | 'ios_build_device'       // xcodebuild for a real device (device install via ios_devicectl)
  | 'ios_simulator_screenshot' // capture simulator screen via simctl io screenshot
  // ── Phase 3: Android ─────────────────────────────────────────────────────────
  | 'android_awareness_check' // scan ADB devices + AVDs + Gradle project
  | 'android_gradle_build'    // run ./gradlew assembleDebug to produce a debug APK
  | 'android_install_launch'  // adb install + am start (or monkey) to install and launch
  | 'android_screenshot'      // adb exec-out screencap -p → PNG + optional OCR
  | 'android_input'           // adb shell input tap/swipe/text/keyevent (approval-gated)
  | 'android_launch_avd'      // launch a named AVD via the emulator binary
  // ── Phase 5: Social Media Publishing ──────────────────────────────────────
  | 'social_auth'             // check/initiate OAuth for a social platform
  | 'social_select_file'      // validate/confirm local file path for upload
  | 'social_upload_youtube'   // upload video to YouTube (resumable)
  | 'social_upload_facebook'  // post photo/video to Facebook Page
  | 'social_upload_instagram' // post image/reel to Instagram Business account
  | 'social_upload_tiktok'    // upload video to TikTok
  // ── Vision Model ────────────────────────────────────────────────────────────
  | 'vision_describe'         // send screenshot to Claude vision — describe screen
  | 'vision_locate'           // ask Claude vision to find element coordinates
  | 'vision_ask'              // freeform question about the current screenshot
  | 'vision_verify'           // vision check after an action to confirm result
  // ── On-Screen Keyboard ───────────────────────────────────────────────────────
  | 'osk_status'              // check if on-screen keyboard is running
  | 'osk_open'                // open/enable the OS on-screen keyboard
  | 'osk_close'               // close the on-screen keyboard
  | 'osk_vision_locate'       // vision-locate the OSK bounds on screen
  | 'osk_type'                // type text by clicking keys on the OSK
  // ── Screen Watcher ───────────────────────────────────────────────────────────
  | 'screen_watch_start'      // start the background screen change monitor
  | 'screen_watch_stop'       // stop the screen change monitor
  | 'screen_watch_check'      // one-shot: did screen change since last action?
  | 'report';                 // assemble and return the workflow artifact

export interface WorkflowPhase {
  id: string;
  name: string;
  description: string;
  /** The kind of action this phase performs */
  kind: PhaseActionKind;
  /**
   * If true, execution suspends here waiting for human approval.
   * The approval is surfaced via the operator approval queue.
   */
  requiresApproval: boolean;
  /** Plain-English description shown in the approval request */
  approvalDescription?: string;
  /**
   * What happens if this phase fails or is blocked.
   * stop           = abort the run immediately
   * warn_continue  = record a warning, keep going
   * ask_user       = surface a blocker and wait
   */
  onFailure: 'stop' | 'warn_continue' | 'ask_user';
  /** Whether this phase can be skipped if prerequisites are missing */
  optional?: boolean;
}

// ── Workflow Pack ─────────────────────────────────────────────────────────────

/**
 * A named, structured workflow that uses the Section 8 operator substrate.
 */
export interface WorkflowPack {
  /** Unique identifier, e.g. "pack.focus-capture" */
  id: string;
  name: string;
  description: string;
  /** One-line summary shown in the Operate UI */
  tagline: string;
  category: WorkflowCategory;
  version: string;
  requirements: WorkflowRequirements;
  phases: WorkflowPhase[];
  tags: string[];
  /** Estimated wall-clock duration in seconds (best-effort) */
  estimatedDurationSec?: number;
  /** Plain-English statement of what "success" means for this workflow */
  successCriteria: string;
}

// ── Readiness ─────────────────────────────────────────────────────────────────

export type WorkflowBlockerType =
  | 'platform_unsupported'
  | 'permission_missing'
  | 'capability_unavailable'
  | 'app_not_running'
  | 'provider_missing';

export interface WorkflowBlocker {
  type: WorkflowBlockerType;
  message: string;
  /** What the user should do to resolve this blocker */
  remediation: string;
}

/**
 * Result of evaluating whether a workflow pack can run right now.
 */
export interface WorkflowReadinessResult {
  packId: string;
  /** True only if there are zero blockers */
  ready: boolean;
  blockers: WorkflowBlocker[];
  /** Non-blocking notes (e.g. "optional screenshot step will be skipped") */
  warnings: string[];
  platformSupported: boolean;
  permissionsOk: boolean;
  capabilitiesOk: boolean;
  targetAppAvailable: boolean | null;  // null = not required
}

// ── Run state ─────────────────────────────────────────────────────────────────

export type WorkflowRunStatus =
  | 'running'
  | 'awaiting_approval'  // paused at an approval phase
  | 'completed'
  | 'failed'
  | 'stopped';

export interface WorkflowPhaseResult {
  phaseId: string;
  phaseName: string;
  status: 'completed' | 'skipped' | 'failed' | 'awaiting_approval';
  startedAt: number;
  completedAt?: number;
  /** Key outputs from this phase (e.g. screenshotPath, appName) */
  outputs: Record<string, unknown>;
  error?: string;
  warning?: string;
}

/**
 * A workflow artifact captures the key output of a completed workflow run.
 * It is stored on the run record and available for review in Sessions.
 */
export interface WorkflowArtifact {
  type: 'perception_snapshot' | 'context_report' | 'input_delivery' | 'readiness_report' | 'unreal_readiness_report' | 'unreal_build_report' | 'unreal_triage_report' | 'unreal_scaffold_report' | 'unreal_milestone_report' | 'unreal_m1_execution_report' | 'unreal_m2_execution_report' | 'unreal_rc_probe_report' | 'unreal_m3_execution_report' | 'unreal_m4_execution_report' | 'unreal_m5_execution_report' | 'android_scan_report' | 'android_build_report' | 'android_screenshot_report' | 'android_input_report' | 'android_avd_report' | 'social_publish_report' | 'vision_report' | 'osk_report' | 'screen_watch_report';
  capturedAt: number;
  data: Record<string, unknown>;
}

/**
 * Runtime state for a single workflow execution.
 */
export interface WorkflowRun {
  id: string;
  packId: string;
  packName: string;
  /** The operator session backing this run */
  sessionId: string;
  /** Target app passed by the caller (may be null for non-app-specific packs) */
  targetApp: string | null;
  /** Plain-language goal for this run, used by script-generating phases */
  goal?: string;
  startedAt: number;
  endedAt?: number;
  status: WorkflowRunStatus;
  currentPhaseIndex: number;
  phaseResults: WorkflowPhaseResult[];
  /**
   * If status is 'awaiting_approval', this is the operator approval ID
   * the run is blocked on.
   */
  pendingApprovalId?: string;
  artifact?: WorkflowArtifact;
  error?: string;
}

// ── Execution options ─────────────────────────────────────────────────────────

export interface WorkflowRunOptions {
  /** Target app name for app-specific workflows */
  targetApp?: string;
  /** For supervised-input: the text to type */
  inputText?: string;
  /** For supervised-input: a keyboard shortcut key name */
  inputKey?: string;
  /** For supervised-input: modifier keys */
  inputModifiers?: Array<'cmd' | 'shift' | 'alt' | 'ctrl'>;
  /** Custom output path for screenshots */
  screenshotOutputPath?: string;
  /**
   * For unreal-build: whether to run a C++ compilation (build) or a full
   * cook+build+stage+package operation (package).
   * Defaults to 'build' if not specified.
   */
  buildMode?: 'build' | 'package';
  /**
   * For unreal-triage: explicit path to the log file to analyze.
   * If not provided, the pack discovers the best available log source
   * from the build artifact, awareness snapshot, or project Saved/Logs/.
   */
  triageLogPath?: string;
  /**
   * For unreal-scaffold: plain-language description of the prototype to build.
   * Examples: "third-person sci-fi survival", "top-down roguelite dungeon crawler".
   * Required for the Unreal System Scaffold pack to produce a grounded plan.
   */
  prototypeGoal?: string;

  // ── Android-specific options ──────────────────────────────────────────────────

  /** Android device serial (from adb devices). */
  serial?: string;
  /** AVD name to launch (for android-launch-avd pack). */
  avdName?: string;
  /** Absolute path to the Gradle wrapper (./gradlew). Auto-detected if omitted. */
  gradlePath?: string;
  /** Absolute path to an APK to install (for android_install_launch phase). */
  apkPath?: string;
  /** Android package name for am start / monkey launch. */
  packageName?: string;
  /** Android fully-qualified activity name (e.g. ".MainActivity"). */
  activity?: string;
  /** Type of input: 'tap' | 'text' | 'keyevent' (for android_input phase). */
  inputType?: 'tap' | 'text' | 'keyevent';
  /** Android keycode (numeric or string) for keyevent input. */
  keycode?: string | number;
  /** X coordinate for tap input. */
  x?: number;
  /** Y coordinate for tap input. */
  y?: number;
  /** Project path for Android/iOS awareness scans. */
  projectPath?: string;

  // ── Vision options ────────────────────────────────────────────────────────────

  /** Plain-English description of the UI element to locate (for vision_locate). */
  elementDescription?: string;
  /** Freeform question to ask about the screen (for vision_ask). */
  visionQuestion?: string;
  /** Expected outcome to verify after an action (for vision_verify). */
  expectedOutcome?: string;
  /** Whether to run vision analysis on each screen change (screen_watch_start). */
  visionOnChange?: boolean;
  /** Screen watcher poll interval in milliseconds. Default: 3000. */
  watchIntervalMs?: number;
  /** Screen change threshold score (0–100). Default: 15. */
  changeThreshold?: number;

  // ── Social media publishing options ──────────────────────────────────────────

  /** The social platform to authenticate with: 'youtube' | 'facebook' | 'instagram' | 'tiktok' */
  socialPlatform?: 'youtube' | 'facebook' | 'instagram' | 'tiktok';
  /** Local file path to publish (image or video) */
  filePath?: string;
  /** Whether the file is a video (vs. image) */
  isVideo?: boolean;
  /** Post caption / description */
  caption?: string;
  /** Video title (YouTube, Facebook video, TikTok) */
  videoTitle?: string;
  /** Video description (YouTube) */
  videoDescription?: string;
  /** Video tags (YouTube) */
  videoTags?: string[];
  /** YouTube privacy: 'public' | 'unlisted' | 'private' */
  youtubePrivacy?: 'public' | 'unlisted' | 'private';
  /** TikTok privacy: 'PUBLIC_TO_EVERYONE' | 'SELF_ONLY' etc. */
  tiktokPrivacy?: 'PUBLIC_TO_EVERYONE' | 'MUTUAL_FOLLOW_FRIENDS' | 'FOLLOWER_OF_CREATOR' | 'SELF_ONLY';
  /** OAuth App credentials — platform-specific (stored in settings, not hardcoded) */
  appCredentials?: {
    clientId?:     string;
    clientSecret?: string;
    appId?:        string;
    appSecret?:    string;
    clientKey?:    string;
  };
  /**
   * Plain-language description of what the user wants to accomplish.
   * Used by app packs (adobe_extendscript, blender_python, app_applescript) to
   * auto-generate the required script when opts.script is not provided.
   */
  goal?: string;

  // ── App scripting options ─────────────────────────────────────────────────────

  /** Script source for adobe_extendscript, blender_python, or app_applescript phases. */
  script?: string;

  // ── Click / interaction options ───────────────────────────────────────────────

  /** Mouse button for queue_click_at phases. Default: 'left'. */
  button?: 'left' | 'right' | 'double';

  // ── ADB options ───────────────────────────────────────────────────────────────

  /** Arguments string passed after "adb" for adb_command phases (e.g. "install /path/app.apk"). */
  adbArgs?: string;

  // ── Unreal Editor UI operation options ───────────────────────────────────────

  /** Blueprint class name to open via Quick-Open (for unreal_editor_open_bp phase). */
  className?: string;

  // ── Xcode / iOS options ───────────────────────────────────────────────────────

  /** Arguments string passed after "xcodebuild" for xcodebuild phases. */
  xcodebuildArgs?: string;
  /** Arguments string passed after "xcrun simctl" for ios_simctl phases. */
  simctlArgs?: string;
  /** iOS Simulator UDID for ios_simctl / ios_build_simulator / ios_simulator_screenshot phases. */
  udid?: string;
  /** Xcode scheme name for ios_build_simulator / ios_build_device phases. */
  scheme?: string;
  /** App bundle identifier for ios_build_simulator (launch step). */
  bundleId?: string;
  /** Real device identifier for ios_build_device / ios_devicectl phases. */
  deviceIdentifier?: string;
  /** Path to a built .app for ios_devicectl install. */
  appPath?: string;
  /** Output path for ios_simulator_screenshot phase. */
  outputPath?: string;
}
