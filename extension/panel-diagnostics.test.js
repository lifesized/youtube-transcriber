const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const path = require("node:path");
const source = fs.readFileSync(
  path.join(__dirname, "panel-diagnostics.js"),
  "utf8",
);

test("diagnostics bound traces, strip page data and tolerate storage failure", async () => {
  const timers = [];
  const saved = {};
  const removed = [];
  const old = Object.fromEntries(
    Array.from({ length: 15 }, (_, i) => [`panelTrace_${i}`, {}]),
  );
  const context = vm.createContext({
    performance: {
      timeOrigin: 1000,
      now: () => 10,
      getEntriesByType: (type) =>
        type === "resource"
          ? [
              {
                name: "chrome-extension://test/popup.css?secret=hidden",
                startTime: 1,
                duration: 123,
              },
              {
                name: "https://private.example/transcript",
                startTime: 1,
                duration: 999,
              },
            ]
          : [],
    },
    Date,
    URL,
    location: { origin: "chrome-extension://test" },
    document: { addEventListener() {} },
    window: { addEventListener() {} },
    setTimeout: (fn) => timers.push(fn),
    chrome: {
      storage: {
        local: {
          set: async (value) => Object.assign(saved, value),
          get: async () => ({ ...old, ...saved }),
          remove: async (keys) => removed.push(...keys),
        },
      },
    },
  });
  vm.runInContext(source, context);
  for (let i = 0; i < 200; i++)
    context.TranscriberPanelDiagnostics.mark("test", 5);
  timers[0]();
  await new Promise((resolve) => setImmediate(resolve));
  const trace = saved.panelTrace_1000;
  assert.equal(trace.events.length, 160);
  assert.equal(trace.resources.length, 1);
  assert.equal(trace.resources[0].file, "popup.css");
  assert.equal(removed.length, 4);
  assert.doesNotMatch(JSON.stringify(saved), /secret|private/);
  context.TranscriberPanelDiagnostics.mark("focus");
  timers.at(-1)();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(saved.panelTrace_1000.events.at(-1).name, "focus");
  context.chrome.storage.local.set = async () => {
    throw new Error("unavailable");
  };
  timers[1]();
  await new Promise((resolve) => setImmediate(resolve));
});
