// ── probeUnrealRemoteControl.ts — Unreal Remote Control HTTP Probe ─────────────
//
// Phase 4, Step 3: First editor automation bridge diagnostic.
//
// Probes the Unreal Engine Remote Control HTTP API endpoint to determine
// whether the editor exposes a deterministic machine automation surface.
//
// Unreal Remote Control HTTP API defaults:
//   - Port:         30010
//   - Info route:   GET /remote/info  (returns engine version + plugin status)
//   - Preset route: GET /remote/presets (lists RC presets if enabled)
//
// TRULY IMPLEMENTED:
//   - HTTP GET to http://localhost:<port>/remote/info with configurable timeout
//   - Connection refused detection (port closed / plugin not active)
//   - Timeout classification (editor running but RC not responding)
//   - HTTP status code classification
//   - Response body inspection for recognizable RC markers
//   - Structured probe result with all details needed for chaining decisions
//
// NOT YET:
//   - Authenticated probe (custom API key support)
//   - Remote preset/object enumeration
//   - Blueprint creation via RC commands
//   - Property mutation commands
//   - Plugin enable/install flows

import http from 'http';

// ── Constants ─────────────────────────────────────────────────────────────────

/** Default Unreal Remote Control HTTP API port. */
export const UNREAL_RC_DEFAULT_PORT = 30010;

/** Default probe timeout in milliseconds. */
export const UNREAL_RC_PROBE_TIMEOUT_MS = 3000;

/** The info route that confirms RC is active. */
export const UNREAL_RC_INFO_ROUTE = '/remote/info';

// ── Result types ──────────────────────────────────────────────────────────────

/**
 * Raw classification of the HTTP probe result.
 *
 *   'available'           — endpoint reachable, response looks like Unreal RC
 *   'reachable_unknown'   — port open but response doesn't match RC signature
 *   'refused'             — connection actively refused (port closed or no listener)
 *   'timeout'             — TCP connection timed out (port filtered or RC not responding)
 *   'error'               — other network error
 */
export type RCProbeConnectionStatus =
  | 'available'
  | 'reachable_unknown'
  | 'refused'
  | 'timeout'
  | 'error';

export interface RCProbeResult {
  connectionStatus: RCProbeConnectionStatus;
  endpoint: string;
  port: number;
  httpStatus?: number;
  /** True if a TCP connection was established at all. */
  reachable: boolean;
  /** True if the response body contained Unreal RC signature fields. */
  rcSignatureFound: boolean;
  /** Parsed response body excerpt (first 500 chars) if available. */
  responseExcerpt?: string;
  /** Duration of the probe in milliseconds. */
  durationMs: number;
  /** Human-readable detail lines for inclusion in the structured result. */
  details: string[];
  /** Non-fatal notes (e.g. "response body did not contain expected RC fields"). */
  warnings: string[];
  /** Error message if the probe itself threw. */
  error?: string;
}

// ── Probe implementation ──────────────────────────────────────────────────────

/**
 * Check whether the response body looks like a genuine Unreal Remote Control
 * info response. The RC info endpoint typically returns JSON with fields such
 * as "engineVersion", "remoteName", "plugins", or "presets".
 */
function detectRCSignature(body: string): boolean {
  const lower = body.toLowerCase();
  return (
    lower.includes('engineversion') ||
    lower.includes('remotename') ||
    lower.includes('remoteplugin') ||
    lower.includes('"presets"') ||
    lower.includes('"plugins"') ||
    lower.includes('unrealengine') ||
    lower.includes('remote control')
  );
}

/**
 * Perform a single HTTP GET probe against the Unreal Remote Control endpoint.
 *
 * @param port       Port to probe (default: UNREAL_RC_DEFAULT_PORT)
 * @param timeoutMs  Probe timeout in ms (default: UNREAL_RC_PROBE_TIMEOUT_MS)
 */
