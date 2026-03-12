// ── signupFlowBuilder.ts — Build signup flow with follow-up sequence ─────────
//
// Creates a SignupFlow: form fields, CTA copy, confirmation message,
// and a follow-up email sequence. Pure function — no AI calls.

import type { CaptureType, SignupFlow } from '../ventureTypes';
import type { BrandAssets } from '../ventureTypes';

/**
 * Build a complete signup flow for a capture type.
 * Includes form fields, CTA, confirmation, and follow-up sequence.
 */
export function buildSignupFlow(
  captureType: CaptureType,
  brand: BrandAssets,
  leadMagnetTitle?: string,
): SignupFlow {
  switch (captureType) {
    case 'email_signup':
      return {
        captureType: 'email_signup',
        formFields: ['email'],
        ctaCopy: `Get ${brand.brandName} updates free`,
        confirmationMessage: `You're subscribed to ${brand.brandName}! Check your inbox for a welcome email.`,
        followUpSequence: buildFollowUpSequence(brand, 'newsletter', leadMagnetTitle),
      };

    case 'waitlist':
      return {
        captureType: 'waitlist',
        formFields: ['email', 'name'],
        ctaCopy: `Join the ${brand.brandName} Waitlist`,
        confirmationMessage: `You're on the list! We'll notify you as soon as ${brand.brandName} launches.`,
        followUpSequence: buildFollowUpSequence(brand, 'waitlist', leadMagnetTitle),
      };

    case 'free_guide':
      return {
        captureType: 'free_guide',
        formFields: ['email', 'name'],
        ctaCopy: leadMagnetTitle ? `Get "${leadMagnetTitle}" Free` : 'Get the Free Guide',
        confirmationMessage: `Your guide is on its way! Check your inbox for the download link.`,
        followUpSequence: buildFollowUpSequence(brand, 'guide', leadMagnetTitle),
      };

    case 'contact_form':
      return {
        captureType: 'contact_form',
        formFields: ['name', 'email', 'phone', 'message'],
        ctaCopy: 'Send Message',
        confirmationMessage: `Thanks for reaching out! ${brand.brandName} will respond within 24 hours.`,
        followUpSequence: buildFollowUpSequence(brand, 'inquiry', leadMagnetTitle),
      };

    case 'community_join':
      return {
        captureType: 'community_join',
        formFields: ['email', 'name'],
        ctaCopy: `Join ${brand.brandName}`,
        confirmationMessage: `Welcome to the ${brand.brandName} community! Check your email for access.`,
        followUpSequence: buildFollowUpSequence(brand, 'community', leadMagnetTitle),
      };

    default:
      return {
        captureType: 'email_signup',
        formFields: ['email'],
        ctaCopy: 'Subscribe',
        confirmationMessage: `Thanks for subscribing to ${brand.brandName}!`,
        followUpSequence: buildFollowUpSequence(brand, 'newsletter', leadMagnetTitle),
      };
  }
}

// ── Follow-up sequence builder ───────────────────────────────────────────────

function buildFollowUpSequence(
  brand: BrandAssets,
  type: 'newsletter' | 'waitlist' | 'guide' | 'inquiry' | 'community',
  leadMagnetTitle?: string,
): string[] {
  const name = brand.brandName;

  switch (type) {
    case 'newsletter':
      return [
        `Day 0: Welcome email — introduce ${name}, set expectations for content frequency`,
        `Day 1: First value email — share one actionable insight`,
        `Day 3: Brand story — why ${name} exists and what makes it different`,
        `Day 7: Best-of email — top resources or most popular content`,
        `Day 14: Engagement check — ask what topics they want covered`,
      ];

    case 'waitlist':
      return [
        `Day 0: Waitlist confirmation — you're in, here's what to expect`,
        `Day 3: Behind the scenes — share progress on what you're building`,
        `Day 7: Early access offer — invite them to help shape the product`,
        `Day 14: Update email — share a milestone or preview`,
        `Launch day: Access email — you're in, here's your link`,
      ];

    case 'guide':
      return [
        `Day 0: Delivery email — download link for "${leadMagnetTitle ?? 'the guide'}"`,
        `Day 1: Follow-up — did you get it? Here's a quick win from page 1`,
        `Day 3: Deep dive — expand on one key concept from the guide`,
        `Day 5: Case study — real results from applying the guide`,
        `Day 7: Next step — introduce the paid offer or deeper engagement`,
      ];

    case 'inquiry':
      return [
        `Immediate: Auto-reply — thanks for reaching out, we'll respond within 24 hours`,
        `Day 1: Personal response — answer their question, provide value`,
        `Day 3: Follow-up — check if they need anything else`,
        `Day 7: Value email — share a relevant resource or tip`,
        `Day 14: Check-in — are they ready to move forward?`,
      ];

    case 'community':
      return [
        `Day 0: Welcome email — access link, community guidelines, where to start`,
        `Day 1: Introduction prompt — encourage them to introduce themselves`,
        `Day 3: Highlight email — best discussions or resources this week`,
        `Day 7: Engagement email — invite them to participate in a thread or event`,
        `Day 14: Value recap — what they've missed, encourage return visits`,
      ];

    default:
      return [
        `Day 0: Welcome email`,
        `Day 3: Value delivery`,
        `Day 7: Engagement check`,
      ];
  }
}
