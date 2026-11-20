/**
 * OWNER: core-logic engineer. NO Phaser imports.
 *
 * Ghost tapes (issue #56). A tape is the canonical record of one run:
 *  - header: course (seed + biome mask), mode, loadout, initial pose, RNG stream state and
 *    engine versions; anything a replay needs that is not reconstructible from the seed;
 *  - inputs: the normalized pad fed to each fixed simulation tick (#59), stored only on the
 *    ticks where it changes;
 *  - checkpoints: exact sled state about once a second, to detect a replay that desyncs;
 *  - trace: the pose every TRACE_EVERY ticks, which is what a visual ghost draws. Drawing
 *    from the trace means five ghosts never run five live physics simulations.
 * Tapes live beside the RunRecord, never inside it: run-ledger hashes are untouched.
 */
import { SIM_TICK_HZ } from '../SimClock.js';
import { RUN_RANDOM_VERSION } from '../RunRandom.js';

export const GHOST_TAPE_FORMAT = 'bb-ghost-tape';
/** Bump when the header, input bits or trace layout change. */
export const GHOST_TAPE_VERSION = 1;
/** Bump when a physics/tuning change would make old input tapes replay differently. */
export const GHOST_PHYSICS_VERSION = 1;
export const CHECKPOINT_EVERY = 120; // ticks: 1 s at 120 Hz
export const TRACE_EVERY = 4; // ticks: 30 Hz, a whole number of 30/60/120 Hz frames

// Pad fields carried in the input bits, in bit order. Never reorder: append and bump the version.
const BOOL_FIELDS = ['push', 'variableHop', 'noAutoNudge', 'divebomb', 'corkscrew', 'tuck', 'brakeHeld',
  'hop', 'reset', 'airBrake', 'parachute', 'pause'];
const EDGE_FIELDS = ['hop', 'reset', 'pause', 'airBrake', 'parachute', 'confirm'];
const HELI_SHIFT = BOOL_FIELDS.length + EDGE_FIELDS.length; // 2 bits: 0 none, 1 = +1, 2 = -1

/** Identity of a course: the exact seed plus the selected biome mask. */
export function courseKey(seed, biomeMask = 0) {
  return `${String(seed)}|${((Number(biomeMask) || 0) >>> 0).toString(16).padStart(8, '0')}`;
}

/** Analog tilt rounded to 1/127 so it survives storage exactly (keyboard -1/0/1 is unchanged). */
export function quantizeTilt(tilt) {
  const t = Number.isFinite(tilt) ? Math.max(-1, Math.min(1, tilt)) : 0;
  return Math.round(t * 127) / 127;
}

/** Pack a normalized tick pad into [bits, tilt127]. */
export function encodePad(pad) {
  let bits = 0;
  BOOL_FIELDS.forEach((k, i) => { if (pad[k]) bits |= 1 << i; });
  EDGE_FIELDS.forEach((k, i) => { if (pad.pressed?.[k]) bits |= 1 << (BOOL_FIELDS.length + i); });
  if (pad.heli > 0) bits |= 1 << HELI_SHIFT; else if (pad.heli < 0) bits |= 2 << HELI_SHIFT;
  return [bits >>> 0, Math.round(quantizeTilt(pad.tilt) * 127)];
}

/** Inverse of encodePad. `brake` is re-derived per tick by RunScene from brakeHeld/airBrake. */
export function decodePad(bits, tilt127) {
  const pad = { tilt: tilt127 / 127, pressed: {}, lastSource: 'tape' };
  BOOL_FIELDS.forEach((k, i) => { pad[k] = (bits & (1 << i)) !== 0; });
  EDGE_FIELDS.forEach((k, i) => { pad.pressed[k] = (bits & (1 << (BOOL_FIELDS.length + i))) !== 0; });
  const h = (bits >>> HELI_SHIFT) & 3;
  pad.heli = h === 1 ? 1 : h === 2 ? -1 : 0;
  pad.brake = pad.brakeHeld;
  return pad;
}

/** Exact sled state for a checkpoint. Doubles round-trip JSON exactly, so equality is exact. */
export function sledState(scene) {
  const b = scene.sled.body;
  return [b.position.x, b.position.y, b.angle, b.velocity.x, b.velocity.y, b.angularVelocity,
    Math.round(scene.score?.getTotal?.() ?? 0)];
}

