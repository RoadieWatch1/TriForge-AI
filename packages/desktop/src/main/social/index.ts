// social/index.ts — SocialPoster: unified interface for posting to social platforms
// Credentials are fetched via CredentialManager (keyed by 'social:<platform>:<field>')
// Supported platforms: twitter, linkedin, reddit, facebook

import { postToTwitter, draftTwitterPost } from './twitter';
import { postToLinkedIn, draftLinkedInPost } from './linkedin';
import { postToReddit, draftRedditPost } from './reddit';
import { postToFacebook, draftFacebookPost } from './facebook';
import type { CredentialManager } from '../credentials';

export interface PostResult {
  ok: boolean;
  platform: string;
  postId?: string;
  url?: string;
  error?: string;
}

export interface DraftResult {
  ok: boolean;
  platform: string;
  draft: string;
  characterCount: number;
  characterLimit: number;
}

const CHARACTER_LIMITS: Record<string, number> = {
  twitter: 280,
  linkedin: 3000,
  reddit: 40_000,
  facebook: 63_206,
};

export class SocialPoster {
  constructor(private creds: CredentialManager) {}

  async post(platform: string, content: string, mediaBase64?: string): Promise<PostResult> {
    const p = platform.toLowerCase();
    try {
      switch (p) {
        case 'twitter':  return await postToTwitter(this.creds, content, mediaBase64);
        case 'linkedin': return await postToLinkedIn(this.creds, content, mediaBase64);
        case 'reddit':   return await postToReddit(this.creds, content);
        case 'facebook': return await postToFacebook(this.creds, content, mediaBase64);
        default: return { ok: false, platform, error: `Platform "${platform}" not supported. Supported: twitter, linkedin, reddit, facebook` };
      }
    } catch (e) {
      return { ok: false, platform, error: e instanceof Error ? e.message : String(e) };
    }
  }

  draft(platform: string, content: string): DraftResult {
    const p = platform.toLowerCase();
    const limit = CHARACTER_LIMITS[p] ?? 1000;
    let draftFn: (content: string) => string;
    switch (p) {
      case 'twitter':  draftFn = draftTwitterPost;  break;
      case 'linkedin': draftFn = draftLinkedInPost; break;
      case 'reddit':   draftFn = draftRedditPost;   break;
      case 'facebook': draftFn = draftFacebookPost;  break;
      default:         draftFn = (c) => c;
    }
    const draft = draftFn(content);
    return {
      ok: true,
      platform: p,
      draft,
      characterCount: draft.length,
      characterLimit: limit,
    };
  }
}
