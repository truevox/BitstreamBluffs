/**
 * Readable Chaos, phase 1: the ground-hazard telegraph. Pure scheduling math (systems/HazardTelegraph.js): which hazards
 * are announced, from how far, in which colour, when the chevron goes lime, and which sounds play once.
 */
import {
  GROUND_WARN, hazardResponse, warnDistancePx, inHopWindow, planTelegraph, TelegraphTracker,
} from '../../src/systems/HazardTelegraph.js';
import { loadContent } from './_helpers.js';

const DEFS = loadContent().hazards;
const hz = (id, cx, extra = {}) => ({ def: DEFS[id], cx, cy: 0, w: DEFS[id].size.w, h: DEFS[id].size.h, hit: false, ...extra });
const sled = (x, speed, extra = {}) => ({ x, vx: speed, speed, grounded: true, landX: null, ...extra });
const FAR = 1e9;

describe('hazardResponse: colour is the response, not the def colour', () => {
  test('crash ground hazards are "hop", slow / scramble ground hazards are "brace", air hazards are not telegraphed here', () => {
    expect(hazardResponse(DEFS.packetSpike)).toBe('hop');
    expect(hazardResponse(DEFS.glitchChasm)).toBe('hop');
    expect(hazardResponse(DEFS.overflowFirewall)).toBe('brace');
    expect(hazardResponse(DEFS.garbageDataVent)).toBe('brace');
    expect(hazardResponse(DEFS.roguePacket)).toBe(null);
    expect(hazardResponse(DEFS.seagullDive)).toBe(null);
    expect(hazardResponse({ id: 'noOnHit', placement: 'ground' })).toBe('hop'); // a def without onHit crashes (Hazard.js)
    expect(hazardResponse(null)).toBe(null);
  });
  test('every shipped ground hazard def gets a response', () => {
    for (const d of Object.values(DEFS)) expect(hazardResponse(d)).toBe(d.placement === 'air' ? null : d.onHit.effect === 'crash' ? 'hop' : 'brace');
  });
});

describe('warnDistancePx: about 2 s of travel, clamped', () => {
  test('scales with speed between the clamps', () => {
    expect(warnDistancePx(500)).toBe(500 * GROUND_WARN.leadS);
    expect(warnDistancePx(650)).toBe(1300);
    expect(warnDistancePx(500) / 500).toBeCloseTo(2.0, 9);
  });
  test('clamps: never under minPx (slow sled) or over maxPx (terrain is only streamed so far ahead)', () => {
    expect(warnDistancePx(0)).toBe(GROUND_WARN.minPx);
    expect(warnDistancePx(100)).toBe(GROUND_WARN.minPx);
    expect(warnDistancePx(1200)).toBe(GROUND_WARN.maxPx);
    expect(warnDistancePx(5000)).toBe(GROUND_WARN.maxPx);
    expect(warnDistancePx(NaN)).toBe(GROUND_WARN.minPx);
    // the lead in seconds at the top of the measured speed range stays above the 1.2 s target
    expect(GROUND_WARN.maxPx / 1200).toBeGreaterThanOrEqual(1.2);
  });
});

describe('inHopWindow: the sim hop oracle rule (tools/sim/browser.js policies.hop)', () => {
  const oracle = (dx, vxRaw, lead = 380) => { const vx = Math.max(vxRaw, 60); return dx > 0 && (dx / vx) * 1000 <= lead && (dx / vx) * 1000 > lead - 250; };
  test('agrees with the oracle over a grid of distances and speeds', () => {
    for (let vx = 0; vx <= 1400; vx += 35) for (let dx = -40; dx <= 700; dx += 7) expect(inHopWindow(dx, vx)).toBe(oracle(dx, vx));
  });
  test('boundaries at 650 px/s: 380 ms out is in, 130 ms out is not, behind is not', () => {
    expect(inHopWindow(650 * 0.38, 650)).toBe(true);
    expect(inHopWindow(650 * 0.381, 650)).toBe(false);
    expect(inHopWindow(650 * 0.131, 650)).toBe(true);
    expect(inHopWindow(650 * 0.13, 650)).toBe(false);
    expect(inHopWindow(-1, 650)).toBe(false);
  });
});

