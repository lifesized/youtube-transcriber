#!/bin/bash
# Post-process a UDZO DMG so Install Transcriber.command keeps a Finder
# custom icon. electron-builder copies the helper as a data-fork-only file,
# which drops resource forks / FinderInfo. Convert to UDRW, attach, stamp,
# convert back to UDZO. The helper's data fork is not rewritten.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
HELPER_NAME="Install Transcriber.command"
DMG="${1:?usage: stamp-dmg-helper-icon.sh <dmg>}"

if [ ! -f "$DMG" ]; then
  echo "ERROR: DMG not found: $DMG" >&2
  exit 1
fi
if [ ! -x "$HERE/set-custom-icon.sh" ]; then
  echo "ERROR: missing $HERE/set-custom-icon.sh" >&2
  exit 1
fi

TMP="$(mktemp -d /tmp/stamp-dmg-XXXXXX)"
cleanup() {
  if [ -n "${MOUNT:-}" ]; then
    hdiutil detach "$MOUNT" >/dev/null 2>&1 || hdiutil detach -force "$MOUNT" >/dev/null 2>&1 || true
  fi
  rm -rf "$TMP"
}
trap cleanup EXIT

RW="$TMP/rw.dmg"
OUT="$TMP/out.dmg"

echo "Converting $(basename "$DMG") to UDRW..."
hdiutil convert "$DMG" -format UDRW -o "$RW"

# Leave slack so the ~1MB resource fork can be written.
LIMITS="$(hdiutil resize -limits "$RW" | awk 'NF>=3 { min=$1; cur=$2; max=$3 } END { print min, cur, max }')"
CUR="$(printf '%s\n' "$LIMITS" | awk '{print $2}')"
MAX="$(printf '%s\n' "$LIMITS" | awk '{print $3}')"
NEW=$((CUR + 40960))
if [ "$NEW" -gt "$MAX" ]; then
  NEW="$MAX"
fi
if [ "$NEW" -gt "$CUR" ]; then
  echo "Resizing UDRW $CUR -> $NEW sectors"
  hdiutil resize -sectors "$NEW" "$RW"
fi

echo "Attaching UDRW..."
ATTACH="$(hdiutil attach -nobrowse "$RW")"
echo "$ATTACH"
MOUNT="$(printf '%s\n' "$ATTACH" | awk '/\/Volumes\// { print $NF; exit }')"
if [ -z "$MOUNT" ]; then
  echo "ERROR: could not find UDRW mount point" >&2
  exit 1
fi

TARGET="$MOUNT/$HELPER_NAME"
if [ ! -f "$TARGET" ]; then
  echo "ERROR: $HELPER_NAME missing on volume $MOUNT" >&2
  ls -la "$MOUNT" >&2
  exit 1
fi

"$HERE/set-custom-icon.sh" "$TARGET"

# Drop caches so Finder sees the new icon after we recompress.
if command -v SetFile >/dev/null 2>&1; then
  SetFile -a C "$TARGET" || true
fi
sync
hdiutil detach "$MOUNT"
MOUNT=""

echo "Converting back to UDZO..."
rm -f "$OUT"
hdiutil convert "$RW" -format UDZO -imagekey zlib-level=9 -o "$OUT"
mv -f "$OUT" "$DMG"
echo "✓ stamped helper icon into $(basename "$DMG")"
