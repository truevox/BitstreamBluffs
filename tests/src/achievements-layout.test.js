/**
 * W5 achievements grid layout — the geometry gates that the Profile view's suite established as the
 * pattern: no overlapping text, every row inside the panel, nothing under the BACK button.
 *
 * A layout bug here is a visual bug the unit tests can still catch, which is the whole reason the grid is
 * Phaser-free. The specific failure this guards against is the one W3's Profile panel already hit: a row
 * list that grows past the BACK button at `h - 22`.
 */
import {
  achievementsLayout, achievementRows, pageCount, clampPage, overlappingPairs,
  ACH_PANEL, ROWS_PER_PAGE, GROUPS, toastLayout, TOAST_BOX,
} from '../../src/ui/AchievementsLayout.js';
import { ACHIEVEMENTS } from '../../src/systems/Achievements.js';
import { measureText } from '../../src/ui/PixelFont.js';

/** A profile that has done nothing yet. */
const EMPTY = { v: 1, xp: 0, level: 1, achievements: {}, lifetime: { runs: 0, tricks: {} } };

/** A profile with everything unlocked, for the worst-case page. */
const MAXED = {
  v: 1, xp: 6_000_000, level: 30,
  achievements: Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, 1_700_000_000_000])),
  lifetime: { runs: 9999, distanceM: 9e6, bestDistanceM: 9e6, bestScore: 9e6, bestCombo: 99, maxAirtimeMs: 99000, tricks: {}, shards: 9e6, nearMisses: 9000 },
};

describe('achievementRows', () => {
  test('every achievement appears once, under a header', () => {
    const rows = achievementRows();
    const ids = rows.filter((r) => r.kind === 'row').map((r) => r.id);
    expect(ids.length).toBe(ACHIEVEMENTS.length);
    expect(new Set(ids).size).toBe(ACHIEVEMENTS.length);
  });

  test('a header precedes its group', () => {
    const rows = achievementRows();
    expect(rows[0].kind).toBe('header');
    for (const g of GROUPS) expect(rows.some((r) => r.kind === 'header' && r.label === g.label)).toBe(true);
  });
});

describe('paging', () => {
  test('covers every row across all pages exactly once', () => {
    const rows = achievementRows();
    const seen = [];
    for (let p = 0; p < pageCount(rows); p += 1) {
      for (const r of achievementsLayout({ page: p }).rows) {
        if (r.kind === 'row') seen.push(r.id);
      }
    }
    expect(seen.sort()).toEqual(rows.filter((r) => r.kind === 'row').map((r) => r.id).sort());
  });

  test('a page never shows more rows than the pitch allows', () => {
    for (let p = 0; p < pageCount(); p += 1) {
      expect(achievementsLayout({ page: p }).rows.length).toBeLessThanOrEqual(ROWS_PER_PAGE);
    }
  });

  test('an out-of-range page is clamped rather than blank', () => {
    const n = pageCount();
    expect(clampPage(99)).toBe(n - 1);
    expect(clampPage(-5)).toBe(0);
    expect(achievementsLayout({ page: 99 }).rows.length).toBeGreaterThan(0);
  });

  test('junk page values do not throw', () => {
    for (const p of [undefined, null, NaN, 'x', 1.7]) expect(() => achievementsLayout({ page: p })).not.toThrow();
  });
});

describe('geometry', () => {
  test('no two drawn boxes overlap on any page, with nothing unlocked', () => {
    for (let p = 0; p < pageCount(); p += 1) {
      const l = achievementsLayout({ profile: EMPTY, page: p });
      expect(overlappingPairs(l.items)).toEqual([]);
    }
  });

  test('no two drawn boxes overlap on any page, with everything unlocked', () => {
    // Longest values ("9/9" style progress and long names) are the tight case for the right-hand column.
    for (let p = 0; p < pageCount(); p += 1) {
      const l = achievementsLayout({ profile: MAXED, page: p });
      expect(overlappingPairs(l.items)).toEqual([]);
    }
  });

  test('every box sits inside the panel', () => {
    for (let p = 0; p < pageCount(); p += 1) {
      for (const it of achievementsLayout({ profile: MAXED, page: p }).items) {
        expect({ key: it.key, ok: it.x >= 0 && it.x + it.w <= ACH_PANEL.w }).toEqual({ key: it.key, ok: true });
        expect({ key: it.key, ok: it.y >= 0 && it.y + it.h <= ACH_PANEL.h }).toEqual({ key: it.key, ok: true });
      }
    }
  });

  test('no row is drawn under the BACK button', () => {
    // The exact bug W3's Profile panel hit: BACK is placed at h - 22 by the View base class, so any row
    // whose box reaches that line is covered by a button the player cannot see through.
    const backTop = ACH_PANEL.h - 22;
    for (let p = 0; p < pageCount(); p += 1) {
      for (const it of achievementsLayout({ page: p }).items) {
        if (it.key === 'page') continue; // the footer is the page indicator, positioned deliberately
        expect({ key: it.key, clear: it.y + it.h <= backTop }).toEqual({ key: it.key, clear: true });
      }
    }
  });

  test('the page footer stays clear of the BACK button horizontally', () => {
    // BACK occupies the right 76px of the panel, so the footer must end before that column starts.
    const l = achievementsLayout({ page: 0 });
    const backLeft = ACH_PANEL.w - 76;
    expect(l.footer.x + l.footer.w).toBeLessThanOrEqual(backLeft);
  });

  test('the panel fits the 270px canvas at its y offset', () => {
    // The View base class centres when y is omitted; the achievements view pins y=13, so this must fit.
    expect(13 + ACH_PANEL.h).toBeLessThanOrEqual(270);
  });
});

