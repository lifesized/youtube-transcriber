# Transcriber Beta — macOS

Unsigned friends build. Apple Silicon (M1+) only.

## Install (use the helper)

1. Download the DMG. In Terminal, check it against the SHA-256 James sent separately from the download link (not in the same message or page as the file):

```bash
shasum -a 256 <dmg>
```

The hashes must match. If they do not, stop and tell James.

2. Double-click the DMG, then double-click **Install Transcriber.command**.
3. The helper itself is quarantined the first time (the app would show as “damaged” with no Open Anyway). Open **System Settings → Privacy & Security → Open Anyway**, once. (macOS 15 removed right-click → Open for this case.)
4. It quits an older Transcriber if needed, copies `Transcriber.app` to `/Applications`, runs `xattr -dr com.apple.quarantine` on that copy, and opens it.
5. Look for Transcriber in the menu bar (top right). Eject the disk image.

Only run this from the DMG James sent; it turns off macOS's download check for this app.

Do not open Transcriber from the DMG.

## Fallback

Drag Transcriber to Applications, then paste this in Terminal:

```bash
xattr -dr com.apple.quarantine /Applications/Transcriber.app
open /Applications/Transcriber.app
```

## After it launches

Menu bar icon → **Open Transcriber** (`http://127.0.0.1:19721`). This beta uses 19721 so it can run beside `npm run dev` on 19720.

Chrome extension: install the unlisted Web Store link, then menu bar → **Connect browser extension…** (or **Reinstall Browser Connection**). On a YouTube tab the side panel should show the server as running.

This beta uses YouTube captions. Whisper is optional if you already have Python + Whisper.

## Update

Quit Transcriber, download the new DMG, run the helper again. The packaged app stores its library in `~/Library/Application Support/Transcriber App/`. A checkout's `npm run dev` still uses `~/Library/Application Support/Transcriber/`. Import stays manual.

## Troubleshooting

**“Transcriber.app is damaged and can’t be opened”** — you opened the app instead of the helper, or skipped `xattr`. Run the helper, or the fallback command above.

**Port 19721 in use** — quit another copy of the packaged app, then reopen. `npm run dev` on 19720 is expected and does not block this beta.

**Extension says server offline** — confirm the menu bar app is running, then **Reinstall Browser Connection**.

## Uninstall

Quit Transcriber, delete `/Applications/Transcriber.app`. Optional:

```bash
rm -rf ~/Library/Application\ Support/Transcriber\ App
rm -rf ~/Library/Logs/Transcriber
```

## Support

Slack DM James, or james@transcribed.com. Include macOS version, Transcriber version, the error, and `~/Library/Logs/Transcriber/native-host.log`.
