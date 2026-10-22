"""Generate installer/mirrai.ico.

The Inno Setup compiler needs a Setup.ico to put on the generated setup
executable, and the copy that ships with some installations is incomplete.
This writes a small multi-resolution icon instead, so the build does not
depend on the host having Inno Setup's own resources.

    python3 scripts/windows/make-icon.py
"""
import math
import struct
import os

SIZES = [16, 24, 32, 48, 64, 128, 256]

BG_TOP = (0x6E, 0x5A, 0xC8)      # rgb, top of the gradient
BG_BOTTOM = (0x2A, 0x1F, 0x4E)   # rgb, bottom of the gradient
HEART = (0xFF, 0xE3, 0xEC)


def rounded_rect_alpha(x, y, size, radius):
    """Coverage of a rounded square for a pixel at (x, y)."""
    cx = min(max(x, radius), size - 1 - radius)
    cy = min(max(y, radius), size - 1 - radius)
    dx, dy = x - cx, y - cy
    return dx * dx + dy * dy <= radius * radius


def heart_alpha(x, y, size):
    """Coverage of the classic heart curve, centred in the icon."""
    s = size / 16.0
    # Heart curve: (x^2 + y^2 - 1)^3 - x^2 * y^3 <= 0
    hx = (x - size / 2.0) / (s * 4.6)
    hy = -(y - size * 0.54) / (s * 4.6)
    val = (hx * hx + hy * hy - 1) ** 3 - hx * hx * hy * hy * hy
    if val > 0:
        return 0
    # Soften the edge a little.
    edge = min(1.0, max(0.0, (0.35 - val) * 6))
    return edge


def render(size):
    """Returns BGRA pixel rows, bottom-up as the BMP format expects."""
    radius = max(2, int(size * 0.22))
    rows = []
    for y in range(size):
        row = bytearray()
        for x in range(size):
            r, g, b, a = 0, 0, 0, 0
            if rounded_rect_alpha(x + 0.5, y + 0.5, size, radius):
                t = y / max(1, size - 1)
                r = int(BG_TOP[0] + (BG_BOTTOM[0] - BG_TOP[0]) * t)
                g = int(BG_TOP[1] + (BG_BOTTOM[1] - BG_TOP[1]) * t)
                b = int(BG_TOP[2] + (BG_BOTTOM[2] - BG_TOP[2]) * t)
                a = 255
                h = heart_alpha(x + 0.5, y + 0.5, size)
                if h > 0:
                    r = int(r + (HEART[0] - r) * h)
                    g = int(g + (HEART[1] - g) * h)
                    b = int(b + (HEART[2] - b) * h)
            row += bytes((b, g, r, a))
        rows.append(bytes(row))
    rows.reverse()  # bottom-up
    return rows


def bmp_for(size):
    rows = render(size)
    header = struct.pack(
        "<IiiHHIIiiII",
        40, size, size * 2, 1, 32, 0, len(rows) * size, 0, 0, 0, 0,
    )
    pixels = b"".join(rows)
    mask_row = ((size + 31) // 32) * 4
    mask = b"\x00" * (mask_row * size)
    return header + pixels + mask


def write_ico(path):
    images = [bmp_for(s) for s in SIZES]
    out = bytearray(struct.pack("<HHH", 0, 1, len(images)))
    offset = 6 + 16 * len(images)
    for size, data in zip(SIZES, images):
        out += struct.pack(
            "<BBBBHHII",
            0 if size >= 256 else size,
            0 if size >= 256 else size,
            0, 0, 1, 32, len(data), offset,
        )
        offset += len(data)
    for data in images:
        out += data
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "wb") as fh:
        fh.write(out)
    print(f"wrote {path} ({len(out)} bytes, sizes {SIZES})")


if __name__ == "__main__":
    here = os.path.dirname(os.path.abspath(__file__))
    write_ico(os.path.join(here, "..", "..", "installer", "mirrai.ico"))
