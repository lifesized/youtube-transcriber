# Changelog

## 2026-05-04

### Changed
- **First-time setup flow simplified (1.6.20)** — Offline state replaces the dual-path layout (`npm run dev` copybox + disclosure-wrapped install) with a single canonical install-native-host flow. Cleaner first impression; `npm run dev` still documented in README for power users running the server in a terminal. Tightens setup-step / setup-hint typography to match.

## 2026-04-28

### Fixed
- **Click-too-fast race: Transcribe falls to slow server path on freshly-opened captioned videos (1.6.13)** — When the user opened a YouTube video and clicked Transcribe within ~1s, `openTranscriptPanel` ran before YouTube had mounted the engagement-panel placeholder (`PAmodern_transcript_view`) or the "Show transcript" description button — `findShowTranscriptDirectButton` returned null, More-actions menu had no transcript item, and we returned `[]`. Background then POSTed without segments, hitting the slow server path even though captions were ~200-1000ms away. Now `tryExtractTranscriptFromPanel` first calls `waitForTranscriptReadiness(3000)` which polls every 150ms for any of: the engagement-panel placeholder, the "Show transcript" button, or an already-expanded transcript panel. Captioned videos with a quick-click resolve in 200-1000ms; uncaptioned videos time out at 3s and correctly fall through to the server. Doesn't gate the Transcribe button (per user feedback that gating would break the audio/yt-dlp path for uncaptioned videos).
- **"Already transcribed" link never shows in local/self-hosted mode (1.6.12)** — `background.js checkExisting()` filtered records with strict `t.status === "done"`, but the local server's Prisma schema (`transcriber-local/prisma/schema.prisma model Video`) has no `status` column at all — every local record returns with the field absent. Strict equality made every local-mode lookup return null, so the "Already transcribed" link never showed and users had no path back to a transcript they'd already created. Now matches the popup's cache-side check (`maybeFindCachedTranscript`): treats a record as done if `status === "done"` OR the field is absent. Cloud's "processing"/"error" semantics still respected because those statuses are explicit non-empty strings, not absences.
- **Two-transcript flash when scraping (1.6.11)** — Clicking Transcribe in the extension was causing YouTube's own transcript panel to briefly open in the page (visible to the user), then close once segments were read. Reported as confusing — "I see two transcripts." We now inject a one-rule stylesheet (`ytd-engagement-panel-section-list-renderer { visibility: hidden !important }` scoped to the transcript panel via `target-id*='transcript'` + `:has(transcript-segment-view-model)`) immediately before clicking Show transcript, and remove it via a `try/finally` after segments are read. Verified against live YT DOM: YouTube renders segments off the panel's internal state attribute, not CSS visibility — segments populate fully even while invisible. Skipped when the user had the panel open before clicking Transcribe (yanking a panel they were actively viewing would be worse than the flash). User now sees nothing happen on the YouTube page when transcribing.
- **Panel-scrape silently failing on every captioned video (1.6.10)** — Modern YouTube replaced `<ytd-transcript-segment-renderer>` with `<transcript-segment-view-model>` and shifted timestamps to `.ytwTranscriptSegmentViewModelTimestamp` / text to `.ytAttributedStringHost`. The old selectors matched zero rows, so `waitForTranscriptSegments` always timed out at 5s and every captioned video fell through to the yt-dlp/Whisper server path. Verified by driving chrome-devtools MCP against `KPDXMtmkcgk` — 500 segments rendered in DOM under the new tag, 0 matched the old selector; new selector list returned all 500 in 516ms and the local fast-path responded 201 in 276ms with `source=client_panel_scrape`. Selectors now match both vintages so the scrape works whichever bucket YouTube serves.
- **`findTranscriptPanel` returning the always-present HIDDEN placeholder** — `PAmodern_transcript_view` is in the DOM from page load whether or not the panel ever opens. The old "panel already in DOM" short-circuit in `openTranscriptPanel` fired on every load and never even attempted to click "Show transcript". Now distinguishes via the `visibility="…EXPANDED"` attribute and only treats a panel as open when it actually contains segments.
- **`findClickableByText` returned wrappers, not the inner `<button>`** — When the match was a `ytd-button-renderer` (the description-strip "Show transcript" container), `.click()` on the wrapper was a no-op because YouTube's actual handler is bound to the inner `<button class="ytSpecButtonShapeNextHost">`. Helper now drills down to the inner button when the match isn't already one.
- **`findMoreActionsButton` selector chain matched a hidden ghost first** — The first selector in the list (`ytd-watch-metadata button[aria-label='More actions']`) matches a `display:none` element before reaching the real visible `#above-the-fold #actions` button. Reordered selectors and added an `offsetParent !== null` filter so the visible button always wins.
- **First Transcribe click after mode switch silently does nothing** — If the user toggled cloud→local while a cloud transcribe was still in flight, the bg's persisted state stayed `status: "transcribing"`. PHASE 3 of `init()` re-armed `isTranscribing = true` from that state, and the next click hit the doTranscribe `if (isTranscribing) return` guard — looked dead. Now the mode-toggle handlers explicitly reset `isTranscribing = false` and dispatch `CLEAR_TRANSCRIPTION` before saving the new mode, so any leaked in-flight state from the prior mode is dropped before the user sees the next click.

