// ── actionGateClassifier.ts — Map all venture actions to gate levels ─────────
//
// Provides a registry of common venture actions with their default gate levels.
// Used by the operator policy engine and IPC handlers to classify actions
// before execution.

import type { VentureAction, VentureActionCategory } from './founderAuthorityTypes';
import type { ActionGateLevel } from '../ventureTypes';

// ── Action registry ──────────────────────────────────────────────────────────

interface ActionTemplate {
  category: VentureActionCategory;
  description: string;
  defaultGate: ActionGateLevel;
  estimatedCost?: number;
  requiresExternalAccount?: boolean;
  isLegalBinding?: boolean;
}

const ACTION_REGISTRY: Record<string, ActionTemplate> = {
  // Content
  'content:create_post':      { category: 'content', description: 'Create a social media post', defaultGate: 'fully_autonomous' },
  'content:create_article':   { category: 'content', description: 'Write a blog article', defaultGate: 'fully_autonomous' },
  'content:create_video':     { category: 'content', description: 'Script a video', defaultGate: 'fully_autonomous' },
  'content:create_email':     { category: 'content', description: 'Write a marketing email', defaultGate: 'fully_autonomous' },
  'content:create_lead_magnet': { category: 'content', description: 'Create a lead magnet', defaultGate: 'fully_autonomous' },

  // Social
  'social:post':              { category: 'social', description: 'Publish a social media post', defaultGate: 'fully_autonomous' },
  'social:engage':            { category: 'social', description: 'Engage with comments and replies', defaultGate: 'fully_autonomous' },
  'social:follow':            { category: 'social', description: 'Follow relevant accounts', defaultGate: 'fully_autonomous' },
  'social:dm':                { category: 'social', description: 'Send a direct message', defaultGate: 'autonomous_under_cap' },

  // Email
  'email:send_newsletter':    { category: 'email', description: 'Send newsletter to subscriber list', defaultGate: 'autonomous_under_cap' },
  'email:send_nurture':       { category: 'email', description: 'Send nurture sequence email', defaultGate: 'fully_autonomous' },
  'email:cold_outreach':      { category: 'email', description: 'Send cold outreach email', defaultGate: 'autonomous_under_cap' },

  // Advertising
  'ads:create_campaign':      { category: 'advertising', description: 'Create an ad campaign', defaultGate: 'autonomous_under_cap', requiresExternalAccount: true },
  'ads:adjust_budget':        { category: 'advertising', description: 'Adjust ad campaign budget', defaultGate: 'autonomous_under_cap' },
  'ads:pause_campaign':       { category: 'advertising', description: 'Pause an ad campaign', defaultGate: 'fully_autonomous' },
  'ads:launch_campaign':      { category: 'advertising', description: 'Launch an ad campaign', defaultGate: 'requires_approval', requiresExternalAccount: true },

  // Website
  'site:update_content':      { category: 'website', description: 'Update website content', defaultGate: 'fully_autonomous' },
  'site:update_design':       { category: 'website', description: 'Update website design', defaultGate: 'fully_autonomous' },
  'site:add_page':            { category: 'website', description: 'Add a new page to the website', defaultGate: 'fully_autonomous' },
  'site:deploy':              { category: 'website', description: 'Deploy website changes', defaultGate: 'fully_autonomous' },

  // Brand
  'brand:change_name':        { category: 'brand', description: 'Change brand name', defaultGate: 'requires_approval' },
  'brand:change_positioning': { category: 'brand', description: 'Change brand positioning', defaultGate: 'requires_approval' },
  'brand:change_colors':      { category: 'brand', description: 'Update brand colors', defaultGate: 'requires_approval' },

  // Budget
  'budget:reallocate':        { category: 'budget', description: 'Reallocate budget between categories', defaultGate: 'requires_approval' },
  'budget:increase':          { category: 'budget', description: 'Request additional budget', defaultGate: 'requires_approval' },

  // Purchases
  'purchase:tool':            { category: 'purchase', description: 'Purchase a tool or subscription', defaultGate: 'requires_approval', requiresExternalAccount: true },
  'purchase:domain':          { category: 'purchase', description: 'Purchase a domain name', defaultGate: 'requires_approval', requiresExternalAccount: true },
  'purchase:hosting':         { category: 'purchase', description: 'Purchase hosting', defaultGate: 'requires_approval', requiresExternalAccount: true },

  // Filing
  'filing:prepare_ein':       { category: 'filing', description: 'Prepare EIN application', defaultGate: 'fully_autonomous' },
  'filing:submit_ein':        { category: 'filing', description: 'Submit EIN application', defaultGate: 'requires_legal_auth', isLegalBinding: true },
  'filing:prepare_state':     { category: 'filing', description: 'Prepare state filing documents', defaultGate: 'fully_autonomous' },
  'filing:submit_state':      { category: 'filing', description: 'Submit state filing', defaultGate: 'requires_legal_auth', isLegalBinding: true },
  'filing:prepare_compliance': { category: 'filing', description: 'Set up compliance calendar', defaultGate: 'fully_autonomous' },
  'filing:prepare_bookkeeping': { category: 'filing', description: 'Set up bookkeeping system', defaultGate: 'fully_autonomous' },

  // Legal
  'legal:draft_terms':        { category: 'legal', description: 'Draft terms of service', defaultGate: 'fully_autonomous' },
  'legal:draft_privacy':      { category: 'legal', description: 'Draft privacy policy', defaultGate: 'fully_autonomous' },
  'legal:sign_contract':      { category: 'legal', description: 'Sign a legal contract', defaultGate: 'requires_legal_auth', isLegalBinding: true },

  // Financial
  'finance:open_account':     { category: 'financial', description: 'Open a business bank account', defaultGate: 'requires_legal_auth', isLegalBinding: true, requiresExternalAccount: true },
  'finance:setup_payments':   { category: 'financial', description: 'Set up payment processing', defaultGate: 'requires_legal_auth', requiresExternalAccount: true },
  'finance:transfer':         { category: 'financial', description: 'Transfer funds', defaultGate: 'requires_legal_auth', isLegalBinding: true },
};

