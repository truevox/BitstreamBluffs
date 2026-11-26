// Issue #68: Cemetery Montage / Graveyard Swarm — selection, timing, budgets, reduced motion, and the Game Over view's
// data gathering (course/ruleset checks, corrupt traces, deduplication with the ghost library's roles).
import { jest } from '@jest/globals';
import { GhostRecorder, decodeTrace, tracePose, TRACE_EVERY } from '../../src/systems/ghost/GhostTape.js';
import { GhostLibrary } from '../../src/systems/ghost/GhostLibrary.js';
import { AttemptHistory, MemoryAttemptBackend } from '../../src/systems/ghost/AttemptHistory.js';
import {
  selectAttempts, planMontage, deviceBudget, DensityGovernor, ridersWithinBudget, decimate, overviewTransform,
  followTransform, poseBounds, lastTick, RIDER_BUDGET, MONTAGE_INDIVIDUAL_MAX, MAX_SPEED, TAIL_SAMPLES,
} from '../../src/systems/ghost/MontagePlan.js';
import { SIM_REVISION } from '../../src/systems/replay/ruleset.js';

const pad = { push: false, tilt: 0, pressed: {} };
let serial = 0;
function makeTape({ seed = 'S1', biomeMask = 0, ticks = 240, id, endedAt, extra = {} } = {}) {
  const n = ++serial;
  const rec = new GhostRecorder({ seed, biomeMask, mode: 'normal', simRevision: SIM_REVISION, ...extra });
  const scene = (t) => ({ sled: { body: { position: { x: t * 3, y: t + n * 5 }, angle: 0.05 * n, velocity: { x: 0, y: 0 }, angularVelocity: 0 } },
    score: { getTotal: () => 0 } });
  for (let t = 1; t <= ticks; t++) { rec.input(t, pad); rec.afterTick(t, scene(t)); }
  return rec.finish({ runId: id || `run-${n}`, distanceM: ticks / 10, score: 1, endedAt: endedAt ?? 1000 + n });
}
const attempt = (ticks, id) => {
  const t = makeTape({ ticks, id });
  return { meta: { id: t.runId, distanceM: t.distanceM, endedAt: t.endedAt }, poses: decodeTrace(t) };
};

describe('selection is deterministic and bounded', () => {
  test('montage style labels the most recent eight at most', () => {
    expect(selectAttempts(3, 'montage', 40)).toEqual([0, 1, 2]);
    expect(selectAttempts(20, 'montage', 40)).toEqual([12, 13, 14, 15, 16, 17, 18, 19]);
    expect(selectAttempts(20, 'montage', 4)).toEqual([16, 17, 18, 19]);
    expect(MONTAGE_INDIVIDUAL_MAX).toBe(8);
  });
  test('swarm draws all when they fit, else evenly spaced picks that keep the oldest and the newest', () => {
    expect(selectAttempts(10, 'swarm', 40)).toHaveLength(10);
    const picks = selectAttempts(40, 'swarm', 15);
    expect(picks).toHaveLength(15);
    expect(picks[0]).toBe(0);
    expect(picks.at(-1)).toBe(39);
    expect(new Set(picks).size).toBe(15);
    expect(selectAttempts(40, 'swarm', 15)).toEqual(picks);
    expect(selectAttempts(5, 'swarm', 0)).toEqual([]);
    expect(selectAttempts(5, 'swarm', 1)).toEqual([4]);
  });
});

