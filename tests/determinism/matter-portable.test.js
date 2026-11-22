// Issue #121: the nine Matter functions replaced by MatterPortable.js. Pins Phaser exactly, checks every replaced function against the
// original (native Math) implementation, and scans Phaser's bundled Matter source so a Phaser change that adds or moves a transcendental
// call fails here instead of silently diverging across browsers.
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import Phaser from 'phaser';
import { installPortableMatter, originalMatterFunctions, PATCHED_FUNCTIONS, EXPECTED_PHASER_VERSION, PORTABLE_FLAG } from '../../src/systems/MatterPortable.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const Matter = Phaser.Physics.Matter.Matter;
// capture the pristine functions before installing (the module also records them, but compare against an independent copy)
const pristine = Object.fromEntries(PATCHED_FUNCTIONS.map((n) => { const [m, f] = n.split('.'); return [n, Matter[m][f]]; }));
installPortableMatter(Matter);
const orig = originalMatterFunctions(Matter);

const close = (a, b, tol = 1e-9) => expect(Math.abs(a - b)).toBeLessThanOrEqual(tol * Math.max(1, Math.abs(a), Math.abs(b)));
const closeVec = (a, b, tol) => { close(a.x, b.x, tol); close(a.y, b.y, tol); };

describe('Phaser pin', () => {
  test('Phaser.VERSION is exactly 3.90.0 and package.json pins it exactly', () => {
    expect(EXPECTED_PHASER_VERSION).toBe('3.90.0');
    expect(Phaser.VERSION).toBe('3.90.0');
    const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    expect(pkg.devDependencies.phaser).toBe('3.90.0'); // no ^ or ~: the patched Matter bodies are copies of this exact version
    const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));
    expect(lock.packages['node_modules/phaser'].version).toBe('3.90.0');
    expect(lock.packages[''].devDependencies.phaser).toBe('3.90.0');
  });
});

describe('source scan: every transcendental call in Phaser\'s Matter folder is covered or proven unused', () => {
  const dir = path.join(root, 'node_modules', 'phaser', 'src', 'physics', 'matter-js');
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : e.name.endsWith('.js') ? [path.join(d, e.name)] : []));
  const re = /\bMath\.(sin|cos|tan|asin|acos|atan|atan2|exp|expm1|log|log1p|log2|log10|pow|hypot|tanh|sinh|cosh|cbrt)\(/g;
  test('exact call-site counts per file across lib/, poly-decomp/, components/ and MatterPhysics.js', () => {
    const counts = {};
    for (const f of walk(dir)) { const n = (fs.readFileSync(f, 'utf8').match(re) || []).length; if (n) counts[path.relative(dir, f).replace(/\\/g, '/')] = n; }
    expect(counts).toEqual({
      // patched by MatterPortable.js (9 functions)
      'lib/body/Body.js': 2, 'lib/body/Composite.js': 2, 'lib/factory/Bodies.js': 2, 'lib/geometry/Axes.js': 2, 'lib/geometry/Vector.js': 5, 'lib/geometry/Vertices.js': 5,
      // debug drawing only
      'lib/render/Render.js': 1,
      // poly-decomp collinear() acos: only reached by Bodies.fromVertices on a CONCAVE shape; the sim only builds convex trapezoids (sim-math-boundary.test.js)
      'poly-decomp/index.js': 1,
      // Phaser's force/thrust helpers; never called by the game (sim-math-boundary.test.js scans for them)
      'components/Force.js': 8, 'MatterPhysics.js': 4,
    });
  });
});

describe('MatterPortable install', () => {
  test('replaces exactly the nine listed functions, idempotently, keeping originals', () => {
    expect(PATCHED_FUNCTIONS).toHaveLength(9);
    for (const n of PATCHED_FUNCTIONS) {
      const [m, f] = n.split('.');
      expect(Matter[m][f][PORTABLE_FLAG]).toBe(true);
      expect(Matter[m][f]).not.toBe(pristine[n]);
      expect(Matter[m][f].original).toBe(pristine[n]);
      expect(orig[n]).toBe(pristine[n]);
    }
    const before = PATCHED_FUNCTIONS.map((n) => Matter[n.split('.')[0]][n.split('.')[1]]);
    expect(installPortableMatter(Matter)).toBe(true);
    expect(PATCHED_FUNCTIONS.map((n) => Matter[n.split('.')[0]][n.split('.')[1]])).toEqual(before);
  });
  test('a Matter without the modules (logic-only mock) is left alone', () => {
    const mock = { Body: {}, Bodies: {} };
    expect(installPortableMatter(mock)).toBe(false);
    expect(mock).toEqual({ Body: {}, Bodies: {} });
  });
});

