/**
 * Dev/test guard: RunScene.renderFrame must present the simulation, never write it (issue 1D).
 *
 * While a guarded renderFrame runs, every own enumerable data property of each live sim owner (see collectSimOwners) is swapped
 * for a temporary accessor whose setter throws RenderWriteError naming `Class.field`; the native stack points at the offending
 * line. Locking is deny-by-default: only fields named in RENDER_OWNED stay writable, so new sim fields are protected for free.
 * Nested plain objects, arrays and Matter bodies under FIELD_SOURCES fields come back as read-only deep Proxies. A post-frame
 * diff catches keys added or deleted during render (an accessor cannot see those). Descriptors are restored exactly in `finally`.
 * Compiled out of production: Vite folds `import.meta.env.DEV` to false, so RENDER_GUARD_ENABLED is a constant false there.
 */
import { FIELD_SOURCES } from './fingerprintSchemas.js';

/**
 * True under Vite dev and Jest (NODE_ENV=test); false in production builds.
 * Mechanism: Vite replaces `import.meta.env.DEV` with a literal boolean (false in production). `??` only falls through on
 * null/undefined, so production evaluates to the literal false and the minifier removes the guard body and the error class.
 * Under Jest `import.meta.env` is undefined, so `DEV` is undefined and the NODE_ENV=test fallback enables the guard.
 */
export const RENDER_GUARD_ENABLED = import.meta.env?.DEV ?? (typeof process !== 'undefined' && process.env?.NODE_ENV === 'test');

/** Thrown (at the offending write) when renderFrame mutates simulation state. */
export class RenderWriteError extends Error {
  constructor(path) {
    super(`renderFrame wrote sim state ${path} (render must not mutate the simulation)`);
    this.name = 'RenderWriteError';
    this.path = path;
  }
}

/**
 * Own properties render may write, per owner class. Each entry is presentation-only: no simulation path reads it.
 * Every entry carries a justification; do not add a field the simulation reads (move that write into the sim tick instead).
 */
export const RENDER_OWNED = Object.freeze({
  Sled: Object.freeze([
    'gfx', // Phaser Graphics object the sled draws into
    'pose', // rider drawing pose lerp, advanced by render(dt) and read only by _draw
    'squash', // landing squash decay, advanced by render(dt) and read only by _draw
    'drone', // rider shape record written by _draw
    'lastRiderShape', // rider shape record written by _draw
    'windPomAnchor', // BSOD tether anchor written by _draw
    '_time', // render-only clock (flicker / shield pulse / tether wobble) read only by _draw
  ]),
  Hazard: Object.freeze([
    '_lastDraw', // redraw throttle stamp written by draw(); stepMotion (sim) only resets it to force a redraw, nothing sim reads it
  ]),
  RunScene: Object.freeze([
    '_cameraIntent', // #155 pure, frozen presentation-only camera projection; never read by sim/telegraph logic
    '_camX', // camera follow state advanced by updateCamera; read only by camera/zoom code (snapCamera, _updateView)
    '_camY', // camera follow state advanced by updateCamera; read only by camera/zoom code
    '_zoom', // camera zoom set by updateCamera; presentation (cam.zoom)
    '_zoomKick', // landing zoom punch decayed by updateCamera; presentation
    'shakeAmp', // screen-shake amplitude decayed by updateCamera; read only there
    '_view', // visible-world rect built by _updateView (lazily created on the first frame); the sim reads it only in updateGroundTelegraph, which feeds audio cues (issue 155)
    'blackHole', // magnet black-hole visual, created lazily by renderFrame
    'kodiakRider', // kodiak rider visual, created lazily by renderFrame
  ]),
});

const PHASER_INJECTED = new Set(['sys', 'registry', 'add', 'matter', 'cameras', 'scene', 'events', 'game', 'input', 'sound',
  'tweens', 'time', 'textures', 'scale', 'make', 'load', 'anims', 'plugins']);

const GUARDED = Symbol('renderGuard');
const isPlain = (v) => { const p = Object.getPrototypeOf(v); return p === Object.prototype || p === null; };
const isNestable = (v) => v !== null && typeof v === 'object' && (Array.isArray(v) || isPlain(v) || v.type === 'body');

/** Read-only deep Proxy over sim data; cycles (body.parts[0] === body) resolve through the per-target cache. */
function readOnly(target, path, cache) {
  let p = cache.get(target);
  if (p) return p;
  const fail = (k) => { throw new RenderWriteError(`${path}.${String(k)}`); };
  p = new Proxy(target, {
    get(t, k, r) {
      const v = Reflect.get(t, k, r);
      if (!isNestable(v)) return v;
      const d = Reflect.getOwnPropertyDescriptor(t, k);
      if (d && !d.configurable && !d.writable && 'value' in d) return v; // proxy invariant: must return the exact value
      return readOnly(v, `${path}.${String(k)}`, cache);
    },
    set(t, k) { return fail(k); },
    defineProperty(t, k) { return fail(k); },
    deleteProperty(t, k) { return fail(k); },
    setPrototypeOf() { return fail('__proto__'); },
  });
  cache.set(target, p);
  return p;
}

