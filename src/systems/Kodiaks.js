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
export const KODIAK_VERSION = 2; // v2: packs
/** Proposal, not an owner value: Kodiaks start appearing at this Sync Level in ordinary runs. */
export const KODIAK_MIN_SYNC_LEVEL = 6;
/** No bear before this distance into a run, then one encounter every GAP metres. */
export const KODIAK_FIRST_M = 450;
export const KODIAK_GAP_M = [650, 1200];
export const KODIAK_LIFETIME_MS = 15000;
const BODY = { w: 42, h: 26 };

export const KODIAK_DEFS = Object.freeze({
  kernelPanic: Object.freeze({ kind: 'kernelPanic', id: 'kernelPanicKodiak', name: 'KERNEL-PANIC KODIAK', short: 'KERNEL-PANIC',
    from: 'ahead', color: 0xeaf4ff, rim: 0x9fdcff, accent: 0x2ccde5, onHit: { effect: 'crash' } }),
  bruteForce: Object.freeze({ kind: 'bruteForce', id: 'bruteForceKodiak', name: 'BRUTE-FORCE KODIAK', short: 'BRUTE-FORCE',
    from: 'behind', color: 0x8a5a2b, rim: 0xc49060, accent: 0xffb347, onHit: { effect: 'crash' } }),
  blackIce: Object.freeze({ kind: 'blackIce', id: 'blackIceKodiak', name: 'BLACK-ICE KODIAK', short: 'BLACK-ICE',
    from: 'ahead', color: 0x15151b, rim: 0x7fb8d8, accent: 0x9fe8ff, onHit: { effect: 'crash' } }),
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

/** Pack composition modes (owner, 2026-11-21: race bears come in packs; same-type vs mixed is a playtest question). */
export const KODIAK_PACK_MODES = Object.freeze(['same', 'mixed']);
/** Gap (px) between pack members on the same side: staggers their arrival. */
export const KODIAK_PACK_SPACING_PX = 170;

/**
 * Encounter `n` (0-based) of a run: where it starts (metres from the start) and its pack. A pack has
 * 2 or 3 bears (the run's first pack always 2). 'same': one type throughout. 'mixed': at least two
 * different types (all three in a pack of three).
 * @returns {{n:number, atM:number, kind:string, members:string[], mode:string}}
 */
export function kodiakEncounter(seed, n, mode = 'same') {
  let atM = KODIAK_FIRST_M;
  for (let i = 0; i < n; i++) {
    const r = new Rng(String(seed)).fork(`kodiak/gap/${i}`);
    atM += KODIAK_GAP_M[0] + r.next() * (KODIAK_GAP_M[1] - KODIAK_GAP_M[0]);
  }
  const pick = new Rng(String(seed)).fork(`kodiak/kind/${n}`);
  const kind = KODIAK_KINDS[Math.floor(pick.next() * KODIAK_KINDS.length)];
  const size = n === 0 ? 2 : new Rng(String(seed)).fork(`kodiak/size/${n}`).next() < 0.6 ? 2 : 3;
  let members;
  if (mode === 'mixed') {
    // The lead type first, then the others in a seeded order: every member of a pack of 2 or 3 differs.
    const rest = KODIAK_KINDS.filter((k) => k !== kind);
    if (new Rng(String(seed)).fork(`kodiak/mix/${n}`).next() < 0.5) rest.reverse();
    members = [kind, ...rest].slice(0, size);
  } else members = Array(size).fill(kind);
  return { n, atM, kind, members, mode: mode === 'mixed' ? 'mixed' : 'same' };
}

/**
 * The bears of a pack, spread out so they arrive one after another: each side's members are
 * KODIAK_PACK_SPACING_PX further away than the one before.
 */
export function spawnKodiakPack(seed, enc, sled) {
  const perSide = { ahead: 0, behind: 0 };
  return (enc.members || [enc.kind]).map((kind, i) => {
    const side = KODIAK_DEFS[kind].from;
    const offset = perSide[side]++ * KODIAK_PACK_SPACING_PX;
    return spawnKodiak(seed, { n: enc.n, kind, member: i }, sled, offset);
  });
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
export function spawnKodiak(seed, enc, sled, offsetPx = 0) {
  const def = KODIAK_DEFS[enc.kind];
  const behind = def.from === 'behind';
  return {
    kind: enc.kind, n: enc.n, member: enc.member || 0, def,
    x: sled.x + (behind ? -620 - offsetPx : 640 + offsetPx),
    speed: Math.max(120, sled.vx * (behind ? 1 : 0.88)),
    phase: 'approach', phaseMs: 0, ageMs: 0,
    rng: new Rng(String(seed)).fork(`kodiak/brain/${enc.n}/${enc.member || 0}`),
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
 * @param {boolean} [busy] another pack member is telegraphing or attacking: this one holds its pace
 *   and never starts an attack, so the player faces one attack at a time
 * @returns {{telegraph?:'feint'|'real', lunge?:boolean, done?:boolean}} what happened this tick
 */
export function stepKodiak(k, sled, dtMs, busy = false) {
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
      if (dx > -150 && !busy) { go('tele'); ev.telegraph = 'real'; }
      else if (busy && dx > -260) k.speed = approach(k.speed, sv, 900, dtS); // wait its turn, just behind
    } else if (k.phase === 'tele') {
      k.speed = approach(k.speed, sv + 40, 900, dtS); // rear up, matching pace
      if (k.phaseMs >= 650) { go('lunge'); ev.lunge = true; }
    } else if (k.phase === 'lunge') {
      k.speed = approach(k.speed, sv + 380, 2400, dtS);
      // The charge carries it well clear ahead before it tires: it never slows down under the sled.
      if (dx > 160 || k.phaseMs >= 1600) go('recover');
    } else if (k.phase === 'recover') {
      // Spent: it slows hard, so re-passing it is a clean hop at real closing speed (never a slow crawl over
      // its back, which no hop can clear).
      k.speed = approach(k.speed, sv * 0.4, 1600, dtS);
      if (k.phaseMs >= 2500) go('leave');
    }
  } else if (k.kind === 'kernelPanic') {
    if (k.phase === 'approach') {
      k.speed = approach(k.speed, sv * 0.85, 400, dtS); // the player closes in
      if (busy && dx < 320) k.speed = approach(k.speed, sv, 900, dtS); // wait its turn, just ahead
      else if (dx < 260) { go('tele'); ev.telegraph = k.feints < 2 && k.rng.next() < 0.6 ? 'feint' : 'real'; k.real = ev.telegraph === 'real'; if (!k.real) k.feints++; }
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
      // Black-Ice never blocks the ground: it keeps ahead of the sled (speeding up if the sled gains) and only
      // threatens landings.
      k.speed = approach(k.speed, dx < 220 ? sv * 1.3 : sv, 700, dtS);
      // Reads the terrain: when the sled is airborne and its landing is ahead, slide under it.
      // It can surge forward or brake to a stop, so any landing within reach of it counts.
      if (!busy && !sled.grounded && Number.isFinite(sled.landX) && Math.abs(sled.landX - k.x) < 450 && dx > 60 && dx < 700) {
        k.targetX = sled.landX; go('tele'); ev.telegraph = 'real';
      } else if (dx < -40 || k.phaseMs >= 6000) go('leave'); // out-ridden (in the air), or no landing to read
    } else if (k.phase === 'tele') {
      // It COMMITS to the landing spot it telegraphed (the glint): change your landing (divebomb short,
      // parachute or airbrake long) and it slides to the wrong place. Its slide speed is capped too.
      if (sled.grounded) go('leave'); // the landing came and went: hit or miss, it is done
      else {
        const etaS = Math.max(0.15, Number.isFinite(sled.etaMs) ? sled.etaMs / 1000 : 0.6);
        k.speed = approach(k.speed, Math.max(0, Math.min(sv * 1.4, (k.targetX - k.x) / etaS)), 900, dtS);
      }
      if (k.phaseMs >= 2500) go('leave');
    }
  }
  if (k.phase === 'leave') k.speed = approach(k.speed, sv * (dx > 0 ? 1.35 : 0.5), 500, dtS); // clear the stage
  k.x += k.speed * dtS;
  if (k.ageMs >= KODIAK_LIFETIME_MS || (k.phase === 'leave' && Math.abs(dx) > 900) || dx < -1400) { k.done = true; ev.done = true; }
  return ev;
}

/** A pack member nearer than this to the sled is an obstacle to hop: the others hold off. */
export const KODIAK_CLEAR_PX = 220;

/** A bear that is telegraphing or attacking (the pack's one active threat). */
export const kodiakThreatening = (k) => !k.done && (k.phase === 'tele' || k.phase === 'lunge');

/**
 * Advance a whole pack by one tick: members in order, at most one of them threatening at a time, and
 * none attacking while another is close enough to need hopping.
 * @returns {Array<{k:object, ev:object}>}
 */
export function stepKodiakPack(bears, sled, dtMs) {
  const out = [];
  for (const k of bears) {
    if (k.done) continue;
    // Busy while another member attacks OR is close enough to need hopping (a tired grizzly just ahead):
    // the player never has to clear two bears at once.
    const busy = bears.some((o) => o !== k && (kodiakThreatening(o) || (!o.done && !o.hit && Math.abs(o.x - sled.x) < KODIAK_CLEAR_PX)));
    out.push({ k, ev: stepKodiak(k, sled, dtMs, busy) });
  }
  return out;
}

/**
 * Tick-exact collision. A sled whose bottom clears the bear's back (8 px of forgiveness) is safe: hopping
 * over a bear is the counter to every attack, and the only way past one on the ground.
 * @param {{x:number,y:number,w:number,h:number}} bearBox
 * @param {{x:number,y:number,w:number,h:number}} sledBox
 */
export function kodiakHits(bearBox, sledBox) {
  return sledBox.x < bearBox.x + bearBox.w && bearBox.x < sledBox.x + sledBox.w &&
    sledBox.y + sledBox.h > bearBox.y + 8 && sledBox.y < bearBox.y + bearBox.h;
}
