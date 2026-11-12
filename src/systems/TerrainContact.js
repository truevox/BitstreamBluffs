/**
 * OWNER: gameplay engineer. Phaser-free (takes the Matter module as an argument), so it is unit-testable with plain objects.
 *
 * Skid-vs-terrain contact normals. The terrain is a chain of 16 px wide convex quads with vertical side walls and the
 * runners are 24-sided polygons. Matter's SAT picks the axis of MINIMUM overlap, so when a runner touches a seam
 * (or just skims a quad corner) the chosen axis is often a wall axis or one of the runner polygon's own 15 degree face
 * axes instead of the ground's top-face normal. That "ghost" normal points up to 15..60 degrees away from the real
 * surface, so a sled sliding at 700+ px/s gets a spurious normal velocity of v*sin(dev) (150-600 px/s) and the solver
 * answers with an off-centre impulse at a runner 15 px from the centre of mass: +/-400..700 deg/s of spin out of nothing
 * (verified frame by frame with tools/sim --sub). Snapping the contact normal of every skid/terrain pair to the quad's own
 * top-face normal removes it and leaves everything else (gaps, walls, head and deck contacts) untouched.
 */
import { TUNING } from './PhysicsTuner.js';

const SNAP_FLAG = '__bbTerrainNormalSnap';

/**
 * Top-face unit normal (pointing up, out of the ground) of a terrain collider quad, from its vertices.
 * The top edge is the pair of lowest-y (highest on screen) vertices; colliders are extruded straight down so this holds
 * up to ~75 degree slopes.
 * @param {{vertices:{x:number,y:number}[]}} body
 * @returns {{x:number,y:number,top:number}|null} normal and the top-face plane offset along it (max projection of the quad).
 */
export function terrainTopNormal(body) {
  const v = body && body.vertices;
  if (!v || v.length < 3) return null;
  let a = null;
  let b = null;
  for (let i = 0; i < v.length; i++) {
    const p = v[i];
    if (!a || p.y < a.y) { b = a; a = p; } else if (!b || p.y < b.y) b = p;
  }
  if (!a || !b) return null;
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  if (dx < 0) { dx = -dx; dy = -dy; }
  const len = Math.hypot(dx, dy);
  if (len < 1e-6) return null;
  const nx = dy / len;
  const ny = -dx / len; // (dy,-dx): points up for a left-to-right edge
  let top = -Infinity;
  for (let i = 0; i < v.length; i++) top = Math.max(top, v[i].x * nx + v[i].y * ny);
  return { x: nx, y: ny, top };
}

/**
 * Rewrite a skid/terrain collision (in place) so its normal is the terrain quad's top-face normal.
 * Leaves the collision alone when it is not a runner-on-terrain pair, when the runner is deeper than `maxDepthPx` below the
 * top plane (a real wall: the side of a gap), or when the normal is already within `minDevDeg` of the face normal.
 * @param {object} collision Matter collision record (bodyA, bodyB are the colliding PARTS).
 * @param {{maxDepthPx?:number, minDevDeg?:number}} [opt]
 * @returns {boolean} true when the normal was replaced.
 */
export function snapTerrainNormal(collision, opt = {}) {
  const A = collision.bodyA;
  const B = collision.bodyB;
  let terrain;
  let skid;
  if (A.label === 'terrain' && B.label === 'skid') { terrain = A; skid = B; } else if (B.label === 'terrain' && A.label === 'skid') { terrain = B; skid = A; } else return false;
  const tn = terrainTopNormal(terrain);
  if (!tn) return false;
  const n = collision.normal;
  // Matter orients the collision normal so that it points from bodyB towards bodyA
  const sign = terrain === B ? 1 : -1;
  const dot = (n.x * tn.x + n.y * tn.y) * sign;
  const minDev = Math.cos(((opt.minDevDeg != null ? opt.minDevDeg : 0.5) * Math.PI) / 180);
  if (dot >= minDev) return false;
  // overlap along the face normal: quad's top plane minus the runner's lowest point along it
  let low = Infinity;
  const sv = skid.vertices;
  for (let i = 0; i < sv.length; i++) low = Math.min(low, sv[i].x * tn.x + sv[i].y * tn.y);
  const depth = tn.top - low;
  const maxDepth = opt.maxDepthPx != null ? opt.maxDepthPx : TUNING.terrainSnapMaxDepthPx;
  if (!(depth > 0) || depth > maxDepth) return false;
  n.x = tn.x * sign;
  n.y = tn.y * sign;
  collision.tangent.x = -n.y;
  collision.tangent.y = n.x;
  collision.penetration.x = n.x * depth;
  collision.penetration.y = n.y * depth;
  collision.depth = depth;
  return true;
}

/**
 * Wrap Matter.Collision.collides once (idempotent) so every runner/terrain contact is normalised by snapTerrainNormal.
 * Matter's Detector looks the function up on the module object at call time, so patching the property is enough.
 * @param {{Collision:{collides:Function}}} Matter the Matter module Phaser bundles (Phaser.Physics.Matter.Matter).
 * @returns {void}
 */
export function installTerrainContactFix(Matter) {
  const C = Matter && Matter.Collision;
  if (!C || C.collides[SNAP_FLAG]) return;
  const orig = C.collides;
  const wrapped = function collides(bodyA, bodyB, pairs) {
    const col = orig(bodyA, bodyB, pairs);
    if (col && TUNING.terrainSnapNormals) snapTerrainNormal(col);
    return col;
  };
  wrapped[SNAP_FLAG] = true;
  wrapped.original = orig;
  C.collides = wrapped;
}
