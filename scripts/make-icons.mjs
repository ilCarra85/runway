// Genera le icone PNG dell'app (stesso disegno di public/icon.svg) senza dipendenze esterne.
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const C1 = [0x2a, 0x78, 0xd6], C2 = [0x1c, 0x5c, 0xab];
const runway = [[206, 120], [306, 120], [392, 420], [120, 420]];
const dashes = [[250, 140, 262, 180], [247, 205, 265, 255], [243, 280, 269, 340], [238, 365, 274, 410]];

function inPoly(x, y, p) {
  let inside = false;
  for (let i = 0, j = p.length - 1; i < p.length; j = i++) {
    const [xi, yi] = p[i], [xj, yj] = p[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
function inRound(x, y, r, size, rounded) {
  if (!rounded) return true;
  const cx = Math.min(Math.max(x, r), size - r), cy = Math.min(Math.max(y, r), size - r);
  return (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
}
function sample(x, y, rounded) {
  if (!inRound(x, y, 112, 512, rounded)) return null;
  for (const [a, b, c, d] of dashes) if (x >= a && x <= c && y >= b && y <= d) return C2;
  if (inPoly(x, y, runway)) return [255, 255, 255];
  const t = (x + y) / 1024;
  return C1.map((v, i) => Math.round(v + (C2[i] - v) * t));
}

function render(size, rounded) {
  const S = 4, px = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let r = 0, g = 0, b = 0, a = 0;
    for (let sy = 0; sy < S; sy++) for (let sx = 0; sx < S; sx++) {
      const c = sample(((x + (sx + 0.5) / S) * 512) / size, ((y + (sy + 0.5) / S) * 512) / size, rounded);
      if (c) { r += c[0]; g += c[1]; b += c[2]; a++; }
    }
    const i = (y * size + x) * 4;
    if (a) { px[i] = r / a; px[i + 1] = g / a; px[i + 2] = b / a; }
    px[i + 3] = Math.round((a / (S * S)) * 255);
  }
  return png(size, px);
}

function png(size, rgba) {
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) { raw[y * (size * 4 + 1)] = 0; rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4); }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length);
    const td = Buffer.concat([Buffer.from(type), data]);
    const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(td) >>> 0);
    return Buffer.concat([len, td, crc]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4); ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]);
}
function crc32(buf) {
  let c, crc = 0xffffffff;
  for (let n = 0; n < buf.length; n++) {
    c = (crc ^ buf[n]) & 0xff;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    crc = (crc >>> 8) ^ c;
  }
  return crc ^ 0xffffffff;
}

writeFileSync('public/icon-192.png', render(192, false));
writeFileSync('public/icon-512.png', render(512, false));
writeFileSync('public/apple-touch-icon.png', render(180, false));
console.log('Icone generate in public/');
