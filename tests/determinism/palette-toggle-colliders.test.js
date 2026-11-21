/**
 * Issue #140: a palette / colour-blind toggle is presentation and must not touch physics.
 *
 * Before the fix, RunScene.onSettingsChanged({key:'palette'}) -> refreshPalette() called TerrainMesh.addChunk on
 * every live chunk, which REMOVES and RE-ADDS its static colliders. The pool is LIFO, so every segment came back as
 * a different body (other ids, other world order), bounce-pad sensors were rebuilt with new ids, and Matter's cached
 * contact pairs under the sled (warm-start impulses) were lost. The browser matrix
 * (tools/conformance/causal-isolation-probe.mjs, case settings-palette-midrun) showed the sled's pose diverging
 * after a mid-run toggle from the Pause menu. The fix repaints with TerrainMesh.redrawChunk and leaves the
 * colliders alone.
 */
import { jest } from '@jest/globals';

// ---------------------------------------------------------------- fakes

function deep() {
  const fn = function () {};
  return new Proxy(fn, {
    get(t, k) {
      if (k === 'then') return undefined;
      if (k === Symbol.toPrimitive) return () => 0;
      if (k === Symbol.iterator) return function* empty() {};
      if (k === 'length') return 0;
      if (typeof k === 'symbol') return undefined;
      if (Object.prototype.hasOwnProperty.call(t, k) && k !== 'name' && k !== 'prototype') return t[k];
      return deep();
    },
    set(t, k, v, receiver) { return Reflect.set(t, k, v, receiver); },
    apply() { return deep(); },
    construct() { return deep(); },
  });
}

let nextId = 1;
const FakeMatter = {
  Bodies: {
    fromVertices: (x, y, [verts], opts) => ({ id: nextId++, label: opts.label, vertices: verts, position: { x, y }, isStatic: true }),
    rectangle: (x, y, w, h, opts) => ({ id: nextId++, label: opts.label, position: { x, y }, isStatic: true, isSensor: !!opts.isSensor }),
  },
  Body: {
    setStatic(b, v) { b.isStatic = v; },
    setVertices(b, v) { b.vertices = v; },
    setPosition(b, p) { b.position = { ...p }; },
  },
  Vertices: { centre: (vs) => ({ x: vs.reduce((s, v) => s + v.x, 0) / vs.length, y: vs.reduce((s, v) => s + v.y, 0) / vs.length }) },
};
const phaser = new Proxy(deep(), {
  get(t, k) {
    if (k === 'Physics') return { Matter: { Matter: FakeMatter } };
    return t[k];
  },
});
jest.unstable_mockModule('phaser', () => ({ default: phaser }));
jest.unstable_mockModule('../../src/ui/Palette.js', () => ({
  getPalette: () => new Proxy({}, { get: (t, k) => (k === 'then' ? undefined : 0x00ff00) }),
  getPaletteCss: () => new Proxy({}, { get: (t, k) => (k === 'then' ? undefined : '#00ff00') }),
  withBiomePalette: (b) => b,
}));

// Modules RunScene imports that cannot load under Jest (GLSL, the real HUD scene, bundled content).
jest.unstable_mockModule('../../src/shaders/GlitchPipeline.js', () => ({ GlitchPipeline: { install() {} }, GLITCH_PIPELINE_KEY: 'g', patternFromId: () => 0 }));
jest.unstable_mockModule('../../src/scenes/UIScene.js', () => ({ HUD_SPEED_EVENT: 'hud', UIScene: class {} }));
jest.unstable_mockModule('../../src/data/index.js', () => ({ content: {}, loadContent: () => ({}) }));

const { TerrainMesh } = await import('../../src/entities/TerrainMesh.js');
const { RunScene } = await import('../../src/scenes/RunScene.js');

function fakeWorld() {
  return {
    bodies: [],
    add(b) { this.bodies.push(b); },
    remove(b) { const i = this.bodies.indexOf(b); if (i >= 0) this.bodies.splice(i, 1); },
  };
}
function graphics() {
  const calls = [];
  const g = new Proxy({}, {
    get(t, k) {
      if (k === 'then') return undefined;
      if (k === 'calls') return calls;
      return (...a) => { calls.push(k); return g; };
    },
  });
  return g;
}
function chunk(index) {
  const points = [];
  for (let i = 0; i <= 12; i++) points.push({ x: index * 1000 + i * 16, y: 100 + i * 3 });
  return {
    index, startX: points[0].x, endX: points.at(-1).x, points,
    gaps: [{ x0: points[5].x, x1: points[6].x }], zones: [], bouncePads: [{ x: points[9].x, y: points[9].y, width: 40, boost: 500 }],
  };
}
function mesh() {
  const world = fakeWorld();
  const gfx = [];
  const scene = { matter: { world }, add: { graphics: () => { const g = graphics(); gfx.push(g); return g; } } };
  const m = new TerrainMesh(scene, new Proxy({}, { get: () => 0xffffff }), {});
  return { m, world, gfx };
}
const colliderMap = (m) => [...m.chunks.values()].map((r) => [r.bodies.map((b) => b.id), r.pads.map((b) => b.id)]);
const worldOrder = (w) => w.bodies.map((b) => b.id);

