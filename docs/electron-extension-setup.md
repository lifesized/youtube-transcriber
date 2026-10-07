# Electron App — Extension ID Setup

**For beta testers only.** This doc explains how to configure the Electron app to connect to your Chrome extension.

---

## Problem

The Electron app's native messaging host needs to know which Chrome extensions are allowed to connect. Chrome identifies extensions by a 32-character ID.

**You have two extension IDs to support:**

1. **Unpacked dev extension** — Your local `extension/` folder loaded via `chrome://extensions` → Load unpacked
2. **Chrome Web Store extension** (when available) — The unlisted Web Store listing James creates

Each has a different ID. The native host manifest must list all allowed IDs.

---

## Solution: User Config File

Create a JSON file at:

```
~/Library/Application Support/Transcriber/extension-ids.json
```

**Format** (array of extension IDs):

```json
["abcdefghijklmnopqrstuvwxyz123456"]
```

**Example with multiple IDs**:

```json
[
  "abcdefghijklmnopqrstuvwxyz123456",
  "zyxwvutsrqponmlkjihgfedcba654321"
]
```

---

## Finding Your Extension ID

### Unpacked Extension (Local Dev)

1. Open Chrome
2. Go to `chrome://extensions`
3. Enable **Developer mode** (toggle, top-right)
4. Find **Transcriber for YouTube**
5. Copy the **ID** shown below the extension name (32 lowercase letters)

### Web Store Extension

Once James uploads the unlisted listing, the ID will be visible in the Web Store URL:

```
https://chrome.google.com/webstore/detail/YOUR_EXTENSION_ID_HERE
```

Or in the installed extension's details at `chrome://extensions`.

---

## Setup Flow

### First-Time Beta Install

1. **Download and install** Electron DMG
2. **Open app** → tray icon appears
3. **Create config file**:
   ```bash
   mkdir -p ~/Library/Application\ Support/Transcriber
   echo '["YOUR_EXTENSION_ID"]' > ~/Library/Application\ Support/Transcriber/extension-ids.json
   ```
4. **Install native host**: Tray menu → "Reinstall Browser Connection"
5. **Install extension** (Chrome Web Store unlisted link from James)
6. **Test**: Open YouTube, click extension → transcribe a video

### Adding Dev Extension

If you already have the Web Store extension and want to add your unpacked dev extension:

1. Get your dev extension ID from `chrome://extensions`
2. **Edit** `~/Library/Application Support/Transcriber/extension-ids.json`:
   ```json
   [
     "webstore-extension-id-here",
     "dev-extension-id-here"
   ]
   ```
3. **Reinstall manifests**: Tray menu → "Reinstall Browser Connection"
4. **Reload dev extension** in `chrome://extensions`

---

## Verification

After reinstalling:

1. Check the native host manifest was written:
   ```bash
   cat ~/Library/Application\ Support/Google/Chrome/NativeMessagingHosts/com.transcribed.host.json
   ```

2. Look for `"allowed_origins"` — should list `chrome-extension://YOUR_ID/` for each ID in your config.

3. **Test**: Extension should connect to the app and transcribe videos.

---

## Troubleshooting

### "No extension IDs configured" error

**Symptom**: Tray menu → "Reinstall Browser Connection" → error popup

**Cause**: Config file missing or invalid

**Fix**:
```bash
echo '["YOUR_EXTENSION_ID_HERE"]' > ~/Library/Application\ Support/Transcriber/extension-ids.json
```

Then retry "Reinstall Browser Connection".

### Extension can't connect

**Symptom**: Extension shows "Server not running" or connection errors

**Causes**:
1. Extension ID not in manifest
2. Native host manifest not installed
3. App not running

**Fix**:
1. Verify config file has correct ID
2. Reinstall manifests via tray menu
3. Check app is running (tray icon visible)
4. Reload extension in `chrome://extensions`

---

## Future: Auto-Discovery

In production builds, we'll auto-detect the Web Store ID so users don't need manual config. Beta requires manual setup since:
- Extension isn't published yet
- Dev IDs vary per machine
- No Chrome API to list installed extension IDs from native host

---

## Extension IDs (Reference)

**To be filled in once available:**

- **Chrome Web Store (unlisted)**: `<pending James upload>`
- **Local dev**: Varies per machine (find via `chrome://extensions`)
