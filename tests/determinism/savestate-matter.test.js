/**
 * Issue #119 Phase 1 (EXPERIMENTAL, non-production): pins the pure-Matter savestate findings.
 * Uses the Matter build the game ships (Phaser 3.90 / Matter 0.20.0) and the game's installTerrainContactFix.
 * Digests are diagnostic only; #152 owns canonical hashes. See docs/determinism/savestate-feasibility.md.
 */
import { loadDeps, runCase, incompleteChecks, staticGeometryDiff } from '../../tools/savestate-experiment/matter-node-experiment.mjs';

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

  test.each(['impulses', 'staleSupport', 'timing', 'positionImpulse', 'deltaTime', 'rawGeometry'])('leaving out %s breaks exactness', (skip) => {
    const r = runCase(Matter, kit, { level: 'full', history: 'same', K, N, skip: [skip] });
    expect(r.firstDivergentTick).toBe(K + 1);
  });

  test('incomplete snapshots fail visibly', () => {
    const out = incompleteChecks(Matter, kit);
    for (const k of ['missingBody', 'wrongVersion', 'unknownPairPart', 'uncapturedField']) expect(out[k]).toMatch(/^threw: /);
    expect(out.liveAudit).toEqual(['sled: myNewState']);
  });
});
