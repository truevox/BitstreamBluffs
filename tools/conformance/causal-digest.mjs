/**
 * Issue #140: per-tick CAUSAL-STATE DIGEST (diagnostic, NON-AUTHORITATIVE).
 *
 * This is a test/tooling probe, not a replay format and not a canonical state hash. It exists to
 * prove that presentation (camera, particles, render cadence, audio, viewport, HUD) cannot reach
 * the simulation. When the shared replay contract of issue #152 publishes versioned subsystem
 * hashes, this module should be replaced by that contract. Nothing in src/ imports it.
 *
 * Self-contained on purpose: no imports, and every function below `captureCausalState` is
 * written so the browser probe can ship it into the page as source text (Function#toString).
 *
 * Subsystems fall into three classes:
 *  - AUTHORITATIVE: physics, RNG, world membership, entities, score, BSOD, crash. Must never
 *    depend on presentation.
 *  - CUE: gameplay information the sim hands to the player (telegraph marks, warn/hop SFX,
 *    gameplay events, the crash report). Not physics, but under the issue #140 owner guardrail
 *    ("the camera is presentation, never game input") these must not depend on presentation either.
 *  - CACHE: deterministic generator caches that presentation is ALLOWED to warm (cosmetic terrain
 *    reads build chunks early). Reported, never treated as a leak.
 */

export const DIGEST_KIND = 'bb-causal-digest/diagnostic';
export const DIGEST_VERSION = 1;

export const SUBSYSTEMS = Object.freeze({
  authoritative: ['sled', 'rng', 'world', 'contacts', 'terrain', 'hazards', 'powerups', 'shards', 'kodiaks',
    'score', 'bsod', 'crash', 'timers', 'glitch'],
  cue: ['telegraph', 'sfx', 'events', 'crashReport'],
  cache: ['terrainCache'],
});

/** Every subsystem name -> its class. */
export function subsystemClass(name) {
  for (const [cls, list] of Object.entries(SUBSYSTEMS)) if (list.includes(name)) return cls;
  return 'unknown';
}

/**
 * Snapshot every causal subsystem of a live RunScene (or a stand-in object with the same fields).
 * Reads only; never calls a method that could mutate the scene (no heightAt, no terrain.update).
 * @param {object} run RunScene
 * @param {{sfx?:any[], events?:any[]}} [tickLog] what the sim emitted during this tick (see instrumentRun)
 * @returns {Record<string, any>} plain JSON-able data, one key per subsystem, plus `tick`
 */