/**
 * Look up a registered action by its ID.
 * Returns a VentureAction if found, null otherwise.
 */
export function getRegisteredAction(actionId: string): VentureAction | null {
  const template = ACTION_REGISTRY[actionId];
  if (!template) return null;

  return {
    id: actionId,
    category: template.category,
    description: template.description,
    estimatedCost: template.estimatedCost,
    requiresExternalAccount: template.requiresExternalAccount,
    isLegalBinding: template.isLegalBinding,
  };
}

/**
 * Get all registered actions for a category.
 */
export function getActionsForCategory(category: VentureActionCategory): VentureAction[] {
  return Object.entries(ACTION_REGISTRY)
    .filter(([, t]) => t.category === category)
    .map(([id, t]) => ({
      id,
      category: t.category,
      description: t.description,
      estimatedCost: t.estimatedCost,
      requiresExternalAccount: t.requiresExternalAccount,
      isLegalBinding: t.isLegalBinding,
    }));
}

/**
 * Get all actions that require legal authorization.
 */
export function getLegalAuthActions(): VentureAction[] {
  return Object.entries(ACTION_REGISTRY)
    .filter(([, t]) => t.defaultGate === 'requires_legal_auth')
    .map(([id, t]) => ({
      id,
      category: t.category,
      description: t.description,
      estimatedCost: t.estimatedCost,
      requiresExternalAccount: t.requiresExternalAccount,
      isLegalBinding: t.isLegalBinding,
    }));
}

/**
 * Get all actions that the Council can execute autonomously.
 */
export function getAutonomousActions(): VentureAction[] {
  return Object.entries(ACTION_REGISTRY)
    .filter(([, t]) => t.defaultGate === 'fully_autonomous')
    .map(([id, t]) => ({
      id,
      category: t.category,
      description: t.description,
      estimatedCost: t.estimatedCost,
      requiresExternalAccount: t.requiresExternalAccount,
      isLegalBinding: t.isLegalBinding,
    }));
}

/**
 * List all action IDs in the registry.
 */
export function listActionIds(): string[] {
  return Object.keys(ACTION_REGISTRY);
}
