/** #131: strict saved-tape analytics intake and grounded-sample aggregation. */
import assert from 'node:assert/strict';
import { DailyPatch } from '../../src/systems/DailyPatch.js';
import { BOOSTS } from '../../src/systems/Boosts.js';
import { KODIAK_VERSION } from '../../src/systems/Kodiaks.js';
import { UPGRADE_IDS } from '../../src/systems/PermanentUpgrades.js';
import { RUN_RANDOM_VERSION, RUN_STREAMS } from '../../src/systems/RunRandom.js';
import { SIM_TICK_HZ } from '../../src/systems/SimClock.js';
import { tapeCompatible } from '../../src/systems/ghost/GhostLibrary.js';
import { CHECKPOINT_EVERY, TRACE_EVERY, decodeTrace } from '../../src/systems/ghost/GhostTape.js';

export const MAX_AIRTIME_FILE_BYTES = 2 * 1024 * 1024;
export const MAX_AIRTIME_TICKS = 180 * SIM_TICK_HZ;
const PACK_MODES = ['same', 'mixed'];
const CONTROL_LAYOUTS = ['classic', 'tricksLeft', 'tricksRight'];
const nonArrayObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const isUint32 = (value) => Number.isSafeInteger(value) && value >= 0 && value <= 0xffffffff;
const validTime = (value) => Number.isSafeInteger(value) && value >= 0 && Number.isFinite(new Date(value).getTime());
const validTuple = (value, length) => Array.isArray(value) && value.length === length && Array.from(value).every(Number.isFinite);

export function airtimeBuildPin(value) {
  assert.ok(typeof value === 'string' && /^[0-9a-f]{40}$/i.test(value), 'Airtime requires a full 40-hex Git build commit');
  return value.toLowerCase();
}

export function validateAirtimeTape(tape) {
  assert.ok(tapeCompatible(tape) && tape.version === 1 && tape.mode === 'normal' &&
    tape.runRandomVersion === RUN_RANDOM_VERSION && typeof tape.seed === 'string' &&
    tape.seed.trim().length > 0 && tape.seed.length <= 64 && !/[\p{Cc}\p{Cf}]/u.test(tape.seed) &&
    isUint32(tape.biomeMask) && validTime(tape.startedAt) && validTime(tape.endedAt) && tape.endedAt >= tape.startedAt &&
    tape.runId === `${tape.startedAt}-${tape.seed}` && tape.cause === 'crash' &&
    Number.isFinite(tape.distanceM) && tape.distanceM >= 0 && Number.isSafeInteger(tape.score) &&
    (tape.dailyRuleId === 'none' || DailyPatch.RULES.some(({ id }) => tape.dailyRuleId === id)) &&
    CONTROL_LAYOUTS.includes(tape.controlLayout), 'Airtime requires a complete compatible recorded normal-run header');
  const validBoosts = Array.isArray(tape.boosts) && tape.boosts.length <= BOOSTS.length &&
    new Set(tape.boosts).size === tape.boosts.length && Array.from(tape.boosts).every((id) => BOOSTS.includes(id));
  const ranks = tape.upgradeRanks;
  const validRanks = ranks === null || (nonArrayObject(ranks) && Object.keys(ranks).length > 0 &&
    Object.entries(ranks).every(([id, rank]) => UPGRADE_IDS.includes(id) && Number.isSafeInteger(rank) && rank > 0));
  const streams = Object.keys(RUN_STREAMS);
  assert.ok(validBoosts && validRanks && typeof tape.magnetsDrop === 'boolean' && typeof tape.kodiaksOn === 'boolean' &&
    PACK_MODES.includes(tape.kodiakPackMode) && tape.kodiakVersion === KODIAK_VERSION &&
    validTuple(tape.startPose, 6) && nonArrayObject(tape.random) && tape.random.version === RUN_RANDOM_VERSION &&
    Object.keys(tape.random).length === streams.length + 1 && streams.every((key) => isUint32(tape.random[key])),
  'Airtime requires an explicit supported loadout, starting pose and RNG snapshot');

  const { endTick, inputs, checkpoints, trace } = tape;
  assert.ok(Number.isSafeInteger(endTick) && endTick >= CHECKPOINT_EVERY && endTick <= MAX_AIRTIME_TICKS,
    `Airtime needs ${CHECKPOINT_EVERY}–${MAX_AIRTIME_TICKS} completed ticks`);
  assert.ok(Array.isArray(checkpoints) && checkpoints.length === Math.floor(endTick / CHECKPOINT_EVERY) &&
    Array.from(checkpoints).every((row, i) => validTuple(row, 8) && row[0] === (i + 1) * CHECKPOINT_EVERY && Number.isSafeInteger(row[7])),
  'Airtime needs every exact on-cadence eight-field checkpoint');
  assert.ok(Array.isArray(inputs) && inputs.length >= 1 && inputs.length <= endTick + 1, 'Invalid saved input rows');
  let tick = 0, previous = null;
  for (const row of inputs) {
    assert.ok(Array.isArray(row) && row.length === 3, 'Invalid saved input rows');
    const [delta, bits, tilt] = row;
    // V1 encodes 18 boolean bits followed by a heli field whose value 3 is unused.
    assert.ok(Number.isSafeInteger(delta) && delta > 0 && delta <= endTick + 1 - tick &&
      Number.isSafeInteger(bits) && bits >= 0 && bits <= 0xbffff && Number.isSafeInteger(tilt) && tilt >= -127 && tilt <= 127 &&
      (previous ? previous[1] !== bits || previous[2] !== tilt : delta === 1), 'Invalid saved input rows');
    tick += delta;
    previous = row;
  }
  const poses = Math.floor(endTick / TRACE_EVERY);
  // The saved pose trace is structurally checked, never used to infer airtime.
  assert.ok(trace.length === 16 * poses && !/[^A-Za-z0-9+/]/.test(trace), 'Invalid saved pose trace');
  const decoded = decodeTrace({ trace });
  assert.ok(decoded.length === poses * 3 && decoded.every(Number.isFinite), 'Invalid saved pose trace');
  return tape;
}

export function summarizeAirtime(grounded, tickHz = SIM_TICK_HZ) {
  assert.ok(Array.isArray(grounded) && grounded.length > 0 && Array.from(grounded).every((value) => typeof value === 'boolean') &&
    Number.isSafeInteger(tickHz) && tickHz > 0, 'Airtime needs one grounded observation per completed tick');
  let airborneTicks = 0, observed = 0, boundedByGround = 0, longestTicks = 0, start = -1;
  for (let i = 0; i <= grounded.length; i++) {
    if (i < grounded.length && !grounded[i]) {
      airborneTicks++;
      if (start === -1) start = i;
    } else if (start !== -1) {
      observed++;
      longestTicks = Math.max(longestTicks, i - start);
      if (start > 0 && i < grounded.length) boundedByGround++;
      start = -1;
    }
  }
  return { observedTicks: grounded.length, airborneTicks, cumulativeAirborneMs: airborneTicks * 1000 / tickHz,
    episodes: { observed, boundedByGround, startsAirborne: !grounded[0], endsAirborne: !grounded.at(-1), longestTicks } };
}

export function assertAirtimeMatch(actual, expected, ticks) {
  assert.equal(actual.length, ticks, 'Expected an airtime observation at every completed tick');
  assert.equal(expected.length, ticks, 'Missing reference airtime observations');
  for (let i = 0; i < ticks; i++) {
    assert.equal(actual[i], expected[i], `Grounded state differs at tick ${i + 1}`);
  }
}
