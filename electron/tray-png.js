"use strict";

/**
 * Inspect tray template PNGs without Electron.
 * Packaged nativeImage.createFromPath() cannot read asar, so the tray
 * loader uses these buffers + createFromBuffer instead.
 */

const fs = require("fs");
const path = require("path");
const zlib = require("zlib");

const PNG_SIG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const TRAY_FILES = [
  "trayTemplate.png",
  "trayTemplate@2x.png",
  "trayStartingTemplate.png",
  "trayStartingTemplate@2x.png",
  "trayAlertTemplate.png",
  "trayAlertTemplate@2x.png",
];

function asarUnpackedPath(filePath) {
  return String(filePath).replace(
    `${path.sep}app.asar${path.sep}`,
    `${path.sep}app.asar.unpacked${path.sep}`
  );
}

function candidatePaths(filename, dirname) {
  const packed = path.join(dirname, "resources", filename);
  const unpacked = asarUnpackedPath(packed);
  const out = [];
  if (unpacked !== packed) out.push(unpacked);
  out.push(packed);
  if (typeof process.resourcesPath === "string" && process.resourcesPath) {
    out.push(
      path.join(
        process.resourcesPath,
        "app.asar.unpacked",
        "electron",
        "resources",
        filename
      )
    );
  }
  return [...new Set(out)];
}

function readPngFile(filename, dirname) {
  for (const filePath of candidatePaths(filename, dirname)) {
    try {
      const buf = fs.readFileSync(filePath);
      if (buf.length >= 24 && buf.subarray(0, 8).equals(PNG_SIG)) {
        return { path: filePath, buf };
      }
    } catch {
      // try next candidate
    }
  }
  return null;
}

function paeth(a, b, c) {
  const p = a + b - c;
  const pa = Math.abs(p - a);
  const pb = Math.abs(p - b);
  const pc = Math.abs(p - c);
  if (pa <= pb && pa <= pc) return a;
  if (pb <= pc) return b;
  return c;
}

function unfilterRow(filter, row, prev, out, bpp) {
  for (let i = 0; i < row.length; i++) {
    const left = i >= bpp ? out[i - bpp] : 0;
    const up = prev[i];
    const upLeft = i >= bpp ? prev[i - bpp] : 0;
    let x = row[i];
    if (filter === 1) x = (x + left) & 255;
    else if (filter === 2) x = (x + up) & 255;
    else if (filter === 3) x = (x + ((left + up) >> 1)) & 255;
    else if (filter === 4) x = (x + paeth(left, up, upLeft)) & 255;
    else if (filter !== 0) throw new Error(`unsupported PNG filter ${filter}`);
    out[i] = x;
  }
}

function inspectPng(buf) {
  if (!buf || buf.length < 24 || !buf.subarray(0, 8).equals(PNG_SIG)) {
    throw new Error("not a PNG");
  }
  let offset = 8;
  const idats = [];
  let width;
  let height;
  let bitDepth;
  let colorType;
  while (offset + 12 <= buf.length) {
    const len = buf.readUInt32BE(offset);
    const type = buf.toString("ascii", offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + len);
    if (type === "IHDR") {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      bitDepth = data[8];
      colorType = data[9];
    } else if (type === "IDAT") {
      idats.push(data);
    } else if (type === "IEND") {
      break;
    }
    offset += 12 + len;
  }
  if (!width || !height) throw new Error("PNG missing IHDR");
  if (bitDepth !== 8) throw new Error(`expected 8-bit PNG, got ${bitDepth}`);
  const channels =
    colorType === 6 ? 4 : colorType === 4 ? 2 : colorType === 2 ? 3 : 1;
  const bpp = channels;
  const stride = width * bpp;
  const raw = zlib.inflateSync(Buffer.concat(idats));
  const pixels = Buffer.alloc(height * stride);
  let src = 0;
  let prev = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = raw[src++];
    const row = raw.subarray(src, src + stride);
    src += stride;
    const out = pixels.subarray(y * stride, (y + 1) * stride);
    unfilterRow(filter, row, prev, out, bpp);
    prev = Buffer.from(out);
  }
  let nonzeroAlpha = 0;
  if (colorType === 6) {
    for (let i = 3; i < pixels.length; i += 4) {
      if (pixels[i] > 0) nonzeroAlpha += 1;
    }
  } else if (colorType === 4) {
    for (let i = 1; i < pixels.length; i += 2) {
      if (pixels[i] > 0) nonzeroAlpha += 1;
    }
  } else {
    nonzeroAlpha = width * height;
  }
  return {
    width,
    height,
    bitDepth,
    colorType,
    pixelCount: width * height,
    nonzeroAlpha,
  };
}

function expectedSize(filename) {
  const retina = /@2x\.png$/i.test(filename);
  // Design ships 18×18 / 36×36 menu-bar templates. 16×16 / 32×32 is also
  // accepted so a future 16pt pack still passes.
  return retina ? { widths: [32, 36], heights: [32, 36] } : { widths: [16, 18], heights: [16, 18] };
}

function assertTrayPngs(dir) {
  const results = [];
  for (const name of TRAY_FILES) {
    const filePath = path.join(dir, name);
    const buf = fs.readFileSync(filePath);
    const info = inspectPng(buf);
    const expected = expectedSize(name);
    if (!expected.widths.includes(info.width) || !expected.heights.includes(info.height)) {
      throw new Error(
        `${name} is ${info.width}×${info.height}; expected ${expected.widths.join("/")}×${expected.heights.join("/")}`
      );
    }
    if (info.nonzeroAlpha < 1) {
      throw new Error(`${name} has no non-zero alpha pixels (fully transparent)`);
    }
    results.push({ name, ...info, bytes: buf.length, path: filePath });
  }
  return results;
}

if (require.main === module) {
  const dir = process.argv[2];
  if (!dir) {
    console.error("usage: node electron/tray-png.js <dir>");
    process.exit(2);
  }
  const results = assertTrayPngs(dir);
  for (const row of results) {
    console.log(
      `✓ ${row.name} ${row.width}×${row.height} alpha=${row.nonzeroAlpha}/${row.pixelCount} bytes=${row.bytes}`
    );
  }
}

module.exports = {
  TRAY_FILES,
  PNG_SIG,
  asarUnpackedPath,
  candidatePaths,
  readPngFile,
  inspectPng,
  assertTrayPngs,
};
