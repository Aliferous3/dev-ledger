#!/usr/bin/env node
// Generates src-tauri/icons/icon-src.png — a 1024x1024 rendering of the
// Dev Ledger mark (dark tile + #D6FF3E square, same geometry as the
// favicon SVG in index.html). Pure Node, no deps: writes a real PNG via
// zlib so icon generation stays reproducible everywhere.
//
// Usage: node scripts/gen-icon.mjs
//        npx tauri icon src-tauri/icons/icon-src.png   (regenerates all formats)

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const SIZE = 1024;
const OUT = join(ROOT, 'src-tauri', 'icons', 'icon-src.png');

// Brand palette (index.html favicon + DEV GREEN)
const BG = [0x0a, 0x0a, 0x0a, 0xff];          // #0a0a0a
const MARK = [0xd6, 0xff, 0x3e, 0xff];        // #D6FF3E
const CORNER = Math.round(SIZE * 0.22);       // squircle-ish radius (macOS convention)

// Favicon geometry: 16x16 grid, mark at (5,5) size 6 → centered 37.5%
const M0 = Math.round((5 / 16) * SIZE);       // 320
const M1 = Math.round((11 / 16) * SIZE);      // 704

const px = Buffer.alloc(SIZE * SIZE * 4);

// supersample 4x for clean rounded corners
for (let y = 0; y < SIZE; y++) {
  for (let x = 0; x < SIZE; x++) {
    // signed distance to rounded rect
    const qx = Math.abs(x + 0.5 - SIZE / 2) - (SIZE / 2 - CORNER);
    const qy = Math.abs(y + 0.5 - SIZE / 2) - (SIZE / 2 - CORNER);
    const dx = Math.max(qx, 0), dy = Math.max(qy, 0);
    const dist = Math.sqrt(dx * dx + dy * dy) + Math.min(Math.max(qx, qy), 0) - CORNER;
    const alpha = Math.max(0, Math.min(1, 0.5 - dist)); // 1px AA
    const i = (y * SIZE + x) * 4;
    if (x >= M0 && x < M1 && y >= M0 && y < M1) {
      px[i] = MARK[0]; px[i + 1] = MARK[1]; px[i + 2] = MARK[2];
    } else {
      px[i] = BG[0]; px[i + 1] = BG[1]; px[i + 2] = BG[2];
    }
    px[i + 3] = Math.round(alpha * 255);
  }
}

// --- minimal PNG encoder ---------------------------------------------------
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crcTable = chunk.table ||= (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
    return t;
  })();
  let c = 0xffffffff;
  for (const b of body) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  const crc = Buffer.alloc(4); crc.writeUInt32BE((c ^ 0xffffffff) >>> 0);
  return Buffer.concat([len, body, crc]);
}

const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SIZE, 0); ihdr.writeUInt32BE(SIZE, 4);
ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
const raw = Buffer.alloc(SIZE * (SIZE * 4 + 1));
for (let y = 0; y < SIZE; y++) {
  raw[y * (SIZE * 4 + 1)] = 0; // filter: none
  px.copy(raw, y * (SIZE * 4 + 1) + 1, y * SIZE * 4, (y + 1) * SIZE * 4);
}
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr),
  chunk('IDAT', deflateSync(raw, { level: 9 })),
  chunk('IEND', Buffer.alloc(0)),
]);

mkdirSync(dirname(OUT), { recursive: true });
writeFileSync(OUT, png);
console.log(`wrote ${OUT} (${SIZE}x${SIZE})`);
