// Deferred before popup.js; buffered browser entries retain earlier timings.
// Timings only: never collect page URLs, titles, transcript text, or error text.
(() => {
  const startedAt = performance.timeOrigin;
  const events = [];
  let saveTimer = null;
  const mark = (name, durationMs) => {
    if (events.length >= 160) events.shift();
    events.push({
      name,
      atMs: Math.round(performance.now()),
      ...(Number.isFinite(durationMs)
        ? { durationMs: Math.round(durationMs) }
        : {}),
    });
    // Throttle writes while keeping later retained-document activity observable.
    if (saveTimer === null)
      saveTimer = setTimeout(() => {
        saveTimer = null;
        void save();
      }, 1000);
  };
  mark("document-script");
  globalThis.TranscriberPanelDiagnostics = { mark };
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
          if (events.length < 160)
            events.push({
              name: type === "paint" ? entry.name : "long-task",
              atMs: Math.round(entry.startTime),
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
  // Reports retain the last 160 events across at most 12 documents.
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
      const keys = chrome.storage.local.getKeys
        ? await chrome.storage.local.getKeys()
        : Object.keys(await chrome.storage.local.get(null));
      const stale = keys
        .filter((name) => name.startsWith("panelTrace_"))
        .sort((a, b) => Number(b.slice(11)) - Number(a.slice(11)))
        .slice(12);
      if (stale.length) await chrome.storage.local.remove(stale);
    } catch {
      /* Diagnostics must never block the panel. */
    }
  }
  for (const delay of [1000, 5000, 15000, 30000])
    setTimeout(() => {
      void save();
    }, delay);
})();
