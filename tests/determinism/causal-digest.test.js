/**
 * Issue #140: the diagnostic causal-state digest (tools/conformance/causal-digest.mjs, NON-AUTHORITATIVE until the
 * issue #152 contract exists). These tests pin what it captures and how it reports a first divergence, so the
 * browser matrix can be trusted to see a sub-visible physics change and to tell physics from cues.
 */
import {
  captureCausalState, digestState, diffDigests, verdict, safeJson, subsystemClass, SUBSYSTEMS, instrumentRun,
} from '../../tools/conformance/causal-digest.mjs';

function body(id, label, x, y, extra = {}) {
  return { id, label, position: { x, y }, angle: 0.1, velocity: { x: 1.5, y: -0.25 }, angularVelocity: 0.01, ...extra };
}

/** A stand-in RunScene with every field the digest reads. */
function fakeRun(over = {}) {
  const sledBody = body(10, 'sled', 100, 50);
  sledBody.parts = [sledBody, body(11, 'skid', 95, 55), body(12, 'deck', 105, 45)];
  const hazards = new Map([[3, [{ def: { id: 'firewall' }, cx: 900, cy: 40, hit: false, body: body(40, 'hazard', 900, 40) }]]]);
  const run = {
    simClock: { tick: 7 },
    sled: { body: sledBody, grounded: true, msSinceContact: 0, airtimeMs: 0, heliPhase: 0, heliVel: 0, parachuteFuelMs: 3000 },
    runRandom: { physicsScramble: { state: 12345 } },
    matter: { world: { localWorld: { bodies: [sledBody, body(20, 'terrain', 0, 60), hazards.get(3)[0].body] },
      engine: { pairs: { list: [{ id: 'A10B20', isActive: true, isSensor: false, contacts: [{ normalImpulse: 0.5, tangentImpulse: 0 }] }] } } } },
    mesh: { chunks: new Map([[2, { bodies: [{ id: 20 }] }], [3, { bodies: [{ id: 21 }] }]]) },
    _chunkQueue: new Map([[4, {}]]),
    terrain: { activeList: [{ index: 2 }, { index: 3 }, { index: 4 }] },
    hazards,
    powerups: new Map(),
    collectedPowerups: new Set(['1:0']),
    kodiaks: [],
    kodiakNext: 0,
    score: { getTotal: () => 520, getSnapshot: () => ({ total: 520 }), getFlow: () => 1 },
    bsodState: { gapPx: 400, active: true, proximity01: 0.1 },
    bsod: { wallX: -300, wallSpeedPxS: 200 },
    runTimeMs: 7 * (1000 / 120),
    _teleMarks: [{ ref: hazards.get(3)[0], kind: 'hop', onScreen: true }],
    ...over,
  };
  return run;
}

describe('captureCausalState', () => {
  test('captures every subsystem, including each part of the compound sled body', () => {
    const s = captureCausalState(fakeRun());
    for (const k of [...SUBSYSTEMS.authoritative, ...SUBSYSTEMS.cue, ...SUBSYSTEMS.cache]) expect(s).toHaveProperty(k);
    expect(s.tick).toBe(7);
    expect(s.sled.parts.map((p) => p[1])).toEqual(['sled', 'skid', 'deck']);
    expect(s.rng.physicsScramble).toBe(12345);
    expect(s.world).toEqual({ count: 3, bodies: [[10, 'sled'], [20, 'terrain'], [40, 'hazard']] });
    expect(s.terrain.physical).toEqual([2, 3]);
    expect(s.terrain.queued).toEqual([4]);
    expect(s.terrainCache.active).toEqual([2, 3, 4]);
    expect(s.contacts.active[0][0]).toBe('A10B20');
    expect(s.telegraph.marks).toContain('"onScreen":true');
    expect(s.telegraph.marks).not.toContain('firewall'); // the hazard ref is not serialised into the marks
  });

  test('is JSON-safe and never throws on a scene with no sled, world or entities', () => {
    const s = captureCausalState({ simClock: { tick: 0 } });
    expect(() => JSON.stringify(s)).not.toThrow();
    expect(s.sled).toBeNull();
  });
});

