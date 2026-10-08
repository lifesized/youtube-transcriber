#!/bin/bash
# Build a drag-to-Applications DMG from an already-signed Transcriber.app.
# Does not modify the ad-hoc DMG that electron:build + finalize-dmg.sh wrote.
#
#   build-signed-dmg.sh [signed.app] [out.dmg]
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
APP="${1:-$ROOT/dist-electron/signed/Transcriber.app}"
OUT="${2:-$ROOT/dist-electron/signed/Transcriber-signed.dmg}"
BG="$ROOT/electron/dmg/background-signed.png"
VOL="Transcriber"

[ "$(uname)" = "Darwin" ] || { echo "signed-dmg: macOS only"; exit 1; }
[ -d "$APP" ] || { echo "signed-dmg: missing $APP"; exit 1; }
[ -f "$BG" ] || { echo "signed-dmg: missing $BG"; exit 1; }

WORK="$(mktemp -d)"
MNT=""
cleanup() {
  if [ -n "$MNT" ]; then hdiutil detach "$MNT" -quiet -force 2>/dev/null || true; fi
  rm -rf "$WORK"
}
trap cleanup EXIT

STAGE="$WORK/stage"
mkdir -p "$STAGE/.background"
ditto "$APP" "$STAGE/Transcriber.app"
ln -s /Applications "$STAGE/Applications"
cp "$BG" "$STAGE/.background/background.png"

# Hide the background folder from Finder.
if command -v SetFile >/dev/null 2>&1; then
  SetFile -a V "$STAGE/.background" || true
fi

echo "signed-dmg: creating RW image"
RW="$WORK/rw.dmg"
hdiutil create -srcfolder "$STAGE" -volname "$VOL" -fs HFS+ -format UDRW -ov "$RW" >/dev/null
read -r _MIN CUR _MAX < <(hdiutil resize -limits "$RW" | tail -1)
NEW=$((CUR + 40960))
if [ -n "${_MAX:-}" ] && [ "$NEW" -gt "$_MAX" ]; then
  NEW="$_MAX"
fi
hdiutil resize -sectors "$NEW" "$RW" >/dev/null

MNT="$(hdiutil attach -readwrite -nobrowse -noautoopen "$RW" | awk -F'\t' '/\/Volumes\// {print $NF; exit}')"
[ -n "$MNT" ] || { echo "signed-dmg: could not mount"; exit 1; }

# Direction A: Transcriber.app left, Applications right, 660×420 window.
cat > "$WORK/layout.js" <<'JXA'
function run(argv) {
  const mount = argv[0];
  const se = Application('System Events');
  const finder = Application('Finder');
  finder.includeStandardAdditions = true;
  finder.activate();
  const disk = finder.disks.byName(mount.split('/').pop());
  const win = disk.containerWindow();
  win.open();
  win.currentView = 'icon';
  win.toolbarVisible = false;
  win.statusbarVisible = false;
  win.sidebarWidth = 0;
  win.bounds = { x: 80, y: 80, width: 660, height: 420 };
  const opts = win.iconViewOptions();
  opts.arrangement = 'not arranged';
  opts.iconSize = 128;
  opts.textSize = 13;
  const bg = disk.files.byName('background.png');
  try {
    opts.backgroundPicture = disk.folders.byName('.background').files.byName('background.png');
  } catch (e) {
    // background is optional if Finder cannot bind it
  }
  disk.items.byName('Transcriber.app').position = { x: 180, y: 200 };
  disk.items.byName('Applications').position = { x: 480, y: 200 };
  finder.close(win);
  win.open();
  delay(1);
  return 'ok';
}
JXA
osascript -l JavaScript "$WORK/layout.js" "$MNT" >/dev/null || true

# Bless background visibility for Finder.
if command -v SetFile >/dev/null 2>&1; then
  SetFile -a V "$MNT/.background" || true
fi

[ -d "$MNT/Transcriber.app" ] || { echo "signed-dmg: app missing on volume"; exit 1; }
[ -L "$MNT/Applications" ] || { echo "signed-dmg: Applications symlink missing"; exit 1; }
[ ! -e "$MNT/Install Transcriber.command" ] || { echo "signed-dmg: helper must not be on the signed DMG"; exit 1; }
[ ! -e "$MNT/.payload" ] || { echo "signed-dmg: .payload must not be on the signed DMG"; exit 1; }

echo "signed-dmg: codesign --verify the app on the volume (must still match)"
codesign --verify --deep --strict "$MNT/Transcriber.app"

sync
hdiutil detach "$MNT" -quiet
MNT=""
mkdir -p "$(dirname "$OUT")"
rm -f "$OUT"
hdiutil convert "$RW" -format UDZO -imagekey zlib-level=9 -o "$OUT" -quiet
echo "signed-dmg: wrote $OUT ($(du -h "$OUT" | cut -f1))"
