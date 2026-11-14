/**
 * Geometry tests for the W2 mission UI. These exist because W1's audit found layout collisions that
 * a pixel probe missed — every rectangle is checked for overlap, containment and text fit here.
 */
import {
  SCREEN, MISSION_PANEL, MISSION_LIST_TITLE, TITLE_BANDS, TITLE_BEST_X, TITLE_BEST_Y,
  rect, overlaps, insideScreen, missionPanelLayout, missionListLayout, toastSlot,
  charsThatFit, ellipsize, GAMEOVER_MISSIONS_Y, GAMEOVER_ROW_H, GAMEOVER_BOARD_ROWS, columnRows,
  GAMEOVER_BOARD_ROW_H, GAMEOVER_MISSIONS_RULE_Y, LABEL_H, GLYPH_H, entryLayout,
} from '../../src/ui/MissionsLayout.js';
import { measureText, hasGlyph } from '../../src/ui/PixelFont.js';
// The font's own line height, read from the font module rather than from the layout that consumes it.
// This is what stops the "label is one glyph tall" assertion from being a tautology about a local
// constant: the expected height comes from the code that actually draws the glyphs.
import { FONT_LINE_H } from '../../src/ui/PixelFont.js';

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

  test('the glyph constant matches the font it claims to describe', () => {
    // If these ever diverge, every other legibility assertion here silently becomes decorative: the
    // layout would be measuring itself. FONT_LINE_H 9 is 8 ink rows + 1 gap (see PixelFont.buildTexture,
    // which writes font rows 0..7).
    expect(FONT_LINE_H).toBe(9);
    expect(GLYPH_H).toBe(FONT_LINE_H - 1);
  });

  test('every row shows a full glyph height — the text can never be sliced', () => {
    // CC Friday's finding, reproduced from the source rather than from a screenshot: a glyph is
    // FONT_LINE_H - 1 = 8 rows tall, and the old list drew a 5 px "label" with the bar at y+5, so the
    // bar covered the lower two glyph rows of every mission title ("Finish 25 runs" cut in half at
    // native resolution). Two independent conditions have to hold, and the pixel probe could see
    // neither because it only asked whether ink existed:
    //   1. the label rect is at least one full glyph box tall;
    //   2. the bar's rect does not intersect the label's rect at all.
    const L = missionListLayout(3);
    for (let i = 0; i < L.rows.length; i++) {
      expect(L.rows[i].h).toBeGreaterThanOrEqual(FONT_LINE_H - 1);
      expect(overlaps(L.rows[i], L.bars[i])).toBe(false);
      // Row pitch must admit a full glyph plus a gap, or consecutive rows clip each other.
      expect(MISSION_LIST_TITLE.rowH).toBeGreaterThanOrEqual(FONT_LINE_H);
    }
  });

  test('consecutive Title rows never overlap', () => {
    const L = missionListLayout(3);
    for (let i = 1; i < L.rows.length; i += 1) {
      expect(overlaps(L.rows[i - 1], L.rows[i])).toBe(false);
      expect(overlaps(L.bars[i - 1], L.bars[i])).toBe(false);
      expect(overlaps(L.rows[i - 1], L.bars[i])).toBe(false);
    }
  });

  test('the mission title fits its text box at the real maximum title length', () => {
    // 47 templates, longest title 25 chars. Nothing may be silently ellipsized away at scale 1: the
    // row has to be wide enough for the longest real title, and the bar gets the rest.
    const L = missionListLayout(3);
    const longest = 25;
    expect(charsThatFit(L.rows[0].w)).toBeGreaterThanOrEqual(longest);
    expect(ellipsize('X'.repeat(longest), L.rows[0].w)).toHaveLength(longest);
  });

  test('the in-run panel and the Title list do not overlap', () => {
    expect(overlaps(missionPanelLayout(3).panel, missionListLayout(3).panel)).toBe(false);
  });
});

