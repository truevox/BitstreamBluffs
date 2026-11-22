#!/usr/bin/env node
/**
 * EXPERIMENTAL / NON-PRODUCTION (issue #119 Phase 1). Pure-Matter savestate equivalence experiment.
 *
 *   node tools/savestate-experiment/matter-node-experiment.mjs [--json]
 *
 * Uses the exact Matter build the game ships (Phaser 3.90's bundled Matter 0.20.0) with the game's own
 * installTerrainContactFix, its iteration counts, gravity and 120 Hz tick of two 4.1667 ms sub-steps.
 *
 * Fixture "contact-heavy": a sled-shaped compound body (the real Sled part geometry) plus a pile of 24 dynamic
 * boxes/circles on a bumpy chain of 16 px static terrain quads; a deterministic input tape pushes and tilts the sled.
 *
 * For every restore level (see matter-snapshot-kit.js) and fresh-world history variant:
 *   A: run ticks 1..N uninterrupted, capture a snapshot after tick K (round-tripped through JSON).
 *   B: build a FRESH engine, restore the snapshot, replay the identical input suffix K+1..N.
 *   Compare the diagnostic per-tick digest (exact doubles) and report the first divergent tick.
 *
 * Fresh-world history variants (what a restore into a new scene really faces):
 *   same      bodies created in the same order: ids match by construction.
 *   shuffled  37 ids consumed first and terrain created right-to-left: relative id order differs.
 *   pooled    like shuffled, and terrain quads come from a recycled body (setVertices/setPosition), the way
 *             TerrainMesh._takeBody reuses pooled colliders, so static vertex bits may differ.
 */
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const require = createRequire(import.meta.url);

export async function loadDeps() {
  const Matter = require(path.join(root, 'node_modules/phaser/src/physics/matter-js/CustomMain.js'));
  const { installTerrainContactFix } = await import(pathToFileURL(path.join(root, 'src/systems/TerrainContact.js')).href);
  const { createMatterSnapshotKit } = await import(pathToFileURL(path.join(here, 'matter-snapshot-kit.js')).href);
  installTerrainContactFix(Matter);
  return { Matter, kit: createMatterSnapshotKit(Matter) };
}

const TICK_MS = 1000 / 120;
const SUBSTEPS = 2; // stepWorld: ceil(8.333 / 8) = 2 sub-steps per tick

function terrainY(x) { return 300 + 0.25 * x + 18 * Math.sin(x / 70) + 7 * Math.sin(x / 23); }

/**
 * Build a fresh world. Keys are history-independent (label + construction slot), ids are not.
 * @param {object} Matter
 * @param {'same'|'shuffled'|'pooled'} history
 */
