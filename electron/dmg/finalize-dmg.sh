#!/bin/bash
# finalize-dmg.sh: post-process the DMG that electron-builder wrote.
#   1. give "Install Transcriber.command" its custom Finder icon and hide its extension
#   2. move Transcriber.app into .payload/, which Finder hides (the helper looks there first)
#   3. drop the /Applications link if one is present
#   4. stamp a Finder-safe .VolumeIcon.icns (iconutil from the app icon) and
#      set the volume custom-icon flag so the title-bar proxy is not noise
# Must not modify Transcriber.app contents (no codesign, no copies into Contents/).
# A custom file icon lives in the resource fork plus the FinderInfo kHasCustomIcon flag. Git doesn't keep
# it, and electron-builder (dmgbuild) doesn't copy it into the image, so it has to be set on the built DMG.
#
# Destination in repo: electron/dmg/finalize-dmg.sh   (chmod +x)
# Usage: electron/dmg/finalize-dmg.sh [dist-electron/Transcriber-x.y.z-arm64.dmg]
#        electron/dmg/finalize-dmg.sh --volume-icon-only <signed.dmg>
# --volume-icon-only stamps the iconutil volume icon + custom-icon flag and
# leaves helper / .payload / Applications alone (signed drag-to-Apps layout).
# macOS only (hdiutil, osascript/JXA, SetFile, GetFileInfo). No Homebrew tools needed.
# Uses only built-in macOS tools (hdiutil, JXA, SetFile, GetFileInfo, xattr).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
VOLUME_ICON_ONLY=0
if [ "${1:-}" = "--volume-icon-only" ]; then
  VOLUME_ICON_ONLY=1
  shift
fi
DMG="${1:-$(ls "$ROOT"/dist-electron/*.dmg 2>/dev/null | head -1)}"
ICON="$ROOT/electron/dmg/install-helper.icns"
HELPER="Install Transcriber.command"
APP="Transcriber.app"
PAYLOAD=".payload"

[ "$(uname)" = "Darwin" ] || { echo "finalize-dmg: macOS only"; exit 1; }
[ -f "$DMG" ] || { echo "finalize-dmg: no DMG found (${DMG:-dist-electron/*.dmg})"; exit 1; }
if [ "$VOLUME_ICON_ONLY" != 1 ]; then
  [ -f "$ICON" ] || { echo "finalize-dmg: missing $ICON"; exit 1; }
fi

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

if [ "$VOLUME_ICON_ONLY" != 1 ]; then
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

  # Hide the .app by folder, not by flag: Finder never shows a dot-folder, so
  # the bundle carries no hidden flag. Still strip wrapper FinderInfo: codesign
  # --verify --deep --strict rejects it, and the helper's ditto would carry it
  # into /Applications. Never touch Contents/.
  mkdir "$MNT/$PAYLOAD"
  mv "$MNT/$APP" "$MNT/$PAYLOAD/"
  xattr -c "$MNT/$PAYLOAD/$APP" 2>/dev/null || true
  xattr -d com.apple.FinderInfo "$MNT/$PAYLOAD/$APP" 2>/dev/null || true
  if [ -e "$MNT/Applications" ]; then rm -f "$MNT/Applications"; fi
else
  echo "finalize-dmg: volume-icon-only (leave helper / .payload / Applications alone)"
fi

