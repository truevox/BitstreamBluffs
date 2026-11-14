/**
 * Marvin decision 9 (2026-11-14): "Combo achievements resolve in deterministic progression order; grant all
 * simultaneously earned achievements."
 *
 * After the ACH-2 retarget the combo ladder is x1.25 / x1.5 / x1.75 / x2.0, but `combo-2` (x2.0, the
 * hardest) was listed first, so it led the grid and the unlock toast. The fix is one canonical order for the
 * whole catalogue: group (GROUP_ORDER), then metric (METRIC_ORDER, so one ladder stays together), then
 * target ascending, stable on catalogue order for ties. The grid, `qualified`/`newlyUnlocked` and the toast
 * all read that order.
 *
 * The comparator is tested on a SHUFFLED fixture, not only on the shipped catalogue: the shipped list is
 * already stored in canonical order, so a test that only reads it would still pass with the sort deleted.
 */
import fs from 'fs';

import {
  ACHIEVEMENTS, METRICS, GROUP_ORDER, METRIC_ORDER, sortAchievements, qualified, newlyUnlocked,
  groupedAchievements,
} from '../../src/systems/Achievements.js';
import { achievementRows, GROUPS, toastLayout } from '../../src/ui/AchievementsLayout.js';
import { sanitizeProfile, creditRun } from '../../src/systems/ProfileStore.js';
import { measureText } from '../../src/ui/PixelFont.js';

const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));
const LEVELS = read('src/data/progression/levels.json');
const ids = (list) => list.map((a) => a.id);
const COMBO_ORDER = ['combo-5', 'combo-10', 'combo-20', 'combo-2'];

describe('the canonical order: group, then metric, then target', () => {
  test('GROUP_ORDER covers every group the catalogue uses, and METRIC_ORDER is exactly METRICS', () => {
    for (const a of ACHIEVEMENTS) expect({ id: a.id, known: GROUP_ORDER.includes(a.group) }).toEqual({ id: a.id, known: true });
    expect([...METRIC_ORDER].sort()).toEqual([...METRICS].sort());
  });

  test('a shuffled catalogue sorts into group order, ladders together, targets ascending', () => {
    const fx = [
      { id: 'b-hi', group: 'biomes', metric: 'biomesDiscovered', target: 9 },
      { id: 's-combo-hi', group: 'skill', metric: 'bestCombo', target: 2 },
      { id: 'd-runs-hi', group: 'distance', metric: 'runs', target: 50 },
      { id: 's-tricks-lo', group: 'skill', metric: 'tricksLanded', target: 10 },
      { id: 's-combo-lo', group: 'skill', metric: 'bestCombo', target: 1.25 },
      { id: 'd-runs-lo', group: 'distance', metric: 'runs', target: 1 },
      { id: 'b-lo', group: 'biomes', metric: 'biomesDiscovered', target: 2 },
      { id: 's-combo-mid', group: 'skill', metric: 'bestCombo', target: 1.5 },
    ];
    expect(ids(sortAchievements(fx))).toEqual([
      'd-runs-lo', 'd-runs-hi', 's-combo-lo', 's-combo-mid', 's-combo-hi', 's-tricks-lo', 'b-lo', 'b-hi',
    ]);
  });

  test('ties keep their catalogue order (stable), and unknown groups or metrics sort last, not first', () => {
    const fx = [
      { id: 'z-unknown', group: 'mystery', metric: 'runs', target: 1 },
      { id: 'tie-1', group: 'distance', metric: 'runs', target: 10 },
      { id: 'tie-2', group: 'distance', metric: 'runs', target: 10 },
      { id: 'odd-metric', group: 'distance', metric: 'nope', target: 1 },
    ];
    expect(ids(sortAchievements(fx))).toEqual(['tie-1', 'tie-2', 'odd-metric', 'z-unknown']);
  });

  test('the input is not mutated', () => {
    const fx = [{ id: 'b', group: 'skill', metric: 'runs', target: 2 }, { id: 'a', group: 'distance', metric: 'runs', target: 1 }];
    sortAchievements(fx);
    expect(ids(fx)).toEqual(['b', 'a']);
  });

  test('the shipped catalogue is already in canonical order', () => {
    expect(ids(ACHIEVEMENTS)).toEqual(ids(sortAchievements(ACHIEVEMENTS)));
  });

  test('achievements.json lists every entry in the same order as the built-in catalogue', () => {
    const json = read('src/data/achievements/achievements.json');
    const list = Array.isArray(json) ? json : json.achievements;
    expect(ids(list)).toEqual(ids(ACHIEVEMENTS));
  });
});

