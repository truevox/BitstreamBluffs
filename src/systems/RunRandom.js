/**
 * OWNER: core-logic engineer. NO Phaser imports.
 *
 * Named, domain-separated random streams for one run (issue #59). Every stream is
 * `new Rng(seed).fork(label)`: derived from the ORIGINAL seed state, so drawing from a
 * cosmetic stream can never advance or shift the physics stream, and vice versa.
 * Streams restart from the seed whenever a RunScene is created (new run, retry,
 * replay). Their numeric state is part of a future replay header.
 */
import { Rng } from './Rng.js';

/** Bump when a label, derivation or draw order changes: old replay tapes become incompatible. */
export const RUN_RANDOM_VERSION = 1;

/** Stream labels. Physics streams affect gameplay; visual streams must never. */
export const RUN_STREAMS = Object.freeze({
  physicsScramble: 'physics/scramble',
  visualSled: 'visual/sled',
});

/**
 * @param {string} seed the run seed exactly as the terrain uses it.
 * @returns {{version:number, physicsScramble:Rng, visualSled:Rng}}
 */
export function runRandomStreams(seed) {
  const root = new Rng(String(seed));
  const out = { version: RUN_RANDOM_VERSION };
  for (const [key, label] of Object.entries(RUN_STREAMS)) out[key] = root.fork(label);
  return out;
}

/** Snapshot of every stream's position (for replay headers and checkpoints). */
export function runRandomState(streams) {
  const out = { version: streams.version };
  for (const key of Object.keys(RUN_STREAMS)) out[key] = streams[key].state >>> 0;
  return out;
}
