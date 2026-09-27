// Parser-blocking before styles and popup.js so document-script measures the
// earliest extension execution, not the end of HTML and stylesheet parsing.
// Timings only: never collect page URLs, titles, transcript text, or error text.
(() => {
  const startedAt = performance.timeOrigin;
  const events = [];
  const startupAnchorNames = new Set([
    "document-script",
    "popup-script",
    "dom-ready",
    "window-load",
    "first-paint",
    "first-contentful-paint",
  ]);
  let saveTimer = null;
  const appendEvent = (event) => {
    if (events.length >= 160) {
      const removableIndex = events.findIndex(
        (item) => !startupAnchorNames.has(item.name),
      );
      events.splice(removableIndex >= 0 ? removableIndex : 0, 1);
    }
    events.push(event);
  };
  const mark = (name, durationMs, context = {}) => {
    appendEvent({
      name,
      atMs: Math.round(performance.now()),
      wallAt: Date.now(),
      ...(Number.isFinite(durationMs)
        ? { durationMs: Math.round(durationMs) }
        : {}),
      ...(typeof context.launchId === "string"
        ? { launchId: context.launchId.slice(0, 64) }
        : {}),
      ...(typeof context.primaryStateVisible === "boolean"
        ? { primaryStateVisible: context.primaryStateVisible }
        : {}),
    });
    // Throttle writes while keeping later retained-document activity observable.
    if (saveTimer === null)
      saveTimer = setTimeout(() => {
        saveTimer = null;
        void save();
      }, 1000);
  };
  const afterNextPaint = (name, context) => {
    requestAnimationFrame(() =>
      requestAnimationFrame(() => mark(name, undefined, context)),
    );
  };
  mark("document-script");
  globalThis.TranscriberPanelDiagnostics = { mark, afterNextPaint };
  document.addEventListener("DOMContentLoaded", () => mark("dom-ready"));
  window.addEventListener("load", () => mark("window-load"));
  window.addEventListener("focus", () => mark("focus"));
  document.addEventListener("visibilitychange", () =>
    mark(`visibility:${document.visibilityState}`),
  );
  window.addEventListener("error", () => mark("error"), true);
  window.addEventListener("unhandledrejection", () =>
    mark("unhandled-rejection"),
  );

  for (const type of ["paint", "longtask"]) {
    try {
      const observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          appendEvent({
            name: type === "paint" ? entry.name : "long-task",
            atMs: Math.round(entry.startTime),
            wallAt: Math.round(startedAt + entry.startTime),
            durationMs: Math.round(entry.duration),
          });
        }
      });
      observer.observe({ type, buffered: true });
    } catch {
      /* Unsupported browser metric; other timings still work. */
    }
  }

  // One independent key per document avoids concurrent-window read/write races.
  // Reports retain the last 160 events across at most 40 documents, matching
  // the click retention limit so evicted evidence is never reported as a hang.
  const key = `panelTrace_${startedAt}`;
  async function save() {
    try {
      if (!globalThis.chrome?.storage?.local) return;
      const currentWindow = await chrome.windows?.getCurrent?.();
      const navigation = performance.getEntriesByType("navigation")[0];
      const resources = performance
        .getEntriesByType("resource")
        .filter((entry) => entry.name.startsWith(location.origin + "/"))
        .slice(0, 40)
        .map((entry) => ({
          file: new URL(entry.name).pathname.split("/").pop(),
          startMs: Math.round(entry.startTime),
          durationMs: Math.round(entry.duration),
        }));
      await chrome.storage.local.set({
        [key]: {
          startedAt,
          windowId: currentWindow?.id ?? null,
          capturedAt: Date.now(),
          events: events.slice(),
          resources,
          navigation: navigation
            ? {
                responseStartMs: Math.round(navigation.responseStart),
                responseEndMs: Math.round(navigation.responseEnd),
                domInteractiveMs: Math.round(navigation.domInteractive),
              }
            : null,
        },
      });
      const storageKeys = chrome.storage.local.getKeys
        ? await chrome.storage.local.getKeys()
        : Object.keys(await chrome.storage.local.get(null));
      const traceKeys = storageKeys.filter((name) =>
        name.startsWith("panelTrace_"),
      );
      const storedTraces = traceKeys.length
        ? await chrome.storage.local.get(traceKeys)
        : {};
      const stale = traceKeys
        .map((name) => [name, storedTraces[name]])
        .sort(
          ([leftName, left], [rightName, right]) =>
            (right?.capturedAt ?? Number(rightName.slice(11))) -
            (left?.capturedAt ?? Number(leftName.slice(11))),
        )
        .slice(40);
      if (stale.length)
        await chrome.storage.local.remove(stale.map(([name]) => name));
    } catch {
      /* Diagnostics must never block the panel. */
    }
  }
  for (const delay of [1000, 5000, 15000, 30000])
    setTimeout(() => {
      void save();
    }, delay);
})();