### Changed
- **Hide cloud-only adapters in self-hosted mode** — `extension/popup.js` no longer renders the Notion connector with a "Switch to Cloud mode to use" teaser when the user is in self-hosted mode. Cloud-only adapters can't work without the cloud backend, so showing them as gated rows was just noise. The teaser still appears in cloud mode when the destinations fetch fails (signed out, offline, 5xx).

### Fixed
- **Sign-in flash on Local↔Cloud mode toggle** — `coldStartHandled` is now reset on both mode-toggle handlers. Commit `8747b0d` had locked the 400ms cold-start retry to the very first `init()` call, but a mode switch invalidates the background `apiConfigCache` and the next `/api/account` hit can 401 on the same cookie-attach race a true cold start sees. Returning signed-in users were getting bounced to the sign-in card after Local→Cloud despite a valid session — the retry window now reopens on every mode change.

## 2026-04-27

### Added
- **Client-side caption scrape (extension 1.6.1)** — Side panel now reads `window.ytInitialPlayerResponse` from the YouTube tab via a new MAIN-world content script (`content-captions-main.js`) and fetches the JSON3 timed-text URL directly in-browser. When captions exist, segments are sent along with the `POST /api/transcripts` request as a `segments[]` field; the cloud server stores them directly and skips the Inngest worker round-trip. Matches the "instant transcript" UX of competitor extensions for caption-able videos. Falls back transparently to the existing server-side path for videos without captions (Whisper / audio).
- **Transcribe benchmarking** — `doTranscribe` now logs and persists per-call timings (`captionScrapeMs`, `serverRequestMs`, `totalMs`, pathway) to the service worker console + `chrome.storage.local.transcribeBench` (last 20 records). Lets us measure the speedup objectively across videos.

