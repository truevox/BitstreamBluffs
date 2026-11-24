/**
 * EXPERIMENTAL / NON-PRODUCTION (issue #119, Phase 1 feasibility study).
 *
 * A diagnostic Matter.js (Phaser 3.90 bundles Matter 0.20.0) world snapshot/restore kit, used ONLY by the
 * savestate experiments in tools/savestate-experiment/ and tests/determinism/. Nothing in src/ imports it.
 * It is not a replay format, not a manifest and not a canonical hash: #152 (Team A) owns those. Any digest
 * produced here is diagnostic and non-authoritative, to be replaced by the #152 contract when published.
 *
 * Self-contained on purpose (no imports): tools/savestate-experiment/browser-experiment.mjs injects this file's
 * source into the real game page, so it must run unchanged in Node and in Chromium.
 *
 * Restore LEVELS (cumulative), matching docs/determinism/savestate-feasibility.md:
 *   'pose'       GhostTape checkpoint semantics: position, angle, velocity, angularVelocity applied through the
 *                public Body.set* API (what Sled.setPose does). Everything else is whatever the fresh world has.
 *   'kinematic'  + every raw integrator field of every dynamic/moved body, written in place: positionPrev,
 *                anglePrev (Verlet!), deltaTime (Body._timeCorrection), force/torque, positionImpulse (position
 *                warming), constraintImpulse, sleep state, and the raw part geometry (vertices, axes, part
 *                positions, bounds), which Matter integrates incrementally and is NOT a function of pose.
 *   'contacts'   + engine.pairs (table + list order, contacts with cached normal/tangent impulses and their vertex
 *                identities, collision normal/tangent/penetration/depth, BOTH support slots incl. the stale one,
 *                separation, isActive, timeCreated/timeUpdated), engine.timing and the detector's persistent
 *                sort order (detector.bodies is sorted in place every step; ties keep the previous order).
 *   'full'       + body/part id alignment (collision.bodyA is always the LOWER id, so ids decide normal sign,
 *                support search order and contact slot order of every NEW pair) and Common._nextId.
 */

/* eslint-disable no-param-reassign */

const LEVELS = ['pose', 'kinematic', 'contacts', 'full'];
const SNAPSHOT_KIND = 'bb-matter-diagnostic-snapshot';
const SNAPSHOT_VERSION = 2;

const ROOT_SCALARS = ['angle', 'anglePrev', 'angularVelocity', 'angularSpeed', 'speed', 'motion', 'sleepCounter',
  'isSleeping', 'deltaTime', 'torque', 'totalContacts', 'timeScale'];
const ROOT_VECTORS = ['position', 'positionPrev', 'velocity', 'force', 'positionImpulse'];
/** Fields the completeness audit accepts as rebuilt-by-construction (config / derived from config). */
const ROOT_CONFIG = ['id', 'type', 'label', 'parts', 'plugin', 'attractors', 'wrapBounds', 'vertices', 'axes', 'bounds',
  'isStatic', 'isSensor', 'mass', 'inverseMass', 'inertia', 'inverseInertia', 'density', 'area', 'friction',
  'frictionStatic', 'frictionAir', 'restitution', 'slop', 'collisionFilter', 'render', 'events', 'circleRadius',
  'parent', 'gameObject', 'scale', 'centerOfMass', 'centerOffset', 'chamfer', 'ignoreGravity', 'ignorePointer',
  'onCollideCallback', 'onCollideEndCallback', 'onCollideActiveCallback', 'onCollideWith', '_original',
  'sleepThreshold', 'isChamfered', 'setOnCollide', 'bbHazard', 'bbPowerUp', 'bbPad', 'constraintImpulse',
  'collisionFilterOriginal', 'hasOwnFriction', 'gravityScale'];

