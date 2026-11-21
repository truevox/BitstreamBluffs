// Spec 6.8: every own enumerable property of Sled, ScoreManager, TrickTracker, BsodPursuit, BsodBluffTracker, Hazard, a
// Kodiak bear and the RunScene field list is either covered by a schema field (FIELD_SOURCES) or in NON_CAUSAL with a
// reason, checked against REAL instances (real Matter bodies, real RunScene.create) and against the source text. Each
// FIELD_SOURCES claim is then PROVEN: perturbing the real property must change exactly the owning subsystem's digest.
import fs from 'node:fs';
import { jest } from '@jest/globals';

const { installPhaserStub, createRun, stepRun } = await import('./headlessRun.js');
installPhaserStub(jest);
const { RunScene } = await import('../../src/scenes/RunScene.js');
const { Hazard } = await import('../../src/entities/Hazard.js');
const { ScoreManager } = await import('../../src/systems/ScoreManager.js');
const { TrickTracker } = await import('../../src/systems/TrickTracker.js');
const { BsodPursuit } = await import('../../src/systems/BsodPursuit.js');
const { BsodBluffTracker } = await import('../../src/systems/BsodBluffTracker.js');
const { spawnKodiakPack, kodiakEncounter, stepKodiak } = await import('../../src/systems/Kodiaks.js');
const { REG } = await import('../../src/constants.js');
const { captureCausalState } = await import('../../src/systems/replay/fingerprintCapture.js');
const { fingerprintState, FP_SUBSYSTEMS } = await import('../../src/systems/replay/fingerprint.js');
const { FP_SCHEMAS, FIELD_SOURCES, NON_CAUSAL, OWNER_SOURCES } = await import('../../src/systems/replay/fingerprintSchemas.js');

const read = (p) => fs.readFileSync(p, 'utf8');
const fpOf = (scene) => fingerprintState(captureCausalState(scene, { chunkMemo: false }));

/** `this.X = ...` / `this.X += ...` property names in a source file. */
const thisProps = (src) => new Set([...src.matchAll(/\bthis\.([A-Za-z_$][\w$]*)\s*(?:=(?!=)|\+=|-=|\*=|\|\|=|\?\?=|\+\+|--)/g)].map((m) => m[1]));
/** `<var>.X = ...` property names for a given receiver variable name. */
const varProps = (src, v) => new Set([...src.matchAll(new RegExp(`\\b${v}\\.([A-Za-z_$][\\w$]*)\\s*(?:=(?!=)|\\+=|\\+\\+)`, 'g'))].map((m) => m[1]));

let scene;
let hazard;
let bear;

beforeAll(() => {
  scene = createRun(RunScene, REG, { seed: 'RPLAY118', level: 6 });
  stepRun(scene, 240, () => ({ push: true, tilt: 0, variableHop: true, noAutoNudge: true, pressed: {} }));
  const def = scene.content.hazards.packetSpike || Object.values(scene.content.hazards)[0];
  hazard = new Hazard(scene, def, { x: 5000, y: 400, rotationDeg: 0, phase: 0.25 }, scene.palette);
  hazard.simStepped = true; hazard.lip = null; hazard.nearMissed = false; hazard._side = -1; hazard.warned = false;
  scene.hazards.set(9999, [hazard]);
  const enc = kodiakEncounter(scene.seed, 0, 'same');
  const pack = spawnKodiakPack(scene.seed, { ...enc, kind: 'kernelPanic', members: ['kernelPanic'] }, { x: scene.sled.x, vx: scene.sled.vx });
  bear = pack[0];
  for (let i = 0; i < 400 && bear.real === undefined; i++) stepKodiak(bear, { x: bear.x - 100, vx: 200, grounded: true, landX: null, etaMs: 0 }, 8.33);
  scene.kodiaks = pack;
  scene.kodiaksOn = true;
});

