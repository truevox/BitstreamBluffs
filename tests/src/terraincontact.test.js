import { terrainTopNormal, snapTerrainNormal, installTerrainContactFix } from '../../src/systems/TerrainContact.js';
import { TUNING } from '../../src/systems/PhysicsTuner.js';

const DEG = Math.PI / 180;

/** Terrain collider quad for a segment a->b extruded 64 px down (what TerrainMesh builds). */
function quad(ax, ay, bx, by) {
  return {
    label: 'terrain',
    vertices: [{ x: ax, y: ay }, { x: bx, y: by }, { x: bx, y: by + 64 }, { x: ax, y: ay + 64 }],
  };
}

/** A runner (skid) polygon: 24-gon of radius 4 centred at (cx, cy). */
function skid(cx, cy) {
  const vertices = [];
  for (let i = 0; i < 24; i++) vertices.push({ x: cx + 4 * Math.cos((i * Math.PI) / 12), y: cy + 4 * Math.sin((i * Math.PI) / 12) });
  return { label: 'skid', vertices };
}

/** Collision record like Matter's: normal points from bodyB towards bodyA. */
function collision(A, B, angleDeg, depth = 0.3) {
  const n = { x: Math.cos(angleDeg * DEG), y: Math.sin(angleDeg * DEG) };
  return {
    bodyA: A, bodyB: B, normal: { ...n }, tangent: { x: -n.y, y: n.x }, penetration: { x: n.x * depth, y: n.y * depth }, depth,
  };
}

const angleOf = (v) => Math.atan2(v.y, v.x) / DEG;

describe('terrainTopNormal', () => {
  test('flat ground: straight up', () => {
    const n = terrainTopNormal(quad(0, 100, 16, 100));
    expect(n.x).toBeCloseTo(0, 6);
    expect(n.y).toBeCloseTo(-1, 6);
    expect(n.top).toBeCloseTo(-100, 6);
  });

  test('descending-right slope tilts the normal forward, up to steep ramps', () => {
    for (const slope of [10, 37, 55]) {
      const dy = Math.tan(slope * DEG) * 16;
      const n = terrainTopNormal(quad(0, 100, 16, 100 + dy));
      expect(angleOf(n)).toBeCloseTo(-90 + slope, 4);
    }
  });

  test('independent of vertex order', () => {
    const q = quad(0, 100, 16, 106);
    q.vertices.reverse();
    expect(angleOf(terrainTopNormal(q))).toBeCloseTo(-90 + Math.atan2(6, 16) / DEG, 4);
  });

  test('degenerate input returns null', () => {
    expect(terrainTopNormal(null)).toBeNull();
    expect(terrainTopNormal({ vertices: [] })).toBeNull();
  });
});

describe('snapTerrainNormal', () => {
  const t = quad(32, 100, 48, 103); // ~10.6 degree slope
  const faceDeg = -90 + Math.atan2(3, 16) / DEG;

  test('replaces a 15 degree ghost normal (runner face axis) by the face normal, bodyA = skid (terrain is B)', () => {
    const s = skid(40, 98); // 4 px circle centred just above the surface => overlapping
    const c = collision(s, t, faceDeg + 15, 0.2);
    expect(snapTerrainNormal(c)).toBe(true);
    expect(angleOf(c.normal)).toBeCloseTo(faceDeg, 4);
    expect(c.tangent.x).toBeCloseTo(-c.normal.y, 9);
    expect(c.tangent.y).toBeCloseTo(c.normal.x, 9);
    expect(c.depth).toBeGreaterThan(0);
    expect(c.penetration.x).toBeCloseTo(c.normal.x * c.depth, 9);
  });

  test('replaces a vertical-wall ghost normal; terrain as bodyA flips the sign', () => {
    const s = skid(32.5, 98.5);
    const c = collision(t, s, 180); // wall axis, pointing from B (skid) to A (terrain)
    expect(snapTerrainNormal(c)).toBe(true);
    // normal points from bodyB (skid) to bodyA (terrain): down into the ground
    expect(angleOf(c.normal)).toBeCloseTo(faceDeg + 180, 4);
  });

  test('already-correct normals are left alone', () => {
    const s = skid(40, 98);
    const c = collision(s, t, faceDeg, 0.4);
    const before = JSON.stringify(c);
    expect(snapTerrainNormal(c)).toBe(false);
    expect(JSON.stringify(c)).toBe(before);
  });

  test('a runner far below the top plane (side of a gap) keeps its wall normal', () => {
    const s = skid(32, 130); // 30 px under the surface, i.e. touching the vertical wall
    const c = collision(s, t, 0, 3);
    expect(snapTerrainNormal(c)).toBe(false);
    expect(c.normal.x).toBe(Math.cos(0));
  });

  test('only skid-vs-terrain pairs are touched (head, deck, other bodies)', () => {
    const head = { label: 'head', vertices: skid(40, 98).vertices };
    const deck = { label: 'deck', vertices: skid(40, 98).vertices };
    expect(snapTerrainNormal(collision(head, t, 0))).toBe(false);
    expect(snapTerrainNormal(collision(deck, t, 0))).toBe(false);
    expect(snapTerrainNormal(collision(skid(0, 0), { label: 'hazard', vertices: t.vertices }, 0))).toBe(false);
  });
});

describe('installTerrainContactFix', () => {
  test('wraps Collision.collides once and snaps results when enabled', () => {
    const t = quad(32, 100, 48, 103);
    const s = skid(40, 98);
    const calls = [];
    const Matter = { Collision: { collides: (a, b) => { calls.push([a, b]); return collision(a, b, -75, 0.2); } } };
    const orig = Matter.Collision.collides;
    installTerrainContactFix(Matter);
    installTerrainContactFix(Matter); // idempotent
    expect(Matter.Collision.collides).not.toBe(orig);
    expect(Matter.Collision.collides.original).toBe(orig);
    const out = Matter.Collision.collides(s, t);
    expect(calls).toHaveLength(1);
    expect(TUNING.terrainSnapNormals).toBe(true);
    expect(angleOf(out.normal)).toBeCloseTo(-90 + Math.atan2(3, 16) / DEG, 4);
    // null passes through
    Matter.Collision.collides.original = undefined;
    const M2 = { Collision: { collides: () => null } };
    installTerrainContactFix(M2);
    expect(M2.Collision.collides(s, t)).toBeNull();
  });

  test('tolerates a missing Matter', () => {
    expect(() => installTerrainContactFix(null)).not.toThrow();
    expect(() => installTerrainContactFix({})).not.toThrow();
  });
});

describe('landing tunables', () => {
  test('sane ranges', () => {
    expect(TUNING.landSpinMaxDegS).toBeGreaterThan(0);
    // ground lean (groundTiltMul x 420 deg/s^2) must not reach the cap inside the settle window, or steering would be cut
    expect(TUNING.landSpinMaxDegS).toBeGreaterThan(0.5 * 420 * (TUNING.landSettleMs / 1000));
    expect(TUNING.landSettleMs).toBeGreaterThanOrEqual(TUNING.groundedGraceMs);
    expect(TUNING.terrainSnapMaxDepthPx).toBeGreaterThan(4); // at least a runner radius
  });
});
