#!/bin/bash
# --------------------------------------------------------------------------
# YouTube Transcriber — Post-Setup Verification (YTT-83)
#
# Checks that every dependency is installed and configured correctly.
# Run after setup or any time something feels broken:
#
#   npm run test:setup
#
# Exit code 0 = all checks passed, non-zero = at least one failed.
# --------------------------------------------------------------------------
set -euo pipefail

PASS=0
FAIL=0
WARN=0

pass() { PASS=$((PASS + 1)); echo "  [PASS] $1"; }
fail() { FAIL=$((FAIL + 1)); echo "  [FAIL] $1"; }
warn() { WARN=$((WARN + 1)); echo "  [WARN] $1"; }

echo ""
echo "YouTube Transcriber — Setup Verification"
echo "=========================================="
echo ""

# ── Node.js ───────────────────────────────────────────────────────────────
echo "Node.js"
if command -v node &>/dev/null; then
    NODE_VER=$(node -v | sed 's/v//')
    NODE_MAJOR=$(echo "$NODE_VER" | cut -d. -f1)
    if [ "$NODE_MAJOR" -ge 18 ]; then
        pass "Node.js $NODE_VER (>= 18 required)"
    else
        fail "Node.js $NODE_VER found but >= 18 required"
    fi
else
    fail "Node.js not found"
fi
echo ""

# ── Python ────────────────────────────────────────────────────────────────
echo "Python"
if command -v python3 &>/dev/null; then
    PY_VER=$(python3 --version 2>&1 | awk '{print $2}')
    pass "Python $PY_VER"
else
    fail "python3 not found in PATH"
fi

if [ -d ".venv" ]; then
    pass ".venv directory exists"
else
    fail ".venv directory missing — run: python3 -m venv .venv"
fi
echo ""

# ── System binaries ───────────────────────────────────────────────────────
echo "System dependencies"
if command -v ffmpeg &>/dev/null; then
    pass "ffmpeg found"
else
    fail "ffmpeg not found — install via your package manager"
fi

if command -v yt-dlp &>/dev/null; then
    pass "yt-dlp found"
else
    fail "yt-dlp not found — install via your package manager"
fi
echo ""

# ── Environment ───────────────────────────────────────────────────────────
echo "Environment"
if [ -f ".env" ]; then
    pass ".env file exists"

    # Check required vars
    if grep -q "^DATABASE_URL=" .env 2>/dev/null; then
        pass "DATABASE_URL is set"
    else
        fail "DATABASE_URL missing from .env"
    fi

    if grep -q "^WHISPER_CLI=" .env 2>/dev/null; then
        WHISPER_CLI=$(grep "^WHISPER_CLI=" .env | head -1 | cut -d'"' -f2)
        if [ -f "$WHISPER_CLI" ]; then
            pass "WHISPER_CLI path exists ($WHISPER_CLI)"
        else
            fail "WHISPER_CLI points to missing file: $WHISPER_CLI"
        fi
    else
        fail "WHISPER_CLI missing from .env"
    fi

    if grep -q "^WHISPER_PYTHON_BIN=" .env 2>/dev/null; then
        WHISPER_PY=$(grep "^WHISPER_PYTHON_BIN=" .env | head -1 | cut -d'"' -f2)
        if [ -f "$WHISPER_PY" ]; then
            pass "WHISPER_PYTHON_BIN path exists ($WHISPER_PY)"
        else
            fail "WHISPER_PYTHON_BIN points to missing file: $WHISPER_PY"
        fi
    else
        fail "WHISPER_PYTHON_BIN missing from .env"
    fi
else
    fail ".env file missing — run: cp .env.example .env"
fi
echo ""

# ── Database ──────────────────────────────────────────────────────────────
echo "Database"
if [ -f "node_modules/.prisma/client/index.js" ] || [ -f "node_modules/@prisma/client/default.js" ]; then
    pass "Prisma client generated"
else
    fail "Prisma client not generated — run: npx prisma generate"
fi

# The better-sqlite3 adapter resolves DATABASE_URL relative to CWD, not prisma/
DB_PATH="dev.db"
if [ -f ".env" ]; then
    ENV_DB=$(grep "^DATABASE_URL=" .env 2>/dev/null | head -1 | sed 's/.*file:\.\///' | tr -d '"')
    [ -n "$ENV_DB" ] && DB_PATH="$ENV_DB"
fi
if [ -f "$DB_PATH" ]; then
    pass "SQLite database exists ($DB_PATH)"
    # Try a quick query to verify schema exists
    if command -v sqlite3 &>/dev/null; then
        HAS_TABLE=$(sqlite3 "$DB_PATH" "SELECT name FROM sqlite_master WHERE type='table' AND name='Video';" 2>/dev/null || echo "")
        if [ "$HAS_TABLE" = "Video" ]; then
            COUNT=$(sqlite3 "$DB_PATH" "SELECT COUNT(*) FROM Video;" 2>/dev/null || echo "?")
            pass "Database queryable ($COUNT transcripts)"
        else
            fail "Database exists but Video table not found — run: npx prisma db push"
        fi
    else
        warn "sqlite3 CLI not available — skipping query test"
    fi
else
    fail "SQLite database missing ($DB_PATH) — run: npx prisma db push"
fi
echo ""

# ── Disk ──────────────────────────────────────────────────────────────────
echo "Disk"
TMP_DIR="tmp"
mkdir -p "$TMP_DIR" 2>/dev/null
TEST_FILE="$TMP_DIR/.write-test-$$"
if touch "$TEST_FILE" 2>/dev/null; then
    rm -f "$TEST_FILE"
    pass "tmp/ directory writable"
else
    fail "tmp/ directory not writable"
fi
echo ""

# ── Whisper (optional deep check) ─────────────────────────────────────────
echo "Whisper"
if [ -d ".venv" ] && [ -f ".venv/bin/python3" ]; then
    if .venv/bin/python3 -c "import whisper" 2>/dev/null; then
        pass "OpenAI Whisper importable"
    else
        warn "OpenAI Whisper not importable (Whisper transcription will be unavailable)"
    fi

    if .venv/bin/python3 -c "import mlx_whisper" 2>/dev/null; then
        pass "MLX Whisper importable (Apple Silicon acceleration available)"
    else
        if [[ $(uname -m) == "arm64" ]] && [[ $(uname) == "Darwin" ]]; then
            warn "MLX Whisper not found — Apple Silicon detected, consider: pip install mlx-whisper"
        else
            pass "MLX Whisper not installed (not on Apple Silicon — this is expected)"
        fi
    fi
else
    warn "Cannot test Whisper imports — .venv/bin/python3 not found"
fi
echo ""

# ── Summary ───────────────────────────────────────────────────────────────
echo "=========================================="
echo "Results: $PASS passed, $FAIL failed, $WARN warnings"
echo ""

if [ "$FAIL" -gt 0 ]; then
    echo "Some checks failed. Fix the issues above and re-run:"
    echo "  npm run test:setup"
    echo ""
    exit 1
else
    echo "All checks passed. Your setup is ready."
    echo ""
    exit 0
fi
