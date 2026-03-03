// social/twitter.ts — Twitter API v2 (OAuth 1.0a user context for posting)
// Credentials stored via CredentialManager:
//   social:twitter:api_key, social:twitter:api_secret
//   social:twitter:access_token, social:twitter:access_secret

import https from 'https';
import crypto from 'crypto';
import type { CredentialManager } from '../credentials';
import type { PostResult } from './index';

function percentEncode(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, c => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
}

function buildOAuth1Header(
  method: string,
  url: string,
  params: Record<string, string>,
  apiKey: string,
  apiSecret: string,
  accessToken: string,
  accessSecret: string,
): string {
  const oauthParams: Record<string, string> = {
    oauth_consumer_key: apiKey,
    oauth_nonce: crypto.randomBytes(16).toString('hex'),
    oauth_signature_method: 'HMAC-SHA1',
    oauth_timestamp: Math.floor(Date.now() / 1000).toString(),
    oauth_token: accessToken,
    oauth_version: '1.0',
  };
  const allParams = { ...params, ...oauthParams };
  const sortedKeys = Object.keys(allParams).sort();
  const paramStr = sortedKeys.map(k => `${percentEncode(k)}=${percentEncode(allParams[k])}`).join('&');
  const sigBase = `${method.toUpperCase()}&${percentEncode(url)}&${percentEncode(paramStr)}`;
  const sigKey = `${percentEncode(apiSecret)}&${percentEncode(accessSecret)}`;
  const sig = crypto.createHmac('sha1', sigKey).update(sigBase).digest('base64');
  oauthParams['oauth_signature'] = sig;
  const header = Object.entries(oauthParams)
    .map(([k, v]) => `${percentEncode(k)}="${percentEncode(v)}"`)
    .join(', ');
  return `OAuth ${header}`;
}

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

export async function postToTwitter(
  creds: CredentialManager,
  content: string,
  _mediaBase64?: string,
): Promise<PostResult> {
  const apiKey     = await creds.getByName('social:twitter:api_key');
  const apiSecret  = await creds.getByName('social:twitter:api_secret');
  const accToken   = await creds.getByName('social:twitter:access_token');
  const accSecret  = await creds.getByName('social:twitter:access_secret');

  if (!apiKey || !apiSecret || !accToken || !accSecret) {
    return { ok: false, platform: 'twitter', error: 'Twitter credentials not configured. Set them in Settings → Credentials.' };
  }

  const endpoint = 'https://api.twitter.com/2/tweets';
  const bodyObj  = { text: content.slice(0, 280) };
  const bodyStr  = JSON.stringify(bodyObj);
  const authHeader = buildOAuth1Header('POST', endpoint, {}, apiKey, apiSecret, accToken, accSecret);

  const res = await httpsPost(endpoint, bodyStr, {
    Authorization: authHeader,
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(bodyStr).toString(),
  });

  if (res.status === 201) {
    const json = JSON.parse(res.body) as { data?: { id?: string } };
    const postId = json.data?.id;
    return { ok: true, platform: 'twitter', postId, url: postId ? `https://twitter.com/i/web/status/${postId}` : undefined };
  }
  return { ok: false, platform: 'twitter', error: `Twitter API error ${res.status}: ${res.body}` };
}

export function draftTwitterPost(content: string): string {
  return content.slice(0, 280);
}
