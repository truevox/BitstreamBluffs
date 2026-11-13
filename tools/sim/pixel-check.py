#!/usr/bin/env python3
"""Pixel-level check of the drawn W1 screens (no PIL: ffmpeg -> raw RGB).

The headed verifier proves where Phaser *intends* to draw; this proves what actually landed on the
canvas of the shipped PNGs. For each screenshot it converts to raw RGB and asserts:

  1. Title: there is text ink in the top-left badge cell, and none in the mirrored top-right cell.
  2. Profile: text ink stays inside the panel, with nothing spilling past any of its four edges.
  3. Profile: no two text rows have merged (band height never exceeds one cap height plus a descender).

Ink = a pixel whose luma clears the local background by a margin, so the neon glow counts too.

Usage: python3 tools/sim/pixel-check.py <shotsDir>
"""
import subprocess
import sys

SCALE = 4  # 480x270 virtual canvas at deviceScaleFactor 2 on a 960x540 viewport


def raw_rgb(path):
    probe = subprocess.run(
        ["ffprobe", "-v", "error", "-select_streams", "v:0",
         "-show_entries", "stream=width,height", "-of", "csv=p=0", path],
        capture_output=True, text=True, check=True)
    w, h = (int(v) for v in probe.stdout.strip().split(",")[:2])
    out = subprocess.run(
        ["ffmpeg", "-v", "error", "-i", path, "-f", "rawvideo", "-pix_fmt", "rgb24", "-"],
        capture_output=True, check=True).stdout
    assert len(out) == w * h * 3, f"raw size {len(out)} != {w}x{h}x3"
    return w, h, out


def px(buf, w, x, y):
    i = (y * w + x) * 3
    return buf[i], buf[i + 1], buf[i + 2]


def luma(p):
    return 0.2126 * p[0] + 0.7152 * p[1] + 0.0722 * p[2]


def region_ink(buf, w, x0, y0, x1, y1, bg, margin=40):
    n = 0
    for y in range(max(0, y0), y1):
        for x in range(max(0, x0), x1):
            if luma(px(buf, w, x, y)) > bg + margin:
                n += 1
    return n


def rows_with_ink(buf, w, x0, y0, x1, y1, bg, margin=40):
    for y in range(y0, y1):
        c = 0
        for x in range(x0, x1):
            if luma(px(buf, w, x, y)) > bg + margin:
                c += 1
        yield y, c


def check_footer_band(path):
    """Game Over: the Resonance bar must not touch the footer hint line.

    CC Friday's PR #17 verification found them overlapping, worst in the initials-entry state, and
    noted the probe never covered that state - which is exactly why it had passed.

    Finding the bar by an x-band does not work: the footer's centred text crosses the same columns,
    and the SYNC LEVEL label sits inside them too. So the bar is identified by SHAPE - a stroked
    rectangle has ink at both its left edge (x~96) and its right edge (x~246) on the same row, while
    text lines are narrower and start further right. The footer is then the first row with ink
    reaching past x 300, since it is centred and much wider than the bar.
    """
    MIN_GAP = 2
    w, h, buf = raw_rgb(path)
    s = w / 480.0

    def ink_x(y):
        row = [x for x in range(0, w) if luma(px(buf, w, x, y)) > 70]
        return (min(row) / s, max(row) / s) if row else None

    def ink_x_at(vy):
        return ink_x(int(vy * s))

    bar_rows, footer_top, seen_bar = [], None, False
    for vy in range(248, 270):
        y = int(vy * s)
        ext = ink_x(y)
        if not ext:
            continue
        lo, hi = ext
        # The bar: spans its whole stroke width, left edge near 96 and right edge near 246.
        if lo <= 104 and 240 <= hi <= 250:
            bar_rows.append(vy)
            seen_bar = True
            continue
        # The footer: wide centred text, well past the bar's right edge.
        if seen_bar and hi > 300:
            footer_top = vy
            break

    name = path.rsplit('/', 1)[-1]
    if not bar_rows:
        print(f"  FAIL: no Resonance bar ink found in {name} (bar missing, or shape test is wrong)")
        return False
    if footer_top is None:
        print(f"  FAIL: no footer hint ink below the bar in {name}")
        return False
    bar_bottom = max(bar_rows)
    gap = footer_top - bar_bottom
    # The band above matters too: moving the bar down to fix the footer put it flush against the XP
    # text row (measured at y 252), so a fix on one side must not create a collision on the other.
    xp_bottom = max((vy for vy in range(240, bar_rows[0]) if ink_x_at(vy)), default=bar_rows[0])
    up_gap = bar_rows[0] - xp_bottom
    good = gap >= MIN_GAP and up_gap >= MIN_GAP
    print(f"gameover {name}: xp ends y{xp_bottom} bar y{bar_rows[0]}..{bar_bottom} footer y{footer_top} "
          f"gaps {up_gap}px above / {gap}px below {'OK' if good else 'COLLISION'}")
    if gap < MIN_GAP:
        print(f"  FAIL: footer hint is {gap}px from the bar (need {MIN_GAP}); they touch or overlap")
    if up_gap < MIN_GAP:
        print(f"  FAIL: the XP row is {up_gap}px from the bar (need {MIN_GAP}); they touch or overlap")
    return good


