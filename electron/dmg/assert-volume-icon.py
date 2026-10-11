#!/usr/bin/env python3
"""Assert the DMG volume has a valid .VolumeIcon.icns and the custom-icon bit.

macOS only. Checks the volume root (the title-bar proxy), not the helper.
"""

import subprocess
import sys
from pathlib import Path


def run(args: list[str]) -> str:
    return subprocess.check_output(args, text=True).strip()


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: assert-volume-icon.py <mount>", file=sys.stderr)
        return 2
    mount = Path(sys.argv[1])
    if not mount.is_dir():
        print("ERROR: mount missing:", mount)
        return 1

    icon = mount / ".VolumeIcon.icns"
    if not icon.is_file():
        print("ERROR: .VolumeIcon.icns missing at volume root")
        return 1
    data = icon.read_bytes()
    print(f".VolumeIcon.icns: {len(data)} bytes")
    if data[:4] != b"icns":
        print("ERROR: .VolumeIcon.icns magic is", data[:8], "not icns")
        return 1
    declared = int.from_bytes(data[4:8], "big")
    if declared != len(data) or len(data) < 1000:
        print(f"ERROR: .VolumeIcon.icns size {len(data)} declared {declared}")
        return 1
    off = 8
    types = []
    while off + 8 <= len(data):
        tag = data[off : off + 4]
        size = int.from_bytes(data[off + 4 : off + 8], "big")
        if size < 8 or off + size > len(data):
            print("ERROR: corrupt icns at", off, tag, size)
            return 1
        types.append(tag.decode("latin1", "replace"))
        off += size
    print("icns types:", " ".join(types))
    # iconutil writes ARGB 16px (ic04) or a classic is32. PNG-only icp4 is what
    # showed up as colored noise in the title-bar proxy on 52772c5.
    if not any(t in types for t in ("ic04", "is32", "il32")):
        print("ERROR: icns has no 16px ARGB/classic slot (title-bar will be noise)")
        return 1
    print("✓ .VolumeIcon.icns is a valid icns with a 16px slot")

    try:
        attrs = run(["GetFileInfo", "-a", str(mount)])
        has_c = run(["GetFileInfo", "-aC", str(mount)])
    except (OSError, subprocess.CalledProcessError) as e:
        print("ERROR: GetFileInfo on volume failed:", e)
        return 1
    print(f"GetFileInfo -a {mount}: {attrs}")
    print(f"GetFileInfo -aC {mount}: {has_c}")
    if has_c != "1":
        print("ERROR: volume kHasCustomIcon (GetFileInfo -aC) is not set")
        return 1
    print("✓ volume custom-icon flag is set")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