describe('digest + diff', () => {
  const seq = (mut) => Array.from({ length: 5 }, (_, i) => {
    const run = fakeRun({ simClock: { tick: i + 1 } });
    if (mut) mut(run, i + 1);
    return digestState(captureCausalState(run));
  });

  test('identical runs: no divergence, verdict isolated', () => {
    const d = diffDigests(seq(), seq());
    expect(d.first).toBeNull();
    expect(d.equalTicks).toBe(5);
    expect(verdict(d)).toBe('isolated');
  });

  test('a 1e-12 velocity change is a causal leak at the exact tick, attributed to the sled', () => {
    const d = diffDigests(seq(), seq((run, t) => { if (t >= 3) run.sled.body.parts[1].velocity = { x: 1.5 + 1e-12, y: -0.25 }; }));
    expect(d.first).toEqual({ tick: 3, subsystems: ['sled'], classes: ['authoritative'] });
    expect(d.firstAuthoritative.tick).toBe(3);
    expect(verdict(d)).toBe('causal-leak');
  });

  test('a world insertion-order swap is caught even when the membership is the same', () => {
    const d = diffDigests(seq(), seq((run, t) => { if (t === 4) run.matter.world.localWorld.bodies.reverse(); }));
    expect(d.first.tick).toBe(4);
    expect(d.first.subsystems).toContain('world');
  });

  test('a telegraph-only change is a cue leak, not a causal leak', () => {
    const d = diffDigests(seq(), seq((run, t) => { if (t >= 2) run._teleMarks[0].onScreen = false; }));
    expect(d.first.subsystems).toEqual(['telegraph']);
    expect(d.firstAuthoritative).toBeNull();
    expect(verdict(d)).toBe('cue-leak');
  });

  test('a terrain-cache-only change (cosmetic reads warming the generator) is allowed', () => {
    const d = diffDigests(seq(), seq((run) => { run.terrain.activeList.push({ index: 5 }); }));
    expect(d.first.subsystems).toEqual(['terrainCache']);
    expect(verdict(d)).toBe('isolated');
  });

  test('subsystem classes', () => {
    expect(subsystemClass('rng')).toBe('authoritative');
    expect(subsystemClass('sfx')).toBe('cue');
    expect(subsystemClass('terrainCache')).toBe('cache');
  });
});

describe('safeJson', () => {
  test('masks wall-clock fields and survives cycles', () => {
    const p = { runId: '1700000000000-SEED', cause: 'bsod', record: { endedAt: 1700000001234, score: 5 } };
    p.self = p;
    const out = JSON.parse(safeJson(p));
    expect(out.runId).toBe('[wallclock]');
    expect(out.record.endedAt).toBe('[wallclock]');
    expect(out.record.score).toBe(5);
    expect(out.self).toBe('[ref]');
  });
});

describe('instrumentRun', () => {
  test('logs only what the sim emits inside a tick, then digests', () => {
    const emitted = [];
    const game = { events: { emit: (...a) => { emitted.push(a[0]); return true; } } };
    const run = fakeRun();
    run.playSfx = () => {};
    run.simTick = function () { this.playSfx('groundWarn', { brace: false }); game.events.emit('bb:nearMiss', { points: 50 }); };
    const got = [];
    instrumentRun(run, game, (state, digest) => got.push({ state, digest }), captureCausalState, digestState, safeJson);
    game.events.emit('bb:hudOnly', {}); // outside a tick: not logged
    run.simTick(1000 / 120, {});
    expect(got).toHaveLength(1);
    expect(got[0].state.sfx).toEqual([['groundWarn', '{"brace":false}']]);
    expect(got[0].state.events).toEqual([['bb:nearMiss', '{"points":50}']]);
    expect(emitted).toEqual(['bb:hudOnly', 'bb:nearMiss']);
  });
});
