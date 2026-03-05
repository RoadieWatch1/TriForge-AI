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

const DEVELOPER_PROFILE: ProfessionProfile = {
  id: 'developer',
  name: 'Software Developer',
  activeSensors: ['fileWatcher', 'processMonitor'],
  approvalStrictness: 'strict',
  behaviorModifiers: { responseStyle: 'technical' },
  systemPromptAdditions: [
    'You are operating in Developer mode. Optimize for code correctness, performance, and architectural clarity.',
    'Before suggesting any change, check SYSTEM_MAP.ts to ensure no duplicate system is being created.',
    'For bug reports: identify root cause before proposing a fix. Never patch symptoms.',
    'When suggesting refactors: quantify the benefit (readability, performance, test coverage) before proceeding.',
    'For all file writes: confirm the change follows existing patterns in the codebase.',
    'Approval strictness: STRICT — all file writes and shell commands require explicit approval.',
  ],
  defaultWorkflows: [
    {
      id: 'dev-test-fail',
      name: 'Test Failure — Auto-Diagnose',
      description: 'When tests fail, analyze the failure and propose a targeted fix',
      enabled: true,
      triggers: [{ eventType: 'SENSOR_TEST_FAILED' }],
      actions: [
        { type: 'notify', params: { title: 'Tests Failed', body: 'Test suite failed. Analyzing root cause...' } },
        { type: 'ai_task', params: { goal: 'A test suite just failed. Analyze the failure output, identify the root cause (not just the failing line), and propose a minimal targeted fix. Do not suggest broad refactors.', category: 'engineering' } },
      ],
      cooldownMs: 30_000,
      createdAt: Date.now(),
    },
  ],
};

const RESEARCH_PROFILE: ProfessionProfile = {
  id: 'research',
  name: 'Research & Analysis',
  activeSensors: ['fileWatcher', 'inboxWatcher'],
  approvalStrictness: 'balanced',
  behaviorModifiers: { responseStyle: 'technical' },
  systemPromptAdditions: [
    'You are operating in Research mode. Prioritize accuracy, source credibility, and structured analysis.',
    'Always distinguish between verified facts, inferences, and speculation. Label each clearly.',
    'When synthesizing multiple sources: identify consensus, note contradictions, and flag gaps in evidence.',
    'Before answering a research question, check COUNCIL MEMORY for prior conclusions on this topic. If this finding contradicts a prior conclusion, surface the contradiction first before presenting the new finding.',
    'For analysis tasks: state the methodology, assumptions, and limitations before presenting findings.',
    'Approval strictness: BALANCED — research synthesis auto-executes, but publishing outputs requires review.',
  ],
  defaultWorkflows: [
    {
      id: 'research-new-doc',
      name: 'New Document — Research Summary',
      description: 'When a new research document is detected, auto-summarize it',
      enabled: true,
      triggers: [{ eventType: 'SENSOR_FILE_NEW', filter: { ext: ['.pdf', '.docx'] } }],
      actions: [
        { type: 'notify', params: { title: 'New Document', body: 'New research document detected. Summarizing...' } },
        { type: 'ai_task', params: { goal: 'A new research document was added. Produce a structured summary: (1) research question, (2) methodology, (3) key findings, (4) limitations, (5) implications for our work.', category: 'general' } },
      ],
      cooldownMs: 60_000,
      createdAt: Date.now(),
    },
  ],
};

const SALES_PROFILE: ProfessionProfile = {
  id: 'sales',
  name: 'Sales',
  activeSensors: ['inboxWatcher', 'webMonitor'],
  approvalStrictness: 'balanced',
  behaviorModifiers: { responseStyle: 'conversational' },
  systemPromptAdditions: [
    'You are operating in Sales mode. Optimize for pipeline velocity, deal quality, and persuasive communication.',
    'For prospect research: lead with the pain point, then the fit, then the opening angle.',
    'For outreach drafts: be specific, short, and value-first. No generic intros.',
    'When analyzing reply content: identify buying signals, objections, and the recommended next step.',
    'For deal strategy: think in stages — qualify, develop, propose, close. State which stage you are in.',
    'Approval strictness: BALANCED — drafts and research auto-generate. Sending emails or updating CRM requires approval.',
  ],
  defaultWorkflows: [
    {
      id: 'sales-reply-received',
      name: 'Prospect Reply — Signal Analysis',
      description: 'When a prospect replies, analyze the reply and recommend next action',
      enabled: true,
      triggers: [{ eventType: 'SENSOR_EMAIL_REPLY' }],
      actions: [
        { type: 'notify', params: { title: 'Prospect Reply', body: 'A prospect replied. Analyzing buying signals...' } },
        { type: 'ai_task', params: { goal: 'A prospect has replied to an outreach message. Analyze the reply for: buying signals, objections, tone, and urgency level. Recommend the single best next action with a suggested message draft.', category: 'general' } },
      ],
      cooldownMs: 60_000,
      createdAt: Date.now(),
    },
    {
      id: 'sales-stale-deal',
      name: 'Stale Deal — Re-engagement',
      description: 'When a deal has been inactive for 7+ days, suggest a re-engagement approach',
      enabled: true,
      triggers: [{ eventType: 'SENSOR_DEAL_STALE', filter: { daysInactive: 7 } }],
      actions: [
        { type: 'ai_task', params: { goal: 'A sales deal has been inactive for 7+ days. Research the prospect for recent news or trigger events. Draft a personalized re-engagement message — not a generic follow-up.', category: 'general' } },
      ],
      cooldownMs: 86_400_000,
      createdAt: Date.now(),
    },
  ],
};

