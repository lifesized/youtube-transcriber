# Measuring the blank-panel delay

Status: cause unconfirmed in the user's Chrome profile. Previous HTTP preview
tests used mocked Chrome APIs; they did not measure native side-panel startup.
The screenshots do not establish that Chrome cached an empty document, that
file replacement caused the delay, or that the implicit opener was defective.

## September 19 trace evidence and targeted changes

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

The build now bundles and embeds panel CSS in popup.html, including shared
tokens. Sources remain canonical; there are no panel stylesheet requests or
nested imports in the packaged HTML. This avoids adding another asynchronous
CSS loader or maintaining a separate copy of critical-shell styles. Chrome
still controls document creation and activation, so this cannot guarantee paint.

Startup begins history loading as soon as the authoritative mode setting is
available, without waiting for tab/auth reads. It deliberately does not add a
second persisted mode snapshot, guess a mode when storage fails, or merge the
existing local/cloud caches. History refreshes are guarded against superseded
startup, overlapping requests and mode changes; the worker rejects requests for
a different mode. Existing cloud cookie/auth behaviour is unchanged.

Regression tests execute the actual init function with unresolved tab/auth
promises, rejected settings and superseded startup. Additional checks cover
late cross-mode history responses and self-contained packaged CSS. These are
controlled tests, not proof that the user's intermittent native hang is fixed.

If the hang persists, compare a minimal static panel with the full panel in the
existing authorized profile; do not infer a browser cause from a mocked preview.

## Capture a real run

1. Build with `npm run build:ext:dev`, then reload the existing extension card.
2. Close the panel with its ×. Open it from the toolbar, noting the approximate
   wall-clock delay. Keep DevTools closed during this measurement: inspecting
   the worker can keep it awake and change the result.
3. Wait 30 seconds after content appears. In `chrome://extensions`, inspect
   Transcriber's service worker. Paste the contents of
   `scripts/extension-diagnostics-console.js` into its Console. This prints a
   table and copies a JSON report via DevTools' `copy()` helper.
4. Save that clipboard JSON as `output/panel-startup.json`, then run
   `node scripts/analyze-extension-startup.js output/panel-startup.json`.
5. Repeat a cold open, a warm reopen, and a switch between two video tabs.
   Capture the report before further reloads. No reinstall or cache clearing.

Reports contain timings and packaged resource filenames, never transcript
content, page URLs, video titles, or raw exception messages. The last 12 panel
documents and 40 clicks are retained locally. Initial snapshots run through
30 seconds; later application/focus/visibility events trigger throttled saves
for retained panels. Each document keeps its latest 160 events.
Toolbar timestamps include window IDs; correlation with document navigation is
approximate and cannot measure time before the worker receives the click.
Reopening a retained panel creates no navigation trace. Null means unavailable.

## Interpret the stages

| Observation                                        | Investigate next                                                                   |
| -------------------------------------------------- | ---------------------------------------------------------------------------------- |
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
  and rendering in over 4,000 lines. This makes startup dependencies hard to see.
  Extract startup orchestration only after trace evidence identifies the boundary.
- Addressed: `init()` no longer gates history on tab/auth reads. The authoritative
  settings read still precedes cache selection. It reads the recent cache again
  for the existing-video lookup; that small duplication remains out of scope.
- `loadRecent()` can be triggered from init and native-summary capability
  reconciliation; focus/navigation also re-run init. Count actual requests
  before introducing request deduplication or cancellation.
- Addressed in packaged builds: the CSS import chain is bundled at build time
  and embedded in the panel HTML. Source imports remain for the workbench.
- Current startup/toolbar tests mostly search source strings. They prove code
  shape, not Chrome behavior or latency. The prior simulated browser test only
  delayed popup.js. Real-profile capture is required to validate the fix.
- The new shell duplicates existing recent skeleton markup/styles. Consolidate
  loading-state ownership when measured startup behavior is stable.

No broad rewrite is justified by these findings alone. First compare real cold
and warm traces, change the dominant measured stage, then repeat the same runs.