describe('TerrainMesh: repaint vs rebuild', () => {
  test('redrawChunk repaints and keeps every collider: same bodies, ids, world order, pad sensors', () => {
    const { m, world, gfx } = mesh();
    const a = chunk(1);
    const b = chunk(2);
    m.addChunk(a);
    m.addChunk(b);
    const before = { map: colliderMap(m), order: worldOrder(world), bodies: world.bodies.slice() };
    const drawn = gfx[0].calls.length;
    m.setPalette(new Proxy({}, { get: () => 0x123456 }));
    expect(m.redrawChunk(a)).toBe(true);
    expect(m.redrawChunk(b)).toBe(true);
    expect(colliderMap(m)).toEqual(before.map);
    expect(worldOrder(world)).toEqual(before.order);
    world.bodies.forEach((body, i) => expect(body).toBe(before.bodies[i]));
    expect(gfx).toHaveLength(2); // no new Graphics either
    expect(gfx[0].calls.length).toBeGreaterThan(drawn); // it did redraw
  });

  test('redrawChunk on a chunk that is not live is a no-op', () => {
    const { m, world } = mesh();
    expect(m.redrawChunk(chunk(9))).toBe(false);
    expect(world.bodies).toHaveLength(0);
  });

  test('why it matters: addChunk on a live chunk (the old repaint path) reshuffles the colliders', () => {
    const { m, world } = mesh();
    const a = chunk(1);
    m.addChunk(a);
    m.addChunk(chunk(2));
    const before = colliderMap(m);
    const order = worldOrder(world);
    m.addChunk(a);
    const after = colliderMap(m);
    expect(after).not.toEqual(before); // segments map to other pooled bodies, the pad sensor has a new id
    expect(worldOrder(world)).not.toEqual(order); // and the world order changed
    expect(after.flat(2).length).toBe(before.flat(2).length); // same membership size: only identity/order moved
  });
});

describe('RunScene: a palette setting change repaints without rebuilding colliders', () => {
  function fakeScene() {
    const calls = [];
    const live = [chunk(1), chunk(2)];
    const target = {
      sled: {}, biomeMask: 0, _biomeSector: 1,
      registry: { get: () => null },
      game: deep(),
      cameras: { main: { setBackgroundColor() {} } },
      terrain: { getActiveChunks: () => live.slice() },
      mesh: {
        chunks: new Map(live.map((c) => [c.index, {}])),
        setPalette() { calls.push('setPalette'); },
        addChunk(c) { calls.push(['addChunk', c.index]); },
        removeChunk(i) { calls.push(['removeChunk', i]); },
        redrawChunk(c) { calls.push(['redrawChunk', c.index]); return true; },
      },
      hazards: new Map(), powerups: new Map(),
    };
    const scene = new Proxy(target, {
      get(t, k) {
        if (k in t) return t[k];
        const proto = RunScene.prototype[k];
        if (typeof proto === 'function') return proto;
        if (k === 'then' || typeof k === 'symbol') return undefined;
        return deep();
      },
      set(t, k, v) { t[k] = v; return true; },
    });
    return { scene, calls };
  }

  test('onSettingsChanged({key:"palette"}) calls redrawChunk per live chunk and never addChunk/removeChunk', () => {
    const { scene, calls } = fakeScene();
    scene.onSettingsChanged({ key: 'palette', value: 'colorblind', settings: { palette: 'colorblind' } });
    const meshOps = calls.filter((c) => Array.isArray(c));
    expect(meshOps).toEqual([['redrawChunk', 1], ['redrawChunk', 2]]);
  });

  test('other settings do not repaint the terrain at all', () => {
    const { scene, calls } = fakeScene();
    scene.onSettingsChanged({ key: 'screenShake', value: false, settings: { screenShake: false } });
    expect(calls).toEqual([]);
  });
});