/**
 * Every live sim owner reachable from the scene as [className, instance]. Class names are the ledger keys of
 * fingerprintSchemas.OWNER_SOURCES (the same set tests/replay/fingerprintCompleteness.test.js reflects over).
 * @returns {Array<[string, object]>}
 */
export function collectSimOwners(scene) {
  const out = [];
  const seen = new Set();
  const add = (cls, o) => { if (o && typeof o === 'object' && !seen.has(o)) { seen.add(o); out.push([cls, o]); } };
  add('RunScene', scene);
  add('Sled', scene.sled);
  add('ScoreManager', scene.score);
  add('TrickTracker', scene.tricks);
  add('BsodPursuit', scene.bsod);
  add('BsodBluffTracker', scene.bsodBluffs);
  add('HintScheduler', scene.hints);
  add('GlitchDirector', scene.glitch);
  for (const list of scene.hazards ? scene.hazards.values() : []) for (const h of list) add('Hazard', h);
  for (const list of scene.powerups ? scene.powerups.values() : []) for (const p of list) add('PowerUp', p);
  for (const k of scene.kodiaks || []) add('KodiakBear', k);
  if (scene.mesh) {
    add('TerrainMesh', scene.mesh);
    for (const rec of scene.mesh.chunks ? scene.mesh.chunks.values() : []) {
      add('MeshChunk', rec);
      for (const body of rec.pads || []) add('BouncePad', body.bbPad);
    }
  }
  if (scene.shardField) {
    add('ShardField', scene.shardField);
    for (const list of scene.shardField.byChunk ? scene.shardField.byChunk.values() : []) for (const s of list) add('Shard', s);
  }
  return out;
}

/** Lock every guarded own property of every owner; returns `{ unlock, verify }`. */
function lockOwners(scene) {
  const locks = []; // { cls, o, key, desc }
  const snaps = []; // { cls, o, keys }
  const cache = new WeakMap();
  const deleted = [];
  for (const [cls, o] of collectSimOwners(scene)) {
    const free = new Set(RENDER_OWNED[cls] || []);
    const sim = FIELD_SOURCES[cls] || {};
    const keys = new Set(Reflect.ownKeys(o));
    snaps.push({ cls, o, keys });
    for (const key of Reflect.ownKeys(o)) {
      if (typeof key !== 'string' || free.has(key) || (cls === 'RunScene' && PHASER_INJECTED.has(key))) continue;
      const desc = Object.getOwnPropertyDescriptor(o, key);
      if (!desc.enumerable || !desc.configurable || !('value' in desc) || typeof desc.value === 'function') continue;
      const path = `${cls}.${key}`;
      const value = desc.value;
      const deep = key in sim && isNestable(value);
      Object.defineProperty(o, key, {
        enumerable: true,
        configurable: true,
        get: deep ? () => readOnly(value, path, cache) : () => value,
        set() { throw new RenderWriteError(path); },
      });
      locks.push({ cls, o, key, desc });
    }
  }
  return {
    unlock() {
      for (let i = locks.length - 1; i >= 0; i--) {
        const { cls, o, key, desc } = locks[i];
        if (!Object.prototype.hasOwnProperty.call(o, key)) deleted.push(`${cls}.${key}`); // restoring re-adds it
        Object.defineProperty(o, key, desc);
      }
    },
    verify() {
      if (deleted.length) throw new RenderWriteError(`${deleted[0]} (deleted)`);
      for (const { cls, o, keys } of snaps) {
        const free = new Set(RENDER_OWNED[cls] || []);
        for (const key of Reflect.ownKeys(o)) {
          if (typeof key === 'string' && !keys.has(key) && !free.has(key) && !(cls === 'RunScene' && PHASER_INJECTED.has(key))) throw new RenderWriteError(`${cls}.${key} (added)`);
        }
        for (const key of keys) {
          if (typeof key === 'string' && !free.has(key) && !Object.prototype.hasOwnProperty.call(o, key)) throw new RenderWriteError(`${cls}.${key} (deleted)`);
        }
      }
    },
  };
}

/**
 * Wrap scene.renderFrame so sim writes throw (dev/test only; a no-op when the guard is disabled). The wrapper is a writable,
 * configurable, NON-enumerable own property so reflection over the scene's fields and test stubs keep working.
 */
export function installRenderGuard(scene) {
  if (!RENDER_GUARD_ENABLED) return;
  const inner = scene.renderFrame;
  if (typeof inner !== 'function' || inner[GUARDED]) return;
  let depth = 0;
  const guarded = function renderFrameGuarded(...args) {
    if (depth > 0) return inner.apply(this, args);
    depth++;
    const lock = lockOwners(this);
    let ok = false;
    try {
      const r = inner.apply(this, args);
      ok = true;
      return r;
    } finally {
      depth--;
      lock.unlock();
      if (ok) lock.verify();
    }
  };
  guarded[GUARDED] = true;
  Object.defineProperty(scene, 'renderFrame', { value: guarded, writable: true, configurable: true, enumerable: false });
}