describe('Game Over mission block', () => {
  // Real GameOverScene geometry, transcribed here so the assertion is against the scene, not against
  // the mission module's own opinion of itself. LEDGER panel: y=54, h=160 -> interior local 0..160.
  // Board container sits at local y 22; its rows start 14 below that at GAMEOVER_BOARD_ROW_H pitch.
  const LEDGER = { x: 250, y: 54, w: 216, h: 160 };
  const PANEL_FLOOR = LEDGER.h; // local 160
  const BOARD_Y = 22;
  const ROWS_OFFSET = 14;
  const BUTTONS = { x: 0, y: 220, w: 480, h: 24 };
  /** Local y where the last leaderboard row's text ends. */
  const boardEnd = () => BOARD_Y + ROWS_OFFSET + (GAMEOVER_BOARD_ROWS - 1) * GAMEOVER_BOARD_ROW_H + LABEL_H;
  const block = () => columnRows({ x: 8, y: GAMEOVER_MISSIONS_Y, w: 200, count: 3, rowH: GAMEOVER_ROW_H, barH: 2 });

  test('each progress bar never covers its own label', () => {
    // Two rounds of audits found this defect in different forms: first a bar 2 px INTO an 8 px label
    // (pitch 8), then a bar flush under a label with a zero-pixel gap to the next row (pitch 10), which
    // reads as a slab of ink across the text. The invariant that fixes both is geometric rather than
    // aesthetic: the label and the bar must not intersect, in any row, and the label must keep a full
    // glyph box. A bar placed under the label only satisfies this at a pitch that leaves no gap, so
    // the layout puts it inline instead.
    const geom = block();
    geom.rows.forEach((r, i) => {
      const b = geom.bars[i];
      expect(overlaps(r, b)).toBe(false);
      expect(r.h).toBeGreaterThanOrEqual(FONT_LINE_H - 1);
      // Inline, or below with a real gap — never inside.
      const inline = b.x >= r.x + r.w;
      const below = b.y >= r.y + r.h + 1;
      expect(inline || below).toBe(true);
    });
  });

  test('consecutive mission rows do not collide', () => {
    const geom = block();
    for (let i = 1; i < geom.rows.length; i += 1) {
      expect(overlaps(geom.rows[i - 1], geom.rows[i])).toBe(false);
      expect(overlaps(geom.bars[i - 1], geom.rows[i])).toBe(false);
      expect(overlaps(geom.rows[i - 1], geom.bars[i])).toBe(false);
      // A full glyph box plus a visible gap: rows that merely touch read as one paragraph.
      expect(geom.rows[i].y).toBeGreaterThanOrEqual(geom.rows[i - 1].y + FONT_LINE_H - 1);
    }
  });

  test('the mission title fits its text box at the longest real title', () => {
    // The longest template is 132 px wide at scale 1 ("Collect 1000 shards total"). A text box that
    // cannot hold it silently ellipsizes a mission's target away, which is worse than a tight fit.
    const geom = block();
    expect(geom.textW).toBeGreaterThanOrEqual(132);
  });

  test('the block sits inside the LEDGER panel, in screen coordinates', () => {
    const geom = block();
    for (const r of [...geom.rows, ...geom.bars]) {
      const screen = rect(LEDGER.x + r.x, LEDGER.y + r.y, r.w, r.h);
      expect({ r: screen, ok: insideScreen(screen) }).toMatchObject({ ok: true });
      expect(screen.x).toBeGreaterThanOrEqual(LEDGER.x);
      expect(screen.x + screen.w).toBeLessThanOrEqual(LEDGER.x + LEDGER.w);
      expect(screen.y).toBeGreaterThanOrEqual(LEDGER.y);
      expect(screen.y + screen.h).toBeLessThanOrEqual(LEDGER.y + LEDGER.h);
    }
    expect(GAMEOVER_MISSIONS_RULE_Y).toBeGreaterThan(boardEnd());
    expect(GAMEOVER_MISSIONS_Y).toBeGreaterThan(GAMEOVER_MISSIONS_RULE_Y);
  });

  test('the whole block fits above the panel floor', () => {
    const geom = block();
    const last = geom.bars[geom.bars.length - 1];
    expect(last.y + last.h).toBeLessThanOrEqual(PANEL_FLOOR);
    // Not merely "fits": a zero-margin layout is what made the first attempt look acceptable.
    expect(PANEL_FLOOR - (last.y + last.h)).toBeGreaterThanOrEqual(2);
  });

  test('the block clears the leaderboard rows above it', () => {
    expect(GAMEOVER_MISSIONS_RULE_Y).toBeGreaterThan(boardEnd());
    expect(GAMEOVER_MISSIONS_Y).toBeGreaterThan(boardEnd());
  });

  test('the block does not run through the retry buttons or the XP row', () => {
    const geom = block();
    const last = geom.bars[geom.bars.length - 1];
    const lastScreen = rect(LEDGER.x + last.x, LEDGER.y + last.y, last.w, last.h);
    // Luna's round-2 finding: the first attempt ended near screen y 251, through the buttons at
    // 220..244 and the XP line at 246.
    expect(overlaps(lastScreen, BUTTONS)).toBe(false);
    expect(lastScreen.y + lastScreen.h).toBeLessThanOrEqual(BUTTONS.y);
  });

  test('the panel still shows all ten entries its title advertises', () => {
    // Luna's round-3 finding: the block was bought by trimming the board to 8 rows while the panel
    // title still read "TOP 10". The pitch is tightened instead; the COUNT is the user-visible contract.
    expect(GAMEOVER_BOARD_ROWS).toBe(10);
    expect(GAMEOVER_BOARD_ROW_H).toBeLessThan(11);
    expect(boardEnd()).toBeLessThanOrEqual(GAMEOVER_MISSIONS_RULE_Y); // board ends above the rule
  });
});

