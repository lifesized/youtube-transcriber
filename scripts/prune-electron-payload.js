/**
 * Drop weight from the packaged Next standalone tree and the .app:
 * .next/cache, sourcemaps, non-darwin-arm64 Prisma engines, non-sqlite
 * query-compiler wasm, and extra Electron locales.
 */

const fs = require("fs");
const path = require("path");

const KEEP_LPROJ = new Set([
  "en.lproj",
  "en_us.lproj",
  "en-us.lproj",
  "base.lproj",
  "english.lproj",
]);

function entrySize(target) {
  if (!fs.existsSync(target)) return 0;
  const st = fs.statSync(target);
  if (st.isFile()) return st.size;
  let total = 0;
  for (const name of fs.readdirSync(target)) {
    total += entrySize(path.join(target, name));
  }
  return total;
}

function removePath(target) {
  if (!fs.existsSync(target)) return 0;
  const bytes = entrySize(target);
  fs.rmSync(target, { recursive: true, force: true });
  return bytes;
}

function walkFiles(root, visit) {
  if (!fs.existsSync(root)) return;
  const st = fs.statSync(root);
  if (st.isFile()) {
    visit(root);
    return;
  }
  if (!st.isDirectory()) return;
  for (const name of fs.readdirSync(root)) {
    walkFiles(path.join(root, name), visit);
  }
}

function pruneNextCache(root) {
  return removePath(path.join(root, ".next", "cache"));
}

function pruneSourcemaps(root) {
  const maps = [];
  walkFiles(root, (file) => {
    if (file.endsWith(".map")) maps.push(file);
  });
  let bytes = 0;
  for (const file of maps) bytes += removePath(file);
  return bytes;
}

function isPrismaEngineBinary(name) {
  return (
    /schema[-_]?engine/i.test(name) ||
    /query[-_]?engine/i.test(name) ||
    /libquery_engine/i.test(name)
  );
}

function isDarwinArm64Name(name) {
  return /darwin[-_]?arm64/i.test(name);
}

function prunePrismaEngines(root) {
  const hits = [];
  const roots = [
    path.join(root, "node_modules", ".prisma"),
    path.join(root, "node_modules", "@prisma"),
  ];
  for (const dir of roots) {
    walkFiles(dir, (file) => {
      const name = path.basename(file);
      if (isPrismaEngineBinary(name) && !isDarwinArm64Name(name)) {
        hits.push(file);
      }
    });
  }
  let bytes = 0;
  for (const file of hits) bytes += removePath(file);
  return bytes;
}

function isForeignQueryCompiler(name) {
  return /query_compiler_.*\.(postgresql|mysql|sqlserver|cockroachdb|mongodb)/i.test(
    name
  );
}

function pruneForeignQueryCompiler(root) {
  const hits = [];
  walkFiles(path.join(root, "node_modules"), (file) => {
    if (isForeignQueryCompiler(path.basename(file))) hits.push(file);
  });
  let bytes = 0;
  for (const file of hits) bytes += removePath(file);
  return bytes;
}

function pruneStandaloneTree(root) {
  const parts = {
    cache: pruneNextCache(root),
    sourcemaps: pruneSourcemaps(root),
    prismaEngines: prunePrismaEngines(root),
    foreignQueryCompiler: pruneForeignQueryCompiler(root),
  };
  parts.total = Object.values(parts).reduce((a, b) => a + b, 0);
  return parts;
}

function pruneElectronLocales(appPath) {
  const dirs = [
    path.join(appPath, "Contents", "Resources"),
    path.join(
      appPath,
      "Contents",
      "Frameworks",
      "Electron Framework.framework",
      "Resources"
    ),
    path.join(
      appPath,
      "Contents",
      "Frameworks",
      "Electron Framework.framework",
      "Versions",
      "Current",
      "Resources"
    ),
    path.join(
      appPath,
      "Contents",
      "Frameworks",
      "Electron Framework.framework",
      "Versions",
      "A",
      "Resources"
    ),
  ];
  let bytes = 0;
  const seen = new Set();
  for (const dir of dirs) {
    if (!fs.existsSync(dir)) continue;
    const real = fs.realpathSync(dir);
    if (seen.has(real)) continue;
    seen.add(real);
    for (const name of fs.readdirSync(dir)) {
      if (!name.endsWith(".lproj")) continue;
      if (KEEP_LPROJ.has(name.toLowerCase())) continue;
      bytes += removePath(path.join(dir, name));
    }
  }
  return bytes;
}

function formatBytes(n) {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function logPrune(label, parts) {
  const total = typeof parts === "number" ? parts : parts.total;
  console.log(`  pruned ${label}: ${formatBytes(total)}`);
  if (parts && typeof parts === "object") {
    for (const [key, value] of Object.entries(parts)) {
      if (key === "total") continue;
      if (value) console.log(`    ${key}: ${formatBytes(value)}`);
    }
  }
}

module.exports = {
  pruneStandaloneTree,
  pruneElectronLocales,
  pruneNextCache,
  pruneSourcemaps,
  prunePrismaEngines,
  pruneForeignQueryCompiler,
  isPrismaEngineBinary,
  isDarwinArm64Name,
  formatBytes,
  logPrune,
  KEEP_LPROJ,
};