export function buildWorld(Matter, history = 'same') {
  const { Engine, Bodies, Body, Composite, Common, Vertices } = Matter;
  if (history !== 'same') for (let i = 0; i < 37; i++) Common.nextId();
  const engine = Engine.create({ gravity: { x: 0, y: 0.9, scale: 0.001 } });
  engine.positionIterations = 8;
  engine.velocityIterations = 6;
  const keys = new Map();
  const tag = (b, k) => { keys.set(b, k); return b; };

  const quads = [];
  for (let i = 0; i < 120; i++) {
    const x0 = -200 + i * 16, x1 = x0 + 16;
    quads.push([i, [{ x: x0, y: terrainY(x0) }, { x: x1, y: terrainY(x1) }, { x: x1, y: terrainY(x1) + 60 }, { x: x0, y: terrainY(x0) + 60 }]]);
  }
  if (history !== 'same') quads.reverse();
  const opts = { isStatic: true, label: 'terrain', friction: 1, frictionStatic: 0 };
  const terrain = [];
  for (const [i, verts] of quads) {
    let b;
    if (history === 'pooled') {
      // TerrainMesh._takeBody's recycle path: a body built for some other quad, re-shaped and moved.
      const old = quads[(i * 7) % quads.length][1];
      b = Bodies.fromVertices(Vertices.centre(old).x, Vertices.centre(old).y, [old], { ...opts }, false);
      Body.setStatic(b, false);
      Body.setVertices(b, verts);
      Body.setPosition(b, Vertices.centre(verts));
      Body.setStatic(b, true);
      b.friction = 1; b.frictionStatic = 0;
    } else {
      const c = Vertices.centre(verts);
      b = Bodies.fromVertices(c.x, c.y, [verts], { ...opts }, false);
      b.friction = 1; b.frictionStatic = 0;
    }
    terrain.push(tag(b, `terrain:${String(i).padStart(3, '0')}`));
  }

  // The real Sled part geometry (src/entities/Sled.js _buildBody).
  const sx = 40, sy = terrainY(40) - 30;
  const parts = [
    Bodies.polygon(sx - 15, sy + 7, 24, 4, { label: 'skid' }),
    Bodies.polygon(sx + 15, sy + 7, 24, 4, { label: 'skid' }),
    Bodies.rectangle(sx, sy + 3, 40, 6, { label: 'deck', chamfer: { radius: 2 } }),
    Bodies.rectangle(sx - 5, sy - 8, 9, 15, { label: 'torso', density: 0.0012, chamfer: { radius: 3 } }),
    Bodies.circle(sx - 2, sy - 21, 5, { label: 'head', density: 0.0008 }),
  ];
  const sled = tag(Body.create({ parts, label: 'sled', friction: 0.02, frictionStatic: 0, frictionAir: 0.004, restitution: 0.02, slop: 0.02 }), 'sled');

  const pile = [];
  const order = [...Array(24).keys()];
  if (history === 'permuted') order.reverse();
  for (const i of order) {
    const x = 260 + (i % 6) * 22, y = terrainY(x) - 40 - Math.floor(i / 6) * 24;
    const b = i % 3 === 2 ? Bodies.circle(x, y, 9, { label: 'pile', friction: 0.3 }) : Bodies.rectangle(x, y, 18, 16, { label: 'pile', friction: 0.4, chamfer: { radius: 1 } });
    pile.push(tag(b, `pile:${String(i).padStart(2, '0')}`));
  }
  const all = history === 'same' ? [...terrain, sled, ...pile] : [...pile, sled, ...terrain];
  Composite.add(engine.world, all);
  return { engine, sled, keyOf: (b) => keys.get(b) };
}

/** Deterministic input tape: push (force) and tilt (torque) per tick, plus a hop impulse at a few ticks. */
export function inputAt(tick) {
  return {
    push: (tick % 240) < 90 ? 0.0009 : 0,
    tilt: tick > 300 && tick < 420 ? -0.02 : tick > 600 && tick < 650 ? 0.03 : 0,
    hop: tick === 200 || tick === 520 || tick === 760,
  };
}

export function step(Matter, w, tick) {
  const { Body, Engine } = Matter;
  const inp = inputAt(tick);
  for (let s = 0; s < SUBSTEPS; s++) {
    const b = w.sled;
    if (inp.push) Body.applyForce(b, b.position, { x: inp.push * Math.cos(b.angle), y: inp.push * Math.sin(b.angle) });
    if (inp.tilt) b.torque += inp.tilt;
    if (inp.hop && s === 0) Body.setVelocity(b, { x: b.velocity.x, y: b.velocity.y - 3 });
    Engine.update(w.engine, TICK_MS / SUBSTEPS);
  }
}

function firstDiff(a, b) {
  const n = Math.max(a.length, b.length);
  for (let i = 0; i < n; i++) if (!Object.is(a[i], b[i])) return i;
  return -1;
}

/**
 * @returns {{level:string, history:string, firstDivergentTick:number|null, field:string|null, maxPosErr:number, endPosErr:number}}
 */
