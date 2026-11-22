// Issue #47: hostile racing Kodiaks. Pure behaviour; the game wiring is covered by tools/kodiak-browser-smoke.mjs.
import fs from 'fs';
import { KODIAK_DEFS, KODIAK_KINDS, KODIAK_MIN_SYNC_LEVEL, KODIAK_FIRST_M, KODIAK_KNOCK, kodiaksEnabledFor, kodiakEncounter,
  spawnKodiak, stepKodiak, kodiakBox, kodiakHits, kodiakKnockback, spawnKodiakPack, stepKodiakPack, kodiakThreatening, KODIAK_CLEAR_PX } from '../../src/systems/Kodiaks.js';

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
    for (const d of Object.values(KODIAK_DEFS)) expect(d.onHit).toBeUndefined(); // contact never crashes the sled
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

  test('contact shoves the sled backward and up, bounded, and harder the faster the two were closing', () => {
    const still = kodiakKnockback({ speed: 500 }, { vx: 500 }), closing = kodiakKnockback({ speed: 0 }, { vx: 600 });
    expect(still.dvx).toBe(-KODIAK_KNOCK.basePx); // no closing speed: the base push only
    expect(closing.dvx).toBeLessThan(still.dvx); // backward (negative x), and harder when closing
    expect(Math.abs(closing.dvx)).toBeLessThanOrEqual(KODIAK_KNOCK.maxPx); // bounded
    expect(closing.dvy).toBe(-KODIAK_KNOCK.upPx); // up (y grows downward)
    expect(kodiakKnockback({ speed: 120 }, { vx: 520 })).toEqual(kodiakKnockback({ speed: 120 }, { vx: 520 })); // pure
  });

  test('the shove window is set and the push stays well under cruising speed, so a shoved sled keeps moving forward', () => {
    expect(KODIAK_KNOCK.immunityMs).toBeGreaterThan(0);
    expect(KODIAK_KNOCK.maxPx).toBeLessThan(600); // well under a sled's cruising speed: it keeps moving forward
  });

  test('every bear leaves within its lifetime (no perpetual bear combat)', () => {
    for (const kind of KODIAK_KINDS) expect(race(kind, { ms: 20000 }).k.done).toBe(true);
  });

  test('race bears come in packs of 2-3: one type in SAME mode, at least two types in MIXED mode', () => {
    for (let n = 0; n < 30; n++) {
      const same = kodiakEncounter('PACKS', n, 'same'), mixed = kodiakEncounter('PACKS', n, 'mixed');
      expect(same.members.length).toBeGreaterThanOrEqual(2);
      expect(same.members.length).toBeLessThanOrEqual(3);
      expect(new Set(same.members).size).toBe(1);
      expect(new Set(mixed.members).size).toBe(mixed.members.length);
      expect(mixed.members[0]).toBe(same.kind); // same schedule and lead type in both modes
      expect(same.atM).toBe(mixed.atM);
    }
    expect(kodiakEncounter('PACKS', 0, 'same').members.length).toBe(2); // the first pack of a run is 2
  });

  test('a pack attacks one bear at a time, and never while another bear is close enough to need hopping', () => {
    for (const mode of ['same', 'mixed']) for (let n = 0; n < 6; n++) {
      const sled = { x: 20000, vx: 520, grounded: true, landX: null };
      const bears = spawnKodiakPack('ONEATATIME', kodiakEncounter('ONEATATIME', n, mode), sled);
      for (let t = 0; t < 12000; t += 1000 / 120) {
        sled.x += sled.vx / 120;
        // Judge each start of an attack against the pack as it stood when that bear decided (members step in order).
        const before = bears.map((b) => b.phase);
        const blocks = (o) => kodiakThreatening(o) || (!o.done && !o.hit && Math.abs(o.x - sled.x) < KODIAK_CLEAR_PX);
        const pre = bears.map(blocks);
        stepKodiakPack(bears, sled, 1000 / 120);
        const post = bears.map(blocks);
        expect(bears.filter(kodiakThreatening).length).toBeLessThanOrEqual(1);
        // Bear i saw members j < i after their step this tick, and members j > i before theirs.
        bears.forEach((b, i) => {
          if (before[i] === 'approach' && b.phase === 'tele') expect(bears.some((o, j) => j !== i && (j < i ? post[j] : pre[j]))).toBe(false);
        });
      }
    }
  });

  test('a bear you must pass on the ground is much slower than you (a hop clears it at real closing speed)', () => {
    const r = race('bruteForce', { ms: 6000 });
    expect(r.phases).toContain('recover');
    const k = spawnKodiak('SLOW', { n: 0, kind: 'bruteForce' }, { x: 0, vx: 500 });
    k.phase = 'recover'; k.phaseMs = 0; k.x = 400; k.speed = 600;
    for (let i = 0; i < 120; i++) stepKodiak(k, { x: 0, vx: 500, grounded: true, landX: null }, 1000 / 120);
    expect(k.speed).toBeLessThan(500 * 0.5);
  });
});

