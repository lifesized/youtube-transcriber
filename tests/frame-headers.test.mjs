/**
 * R2: no Transcriber page may be framed by another site (clickjacking).
 *
 * Next applies next.config.ts headers() to every response whose path matches
 * a rule. buildCustomRoute is the build step that compiles each rule's source
 * into the routes-manifest regex the standalone server matches against.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { buildCustomRoute } = require("next/dist/lib/build-custom-route");
const { default: nextConfig } = await import("../next.config.ts");

const PAGES = ["/", "/library", "/settings", "/about", "/transcripts/abc123", "/does-not-exist"];

async function headerRules() {
  return typeof nextConfig.headers === "function" ? await nextConfig.headers() : [];
}

async function responseHeaders(pathname) {
  const out = [];
  for (const rule of await headerRules()) {
    if (!new RegExp(buildCustomRoute("header", rule).regex).test(pathname)) continue;
    assert.equal(rule.has, undefined, "frame headers must not depend on request conditions");
    assert.equal(rule.missing, undefined, "frame headers must not depend on request conditions");
    for (const { key, value } of rule.headers) out.push([key.toLowerCase(), value]);
  }
  return out;
}

function cspDirectives(value) {
  const directives = new Map();
  for (const part of value.split(";")) {
    const [name, ...sources] = part.trim().split(/\s+/);
    if (name) directives.set(name.toLowerCase(), sources);
  }
  return directives;
}

test("every page forbids framing with frame-ancestors 'none' and X-Frame-Options DENY", async () => {
  for (const page of PAGES) {
    const headers = await responseHeaders(page);
    const csp = headers.filter(([k]) => k === "content-security-policy");
    const xfo = headers.filter(([k]) => k === "x-frame-options");
    assert.equal(csp.length, 1, `${page}: one Content-Security-Policy`);
    assert.deepEqual(cspDirectives(csp[0][1]).get("frame-ancestors"), ["'none'"], page);
    assert.deepEqual(xfo, [["x-frame-options", "DENY"]], page);
  }
});

test("CI checks the packaged app's frame headers on its pages", () => {
  const wf = readFileSync(new URL("../.github/workflows/electron-build-macos.yml", import.meta.url), "utf8");
  const launch = wf.slice(wf.indexOf("- name: Launch packaged Transcriber.app"));
  const step = launch.slice(0, launch.indexOf("\n      - name: ", 1));
  const start = step.indexOf("pages forbid framing");
  const rest = step.slice(start);
  const end = rest.indexOf('\n              echo "----- ', 1);
  const framing = end === -1 ? rest : rest.slice(0, end);
  assert.match(framing, /frame-ancestors 'none'/);
  assert.match(framing, /x-frame-options: \*DENY/i);
  assert.match(framing, /rm -f \/tmp\/packaged-frame\.txt/);
  assert.match(framing, /%\{http_code\}/);
  assert.doesNotMatch(framing, /curl[^\n]*\|\| true/);
  assert.match(framing, /"\/"[^;]*"\/\?layout=list&id=ci"/);
  assert.match(framing, /\/api\/health/);
  assert.match(framing, /401/);
  assert.match(framing, /421/);
});