export function runCase(Matter, kit, { level, history, K = 300, N = 900, captureStatics = false, skip = [] }) {
  const { Common } = Matter;
  Common._nextId = 0;
  const A = buildWorld(Matter, 'same');
  const ref = [];
  let snap = null;
  let tsK = 0;
  const newPairs = new Set();
  for (let t = 1; t <= N; t++) {
    step(Matter, A, t);
    if (t === K) {
      snap = JSON.parse(JSON.stringify(kit.capture(A.engine, A.keyOf, captureStatics ? { selectBody: () => true } : {})));
    }
    if (t === K) tsK = A.engine.timing.timestamp;
    if (t > K) {
      ref.push(kit.digest(A.engine, A.keyOf));
      for (const pr of A.engine.pairs.list) if (pr.timeCreated >= tsK && !pr.isSensor) newPairs.add(pr.id);
    }
  }
  if (level === 'pose') {
    // GhostTape checkpoint = the sled only (pose + velocity). Everything else stays as the fresh world built it.
    snap = { ...snap, bodies: { sled: snap.bodies.sled } };
  }
  Common._nextId = 0;
  const B = buildWorld(Matter, history);
  kit.restore(B.engine, snap, B.keyOf, level, { skip });
  let first = null, field = null, maxPosErr = 0, endPosErr = 0;
  for (let t = K + 1; t <= N; t++) {
    step(Matter, B, t);
    const d = kit.digest(B.engine, B.keyOf);
    const r = ref[t - K - 1];
    const i = firstDiff(r, d);
    if (i >= 0 && first === null) { first = t; field = `${r[i - ((i - 0) % 7)] ?? ''}[${i % 7}] ref=${r[i]} got=${d[i]}`; }
    let e = 0;
    for (let j = 0; j + 6 < r.length; j += 7) if (typeof r[j] === 'string' && r[j] === d[j]) e = Math.max(e, Math.hypot(r[j + 1] - d[j + 1], r[j + 2] - d[j + 2]));
    maxPosErr = Math.max(maxPosErr, e);
    endPosErr = e;
  }
  return { level, history, captureStatics, skip: skip.join('+') || '-', newPairsAfterK: newPairs.size, K, N, firstDivergentTick: first, ticksAfterRestore: first === null ? null : first - K, field, maxPosErr: +maxPosErr.toFixed(6), endPosErr: +endPosErr.toFixed(6) };
}

export function staticGeometryDiff(Matter, history) {
  Common0(Matter);
  const A = buildWorld(Matter, 'same');
  Matter.Common._nextId = 0;
  const B = buildWorld(Matter, history);
  const idx = (w) => new Map(Matter.Composite.allBodies(w.engine.world).map((b) => [w.keyOf(b), b]));
  const ia = idx(A), ib = idx(B);
  let bodies = 0, maxErr = 0;
  for (const [k, a] of ia) {
    if (!a.isStatic) continue;
    const b = ib.get(k);
    let diff = false;
    a.vertices.forEach((v, j) => { const e = Math.max(Math.abs(v.x - b.vertices[j].x), Math.abs(v.y - b.vertices[j].y)); if (e) diff = true; maxErr = Math.max(maxErr, e); });
    if (!Object.is(a.position.x, b.position.x) || !Object.is(a.position.y, b.position.y)) diff = true;
    if (diff) bodies++;
  }
  return { history, staticBodiesWithDifferentBits: bodies, maxVertexErr: maxErr };
}
function Common0(Matter) { Matter.Common._nextId = 0; }