describe('row rendering state', () => {
  test('an unlocked achievement reads done, and a locked one does not', () => {
    const rows = achievementsLayout({ profile: EMPTY, page: 0 }).rows.filter((r) => r.kind === 'row');
    expect(rows.every((r) => r.done === false)).toBe(true);

    const done = achievementsLayout({ profile: MAXED, page: 0 }).rows.filter((r) => r.kind === 'row');
    expect(done.every((r) => r.done === true)).toBe(true);
  });

  test('progress never exceeds the target, and a done row is full', () => {
    const rows = achievementsLayout({ profile: MAXED, page: 0 }).rows.filter((r) => r.kind === 'row');
    for (const r of rows) expect(r.ratio).toBe(1);
  });

  test('partial progress is reported honestly', () => {
    const p = { ...EMPTY, lifetime: { ...EMPTY.lifetime, runs: 5 } };
    const rows = achievementsLayout({ profile: p }).rows.filter((r) => r.kind === 'row');
    const ten = rows.find((r) => r.id === 'ten-runs');
    if (ten) expect(ten.progress).toBe('5/10');
  });

  test('every achievement carries a description for the grid', () => {
    for (const a of ACHIEVEMENTS) expect(a.desc.length).toBeGreaterThan(0);
  });
});

describe('toastLayout', () => {
  const A = (name, desc) => ({ id: name.toLowerCase(), name, desc: desc || '' });
  // Same contract as PixelFont.ellipsize: truncate to a PIXEL width, not a character count. A
  // character-count stub would pass a 138-char string through and the assertion below would be a lie.
  const cut = (s, maxPx) => {
    let out = String(s);
    while (out.length > 1 && measureText(out) > maxPx) out = out.slice(0, -2) + '~';
    return out;
  };

  test('nothing to announce renders nothing', () => {
    for (const v of [null, undefined, [], 'x', [{}, { name: '' }]]) expect(toastLayout(v)).toBeNull();
  });

  test('one unlock shows its name and its description', () => {
    const l = toastLayout([A('First Descent', 'Finish your first run.')], { ellipsize: cut });
    expect(l.lines[0].text).toBe('UNLOCKED FIRST DESCENT');
    expect(l.lines[1].text).toBe('FINISH YOUR FIRST RUN.');
  });

  test('several unlocks show the first and a count of the rest', () => {
    const l = toastLayout([A('First Descent', 'x'), A('Doubled Up', 'y'), A('Kilometre Club', 'z')], { ellipsize: cut });
    expect(l.lines[0].text).toBe('UNLOCKED FIRST DESCENT');
    expect(l.lines[1].text).toBe('+2 MORE');
  });

  test('a long name is ellipsised inside the box, not allowed to run under the header', () => {
    const l = toastLayout([A('Marathon Machine', 'Ride 25,000 m in total.')], { ellipsize: cut });
    for (const line of l.lines) {
      expect({ key: line.key, fits: line.x + line.w <= TOAST_BOX.x + TOAST_BOX.w }).toEqual({ key: line.key, fits: true });
    }
  });

  test('the toast stays inside its measured band', () => {
    const l = toastLayout([A('First Descent', 'Finish your first run.')], { ellipsize: cut });
    for (const line of l.lines) {
      expect(line.y).toBeGreaterThanOrEqual(TOAST_BOX.y);
      expect(line.y + line.h).toBeLessThanOrEqual(TOAST_BOX.maxY);
    }
  });

  test('the band does not collide with the header or the panels', () => {
    // Measured from GameOverScene: header ink starts at x 156 (scale 4, centred), RUN REPORT at y 54,
    // LEDGER at x 250. The toast must stay left of 156 and above 54 to avoid all three.
    expect(TOAST_BOX.x + TOAST_BOX.w).toBeLessThanOrEqual(156);
    expect(TOAST_BOX.maxY).toBeLessThanOrEqual(54);
  });

  test('works without an injected ellipsize', () => {
    expect(() => toastLayout([A('First Descent', 'd')])).not.toThrow();
  });
});
