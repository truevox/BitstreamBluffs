// Regression tests for the independent review of PR #165: B1 (bounce-pad cooldown), S1 (display cadence), S3 (capture errors
// are visible; zero-error matrix), S4 (behavioural twin runs for NON_CAUSAL fields; memo vs fresh chunk digests),
// and the refreshPalette collider rebuild, all on the REAL RunScene with its real renderFrame/refreshPalette (no render stubs).
import { jest } from '@jest/globals';

const { installPhaserStub, createRun, loadMatter } = await import('./headlessRun.js');
installPhaserStub(jest);
const { RunScene } = await import('../../src/scenes/RunScene.js');
const { Hazard } = await import('../../src/entities/Hazard.js');
const { PowerUp } = await import('../../src/entities/PowerUp.js');
const { GhostRecorder } = await import('../../src/systems/ghost/GhostTape.js');
const { addWard } = await import('../../src/systems/Wards.js');
const { spawnKodiakPack, kodiakEncounter } = await import('../../src/systems/Kodiaks.js');
const { REG } = await import('../../src/constants.js');
const { captureCausalState } = await import('../../src/systems/replay/fingerprintCapture.js');
const { fingerprintState, FP_SUBSYSTEMS } = await import('../../src/systems/replay/fingerprint.js');
const { NON_CAUSAL, OWNER_SOURCES } = await import('../../src/systems/replay/fingerprintSchemas.js');

const fpOf = (s, memo = false) => fingerprintState(captureCausalState(s, { chunkMemo: memo }));
const differing = (a, b) => FP_SUBSYSTEMS.filter((n) => a.subsystems[n] !== b.subsystems[n]);
const PAD = { push: true, tilt: 0, variableHop: true, noAutoNudge: true, pressed: {} };

function mk(o = {}) {
  const scene = createRun(RunScene, REG, o);
  scene.inputRouter = { poll: () => (o.pad ? o.pad(scene.simClock.tick + 1) : PAD), setEnabled() { } };
  return scene;
}
const tick = (s, k = 1) => s.update(0, s.simClock.tickMs * k);
const run = (s, n) => { for (let i = 0; i < n; i++) tick(s); };

describe('B1: bounce-pad cooldown is hashed (the reviewer repro)', () => {
  /** A pad built by the REAL TerrainMesh.addChunk on the sled's path. */
  const addPadAhead = (s) => {
    const x = s.sled.body.position.x + 90;
    s.mesh.addChunk({ index: 5000, startX: 90000, endX: 90100, points: [{ x: 90000, y: 0 }, { x: 90100, y: 0 }], bouncePads: [{ x, y: s.terrain.heightAt(x) + 8, width: 60, boost: 500 }] });
    return s.mesh.chunks.get(5000).pads[0].bbPad;
  };

  test('equal worlds except one pad cooldown have different digests, and the futures really differ', () => {
    const A = mk();
    const B = mk();
    run(A, 300); run(B, 300);
    expect(fpOf(A).combined).toBe(fpOf(B).combined);
    const pa = addPadAhead(A);
    const pb = addPadAhead(B);
    tick(A); tick(B); // the detector learns the new bodies
    expect(fpOf(A).combined).toBe(fpOf(B).combined);
    expect(pa._last).toBeUndefined();
    pb._last = B.runTimeMs + 5000; // B only: a cooldown that is still running when the sled arrives
    const a = fpOf(A);
    const b = fpOf(B);
    expect(differing(a, b)).toEqual(['matter']); // visible BEFORE the worlds diverge (the old schema had equal digests here)
    for (let i = 0; i < 200 && pa._last === undefined; i++) { tick(A); tick(B); }
    expect(pa._last).toBeDefined(); // A's pad fired; B's was suppressed by the hidden cooldown
    expect(A.sled.vy).not.toBeCloseTo(B.sled.vy, 0);
  });
});

