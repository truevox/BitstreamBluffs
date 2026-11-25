/**
 * #72 Replay Takeover (UNRANKED PRACTICE / TAS). NO Phaser imports (pure logic, Jest-first).
 *
 * Design (decided, see CHANGELOG v2.23.0): takeover is authoritative RE-SIMULATION of the tape prefix (ticks 1..N),
 * then a handoff to live input. There is no snapshot format: the real engine re-runs the prefix, so velocity, contacts,
 * hazards, RNG streams, timers, BSOD pursuit, terrain, inventory and equipment are exact by construction.
 *
 * "State at tick N" means: N simulation ticks have been applied (SimClock.tick === N), exactly the state a recorder
 * checkpoint at tick N describes. The first LIVE tick is N + 1.
 *
 * This module holds the pieces that need no scene: eligibility, the descriptor, the live suffix recorder and the bounded
 * seek driver (which only calls two scene methods, so #66 can reuse it to re-simulate candidates off-screen).
 */
import { GHOST_TAPE_FORMAT, CHECKPOINT_EVERY, TRACE_EVERY, GhostRecorder, decodeTrace } from '../ghost/GhostTape.js';
import { tapeCompatible } from '../ghost/GhostLibrary.js';
import { SIM_REVISION } from './ruleset.js';
import { tapeDigest, validateInputRows } from './manifest.js';

export const TAKEOVER_KIND = 'bb-takeover';
export const TAKEOVER_VERSION = 1;
/** Header `mode` of a tape recorded by a takeover. Never stored in GhostLibrary / IDB / localStorage. */
export const TAKEOVER_MODE = 'takeover';
export const OLDER_BUILD_MESSAGE = 'recorded on an older build; not takeover-compatible';

/** Seek metering: at most this many re-simulated ticks, and this much wall time, per display frame. */
export const SEEK_MAX_TICKS_PER_FRAME = 1500;
export const SEEK_BUDGET_MS = 12;

const U32 = 0xffffffff;
const isInt = (v) => typeof v === 'number' && Number.isSafeInteger(v);

/** Every refusal code, with the player-facing message. */
export const REFUSALS = Object.freeze({
  'guest-practice': 'unavailable during guest practice',
  undecodable: 'this tape cannot be decoded',
  mode: 'only normal runs can be taken over (not daily, gym, guest or takeover tapes)',
  'sim-revision': 'recorded on a different simulation revision',
  'older-build': OLDER_BUILD_MESSAGE,
  'ruleset-mismatch': 'recorded on a different ruleset; not takeover-compatible',
  'no-ruleset': 'this build has no ruleset id to compare against',
  course: 'the tape has no seed or biome mask',
  loadout: 'the tape lacks its loadout (boosts, upgrade ranks, sync level)',
  tick: 'that tick is outside the recorded run',
  'prefix-uncovered': 'the tape does not cover the run up to that tick',
});

const refuse = (reason, extra) => ({ ok: false, reason, message: REFUSALS[reason] + (extra ? ` (${extra})` : '') });

/**
 * Can `tape` be taken over at `tick`? Pure. Never throws.
 * @param {object} tape a finished ghost tape (GhostRecorder.finish)
 * @param {number} tick N: the number of ticks to re-simulate before handoff
 * @param {{rulesetId?:string, guestPractice?:boolean}} [ctx] rulesetId = the EXACT id of the running build
 * @returns {{ok:true}|{ok:false, reason:string, message:string}}
 */
