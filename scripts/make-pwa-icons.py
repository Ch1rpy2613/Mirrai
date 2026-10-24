#!/usr/bin/env python3
"""
Generate the PWA icons.

The web app manifest needs square icons in a couple of sizes. They are drawn
here — the same rounded-square gradient and heart as the desktop icon — so the
installed app looks like the rest of the product.

    python3 scripts/make-pwa-icons.py
"""
import math
import os

from PIL import Image

SIZES = [192, 512]

BG_TOP = (0x6E, 0x5A, 0xC8)      # rgb, top of the gradient
BG_BOTTOM = (0x2A, 0x1F, 0x4E)   # rgb, bottom of the gradient
HEART = (0xFF, 0xE3, 0xEC)

OUT_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
    "client", "public", "icons",
)


def rounded_rect_alpha(x, y, size, radius):
    """Coverage of a rounded square for a pixel at (x, y)."""
    cx = min(max(x, radius), size - 1 - radius)
    cy = min(max(y, radius), size - 1 - radius)
    dx, dy = x - cx, y - cy
    return dx * dx + dy * dy <= radius * radius


def heart_alpha(x, y, size):
    """Coverage of the classic heart curve, centred in the icon."""
    s = size / 16.0
    hx = (x - size / 2.0) / (s * 4.6)
    hy = -(y - size * 0.54) / (s * 4.6)
    val = (hx * hx + hy * hy - 1) ** 3 - hx * hx * hy * hy * hy
    if val > 0:
        return 0
    # Soften the edge a little.
    edge = min(1.0, max(0.0, (0.35 - val) * 6))
    return edge


def render(size):
    """Draws one icon as an RGBA image."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    pixels = img.load()
    radius = size * 0.22

    for y in range(size):
        t = y / max(1, size - 1)
        base = tuple(
            int(BG_TOP[i] + (BG_BOTTOM[i] - BG_TOP[i]) * t) for i in range(3)
        )
        for x in range(size):
            rect = rounded_rect_alpha(x, y, size, radius)
            heart = heart_alpha(x, y, size)
            if heart <= 0 and rect <= 0:
                continue
            alpha = rect
            colour = base
            if heart > 0:
                # The heart replaces the gradient rather than blending with it.
                colour = HEART
                alpha = max(alpha, heart)
            r, g, b = colour
            pixels[x, y] = (r, g, b, int(round(255 * min(1.0, alpha))))

    return img


def main():
    os.makedirs(OUT_DIR, exist_ok=True)
    for size in SIZES:
        path = os.path.join(OUT_DIR, f"icon-{size}.png")
        render(size).save(path, "PNG")
        print(f"wrote {path}")

    # A maskable icon needs the artwork inside the safe zone, so it is drawn
    # smaller on a full-bleed background.
    maskable = Image.new("RGBA", (512, 512), BG_BOTTOM + (255,))
    inner = render(360)
    maskable.paste(inner, (76, 76), inner)
    maskable_path = os.path.join(OUT_DIR, "icon-maskable-512.png")
    maskable.save(maskable_path, "PNG")
    print(f"wrote {maskable_path}")


if __name__ == "__main__":
    main()
