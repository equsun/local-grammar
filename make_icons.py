"""Draws the extension icons (green rounded square with a white check) using only the stdlib."""
import struct, zlib, os, math

def seg_dist(px, py, ax, ay, bx, by):
    dx, dy = bx - ax, by - ay
    t = max(0, min(1, ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)))
    return math.hypot(px - (ax + t * dx), py - (ay + t * dy))

def pixel(x, y):
    # coordinates in 0..1
    r = 0.22
    cx, cy = min(max(x, r), 1 - r), min(max(y, r), 1 - r)
    if math.hypot(x - cx, y - cy) > r:
        return (0, 0, 0, 0)
    d = min(seg_dist(x, y, 0.26, 0.52, 0.43, 0.69), seg_dist(x, y, 0.43, 0.69, 0.75, 0.33))
    if d < 0.075:
        return (255, 255, 255, 255)
    return (34, 150, 102, 255)

def render(size, ss=4):
    rows = []
    for j in range(size):
        row = bytearray([0])
        for i in range(size):
            acc = [0, 0, 0, 0]
            for sj in range(ss):
                for si in range(ss):
                    p = pixel((i + (si + .5) / ss) / size, (j + (sj + .5) / ss) / size)
                    a = p[3]
                    acc[0] += p[0] * a; acc[1] += p[1] * a; acc[2] += p[2] * a; acc[3] += a
            n = ss * ss
            a = acc[3]
            row += bytes([acc[0] // a if a else 0, acc[1] // a if a else 0, acc[2] // a if a else 0, a // n])
        rows.append(bytes(row))
    raw = b"".join(rows)
    def chunk(t, d):
        return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xffffffff)
    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", size, size, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))

out = os.path.join(os.path.dirname(os.path.abspath(__file__)), "extension", "icons")
for s in (16, 32, 48, 128):
    with open(os.path.join(out, f"icon{s}.png"), "wb") as f:
        f.write(render(s))
print("icons written to", out)
