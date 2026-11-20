/**
 * OWNER: gameplay. NO Phaser imports. Pure and deterministic.
 *
 * Hostile racing Kodiaks (issue #47). Three rivals Marvin named and coloured:
 *  - KERNEL-PANIC KODIAK (white, polar): rides ahead, glitchy telegraphed feints, then a real
 *    stop-dead block you must hop over or ride past before it lands.
 *  - BRUTE-FORCE KODIAK (brown, grizzly): charges from behind and rams; hop over the lunge.
 *  - BLACK-ICE KODIAK (black, Vermont black bear): rides ahead and slides under your predicted
 *    landing; change the landing (tilt, airbrake, divebomb) or out-ride it.
 *
 * A bear is a kinematic racer on the terrain surface, advanced once per fixed simulation tick
 * (#59). It has no Matter body: collision is a tick-exact box test against the sled, so bears
 * never reorder the physics solver. Every choice (when, which bear, feint or real) comes from a
 * seeded stream per encounter, so the same seed and inputs give the same bears (ghost tapes).
 * Owner decisions still open (docs/issue-47-kodiaks.md): the Sync Level gate, the Daily rule.
 */
import { Rng } from './Rng.js';

/** Bump when spawn cadence, behaviour or collision changes (old ghost tapes would replay differently). */
export const KODIAK_VERSION = 1;
/** Proposal, not an owner value: Kodiaks start appearing at this Sync Level in ordinary runs. */
export const KODIAK_MIN_SYNC_LEVEL = 6;
/** No bear before this distance into a run, then one encounter every GAP metres. */
export const KODIAK_FIRST_M = 450;
export const KODIAK_GAP_M = [650, 1200];
export const KODIAK_LIFETIME_MS = 15000;
const BODY = { w: 42, h: 26 };

export const KODIAK_DEFS = Object.freeze({
  kernelPanic: Object.freeze({ kind: 'kernelPanic', id: 'kernelPanicKodiak', name: 'KERNEL-PANIC KODIAK', short: 'KERNEL-PANIC',
    from: 'ahead', color: 0xeaf4ff, accent: 0x2ccde5, onHit: { effect: 'crash' } }),
  bruteForce: Object.freeze({ kind: 'bruteForce', id: 'bruteForceKodiak', name: 'BRUTE-FORCE KODIAK', short: 'BRUTE-FORCE',
    from: 'behind', color: 0x8a5a2b, accent: 0xffb347, onHit: { effect: 'crash' } }),
  blackIce: Object.freeze({ kind: 'blackIce', id: 'blackIceKodiak', name: 'BLACK-ICE KODIAK', short: 'BLACK-ICE',
    from: 'ahead', color: 0x15151b, accent: 0x9fe8ff, onHit: { effect: 'crash' } }),
});
export const KODIAK_KINDS = Object.freeze(Object.keys(KODIAK_DEFS));
/** Crash-cause def by hazard id (CrashReport.killerName reads `name` and `onHit`). */
export const KODIAK_BY_ID = Object.freeze(Object.fromEntries(Object.values(KODIAK_DEFS).map((d) => [d.id, d])));

/**
 * Do Kodiaks appear on this run? From KODIAK_MIN_SYNC_LEVEL in ordinary runs. Never on Dailies or
 * in the Gym until an explicit event rule says so (issue #47: account level must not change a
 * stock-vs-stock competition).
 */
export function kodiaksEnabledFor({ level, daily = false, gym = false } = {}) {
  if (daily === true || gym === true) return false;
  return Number.isFinite(level) && level >= KODIAK_MIN_SYNC_LEVEL;
}

/** Encounter `n` (0-based) of a run: where it starts (metres from the start) and which bear. */
export function kodiakEncounter(seed, n) {
  let atM = KODIAK_FIRST_M;
  for (let i = 0; i < n; i++) {
    const r = new Rng(String(seed)).fork(`kodiak/gap/${i}`);
    atM += KODIAK_GAP_M[0] + r.next() * (KODIAK_GAP_M[1] - KODIAK_GAP_M[0]);
  }
  const pick = new Rng(String(seed)).fork(`kodiak/kind/${n}`);
  return { n, atM, kind: KODIAK_KINDS[Math.floor(pick.next() * KODIAK_KINDS.length)] };
}

/** Bear box (world px) standing on the surface at (x, groundY). */
export function kodiakBox(x, groundY) {
  return { x: x - BODY.w / 2, y: groundY - BODY.h, w: BODY.w, h: BODY.h };
}

/**
 * A new bear for an encounter, placed off screen ahead of or behind the sled.
 * @param {string} seed
 * @param {{n:number, kind:string}} enc from kodiakEncounter
 * @param {{x:number, vx:number}} sled
 */
