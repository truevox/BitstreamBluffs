/**
 * Readable Chaos on the biome hazards (B1 slows, B2 Shatter Wall, B3 moving hazards). Pure scheduling
 * (systems/HazardTelegraph.js):
 *  - every shipped hazard def has a deliberate response (hop / brace / none), pinned by an explicit table;
 *  - a moving hazard is timed with its own `predictX(t)` (B3 API), never with an assumed direction: the stubs below move
 *    toward the sled, away from it, stop, and outrun it, and the arrival is checked against the closing-speed solution;
 *  - a Gear Gate is judged at the predicted arrival with `isPassable` / `gateNextChangeMs`: open there (with a margin on
 *    both sides) means a dim, silent mark that never goes lime; anything else is a normal hop warning.
 */
import { GROUND_WARN, hazardResponse, planTelegraph, predictArrival, TelegraphTracker } from '../../src/systems/HazardTelegraph.js';
import { rollPredictX, gateOpenAt, gateNextChangeMs as gateNext } from '../../src/systems/HazardMotion.js';
import { loadContent } from './_helpers.js';

const DEFS = loadContent().hazards;
const FAR = 1e9;
const sled = (x, speed, extra = {}) => ({ x, vx: speed, speed, grounded: true, landX: null, ...extra });
const base = (id, cx, extra = {}) => ({ hid: `${id}@${cx}`, def: DEFS[id], cx, cy: 0, w: DEFS[id].size.w, h: DEFS[id].size.h, hit: false, ...extra });
/**
 * A moving hazard stub: ground x moves at `v` px/s (signed; + is away from the sled) from run time t0, for at most `range`
 * px (from t0, default nowMs). cx carries a +3 px box offset (a sloped box centre is not the ground x) to prove the prediction is used as a delta.
 */
function mover(id, groundX, v, { nowMs = 0, t0 = nowMs, range = Infinity } = {}) {
  const at = (t) => groundX + Math.sign(v) * Math.min(range, Math.abs(v) * Math.max(0, t - t0) / 1000);
  return base(id, at(nowMs) + 3, { predictX: at });
}
/** Gate stub on the real HazardMotion timing (open 900 of every 1400 ms, phase 0). */
function gate(cx) {
  const m = DEFS.gearGate.motion;
  return base('gearGate', cx, {
    predictX: () => cx,
    isPassable: (t) => gateOpenAt(m, 0, t),
    gateNextChangeMs: (t) => gateNext(m, 0, t),
  });
}

describe('every shipped hazard has a deliberate response', () => {
  const TABLE = {
    packetSpike: 'hop', glitchChasm: 'hop',
    overflowFirewall: 'brace', garbageDataVent: 'brace',
    // B1 slows: amber like the Overflow Firewall (same effect kind, gentler numbers); a hop clears them, nothing crashes
    groomerCat: 'brace', seaweedTangle: 'brace', chocolateRiver: 'brace',
    // B2: blind does not crash; it costs sight for 1.2 s and a hop avoids it
    shatterWall: 'brace',
    // B3: all three crash
    rollingBoulder: 'hop', dewDrop: 'hop', gearGate: 'hop',
    // air hazards have their own telegraph (AirTelegraph)
    roguePacket: null, seagullDive: null, ashCloud: null,
    // B4: both air (the Meteor crashes and gets the AirTelegraph STAY LOW mark; the Gust Front is a visible zone, no crash)
    meteor: null, gustFront: null,
  };
  test('the table covers every def in src/data/hazards (a new def must be classified here)', () => {
    expect(Object.keys(DEFS).sort()).toEqual(Object.keys(TABLE).sort());
  });
  test.each(Object.entries(TABLE))('%s -> %s', (id, want) => {
    expect(hazardResponse(DEFS[id])).toBe(want);
  });
});

