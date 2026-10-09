#!/bin/bash
# Zip the stapled signed app and write the channel yml files + SHA256SUMS
# for electron-updater's GitHub Releases feed. Output stays under
# dist-electron/signed/ so the unsigned Transcriber-macOS-arm64 glob is
# unchanged. The app requests beta-mac.yml (channel=beta on darwin);
# latest-mac.yml is the allowPrerelease 404 fallback.
#
#   macos-update-artifacts.sh [signed.app] [signed.dmg]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
APP="${1:-$ROOT/dist-electron/signed/Transcriber.app}"
DMG="${2:-$ROOT/dist-electron/signed/Transcriber-signed.dmg}"
OUT_DIR="$ROOT/dist-electron/signed"
VERSION="$(node -p "require('$ROOT/package.json').version")"
ZIP_NAME="Transcriber-${VERSION}-arm64-mac.zip"
ZIP="$OUT_DIR/$ZIP_NAME"
SUMS="$OUT_DIR/SHA256SUMS"
eval "$(node -p '
  const f = require(process.argv[1]);
  [
    "CHANNEL_YML=" + JSON.stringify(f.UPDATE_CHANNEL_FILE),
    "FALLBACK_YML=" + JSON.stringify(f.FALLBACK_CHANNEL_FILE),
  ].join("\n")
' "$ROOT/electron/update-feed.js")"
YML="$OUT_DIR/$FALLBACK_YML"
BETA_YML="$OUT_DIR/$CHANNEL_YML"

[ -d "$APP" ] || { echo "update-artifacts: missing $APP"; exit 1; }
mkdir -p "$OUT_DIR"

echo "update-artifacts: zip $ZIP_NAME"
rm -f "$ZIP"
ditto -c -k --keepParent "$APP" "$ZIP"

# No app-builder-bin. The zip is a full download; hdiutil/codesign handle the DMG.
BLOCKMAP=""

ZIP="$ZIP" YML="$YML" BETA_YML="$BETA_YML" VERSION="$VERSION" ZIP_NAME="$ZIP_NAME" \
FEED="$ROOT/electron/update-feed.js" node --input-type=module <<'NODE'
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const { renderUpdateYml } = require(process.env.FEED);

const zip = process.env.ZIP;
const yml = process.env.YML;
const betaYml = process.env.BETA_YML;
const buf = fs.readFileSync(zip);
const body = renderUpdateYml({
  version: process.env.VERSION,
  zipName: process.env.ZIP_NAME,
  sha512: crypto.createHash("sha512").update(buf).digest("base64"),
  size: buf.length,
  releaseDate: new Date().toISOString(),
});
fs.writeFileSync(yml, body);
fs.writeFileSync(betaYml, body);
console.log("update-artifacts: wrote", path.basename(yml), "and", path.basename(betaYml));
NODE

{
  (cd "$OUT_DIR" && shasum -a 256 "$(basename "$ZIP")" "$(basename "$YML")" "$(basename "$BETA_YML")")
  if [ -f "$DMG" ]; then
    (cd "$(dirname "$DMG")" && shasum -a 256 "$(basename "$DMG")")
  fi
  if [ -n "$BLOCKMAP" ] && [ -f "$BLOCKMAP" ]; then
    (cd "$OUT_DIR" && shasum -a 256 "$(basename "$BLOCKMAP")")
  fi
} > "$SUMS"

echo "update-artifacts: wrote $SUMS"
cat "$SUMS"
