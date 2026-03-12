// ── audienceTypes.ts — Audience growth data model ────────────────────────────
//
// Types specific to the audience growth pipeline. Core types (AudienceGoal,
// LeadCaptureAsset, SubscriberSegment, OwnedAudienceMetrics, FollowerGrowthPlan)
// live in ventureTypes.ts. This file adds pipeline-specific types.

import type { CaptureType } from '../ventureTypes';

// ── Content calendar ─────────────────────────────────────────────────────────

export interface ContentCalendarEntry {
  day: number;            // day 1-30
  channel: string;        // "X/Twitter", "YouTube Shorts", etc.
  contentType: string;    // "thread", "short video", "blog post", etc.
  topic: string;          // specific topic or hook
  goal: string;           // "drive signups", "build authority", etc.
}

// ── Audience segment targeting ───────────────────────────────────────────────

export interface AudienceSegmentTarget {
  label: string;
  description: string;
  channels: string[];
  messagingAngle: string;
  estimatedSize: 'small' | 'medium' | 'large';
}

// ── Lead magnet asset ────────────────────────────────────────────────────────

export interface LeadMagnetAsset {
  type: string;               // "ebook", "checklist", "template", "video", "mini-course"
  title: string;
  description: string;
  deliveryMethod: string;     // "email", "download page", "drip sequence"
  estimatedCreationTime: string;
  captureType: CaptureType;
}

// ── Nurture sequence ─────────────────────────────────────────────────────────

export interface NurtureStep {
  dayOffset: number;          // days after signup
  type: 'email' | 'sms' | 'push';
  subject: string;
  purpose: string;            // "welcome", "value delivery", "soft pitch", etc.
}

export interface NurtureSequence {
  name: string;
  steps: NurtureStep[];
  conversionGoal: string;
}

// ── Growth metrics snapshot ──────────────────────────────────────────────────

export interface GrowthSnapshot {
  date: number;               // timestamp
  totalSubscribers: number;
  newSubscribersToday: number;
  totalFollowers: number;
  newFollowersToday: number;
  emailOpenRate: number;
  clickRate: number;
  topChannel: string;
  topContent: string;
}