// Structural key-set audit (beyond root bodies): every own non-function key of these Matter objects must be
// captured or declared config/derived. A Matter upgrade that adds state to any of them fails at capture.
const KEYSETS = {
  engine: ['positionIterations', 'velocityIterations', 'constraintIterations', 'enableSleeping', 'events', 'plugin', 'gravity',
    'timing', 'autoUpdate', 'debug', 'world', 'pairs', 'detector', 'grid', 'broadphase', 'metrics'],
  timing: ['timestamp', 'timeScale', 'lastDelta', 'lastElapsed', 'lastUpdatesPerFrame'],
  world: ['id', 'type', 'parent', 'isModified', 'bodies', 'constraints', 'composites', 'label', 'plugin', 'wrapBounds', 'cache', 'gravity', 'events'],
  detector: ['bodies', 'collisions', 'pairs'],
  pairs: ['table', 'list', 'collisionStart', 'collisionActive', 'collisionEnd'],
  pair: ['id', 'bodyA', 'bodyB', 'collision', 'contacts', 'contactCount', 'separation', 'isActive', 'isSensor', 'timeCreated',
    'timeUpdated', 'inverseMass', 'friction', 'frictionStatic', 'restitution', 'slop'],
  collision: ['pair', 'collided', 'bodyA', 'bodyB', 'parentA', 'parentB', 'depth', 'normal', 'tangent', 'penetration', 'supports', 'supportCount'],
  contact: ['vertex', 'normalImpulse', 'tangentImpulse'],
};
// Module-level statics: values captured (and restored at 'contacts'+), unknown keys audited.
const MODULE_STATICS = {
  Common: ['_baseDelta', '_seed'],
  Body: ['_timeCorrection', '_inertiaScale', '_nextCollidingGroupId', '_nextNonCollidingGroupId', '_nextCategory', '_baseDelta'],
  Engine: ['_deltaMax'],
  Resolver: ['_restingThresh', '_restingThreshTangent', '_positionDampen', '_positionWarming', '_frictionNormalMultiplier', '_frictionMaxStatic'],
  Sleeping: ['_motionWakeThreshold', '_motionSleepThreshold', '_minBias'],
  Constraint: ['_warming', '_torqueDampen', '_minLength'],
  Pairs: [], Pair: [], Detector: [], Collision: [], Composite: [],
};
const MODULE_IGNORED = { Common: ['_nextId', '_nowStartTime', '_warnedOnce', '_decomp', 'logLevel'] }; // _nextId is captured separately

function unknownKeys(obj, allowed) {
  const a = new Set(allowed);
  return obj ? Object.keys(obj).filter((k) => !a.has(k) && typeof obj[k] !== 'function') : [];
}

function vec(v) { return v ? [v.x, v.y] : null; }
function setVec(t, a) { if (t && a) { t.x = a[0]; t.y = a[1]; } }

/**
 * Explicit diagnostic Matter V2 schema preflight. Validates the complete
 * body/part identity graph and raw geometry before reconstruction. Not a
 * production admission parser: no support for orphan pairs, constraints,
 * nested composites, or arbitrary third-party extensions.
 */