describe('the plan', () => {
  test('nothing to show: no past attempt, or the montage switched off', () => {
    expect(planMontage({ hero: attempt(100), attempts: [] })).toBeNull();
    expect(planMontage({ hero: null, attempts: [attempt(100)], style: 'off' })).toBeNull();
  });

  test('the riders are exactly the stored traces, numbered in order, the hero last', () => {
    const past = [attempt(120, 'p1'), attempt(200, 'p2'), attempt(160, 'p3')];
    const hero = attempt(400, 'win');
    const plan = planMontage({ hero, attempts: past, heroIsBest: true });
    expect(plan.riders.map((r) => r.id)).toEqual(['p1', 'p2', 'p3', 'win']);
    expect(plan.riders.map((r) => r.label)).toEqual(['#1', '#2', '#3', 'NEW BEST']);
    // The drawn pose at any tick IS the shared tracePose of the original trace: the correct attempt replays.
    for (const [i, r] of plan.riders.entries()) {
      const src = i < 3 ? past[i].poses : hero.poses;
      expect(r.poses).toBe(src);
      for (const tick of [4, 37, 120]) expect(tracePose(r.poses, tick)).toEqual(tracePose(src, tick));
    }
    expect(plan.riders[1].endTick).toBe(200);
    expect(plan.pastTotal).toBe(3);
    expect(plan.bestPastM).toBe(20);
    expect(plan.heroM).toBe(40);
    expect(planMontage({ hero, attempts: past }).riders.at(-1).label).toBe('THIS RUN');
  });

  test('playback runs until the last past self has fallen (plus a beat), at 1x..MAX_SPEED', () => {
    const plan = planMontage({ hero: attempt(4000), attempts: [attempt(200), attempt(300)] });
    expect(plan.playEndTick).toBe(300 + 2 * 120);
    expect(plan.speed).toBe(1);
    const long = planMontage({ hero: attempt(80000), attempts: [attempt(60000)] });
    expect(long.speed).toBe(MAX_SPEED);
    const noHero = planMontage({ hero: null, attempts: [attempt(200)] });
    expect(noHero.playEndTick).toBe(440);
  });

  test('the swarm cap counts the hero, and the rider budget never drops the hero', () => {
    const past = Array.from({ length: 30 }, (_, i) => attempt(40 + i * 4, `p${i}`));
    const plan = planMontage({ hero: attempt(500, 'win'), attempts: past, style: 'swarm', cap: 16 });
    expect(plan.riders).toHaveLength(16);
    expect(plan.riders.filter((r) => r.label).map((r) => r.id)).toEqual(['win']); // swarm: past selves unlabelled
    expect(plan.pastShown).toBe(15);
    const few = ridersWithinBudget(plan, 4);
    expect(few[0].id).toBe('win');
    expect(few.slice(1).map((r) => r.id)).toEqual(plan.riders.slice(12, 15).map((r) => r.id)); // newest kept
  });

  test('device tiers: Chromebook-class starts at the low budget', () => {
    expect(deviceBudget({ hardwareConcurrency: 8, deviceMemory: 8, userAgent: 'X11; Linux' })).toEqual({ tier: 'standard', riders: 40, tail: TAIL_SAMPLES.standard });
    expect(deviceBudget({ hardwareConcurrency: 4 }).tier).toBe('low');
    expect(deviceBudget({ hardwareConcurrency: 8, deviceMemory: 2 }).tier).toBe('low');
    expect(deviceBudget({ hardwareConcurrency: 8, userAgent: 'Mozilla/5.0 (X11; CrOS x86_64 14541.0.0)' }).riders).toBe(RIDER_BUDGET.low);
    expect(deviceBudget({}).tier).toBe('standard');
  });
});

describe('adaptive density', () => {
  test('sustained long frames halve riders and tails, never below the minimum; short frames restore slowly', () => {
    const gov = new DensityGovernor(40, { tail: 16 });
    for (let i = 0; i < 400; i++) gov.frame(50);
    expect(gov.riders).toBe(RIDER_BUDGET.min);
    expect(gov.tail).toBe(0);
    expect(gov.degraded).toBeGreaterThan(0);
    for (let i = 0; i < 5000; i++) gov.frame(10);
    expect(gov.riders).toBe(40);
    expect(gov.tail).toBe(16);
  });
  test('a single hitch (tab switch, GC) is not a slow device', () => {
    const gov = new DensityGovernor(40);
    for (let i = 0; i < 100; i++) gov.frame(i % 50 === 0 ? 400 : 16);
    expect(gov.riders).toBe(40);
  });
});

