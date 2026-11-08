#!/usr/bin/env python3
"""Writes the placeholder app icon: 1024x1024, a plain green background with a white "N".

No fonts, no libraries, no external assets: the letter is three bars drawn pixel by pixel and the PNG
is written with zlib. Opaque RGB, as App Store Connect requires. Replace it with the real icon later.

    python3 ios/scripts/make-placeholder-icon.py
"""
import os
import struct
import zlib

SIZE = 1024
BACKGROUND = (0x2E, 0x7D, 0x5B)  # a calm green
LETTER = (0xFF, 0xFF, 0xFF)

LEFT, RIGHT = 300, 724  # outer edges of the N
TOP, BOTTOM = 270, 754
BAR = 110  # stroke width


def in_letter(x: int, y: int) -> bool:
    if not (TOP <= y < BOTTOM and LEFT <= x < RIGHT):
        return False
    if x < LEFT + BAR or x >= RIGHT - BAR:
        return True
    # The diagonal from the top of the left bar to the bottom of the right bar.
    t = (y - TOP) / (BOTTOM - TOP)
    centre = LEFT + BAR / 2 + t * ((RIGHT - BAR / 2) - (LEFT + BAR / 2))
    return abs(x - centre) < BAR * 0.62


def png(width: int, height: int, rows: bytes) -> bytes:
    def chunk(kind: bytes, data: bytes) -> bytes:
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data) & 0xFFFFFFFF)

    header = struct.pack(">IIBBBBB", width, height, 8, 2, 0, 0, 0)  # 8-bit RGB, no alpha
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", header) + chunk(b"IDAT", zlib.compress(rows, 9)) + chunk(b"IEND", b"")


def main() -> None:
    rows = bytearray()
    for y in range(SIZE):
        rows.append(0)  # filter: none
        for x in range(SIZE):
            rows.extend(LETTER if in_letter(x, y) else BACKGROUND)
    here = os.path.dirname(os.path.abspath(__file__))
    out = os.path.join(here, "..", "App", "Assets.xcassets", "AppIcon.appiconset", "AppIcon-1024.png")
    with open(out, "wb") as f:
        f.write(png(SIZE, SIZE, bytes(rows)))
    print(os.path.normpath(out))


if __name__ == "__main__":
    main()