### Fixed
- **`isTranscribing` flag leaks `true` across panel sessions (1.6.9)** — 1.6.8's double-click guard correctly returns when `isTranscribing` is true, but the flag could be stuck from a previous attempt where the panel was closed mid-transcribe (the popup's `await sendMsg(...)` never resolved, so the assignment back to `false` never ran). Result: every Transcribe click in the next panel session was a silent no-op. `init()` now resets `isTranscribing = false` at the top of its UI-reset block; PHASE 3 sets it back to `true` only if the bg actually has a pending transcription. Self-correcting.
- **Transcribe click feels frozen, second click lurches the bar backward (1.6.8)** — `doTranscribe` awaits `GET_SETTINGS` (~100-300ms on a cold service worker) before calling `startProgress`. During that gap the Transcribing card is visible but the bar sits at 0% with no animation, looking like nothing happened. Users double-click; the second click starts a parallel `doTranscribe`, both eventually call `startProgress`, the second resets the bar to 0% — visible jump backward. Now `doTranscribe` no-ops if `isTranscribing` is already true, and the bar flips to indeterminate animation synchronously on click before any await — instant visual feedback.
- **Renderer-present-but-empty intermediate state still leaked through (1.6.7)** — User probe on `5mGMDdT6YrM` returned **12 caption tracks**, our bench still reported `captionTracks: 0`. So 1.6.6's `renderer === undefined` check wasn't strict enough — YouTube populates the response in stages and we were catching a window where `playerCaptionsTracklistRenderer` was present but `captionTracks` was still empty/missing. Snapshot now treats anything short of a non-empty `captionTracks` array as "not ready". Cost: videos that genuinely have no captions poll the full ~6s before giving up — acceptable, those fall to the server path and most YouTube videos have captions.
- **MAIN-world snapshot froze cache at empty before captions populated (1.6.6)** — On the videos in 1.6.5 testing, `getPlayerResponse()` returned a partial object early in load — the response existed but `captions.playerCaptionsTracklistRenderer` hadn't materialized yet. Old code took that as "no captions, all done", dispatched an empty array, and the poll loop exited. By the time the user clicked Transcribe (or probed manually) the renderer had populated, but our cache was already locked empty. Confirmed by user diagnostic: `tracks: 1` on `dYwQYdD81Z4` while bench showed `captionTracks: 0`. Snapshot now treats `renderer === undefined` as "not ready" and keeps polling until either captions appear or the 6s cap.
- **YouTube no longer exposes `ytInitialPlayerResponse` on many pages (1.6.5)** — Field probe on a real watch page (id `4iq1CqihWgI`) returned `hasInitial: false` while `getPlayerResponse()` on `#movie_player` returned the same shape with `tracks: 1`. So the historic global isn't reliable anymore. Updated the MAIN-world snapshot to try three sources in order: `window.ytInitialPlayerResponse` → `document.getElementById("movie_player").getPlayerResponse()` → `window.ytplayer.config.args.player_response`. Whichever returns truthy first wins. Combined with the 1.6.4 polling, the script now waits for the player to initialize and reads from whichever surface YouTube exposes.
- **MAIN-world caption snapshot loses race against YouTube hydration (1.6.4)** — `content-captions-main.js` runs at `document_start`, which on direct-load YouTube watch URLs fires *before* YouTube's inline assignment of `window.ytInitialPlayerResponse`. The initial dispatch always saw `undefined` and gave up, and `yt-navigate-finish` never fires for direct-load pages. Effect: ISOLATED content script answered `EXTRACT_CAPTIONS` correctly (≈600ms — the `awaitCaptionsRefresh` timeout), but no track data ever made it into the cache. Now the script polls every 200ms (cap ~6s) until `ytInitialPlayerResponse` shows up, then dispatches. Same poll dance reused for `yt-navigate-finish` and the `ytt-captions-request` handshake. Diagnosed via 1.6.2 bench data showing `captionScrapeMs: 605ms` matching the timeout exactly.
- **Auto-inject content scripts into existing tabs on extension update (1.6.3)** — Chrome doesn't re-inject newly registered content scripts into tabs that were already open before an extension update — only into future page loads. That left every YouTube tab a user already had open running the pre-update content script (or none at all), with no `EXTRACT_CAPTIONS` listener, so the bg's caption-scrape probe resolved instantly with `chrome.runtime.lastError` and the fast path could never fire until the user manually reloaded each tab. Now `registerContentScripts` follows up by iterating matching tabs and calling `chrome.scripting.executeScript` to attach the new code immediately. ISOLATED-world scripts ping with `PING_TRANSCRIBER` first and skip injection if the new code is already responsive — avoids duplicating `runtime.onMessage` listeners.
- **"Already transcribed" lying about pending records (1.6.2)** — Both the cached lookup in the side panel (`maybeFindCachedTranscript`) and the bg `checkExisting` round-trip matched recent transcripts by `videoId` only, ignoring `status`. A stuck `processing` record would surface as "Already transcribed", and clicking it took users to a still-pending row in the web app. Both paths now require `status === "done"` before claiming the video is done.
- **Progress bar lurching** — `startProgress` was leaking `setInterval` timers when called twice (e.g., on a tab-switch race). Two timers writing to `bar.style.width` with their own elapsed counters made the bar jump backward. Now idempotent — clears any previous timer before starting a new one.
- **`optimisticAuthed` ReferenceError on cold-start retry** — Leftover references after the recent rename to `cachedAuthOk` would have crashed the cold-start retry path on cloud-mode 401s.
- **Stale caption cache across SPA navigation** — Cached caption tracks are now tagged with their videoId; `EXTRACT_CAPTIONS` rejects stale snapshots and waits for a fresh dispatch from the MAIN-world script before fetching, so video B never gets video A's captions.

### Changed
- **Extension cloud-mode panel boot — instant first paint** — Side panel no longer shows a dark blank screen while `CHECK_SERVICE` (`/api/health` + `/api/account`) round-trips on open. `init()` now does parallel cheap reads (active tab, mode, cached auth) up front and paints the page state + Recent list optimistically before any network fetch. The CHECK_SERVICE call still runs and reconciles the UI on confirmed offline / 401, but happy-path users see content in their first frame.
- **Recent transcripts SWR cache** — Last fetched list is cached per mode in `chrome.storage.local`. `loadRecent()` renders the cached list immediately on open, then revalidates from `/api/transcripts` and only touches the DOM if the result actually differs.
- **Cloud auth cache (5 min TTL)** — Successful `/api/account` writes `authCache_cloud` so returning users skip the sign-in flash on a transient cold-start 401. Cold-start retry is now also triggered when the cached auth says we should still be signed in (a 401 there is almost always a Supabase cookie warmup race, not a real signout). Confirmed 401 clears the cache so the next open shows the sign-in card without flashing the list.