function instances() {
  return {
    Sled: scene.sled, ScoreManager: scene.score, TrickTracker: scene.tricks, BsodPursuit: scene.bsod,
    BsodBluffTracker: scene.bsodBluffs, Hazard: hazard, KodiakBear: bear,
  };
}

function staticProps(cls) {
  const src = read(OWNER_SOURCES[cls]);
  const out = thisProps(src);
  if (cls === 'Hazard') for (const p of varProps(read(OWNER_SOURCES.RunScene), 'h')) out.add(p);
  if (cls === 'KodiakBear') for (const p of varProps(src, 'k')) out.add(p);
  if (cls === 'KodiakBear') for (const p of Object.keys(bear)) out.add(p);
  return out;
}

describe('every owner-class property is classified exactly once', () => {
  test('the two tables never overlap', () => {
    for (const cls of Object.keys(OWNER_SOURCES)) {
      const both = Object.keys(FIELD_SOURCES[cls]).filter((k) => k in NON_CAUSAL[cls]);
      expect([cls, both]).toEqual([cls, []]);
    }
  });

  test.each(['Sled', 'ScoreManager', 'TrickTracker', 'BsodPursuit', 'BsodBluffTracker', 'Hazard', 'KodiakBear'])(
    '%s: own properties of a real instance and of the source are all classified; no stale entries', (cls) => {
      const inst = instances()[cls];
      const names = new Set([...Object.keys(inst), ...staticProps(cls)]);
      const known = new Set([...Object.keys(FIELD_SOURCES[cls]), ...Object.keys(NON_CAUSAL[cls])]);
      expect([cls, [...names].filter((n) => !known.has(n)).sort()]).toEqual([cls, []]);
      expect([cls, [...known].filter((n) => !names.has(n)).sort()]).toEqual([cls, []]);
    });

  test('RunScene: every field the source assigns is classified; no stale entries', () => {
    const names = new Set([...thisProps(read(OWNER_SOURCES.RunScene)), ...Object.keys(scene).filter((k) => !PHASER_INJECTED.has(k))]);
    const known = new Set([...Object.keys(FIELD_SOURCES.RunScene), ...Object.keys(NON_CAUSAL.RunScene)]);
    // `sled`, `terrain`... are assigned in create(); `matter`, `add`, `registry` are Phaser-injected services (not state).
    expect(['unclassified', [...names].filter((n) => !known.has(n)).sort()]).toEqual(['unclassified', []]);
    expect(['stale', [...known].filter((n) => !names.has(n)).sort()]).toEqual(['stale', []]);
  });

  test('every NON_CAUSAL entry carries a real reason, every FIELD_SOURCES target is a real schema path', () => {
    for (const [cls, table] of Object.entries(NON_CAUSAL)) {
      for (const [k, why] of Object.entries(table)) expect([cls, k, typeof why === 'string' && why.length >= 8]).toEqual([cls, k, true]);
    }
    for (const [cls, table] of Object.entries(FIELD_SOURCES)) {
      for (const [k, target] of Object.entries(table)) {
        const [sub, ...rest] = target.split('.');
        expect([cls, k, FP_SUBSYSTEMS.includes(sub)]).toEqual([cls, k, true]);
        let node = FP_SCHEMAS[sub].schema;
        for (const seg of rest) {
          while (typeof node === 'object' && ('list' in node || 'opt' in node)) node = node.list || node.opt;
          const f = node.rec && node.rec.find(([n]) => n === seg);
          expect([cls, k, target, !!f]).toEqual([cls, k, target, true]);
          node = f[1];
        }
      }
    }
  });
});

const PHASER_INJECTED = new Set(['sys', 'registry', 'add', 'matter', 'cameras', 'scene', 'events', 'game', 'input', 'sound', 'tweens',
  'time', 'textures', 'scale', 'make', 'load', 'anims', 'plugins', 'renderFrame', 'refreshPalette', 'updateCamera', 'snapCamera', 'ghostRecorder']);

