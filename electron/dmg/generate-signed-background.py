#!/usr/bin/env python3
"""Signed DMG background — Design direction A (drag to Applications).

660×420 and 1320×840. Same espresso / bronze tokens as the unsigned helper
DMG. Icons sit at (180, 200) and (480, 200), iconSize 128. No baked text in
the Finder label bands (y 252..306 around those x positions).
"""
import os
from pathlib import Path
from PIL import Image, ImageDraw, ImageFont

W, H = 660, 420
HERE = Path(__file__).resolve().parent
OUT, OUT_2X = HERE / "background-signed.png", HERE / "background-signed@2x.png"

ESPRESSO_TOP = (35, 30, 25)
ESPRESSO = (29, 25, 21)
BRONZE = (131, 115, 94)
BRONZE_LIFT = (156, 139, 112)
CREAM = (242, 234, 217)
CREAM_2 = (205, 191, 166)
GOLD = (201, 169, 106)
GOLD_LINE = (165, 137, 89)

HEADER_H, FOOTER_Y = 104, 316
APP_X, APPS_X, ICON_Y = 180, 480, 200

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


def halo(img, cx, cy, k):
    halo_l = Image.new("L", img.size, 0)
    hd = ImageDraw.Draw(halo_l)
    rx, ry, steps = 110, 48, 50
    for i in range(steps, 0, -1):
        f = i / steps
        a = round(255 * (1 - f) ** 1.6)
        hd.ellipse(
            [(cx - rx * f) * k, (cy - ry * f) * k, (cx + rx * f) * k, (cy + ry * f) * k],
            fill=a,
        )
    lift = Image.new("RGB", img.size, BRONZE_LIFT)
    img.paste(lift, (0, 0), halo_l)


def render(k: int) -> Image.Image:
    img = Image.new("RGB", (W * k, H * k), BRONZE)
    d = ImageDraw.Draw(img)
    for y in range(HEADER_H * k):
        t = y / (HEADER_H * k)
        c = tuple(round(a + (b - a) * t) for a, b in zip(ESPRESSO_TOP, ESPRESSO))
        d.line([(0, y), (W * k, y)], fill=c)
    d.rectangle([0, FOOTER_Y * k, W * k, H * k], fill=ESPRESSO)
    for y in (HEADER_H, FOOTER_Y):
        d.rectangle([0, y * k - k // 2, W * k, y * k + (k + 1) // 2 - 1], fill=GOLD_LINE)

    halo(img, APP_X, ICON_Y, k)
    halo(img, APPS_X, ICON_Y, k)
    d = ImageDraw.Draw(img)

    title = font(24 * k, "SemiBold")
    sub = font(13 * k, "Regular")
    tb = d.textbbox((0, 0), "Transcriber", font=title)
    tw = tb[2] - tb[0]
    dot_r = 6 * k
    gap = 10 * k
    x0 = (W * k - (tw + 2 * dot_r + gap)) / 2
    ty = 26 * k
    cy = ty + (tb[1] + tb[3]) / 2
    d.ellipse([x0, cy - dot_r, x0 + 2 * dot_r, cy + dot_r], fill=GOLD)
    d.text((x0 + 2 * dot_r + gap - tb[0], ty), "Transcriber", font=title, fill=CREAM)
    text_c(d, W * k / 2, 66 * k, "Drag Transcriber to Applications.", sub, CREAM_2)

    lead = font(12 * k, "Medium")
    text_c(
        d,
        W * k / 2,
        340 * k,
        "Then open it from Applications. Notarized builds do not need Open Anyway.",
        lead,
        CREAM_2,
    )
    return img


def main():
    one, two = render(1), render(2)
    one.save(OUT, "PNG", optimize=True, dpi=(72, 72))
    two.save(OUT_2X, "PNG", optimize=True, dpi=(144, 144))
    print(f"wrote {OUT} {one.size}, {OUT_2X} {two.size}")


if __name__ == "__main__":
    main()
