// ── awareness/SystemStateService.ts — Live Runtime State Provider ─────────────
//
// Singleton that gathers live system state before each Council turn.
// Uses the "registered getter" pattern (same as serviceLocator) so the
// desktop main process can wire up closures to its own singletons without
// creating a circular dependency.
//
// Registration (in desktop/src/main/ipc.ts):
//   systemStateService.registerProvidersGetter(async () => ({ openai: true, ... }));
//   systemStateService.registerTierGetter(() => tier);
//   ... etc.
//
// Usage (in chat handlers):
//   const snapshot = await systemStateService.snapshot();
//   const addendum = buildCouncilAwarenessAddendum(snapshot);

import type { SystemStateSnapshot } from './types';

// ── Getter type signatures ────────────────────────────────────────────────────

type TierGetter        = () => 'free' | 'pro' | 'business';
type ProfileGetter     = () => string | null;
type MissionGetter     = () => string | null;
type AutonomyGetter    = () => { running: boolean; workflowCount: number };
type ProvidersGetter   = () => Promise<{ openai: boolean; claude: boolean; grok: boolean; ollama: boolean }>;
type ImageGetter       = () => boolean;
type PhoneGetter       = () => boolean;
type ApprovalsGetter   = () => number;
type TasksGetter       = () => number;
type MailGetter        = () => boolean;
type TwitterGetter     = () => boolean;
type PermissionsGetter = () => { files: boolean; browser: boolean; printer: boolean; email: boolean };
type VoiceAuthGetter   = () => boolean;
type TradingGetter     = () => { connected: boolean; mode: 'off' | 'shadow' | 'paper' | 'guarded_live_candidate' };

// ── Service class ─────────────────────────────────────────────────────────────

class SystemStateServiceClass {
  private _getTier:        TierGetter        = () => 'free';
  private _getProfile:     ProfileGetter     = () => null;
  private _getMission:     MissionGetter     = () => null;
  private _getAutonomy:    AutonomyGetter    = () => ({ running: false, workflowCount: 0 });
  private _getProviders:   ProvidersGetter   = async () => ({ openai: false, claude: false, grok: false, ollama: false });
  private _getImage:       ImageGetter       = () => false;
  private _getPhone:       PhoneGetter       = () => false;
  private _getApprovals:   ApprovalsGetter   = () => 0;
  private _getTasks:       TasksGetter       = () => 0;
  private _getMail:        MailGetter        = () => false;
  private _getTwitter:     TwitterGetter     = () => false;
  private _getPermissions: PermissionsGetter = () => ({ files: false, browser: false, printer: false, email: false });
  private _getVoiceAuth:   VoiceAuthGetter   = () => false;
  private _getTrading:     TradingGetter     = () => ({ connected: false, mode: 'off' });

  // ── Registration API (called once at startup from desktop/main/ipc.ts) ──────

  registerTierGetter(fn: TierGetter):               void { this._getTier        = fn; }
  registerProfileGetter(fn: ProfileGetter):          void { this._getProfile     = fn; }
  registerMissionGetter(fn: MissionGetter):          void { this._getMission     = fn; }
  registerAutonomyGetter(fn: AutonomyGetter):        void { this._getAutonomy    = fn; }
  registerProvidersGetter(fn: ProvidersGetter):      void { this._getProviders   = fn; }
  registerImageGetter(fn: ImageGetter):              void { this._getImage       = fn; }
  registerPhoneGetter(fn: PhoneGetter):              void { this._getPhone       = fn; }
  registerApprovalsGetter(fn: ApprovalsGetter):      void { this._getApprovals   = fn; }
  registerTasksGetter(fn: TasksGetter):              void { this._getTasks       = fn; }
  registerMailGetter(fn: MailGetter):                void { this._getMail        = fn; }
  registerTwitterGetter(fn: TwitterGetter):          void { this._getTwitter     = fn; }
  registerPermissionsGetter(fn: PermissionsGetter):  void { this._getPermissions = fn; }
  registerVoiceAuthGetter(fn: VoiceAuthGetter):      void { this._getVoiceAuth   = fn; }
  registerTradingGetter(fn: TradingGetter):          void { this._getTrading     = fn; }

  // ── Snapshot ─────────────────────────────────────────────────────────────────

  /**
   * Build a fresh runtime snapshot. Called once per Council turn.
   * All getters are designed to be cheap (no heavy I/O).
   */
  async snapshot(): Promise<SystemStateSnapshot> {
    const [providers, autonomy] = await Promise.all([
      this._getProviders().catch(() => ({ openai: false, claude: false, grok: false, ollama: false })),
      Promise.resolve(this._getAutonomy()),
    ]);
    const trading = this._getTrading();

    return {
      timestamp:            Date.now(),
      tier:                 this._getTier(),
      activeProfileId:      this._getProfile(),
      activeMissionId:      this._getMission(),
      autonomyRunning:      autonomy.running,
      autonomyWorkflowCount: autonomy.workflowCount,
      providers,
      imageReady:           this._getImage(),
      voiceAuthConfigured:  this._getVoiceAuth(),
      phonePaired:          this._getPhone(),
      pendingApprovals:     this._getApprovals(),
      pendingTasks:         this._getTasks(),
      mailConfigured:       this._getMail(),
      twitterConfigured:    this._getTwitter(),
      permissions:          this._getPermissions(),
      tradingConnected:     trading.connected,
      tradingMode:          trading.mode,
    };
  }
}

/** Singleton — registered once at app startup, read every Council turn. */
export const systemStateService = new SystemStateServiceClass();
