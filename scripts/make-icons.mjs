// Draws the app icon (a fork: one move leading to three Lines) and writes the PNGs the PWA manifest needs.
// Same shapes as public/icons/icon.svg. No dependencies: shapes are rasterised here and encoded as PNG with zlib.
// Run: node scripts/make-icons.mjs
import { deflateSync } from 'node:zlib';
import { writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

const out = join(import.meta.dirname, '..', 'public', 'icons');
mkdirSync(out, { recursive: true });

const hex = (h) => [parseInt(h.slice(1, 3), 16), parseInt(h.slice(3, 5), 16), parseInt(h.slice(5, 7), 16)];
const BG = hex('#2e5e4e');

// A stroke is a polyline sampled from a path; 22 wide with round caps.
const bez = (p0, p1, p2, p3, n = 40) =>
  Array.from({ length: n + 1 }, (_, i) => {
    const t = i / n, u = 1 - t;
    return [0, 1].map((k) => u * u * u * p0[k] + 3 * u * u * t * p1[k] + 3 * u * t * t * p2[k] + t * t * t * p3[k]);
  });
const strokes = [
  { color: hex('#cfd3cc'), pts: [[118, 256], [394, 256]] },
  { color: hex('#d98a1f'), pts: [...bez([150, 256], [230, 256], [230, 150], [330, 150]), [394, 150]] },
  { color: hex('#8f88e6'), pts: [...bez([150, 256], [230, 256], [230, 362], [330, 362]), [394, 362]] },
];
const circles = [
  { c: [118, 256], r: 42, color: hex('#ffffff') },
  { c: [394, 150], r: 32, color: hex('#d98a1f') },
  { c: [394, 256], r: 32, color: hex('#e8eae6') },
  { c: [394, 362], r: 32, color: hex('#8f88e6') },
];

const segDist = (p, a, b) => {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (dx * dx + dy * dy || 1)));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
};

/** Colour at a point of the 512 × 512 canvas: [r, g, b, a] with a in 0..1. */
function shade(x, y, { rounded, scale }) {
  if (rounded) {
    // Rounded square, radius 112: transparent outside it.
    const cx = Math.min(Math.max(x, 112), 400), cy = Math.min(Math.max(y, 112), 400);
    if (Math.hypot(x - cx, y - cy) > 112) return [0, 0, 0, 0];
  }
  const p = [(x - 256) / scale + 256, (y - 256) / scale + 256]; // the art, scaled about the centre
  for (let i = circles.length - 1; i >= 0; i--) if (Math.hypot(p[0] - circles[i].c[0], p[1] - circles[i].c[1]) <= circles[i].r) return [...circles[i].color, 1];
  for (let i = strokes.length - 1; i >= 0; i--) {
    const pts = strokes[i].pts;
    for (let k = 0; k + 1 < pts.length; k++) if (segDist(p, pts[k], pts[k + 1]) <= 11) return [...strokes[i].color, 1];
  }
  return [...BG, 1];
}

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const body = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body));
  return Buffer.concat([len, body, crc]);
};

function png(size, opts) {
  const SS = 4; // 4 × 4 samples per pixel
  const raw = Buffer.alloc(size * (size * 4 + 1));
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0; // filter: none
    for (let x = 0; x < size; x++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < SS; sy++)
        for (let sx = 0; sx < SS; sx++) {
          const c = shade(((x + (sx + 0.5) / SS) / size) * 512, ((y + (sy + 0.5) / SS) / size) * 512, opts);
          r += c[0] * c[3]; g += c[1] * c[3]; b += c[2] * c[3]; a += c[3];
        }
      const o = y * (size * 4 + 1) + 1 + x * 4;
      raw[o] = a ? Math.round(r / a) : 0;
      raw[o + 1] = a ? Math.round(g / a) : 0;
      raw[o + 2] = a ? Math.round(b / a) : 0;
      raw[o + 3] = Math.round((a / (SS * SS)) * 255);
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0))]);
}

const files = [
  ['icon-192.png', 192, { rounded: true, scale: 1 }],
  ['icon-512.png', 512, { rounded: true, scale: 1 }],
  // Maskable: full-bleed, the art inside the safe zone (the OS crops it to its own shape).
  ['icon-maskable-512.png', 512, { rounded: false, scale: 0.78 }],
  // iOS rounds the corners itself.
  ['apple-touch-icon.png', 180, { rounded: false, scale: 0.9 }],
];
for (const [name, size, opts] of files) {
  writeFileSync(join(out, name), png(size, opts));
  console.log('wrote', name);
}