/** Incomplete snapshots must fail visibly: drop a body, a pair part, bump the version, add uncaptured state. */
export function incompleteChecks(Matter, kit) {
  Common0(Matter);
  const A = buildWorld(Matter, 'same');
  for (let t = 1; t <= 120; t++) step(Matter, A, t);
  const good = JSON.parse(JSON.stringify(kit.capture(A.engine, A.keyOf)));
  const cases = {
    missingBody: (s) => { delete s.ids['pile:03']; delete s.bodies['pile:03']; },
    wrongVersion: (s) => { s.version = 99; },
    unknownPairPart: (s) => { if (s.pairs[0]) s.pairs[0].a = 'ghost#0'; },
  };
  const out = {};
  for (const [name, mutate] of Object.entries(cases)) {
    const s = JSON.parse(JSON.stringify(good));
    mutate(s);
    Common0(Matter);
    const B = buildWorld(Matter, 'same');
    try { kit.restore(B.engine, s, B.keyOf, 'full'); out[name] = 'NOT DETECTED'; } catch (e) { out[name] = `threw: ${e.message.slice(0, 90)}`; }
  }
  // Live audit: state that a Matter upgrade (or game code) might add, injected into each structural object. Each
  // must show up in the capture audit, and a strict restore of that snapshot must refuse.
  const injections = {
    rootBody: [() => A.sled, 'myNewState'],
    pair: [() => A.engine.pairs.list.find((p) => !p.isSensor), 'newPairState'],
    collision: [() => A.engine.pairs.list.find((p) => !p.isSensor).collision, 'newCollisionState'],
    contact: [() => A.engine.pairs.list.find((p) => !p.isSensor).contacts[0], 'cachedBias'],
    engine: [() => A.engine, 'newSolverState'],
    timing: [() => A.engine.timing, 'newClock'],
    detector: [() => A.engine.detector, 'grid2'],
    resolverStatic: [() => Matter.Resolver, '_newWarming'],
  };
  out.liveAudit = {};
  for (const [name, [get, key]] of Object.entries(injections)) {
    const obj = get();
    obj[key] = 1;
    const snap = JSON.parse(JSON.stringify(kit.capture(A.engine, A.keyOf)));
    delete obj[key];
    Common0(Matter);
    const B = buildWorld(Matter, 'same');
    let restore;
    try { kit.restore(B.engine, snap, B.keyOf, 'full'); restore = 'NOT DETECTED'; } catch (e) { restore = 'threw'; }
    out.liveAudit[name] = { audit: snap.audit, restore };
  }
  return out;
}

async function main() {
  const { Matter, kit } = await loadDeps();
  const results = [];
  for (const history of ['same', 'shuffled', 'permuted', 'pooled']) {
    for (const level of kit.LEVELS) results.push(runCase(Matter, kit, { level, history }));
  }
  results.push(runCase(Matter, kit, { level: 'full', history: 'pooled', captureStatics: true }));
  results.push(runCase(Matter, kit, { level: 'contacts', history: 'permuted', captureStatics: true }));
  // Ablations: the exact 'full' restore minus one item, in the friendliest fresh world ('same').
  // Repeated at a second snapshot tick: some items matter only in some states (K-dependent), see the doc.
  for (const K of [300, 450]) {
    for (const s of ['impulses', 'staleSupport', 'detectorOrder', 'worldOrder', 'timing', 'positionImpulse', 'deltaTime', 'rawGeometry']) {
      results.push(runCase(Matter, kit, { level: 'full', history: 'same', skip: [s], K, N: K + 300 }));
    }
  }
  // uninterrupted repeat (A vs A): the baseline is itself deterministic
  const geo = ['shuffled', 'pooled'].map((h) => staticGeometryDiff(Matter, h));
  const inc = incompleteChecks(Matter, kit);
  if (process.argv.includes('--json')) { console.log(JSON.stringify({ results, geo, inc }, null, 2)); return; }
  console.log(`K=${results[0].K} N=${results[0].N}; non-sensor pairs created after K in the reference run: ${results[0].newPairsAfterK}`);
  console.log('K    level      history   statics  skip             firstDivTick  (+ticks)  maxPosErr(px)  endPosErr(px)  first field');
  for (const r of results) {
    console.log(`${String(r.K).padEnd(4)} ${r.level.padEnd(10)} ${r.history.padEnd(9)} ${String(r.captureStatics).padEnd(8)} ${r.skip.padEnd(16)} ${String(r.firstDivergentTick).padEnd(13)} ${String(r.ticksAfterRestore).padEnd(9)} ${String(r.maxPosErr).padEnd(14)} ${String(r.endPosErr).padEnd(14)} ${r.field || '-'}`);
  }
  console.log('static geometry vs fresh build:', JSON.stringify(geo));
  console.log('incomplete snapshot checks:', JSON.stringify(inc, null, 1));
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
