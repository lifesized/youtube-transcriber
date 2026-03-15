# Changelog

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