# Title-bar proxy reads the 16px volume icon. PNG-only .icns (electron-builder
# copies icon.icns as-is) decodes as colored noise there. iconutil writes the
# ARGB slots Finder expects. Then SetFile -a C on the volume, not the helper.
# Fail loudly if iconutil/sips/icon.png are missing — do not copy the PNG-only icns.
APP_ICON_PNG="$ROOT/electron/resources/icon.png"
VOLUME_ICNS="$WORK/VolumeIcon.icns"
command -v iconutil >/dev/null 2>&1 || { echo "finalize-dmg: iconutil is required (no PNG-only fallback)"; exit 1; }
command -v sips >/dev/null 2>&1 || { echo "finalize-dmg: sips is required (no PNG-only fallback)"; exit 1; }
[ -f "$APP_ICON_PNG" ] || { echo "finalize-dmg: missing $APP_ICON_PNG (no PNG-only fallback)"; exit 1; }
ICONSET="$WORK/volume.iconset"
mkdir "$ICONSET"
sips -z 16 16 "$APP_ICON_PNG" --out "$ICONSET/icon_16x16.png" >/dev/null
sips -z 32 32 "$APP_ICON_PNG" --out "$ICONSET/icon_16x16@2x.png" >/dev/null
sips -z 32 32 "$APP_ICON_PNG" --out "$ICONSET/icon_32x32.png" >/dev/null
sips -z 64 64 "$APP_ICON_PNG" --out "$ICONSET/icon_32x32@2x.png" >/dev/null
sips -z 128 128 "$APP_ICON_PNG" --out "$ICONSET/icon_128x128.png" >/dev/null
sips -z 256 256 "$APP_ICON_PNG" --out "$ICONSET/icon_128x128@2x.png" >/dev/null
sips -z 256 256 "$APP_ICON_PNG" --out "$ICONSET/icon_256x256.png" >/dev/null
sips -z 512 512 "$APP_ICON_PNG" --out "$ICONSET/icon_256x256@2x.png" >/dev/null
sips -z 512 512 "$APP_ICON_PNG" --out "$ICONSET/icon_512x512.png" >/dev/null
sips -z 1024 1024 "$APP_ICON_PNG" --out "$ICONSET/icon_512x512@2x.png" >/dev/null
iconutil -c icns "$ICONSET" -o "$VOLUME_ICNS"
echo "finalize-dmg: rebuilt volume icns via iconutil from icon.png"
MAGIC="$(dd if="$VOLUME_ICNS" bs=4 count=1 2>/dev/null | LC_ALL=C tr -d '\0')"
[ "$MAGIC" = "icns" ] || { echo "finalize-dmg: volume icns magic is '$MAGIC' not icns"; exit 1; }
cp "$VOLUME_ICNS" "$MNT/.VolumeIcon.icns"
if command -v SetFile >/dev/null 2>&1; then
  SetFile -c icnC "$MNT/.VolumeIcon.icns"
  SetFile -a V "$MNT/.VolumeIcon.icns"
  SetFile -a C "$MNT"
fi
echo "finalize-dmg: stamped $MNT/.VolumeIcon.icns ($(wc -c < "$MNT/.VolumeIcon.icns") bytes)"

# Verify before sealing. Built-in macOS tools only — no Python xattr.
if [ "$VOLUME_ICON_ONLY" != 1 ]; then
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
  [ ! -e "$MNT/$APP" ] || { echo "finalize-dmg: $APP still at the volume root"; exit 1; }
  [ -d "$MNT/$PAYLOAD/$APP" ] || { echo "finalize-dmg: $APP missing from $PAYLOAD/"; exit 1; }
  if xattr -p com.apple.FinderInfo "$MNT/$PAYLOAD/$APP" >/dev/null 2>&1; then
    echo "finalize-dmg: FinderInfo still on $APP after strip"
    xattr -l "$MNT/$PAYLOAD/$APP" || true
    exit 1
  fi
  [ -x "$MNT/$HELPER" ] || { echo "finalize-dmg: helper lost its exec bit"; exit 1; }
  [ ! -e "$MNT/Applications" ] || { echo "finalize-dmg: Applications link still present"; exit 1; }
  if command -v codesign >/dev/null 2>&1; then
    codesign --verify --deep --strict "$MNT/$PAYLOAD/$APP" || {
      echo "finalize-dmg: codesign --verify --deep --strict failed for $APP"
      xattr -l "$MNT/$PAYLOAD/$APP" || true
      exit 1
    }
  fi
fi
if command -v GetFileInfo >/dev/null 2>&1; then
  VOL_C=$(GetFileInfo -aC "$MNT" || true)
  echo "finalize-dmg: volume GetFileInfo -aC=$VOL_C"
  [ "$VOL_C" = "1" ] || { echo "finalize-dmg: volume custom-icon flag not set"; exit 1; }
fi

sync
hdiutil detach "$MNT" -quiet
MNT=""
hdiutil convert "$RW" -format UDZO -imagekey zlib-level=9 -o "$WORK/final.dmg" -quiet
mv -f "$WORK/final.dmg" "$DMG"
rm -f "$DMG.blockmap"   # stale after re-encoding; publish is null so nothing consumes it

# Convert can drop the volume C bit. Fail here if the sealed image is wrong.
SEAL="$(hdiutil attach -readonly -nobrowse -noautoopen "$DMG" | awk -F'\t' '/\/Volumes\// {print $NF; exit}')"
[ -n "$SEAL" ] || { echo "finalize-dmg: could not remount sealed DMG"; exit 1; }
python3 "$ROOT/electron/dmg/assert-volume-icon.py" "$SEAL" || {
  echo "finalize-dmg: sealed volume icon check failed"
  hdiutil detach "$SEAL" -quiet -force 2>/dev/null || true
  exit 1
}
hdiutil detach "$SEAL" -quiet
echo "finalize-dmg: done ($(du -h "$DMG" | cut -f1))"
