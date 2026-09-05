#!/usr/bin/env node
// Generates app/og-default.png — the fallback Open Graph/Twitter card image
// used by every page that doesn't have a more specific one. Same
// no-image-library approach as make-favicon-png.mjs (raw zlib + hand-rolled
// PNG chunks), extended with a tiny hand-drawn 5x7 bitmap font so the banner
// can carry the wordmark instead of being a single flat color. Re-run this
// script manually if the mark, colors, or wordmark ever change.
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

/** A width*height truecolor (no alpha) RGB pixel buffer, filled with `bg` up front. */
function createCanvas(width, height, bg) {
  const pixels = new Uint8Array(width * height * 3);
  for (let i = 0; i < pixels.length; i += 3) {
    pixels[i] = bg[0];
    pixels[i + 1] = bg[1];
    pixels[i + 2] = bg[2];
  }
  return { width, height, pixels };
}

function setPixel(canvas, x, y, [r, g, b]) {
  if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return;
  const i = (y * canvas.width + x) * 3;
  canvas.pixels[i] = r;
  canvas.pixels[i + 1] = g;
  canvas.pixels[i + 2] = b;
}

function fillRect(canvas, x0, y0, w, h, color) {
  for (let y = y0; y < y0 + h; y++) {
    for (let x = x0; x < x0 + w; x++) setPixel(canvas, x, y, color);
  }
}

function canvasToPng(canvas) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdrData = Buffer.alloc(13);
  ihdrData.writeUInt32BE(canvas.width, 0);
  ihdrData.writeUInt32BE(canvas.height, 4);
  ihdrData[8] = 8; // bit depth
  ihdrData[9] = 2; // color type: truecolor RGB
  ihdrData[10] = 0;
  ihdrData[11] = 0;
  ihdrData[12] = 0;
  const ihdr = chunk("IHDR", ihdrData);

  const rowBytes = 1 + canvas.width * 3;
  const raw = Buffer.alloc(rowBytes * canvas.height);
  for (let y = 0; y < canvas.height; y++) {
    const rowStart = y * rowBytes;
    raw[rowStart] = 0; // filter type: none
    const srcStart = y * canvas.width * 3;
    canvas.pixels.subarray(srcStart, srcStart + canvas.width * 3).forEach((byte, i) => {
      raw[rowStart + 1 + i] = byte;
    });
  }
  const idat = chunk("IDAT", deflateSync(raw));
  const iend = chunk("IEND", Buffer.alloc(0));
  return Buffer.concat([signature, ihdr, idat, iend]);
}

// The site mark's three rectangles, same geometry/colors as favicon.svg and
// make-favicon-png.mjs's RECTS — kept in sync by hand since each lives in a
// different asset format (SVG vs. raw PNG bytes here).
const MARK_UNIT = 32;
const MARK_RECTS = [
  { x: 0, y: 0, w: 18, h: 32, color: [43, 95, 173] }, // #2b5fad
  { x: 20, y: 0, w: 12, h: 14, color: [111, 160, 230] }, // #6fa0e6
  { x: 20, y: 16, w: 12, h: 16, color: [26, 138, 74] }, // #1a8a4a
];

function drawMark(canvas, x0, y0, scale, color = null) {
  for (const rect of MARK_RECTS) {
    fillRect(canvas, x0 + rect.x * scale, y0 + rect.y * scale, rect.w * scale, rect.h * scale, color ?? rect.color);
  }
}

// Hand-drawn 5x7 bitmap font, blocky/geometric to match the mark's own
// rectangle-built look rather than trying to fake a real typeface. Only
// covers the letters "awesomemap" actually needs — extend as the wordmark
// this banner renders grows.
const GLYPH_W = 5;
const GLYPH_H = 7;
const FONT = {
  a: ["01110", "00001", "01111", "10001", "10001", "10011", "01101"],
  w: ["10001", "10001", "10001", "10001", "10101", "10101", "01010"],
  e: ["01110", "10001", "11111", "10000", "10000", "10001", "01110"],
  s: ["01111", "10000", "10000", "01110", "00001", "00001", "11110"],
  o: ["01110", "10001", "10001", "10001", "10001", "10001", "01110"],
  m: ["00000", "11010", "10101", "10101", "10101", "10101", "10101"],
  p: ["11110", "10001", "10001", "11110", "10000", "10000", "10000"],
  ".": ["00000", "00000", "00000", "00000", "00000", "00000", "01100"],
  d: ["00001", "00001", "01101", "10101", "10101", "10101", "01111"],
  v: ["00000", "00000", "10001", "10001", "10001", "01010", "00100"],
};

function drawGlyph(canvas, char, x0, y0, scale, color) {
  const rows = FONT[char];
  if (!rows) return;
  for (let row = 0; row < GLYPH_H; row++) {
    for (let col = 0; col < GLYPH_W; col++) {
      if (rows[row][col] === "1") fillRect(canvas, x0 + col * scale, y0 + row * scale, scale, scale, color);
    }
  }
}

function textWidth(text, scale) {
  return (GLYPH_W * text.length + (text.length - 1)) * scale;
}

function drawText(canvas, text, x0, y0, scale, color) {
  let x = x0;
  for (const char of text) {
    drawGlyph(canvas, char, x, y0, scale, color);
    x += (GLYPH_W + 1) * scale;
  }
}

function buildBanner() {
  const WIDTH = 1200;
  const HEIGHT = 630;
  const BG = [16, 26, 46]; // dark navy — lets the mark's blue/green and the white wordmark both pop
  const canvas = createCanvas(WIDTH, HEIGHT, BG);

  const markScale = 9; // 32 * 9 = 288px mark
  const markSize = MARK_UNIT * markScale;
  const textScale = 13;
  const wordmark = "awesomemap";
  const gap = 50;
  const textW = textWidth(wordmark, textScale);
  const textH = GLYPH_H * textScale;

  const contentWidth = markSize + gap + textW;
  const startX = Math.round((WIDTH - contentWidth) / 2);
  const markY = Math.round((HEIGHT - markSize) / 2);
  const textY = Math.round((HEIGHT - textH) / 2);

  drawMark(canvas, startX, markY, markScale);
  drawText(canvas, wordmark, startX + markSize + gap, textY, textScale, [255, 255, 255]);

  return canvas;
}

writeFileSync("app/og-default.png", canvasToPng(buildBanner()));
console.log("Wrote app/og-default.png");
