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

# Install Node dependencies
echo "📦 Installing Node dependencies..."
if command -v bun &> /dev/null; then
    bun install
else
    npm install
fi
echo ""

# Set up Python virtual environment
echo "🐍 Setting up Python virtual environment..."
if [ ! -d ".venv" ]; then
    python3 -m venv .venv
    echo "✓ Created .venv"
else
    echo "✓ .venv already exists"
fi

# Activate venv and install Whisper
echo "📥 Installing Whisper..."
source .venv/bin/activate
pip install --upgrade pip
pip install openai-whisper

# Install MLX Whisper if on Apple Silicon
if [[ $(uname -m) == "arm64" ]] && [[ $(uname) == "Darwin" ]]; then
    echo "🍎 Detected Apple Silicon - installing MLX Whisper for faster transcription..."
    pip install mlx-whisper
fi

# Install pyannote.audio for speaker diarization (optional)
echo "🔊 Installing pyannote.audio for speaker diarization..."
pip install pyannote.audio || echo "⚠️  pyannote.audio install failed (speaker diarization will be unavailable)"

echo ""
echo "📝 Configuring environment..."

# Create .env if it doesn't exist
if [ ! -f ".env" ]; then
    cp .env.example .env

    # Get absolute paths
    VENV_PATH=$(pwd)/.venv

    # Update .env with actual paths
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
echo "🔍 Checking system dependencies..."

# Check for yt-dlp
if command -v yt-dlp &> /dev/null; then
    echo "✓ yt-dlp found"
else
    echo "⚠️  yt-dlp not found"
    if [[ "$OSTYPE" == "darwin"* ]]; then
        echo "   Install with: brew install yt-dlp"
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        echo "   Install with your package manager (apt/dnf/pacman)"
    fi
fi

# Check for ffmpeg
if command -v ffmpeg &> /dev/null; then
    echo "✓ ffmpeg found"
else
    echo "⚠️  ffmpeg not found"
    if [[ "$OSTYPE" == "darwin"* ]]; then
        echo "   Install with: brew install ffmpeg"
    elif [[ "$OSTYPE" == "linux-gnu"* ]]; then
        echo "   Install with your package manager (apt/dnf/pacman)"
    fi
fi

echo ""
echo "✅ Setup complete!"
echo ""
echo "To start the app:"
echo "  npm run dev    (or: bun dev)"
echo ""
echo "Then open: http://localhost:19720"
