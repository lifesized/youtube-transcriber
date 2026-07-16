#!/bin/bash
set -e

echo "🚀 YouTube Transcriber Setup"
echo "=============================="
echo ""

# Check for Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 20.19+, 22.12+, or 24+ first."
    exit 1
fi

NODE_VER=$(node -v | sed 's/v//')
NODE_MAJOR=$(echo "$NODE_VER" | cut -d. -f1)
NODE_MINOR=$(echo "$NODE_VER" | cut -d. -f2)
if ! { [ "$NODE_MAJOR" -eq 20 ] && [ "$NODE_MINOR" -ge 19 ]; } && \
   ! { [ "$NODE_MAJOR" -eq 22 ] && [ "$NODE_MINOR" -ge 12 ]; } && \
   [ "$NODE_MAJOR" -lt 24 ]; then
    echo "❌ Node.js $NODE_VER is unsupported. Install Node.js 20.19+, 22.12+, or 24+."
    exit 1
fi

# Check for Python
if ! command -v python3 &> /dev/null; then
    echo "❌ Python 3 is not installed. Please install Python 3.8+ first."
    exit 1
fi

echo "✓ Node.js found: $(node --version)"
echo "✓ Python found: $(python3 --version)"
echo ""

# ---------------------------------------------------------------------------
# Install system dependencies: yt-dlp & ffmpeg
# ---------------------------------------------------------------------------
install_with_brew() {
    if ! command -v brew &> /dev/null; then
        echo "❌ Homebrew not found. Install it from https://brew.sh then re-run setup."
        exit 1
    fi
    echo "📦 Installing yt-dlp and ffmpeg via Homebrew..."
    brew install yt-dlp ffmpeg
}

install_with_apt() {
    echo "📦 Installing yt-dlp and ffmpeg via apt..."
    sudo apt-get update -qq
    sudo apt-get install -y yt-dlp ffmpeg python3-venv
}

install_with_dnf() {
    echo "📦 Installing yt-dlp and ffmpeg via dnf..."
    sudo dnf install -y yt-dlp ffmpeg python3
}

install_with_pacman() {
    echo "📦 Installing yt-dlp and ffmpeg via pacman..."
    sudo pacman -S --noconfirm yt-dlp ffmpeg python
}

NEED_YTDLP=false
NEED_FFMPEG=false
command -v yt-dlp &> /dev/null && echo "✓ yt-dlp found" || NEED_YTDLP=true
command -v ffmpeg &> /dev/null && echo "✓ ffmpeg found" || NEED_FFMPEG=true

if $NEED_YTDLP || $NEED_FFMPEG; then
    if [[ "$OSTYPE" == "darwin"* ]]; then
        install_with_brew
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        if command -v apt-get &> /dev/null; then
            install_with_apt
        elif command -v dnf &> /dev/null; then
            install_with_dnf
        elif command -v pacman &> /dev/null; then
            install_with_pacman
        else
            echo "❌ Could not detect package manager. Please install yt-dlp and ffmpeg manually, then re-run setup."
            exit 1
        fi
    else
        echo "❌ Unsupported OS. Please install yt-dlp and ffmpeg manually, then re-run setup."
        exit 1
    fi
    echo ""
fi

# ---------------------------------------------------------------------------
# Install Node dependencies
# ---------------------------------------------------------------------------
echo "📦 Installing Node dependencies..."
if command -v bun &> /dev/null; then
    bun install
else
    npm install
fi

check_sqlite_binding() {
    node -e 'const Database = require("better-sqlite3"); const db = new Database(":memory:"); db.close();' 2>/dev/null
}

if ! check_sqlite_binding; then
    echo "⚠️  better-sqlite3's native binding did not load; rebuilding it for Node.js $NODE_VER..."
    if ! npm rebuild better-sqlite3; then
        echo "⚠️  Automatic better-sqlite3 rebuild failed."
    fi
fi