// ---- sensitivity: each claimed field really moves its subsystem digest ------------------------------------------------

/** Perturb `obj[key]`; returns a restore function. */
function perturb(obj, key, custom) {
  const orig = obj[key];
  const had = Object.prototype.hasOwnProperty.call(obj, key);
  if (custom) {
    const undo = custom(obj);
    return () => { undo(); };
  }
  let next;
  if (typeof orig === 'number') next = Number.isFinite(orig) ? orig + 1 : 0;
  else if (typeof orig === 'boolean') next = !orig;
  else if (typeof orig === 'string') next = `${orig}~`;
  else if (orig === null || orig === undefined) next = 1;
  else throw new Error(`no default perturbation for ${key} (${typeof orig}); add a custom one`);
  obj[key] = next;
  return () => { if (had) obj[key] = orig; else delete obj[key]; };
}

const CUSTOM = {
  Sled: {
    body: (s) => { s.body.position.x += 1; return () => { s.body.position.x -= 1; }; },
    _lastPad: (s) => { const o = s._lastPad; s._lastPad = { push: true, tilt: 0.5, pressed: {} }; return () => { s._lastPad = o; }; },
  },
  ScoreManager: {
    bonusCounts: (m) => { m.bonusCounts.shard += 1; return () => { m.bonusCounts.shard -= 1; }; },
    bonusByKind: (m) => { m.bonusByKind.nearMiss += 1; return () => { m.bonusByKind.nearMiss -= 1; }; },
    comboTricks: (m) => { m.comboTricks.push('zz'); return () => { m.comboTricks.pop(); }; },
    paid: (m) => { m.paid.zz = 1; return () => { delete m.paid.zz; }; },
    counts: (m) => { m.counts.zz = 1; return () => { delete m.counts.zz; }; },
  },
  Hazard: {
    roll: (h) => { const o = h.roll; h.roll = { ...o, simV: o.simV + 1 }; return () => { h.roll = o; }; },
  },
  KodiakBear: {
    rng: (k) => { k.rng.state ^= 1; return () => { k.rng.state ^= 1; }; },
  },
};

describe('each FIELD_SOURCES claim is proven by perturbing the real property', () => {
  const cases = [];
  for (const cls of ['Sled', 'ScoreManager', 'TrickTracker', 'BsodPursuit', 'BsodBluffTracker', 'Hazard', 'KodiakBear']) {
    for (const [prop, target] of Object.entries(FIELD_SOURCES[cls])) cases.push([cls, prop, target.split('.')[0]]);
  }
  test.each(cases)('%s.%s moves only subsystem "%s"', (cls, prop, sub) => {
    const inst = instances()[cls];
    const base = fpOf(scene);
    const restore = perturb(inst, prop, CUSTOM[cls] && CUSTOM[cls][prop]);
    let moved;
    try { moved = fpOf(scene); } finally { restore(); }
    expect(fpOf(scene).combined).toBe(base.combined); // restore is exact
    const changed = FP_SUBSYSTEMS.filter((n) => moved.subsystems[n] !== base.subsystems[n]);
    expect([cls, prop, changed]).toEqual([cls, prop, [sub]]);
  });
});

