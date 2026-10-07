# YouTube Transcriber

[![License: AGPL v3](https://img.shields.io/badge/License-AGPL_v3-blue.svg)](https://www.gnu.org/licenses/agpl-3.0)

**YouTube & Spotify podcast to LLM-ready transcript in one click. Runs locally, costs nothing.**


https://github.com/user-attachments/assets/32491284-5c78-4a74-a580-ff3a8c256243




**Don't want to install anything?** A hosted version is coming soon — no setup required. **[Join the waitlist →](https://waitlist-site-alpha.vercel.app)**

## Get Running in 60 Seconds

```bash
git clone https://github.com/lifesized/youtube-transcriber.git
cd youtube-transcriber
npm run setup
npm run dev
```

Open [http://localhost:19720](http://localhost:19720) — paste a YouTube or Spotify podcast URL, hit Transcribe, done.

> **Mac/Linux only for auto-setup.** Windows: use WSL or follow the [Manual Installation](#manual-installation) section.

> `npm run setup` installs all dependencies (yt-dlp, ffmpeg, Whisper, MLX on Apple Silicon) and configures everything automatically. Requires Node.js 20.19+, 22.12+, or 24+, Python 3.8+, and a package manager (Homebrew / apt / dnf / pacman).

## Chrome Extension
<img width="375" height="565" alt="CleanShot 2026-03-17 at 22 53 31@2x" src="https://github.com/user-attachments/assets/d4bccf92-9941-46cc-b4f4-b7bbc3454ff7" />


https://github.com/user-attachments/assets/081c8d90-a6e1-4b4d-b6cd-bc8787bc0a3b


Send the page you are on to Transcriber. Two variants:

- **LOCAL** — sends to `http://127.0.0.1:19720` on this computer (self-hosted)
- **ENTERPRISE** — sends to your organization's hosted Transcriber instance

The extension opens a side panel with one action: **Send this page**. It does not store API keys or auth tokens, and it does not put secrets in URLs.

### LOCAL (Self-Hosted)

**Install from Chrome Web Store:**

> **Note:** The extension is not yet on the Chrome Web Store. Install it manually while we go through the review process.

**Install from source:**

1. Build the LOCAL extension:
   ```bash
   npm run build:ext
   ```

2. Make sure the local service is running (`npm run dev`)

3. Open Chrome and go to `chrome://extensions`

4. Enable **Developer mode** (toggle, top right)

5. Click **Load unpacked** and select `extension/dist/`

6. Click the Transcriber icon in your toolbar to open the side panel

7. On a video or podcast page, click **Send this page**

The panel authenticates via the native host and sends the page URL to `http://127.0.0.1:19720/api/transcripts`. **After building the extension or on a fresh checkout**, install the native host:

```bash
npm run install-native-host -- --ext-id=YOUR_EXTENSION_ID
```

Find your extension ID at `chrome://extensions` (32-character string under the extension name when Developer mode is enabled).

Open `http://127.0.0.1:19720` to read the transcript.

### ENTERPRISE (Org-Hosted)

**For IT Admins:**

Build the ENTERPRISE extension with your organization's Transcriber base URL:

```bash
npm run build:ext:enterprise -- --base-url https://transcriber.corp.example.com
```

Or use the environment variable:

```bash
ENTERPRISE_BASE_URL=https://transcriber.corp.example.com npm run build:ext:enterprise
```

This produces `extension/dist-enterprise/` with:
- No native messaging or loopback logic
- Hard-coded org URL in `host_permissions` and send endpoint
- SSO/cookie-based auth (placeholder — integrate with your org IdP)

Deploy via MDM force-install or private Chrome Web Store listing. See [docs/EXTENSION-PACKAGING.md](./docs/EXTENSION-PACKAGING.md) for packaging details.

---

## Use with Claude Code, Claude Desktop & Cursor

Three ways to use this with AI assistants — pick the one that fits:

### MCP Server (recommended)

The MCP server gives you tools like `transcribe_and_summarize` directly in your AI client. Requires the service running (`npm run dev`).

**Claude Code** — already configured. Clone the repo and the `.claude/mcp.json` is included:

```bash
git clone https://github.com/lifesized/youtube-transcriber.git
cd youtube-transcriber
npm run setup && npm run dev
# Open in Claude Code — MCP tools are ready to use
```

**Claude Desktop / Cursor** — run `npm run mcp:config` and add the output to your client config ([full setup guide](./docs/MCP.md)):

| Client | Config file |
|--------|-------------|
| Claude Desktop | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| Cursor | `.cursor/mcp.json` |

### Skill (no server needed)



https://github.com/user-attachments/assets/73a62192-746c-4ec0-b1d5-b46608441bdd



Install as a Claude Code or OpenClaw skill. Two flavors: **Lite** (zero setup, just `yt-dlp`, YouTube subtitles only) or **Full** (requires the service running, adds Whisper fallback, diarization, and persistent library).

```bash
# Lite skill (yt-dlp only, no server)
cp contrib/claude-code/SKILL-lite.md ~/.claude/skills/youtube-transcriber/SKILL.md

# Full skill (requires service running)
cp -r contrib/claude-code ~/.claude/skills/youtube-transcriber
```

| | Lite Skill | Full Skill / MCP |
|--|:---:|:----:|
| YouTube captions | Yes | Yes |
| Auto-generated subs | Yes | Yes |
| Whisper transcription | — | Yes |
| Speaker diarization | — | Yes |
| Persistent library | — | Yes |
| Requires server | No | Yes |

### Triggers

Once set up (MCP or skill), just type naturally:

> *"summarize https://youtube.com/watch?v=..."*
> *"ts https://youtube.com/watch?v=..."* (transcribe + summarize)
> *"t https://youtube.com/watch?v=..."* (transcript only)

Or just paste a YouTube URL — it auto-activates.

---

## How It Works

Paste a URL. The app grabs the transcript using the fastest method available on your system:

**YouTube:**
1. **YouTube Captions** — fetches official captions when they exist (< 5 sec)
2. **Cloud Whisper** — optional Groq, OpenRouter, or custom API with your own key (10-30 sec for 10 min)
3. **MLX Whisper** — local GPU transcription on Apple Silicon (30-60 sec for 10 min)
4. **OpenAI Whisper** — local CPU fallback that works everywhere (2-5 min for 10 min)

**Spotify Podcasts:**
1. Fetches episode metadata from Spotify's official API
2. Discovers the podcast's public RSS feed via iTunes
3. Downloads full episode audio from the podcast CDN
4. Transcribes via Cloud Whisper or local Whisper

> Spotify support requires `SPOTIFY_CLIENT_ID` and `SPOTIFY_CLIENT_SECRET` in `.env` (free from [developer.spotify.com](https://developer.spotify.com/dashboard)). Spotify-exclusive podcasts without a public RSS feed are not supported.

Works fully offline by default for YouTube. Cloud Whisper is optional — bring your own API key to enable it.

## Features

- **YouTube + Spotify** — paste a YouTube video URL or Spotify podcast episode URL
- **Local + cloud transcription** — free local Whisper by default, optional cloud providers (Groq, OpenRouter, or custom endpoint) for faster results with your own API key
- **Chrome extension** — one-tap send of the current page URL to the local app (no keys in extension storage or URLs)
- **Multi-language captions** — request captions in any language YouTube supports (see [Language Preference](#language-preference) below)
- **Summarize with LLM** — built-in summarize uses a server-held OpenRouter key (Settings / `OPENROUTER_API_KEY`); no pasted API keys. You can still open a transcript in ChatGPT or Claude via clipboard handoff
- **Queue system** — batch-process multiple videos
- **Search & filter** your transcript library
- **Export as Markdown** or copy to clipboard with timestamps
- **Duplicate detection** — same video won't be saved twice
- **Speaker diarization** — optional speaker identification with pyannote.audio
- **SQLite storage** — all data stays on your machine
- **Fully offline-capable** after initial setup

Full REST API docs: [`docs/API.md`](./docs/API.md) | OpenAPI spec: [`docs/openapi.yaml`](./docs/openapi.yaml)

## Cloud Transcription Providers
<img width="1824" height="1175" alt="CleanShot 2026-03-17 at 22 50 27" src="https://github.com/user-attachments/assets/4a413c9b-965c-44d0-a264-2b1ae9ed12d5" />

Add one or more cloud providers in **Settings** (gear icon, bottom-left). Keys are encrypted at rest — set `TRANSCRIBER_SECRETS_KEY` in `.env` first (see [Encrypting provider keys at rest](#encrypting-provider-keys-at-rest)). Drag to reorder priority — the app tries each enabled provider in order, then falls back to local Whisper.

### Groq (Free)

The fastest option — uses Groq's free Whisper API. No credit card required.

1. Sign up at [console.groq.com](https://console.groq.com)
2. Go to **API Keys** → **Create API Key**
3. Paste the key in Settings

**Free tier limits:** 14,400 audio-seconds per day (~4 hours). The Settings page shows a usage meter so you can track your quota.

### OpenRouter

Access dozens of transcription models through a single API key, including Gemini 2.5 Flash.

1. Sign up at [openrouter.ai/keys](https://openrouter.ai/keys)
2. Create an API key
3. Paste the key in Settings — pick your model from the dropdown

### Custom Endpoint

Point to any OpenAI-compatible transcription API by providing a base URL, API key, and model name.

## Language Preference

By default, the app fetches English captions. You can change this per-request or globally.

**Per-request** — pass `lang` in the API body:
```bash
TOKEN=$(cat "$HOME/Library/Application Support/Transcriber/local-api.token")  # see Local API auth
curl -X POST http://127.0.0.1:19720/api/transcripts \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://youtube.com/watch?v=...", "lang": "es"}'
```

**Multi-language priority** — tries each language in order, falls back to first available:
```bash
-d '{"url": "...", "lang": "ja,en"}'   # Japanese preferred, English fallback
```

**Global default** — set in `.env`:
```env
YTT_CAPTION_LANGS="zh-Hans,zh-Hant,en"
```

The MCP tools (`transcribe`, `transcribe_and_summarize`) also accept an optional `lang` parameter.

---

## Manual Installation

If the automated setup doesn't work or you prefer to do it yourself:

<details>
<summary>Expand manual steps</summary>

```bash
git clone https://github.com/lifesized/youtube-transcriber.git
cd youtube-transcriber

# Install Node dependencies
npm install

# Set up Python virtual environment
python3 -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate

# Install Whisper
pip install openai-whisper

# Optional: MLX Whisper for Apple Silicon
pip install mlx-whisper

# Configure environment
cp .env.example .env
# Edit .env with your paths
```

**Environment variables (`.env`):**

```env
DATABASE_URL="file:./dev.db"
WHISPER_CLI="/path/to/your/.venv/bin/whisper"
WHISPER_PYTHON_BIN="/path/to/your/.venv/bin/python3"

# Optional — local Whisper
# WHISPER_BACKEND="auto"    # auto, mlx, or openai
# WHISPER_DEVICE="auto"     # auto, cpu, mps
# WHISPER_TIMEOUT_MS="480000"

# Optional — cloud providers are configured in Settings (UI)
# Legacy env var still works for a single Groq key:
# WHISPER_CLOUD_API_KEY="gsk_..."
```

**Windows paths:**
```env
WHISPER_CLI="C:\\Users\\YourName\\project\\.venv\\Scripts\\whisper.exe"
WHISPER_PYTHON_BIN="C:\\Users\\YourName\\project\\.venv\\Scripts\\python.exe"
```

</details>

## Verifying Your Setup

After setup, verify everything is wired up correctly:

```bash
npm run test:setup
```

This checks Node.js, Python, ffmpeg, yt-dlp, Whisper, the native SQLite driver, database, and environment configuration. Each check prints pass/fail with actionable fix messages. It runs automatically at the end of `npm run setup`, and setup stops instead of reporting success if a required check fails.

For a running instance, hit the health endpoint (requires the local loopback token — YTT-435):

```bash
# Without a token → 401 {"error":"unauthorized"}
curl -s -o /dev/null -w "%{http_code}\n" http://127.0.0.1:19720/api/health

# With Bearer token (macOS example path):
TOKEN=$(cat "$HOME/Library/Application Support/Transcriber/local-api.token")
curl -s -H "Authorization: Bearer $TOKEN" http://127.0.0.1:19720/api/health
```

Returns JSON with per-check pass/fail — useful for Docker health checks or debugging. See [docs/TESTING.md](./docs/TESTING.md) for the full test protocol.

### Local API auth (self-hosted)

All `/api/*` routes require a Bearer token (or the httpOnly cookie set when you open the web UI in a browser). The token file is created on first run:

| OS | Path |
|----|------|
| macOS | `~/Library/Application Support/Transcriber/local-api.token` |
| Linux | `~/.config/transcriber/local-api.token` |
| Windows | `%APPDATA%/Transcriber/local-api.token` |

Override with `TRANSCRIBER_LOCAL_TOKEN`. Rotate by deleting the file (or setting a new env value) and restarting. The extension obtains the token via the native host (`getLocalToken`); MCP reads the same file and does not call the API without it. `delete_transcript` requires `confirm: true`. Never commit the token; never put it in URLs or `chrome.storage`.

### Encrypting provider keys at rest

Cloud provider API keys saved in Settings (OpenRouter, Groq, custom) and the legacy `groq_api_key` setting are encrypted in SQLite with AES-256-GCM. Set a master key in `.env`:

```bash
openssl rand -hex 32
# → add to .env:
# TRANSCRIBER_SECRETS_KEY=<that hex value>
```

Restart the server (or run `npm run migrate:secrets`) so existing plaintext rows are re-encrypted. Plaintext database secrets are not used: a provider or `groq_api_key` row is usable only as ciphertext together with this master key. If plaintext rows are still present and the master key is missing, the server logs a warning at boot and refuses those keys. New keys cannot be saved until this is set. Decrypt happens only in the server process when calling providers; the web UI continues to show masked keys only. Keep `TRANSCRIBER_SECRETS_KEY` out of git — losing it makes ciphertext unrecoverable (re-enter keys in Settings after rotating).

Env-only alternatives (`OPENROUTER_API_KEY`, `WHISPER_CLOUD_API_KEY`) are not written to the database and do not need this master key.

## Troubleshooting

<details>
<summary>"spawn whisper ENOENT" error</summary>

- Check that `WHISPER_CLI` and `WHISPER_PYTHON_BIN` paths in `.env` are correct
- Use absolute paths, not relative paths
- Restart the dev server after updating `.env`
</details>

<details>
<summary>Slow transcription</summary>

- Enable cloud Whisper for the fastest option: set `WHISPER_CLOUD_API_KEY` in `.env` (Groq free tier available)
- On Apple Silicon, install `mlx-whisper` for 3-5x local speedup
- Use smaller Whisper models (`tiny`, `base`) for faster local results
- Set `WHISPER_BACKEND="mlx"` in `.env` to force MLX
</details>

<details>
<summary>Rate limiting / bot detection</summary>

- The app automatically tries multiple InnerTube clients
- Wait a few minutes and retry if YouTube blocks requests
- Disable VPN if you're getting consistent 403 errors
</details>

## Contributing

Contributions welcome — feel free to submit issues or pull requests.

If this saves you time, a ⭐ on GitHub helps others find it.

## License

[GNU Affero General Public License v3.0](LICENSE)

## Credits

Designed and built by [lifesized](https://github.com/lifesized).

**Built with:** [Intent by Augment](https://www.augmentcode.com/intent), [Cursor](https://cursor.sh), [Codex](https://openai.com/index/openai-codex/), [Claude Code](https://github.com/anthropics/claude-code), and [Ghostty](https://ghostty.org).
