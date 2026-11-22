/**
 * Issue #119 (owner-approved, physics-identity-breaking): terrain colliders must be a pure function of the chunk's
 * points, never of construction history. Before this change TerrainMesh recycled pooled bodies through
 * Body.setVertices + Body.setPosition, so a collider's vertex bits depended on the previous position of the recycled
 * body (docs/determinism/savestate-feasibility.md, finding 3), which made exact savestates, seeks and any verifier
 * that rebuilds terrain carry or replay the pool history.
 */
import { jest } from '@jest/globals';

const { installPhaserStub, inert } = await import('../replay/headlessRun.js');
const { Matter } = installPhaserStub(jest);
const { TerrainMesh } = await import('../../src/entities/TerrainMesh.js');

function makeMesh() {
  const engine = Matter.Engine.create();
  const world = {
    add(b) { Matter.Composite.add(engine.world, b); return b; },
    remove(b) { Matter.Composite.remove(engine.world, b, true); return b; },
  };
  const scene = { matter: { world }, add: { graphics: () => inert() } };
  const palette = new Proxy({}, { get: () => 0xffffff });
  return { mesh: new TerrainMesh(scene, palette, {}), engine };
}

/** A chunk of 16 px segments on an irrational-ish profile, so vertex arithmetic rounds. */
function chunk(index, x0, n = 40, phase = 0) {
  const points = [];
  for (let i = 0; i <= n; i++) {
    const x = x0 + i * 16;
    points.push({ x, y: 300 + 0.31 * x + 17.3 * Math.sin(x / 61.7 + phase) + 5.1 * Math.sin(x / 13.9) });
  }
  // one bounce pad per chunk, so the pad sensor path is covered too
  return { index, points, startX: x0, endX: x0 + n * 16, gaps: [], zones: [], bouncePads: [{ x: x0 + 200.5, y: points[12].y, width: 40, boost: 520 }] };
}

/** Every geometry bit of a chunk's colliders, as exact doubles. */
function bodyBits(b) {
  return {
    label: b.label,
    isSensor: b.isSensor,
    collisionFilter: { ...b.collisionFilter },
    slop: b.slop,
    restitution: b.restitution,
    position: [b.position.x, b.position.y],
    vertices: b.vertices.map((v) => [v.x, v.y]),
    axes: b.axes.map((a) => [a.x, a.y]),
    bounds: [b.bounds.min.x, b.bounds.min.y, b.bounds.max.x, b.bounds.max.y],
    angle: b.angle,
    isStatic: b.isStatic,
    friction: b.friction,
    frictionStatic: b.frictionStatic,
    bbPad: b.bbPad ? { ...b.bbPad } : null,
  };
}
function geometry(mesh, index) {
  const rec = mesh.chunks.get(index);
  return { bodies: rec.bodies.map(bodyBits), pads: rec.pads.map(bodyBits) };
}

describe('terrain colliders are canonical (history-independent)', () => {
  test('the same chunk built fresh and built after other chunks were dropped is bit-identical', () => {
    const fresh = makeMesh();
    fresh.mesh.addChunk(chunk(5, -200));
    const want = geometry(fresh.mesh, 5);

    // A long history first: several chunks elsewhere, built and dropped (the pool path, if any).
    const used = makeMesh();
    for (let i = 0; i < 4; i++) { used.mesh.addChunk(chunk(i, 3000 + 1000 * i + 37.25, 40, i)); }
    for (let i = 0; i < 4; i++) used.mesh.removeChunk(i);
    used.mesh.addChunk(chunk(5, -200));
    const got = geometry(used.mesh, 5);

    expect(got.bodies.length).toBe(want.bodies.length);
    expect(got.pads.length).toBe(1);
    const differing = got.bodies.filter((g, i) => JSON.stringify(g) !== JSON.stringify(want.bodies[i])).length;
    expect({ differing, of: want.bodies.length }).toEqual({ differing: 0, of: want.bodies.length });
    expect(got.pads).toEqual(want.pads);
  });

  test('dropping chunks removes every collider and pad from the world and retains none on the mesh', () => {
    const { mesh, engine } = makeMesh();
    const baseline = engine.world.bodies.length;
    const removed = new Set();
    for (let i = 0; i < 6; i++) mesh.addChunk(chunk(i, 700 * i));
    for (let i = 0; i < 6; i++) { const rec = mesh.chunks.get(i); for (const b of [...rec.bodies, ...rec.pads]) removed.add(b); }
    for (let i = 0; i < 6; i++) mesh.removeChunk(i);
    expect(engine.world.bodies.length).toBe(baseline);
    expect(mesh.chunks.size).toBe(0);
    // No removed body may be held anywhere on the mesh (a pool by any name).
    const retained = [];
    const seen = new Set();
    const walk = (v, path, depth) => {
      if (!v || typeof v !== 'object' || seen.has(v) || depth > 4) return;
      seen.add(v);
      if (removed.has(v)) { retained.push(path); return; }
      for (const k of Object.keys(v)) if (k !== 'scene' && k !== 'world') walk(v[k], `${path}.${k}`, depth + 1);
    };
    walk(mesh, 'mesh', 0);
    expect(retained).toEqual([]);
  });

  test('a rebuilt chunk gets new bodies in insertion order with increasing ids (no reuse)', () => {
    const { mesh } = makeMesh();
    mesh.addChunk(chunk(1, 0));
    const first = mesh.chunks.get(1).bodies.slice();
    mesh.removeChunk(1);
    mesh.addChunk(chunk(1, 0));
    const second = mesh.chunks.get(1).bodies;
    expect(second.some((b) => first.includes(b))).toBe(false);
    const ids = second.map((b) => b.id);
    expect(ids.every((id, i) => i === 0 || id > ids[i - 1])).toBe(true);
    expect(Math.min(...ids)).toBeGreaterThan(Math.max(...first.map((b) => b.id)));
  });
});
