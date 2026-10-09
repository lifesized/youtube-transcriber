"use strict";

const { randomUUID } = require("node:crypto");

const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

function createLlmBudget(options = {}) {
  const hourlyLimit = options.hourlyLimit ?? 20;
  const dailyLimit = options.dailyLimit ?? 80;
  const hourMs = options.hourMs ?? HOUR_MS;
  const dayMs = options.dayMs ?? DAY_MS;
  const clock = typeof options.now === "function" ? options.now : Date.now;
  const hits = [];

  function prune(now) {
    const keepAfter = now - dayMs;
    while (hits.length && hits[0] < keepAfter) hits.shift();
  }

  function take() {
    const now = clock();
    prune(now);
    const hourStart = now - hourMs;
    let hourCount = 0;
    for (const t of hits) {
      if (t >= hourStart) hourCount += 1;
    }
    if (hourCount >= hourlyLimit) {
      const err = new Error("Tusk hit the hourly summary cap. Try again in a bit.");
      err.code = "llm_hourly_cap";
      err.status = 429;
      throw err;
    }
    if (hits.length >= dailyLimit) {
      const err = new Error("Tusk hit the daily summary cap. Try again tomorrow.");
      err.code = "llm_daily_cap";
      err.status = 429;
      throw err;
    }
    hits.push(now);
    return true;
  }

  return {
    take,
    count: () => hits.length,
    hourlyLimit,
    dailyLimit,
  };
}

function createJobGate(options = {}) {
  const concurrency = options.concurrency ?? 2;
  const timeoutMs = options.timeoutMs ?? 180_000;
  const maxQueue = options.maxQueue ?? 16;
  const inflight = new Map();
  let running = 0;
  const waiters = [];
  const controllers = new Set();
  const llmBudget = options.llmBudget || createLlmBudget(options);

  function takeSlot() {
    if (running < concurrency) {
      running += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => waiters.push(resolve));
  }

  function releaseSlot() {
    running = Math.max(0, running - 1);
    const next = waiters.shift();
    if (next) {
      running += 1;
      next();
    }
  }

  async function cancelServerJob(jobId) {
    if (typeof options.cancelServerJob !== "function") return;
    try {
      await options.cancelServerJob(jobId);
    } catch {
      // cancel is best-effort; the AbortController still fired
    }
  }

  async function run(messageKey, fn) {
    const key = String(messageKey || "");
    if (!key) return { skipped: "no_key" };
    if (inflight.has(key)) return { skipped: "deduped" };
    if (running >= concurrency && waiters.length >= maxQueue) {
      return { skipped: "queue_full" };
    }

    const jobId = randomUUID();
    const controller = new AbortController();
    controllers.add(controller);
    const work = (async () => {
      await takeSlot();
      const timer = setTimeout(() => {
        try {
          controller.abort();
        } catch {
          // already aborted
        }
        void cancelServerJob(jobId);
      }, timeoutMs);
      try {
        return await fn(controller.signal, jobId);
      } finally {
        clearTimeout(timer);
        controllers.delete(controller);
        releaseSlot();
      }
    })();
    inflight.set(key, work);
    try {
      return await work;
    } finally {
      inflight.delete(key);
    }
  }

  function cancelAll() {
    for (const controller of controllers) {
      try {
        controller.abort();
      } catch {
        // ignore
      }
    }
    controllers.clear();
    // No jobId: cancel every Tusk-tagged server job, never local/untagged work.
    void cancelServerJob();
  }

  return {
    run,
    cancelAll,
    takeLlm: () => llmBudget.take(),
    inflightCount: () => inflight.size,
    runningCount: () => running,
    queuedCount: () => waiters.length,
    maxQueue,
    timeoutMs,
  };
}

module.exports = { createJobGate, createLlmBudget, HOUR_MS, DAY_MS };
