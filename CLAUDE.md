# Project: YouTube Transcriber

Next.js 15 app — local YouTube transcription via Whisper + yt-dlp. Runs at `localhost:19720`.

## Session continuity

Before ending a session or when context usage exceeds ~75%, update these two files and alert user when doing this so they know we have reached 75%:

1. **`HANDOVER.md`** — Write a fresh handover so the next session can pick up immediately. Include:
   - What was done this session (numbered list, concise)
   - Key files touched
   - Current state (branch, last commit, build status, uncommitted changes)
   - Any open issues or next steps discussed

2. **`CHANGELOG.md`** — Append entries for any user-facing changes made this session under a dated heading (`## YYYY-MM-DD`). Use Keep a Changelog categories (Added, Changed, Fixed, Removed).

Do not wait to be asked — update these proactively when context is getting full.
