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


# A glyph is 8 font rows tall (FONT_LINE_H 9 = 8 + gap). Ink runs measured off a real capture were
# 7 virtual px per line, so a legible row must show at least this many consecutive ink rows.
GLYPH_INK_H = 6
# Vertical gap required between one row's ink and the next. Pitch is FONT_LINE_H (9): 7 glyph rows,
# 1 descender row, 1 gap. A line whose text has a descender ("Merge lanes", "0.9 s of air") inks 8
# rows and legitimately leaves only the 1 gap row, so the floor is 1 virtual px, not 2. The clamp that
# actually catches a bar drawn over a label is MAX_ROW_INK_H below: overlapping rows merge into one
# run roughly twice as tall, and no single text line can exceed the font's 8 ink rows.
MIN_ROW_GAP = 1
# Tallest legitimate single-row ink run: 7 glyph rows + 1 descender row.
MAX_ROW_INK_H = 9


def ink_runs(buf, w, x0, x1, y0, y1, thresh=110, min_px=3):
    """Contiguous virtual-y runs that contain ink inside a virtual-x band.

    Returns [(startY, endY)] in virtual pixels. This is what turns "is there ink?" into "is each line
    of text its full height, with a real gap to the next line?" — the question the old probe never
    asked, which is why it passed while every mission row was sliced in half.
    """
    runs = []
    cur = None
    last = None
    for Y in range(vy(y0), vy(y1)):
        row = Y * w
        n = 0
        for x in range(vx(x0), vx(x1)):
            i = (row + x) * 3
            if luma((buf[i], buf[i + 1], buf[i + 2])) > thresh:
                n += 1
        ink = n >= min_px
        y = Y / SCALE
        if cur is None or cur[0] != ink:
            if cur and cur[0]:
                runs.append((cur[1], last))
            cur = [ink, y]
        last = y
    if cur and cur[0]:
        runs.append((cur[1], last))
    return runs


def check_legible(name, buf, w, x0, x1, y0, y1, want_rows, thresh=110):
    """Every text row in a band must be full glyph height with a real gap to the next."""
    ok = True
    runs = ink_runs(buf, w, x0, x1, y0, y1, thresh=thresh)
    heights = [round(b - a + 0.25, 2) for a, b in runs]
    ok &= report(f"{name}: {want_rows} readable text rows", len(runs) >= want_rows,
                 f"lines={len(runs)} heights={heights}")
    if runs:
        shortest = min(heights)
        ok &= report(f"{name}: every line is full glyph height", shortest >= GLYPH_INK_H,
                     f"shortest={shortest} px (need >= {GLYPH_INK_H})")
    if len(runs) >= 2:
        gaps = [round(runs[i][0] - runs[i - 1][1], 2) for i in range(1, len(runs))]
        tightest = min(gaps)
        ok &= report(f"{name}: lines never merge into each other", tightest >= MIN_ROW_GAP,
                     f"gaps={gaps} tightest={tightest} px (need >= {MIN_ROW_GAP})")
    # No single line may be taller than the font's ink: a run twice that height means two lines (or a
    # line and a bar) are overlapping and read as one slab.
    if heights:
        tallest = max(heights)
        ok &= report(f"{name}: no line overlaps another", tallest <= MAX_ROW_INK_H,
                     f"tallest={tallest} px (need <= {MAX_ROW_INK_H})")
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
    # CC Friday's finding at native resolution: each mission row's text was cut roughly in half
    # vertically by the next row's bar. Ink existing proves nothing about that, so measure the actual
    # line heights and the gaps between them in the list's own column.
    ok &= check_legible("title: mission rows", buf, w, 26, 200, 228, 258, want_rows=3)
    # The control hint must still sit below the list with a real gap, not glued to the last row.
    # x 244..470 excludes the list panel's own bottom border (x 24..240, y 255) so this measures the
    # hint text, not the frame around the list.
    tail = ink_runs(buf, w, 244, 470, 252, 268)
    if tail:
        ok &= report("title: hint line stays below the list", tail[0][0] >= 256,
                     f"first hint ink y={tail[0][0]}")
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