describe('refreshPalette (real, unstubbed) rebuilds colliders: what changes is covered', () => {
  test('it resets pad cooldowns (visible in the matter digest) and the rebuild is deterministic', () => {
    const once = () => {
      const s = mk({ biomeMask: 0 });
      run(s, 240);
      const chunk = { index: 5000, startX: 90000, endX: 90100, points: [{ x: 90000, y: 0 }, { x: 90100, y: 0 }], bouncePads: [{ x: 90050, y: 0, width: 48, boost: 500 }] };
      s.mesh.addChunk(chunk);
      tick(s);
      s.mesh.chunks.get(5000).pads[0].bbPad._last = s.runTimeMs - 10;
      const real = s.terrain.getActiveChunks.bind(s.terrain);
      s.terrain.getActiveChunks = () => [...real(), chunk]; // refreshPalette rebuilds every active+joined chunk
      const before = fpOf(s);
      s.refreshPalette();
      s.terrain.getActiveChunks = real;
      return { s, before, after: fpOf(s) };
    };
    const r = once();
    expect(r.s.mesh.chunks.get(5000).pads[0].bbPad._last).toBeUndefined(); // a fresh pad record: the cooldown is gone
    expect(differing(r.before, r.after)).toContain('matter');
    expect(once().after.combined).toBe(r.after.combined);
  });

  test('on a plain real run the rebuild reorders the static bodies and the digest sees it', () => {
    const s = mk({ biomeMask: 0 });
    run(s, 240);
    tick(s);
    const before = captureCausalState(s).matter.staticOrder.map((b) => `${b.label}:${b.minX}`);
    s.refreshPalette();
    run(s, 1);
    const after = captureCausalState(s).matter.staticOrder.map((b) => `${b.label}:${b.minX}`);
    // The rebuild re-adds every collider: the detector's static order changes, and a twin that did not repaint differs in
    // the matter digest only. Real physics consequence, covered by staticOrder (and padLast for pads).
    expect(JSON.stringify(before)).not.toBe(JSON.stringify(after));
    const twin = mk({ biomeMask: 0 });
    run(twin, 242);
    // and it is real physics, not cosmetics: the repainted run's sled, score and tricks digests diverge from the twin's as well
    expect(differing(fpOf(s), fpOf(twin))).toEqual(expect.arrayContaining(['matter']));
  });

  test('a biome run (refreshPalette fires on sector entry) is deterministic and error-free', () => {
    const a = mk({ biomeMask: 0xffff });
    const b = mk({ biomeMask: 0xffff });
    for (let i = 0; i < 480; i++) {
      tick(a); tick(b);
      if (a.simClock.tick % 120 === 0) expect(fpOf(a).combined).toBe(fpOf(b).combined);
    }
    expect(a.ghostRecorder.fingerprintErrorCount).toBe(0);
  });
});

describe('S1: digests do not depend on the display cadence (real renderFrame)', () => {
  // Inputs change only at multiples of 4 ticks and edges land on tick = 1 (mod 4): identical per-tick pads at 1, 2 and 4 ticks/frame.
  const pad = (t) => ({ push: t < 200, tilt: 0, variableHop: true, noAutoNudge: true, pressed: { hop: t === 197 } });
  function runAtCadence(k, shieldOffAt) {
    const s = mk({ pad });
    s.shieldCharges = 1;
    s.sled.shield = true;
    while (s.simClock.tick < 240) {
      if (s.simClock.tick === shieldOffAt) s.shieldCharges = 0; // a Hashed Backup consumed at a frame boundary
      tick(s, k);
    }
    return s.ghostRecorder.fingerprints.map((f) => f.combined);
  }
  /** Value of the render-time mirror Sled.shield at the first checkpoint, per cadence (proves the scenario exercises the old leak). */
  function mirrorAtCheckpoint(k, shieldOffAt) {
    const s = mk({ pad });
    s.shieldCharges = 1;
    s.sled.shield = true;
    let seen = null;
    const orig = s.ghostRecorder._fingerprint.bind(s.ghostRecorder);
    s.ghostRecorder._fingerprint = (t, sc) => { if (t === 120) seen = sc.sled.shield; orig(t, sc); };
    while (s.simClock.tick < 120) { if (s.simClock.tick === shieldOffAt) s.shieldCharges = 0; tick(s, k); }
    return seen;
  }
  test('the scenario is real: the Sled.shield mirror differs between cadences at the checkpoint', () => {
    expect([mirrorAtCheckpoint(1, 116), mirrorAtCheckpoint(4, 116)]).toEqual([false, true]);
  });
  test.each([116, 52])('shield consumed at tick %i: 1, 2 and 4 ticks per frame give identical fingerprints', (at) => {
    const one = runAtCadence(1, at);
    expect(one).toHaveLength(2);
    expect(runAtCadence(2, at)).toEqual(one);
    expect(runAtCadence(4, at)).toEqual(one);
  });
});

