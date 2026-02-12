# Handoff - 2026-02-12

## Summary
This project is mid-migration from PyTorch/OpenAI Whisper on MPS to an MLX-first transcription pipeline on Apple Silicon, with deterministic fallback and timeout behavior.

## Completed Work

### 1) MLX-first backend + fallback + timeout
Commit: `9bc8c03`

Files changed:
- `lib/whisper.ts`
- `README.md`

Implemented:
- Backend selection via `WHISPER_BACKEND=auto|mlx|openai`.
- Device selection for OpenAI backend via `WHISPER_DEVICE=auto|mps|cpu`.
- Timeout control via `WHISPER_TIMEOUT_MS` (default `480000`).
- Fallback chains:
  - `mlx -> openai(cpu)`
  - `openai(mps) -> openai(cpu)`
- Improved runtime logging with backend/device/fallback context.
- README docs for backend/device/timeouts.

### 2) MLX invocation and model-candidate bug fixes
Commit: `7eb79d5`

Files changed:
- `lib/whisper.ts`

Fixed:
- Python inline invocation issue in MLX path.
- Model candidate ordering for MLX to avoid invalid initial repo lookup for base model.

### 3) Turbopack root setting
Commit: `9195ff7`

Files changed:
- `next.config.ts`

Added explicit Turbopack root config to reduce root-inference ambiguity.

## Testing Status

### Verified
- `npx tsc --noEmit` passed after MLX backend fixes.
- MLX path selection appeared in smoke logs (`backend="mlx"`).

### Not fully completed yet
- Full end-to-end benchmark for the provided captionless URL is still pending final completion report.
- Final benchmark should capture:
  - requested backend
  - used backend/device
  - fallback reason
  - total wall-clock time
  - HTTP status

## Current Repository State (at handoff)

### Latest commits (newest first)
- `9195ff7` Set explicit Turbopack root to workspace directory
- `7eb79d5` Fix MLX invocation and valid model candidate selection
- `9bc8c03` Add MLX-first Whisper backend with guarded fallback and timeout controls

### Uncommitted files
- `app/layout.tsx`
- `app/library/page.tsx`
- `app/page.tsx`
- `app/transcripts/[id]/page.tsx`
- `next.config.ts`
- `package.json`
- `package-lock.json`
- `tsconfig.tsbuildinfo`

Notes:
- There are in-flight UI changes not yet checkpointed.
- `package.json`/`package-lock.json` include dependency updates from ongoing work.

## Runtime Status
- Dev server was not listening on `127.0.0.1:3000` at last check.
- Restart and re-verify before next benchmark run.

## Environment Requirements
- macOS Apple Silicon
- `yt-dlp` and `ffmpeg` installed (Homebrew)
- Python venv containing:
  - `openai-whisper`
  - `mlx-whisper`
- Database env expected as `DATABASE_URL="file:./dev.db"`

## Recommended Next Steps (in order)
1. Restart dev server cleanly on `3000`.
2. Run full e2e transcription test using:
   - URL: `https://www.youtube.com/watch?v=e3ohpjJlUzM`
   - backend mode: `WHISPER_BACKEND=auto`
3. Record final benchmark outcome (backend used, fallback, timing, status).
4. Resolve any remaining `next.config.ts` root/path ambiguity if observed.
5. Address outstanding UI review items (a11y labels, clipboard error handling, lint command compatibility).
6. Commit remaining UI/config changes in small isolated checkpoints.

## Useful Commands
```bash
# Typecheck
npx tsc --noEmit

# Start app with MLX auto mode
WHISPER_BACKEND=auto npm run dev

# Post test URL
curl -X POST 'http://127.0.0.1:3000/api/transcripts' \
  -H 'content-type: application/json' \
  --data '{"url":"https://www.youtube.com/watch?v=e3ohpjJlUzM"}'
```