export function preflightMatterSnapshot(snap, Matter) {
  const fail = reason => { throw new Error('Matter preflight: '+reason); };
  const record = v => v !== null && typeof v === 'object' && !Array.isArray(v) &&
    (Object.getPrototypeOf(v) === Object.prototype || Object.getPrototypeOf(v) === null);
  const exact = (v, keys) => record(v) && Object.keys(v).length === keys.length &&
    keys.every(k => Object.hasOwn(v,k));
  const finite = v => typeof v === 'number' && Number.isFinite(v);
  const uint = v => Number.isSafeInteger(v) && v >= 0 && !Object.is(v,-0);
  const dense = v => {
    if (!Array.isArray(v) || Object.keys(v).length !== v.length) return false;
    for (let i=0;i<v.length;i++) if (!Object.hasOwn(v,i)) return false;
    return true;
  };
  const vec = (v,n) => dense(v) && v.length === n && v.every(finite);
  const unique = a => new Set(a).size === a.length;
  const keys = ['kind','version','matterVersion','diagnosticOnly','bodies','ids','nextId',
    'pairs','orphanPairs','gravity','timing','detectorOrder','worldOrder','worldModified','audit','statics'];
  if (!exact(snap,keys) || snap.kind !== SNAPSHOT_KIND || snap.version !== SNAPSHOT_VERSION ||
      snap.matterVersion !== Matter.version || snap.diagnosticOnly !== true) fail('snapshot identity/shape');
  if (!dense(snap.audit) || snap.audit.length || !dense(snap.orphanPairs) ||
      snap.orphanPairs.length) fail('incomplete or orphaned state');
  if (!record(snap.bodies) || !record(snap.ids) || !Object.keys(snap.ids).length ||
      !exact(snap.bodies,Object.keys(snap.ids)) || !uint(snap.nextId)) fail('body inventory');
  const ids = new Set(), parts = new Map(), partIdsByKey = new Map(), roots=Object.keys(snap.ids);
  for (const key of roots) {
    if (!key || key.includes('#') || ['__proto__','constructor','prototype'].includes(key)) fail('body key');
    const body=snap.bodies[key], partIds=snap.ids[key];
    if (!exact(body,['s','v','ci','parts']) || !exact(body.s,ROOT_SCALARS) ||
        !exact(body.v,ROOT_VECTORS) || !ROOT_SCALARS.every(k=>k==='isSleeping'?typeof body.s[k]==='boolean':finite(body.s[k])) ||
        !ROOT_VECTORS.every(k=>vec(body.v[k],2)) || !vec(body.ci,3) ||
        !dense(body.parts) || !dense(partIds) || !partIds.length ||
        body.parts.length!==partIds.length) fail('body state '+key);
    for (let i=0;i<partIds.length;i++) {
      const id=partIds[i], p=body.parts[i];
      if (!uint(id) || id>=snap.nextId || ids.has(id)) fail('duplicate/invalid part ID');
      ids.add(id);
      if (!exact(p,['pos','ang','verts','axes','bounds']) || !vec(p.pos,2) || !finite(p.ang) ||
          !dense(p.verts) || p.verts.length<3 || !p.verts.every(v=>vec(v,2)) ||
          !dense(p.axes) || !p.axes.length || !p.axes.every(v=>vec(v,2)) ||
          !vec(p.bounds,4) || p.bounds[0]>p.bounds[2] || p.bounds[1]>p.bounds[3]) fail('part geometry '+key);
      parts.set(key+'#'+i,p.verts.length);
      partIdsByKey.set(key+'#'+i,id);
    }
  }
  if (typeof snap.worldModified !== 'boolean' || !dense(snap.worldOrder) ||
      snap.worldOrder.length!==roots.length || !unique(snap.worldOrder) || !snap.worldOrder.every(k=>typeof k==='string'&&Object.hasOwn(snap.ids,k)) ||
      !dense(snap.detectorOrder) ||
      (snap.worldModified
        ? !snap.detectorOrder.every(k=>k===null||typeof k==='string')
        : !unique(snap.detectorOrder)||snap.detectorOrder.length!==roots.length||!snap.detectorOrder.every(k=>typeof k==='string'&&Object.hasOwn(snap.ids,k)))) fail('world/detector order');
  if (!exact(snap.gravity,['x','y','scale']) || !Object.values(snap.gravity).every(finite) ||
      !exact(snap.timing,['timestamp','timeScale','lastDelta']) || !Object.values(snap.timing).every(finite)) fail('gravity/timing');
  if ( !exact(snap.statics,Object.keys(MODULE_STATICS).filter(k=>Matter[k])) ||
      !Object.entries(snap.statics).every(([k,v])=>exact(v,MODULE_STATICS[k])&&Object.entries(v).every(([field,x])=>k==='Body'&&field==='_timeCorrection'?typeof x==='boolean':finite(x))))
    fail('module statics');
  const vertex = (r,active,pair) => {
    if (r===null) return !active;
    if (!dense(r)||r.length!==2) return false;
    if (r[0]==='<dead>') return !active&&r[1]===-1;
    if (!uint(r[1])) return false;
    return parts.has(r[0]) && r[1]<parts.get(r[0]) && (!active||r[0]===pair.a||r[0]===pair.b);
  };
  if (!dense(snap.pairs)) fail('pair list');
  const pairKeys=new Set();
  const numbers=['separation','timeCreated','timeUpdated','inverseMass','friction','frictionStatic','restitution','slop'];
  for (const p of snap.pairs) {
    if (!exact(p,['a','b','ca','cb','contacts','contactCount','isActive','isSensor','col',...numbers]) ||
        ![p.a,p.b,p.ca,p.cb].every(k=>parts.has(k)) || partIdsByKey.get(p.a)>=partIdsByKey.get(p.b) || p.ca!==p.a || p.cb!==p.b ||
        !numbers.every(k=>finite(p[k])) || typeof p.isActive!=='boolean' || typeof p.isSensor!=='boolean' ||
        !uint(p.contactCount)||!dense(p.contacts)||p.contacts.length!==2||p.contactCount>2||
        !p.contacts.every((c,i)=>dense(c)&&c.length===3&&vertex(c[0],i<p.contactCount,p)&&finite(c[1])&&finite(c[2])))
      fail('pair/contact reference');
    const key=[p.a,p.b].sort().join('|');
    if(pairKeys.has(key))fail('duplicate pair');
    pairKeys.add(key);
    const c=p.col;
    if(!exact(c,['collided','depth','normal','tangent','penetration','supportCount','supports'])||
        typeof c.collided!=='boolean'||!finite(c.depth)||!vec(c.normal,2)||!vec(c.tangent,2)||!vec(c.penetration,2)||
        !uint(c.supportCount)||c.supportCount>2||!dense(c.supports)||c.supports.length!==2||
        !c.supports.every((r,i)=>vertex(r,i<c.supportCount,p)))fail('collision support reference');
    if (p.isActive ? p.contactCount!==c.supportCount : p.contactCount!==0) fail('pair activity/contact count');
    // Pair.update compares BOTH stored contacts when deciding whether to
    // swap warm-start impulses, even with one support or a retained
    // inactive sleeping pair.
    for(let i=0;i<2;i++){
      const a=p.contacts[i][0],b=c.supports[i];
      if(a===null||b===null ? a!==b : a[0]!==b[0]||a[1]!==b[1])
        fail('contact/support mismatch');
    }
  }
  return true;
}

