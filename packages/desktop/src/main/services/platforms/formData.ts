// ── platforms/formData.ts ─────────────────────────────────────────────────────
//
// Minimal multipart/form-data builder for social media API uploads.
// Avoids the 'form-data' npm dependency — built on Node.js streams.

import fs   from 'fs';
import path from 'path';
import { Readable } from 'stream';

const CRLF = '\r\n';

export default class FormData extends Readable {
  private readonly boundary: string;
  private readonly parts:    Array<{ headers: string; body: Buffer | (() => fs.ReadStream) }> = [];
  private partIndex = 0;
  private innerStream: fs.ReadStream | null = null;
  private started = false;

  constructor() {
    super();
    this.boundary = `----TFBoundary${Date.now().toString(16)}`;
  }

  append(name: string, value: string): void {
    const headers =
      `--${this.boundary}${CRLF}` +
      `Content-Disposition: form-data; name="${name}"${CRLF}${CRLF}`;
    this.parts.push({ headers, body: Buffer.from(value + CRLF, 'utf8') });
  }

  appendFile(name: string, filePath: string): void {
    const filename = path.basename(filePath);
    const mime     = guessMime(filePath);
    const headers  =
      `--${this.boundary}${CRLF}` +
      `Content-Disposition: form-data; name="${name}"; filename="${filename}"${CRLF}` +
      `Content-Type: ${mime}${CRLF}${CRLF}`;
    this.parts.push({
      headers,
      body: () => fs.createReadStream(filePath),
    });
  }

  getHeaders(): Record<string, string | number> {
    // Pre-compute the non-file parts to get a rough content-length
    // (for file parts we rely on chunked transfer)
    return {
      'Content-Type': `multipart/form-data; boundary=${this.boundary}`,
      'Transfer-Encoding': 'chunked',
    };
  }

  _read(): void {
    if (!this.started) {
      this.started = true;
      this._pushNextPart();
    }
  }

  private _pushNextPart(): void {
    if (this.partIndex >= this.parts.length) {
      // End boundary
      this.push(`--${this.boundary}--${CRLF}`);
      this.push(null);
      return;
    }

    const part = this.parts[this.partIndex++];
    this.push(part.headers);

    if (typeof part.body === 'function') {
      const stream = part.body();
      this.innerStream = stream;
      stream.on('data', (chunk: string | Buffer) => { this.push(chunk); });
      stream.on('end', () => {
        this.push(CRLF);
        this.innerStream = null;
        this._pushNextPart();
      });
      stream.on('error', (err: Error) => this.destroy(err));
    } else {
      this.push(part.body);
      this._pushNextPart();
    }
  }
}

function guessMime(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const map: Record<string, string> = {
    '.jpg':  'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png':  'image/png',
    '.gif':  'image/gif',
    '.webp': 'image/webp',
    '.mp4':  'video/mp4',
    '.mov':  'video/quicktime',
    '.avi':  'video/x-msvideo',
    '.mkv':  'video/x-matroska',
  };
  return map[ext] ?? 'application/octet-stream';
}
