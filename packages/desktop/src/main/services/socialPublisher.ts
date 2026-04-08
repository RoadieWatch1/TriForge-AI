// ── socialPublisher.ts ────────────────────────────────────────────────────────
//
// Phase 5 — Social Media Publishing: Orchestration Service
//
// Coordinates OAuth flows, credential storage, and content uploads for:
//   YouTube, Facebook, Instagram, TikTok
//
// OAuth setup per platform:
//   - User enters their platform app credentials (clientId/secret) once
//   - TriForge opens the auth URL in the system browser
//   - Local callback server catches the code
//   - Token is encrypted and stored via credentialStore
//
// Credential management:
//   - socialPublisher.getAuthStatus()        → which platforms are connected
//   - socialPublisher.connectPlatform(...)   → start OAuth flow
//   - socialPublisher.disconnectPlatform(...)→ clear stored tokens
//
// Publishing:
//   - socialPublisher.publishToYouTube(...)
//   - socialPublisher.publishToFacebook(...)
//   - socialPublisher.publishToInstagram(...)
//   - socialPublisher.publishToTikTok(...)

import { shell }    from 'electron';
import { startOAuthListener }            from './oauthLocalServer';
import { saveTokens, loadTokens, clearTokens, getAuthStatus, type SocialPlatform } from './credentialStore';
import { buildYouTubeAuthUrl, exchangeYouTubeCode, refreshYouTubeToken, uploadVideoToYouTube }
  from './platforms/youtubeClient';
import { buildFacebookAuthUrl, exchangeFacebookCode, listFacebookPages, postPhotoToFacebook, postVideoToFacebook }
  from './platforms/facebookClient';
import { getInstagramUserId, postImageToInstagram, postVideoToInstagram, INSTAGRAM_SCOPES }
  from './platforms/instagramClient';
import { buildTikTokAuthUrl, exchangeTikTokCode, refreshTikTokToken, uploadVideoToTikTok }
  from './platforms/tiktokClient';
import type { YouTubeVideoMeta, YouTubeUploadResult } from './platforms/youtubeClient';
import type { FacebookPostResult }                   from './platforms/facebookClient';
import type { InstagramPublishResult }               from './platforms/instagramClient';
import type { TikTokVideoMeta, TikTokUploadResult }  from './platforms/tiktokClient';

// ── Credential inputs (user-configured in settings) ──────────────────────────

export interface YouTubeAppCreds   { clientId: string; clientSecret: string; }
export interface FacebookAppCreds  { appId: string;    appSecret: string; }
export interface TikTokAppCreds    { clientKey: string; clientSecret: string; }

// ── Auth status ───────────────────────────────────────────────────────────────

export { getAuthStatus };

// ── OAuth connect flows ───────────────────────────────────────────────────────

