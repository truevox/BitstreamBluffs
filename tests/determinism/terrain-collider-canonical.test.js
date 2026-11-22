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
  return { index, points, startX: x0, endX: x0 + n * 16, gaps: [], zones: [], bouncePads: [] };
}

/** Every geometry bit of a chunk's colliders, as exact doubles. */
function geometry(mesh, index) {
  return mesh.chunks.get(index).bodies.map((b) => ({
    position: [b.position.x, b.position.y],
    vertices: b.vertices.map((v) => [v.x, v.y]),
    axes: b.axes.map((a) => [a.x, a.y]),
    bounds: [b.bounds.min.x, b.bounds.min.y, b.bounds.max.x, b.bounds.max.y],
    angle: b.angle,
    isStatic: b.isStatic,
    friction: b.friction,
    frictionStatic: b.frictionStatic,
  }));
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

    expect(got.length).toBe(want.length);
    const differing = got.filter((g, i) => JSON.stringify(g) !== JSON.stringify(want[i])).length;
    expect({ differing, of: want.length }).toEqual({ differing: 0, of: want.length });
  });

  test('dropping chunks does not keep removed colliders alive (no unbounded pool)', () => {
    const { mesh } = makeMesh();
    for (let i = 0; i < 6; i++) mesh.addChunk(chunk(i, 700 * i));
    for (let i = 0; i < 6; i++) mesh.removeChunk(i);
    expect(mesh._bodyPool ? mesh._bodyPool.length : 0).toBe(0);
  });
});
