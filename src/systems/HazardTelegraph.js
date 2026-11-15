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
 * @typedef {Object} TelegraphMark
 * @property {Object} ref the hazard object passed in (identity is the mark's key).
 * @property {'hop'|'brace'} kind
 * @property {'warn'|'go'|'clear'} state 'go' = inside the hop window; 'clear' = the sled is flying over it.
 * @property {'danger'|'amber'|'lime'} color palette key: red = hop, amber = brace, lime = hop now.
 * @property {boolean} clear draw dim, play nothing.
 * @property {number} dx px from the sled to the box centre.
 * @property {number} etaS seconds to the box centre at the current horizontal speed.
 * @property {number} urgency 0 at the warn distance .. 1 at the box.
 * @property {boolean} onScreen the box has entered the view (the marker leaves the screen edge and stands on the hazard).
 */

/**
 * Plan this frame's marks.
 * @param {Iterable<{def:Object, cx:number, w:number, hit?:boolean}>} hazards live hazards (Hazard entities or plain objects).
 * @param {{x:number, vx:number, speed:number, grounded:boolean, landX?:number|null}} sled landX = ballistic touchdown x while airborne.
 * @param {number} viewRight world x of the right screen edge.
 * @param {{isMuted?:(h:Object)=>boolean}} [opts] isMuted: hazards that currently do nothing (warded) are skipped.
 * @param {typeof GROUND_WARN} [t]
 * @returns {TelegraphMark[]} nearest first, at most t.maxMarks.
 */
export function planTelegraph(hazards, sled, viewRight, opts = {}, t = GROUND_WARN) {
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
    const clear = flying && sled.landX > h.cx + half + t.clearMarginPx;
    const go = !clear && kind === 'hop' && sled.grounded && inHopWindow(dx, sled.vx, t);
    marks.push({
      ref: h,
      kind,
      state: clear ? 'clear' : go ? 'go' : 'warn',
      color: go ? 'lime' : kind === 'hop' ? 'danger' : 'amber',
      clear,
      dx,
      etaS: dx / vx,
      urgency: clamp(1 - dx / warn, 0, 1),
      onScreen: h.cx - half < viewRight,
    });
  }
  marks.sort((a, b) => a.dx - b.dx);
  if (marks.length > t.maxMarks) marks.length = t.maxMarks;
  return marks;
}

/**
 * Remembers which hazards were already announced so each sound plays once. One per run.
 */
export class TelegraphTracker {
  /** @param {typeof GROUND_WARN} [t] */
  constructor(t = GROUND_WARN) {
    this.t = t;
    /** @type {WeakMap<Object, number>} hazard -> run time (ms) of its first non-clear mark. */
    this._warned = new WeakMap();
    this._cued = new WeakSet();
    this._lastWarnSoundMs = -1e9;
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
      if (m.clear) continue;
      if (!this._warned.has(m.ref)) {
        this._warned.set(m.ref, nowMs);
        const sound = nowMs - this._lastWarnSoundMs >= this.t.warnGapMs;
        if (sound) this._lastWarnSoundMs = nowMs;
        events.push({ type: 'warn', kind: m.kind, ref: m.ref, sound });
      }
      if (m.state === 'go' && !this._cued.has(m.ref)) {
        this._cued.add(m.ref);
        events.push({ type: 'go', kind: m.kind, ref: m.ref, sound: true });
      }
    }
    return events;
  }

  /** @param {Object} ref hazard. @returns {number|null} run time (ms) it was first announced, or null. */
  firstWarnMs(ref) {
    const v = this._warned.get(ref);
    return v == null ? null : v;
  }
}