const SCENE_CUSTOM = {
  simClock: (s) => { s.simClock.tick += 1; return () => { s.simClock.tick -= 1; }; },
  runRandom: (s) => { s.runRandom.physicsScramble.state ^= 1; return () => { s.runRandom.physicsScramble.state ^= 1; }; },
  terrain: (s) => { s.terrain.seedState += 1; return () => { s.terrain.seedState -= 1; }; },
  mesh: (s) => { s.mesh.chunks.set(99999, {}); return () => { s.mesh.chunks.delete(99999); }; },
  _chunkQueue: (s) => { s._chunkQueue.set(99999, {}); return () => { s._chunkQueue.delete(99999); }; },
  hazards: (s) => { s.hazards.set(88888, []); return () => { s.hazards.delete(88888); }; },
  collectedPowerups: (s) => { s.collectedPowerups.add('zz'); return () => { s.collectedPowerups.delete('zz'); }; },
  shardField: (s) => { s.shardField.collected.add('zz'); return () => { s.shardField.collected.delete('zz'); }; },
  activeZones: (s) => { s.activeZones.set('zz:0', {}); return () => { s.activeZones.delete('zz:0'); }; },
  shieldSources: (s) => { s.shieldSources.push('zz'); return () => { s.shieldSources.pop(); }; },
  wards: (s) => { s.wards.wards.push({ id: 'zz', msLeft: 1, mods: [], hazards: [], effects: [], speedFactor: 1 }); return () => { s.wards.wards.pop(); }; },
  magnetEff: (s) => { const o = s.magnetEff; s.magnetEff = { pullRadiusPx: 5 }; return () => { s.magnetEff = o; }; },
  pendingCrash: (s) => { const o = s.pendingCrash; s.pendingCrash = { cause: 'zz' }; return () => { s.pendingCrash = o; }; },
  safeSamples: (s) => { s.safeSamples.push({ t: 1, x: 1, y: 1, vx: 1, vy: 1, ang: 1 }); return () => { s.safeSamples.pop(); }; },
  trickCounts: (s) => { s.trickCounts.zz = 1; return () => { delete s.trickCounts.zz; }; },
  kodiaks: (s) => { s.kodiaks.push({ ...s.kodiaks[0], n: 7 }); return () => { s.kodiaks.pop(); }; },
};
// Objects whose fields are proven in the class tests above (sled, score, tricks, bsod, bsodBluffs).
const COVERED_ABOVE = new Set(['sled', 'score', 'tricks', 'bsod', 'bsodBluffs']);

describe('RunScene field list: each claimed field moves its subsystem', () => {
  const cases = Object.entries(FIELD_SOURCES.RunScene).filter(([k]) => !COVERED_ABOVE.has(k)).map(([k, t]) => [k, t.split('.')[0]]);
  test.each(cases)('scene.%s moves only subsystem "%s"', (prop, sub) => {
    const base = fpOf(scene);
    const restore = perturb(scene, prop, SCENE_CUSTOM[prop]);
    let moved;
    try { moved = fpOf(scene); } finally { restore(); }
    expect(fpOf(scene).combined).toBe(base.combined);
    const changed = FP_SUBSYSTEMS.filter((n) => moved.subsystems[n] !== base.subsystems[n]);
    expect([prop, changed]).toEqual([prop, [sub]]);
  });

  test('NON_CAUSAL properties that are plain numbers/booleans on the real scene do not move any digest', () => {
    const base = fpOf(scene);
    const skip = new Set(['_hudMs', 'startedAt']);
    let checked = 0;
    for (const k of Object.keys(NON_CAUSAL.RunScene)) {
      if (skip.has(k) || !(k in scene) || !['number', 'boolean'].includes(typeof scene[k])) continue;
      const restore = perturb(scene, k);
      try { expect([k, fpOf(scene).combined]).toEqual([k, base.combined]); } finally { restore(); }
      checked++;
    }
    expect(checked).toBeGreaterThan(5);
  });

  test('NON_CAUSAL Sled / Hazard properties do not move any digest', () => {
    const base = fpOf(scene);
    for (const [obj, cls] of [[scene.sled, 'Sled'], [hazard, 'Hazard']]) {
      for (const k of Object.keys(NON_CAUSAL[cls])) {
        if (!['number', 'boolean'].includes(typeof obj[k])) continue;
        const restore = perturb(obj, k);
        try { expect([cls, k, fpOf(scene).combined]).toEqual([cls, k, base.combined]); } finally { restore(); }
      }
    }
  });
});
