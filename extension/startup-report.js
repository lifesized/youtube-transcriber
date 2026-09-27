(function exposeStartupReport(root, factory) {
  const api = factory();
  root.TranscriberStartupReport = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(globalThis, () => {
  const MAX_LAUNCH_WINDOW_MS = 120_000;
  const STATE_FRAME_SUFFIX = "-frame-presented";

  function eventWallAt(trace, event) {
    return Number.isFinite(event.wallAt)
      ? event.wallAt
      : trace.startedAt + event.atMs;
  }

  function eventBelongsToClick(event, click, eventAt, nextClickedAt) {
    if (typeof event.launchId === "string") {
      return (
        event.launchId === click.launchId &&
        eventAt >= click.clickedAt &&
        eventAt < nextClickedAt &&
        eventAt - click.clickedAt < MAX_LAUNCH_WINDOW_MS
      );
    }
    return (
      eventAt >= click.clickedAt &&
      eventAt < nextClickedAt &&
      eventAt - click.clickedAt < MAX_LAUNCH_WINDOW_MS
    );
  }

  function eventCanProveLaunch(trace, event, click, eventAt, nextClickedAt) {
    const retainedDocument = trace.startedAt < click.clickedAt;
    if (retainedDocument && typeof event.launchId !== "string") return false;
    return eventBelongsToClick(event, click, eventAt, nextClickedAt);
  }

  function firstEventAfterClick(trace, click, predicate, nextClickedAt) {
    const event = trace?.events
      ?.filter((item) => predicate(item.name))
      .map((item) => ({ ...item, wallAt: eventWallAt(trace, item) }))
      .filter((item) =>
        eventCanProveLaunch(trace, item, click, item.wallAt, nextClickedAt),
      )
      .sort((a, b) => a.wallAt - b.wallAt)[0];
    return event || null;
  }

  function durationAfterClick(trace, click, predicate, nextClickedAt) {
    const event = firstEventAfterClick(
      trace,
      click,
      predicate,
      nextClickedAt,
    );
    return event ? Math.round(event.wallAt - click.clickedAt) : null;
  }

  function traceForClick(traces, click, nextClickedAt) {
    const candidates = traces
      .filter((trace) => trace.windowId === click.windowId)
      .map((trace) => {
        const firstEventAt = trace.events
          .filter((event) => event.name !== "launch-signal")
          .map((event) => ({ event, wallAt: eventWallAt(trace, event) }))
          .filter(({ event, wallAt }) =>
            eventCanProveLaunch(
              trace,
              event,
              click,
              wallAt,
              nextClickedAt,
            ),
          )
          .map(({ wallAt }) => wallAt)
          .sort((a, b) => a - b)[0];
        const hasLaunchId = trace.events.some(
          (event) =>
            event.name !== "launch-signal" &&
            event.launchId === click.launchId,
        );
        return { trace, firstEventAt, hasLaunchId };
      })
      .filter(({ firstEventAt }) => Number.isFinite(firstEventAt))
      .sort(
        (a, b) =>
          Number(b.hasLaunchId) - Number(a.hasLaunchId) ||
          a.firstEventAt - b.firstEventAt,
      );
    return candidates[0]?.trace;
  }

  function buildLaunchRows(report) {
    const traces = Array.isArray(report.traces) ? report.traces : [];
    const clicks = Array.isArray(report.clicks) ? report.clicks : [];
    const capturedAt = Number.isFinite(report.capturedAt)
      ? report.capturedAt
      : Date.now();
    return clicks.map((click) => {
      const nextClickedAt =
        clicks
          .filter(
            (candidate) =>
              candidate.windowId === click.windowId &&
              candidate.clickedAt > click.clickedAt,
          )
          .sort((a, b) => a.clickedAt - b.clickedAt)[0]?.clickedAt ?? Infinity;
      const trace = traceForClick(traces, click, nextClickedAt);
      const launchSignalObserved = traces.some(
        (candidate) =>
          candidate.windowId === click.windowId &&
          firstEventAfterClick(
            candidate,
            click,
            (name) => name === "launch-signal",
            nextClickedAt,
          ),
      );
      const duration = (predicate) =>
        durationAfterClick(trace, click, predicate, nextClickedAt);
      const primaryStateFrameMs = duration(
        (name) =>
          name.startsWith("state:") && name.endsWith(STATE_FRAME_SUFFIX),
      );
      const replacementFrameMs = duration(
        (name) => name === "replacement-frame-presented",
      );
      const firstScriptMs = duration((name) => name === "document-script");
      const firstPaintMs = duration(
        (name) => name === "first-contentful-paint",
      );
      const reopenFrameMs = duration(
        (name) => name === "launch-frame-presented",
      );
      const reopenFrame = firstEventAfterClick(
        trace,
        click,
        (name) => name === "launch-frame-presented",
        nextClickedAt,
      );
      const navigationMs =
        trace &&
        trace.startedAt >= click.clickedAt &&
        trace.startedAt < nextClickedAt &&
        trace.startedAt - click.clickedAt < MAX_LAUNCH_WINDOW_MS
          ? Math.round(trace.startedAt - click.clickedAt)
          : null;
      let status = "evidence-unavailable";
      const legacyClick =
        typeof click.launchId !== "string" ||
        !Number.isFinite(click.openRequestedAt);
      if (primaryStateFrameMs !== null) {
        status = "usable";
      }
      else if (
        reopenFrameMs !== null ||
        replacementFrameMs !== null ||
        firstPaintMs !== null
      ) {
        status = "panel-painted";
      } else if (firstScriptMs !== null) status = "document-started";
      else if (trace) status = "panel-event-observed";
      else if (launchSignalObserved) status = "panel-signal-without-frame";
      const launchIncomplete =
        status === "evidence-unavailable" ||
        status === "panel-signal-without-frame";
      if (
        launchIncomplete &&
        Number.isFinite(nextClickedAt) &&
        nextClickedAt - click.clickedAt < MAX_LAUNCH_WINDOW_MS
      ) {
        status = "superseded";
      } else if (launchIncomplete && legacyClick) {
        status = "legacy-unavailable";
      } else if (
        launchIncomplete &&
        !click.openResolvedAt &&
        !click.openRejectedAt
      ) {
        status = "open-pending";
      } else if (
        launchIncomplete &&
        capturedAt - click.clickedAt < MAX_LAUNCH_WINDOW_MS
      ) {
        status = "pending";
      }
      if (click.openRejectedAt) status = "open-rejected";
      return {
        launchId: click.launchId || null,
        clickedAt: click.clickedAt,
        windowId: click.windowId ?? null,
        status,
        openApiMs: click.openResolvedAt
          ? Math.round(click.openResolvedAt - click.clickedAt)
          : click.openRejectedAt
            ? Math.round(click.openRejectedAt - click.clickedAt)
            : null,
        navigationMs,
        firstScriptMs,
        firstPaintMs,
        reopenFrameMs,
        replacementFrameMs,
        primaryStateFrameMs,
        cachedHistoryFrameMs: duration(
          (name) => name === "recent-cache-frame-presented",
        ),
        freshHistoryFrameMs: duration(
          (name) => name === "recent-fresh-frame-presented",
        ),
      };
    });
  }

  return { buildLaunchRows };
});
