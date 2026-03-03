// professionEngine.ts — Role-adaptive behavior layer
// Activating a profile starts its sensors, registers its default workflows,
// and injects role-specific context into the system prompt.

import { eventBus } from './eventBus';
import type { WorkflowDefinition } from './autonomyEngine';

// ── Public Types ───────────────────────────────────────────────────────────────

export interface ProfessionProfile {
  id: string;
  name: string;
  activeSensors: string[];
  defaultWorkflows: WorkflowDefinition[];
  systemPromptAdditions: string[];
  approvalStrictness: 'strict' | 'balanced' | 'relaxed';
  behaviorModifiers: {
    preferredProviders?: string[];
    responseStyle?: 'technical' | 'executive' | 'conversational';
  };
}

// Minimal interface so engine package doesn't depend on desktop's SensorManager directly
export interface ISensorManager {
  startSensor(name: string, config?: Record<string, unknown>): { ok?: boolean; error?: string };
  stopSensor(name: string): { ok?: boolean; error?: string };
}

// Minimal interface for AutonomyEngine workflow registration
export interface IAutonomyEngine {
  registerWorkflow(wf: WorkflowDefinition): WorkflowDefinition;
  deleteWorkflow(id: string): boolean;
}

// ── Built-in Profiles ──────────────────────────────────────────────────────────

const IT_PROFILE: ProfessionProfile = {
  id: 'it',
  name: 'IT Support',
  activeSensors: ['diskMonitor', 'networkMonitor', 'processMonitor', 'eventLogMonitor', 'inboxWatcher'],
  approvalStrictness: 'strict',
  behaviorModifiers: { responseStyle: 'technical' },
  systemPromptAdditions: [
    'You are operating in IT Support mode. Prioritize diagnosing and resolving system issues above all other requests.',
    'When reporting sensor alerts (disk low, network down, service stopped), lead with the operational impact and remediation steps.',
    'For script execution, service restarts, or process termination — always summarize what will happen and why before acting. These require user approval.',
    'You have access to IT tools: it_diagnostics, it_network_doctor, it_event_logs, it_services, it_processes, it_script_runner, it_patch_advisor.',
    'Approval strictness: STRICT — all system mutation actions (restart, kill, run script) require explicit approval before execution.',
  ],
  defaultWorkflows: [
    {
      id: 'it-network-down',
      name: 'Network Down — Auto-Diagnose',
      description: 'When the network goes down, run a network diagnostic and notify',
      enabled: true,
      triggers: [{ eventType: 'SENSOR_NETWORK_DOWN' }],
      actions: [
        { type: 'notify', params: { title: 'Network Down', body: 'Network adapter went offline. Running diagnostics...' } },
        { type: 'ai_task', params: { goal: 'Network adapter went offline. Run it_network_doctor to diagnose the issue and provide a prioritized remediation plan.', category: 'general' } },
      ],
      cooldownMs: 120_000,
      createdAt: Date.now(),
    },
    {
      id: 'it-disk-low',
      name: 'Disk Low — Triage Task',
      description: 'When disk space drops below threshold, notify and queue a cleanup task',
      enabled: true,
      triggers: [{ eventType: 'SENSOR_DISK_LOW' }],
      actions: [
        { type: 'notify', params: { title: 'Low Disk Space', body: 'Disk space is critically low. Queuing triage task.' } },
        { type: 'ai_task', params: { goal: 'Disk space is critically low. Run it_diagnostics to confirm current disk usage, then recommend specific cleanup actions ranked by free space recovered.', category: 'general' } },
      ],
      cooldownMs: 300_000,
      createdAt: Date.now(),
    },
    {
      id: 'it-service-stopped',
      name: 'Critical Service Stopped — Alert',
      description: 'When a monitored service stops, alert and queue a recovery approval',
      enabled: true,
      triggers: [{ eventType: 'SENSOR_SERVICE_ALERT', filter: { status: 'stopped' } }],
      actions: [
        { type: 'notify', params: { title: 'Service Stopped', body: 'A monitored service has stopped.' } },
        {
          type: 'queue_approval',
          params: { description: 'A monitored service stopped. Approve to attempt restart via it_services.' },
          requiresApproval: true,
        },
      ],
      cooldownMs: 60_000,
      createdAt: Date.now(),
    },
  ],
};

const MARKETING_PROFILE: ProfessionProfile = {
  id: 'marketing',
  name: 'Marketing',
  activeSensors: ['clipboardMonitor', 'inboxWatcher', 'webMonitor'],
  approvalStrictness: 'balanced',
  behaviorModifiers: { responseStyle: 'executive' },
  systemPromptAdditions: [
    'You are operating in Marketing mode. Optimize for brand voice, audience engagement, and campaign performance.',
    'When analyzing competitor activity or website changes, lead with the strategic implication and recommended response.',
    'For social media and email content, maintain a professional, engaging tone aligned with the user\'s brand.',
    'Prioritize tasks related to campaigns, content performance, and lead generation.',
    'Approval strictness: BALANCED — content drafts auto-generate, but social posts and email sends require approval.',
  ],
  defaultWorkflows: [
    {
      id: 'marketing-website-changed',
      name: 'Competitor Site Changed — Strategic Summary',
      description: 'When a monitored website changes, generate a strategic summary',
      enabled: true,
      triggers: [{ eventType: 'SENSOR_WEBSITE_CHANGED' }],
      actions: [
        { type: 'notify', params: { title: 'Website Change Detected', body: 'A monitored site changed. Generating strategic summary...' } },
        {
          type: 'ai_task',
          params: {
            goal: 'A monitored website has changed. Summarize what changed, its strategic implications for our marketing positioning, and recommend one concrete response action.',
            category: 'general',
          },
        },
      ],
      cooldownMs: 3_600_000,
      createdAt: Date.now(),
    },
    {
      id: 'marketing-clipboard-tag',
      name: 'Clipboard Content — Marketing Tag',
      description: 'When marketing-relevant content is copied, suggest applications',
      enabled: false, // off by default — too noisy for most users
      triggers: [{ eventType: 'SENSOR_CLIPBOARD_CHANGED' }],
      actions: [
        {
          type: 'ai_task',
          params: {
            goal: 'New content was copied to clipboard. If it appears marketing-relevant (competitor copy, ad creative, pricing data, campaign idea), provide a 2-sentence strategic note and one suggested next action. If not marketing-relevant, respond with nothing.',
            category: 'general',
          },
        },
      ],
      cooldownMs: 30_000,
      createdAt: Date.now(),
    },
  ],
};

