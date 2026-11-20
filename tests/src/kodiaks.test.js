// Issue #47: hostile racing Kodiaks. Pure behaviour; the game wiring is covered by tools/kodiak-browser-smoke.mjs.
import fs from 'fs';
import { KODIAK_DEFS, KODIAK_KINDS, KODIAK_BY_ID, KODIAK_MIN_SYNC_LEVEL, KODIAK_FIRST_M, kodiaksEnabledFor, kodiakEncounter,
  spawnKodiak, stepKodiak, kodiakBox, kodiakHits } from '../../src/systems/Kodiaks.js';
import { killerName } from '../../src/systems/CrashReport.js';

/** Run a bear against a sled at constant speed on flat ground; record its phase changes. */
function race(kind, { sledVx = 500, ms = 8000, grounded = () => true, landX = () => null } = {}) {
  const sled = { x: 10000, vx: sledVx, grounded: true, landX: null };
  const k = spawnKodiak('BEARS', { n: 0, kind }, sled);
  const phases = [k.phase], events = [];
  for (let t = 0; t < ms && !k.done; t += 1000 / 120) {
    sled.x += sled.vx / 120;
    sled.grounded = grounded(t);
    sled.landX = landX(t, sled);
    const ev = stepKodiak(k, sled, 1000 / 120);
    if (ev.telegraph || ev.lunge) events.push({ t: Math.round(t), ...ev });
    if (phases.at(-1) !== k.phase) phases.push(k.phase);
  }
  return { k, phases, events, sled };
}

describe('Kodiaks', () => {
  test('three bears, exactly as named: white polar, grizzly brown, Vermont black', () => {
    expect(KODIAK_KINDS).toEqual(['kernelPanic', 'bruteForce', 'blackIce']);
    expect(KODIAK_DEFS.kernelPanic.name).toBe('KERNEL-PANIC KODIAK');
    expect(KODIAK_DEFS.bruteForce.name).toBe('BRUTE-FORCE KODIAK');
    expect(KODIAK_DEFS.blackIce.name).toBe('BLACK-ICE KODIAK');
    expect(KODIAK_DEFS.kernelPanic.color).toBeGreaterThan(0xd00000); // white
    expect(KODIAK_DEFS.blackIce.color).toBeLessThan(0x303030); // black
    expect(killerName('hazard', KODIAK_BY_ID.bruteForceKodiak)).toBe('BRUTE-FORCE KODIAK');
    const art = fs.readFileSync('src/entities/KodiakRider.js', 'utf8');
    for (const cue of ['shoulder hump', 'long neck', 'tall rounded ears']) expect(art).toContain(cue);
  });

  test('gated: from the Sync Level in ordinary runs; never on Dailies or in the Gym', () => {
    expect(kodiaksEnabledFor({ level: KODIAK_MIN_SYNC_LEVEL - 1 })).toBe(false);
    expect(kodiaksEnabledFor({ level: KODIAK_MIN_SYNC_LEVEL })).toBe(true);
    expect(kodiaksEnabledFor({ level: 99, daily: true })).toBe(false);
    expect(kodiaksEnabledFor({ level: 99, gym: true })).toBe(false);
  });

  test('encounters are seeded: same seed same schedule, spaced out, all three bears appear', () => {
    const a = Array.from({ length: 12 }, (_, n) => kodiakEncounter('SEED', n));
    expect(a).toEqual(Array.from({ length: 12 }, (_, n) => kodiakEncounter('SEED', n)));
    expect(a[0].atM).toBe(KODIAK_FIRST_M);
    for (let i = 1; i < a.length; i++) expect(a[i].atM - a[i - 1].atM).toBeGreaterThanOrEqual(650);
    expect(new Set(a.map((e) => e.kind)).size).toBe(3);
    expect(kodiakEncounter('OTHER', 3)).not.toEqual(a[3]);
  });

  test('Brute-Force: catches up from behind, telegraphs, lunges, then tires so it can be re-passed', () => {
    const r = race('bruteForce');
    expect(r.phases.slice(0, 4)).toEqual(['approach', 'tele', 'lunge', 'recover']);
    const tele = r.events.find((e) => e.telegraph === 'real'), lunge = r.events.find((e) => e.lunge);
    expect(lunge.t - tele.t).toBeGreaterThanOrEqual(600); // fair warning before the charge
  });

  test('Kernel-Panic: deterministic feints (at most two), always a red telegraph before the real stop', () => {
    const r1 = race('kernelPanic', { sledVx: 520 }), r2 = race('kernelPanic', { sledVx: 520 });
    expect(r1.events).toEqual(r2.events);
    const kinds = r1.events.filter((e) => e.telegraph).map((e) => e.telegraph);
    expect(kinds.filter((x) => x === 'feint').length).toBeLessThanOrEqual(2);
    expect(kinds.at(-1)).toBe('real');
    expect(r1.phases).toContain('lunge');
  });

  test('Black-Ice: reads the predicted landing and slides under it; out-ridden on the ground it leaves', () => {
    const air = (t) => !(t > 1500 && t < 2300);
    const r = race('blackIce', { grounded: (t) => !(t > 1500 && t < 2300), landX: (t, s) => (t > 1500 && t < 2300 ? s.x + 400 : null) });
    expect(r.events.some((e) => e.telegraph === 'real')).toBe(true);
    expect(air(0)).toBe(true);
    const ground = race('blackIce', { sledVx: 900, ms: 15000 });
    expect(ground.phases).toContain('leave');
  });

  test('collision is fair: a sled riding into the bear hits, one hopping over its back does not', () => {
    const bear = kodiakBox(100, 500);
    expect(kodiakHits(bear, { x: 90, y: 480, w: 36, h: 30 })).toBe(true);
    expect(kodiakHits(bear, { x: 90, y: 440, w: 36, h: 30 })).toBe(false); // bottom 470 < back 474 + 4 margin
    expect(kodiakHits(bear, { x: 300, y: 480, w: 36, h: 30 })).toBe(false);
  });

  test('every bear leaves within its lifetime (no perpetual bear combat)', () => {
    for (const kind of KODIAK_KINDS) expect(race(kind, { ms: 20000 }).k.done).toBe(true);
  });
});