describe('geometry', () => {
  test('the overview fits every trajectory inside the frame', () => {
    const plan = planMontage({ hero: attempt(900), attempts: [attempt(300), attempt(600)] });
    const view = { x: 8, y: 22, w: 448, h: 194 };
    const t = overviewTransform(plan.bounds, view);
    for (const r of plan.riders) {
      const pts = decimate(r.poses, t);
      for (let i = 0; i < pts.length; i += 2) {
        expect(pts[i]).toBeGreaterThanOrEqual(view.x - 1e-6);
        expect(pts[i]).toBeLessThanOrEqual(view.x + view.w + 1e-6);
        expect(pts[i + 1]).toBeGreaterThanOrEqual(view.y - 1e-6);
        expect(pts[i + 1]).toBeLessThanOrEqual(view.y + view.h + 1e-6);
      }
    }
  });
  test('decimation keeps both ends and bounds the point count by screen size, not run length', () => {
    const a = attempt(120000);
    const t = overviewTransform(poseBounds([{ poses: a.poses }]), { x: 0, y: 0, w: 448, h: 194 });
    const pts = decimate(a.poses, t);
    expect(pts.length / 2).toBeLessThan(600);
    const n = a.poses.length / 3;
    expect(pts[0]).toBeCloseTo(a.poses[0] * t.sx + t.ox, 3);
    expect(pts.at(-2)).toBeCloseTo(a.poses[(n - 1) * 3] * t.sx + t.ox, 3);
  });
  test('the follow camera keeps the hero a third of the way across', () => {
    const plan = planMontage({ hero: attempt(900, 'h'), attempts: [attempt(300)] });
    const view = { x: 8, y: 22, w: 448, h: 194 };
    const cam = followTransform(plan, 400, view, tracePose);
    const p = tracePose(plan.riders.at(-1).poses, 400);
    expect(p.x * cam.sx + cam.ox).toBeCloseTo(view.x + view.w / 3, 6);
    expect(lastTick(plan.riders[0].poses)).toBe(300);
  });
});

// ---------------------------------------------------------------- renderer + view (stub Phaser objects)

function stubScene({ reduceMotion = 'off' } = {}) {
  const made = [];
  const obj = () => {
    const o = new Proxy({ calls: [] }, {
      get(t, k) {
        if (k in t) return t[k];
        if (k === 'width') return 30;
        return (...args) => { t.calls.push([k, ...args]); return o; };
      },
    });
    made.push(o);
    return o;
  };
  const handlers = {};
  return {
    made,
    registry: { get: (k) => (k === 'settings' ? { reduceMotion, cemeteryMontage: 'montage', attemptHistoryKeep: 5 } : null) },
    add: { graphics: obj, bitmapText: obj, renderTexture: obj, existing: obj, rectangle: obj },
    events: { on: (e, f) => { (handlers[e] ||= []).push(f); }, off: (e, f) => { handlers[e] = (handlers[e] || []).filter((x) => x !== f); } },
    handlers,
    tweens: { add: () => {} },
    cameras: { main: {} },
  };
}

const { CemeteryMontage } = await import('../../src/ui/CemeteryMontage.js');

describe('renderer', () => {
  const colors = { hero: 1, past: [2, 3, 4], swarm: 5, grave: 6, trail: 7 };
  const view = { x: 8, y: 22, w: 448, h: 194 };
  const plan = () => planMontage({ hero: attempt(600, 'win'), attempts: [attempt(200, 'a'), attempt(300, 'b')], heroIsBest: true });

  test('normal motion: autoplays in the follow view, ends on the still overview', () => {
    const s = stubScene();
    const m = new CemeteryMontage(s, { view, plan: plan(), colors, reduced: false, budget: { riders: 40, tail: 16 } });
    expect(m.playing).toBe(true);
    expect(m.mode).toBe('follow');
    for (let i = 0; i < 2000 && m.playing; i++) m.update(16.7);
    expect(m.finished).toBe(true);
    expect(m.mode).toBe('overview');
    expect(m.tick).toBe(m.plan.playEndTick);
    expect(m.togglePlay()).toBe(true); // replay from the top
    expect(m.tick).toBe(0);
    m.destroy();
  });

  test('reduced motion: still overview at the final frame, never autoplays or follows; manual steps are instant', () => {
    const s = stubScene({ reduceMotion: 'on' });
    const m = new CemeteryMontage(s, { view, plan: plan(), colors, reduced: true, budget: { riders: 40, tail: 16 } });
    expect(m.playing).toBe(false);
    expect(m.mode).toBe('overview');
    expect(m.tick).toBe(m.plan.playEndTick);
    expect(m.togglePlay()).toBe(false);
    m.setMode('follow');
    expect(m.mode).toBe('overview');
    const before = m.tick;
    m.step(-1);
    expect(m.tick).toBeLessThan(before);
    for (let i = 0; i < 60; i++) m.update(16.7);
    expect(m.tick).toBe(before - Math.round(m.plan.playEndTick / 24));
  });

  test('purely visual: no game object is made interactive, no physics or events touched', () => {
    const s = stubScene();
    const m = new CemeteryMontage(s, { view, plan: plan(), colors, reduced: false, budget: { riders: 40, tail: 16 } });
    for (let i = 0; i < 300; i++) m.update(16.7);
    const calls = s.made.flatMap((o) => o.calls.map((c) => c[0]));
    expect(calls).not.toContain('setInteractive');
    expect(calls).not.toContain('on');
    expect(s.matter).toBeUndefined();
    expect(m.stats().drawn).toBeLessThanOrEqual(3);
  });

  test('a slow device sheds riders, hero first to survive', () => {
    const past = Array.from({ length: 30 }, (_, i) => attempt(400 + i, `p${i}`));
    const p = planMontage({ hero: attempt(900, 'win'), attempts: past, style: 'swarm', cap: 40 });
    const s = stubScene();
    const m = new CemeteryMontage(s, { view, plan: p, colors, reduced: false, budget: { riders: 40, tail: 16 } });
    for (let i = 0; i < 200; i++) m.update(60);
    expect(m.stats().budget).toBe(RIDER_BUDGET.min);
    expect(m.stats().drawn).toBeLessThanOrEqual(RIDER_BUDGET.min);
  });
});

