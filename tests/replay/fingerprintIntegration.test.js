// End-to-end on the REAL RunScene / GhostRecorder (real Matter, only rendering stubbed; see headlessRun.js): determinism,
// read-only capture, the BSOD-only and Kodiak-only mutations, real compareRuns, the hook, and the cost per checkpoint.
import { jest } from '@jest/globals';

const { installPhaserStub, createRun, loadMatter } = await import('./headlessRun.js');
installPhaserStub(jest);
const { RunScene } = await import('../../src/scenes/RunScene.js');
const { REG } = await import('../../src/constants.js');
const { GhostRecorder } = await import('../../src/systems/ghost/GhostTape.js');
const { spawnKodiakPack, kodiakEncounter } = await import('../../src/systems/Kodiaks.js');
const { captureCausalState } = await import('../../src/systems/replay/fingerprintCapture.js');
const { FP_SUBSYSTEMS, compareRuns, fingerprintState } = await import('../../src/systems/replay/fingerprint.js');
const { clone } = await import('./fingerprintReference.js');

const padFor = (tick) => ({
  push: tick < 300, tilt: tick > 420 && tick < 460 ? -1 : 0, variableHop: true, noAutoNudge: true, tuck: tick > 500 && tick < 540,
  pressed: { hop: tick === 350 || tick === 600 },
});

/** A fresh real run; `mutations` = { [tick]: (scene) => void } applied after that tick's update. */
function realRun({ seed = 'RPLAY118', level = 1, kodiaks = false, mutations = {}, pad = padFor } = {}) {
  const scene = createRun(RunScene, REG, { seed, level });
  if (kodiaks) {
    scene.kodiaksOn = true;
    scene.kodiaks = spawnKodiakPack(scene.seed, kodiakEncounter(scene.seed, 0, 'same'), { x: scene.sled.x, vx: 50 });
    scene.kodiakNext = 1;
  }
  scene.inputRouter = { poll: () => pad(scene.simClock.tick + 1), setEnabled() { } };
  return {
    scene,
    /** advance one display frame = one tick; returns the new tick */
    tick() {
      scene.update(0, scene.simClock.tickMs);
      const t = scene.simClock.tick;
      if (mutations[t]) mutations[t](scene);
      return t;
    },
  };
}

/** RunTrace over the real simulator: stored checkpoints come from the real GhostRecorder hook. */
function realTrace(opts, endTick) {
  const run = realRun(opts);
  while (run.scene.simClock.tick < endTick) run.tick();
  const rec = run.scene.ghostRecorder;
  const counters = { sims: 0 };
  const simulate = (toTick, onTick) => {
    counters.sims++;
    const r = realRun(opts);
    while (r.scene.simClock.tick < toTick) { const t = r.tick(); onTick(r.scene, t); }
  };
  return {
    counters, recorder: rec, scene: run.scene,
    causalDigest: 'sha256:synthetic',
    checkpoints: rec.fingerprints.map(({ tick, combined, subsystems }) => ({ tick, combined, subsystems })),
    resimulate: ({ fromTick, toTick }) => {
      const out = [];
      simulate(toTick, (scene, t) => { if (t > fromTick) out.push(fingerprintState(captureCausalState(scene))); });
      return out;
    },
    dumpAt: (tick) => { let st; simulate(tick, (scene, t) => { if (t === tick) st = captureCausalState(scene); }); return st; },
  };
}

describe('real RunScene: determinism', () => {
  test('same inputs twice give identical recorder fingerprints at every checkpoint, all 13 subsystems', () => {
    const a = realTrace({}, 720);
    const b = realTrace({}, 720);
    expect(a.recorder.fingerprintErrors).toEqual([]);
    expect(a.checkpoints.map((c) => c.tick)).toEqual([120, 240, 360, 480, 600, 720]);
    expect(b.checkpoints).toEqual(a.checkpoints);
    expect(Object.keys(a.checkpoints[0].subsystems)).toEqual([...FP_SUBSYSTEMS]);
    const sledStates = [a, b].map((r) => r.recorder.checkpoints);
    expect(sledStates[0]).toEqual(sledStates[1]); // the unchanged exact sled checkpoints agree too
  });

  test('a different seed or different inputs change the fingerprints', () => {
    const base = realTrace({}, 360).checkpoints;
    expect(realTrace({ seed: 'OTHER' }, 360).checkpoints[2].combined).not.toBe(base[2].combined);
    expect(realTrace({ pad: (t) => ({ ...padFor(t), pressed: { hop: t === 200 } }) }, 360).checkpoints[2].combined).not.toBe(base[2].combined);
  });

  test('compareRuns on two equal real runs: match', async () => {
    expect((await compareRuns(realTrace({}, 360), realTrace({}, 360))).status).toBe('match');
  });
});

