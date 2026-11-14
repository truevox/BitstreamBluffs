/**
 * Leaderboard footer geometry: the footnote and the MODDED/CLEAN tab share a line, so their boxes must be
 * proven disjoint rather than eyeballed.
 *
 * The defect this pins: W4 added the tab at panel-local x 272 and left the footnote at 329px wide, drawn
 * from x 12. They overlapped by 30px on the horizontal axis and 5.5px vertically, and the tab's border ran
 * through the footnote's last word — on BOTH boards. Neither the unit suite nor `gate-playthrough` caught it:
 * the leaderboard step read the tab's LABEL only, never the drawn rects. So this file asserts the boxes, and
 * the gate step now reads the rects too.
 */
import {
  ledgerFooterLayout, LEDGER_FOOTNOTE, LEDGER_PANEL, LEDGER_FOOT_GAP,
} from '../../src/ui/LeaderboardLayout.js';
import { measureText, ellipsize } from '../../src/ui/PixelFont.js';
import { GAME_HEIGHT } from '../../src/constants.js';

const overlaps = (a, b) => !(a.x + a.w <= b.x || b.x + b.w <= a.x || a.y + a.h <= b.y || b.y + b.h <= a.y);

const box = (x, y, w, h) => ({ x, y, w, h });

describe('leaderboard footer: the board tab and the footnote are disjoint', () => {
  test('the footnote is narrower than the space before the tab, without being truncated', () => {
    const f = ledgerFooterLayout();
    // `fits` compares the INTENDED text to the bound: a footnote that only fits once ellipsized is too long
    // for its line, and ellipsizing it would hide the regression behind "..".
    expect(f.fits).toBe(true);
    expect(measureText(f.text)).toBeLessThanOrEqual(f.footMaxW);
    expect(f.text).toBe(LEDGER_FOOTNOTE);
    expect(f.text).not.toMatch(/\.\.$/);
  });

  test('the footnote box and the tab box do not intersect (glyph ink, not the padded rect)', () => {
    const f = ledgerFooterLayout();
    const inkH = 8; // 7 cap rows + descender, the same conservative box the layout modules use
    const foot = box(f.footX, f.footY, f.textW, inkH);
    const tab = box(f.tab.x, f.tab.y, f.tab.w, f.tab.h);
    expect(overlaps(foot, tab)).toBe(false);
    // And the gap is real, not a 0px touch that rounds into an overlap at a different font scale.
    expect(foot.x + foot.w + LEDGER_FOOT_GAP).toBeLessThanOrEqual(tab.x);
  });

  test('the gap between them clears the declared minimum', () => {
    const f = ledgerFooterLayout();
    // At least the constant — the footnote is allowed to be SHORTER than its bound (a shorter legend is the
    // safe direction); what must never happen is the gap closing to zero.
    expect(f.tabLeft - (f.footX + f.textW)).toBeGreaterThanOrEqual(LEDGER_FOOT_GAP);
  });

  test('both stay inside the panel and the screen', () => {
    const f = ledgerFooterLayout();
    const panel = box(0, 0, LEDGER_PANEL.w, LEDGER_PANEL.h);
    const foot = box(f.footX, f.footY, f.textW, 8);
    const tab = box(f.tab.x, f.tab.y, f.tab.w, f.tab.h);
    expect(overlaps(foot, panel)).toBe(true); // inside, by construction
    expect(foot.x).toBeGreaterThanOrEqual(0);
    expect(foot.x + foot.w).toBeLessThanOrEqual(panel.w);
    expect(tab.x + tab.w).toBeLessThanOrEqual(panel.w);
    expect(foot.y + 8).toBeLessThanOrEqual(panel.h);
    expect(tab.y + tab.h).toBeLessThanOrEqual(panel.h);
    // The panel is drawn at y 40 and must fit the 270px virtual canvas.
    expect(LEDGER_PANEL.y + LEDGER_PANEL.h).toBeLessThanOrEqual(GAME_HEIGHT);
  });

  test('the tab does not cover the BACK button', () => {
    // BACK is `x: w - 76, y: h - 22, w: 68, h: 16` in the base View. The tab sits one row above it, so the
    // two share the footer band; they must not collide.
    const f = ledgerFooterLayout();
    const back = box(LEDGER_PANEL.w - 76, LEDGER_PANEL.h - 22, 68, 16);
    expect(overlaps(box(f.tab.x, f.tab.y, f.tab.w, f.tab.h), back)).toBe(false);
  });

  test('the wide label really does not fit — the reason the wording was shortened', () => {
    // The pre-W4 wording, kept here as the counter-example so a future edit cannot quietly restore it.
    const old = 'ONE LEDGER PER DEVICE. MAGENTA RULE FLAG = DAILY PATCH ACTIVE.';
    const f = ledgerFooterLayout();
    expect(measureText(old)).toBeGreaterThan(f.footMaxW);
    // And ellipsize would have silently truncated it rather than failing, which is why `fits` compares the
    // full text.
    expect(ellipsize(old, f.footMaxW)).not.toBe(old);
  });
});
