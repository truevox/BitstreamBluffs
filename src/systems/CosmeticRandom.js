/**
 * OWNER: core-logic engineer. NO Phaser imports.
 *
 * Named random streams for menus, HUD flicker, the jukebox and audio texture (issue #59
 * stage 3). The session root comes once from the platform CSPRNG, so these still vary from
 * session to session, but every draw is a named, seeded Rng fork: none of them can ever
 * advance a gameplay stream (RunRandom) or a terrain/mission stream. World effects that a
 * replay should repeat use the run's own visual streams instead (RunRandom.visual*).
 */
import { Rng } from './Rng.js';

let root = null;
const streams = new Map();

function sessionRoot() {
  if (!root) {
    let seed = 0x5eed1234;
    try { seed = globalThis.crypto.getRandomValues(new Uint32Array(1))[0]; } catch { /* no crypto: fixed root */ }
    root = new Rng(seed >>> 0);
  }
  return root;
}

/** The stream for `label` (created on first use). @returns {Rng} */
export function cosmeticRandom(label) {
  let s = streams.get(label);
  if (!s) { s = sessionRoot().fork(label); streams.set(label, s); }
  return s;
}

/** Pin the session root (tests, screenshot tools). */
export function seedCosmeticRandom(seed) {
  root = new Rng(typeof seed === 'number' ? seed >>> 0 : String(seed));
  streams.clear();
}
