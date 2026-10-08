#!/usr/bin/env node
/**
 * Dependency-free Electron fuse-wire reader. Parses the sentinel in
 * Electron Framework. No npm modules, no build-artifact code.
 *
 *   node scripts/read-electron-fuses.js <Transcriber.app>
 *   node scripts/read-electron-fuses.js --assert <Transcriber.app>
 */
"use strict";

const fs = require("fs");
const path = require("path");

const SENTINEL = Buffer.from("dL7pKGdnNz796PbbjQWNKmHXBZaB9tsX", "utf8");
const ENABLE = 49; // ASCII '1'
const DISABLE = 48; // ASCII '0'
const RUN_AS_NODE = 0;
const NODE_OPTIONS = 2;
const INSPECT_ARGS = 3;

function electronFrameworkPath(appPath) {
  return path.join(
    appPath,
    "Contents",
    "Frameworks",
    "Electron Framework.framework",
    "Electron Framework"
  );
}

function findSentinel(buf) {
  return buf.indexOf(SENTINEL);
}

function parseFuseWire(buf, sentinelAt) {
  if (sentinelAt < 0) throw new Error("fuse sentinel not found");
  const header = sentinelAt + SENTINEL.length;
  if (header + 2 > buf.length) throw new Error("fuse wire header truncated");
  const version = buf[header];
  const length = buf[header + 1];
  const start = header + 2;
  if (start + length > buf.length) throw new Error("fuse wire truncated");
  return { version, length, bytes: buf.subarray(start, start + length) };
}

function readFusesFromApp(appPath) {
  const binary = electronFrameworkPath(appPath);
  const buf = fs.readFileSync(binary);
  const wire = parseFuseWire(buf, findSentinel(buf));
  return {
    binary,
    version: wire.version,
    length: wire.length,
    RunAsNode: wire.bytes[RUN_AS_NODE],
    EnableNodeOptionsEnvironmentVariable: wire.bytes[NODE_OPTIONS],
    EnableNodeCliInspectArguments: wire.bytes[INSPECT_ARGS],
  };
}

function assertSignedFuses(appPath) {
  const fuses = readFusesFromApp(appPath);
  if (fuses.RunAsNode !== ENABLE) {
    throw new Error("fuses: RunAsNode must be enabled");
  }
  if (fuses.EnableNodeOptionsEnvironmentVariable !== DISABLE) {
    throw new Error("fuses: EnableNodeOptionsEnvironmentVariable must be off");
  }
  if (fuses.EnableNodeCliInspectArguments !== DISABLE) {
    throw new Error("fuses: EnableNodeCliInspectArguments must be off");
  }
  return fuses;
}

function main(argv) {
  const assertMode = argv[0] === "--assert";
  const appPath = assertMode ? argv[1] : argv[0];
  if (!appPath) {
    console.error("usage: read-electron-fuses.js [--assert] <Transcriber.app>");
    process.exit(2);
  }
  const fuses = assertMode ? assertSignedFuses(appPath) : readFusesFromApp(appPath);
  console.log(JSON.stringify(fuses, null, 2));
  if (assertMode) {
    console.log("fuses: RunAsNode ON, NODE_OPTIONS OFF, inspect args OFF");
  }
}

if (require.main === module) {
  main(process.argv.slice(2));
}

module.exports = {
  SENTINEL,
  ENABLE,
  DISABLE,
  findSentinel,
  parseFuseWire,
  readFusesFromApp,
  assertSignedFuses,
  electronFrameworkPath,
};