describe('GhostRecorder hook', () => {
  test('existing exact sled checkpoints and tape shape are unchanged; fingerprints are kept beside the tape', () => {
    const t = realTrace({}, 360);
    const tape = t.recorder.finish({ runId: 'r', distanceM: 1, score: 1, endedAt: 1 });
    expect(Object.keys(tape)).not.toContain('fingerprints');
    expect(tape.checkpoints.map((c) => c.length)).toEqual([8, 8, 8]); // [tick, x, y, angle, vx, vy, w, score]
    expect(t.recorder.fingerprints).toHaveLength(3);
  });

  test('a capture failure is recorded, never thrown (a fingerprint must not break a run)', () => {
    const rec = new GhostRecorder({ seed: 'S' });
    const fake = { sled: { body: { position: { x: 1, y: 2 }, angle: 0, velocity: { x: 0, y: 0 }, angularVelocity: 0 } }, score: { getTotal: () => 0 } };
    expect(() => { for (let i = 1; i <= 240; i++) rec.afterTick(i, fake); }).not.toThrow();
    expect(rec.checkpoints).toHaveLength(2);
    expect(rec.fingerprints).toHaveLength(0);
    expect(rec.fingerprintErrors).toHaveLength(2);
  });

  test('it captures only at checkpoint ticks, never per tick', () => {
    const rec = new GhostRecorder({ seed: 'S' });
    const calls = [];
    rec._fingerprint = (tick) => calls.push(tick);
    const fake = { sled: { body: { position: { x: 1, y: 2 }, angle: 0, velocity: { x: 0, y: 0 }, angularVelocity: 0 } } };
    for (let i = 1; i <= 360; i++) rec.afterTick(i, fake);
    expect(calls).toEqual([120, 240, 360]);
  });
});

describe('capture is read-only', () => {
  /** Deep write-trap view: any set/delete/define on the scene graph throws; Map/Set mutators throw. */
  function readOnly(root) {
    const cache = new WeakMap();
    const wrap = (v) => {
      if (v === null || (typeof v !== 'object' && typeof v !== 'function')) return v;
      if (cache.has(v)) return cache.get(v);
      const p = new Proxy(v, {
        get(t, k) {
          const x = Reflect.get(t, k, t);
          if (typeof x === 'function') {
            if ((t instanceof Map || t instanceof Set) && ['set', 'add', 'delete', 'clear'].includes(k)) return () => { throw new Error(`write ${String(k)}`); };
            return (...args) => {
              const res = x.apply(t, args);
              if (res && typeof res.next === 'function' && typeof res[Symbol.iterator] === 'function') {
                return { [Symbol.iterator]() { return this; }, next() { const n = res.next(); return { done: n.done, value: wrap(n.value) }; } };
              }
              return res;
            };
          }
          return wrap(x);
        },
        set(_t, k) { throw new Error(`capture wrote ${String(k)}`); },
        defineProperty(_t, k) { throw new Error(`capture defined ${String(k)}`); },
        deleteProperty(_t, k) { throw new Error(`capture deleted ${String(k)}`); },
      });
      cache.set(v, p);
      return p;
    };
    return wrap(root);
  }

  test('through a deep write-trapping proxy, capture succeeds and equals the direct capture', () => {
    const r = realRun({ kodiaks: true });
    for (let i = 0; i < 300; i++) r.tick();
    const direct = captureCausalState(r.scene, { chunkMemo: false });
    const viaProxy = captureCausalState(readOnly(r.scene), { chunkMemo: false });
    expect(viaProxy).toEqual(direct);
  });

  test('no RNG draw, no clock, no Math.random; every sim stream state and Matter id counter is unchanged', () => {
    const r = realRun({ kodiaks: true });
    for (let i = 0; i < 250; i++) r.tick();
    const s = r.scene;
    const Matter = loadMatter();
    const snap = () => ({
      streams: Object.fromEntries(['physicsScramble', 'visualSled', 'visualFx', 'visualCamera'].map((k) => [k, s.runRandom[k].state])),
      bears: s.kodiaks.map((k) => k.rng.state), glitch: s.glitch.rng && s.glitch.rng.state, terrain: s.terrain.rng.state,
      nextId: Matter.Common._nextId, keys: Object.keys(s).sort(), sledKeys: Object.keys(s.sled).sort(),
      stats: { ...s.terrain.stats }, pool: s.terrain.pool.length, active: s.terrain.activeList.length,
      state: clone(captureCausalState(s, { chunkMemo: false })),
    });
    const before = snap();
    const rnd = jest.spyOn(Math, 'random');
    const now = jest.spyOn(Date, 'now');
    const perf = jest.spyOn(performance, 'now');
    captureCausalState(s); captureCausalState(s, { chunkMemo: false });
    fingerprintState(captureCausalState(s));
    expect([rnd.mock.calls.length, now.mock.calls.length, perf.mock.calls.length]).toEqual([0, 0, 0]);
    rnd.mockRestore(); now.mockRestore(); perf.mockRestore();
    expect(snap()).toEqual(before);
  });
});

