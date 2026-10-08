#!/usr/bin/env node
/**
 * Generate macOS template tray icons (black + alpha) without extra deps.
 * Writes electron/resources/trayTemplate.png and trayTemplate@2x.png.
 */

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const OUT_DIR = path.join(__dirname, "..", "electron", "resources");

function crc32(buf) {
  let crc = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i];
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, "ascii");
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])));
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function drawT(size) {
  const pixels = Buffer.alloc(size * size * 4);
  const set = (x, y) => {
    if (x < 0 || y < 0 || x >= size || y >= size) return;
    const i = (y * size + x) * 4;
    pixels[i] = 0;
    pixels[i + 1] = 0;
    pixels[i + 2] = 0;
    pixels[i + 3] = 255;
  };

  const pad = Math.max(2, Math.round(size * 0.18));
  const barTop = pad;
  const barHeight = Math.max(2, Math.round(size * 0.16));
  const stemWidth = Math.max(2, Math.round(size * 0.16));
  const stemX0 = Math.floor((size - stemWidth) / 2);
  const barBottom = barTop + barHeight;
  const stemBottom = size - pad;

  for (let y = barTop; y < barBottom; y++) {
    for (let x = pad; x < size - pad; x++) set(x, y);
  }
  for (let y = barTop; y < stemBottom; y++) {
    for (let x = stemX0; x < stemX0 + stemWidth; x++) set(x, y);
  }
  return pixels;
}

function encodePng(size, rgba) {
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const raw = Buffer.alloc(size * (1 + size * 4));
  for (let y = 0; y < size; y++) {
    const dest = y * (1 + size * 4);
    raw[dest] = 0; // filter None
    rgba.copy(raw, dest + 1, y * size * 4, (y + 1) * size * 4);
  }
  const idat = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    signature,
    chunk("IHDR", ihdr),
    chunk("IDAT", idat),
    chunk("IEND", Buffer.alloc(0)),
  ]);
}

function writeIcon(filename, size) {
  const png = encodePng(size, drawT(size));
  const out = path.join(OUT_DIR, filename);
  fs.mkdirSync(OUT_DIR, { recursive: true });
  fs.writeFileSync(out, png);
  console.log(`wrote ${path.relative(process.cwd(), out)} (${png.length} bytes, ${size}x${size})`);
}

writeIcon("trayTemplate.png", 16);
writeIcon("trayTemplate@2x.png", 32);
