// ── platforms/facebookClient.ts ───────────────────────────────────────────────
//
// Phase 5 — Facebook Graph API client
//
// Handles OAuth 2.0 and photo/video publishing to Facebook Pages.
//
// Setup required:
//   1. Create a Facebook App at developers.facebook.com
//   2. Add "Facebook Login" product
//   3. Enable pages_manage_posts + pages_read_engagement + pages_show_list scopes
//   4. Enter App ID + Secret in TriForge → Settings → Social Accounts → Facebook
//
// Note: Publishing to personal profiles requires the publish_actions permission
// which Meta no longer grants to new apps. Pages are supported without restriction.

import https from 'https';
import fs    from 'fs';
import path  from 'path';
import FormData from './formData';

export interface FacebookCredentials {
  appId:     string;
  appSecret: string;
}

export interface FacebookPage {
  id:          string;
  name:        string;
  accessToken: string;
}

export interface FacebookPostResult {
  ok:      boolean;
  postId?: string;
  error?:  string;
}

const GRAPH_API = 'graph.facebook.com';
const API_VER   = 'v20.0';
const FB_SCOPES = 'pages_manage_posts,pages_read_engagement,pages_show_list,publish_video';

// ── OAuth ──────────────────────────────────────────────────────────────────────

export function buildFacebookAuthUrl(creds: FacebookCredentials, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id:     creds.appId,
    redirect_uri:  redirectUri,
    response_type: 'code',
    scope:         FB_SCOPES,
  });
  return `https://www.facebook.com/${API_VER}/dialog/oauth?${params}`;
}

export async function exchangeFacebookCode(
  creds:       FacebookCredentials,
  code:        string,
  redirectUri: string,
): Promise<string> {
  const params = new URLSearchParams({
    client_id:     creds.appId,
    client_secret: creds.appSecret,
    redirect_uri:  redirectUri,
    code,
  });
  const data = await graphGet(`/oauth/access_token?${params}`);
  if (!data.access_token) throw new Error(`FB token exchange failed: ${JSON.stringify(data)}`);
  return data.access_token as string;
}

/** List Facebook Pages the user manages with their page access tokens. */
export async function listFacebookPages(userAccessToken: string): Promise<FacebookPage[]> {
  const data = await graphGet(`/me/accounts?access_token=${userAccessToken}&fields=id,name,access_token`);
  const raw  = (data.data ?? []) as Array<{ id: string; name: string; access_token: string }>;
  return raw.map(p => ({ id: p.id, name: p.name, accessToken: p.access_token }));
}

// ── Publish ────────────────────────────────────────────────────────────────────

/**
 * Post a photo to a Facebook Page.
 * @param imagePath  Local path to the image file (JPEG or PNG)
 * @param caption    Post caption
 */
export async function postPhotoToFacebook(
  page:      FacebookPage,
  imagePath: string,
  caption:   string,
): Promise<FacebookPostResult> {
  try {
    const form = new FormData();
    form.append('message',      caption);
    form.append('access_token', page.accessToken);
    form.appendFile('source', imagePath);

    const data = await formPost(`/${API_VER}/${page.id}/photos`, form);
    if (data.id) return { ok: true, postId: data.id as string };
    return { ok: false, error: (data.error as { message: string })?.message ?? 'Unknown error' };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/**
 * Post a video to a Facebook Page.
 * Uses the non-resumable upload (files up to ~1 GB).
 */
export async function postVideoToFacebook(
  page:      FacebookPage,
  videoPath: string,
  title:     string,
  description: string,
): Promise<FacebookPostResult> {
  try {
    const form = new FormData();
    form.append('title',        title);
    form.append('description',  description);
    form.append('access_token', page.accessToken);
    form.appendFile('source', videoPath);

    const data = await formPost(`/${API_VER}/${page.id}/videos`, form, true);
    if (data.id) return { ok: true, postId: data.id as string };
    return { ok: false, error: (data.error as { message: string })?.message ?? 'Unknown error' };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

async function graphGet(urlPath: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    https.get({ hostname: GRAPH_API, path: urlPath }, res => {
      let body = '';
      res.on('data', (d: Buffer) => { body += d.toString(); });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch { reject(new Error(`Non-JSON: ${body}`)); }
      });
    }).on('error', reject);
  });
}

async function formPost(
  urlPath: string,
  form:    FormData,
  videoEndpoint = false,
): Promise<Record<string, unknown>> {
  const hostname = videoEndpoint ? 'graph-video.facebook.com' : GRAPH_API;
  return new Promise((resolve, reject) => {
    const options = {
      hostname,
      path:   urlPath,
      method: 'POST',
      headers: form.getHeaders(),
    };
    const req = https.request(options, res => {
      let body = '';
      res.on('data', (d: Buffer) => { body += d.toString(); });
      res.on('end', () => {
        try { resolve(JSON.parse(body)); } catch { reject(new Error(`Non-JSON: ${body}`)); }
      });
    });
    req.on('error', reject);
    form.pipe(req);
  });
}