### Removed
- **Dead `popup-shell.html` / `popup-shell.js`** — Unused since the side panel switched to native `popup.html`. Dropped from `extension/build.js` too.

## 2026-04-20

### Added
- **Extension destination adapters — client scaffolding (YTT-205 §2)** — Settings panel gains a Destinations section for connecting / disconnecting cloud-hosted adapters (Notion, Obsidian, and future destinations). Each recent-transcript row gains a `⋯` menu with **Send to \<connected destination\>**, **Open in web app**, and **Copy link**. Success / failure surfaces as a `chrome.notifications` toast (falls back to a badge flash if the optional `notifications` permission is denied).
- **New background message types** — `LIST_DESTINATIONS`, `START_DESTINATION_OAUTH`, `SEND_TO_DESTINATION`, `DISCONNECT_DESTINATION`. All route through the existing cloud session-cookie auth; the extension itself holds zero adapter code or OAuth secrets — it is a thin client.

### Notes
- The UI ships inert until the cloud-side registry + OAuth proxy (YTT-211) lands. When `/api/destinations/*` returns 404 or 501, the settings section shows "Destinations aren't available yet." and row menus gracefully hide destination items.
- Obsidian adapter uses a URL scheme (`obsidian://new?…`); the scheme URL is built cloud-side for consistency and opened client-side via `chrome.tabs.create`.
- Extension bumped to **1.6.0**.

## 2026-04-16

### Added
- **Generic video support via yt-dlp** — Any URL from a yt-dlp-supported site (Twitch, Vimeo, TikTok, Twitter/X, Dailymotion, Reddit, Instagram, Facebook, Rumble, BiliBili, Odysee, Streamable, and ~1,800 more) now routes through a generic transcription pipeline. Detects platform via yt-dlp extractor, downloads audio, transcribes via the existing provider fallback chain.
- **New `lib/generic-video.ts` module** — Fetches metadata via `yt-dlp --dump-json`, downloads audio, re-encodes large files for cloud upload limits, falls back to local Whisper.
- **`transcribeAudioFileWithWhisper`** (`lib/whisper.ts`) — New public helper that runs local Whisper on an arbitrary audio file path (not just YouTube videoIds). Reused by Spotify and the generic video route.
- **URL input accepts any video URL** — Home page validator loosened from a YouTube/Spotify-only regex to any `http(s)://` URL. Server-side `parseContentUrl` + the generic yt-dlp route handle detection and routing. Placeholder and error copy updated to reflect multi-platform support.

### Changed
- **Spotify transcription** — Wired up local Whisper fallback (previously stubbed out). Large podcast episodes are re-encoded to 48kbps mono MP3 before cloud upload so they fit under the Groq/OpenAI 25MB Whisper limit.
- **Chrome extension dual-mode** (YTT-162) — Extension now supports both cloud (transcribed.dev) and self-hosted (localhost:19720) modes. Cloud mode is the default for new installs. Updated popup UI, background script, content script, and manifest.
- **README** updated with dual-mode extension install instructions and cloud/self-hosted usage guide.
- **Portable binary defaults** — `yt-dlp` and `ffmpeg` paths now default to bare command names (resolved via `PATH`) instead of `/opt/homebrew/bin/...`. Works on Intel Macs, Linux, and any system where the tools are in `PATH`. Override via `YTDLP_PATH` / `FFMPEG_PATH` env vars if needed.
- **Dev server stability** — Switched dev script to `next dev --webpack` to work around a Turbopack HMR panic on Next.js 16.1.6 that caused the settings page to reload in a loop. Pinned `outputFileTracingRoot` and `turbopack.root` in `next.config.ts` to prevent Next from walking up to a stray parent-dir `package.json`.

### Fixed
- **Settings page reload loop** — Turbopack panic (`Next.js package not found` on `/settings` HMR) caused continuous full-page reloads; switched to webpack for dev.
- **`.cursor/` added to `.gitignore`** — prevents IDE config from being tracked.

## 2026-03-27

