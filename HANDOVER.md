# Handover — 2026-02-22

## What was done this session

1. Reviewed HANDOVER.md from previous session
2. Researched competitive landscape: feiskyer/youtube-transcribe-skill, mower07/youtube-transcribe-openclaw, inference-sh speech-to-text/dialogue-audio/ai-podcast-creation/ai-voice-cloning/content-repurposing skills
3. Generated detailed pros/cons analysis vs our implementation
4. Created 9 Linear tickets (YTT-35 through YTT-43) covering: lightweight skill, language preference, BYOK cloud Whisper, browser automation fallback, cookie auth, post-transcription intelligence, remote server, auto-start, download improvements
5. Updated CHANGELOG.md with competitive analysis and ticket creation

## Uncommitted changes (8 files)

From **previous session** (still uncommitted):
- `mcp-server/src/index.ts` — `transcribe_and_summarize` tool, updated `transcribe` description
- `README.md` — added `ts` shorthand, added `transcribe_and_summarize` to tool list
- `docs/MCP.md` — added `transcribe_and_summarize` to tools table
- `app/about/page.tsx` — updated example to show `ts` shorthand
- `contrib/claude-code/SKILL.md` — user edits (check diff)
- `contrib/openclaw/SKILL.md` — user edits (check diff)

From **this session**:
- `CHANGELOG.md` — added 2026-02-23 section with competitive analysis + ticket list
- `HANDOVER.md` — this file

**These all need to be committed and pushed.**

## Current state

- **Branch:** `main`
- **Last commit:** `db1af4f` — Update docs and about page for opt-in MCP server
- **Build:** clean (app running at localhost:19720)
- **MCP server needs rebuild** after index.ts changes: `npm run mcp:build`

## In progress

- **YTT-35** (Lightweight standalone SKILL.md) — next to build
- **YTT-36** (Caption language preference) — next to build

## Tech stack

- Next.js 15, React 19, TypeScript, Prisma + SQLite, Tailwind CSS v4
- Whisper (MLX + OpenAI) for transcription, yt-dlp for audio download
- Optional: pyannote.audio for speaker diarization (requires `HF_TOKEN`)
- MCP server: `@modelcontextprotocol/sdk` v1.x, stdio transport

## Backlog (Linear)

| Ticket | Title | Priority |
|--------|-------|----------|
| YTT-35 | Lightweight standalone SKILL.md (no server required) | Urgent |
| YTT-36 | Add caption language preference support | High |
| YTT-41 | BYOK cloud Whisper fallback (Groq, OpenAI, user-provided) | High |
| YTT-37 | Browser automation fallback (Chrome DevTools MCP) | Medium |
| YTT-38 | Cookie/auth support for restricted content | Medium |
| YTT-42 | Post-transcription intelligence layer (reflection, bias, ideas) | Medium |
| YTT-39 | Remote/non-localhost server URL | Low |
| YTT-40 | Auto-detect and start service when not running | Low |
| YTT-43 | Improve transcript download format and structure | Low |
| YTT-30 | Chrome Extension | Backlog |
| YTT-23 | Background service management | Backlog |
| YTT-19 | npm publishing | Backlog |
| YTT-32 | Weekly summary + skill suggestions | Backlog |