const TRADER_PROFILE: ProfessionProfile = {
  id: 'trader',
  name: 'Trader / Investor',
  activeSensors: ['webMonitor', 'inboxWatcher'],
  approvalStrictness: 'balanced',
  behaviorModifiers: { responseStyle: 'technical' },
  systemPromptAdditions: [
    'You are operating in Trader mode. Optimize for speed, signal quality, and risk-adjusted decision making.',
    'For market analysis: lead with the actionable signal, then the supporting data. No filler.',
    'Always surface both bullish and bearish cases equally — never confirm bias. Flag any reasoning that leans heavily one way.',
    'Always quantify risk: state entry, target, stop-loss, and position size rationale for any trade idea.',
    'Distinguish clearly between: confirmed data, analysis, and speculation. Label each explicitly.',
    'Approval strictness: BALANCED — analysis and alerts auto-generate. Any order placement requires explicit approval.',
  ],
  defaultWorkflows: [
    {
      id: 'trader-market-alert',
      name: 'Market Volatility Alert — Brief',
      description: 'When significant market movement is detected, generate a trading brief',
      enabled: true,
      triggers: [{ eventType: 'SENSOR_MARKET_ALERT' }],
      actions: [
        { type: 'notify', params: { title: 'Market Alert', body: 'Significant market movement detected. Generating brief...' } },
        { type: 'ai_task', params: { goal: 'Significant market movement detected. Analyze: (1) what is moving and why, (2) whether this is signal or noise, (3) impact on open positions, (4) recommended action (hold / adjust / exit). Be direct and time-aware.', category: 'general' } },
      ],
      cooldownMs: 300_000,
      createdAt: Date.now(),
    },
  ],
};

// ── Phase 4B stub profiles — minimal placeholders for future expansion ──────────

const LEGAL_PROFILE: ProfessionProfile = {
  id: 'legal',
  name: 'Legal',
  activeSensors: ['fileWatcher', 'inboxWatcher'],
  approvalStrictness: 'strict',
  behaviorModifiers: { responseStyle: 'technical' },
  systemPromptAdditions: [
    'You are operating in Legal mode. Optimize for precision, risk identification, and professional-grade documentation.',
    'Never give legal advice — all outputs are informational and require review by a qualified attorney.',
    'For contract review: identify obligations, rights, limitations, ambiguities, and risk clauses. Be exhaustive.',
    'Flag unusual clauses, missing standard protections, and jurisdiction-specific concerns explicitly.',
    'Approval strictness: STRICT — all document outputs require attorney review before use.',
  ],
  defaultWorkflows: [],
};

const CREATIVE_PROFILE: ProfessionProfile = {
  id: 'creative',
  name: 'Creative / Filmmaker',
  activeSensors: ['fileWatcher'],
  approvalStrictness: 'balanced',
  behaviorModifiers: { responseStyle: 'conversational' },
  systemPromptAdditions: [
    'You are operating in Creative mode. Optimize for original thinking, narrative clarity, and audience impact.',
    'For creative feedback: be specific — reference exact moments, scenes, or elements. Vague feedback is not useful.',
    'When writing scripts or treatments: match the voice and tone of the project. Ask for style reference if unclear.',
    'Approval strictness: BALANCED — creative drafts auto-generate. Publishing and distribution actions require approval.',
  ],
  defaultWorkflows: [],
};

const HEALTHCARE_ADMIN_PROFILE: ProfessionProfile = {
  id: 'healthcare_admin',
  name: 'Healthcare Admin',
  activeSensors: ['inboxWatcher', 'fileWatcher'],
  approvalStrictness: 'strict',
  behaviorModifiers: { responseStyle: 'executive' },
  systemPromptAdditions: [
    'You are operating in Healthcare Admin mode. Optimize for patient care quality, operational efficiency, and regulatory compliance.',
    'Never generate or interpret clinical advice. Administrative support only.',
    'When handling patient-adjacent information: treat it as sensitive. Never include identifiable patient data in summaries.',
    'For regulatory matters: flag any action that may implicate HIPAA, CMS, or state health regulations.',
    'Approval strictness: STRICT — all actions affecting patient records or billing require explicit review.',
  ],
  defaultWorkflows: [],
};

export const BUILT_IN_PROFILES: ProfessionProfile[] = [
  IT_PROFILE,
  MARKETING_PROFILE,
  FOUNDER_PROFILE,
  DEVELOPER_PROFILE,
  RESEARCH_PROFILE,
  SALES_PROFILE,
  TRADER_PROFILE,
  LEGAL_PROFILE,
  CREATIVE_PROFILE,
  HEALTHCARE_ADMIN_PROFILE,
];

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
