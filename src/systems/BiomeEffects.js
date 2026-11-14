/**
 * OWNER: gameplay engineer. Phaser-free and pure (no Math.random, no Date): unit-tested in tests/src/biome-effects.test.js.
 *
 * The math of the biome full-treatment effects (B0, spec §5 / §6 "test seam for the sled"). RunScene, PhysicsTuner,
 * Hazard and PowerUp only CALL these, so every number a biome hazard or power-up can put on the sled is unit-tested here,
 * and the built-game gate (tools/sim/gate-playthrough.mjs) proves the calls are wired.
 *
 * Hazard onHit effects added: `blind` {durationMs?, visibility?} (a dimming overlay, never below 35 % visibility) and
 * `gust` {impulsePxS:[x,y]} (one velocity kick, at most 180 px/s). Power-up kinds added: `ward` (Wards.js), `glide`
 * {frictionMul, durationMs} and `stabilize` {landingToleranceDeg, bounceMul?, durationMs}.
 */
import { PHYSICS } from '../constants.js';
import { classifyLanding } from './TrickTracker.js';
import { TUNING } from './PhysicsTuner.js';

const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);

// ------------------------------------------------------------------------------------------------ gust

/** Spec §4: a gust impulse is at most 180 px/s. */
export const GUST_MAX_PX_S = 180;

/**
 * One bounded velocity kick from a `gust` hazard. The vector keeps its direction and is scaled down to GUST_MAX_PX_S when
 * longer. World axes, px/s, y down (negative y = up).
 * @param {[number, number]} impulsePxS
 * @returns {{dvx:number, dvy:number}}
 */
export function gustImpulse(impulsePxS) {
  if (!Array.isArray(impulsePxS)) return { dvx: 0, dvy: 0 };
  const x = Number.isFinite(impulsePxS[0]) ? impulsePxS[0] : 0;
  const y = Number.isFinite(impulsePxS[1]) ? impulsePxS[1] : 0;
  const m = Math.hypot(x, y);
  const k = m > GUST_MAX_PX_S ? GUST_MAX_PX_S / m : 1;
  return { dvx: x * k, dvy: y * k };
}

// ------------------------------------------------------------------------------------------------ blind

/** Spec §4: `blind` never fully hides the terrain line: at least 35 % visibility. */
export const BLIND_MIN_VISIBILITY = 0.35;
/** Duration of a `blind` hit whose def gives none (spec §4 table: 1.2 s). */
export const BLIND_DEFAULT_MS = 1200;
/** Visibility of a `blind` hit whose def gives none. */
export const BLIND_DEFAULT_VISIBILITY = 0.4;
/** Fade-in and fade-out of the dimming overlay (ms). */
export const BLIND_FADE_IN_MS = 90;
export const BLIND_FADE_OUT_MS = 300;

/** Visibility of a blind hit, clamped to [BLIND_MIN_VISIBILITY, 1]. @param {number} v @returns {number} */
export function blindVisibility(v) {
  return clamp(Number.isFinite(v) ? v : BLIND_DEFAULT_VISIBILITY, BLIND_MIN_VISIBILITY, 1);
}

/**
 * Alpha of the dimming overlay with `msLeft` of a `totalMs` blind left. A pure function of time (never of the seed or a
 * random number): a short fade in, full dim, then a fade out. Always within [0, 1 - BLIND_MIN_VISIBILITY].
 * @param {number} msLeft
 * @param {number} totalMs
 * @param {number} visibility raw def value (clamped here).
 * @returns {number}
 */
export function blindOverlayAlpha(msLeft, totalMs, visibility) {
  if (!(msLeft > 0)) return 0;
  const full = 1 - blindVisibility(visibility);
  const elapsed = Math.max(0, (Number.isFinite(totalMs) ? totalMs : 0) - msLeft);
  const k = Math.min(1, elapsed / BLIND_FADE_IN_MS, msLeft / BLIND_FADE_OUT_MS);
  return clamp(full * Math.max(0, k), 0, 1 - BLIND_MIN_VISIBILITY);
}

// ------------------------------------------------------------------------------------------------ glide / stabilize

/** Floor of a glide's friction multiplier (a glide lowers friction; it never removes it). */
export const GLIDE_MIN_FRICTION_MUL = 0.2;
/** Default glide multiplier (spec §4 table: ground friction x0.7). */
export const GLIDE_DEFAULT_FRICTION_MUL = 0.7;

/** A glide's ground-friction multiplier, clamped to [GLIDE_MIN_FRICTION_MUL, 1]. @param {number} m @returns {number} */
export function glideFrictionMul(m) {
  return clamp(Number.isFinite(m) ? m : GLIDE_DEFAULT_FRICTION_MUL, GLIDE_MIN_FRICTION_MUL, 1);
}

/** Largest landing tolerance a stabilize may add (deg). */
export const STABILIZE_MAX_DEG = 30;

/** Extra landing tolerance of a stabilize, clamped to [0, STABILIZE_MAX_DEG]. @param {number} d @returns {number} */
export function stabilizeToleranceDeg(d) {
  return clamp(Number.isFinite(d) ? d : 0, 0, STABILIZE_MAX_DEG);
}

