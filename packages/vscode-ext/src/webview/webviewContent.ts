// webviewContent.ts — assembles the full webview HTML from static asset modules.
// Replaces _getWebviewContent() + _getNonce() in panel.ts.

import { WEBVIEW_CSS } from './webviewAssets/styles.css';
import { WEBVIEW_MARKUP } from './webviewAssets/markup.html';
import { buildClientScript } from './webviewAssets/clientScript.js';
import { LS_CHECKOUT } from '../core/license';

export function buildWebviewContent(): string {
  const nonce = _generateNonce();
  const lsCheckout = LS_CHECKOUT;
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1.0"/>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
<title>Triforge AI Code Council</title>
<style>
${WEBVIEW_CSS}
</style>
</head>
<body>
${WEBVIEW_MARKUP}
<script nonce="${nonce}">
${buildClientScript(lsCheckout)}
</script>
</body>
</html>`;
}

function _generateNonce(): string {
  let text = '';
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  for (let i = 0; i < 32; i++) { text += chars.charAt(Math.floor(Math.random() * chars.length)); }
  return text;
}