def check_gameover(path, label="gameover"):
    w, h, buf = raw_rgb(path)
    ok = True
    # The mission block lives in the LEDGER panel (x 250..466, y 54..214): local 128..157 -> screen
    # 182..211. Luna's round-2 finding was the first attempt hanging past the panel and through the
    # retry buttons, so this checks for content here AND emptiness in the button band.
    ink = band_ink(buf, w, 258, 182, 460, 212)
    ok &= report(f"{label}: mission rows have content", ink > 300, f"ink={ink} px")
    # CC Friday read these rows as sliced at native resolution; measuring line heights is the only
    # check that can tell a legible row from a half-covered one.
    ok &= check_legible(f"{label}: mission rows", buf, w, 258, 420, 180, 214, want_rows=3)
    # The button band legitimately holds the RETRY / NEW SEED / TITLE labels, so "no ink there" is
    # wrong — that assertion failed on the buttons themselves, not on missions. What must be true is
    # that the mission block ends above the band: its lowest ink row has to be inside the panel.
    rows = [vy for vy in range(182, 216) if band_ink(buf, w, 258, vy, 460, vy + 1) > 0]
    last = max(rows) if rows else 0
    ok &= report(f"{label}: mission block ends above the button band", 0 < last < 214, f"last mission row y={last}")
    below = band_ink(buf, w, 250, 214, 470, 219)
    ok &= report(f"{label}: mission block stays inside the ledger panel", below == 0, f"ink={below} px")
    return ok


def check_entry_stack(path, label="gameover-initials"):
    """The initials-entry stack must be ordered and disjoint: letters, SAVE button, then hints.

    CC Friday's blocking regression at 7617a80: the legibility fix moved the hint lines up to clear the
    mission separator, and the SAVE button (drawn by the entry widget) ended up ON TOP of both hint
    lines, covering their middle. Glyph-height checks cannot see this — each hint line is still full
    height, it is simply drawn under a box. Only an overlap assertion between the SAVE rect and the
    hint rects catches it, so that is what this measures: the SAVE band must END before the first hint
    band STARTS, with a real gap.

    Panel-local reference (screen = local + panel origin 250,54):
      88..104   SAVE button        -> screen 142..158
     106..114   hint 1             -> screen 160..168
     116..124   hint 2             -> screen 170..178
    """
    w, h, buf = raw_rgb(path)
    ok = True
    PX0, PX1 = 300, 420          # inside the LEDGER panel's text column
    save_y0, save_y1 = 142, 158  # local 88..104
    hint_y0, hint_y1 = 158, 180  # local 104..126, where both hints must live
    save_ink = band_ink(buf, w, PX0, save_y0, PX1, save_y1, thresh=110)
    ok &= report(f"{label}: SAVE button band has content", save_ink > 200, f"ink={save_ink} px")
    hints = ink_runs(buf, w, PX0, PX1, hint_y0, hint_y1, thresh=110)
    ok &= report(f"{label}: both hint lines present below SAVE", len(hints) >= 2,
                 f"lines={len(hints)} runs={[(round(a,2), round(b,2)) for a, b in hints]}")
    if hints:
        first_hint_top = min(a for a, _ in hints)
        # The assertion the old probe lacked. A hint line starting inside the SAVE band means the
        # button box is drawn over it.
        ok &= report(f"{label}: SAVE ends before the first hint starts",
                     first_hint_top >= save_y1, f"first hint top={round(first_hint_top,2)} save bottom={save_y1}")
        gap = round(first_hint_top - save_y1, 2)
        ok &= report(f"{label}: SAVE and hints leave a real gap", gap >= 1.5, f"gap={gap} px")
        # And each hint must be a full glyph row, not a sliver peeking out from under the button.
        heights = [round(b - a + 0.25, 2) for a, b in hints[:2]]
        ok &= report(f"{label}: hint lines are full glyph height",
                     min(heights) >= GLYPH_INK_H, f"heights={heights} (need >= {GLYPH_INK_H})")
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
    # The initials-entry state is the one CC Friday found unreadable and the one the probe never
    # captured. Same legibility assertions, different screen.
    ok &= check_gameover(f"{d}/w2-gameover-initials-default.png", label="gameover-initials")
    # The initials stack's own ordering assertion — SAVE must not be drawn over the hint lines.
    ok &= check_entry_stack(f"{d}/w2-gameover-initials-default.png")
    ok &= check_entry_stack(f"{d}/w2-gameover-initials-colorblind.png", label="gameover-initials-colorblind")
    ok &= check_pause(f"{d}/w2-pause-missions-default.png")
    ok &= check_toast(f"{d}/w2-toast-mission-default.png")
    # Colorblind pass: the same checks on the alternate palette, since ink contrast differs.
    ok &= check_title(f"{d}/w2-title-missions-colorblind.png")
    ok &= check_toast(f"{d}/w2-toast-mission-colorblind.png")
    print("RESULT", "PASS" if ok else "FAIL")
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main())
