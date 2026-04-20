# Changelog

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
