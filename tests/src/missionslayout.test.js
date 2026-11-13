/**
 * Geometry tests for the W2 mission UI. These exist because W1's audit found layout collisions that
 * a pixel probe missed — every rectangle is checked for overlap, containment and text fit here.
 */
import {
  SCREEN, MISSION_PANEL, MISSION_LIST_TITLE, TITLE_BANDS, TITLE_BEST_X, TITLE_BEST_Y,
  rect, overlaps, insideScreen, missionPanelLayout, missionListLayout, toastSlot,
  charsThatFit, ellipsize,
} from '../../src/ui/MissionsLayout.js';

describe('overlaps / insideScreen', () => {
  test('detects overlap and respects a required gap', () => {
    const a = rect(0, 0, 10, 10);
    expect(overlaps(a, rect(5, 5, 10, 10))).toBe(true);
    expect(overlaps(a, rect(10, 0, 10, 10))).toBe(false);
    expect(overlaps(a, rect(10, 0, 10, 10), 1)).toBe(true);
  });

  test('touching edges are not an overlap', () => {
    expect(overlaps(rect(0, 0, 10, 10), rect(0, 10, 10, 10))).toBe(false);
  });

  test('insideScreen rejects anything past the virtual viewport', () => {
    expect(insideScreen(rect(0, 0, 480, 270))).toBe(true);
    expect(insideScreen(rect(0, 0, 481, 270))).toBe(false);
    expect(insideScreen(rect(0, 262, 100, 9))).toBe(false);
    expect(insideScreen(rect(-1, 0, 10, 10))).toBe(false);
  });
});

describe('missionPanelLayout', () => {
  test('every rect is inside the screen for 0..3 missions', () => {
    for (let n = 0; n <= 3; n++) {
      const L = missionPanelLayout(n);
      expect(insideScreen(L.panel)).toBe(true);
      expect(insideScreen(L.header)).toBe(true);
      for (const r of [...L.rows, ...L.bars]) expect(insideScreen(r)).toBe(true);
    }
  });

  test('rows never overlap each other or their own bar', () => {
    for (let n = 1; n <= 3; n++) {
      const L = missionPanelLayout(n);
      for (let i = 0; i < L.rows.length; i++) {
        expect(overlaps(L.rows[i], L.bars[i])).toBe(false);
        for (let j = i + 1; j < L.rows.length; j++) {
          expect(overlaps(L.rows[i], L.rows[j])).toBe(false);
          expect(overlaps(L.bars[i], L.bars[j])).toBe(false);
        }
      }
    }
  });

  test('the header clears the first row', () => {
    const L = missionPanelLayout(3);
    expect(overlaps(L.header, L.rows[0])).toBe(false);
  });

  test('the panel grows with the mission count and never exceeds its band', () => {
    const one = missionPanelLayout(1).panel;
    const three = missionPanelLayout(3).panel;
    expect(three.h).toBeGreaterThan(one.h);
    expect(insideScreen(three)).toBe(true);
  });

  test('clamps an out-of-range count instead of drawing off-screen', () => {
    expect(missionPanelLayout(9).rows).toHaveLength(MISSION_PANEL.rows);
    expect(missionPanelLayout(-2).rows).toHaveLength(0);
    expect(missionPanelLayout(undefined).rows).toHaveLength(0);
  });

  test('the panel does not collide with the Title menu band', () => {
    // The Title list starts at y=178; the in-run panel is well clear of it.
    const L = missionPanelLayout(3);
    expect(overlaps(L.panel, rect(0, MISSION_LIST_TITLE.y, 480, 60))).toBe(false);
  });
});