describe('predictArrival: a moving hazard is timed with its own predictX', () => {
  const NOW = 5000;
  test('static hazard (no predictX, or one that does not move): exactly dx / vx, the sim oracle rule', () => {
    const plain = base('packetSpike', 1800);
    expect(predictArrival(plain, sled(1000, 640), NOW).etaMs).toBe(800 / 640 * 1000);
    const still = base('packetSpike', 1800, { predictX: () => 1797 });
    expect(predictArrival(still, sled(1000, 640), NOW).etaMs).toBe(800 / 640 * 1000);
    expect(predictArrival(still, sled(1000, 640), NOW).cxAtArrival).toBe(1800);
  });
  test('rolling toward the sled: closing speed is sled + roll speed', () => {
    const h = mover('rollingBoulder', 1800, -200, { nowMs: NOW });
    const a = predictArrival(h, sled(1000, 600), NOW);
    expect(a.etaMs).toBeCloseTo(803 / 800 * 1000, 0);
    expect(a.cxAtArrival).toBeCloseTo(1000 + 600 * a.etaMs / 1000, 0);
  });
  test('rolling away from the sled: closing speed is sled - roll speed', () => {
    const h = mover('dewDrop', 1800, 200, { nowMs: NOW });
    const a = predictArrival(h, sled(1000, 600), NOW);
    expect(a.etaMs).toBeCloseTo(803 / 400 * 1000, 0);
  });
  test('a roll that stops part way: it closes fast, then at sled speed', () => {
    // moves 100 px toward the sled in 0.5 s, then rests
    const h = mover('rollingBoulder', 1800, -200, { range: 100, nowMs: NOW, t0: NOW });
    const a = predictArrival(h, sled(1000, 600), NOW);
    // after 0.5 s: sled at 1300, hazard centre at 1703; the rest at 600 px/s
    expect(a.etaMs).toBeCloseTo(500 + (1703 - 1300) / 600 * 1000, 0);
  });
  test('rolling away faster than the sled: no arrival (Infinity)', () => {
    const h = mover('dewDrop', 1800, 200, { nowMs: NOW });
    expect(predictArrival(h, sled(1000, 150), NOW).etaMs).toBe(Infinity);
  });
  test('the same answer for a real HazardMotion roll in either direction (direction comes from predictX only)', () => {
    for (const dir of [-1, 1]) {
      const motion = { kind: 'roll', speedPxS: 140, rangePx: 160, dir };
      const state = { activeAtMs: NOW - 100, offsetPx: 0 };
      const at = (t) => rollPredictX(state, motion, 1800, t);
      const h = base('rollingBoulder', at(NOW), { predictX: at });
      const a = predictArrival(h, sled(1000, 700), NOW);
      // solve directly by brute force at 1 ms
      let t = 0;
      while (at(NOW + t) - (1000 + 700 * t / 1000) > 0) t += 1;
      expect(Math.abs(a.etaMs - t)).toBeLessThanOrEqual(2);
    }
  });
  test('without a run time the prediction is not used (falls back to static)', () => {
    const h = mover('rollingBoulder', 1800, -200, { nowMs: NOW });
    expect(predictArrival(h, sled(1000, 600), undefined).etaMs).toBe(803 / 600 * 1000);
  });
});

describe('planTelegraph with moving hazards', () => {
  const NOW = 5000;
  test('etaS and the lime window follow the predicted arrival, not dx / vx', () => {
    // toward at 200: dx 243 closes at 800 px/s -> 0.30 s: inside the window (static would say 0.405 s: not yet)
    const toward = mover('rollingBoulder', 1240, -200, { nowMs: NOW });
    const m1 = planTelegraph([toward], sled(1000, 600), FAR, { nowMs: NOW })[0];
    expect(m1.etaS).toBeCloseTo(243 / 800, 3);
    expect(m1).toMatchObject({ state: 'go', color: 'lime' });
    expect(m1.arrivalMs).toBeCloseTo(NOW + 243 / 800 * 1000, 0);
    // away at 200: dx 203 closes at 400 px/s -> 0.51 s: not yet (static would say 0.34 s: hop now)
    const away = mover('dewDrop', 1200, 200, { nowMs: NOW });
    const m2 = planTelegraph([away], sled(1000, 600), FAR, { nowMs: NOW })[0];
    expect(m2.etaS).toBeCloseTo(203 / 400, 3);
    expect(m2).toMatchObject({ state: 'warn', color: 'danger' });
  });
  test('a hazard the sled cannot catch is announced but never goes lime', () => {
    const h = mover('dewDrop', 1100, 200, { nowMs: NOW });
    const m = planTelegraph([h], sled(1000, 150), FAR, { nowMs: NOW })[0];
    expect(m).toMatchObject({ kind: 'hop', state: 'warn' });
    expect(m.etaS).toBe(Infinity);
  });
  test('airborne: "clear" compares the landing with where the hazard will be, not where it is', () => {
    // rolls toward the sled at 200: now at 1403, met at about 1000 + 700 * 403 / 900 = 1313
    const h = mover('rollingBoulder', 1400, -200, { nowMs: NOW });
    const meet = 1000 + 700 * (403 / 900);
    const land = meet + h.w / 2 + GROUND_WARN.clearMarginPx + 2; // past the meeting point, short of the current box
    expect(land).toBeLessThan(h.cx + h.w / 2 + GROUND_WARN.clearMarginPx);
    const m = planTelegraph([h], sled(1000, 700, { grounded: false, landX: land }), FAR, { nowMs: NOW })[0];
    expect(m).toMatchObject({ clear: true, state: 'clear' });
  });
  test('static hazards are planned exactly as before when nowMs is given', () => {
    const list = [base('packetSpike', 1300), base('glitchChasm', 1700), base('overflowFirewall', 1500)];
    const a = planTelegraph(list, sled(1000, 650), FAR);
    const b = planTelegraph(list, sled(1000, 650), FAR, { nowMs: NOW });
    expect(b.map(({ arrivalMs, ...m }) => m)).toEqual(a.map(({ arrivalMs, ...m }) => m));
  });
});

