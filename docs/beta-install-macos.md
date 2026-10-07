# Transcriber Beta — macOS Installation Guide

**For friends & design partners only — unsigned macOS app (Oct 2026)**

---

## Prerequisites

- **macOS Monterey (12.0) or later** — ideally Ventura (13) or Sequoia (15)
- **Apple Silicon Mac** (M1/M2/M3/M4) — arm64 only for beta
- **Python 3.8+** — pre-installed on macOS 12+, check with `python3 --version`
- **2 GB free disk space** — app is ~250 MB, Whisper models download on first transcription (~150 MB for base model)

---

## Installation Steps

### 1. Download the DMG

Download `Transcriber-0.1.0-arm64.dmg` from the link provided by James.

### 2. Open the DMG

Double-click the downloaded DMG. A Finder window opens showing the Transcriber icon and an Applications folder shortcut.

### 3. **IMPORTANT: Drag to Applications BEFORE Opening**

**Drag Transcriber.app to the Applications folder.** Do not open it from the DMG first.

Why? macOS may "translocate" apps run from temporary locations (like mounted DMGs), which breaks the browser connection feature. Moving to Applications first prevents this.

### 4. Eject the DMG

Right-click the Transcriber volume in Finder's sidebar and select "Eject".

### 5. First Launch — Gatekeeper Block

Go to **Applications**, find **Transcriber.app**, and double-click it.

macOS will block the app with this message:

> "Transcriber.app" cannot be opened because it is from an unidentified developer.

**Do not click OK yet.** Instead:

1. Open **System Settings** (or System Preferences on older macOS)
2. Go to **Privacy & Security**
3. Scroll down to the **Security** section
4. You'll see: *"Transcriber was blocked from use because it is not from an identified developer."*
5. Click **"Open Anyway"**
6. A confirmation dialog appears — click **"Open"**

**Note for macOS Sequoia (15.x) users:** Right-click → Open no longer bypasses Gatekeeper on unsigned apps. You **must** use the System Settings flow above.

**NEVER run `xattr -dr com.apple.quarantine`** — this bypasses macOS security and is not recommended.

### 6. App Starts

Transcriber launches and its icon appears in the menu bar (top right, near the clock).

Click the icon to see the menu:

- **● Running** — server is up
- **Open Transcriber** — opens `http://127.0.0.1:19720` in your default browser
- **Start at Login** — toggle to launch Transcriber on login
- **Reinstall Browser Connection** — installs the native messaging host for Chrome/Brave/Arc/Edge (see step 7)
- **Quit Transcriber** — stops the server and quits

### 7. Install the Chrome Extension

1. **Install extension**: Open the Chrome Web Store link provided by James (unlisted listing).
2. Click "Add to Chrome" → "Add extension"
3. The extension icon appears in your toolbar (puzzle piece → pin it for easy access)
4. **Connect to Transcriber app**:
   - Click the Transcriber menu bar icon
   - Select **"Reinstall Browser Connection"**
   - This installs the native messaging host for Chrome, Brave, Arc, and Edge (whichever are installed)
5. **Test connection**:
   - Open a YouTube tab
   - Click the extension icon
   - The side panel should show "Server running" with a green dot
   - If it shows "Server offline", check the menu bar app — the server may be stopped

---

## First Transcription (Python Setup)

The first time you transcribe a video, Transcriber sets up a Python virtual environment in `~/Library/Application Support/Transcriber/.venv/` and installs Whisper.

This takes **~2 minutes** on fast internet, **~5 minutes** on slower connections.

You'll see a progress indicator. After this one-time setup, transcriptions are instant (aside from the actual transcription time).

**Whisper models** (~150 MB for base, ~3 GB for large) download on first use and are cached in `~/.cache/whisper/`.

---

## Usage

### Via Extension (Recommended)

1. Open a YouTube video
2. Click the Transcriber extension icon
3. The side panel opens — click **"Transcribe"**
4. Transcription appears below the video

### Via Web UI

1. Click the menu bar icon → **Open Transcriber**
2. Paste a YouTube URL
3. Click **"Transcribe"**

---

## Updating Transcriber

**No auto-update for beta.** When a new version is available, James will share a new DMG link.

To update:

1. **Quit Transcriber** (menu bar icon → Quit)
2. Download the new DMG
3. Open it and drag Transcriber to Applications (replace the old one)
4. Reopen Transcriber

Your transcription history and settings are preserved (stored in `~/Library/Application Support/Transcriber/`).

---

## Troubleshooting

### "Transcriber was damaged and can't be opened"

**Cause:** macOS Gatekeeper sometimes rejects unsigned arm64 apps.

**Fix:**

1. Delete Transcriber from Applications
2. Re-download the DMG (don't use a cached copy)
3. Open DMG, drag to Applications, then use System Settings → Privacy & Security → "Open Anyway" (step 5 above)

If this persists, contact James — we may need to move to signed builds sooner.

### Port 19720 in Use

**Cause:** Another Transcriber instance (like `npm run dev`) is already running on port 19720.

**Fix:**

1. Menu bar icon shows: **"✕ Port 19720 in use (dev server running?)"**
2. Stop the dev server: `pkill -f "next dev"`
3. Menu bar → **Quit Transcriber** → reopen it

### Extension Says "Server Offline"

**Cause:** The app isn't running, or the native host isn't installed.

**Fix:**

1. Check menu bar — is Transcriber running? If not, open Applications → Transcriber
2. If running but extension still can't connect:
   - Menu bar icon → **"Reinstall Browser Connection"**
   - Reload the extension at `chrome://extensions`

### Transcription Fails with "Whisper not found"

**Cause:** Python 3 isn't installed, or the venv setup failed.

**Fix:**

1. Check Python: `python3 --version` in Terminal (should be 3.8+)
2. If missing: install via [python.org](https://python.org) or Homebrew (`brew install python3`)
3. Quit and reopen Transcriber to retry venv setup

---

## Uninstall

1. **Quit Transcriber** (menu bar → Quit)
2. Delete `Transcriber.app` from Applications
3. **(Optional)** Remove app data:
   ```bash
   rm -rf ~/Library/Application\ Support/Transcriber
   rm -rf ~/Library/Logs/Transcriber
   rm ~/Library/Application\ Support/Google/Chrome/NativeMessagingHosts/com.transcribed.host.json
   ```
4. **(Optional)** Remove Whisper cache:
   ```bash
   rm -rf ~/.cache/whisper
   rm -rf ~/.cache/huggingface
   ```

---

## Known Limitations (Beta)

- **macOS only** — arm64 Apple Silicon Macs (M1+). Intel Macs not supported yet.
- **Unsigned app** — requires "Open Anyway" on first launch. Signed builds coming later.
- **No auto-update** — manual DMG updates for now.
- **No Windows/Linux** — desktop apps for other platforms TBD based on beta feedback.

---

## Support

For beta issues:

- **Slack**: DM James in the friends channel
- **Email**: <james@transcribed.com>

Include:

- macOS version (System Settings → General → About)
- Transcriber version (menu bar → About, or check DMG filename)
- Error message (screenshot or copy-paste)
- Logs: `~/Library/Logs/Transcriber/native-host.log`
