// Issue 1D: RunScene.renderFrame must never write simulation state. The dev/test guard (src/systems/replay/renderGuard.js)
// locks every own property of the live sim owners during renderFrame and throws a RenderWriteError naming `Class.field`.
import { jest } from '@jest/globals';

const { installPhaserStub, createRun } = await import('./headlessRun.js');
installPhaserStub(jest);
const { RunScene } = await import('../../src/scenes/RunScene.js');
const { REG } = await import('../../src/constants.js');
const { RenderWriteError, RENDER_OWNED, RENDER_GUARD_ENABLED, collectSimOwners } = await import('../../src/systems/replay/renderGuard.js');
const { captureCausalState } = await import('../../src/systems/replay/fingerprintCapture.js');
const { fingerprintState } = await import('../../src/systems/replay/fingerprint.js');
const { FIELD_SOURCES } = await import('../../src/systems/replay/fingerprintSchemas.js');

const PAD = { push: true, tilt: 0, variableHop: true, noAutoNudge: true, pressed: {} };
const fpOf = (s) => fingerprintState(captureCausalState(s, { chunkMemo: false })).combined;

function mk(o = {}) {
  const scene = createRun(RunScene, REG, o);
  scene.inputRouter = { poll: () => PAD, setEnabled() { } };
  return scene;
}
const tick = (s) => s.update(0, s.simClock.tickMs);
const run = (s, n) => { for (let i = 0; i < n; i++) tick(s); };
/** Make the next renderFrame do `fn` (as the sled's draw step) before the real render continues. */
const injectRenderWrite = (s, fn) => { s.sled.render = () => { fn(s.sled); }; };
const render = (s) => s.renderFrame(16);
const catchErr = (fn) => { try { fn(); } catch (e) { return e; } return null; };

/** Every own property of every owner, as descriptors, to prove exact restoration. */
function snapshot(s) {
  return collectSimOwners(s).map(([cls, o]) => [cls, o, Object.getOwnPropertyDescriptors(o)]);
}
function expectRestored(snap) {
  for (const [cls, o, descs] of snap) {
    const now = Object.getOwnPropertyDescriptors(o);
    for (const [k, d] of Object.entries(descs)) {
      if (!('value' in d) || (RENDER_OWNED[cls] || []).includes(k)) continue;
      expect([cls, k, 'value' in now[k], now[k].enumerable, now[k].configurable, now[k].writable]).toEqual([cls, k, true, d.enumerable, d.configurable, d.writable]);
      expect([cls, k, Object.is(now[k].value, d.value)]).toEqual([cls, k, true]);
    }
  }
}