function toBase64(bytes) {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromBase64(str) {
  const s = atob(str);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

/** Records one run. RunScene calls input() before and afterTick() after each simulation tick. */
export class GhostRecorder {
  /** @param {object} header everything but versions; see RunScene._ghostHeader() */
  constructor(header) {
    this.header = { format: GHOST_TAPE_FORMAT, version: GHOST_TAPE_VERSION, physicsVersion: GHOST_PHYSICS_VERSION,
      simTickHz: SIM_TICK_HZ, runRandomVersion: RUN_RANDOM_VERSION, ...header };
    this.inputs = []; // [tickDelta, bits, tilt127] on change
    this.checkpoints = []; // [tick, ...sledState]
    this.trace = []; // x, y, angle every TRACE_EVERY ticks from tick TRACE_EVERY
    this._last = null;
    this._lastTick = 0;
    this.lastTick = 0;
  }

  input(tick, pad) {
    const [bits, tilt] = encodePad(pad);
    if (this._last && this._last[0] === bits && this._last[1] === tilt) return;
    this.inputs.push([tick - this._lastTick, bits, tilt]);
    this._lastTick = tick;
    this._last = [bits, tilt];
  }

  afterTick(tick, scene) {
    this.lastTick = tick;
    if (tick % TRACE_EVERY === 0) {
      const b = scene.sled.body;
      this.trace.push(b.position.x, b.position.y, b.angle);
    }
    if (tick % CHECKPOINT_EVERY === 0) this.checkpoints.push([tick, ...sledState(scene)]);
  }

  /** @param {{runId:string, distanceM:number, score:number, cause?:string, endedAt?:number}} result */
  finish(result) {
    return {
      ...this.header,
      runId: result.runId, distanceM: result.distanceM, score: result.score, cause: result.cause || 'crash',
      endedAt: result.endedAt ?? Date.now(), endTick: this.lastTick,
      inputs: this.inputs, checkpoints: this.checkpoints,
      trace: toBase64(new Uint8Array(new Float32Array(this.trace).buffer)),
    };
  }
}

/** Float32 [x, y, angle, ...] of a finished tape. */
export function decodeTrace(tape) {
  try {
    const bytes = fromBase64(tape.trace || '');
    return new Float32Array(bytes.buffer, bytes.byteOffset, Math.floor(bytes.length / 4));
  } catch { return new Float32Array(0); }
}

/** Pose at simulation tick `tick` (interpolated between trace samples), or null past the run's end. */
export function tracePose(trace, tick) {
  const n = Math.floor(trace.length / 3);
  if (!n || !(tick >= 0)) return null;
  const f = tick / TRACE_EVERY - 1; // sample i holds tick (i + 1) * TRACE_EVERY
  if (f > n - 1) return null;
  const i = Math.max(0, Math.floor(f)), j = Math.min(n - 1, i + 1), u = Math.max(0, Math.min(1, f - i));
  let da = trace[j * 3 + 2] - trace[i * 3 + 2];
  if (da > Math.PI) da -= 2 * Math.PI; else if (da < -Math.PI) da += 2 * Math.PI;
  return { x: trace[i * 3] + (trace[j * 3] - trace[i * 3]) * u, y: trace[i * 3 + 1] + (trace[j * 3 + 1] - trace[i * 3 + 1]) * u,
    angle: trace[i * 3 + 2] + da * u };
}

/**
 * Feeds a tape's inputs back, tick by tick, and checks its checkpoints. Replaces live input
 * in RunScene for replay verification (and, later, a replay viewer).
 */
export class TapePlayer {
  constructor(tape) {
    this.tape = tape;
    this._i = 0;
    this._nextAt = tape.inputs.length ? tape.inputs[0][0] : Infinity;
    this._pad = decodePad(0, 0);
    this._changeTick = -1;
    this._cp = 0;
    /** First failing checkpoint, or null while the replay matches. */
    this.desync = null;
    this.checked = 0;
  }

  /** Pad for simulation tick `tick` (ticks must be requested in increasing order). */
  padAt(tick) {
    const rows = this.tape.inputs;
    while (this._i < rows.length && tick >= this._nextAt) {
      this._pad = decodePad(rows[this._i][1], rows[this._i][2]);
      this._changeTick = this._nextAt;
      this._i++;
      this._nextAt = this._i < rows.length ? this._nextAt + rows[this._i][0] : Infinity;
    }
    // A one-shot edge belongs to exactly the tick it was recorded on.
    return this._changeTick === tick ? this._pad : { ...this._pad, pressed: {} };
  }

  /** Compare the live sled against a checkpoint recorded at this tick. */
  check(tick, scene) {
    const cps = this.tape.checkpoints;
    while (this._cp < cps.length && cps[this._cp][0] < tick) this._cp++;
    if (this._cp >= cps.length || cps[this._cp][0] !== tick) return;
    const want = cps[this._cp].slice(1), got = sledState(scene);
    this.checked++;
    if (!this.desync && want.some((v, k) => v !== got[k])) this.desync = { tick, want, got };
  }
}
