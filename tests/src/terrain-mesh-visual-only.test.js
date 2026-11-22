/**
 * #65: the collider-safety half of the bridge dissolve. A look change inside an arcade bridge repaints terrain with
 * TerrainMesh.addChunk(chunk, { visualOnly: true }) and RunScene.refreshPalette(true); neither may touch a collider or
 * a sensor. The default path (a generator biome change) still removes and re-adds them, as it always did.
 */
import { jest } from '@jest/globals';

const Matter = {
  Bodies: {
    fromVertices: (x, y, verts, o) => ({ id: ++Matter.n, ...o, verts: verts[0] }),
    rectangle: (x, y, w, h, o) => ({ id: ++Matter.n, w, h, ...o }),
  },
  Body: { setStatic() {}, setVertices() {}, setPosition() {} },
  Vertices: { centre: () => ({ x: 0, y: 0 }) },
  n: 0,
};
jest.unstable_mockModule('phaser', () => ({
  default: {
    Scene: class {},
    Physics: { Matter: { Matter } },
    Renderer: { WebGL: { Pipelines: { PostFXPipeline: class {} } } },
    GameObjects: { Container: class {}, Graphics: class {}, BitmapText: class {}, Zone: class {}, Image: class {}, Rectangle: class {}, Text: class {} },
    BlendModes: { ADD: 1 },
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown', DESTROY: 'destroy' } },
    Math: { Between: (a) => a, Clamp: (v, lo, hi) => Math.min(hi, Math.max(lo, v)) },
  },
}));
jest.unstable_mockModule('../../src/entities/Sled.js', () => ({ CAT: { TERRAIN: 1, SLED: 2, SENSOR: 4 }, Sled: class {} }));
jest.unstable_mockModule('../../src/shaders/GlitchPipeline.js', () => ({ GlitchPipeline: { install() {} } }));

const { TerrainMesh } = await import('../../src/entities/TerrainMesh.js');
const { RunScene } = await import('../../src/scenes/RunScene.js');

function fakeGfx() {
  const g = { clears: 0, draws: 0 };
  const proxy = new Proxy(g, {
    get(t, k) {
      if (k in t) return t[k];
      if (typeof k === 'symbol' || k === 'then') return undefined;
      if (k === 'clear') return () => { t.clears++; return proxy; };
      return () => { t.draws++; return proxy; };
    },
  });
  return proxy;
}

function fakeScene() {
  const world = { added: [], removed: [], add(b) { this.added.push(b); }, remove(b) { this.removed.push(b); } };
  const made = [];
  return { world, made, scene: { matter: { world }, add: { graphics: () => { const g = fakeGfx(); made.push(g); return g; } } } };
}

const pt = (x, y) => ({ x, y });
const chunk = (index = 0) => ({
  index, startX: 0, endX: 160,
  points: [pt(0, 0), pt(40, 4), pt(80, 8), pt(120, 12), pt(160, 16)],
  gaps: [{ x0: 40, x1: 80 }],
  zones: [{ modId: 'highBandwidth', x0: 100, x1: 160 }],
  bouncePads: [{ x: 120, y: 12, width: 30, boost: 500 }],
});
const PAL = { bg: 1, bgAlt: 2, cyan: 3, magenta: 4, lime: 5, amber: 6, text: 7, danger: 8 };
const MODS = { highBandwidth: { colorKey: 'cyan' }, wirelessBridge: { colorKey: 'magenta' } };

describe('TerrainMesh.addChunk visualOnly', () => {
  test('redraws the graphics and leaves every collider, sensor and the world untouched', () => {
    const { scene, world, made } = fakeScene();
    const mesh = new TerrainMesh(scene, PAL, MODS);
    const c = chunk();
    mesh.addChunk(c);
    const rec = mesh.chunks.get(0);
    const bodies = [...rec.bodies];
    const pads = [...rec.pads];
    const gfx = rec.gfx;
    expect(bodies.length).toBeGreaterThan(0);
    expect(pads).toHaveLength(1);
    const added = world.added.length;
    const drawsBefore = gfx.draws;
    expect(gfx.clears).toBe(1); // _takeGfx clears once

    mesh.addChunk(c, { visualOnly: true });

    expect(world.added).toHaveLength(added); // nothing re-added
    expect(world.removed).toHaveLength(0); // nothing removed
    const after = mesh.chunks.get(0);
    expect(after).toBe(rec);
    expect(after.bodies).toHaveLength(bodies.length);
    after.bodies.forEach((b, i) => expect(b).toBe(bodies[i]));
    after.pads.forEach((b, i) => expect(b).toBe(pads[i]));
    expect(after.gfx).toBe(gfx); // the same Graphics, reused
    expect(made).toHaveLength(1); // no second Graphics was taken
    expect(gfx.clears).toBe(2); // cleared and redrawn
    expect(gfx.draws).toBeGreaterThan(drawsBefore);
  });

  test('the default path still removes and re-adds the colliders (a generator biome change)', () => {
    const { scene, world } = fakeScene();
    const mesh = new TerrainMesh(scene, PAL, MODS);
    const c = chunk();
    mesh.addChunk(c);
    const first = [...mesh.chunks.get(0).bodies];
    const added = world.added.length;
    mesh.addChunk(c);
    expect(world.removed.length).toBe(first.length + 1); // bodies + the pad sensor
    expect(world.added.length).toBe(added * 2);
  });

  test('visualOnly on a chunk that is not built yet builds it normally', () => {
    const { scene, world } = fakeScene();
    const mesh = new TerrainMesh(scene, PAL, MODS);
    mesh.addChunk(chunk(3), { visualOnly: true });
    expect(mesh.chunks.get(3).bodies.length).toBeGreaterThan(0);
    expect(world.added.length).toBeGreaterThan(0);
  });
});

describe('RunScene.refreshPalette forwards visualOnly to the mesh', () => {
  function scene() {
    const calls = [];
    const s = Object.create(RunScene.prototype);
    const c = chunk(0);
    Object.assign(s, {
      game: { registry: { get: () => null } },
      content: { biomes: {}, palettes: { default: { bg: '#000000', bgAlt: '#000000', cyan: '#000000', magenta: '#000000', lime: '#000000', amber: '#000000', text: '#000000', danger: '#000000' } } },
      cameras: { main: { setBackgroundColor() {} } },
      sled: { palette: null, look: null },
      bg: { setMotif() {}, setPalette() {} },
      fx: {},
      mesh: { setPalette() {}, chunks: new Map([[0, {}]]), addChunk: (ch, o) => calls.push([ch, o]) },
      terrain: { getActiveChunks: () => [c] },
      hazards: new Map(), powerups: new Map(),
    });
    s._resolveLook = () => null;
    s._biomeDefById = () => null;
    s._lookBiomeId = () => null;
    return { s, calls, c };
  }

  test.each([[true], [false]])('refreshPalette(%s)', (flag) => {
    const { s, calls, c } = scene();
    // getPalette needs the registry content and settings
    s.game.registry.get = (k) => (k === 'content' || String(k).toLowerCase().includes('content') ? s.content : null);
    s.refreshPalette(flag);
    expect(calls).toHaveLength(1);
    expect(calls[0][0]).toBe(c);
    expect(calls[0][1]).toEqual({ visualOnly: flag });
  });

  test('no argument is the full refresh (colliders rebuilt)', () => {
    const { s, calls } = scene();
    s.game.registry.get = (k) => (String(k).toLowerCase().includes('content') ? s.content : null);
    s.refreshPalette();
    expect(calls[0][1]).toEqual({ visualOnly: false });
  });
});