export function takeoverEligible(tape, tick, ctx = {}) {
  try {
    if (ctx && ctx.guestPractice) return refuse('guest-practice');
    if (!tape || typeof tape !== 'object' || Array.isArray(tape)) return refuse('undecodable');
    if (tape.format !== GHOST_TAPE_FORMAT || !tapeCompatible(tape)) return refuse('undecodable');
    if (!isInt(tape.endTick) || tape.endTick < 1 || !Array.isArray(tape.inputs) || !Array.isArray(tape.checkpoints)) return refuse('undecodable');
    try { validateInputRows(tape.inputs, tape.endTick); } catch { return refuse('undecodable'); }
    if (tape.mode !== 'normal') return refuse('mode');
    if (tape.simRevision !== SIM_REVISION) return refuse('sim-revision');
    const current = ctx && ctx.rulesetId;
    if (typeof current !== 'string' || !current) return refuse('no-ruleset');
    if (typeof tape.rulesetId !== 'string' || !tape.rulesetId) return refuse('older-build');
    if (tape.rulesetId !== current) return refuse('ruleset-mismatch');
    if (typeof tape.seed !== 'string' || !tape.seed || !isInt(tape.biomeMask) || tape.biomeMask < 0 || tape.biomeMask > U32) return refuse('course');
    if (!Array.isArray(tape.boosts) || !('upgradeRanks' in tape) || !isInt(tape.syncLevel) || tape.syncLevel < 1) return refuse('loadout');
    if (!isInt(tick) || tick < 1 || tick > tape.endTick - 1) return refuse('tick', `1..${tape.endTick - 1}`);
    // Coverage: the prefix must be verifiable. Every 1 s checkpoint up to N must exist, in order, and the first trace
    // samples must exist; otherwise a tampered or truncated tape could not be told apart from a real one.
    const due = Math.floor(tick / CHECKPOINT_EVERY);
    const have = tape.checkpoints.filter((c) => Array.isArray(c) && c[0] <= tick);
    if (have.length !== due || have.some((c, i) => c[0] !== (i + 1) * CHECKPOINT_EVERY)) return refuse('prefix-uncovered', 'checkpoints');
    if (typeof tape.trace !== 'string' || decodeTrace(tape).length < Math.floor(tick / TRACE_EVERY) * 3) return refuse('prefix-uncovered', 'trace');
    return { ok: true };
  } catch {
    return refuse('undecodable');
  }
}

/** Deep, frozen, independent copy of the parts of a tape a takeover needs (no shared mutable state with the parent). */
function frozenTapeCopy(tape) {
  const copy = { ...tape, inputs: tape.inputs.map((r) => Object.freeze([...r])), checkpoints: tape.checkpoints.map((c) => Object.freeze([...c])) };
  for (const k of ['bsod', 'random', 'startPose', 'boosts', 'upgradeRanks']) {
    if (tape[k] && typeof tape[k] === 'object') copy[k] = JSON.parse(JSON.stringify(tape[k]));
  }
  Object.freeze(copy.inputs);
  Object.freeze(copy.checkpoints);
  for (const k of ['bsod', 'random', 'startPose', 'boosts', 'upgradeRanks']) if (copy[k] && typeof copy[k] === 'object') Object.freeze(copy[k]);
  return Object.freeze(copy);
}

/**
 * The one-shot handoff object RunScene reads from REG.TAKEOVER. The caller must have checked takeoverEligible first;
 * RunScene re-validates it anyway (fail closed).
 * @param {{tape:object, tick:number, source?:string}} p
 * @returns {Readonly<{kind:string, v:number, tape:object, tick:number, source:string, parentDigest:string, rulesetId:string, simRevision:number}>}
 */
export function buildTakeoverDescriptor({ tape, tick, source }) {
  if (!tape || typeof tape !== 'object') throw new TypeError('takeover descriptor needs a tape');
  return Object.freeze({
    kind: TAKEOVER_KIND, v: TAKEOVER_VERSION, tape: frozenTapeCopy(tape), tick, source: String(source || 'unknown'),
    parentDigest: tapeDigest(tape), rulesetId: tape.rulesetId, simRevision: tape.simRevision,
  });
}

/**
 * Re-validate a descriptor (RunScene calls this in create(), PauseScene / TakeoverEndView before a retry).
 * Checks the envelope, that the parent digest still matches the tape it carries, and takeoverEligible.
 */
