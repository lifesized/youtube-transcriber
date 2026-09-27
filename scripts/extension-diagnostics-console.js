// Paste in DevTools opened by right-clicking inside the Transcriber side panel.
// Prints a report and copies its JSON without depending on the service worker.
(async () => {
  if (!globalThis.TranscriberStartupReport) {
    await import(chrome.runtime.getURL("startup-report.js"));
  }
  const data = await chrome.storage.local.get(null);
  const traces = Object.entries(data)
    .filter(([key]) => key.startsWith("panelTrace_"))
    .map(([, value]) => value)
    .sort((a, b) => a.startedAt - b.startedAt);
  const clicks = Object.entries(data)
    .filter(([key]) => key.startsWith("panelClick_"))
    .map(([, value]) => value)
    .sort((a, b) => a.clickedAt - b.clickedAt);
  const capturedAt = Date.now();
  const launches = globalThis.TranscriberStartupReport.buildLaunchRows({
    traces,
    clicks,
    capturedAt,
  });
  const report = {
    schemaVersion: 2,
    version: chrome.runtime.getManifest().version,
    capturedAt,
    traces,
    clicks,
    launches,
  };
  console.log("Toolbar launch attempts (all durations from click, ms):");
  console.table(launches);
  console.table(
    traces.map((trace) => {
      const event = (name) =>
        trace.events.find((item) => item.name === name)?.atMs ?? null;
      const click = clicks
        .filter(
          (item) =>
            item.windowId === trace.windowId &&
            item.clickedAt <= trace.startedAt &&
            trace.startedAt - item.clickedAt < 120000,
        )
        .at(-1);
      return {
        started: new Date(trace.startedAt).toISOString(),
        // Approximate correlation only; reused panels have no new navigation.
        possibleClickToNavigationMs: click
          ? Math.round(trace.startedAt - click.clickedAt)
          : null,
        firstScriptMs: event("document-script"),
        firstPaintMs: event("first-contentful-paint"),
        appScriptMs: event("popup-script"),
        cachedHistoryMs: event("recent-cache-rendered"),
        freshHistoryMs: event("recent-response"),
      };
    }),
  );
  console.log(JSON.stringify(report, null, 2));
  const textarea = document.createElement("textarea");
  textarea.value = JSON.stringify(report, null, 2);
  textarea.style.position = "fixed";
  textarea.style.opacity = "0";
  document.body.appendChild(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  console.log("Transcriber startup report copied:", copied);
  return report;
})();
