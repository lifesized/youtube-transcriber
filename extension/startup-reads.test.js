const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const source = fs.readFileSync(
  require("node:path").join(__dirname, "popup.js"),
  "utf8",
);
const init = source.slice(
  source.indexOf("async function init() {"),
  source.indexOf("// Poll for transcription completion"),
);
const flush = () => new Promise((resolve) => setImmediate(resolve));
const pending = () => new Promise(() => {});

function harness(settings = Promise.resolve({ mode: "local" })) {
  const calls = [];
  const node = { classList: { add() {}, remove() {} } };
  const context = vm.createContext({
    performance,
    console,
    initVersion: 0,
    currentMode: "cloud",
    el: new Proxy({}, { get: () => node }),
    ALL_STATES: [],
    applyFooterLink() {},
    stopOfflinePolling() {},
    renderRecentSkeleton() {},
    hideStartupShell() {},
    SUMMARY_EXPERIENCE_DEFAULT_KEY: "summaryDefault",
    getCachedAuth: pending,
    chrome: {
      tabs: { query: pending },
      storage: { sync: { get: () => settings } },
    },
    initWasSuperseded: (version) => version !== context.initVersion,
    loadRecent: (mode) => calls.push(mode),
    showErrorState() {},
    readSummaryExperienceDefault: () => false,
    persistSummaryExperienceDefault: pending,
  });
  vm.runInContext(init, context);
  return { context, calls };
}

test("actual init starts local history even when tabs and auth never resolve", async () => {
  const { context, calls } = harness();
  void context.init();
  await flush();
  assert.deepEqual(calls, ["local"]);
});

test("superseded init cannot start a late history load", async () => {
  let resolve;
  const { context, calls } = harness(
    new Promise((r) => {
      resolve = r;
    }),
  );
  void context.init();
  context.initVersion++;
  resolve({ mode: "local" });
  await flush();
  assert.deepEqual(calls, []);
});

test("settings failure must not guess another history mode", async () => {
  const { context, calls } = harness(
    Promise.reject(new Error("storage unavailable")),
  );
  void context.init();
  await flush();
  assert.deepEqual(calls, []);
});

test("late history response cannot render or cache after mode change", async () => {
  let respond;
  const calls = [];
  const start = source.indexOf("let recentLoadVersion = 0;");
  const end = source.indexOf("function renderRecentSkeleton", start);
  const context = vm.createContext({
    initVersion: 1,
    currentMode: "local",
    getCachedRecent: async () => null,
    isSettingsOpen: () => false,
    renderRecentSkeleton() {},
    renderRecentList: () => calls.push("render"),
    setCachedRecent: () => calls.push("cache"),
    sendMsg: (msg) => {
      assert.equal(msg.mode, "local");
      return new Promise((resolve) => {
        respond = resolve;
      });
    },
  });
  vm.runInContext(source.slice(start, end), context);
  const loading = context.loadRecent();
  await flush();
  context.currentMode = "cloud";
  respond({ success: true, data: [{ id: "local-item" }] });
  await loading;
  assert.deepEqual(calls, []);
});

test("worker rejects history request belonging to a previous mode", async () => {
  const background = fs.readFileSync(
    require("node:path").join(__dirname, "background.js"),
    "utf8",
  );
  const start = background.indexOf("async function getRecent(");
  const end = background.indexOf("async function getTranscript(", start);
  let fetched = false;
  const context = vm.createContext({
    getApiConfig: async () => ({ mode: "cloud" }),
    fetch: () => {
      fetched = true;
    },
  });
  vm.runInContext(background.slice(start, end), context);
  await assert.rejects(context.getRecent("local"), /mode changed/);
  assert.equal(fetched, false);
});