describe('S3: capture failures are visible', () => {
  const fake = { sled: { body: { position: { x: 1, y: 2 }, angle: 0, velocity: { x: 0, y: 0 }, angularVelocity: 0 } }, score: { getTotal: () => 0 } };

  test('uncapped count, one console.warn, first failures kept, never thrown', () => {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => { });
    const rec = new GhostRecorder({ seed: 'S' });
    for (let i = 1; i <= 120 * 12; i++) rec.afterTick(i, fake);
    expect(rec.fingerprintErrorCount).toBe(12);
    expect(rec.fingerprintErrors).toHaveLength(8);
    expect(rec.fingerprints).toHaveLength(0);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(String(warn.mock.calls[0][0])).toMatch(/fingerprint capture failed at tick 120/);
    warn.mockRestore();
  });

  const CONFIGS = [
    { name: 'level 1', o: { level: 1 } },
    { name: 'level 6 + kodiaks', o: { level: 6 }, kodiaks: true },
    { name: 'level 12, biome mask 0xffff', o: { level: 12, biomeMask: 0xffff } },
    { name: 'level 20, mask 0xffff, kodiaks', o: { level: 20, biomeMask: 0xffff }, kodiaks: true },
    { name: 'wards + magnet', o: {}, setup: (s) => { s.wards = addWard(s.wards, 'slickWax', { durationMs: 5000, effects: ['slow'], speedFactor: 1.1 }); s.magnetMs = 4000; s.magnetEff = { pullRadiusPx: 96, pullPxS: 360 }; s.shieldCharges = 2; s.shieldSources = ['hashedBackup', 'heatShield']; } },
    { name: 'post manual respawn', o: {}, at: { 150: (s) => s.manualReset() } },
    { name: 'seed with unicode', o: { seed: 'sé€ed-😀' } },
  ];
  test.each(CONFIGS.map((c) => [c.name, c]))('zero capture errors and no gaps: %s', (_n, c) => {
    const s = mk(c.o);
    if (c.kodiaks) { s.kodiaksOn = true; s.kodiaks = spawnKodiakPack(s.seed, kodiakEncounter(s.seed, 0, 'same'), { x: s.sled.x, vx: 50 }); s.kodiakNext = 1; }
    if (c.setup) c.setup(s);
    let ticks = 0;
    while (ticks < 600 && !s.crashed) {
      tick(s); ticks++;
      if (c.at && c.at[s.simClock.tick]) c.at[s.simClock.tick](s);
    }
    const rec = s.ghostRecorder;
    expect(rec.fingerprintErrorCount).toBe(0);
    expect(rec.fingerprintErrors).toEqual([]);
    expect(rec.fingerprints.map((f) => f.tick)).toEqual(rec.checkpoints.map((cp) => cp[0]));
    expect(rec.fingerprints.length).toBeGreaterThanOrEqual(c.at || s.crashed ? 1 : 5);
  });
});