### Added
- **Spotify podcast transcription** (YTT-143) — Paste a Spotify episode URL to get a transcript. Uses Spotify's official API for metadata, iTunes Search API to discover the podcast's public RSS feed, then downloads audio and transcribes via Groq/OpenRouter/Whisper. No undocumented APIs or TOS violations.
- **Unified URL parser** (`lib/url-parser.ts`) — Detects YouTube vs Spotify URLs and extracts content IDs. Extensible for future platforms.
- **Spotify module** (`lib/spotify.ts`) — Client Credentials auth, RSS feed discovery via iTunes, RSS XML parsing with episode matching by title/duration, podcast audio download from CDN.
- **Chrome extension Spotify support** (YTT-144) — Extension now detects Spotify episode pages and enables one-click transcription from the side panel.
- **`platform` field** on Video model — Tracks whether a transcript came from YouTube or Spotify.

### Changed
- **URL input** accepts both YouTube and Spotify URLs with updated validation and placeholder text.
- **Chrome extension** updated to v1.2.0 with multi-platform URL detection in content scripts, background worker, and popup.

## 2026-03-24

### Added
- **yt-dlp subtitle fallback** (YTT-119) — New fallback step between web scrape and Whisper audio transcription. Uses `yt-dlp --write-auto-subs` to download auto-generated captions via YouTube's PO token ecosystem, recovering captions that broke after YouTube's March 2026 BotGuard enforcement. Tagged as `youtube_captions_ytdlp` source.
- **VTT subtitle parser** — Parses WebVTT files from yt-dlp into timestamped transcript segments, handling HTML entities, VTT tags, and alignment metadata.
- **Configurable yt-dlp path** — `YTDLP_PATH` env var overrides the default `/opt/homebrew/bin/yt-dlp`.

### Changed
- **InnerTube methods disabled by default** — ANDROID and WEB InnerTube caption methods are skipped (broken without PO tokens since March 2026). Re-enable with `YTT_INNERTUBE_ENABLED=1`.
- **Updated User-Agent** — Chrome/120 (2023) updated to Chrome/131 to reduce bot-detection risk on web scrape.
- **Updated InnerTube client versions** — ANDROID `19.35.36` to `19.47.53`, WEB `2.20241126.01.00` to `2.20250312.04.00`.

### Fixed
- **Auto-generated captions broken since March 5** — YouTube began requiring PO tokens for auto-caption access. All 133 transcriptions since March 5 fell through to Whisper. The new yt-dlp subtitle fallback restores fast caption retrieval for these videos.

## 2026-03-21

### Added
- **Focus-visible rings** on submit button, retry button, and library tile links for keyboard accessibility.
- **Input disabled state** — reduced opacity and `not-allowed` cursor when disabled.
- **Input error state** — red border and ring when `aria-invalid="true"` is set.
- **Toggle hover feedback** — subtle brightness/opacity shift on hover for both on and off states.

### Fixed
- **Retry button spacing** — increased padding and added `whitespace-nowrap` to prevent text wrapping in failed queue items.

## 2026-03-18

### Added
- **Cost tracking for paid Groq usage** (YTT-108) — Estimated cost displayed below the usage bar when exceeding the free tier. Shows daily cost and collapsible monthly breakdown with per-day details.
- **Daily usage history** — New `DailyUsage` database table persists usage per provider per day. Previous day's data is preserved on day rollover instead of being discarded.
- **Real Groq rate limits** — Usage bar now reads `x-ratelimit-*` headers from Groq API responses, showing actual remaining quota and reset time instead of local estimates.
- **Usage history API** — `GET /api/usage` returns current month's daily breakdown with overage cost calculations.
- **Entrance animations** — Staggered fade-up animations on page load for header, input, and library sections with `prefers-reduced-motion` support.
- **Empty state illustration** — Library shows an icon and helpful prompt when no transcripts exist yet.
- **Shimmer loading skeletons** — Library loading state uses animated shimmer effect instead of static placeholders.
- **Ambient glow** — Subtle pulsing radial glow behind the URL input when idle.
- **First-visit subtitle** — "Local transcription powered by Whisper. No data leaves your machine." shown to new users.

### Changed
- **Home page full redesign** — Glassmorphic input card, refined tile cards with gradient overlays and bronze thumbnails, polished list view with softer borders, centered footer with icon dividers, backdrop-blur dialogs and toasts.
- **Transcribe button** — Renamed from "Extract" to "Transcribe", color changed to `#a0a0a0` for reduced brightness.
- **Completion animations** — Reworked with Framer Motion spring physics. Queue items spring in/out with `AnimatePresence`, list entries get a spring-animated grayscale tick (no more green), smoother layout reflow with soft spring easing.
- **Tile thumbnails** — Bronze/sepia filter with hover transition to increased opacity.
- **Library section** — Removed enclosing panel card, view toggle buttons moved to top-right, search bar full-width.
- **Footer** — Centered layout with vertical line dividers, GitHub text link replaced with octocat icon.
- **Delete dialog** — Backdrop blur overlay, refined copy and spacing.
### Fixed
- **Usage day boundary** — Daily usage now resets at local midnight instead of UTC midnight.

