/**
 * OWNER: gameplay (readable-chaos pass). Pure scheduling for the ground-hazard telegraph: which ground hazards are
 * announced before they enter the view, in which colour, when the chevron goes lime ("hop now"), and which sounds play
 * once. No Phaser, no window, no randomness, no clock: RunScene feeds it the live hazards and the sled, and
 * entities/GroundTelegraph.js draws the marks it returns. Nothing here touches physics, terrain, score or the record.
 *
 * Why: measured on the built game (scratchpad fable-10x/PICK.md), a ground hazard first appeared on screen ~481 px ahead,
 * a median 0.85 s (p10 0.67 s) before the sled reached it, and the hop has to be pressed ~0.38 s out. The marks are
 * time-based (about GROUND_WARN.leadS of travel), so the warning no longer shrinks as the sled speeds up.
 */

/**
 * Telegraph tuning. Kept here (not in PhysicsTuner.TUNING): it is UI timing, not physics.
 *  - leadS / minPx / maxPx: a hazard is announced when it is within speed x leadS px, clamped. maxPx gives 1.33 s at
 *    1200 px/s. Terrain is generated TERRAIN.bufferAheadScreens = 3 screens = 1440 px ahead (to the end of that chunk),
 *    so above ~720 px/s a hazard is announced as soon as its chunk exists; measured minimum lead 1.67 s.
 *  - hopLeadMs / hopWindowMs / minVxPxS: the sim hop oracle's rule (tools/sim/browser.js policies.hop): hop when the box
 *    centre is hopLeadMs away, down to hopWindowMs later.
 *  - maxMarks: nearest N hazards are planned (late-game density is ~4.5 ground hazards per maxPx).
 *  - warnGapMs: at most one warn sound per this long (events are never dropped, only the sound).
 *  - clearMarginPx: an airborne sled forecast to land this far past the box is "clear" of it.
 *  - arrivalHorizonMs / arrivalStepMs: a moving hazard's arrival is searched this far ahead, in steps this long, then
 *    refined by bisection (predictArrival).
 *  - gateMarginMs: a gate (B3 Gear Gate) counts as open at arrival only if it is open from this long before the predicted
 *    arrival to this long after it. It covers the crossing (~30 ms) and the drift of a 1 to 2 s estimate while the speed
 *    changes, and 2x it fits inside the 900 ms open spell.
 */
export const GROUND_WARN = Object.freeze({
  leadS: 2.0,
  minPx: 700,
  maxPx: 1600,
  hopLeadMs: 380,
  hopWindowMs: 250,
  minVxPxS: 60,
  maxMarks: 6,
  warnGapMs: 220,
  clearMarginPx: 60,
  arrivalHorizonMs: 4000,
  arrivalStepMs: 20,
  gateMarginMs: 150,
});

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

/**
 * What the player should do about a hazard def: 'hop' (it crashes the sled), 'brace' (it slows / scrambles / otherwise
 * hinders, hopping is optional), or null (air hazards have their own telegraph, entities/AirTelegraph.js).
 * @param {import('../data/schemas.js').HazardDef|null|undefined} def
 * @returns {'hop'|'brace'|null}
 */
export function hazardResponse(def) {
  if (!def || def.placement === 'air') return null;
  return !def.onHit || def.onHit.effect === 'crash' ? 'hop' : 'brace';
}

/**
 * How far ahead (world px) a ground hazard is announced at this speed.
 * @param {number} speedPxS
 * @param {typeof GROUND_WARN} [t]
 * @returns {number}
 */
export function warnDistancePx(speedPxS, t = GROUND_WARN) {
  const s = Number.isFinite(speedPxS) ? speedPxS : 0;
  return clamp(s * t.leadS, t.minPx, t.maxPx);
}

/**
 * True while a hop pressed now puts the apex over the box: the exact rule of the sim's hop oracle.
 * @param {number} dx hazard centre minus sled x (px).
 * @param {number} vx sled horizontal speed (px/s).
 * @param {typeof GROUND_WARN} [t]
 * @returns {boolean}
 */
export function inHopWindow(dx, vx, t = GROUND_WARN) {
  if (!(dx > 0)) return false;
  const v = Math.max(vx, t.minVxPxS);
  const etaMs = dx / v * 1000;
  return etaMs <= t.hopLeadMs && etaMs > t.hopLeadMs - t.hopWindowMs;
}

