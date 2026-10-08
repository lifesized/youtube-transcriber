#!/usr/bin/env node
/**
 * Assemble the Next.js standalone payload for the Electron extraResources
 * copy. electron-builder's asar pack cannot be read by Node when the server
 * runs via ELECTRON_RUN_AS_NODE=1, so the server, its node_modules, static
 * assets, Prisma client/engines, and migrations must live outside asar.
 */

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const STAGING = path.join(ROOT, "electron", "resources", "standalone");

function copyDir(src, dest) {
  fs.cpSync(src, dest, { recursive: true, dereference: true });
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function copyIfExists(src, dest) {
  if (!fs.existsSync(src)) {
    console.warn(`  skip (missing): ${path.relative(ROOT, src)}`);
    return false;
  }
  ensureDir(path.dirname(dest));
  if (fs.statSync(src).isDirectory()) {
    copyDir(src, dest);
  } else {
    fs.copyFileSync(src, dest);
  }
  console.log(`  copied ${path.relative(ROOT, src)}`);
  return true;
}

function overlayPackage(name) {
  const src = path.join(ROOT, "node_modules", name);
  const dest = path.join(STAGING, "node_modules", name);
  if (!fs.existsSync(src)) {
    console.warn(`  skip (missing package): ${name}`);
    return false;
  }
  copyDir(src, dest);
  console.log(`  overlaid node_modules/${name}`);
  return true;
}

function main() {
  const standaloneSrc = path.join(ROOT, ".next", "standalone");
  if (!fs.existsSync(standaloneSrc)) {
    throw new Error("Run next build first — .next/standalone is missing");
  }

  console.log("Preparing Electron standalone payload...");
  fs.rmSync(STAGING, { recursive: true, force: true });
  copyDir(standaloneSrc, STAGING);
  console.log("  copied .next/standalone");

  copyIfExists(
    path.join(ROOT, ".next", "static"),
    path.join(STAGING, ".next", "static")
  );
  if (!copyIfExists(path.join(ROOT, "public"), path.join(STAGING, "public"))) {
    ensureDir(path.join(STAGING, "public"));
  }
  const publicKeep = path.join(STAGING, "public", "keep");
  if (!fs.existsSync(publicKeep)) {
    fs.writeFileSync(publicKeep, "placeholder so electron-builder copies public/\n");
  }
  copyIfExists(path.join(ROOT, "prisma"), path.join(STAGING, "prisma"));

  ensureDir(path.join(STAGING, "node_modules"));

  for (const pkg of [
    "next",
    "@prisma/client",
    "@prisma/adapter-better-sqlite3",
    "@prisma/driver-adapter-utils",
    "@prisma/client-runtime-utils",
    "@prisma/debug",
    "better-sqlite3",
    "dotenv",
  ]) {
    overlayPackage(pkg);
  }

  copyIfExists(
    path.join(ROOT, "node_modules", ".prisma"),
    path.join(STAGING, "node_modules", ".prisma")
  );
  copyIfExists(
    path.join(ROOT, "node_modules", "@prisma", "engines"),
    path.join(STAGING, "node_modules", "@prisma", "engines")
  );

  ensureDir(path.join(STAGING, "tmp"));

  const serverJs = path.join(STAGING, "server.js");
  if (!fs.existsSync(serverJs)) {
    throw new Error("standalone/server.js missing after prepare");
  }
  if (!fs.existsSync(path.join(STAGING, ".next", "static"))) {
    throw new Error(".next/static missing inside standalone payload");
  }
  if (!fs.existsSync(path.join(STAGING, "prisma", "migrations"))) {
    throw new Error("prisma/migrations missing inside standalone payload");
  }
  const prismaClient = path.join(STAGING, "node_modules", "@prisma", "client");
  if (!fs.existsSync(prismaClient)) {
    throw new Error("@prisma/client missing inside standalone node_modules");
  }

  const engineHits = [];
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/darwin[-_]arm64/i.test(entry.name)) engineHits.push(full);
    }
  };
  walk(path.join(STAGING, "node_modules", ".prisma"));
  walk(path.join(STAGING, "node_modules", "@prisma"));
  if (engineHits.length === 0) {
    console.warn("  warning: no darwin-arm64 Prisma engine files found (ok on non-mac hosts)");
  } else {
    for (const hit of engineHits) {
      console.log(`  prisma engine: ${path.relative(STAGING, hit)}`);
    }
  }

  console.log(`Prepared ${path.relative(ROOT, STAGING)}`);
}

main();