if ! check_sqlite_binding; then
    echo "❌ better-sqlite3's native binding failed to load."
    echo "   Use the same supported Node.js version for setup and npm run dev, then re-run setup."
    echo "   Manual repair: npm rebuild better-sqlite3"
    exit 1
fi
echo "✓ better-sqlite3 native binding ready"
echo ""

# ---------------------------------------------------------------------------
# Python virtual environment
# ---------------------------------------------------------------------------
echo "🐍 Setting up Python virtual environment..."
if [ ! -d ".venv" ]; then
    if ! python3 -m venv .venv; then
        echo "❌ Failed to create Python venv."
        echo "   On Debian/Ubuntu, install the venv module: sudo apt-get install -y python3-venv"
        exit 1
    fi
    echo "✓ Created .venv"
else
    echo "✓ .venv already exists"
fi

if [ ! -f ".venv/bin/activate" ]; then
    echo "❌ .venv exists but is incomplete (missing bin/activate). Delete it and re-run setup."
    exit 1
fi

# ---------------------------------------------------------------------------
# Configure .env (must run before Prisma — prisma.config.ts loads DATABASE_URL from .env)
# ---------------------------------------------------------------------------
echo ""
echo "📝 Configuring environment..."

if [ ! -f ".env" ]; then
    cp .env.example .env

    VENV_PATH=$(pwd)/.venv

    if [[ "$OSTYPE" == "darwin"* ]] || [[ "$OSTYPE" == "linux-gnu"* ]]; then
        sed -i.bak "s|WHISPER_CLI=\"/path/to/your/.venv/bin/whisper\"|WHISPER_CLI=\"$VENV_PATH/bin/whisper\"|" .env
        sed -i.bak "s|WHISPER_PYTHON_BIN=\"/path/to/your/.venv/bin/python3\"|WHISPER_PYTHON_BIN=\"$VENV_PATH/bin/python3\"|" .env
        rm .env.bak
    fi

    echo "✓ Created .env with configured paths"
else
    echo "✓ .env already exists (not overwriting)"
fi
echo ""

# ---------------------------------------------------------------------------
# Initialize database
# ---------------------------------------------------------------------------
echo "🗄️  Initializing database..."
npx prisma generate
npx prisma db push
echo "✓ Database ready"
echo ""

# ---------------------------------------------------------------------------
# Install Whisper into the venv
# ---------------------------------------------------------------------------
echo "📥 Installing Whisper..."
source .venv/bin/activate
pip install --upgrade pip
pip install openai-whisper

# Install MLX Whisper if on Apple Silicon
if [[ $(uname -m) == "arm64" ]] && [[ $(uname) == "Darwin" ]]; then
    echo "🍎 Detected Apple Silicon — installing MLX Whisper for faster transcription..."
    pip install mlx-whisper
fi

# Install pyannote.audio for speaker diarization (optional)
echo "🔊 Installing pyannote.audio for speaker diarization..."
pip install pyannote.audio || echo "⚠️  pyannote.audio install failed (speaker diarization will be unavailable)"

# ---------------------------------------------------------------------------
# MCP server (optional)
# ---------------------------------------------------------------------------
echo ""
read -p "🔌 Do you want access to this skill in Claude Desktop? [y/N] " INSTALL_MCP
if [[ "$INSTALL_MCP" =~ ^[Yy]$ ]]; then
    echo "Building MCP server..."
    cd mcp-server && npm install && npm run build && cd ..
    echo "✓ MCP server built at mcp-server/dist/index.js"
    echo "  Run 'npm run mcp:config' to get your client config snippet."
else
    echo "Skipped MCP server. You can install it later with: npm run mcp:build"
fi

# ---------------------------------------------------------------------------
# Verify setup
# ---------------------------------------------------------------------------
echo ""
echo "Running setup verification..."
bash scripts/test-setup.sh

echo ""
echo "✅ Setup complete!"
echo ""
echo "To start the app:"
echo "  npm run dev    (or: bun dev)"
echo ""
echo "Then open: http://localhost:19720"
