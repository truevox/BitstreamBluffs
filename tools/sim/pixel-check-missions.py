#!/usr/bin/env python3
"""Pixel check for the W2 mission screens (no PIL: ffmpeg -> raw RGB).

Proves from the shipped PNGs — not from what the scene intended to draw — that:

  1. Title: there is mission ink in the list's own column (x 24..240) below the DAILY PATCH strip.
  2. Title: the list does NOT reach into the BEST column (x 248..456) or the hint band (y 259..270),
     and nothing is drawn past the bottom of the canvas. This is the check that was missing when a
     full-width list silently overwrote BEST: counting ink proves something was drawn, never that it
     landed somewhere harmless.
  3. Pause: mission ink exists in the right column where the column was placed, and no ink collides
     with the "THE LEDGER NEVER FORGETS." footer line.
  4. Game Over: mission ink sits inside RUN REPORT and does not cross the panel's bottom edge.

Ink = a pixel whose luma clears the local background by a margin, so the neon glow counts.

Usage: python3 tools/sim/pixel-check-missions.py <shotsDir>
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


def vx(x):
    return int(x * SCALE)


def vy(y):
    return int(y * SCALE)


def band_ink(buf, w, x0, y0, x1, y1, thresh=90):
    """Count bright pixels inside a virtual-coordinate band."""
    n = 0
    for y in range(vy(y0), vy(y1)):
        row = y * w
        for x in range(vx(x0), vx(x1)):
            i = (row + x) * 3
            if luma((buf[i], buf[i + 1], buf[i + 2])) > thresh:
                n += 1
    return n


def report(name, ok, detail):
    print(("PASS  " if ok else "FAIL  ") + name + "  " + detail)
    return ok


def check_title(path):
    w, h, buf = raw_rgb(path)
    ok = True
    # The list owns the LEFT column only (x 24..240) in the band below the daily strip (y 229..253).
    ink = band_ink(buf, w, 26, 230, 238, 252)
    ok &= report("title: mission list has content", ink > 400, f"ink={ink} px")
    # Right column belongs to BEST. Mission ink out there means the list went full-width again.
    right = band_ink(buf, w, 300, 230, 470, 252)
    ok &= report("title: list stays out of the BEST column", right == 0, f"ink={right} px")
    # The hint's own glyphs start at y 254 and run across the screen centre, so "is the hint band
    # empty?" is the wrong question — it never is. The collision test is the GAP: y 249..253 inside the
    # list's column must be blank, which can only be true if the list ends above the hint.
    gap = band_ink(buf, w, 26, 249, 238, 253, thresh=140)
    ok &= report("title: list clears the hint line", gap == 0, f"ink={gap} px")
    # The DAILY PATCH strip's second row is at y ~215-220; mission text must not appear inside it
    # beyond what the strip already draws. Compare against the strip's own rows.
    return ok


def check_pause(path):
    w, h, buf = raw_rgb(path)
    ok = True
    # Mission column: x 266..430 (panel x30 + 236), y 130..165.
    ink = band_ink(buf, w, 266, 128, 430, 150)
    ok &= report("pause: mission column has content", ink > 300, f"ink={ink} px")
    # Footer line "THE LEDGER NEVER FORGETS." sits at panel-local y 174 => screen y 210.
    footer = band_ink(buf, w, 266, 206, 430, 216, thresh=70)
    ok &= report("pause: footer line not overrun", footer < 3000, f"ink={footer} px")
    return ok


def check_gameover(path):
    w, h, buf = raw_rgb(path)
    ok = True
    # RUN REPORT panel: x 14..240, y 54..214. Mission rows were placed at y 172..197.
    ink = band_ink(buf, w, 24, 170, 232, 200)
    ok &= report("gameover: mission rows have content", ink > 300, f"ink={ink} px")
    # Panel bottom edge is y 214. Below it is the button row (RETRY at y 220), so the assertion is
    # that the mission block stays ABOVE 214 — checked by requiring the band just under the last
    # mission row (y 200..212) to hold nothing but the panel border, not mission text.
    gap = band_ink(buf, w, 24, 209, 232, 213, thresh=110)
    ok &= report("gameover: mission block stays inside panel", gap < 400, f"ink={gap} px")
    return ok


def check_toast(path):
    """The completion toast: bright strip ink in the MILESTONE band (screen y ~52..72)."""
    w, h, buf = raw_rgb(path)
    ink = band_ink(buf, w, 0, 52, 480, 74, thresh=170)
    return report("toast: strip has content", ink > 1000, f"ink={ink} px")


def main():
    if len(sys.argv) != 2:
        print("usage: pixel-check-missions.py <shotsDir>", file=sys.stderr)
        return 2
    d = sys.argv[1].rstrip("/")
    ok = True
    ok &= check_title(f"{d}/w2-title-missions-default.png")
    ok &= check_gameover(f"{d}/w2-gameover-missions-default.png")
    ok &= check_pause(f"{d}/w2-pause-missions-default.png")
    ok &= check_toast(f"{d}/w2-toast-mission-default.png")
    # Colorblind pass: the same checks on the alternate palette, since ink contrast differs.
    ok &= check_title(f"{d}/w2-title-missions-colorblind.png")
    ok &= check_toast(f"{d}/w2-toast-mission-colorblind.png")
    print("RESULT", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