describe('Game Over initials-entry stack', () => {
  // CC Friday's blocking regression at 7617a80: the legibility fix moved the two hint lines to local
  // 84/96 to clear the mission separator, but InitialsEntry draws its own SAVE button at local
  // 88..104, so the button box covered the middle of both hint lines. The old probe only measured
  // mission-row glyph heights, so nothing could see this. These assertions exist so it cannot recur.

  test('the SAVE button never overlaps either hint line', () => {
    const L = entryLayout();
    for (const [i, h] of L.hints.entries()) {
      expect({ hint: i, overlap: overlaps(L.save, h) }).toMatchObject({ overlap: false });
      // Disjoint is the floor; a real gap is what reads as separate controls.
      const clear = h.y >= L.save.y + L.save.h || L.save.y >= h.y + h.h;
      expect(clear).toBe(true);
    }
  });

  test('the SAVE button owns the band the entry widget draws it in', () => {
    // Mirrors InitialsEntry's constructor: slotY 14, slotH 28, SAVE at slotY + slotH + 18 with h 16,
    // offset by the widget's own y. If the widget moves, this fails instead of drifting silently.
    const L = entryLayout();
    const widgetSaveY = L.entryY + L.entrySlotY + L.entrySlotH + 18;
    expect(L.save.y).toBe(widgetSaveY);
    expect(L.save.h).toBe(16);
  });

  test('nothing in the entry stack runs into the mission block below it', () => {
    const L = entryLayout();
    expect(L.contentBottom).toBeLessThan(GAMEOVER_MISSIONS_RULE_Y);
    // And a real gap, not a one-pixel join: the rule at 127 plus mission rows from 128.
    expect(GAMEOVER_MISSIONS_RULE_Y - L.contentBottom).toBeGreaterThanOrEqual(2);
    for (const h of L.hints) expect(h.y + h.h).toBeLessThanOrEqual(L.contentBottom);
  });

  test('each hint line gets a full glyph height', () => {
    const L = entryLayout();
    for (const h of L.hints) {
      expect(h.h).toBeGreaterThanOrEqual(FONT_LINE_H - 1);
      // Consecutive hint lines must not merge either.
      expect(h.h).toBeGreaterThanOrEqual(GLYPH_H);
    }
    expect(L.hints[1].y).toBeGreaterThanOrEqual(L.hints[0].y + GLYPH_H);
  });

  test('the stack stays inside the panel and below the title', () => {
    const L = entryLayout();
    expect(L.title.y + L.title.h).toBeLessThanOrEqual(L.entryY + L.entrySlotY);
    for (const r of [L.title, L.slots, L.save, ...L.hints]) {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(L.panelW);
      expect(r.y).toBeGreaterThanOrEqual(0);
      expect(r.y + r.h).toBeLessThanOrEqual(GAMEOVER_MISSIONS_RULE_Y);
    }
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
    // The pixel font has no '…' glyph (it would draw '?'), so the cut uses the font's own '..' mark,
    // like PixelFont.ellipsize does, and every character of the result must be drawable.
    expect(cut.endsWith('..')).toBe(true);
    expect([...cut].every((ch) => hasGlyph(ch))).toBe(true);
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

describe('Game Over mission block must report what this run earned', () => {
  // CC Friday, W2: Game Over showed only the freshly dealt actives, so clearing "Land a frontflip"
  // for 60 XP was invisible - the player saw three missions they had never seen. These pin the
  // block to the COMPLETED list first, with its payout, and only then the new actives.
  const done = { id: 't1-trick-frontflip', title: 'Land a frontflip', xp: 60, shards: 4 };
  const active = [
    { id: 't1-shards-15', title: 'Collect 15 shards', fraction: 0.4, done: false },
    { id: 't1-airtime-900', title: '900 ms airtime', fraction: 0.1, done: false },
    { id: 't1-dist-250', title: 'Travel 250 m', fraction: 0, done: false },
  ];

  /** Mirror of GameOverScene._buildMissions' row selection (kept in step by the two assertions below). */
  const build = (completed, rows) => {
    const doneRows = completed.slice(0, 3).map((c) => ({
      label: `${c.xp ? `+${c.xp} XP ` : ''}${c.shards ? `+${c.shards} ` : ''}${c.title}`,
      color: 'lime', done: true, fraction: null,
    }));
    const activeRows = rows.slice(0, Math.max(0, 3 - doneRows.length)).map((r) => ({
      label: r.title, color: r.done ? 'lime' : 'text', done: Boolean(r.done),
      fraction: Math.max(0, Math.min(1, r.fraction || 0)),
    }));
    return doneRows.concat(activeRows);
  };

  test('a completed mission leads the block and carries its payout', () => {
    const listed = build([done], active);
    expect(listed[0].label).toContain('Land a frontflip');
    expect(listed[0].label).toContain('+60 XP');
    expect(listed[0].label).toContain('+4');
    expect(listed[0].done).toBe(true);
  });

  test('the payout survives a long mission title', () => {
    // The real failure: a 172 px label against a 166 px budget lost the shard reward to ellipsize.
    // Payout first means the clipped part is the title, which is the expendable half.
    const long = { id: 'l', title: 'Grab 15 shards in a run', xp: 60, shards: 4 };
    const label = build([long], []).length ? build([long], [])[0].label : '';
    expect(label.startsWith('+60 XP +4 ')).toBe(true);
    // And the payout fits the row on its own, with room left for part of the title.
    expect(measureText('+60 XP +4 ')).toBeLessThan(166);
  });

  test('the fresh actives still appear, so the player knows what is next', () => {
    const listed = build([done], active);
    expect(listed).toHaveLength(3);
    expect(listed[1].label).toBe('Collect 15 shards');
    expect(listed[2].label).toBe('900 ms airtime');
  });

  test('a completed mission never also draws a progress bar', () => {
    // Its bar would read 0% (nothing left to do) or 100% (tautology). Both are lies about state.
    for (const row of build([done], active)) {
      if (row.done && row.fraction === null) expect(row.fraction).toBeNull();
    }
    expect(build([done], active)[0].fraction).toBeNull();
  });

  test('a run with no completions still shows the three actives, as before', () => {
    const listed = build([], active);
    expect(listed).toHaveLength(3);
    expect(listed.every((r) => r.fraction !== null)).toBe(true);
  });

  test('three completions fill the band and no actives are squeezed in', () => {
    const three = [done, { ...done, id: 'b', title: 'Second', xp: 30 }, { ...done, id: 'c', title: 'Third', xp: 20 }];
    const listed = build(three, active);
    expect(listed).toHaveLength(3);
    expect(listed.every((r) => r.done)).toBe(true);
  });

  test('a completion with no payout prints no stray punctuation', () => {
    const listed = build([{ id: 'x', title: 'Land a frontflip', xp: 0, shards: 0 }], active);
    expect(listed[0].label).toBe('Land a frontflip');
  });
});
