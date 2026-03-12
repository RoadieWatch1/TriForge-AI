/**
 * afterSign hook — runs after code-signing, before DMG creation.
 * Submits the app to Apple notary service via @electron/notarize.
 *
 * Uses App Store Connect API key auth (more reliable than Apple ID auth).
 * Required env vars (set in CI secrets):
 *   APPLE_API_KEY     — full contents of the .p8 key file
 *   APPLE_API_KEY_ID  — Key ID (e.g. AB12CD34EF)
 *   APPLE_API_ISSUER  — Issuer ID (UUID from App Store Connect)
 *
 * If APPLE_API_KEY_ID is not set the hook exits silently.
 */

const { notarize } = require('@electron/notarize');
const fs   = require('fs');
const os   = require('os');
const path = require('path');

exports.default = async function notarizing(context) {
  if (context.electronPlatformName !== 'darwin') return;

  const apiKeyContent = process.env.APPLE_API_KEY;
  const apiKeyId      = process.env.APPLE_API_KEY_ID;
  const apiIssuer     = process.env.APPLE_API_ISSUER;

  // Skip if API key credentials aren't configured
  if (!apiKeyId || !apiKeyContent || !apiIssuer) {
    console.log('[notarize] APPLE_API_KEY_ID not set — skipping notarization');
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = `${context.appOutDir}/${appName}.app`;

  // Verify the app is actually code-signed before attempting notarization
  const { execSync } = require('child_process');
  try {
    execSync(`codesign --verify --strict "${appPath}"`, { stdio: 'pipe' });
  } catch {
    console.log('[notarize] App is not code-signed — skipping notarization');
    return;
  }

  // Write the .p8 key content to a temp file (notarytool requires a file path)
  const tmpKey = path.join(os.tmpdir(), `AuthKey_${apiKeyId}.p8`);
  fs.writeFileSync(tmpKey, apiKeyContent, { mode: 0o600 });

  console.log(`[notarize] Submitting ${appName}.app to Apple notary…`);

  try {
    await notarize({
      tool:           'notarytool',
      appPath,
      appleApiKey:    tmpKey,
      appleApiKeyId:  apiKeyId,
      appleApiIssuer: apiIssuer,
    });
    console.log('[notarize] Notarization complete.');
  } finally {
    try { fs.unlinkSync(tmpKey); } catch { /* best-effort cleanup */ }
  }
};
