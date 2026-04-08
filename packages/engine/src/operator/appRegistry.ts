// ── operator/appRegistry.ts ───────────────────────────────────────────────────
//
// Phase 2.1 — Generic App Integration Framework: Registry
//
// Defines the AppDefinition contract and registers every known target app.
// This is the single source of truth for:
//   - Which apps TriForge knows about
//   - How to detect them (process names, install paths, bundle IDs)
//   - What scripting interface they expose
//   - Which workflow packs are available for each app
//
// Adding a new app: create an AppDefinition object and add it to APP_REGISTRY.
// The detection runtime (appAwareness.ts) iterates this registry automatically.

import os from 'os';
import path from 'path';

// ── Types ─────────────────────────────────────────────────────────────────────

export type AppCategory =
  | 'creative'      // Adobe, Figma, Affinity — visual/media creation
  | 'daw'           // Logic Pro, Ableton, Pro Tools — audio production
  | 'game-engine'   // Unreal, Unity, Godot
  | 'mobile-dev'    // Xcode, Android Studio
  | '3d'            // Blender, Cinema 4D, Maya
  | 'browser'       // Chrome, Safari, Firefox
  | 'generic';      // everything else

export type ScriptingInterface =
  | 'applescript'    // native macOS AppleScript (osascript)
  | 'extendscript'   // Adobe ExtendScript (legacy CC scripting)
  | 'uxp'            // Adobe UXP (modern CC plugin API)
  | 'python-cli'     // app exposes a Python/CLI interface (Blender --python)
  | 'adb'            // Android Debug Bridge (Android Studio devices)
  | 'xcodebuild'     // Xcode command-line tools
  | 'rest'           // HTTP REST API (Unreal Remote Control, etc.)
  | 'none';          // no programmatic interface — visual control only

export interface AppInstallPaths {
  /** Known macOS install paths (checked via fs.existsSync) */
  mac?: string[];
  /** Known Windows install paths */
  win?: string[];
}

export interface AppDefinition {
  /** Stable identifier, e.g. 'adobe.photoshop', 'blender', 'logic-pro' */
  id: string;
  /** Human-readable display name */
  name: string;
  vendor: string;
  category: AppCategory;
  /** Emoji icon shown in UI */
  icon: string;
  /**
   * Case-insensitive substrings matched against running process/app names.
   * First match wins.
   */
  processPatterns: string[];
  /** macOS bundle IDs for more precise identification (optional) */
  bundleIds?: string[];
  /** Known install locations per platform */
  installPaths: AppInstallPaths;
  /**
   * Primary scripting interface this app exposes.
   * Determines which workflow pack phase kinds are available.
   */
  scriptingInterface: ScriptingInterface;
  /** One-line note about scripting capabilities / limitations */
  scriptingNotes?: string;
  /**
   * Regex to extract the open document / project name from the window title.
   * Group 1 should be the document name.
   */
  windowTitleExtract?: RegExp;
  /** IDs of workflow packs available for this app */
  packIds: string[];
}

export interface DetectedApp {
  definition: AppDefinition;
  /** True if any process matching this app's patterns is running */
  running: boolean;
  /** True if this app is the current frontmost window */
  frontmost: boolean;
  /** Actual process name as returned by the OS */
  processName?: string;
  /** Frontmost window title (if readable) */
  windowTitle?: string;
  /** Open document/project name extracted from window title */
  openDocument?: string;
  /** True if install was detected on disk (undefined = not checked) */
  installed?: boolean;
}

// ── App Definitions ───────────────────────────────────────────────────────────

const HOME = os.homedir();

// ── Adobe Creative Suite ──────────────────────────────────────────────────────

export const APP_ADOBE_PHOTOSHOP: AppDefinition = {
  id: 'adobe.photoshop',
  name: 'Adobe Photoshop',
  vendor: 'Adobe',
  category: 'creative',
  icon: '🖼️',
  processPatterns: ['Adobe Photoshop'],
  bundleIds: ['com.adobe.Photoshop'],
  installPaths: {
    mac: [
      '/Applications/Adobe Photoshop 2024/Adobe Photoshop 2024.app',
      '/Applications/Adobe Photoshop 2025/Adobe Photoshop 2025.app',
      '/Applications/Adobe Photoshop 2023/Adobe Photoshop 2023.app',
    ],
  },
  scriptingInterface: 'extendscript',
  scriptingNotes: 'Supports ExtendScript (.jsx) and UXP. Can be driven via osascript + doScript.',
  windowTitleExtract: /^(.+?)\s*(?:@\s*\d+%\s*)?\(.*?\)\s*-\s*Adobe Photoshop/i,
  packIds: ['pack.adobe-photoshop'],
};

