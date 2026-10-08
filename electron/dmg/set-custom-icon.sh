#!/bin/bash
# Apply a Finder custom icon to a file (resource fork + custom-icon flag).
# Does not rewrite the file's data fork.
#
# Design: replace electron/dmg/helper-icon.icns — that is the only icon file
# this script reads. The current file is a placeholder copy of the app icon.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
HELPER_ICON="$HERE/helper-icon.icns"
TARGET="${1:?usage: set-custom-icon.sh <file>}"

if [ ! -f "$HELPER_ICON" ]; then
  echo "ERROR: missing $HELPER_ICON" >&2
  echo "Replace that file with Design's helper icon." >&2
  exit 1
fi
if [ ! -e "$TARGET" ]; then
  echo "ERROR: missing target $TARGET" >&2
  exit 1
fi

DATA_BEFORE="$(shasum -a 256 "$TARGET" | awk '{print $1}')"

set_finder_custom_flag() {
  python3 - "$TARGET" <<'PY'
import os, sys
path = sys.argv[1]
name = "com.apple.FinderInfo"
try:
    data = bytearray(os.getxattr(path, name, follow_symlinks=True))
except OSError:
    data = bytearray(32)
if len(data) < 32:
    data.extend(b"\x00" * (32 - len(data)))
flags = (data[8] << 8) | data[9]
flags |= 0x0400  # kHasCustomIcon
data[8] = (flags >> 8) & 0xFF
data[9] = flags & 0xFF
os.setxattr(path, name, bytes(data[:32]), follow_symlinks=True)
PY
}

apply_via_jxa() {
  HELPER_ICON="$HELPER_ICON" HELPER_TARGET="$TARGET" python3 - <<'PY'
import json, os, subprocess, sys
icon = os.environ["HELPER_ICON"]
target = os.environ["HELPER_TARGET"]
jxa = """
ObjC.import("AppKit");
var img = $.NSImage.alloc.initWithContentsOfFile(%s);
if (!img) throw new Error("could not load icon");
var ok = $.NSWorkspace.sharedWorkspace.setIconForFileOptions(img, %s, 0);
if (!ok) throw new Error("NSWorkspace.setIcon failed");
""" % (json.dumps(icon), json.dumps(target))
subprocess.check_call(["osascript", "-l", "JavaScript", "-e", jxa])
PY
}

apply_via_rez() {
  local rez_bin=""
  if command -v Rez >/dev/null 2>&1; then
    rez_bin="Rez"
  elif xcrun --find Rez >/dev/null 2>&1; then
    rez_bin="xcrun Rez"
  else
    return 1
  fi
  local tmp
  tmp="$(mktemp -d /tmp/helper-icon-rez-XXXXXX)"
  python3 - "$HELPER_ICON" "$tmp/icon.r" <<'PY'
import pathlib, sys
src, dest = pathlib.Path(sys.argv[1]), pathlib.Path(sys.argv[2])
data = src.read_bytes()
lines = ["data 'icns' (-16455) {"]
for i in range(0, len(data), 16):
    chunk = data[i : i + 16]
    hexstr = "".join(f"{b:02X}" for b in chunk)
    groups = [hexstr[j : j + 4] for j in range(0, len(hexstr), 4)]
    lines.append('\t$"' + " ".join(groups) + '"')
lines.append("};")
dest.write_text("\n".join(lines) + "\n")
PY
  $rez_bin "$tmp/icon.r" -append -o "$TARGET"
  rm -rf "$tmp"
}

if ! apply_via_jxa; then
  echo "JXA setIcon failed; trying Rez..." >&2
  apply_via_rez
fi

if command -v SetFile >/dev/null 2>&1; then
  SetFile -a C "$TARGET" || true
fi
set_finder_custom_flag

DATA_AFTER="$(shasum -a 256 "$TARGET" | awk '{print $1}')"
if [ "$DATA_BEFORE" != "$DATA_AFTER" ]; then
  echo "ERROR: set-custom-icon.sh rewrote the data fork of $TARGET" >&2
  exit 1
fi

RF_SIZE="$(stat -f%z "$TARGET/..namedfork/rsrc" 2>/dev/null || echo 0)"
if [ "${RF_SIZE:-0}" -lt 100 ]; then
  echo "ERROR: resource fork missing or tiny ($RF_SIZE bytes) on $TARGET" >&2
  exit 1
fi
echo "✓ custom icon on $TARGET (resource fork ${RF_SIZE} bytes)"