## 2026-03-17

### Added
- **Multi-provider transcription** (YTT-102) — Configure multiple cloud providers (Groq, OpenRouter, custom endpoints) with automatic fallback chain.
- **Drag-and-drop provider ordering** — Reorder transcription providers and local Whisper in settings with drag-and-drop. Priority persists to database.
- **Provider reorder API** — `POST /api/settings/providers/reorder` for bulk priority updates.

### Changed
- **OpenRouter defaults** — Default model changed to `google/gemini-2.5-flash`, trimmed model list to verified audio models.
- **Settings panel redesign** — Extracted to standalone component with dither toggles, hover states, and confirm-before-delete for providers.
- **Library toolbar** — Simplified to single view toggle with dropdown menu.

### Fixed
- **Extension fullscreen** — Side panel now closes when entering YouTube fullscreen via button or 'f' shortcut.
- **Progress animation** — Fixed animation resetting to pulsing pattern when switching browser tabs during transcription.

## 2026-03-15

### Added
- **Tab completion notifications** — Favicon shows a green checkmark badge and document title updates to "✓ Transcript ready: ..." when a transcript finishes, visible from other tabs. Both reset when starting a new extraction. (YTT-86)
- **Notifications setting** — Completion alerts toggle moved to Settings page with a proper switch control. Replaces the inline "Alerts On/Off" button in the queue header.

### Changed
- **Louder completion sound** — Increased gain from 0.08 to 0.35 with longer sustain so it's actually audible.
- **Extension: removed redundant header** — Chrome's side panel already shows the extension name and icon; removed the duplicate header inside the panel.
- **Extension: "already transcribed" detection** — When navigating to a video that's already in the database, the extension now shows the title with a checkmark badge and "View transcript" button instead of offering to transcribe again.
- **Extension: auto-open on completion** — Newly completed transcriptions automatically open in the app. Reuses an existing app tab instead of spawning new ones.
- **Extension: no more dead-end "Done" screen** — The old "Transcription complete / Open in app" screen is replaced with a contextual transcribed state that stays useful.

### Fixed
- **Groq usage daily reset** — Settings page now persists the usage reset to the database when visiting on a new day, instead of only resetting in the UI.

## 2026-03-14

### Added
- **Settings page** (`/settings`) — Configure Groq API key with auto-save on paste, test connection button, and step-by-step setup guide. Gear icon in footer links to settings. (YTT-87)
- **Groq usage meter** — Daily usage visualization showing audio-seconds used vs 14,400s free tier limit with color-coded status (Free / Approaching limit / Paid usage).
- **Settings API** — `GET /api/settings` (masked key), `PUT /api/settings` (save), `POST /api/settings/test-groq` (verify key).
- **DB-backed cloud config** — `getCloudWhisperConfig()` now checks DB settings (priority over env vars), allowing API key setup via the Settings page instead of `.env`.
- **Groq as primary transcription** — When a Groq API key is configured, cloud Whisper runs before YouTube caption scraping for faster results.
- **README Groq section** — Added "Groq Cloud Transcription (Free)" with signup steps, free tier limits, and env var alternative.

### Fixed
- **Redundant Groq retries** — When Groq fails (e.g., file too large), fallback path no longer re-attempts Groq, avoiding triple audio downloads.
- **Audio file size for Groq** — Lowered yt-dlp audio quality from 5 (~130kbps) to 9 (~65kbps) to keep files under Groq's 25MB limit for longer videos.
- **Usage tracking** — Fixed duration calculation falling back to last segment end time when Groq response omits top-level `duration` field.

### Changed
- **Footer layout** — Removed "about this project by lifesized" text; settings gear icon on left, GitHub icon on right.

## 2026-03-13

### Added
- **Chrome extension** — One-click YouTube transcription from any video page. Detects the current video, shows a Transcribe button, and displays recent transcripts. (`extension/`)
- **Side panel UI** — Extension uses Chrome Side Panel API so it stays open while navigating between YouTube videos. Auto-detects new videos on tab change.
- **Transcription queue in extension** — Queue multiple videos while one is transcribing. Queue persists via `chrome.storage.session`.
- **Persistent transcription state** — Extension state survives popup close and service worker restart. Badge indicator on icon: `...` (transcribing), `✓` (done), `!` (error).
- **Scrollable recent list** — Extension's recent transcripts list is scrollable with `max-height`.
- **`Setting` model** — Key-value settings table added to Prisma schema for upcoming settings page (YTT-87).

