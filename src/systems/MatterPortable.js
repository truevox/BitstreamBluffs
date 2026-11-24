/**
 * Portable-math patch for Phaser's bundled matter-js (issue #121).
 *
 * Phaser 3.90.0 ships matter-js as `Phaser.Physics.Matter.Matter`. Nine of its functions call the native Math.sin/cos/atan2/
 * acos/pow, whose last bit is not guaranteed to be the same in every browser engine. They sit on the authoritative path
 * (body rotation every sub-step, collision axes, and the sled's chamfered vertices at construction), so this module replaces
 * exactly those nine properties on the shared Matter module objects with line-for-line equivalents that call pmath. Matter's own
 * callers look these functions up on the module objects at call time (like installTerrainContactFix does for Collision.collides),
 * so replacing the property is enough; nothing is forked and no global Math is touched.
 *
 * The bodies below are copies of the Phaser 3.90.0 / matter-js 0.20 source (MIT) with only the Math calls swapped. They are tied to
 * that exact version: package.json pins phaser exactly and tests/determinism/matter-portable.test.js asserts Phaser.VERSION is
 * '3.90.0' and checks each function's contract against the original, so an upgrade fails loudly instead of silently diverging.
 * Idempotent. Any change to these bodies changes simulation results: bump SIM_REVISION.
 */
import pmath from './pmath.js';

export const EXPECTED_PHASER_VERSION = '3.90.0';
/** `Module.function` names replaced on the Matter object, in a stable order (also pinned by the test). */
export const PATCHED_FUNCTIONS = Object.freeze([
  'Axes.rotate', 'Vector.rotate', 'Vector.rotateAbout', 'Vector.angle', 'Vertices.rotate', 'Vertices.chamfer',
  'Bodies.polygon', 'Body.rotate', 'Composite.rotate',
]);
export const PORTABLE_FLAG = '__bbPortableMath';

/**
 * @param {object} Matter the Matter module Phaser bundles (Phaser.Physics.Matter.Matter).
 * @returns {boolean} true when installed (or already installed); false when Matter lacks the modules (logic-only test mocks).
 */