describe('renderFrame render guard', () => {
  test('the guard is enabled under Jest', () => {
    expect(RENDER_GUARD_ENABLED).toBe(true);
  });

  test('the installed wrapper is a non-enumerable, writable, configurable own property (stubRender still works)', () => {
    const s = mk();
    const d = Object.getOwnPropertyDescriptor(s, 'renderFrame');
    expect(d).toMatchObject({ enumerable: false, writable: true, configurable: true });
    expect(Object.keys(s)).not.toContain('renderFrame');
  });

  test('a write to a locked Sled field during renderFrame throws a RenderWriteError naming Sled.<field>, at the offending line', () => {
    const s = mk();
    run(s, 5);
    injectRenderWrite(s, (sled) => { sled.msSinceContact = 99; });
    const e = catchErr(() => render(s));
    expect(e).toBeInstanceOf(RenderWriteError);
    expect(e.message).toBe('renderFrame wrote sim state Sled.msSinceContact (render must not mutate the simulation)');
    expect(e.stack).toContain('renderGuard.test.js');
  });

  test('a nested write (sled.body.position.x) throws and names the path', () => {
    const s = mk();
    run(s, 5);
    const x = s.sled.body.position.x;
    injectRenderWrite(s, (sled) => { sled.body.position.x = 1; });
    const e = catchErr(() => render(s));
    expect(e).toBeInstanceOf(RenderWriteError);
    expect(e.message).toContain('Sled.body.position.x');
    expect(s.sled.body.position.x).toBe(x);
  });

  test('nested sim containers are read-only through cycles (body.parts[0] === body) but still readable', () => {
    const s = mk();
    run(s, 5);
    let seen;
    injectRenderWrite(s, (sled) => { seen = [sled.body.parts[0] === sled.body, sled.body.position.x, typeof sled.body.angle]; });
    expect(catchErr(() => render(s))).toBeNull();
    expect(seen[0]).toBe(true);
    expect(seen[2]).toBe('number');
    injectRenderWrite(s, (sled) => { sled.body.parts[0].position.y = 1; });
    expect(catchErr(() => render(s)).message).toContain('position.y');
  });

  test('adding a new non-allowlisted property during render throws', () => {
    const s = mk();
    run(s, 5);
    injectRenderWrite(s, (sled) => { sled.brandNew = 1; });
    const e = catchErr(() => render(s));
    expect(e).toBeInstanceOf(RenderWriteError);
    expect(e.message).toContain('Sled.brandNew');
  });

  test('deleting a sim property during render throws', () => {
    const s = mk();
    run(s, 5);
    injectRenderWrite(s, (sled) => { delete sled.airtimeMs; });
    expect(catchErr(() => render(s)).message).toContain('Sled.airtimeMs');
  });

  test('descriptors and values are restored exactly after a normal frame', () => {
    const s = mk();
    run(s, 30);
    const snap = snapshot(s);
    render(s);
    expectRestored(snap);
  });

  test('descriptors and values are restored exactly after a frame that throws, and the next frame is clean', () => {
    const s = mk();
    run(s, 30);
    const snap = snapshot(s);
    const real = s.sled.render;
    injectRenderWrite(s, (sled) => { sled.airtimeMs = 7; });
    expect(catchErr(() => render(s))).toBeInstanceOf(RenderWriteError);
    expectRestored(snap);
    s.sled.render = real;
    expect(catchErr(() => render(s))).toBeNull();
  });

  test('RENDER_OWNED fields can be written freely', () => {
    const s = mk();
    run(s, 5);
    injectRenderWrite(s, (sled) => {
      sled.squash = 0.5;
      sled._time += 1;
      s._camX += 1;
      s.shakeAmp = 0;
    });
    expect(catchErr(() => render(s))).toBeNull();
    expect(s.sled.squash).toBe(0.5);
  });

  test('every RENDER_OWNED entry has a name that is not also a hashed sim field', () => {
    for (const [cls, names] of Object.entries(RENDER_OWNED)) {
      for (const n of names) expect([cls, n, n in (FIELD_SOURCES[cls] || {})]).toEqual([cls, n, false]);
    }
  });

  test('regression: the old `sled.shield = ...` mirror write in renderFrame is rejected', () => {
    const s = mk();
    run(s, 5);
    expect(Object.prototype.hasOwnProperty.call(s.sled, 'shield')).toBe(false);
    injectRenderWrite(s, (sled) => { sled.shield = s.shieldCharges > 0; });
    expect(catchErr(() => render(s)).message).toContain('Sled.shield');
  });

  test('the shield visual is passed to Sled.render as an option derived from shieldCharges', () => {
    const s = mk();
    run(s, 5);
    const seen = [];
    s.sled.render = (dt, opts) => { seen.push(opts && opts.shield); };
    s.shieldCharges = 1;
    render(s);
    s.shieldCharges = 0;
    render(s);
    expect(seen).toEqual([true, false]);
  });

  test('the real headless run executes many frames under the guard with no throws, and digests equal the unguarded run', () => {
    const pad = () => PAD;
    const go = (guarded) => {
      const s = mk({ level: 6 });
      s.inputRouter = { poll: pad, setEnabled() { } };
      if (!guarded) s.renderFrame = RunScene.prototype.renderFrame;
      const fps = [];
      for (let i = 0; i < 600; i++) {
        tick(s);
        if (i % 100 === 99) fps.push(fpOf(s));
      }
      return fps;
    };
    expect(go(true)).toEqual(go(false));
  });
});
