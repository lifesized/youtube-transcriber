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

test("prune drops cache, sourcemaps, foreign prisma engines, keeps darwin-arm64 and sqlite", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "prune-payload-"));
  write(path.join(root, ".next", "cache", "webpack", "chunk"), "cache-bytes-here");
  write(path.join(root, ".next", "static", "chunk.js"), "keep-js");
  write(path.join(root, ".next", "static", "chunk.js.map"), "sourcemap");
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

  const result = prune.pruneStandaloneTree(root);
  assert.ok(result.total > 0);
  assert.equal(fs.existsSync(path.join(root, ".next", "cache")), false);
  assert.equal(fs.existsSync(path.join(root, ".next", "static", "chunk.js")), true);
  assert.equal(fs.existsSync(path.join(root, ".next", "static", "chunk.js.map")), false);
  assert.equal(
    fs.existsSync(
      path.join(root, "node_modules", "@prisma", "engines", "schema-engine-debian-openssl-3.0.x")
    ),
    false
  );
  assert.equal(
    fs.existsSync(
      path.join(root, "node_modules", "@prisma", "engines", "schema-engine-darwin-arm64")
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
});

test("CI reports app/DMG size and uploads only the DMG", () => {
  const workflow = fs.readFileSync(
    path.join(projectRoot, ".github", "workflows", "electron-build-macos.yml"),
    "utf8"
  );
  assert.ok(workflow.includes("packaged size"));
  assert.ok(workflow.includes("du -sh"));
  assert.ok(workflow.includes("compression-level: 0"));
  assert.ok(workflow.includes("if-no-files-found: error"));
  assert.match(workflow, /path:\s*dist-electron\/\*\.dmg/);
  assert.doesNotMatch(
    workflow,
    /path:\s*dist-electron\/?\s*$/m,
    "must not upload the unpacked dist-electron folder"
  );
});
