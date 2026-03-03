// social/linkedin.ts — LinkedIn API (OAuth2 bearer token)
// Credentials stored via CredentialManager:
//   social:linkedin:access_token, social:linkedin:person_urn (urn:li:person:XXXX)

import https from 'https';
import type { CredentialManager } from '../credentials';
import type { PostResult } from './index';

function httpsPost(url: string, body: string, headers: Record<string, string>): Promise<{ status: number; body: string; location?: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      { hostname: u.hostname, path: u.pathname + u.search, method: 'POST', headers },
      res => {
        let data = '';
        res.on('data', (c: Buffer) => { data += c.toString(); });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data, location: res.headers['x-restli-id'] as string | undefined }));
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

export async function postToLinkedIn(
  creds: CredentialManager,
  content: string,
  _mediaBase64?: string,
): Promise<PostResult> {
  const accessToken = await creds.getByName('social:linkedin:access_token');
  const personUrn   = await creds.getByName('social:linkedin:person_urn');

  if (!accessToken || !personUrn) {
    return { ok: false, platform: 'linkedin', error: 'LinkedIn credentials not configured. Set access_token and person_urn in Settings → Credentials.' };
  }

  const post = {
    author: personUrn,
    lifecycleState: 'PUBLISHED',
    specificContent: {
      'com.linkedin.ugc.ShareContent': {
        shareCommentary: { text: content.slice(0, 3000) },
        shareMediaCategory: 'NONE',
      },
    },
    visibility: { 'com.linkedin.ugc.MemberNetworkVisibility': 'PUBLIC' },
  };

  const bodyStr = JSON.stringify(post);
  const res = await httpsPost('https://api.linkedin.com/v2/ugcPosts', bodyStr, {
    Authorization: `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(bodyStr).toString(),
    'X-Restli-Protocol-Version': '2.0.0',
  });

  if (res.status === 201) {
    const postId = res.location;
    return { ok: true, platform: 'linkedin', postId };
  }
  return { ok: false, platform: 'linkedin', error: `LinkedIn API error ${res.status}: ${res.body}` };
}

export function draftLinkedInPost(content: string): string {
  return content.slice(0, 3000);
}
