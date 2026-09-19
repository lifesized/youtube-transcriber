// Paste in the Transcriber SERVICE WORKER DevTools console, not YouTube's.
// Prints a report and copies JSON using the DevTools copy() helper if available.
(async () => {
  const data = await chrome.storage.local.get(null);
  const traces = Object.entries(data)
    .filter(([key]) => key.startsWith("panelTrace_"))
    .map(([, value]) => value)
    .sort((a, b) => a.startedAt - b.startedAt);
  const clicks = Object.entries(data)
    .filter(([key]) => key.startsWith("panelClick_"))
    .map(([, value]) => value)
    .sort((a, b) => a.clickedAt - b.clickedAt);
  const report = {
    version: chrome.runtime.getManifest().version,
    traces,
    clicks,
  };
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
  if (typeof copy === "function") copy(JSON.stringify(report, null, 2));
  return report;
})();
