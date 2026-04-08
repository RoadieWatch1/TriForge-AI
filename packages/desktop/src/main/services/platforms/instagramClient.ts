// ── platforms/instagramClient.ts ──────────────────────────────────────────────
//
// Phase 5 — Instagram Graph API client (via Facebook)
//
// Instagram's Content Publishing API requires:
//   - A Facebook Page connected to a Business or Creator Instagram account
//   - pages_manage_posts + instagram_basic + instagram_content_publish scopes
//
// Publishing flow (container model):
//   1. Create a media container (image or reel/video)
//   2. Wait for container to finish processing
//   3. Publish the container
//
// For images: the image must be hosted at a public URL OR uploaded via
// the Facebook CDN first. TriForge uploads to the Facebook CDN automatically.
//
// Setup required:
//   Use the same Facebook App as facebookClient.ts — the Instagram account
//   must be connected to a Facebook Page the user manages.

import https from 'https';
import fs    from 'fs';
import FormData from './formData';

const GRAPH_API = 'graph.facebook.com';
const API_VER   = 'v20.0';

export const INSTAGRAM_SCOPES =
  'instagram_basic,instagram_content_publish,pages_read_engagement';

export interface InstagramPublishResult {
  ok:      boolean;
  mediaId?: string;
  error?:  string;
}

// ── Discover IG user ID ───────────────────────────────────────────────────────

/** Get the Instagram Business Account ID connected to a Facebook Page. */
export async function getInstagramUserId(
  pageId:          string,
  pageAccessToken: string,
): Promise<string | null> {
  const path = `/${API_VER}/${pageId}?fields=instagram_business_account&access_token=${pageAccessToken}`;
  const data = await graphGet(path);
  return (data as { instagram_business_account?: { id: string } })?.instagram_business_account?.id ?? null;
}

// ── Image ─────────────────────────────────────────────────────────────────────

/**
 * Upload a local image to Facebook's CDN to get a publicly accessible URL,
 * then create an Instagram image container and publish it.
 */
export async function postImageToInstagram(
  igUserId:        string,
  pageAccessToken: string,
  imagePath:       string,
  caption:         string,
): Promise<InstagramPublishResult> {
  try {
    // Step 1: Upload image to Facebook's CDN (get a hosted URL)
    const imageUrl = await uploadImageToCDN(imagePath, pageAccessToken);

    // Step 2: Create Instagram image container
    const containerData = await graphPost(
      `/${API_VER}/${igUserId}/media`,
      { image_url: imageUrl, caption, access_token: pageAccessToken },
    );
    const containerId = containerData.id as string | undefined;
    if (!containerId) {
      return { ok: false, error: `Container creation failed: ${JSON.stringify(containerData)}` };
    }

    // Step 3: Wait for container to be ready (IG processes media asynchronously)
    await waitForContainer(igUserId, containerId, pageAccessToken);

    // Step 4: Publish
    const publishData = await graphPost(
      `/${API_VER}/${igUserId}/media_publish`,
      { creation_id: containerId, access_token: pageAccessToken },
    );
    const mediaId = publishData.id as string | undefined;
    if (!mediaId) return { ok: false, error: 'Publish step returned no media ID.' };

    return { ok: true, mediaId };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/**
 * Upload a video (Reel) to Instagram.
 * Videos must be MP4, H.264, max 15 minutes, 9:16 aspect ratio preferred.
 */
export async function postVideoToInstagram(
  igUserId:        string,
  pageAccessToken: string,
  videoPath:       string,
  caption:         string,
): Promise<InstagramPublishResult> {
  try {
    // Step 1: Upload video to Facebook CDN
    const videoUrl = await uploadVideoToCDN(videoPath, pageAccessToken);

    // Step 2: Create Reel container
    const containerData = await graphPost(
      `/${API_VER}/${igUserId}/media`,
      {
        video_url:    videoUrl,
        caption,
        media_type:   'REELS',
        access_token: pageAccessToken,
      },
    );
    const containerId = containerData.id as string | undefined;
    if (!containerId) {
      return { ok: false, error: `Reel container creation failed: ${JSON.stringify(containerData)}` };
    }

    // Step 3: Wait for processing (videos take longer)
    await waitForContainer(igUserId, containerId, pageAccessToken, 60_000);

    // Step 4: Publish
    const publishData = await graphPost(
      `/${API_VER}/${igUserId}/media_publish`,
      { creation_id: containerId, access_token: pageAccessToken },
    );
    const mediaId = publishData.id as string | undefined;
    if (!mediaId) return { ok: false, error: 'Reel publish returned no media ID.' };

    return { ok: true, mediaId };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ── Internal helpers ──────────────────────────────────────────────────────────

async function uploadImageToCDN(imagePath: string, accessToken: string): Promise<string> {
  // Use Facebook's /me/photos with published=false to upload to CDN and get a URL
  const form = new FormData();
  form.append('access_token', accessToken);
  form.append('published',    'false');
  form.appendFile('source', imagePath);

  const data = await formPost(`/${API_VER}/me/photos`, form);
  // The post_id is returned — fetch the photo URL via /{photo-id}?fields=images
  const photoId = data.id as string | undefined;
  if (!photoId) throw new Error('CDN image upload failed — no photo ID returned.');

  const photoData = await graphGet(`/${API_VER}/${photoId}?fields=images&access_token=${accessToken}`);
  const images    = (photoData as { images?: Array<{ source: string }> })?.images;
  const url       = images?.[0]?.source;
  if (!url) throw new Error('CDN image upload succeeded but no image URL in response.');
  return url;
}

async function uploadVideoToCDN(videoPath: string, accessToken: string): Promise<string> {
  // Use Facebook's graph-video endpoint to upload
  const form = new FormData();
  form.append('access_token', accessToken);
  form.append('published',    'false');
  form.appendFile('source', videoPath);

  const data = await formPost(`/${API_VER}/me/videos`, form, 'graph-video.facebook.com');
  const videoId = data.id as string | undefined;
  if (!videoId) throw new Error('CDN video upload failed — no video ID returned.');

  // Return the video URL — IG will pull from FB CDN
  const videoData = await graphGet(`/${API_VER}/${videoId}?fields=source&access_token=${accessToken}`);
  const url = (videoData as { source?: string }).source;
  if (!url) throw new Error('CDN video upload succeeded but no source URL.');
  return url;
}

async function waitForContainer(
  igUserId:    string,
  containerId: string,
  token:       string,
  maxMs =      30_000,
): Promise<void> {
  const deadline = Date.now() + maxMs;
  while (Date.now() < deadline) {
    const data = await graphGet(
      `/${API_VER}/${containerId}?fields=status_code&access_token=${token}`,
    );
    const status = (data as { status_code?: string }).status_code;
    if (status === 'FINISHED') return;
    if (status === 'ERROR') throw new Error('Instagram media container processing failed.');
    await sleep(3000);
  }
  throw new Error('Instagram container processing timed out.');
}

function sleep(ms: number): Promise<void> {
  return new Promise(r => setTimeout(r, ms));
}

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

async function graphPost(
  urlPath: string,
  params:  Record<string, string>,
): Promise<Record<string, unknown>> {
  const body = new URLSearchParams(params).toString();
  return new Promise((resolve, reject) => {
    const options = {
      hostname: GRAPH_API,
      path:     urlPath,
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
        try { resolve(JSON.parse(data)); } catch { reject(new Error(`Non-JSON: ${data}`)); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function formPost(
  urlPath:  string,
  form:     FormData,
  hostname: string = GRAPH_API,
): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const options = {
      hostname,
      path:    urlPath,
      method:  'POST',
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
