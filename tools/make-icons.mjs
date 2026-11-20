// Generates the PWA icons (PNG) with no dependencies: draws a small toy
// keyboard with 4x4 supersampling and encodes PNG via node:zlib.
// Usage: npm run icons

import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const OUT = fileURLToPath(new URL('../public/icons/', import.meta.url));

const ACCENT = [217, 72, 95, 255];
const WHITE = [255, 255, 255, 255];
const BLACK = [43, 24, 30, 255];
const CLEAR = [0, 0, 0, 0];

function inRoundRect(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const cx = Math.min(Math.max(x, x0 + r), x1 - r);
  const cy = Math.min(Math.max(y, y0 + r), y1 - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}

// Scene in a 512x512 coordinate space; keyboard fits the maskable safe zone.
function scene(x, y, { rounded }) {
  if (rounded && !inRoundRect(x, y, 0, 0, 512, 512, 104)) return CLEAR;
  const top = 150, bottom = 372, left = 100, right = 412;
  const n = 5, gap = 8;
  const w = (right - left - gap * (n - 1)) / n;
  // black keys after white keys 0, 1, 3 (like C# D# F#)
  for (const after of [0, 1, 3]) {
    const cx = left + (after + 1) * (w + gap) - gap / 2;
    if (inRoundRect(x, y, cx - w * 0.32, top - 6, cx + w * 0.32, top + 130, 10)) return BLACK;
  }
  for (let i = 0; i < n; i++) {
    const x0 = left + i * (w + gap);
    if (inRoundRect(x, y, x0, top, x0 + w, bottom, 14)) return WHITE;
  }
  return ACCENT;
}

function render(size, opts) {
  const ss = 4;
  const px = Buffer.alloc(size * size * 4);
  const scale = 512 / size;
  for (let py = 0; py < size; py++) {
    for (let pxl = 0; pxl < size; pxl++) {
      const acc = [0, 0, 0, 0];
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const c = scene((pxl + (sx + 0.5) / ss) * scale, (py + (sy + 0.5) / ss) * scale, opts);
          const a = c[3] / 255;
          acc[0] += c[0] * a; acc[1] += c[1] * a; acc[2] += c[2] * a; acc[3] += a;
        }
      }
      const o = (py * size + pxl) * 4;
      const alpha = acc[3] / (ss * ss);
      px[o] = alpha ? Math.round(acc[0] / acc[3]) : 0;
      px[o + 1] = alpha ? Math.round(acc[1] / acc[3]) : 0;
      px[o + 2] = alpha ? Math.round(acc[2] / acc[3]) : 0;
      px[o + 3] = Math.round(alpha * 255);
    }
  }
  return encodePng(size, size, px);
}

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
}
function encodePng(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;  // bit depth
  ihdr[9] = 6;  // RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

mkdirSync(OUT, { recursive: true });
writeFileSync(OUT + 'icon-192.png', render(192, { rounded: true }));
writeFileSync(OUT + 'icon-512.png', render(512, { rounded: true }));
writeFileSync(OUT + 'icon-maskable-512.png', render(512, { rounded: false }));
console.log('Icons written to public/icons/');
