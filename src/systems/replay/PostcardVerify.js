/**
 * #67 reply verification (the SENDER side). NO Phaser imports.
 *
 * A reply claims "I survived the window" or "I crashed at +x ticks". A reply is only a claim: `verifyReply` re-simulates the
 * postcard prefix PLUS the reply's input rows on a RunScene in tape-replay mode (REG.GHOST_REPLAY with `replyReplayTape`) and
 * checks, in order: the reply belongs to this postcard; the state at tick N reproduces the postcard's fingerprint; the claimed
 * outcome is exactly what the engine does with those inputs (a crash on exactly tick N + offset, or alive at N + window).
 *
 * The judging is a pure function of what the engine observed, so a browser proof can drive the page and judge in Node.
 */
import { postcardToTakeoverInput } from './Postcard.js';
import { liveFingerprint } from './PostcardChallenge.js';

export const VERIFY_REFUSALS = Object.freeze({
  mismatch: 'this reply does not belong to that postcard',
  'no-replay': 'the verifier scene is not in tape-replay mode',
  prefix: 'the postcard prefix did not reach its start tick on this build',
  fingerprint: "the postcard start state isn't reproducible on this build",
  outcome: 'the reply claims an outcome the engine does not reproduce',
});
const fail = (reason, extra) => ({ ok: false, reason, message: VERIFY_REFUSALS[reason] + (extra ? ` (${extra})` : '') });

/** The full replay tape: postcard prefix rows, then the reply's rows re-based onto absolute ticks. */
export function replyReplayTape(postcard, reply) {
  const base = postcardToTakeoverInput(postcard).tape;
  const N = postcard.startTick;
  const inputs = base.inputs.map((r) => [...r]);
  let at = inputs.reduce((s, r) => s + r[0], 0);
  let off = 0;
  for (const r of reply.suffix) {
    off += r[0];
    const abs = N + off;
    inputs.push([abs - at, r[1], r[2]]);
    at = abs;
  }
  return { ...base, inputs, endTick: N + postcard.windowTicks + 1 };
}

/**
 * @param {object} postcard @param {object} reply decoded reply
 * @param {{prefixDone:boolean, prefixCrashed:boolean, startFingerprint:string|null, endTick:number, endDone:boolean, endCrashed:boolean}} obs
 * @returns {{ok:true, outcome:string, crashOffsetTicks:number|null}|{ok:false, reason:string, message:string}}
 */
export function judgeReply(postcard, reply, obs) {
  if (!postcard || !reply || reply.postcardDigest !== postcard.digest) return fail('mismatch');
  if (!obs.prefixDone || obs.prefixCrashed) return fail('prefix');
  if (obs.startFingerprint !== postcard.fingerprintAtStart) return fail('fingerprint');
  if (obs.endCrashed) {
    const off = obs.endTick - postcard.startTick;
    return reply.outcome === 'crashed' && reply.crashOffsetTicks === off ? { ok: true, outcome: 'crashed', crashOffsetTicks: off }
      : fail('outcome', `engine: crashed at +${off} ticks, reply: ${reply.outcome}${reply.crashOffsetTicks === null ? '' : ` at +${reply.crashOffsetTicks}`}`);
  }
  if (obs.endDone && obs.endTick >= postcard.startTick + postcard.windowTicks) {
    return reply.outcome === 'survived' ? { ok: true, outcome: 'survived', crashOffsetTicks: null }
      : fail('outcome', `engine: survived the window, reply: ${reply.outcome} at +${reply.crashOffsetTicks}`);
  }
  return fail('outcome', 'the replay did not reach the end of the window');
}

/**
 * Drive a RunScene already created in tape-replay mode with `replyReplayTape(postcard, reply)` and judge the reply.
 * @param {object} scene the replay RunScene (tapePlayer set)
 */
export function verifyReplyOnScene(scene, postcard, reply) {
  if (!postcard || !reply || reply.postcardDigest !== postcard.digest) return fail('mismatch');
  if (!scene || !scene.tapePlayer || typeof scene.seekTo !== 'function') return fail('no-replay');
  const N = postcard.startTick;
  const a = scene.seekTo(N, { verify: false, maxTicks: Infinity });
  const startFingerprint = a.done && !a.crashed ? liveFingerprint(scene) : null;
  const obs = { prefixDone: !!a.done, prefixCrashed: !!a.crashed, startFingerprint, endTick: scene.simClock.tick, endDone: false, endCrashed: false };
  if (obs.prefixDone && !obs.prefixCrashed && startFingerprint === postcard.fingerprintAtStart) {
    const b = scene.seekTo(N + postcard.windowTicks, { verify: false, maxTicks: Infinity });
    obs.endTick = b.tick; obs.endDone = !!b.done; obs.endCrashed = !!b.crashed;
  }
  return judgeReply(postcard, reply, obs);
}
