# Test Protocol

YouTube Transcriber has a multi-layer test protocol designed to catch environment and configuration issues across different deployment modes.

## The Problem

The app has combinatorial complexity across its deployment surface:

- **3 deployment modes**: local dev (`npm run dev`), Docker, lite/background service
- **Python subprocesses**: Whisper inherits the environment of whatever mode launched it — venv path, CUDA/Metal availability, working directory all vary
- **Edge cases at intersections**: a bug that only appears in Docker when Whisper falls back from Metal to CPU, or a path resolution failure only in the background service mode

These bugs are nearly impossible to catch through normal use. When someone files a report, "works on my machine" is genuinely true — the issue is specific to their deployment mode × environment intersection.

**Example**: YTT-82 — the setup script didn't run `prisma generate` or `prisma db push`, so every first-time user got 500 errors on transcription requests. A post-setup verification would have caught this immediately.

## Layer 1: Post-Setup Verification (`npm run test:setup`)

**When to run**: After initial setup, after upgrading, or when something isn't working.

```bash
npm run test:setup
```

This runs `scripts/test-setup.sh` which checks every dependency and configuration:

| Check | What it verifies |
|-------|-----------------|
| Node.js | Version >= 18 |
| Python | `python3` in PATH |
| Virtual env | `.venv/` directory exists |
| ffmpeg | In PATH |
| yt-dlp | In PATH |
| .env | File exists, `DATABASE_URL` set |
| Whisper CLI | Path from `WHISPER_CLI` env var is a real file |
| Python bin | Path from `WHISPER_PYTHON_BIN` env var is a real file |
| Prisma client | Generated in `node_modules/` |
| SQLite DB | `prisma/dev.db` exists and `Video` table is queryable |
| Disk | `tmp/` directory is writable |
| Whisper imports | OpenAI Whisper and MLX Whisper (on Apple Silicon) importable |

Each check prints `[PASS]`, `[FAIL]`, or `[WARN]` with an actionable fix message. Exit code 0 means all checks passed.

This runs automatically at the end of `npm run setup`.

## Layer 2: Runtime Health Check (`GET /api/health`)

**When to use**: To verify a running instance is healthy. Useful for Docker health checks, monitoring dashboards, or debugging "the API returns 500 but I don't know why."

```bash
curl http://localhost:19720/api/health
```

Returns JSON:

```json
{
  "status": "healthy",
  "checks": [
    { "name": "database", "status": "pass", "detail": "Connected, 42 transcript(s)" },
    { "name": "python", "status": "pass", "detail": "Python 3.14.0" },
    { "name": "whisper", "status": "pass", "detail": ".venv/bin/whisper" },
    { "name": "ffmpeg", "status": "pass", "detail": "/opt/homebrew/bin/ffmpeg" },
    { "name": "yt-dlp", "status": "pass", "detail": "/opt/homebrew/bin/yt-dlp" },
    { "name": "tmp_writable", "status": "pass", "detail": "/path/to/tmp" },
    { "name": "env_vars", "status": "pass" }
  ]
}
```

- Returns **200** when all checks pass (`"status": "healthy"`)
- Returns **503** when any check fails (`"status": "unhealthy"`)
- Individual checks can be `"pass"`, `"fail"`, or `"warn"`

### Docker health check

```dockerfile
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD curl -f http://localhost:19720/api/health || exit 1
```

## Layer 3: End-to-End Integration (Future)

A full integration test that exercises the complete pipeline — download a short clip, transcribe it, verify DB write, check queue lifecycle. This would catch the deep combinatorial bugs (subprocess environment inheritance, Metal/CPU fallback, queue race conditions).

Not yet implemented. Tracked for future work when the deployment matrix grows.

## When to Use Which

| Scenario | Use |
|----------|-----|
| Just ran `npm run setup` | `test:setup` runs automatically |
| Something broke that was working | `GET /api/health` |
| Debugging a contributor's bug report | Ask them for `npm run test:setup` output |
| Docker deployment monitoring | `GET /api/health` as healthcheck |
| After upgrading Node/Python/deps | `npm run test:setup` |
| CI/CD pipeline | `npm run test:setup` in build step |

---

# Code & Extension Testing Strategy

The layers above catch **deployment and environment** bugs. They don't catch code-level regressions in the web app or the Chrome extension. This section covers the code-test side.

Tracked as a multi-phase initiative in Linear (see YTT-214).

## Why this needs a dedicated strategy

The extension has become a lot of surface area in one artifact:

- Popup / side-panel UI
- Background service worker
- Content scripts for YouTube and Spotify
- Message passing across all three
- `chrome.storage.sync` / `local` / `session`
- `chrome.notifications`, `chrome.tabs`, `chrome.identity`, `chrome.permissions`
- OAuth flows (via cloud)
- Destination adapters (client-side + cloud-hosted)
- URL scheme handoff (`obsidian://`)
- Dual-mode runtime (cloud vs localhost self-hosted)
- Locked-down CSP + payload validation layer

