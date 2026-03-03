// social/facebook.ts — Facebook Graph API (Page access token)
// Credentials stored via CredentialManager:
//   social:facebook:page_access_token, social:facebook:page_id

import https from 'https';
import type { CredentialManager } from '../credentials';
import type { PostResult } from './index';

function httpsPost(url: string, body: string, headers: Record<string, string>): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      { hostname: u.hostname, path: u.pathname + u.search, method: 'POST', headers },
      res => {
        let data = '';
        res.on('data', (c: Buffer) => { data += c.toString(); });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
      },
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

export async function postToFacebook(
  creds: CredentialManager,
  content: string,
  _mediaBase64?: string,
): Promise<PostResult> {
  const pageToken = await creds.getByName('social:facebook:page_access_token');
  const pageId    = await creds.getByName('social:facebook:page_id');

  if (!pageToken || !pageId) {
    return { ok: false, platform: 'facebook', error: 'Facebook credentials not configured. Set page_access_token and page_id in Settings → Credentials.' };
  }

  const bodyStr = JSON.stringify({ message: content.slice(0, 63_206), access_token: pageToken });
  const res = await httpsPost(
    `https://graph.facebook.com/v19.0/${pageId}/feed`,
    bodyStr,
    {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(bodyStr).toString(),
    },
  );

  if (res.status === 200) {
    const json = JSON.parse(res.body) as { id?: string };
    const postId = json.id;
    return { ok: true, platform: 'facebook', postId };
  }
  return { ok: false, platform: 'facebook', error: `Facebook API error ${res.status}: ${res.body}` };
}

export function draftFacebookPost(content: string): string {
  return content.slice(0, 63_206);
}
