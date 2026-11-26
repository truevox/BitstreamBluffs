/**
 * #67: what a postcard says about the moment it starts, read from the AUTHORITATIVE sim state at tick N (a RunScene frozen at
 * takeover READY). NO Phaser imports; a scene is read through its public members only. Pure reads: nothing is changed.
 *
 * The challenge summary is a courtesy (it is shown to the recipient and lets the proof compare both ends); the trust check is
 * the combined fingerprint at N (`liveFingerprint`), which the recipient's re-simulation must reproduce exactly.
 *
 * Units of each field (also enforced by the codec):
 *   speedPxS       sled speed, px/s (Sled.speed = hypot(vx, vy)); 0..1e6
 *   angVel         Matter `body.angularVelocity`, radians per BASE step (1/60 s); display as rad/s with x60
 *   parachuteFuel  Sled.parachuteFuelMs: milliseconds of canopy fuel left (always a number in this build); 0..1e5
 *   hazardPhase    milliseconds until the NEAREST gate hazard at or ahead of the sled next flips open/closed
 *                  (Hazard.gateNextChangeMs at the run's own clock); null when no gate hazard is spawned ahead.
 *                  Only gates have a phase in this build (rolls have a position, not a phase); 0..60000
 *   bsodGapPx      sled left collision edge minus BSOD wall x, px (>= 0 while alive); null when the BSOD is not active
 */
import { captureCausalState } from './fingerprintCapture.js';
import { fingerprintState } from './fingerprint.js';

const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);

/** Same edge RunScene feeds the BSOD pursuit: the sled body's collision bounds, with the RunScene fallback. */
const leftEdge = (sled) => (Number.isFinite(sled?.body?.bounds?.min?.x) ? sled.body.bounds.min.x : sled.x - 20);

/** The phase (ms to next flip) of the nearest live gate hazard at or ahead of the sled, or null. */
function nearestGatePhaseMs(scene) {
  const sx = scene.sled.x;
  let best = null;
  let bestDx = Infinity;
  for (const list of (scene.hazards ? scene.hazards.values() : [])) {
    for (const h of list) {
      if (!h || h.destroyed || h.hit || typeof h.gateNextChangeMs !== 'function') continue;
      const dx = h.cx - sx;
      if (!(dx > -40) || dx >= bestDx) continue;
      const ms = h.gateNextChangeMs(scene.runTimeMs);
      if (!Number.isFinite(ms)) continue;
      bestDx = dx;
      best = ms;
    }
  }
  return best;
}

/**
 * @param {object} scene a RunScene frozen at tick N
 * @returns {{speedPxS:number, angVel:number, parachuteFuel:number|null, hazardPhase:number|null, bsodGapPx:number|null}}
 */
export function readChallenge(scene) {
  const sled = scene.sled;
  const body = sled.body;
  const bsodOn = !!(scene.bsod && scene.bsod.active) && Number.isFinite(scene.bsod.wallX);
  return {
    speedPxS: sled.speed,
    angVel: body.angularVelocity === 0 ? 0 : body.angularVelocity,
    parachuteFuel: num(sled.parachuteFuelMs),
    hazardPhase: nearestGatePhaseMs(scene),
    bsodGapPx: bsodOn ? Math.max(0, leftEdge(sled) - scene.bsod.wallX) : null,
  };
}

/** The game's own combined frame fingerprint at the scene's current tick (what GhostRecorder._fingerprint stores). */
export function liveFingerprint(scene) {
  return fingerprintState(captureCausalState(scene)).combined;
}

const f1 = (v) => (Math.round(v * 10) / 10).toFixed(1);

/** Plain-language lines for the challenge (READY screen, the postcard view). Pure. */
export function describeChallenge(c) {
  const lines = [`SPEED ${Math.round(c.speedPxS)} PX/S`, `SPIN ${f1(c.angVel * 60)} RAD/S`];
  lines.push(c.parachuteFuel === null ? 'PARACHUTE: N/A' : `PARACHUTE FUEL ${f1(c.parachuteFuel / 1000)} S`);
  lines.push(c.hazardPhase === null ? 'NO GATE AHEAD' : `NEXT GATE FLIPS IN ${f1(c.hazardPhase / 1000)} S`);
  lines.push(c.bsodGapPx === null ? 'BSOD: OFF' : `BSOD GAP ${Math.round(c.bsodGapPx)} PX`);
  return lines;
}
