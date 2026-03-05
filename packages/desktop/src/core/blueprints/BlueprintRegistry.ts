// ── BlueprintRegistry.ts — Canonical list of all blueprint IDs ────────────────
//
// This is the single source of truth for valid blueprint IDs.
// Add new blueprints here BEFORE creating their definition files.
// BlueprintLoader validates against this list at load time.

import type { BlueprintId } from './BlueprintTypes';

export const BLUEPRINT_IDS: BlueprintId[] = [
  // ── Core professional roles ──────────────────────────────────────────────────
  'developer',        // Software engineers, full-stack, DevOps, engineering leads
  'founder',          // Startup founders, solo operators, executive decision-makers
  'marketing',        // Marketing managers, growth hackers, content strategists
  'it',               // IT support, sysadmins, helpdesk, infrastructure ops
  'research',         // Researchers, analysts, academics, fact-checkers
  'business',         // General business professionals, operations, strategy

  // ── Expanded profession profiles ─────────────────────────────────────────────
  'business_operator',  // Business owners managing daily operations end-to-end
  'consultant',         // Independent consultants, advisors, project-based workers
  'trader',             // Day traders, swing traders, portfolio managers
  'sales',              // Sales reps, account executives, BDRs, closers
  'voice',              // Voice-first users, accessibility-focused, power voice users
  'filmmaker',          // Directors, editors, video producers, content creators
  'real_estate',        // Agents, brokers, investors, property managers
  'legal',              // Lawyers, paralegals, compliance officers, contract reviewers
  'healthcare_admin',   // Healthcare administrators, medical office managers, coordinators
  'cybersecurity',      // Security analysts, pen testers, incident responders, SOC
  'data_science',       // Data scientists, ML engineers, BI analysts, data engineers
  'product_manager',    // PMs, product owners, feature leads, roadmap owners
  'educator',           // Teachers, trainers, curriculum designers, coaches
  'logistics',          // Supply chain, warehouse ops, fleet managers, dispatchers
  'power_user',         // Advanced users who want full control and max automation
];

/** Lookup map for O(1) validation. */
const BLUEPRINT_ID_SET = new Set<string>(BLUEPRINT_IDS);

/** Returns true if the given string is a registered blueprint ID. */
export function isValidBlueprintId(id: string): id is BlueprintId {
  return BLUEPRINT_ID_SET.has(id);
}

/** Returns a human-readable label for a blueprint ID. */
export function getBlueprintLabel(id: BlueprintId): string {
  const labels: Record<BlueprintId, string> = {
    developer:          'Software Developer',
    founder:            'Founder / CEO',
    marketing:          'Marketing',
    it:                 'IT Support',
    research:           'Research & Analysis',
    business:           'Business Professional',
    business_operator:  'Business Operator',
    consultant:         'Consultant / Advisor',
    trader:             'Trader / Investor',
    sales:              'Sales',
    voice:              'Voice-First',
    filmmaker:          'Filmmaker / Creator',
    real_estate:        'Real Estate',
    legal:              'Legal',
    healthcare_admin:   'Healthcare Admin',
    cybersecurity:      'Cybersecurity',
    data_science:       'Data Science / ML',
    product_manager:    'Product Manager',
    educator:           'Educator / Trainer',
    logistics:          'Logistics / Operations',
    power_user:         'Power User',
  };
  return labels[id] ?? id;
}
