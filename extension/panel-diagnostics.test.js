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
  const animationFrames = [];
  const saved = {};
  const removed = [];
  const getRequests = [];
  const old = Object.fromEntries(
    Array.from({ length: 45 }, (_, i) => [`panelTrace_${i}`, {}]),
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
    Date: { now: () => 1010 },
    URL,
    location: { origin: "chrome-extension://test" },
    document: { addEventListener() {} },
    window: { addEventListener() {} },
    setTimeout: (fn) => timers.push(fn),
    requestAnimationFrame: (fn) => animationFrames.push(fn),
    chrome: {
      storage: {
        local: {
          set: async (value) => Object.assign(saved, value),
          getKeys: async () => Object.keys({ ...old, ...saved }),
          get: async (keys) => {
            getRequests.push(keys);
            return { ...old, ...saved };
          },
          remove: async (keys) => removed.push(...keys),
        },
      },
    },
  });
  vm.runInContext(source, context);
  context.TranscriberPanelDiagnostics.mark("popup-script");
  for (let i = 0; i < 200; i++)
    context.TranscriberPanelDiagnostics.mark("test", 5);
  timers[0]();
  await new Promise((resolve) => setImmediate(resolve));
  const trace = saved.panelTrace_1000;
  assert.equal(trace.events.length, 160);
  assert.ok(
    trace.events.some((event) => event.name === "document-script"),
    "the initial document timing must survive retained-panel event pruning",
  );
  assert.ok(
    trace.events.some((event) => event.name === "popup-script"),
    "the initial application timing must survive retained-panel event pruning",
  );
  assert.equal(trace.events.at(-1).wallAt, 1010);
  assert.equal(trace.resources.length, 1);
  assert.equal(trace.resources[0].file, "popup.css");
  assert.equal(removed.length, 6);
  assert.equal(removed.includes("panelTrace_1000"), false);
  assert.ok(
    getRequests.every(Array.isArray),
    "trace pruning must not materialize unrelated extension-local storage",
  );
  assert.doesNotMatch(JSON.stringify(saved), /secret|private/);
  context.TranscriberPanelDiagnostics.mark("focus");
  context.TranscriberPanelDiagnostics.afterNextPaint("panel-frame-presented", {
    launchId: "launch-123",
    primaryStateVisible: true,
    url: "must-not-be-recorded",
  });
  animationFrames.shift()();
  animationFrames.shift()();
  timers.at(-1)();
  await new Promise((resolve) => setImmediate(resolve));
  assert.ok(
    saved.panelTrace_1000.events.some((event) => event.name === "focus"),
  );
  const frameEvent = saved.panelTrace_1000.events.find(
    (event) => event.name === "panel-frame-presented",
  );
  assert.equal(frameEvent?.wallAt, 1010);
  assert.equal(frameEvent?.launchId, "launch-123");
  assert.equal(frameEvent?.primaryStateVisible, true);
  assert.equal(frameEvent?.url, undefined);
  context.chrome.storage.local.set = async () => {
    throw new Error("unavailable");
  };
  timers[1]();
  await new Promise((resolve) => setImmediate(resolve));
});
