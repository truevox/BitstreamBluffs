/** #77: one fixed developer-only hands-off candidate, not a seed finder. */
import { PIXELS_PER_METER, REG, SCENES } from '../../src/constants.js';
import { EVT } from '../../src/events.js';
import { RUN_RANDOM_VERSION } from '../../src/systems/RunRandom.js';
import { SIM_TICK_HZ } from '../../src/systems/SimClock.js';
import { tapeCompatible } from '../../src/systems/ghost/GhostLibrary.js';
import { CHECKPOINT_EVERY, decodePad, encodePad } from '../../src/systems/ghost/GhostTape.js';

export const PILOT = Object.freeze({
  seed: 'sim-11', biomeMask: 0, targetM: 500, deadlineSeconds: 35,
  calendarUtc: '2026-01-05T12:00:00.000Z', dailyRuleId: 'featherweight',
  controlLayout: 'tricksRight', captureHz: 60, replayHz: 120, simTickHz: SIM_TICK_HZ,
  pixelsPerMeter: PIXELS_PER_METER,
});

export const PILOT_KEYS = Object.freeze({
  title: SCENES.TITLE, run: SCENES.RUN, replay: REG.GHOST_REPLAY,
  seed: REG.SEED, mask: REG.BIOME_MASK, dailyOfficial: REG.DAILY_OFFICIAL,
  record: REG.LAST_RECORD, tape: REG.LAST_GHOST_TAPE, saveStore: REG.SAVE_STORE,
  ghostLibrary: REG.GHOSTS, crash: EVT.CRASH,
});

export function localPilotUrl(value) {
  const url = new URL(value);
  if (url.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || url.username || url.password) {
    throw new TypeError('Use an HTTP loopback preview URL without credentials');
  }
  return url;
}

export function pilotBuildPin(value) {
  if (typeof value !== 'string' || !/^[0-9a-f]{40}$/i.test(value)) throw new TypeError('Provide a full 40-hex Git build commit');
  return value.toLowerCase();
}

/** Wall-clock bound for the Playwright evaluate, separate from simulated time. */
export async function pilotWithinDeadline(work, milliseconds = 60_000) {
  let timer;
  try {
    return await Promise.race([work, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error('Pilot browser trial timed out')), milliseconds);
    })]);
  } finally { clearTimeout(timer); }
}

// Serialized into the trusted preview. No globals beyond the game, no pad
// stubs/events, no forced crash, and no override of the date-selected rule.
export async function driveHandsOff({ pilot, keys, tape }, game = globalThis.__bbGame) {
  const { registry } = game;
  const run = game.scene.getScene(keys.run), playback = tape !== null;
  const hz = playback ? pilot.replayHz : pilot.captureHz, dt = 1000 / hz;
  game.loop.sleep();
  registry.set(keys.seed, pilot.seed);
  registry.set(keys.mask, pilot.biomeMask);
  registry.set(keys.dailyOfficial, false);
  if (playback) registry.set(keys.replay, tape);
  game.scene.stop(keys.title);
  game.scene.start(keys.run);
  game.step(0, 0);
  if (!run.sys.isActive() || run.simClock.tick !== 0 || Boolean(run.tapePlayer) !== playback ||
      Boolean(run.ghostRecorder) === playback || run.seed !== pilot.seed || run.biomeMask !== pilot.biomeMask ||
      run.dailyOfficial || run.bsodGym || run.dailyRuleId !== pilot.dailyRuleId ||
      run.startedAt !== Date.parse(pilot.calendarUtc) || run.settings?.controlLayout !== pilot.controlLayout ||
      run.appliedBoosts?.length !== 0 || !run.upgradeRun || run.upgradeRun.enabled ||
      Object.keys(run.upgradeRun.ranks).length !== 0 || run.magnetsDrop !== false || run.kodiaksOn !== false ||
      run.kodiakPackMode !== 'same') throw new Error('Pilot did not start in the expected normal stock scene');
  let fatal = null, events = 0;
  const onCrash = ({ fatal: isFatal, cause, x, y, hazardId }) => {
    if (isFatal !== true) return;
    events++;
    fatal = { cause, x, y, hazardId: hazardId ?? null, tick: run.simClock.tick };
  };
  game.events.on(keys.crash, onCrash);
  try {
    for (let frame = 1; frame <= pilot.deadlineSeconds * hz && !run.crashed; frame++) {
      const previous = run.simClock.tick;
      game.step(frame * dt, dt);
      const advanced = run.simClock.tick - previous, expected = pilot.simTickHz / hz;
      if (!(advanced === expected || (run.crashed && advanced >= 1 && advanced <= expected))) {
        throw new Error('Pilot fixed-tick stepping stalled or changed cadence');
      }
    }
  } finally { game.events.off(keys.crash, onCrash); }
  if (!run.crashed || events !== 1 || fatal?.tick !== run.simClock.tick || run.simClock.droppedMs !== 0) {
    throw new Error('No single natural crash reached within the fixed-tick pilot');
  }
  let savedDuringPlayback = false;
  if (playback) {
    const store = registry.get(keys.saveStore), library = registry.get(keys.ghostLibrary);
    savedDuringPlayback = Boolean(registry.get(keys.record) || registry.get(keys.tape)) ||
      (await store?.getRecentRuns(1))?.length !== 0 || library?.courses?.size !== 0 || library?.tapes?.size !== 0;
  }
  return {
    crash: { ...fatal, distanceM: (fatal.x - run.startX) / pilot.pixelsPerMeter },
    tape: playback ? null : registry.get(keys.tape) ?? null,
    checked: playback ? run.tapePlayer.checked : null,
    desynced: playback ? run.tapePlayer.desync !== null : false,
    savedDuringPlayback,
  };
}

