// Renders every animation into one crisp PNG (assets/animations.png) for the README.
// Usage: node scripts/make-sheet.mjs
import { createRequire } from 'node:module';
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const require = createRequire(import.meta.url);
const S = require('../src/shared/sprite.js');
const A = require('../src/shared/anims.js');

// [animation, time, label] — times picked so each pose reads at a glance
const CELLS = [
  ['idle', 0.45, 'idle'], ['run', 0.2, 'run'], ['sleep', 1.2, 'sleep'], ['working', 0.5, 'working'],
  ['waiting', 0.2, 'waiting'], ['done', 0.4, 'done'], ['error', 0.2, 'error'], ['petted', 0.5, 'petted'],
  ['picked', 0.3, 'picked up'], ['land', 0.05, 'land'], ['wake', 0.15, 'wake'], ['hurt', 0.4, 'hurt'],
  ['dizzy', 0.5, 'dizzy'], ['ouch', 0.3, 'ouch'], ['walk', 0.3, 'walk'], ['fall', 0.2, 'fall'],
];
const COLS = 8, CW = 64, CH = 90, AX = 31, AY = 76, SCALE = 4, PAD = 2;
const W = COLS * CW + PAD * 2, H = Math.ceil(CELLS.length / COLS) * CH + PAD * 2;

const sheet = new S.Pix(W, H);
sheet.rect(0, 0, W, H, S.rgba('#1d1c24'));
CELLS.forEach(([name, t, label], i) => {
  const ox = PAD + (i % COLS) * CW, oy = PAD + Math.floor(i / COLS) * CH;
  const cell = new S.Pix(CW, 80);
  const f = A.frame(name, t, { look: { x: 0, y: 0 }, facing: 1, phase: t * 3, swing: 0.6, side: -1 });
  const lift = Math.round(f.offsetY);
  S.drawShadow(cell, AX + 0.5, AY - 1.5, f.pose.sit ? 36 : 30, lift);
  const info = S.drawPet(cell, f.pose, AX, AY - lift);
  S.drawFx(cell, f.fx, Object.assign(info, { ground: AY - lift }));
  // alpha-blend onto the background (the shadow is semi-transparent black)
  const bg = sheet.get(ox, oy);
  for (let y = 0; y < cell.h; y++) for (let x = 0; x < cell.w; x++) {
    const c = cell.d[y * cell.w + x], a = (c >>> 24) / 255;
    if (!a) continue;
    const mix = (sh) => Math.round(((c >>> sh) & 255) * a + ((bg >>> sh) & 255) * (1 - a));
    sheet.set(ox + x, oy + y, ((255 << 24) | (mix(16) << 16) | (mix(8) << 8) | mix(0)) >>> 0);
  }
  S.drawText(sheet, Math.round(ox + CW / 2 - S.textWidth(label) / 2), oy + 81, label, S.rgba('#9b99ad'));
});

// nearest-neighbour upscale, then a minimal PNG encoder (RGBA, filter 0)
const rgba = sheet.toRGBA(), SW = W * SCALE, SH = H * SCALE;
const raw = Buffer.alloc((SW * 4 + 1) * SH);
for (let y = 0; y < SH; y++) {
  raw[y * (SW * 4 + 1)] = 0;
  for (let x = 0; x < SW; x++) {
    const s = ((Math.floor(y / SCALE) * W) + Math.floor(x / SCALE)) * 4, d = y * (SW * 4 + 1) + 1 + x * 4;
    raw[d] = rgba[s]; raw[d + 1] = rgba[s + 1]; raw[d + 2] = rgba[s + 2]; raw[d + 3] = rgba[s + 3];
  }
}
const crcTable = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; });
const crc = (buf) => { let c = 0xffffffff; for (const b of buf) c = crcTable[(c ^ b) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
const chunk = (type, data) => {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const c = Buffer.alloc(4); c.writeUInt32BE(crc(td));
  return Buffer.concat([len, td, c]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(SW, 0); ihdr.writeUInt32BE(SH, 4); ihdr[8] = 8; ihdr[9] = 6;
const png = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
]);
const out = new URL('../assets/animations.png', import.meta.url);
writeFileSync(out, png);
console.log(`wrote assets/animations.png ${SW}x${SH}, ${png.length} bytes`);
