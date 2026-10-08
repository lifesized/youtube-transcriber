#!/bin/bash
# Inside-out Developer ID sign of a Transcriber.app copy.
# Fuses must already be flipped (afterPack). This is the last mutator of
# the signed copy. Does not touch dist-electron/mac-arm64 (the ad-hoc app).
#
#   macos-codesign-app.sh [src.app] [dest.app]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="${1:-$ROOT/dist-electron/mac-arm64/Transcriber.app}"
DEST="${2:-$ROOT/dist-electron/signed/Transcriber.app}"
STATE_DIR="${RUNNER_TEMP:?RUNNER_TEMP is required}/transcriber-signing"
IDENTITY_PATH="$STATE_DIR/identity.txt"
ENTITLEMENTS="$ROOT/electron/entitlements.mac.sign.plist"

[ -d "$SRC" ] || { echo "codesign: missing $SRC"; exit 1; }
[ -f "$ENTITLEMENTS" ] || { echo "codesign: missing $ENTITLEMENTS"; exit 1; }
[ -f "$IDENTITY_PATH" ] || { echo "codesign: run macos-signing-keychain.sh setup first"; exit 1; }
[ -n "${APPLE_TEAM_ID:-}" ] || { echo "codesign: APPLE_TEAM_ID is required"; exit 1; }

IDENTITY="$(cat "$IDENTITY_PATH")"
[ -n "$IDENTITY" ] || { echo "codesign: empty identity"; exit 1; }

echo "codesign: copying $SRC -> $DEST"
rm -rf "$DEST"
mkdir -p "$(dirname "$DEST")"
ditto "$SRC" "$DEST"

# Pin the expected team id into Resources before the seal. Ad-hoc builds
# never get this file, so the runtime updater gate stays off for them.
umask 077
printf '{"teamId":"%s"}\n' "$APPLE_TEAM_ID" > "$DEST/Contents/Resources/signing-identity.json"
chmod 644 "$DEST/Contents/Resources/signing-identity.json"

is_macho() {
  local f="$1"
  local desc
  desc="$(file -b "$f" 2>/dev/null || true)"
  case "$desc" in
    *Mach-O*) return 0 ;;
    *) return 1 ;;
  esac
}

# Deepest paths first so nested dylibs / helpers are sealed before parents.
collect_sign_targets() {
  local app="$1"
  find "$app" \( -type f -o -type d \) ! -path "$app" | python3 -c '
import os, sys
paths = [line.rstrip("\n") for line in sys.stdin if line.strip()]
paths.sort(key=lambda p: (p.count(os.sep), len(p)), reverse=True)
for p in paths:
    print(p)
'
}

sign_bin() {
  local path="$1"
  echo "  bin  $path"
  codesign --force --options runtime --timestamp --sign "$IDENTITY" "$path"
}

sign_app_or_helper() {
  local path="$1"
  echo "  app  $path"
  codesign --force --options runtime --timestamp \
    --entitlements "$ENTITLEMENTS" \
    --sign "$IDENTITY" "$path"
}

echo "codesign: inside-out Developer ID sign"
while IFS= read -r path; do
  [ -e "$path" ] || continue
  base="$(basename "$path")"
  case "$path" in
    *.app)
      sign_app_or_helper "$path"
      ;;
    *.framework)
      # Sign the versioned binary if present, then the bundle.
      if [ -f "$path/Electron Framework" ]; then
        sign_bin "$path/Electron Framework"
      fi
      if [ -f "$path/Versions/A/Electron Framework" ]; then
        sign_bin "$path/Versions/A/Electron Framework"
      fi
      echo "  fw   $path"
      codesign --force --options runtime --timestamp --sign "$IDENTITY" "$path"
      ;;
    *)
      if [ -f "$path" ] && is_macho "$path"; then
        sign_bin "$path"
      elif [ -f "$path" ]; then
        case "$base" in
          ffmpeg|yt-dlp|*.node|*.dylib|*.so)
            sign_bin "$path"
            ;;
        esac
      fi
      ;;
  esac
done < <(collect_sign_targets "$DEST")

echo "codesign: outer Transcriber.app"
sign_app_or_helper "$DEST"

echo "codesign: verify --deep --strict"
codesign --verify --deep --strict "$DEST"
codesign -dv --verbose=4 "$DEST" 2>&1 | grep -E '^(Identifier|Authority|TeamIdentifier|Signature)=' || true

echo "codesign: done $DEST"
