"use strict";

function createJobGate(options = {}) {
  const concurrency = options.concurrency ?? 2;
  const timeoutMs = options.timeoutMs ?? 180_000;
  const inflight = new Map();
  let running = 0;
  const waiters = [];
  const controllers = new Set();

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

  async function run(messageKey, fn) {
    const key = String(messageKey || "");
    if (!key) return { skipped: "no_key" };
    if (inflight.has(key)) return { skipped: "deduped" };

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
      }, timeoutMs);
      try {
        return await fn(controller.signal);
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
  }

  return {
    run,
    cancelAll,
    inflightCount: () => inflight.size,
    runningCount: () => running,
  };
}

module.exports = { createJobGate };