export const APP_ADOBE_PREMIERE: AppDefinition = {
  id: 'adobe.premiere',
  name: 'Adobe Premiere Pro',
  vendor: 'Adobe',
  category: 'creative',
  icon: '🎬',
  processPatterns: ['Adobe Premiere Pro'],
  bundleIds: ['com.adobe.premierepro'],
  installPaths: {
    mac: [
      '/Applications/Adobe Premiere Pro 2024/Adobe Premiere Pro 2024.app',
      '/Applications/Adobe Premiere Pro 2025/Adobe Premiere Pro 2025.app',
    ],
  },
  scriptingInterface: 'extendscript',
  scriptingNotes: 'Supports ExtendScript for project/sequence automation. Limited visual control.',
  windowTitleExtract: /^(.+?)\s*[*]?\s*[-–]\s*Adobe Premiere Pro/i,
  packIds: ['pack.adobe-premiere'],
};

export const APP_ADOBE_AFTER_EFFECTS: AppDefinition = {
  id: 'adobe.aftereffects',
  name: 'Adobe After Effects',
  vendor: 'Adobe',
  category: 'creative',
  icon: '✨',
  processPatterns: ['Adobe After Effects'],
  bundleIds: ['com.adobe.AfterEffects'],
  installPaths: {
    mac: [
      '/Applications/Adobe After Effects 2024/Adobe After Effects 2024.app',
      '/Applications/Adobe After Effects 2025/Adobe After Effects 2025.app',
    ],
  },
  scriptingInterface: 'extendscript',
  scriptingNotes: 'Supports ExtendScript for composition/render automation via executeScript.',
  windowTitleExtract: /^(.+?)\s*[*]?\s*[-–]\s*Adobe After Effects/i,
  packIds: ['pack.adobe-aftereffects'],
};

export const APP_ADOBE_ILLUSTRATOR: AppDefinition = {
  id: 'adobe.illustrator',
  name: 'Adobe Illustrator',
  vendor: 'Adobe',
  category: 'creative',
  icon: '✏️',
  processPatterns: ['Adobe Illustrator'],
  bundleIds: ['com.adobe.illustrator'],
  installPaths: {
    mac: [
      '/Applications/Adobe Illustrator 2024/Adobe Illustrator.app',
      '/Applications/Adobe Illustrator 2025/Adobe Illustrator.app',
    ],
  },
  scriptingInterface: 'extendscript',
  scriptingNotes: 'Full ExtendScript API for document/object manipulation.',
  windowTitleExtract: /^(.+?)\s*[@\d%\s]*[-–]\s*Adobe Illustrator/i,
  packIds: ['pack.adobe-illustrator'],
};

// ── 3D / Game Engines ─────────────────────────────────────────────────────────

export const APP_BLENDER: AppDefinition = {
  id: 'blender',
  name: 'Blender',
  vendor: 'Blender Foundation',
  category: '3d',
  icon: '🍊',
  processPatterns: ['Blender'],
  bundleIds: ['org.blenderfoundation.blender'],
  installPaths: {
    mac: [
      '/Applications/Blender.app',
      path.join(HOME, 'Applications', 'Blender.app'),
    ],
  },
  scriptingInterface: 'python-cli',
  scriptingNotes: 'Blender --python <script.py> or --python-expr runs Python in Blender context. Also exposes a scripting console that accepts Python via stdin.',
  windowTitleExtract: /^(?:Blender\s+[\d.]+\s+[-–]\s+)?(.+?)(?:\s*[-–]\s*Blender)?$/i,
  packIds: ['pack.blender'],
};

// ── DAWs ──────────────────────────────────────────────────────────────────────