/**
 * True while a hop pressed now puts the apex over the box, from the time to arrival (ms): the oracle's rule in time.
 * @param {number} etaMs
 * @param {typeof GROUND_WARN} [t]
 * @returns {boolean}
 */
export function inHopWindowMs(etaMs, t = GROUND_WARN) {
  return etaMs > 0 && etaMs <= t.hopLeadMs && etaMs > t.hopLeadMs - t.hopWindowMs;
}

/**
 * When the sled (at constant horizontal speed) reaches a hazard's box centre. A hazard with `predictX(tMs)` (B3: Hazard
 * entity, systems/HazardMotion.js) is timed with it: its centre at run time now + tau is cx + predictX(now + tau) -
 * predictX(now) (predictX gives the ground x, the centre may sit off it on a slope). Nothing here assumes which way, how
 * fast or how far a hazard moves. Without predictX, without nowMs, or when predictX does not change between now and the
 * static arrival, the answer is exactly dx / vx (the sim oracle's rule).
 * Known limit: Hazard.predictX treats a roll that has not started as resting at its spawn point; it starts when the sled
 * is ROLL_ACTIVATE_PX (340 px) behind it, and from that frame on the estimate is exact.
 * @param {{cx:number, predictX?:(tMs:number)=>number}} h
 * @param {{x:number, vx:number}} sled
 * @param {number|undefined} nowMs run time (the time base of predictX).
 * @param {typeof GROUND_WARN} [t]
 * @returns {{etaMs:number, cxAtArrival:number}} etaMs Infinity when the sled does not catch it within the horizon.
 */
export function predictArrival(h, sled, nowMs, t = GROUND_WARN) {
  const vx = Math.max(sled.vx, t.minVxPxS);
  const dx = h.cx - sled.x;
  const staticEta = dx / vx * 1000;
  if (typeof h.predictX !== 'function' || !Number.isFinite(nowMs)) return { etaMs: staticEta, cxAtArrival: h.cx };
  const p0 = h.predictX(nowMs);
  if (!Number.isFinite(p0)) return { etaMs: staticEta, cxAtArrival: h.cx };
  const cxAt = (tau) => h.cx + h.predictX(nowMs + tau) - p0;
  if (cxAt(staticEta) === h.cx && cxAt(staticEta / 2) === h.cx) return { etaMs: staticEta, cxAtArrival: h.cx };
  const gap = (tau) => cxAt(tau) - (sled.x + vx * tau / 1000);
  if (!(gap(0) > 0)) return { etaMs: 0, cxAtArrival: cxAt(0) };
  let lo = 0;
  let hi = null;
  for (let tau = t.arrivalStepMs; tau <= t.arrivalHorizonMs; tau += t.arrivalStepMs) {
    if (gap(tau) <= 0) { hi = tau; break; }
    lo = tau;
  }
  if (hi === null) return { etaMs: Infinity, cxAtArrival: h.cx };
  for (let i = 0; i < 14; i++) {
    const mid = (lo + hi) / 2;
    if (gap(mid) > 0) lo = mid; else hi = mid;
  }
  return { etaMs: hi, cxAtArrival: cxAt(hi) };
}

/**
 * B3 Gear Gate verdict at the predicted arrival: 'open' when `isPassable` holds from gateMarginMs before arrivalMs and
 * the next change is more than 2 x gateMarginMs after that (so open across the whole margin), else 'closed'. null for
 * a hazard without the gate API or without an arrival.
 * @param {{isPassable?:(t:number)=>boolean, gateNextChangeMs?:(t:number)=>number|null}} h
 * @param {number} arrivalMs run time.
 * @param {typeof GROUND_WARN} [t]
 * @returns {'open'|'closed'|null}
 */
export function gateVerdict(h, arrivalMs, t = GROUND_WARN) {
  if (typeof h.isPassable !== 'function' || typeof h.gateNextChangeMs !== 'function') return null;
  if (h.gateNextChangeMs(0) == null) return null; // not a gate (Hazard.gateNextChangeMs is null for anything else)
  if (!Number.isFinite(arrivalMs)) return 'closed';
  const from = arrivalMs - t.gateMarginMs;
  return h.isPassable(from) && h.gateNextChangeMs(from) > 2 * t.gateMarginMs ? 'open' : 'closed';
}

