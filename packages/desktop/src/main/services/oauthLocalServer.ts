// ── oauthLocalServer.ts ───────────────────────────────────────────────────────
//
// Phase 5 — Social Media Publishing: Local OAuth Callback Server
//
// Spins up a temporary HTTP server on a random port to receive the OAuth
// authorization code after the user approves access in their browser.
//
// Flow:
//   1. Caller calls startOAuthListener() → gets { redirectUri, codePromise }
//   2. Caller opens browser to the platform's auth URL with redirectUri appended
//   3. Platform redirects browser to http://localhost:{port}/callback?code=XXX
//   4. Server captures the code, closes, resolves codePromise
//
// The server automatically shuts down after receiving the code or on timeout.

import http   from 'http';
import { URL } from 'url';

export interface OAuthListenerResult {
  /** The redirect URI to pass to the OAuth provider (include in your auth URL) */
  redirectUri: string;
  /** Resolves with the authorization code string, or rejects on timeout/error */
  codePromise: Promise<string>;
  /** Call to shut down the server early (e.g. if user cancels the flow) */
  cancel: () => void;
}

const OAUTH_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

/**
 * Start a temporary local HTTP server to catch an OAuth callback.
 * @param port  Preferred port (0 = OS-assigned random port)
 */
export function startOAuthListener(port = 0): Promise<OAuthListenerResult> {
  return new Promise((outerResolve, outerReject) => {
    let codeResolve: (code: string) => void;
    let codeReject:  (err: Error) => void;

    const codePromise = new Promise<string>((res, rej) => {
      codeResolve = res;
      codeReject  = rej;
    });

    const server = http.createServer((req, res) => {
      try {
        const url    = new URL(req.url ?? '/', `http://localhost`);
        const code   = url.searchParams.get('code');
        const error  = url.searchParams.get('error');

        if (error) {
          res.writeHead(400, { 'Content-Type': 'text/html' });
          res.end(`<h2>Authorization failed: ${error}</h2><p>You can close this tab.</p>`);
          server.close();
          codeReject(new Error(`OAuth error: ${error}`));
          return;
        }

        if (code) {
          res.writeHead(200, { 'Content-Type': 'text/html' });
          res.end(`
            <html><body style="font-family:sans-serif;padding:40px;text-align:center">
              <h2>✓ Authorization successful!</h2>
              <p>TriForge is now connected. You can close this tab.</p>
              <script>setTimeout(() => window.close(), 2000)</script>
            </body></html>
          `);
          server.close();
          codeResolve(code);
          return;
        }

        res.writeHead(404, { 'Content-Type': 'text/plain' });
        res.end('Waiting for authorization...');
      } catch (err) {
        res.writeHead(500);
        res.end('Internal error');
        codeReject(err instanceof Error ? err : new Error(String(err)));
      }
    });

    server.listen(port, '127.0.0.1', () => {
      const addr    = server.address() as { port: number };
      const listenPort = addr.port;
      const redirectUri = `http://localhost:${listenPort}/callback`;

      // Timeout after 5 minutes if user never completes auth
      const timer = setTimeout(() => {
        server.close();
        codeReject(new Error('OAuth authorization timed out after 5 minutes.'));
      }, OAUTH_TIMEOUT_MS);

      server.on('close', () => clearTimeout(timer));

      const cancel = () => {
        server.close();
        codeReject(new Error('OAuth flow cancelled.'));
      };

      outerResolve({ redirectUri, codePromise, cancel });
    });

    server.on('error', outerReject);
  });
}
