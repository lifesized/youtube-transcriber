# Handover — YouTube Transcriber

You are continuing work on a YouTube Transcriber Next.js app. The main branch is up to date with remote.

## What was done

### Session 1: improve-transcript branch (merged)

1. **Favicon** — `app/favicon.ico` (black circle, light gray background, rounded corners)
2. **About page redesign** — `app/about/page.tsx` matched to home page width/typography, updated content with skill usage examples and shorthand triggers
3. **Speaker diarization** — Opt-in pyannote.audio via `HF_TOKEN` env var, non-fatal. Speaker labels in UI, clipboard, Markdown download, summarize route, LLM launcher
4. **Transcript rendering** — `mergeSegments()` groups captions into ~10s blocks, fixed timestamp alignment, speaker labels above blocks
5. **Shared utilities** — `lib/utils.ts` (`formatTimestamp`, `cx`), `lib/api-utils.ts` (`getVideoOr404`)

### Session 2: README, setup, and skill improvements

6. **Simplified setup** — `scripts/setup.sh` now auto-installs yt-dlp and ffmpeg via platform detection (brew/apt/dnf/pacman). One command does everything.
7. **README overhaul** — Code block is the hero, prerequisites moved to footnote, "Install yt-dlp first" section removed, button text fixed (Extract not Capture), "Summarize with LLM" feature documented, agent skill section added after quick start with separate code blocks per agent
8. **Claude Code skill: auto-summarize** — `contrib/claude-code/SKILL.md` updated to summarize transcripts by default (the agent reads the transcript and summarizes inline). Full transcript only shown if explicitly requested.
9. **Broadened skill triggers** — Skill activates on bare YouTube URLs, "summarize [url]", shorthand "s [url]" or "t [url]", or just a pasted URL with no context
10. **About page updated** — Skill examples now show short triggers (`s https://...`) and explain that transcripts are saved + summarized in chat

## Key files
- `app/favicon.ico` — favicon
- `app/about/page.tsx` — about page with skill usage examples
- `app/page.tsx` — segment merging, speaker labels, progress indicator
- `lib/types.ts` — `TranscriptSegment` with optional `speaker` field
- `lib/whisper.ts` — Whisper transcription + diarization pipeline
- `app/api/transcripts/[id]/download/route.ts` — Markdown export
- `app/api/transcripts/[id]/summarize/route.ts` — summarize route
- `components/ui/llm-launcher.tsx` — LLM launcher (ChatGPT / Claude)
- `lib/utils.ts` — shared formatting utilities
- `lib/api-utils.ts` — shared API helpers
- `scripts/setup.sh` — one-command setup (installs everything)
- `contrib/claude-code/SKILL.md` — Claude Code skill (auto-summarize, short triggers)
- `contrib/openclaw/SKILL.md` — OpenClaw skill
- `.env.example` — env var documentation
- `CHANGELOG.md` — change log
- `README.md` — simplified quick start, skill section, features

## Current state
- **Branch:** `main` (up to date with `origin/main`)
- Latest commit: `1cfa33c`
- TypeScript compiles cleanly, Next.js build passes
- No uncommitted changes (only this `HANDOVER.md` is untracked)
- App runs at `localhost:19720`

## Tech stack
- Next.js 15, React 19, TypeScript, Prisma + SQLite, Tailwind CSS v4
- Whisper (MLX + OpenAI) for transcription, yt-dlp for audio download
- Optional: pyannote.audio for speaker diarization (requires `HF_TOKEN`)