/**
 * @typedef {Object} TelegraphMark
 * @property {Object} ref the hazard object passed in (identity is the mark's key).
 * @property {'hop'|'brace'} kind
 * @property {'warn'|'go'|'clear'|'open'} state 'go' = inside the hop window; 'clear' = the sled is flying over it;
 *   'open' = a Gear Gate that will be open when the sled gets there (drawn dim, silent, never lime).
 * @property {'danger'|'amber'|'lime'} color palette key: red = hop, amber = brace, lime = hop now.
 * @property {boolean} clear draw dim, play nothing.
 * @property {number} dx px from the sled to the box centre.
 * @property {number} etaS seconds to the box centre at the current horizontal speed (moving hazards: predicted with
 *   predictArrival; Infinity when the sled will not catch it).
 * @property {number|null} arrivalMs run time of the predicted arrival (null without opts.nowMs).
 * @property {'open'|'closed'|null} gate Gear Gate verdict at arrival (gateVerdict); null for anything else.
 * @property {number} urgency 0 at the warn distance .. 1 at the box.
 */

/**
 * Plan this frame's semantic marks without a viewport. The current camera decides where to draw them later.
 * @param {Iterable<{def:Object, cx:number, w:number, hit?:boolean}>} hazards live hazards (Hazard entities or plain objects).
 * @param {{x:number, vx:number, speed:number, grounded:boolean, landX?:number|null}} sled landX = ballistic touchdown x while airborne.
 * @param {{isMuted?:(h:Object)=>boolean, nowMs?:number}} [opts] isMuted: hazards that currently do nothing (warded) are
 *   skipped. nowMs: run time, needed to time moving hazards (predictX) and judge gates; without it all are static.
 * @param {typeof GROUND_WARN} [t]
 * @returns {TelegraphMark[]} nearest first, at most t.maxMarks.
 */
export function planTelegraphMarks(hazards, sled, opts = {}, t = GROUND_WARN) {
  const warn = warnDistancePx(sled.speed, t);
  const vx = Math.max(sled.vx, t.minVxPxS);
  const flying = !sled.grounded && Number.isFinite(sled.landX);
  const marks = [];
  for (const h of hazards) {
    if (!h || h.hit) continue;
    const kind = hazardResponse(h.def);
    if (!kind) continue;
    const dx = h.cx - sled.x;
    if (!(dx > 0) || dx > warn) continue;
    if (opts.isMuted && opts.isMuted(h)) continue;
    const half = (h.w || 0) / 2;
    const arr = predictArrival(h, sled, opts.nowMs, t);
    const arrivalMs = Number.isFinite(opts.nowMs) ? opts.nowMs + arr.etaMs : null;
    const gate = Number.isFinite(opts.nowMs) ? gateVerdict(h, arrivalMs, t) : null;
    const clear = flying && sled.landX > arr.cxAtArrival + half + t.clearMarginPx;
    const open = !clear && gate === 'open';
    const go = !clear && !open && kind === 'hop' && sled.grounded && inHopWindowMs(arr.etaMs, t);
    marks.push({
      ref: h,
      kind,
      state: clear ? 'clear' : open ? 'open' : go ? 'go' : 'warn',
      color: go ? 'lime' : kind === 'hop' ? 'danger' : 'amber',
      clear,
      dx,
      etaS: arr.etaMs / 1000,
      arrivalMs,
      gate,
      urgency: clamp(1 - dx / warn, 0, 1),
    });
  }
  marks.sort((a, b) => a.dx - b.dx);
  if (marks.length > t.maxMarks) marks.length = t.maxMarks;
  return marks;
}

/** Keep the former explicit-horizon hint for historical diagnostics. Live planning and rendering do not use it. */
export function planTelegraph(hazards, sled, viewRight, opts = {}, t = GROUND_WARN) {
  return planTelegraphMarks(hazards, sled, opts, t).map((mark) => ({
    ...mark, onScreen: mark.ref.cx - (mark.ref.w || 0) / 2 < viewRight,
  }));
}

/** Version of the TelegraphTracker snapshot layout. */
export const TRACKER_SNAPSHOT_VERSION = 1;

