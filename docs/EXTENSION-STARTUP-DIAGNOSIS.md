# Measuring the blank-panel delay

Status: the slow stage is confirmed; its underlying Chrome cause is not. Real
profile diagnostics show the native panel container and navigation start, then
Chrome can wait seconds or longer before executing extension scripts. A
September 27 capture measured `sidePanel.open()` at 115 ms and navigation at
113 ms, but the former parser-blocking diagnostics script did not execute until
3.85 seconds and first contentful paint arrived at 8.04 seconds. Cached history
and the API were fast after the document started. Track the product fix in
[YTT-428](https://linear.app/jaybee/issue/YTT-428/fix-blank-side-panel-before-extension-document-activation).

## September 19 trace evidence and targeted changes

### Existing-profile reproduction

Later captures from the installed unpacked extension reproduced the reported
blank panel in both authorized profiles:

| Profile / run | HTML response end | First document script | First contentful paint | Cache DOM event | `GET_RECENT` |
| ------------- | ----------------: | --------------------: | ----------------------: | --------------: | -----------: |
| ClickHouse current foreground run | 0.007 s | 36.214 s | 36.860 s | 36.810 s | 37.411 s |
| ClickHouse earlier run | 0.015 s | 88.886 s | 204.824 s | unavailable before Chrome API reads completed | 205.455 s |
| lifesized slow run | 0.014 s | 51.026 s | 51.140 s | 51.089 s | 51.452 s |

The current ClickHouse run is the cleanest evidence boundary: the HTML response
ended in 7 ms, Chrome did not execute the first script for 36.2 seconds, then
the `recent-cache-rendered` DOM instrumentation event fired 596 ms after the
first script. First contentful paint followed 50 ms later. `GET_RECENT` took
602 ms and its response event occurred 551 ms after first contentful paint. The
cache event does not prove that history was visible before that paint. The
screenshot during the earlier interval showed the native Transcriber header
with a completely blank body. Google Drive was merely the active page; it was
not on the panel startup path.

The earlier ClickHouse run included a long background-window interval and must
not be used as a foreground performance benchmark. It remains useful evidence
that the panel can remain delayed after the first script as well. Whether that
post-script interval came from background throttling, Chrome API reads, or
another cause remains unresolved.

### Immediate-shell experiment

The focused integration build keeps the existing top-level `popup.html`, moves
diagnostics and application JavaScript to ordered deferred scripts, leaves CSS
external, and keeps the static shell visible until a concrete application state
replaces it. This removes diagnostics as a parser barrier without changing
focus, visibility, accessibility, or side-panel lifecycle semantics.

If a tiny static top-level document is still needed to isolate Chrome scheduling,
use it only as a diagnostic build first. A production host must prove that it
improves real-profile paint and preserve close, focus, accessibility and panel
lifecycle behaviour before adoption.

Suggested next fixes, in order:

1. Compare this non-blocking shell build with the current packaged document in
   cold and warm real-profile runs.
2. If that does not change paint, test a static diagnostic document with no
   scripts or application frame and file a minimal Chromium reproduction.
3. Keep history/backend work out of the critical investigation unless its own
   measured duration regresses.
4. Treat extension reload as profile-specific. An unpacked build may be current
   in one profile while another retains an older service worker.

Six user-supplied Chrome traces (`trace_transcriber-startup1` through `6`) show:

| Trace | Navigation to first contentful paint |
| ----- | -----------------------------------: |
| 1     |                              0.495 s |
| 2     |                              0.568 s |
| 3     |                              6.451 s |
| 4     |                              0.610 s |
| 5     |                              0.512 s |
| 6     |                              2.459 s |

The raw traces are deliberately not committed: browser-wide trace files can
contain unrelated URLs/titles and ranged from 12–39 MB compressed. These runs
do not capture the reported five-minute hang or measure the entire toolbar-click
delay.
In run 3, a 2.218-second navigation task accounts for only 12.89 ms of thread CPU.
The diagnostic script starts at 5.246 seconds; the panel becomes visible at
6.412 seconds. Waiting/scheduling is a candidate, not a confirmed Chrome defect.

An earlier extension-local diagnostic recorded about 46 seconds from a possible
toolbar click to first contentful paint. Its history request took 78 ms, while
the document script began 25.7 seconds after navigation and three independent
Chrome API reads completed together 18.25 seconds later, just before the panel
became visible. A later initialization completed those reads in 17 ms. This is
evidence against history/network latency being the dominant cause in that run;
it does not identify what delayed document execution or API completion.

The focused build deliberately leaves panel CSS external and does not change
backend history queries. Regression tests cover script ordering, shell lifetime,
toolbar opening, retained-panel correlation, build-directory stability, and the
bounded local report classifier. These controlled tests are not proof that the
intermittent native delay is fixed; the same real-profile runs must be repeated.

If the hang persists, compare a minimal static panel with the full panel in the
existing authorized profile; do not infer a browser cause from a mocked preview.

## Capture a real run

The diagnostics now use one launch attempt as the reporting grain. Each toolbar
click records the Chrome `sidePanel.open()` request and whether that API
resolved or rejected. Panel events carry wall-clock timestamps so the exporter
can correlate that click with a new panel document or with a retained document
being shown again. The resulting `launches` table measures, from the click:

- Chrome open-API completion;
- panel navigation and first extension script;
- first contentful paint of the static HTML shell, the frame after that shell
  is replaced by application UI, or the next frame of a retained panel being
  reopened;
- the first usable primary-state frame;
- cached and freshly fetched history frames.

`pending` means Chrome accepted the click but the two-minute correlation window
is still open, while `open-pending` means the native `sidePanel.open()` promise
itself has not settled. `panel-signal-without-frame` means a retained panel
received the launch-specific signal but did not record its next presented
frame during the full correlation window. `evidence-unavailable` means the
collector has no matching proof; it must not be interpreted as a native panel
failure because a trace can be missing or evicted. `open-rejected` means Chrome
rejected the native panel open request before the extension UI could
participate. `legacy-unavailable` identifies a click retained from an older
diagnostic schema that cannot support open-lifecycle conclusions. Launch IDs
keep retained-panel reopen frames attached to the correct click, while
`superseded` means another same-window click began before the earlier launch
produced presentation evidence.

1. Build with `npm run build:ext:dev`, then reload the existing extension card.
2. Close the panel with its ×. Open it from the toolbar, noting the approximate
   wall-clock delay. Keep DevTools closed during this measurement: inspecting
   the worker can keep it awake and change the result.
3. Wait 30 seconds after content appears. Right-click inside the Transcriber
   side panel, choose **Inspect**, and paste the contents of
   `scripts/extension-diagnostics-console.js` into that Console. The exporter
   loads its classifier only in this inspected extension document, prints one
   row per toolbar launch plus the document detail table, and copies a JSON
   report through a temporary invisible text area. Do not use the service
   worker inspector: reloading the extension can leave that DevTools window
   attached to an obsolete worker and report `No SW`.
   If the UI never appears, wait the full two minutes before exporting so the
   result is a completed `panel-signal-without-frame` or
   `evidence-unavailable`, rather than `pending`.
4. Save that clipboard JSON as `output/panel-startup.json`, then run
   `node scripts/analyze-extension-startup.js output/panel-startup.json`.
5. Repeat a cold open, a warm reopen, and a switch between two video tabs.
   Capture the report before further reloads. No reinstall or cache clearing.

Reports contain timings and packaged resource filenames, never transcript
content, page URLs, video titles, or raw exception messages. The last 40 panel
documents and 40 clicks are retained locally. Initial snapshots run through
30 seconds; later application/focus/visibility events trigger throttled saves
for retained panels. Each document keeps its latest 160 events.
Toolbar timestamps include window IDs; the measurement begins when the service
worker receives the action click, so any browser delay before worker dispatch
remains outside extension telemetry. Reopening a retained panel creates no new
navigation, but later wall-clock panel events can still correlate to the launch.
Null means unavailable, never zero.

## Interpret the stages

| Observation                                        | Investigate next                                                                   |
| -------------------------------------------------- | ---------------------------------------------------------------------------------- |
| Open API resolves, no panel-document event         | Chrome native side-panel activation/worker-to-renderer handoff                     |
| Open API rejects                                   | Chrome side-panel configuration, window context, or extension runtime error        |
| Long observed delay but all recorded stages fast   | Before worker click dispatch/document navigation; capture Chrome Performance trace |
| Late document-script                               | Deferred scripts or stylesheets and renderer scheduling; consult resource timings  |
| Early document-script, late first-contentful-paint | CSS dependency chain, resource loading, long tasks                                 |
| Early paint, late popup-script                     | Deferred script loading/evaluation                                                 |
| Late startup-reads-complete                        | Parallel tabs.query, sync storage, auth-cache storage barrier                      |
| Late recent-cache-rendered                         | Mode/cache reads or list rendering                                                 |
| Slow message:GET_RECENT                            | Worker dispatch and backend response                                               |
| Repeated init-start / GET_RECENT                   | Focus/navigation/heartbeat reinitialization                                        |

DOM-updated timestamps are not paint timestamps. Browser first-contentful-paint
is the actual paint metric. A skeleton appearing sooner does not establish that
the existing library is available sooner.

## Focused maintainability review

Scope: extension startup and its built artifact, not a whole-repository audit.

- `popup.js` combines startup, settings, auth, queues, summaries, destinations,
  and rendering in over 3,000 lines. This makes startup dependencies hard to see.
  Extract startup orchestration only after trace evidence identifies the boundary.
- `loadRecent()` can be triggered from init and native-summary capability
  reconciliation; focus/navigation also re-run init. Count actual requests
  before introducing request deduplication or cancellation.
- The focused build keeps CSS external so the HTML remains small and parsable;
  resource timing in the real profile determines whether further bundling helps.
- Current startup/toolbar tests mostly search source strings. They prove code
  shape, not Chrome behavior or latency. The prior simulated browser test only
  delayed popup.js. Real-profile capture is required to validate the fix.
- The new shell duplicates existing recent skeleton markup/styles. Consolidate
  loading-state ownership when measured startup behavior is stable.

No broad rewrite is justified by these findings alone. First compare real cold
and warm traces, change the dominant measured stage, then repeat the same runs.