describe('contracts: patched function equals the original within last-bit differences', () => {
  const angles = [0, 1e-9, 0.1, -0.3, 0.7853981633974483, 1.5707963267948966, 2.5, -3.1, 6.5, 12.25];
  test('Vector.rotate / rotateAbout / angle', () => {
    for (const a of angles) {
      const v = { x: 12.5, y: -7.25 }, p = { x: 3, y: 4 };
      closeVec(Matter.Vector.rotate(v, a), pristine['Vector.rotate'](v, a), 1e-12);
      const out = { x: 0, y: 0 }; expect(Matter.Vector.rotate(v, a, out)).toBe(out);
      closeVec(Matter.Vector.rotateAbout(v, a, p), pristine['Vector.rotateAbout'](v, a, p), 1e-12);
    }
    close(Matter.Vector.angle({ x: 1, y: 2 }, { x: -3, y: 5 }), pristine['Vector.angle']({ x: 1, y: 2 }, { x: -3, y: 5 }), 1e-15);
    expect(Matter.Vector.angle({ x: 0, y: 0 }, { x: 0, y: 0 })).toBe(pristine['Vector.angle']({ x: 0, y: 0 }, { x: 0, y: 0 }));
  });
  test('Axes.rotate and Vertices.rotate (including the angle === 0 early return)', () => {
    for (const a of angles) {
      const mk = () => [{ x: 1, y: 0 }, { x: 0, y: 1 }, { x: -0.6, y: 0.8 }];
      const A = mk(), B = mk(); Matter.Axes.rotate(A, a); pristine['Axes.rotate'](B, a);
      A.forEach((v, i) => closeVec(v, B[i], 1e-12));
      const mv = () => [{ x: 10, y: 20 }, { x: 30, y: 20 }, { x: 30, y: 40 }, { x: 10, y: 40 }];
      const V1 = mv(), V2 = mv(); Matter.Vertices.rotate(V1, a, { x: 20, y: 30 }); pristine['Vertices.rotate'](V2, a, { x: 20, y: 30 });
      V1.forEach((v, i) => closeVec(v, V2[i], 1e-12));
    }
  });
  test('Vertices.chamfer (the sled deck and torso settings, plus explicit quality and per-vertex radii)', () => {
    const rect = (w, h) => [{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }];
    for (const [w, h, r, q] of [[40, 6, 2], [9, 15, 3], [20, 20, 5, 6], [30, 10, [4, 0, 2, 3]], [50, 50, 8]]) {
      const a = Matter.Vertices.chamfer(rect(w, h), r, q), b = pristine['Vertices.chamfer'](rect(w, h), r, q);
      expect(a).toHaveLength(b.length);
      a.forEach((v, i) => closeVec(v, b[i], 1e-9));
    }
  });
  test('Bodies.polygon / circle build the same shape (skid polygons, head circle, chamfered rectangle)', () => {
    const shapeOf = (b) => ({ n: b.vertices.length, area: b.area, pos: b.position, bounds: b.bounds, mass: b.mass });
    const same = (a, b) => { expect(a.n).toBe(b.n); close(a.area, b.area, 1e-9); closeVec(a.pos, b.pos, 1e-9); closeVec(a.bounds.min, b.bounds.min, 1e-9); closeVec(a.bounds.max, b.bounds.max, 1e-9); close(a.mass, b.mass, 1e-9); };
    const patched = shapeOf(Matter.Bodies.polygon(100, 50, 24, 4, { label: 'skid' }));
    Matter.Vertices.chamfer = pristine['Vertices.chamfer']; Matter.Bodies.polygon = pristine['Bodies.polygon'];
    const original = shapeOf(Matter.Bodies.polygon(100, 50, 24, 4, { label: 'skid' }));
    Matter.Vertices.chamfer = orig['Vertices.chamfer'] && Matter.Vertices.chamfer; // restored below
    installTestRestore();
    same(patched, original);
    const p2 = shapeOf(Matter.Bodies.rectangle(0, 3, 40, 6, { chamfer: { radius: 2 } })), c2 = shapeOf(Matter.Bodies.circle(-2, -21, 5, {}));
    expect(p2.n).toBeGreaterThan(4); expect(c2.n).toBeGreaterThanOrEqual(8);
  });
  test('Body.rotate and Composite.rotate', () => {
    const mkBody = () => Matter.Bodies.rectangle(10, 20, 8, 6, {});
    for (const a of angles) {
      const b1 = mkBody(), b2 = mkBody();
      Matter.Body.rotate(b1, a, { x: 3, y: 4 }); pristine['Body.rotate'](b2, a, { x: 3, y: 4 });
      closeVec(b1.position, b2.position, 1e-12); close(b1.angle, b2.angle, 1e-12);
      Matter.Body.rotate(b1, a); pristine['Body.rotate'](b2, a);
      close(b1.angle, b2.angle, 1e-12);
      const c1 = Matter.Composite.create(), c2 = Matter.Composite.create(), x1 = mkBody(), x2 = mkBody();
      Matter.Composite.add(c1, x1); Matter.Composite.add(c2, x2);
      Matter.Composite.rotate(c1, a, { x: 0, y: 0 }); pristine['Composite.rotate'](c2, a, { x: 0, y: 0 });
      closeVec(x1.position, x2.position, 1e-12);
    }
  });
});

// restores the patched functions after the polygon comparison swapped the originals in
function installTestRestore() {
  for (const n of PATCHED_FUNCTIONS) { const [m, f] = n.split('.'); if (!Matter[m][f][PORTABLE_FLAG]) Matter[m][f] = patchedCopies[n]; }
}
const patchedCopies = Object.fromEntries(PATCHED_FUNCTIONS.map((n) => { const [m, f] = n.split('.'); return [n, Matter[m][f]]; }));
