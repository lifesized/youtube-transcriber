#!/usr/bin/env python3
"""Assert Finder custom-icon metadata on Install Transcriber.command.

macOS only. Uses GetFileInfo, xattr, and the Apple named-fork path.
"""

import subprocess
import sys
from pathlib import Path


def run(args: list[str]) -> str:
    return subprocess.check_output(args, text=True).strip()


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: assert-helper-icon.py <helper-path>", file=sys.stderr)
        return 2
    path = sys.argv[1]
    helper = Path(path)
    if not helper.is_file():
        print("ERROR: helper missing:", path)
        return 1

    # Apple's named-fork path is "<file>/..namedfork/rsrc", not parent/namedfork.
    rsrc = Path(f"{path}/..namedfork/rsrc")
    try:
        rf_size = rsrc.stat().st_size
    except OSError as e:
        print("ERROR: resource fork missing:", e)
        return 1
    print(f"resource fork: {rf_size} bytes")
    if rf_size < 100:
        print("ERROR: resource fork too small")
        return 1

    try:
        has_c = run(["GetFileInfo", "-aC", path])
        has_e = run(["GetFileInfo", "-ae", path])
    except (OSError, subprocess.CalledProcessError) as e:
        print("ERROR: GetFileInfo failed:", e)
        return 1
    print(f"GetFileInfo -aC={has_c} -ae={has_e}")
    if has_c != "1":
        print("ERROR: kHasCustomIcon (GetFileInfo -aC) not set")
        return 1
    if has_e != "1":
        print("ERROR: extension-hidden (GetFileInfo -ae) not set")
        return 1

    try:
        subprocess.check_call(
            ["xattr", "-p", "com.apple.ResourceFork", path],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
        subprocess.check_call(
            ["xattr", "-p", "com.apple.FinderInfo", path],
            stdout=subprocess.DEVNULL,
            stderr=subprocess.DEVNULL,
        )
    except subprocess.CalledProcessError:
        print("ERROR: ResourceFork or FinderInfo xattr missing")
        return 1

    print("✓ helper has custom icon, hidden extension, and a resource fork")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
