// ── operator/socialPacks.ts ───────────────────────────────────────────────────
//
// Phase 5 — Social Media Publishing Workflow Packs
//
// Four packs for publishing content to social platforms:
//
//   pack.publish-youtube    — OAuth auth + resumable video upload to YouTube
//   pack.publish-facebook   — OAuth auth + photo/video post to Facebook Page
//   pack.publish-instagram  — OAuth auth + image/reel post to Instagram
//   pack.publish-tiktok     — OAuth auth + video upload to TikTok
//
// Each pack follows the same structure:
//   1. social_auth          — check if connected; open OAuth flow if not
//   2. social_select_file   — confirm the file path to publish
//   3. social_upload_*      — upload/publish (approval-gated)
//   4. report               — return the published URL/ID artifact

import type { WorkflowPack } from './workflowPackTypes';

// ── Shared phase helpers ──────────────────────────────────────────────────────

const AUTH_PHASE = (platform: string) => ({
  id:          'auth',
  name:        `Connect ${platform} Account`,
  description: `Checks for a stored ${platform} token. If not connected, opens the browser OAuth flow.`,
  kind:        'social_auth' as const,
  requiresApproval: false,
  onFailure:   'stop' as const,
});

const SELECT_FILE_PHASE = {
  id:          'select-file',
  name:        'Select File to Publish',
  description: 'Confirms the local file path (image or video) to upload.',
  kind:        'social_select_file' as const,
  requiresApproval: false,
  onFailure:   'stop' as const,
};

const REPORT_PHASE = {
  id:          'report',
  name:        'Build Publish Report',
  description: 'Returns the published post ID, URL, and platform confirmation.',
  kind:        'report' as const,
  requiresApproval: false,
  onFailure:   'warn_continue' as const,
};

// ── Pack: YouTube ─────────────────────────────────────────────────────────────

export const PUBLISH_YOUTUBE: WorkflowPack = {
  id:      'pack.publish-youtube',
  name:    'Publish to YouTube',
  tagline: 'Upload a video file to your YouTube channel.',
  description:
    'Authenticates with YouTube (OAuth 2.0 via Google) and uploads a local video file. ' +
    'Supports all common video formats (MP4, MOV, AVI, MKV). ' +
    'Resumable upload handles large files reliably. ' +
    'Videos are uploaded as private by default — you can change visibility in YouTube Studio. ' +
    'Requires: a Google Cloud project with YouTube Data API v3 enabled and an OAuth 2.0 Client ID.',
  category: 'handoff',
  version:  '1.0.0',
  requirements: {
    platforms:        ['macOS', 'Windows'],
    capabilities:     [],
    permissions:      {},
    targetApp:        null,
    providerRequired: false,
  },
  phases: [
    AUTH_PHASE('YouTube'),
    SELECT_FILE_PHASE,
    {
      id:               'upload',
      name:             'Upload Video to YouTube',
      description:      'Uploads the video using the YouTube Data API v3 resumable upload protocol.',
      kind:             'social_upload_youtube',
      requiresApproval: true,
      approvalDescription:
        'Upload this video to your YouTube channel? ' +
        'It will be posted as private — you can change visibility in YouTube Studio after upload.',
      onFailure: 'stop',
    },
    REPORT_PHASE,
  ],
  tags: ['youtube', 'video', 'upload', 'publish', 'social', 'google'],
  estimatedDurationSec: 120,
  successCriteria: 'Video uploaded to YouTube and video ID returned.',
};

// ── Pack: Facebook ────────────────────────────────────────────────────────────

