/**
 * Drop weight from the packaged Next standalone tree and the .app:
 * .next/cache, sourcemaps, Prisma native engines, non-sqlite query-compiler
 * wasm, unused image-optimizer binaries, docs/tests/d.ts, and extra Electron
 * locales. ffmpeg and yt-dlp live in Resources/bin and are never walked.
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

const STANDALONE_JUNK = [
  "mcp-server",
  "electron",
  "extension",
  "contrib",
  "electron-builder.json",
  "package-lock.json",
  "tsconfig.json",
  "skills-lock.json",
  "CLAUDE.md",
  "AGENTS.md",
  "HANDOVER.md",
  "CHANGELOG.md",
];

const DROP_DIR_NAMES = new Set([
  "test",
  "tests",
  "__tests__",
  "docs",
  "doc",
  "example",
  "examples",
  "man",
  ".github",
]);

const IMAGE_PACKAGES = ["sharp", "@img"];

const PRISMA_NATIVE_PACKAGES = [
  path.join("@prisma", "engines"),
  path.join("@prisma", "fetch-engine"),
  path.join("@prisma", "studio-core"),
  path.join("@prisma", "dev"),
  path.join("@prisma", "query-plan-executor"),
  "prisma",
];

const ASAR_UNPACKED_KEEP_MODULES = new Set([
  "better-sqlite3",
  "bindings",
  "file-uri-to-path",
]);

function entrySize(target) {
  if (!fs.existsSync(target)) return 0;
  let st;
  try {
    st = fs.lstatSync(target);
  } catch {
    return 0;
  }
  if (st.isSymbolicLink() || st.isFile()) return st.size;
  if (!st.isDirectory()) return 0;
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
  let st;
  try {
    st = fs.lstatSync(root);
  } catch {
    return;
  }
  if (st.isSymbolicLink()) return;
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
    path.join(root, "node_modules", "prisma"),
  ];
  for (const dir of roots) {
    walkFiles(dir, (file) => {
      if (isPrismaEngineBinary(path.basename(file))) hits.push(file);
    });
  }
  let bytes = 0;
  for (const file of hits) bytes += removePath(file);
  for (const rel of PRISMA_NATIVE_PACKAGES) {
    bytes += removePath(path.join(root, "node_modules", rel));
  }
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

function pruneImageOptimizer(root) {
  let bytes = 0;
  for (const name of IMAGE_PACKAGES) {
    bytes += removePath(path.join(root, "node_modules", name));
  }
  return bytes;
}

function pruneStandaloneJunk(root) {
  let bytes = 0;
  for (const name of STANDALONE_JUNK) {
    bytes += removePath(path.join(root, name));
  }
  return bytes;
}

function pruneNodeModuleNoise(root) {
  const nm = path.join(root, "node_modules");
  if (!fs.existsSync(nm)) return 0;
  const dirs = [];
  const files = [];
  const visit = (dir) => {
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (DROP_DIR_NAMES.has(entry.name.toLowerCase())) dirs.push(full);
        else visit(full);
      } else if (entry.isFile()) {
        const lower = entry.name.toLowerCase();
        if (
          lower.endsWith(".d.ts") ||
          lower.endsWith(".d.mts") ||
          lower.endsWith(".d.cts") ||
          lower.endsWith(".map") ||
          lower.endsWith(".md") ||
          lower === "readme" ||
          lower === "changelog" ||
          lower === "changes" ||
          lower === "authors"
        ) {
          files.push(full);
        }
      }
    }
  };
  visit(nm);
  let bytes = 0;
  for (const dir of dirs) bytes += removePath(dir);
  for (const file of files) bytes += removePath(file);
  return bytes;
}

function pruneBetterSqliteBuild(root) {
  const hits = [];
  const visit = (dir) => {
    if (!fs.existsSync(dir)) return;
    let entries;
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) continue;
      if (entry.isDirectory()) {
        if (entry.name === "better-sqlite3") hits.push(full);
        else visit(full);
      }
    }
  };
  visit(path.join(root, "node_modules"));
  visit(path.join(root, ".next", "node_modules"));
  let bytes = 0;
  for (const pkg of hits) {
    const addon = path.join(pkg, "build", "Release", "better_sqlite3.node");
    if (!fs.existsSync(addon)) continue;
    bytes += removePath(path.join(pkg, "deps"));
    bytes += removePath(path.join(pkg, "src"));
  }
  return bytes;
}

function pruneAsarUnpackedModules(appPath, extraKeep = []) {
  const keep = new Set([...ASAR_UNPACKED_KEEP_MODULES, ...extraKeep]);
  const nm = path.join(
    appPath,
    "Contents",
    "Resources",
    "app.asar.unpacked",
    "node_modules"
  );
  if (!fs.existsSync(nm)) return 0;
  let bytes = 0;
  for (const name of fs.readdirSync(nm)) {
    if (keep.has(name)) continue;
    bytes += removePath(path.join(nm, name));
  }
  bytes += pruneBetterSqliteBuild(
    path.join(appPath, "Contents", "Resources", "app.asar.unpacked")
  );
  bytes += pruneNodeModuleNoise(
    path.join(appPath, "Contents", "Resources", "app.asar.unpacked")
  );
  bytes += pruneSourcemaps(
    path.join(appPath, "Contents", "Resources", "app.asar.unpacked")
  );
  return bytes;
}

function pruneStandaloneTree(root) {
  const parts = {
    junk: pruneStandaloneJunk(root),
    cache: pruneNextCache(root),
    sourcemaps: pruneSourcemaps(root),
    prismaEngines: prunePrismaEngines(root),
    foreignQueryCompiler: pruneForeignQueryCompiler(root),
    imageOptimizer: pruneImageOptimizer(root),
    sqliteBuild: pruneBetterSqliteBuild(root),
    nodeModuleNoise: pruneNodeModuleNoise(root),
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
  pruneAsarUnpackedModules,
  pruneNextCache,
  pruneSourcemaps,
  prunePrismaEngines,
  pruneForeignQueryCompiler,
  pruneImageOptimizer,
  pruneStandaloneJunk,
  pruneNodeModuleNoise,
  pruneBetterSqliteBuild,
  isPrismaEngineBinary,
  isDarwinArm64Name,
  formatBytes,
  logPrune,
  KEEP_LPROJ,
  STANDALONE_JUNK,
  ASAR_UNPACKED_KEEP_MODULES,
};
