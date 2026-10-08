#!/usr/bin/env python3
"""Render the Transcriber DMG window background: background.png (660x420) and background@2x.png (1320x840).

Drop-in replacement for electron/dmg/generate-background.py. It writes next to itself.
Layout (points; electron-builder dmg.contents uses the same coordinates):
  header   0..104   espresso, baked title + one instruction line
  body   104..316   flat mid-tone bronze #83735e. The installer icon sits at (330,200), iconSize 128.
                    Its Finder label lands on this flat bronze; black and white text both pass 4.58:1.
  footer 316..420   espresso, the first-open Gatekeeper steps
No text is baked anywhere a Finder label is drawn (x 200..460, y 252..306).
Needs Inter (variable or static). Set INTER_TTF to override. Fails loudly instead of falling back to a bitmap font.
"""
import os
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

W, H = 660, 420
HERE = Path(__file__).resolve().parent
OUT, OUT_2X = HERE / "background.png", HERE / "background@2x.png"

ESPRESSO_TOP = (35, 30, 25)      # #231e19
ESPRESSO = (29, 25, 21)          # #1d1915
BRONZE = (131, 115, 94)          # #83735e  label zone: 4.58:1 vs #000 and vs #fff
BRONZE_LIFT = (156, 139, 112)    # #9c8b70  halo behind the icon only (not under the label)
CREAM = (242, 234, 217)          # #f2ead9
CREAM_2 = (205, 191, 166)        # #cdbfa6
GOLD = (201, 169, 106)           # #c9a96a
GOLD_LINE = (165, 137, 89)       # #a58959

HEADER_H, FOOTER_Y = 104, 316
ICON_X, ICON_Y = 330, 200

CANDIDATES = [
    os.environ.get("INTER_TTF", ""),
    "/usr/share/fonts/truetype/sand-box/google/Inter/Inter-VariableFont_opsz,wght.ttf",
    "/usr/share/fonts/truetype/macos/Inter-Regular.ttf",
    str(Path.home() / "Library/Fonts/Inter-VariableFont_opsz,wght.ttf"),
    str(Path.home() / "Library/Fonts/Inter.ttc"),
    "/Library/Fonts/Inter-VariableFont_opsz,wght.ttf",
]


def font(size: float, weight: str) -> ImageFont.FreeTypeFont:
    for p in CANDIDATES:
        if p and Path(p).exists():
            f = ImageFont.truetype(p, round(size))
            try:
                f.set_variation_by_name(weight)
            except Exception:
                pass
            return f
    raise SystemExit("Inter not found; set INTER_TTF=/path/to/Inter.ttf")


def text_c(d, cx, y, s, f, fill):
    b = d.textbbox((0, 0), s, font=f)
    d.text((cx - (b[2] - b[0]) / 2 - b[0], y), s, font=f, fill=fill)


def render(k: int) -> Image.Image:
    img = Image.new("RGB", (W * k, H * k), BRONZE)
    d = ImageDraw.Draw(img)

    # header: espresso with a faint top-down lift
    for y in range(HEADER_H * k):
        t = y / (HEADER_H * k)
        c = tuple(round(a + (b - a) * t) for a, b in zip(ESPRESSO_TOP, ESPRESSO))
        d.line([(0, y), (W * k, y)], fill=c)
    # footer
    d.rectangle([0, FOOTER_Y * k, W * k, H * k], fill=ESPRESSO)
    # hairlines
    for y in (HEADER_H, FOOTER_Y):
        d.rectangle([0, y * k - k // 2, W * k, y * k + (k + 1) // 2 - 1], fill=GOLD_LINE)

    # halo behind the icon: wide soft ellipse that stops above the label zone (y <= 252)
    halo = Image.new("L", (W * k, H * k), 0)
    hd = ImageDraw.Draw(halo)
    rx, ry, steps = 150, 52, 60
    for i in range(steps, 0, -1):
        f = i / steps
        a = round(255 * (1 - f) ** 1.6)
        hd.ellipse([(ICON_X - rx * f) * k, (ICON_Y - ry * f) * k, (ICON_X + rx * f) * k, (ICON_Y + ry * f) * k], fill=a)
    lift = Image.new("RGB", img.size, BRONZE_LIFT)
    img.paste(lift, (0, 0), halo)
    d = ImageDraw.Draw(img)

    # header copy
    title = font(24 * k, "SemiBold")
    sub = font(13 * k, "Regular")
    tb = d.textbbox((0, 0), "Install Transcriber", font=title)
    tw = tb[2] - tb[0]
    dot_r = 6 * k
    gap = 10 * k
    x0 = (W * k - (tw + 2 * dot_r + gap)) / 2
    ty = 26 * k
    cy = ty + (tb[1] + tb[3]) / 2
    d.ellipse([x0, cy - dot_r, x0 + 2 * dot_r, cy + dot_r], fill=GOLD)
    d.text((x0 + 2 * dot_r + gap - tb[0], ty), "Install Transcriber", font=title, fill=CREAM)
    text_c(d, W * k / 2, 66 * k, "Double-click the installer. It copies Transcriber to Applications and opens it.", sub, CREAM_2)

    # footer copy: first-open steps
    lead = font(12 * k, "Medium")
    step = font(12 * k, "Regular")
    stepb = font(12 * k, "SemiBold")
    num = font(11 * k, "Bold")
    text_c(d, W * k / 2, 330 * k, "The first time, macOS will stop the installer. That's expected for this beta.", lead, CREAM_2)
    cols = [
        (120, [("Close the warning", True), ("(Done or OK)", False)]),
        (330, [("System Settings › Privacy", False), ("& Security › ", False, "Open Anyway")]),
        (540, [("Double-click", False), ("Install Transcriber again", True)]),
    ]
    for n, (cx, lines) in enumerate(cols, 1):
        # numeral disc
        r = 9 * k
        nx, ny = (cx - 92) * k, 362 * k
        d.ellipse([nx - r, ny - r, nx + r, ny + r], fill=GOLD)
        nb = d.textbbox((0, 0), str(n), font=num)
        d.text((nx - (nb[0] + nb[2]) / 2, ny - (nb[1] + nb[3]) / 2), str(n), font=num, fill=ESPRESSO)
        tx = (cx - 76) * k
        for li, ln in enumerate(lines):
            y = (354 + li * 17) * k
            if len(ln) == 3:  # plain text followed by a bold run
                d.text((tx, y), ln[0], font=step, fill=CREAM)
                w = d.textlength(ln[0], font=step)
                d.text((tx + w, y), ln[2], font=stepb, fill=GOLD)
            else:
                d.text((tx, y), ln[0], font=stepb if ln[1] else step, fill=CREAM if not ln[1] else CREAM)
    return img


def main():
    one, two = render(1), render(2)
    one.save(OUT, "PNG", optimize=True, dpi=(72, 72))
    two.save(OUT_2X, "PNG", optimize=True, dpi=(144, 144))
    print(f"wrote {OUT} {one.size}, {OUT_2X} {two.size}")


if __name__ == "__main__":
    main()
