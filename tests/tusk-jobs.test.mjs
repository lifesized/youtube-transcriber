import assert from "node:assert/strict";
import test from "node:test";
import { setTimeout as delay } from "node:timers/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const { createJobGate, createLlmBudget } = require(path.join(root, "electron/tusk/jobs.js"));

test("job queue is bounded and extra work is skipped", async () => {
  const gate = createJobGate({ concurrency: 1, maxQueue: 2, timeoutMs: 5_000 });
  const started = [];
  const work = (id) => async () => {
    started.push(id);
    await delay(40);
    return id;
  };
  const a = gate.run("a", work("a"));
  const b = gate.run("b", work("b"));
  const c = gate.run("c", work("c"));
  const d = gate.run("d", work("d"));
  const [ra, rb, rc, rd] = await Promise.all([a, b, c, d]);
  assert.equal(ra, "a");
  assert.equal(rb, "b");
  assert.equal(rc, "c");
  assert.equal(rd.skipped, "queue_full");
  assert.deepEqual(started, ["a", "b", "c"]);
});

test("hourly and daily caps reject further LLM calls", () => {
  let now = 1_000;
  const budget = createLlmBudget({
    hourlyLimit: 2,
    dailyLimit: 3,
    hourMs: 100,
    dayMs: 1_000,
    now: () => now,
  });
  budget.take();
  budget.take();
  assert.throws(() => budget.take(), (err) => err.code === "llm_hourly_cap" && err.status === 429);
  now = 1_200;
  budget.take();
  assert.throws(() => budget.take(), (err) => err.code === "llm_daily_cap" && err.status === 429);
});

test("duration cap aborts the job and cancels only that server job", async () => {
  const cancelled = [];
  const gate = createJobGate({
    concurrency: 1,
    timeoutMs: 25,
    cancelServerJob: async (jobId) => {
      cancelled.push(jobId);
    },
  });
  const result = await gate.run("slow", async (signal, jobId) => {
    assert.equal(typeof jobId, "string");
    assert.ok(jobId.length >= 8);
    await delay(80);
    return signal.aborted ? "aborted" : "done";
  });
  assert.equal(result, "aborted");
  assert.equal(cancelled.length, 1);
  assert.equal(typeof cancelled[0], "string");
  assert.ok(cancelled[0].length >= 8);
});

test("cancelAll asks the server to cancel Tusk jobs, not a specific local id", async () => {
  const cancelled = [];
  const gate = createJobGate({
    concurrency: 1,
    timeoutMs: 5_000,
    cancelServerJob: async (jobId) => {
      cancelled.push(jobId);
    },
  });
  const pending = gate.run("held", async (signal) => {
    await delay(80);
    return signal.aborted ? "aborted" : "done";
  });
  await delay(5);
  gate.cancelAll();
  assert.equal(await pending, "aborted");
  assert.equal(cancelled.length, 1);
  assert.equal(cancelled[0], undefined);
});

test("createJobGate.takeLlm uses the shared budget", () => {
  const gate = createJobGate({ hourlyLimit: 1, dailyLimit: 1 });
  gate.takeLlm();
  assert.throws(() => gate.takeLlm(), (err) => err.code === "llm_hourly_cap");
});
