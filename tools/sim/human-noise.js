/** Developer-only synthetic hop reaction models. Not calibrated player data. */
import { Rng } from '../../src/systems/Rng.js';

export const HUMAN_NOISE_VERSION = 1;
export const HUMAN_NOISE_FATIGUE_VERSION = 2;
export const NOISE_FPS = 60;
export const MAX_NOISE_SEEDS = 12;
export const MAX_NOISE_SEC = 60;
export const DEFAULT_NOISE_SEED = 'bb-noise-1';
export const NOISE_PROFILES = Object.freeze({
  ideal: Object.freeze({ minDelayFrames: 0, maxDelayFrames: 0, missRate: 0 }),
  steady: Object.freeze({ minDelayFrames: 3, maxDelayFrames: 7, missRate: .08 }),
  distracted: Object.freeze({ minDelayFrames: 8, maxDelayFrames: 18, missRate: .35 }),
});

export const FATIGUE_RAMP = Object.freeze({
  frameHz: NOISE_FPS, startFrame: 6 * NOISE_FPS, fullFrame: 18 * NOISE_FPS,
  maxAddedDelayFrames: 6, maxAddedMissProbability: .16, unaffectedProfile: 'ideal',
});

export function fatigueAtFrame(frame) {
  if (!Number.isSafeInteger(frame) || frame < 0) throw new RangeError('Fatigue needs a nonnegative simulated frame');
  const { startFrame, fullFrame, maxAddedDelayFrames, maxAddedMissProbability } = FATIGUE_RAMP;
  const span = fullFrame - startFrame;
  const elapsed = Math.max(0, Math.min(span, frame - startFrame));
  return {
    phase: elapsed === 0 ? 'preRamp' : elapsed === span ? 'capped' : 'ramp',
    delayFrames: Math.floor(elapsed * maxAddedDelayFrames / span),
    missProbability: (elapsed / span) * maxAddedMissProbability,
  };
}

export function makeHopNoise(profile, courseSeed, noiseSeed = DEFAULT_NOISE_SEED, { fatigue = false } = {}) {
  if (!Object.hasOwn(NOISE_PROFILES, profile)) throw new TypeError('Unknown hop noise profile');
  const { minDelayFrames, maxDelayFrames, missRate } = NOISE_PROFILES[profile];
  // Deliberately separate from window.Math.random, course RNG and physics RNG.
  // Keep the v1 seed domain in fatigue mode so the paired workload uses the
  // same reaction draws until its first changed scheduling decision.
  const rng = new Rng(JSON.stringify(['bb-human-noise', HUMAN_NOISE_VERSION, noiseSeed, profile, courseSeed]));
  let pending = null, lastFrame = -1;
  let intents = 0, missed = 0, sent = 0, coalesced = 0, delayFrames = 0, addedDelayFrames = 0;
  const phaseIntents = { preRamp: 0, ramp: 0, capped: 0 };
  const rampApplies = fatigue && profile !== FATIGUE_RAMP.unaffectedProfile;
  return {
    step(frame, intent) {
      if (!Number.isSafeInteger(frame) || frame <= lastFrame) {
        throw new RangeError('Noise planner needs increasing nonnegative frame indices');
      }
      lastFrame = frame;
      if (intent) {
        intents++;
        if (pending !== null) coalesced++;
        else {
          // Sample exactly once for a new, actionable intent; already pending
          // reactions retain their scheduled dispatch even across a boundary.
          const ramp = rampApplies ? fatigueAtFrame(frame) : null;
          if (ramp) phaseIntents[ramp.phase]++;
          const probability = missRate + (ramp?.missProbability ?? 0);
          if (probability > 0 && rng.chance(probability)) missed++;
          else {
            const base = minDelayFrames === maxDelayFrames ? minDelayFrames : rng.int(minDelayFrames, maxDelayFrames);
            const extra = ramp?.delayFrames ?? 0;
            delayFrames += base + extra;
            addedDelayFrames += extra;
            pending = frame + base + extra;
          }
        }
      }
      if (pending !== null && frame >= pending) {
        pending = null;
        sent++;
        return true;
      }
      return false;
    },
    stats() {
      return { intents, missed, sent, coalesced, delayFrames, pendingAtEnd: pending !== null,
        ...(fatigue ? { fatigue: { applies: rampApplies, phaseIntents: { ...phaseIntents }, addedDelayFrames } } : {}) };
    },
  };
}

export function noiseOutcome(endReason) {
  if (endReason === 'maxM') return 'pass';
  if (endReason.startsWith('crash:')) return 'crash';
  if (endReason === 'timeout' || endReason === 'stalled') return endReason;
  throw new Error('Unrecognized noise trial outcome');
}

export function summarizeNoise(results) {
  const counts = { pass: 0, crash: 0, timeout: 0, stalled: 0 };
  for (const result of results) counts[noiseOutcome(result.endReason)]++;
  return { trials: results.length, ...counts, passRate: results.length ? counts.pass / results.length : null };
}

export function verifyNoiseEvidence(a, b, { playback = false } = {}) {
  const comparable = (run) => {
    const { wallMs, humanNoise, ...rest } = run;
    const { stats, ...evidence } = humanNoise;
    return { ...rest, humanNoise: playback ? evidence : humanNoise };
  };
  // Compare actual tick rows and final observations, not merely the RNG seed.
  return JSON.stringify(comparable(a)) === JSON.stringify(comparable(b));
}