/**
 * Remembers which hazards were already announced so each sound plays once. One per run.
 *
 * State is plain data keyed by the stable hazard id (`Hazard.hid`, `${chunk.index}:${spawn ordinal}`, assigned in
 * RunScene.takeChunk), never by object identity, so snapshot()/restore() carry it across a savestate and a restored game
 * (hazards rebuilt from chunk data) neither re-warns nor re-stamps. Issue #119 Phase 2.
 */
export class TelegraphTracker {
  /** @param {typeof GROUND_WARN} [t] */
  constructor(t = GROUND_WARN) {
    this.t = t;
    /** @type {Map<string, {warned:number|null, cued:boolean, arrival:number|null}>} hazard id -> state. */
    this._h = new Map();
    this._lastWarnSoundMs = -1e9;
  }

  /** @param {Object|string} ref hazard (or its id). @returns {string} */
  static idOf(ref) {
    const id = typeof ref === 'string' ? ref : ref && ref.hid;
    if (typeof id !== 'string' || !id) throw new Error('TelegraphTracker: hazard has no stable id (hid)');
    return id;
  }

  _entry(id) {
    let e = this._h.get(id);
    if (!e) { e = { warned: null, cued: false, arrival: null }; this._h.set(id, e); }
    return e;
  }

  /**
   * @param {number} nowMs run time.
   * @param {TelegraphMark[]} marks this frame's plan.
   * @returns {Array<{type:'warn'|'go', kind:'hop'|'brace', ref:Object, sound:boolean}>} 'warn' when a hazard is first
   *   announced (sound false when another warn sounded under warnGapMs ago), 'go' when it first enters the hop window.
   */
  update(nowMs, marks) {
    const events = [];
    for (const m of marks) {
      const id = TelegraphTracker.idOf(m.ref);
      if (Number.isFinite(m.arrivalMs)) this._entry(id).arrival = m.arrivalMs;
      if (m.clear || m.state === 'open') continue;
      const e = this._entry(id);
      if (e.warned === null) {
        e.warned = nowMs;
        const sound = nowMs - this._lastWarnSoundMs >= this.t.warnGapMs;
        if (sound) this._lastWarnSoundMs = nowMs;
        events.push({ type: 'warn', kind: m.kind, ref: m.ref, sound });
      }
      if (m.state === 'go' && !e.cued) {
        e.cued = true;
        events.push({ type: 'go', kind: m.kind, ref: m.ref, sound: true });
      }
    }
    return events;
  }

  /**
   * The latest planned arrival for a hazard (crash report: the ideal-hop window of the hazard that killed).
   * @param {Object|string} ref hazard. @returns {number|null} run time (ms), or null if it was never planned with a run time.
   */
  lastArrivalMs(ref) {
    const e = this._h.get(TelegraphTracker.idOf(ref));
    return e && e.arrival !== null ? e.arrival : null;
  }

  /** @param {Object|string} ref hazard. @returns {number|null} run time (ms) it was first announced, or null. */
  firstWarnMs(ref) {
    const e = this._h.get(TelegraphTracker.idOf(ref));
    return e && e.warned !== null ? e.warned : null;
  }

  /** Forget a dropped chunk's hazards (ids `${chunkIndex}:*`), so the state stays bounded like the old WeakMaps were. */
  forgetChunk(chunkIndex) {
    const prefix = `${chunkIndex}:`;
    for (const id of [...this._h.keys()]) if (id.startsWith(prefix)) this._h.delete(id);
  }

  /** @returns {{v:number, lastWarnSoundMs:number, hazards:Array<[string, number|null, boolean, number|null]>}} plain JSON data, id-sorted. */
  snapshot() {
    const hazards = [...this._h].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
      .map(([id, e]) => [id, e.warned, e.cued, e.arrival]);
    return { v: TRACKER_SNAPSHOT_VERSION, lastWarnSoundMs: this._lastWarnSoundMs, hazards };
  }

  /** @param {ReturnType<TelegraphTracker['snapshot']>} snap replaces all state. Throws on an unknown version. */
  restore(snap) {
    if (!snap || snap.v !== TRACKER_SNAPSHOT_VERSION || !Array.isArray(snap.hazards)) throw new Error('TelegraphTracker.restore: unsupported snapshot');
    this._h = new Map(snap.hazards.map(([id, warned, cued, arrival]) => [id, { warned, cued, arrival }]));
    this._lastWarnSoundMs = snap.lastWarnSoundMs;
  }
}
