// ── CapabilityMatrix.ts — Engine-to-profession capability definitions ───────────
//
// Maps TriForge engines to the professional blueprints they power.
// Used by CapabilityResolver to determine which engines activate for a given
// blueprint and to validate blueprint toolsets during activation.

import type { Capability } from './CapabilityTypes';

export const CAPABILITY_MATRIX: Capability[] = [
  {
    id:          'autonomous_monitoring',
    engine:      'AutonomyEngine',
    description: 'Detect system events and trigger workflows automatically',
    professions: ['it', 'cybersecurity', 'logistics'],
    requiredSensors: ['fileWatcher', 'webMonitor'],
  },

  {
    id:          'multi_model_consensus',
    engine:      'CouncilDecisionBus',
    description: 'Three-model strategic deliberation with voting and synthesis',
    professions: ['founder', 'consultant', 'research', 'trader'],
  },

  {
    id:          'engineering_evolution',
    engine:      'EvolutionEngine',
    description: 'Iterative code experimentation and sandbox verification',
    professions: ['developer'],
    requiredTools: ['read_file', 'write_file', 'run_command'],
  },

  {
    id:          'workflow_automation',
    engine:      'AutonomyController',
    description: 'Event-driven task execution with approval gating',
    professions: ['business_operator', 'sales', 'marketing'],
    requiredSensors: ['inboxWatcher', 'fileWatcher'],
  },

  {
    id:          'knowledge_memory',
    engine:      'CouncilMemoryGraph',
    description: 'Persistent cross-session engineering and decision memory',
    professions: ['developer', 'research', 'founder', 'trader'],
  },

  {
    id:          'voice_operation',
    engine:      'VoiceConversation',
    description: 'Wake-word voice command interface with hands-free mode',
    professions: ['voice', 'logistics', 'field_technician'],
    requiredSensors: ['voiceWatcher'],
  },

  {
    id:          'patch_prioritization',
    engine:      'PatchScorer',
    description: 'CVE-weighted patch prioritization using NIST NVD',
    professions: ['it', 'cybersecurity', 'developer'],
    requiredTools: ['web_search', 'read_file'],
  },

  {
    id:          'invoice_anomaly_detection',
    engine:      'InvoiceAnomalyDetector',
    description: 'Automated financial document anomaly detection',
    professions: ['business_operator', 'healthcare_admin', 'legal'],
    requiredSensors: ['fileWatcher'],
    requiredTools: ['read_file'],
  },

  {
    id:          'compound_learning',
    engine:      'CompoundEngine',
    description: 'A/B variant testing and adaptive outreach strategy learning',
    professions: ['sales', 'marketing', 'founder'],
  },

  {
    id:          'mission_evolution',
    engine:      'MissionEvolutionEngine',
    description: 'Self-improving mission planning based on outcome metrics',
    professions: [
      'developer', 'founder', 'consultant', 'research',
      'product_manager', 'business_operator',
    ],
  },

  {
    id:          'proactive_insights',
    engine:      'InsightEngine',
    description: 'Ambient council insights surfaced without a user prompt',
    professions: [
      'founder', 'trader', 'product_manager',
      'research', 'cybersecurity',
    ],
  },

  {
    id:          'contradiction_detection',
    engine:      'ContradictionDetector',
    description: 'Cross-source contradiction analysis for research and strategy',
    professions: ['research', 'consultant', 'legal', 'trader'],
  },
];
