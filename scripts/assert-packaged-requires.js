#!/usr/bin/env node
/**
 * Resolve every require() reachable from electron/main.js against the
 * packaged app (app.asar + app.asar.unpacked), the way Node/Electron would.
 */

const fs = require("fs");
const path = require("path");
const Module = require("module");

const BUILTINS = new Set([
  ...Module.builtinModules,
  "electron",
  "original-fs",
]);

function loadAsar() {
  try {
    return require("@electron/asar");
  } catch {
    return require("asar");
  }
}

function normalizeAsarPath(p) {
  return String(p || "")
    .replace(/\\/g, "/")
    .replace(/^\.\//, "")
    .replace(/^\//, "");
}

function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:\\])\/\/.*$/gm, "$1");
}

function collectRequires(source) {
  const text = stripComments(source);
  const found = [];
  const re = /require\(\s*['"]([^'"]+)['"]\s*\)/g;
  let match;
  while ((match = re.exec(text))) {
    found.push(match[1]);
  }
  return found;
}

function candidateRelativePaths(fromFile, spec) {
  const dir = path.posix.dirname(fromFile);
  const joined = path.posix.normalize(path.posix.join(dir, spec));
  const out = [];
  const add = (p) => {
    const n = normalizeAsarPath(p);
    if (n && !out.includes(n)) out.push(n);
  };
  if (joined.endsWith(".js") || joined.endsWith(".json") || joined.endsWith(".node")) {
    add(joined);
  } else {
    add(joined);
    add(`${joined}.js`);
    add(`${joined}.json`);
    add(`${joined}/index.js`);
    add(`${joined}/package.json`);
  }
  return out;
}

function fileExists(name, asarFiles, unpackedRoot) {
  const key = normalizeAsarPath(name);
  if (asarFiles.has(key)) return { where: "asar", path: key };
  if (unpackedRoot) {
    const disk = path.join(unpackedRoot, key.split("/").join(path.sep));
    if (fs.existsSync(disk) && fs.statSync(disk).isFile()) {
      return { where: "unpacked", path: key, disk };
    }
  }
  return null;
}

