/**
 * afterSign hook — runs after code-signing, before DMG creation.
 * Submits the app to Apple notary service via @electron/notarize.
 *
 * Required env vars (set in CI secrets or locally):
 *   APPLE_ID                    — your Apple ID email
 *   APPLE_APP_SPECIFIC_PASSWORD — app-specific password from appleid.apple.com
 *   APPLE_TEAM_ID               — 10-character team ID from developer.apple.com
 *
 * If APPLE_ID is not set the hook exits silently (useful for local unsigned builds).
 */

const { notarize } = require('@electron/notarize');

exports.default = async function notarizing(context) {
  if (context.electronPlatformName !== 'darwin') return;

  // Skip if signing credentials aren't available (local dev, Windows CI, etc.)
  if (!process.env.APPLE_ID) {
    console.log('[notarize] APPLE_ID not set — skipping notarization');
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = `${context.appOutDir}/${appName}.app`;

  console.log(`[notarize] Submitting ${appName}.app to Apple notary…`);

  await notarize({
    tool: 'notarytool',
    appPath,
    appleId:             process.env.APPLE_ID,
    appleIdPassword:     process.env.APPLE_APP_SPECIFIC_PASSWORD,
    teamId:              process.env.APPLE_TEAM_ID,
  });

  console.log('[notarize] Notarization complete.');
};
