/**
 * Home page gate: first-time paste screen (FTU) vs Library. Server rows
 * unlock the Library even when this browser never set the localStorage flag
 * (transcripts made from the extension or another client).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { UNLOCK_KEY, libraryView, parseSelectedId, rememberUnlock } = await import(
  "../lib/library-gate.ts"
);

function memoryStorage(initial = {}) {
  const data = new Map(Object.entries(initial));
  return {
    getItem: (key) => (data.has(key) ? data.get(key) : null),
    setItem: (key, value) => data.set(key, String(value)),
  };
}

const fresh = { unlocked: false, listLoading: false, rowCount: 0, selected: "none" };

test("zero rows and no ?id shows the FTU paste screen", () => {
  assert.equal(libraryView(fresh), "ftu");
  const storage = memoryStorage();
  assert.equal(rememberUnlock(storage, "ftu"), false);
  assert.equal(storage.getItem(UNLOCK_KEY), null);
});

test("nothing is decided before the first list fetch settles", () => {
  assert.equal(libraryView({ ...fresh, listLoading: true }), "pending");
  const storage = memoryStorage();
  assert.equal(rememberUnlock(storage, "pending"), false);
  assert.equal(storage.getItem(UNLOCK_KEY), null);
});

test("rows present with no flag shows the Library and sets the flag", () => {
  const view = libraryView({ ...fresh, rowCount: 1 });
  assert.equal(view, "library");
  const storage = memoryStorage();
  assert.equal(rememberUnlock(storage, view), true);
  assert.equal(storage.getItem(UNLOCK_KEY), "true");
});

test("the flag alone still shows the Library without waiting", () => {
  assert.equal(libraryView({ ...fresh, unlocked: true, listLoading: true }), "library");
});

test("?id= with a valid id opens it on a browser that never went through FTU", () => {
  assert.equal(parseSelectedId("cmg1abc_DEF-42"), "cmg1abc_DEF-42");
  assert.equal(libraryView({ ...fresh, selected: "loading" }), "pending");
  assert.equal(libraryView({ ...fresh, listLoading: true, selected: "loaded" }), "library");
  assert.equal(libraryView({ ...fresh, rowCount: 3, selected: "loading" }), "library");
});

test("?id= with an invalid id falls back gracefully", () => {
  for (const raw of [null, "", "../etc", "a b", "<x>", "x".repeat(129)]) {
    assert.equal(parseSelectedId(raw), null, String(raw));
  }
  // Well-formed but not in the DB: FTU for an empty library, Library otherwise.
  assert.equal(libraryView({ ...fresh, selected: "missing" }), "ftu");
  assert.equal(libraryView({ ...fresh, rowCount: 2, selected: "missing" }), "library");
});

test("page.tsx decides with the gate, not the localStorage flag alone", () => {
  const page = fs.readFileSync(path.join(root, "app", "page.tsx"), "utf8");
  assert.match(page, /@\/lib\/library-gate/);
  assert.match(page, /libraryView\(/);
  assert.match(page, /rememberUnlock\(/);
  assert.doesNotMatch(page, /\{hasCreatedTranscript && \(/);
});
