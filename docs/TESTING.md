# Test Protocol

YouTube Transcriber has a multi-layer test protocol designed to catch environment and configuration issues across different deployment modes.

## The Problem

The app has combinatorial complexity across its deployment surface:

- **3 deployment modes**: local dev (`npm run dev`), Docker, lite/background service
- **Python subprocesses**: Whisper inherits the environment of whatever mode launched it — venv path, CUDA/Metal availability, working directory all vary
- **Edge cases at intersections**: a bug that only appears in Docker when Whisper falls back from Metal to CPU, or a path resolution failure only in the background service mode

These bugs are nearly impossible to catch through normal use. When someone files a report, "works on my machine" is genuinely true — the issue is specific to their deployment mode × environment intersection.

**Example**: YTT-82 — the setup script didn't run `prisma generate` or `prisma db push`, so every first-time user got 500 errors on transcription requests. A post-setup verification would have caught this immediately.

## Layer 1: Post-Setup Verification (`npm run test:setup`)

**When to run**: After initial setup, after upgrading, or when something isn't working.

```bash
npm run test:setup
```

This runs `scripts/test-setup.sh` which checks every dependency and configuration:

| Check | What it verifies |
|-------|-----------------|
| Node.js | Version >= 18 |
| Python | `python3` in PATH |
| Virtual env | `.venv/` directory exists |
| ffmpeg | In PATH |
| yt-dlp | In PATH |
| .env | File exists, `DATABASE_URL` set |
| Whisper CLI | Path from `WHISPER_CLI` env var is a real file |
| Python bin | Path from `WHISPER_PYTHON_BIN` env var is a real file |
| Prisma client | Generated in `node_modules/` |
| SQLite DB | `prisma/dev.db` exists and `Video` table is queryable |
| Disk | `tmp/` directory is writable |
| Whisper imports | OpenAI Whisper and MLX Whisper (on Apple Silicon) importable |

Each check prints `[PASS]`, `[FAIL]`, or `[WARN]` with an actionable fix message. Exit code 0 means all checks passed.

This runs automatically at the end of `npm run setup`.

## Layer 2: Runtime Health Check (`GET /api/health`)

**When to use**: To verify a running instance is healthy. Useful for Docker health checks, monitoring dashboards, or debugging "the API returns 500 but I don't know why."

```bash
curl http://localhost:19720/api/health
```

Returns JSON:

```json
{
  "status": "healthy",
  "checks": [
    { "name": "database", "status": "pass", "detail": "Connected, 42 transcript(s)" },
    { "name": "python", "status": "pass", "detail": "Python 3.14.0" },
    { "name": "whisper", "status": "pass", "detail": ".venv/bin/whisper" },
    { "name": "ffmpeg", "status": "pass", "detail": "/opt/homebrew/bin/ffmpeg" },
    { "name": "yt-dlp", "status": "pass", "detail": "/opt/homebrew/bin/yt-dlp" },
    { "name": "tmp_writable", "status": "pass", "detail": "/path/to/tmp" },
    { "name": "env_vars", "status": "pass" }
  ]
}
```

- Returns **200** when all checks pass (`"status": "healthy"`)
- Returns **503** when any check fails (`"status": "unhealthy"`)
- Individual checks can be `"pass"`, `"fail"`, or `"warn"`

### Docker health check

```dockerfile
HEALTHCHECK --interval=30s --timeout=10s --retries=3 \
  CMD curl -f http://localhost:19720/api/health || exit 1
```

## Layer 3: End-to-End Integration (Future)

A full integration test that exercises the complete pipeline — download a short clip, transcribe it, verify DB write, check queue lifecycle. This would catch the deep combinatorial bugs (subprocess environment inheritance, Metal/CPU fallback, queue race conditions).

Not yet implemented. Tracked for future work when the deployment matrix grows.

## When to Use Which

| Scenario | Use |
|----------|-----|
| Just ran `npm run setup` | `test:setup` runs automatically |
| Something broke that was working | `GET /api/health` |
| Debugging a contributor's bug report | Ask them for `npm run test:setup` output |
| Docker deployment monitoring | `GET /api/health` as healthcheck |
| After upgrading Node/Python/deps | `npm run test:setup` |
| CI/CD pipeline | `npm run test:setup` in build step |
