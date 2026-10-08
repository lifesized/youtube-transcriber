#!/bin/bash
# Zip the stapled signed app and write latest-mac.yml + blockmap + SHA256SUMS
# for electron-updater's GitHub Releases feed. Output stays under
# dist-electron/signed/ so the unsigned Transcriber-macOS-arm64 glob is
# unchanged.
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
YML="$OUT_DIR/latest-mac.yml"
SUMS="$OUT_DIR/SHA256SUMS"

[ -d "$APP" ] || { echo "update-artifacts: missing $APP"; exit 1; }
mkdir -p "$OUT_DIR"

echo "update-artifacts: zip $ZIP_NAME"
rm -f "$ZIP"
ditto -c -k --keepParent "$APP" "$ZIP"

BLOCKMAP=""
APP_BUILDER=""
if [ -x "$ROOT/node_modules/app-builder-bin/mac/app-builder" ]; then
  APP_BUILDER="$ROOT/node_modules/app-builder-bin/mac/app-builder"
elif [ -x "$ROOT/node_modules/app-builder-bin/linux/x64/app-builder" ]; then
  APP_BUILDER="$ROOT/node_modules/app-builder-bin/linux/x64/app-builder"
fi
if [ -n "$APP_BUILDER" ]; then
  "$APP_BUILDER" blockmap --input "$ZIP" --output "$ZIP.blockmap"
  BLOCKMAP="$ZIP.blockmap"
fi

ZIP="$ZIP" YML="$YML" VERSION="$VERSION" ZIP_NAME="$ZIP_NAME" node --input-type=module <<'NODE'
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

const zip = process.env.ZIP;
const yml = process.env.YML;
const version = process.env.VERSION;
const zipName = process.env.ZIP_NAME;
const buf = fs.readFileSync(zip);
const sha512 = crypto.createHash("sha512").update(buf).digest("base64");
const size = buf.length;
const releaseDate = new Date().toISOString();
const lines = [
  `version: ${version}`,
  "files:",
  `  - url: ${zipName}`,
  `    sha512: ${sha512}`,
  `    size: ${size}`,
  `path: ${zipName}`,
  `sha512: ${sha512}`,
  `releaseDate: '${releaseDate}'`,
  "",
];
fs.writeFileSync(yml, lines.join("\n"));
console.log("update-artifacts: wrote", path.basename(yml));
NODE

{
  (cd "$OUT_DIR" && shasum -a 256 "$(basename "$ZIP")" "$(basename "$YML")")
  if [ -f "$DMG" ]; then
    (cd "$(dirname "$DMG")" && shasum -a 256 "$(basename "$DMG")")
  fi
  if [ -n "$BLOCKMAP" ] && [ -f "$BLOCKMAP" ]; then
    (cd "$OUT_DIR" && shasum -a 256 "$(basename "$BLOCKMAP")")
  fi
} > "$SUMS"

echo "update-artifacts: wrote $SUMS"
cat "$SUMS"
