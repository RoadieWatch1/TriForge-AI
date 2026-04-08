// ── platforms/youtubeClient.ts ────────────────────────────────────────────────
//
// Phase 5 — YouTube Data API v3 client
//
// Handles OAuth 2.0 (Google) and resumable video uploads.
//
// Setup required (one-time, in TriForge settings):
//   1. Create a project at console.cloud.google.com
//   2. Enable "YouTube Data API v3"
//   3. Create OAuth 2.0 Client ID (Desktop app type)
//   4. Enter Client ID + Secret in TriForge → Settings → Social Accounts → YouTube
//
// API docs: https://developers.google.com/youtube/v3/guides/uploading_a_video

import https  from 'https';
import http   from 'http';
import fs     from 'fs';
import path   from 'path';

export interface YouTubeCredentials {
  clientId:     string;
  clientSecret: string;
}

export interface YouTubeTokens {
  accessToken:  string;
  refreshToken: string;
  expiresAt:    number;
}

export interface YouTubeVideoMeta {
  title:       string;
  description: string;
  tags?:       string[];
  /** 'public' | 'unlisted' | 'private' — default: 'private' for safety */
  privacy?:    'public' | 'unlisted' | 'private';
  /** YouTube category ID (22 = People & Blogs, 10 = Music, 20 = Gaming…) */
  categoryId?: string;
}

export interface YouTubeUploadResult {
  ok:       boolean;
  videoId?: string;
  videoUrl?: string;
  error?:   string;
}

// ── OAuth helpers ──────────────────────────────────────────────────────────────

const GOOGLE_TOKEN_URL    = 'https://oauth2.googleapis.com/token';
const YOUTUBE_SCOPES      = 'https://www.googleapis.com/auth/youtube.upload https://www.googleapis.com/auth/youtube';

