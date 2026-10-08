# Transcriber Beta — macOS

Unsigned friends build. Apple Silicon (M1+) only.

## Install (use the helper)

1. Download the DMG and double-click it.
2. Double-click **Install Transcriber.command**.
3. The helper itself is quarantined the first time (the app would show as “damaged” with no Open Anyway). Right-click the helper → **Open**, or System Settings → Privacy & Security → **Open Anyway**, once.
4. It quits an older Transcriber if needed, copies `Transcriber.app` to `/Applications`, runs `xattr -dr com.apple.quarantine` on that copy, and opens it.
5. Look for Transcriber in the menu bar (top right). Eject the disk image.

Do not open Transcriber from the DMG.

## Fallback

Drag Transcriber to Applications, then paste this in Terminal:

```bash
xattr -dr com.apple.quarantine /Applications/Transcriber.app
open /Applications/Transcriber.app
```

## After it launches

Menu bar icon → **Open Transcriber** (`http://127.0.0.1:19720`).

Chrome extension: install the unlisted Web Store link, then menu bar → **Connect browser extension…** (or **Reinstall Browser Connection**). On a YouTube tab the side panel should show the server as running.

This beta uses YouTube captions. Whisper is optional if you already have Python + Whisper.

## Update

Quit Transcriber, download the new DMG, run the helper again. History stays in `~/Library/Application Support/Transcriber/`.

## Troubleshooting

**“Transcriber.app is damaged and can’t be opened”** — you opened the app instead of the helper, or skipped `xattr`. Run the helper, or the fallback command above.

**Port 19720 in use** — quit another Transcriber / `next dev`, then reopen.

**Extension says server offline** — confirm the menu bar app is running, then **Reinstall Browser Connection**.

## Uninstall

Quit Transcriber, delete `/Applications/Transcriber.app`. Optional:

```bash
rm -rf ~/Library/Application\ Support/Transcriber
rm -rf ~/Library/Logs/Transcriber
```

## Support

Slack DM James, or james@transcribed.com. Include macOS version, Transcriber version, the error, and `~/Library/Logs/Transcriber/native-host.log`.