function requirePilot(condition, message) {
  if (!condition) throw new Error(message);
}

export function assertHandsOffCapture(capture) {
  const tape = capture?.tape;
  requirePilot(tapeCompatible(tape) && tape.version === 1 && tape.runRandomVersion === RUN_RANDOM_VERSION && tape.mode === 'normal' && tape.seed === PILOT.seed &&
    tape.biomeMask === PILOT.biomeMask && tape.dailyRuleId === PILOT.dailyRuleId &&
    tape.startedAt === Date.parse(PILOT.calendarUtc) && tape.controlLayout === PILOT.controlLayout &&
    Array.isArray(tape.boosts) && tape.boosts.length === 0 && tape.upgradeRanks === null &&
    tape.magnetsDrop === false && tape.kodiaksOn === false && tape.kodiakPackMode === 'same',
  'Pilot capture did not produce the expected normal ghost tape');
  const crash = capture.crash;
  requirePilot(crash && Number.isSafeInteger(crash.tick) && crash.tick > 1 && crash.tick <= PILOT.deadlineSeconds * PILOT.simTickHz &&
    Number.isFinite(crash.x) && Number.isFinite(crash.y) && Number.isFinite(crash.distanceM) && crash.distanceM >= PILOT.targetM &&
    typeof crash.cause === 'string' && crash.cause.length > 0 && tape.endTick === crash.tick - 1, 'Pilot did not reach the target before a natural crash');
  // These two true flags express the current layout, not user buttons. Match
  // the exact canonical one-row encoding with the production codec.
  const [bits, tilt] = encodePad({ variableHop: true, noAutoNudge: true });
  requirePilot(Array.isArray(tape.inputs) && tape.inputs.length === 1 && Array.isArray(tape.inputs[0]) &&
    tape.inputs[0].length === 3 && tape.inputs[0][0] === 1 && tape.inputs[0][1] === bits && tape.inputs[0][2] === tilt,
  'Pilot tape contains a live input or unexpected control configuration');
  const result = decodePad(bits, tilt);
  requirePilot(result.variableHop === true && result.noAutoNudge === true && Object.values(result.pressed).every((v) => v === false) &&
    Object.entries(result).every(([key, value]) => ['variableHop', 'noAutoNudge', 'pressed', 'lastSource'].includes(key) || value === 0 || value === false),
  'Pilot tape did not decode to neutral controls');
  requirePilot(Array.isArray(tape.checkpoints) && tape.checkpoints.length > 0 &&
    tape.checkpoints.length === Math.floor(tape.endTick / CHECKPOINT_EVERY) && Array.from(tape.checkpoints).every((row, i) =>
      Array.isArray(row) && row.length === 8 && row[0] === (i + 1) * CHECKPOINT_EVERY && Array.from(row).every(Number.isFinite) && Number.isSafeInteger(row[7])),
  'Pilot capture did not provide complete fixed-tick checkpoints');
  return tape;
}

export function makeHandsOffReport(capture, replay, buildCommit) {
  const tape = assertHandsOffCapture(capture);
  requirePilot(replay?.desynced === false && replay.checked === tape.checkpoints.length,
    'Pilot replay did not match all original checkpoints');
  requirePilot(replay.savedDuringPlayback === false && replay.tape === null, 'Pilot replay unexpectedly saved a run or tape');
  const fields = ['tick', 'cause', 'hazardId', 'x', 'y', 'distanceM'];
  requirePilot(replay.crash && fields.every((name) => replay.crash[name] === capture.crash[name]),
    'Pilot replay natural crash differed from the capture');
  const { seed, biomeMask, targetM, dailyRuleId, calendarUtc, captureHz, replayHz, simTickHz } = PILOT;
  return {
    kind: 'local-hands-off-pilot', reportVersion: 1,
    scope: 'one local tool-assisted normal-run QA proof, not an official Daily or player result',
    build: { assertedGitCommit: pilotBuildPin(buildCommit), independentlyVerified: false },
    challenge: { seed, biomeMask, goal: `Reach ${targetM} m without any controls`, targetM, dailyRuleId, calendarUtc },
    replay: { captureHz, replayHz, simTickHz, neutralControls: true, checkpointsChecked: replay.checked,
      completedTicksBeforeCrash: tape.endTick, exactNaturalCrashMatch: true, playbackSaved: false },
    observedFinish: Object.fromEntries(fields.map((name) => [name, capture.crash[name]])),
  };
}