describe('Gear Gate: the cue says whether it will be open at arrival', () => {
  // sled at 1000, 700 px/s, gate at 1700: arrival 1000 ms after now
  const at = (nowMs, dx = 700, extra) => planTelegraph([gate(1000 + dx)], sled(1000, 700, extra), FAR, { nowMs })[0];
  test('closed at arrival: a normal red hop warning, lime in the hop window', () => {
    // arrival at t = 1100 (cycle 1100: closed until 1400)
    expect(at(100)).toMatchObject({ kind: 'hop', state: 'warn', color: 'danger', clear: false, gate: 'closed' });
    expect(at(1100 - 300, 700 * 0.3)).toMatchObject({ state: 'go', color: 'lime', gate: 'closed' });
  });
  test('open at arrival with room on both sides: state open, drawn dim, never lime (even inside the hop window)', () => {
    // arrival at t = 450 (open 0..900)
    expect(at(-550)).toMatchObject({ kind: 'hop', state: 'open', color: 'danger', gate: 'open' });
    expect(at(450 - 300, 700 * 0.3)).toMatchObject({ state: 'open', gate: 'open', color: 'danger' });
  });
  test('open at arrival but within the margin of a change: judged closed (the arrival time is an estimate)', () => {
    const m = GROUND_WARN.gateMarginMs;
    // closes at 900: arrival m/2 before it
    expect(at(900 - m / 2 - 1000)).toMatchObject({ state: 'warn', gate: 'closed' });
    // opened at 1400: arrival m/2 after it
    expect(at(1400 + m / 2 - 1000)).toMatchObject({ state: 'warn', gate: 'closed' });
    // well inside: open
    expect(at(1400 + m + 10 - 1000)).toMatchObject({ state: 'open', gate: 'open' });
    expect(at(900 - m - 10 - 1000)).toMatchObject({ state: 'open', gate: 'open' });
  });
  test('the margin covers a crossing and some eta drift, and fits inside the shortest open spell', () => {
    expect(GROUND_WARN.gateMarginMs).toBeGreaterThanOrEqual(80);
    expect(2 * GROUND_WARN.gateMarginMs).toBeLessThan(DEFS.gearGate.motion.openMs);
  });
  test('non-gate hazards carry gate: null', () => {
    expect(planTelegraph([base('packetSpike', 1300)], sled(1000, 650), FAR, { nowMs: 0 })[0].gate).toBe(null);
  });
  test('tracker: an open gate is silent; when the verdict turns closed it warns once', () => {
    const tr = new TelegraphTracker();
    const g = gate(1700);
    const plan = (nowMs) => planTelegraph([g], sled(1000, 700), FAR, { nowMs });
    expect(plan(-550)[0].state).toBe('open');
    expect(tr.update(-550, plan(-550))).toEqual([]);
    expect(plan(100)[0].state).toBe('warn');
    expect(tr.update(100, plan(100)).map((e) => [e.type, e.ref])).toEqual([['warn', g]]);
    expect(tr.update(116, plan(116))).toEqual([]);
  });
});

describe('TelegraphTracker.lastArrivalMs: the latest planned arrival per hazard (read by the crash report)', () => {
  test('updates every frame a hazard is marked, keeps the last finite value, null when never planned', () => {
    const tr = new TelegraphTracker();
    const h = base('packetSpike', 1700);
    expect(tr.lastArrivalMs(h)).toBe(null);
    tr.update(1000, planTelegraph([h], sled(1000, 700), FAR, { nowMs: 1000 }));
    expect(tr.lastArrivalMs(h)).toBeCloseTo(2000, 6);
    tr.update(1500, planTelegraph([h], sled(1300, 600), FAR, { nowMs: 1500 }));
    expect(tr.lastArrivalMs(h)).toBeCloseTo(1500 + 400 / 600 * 1000, 6);
    // a mark without an arrival (no nowMs) leaves the last one
    tr.update(1600, planTelegraph([h], sled(1350, 600), FAR));
    expect(tr.lastArrivalMs(h)).toBeCloseTo(1500 + 400 / 600 * 1000, 6);
  });
  test('clear and open marks still record their arrival (the sled may crash into it anyway)', () => {
    const tr = new TelegraphTracker();
    const h = base('packetSpike', 1400);
    tr.update(0, planTelegraph([h], sled(1000, 700, { grounded: false, landX: 2000 }), FAR, { nowMs: 0 }));
    expect(tr.lastArrivalMs(h)).toBeCloseTo(400 / 700 * 1000, 6);
  });
});