export function spawnKodiak(seed, enc, sled) {
  const def = KODIAK_DEFS[enc.kind];
  const behind = def.from === 'behind';
  return {
    kind: enc.kind, n: enc.n, def,
    x: sled.x + (behind ? -620 : 640),
    speed: Math.max(120, sled.vx * (behind ? 1 : 0.88)),
    phase: 'approach', phaseMs: 0, ageMs: 0,
    rng: new Rng(String(seed)).fork(`kodiak/brain/${enc.n}`),
    feints: 0, targetX: null, groundY: NaN, sledAhead: behind,
    hit: false, done: false,
  };
}

const approach = (v, target, rate, dtS) => v + Math.max(-rate * dtS, Math.min(rate * dtS, target - v));

/**
 * Advance one bear by one tick.
 * @param {object} k bear state (mutated)
 * @param {{x:number, vx:number, grounded:boolean, landX:number|null}} sled
 * @param {number} dtMs the tick
 * @returns {{telegraph?:'feint'|'real', lunge?:boolean, done?:boolean}} what happened this tick
 */
export function stepKodiak(k, sled, dtMs) {
  const dtS = dtMs / 1000;
  const ev = {};
  k.ageMs += dtMs;
  k.phaseMs += dtMs;
  const dx = k.x - sled.x; // + : bear ahead of the sled
  const sv = Math.max(0, sled.vx);
  const go = (phase) => { k.phase = phase; k.phaseMs = 0; };
  if (k.kind === 'bruteForce') {
    if (k.phase === 'approach') {
      k.speed = approach(k.speed, sv + 150, 600, dtS); // catch up from behind
      if (dx > -150) { go('tele'); ev.telegraph = 'real'; }
    } else if (k.phase === 'tele') {
      k.speed = approach(k.speed, sv + 40, 900, dtS); // rear up, matching pace
      if (k.phaseMs >= 650) { go('lunge'); ev.lunge = true; }
    } else if (k.phase === 'lunge') {
      k.speed = approach(k.speed, sv + 380, 2400, dtS);
      if (k.phaseMs >= 520) go('recover');
    } else if (k.phase === 'recover') {
      k.speed = approach(k.speed, sv * 0.8, 500, dtS); // spent: the player can re-pass it
      if (k.phaseMs >= 4000) go('leave');
    }
  } else if (k.kind === 'kernelPanic') {
    if (k.phase === 'approach') {
      k.speed = approach(k.speed, sv * 0.85, 400, dtS); // the player closes in
      if (dx < 260) { go('tele'); ev.telegraph = k.feints < 2 && k.rng.next() < 0.6 ? 'feint' : 'real'; k.real = ev.telegraph === 'real'; if (!k.real) k.feints++; }
    } else if (k.phase === 'tele') {
      k.speed = approach(k.speed, sv * 0.9, 600, dtS);
      if (k.phaseMs >= (k.real ? 700 : 420)) {
        if (k.real) { go('lunge'); ev.lunge = true; } else go('approach');
      }
    } else if (k.phase === 'lunge') {
      k.speed = approach(k.speed, 0, 2600, dtS); // KERNEL PANIC: stops dead across the line
      if (k.phaseMs >= 1600) go('leave');
    }
  } else if (k.kind === 'blackIce') {
    if (k.phase === 'approach') {
      k.speed = approach(k.speed, sv * 0.92, 400, dtS);
      // Reads the terrain: when the sled is airborne and its landing is ahead, slide under it.
      // It can surge forward or brake to a stop, so any landing within reach of it counts.
      if (!sled.grounded && Number.isFinite(sled.landX) && Math.abs(sled.landX - k.x) < 450 && dx > 60 && dx < 700) {
        k.targetX = sled.landX; go('tele'); ev.telegraph = 'real';
      } else if (dx < -40) go('leave'); // out-ridden: the player got past
    } else if (k.phase === 'tele') {
      if (sled.grounded) go('approach');
      else {
        if (Number.isFinite(sled.landX)) k.targetX = sled.landX;
        const etaS = Math.max(0.15, Number.isFinite(sled.etaMs) ? sled.etaMs / 1000 : 0.6);
        k.speed = approach(k.speed, Math.max(0, (k.targetX - k.x) / etaS), 900, dtS);
      }
      if (k.phaseMs >= 2500) go('leave');
    }
  }
  if (k.phase === 'leave') k.speed = approach(k.speed, sv * (dx > 0 ? 1.35 : 0.5), 500, dtS); // clear the stage
  k.x += k.speed * dtS;
  if (k.ageMs >= KODIAK_LIFETIME_MS || (k.phase === 'leave' && Math.abs(dx) > 900) || dx < -1400) { k.done = true; ev.done = true; }
  return ev;
}

/**
 * Tick-exact collision. A sled whose bottom is above the bear's back (hopping over it) is safe.
 * @param {{x:number,y:number,w:number,h:number}} bearBox
 * @param {{x:number,y:number,w:number,h:number}} sledBox
 */
export function kodiakHits(bearBox, sledBox) {
  return sledBox.x < bearBox.x + bearBox.w && bearBox.x < sledBox.x + sledBox.w &&
    sledBox.y + sledBox.h > bearBox.y + 4 && sledBox.y < bearBox.y + bearBox.h;
}
