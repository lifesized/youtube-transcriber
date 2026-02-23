# Changelog

## 2026-02-23

### Added
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