const FOUNDER_PROFILE: ProfessionProfile = {
  id: 'founder',
  name: 'Founder',
  activeSensors: ['inboxWatcher', 'webMonitor', 'fileWatcher'],
  approvalStrictness: 'relaxed',
  behaviorModifiers: { responseStyle: 'executive' },
  systemPromptAdditions: [
    'You are operating in Founder mode. Optimize for strategic clarity, high-leverage decisions, and speed of execution.',
    'When summarizing proposals, documents, or inbound communications — lead with: the ask, the risk, and the ROI.',
    'Triage all inbound by urgency and strategic importance. Filter noise, escalate signal.',
    'Think like a chief of staff: protect the founder\'s time and attention above all else.',
    'Approval strictness: RELAXED — routine tasks and summaries auto-execute. Irreversible actions (send email, post, financial) require approval.',
  ],
  defaultWorkflows: [
    {
      id: 'founder-new-proposal',
      name: 'New Proposal File — Executive Summary',
      description: 'When a new file appears in a proposals folder, auto-summarize it',
      enabled: true,
      triggers: [{ eventType: 'SENSOR_FILE_NEW', filter: { dir: 'proposals' } }],
      actions: [
        { type: 'notify', params: { title: 'New Proposal', body: 'A new proposal file was detected. Queuing executive summary.' } },
        {
          type: 'ai_task',
          params: {
            goal: 'A new proposal file was added. Summarize it in 5 bullets: (1) the ask, (2) the proposing party, (3) key terms, (4) primary risks, (5) recommended response (meet / pass / counter).',
            category: 'general',
          },
        },
      ],
      cooldownMs: 60_000,
      createdAt: Date.now(),
    },
    {
      id: 'founder-site-change',
      name: 'Monitored Site Changed — Executive Brief',
      description: 'When a tracked site changes, generate a 3-bullet executive brief',
      enabled: true,
      triggers: [{ eventType: 'SENSOR_WEBSITE_CHANGED' }],
      actions: [
        {
          type: 'ai_task',
          params: {
            goal: 'A monitored website changed. Generate a 3-bullet executive brief: (1) what changed, (2) what it means for us, (3) recommended action (if any).',
            category: 'general',
          },
        },
      ],
      cooldownMs: 3_600_000,
      createdAt: Date.now(),
    },
  ],
};

export const BUILT_IN_PROFILES: ProfessionProfile[] = [IT_PROFILE, MARKETING_PROFILE, FOUNDER_PROFILE];

// ── ProfessionEngine ───────────────────────────────────────────────────────────

export class ProfessionEngine {
  private activeProfile: ProfessionProfile | null = null;
  private registeredWorkflowIds: string[] = [];

  constructor(
    private sensorManager: ISensorManager,
    private autonomyEngine: IAutonomyEngine,
  ) {}

  activate(profile: ProfessionProfile): void {
    if (this.activeProfile) this.deactivate();
    this.activeProfile = profile;

    // Start sensors required by this profile
    for (const sensorName of profile.activeSensors) {
      try { this.sensorManager.startSensor(sensorName); } catch { /* ignore startup errors */ }
    }

    // Register default workflows (upsert — safe if already registered)
    this.registeredWorkflowIds = [];
    for (const wf of profile.defaultWorkflows) {
      this.autonomyEngine.registerWorkflow({ ...wf, createdAt: wf.createdAt || Date.now() });
      this.registeredWorkflowIds.push(wf.id);
    }

    eventBus.emit({
      type: 'PROFESSION_ACTIVATED',
      profileId: profile.id,
      profileName: profile.name,
    });
  }

  deactivate(): void {
    if (!this.activeProfile) return;

    // Stop sensors this profile started
    for (const sensorName of this.activeProfile.activeSensors) {
      try { this.sensorManager.stopSensor(sensorName); } catch { /* ignore */ }
    }

    // Remove default workflows registered by this profile
    for (const id of this.registeredWorkflowIds) {
      this.autonomyEngine.deleteWorkflow(id);
    }

    const prevId   = this.activeProfile.id;
    const prevName = this.activeProfile.name;
    this.registeredWorkflowIds = [];
    this.activeProfile = null;

    eventBus.emit({
      type: 'PROFESSION_DEACTIVATED',
      profileId: prevId,
      profileName: prevName,
    });
  }

  getActive(): ProfessionProfile | null {
    return this.activeProfile;
  }

  getSystemPromptAdditions(): string[] {
    return this.activeProfile?.systemPromptAdditions ?? [];
  }

  getApprovalStrictness(): 'strict' | 'balanced' | 'relaxed' {
    return this.activeProfile?.approvalStrictness ?? 'balanced';
  }
}