function resolveNodeModule(fromFile, spec, asarFiles, unpackedRoot) {
  let dir = path.posix.dirname(fromFile);
  const name = spec.startsWith("@")
    ? spec.split("/").slice(0, 2).join("/")
    : spec.split("/")[0];
  const rest = spec.slice(name.length).replace(/^\//, "");
  while (true) {
    const pkgDir = path.posix.join(dir === "." ? "" : dir, "node_modules", name);
    const pkgJson = `${normalizeAsarPath(pkgDir)}/package.json`;
    const hit = fileExists(pkgJson, asarFiles, unpackedRoot);
    if (hit) {
      if (rest) {
        for (const cand of candidateRelativePaths(`${pkgJson}`, `./${rest}`)) {
          const fileHit = fileExists(cand, asarFiles, unpackedRoot);
          if (fileHit) return fileHit;
        }
      } else {
        let pkg = {};
        try {
          pkg = JSON.parse(readPackagedFile(hit, asarFiles, unpackedRoot, null));
        } catch {
          pkg = {};
        }
        const main = pkg.main || "index.js";
        for (const cand of candidateRelativePaths(`${pkgJson}`, `./${main}`)) {
          const fileHit = fileExists(cand, asarFiles, unpackedRoot);
          if (fileHit) return fileHit;
        }
      }
    }
    if (!dir || dir === "." || dir === "/") break;
    const parent = path.posix.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

function readPackagedFile(hit, asarFiles, unpackedRoot, asarArchive) {
  if (hit.where === "unpacked") {
    return fs.readFileSync(hit.disk, "utf8");
  }
  if (asarArchive) {
    return loadAsar().extractFile(asarArchive, hit.path).toString("utf8");
  }
  return asarFiles.get(hit.path) || "";
}

function walkRequires(options) {
  const {
    entry = "electron/main.js",
    asarFiles,
    unpackedRoot = null,
    asarArchive = null,
    readFile = (hit) => readPackagedFile(hit, asarFiles, unpackedRoot, asarArchive),
  } = options;
  const missing = [];
  const seen = new Set();
  const queue = [normalizeAsarPath(entry)];

  while (queue.length) {
    const current = queue.pop();
    if (seen.has(current)) continue;
    seen.add(current);
    const hit = fileExists(current, asarFiles, unpackedRoot);
    if (!hit) {
      missing.push({ from: "(entry)", spec: current });
      continue;
    }
    if (!current.endsWith(".js")) continue;
    let source = "";
    try {
      source = readFile(hit);
    } catch (error) {
      missing.push({ from: current, spec: `(read failed: ${error.message})` });
      continue;
    }
    for (const spec of collectRequires(source)) {
      if (!spec) continue;
      if (spec.startsWith("node:") || BUILTINS.has(spec)) continue;
      let resolved = null;
      if (spec.startsWith(".")) {
        for (const cand of candidateRelativePaths(current, spec)) {
          resolved = fileExists(cand, asarFiles, unpackedRoot);
          if (resolved) break;
        }
      } else {
        resolved = resolveNodeModule(current, spec, asarFiles, unpackedRoot);
      }
      if (!resolved) {
        missing.push({ from: current, spec });
        continue;
      }
      queue.push(resolved.path);
    }
  }
  return { seen: [...seen], missing };
}

function listAsarFiles(asarPath) {
  const asar = loadAsar();
  const files = new Set();
  for (const name of asar.listPackage(asarPath)) {
    const n = normalizeAsarPath(name);
    if (n) files.add(n);
  }
  return files;
}

function parseArgs(argv) {
  const out = { app: null, asar: null, unpacked: null, entry: "electron/main.js" };
  for (let i = 2; i < argv.length; i++) {
    const a = argv[i];
    const next = argv[i + 1];
    if (a === "--app") out.app = next, i++;
    else if (a === "--asar") out.asar = next, i++;
    else if (a === "--unpacked") out.unpacked = next, i++;
    else if (a === "--entry") out.entry = next, i++;
  }
  return out;
}

function main() {
  const args = parseArgs(process.argv);
  let asarPath = args.asar;
  let unpacked = args.unpacked;
  if (args.app) {
    const resources = path.join(args.app, "Contents", "Resources");
    asarPath = asarPath || path.join(resources, "app.asar");
    unpacked = unpacked || path.join(resources, "app.asar.unpacked");
  }
  if (!asarPath || !fs.existsSync(asarPath)) {
    throw new Error(`app.asar not found: ${asarPath || "(missing --app/--asar)"}`);
  }
  const asar = loadAsar();
  const listed = asar.listPackage(asarPath);
  console.log(`asar entries: ${listed.length}`);
  for (const name of listed.sort()) {
    if (/(^|\/)lib\/|^lib\//.test(normalizeAsarPath(name))) {
      console.log(`  asar ${normalizeAsarPath(name)}`);
    }
  }
  const asarFiles = new Set(listed.map(normalizeAsarPath).filter(Boolean));
  const result = walkRequires({
    entry: args.entry,
    asarFiles,
    unpackedRoot: unpacked && fs.existsSync(unpacked) ? unpacked : null,
    asarArchive: asarPath,
  });
  if (result.missing.length) {
    console.error("Missing packaged requires:");
    for (const miss of result.missing) {
      console.error(`  ${miss.from} require('${miss.spec}')`);
    }
    process.exit(1);
  }
  console.log(`✓ resolved ${result.seen.length} modules from ${args.entry}`);
}

if (require.main === module) {
  main();
}

module.exports = {
  collectRequires,
  candidateRelativePaths,
  walkRequires,
  normalizeAsarPath,
  fileExists,
};