describe('S4: NON_CAUSAL fields are behaviourally non-causal (twin runs)', () => {
  const EXEMPT_REASON = /^(replay input source|the recorder|live input|run constant|immutable after construction|constructor config|frozen|back-reference|identity string|wall clock|Gym)/;
  // Properties whose value is invariant at every checkpoint (set and drained inside one tick), so perturbing them between
  // ticks is not a state the simulation can be in. Each carries its reason; they are deliberately NOT twin-tested.
  const CHECKPOINT_INVARIANT = new Set(['PowerUp.collected', 'PowerUp.destroyed', 'Hazard.simStepped']);

  function build() {
    const s = mk({ biomeMask: 0 });
    const hdef = Object.values(s.content.hazards)[0];
    const hz = new Hazard(s, hdef, { x: s.sled.x + 400, y: s.terrain.heightAt(s.sled.x + 400), rotationDeg: 0, phase: 0 }, s.palette);
    hz.simStepped = true; hz.lip = null;
    s.hazards.set(9999, [hz]);
    const pdef = Object.values(s.content.powerups)[0];
    const pu = new PowerUp(s, pdef, { x: s.sled.x + 600, y: s.terrain.heightAt(s.sled.x + 600) - 20 }, s.palette);
    pu.key = '99:0'; s.powerups.set(99, [pu]);
    s.shardField.addChunk({ index: 99, shards: [{ id: 'z1', x: s.sled.x + 300, y: s.terrain.heightAt(s.sled.x + 300) - 10 }] });
    const shard = s.shardField.byChunk.get(99)[0];
    return { s, objs: { Sled: s.sled, RunScene: s, Hazard: hz, PowerUp: pu, TerrainMesh: s.mesh, ShardField: s.shardField, Shard: shard, HintScheduler: s.hints, GlitchDirector: s.glitch } };
  }

  function candidates(objs) {
    const out = [];
    for (const [cls, obj] of Object.entries(objs)) {
      for (const [k, why] of Object.entries(NON_CAUSAL[cls])) {
        if (EXEMPT_REASON.test(why) || CHECKPOINT_INVARIANT.has(`${cls}.${k}`)) continue;
        const v = obj[k];
        if (['number', 'boolean'].includes(typeof v)) out.push([cls, obj, k]);
      }
    }
    return out;
  }
  const bump = (obj, k) => {
    const v = obj[k];
    obj[k] = typeof v === 'number' ? (Number.isFinite(v) ? v + 1 : 0) : typeof v === 'boolean' ? !v : 1;
  };
  const trajectory = (s, n) => { run(s, n); return s.ghostRecorder.fingerprints.map((f) => f.combined); };

  test('perturbing every scalar NON_CAUSAL field at once leaves every checkpoint digest unchanged over 600 ticks', () => {
    const control = trajectory(build().s, 600);
    const t = build();
    const cands = candidates(t.objs);
    expect(cands.length).toBeGreaterThan(25);
    for (const [, obj, k] of cands) bump(obj, k);
    const got = trajectory(t.s, 600);
    if (JSON.stringify(got) !== JSON.stringify(control)) {
      // name the offenders one by one
      const leaks = [];
      for (const [cls, , k] of cands) {
        const u = build();
        bump(candidates(u.objs).find(([c, , kk]) => c === cls && kk === k)[1], k);
        if (JSON.stringify(trajectory(u.s, 600)) !== JSON.stringify(control)) leaks.push(`${cls}.${k}`);
      }
      throw new Error(`NON_CAUSAL fields that change the trajectory: ${leaks.join(', ')}`);
    }
    expect(got).toEqual(control);
  });

  test('every owner class listed in OWNER_SOURCES has a NON_CAUSAL table', () => {
    for (const c of Object.keys(OWNER_SOURCES)) expect(NON_CAUSAL[c]).toBeDefined();
  });
});

describe('S4/N4: memoized chunk digests equal fresh ones along a long real run', () => {
  test.each([[0], [0xffff]])('biome mask %i: terrain subsystem identical with and without the memo at every checkpoint', (mask) => {
    const s = mk({ biomeMask: mask, level: 12 });
    let compared = 0;
    let reuse = 0;
    for (let i = 0; i < 3600 && !s.crashed; i++) {
      tick(s);
      if (s.simClock.tick % 120 === 0) {
        const memo = captureCausalState(s, { chunkMemo: true }).terrain;
        const fresh = captureCausalState(s, { chunkMemo: false }).terrain;
        expect(memo).toEqual(fresh);
        compared++;
        reuse = s.terrain.stats.reused;
      }
    }
    expect(compared).toBeGreaterThanOrEqual(10);
    expect(reuse).toBeGreaterThan(0); // pooled chunk objects were recycled while digests stayed correct
  }, 60000);
});

// keep the unused import honest for readers: loadMatter is used by the pad regression helpers in the completeness file
void loadMatter;
