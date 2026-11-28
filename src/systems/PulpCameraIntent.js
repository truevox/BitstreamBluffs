/**
 * #155 Pulp 2D Drone Cam: presentation-only, deterministic camera INTENT.
 * No Phaser, registry, audio, RNG stream, world writes, or previous-frame state.
 * A future Three.js renderer may use focus/lookAhead/zoom/roll/yaw/elevation;
 * Phaser 2D consumes only focus, zoom, roll. At equal tick/seed/sled state,
 * display refresh rate and camera implementation cannot affect the result.
 */
import {GAME_WIDTH,GAME_HEIGHT} from '../constants.js';
import {speedZoom,ZOOM_FLOOR} from './CameraZoom.js';

export const PULP_LEVELS=Object.freeze(['less','original','drone']);
export const PULP_DEFAULT='original';
export const PULP_SAFE=Object.freeze({
  minScreenX:94,maxScreenX:202,minScreenY:56,maxScreenY:206,
  minDownhillLookAheadPx:250,maxRollRad:0.025,
});

const clamp=(v,lo,hi)=>Math.min(hi,Math.max(lo,v));
const finite=(v,alt=0)=>Number.isFinite(v)?v:alt;
const smooth=(t)=>{const u=clamp(t,0,1);return u*u*(3-2*u);};

export function sanitizePulpLevel(v){return PULP_LEVELS.includes(v)?v:PULP_DEFAULT;}
export function effectivePulpLevel(value,reducedMotion=false){
  return reducedMotion?'less':sanitizePulpLevel(value);
}

/** Stable visual phase from a seed; independent of every simulation RNG. */
function seededPhase(seed){
  let h=2166136261;
  for(const c of String(seed??'default')){
    h=Math.imul(h^c.codePointAt(0),16777619)>>>0;
  }
  return (h/4294967296)*Math.PI*2;
}

/**
 * @param {{seed?:string,tick:number,tickMs?:number,x:number,y:number,vx?:number,vy?:number,
 *   speed?:number,grounded?:boolean,bsodProximity?:number,hazardAheadPx?:number}} state
 * @returns {{focusX:number,focusY:number,lookAhead:number,zoom:number,roll:number,
 *   yaw:number,elevation:number,riderScreenX:number,riderScreenY:number,mode:string}}
 */
export function droneCameraIntent(state){
  const tick=Math.max(0,Math.floor(finite(state.tick)));
  const t=tick*clamp(finite(state.tickMs,1000/120),1,100)/1000;
  const x=finite(state.x),y=finite(state.y);
  const speed=clamp(Math.abs(finite(state.speed,Math.hypot(finite(state.vx),finite(state.vy)))),0,2000);
  const energy=smooth((speed-110)/1000);
  const hazard=finite(state.hazardAheadPx,Infinity);
  const hazardRisk=Number.isFinite(hazard)?1-smooth(hazard/210):0;
  const danger=Math.max(clamp(finite(state.bsodProximity),0,1),hazardRisk);
  const phase=seededPhase(state.seed);
  const driftPeriod=.57+.19*energy;
  const primary=Math.sin(t*driftPeriod+phase);
  // A secondary subharmonic gives gentler, non-metronomic reversals with a
  // subtle overshoot, while still depending on one absolute simulation tick.
  const secondary=.13*Math.sin(t*driftPeriod*1.9+phase*.71);
  const airborne=state.grounded===false?1.18:1;
  const baseAmplitude=(22+17*energy)*airborne;
  const amplitude=baseAmplitude*(1-.72*danger);
  const calmRiderX=clamp(142+baseAmplitude*(primary+secondary),110,185);
  // Damping a leftward strafe would otherwise move the rider RIGHT and
  // paradoxically expose LESS terrain ahead at high danger. Cap by the
  // calm framing so closer hazards/BSOD can never decrease look-ahead.
  const riderScreenX=Math.min(calmRiderX,
    clamp(142+amplitude*(primary+secondary)-12*danger,110,185));
  const riderScreenY=clamp(126+12*Math.sin(t*.31+phase*.53)
    -clamp(finite(state.vy)*.018,-15,19),82,176);
  const zoom=clamp(speedZoom(speed)*(1+.018*Math.sin(t*.44+phase*.43)),ZOOM_FLOOR,1.04);
  const roll=clamp(.018*(1-.75*danger)*Math.sin(t*.72+phase+.5),
    -PULP_SAFE.maxRollRad,PULP_SAFE.maxRollRad);
  // focus is the world centre, not raw Phaser scroll. This conversion is
  // renderer-independent; 2D applies scroll=focus-halfCanvas while 3D can
  // use the same focus point and a different projection.
  const focusX=x+(GAME_WIDTH/2-riderScreenX)/zoom;
  const focusY=y+(GAME_HEIGHT/2-riderScreenY)/zoom;
  // Conservative world-space downhill view bound also accounts for the
  // camera's roll. Never confuse this rendered horizon with hazard timing.
  const lookAhead=(GAME_WIDTH-riderScreenX-
    Math.abs(Math.sin(roll))*GAME_HEIGHT)/zoom;
  return Object.freeze({mode:'drone',focusX,focusY,lookAhead,zoom,roll,
    yaw:0,elevation:0,riderScreenX,riderScreenY});
}
