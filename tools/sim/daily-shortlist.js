/** #70: bounded intake of a #126 runner report; never selects an official Daily. */
import { DailyPatch } from '../../src/systems/DailyPatch.js';
import { GHOST_TAPE_FORMAT } from '../../src/systems/ghost/GhostTape.js';
import {
  MAX_NOISE_SEC, MAX_NOISE_SEEDS, NOISE_PROFILES, summarizeNoise, noiseOutcome,
} from './human-noise.js';

export const MAX_PANEL_BYTES = 4 * 1024 * 1024;
const PROFILE_ORDER = ['ideal', 'steady', 'distracted'];
const FRAME_HZ = 60;
const TICK_HZ = 120;
const TRACE_EVERY = 60;
const EPSILON = 1e-8;
const U32_MAX = 0xffffffff;
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = (value, min = -Infinity, max = Infinity) => Number.isFinite(value) && value >= min && value <= max;
const integer = (value, min, max) => Number.isSafeInteger(value) && value >= min && value <= max;
const positive = (value, max) => finite(value, 0, max) && value > 0;
const label = (value) => typeof value === 'string' && value.length > 0 && value.length <= 64 &&
  value.trim() === value && !/[\p{Cc}\p{Cf}]/u.test(value);
const tuple = (value, size) => Array.isArray(value) && value.length === size && value.every((n) => finite(n));
const owns = (value, key) => object(value) && Object.hasOwn(value, key);

function requireValue(ok, message) {
  if (!ok) throw new TypeError(message);
}

function readSettings(settings) {
  requireValue(object(settings), 'Missing panel settings');
  const { seeds, noiseSeed, policy, passDistanceM, maxSec, biomeMask, rule, hopLeadMs, profiles } = settings;
  requireValue(Array.isArray(seeds) && seeds.length >= 1 && seeds.length <= MAX_NOISE_SEEDS &&
    seeds.every(label) && new Set(seeds).size === seeds.length && label(noiseSeed), 'Invalid panel seed labels');
  requireValue(policy === 'hop' && positive(passDistanceM, 5000) && positive(maxSec, MAX_NOISE_SEC) &&
    integer(biomeMask, 0, U32_MAX) && positive(hopLeadMs, 1000) &&
    (rule === 'none' || DailyPatch.RULES.some((item) => item.id === rule)), 'Unsupported panel settings');
  requireValue(owns(profiles, 'ideal') && Object.keys(profiles).length >= 2 &&
    Object.keys(profiles).every((name) => Object.hasOwn(NOISE_PROFILES, name)), 'Use ideal and at least one known noisy profile');
  const names = PROFILE_ORDER.filter((name) => owns(profiles, name));
  for (const name of names) {
    const model = profiles[name], expected = NOISE_PROFILES[name];
    requireValue(object(model) && Object.keys(model).length === Object.keys(expected).length &&
      Object.entries(expected).every(([key, value]) => owns(model, key) && model[key] === value), 'Unsupported noise profile parameters');
  }
  return { seeds: [...seeds].sort(), policy, noiseSeed, passDistanceM, maxSec, biomeMask, rule, hopLeadMs,
    profiles: Object.fromEntries(names.map((name) => [name, NOISE_PROFILES[name]])) };
}

function validStats(stats, frames, profile) {
  if (!object(stats)) return false;
  const { intents, missed, sent, coalesced, delayFrames, pendingAtEnd } = stats;
  const scheduled = sent + Number(pendingAtEnd);
  return [intents, missed, sent, coalesced].every((n) => integer(n, 0, frames)) &&
    typeof pendingAtEnd === 'boolean' && (profile.missRate !== 0 || missed === 0) &&
    intents === missed + scheduled + coalesced &&
    integer(delayFrames, profile.minDelayFrames * scheduled, profile.maxDelayFrames * scheduled);
}

function validTickInput(input, frames, crashed) {
  if (!object(input) || input.format !== GHOST_TAPE_FORMAT || input.version !== 1 || input.tickHz !== TICK_HZ ||
      !integer(input.ticks, frames * 2 - Number(crashed), frames * 2) || !Array.isArray(input.rows) ||
      !integer(input.rows.length, 1, input.ticks)) return false;
  let tick = 0, previous = null;
  // Ghost input v1: 18 boolean bits and a two-bit heli value (3 is unused).
  for (const row of input.rows) {
    if (!Array.isArray(row) || row.length !== 3) return false;
    const [delta, bits, tilt] = row;
    if (!integer(delta, 1, input.ticks - tick) || !integer(bits, 0, 0xbffff) || !integer(tilt, -127, 127) ||
        (previous === null ? delta !== 1 : previous[1] === bits && previous[2] === tilt)) return false;
    tick += delta;
    previous = row;
  }
  return true;
}