describe('planTelegraph', () => {
  test('a crash hazard 2 s out is announced in danger; nothing is announced beyond the warn distance', () => {
    const h = hz('packetSpike', 1000 + 1299);
    const [m] = planTelegraph([h], sled(1000, 650), FAR);
    expect(m).toMatchObject({ ref: h, kind: 'hop', state: 'warn', color: 'danger', clear: false, dx: 1299 });
    expect(m.etaS).toBeCloseTo(1299 / 650, 6);
    expect(planTelegraph([hz('packetSpike', 1000 + 1301)], sled(1000, 650), FAR)).toEqual([]);
  });
  test('slow and scramble hazards are amber "brace" and never go lime', () => {
    for (const id of ['overflowFirewall', 'garbageDataVent']) {
      const [m] = planTelegraph([hz(id, 1200)], sled(1000, 650), FAR);
      expect(m).toMatchObject({ kind: 'brace', state: 'warn', color: 'amber' });
    }
  });
  test('the chevron is lime exactly while the grounded sled is inside the hop window', () => {
    const at = (dx, extra) => planTelegraph([hz('glitchChasm', 1000 + dx)], sled(1000, 800, extra), FAR)[0];
    expect(at(800 * 0.5)).toMatchObject({ state: 'warn', color: 'danger' });
    expect(at(800 * 0.37)).toMatchObject({ state: 'go', color: 'lime' });
    expect(at(800 * 0.14)).toMatchObject({ state: 'go', color: 'lime' });
    expect(at(800 * 0.12)).toMatchObject({ state: 'warn', color: 'danger' }); // too late: back to red
    expect(at(800 * 0.37, { grounded: false })).toMatchObject({ state: 'warn', color: 'danger' }); // cannot hop in the air
  });
  test('never for air hazards, hit hazards, hazards behind the sled or muted (warded) hazards', () => {
    const s = sled(1000, 650);
    expect(planTelegraph([hz('roguePacket', 1500)], s, FAR)).toEqual([]);
    expect(planTelegraph([hz('packetSpike', 1500, { hit: true })], s, FAR)).toEqual([]);
    expect(planTelegraph([hz('packetSpike', 1000)], s, FAR)).toEqual([]);
    expect(planTelegraph([hz('packetSpike', 900)], s, FAR)).toEqual([]);
    const warded = hz('overflowFirewall', 1500);
    expect(planTelegraph([warded, hz('packetSpike', 1600)], s, FAR, { isMuted: (h) => h === warded }).map((m) => m.kind)).toEqual(['hop']);
  });
  test('nearest first, capped at maxMarks, urgency rises from 0 at the warn distance to 1 at the box', () => {
    const list = [];
    for (let i = 0; i < GROUND_WARN.maxMarks + 3; i++) list.push(hz('packetSpike', 2000 - i * 100));
    const marks = planTelegraph(list, sled(1000, 650), FAR);
    expect(marks.length).toBe(GROUND_WARN.maxMarks);
    for (let i = 1; i < marks.length; i++) expect(marks[i].dx).toBeGreaterThan(marks[i - 1].dx);
    expect(marks[0].dx).toBe(1000 - (GROUND_WARN.maxMarks + 2) * 100);
    const u = (dx) => planTelegraph([hz('packetSpike', 1000 + dx)], sled(1000, 650), FAR)[0].urgency;
    expect(u(1300)).toBeCloseTo(0, 6);
    expect(u(650)).toBeCloseTo(0.5, 6);
    expect(u(1)).toBeGreaterThan(0.99);
  });
  test('onScreen: the marker rides the screen edge until the hazard box enters the view', () => {
    const h = hz('packetSpike', 1600);
    expect(planTelegraph([h], sled(1000, 650), 1500)[0].onScreen).toBe(false);
    expect(planTelegraph([h], sled(1000, 650), 1589)[0].onScreen).toBe(false);
    expect(planTelegraph([h], sled(1000, 650), 1591)[0].onScreen).toBe(true); // left edge of the 20 px box is at 1590
  });
  test('airborne and forecast to land well past the hazard: marked clear (drawn dim, no sound); landing short is a normal warning', () => {
    const h = hz('packetSpike', 1400);
    const over = planTelegraph([h], sled(1000, 700, { grounded: false, landX: 1400 + 10 + GROUND_WARN.clearMarginPx + 1 }), FAR)[0];
    expect(over).toMatchObject({ clear: true, state: 'clear' });
    const short = planTelegraph([h], sled(1000, 700, { grounded: false, landX: 1400 + 10 + GROUND_WARN.clearMarginPx - 1 }), FAR)[0];
    expect(short).toMatchObject({ clear: false, state: 'warn', color: 'danger' });
    expect(planTelegraph([h], sled(1000, 700, { grounded: false, landX: null }), FAR)[0].clear).toBe(false);
    expect(planTelegraph([h], sled(1000, 700, { grounded: true, landX: 9999 }), FAR)[0].clear).toBe(false);
  });
  test('accepts any iterable and does not mutate its input', () => {
    const h = Object.freeze(hz('packetSpike', 1500));
    expect(planTelegraph(new Set([h]), sled(1000, 650), FAR).length).toBe(1);
  });
});

