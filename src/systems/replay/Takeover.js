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
import { tapeDigest, validateInputRows, resolveReplaySetup } from './manifest.js';

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
const traceCache = new WeakMap();
/** Decoded float32 pose trace of a tape, cached per tape object (the seek verifies against it every 4 ticks). */
export function traceOf(tape) {
  let t = traceCache.get(tape);
  if (!t) { t = decodeTrace(tape); traceCache.set(tape, t); }
  return t;
}

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
  coverage: 'fingerprint-only coverage is only for a postcard with a valid expected fingerprint',
  fingerprint: "this postcard isn't reproducible on this build",
});

/** #67: a postcard carries no checkpoints / trace; its prefix is authenticated by the combined fingerprint at tick N alone. */
export const COVERAGE_FINGERPRINT_ONLY = 'fingerprint-only';
export const POSTCARD_SOURCE = 'postcard';
const FP_ID = /^xxh32x2:[0-9a-f]{16}$/;

const refuse = (reason, extra) => ({ ok: false, reason, message: REFUSALS[reason] + (extra ? ` (${extra})` : '') });

/**
 * Can `tape` be taken over at `tick`? Pure. Never throws.
 * @param {object} tape a finished ghost tape (GhostRecorder.finish)
 * @param {number} tick N: the number of ticks to re-simulate before handoff
 * @param {{rulesetId?:string, guestPractice?:boolean, coverage?:'fingerprint-only', source?:string, expectedFingerprint?:string}} [ctx]
 *   rulesetId = the EXACT id of the running build. `coverage:'fingerprint-only'` (#67) skips the checkpoint / trace coverage test and
 *   is accepted ONLY with `source:'postcard'` AND a well-formed `expectedFingerprint`; anything else is refused as `coverage`.
 * @returns {{ok:true}|{ok:false, reason:string, message:string}}
 */