### Changed
- **"Open in app" button** — Restyled from orange text to white glass design matching the web app (`bg-white/10 border-white/20 rounded-full`).

### Removed
- **"Online" status badge** — Green dot and "Online"/"Offline" label removed from extension header.

## 2026-03-06

### Fixed
- **Queue stuck after duplicate URL** — Submitting a URL that was already transcribed would permanently block the processing queue, causing all subsequent URLs to stay in "pending" forever. (`app/page.tsx`)
- **Retry button not working** — The retry button on failed queue cards referenced the wrong variable, making it non-functional. (`app/page.tsx`)

### Changed
- **Pending queue items now show feedback** — Items waiting to be processed display a pulsing indicator and "Queued" label instead of a static grey dot with no context. (`app/page.tsx`)

## 2026-03-05

### Added
- **GNU AGPL v3.0 license** — Added `LICENSE` file, updated `package.json`, README badge, and About page. Replaces the previous ISC/MIT references. (`LICENSE`, `package.json`, `README.md`, `app/about/page.tsx`)

### Changed
- **Reordered transcript fallback chain** — Web page scrape is now tried first instead of last. YouTube's InnerTube API now requires Proof-of-Origin (PO) tokens via BotGuard attestation, causing ANDROID (400 FAILED_PRECONDITION) and WEB (UNPLAYABLE) clients to fail on all videos. Web scrape remains reliable and is now the primary caption source. (`lib/transcript.ts`)
- **Improved yt-dlp error messages** — Raw yt-dlp command output is no longer shown to users. Errors are classified into friendly messages (network issues, anti-bot blocks, unavailable videos, etc.) with actionable advice. (`lib/whisper.ts`)

### Fixed
- **yt-dlp audio download retry** — Added automatic retry (1 retry with 3s delay) for transient network errors during audio download, improving reliability on unstable connections. (`lib/whisper.ts`)
- **Updated yt-dlp** — Upgraded from 2026.02.04 to 2026.03.03 to fix YouTube "n challenge solving" failures.

## 2026-03-01

### Fixed
- **Progress bar now reaches 100%** — The transcription progress bar previously disappeared around 50–75% because the item status changed to "completed" before the bar could animate to full width. Now the bar animates to 100% with a "Done!" label before transitioning to the completed state.
- **Vertically centered status indicator** — The green checkmark (and other status icons) on queue cards are now vertically centered instead of being top-aligned.

## 2026-02-24

### Added
- **BYOK cloud Whisper fallback** — Cloud-based transcription via Groq or OpenAI Whisper APIs when YouTube captions aren't available. Configure with `WHISPER_CLOUD_API_KEY` and optional `WHISPER_CLOUD_PROVIDER` / `WHISPER_CLOUD_MODEL` env vars. Falls back to local Whisper on failure. New source values: `whisper_cloud_groq`, `whisper_cloud_openai`. (YTT-41)

## 2026-02-23

### Added
- **Lightweight standalone skill** (`contrib/claude-code/SKILL-lite.md`) — Zero-setup transcription skill that works with just `yt-dlp` installed. Auto-detects and upgrades to the full service when running. (YTT-35)
- **Caption language preference** — New `lang` parameter on POST `/api/transcripts` and MCP tools (`transcribe`, `transcribe_and_summarize`). Configure defaults via `YTT_CAPTION_LANGS` env var (comma-separated, e.g. `en,zh-Hans,es`). Tries manual captions first, then auto-generated, falls back to first available. (YTT-36)

### Changed
- **README** — Added Lite vs Full skill comparison table, Language Preference section with API/env var examples, added speaker diarization and multi-language captions to features list.
- **About page** — Split Claude Code agent into full and lite entries, added multi-language captions to Technical Highlights.
- **Stronger session continuity hook** — `check-handover.sh` now validates both HANDOVER.md and CHANGELOG.md, checks date headers, and blocks git commits when files are stale.
- **Competitive analysis** — Researched skills.sh ecosystem, feiskyer/youtube-transcribe-skill, mower07/youtube-transcribe-openclaw, and inference-sh audio skills to identify gaps and improvements.
- **9 new Linear tickets** for improvement roadmap:
  - YTT-35: Lightweight standalone SKILL.md (no server required) — Urgent
  - YTT-36: Caption language preference support — High
  - YTT-41: BYOK cloud Whisper fallback (Groq, OpenAI, user-provided) — High
  - YTT-37: Browser automation fallback (Chrome DevTools MCP) — Medium
  - YTT-38: Cookie/auth support for restricted content — Medium
  - YTT-42: Post-transcription intelligence layer (reflection, bias, content ideas) — Medium
  - YTT-39: Remote/non-localhost server URL — Low
  - YTT-40: Auto-detect and start service when not running — Low
  - YTT-43: Improve transcript download format and structure — Low