describe('real mutations', () => {
  const ulp = (x) => { const dv = new DataView(new ArrayBuffer(8)); dv.setFloat64(0, x); dv.setBigUint64(0, dv.getBigUint64(0) + 1n); return dv.getFloat64(0); };

  test('BSOD-only: real BsodPursuit.wallX +1 ulp changes bsod and combined, every other digest is bit-identical', () => {
    const r = realRun();
    for (let i = 0; i < 240; i++) r.tick();
    const a = fingerprintState(captureCausalState(r.scene));
    r.scene.bsod.wallX = ulp(r.scene.bsod.wallX);
    const b = fingerprintState(captureCausalState(r.scene));
    expect(b.subsystems.bsod).not.toBe(a.subsystems.bsod);
    expect(b.combined).not.toBe(a.combined);
    for (const n of FP_SUBSYSTEMS.filter((x) => x !== 'bsod')) expect([n, b.subsystems[n]]).toEqual([n, a.subsystems[n]]);
  });

  test('Kodiak-only: a bear changing phase moves kodiak and combined; sled and the rest are bit-identical', () => {
    const r = realRun({ kodiaks: true });
    for (let i = 0; i < 240; i++) r.tick();
    expect(r.scene.kodiaks.length).toBeGreaterThan(0);
    const a = fingerprintState(captureCausalState(r.scene));
    r.scene.kodiaks[0].phase = 'lunge';
    const b = fingerprintState(captureCausalState(r.scene));
    expect(b.subsystems.kodiak).not.toBe(a.subsystems.kodiak);
    expect(b.combined).not.toBe(a.combined);
    for (const n of FP_SUBSYSTEMS.filter((x) => x !== 'kodiak')) expect([n, b.subsystems[n]]).toEqual([n, a.subsystems[n]]);
  });

  test('the old sled-only checkpoint cannot see a Kodiak change, the subsystem fingerprint can (motivating example)', () => {
    const opts = { kodiaks: true };
    const a = realTrace(opts, 360);
    const b = realTrace({ ...opts, mutations: { 181: (s) => { s.kodiaks[0].ageMs += 1; } } }, 360);
    // exact sled checkpoints (the legacy detector) are identical: the bear is far from the sled
    expect(b.recorder.checkpoints).toEqual(a.recorder.checkpoints);
    expect(b.checkpoints[0].combined).toBe(a.checkpoints[0].combined);
    expect(b.checkpoints[1].combined).not.toBe(a.checkpoints[1].combined);
    const differing = FP_SUBSYSTEMS.filter((n) => b.checkpoints[1].subsystems[n] !== a.checkpoints[1].subsystems[n]);
    expect(differing).toEqual(['kodiak']);
  });

  test('compareRuns on the REAL simulator localizes a Kodiak-only mutation to its tick and field', async () => {
    const opts = { kodiaks: true };
    const a = realTrace(opts, 360);
    const b = realTrace({ ...opts, mutations: { 181: (s) => { s.kodiaks[0].ageMs += 1; } } }, 360);
    const r = await compareRuns(a, b);
    expect(r).toMatchObject({
      status: 'diverged', firstDivergentTick: 181, firstDivergentCheckpoint: 240, subsystem: 'kodiak',
      fieldPath: 'kodiak.bears[0].ageMs', differingSubsystems: ['kodiak'], resims: 2,
    });
    expect(r.matchingSubsystems).toEqual(FP_SUBSYSTEMS.filter((n) => n !== 'kodiak'));
    expect(r.expected).not.toBe(r.actual);
  }, 60000);

  test('compareRuns on the REAL simulator localizes a BSOD-only mutation', async () => {
    const a = realTrace({}, 360);
    const b = realTrace({ mutations: { 181: (s) => { s.bsod.wallX = ulp(s.bsod.wallX); } } }, 360);
    const r = await compareRuns(a, b);
    expect(r).toMatchObject({ status: 'diverged', firstDivergentTick: 181, firstDivergentCheckpoint: 240, subsystem: 'bsod', fieldPath: 'bsod.wallX' });
    expect(r.differingSubsystems).toContain('bsod');
    expect(r.differingSubsystems[0]).toBe('bsod');
  }, 60000);
});

describe('cost per checkpoint', () => {
  test('capture + fingerprint, warm (memoized chunk digests) and cold, on a real run at tick 1200', () => {
    const r = realRun();
    for (let i = 0; i < 1200; i++) r.tick();
    const s = r.scene;
    const time = (fn, n) => { const t0 = performance.now(); for (let i = 0; i < n; i++) fn(); return (performance.now() - t0) / n; };
    const cold = time(() => fingerprintState(captureCausalState(s, { chunkMemo: false })), 20);
    captureCausalState(s);
    const warm = time(() => fingerprintState(captureCausalState(s)), 50);
    const capOnly = time(() => captureCausalState(s), 50);
    const st = captureCausalState(s);
    // eslint-disable-next-line no-console
    console.log(`checkpoint cost (jsdom, node): warm ${warm.toFixed(2)} ms, cold ${cold.toFixed(2)} ms, capture-only ${capOnly.toFixed(2)} ms;`
      + ` joined chunks ${st.terrain.joined.length}, static bodies ${st.matter.staticOrder.length}, pairs ${st.matter.pairs.length}`);
    expect(warm).toBeLessThan(50);
    expect(cold).toBeLessThan(200);
  });
});
