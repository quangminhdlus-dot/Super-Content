// Produce crisp blue-brand PWA icons during every build (no extra dependencies).
// The raster mark mirrors public/icons/icon.svg; iOS uses apple-touch-icon.png.
import { mkdirSync, writeFileSync } from "node:fs";
import { deflateSync } from "node:zlib";

const BACKGROUND = [11, 18, 32];
const ACCENT = [101, 167, 255];

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let i = 0; i < 8; i++)
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const label = Buffer.from(type, "ascii");
  const size = Buffer.alloc(4);
  size.writeUInt32BE(data.length);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([label, data])));
  return Buffer.concat([size, label, data, crc]);
}

function insideRoundedRect(x, y) {
  if (x < 96 || x > 416 || y < 126 || y > 386) return false;
  const r = 62;
  const cx = Math.min(416 - r, Math.max(96 + r, x));
  const cy = Math.min(386 - r, Math.max(126 + r, y));
  return (x - cx) ** 2 + (y - cy) ** 2 <= r ** 2;
}

function insidePlayTriangle(x, y) {
  return x >= 222 && x <= 316 &&
    Math.abs(y - 256) <= 59 * (316 - x) / 94;
}

function makeIcon(size) {
  const stride = size * 3 + 1;
  const pixels = Buffer.alloc(stride * size);
  for (let y = 0; y < size; y++) {
    const offset = y * stride;
    pixels[offset] = 0; // PNG filter: none
    for (let x = 0; x < size; x++) {
      const sx = (x + 0.5) * 512 / size;
      const sy = (y + 0.5) * 512 / size;
      const fill = insideRoundedRect(sx, sy) && !insidePlayTriangle(sx, sy)
        ? ACCENT
        : BACKGROUND;
      const p = offset + 1 + x * 3;
      pixels[p] = fill[0];
      pixels[p + 1] = fill[1];
      pixels[p + 2] = fill[2];
    }
  }
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8; // bit depth
  header[9] = 2; // RGB
  const png = Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk("IHDR", header),
    chunk("IDAT", deflateSync(pixels, { level: 9 })),
    chunk("IEND", Buffer.alloc(0)),
  ]);
  return png;
}

mkdirSync("public/icons", { recursive: true });
for (const [name, size] of [
  ["icon-192.png", 192],
  ["icon-512.png", 512],
  ["apple-touch-icon.png", 180],
]) {
  writeFileSync(`public/icons/${name}`, makeIcon(size));
}
