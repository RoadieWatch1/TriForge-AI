// social/reddit.ts — Reddit API (OAuth2 script app)
// Credentials stored via CredentialManager:
//   social:reddit:client_id, social:reddit:client_secret
//   social:reddit:username, social:reddit:password

import https from 'https';
import type { CredentialManager } from '../credentials';
import type { PostResult } from './index';

function httpsRequest(
  method: string,
  url: string,
  body: string,
  headers: Record<string, string>,
): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const req = https.request(
      { hostname: u.hostname, path: u.pathname + u.search, method, headers },
      res => {
        let data = '';
        res.on('data', (c: Buffer) => { data += c.toString(); });
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: data }));
      },
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

async function getRedditToken(clientId: string, clientSecret: string, username: string, password: string): Promise<string> {
  const body = `grant_type=password&username=${encodeURIComponent(username)}&password=${encodeURIComponent(password)}`;
  const basicAuth = Buffer.from(`${clientId}:${clientSecret}`).toString('base64');
  const res = await httpsRequest('POST', 'https://www.reddit.com/api/v1/access_token', body, {
    Authorization: `Basic ${basicAuth}`,
    'Content-Type': 'application/x-www-form-urlencoded',
    'User-Agent': 'TriForge AI/1.0',
    'Content-Length': Buffer.byteLength(body).toString(),
  });
  if (res.status !== 200) throw new Error(`Reddit auth failed ${res.status}: ${res.body}`);
  const json = JSON.parse(res.body) as { access_token?: string };
  if (!json.access_token) throw new Error('Reddit: no access_token in response');
  return json.access_token;
}

export async function postToReddit(
  creds: CredentialManager,
  content: string,
): Promise<PostResult> {
  const clientId     = await creds.getByName('social:reddit:client_id');
  const clientSecret = await creds.getByName('social:reddit:client_secret');
  const username     = await creds.getByName('social:reddit:username');
  const password     = await creds.getByName('social:reddit:password');
  const subreddit    = await creds.getByName('social:reddit:subreddit') ?? 'test';
  const title        = await creds.getByName('social:reddit:default_title') ?? 'Post from TriForge AI';

  if (!clientId || !clientSecret || !username || !password) {
    return { ok: false, platform: 'reddit', error: 'Reddit credentials not configured. Set client_id, client_secret, username, password in Settings → Credentials.' };
  }

  const token = await getRedditToken(clientId, clientSecret, username, password);
  const body  = `sr=${encodeURIComponent(subreddit)}&kind=self&title=${encodeURIComponent(title)}&text=${encodeURIComponent(content)}`;

  const res = await httpsRequest('POST', 'https://oauth.reddit.com/api/submit', body, {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/x-www-form-urlencoded',
    'User-Agent': 'TriForge AI/1.0',
    'Content-Length': Buffer.byteLength(body).toString(),
  });

  if (res.status === 200) {
    const json = JSON.parse(res.body) as { json?: { data?: { url?: string; id?: string } } };
    const postUrl = json.json?.data?.url;
    const postId  = json.json?.data?.id;
    return { ok: true, platform: 'reddit', postId, url: postUrl };
  }
  return { ok: false, platform: 'reddit', error: `Reddit API error ${res.status}: ${res.body}` };
}

export function draftRedditPost(content: string): string {
  return content;
}