/** Start the YouTube OAuth flow. Opens the browser, waits for callback, stores tokens. */
export async function connectYouTube(creds: YouTubeAppCreds): Promise<{ ok: boolean; error?: string }> {
  try {
    const { redirectUri, codePromise } = await startOAuthListener();
    const authUrl = buildYouTubeAuthUrl(creds, redirectUri);
    await shell.openExternal(authUrl);

    const code   = await codePromise;
    const tokens = await exchangeYouTubeCode(creds, code, redirectUri);
    saveTokens('youtube', {
      accessToken:  tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt:    tokens.expiresAt,
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/** Start the Facebook OAuth flow. Stores user access token + first page token. */
export async function connectFacebook(creds: FacebookAppCreds): Promise<{ ok: boolean; error?: string }> {
  try {
    const { redirectUri, codePromise } = await startOAuthListener();
    const authUrl = buildFacebookAuthUrl(creds, redirectUri);
    await shell.openExternal(authUrl);

    const code        = await codePromise;
    const userToken   = await exchangeFacebookCode(creds, code, redirectUri);
    const pages       = await listFacebookPages(userToken);
    const firstPage   = pages[0];

    saveTokens('facebook', {
      accessToken: userToken,
      meta: {
        pageId:          firstPage?.id          ?? '',
        pageName:        firstPage?.name        ?? '',
        pageAccessToken: firstPage?.accessToken ?? userToken,
        allPagesJson:    JSON.stringify(pages),
      },
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/** Instagram reuses the Facebook OAuth flow — connects Instagram Business Account. */
export async function connectInstagram(creds: FacebookAppCreds): Promise<{ ok: boolean; error?: string }> {
  try {
    const { redirectUri, codePromise } = await startOAuthListener();
    // Build FB auth URL with Instagram-specific scopes added
    const params = new URLSearchParams({
      client_id:     creds.appId,
      redirect_uri:  redirectUri,
      response_type: 'code',
      scope:         `pages_manage_posts,pages_read_engagement,pages_show_list,${INSTAGRAM_SCOPES}`,
    });
    const authUrl = `https://www.facebook.com/v20.0/dialog/oauth?${params}`;
    await shell.openExternal(authUrl);

    const code      = await codePromise;
    const userToken = await exchangeFacebookCode(creds, code, redirectUri);
    const pages     = await listFacebookPages(userToken);
    const page      = pages[0];

    let igUserId = '';
    if (page) {
      igUserId = (await getInstagramUserId(page.id, page.accessToken)) ?? '';
    }

    saveTokens('instagram', {
      accessToken: userToken,
      meta: {
        pageId:          page?.id          ?? '',
        pageAccessToken: page?.accessToken ?? userToken,
        igUserId,
      },
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/** Start the TikTok OAuth flow. */
export async function connectTikTok(creds: TikTokAppCreds): Promise<{ ok: boolean; error?: string }> {
  try {
    const { redirectUri, codePromise } = await startOAuthListener();
    const authUrl = buildTikTokAuthUrl(creds, redirectUri);
    await shell.openExternal(authUrl);

    const code   = await codePromise;
    const tokens = await exchangeTikTokCode(creds, code, redirectUri);
    saveTokens('tiktok', {
      accessToken:  tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt:    tokens.expiresAt,
      meta: { openId: tokens.openId },
    });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/** Disconnect a platform (clears stored tokens). */
export function disconnectPlatform(platform: SocialPlatform): void {
  clearTokens(platform);
}

// ── Publishing ─────────────────────────────────────────────────────────────────

/**
 * Upload a video to YouTube.
 * Refreshes token automatically if expired.
 */
export async function publishToYouTube(
  creds:     YouTubeAppCreds,
  videoPath: string,
  meta:      YouTubeVideoMeta,
): Promise<YouTubeUploadResult> {
  const stored = loadTokens('youtube');
  if (!stored) return { ok: false, error: 'YouTube not connected. Run social_auth first.' };

  let accessToken = stored.accessToken;

  // Auto-refresh if expired
  if (stored.expiresAt && stored.expiresAt < Date.now() + 60_000) {
    try {
      const refreshed = await refreshYouTubeToken(creds, {
        accessToken:  stored.accessToken,
        refreshToken: stored.refreshToken ?? '',
        expiresAt:    stored.expiresAt,
      });
      saveTokens('youtube', { accessToken: refreshed.accessToken, refreshToken: refreshed.refreshToken, expiresAt: refreshed.expiresAt });
      accessToken = refreshed.accessToken;
    } catch {
      return { ok: false, error: 'YouTube token refresh failed. Please reconnect.' };
    }
  }

  return uploadVideoToYouTube(accessToken, videoPath, meta);
}

/**
 * Post a photo or video to a Facebook Page.
 */
export async function publishToFacebook(
  filePath:    string,
  caption:     string,
  isVideo = false,
  title = '',
): Promise<FacebookPostResult> {
  const stored = loadTokens('facebook');
  if (!stored) return { ok: false, error: 'Facebook not connected. Run social_auth first.' };

  const pageId          = stored.meta?.pageId;
  const pageAccessToken = stored.meta?.pageAccessToken;
  const pageName        = stored.meta?.pageName ?? 'your page';

  if (!pageId || !pageAccessToken) {
    return { ok: false, error: 'No Facebook Page found. Reconnect Facebook and ensure you manage at least one Page.' };
  }

  const page = { id: pageId, name: pageName, accessToken: pageAccessToken };

  if (isVideo) {
    return postVideoToFacebook(page, filePath, title || caption.slice(0, 80), caption);
  }
  return postPhotoToFacebook(page, filePath, caption);
}

/**
 * Post an image or video (Reel) to Instagram.
 */
export async function publishToInstagram(
  filePath: string,
  caption:  string,
  isVideo = false,
): Promise<InstagramPublishResult> {
  const stored = loadTokens('instagram');
  if (!stored) return { ok: false, error: 'Instagram not connected. Run social_auth first.' };

  const igUserId        = stored.meta?.igUserId;
  const pageAccessToken = stored.meta?.pageAccessToken;

  if (!igUserId || !pageAccessToken) {
    return { ok: false, error: 'No Instagram Business Account found. Reconnect and ensure your IG account is linked to a Facebook Page.' };
  }

  if (isVideo) {
    return postVideoToInstagram(igUserId, pageAccessToken, filePath, caption);
  }
  return postImageToInstagram(igUserId, pageAccessToken, filePath, caption);
}

/**
 * Upload a video to TikTok.
 */
export async function publishToTikTok(
  creds:     TikTokAppCreds,
  videoPath: string,
  meta:      TikTokVideoMeta,
): Promise<TikTokUploadResult> {
  const stored = loadTokens('tiktok');
  if (!stored) return { ok: false, error: 'TikTok not connected. Run social_auth first.' };

  let accessToken = stored.accessToken;

  // Auto-refresh if expired
  if (stored.expiresAt && stored.expiresAt < Date.now() + 60_000) {
    try {
      const refreshed = await refreshTikTokToken(creds, {
        accessToken:  stored.accessToken,
        refreshToken: stored.refreshToken ?? '',
        expiresAt:    stored.expiresAt,
        openId:       stored.meta?.openId ?? '',
      });
      saveTokens('tiktok', { accessToken: refreshed.accessToken, refreshToken: refreshed.refreshToken, expiresAt: refreshed.expiresAt, meta: stored.meta });
      accessToken = refreshed.accessToken;
    } catch {
      return { ok: false, error: 'TikTok token refresh failed. Please reconnect.' };
    }
  }

  return uploadVideoToTikTok(accessToken, videoPath, meta);
}
