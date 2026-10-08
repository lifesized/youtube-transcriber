#!/usr/bin/env python3
"""Assert Finder custom-icon metadata on Install Transcriber.command."""

import os
import sys


def main() -> int:
    if len(sys.argv) != 2:
        print("usage: assert-helper-icon.py <helper-path>", file=sys.stderr)
        return 2
    path = sys.argv[1]
    try:
        data = os.getxattr(path, "com.apple.FinderInfo", follow_symlinks=True)
    except OSError as e:
        print("ERROR: com.apple.FinderInfo missing:", e)
        return 1
    if len(data) < 10:
        print("ERROR: FinderInfo too short", len(data))
        return 1
    flags = (data[8] << 8) | data[9]
    print(f"FinderInfo flags=0x{flags:04x}")
    if not (flags & 0x0400):
        print("ERROR: kHasCustomIcon (0x0400) not set")
        return 1
    print("✓ FinderInfo custom-icon bit is set")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
