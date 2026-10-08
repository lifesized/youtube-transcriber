#!/usr/bin/env python3
"""Render electron/dmg/background.png and @2x for the Transcriber DMG window."""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

WIDTH, HEIGHT = 620, 440
OUT = Path(__file__).with_name("background.png")
OUT_2X = Path(__file__).with_name("background@2x.png")
FONT_DIR = Path("/usr/share/fonts/truetype/macos")
BG = (244, 241, 234)  # #f4f1ea
INK = (26, 26, 26)  # #1a1a1a
MUTED = (92, 87, 78)
ACCENT = (165, 137, 89)  # #a58959


def font(name: str, size: int) -> ImageFont.FreeTypeFont:
    path = FONT_DIR / name
    if path.exists():
        return ImageFont.truetype(str(path), size)
    return ImageFont.load_default()


def centered(draw: ImageDraw.ImageDraw, text: str, y: int, fnt, fill, width: int) -> None:
    bbox = draw.textbbox((0, 0), text, font=fnt)
    x = (width - (bbox[2] - bbox[0])) // 2
    draw.text((x, y), text, font=fnt, fill=fill)


def draw_arrow(draw: ImageDraw.ImageDraw, x0: int, y0: int, x1: int, y1: int, scale: int) -> None:
    width = max(2 * scale, 2)
    draw.line((x0, y0, x1, y1), fill=ACCENT, width=width)
    head = 10 * scale
    draw.polygon(
        [
            (x1, y1),
            (x1 - head, y1 - int(head * 0.45)),
            (x1 - head, y1 + int(head * 0.45)),
        ],
        fill=ACCENT,
    )


def render(scale: int) -> Image.Image:
    w, h = WIDTH * scale, HEIGHT * scale
    img = Image.new("RGB", (w, h), BG)
    draw = ImageDraw.Draw(img)
    title = font("Inter-SemiBold.ttf", 22 * scale)
    body = font("Inter-Regular.ttf", 14 * scale)
    small = font("Inter-Regular.ttf", 12 * scale)

    centered(draw, "Install Transcriber", 22 * scale, title, INK, w)
    centered(draw, "Double-click Install Transcriber", 58 * scale, body, INK, w)
    centered(
        draw,
        "If macOS blocks it: right-click → Open (once)",
        82 * scale,
        small,
        MUTED,
        w,
    )
    draw_arrow(draw, 215 * scale, 312 * scale, 405 * scale, 312 * scale, scale)
    return img


def main() -> None:
    one = render(1)
    two = render(2)
    one.save(OUT, "PNG", optimize=True)
    two.save(OUT_2X, "PNG", optimize=True)
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")
    print(f"wrote {OUT_2X} ({OUT_2X.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