export const PUBLISH_FACEBOOK: WorkflowPack = {
  id:      'pack.publish-facebook',
  name:    'Post to Facebook',
  tagline: 'Share a photo or video on your Facebook Page.',
  description:
    'Authenticates with Facebook (OAuth 2.0) and posts an image or video to a Facebook Page you manage. ' +
    'Supports JPEG, PNG images and MP4/MOV videos. ' +
    'Personal profile posting is not supported by Meta\'s API — a Facebook Page is required. ' +
    'Requires: a Facebook Developer App with pages_manage_posts permission.',
  category: 'handoff',
  version:  '1.0.0',
  requirements: {
    platforms:        ['macOS', 'Windows'],
    capabilities:     [],
    permissions:      {},
    targetApp:        null,
    providerRequired: false,
  },
  phases: [
    AUTH_PHASE('Facebook'),
    SELECT_FILE_PHASE,
    {
      id:               'upload',
      name:             'Post to Facebook Page',
      description:      'Posts the selected photo or video to your Facebook Page via the Graph API.',
      kind:             'social_upload_facebook',
      requiresApproval: true,
      approvalDescription:
        'Post this content to your Facebook Page? ' +
        'This will be publicly visible on your Page immediately.',
      onFailure: 'stop',
    },
    REPORT_PHASE,
  ],
  tags: ['facebook', 'photo', 'video', 'post', 'publish', 'social', 'page'],
  estimatedDurationSec: 30,
  successCriteria: 'Photo or video posted to Facebook Page and post ID returned.',
};

// ── Pack: Instagram ───────────────────────────────────────────────────────────

export const PUBLISH_INSTAGRAM: WorkflowPack = {
  id:      'pack.publish-instagram',
  name:    'Post to Instagram',
  tagline: 'Share an image or Reel on your Instagram Business account.',
  description:
    'Authenticates via Facebook (Instagram Graph API) and publishes an image or video Reel ' +
    'to an Instagram Business or Creator account. ' +
    'Images: JPEG/PNG with 4:5–1:1 aspect ratio recommended. ' +
    'Reels (video): MP4, H.264, 9:16 aspect ratio, max 15 minutes. ' +
    'Requires: Instagram Business/Creator account linked to a Facebook Page you manage, ' +
    'and a Facebook Developer App with instagram_content_publish permission.',
  category: 'handoff',
  version:  '1.0.0',
  requirements: {
    platforms:        ['macOS', 'Windows'],
    capabilities:     [],
    permissions:      {},
    targetApp:        null,
    providerRequired: false,
  },
  phases: [
    AUTH_PHASE('Instagram'),
    SELECT_FILE_PHASE,
    {
      id:               'upload',
      name:             'Post to Instagram',
      description:      'Creates a media container and publishes it to your Instagram account via the Graph API.',
      kind:             'social_upload_instagram',
      requiresApproval: true,
      approvalDescription:
        'Publish this content to your Instagram account? ' +
        'It will be posted immediately and visible to your followers.',
      onFailure: 'stop',
    },
    REPORT_PHASE,
  ],
  tags: ['instagram', 'photo', 'reel', 'video', 'post', 'publish', 'social'],
  estimatedDurationSec: 45,
  successCriteria: 'Media published to Instagram and media ID returned.',
};

// ── Pack: TikTok ──────────────────────────────────────────────────────────────

export const PUBLISH_TIKTOK: WorkflowPack = {
  id:      'pack.publish-tiktok',
  name:    'Post to TikTok',
  tagline: 'Upload a video to your TikTok account.',
  description:
    'Authenticates with TikTok (OAuth 2.0) and uploads a video using the Content Posting API. ' +
    'Supported formats: MP4, max 4 GB. Best results: 9:16 vertical, 1080×1920 resolution. ' +
    'Videos are posted as private ("Only me") by default for review before publishing. ' +
    'Requires: a TikTok Developer App with Content Posting API access and video.publish + video.upload scopes.',
  category: 'handoff',
  version:  '1.0.0',
  requirements: {
    platforms:        ['macOS', 'Windows'],
    capabilities:     [],
    permissions:      {},
    targetApp:        null,
    providerRequired: false,
  },
  phases: [
    AUTH_PHASE('TikTok'),
    SELECT_FILE_PHASE,
    {
      id:               'upload',
      name:             'Upload Video to TikTok',
      description:      'Uploads the video via TikTok Content Posting API (chunked upload).',
      kind:             'social_upload_tiktok',
      requiresApproval: true,
      approvalDescription:
        'Upload this video to your TikTok account? ' +
        'It will be posted as "Only me" (private) by default.',
      onFailure: 'stop',
    },
    REPORT_PHASE,
  ],
  tags: ['tiktok', 'video', 'upload', 'publish', 'social', 'reel'],
  estimatedDurationSec: 90,
  successCriteria: 'Video uploaded to TikTok and publish ID returned.',
};