export function createMatterSnapshotKit(Matter) {
  const { Body, Composite, Common, Pair, Collision } = Matter;
  // Matter.Contact is not on Phaser's Matter namespace; its shape is { vertex, normalImpulse, tangentImpulse }.
  const Contact = { create: (vertex) => ({ vertex, normalImpulse: 0, tangentImpulse: 0 }) };

  /** Part key: root key + '#' + index in root.parts (index 0 is the root itself). */
  function indexWorld(engine, keyOf) {
    const roots = Composite.allBodies(engine.world);
    const byKey = new Map();
    const keyByPart = new Map();
    for (const b of roots) {
      const k = keyOf(b);
      if (k == null) throw new Error(`snapshot: body ${b.id} (${b.label}) has no stable key`);
      if (byKey.has(k)) throw new Error(`snapshot: duplicate body key ${k}`);
      byKey.set(k, b);
      b.parts.forEach((p, i) => keyByPart.set(p, `${k}#${i}`));
    }
    const partByKey = new Map();
    for (const [p, k] of keyByPart) partByKey.set(k, p);
    return { roots, byKey, keyByPart, partByKey };
  }

  function captureBody(b) {
    const o = { s: {}, v: {} };
    for (const f of ROOT_SCALARS) o.s[f] = b[f];
    for (const f of ROOT_VECTORS) o.v[f] = vec(b[f]);
    o.ci = [b.constraintImpulse.x, b.constraintImpulse.y, b.constraintImpulse.angle];
    o.parts = b.parts.map((p) => ({
      pos: vec(p.position),
      ang: p.angle,
      verts: p.vertices.map((q) => [q.x, q.y]),
      axes: p.axes.map((q) => [q.x, q.y]),
      bounds: [p.bounds.min.x, p.bounds.min.y, p.bounds.max.x, p.bounds.max.y],
    }));
    return o;
  }

  function restoreBodyRaw(b, o, skip = new Set()) {
    // Ablation 'rawGeometry': rebuild vertices/axes/bounds from pose through the public API instead of raw bits.
    if (skip.has('rawGeometry')) restoreBodyPose(b, o);
    const fresh = { positionImpulse: vec(b.positionImpulse), deltaTime: b.deltaTime, positionPrev: vec(b.positionPrev), anglePrev: b.anglePrev };
    for (const f of ROOT_SCALARS) b[f] = o.s[f];
    for (const f of ROOT_VECTORS) setVec(b[f], o.v[f]);
    if (skip.has('positionImpulse')) setVec(b.positionImpulse, fresh.positionImpulse);
    if (skip.has('deltaTime')) b.deltaTime = fresh.deltaTime;
    b.constraintImpulse.x = o.ci[0]; b.constraintImpulse.y = o.ci[1]; b.constraintImpulse.angle = o.ci[2];
    if (o.parts.length !== b.parts.length) throw new Error(`restore: part count ${b.label} ${o.parts.length} != ${b.parts.length}`);
    if (skip.has('rawGeometry')) return;
    o.parts.forEach((po, i) => {
      const p = b.parts[i];
      setVec(p.position, po.pos);
      p.angle = po.ang;
      if (po.verts.length !== p.vertices.length) throw new Error(`restore: vertex count mismatch on ${b.label}#${i}`);
      po.verts.forEach((q, j) => { p.vertices[j].x = q[0]; p.vertices[j].y = q[1]; });
      po.axes.forEach((q, j) => { p.axes[j].x = q[0]; p.axes[j].y = q[1]; });
      p.bounds.min.x = po.bounds[0]; p.bounds.min.y = po.bounds[1]; p.bounds.max.x = po.bounds[2]; p.bounds.max.y = po.bounds[3];
    });
  }

  /** GhostTape-style restore: public API only (Sled.setPose semantics). */
  function restoreBodyPose(b, o) {
    Body.setAngle(b, o.s.angle);
    Body.setPosition(b, { x: o.v.position[0], y: o.v.position[1] });
    Body.setVelocity(b, { x: o.v.velocity[0], y: o.v.velocity[1] });
    Body.setAngularVelocity(b, o.s.angularVelocity);
  }

  /**
   * Completeness audit: every own enumerable property of a root body must be captured or explicitly listed as
   * config. A Matter upgrade (or game code) that adds per-body state therefore fails loudly instead of silently
   * producing an incomplete snapshot.
   */
  function auditBody(b) {
    const covered = new Set([...ROOT_SCALARS, ...ROOT_VECTORS, ...ROOT_CONFIG]);
    const unknown = Object.keys(b).filter((k) => !covered.has(k) && typeof b[k] !== 'function');
    return unknown;
  }

  function vref(v, keyByPart) {
    if (!v) return null;
    const pk = keyByPart.get(v.body);
    // A stale slot (beyond contactCount / supportCount) may still point at a vertex of a body that has since left the
    // world. It is only ever compared by identity against current supports of THIS pair's parts, so it can never
    // match again: record it as a distinct dead reference.
    if (pk == null) return ['<dead>', -1];
    return [pk, v.index];
  }
  const DEAD = { x: NaN, y: NaN, index: -1, body: null };
  function vderef(r, partByKey) {
    if (!r) return undefined;
    if (r[0] === '<dead>') return DEAD;
    const p = partByKey.get(r[0]);
    if (!p) throw new Error(`restore: unknown part ${r[0]}`);
    return p.vertices[r[1]];
  }

  /**
   * @param {object} engine Matter engine
   * @param {(body:object)=>string} keyOf stable identity for root bodies across worlds
   * @param {{dynamicOnly?:boolean, selectBody?:(b:object)=>boolean}} [opt] which bodies get kinematic state
   */
  function capture(engine, keyOf, opt = {}) {
    const ix = indexWorld(engine, keyOf);
    const select = opt.selectBody || ((b) => !b.isStatic);
    const bodies = {};
    const ids = {};
    const audit = [];
    if (Composite.allConstraints(engine.world).length) audit.push('unsupported Matter constraints');
    if (engine.world.composites.length) audit.push('unsupported nested Matter composites');
    for (const [k, b] of ix.byKey) {
      ids[k] = b.parts.map((p) => p.id);
      if (!select(b)) continue;
      bodies[k] = captureBody(b);
      const u = auditBody(b);
      if (u.length) audit.push(`${k}: ${u.join(',')}`);
    }
    const kaudit = (label, obj, set) => { const u = unknownKeys(obj, KEYSETS[set]); if (u.length) audit.push(`${label}: ${u.join(',')}`); };
    kaudit('engine', engine, 'engine'); kaudit('engine.timing', engine.timing, 'timing'); kaudit('engine.world', engine.world, 'world');
    kaudit('engine.detector', engine.detector, 'detector'); kaudit('engine.pairs', engine.pairs, 'pairs');
    engine.pairs.list.forEach((pr, i) => {
      kaudit(`pair[${i}]`, pr, 'pair'); kaudit(`pair[${i}].collision`, pr.collision, 'collision');
      pr.contacts.forEach((c, j) => kaudit(`pair[${i}].contacts[${j}]`, c, 'contact'));
    });
    const statics = {};
    for (const [mod, keys] of Object.entries(MODULE_STATICS)) {
      const m = Matter[mod];
      if (!m) continue;
      statics[mod] = Object.fromEntries(keys.map((k) => [k, m[k]]));
      const u = unknownKeys(m, [...keys, ...(MODULE_IGNORED[mod] || [])]);
      if (u.length) audit.push(`Matter.${mod} statics: ${u.join(',')}`);
    }
    // A body removed from the world after the last Engine.update (hazard despawn, chunk drop) still has its pairs in
    // pairs.list until the next update ends them (collisionEnd only; they are never solved). Such "orphan" pairs are
    // recorded by count and dropped on restore: their only effect is a collisionEnd event (RunScene ignores it).
    const inWorld = (part) => part && ix.keyByPart.has(part);
    const orphanPairs = engine.pairs.list.filter((pr) => !inWorld(pr.bodyA) || !inWorld(pr.bodyB)).map((pr) => ({ labels: [pr.bodyA.label, pr.bodyB.label], isSensor: pr.isSensor, contactCount: pr.contactCount }));
    const pairs = engine.pairs.list.filter((pr) => inWorld(pr.bodyA) && inWorld(pr.bodyB)).map((pr) => {
      const c = pr.collision;
      return {
        a: ix.keyByPart.get(pr.bodyA), b: ix.keyByPart.get(pr.bodyB),
        ca: ix.keyByPart.get(c.bodyA), cb: ix.keyByPart.get(c.bodyB),
        contacts: pr.contacts.map((ct) => [vref(ct.vertex, ix.keyByPart), ct.normalImpulse, ct.tangentImpulse]),
        contactCount: pr.contactCount, separation: pr.separation, isActive: pr.isActive, isSensor: pr.isSensor,
        timeCreated: pr.timeCreated, timeUpdated: pr.timeUpdated, inverseMass: pr.inverseMass, friction: pr.friction,
        frictionStatic: pr.frictionStatic, restitution: pr.restitution, slop: pr.slop,
        col: {
          collided: c.collided, depth: c.depth, normal: vec(c.normal), tangent: vec(c.tangent),
          penetration: vec(c.penetration), supportCount: c.supportCount,
          supports: [vref(c.supports[0], ix.keyByPart), vref(c.supports[1], ix.keyByPart)],
        },
      };
    });
    return {
      kind: SNAPSHOT_KIND,
      version: SNAPSHOT_VERSION,
      matterVersion: Matter.version,
      diagnosticOnly: true,
      bodies,
      ids,
      nextId: Common._nextId,
      pairs,
      orphanPairs,
      gravity: { x: engine.gravity.x, y: engine.gravity.y, scale: engine.gravity.scale },
      timing: { timestamp: engine.timing.timestamp, timeScale: engine.timing.timeScale, lastDelta: engine.timing.lastDelta },
      detectorOrder: (engine.detector.bodies || []).map((b) => keyOf(b)),
      // Composite order: Engine iterates it, and Detector.setBodies copies it on every world change, so it breaks
      // bounds.min.x ties in the (stable) broadphase sort after the next add/remove.
      worldOrder: Composite.allBodies(engine.world).map((b) => keyOf(b)),
      worldModified: !!engine.world.isModified,
      audit,
      statics,
    };
  }

  /**
   * Restore `snap` into a FRESH engine whose bodies were rebuilt by the caller (same keys).
   * @param {'pose'|'kinematic'|'contacts'|'full'} level
   * @param {{strict?:boolean}} [opt] strict (default true): any missing/unknown body, audit finding, or
   *   version mismatch throws, so an incomplete snapshot fails visibly.
   */
  function restore(engine, snap, keyOf, level, opt = {}) {
    const strict = opt.strict !== false;
    if (opt.completePreflight) preflightMatterSnapshot(snap,Matter);
    // Ablations (experiment only): leave one item out to measure what it contributes.
    const skip = new Set(opt.skip || []);
    const L = LEVELS.indexOf(level);
    if (L < 0) throw new Error(`restore: unknown level ${level}`);
    if (!snap || snap.kind !== SNAPSHOT_KIND) throw new Error('restore: not a diagnostic Matter snapshot');
    if (snap.version !== SNAPSHOT_VERSION) throw new Error(`restore: snapshot version ${snap.version} != ${SNAPSHOT_VERSION}`);
    if (!snap.gravity || Object.keys(snap.gravity).length !== 3 || !['x','y','scale'].every(k => Number.isFinite(snap.gravity[k]))) throw new Error('restore: missing or invalid gravity');
    if (snap.matterVersion !== Matter.version) throw new Error(`restore: Matter ${snap.matterVersion} != ${Matter.version}`);
    if (strict && snap.audit && snap.audit.length) throw new Error(`restore: snapshot audit found uncaptured Matter state: ${snap.audit.join('; ')}`);
    let ix = indexWorld(engine, keyOf);
    if (strict) {
      const live = [...ix.byKey.keys()].sort();
      const want = Object.keys(snap.ids).sort();
      const missing = want.filter((k) => !ix.byKey.has(k));
      const extra = live.filter((k) => !(k in snap.ids));
      if (missing.length || extra.length) throw new Error(`restore: world body set differs (missing ${missing.slice(0, 5)}, extra ${extra.slice(0, 5)})`);
    }

    if (opt.completePreflight) {
      if (!strict || L !== 3 || skip.size) throw new Error('Matter preflight: full strict restore required');
      if (Composite.allConstraints(engine.world).length || engine.world.composites.length)
        throw new Error('Matter preflight: unsupported destination constraints/composites');
      // Compare the entire reconstructed topology BEFORE assigning IDs or
      // writing any body fields. Counts are not derivable from a key alone.
      for (const [k,o] of Object.entries(snap.bodies)) {
        const b=ix.byKey.get(k);
        if (!b || b.parts.length!==o.parts.length ||
            o.parts.some((p,i)=>p.verts.length!==b.parts[i].vertices.length ||
              p.axes.length!==b.parts[i].axes.length))
          throw new Error('Matter preflight: rebuilt geometry count '+k);
      }
    }
    if (L >= 3) {
      // ids first: pair table keys and collision.bodyA/bodyB ordering are derived from them.
      for (const [k, partIds] of Object.entries(snap.ids)) {
        const b = ix.byKey.get(k);
        if (!b) continue;
        b.parts.forEach((p, i) => { p.id = partIds[i]; });
      }
      Common._nextId = snap.nextId;
      if (snap.worldOrder && !skip.has('worldOrder')) {
        const pos = new Map(snap.worldOrder.map((k, i) => [k, i]));
        engine.world.bodies.sort((a, b) => (pos.get(keyOf(a)) ?? 1e9) - (pos.get(keyOf(b)) ?? 1e9));
        // Composite.allBodies() is cached on world.cache.allBodies and the engine iterates the CACHE. Drop it
        // without setting isModified (that would also reset the detector order restored below).
        if (engine.world.cache) engine.world.cache.allBodies = null;
      }
      ix = indexWorld(engine, keyOf);
    }

    for (const [k, o] of Object.entries(snap.bodies)) {
      const b = ix.byKey.get(k);
      if (!b) { if (strict) throw new Error(`restore: no live body for ${k}`); continue; }
      if (L === 0) restoreBodyPose(b, o); else restoreBodyRaw(b, o, skip);
    }

    if (L >= 2) {
      Matter.Pairs.clear(engine.pairs);
      for (const ps of snap.pairs) {
        const pa = ix.partByKey.get(ps.a), pb = ix.partByKey.get(ps.b);
        const ca = ix.partByKey.get(ps.ca), cb = ix.partByKey.get(ps.cb);
        if (!pa || !pb || !ca || !cb) { if (strict) throw new Error(`restore: pair references unknown part ${ps.a}/${ps.b}`); continue; }
        const col = Collision.create(ca, cb);
        col.collided = ps.col.collided;
        col.bodyA = ca; col.bodyB = cb; col.parentA = ca.parent; col.parentB = cb.parent;
        col.depth = ps.col.depth;
        setVec(col.normal, ps.col.normal); setVec(col.tangent, ps.col.tangent); setVec(col.penetration, ps.col.penetration);
        col.supportCount = ps.col.supportCount;
        col.supports[0] = vderef(ps.col.supports[0], ix.partByKey);
        col.supports[1] = skip.has("staleSupport") && ps.col.supportCount < 2 ? undefined : vderef(ps.col.supports[1], ix.partByKey);
        const pr = {
          id: Pair.id(pa, pb), bodyA: pa, bodyB: pb, collision: col,
          contacts: ps.contacts.map((ct) => { const c = Contact.create(vderef(ct[0], ix.partByKey)); if (!skip.has("impulses")) { c.normalImpulse = ct[1]; c.tangentImpulse = ct[2]; } return c; }),
          contactCount: ps.contactCount, separation: ps.separation, isActive: ps.isActive, isSensor: ps.isSensor,
          timeCreated: ps.timeCreated, timeUpdated: ps.timeUpdated, inverseMass: ps.inverseMass, friction: ps.friction,
          frictionStatic: ps.frictionStatic, restitution: ps.restitution, slop: ps.slop,
        };
        col.pair = pr;
        engine.pairs.table[pr.id] = pr;
        engine.pairs.list.push(pr);
      }
      if (!skip.has("timing")) engine.timing.timestamp = snap.timing.timestamp;
      // module statics (Common._seed drives Common.random; group/category counters feed future bodies)
      for (const [mod, vals] of Object.entries(snap.statics || {})) if (Matter[mod]) Object.assign(Matter[mod], vals);
      Object.assign(engine.gravity, snap.gravity);
      engine.timing.timeScale = snap.timing.timeScale;
      engine.timing.lastDelta = snap.timing.lastDelta;
      // Detector: bodies array is sorted in place by bounds.min.x every step (stable sort), so the previous
      // order breaks ties. Rebuild it in the snapshot's order and clear isModified so Engine.update keeps it.
      if (!skip.has("detectorOrder") && snap.detectorOrder.every(k=>ix.byKey.has(k))) {
        engine.detector.bodies = snap.detectorOrder.map(k=>ix.byKey.get(k));
        Composite.setModified(engine.world, snap.worldModified, true, true);
      } else {
        Composite.setModified(engine.world, true, true, false);
      }
    }
    return { level, bodies: Object.keys(snap.bodies).length, pairs: L >= 2 ? snap.pairs.length : 0 };
  }

  /**
   * Diagnostic per-tick digest (NOT a canonical hash, see #152): exact doubles of every dynamic body's pose and
   * velocity plus the active pair count. Returned as an array so the first differing element is reportable.
   */
  function digest(engine, keyOf) {
    const out = [];
    const roots = Composite.allBodies(engine.world).filter((b) => !b.isStatic).sort((a, b) => (keyOf(a) < keyOf(b) ? -1 : 1));
    for (const b of roots) out.push(keyOf(b), b.position.x, b.position.y, b.angle, b.velocity.x, b.velocity.y, b.angularVelocity);
    out.push('pairs', engine.pairs.list.length);
    return out;
  }

  return { LEVELS, capture, restore, digest, auditBody, preflight: snap=>preflightMatterSnapshot(snap,Matter), captureBodyRaw: captureBody, restoreBodyRawInto: (b, o) => restoreBodyRaw(b, o), SNAPSHOT_KIND, SNAPSHOT_VERSION };
}