export const APP_LOGIC_PRO: AppDefinition = {
  id: 'logic-pro',
  name: 'Logic Pro',
  vendor: 'Apple',
  category: 'daw',
  icon: '🎹',
  processPatterns: ['Logic Pro'],
  bundleIds: ['com.apple.logic10'],
  installPaths: {
    mac: ['/Applications/Logic Pro.app'],
  },
  scriptingInterface: 'applescript',
  scriptingNotes: 'Logic Pro has a rich AppleScript dictionary: open/save/export projects, transport control, track management.',
  windowTitleExtract: /^(.+?)\s*(?:[-–].*)?$/i,
  packIds: ['pack.logic-pro'],
};

export const APP_ABLETON_LIVE: AppDefinition = {
  id: 'ableton-live',
  name: 'Ableton Live',
  vendor: 'Ableton',
  category: 'daw',
  icon: '🔊',
  processPatterns: ['Ableton Live', 'Live'],
  bundleIds: ['com.ableton.live'],
  installPaths: {
    mac: [
      '/Applications/Ableton Live 12 Suite.app',
      '/Applications/Ableton Live 12 Standard.app',
      '/Applications/Ableton Live 11 Suite.app',
    ],
  },
  scriptingInterface: 'none',
  scriptingNotes: 'No AppleScript support. Control via MIDI Remote Scripts or Max for Live. Visual control via click+OCR is the primary path.',
  windowTitleExtract: /^(.+?)\s*(?:[*]\s*)?$/,
  packIds: ['pack.ableton-live'],
};

export const APP_PRO_TOOLS: AppDefinition = {
  id: 'pro-tools',
  name: 'Pro Tools',
  vendor: 'Avid',
  category: 'daw',
  icon: '🎙️',
  processPatterns: ['Pro Tools'],
  bundleIds: ['com.avid.ProTools'],
  installPaths: {
    mac: ['/Applications/Pro Tools.app'],
  },
  scriptingInterface: 'none',
  scriptingNotes: 'Limited scripting. Keyboard shortcuts are the primary control path. Visual click+OCR is the fallback.',
  windowTitleExtract: /^(.+?)\s*(?:[-–].*)?$/i,
  packIds: ['pack.pro-tools'],
};

// ── Mobile Development ────────────────────────────────────────────────────────

export const APP_XCODE: AppDefinition = {
  id: 'xcode',
  name: 'Xcode',
  vendor: 'Apple',
  category: 'mobile-dev',
  icon: '🔨',
  processPatterns: ['Xcode'],
  bundleIds: ['com.apple.dt.Xcode'],
  installPaths: {
    mac: ['/Applications/Xcode.app'],
  },
  scriptingInterface: 'applescript',
  scriptingNotes: 'AppleScript + xcodebuild CLI. Can build, test, and run simulators programmatically.',
  windowTitleExtract: /^(.+?)\s*(?:[-–].*)?$/i,
  packIds: ['pack.xcode'],
};

export const APP_ANDROID_STUDIO: AppDefinition = {
  id: 'android-studio',
  name: 'Android Studio',
  vendor: 'Google / JetBrains',
  category: 'mobile-dev',
  icon: '🤖',
  processPatterns: ['Android Studio', 'studio'],
  bundleIds: ['com.google.android.studio'],
  installPaths: {
    mac: [
      '/Applications/Android Studio.app',
      path.join(HOME, 'Applications', 'Android Studio.app'),
    ],
  },
  scriptingInterface: 'adb',
  scriptingNotes: 'Control via ADB (adb install, adb shell, adb exec-out screencap). Gradle CLI for building.',
  windowTitleExtract: /^(.+?)\s*(?:[-–].*)?$/i,
  packIds: ['pack.android-studio'],
};

// ── Video Production ──────────────────────────────────────────────────────────

export const APP_DAVINCI_RESOLVE: AppDefinition = {
  id: 'davinci-resolve',
  name: 'DaVinci Resolve',
  vendor: 'Blackmagic Design',
  category: 'creative',
  icon: '🎬',
  processPatterns: ['DaVinci Resolve', 'Resolve'],
  bundleIds: ['com.blackmagic-design.DaVinciResolve'],
  installPaths: {
    mac: [
      '/Applications/DaVinci Resolve/DaVinci Resolve.app',
      path.join(HOME, 'Applications', 'DaVinci Resolve', 'DaVinci Resolve.app'),
    ],
    win: [
      'C:\\Program Files\\Blackmagic Design\\DaVinci Resolve\\Resolve.exe',
    ],
  },
  scriptingInterface: 'none',
  scriptingNotes:
    'No public scripting API. Operated via visual click+OCR — focus a panel, then use keyboard shortcuts (Ctrl+M for export, Ctrl+Shift+C for color page, etc.).',
  windowTitleExtract: /^(.+?)\s*[-–]\s*DaVinci Resolve/i,
  packIds: ['pack.davinci-resolve'],
};