export function captureCausalState(run, tickLog) {
  const num = (v) => (typeof v === 'number' ? v : v == null ? null : Number(v));
  const bodyPose = (b) => (b ? [b.id, b.label, b.position.x, b.position.y, b.angle, b.velocity.x, b.velocity.y,
    b.angularVelocity, b.isSensor ? 1 : 0, b.isStatic ? 1 : 0] : null);
  const sled = run.sled;
  const sb = sled && sled.body;
  const out = { tick: run.simClock ? run.simClock.tick : null };

  out.sled = sb ? {
    parts: (sb.parts || [sb]).map(bodyPose),
    grounded: !!sled.grounded,
    msSinceContact: num(sled.msSinceContact),
    airtimeMs: num(sled.airtimeMs),
    heliPhase: num(sled.heliPhase),
    heliVel: num(sled.heliVel),
    parachuteFuelMs: num(sled.parachuteFuelMs),
    parachuteMs: num(sled.parachuteMs),
    invulnerableMs: num(sled.invulnerableMs),
    scrambled: !!sled.scrambled,
  } : null;

  const rr = run.runRandom || {};
  out.rng = { physicsScramble: rr.physicsScramble ? rr.physicsScramble.state : null };

  const mw = run.matter && run.matter.world;
  const lw = mw && (mw.localWorld || (mw.engine && mw.engine.world));
  const bodies = lw ? lw.bodies || [] : [];
  out.world = { count: bodies.length, bodies: bodies.map((b) => [b.id, b.label]) };

  const pairs = mw && mw.engine && mw.engine.pairs;
  out.contacts = pairs ? {
    active: (pairs.list || []).filter((p) => p.isActive).map((p) => [p.id, p.isSensor ? 1 : 0,
      (p.contacts || []).map((c) => (c ? [num(c.normalImpulse), num(c.tangentImpulse)] : null))]),
  } : null;

  out.terrain = {
    physical: run.mesh && run.mesh.chunks ? [...run.mesh.chunks.keys()] : [],
    queued: run._chunkQueue ? [...run._chunkQueue.keys()] : [],
    colliders: run.mesh && run.mesh.chunks ? [...run.mesh.chunks.values()].map((c) => (c.bodies || []).map((b) => b.id)) : [],
  };
  out.terrainCache = { active: run.terrain && run.terrain.activeList ? run.terrain.activeList.map((c) => c.index) : [] };

  const hz = [];
  if (run.hazards) for (const [idx, list] of run.hazards) for (const h of list) {
    hz.push([idx, h.def && h.def.id, num(h.cx), num(h.cy), h.hit ? 1 : 0, h.nearMissed ? 1 : 0, h._side ?? null,
      h.warned ? 1 : 0, h.alert ? 1 : 0, h.open ? 1 : 0, h.rolling ? 1 : 0, h.roll ? JSON.stringify(h.roll) : null,
      h.body ? [h.body.id, h.body.position.x, h.body.position.y] : null]);
  }
  out.hazards = hz;

  const pu = [];
  if (run.powerups) for (const [idx, list] of run.powerups) for (const p of list) {
    pu.push([idx, p.key, p.def && p.def.id, p.collected ? 1 : 0, p.body ? p.body.id : null]);
  }
  out.powerups = { live: pu, collected: run.collectedPowerups ? [...run.collectedPowerups] : [] };

  const sf = run.shardField;
  out.shards = { collected: sf && sf.collected ? [...sf.collected] : [], total: num(run.shardTotal),
    count: num(run.shardCount), chain: num(run.shardChain) };

  out.kodiaks = {
    next: num(run.kodiakNext),
    pack: (run.kodiaks || []).map((k) => ({
      id: k.def && k.def.id, kind: k.kind, n: k.n, member: k.member, x: num(k.x), speed: num(k.speed),
      phase: k.phase, phaseMs: num(k.phaseMs), ageMs: num(k.ageMs), feints: k.feints, targetX: k.targetX,
      groundY: num(k.groundY), sledAhead: !!k.sledAhead, hit: !!k.hit, done: !!k.done,
      rng: k.rng ? k.rng.state : null,
    })),
  };

  const sc = run.score;
  let snap = null;
  try { snap = sc && sc.getSnapshot ? sc.getSnapshot() : null; } catch (e) { snap = null; }
  out.score = {
    total: sc && sc.getTotal ? sc.getTotal() : null,
    snapshot: snap,
    flow: sc && sc.getFlow ? sc.getFlow() : null,
    nearMisses: num(run.nearMissCount),
    trickCounts: run.trickCounts || null,
    maxAirtimeMs: num(run.maxAirtimeMs),
  };

  const bs = run.bsodState;
  out.bsod = {
    caught: !!run.bsodCaught,
    wallX: run.bsod ? num(run.bsod.wallX) : null,
    wallSpeed: run.bsod ? num(run.bsod.wallSpeedPxS) : null,
    state: bs ? { gapPx: num(bs.gapPx), active: bs.active, proximity01: num(bs.proximity01) } : null,
  };

  out.crash = {
    crashed: !!run.crashed,
    pending: run.pendingCrash ? JSON.stringify(run.pendingCrash) : null,
    shieldCharges: num(run.shieldCharges),
  };

  out.timers = {
    runTimeMs: num(run.runTimeMs), scrambleMs: num(run.scrambleMs), slowMs: num(run.slowMs), boostMs: num(run.boostMs),
    slowmoMs: num(run.slowmoMs), blinkMs: num(run.blinkMs), hitStopMs: num(run.hitStopMs),
    resetCooldownMs: num(run.resetCooldownMs), magnetMs: num(run.magnetMs), glideMs: num(run.glideMs),
    stabilizeMs: num(run.stabilizeMs), blindMs: num(run.blindMs),
  };

  const gl = run.glitch;
  let glitchState = null;
  try { glitchState = gl ? JSON.stringify({ a: gl.active, n: gl.nextAtMs ?? gl._next ?? null }) : null; } catch (e) { glitchState = 'unserializable'; }
  out.glitch = glitchState;

  const tele = [];
  if (run.hazards) for (const list of run.hazards.values()) for (const h of list) if (h.teleAtMs != null) tele.push([h.def && h.def.id, num(h.cx), num(h.teleAtMs)]);
  let marks = null;
  try { marks = run._teleMarks ? JSON.stringify(run._teleMarks, (k, v) => (k === 'ref' || k === 'h' ? undefined : v)) : null; } catch (e) { marks = 'unserializable'; }
  out.telegraph = { warnedAt: tele, marks };

  out.sfx = tickLog && tickLog.sfx ? tickLog.sfx.slice() : [];
  out.events = tickLog && tickLog.events ? tickLog.events.slice() : [];
  let report = null;
  try {
    const r = run.registry && run.registry.get && run.registry.get('lastCrash');
    report = r ? JSON.stringify(r, (k, v) => (k === 'runId' ? '[wallclock]' : v)) : null;
  } catch (e) { report = null; }
  out.crashReport = run.crashed ? report : null;
  return out;
}

/**
 * JSON with a cycle guard and depth limit (event payloads can carry scene objects). Wall-clock
 * fields (run ids are `${Date.now()}-${seed}`) are masked: they differ between any two runs and are
 * not causal state.
 */
