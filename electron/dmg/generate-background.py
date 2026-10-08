#!/usr/bin/env python3
"""Render electron/dmg/background.png for the Transcriber DMG window."""

from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

WIDTH, HEIGHT = 620, 440
OUT = Path(__file__).with_name("background.png")
FONT_DIR = Path("/usr/share/fonts/truetype/macos")
BG = (10, 10, 10)
INK = (250, 250, 250)
MUTED = (178, 178, 178)
ACCENT = (166, 140, 89)


def font(name: str, size: int) -> ImageFont.FreeTypeFont:
    path = FONT_DIR / name
    if path.exists():
        return ImageFont.truetype(str(path), size)
    return ImageFont.load_default()


def centered(draw: ImageDraw.ImageDraw, text: str, y: int, fnt, fill) -> None:
    bbox = draw.textbbox((0, 0), text, font=fnt)
    x = (WIDTH - (bbox[2] - bbox[0])) // 2
    draw.text((x, y), text, font=fnt, fill=fill)


def main() -> None:
    img = Image.new("RGB", (WIDTH, HEIGHT), BG)
    draw = ImageDraw.Draw(img)
    title = font("Inter-SemiBold.ttf", 22)
    body = font("Inter-Regular.ttf", 14)
    small = font("Inter-Regular.ttf", 12)

    centered(draw, "Install Transcriber", 22, title, INK)
    centered(draw, "Double-click  Install Transcriber.command", 58, body, INK)
    centered(
        draw,
        "If macOS blocks it: right-click the helper → Open  (once)",
        82,
        small,
        MUTED,
    )

    # Soft underline under the helper icon slot
    draw.rounded_rectangle((230, 118, 390, 196), radius=10, outline=ACCENT, width=1)
    centered(draw, "run this", 200, small, ACCENT)

    centered(draw, "Fallback: drag Transcriber to Applications", 248, small, MUTED)

    img.save(OUT, "PNG", optimize=True)
    print(f"wrote {OUT} ({OUT.stat().st_size} bytes)")


if __name__ == "__main__":
    main()
