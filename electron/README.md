# Electron App Structure

This directory contains the Electron main process code for the Transcriber macOS menu-bar app.

## Files

- **main.js** — Entry point, sets up single-instance lock, power blocker, and coordinates managers
- **server-manager.js** — Manages Next.js standalone server lifecycle (spawn, health check, restart)
- **tray-manager.js** — Manages the menu bar tray icon and menu
- **native-host-installer.js** — Installs Chrome native messaging host manifests (P1)
- **utils.js** — Helper functions (translocation detection, etc.)
- **entitlements.mac.plist** — macOS entitlements for ad-hoc signing
- **after-pack.js** — electron-builder hook: rebuilds native modules, ad-hoc signs binaries
- **after-sign.js** — electron-builder hook: placeholder for future notarization

## Resources

- **resources/** — Assets for the app
  - **tray-icon-Template.png** — Menu bar icon (16x16, monochrome) — PLACEHOLDER
  - **icon.icns** — App icon (1024x1024) — PLACEHOLDER
  - **bin/** — Bundled binaries (ffmpeg, yt-dlp) downloaded by CI

## Development

```bash
# Run in development mode (uses npm run dev for Next.js)
npm run electron:dev

# Build for production (requires macOS for DMG)
npm run build              # Build Next.js standalone
npm run electron:build     # Build Electron DMG

# Test structure
npm run test:electron
```

## Key Technical Decisions

1. **No separate Node binary** — Uses Electron's own Node with `ELECTRON_RUN_AS_NODE=1`
2. **Native modules rebuilt** — better-sqlite3 rebuilt for Electron ABI in after-pack.js
3. **Unsigned, ad-hoc signed** — For friends beta; signed builds (Phase S) later
4. **macOS arm64 only** — Universal binary if needed based on beta feedback

## TODO Before First Build

1. Replace placeholder icons (tray-icon-Template.png, icon.icns)
2. Update extension ID in native-host-installer.js (replace placeholder)
3. Test end-to-end on macOS