export function safeJson(value, maxDepth = 6) {
  const WALLCLOCK = { runId: 1, startedAt: 1, endedAt: 1, id: 1, ledgerHash: 1, pauseToken: 1 };
  const seen = new WeakSet();
  const walk = (v, d) => {
    if (v === null || typeof v !== 'object') return typeof v === 'function' ? undefined : v;
    if (seen.has(v) || d > maxDepth) return '[ref]';
    seen.add(v);
    if (Array.isArray(v)) return v.map((x) => walk(x, d + 1));
    const o = {};
    for (const k of Object.keys(v)) {
      if (k === 'scene' || k === 'gfx') continue;
      o[k] = WALLCLOCK[k] && (typeof v[k] === 'string' || typeof v[k] === 'number') ? '[wallclock]' : walk(v[k], d + 1);
    }
    return o;
  };
  return JSON.stringify(walk(value, 0));
}

/** 32-bit FNV-1a of a string, hex. Diagnostic only (collisions are irrelevant at this scale). */
export function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** Per-subsystem hashes of one captured state. JSON.stringify prints doubles exactly (shortest round-trip). */
export function digestState(state) {
  const out = { tick: state.tick };
  for (const k of Object.keys(state)) if (k !== 'tick') out[k] = fnv1a(JSON.stringify(state[k]));
  return out;
}

/**
 * First divergence between two digest sequences (arrays of digestState results, one per tick).
 * @returns {{equalTicks:number, compared:number, first:null|{tick:number, subsystems:string[], classes:string[]},
 *   firstAuthoritative:null|{tick:number, subsystems:string[]}, perSubsystem:Record<string, number|null>, lengthMismatch:boolean}}
 */
export function diffDigests(a, b) {
  const byTick = new Map(b.map((d) => [d.tick, d]));
  const perSubsystem = {};
  let first = null;
  let firstAuthoritative = null;
  let equalTicks = 0;
  let compared = 0;
  for (const da of a) {
    const db = byTick.get(da.tick);
    if (!db) continue;
    compared++;
    const diff = [];
    for (const k of Object.keys(da)) {
      if (k === 'tick') continue;
      if (da[k] !== db[k]) {
        diff.push(k);
        if (perSubsystem[k] == null) perSubsystem[k] = da.tick;
      } else if (!(k in perSubsystem)) perSubsystem[k] = null;
    }
    const auth = diff.filter((k) => subsystemClass(k) === 'authoritative');
    if (diff.length && !first) first = { tick: da.tick, subsystems: diff, classes: [...new Set(diff.map(subsystemClass))] };
    if (auth.length && !firstAuthoritative) firstAuthoritative = { tick: da.tick, subsystems: auth };
    if (!diff.length) equalTicks++;
  }
  return { equalTicks, compared, first, firstAuthoritative, perSubsystem, lengthMismatch: a.length !== b.length };
}

/**
 * Verdict for one perturbation against the baseline.
 *  - 'isolated': no authoritative and no cue subsystem differs (CACHE may);
 *  - 'cue-leak': only cue subsystems differ (gameplay information follows presentation);
 *  - 'causal-leak': an authoritative subsystem differs.
 */
export function verdict(diff) {
  const diverged = Object.entries(diff.perSubsystem).filter(([, t]) => t != null).map(([k]) => k);
  if (diverged.some((k) => subsystemClass(k) === 'authoritative')) return 'causal-leak';
  if (diverged.some((k) => subsystemClass(k) === 'cue')) return 'cue-leak';
  return diff.lengthMismatch ? 'length-mismatch' : 'isolated';
}

/**
 * Wrap a live RunScene so each simTick records the SFX cues and gameplay events it emitted and is
 * followed by a digest. Presentation-side emits (UI, audio, render) happen outside simTick and are
 * not logged. Returns the recorder; `onTick(state)` receives every captured state.
 * Written to be shipped as source into the browser page.
 */
export function instrumentRun(run, game, onTick, capture, digest, json) {
  const log = { sfx: [], events: [], inTick: false };
  const realSimTick = run.simTick;
  const realPlaySfx = run.playSfx;
  const realEmit = game.events.emit;
  run.playSfx = function (name, opts) {
    if (log.inTick) log.sfx.push([name, opts ? JSON.stringify(opts) : null]);
    return realPlaySfx.call(this, name, opts);
  };
  game.events.emit = function (name, payload) {
    if (log.inTick) {
      let p = null;
      try { p = payload === undefined ? null : json(payload); } catch (e) { p = 'unserializable'; }
      log.events.push([String(name), p]);
    }
    return realEmit.apply(this, arguments);
  };
  run.simTick = function (dt, pad) {
    log.inTick = true;
    let r;
    try { r = realSimTick.call(this, dt, pad); } finally { log.inTick = false; }
    const state = capture(this, log);
    log.sfx.length = 0;
    log.events.length = 0;
    onTick(state, digest(state));
    return r;
  };
  return log;
}
