#!/usr/bin/env node
/**
 * Generates packages/desktop/assets/icon-1024.png
 * Pure Node.js — no npm dependencies required.
 * Run: node scripts/make-icon.js
 */

'use strict';
const zlib = require('zlib');
const fs   = require('fs');
const path = require('path');

const W = 1024, H = 1024;

// ── CRC32 ─────────────────────────────────────────────────────────────────────
const CRC_TABLE = new Uint32Array(256);
for (let i = 0; i < 256; i++) {
  let c = i;
  for (let j = 0; j < 8; j++) c = (c & 1) ? 0xEDB88320 ^ (c >>> 1) : c >>> 1;
  CRC_TABLE[i] = c;
}
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xFF] ^ (c >>> 8);
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// ── PNG chunk writer ──────────────────────────────────────────────────────────
function chunk(type, data) {
  const t = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const crcBuf = Buffer.alloc(4); crcBuf.writeUInt32BE(crc32(Buffer.concat([t, data])));
  return Buffer.concat([len, t, data, crcBuf]);
}

// ── Draw helpers ──────────────────────────────────────────────────────────────
// All coordinates are in 0-1023 pixel space
const pixels = new Uint8Array(W * H * 3); // RGB

function setPixel(x, y, r, g, b) {
  if (x < 0 || x >= W || y < 0 || y >= H) return;
  const i = (y * W + x) * 3;
  pixels[i] = r; pixels[i+1] = g; pixels[i+2] = b;
}

function lerp(a, b, t) { return Math.round(a + (b - a) * Math.max(0, Math.min(1, t))); }

// ── Background: deep dark with subtle gradient ────────────────────────────────
const BG1 = [11, 11, 18];  // very dark blue-black (top)
const BG2 = [18, 10, 30];  // dark purple (bottom)

for (let y = 0; y < H; y++) {
  const t = y / (H - 1);
  const r = lerp(BG1[0], BG2[0], t);
  const g = lerp(BG1[1], BG2[1], t);
  const b = lerp(BG1[2], BG2[2], t);
  for (let x = 0; x < W; x++) setPixel(x, y, r, g, b);
}

// ── Rounded rectangle mask (icon shape with radius 220) ──────────────────────
const RADIUS = 220;
const ACCENT  = [99, 102, 241]; // indigo
const PURPLE  = [139, 92, 246]; // violet

for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    // Distance from rounded-rect edge
    const rx = Math.max(0, Math.abs(x - W / 2) - (W / 2 - RADIUS));
    const ry = Math.max(0, Math.abs(y - H / 2) - (H / 2 - RADIUS));
    if (Math.sqrt(rx * rx + ry * ry) > RADIUS) continue; // outside rounded rect

    // Radial gradient from centre: dark core → accent ring
    const dx = x - W / 2, dy = y - H / 2;
    const dist = Math.sqrt(dx * dx + dy * dy) / (W * 0.5);
    const t = Math.min(1, dist);

    // Blend: centre=dark, edge=accent/purple
    const r = lerp(BG1[0] + 8, ACCENT[0] * 0.7, t);
    const g = lerp(BG1[1] + 5, ACCENT[1] * 0.7, t);
    const b = lerp(BG1[2] + 20, PURPLE[2] * 0.7, t);
    setPixel(x, y, r, g, b);
  }
}

// ── Lightning bolt ⚡ — drawn as a filled polygon via scanline ────────────────
// Polygon vertices (in 1024×1024 pixel space) — classic bold bolt shape
const BOLT = [
  [620, 80],   // top-right
  [380, 520],  // middle-right of upper wing
  [540, 520],  // inner notch (right)
  [404, 944],  // bottom-left
  [644, 504],  // middle-left of lower wing
  [484, 504],  // inner notch (left)
];

// Point-in-polygon (ray casting)
function inPolygon(px, py, poly) {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    const intersect = ((yi > py) !== (yj > py)) && (px < (xj - xi) * (py - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

// Fill bolt with bright yellow-white
const BOLT_COLOR = [255, 230, 60];
// Add a subtle white glow first (expand by 8px)
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    // Check if any point within 8px is inside the bolt
    let glow = false;
    for (let dy = -8; dy <= 8; dy += 4) {
      for (let dx = -8; dx <= 8; dx += 4) {
        if (inPolygon(x + dx, y + dy, BOLT)) { glow = true; break; }
      }
      if (glow) break;
    }
    if (!glow) continue;
    const i = (y * W + x) * 3;
    // Soft white glow
    pixels[i]   = Math.min(255, pixels[i]   + 60);
    pixels[i+1] = Math.min(255, pixels[i+1] + 60);
    pixels[i+2] = Math.min(255, pixels[i+2] + 80);
  }
}
// Fill solid bolt
for (let y = 0; y < H; y++) {
  for (let x = 0; x < W; x++) {
    if (inPolygon(x, y, BOLT)) setPixel(x, y, BOLT_COLOR[0], BOLT_COLOR[1], BOLT_COLOR[2]);
  }
}

// ── Build PNG scanlines ───────────────────────────────────────────────────────
const rows = [];
for (let y = 0; y < H; y++) {
  const row = Buffer.alloc(1 + W * 3);
  row[0] = 0; // filter None
  for (let x = 0; x < W; x++) {
    const src = (y * W + x) * 3;
    row[1 + x * 3]     = pixels[src];
    row[1 + x * 3 + 1] = pixels[src + 1];
    row[1 + x * 3 + 2] = pixels[src + 2];
  }
  rows.push(row);
}
const rawData = Buffer.concat(rows);
const compressed = zlib.deflateSync(rawData, { level: 6 });

// ── Assemble PNG ──────────────────────────────────────────────────────────────
const SIGNATURE = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

const ihdrData = Buffer.alloc(13);
ihdrData.writeUInt32BE(W, 0);
ihdrData.writeUInt32BE(H, 4);
ihdrData[8]  = 8;  // bit depth
ihdrData[9]  = 2;  // RGB
ihdrData[10] = 0;  // compression
ihdrData[11] = 0;  // filter
ihdrData[12] = 0;  // interlace

const png = Buffer.concat([
  SIGNATURE,
  chunk('IHDR', ihdrData),
  chunk('IDAT', compressed),
  chunk('IEND', Buffer.alloc(0)),
]);

// ── Save ──────────────────────────────────────────────────────────────────────
const outDir  = path.join(__dirname, '..', 'assets');
const outFile = path.join(outDir, 'icon-1024.png');
fs.mkdirSync(outDir, { recursive: true });
fs.writeFileSync(outFile, png);
console.log(`✅  Generated ${outFile} (${(png.length / 1024).toFixed(0)} KB)`);
