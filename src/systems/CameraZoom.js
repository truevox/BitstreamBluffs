/**
 * OWNER: gameplay (readable-chaos pass). The speed -> camera zoom curve, pure (no Phaser). RunScene.updateCamera eases
 * toward speedZoom(sled.speed), steps the result to 0.005 and clamps it at ZOOM_FLOOR. Camera only: nothing in physics,
 * terrain, score or the record reads the zoom.
 *
 * Stage 1 is the original curve and still comes from TUNING (1.0 below zoomSpeedLo -> zoomMin 0.82 at zoomSpeedHi 600).
 * v2.6.0 had one more stage, 0.62 at 1200 px/s. Marvin's ruling for this pass: at high speed the camera must pull out
 * noticeably farther. So stage 2 now reaches 0.56 already at 1000 px/s and a third stage carries on to 0.47 at 1400.
 * World px visible ahead of the rider is (GAME_WIDTH - riderScreenX) / zoom, so 0.62 -> 0.51 at 1200 px/s is +21 %.
 *
 * Legibility at the floor: a 20 px Packet Spike is 9.2 game px (18 screen px at the 2x canvas), the 64 px Glitch Chasm
 * 29 game px. The ground-hazard telegraph (HazardTelegraph.js) is drawn at a constant screen size, so the hazard is
 * announced at full size however far out the camera is.
 */
import { TUNING } from './PhysicsTuner.js';
import { GAME_WIDTH } from '../constants.js';

/** Stages after TUNING's: the zoom keeps easing (smoothstep) from the previous stage's end to `zoom` at `speedHi` px/s. */
export const ZOOM_STAGES = Object.freeze([
  Object.freeze({ speedHi: 1000, zoom: 0.56 }),
  Object.freeze({ speedHi: 1400, zoom: 0.47 }),
]);
/** Hard lower clamp for the camera zoom (boost kicks included). Was 0.6. */
export const ZOOM_FLOOR = 0.45;

const smooth01 = (t) => { const c = t < 0 ? 0 : t > 1 ? 1 : t; return c * c * (3 - 2 * c); };

/**
 * Target camera zoom for a sled speed.
 * @param {number} speedPxS
 * @param {{zoomMin:number, zoomSpeedLo:number, zoomSpeedHi:number}} [t] stage 1 (default TUNING).
 * @returns {number} 1 at rest, falling monotonically to the last stage's zoom.
 */
export function speedZoom(speedPxS, t = TUNING) {
  const v = Number.isFinite(speedPxS) ? speedPxS : 0;
  let z = 1 - (1 - t.zoomMin) * smooth01((v - t.zoomSpeedLo) / (t.zoomSpeedHi - t.zoomSpeedLo));
  let fromSpeed = t.zoomSpeedHi;
  let fromZoom = t.zoomMin;
  for (const st of ZOOM_STAGES) {
    z -= (fromZoom - st.zoom) * smooth01((v - fromSpeed) / (st.speedHi - fromSpeed));
    fromSpeed = st.speedHi;
    fromZoom = st.zoom;
  }
  return z;
}

/**
 * World px visible ahead of the rider (the zoom pivots so the rider keeps its screen x).
 * @param {number} zoom
 * @param {number} riderScreenX game px from the left edge.
 * @returns {number}
 */
export function aheadPx(zoom, riderScreenX) {
  return (GAME_WIDTH - riderScreenX) / zoom;
}
