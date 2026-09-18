import test from "node:test";
import assert from "node:assert/strict";
import { parseRequestLimit } from "./request-limit";

test("request limits distinguish omission from malformed values", () => {
  assert.deepEqual(parseRequestLimit(null), { ok: true, value: undefined });
  assert.deepEqual(parseRequestLimit("5"), { ok: true, value: 5 });
  assert.deepEqual(parseRequestLimit("500"), { ok: true, value: 100 });

  for (const value of ["", "0", "-1", "5junk", "1.5", " 5 "]) {
    assert.deepEqual(parseRequestLimit(value), { ok: false });
  }
});