Today there are **zero automated code tests**. Every bug so far (filename sanitization, VTT triplication, wall-of-text markdown, needsReauth menu leak) was a regression that a test would have caught before the user did.

## Testing options, in priority order

### Layer 1 — Pure-function unit tests (highest ROI, cheapest)

A lot of the extension's logic is pure: no `chrome.*`, no DOM, no network. Extract those into plain modules and test under Node with Vitest / Jest.

| Function | Regression a test would catch |
|---|---|
| `segmentsToMarkdown` | Wall-of-text paragraph heuristic regression |
| `buildObsidianMarkdown` | Metadata ordering, empty-transcript edge cases |
| Filename sanitizer | `\| / : * ? " < > \\` rejection across platforms |
| `validAdapterId` / `validId` / `validHttpUrl` / `validMode` | Payload-validator drift after §1 security hardening |
| `flattenTranscriptSegments` | YouTube VTT triplication (YTT-162) |
| URL builders (Obsidian, deep-link) | URL encoding edge cases |
| Advanced URI branch logic | Short vs long path threshold |
| VTT parser in `lib/youtube.ts` | Same triplication bug, caption-format regressions |

Cost: a few hours to wire up + write the first ~20 tests. Runs in seconds, no browser launch, works in CI trivially. Biggest bang for buck.

### Layer 2 — Extension-context integration (medium ROI, harder)

For anything that touches `chrome.*` APIs, message passing, or real DOM events, a harness is needed. Two options:

- **Puppeteer + chrome-launcher** — launch real Chrome with the extension preloaded, drive the side panel, assert DOM and storage state. Solid, slower, a bit brittle to write.
- **Playwright** — experimental extension mode. Cleaner API but less mature for extensions specifically.

Worth it for a handful of high-value flows only (transcribe happy path, destinations list rendering, send-to-obsidian end-to-end). Don't try to cover everything here — unit tests give more per hour.

### Layer 3 — Manual smoke-test checklist (zero setup, high value)

A pre-release checklist to run through before submitting a new version to the Chrome Web Store. Catches UX regressions that unit tests miss.

Example flows to cover:

- Install dev build, transcribe a YouTube video
- Transcribe a Spotify episode
- Transcribe a live stream → blocked UI appears
- Transcribe an already-transcribed video → "Already transcribed" deep-link
- Switch to Self-hosted mode, transcribe via localhost:19720
- Sign out of transcribed.dev, confirm onboarding vs auth-error copy
- Settings → Destinations → Obsidian connect / disconnect round-trip
- Send short transcript to Obsidian → content embedded in URL
- Send long transcript to Obsidian → clipboard + ⌘V + toast
- Enable Advanced URI toggle → auto-paste works
- Hover recent row → `⋯` menu shows Open / Copy link / Send to `<dest>`
- Click `⋯` → Send to Obsidian → success toast
- Notion Connect (mock or real) → opens auth tab, polls, disconnect works
- Local mode → Destinations still shows Obsidian + Notion teaser
- Manifest CSP enforced — any `fetch` to a non-whitelisted host errors

Takes ~15 minutes to run end-to-end. Runs before each Web Store submission.

### Layer 4 — Error telemetry in the wild (post-launch)

Once in the Web Store, wire extension `window.onerror` + unhandled rejections + `chrome.runtime.lastError` captures into PostHog (already set up for the cloud side). Real-user errors surface immediately instead of requiring a repro report. Don't build until there are real users.

### Layer 5 — Visual regression (later, optional)

Percy / Chromatic / Playwright screenshot diffing. Useful only once UI design is stable. Right now every intended design change would be a false positive. Skip.

## Dev build alongside prod build (recommended setup)

Not a separate codebase — just a second `node build.js` target with a `manifest.name = "YouTube Transcriber (dev)"` tweak and (optionally) a `CLOUD_BASE` pointed at staging. Produce `dist/` for prod, `dist-dev/` for dev.

Install both in Chrome. Different Chrome extension IDs → independent storage, independent badge, both icons visible in the toolbar. Lets you test new code without losing your prod install's state.

Not to be confused with publishing a second Web Store listing — that's overkill until there are external beta testers.

## Phased plan (tracked in Linear YTT-214)

| Phase | Scope | When |
|---|---|---|
| **1** | Extract pure functions, wire Vitest, write ~20 unit tests, GitHub Action on push | Next couple of sessions |
| **2** | `build:dev` script producing differentiated dev build; TESTING.md smoke checklist | After Notion integration lands |
| **3** | Puppeteer E2E for 3 highest-value flows (transcribe, destinations list, send-to-obsidian) | When external beta testers exist |
| **4** | PostHog error telemetry from the extension itself | Post Web Store launch |

## Anti-recommendations (explicitly not doing)

- **Forking the codebase into free / paid repos.** Splits maintenance, gains nothing, kills the open-core story.
- **Visual regression tests now.** UI is too fluid.
- **Cypress or similar for service workers.** Doesn't support MV3 service workers well. Puppeteer/Playwright are the right tools.
- **Exhaustive E2E coverage.** Diminishing returns. A handful of happy-path E2E plus strong unit tests on pure logic covers most regressions.
