// ── ventureLeadCaptureBuilder.ts — Build lead capture components ─────────────
//
// Creates capture components (email signup, waitlist, free guide, contact form,
// community join) with appropriate form fields, CTA copy, and confirmation messages.
// Pure function — no AI calls.

import type { CaptureComponent, CaptureType } from '../ventureTypes';

/**
 * Build a capture component for a specific type and brand.
 * Returns form fields, CTA copy, and confirmation message.
 */
export function buildCaptureComponent(
  captureType: CaptureType,
  brandName: string,
  ctaOverride?: string,
): CaptureComponent {
  switch (captureType) {
    case 'email_signup':
      return {
        type: 'email_signup',
        formFields: ['email'],
        ctaCopy: ctaOverride ?? `Subscribe to ${brandName}`,
        confirmationMessage: `You're in! Check your inbox for a welcome email from ${brandName}.`,
      };

    case 'waitlist':
      return {
        type: 'waitlist',
        formFields: ['email', 'name'],
        ctaCopy: ctaOverride ?? 'Join the Waitlist',
        confirmationMessage: `You're on the list! We'll notify you as soon as ${brandName} is ready.`,
      };

    case 'free_guide':
      return {
        type: 'free_guide',
        formFields: ['email', 'name'],
        ctaCopy: ctaOverride ?? 'Get the Free Guide',
        confirmationMessage: `Your guide is on its way! Check your inbox for your download link from ${brandName}.`,
      };

    case 'contact_form':
      return {
        type: 'contact_form',
        formFields: ['name', 'email', 'phone', 'message'],
        ctaCopy: ctaOverride ?? 'Send Message',
        confirmationMessage: `Thanks for reaching out! ${brandName} will get back to you within 24 hours.`,
      };

    case 'community_join':
      return {
        type: 'community_join',
        formFields: ['email', 'name'],
        ctaCopy: ctaOverride ?? `Join the ${brandName} Community`,
        confirmationMessage: `Welcome to the community! Check your email for your access link to ${brandName}.`,
      };

    default:
      return {
        type: 'email_signup',
        formFields: ['email'],
        ctaCopy: ctaOverride ?? 'Subscribe',
        confirmationMessage: `Thanks for subscribing to ${brandName}!`,
      };
  }
}

/**
 * Get recommended form fields for a capture type.
 * Useful for UI rendering when building custom capture forms.
 */
export function getRecommendedFields(captureType: CaptureType): string[] {
  switch (captureType) {
    case 'email_signup':     return ['email'];
    case 'waitlist':         return ['email', 'name'];
    case 'free_guide':       return ['email', 'name'];
    case 'contact_form':     return ['name', 'email', 'phone', 'message'];
    case 'community_join':   return ['email', 'name'];
    default:                 return ['email'];
  }
}