describe('TelegraphTracker: each sound once per hazard', () => {
  const plan = (list, s) => planTelegraph(list, s, FAR);
  test('warn fires once when a hazard is first announced, go fires once when it first turns lime', () => {
    const tr = new TelegraphTracker();
    const h = hz('packetSpike', 2000);
    const log = [];
    let x = 600;
    for (let t = 0; t < 3000 && x < 2000; t += 16) { x += 700 * 0.016; for (const e of tr.update(t, plan([h], sled(x, 700)))) log.push({ ...e, x }); }
    expect(log.map((e) => e.type)).toEqual(['warn', 'go']);
    expect(log[0]).toMatchObject({ kind: 'hop', ref: h, sound: true });
    expect(2000 - log[0].x).toBeGreaterThan(1380); // announced at the 1400 px warn distance (2 s at 700 px/s)
    expect((2000 - log[1].x) / 700).toBeLessThanOrEqual(0.38);
    expect((2000 - log[1].x) / 700).toBeGreaterThan(0.36);
  });
  test('a brace hazard warns (kind brace) and never cues a hop', () => {
    const tr = new TelegraphTracker();
    const h = hz('overflowFirewall', 1200);
    const ev = [];
    for (let x = 0; x < 1200; x += 10) ev.push(...tr.update(x, plan([h], sled(x, 600))));
    expect(ev.map((e) => [e.type, e.kind])).toEqual([['warn', 'brace']]);
  });
  test('warn sounds are rate limited (two hazards announced in the same frame: one sound), events are not', () => {
    const tr = new TelegraphTracker();
    const ev = tr.update(1000, plan([hz('packetSpike', 1500), hz('glitchChasm', 1700)], sled(1000, 650)));
    expect(ev.map((e) => e.type)).toEqual(['warn', 'warn']);
    expect(ev.map((e) => e.sound)).toEqual([true, false]);
    const later = tr.update(1000 + GROUND_WARN.warnGapMs, plan([hz('packetSpike', 1900)], sled(1000, 650)));
    expect(later[0].sound).toBe(true);
  });
  test('a clear mark makes no sound until it stops being clear', () => {
    const tr = new TelegraphTracker();
    const h = hz('packetSpike', 1400);
    expect(tr.update(0, plan([h], sled(1000, 700, { grounded: false, landX: 2000 })))).toEqual([]);
    expect(tr.update(16, plan([h], sled(1010, 700, { grounded: false, landX: 1300 }))).map((e) => e.type)).toEqual(['warn']);
  });
  test('firstWarnMs records when each hazard was first announced (the measured telegraph lead)', () => {
    const tr = new TelegraphTracker();
    const h = hz('packetSpike', 1500);
    expect(tr.firstWarnMs(h)).toBe(null);
    tr.update(420, plan([h], sled(1000, 650)));
    tr.update(900, plan([h], sled(1300, 650)));
    expect(tr.firstWarnMs(h)).toBe(420);
  });
});
