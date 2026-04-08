// ── platforms/tiktokClient.ts ─────────────────────────────────────────────────
//
// Phase 5 — TikTok Content Posting API v2 client
//
// Handles OAuth 2.0 and video uploads to TikTok.
//
// Setup required:
//   1. Create an app at developers.tiktok.com
//   2. Request "Content Posting API" product access
//   3. Add scopes: video.publish, video.upload
//   4. Enter Client Key + Secret in TriForge → Settings → Social Accounts → TikTok
//
// Upload flow:
//   1. Initialize upload → get upload_url + publish_id
//   2. Upload video data to upload_url (chunked PUT)
//   3. Check publish status until PUBLISH_COMPLETE
//
// API docs: https://developers.tiktok.com/doc/content-posting-api-reference-upload-video

import https from 'https';
import http  from 'http';
import fs    from 'fs';
import path  from 'path';

const TIKTOK_API   = 'open.tiktokapis.com';
const TIKTOK_AUTH  = 'www.tiktok.com';

export interface TikTokCredentials {
  clientKey:    string;
  clientSecret: string;
}

export interface TikTokTokens {
  accessToken:  string;
  refreshToken: string;
  expiresAt:    number;
  openId:       string;
}

export interface TikTokVideoMeta {
  title:         string;
  /** 'PUBLIC_TO_EVERYONE' | 'MUTUAL_FOLLOW_FRIENDS' | 'FOLLOWER_OF_CREATOR' | 'SELF_ONLY' */
  privacyLevel?: 'PUBLIC_TO_EVERYONE' | 'MUTUAL_FOLLOW_FRIENDS' | 'FOLLOWER_OF_CREATOR' | 'SELF_ONLY';
  disableDuet?:  boolean;
  disableStitch?: boolean;
  disableComment?: boolean;
  /** Max 150 chars */
  caption?:      string;
}

export interface TikTokUploadResult {
  ok:        boolean;
  publishId?: string;
  shareUrl?:  string;
  error?:    string;
}

// ── OAuth ──────────────────────────────────────────────────────────────────────

const TIKTOK_SCOPES = 'video.publish,video.upload';

export function buildTikTokAuthUrl(creds: TikTokCredentials, redirectUri: string): string {
  const params = new URLSearchParams({
    client_key:    creds.clientKey,
    redirect_uri:  redirectUri,
    response_type: 'code',
    scope:         TIKTOK_SCOPES,
  });
  return `https://${TIKTOK_AUTH}/v2/auth/authorize/?${params}`;
}

export async function exchangeTikTokCode(
  creds:       TikTokCredentials,
  code:        string,
  redirectUri: string,
): Promise<TikTokTokens> {
  const body = new URLSearchParams({
    client_key:    creds.clientKey,
    client_secret: creds.clientSecret,
    code,
    grant_type:    'authorization_code',
    redirect_uri:  redirectUri,
  });

  const data = await apiPost('/v2/oauth/token/', body.toString(), 'application/x-www-form-urlencoded');
  if (!data.data?.access_token) throw new Error(`TikTok token exchange failed: ${JSON.stringify(data)}`);

  const d = data.data as {
    access_token: string;
    refresh_token: string;
    expires_in: number;
    open_id: string;
  };

  return {
    accessToken:  d.access_token,
    refreshToken: d.refresh_token,
    expiresAt:    Date.now() + (d.expires_in ?? 86400) * 1000,
    openId:       d.open_id,
  };
}

export async function refreshTikTokToken(
  creds:  TikTokCredentials,
  tokens: TikTokTokens,
): Promise<TikTokTokens> {
  const body = new URLSearchParams({
    client_key:    creds.clientKey,
    client_secret: creds.clientSecret,
    grant_type:    'refresh_token',
    refresh_token: tokens.refreshToken,
  });

  const data = await apiPost('/v2/oauth/token/', body.toString(), 'application/x-www-form-urlencoded');
  if (!data.data?.access_token) throw new Error(`TikTok token refresh failed: ${JSON.stringify(data)}`);

  const d = data.data as { access_token: string; refresh_token: string; expires_in: number };
  return {
    ...tokens,
    accessToken:  d.access_token,
    refreshToken: d.refresh_token ?? tokens.refreshToken,
    expiresAt:    Date.now() + (d.expires_in ?? 86400) * 1000,
  };
}

// ── Upload ─────────────────────────────────────────────────────────────────────