export function probeUnrealRemoteControl(
  port: number = UNREAL_RC_DEFAULT_PORT,
  timeoutMs: number = UNREAL_RC_PROBE_TIMEOUT_MS,
): Promise<RCProbeResult> {
  const endpoint = `http://localhost:${port}${UNREAL_RC_INFO_ROUTE}`;
  const startMs  = Date.now();

  const details:  string[] = [];
  const warnings: string[] = [];

  details.push(`Probing Unreal Remote Control at ${endpoint}`);
  details.push(`Timeout: ${timeoutMs}ms`);

  return new Promise(resolve => {
    const req = http.get(
      {
        hostname: 'localhost',
        port,
        path:    UNREAL_RC_INFO_ROUTE,
        timeout: timeoutMs,
        headers: { Accept: 'application/json' },
      },
      res => {
        let body = '';
        res.on('data', chunk => { body += chunk; });
        res.on('end', () => {
          const durationMs = Date.now() - startMs;
          const excerpt    = body.slice(0, 500);
          const rcSig      = detectRCSignature(body);

          details.push(`HTTP ${res.statusCode} received in ${durationMs}ms`);

          if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
            if (rcSig) {
              details.push('Response body contains Unreal RC signature fields — plugin appears active.');
            } else {
              warnings.push(
                'Port is open and responded with 2xx, but the response body did not ' +
                'contain expected Unreal Remote Control fields. Another service may be ' +
                'listening on this port, or the plugin is active but returning an ' +
                'unexpected format.',
              );
            }
          } else {
            warnings.push(`Unexpected HTTP status: ${res.statusCode}. RC may be partially active.`);
          }

          resolve({
            connectionStatus: rcSig ? 'available' : 'reachable_unknown',
            endpoint,
            port,
            httpStatus:       res.statusCode,
            reachable:        true,
            rcSignatureFound: rcSig,
            responseExcerpt:  excerpt || undefined,
            durationMs,
            details,
            warnings,
          });
        });
      },
    );

    req.on('timeout', () => {
      req.destroy();
      const durationMs = Date.now() - startMs;
      details.push(`Probe timed out after ${durationMs}ms.`);
      details.push(
        'Timeout means the port may be filtered or the RC HTTP server is not ' +
        'responding. The editor may be running but the Remote Control plugin is ' +
        'not enabled or configured to listen.',
      );
      resolve({
        connectionStatus: 'timeout',
        endpoint,
        port,
        reachable:        false,
        rcSignatureFound: false,
        durationMs,
        details,
        warnings,
      });
    });

    req.on('error', (err: NodeJS.ErrnoException) => {
      const durationMs = Date.now() - startMs;

      if (err.code === 'ECONNREFUSED') {
        details.push(`Connection refused on port ${port}.`);
        details.push(
          'This typically means no process is listening on this port. ' +
          'Possible causes: Remote Control plugin not installed, plugin not enabled ' +
          'in the active project, or the HTTP server is bound to a different port.',
        );
        resolve({
          connectionStatus: 'refused',
          endpoint,
          port,
          reachable:        false,
          rcSignatureFound: false,
          durationMs,
          details,
          warnings,
          error:            `ECONNREFUSED: ${err.message}`,
        });
      } else if (err.code === 'ECONNRESET' || err.code === 'EPIPE') {
        details.push(`Connection reset by peer (${err.code}).`);
        warnings.push('The server closed the connection unexpectedly — RC may be initializing.');
        resolve({
          connectionStatus: 'error',
          endpoint,
          port,
          reachable:        true,
          rcSignatureFound: false,
          durationMs,
          details,
          warnings,
          error:            `${err.code}: ${err.message}`,
        });
      } else {
        details.push(`Network error: ${err.code ?? 'unknown'} — ${err.message}`);
        resolve({
          connectionStatus: 'error',
          endpoint,
          port,
          reachable:        false,
          rcSignatureFound: false,
          durationMs,
          details,
          warnings,
          error:            `${err.code ?? 'ERROR'}: ${err.message}`,
        });
      }
    });
  });
}