/** A stabilize's optional bounce multiplier (1 when absent), clamped to [0.1, 1]. @param {number} m @returns {number} */
export function stabilizeBounceMul(m) {
  return clamp(Number.isFinite(m) ? m : 1, 0.1, 1);
}

const RANK = { crash: 0, sloppy: 1, good: 2, perfect: 3 };

/**
 * Final grade of a landing, as RunScene uses it. With `toleranceDeg` 0 this is exactly the original forgiveness rule
 * (a crash grade up to TUNING.forgiveAngleDeg and under TUNING.forgiveImpactPxS becomes a sloppy wobble). A stabilize adds
 * `toleranceDeg`: the landing is re-graded with its angle reduced by the tolerance (TrickTracker's own classifyLanding,
 * never worse than the original grade) and the forgiveness angle grows by the same amount. Impact limits never move.
 * @param {{quality:string, angleDeg?:number, impactSpeedPxS?:number}} landing
 * @param {number} toleranceDeg
 * @param {{forgiveAngleDeg:number, forgiveImpactPxS:number}} [t] defaults to PhysicsTuner TUNING.
 * @returns {Object} the landing (same object when nothing changed, else a copy with a new quality).
 */
export function resolveLanding(landing, toleranceDeg, t = TUNING) {
  let l = landing;
  const tol = stabilizeToleranceDeg(toleranceDeg);
  const angle = Math.abs(l.angleDeg || 0);
  const impact = l.impactSpeedPxS || 0;
  if (tol > 0) {
    const q = classifyLanding(Math.max(0, angle - tol), impact, false).quality;
    if (RANK[q] > (RANK[l.quality] == null ? 3 : RANK[l.quality])) l = { ...l, quality: q };
  }
  if (l.quality === 'crash' && angle <= t.forgiveAngleDeg + tol && impact < t.forgiveImpactPxS) l = { ...l, quality: 'sloppy' };
  return l;
}

// ------------------------------------------------------------------------------------------------ durations

/**
 * How long a hazard effect lasts (ms), as RunScene applies it and HAZARD_HIT reports it. Base effects are unchanged
 * (crash 0, slow def or 1500, scramble def or PHYSICS.scrambleDurationMs); gust is an instant kick (0); blind defaults to
 * BLIND_DEFAULT_MS.
 * @param {{effect?:string, durationMs?:number}} onHit
 * @returns {number}
 */
export function hazardEffectDurationMs(onHit) {
  const e = onHit || {};
  const kind = e.effect || 'crash';
  if (kind === 'crash' || kind === 'gust') return 0;
  if (e.durationMs != null) return e.durationMs;
  if (kind === 'scramble') return PHYSICS.scrambleDurationMs;
  if (kind === 'blind') return BLIND_DEFAULT_MS;
  return 1500;
}

/** Defaults for the timed power-up kinds B0 adds (spec §4 table). */
export const TIMED_POWERUP_DEFAULT_MS = Object.freeze({ glide: 4000, stabilize: 5000 });

/** Duration of a glide / stabilize pickup (ms). @param {{kind:string, durationMs?:number}} effect @returns {number} */
export function timedPowerupMs(effect) {
  const e = effect || {};
  if (Number.isFinite(e.durationMs) && e.durationMs > 0) return e.durationMs;
  return TIMED_POWERUP_DEFAULT_MS[e.kind] || 3000;
}

// ------------------------------------------------------------------------------------------------ drawing choices

/**
 * Palette key a hazard is drawn in. Spec §4: `danger` is the colour of every BIOME crash hazard, whatever its JSON says.
 * Base defs keep their own colorKey (glitchChasm is a magenta crash hazard and stays so).
 * @param {{biome?:string, onHit?:{effect?:string}, colorKey?:string}} def
 * @returns {string}
 */
export function hazardColorKey(def) {
  const crash = !def.onHit || !def.onHit.effect || def.onHit.effect === 'crash';
  if (def.biome && crash) return 'danger';
  return def.colorKey || 'danger';
}

/** Hazard shapeKeys with their own drawing routine in entities/Hazard.js. */
export const HAZARD_SHAPES = Object.freeze(['chasm', 'firewall', 'spike', 'vent', 'drone']);
/** Power-up shapeKeys with their own glyph in entities/PowerUp.js. */
export const POWERUP_SHAPES = Object.freeze(['clock', 'burst', 'shield']);

/** Drawing routine for a hazard: its shapeKey when Hazard.js knows it, else 'generic' (a visible filled box). */
export function hazardDrawKind(def) {
  return HAZARD_SHAPES.includes(def && def.shapeKey) ? def.shapeKey : 'generic';
}

/** Glyph for a power-up: its shapeKey when PowerUp.js knows it, else 'generic' (a visible diamond). */
export function powerupDrawKind(def) {
  return POWERUP_SHAPES.includes(def && def.shapeKey) ? def.shapeKey : 'generic';
}