export function installPortableMatter(Matter) {
  if (!Matter || !Matter.Axes || !Matter.Vector || !Matter.Vertices || !Matter.Bodies || !Matter.Body || !Matter.Composite || !Matter.Common) return false;
  if (Matter.Vector.rotate[PORTABLE_FLAG]) return true;
  const { Axes, Vector, Vertices, Bodies, Body, Composite, Common } = Matter;
  const orig = {};
  const put = (mod, name, fn) => {
    const o = Matter[mod][name];
    orig[`${mod}.${name}`] = o;
    fn[PORTABLE_FLAG] = true;
    fn.original = o;
    Matter[mod][name] = fn;
  };

  put('Axes', 'rotate', function rotate(axes, angle) {
    if (angle === 0) return;
    const cos = pmath.cos(angle), sin = pmath.sin(angle);
    for (let i = 0; i < axes.length; i++) {
      const axis = axes[i];
      const xx = axis.x * cos - axis.y * sin;
      axis.y = axis.x * sin + axis.y * cos;
      axis.x = xx;
    }
  });

  put('Vector', 'rotate', function rotate(vector, angle, output) {
    const cos = pmath.cos(angle), sin = pmath.sin(angle);
    if (!output) output = {};
    const x = vector.x * cos - vector.y * sin;
    output.y = vector.x * sin + vector.y * cos;
    output.x = x;
    return output;
  });

  put('Vector', 'rotateAbout', function rotateAbout(vector, angle, point, output) {
    const cos = pmath.cos(angle), sin = pmath.sin(angle);
    if (!output) output = {};
    const x = point.x + ((vector.x - point.x) * cos - (vector.y - point.y) * sin);
    output.y = point.y + ((vector.x - point.x) * sin + (vector.y - point.y) * cos);
    output.x = x;
    return output;
  });

  put('Vector', 'angle', function angle(vectorA, vectorB) {
    return pmath.atan2(vectorB.y - vectorA.y, vectorB.x - vectorA.x);
  });

  put('Vertices', 'rotate', function rotate(vertices, angle, point) {
    if (angle === 0) return;
    const cos = pmath.cos(angle), sin = pmath.sin(angle), pointX = point.x, pointY = point.y, n = vertices.length;
    for (let i = 0; i < n; i++) {
      const vertex = vertices[i];
      const dx = vertex.x - pointX, dy = vertex.y - pointY;
      vertex.x = pointX + (dx * cos - dy * sin);
      vertex.y = pointY + (dx * sin + dy * cos);
    }
  });

  put('Vertices', 'chamfer', function chamfer(vertices, radius, quality, qualityMin, qualityMax) {
    if (typeof radius === 'number') radius = [radius];
    else radius = radius || [8];
    quality = (typeof quality !== 'undefined') ? quality : -1; // -1 = automatic
    qualityMin = qualityMin || 2;
    qualityMax = qualityMax || 14;
    const newVertices = [];
    for (let i = 0; i < vertices.length; i++) {
      const prevVertex = vertices[i - 1 >= 0 ? i - 1 : vertices.length - 1];
      const vertex = vertices[i];
      const nextVertex = vertices[(i + 1) % vertices.length];
      const currentRadius = radius[i < radius.length ? i : radius.length - 1];
      if (currentRadius === 0) { newVertices.push(vertex); continue; }
      const prevNormal = Vector.normalise({ x: vertex.y - prevVertex.y, y: prevVertex.x - vertex.x });
      const nextNormal = Vector.normalise({ x: nextVertex.y - vertex.y, y: vertex.x - nextVertex.x });
      const diagonalRadius = Math.sqrt(2 * pmath.pow(currentRadius, 2));
      const radiusVector = Vector.mult(Common.clone(prevNormal), currentRadius);
      const midNormal = Vector.normalise(Vector.mult(Vector.add(prevNormal, nextNormal), 0.5));
      const scaledVertex = Vector.sub(vertex, Vector.mult(midNormal, diagonalRadius));
      let precision = quality;
      if (quality === -1) precision = pmath.pow(currentRadius, 0.32) * 1.75; // automatic precision
      precision = Common.clamp(precision, qualityMin, qualityMax);
      if (precision % 2 === 1) precision += 1; // an even value is more likely to reduce axes by symmetry
      const alpha = pmath.acos(Vector.dot(prevNormal, nextNormal));
      const theta = alpha / precision;
      for (let j = 0; j < precision; j++) newVertices.push(Vector.add(Vector.rotate(radiusVector, theta * j), scaledVertex));
    }
    return newVertices;
  });

  put('Bodies', 'polygon', function polygon(x, y, sides, radius, options) {
    options = options || {};
    if (sides < 3) return Bodies.circle(x, y, radius, options);
    const theta = 2 * Math.PI / sides;
    let path = '';
    const offset = theta * 0.5;
    for (let i = 0; i < sides; i += 1) {
      const angle = offset + (i * theta);
      const xx = pmath.cos(angle) * radius;
      const yy = pmath.sin(angle) * radius;
      path += 'L ' + xx.toFixed(3) + ' ' + yy.toFixed(3) + ' ';
    }
    const poly = { label: 'Polygon Body', position: { x, y }, vertices: Vertices.fromPath(path) };
    if (options.chamfer) {
      const chamferOpt = options.chamfer;
      poly.vertices = Vertices.chamfer(poly.vertices, chamferOpt.radius, chamferOpt.quality, chamferOpt.qualityMin, chamferOpt.qualityMax);
      delete options.chamfer;
    }
    return Body.create(Common.extend({}, poly, options));
  });

  put('Body', 'rotate', function rotate(body, rotation, point, updateVelocity) {
    if (!point) {
      Body.setAngle(body, body.angle + rotation, updateVelocity);
    } else {
      const cos = pmath.cos(rotation), sin = pmath.sin(rotation);
      const dx = body.position.x - point.x, dy = body.position.y - point.y;
      Body.setPosition(body, { x: point.x + (dx * cos - dy * sin), y: point.y + (dx * sin + dy * cos) }, updateVelocity);
      Body.setAngle(body, body.angle + rotation, updateVelocity);
    }
  });

  put('Composite', 'rotate', function rotate(composite, rotation, point, recursive) {
    const cos = pmath.cos(rotation), sin = pmath.sin(rotation);
    const bodies = recursive ? Composite.allBodies(composite) : composite.bodies;
    for (let i = 0; i < bodies.length; i++) {
      const body = bodies[i];
      const dx = body.position.x - point.x, dy = body.position.y - point.y;
      Body.setPosition(body, { x: point.x + (dx * cos - dy * sin), y: point.y + (dx * sin + dy * cos) });
      Body.rotate(body, rotation);
    }
    return composite;
  });

  Matter[PORTABLE_FLAG] = orig;
  return true;
}

/** Test helper: the original (native-Math) functions captured at install time, or null before install. */
export function originalMatterFunctions(Matter) { return (Matter && Matter[PORTABLE_FLAG]) || null; }