/**
 * Upload a video to TikTok using the Content Posting API.
 * The video is posted directly from the file (no public URL required).
 *
 * @param accessToken  Valid TikTok access token (from exchangeTikTokCode)
 * @param videoPath    Local path to the video file (MP4, max 4 GB)
 * @param meta         Title, privacy, caption, interaction settings
 */
export async function uploadVideoToTikTok(
  accessToken: string,
  videoPath:   string,
  meta:        TikTokVideoMeta,
): Promise<TikTokUploadResult> {
  try {
    const stat     = await fs.promises.stat(videoPath);
    const fileSize = stat.size;
    const chunkSize = 10 * 1024 * 1024; // 10 MB chunks
    const totalChunks = Math.ceil(fileSize / chunkSize);

    // Step 1: Initialize upload
    const initBody = {
      post_info: {
        title:           meta.title.slice(0, 150),
        privacy_level:   meta.privacyLevel ?? 'SELF_ONLY',
        disable_duet:    meta.disableDuet    ?? false,
        disable_stitch:  meta.disableStitch  ?? false,
        disable_comment: meta.disableComment ?? false,
        video_cover_timestamp_ms: 1000,
      },
      source_info: {
        source:       'FILE_UPLOAD',
        video_size:   fileSize,
        chunk_size:   chunkSize,
        total_chunk_count: totalChunks,
      },
    };

    const initData = await apiPost(
      '/v2/post/publish/video/init/',
      JSON.stringify(initBody),
      'application/json; charset=UTF-8',
      accessToken,
    );

    const uploadUrl  = initData.data?.upload_url as string | undefined;
    const publishId  = initData.data?.publish_id  as string | undefined;

    if (!uploadUrl || !publishId) {
      return { ok: false, error: `Init failed: ${JSON.stringify(initData)}` };
    }

    // Step 2: Upload chunks
    const handle = await fs.promises.open(videoPath, 'r');
    try {
      for (let i = 0; i < totalChunks; i++) {
        const start = i * chunkSize;
        const end   = Math.min(start + chunkSize - 1, fileSize - 1);
        const len   = end - start + 1;
        const buf   = Buffer.alloc(len);
        await handle.read(buf, 0, len, start);
        await uploadTikTokChunk(uploadUrl, buf, start, end, fileSize);
      }
    } finally {
      await handle.close();
    }

    // Step 3: Poll for publish status
    for (let attempt = 0; attempt < 20; attempt++) {
      await sleep(3000);
      const statusData = await apiPost(
        '/v2/post/publish/status/fetch/',
        JSON.stringify({ publish_id: publishId }),
        'application/json; charset=UTF-8',
        accessToken,
      );
      const status = statusData.data?.status as string | undefined;
      if (status === 'PUBLISH_COMPLETE') {
        return { ok: true, publishId };
      }
      if (status === 'FAILED') {
        const reason = statusData.data?.fail_reason as string | undefined;
        return { ok: false, error: `TikTok publish failed: ${reason ?? 'Unknown reason'}` };
      }
    }

    return { ok: false, error: 'TikTok publish status polling timed out.' };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

async function uploadTikTokChunk(
  uploadUrl: string,
  chunk:     Buffer,
  start:     number,
  end:       number,
  total:     number,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const url = new URL(uploadUrl);
    const mod = url.protocol === 'https:' ? https : http;

    const options = {
      hostname: url.hostname,
      path:     url.pathname + url.search,
      method:   'PUT',
      headers:  {
        'Content-Type':   'video/mp4',
        'Content-Length': chunk.length,
        'Content-Range':  `bytes ${start}-${end}/${total}`,
      },
    };

    const req = mod.request(options, res => {
      res.resume();
      if (res.statusCode && res.statusCode >= 400) {
        reject(new Error(`TikTok chunk upload failed: HTTP ${res.statusCode}`));
      } else {
        resolve();
      }
    });
    req.on('error', reject);
    req.write(chunk);
    req.end();
  });
}

async function apiPost(
  urlPath:     string,
  body:        string,
  contentType: string,
  accessToken?: string,
): Promise<{ data?: Record<string, unknown>; error?: Record<string, unknown> }> {
  return new Promise((resolve, reject) => {
    const headers: Record<string, string | number> = {
      'Content-Type':   contentType,
      'Content-Length': Buffer.byteLength(body),
    };
    if (accessToken) headers['Authorization'] = `Bearer ${accessToken}`;

    const options = {
      hostname: TIKTOK_API,
      path:     urlPath,
      method:   'POST',
      headers,
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', (d: Buffer) => { data += d.toString(); });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { reject(new Error(`Non-JSON: ${data}`)); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}
