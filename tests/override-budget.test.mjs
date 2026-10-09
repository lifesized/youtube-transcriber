import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("override budget returns 429 after the hourly cap", async () => {
  const { createOverrideBudget, OverrideCapError, overrideHourlyLimit } =
    await import("../lib/override-budget.ts");
  let now = 1_000;
  const budget = createOverrideBudget({
    hourlyLimit: 2,
    hourMs: 100,
    now: () => now,
  });
  budget.take();
  budget.take();
  assert.throws(
    () => budget.take(),
    (err) =>
      err instanceof OverrideCapError &&
      err.status === 429 &&
      err.code === "override_hourly_cap"
  );
  now = 1_200;
  assert.equal(budget.take(), true);
  assert.equal(overrideHourlyLimit({}), 20);
  assert.equal(overrideHourlyLimit({ TUSK_OVERRIDE_HOURLY_CAP: "5" }), 5);
});

test("summaries routes take an override slot before the paid call", () => {
  const summaries = readFileSync(path.join(repoRoot, "app/api/summaries/route.ts"), "utf8");
  assert.match(summaries, /takeOverrideSlot/);
  assert.match(summaries, /status:\s*429/);
  const overrideBlock = summaries.slice(
    summaries.indexOf("if (promptOverride)"),
    summaries.indexOf("const job = beginServerJob")
  );
  assert.match(overrideBlock, /takeOverrideSlot/);
  assert.match(overrideBlock, /OverrideCapError/);
});
