#!/usr/bin/env python3
"""Best-effort screenshot of a mounted DMG Finder window. Never raises."""

import subprocess
import sys
import time

# Match electron-builder dmg.window: 660×440.
WINDOW_W, WINDOW_H = 660, 440
ORIGIN_X, ORIGIN_Y = 80, 80


def main() -> int:
    if len(sys.argv) != 3:
        print("usage: screenshot-dmg-window.py <mount> <png>", file=sys.stderr)
        return 0
    mount, out = sys.argv[1], sys.argv[2]
    try:
        subprocess.run(["open", mount], check=False, timeout=10)
        time.sleep(2)
        as_path = mount.replace("\\", "\\\\").replace('"', '\\"')
        right = ORIGIN_X + WINDOW_W
        bottom = ORIGIN_Y + WINDOW_H
        script = "\n".join(
            [
                'tell application "Finder"',
                "  activate",
                "  try",
                f'    open POSIX file "{as_path}"',
                "  end try",
                "  delay 1",
                "  set w to window 1",
                "  set toolbar visible of w to false",
                "  set sidebar width of w to 0",
                "  set current view of w to icon view",
                f"  set bounds of w to {{{ORIGIN_X}, {ORIGIN_Y}, {right}, {bottom}}}",
                "end tell",
            ]
        )
        subprocess.run(["osascript", "-e", script], check=False, timeout=20)
        time.sleep(1)
        region = f"{ORIGIN_X},{ORIGIN_Y},{WINDOW_W},{WINDOW_H}"
        subprocess.run(
            ["screencapture", "-x", f"-R{region}", out],
            check=False,
            timeout=15,
        )
        print("screenshot wrote", out)
        # Title-bar proxy sits just left of the centered window title.
        proxy = 24
        px = ORIGIN_X + WINDOW_W // 2 - 56
        py = ORIGIN_Y + 4
        stem = str(out).rsplit(".", 1)[0]
        zoomed = stem.replace("dmg-window", "dmg-volume-icon") + ".png"
        if zoomed == str(out):
            zoomed = stem + "-volume-icon.png"
        raw = stem + "-volume-icon.raw.png"
        subprocess.run(
            ["screencapture", "-x", f"-R{px},{py},{proxy},{proxy}", raw],
            check=False,
            timeout=15,
        )
        subprocess.run(
            ["sips", "-z", "192", "192", raw, "--out", zoomed],
            check=False,
            timeout=15,
            stdout=subprocess.DEVNULL,
        )
        print("screenshot wrote", zoomed)
    except Exception as e:
        print("screenshot skipped:", e)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