describe('combo achievements climb in progression order everywhere', () => {
  const combos = (list) => list.filter((a) => a.metric === 'bestCombo');

  test('catalogue order is x1.25, x1.5, x1.75, x2.0', () => {
    expect(ids(combos(ACHIEVEMENTS))).toEqual(COMBO_ORDER);
    expect(combos(ACHIEVEMENTS).map((a) => a.target)).toEqual([1.25, 1.5, 1.75, 2]);
  });

  test('the grid shows them in that order', () => {
    const rows = achievementRows().filter((r) => r.kind === 'row').map((r) => r.id);
    expect(rows.filter((id) => COMBO_ORDER.includes(id))).toEqual(COMBO_ORDER);
  });

  test('evaluation returns them in that order', () => {
    expect(ids(combos(qualified({ bestCombo: 2 })))).toEqual(COMBO_ORDER);
    expect(ids(combos(newlyUnlocked({ bestCombo: 2 }, {})))).toEqual(COMBO_ORDER);
  });

  test('names and descriptions match their targets: the x2.0 one is the capstone, not "Wireless Legend" at x1.75', () => {
    const want = {
      'combo-5': ['Combo Starter', 'Land a x1.25 combo.'],
      'combo-10': ['Chain Reaction', 'Land a x1.5 combo.'],
      'combo-20': ['Unbroken', 'Land a x1.75 combo.'],
      'combo-2': ['Doubled Up', 'Land a x2 combo.'],
    };
    for (const a of combos(ACHIEVEMENTS)) expect({ id: a.id, name: a.name, desc: a.desc }).toEqual({ id: a.id, name: want[a.id][0], desc: want[a.id][1] });
  });
});

describe('everything earned at once is granted at once, in order', () => {
  const v1 = (o = {}) => sanitizeProfile({ v: 1, ...o }, LEVELS);
  const rec = (o = {}) => ({
    version: 1, id: 'run-1', seed: 's', dailyRuleId: 'none', startedAt: 0, endedAt: 4242, durationMs: 60000,
    score: 0, distanceM: 0, trickPoints: 0, tricks: {}, bestCombo: 1, maxAirtimeMs: 0, cause: 'crash',
    ledgerHash: 'h1', shards: 0, nearMisses: 0, ...o,
  });

  test('a run that reaches x1.75 unlocks x1.25, x1.5 and x1.75 together, in order, with one timestamp', () => {
    const res = creditRun(v1(), rec({ bestCombo: 1.75 }), LEVELS);
    const got = res.awards.achievements.filter((a) => a.metric === 'bestCombo').map((a) => a.id);
    expect(got).toEqual(['combo-5', 'combo-10', 'combo-20']);
    expect(res.profile.achievements['combo-2']).toBeUndefined();
    const stamps = got.map((id) => res.profile.achievements[id]);
    expect(stamps).toEqual([4242, 4242, 4242]);
  });

  test('the awards list for a whole run follows the canonical catalogue order', () => {
    const res = creditRun(v1(), rec({ bestCombo: 2, distanceM: 1200 }), LEVELS);
    const got = ids(res.awards.achievements);
    expect(got).toEqual(ids(ACHIEVEMENTS).filter((id) => got.includes(id)));
    expect(got.indexOf('first-descent')).toBeLessThan(got.indexOf('combo-5'));
    expect(got.slice(got.indexOf('combo-5'), got.indexOf('combo-5') + 4)).toEqual(COMBO_ORDER);
  });

  test('the toast lists the three combo unlocks by name, in order', () => {
    const res = creditRun(v1({ lifetime: { runs: 5 } }), rec({ bestCombo: 1.75 }), LEVELS);
    const combo = res.awards.achievements.filter((a) => a.metric === 'bestCombo');
    const l = toastLayout(combo, { ellipsize: (s) => s });
    expect(l.lines.map((x) => x.text)).toEqual(['UNLOCKED COMBO STARTER', 'CHAIN REACTION', 'UNBROKEN']);
  });
});

describe('one group order for the grid', () => {
  test('groupedAchievements follows GROUP_ORDER', () => {
    expect(groupedAchievements().map((g) => g.group)).toEqual(GROUP_ORDER.filter((g) => ACHIEVEMENTS.some((a) => a.group === g)));
  });

  test('the grid labels list the same groups in the same order', () => {
    expect(GROUPS.map((g) => g.id)).toEqual([...GROUP_ORDER]);
  });

  test('grid rows are the catalogue in canonical order', () => {
    expect(achievementRows().filter((r) => r.kind === 'row').map((r) => r.id)).toEqual(ids(ACHIEVEMENTS));
  });
});

describe('toast: names in order, overflow counted on the last line', () => {
  const A = (name) => ({ id: name.toLowerCase(), name, desc: 'd' });
  const cut = (s, maxPx) => {
    let out = String(s);
    while (out.length > 1 && measureText(out) > maxPx) out = out.slice(0, -2) + '~';
    return out;
  };

  test('two unlocks show both names', () => {
    const l = toastLayout([A('First Descent'), A('Combo Starter')], { ellipsize: cut });
    expect(l.lines.map((x) => x.text)).toEqual(['UNLOCKED FIRST DESCENT', 'COMBO STARTER']);
  });

  test('four or more show two names and a count of the rest', () => {
    const l = toastLayout([A('First Descent'), A('Combo Starter'), A('Chain Reaction'), A('Unbroken')], { ellipsize: cut });
    expect(l.lines.map((x) => x.text)).toEqual(['UNLOCKED FIRST DESCENT', 'COMBO STARTER', '+2 MORE']);
  });
});