describe('missionListLayout', () => {
  test('every rect is inside the screen for 0..3 missions', () => {
    for (let n = 0; n <= 3; n++) {
      const L = missionListLayout(n);
      expect(insideScreen(L.panel)).toBe(true);
      for (const r of [...L.rows, ...L.bars]) expect(insideScreen(r)).toBe(true);
    }
  });

  test('rows and bars do not overlap each other', () => {
    const L = missionListLayout(3);
    for (let i = 0; i < L.rows.length; i++) {
      expect(overlaps(L.rows[i], L.bars[i])).toBe(false);
      for (let j = i + 1; j < L.rows.length; j++) {
        expect(overlaps(L.rows[i], L.rows[j])).toBe(false);
        expect(overlaps(L.bars[i], L.bars[j])).toBe(false);
      }
    }
  });

  test('the list clears the Title menu and the DAILY PATCH strip', () => {
    // These are the real occupied bands on TitleScene, not guesses: menu+controls y92..196 and the
    // daily panel y202..228. A mission list that overlapped either would cover live UI.
    const L = missionListLayout(3);
    expect(overlaps(L.panel, TITLE_BANDS.menu)).toBe(false);
    expect(overlaps(L.panel, TITLE_BANDS.daily)).toBe(false);
    expect(L.panel.y).toBeGreaterThanOrEqual(TITLE_BANDS.daily.y + TITLE_BANDS.daily.h);
    // And it must not run off the bottom of a 270 px screen. The first version of this list landed
    // 1 px from the edge (bottom 269), which reads as clipped — require a real margin.
    expect(insideScreen(L.panel)).toBe(true);
    expect(SCREEN.h - (L.panel.y + L.panel.h)).toBeGreaterThanOrEqual(4);
  });

  test('the list does not collide with the BEST line or the control hint', () => {
    // Luna's W2 finding 3: the full-width list was drawn across y 229..264, over BEST (y 239) and the
    // hint (y 258). The pixel probe passed because it only asked "is there ink?", never "does this
    // rect land on that text?". These are the assertions that were missing.
    const L = missionListLayout(3);
    expect(overlaps(L.panel, TITLE_BANDS.best)).toBe(false);
    expect(overlaps(L.panel, TITLE_BANDS.hint)).toBe(false);
    for (const r of [...L.rows, ...L.bars]) {
      expect(overlaps(r, TITLE_BANDS.best)).toBe(false);
      expect(overlaps(r, TITLE_BANDS.hint)).toBe(false);
    }
  });

  test('BEST sits to the right of the list and the hint sits below both', () => {
    const L = missionListLayout(3);
    expect(TITLE_BANDS.best.x).toBeGreaterThanOrEqual(L.panel.x + L.panel.w);
    expect(TITLE_BANDS.hint.y).toBeGreaterThanOrEqual(L.panel.y + L.panel.h);
    // BEST shares the band with the list, so only its horizontal clearance is required; the hint must
    // sit fully below the list, which is what makes the band arithmetic work.
    expect(TITLE_BEST_X).toBeGreaterThanOrEqual(L.panel.x + L.panel.w);
    expect(TITLE_BEST_Y).toBeGreaterThanOrEqual(L.panel.y);
    expect(TITLE_BANDS.hint.y).toBeGreaterThanOrEqual(L.panel.y + L.panel.h);
  });

  test('rows stay inside their own row height', () => {
    // The previous geometry put each bar 8 px below a 9 px row, so bars bled into the next row.
    const L = missionListLayout(3);
    for (let i = 0; i < L.rows.length; i++) {
      expect(overlaps(L.rows[i], L.bars[i])).toBe(false);
      expect(L.bars[i].y + L.bars[i].h).toBeLessThanOrEqual(L.panel.y + L.panel.h);
    }
  });

  test('the in-run panel and the Title list do not overlap', () => {
    expect(overlaps(missionPanelLayout(3).panel, missionListLayout(3).panel)).toBe(false);
  });
});

describe('toastSlot', () => {
  test('returns a slot that clears the given HUD strips', () => {
    const strips = [rect(8, 55, 200, 14), rect(8, 70, 200, 10)];
    const slot = toastSlot({ hudStrips: strips });
    expect(slot).not.toBeNull();
    for (const s of strips) expect(overlaps(slot, s, 2)).toBe(false);
    expect(insideScreen(slot)).toBe(true);
  });

  test('with no strips it still returns an on-screen slot', () => {
    const slot = toastSlot({});
    expect(slot).not.toBeNull();
    expect(insideScreen(slot)).toBe(true);
  });

  test('falls back to null rather than drawing over everything when all slots are taken', () => {
    const strips = [rect(0, 55, 480, 60)];
    expect(toastSlot({ hudStrips: strips })).toBeNull();
  });
});

describe('text fit', () => {
  test('charsThatFit is sane for the panel width', () => {
    const L = missionPanelLayout(3);
    expect(charsThatFit(L.rows[0].w)).toBeGreaterThan(10);
    expect(charsThatFit(L.rows[0].w, 0)).toBeGreaterThan(0);
  });

  test('ellipsize shortens only when needed, with one ellipsis', () => {
    expect(ellipsize('short', 300)).toBe('short');
    const long = 'x'.repeat(200);
    const cut = ellipsize(long, 60);
    expect(cut.length).toBeLessThanOrEqual(charsThatFit(60));
    expect(cut.endsWith('…')).toBe(true);
    expect(cut.split('…')).toHaveLength(2);
  });

  test('ellipsize never exceeds the row for any real title', () => {
    const rowW = missionPanelLayout(3).rows[0].w;
    const titles = ['Reach 1500 m in one run', 'Parachute + 2 flip types', 'Every trick, one run', 'Collect 1000 shards total'];
    for (const t of titles) {
      expect(ellipsize(t, rowW).length).toBeLessThanOrEqual(charsThatFit(rowW));
    }
  });

  test('handles junk input without throwing', () => {
    expect(() => ellipsize(null, 60)).not.toThrow();
    expect(() => ellipsize(undefined, 0)).not.toThrow();
    expect(ellipsize('abc', 0)).toBeTruthy();
  });
});
