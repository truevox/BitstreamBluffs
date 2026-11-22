/** #77 local stock panel. Fixed public fixture, not an arbitrary seed finder or replay importer. */
import { isDeepStrictEqual } from 'node:util';
import { PILOT } from './hands-off-pilot.js';
import { CHECKPOINT_EVERY, decodePad, encodePad } from '../../src/systems/ghost/GhostTape.js';
import { tapeCompatible } from '../../src/systems/ghost/GhostLibrary.js';
import { RUN_RANDOM_VERSION } from '../../src/systems/RunRandom.js';
import { combineFingerprints } from '../../src/systems/replay/canonicalBinary.js';
import { FP_SUBSYSTEMS } from '../../src/systems/replay/fingerprintSchemas.js';

const seeds = ['sim-02', 'sim-05', 'sim-11', ...Array.from({ length: 9 }, (_, i) => `sim-${i + 13}`)];
export const PANEL = Object.freeze({
  seeds: Object.freeze(seeds),
  biomeMask: PILOT.biomeMask, targetM: PILOT.targetM,
  calendarUtc: PILOT.calendarUtc, dailyRuleId: PILOT.dailyRuleId,
  controlLayout: PILOT.controlLayout, pixelsPerMeter: PILOT.pixelsPerMeter,
  tickHz: PILOT.simTickHz, limitTicks: PILOT.deadlineSeconds * PILOT.simTickHz,
  checkpointEvery: CHECKPOINT_EVERY,
});

const entry = '/assets/index-CZej5tOH.js';
export const BUILD = Object.freeze({
  assertedSourceCommit: '7d5780fed63955d72691e2aaa436a9c59652f852',
  rulesetId: 'sha256:ecb2017a49d367024bfb9f1e008fa35eb9c1c980fb7101cfb846615db7c78c27',
  entry,
  modules: Object.freeze({
    [entry]: '60a90f8a7e89f593bd62b9b6026db1582d6c45b72048e93ec0ee1b2ace2d1bf5',
    '/assets/runtimeRuleset-W1dM1fkQ.js': '2e2afda696d45504f69a5e6299a127cd2d5791ac365b6b315e98d7db17f64ea8',
    '/assets/ecb2017a49d367024bfb9f1e008fa35eb9c1c980fb7101cfb846615db7c78c27-Qs3sMEdr.js': '1a8be5e9d1a57fa86434c3a3227928cc12afd0b554fafe779117ae4bf05b4f9c',
  }),
});

const require = (ok, message) => { if (!ok) throw new Error(message); };
const fp = (value) => typeof value === 'string' && /^xxh32x2:[0-9a-f]{16}$/.test(value);
const hazard = (id) => typeof id === 'string' && /^[A-Za-z][A-Za-z0-9]{0,31}$/.test(id);

export function parsePanelOptions(args) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) return { help: true };
  require(args.length === 0 || (args.length === 2 && args[0] === '--url'), 'The fixed panel only accepts --url');
  const url = args[1] ?? 'http://127.0.0.1:8293/';
  const port = /^http:\/\/127\.0\.0\.1:([1-9]\d{0,4})\/$/.exec(url)?.[1];
  require(port && Number(port) <= 65535, 'Use an HTTP 127.0.0.1 preview root with an explicit port');
  return { url: new URL(url) };
}

function assertNeutral(rows) {
  const flags = encodePad({ variableHop: true, noAutoNudge: true });
  const decoded = decodePad(...flags);
  require(isDeepStrictEqual(rows, [[1, ...flags]]) && decoded.variableHop === true && decoded.noAutoNudge === true &&
    Object.values(decoded.pressed).every((value) => value === false) &&
    Object.entries(decoded).every(([key, value]) =>
      ['pressed', 'lastSource', 'variableHop', 'noAutoNudge'].includes(key) || value === 0 || value === false),
  'Capture did not record exclusively neutral controls');
}

function assertCadence(rows, completed) {
  const count = Math.floor(completed / PANEL.checkpointEvery);
  require(Array.isArray(rows) && rows.length === count && count > 0, 'Incomplete native fingerprint cadence');
  for (let i = 0; i < count; i++) {
    const row = rows[i], parts = row?.subsystems;
    require(row?.tick === (i + 1) * PANEL.checkpointEvery && parts && Object.keys(parts).length === FP_SUBSYSTEMS.length &&
      FP_SUBSYSTEMS.every((name) => Object.hasOwn(parts, name) && fp(parts[name])) &&
      row.combined === combineFingerprints(row.tick, parts, FP_SUBSYSTEMS), 'Invalid native fingerprint row');
  }
}

