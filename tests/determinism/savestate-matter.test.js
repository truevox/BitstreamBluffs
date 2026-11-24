/**
 * Issue #119 Phase 1 (EXPERIMENTAL, non-production): pins the pure-Matter savestate findings.
 * Uses the Matter build the game ships (Phaser 3.90 / Matter 0.20.0) and the game's installTerrainContactFix.
 * Digests are diagnostic only; #152 owns canonical hashes. See docs/determinism/savestate-feasibility.md.
 */
import { loadDeps, runCase, incompleteChecks, staticGeometryDiff, buildWorld } from '../../tools/savestate-experiment/matter-node-experiment.mjs';

let Matter;
let kit;
beforeAll(async () => { ({ Matter, kit } = await loadDeps()); });

const K = 300;
const N = 700;

describe('savestate feasibility: pure Matter round trip (contact-heavy fixture)', () => {
  test('GhostTape-style checkpoint (sled pose + velocity only) diverges on the first tick after restore', () => {
    const r = runCase(Matter, kit, { level: 'pose', history: 'same', K, N });
    expect(r.firstDivergentTick).toBe(K + 1);
  });

  test('raw kinematics without the pair table (cached impulses) still diverge on the first tick', () => {
    const r = runCase(Matter, kit, { level: 'kinematic', history: 'same', K, N });
    expect(r.firstDivergentTick).toBe(K + 1);
  });

  test('full restore is bit-exact per tick even when the fresh world was built with a different id history', () => {
    for (const history of ['same', 'shuffled', 'permuted']) {
      const r = runCase(Matter, kit, { level: 'full', history, K, N });
      expect({ history, first: r.firstDivergentTick }).toEqual({ history, first: null });
    }
  });

  test('without id alignment a permuted fresh world diverges once a NEW pair forms (collision.bodyA = lower id)', () => {
    const r = runCase(Matter, kit, { level: 'contacts', history: 'permuted', K, N });
    expect(r.firstDivergentTick).toBeGreaterThan(K + 1);
  });

  test('pooled static colliders differ in the last bits; restoring static geometry closes the gap', () => {
    expect(staticGeometryDiff(Matter, 'pooled').staticBodiesWithDifferentBits).toBeGreaterThan(0);
    expect(runCase(Matter, kit, { level: 'full', history: 'pooled', K, N }).firstDivergentTick).not.toBeNull();
    expect(runCase(Matter, kit, { level: 'full', history: 'pooled', K, N, captureStatics: true }).firstDivergentTick).toBeNull();
  });

  // Items needed in EVERY tested state: removing any one breaks exactness on the first tick, at both K.
  test.each([
    [300, 'impulses'], [300, 'staleSupport'], [300, 'deltaTime'], [300, 'rawGeometry'],
    [450, 'impulses'], [450, 'staleSupport'], [450, 'deltaTime'], [450, 'rawGeometry'],
  ])('K=%i: leaving out %s breaks exactness at K+1', (k, skip) => {
    const r = runCase(Matter, kit, { level: 'full', history: 'same', K: k, N: k + 300, skip: [skip] });
    expect(r.firstDivergentTick).toBe(k + 1);
  });

  // State-dependent items: needed at K=300, not needed in the K=450 window. "Not needed in one window" is not
  // evidence of "not needed"; the doc keeps both as required.
  test.each(['timing', 'positionImpulse'])('%s is state-dependent: K+1 at K=300, exact at K=450', (skip) => {
    expect(runCase(Matter, kit, { level: 'full', history: 'same', K: 300, N: 600, skip: [skip] }).firstDivergentTick).toBe(301);
    expect(runCase(Matter, kit, { level: 'full', history: 'same', K: 450, N: 750, skip: [skip] }).firstDivergentTick).toBeNull();
  });

  test('incomplete snapshots fail visibly (set checks, version, and a live key-set audit of every Matter object)', () => {
    const out = incompleteChecks(Matter, kit);
    for (const k of ['missingBody', 'wrongVersion', 'unknownPairPart']) expect(out[k]).toMatch(/^threw: /);
    for (const [name, r] of Object.entries(out.liveAudit)) {
      expect({ name, auditEntries: r.audit.length, restore: r.restore }).toEqual({ name, auditEntries: 1, restore: 'threw' });
    }
    expect(Object.keys(out.liveAudit)).toEqual(['rootBody', 'pair', 'collision', 'contact', 'engine', 'timing', 'detector', 'resolverStatic']);
  });
});

test('diagnostic snapshot V2 captures changed gravity and rejects absent or nonfinite gravity before restore', () => {
  const a = buildWorld(Matter);
  Object.assign(a.engine.gravity, { x: 0.125, y: 0.67, scale: 0.002 });
  const snap = JSON.parse(JSON.stringify(kit.capture(a.engine, a.keyOf, {selectBody:()=>true})));
  expect(snap.gravity).toEqual({ x: 0.125, y: 0.67, scale: 0.002 });
  for (const bad of [undefined, {x:0,y:null,scale:.001}, {x:0,y:1,scale:.001,extra:0}]) {
    const b = buildWorld(Matter);
    const before = {...b.engine.gravity};
    expect(()=>kit.restore(b.engine,{...snap,gravity:bad},b.keyOf,'full')).toThrow(/gravity/);
    expect(b.engine.gravity).toEqual(before);
  }
  const b = buildWorld(Matter);
  kit.restore(b.engine,snap,b.keyOf,'full');
  expect(b.engine.gravity).toEqual(snap.gravity);
});