def main():
    shots = sys.argv[1].rstrip("/")
    ok = True

    # ---- Title: badge ink top-left, nothing mirrored top-right. ----
    w, h, buf = raw_rgb(f"{shots}/w1-title-badge-default.png")
    assert (w, h) == (480 * SCALE, 270 * SCALE), (w, h)
    bg = min(luma(px(buf, w, 4, 4)), luma(px(buf, w, w - 5, 4)))
    badge = region_ink(buf, w, 6 * SCALE, 4 * SCALE, 80 * SCALE, 26 * SCALE, bg)
    mirror = region_ink(buf, w, (480 - 80) * SCALE, 4 * SCALE, (480 - 6) * SCALE, 26 * SCALE, bg)
    print(f"title: badge ink px {badge}, mirrored cell {mirror}")
    if badge < 200:
        ok = False
        print("  FAIL: no level badge ink in the top-left cell")

    # ---- Profile: interior ink only, no row collision. ----
    w, h, buf = raw_rgb(f"{shots}/w1-profile-view-default.png")
    pad = 12 * SCALE
    px0, py0 = (32 + pad), (22 + pad)
    px1, py1 = (32 + 416 - pad), (22 + 224 - 24)
    bg = luma(px(buf, w, (32 + 4) * SCALE, (22 + 4) * SCALE))
    inside = region_ink(buf, w, px0 * SCALE, py0 * SCALE, px1 * SCALE, py1 * SCALE, bg, margin=38)
    print(f"profile: panel interior ink px {inside}")
    if inside < 2000:
        ok = False
        print("  FAIL: panel interior looks empty - the view did not render")

    # A pixel just outside each panel edge: text spill would put thousands of ink px there.
    spill = {}
    for side, (ax0, ay0, ax1, ay1) in {
        "left": (0, 22 * SCALE, 32 * SCALE - 2, 246 * SCALE),
        "right": (448 * SCALE + 2, 22 * SCALE, w, 246 * SCALE),
        "top": (0, 0, w, 22 * SCALE - 2),
        "bottom": (0, 246 * SCALE + 2, w, h),
    }.items():
        # The backdrop outside the panel is an animated scene; only a large edge-adjacent leak is spill.
        n = region_ink(buf, w, ax0, ay0, ax1, ay1, 0, margin=70)
        spill[side] = n
        if n > 3000:
            ok = False
            print(f"  FAIL: {n} ink px outside the panel on the {side} side (text spill)")
    print(f"profile: ink outside panel {spill}")

    # ---- Game Over: Resonance bar vs footer hint, plain AND initials-entry states. ----
    for shot in ('w1-gameover-resonance-default', 'w1-gameover-levelup-default', 'w1-gameover-initials-default'):
        try:
            ok &= check_footer_band(f"{shots}/{shot}.png")
        except FileNotFoundError:
            ok = False
            print(f"  FAIL: missing shot {shot}.png - the layout probe cannot pass without it")

    bands, cur = [], None
    for y, c in rows_with_ink(buf, w, px0 * SCALE + 4, py0 * SCALE, px1 * SCALE - 4, py1 * SCALE, bg, margin=38):
        if c > 0 and cur is None:
            cur = [y, y]
        elif c > 0:
            cur[1] = y
        elif cur is not None:
            bands.append((cur[0], cur[1]))
            cur = None
    if cur is not None:
        bands.append((cur[0], cur[1]))
    tallest = max((b[1] - b[0] + 1) for b in bands) if bands else 0
    # One row is 7 cap px (28 at scale 4) + 1 descender px (4) = 32. Taller means two rows merged.
    print(f"profile: {len(bands)} text bands, tallest {tallest}px (cap {7 * SCALE}px, +descender {8 * SCALE}px)")
    merged = [b for b in bands if b[1] - b[0] + 1 > 8 * SCALE]
    if merged:
        ok = False
        print(f"  FAIL: merged text rows at {merged}")
    if len(bands) < 10:
        ok = False
        print(f"  FAIL: only {len(bands)} text bands - expected the full stats and biome grid")

    print("PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
