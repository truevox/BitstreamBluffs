// Headless harness for the REAL RunScene under Jest (jsdom): real Matter 0.20 (the build Phaser bundles), real RunScene,
// Sled, TerrainGenerator, TerrainMesh, Hazard, Kodiaks, ScoreManager, BSOD, GhostRecorder. Only the rendering/scene-graph
// layer of Phaser is replaced by inert stubs (a chainable no-op game object), because Phaser itself cannot boot headless
// in jsdom (no Image decoding, no WebGL/Canvas): see the integration status in the PR report.
//
// Usage (in a test file, before importing RunScene):
//   const { installPhaserStub, makeContent, createRun, stepRun } = await import('./headlessRun.js')   // this file
//   installPhaserStub(jest);
//   const { RunScene } = await import('../../src/scenes/RunScene.js');
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);

/** A chainable inert game object: any method returns itself, reads of unknown props return a no-op function. */
export function inert() {
  const fn = function () { return proxy; };
  const proxy = new Proxy(fn, {
    get(_t, prop) {
      if (prop === 'then') return undefined; // never look like a thenable
      if (prop === Symbol.toPrimitive) return () => 0;
      if (prop === 'length') return 0;
      return proxy;
    },
    set() { return true; },
    apply() { return proxy; },
    construct() { return proxy; },
  });
  return proxy;
}

class FakeEmitter {
  constructor() { this._h = {}; }
  on(e, fn) { (this._h[e] ||= []).push(fn); return this; }
  once(e, fn) { return this.on(e, fn); }
  off(e, fn) { this._h[e] = (this._h[e] || []).filter((f) => f !== fn); return this; }
  emit(e, ...a) { for (const f of (this._h[e] || []).slice()) f(...a); return true; }
}

/** Phaser.Physics.Matter.World stand-in over a real Matter engine, driven manually exactly like the game does. */
class FakeMatterWorld extends FakeEmitter {
  constructor(Matter) {
    super();
    this.Matter = Matter;
    this.engine = Matter.Engine.create();
    this.localWorld = this.engine.world;
    this.autoUpdate = false;
    Matter.Events.on(this.engine, 'collisionStart', (e) => this.emit('collisionstart', e));
    Matter.Events.on(this.engine, 'collisionActive', (e) => this.emit('collisionactive', e));
  }
  add(b) { this.Matter.Composite.add(this.localWorld, b); return b; }
  remove(b) { this.Matter.Composite.remove(this.localWorld, b, true); return b; }
  step(delta) { this.Matter.Engine.update(this.engine, delta); }
}

export const loadMatter = () => require('phaser/src/physics/matter-js/CustomMain.js');

/** Register the `phaser` module mock (call before importing any game module). */
export function installPhaserStub(jest) {
  const Matter = loadMatter();
  const Scene = class {
    constructor(key) { this.sys = { settings: { key }, isActive: () => true }; }
  };
  const GameObjects = new Proxy({}, { get: () => class { } });
  const Phaser = {
    Scene,
    GameObjects,
    Physics: { Matter: { Matter } },
    Renderer: { WebGL: { Pipelines: { PostFXPipeline: class { } } } },
    BlendModes: { ADD: 1, NORMAL: 0, MULTIPLY: 2, SCREEN: 3 },
    Scenes: { Events: { UPDATE: 'update', SHUTDOWN: 'shutdown', DESTROY: 'destroy' } },
    Math: { Between: (a) => a, Clamp: (v, a, b) => Math.min(b, Math.max(a, v)) },
    Display: { Color: { HexStringToColor: () => ({ color: 0 }), IntegerToColor: () => ({ rgba: '' }) } },
    Geom: new Proxy({}, { get: () => class { } }),
  };
  jest.unstable_mockModule('phaser', () => ({ default: Phaser }));
  jest.unstable_mockModule('../../src/shaders/GlitchPipeline.js', () => ({ GlitchPipeline: { install() { } } }));
  return { Phaser, Matter };
}

const DATA = path.resolve('src/data');
const readDir = (d) => fs.readdirSync(path.join(DATA, d)).filter((f) => f.endsWith('.json'))
  .map((f) => JSON.parse(fs.readFileSync(path.join(DATA, d, f), 'utf8')));
const byId = (arr) => Object.fromEntries(arr.map((d) => [d.id, d]));

/** The real content tables (what src/data/index.js loads with Vite's glob). */
export function makeContent() {
  return {
    chunks: readDir('chunks'), hazards: byId(readDir('hazards')), powerups: byId(readDir('powerups')),
    terrainMods: byId(readDir('terrainMods')), biomes: byId(readDir('biomes')),
    palettes: JSON.parse(fs.readFileSync(path.join(DATA, 'palettes.json'), 'utf8')),
  };
}

const PALETTE = new Proxy({}, { get: (_t, k) => (typeof k === 'string' ? 0x123456 : undefined) });

/**
 * Build a RunScene exactly as Phaser would hand it to `create()`, with stubbed scene services, and run the REAL create().
 * @param {Function} RunScene the class
 * @param {object} REG registry keys (src/events.js)
 * @param {{seed?:string, level?:number, kodiaks?:boolean, biomeMask?:number, profile?:object, record?:boolean}} o
 */
export function createRun(RunScene, REG, o = {}) {
  const content = makeContent();
  const world = new FakeMatterWorld(loadMatter());
  const reg = new Map();
  const profile = { level: o.level ?? 1, ...(o.profile || {}) };
  reg.set(REG.CONTENT, content);
  reg.set(REG.SEED, o.seed ?? 'RPLAY118');
  reg.set(REG.PROFILE, profile);
  reg.set(REG.SETTINGS, o.settings || {});
  if (o.biomeMask) reg.set(REG.BIOME_MASK, o.biomeMask);
  const registry = {
    get: (k) => reg.get(k), set: (k, v) => { reg.set(k, v); return registry; }, remove: (k) => { reg.delete(k); },
  };
  const scene = new RunScene();
  const events = new FakeEmitter();
  Object.assign(scene, {
    registry,
    add: new Proxy({}, { get: () => () => inert() }),
    matter: { world },
    cameras: { main: inert() },
    scene: { stop() { }, launch() { }, get: () => null, start() { }, pause() { }, resume() { }, isActive: () => true },
    events,
    game: { registry, events: new FakeEmitter(), canvas: inert(), config: {}, renderer: inert() },
    input: inert(), sound: inert(), tweens: inert(), time: inert(), textures: inert(), scale: inert(), sys: { isActive: () => true, settings: {} },
    make: inert(), load: inert(), anims: inert(), plugins: inert(),
  });
  // By default the REAL renderFrame / refreshPalette / camera code runs against inert scene-graph objects: they write sim-adjacent
  // state (Sled.shield in renderFrame, collider rebuilds in refreshPalette) that a stub would hide (review of #165, B1/S1).
  if (o.stubRender) {
    scene.renderFrame = () => { };
    scene.refreshPalette = () => { };
    scene.updateCamera = () => { };
    scene.snapCamera = () => { };
  }
  Object.defineProperty(scene, '_palette_stub', { value: PALETTE });
  scene.create();
  return scene;
}

/** Advance the REAL update() by `ticks` simulation ticks at one tick per display frame (120 Hz). */
export function stepRun(scene, ticks, padAt) {
  const tickMs = scene.simClock.tickMs;
  for (let i = 0; i < ticks; i++) {
    if (scene.crashed) break;
    if (padAt) scene.inputRouter = { poll: () => padAt(scene.simClock.tick + 1), setEnabled() { } };
    scene.update(0, tickMs);
  }
}
