# Handover — 2026-02-22

## What was done this session

1. Updated README skill examples to show all trigger forms (summarize, transcribe, s, t)
2. Simplified README credits line
3. Regenerated favicon as multi-size ICO (16/32/48px) with 4x anti-aliased rendering
4. Built session continuity hook (`scripts/check-handover.sh`) — git-based, warns when work done but HANDOVER.md not updated
5. Updated Linear tickets: YTT-15 done, YTT-18 and YTT-17 progress notes
6. Built MCP server (`mcp-server/src/index.ts`) — 6 tools + 1 resource, wraps REST API via stdio transport
7. Made MCP install opt-in during `npm run setup` (y/N prompt)
8. Added MCP server to user's Claude Desktop config
9. Updated about page and README with MCP integration docs
10. Created `docs/MCP.md` setup guide
11. Closed YTT-14 on Linear

## Key files

- `mcp-server/src/index.ts` — MCP server (~200 lines, one file)
- `mcp-server/package.json`, `tsconfig.json` — sub-package config
- `scripts/check-handover.sh` — session continuity hook
- `scripts/mcp-config.sh` — prints Claude Desktop config snippet
- `scripts/setup.sh` — opt-in MCP prompt added
- `docs/MCP.md` — MCP setup guide for Claude Desktop, Claude Code, Cursor
- `CLAUDE.md` — project instructions for new sessions
- `app/about/page.tsx` — added Claude Desktop/Cursor to How to Use
- `README.md` — MCP section, updated skill examples, simplified credits

## Current state

- **Branch:** `main`
- **Last commit:** `69cebe5` — Make MCP server opt-in during setup
- **Build:** clean (app running at localhost:19720, MCP server builds without errors)
- **Claude Desktop:** MCP server configured — restart Desktop to activate

## Tech stack

- Next.js 15, React 19, TypeScript, Prisma + SQLite, Tailwind CSS v4
- Whisper (MLX + OpenAI) for transcription, yt-dlp for audio download
- Optional: pyannote.audio for speaker diarization (requires `HF_TOKEN`)
- MCP server: `@modelcontextprotocol/sdk` v1.x, stdio transport

## Open items / next steps

- Test MCP server in Claude Desktop after restart
- YTT-30 (Chrome Extension) — backlog
- YTT-23 (Background service management) — backlog
- YTT-19 (npm publishing) — backlog
- YTT-32 (Weekly summary + skill suggestions) — backlog