## 2026-02-22

### Added
- **`transcribe_and_summarize` MCP tool** — Combo tool that transcribes a video and returns the full text for the LLM to summarize in one step. No more follow-up questions in Claude Desktop.
- **`ts` shorthand** — Type `ts <URL>` in Claude Code, Claude Desktop, or OpenClaw to transcribe and summarize in one action.
- **MCP server** — New `mcp-server/` sub-package wrapping the REST API for Claude Desktop, Claude Code, Cursor, and other MCP clients. Includes 7 tools (`transcribe`, `transcribe_and_summarize`, `list_transcripts`, `search_transcripts`, `get_transcript`, `delete_transcript`, `summarize_transcript`) and a `transcript://{id}` resource. Built automatically during `npm run setup`.
- **`npm run mcp:config`** — Helper that prints the MCP client config with the correct absolute path.
- **MCP documentation** — `docs/MCP.md` with setup guides for Claude Desktop, Claude Code, and Cursor.
- **Session continuity hook** — `scripts/check-handover.sh` warns when work was done but `HANDOVER.md` wasn't updated.

### Changed
- **README** — Added "Use as an MCP Server" section; expanded skill trigger examples; simplified credits line.
- **Favicon** — Regenerated as multi-size ICO (16/32/48px) with 4x supersampled anti-aliasing.
- **Setup script** — MCP server install is now opt-in via y/N prompt during `npm run setup`.
- **About page** — Added Claude Desktop / Cursor entry to "How to Use"; updated AI agent integration highlight to mention MCP.

## 2026-02-20

### Changed
- **README skill examples** — Show all trigger forms (summarize, transcribe, s, t) as separate example lines instead of inline shorthand note.
- **README credits** — Simplified credits line.
- **Favicon** — Regenerated as multi-size ICO (16/32/48px) with 4x supersampled anti-aliasing for smooth edges in browser tabs.

## [Unreleased] — improve-transcript branch

### Added
- **Speaker diarization support** — Opt-in speaker identification using pyannote.audio. When `HF_TOKEN` is configured, Whisper-transcribed videos automatically get "Speaker 1", "Speaker 2" labels. Diarization is non-fatal; if it fails, transcripts are returned without speaker labels. (`lib/whisper.ts`)
- **`speaker` field on `TranscriptSegment`** — Optional field added to the transcript segment interface for backward-compatible speaker data. (`lib/types.ts`)
- **Segment merging in transcript viewer** — Short caption segments (every 2-3s) are merged into ~10-second blocks for more readable paragraphs. (`app/page.tsx`)
- **Speaker labels in UI** — Speaker name shown above transcript blocks when the speaker changes. (`app/page.tsx`)
- **Speaker labels in exports** — Copy-to-clipboard, Markdown download, LLM summarization prompts, and "Summarize with" launcher all include speaker labels when available. (`app/page.tsx`, `app/api/transcripts/[id]/download/route.ts`, `app/api/transcripts/[id]/summarize/route.ts`, `components/ui/llm-launcher.tsx`)
- **`HF_TOKEN` env var** — Documented in `.env.example` for pyannote.audio speaker diarization setup.
- **pyannote.audio install** — Added to `scripts/setup.sh` as an optional dependency.
- **"Identifying speakers..." progress phase** — Progress indicator updated with a diarization stage between Whisper transcription and completion. (`app/page.tsx`)

### Changed
- **Transcript rendering alignment** — Timestamps now use `items-baseline` alignment, fixed width (`w-10`), and right-alignment for consistent visual positioning. (`app/page.tsx`)
- **About page layout** — Matched content width to home page (`max-w-[800px]`), added responsive padding, removed section dividers, updated typography hierarchy to match home page styles (h2 = video title style, body = author/date style). (`app/about/page.tsx`)
- **About page content** — Title changed to "About", removed subtitle, added "Summarize with..." to How to Use section, renamed "Built With AI" to "Tools", updated tools list text, added MIT License mention, removed Ghostty from tools.
- **Favicon** — Created `app/favicon.ico` with black circle on light gray (`#B4B4B4`) background, 4px rounded corners, centered smaller circle. Next.js App Router auto-serves it.

### Removed
- `public/favicon.ico` — Moved to `app/favicon.ico` for App Router compatibility.
