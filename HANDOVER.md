# Handover — 2026-02-23

## What was done this session

1. Reviewed HANDOVER.md from previous session
2. Researched competitive landscape: feiskyer/youtube-transcribe-skill, mower07/youtube-transcribe-openclaw, inference-sh speech-to-text/dialogue-audio/ai-podcast-creation/ai-voice-cloning/content-repurposing skills
3. Generated detailed pros/cons analysis vs our implementation
4. Created 9 Linear tickets (YTT-35 through YTT-43) covering: lightweight skill, language preference, BYOK cloud Whisper, browser automation fallback, cookie auth, post-transcription intelligence, remote server, auto-start, download improvements
5. Strengthened `scripts/check-handover.sh` — now checks CHANGELOG.md too, validates dates, blocks commits when stale
6. Built YTT-35: Lightweight standalone SKILL-lite.md — dual-mode skill (yt-dlp direct / full service)
7. Built YTT-36: Caption language preference — `lang` param threaded through API, InnerTube clients, and MCP tools; `YTT_CAPTION_LANGS` env var
8. MCP server rebuilt with lang support
9. Tested all features: English, Spanish, Japanese captions, fallback behavior, lite mode, pre-commit hook
10. Updated README with lite/full skill comparison table, Language Preference section, expanded features
11. Updated about page with lite skill entry and multi-language highlight
12. Pushed all commits to origin

## Current state

- **Branch:** `main`
- **Last commit:** `ab2c77b` — Add lightweight skill and caption language preference (YTT-35, YTT-36)
- **Build:** clean (app running at localhost:19720)
- **MCP server:** rebuilt with lang support

## Completed this session

- **YTT-35** (Lightweight standalone SKILL.md) — done, tested, pushed
- **YTT-36** (Caption language preference) — done, tested, pushed

## Tech stack

- Next.js 15, React 19, TypeScript, Prisma + SQLite, Tailwind CSS v4
- Whisper (MLX + OpenAI) for transcription, yt-dlp for audio download
- Optional: pyannote.audio for speaker diarization (requires `HF_TOKEN`)
- MCP server: `@modelcontextprotocol/sdk` v1.x, stdio transport

## Backlog (Linear)

| Ticket | Title | Priority |
|--------|-------|----------|
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