export function validateTakeoverDescriptor(d, ctx = {}) {
  try {
    if (!d || d.kind !== TAKEOVER_KIND || d.v !== TAKEOVER_VERSION || !d.tape) return refuse('undecodable');
    const e = takeoverEligible(d.tape, d.tick, ctx);
    if (!e.ok) return e;
    if (d.rulesetId !== d.tape.rulesetId || d.simRevision !== d.tape.simRevision) return refuse('undecodable', 'descriptor mismatch');
    if (d.parentDigest !== tapeDigest(d.tape)) return refuse('undecodable', 'parent digest mismatch');
    return { ok: true };
  } catch {
    return refuse('undecodable');
  }
}

/** Fields that belong to a finished RESULT, not to the header a recorder is built from. */
const RESULT_KEYS = ['runId', 'distanceM', 'score', 'cause', 'endedAt', 'endTick', 'inputs', 'checkpoints', 'trace'];

/** Parent header plus `{mode:'takeover', parentDigest, takeoverTick}`. */
export function takeoverHeaderOf(d) {
  const header = {};
  for (const k of Object.keys(d.tape)) if (!RESULT_KEYS.includes(k)) header[k] = JSON.parse(JSON.stringify(d.tape[k]));
  return { ...header, mode: TAKEOVER_MODE, parentDigest: d.parentDigest, takeoverTick: d.tick };
}

/**
 * The independent live-suffix recorder: the parent's rows/checkpoints/trace up to tick N are COPIED in (the new tape is a
 * complete, replayable prefix + suffix), then it records live input from tick N + 1. Nothing is shared with the parent.
 * @param {ReturnType<typeof buildTakeoverDescriptor>} d
 * @returns {GhostRecorder}
 */
export function createTakeoverRecorder(d) {
  const rec = new GhostRecorder(takeoverHeaderOf(d));
  const n = d.tick;
  let at = 0;
  for (const row of d.tape.inputs) {
    at += row[0];
    if (at > n) break;
    rec.inputs.push([row[0], row[1], row[2]]);
    rec._lastTick = at;
    rec._last = [row[1], row[2]];
  }
  rec.checkpoints = d.tape.checkpoints.filter((c) => c[0] <= n).map((c) => [...c]);
  const trace = decodeTrace(d.tape);
  rec.trace = Array.from(trace.subarray(0, Math.floor(n / TRACE_EVERY) * 3));
  rec.lastTick = n;
  return rec;
}

/**
 * Bounded seek: advance `scene` by authoritative replay ticks toward `target`, at most `maxTicks` and about `budgetMs`
 * of wall time per call. The scene supplies `stepReplayTick()` (the SAME per-tick body update() runs in replay mode);
 * this driver only meters it and watches for a desync. Any desync at or before N aborts: it never continues.
 * @param {{simClock:{tick:number}, tapePlayer:{desync:object|null}, crashed:boolean, stepReplayTick:()=>void}} scene
 * @param {number} target
 * @param {{maxTicks?:number, budgetMs?:number, now?:()=>number}} [o]
 * @returns {{done:boolean, tick:number, steps:number, desync?:object, crashed?:boolean}}
 */
export function seekStep(scene, target, o = {}) {
  const maxTicks = o.maxTicks ?? 1500;
  const budgetMs = o.budgetMs ?? Infinity;
  const now = o.now || (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const t0 = now();
  let steps = 0;
  while (scene.simClock.tick < target && steps < maxTicks) {
    scene.stepReplayTick();
    steps++;
    if (scene.tapePlayer.desync) return { done: false, tick: scene.simClock.tick, steps, desync: scene.tapePlayer.desync };
    // A fatal crash before N cannot be a faithful prefix of the tape (the tape's own run survived to N).
    if (scene.crashed) return { done: false, tick: scene.simClock.tick, steps, crashed: true };
    if ((steps & 63) === 0 && now() - t0 >= budgetMs) break;
  }
  return { done: scene.simClock.tick >= target, tick: scene.simClock.tick, steps };
}
