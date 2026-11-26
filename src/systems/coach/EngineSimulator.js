/**
 * #66 Crash Coach: the REAL simulator behind runCoach's injected `simulate(tape, {untilTick, ...})`. No Phaser import: the
 * engine is a RunScene in coach-sim mode (RunScene.create with scene data {coachSim}), reached through a small `host`:
 *
 *   host.acquire(tape) -> Promise<scene>   a FRESH RunScene at tick 0 that replays `tape` hidden, silent and unranked
 *   host.frame()       -> Promise<void>    let the page breathe (one display frame); the simulation is time-sliced
 *   host.release?(scene)                   optional cleanup
 *
 * Every simulation re-runs from tick 0: there is no snapshot or fork (a deliberate non-goal), so the cost of one candidate
 * is the cost of replaying the whole run up to crashTick + margin. The prefix up to the branch tick is VERIFIED against the
 * checkpoints and pose trace the candidate tape still carries (Perturb.applyCandidate keeps exactly those), so an engine that
 * does not reproduce the original run fails loudly (`desync`) instead of producing a wrong "survived".
 *
 * Pads past the tape's last row hold the last pad (TapePlayer.padAt), so "survived" assumes the player keeps their last
 * input after the original crash moment.
 */
import { captureCausalState } from '../replay/fingerprintCapture.js';
import { fingerprintState } from '../replay/fingerprint.js';
import { traceOf } from '../replay/Takeover.js';
import { TRACE_EVERY } from '../ghost/GhostTape.js';

/** Wall time one slice of simulation may take before the page gets a frame back (the coach should not freeze the screen). */
export const SLICE_MS = 20;
export const SLICE_MAX_TICKS = 4000;
/** The sled counts as having diverged from the reference run when its pose differs by more than this many px. */
export const DIVERGE_PX = 2;

export class CoachCancelled extends Error {
  constructor() { super('coach search cancelled'); this.name = 'CoachCancelled'; }
}

/** The game's own combined 13-channel frame fingerprint of a live scene. */
export const sceneFingerprint = (scene) => fingerprintState(captureCausalState(scene)).combined;

const isInt = (v) => typeof v === 'number' && Number.isSafeInteger(v);

/**
 * @param {{host:{acquire:function, frame:function, release?:function}, sliceMs?:number, sliceMaxTicks?:number,
 *   isCancelled?:()=>boolean, fingerprint?:(scene:object)=>string, onSlice?:(info:{tick:number})=>void}} o
 * @returns {(tape:object, o:{untilTick:number, branchTick?:number, crashTick?:number, referenceTape?:object}) => Promise<object>}
 */
export function createEngineSimulator({ host, sliceMs = SLICE_MS, sliceMaxTicks = SLICE_MAX_TICKS, isCancelled = () => false, fingerprint = sceneFingerprint, onSlice = null }) {
  if (!host || typeof host.acquire !== 'function' || typeof host.frame !== 'function') throw new TypeError('createEngineSimulator needs a host with acquire() and frame()');
  return async function simulate(tape, { untilTick, branchTick = null, crashTick = null, referenceTape = null } = {}) {
    if (!isInt(untilTick) || untilTick < 1) throw new TypeError('simulate needs an integer untilTick >= 1');
    if (isCancelled()) throw new CoachCancelled();
    const scene = await host.acquire(tape);
    try {
      if (!scene || (scene.coachSim && scene.coachSim.refused)) {
        const why = scene && scene.coachSim && scene.coachSim.refused;
        throw new Error(`the engine refused this tape${why ? ` (${why.reason})` : ''}`);
      }
      const ref = referenceTape ? traceOf(referenceTape) : null;
      let divergenceAt = null;
      const xy = [];
      const from = isInt(branchTick) ? branchTick : 0;
      const onTick = (sc) => {
        const tick = sc.simClock.tick;
        if (tick % TRACE_EVERY !== 0 || tick < from) return;
        const b = sc.sled.body;
        xy.push(b.position.x, b.position.y);
        if (ref && divergenceAt === null) {
          const i = (tick / TRACE_EVERY - 1) * 3;
          if (i + 1 < ref.length && Math.hypot(Math.fround(b.position.x) - ref[i], Math.fround(b.position.y) - ref[i + 1]) > DIVERGE_PX) divergenceAt = tick;
        }
      };
      const marks = [...new Set([branchTick, crashTick, untilTick].filter((t) => isInt(t) && t >= 1 && t <= untilTick))].sort((a, b) => a - b);
      const fingerprintAt = {};
      let crashed = null;
      for (const mark of marks) {
        for (;;) {
          if (isCancelled()) throw new CoachCancelled();
          const r = scene.seekTo(mark, { maxTicks: sliceMaxTicks, budgetMs: sliceMs, stopOnCrash: true, onTick });
          if (r.desync) throw new Error(`desync at tick ${r.desync.tick} (${r.desync.via === 'trace' ? 'pose' : 'checkpoint'}): the engine did not reproduce the tape's prefix`);
          if (onSlice) onSlice({ tick: scene.simClock.tick });
          if (r.crashed) { crashed = r; break; }
          if (r.done) break;
          await host.frame();
        }
        fingerprintAt[scene.simClock.tick] = fingerprint(scene);
        if (crashed) break;
      }
      const lastTick = scene.simClock.tick;
      return {
        survived: !crashed && lastTick >= untilTick,
        crashTick: crashed ? crashed.crashTick : null,
        cause: crashed ? crashed.cause : null,
        hazardId: crashed ? crashed.hazardId : null,
        fingerprintAt,
        divergenceAt,
        ticks: lastTick,
        poseTrace: { fromTick: Math.ceil(from / TRACE_EVERY) * TRACE_EVERY, every: TRACE_EVERY, xy },
      };
    } finally {
      try { if (host.release) host.release(scene); } catch (e) { /* cleanup must never mask a result */ }
    }
  };
}
