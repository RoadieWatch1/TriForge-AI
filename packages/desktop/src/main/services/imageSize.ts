// ── imageSize.ts ─────────────────────────────────────────────────────────────
//
// Read PNG/JPEG image dimensions from the file header without loading the
// full image into memory. Used by operatorTaskRunner to inform Vision of
// image dimensions and to compute the Retina scaling ratio.

import { readFileSync } from 'fs';

export interface ImageDimensions {
  width:  number;
  height: number;
}

/**
 * Read width/height from a PNG or JPEG file header.
 * Returns null if the format is unrecognised or the file can't be read.
 */
export function imageSize(filePath: string): ImageDimensions | null {
  try {
    // Read only the first 32 KB — more than enough for any header
    const fd = readFileSync(filePath, { flag: 'r' });
    const buf = fd.subarray(0, Math.min(fd.length, 32768));

    // PNG: bytes 16–23 of the IHDR chunk contain width (4 bytes BE) and height (4 bytes BE)
    if (buf.length >= 24 && buf[0] === 0x89 && buf[1] === 0x50 /* P */ && buf[2] === 0x4e /* N */ && buf[3] === 0x47 /* G */) {
      const width  = buf.readUInt32BE(16);
      const height = buf.readUInt32BE(20);
      if (width > 0 && height > 0) return { width, height };
    }

    // JPEG: scan for SOF0/SOF2 marker (0xFF 0xC0 or 0xFF 0xC2)
    if (buf.length >= 4 && buf[0] === 0xff && buf[1] === 0xd8) {
      let offset = 2;
      while (offset < buf.length - 8) {
        if (buf[offset] !== 0xff) { offset++; continue; }
        const marker = buf[offset + 1];
        if (marker === 0xc0 || marker === 0xc2) {
          const height = buf.readUInt16BE(offset + 5);
          const width  = buf.readUInt16BE(offset + 7);
          if (width > 0 && height > 0) return { width, height };
        }
        // Skip to next marker
        const segLen = buf.readUInt16BE(offset + 2);
        offset += 2 + segLen;
      }
    }

    return null;
  } catch {
    return null;
  }
}
