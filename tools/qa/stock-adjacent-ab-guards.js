/** Cross-build comparison for one fixed synthetic fixture; never replays an older tape in a newer build. */
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';

const PAD = [[1, 6, 0]];
const TICK_HZ = 120;
const CAP = 4200;
const SCALARS = ['x', 'y', 'angle', 'vx', 'vy', 'angularVelocity', 'score'];
const OBSERVATIONS = [...SCALARS, 'grounded'];
const FATAL = ['tick', 'cause', 'hazardId', 'x', 'y', 'speedPxS'];
const RNG_FIELDS = ['physicsScramble', 'visualSled', 'visualFx', 'visualCamera'];
const digest = data => createHash('sha256').update(JSON.stringify(data)).digest('hex');
const check = (condition, message) => { if (!condition) throw new Error(message); };

function validateArm(arm) {
  const { match, rows, terminal, nativeCheckpoints } = arm ?? {};
  const header = match?.header;
  check(header?.format === 'bb-ghost-tape' && header.version === 1 && header.physicsVersion === 1 &&
    header.seed === 'sim-11' && header.biomeMask === 0 && header.mode === 'normal' &&
    header.simTickHz === TICK_HZ && header.dailyRuleId === 'featherweight' &&
    header.startedAt === Date.parse('2026-01-05T12:00:00Z') && header.dailyRuleSource === 'clock-at-start' &&
    header.controlLayout === 'tricksRight' && header.syncLevel === 1 &&
    header.edgeRows === 'every-tick' && Array.isArray(header.boosts) && header.boosts.length === 0 &&
    header.upgradeRanks === null && header.magnetsDrop === false && header.kodiaksOn === false &&
    header.kodiakPackMode === 'same' && Array.isArray(header.startPose) && header.startPose.length === 6 &&
    header.startPose.every(Number.isFinite) && Number.isFinite(header.bsod?.leftEdgeX) &&
    ['wallX', 'wallSpeedPxS', 'accelerationPxS2'].every(name => Number.isFinite(header.bsod.initial?.[name])) &&
    header.runRandomVersion === 1 && header.random?.version === 1 &&
    RNG_FIELDS.every(name => Number.isInteger(header.random[name]) && header.random[name] >= 0 &&
      header.random[name] <= 0xffffffff), 'Wrong fixed stock capture header');
  check(isDeepStrictEqual(match.inputs, PAD), 'Wrong native neutral input encoding');
  check(Array.isArray(rows) && rows.length >= TICK_HZ && rows.length < CAP, 'Missing bounded completed observations');
  check(Number.isSafeInteger(nativeCheckpoints) && nativeCheckpoints === Math.floor(rows.length / TICK_HZ),
    'Incomplete native checkpoint coverage');
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    check(row?.tick === i + 1 && SCALARS.every(name => Number.isFinite(row[name])) &&
      typeof row.grounded === 'boolean', 'Invalid or noncontiguous completed observations');
  }
  check(terminal?.tick === rows.length + 1 && typeof terminal.cause === 'string' && terminal.cause.length > 0 &&
    (terminal.hazardId === null || typeof terminal.hazardId === 'string') &&
    ['x', 'y', 'speedPxS'].every(name => Number.isFinite(terminal[name])), 'Missing separate natural terminal observation');
}

/** Both arms must already have passed the native same-build replay check. */
export function compareStockAdjacentArms(before, after) {
  validateArm(before);
  validateArm(after);
  check(isDeepStrictEqual(before.match.header, after.match.header), 'The native capture headers do not match');
  const count = Math.min(before.rows.length, after.rows.length);
  let firstDifference = null, maxPositionDeltaPx = 0;
  const airborneTicks = [0, 0];
  for (let i = 0; i < count; i++) {
    const [a, b] = [before.rows[i], after.rows[i]];
    if (!firstDifference) {
      const fields = OBSERVATIONS.filter(name => !Object.is(a[name], b[name]));
      if (fields.length) firstDifference = { tick: i + 1, fields };
    }
    const positionDelta = Math.hypot(b.x - a.x, b.y - a.y);
    check(Number.isFinite(positionDelta), 'Nonfinite position delta');
    maxPositionDeltaPx = Math.max(maxPositionDeltaPx, positionDelta);
    if (!a.grounded) airborneTicks[0]++;
    if (!b.grounded) airborneTicks[1]++;
  }
  const terminalChangedFields = FATAL.filter(name => !Object.is(before.terminal[name], after.terminal[name]));
  const summarize = (arm, i) => ({
    completedTicks: arm.rows.length,
    nativeCheckpointsPerReplay: arm.nativeCheckpoints,
    commonIntervalAirborneTicks: airborneTicks[i],
    commonLastCompletedScore: arm.rows[count - 1].score,
    terminal: { tick: arm.terminal.tick, cause: arm.terminal.cause, hazardId: arm.terminal.hazardId },
  });
  return {
    matchedNativeInputSha256: digest(before.match.inputs),
    commonCompletedTicks: count,
    firstObservedDifference: firstDifference,
    maxCommonPositionDeltaPx: maxPositionDeltaPx,
    terminalChangedFields,
    before: summarize(before, 0),
    after: summarize(after, 1),
  };
}