/** Build the Google OAuth authorization URL. */
export function buildYouTubeAuthUrl(creds: YouTubeCredentials, redirectUri: string): string {
  const params = new URLSearchParams({
    client_id:     creds.clientId,
    redirect_uri:  redirectUri,
    response_type: 'code',
    scope:         YOUTUBE_SCOPES,
    access_type:   'offline',
    prompt:        'consent',
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

/** Exchange an authorization code for access + refresh tokens. */
export async function exchangeYouTubeCode(
  creds:       YouTubeCredentials,
  code:        string,
  redirectUri: string,
): Promise<YouTubeTokens> {
  const body = new URLSearchParams({
    code,
    client_id:     creds.clientId,
    client_secret: creds.clientSecret,
    redirect_uri:  redirectUri,
    grant_type:    'authorization_code',
  });

  const data = await postForm(GOOGLE_TOKEN_URL, body.toString());
  if (!data.access_token) throw new Error(`Token exchange failed: ${JSON.stringify(data)}`);

  return {
    accessToken:  data.access_token as string,
    refreshToken: (data.refresh_token as string) ?? '',
    expiresAt:    Date.now() + ((data.expires_in as number) ?? 3600) * 1000,
  };
}

/** Refresh an expired access token using the refresh token. */
export async function refreshYouTubeToken(
  creds:  YouTubeCredentials,
  tokens: YouTubeTokens,
): Promise<YouTubeTokens> {
  const body = new URLSearchParams({
    refresh_token: tokens.refreshToken,
    client_id:     creds.clientId,
    client_secret: creds.clientSecret,
    grant_type:    'refresh_token',
  });

  const data = await postForm(GOOGLE_TOKEN_URL, body.toString());
  if (!data.access_token) throw new Error(`Token refresh failed: ${JSON.stringify(data)}`);

  return {
    ...tokens,
    accessToken: data.access_token as string,
    expiresAt:   Date.now() + ((data.expires_in as number) ?? 3600) * 1000,
  };
}

// ── Upload ─────────────────────────────────────────────────────────────────────

/**
 * Upload a video file to YouTube using the resumable upload protocol.
 * This handles files of any size by chunking them (256 KB chunks).
 *
 * @param accessToken  Valid YouTube OAuth access token
 * @param videoPath    Local path to the video file
 * @param meta         Title, description, tags, privacy
 */
export async function uploadVideoToYouTube(
  accessToken: string,
  videoPath:   string,
  meta:        YouTubeVideoMeta,
): Promise<YouTubeUploadResult> {
  const stat = await fs.promises.stat(videoPath);
  const fileSize = stat.size;
  const mimeType = guessMimeType(videoPath);

  // Step 1: Initiate the resumable upload session
  const initBody = JSON.stringify({
    snippet: {
      title:       meta.title,
      description: meta.description,
      tags:        meta.tags ?? [],
      categoryId:  meta.categoryId ?? '22',
    },
    status: {
      privacyStatus: meta.privacy ?? 'private',
    },
  });

  const uploadUrl = await initiateResumableUpload(accessToken, initBody, fileSize, mimeType);

  // Step 2: Upload file data in 8 MB chunks
  const chunkSize = 8 * 1024 * 1024;
  const handle    = await fs.promises.open(videoPath, 'r');
  let offset = 0;
  let videoId: string | undefined;

  try {
    while (offset < fileSize) {
      const end    = Math.min(offset + chunkSize - 1, fileSize - 1);
      const length = end - offset + 1;
      const buf    = Buffer.alloc(length);
      await handle.read(buf, 0, length, offset);

      const response = await uploadChunk(uploadUrl, buf, offset, end, fileSize);

      if (response.id) {
        videoId = response.id as string;
        break;
      }

      offset = end + 1;
    }
  } finally {
    await handle.close();
  }

  if (!videoId) {
    return { ok: false, error: 'Upload completed but YouTube did not return a video ID.' };
  }

  return {
    ok:       true,
    videoId,
    videoUrl: `https://youtu.be/${videoId}`,
  };
}

// ── Internal helpers ──────────────────────────────────────────────────────────

function guessMimeType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    '.mp4':  'video/mp4',
    '.mov':  'video/quicktime',
    '.avi':  'video/x-msvideo',
    '.mkv':  'video/x-matroska',
    '.webm': 'video/webm',
  };
  return map[ext] ?? 'video/mp4';
}

async function initiateResumableUpload(
  accessToken: string,
  metadata:    string,
  fileSize:    number,
  mimeType:    string,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'www.googleapis.com',
      path:     '/upload/youtube/v3/videos?uploadType=resumable&part=snippet,status',
      method:   'POST',
      headers:  {
        'Authorization':           `Bearer ${accessToken}`,
        'Content-Type':            'application/json',
        'X-Upload-Content-Type':   mimeType,
        'X-Upload-Content-Length': fileSize,
        'Content-Length':          Buffer.byteLength(metadata),
      },
    };

    const req = https.request(options, res => {
      res.resume();
      const location = res.headers['location'];
      if (!location || res.statusCode !== 200) {
        reject(new Error(`Resumable upload init failed: HTTP ${res.statusCode}`));
      } else {
        resolve(location as string);
      }
    });
    req.on('error', reject);
    req.write(metadata);
    req.end();
  });
}

async function uploadChunk(
  uploadUrl: string,
  chunk:     Buffer,
  start:     number,
  end:       number,
  total:     number,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const url  = new URL(uploadUrl);
    const mod  = url.protocol === 'https:' ? https : http;

    const options = {
      hostname: url.hostname,
      path:     url.pathname + url.search,
      method:   'PUT',
      headers:  {
        'Content-Length': chunk.length,
        'Content-Range':  `bytes ${start}-${end}/${total}`,
      },
    };

    const req = mod.request(options, res => {
      let body = '';
      res.on('data', (d: Buffer) => { body += d.toString(); });
      res.on('end', () => {
        if (res.statusCode === 308) {
          // Incomplete — more chunks needed
          resolve({});
          return;
        }
        try {
          resolve(JSON.parse(body));
        } catch {
          resolve({});
        }
      });
    });
    req.on('error', reject);
    req.write(chunk);
    req.end();
  });
}

async function postForm(url: string, body: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: new URL(url).hostname,
      path:     new URL(url).pathname,
      method:   'POST',
      headers:  {
        'Content-Type':   'application/x-www-form-urlencoded',
        'Content-Length': Buffer.byteLength(body),
      },
    };

    const req = https.request(options, res => {
      let data = '';
      res.on('data', (d: Buffer) => { data += d.toString(); });
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch { reject(new Error(`Non-JSON response: ${data}`)); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}
