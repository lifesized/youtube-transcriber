#!/bin/bash
# Sign a DMG with the Developer ID identity from the temporary keychain.
set -euo pipefail

DMG="${1:-}"
STATE_DIR="${RUNNER_TEMP:?RUNNER_TEMP is required}/transcriber-signing"
IDENTITY_PATH="$STATE_DIR/identity.txt"

[ -f "$DMG" ] || { echo "codesign-dmg: missing $DMG"; exit 1; }
[ -f "$IDENTITY_PATH" ] || { echo "codesign-dmg: run macos-signing-keychain.sh setup first"; exit 1; }
IDENTITY="$(cat "$IDENTITY_PATH")"
[ -n "$IDENTITY" ] || { echo "codesign-dmg: empty identity"; exit 1; }

echo "codesign-dmg: $DMG"
codesign --force --sign "$IDENTITY" --timestamp "$DMG"
codesign --verify --strict "$DMG"
echo "codesign-dmg: done"