export function takeoverEligible(tape, tick, ctx = {}) {
  try {
    if (ctx && ctx.guestPractice) return refuse('guest-practice');
    const fpOnly = !!(ctx && ctx.coverage !== undefined && ctx.coverage !== null);
    if (fpOnly && !(ctx.coverage === COVERAGE_FINGERPRINT_ONLY && ctx.source === POSTCARD_SOURCE && typeof ctx.expectedFingerprint === 'string' && FP_ID.test(ctx.expectedFingerprint))) return refuse('coverage');
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
    // RunScene resolves the daily rule / sync level / kodiak / magnet settings from the tape in create(); an unknown rule id
    // THROWS there, which would be a black screen. Refuse it here, where it ends at the title with a reason.
    try { resolveReplaySetup(tape, {}); } catch { return refuse('undecodable', 'unusable replay setup'); }
    if (typeof tape.seed !== 'string' || !tape.seed || !isInt(tape.biomeMask) || tape.biomeMask < 0 || tape.biomeMask > U32) return refuse('course');
    if (!Array.isArray(tape.boosts) || !('upgradeRanks' in tape) || !isInt(tape.syncLevel) || tape.syncLevel < 1) return refuse('loadout');
    if (!isInt(tick) || tick < 1 || tick > tape.endTick - 1) return refuse('tick', `1..${tape.endTick - 1}`);
    if (fpOnly) return { ok: true }; // the combined fingerprint at N is checked by the seek (RunScene), and is the authority
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
 * @param {{tape:object, tick:number, source?:string, coverage?:string, expectedFingerprint?:string,
 *   postcard?:{digest:string, windowTicks:number, challenge?:object}}} p `coverage`, `expectedFingerprint` and `postcard` are #67
 *   postcard fields; they are added only when given, so an ordinary descriptor is unchanged
 * @returns {Readonly<{kind:string, v:number, tape:object, tick:number, source:string, parentDigest:string, rulesetId:string, simRevision:number}>}
 */
export function buildTakeoverDescriptor({ tape, tick, source, coverage, expectedFingerprint, postcard }) {
  if (!tape || typeof tape !== 'object') throw new TypeError('takeover descriptor needs a tape');
  const d = {
    kind: TAKEOVER_KIND, v: TAKEOVER_VERSION, tape: frozenTapeCopy(tape), tick, source: String(source || 'unknown'),
    parentDigest: tapeDigest(tape), rulesetId: tape.rulesetId, simRevision: tape.simRevision,
  };
  if (coverage !== undefined) d.coverage = coverage;
  if (expectedFingerprint !== undefined) d.expectedFingerprint = expectedFingerprint;
  if (postcard) d.postcard = Object.freeze({ digest: postcard.digest, windowTicks: postcard.windowTicks, ...(postcard.challenge ? { challenge: Object.freeze({ ...postcard.challenge }) } : {}) });
  return Object.freeze(d);
}

/** The postcard coverage ctx a descriptor implies (so the eligibility rule judges the descriptor's own claims). */
const coverageCtx = (d) => (d.coverage !== undefined || d.expectedFingerprint !== undefined
  ? { coverage: d.coverage ?? null, source: d.source, expectedFingerprint: d.expectedFingerprint } : {});

/**
 * Re-validate a descriptor (RunScene calls this in create(), PauseScene / TakeoverEndView before a retry).
 * Checks the envelope, that the parent digest still matches the tape it carries, and takeoverEligible.
 */
export function validateTakeoverDescriptor(d, ctx = {}) {
  try {
    if (!d || d.kind !== TAKEOVER_KIND || d.v !== TAKEOVER_VERSION || !d.tape) return refuse('undecodable');
    if (d.source === POSTCARD_SOURCE && !(d.postcard && isInt(d.postcard.windowTicks))) return refuse('coverage');
    const e = takeoverEligible(d.tape, d.tick, { ...ctx, ...coverageCtx(d) });
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
 * @param {{simClock:{tick:number}, tapePlayer:{desync:object|null}, crashed:boolean, stepReplayTick:(o?:object)=>void}} scene
 * @param {number} target
 * @param {{maxTicks?:number, budgetMs?:number, now?:()=>number, verify?:boolean, stopOnCrash?:boolean, onTick?:(scene:object)=>void}} [o]
 *   stopOnCrash (#66): a crash ends the seek as a RESULT `{done:true, crashed:true, crashTick, cause, hazardId}` instead of an abort;
 *   onTick is called after every step. verify:false skips the checkpoint and
 *   pose-trace checks (a candidate tape whose checkpoints / trace end before the target); the default verifies up to the last
 *   checkpoint / trace sample the tape has
 * @returns {{done:boolean, tick:number, steps:number, desync?:object, crashed?:boolean, crashTick?:number, cause?:string|null, hazardId?:string|null}}
 */
export function seekStep(scene, target, o = {}) {
  const maxTicks = o.maxTicks ?? SEEK_MAX_TICKS_PER_FRAME;
  const budgetMs = o.budgetMs ?? Infinity;
  const now = o.now || (() => (typeof performance !== 'undefined' ? performance.now() : Date.now()));
  const t0 = now();
  let steps = 0;
  while (scene.simClock.tick < target && steps < maxTicks) {
    scene.stepReplayTick(o);
    steps++;
    if (o.onTick) o.onTick(scene);
    if (scene.tapePlayer.desync) return { done: false, tick: scene.simClock.tick, steps, desync: scene.tapePlayer.desync };
    // #66: the Crash Coach re-simulates a candidate and WANTS to know when and why it crashed: that is a result, not an abort.
    if (scene.crashed && o.stopOnCrash) {
      const info = scene.crashInfo || {};
      return { done: true, tick: scene.simClock.tick, steps, crashed: true, crashTick: scene.simClock.tick, cause: info.cause ?? null, hazardId: info.hazardId ?? null };
    }
    // A fatal crash before N cannot be a faithful prefix of the tape (the tape's own run survived to N).
    if (scene.crashed) return { done: false, tick: scene.simClock.tick, steps, crashed: true };
    if ((steps & 63) === 0 && now() - t0 >= budgetMs) break;
  }
  return { done: scene.simClock.tick >= target, tick: scene.simClock.tick, steps };
}

/** `M:SS.s` of a tick at the fixed 120 Hz rate (display only). */
export function fmtTickTime(tick) {
  const s = Math.max(0, tick) / 120;
  const m = Math.floor(s / 60);
  const r = s - m * 60;
  return `${m}:${r < 10 ? '0' : ''}${r.toFixed(1)}`;
}

/**
 * A fresh descriptor for "retry from the same tick": rebuilt from the parent tape and RE-VALIDATED (every retry is an
 * independent attempt, and a tape that stopped being compatible refuses instead of being replayed anyway).
 * @param {{tape:object, tick:number, source?:string}} d the descriptor of the attempt that just ended
 * @param {{rulesetId?:string}} ctx
 * @returns {{ok:true, descriptor:object}|{ok:false, reason:string, message:string}}
 */
export function retryDescriptor(d, ctx = {}) {
  try {
    if (!d || !d.tape) return refuse('undecodable');
    const e = takeoverEligible(d.tape, d.tick, { ...ctx, ...coverageCtx(d) });
    if (!e.ok) return e;
    // A retry of a postcard stays a postcard (same binding, same fingerprint-only check at N); anything else is a plain 'retry'.
    const post = d.source === POSTCARD_SOURCE
      ? { source: POSTCARD_SOURCE, coverage: d.coverage, expectedFingerprint: d.expectedFingerprint, postcard: d.postcard } : { source: 'retry' };
    return { ok: true, descriptor: buildTakeoverDescriptor({ tape: d.tape, tick: d.tick, ...post }) };
  } catch {
    return refuse('undecodable');
  }
}
