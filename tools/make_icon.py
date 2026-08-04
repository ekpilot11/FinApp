"""Generates FinApp's 1024x1024 app icon as a PNG.

No PIL on this machine, so the PNG is written by hand and the shapes are
antialiased analytically from a signed distance field rather than by
supersampling — a capsule is just "within r of a line segment", which gives
exact coverage at a fraction of the cost.

The mark is five rounded bars on a green gradient. Vertically centred, it
reads as an audio waveform; the varying heights read as a bar chart. Those
are precisely the app's two halves, which is why this shape and not a mic.

App Store icons must have no alpha channel, so this is RGB, fully opaque,
square — iOS applies the rounded-corner mask itself.
"""

import struct
import zlib

SIZE = 1024

# Gradient, top-left to bottom-right. Tuned to the app's AccentColor.
TOP = (0x3B, 0xE0, 0x7F)
BOTTOM = (0x0A, 0x8A, 0x57)
BAR = (255, 255, 255)

# Five bars, heights as a fraction of the tallest. Rise-and-fall rather than a
# straight ramp so it stays legible mirrored or at 60px.
HEIGHTS = [0.42, 0.70, 1.00, 0.78, 0.50]
BAR_WIDTH = 86.0
BAR_GAP = 62.0
MAX_BAR_HEIGHT = 620.0


def clamp(value, low=0.0, high=1.0):
    return low if value < low else high if value > high else value


def build_bars():
    """Capsules as (centre x, segment top y, segment bottom y, radius)."""
    total = len(HEIGHTS) * BAR_WIDTH + (len(HEIGHTS) - 1) * BAR_GAP
    left = (SIZE - total) / 2.0
    radius = BAR_WIDTH / 2.0
    centre_y = SIZE / 2.0

    bars = []
    for index, fraction in enumerate(HEIGHTS):
        height = MAX_BAR_HEIGHT * fraction
        cx = left + index * (BAR_WIDTH + BAR_GAP) + radius
        # Inset the segment by the radius so the caps land on the bar's extent.
        half = max(height / 2.0 - radius, 0.0)
        bars.append((cx, centre_y - half, centre_y + half, radius))
    return bars


def coverage(x, y, bar):
    """Antialiased coverage of one capsule, 0...1."""
    cx, y0, y1, radius = bar
    dx = x - cx
    dy = 0.0 if y0 <= y <= y1 else (y - y0 if y < y0 else y - y1)
    distance = (dx * dx + dy * dy) ** 0.5
    # Half-pixel ramp across the boundary.
    return clamp(radius - distance + 0.5)


def render():
    bars = build_bars()
    # Only the columns spanned by a bar need the distance test.
    x_min = int(min(b[0] - b[3] for b in bars)) - 2
    x_max = int(max(b[0] + b[3] for b in bars)) + 2
    y_min = int(min(b[1] for b in bars) - bars[0][3]) - 2
    y_max = int(max(b[2] for b in bars) + bars[0][3]) + 2

    rows = []
    for y in range(SIZE):
        row = bytearray(SIZE * 3)
        py = y + 0.5
        in_band = y_min <= y <= y_max

        for x in range(SIZE):
            t = (x + y) / (2.0 * (SIZE - 1))
            r = TOP[0] + (BOTTOM[0] - TOP[0]) * t
            g = TOP[1] + (BOTTOM[1] - TOP[1]) * t
            b = TOP[2] + (BOTTOM[2] - TOP[2]) * t

            if in_band and x_min <= x <= x_max:
                px = x + 0.5
                alpha = 0.0
                for bar in bars:
                    if abs(px - bar[0]) > bar[3] + 2:
                        continue
                    alpha = max(alpha, coverage(px, py, bar))
                if alpha > 0.0:
                    r += (BAR[0] - r) * alpha
                    g += (BAR[1] - g) * alpha
                    b += (BAR[2] - b) * alpha

            offset = x * 3
            row[offset] = int(r + 0.5)
            row[offset + 1] = int(g + 0.5)
            row[offset + 2] = int(b + 0.5)

        rows.append(bytes(row))
    return rows


def write_png(path, rows):
    def chunk(kind, payload):
        return (
            struct.pack(">I", len(payload))
            + kind
            + payload
            + struct.pack(">I", zlib.crc32(kind + payload) & 0xFFFFFFFF)
        )

    raw = b"".join(b"\x00" + row for row in rows)
    data = b"\x89PNG\r\n\x1a\n"
    # Colour type 2 = truecolour RGB, i.e. no alpha channel.
    data += chunk(b"IHDR", struct.pack(">IIBBBBB", SIZE, SIZE, 8, 2, 0, 0, 0))
    data += chunk(b"IDAT", zlib.compress(raw, 9))
    data += chunk(b"IEND", b"")

    with open(path, "wb") as handle:
        handle.write(data)


if __name__ == "__main__":
    import sys

    destination = sys.argv[1]
    write_png(destination, render())
    print(f"wrote {destination}")