describe('Game Over view: what the montage is made of', () => {
  jest.unstable_mockModule('../../src/data/index.js', () => ({ content: {}, loadContent: () => ({}) }));
  let gatherMontage;
  beforeAll(async () => { ({ gatherMontage } = await import('../../src/ui/CemeteryMontageView.js')); });

  const setup = async () => {
    const history = await new AttemptHistory({ backend: new MemoryAttemptBackend() }).init();
    const library = new GhostLibrary();
    await library.init();
    return { history, library };
  };

  test('history plus the course ghost roles, deduplicated, oldest first, the run itself excluded', async () => {
    const { history, library } = await setup();
    const a = makeTape({ endedAt: 10 }), b = makeTape({ endedAt: 20 }), hero = makeTape({ ticks: 600, endedAt: 30 });
    for (const t of [a, b]) { await history.record(t, 5); await library.saveRun(t); }
    const favOnly = makeTape({ endedAt: 5 });
    await library.saveRun(favOnly); // becomes Latest then is replaced: favorite it so the library keeps it
    await library.setFavorite('S1', 0, 0, favOnly.runId);
    await library.saveRun(hero);
    await history.record(hero, 5);
    const got = await gatherMontage({ history, library, tape: hero });
    expect(got.hero.meta.id).toBe(hero.runId);
    expect(got.attempts.map((x) => x.meta.id)).toEqual([favOnly.runId, a.runId, b.runId]);
    expect(got.skipped).toBe(0);
  });

  test('other courses never appear; corrupt history traces are skipped and counted', async () => {
    const { history } = await setup();
    const other = makeTape({ seed: 'ELSEWHERE' }), good = makeTape(), bad = makeTape(), hero = makeTape();
    for (const t of [other, good, bad]) await history.record(t, 5);
    history.backend.poses.get(bad.runId)[0] = NaN;
    const got = await gatherMontage({ history, library: null, tape: hero });
    expect(got.attempts.map((x) => x.meta.id)).toEqual([good.runId]);
    expect(got.skipped).toBe(1);
  });

  test('an incompatible run gets no hero; a missing tape or stores never throw', async () => {
    const { history } = await setup();
    await history.record(makeTape(), 5);
    const old = { ...makeTape(), simRevision: SIM_REVISION + 7 };
    const got = await gatherMontage({ history, library: null, tape: old });
    expect(got.hero).toBeNull();
    expect(got.attempts).toHaveLength(1); // past selves of this course still show, without a hero to celebrate
    expect(await gatherMontage({ history, library: null, tape: null })).toMatchObject({ reason: 'no-run', attempts: [] });
    const broken = { list: () => { throw new Error('x'); }, attemptsFor: async () => { throw new Error('x'); } };
    const lib = { ghostsFor: async () => { throw new Error('x'); } };
    await expect(gatherMontage({ history: { ...broken, list: () => [] }, library: lib, tape: makeTape() })).resolves.toMatchObject({ attempts: [] });
  });

  test('montage traces are the exact recorded poses (no resampling before tracePose)', async () => {
    const { history } = await setup();
    const t = makeTape({ ticks: 333 });
    await history.record(t, 5);
    const got = await gatherMontage({ history, library: null, tape: makeTape() });
    expect(Array.from(got.attempts[0].poses)).toEqual(Array.from(decodeTrace(t)));
    expect(lastTick(got.attempts[0].poses)).toBe(Math.floor(333 / TRACE_EVERY) * TRACE_EVERY);
  });
});
