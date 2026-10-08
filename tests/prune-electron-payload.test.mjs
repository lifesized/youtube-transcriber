import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.resolve(__dirname, "..");
const prune = require(path.join(projectRoot, "scripts", "prune-electron-payload.js"));

function write(file, body = "x") {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, body);
}

test("prune drops cache, sourcemaps, native prisma engines, sharp, docs; keeps sqlite wasm", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "prune-payload-"));
  write(path.join(root, ".next", "cache", "webpack", "chunk"), "cache-bytes-here");
  write(path.join(root, ".next", "static", "chunk.js"), "keep-js");
  write(path.join(root, ".next", "static", "chunk.js.map"), "sourcemap");
  write(path.join(root, "mcp-server", "index.js"), "junk");
  write(path.join(root, "electron-builder.json"), "{}");
  write(
    path.join(root, "node_modules", "@prisma", "engines", "schema-engine-debian-openssl-3.0.x"),
    "debian-engine"
  );
  write(
    path.join(root, "node_modules", "@prisma", "engines", "schema-engine-darwin-arm64"),
    "arm-engine"
  );
  write(
    path.join(
      root,
      "node_modules",
      "@prisma",
      "client",
      "runtime",
      "query_compiler_fast_bg.postgresql.wasm-base64.js"
    ),
    "pg-wasm"
  );
  write(
    path.join(
      root,
      "node_modules",
      "@prisma",
      "client",
      "runtime",
      "query_compiler_fast_bg.sqlite.wasm-base64.js"
    ),
    "sqlite-wasm"
  );
  write(path.join(root, "node_modules", "@prisma", "client", "index.d.ts"), "types");
  write(path.join(root, "node_modules", "@prisma", "client", "README.md"), "docs");
  write(path.join(root, "node_modules", "sharp", "index.js"), "sharp");
  write(path.join(root, "node_modules", "@img", "sharp-darwin-arm64", "lib"), "img");
  write(
    path.join(root, "node_modules", "better-sqlite3", "build", "Release", "better_sqlite3.node"),
    "node"
  );
  write(path.join(root, "node_modules", "better-sqlite3", "deps", "sqlite3.c"), "src");

  const result = prune.pruneStandaloneTree(root);
  assert.ok(result.total > 0);
  assert.equal(fs.existsSync(path.join(root, ".next", "cache")), false);
  assert.equal(fs.existsSync(path.join(root, ".next", "static", "chunk.js")), true);
  assert.equal(fs.existsSync(path.join(root, ".next", "static", "chunk.js.map")), false);
  assert.equal(fs.existsSync(path.join(root, "mcp-server")), false);
  assert.equal(fs.existsSync(path.join(root, "node_modules", "@prisma", "engines")), false);
  assert.equal(fs.existsSync(path.join(root, "node_modules", "sharp")), false);
  assert.equal(fs.existsSync(path.join(root, "node_modules", "@img")), false);
  assert.equal(fs.existsSync(path.join(root, "node_modules", "better-sqlite3", "deps")), false);
  assert.equal(
    fs.existsSync(
      path.join(root, "node_modules", "better-sqlite3", "build", "Release", "better_sqlite3.node")
    ),
    true
  );
  assert.equal(
    fs.existsSync(
      path.join(
        root,
        "node_modules",
        "@prisma",
        "client",
        "runtime",
        "query_compiler_fast_bg.postgresql.wasm-base64.js"
      )
    ),
    false
  );
  assert.equal(
    fs.existsSync(
      path.join(
        root,
        "node_modules",
        "@prisma",
        "client",
        "runtime",
        "query_compiler_fast_bg.sqlite.wasm-base64.js"
      )
    ),
    true
  );
  assert.equal(
    fs.existsSync(path.join(root, "node_modules", "@prisma", "client", "index.d.ts")),
    false
  );
  fs.rmSync(root, { recursive: true, force: true });
});

test("pruneElectronLocales keeps en and drops other lproj", () => {
  const app = fs.mkdtempSync(path.join(os.tmpdir(), "prune-locales-"));
  const res = path.join(
    app,
    "Contents",
    "Frameworks",
    "Electron Framework.framework",
    "Resources"
  );
  write(path.join(res, "en.lproj", "locale.pak"), "en");
  write(path.join(res, "de.lproj", "locale.pak"), "de");
  write(path.join(res, "zh_CN.lproj", "locale.pak"), "zh");
  const bytes = prune.pruneElectronLocales(app);
  assert.ok(bytes > 0);
  assert.equal(fs.existsSync(path.join(res, "en.lproj")), true);
  assert.equal(fs.existsSync(path.join(res, "de.lproj")), false);
  assert.equal(fs.existsSync(path.join(res, "zh_CN.lproj")), false);
  fs.rmSync(app, { recursive: true, force: true });
});

test("electron-builder keeps only en locales and does not asar-pack prisma", () => {
  const builder = JSON.parse(
    fs.readFileSync(path.join(projectRoot, "electron-builder.json"), "utf8")
  );
  assert.deepEqual(builder.mac.electronLanguages, ["en"]);
  assert.equal(builder.asarUnpack.includes("node_modules/@prisma/**/*"), false);
  assert.equal(builder.files.includes("node_modules/@prisma/**/*"), false);
  assert.ok(builder.files.includes("!node_modules/**"));
  assert.ok(builder.files.includes("node_modules/better-sqlite3/**/*"));
  assert.ok(builder.files.includes("node_modules/bindings/**/*"));
  assert.equal(builder.beforeBuild, "./electron/before-build.js");
});

test("CI reports app/DMG size and uploads only the DMG", () => {
  const workflow = fs.readFileSync(
    path.join(projectRoot, ".github", "workflows", "electron-build-macos.yml"),
    "utf8"
  );
  assert.ok(workflow.includes("packaged size"));
  assert.ok(workflow.includes("du -sh"));
  assert.ok(workflow.includes("assert-packaged-size.js"));
  assert.ok(workflow.includes("compression-level: 0"));
  assert.ok(workflow.includes("if-no-files-found: error"));
  assert.match(workflow, /path:\s*dist-electron\/\*\.dmg/);
  assert.doesNotMatch(
    workflow,
    /path:\s*dist-electron\/?\s*$/m,
    "must not upload the unpacked dist-electron folder"
  );
});

test("size budget file exists and is finite", () => {
  const budget = JSON.parse(
    fs.readFileSync(path.join(projectRoot, "electron", "size-budget.json"), "utf8")
  );
  assert.equal(typeof budget.appBytes, "number");
  assert.equal(typeof budget.dmgBytes, "number");
  assert.ok(budget.appBytes > 100 * 1024 * 1024);
  assert.ok(budget.dmgBytes > 50 * 1024 * 1024);
});