export const APP_FINAL_CUT_PRO: AppDefinition = {
  id: 'final-cut-pro',
  name: 'Final Cut Pro',
  vendor: 'Apple',
  category: 'creative',
  icon: '🎥',
  processPatterns: ['Final Cut Pro', 'FinalCutPro'],
  bundleIds: ['com.apple.FinalCut'],
  installPaths: {
    mac: [
      '/Applications/Final Cut Pro.app',
      path.join(HOME, 'Applications', 'Final Cut Pro.app'),
    ],
  },
  scriptingInterface: 'applescript',
  scriptingNotes:
    'Limited AppleScript support for opening projects and triggering export. Most timeline manipulation requires visual click+keyboard. Cmd+E opens Share dialog.',
  windowTitleExtract: /^(.+?)\s*[-–]\s*Final Cut Pro/i,
  packIds: ['pack.finalcut-pro'],
};

// ── Unreal Engine ─────────────────────────────────────────────────────────────

export const APP_UNREAL_ENGINE: AppDefinition = {
  id: 'unreal-engine',
  name: 'Unreal Engine',
  vendor: 'Epic Games',
  category: 'game-engine',
  icon: '🎮',
  processPatterns: ['UnrealEditor', 'UE4Editor', 'UE5Editor', 'Unreal Editor'],
  bundleIds: ['com.epicgames.UnrealEditor'],
  installPaths: {
    mac: [
      '/Applications/Epic Games Launcher.app',
      path.join(HOME, 'Library/Application Support/Epic/UnrealEngine'),
    ],
  },
  scriptingInterface: 'rest',
  scriptingNotes:
    'Unreal Remote Control Plugin exposes a REST API on localhost:30010. Supports Blueprint creation, property mutation, and remote preset execution when the plugin is enabled.',
  windowTitleExtract: /^(.+?)\s*[-–—]\s*(?:Unreal Editor|UE\d)/i,
  packIds: [
    'pack.unreal-bootstrap',
    'pack.unreal-m1-execute',
    'pack.unreal-m2-execute',
    'pack.unreal-m3-execute',
    'pack.unreal-m4-execute',
    'pack.unreal-m5-execute',
    'pack.unreal-editor-operate',
    'pack.unreal-triage',
    'pack.unreal-rc-probe',
  ],
};

// ── Registry ──────────────────────────────────────────────────────────────────

/** All known app definitions, in display priority order. */
export const APP_REGISTRY: AppDefinition[] = [
  // Game engines
  APP_UNREAL_ENGINE,
  // Adobe
  APP_ADOBE_PHOTOSHOP,
  APP_ADOBE_PREMIERE,
  APP_ADOBE_AFTER_EFFECTS,
  APP_ADOBE_ILLUSTRATOR,
  // 3D
  APP_BLENDER,
  // DAWs
  APP_LOGIC_PRO,
  APP_ABLETON_LIVE,
  APP_PRO_TOOLS,
  // Mobile dev
  APP_XCODE,
  APP_ANDROID_STUDIO,
  // Video production
  APP_DAVINCI_RESOLVE,
  APP_FINAL_CUT_PRO,
];

// ── Lookup helpers ─────────────────────────────────────────────────────────────

export function getAppDefinition(id: string): AppDefinition | undefined {
  return APP_REGISTRY.find(a => a.id === id);
}

export function getAppsByCategory(category: AppCategory): AppDefinition[] {
  return APP_REGISTRY.filter(a => a.category === category);
}

export function getAppByProcessName(processName: string): AppDefinition | undefined {
  const lower = processName.toLowerCase();
  return APP_REGISTRY.find(def =>
    def.processPatterns.some(p => lower.includes(p.toLowerCase())),
  );
}