/** Validate observations from the pinned native normal recorder. Never interpret a capped run as a verified candidate. */
export function inspectCapture(seed, run) {
  require(PANEL.seeds.includes(seed) && run?.seed === seed, 'Unexpected panel seed');
  const { ticks, peakM, reachedTick, fatal, inputs, tape, fingerprints, fingerprintErrors } = run;
  const completed = fatal ? ticks - 1 : ticks;
  require(Number.isSafeInteger(ticks) && ticks > 0 && ticks <= PANEL.limitTicks &&
    Number.isFinite(peakM) && peakM >= 0 &&
    (reachedTick === null ? peakM < PANEL.targetM : Number.isSafeInteger(reachedTick) &&
      reachedTick > 0 && reachedTick <= completed && peakM >= PANEL.targetM), 'Invalid captured distance or tick interval');
  assertNeutral(inputs);
  require(fingerprintErrors === 0, 'Native fingerprint capture failed');
  assertCadence(fingerprints, completed);
  if (fatal === null) {
    require(ticks === PANEL.limitTicks && tape === null, 'Capped trial must end at the fixed limit without a finished tape');
    return 'capped-unverified';
  }
  require(fatal?.tick === ticks &&
    ['hazard', 'terrain', 'badLanding', 'chasm', 'bsod'].includes(fatal.cause) &&
    (fatal.hazardId === null || hazard(fatal.hazardId)) &&
    [fatal.x, fatal.y, fatal.speedPxS, fatal.distanceM].every(Number.isFinite), 'Invalid natural fatal observation');
  require(tapeCompatible(tape) && tape.version === 1 && tape.edgeRows === 'every-tick' &&
    tape.runRandomVersion === RUN_RANDOM_VERSION && tape.mode === 'normal' && tape.seed === seed &&
    tape.biomeMask === PANEL.biomeMask && tape.dailyRuleId === PANEL.dailyRuleId &&
    tape.startedAt === Date.parse(PANEL.calendarUtc) && tape.controlLayout === PANEL.controlLayout &&
    Array.isArray(tape.boosts) && tape.boosts.length === 0 && tape.upgradeRanks === null &&
    tape.magnetsDrop === false && tape.kodiaksOn === false && tape.kodiakPackMode === 'same' &&
    tape.endTick === completed, 'Native tape does not match the stock normal capture');
  assertNeutral(tape.inputs);
  require(Array.isArray(tape.checkpoints) && tape.checkpoints.length === fingerprints.length &&
    Array.from(tape.checkpoints).every((row, i) => Array.isArray(row) && row.length === 8 &&
      row[0] === fingerprints[i].tick && Array.from(row).every(Number.isFinite) && Number.isSafeInteger(row[7])),
  'Incomplete native exact checkpoints');
  return reachedTick === null ? 'finished-short' : 'needs-replay';
}

/** Redacted report row; no tape, coordinates, score, pad rows, run ID or raw hashes leave the checked trial. */
export function reportTrial(seed, capture, replay = null) {
  const seen = inspectCapture(seed, capture);
  if (seen === 'needs-replay') {
    require(replay?.seed === seed && replay.fingerprintErrors === 0 && replay.checked === capture.tape.checkpoints.length &&
      replay.desync === null && replay.playbackSaved === false, 'Playback missing, desynced or wrote data');
    require(replay.ticks === capture.ticks && replay.peakM === capture.peakM && replay.reachedTick === capture.reachedTick &&
      isDeepStrictEqual(replay.fatal, capture.fatal), 'Playback terminal or completed-tick distance differs');
    assertCadence(replay.fingerprints, capture.tape.endTick);
    require(isDeepStrictEqual(replay.fingerprints, capture.fingerprints), 'Playback native fingerprints differ');
  } else require(replay === null, 'Unqualified trial was passed to playback');
  const rounded = (n) => Math.round(n * 1000) / 1000;
  return {
    seed, status: seen === 'needs-replay' ? 'verified-candidate' : seen,
    reached500mAtCompletedTick: capture.reachedTick,
    peakCompletedMeters: rounded(capture.peakM),
    terminal: capture.fatal ? { tick: capture.ticks, cause: capture.fatal.cause,
      hazardId: capture.fatal.hazardId, distanceM: rounded(capture.fatal.distanceM) } : { capTick: capture.ticks },
    verification: seen === 'needs-replay' ? { nativeExactCheckpoints: replay.checked,
      fingerprintSubsystems: FP_SUBSYSTEMS.length, nativeCadenceTicks: PANEL.checkpointEvery,
      sameNaturalTerminalAndThreshold: true, playbackSaved: false } : null,
  };
}