function evidenceFor(cell, settings, index) {
  const at = `Trial ${index + 1}`;
  requireValue(object(cell) && object(cell.humanNoise) && object(cell.verification) &&
    cell.verification.seededRepeat === true && cell.verification.inputPlayback === true, `${at}: missing successful verification flags`);
  const { frames, simSec, distM, score, endReason, humanNoise: noise, trace } = cell;
  const { profile, version, frameHz, stats, input, final } = noise;
  requireValue(typeof profile === 'string' && owns(settings.profiles, profile) && settings.seeds.includes(cell.seed), `${at}: unknown seed or profile`);
  requireValue(version === 1 && frameHz === FRAME_HZ &&
    integer(frames, 1, Math.ceil(settings.maxSec * FRAME_HZ) + 1) && finite(simSec, 0) &&
    Math.abs(simSec - frames / FRAME_HZ) <= .005 + EPSILON && finite(distM) && Number.isSafeInteger(score), `${at}: invalid run observations`);
  requireValue(typeof endReason === 'string' && /^(?:maxM|timeout|stalled|crash:[A-Za-z][A-Za-z0-9_-]{0,31})$/.test(endReason),
    `${at}: unsupported termination reason`);
  const outcome = noiseOutcome(endReason);
  const time = frames / FRAME_HZ;
  // Report meters are rounded to tenths. A crash on the crossing frame wins over a pass.
  requireValue(cell.outcome === outcome && time <= settings.maxSec + 1 / FRAME_HZ + EPSILON &&
    (outcome !== 'timeout' || time >= settings.maxSec - EPSILON) &&
    (outcome === 'crash' || (outcome === 'pass' ? distM >= settings.passDistanceM - .05 - EPSILON :
      distM <= settings.passDistanceM + .05 + EPSILON)), `${at}: inconsistent terminal outcome`);
  requireValue(validStats(stats, frames, settings.profiles[profile]) && validTickInput(input, frames, outcome === 'crash') &&
    Array.isArray(trace) && trace.length === Math.floor(frames / TRACE_EVERY) &&
    trace.every((row) => tuple(row, 4) && integer(row[3], 0, Number.MAX_SAFE_INTEGER)) &&
    object(final) && tuple(final.position, 2) && tuple(final.velocity, 2) && finite(final.angle) &&
    finite(final.angularVelocity) && finite(final.score) && integer(final.physicsRng, 0, U32_MAX), `${at}: invalid original-trial evidence`);
  return { profile, outcome, endReason, distanceM: distM, simulatedSeconds: simSec, fixedTicks: input.ticks };
}

/** Deterministic summary of one complete, runner-reported verified panel. No raw traces or scores leave here. */
export function createDailyShortlist(panel, { sourceSha256, buildCommit } = {}) {
  requireValue(typeof buildCommit === 'string' && /^[a-f\d]{40}$/i.test(buildCommit), 'Provide a full 40-hex Git commit for the producing build');
  requireValue(typeof sourceSha256 === 'string' && /^[a-f\d]{64}$/i.test(sourceSha256), 'Invalid report SHA-256 digest');
  if (object(panel) && panel.kind === 'local-tool-assisted-fatigue-bot-panel') {
    throw new TypeError('Fatigue panels (noise model v2) are not supported by the classic-only shortlist. ' +
      'Rerun the #126 bot panel with --verify and without --fatigue.');
  }
  requireValue(object(panel) && panel.kind === 'local-tool-assisted-bot-panel' && panel.verify === true,
    'Use a local #126 bot panel produced with successful --verify');
  const settings = readSettings(panel.settings);
  const profiles = Object.keys(settings.profiles);
  const matrix = new Map(settings.seeds.map((seed) => [seed, new Map()]));
  requireValue(Array.isArray(panel.results) && panel.results.length === matrix.size * profiles.length, 'Incomplete seed/profile matrix');
  for (let i = 0; i < panel.results.length; i++) {
    const cell = panel.results[i], evidence = evidenceFor(cell, settings, i), byProfile = matrix.get(cell.seed);
    requireValue(!byProfile.has(evidence.profile), 'Duplicate seed/profile trial');
    byProfile.set(evidence.profile, evidence);
  }
  requireValue(object(panel.summary) && Object.keys(panel.summary).length === profiles.length, 'Invalid profile summary');
  const summary = Object.fromEntries(profiles.map((name) => {
    const counts = summarizeNoise([...matrix.values()].map((byProfile) => byProfile.get(name)));
    const stated = panel.summary[name];
    requireValue(object(stated) && Object.keys(stated).length === Object.keys(counts).length &&
      Object.entries(counts).every(([key, value]) => owns(stated, key) && stated[key] === value), 'Profile summary disagrees with trials');
    return [name, counts];
  }));
  const seeds = [...matrix].map(([seed, byProfile]) => {
    const trials = profiles.map((name) => byProfile.get(name));
    const idealPassed = trials[0].outcome === 'pass';
    const noisyNonPass = trials.slice(1).filter(({ outcome }) => outcome !== 'pass').map(({ profile }) => profile);
    return { seed, observation: !idealPassed ? 'ideal-did-not-pass' : noisyNonPass.length ? 'profile-outcomes-differ' : 'all-tested-profiles-passed',
      noisyNonPass, trials };
  });
  return {
    kind: 'local-daily-shortlist', version: 1,
    scope: 'offline synthetic QA; not an official Daily, score, or human fairness assessment',
    source: { sha256: sourceSha256.toLowerCase(), assertedGitCommit: buildCommit.toLowerCase(), buildVerified: false,
      verification: 'runner-reported seeded repeat and input playback, not rerun or authenticated here', checkedCells: panel.results.length },
    settings: { ...settings, noiseModelVersion: 1, frameHz: FRAME_HZ, tickHz: TICK_HZ },
    selection: 'unranked; ideal reached the threshold and at least one tested noisy profile did not',
    shortlist: seeds.filter(({ observation }) => observation === 'profile-outcomes-differ').map(({ seed }) => seed),
    summary, seeds,
  };
}
