#!/bin/bash
# finalize-dmg.sh: post-process the DMG that electron-builder wrote.
#   1. give "Install Transcriber.command" its custom Finder icon and hide its extension
#   2. hide Transcriber.app (the helper still finds it by path)
#   3. drop the /Applications link if one is present
# A custom file icon lives in the resource fork plus the FinderInfo kHasCustomIcon flag. Git doesn't keep
# it, and electron-builder (dmgbuild) doesn't copy it into the image, so it has to be set on the built DMG.
#
# Destination in repo: electron/dmg/finalize-dmg.sh   (chmod +x)
# Usage: electron/dmg/finalize-dmg.sh [dist-electron/Transcriber-x.y.z-arm64.dmg]
# macOS only (hdiutil, osascript/JXA, SetFile, GetFileInfo, chflags). No Homebrew tools needed.
# Uses only built-in macOS tools (hdiutil, JXA, SetFile, GetFileInfo, xattr, chflags).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
DMG="${1:-$(ls "$ROOT"/dist-electron/*.dmg 2>/dev/null | head -1)}"
ICON="$ROOT/electron/dmg/install-helper.icns"
HELPER="Install Transcriber.command"
APP="Transcriber.app"

[ "$(uname)" = "Darwin" ] || { echo "finalize-dmg: macOS only"; exit 1; }
[ -f "$DMG" ] || { echo "finalize-dmg: no DMG found (${DMG:-dist-electron/*.dmg})"; exit 1; }
[ -f "$ICON" ] || { echo "finalize-dmg: missing $ICON"; exit 1; }

WORK="$(mktemp -d)"
MNT=""
cleanup() {
  if [ -n "$MNT" ]; then hdiutil detach "$MNT" -quiet -force 2>/dev/null || true; fi
  rm -rf "$WORK"
}
trap cleanup EXIT

echo "finalize-dmg: $DMG"
RW="$WORK/rw.dmg"
hdiutil convert "$DMG" -format UDRW -o "$RW" -quiet
# Headroom for the resource fork (~1 MB icns) and .DS_Store rewrite.
# Cap at the image MAX so a tight UDRW cannot fail resize.
read -r _MIN CUR _MAX < <(hdiutil resize -limits "$RW" | tail -1)
NEW=$((CUR + 40960))
if [ -n "${_MAX:-}" ] && [ "$NEW" -gt "$_MAX" ]; then
  NEW="$_MAX"
fi
hdiutil resize -sectors "$NEW" "$RW" >/dev/null

MNT="$(hdiutil attach -readwrite -nobrowse -noautoopen "$RW" | awk -F'\t' '/\/Volumes\// {print $NF; exit}')"
[ -n "$MNT" ] || { echo "finalize-dmg: could not mount $RW"; exit 1; }
[ -f "$MNT/$HELPER" ] || { echo "finalize-dmg: $HELPER missing in image"; exit 1; }
[ -d "$MNT/$APP" ] || { echo "finalize-dmg: $APP missing in image"; exit 1; }

# Data fork must stay byte-identical; Finder icon lives only in the resource fork.
DATA_BEFORE="$(shasum -a 256 "$MNT/$HELPER" | awk '{print $1}')"

cat > "$WORK/seticon.js" <<'JXA'
ObjC.import('AppKit');
function run(argv) {
  const icon = argv[0], target = argv[1];
  const img = $.NSImage.alloc.initWithContentsOfFile(icon);
  if (!img || img.isNil()) throw new Error('cannot read ' + icon);
  if (!$.NSWorkspace.sharedWorkspace.setIconForFileOptions(img, target, 0)) throw new Error('setIcon failed for ' + target);
  const attrs = $.NSDictionary.dictionaryWithObjectForKey($.NSNumber.numberWithBool(true), $.NSFileExtensionHidden);
  if (!$.NSFileManager.defaultManager.setAttributesOfItemAtPathError(attrs, target, null)) throw new Error('hide extension failed');
  return 'ok';
}
JXA
osascript -l JavaScript "$WORK/seticon.js" "$ICON" "$MNT/$HELPER" >/dev/null

# Belt-and-braces: SetFile is a built-in on the Xcode CLT image the runner ships.
if command -v SetFile >/dev/null 2>&1; then
  SetFile -a C "$MNT/$HELPER"
  SetFile -a E "$MNT/$HELPER"
fi

DATA_AFTER="$(shasum -a 256 "$MNT/$HELPER" | awk '{print $1}')"
if [ "$DATA_BEFORE" != "$DATA_AFTER" ]; then
  echo "finalize-dmg: helper data fork changed (was $DATA_BEFORE, now $DATA_AFTER)"
  exit 1
fi

chflags hidden "$MNT/$APP"
if [ -e "$MNT/Applications" ]; then rm -f "$MNT/Applications"; fi

# Verify before sealing. Built-in macOS tools only — no Python xattr.
xattr -p com.apple.ResourceFork "$MNT/$HELPER" >/dev/null 2>&1 || { echo "finalize-dmg: icon not set"; exit 1; }
xattr -p com.apple.FinderInfo "$MNT/$HELPER" >/dev/null 2>&1 || { echo "finalize-dmg: FinderInfo not set"; exit 1; }
RF_SIZE=$(stat -f%z "$MNT/$HELPER/..namedfork/rsrc" 2>/dev/null || echo 0)
if [ "${RF_SIZE:-0}" -lt 100 ]; then
  echo "finalize-dmg: resource fork too small ($RF_SIZE)"
  exit 1
fi
if command -v GetFileInfo >/dev/null 2>&1; then
  HAS_C=$(GetFileInfo -aC "$MNT/$HELPER" || true)
  HAS_E=$(GetFileInfo -ae "$MNT/$HELPER" || true)
  echo "finalize-dmg: GetFileInfo -aC=$HAS_C -ae=$HAS_E"
  [ "$HAS_C" = "1" ] || { echo "finalize-dmg: custom-icon flag not set"; exit 1; }
  [ "$HAS_E" = "1" ] || { echo "finalize-dmg: extension-hidden flag not set"; exit 1; }
fi
ls -lO "$MNT" | grep -q "hidden.*$APP" || { echo "finalize-dmg: $APP not hidden"; exit 1; }
[ -x "$MNT/$HELPER" ] || { echo "finalize-dmg: helper lost its exec bit"; exit 1; }
[ ! -e "$MNT/Applications" ] || { echo "finalize-dmg: Applications link still present"; exit 1; }

sync
hdiutil detach "$MNT" -quiet
MNT=""
hdiutil convert "$RW" -format UDZO -imagekey zlib-level=9 -o "$WORK/final.dmg" -quiet
mv -f "$WORK/final.dmg" "$DMG"
rm -f "$DMG.blockmap"   # stale after re-encoding; publish is null so nothing consumes it
echo "finalize-dmg: done ($(du -h "$DMG" | cut -f1))"
