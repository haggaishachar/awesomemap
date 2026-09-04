#!/usr/bin/env node
// Generates PNG fallbacks of app/favicon.svg's three-rectangle mark, for
// platforms that don't support SVG favicons (a 32x32 <link rel="icon">
// fallback for older browsers, and a 180x180 apple-touch-icon for iOS
// home-screen bookmarks / Safari pinned tabs). Uses only Node's built-in
// zlib, same no-image-library approach as make-og-banner.mjs. Re-run this
// script manually if favicon.svg's mark ever changes.
import { deflateSync } from "node:zlib";
import { writeFileSync } from "node:fs";

function crc32(buf) {
  const table = [];
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) crc = table[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const lenBuf = Buffer.alloc(4);
  lenBuf.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([lenBuf, typeBuf, data, crcBuf]);
}

// Geometry and colors copied straight from app/favicon.svg's 32x32 viewBox.
const SOURCE_SIZE = 32;
const RECTS = [
  { x: 0, y: 0, w: 18, h: 32, color: [43, 95, 173] }, // #2b5fad
  { x: 20, y: 0, w: 12, h: 14, color: [111, 160, 230] }, // #6fa0e6
  { x: 20, y: 16, w: 12, h: 16, color: [26, 138, 74] }, // #1a8a4a
];

/** Rasterizes the mark at `size`x`size`, transparent outside the rects (truecolor+alpha, no rounded corners — not worth the complexity for an icon this small). */
function faviconPng(size) {
  const scale = size / SOURCE_SIZE;
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);

  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(size, 0);
  ihdrData.writeUInt32BE(size, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 6; // color type: truecolor + alpha
  ihdrData[10] = 0; // compression method
  ihdrData[11] = 0; // filter method
  ihdrData[12] = 0; // interlace method
  const ihdr = chunk("IHDR", ihdrData);

  const rowBytes = 1 + size * 4; // filter-type byte + RGBA per pixel
  const raw = Buffer.alloc(rowBytes * size); // zero-filled: transparent everywhere by default
  for (let y = 0; y < size; y++) {
    const rowStart = y * rowBytes;
    raw[rowStart] = 0; // filter type: none
    for (let x = 0; x < size; x++) {
      const rect = RECTS.find(
        (r) => x >= r.x * scale && x < (r.x + r.w) * scale && y >= r.y * scale && y < (r.y + r.h) * scale,
      );
      if (!rect) continue;
      const px = rowStart + 1 + x * 4;
      raw[px] = rect.color[0];
      raw[px + 1] = rect.color[1];
      raw[px + 2] = rect.color[2];
      raw[px + 3] = 255;
    }
  }
  const idat = chunk("IDAT", deflateSync(raw));
  const iend = chunk("IEND", Buffer.alloc(0));

  return Buffer.concat([signature, ihdr, idat, iend]);
}

writeFileSync("app/favicon-32.png", faviconPng(32));
writeFileSync("app/apple-touch-icon.png", faviconPng(180));
console.log("Wrote app/favicon-32.png and app/apple-touch-icon.png");
