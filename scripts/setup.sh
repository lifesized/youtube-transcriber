#!/bin/bash
set -e

echo "🚀 YouTube Transcriber Setup"
echo "=============================="
echo ""

# Check for Node.js
if ! command -v node &> /dev/null; then
    echo "❌ Node.js is not installed. Please install Node.js 18+ first."
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
# Python virtual environment + Whisper
# ---------------------------------------------------------------------------
echo "🐍 Setting up Python virtual environment..."
if [ ! -d ".venv" ]; then
    python3 -m venv .venv
    echo "✓ Created .venv"
else
    echo "✓ .venv already exists"
fi

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
# Configure .env
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
bash scripts/test-setup.sh || true

echo ""
echo "✅ Setup complete!"
echo ""
echo "To start the app:"
echo "  npm run dev    (or: bun dev)"
echo ""
echo "Then open: http://localhost:19720"
